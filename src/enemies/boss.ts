import * as THREE from 'three';
import type { Enemy, World } from '../core/types';
import type { EnemyKind } from '../config/balance';
import { hasLineOfSight, raycastLevel, segmentSphere, pointInAABB } from '../core/collision';
import { damagePlayer, PLAYER_HIT_RADIUS } from '../core/combat';
import { spawnBurst, spawnShockwave } from '../core/effects';
import { unitCylinder } from './models';
import { faceToward, moveFlyer, type Ctx } from './common';
import { fireAt } from './ai';

export const BOSS_AI = {
  minionCap: 6,
  openEvery: 6,
  openFor: 3,
  summonEvery: 15,
  summonEvery2: 12,
  laserEvery: 9,
  laserTelegraph: 0.8,
  laserFire: 1.0,
  laserDamage: 8,
  laserTick: 0.5,
  laserWidth1: 0.05,
  laserWidth2: 0.38,
  laserLength: 60,
};

export type SpawnFn = (world: World, kind: EnemyKind, pos: THREE.Vector3) => Enemy;

const MINION_KINDS: EnemyKind[] = ['drone', 'crawler', 'gunner', 'heavy'];

export function minionCount(world: World, self: Enemy): number {
  let n = 0;
  for (const o of world.enemies) {
    if (o === self || o.kind === 'boss') continue;
    if (MINION_KINDS.includes(o.kind) && (o.status === 'active' || o.status === 'stunned')) n++;
  }
  return n;
}

export function initBossAI(world: World, e: Enemy): void {
  const ai = e.ai;
  ai.phase = 1;
  ai.open = false;
  ai.openT = BOSS_AI.openEvery * 0.6;      // 次に開くまで
  ai.openLeft = 0;                          // 開いている残り
  ai.atkTimer = 2;
  ai.summonT = 8;
  ai.laserT = 5;
  ai.laser = null;
  ai.volley = 0;
  ai.orbit = Math.random() * Math.PI * 2;
  ai.room = world.level.rooms.find((r) => pointInAABB(e.pos, r)) ?? null;
  ai.openAmt = 0;
}

function setOpen(e: Enemy, open: boolean): void {
  e.ai.open = open;
  const wp = e.weakPoints[0];
  if (wp) { wp.exposed = open || e.status === 'stunned'; wp.mesh.visible = wp.exposed; }
}

export function bossFindFloor(world: World, x: number, z: number, fromY: number, toY: number): number | null {
  const t = raycastLevel(world.colliders, new THREE.Vector3(x, fromY, z), new THREE.Vector3(x, toY, z));
  return t === null ? null : fromY + (toY - fromY) * t;
}

function summon(c: Ctx, spawn: SpawnFn, kinds: EnemyKind[]): void {
  const { world, e } = c;
  const room = e.ai.room as { min: THREE.Vector3; max: THREE.Vector3 } | null;
  const room_free = BOSS_AI.minionCap - minionCount(world, e);
  const n = Math.min(kinds.length, room_free);
  for (let i = 0; i < n; i++) {
    const kind = kinds[i];
    const a = Math.random() * Math.PI * 2;
    const r = 4 + Math.random() * 4;
    let x = e.pos.x + Math.cos(a) * r, z = e.pos.z + Math.sin(a) * r;
    if (room) {
      x = THREE.MathUtils.clamp(x, room.min.x + 1.5, room.max.x - 1.5);
      z = THREE.MathUtils.clamp(z, room.min.z + 1.5, room.max.z - 1.5);
    }
    let y: number;
    if (kind === 'drone') {
      y = e.pos.y + 0.5;
      if (room) y = THREE.MathUtils.clamp(y, room.min.y + 1.5, room.max.y - 1.5);
    } else {
      const fromY = room ? room.max.y - 0.5 : e.pos.y + 4;
      const toY = room ? room.min.y - 1 : e.pos.y - 30;
      const fy = bossFindFloor(world, x, z, fromY, toY);
      y = (fy ?? (room ? room.min.y : e.pos.y - 5)) + 1.0;
    }
    const pos = new THREE.Vector3(x, y, z);
    spawn(world, kind, pos);
    spawnBurst(world, pos, 0xffa24d, 10, 4);
    spawnShockwave(world, pos, 0xffb070, 1.5, 0.3);
  }
}

function ensureBeam(e: Enemy, world: World): THREE.Mesh {
  if (e.ai.beam) return e.ai.beam;
  const mat = new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(unitCylinder(), mat);
  m.visible = false;
  m.frustumCulled = false;
  world.scene.add(m);
  e.ai.beam = m;
  (e.ai.extra ??= []).push(m);
  const core = new THREE.Mesh(unitCylinder(), new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.9, depthWrite: false }));
  m.add(core);
  core.scale.setScalar(0.45);
  e.ai.beamCore = core;
  return m;
}

function placeBeam(beam: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, width: number): void {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a);
  const len = dir.length();
  dir.normalize();
  beam.position.copy(mid);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  beam.scale.set(width, len, width);
}

function turnToward(dir: THREE.Vector3, target: THREE.Vector3, maxAngle: number): void {
  const ang = dir.angleTo(target);
  if (ang < 1e-4) return;
  dir.lerp(target, Math.min(1, maxAngle / ang)).normalize();
}

/** ボスの行動。status は 'active' か 'stunned'（ショート） */
export function updateBoss(c: Ctx, spawn: SpawnFn): void {
  const { world, e, dt, spec, pc } = c;
  const ai = e.ai;
  const stunned = e.status === 'stunned';
  const phase2 = ai.phase === 2;

  // ---- 装甲の開閉
  if (stunned) {
    setOpen(e, true);
    ai.stunT -= dt;
    if (ai.stunT <= 0) { e.status = 'active'; setOpen(e, false); ai.openT = 3; }
  } else if (ai.alert > 0) {
    if (ai.open) {
      ai.openLeft -= dt;
      if (ai.openLeft <= 0) { setOpen(e, false); ai.openT = BOSS_AI.openEvery; }
    } else {
      ai.openT -= dt;
      if (ai.openT <= 0) { setOpen(e, true); ai.openLeft = BOSS_AI.openFor; }
    }
  }
  ai.openAmt = approach01(ai.openAmt, ai.open || stunned ? 1 : 0, dt * 3);

  // ---- 移動
  const room = ai.room as { min: THREE.Vector3; max: THREE.Vector3 } | null;
  const wish = new THREE.Vector3();
  if (ai.alert > 0) {
    ai.orbit += dt * (stunned ? 0.02 : 0.12);
    const R = 14;
    let tx = world.player.pos.x + Math.cos(ai.orbit) * R;
    let tz = world.player.pos.z + Math.sin(ai.orbit) * R;
    let ty = pc.y + 0.4 + Math.sin(world.time * 0.6) * 0.8;
    if (room) {
      const m = e.radius + 1;
      tx = THREE.MathUtils.clamp(tx, room.min.x + m, room.max.x - m);
      tz = THREE.MathUtils.clamp(tz, room.min.z + m, room.max.z - m);
      ty = THREE.MathUtils.clamp(ty, room.min.y + e.radius + 0.5, room.max.y - e.radius - 0.5);
    }
    const dx = tx - e.pos.x, dy = ty - e.pos.y, dz = tz - e.pos.z;
    const d = Math.hypot(dx, dy, dz);
    const sp = (phase2 ? spec.speed * 1.4 : spec.speed) * (stunned ? 0.2 : 1) * Math.min(1, d / 3);
    if (d > 0.05) wish.set(dx / d, dy / d, dz / d).multiplyScalar(sp);
  } else {
    wish.y = Math.sin(world.time * 0.8) * 0.3;
  }
  moveFlyer(world, e, dt, wish, 3, e.radius * 0.85);
  if (ai.alert > 0) faceToward(e, c.dirXZ.x, c.dirXZ.z, dt, stunned ? 0.5 : 2);

  if (ai.alert <= 0 || stunned) { endLaser(e); return; }

  // ---- レーザー（第2形態）
  if (ai.laser) {
    updateLaser(c);
    return; // レーザー中は弾幕を止める
  }

  // ---- 召喚
  ai.summonT -= dt;
  if (ai.summonT <= 0) {
    ai.summonT = phase2 ? BOSS_AI.summonEvery2 : BOSS_AI.summonEvery;
    summon(c, spawn, phase2 ? ['crawler', 'crawler'] : ['drone', 'drone']);
  }

  // ---- 弾幕
  ai.atkTimer -= dt;
  if (ai.atkTimer <= 0 && c.los) {
    ai.atkTimer = spec.attackInterval * (phase2 ? 0.6 : 1);
    ai.volley++;
    barrage(c);
  }

  // ---- レーザー開始
  if (phase2) {
    ai.laserT -= dt;
    if (ai.laserT <= 0 && c.los) {
      ai.laserT = BOSS_AI.laserEvery;
      ai.laser = { t: 0, state: 'tele', lastHit: -1, dir: pc.clone().sub(e.pos).normalize() };
      ensureBeam(e, world);
    }
  }
}

function approach01(cur: number, target: number, d: number): number {
  return cur < target ? Math.min(target, cur + d) : Math.max(target, cur - d);
}

function barrage(c: Ctx): void {
  const { world, e, spec, pc } = c;
  const phase2 = e.ai.phase === 2;
  const speed = spec.projectileSpeed * (phase2 ? 1.4 : 1);
  const n = phase2 ? 14 : 10;
  const size = 0.26;
  const origin = e.pos.clone();
  const color = phase2 ? 0xff4a3a : 0xff7a3d;
  if (e.ai.volley % 2 === 1 || phase2) {
    // 水平の放射リング（交互にずらす）
    const off = (e.ai.volley % 2) * (Math.PI / n);
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2;
      const target = new THREE.Vector3(origin.x + Math.cos(a), origin.y, origin.z + Math.sin(a));
      fireAt(world, origin, target, speed, spec.damage, 0, size, color);
    }
  }
  if (e.ai.volley % 2 === 0 || phase2) {
    // プレイヤー狙いの扇
    const k = phase2 ? 7 : 5;
    const base = pc.clone().sub(origin).normalize();
    const side = new THREE.Vector3(-base.z, 0, base.x).normalize();
    for (let i = 0; i < k; i++) {
      const f = (i - (k - 1) / 2) * 0.11;
      const t = origin.clone().addScaledVector(base, 10).addScaledVector(side, f * 10);
      fireAt(world, origin, t, speed * 1.1, spec.damage, 0, size * 0.9, color);
    }
  }
  world.events.emit('enemyAttack', { kind: 'boss', pos: e.pos.clone() });
}

function endLaser(e: Enemy): void {
  e.ai.laser = null;
  if (e.ai.beam) e.ai.beam.visible = false;
}

function updateLaser(c: Ctx): void {
  const { world, e, dt, pc } = c;
  const L = e.ai.laser;
  L.t += dt;
  const beam = ensureBeam(e, world);
  const target = pc.clone().sub(e.pos).normalize();
  const start = e.pos.clone().addScaledVector(L.dir, e.radius * 0.8);
  e.ai.warn = 0;
  if (L.state === 'tele') {
    // 予告：ほそい赤線。最後の 0.25 秒は方向を固定
    if (L.t < BOSS_AI.laserTelegraph - 0.25) turnToward(L.dir, target, 4 * dt);
    const k = L.t / BOSS_AI.laserTelegraph;
    const end = laserEnd(world, start, L.dir);
    beam.visible = true;
    (beam.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.35 * Math.abs(Math.sin(L.t * 25));
    (beam.material as THREE.MeshBasicMaterial).color.setHex(0xff3a2a);
    e.ai.beamCore.visible = false;
    placeBeam(beam, start, end, BOSS_AI.laserWidth1 * (0.6 + k));
    e.ai.warn = k * 0.7;
    if (L.t >= BOSS_AI.laserTelegraph) {
      L.state = 'fire'; L.t = 0;
      world.events.emit('enemyAttack', { kind: 'boss', pos: e.pos.clone() });
    }
  } else {
    // 照射：ゆっくり追尾
    turnToward(L.dir, target, 0.5 * dt);
    const end = laserEnd(world, start, L.dir);
    beam.visible = true;
    (beam.material as THREE.MeshBasicMaterial).opacity = 0.55;
    (beam.material as THREE.MeshBasicMaterial).color.setHex(0xff6a3a);
    e.ai.beamCore.visible = true;
    const w = BOSS_AI.laserWidth2 * (0.9 + 0.1 * Math.sin(L.t * 40));
    placeBeam(beam, start, end, w);
    if (Math.random() < 0.5) spawnBurst(world, end, 0xffa24d, 2, 3, 0.3);
    // 当たり判定：線分と球
    const t = segmentSphere(start, end, pc, PLAYER_HIT_RADIUS + BOSS_AI.laserWidth2);
    if (t !== null && world.time - L.lastHit >= BOSS_AI.laserTick) {
      L.lastHit = world.time;
      damagePlayer(world, BOSS_AI.laserDamage);
    }
    e.ai.warn = 0.6;
    if (L.t >= BOSS_AI.laserFire) endLaser(e);
  }
}

function laserEnd(world: World, start: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 {
  const far = start.clone().addScaledVector(dir, BOSS_AI.laserLength);
  const t = raycastLevel(world.colliders, start, far);
  return t === null ? far : start.clone().lerp(far, t);
}

export { hasLineOfSight };
