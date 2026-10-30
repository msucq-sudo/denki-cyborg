// 2階（サイボーグ改造室）。buildDungeon / buildFloor1 と同じ役割の buildFloor2 / updateFloor2。
// 使い方: URL に ?level=floor2（1階のエレベーターに乗っても来られる）
// 円形の小部屋。中央に改造ベッド、壁沿いに PC・サーバー、南にエレベーター、北の左右 35° に2つの出口。
// 西の出口（出口A）はベッドで一度眠ったあとに近づくとシャッターが開き、突き当たりの出入口に入ると「サージ収容所への道」（level 'surge'）へ。東の出口（出口B）は封鎖のまま。
// ベッドの近くで パッド B（キーボード R）→ ベッドに横になる → 眠りの演出 → onSleepComplete フック
// （強化画面を開く。main.ts が差し込む）→ 画面を閉じる（wakeFromRest）か、もう一度 B / R（または自動）で起き上がる。
import * as THREE from 'three';
import type { World } from '../core/types';
import { toast } from '../core/combat';
import { setPlayerFacing } from '../player/player';
import { showPrompt } from './floor1';
import { generateFloor2, R, type Plan } from './floor2/plan';
import { buildFloor2Visuals, type Floor2Visuals } from './floor2/visuals';

export const FLOOR2_EXPOSURE = 1.15;
/** 眠りの演出の各区間（秒） */
export const SLEEP = { walk: 0.7, lie: 1.5, sleep: 1.6, wake: 1.3, autoWake: 7 };
/**
 * 眠りの演出が終わった時に呼ばれる（main.ts が強化画面を開く処理に差し替える）。
 * true を返すと「起きるのを保留」する：自動で起きず B / R でも起きない。画面を閉じたら wakeFromRest(world) を呼ぶ
 */
export const floor2Hooks: { onSleepComplete: (world: World) => boolean | void } = {
  onSleepComplete: (world) => { toast(world, '（強化画面は準備中です）', 4); return false; },
};

type Phase = 'free' | 'walk' | 'lie' | 'sleep' | 'rest' | 'wake';
export interface Floor2State {
  phase: Phase;
  /** 現在の区間の経過（秒） */
  t: number;
  /** 眠りに入った回数 */
  sleeps: number;
  doorOpen: number;
  /** かごの外へ一度出たか（出る前は乗っても階移動しない） */
  leftCar: boolean;
  /** 近くで B / R が使えるか */
  nearBed: boolean;
  /** 強化画面を開いている間は起きない（floor2Hooks.onSleepComplete が true を返した） */
  held: boolean;
  /** 西の出口のシャッターの開き具合 0..1 */
  exitOpen: number;
  /** 西の出口が使えるか（ベッドで一度眠った） */
  exitUnlocked: boolean;
}
/** 西の出口のシャッターが開く距離（出口の中心から m） */
const EXIT_OPEN_DIST = 7;
interface Runtime {
  plan: Plan;
  vis: Floor2Visuals;
  state: Floor2State;
  hemi: THREE.HemisphereLight;
  key: THREE.SpotLight;
  fill: THREE.PointLight;
  accents: THREE.PointLight[];
  clock: number;
  inCarT: number;
  promptOn: boolean;
  /** 眠りの演出の開始時の姿勢 */
  from: { x: number; z: number; yaw: number };
  /** 演出中の暗転（DOM） */
  dim: HTMLDivElement | null;
  doorEmitted: boolean;
  exitEmitted: boolean;
}
const runtimes = new WeakMap<World, Runtime>();

export function getFloor2(world: World): { plan: Plan; state: Floor2State } | null {
  const rt = runtimes.get(world);
  return rt ? { plan: rt.plan, state: rt.state } : null;
}

// ---------------------------------------------------------------- 暗転オーバーレイ
function makeDim(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  const dim = document.createElement('div');
  dim.style.cssText = 'position:fixed;inset:0;background:radial-gradient(ellipse at center,rgba(2,6,14,0.55) 0%,#02060e 85%);opacity:0;z-index:15;pointer-events:none';
  document.body.appendChild(dim);
  return dim;
}

// ---------------------------------------------------------------- 構築
export function buildFloor2(world: World): void {
  showPrompt(null);
  const plan = generateFloor2();
  const vis = buildFloor2Visuals(plan);
  const scene = world.scene;
  scene.add(vis.root);
  for (const c of vis.colliders) world.colliders.push(c);

  // ---- 照明：医療ラボらしい冷たい白＋モニターの青緑。中央の無影灯が主役
  scene.background = new THREE.Color(0x0a111b);
  scene.fog = new THREE.FogExp2(0x0a111b, 0.01);
  const hemi = new THREE.HemisphereLight(0x8aa6d4, 0x2b3648, 1.5);
  scene.add(hemi);
  const key = new THREE.SpotLight(0xeaf8ff, 150, 14, 1.15, 0.7, 2);
  key.position.set(0, 3.3, 0.4);
  key.target.position.set(0, 0.9, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.04;
  key.shadow.camera.near = 0.8;
  scene.add(key, key.target);
  const accents: THREE.PointLight[] = [];
  for (const [deg, col, power] of [[60, 0x52e8ff, 34], [120, 0x4cd68a, 30], [240, 0xffc21a, 26], [300, 0xc48cff, 30]] as const) {
    const a = (deg * Math.PI) / 180;
    const l = new THREE.PointLight(col, power, 13, 2);
    l.position.set(Math.sin(a) * 9.5, 3.0, -Math.cos(a) * 9.5);
    scene.add(l);
    accents.push(l);
  }
  const ceil = new THREE.PointLight(0xcfe4ff, 55, 20, 2);
  ceil.position.set(0, 5.0, 0);
  scene.add(ceil);
  const car = new THREE.PointLight(0xdff4ff, 40, 9, 2);
  car.position.set(0, 4.4, R + 2.6);
  scene.add(car);
  for (const ex of plan.exits) {
    const l = new THREE.PointLight(ex.usable ? 0x62ffb0 : 0xff4a3a, 22, 9, 2);
    l.position.set(ex.x + ex.dirX * 2.5, 4.2, ex.z + ex.dirZ * 2.5);
    scene.add(l);
  }
  const fill = new THREE.PointLight(0x9cc0ff, 7, 12, 2);
  scene.add(fill);

  // HUD ミニマップ用の区画
  world.level.rooms = plan.rooms.map((r) => ({
    name: r.name, min: new THREE.Vector3(r.x0, 0, r.z0), max: new THREE.Vector3(r.x1, r.h, r.z1), entered: true, cleared: true,
  }));
  world.level.currentRoom = 0;
  world.level.bossSpawned = false;
  world.level.bossDefeated = false;
  world.level.data.objective = '中央のベッドで休んで体を強化し、西の出口からガレージへ';
  world.level.data.remaining = 0;
  world.level.data.interactNear = false;
  world.level.data.nextFloor = 0;

  const state: Floor2State = { phase: 'free', t: 0, sleeps: 0, doorOpen: 0, leftCar: false, nearBed: false, held: false, exitOpen: 0, exitUnlocked: false };
  world.level.data.floor2 = state;
  world.player.pos.set(plan.start.x, 0, plan.start.z);
  world.player.yaw = plan.start.yaw;
  world.player.pitch = 0;

  const d = makeDim();
  runtimes.set(world, {
    plan, vis, state, hemi, key, fill, accents, clock: 0, inCarT: 0, promptOn: false,
    from: { x: 0, z: 0, yaw: 0 }, dim: d, doorEmitted: false, exitEmitted: false,
  });
}

// ---------------------------------------------------------------- 眠りの演出
const smooth = (k: number): number => { const x = Math.max(0, Math.min(1, k)); return x * x * (3 - 2 * x); };
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
/** a→b の最短回転での補間 */
function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** 強化画面を閉じた：保留をやめてベッドから起きる */
export function wakeFromRest(world: World): void {
  const rt = runtimes.get(world);
  if (!rt || rt.state.phase !== 'rest') return;
  rt.state.held = false;
  beginWake(world, rt);
}

/** ベッドから起きる（演出中ならいつでも呼べる：lie / sleep / rest） */
function beginWake(world: World, rt: Runtime): void {
  rt.state.phase = 'wake';
  rt.state.t = 0;
}

const _cam0 = new THREE.Vector3(), _camTo = new THREE.Vector3(), _look = new THREE.Vector3();
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion();
const _lm = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/** 演出中のプレイヤーの体とカメラを、ゲームプレイ側の更新のあとに上書きする */
function applySleepPose(world: World, rt: Runtime): void {
  const { state, plan } = rt;
  const b = plan.bed;
  const p = world.player;
  const root = p.root;
  const ph = state.phase;
  // 0=立ち姿、1=ベッドの上で仰向け
  let lie = 0;
  if (ph === 'lie') lie = smooth(state.t / SLEEP.lie);
  else if (ph === 'sleep' || ph === 'rest') lie = 1;
  else if (ph === 'wake') lie = 1 - smooth(state.t / SLEEP.wake);

  if (lie > 0 || ph === 'wake') {
    const hop = Math.sin(Math.PI * Math.min(1, lie)) * 0.35;
    const k = lie;
    const rotK = smooth((k - 0.15) / 0.85);
    root.rotation.order = 'YXZ';
    root.position.set(lerp(b.standX, b.lieX, k), lerp(0, b.lieY, k) + hop, lerp(b.standZ, b.lieZ, k));
    root.rotation.set(rotK * Math.PI / 2, lerpAngle(b.standYaw, b.lieYaw, rotK), 0);
  }

  // カメラ：ゲームプレイ側が計算した位置から、ベッドを見下ろす位置へ
  const dolly = ph === 'sleep' || ph === 'rest' ? smooth((ph === 'rest' ? SLEEP.sleep : state.t) / SLEEP.sleep) : ph === 'wake' ? 1 : 0;
  _camTo.set(lerp(2.5, 1.5, dolly), lerp(3.2, 2.5, dolly), lerp(3.7, 2.4, dolly));
  _look.set(lerp(0.2, 0.0, dolly), 0.95, 0);
  const wc = ph === 'lie' ? smooth(state.t / (SLEEP.lie * 0.9)) : ph === 'wake' ? 1 - smooth((state.t - SLEEP.wake * 0.25) / (SLEEP.wake * 0.75)) : ph === 'walk' ? 0 : 1;
  if (wc > 0) {
    const cam = world.camera;
    _cam0.copy(cam.position);
    _q0.copy(cam.quaternion);
    _lm.lookAt(_camTo, _look, UP);
    _q1.setFromRotationMatrix(_lm);
    cam.position.lerpVectors(_cam0, _camTo, wc);
    cam.quaternion.copy(_q0).slerp(_q1, wc);
  }

  // 暗転：横になるにつれ暗く、起きるときに戻る
  if (rt.dim) {
    const dimK = ph === 'lie' ? smooth(state.t / SLEEP.lie) * 0.55
      : ph === 'sleep' ? 0.55 + 0.3 * smooth(state.t / SLEEP.sleep)
        : ph === 'rest' ? (state.held ? 0 : 0.85) // 強化画面の間は暗転しない（画面側のカーテンが覆う）
          : ph === 'wake' ? 0.85 * (1 - smooth(state.t / SLEEP.wake)) : 0;
    rt.dim.style.opacity = String(dimK);
  }
}

function updateSleep(world: World, rt: Runtime, dt: number): void {
  const { state, plan } = rt;
  const b = plan.bed;
  const p = world.player;
  const input = world.input;
  state.t += dt;
  p.vel.set(0, 0, 0);
  switch (state.phase) {
    case 'walk': {
      // ベッドの南側（立ち位置）まで歩み寄り、ベッドの方を向く
      const k = smooth(state.t / SLEEP.walk);
      p.pos.set(lerp(rt.from.x, b.standX, k), 0, lerp(rt.from.z, b.standZ, k));
      p.yaw = lerpAngle(rt.from.yaw, b.standYaw, k);
      p.pitch = lerp(p.pitch, 0, Math.min(1, dt * 8));
      setPlayerFacing(world, p.yaw);
      if (state.t >= SLEEP.walk) { state.phase = 'lie'; state.t = 0; world.events.emit('sleepStart', {}); }
      break;
    }
    case 'lie':
      p.pos.set(b.standX, 0, b.standZ);
      if (state.t >= SLEEP.lie) { state.phase = 'sleep'; state.t = 0; }
      break;
    case 'sleep':
      p.pos.set(b.standX, 0, b.standZ);
      if (state.t >= SLEEP.sleep) {
        state.phase = 'rest'; state.t = 0; state.sleeps++;
        world.events.emit('sleepComplete', {});
        state.held = floor2Hooks.onSleepComplete(world) === true;
      }
      break;
    case 'rest':
      p.pos.set(b.standX, 0, b.standZ);
      if (!state.held && (input.rawPressed('PadB') || input.rawPressed('KeyR') || state.t >= SLEEP.autoWake)) beginWake(world, rt);
      break;
    case 'wake':
      p.pos.set(b.standX, 0, b.standZ);
      if (state.t >= SLEEP.wake) {
        state.phase = 'free'; state.t = 0;
        p.root.rotation.order = 'XYZ';
        p.root.rotation.set(0, b.standYaw, 0);
        p.yaw = b.standYaw;
        setPlayerFacing(world, p.yaw);
        input.locked = false;
        world.events.emit('wakeUp', {});
      }
      break;
  }
}

// ---------------------------------------------------------------- 更新
export function updateFloor2(world: World, dt: number): void {
  const rt = runtimes.get(world);
  if (!rt) return;
  const { plan, vis, state } = rt;
  const p = world.player;
  const input = world.input;
  rt.clock += dt;
  const t = rt.clock;
  const E = plan.elevator;

  // ---- 眠りの演出中は、プレイヤーの体とカメラを上書きする
  if (state.phase !== 'free') {
    updateSleep(world, rt, dt);
    applySleepPose(world, rt);
  }

  // ---- 西の出口：眠ったあとに近づくとシャッターが開く。開いた先の出入口に入ると「サージ収容所への道」へ
  const exW = plan.exits.find((e) => e.usable);
  let exitHint: string | null = null;
  if (exW) {
    if (state.sleeps >= 1 && !state.exitUnlocked) {
      state.exitUnlocked = true;
      world.level.data.objective = '西の出口（北西）から階段を下りて、ガレージへ向かおう';
    }
    const edx = p.pos.x - exW.x, edz = p.pos.z - exW.z;
    const near = Math.hypot(edx, edz) < EXIT_OPEN_DIST && state.phase === 'free' && p.hp > 0;
    const before = state.exitOpen;
    if (state.exitUnlocked && (near || state.exitOpen > 0)) state.exitOpen = Math.min(1, state.exitOpen + dt / 1.5);
    if (before === 0 && state.exitOpen > 0 && !rt.exitEmitted) {
      rt.exitEmitted = true;
      world.events.emit('doorOpen', { pos: new THREE.Vector3(exW.doorX, 2, exW.doorZ) });
    }
    const door = vis.exitDoors[exW.id];
    if (door) {
      const e = smooth(state.exitOpen);
      door.pivot.scale.y = Math.max(0.04, 1 - e * 0.96);
      const open = state.exitOpen > 0.6;
      for (const c of door.colliders) c.active = !open;
    }
    // 手前でヒント。まだ眠っていないなら案内する
    const proj = edx * exW.dirX + edz * exW.dirZ;       // 出口の中心から外向きに何 m 進んだか
    if (near && !state.exitUnlocked && proj > 0.5) exitHint = '先に中央のベッドで体を強化しよう';
    // 突き当たりの出入口に入った
    if (state.exitOpen >= 0.9 && proj > exW.depth + 0.3 && !world.level.data.nextLevel && p.hp > 0 && state.phase === 'free') {
      toast(world, 'ガレージへ降りる', 2.5);
      world.level.data.nextLevel = { level: 'surge' };
    }
  }

  // ---- ベッドの近くか（前フレームの値が player.ts の回避判定に使われる）
  const b = plan.bed;
  const dx = p.pos.x - b.x, dz = p.pos.z - b.z;
  const near = state.phase === 'free' && world.state === 'playing' && Math.hypot(dx, dz) < b.reach && p.pos.y < 1.5 && p.hp > 0;
  state.nearBed = near;
  world.level.data.interactNear = near;
  if (near) {
    showPrompt('Bボタン / Rキー：ベッドで休む');
    if (!rt.promptOn) world.events.emit('interactPrompt', {});
    rt.promptOn = true;
    if (input.pressed('PadB') || input.pressed('KeyR')) {
      state.phase = 'walk'; state.t = 0;
      rt.from = { x: p.pos.x, z: p.pos.z, yaw: p.yaw };
      input.locked = true;
      p.vel.set(0, 0, 0);
      showPrompt(null);
      rt.promptOn = false;
    }
  } else if (state.phase === 'rest' && !state.held) {
    showPrompt('Bボタン / Rキー：起きる');
  } else if (exitHint) {
    showPrompt(exitHint);
    rt.promptOn = false;
  } else {
    showPrompt(null);
    rt.promptOn = false;
  }

  // ---- 照明の演出
  rt.fill.position.set(p.pos.x, p.pos.y + 2.6, p.pos.z);
  rt.accents.forEach((l, i) => { l.intensity = (i % 2 ? 28 : 32) * (0.9 + 0.1 * Math.sin(t * 1.7 + i * 2)); });
  vis.glowMat.color.setScalar(1.5 + (state.nearBed ? 0.15 * Math.sin(t * 6) : 0));

  // ---- エレベーター：到着してからドアが開く。降りたあと、かごに戻って少し立つと1階へ
  const wasOpen = state.doorOpen >= 1;
  state.doorOpen = t > 0.6 ? Math.min(1, state.doorOpen + dt / 1.2) : 0;
  if (!wasOpen && state.doorOpen >= 1 && !rt.doorEmitted) {
    rt.doorEmitted = true;
    world.events.emit('elevatorOpen', { pos: new THREE.Vector3(E.approachX, 1, E.doorZ - 1) });
  }
  const slide = state.doorOpen * ((E.doorX1 - E.doorX0) / 2 - 0.05);
  vis.leaves[0].position.x = -((E.doorX1 - E.doorX0) / 4) - slide;
  vis.leaves[1].position.x = (E.doorX1 - E.doorX0) / 4 + slide;
  vis.doorCollider.active = state.doorOpen < 0.9;
  const inCar = p.pos.x > E.x0 && p.pos.x < E.x1 && p.pos.z > E.z0 && p.pos.z < E.z1 && p.pos.y < 2;
  if (!inCar && p.pos.z < E.doorZ - 0.5) state.leftCar = true;
  if (inCar && state.leftCar && state.doorOpen >= 1 && state.phase === 'free') rt.inCarT += dt; else rt.inCarT = 0;
  if (rt.inCarT > 0.7 && !world.level.data.nextFloor) {
    toast(world, 'エレベーターで1階へ戻る', 2.5);
    world.level.data.nextFloor = 1;
    world.events.emit('elevatorRide', {});
  }
}
