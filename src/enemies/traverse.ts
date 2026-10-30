import * as THREE from 'three';
import { PLAYER, TRAVERSE, type TraverseMode } from '../config/balance';
import { raycastLevel, resolveSphere } from '../core/collision';
import { spawnBurst } from '../core/effects';
import { faceToward, moveGround, type Ctx } from './common';

/**
 * 高所のプレイヤーへ向かう移動（壁登り・ジェットパック・大ジャンプ）。
 * 地上の敵が「プレイヤーが高いところにいる」と判断したときだけ、通常 AI の代わりに動かす。
 * TRAVERSE.enabled=false で丸ごと無効（従来どおり地上から見上げるだけ）。
 */

const _to = new THREE.Vector3();
const _p = new THREE.Vector3();

interface Trav { mode: TraverseMode; t: number; limit: number; leapT?: number }

/** 高所移動中なら true（通常 AI は呼ばない） */
export function updateTraverse(c: Ctx): boolean {
  const { e, dt } = c;
  const ai = e.ai;
  const mode = TRAVERSE.modes[e.kind];
  if (!TRAVERSE.enabled || !mode) return false;
  ai.travCd = Math.max(0, (ai.travCd ?? 0) - dt);
  const tr: Trav | undefined = ai.trav;

  if (!tr) {
    if (e.status !== 'active' || e.tethered || ai.alert <= 0 || ai.travCd > 0) return false;
    if (!ai.onGround && !hasSupport(c)) return false; // 独自の移動をする敵は onGround を持たないので、足元の床でも判定する
    const rise = c.pc.y - e.pos.y;
    if (rise < TRAVERSE.minRise || c.dist2d > TRAVERSE.range) return false;
    if (mode === 'leap' && rise > TRAVERSE.leapMaxRise) return false;
    const sp = mode === 'jet' ? TRAVERSE.jetSpeed : TRAVERSE.climbSpeed[e.kind] ?? TRAVERSE.climbSpeedDefault;
    ai.trav = { mode, t: 0, limit: TRAVERSE.timeout + (rise / sp) * TRAVERSE.timeoutPerRise } as Trav;
    if (mode === 'leap') startLeap(c, ai.trav);
    return true;
  }

  // 中断：吸収・スタン・ダウン
  if (e.status !== 'active' || e.tethered) { endTraverse(c); return false; }
  tr.t += dt;
  // 到着＝目標の高さまで来て、足元に足場がある（壁の縁の手前では降りない）
  const reached = c.pc.y - e.pos.y < TRAVERSE.arriveRise && hasSupport(c);
  if (tr.t > tr.limit || (tr.mode !== 'leap' && reached)) {
    endTraverse(c, tr.t > tr.limit);
    return false;
  }
  if (tr.mode === 'leap') stepLeap(c, tr);
  else stepFly(c, tr);
  return true;
}

function hasSupport(c: Ctx): boolean {
  const { world, e } = c;
  _p.set(e.pos.x, e.pos.y - e.radius - 0.6, e.pos.z);
  return raycastLevel(world.colliders, e.pos, _p) !== null;
}

function endTraverse(c: Ctx, failed = false): void {
  const ai = c.e.ai;
  ai.trav = undefined;
  ai.travCd = failed ? TRAVERSE.failCooldown : TRAVERSE.cooldown;
  ai.climbing = false;
  ai.jet = false;
  c.e.vel.y = Math.min(c.e.vel.y, 0);
}

/** 壁登り / ジェットパック：重力を無視して目標へ直進。壁は球で押し返されるので、壁沿いに上へ滑って登る */
function stepFly(c: Ctx, tr: Trav): void {
  const { world, e, dt, pc, dirXZ } = c;
  const ai = e.ai;
  const climb = tr.mode === 'climb';
  const speed = climb ? TRAVERSE.climbSpeed[e.kind] ?? TRAVERSE.climbSpeedDefault : TRAVERSE.jetSpeed;
  // 目標：登りはプレイヤーの足元の真上へ。ジェットは頭上近くへ飛んで降りる
  _to.set(pc.x, pc.y + (climb ? 0 : 0.8), pc.z).sub(e.pos);
  const wish = _to.normalize().multiplyScalar(speed);
  // 登りは壁際で上に向かう力を足す（目標が壁の向こうにあっても上へ抜けられるように）
  if (climb) wish.y = Math.max(wish.y, speed * 0.6);
  const v = e.vel;
  v.x += (wish.x - v.x) * Math.min(1, dt * 8);
  v.y += (wish.y - v.y) * Math.min(1, dt * 8);
  v.z += (wish.z - v.z) * Math.min(1, dt * 8);
  e.pos.addScaledVector(v, dt);
  const push = resolveSphere(world.colliders, e.pos, e.radius);
  if (push.lengthSq() > 0) {
    push.normalize();
    const vn = v.dot(push);
    if (vn < 0) v.addScaledVector(push, -vn);
  }
  ai.onGround = false;
  faceToward(e, dirXZ.x, dirXZ.z, dt, 8);
  if (climb) {
    ai.climbing = true;
    ai.walk = speed; // 車輪・脚アニメを回す
  } else {
    ai.jet = true;
    ai.jetT = (ai.jetT ?? 0) - dt;
    if (ai.jetT <= 0) {
      ai.jetT = 0.05;
      _p.set(e.pos.x, e.pos.y - e.radius, e.pos.z);
      spawnBurst(world, _p, 0xffa040, 3, 3, 0.3);
    }
  }
}

/** 大ジャンプ：目標の足場まで届く初速を計算して跳ぶ */
function startLeap(c: Ctx, tr: Trav): void {
  const { e, pc } = c;
  const g = PLAYER.gravity;
  const rise = pc.y - e.pos.y;
  const vy = Math.sqrt(2 * g * (rise + TRAVERSE.leapClear));
  const T = (vy + Math.sqrt(Math.max(0, vy * vy - 2 * g * rise))) / g;
  const dx = pc.x - e.pos.x, dz = pc.z - e.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const sp = Math.min(TRAVERSE.leapMaxSpeed, d / T);
  e.vel.set((dx / d) * sp, vy, (dz / d) * sp);
  e.ai.onGround = false;
  tr.leapT = 0;
}

function stepLeap(c: Ctx, tr: Trav): void {
  const { world, e, dt, dirXZ } = c;
  tr.leapT = (tr.leapT ?? 0) + dt;
  moveGround(world, e, dt, e.vel.x, e.vel.z, 0);
  faceToward(e, e.vel.x, e.vel.z, dt, 6);
  if (tr.leapT > 0.25 && e.ai.onGround) endTraverse(c);
  void dirXZ;
}
