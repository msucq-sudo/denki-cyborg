// 必殺技のルール部分（ゲージ・狙う敵・貫通する敵・ダメージ量）。見た目や時間の流れは special.ts。
import * as THREE from 'three';
import { SPECIAL } from '../config/balance';
import type { Enemy, World } from '../core/types';
import { hasLineOfSight } from '../core/collision';
import { isTargetable } from '../core/enemyUtil';
import { specialBeamRadius, specialBossPct, specialGaugeMul, specialPierce } from '../progression/effects';

/** ゲージ1つ分 */
export const segmentSize = (): number => SPECIAL.max / SPECIAL.segments;

/** 各区切りのたまり具合（0..1 × 区切りの数） */
export function segmentFills(gauge: number): number[] {
  const seg = segmentSize();
  return Array.from({ length: SPECIAL.segments }, (_, i) => Math.max(0, Math.min(1, (gauge - i * seg) / seg)));
}

export const isFull = (world: World): boolean => world.special.gauge >= SPECIAL.max - 1e-6;

/** ゲージをためる（強化の倍率つき）。演出中・満タンのときは増やさない。実際に増えた量を返す */
export function addGauge(world: World, amount: number): number {
  const sp = world.special;
  if (amount <= 0 || sp.phase !== 'idle' || sp.muteGain) return 0;
  const before = sp.gauge;
  sp.gauge = Math.min(SPECIAL.max, sp.gauge + amount * specialGaugeMul(world));
  return sp.gauge - before;
}

/** 必殺技を撃ってゲージを使い切る */
export function consumeGauge(world: World): void {
  world.special.gauge = 0;
}

/** 与えたダメージ・撃破・吸収した電力からゲージをためる。吸収量は stats の差分を毎フレーム渡す */
export const gainFromDamage = (world: World, dmg: number, weak = false): number =>
  addGauge(world, dmg * SPECIAL.gainPerDamage * (weak ? SPECIAL.gainWeakMul : 1));
export const gainFromKill = (world: World): number => addGauge(world, SPECIAL.gainPerKill);
export function gainFromAbsorb(world: World): number {
  const sp = world.special;
  const cur = world.stats.energyAbsorbed;
  if (sp.lastAbsorbed < 0) { sp.lastAbsorbed = cur; return 0; }
  const d = cur - sp.lastAbsorbed;
  sp.lastAbsorbed = cur;
  return d > 0 ? addGauge(world, d * SPECIAL.gainPerAbsorb) : 0;
}

const _from = new THREE.Vector3();

/** 撃てる敵か（生きていて、味方でも休眠でもない） */
export const canTarget = (e: Enemy): boolean => isTargetable(e) && e.hp > 0;

/**
 * 狙う敵：range 以内で、視線が通っていて、いま HP が最も高い敵。いなければ null。
 * from は胸の高さ（プレイヤーの目の位置）
 */
export function pickTarget(world: World, from: THREE.Vector3, range: number = SPECIAL.range): Enemy | null {
  let best: Enemy | null = null;
  for (const e of world.enemies) {
    if (!canTarget(e)) continue;
    if (e.pos.distanceTo(from) > range) continue;
    if (best && e.hp <= best.hp) continue;
    if (!hasLineOfSight(world.colliders, from, e.pos)) continue;
    best = e;
  }
  return best;
}

/** 点 p から線分 a→b までの距離 */
export function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 < 1e-9 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = a.x + abx * t - p.x, dy = a.y + aby * t - p.y, dz = a.z + abz * t - p.z;
  return Math.hypot(dx, dy, dz);
}

/**
 * 貫通で当たる敵：プレイヤー→狙った敵（の先 overshoot m）の線分から、半径 radius 以内にいる敵（狙った敵は除く）。
 * 壁の向こうは対象にしない（ビームの根元から敵まで視線が通っていること）
 */
export function pierceTargets(world: World, from: THREE.Vector3, target: Enemy, radius: number, overshoot: number = SPECIAL.beamOvershoot): Enemy[] {
  const end = _from.copy(target.pos).sub(from).normalize().multiplyScalar(from.distanceTo(target.pos) + overshoot).add(from).clone();
  const out: Enemy[] = [];
  for (const e of world.enemies) {
    if (e === target || !canTarget(e)) continue;
    if (distToSegment(e.pos, from, end) > radius + e.radius) continue;
    if (!hasLineOfSight(world.colliders, from, e.pos)) continue;
    out.push(e);
  }
  return out;
}

/** 狙った敵へのダメージ：通常は即死（現在HP以上）、ボスは最大HPの割合 */
export function targetDamage(world: World, e: Enemy): number {
  if (e.kind === 'boss' || e.kind === 'drainGuard') return e.maxHp * specialBossPct(world);
  return e.hp + 1;
}

/** 貫通ダメージ：最大HPに対する割合（足りれば倒れる） */
export function pierceDamage(world: World, e: Enemy): number {
  return e.maxHp * specialPierce(world);
}

export const beamRadius = (world: World): number => specialBeamRadius(world);
