import * as THREE from 'three';
import { createWorld } from '../../core/world';
import { EventBus } from '../../core/events';
import type { World, Enemy } from '../../core/types';
import { ABSORB, LEECH } from '../../config/balance';
import { makeAABB } from '../../core/collision';
import { playerCenter } from '../../core/combat';
import { spawnEnemy, updateEnemies, damageEnemy, drainEnemy } from '../enemies';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mkWorld(): World {
  const w = createWorld({} as any, new EventBus(), 1);
  w.state = 'playing';
  w.player.pos.set(0, 0, 10);
  w.player.energy = 80;
  w.colliders.push(makeAABB(V(-80, -1, -80), V(80, 0, 80), 'floor'));
  return w;
}
function step(w: World, sec: number, dt = 1 / 30): void {
  for (let t = 0; t < sec; t += dt) { w.time += dt; updateEnemies(w, dt); }
}
/** 攻撃に入る状態のリーチを出す */
function mkLeech(w: World, z = 0): Enemy {
  const e = spawnEnemy(w, 'leech', V(0, 1.1, z));
  e.ai.alert = 1e9;
  e.ai.atkCd = 0;
  return e;
}
function collect(w: World, name: 'leechFire' | 'leechAttach' | 'leechBreak' | 'leechFlee'): any[] {
  const list: any[] = [];
  w.events.on(name, (p: any) => list.push(p));
  return list;
}
/** つながるまで進める */
function stepUntilAttached(w: World, e: Enemy, maxSec = 4): void {
  for (let t = 0; t < maxSec && e.ai.armPhase !== 'attached'; t += 1 / 30) step(w, 1 / 30);
}

test('arm fires, attaches and drains player energy into ai.stolen', () => {
  const w = mkWorld();
  const fire = collect(w, 'leechFire'), attach = collect(w, 'leechAttach');
  const e = mkLeech(w);
  stepUntilAttached(w, e);
  expect(e.ai.armPhase).toBe('attached');
  expect(fire).toHaveLength(1);
  expect(attach).toHaveLength(1);
  expect(w.player.leeched).toBe(true);
  const before = w.player.energy;
  step(w, 1);
  const lost = before - w.player.energy;
  expect(lost).toBeGreaterThan(LEECH.drainPerSec * 0.8);
  expect(lost).toBeLessThan(LEECH.drainPerSec * 1.2);
  expect(e.ai.stolen).toBeGreaterThanOrEqual(lost - 1e-6);
  // 盗んだ分は「使った電力」に数えない
  expect(w.stats.energyUsed).toBeCloseTo(0, 5);
});

test('stolen energy is capped and the arm lets go when full', () => {
  const w = mkWorld();
  const e = mkLeech(w);
  e.ai.stolen = LEECH.stolenCap - 1;
  stepUntilAttached(w, e);
  step(w, 1);
  expect(e.ai.stolen).toBeLessThanOrEqual(LEECH.stolenCap + 1e-6);
  expect(e.ai.stolen).toBeGreaterThan(LEECH.stolenCap - 0.01);
  expect(e.ai.armPhase).not.toBe('attached');
  expect(w.player.leeched).toBe(false);
  // 満タンのうちは新しく撃ってこない
  const fire = collect(w, 'leechFire');
  step(w, 5);
  expect(fire).toHaveLength(0);
});

test('a wall blocks the arm', () => {
  const w = mkWorld();
  w.colliders.push(makeAABB(V(-5, 0, 4), V(5, 6, 5), 'wall'));
  const e = mkLeech(w);
  const attach = collect(w, 'leechAttach');
  step(w, 4);
  expect(attach).toHaveLength(0);
  expect(e.ai.armPhase === 'none' || e.ai.armPhase === 'retracting' || e.ai.armPhase === 'extending').toBe(true);
  expect(w.player.leeched).toBeFalsy();
});

test('dodge breaks the arm', () => {
  const w = mkWorld();
  const brk = collect(w, 'leechBreak');
  const e = mkLeech(w);
  stepUntilAttached(w, e);
  expect(w.player.leeched).toBe(true);
  w.player.dodgeTimer = 0.2;
  step(w, 1 / 30);
  expect(e.ai.armPhase).toBe('retracting');
  expect(w.player.leeched).toBe(false);
  expect(brk).toHaveLength(1);
  // 回避中に届いたアームはつながらない
  w.player.dodgeTimer = 0;
  step(w, 3);
  expect(e.ai.armPhase).not.toBe('attached'); // 再発射しても次の撃ち直しまで間がある
});

test('arm lets go when the player moves too far away', () => {
  const w = mkWorld();
  const e = mkLeech(w);
  stepUntilAttached(w, e);
  w.player.pos.z = e.pos.z + LEECH.breakDistance + 4;
  step(w, 1 / 30);
  expect(e.ai.armPhase).not.toBe('attached');
  expect(w.player.leeched).toBe(false);
});

test('arm lets go after maxAttach seconds', () => {
  const w = mkWorld();
  w.player.energy = 100;
  const e = mkLeech(w);
  e.ai.stolen = 0;
  stepUntilAttached(w, e);
  step(w, LEECH.maxAttach + 0.5);
  expect(e.ai.armPhase).not.toBe('attached');
});

test('being shot breaks the arm', () => {
  const w = mkWorld();
  const e = mkLeech(w);
  stepUntilAttached(w, e);
  damageEnemy(w, e, 1, { how: 'shot' });
  expect(e.status).toBe('active');
  expect(e.ai.armPhase).toBe('retracting');
  expect(w.player.leeched).toBe(false);
});

test('tethered leech retracts its arm and runs away from the player', () => {
  const w = mkWorld();
  const flee = collect(w, 'leechFlee');
  const e = mkLeech(w);
  stepUntilAttached(w, e);
  e.tethered = true;
  const d0 = e.pos.distanceTo(playerCenter(w));
  step(w, 1.5);
  expect(flee).toHaveLength(1);
  expect(e.ai.armPhase).toBe('none');
  expect(w.player.leeched).toBe(false);
  expect(e.pos.distanceTo(playerCenter(w))).toBeGreaterThan(d0 + 4);
  // ずっと逃げ続ける（合図は1回だけ）
  step(w, 1);
  expect(flee).toHaveLength(1);
});

test('player standing still: a close leech is finished, a far one escapes the tether', () => {
  // つなぎっぱなし（プレイヤーは動かない）で吸い切れるか／距離で切れるかの目安
  const run = (startDist: number) => {
    const w = mkWorld();
    const e = spawnEnemy(w, 'leech', V(0, 1.1, 10 - startDist));
    e.ai.alert = 1e9;
    e.tethered = true;
    const origin = V(0, 1.7, 10);
    let t = 0;
    const dt = 1 / 30;
    while (t < 6 && e.tethered && e.status === 'active') {
      w.time += dt; t += dt;
      updateEnemies(w, dt);
      if (!e.tethered) break;
      drainEnemy(w, e, ABSORB.drainPerSec * dt);
      if (origin.distanceTo(e.pos) > ABSORB.breakDistance) e.tethered = false;
    }
    return { escaped: e.status === 'active', t, dist: origin.distanceTo(e.pos) };
  };
  expect(run(5).escaped).toBe(false);
  expect(run(14).escaped).toBe(true);
});

test('drained to zero by absorb returns the stolen energy', () => {
  const w = mkWorld();
  const e = mkLeech(w);
  e.ai.stolen = 30;
  w.player.energy = 50;
  e.tethered = true;
  drainEnemy(w, e, 1000);
  expect(e.status).toBe('down');
  expect(w.player.energy).toBeCloseTo(80, 5);
  expect(e.ai.stolen).toBe(0);
});

test('killed by a shot loses the stolen energy', () => {
  const w = mkWorld();
  const e = mkLeech(w);
  e.ai.stolen = 30;
  w.player.energy = 50;
  damageEnemy(w, e, 1000, { how: 'shot' });
  expect(e.status).toBe('dead');
  expect(w.player.energy).toBe(50);
});

test('player.leeched is cleared when the leech dies or is removed', () => {
  // 撃破
  let w = mkWorld();
  let e = mkLeech(w);
  stepUntilAttached(w, e);
  expect(w.player.leeched).toBe(true);
  damageEnemy(w, e, 1000, { how: 'shot', weak: true });
  expect(w.player.leeched).toBe(false);
  step(w, 0.5);
  expect(w.enemies).toHaveLength(0);
  expect(w.player.leeched).toBe(false);
  // 吸い切り（つながったまま倒れる）
  w = mkWorld();
  e = mkLeech(w);
  stepUntilAttached(w, e);
  drainEnemy(w, e, 1000);
  expect(w.player.leeched).toBe(false);
  // 腕の見た目も片付く
  const arm = e.ai.arm.group;
  step(w, 5);
  expect(w.enemies).toHaveLength(0);
  expect(w.scene.children.includes(arm)).toBe(false);
});

test('leeched stays true while another leech is still attached', () => {
  const w = mkWorld();
  w.player.energy = 100;
  const a = mkLeech(w, 0);
  const b = mkLeech(w, -2);
  b.pos.x = 3;
  for (let t = 0; t < 4 && !(a.ai.armPhase === 'attached' && b.ai.armPhase === 'attached'); t += 1 / 30) step(w, 1 / 30);
  expect(a.ai.armPhase).toBe('attached');
  expect(b.ai.armPhase).toBe('attached');
  damageEnemy(w, a, 1, { how: 'shot' });
  expect(w.player.leeched).toBe(true);
  damageEnemy(w, b, 1, { how: 'shot' });
  expect(w.player.leeched).toBe(false);
});
