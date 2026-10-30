import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSave, describeSave, getSaveCheckpointId, readSave, readSaveHistory, writeSave, SAVE_VERSION, type SaveData } from './save';

const KEY = 'denki-cyborg-save-v1';
const HISTORY_KEY = 'denki-cyborg-save-history-v1';

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
}

const sample = (over: Partial<SaveData> = {}): SaveData => ({
  v: SAVE_VERSION, savedAt: 1, level: 'camp1', startAt: 'boss',
  inventory: { gears: 3, metal: 8 }, upgrades: { body: 2 },
  functions: { scouter: true, autoAim: false, flight: true },
  unlocks: { autoAim: false, vacuum: true },
  loadout: { owned: ['pistol', 'shotgun'], current: 'shotgun' },
  selectedSkill: 'vacuum', levelMemo: { gears: ['g1'], keys: ['B'] },
  ...over,
});

function storeRaw(value: unknown): void {
  (globalThis as any).localStorage.setItem(KEY, JSON.stringify(value));
}

function storeHistory(records: unknown, version = SAVE_VERSION): void {
  (globalThis as any).localStorage.setItem(HISTORY_KEY, JSON.stringify({ v: version, records }));
}

describe('save', () => {
  beforeEach(() => { (globalThis as any).localStorage = new MemStorage(); });
  afterEach(() => { delete (globalThis as any).localStorage; });

  it('writes and reads back the complete v1 save', () => {
    expect(readSave()).toBeNull();
    expect(writeSave(sample())).toBe(true);
    const d = readSave()!;
    expect(d).toEqual(sample());
    expect(d.level).toBe('camp1');
    expect(d.startAt).toBe('boss');
    expect(d.inventory).toEqual({ gears: 3, metal: 8 });
  });

  it('validates optional checkpoint IDs and resume locations', () => {
    const data = sample({
      level: 'floor2', startAt: undefined, checkpointId: 'floor2:bed-west',
      resume: { x: 12.5, y: 0, z: -20, yaw: 2.1, pitch: 0.4 },
    });
    storeRaw(data);
    expect(readSave()).toEqual(data);

    expect(getSaveCheckpointId(sample())).toBe('camp1:boss');
    expect(getSaveCheckpointId(sample({ level: 'floor1', startAt: undefined, floor1Revisit: true }))).toBe('floor1:revisit');
    expect(getSaveCheckpointId(sample({ level: 'floor2', startAt: undefined }))).toBe('floor2:start');
    expect(getSaveCheckpointId(data)).toBe('floor2:bed-west');
  });

  it('ignores invalid JSON, null, old versions, and saves missing required fields', () => {
    const storage = (globalThis as any).localStorage as MemStorage;
    storage.setItem(KEY, '{oops');
    expect(readSave()).toBeNull();

    for (const value of [null, [], { v: 0 }, { v: SAVE_VERSION, level: 'camp1' }]) {
      storeRaw(value);
      expect(readSave()).toBeNull();
    }

    // writeSave intentionally writes typed inputs as-is; version and shape validation belong to readSave.
    expect(writeSave(sample({ v: 0 }))).toBe(true);
    expect(readSave()).toBeNull();
    writeSave(sample());
    clearSave();
    expect(readSave()).toBeNull();
  });

  it.each([
    ['unknown level', { level: 'unknown' }],
    ['unknown checkpoint', { startAt: 'made-up' }],
    ['checkpoint from another level', { level: 'camp2', startAt: 'entrance' }],
    ['invalid revisit flag', { floor1Revisit: 'yes' }],
    ['revisit flag on another level', { floor1Revisit: true }],
    ['invalid timestamp', { savedAt: -1 }],
    ['empty checkpoint ID', { checkpointId: '' }],
    ['invalid checkpoint ID characters', { checkpointId: 'camp1/boss' }],
    ['checkpoint ID over 100 characters', { checkpointId: 'x'.repeat(101) }],
    ['null resume location', { resume: null }],
    ['resume missing an angle', { resume: { x: 0, y: 0, z: 0, yaw: 0 } }],
    ['resume coordinate out of bounds', { resume: { x: 10_001, y: 0, z: 0, yaw: 0, pitch: 0 } }],
    ['resume coordinate non-finite', { resume: { x: null, y: 0, z: 0, yaw: 0, pitch: 0 } }],
    ['resume yaw out of bounds', { resume: { x: 0, y: 0, z: 0, yaw: 1_000_001, pitch: 0 } }],
    ['resume pitch out of range', { resume: { x: 0, y: 0, z: 0, yaw: 0, pitch: 2 } }],
    ['missing inventory value', { inventory: { gears: 2 } }],
    ['negative inventory', { inventory: { gears: -1, metal: 0 } }],
    ['fractional inventory', { inventory: { gears: 1.5, metal: 0 } }],
    ['non-finite inventory', { inventory: { gears: null, metal: 0 } }],
    ['unknown upgrade', { upgrades: { unknown: 2 } }],
    ['invalid upgrade level', { upgrades: { body: 1.5 } }],
    ['upgrade above maximum', { upgrades: { body: 6 } }],
    ['missing function flag', { functions: { scouter: true, autoAim: false } }],
    ['non-boolean function flag', { functions: { scouter: true, autoAim: 0, flight: true } }],
    ['missing unlock flag', { unlocks: { vacuum: true } }],
    ['non-boolean unlock flag', { unlocks: { autoAim: false, vacuum: 'yes' } }],
    ['unknown weapon', { loadout: { owned: ['pistol', 'rifle'], current: 'pistol' } }],
    ['duplicate weapon', { loadout: { owned: ['pistol', 'pistol'], current: 'pistol' } }],
    ['unowned current weapon', { loadout: { owned: ['pistol'], current: 'shotgun' } }],
    ['missing loadout', { loadout: null }],
    ['unknown selected skill', { selectedSkill: 'hack' }],
  ] as Array<[string, Record<string, unknown>]>)('rejects %s', (_name, patch) => {
    storeRaw({ ...sample(), ...patch });
    expect(readSave()).toBeNull();
  });

  it('accepts valid checkpoints and leaves stage-specific memo validation to the level', () => {
    for (const valid of [
      sample({ level: 'surge', startAt: 'drive' }),
      sample({ level: 'camp2', startAt: 'freed' }),
      sample({ level: 'floor1', startAt: undefined, floor1Revisit: true }),
      sample({ level: 'floor2', startAt: undefined, levelMemo: { rested: true } }),
      sample({ level: 'floor2', startAt: undefined, checkpointId: 'floor2:rest', resume: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 } }),
      sample({ levelMemo: { arbitrary: ['level-owned'] } }),
    ]) {
      storeRaw(valid);
      expect(readSave()).toEqual(valid);
    }
  });

  it('describes where the save resumes', () => {
    expect(describeSave(sample())).toBe('サージ収容所 1階・中ボス戦の前');
    expect(describeSave(sample({ level: 'camp2', startAt: 'boss' }))).toBe('サージ収容所 2階・ボス戦の前');
    expect(describeSave(sample({ level: 'camp2', startAt: 'freed' }))).toBe('サージ収容所 2階・住民解放後');
    expect(describeSave(sample({ level: 'floor2', startAt: undefined }))).toBe('研究所 2階');
  });

  it.each([
    ['camp1', 'A', 'A 入口ホール', 'サージ収容所 1階'],
    ['camp1', 'B', 'B 倉庫', 'サージ収容所 1階'],
    ['camp1', 'C', 'C 配電室', 'サージ収容所 1階'],
    ['camp1', 'D', 'D 前室', 'サージ収容所 1階'],
    ['camp1', 'E', 'E 円形ホール', 'サージ収容所 1階'],
    ['camp1', 'F', 'F 資材室', 'サージ収容所 1階'],
    ['camp1', 'G', 'G 監視室', 'サージ収容所 1階'],
    ['camp1', 'H', 'H 大ホール', 'サージ収容所 1階'],
    ['camp1', 'I', 'I 隠し部屋', 'サージ収容所 1階'],
    ['camp1', 'J', 'J 隠し部屋', 'サージ収容所 1階'],
    ['camp1', 'tunnel', '地下通路', 'サージ収容所 1階'],
    ['camp1', 'duct', '隠しダクト', 'サージ収容所 1階'],
    ['floor1', 'hall', '大広間', '研究所 1階'],
    ['floor1', 'start', 'スタート通路', '研究所 1階'],
    ['floor1', 'L1', '左上の部屋', '研究所 1階'],
    ['floor1', 'L2', '左中央の部屋', '研究所 1階'],
    ['floor1', 'L3', '左下の部屋', '研究所 1階'],
    ['floor1', 'vestW', '連絡通路', '研究所 1階'],
    ['floor1', 'side', '脇の細い部屋', '研究所 1階'],
    ['floor1', 'RU', '右の部屋（上）', '研究所 1階'],
    ['floor1', 'RL', '右の部屋（下）', '研究所 1階'],
    ['floor1', 'dead', '行き止まり', '研究所 1階'],
    ['floor1', 'alcove', 'エレベーター前', '研究所 1階'],
  ] as Array<[string, string, string, string]>)('uses room label for %s room %s', (level, roomId, roomName, levelName) => {
    const startAt = level === 'camp1' ? 'entrance' : undefined;
    const data = sample({ level, startAt, checkpointId: `${level}:room.${roomId}` });
    expect(describeSave(data)).toBe(`${levelName}・${roomName}`);
  });

  it.each([
    ['camp1', 'camp1:boss', 'entrance', '中ボス戦の前', 'サージ収容所 1階'],
    ['camp2', 'camp2:boss', undefined, 'ボス戦の前', 'サージ収容所 2階'],
    ['camp2', 'camp2:freed', undefined, '住民解放後', 'サージ収容所 2階'],
    ['floor2', 'floor2:start', undefined, '強化前', '研究所 2階'],
    ['floor2', 'floor2:rested', undefined, '強化後', '研究所 2階'],
    ['surge', 'surge:garage', undefined, '車に乗る前', 'サージ収容所への道'],
  ] as Array<[string, string, string | undefined, string, string]>)('uses label for checkpoint %s', (level, checkpointId, startAt, label, levelName) => {
    expect(describeSave(sample({ level, checkpointId, startAt }))).toBe(`${levelName}・${label}`);
  });

  it('keeps the first snapshot for a checkpoint while updating the latest save', () => {
    const first = sample({ savedAt: 10, checkpointId: 'camp1:boss', inventory: { gears: 2, metal: 0 } });
    const updated = sample({ savedAt: 20, checkpointId: 'camp1:boss', inventory: { gears: 6, metal: 5 } });
    const next = sample({ level: 'floor1', startAt: undefined, floor1Revisit: true, savedAt: 30, checkpointId: 'floor1:revisit' });

    expect(writeSave(first)).toBe(true);
    expect(writeSave(updated)).toBe(true);
    expect(readSave()).toEqual(updated);
    expect(readSaveHistory()).toEqual([first]);

    expect(writeSave(next)).toBe(true);
    expect(readSaveHistory()).toEqual([first, next]);
  });

  it('archives a typed snapshot immediately even when optional position fields are undefined', () => {
    const first = sample({ level: 'floor2', startAt: undefined, checkpointId: 'floor2:start', resume: undefined });
    expect(writeSave(first)).toBe(true);
    const stored = JSON.parse((globalThis as any).localStorage.getItem(HISTORY_KEY));
    expect(stored.records).toHaveLength(1);
    expect(stored.records[0].checkpointId).toBe('floor2:start');
  });

  it('imports a legacy latest save before the first new checkpoint write', () => {
    const legacy = sample({ checkpointId: undefined, resume: undefined, savedAt: 4 });
    const newCheckpoint = sample({ checkpointId: 'camp2:boss', savedAt: 5, level: 'camp2' });
    storeRaw(legacy);
    expect(readSaveHistory()).toEqual([legacy]);

    expect(writeSave(newCheckpoint)).toBe(true);
    expect(readSaveHistory()).toEqual([legacy, newCheckpoint]);
  });

  it('skips invalid and duplicate history records but merges a unique latest save', () => {
    const first = sample({ checkpointId: 'camp1:entry', savedAt: 10 });
    const duplicate = sample({ checkpointId: 'camp1:entry', savedAt: 11 });
    const invalid = { ...sample(), checkpointId: 'bad/id' };
    const latest = sample({ checkpointId: 'camp2:freed', level: 'camp2', startAt: 'freed', savedAt: 12 });
    storeHistory([first, invalid, null, duplicate]);
    storeRaw(latest);

    expect(readSaveHistory()).toEqual([first, latest]);

    // Also accept a raw v1 record array for an early history-key rollout.
    (globalThis as any).localStorage.setItem(HISTORY_KEY, JSON.stringify([first]));
    expect(readSaveHistory()).toEqual([first, latest]);
  });

  it('caps archived checkpoint IDs at 128 while still saving and returning a new latest', () => {
    const records = Array.from({ length: 128 }, (_, i) => sample({ checkpointId: `cp:${i}`, savedAt: i }));
    storeHistory(records);
    storeRaw(records[127]);
    const overflow = sample({ checkpointId: 'cp:overflow', savedAt: 200 });

    expect(writeSave(overflow)).toBe(true);
    expect(readSave()).toEqual(overflow);
    const stored = JSON.parse((globalThis as any).localStorage.getItem(HISTORY_KEY));
    expect(stored.records).toHaveLength(128);
    expect(readSaveHistory()).toHaveLength(129); // 128 archived IDs plus the unsnapshotted latest.
    expect(readSaveHistory().at(-1)).toEqual(overflow);
  });

  it('writes the archive before the latest so archive failure preserves the previous save', () => {
    const storage = new MemStorage();
    (globalThis as any).localStorage = storage;
    const previous = sample({ checkpointId: 'old:checkpoint', savedAt: 1 });
    expect(writeSave(previous)).toBe(true);

    (globalThis as any).localStorage = {
      getItem: (key: string) => storage.getItem(key),
      setItem(key: string, value: string) {
        if (key === HISTORY_KEY) throw new Error('archive blocked');
        storage.setItem(key, value);
      },
      removeItem: (key: string) => storage.removeItem(key),
    };
    expect(writeSave(sample({ checkpointId: 'new:checkpoint', savedAt: 2 }))).toBe(false);
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual(previous);
  });

  it('clears both the latest save and its history', () => {
    expect(writeSave(sample({ checkpointId: 'camp1:entry' }))).toBe(true);
    expect((globalThis as any).localStorage.getItem(HISTORY_KEY)).not.toBeNull();
    clearSave();
    expect(readSave()).toBeNull();
    expect(readSaveHistory()).toEqual([]);
    expect((globalThis as any).localStorage.getItem(HISTORY_KEY)).toBeNull();
  });

  it('fails safely when localStorage is missing or its getter throws', () => {
    delete (globalThis as any).localStorage;
    expect(writeSave(sample())).toBe(false);
    expect(readSave()).toBeNull();
    expect(readSaveHistory()).toEqual([]);
    expect(() => clearSave()).not.toThrow();

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('storage blocked'); },
    });
    expect(writeSave(sample())).toBe(false);
    expect(readSave()).toBeNull();
    expect(readSaveHistory()).toEqual([]);
    expect(() => clearSave()).not.toThrow();
  });

  it('fails safely when storage methods throw', () => {
    (globalThis as any).localStorage = {
      getItem() { throw new Error('read blocked'); },
      setItem() { throw new Error('write blocked'); },
      removeItem() { throw new Error('remove blocked'); },
    };
    expect(writeSave(sample())).toBe(false);
    expect(readSave()).toBeNull();
    expect(readSaveHistory()).toEqual([]);
    expect(() => clearSave()).not.toThrow();
  });
});
