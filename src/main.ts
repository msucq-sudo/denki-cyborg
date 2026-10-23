import * as THREE from 'three';
import { Input } from './core/input';
import { EventBus } from './core/events';
import { createWorld } from './core/world';
import type { World } from './core/types';
import { updateProjectiles } from './core/projectiles';
import { updateEffects } from './core/effects';
import { initPlayer, updatePlayer, updateGun } from './player/player';
import { initAbsorb, updateAbsorb } from './abilities/absorb';
import { initFunctions, updateFunctions } from './abilities/functions';
import { updateEnemies } from './enemies/api';
import { buildDungeon, updateLevel } from './level/dungeon';
import { createHUD } from './ui/hud';
import { initAudio, resumeAudio, updateAudio } from './audio/sfx';
import './ui/style.css';

const container = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
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
  buildDungeon(w);
  initPlayer(w);
  initAbsorb(w);
  initFunctions(w);
  (globalThis as any).__oldWorld = w;
  exposeDebug(w);
  return w;
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
    updateEnemies(world, dt);
    updateProjectiles(world, dt);
    updateLevel(world, dt);
    for (const t of world.toasts) t.timer -= dt;
    world.toasts = world.toasts.filter((t) => t.timer > 0);

    if (world.player.hp <= 0) {
      world.state = 'gameover';
      world.stats.endTime = world.time;
      input.exitLock();
      events.emit('gameOver', {});
      hud.showScreen(world);
    } else if (world.level.bossDefeated) {
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
    render: () => renderer.render(world.scene, world.camera),
    get current() { return world; },
    THREE,
  };
}

requestAnimationFrame(frame);
