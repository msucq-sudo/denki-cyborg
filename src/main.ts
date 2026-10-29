import * as THREE from 'three';
import { Input } from './core/input';
import { EventBus } from './core/events';
import { createWorld } from './core/world';
import type { World } from './core/types';
import { updateProjectiles } from './core/projectiles';
import { updatePickups } from './core/pickups';
import { updateEffects } from './core/effects';
import { initPlayer, updatePlayer, updateGun, setPlayerWeapon } from './player/player';
import { initAbsorb, updateAbsorb } from './abilities/absorb';
import { initHack, updateHack } from './abilities/hack';
import { updateGrapple } from './core/grapple';
import { initFunctions, updateFunctions } from './abilities/functions';
import { updateEnemies } from './enemies/api';
import { buildDungeon, updateLevel } from './level/dungeon';
import { buildFloor1, buildFloor1Revisit, updateFloor1, FLOOR1_EXPOSURE } from './level/floor1';
import { buildFloor2, updateFloor2, floor2Hooks, wakeFromRest, FLOOR2_EXPOSURE } from './level/floor2';
import { buildSurge, updateSurge, SURGE_EXPOSURE } from './level/surge';
import { CAMERA, CHARACTER } from './config/balance';
import { createHUD } from './ui/hud';
import { createUpgradeScreen } from './ui/upgradeScreen';
import { initAudio, resumeAudio, updateAudio } from './audio/sfx';
import './ui/style.css';

// ?level=floor1 で研究所1階、?level=floor2 で2階（サイボーグ改造室）、?level=surge でガレージ→サージ収容所への道。
// 既定はアルファ版ダンジョン。?start=drive のように開始地点を指定できる（レベルが world.level.data.startAt を読む）
type LevelId = 'dungeon' | 'floor1' | 'floor2' | 'surge';
const urlQ = new URLSearchParams(location.search);
const levelParam = urlQ.get('level');
let levelId: LevelId = levelParam === 'floor1' || levelParam === 'floor2' || levelParam === 'surge' ? levelParam : 'dungeon';
/** 次に作る World の開始地点（レベルごとの意味。リトライ地点にも使う） */
let startAt: string | undefined = urlQ.get('start') ?? undefined;
/** 2階から1階へ戻ってきた（戦闘は解決済みの状態で始める） */
let floor1Revisit = false;
const LEVELS: Record<LevelId, { build: (w: World) => void; tick: (w: World, dt: number) => void; exposure: number }> = {
  dungeon: { build: buildDungeon, tick: updateLevel, exposure: 1.05 },
  floor1: { build: (w) => (floor1Revisit ? buildFloor1Revisit(w) : buildFloor1(w)), tick: updateFloor1, exposure: FLOOR1_EXPOSURE },
  floor2: { build: buildFloor2, tick: updateFloor2, exposure: FLOOR2_EXPOSURE },
  surge: { build: buildSurge, tick: updateSurge, exposure: SURGE_EXPOSURE },
};
const container = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LEVELS[levelId].exposure;
container.appendChild(renderer.domElement);

const events = new EventBus();
const input = new Input(renderer.domElement);
initAudio(events);

// 強化画面（2階のベッドで眠り終わると開く）。画面は1つだけ作って使い回す
const upgradeScreen = createUpgradeScreen(input, events);
floor2Hooks.onSleepComplete = (w) => {
  if (w !== world) return false;
  upgradeScreen.open(w, { onClose: () => wakeFromRest(w) });
  return true;
};
// ?gears=N で歯車 N 個から始める（強化画面の確認用）
const gearsParam = Number(new URLSearchParams(location.search).get('gears'));

let world: World = newWorld();
let hadLock = false;

const hud = createHUD(document.getElementById('hud')!, {
  onStart: () => startGame(),
  onRetry: () => retry(),
  onResume: () => resume(),
  onTitle: () => { world = newWorld(); hud.showScreen(world); },
});
hud.showScreen(world);

function newWorld(): World {
  // 古いワールドの後始末
  if ((globalThis as any).__oldWorld) disposeWorld((globalThis as any).__oldWorld);
  const w = createWorld(input, events, window.innerWidth / window.innerHeight);
  if (startAt) w.level.data.startAt = startAt;
  LEVELS[levelId].build(w);
  if (Number.isFinite(gearsParam) && gearsParam > 0) w.inventory.gears = Math.floor(gearsParam);
  initPlayer(w);
  initAbsorb(w);
  initHack(w);
  initFunctions(w);
  (globalThis as any).__oldWorld = w;
  exposeDebug(w);
  return w;
}

// ---- 階の移動（エレベーター）：暗転 → 次の階を作る → 明転。プレイヤーの状態は引き継ぐ
const FADE_OUT = 0.45, FADE_IN = 0.7;
let pendingFloor = 0;
let pendingLevel: { level: LevelId; startAt?: string } | null = null;
let fadeT = 0;
let fadeIn = 0;
const fadeEl = document.createElement('div');
fadeEl.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;z-index:30;pointer-events:none';
document.body.appendChild(fadeEl);

/** 次のステージ（または同じステージの別の開始地点）へ。所持品・強化などは引き継ぐ */
function changeLevel(to: LevelId, start?: string, opts: { keepHp?: boolean } = { keepHp: true }): void {
  const prev = world;
  const keep = {
    hp: prev.player.hp, energy: prev.player.energy, inventory: { ...prev.inventory }, upgrades: { ...prev.upgrades }, functions: { ...prev.functions },
    stats: { ...prev.stats },
  };
  levelId = to;
  startAt = start;
  renderer.toneMappingExposure = LEVELS[levelId].exposure;
  world = newWorld();
  if (opts.keepHp) Object.assign(world.player, { hp: keep.hp, energy: keep.energy });
  world.inventory = keep.inventory;
  world.upgrades = keep.upgrades;
  world.functions = keep.functions;
  Object.assign(world.stats, keep.stats);
}

/**
 * 死亡画面のリトライ。レベルが world.level.data.retryAt を設定していれば、そこから（所持品・強化は残す。HP・電力は満タン）。
 * なければ従来どおり最初から
 */
function retry(): void {
  const at = world.level.data.retryAt as string | undefined;
  if (at) changeLevel(levelId, at, { keepHp: false });
  else world = newWorld();
  startGame();
}

function changeFloor(to: 1 | 2): void {
  const from = levelId === 'floor2' ? 2 : 1;
  floor1Revisit = to === 1;
  changeLevel(to === 2 ? 'floor2' : 'floor1');
  world.state = 'playing';
  input.enabled = true;
  input.locked = false;
  input.resetAll();
  events.emit('floorChange', { from, to });
  hud.showScreen(world);
}

function disposeWorld(w: World): void {
  w.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
  });
}

function startGame(): void {
  resumeAudio();
  world.state = 'playing';
  world.stats.startTime = world.time;
  input.enabled = true;
  input.requestLock();
  events.emit('gameStart', {});
  hud.showScreen(world);
  // スパークとの会話（'comm' イベント）は後で実装。仕組みだけ HUD にある
}

function resume(): void {
  if (world.state !== 'paused') return;
  world.state = 'playing';
  input.requestLock();
  hud.showScreen(world);
}

function pause(): void {
  if (world.state !== 'playing') return;
  world.state = 'paused';
  input.resetAll();
  input.exitLock();
  hud.showScreen(world);
}

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) hadLock = true;
  else if (hadLock && world.state === 'playing' && !upgradeScreen.isOpen) pause();
});
renderer.domElement.addEventListener('click', () => {
  if (world.state === 'playing' && !document.pointerLockElement) input.requestLock();
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  world.camera.aspect = window.innerWidth / window.innerHeight;
  world.camera.updateProjectionMatrix();
});

const clock = new THREE.Clock();
// ?manual を付けると自動ループを止める（テストから __game.step / __game.render で駆動）
const manual = new URLSearchParams(location.search).has('manual');
function frame(): void {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  step(dt);
  drawScene();
  if (!manual) requestAnimationFrame(frame);
}

/** 強化画面が開いている間は、本編のシーンの代わりに画面の3Dモデルを描く */
function drawScene(): void {
  if (upgradeScreen.isOpen) upgradeScreen.render(renderer);
  else renderer.render(world.scene, world.camera);
}

/** 1ステップ進める（テストからも呼べる） */
function step(dt: number): void {
  input.pollGamepad(dt);
  world.time += dt;
  if (world.state === 'playing') {
    if (input.pressed('KeyP')) { pause(); input.endFrame(); return; }
    updatePlayer(world, dt);
    updateFunctions(world, dt);
    updateGun(world, dt);
    updateAbsorb(world, dt);
    updateHack(world, dt);
    updateGrapple(world, dt);
    updateEnemies(world, dt);
    updateProjectiles(world, dt);
    updatePickups(world, dt);
    LEVELS[levelId].tick(world, dt);
    for (const t of world.toasts) t.timer -= dt;
    world.toasts = world.toasts.filter((t) => t.timer > 0);

    // エレベーターに乗った：暗転してから次の階へ
    const nf = world.level.data.nextFloor;
    if (!pendingFloor && (nf === 1 || nf === 2)) { pendingFloor = nf; fadeT = 0; input.locked = true; }
    // 別のステージへ（例：2階の西の出口 → { level: 'surge' }）
    const nl = world.level.data.nextLevel as { level: LevelId; startAt?: string } | undefined;
    if (!pendingFloor && nl && LEVELS[nl.level]) { pendingFloor = -1; pendingLevel = nl; fadeT = 0; input.locked = true; }
    if (pendingFloor) {
      fadeT += dt;
      fadeEl.style.opacity = String(Math.min(1, fadeT / FADE_OUT));
      if (fadeT >= FADE_OUT) {
        const to = pendingFloor;
        pendingFloor = 0;
        if (to === -1 && pendingLevel) {
          const nl = pendingLevel;
          pendingLevel = null;
          changeLevel(nl.level, nl.startAt);
          world.state = 'playing';
          input.enabled = true;
          input.locked = false;
          input.resetAll();
          hud.showScreen(world);
        } else changeFloor(to as 1 | 2);
        fadeIn = FADE_IN;
        fadeEl.style.opacity = '1';
      }
    } else if (fadeIn > 0) {
      fadeIn = Math.max(0, fadeIn - dt);
      fadeEl.style.opacity = String(fadeIn / FADE_IN);
    }

    if (world.player.hp <= 0) {
      world.state = 'gameover';
      world.stats.endTime = world.time;
      input.exitLock();
      events.emit('gameOver', {});
      hud.showScreen(world);
    } else if (world.level.bossDefeated && levelId !== 'floor1') {
      world.state = 'clear';
      world.stats.endTime = world.time;
      input.exitLock();
      events.emit('gameClear', {});
      hud.showScreen(world);
    }
  } else if (world.state === 'paused') {
    if (input.pressed('KeyP')) resume();
  } else if (world.state === 'title') {
    // タイトル背景：カメラをゆっくり回す
    updatePlayer(world, 0);
    if (input.pressed('PadA') || input.pressed('KeyP')) startGame();
  } else if (world.state === 'gameover' || world.state === 'clear') {
    // リトライ（設定されていればリトライ地点から。例：サージの道は車に乗ったところ）
    if (input.pressed('PadA')) retry();
  }
  updateEffects(world, dt);
  hud.update(world, dt);
  upgradeScreen.update(world, dt);
  updateAudio(world, dt);
  input.endFrame();
}

function exposeDebug(w: World): void {
  (window as any).__game = {
    world: w,
    input,
    events,
    start: () => startGame(),
    step: (dt = 1 / 60, n = 1) => { for (let i = 0; i < n; i++) step(dt); },
    camera: CAMERA,
    character: CHARACTER, // 見た目調整のデバッグ用（実行時に数値を触れる）
    setWeapon: (id: string) => setPlayerWeapon(world, id),
    render: () => drawScene(),
    /** 強化画面を開く（確認用。ベッドを使わずに開ける。閉じても起き上がりの処理は無い） */
    openUpgrade: () => upgradeScreen.open(world),
    upgradeScreen,
    get current() { return world; },
    THREE,
  };
}

requestAnimationFrame(frame);
