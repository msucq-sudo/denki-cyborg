// 強化の効果をゲームの数値として取り出す入口。ゲーム側（player / combat / absorb / hack など）は
// balance.ts の定数を直接読まず、ここの関数を通す。レベル1の値は balance.ts の定数と同じ。
import type { World } from '../core/types';
import { DASH } from '../config/balance';
import { ARM_TRACK, BODY_TRACK, statAt } from './upgrades';

// ---- GUN（ピストル）
/** ピストル：単発のダメージ */
export const gunDamage = (w: World): number => statAt(w, 'gun.pistol', 'damage');
/** ピストル：最大溜めのダメージ */
export const gunChargeMaxDamage = (w: World): number => statAt(w, 'gun.pistol', 'chargeDamage');
/** ピストル：単発の消費電力 */
export const gunTapCost = (w: World): number => statAt(w, 'gun.pistol', 'cost');

// ---- BODY
/** 最大HP */
export const playerMaxHp = (w: World): number => statAt(w, BODY_TRACK.id, 'maxHp');
/** 被ダメージ軽減（0..1。0.1 なら受けるダメージが 10% 減る） */
export const damageReduction = (w: World): number => statAt(w, BODY_TRACK.id, 'reduction') / 100;
/** 被ダメージにかける倍率（1 - 軽減） */
export const damageTakenMul = (w: World): number => 1 - damageReduction(w);

// ---- ARM
/** 吸収：敵HPを毎秒どれだけ吸うか */
export const absorbDrainPerSec = (w: World): number => statAt(w, ARM_TRACK.id, 'drainPerSec');
/** 吸収：吸った量のうち電力になる割合（0..1） */
export const absorbConversion = (w: World): number => statAt(w, ARM_TRACK.id, 'conversion') / 100;
/** 吸収で得られる電力/秒（HUD の表示用。敵ごとの倍率は含まない） */
export const absorbEnergyPerSec = (w: World): number => absorbDrainPerSec(w) * absorbConversion(w);
/** 逆流：プレイヤーが送り込む電力/秒 */
export const overloadEnergyPerSec = (w: World): number => statAt(w, ARM_TRACK.id, 'overloadPerSec');

// ---- SKILL
/** ジェットパック：滞空中の消費電力/秒 */
export const flightDrainPerSec = (w: World): number => statAt(w, 'skill.jetpack', 'drainPerSec');
/** 素早さ：基本の移動速度（m/s） */
export const moveSpeed = (w: World): number => statAt(w, 'skill.speed', 'moveSpeed');
/** 素早さ：ダッシュ中の移動速度（m/s。補助キャラ等の基準に使う） */
export const dashSpeed = (w: World): number => moveSpeed(w) * DASH.speedMul;
/** 回避：消費電力 */
export const dodgeCost = (w: World): number => statAt(w, 'skill.dodge', 'cost');
/** 回避：無敵時間（秒） */
export const dodgeInvuln = (w: World): number => statAt(w, 'skill.dodge', 'invuln');
/** ハッキング：味方でいる時間（秒） */
export const hackAllyTime = (w: World): number => statAt(w, 'skill.hack', 'allyTime');
/** ハッキング：入力ミス1回の消費電力 */
export const hackFailEnergy = (w: World): number => statAt(w, 'skill.hack', 'failEnergy');

// ---- 同期
/**
 * world.upgrades から決まるプレイヤーの数値を反映する（毎フレーム呼んでよい軽い処理）。
 * 階の移動・リトライで World が作り直されても、最大HPが強化に合うようにする。
 * 最大HPが増えた分の回復は upgrade() の中でやる（ここでは HP を増やさない。上限を超えていたら切る）
 */
export function syncPlayerStats(world: World): void {
  const p = world.player;
  const maxHp = playerMaxHp(world);
  if (p.maxHp !== maxHp) p.maxHp = maxHp;
  if (p.hp > p.maxHp) p.hp = p.maxHp;
}
