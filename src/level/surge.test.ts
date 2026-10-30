import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/events';
import type { World } from '../core/types';
import { createWorld } from '../core/world';
import { moveCharacter } from '../core/collision';
import { getSockets } from '../core/sockets';
import { PLAYER } from '../config/balance';
import { buildSurge, getSurge, SHUTTER_TIME, updateSurge } from './surge';
import { dentWall } from './surge/compound';
import { COMPOUND, GARAGE, ROAD, STAIRS } from './surge/layout';

const DT = 1 / 30;

function mk(startAt?: string) {
  const keys = new Set<string>();
  const input = { locked: false, pressed: (k: string) => keys.has(k), isDown: () => false, rawPressed: (k: string) => keys.has(k), rawDown: (k: string) => keys.has(k), lastDevice: 'kbm' };
  const w = createWorld(input as never, new EventBus(), 1);
  w.state = 'playing';
  if (startAt) w.level.data.startAt = startAt;
  buildSurge(w);
  const run = (sec: number) => { for (let i = 0; i < Math.round(sec / DT); i++) { w.time += DT; updateSurge(w, DT); } };
  const press = (k: string) => { keys.add(k); w.time += DT; updateSurge(w, DT); keys.delete(k); };
  return { w, run, press };
}

/** 衝突つきで歩く（重力あり）。目的地の水平距離が 0.5 以内、または時間切れまで */
function walk(w: World, from: [number, number, number], to: [number, number], sec = 20): THREE.Vector3 {
  const pos = new THREE.Vector3(...from), vel = new THREE.Vector3();
  for (let i = 0; i < sec * 60 && Math.hypot(pos.x - to[0], pos.z - to[1]) > 0.5; i++) {
    const d = Math.hypot(to[0] - pos.x, to[1] - pos.z);
    vel.x = ((to[0] - pos.x) / d) * PLAYER.moveSpeed;
    vel.z = ((to[1] - pos.z) / d) * PLAYER.moveSpeed;
    vel.y = Math.max(-45, vel.y - PLAYER.gravity / 60);
    moveCharacter(w.colliders, pos, vel, 1 / 60, PLAYER.radius, PLAYER.height);
  }
  return pos;
}

describe('surge level', () => {
  it('builds colliders for the shutter, fence, compound wall, east fence and the road walls; exposes objects for the cutscene', () => {
    const { w } = mk();
    const tags = new Set(w.colliders.map((c) => c.tag));
    for (const t of ['shutter', 'surgeFence', 'surgeWall', 'eastFence', 'roadWall', 'stairs', 'car']) expect(tags.has(t), t).toBe(t === 'car' ? tags.has(t) : true);
    const s = w.level.data.surge;
    expect(s.fence).toBeInstanceOf(THREE.Group);
    expect(s.fencePanels.length).toBeGreaterThanOrEqual(6);
    expect(s.wall).toBeInstanceOf(THREE.Mesh);
    expect(s.wall.position.x).toBe(COMPOUND.wallX);
    expect(s.building).toBeInstanceOf(THREE.Group);
    expect(Math.abs(s.fenceCollider.min.x - COMPOUND.fenceX)).toBeLessThan(2);
    expect(s.wall.geometry.getAttribute('position').count).toBeGreaterThan(4000);
    // 壁は凹ませられる
    const pos = s.wall.geometry.getAttribute('position');
    const x0 = pos.getX(Math.floor(pos.count / 2));
    dentWall(s.wall, new THREE.Vector3(COMPOUND.wallX, 1.5, ROAD.junctionZ), 10, 2);
    let min = 0;
    for (let i = 0; i < pos.count; i++) min = Math.min(min, pos.getX(i) - x0);
    expect(min).toBeLessThan(-1.5);
  });

  it('starts on the top landing; the stairs can be walked down and back up', () => {
    const { w } = mk();
    expect(w.player.pos.y).toBeCloseTo(STAIRS.topY, 0);
    expect(w.player.pos.z).toBeCloseTo(STAIRS.topZ, 0);
    const down = walk(w, [STAIRS.topX, STAIRS.topY + 0.05, STAIRS.topZ], [0, GARAGE.z1 - 3]);
    expect(down.y).toBeLessThan(0.15);
    expect(Math.hypot(down.x, down.z - (GARAGE.z1 - 3))).toBeLessThan(1);
    const up = walk(w, [0, 0, GARAGE.z1 - 3], [0, STAIRS.topZ]);
    expect(up.y).toBeGreaterThan(STAIRS.topY - 0.2);
    expect(Math.abs(up.z - STAIRS.topZ)).toBeLessThan(1);
  });

  it('the shutter blocks the way until the socket gets power; shot and arm both work, arm costs 1 energy', () => {
    const { w, run } = mk();
    const surge = getSurge(w)!;
    const [sock] = getSockets(w);
    expect(getSockets(w).length).toBe(1);
    expect(sock.pos.x).toBeCloseTo(GARAGE.socketX, 1);
    // 閉まっている：北へ進んでも道へ出られない
    const stuck = walk(w, [0, 0, -4], [0, -20], 6);
    expect(stuck.z).toBeGreaterThan(GARAGE.shutterZ);
    // 腕で電気を送る（電力 1 消費）
    w.player.energy = 0;
    sock.onFeed();
    expect(surge.state.powered).toBe(false);
    w.player.energy = 50;
    sock.onFeed();
    expect(w.player.energy).toBe(49);
    expect(surge.state.powered).toBe(true);
    expect(sock.enabled).toBe(false);
    const opened: unknown[] = [];
    w.events.on('doorOpen', (e) => opened.push(e));
    run(0.1);
    expect(opened.length).toBe(1);
    expect(surge.shutter.active).toBe(true);
    run(SHUTTER_TIME + 0.3);
    expect(surge.state.open).toBe(1);
    expect(surge.shutter.active).toBe(false);
    // 開いた：道へ出て、T字路まで歩ける
    const out = walk(w, [0, 0, -4], [0, ROAD.junctionZ + 4], 20);
    expect(out.z).toBeLessThan(ROAD.junctionZ + 6);
  });

  it('a shot opens the shutter too', () => {
    const { w, run } = mk();
    getSockets(w)[0].onShot();
    run(SHUTTER_TIME + 0.3);
    expect(getSurge(w)!.state.open).toBe(1);
  });

  it('the car prompt (B / R) is only available after the shutter has opened and near the car', () => {
    const { w, run, press } = mk();
    const st = getSurge(w)!.state;
    w.player.pos.set(GARAGE.carX + 2.5, 0, GARAGE.carZ);
    run(0.2);
    expect(st.nearCar).toBe(false);
    press('KeyR');
    expect(st.boarded).toBe(false);
    expect(w.level.data.retryAt).toBeUndefined();
    getSockets(w)[0].onShot();
    run(SHUTTER_TIME + 0.3);
    expect(st.nearCar).toBe(true);
    w.player.pos.set(-9, 0, 11);
    run(0.2);
    expect(st.nearCar).toBe(false);
    w.player.pos.set(GARAGE.carX + 2.5, 0, GARAGE.carZ);
    run(0.2);
    expect(st.nearCar).toBe(true);
    press('PadB');
    expect(st.boarded).toBe(true);
    expect(w.level.data.retryAt).toBe('drive');
  });

  it("startAt 'drive' opens the shutter, boards the car and sets the retry point", () => {
    const { w, run } = mk('drive');
    expect(getSurge(w)!.state.open).toBe(1);
    expect(getSurge(w)!.shutter.active).toBe(false);
    run(0.1);
    expect(getSurge(w)!.state.boarded).toBe(true);
    expect(w.level.data.retryAt).toBe('drive');
    expect(getSockets(w)[0].enabled).toBe(false);
  });

  it('the road is walled in; the east branch ends at the barricade and the fence blocks the road', () => {
    const { w } = mk('drive');
    // 東へ：柵（通行止め）で止まる
    const east = walk(w, [0, 0, ROAD.junctionZ], [60, ROAD.junctionZ], 10);
    expect(east.x).toBeLessThan(ROAD.eastFenceX);
    // 道の横へ：見えない壁で出られない
    const side = walk(w, [-100, 0, ROAD.junctionZ], [-100, ROAD.junctionZ - 60], 10);
    expect(side.z).toBeGreaterThan(ROAD.junctionZ - 20);
    const side2 = walk(w, [-100, 0, ROAD.junctionZ], [-100, ROAD.junctionZ + 60], 10);
    expect(side2.z).toBeLessThan(ROAD.junctionZ + 20);
    // 西へ：柵で止まる
    const west = walk(w, [COMPOUND.fenceX + 30, 0, ROAD.junctionZ], [COMPOUND.fenceX - 40, ROAD.junctionZ], 10);
    expect(west.x).toBeGreaterThan(COMPOUND.fenceX);
    // 柵を取り払うと壁まで行けて、壁で止まる
    w.level.data.surge.fenceCollider.active = false;
    const wall = walk(w, [COMPOUND.fenceX + 30, 0, ROAD.junctionZ], [COMPOUND.wallX - 40, ROAD.junctionZ], 20);
    expect(wall.x).toBeGreaterThan(COMPOUND.wallX);
    expect(wall.x).toBeLessThan(COMPOUND.fenceX - 50);
    // 上へも出られない（ジェットパックの天井）
    const lid = new THREE.Vector3(-100, 0, ROAD.junctionZ), v = new THREE.Vector3(0, 40, 0);
    for (let i = 0; i < 240; i++) { v.y = 40; moveCharacter(w.colliders, lid, v, 1 / 60, PLAYER.radius, PLAYER.height); }
    expect(lid.y).toBeLessThan(50);
  });
});
