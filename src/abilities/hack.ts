// ハッキング：hackable な敵に吸収アームをつなぐと、8個のコード入力が始まる（T3-C で実装）
import type { World } from '../core/types';

export function initHack(world: World): void {
  void world;
}

/** 毎フレーム updateAbsorb の直後に呼ぶ */
export function updateHack(world: World, dt: number): void {
  void world; void dt;
}
