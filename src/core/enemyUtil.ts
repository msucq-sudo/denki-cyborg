import * as THREE from 'three';
import type { Enemy, WeakPoint } from './types';

/** 弱点のワールド座標 */
export function weakPointWorld(enemy: Enemy, wp: WeakPoint, out = new THREE.Vector3()): THREE.Vector3 {
  enemy.root.updateMatrixWorld();
  return enemy.root.localToWorld(out.copy(wp.offset));
}

/** 生きていて攻撃・吸収対象になれる敵か（休眠中は対象外） */
export function isTargetable(e: Enemy): boolean {
  return !e.ai.dormant && !e.allied && (e.status === 'active' || e.status === 'stunned');
}

export interface EnemyRayHit {
  enemy: Enemy;
  t: number;
  weak: boolean;
  point: THREE.Vector3;
}

import { segmentSphere } from './collision';

/** 線分と敵（体・弱点）の判定。最も近いヒットを返す。弱点の方を優先（同じ敵で体より手前or同等なら弱点） */
export function raycastEnemies(enemies: Enemy[], p0: THREE.Vector3, p1: THREE.Vector3, extraRadius = 0): EnemyRayHit | null {
  let best: EnemyRayHit | null = null;
  const tmp = new THREE.Vector3();
  for (const e of enemies) {
    if (!isTargetable(e)) continue;
    const tb = segmentSphere(p0, p1, e.pos, e.radius + extraRadius);
    let hit: { t: number; weak: boolean } | null = tb !== null ? { t: tb, weak: false } : null;
    for (const wp of e.weakPoints) {
      if (!wp.exposed) continue;
      weakPointWorld(e, wp, tmp);
      const tw = segmentSphere(p0, p1, tmp, wp.radius + extraRadius);
      if (tw !== null && (hit === null || tw <= hit.t + 0.02)) hit = { t: tw, weak: true };
    }
    if (hit && (best === null || hit.t < best.t)) {
      best = { enemy: e, t: hit.t, weak: hit.weak, point: p0.clone().lerp(p1, hit.t) };
    }
  }
  return best;
}
