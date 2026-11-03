// 演出（カットシーン）の窓口。車担当が判定地点で呼ぶ。
// 演出中は world.level.data.drive.phase = 'cutscene'。終わったら 'done' にして onDone を1回だけ呼ぶ。
// 車担当は毎フレーム（通常のカメラ制御の後に）handle.update(world, dt) を呼ぶ。World が作り直されたら演出は自分で片付く。
import type { World } from '../core/types';
import type { DriveState } from '../vehicle/types';
import { Cutscene } from './sequencer';
import { successScript } from './success';
import { failScript } from './fail';
import { drainSuccessScript } from './drainSuccess';
import { drainFailScript } from './drainFail';
import { drainStallScript } from './drainStall';

export interface CutsceneHandle {
  /** 毎フレーム（レベルの tick から）。演出中は通常のカメラ制御より後に呼んでカメラを上書きする */
  update(world: World, dt: number): void;
  /** 終わったら true */
  readonly done: boolean;
  /** スキップ（決定ボタン長押しなど） */
  skip(): void;
}

function begin(drive: DriveState, onDone: () => void): () => void {
  drive.phase = 'cutscene';
  return () => {
    drive.phase = 'done';
    onDone();
  };
}

/** 成功：判定地点を 300km/h 以上で越えた → 柵を突き破って収容所の壁に激突 */
export function playSuccessCutscene(world: World, drive: DriveState, onDone: () => void): CutsceneHandle {
  return new Cutscene(world, (rt) => successScript(rt, drive), begin(drive, onDone));
}

/** 失敗：300km/h に届かなかった → ヘビー3体が横から現れて車を受け止める → 死亡画面 */
export function playFailCutscene(world: World, drive: DriveState, onDone: () => void): CutsceneHandle {
  return new Cutscene(world, (rt) => failScript(rt, drive), begin(drive, onDone));
}

// ---- ルート2（ドレイン装置へ。DriveState.route === 'drain'）：判定地点 E（CHECKPOINT_E）の結果ごとの演出。
// 中身は drainSuccess.ts / drainFail.ts / drainStall.ts（いまは仮。演出担当が置き換える）。onDone の扱いは上と同じ。
// 成功のあとの level 'drain' への遷移・失敗/失速のあとの HP 0 は、onDone を受けた drive.ts が行う。

/** ルート2・成功：300km/h 以上 → 坂を駆け上がって、ドレイン装置の扉へ（→ level 'drain'） */
export function playDrainSuccessCutscene(world: World, drive: DriveState, onDone: () => void): CutsceneHandle {
  return new Cutscene(world, (rt) => drainSuccessScript(rt, drive), begin(drive, onDone));
}

/** ルート2・失敗：200〜299km/h → 坂は登り切るが、扉にはね返される → 死亡画面 */
export function playDrainFailCutscene(world: World, drive: DriveState, onDone: () => void): CutsceneHandle {
  return new Cutscene(world, (rt) => drainFailScript(rt, drive), begin(drive, onDone));
}

/** ルート2・失速：200km/h 未満 → 坂の途中で失速 → 滑り落ちて発電所の脇の壁に激突 → 死亡画面 */
export function playDrainStallCutscene(world: World, drive: DriveState, onDone: () => void): CutsceneHandle {
  return new Cutscene(world, (rt) => drainStallScript(rt, drive), begin(drive, onDone));
}
