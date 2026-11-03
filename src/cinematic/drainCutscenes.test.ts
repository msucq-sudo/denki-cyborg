// ルート2の判定地点Eの演出 3本の窓口テスト：3本とも最後まで進み、onDone が1回だけ呼ばれ、車が坂に沿って動く。
//  成功：扉の直前でスロー → 衝突の瞬間に等倍 → 扉を突き破って車が扉の奥へ消える
//  失敗：同じスロー → 扉に激突して破れず、はね返って扉の手前で止まる（扉は凹むだけ）→ 頭をかくカット
//  失速：坂の途中で止まり、後ろ向きに滑り落ちて、発電所の脇の壁（PLANT.sideWing）に激突
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createWorld } from '../core/world';
import { EventBus } from '../core/events';
import type { World } from '../core/types';
import type { DriveState } from '../vehicle/types';
import { buildCar } from '../vehicle/carModel';
import { CHECKPOINT_E, DRAIN_DOOR, PLANT, RAMP, ROAD, STALL } from '../level/surge/layout';
import { playDrainFailCutscene, playDrainStallCutscene, playDrainSuccessCutscene } from './api';
import type { CutsceneHandle } from './api';
import { Cutscene } from './sequencer';
import { drainSuccessScript } from './drainSuccess';
import type { DrainSuccessProbe } from './drainSuccess';
import { drainFailScript } from './drainFail';
import type { DrainFailProbe } from './drainFail';
import { drainStallScript } from './drainStall';
import type { DrainStallProbe } from './drainStall';

function mk(kmh: number, withParts = true): { w: World; drive: DriveState; door?: THREE.Mesh; broken?: THREE.Mesh; wing?: THREE.Mesh } {
  const w = createWorld({} as any, new EventBus(), 16 / 9);
  w.state = 'playing';
  const car = buildCar();
  w.scene.add(car.root);
  const drive: DriveState = {
    phase: 'driving', car, pos: new THREE.Vector3(CHECKPOINT_E.x + 1, 0, ROAD.junctionZ), yaw: -Math.PI / 2, speed: kmh / 3.6, result: 'none', route: 'drain',
  };
  if (!withParts) return { w, drive };
  // plant.ts が置く部品の代わり：扉（凹ませられる細かい板）・壊れた扉・脇の壁
  const door = new THREE.Mesh(new THREE.PlaneGeometry(DRAIN_DOOR.w, DRAIN_DOOR.h, 10, 7), new THREE.MeshBasicMaterial());
  door.rotation.y = -Math.PI / 2;
  door.position.set(DRAIN_DOOR.x, DRAIN_DOOR.y + DRAIN_DOOR.h / 2, DRAIN_DOOR.z);
  const broken = new THREE.Mesh(new THREE.PlaneGeometry(DRAIN_DOOR.w, DRAIN_DOOR.h, 2, 2), new THREE.MeshBasicMaterial());
  broken.visible = false;
  const wing = new THREE.Mesh(new THREE.PlaneGeometry(PLANT.sideWing.x1 - PLANT.sideWing.x0, PLANT.sideWing.height, 60, 20), new THREE.MeshBasicMaterial());
  wing.position.set((PLANT.sideWing.x0 + PLANT.sideWing.x1) / 2, PLANT.sideWing.height / 2, PLANT.sideWing.z0);
  wing.rotation.y = Math.PI; // 法線 -Z（坂側）
  w.scene.add(door, broken, wing);
  (w.level.data as any).surge = { plant: { parts: { door, doorBroken: broken, sideWing: wing } } };
  return { w, drive, door, broken, wing };
}

function run(h: CutsceneHandle, w: World, maxSec = 40): number {
  let t = 0;
  while (!h.done && t < maxSec) { h.update(w, 1 / 60); t += 1 / 60; }
  return t;
}

const probeOf = <T>(init: T): T => init;

describe('ルート2の演出', () => {
  it('成功：スロー → 衝突の瞬間に等倍 → 扉を突き破って奥へ。onDone が1回。phase は cutscene → done', () => {
    const { w, drive, door, broken } = mk(320);
    let done = 0;
    const probe = probeOf<DrainSuccessProbe>({ carX: 0, carY: 0, atDoor: false, breached: false, doorSwapped: false, pastDoor: false, minScaleBeforeImpact: 1, scaleAfterImpact: 0, debris: 0, finished: false });
    drive.phase = 'cutscene';
    const h = new Cutscene(w, (rt) => drainSuccessScript(rt, drive, probe), () => { drive.phase = 'done'; done++; });
    let maxY = 0, t = 0, breachT = -1, slowSeen = false, scaleAtBreach = -1;
    while (!h.done && t < 40) {
      h.update(w, 1 / 60); t += 1 / 60;
      maxY = Math.max(maxY, drive.car.root.position.y);
      if (h.timeScale < 0.3) slowSeen = true;
      if (probe.breached && breachT < 0) { breachT = t; scaleAtBreach = h.timeScale; expect(slowSeen).toBe(true); }
    }
    expect(h.done).toBe(true);
    expect(done).toBe(1);
    expect(drive.phase).toBe('done');
    expect(maxY).toBeGreaterThan(RAMP.topY - 1);
    expect(t).toBeGreaterThan(11);
    expect(t).toBeLessThan(17);
    // 扉を突き破った：本体を隠して壊れた扉を出し、破片が飛び、車は扉の面を越えた
    expect(probe.breached).toBe(true);
    expect(probe.doorSwapped).toBe(true);
    expect(door!.visible).toBe(false);
    expect(broken!.visible).toBe(true);
    expect(probe.pastDoor).toBe(true);
    expect(drive.pos.x).toBeGreaterThan(DRAIN_DOOR.x);
    expect(probe.debris).toBeGreaterThan(10);
    // スローは衝突の前に入り、衝突の次の更新で等倍に戻る
    expect(probe.minScaleBeforeImpact).toBeLessThan(0.2);
    expect(probe.scaleAfterImpact).toBe(1);
    expect(scaleAtBreach).toBeLessThan(0.2); // 衝突した更新の時点ではまだスロー
    expect(h.timeScale).toBe(1);
  });

  it('成功：部品（扉）が無くても最後まで動き、破片は自前で飛ぶ', () => {
    const { w, drive } = mk(320, false);
    let done = 0;
    const probe = probeOf<DrainSuccessProbe>({ carX: 0, carY: 0, atDoor: false, breached: false, doorSwapped: false, pastDoor: false, minScaleBeforeImpact: 1, scaleAfterImpact: 0, debris: 0, finished: false });
    const h = new Cutscene(w, (rt) => drainSuccessScript(rt, drive, probe), () => { done++; });
    run(h, w);
    expect(done).toBe(1);
    expect(probe.breached).toBe(true);
    expect(probe.debris).toBeGreaterThan(10);
  });

  it('失敗：同じスローのあと扉に激突するが破れず、はね返って扉の手前で止まる。onDone が1回', () => {
    const { w, drive, door, broken } = mk(250);
    let done = 0;
    const probe = probeOf<DrainFailProbe>({ carX: 0, carY: 0, hitDoor: false, breached: false, dented: 0, minScaleBeforeImpact: 1, scaleAfterImpact: 0, scratching: false, finished: false });
    const h = new Cutscene(w, (rt) => drainFailScript(rt, drive, probe), () => { drive.phase = 'done'; done++; });
    let t = 0, maxX = 0, hitX = 0, slowSeen = false;
    while (!h.done && t < 40) {
      h.update(w, 1 / 60); t += 1 / 60;
      maxX = Math.max(maxX, drive.pos.x);
      if (h.timeScale < 0.3) slowSeen = true;
      if (probe.hitDoor && !hitX) { hitX = drive.pos.x; expect(slowSeen).toBe(true); }
    }
    expect(h.done).toBe(true);
    expect(done).toBe(1);
    expect(t).toBeGreaterThan(13);
    expect(t).toBeLessThan(19);
    expect(probe.hitDoor).toBe(true);
    expect(probe.breached).toBe(false);
    expect(door!.visible).toBe(true);
    expect(broken!.visible).toBe(false);
    expect(probe.dented).toBeGreaterThan(0);
    // 扉の手前で止まる（突き抜けない）
    expect(maxX).toBeLessThan(DRAIN_DOOR.x);
    expect(drive.pos.x).toBeLessThan(hitX - 2);
    expect(probe.minScaleBeforeImpact).toBeLessThan(0.2);
    expect(probe.scaleAfterImpact).toBe(1);
    expect(probe.scratching).toBe(true);
    expect((drive.car as unknown as { pose: string }).pose).toBe('scratch');
  });

  it('失速：坂の途中で止まり、後ろ向きに滑り落ちて、脇の壁（sideWing）に激突。onDone が1回', () => {
    const { w, drive, wing } = mk(150);
    let done = 0;
    const probe = probeOf<DrainStallProbe>({ carX: 0, carY: 0, carZ: 0, sliding: false, hitWing: false, dented: 0, maxX: 0, finished: false });
    const h = new Cutscene(w, (rt) => drainStallScript(rt, drive, probe), () => { drive.phase = 'done'; done++; });
    let t = 0, slidingAt = -1, minZ = 1e9;
    while (!h.done && t < 40) {
      h.update(w, 1 / 60); t += 1 / 60;
      if (probe.sliding && slidingAt < 0) slidingAt = probe.carX;
      minZ = Math.min(minZ, probe.carZ);
    }
    expect(h.done).toBe(true);
    expect(done).toBe(1);
    expect(drive.phase).toBe('done');
    expect(t).toBeGreaterThan(11);
    expect(t).toBeLessThan(16);
    // 坂の途中（climbX の手前）で止まって滑りはじめ、そこから後ろへ下がる
    expect(probe.maxX).toBeGreaterThan(RAMP.footX);
    expect(probe.maxX).toBeLessThan(STALL.climbX + 1);
    expect(slidingAt).toBeGreaterThan(STALL.climbX - 5);
    expect(probe.carX).toBeLessThan(slidingAt);
    // 横へそれて壁にぶつかった（壁の坂側の面 z0 の手前）
    expect(probe.hitWing).toBe(true);
    expect(probe.carZ).toBeGreaterThan(PLANT.sideWing.z0 - 7);
    expect(probe.carZ).toBeLessThan(PLANT.sideWing.z0);
    expect(probe.carX).toBeGreaterThan(PLANT.sideWing.x0);
    expect(probe.carX).toBeLessThan(PLANT.sideWing.x1);
    expect(probe.dented).toBeGreaterThan(0);
    expect(wing).toBeTruthy();
    expect((drive.car as unknown as { pose: string }).pose).toBe('scratch');
  });

  it('api の窓口：3本とも最後まで進み onDone が1回', () => {
    for (const [kmh, play] of [[320, playDrainSuccessCutscene], [250, playDrainFailCutscene], [150, playDrainStallCutscene]] as const) {
      const { w, drive } = mk(kmh);
      let done = 0;
      const h = play(w, drive, () => { done++; });
      expect(drive.phase).toBe('cutscene');
      run(h, w);
      expect(h.done).toBe(true);
      expect(done).toBe(1);
      expect(drive.phase).toBe('done');
    }
  });

  it('スキップしても完了状態（扉・壁の結果が確定）になり、onDone は1回', () => {
    for (const [kmh, play] of [[320, playDrainSuccessCutscene], [250, playDrainFailCutscene], [150, playDrainStallCutscene]] as const) {
      const { w, drive } = mk(kmh);
      let done = 0;
      const h = play(w, drive, () => { done++; });
      h.update(w, 1 / 60);
      h.skip();
      expect(h.done).toBe(true);
      expect(done).toBe(1);
    }
    const { w, drive, door } = mk(320);
    const h = playDrainSuccessCutscene(w, drive, () => {});
    h.update(w, 1 / 60);
    h.skip();
    expect(door!.visible).toBe(false);
    expect(drive.pos.x).toBeGreaterThan(DRAIN_DOOR.x);
  });
});
