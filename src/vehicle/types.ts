// 車と運転の取り決め。車担当（vehicle/）が実装し、ステージ担当（level/surge*）と演出担当（cinematic/）が使う。
import type * as THREE from 'three';

/** 車の見た目（主人公と同じ配色：白・グレー・黒・黄・シアン。balance.ts の CHARACTER.colors） */
export interface CarVisual {
  root: THREE.Group;
  /** 運転席の主人公（座ってハンドルを握る）。演出で表情・身を乗り出す動きに使う */
  driver: THREE.Group;
  /** 演出用：運転席の主人公の頭・背中（カメラの狙い） */
  driverHead: THREE.Object3D;
  /** 前輪の向き（-1..1）、タイヤの回転、速度に応じた排気・光 */
  setSteer(v: number): void;
  update(dt: number, speedMps: number): void;
  /** 運転手の姿勢。'drive'=普通、'lean'=ハンドルから前に乗り出す（失敗演出）、'brace'=衝突に備える */
  setDriverPose(pose: 'drive' | 'lean' | 'brace'): void;
  dispose(): void;
}

export type DrivePhase =
  | 'parked'      // ガレージで停車中（乗る前）
  | 'driving'     // 運転中（プレイヤーが操作）
  | 'cutscene'    // 判定地点を越えた後の演出中（cinematic/ が操作）
  | 'crashed'     // 障害物にぶつかった
  | 'done';       // 演出が終わった（成功：収容所へ／失敗：死亡画面へ）

/** world.level.data.drive に置く運転の状態（リトライで World ごと作り直す） */
export interface DriveState {
  phase: DrivePhase;
  car: CarVisual;
  /** 車の位置（地面）・向き（yaw=0 が -Z 向き、+π/2 が -X＝西向き）・速度（m/s） */
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  /** 判定地点を越えたときの結果 */
  result: 'none' | 'success' | 'fail';
}

/** km/h ⇔ m/s */
export const KMH = 1 / 3.6;
