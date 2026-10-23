// プレイヤーの純関数（THREE 非依存でテストしやすいもの）
import { CAMERA, GUN } from '../config/balance';

export interface Vec3Like { x: number; y: number; z: number }

/** カメラ前方（水平 yaw、上下 pitch。pitch>0 で上向き。yaw=0 で -Z を向く） */
export function cameraForward(yaw: number, pitch: number): Vec3Like {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** カメラ右方向（水平） */
export function cameraRight(yaw: number): Vec3Like {
  return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
}

/**
 * カメラ相対の移動ベクトル（水平・長さ0..1）。
 * forwardInput: +1=前(W) -1=後(S)、rightInput: +1=右(D) -1=左(A)
 */
export function moveVector(yaw: number, forwardInput: number, rightInput: number): { x: number; z: number } {
  const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const r = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  let x = f.x * forwardInput + r.x * rightInput;
  let z = f.z * forwardInput + r.z * rightInput;
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  return { x, z };
}

/** マウス移動を視点角に反映。右に動かすと右を向く、下に動かすと下を向く */
export function applyLook(yaw: number, pitch: number, dx: number, dy: number, sens = CAMERA.mouseSensitivity): { yaw: number; pitch: number } {
  const p = Math.max(CAMERA.minPitch, Math.min(CAMERA.maxPitch, pitch - dy * sens));
  return { yaw: yaw - dx * sens, pitch: p };
}

/** 溜め量(0..1)から溜め撃ちのダメージ */
export function chargeDamage(charge: number): number {
  const c = Math.max(0, Math.min(1, charge));
  return GUN.chargeMinDamage + (GUN.chargeMaxDamage - GUN.chargeMinDamage) * c;
}

/** 溜め弾の見た目/当たり判定サイズ */
export function chargedBulletSize(charge: number): { radius: number; size: number } {
  const c = Math.max(0, Math.min(1, charge));
  return { radius: 0.2 + 0.3 * c, size: 0.16 + 0.34 * c };
}

/**
 * 溜めを dt 進める。電力が足りない分は進まない。
 * 戻り値: 新しい charge と、今回消費すべき電力 cost
 */
export function chargeAdvance(charge: number, dt: number, energy: number): { charge: number; cost: number } {
  const want = Math.min(Math.max(0, dt) / GUN.chargeTime, 1 - charge);
  if (want <= 0) return { charge, cost: 0 };
  const cost = want * GUN.chargeCostTotal;
  if (energy >= cost) return { charge: charge + want, cost };
  const frac = Math.max(0, energy) / cost;
  return { charge: charge + want * frac, cost: cost * frac };
}

/** 角度 cur を target へ最短方向で近づける（rate は指数減衰の強さ） */
export function smoothAngle(cur: number, target: number, rate: number, dt: number): number {
  let d = (target - cur) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return cur + d * (1 - Math.exp(-rate * dt));
}
