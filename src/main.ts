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
import { updateGrapple } from './core/grapple';
import { initFunctions, updateFunctions } from './abilities/functions';
import { updateEnemies } from './enemies/api';
import { buildDungeon, updateLevel } from './level/dungeon';
import { buildFloor1, buildFloor1Revisit, updateFloor1, FLOOR1_EXPOSURE } from './level/floor1';
import { buildFloor2, updateFloor2, FLOOR2_EXPOSURE } from './level/floor2';
import { CAMERA, CHARACTER } from './config/balance';
import { createHUD } from './ui/hud';
import { initAudio, resumeAudio, updateAudio } from './audio/sfx';
import './ui/style.css';

// ?level=floor1 で研究所1階、?level=floor2 で2階（サイボーグ改造室）。既定はアルファ版ダンジョン
type LevelId = 'dungeon' | 'floor1' | 'floor2';
const levelParam = new URLSearchParams(location.search).get('level');
let levelId: LevelId = levelParam === 'floor1' || levelParam === 'floor2' ? levelParam : 'dungeon';
/** 2階から1階へ戻ってきた（戦闘は解決済みの状態で始める） */
let floor1Revisit = false;
const LEVELS: Record<LevelId, { build: (w: World) => void; tick: (w: World, dt: number) => void; exposure: number }> = {
  dungeon: { build: buildDungeon, tick: updateLevel, exposure: 1.05 },
  floor1: { build: (w) => (floor1Revisit ? buildFloor1Revisit(w) : buildFloor1(w)), tick: updateFloor1, exposure: FLOOR1_EXPOSURE },
  floor2: { build: buildFloor2, tick: updateFloor2, exposure: FLOOR2_EXPOSURE },
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

let world: World = newWorld();
let hadLock = false;

const hud = createHUD(document.getElementById('hud')!, {
  onStart: () => startGame(),
  onRetry: () => { world = newWorld(); startGame(); },
  onResume: () => resume(),
  onTitle: () => { world = newWorld(); hud.showScreen(world); },
});
hud.showScreen(world);

function newWorld(): World {
  // 古いワールドの後始末
  if ((globalThis as any).__oldWorld) disposeWorld((globalThis as any).__oldWorld);
  const w = createWorld(input, events, window.innerWidth / window.innerHeight);
  LEVELS[levelId].build(w);
  initPlayer(w);
  initAbsorb(w);
  initFunctions(w);
  (globalThis as any).__oldWorld = w;
  exposeDebug(w);
  return w;
}

// ---- 階の移動（エレベーター）：暗転 → 次の階を作る → 明転。プレイヤーの状態は引き継ぐ
const FADE_OUT = 0.45, FADE_IN = 0.7;
let pendingFloor = 0;
let fadeT = 0;
let fadeIn = 0;
const fadeEl = document.createElement('div');
fadeEl.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;z-index:30;pointer-events:none';
document.body.appendChild(fadeEl);

function changeFloor(to: 1 | 2): void {
  const prev = world;
  const from = levelId === 'floor2' ? 2 : 1;
  const keep = {
    hp: prev.player.hp, energy: prev.player.energy, inventory: { ...prev.inventory }, functions: { ...prev.functions },
    stats: { ...prev.stats },
  };
  levelId = to === 2 ? 'floor2' : 'floor1';
  floor1Revisit = to === 1;
  renderer.toneMappingExposure = LEVELS[levelId].exposure;
  world = newWorld();
  Object.assign(world.player, { hp: keep.hp, energy: keep.energy });
  world.inventory = keep.inventory;
  world.functions = keep.functions;
  Object.assign(world.stats, keep.stats);
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
  else if (hadLock && world.state === 'playing') pause();
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
  renderer.render(world.scene, world.camera);
  if (!manual) requestAnimationFrame(frame);
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
    if (pendingFloor) {
      fadeT += dt;
      fadeEl.style.opacity = String(Math.min(1, fadeT / FADE_OUT));
      if (fadeT >= FADE_OUT) {
        const to = pendingFloor as 1 | 2;
        pendingFloor = 0;
        changeFloor(to);
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
    if (input.pressed('PadA')) { world = newWorld(); startGame(); }
  }
  updateEffects(world, dt);
  hud.update(world, dt);
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
    render: () => renderer.render(world.scene, world.camera),
    get current() { return world; },
    THREE,
  };
}

requestAnimationFrame(frame);
