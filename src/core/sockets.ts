// 電源ソケット：弾が当たる／吸収アームを伸ばして電気を送れる固定の標的（1階の非常用電源など）
import * as THREE from 'three';
import type { World } from './types';

export interface PowerSocket {
  pos: THREE.Vector3;
  radius: number;
  /** false になったら無効（作動済み） */
  enabled: boolean;
  /** プレイヤーの弾が当たった */
  onShot(): void;
  /** アームで電気を送った（エネルギーを 1 受け取って作動） */
  onFeed(): void;
}

const registry = new WeakMap<World, PowerSocket[]>();

export function getSockets(world: World): PowerSocket[] {
  let l = registry.get(world);
  if (!l) registry.set(world, (l = []));
  return l;
}
export function clearSockets(world: World): void { registry.delete(world); }
