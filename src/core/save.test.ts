import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSave, describeSave, readSave, writeSave, SAVE_VERSION, type SaveData } from './save';

const KEY = 'denki-cyborg-save-v1';

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

  it('fails safely when localStorage is missing or its getter throws', () => {
    delete (globalThis as any).localStorage;
    expect(writeSave(sample())).toBe(false);
    expect(readSave()).toBeNull();
    expect(() => clearSave()).not.toThrow();

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('storage blocked'); },
    });
    expect(writeSave(sample())).toBe(false);
    expect(readSave()).toBeNull();
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
    expect(() => clearSave()).not.toThrow();
  });
});
