import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../config/balance';
import { ROOM_DEFS, computeLayout, nextWaveAction, spawnPoints, DOOR_W, DOOR_H } from './layout';

const L = computeLayout();

describe('layout', () => {
  it('8 rooms, boss last', () => {
    expect(L.length).toBe(8);
    expect(L[7].def.boss).toBe(true);
  });
  it('rooms do not overlap (including walls)', () => {
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      const zOverlap = a.zMin - 1 < b.zMax + 1 && b.zMin - 1 < a.zMax + 1;
      expect(zOverlap).toBe(false);
    }
  });
  it('sizes are within spec', () => {
    for (const r of L) {
      expect(r.def.h).toBeGreaterThanOrEqual(8);
      expect(r.def.h).toBeLessThanOrEqual(16);
      expect(r.def.w).toBeLessThanOrEqual(44);
    }
  });
  it('doors sit on the room boundary and inside the wall opening', () => {
    L.forEach((r, i) => {
      if (i === L.length - 1) { expect(r.door).toBeNull(); return; }
      const d = r.door!;
      expect(d.zMax).toBe(r.zMin);
      expect(d.xMax - d.xMin).toBe(DOOR_W);
      expect(d.yMax).toBe(DOOR_H);
      expect(d.xMin).toBeGreaterThanOrEqual(r.xMin);
      expect(d.xMax).toBeLessThanOrEqual(r.xMax);
      expect(d.yMax).toBeLessThan(r.h);
    });
  });
  it('all wave enemy kinds are valid and spawn points are inside the room', () => {
    for (const r of L) {
      for (const w of r.def.waves) {
        for (const g of w) expect(Object.keys(ENEMIES)).toContain(g.kind);
        for (const p of spawnPoints(r, w)) {
          expect(p.x).toBeGreaterThan(r.xMin);
          expect(p.x).toBeLessThan(r.xMax);
          expect(p.z).toBeGreaterThan(r.zMin);
          expect(p.z).toBeLessThan(r.zMax);
          expect(p.y).toBeGreaterThan(0);
          expect(p.y).toBeLessThan(r.h);
        }
      }
    }
  });
  it('spec enemy counts', () => {
    const count = (i: number, kind: string) => ROOM_DEFS[i].waves.flat().filter((g) => g.kind === kind).reduce((a, g) => a + g.count, 0);
    expect(count(1, 'drone')).toBe(3);
    expect(count(2, 'crawler')).toBe(4);
    expect(count(3, 'gunner')).toBe(2);
    expect(count(5, 'heavy')).toBe(2);
    expect(count(7, 'boss')).toBe(1);
    expect(ROOM_DEFS[2].waves.length).toBe(2);
    expect(ROOM_DEFS[4].waves.length).toBe(2);
    expect(ROOM_DEFS[5].waves.length).toBe(2);
  });
  it('blocks and pads are inside rooms; platform is climbable (<=1.5m steps) and 4-6m high', () => {
    for (const r of L) {
      for (const b of r.def.blocks) {
        expect(Math.abs(b.lx) + b.sx / 2).toBeLessThanOrEqual(r.def.w / 2 + 1e-6);
        expect(Math.abs(b.lz) + b.sz / 2).toBeLessThanOrEqual(r.def.d / 2 + 1e-6);
      }
      for (const p of r.def.pads) {
        expect(Math.abs(p.lx)).toBeLessThan(r.def.w / 2);
        expect(Math.abs(p.lz)).toBeLessThan(r.def.d / 2);
      }
    }
    const plat = ROOM_DEFS[3].platform!;
    expect(plat.top).toBeGreaterThanOrEqual(4);
    expect(plat.top).toBeLessThanOrEqual(6);
    const steps = ROOM_DEFS[3].blocks.filter((b) => b.kind === 'step').map((b) => b.sy).sort((a, b) => a - b);
    let prev = 0;
    for (const s of [...steps, plat.top]) { expect(s - prev).toBeLessThanOrEqual(1.5); prev = s; }
  });
  it('boss room pads have half capacity', () => {
    expect(ROOM_DEFS[7].pads.length).toBe(3);
    expect(ROOM_DEFS[7].pads[0].capacity).toBeLessThan(80);
  });
});

describe('wave progression', () => {
  it('spawns first wave, waits while alive, spawns next, then clears', () => {
    expect(nextWaveAction(-1, 2, 0)).toBe('spawn');
    expect(nextWaveAction(0, 2, 3)).toBe('wait');
    expect(nextWaveAction(0, 2, 0)).toBe('spawn');
    expect(nextWaveAction(1, 2, 1)).toBe('wait');
    expect(nextWaveAction(1, 2, 0)).toBe('clear');
  });
  it('rooms without waves clear immediately', () => {
    expect(nextWaveAction(-1, 0, 0)).toBe('clear');
  });
});
