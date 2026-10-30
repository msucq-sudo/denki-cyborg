// 運転（車担当 T5-B）。ステージ（level/surge.ts）が呼ぶ。
// - initDrive：車・障害物・雑魚敵を作って world.level.data.drive に置く（停車中 'parked'）
// - startDrive：乗る（プレイヤーの体を隠し、三人称の車カメラへ。phase='driving'）
// - updateDrive：毎フレーム（運転・タイミング加速・障害物・敵のはね飛ばし・判定地点 → 演出を呼ぶ）
// 失敗（障害物にぶつかる／失敗演出の終わり）はプレイヤーの HP を 0 にして死亡画面へ（main.ts が 'gameover' にする）
// 計算の本体（道のたどり方・加速・曲がり）は driveSim.ts、見た目は carModel.ts、置くものは driveProps.ts。
import * as THREE from 'three';
import type { World } from '../core/types';
import { spawnBurst, spawnFlash, spawnShockwave } from '../core/effects';
import { CHECKPOINT, ROAD } from '../level/surge/layout';
import { playFailCutscene, playSuccessCutscene, type CutsceneHandle } from '../cinematic/api';
import { getDriveHud, type DriveHudView } from '../ui/driveHud';
import { buildCar, CAR, type CarModel } from './carModel';
import {
  createSim, distToCheckpoint, DRIVE, kmhOf, stepSim, turnHintActive, cursorAt,
  type SimEvent, type SimState,
} from './driveSim';
import {
  buildObstacle, buildZako, disposeObstacle, disposeZako, flingZako, idleZako, planObstacles, planZako, stepFlung, updateObstacle,
  type Obstacle, type Zako,
} from './driveProps';
import { createSpeedLines, type SpeedLines } from './driveFx';
import { KMH, type DriveState } from './types';

/** 運転の全状態。DriveState（契約）に、計算の状態（SimState）と演出用の持ち物を足したもの */
export interface DriveRuntime extends DriveState, SimState {
  car: CarModel;
  pos: THREE.Vector3;
  obstacles: Obstacle[];
  zako: Zako[];
  /** はね飛ばした雑魚の数 */
  hits: number;
  /** 衝突してからの秒数（phase='crashed'） */
  crashT: number;
  /** 乗り始めてからの秒数 */
  time: number;
  /** カメラ：なめらかに追う向き・注視点・視野角の加算・揺れ */
  cam: { yaw: number; focus: THREE.Vector3; kick: number; init: boolean };
  /** 画面と車体の揺れの強さ 0..1（衝撃で上がり、すぐ減る） */
  shake: number;
  cutscene: CutsceneHandle | null;
  /** 判定地点に着いた時の速度（km/h） */
  checkpointKmh: number;
  /** 判定地点までの全道のり (m)（HUD の進み具合用） */
  totalDist: number;
  /** 死亡画面を出した（HP を 0 にした）か */
  deadSent: boolean;
  /** 最後に立て直した（T字路で壁にぶつかった）回数 */
  bumps: number;
  sparkT: number;
  /** 風の筋（スピード線） */
  fx: SpeedLines;
}

export function getDrive(world: World): DriveRuntime | null {
  return (world.level.data.drive as DriveRuntime | undefined) ?? null;
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const MAX_MS = DRIVE.maxKmh * KMH;

// ---------------------------------------------------------------- 作る

export function initDrive(world: World, at: { x: number; z: number; yaw: number }): DriveState | null {
  const car = buildCar();
  car.root.rotation.order = 'YXZ';
  car.root.position.set(at.x, 0, at.z);
  car.root.rotation.y = at.yaw;
  world.scene.add(car.root);

  const sim = createSim(at.x, at.z, at.yaw);
  const pos = new THREE.Vector3(at.x, 0, at.z);
  const obDefs = planObstacles();
  const obstacles = obDefs.map(buildObstacle);
  for (const o of obstacles) world.scene.add(o.root);
  const zako = planZako(obDefs).map(buildZako);
  for (const z of zako) world.scene.add(z.root);

  const d: DriveRuntime = Object.assign(sim, {
    phase: 'parked' as DriveState['phase'],
    car, pos,
    result: 'none' as DriveState['result'],
    obstacles, zako, hits: 0, crashT: 0, time: 0,
    cam: { yaw: at.yaw, focus: pos.clone(), kick: 0, init: false },
    shake: 0, cutscene: null, checkpointKmh: 0,
    totalDist: Math.max(1, Math.max(0, at.z - ROAD.junctionZ) + -CHECKPOINT.x),
    deadSent: false, bumps: 0, sparkT: 0, fx: createSpeedLines(world.scene),
  }) as unknown as DriveRuntime;
  d.pos = pos;
  world.level.data.drive = d;
  // 新しいワールドでは HUD を閉じる（前のワールドの表示を残さない）
  getDriveHud().reset();
  exposeDebug(world, d);
  return d;
}

/** 乗る：体を隠し、操作を車用に切り替え、車カメラへ */
export function startDrive(world: World): void {
  const d = getDrive(world);
  if (!d || d.phase !== 'parked') return;
  d.phase = 'driving';
  world.player.root.visible = false;
  world.input.locked = true;
  d.car.setEngine(true);
  syncPlayer(world, d);
  placeCar(d);
  updateChaseCam(world, d, 0, true);
  world.events.emit('driveStart', {});
}

// ---------------------------------------------------------------- 毎フレーム

export function updateDrive(world: World, dt: number): void {
  const d = getDrive(world);
  if (!d) return;
  switch (d.phase) {
    case 'parked':
      d.car.update(dt, 0);
      return;
    case 'driving': {
      world.input.locked = true; // 別のステージ遷移で解除されても、運転中は車の操作に固定
      d.time += dt;
      driving(world, d, dt);
      break;
    }
    case 'crashed':
      crashed(world, d, dt);
      break;
    case 'cutscene': {
      // 動きは演出が決める。ここでは演出を進め、車の車輪・ライトだけ更新する
      d.cutscene?.update(world, dt);
      d.car.update(dt, Math.abs(d.speed));
      syncPlayer(world, d);
      stepProps(world, d, dt, false);
      return;
    }
    case 'done':
      return;
  }
  stepProps(world, d, dt);
}

function readInput(world: World): { steer: number; press: boolean } {
  const i = world.input;
  const left = i.rawDown('KeyA') || i.rawDown('ArrowLeft');
  const right = i.rawDown('KeyD') || i.rawDown('ArrowRight');
  const press = i.rawPressed('Space') || i.rawPressed('PadA');
  return { steer: (right ? 1 : 0) - (left ? 1 : 0), press };
}

function driving(world: World, d: DriveRuntime, dt: number): void {
  const inp = readInput(world);
  const hud = getDriveHud();
  // 大きな dt は細かく刻む（曲がり・衝突の取りこぼし防止）
  const n = Math.max(1, Math.ceil(dt / (1 / 60)));
  const h = dt / n;
  let first = true;
  for (let k = 0; k < n && d.phase === 'driving'; k++) {
    const ev = stepSim(d, { steer: inp.steer, press: inp.press && first }, h);
    first = false;
    d.pos.set(d.pos.x, 0, d.pos.z);
    for (const e of ev) onSimEvent(world, d, e);
    if (d.phase !== 'driving') break;
    if (collide(world, d, h)) break;
  }
  d.shake *= Math.exp(-5 * dt);
  d.cam.kick *= Math.exp(-4.5 * dt);

  placeCar(d);
  const visSteer = d.mode === 'recover' ? -1 : d.mode === 'turn' ? d.turnDir : d.steer;
  d.car.setSteer(visSteer);
  d.car.update(dt, d.speed);
  syncPlayer(world, d);
  updateChaseCam(world, d, dt);
  d.fx.update(d.pos.x, d.pos.z, d.mode === 'west' ? -1 : 0, kmhOf(d), dt);

  if (d.phase === 'driving') {
    hud.show();
    hud.update(hudView(world, d));
  }
}

function hudView(world: World, d: DriveRuntime): DriveHudView {
  return {
    kmh: kmhOf(d), maxKmh: DRIVE.maxKmh, targetKmh: CHECKPOINT.kmh,
    cursor: cursorAt(d.cursorT), perfectHalf: DRIVE.perfectHalf, goodHalf: DRIVE.goodHalf, cooldown: d.cooldown,
    distLeft: distToCheckpoint(d), totalDist: d.totalDist,
    turnHint: turnHintActive(d), recovering: d.mode === 'bounce' || d.mode === 'recover',
    device: world.input.lastDevice, hits: d.hits,
  };
}

const _v = new THREE.Vector3();

function carFront(d: DriveRuntime, out: THREE.Vector3, ahead = CAR.halfLen, y = 0.8): THREE.Vector3 {
  return out.set(d.pos.x - Math.sin(d.yaw) * ahead, y, d.pos.z - Math.cos(d.yaw) * ahead);
}

function onSimEvent(world: World, d: DriveRuntime, e: SimEvent): void {
  switch (e.type) {
    case 'boost': {
      world.events.emit('driveBoost', { quality: e.quality, kmh: e.kmh });
      getDriveHud().judge(e.quality);
      if (e.quality !== 'miss') {
        d.car.boostFlash(e.quality === 'perfect' ? 1 : 0.6);
        d.cam.kick = Math.max(d.cam.kick, e.quality === 'perfect' ? 9 : 5);
        d.shake = Math.max(d.shake, e.quality === 'perfect' ? 0.35 : 0.18);
      }
      break;
    }
    case 'turnStart':
      break;
    case 'junctionDone':
      world.toasts.push({ text: d.bumps > 0 ? '立て直した！アクセルを踏め' : '左折成功！アクセルを踏め', timer: 2.2 });
      break;
    case 'bounce': {
      d.bumps++;
      d.shake = Math.max(d.shake, 0.7);
      carFront(d, _v);
      spawnBurst(world, _v, 0xffd070, 12, 6, 0.5);
      spawnFlash(world, _v, 0xfff0c0, 6, 6, 0.15);
      world.events.emit('driveBump', { pos: _v.clone(), kmh: e.kmh });
      world.toasts.push({ text: e.where === 'east' ? '東は柵だ！左へ曲がれ' : '行き止まりだ！左へ曲がれ', timer: 2.2 });
      break;
    }
    case 'checkpoint':
      reachCheckpoint(world, d, e.kmh);
      break;
  }
}

// ---------------------------------------------------------------- 衝突（障害物・雑魚）

/** 衝突の判定。障害物に当たって止まったら true */
function collide(world: World, d: DriveRuntime, dt: number): boolean {
  if (d.mode !== 'west') return false;
  const px = d.pos.x, pz = d.pos.z;
  // 障害物：当たったら失敗
  for (const o of d.obstacles) {
    if (o.hit) continue;
    if (Math.abs(o.def.x - px) < o.def.d / 2 + DRIVE.halfLen - 0.2 && Math.abs(o.def.z - pz) < o.def.w / 2 + DRIVE.halfWid - 0.1) {
      o.hit = true;
      crash(world, d, o);
      return true;
    }
  }
  // 雑魚：はね飛ばす（減速なし）
  const vx = -Math.sin(d.yaw) * d.speed, vz = -Math.cos(d.yaw) * d.speed;
  const rx = Math.cos(d.yaw), rz = -Math.sin(d.yaw);
  for (const z of d.zako) {
    if (z.state !== 'idle') continue;
    const dx = z.pos.x - px;
    if (Math.abs(dx) > DRIVE.halfLen + z.radius + 1.5) continue;
    const dz = z.pos.z - pz;
    // 速く走ると 1 フレームで進む距離が長いので、進行方向に少し余裕を持たせる
    const reach = DRIVE.halfLen + z.radius * 0.8 + Math.abs(d.speed) * dt * 0.5;
    if (Math.abs(dx) < reach && Math.abs(dz) < DRIVE.halfWid + z.radius * 0.8 && z.pos.y - z.radius < 1.9) {
      flingZako(z, vx, vz, dz * rz + dx * rx >= 0 ? 1 : -1);
      d.hits++;
      d.shake = Math.max(d.shake, 0.22);
      _v.copy(z.pos);
      spawnBurst(world, _v, 0xffe27a, 10, 7, 0.5);
      spawnBurst(world, _v, 0x7ff6ff, 6, 5, 0.4);
      spawnFlash(world, _v, 0xffffff, 6, 5, 0.12);
      world.events.emit('driveHitEnemy', { pos: _v.clone() });
    }
  }
  return false;
}

function crash(world: World, d: DriveRuntime, o: Obstacle): void {
  d.phase = 'crashed';
  d.crashT = 0;
  d.sparkT = 0;
  d.speed = 0;
  d.pendingKmh = 0;
  d.shake = 1;
  d.cam.kick = 0;
  carFront(d, _v, DRIVE.halfLen, 0.9);
  const at = _v.clone();
  spawnShockwave(world, at, 0xff9a40, 4.5, 0.5);
  spawnBurst(world, at, 0xffd070, 22, 11, 0.9);
  spawnBurst(world, at, 0xff6a2a, 14, 8, 0.8);
  spawnFlash(world, at, 0xfff0c0, 12, 12, 0.25);
  // 障害物は車にはじかれて少し動く
  o.root.position.x -= 1.6;
  o.root.rotation.z += 0.12;
  world.events.emit('driveCrash', { pos: at });
  getDriveHud().hide();
}

function crashed(world: World, d: DriveRuntime, dt: number): void {
  d.crashT += dt;
  d.fx.update(0, 0, 0, 0, dt);
  d.shake *= Math.exp(-3.2 * dt);
  const t = d.crashT;
  // 車が前のめりにがくんと跳ね、少し後ろへ戻って止まる
  const k = Math.exp(-4.5 * t);
  d.car.root.rotation.x = -0.28 * k * Math.cos(t * 9);
  d.car.root.position.y = 0.45 * k * Math.abs(Math.sin(t * 9));
  d.car.root.rotation.y = d.yaw + 0.1 * k * Math.sin(t * 14);
  d.car.update(dt, 0);
  if (t > 0.25) d.car.setEngine(false);
  // 火花
  d.sparkT -= dt;
  if (t < 0.8 && d.sparkT <= 0) {
    d.sparkT = 0.12;
    carFront(d, _v, DRIVE.halfLen, 0.9);
    spawnBurst(world, _v, 0xffb040, 8, 8, 0.6);
  }
  syncPlayer(world, d);
  updateChaseCam(world, d, dt);
  if (t > 1.2 && !d.deadSent) {
    d.deadSent = true;
    world.player.hp = 0;
  }
}

// ---------------------------------------------------------------- 判定地点 → 演出

function reachCheckpoint(world: World, d: DriveRuntime, kmh: number): void {
  const ok = kmh >= CHECKPOINT.kmh;
  d.checkpointKmh = kmh;
  d.result = ok ? 'success' : 'fail';
  d.phase = 'cutscene';
  d.steer = 0;
  d.latVel = 0;
  d.car.setSteer(0);
  d.car.root.rotation.set(0, d.yaw, 0);
  d.car.root.position.set(d.pos.x, 0, d.pos.z);
  getDriveHud().hide();
  d.fx.update(0, 0, 0, 0, 0);
  world.events.emit('driveCheckpoint', { ok, kmh });
  const onDone = (): void => {
    d.phase = 'done';
    if (ok) world.toasts.push({ text: 'サージ収容所に潜入！（続きは今後）', timer: 6 });
    else if (!d.deadSent) { d.deadSent = true; world.player.hp = 0; }
  };
  d.cutscene = ok ? playSuccessCutscene(world, d, onDone) : playFailCutscene(world, d, onDone);
}

// ---------------------------------------------------------------- 雑魚・障害物の毎フレーム

function stepProps(world: World, d: DriveRuntime, dt: number, cull = true): void {
  const t = world.time;
  const cx = d.pos.x;
  for (const o of d.obstacles) {
    const dist = Math.abs(o.def.x - cx);
    if (dist < 700) updateObstacle(o, t, dist);
  }
  for (const z of d.zako) {
    if (z.state === 'idle') {
      const dx = Math.abs(z.pos.x - cx);
      if (cull) z.root.visible = dx < 340; // 遠くは描かない（カメラの遠面より先。演出中は演出が出し入れするので触らない）
      if (dx < 170) idleZako(z, t, dt, d.pos);
    } else if (z.state === 'flung') {
      if (stepFlung(z, dt)) disposeZako(z);
    }
  }
}

// ---------------------------------------------------------------- 車の配置・プレイヤーの同期

function placeCar(d: DriveRuntime): void {
  const r = d.car.root;
  // 舵に合わせて車体を少し内側へ向ける（進行方向 d.yaw は変えない）
  const tilt = d.mode === 'west' || d.mode === 'north' ? -d.steer * 0.1 : 0;
  r.position.set(d.pos.x, 0, d.pos.z);
  r.rotation.set(0, d.yaw + tilt, 0);
}

function syncPlayer(world: World, d: DriveRuntime): void {
  const p = world.player;
  p.root.visible = false;
  p.pos.set(d.pos.x, 0, d.pos.z);
  p.root.position.copy(p.pos);
  p.vel.set(0, 0, 0);
  p.yaw = d.yaw;
  p.onGround = true;
  p.invuln = Math.max(p.invuln, 0.5);
}

// ---------------------------------------------------------------- 車カメラ

const _focus = new THREE.Vector3();
const _look = new THREE.Vector3();

/** 車の後ろ上から追う三人称カメラ。速いほど引いて、視野角が広がり、少し揺れる */
function updateChaseCam(world: World, d: DriveRuntime, dt: number, snap = false): void {
  const cam = world.camera;
  const c = d.cam;
  const speedK = clamp(Math.abs(d.speed) / MAX_MS, 0, 1);
  if (snap || !c.init) { c.yaw = d.yaw; c.focus.copy(d.pos); c.init = true; }
  else {
    const turning = d.mode === 'turn' || d.mode === 'recover';
    c.yaw += wrapPi(d.yaw - c.yaw) * (1 - Math.exp(-(turning ? 4.2 : 7) * dt));
    c.focus.lerp(d.pos, 1 - Math.exp(-14 * dt));
  }
  const dist = 7.6 + 3.4 * speedK;
  const height = 3.2 - 0.5 * speedK;
  const bx = Math.sin(c.yaw), bz = Math.cos(c.yaw);
  _focus.copy(c.focus);
  const t = world.time;
  const amp = 0.012 + 0.04 * speedK * speedK + d.shake * 0.3;
  const sx = (Math.sin(t * 91.3) + Math.sin(t * 57.1)) * 0.5 * amp;
  const sy = (Math.sin(t * 77.7) + Math.sin(t * 43.9)) * 0.5 * amp;
  // T字路の東の柵の向こう側へカメラが出ないようにする（立て直しで西向きの時、後ろ＝東にカメラが来る）
  cam.position.set(Math.min(_focus.x + bx * dist + sx, ROAD.eastFenceX - 1.5), _focus.y + height + sy, _focus.z + bz * dist);
  _look.set(_focus.x - bx * (6 + 8 * speedK), _focus.y + 1.2, _focus.z - bz * (6 + 8 * speedK));
  cam.lookAt(_look);
  cam.rotateZ(Math.sin(t * 63) * amp * 0.12);
  const fov = 60 + 24 * Math.pow(speedK, 1.3) + c.kick;
  if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
}

// ---------------------------------------------------------------- デバッグ（テスト・確認用）

function exposeDebug(world: World, d: DriveRuntime): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __drive: unknown }).__drive = {
    world,
    get state() { return d; },
    /** 速度を km/h で直接指定 */
    setSpeed: (kmh: number) => { d.speed = kmh * KMH; d.pendingKmh = 0; },
    /** 西向きの直線の x 地点へ移動（T字路は曲がった扱い） */
    teleport: (x: number, z = ROAD.junctionZ) => {
      d.mode = 'west'; d.junctionDone = true; d.yaw = Math.PI / 2; d.pos.set(x, 0, z); d.intent = 0;
      d.checkpointDone = x < CHECKPOINT.x;
      placeCar(d); d.cam.init = false;
    },
    obstacles: () => d.obstacles.map((o) => ({ x: o.def.x, z: o.def.z, kind: o.def.kind })),
    zako: () => d.zako.map((z) => ({ x: z.pos.x, z: z.pos.z, kind: z.kind, state: z.state })),
  };
}
