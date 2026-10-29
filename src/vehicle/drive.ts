// 運転（車担当 T5-B が実装）。ステージ（level/surge.ts）が呼ぶ。
// - initDrive：車を作って world.level.data.drive に置く（停車中 'parked'）
// - startDrive：乗る（プレイヤーの体を隠し、三人称の車カメラへ。phase='driving'）
// - updateDrive：毎フレーム（運転・タイミング加速・障害物・敵のはね飛ばし・判定地点 → 演出を呼ぶ）
// 失敗（障害物にぶつかる／失敗演出の終わり）はプレイヤーの HP を 0 にして死亡画面へ（main.ts が 'gameover' にする）
import type { World } from '../core/types';
import type { DriveState } from './types';

export function initDrive(world: World, at: { x: number; z: number; yaw: number }): DriveState | null {
  void world; void at;
  return null;
}

export function startDrive(world: World): void {
  void world;
}

export function updateDrive(world: World, dt: number): void {
  void world; void dt;
}
