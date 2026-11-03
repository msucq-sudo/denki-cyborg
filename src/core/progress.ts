// ゲーム全体の進行フラグ（World を作り直しても残る。セーブ（core/save.ts）に含めて、読み込み時に main.ts が戻す）。
// 各ステージは World が作られるとき main.ts が world.level.data.camp2Cleared に写したものを読む（このモジュールを直接読まない）。

export interface Progress {
  /** 収容所 2階のボス（ジェネレーター）を倒して住民を解放した。サージの道が 2本目（ドレイン装置へ）になる／2階の出口が最初から開く */
  camp2Cleared: boolean;
}

export const progress: Progress = { camp2Cleared: false };

/** 収容所 2階クリアを記録する（World があれば level.data にも写し、保存を促す） */
export function markCamp2Cleared(world?: { level: { data: Record<string, unknown> } }): void {
  progress.camp2Cleared = true;
  if (world) {
    world.level.data.camp2Cleared = true;
    world.level.data.saveDirty = true;
  }
}

export function resetProgress(): void {
  progress.camp2Cleared = false;
}
