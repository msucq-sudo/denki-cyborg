// ルート2（ドレイン装置へ。収容所 2階クリア後の2本目の道）のテスト：ルート選択・右折して東へ・判定の3段階・ヘビーの受け止め・配置の公平さ。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import { createWorld } from '../core/world';
import type { World } from '../core/types';
import { CHECKPOINT_E, chooseSurgeRoute, DOMES, DRAIN_DOOR, PLANT, RAMP, ROAD, SUCK_LEGS } from '../level/surge/layout';
import { KMH } from './types';

const cut = vi.hoisted(() => ({ calls: [] as Array<{ kind: string; args: unknown[] }>, onDone: [] as Array<() => void> }));
vi.mock('../cinematic/api', () => {
  const mk = (kind: string) => (...a: unknown[]) => {
    cut.calls.push({ kind, args: a });
    cut.onDone.push(a[2] as () => void);
    return { update() {}, done: false, skip() {} };
  };
  return {
    playSuccessCutscene: mk('success'), playFailCutscene: mk('fail'),
    playDrainSuccessCutscene: mk('drainSuccess'), playDrainFailCutscene: mk('drainFail'), playDrainStallCutscene: mk('drainStall'),
  };
});

import { initDrive, startDrive, updateDrive, type DriveRuntime } from './drive';
import { checkpointOf, classifyCheckpoint, createSim, DRIVE, kmhOf, stepSim, TURN_Z, type SimEvent } from './driveSim';
import { HEAVY_R, OBSTACLE_WIDTH, planDrainHazards, planHeavies, planObstacles, planZako } from './driveProps';

function fakeInput() {
  const down = new Set<string>();
  const pressed = new Set<string>();
  return {
    locked: false, lastDevice: 'kbm' as const, enabled: true,
    rawDown: (k: string) => down.has(k), rawPressed: (k: string) => pressed.has(k),
    isDown: () => false, pressed: () => false,
    hold: (k: string) => down.add(k), release: (k: string) => down.delete(k), endFrame: () => pressed.clear(),
  };
}

let world: World;
let input: ReturnType<typeof fakeInput>;
let drive: DriveRuntime;
const JZ = ROAD.junctionZ;

function setup(): void {
  input = fakeInput();
  world = createWorld(input as never, new EventBus(), 16 / 9);
  world.state = 'playing';
  drive = initDrive(world, { x: 0, z: 2, yaw: 0 }, 'drain') as DriveRuntime;
  cut.calls.length = 0; cut.onDone.length = 0;
}
function run(n: number, dt = 1 / 60): void {
  for (let i = 0; i < n; i++) { world.time += dt; updateDrive(world, dt); input.endFrame(); }
}
/** 東向きの直線の途中へ置く（T字路は曲がった扱い） */
function placeEast(x: number, z = JZ, kmh = 0): void {
  drive.mode = 'eastRun'; drive.junctionDone = true; drive.yaw = -Math.PI / 2;
  drive.pos.set(x, 0, z);
  drive.speed = kmh * KMH;
}
beforeEach(setup);

describe('ルート選択', () => {
  it('収容所 2階クリア済みなら drain、まだなら camp', () => {
    expect(chooseSurgeRoute(false)).toBe('camp');
    expect(chooseSurgeRoute(true)).toBe('drain');
  });
  it('URL の route= があればそれが優先（強制）。変な値は無視', () => {
    expect(chooseSurgeRoute(false, 'drain')).toBe('drain');
    expect(chooseSurgeRoute(true, 'camp')).toBe('camp');
    expect(chooseSurgeRoute(true, 'xxx')).toBe('drain');
    expect(chooseSurgeRoute(false, null)).toBe('camp');
  });
  it('ルート2の initDrive は drive.route=drain、ルート1は既定で camp', () => {
    expect(drive.route).toBe('drain');
    const w2 = createWorld(fakeInput() as never, new EventBus(), 1);
    expect((initDrive(w2, { x: 0, z: 2, yaw: 0 }) as DriveRuntime).route).toBe('camp');
  });
});

describe('配置（layout）', () => {
  it('判定地点Eは約1400m、300km/h・失速200km/h。坂は判定地点の120m先から約13°で上へ', () => {
    expect(CHECKPOINT_E).toEqual({ x: 1400, kmh: 300, stallKmh: 200 });
    expect(RAMP.footX - CHECKPOINT_E.x).toBe(120);
    expect(RAMP.topX - RAMP.footX).toBe(RAMP.length);
    expect(RAMP.yAt(RAMP.footX)).toBe(0);
    expect(RAMP.yAt(RAMP.topX)).toBe(RAMP.topY);
    const deg = Math.atan2(RAMP.topY, RAMP.length) * 180 / Math.PI;
    expect(deg).toBeGreaterThan(12); expect(deg).toBeLessThan(14);
    expect(DRAIN_DOOR.w).toBe(10); expect(DRAIN_DOOR.h).toBe(7); expect(DRAIN_DOOR.y).toBe(RAMP.topY);
  });
  it('坂が建物に差しかかる所は屋根より上。ドームと吸い込み脚が1対1で、頂点近くを貫く', () => {
    expect(RAMP.yAt(PLANT.x0)).toBeGreaterThan(PLANT.roofY);
    expect(SUCK_LEGS.length).toBe(DOMES.length);
    SUCK_LEGS.forEach((l, i) => {
      expect(l.pierce.y).toBeLessThan(DOMES[i].topY);
      expect(l.pierce.y).toBeGreaterThan(DOMES[i].baseY + DOMES[i].r * 0.8);
    });
  });
});

describe('走行（右折して東へ）', () => {
  /** 舵：T字路の手前で steer を倒す。速度は一定に保つ */
  function drive2(dir: -1 | 1 | 0, maxFrames = 60 * 90): { s: ReturnType<typeof createSim>; ev: SimEvent[] } {
    const s = createSim(0, 2, 0, 'drain');
    const ev: SimEvent[] = [];
    for (let i = 0; i < maxFrames; i++) {
      if (s.mode === 'north' || s.mode === 'turn' || s.mode === 'bounce' || s.mode === 'recover' || s.mode === 'westBlock') {
        if (s.mode !== 'bounce') s.speed = Math.max(s.speed, s.mode === 'north' ? 20 : 0);
      } else s.speed = 85;   // 本線では 306km/h
      const steer = s.mode === 'north' && s.pos.z < TURN_Z + 25 ? dir : 0;
      ev.push(...stepSim(s, { steer, press: false }, 1 / 60));
      if (s.checkpointDone) break;
    }
    return { s, ev };
  }

  it('右に曲がると東向きの本線に入り、判定地点Eを越える（x が大きいほど進んだ）', () => {
    const { s, ev } = drive2(1);
    expect(ev.some((e) => e.type === 'turnStart' && e.dir === 1)).toBe(true);
    expect(ev.some((e) => e.type === 'junctionDone')).toBe(true);
    expect(s.mode).toBe('eastRun');
    expect(s.yaw).toBeCloseTo(-Math.PI / 2);
    expect(s.pos.z).toBeCloseTo(JZ, 0);
    expect(s.pos.x).toBeGreaterThan(CHECKPOINT_E.x);
    const cp = ev.filter((e) => e.type === 'checkpoint');
    expect(cp.length).toBe(1);
    expect((cp[0] as { kmh: number }).kmh).toBeGreaterThan(300);
  });

  it('左に曲がると西の封鎖で跳ね返り、立て直して右へ旋回して東向きの本線に入る', () => {
    const { s, ev } = drive2(-1);
    const b = ev.filter((e) => e.type === 'bounce');
    expect(b.length).toBeGreaterThan(0);
    expect((b[0] as { where: string }).where).toBe('west');
    expect(ev.some((e) => e.type === 'junctionDone')).toBe(true);
    expect(s.mode).toBe('eastRun');
    expect(s.pos.x).toBeGreaterThan(CHECKPOINT_E.x);
  });

  it('舵を切らずに進むと北の壁で跳ね返り、立て直して東向きになる', () => {
    const { s, ev } = drive2(0);
    expect((ev.find((e) => e.type === 'bounce') as { where: string }).where).toBe('north');
    expect(s.mode).toBe('eastRun');
  });

  it('本線では右に切ると z が増える（東向きの右手は南）。切り続けて道の外へ出るとスリップして建物に激突する', () => {
    const s = createSim(100, JZ, -Math.PI / 2, 'drain');
    s.mode = 'eastRun'; s.junctionDone = true; s.speed = 30;
    const z0 = s.pos.z;
    for (let i = 0; i < 20; i++) stepSim(s, { steer: 1, press: false }, 1 / 60);
    expect(s.pos.z).toBeGreaterThan(z0);
    expect(s.mode).toBe('eastRun');   // まだ道の中
    const evs: string[] = [];
    for (let i = 0; i < 300 && !evs.includes('offRoadCrash'); i++) for (const e of stepSim(s, { steer: 1, press: false }, 1 / 60)) evs.push(e.type);
    expect(evs).toContain('offRoad');
    expect(evs).toContain('offRoadCrash');
    expect(s.mode).toBe('slip');
    expect(s.pos.z).toBeGreaterThan(JZ + ROAD.width / 2);   // 道の南の外まで流された
  });

  it('曲がり終えるまでは 90km/h で頭打ち、本線に入ったら上限が外れる', () => {
    const s = createSim(0, 2, 0, 'drain');
    s.pendingKmh = 200; stepSim(s, { steer: 0, press: false }, 1 / 60);
    for (let i = 0; i < 20; i++) stepSim(s, { steer: 0, press: false }, 1 / 60);
    expect(kmhOf(s)).toBeLessThanOrEqual(DRIVE.preTurnCapKmh + 0.01);
    const e = createSim(100, JZ, -Math.PI / 2, 'drain');
    e.mode = 'eastRun'; e.speed = 20; e.pendingKmh = 200;
    for (let i = 0; i < 60; i++) stepSim(e, { steer: 0, press: false }, 1 / 60);
    expect(kmhOf(e)).toBeGreaterThan(DRIVE.preTurnCapKmh);
  });

  it('判定地点は route ごと：ルート1は CHECKPOINT、ルート2は CHECKPOINT_E', () => {
    expect(checkpointOf('camp').x).toBeLessThan(0);
    expect(checkpointOf('drain')).toBe(CHECKPOINT_E);
  });
});

describe('判定地点Eの結果（成功／失敗／失速）', () => {
  it('classifyCheckpoint：300以上＝成功、200〜299＝失敗、200未満＝失速。ルート1は成功／失敗のみ', () => {
    expect(classifyCheckpoint('drain', 300)).toBe('success');
    expect(classifyCheckpoint('drain', 299.9)).toBe('fail');
    expect(classifyCheckpoint('drain', 200)).toBe('fail');
    expect(classifyCheckpoint('drain', 199.9)).toBe('stall');
    expect(classifyCheckpoint('drain', 0)).toBe('stall');
    expect(classifyCheckpoint('camp', 300)).toBe('success');
    expect(classifyCheckpoint('camp', 120)).toBe('fail');
  });

  function pass(kmh: number, before = 8): void {
    startDrive(world);
    placeEast(CHECKPOINT_E.x - before, JZ, kmh);
    drive.checkpointDone = false;
    run(30);
  }

  it('330km/h：成功の演出。終わると level drain（startAt entrance）へ', () => {
    pass(330);
    expect(drive.result).toBe('success');
    expect(drive.phase).toBe('cutscene');
    expect(cut.calls.map((c) => c.kind)).toEqual(['drainSuccess']);
    expect(cut.calls[0].args[1]).toBe(drive);
    cut.onDone[0]();
    expect(drive.phase).toBe('done');
    expect(world.level.data.nextLevel).toEqual({ level: 'drain', startAt: 'entrance' });
    expect(world.player.hp).toBeGreaterThan(0);
  });

  it('250km/h：失敗の演出。終わると HP 0（死亡画面）', () => {
    pass(250);
    expect(drive.result).toBe('fail');
    expect(cut.calls.map((c) => c.kind)).toEqual(['drainFail']);
    cut.onDone[0]();
    expect(world.player.hp).toBe(0);
    expect(world.level.data.nextLevel).toBeUndefined();
  });

  it('150km/h：失速の演出。終わると HP 0', () => {
    pass(150);
    expect(drive.result).toBe('stall');
    expect(cut.calls.map((c) => c.kind)).toEqual(['drainStall']);
    cut.onDone[0]();
    expect(world.player.hp).toBe(0);
  });

  it('境目：300km/h ぎりぎり成功・199km/h は失速', () => {
    pass(300.6, 0.5);
    expect(drive.result).toBe('success');
    setup(); pass(199, 0.5);
    expect(drive.result).toBe('stall');
  });
});

describe('障害物・雑魚・ヘビーの配置（ルート2）', () => {
  const { obstacles, heavies } = planDrainHazards();

  it('障害物 16、ヘビー 5、雑魚の群れ 28。ルート1の配置は変わらない', () => {
    expect(obstacles.length).toBe(16);
    expect(heavies.length).toBe(5);
    expect(planObstacles('drain')).toEqual(obstacles);
    expect(planHeavies('drain')).toEqual(heavies);
    expect(planHeavies('camp')).toEqual([]);
    expect(planObstacles().length).toBe(10);
    const ob1 = planObstacles();
    expect(planZako(ob1)).toEqual(planZako(ob1, 19, 'camp', []));
    expect(planZako(ob1).length).toBeGreaterThan(40);
  });

  it('東の直線（交差点〜判定地点E）の中にあり、障害物は道幅の1/3、間隔は十分', () => {
    for (const o of obstacles) {
      expect(o.x).toBeGreaterThan(100); expect(o.x).toBeLessThan(CHECKPOINT_E.x - 50);
      expect(o.w).toBeCloseTo(OBSTACLE_WIDTH);
      expect(Math.abs(o.z - JZ) + o.w / 2).toBeLessThanOrEqual(ROAD.width / 2);
    }
    const xs = [...obstacles.map((o) => o.x), ...heavies.map((h) => h.x)].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(55);
  });

  it('雑魚はヘビーと障害物の上には置かない', () => {
    const zako = planZako(obstacles, undefined, 'drain', heavies);
    expect(zako.length).toBeGreaterThan(28 * 2 - 1);
    for (const z of zako) {
      expect(z.x).toBeGreaterThan(40); expect(z.x).toBeLessThan(CHECKPOINT_E.x + 10);
      for (const h of heavies) expect(Math.abs(h.x - z.x) < 9 && Math.abs(h.z - z.z) < HEAVY_R + 2.2).toBe(false);
    }
  });

  it('必ず避けて通れる道がある（横速度の制限つきで、全部の危険物を順にかわせる）', () => {
    const STEP = 0.1;
    const n = Math.round((DRIVE.latMax * 2) / STEP) + 1;
    const zAt = (i: number) => -DRIVE.latMax + i * STEP;
    type H = { x: number; lo: number; hi: number };
    const hz: H[] = [
      ...obstacles.map((o) => ({ x: o.x, lo: o.z - JZ - (o.w / 2 + DRIVE.halfWid - 0.1), hi: o.z - JZ + (o.w / 2 + DRIVE.halfWid - 0.1) })),
      ...heavies.map((h) => ({ x: h.x, lo: h.z - JZ - (DRIVE.halfWid + HEAVY_R - 0.25), hi: h.z - JZ + (DRIVE.halfWid + HEAVY_R - 0.25) })),
    ].sort((a, b) => a.x - b.x);
    let ok = new Array<boolean>(n).fill(true);
    let prevX = hz[0].x - 100;
    const V = 340 * KMH;
    for (const h of hz) {
      // 移動できる距離：最大横速度 × 時間（横速度の立ち上がりの遅れぶん 1.5m 引く）
      const reach = Math.max(0, DRIVE.latSpeed * ((h.x - prevX) / V) - 1.5);
      const k = Math.floor(reach / STEP);
      const next = new Array<boolean>(n).fill(false);
      for (let i = 0; i < n; i++) {
        if (zAt(i) > h.lo && zAt(i) < h.hi) continue;
        for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) if (ok[j]) { next[i] = true; break; }
      }
      ok = next;
      expect(ok.some(Boolean), `x=${h.x} で通れる道がなくなった`).toBe(true);
      prevX = h.x;
    }
  });
});

describe('ヘビー（はね飛ばせない）', () => {
  it('雑魚は飛ばされるが、ヘビーにぶつかると受け止められて止まり、HP 0 になる', () => {
    startDrive(world);
    const h = drive.heavies[0];
    const hz = h.actor.pos.z;
    placeEast(h.actor.pos.x - 30, hz, 250);
    run(90);
    expect(drive.phase).toBe('crashed');
    expect(h.state).toBe('caught');
    expect(drive.caught?.heavy).toBe(h);
    expect(drive.speed).toBe(0);
    // ヘビーは飛ばされず、少し押し戻されるだけ（立っていた場所の近く）
    expect(h.actor.pos.x).toBeGreaterThan(h.baseX);
    expect(h.actor.pos.x - h.baseX).toBeLessThan(4);
    expect(h.actor.root.visible).toBe(true);
    // 車はヘビーの手前で止まる
    expect(drive.pos.x).toBeLessThan(h.actor.pos.x);
    run(120);
    expect(world.player.hp).toBe(0);
  });

  it('ヘビーの横を通れば当たらない', () => {
    startDrive(world);
    const h = drive.heavies[0];
    placeEast(h.actor.pos.x - 30, h.actor.pos.z + (h.actor.pos.z > JZ ? -6 : 6), 250);
    // 障害物の間の安全な位置なので、そのまま通過できる（障害物にも当たらない位置を選ぶ）
    drive.obstacles.forEach((o) => { o.hit = true; });
    run(60);
    expect(h.state).toBe('idle');
    expect(drive.phase).toBe('driving');
  });

  it('障害物に当たったときの弾かれる向きは走る向き（東）', () => {
    startDrive(world);
    const o = drive.obstacles[0];
    const x0 = o.root.position.x;
    placeEast(o.def.x - 10, o.def.z, 200);
    run(40);
    expect(drive.phase).toBe('crashed');
    expect(o.root.position.x).toBeGreaterThan(x0);
  });
});
