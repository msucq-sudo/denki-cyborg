// 1階（ボルト研究室へ向かう施設の1階）。buildDungeon / updateLevel と同じ役割の buildFloor1 / updateFloor1。
// 使い方: URL に ?level=floor1
import * as THREE from 'three';
import { ENEMIES, LEVEL, LOCKDOWN, PLAYER } from '../config/balance';
import type { Enemy, World } from '../core/types';
import { addEnergy, drainEnergy } from '../core/energy';
import { clearSockets, getSockets } from '../core/sockets';
import { clearGrapplePoints, registerGrapplePoint } from '../core/grapple';
import { clearGrabbables, getGrabbables, registerGrabbable } from '../core/armGrab';
import { healPlayer, toast } from '../core/combat';
import { spawnEnemy } from '../enemies/api';
import { wakeDormant } from '../enemies/dormant';
import { generateFloor1, type Plan, type ZoneDef, type SpawnDef } from './floor1/plan';
import { buildFloor1Visuals, type Floor1Visuals, type GateVis } from './floor1/visuals';

/** 照明の見た目設定（main.ts がレンダラー露出に使う） */
export const FLOOR1_EXPOSURE = 1.1;
/** 実ライトを割り当てる天井灯の数（うち先頭 SHADOW_SLOTS 個だけ影を落とす） */
const LAMP_SLOTS = 6;
const SHADOW_SLOTS = 2;
interface LampSlot { light: THREE.SpotLight; lamp: number; cur: number }

interface ZoneRT { def: ZoneDef; enemies: Enemy[]; state: 'idle' | 'active' | 'done' }
export interface Floor1State {
  powered: boolean;
  /** 電源投入からの経過（演出） */
  powerT: number;
  gears: number;
  doorOpen: number;
  cleared: boolean;
  /** ゲートの開閉（true=開） */
  gates: Record<string, boolean>;
  /** 戦闘の進行 */
  fights: Record<string, 'idle' | 'active' | 'done'>;
  /** 電源を入れた方法 */
  powerVia: 'shot' | 'arm' | null;
  /** 閉じ込め戦の進行中 */
  lockdown: boolean;
}
interface Runtime {
  plan: Plan;
  vis: Floor1Visuals;
  state: Floor1State;
  zones: ZoneRT[];
  slots: LampSlot[];
  elevLight: THREE.PointLight;
  batLight: THREE.PointLight;
  fill: THREE.PointLight;
  hemi: THREE.HemisphereLight;
  beacon: THREE.PointLight;
  /** 各ゲートが「開いていてほしいか」 */
  want: Map<string, boolean>;
  alarm: number;
  beaconAt: { x: number; z: number };
  clock: number;
  started: boolean;
  lockMsgT: number;
  inCarT: number;
  warned: boolean;
  padRemain: number[];
  roomSeen: boolean[];
  /** SE用の状態 */
  promptOn: boolean;
  litPrev: boolean;
  padEmptyOn: boolean;
  /** 電源後に脇の部屋へ入った（左下の罠の発動条件） */
  sideVisited: boolean;
  /** 右の部屋の出口を抜けた（以後は閉じたまま） */
  passedExit: boolean;
  powerSocketOn: boolean;
}
const runtimes = new WeakMap<World, Runtime>();

export function getFloor1(world: World): { plan: Plan; state: Floor1State } | null {
  const rt = runtimes.get(world);
  return rt ? { plan: rt.plan, state: rt.state } : null;
}

// ---------------------------------------------------------------- 画面上の操作ヒント
let promptEl: HTMLDivElement | null = null;
export function showPrompt(text: string | null): void {
  if (typeof document === 'undefined') return;
  if (!promptEl) {
    promptEl = document.createElement('div');
    promptEl.style.cssText = 'position:fixed;left:50%;top:64%;transform:translateX(-50%);padding:10px 22px;border-radius:999px;'
      + 'font:800 19px "Yu Gothic","Meiryo",sans-serif;color:#fff;background:rgba(20,36,80,0.82);border:2px solid #6ff0ff;'
      + 'box-shadow:0 0 18px rgba(80,230,255,0.55);z-index:20;pointer-events:none;white-space:nowrap;display:none';
    document.body.appendChild(promptEl);
  }
  promptEl.style.display = text ? 'block' : 'none';
  if (text) promptEl.textContent = text;
}

// ---------------------------------------------------------------- 構築
export function buildFloor1(world: World): void {
  showPrompt(null);
  const plan = generateFloor1();
  const vis = buildFloor1Visuals(plan);
  const scene = world.scene;
  scene.add(vis.root);
  for (const c of vis.colliders) world.colliders.push(c);

  // ---- 照明：暗い施設。環境光は弱い青灰色、明かりは天井灯の光だまり（スポット）と発光物
  scene.background = new THREE.Color(0x0a111b);
  scene.fog = new THREE.FogExp2(0x0a111b, 0.009);
  const hemi = new THREE.HemisphereLight(0x4d6790, 0x232c3a, 1.8);
  scene.add(hemi);
  // 天井灯スポット：プレイヤー付近の天井灯へ割り当てる。先頭 2 つだけ影あり
  const slots: LampSlot[] = [];
  for (let i = 0; i < LAMP_SLOTS; i++) {
    const sp = new THREE.SpotLight(0xeaf6ff, 0, 40, 0.95, 0.9, 2);
    if (i < SHADOW_SLOTS) {
      sp.castShadow = true;
      sp.shadow.mapSize.set(1024, 1024);
      sp.shadow.bias = -0.0004;
      sp.shadow.normalBias = 0.04;
      sp.shadow.camera.near = 0.6;
    }
    scene.add(sp, sp.target);
    slots.push({ light: sp, lamp: -1, cur: 0 });
  }
  // エレベーター前の非常灯（赤）／バッテリー盤の青緑／プレイヤー周りの弱い補助光
  const elevLight = new THREE.PointLight(0xff3a2a, 40, 14, 2);
  elevLight.position.set(0, 4.2, -73);
  scene.add(elevLight);
  const batLight = new THREE.PointLight(0x62f0ff, 14, 9, 2);
  batLight.position.set(plan.power.x - 1.6, 2.4, plan.power.z);
  scene.add(batLight);
  const beacon = new THREE.PointLight(LOCKDOWN.light, 0, 26, 2);
  scene.add(beacon);
  const fill = new THREE.PointLight(0x9cc0ff, 7, 13, 2);
  scene.add(fill);

  // HUD ミニマップ用の区画
  world.level.rooms = plan.rooms.map((r) => ({
    name: r.name, min: new THREE.Vector3(r.x0, 0, r.z0), max: new THREE.Vector3(r.x1, r.h, r.z1), entered: false, cleared: false,
  }));
  world.level.currentRoom = -1;
  world.level.bossSpawned = false;
  world.level.bossDefeated = false;
  world.level.data.objective = '通路の敵を全滅させてゲートを開けろ';
  world.level.data.remaining = 0;
  world.level.data.gears = 0;
  const state: Floor1State = {
    powered: false, powerT: 0, gears: 0, doorOpen: 0, cleared: false,
    gates: {}, fights: {}, powerVia: null, lockdown: false,
  };
  world.level.data.floor1 = state;

  world.player.pos.set(plan.start.x, 0, plan.start.z);
  world.player.yaw = plan.start.yaw;
  world.player.pitch = 0;

  // ゲート：初期状態（閉じているものはコライダー有効、開いているものは無効）
  const want = new Map<string, boolean>();
  for (const g of vis.gates) {
    const open = !g.def.closed;
    g.open = open; g.k = open ? 1 : 0; g.collider.active = !open;
    g.shutter.position.y = open ? 5.1 : 0;
    want.set(g.def.id, open);
    state.gates[g.def.id] = open;
  }
  for (const z of plan.zones) state.fights[z.id] = 'idle';

  clearSockets(world);
  clearGrapplePoints(world);
  const rt: Runtime = {
    plan, vis, state, slots, elevLight, batLight, fill, hemi, beacon, want, alarm: 0, beaconAt: { x: 0, z: -60 },
    zones: plan.zones.map((def) => ({ def, enemies: [], state: 'idle' })),
    clock: 0, started: false, lockMsgT: 0, inCarT: 0, warned: false,
    padRemain: plan.pads.map(() => LEVEL.chargePadCapacity),
    roomSeen: plan.rooms.map(() => false),
    promptOn: false, litPrev: false, padEmptyOn: false, sideVisited: false, passedExit: false, powerSocketOn: false,
  };
  runtimes.set(world, rt);
  // グラップルポイント（近道。ルートは変えない）
  for (const g of plan.grapples) {
    registerGrapplePoint(world, {
      pos: new THREE.Vector3(g.x, g.y, g.z), normal: new THREE.Vector3(g.nx, g.ny, g.nz), kind: g.kind,
      landAt: g.landAt ? new THREE.Vector3(g.landAt.x, g.landAt.y, g.landAt.z) : undefined,
    });
  }
  // 電源装置：弾が当たる／アームで電気を送ると作動
  const P = plan.power;
  getSockets(world).push({
    pos: new THREE.Vector3(P.x, P.y, P.z), radius: P.r, enabled: true,
    onShot: () => activatePower(world, rt, 'shot'),
    onFeed: () => activatePower(world, rt, 'arm'),
  });
  // 歯車：吸収アームで掴んで遠くからでも取れる
  clearGrabbables(world);
  for (const g of vis.gears) {
    registerGrabbable(world, {
      pos: new THREE.Vector3(g.x, g.y, g.z), radius: 1.0, enabled: true, obj: g.model,
      onGrab: () => takeGear(world, rt, g),
    });
  }
}

/** 歯車を取得する（触れた／アームで掴んで引き戻した） */
function takeGear(world: World, rt: Runtime, g: Runtime['vis']['gears'][number]): void {
  if (g.taken) return;
  const state = rt.state;
  g.taken = true;
  g.model.visible = false;
  state.gears++;
  world.level.data.gears = state.gears;
  world.inventory.gears++; // 全体の所持品（HUD はこちらを読む）
  world.events.emit('gearPickup', {});
  toast(world, `強化素材（歯車）を入手 ×${state.gears}`, 3);
  for (const gb of getGrabbables(world)) if (gb.obj === g.model) gb.enabled = false;
}

/**
 * 2階から戻ってきた1階。戦闘・仕掛けは解決済み（電源ON・全ゲート開放・敵なし・歯車回収済み）で、
 * エレベーター前から始める。エレベーターにもう一度乗ると2階へ行く。
 */
export function buildFloor1Revisit(world: World): void {
  buildFloor1(world);
  const rt = runtimes.get(world)!;
  const { state, plan, vis } = rt;
  state.powered = true; state.powerVia = 'shot'; state.powerT = 100;
  for (const s of getSockets(world)) s.enabled = false;
  for (const z of rt.zones) { z.state = 'done'; state.fights[z.def.id] = 'done'; }
  rt.started = true; rt.passedExit = true; rt.litPrev = true;
  state.doorOpen = 1;
  for (const g of vis.gates) {
    g.open = true; g.k = 1; g.collider.active = false; g.shutter.position.y = 5.1;
    rt.want.set(g.def.id, true); state.gates[g.def.id] = true;
  }
  for (const g of vis.gears) { g.taken = true; g.model.visible = false; }
  world.player.pos.set(plan.elevator.approachX, 0, plan.elevator.approachZ + 1);
  world.player.yaw = Math.PI;
}

function activatePower(world: World, rt: Runtime, via: 'shot' | 'arm'): void {
  const { state, plan } = rt;
  if (state.powered) return;
  if (via === 'arm') {
    if (world.player.energy < 1) { toast(world, 'エネルギーが足りない…', 2.5); world.events.emit('noEnergy', {}); return; }
    drainEnergy(world, 1);
  }
  state.powered = true;
  state.powerVia = via;
  for (const s of getSockets(world)) s.enabled = false;
  toast(world, 'エレベーターに電力が戻った', 4);
  toast(world, '大広間の北、エレベーターへ向かえ', 4);
  world.events.emit('switchOn', { pos: new THREE.Vector3(plan.power.x, 1.4, plan.power.z) });
}

// ---------------------------------------------------------------- 敵の出現
/**
 * 敵を休眠状態で配置する（地上＝コンテナ、ドローン／mode:'drop'＝天井ハッチ）。
 * zone は近づくと起きる。trap は wakeRadius 0（トリガーで一斉に起こす）
 */
function spawnList(world: World, rt: Runtime, z: ZoneDef): Enemy[] {
  const out: Enemy[] = [];
  const cx = z.face?.x ?? (z.x0 + z.x1) / 2, cz = z.face?.z ?? (z.z0 + z.z1) / 2;
  for (const s of z.spawns) {
    const r = ENEMIES[s.kind].radius;
    const fl = s.floor ?? 0;
    const y = s.kind === 'drone' ? fl + 3.2 : fl + r + 0.1;
    try {
      const mode = s.mode ?? (s.kind === 'drone' ? 'drop' : 'pod');
      const e = spawnEnemy(world, s.kind, new THREE.Vector3(s.x, y, s.z), {
        dormant: mode, yaw: Math.atan2(cx - s.x, cz - s.z), ...(z.mode === 'trap' ? { wakeRadius: 0 } : {}),
      });
      out.push(e);
    } catch (err) {
      if (!rt.warned) { rt.warned = true; console.warn('[floor1] spawnEnemy failed', err); }
    }
  }
  return out;
}
/** 生きている敵の数（休眠中も数える） */
const alive = (list: Enemy[]): number => list.filter((e) => e.status === 'active' || e.status === 'stunned').length;

function inRect(x: number, z: number, d: { x0: number; x1: number; z0: number; z1: number }): boolean {
  return x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1;
}

// ---------------------------------------------------------------- 天井灯の割り当て
/** ちらつき係数 0..1（故障寸前の灯り：時々まとまって明滅する） */
function flickerOf(t: number, seed: number): number {
  const ph = (t * 0.27 + seed * 0.37) % 1;
  if (ph > 0.14) return 1;
  return Math.sin(t * 61 + seed * 9) > -0.15 && Math.sin(t * 37 + seed) > -0.6 ? 0.85 : 0.07;
}
function updateLamps(rt: Runtime, pp: THREE.Vector3, dt: number, t: number): void {
  const lamps = rt.plan.lamps;
  // 近い順（高さ方向はやや軽く見る）に、点灯中の天井灯を最大 LAMP_SLOTS 個選ぶ
  const cand: { i: number; d: number }[] = [];
  lamps.forEach((l, i) => {
    if (l.power <= 0) return;
    const d = (l.x - pp.x) ** 2 + (l.z - pp.z) ** 2 + (l.y - pp.y - 1) ** 2 * 0.3;
    if (d < 45 * 45) cand.push({ i, d });
  });
  cand.sort((u, v) => u.d - v.d);
  const want = cand.map((c) => c.i);
  const top = want.slice(0, LAMP_SLOTS);
  const snap = t < dt * 2.5;
  // 選ばれなくなった灯りは消えていく
  for (const sl of rt.slots) {
    const keep = sl.lamp >= 0 && top.includes(sl.lamp);
    const goal = keep ? 1 : 0;
    sl.cur = snap ? goal : sl.cur + (goal - sl.cur) * Math.min(1, dt * (goal > sl.cur ? 5 : 3.5));
    if (!keep && sl.cur < 0.02) { sl.cur = 0; sl.lamp = -1; }
  }
  // 新しく選ばれた灯りに空きスロットを（近い順に影ありスロットを優先）
  top.forEach((li) => {
    if (rt.slots.some((sl) => sl.lamp === li)) return;
    const rank = top.indexOf(li);
    const free = rt.slots.filter((sl) => sl.lamp < 0);
    if (!free.length) return;
    const sh = free.find((sl) => rt.slots.indexOf(sl) < SHADOW_SLOTS);
    const sl = rank < SHADOW_SLOTS ? (sh ?? free[0]) : (free.find((x) => rt.slots.indexOf(x) >= SHADOW_SLOTS) ?? free[0]);
    const l = lamps[li];
    sl.lamp = li; sl.cur = snap ? 1 : 0;
    const sp = sl.light;
    sp.position.set(l.x, l.y, l.z);
    sp.target.position.set(l.x, 0, l.z);
    sp.color.set(l.color);
    sp.distance = l.y * 3 + 8;
    sp.angle = Math.min(0.95, Math.atan2(7.5, l.y)); // 光だまりの半径が約 7.5m になる開き角
  });
  for (const sl of rt.slots) {
    if (sl.lamp < 0) { sl.light.intensity = 0; continue; }
    const l = lamps[sl.lamp];
    const f = l.flicker ? flickerOf(t, sl.lamp) : 1;
    // 床面の照度が約 4〜7（大広間は広いので強め） になるよう高さの二乗で強さを決める
    sl.light.color.set(l.color).lerp(RED_C, rt.alarm);
    sl.light.intensity = (l.h > 12 ? 7 : 4.2) * l.y * l.y * l.power * sl.cur * f;
  }
  // 発光パネルもちらつかせる
  for (const [i, fp] of rt.vis.flickerPanels) {
    const f = flickerOf(t, i);
    fp.mat.color.copy(fp.base).lerp(RED_C2, rt.alarm).multiplyScalar(0.12 + 0.88 * f);
  }
}
const RED_C = new THREE.Color(), RED_C2 = new THREE.Color();
function batLightUpdate(rt: Runtime, t: number): void {
  rt.batLight.color.set(rt.state.powered ? 0x5cffa8 : 0x62f0ff);
  rt.batLight.intensity = rt.state.powered ? 26 : 12 + 3 * Math.sin(t * 3.1);
}


// ---------------------------------------------------------------- ゲート
const gateById = (rt: Runtime, id: string): GateVis => rt.vis.gates.find((g) => g.def.id === id)!;
/** ゲートの開閉を要求する。閉める時は敵／プレイヤーが挟まらないように、範囲が空くまで待つ */
function setGate(rt: Runtime, id: string, open: boolean): void { rt.want.set(id, open); }

function blocked(world: World, g: GateVis): boolean {
  const d = g.def, m = 0.8;
  const p = world.player.pos;
  if (p.x > d.x0 - m && p.x < d.x1 + m && p.z > d.z0 - m && p.z < d.z1 + m && p.y < 6) return true;
  for (const e of world.enemies) {
    if (e.status === 'dead') continue;
    const r = e.radius + 0.5;
    if (e.pos.x > d.x0 - r && e.pos.x < d.x1 + r && e.pos.z > d.z0 - r && e.pos.z < d.z1 + r && e.pos.y < 6) return true;
  }
  return false;
}

function updateGates(world: World, rt: Runtime, dt: number, t: number): void {
  for (const g of rt.vis.gates) {
    const want = rt.want.get(g.def.id) ?? g.open;
    if (want && !g.open) {
      g.open = true;
      world.events.emit('doorOpen', { pos: new THREE.Vector3(g.cx, 1.5, g.cz) });
    } else if (!want && g.open && !blocked(world, g)) {
      g.open = false;
      g.collider.active = true;
      world.events.emit('doorClose', { pos: new THREE.Vector3(g.cx, 1.5, g.cz) });
    }
    g.k = Math.max(0, Math.min(1, g.k + (g.open ? 1 : -1) * dt / 0.9));
    if (g.open && g.k > 0.85) g.collider.active = false;
    g.shutter.position.y = g.k * 5.1;
    const blink = !g.open && rt.state.lockdown ? (Math.sin(t * 12) > 0 ? 1 : 0.3) : 1;
    g.lampMat.color.set(g.open ? 0x3dff7a : 0xff2a2a).multiplyScalar(blink);
    rt.state.gates[g.def.id] = g.open;
  }
}

// ---------------------------------------------------------------- 戦闘
const fightOf = (rt: Runtime, id: string): ZoneRT => rt.zones.find((z) => z.def.id === id)!;
const zoneCenter = (d: ZoneDef): { x: number; z: number } => ({ x: (d.x0 + d.x1) / 2, z: (d.z0 + d.z1) / 2 });

/** 休眠中の敵を一斉に起こす（間隔 gap 秒ずらす） */
function wakeAll(world: World, f: ZoneRT, gap: number): void {
  f.enemies.forEach((e, i) => wakeDormant(world, e, i * gap));
}

/** 閉じ込め戦を始める：ドアを閉め、敵を一斉に起こし、警報を鳴らす */
function startTrap(world: World, rt: Runtime, id: string, closes: string[], msg: string): void {
  const f = fightOf(rt, id);
  if (f.state !== 'idle') return;
  f.state = 'active';
  rt.state.fights[id] = 'active';
  for (const g of closes) setGate(rt, g, false);
  wakeAll(world, f, 0.1);
  const c = zoneCenter(f.def);
  rt.beaconAt = id === 'final' ? { x: 0, z: -62 } : c;
  rt.state.lockdown = true;
  world.events.emit('zoneWave', { wave: 1 });
  world.events.emit('lockdownStart', { zone: id });
  toast(world, msg, 3.5);
}
function endTrap(world: World, rt: Runtime, id: string, opens: string[], msg: string): void {
  const f = fightOf(rt, id);
  f.state = 'done';
  rt.state.fights[id] = 'done';
  for (const g of opens) setGate(rt, g, true);
  rt.state.lockdown = rt.zones.some((z) => z.def.mode === 'trap' && z.state === 'active');
  world.events.emit('lockdownEnd', { zone: id });
  toast(world, msg, 3);
}

function updateFights(world: World, rt: Runtime): void {
  const p = world.player.pos;
  const { state } = rt;
  const inBox = (x0: number, x1: number, z0: number, z1: number) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1 && p.y < 5;

  // ---- 通常ゾーン（スタート通路・右下・左中央）：誰か1体でも起きたら全員起こす
  for (const f of rt.zones) {
    if (f.def.mode !== 'zone' || f.state === 'done') continue;
    if (f.state === 'idle' && f.enemies.some((e) => !e.ai.dormant && e.status !== 'dead')) {
      f.state = 'active';
      state.fights[f.def.id] = 'active';
      wakeAll(world, f, 0.12);
      if (f.def.id === 'start') toast(world, '敵が目覚めた！ 全滅させるまでゲートは開かない', 3.5);
    }
    if (f.enemies.length && alive(f.enemies) === 0) {
      f.state = 'done';
      state.fights[f.def.id] = 'done';
      if (f.def.id === 'start') {
        setGate(rt, 'start', true);
        toast(world, 'ゲートが開いた。先へ進もう', 3.5);
      }
    }
  }

  // ---- 行き止まり：歯車に近づくと入口が閉まる
  const dead = fightOf(rt, 'dead');
  const dg = rt.plan.gears.find((g) => g.area === '行き止まり')!;
  if (dead.state === 'idle' && p.x > 68.5 && Math.hypot(p.x - dg.x, p.z - dg.z) < 6 && p.y < 3) {
    startTrap(world, rt, 'dead', ['dead'], '入口が閉まった！ 敵が出てきた！');
  }
  if (dead.state === 'active' && alive(dead.enemies) === 0) endTrap(world, rt, 'dead', ['dead'], '入口が開いた');

  // ---- 右の部屋 上半分：入ると下の入口と上下の扉が閉まる
  const ru = fightOf(rt, 'RU');
  if (ru.state === 'idle' && inBox(32.5, 59.5, -69.5, -50.5)) {
    startTrap(world, rt, 'RU', ['rmid', 'rlow'], '扉が閉まった！ 天井とコンテナから敵が！');
  }
  if (ru.state === 'active' && alive(ru.enemies) === 0) {
    endTrap(world, rt, 'RU', ['rmid', 'rexit'], '出口の扉が開いた。大広間へ戻れる');
  }
  // 出口を抜けて大広間に入ったら閉じる（一方通行）
  if (ru.state === 'done' && !rt.passedExit && inBox(-22, 20.5, -69, -37)) {
    rt.passedExit = true;
    setGate(rt, 'rexit', false);
  }

  // ---- 左下の罠：電源を入れたあと脇の部屋から戻ってくると閉じ込められる
  if (state.powered && inBox(-31, -23.5, -36, -20)) rt.sideVisited = true;
  const l3 = fightOf(rt, 'L3');
  if (l3.state === 'idle' && state.powered && rt.sideVisited && inBox(-51.5, -34, -34.5, -21.5)) {
    startTrap(world, rt, 'L3', ['l3n', 'side'], '扉が閉まった！ 敵が出てきた！');
  }
  if (l3.state === 'active' && alive(l3.enemies) === 0) endTrap(world, rt, 'L3', ['l3n', 'side'], '扉が開いた');

  // ---- エレベーター最終戦：電源が入ったあと近づくと左右から敵が現れる
  const fin = fightOf(rt, 'final');
  const E = rt.plan.elevator;
  if (fin.state === 'idle' && state.powered && p.y < 3 && Math.hypot(p.x - E.approachX, p.z - E.approachZ) < 9) {
    // 左右の部屋（西の連絡通路・右の部屋の出口）への行き来を封鎖
    startTrap(world, rt, 'final', ['l2', 'rexit'], 'エレベーターの左右から敵が現れた！ 通路が封鎖された');
  }
  if (fin.state === 'active' && alive(fin.enemies) === 0) endTrap(world, rt, 'final', ['l2'], 'エレベーターのロックが外れた');
}

// ---------------------------------------------------------------- 更新
const CYAN = new THREE.Color(0x52e8ff);
const GRAY = new THREE.Color(0x77788a);
const _c = new THREE.Color();
const HEMI_BASE_SKY = new THREE.Color(0x4d6790), HEMI_BASE_GND = new THREE.Color(0x232c3a);

export function updateFloor1(world: World, dt: number): void {
  const rt = runtimes.get(world);
  if (!rt) return;
  const { plan, vis, state } = rt;
  const p = world.player;
  rt.clock += dt;
  const t = rt.clock;

  // 開始時：すべての戦闘の敵を休眠状態で配置しておく
  if (!rt.started) {
    rt.started = true;
    for (const z of rt.zones) z.enemies = spawnList(world, rt, z.def);
    toast(world, '通路の先に封印されたコンテナがある。近づくと中身が目覚める', 4);
  }

  // ---- 警報照明（LOCKDOWN.enabled で一括オフ）
  const wantAlarm = LOCKDOWN.enabled && state.lockdown ? 1 : 0;
  rt.alarm += (wantAlarm - rt.alarm) * Math.min(1, dt * (wantAlarm > rt.alarm ? 6 : 2.5));
  if (Math.abs(rt.alarm - wantAlarm) < 0.01) rt.alarm = wantAlarm;
  RED_C.set(LOCKDOWN.light); RED_C2.set(LOCKDOWN.light).multiplyScalar(1.5);
  vis.setAlarm(rt.alarm, LOCKDOWN.light);
  rt.hemi.color.copy(HEMI_BASE_SKY).lerp(RED_C, rt.alarm * 0.7);
  rt.hemi.groundColor.copy(HEMI_BASE_GND).lerp(RED_C, rt.alarm * 0.4);
  rt.beacon.color.set(LOCKDOWN.light);
  rt.beacon.position.set(rt.beaconAt.x, 4.5, rt.beaconAt.z);
  rt.beacon.intensity = rt.alarm * (35 + 45 * Math.max(0, Math.sin(t * 5.5)));

  updateLamps(rt, p.pos, dt, t);
  batLightUpdate(rt, t);
  rt.fill.position.set(p.pos.x, p.pos.y + 2.6, p.pos.z);

  // ---- 区画の入退室
  let cur = -1;
  plan.rooms.forEach((r, i) => {
    if (p.pos.x > r.x0 && p.pos.x < r.x1 && p.pos.z > r.z0 && p.pos.z < r.z1) cur = i;
  });
  if (cur >= 0) {
    world.level.currentRoom = cur;
    if (!rt.roomSeen[cur]) {
      rt.roomSeen[cur] = true;
      world.level.rooms[cur].entered = true;
      world.events.emit('roomEnter', { index: cur, name: plan.rooms[cur].name });
    }
  }

  updateFights(world, rt);
  updateGates(world, rt, dt, t);

  let remaining = 0;
  for (const z of rt.zones) remaining += alive(z.enemies);
  // 区画ごとのクリア表示
  plan.rooms.forEach((r, i) => {
    const id = r.id === 'hall' ? 'final' : r.id;
    const z = rt.zones.find((q) => q.def.id === id);
    if (z) world.level.rooms[i].cleared = z.state === 'done';
  });

  // ---- 電源装置：弾かアームで作動（ソケット）。近くにヒントを出す
  const P = plan.power;
  const nearDev = !state.powered && Math.hypot(p.pos.x - P.x, p.pos.z - P.z) < 6 && Math.abs(p.pos.y) < 2 && world.state === 'playing';
  if (nearDev) {
    showPrompt('撃つ / アームで電気を送る');
    if (!rt.promptOn) world.events.emit('interactPrompt', {});
    rt.promptOn = true;
  } else { showPrompt(null); rt.promptOn = false; }

  if (state.powered) state.powerT += dt;
  vis.knobMat.color.set(state.powered ? 0x44ff99 : 0xff4a3a);
  vis.cellMat.color.set(state.powered ? _c.set(0x7bffb0) : _c.set(0x2b3d57));
  const reach = state.powered ? state.powerT * 14 : -1; // m/s で光が伸びる
  for (const s of vis.cableSegs) {
    const k = Math.max(0, Math.min(1, (reach - s.start) / s.len));
    if (k >= 1) s.mat.color.copy(CYAN).multiplyScalar(0.85 + 0.15 * Math.sin(t * 6 - s.start * 0.4));
    else s.mat.color.set(0x2b3d57).lerp(CYAN, k);
  }
  const lit = state.powered && reach >= vis.cableTotal;
  const finalDone = fightOf(rt, 'final').state === 'done';
  // エレベーターのランプ・ドア・ライト
  vis.lampMat.color.set(lit ? 0x3dff7a : state.powered ? (Math.sin(t * 14) > 0 ? 0xffc21a : 0x553300) : 0xff2a2a);
  vis.statusOff.visible = !lit;
  vis.statusOn.visible = lit;
  rt.elevLight.color.set(lit ? 0x58ff9a : 0xff3a2a);
  rt.elevLight.intensity = lit ? 120 : 26 + 8 * Math.sin(t * 2.4);
  const E = plan.elevator;
  if (lit && !rt.litPrev) {
    world.events.emit('powerRestored', { pos: new THREE.Vector3(E.approachX, 1, E.approachZ) });
  }
  rt.litPrev = lit;
  const doorWant = lit && finalDone;
  const wasOpen = state.doorOpen >= 1;
  state.doorOpen = doorWant ? Math.min(1, state.doorOpen + dt / 1.2) : 0;
  if (doorWant && !wasOpen && state.doorOpen >= 1) world.events.emit('elevatorOpen', { pos: new THREE.Vector3(E.approachX, 1, E.approachZ) });
  const slide = state.doorOpen * ((E.doorX1 - E.doorX0) / 2 - 0.05);
  vis.leaves[0].position.x = -((E.doorX1 - E.doorX0) / 4) - slide;
  vis.leaves[1].position.x = (E.doorX1 - E.doorX0) / 4 + slide;
  vis.doorCollider.active = state.doorOpen < 0.9;

  // 電源が入っていないエレベーターに近づいた時：西の連絡通路のロックが外れる
  rt.lockMsgT -= dt;
  const nearElev = Math.hypot(p.pos.x - E.approachX, p.pos.z - E.approachZ) < 6 && p.pos.y < 3;
  if (!state.powered && nearElev) {
    if (rt.lockMsgT <= 0) {
      rt.lockMsgT = 8;
      world.events.emit('elevatorLocked', { pos: new THREE.Vector3(E.approachX, 1, E.approachZ) });
      toast(world, 'エレベーターに電源が入っていない…電源を探そう', 4);
    }
    if (!rt.want.get('l2')) {
      setGate(rt, 'l2', true);
      toast(world, '西の連絡通路のロックが外れた', 3.5);
    }
  }

  // エレベーターに乗ったらクリア
  const inCar = p.pos.x > E.x0 && p.pos.x < E.x1 && p.pos.z > E.z0 && p.pos.z < E.z1 && p.pos.y < 2;
  if (lit && finalDone && inCar) rt.inCarT += dt; else rt.inCarT = 0;
  if (!state.cleared && rt.inCarT > 0.7) {
    state.cleared = true;
    toast(world, '1階クリア！ エレベーターで上の階へ', 4);
    world.level.bossDefeated = true;
    world.level.data.nextFloor = 2; // main.ts が見て2階へ移る
    world.events.emit('elevatorRide', {});
  }

  // ---- 歯車
  for (const g of vis.gears) {
    if (g.taken) continue;
    g.model.tick(t + g.x);
    const dx = g.x - p.pos.x, dz = g.z - p.pos.z, dy = g.y - (p.pos.y + 0.9);
    if (dx * dx + dz * dz < 1.6 * 1.6 && Math.abs(dy) < 2.0 && p.hp > 0) takeGear(world, rt, g);
  }

  // ---- 充電ポイント
  vis.pads.forEach((pad, i) => {
    const cap = LEVEL.chargePadCapacity;
    const remain = rt.padRemain[i];
    const on = Math.hypot(pad.x - p.pos.x, pad.z - p.pos.z) < 1.8 && Math.abs(p.pos.y - pad.y) < 1.2;
    let charging = false;
    if (on && remain <= 0) { if (!rt.padEmptyOn) { rt.padEmptyOn = true; world.events.emit('padEmpty', {}); } }
    else if (!on) rt.padEmptyOn = false;
    if (on && remain > 0 && p.energy < p.maxEnergy && p.hp > 0) {
      const gained = addEnergy(world, Math.min(LEVEL.chargePadRate * dt, remain));
      if (gained > 0) { rt.padRemain[i] -= gained; charging = true; if (Math.random() < dt * 3) world.events.emit('charging', { amount: gained }); }
    }
    const k = Math.max(0, Math.min(1, rt.padRemain[i] / cap));
    pad.disc.color.copy(GRAY).lerp(CYAN, Math.pow(k, 0.6));
    pad.ring.color.copy(GRAY).lerp(CYAN, Math.pow(k, 0.6));
    pad.disc.opacity = 0.25 + 0.55 * k + (charging ? 0.2 : 0);
  });

  // ---- 修理キット
  for (let i = vis.kits.length - 1; i >= 0; i--) {
    const kit = vis.kits[i];
    kit.group.rotation.y = t * 1.8;
    kit.group.position.y = kit.y + 1 + Math.sin(t * 2.2 + kit.x) * 0.15;
    if (p.hp >= p.maxHp || p.hp <= 0) continue;
    const dx = kit.x - p.pos.x, dz = kit.z - p.pos.z;
    if (dx * dx + dz * dz < 1.4 * 1.4 && Math.abs(kit.group.position.y - (p.pos.y + PLAYER.height * 0.5)) < 1.6) {
      kit.group.parent?.remove(kit.group);
      vis.kits.splice(i, 1);
      const before = p.hp;
      healPlayer(world, LEVEL.repairKitHeal);
      world.events.emit('repair', { amount: p.hp - before });
    }
  }

  // ---- 目的表示
  const fs = state.fights;
  let obj: string;
  if (state.cleared) obj = '1階を突破した';
  else if (fs.start !== 'done') obj = '通路の敵を全滅させてゲートを開けろ';
  else if (fs.RU !== 'done') obj = '右の部屋を抜けて大広間の北へ（寄り道：行き止まりの歯車）';
  else if (!state.gates.l2) obj = '大広間の北のエレベーターを調べよう';
  else if (!state.powered) obj = '脇の細い部屋の電源装置を撃つ／アームで電気を送れ';
  else if (fs.final !== 'done') obj = remaining > 0 ? `エレベーターの敵を倒せ（残り${remaining}）` : 'エレベーターへ向かえ';
  else obj = '北のエレベーターに乗れ';
  world.level.data.objective = obj;
  world.level.data.remaining = remaining;
}
