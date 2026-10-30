// 電力源：吸収アームをつないで電力を吸い取れる固定の装置（サージ収容所1階のレーザー網の電源など）。
// sockets.ts（電気を「送る」装置）の逆。吸い尽くすと onEmpty が1回だけ呼ばれる。
import type * as THREE from 'three';
import type { World } from './types';

export interface PowerSource {
  pos: THREE.Vector3;
  radius: number;
  /** false になったら無効（吸い尽くした） */
  enabled: boolean;
  /** 残りの電力 */
  amount: number;
  /** 最初の電力（見た目の割合用） */
  max: number;
  /** 吸った（got＝今回吸った量） */
  onDrain?(got: number): void;
  /** 吸い尽くした */
  onEmpty(): void;
}

const registry = new WeakMap<World, PowerSource[]>();

export function getPowerSources(world: World): PowerSource[] {
  let l = registry.get(world);
  if (!l) registry.set(world, (l = []));
  return l;
}
export function clearPowerSources(world: World): void { registry.delete(world); }

/** 電力源から amount だけ吸う。実際に吸えた量を返す。空になったら無効にして onEmpty */
export function drainSource(s: PowerSource, amount: number): number {
  if (!s.enabled || amount <= 0) return 0;
  const got = Math.min(amount, s.amount);
  s.amount -= got;
  if (got > 0) s.onDrain?.(got);
  if (s.amount <= 1e-6) {
    s.amount = 0;
    s.enabled = false;
    s.onEmpty();
  }
  return got;
}
