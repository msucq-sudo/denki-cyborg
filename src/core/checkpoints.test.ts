import { describe, expect, it } from 'vitest';
import { EventBus } from './events';
import { createWorld } from './world';
import { activeCheckpointId, checkpointChoices, CHECKPOINT_TARGETS, prepareFloor1Checkpoint } from './checkpoints';
import { buildFloor1, getFloor1, getFloor1Memo } from '../level/floor1';
import type { SaveData } from './save';
import { PLAYER } from '../config/balance';

const save: SaveData = {
  v: 1, savedAt: 1, level: 'camp1', startAt: 'boss', inventory: { gears: 7, metal: 20 }, upgrades: { body: 2 },
  functions: { scouter: true, autoAim: false, flight: true }, unlocks: { autoAim: true, vacuum: true },
  loadout: { owned: ['pistol'], current: 'pistol' }, selectedSkill: 'vacuum',
};

describe('checkpoint choices', () => {
  it('lets an old single-slot save return to every earlier stage and camp room, without jumping to a later stage', () => {
    const choices = checkpointChoices(save, [save]);
    for (const id of ['floor2:start', 'surge:garage', 'surge:drive', 'camp1:entrance', 'camp1:room.J', 'camp1:room.duct']) {
      expect(choices.find(c => c.id === id)?.disabled, id).toBe(false);
    }
    expect(choices.find(c => c.id === 'camp2:start')?.disabled).toBe(true);
    expect(choices.find(c => c.id === 'camp1:boss')?.detail).toContain('記録あり');
    expect(choices.find(c => c.id === 'floor2:start')?.detail).toContain('過去の記録なし');
    expect(new Set(choices.map(c => c.id)).size).toBe(choices.length);
  });

  it('keeps archived later stages selectable after rewinding and does not mutate saved snapshots', () => {
    const archived = { ...save, level: 'camp2', startAt: 'boss', checkpointId: 'camp2:boss' };
    const json = JSON.stringify(archived);
    const choices = checkpointChoices({ ...save, level: 'floor2', startAt: undefined }, [archived]);
    expect(choices.find(c => c.id === 'camp2:boss')?.disabled).toBe(false);
    expect(choices.find(c => c.id === 'camp2:freed')?.disabled).toBe(true);
    expect(JSON.stringify(archived)).toBe(json);
  });

  it('records distinct before/after upgrade locations and individual rooms', () => {
    const w = createWorld({} as never, new EventBus(), 1);
    w.level.data.floor2 = { sleeps: 0 };
    expect(activeCheckpointId(w, 'floor2')).toBe('floor2:start');
    w.level.data.floor2 = { sleeps: 1 };
    expect(activeCheckpointId(w, 'floor2')).toBe('floor2:rested');
    w.level.currentRoom = 0;
    expect(activeCheckpointId(w, 'camp1')).toBe('camp1:room.A');
    w.level.currentRoom = 1;
    expect(activeCheckpointId(w, 'camp1')).not.toBe('camp1:room.A');
  });

  it('places old-save floor1 room replays outside colliders and hides gears without adding inventory', () => {
    const w = createWorld({} as never, new EventBus(), 1);
    buildFloor1(w);
    w.inventory.gears = 7;
    for (const target of CHECKPOINT_TARGETS.filter(t => t.level === 'floor1')) {
      prepareFloor1Checkpoint(w, target.room);
      const p = w.player.pos;
      const overlap = w.colliders.filter(c => c.active && p.x + PLAYER.radius > c.min.x + 0.01 && p.x - PLAYER.radius < c.max.x - 0.01
        && p.z + PLAYER.radius > c.min.z + 0.01 && p.z - PLAYER.radius < c.max.z - 0.01
        && p.y + PLAYER.height > c.min.y + 0.02 && p.y < c.max.y - 0.02);
      expect(overlap.map(c => c.tag), target.id).toEqual([]);
      expect(w.inventory.gears).toBe(7);
      expect((getFloor1Memo(w) as { gears: number[] }).gears.length).toBe(getFloor1(w)!.plan.gears.length);
    }
  });
});
