// サージ収容所への道（?level=surge）。ステージ担当（T5-A）が実装する。
// 階段 → ガレージ（電力を送ってシャッターを開ける）→ 車に乗る → 運転（vehicle/）→ 判定地点 → 演出（cinematic/）
import type { World } from '../core/types';

export const SURGE_EXPOSURE = 1.05;

export function buildSurge(world: World): void {
  void world;
}

export function updateSurge(world: World, dt: number): void {
  void world; void dt;
}
