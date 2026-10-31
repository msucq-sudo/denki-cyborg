// ドームシールドの判定（ドーマーが使う）。ドームは足元を中心にした球で、展開中は外から来る
// プレイヤーの弾・吸収アーム・バキュームを止める。中にいる者（プレイヤーも）は自由に出入りできる。
// 敵の弾は止めない（中から外へ撃てる）
import * as THREE from 'three';
import type { Barrier, Enemy, World } from '../core/types';
import { segmentSphere } from '../core/collision';
import { spawnBurst, spawnFlash, spawnShockwave } from '../core/effects';

export const BARRIER_COLOR = 0x6fe0ff;

const _c = new THREE.Vector3();

/** ドームの中心（足元） */
export function barrierCenter(e: Enemy, out: THREE.Vector3): THREE.Vector3 {
  return out.set(e.pos.x, e.pos.y - e.radius, e.pos.z);
}

/** 守っているドーム（展開しきっていて壊れていない・持ち主が動ける） */
export function activeBarrier(e: Enemy): Barrier | null {
  const b = e.barrier;
  if (!b || b.k < 1 || b.hp <= 0) return null;
  if (e.ai.dormant || (e.status !== 'active' && e.status !== 'stunned')) return null;
  return b;
}

/** p0→p1 の線分が、外側からドームの表面に最初に当たる点。中から出る線分は通す */
export function hitBarriers(world: World, p0: THREE.Vector3, p1: THREE.Vector3, extra = 0): { enemy: Enemy; t: number; point: THREE.Vector3 } | null {
  let best: { enemy: Enemy; t: number; point: THREE.Vector3 } | null = null;
  for (const e of world.enemies) {
    const b = activeBarrier(e);
    if (!b) continue;
    barrierCenter(e, _c);
    if (p0.distanceTo(_c) <= b.radius) continue;
    const t = segmentSphere(p0, p1, _c, b.radius + extra);
    if (t !== null && (best === null || t < best.t)) best = { enemy: e, t, point: p0.clone().lerp(p1, t) };
  }
  return best;
}

/** pos を含むドーム（なければ null）。except は数えない */
export function barrierAt(world: World, pos: THREE.Vector3, except?: Enemy): Enemy | null {
  for (const e of world.enemies) {
    if (e === except) continue;
    const b = activeBarrier(e);
    if (!b) continue;
    if (pos.distanceTo(barrierCenter(e, _c)) <= b.radius) return e;
  }
  return null;
}

/** from の位置から見て、target がドームに守られているか（target だけがドームの中にいる） */
export function isBarrierProtected(world: World, target: Enemy, from: THREE.Vector3): boolean {
  for (const e of world.enemies) {
    const b = activeBarrier(e);
    if (!b) continue;
    barrierCenter(e, _c);
    if (target.pos.distanceTo(_c) <= b.radius && from.distanceTo(_c) > b.radius) return true;
  }
  return false;
}

/** ドームにダメージ。0 になったら壊れて、持ち主が一瞬ひるむ */
export function damageBarrier(world: World, owner: Enemy, amount: number, at: THREE.Vector3): void {
  const b = owner.barrier;
  if (!b || b.hp <= 0) return;
  b.hp = Math.max(0, b.hp - amount);
  b.flash = 1;
  spawnBurst(world, at, BARRIER_COLOR, 6, 3, 0.3);
  world.events.emit('shieldBlock', { pos: at.clone() });
  if (b.hp <= 0) breakBarrier(world, owner);
}

/** ドームを割る（ひびの演出・持ち主をスタン）。再展開は持ち主の AI が決める */
export function breakBarrier(world: World, owner: Enemy): void {
  const b = owner.barrier;
  if (!b) return;
  b.hp = 0;
  b.k = 0;
  const c = barrierCenter(owner, new THREE.Vector3());
  c.y += b.radius * 0.4;
  spawnShockwave(world, c, BARRIER_COLOR, b.radius * 1.1, 0.45);
  spawnBurst(world, c, BARRIER_COLOR, 36, b.radius * 1.6, 0.8);
  spawnBurst(world, c, 0xffffff, 14, 5, 0.5);
  spawnFlash(world, c, 0xbfeaff, 10, 14, 0.25);
  world.events.emit('enemyAction', { kind: owner.kind, pos: c.clone(), action: 'domeBreak' });
  owner.ai.domeBroken = true;
  owner.ai.domeStun = 1.6;
}
