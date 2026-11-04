// 導入（スパークの地下特別研究室）。使い方: 既定の開始（または URL に ?level=intro。&start=fight|wall|ask|free で途中から）。
// 流れ：① 目覚めのムービー → ② 天井からウォーカー → 操作の説明（画像つき）→ 「戦う」でチュートリアル1（ウォーカー1体）
//   → ③ モニターウォールへ。床から的ボックスが出てウォーカー3体が登場（動かない的）→ チュートリアル2（撃つ・吸収・送電）
//   → ④ スパーク「この建物の2階に…」→ はい／いいえ（いいえは何度でも）→ 冒険開始。ドアの前で B で外へ（研究所1階へ）。
// やられたら、操作の説明からやり直し（world.level.data.retryAt = 'fight'）。ムービーは Space / A 長押しでスキップできる。
import * as THREE from 'three';
import type { Enemy, World } from '../core/types';
import { aabbFromCenter } from '../core/collision';
import { createSpark, type Spark } from '../characters/spark';
import { buildSparkLab, type SparkLab } from '../scenes/sparkLab';
import { shutdownEnemy, spawnEnemy } from '../enemies/api';
import { spawnBurst, spawnShockwave } from '../core/effects';
import { toast } from '../core/combat';
import { Cutscene, type ScriptFactory } from '../cinematic/sequencer';
import { setPlayerFacing } from '../player/player';
import { showPrompt } from './floor1';
import * as L from './intro/layout';
import { askScript, noScript, wakeScript, walkerScript, wallScript, yesScript, type IntroStage } from './intro/script';
import { buildHatch, buildTargetBox, type Hatch, type TargetBox } from './intro/props';
import { hideChoice, hideExplain, introUiOpen, setChecklist, showChoice, showExplain, updateIntroUi } from './intro/ui';

export const INTRO_EXPOSURE = 1.05;
export type IntroPhase = 'wake' | 'drop' | 'explain' | 'fight' | 'won' | 'wall' | 'practice' | 'practiceDone' | 'ask' | 'choice' | 'reply' | 'free';

interface Practice { shot: boolean; absorb: boolean; send: boolean }

interface Runtime {
  phase: IntroPhase;
  lab: SparkLab;
  spark: Spark;
  hatch: Hatch;
  stage: IntroStage;
  cut: Cutscene | null;
  walker: Enemy | null;
  boxes: TargetBox[];
  targets: (Enemy | null)[];
  respawn: number[];
  practice: Practice;
  clock: number;
  t: number;
  unsub: Array<() => void>;
  promptOn: boolean;
  pending: string | null;
}
const runtimes = new WeakMap<World, Runtime>();

/** テスト・デバッグ用 */
export function getIntro(world: World): { phase: IntroPhase; cut: Cutscene | null; walker: Enemy | null; targets: (Enemy | null)[]; practice: Practice } | null {
  const rt = runtimes.get(world);
  if (!rt) return null;
  return { get phase() { return rt.phase; }, get cut() { return rt.cut; }, get walker() { return rt.walker; }, get targets() { return rt.targets; }, practice: rt.practice };
}

// ---------------------------------------------------------------- 構築
export function buildIntro(world: World): void {
  showPrompt(null);
  const scene = world.scene;
  scene.background = new THREE.Color(0x1b2230);
  scene.fog = null;
  const lab = buildSparkLab();
  scene.add(lab.root);

  // 当たり判定：床・天井・四方の壁・ベッド
  const R = L.ROOM;
  const T = 1;
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tag: string) =>
    world.colliders.push(aabbFromCenter(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0), tag));
  box(R.x0 - T, R.x1 + T, -1, 0, R.z0 - T, R.z1 + T, 'floor');
  box(R.x0 - T, R.x1 + T, R.h, R.h + 1, R.z0 - T, R.z1 + T, 'ceiling');
  box(R.x0 - T, R.x0, 0, R.h, R.z0 - T, R.z1 + T, 'wall');
  box(R.x1, R.x1 + T, 0, R.h, R.z0 - T, R.z1 + T, 'wall');
  box(R.x0, R.x1, 0, R.h, R.z0 - T, R.z0, 'wall');
  box(R.x0, R.x1, 0, R.h, R.z1, R.z1 + T, 'wall');
  box(-1.5, 1.5, 0, 0.95, -0.7, 0.7, 'bed');

  const spark = createSpark({ glasses: true });
  spark.setTablet(false);
  scene.add(spark.root);
  spark.root.position.set(L.SPARK_START.x, 0, L.SPARK_START.z);
  const hatch = buildHatch(L.DROP.x, L.DROP.z, R.h);
  scene.add(hatch.root);
  hatch.open(0);

  world.level.rooms = [{ name: 'スパークの研究室', min: new THREE.Vector3(R.x0, 0, R.z0), max: new THREE.Vector3(R.x1, R.h, R.z1), entered: true, cleared: false }];
  world.level.currentRoom = 0;
  world.level.bossSpawned = false;
  world.level.bossDefeated = false;
  world.level.data.interactNear = false;
  world.level.data.poseAim = false;
  world.level.data.remaining = 0;
  if (world.input) world.input.locked = false;

  const stage: IntroStage = { world, spark, hatch };
  const rt: Runtime = {
    phase: 'wake', lab, spark, hatch, stage, cut: null, walker: null, boxes: [], targets: [null, null, null], respawn: [-1, -1, -1],
    practice: { shot: false, absorb: false, send: false }, clock: 0, t: 0, unsub: [], promptOn: false, pending: null,
  };
  runtimes.set(world, rt);
  world.level.data.introState = rt;

  // チュートリアル2の達成を見る
  rt.unsub.push(world.events.on('enemyHit', () => { if (rt.phase === 'practice') rt.practice.shot = true; }));
  rt.unsub.push(world.events.on('absorbAttach', () => { if (rt.phase === 'practice') rt.practice.absorb = true; }));
  rt.unsub.push(world.events.on('overloadStart', () => { if (rt.phase === 'practice') rt.practice.send = true; }));

  const p = world.player;
  p.vel.set(0, 0, 0);
  const at = world.level.data.startAt as string | undefined;
  placePlayer(world, L.RYAN.x, L.RYAN.z, L.RYAN.yaw);
  if (at === 'fight') { rt.phase = 'drop'; rt.pending = 'explain'; }
  else if (at === 'wall') { rt.phase = 'wall'; rt.pending = 'wall'; }
  else if (at === 'ask') { rt.phase = 'ask'; rt.pending = 'ask'; }
  else if (at === 'free') { rt.phase = 'free'; rt.pending = 'free'; }
  else rt.pending = 'wake';
}

function placePlayer(world: World, x: number, z: number, yaw: number): void {
  const p = world.player;
  p.pos.set(x, 0, z);
  p.yaw = yaw;
  p.pitch = 0;
  setPlayerFacing(world, yaw);
  p.root.position.copy(p.pos);
}

// ---------------------------------------------------------------- ムービーの共通
function play(world: World, rt: Runtime, factory: ScriptFactory, onDone: () => void, fadeIn = true): void {
  world.input.locked = true;
  showPrompt(null);
  rt.promptOn = false;
  rt.cut = new Cutscene(world, factory, () => { rt.cut = null; onDone(); }, { fadeIn });
}

/** ウォーカー（チュートリアル1）を降下口の上に用意する。ムービーが動かす間は動かさない */
function prepareWalker(world: World, rt: Runtime, landed: boolean): void {
  const pos = new THREE.Vector3(L.DROP.x, landed ? 0 : L.DROP.y, L.DROP.z);
  const e = spawnEnemy(world, 'walker', pos);
  e.ai.passive = true;
  e.ai.yaw = Math.atan2(L.RYAN.x - L.DROP.x, L.RYAN.z - L.DROP.z);
  e.root.rotation.y = e.ai.yaw;
  rt.walker = e;
  rt.stage.walker = e;
  if (landed) rt.hatch.open(1);
}

// ---------------------------------------------------------------- ① 目覚め → ② 乱入 → 説明 → 戦闘
function beginWake(world: World, rt: Runtime): void {
  rt.phase = 'wake';
  world.level.data.objective = '';
  prepareWalker(world, rt, false);
  rt.walker!.root.visible = false;
  play(world, rt, (c) => wakeScript(c, rt.stage), () => beginDrop(world, rt));
}

function beginDrop(world: World, rt: Runtime): void {
  rt.phase = 'drop';
  rt.walker!.root.visible = true;
  play(world, rt, (c) => walkerScript(c, rt.stage), () => beginExplain(world, rt), false);
}

function beginExplain(world: World, rt: Runtime): void {
  rt.phase = 'explain';
  world.input.locked = true;
  const p = world.player;
  placePlayer(world, L.FIGHT_START.x, L.FIGHT_START.z, L.FIGHT_START.yaw);
  p.hp = p.maxHp;
  p.energy = p.maxEnergy;
  world.level.data.retryAt = 'fight';
  world.level.data.objective = '操作を確認して「戦う」';
  rt.spark.setPose('hips', 5);
  showExplain(() => beginFight(world, rt));
}

function beginFight(world: World, rt: Runtime): void {
  rt.phase = 'fight';
  world.input.locked = false;
  world.input.requestLock();
  const e = rt.walker!;
  e.ai.passive = false;
  e.ai.alert = 1e9;
  world.level.data.objective = 'ウォーカーを倒せ';
  world.level.data.remaining = 1;
  rt.spark.setPose('panic', 8);
  rt.spark.setGait(1);
  rt.t = 0;
}

/** 戦闘中のスパーク：部屋の隅へ逃げて待つ */
function sparkFlee(rt: Runtime, dt: number): void {
  const s = rt.spark.root.position;
  const dx = L.SAFE_CORNER.x - s.x, dz = L.SAFE_CORNER.z - s.z;
  const d = Math.hypot(dx, dz);
  if (d > 0.15) {
    const step = Math.min(d, 4.2 * dt);
    s.x += (dx / d) * step; s.z += (dz / d) * step;
    rt.spark.root.rotation.y = Math.atan2(dx, dz);
    rt.spark.setGait(1);
  } else {
    rt.spark.setGait(0);
    rt.spark.root.rotation.y = Math.atan2(L.DROP.x - s.x, L.DROP.z - s.z);
  }
}

// ---------------------------------------------------------------- ③ 的ボックス → チュートリアル2
function beginWall(world: World, rt: Runtime): void {
  rt.phase = 'wall';
  world.level.data.remaining = 0;
  world.level.data.objective = '';
  world.projectiles.forEach((q) => { q.dead = true; });
  rt.hatch.open(0);
  // 3体と箱（箱はせり上がるまで床の下）
  rt.boxes = L.WALL.zs.map((z) => { const b = buildTargetBox(L.WALL.x, z); world.scene.add(b.root); return b; });
  const walkers = L.WALL.zs.map((z) => {
    const e = spawnEnemy(world, 'walker', new THREE.Vector3(L.WALL.x + 0.15, 0, z));
    e.ai.passive = true;
    e.ai.yaw = -Math.PI / 2;
    e.root.visible = false;
    return e;
  });
  rt.targets = [...walkers];
  rt.stage.wall = { boxes: rt.boxes, walkers };
  placePlayer(world, L.MEET.ryan.x, L.MEET.ryan.z, L.MEET.ryan.yaw);
  const p = world.player;
  p.hp = p.maxHp;
  p.energy = p.maxEnergy;
  play(world, rt, (c) => wallScript(c, rt.stage), () => beginPractice(world, rt));
}

function beginPractice(world: World, rt: Runtime): void {
  rt.phase = 'practice';
  world.input.locked = false;
  world.input.requestLock();
  rt.practice = { shot: false, absorb: false, send: false };
  world.level.data.retryAt = 'wall';
  world.level.data.objective = '的で練習：撃つ・吸収・送電';
  rt.spark.setPose('idle', 5);
  rt.t = 0;
  refreshChecklist(rt);
}

function refreshChecklist(rt: Runtime): void {
  setChecklist([
    { label: '撃つ（左クリック／RT）', done: rt.practice.shot },
    { label: '吸収する（E／LB で、敵につなぐ）', done: rt.practice.absorb },
    { label: '送電する（つないだまま F／X 長押し）', done: rt.practice.send },
  ]);
}

/** 練習：倒れた的は補充（全部できるまで）。全部できたら、的を片づけて次へ */
function updatePractice(world: World, rt: Runtime, dt: number): void {
  const p = world.player;
  // 電力が尽きて練習が止まらないように
  if (p.energy < p.maxEnergy * 0.5) p.energy = Math.min(p.maxEnergy, p.energy + dt * 30);
  const done = rt.practice.shot && rt.practice.absorb && rt.practice.send;
  refreshChecklist(rt);
  if (done) {
    if (rt.t === 0) rt.t = world.time;
    if (world.time - rt.t > 1.6) endPractice(world, rt);
    return;
  }
  for (let i = 0; i < rt.targets.length; i++) {
    const e = rt.targets[i];
    const gone = !e || e.status === 'dead' || e.status === 'down' || !world.enemies.includes(e);
    if (!gone) { rt.respawn[i] = -1; continue; }
    if (rt.respawn[i] < 0) { rt.respawn[i] = 1.2; continue; }    // 倒れた：少し待ってから補充
    rt.respawn[i] -= dt;
    if (rt.respawn[i] > 0) continue;
    // 新しいのが登場
    const z = L.WALL.zs[i];
    const pos = new THREE.Vector3(L.WALL.x - L.WALL.walkOut, 0, z);
    const n = spawnEnemy(world, 'walker', pos);
    n.ai.passive = true;
    n.ai.yaw = -Math.PI / 2;
    n.root.rotation.y = n.ai.yaw;
    spawnShockwave(world, pos.clone().setY(0.05), 0x7fe8ff, 1.6, 0.45);
    spawnBurst(world, pos.clone().setY(1), 0x9ff4ff, 10, 3.5, 0.45);
    rt.targets[i] = n;
    rt.respawn[i] = -1;
  }
}

function endPractice(world: World, rt: Runtime): void {
  rt.phase = 'practiceDone';
  setChecklist(null);
  for (const e of rt.targets) if (e && world.enemies.includes(e) && e.status !== 'dead' && e.status !== 'down') shutdownEnemy(world, e);
  world.projectiles.forEach((q) => { q.dead = true; });
  toast(world, '練習おわり！', 3);
  rt.boxes.forEach((b) => b.dispose());
  rt.boxes = [];
  beginAsk(world, rt);
}

// ---------------------------------------------------------------- ④ 出発
function beginAsk(world: World, rt: Runtime): void {
  rt.phase = 'ask';
  world.level.data.objective = '';
  placePlayer(world, L.AT_WALL.ryan.x, L.AT_WALL.ryan.z, L.AT_WALL.ryan.yaw);
  rt.spark.root.position.set(L.AT_WALL.spark.x, 0, L.AT_WALL.spark.z);
  play(world, rt, (c) => askScript(c, rt.stage), () => beginChoice(world, rt), false);
}

function beginChoice(world: World, rt: Runtime): void {
  rt.phase = 'choice';
  world.input.locked = true;
  showChoice((yes) => reply(world, rt, yes));
}

function reply(world: World, rt: Runtime, yes: boolean): void {
  rt.phase = 'reply';
  if (yes) play(world, rt, (c) => yesScript(c, rt.stage), () => beginFree(world, rt), false);
  else play(world, rt, (c) => noScript(c, rt.stage), () => beginChoice(world, rt), false);
}

function beginFree(world: World, rt: Runtime): void {
  rt.phase = 'free';
  world.input.locked = false;
  world.input.requestLock();
  world.level.data.retryAt = 'free';
  world.level.data.objective = 'ドアから外へ出よう';
  rt.spark.setPose('idle', 5);
  hideChoice();
}

// ---------------------------------------------------------------- 更新
export function updateIntro(world: World, dt: number): void {
  const rt = runtimes.get(world);
  if (!rt) return;
  const p = world.player;
  rt.clock += dt;
  rt.lab.update(dt);

  // 最初のフレーム（プレイヤーの見た目ができてから）に始める
  if (rt.pending && world.state === 'playing') {
    const next = rt.pending;
    rt.pending = null;
    if (next === 'wake') beginWake(world, rt);
    else if (next === 'explain') {
      prepareWalker(world, rt, true);
      rt.spark.root.position.set(L.RYAN.x - 0.9, 0, 0);
      rt.spark.root.rotation.y = Math.PI / 2;
      beginExplain(world, rt);
    }
    else if (next === 'wall') beginWall(world, rt);
    else if (next === 'ask') beginAsk(world, rt);
    else if (next === 'free') beginFree(world, rt);
  }

  updateIntroUi(world.input);
  if (introUiOpen()) world.input.locked = true;

  const ph = rt.phase;
  if (ph !== 'wake' && ph !== 'drop' && ph !== 'wall' && ph !== 'ask' && ph !== 'reply') rt.spark.update(dt);

  if (ph === 'fight') {
    sparkFlee(rt, dt);
    const e = rt.walker;
    const gone = !e || e.status === 'dead' || e.status === 'down' || !world.enemies.includes(e);
    if (gone) {
      rt.phase = 'won';
      rt.t = world.time;
      world.level.data.remaining = 0;
      world.level.data.objective = '';
    }
  } else if (ph === 'won') {
    // 倒れる演出を少し見せてから、モニターウォールのムービーへ
    sparkFlee(rt, dt);
    if (world.time - rt.t > 1.6) beginWall(world, rt);
  } else if (ph === 'practice') {
    updatePractice(world, rt, dt);
  } else if (ph === 'free') {
    updateDoor(world, rt);
  }

  if (rt.cut) {
    p.invuln = Math.max(p.invuln, 0.5);
    rt.cut.update(world, dt);
  }
}

/** 自由に動ける最後の場面：ドアの前で B → 研究所 1 階へ */
function updateDoor(world: World, rt: Runtime): void {
  const p = world.player;
  const near = Math.hypot(p.pos.x - L.DOOR.x, p.pos.z - L.DOOR.z) < L.DOOR.reach;
  world.level.data.interactNear = near;
  if (near) {
    showPrompt('調べる（B / R）：外へ出る');
    if (!rt.promptOn) world.events.emit('interactPrompt', {});
    rt.promptOn = true;
    if (world.input.pressed('PadB') || world.input.pressed('KeyR')) {
      disposeIntro(world);
      world.level.data.nextLevel = { level: 'floor1' };
    }
  } else if (rt.promptOn) {
    showPrompt(null);
    rt.promptOn = false;
  }
}

/** 世界を作り直すとき（タイトルへ・リトライ）の後始末 */
export function disposeIntro(world: World): void {
  const rt = runtimes.get(world);
  if (!rt) return;
  rt.unsub.forEach((u) => u());
  rt.unsub = [];
  hideExplain();
  hideChoice();
  setChecklist(null);
  showPrompt(null);
}
