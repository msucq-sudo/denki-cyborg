// ルート2（ドレイン装置へ）の土台：クリア済みフラグの保存、2階の出口、サージのルート選択・見た目の差、チェックポイント。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { createWorld } from '../core/world';
import type { World } from '../core/types';
import { progress, resetProgress } from '../core/progress';
import { clearSave, describeSave, readSave, writeSave, SAVE_VERSION, type SaveData } from '../core/save';
import { activeCheckpointId, checkpointChoices } from '../core/checkpoints';
import { buildSurge, isWalkingOut, updateSurge } from './surge';
import { buildFloor2, updateFloor2 } from './floor2';
import { buildCamp2, updateCamp2 } from './camp2';
import { ENDING_TOTAL } from './camp2/ending';
import { ROAD } from './surge/layout';
import type { DriveRuntime } from '../vehicle/drive';

const DT = 1 / 30;

function fakeInput() {
  const keys = new Set<string>();
  return {
    locked: false, enabled: true, mouseDX: 0, mouseDY: 0, mousePressed: () => false, mouseReleased: () => false,
    pressed: (k: string) => keys.has(k), isDown: () => false, mouse: () => false,
    rawPressed: (k: string) => keys.has(k), rawDown: (k: string) => keys.has(k), lastDevice: 'kbm',
  };
}
function world(data: Record<string, unknown> = {}): World {
  const w = createWorld(fakeInput() as never, new EventBus(), 1);
  w.state = 'playing';
  Object.assign(w.level.data, data);
  return w;
}

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
}
const sample = (over: Partial<SaveData> = {}): SaveData => ({
  v: SAVE_VERSION, savedAt: 1, level: 'floor2',
  inventory: { gears: 3, metal: 8 }, upgrades: { body: 2 },
  functions: { scouter: true, autoAim: false, flight: true },
  unlocks: { autoAim: false, vacuum: true, shield: false },
  loadout: { owned: ['pistol'], current: 'pistol' }, selectedSkill: 'vacuum',
  ...over,
});

beforeEach(resetProgress);

describe('収容所 2階クリアのフラグ', () => {
  it('ボスを倒したあとの演出が終わると、永続フラグが立って 2階へ戻る', () => {
    const w = world({ startAt: 'ending' });
    buildCamp2(w);
    expect(progress.camp2Cleared).toBe(false);
    for (let i = 0; i < Math.round((ENDING_TOTAL + 5) / DT) && !w.level.data.nextLevel; i++) { w.time += DT; updateCamp2(w, DT); }
    expect(w.level.data.nextLevel).toEqual({ level: 'floor2' });
    expect(progress.camp2Cleared).toBe(true);
    expect(w.level.data.camp2Cleared).toBe(true);
    expect(w.level.data.saveDirty).toBe(true);
  });

  it('セーブに入る：書いて読み戻せる。型が違うセーブは受け付けない。無ければ未クリア', () => {
    (globalThis as any).localStorage = new MemStorage();
    try {
      expect(writeSave(sample({ camp2Cleared: true }))).toBe(true);
      expect(readSave()?.camp2Cleared).toBe(true);
      clearSave();
      writeSave(sample());
      expect(readSave()?.camp2Cleared).toBeUndefined();
      clearSave();
      (globalThis as any).localStorage.setItem('denki-cyborg-save-v1', JSON.stringify({ ...sample(), camp2Cleared: 'yes' }));
      expect(readSave()).toBeNull();
    } finally { delete (globalThis as any).localStorage; }
  });

  it('描写：車に乗ったところ（ドレイン装置への道）', () => {
    expect(describeSave(sample({ level: 'surge', startAt: 'drive', checkpointId: 'surge:drive2', camp2Cleared: true })))
      .toBe('サージ収容所への道・ドレイン装置への道・車に乗ったところ');
  });
});

describe('2階の西の出口', () => {
  it('収容所 2階クリア後に戻ったときは、ベッドで眠らなくても最初から使える。普段は使えない', () => {
    const a = world();
    buildFloor2(a);
    expect((a.level.data.floor2 as { exitUnlocked: boolean }).exitUnlocked).toBe(false);
    const b = world({ camp2Cleared: true });
    buildFloor2(b);
    const st = b.level.data.floor2 as { exitUnlocked: boolean; sleeps: number };
    expect(st.exitUnlocked).toBe(true);
    expect(st.sleeps).toBe(0);
    for (let i = 0; i < 30; i++) { b.time += DT; updateFloor2(b, DT); }
    expect((b.level.data.floor2 as { exitUnlocked: boolean }).exitUnlocked).toBe(true);
  });
});

describe('サージ：ルート選択と道の見た目', () => {
  it('既定は camp（東の柵あり）。camp2Cleared なら drain（西の封鎖。東の柵はない）で、plant のフックと 2周目用の車が付く', () => {
    const a = world();
    buildSurge(a);
    expect(a.level.data.surgeRoute).toBe('camp');
    expect(a.colliders.some((c) => c.tag === 'eastFence')).toBe(true);
    expect(a.colliders.some((c) => c.tag === 'westBlock')).toBe(false);
    expect(a.level.data.surge.route).toBe('camp');
    expect(a.level.data.surge.plant).toBeNull();
    expect((a.level.data.drive as DriveRuntime).route).toBe('camp');
    expect((a.level.data.drive as DriveRuntime).heavies.length).toBe(0);

    const b = world({ camp2Cleared: true });
    buildSurge(b);
    expect(b.level.data.surgeRoute).toBe('drain');
    expect(b.colliders.some((c) => c.tag === 'eastFence')).toBe(false);
    const west = b.colliders.find((c) => c.tag === 'westBlock')!;
    expect(west.min.x).toBeLessThan(ROAD.westBlockX);
    expect(west.max.x).toBeGreaterThan(ROAD.westBlockX);
    const plant = b.level.data.surge.plant;
    expect(plant.root.children.length).toBeGreaterThan(0);   // 発電所・坂・装置が入っている
    expect(plant.colliders.length).toBeGreaterThan(0);
    for (const k of ['door', 'doorBroken', 'sideWing', 'suckLegs', 'domes', 'ramp']) expect(plant.parts[k]).toBeTruthy();
    expect(plant.parts.suckLegs).toHaveLength(4);
    expect(() => plant.update(1.5)).not.toThrow();
    expect(b.scene.getObjectByName('surgeDrainPlant')).toBe(plant.root);
    const d = b.level.data.drive as DriveRuntime;
    expect(d.route).toBe('drain');
    expect(d.heavies.length).toBe(5);
    expect(d.obstacles.length).toBe(16);
  });

  it('URL の ?route=drain で強制でき、&start=drive でも動く。?route=camp で camp2Cleared でも 1本目', () => {
    (globalThis as any).location = { search: '?level=surge&route=drain&start=drive' };
    try {
      const w = world({ startAt: 'drive' });
      buildSurge(w);
      expect(w.level.data.surgeRoute).toBe('drain');
      expect(String(w.level.data.objective)).toContain('東へ');
      (globalThis as any).location = { search: '?level=surge&route=camp' };
      const w2 = world({ camp2Cleared: true });
      buildSurge(w2);
      expect(w2.level.data.surgeRoute).toBe('camp');
    } finally { delete (globalThis as any).location; }
  });

  it('車に乗った状態から始まるとルート2でも自動で乗る（start=drive）', () => {
    const w = world({ camp2Cleared: true, startAt: 'drive' });
    buildSurge(w);
    w.time += DT; updateSurge(w, DT);
    expect((w.level.data.drive as DriveRuntime).phase).toBe('driving');
    expect(w.level.data.retryAt).toBe('drive');
  });

  it('ルート2の成功では、ルート1の「車を降りて歩く」処理（収容所の入口へ）を始めない', () => {
    const w = world({ camp2Cleared: true, startAt: 'drive' });
    buildSurge(w);
    w.time += DT; updateSurge(w, DT);
    const d = w.level.data.drive as DriveRuntime;
    d.phase = 'done'; d.result = 'success';
    w.time += DT; updateSurge(w, DT);
    expect(isWalkingOut(w)).toBe(false);
  });
});

describe('チェックポイント', () => {
  it('ルート2で車に乗った所は surge:drive2、ルート1は surge:drive', () => {
    const a = world({ camp2Cleared: true, startAt: 'drive' });
    buildSurge(a);
    expect(activeCheckpointId(a, 'surge', 'drive')).toBe('surge:drive2');
    const b = world({ startAt: 'drive' });
    buildSurge(b);
    expect(activeCheckpointId(b, 'surge', 'drive')).toBe('surge:drive');
  });

  it('surge:drive2 は、収容所 2階クリアの記録があるときだけ選べる', () => {
    const base = sample({ level: 'surge', startAt: 'drive', checkpointId: 'surge:drive' });
    const before = checkpointChoices(base, [base]);
    expect(before.find((c) => c.id === 'surge:drive2')?.disabled).toBe(true);
    expect(before.find((c) => c.id === 'surge:drive')?.disabled).toBe(false);
    const cleared = sample({ level: 'floor2', camp2Cleared: true });
    const after = checkpointChoices(cleared, [base, cleared]);
    expect(after.find((c) => c.id === 'surge:drive2')?.disabled).toBe(false);
    expect(after.find((c) => c.id === 'surge:drive2')?.label).toContain('ドレイン装置');
  });
});
