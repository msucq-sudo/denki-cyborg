import * as THREE from 'three';
import { ENEMIES, ENEMY_NOTICE, PLAYER } from '../config/balance';
import type { Enemy, World } from '../core/types';
import { hasLineOfSight, moveCharacter, resolveSphere } from '../core/collision';
import { playerCenter } from '../core/combat';

export type Spec = (typeof ENEMIES)[keyof typeof ENEMIES];

export interface Ctx {
  world: World;
  e: Enemy;
  dt: number;
  spec: Spec;
  /** プレイヤーの体の中心 */
  pc: THREE.Vector3;
  /** 敵 → プレイヤー（水平、正規化） */
  dirXZ: THREE.Vector3;
  dist: number;
  dist2d: number;
  los: boolean;
}

const _tmp = new THREE.Vector3();
const _feet = new THREE.Vector3();

export function makeCtx(world: World, e: Enemy, dt: number): Ctx {
  const spec = ENEMIES[e.kind];
  const pc = playerCenter(world);
  const dx = pc.x - e.pos.x, dy = pc.y - e.pos.y, dz = pc.z - e.pos.z;
  const dist2d = Math.hypot(dx, dz);
  const dist = Math.hypot(dist2d, dy);
  const dirXZ = new THREE.Vector3(dist2d > 1e-6 ? dx / dist2d : 0, 0, dist2d > 1e-6 ? dz / dist2d : 1);
  const los = dist < spec.sightRange && hasLineOfSight(world.colliders, e.pos, pc);
  // 気づき：未警戒なら ENEMY_NOTICE.range まで近づかれないと反応しない。
  // 警戒中は sightRange まで追い続ける。被弾でも警戒（damageEnemy 側）
  const wasAlert = (e.ai.alert ?? 0) > 0;
  const noticeDist = wasAlert || e.kind === 'boss' ? spec.sightRange : Math.min(spec.sightRange, ENEMY_NOTICE.range);
  if (los && dist < noticeDist) {
    e.ai.alert = e.kind === 'boss' ? 1e9 : 4;
    // 気づいた瞬間、近くの仲間にも知らせる
    if (!wasAlert) {
      world.events.emit('enemyNotice', { kind: e.kind, pos: e.pos.clone() });
      for (const o of world.enemies) {
        if (o === e || o.status !== 'active') continue;
        if (o.pos.distanceTo(e.pos) < ENEMY_NOTICE.shareRadius) o.ai.alert = Math.max(o.ai.alert ?? 0, 4);
      }
    }
  } else e.ai.alert = Math.max(0, (e.ai.alert ?? 0) - dt);
  return { world, e, dt, spec, pc, dirXZ, dist, dist2d, los };
}

export function approach(cur: number, target: number, maxDelta: number): number {
  if (cur < target) return Math.min(target, cur + maxDelta);
  return Math.max(target, cur - maxDelta);
}

/** yaw（+Z が正面）を目標方向へ滑らかに回す */
export function faceToward(e: Enemy, dx: number, dz: number, dt: number, rate = 8): void {
  if (Math.abs(dx) + Math.abs(dz) < 1e-5) return;
  const target = Math.atan2(dx, dz);
  let d = target - (e.ai.yaw ?? 0);
  d = Math.atan2(Math.sin(d), Math.cos(d));
  e.ai.yaw = (e.ai.yaw ?? 0) + d * Math.min(1, rate * dt);
}

/**
 * 地上の敵の移動。wish は目標水平速度。重力で床に立つ。
 * 戻り値は moveCharacter の結果。
 */
export function moveGround(world: World, e: Enemy, dt: number, wishX: number, wishZ: number, accel: number) {
  const v = e.vel;
  v.x = approach(v.x, wishX, accel * dt);
  v.z = approach(v.z, wishZ, accel * dt);
  v.y = Math.max(-30, v.y - PLAYER.gravity * dt);
  const r = e.radius;
  _feet.set(e.pos.x, e.pos.y - r, e.pos.z);
  const res = moveCharacter(world.colliders, _feet, v, dt, r, r * 2);
  e.pos.set(_feet.x, _feet.y + r, _feet.z);
  e.ai.onGround = res.onGround;
  return res;
}

/** 浮遊する敵の移動 */
export function moveFlyer(world: World, e: Enemy, dt: number, wish: THREE.Vector3, accel: number, wallRadius = e.radius): boolean {
  const v = e.vel;
  v.x = approach(v.x, wish.x, accel * dt);
  v.y = approach(v.y, wish.y, accel * dt);
  v.z = approach(v.z, wish.z, accel * dt);
  e.pos.addScaledVector(v, dt);
  const n = resolveSphere(world.colliders, e.pos, wallRadius);
  if (n.lengthSq() > 0) {
    n.normalize();
    const vn = v.dot(n);
    if (vn < 0) v.addScaledVector(n, -vn);
    return true;
  }
  return false;
}

/** 重力だけで落とす（'down' の敵用）。ground=true なら床に立つ */
export function fall(world: World, e: Enemy, dt: number): void {
  e.vel.x = approach(e.vel.x, 0, 10 * dt);
  e.vel.z = approach(e.vel.z, 0, 10 * dt);
  moveGround(world, e, dt, 0, 0, 10);
}

export function tmpVec(): THREE.Vector3 { return _tmp; }

/** 周囲の敵を押し合う（水平＋少し垂直）。ボスは動かさない */
export function separate(enemies: Enemy[]): void {
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    if (a.status === 'dead' || a.status === 'down') continue;
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j];
      if (b.status === 'dead' || b.status === 'down') continue;
      let dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dz = b.pos.z - a.pos.z;
      const min = (a.radius + b.radius) * 0.85;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.001;
      if (d2 < 1e-8) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; }
      const pen = (min - d);
      const nx = dx / d, ny = dy / d, nz = dz / d;
      const wa = a.kind === 'boss' ? 0 : b.kind === 'boss' ? 1 : 0.5;
      const wb = b.kind === 'boss' ? 0 : a.kind === 'boss' ? 1 : 0.5;
      const flyA = a.kind === 'drone' || !!a.ai.flying, flyB = b.kind === 'drone' || !!b.ai.flying;
      a.pos.x -= nx * pen * wa; a.pos.z -= nz * pen * wa;
      b.pos.x += nx * pen * wb; b.pos.z += nz * pen * wb;
      if (flyA) a.pos.y -= ny * pen * wa * 0.5;
      if (flyB) b.pos.y += ny * pen * wb * 0.5;
    }
  }
}

export function setVisible(o: THREE.Object3D | undefined, v: boolean): void { if (o) o.visible = v; }
