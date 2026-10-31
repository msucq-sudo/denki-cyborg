// サージ収容所 2階（ボス戦）。使い方: URL に ?level=camp2（&start=boss で戦闘開始の地点から）
// 南から入る。手前は敵のいる区画（前室）、奥は檻（火星の住民が大勢収容されている）。
// 前室は最初は静か。檻の扉に近づいて「調べる（B / R）：扉を開ける」→ ムービー（camp2/cutscene.ts）→ ジェネレーターが降りてきて、雑魚も一斉に出る。
// ジェネレーターを倒すと檻の扉が開き「住民を解放した」。その先の流れは未定なので、ここで止まる（自由に歩ける・クリア画面は出さない）。
// やられたら、ムービーのあと（戦闘開始時点）からリトライ（world.level.data.retryAt = 'boss'）。
import * as THREE from 'three';
import type { Enemy, World } from '../core/types';
import { CAMP2 } from '../config/balance';
import { toast } from '../core/combat';
import { spawnBurst, spawnShockwave } from '../core/effects';
import { shutdownEnemy, spawnEnemy } from '../enemies/api';
import { setPlayerFacing } from '../player/player';
import { Cutscene } from '../cinematic/sequencer';
import { showPrompt } from './floor1';
import { BOSS_LAND, CAGE, CAGE_Z, DOOR, FIGHT_START, HALL, SPAWNS, STAND, START } from './camp2/layout';
import { buildCamp2Visuals, type Camp2Visuals } from './camp2/visuals';
import { buildResidents, type Residents } from './camp2/residents';
import { camp2Script, type Camp2CutProbe } from './camp2/cutscene';

export const CAMP2_EXPOSURE = 1.1;

export type Camp2Phase = 'explore' | 'cutscene' | 'fight' | 'freed';
export interface Camp2State {
  phase: Camp2Phase;
  /** 扉の前で B / R が使えるか */
  nearDoor: boolean;
  /** 扉の開き具合 0..1 */
  doorOpen: number;
  /** ボスが倒れてからの時間 */
  bossDeadT: number;
  /** ムービーを見たか（リトライで飛ばしたときは false のまま） */
  sawCutscene: boolean;
}

interface Runtime {
  state: Camp2State;
  vis: Camp2Visuals;
  residents: Residents;
  /** 戦闘開始と同時に出た雑魚 */
  front: Enemy[];
  boss: Enemy | null;
  cut: Cutscene | null;
  probe: Camp2CutProbe;
  clock: number;
  promptOn: boolean;
}
const runtimes = new WeakMap<World, Runtime>();

/** テスト・デバッグ用 */
export function getCamp2(world: World): { state: Camp2State; boss: Enemy | null; front: Enemy[]; cut: Cutscene | null; residents: Residents; probe: Camp2CutProbe; doorCollider: { active: boolean } } | null {
  const rt = runtimes.get(world);
  if (!rt) return null;
  return {
    state: rt.state, front: rt.front, residents: rt.residents, probe: rt.probe, doorCollider: rt.vis.doorCollider,
    get boss() { return rt.boss; },
    get cut() { return rt.cut; },
  };
}

// ---------------------------------------------------------------- 構築
export function buildCamp2(world: World): void {
  showPrompt(null);
  const scene = world.scene;
  const fromBoss = world.level.data.startAt === 'boss';
  scene.background = new THREE.Color(0x120c0c);
  scene.fog = new THREE.Fog(0x120c0c, 40, 90);

  const vis = buildCamp2Visuals();
  scene.add(vis.root);
  for (const l of vis.lights) scene.add(l);
  for (const c of vis.colliders) world.colliders.push(c);
  const residents = buildResidents(CAMP2.residents);
  scene.add(residents.root);

  const room = (name: string, x0: number, x1: number, z0: number, z1: number, h: number) => ({
    name, min: new THREE.Vector3(x0, 0, z0), max: new THREE.Vector3(x1, h, z1), entered: true, cleared: false,
  });
  // rooms[0] はボスの行動範囲（initBossAI がボスの位置を含む部屋を探す）
  world.level.rooms = [
    room('収容区画 前室', HALL.x0, HALL.x1, HALL.z0, HALL.z1, HALL.h),
    room('檻', CAGE.x0, CAGE.x1, CAGE.z0, CAGE.z1, CAGE.h),
  ];
  world.level.currentRoom = 0;
  world.level.bossSpawned = false;
  world.level.bossDefeated = false;
  world.level.data.interactNear = false;
  world.level.data.poseAim = false;
  // 前の World のムービー中にタイトルへ戻った場合などに、入力のロックが残らないように
  if (world.input) world.input.locked = false;

  const state: Camp2State = { phase: 'explore', nearDoor: false, doorOpen: 0, bossDeadT: 0, sawCutscene: false };
  const rt: Runtime = {
    state, vis, residents, front: [], boss: null, cut: null, clock: 0, promptOn: false,
    probe: { beat: 'reach', bossY: 0, facing: 0 },
  };
  runtimes.set(world, rt);
  world.level.data.camp2State = state;

  const p = world.player;
  p.vel.set(0, 0, 0);
  if (world.level.data.startAt === 'freed') {
    p.pos.set(FIGHT_START.x, 0, FIGHT_START.z);
    p.yaw = FIGHT_START.yaw;
    p.pitch = FIGHT_START.pitch;
    freeResidents(world, rt);
    state.doorOpen = 1;
    vis.door.position.x = (DOOR.x0 + DOOR.x1) / 2 + DOOR.slide;
    vis.cageLight.intensity = 48;
    vis.doorCollider.active = false;
  } else if (fromBoss) {
    // リトライ：ムービーは飛ばして、戦闘開始の状態から
    p.pos.set(FIGHT_START.x, 0, FIGHT_START.z);
    p.yaw = FIGHT_START.yaw;
    p.pitch = FIGHT_START.pitch;
    startFight(world, rt);
  } else {
    p.pos.set(START.x, 0, START.z);
    p.yaw = START.yaw;
    p.pitch = -0.05;
    world.level.data.objective = '檻の扉を調べろ';
  }
  world.level.data.remaining = 0;
}

// ---------------------------------------------------------------- ムービー → 戦闘
function beginCutscene(world: World, rt: Runtime): void {
  const st = rt.state;
  st.phase = 'cutscene';
  st.nearDoor = false;
  world.level.data.interactNear = false;
  showPrompt(null);
  rt.promptOn = false;
  world.input.locked = true;
  const p = world.player;
  p.pos.set(STAND.x, 0, STAND.z);
  p.vel.set(0, 0, 0);
  p.yaw = STAND.yaw;
  p.pitch = 0;
  setPlayerFacing(world, STAND.yaw);
  rt.cut = new Cutscene(world, (crt) => camp2Script(crt, rt.probe), () => {
    rt.cut = null;
    st.sawCutscene = true;
    startFight(world, rt);
  });
}

/** 戦闘開始（ムービーの終わり・スキップ・リトライの共通） */
function startFight(world: World, rt: Runtime): void {
  const st = rt.state;
  st.phase = 'fight';
  const p = world.player;
  p.pos.set(FIGHT_START.x, 0, FIGHT_START.z);
  p.vel.set(0, 0, 0);
  p.yaw = FIGHT_START.yaw;
  p.pitch = FIGHT_START.pitch;
  setPlayerFacing(world, FIGHT_START.yaw);
  world.level.data.poseAim = false;
  world.input.locked = false;
  const boss = spawnEnemy(world, 'boss', new THREE.Vector3(BOSS_LAND.x, BOSS_LAND.y, BOSS_LAND.z));
  boss.ai.yaw = Math.atan2(STAND.x - BOSS_LAND.x, STAND.z - BOSS_LAND.z);
  boss.ai.alert = 1e9;
  boss.ai.summonKinds1 = [...CAMP2.summon1];
  boss.ai.summonKinds2 = [...CAMP2.summon2];
  boss.ai.atkTimer = 1.6;
  boss.ai.summonT = 14;
  rt.boss = boss;
  // 雑魚：ドローンは天井から、ほかは床に現れて、最初から戦闘態勢
  for (const s of SPAWNS) {
    const fly = s.kind === 'drone';
    const pos = new THREE.Vector3(s.x, (s.floor ?? 0) + (fly ? 3.2 : 0), s.z);
    const e = spawnEnemy(world, s.kind, pos);
    e.ai.yaw = Math.atan2(FIGHT_START.x - s.x, FIGHT_START.z - s.z);
    e.ai.alert = 1e9;
    spawnBurst(world, pos.clone().setY(pos.y + 1), 0xff6a3a, 10, 4);
    rt.front.push(e);
  }
  world.level.bossSpawned = true;
  world.level.data.retryAt = 'boss';
  world.level.data.objective = 'ジェネレーターを倒せ';
  world.events.emit('bossStart', {});
}

function freeResidents(world: World, rt: Runtime): void {
  const st = rt.state;
  st.phase = 'freed';
  // 呼び出された雑魚も止まる
  for (const e of world.enemies) if (e.status !== 'dead' && e.status !== 'down' && !e.allied) shutdownEnemy(world, e);
  rt.residents.setFreed(true);
  rt.vis.lockLamp.color.set(0x3dff7a).multiplyScalar(1.6);
  world.level.rooms[0].cleared = true;
  world.level.rooms[1].cleared = true;
  world.level.data.objective = '住民を解放した';
  world.level.data.camp2Freed = true;
  world.level.data.retryAt = 'freed';
  toast(world, '住民を解放した！', 5);
  world.events.emit('doorOpen', { pos: new THREE.Vector3((DOOR.x0 + DOOR.x1) / 2, 1.5, CAGE_Z) });
}

// ---------------------------------------------------------------- 更新
export function updateCamp2(world: World, dt: number): void {
  const rt = runtimes.get(world);
  if (!rt) return;
  const { state: st, vis } = rt;
  const p = world.player;
  const input = world.input;
  rt.clock += dt;
  const t = rt.clock;

  rt.residents.update(dt, t);
  world.level.currentRoom = p.pos.z < CAGE_Z ? 1 : 0;
  world.level.data.remaining = st.phase === 'fight' ? 1 : 0;

  // ---- 扉を調べる
  let hint: string | null = null;
  st.nearDoor = false;
  if (st.phase === 'explore' && p.hp > 0) {
    const dx = p.pos.x - STAND.x, dz = p.pos.z - STAND.z;
    const near = Math.hypot(dx, dz) < CAMP2.doorReach && p.pos.z > CAGE_Z && p.pos.y < 1.5;
    if (near) {
      hint = '調べる（B / R）：扉を開ける'; st.nearDoor = true;
    }
  }
  world.level.data.interactNear = st.nearDoor;
  if (hint) {
    showPrompt(hint);
    if (!rt.promptOn && st.nearDoor) world.events.emit('interactPrompt', {});
    rt.promptOn = st.nearDoor;
  } else if (rt.promptOn || st.phase === 'explore') {
    showPrompt(null);
    rt.promptOn = false;
  }
  if (st.nearDoor && (input.pressed('PadB') || input.pressed('KeyR'))) beginCutscene(world, rt);

  // ---- ボス戦：警告灯を回す。倒れたら扉が開く
  if (st.phase === 'fight') {
    const a = 0.5 + 0.5 * Math.sin(t * 6);
    vis.alarm.intensity = 18 * a;
    vis.alarmMat.color.set(0xff2a10).multiplyScalar(0.4 + 1.6 * a);
    const boss = rt.boss;
    const gone = !boss || boss.status === 'dead' || boss.status === 'down' || !world.enemies.includes(boss);
    if (gone) {
      world.level.data.objective = '檻のロックを解除中…';
      st.bossDeadT += dt;
      if (st.bossDeadT >= CAMP2.openDelay) freeResidents(world, rt);
    }
  } else {
    vis.alarm.intensity = 0;
    vis.alarmMat.color.set(0xff2a10).multiplyScalar(0.4);
  }

  // ---- 扉が開く（+X へスライド）
  if (st.phase === 'freed' && st.doorOpen < 1) {
    const before = st.doorOpen;
    st.doorOpen = Math.min(1, st.doorOpen + dt / CAMP2.doorOpenTime);
    const e = st.doorOpen * st.doorOpen * (3 - 2 * st.doorOpen);
    vis.door.position.x = (DOOR.x0 + DOOR.x1) / 2 + e * DOOR.slide;
    vis.doorCollider.active = st.doorOpen < 0.6;
    vis.cageLight.intensity = 18 + 30 * e;
    if (before === 0) {
      const at = new THREE.Vector3((DOOR.x0 + DOOR.x1) / 2, 1.5, CAGE_Z);
      spawnShockwave(world, at, 0x7affb0, 3, 0.5);
      spawnBurst(world, at, 0x9affc8, 14, 4);
    }
  }

  // ---- ムービー（通常のカメラ・ポーズの計算のあとに上書きするので最後）
  if (rt.cut) {
    p.invuln = Math.max(p.invuln, 0.5);
    rt.cut.update(world, dt);
  }
}
