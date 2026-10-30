// サージ収容所 1階（?level=camp1。&start=boss で中ボス戦の前のチェックポイントから）。設計：docs/camp-floor1-plan.md
// 外（サージ収容所への道で車が激突した建物）の左側の入口 → A。A〜J の部屋とギミック：
//  - セキュリティキー2本（B・F の高い所）→ C の上の青い扉が開いて D へ
//  - J の脆い壁：撃つたびにひびが広がり、最大まで溜めた溜め撃ちで壊れる（中に歯車）
//  - G と D の間の厚い壁の天井付近に隠し通路（グラップルで上がる。中に歯車）
//  - E→I の斜め通路のレーザー網：E の電力源2つを吸収アームで吸い尽くすと消える（I に歯車）
//  - A の赤ウォーカー：ハッキングで恒久の仲間（時間切れなし）。ついてきて、G では隠し通路の下へ案内する。送電で回復／吸収もできる
//  - A の送電ソケット → 床のハッチが開いて地下通路（歯車）／C の電源スイッチ → 暗い C の明かりがつく
//  - A→E の縦通路でバキュームを入手
//  - D→H：ビーマー2体＋多数の敵の閉じ込め戦。全滅で H の右上の2階への出口が開く（入ると camp2 へ）
import * as THREE from 'three';
import { CAMP1, ENEMIES, HACK, LOCKDOWN } from '../config/balance';
import type { Enemy, World } from '../core/types';
import { drainEnergy } from '../core/energy';
import { clearSockets, getSockets } from '../core/sockets';
import { clearGrapplePoints, registerGrapplePoint } from '../core/grapple';
import { clearGrabbables, getGrabbables, registerGrabbable } from '../core/armGrab';
import { clearPowerSources, getPowerSources } from '../core/powerSources';
import { damagePlayer, toast } from '../core/combat';
import { segmentAABB } from '../core/collision';
import { spawnBurst } from '../core/effects';
import { spawnEnemy } from '../enemies/api';
import { wakeDormant } from '../enemies/dormant';
import { chargeDamage } from '../player/logic';
import { gunChargeMaxDamage } from '../progression/effects';
import { showPrompt } from './floor1';
import { generateCamp1, type Plan, type SpawnDef, type ZoneDef } from './camp1/plan';
import { buildCamp1Visuals, type Camp1Visuals, type GateVis } from './camp1/visuals';
import { createSpawnBoxes, openSpawnBoxes, spawnBoxAlive, updateSpawnBoxes, type SpawnBox } from './spawnBoxes';

export const CAMP1_EXPOSURE = CAMP1.exposure;

export type Camp1Start = 'entrance' | 'boss';
type Fight = 'idle' | 'active' | 'done';

export interface Camp1State {
  /** 持っているセキュリティキー */
  keys: ('B' | 'F')[];
  keyDoorOpen: boolean;
  hatchOpen: boolean;
  /** C の部屋に電気が来た（明かりがつく） */
  cLit: boolean;
  /** 脆い壁のひびの段階（0..CAMP1.crackStages）と、壊れたか */
  crack: number;
  wallBroken: boolean;
  /** 吸い尽くしたレーザー網の電力源 */
  drained: string[];
  laserOff: boolean;
  vacuum: boolean;
  /** 赤ウォーカー：敵のまま／仲間／いない（倒された） */
  ally: 'enemy' | 'ally' | 'dead';
  /** 案内中（G で隠し通路の下へ歩いている） */
  guiding: boolean;
  fights: Record<string, Fight>;
  boss: Fight;
  wave2: boolean;
  exitOpen: boolean;
  exitReached: boolean;
  checkpoint: Camp1Start;
  gears: string[];
  lockdown: boolean;
}

/** enemies＝最初から World にいる敵（ドローン・リーチなど）、boxes＝箱に隠れている敵（level/spawnBoxes.ts） */
interface ZoneRT { def: ZoneDef; enemies: Enemy[]; wave2: Enemy[]; boxes: SpawnBox[]; boxes2: SpawnBox[]; state: Fight }
interface Slot { light: THREE.PointLight; lamp: number; cur: number }

interface Runtime {
  world: World;
  plan: Plan;
  vis: Camp1Visuals;
  state: Camp1State;
  zones: ZoneRT[];
  slots: Slot[];
  hemi: THREE.HemisphereLight;
  fill: THREE.PointLight;
  beacon: THREE.PointLight;
  cEmergency: THREE.PointLight;
  want: Map<string, boolean>;
  alarm: number;
  clock: number;
  started: boolean;
  startAt: Camp1Start;
  walker: Enemy | null;
  /** プレイヤーの足跡（仲間がはぐれたときのワープ先） */
  trail: THREE.Vector3[];
  trailT: number;
  farT: number;
  keyMsgT: number;
  laserHitT: number;
  promptOn: boolean;
  guideShown: boolean;
  roomSeen: boolean[];
  warned: boolean;
  /** 床のハッチの開き具合 0..1 */
  hatchK: number;
}
const runtimes = new WeakMap<World, Runtime>();

/**
 * リトライで World を作り直しても、拾った物と仲間の状態は残す（main.ts の changeLevel は所持品・強化しか引き継がないため）。
 * 外から入り直した（startAt なし）ときに消す
 */
interface Memo {
  gears: string[]; keys: ('B' | 'F')[]; vacuum: boolean; ally: 'enemy' | 'ally' | 'dead'; allyHp: number;
  hatchOpen: boolean; cLit: boolean; wallBroken: boolean; laserOff: boolean; drained: string[]; boss: boolean;
  /** v1 セーブとの互換性のため任意。戦闘状況は次回の戦闘再開に使う。 */
  fights?: Record<string, Fight>;
}
let memo: Memo | null = null;
/** セーブ用：今の記録（拾った物・解いた仕掛け・仲間の状態） */
export function getCamp1Memo(): Memo | null { return memo ? JSON.parse(JSON.stringify(memo)) as Memo : null; }
/** つづきから：セーブの記録を戻す（buildCamp1 より前に呼ぶ。startAt 付きで作ること） */
export function setCamp1Memo(m: unknown): void { memo = validateMemo(m); }

const MEMO_GEAR_IDS = new Set(['tunnel', 'E', 'I', 'J', 'duct', 'H']);
const MEMO_FIGHT_IDS = new Set(['A', 'tunnel', 'B', 'E', 'F', 'G', 'C', 'D', 'boss']);
const MEMO_DRAIN_IDS = new Set(['L1', 'L2']);
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validStringArray(value: unknown, allowed?: Set<string>): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && (!allowed || allowed.has(item)));
}
/** セーブデータは外部入力として扱い、旧 v1 形式も受け入れつつ壊れた形は破棄する。 */
function validateMemo(value: unknown): Memo | null {
  if (value == null) return null;
  if (!isRecord(value)) return null;
  const m = value;
  if (!validStringArray(m.gears, MEMO_GEAR_IDS) || !validStringArray(m.keys, new Set(['B', 'F'])) ||
      typeof m.vacuum !== 'boolean' || !['enemy', 'ally', 'dead'].includes(m.ally as string) ||
      typeof m.allyHp !== 'number' || !Number.isFinite(m.allyHp) ||
      typeof m.hatchOpen !== 'boolean' || typeof m.cLit !== 'boolean' || typeof m.wallBroken !== 'boolean' ||
      typeof m.laserOff !== 'boolean' || !validStringArray(m.drained, MEMO_DRAIN_IDS) || typeof m.boss !== 'boolean') return null;

  let fights: Record<string, Fight> | undefined;
  if (m.fights !== undefined) {
    if (!isRecord(m.fights)) return null;
    fights = {};
    for (const [id, status] of Object.entries(m.fights)) {
      if (!MEMO_FIGHT_IDS.has(id) || (status !== 'idle' && status !== 'active' && status !== 'done')) return null;
      fights[id] = status;
    }
  }
  return {
    gears: [...new Set(m.gears)], keys: [...new Set(m.keys)] as ('B' | 'F')[], vacuum: m.vacuum,
    ally: m.ally as Memo['ally'], allyHp: Math.max(0, m.allyHp), hatchOpen: m.hatchOpen, cLit: m.cLit,
    wallBroken: m.wallBroken, laserOff: m.laserOff, drained: [...new Set(m.drained)], boss: m.boss, ...(fights ? { fights } : {}),
  };
}

export function getCamp1(world: World): { plan: Plan; state: Camp1State; vis: Camp1Visuals; walker: Enemy | null } | null {
  const rt = runtimes.get(world);
  return rt ? { plan: rt.plan, state: rt.state, vis: rt.vis, walker: rt.walker } : null;
}

// ---------------------------------------------------------------- 構築
export function buildCamp1(world: World): void {
  showPrompt(null);
  const startAt: Camp1Start = world.level.data.startAt === 'boss' ? 'boss' : 'entrance';
  if (!world.level.data.startAt) memo = null;
  const plan = generateCamp1();
  const vis = buildCamp1Visuals(plan);
  const scene = world.scene;
  scene.add(vis.root);
  for (const c of vis.colliders) world.colliders.push(c);

  // ---- 照明：暗い収容所。天井灯の実ライトはプレイヤーの近くに割り当てる
  scene.background = new THREE.Color(0x07090e);
  scene.fog = new THREE.FogExp2(0x07090e, 0.012);
  const hemi = new THREE.HemisphereLight(0x5a6680, 0x1e232c, 1.1);
  scene.add(hemi);
  const slots: Slot[] = [];
  for (let i = 0; i < CAMP1.lampSlots; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 22, 2);
    scene.add(l);
    slots.push({ light: l, lamp: -1, cur: 0 });
  }
  const fill = new THREE.PointLight(0x9cc0ff, 6, 12, 2);
  scene.add(fill);
  const beacon = new THREE.PointLight(LOCKDOWN.light, 0, 30, 2);
  beacon.position.set(97, 8, 15);
  scene.add(beacon);
  const cEmergency = new THREE.PointLight(0xff2a1a, 9, 16, 2);
  cEmergency.position.set(81.5, 5.5, 60);
  scene.add(cEmergency);

  // ---- HUD ミニマップ用の区画
  world.level.rooms = plan.rooms.map((r) => ({
    name: r.name, min: new THREE.Vector3(r.x0, 0, r.z0), max: new THREE.Vector3(r.x1, r.h, r.z1), entered: false, cleared: false,
  }));
  world.level.currentRoom = -1;
  world.level.bossSpawned = false;
  world.level.bossDefeated = false;
  world.level.data.remaining = 0;
  world.level.data.interactNear = false;
  world.level.data.allyArm = true;           // 吸収アームで味方に送電・吸収できる（abilities/absorb.ts）
  world.level.data.retryAt = startAt;

  const state: Camp1State = {
    keys: [], keyDoorOpen: false, hatchOpen: false, cLit: false, crack: 0, wallBroken: false, drained: [], laserOff: false,
    vacuum: false, ally: 'enemy', guiding: false, fights: {}, boss: 'idle', wave2: false, exitOpen: false, exitReached: false,
    checkpoint: startAt, gears: [], lockdown: false,
  };
  world.level.data.camp1 = state;
  world.level.data.gears = 0;

  clearSockets(world);
  clearGrapplePoints(world);
  clearGrabbables(world);
  clearPowerSources(world);

  const want = new Map<string, boolean>();
  for (const g of vis.gates) {
    const open = !g.def.closed;
    g.open = open; g.k = open ? 1 : 0; g.collider.active = !open;
    g.shutter.position.y = open ? g.def.h + 0.1 : 0;
    want.set(g.def.id, open);
  }

  const rt: Runtime = {
    world, plan, vis, state, slots, hemi, fill, beacon, cEmergency, want, alarm: 0, clock: 0, started: false, startAt,
    zones: plan.zones.map((def) => ({ def, enemies: [], wave2: [], boxes: [], boxes2: [], state: 'idle' })),
    walker: null, trail: [], trailT: 0, farT: 0, keyMsgT: 0, laserHitT: 0, promptOn: false, guideShown: false,
    roomSeen: plan.rooms.map(() => false), warned: false, hatchK: 0,
  };
  runtimes.set(world, rt);
  for (const z of rt.zones) state.fights[z.def.id] = 'idle';

  // ---- 送電ソケット：A（床のハッチ）、C（照明）
  const sock = (p: { x: number; y: number; z: number; r: number }, on: (via: 'shot' | 'arm') => boolean) => {
    const s = {
      pos: new THREE.Vector3(p.x, p.y, p.z), radius: p.r, enabled: true,
      onShot: () => { if (on('shot')) s.enabled = false; },
      onFeed: () => {
        if (world.player.energy < 1) { toast(world, 'エネルギーが足りない…', 2.5); world.events.emit('noEnergy', {}); return; }
        drainEnergy(world, 1);
        if (on('arm')) s.enabled = false;
      },
    };
    getSockets(world).push(s);
    return s;
  };
  sock(plan.hatchSocket, () => openHatch(world, rt));
  sock(plan.cSocket, () => lightC(world, rt));

  // ---- 電力源（レーザー網の2つ＋ D の予備バッテリー）
  for (const s of plan.sources) {
    getPowerSources(world).push({
      pos: new THREE.Vector3(s.x, s.y, s.z), radius: s.r, enabled: true, amount: s.laser ? CAMP1.sourceAmount : 40, max: s.laser ? CAMP1.sourceAmount : 40,
      onEmpty: () => sourceEmpty(world, rt, s.id),
    });
  }

  // ---- アームで掴める物（歯車・キー・バキューム）
  for (const g of vis.gears) registerGrabbable(world, { pos: new THREE.Vector3(g.x, g.y, g.z), radius: 1.0, enabled: true, obj: g.group, onGrab: () => takeGear(world, rt, g.id) });
  for (const k of vis.keys) registerGrabbable(world, { pos: new THREE.Vector3(k.x, k.y, k.z), radius: 0.8, enabled: true, obj: k.group, onGrab: () => takeKey(world, rt, k.id) });
  registerGrabbable(world, { pos: new THREE.Vector3(plan.vacuum.x, plan.vacuum.y, plan.vacuum.z), radius: 0.9, enabled: true, obj: vis.vacuum.group, onGrab: () => takeVacuum(world, rt) });

  // ---- グラップルポイント（B の木箱の上：キー①の場所の目印）
  for (const g of plan.grapples) registerGrapplePoint(world, { pos: new THREE.Vector3(g.x, g.y, g.z), normal: new THREE.Vector3(g.nx, 0, g.nz), kind: 'ledge' });

  // ---- リトライ：拾った物・解いた仕掛けを戻す
  if (memo) restoreMemo(world, rt, memo);

  // ---- 開始地点
  const cp = plan.checkpoints[startAt];
  world.player.pos.set(cp.x, 0, cp.z);
  world.player.yaw = cp.yaw;
  world.player.pitch = 0;
  world.player.vel.set(0, 0, 0);
  world.level.data.objective = objective(rt);
}

function restoreMemo(world: World, rt: Runtime, m: Memo): void {
  const { state } = rt;
  for (const id of m.gears) hideGear(world, rt, id);
  state.gears = [...m.gears];
  world.level.data.gears = state.gears.length;
  for (const k of m.keys) hideKey(world, rt, k);
  state.keys = [...m.keys];
  if (state.keys.length >= CAMP1.keysNeeded) { state.keyDoorOpen = true; forceGate(rt, 'key', true); }
  if (m.vacuum) { state.vacuum = true; hidePick(world, rt.vis.vacuum); world.unlocks.vacuum = true; }
  if (m.hatchOpen) openHatch(world, rt, true);
  if (m.cLit) lightC(world, rt, true);
  if (m.wallBroken) breakWall(world, rt, true);
  for (const id of m.drained) { const s = getPowerSources(world)[rt.plan.sources.findIndex((q) => q.id === id)]; if (s) { s.amount = 0; s.enabled = false; } sourceEmpty(world, rt, id, true); }
  state.ally = m.ally;
  // 完了済みの区画は再出現させない。active は敵のHPを保存していないため、再開後に再挑戦する。
  for (const z of rt.zones) {
    const saved = m.fights?.[z.def.id];
    if (saved === 'done') { z.state = 'done'; state.fights[z.def.id] = 'done'; }
    else state.fights[z.def.id] = 'idle';
  }
  if (rt.startAt === 'boss') {
    for (const z of rt.zones) if (z.def.id !== 'D' && z.def.id !== 'boss') { z.state = 'done'; state.fights[z.def.id] = 'done'; }
  }
  // v1 は boss フラグだけを保存していた。撃破済みなら戦闘と出口を必ず復元する。
  if (m.boss || m.fights?.boss === 'done') {
    const boss = rt.zones.find((z) => z.def.id === 'boss');
    if (boss) { boss.state = 'done'; state.fights.boss = 'done'; }
    state.boss = 'done';
    state.wave2 = true;
    state.lockdown = false;
    state.exitOpen = true;
    forceGate(rt, 'hEntry', true);
    forceGate(rt, 'exit', true);
  }
}

function snapshot(rt: Runtime): Memo {
  const s = rt.state;
  return {
    gears: [...s.gears], keys: [...s.keys], vacuum: s.vacuum, ally: s.ally, allyHp: rt.walker?.hp ?? 0,
    hatchOpen: s.hatchOpen, cLit: s.cLit, wallBroken: s.wallBroken, laserOff: s.laserOff, drained: [...s.drained], boss: s.boss === 'done',
    fights: { ...s.fights },
  };
}
/** 拾った・解いた時点で記録を更新する（リトライでも残す） */
function remember(rt: Runtime): void { memo = snapshot(rt); rt.world.level.data.saveDirty = true; }

// ---------------------------------------------------------------- 拾う物
function hidePick(world: World, p: { group: THREE.Object3D; taken: boolean }): void {
  p.taken = true;
  p.group.visible = false;
  for (const gb of getGrabbables(world)) if (gb.obj === p.group) gb.enabled = false;
}
function hideGear(world: World, rt: Runtime, id: string): void {
  const g = rt.vis.gears.find((q) => q.id === id);
  if (g) hidePick(world, g);
}
function hideKey(world: World, rt: Runtime, id: 'B' | 'F'): void {
  const k = rt.vis.keys.find((q) => q.id === id);
  if (k) hidePick(world, k);
}

function takeGear(world: World, rt: Runtime, id: string): void {
  const g = rt.vis.gears.find((q) => q.id === id);
  if (!g || rt.state.gears.includes(id)) return;
  hidePick(world, g);
  rt.state.gears.push(id);
  world.level.data.gears = rt.state.gears.length;
  world.inventory.gears++;
  world.events.emit('gearPickup', {});
  toast(world, `強化素材（歯車）を入手 ×${rt.state.gears.length}`, 3);
  remember(rt);
}

/** セキュリティキーを拾う（触れた／アームで引き寄せた） */
export function pickKey(world: World, id: 'B' | 'F'): void {
  const rt = runtimes.get(world);
  if (rt) takeKey(world, rt, id);
}
function takeKey(world: World, rt: Runtime, id: 'B' | 'F'): void {
  const { state } = rt;
  if (state.keys.includes(id)) return;
  hideKey(world, rt, id);
  state.keys.push(id);
  world.events.emit('gearPickup', {});
  const n = state.keys.length;
  if (n >= CAMP1.keysNeeded) {
    toast(world, `セキュリティキーを入手（${n}/${CAMP1.keysNeeded}）`, 3);
    toast(world, 'キーがそろった！ C の上の青い扉が開く', 4);
    state.keyDoorOpen = true;
    setGate(rt, 'key', true);
  } else {
    toast(world, `セキュリティキーを入手（${n}/${CAMP1.keysNeeded}）`, 3.5);
  }
  remember(rt);
}

function takeVacuum(world: World, rt: Runtime): void {
  if (rt.state.vacuum) return;
  rt.state.vacuum = true;
  hidePick(world, rt.vis.vacuum);
  world.unlocks.vacuum = true;
  world.events.emit('gearPickup', {});
  toast(world, 'バキュームを手に入れた（十字キー下で選んで Y で発動）', 5);
  remember(rt);
}

// ---------------------------------------------------------------- 仕掛け
function openHatch(world: World, rt: Runtime, silent = false): boolean {
  if (rt.state.hatchOpen) return true;
  rt.state.hatchOpen = true;
  const H = rt.plan.hatch;
  rt.vis.hatchSocket.ringMat.color.set(0x4cff8a);
  rt.vis.hatchSocket.lampMat.color.set(0x3dff7a);
  if (!silent) {
    toast(world, '床のハッチが開いた！ 下に通路がある', 3.5);
    world.events.emit('switchOn', { pos: new THREE.Vector3(rt.plan.hatchSocket.x, 1.4, rt.plan.hatchSocket.z) });
    world.events.emit('doorOpen', { pos: new THREE.Vector3((H.x0 + H.x1) / 2, 0, (H.z0 + H.z1) / 2) });
    remember(rt);
  } else rt.hatchK = 1;
  for (const s of getSockets(world)) if (s.pos.distanceTo(new THREE.Vector3(rt.plan.hatchSocket.x, rt.plan.hatchSocket.y, rt.plan.hatchSocket.z)) < 0.1) s.enabled = false;
  return true;
}

/** C に電気を送る（弾・アーム）。明かりがつく */
function lightC(world: World, rt: Runtime, silent = false): boolean {
  if (rt.state.cLit) return true;
  rt.state.cLit = true;
  rt.vis.cSocket.ringMat.color.set(0x4cff8a);
  rt.vis.cSocket.lampMat.color.set(0x3dff7a);
  for (const s of getSockets(world)) if (s.pos.distanceTo(new THREE.Vector3(rt.plan.cSocket.x, rt.plan.cSocket.y, rt.plan.cSocket.z)) < 0.1) s.enabled = false;
  if (!silent) {
    toast(world, 'C の部屋に電気が戻った', 3);
    world.events.emit('switchOn', { pos: new THREE.Vector3(rt.plan.cSocket.x, 1.4, rt.plan.cSocket.z) });
    world.events.emit('powerRestored', { pos: new THREE.Vector3(92, 1, 67) });
    remember(rt);
  }
  return true;
}

function sourceEmpty(world: World, rt: Runtime, id: string, silent = false): void {
  const { state, plan, vis } = rt;
  const def = plan.sources.find((s) => s.id === id);
  const sv = vis.sources.find((s) => s.id === id);
  if (sv) { sv.core.color.set(0x2b3040); sv.ring.visible = false; }
  if (!def) return;
  if (!def.laser) { if (!silent) toast(world, '予備バッテリーの電力を吸い取った', 2.5); return; }
  if (state.drained.includes(id)) return;
  state.drained.push(id);
  const n = state.drained.length, need = plan.sources.filter((s) => s.laser).length;
  if (n >= need) {
    state.laserOff = true;
    vis.laser.group.visible = false;
    vis.laser.collider.active = false;
    for (const m of vis.laser.machineLamps) m.color.set(0x2b3040);
    if (!silent) {
      toast(world, 'レーザー網が消えた！ 斜めの通路の先へ行ける', 4);
      world.events.emit('doorOpen', { pos: new THREE.Vector3(plan.laser.ax, 1.5, plan.laser.az) });
    }
  } else if (!silent) {
    toast(world, `電力源の電気を吸い取った（${n}/${need}）。レーザー網が弱まった`, 3.5);
  }
  if (!silent) remember(rt);
}

/**
 * 脆い壁に弾が当たった。通常弾・溜め撃ちはひびが進むだけ、溜め（charge 0..1）が CAMP1.breakCharge 以上なら壊れる。
 * 戻り値：壊れたら true
 */
export function hitBrittleWall(world: World, charged: boolean, charge: number): boolean {
  const rt = runtimes.get(world);
  if (!rt || rt.state.wallBroken) return false;
  const st = rt.state;
  if (charged && charge >= CAMP1.breakCharge) { breakWall(world, rt); return true; }
  const before = st.crack;
  st.crack = Math.min(CAMP1.crackStages, st.crack + (charged ? CAMP1.crackPerCharged : CAMP1.crackPerShot));
  if (st.crack !== before) world.events.emit('impact', { pos: new THREE.Vector3(rt.plan.brittle.x0, 1.6, 73), owner: 'player' });
  if (st.crack >= CAMP1.crackStages && before < CAMP1.crackStages) toast(world, '壁がもろくなっている…思い切り溜めて撃てば壊せそうだ', 3.5);
  else if (before === 0) toast(world, '壁にひびが入った', 2);
  return false;
}

function breakWall(world: World, rt: Runtime, silent = false): void {
  const st = rt.state;
  if (st.wallBroken) return;
  st.wallBroken = true;
  st.crack = CAMP1.crackStages;
  const v = rt.vis.brittle;
  v.mesh.visible = false;
  v.collider.active = false;
  for (const c of v.cracks) c.visible = false;
  v.debris.visible = true;
  if (!silent) {
    const B = rt.plan.brittle;
    const p = new THREE.Vector3(B.x0, 1.8, (B.z0 + B.z1) / 2);
    spawnBurst(world, p, 0xd8c8b0, 30, 7, 0.8);
    spawnBurst(world, p, 0xffb050, 16, 9, 0.4);
    world.events.emit('explosion', { pos: p, radius: 3 });
    toast(world, '壁が崩れた！ 奥に隠し部屋がある', 3.5);
    remember(rt);
  }
}

// ---------------------------------------------------------------- 敵
function spawnOne(world: World, rt: Runtime, z: ZoneDef, s: SpawnDef, trap: boolean): Enemy | null {
  const r = ENEMIES[s.kind].radius;
  const fl = s.floor ?? 0;
  const air = s.kind === 'drone' || s.kind === 'leech';
  const y = air ? fl + (s.kind === 'drone' ? 3.2 : 1.2) : fl + r + 0.1;
  try {
    const mode = s.mode ?? (s.kind === 'drone' ? 'drop' : 'box');
    if (mode === 'box') return null; // 箱は spawnZones で作る
    const yaw = Math.atan2(z.face.x - s.x, z.face.z - s.z);
    if (mode === 'awake') {
      const e = spawnEnemy(world, s.kind, new THREE.Vector3(s.x, y, s.z));
      e.ai.yaw = yaw;
      return e;
    }
    return spawnEnemy(world, s.kind, new THREE.Vector3(s.x, y, s.z), { dormant: mode, yaw, ...(trap ? { wakeRadius: 0 } : {}) });
  } catch (err) {
    if (!rt.warned) { rt.warned = true; console.warn('[camp1] spawnEnemy failed', err); }
    return null;
  }
}
const alive = (list: Enemy[]): number => list.filter((e) => !e.allied && (e.status === 'active' || e.status === 'stunned')).length;
/** 区画の生きている敵（まだ開いていない箱の中身も数える） */
const zoneAlive = (z: ZoneRT, wave: 1 | 2 = 1): number => (wave === 1 ? alive(z.enemies) + spawnBoxAlive(z.boxes) : alive(z.wave2) + spawnBoxAlive(z.boxes2));
/** 箱に入れる敵か（指定なしの地上の敵。ドローンは天井から、リーチは最初から飛んでいる） */
const inBox = (s: SpawnDef): boolean => (s.mode ?? (s.kind === 'drone' ? 'drop' : 'box')) === 'box';
const yaw90 = (z: ZoneDef, s: SpawnDef): number => Math.round(Math.atan2(z.face.x - s.x, z.face.z - s.z) / (Math.PI / 2)) * (Math.PI / 2);

function spawnZones(world: World, rt: Runtime): void {
  for (const z of rt.zones) {
    if (z.state === 'done') continue;
    const trap = z.def.mode === 'trap';
    z.enemies = z.def.spawns.filter((s) => !inBox(s)).map((s) => spawnOne(world, rt, z.def, s, trap)).filter((e): e is Enemy => !!e);
    z.wave2 = (z.def.wave2 ?? []).filter((s) => !inBox(s)).map((s) => spawnOne(world, rt, z.def, s, true)).filter((e): e is Enemy => !!e);
    // 箱に隠れている敵：近づくと開く（閉じ込め戦は 0＝トリガーでだけ開く）。2波目はコンテナから
    z.boxes = createSpawnBoxes(world, z.def.spawns.filter(inBox).map((s) => ({ kind: s.kind, x: s.x, z: s.z, floor: s.floor, yaw: yaw90(z.def, s), ...(trap ? { wakeRadius: 0 } : {}) })));
    z.boxes2 = createSpawnBoxes(world, (z.def.wave2 ?? []).filter(inBox).map((s) => ({ kind: s.kind, x: s.x, z: s.z, floor: s.floor, yaw: yaw90(z.def, s), wakeRadius: 0, style: 'container' as const })));
  }
  // 赤ウォーカー（A）。倒されていたら出さない。仲間だったら、仲間のままプレイヤーのそばに
  const st = rt.state;
  if (st.ally === 'dead') return;
  const at = st.ally === 'ally'
    ? new THREE.Vector3(rt.plan.checkpoints[rt.startAt].x + 2, ENEMIES.redWalker.radius + 0.1, rt.plan.checkpoints[rt.startAt].z + 2)
    : new THREE.Vector3(rt.plan.redWalker.x, ENEMIES.redWalker.radius + 0.1, rt.plan.redWalker.z);
  try {
    const e = spawnEnemy(world, 'redWalker', at);
    e.ai.yaw = Math.PI;
    if (st.ally === 'ally') {
      e.allied = true;
      e.ai.allyT = e.ai.allyMax = HACK.allyTime;
      e.ai.allyPermanent = true;
      if (memo && memo.allyHp > 0) e.hp = Math.min(e.maxHp, memo.allyHp);
    }
    rt.walker = e;
  } catch (err) {
    console.warn('[camp1] redWalker spawn failed', err);
  }
}

function wakeAll(world: World, list: Enemy[], gap: number): void { list.forEach((e, i) => wakeDormant(world, e, i * gap)); }

function updateZones(world: World, rt: Runtime): void {
  const st = rt.state;
  let fightChanged = false;
  for (const z of rt.zones) {
    if (z.def.mode !== 'zone' || z.state === 'done') continue;
    // 1体でも目覚めた／箱が1つでも開き始めたら、区画の全員が出てくる
    if (z.state === 'idle' && (z.enemies.some((e) => !e.ai.dormant && e.status !== 'dead') || z.boxes.some((b) => b.state !== 'closed'))) {
      z.state = 'active';
      st.fights[z.def.id] = 'active';
      fightChanged = true;
      wakeAll(world, z.enemies, 0.12);
      openSpawnBoxes(world, z.boxes, 0.2);
    }
    if ((z.enemies.length || z.boxes.length) && zoneAlive(z) === 0) {
      z.state = 'done'; st.fights[z.def.id] = 'done'; fightChanged = true;
    }
  }
  // ---- 中ボス戦（H）：入ると扉が閉まり、敵が一斉に目覚める。1つ目の波が減ると2つ目の波
  const boss = rt.zones.find((z) => z.def.id === 'boss')!;
  const p = world.player.pos;
  const T = rt.plan.bossTrigger;
  if (st.boss === 'idle' && p.x > T.x0 && p.x < T.x1 && p.z > T.z0 && p.z < T.z1 && p.y < 6) {
    st.boss = 'active';
    boss.state = 'active';
    st.fights.boss = 'active';
    fightChanged = true;
    setGate(rt, 'hEntry', false);
    wakeAll(world, boss.enemies, 0.15);
    openSpawnBoxes(world, boss.boxes, 0.15);
    st.lockdown = true;
    world.events.emit('zoneWave', { wave: 1 });
    world.events.emit('lockdownStart', { zone: 'boss' });
    toast(world, '扉が閉まった！ ビーマーが2体いる！', 4);
  }
  if (st.boss === 'active') {
    if (!st.wave2 && zoneAlive(boss) <= CAMP1.bossWave2At) {
      st.wave2 = true;
      wakeAll(world, boss.wave2, 0.25);
      openSpawnBoxes(world, boss.boxes2, 0.3);
      world.events.emit('zoneWave', { wave: 2 });
      toast(world, '増援だ！', 2.5);
    }
    if (st.wave2 && zoneAlive(boss) === 0 && zoneAlive(boss, 2) === 0) {
      st.boss = 'done';
      boss.state = 'done';
      st.fights.boss = 'done';
      st.lockdown = false;
      st.exitOpen = true;
      setGate(rt, 'hEntry', true);
      setGate(rt, 'exit', true);
      world.events.emit('lockdownEnd', { zone: 'boss' });
      toast(world, '全滅させた！ H の右上の、2階への出口が開いた', 4.5);
      fightChanged = true;
    }
  }
  if (fightChanged) remember(rt);
}

// ---------------------------------------------------------------- 赤ウォーカー（仲間）
function updateAlly(world: World, rt: Runtime, dt: number): void {
  const st = rt.state;
  const e = rt.walker;
  if (!e || st.ally === 'dead') return;
  const gone = !world.enemies.includes(e) || e.status === 'down' || e.status === 'dead';
  if (gone) {
    if (st.ally === 'ally') toast(world, '仲間の赤ウォーカーが倒れてしまった…', 3.5);
    st.ally = 'dead';
    st.guiding = false;
    rt.walker = null;
    remember(rt);
    return;
  }
  if (!e.allied) return;
  if (st.ally !== 'ally') {
    st.ally = 'ally';
    toast(world, '赤ウォーカーが仲間になった！ 後ろをついてくる', 4);
    toast(world, '仲間にアームをつないで F で送電すると回復できる', 4);
    remember(rt);
  }
  // 時間切れで元に戻らない
  e.ai.allyPermanent = true;
  e.ai.allyMax = e.ai.allyMax ?? HACK.allyTime;
  e.ai.allyT = e.ai.allyMax;

  // G：隠し通路の入口の下まで歩いて案内する
  const p = world.player.pos;
  const G = rt.plan.guide.room;
  const inG = (x: number, z: number) => x > G.x0 && x < G.x1 && z > G.z0 && z < G.z1;
  const guide = inG(p.x, p.z) && p.y < 5;
  if (guide) {
    e.ai.guideTo = { x: rt.plan.guide.x, z: rt.plan.guide.z, arrive: CAMP1.guideArrive };
    if (!st.guiding) {
      st.guiding = true;
      if (!rt.guideShown) {
        rt.guideShown = true;
        toast(world, '赤ウォーカーが何かを知らせている…東の壁の上のほうを見てみよう', 4.5);
      }
    }
  } else {
    e.ai.guideTo = undefined;
    st.guiding = false;
  }

  // はぐれた（隠し通路を抜けた・高い所へ行った）：しばらく離れたままなら、プレイヤーの足跡の少し後ろへワープ
  rt.trailT -= dt;
  if (rt.trailT <= 0 && world.player.onGround) {
    rt.trailT = 0.5;
    rt.trail.push(p.clone());
    if (rt.trail.length > 12) rt.trail.shift();
  }
  const d = e.pos.distanceTo(p);
  if (d > 28 && !guide) rt.farT += dt; else rt.farT = 0;
  if (rt.farT > 3 && rt.trail.length >= 4) {
    const to = rt.trail[rt.trail.length - 4];
    if (to.distanceTo(p) < 12 && Math.abs(to.y - p.y) < 1.5) {
      e.pos.set(to.x, to.y + e.radius + 0.1, to.z);
      e.vel.set(0, 0, 0);
      e.root.position.copy(e.pos);
      spawnBurst(world, e.pos, 0x66e6ff, 12, 3, 0.4);
      rt.farT = 0;
    }
  }
}

// ---------------------------------------------------------------- シャッター
function setGate(rt: Runtime, id: string, open: boolean): void { rt.want.set(id, open); }
function forceGate(rt: Runtime, id: string, open: boolean): void {
  const g = rt.vis.gates.find((q) => q.def.id === id);
  if (!g) return;
  rt.want.set(id, open);
  g.open = open; g.k = open ? 1 : 0; g.collider.active = !open;
  g.shutter.position.y = open ? g.def.h + 0.1 : 0;
}
function gateBlocked(world: World, g: GateVis): boolean {
  const d = g.def, m = 0.8;
  const p = world.player.pos;
  if (p.x > d.x0 - m && p.x < d.x1 + m && p.z > d.z0 - m && p.z < d.z1 + m && p.y < d.h) return true;
  for (const e of world.enemies) {
    if (e.status === 'dead') continue;
    const r = e.radius + 0.5;
    if (e.pos.x > d.x0 - r && e.pos.x < d.x1 + r && e.pos.z > d.z0 - r && e.pos.z < d.z1 + r && e.pos.y < d.h) return true;
  }
  return false;
}
function updateGates(world: World, rt: Runtime, dt: number, t: number): void {
  for (const g of rt.vis.gates) {
    const want = rt.want.get(g.def.id) ?? g.open;
    if (want && !g.open) { g.open = true; world.events.emit('doorOpen', { pos: new THREE.Vector3(g.cx, 1.5, g.cz) }); }
    else if (!want && g.open && !gateBlocked(world, g)) { g.open = false; g.collider.active = true; world.events.emit('doorClose', { pos: new THREE.Vector3(g.cx, 1.5, g.cz) }); }
    g.k = Math.max(0, Math.min(1, g.k + ((g.open ? 1 : -1) * dt) / 0.9));
    if (g.open && g.k > 0.85) g.collider.active = false;
    g.shutter.position.y = g.k * (g.def.h + 0.1);
    const blink = !g.open && rt.state.lockdown ? (Math.sin(t * 12) > 0 ? 1 : 0.3) : 1;
    g.lampMat.color.set(g.open ? 0x3dff7a : g.def.id === 'key' ? 0x3a7dff : 0xff2a2a).multiplyScalar(blink);
  }
}

// ---------------------------------------------------------------- 照明
const RED = new THREE.Color();
function updateLamps(rt: Runtime, pp: THREE.Vector3, dt: number, t: number): void {
  const lamps = rt.plan.lamps;
  const lit = (i: number) => lamps[i].room !== 'C' || rt.state.cLit;
  const cand: { i: number; d: number }[] = [];
  lamps.forEach((l, i) => {
    if (!lit(i)) return;
    const d = (l.x - pp.x) ** 2 + (l.z - pp.z) ** 2 + (l.y - pp.y - 1) ** 2 * 2;
    if (d < 40 * 40) cand.push({ i, d });
  });
  cand.sort((a, b) => a.d - b.d);
  const top = cand.slice(0, rt.slots.length).map((c) => c.i);
  const snap = t < dt * 2.5;
  for (const sl of rt.slots) {
    const keep = sl.lamp >= 0 && top.includes(sl.lamp);
    const goal = keep ? 1 : 0;
    sl.cur = snap ? goal : sl.cur + (goal - sl.cur) * Math.min(1, dt * (goal > sl.cur ? 5 : 3.5));
    if (!keep && sl.cur < 0.02) { sl.cur = 0; sl.lamp = -1; }
  }
  for (const li of top) {
    if (rt.slots.some((s) => s.lamp === li)) continue;
    const free = rt.slots.find((s) => s.lamp < 0);
    if (!free) break;
    free.lamp = li;
    free.cur = snap ? 1 : 0;
    const l = lamps[li];
    free.light.position.set(l.x, l.y, l.z);
    free.light.distance = Math.max(14, l.y * 2.6);
  }
  for (const sl of rt.slots) {
    if (sl.lamp < 0) { sl.light.intensity = 0; continue; }
    const l = lamps[sl.lamp];
    sl.light.color.set(l.color).lerp(RED, rt.alarm * 0.8);
    sl.light.intensity = 3.2 * l.y * l.y * 0.55 * l.power * sl.cur;
  }
}

// ---------------------------------------------------------------- 更新
const _p1 = new THREE.Vector3();
const HEMI_SKY = new THREE.Color(0x5a6680), HEMI_GND = new THREE.Color(0x1e232c);

export function updateCamp1(world: World, dt: number): void {
  const rt = runtimes.get(world);
  if (!rt) return;
  const { plan, vis, state } = rt;
  const p = world.player;
  rt.clock += dt;
  const t = rt.clock;

  if (!rt.started) {
    rt.started = true;
    spawnZones(world, rt);
    if (rt.startAt === 'entrance' && !memo) toast(world, 'サージ収容所 1階に潜入した', 3.5);
    else toast(world, rt.startAt === 'boss' ? '中ボス戦の前から再開' : '入口から再開', 2.5);
  }

  // ---- 警報照明（閉じ込め戦）
  const wantAlarm = LOCKDOWN.enabled && state.lockdown ? 1 : 0;
  rt.alarm += (wantAlarm - rt.alarm) * Math.min(1, dt * (wantAlarm > rt.alarm ? 6 : 2.5));
  RED.set(LOCKDOWN.light);
  rt.hemi.color.copy(HEMI_SKY).lerp(RED, rt.alarm * 0.7);
  rt.hemi.groundColor.copy(HEMI_GND).lerp(RED, rt.alarm * 0.4);
  rt.beacon.intensity = rt.alarm * (40 + 50 * Math.max(0, Math.sin(t * 5.5)));
  updateLamps(rt, p.pos, dt, t);
  rt.fill.position.set(p.pos.x, p.pos.y + 2.6, p.pos.z);

  // ---- C の明かり：電気が来るまで暗い（非常灯だけ）
  vis.glowC.color.setScalar(state.cLit ? 1.4 : 0.06 + 0.04 * Math.max(0, Math.sin(t * 2.3)));
  rt.cEmergency.intensity = state.cLit ? 0 : 7 + 3 * Math.sin(t * 3.1);
  if (!state.cLit) vis.cSocket.ringMat.color.set(0x52e8ff).multiplyScalar(1.2 + 0.6 * Math.sin(t * 5));
  if (!state.hatchOpen) vis.hatchSocket.ringMat.color.set(0x52e8ff).multiplyScalar(1.2 + 0.6 * Math.sin(t * 5));

  // ---- 区画の入退室
  let cur = -1;
  plan.rooms.forEach((r, i) => { if (p.pos.x > r.x0 && p.pos.x < r.x1 && p.pos.z > r.z0 && p.pos.z < r.z1 && p.pos.y > -1) cur = i; });
  if (cur >= 0) {
    world.level.currentRoom = cur;
    if (!rt.roomSeen[cur]) {
      rt.roomSeen[cur] = true;
      world.level.rooms[cur].entered = true;
      world.events.emit('roomEnter', { index: cur, name: plan.rooms[cur].name });
    }
  }

  updateSpawnBoxes(world, dt);
  updateZones(world, rt);
  updateGates(world, rt, dt, t);
  updateAlly(world, rt, dt);
  plan.rooms.forEach((r, i) => {
    const z = rt.zones.find((q) => q.def.id === r.id || (r.id === 'H' && q.def.id === 'boss'));
    world.level.rooms[i].cleared = z ? z.state === 'done' : true;
  });

  // ---- チェックポイント：D に入ったら（中ボス戦の前）
  const cpB = plan.rooms.find((r) => r.id === 'D')!;
  if (state.checkpoint !== 'boss' && p.pos.x > cpB.x0 && p.pos.x < cpB.x1 && p.pos.z > cpB.z0 && p.pos.z < cpB.z1 && p.pos.y < 3 && p.hp > 0) {
    state.checkpoint = 'boss';
    world.level.data.retryAt = 'boss';
    remember(rt);
    toast(world, 'チェックポイント（やられたらここから再開）', 3);
  }
  vis.checkpoints.boss.opacity = state.checkpoint === 'boss' ? 0.6 : 0.25;

  // ---- 床のハッチ
  rt.hatchK = Math.min(1, rt.hatchK + (state.hatchOpen ? dt / CAMP1.hatchTime : 0));
  {
    const k = rt.hatchK * rt.hatchK * (3 - 2 * rt.hatchK);
    vis.hatch.left.rotation.z = k * 1.7;
    vis.hatch.right.rotation.z = -k * 1.7;
    vis.hatch.collider.active = rt.hatchK < 0.5;
  }

  // ---- 脆い壁：近づいてくる自分の弾を先に見つけて、当たりを処理する（通常の弾の処理より先に）
  if (!state.wallBroken) {
    const B = vis.brittle.collider;
    const maxDmg = gunChargeMaxDamage(world);
    for (const q of world.projectiles) {
      if (q.dead || q.owner !== 'player') continue;
      _p1.copy(q.pos).addScaledVector(q.vel, dt * 1.5);
      const hit = segmentAABB(q.pos, _p1, { min: B.min.clone().subScalar(q.radius), max: B.max.clone().addScalar(q.radius), active: true });
      if (hit === null) continue;
      q.dead = true;
      const hp = q.pos.clone().lerp(_p1, hit);
      spawnBurst(world, hp, 0xd8c8b0, q.charged ? 14 : 6, q.charged ? 4 : 2.5);
      const charge = q.charged ? Math.max(0, Math.min(1, (q.damage - chargeDamage(0, maxDmg)) / Math.max(1e-6, chargeDamage(1, maxDmg) - chargeDamage(0, maxDmg)))) : 0;
      hitBrittleWall(world, !!q.charged, charge);
      if (state.wallBroken) break;
    }
    vis.brittle.cracks.forEach((c, i) => { c.visible = state.crack > i; });
    vis.brittle.glow.opacity = state.crack >= CAMP1.crackStages ? 0.5 + 0.4 * Math.sin(t * 6) : 0;
  }

  // ---- レーザー網：触れると痛い
  if (!state.laserOff) {
    const L = plan.laser.box, m = 0.35;
    rt.laserHitT -= dt;
    if (p.pos.x > L.x0 - m && p.pos.x < L.x1 + m && p.pos.z > L.z0 - m && p.pos.z < L.z1 + m && p.pos.y < L.y1 && rt.laserHitT <= 0) {
      rt.laserHitT = CAMP1.laserInterval;
      damagePlayer(world, CAMP1.laserDamage);
      spawnBurst(world, p.pos.clone().setY(p.pos.y + 1), 0xff4020, 8, 4, 0.3);
    }
    vis.laser.beamMat.opacity = (0.55 + 0.3 * Math.sin(t * 20)) * (state.drained.length ? 0.6 : 1);
  }
  for (const s of vis.sources) if (s.ring.visible) s.ring.rotation.z = t * 2;

  // ---- 拾う物（触れる）
  const near = (x: number, y: number, z: number, r = 1.5) => (x - p.pos.x) ** 2 + (z - p.pos.z) ** 2 < r * r && Math.abs(y - (p.pos.y + 0.9)) < 1.8 && p.hp > 0;
  for (const g of vis.gears) { if (g.taken) continue; g.model.tick(t + g.x); if (near(g.x, g.y, g.z)) takeGear(world, rt, g.id); }
  for (const k of vis.keys) {
    if (k.taken) continue;
    k.group.rotation.y = t * 2;
    k.group.position.y = k.y + Math.sin(t * 2.4 + k.x) * 0.12;
    if (near(k.x, k.y, k.z)) takeKey(world, rt, k.id);
  }
  if (!vis.vacuum.taken) {
    vis.vacuum.group.rotation.y = t * 1.5;
    vis.vacuum.group.position.y = vis.vacuum.y + Math.sin(t * 2) * 0.15;
    if (near(vis.vacuum.x, vis.vacuum.y, vis.vacuum.z)) takeVacuum(world, rt);
  }

  // ---- キー扉：足りないときは近づくと「キーが必要（n/2）」
  rt.keyMsgT -= dt;
  const kd = plan.keyDoor;
  const nearKeyDoor = !state.keyDoorOpen && Math.hypot(p.pos.x - kd.x, p.pos.z - kd.z) < 4.5 && p.pos.y < 3;
  if (nearKeyDoor && rt.keyMsgT <= 0) {
    rt.keyMsgT = 6;
    toast(world, `キーが必要（${state.keys.length}/${CAMP1.keysNeeded}）`, 3);
    world.events.emit('elevatorLocked', { pos: new THREE.Vector3(kd.x, 1, kd.z) });
  }

  // ---- 2階への出口
  const X = plan.exit;
  if (state.exitOpen && !state.exitReached && p.pos.x > X.x0 && p.pos.x < X.x1 && p.pos.z < X.z1 - 0.5 && p.pos.z > X.z0) {
    state.exitReached = true;
    world.level.data.nextLevel = { level: 'camp2' };
  }

  // ---- 操作のヒント
  let hint: string | null = null;
  const hs = plan.hatchSocket, cs = plan.cSocket;
  if (!state.hatchOpen && Math.hypot(p.pos.x - hs.x, p.pos.z - hs.z) < 5 && p.pos.y > -1) hint = 'アームで電気を送る／撃つ（床のハッチ）';
  else if (!state.cLit && Math.hypot(p.pos.x - cs.x, p.pos.z - cs.z) < 5 && p.pos.y > -1) hint = '撃つ／アームで電気を送る（C の明かり）';
  else if (nearKeyDoor) hint = `セキュリティキーが必要（${state.keys.length}/${CAMP1.keysNeeded}）`;
  if (hint) {
    showPrompt(hint);
    if (!rt.promptOn) world.events.emit('interactPrompt', {});
    rt.promptOn = true;
  } else if (rt.promptOn) { showPrompt(null); rt.promptOn = false; }

  let remaining = 0;
  for (const z of rt.zones) if (z.state === 'active') remaining += zoneAlive(z) + (z.def.id === 'boss' ? zoneAlive(z, 2) : 0);
  world.level.data.remaining = remaining;
  world.level.data.objective = objective(rt);
}

function objective(rt: Runtime): string {
  const s = rt.state;
  if (s.exitReached) return '2階へ';
  if (s.exitOpen) return 'H の右上の出口から2階へ';
  if (s.boss === 'active') { const b = rt.zones.find((z) => z.def.id === 'boss')!; return `敵を全滅させろ（残り${zoneAlive(b) + zoneAlive(b, 2)}）`; }
  if (s.checkpoint === 'boss') return '北の大ホール（H）へ進め';
  if (s.keys.length < CAMP1.keysNeeded) return `セキュリティキーを探せ（${s.keys.length}/${CAMP1.keysNeeded}）：B と F のどこか高い所`;
  return 'C の上の青い扉から北へ進め';
}
