import * as THREE from 'three';
import { PLAYER } from '../config/balance';
import type { World } from './types';
import { damageTakenMul } from '../progression/effects';

/** プレイヤーの体の中心（被弾判定用の球の中心） */
export function playerCenter(world: World, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(world.player.pos).add(new THREE.Vector3(0, PLAYER.height * 0.5, 0));
}
export const PLAYER_HIT_RADIUS = 0.55;

/** プレイヤーへのダメージ（HP）。無敵中・プレイ中以外は無効 */
export function damagePlayer(world: World, amount: number): void {
  const p = world.player;
  if (world.state !== 'playing' || p.invuln > 0 || p.hp <= 0) return;
  // ボディ強化の被ダメージ軽減
  const dealt = amount * damageTakenMul(world);
  p.hp = Math.max(0, p.hp - dealt);
  p.invuln = PLAYER.hitInvuln;
  world.events.emit('playerHit', { amount: dealt });
}

export function healPlayer(world: World, amount: number): void {
  const p = world.player;
  p.hp = Math.min(p.maxHp, p.hp + amount);
}

export function toast(world: World, text: string, seconds = 3): void {
  world.toasts.push({ text, timer: seconds });
}
