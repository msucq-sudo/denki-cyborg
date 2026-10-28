import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/events';
import type { World } from '../core/types';
import { createWorld } from '../core/world';
import { moveCharacter } from '../core/collision';
import { PLAYER } from '../config/balance';
import { buildFloor2, floor2Hooks, getFloor2, SLEEP, updateFloor2 } from './floor2';
import { generateFloor2, R } from './floor2/plan';

const plan = generateFloor2();
/** 北から時計回りの角度（°） */
const deg = (x: number, z: number) => ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;
const angDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

describe('floor2 plan', () => {
  it('is a circular room with the elevator south and a bed at the centre', () => {
    expect(plan.bed.x).toBe(0);
    expect(plan.bed.z).toBe(0);
    expect(plan.objects.find((o) => o.kind === 'bed')).toMatchObject({ x: 0, z: 0 });
    expect(plan.rooms[0].x1 - plan.rooms[0].x0).toBe(R * 2);
    expect(R).toBeLessThan(15); // 小さめの部屋
    const e = plan.elevator;
    expect(deg((e.x0 + e.x1) / 2, (e.z0 + e.z1) / 2)).toBeCloseTo(180, 0);
    expect(plan.start.z).toBeGreaterThan(R); // かごの中から始まる
  });

  it('has two exits, each offset 35 degrees either side of the point opposite the elevator', () => {
    expect(plan.exits.length).toBe(2);
    const elev = plan.gaps.find((g) => g.kind === 'elevator')!.c;
    const opposite = (elev + 180) % 360;
    const offs = plan.exits.map((x) => (((deg(x.x, x.z) - opposite) + 540) % 360) - 180).sort((a, b) => a - b);
    expect(offs[0]).toBeCloseTo(-35, 1);
    expect(offs[1]).toBeCloseTo(35, 1);
    for (const x of plan.exits) {
      expect(Math.hypot(x.x, x.z)).toBeCloseTo(R, 5);
      expect(x.sealed).toBe(true);
      expect(Math.hypot(x.dirX, x.dirZ)).toBeCloseTo(1, 5);
    }
  });

  it('has machines around the bed and computers around the wall', () => {
    const machines = plan.objects.filter((o) => o.cat === 'machine');
    const computers = plan.objects.filter((o) => o.cat === 'computer');
    expect(machines.length).toBeGreaterThanOrEqual(15);
    expect(computers.length).toBeGreaterThanOrEqual(16);
    expect(machines.some((o) => o.kind === 'arm')).toBe(true);
    expect(machines.some((o) => o.kind === 'scanner')).toBe(true);
    for (const c of computers) {
      const r = Math.hypot(c.x, c.z);
      expect(r).toBeGreaterThan(R - 1.5);
      expect(r).toBeLessThan(R);
    }
    // 出入口の前の壁際には置かない
    for (const o of plan.objects.filter((q) => q.cat === 'computer')) {
      for (const g of plan.gaps) expect(angDiff(deg(o.x, o.z), g.c)).toBeGreaterThan(g.half);
    }
  });

  /** 衝突つきで歩いて、目的地までの残り距離を返す */
  function walker() {
    const w = createWorld({ pressed: () => false, isDown: () => false } as never, new EventBus(), 1);
    buildFloor2(w);
    return (x0: number, z0: number, x1: number, z1: number): number => {
      const pos = new THREE.Vector3(x0, 0, z0), vel = new THREE.Vector3();
      for (let i = 0; i < 1200 && Math.hypot(pos.x - x1, pos.z - z1) > 0.5; i++) {
        const d = Math.hypot(x1 - pos.x, z1 - pos.z);
        vel.set(((x1 - pos.x) / d) * 6, -2, ((z1 - pos.z) / d) * 6);
        moveCharacter(w.colliders, pos, vel, 1 / 60, PLAYER.radius, PLAYER.height);
      }
      return Math.hypot(pos.x - x1, pos.z - z1);
    };
  }

  it('keeps the lanes from the elevator to the bed, and from the bed to each exit, walkable', () => {
    const walk = walker();
    expect(walk(0, R - 2.5, plan.bed.standX, plan.bed.standZ)).toBeLessThan(0.6);
    for (const x of plan.exits) {
      expect(walk(0, R - 2.5, x.x - x.dirX * 1.0, x.z - x.dirZ * 1.0)).toBeLessThan(0.6);
      expect(walk(plan.bed.standX, plan.bed.standZ, x.x + x.dirX * 3, x.z + x.dirZ * 3)).toBeLessThan(0.6);
    }
  });

  it('walls the room in: no leaving through the circular wall, and the sealed exit doors hold', () => {
    const w = createWorld({ pressed: () => false, isDown: () => false } as never, new EventBus(), 1);
    buildFloor2(w);
    for (let a = 0; a < 360; a += 15) {
      if (plan.gaps.some((g) => angDiff(a, g.c) < g.half + 4)) continue;
      const pos = new THREE.Vector3(0.01, 0, 0.01), vel = new THREE.Vector3();
      const dx = Math.sin((a * Math.PI) / 180), dz = -Math.cos((a * Math.PI) / 180);
      for (let i = 0; i < 400; i++) {
        vel.set(dx * 8, -2, dz * 8);
        moveCharacter(w.colliders, pos, vel, 1 / 60, PLAYER.radius, PLAYER.height);
      }
      expect(Math.hypot(pos.x, pos.z), `angle ${a}`).toBeLessThan(R + 0.1);
    }
    for (const x of plan.exits) {
      const pos = new THREE.Vector3(x.x, 0, x.z), vel = new THREE.Vector3();
      for (let i = 0; i < 300; i++) {
        vel.set(x.dirX * 8, -2, x.dirZ * 8);
        moveCharacter(w.colliders, pos, vel, 1 / 60, PLAYER.radius, PLAYER.height);
      }
      expect(Math.hypot(pos.x - x.x, pos.z - x.z)).toBeLessThan(x.depth); // 封鎖ドアの手前で止まる
    }
  });
});

describe('floor2 runtime', () => {
  const DT = 1 / 30;
  const step = (w: World, n: number) => { for (let i = 0; i < n; i++) { w.time += DT; updateFloor2(w, DT); } };
  const run = (w: World, sec: number) => step(w, Math.round(sec / DT));
  const events = (w: World, name: keyof import('../core/events').GameEvents) => { const l: unknown[] = []; w.events.on(name, ((p: unknown) => l.push(p)) as never); return l; };
  function mk() {
    const keys = new Set<string>();
    const input = { locked: false, pressed: (k: string) => !input.locked && keys.has(k), isDown: () => false, rawPressed: (k: string) => keys.has(k) };
    const w = createWorld(input as never, new EventBus(), 1);
    w.state = 'playing';
    buildFloor2(w);
    const press = (k: string) => { keys.add(k); step(w, 1); keys.delete(k); };
    return { w, input, press, f: getFloor2(w)! };
  }

  it('starts in the elevator car; interact only works near the bed', () => {
    const { w, press, f } = mk();
    run(w, 0.2);
    expect(w.player.pos.z).toBeGreaterThan(R);
    expect(f.state.nearBed).toBe(false);
    press('PadB');
    expect(f.state.phase).toBe('free');
    w.player.pos.set(0, 0, 8);
    run(w, 0.2);
    expect(f.state.nearBed).toBe(false);
    expect(w.level.data.interactNear).toBe(false);
    w.player.pos.set(0, 0, 2.4);
    run(w, 0.2);
    expect(f.state.nearBed).toBe(true);
    expect(w.level.data.interactNear).toBe(true);
  });

  for (const key of ['PadB', 'KeyR']) {
    it(`${key} near the bed: walk, lie down, sleep, hook fires, input locked until wake`, () => {
      const { w, input, press, f } = mk();
      const hook = floor2Hooks.onSleepComplete;
      let hooked = 0;
      floor2Hooks.onSleepComplete = () => { hooked++; };
      try {
        const started = events(w, 'sleepStart'), done = events(w, 'sleepComplete'), woke = events(w, 'wakeUp');
        w.player.pos.set(0.5, 0, 2.4);
        run(w, 0.2);
        press(key);
        expect(f.state.phase).toBe('walk');
        expect(input.locked).toBe(true);
        run(w, SLEEP.walk + 0.1);
        expect(f.state.phase).toBe('lie');
        expect(started.length).toBe(1);
        expect(w.player.pos.x).toBeCloseTo(f.plan.bed.standX, 1);
        run(w, SLEEP.lie / 2);
        // 横になる途中：体が傾いている
        expect(w.player.root.rotation.x).toBeGreaterThan(0.2);
        expect(w.player.root.rotation.x).toBeLessThan(Math.PI / 2);
        run(w, SLEEP.lie / 2 + 0.1);
        expect(w.player.root.rotation.x).toBeCloseTo(Math.PI / 2, 1);
        expect(f.state.phase).toBe('sleep');
        expect(hooked).toBe(0);
        run(w, SLEEP.sleep + 0.1);
        expect(f.state.phase).toBe('rest');
        expect(hooked).toBe(1);
        expect(done.length).toBe(1);
        expect(input.locked).toBe(true);
        // 寝ている間は通常の操作（pressed）は効かないが、起き上がり（rawPressed）には反応する
        press(key);
        expect(f.state.phase).toBe('wake');
        run(w, SLEEP.wake + 0.1);
        expect(f.state.phase).toBe('free');
        expect(woke.length).toBe(1);
        expect(input.locked).toBe(false);
        expect(w.player.root.rotation.x).toBeCloseTo(0, 5);
        expect(f.state.sleeps).toBe(1);
      } finally { floor2Hooks.onSleepComplete = hook; }
    });
  }

  it('wakes up automatically if nothing is pressed', () => {
    const { w, press, f } = mk();
    w.player.pos.set(0, 0, 2.4);
    run(w, 0.2);
    press('KeyR');
    run(w, SLEEP.walk + SLEEP.lie + SLEEP.sleep + 0.5);
    expect(f.state.phase).toBe('rest');
    run(w, SLEEP.autoWake + SLEEP.wake + 0.5);
    expect(f.state.phase).toBe('free');
  });

  it('elevator: doors open after arrival; riding back asks for floor 1, but only after leaving the car once', () => {
    const { w, f } = mk();
    run(w, 0.3);
    expect(f.state.doorOpen).toBe(0);
    run(w, 3);
    expect(f.state.doorOpen).toBe(1);
    run(w, 2); // 到着直後はかごの中にいても移動しない
    expect(w.level.data.nextFloor).toBe(0);
    w.player.pos.set(0, 0, 8); run(w, 0.3); // 外に出てから
    w.player.pos.set(0, 0, 15.6); run(w, 1.2); // かごに戻ると1階へ
    expect(w.level.data.nextFloor).toBe(1);
  });
});
