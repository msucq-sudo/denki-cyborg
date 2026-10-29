import * as THREE from 'three';
import { createWorld } from '../core/world';
import { EventBus } from '../core/events';
import type { World } from '../core/types';
import type { DriveState } from '../vehicle/types';
import { buildCar } from '../vehicle/carModel';
import { COMPOUND, ROAD } from '../level/surge/layout';
import { Cutscene } from './sequencer';
import { successScript, SLOW_SCALE } from './success';
import type { SuccessProbe } from './success';
import { failScript } from './fail';
import type { FailProbe } from './fail';
import { buildDemoStage } from './standins';
import { dentObject } from './stage';
import { playFailCutscene, playSuccessCutscene } from './api';

function mk(speedKmh = 310, x = -1380): { w: World; drive: DriveState } {
  const w = createWorld({} as any, new EventBus(), 16 / 9);
  w.state = 'playing';
  const car = buildCar();
  w.scene.add(car.root);
  const drive: DriveState = { phase: 'driving', car, pos: new THREE.Vector3(x, 0, ROAD.junctionZ), yaw: Math.PI / 2, speed: speedKmh / 3.6, result: 'none' };
  return { w, drive };
}

function collect(w: World, name: any): any[] {
  const l: any[] = [];
  w.events.on(name, (p: any) => l.push(p));
  return l;
}

/** 終わるまで 1/60 秒で進める。各フレームで cb を呼ぶ。経過（実時間）を返す */
function run(h: Cutscene, w: World, cb?: (t: number) => void, maxSec = 40): number {
  let t = 0;
  while (!h.done && t < maxSec) {
    h.update(w, 1 / 60);
    t += 1 / 60;
    cb?.(t);
  }
  return t;
}

test('success: shot order, timing, events, slow motion, wall dent, onDone once', () => {
  const { w, drive } = mk();
  buildDemoStage(w);
  const probe: SuccessProbe = { fenceBroken: false, crashed: false, d: 0, carX: 0, carSpeed: 0, dented: 0, flying: 0 };
  const events: string[] = [];
  for (const n of ['fenceBreak', 'carWallCrash', 'slowmo'] as const) w.events.on(n, (p: any) => events.push(n + (p && 'on' in p ? `:${p.on}` : '')));
  let done = 0;
  const h = new Cutscene(w, (rt) => successScript(rt, drive, probe), () => { done++; });
  const order: string[] = [];
  let minScale = 1;
  const slowFrames: number[] = [];
  let lastX = drive.pos.x;
  let fastDx = 0, slowDx = 0;
  const wall = w.level.data.surge.wall as THREE.Mesh;
  const before = (wall.geometry.attributes.position.array as Float32Array).slice();
  const total = run(h, w, () => {
    if (h.shotName && order[order.length - 1] !== h.shotName) order.push(h.shotName);
    if (!probe.crashed) minScale = Math.min(minScale, h.timeScale);
    const dx = Math.abs(drive.pos.x - lastX);
    lastX = drive.pos.x;
    if (h.shotIndex === 5 && !probe.crashed && dx < 5) {
      if (h.timeScale <= SLOW_SCALE + 1e-6) { slowDx = Math.max(slowDx, dx); slowFrames.push(1); }
      if (h.timeScale >= 0.999) fastDx = Math.max(fastDx, dx);
    }
  });
  expect(h.done).toBe(true);
  expect(done).toBe(1);
  expect(order).toEqual(['前方斜め', '道ばた', '車内', '後ろの引き', '正面の顔', '真横']);
  expect(total).toBeGreaterThan(12);
  expect(total).toBeLessThan(17.5);
  // イベントの順序：スロー開始 → 柵 → スロー終了 → 壁
  expect(events.indexOf('slowmo:true')).toBeGreaterThanOrEqual(0);
  expect(events.indexOf('fenceBreak')).toBeGreaterThan(events.indexOf('slowmo:true'));
  expect(events.indexOf('slowmo:false')).toBeGreaterThan(events.indexOf('fenceBreak'));
  expect(events.indexOf('carWallCrash')).toBeGreaterThan(events.indexOf('slowmo:false'));
  expect(events.filter((e) => e === 'fenceBreak')).toHaveLength(1);
  expect(events.filter((e) => e === 'carWallCrash')).toHaveLength(1);
  // スロー：実時間1フレームあたりの車の進みが等倍の約 SLOW_SCALE 倍
  expect(minScale).toBeCloseTo(SLOW_SCALE, 2);
  expect(slowFrames.length).toBeGreaterThan(60);
  expect(slowDx / fastDx).toBeLessThan(SLOW_SCALE * 1.5);
  // 壁が凹んだ：頂点が -X（建物の中）へ動いた。範囲外は動かない
  const after = wall.geometry.attributes.position.array as Float32Array;
  let moved = 0, maxShift = 0;
  for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) moved++;
  expect(moved).toBeGreaterThan(50);
  expect(probe.dented).toBeGreaterThan(50);
  // wall は rotation.y=π/2 → ローカル +Z が世界 +X。奥へ凹む＝ローカル z が減る
  for (let i = 2; i < after.length; i += 3) maxShift = Math.max(maxShift, before[i] - after[i]);
  expect(maxShift).toBeGreaterThan(2);
  expect(probe.flying).toBeGreaterThan(0);
  // 車は壁で止まる（柵は越えている）
  expect(drive.pos.x).toBeLessThan(COMPOUND.fenceX);
  expect(drive.pos.x).toBeGreaterThan(COMPOUND.wallX);
  // 後片付け：パーティクルの群れが scene に残らない・カメラが戻る
  expect(w.scene.children.some((c) => c instanceof THREE.InstancedMesh)).toBe(false);
  expect(w.camera.far).toBe(400);
});

test('success via api sets drive.phase and calls onDone once; panels fly', () => {
  const { w, drive } = mk(320);
  buildDemoStage(w);
  let done = 0;
  const h = playSuccessCutscene(w, drive, () => { done++; });
  expect(drive.phase).toBe('cutscene');
  let t = 0;
  while (!h.done && t < 30) { h.update(w, 1 / 60); t += 1 / 60; }
  expect(done).toBe(1);
  expect(drive.phase).toBe('done');
  h.update(w, 1 / 60);
  expect(done).toBe(1);
  // 柵の板が飛ばされて中央付近が空いている
  const panels = w.level.data.surge.fencePanels as THREE.Object3D[];
  const gone = panels.filter((p) => Math.abs(p.position.x - COMPOUND.fenceX) > 1);
  expect(gone.length).toBeGreaterThanOrEqual(1);
});

test('fail: three heavies, carCaught, slow motion, car stops before the fence, cleanup', () => {
  const { w, drive } = mk(240);
  buildDemoStage(w);
  const probe: FailProbe = { heavies: 0, caught: false, stopped: false, carX: 0, carSpeed: 0, pushed: 0 };
  const events: string[] = [];
  for (const n of ['carCaught', 'slowmo', 'fenceBreak', 'carWallCrash'] as const) w.events.on(n, (p: any) => events.push(n + (p && 'on' in p ? `:${p.on}` : '')));
  let done = 0;
  const h = new Cutscene(w, (rt) => failScript(rt, drive, probe), () => { done++; });
  const order: string[] = [];
  let maxHeavies = 0, minX = 1e9, alive = 0;
  const total = run(h, w, () => {
    if (h.shotName && order[order.length - 1] !== h.shotName) order.push(h.shotName);
    maxHeavies = Math.max(maxHeavies, probe.heavies);
    let n = 0; w.scene.traverse((o) => { if (o.userData?.__heavy) n++; }); alive = Math.max(alive, n);
    minX = Math.min(minX, drive.pos.x);
  });
  expect(done).toBe(1);
  expect(order).toEqual(['車内・ヘビー出現', '顔・身を乗り出す', '主人公の視点', '俯瞰', '真横・衝突']);
  expect(total).toBeGreaterThan(9.5);
  expect(total).toBeLessThan(14.5);
  expect(maxHeavies).toBe(3);
  expect(probe.caught && probe.stopped).toBe(true);
  expect(probe.pushed).toBeGreaterThan(0.5);
  expect(events).toContain('carCaught');
  expect(events).toContain('slowmo:true');
  expect(events[events.length - 1]).toBe('slowmo:false');
  expect(events).not.toContain('fenceBreak');
  expect(events).not.toContain('carWallCrash');
  expect(minX).toBeGreaterThan(COMPOUND.fenceX);
  // ヘビーは片付く（scene に残らない）
  let meshGroups = 0;
  w.scene.traverse((o) => { if ((o as any).userData?.__heavy) meshGroups++; });
  expect(meshGroups).toBe(0);
  expect(alive).toBe(3);
});

test('fail via api: result and phase', () => {
  const { w, drive } = mk(200);
  let done = 0;
  const h = playFailCutscene(w, drive, () => { done++; });
  let t = 0;
  while (!h.done && t < 30) { h.update(w, 1 / 60); t += 1 / 60; }
  expect(done).toBe(1);
  expect(drive.phase).toBe('done');
});

test('skip ends immediately, once, and cleans up', () => {
  const { w, drive } = mk();
  buildDemoStage(w);
  let done = 0;
  const h = new Cutscene(w, (rt) => successScript(rt, drive), () => { done++; });
  for (let i = 0; i < 90; i++) h.update(w, 1 / 60);
  expect(h.done).toBe(false);
  h.skip();
  expect(h.done).toBe(true);
  expect(done).toBe(1);
  h.skip();
  h.update(w, 1 / 60);
  expect(done).toBe(1);
  expect(w.scene.children.some((c) => c instanceof THREE.InstancedMesh)).toBe(false);
});

test('holding the skip button skips after a grace period; tapping does not', () => {
  const { w, drive } = mk();
  buildDemoStage(w);
  let down = false;
  (w as any).input = { rawDown: (c: string) => down && c === 'Space', rawPressed: () => false };
  let done = 0;
  const h = new Cutscene(w, (rt) => successScript(rt, drive), () => { done++; });
  // 連打（押して離す）では飛ばない
  for (let i = 0; i < 240; i++) { down = i % 10 < 3; h.update(w, 1 / 60); }
  expect(h.done).toBe(false);
  down = true;
  for (let i = 0; i < 20; i++) h.update(w, 1 / 60);
  expect(h.done).toBe(false);
  for (let i = 0; i < 60; i++) h.update(w, 1 / 60);
  expect(h.done).toBe(true);
  expect(done).toBe(1);
});

test('dentObject pushes only nearby vertices, along the given direction', () => {
  const geo = new THREE.PlaneGeometry(40, 20, 40, 20);
  const wall = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  wall.rotation.y = Math.PI / 2;
  wall.position.set(-100, 10, 0);
  const before = (geo.attributes.position.array as Float32Array).slice();
  const n = dentObject(wall, new THREE.Vector3(-100, 1, 0), new THREE.Vector3(-1, 0, 0), 8, 3);
  expect(n).toBeGreaterThan(30);
  const a = geo.attributes.position;
  wall.updateMatrixWorld(true);
  const v = new THREE.Vector3(), v0 = new THREE.Vector3();
  let deepest = 0;
  for (let i = 0; i < a.count; i++) {
    v.fromBufferAttribute(a, i).applyMatrix4(wall.matrixWorld);
    v0.set(before[i * 3], before[i * 3 + 1], before[i * 3 + 2]).applyMatrix4(wall.matrixWorld);
    const far = new THREE.Vector3(-100, 1, 0).distanceTo(v0) >= 8;
    if (far) expect(v.distanceTo(v0)).toBeLessThan(1e-4);
    else { expect(v.x - v0.x).toBeLessThanOrEqual(0.4); deepest = Math.min(deepest, v.x - v0.x); }
    expect(Math.abs(v.y - v0.y)).toBeLessThan(1e-4);
  }
  expect(deepest).toBeLessThan(-2);
});

test('Esc skips at once; skipping during slow motion emits slowmo off', () => {
  const { w, drive } = mk();
  buildDemoStage(w);
  let esc = false;
  (w as any).input = { rawDown: () => false, rawPressed: (c: string) => esc && c === 'Escape' };
  const probe: SuccessProbe = { fenceBroken: false, crashed: false, d: 0, carX: 0, carSpeed: 0, dented: 0, flying: 0 };
  const ev: string[] = [];
  w.events.on('slowmo', (p: any) => ev.push(p.on ? 'on' : 'off'));
  let done = 0;
  const h = new Cutscene(w, (rt) => successScript(rt, drive, probe), () => { done++; });
  // スロー中まで進める
  let t = 0;
  while (h.timeScale > 0.2 || h.shotIndex < 5) { h.update(w, 1 / 60); if ((t += 1 / 60) > 30) break; }
  expect(ev).toEqual(['on']);
  esc = true;
  h.update(w, 1 / 60);
  expect(h.done).toBe(true);
  expect(h.wasSkipped).toBe(true);
  expect(done).toBe(1);
  expect(ev).toEqual(['on', 'off']);
  expect(w.camera.far).toBe(400);
});
