// サージ収容所 2階（ボス戦）。使い方: URL に ?level=camp2（&start=boss で戦闘開始の地点から）
// 南から入る。手前は敵のいる区画（前室）、奥は檻（火星の住民が大勢収容されている）。
// 前室は最初は静か。檻の扉に近づいて「調べる（B / R）：扉を開ける」→ ムービー（camp2/cutscene.ts）→ ジェネレーターが降りてきて、雑魚も一斉に出る。
// ジェネレーターの HP が 0 になると、エンディングムービー（camp2/ending.ts）が始まる：爆発 → 扉が開く → 住民が出ていく → 天井に穴をあけてジェットで飛び去る → 研究所 2 階へ。
// ?start=ending でムービーから（終わると研究所 2 階へ）、?start=movie（または ?start=ending&movie=1）でムービーだけ（終わるとまた最初から流れる）。
// 天井の真ん中にはひび割れがある。最大まで溜めた一発を当てると穴があく（ボス戦中でも）。穴があいたまま倒すと、エンディングは「見上げて溜める」を飛ばして短くなる（camp2/ending.ts の ENDING_SHOTS_HOLE）。穴の状態はその周回だけ（リトライでは閉じた状態に戻る）。
// やられたら、ムービーのあと（戦闘開始時点）からリトライ（world.level.data.retryAt = 'boss'）。
import * as THREE from 'three';
import type { Enemy, World } from '../core/types';
import { CAMP2 } from '../config/balance';
import { segmentAABB } from '../core/collision';
import { chargeDamage } from '../player/logic';
import { gunChargeMaxDamage } from '../progression/effects';
import { toast } from '../core/combat';
import { markCamp2Cleared } from '../core/progress';
import { grantCamp2Rewards } from '../progression/upgrades';
import { spawnBurst, spawnShockwave } from '../core/effects';
import { shutdownEnemy, spawnEnemy } from '../enemies/api';
import { setPlayerFacing } from '../player/player';
import { Cutscene } from '../cinematic/sequencer';
import { showPrompt } from './floor1';
import { BOSS_LAND, CAGE, CAGE_Z, CEILING_HOLE, DOOR, FIGHT_START, HALL, SPAWNS, STAND, START } from './camp2/layout';
import { buildCamp2Visuals, type Camp2Visuals } from './camp2/visuals';
import { buildResidents, type Residents } from './camp2/residents';
import { camp2Script, type Camp2CutProbe } from './camp2/cutscene';
import { playResidentStep } from '../audio/sfx';
import { movieNow, showMovieEnd } from '../cinematic/movieMode';
import { buildCeilingOpening, endingScript, newEndingProbe, type CeilingOpening, type EndingProbe } from './camp2/ending';

export const CAMP2_EXPOSURE = 1.1;

export type Camp2Phase = 'explore' | 'cutscene' | 'fight' | 'ending' | 'freed';
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
  /** 天井に穴があいているか（最大溜めの一発で割った） */
  holeOpen: boolean;
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
  endingProbe: EndingProbe;
  /** 穴の向こうの屋根・街・空（穴をあけるまで作らない） */
  opening: CeilingOpening | null;
  /** ひびを初めて撃ったときの案内を出したか */
  crackHinted: boolean;
  /** ムービーだけ見るモード（終わったらもう一度最初から） */
  movieOnly: boolean;
  /** 最初のフレームでエンディングを始める（プレイヤーの見た目ができてから） */
  pendingEnding: boolean;
  /** 最初のフレームで扉を調べるムービー（導入）を始める（ムービー単体モード） */
  pendingIntro: boolean;
  clock: number;
  promptOn: boolean;
}
const runtimes = new WeakMap<World, Runtime>();

/** テスト・デバッグ用 */
export function getCamp2(world: World): { state: Camp2State; boss: Enemy | null; front: Enemy[]; cut: Cutscene | null; residents: Residents; probe: Camp2CutProbe; endingProbe: EndingProbe; doorCollider: { active: boolean } } | null {
  const rt = runtimes.get(world);
  if (!rt) return null;
  return {
    state: rt.state, front: rt.front, residents: rt.residents, probe: rt.probe, doorCollider: rt.vis.doorCollider,
    get endingProbe() { return rt.endingProbe; },
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
  residents.onStep = (x, z) => playResidentStep({ x, y: 0, z });
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

  const state: Camp2State = { phase: 'explore', nearDoor: false, doorOpen: 0, bossDeadT: 0, sawCutscene: false, holeOpen: false };
  const rt: Runtime = {
    state, vis, residents, front: [], boss: null, cut: null, clock: 0, promptOn: false,
    probe: { beat: 'reach', bossY: 0, facing: 0 },
    endingProbe: newEndingProbe(), opening: null, crackHinted: false, movieOnly: false, pendingEnding: false, pendingIntro: false,
  };
  runtimes.set(world, rt);
  world.level.data.camp2State = state;

  const p = world.player;
  p.vel.set(0, 0, 0);
  const at = world.level.data.startAt;
  const urlMovie = movieNow() !== null;
  if (at === 'intro') {
    // ムービー単体モード：扉を調べるムービーだけ
    rt.movieOnly = true;
    rt.pendingIntro = true;
  } else if (at === 'ending' || at === 'movie' || at === 'freed') {
    // エンディングから（「住民解放後」もここ）：戦闘なし。最初のフレームでムービーが始まる
    rt.movieOnly = at === 'movie' || urlMovie;
    rt.pendingEnding = true;
    p.pos.set(FIGHT_START.x, 0, FIGHT_START.z);
    p.yaw = FIGHT_START.yaw;
    p.pitch = FIGHT_START.pitch;
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
    if (rt.movieOnly) { endMovie(world, rt, 'intro'); return; }
    startFight(world, rt);
  });
}

/** ムービー単体モードの終わり：続きは遊ばせず、「もう一度見る」「一覧へ戻る」の画面を出す */
function endMovie(world: World, rt: Runtime, id: 'intro' | 'ending'): void {
  rt.state.phase = 'freed';
  world.input.locked = true;
  world.level.data.movieEnded = true;
  world.level.data.movieReplay = () => {
    world.level.data.nextLevel = { level: 'camp2', startAt: id === 'intro' ? 'intro' : 'movie' };
  };
  showMovieEnd(world.level.data.movieReplay as () => void, world);
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

/** 扉の開き具合（0..1）を見た目と当たり判定に反映する */
function applyDoor(world: World, rt: Runtime, k: number): void {
  const vis = rt.vis;
  const before = rt.state.doorOpen;
  rt.state.doorOpen = k;
  const e = k * k * (3 - 2 * k);
  vis.door.position.x = (DOOR.x0 + DOOR.x1) / 2 + e * DOOR.slide;
  vis.doorCollider.active = k < 0.6;
  vis.cageLight.intensity = 18 + 30 * e;
  if (before === 0 && k > 0) {
    const at = new THREE.Vector3((DOOR.x0 + DOOR.x1) / 2, 1.5, CAGE_Z);
    spawnShockwave(world, at, 0x7affb0, 3, 0.5);
    spawnBurst(world, at, 0x9affc8, 14, 4);
  }
}

// ---------------------------------------------------------------- エンディング
/** ジェネレーターの HP が 0 になった瞬間から。最後まで自動で流れる（スキップ可）。終わったら研究所 2 階へ（ムービーだけのときは最初から） */
function beginEnding(world: World, rt: Runtime): void {
  const st = rt.state;
  st.phase = 'ending';
  st.nearDoor = false;
  world.level.data.interactNear = false;
  showPrompt(null);
  rt.promptOn = false;
  world.input.locked = true;
  // 残った雑魚は止めて隠す。敵の弾も消す。倒れかけた本物のジェネレーターも隠す（見た目はムービーの代役が引き継ぐ）
  for (const e of world.enemies) {
    if (e.kind !== 'boss' && e.status !== 'dead' && e.status !== 'down' && !e.allied) shutdownEnemy(world, e);
    if (e.allied) continue;
    e.root.visible = false;
    if (e.kind === 'boss') e.deadTimer = 0;
  }
  for (const q of world.projectiles) q.dead = true;
  rt.vis.alarm.intensity = 0;
  const p = world.player;
  p.vel.set(0, 0, 0);
  p.invuln = Math.max(p.invuln, 1);
  world.level.rooms[0].cleared = true;
  world.level.rooms[1].cleared = true;
  world.level.data.objective = '';
  world.level.data.camp2Freed = true;
  if (!rt.movieOnly) { world.level.data.retryAt = 'ending'; grantCamp2Rewards(world); }
  rt.endingProbe = newEndingProbe();
    rt.cut = new Cutscene(world, (crt) => endingScript(crt, {
    vis: rt.vis, residents: rt.residents, setDoor: (k) => applyDoor(world, rt, k),
    holeOpen: rt.state.holeOpen, opening: rt.opening ?? undefined,
  }, rt.endingProbe), () => {
    rt.cut = null;
    st.phase = 'freed';
    if (rt.opening) { rt.opening.dispose(world.scene); rt.opening = null; }   // ボス戦中にあけた穴の屋根・街
    // 次のステージの切り替え（main.ts）が暗転して World を作り直すまで、画面は真っ黒のまま待つ
    world.scene.background = new THREE.Color(0x000000);
    world.scene.fog = null;
    world.scene.visible = false;
    if (rt.movieOnly) endMovie(world, rt, 'ending');
    else {
      // 収容所 2階クリア：永続フラグを立てる（サージの道が 2本目になり、2階の出口が最初から開く）
      markCamp2Cleared(world);
      world.level.data.nextLevel = { level: 'floor2' };
    }
  });
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

// ---------------------------------------------------------------- 天井の穴
/** 穴をあける（最大溜めの一発）。屋根・街・空が穴の向こうに見える。ムービーの命中と同じ見た目（camp2/ending.ts の buildRoof の割れ口） */
function openHole(world: World, rt: Runtime): void {
  const st = rt.state;
  if (st.holeOpen) return;
  st.holeOpen = true;
  rt.opening ??= buildCeilingOpening(world.scene);
  rt.opening.show(world.scene, rt.vis);
  const at = new THREE.Vector3(CEILING_HOLE.x, HALL.h - 0.1, CEILING_HOLE.z);
  spawnBurst(world, at, 0x9ff4ff, 36, 12, 0.6);
  spawnBurst(world, at.clone().setY(at.y - 0.6), 0x8a8078, 40, 8, 1.2);   // 落ちてくる瓦礫
  spawnShockwave(world, at, 0x9ff4ff, 8, 0.8);
  world.events.emit('explosion', { pos: at, radius: 4 });
  toast(world, '天井に穴があいた！', 3.5);
}

/** 天井のひびに自分の弾が当たったか調べる（通常の弾の処理のあとに、次に動く先を先読み）。最大溜めなら割れて、弱ければ小さな衝撃だけ */
const _p1 = new THREE.Vector3();
function updateCeilCracks(world: World, rt: Runtime, dt: number, t: number): void {
  const vis = rt.vis;
  const r = CEILING_HOLE.r * 1.25;
  vis.ceilCrackGlow.opacity = 0.28 + 0.14 * Math.sin(t * 2.4);
  const box = { min: new THREE.Vector3(CEILING_HOLE.x - r, HALL.h - 1.2, CEILING_HOLE.z - r), max: new THREE.Vector3(CEILING_HOLE.x + r, HALL.h + 1, CEILING_HOLE.z + r), active: true };
  const maxDmg = gunChargeMaxDamage(world);
  for (const q of world.projectiles) {
    if (q.dead || q.owner !== 'player') continue;
    _p1.copy(q.pos).addScaledVector(q.vel, dt * 1.5);
    const hit = segmentAABB(q.pos, _p1, { min: box.min.clone().subScalar(q.radius), max: box.max.clone().addScalar(q.radius), active: true });
    if (hit === null) continue;
    q.dead = true;
    const hp = q.pos.clone().lerp(_p1, hit);
    const charge = q.charged ? Math.max(0, Math.min(1, (q.damage - chargeDamage(0, maxDmg)) / Math.max(1e-6, chargeDamage(1, maxDmg) - chargeDamage(0, maxDmg)))) : 0;
    if (q.charged && charge >= CAMP2.holeCharge) { openHole(world, rt); return; }
    spawnBurst(world, hp, 0x8a8078, q.charged ? 12 : 5, q.charged ? 4 : 2.5);
    world.events.emit('impact', { pos: hp, owner: 'player' });
    if (!rt.crackHinted) { rt.crackHinted = true; toast(world, '天井にひびが…最大まで溜めて撃てば割れそうだ', 3.5); }
  }
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

  if (rt.pendingIntro && world.state === 'playing') { rt.pendingIntro = false; beginCutscene(world, rt); }
  if (rt.pendingEnding && world.state === 'playing') { rt.pendingEnding = false; beginEnding(world, rt); }
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
      beginEnding(world, rt);
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

  // ---- 天井のひび割れ：探索・戦闘中だけ狙える（ムービー中は ending.ts が見せる）
  if (st.phase === 'explore' || st.phase === 'fight') {
    if (!st.holeOpen) updateCeilCracks(world, rt, dt, t);
  }
  if (rt.opening?.shown) rt.opening.follow(world.camera);

  // ---- ムービー（通常のカメラ・ポーズの計算のあとに上書きするので最後）
  if (rt.cut) {
    p.invuln = Math.max(p.invuln, 0.5);
    rt.cut.update(world, dt);
  }
}
