import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/events';
import type { World } from '../core/types';
import { createWorld } from '../core/world';
import { moveCharacter } from '../core/collision';
import { getSockets } from '../core/sockets';
import { PLAYER } from '../config/balance';
import { buildSurge, getSurge, isWalkingOut, surgeFootState, SHUTTER_TIME, updateSurge } from './surge';
import { startSpecial, updateSpecial } from '../special/special';
import { onRoad } from './surge/walkZone';
import { dentWall } from './surge/compound';
import { COMPOUND, DRAIN_DOOR, ENTRANCE, GARAGE, RAMP, ROAD, STAIRS } from './surge/layout';

const DT = 1 / 30;

function mk(startAt?: string, route?: 'drain') {
  const keys = new Set<string>();
  const input = { locked: false, pressed: (k: string) => keys.has(k), isDown: () => false, rawPressed: (k: string) => keys.has(k), rawDown: (k: string) => keys.has(k), lastDevice: 'kbm' };
  const w = createWorld(input as never, new EventBus(), 1);
  w.state = 'playing';
  if (startAt) w.level.data.startAt = startAt;
  if (route === 'drain') w.level.data.camp2Cleared = true;
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

  it('the road edges are open (no invisible walls); the east branch ends at the barricade and the fence blocks the road', () => {
    const { w } = mk('drive');
    // 東へ：柵（通行止め）で止まる
    const east = walk(w, [0, 0, ROAD.junctionZ], [60, ROAD.junctionZ], 10);
    expect(east.x).toBeLessThan(ROAD.eastFenceX);
    // 道の横へ：見えない壁は無く、歩道の外へ出られる（出ると蛇に潰される。下のテスト）
    const side = walk(w, [-100, 0, ROAD.junctionZ], [-100, ROAD.junctionZ - 60], 10);
    expect(side.z).toBeLessThan(ROAD.junctionZ - 20);
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

  it('walking off the road for 1 second drops a giant snake that crushes the player; staying on the road is safe', () => {
    const { w, run } = mk();
    run(0.1);
    w.state = 'playing';
    // 道の上：安全
    w.player.pos.set(-200, 0.3, ROAD.junctionZ);
    run(3);
    expect(w.player.hp).toBeGreaterThan(0);
    expect(surgeFootState(w)!.crushing).toBe(false);
    // 道の外（歩道の外）：1秒たつと蛇が降ってきて、落ちたら死亡
    w.player.pos.set(-200, 0.3, ROAD.junctionZ - 30);
    run(0.6);
    expect(surgeFootState(w)!.crushing).toBe(false);
    run(0.7);
    expect(surgeFootState(w)!.crushing).toBe(true);
    expect(w.scene.getObjectByName('crushSnake')).toBeTruthy();
    expect(w.player.hp).toBeGreaterThan(0);
    run(1.5);
    expect(w.player.hp).toBe(0);
  });

  it('onRoad: garage, the road with sidewalks, and the drain ramp are road; the city around is not', () => {
    const jz = ROAD.junctionZ;
    expect(onRoad(0, 0, 'camp')).toBe(true);                // ガレージ
    expect(onRoad(0, -50, 'camp')).toBe(true);              // 一本道
    expect(onRoad(-300, jz + 12, 'camp')).toBe(true);       // 歩道
    expect(onRoad(-300, jz + 20, 'camp')).toBe(false);      // 街
    expect(onRoad(40, jz, 'camp')).toBe(false);             // 東は柵の向こう
    expect(onRoad(40, jz, 'drain')).toBe(true);             // ルート2は東へ続く
    expect(onRoad(RAMP.landingEndX - 2, jz, 'drain')).toBe(true);
    expect(onRoad(RAMP.topX, jz + 20, 'drain')).toBe(false);
    expect(onRoad(COMPOUND.fenceX - 20, ENTRANCE.z, 'camp')).toBe(false);
    expect(onRoad(COMPOUND.fenceX - 20, ENTRANCE.z, 'camp', true)).toBe(true);   // 柵を壊したあとの庭
  });

  it('walking up to the fence and using the special move breaks it, then the entrance leads to camp1', () => {
    const { w, run } = mk();
    run(0.1);
    w.player.pos.set(COMPOUND.fenceX + 20, 0.3, ROAD.junctionZ);
    w.special.gauge = 0;
    run(0.2);
    expect(w.special.gauge).toBeGreaterThan(0);              // 壁の前でゲージが満タンになる
    expect(w.level.data.specialWall).toBeTruthy();
    // 敵がいなくても、壁の前なら必殺技を撃てる
    updateSpecial(w, DT);                                    // 前のテストの World の必殺技が残っていれば片付ける
    expect(startSpecial(w)).toBe(true);
    expect(w.special.phase).toBe('pose');
    w.level.data.specialWall.onEnd();                       // 撃ち終わり
    expect(surgeFootState(w)!.wallBroken).toBe(true);
    expect(w.level.data.surge.fenceCollider.active).toBe(false);
    expect(isWalkingOut(w)).toBe(true);
    // 庭は道路扱い：蛇は出ない
    w.player.pos.set(COMPOUND.wallX + 8, 0.3, ENTRANCE.z - 3);
    run(2);
    expect(surgeFootState(w)!.crushing).toBe(false);
  });

  it('drain route: the ramp is walkable on foot; the special move blows the door open and leads to the drain level', () => {
    const { w, run } = mk(undefined, 'drain');
    run(0.1);
    const top = walk(w, [RAMP.footX - 4, 0.3, ROAD.junctionZ], [RAMP.landingEndX - 3, ROAD.junctionZ], 80);
    expect(top.y).toBeGreaterThan(RAMP.topY - 1);
    expect(top.x).toBeGreaterThan(RAMP.landingEndX - 5);
    w.player.pos.copy(top);
    run(0.2);
    expect(w.level.data.specialWall).toBeTruthy();
    updateSpecial(w, DT);                                    // 前のテストの World の必殺技が残っていれば片付ける
    expect(startSpecial(w)).toBe(true);
    w.level.data.specialWall.onEnd();
    expect(surgeFootState(w)!.wallBroken).toBe(true);
    run(2.5);
    expect(w.level.data.nextLevel).toEqual({ level: 'drain' });
    void DRAIN_DOOR;
  });

  it('after the crash cutscene the player gets out next to the car and walks to the left entrance, which leads to camp1', () => {
    const { w, run } = mk('drive');
    run(0.1);
    const d = w.level.data.drive;
    expect(d).toBeTruthy();
    // 激突の演出が終わった状態にする（車は壁の前）
    d.phase = 'done';
    d.result = 'success';
    d.pos.set(COMPOUND.wallX + 3, 0, ROAD.junctionZ);
    d.car.root.position.copy(d.pos);
    w.input.locked = true;
    w.toasts.push({ text: 'サージ収容所に潜入！（続きは今後）', timer: 6 });
    run(0.1);
    expect(isWalkingOut(w)).toBe(true);
    expect(w.input.locked).toBe(false);
    expect(w.player.root.visible).toBe(true);
    expect(w.toasts.some((t) => t.text.includes('続きは今後'))).toBe(false);
    expect(w.level.data.objective).toContain('左側');
    // 南の庭を通って入口まで歩ける（柵の外の道へは出られない）
    const p = walk(w, [w.player.pos.x, 0, w.player.pos.z], [ENTRANCE.x + 1, ENTRANCE.z], 30);
    expect(Math.abs(p.z - ENTRANCE.z)).toBeLessThan(1);
    expect(p.x).toBeLessThan(ENTRANCE.x + ENTRANCE.reach);
    w.player.pos.copy(p);
    run(0.1);
    expect(w.level.data.nextLevel).toEqual({ level: 'camp1' });
    // 庭の南端より先へは行けない
    const s = walk(w, [COMPOUND.wallX + 10, 0, ROAD.junctionZ + 40], [COMPOUND.wallX + 10, ROAD.junctionZ + 120], 10);
    expect(s.z).toBeLessThan(ENTRANCE.yardZ1);
  });
});
