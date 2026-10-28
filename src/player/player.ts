import * as THREE from 'three';
import { CAMERA, DASH, DODGE, FUNCTIONS, GUN, PLAYER } from '../config/balance';
import type { World } from '../core/types';
import { moveCharacter, raycastLevel } from '../core/collision';
import { raycastEnemies } from '../core/enemyUtil';
import { drainEnergy, spendEnergy } from '../core/energy';
import { addEffect } from '../core/effects';
import { spawnProjectile } from '../core/projectiles';
import { isGrappling, stepGrapple } from '../core/grapple';
import { buildPlayerVisual, CYAN, type PlayerVisual } from './visual';
import { WEAPONS } from './weapons';
import { createAnimState, poseCharacter, type AnimState } from './pose';
import {
  applyLook, cameraForward, cameraRight, chargeAdvance, chargeDamage, chargedBulletSize, moveVector, smoothAngle,
} from './logic';

const AIM_RANGE = 100;
/** 射撃クリックの先行入力受付（秒） */
const TAP_BUFFER = 0.25;
const TERMINAL_VEL = -45;

interface PState {
  vis: PlayerVisual;
  anim: AnimState;
  facing: number;
  walkPhase: number;
  prevOnGround: boolean;
  prevHp: number;
  flash: number;
  fallSpeed: number;
  camS: number;
  /** 照準ズームの進行度 0..1 */
  aimK: number;
  afterT: number;
  spaceHold: number;
  groundJumped: boolean;
  holding: boolean;
  /** 押した直後の先行入力（秒）。クールダウン明けに単発を撃つ */
  tapQueue: number;
  suppressFire: boolean;
  fullEmitted: boolean;
  sparkT: number;
  hitCeilingPrev: boolean;
  muzzleFlash: number;
}

const states = new WeakMap<World, PState>();
const ghostGeo = new THREE.CapsuleGeometry(0.3, 0.9, 4, 10);

function st(world: World): PState {
  let s = states.get(world);
  if (!s) {
    s = {
      vis: buildPlayerVisual(world.player.root), anim: createAnimState(world), facing: world.player.yaw, walkPhase: 0,
      prevOnGround: false, prevHp: world.player.hp, flash: 0, fallSpeed: 0, camS: 1, aimK: 0, afterT: 0,
      spaceHold: 0, groundJumped: false, holding: false, tapQueue: 0, suppressFire: false, fullEmitted: false, sparkT: 0, hitCeilingPrev: false, muzzleFlash: 0,
    };
    states.set(world, s);
  }
  return s;
}

export function initPlayer(world: World): void {
  states.delete(world);
  const s = st(world);
  world.player.root.position.copy(world.player.pos);
  world.player.root.rotation.y = s.facing;
  s.vis.chargeCore.visible = s.vis.chargeGlow.visible = false;
  s.vis.sparks.forEach((m) => (m.visible = false));
  s.vis.jets.children.forEach((c) => { if ((c as THREE.Mesh).isMesh) c.visible = false; });
  world.player.root.updateMatrixWorld(true);
  updateCamera(world, s, 0);
  computeAim(world, s);
}

// ---------------------------------------------------------------- update

export function updatePlayer(world: World, dt: number): void {
  const s = st(world);
  const p = world.player;
  const input = world.input;

  if (world.state === 'title' || dt <= 0) {
    // タイトル：プレイヤーの周りをゆっくり回る
    p.root.position.copy(p.pos);
    s.facing = p.yaw;
    p.root.rotation.y = s.facing;
    animate(world, s, 0.016);
    p.root.updateMatrixWorld(true);
    if (world.state === 'title') updateTitleCamera(world);
    else updateCamera(world, s, 0);
    return;
  }

  // タイマー
  p.invuln = Math.max(0, p.invuln - dt);
  p.dodgeCooldown = Math.max(0, p.dodgeCooldown - dt);
  p.dodgeTimer = Math.max(0, p.dodgeTimer - dt);
  if (p.hp < s.prevHp) s.flash = 0.28;
  s.prevHp = p.hp;
  s.flash = Math.max(0, s.flash - dt);

  // 視点
  const look = applyLook(p.yaw, p.pitch, input.mouseDX, input.mouseDY, CAMERA.mouseSensitivity * (1 - (1 - CAMERA.aim.sensMul) * s.aimK));
  p.yaw = look.yaw; p.pitch = look.pitch;

  // グラップル中（引き寄せ／ぶら下がり／よじ登り）は専用の移動に任せる
  if (stepGrapple(world, dt)) {
    if (p.flying) { p.flying = false; world.events.emit('flightEnd', {}); }
    s.fallSpeed = 0;
    s.facing = p.yaw;
    p.root.rotation.y = s.facing;
    p.root.position.copy(p.pos);
    animate(world, s, dt);
    p.root.updateMatrixWorld(true);
    updateCamera(world, s, dt);
    computeAim(world, s);
    return;
  }

  // 入力
  const fIn = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
  const rIn = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
  const mv = moveVector(p.yaw, fIn, rIn);
  const hasInput = mv.x !== 0 || mv.z !== 0;

  // 回避
  // 吸収中は回避・ダッシュ・ジャンプ・ジェットパック不可（吸収のリスク）
  const dodgePressed = input.pressed('KeyC') && !p.absorbing;
  if (dodgePressed) {
    if (p.charging) {
      cancelCharge(world, s);
    } else if (p.dodgeCooldown <= 0 && p.dodgeTimer <= 0 && spendEnergy(world, DODGE.cost)) {
      if (hasInput) p.dodgeDir.set(mv.x, 0, mv.z).normalize();
      else { const f = cameraForward(p.yaw, 0); p.dodgeDir.set(f.x, 0, f.z).normalize(); }
      p.dodgeTimer = DODGE.duration;
      p.dodgeCooldown = DODGE.cooldown;
      p.invuln = Math.max(p.invuln, DODGE.invuln);
      s.afterT = 0;
      world.events.emit('dodge', {});
    }
  }
  const dodging = p.dodgeTimer > 0;

  // 水平速度
  let speed = PLAYER.moveSpeed;
  if (p.charging) speed *= PLAYER.chargeMoveMul;
  if (p.absorbing) speed *= PLAYER.absorbMoveMul;
  if (input.mouse(2)) speed *= CAMERA.aim.moveMul;
  // ダッシュ：Shift長押しで移動中のみ低消費。溜め/吸収中・回避中は不可
  const wantDash = (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) && hasInput
    && !p.charging && !p.absorbing && !dodging && p.energy > 0;
  if (wantDash) {
    drainEnergy(world, DASH.drainPerSec * dt);
    speed *= DASH.speedMul;
  }
  if (dodging) {
    p.vel.x = p.dodgeDir.x * DODGE.speed;
    p.vel.z = p.dodgeDir.z * DODGE.speed;
  } else {
    let k: number;
    if (p.onGround) k = 1 - Math.exp(-18 * dt);
    else if (p.flying) k = 1 - Math.exp(-4 * dt);
    else k = hasInput ? 1 - Math.exp(-5 * dt) : 1 - Math.exp(-0.8 * dt);
    p.vel.x += (mv.x * speed - p.vel.x) * k;
    p.vel.z += (mv.z * speed - p.vel.z) * k;
  }

  // ジャンプ / 飛行
  const spaceDown = input.isDown('Space');
  if (!spaceDown) { s.spaceHold = 0; s.groundJumped = false; } else s.spaceHold += dt;
  if (input.pressed('Space') && p.onGround && !dodging && !p.absorbing) {
    p.vel.y = PLAYER.jumpSpeed;
    p.onGround = false;
    s.groundJumped = true;
    world.events.emit('jump', {});
  }
  const F = FUNCTIONS.flight;
  const wasFlying = p.flying;
  // ジェットパック：空中で長押し → 落下し始めたらその高さで滞空（上昇はしない）
  let wantFly = world.functions.flight && spaceDown && !p.onGround && p.energy > 0 && !p.absorbing
    && (wasFlying || p.vel.y <= F.engageVy);
  if (wantFly) {
    const ratio = drainEnergy(world, F.flyingDrainPerSec * dt);
    if (ratio < 1) wantFly = p.energy > 0;
  }
  if (!wantFly && !wasFlying && world.functions.flight && spaceDown && !p.onGround && p.energy <= 0 && p.vel.y <= F.engageVy) {
    world.events.emit('flightFail', {});
  }
  p.flying = wantFly;
  if (p.flying && !wasFlying) world.events.emit('flightStart', {});
  else if (!p.flying && wasFlying) world.events.emit('flightEnd', {});

  if (dodging) {
    if (!p.onGround) p.vel.y = 0;
  } else if (p.flying) {
    // 縦速度を0へ寄せて高度を維持（上昇させない）
    p.vel.y += (0 - p.vel.y) * (1 - Math.exp(-F.hoverDamp * dt));
    if (p.vel.y > 0) p.vel.y = 0;
  } else {
    p.vel.y = Math.max(TERMINAL_VEL, p.vel.y - PLAYER.gravity * dt);
  }
  if (p.vel.y < 0) s.fallSpeed = Math.max(s.fallSpeed, -p.vel.y);

  // 移動と衝突
  const r = moveCharacter(world.colliders, p.pos, p.vel, dt, PLAYER.radius, PLAYER.height);
  s.hitCeilingPrev = r.hitCeiling;
  p.onGround = r.onGround && p.vel.y <= 0.01;
  if (p.onGround) {
    if (p.flying) { p.flying = false; world.events.emit('flightEnd', {}); }
    if (!s.prevOnGround && s.fallSpeed > 3) world.events.emit('land', {});
    s.fallSpeed = 0;
  }
  s.prevOnGround = p.onGround;

  // 向き：移動中/射撃中/吸収中はカメラ yaw に合わせる
  const firing = input.mouse(0) || p.charging || p.absorbing || input.mouse(2) || input.isDown('KeyE');
  if (firing) s.facing = p.yaw;
  else if (hasInput || dodging) s.facing = smoothAngle(s.facing, p.yaw, 16, dt);
  p.root.rotation.y = s.facing;
  p.root.position.copy(p.pos);

  // 残像
  if (dodging) {
    s.afterT -= dt;
    if (s.afterT <= 0) { s.afterT = 0.035; spawnGhost(world, s); }
  }

  animate(world, s, dt);
  p.root.updateMatrixWorld(true);
  updateCamera(world, s, dt);
  computeAim(world, s);
}

// ---------------------------------------------------------------- 見た目アニメ

function animate(world: World, s: PState, dt: number): void {
  poseCharacter(world, s.vis, s.anim, dt);
}

function spawnGhost(world: World, s: PState): void {
  const p = world.player;
  const m = new THREE.Mesh(ghostGeo, new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.45, depthWrite: false }));
  m.position.set(p.pos.x, p.pos.y + 0.95, p.pos.z);
  m.rotation.y = s.facing;
  world.scene.add(m);
  addEffect(world, m, 0.28, (e) => {
    const k = e.life / e.maxLife;
    ((e.obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.45 * k;
    e.obj.scale.set(0.9 + 0.1 * k, 1, 0.9 + 0.1 * k);
  });
}

// ---------------------------------------------------------------- カメラ / 照準

function updateTitleCamera(world: World): void {
  const p = world.player;
  const a = world.time * 0.3;
  const head = new THREE.Vector3(p.pos.x, p.pos.y + 1.3, p.pos.z);
  world.camera.position.set(head.x + Math.sin(a) * 5, head.y + 0.6, head.z + Math.cos(a) * 5);
  world.camera.lookAt(head);
  st(world).vis.body.visible = true;
}

const _head = new THREE.Vector3();
const _off = new THREE.Vector3();
const _end = new THREE.Vector3();

function updateCamera(world: World, s: PState, dt: number): void {
  const p = world.player;
  const cam = world.camera;
  const fwd = cameraForward(p.yaw, p.pitch);
  const right = cameraRight(p.yaw);
  _head.set(p.pos.x, p.pos.y + CAMERA.heightOffset, p.pos.z);
  // 照準：右クリック長押しで肩越しに寄ってズーム
  const aimTarget = world.input.mouse(2) && world.state === 'playing' ? 1 : 0;
  s.aimK += (aimTarget - s.aimK) * (dt === 0 ? 1 : 1 - Math.exp(-CAMERA.aim.blendRate * dt));
  const A = CAMERA.aim;
  const dist = CAMERA.distance * (1 - (1 - A.distanceMul) * s.aimK);
  const shoulder = CAMERA.shoulderOffsetX * (1 - (1 - A.shoulderMul) * s.aimK);
  const wantFov = CAMERA.fov + (A.fov - CAMERA.fov) * s.aimK;
  if (Math.abs(cam.fov - wantFov) > 0.01) { cam.fov = wantFov; cam.updateProjectionMatrix(); }
  _off.set(
    right.x * shoulder - fwd.x * dist,
    -fwd.y * dist,
    right.z * shoulder - fwd.z * dist,
  );
  const len = _off.length();
  _end.copy(_head).add(_off);
  const t = raycastLevel(world.colliders, _head, _end);
  let target = 1;
  if (t !== null) target = Math.max(0.12, t - 0.25 / len);
  if (target < s.camS || dt === 0) s.camS = target;
  else s.camS += (target - s.camS) * (1 - Math.exp(-8 * dt));
  cam.position.copy(_head).addScaledVector(_off, s.camS);
  // カメラが頭に近すぎる（壁際で押し込まれた）ときは体を隠して視界を確保
  st(world).vis.body.visible = _head.distanceTo(cam.position) > 0.9;
  cam.rotation.order = 'YXZ';
  cam.rotation.set(p.pitch, p.yaw, 0);
}

const _mz = new THREE.Vector3();
const _s0 = new THREE.Vector3();
const _s1 = new THREE.Vector3();

function computeAim(world: World, s: PState): void {
  const p = world.player;
  world.aimTarget = null;
  world.aimTargetPoint = null;
  const fwd = cameraForward(p.yaw, p.pitch);
  // クロスヘアのレイ：カメラ位置→前方。始点はキャラ付近（カメラ後方の障害物を拾わない）
  _s0.copy(world.camera.position).addScaledVector(new THREE.Vector3(fwd.x, fwd.y, fwd.z), CAMERA.distance * s.camS);
  _s1.copy(_s0).addScaledVector(new THREE.Vector3(fwd.x, fwd.y, fwd.z), AIM_RANGE);
  let best = 1;
  const tl = raycastLevel(world.colliders, _s0, _s1);
  if (tl !== null) best = tl;
  const eh = raycastEnemies(world.enemies, _s0, _s1);
  if (eh && eh.t < best) best = eh.t;
  const point = _s0.clone().lerp(_s1, best);

  // 銃口位置
  s.vis.muzzle.getWorldPosition(_mz);
  world.aimOrigin.copy(_mz);
  world.aimDir.copy(point).sub(_mz);
  if (world.aimDir.lengthSq() < 1.5 * 1.5) world.aimDir.set(fwd.x, fwd.y, fwd.z);
  world.aimDir.normalize();
}

// ---------------------------------------------------------------- 射撃

function cancelCharge(world: World, s: PState): void {
  const p = world.player;
  if (!p.charging) return;
  p.charging = false;
  p.charge = 0;
  p.chargeSpent = 0;
  s.fullEmitted = false;
  s.suppressFire = true;
  world.events.emit('chargeCancel', {});
}

export function updateGun(world: World, dt: number): void {
  const s = st(world);
  const p = world.player;
  const input = world.input;
  if (world.state !== 'playing') return;

  p.fireCooldown = Math.max(0, p.fireCooldown - dt);

  // 吸収中は撃てない。溜め中に吸収開始(E)でキャンセル
  if (p.absorbing || isGrappling(world) || input.pressed('KeyE')) {
    if (p.charging) cancelCharge(world, s);
    s.suppressFire = input.mouse(0);
    s.holding = false;
    p.fireHold = 0;
    updateMuzzle(world, s, dt);
    return;
  }
  if (s.suppressFire) {
    if (!input.mouse(0)) s.suppressFire = false;
    s.holding = false;
    p.fireHold = 0;
    updateMuzzle(world, s, dt);
    return;
  }

  const pressed = input.mousePressed(0);
  const released = input.mouseReleased(0);
  const down = input.mouse(0);
  if (pressed) { s.holding = true; p.fireHold = 0; s.tapQueue = TAP_BUFFER; }

  // 単発はクリックした瞬間に撃つ（離すのを待たない）。クールダウン中は先行入力で受ける
  if (s.tapQueue > 0) {
    s.tapQueue -= dt;
    if (p.charging) s.tapQueue = 0;
    else if (p.fireCooldown <= 0 && spendEnergy(world, GUN.tapCost)) {
      fire(world, false, 0);
      p.fireCooldown = GUN.tapInterval;
      s.tapQueue = 0;
    }
  }

  if (s.holding && (down || pressed)) {
    p.fireHold += dt;
    if (!p.charging && p.fireHold >= GUN.chargeThreshold) {
      p.charging = true;
      p.charge = 0;
      p.chargeSpent = 0;
      s.fullEmitted = false;
      world.events.emit('chargeStart', {});
      if (p.energy <= 0) world.events.emit('noEnergy', {});
    }
    if (p.charging && p.charge < 1) {
      const r = chargeAdvance(p.charge, dt, p.energy);
      if (r.cost > 0) drainEnergy(world, r.cost);
      p.charge = Math.min(1, r.charge);
      p.chargeSpent += r.cost;
      if (p.charge >= 1 && !s.fullEmitted) { s.fullEmitted = true; world.events.emit('chargeFull', {}); }
    }
  }

  if (s.holding && (released || !down)) {
    s.holding = false;
    if (p.charging) {
      const c = p.charge;
      p.charging = false;
      p.charge = 0;
      s.fullEmitted = false;
      if (c > 0 || p.chargeSpent > 0) fire(world, true, c);
      else world.events.emit('chargeCancel', {});
      p.chargeSpent = 0;
      p.fireCooldown = GUN.tapInterval;
    }
    p.fireHold = 0;
  }
  updateMuzzle(world, s, dt);
}

function fire(world: World, charged: boolean, charge: number): void {
  const origin = world.aimOrigin.clone();
  const dir = world.aimDir.clone();
  if (charged) {
    const b = chargedBulletSize(charge);
    spawnProjectile(world, {
      pos: origin, vel: dir.multiplyScalar(GUN.chargedBulletSpeed), damage: chargeDamage(charge),
      owner: 'player', radius: b.radius, size: b.size, life: GUN.bulletLife, charged: true, color: 0x9ff4ff,
    });
    st(world).muzzleFlash = 0.18 + charge * 0.1;
  } else {
    spawnProjectile(world, {
      pos: origin, vel: dir.multiplyScalar(GUN.bulletSpeed), damage: GUN.tapDamage,
      owner: 'player', radius: 0.12, life: GUN.bulletLife, charged: false,
    });
    st(world).muzzleFlash = 0.1;
  }
  // オートエイムは補正が効いた（ロック中の）射撃でだけ電力を消費
  if (world.functions.autoAim && world.aimTarget) drainEnergy(world, FUNCTIONS.autoAim.costPerShot);
  world.stats.shots++;
  world.events.emit('shot', { charged, power: charge });
}

/** 銃口の電気球（溜め量に応じて成長、パチパチ） */
function updateMuzzle(world: World, s: PState, dt: number): void {
  const p = world.player;
  const v = s.vis;
  const on = p.charging;
  s.muzzleFlash = Math.max(0, s.muzzleFlash - dt);
  v.chargeCore.visible = v.chargeGlow.visible = on;
  v.sparks.forEach((m) => (m.visible = on));
  if (!on) { v.chargeLight.intensity = s.muzzleFlash > 0 ? 6 * (s.muzzleFlash / 0.2) : 0; return; }
  const c = p.charge;
  const t = world.time;
  const jitter = 1 + Math.sin(t * 60) * 0.12 + (Math.random() - 0.5) * 0.12;
  const base = 0.05 + c * 0.2;
  v.chargeCore.scale.setScalar(base * 0.7 * jitter);
  v.chargeGlow.scale.setScalar(base * 1.6 * jitter);
  v.chargeLight.intensity = (1.5 + c * 5) * jitter;
  s.sparkT -= dt;
  v.sparks.forEach((m, i) => {
    if (s.sparkT <= 0 || i === 0) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
      const rr = base * (1.4 + Math.random() * 1.2);
      m.position.set(Math.cos(a) * Math.cos(b) * rr, Math.sin(b) * rr, Math.sin(a) * Math.cos(b) * rr);
    }
  });
  if (s.sparkT <= 0) s.sparkT = 0.04;
}

/** 吸収アームの電流エフェクトの根元（左肩のワールド位置）。まだ見た目がなければ false */
export function getAbsorbArmRoot(world: World, out: THREE.Vector3): boolean {
  const s = states.get(world);
  if (!s) return false;
  s.vis.armL.shoulder.getWorldPosition(out);
  return true;
}

/** 向き（体）を即座に合わせる。演出（ベッドから起きた後など）で体の向きが飛ばないように */
export function setPlayerFacing(world: World, yaw: number): void {
  const s = st(world);
  s.facing = yaw;
  world.player.root.rotation.y = yaw;
}

/** 武器モデルを差し替える（WEAPONS の id）。見た目の確認用フック。ゲームの挙動は変えない */
export function setPlayerWeapon(world: World, id: string): void {
  const def = WEAPONS[id];
  if (def) st(world).vis.setWeapon(def);
}
