// ドレイン装置の部屋（?level=drainBoss。&start=corridor 通路のスタート／boss ボス戦の開始地点／movie 導入ムービーだけ）。
// トロッコ面（level/minecart）をクリアするとここへ来る。まっすぐな暗い通路を北へ歩く → 自動ドアが開く → 入ると導入ムービー（drainBoss/cutscene.ts）
// → ボス戦（ドレインガーディアン。enemies/kinds/drainGuard.ts。ザコ敵はいない）。
// 胴体を倒すとボスが崩れて爆発し、HPバーが消えて「ドレイン装置の破壊は準備中」。撃破ムービーは onBossDefeated() に差し込む。
// やられたら、ムービーなしでボス戦の開始状態（world.level.data.retryAt = 'boss'）からやり直す。撃破済みの記録はセーブされる。
import * as THREE from 'three';
import type { Enemy, World } from '../core/types';
import { toast } from '../core/combat';
import { spawnEnemy } from '../enemies/api';
import { Cutscene } from '../cinematic/sequencer';
import { movieNow, showMovieEnd } from '../cinematic/movieMode';
import { showPrompt } from './floor1';
import { ARENA, BOSS_FIGHT, CORRIDOR, DEVICE, DOOR, GEAR_POSITIONS, GRAPPLE_PTS, START, v3 } from './drainBoss/layout';
import { buildUpperRoom, type UpperGear, type UpperRoom } from './drainBoss/upper';
import { clearGrapplePoints, registerGrapplePoint } from '../core/grapple';
import { clearGrabbables, getGrabbables, registerGrabbable } from '../core/armGrab';
import { buildDrainBossVisuals, type DrainBossVisuals } from './drainBoss/visuals';
import { applyFightStartState, drainBossScript, newBossCutProbe, type BossCutProbe } from './drainBoss/cutscene';
import { FLOOR } from '../enemies/kinds/drainGuardModel';
import { getGuard } from '../enemies/kinds/drainGuard';
import { setPlayerFacing } from '../player/player';

export const DRAIN_BOSS_EXPOSURE = 1.2;

export type DrainBossStart = 'corridor' | 'boss' | 'movie';
export const DRAIN_BOSS_STARTS: DrainBossStart[] = ['corridor', 'boss', 'movie'];
export type DrainBossPhase = 'corridor' | 'cutscene' | 'fight' | 'defeated' | 'movieEnd';

export interface DrainBossState {
  phase: DrainBossPhase;
  /** 自動ドアの開き具合 0..1 */
  doorOpen: number;
  /** ボスを倒した（セーブされる） */
  defeated: boolean;
  /** 導入ムービーを見た（リトライで飛ばしたときは false のまま） */
  sawCutscene: boolean;
  nearDevice: boolean;
}

interface Runtime {
  world: World;
  state: DrainBossState;
  vis: DrainBossVisuals;
  /** 穴の上の部屋（格納庫・搬出通路・歯車の保管庫） */
  up: UpperRoom;
  boss: Enemy | null;
  cut: Cutscene | null;
  probe: BossCutProbe;
  movieOnly: boolean;
  pendingIntro: boolean;
  clock: number;
  promptOn: boolean;
  startAt: DrainBossStart;
}
const runtimes = new WeakMap<World, Runtime>();

// ---------------------------------------------------------------- 記録（セーブ）
/** gears＝取った歯車の番号（layout.ts の GEAR_POSITIONS の順。ひとつも取っていなければ付けない） */
interface Memo { defeated: boolean; gears?: number[] }
let memo: Memo | null = null;
export function getDrainBossMemo(): Memo | null { return memo ? { ...memo, ...(memo.gears ? { gears: [...memo.gears] } : {}) } : null; }
/** つづきから：セーブの記録を戻す（build より前に呼ぶ）。壊れた形は捨てる */
export function setDrainBossMemo(m: unknown): void {
  memo = null;
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof (m as Memo).defeated !== 'boolean') return;
  const g = (m as Memo).gears;
  if (g === undefined) { memo = { defeated: (m as Memo).defeated }; return; }
  const ok = Array.isArray(g) && g.every((i) => Number.isInteger(i) && i >= 0 && i < GEAR_POSITIONS.length) && new Set(g).size === g.length;
  if (ok && g.length > 0) memo = { defeated: (m as Memo).defeated, gears: [...g] };
  else if (ok) memo = { defeated: (m as Memo).defeated };
}

/** トロッコ面をクリアして着いたときの案内（次の build で表示する） */
let arrival: string | null = null;
export function setDrainBossArrival(text: string | null): void { arrival = text; }

/** テスト・デバッグ用 */
export function getDrainBoss(world: World): { state: DrainBossState; boss: Enemy | null; cut: Cutscene | null; probe: BossCutProbe; vis: DrainBossVisuals; up: UpperRoom } | null {
  const rt = runtimes.get(world);
  if (!rt) return null;
  return { state: rt.state, vis: rt.vis, up: rt.up, probe: rt.probe, get boss() { return rt.boss; }, get cut() { return rt.cut; } };
}

// ---------------------------------------------------------------- 構築
export function buildDrainBoss(world: World): void {
  showPrompt(null);
  const given = world.level.data.startAt as string | undefined;
  const startAt: DrainBossStart = DRAIN_BOSS_STARTS.includes(given as DrainBossStart) ? (given as DrainBossStart) : 'corridor';
  if (!given) memo = null;
  const scene = world.scene;
  scene.background = new THREE.Color(0x05070b);
  scene.fog = new THREE.Fog(0x05070b, 70, 170);
  const vis = buildDrainBossVisuals();
  scene.add(vis.root);
  for (const l of vis.lights) scene.add(l);
  for (const c of vis.colliders) world.colliders.push(c);
  // 穴の上の部屋（ボスが落ちてきた元の場所）。穴は撃破までシャッター＋plug でふさぐ
  const up = buildUpperRoom();
  scene.add(up.root);
  for (const l of up.lights) scene.add(l);
  for (const c of up.colliders) world.colliders.push(c);
  clearGrapplePoints(world);
  clearGrabbables(world);

  const A = ARENA, C = CORRIDOR;
  world.level.rooms = [
    { name: 'ドレイン装置の部屋', min: v3(A.x0, 0, A.z0), max: v3(A.x1, A.h, A.z1), entered: true, cleared: false },
    { name: '通路', min: v3(C.x0, 0, C.z0), max: v3(C.x1, C.h, C.z1), entered: true, cleared: false },
  ];
  world.level.currentRoom = 1;
  world.level.bossSpawned = false;
  world.level.bossDefeated = false;      // true にするとゲームクリア画面になる（main.ts）。倒した記録は state.defeated
  world.level.data.interactNear = false;
  world.level.data.poseAim = false;
  world.level.data.remaining = 0;
  world.level.data.retryAt = startAt === 'boss' ? 'boss' : 'corridor';
  if (world.input) world.input.locked = false;

  const state: DrainBossState = { phase: 'corridor', doorOpen: 0, defeated: memo?.defeated === true, sawCutscene: false, nearDevice: false };
  const rt: Runtime = {
    world, state, vis, up, boss: null, cut: null, probe: newBossCutProbe(), movieOnly: false, pendingIntro: false, clock: 0, promptOn: false, startAt,
  };
  runtimes.set(world, rt);
  world.level.data.drainBoss = state;
  for (const id of memo?.gears ?? []) { const g = up.gears[id]; if (g) hideGear(world, g); }
  world.level.data.gears = takenGears(rt).length;
  for (const [i, g] of up.gears.entries()) registerGrabbable(world, { pos: new THREE.Vector3(g.x, g.y, g.z), radius: 1.0, enabled: !g.taken, obj: g.model, onGrab: () => takeGear(world, rt, i) });

  const p = world.player;
  p.vel.set(0, 0, 0);
  if (startAt === 'movie') {
    // ムービー単体モード：すぐ導入ムービー
    rt.movieOnly = true;
    rt.pendingIntro = true;
    p.pos.set(0, 0, DOOR.z + 4);
    setPlayerFacing(world, 0);
  } else if (startAt === 'boss') {
    // リトライ・チェックポイント：ムービーなしで戦闘開始の状態から。撃破済みなら部屋だけ
    applyDoor(world, rt, 1);
    if (state.defeated) { applyFightStartState(world, vis, null); state.phase = 'defeated'; }
    else startFight(world, rt, null);
  } else {
    p.pos.set(START.x, 0, START.z);
    p.yaw = START.yaw; p.pitch = 0;
    setPlayerFacing(world, START.yaw);
    if (state.defeated) { applyDoor(world, rt, 1); vis.breakTiles(true); state.phase = 'defeated'; }
  }
  if (state.defeated) openUpper(world, rt);
  up.setBroken(vis.tilesBroken);
  world.level.data.objective = objective(rt);
  if (arrival && startAt === 'corridor') { toast(world, arrival, 5); }
  arrival = null;
}

function objective(rt: Runtime): string {
  switch (rt.state.phase) {
    case 'corridor': return '通路をまっすぐ進め';
    case 'fight': return 'ドレインガーディアンを倒せ（右腕・胴体・左腕）';
    case 'defeated': return 'ドレイン装置を破壊しろ（準備中）／天井の穴の上に足場が出た';
    default: return '';
  }
}

function applyDoor(world: World, rt: Runtime, k: number): void {
  const before = rt.state.doorOpen;
  rt.state.doorOpen = k;
  rt.vis.setDoor(k);
  if (before === 0 && k > 0) world.events.emit('doorOpen', { pos: v3(0, 2, DOOR.z) });
}

// ---------------------------------------------------------------- ムービー → 戦闘
function beginCutscene(world: World, rt: Runtime): void {
  const st = rt.state;
  st.phase = 'cutscene';
  showPrompt(null);
  rt.promptOn = false;
  world.level.data.interactNear = false;
  world.input.locked = true;
  // ムービーの間だけ置いておく本物のボス（当たらず動かない・降りてくるまで見えない）
  const boss = spawnEnemy(world, 'drainGuard', v3(0, 25, 4));
  boss.ai.alert = 1e9;
  boss.ai.inert = true;
  boss.root.visible = false;
  rt.boss = boss;
  rt.cut = new Cutscene(world, (crt) => drainBossScript(crt, { vis: rt.vis, boss, setDoor: (k) => applyDoor(world, rt, k), probe: rt.probe }), () => {
    rt.cut = null;
    st.sawCutscene = true;
    if (rt.movieOnly) { endMovie(world, rt); return; }
    startFight(world, rt, boss);
  });
}

/** ムービー単体モードの終わり：続きは遊ばせず「もう一度見る」「一覧へ戻る」の画面を出す */
function endMovie(world: World, rt: Runtime): void {
  rt.state.phase = 'movieEnd';
  world.input.locked = true;
  world.level.data.movieEnded = true;
  world.level.data.movieReplay = () => { world.level.data.nextLevel = { level: 'drainBoss', startAt: 'movie' }; };
  showMovieEnd(world.level.data.movieReplay as () => void, world);
}

/** 戦闘開始（ムービーの終わり・スキップ・リトライの共通）。boss があればそのボス、なければここで出す */
function startFight(world: World, rt: Runtime, boss: Enemy | null): void {
  const st = rt.state;
  st.phase = 'fight';
  if (!boss) {
    boss = spawnEnemy(world, 'drainGuard', v3(BOSS_FIGHT.x, FLOOR, BOSS_FIGHT.z));
    boss.ai.yaw = 0;
  }
  applyFightStartState(world, rt.vis, boss);
  boss.ai.alert = 1e9;
  boss.ai.inert = false;
  boss.ai.gapT = 1.6;
  rt.boss = boss;
  world.input.locked = false;
  world.player.invuln = Math.max(world.player.invuln, 1);
  world.level.bossSpawned = true;
  world.level.data.retryAt = 'boss';
  world.level.data.objective = objective(rt);
  world.level.data.saveDirty = true;
  rt.vis.suck = 0.6;
  rt.up.setShutter(true);   // 戦闘中は穴に非常シャッター（撃破まで上へは逃げられない）
  world.events.emit('bossStart', {});
}

// ---------------------------------------------------------------- 撃破
/**
 * ボスを倒した直後（胴体HPが0）。いまは仮：ボスの崩れ・爆発（enemies.ts の bossDeath）→ HPバー消去 → 「準備中」の案内だけ。
 * ★撃破ムービーを入れるときは、ここで world.input.locked = true にして Cutscene を作り（camp2 の beginEnding を参考）、
 *   終わりで finishDefeat(world, rt) を呼ぶ。ボスの死体は boss.status==='dead' のあいだ残る。
 */
function onBossDefeated(world: World, rt: Runtime): void {
  const st = rt.state;
  st.defeated = true;
  remember(rt);
  for (const q of world.projectiles) q.dead = true;
  finishDefeat(world, rt);
}

function finishDefeat(world: World, rt: Runtime): void {
  rt.state.phase = 'defeated';
  world.level.rooms[0].cleared = true;
  world.level.data.retryAt = 'boss';
  world.level.data.objective = objective(rt);
  openUpper(world, rt);
  toast(world, 'ドレインガーディアンを倒した！ ドレイン装置の破壊は準備中', 6);
  toast(world, '天井の非常シャッターが開き、穴の横に足場が現れた。ボスが落ちてきた上の階へ行ける', 6);
  world.events.emit('roomClear', { index: 0 });
}

// ---------------------------------------------------------------- 穴の上の部屋・歯車
/** 撃破後：シャッターを開け、足場とグラップルポイントを出す（つづきから・チェックポイントでも撃破済みなら最初から） */
function openUpper(world: World, rt: Runtime): void {
  if (rt.up.open) return;
  rt.up.setOpen(true);
  for (const g of GRAPPLE_PTS) registerGrapplePoint(world, { pos: v3(g.x, g.y, g.z), normal: v3(g.nx, 0, g.nz), kind: 'ledge' });
}
const takenGears = (rt: Runtime): number[] => rt.up.gears.flatMap((g, i) => (g.taken ? [i] : []));
/** 記録（セーブ）を今の状態にそろえる */
function remember(rt: Runtime): void {
  const gears = takenGears(rt);
  memo = { defeated: rt.state.defeated, ...(gears.length ? { gears } : {}) };
  rt.world.level.data.saveDirty = true;
}
function hideGear(world: World, g: UpperGear): void {
  g.taken = true;
  g.model.visible = false;
  for (const gb of getGrabbables(world)) if (gb.obj === g.model) gb.enabled = false;
}
/** 歯車を取得する（触れた／アームで掴んで引き戻した） */
function takeGear(world: World, rt: Runtime, i: number): void {
  const g = rt.up.gears[i];
  if (!g || g.taken) return;
  hideGear(world, g);
  const n = takenGears(rt).length;
  world.level.data.gears = n;
  world.inventory.gears++; // 全体の所持品（HUD はこちらを読む）
  world.events.emit('gearPickup', {});
  toast(world, `強化素材（歯車）を入手 ×${n}/${rt.up.gears.length}`, 3);
  remember(rt);
}

// ---------------------------------------------------------------- 更新
export function updateDrainBoss(world: World, dt: number): void {
  const rt = runtimes.get(world);
  if (!rt) return;
  const { state: st, vis } = rt;
  const p = world.player;
  rt.clock += dt;
  vis.update(rt.clock, dt);
  rt.up.setBroken(vis.tilesBroken);
  rt.up.update(rt.clock, dt);
  // 歯車：触れたら取れる（アームで掴んでも取れる）
  if (rt.up.open && p.hp > 0) {
    for (const [i, g] of rt.up.gears.entries()) {
      if (g.taken) continue;
      const dx = g.x - p.pos.x, dz = g.z - p.pos.z, dy = g.y - (p.pos.y + 0.9);
      if (dx * dx + dz * dz < 1.6 * 1.6 && Math.abs(dy) < 2.0) takeGear(world, rt, i);
    }
  }
  world.level.currentRoom = p.pos.z > DOOR.z ? 1 : 0;

  if (rt.pendingIntro && world.state === 'playing') { rt.pendingIntro = false; beginCutscene(world, rt); }

  // ---- 自動ドア：近づくとスライドで開く。入るとムービー
  if ((st.phase === 'corridor' || st.phase === 'defeated') && st.doorOpen < 1) {
    const d = Math.hypot(p.pos.x, p.pos.z - DOOR.z);
    if (d < DOOR.openDist || st.doorOpen > 0) applyDoor(world, rt, Math.min(1, st.doorOpen + dt / 1.3));
  }
  if (st.phase === 'corridor' && p.hp > 0 && world.state === 'playing' && p.pos.z < DOOR.z + 2.2 && st.doorOpen >= 0.5) {
    if (st.defeated) st.phase = 'defeated';
    else beginCutscene(world, rt);
  }

  // ---- 戦闘中：ボスが倒れたら
  if (st.phase === 'fight') {
    const boss = rt.boss;
    if (boss && (boss.status === 'dead' || getGuard(boss).dead)) onBossDefeated(world, rt);
    world.level.data.remaining = 1;
  } else world.level.data.remaining = 0;

  // ---- 撃破後：ドレイン装置を調べる（準備中）
  let hint: string | null = null;
  st.nearDevice = false;
  if (st.phase === 'defeated' && p.hp > 0) {
    const dx = p.pos.x - (DEVICE.x0 - 4), dz = p.pos.z - (DEVICE.z0 + DEVICE.z1) / 2;
    if (Math.abs(dx) < 6 && Math.abs(dz) < 16) { st.nearDevice = true; hint = '調べる（B / R）：ドレイン装置'; }
  }
  world.level.data.interactNear = st.nearDevice;
  if (hint) {
    showPrompt(hint);
    if (!rt.promptOn) world.events.emit('interactPrompt', {});
    rt.promptOn = true;
    if (world.input.pressed('PadB') || world.input.pressed('KeyR')) toast(world, 'ドレイン装置の破壊は準備中…（次のステップで実装予定）', 4);
  } else if (rt.promptOn) { showPrompt(null); rt.promptOn = false; }

  // ---- ムービー（通常のカメラ・ポーズの計算のあとに上書きするので最後）
  if (rt.cut) {
    p.invuln = Math.max(p.invuln, 0.5);
    rt.cut.update(world, dt);
  }
  void movieNow;
}
