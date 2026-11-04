// 強化（レベルアップ）のデータとルール。強化画面（ui/upgradeScreen.ts）とゲームの数値の両方がここを使う。
// - GUN（武器ごと）／BODY／ARM：レベルを上げるだけ。1レベル上がるごとに決まった数値がまとめて上がる
// - SKILL：種類を選んでレベルを上げる
// - 通貨は歯車（world.inventory.gears）
// 状態は world.upgrades に持つ（リトライで World を作り直すため。階の移動では main.ts が引き継ぐ）
import type { World } from '../core/types';
import { ABSORB, DASH, DODGE, FUNCTIONS, GUN, HACK, OVERLOAD, PLAYER, RIFLE, SPECIAL_UPGRADE } from '../config/balance';
import { giveWeapon } from '../player/weaponSwitch';

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
  /** 上げる前に必要な条件（別項目が指定レベル以上）。無ければ制限なし */
  requires?: { id: string; level: number };
}

/** 項目の参照（画面とゲームで共通） */
export interface TrackRef { category: Category; id: string }

/** world.upgrades：項目 id → 今のレベル（1 から）。無い項目はレベル1 */
export type UpgradeState = Record<string, number>;

// ---------------------------------------------------------------- データ
// レベル1の値は balance.ts の定数から作る（定数を変えてもズレない）。
// 歯車は1階に7個しかないので、最初のレベルアップは1〜2個、その先は急に高くして「何を上げるか」を選ばせる。

const round = (v: number, digits: number): number => Math.round(v * 10 ** digits) / 10 ** digits;
/** base に倍率をかけた段階表。factors[0] は 1（＝初期値そのまま） */
const mul = (base: number, factors: number[], digits = 0): number[] => factors.map((f) => round(base * f, digits));
/** base に差を足した段階表。deltas[0] は 0 */
const add = (base: number, deltas: number[], digits = 0): number[] => deltas.map((d) => round(base + d, digits));

/** 銃・ボディ・アームの強化段階（Lv1〜5）の倍率 */
const MAIN_FACTORS = [1, 1.15, 1.3, 1.5, 1.7];

export const GUN_TRACKS: Track[] = [
  {
    id: 'gun.pistol', category: 'gun', name: 'ピストル', desc: '電気銃。1発が重い',
    costs: [1, 2, 3, 4],
    stats: [
      { key: 'damage', label: '単発のダメージ', values: mul(GUN.tapDamage, MAIN_FACTORS) },
      { key: 'chargeDamage', label: '溜め撃ちの最大ダメージ', values: mul(GUN.chargeMaxDamage, MAIN_FACTORS) },
      { key: 'cost', label: '単発の消費電力', values: add(GUN.tapCost, [0, 0, -1, -1, -2]), lowerIsBetter: true },
    ],
  },
  {
    // 解放するまで画面に出ない（skill.rifle を取ると武器として持つ）。長押しで連射
    id: 'gun.assault', category: 'gun', name: 'アサルト', desc: '電気ライフル。長押しで連射。1発は軽い',
    costs: [2, 3, 4, 5],
    stats: [
      { key: 'damage', label: '1発のダメージ', values: mul(RIFLE.damage, MAIN_FACTORS, 1), digits: 1 },
      { key: 'cost', label: '1発の消費電力', values: add(RIFLE.cost, [0, 0, 0, -0.5, -1], 1), digits: 1, lowerIsBetter: true },
      { key: 'interval', label: '発射間隔', unit: '秒', digits: 2, lowerIsBetter: true, values: mul(RIFLE.interval, [1, 0.95, 0.9, 0.85, 0.8], 3) },
    ],
  },
];

export const BODY_TRACK: Track = {
  id: 'body', category: 'body', name: 'ボディ', desc: '体の耐久力',
  costs: [1, 2, 3, 4],
  stats: [
    { key: 'maxHp', label: '最大HP', values: add(PLAYER.maxHp, [0, 15, 30, 45, 60]) },
    // 受けるダメージを何%減らすか（レベル1は0%＝今まで通り）
    { key: 'reduction', label: '被ダメージ軽減', unit: '%', values: [0, 5, 10, 15, 20] },
  ],
};

export const ARM_TRACK: Track = {
  id: 'arm', category: 'arm', name: 'アーム', desc: '吸収アームの性能',
  costs: [1, 2, 3, 4],
  stats: [
    { key: 'drainPerSec', label: '吸収スピード', unit: '/秒', values: mul(ABSORB.drainPerSec, MAIN_FACTORS) },
    // 吸った量のうち電力になる割合（%）。ABSORB.conversion は 0..1 なので 100 倍して持つ
    { key: 'conversion', label: '電力への変換', unit: '%', values: add(round(ABSORB.conversion * 100, 2), [0, 5, 10, 15, 20]) },
    { key: 'overloadPerSec', label: '逆流量', unit: '/秒', values: mul(OVERLOAD.energyPerSec, [1, 1.12, 1.24, 1.4, 1.6]) },
  ],
};

export const SKILL_TRACKS: Track[] = [
  {
    id: 'skill.jetpack', category: 'skill', name: 'ジェットパック', desc: '滞空中の電力消費が減る',
    costs: [2, 3, 4],
    stats: [{ key: 'drainPerSec', label: '滞空の消費電力', unit: '/秒', digits: 1, lowerIsBetter: true, values: mul(FUNCTIONS.flight.flyingDrainPerSec, [1, 0.85, 0.7, 0.55], 2) }],
  },
  {
    // 自由飛行：Lv2 で解放（フラグ）。ジェットパックを Lv2 以上にしてから
    id: 'skill.jetpackFree', category: 'skill', name: 'ジェットパック：自由飛行', desc: '空中でジャンプをもう1回押すと、体を横にして前へ飛び続ける（Lスティックで曲がる・昇降）。着地・電力切れ・Aボタンで終わる',
    costs: [5], requires: { id: 'skill.jetpack', level: 2 },
    stats: [{ key: 'enabled', label: '自由飛行', values: [0, 1] }],
  },
  {
    // ジェネレーターを倒したあとに出る。取ると武器「アサルト」を持つ（upgrade() が渡す）
    id: 'skill.rifle', category: 'skill', name: 'ライフルの解放', desc: '電気ライフル（アサルト）が使える。十字キー左右で持ち替え',
    costs: [RIFLE.unlockCost],
    stats: [{ key: 'enabled', label: 'アサルト', values: [0, 1] }],
  },
  {
    id: 'skill.speed', category: 'skill', name: '素早さ', desc: '移動とダッシュが速くなる',
    costs: [2, 3, 4],
    stats: [
      { key: 'moveSpeed', label: '移動速度', unit: ' m/s', digits: 1, values: mul(PLAYER.moveSpeed, [1, 1.06, 1.12, 1.18], 3) },
      { key: 'dashSpeed', label: 'ダッシュ速度', unit: ' m/s', digits: 1, values: mul(PLAYER.moveSpeed * DASH.speedMul, [1, 1.06, 1.12, 1.18], 3) },
    ],
  },
  {
    id: 'skill.dodge', category: 'skill', name: '回避', desc: '回避の消費が減り、無敵時間が伸びる',
    costs: [2, 3, 4],
    stats: [
      { key: 'cost', label: '回避の消費電力', digits: 1, lowerIsBetter: true, values: add(DODGE.cost, [0, -0.5, -1, -1.5], 2) },
      { key: 'invuln', label: '無敵時間', unit: '秒', digits: 2, values: add(DODGE.invuln, [0, 0.04, 0.08, 0.13], 2) },
    ],
  },
  {
    id: 'skill.hack', category: 'skill', name: 'ハッキング', desc: '味方でいる時間が伸び、入力ミスの電力が減る',
    costs: [2, 3, 4],
    stats: [
      { key: 'allyTime', label: '味方でいる時間', unit: '秒', values: add(HACK.allyTime, [0, 5, 10, 16]) },
      { key: 'failEnergy', label: 'ミス1回の消費電力', lowerIsBetter: true, values: add(HACK.failEnergy, [0, -1, -2, -3]) },
    ],
  },
  {
    id: 'skill.special', category: 'skill', name: '必殺技', desc: '電気のかめはめ波。貫通・ゲージ・太さ・ボスへのダメージが上がる',
    costs: SPECIAL_UPGRADE.costs,
    stats: [
      { key: 'pierce', label: '貫通ダメージ（最大HP比）', unit: '%', values: SPECIAL_UPGRADE.pierce },
      { key: 'gaugeMul', label: 'ゲージのたまりやすさ', unit: '%', values: SPECIAL_UPGRADE.gaugeMul },
      { key: 'beamWidth', label: 'ビームの太さ', unit: ' m', digits: 1, values: SPECIAL_UPGRADE.beamWidth },
      { key: 'boss', label: 'ボスへのダメージ（最大HP比）', unit: '%', values: SPECIAL_UPGRADE.boss },
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

/** 前提の項目が足りているか（requires が無ければ常に true） */
export function meetsRequirement(world: World, t: Track): boolean {
  return !t.requires || getLevel(world, t.requires.id) >= t.requires.level;
}

export function canUpgrade(world: World, t: Track): boolean {
  const c = nextCost(world, t);
  return c !== null && world.inventory.gears >= c && meetsRequirement(world, t);
}

/** 1レベル上げる。歯車が足りない・最大なら false（何も変えない）。上げたら 'upgrade' を発行 */
export function upgrade(world: World, t: Track): boolean {
  const c = nextCost(world, t);
  if (c === null || world.inventory.gears < c || !meetsRequirement(world, t)) return false;
  world.inventory.gears -= c;
  const lv = getLevel(world, t.id) + 1;
  world.upgrades[t.id] = lv;
  // ボディを上げたら、最大HPが増えた分だけ今のHPも増やす
  if (t.id === BODY_TRACK.id) {
    const p = world.player;
    const maxHp = statAt(world, BODY_TRACK.id, 'maxHp');
    if (maxHp > p.maxHp && p.hp > 0) p.hp += maxHp - p.maxHp;
    p.maxHp = maxHp;
  }
  if (t.id === 'skill.rifle') giveWeapon(world, 'assault');
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

/**
 * サージ収容所 2階の戦いが終わったときのごほうび：強化画面を通さずに、アサルトライフルと、ジェットパックの強化（Lv2以上・自由飛行・ジェットブースト）を解放する（レベル2＝解放済み）。
 * すでに持っているものは下げない。読み込み時（クリア済みのセーブ）にも呼ぶので、何回呼んでも同じ
 */
export function grantCamp2Rewards(world: World): void {
  world.unlocks.jetBoost = true;
  for (const id of ['skill.jetpack', 'skill.jetpackFree', 'skill.rifle']) {
    const t = findTrack(id);
    if (t && getLevel(world, id) < 2) world.upgrades[id] = 2;
  }
  world.unlocks.rifleAvail = true;
  giveWeapon(world, 'assault');
  world.level.data.saveDirty = true;
}

/** 持っている武器の GUN 項目（ピストルと、解放したアサルト） */
export function ownedGunTracks(world: World): Track[] {
  return GUN_TRACKS.filter((t) => t.id === 'gun.pistol' || (t.id === 'gun.assault' && world.loadout.owned.includes('assault')));
}

/** 強化画面の SKILL に並べる項目。ライフルの解放は、ジェネレーターを倒して研究所に戻るまで（world.unlocks.rifleAvail）出さない */
export function visibleSkillTracks(world: World): Track[] {
  return SKILL_TRACKS.filter((t) => t.id !== 'skill.rifle' || world.unlocks.rifleAvail || getLevel(world, t.id) > 1);
}
