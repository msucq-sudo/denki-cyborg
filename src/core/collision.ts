import * as THREE from 'three';
import type { AABB } from './types';

export function makeAABB(min: THREE.Vector3, max: THREE.Vector3, tag?: string): AABB {
  return { min: min.clone(), max: max.clone(), active: true, tag };
}

/** 中心とサイズから AABB を作る */
export function aabbFromCenter(center: THREE.Vector3, size: THREE.Vector3, tag?: string): AABB {
  const h = size.clone().multiplyScalar(0.5);
  return makeAABB(center.clone().sub(h), center.clone().add(h), tag);
}

/** 線分 p0→p1 と AABB の交差。交差すれば 0..1 の t を返す */
export function segmentAABB(p0: THREE.Vector3, p1: THREE.Vector3, b: AABB): number | null {
  let tmin = 0, tmax = 1;
  const d = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
  const o = [p0.x, p0.y, p0.z];
  const mn = [b.min.x, b.min.y, b.min.z];
  const mx = [b.max.x, b.max.y, b.max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
    } else {
      const inv = 1 / d[i];
      let t1 = (mn[i] - o[i]) * inv, t2 = (mx[i] - o[i]) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/** 線分 p0→p1 と球の交差。交差すれば 0..1 の t を返す（始点が球内なら 0） */
export function segmentSphere(p0: THREE.Vector3, p1: THREE.Vector3, c: THREE.Vector3, r: number): number | null {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const fx = p0.x - c.x, fy = p0.y - c.y, fz = p0.z - c.z;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const cc = fx * fx + fy * fy + fz * fz - r * r;
  if (cc <= 0) return 0;
  if (a < 1e-12) return null;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t = (-b - s) / (2 * a);
  if (t >= 0 && t <= 1) return t;
  return null;
}

/** レベル（静的コライダー）に対する線分判定。最も近いヒットの t (0..1) を返す */
export function raycastLevel(colliders: AABB[], p0: THREE.Vector3, p1: THREE.Vector3): number | null {
  let best: number | null = null;
  for (const b of colliders) {
    if (!b.active) continue;
    const t = segmentAABB(p0, p1, b);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** 2点間に遮蔽物が無いか */
export function hasLineOfSight(colliders: AABB[], a: THREE.Vector3, b: THREE.Vector3): boolean {
  const t = raycastLevel(colliders, a, b);
  return t === null || t > 0.999;
}

/** 点が AABB 内か */
export function pointInAABB(p: THREE.Vector3, b: { min: THREE.Vector3; max: THREE.Vector3 }): boolean {
  return p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;
}

/**
 * 球を AABB 群から押し出す（その場で center を書き換える）。
 * 戻り値：押し出しの法線の合計（床に乗っていれば y>0）
 */
export function resolveSphere(colliders: AABB[], center: THREE.Vector3, radius: number): THREE.Vector3 {
  const push = new THREE.Vector3();
  for (const b of colliders) {
    if (!b.active) continue;
    const cx = Math.max(b.min.x, Math.min(center.x, b.max.x));
    const cy = Math.max(b.min.y, Math.min(center.y, b.max.y));
    const cz = Math.max(b.min.z, Math.min(center.z, b.max.z));
    let dx = center.x - cx, dy = center.y - cy, dz = center.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      const pen = radius - d;
      dx /= d; dy /= d; dz /= d;
      center.x += dx * pen; center.y += dy * pen; center.z += dz * pen;
      push.x += dx; push.y += dy; push.z += dz;
    } else {
      // 中心が箱の中：最も浅い軸で押し出す
      const opts = [
        { v: center.x - b.min.x + radius, n: [-1, 0, 0] }, { v: b.max.x - center.x + radius, n: [1, 0, 0] },
        { v: center.y - b.min.y + radius, n: [0, -1, 0] }, { v: b.max.y - center.y + radius, n: [0, 1, 0] },
        { v: center.z - b.min.z + radius, n: [0, 0, -1] }, { v: b.max.z - center.z + radius, n: [0, 0, 1] },
      ].sort((a, c) => a.v - c.v)[0];
      center.x += opts.n[0] * opts.v; center.y += opts.n[1] * opts.v; center.z += opts.n[2] * opts.v;
      push.x += opts.n[0]; push.y += opts.n[1]; push.z += opts.n[2];
    }
  }
  return push;
}

/**
 * キャラクター（足元 pos、半径 radius、高さ height の縦長カプセル近似）を移動させる。
 * 下・中・上の3つの球で押し出す。pos と vel をその場で更新。
 * 戻り値: { onGround, hitCeiling, hitWall }
 */
export function moveCharacter(
  colliders: AABB[], pos: THREE.Vector3, vel: THREE.Vector3, dt: number, radius: number, height: number,
): { onGround: boolean; hitCeiling: boolean; hitWall: boolean } {
  let onGround = false, hitCeiling = false, hitWall = false;
  const steps = Math.max(1, Math.ceil((vel.length() * dt) / (radius * 0.5)));
  const sub = dt / steps;
  const offsets = [radius, height * 0.5, height - radius];
  const c = new THREE.Vector3();
  for (let s = 0; s < steps; s++) {
    pos.addScaledVector(vel, sub);
    for (let iter = 0; iter < 2; iter++) {
      for (const oy of offsets) {
        c.set(pos.x, pos.y + oy, pos.z);
        const n = resolveSphere(colliders, c, radius);
        if (n.lengthSq() === 0) continue;
        pos.set(c.x, c.y - oy, c.z);
        if (n.y > 0.5) { onGround = true; if (vel.y < 0) vel.y = 0; }
        else if (n.y < -0.5) { hitCeiling = true; if (vel.y > 0) vel.y = 0; }
        else {
          hitWall = true;
          const h = new THREE.Vector3(n.x, 0, n.z).normalize();
          const vn = vel.x * h.x + vel.z * h.z;
          if (vn < 0) { vel.x -= h.x * vn; vel.z -= h.z * vn; }
        }
      }
    }
  }
  // 足元のわずか下に床があるかもチェック（段差でのチラつき防止）
  if (!onGround && vel.y <= 0) {
    const p0 = new THREE.Vector3(pos.x, pos.y + 0.05, pos.z);
    const p1 = new THREE.Vector3(pos.x, pos.y - 0.08, pos.z);
    if (raycastLevel(colliders, p0, p1) !== null) onGround = true;
  }
  return { onGround, hitCeiling, hitWall };
}
