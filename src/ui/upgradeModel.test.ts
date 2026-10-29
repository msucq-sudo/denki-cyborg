import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { createWorld } from '../core/world';
import { ARM_TRACK, BODY_TRACK, SKILL_TRACKS, getLevel, maxLevel, preview } from '../progression/upgrades';
import {
  CATEGORIES, categoryTracks, createNav, currentCategory, focusedTrack, formatStat, moveCategory, moveRow,
  setCategory, setRow, statText, statTone, tryUpgrade,
} from './upgradeModel';

function mk() {
  const events = new EventBus();
  const world = createWorld({} as never, events, 16 / 9);
  return { world, events };
}

describe('強化画面の項目と行', () => {
  it('項目は上から GUN / BODY / ARM / SKILL', () => {
    expect(CATEGORIES.map((c) => c.en)).toEqual(['GUN', 'BODY', 'ARM', 'SKILL']);
    expect(CATEGORIES.map((c) => c.ja)).toEqual(['武器', '体', 'アーム', 'スキル']);
  });

  it('GUN は持っている武器（今はピストルだけ）、BODY/ARM は1行、SKILL はスキルごと', () => {
    const { world } = mk();
    expect(categoryTracks(world, 'gun').map((t) => t.id)).toEqual(['gun.pistol']);
    expect(categoryTracks(world, 'body')).toEqual([BODY_TRACK]);
    expect(categoryTracks(world, 'arm')).toEqual([ARM_TRACK]);
    expect(categoryTracks(world, 'skill')).toEqual(SKILL_TRACKS);
    expect(SKILL_TRACKS.length).toBeGreaterThan(1);
  });
});

describe('カーソル', () => {
  it('項目は端でぐるっと回り、行は端で止まる', () => {
    const { world } = mk();
    const nav = createNav();
    expect(currentCategory(nav).id).toBe('gun');
    expect(moveCategory(nav, -1)).toBe(true);
    expect(currentCategory(nav).id).toBe('skill');
    expect(moveCategory(nav, 1)).toBe(true);
    expect(currentCategory(nav).id).toBe('gun');
    expect(setCategory(nav, 3)).toBe(true);
    expect(setCategory(nav, 3)).toBe(false);
    expect(moveRow(nav, world, -1)).toBe(false);
    expect(focusedTrack(nav, world)?.id).toBe(SKILL_TRACKS[0].id);
    expect(moveRow(nav, world, 1)).toBe(true);
    expect(focusedTrack(nav, world)?.id).toBe(SKILL_TRACKS[1].id);
    for (let i = 0; i < 10; i++) moveRow(nav, world, 1);
    expect(focusedTrack(nav, world)?.id).toBe(SKILL_TRACKS[SKILL_TRACKS.length - 1].id);
    expect(moveRow(nav, world, 1)).toBe(false);
    expect(setRow(nav, world, 99)).toBe(false);
  });

  it('項目ごとに選んだ行を覚えている。1行だけの項目では行は動かない', () => {
    const { world } = mk();
    const nav = createNav();
    setCategory(nav, 3);
    moveRow(nav, world, 2);
    moveCategory(nav, -1); // ARM
    expect(moveRow(nav, world, 1)).toBe(false);
    expect(focusedTrack(nav, world)).toBe(ARM_TRACK);
    moveCategory(nav, 1);
    expect(focusedTrack(nav, world)?.id).toBe(SKILL_TRACKS[2].id);
  });
});

describe('強化の試行', () => {
  it('歯車が足りなければ poor（何も変わらない）、足りれば ok で歯車が減りレベルが上がる', () => {
    const { world, events } = mk();
    const got: unknown[] = [];
    events.on('upgrade', (p) => got.push(p));
    world.inventory.gears = 0;
    expect(tryUpgrade(world, BODY_TRACK)).toBe('poor');
    expect(getLevel(world, BODY_TRACK.id)).toBe(1);
    world.inventory.gears = 99;
    expect(tryUpgrade(world, BODY_TRACK)).toBe('ok');
    expect(getLevel(world, BODY_TRACK.id)).toBe(2);
    expect(world.inventory.gears).toBeLessThan(99);
    expect(got).toEqual([{ id: BODY_TRACK.id, level: 2 }]);
  });

  it('最大レベルでは max', () => {
    const { world } = mk();
    world.inventory.gears = 9999;
    for (let i = 0; i < maxLevel(ARM_TRACK) - 1; i++) expect(tryUpgrade(world, ARM_TRACK)).toBe('ok');
    const gears = world.inventory.gears;
    expect(tryUpgrade(world, ARM_TRACK)).toBe('max');
    expect(world.inventory.gears).toBe(gears);
    expect(preview(world, ARM_TRACK).every((p) => p.next === null)).toBe(true);
  });
});

describe('数値の表示', () => {
  const dmg = { key: 'd', label: 'ダメージ', values: [20, 23] };
  const cost = { key: 'c', label: '消費', digits: 1, unit: '/秒', lowerIsBetter: true, values: [4, 3.5] };
  it('桁数と単位', () => {
    expect(formatStat(dmg, 20)).toBe('20');
    expect(formatStat(cost, 3.5)).toBe('3.5/秒');
    expect(statText(dmg, 20, 23)).toBe('20 » 23');
    expect(statText(dmg, 23, null)).toBe('23 最大');
  });
  it('lowerIsBetter は小さくなると better、同じ値は same', () => {
    expect(statTone(dmg, 20, 23)).toBe('better');
    expect(statTone(dmg, 23, 20)).toBe('worse');
    expect(statTone(cost, 4, 3.5)).toBe('better');
    expect(statTone(cost, 3.5, 4)).toBe('worse');
    expect(statTone(dmg, 20, 20)).toBe('same');
    expect(statTone({ ...dmg, digits: 0 }, 20.2, 20.4)).toBe('same');
  });
});
