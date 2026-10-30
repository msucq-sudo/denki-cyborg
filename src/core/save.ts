// セーブデータ（latest 1件と、チェックポイントごとの初回状態を localStorage に保存）。
// main.ts がステージに入ったとき・チェックポイントを通ったとき・レベルが world.level.data.saveDirty を立てたときに書く。
// タイトル画面の「つづきから」で読み、最後のセーブ地点から再開する。
import type { World } from './types';
import { CAMERA } from '../config/balance';
import { ALL_TRACKS, maxLevel } from '../progression/upgrades';

const KEY = 'denki-cyborg-save-v1';
const HISTORY_KEY = 'denki-cyborg-save-history-v1';
const MAX_HISTORY_IDS = 128;
const MAX_RESUME_POSITION = 10_000;
const MAX_RESUME_YAW = 1_000_000;
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
  /** 同じ地点での最初の状態を履歴上でまとめるID */
  checkpointId?: string;
  /** ワールド内の再開位置。ステージ側で安全な位置として復元する */
  resume?: SaveResume;
}

export interface SaveResume {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function writeSave(data: SaveData): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const previous = readStoredSave(s);
    const records = readStoredHistory(s);
    const ids = new Set(records.map(getSaveCheckpointId));
    appendFirstSnapshot(records, ids, previous);
    appendFirstSnapshot(records, ids, data);

    // Commit the archive first. If it cannot be saved, keep the previous latest intact.
    const historyJson = JSON.stringify({ v: SAVE_VERSION, records });
    const latestJson = JSON.stringify(data);
    s.setItem(HISTORY_KEY, historyJson);
    s.setItem(KEY, latestJson);
    return true;
  } catch { return false; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Stable location identity used by the archive and history reader. */
export function getSaveCheckpointId(data: SaveData): string {
  return data.checkpointId ?? (data.level === 'floor1' && data.floor1Revisit
    ? 'floor1:revisit'
    : `${data.level}:${data.startAt ?? 'start'}`);
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
  if (hasOwn(value, 'checkpointId') && value.checkpointId !== undefined) {
    if (typeof value.checkpointId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(value.checkpointId)) return false;
  }
  if (hasOwn(value, 'resume') && value.resume !== undefined && !isSaveResume(value.resume)) return false;

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

function isSaveResume(value: unknown): value is SaveResume {
  if (!isRecord(value)) return false;
  const values = [value.x, value.y, value.z, value.yaw, value.pitch];
  if (!values.every((item) => typeof item === 'number' && Number.isFinite(item))) return false;
  const x = value.x as number, y = value.y as number, z = value.z as number;
  const yaw = value.yaw as number, pitch = value.pitch as number;
  return Math.abs(x) <= MAX_RESUME_POSITION && Math.abs(y) <= MAX_RESUME_POSITION && Math.abs(z) <= MAX_RESUME_POSITION
    && Math.abs(yaw) <= MAX_RESUME_YAW && pitch >= CAMERA.minPitch && pitch <= CAMERA.maxPitch;
}

function parseSave(raw: string | null): SaveData | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSaveData(parsed) ? parsed : null;
  } catch { return null; }
}

function readStoredSave(s: Storage): SaveData | null {
  return parseSave(s.getItem(KEY));
}

function readStoredHistory(s: Storage): SaveData[] {
  const raw = s.getItem(HISTORY_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const records = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && parsed.v === SAVE_VERSION && Array.isArray(parsed.records) ? parsed.records : [];
  const unique: SaveData[] = [];
  const ids = new Set<string>();
  for (const record of records) appendFirstSnapshot(unique, ids, record);
  return unique;
}

function appendFirstSnapshot(records: SaveData[], ids: Set<string>, candidate: unknown): void {
  if (records.length >= MAX_HISTORY_IDS || !isSaveData(candidate)) return;
  const id = getSaveCheckpointId(candidate);
  if (ids.has(id)) return;
  ids.add(id);
  records.push(candidate);
}

export function readSave(): SaveData | null {
  const s = storage();
  if (!s) return null;
  try { return readStoredSave(s); } catch { return null; }
}

/** Archived first snapshots plus the current latest save, deduplicated by checkpoint ID. */
export function readSaveHistory(): SaveData[] {
  const s = storage();
  if (!s) return [];
  let records: SaveData[] = [];
  try { records = readStoredHistory(s); } catch { /* Keep the readable latest if history storage is unavailable. */ }
  const ids = new Set(records.map(getSaveCheckpointId));
  try { appendHistoryLatest(records, ids, readStoredSave(s)); } catch { /* History remains readable without the latest key. */ }
  return records;
}

function appendHistoryLatest(records: SaveData[], ids: Set<string>, candidate: SaveData | null): void {
  if (!candidate) return;
  const id = getSaveCheckpointId(candidate);
  if (!ids.has(id)) {
    ids.add(id);
    records.push(candidate);
  }
}

export function clearSave(): void {
  const s = storage();
  if (!s) return;
  for (const key of [KEY, HISTORY_KEY]) {
    try { s.removeItem(key); } catch { /* Continue clearing the other save key. */ }
  }
}

const LEVEL_NAME: Record<string, string> = {
  dungeon: '動力炉', floor1: '研究所 1階', floor2: '研究所 2階', surge: 'サージ収容所への道', camp1: 'サージ収容所 1階', camp2: 'サージ収容所 2階',
};
const START_NAME: Record<string, string> = { boss: 'ボス戦の前', drive: '車に乗ったところ', entrance: '入口', freed: '住民解放後' };
const ROOM_NAME: Partial<Record<'camp1' | 'floor1', Record<string, string>>> = {
  camp1: {
    A: 'A 入口ホール', B: 'B 倉庫', C: 'C 配電室', D: 'D 前室', E: 'E 円形ホール', F: 'F 資材室',
    G: 'G 監視室', H: 'H 大ホール', I: 'I 隠し部屋', J: 'J 隠し部屋', tunnel: '地下通路', duct: '隠しダクト',
  },
  floor1: {
    hall: '大広間', start: 'スタート通路', L1: '左上の部屋', L2: '左中央の部屋', L3: '左下の部屋',
    vestW: '連絡通路', side: '脇の細い部屋', RU: '右の部屋（上）', RL: '右の部屋（下）', dead: '行き止まり', alcove: 'エレベーター前',
  },
};
const CHECKPOINT_NAME: Record<string, string> = {
  'camp1:boss': '中ボス戦の前',
  'camp2:boss': 'ボス戦の前',
  'camp2:freed': '住民解放後',
  'floor2:start': '強化前',
  'floor2:rested': '強化後',
  'surge:garage': '車に乗る前',
};

function lookupLabel(labels: Record<string, string> | undefined, key: string | undefined): string | undefined {
  return labels && key !== undefined && Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : undefined;
}

/** タイトル画面に出す「どこから再開するか」 */
export function describeSave(d: SaveData): string {
  const where = lookupLabel(LEVEL_NAME, d.level) ?? d.level;
  const roomId = d.checkpointId?.startsWith(`${d.level}:room.`) ? d.checkpointId.slice(`${d.level}:room.`.length) : undefined;
  const rooms = d.level === 'camp1' ? ROOM_NAME.camp1 : d.level === 'floor1' ? ROOM_NAME.floor1 : undefined;
  const room = lookupLabel(rooms, roomId);
  const checkpoint = lookupLabel(CHECKPOINT_NAME, d.checkpointId) ?? room;
  const at = lookupLabel(START_NAME, d.startAt);
  const sub = checkpoint ?? (d.level === 'camp1' && d.startAt === 'boss' ? '中ボス戦の前' : at);
  return sub ? `${where}・${sub}` : where;
}
