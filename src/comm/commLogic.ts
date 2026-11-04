// スパークとの通信（ホログラム）の純粋ロジック：呼べるかどうかの判定と、追尾する位置の計算。
import { cameraForward, cameraRight } from '../player/logic';

export interface CommGate {
  /** 閉じ込め戦の最中 */
  lockdown: boolean;
  /** 起きていて敵対している敵が、通信を妨げる距離にいる */
  hostileNear: boolean;
  /** 最後に被弾してからの秒数 */
  sinceHit: number;
  /** ムービー・必殺技・ハッキングなどで操作が奪われている */
  busy: boolean;
}

/** 被弾してから、この秒数は通信できない */
export const COMM_HIT_COOLDOWN = 4;
/** この距離（m）以内に起きた敵がいる間は通信できない */
export const COMM_ENEMY_RANGE = 28;

export type CommBlock = 'lockdown' | 'enemy' | 'hit' | 'busy';

/** 呼べないときは理由、呼べるなら null */
export function commBlockReason(g: CommGate): CommBlock | null {
  if (g.busy) return 'busy';
  if (g.lockdown) return 'lockdown';
  if (g.hostileNear) return 'enemy';
  if (g.sinceHit < COMM_HIT_COOLDOWN) return 'hit';
  return null;
}

export const COMM_BLOCK_LINES: Record<CommBlock, string> = {
  busy: '',
  lockdown: '閉じ込められてる！ 話してる場合じゃないわ、まず敵を！',
  enemy: '敵が近いわ。倒してから話しましょう！',
  hit: '攻撃されてる！ いまは回避に集中して！',
};

/** ホログラムが立つ位置：プレイヤーの右斜め前（足元の高さ）。side=+1 で右、-1 で左 */
export function holoTarget(px: number, py: number, pz: number, yaw: number, side = 1, ahead = 1.9, aside = 1.35): { x: number; y: number; z: number } {
  const f = cameraForward(yaw, 0);
  const r = cameraRight(yaw);
  return { x: px + f.x * ahead + r.x * aside * side, y: py, z: pz + f.z * ahead + r.z * aside * side };
}

/** 点 (x,z) から (tx,tz) を向く Y 回転（+Z が正面のモデル用） */
export function faceYaw(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}
