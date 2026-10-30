// セーブデータ（ブラウザの localStorage に1枠）。
// main.ts がステージに入ったとき・チェックポイントを通ったとき・レベルが world.level.data.saveDirty を立てたときに書く。
// タイトル画面の「つづきから」で読み、最後のセーブ地点から再開する。
import type { World } from './types';
import { ALL_TRACKS, maxLevel } from '../progression/upgrades';

const KEY = 'denki-cyborg-save-v1';
export const SAVE_VERSION = 1;

const LEVEL_NAMES = ['dungeon', 'floor1', 'floor2', 'surge', 'camp1', 'camp2'] as const;
type SaveLevel = typeof LEVEL_NAMES[number];
const CHECKPOINTS: Record<SaveLevel, readonly string[]> = {
  dungeon: [],
  floor1: [],
  floor2: [],
  surge: ['stairs', 'drive'],
  camp1: ['entrance', 'boss'],
  camp2: ['boss', 'freed'],
};
const WEAPONS = ['pistol', 'shotgun', 'assault'] as const;
const UPGRADE_MAX_LEVEL = new Map(ALL_TRACKS.map((track) => [track.id, maxLevel(track)]));

export interface SaveData {
  v: number;
  /** 保存した時刻（Date.now()） */
  savedAt: number;
  /** ステージ（main.ts の LevelId） */
  level: string;
  /** そのステージの開始地点（world.level.data.startAt として渡す。undefined＝ステージの最初） */
  startAt?: string;
  /** 研究所1階へ2階から戻ってきた状態か */
  floor1Revisit?: boolean;
  inventory: World['inventory'];
  upgrades: World['upgrades'];
  functions: World['functions'];
  unlocks: World['unlocks'];
  loadout: World['loadout'];
  selectedSkill: World['skills']['selected'];
  /** ステージ固有の進行（例：収容所1階で拾った物・解いた仕掛け） */
  levelMemo?: unknown;
}

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function writeSave(data: SaveData): boolean {
  const s = storage();
  if (!s) return false;
  try { s.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function hasBooleanFields(value: unknown, fields: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  return fields.every((field) => typeof value[field] === 'boolean');
}

function isSaveData(value: unknown): value is SaveData {
  if (!isRecord(value) || value.v !== SAVE_VERSION) return false;
  if (typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt) || value.savedAt < 0) return false;
  if (typeof value.level !== 'string' || !(LEVEL_NAMES as readonly string[]).includes(value.level)) return false;
  const level = value.level as SaveLevel;

  if (hasOwn(value, 'startAt') && value.startAt !== undefined) {
    if (typeof value.startAt !== 'string' || !CHECKPOINTS[level].includes(value.startAt)) return false;
  }
  if (hasOwn(value, 'floor1Revisit') && typeof value.floor1Revisit !== 'boolean') return false;
  if (value.floor1Revisit === true && level !== 'floor1') return false;

  const inventory = value.inventory;
  if (!isRecord(inventory) || !isNonnegativeInteger(inventory.gears) || !isNonnegativeInteger(inventory.metal)) return false;

  const upgrades = value.upgrades;
  if (!isRecord(upgrades)) return false;
  for (const [id, levelValue] of Object.entries(upgrades)) {
    const maximum = UPGRADE_MAX_LEVEL.get(id);
    if (maximum === undefined || !Number.isInteger(levelValue) || (levelValue as number) < 1 || (levelValue as number) > maximum) return false;
  }

  if (!hasBooleanFields(value.functions, ['scouter', 'autoAim', 'flight'])) return false;
  if (!hasBooleanFields(value.unlocks, ['autoAim', 'vacuum'])) return false;

  const loadout = value.loadout;
  if (!isRecord(loadout) || !Array.isArray(loadout.owned) || loadout.owned.length === 0) return false;
  const owned = loadout.owned;
  if (owned.some((weapon) => typeof weapon !== 'string' || !(WEAPONS as readonly string[]).includes(weapon))) return false;
  if (new Set(owned).size !== owned.length || typeof loadout.current !== 'string' || !owned.includes(loadout.current)) return false;
  if (value.selectedSkill !== 'vacuum') return false;

  return true;
}

export function readSave(): SaveData | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const d: unknown = JSON.parse(raw);
    return isSaveData(d) ? d : null;
  } catch { return null; }
}

export function clearSave(): void {
  const s = storage();
  if (!s) return;
  try { s.removeItem(KEY); } catch { /* 何もしない */ }
}

const LEVEL_NAME: Record<string, string> = {
  dungeon: '動力炉', floor1: '研究所 1階', floor2: '研究所 2階', surge: 'サージ収容所への道', camp1: 'サージ収容所 1階', camp2: 'サージ収容所 2階',
};
const START_NAME: Record<string, string> = { boss: 'ボス戦の前', drive: '車に乗ったところ', entrance: '入口', freed: '住民解放後' };

/** タイトル画面に出す「どこから再開するか」 */
export function describeSave(d: SaveData): string {
  const where = LEVEL_NAME[d.level] ?? d.level;
  const at = d.startAt ? START_NAME[d.startAt] : undefined;
  const sub = d.level === 'camp1' && d.startAt === 'boss' ? '中ボス戦の前' : at;
  return sub ? `${where}・${sub}` : where;
}
