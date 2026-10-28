import type { World, Enemy } from '../../core/types';
import type { Model } from '../models';
import type { Ctx } from '../common';
import type { SpawnFn } from '../boss';

/**
 * 1種類の敵をまとめたモジュール。kinds/ に1ファイル1種類で置き、kinds/index.ts に登録する。
 * - build: 見た目（Builder を使う。体色は bodyMats、目は eyeMats、弱点は weak() で登録すると被弾フラッシュ等が自動で効く）
 * - update: AI（world.state==='playing' かつ status が active/stunned のときだけ呼ばれる）
 * - animate: 種類別アニメ（毎フレーム。down=吸い切られて倒れている途中。ai.collapse が 0→1）
 * - onRemove: 消えるときの後始末（任意）
 */
export interface KindModule {
  build(): Model;
  update(c: Ctx, spawn: SpawnFn): void;
  animate(world: World, e: Enemy, dt: number, down: boolean): void;
  /** ノックバックの効きやすさ（0..1） */
  knockback: number;
  /** 空を飛ぶ（倒れたとき落下させる・押し合いで上下にずらす） */
  flying?: boolean;
  onRemove?(world: World, e: Enemy): void;
}
