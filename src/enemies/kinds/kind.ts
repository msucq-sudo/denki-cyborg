import type { World, Enemy } from '../../core/types';
import type { Model } from '../models';
import type { Ctx } from '../common';
import type { SpawnFn } from '../boss';
import type { DamageOpts } from '../enemies';

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
  /** damageEnemy で HP が減った直後（倒れていない時のみ）。damage は倍率適用後 */
  onHit?(world: World, e: Enemy, damage: number, opts: DamageOpts): void;
  /** 倒れた瞬間。how='absorb' は吸い切られて停止、'expire' は味方の時間切れ */
  onGone?(world: World, e: Enemy, how: 'shot' | 'explosion' | 'absorb' | 'expire'): void;
  /** ハッキングできる（吸収アームをつなぐとコード入力が始まる。abilities/hack.ts） */
  hackable?: boolean;
  /** 味方になっている間の AI（e.allied のとき update の代わりに呼ばれる）。無ければその場で待機 */
  updateAlly?(c: Ctx): void;
}
