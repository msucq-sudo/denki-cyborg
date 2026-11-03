// ドレイン装置へ向かうダンジョン（?level=drain。&start=bTop|rope|dFront|eWest|goal でチェックポイントから）。
// 暗い施設。機械・ポンプ・配管・タンクが壁際に並び、配管とケーブルが目的地 G の部屋へ集まる。
//
// ルート1（正規）：G の扉（E の西端）はセキュリティ装置3つ（I・D 地下・F）を止めると開く。
//  - C→I：C の北の壁の「壊せるブロック」を溜め撃ちで壊す（camp1 の脆い壁と同じ仕組み）→ I にセキュリティ装置
//  - D：入ると扉が閉まって戦闘（全滅で開く）。D の地下への階段の上にブロック（溜め撃ちで壊す）→ 地下にセキュリティ装置
//  - D の北の縦通路 → E の西半分。E の中央にはレーザー（x=86）。主電源は E の南の壁の外の小部屋にあり、ブロックを壊すと見える
//  - 主電源を止める（弾・アームの電撃／吸収アームで吸い尽くす）とレーザーが消え、東端の暗い狭い通路から F へ。F にセキュリティ装置
//  - 装置は「止める」＝壊す（弾・アームの電撃）か電力を吸い尽くす。3つ止めたら E→G の扉が開く
// ルート2（近道）：A→吹き抜け→B→綱渡り→G。ジェットパックとグラップルで動く足場を渡って上る。ドローンが次々来る。
//  B は入ると扉が閉まって戦闘。綱渡りの上のほうに隠し通路（ダクト）もある。落ちたら即死（You are dead）。
// G：ドレイン装置の部屋への扉がある（中身は未実装。調べると準備中のメッセージ）。
// A の地下にはホログラムデコイ（abilities/decoy.ts）。
import * as THREE from 'three';
import { CAMP1, ENEMIES, LOCKDOWN } from '../config/balance';
import type { Enemy, World } from '../core/types';
import { drainEnergy } from '../core/energy';
import { clearSockets, getSockets } from '../core/sockets';
import { clearGrapplePoints, registerGrapplePoint } from '../core/grapple';
import { clearGrabbables } from '../core/armGrab';
import { clearPowerSources, getPowerSources } from '../core/powerSources';
import { damagePlayer, toast } from '../core/combat';
import { segmentAABB } from '../core/collision';
import { spawnBurst } from '../core/effects';
import { spawnEnemy } from '../enemies/api';
import { wakeDormant } from '../enemies/dormant';
import { chargeDamage } from '../player/logic';
import { gunChargeMaxDamage } from '../progression/effects';
import { giveDecoy } from '../abilities/decoy';
import { showPrompt } from './floor1';
import { setDrainBossArrival } from './drainBoss';
import { generateDrain, B_Y, PLATFORM_THICK, type Plan, type SpawnDef, type ZoneDef } from './drain/plan';
import { buildDrainVisuals, type DeviceVis, type DrainVisuals, type GateVis } from './drain/visuals';

export const DRAIN_EXPOSURE = 1.15;

export type DrainStart = 'entrance' | 'bTop' | 'rope' | 'dFront' | 'eWest' | 'goal';
export const DRAIN_STARTS: DrainStart[] = ['entrance', 'bTop', 'rope', 'dFront', 'eWest', 'goal'];
type Fight = 'idle' | 'active' | 'done';
type SecId = 'I' | 'D' | 'F';

export const DRAIN = {
  /** セキュリティ装置・主電源の電力（吸収アームで吸い尽くす量） */
  deviceAmount: 14,
  /** 落ちたら死ぬ（ステージの外へ出る）高さ */
  voidY: -9,
  /** レーザー */
  laserDamage: CAMP1.laserDamage,
  laserInterval: CAMP1.laserInterval,
  /** 吹き抜けのドローン湧き：プレイヤーからの距離 */
  spawnMin: 9,
  spawnMax: 20,
  /** 動く足場に乗っていると運ぶ */
  carryMargin: 0.25,
};

export interface DrainState {
  /** 止めたセキュリティ装置 */
  secs: SecId[];
  gDoorOpen: boolean;
  mainOff: boolean;
  laserOff: boolean;
  /** 壊したブロック */
  broken: string[];
  crack: Record<string, number>;
  fights: Record<string, Fight>;
  checkpoint: DrainStart;
  lockdown: boolean;
  /** 落下などで死んだ */
  fell: boolean;
  doorChecks: number;
  /** ドレイン装置の部屋への扉：トロッコ面をクリア済み */
  minecartDone: boolean;
  /** 再度調べたときにトロッコをやり直す確認の期限（world.time） */
  minecartAskUntil: number;
}

interface ZoneRT { def: ZoneDef; enemies: Enemy[]; state: Fight }
interface Slot { light: THREE.PointLight; lamp: number; cur: number }

interface Runtime {
  world: World;
  plan: Plan;
  vis: DrainVisuals;
  state: DrainState;
  zones: ZoneRT[];
  slots: Slot[];
  hemi: THREE.HemisphereLight;
  fill: THREE.PointLight;
  beacon: THREE.PointLight;
  want: Map<string, boolean>;
  alarm: number;
  clock: number;
  started: boolean;
  startAt: DrainStart;
  laserHitT: number;
  roomSeen: boolean[];
  promptOn: boolean;
  warned: boolean;
  spawnT: number;
  shaftDrones: Enemy[];
  hintT: Record<string, number>;
  sources: Map<string, { enabled: boolean; amount: number }>;
}
const runtimes = new WeakMap<World, Runtime>();

// ---------------------------------------------------------------- 記録（リトライ・セーブ）
interface Memo { secs: SecId[]; mainOff: boolean; broken: string[]; fights: Record<string, Fight>; minecart?: boolean }
let memo: Memo | null = null;
const MEMO_BREAK_IDS = new Set(['iWall', 'dBlock', 'eBlock']);
const MEMO_FIGHT_IDS = new Set(['A', 'C', 'I', 'D', 'dbase', 'Ew', 'Ee', 'F', 'B', 'shaft', 'rope']);
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** セーブ用：今の記録 */
export function getDrainMemo(): Memo | null { return memo ? JSON.parse(JSON.stringify(memo)) as Memo : null; }
/** つづきから：セーブの記録を戻す（buildDrain より前に呼ぶ）。壊れた形は捨てる */
export function setDrainMemo(m: unknown): void {
  memo = null;
  if (!isRecord(m)) return;
  const secs = m.secs, broken = m.broken, fights = m.fights;
  if (!Array.isArray(secs) || !secs.every((s) => s === 'I' || s === 'D' || s === 'F')) return;
  if (!Array.isArray(broken) || !broken.every((b) => typeof b === 'string' && MEMO_BREAK_IDS.has(b))) return;
  if (typeof m.mainOff !== 'boolean') return;
  const f: Record<string, Fight> = {};
  if (fights !== undefined) {
    if (!isRecord(fights)) return;
    for (const [id, st] of Object.entries(fights)) {
      if (!MEMO_FIGHT_IDS.has(id) || (st !== 'idle' && st !== 'active' && st !== 'done')) return;
      f[id] = st;
    }
  }
  memo = { secs: [...new Set(secs)] as SecId[], mainOff: m.mainOff, broken: [...new Set(broken)] as string[], fights: f, minecart: m.minecart === true };
}

/** トロッコ面をクリアした（main.ts から呼ぶ）。初回だけ歯車を報酬に渡す */
export function completeDrainMinecart(world: World, metal: number, gears: number): void {
  const rt = runtimes.get(world);
  if (!rt) return;
  const first = !rt.state.minecartDone;
  rt.state.minecartDone = true;
  if (first) {
    if (gears > 0) world.inventory.gears += gears;
    if (metal > 0) { world.inventory.metal += metal; world.events.emit('metalPickup', { amount: metal, total: world.inventory.metal }); }
    if (gears > 0) world.events.emit('gearPickup', {});
  }
  const got = first ? `（メタル +${metal}${gears > 0 ? `・歯車 +${gears}` : ''}）` : '';
  // 続きは新しいステージ（通路 → 自動ドア → ボスの部屋）。暗転してから main.ts が作り直す
  setDrainBossArrival(`トロッコ面クリア！ドレイン装置の部屋への通路に着いた${got}`);
  world.level.data.nextLevel = { level: 'drainBoss', startAt: 'corridor' };
  remember(rt);
}

export function getDrain(world: World): { plan: Plan; state: DrainState; vis: DrainVisuals } | null {
  const rt = runtimes.get(world);
  return rt ? { plan: rt.plan, state: rt.state, vis: rt.vis } : null;
}

const alive = (list: Enemy[]): number => list.filter((e) => !e.allied && !e.ai.neutral && (e.status === 'active' || e.status === 'stunned')).length;

// ---------------------------------------------------------------- 構築
export function buildDrain(world: World): void {
  showPrompt(null);
  const given = world.level.data.startAt as string | undefined;
  const startAt: DrainStart = DRAIN_STARTS.includes(given as DrainStart) ? (given as DrainStart) : 'entrance';
  if (!given) memo = null;
  const plan = generateDrain();
  const vis = buildDrainVisuals(plan);
  const scene = world.scene;
  scene.add(vis.root);
  for (const c of vis.colliders) world.colliders.push(c);

  // ---- 照明：とても暗い施設。天井灯の実ライトはプレイヤーの近くに割り当てる
  scene.background = new THREE.Color(0x040508);
  scene.fog = new THREE.FogExp2(0x050609, 0.016);
  const hemi = new THREE.HemisphereLight(0x3a4660, 0x12151b, 0.9);
  scene.add(hemi);
  const slots: Slot[] = [];
  for (let i = 0; i < 8; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 24, 2);
    scene.add(l);
    slots.push({ light: l, lamp: -1, cur: 0 });
  }
  const fill = new THREE.PointLight(0x8aa8e0, 4.5, 11, 2);
  scene.add(fill);
  const beacon = new THREE.PointLight(LOCKDOWN.light, 0, 30, 2);
  scene.add(beacon);

  world.level.rooms = plan.rooms.map((r) => ({
    name: r.name, min: new THREE.Vector3(r.x0, r.y0, r.z0), max: new THREE.Vector3(r.x1, r.y1, r.z1), entered: false, cleared: false,
  }));
  world.level.currentRoom = -1;
  world.level.bossSpawned = false;
  world.level.bossDefeated = false;
  world.level.data.remaining = 0;
  world.level.data.interactNear = false;
  world.level.data.allyArm = true;           // 吸収アームで味方に送電・吸収できる（赤メディックをハッキングしたとき）
  world.level.data.retryAt = startAt;

  const state: DrainState = {
    secs: [], gDoorOpen: false, mainOff: false, laserOff: false, broken: [], crack: {}, fights: {},
    checkpoint: startAt, lockdown: false, fell: false, doorChecks: 0, minecartDone: false, minecartAskUntil: 0,
  };
  world.level.data.drain = state;

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
    world, plan, vis, state, slots, hemi, fill, beacon, want, alarm: 0, clock: 0, started: false, startAt, laserHitT: 0,
    zones: plan.zones.map((def) => ({ def, enemies: [], state: 'idle' })),
    roomSeen: plan.rooms.map(() => false), promptOn: false, warned: false, spawnT: 3, shaftDrones: [], hintT: {},
    sources: new Map(),
  };
  runtimes.set(world, rt);
  for (const z of rt.zones) state.fights[z.def.id] = 'idle';

  // ---- 電力源＋ソケット（セキュリティ装置3つと主電源）：吸い尽くす／弾・アームで壊す、のどちらでも止まる
  const device = (id: string, dv: DeviceVis, p: { x: number; y: number; z: number; r: number }, stop: (how: 'absorb' | 'shot' | 'arm') => void): void => {
    const pos = new THREE.Vector3(p.x, p.y, p.z);
    const src = { pos: pos.clone(), radius: p.r, enabled: true, amount: DRAIN.deviceAmount, max: DRAIN.deviceAmount, onEmpty: () => stop('absorb') };
    getPowerSources(world).push(src);
    rt.sources.set(id, src);
    const sock = {
      pos: pos.clone(), radius: p.r, enabled: true,
      onShot: () => stop('shot'),
      onFeed: () => {
        if (world.player.energy < 1) { toast(world, 'エネルギーが足りない…', 2.5); world.events.emit('noEnergy', {}); return; }
        drainEnergy(world, 1);
        stop('arm');
      },
    };
    getSockets(world).push(sock);
    (dv as DeviceVis & { sock?: typeof sock }).sock = sock;
  };
  for (const s of plan.securities) {
    const dv = vis.securities.find((v) => v.id === s.id)!;
    device(`sec:${s.id}`, dv, s, (how) => stopSecurity(world, rt, s.id, how));
  }
  device('main', vis.mainPower, plan.mainPower, (how) => stopMain(world, rt, how));

  // ---- グラップルポイント（隠し通路の棚）
  for (const g of plan.grapples) registerGrapplePoint(world, { pos: new THREE.Vector3(g.x, g.y, g.z), normal: new THREE.Vector3(g.nx, 0, g.nz), kind: 'ledge' });

  // ---- 拾う物：ホログラムデコイ
  if (world.unlocks.decoy) hideDecoy(vis);

  // ---- 記録（リトライ・つづきから）と、チェックポイントからの再開に必要な状態
  if (memo) restoreMemo(world, rt, memo);
  applyStartProgress(world, rt, startAt);

  const cp = plan.checkpoints[startAt];
  world.player.pos.set(cp.x, cp.y, cp.z);
  world.player.yaw = cp.yaw;
  world.player.pitch = 0;
  world.player.vel.set(0, 0, 0);
  world.level.data.objective = objective(rt);
}

function hideDecoy(vis: DrainVisuals): void {
  vis.decoy.taken = true;
  vis.decoy.group.visible = false;
}

function snapshot(rt: Runtime): Memo {
  const s = rt.state;
  return { secs: [...s.secs], mainOff: s.mainOff, broken: [...s.broken], fights: { ...s.fights }, minecart: s.minecartDone };
}
function remember(rt: Runtime): void { memo = snapshot(rt); rt.world.level.data.saveDirty = true; }

function restoreMemo(world: World, rt: Runtime, m: Memo): void {
  const { state } = rt;
  for (const id of m.broken) breakBlock(world, rt, id, true);
  if (m.minecart) state.minecartDone = true;
  if (m.mainOff) stopMain(world, rt, 'shot', true);
  for (const id of m.secs) stopSecurity(world, rt, id, 'shot', true);
  // 完了済みの戦闘は再出現させない。進行中だったものはやり直し
  for (const z of rt.zones) {
    const saved = m.fights[z.def.id];
    if (saved === 'done') { z.state = 'done'; state.fights[z.def.id] = 'done'; }
  }
  for (const z of rt.zones) if (z.state === 'done' && z.def.opens) for (const g of z.def.opens) forceGate(rt, g, true);
}

/** チェックポイントの位置までに通っているはずの場所を整える（記録が無い「ステージ選択」から来たとき用） */
function applyStartProgress(world: World, rt: Runtime, at: DrainStart): void {
  const done = (id: string) => {
    const z = rt.zones.find((q) => q.def.id === id);
    if (!z || z.state === 'done') return;
    z.state = 'done';
    rt.state.fights[id] = 'done';
    for (const g of z.def.opens ?? []) forceGate(rt, g, true);
  };
  if (at === 'rope') done('B');
  if (at === 'eWest') done('D');
  void world;
}

// ---------------------------------------------------------------- 仕掛け
/** 電源・セキュリティ装置の見た目を「止まった」状態にする */
function dimDevice(dv: DeviceVis): void {
  dv.core.color.set(0x2b3040);
  dv.ring.visible = false;
  dv.light.intensity = 0;
  const sock = (dv as DeviceVis & { sock?: { enabled: boolean } }).sock;
  if (sock) sock.enabled = false;
}

function stopSecurity(world: World, rt: Runtime, id: SecId, how: 'absorb' | 'shot' | 'arm', silent = false): void {
  const { state, vis } = rt;
  if (state.secs.includes(id)) return;
  state.secs.push(id);
  const dv = vis.securities.find((v) => v.id === id)!;
  dimDevice(dv);
  const src = rt.sources.get(`sec:${id}`);
  if (src) { src.enabled = false; }
  for (const ps of getPowerSources(world)) if (ps.pos.distanceTo(dv.group.position) < 0.1) { ps.enabled = false; ps.amount = 0; }
  if (!silent) {
    spawnBurst(world, dv.group.position.clone(), 0xff8a40, how === 'absorb' ? 10 : 24, 6, 0.6);
    world.events.emit('switchOn', { pos: dv.group.position.clone() });
  }
  const n = state.secs.length;
  if (!silent) toast(world, `セキュリティ装置を${how === 'absorb' ? '吸収' : '破壊'}した（${n}/3）`, 3.5);
  if (n >= 3) openGDoor(world, rt, silent);
  if (!silent) remember(rt);
}

function openGDoor(world: World, rt: Runtime, silent = false): void {
  if (rt.state.gDoorOpen) return;
  rt.state.gDoorOpen = true;
  if (silent) forceGate(rt, 'gDoor', true); else setGate(rt, 'gDoor', true);
  if (!silent) toast(world, '3つとも止めた！ E の西端、G の扉が開く', 4.5);
}

function stopMain(world: World, rt: Runtime, how: 'absorb' | 'shot' | 'arm', silent = false): void {
  const { state, vis, plan } = rt;
  if (state.mainOff) return;
  state.mainOff = true;
  state.laserOff = true;
  dimDevice(vis.mainPower);
  const src = rt.sources.get('main');
  if (src) src.enabled = false;
  for (const ps of getPowerSources(world)) if (ps.pos.distanceTo(vis.mainPower.group.position) < 0.1) { ps.enabled = false; ps.amount = 0; }
  vis.laser.group.visible = false;
  vis.laser.collider.active = false;
  for (const m of vis.laser.machineLamps) m.color.set(0x2b3040);
  if (!silent) {
    spawnBurst(world, vis.mainPower.group.position.clone(), 0xffc21a, 24, 6, 0.6);
    toast(world, `主電源を${how === 'absorb' ? '吸収' : '破壊'}した。レーザーが消えた！ 東へ進める`, 4.5);
    world.events.emit('doorOpen', { pos: new THREE.Vector3(plan.laser.machines[0].x, 2, 47) });
    remember(rt);
  }
}

/** 壊せるブロックに自分の弾が当たった。溜め（charge 0..1）が CAMP1.breakCharge 以上なら壊れる。戻り値：壊れたら true */
export function hitBreakable(world: World, id: string, charged: boolean, charge: number): boolean {
  const rt = runtimes.get(world);
  if (!rt || rt.state.broken.includes(id)) return false;
  const bv = rt.vis.breakables.find((b) => b.def.id === id);
  if (!bv) return false;
  if (charged && charge >= CAMP1.breakCharge) { breakBlock(world, rt, id); return true; }
  const before = rt.state.crack[id] ?? 0;
  const next = Math.min(CAMP1.crackStages, before + (charged ? CAMP1.crackPerCharged : CAMP1.crackPerShot));
  rt.state.crack[id] = next;
  const B = bv.def;
  if (next !== before) world.events.emit('impact', { pos: new THREE.Vector3((B.x0 + B.x1) / 2, 1.6, (B.z0 + B.z1) / 2), owner: 'player' });
  if (next >= CAMP1.crackStages && before < CAMP1.crackStages) toast(world, 'ブロックがもろくなっている…思い切り溜めて撃てば壊せそうだ', 3.5);
  else if (before === 0) toast(world, 'ブロックにひびが入った', 2);
  return false;
}

function breakBlock(world: World, rt: Runtime, id: string, silent = false): void {
  const st = rt.state;
  if (st.broken.includes(id)) return;
  const bv = rt.vis.breakables.find((b) => b.def.id === id);
  if (!bv) return;
  st.broken.push(id);
  st.crack[id] = CAMP1.crackStages;
  bv.mesh.visible = false;
  bv.collider.active = false;
  for (const c of bv.cracks) c.visible = false;
  bv.debris.visible = true;
  if (!silent) {
    const B = bv.def;
    const p = new THREE.Vector3((B.x0 + B.x1) / 2, Math.max(1.4, (B.y0 + B.y1) / 2), (B.z0 + B.z1) / 2);
    spawnBurst(world, p, 0xd8c8b0, 30, 7, 0.8);
    spawnBurst(world, p, 0xffb050, 16, 9, 0.4);
    world.events.emit('explosion', { pos: p, radius: 3 });
    toast(world, id === 'eBlock' ? 'ブロックが崩れた！ 奥に装置が見える' : id === 'dBlock' ? 'ブロックが崩れた！ 地下への階段が現れた' : '壁が崩れた！ 奥に部屋がある', 3.5);
    remember(rt);
  }
}

// ---------------------------------------------------------------- 敵
const FLYERS = new Set(['drone', 'missileDrone', 'redDrone']);
function spawnOne(world: World, rt: Runtime, z: ZoneDef, s: SpawnDef, trap: boolean): Enemy | null {
  const r = ENEMIES[s.kind].radius;
  const fl = s.floor ?? 0;
  const air = FLYERS.has(s.kind) || s.kind === 'leech';
  const y = air ? fl + (s.kind === 'leech' ? 1.2 : 3.2) : fl + r + 0.1;
  try {
    const mode = s.neutral ? 'awake' : s.mode ?? (FLYERS.has(s.kind) ? 'drop' : 'pod');
    const yaw = Math.atan2(z.face.x - s.x, z.face.z - s.z);
    if (mode === 'awake') {
      const e = spawnEnemy(world, s.kind, new THREE.Vector3(s.x, y, s.z));
      e.ai.yaw = yaw;
      if (s.neutral) e.ai.neutral = true;   // 襲ってこない赤メディック：戦闘の数に入れない
      return e;
    }
    return spawnEnemy(world, s.kind, new THREE.Vector3(s.x, y, s.z), { dormant: mode, yaw, ...(trap ? { wakeRadius: 0 } : {}) });
  } catch (err) {
    if (!rt.warned) { rt.warned = true; console.warn('[drain] spawnEnemy failed', err); }
    return null;
  }
}

function spawnZones(world: World, rt: Runtime): void {
  for (const z of rt.zones) {
    if (z.state === 'done') continue;
    const trap = z.def.mode === 'trap';
    z.enemies = z.def.spawns.map((s) => spawnOne(world, rt, z.def, s, trap)).filter((e): e is Enemy => !!e);
  }
}
const wakeAll = (world: World, list: Enemy[], gap: number): void => list.forEach((e, i) => wakeDormant(world, e, i * gap));

function updateZones(world: World, rt: Runtime): void {
  const st = rt.state;
  const p = world.player.pos;
  let changed = false;
  for (const z of rt.zones) {
    if (z.state === 'done') continue;
    if (z.def.mode === 'trap') {
      const T = z.def.trigger!;
      if (z.state === 'idle' && p.x > T.x0 && p.x < T.x1 && p.z > T.z0 && p.z < T.z1 && p.y > T.y0 && p.y < T.y1 && world.player.hp > 0) {
        z.state = 'active'; st.fights[z.def.id] = 'active';
        for (const g of z.def.closes ?? []) setGate(rt, g, false);
        wakeAll(world, z.enemies, 0.14);
        st.lockdown = true;
        world.events.emit('zoneWave', { wave: 1 });
        world.events.emit('lockdownStart', { zone: z.def.id });
        toast(world, '扉が閉まった！ 敵を全滅させろ', 3.5);
        changed = true;
      }
      if (z.state === 'active' && alive(z.enemies) === 0) {
        z.state = 'done'; st.fights[z.def.id] = 'done';
        for (const g of z.def.opens ?? []) setGate(rt, g, true);
        st.lockdown = rt.zones.some((q) => q.state === 'active' && q.def.mode === 'trap');
        world.events.emit('lockdownEnd', { zone: z.def.id });
        toast(world, z.def.id === 'B' ? '全滅させた！ 東の扉が開いた。綱渡りで G へ' : '全滅させた！ 扉が開いた', 4);
        changed = true;
      }
      continue;
    }
    // 通常の区画：誰かが目覚めたら activeとみなし、全滅したら done
    if (z.state === 'idle' && z.enemies.some((e) => !e.ai.dormant && e.status !== 'dead' && !e.ai.neutral && (e.ai.alert ?? 0) > 0)) { z.state = 'active'; st.fights[z.def.id] = 'active'; changed = true; }
    if (z.enemies.length && z.enemies.some((e) => !e.ai.neutral) && alive(z.enemies) === 0 && z.state !== 'idle') { z.state = 'done'; st.fights[z.def.id] = 'done'; changed = true; }
    else if (z.enemies.length && alive(z.enemies) === 0 && z.enemies.every((e) => e.ai.neutral)) { z.state = 'done'; st.fights[z.def.id] = 'done'; }
  }
  if (changed) remember(rt);
}

// ---------------------------------------------------------------- 吹き抜けのドローン湧き
function updateSpawner(world: World, rt: Runtime, dt: number): void {
  const S = rt.plan.spawner, sh = rt.plan.shaft;
  const p = world.player.pos;
  rt.shaftDrones = rt.shaftDrones.filter((e) => world.enemies.includes(e) && e.status !== 'dead');
  const inShaft = p.x > sh.x0 && p.x < sh.x1 && p.z > sh.z0 && p.z < sh.z1 && p.y > 2 && p.y < B_Y + 2 && world.player.hp > 0;
  if (!inShaft) { rt.spawnT = Math.min(rt.spawnT, 2.5); return; }
  rt.spawnT -= dt;
  if (rt.spawnT > 0) return;
  rt.spawnT = S.interval * (0.7 + Math.random() * 0.6);
  if (rt.shaftDrones.filter((e) => e.status === 'active' || e.status === 'stunned').length >= S.max) return;
  const kind = S.kinds[Math.floor(Math.random() * S.kinds.length)];
  // プレイヤーから離れた、吹き抜けの中の空中に出す
  for (let i = 0; i < 8; i++) {
    const x = S.x0 + Math.random() * (S.x1 - S.x0), z = S.z0 + Math.random() * (S.z1 - S.z0);
    const y = Math.max(S.y0, Math.min(S.y1, p.y + 1 + Math.random() * 7));
    const d = Math.hypot(x - p.x, z - p.z, y - p.y);
    if (d < DRAIN.spawnMin || d > DRAIN.spawnMax) continue;
    try {
      const e = spawnEnemy(world, kind, new THREE.Vector3(x, y, z));
      e.ai.yaw = Math.atan2(p.x - x, p.z - z);
      rt.shaftDrones.push(e);
      spawnBurst(world, e.pos.clone(), 0xff8a40, 8, 3, 0.4);
    } catch (err) {
      if (!rt.warned) { rt.warned = true; console.warn('[drain] shaft spawn failed', err); }
    }
    return;
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
  if (p.x > d.x0 - m && p.x < d.x1 + m && p.z > d.z0 - m && p.z < d.z1 + m && p.y > d.y0 - 1 && p.y < d.y0 + d.h) return true;
  for (const e of world.enemies) {
    if (e.status === 'dead') continue;
    const r = e.radius + 0.5;
    if (e.pos.x > d.x0 - r && e.pos.x < d.x1 + r && e.pos.z > d.z0 - r && e.pos.z < d.z1 + r && e.pos.y > d.y0 - 1 && e.pos.y < d.y0 + d.h) return true;
  }
  return false;
}
function updateGates(world: World, rt: Runtime, dt: number, t: number): void {
  for (const g of rt.vis.gates) {
    const want = rt.want.get(g.def.id) ?? g.open;
    if (want && !g.open) { g.open = true; world.events.emit('doorOpen', { pos: new THREE.Vector3(g.cx, g.def.y0 + 1.5, g.cz) }); }
    else if (!want && g.open && !gateBlocked(world, g)) { g.open = false; g.collider.active = true; world.events.emit('doorClose', { pos: new THREE.Vector3(g.cx, g.def.y0 + 1.5, g.cz) }); }
    g.k = Math.max(0, Math.min(1, g.k + ((g.open ? 1 : -1) * dt) / 0.9));
    if (g.open && g.k > 0.85) g.collider.active = false;
    g.shutter.position.y = g.k * (g.def.h + 0.1);
    const blink = !g.open && rt.state.lockdown ? (Math.sin(t * 12) > 0 ? 1 : 0.3) : 1;
    g.lampMat.color.set(g.open ? 0x3dff7a : g.def.id === 'gDoor' ? 0x3a7dff : 0xff2a2a).multiplyScalar(blink);
  }
}

// ---------------------------------------------------------------- 照明
const RED = new THREE.Color();
function updateLamps(rt: Runtime, pp: THREE.Vector3, dt: number, t: number): void {
  const lamps = rt.plan.lamps;
  const cand: { i: number; d: number }[] = [];
  lamps.forEach((l, i) => {
    const d = (l.x - pp.x) ** 2 + (l.z - pp.z) ** 2 + (l.y - pp.y - 1) ** 2 * 1.2;
    if (d < 45 * 45) cand.push({ i, d });
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
    free.light.distance = Math.max(14, Math.min(40, l.y * 2.6));
  }
  for (const sl of rt.slots) {
    if (sl.lamp < 0) { sl.light.intensity = 0; continue; }
    const l = lamps[sl.lamp];
    sl.light.color.set(l.color).lerp(RED, rt.alarm * 0.8);
    sl.light.intensity = 3.2 * Math.min(l.y, 14) * Math.min(l.y, 14) * 0.5 * l.power * sl.cur + 2 * l.power * sl.cur;
  }
}

// ---------------------------------------------------------------- 動く足場
function updatePlatforms(world: World, rt: Runtime, t: number): void {
  const p = world.player;
  for (const pv of rt.vis.platforms) {
    const d = pv.def;
    const off = Math.sin(t * d.speed + d.phase) * d.amp;
    const nx = d.axis === 'x' ? d.x + off : d.x, nz = d.axis === 'z' ? d.z + off : d.z;
    const dx = nx - pv.x, dz = nz - pv.z;
    // 乗っている（足元が天面にあって、範囲内）なら一緒に運ぶ。動かす前の位置で判定する
    const top = d.y, m = DRAIN.carryMargin;
    const on = world.state === 'playing' && p.hp > 0 && p.pos.y > top - 0.2 && p.pos.y < top + 0.35
      && Math.abs(p.pos.x - pv.x) < d.sx / 2 + m && Math.abs(p.pos.z - pv.z) < d.sz / 2 + m && p.vel.y <= 0.5;
    pv.x = nx; pv.z = nz; pv.dx = dx; pv.dz = dz;
    pv.mesh.position.set(nx, d.y, nz);
    pv.collider.min.set(nx - d.sx / 2, d.y - PLATFORM_THICK, nz - d.sz / 2);
    pv.collider.max.set(nx + d.sx / 2, d.y, nz + d.sz / 2);
    if (on) { p.pos.x += dx; p.pos.z += dz; }
  }
}

// ---------------------------------------------------------------- 更新
const _p1 = new THREE.Vector3();
const HEMI_SKY = new THREE.Color(0x3a4660), HEMI_GND = new THREE.Color(0x12151b);

export function updateDrain(world: World, dt: number): void {
  const rt = runtimes.get(world);
  if (!rt) return;
  const { plan, vis, state } = rt;
  const p = world.player;
  rt.clock += dt;
  const t = rt.clock;

  if (!rt.started) {
    rt.started = true;
    spawnZones(world, rt);
    for (const z of rt.zones) if (z.state === 'done') z.enemies = [];
    toast(world, rt.startAt === 'entrance' && !memo ? 'ドレイン装置へ向かう施設に潜入した' : '再開', 3);
  }

  // ---- 警報照明・照明
  const wantAlarm = LOCKDOWN.enabled && state.lockdown ? 1 : 0;
  rt.alarm += (wantAlarm - rt.alarm) * Math.min(1, dt * (wantAlarm > rt.alarm ? 6 : 2.5));
  RED.set(LOCKDOWN.light);
  rt.hemi.color.copy(HEMI_SKY).lerp(RED, rt.alarm * 0.7);
  rt.hemi.groundColor.copy(HEMI_GND).lerp(RED, rt.alarm * 0.4);
  rt.beacon.position.set(p.pos.x, p.pos.y + 6, p.pos.z);
  rt.beacon.intensity = rt.alarm * (30 + 40 * Math.max(0, Math.sin(t * 5.5)));
  updateLamps(rt, p.pos, dt, t);
  const inE = p.pos.x > 37 && p.pos.x < 135 && p.pos.z > 30 && p.pos.z < 54 && p.pos.y < 6;
  rt.fill.position.set(p.pos.x, p.pos.y + 2.6, p.pos.z);
  rt.fill.intensity += ((inE ? 1.6 : 4.5) - rt.fill.intensity) * Math.min(1, dt * 4);

  // ---- 区画の入退室（いちばん狭い区画を現在地にする）
  let cur = -1, best = Infinity;
  plan.rooms.forEach((r, i) => {
    if (p.pos.x > r.x0 && p.pos.x < r.x1 && p.pos.z > r.z0 && p.pos.z < r.z1 && p.pos.y > r.y0 - 1 && p.pos.y < r.y1 + 1) {
      const vol = (r.x1 - r.x0) * (r.z1 - r.z0) * (r.y1 - r.y0);
      if (vol < best) { best = vol; cur = i; }
    }
  });
  if (cur >= 0) {
    world.level.currentRoom = cur;
    if (!rt.roomSeen[cur]) {
      rt.roomSeen[cur] = true;
      world.level.rooms[cur].entered = true;
      world.events.emit('roomEnter', { index: cur, name: plan.rooms[cur].name });
    }
  }

  updateZones(world, rt);
  updateGates(world, rt, dt, t);
  updateSpawner(world, rt, dt);
  updatePlatforms(world, rt, t);
  plan.rooms.forEach((r, i) => {
    const z = rt.zones.find((q) => q.def.id === r.id);
    world.level.rooms[i].cleared = z ? z.state === 'done' : true;
  });

  // ---- チェックポイント：踏んだ場所をその都度「最新」にする（やられたらそこから）
  for (const cz of plan.checkpointZones) {
    if (state.checkpoint !== cz.id && p.hp > 0 && p.pos.x > cz.x0 && p.pos.x < cz.x1 && p.pos.z > cz.z0 && p.pos.z < cz.z1 && p.pos.y > cz.y0 && p.pos.y < cz.y1 && p.onGround) {
      // 戦闘中の部屋（B・D）に閉じ込められているあいだは更新しない
      if (state.lockdown) break;
      state.checkpoint = cz.id;
      world.level.data.retryAt = cz.id;
      remember(rt);
      toast(world, 'チェックポイント（やられたらここから再開）', 3);
    }
  }
  for (const [id, m] of Object.entries(vis.checkpoints)) m.opacity = state.checkpoint === id ? 0.65 : 0.22;

  // ---- 壊せるブロック：近づいてくる自分の弾を先に見つけて、当たりを処理する（通常の弾の処理より先に）
  {
    const maxDmg = gunChargeMaxDamage(world);
    for (const bv of vis.breakables) {
      if (state.broken.includes(bv.def.id)) continue;
      const B = bv.collider;
      for (const q of world.projectiles) {
        if (q.dead || q.owner !== 'player') continue;
        _p1.copy(q.pos).addScaledVector(q.vel, dt * 1.5);
        const hit = segmentAABB(q.pos, _p1, { min: B.min.clone().subScalar(q.radius), max: B.max.clone().addScalar(q.radius), active: true });
        if (hit === null) continue;
        q.dead = true;
        const hp = q.pos.clone().lerp(_p1, hit);
        spawnBurst(world, hp, 0xd8c8b0, q.charged ? 14 : 6, q.charged ? 4 : 2.5);
        const charge = q.charged ? Math.max(0, Math.min(1, (q.damage - chargeDamage(0, maxDmg)) / Math.max(1e-6, chargeDamage(1, maxDmg) - chargeDamage(0, maxDmg)))) : 0;
        hitBreakable(world, bv.def.id, !!q.charged, charge);
        if (state.broken.includes(bv.def.id)) break;
      }
      const stage = state.crack[bv.def.id] ?? 0;
      bv.cracks.forEach((c, i) => { c.visible = stage > i; });
      bv.glow.opacity = stage >= CAMP1.crackStages ? 0.5 + 0.4 * Math.sin(t * 6) : 0;
    }
  }

  // ---- レーザー：触れると痛い
  if (!state.laserOff) {
    const L = plan.laser, m = 0.35;
    rt.laserHitT -= dt;
    if (p.pos.x > L.x0 - m && p.pos.x < L.x1 + m && p.pos.z > L.z0 - m && p.pos.z < L.z1 + m && p.pos.y < L.y1 && rt.laserHitT <= 0) {
      rt.laserHitT = DRAIN.laserInterval;
      damagePlayer(world, DRAIN.laserDamage);
      spawnBurst(world, p.pos.clone().setY(p.pos.y + 1), 0xff4020, 8, 4, 0.3);
    }
    vis.laser.beamMat.opacity = 0.55 + 0.3 * Math.sin(t * 20);
  }
  for (const d of [...vis.securities, vis.mainPower]) if (d.ring.visible) { d.ring.rotation.z = t * 2; d.light.intensity = 5 + 2 * Math.sin(t * 3 + d.group.position.x); }

  // ---- ホログラムデコイを拾う（A の地下）
  if (!vis.decoy.taken) {
    vis.decoy.group.rotation.y = t * 1.5;
    vis.decoy.group.position.y = vis.decoy.y + Math.sin(t * 2) * 0.12;
    if ((vis.decoy.x - p.pos.x) ** 2 + (vis.decoy.z - p.pos.z) ** 2 < 2.25 && Math.abs(vis.decoy.y - (p.pos.y + 0.9)) < 1.8 && p.hp > 0) {
      hideDecoy(vis);
      giveDecoy(world);
      world.events.emit('gearPickup', {});
      toast(world, 'ホログラムデコイを手に入れた！ N キー（パッドは右スティック押し込み）で自分そっくりの的を3体出す', 6);
      remember(rt);
    }
  }

  // ---- 落下したら即死（吹き抜け・綱渡りの下）
  if (p.hp > 0 && world.state === 'playing') {
    let fell = p.pos.y < DRAIN.voidY;
    for (const pit of plan.pits) if (p.pos.x > pit.x0 && p.pos.x < pit.x1 && p.pos.z > pit.z0 && p.pos.z < pit.z1 && p.pos.y < pit.y) fell = true;
    if (fell) {
      state.fell = true;
      p.hp = 0;
      toast(world, 'You are dead', 3);
      world.events.emit('playerHit', { amount: 999 });
    }
  }

  // ---- 操作のヒントと「調べる」
  let hint: string | null = null;
  const stepNear = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, m = 0) => p.pos.x > x0 - m && p.pos.x < x1 + m && p.pos.z > z0 - m && p.pos.z < z1 + m && p.pos.y > y0 && p.pos.y < y1;
  for (const bv of vis.breakables) {
    const B = bv.def;
    if (state.broken.includes(B.id)) continue;
    if (B.id === 'eBlock' && !stepNear(B.x0, B.x1, B.z0, B.z1, -1, 5, 3.5)) continue;
    if (stepNear(B.x0, B.x1, B.z0, B.z1, -1, 5, 6)) { hint = '溜め撃ち（左クリック長押し→離す）でブロックを壊せる'; break; }
  }
  const gd = vis.gates.find((g) => g.def.id === 'gDoor')!;
  if (!hint && !state.gDoorOpen && stepNear(gd.def.x0, gd.def.x1, gd.def.z0, gd.def.z1, -1, 6, 4)) hint = `セキュリティ封鎖（${state.secs.length}/3）：I・D の地下・F の装置を止めよう`;
  const D = plan.drainDoor;
  const nearDoor = p.hp > 0 && world.state === 'playing' && Math.hypot(p.pos.x - D.x, p.pos.z - (D.z + 2)) < D.reach && p.pos.y < 6;
  world.level.data.interactNear = nearDoor;
  if (nearDoor) {
    hint = 'B ボタン / R キー：扉を調べる';
    if (world.input.pressed('PadB') || world.input.pressed('KeyR')) {
      state.doorChecks++;
      if (!state.minecartDone) {
        // 扉の奥はトロッコの線路。調べるとトロッコ面（横スクロール）が始まる
        toast(world, 'ドレイン装置の部屋への扉…奥にトロッコの線路が続いている', 3);
        world.level.data.minecartRequest = true;
      } else if (world.time < state.minecartAskUntil) {
        state.minecartAskUntil = 0;
        world.level.data.minecartRequest = true;
      } else {
        // クリア済み：扉の奥の通路（ドレイン装置の部屋）へ。もう一度トロッコに乗るなら、続けて調べる
        state.minecartAskUntil = world.time + 4;
        setDrainBossArrival('ドレイン装置の部屋への通路に着いた');
        world.level.data.nextLevel = { level: 'drainBoss', startAt: 'corridor' };
      }
    }
  }
  if (hint) {
    showPrompt(hint);
    if (!rt.promptOn) world.events.emit('interactPrompt', {});
    rt.promptOn = true;
  } else if (rt.promptOn) { showPrompt(null); rt.promptOn = false; }

  let remaining = 0;
  for (const z of rt.zones) if (z.state === 'active') remaining += alive(z.enemies);
  world.level.data.remaining = remaining;
  world.level.data.objective = objective(rt);
}

function objective(rt: Runtime): string {
  const s = rt.state;
  const goal = rt.plan.checkpoints.goal;
  void goal;
  if (s.checkpoint === 'goal') return 'ドレイン装置の部屋の扉を調べろ';
  const a = rt.zones.find((z) => z.def.id === 'B');
  if (a?.state === 'active') return `敵を全滅させろ（残り${alive(a.enemies)}）`;
  const d = rt.zones.find((z) => z.def.id === 'D');
  if (d?.state === 'active') return `敵を全滅させろ（残り${alive(d.enemies)}）`;
  if (!s.gDoorOpen) return `G へ：近道は A の上（吹き抜け→B→綱渡り）、正規ルートは装置を止めて E の扉へ（${s.secs.length}/3）`;
  return 'E の西端の扉から G へ';
}

// ---------------------------------------------------------------- チェックポイントメニュー（部屋を選んで再開）
export type DrainRoomId = 'A' | 'shaft' | 'abase' | 'B' | 'rope' | 'duct' | 'G' | 'C' | 'I' | 'D' | 'dbase' | 'E' | 'pass' | 'F';
const roomResumePoints: Record<DrainRoomId, { x: number; y: number; z: number; yaw: number }> = {
  A: { x: 17, y: 0, z: 86, yaw: Math.PI },
  shaft: { x: 9, y: 6, z: 60, yaw: 0 },
  abase: { x: 14, y: -4.2, z: 85, yaw: Math.PI },
  B: { x: 14, y: B_Y, z: 33, yaw: 0 },
  rope: { x: 21, y: B_Y, z: 20, yaw: -Math.PI / 2 },
  duct: { x: 27, y: 40, z: 24.5, yaw: -Math.PI / 2 },
  G: { x: 64, y: 0, z: 24, yaw: Math.PI },
  C: { x: 55, y: 0, z: 79, yaw: -Math.PI / 2 },
  I: { x: 59, y: 0, z: 62, yaw: 0 },
  D: { x: 79, y: 0, z: 79, yaw: -Math.PI / 2 },
  dbase: { x: 112, y: -4.2, z: 86, yaw: Math.PI },
  E: { x: 79, y: 0, z: 49, yaw: Math.PI },
  pass: { x: 131.7, y: 0, z: 40, yaw: 0 },
  F: { x: 126, y: 0, z: 25, yaw: 0 },
};
/** 部屋を選んで再開するとき、その部屋に行くまでに解けているはずの仕掛けを整える */
export function prepareDrainRoomResume(world: World, roomId: string): boolean {
  const rt = runtimes.get(world);
  if (!rt || !Object.prototype.hasOwnProperty.call(roomResumePoints, roomId)) return false;
  const id = roomId as DrainRoomId;
  const point = roomResumePoints[id];
  const doneFight = (fid: string) => {
    const z = rt.zones.find((q) => q.def.id === fid);
    if (!z) return;
    for (const e of z.enemies) { e.root.parent?.remove(e.root); const i = world.enemies.indexOf(e); if (i >= 0) world.enemies.splice(i, 1); }
    z.enemies = [];
    z.state = 'done';
    rt.state.fights[fid] = 'done';
    for (const g of z.def.opens ?? []) forceGate(rt, g, true);
  };
  if (id === 'dbase') { doneFight('D'); breakBlock(world, rt, 'dBlock', true); }
  if (id === 'I') breakBlock(world, rt, 'iWall', true);
  if (id === 'E' || id === 'pass' || id === 'F') doneFight('D');
  if (id === 'pass' || id === 'F') { breakBlock(world, rt, 'eBlock', true); stopMain(world, rt, 'shot', true); }
  if (id === 'rope' || id === 'duct' || id === 'G') doneFight('B');
  if (id === 'G') for (const s of ['I', 'D', 'F'] as const) stopSecurity(world, rt, s, 'shot', true);
  const cp: DrainStart = id === 'G' ? 'goal' : id === 'rope' ? 'rope' : id === 'B' ? 'bTop' : id === 'E' ? 'eWest' : 'entrance';
  rt.state.checkpoint = cp;
  world.level.data.retryAt = cp;
  world.player.pos.set(point.x, point.y, point.z);
  world.player.yaw = point.yaw;
  world.player.pitch = 0;
  world.player.vel.set(0, 0, 0);
  world.player.onGround = false;
  world.level.data.objective = objective(rt);
  remember(rt);
  return true;
}
