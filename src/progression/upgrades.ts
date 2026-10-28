// 強化（レベルアップ）のデータとルール。強化画面（ui/upgradeScreen.ts）とゲームの数値の両方がここを使う。
// - GUN（武器ごと）／BODY／ARM：レベルを上げるだけ。1レベル上がるごとに決まった数値がまとめて上がる
// - SKILL：種類を選んでレベルを上げる
// - 通貨は歯車（world.inventory.gears）
// 状態は world.upgrades に持つ（リトライで World を作り直すため。階の移動では main.ts が引き継ぐ）
import type { World } from '../core/types';

export type Category = 'gun' | 'body' | 'arm' | 'skill';

/** 1つの数値の段階。values[i] = レベル i+1 のときの値（values[0] がレベル1＝初期値） */
export interface StatLine {
  key: string;
  label: string;
  /** 表示用の単位（'/秒' '%' など）。省略可 */
  unit?: string;
  /** 表示の小数桁 */
  digits?: number;
  /** 小さいほど良い数値（消費電力など）。画面で » の色を変えるのに使う */
  lowerIsBetter?: boolean;
  values: number[];
}

/** レベルを上げられる1項目（ピストル、ボディ、アーム、各スキル） */
export interface Track {
  id: string;
  category: Category;
  name: string;
  /** 一言の説明（画面の下に出す） */
  desc: string;
  /** costs[i] = レベル i+1 → i+2 に上げるのに必要な歯車。長さ = 最大レベル - 1 */
  costs: number[];
  stats: StatLine[];
}

/** 項目の参照（画面とゲームで共通） */
export interface TrackRef { category: Category; id: string }

/** world.upgrades：項目 id → 今のレベル（1 から）。無い項目はレベル1 */
export type UpgradeState = Record<string, number>;

// ---------------------------------------------------------------- データ（T4-A で数値を決める）

export const GUN_TRACKS: Track[] = [
  {
    id: 'gun.pistol', category: 'gun', name: 'ピストル', desc: '電気銃。1発が重い',
    costs: [1, 1, 2, 2],
    stats: [
      { key: 'damage', label: 'ダメージ', values: [20, 23, 26, 30, 34] },
      { key: 'chargeDamage', label: '溜め撃ちダメージ', values: [48, 54, 60, 68, 76] },
      { key: 'cost', label: '消費電力', values: [8, 8, 7, 7, 6], lowerIsBetter: true },
    ],
  },
];

export const BODY_TRACK: Track = {
  id: 'body', category: 'body', name: 'ボディ', desc: '体の耐久力',
  costs: [1, 1, 2, 2],
  stats: [
    { key: 'maxHp', label: '最大HP', values: [100, 115, 130, 145, 160] },
    { key: 'defense', label: '防御力', digits: 2, values: [1, 1.05, 1.1, 1.15, 1.2] },
  ],
};

export const ARM_TRACK: Track = {
  id: 'arm', category: 'arm', name: 'アーム', desc: '吸収アームの性能',
  costs: [1, 1, 2, 2],
  stats: [
    { key: 'drainPerSec', label: '吸収スピード', unit: '/秒', values: [20, 23, 26, 30, 34] },
    { key: 'conversion', label: '吸収量', unit: '%', values: [65, 70, 75, 80, 85] },
    { key: 'overloadPerSec', label: '逆流量', unit: '/秒', values: [25, 28, 31, 35, 40] },
  ],
};

export const SKILL_TRACKS: Track[] = [
  {
    id: 'skill.jetpack', category: 'skill', name: 'ジェットパック', desc: '滞空中の電力消費が減る',
    costs: [1, 2, 2],
    stats: [{ key: 'drainMul', label: '滞空の消費', unit: '%', values: [100, 85, 70, 55], lowerIsBetter: true }],
  },
  {
    id: 'skill.speed', category: 'skill', name: '素早さ', desc: '移動とダッシュが速くなる',
    costs: [1, 2, 2],
    stats: [{ key: 'moveMul', label: '移動速度', unit: '%', values: [100, 106, 112, 118] }],
  },
  {
    id: 'skill.dodge', category: 'skill', name: '回避', desc: '回避の消費が減り、無敵時間が伸びる',
    costs: [1, 2, 2],
    stats: [
      { key: 'cost', label: '回避の消費', values: [4, 3.5, 3, 2.5], digits: 1, lowerIsBetter: true },
      { key: 'invuln', label: '無敵時間', unit: '秒', digits: 2, values: [0.32, 0.36, 0.4, 0.45] },
    ],
  },
  {
    id: 'skill.hack', category: 'skill', name: 'ハッキング', desc: '味方でいる時間が伸び、入力ミスの電力が減る',
    costs: [1, 2, 2],
    stats: [
      { key: 'allyTime', label: '味方の時間', unit: '秒', values: [20, 25, 30, 36] },
      { key: 'failEnergy', label: 'ミスの電力', values: [3, 2, 1, 0], lowerIsBetter: true },
    ],
  },
];

export const ALL_TRACKS: Track[] = [...GUN_TRACKS, BODY_TRACK, ARM_TRACK, ...SKILL_TRACKS];

// ---------------------------------------------------------------- ルール

export function findTrack(id: string): Track | undefined {
  return ALL_TRACKS.find((t) => t.id === id);
}

export function maxLevel(t: Track): number {
  return t.costs.length + 1;
}

export function getLevel(world: World, id: string): number {
  return Math.max(1, world.upgrades[id] ?? 1);
}

/** 次のレベルに上げる歯車の数。最大レベルなら null */
export function nextCost(world: World, t: Track): number | null {
  const lv = getLevel(world, t.id);
  return lv >= maxLevel(t) ? null : t.costs[lv - 1];
}

export function canUpgrade(world: World, t: Track): boolean {
  const c = nextCost(world, t);
  return c !== null && world.inventory.gears >= c;
}

/** 1レベル上げる。歯車が足りない・最大なら false（何も変えない）。上げたら 'upgrade' を発行 */
export function upgrade(world: World, t: Track): boolean {
  const c = nextCost(world, t);
  if (c === null || world.inventory.gears < c) return false;
  world.inventory.gears -= c;
  const lv = getLevel(world, t.id) + 1;
  world.upgrades[t.id] = lv;
  world.events.emit('upgrade', { id: t.id, level: lv });
  return true;
}

/** ある項目の数値（今のレベルの値） */
export function statAt(world: World, trackId: string, key: string): number {
  const t = findTrack(trackId);
  const s = t?.stats.find((x) => x.key === key);
  if (!t || !s) throw new Error(`unknown stat ${trackId}.${key}`);
  const lv = getLevel(world, trackId);
  return s.values[Math.min(lv, s.values.length) - 1];
}

/** 画面用：各数値の今と次（最大なら next=null） */
export function preview(world: World, t: Track): { line: StatLine; cur: number; next: number | null }[] {
  const lv = getLevel(world, t.id);
  const atMax = lv >= maxLevel(t);
  return t.stats.map((line) => ({
    line,
    cur: line.values[Math.min(lv, line.values.length) - 1],
    next: atMax ? null : line.values[Math.min(lv + 1, line.values.length) - 1],
  }));
}

/** 持っている武器の GUN 項目（今はピストルだけ） */
export function ownedGunTracks(_world: World): Track[] {
  return GUN_TRACKS.filter((t) => t.id === 'gun.pistol');
}
