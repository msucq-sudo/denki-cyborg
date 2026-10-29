// 演出（カットシーン）の窓口。演出担当（cinematic/）が実装し、車担当が判定地点で呼ぶ。
// 演出中は world.level.data.drive.phase = 'cutscene'。終わったら 'done' にして onDone を呼ぶ。
import type { World } from '../core/types';
import type { DriveState } from '../vehicle/types';

export interface CutsceneHandle {
  /** 毎フレーム（レベルの tick から）。演出中は通常のカメラ制御より後に呼んでカメラを上書きする */
  update(world: World, dt: number): void;
  /** 終わったら true */
  readonly done: boolean;
  /** スキップ（決定ボタン長押しなど） */
  skip(): void;
}

/** 成功：判定地点を 300km/h 以上で越えた → 柵を突き破って収容所の壁に激突 */
export function playSuccessCutscene(world: World, drive: DriveState, onDone: () => void): CutsceneHandle {
  void world; void drive;
  return stubCutscene(onDone);
}

/** 失敗：300km/h に届かなかった → ヘビー3体が横から現れて車を受け止める → 死亡画面 */
export function playFailCutscene(world: World, drive: DriveState, onDone: () => void): CutsceneHandle {
  void world; void drive;
  return stubCutscene(onDone);
}

function stubCutscene(onDone: () => void): CutsceneHandle {
  let fired = false;
  return {
    get done() { return fired; },
    update() { if (!fired) { fired = true; onDone(); } },
    skip() { if (!fired) { fired = true; onDone(); } },
  };
}
