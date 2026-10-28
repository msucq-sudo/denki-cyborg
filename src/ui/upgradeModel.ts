// 強化画面の「中身のルール」。DOM も three も使わない純粋なロジック（ヘッドレスでテストできる）。
// - 4つの項目（GUN / BODY / ARM / SKILL）と、それぞれの行（Track）の並び
// - カーソル（どの項目のどの行か）の移動
// - 数値の表示用の整形と、「今 » 次」の色分け
// ゲームの数値とレベルのルールは progression/upgrades.ts にあり、ここはそれを画面向けに並べ替えるだけ。
import type { World } from '../core/types';
import {
  ARM_TRACK, BODY_TRACK, SKILL_TRACKS, canUpgrade, nextCost, ownedGunTracks, upgrade,
  type Category, type StatLine, type Track,
} from '../progression/upgrades';

export interface CategoryDef {
  id: Category;
  /** 大きな英語の見出し */
  en: string;
  /** 小さな日本語の見出し */
  ja: string;
  /** その項目の説明（見出しの下） */
  hint: string;
}

/** 左の項目。上（左）から GUN → BODY → ARM → SKILL */
export const CATEGORIES: CategoryDef[] = [
  { id: 'gun', en: 'GUN', ja: '武器', hint: '歯車でレベルを上げると、数値がまとめて上がる' },
  { id: 'body', en: 'BODY', ja: '体', hint: '歯車でレベルを上げると、数値がまとめて上がる' },
  { id: 'arm', en: 'ARM', ja: 'アーム', hint: '歯車でレベルを上げると、数値がまとめて上がる' },
  { id: 'skill', en: 'SKILL', ja: 'スキル', hint: '強化するスキルを選んで、レベルを上げる' },
];

/** ある項目に並ぶ行。GUN は持っている武器ごと、BODY と ARM は1行、SKILL はスキルごと */
export function categoryTracks(world: World, cat: Category): Track[] {
  switch (cat) {
    case 'gun': return ownedGunTracks(world);
    case 'body': return [BODY_TRACK];
    case 'arm': return [ARM_TRACK];
    case 'skill': return SKILL_TRACKS;
  }
}

/** カーソル。項目ごとに最後に選んでいた行を覚える */
export interface Nav {
  cat: number;
  rows: Record<Category, number>;
}

export function createNav(): Nav {
  return { cat: 0, rows: { gun: 0, body: 0, arm: 0, skill: 0 } };
}

export function currentCategory(nav: Nav): CategoryDef {
  return CATEGORIES[nav.cat];
}

/** 選んでいる行（行が無い項目なら null） */
export function focusedTrack(nav: Nav, world: World): Track | null {
  const cat = currentCategory(nav).id;
  const list = categoryTracks(world, cat);
  return list[Math.min(nav.rows[cat], list.length - 1)] ?? null;
}

/** 項目を切り替える（端でぐるっと回る）。変わったら true */
export function moveCategory(nav: Nav, delta: number): boolean {
  const n = CATEGORIES.length;
  const next = (((nav.cat + delta) % n) + n) % n;
  if (next === nav.cat) return false;
  nav.cat = next;
  return true;
}

export function setCategory(nav: Nav, index: number): boolean {
  if (index < 0 || index >= CATEGORIES.length || index === nav.cat) return false;
  nav.cat = index;
  return true;
}

/** 行を上下に動かす（端では止まる）。動いたら true */
export function moveRow(nav: Nav, world: World, delta: number): boolean {
  const cat = currentCategory(nav).id;
  const len = categoryTracks(world, cat).length;
  const next = Math.max(0, Math.min(len - 1, nav.rows[cat] + delta));
  if (next === nav.rows[cat]) return false;
  nav.rows[cat] = next;
  return true;
}

export function setRow(nav: Nav, world: World, index: number): boolean {
  const cat = currentCategory(nav).id;
  const len = categoryTracks(world, cat).length;
  if (index < 0 || index >= len || index === nav.rows[cat]) return false;
  nav.rows[cat] = index;
  return true;
}

// ---------------------------------------------------------------- 強化の試行

export type TryResult = 'ok' | 'max' | 'poor';

/** 強化を試す。足りない・最大の理由を返す（実際の消費とイベント発行は upgrade() がやる） */
export function tryUpgrade(world: World, t: Track): TryResult {
  if (nextCost(world, t) === null) return 'max';
  if (!canUpgrade(world, t)) return 'poor';
  return upgrade(world, t) ? 'ok' : 'poor';
}

// ---------------------------------------------------------------- 数値の表示

/** 数値を桁数と単位つきの文字列にする（'20' '65%' '0.32秒'） */
export function formatStat(line: StatLine, v: number): string {
  const s = v.toFixed(line.digits ?? 0);
  return `${s}${line.unit ?? ''}`;
}

export type StatTone = 'better' | 'worse' | 'same';

/** 次の値が良くなるか。lowerIsBetter（消費電力など）は小さくなるほど良い */
export function statTone(line: StatLine, cur: number, next: number): StatTone {
  const digits = line.digits ?? 0;
  const a = Number(cur.toFixed(digits));
  const b = Number(next.toFixed(digits));
  if (a === b) return 'same';
  const up = b > a;
  return up !== !!line.lowerIsBetter ? 'better' : 'worse';
}

/** 画面の表示と同じ「cur » next」の文字列（テスト・デバッグ用） */
export function statText(line: StatLine, cur: number, next: number | null): string {
  return next === null ? `${formatStat(line, cur)} 最大` : `${formatStat(line, cur)} » ${formatStat(line, next)}`;
}
