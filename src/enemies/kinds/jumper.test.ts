import * as THREE from 'three';
import { createWorld } from '../../core/world';
import { EventBus } from '../../core/events';
import type { World, Enemy } from '../../core/types';
import { ENEMIES } from '../../config/balance';
import { makeAABB } from '../../core/collision';
import { spawnEnemy, updateEnemies, damageEnemy, drainEnemy } from '../enemies';
import { JUMPER } from './jumper';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mkWorld(): World {
  const w = createWorld({} as any, new EventBus(), 1);
  w.state = 'playing';
  w.player.pos.set(0, 0, 15);
  w.colliders.push(makeAABB(V(-80, -1, -80), V(80, 0, 80), 'floor'));
  return w;
}
function tick(w: World, dt = 1 / 30): void { w.time += dt; updateEnemies(w, dt); }
function step(w: World, sec: number, dt = 1 / 30): void { for (let t = 0; t < sec; t += dt) tick(w, dt); }
/** 条件が成り立つまで進める（最大 maxSec）。成り立てば true */
function until(w: World, cond: () => boolean, maxSec = 12): boolean {
  for (let t = 0; t < maxSec; t += 1 / 30) { if (cond()) return true; tick(w); }
  return cond();
}
function mk(playerZ: number): { w: World; e: Enemy } {
  const w = mkWorld();
  w.player.pos.set(0, 0, playerZ);
  const e = spawnEnemy(w, 'jumper', V(0, ENEMIES.jumper.radius, 0));
  e.ai.yaw = 0; // +z（プレイヤーの方）を向く
  return { w, e };
}
const dist2d = (w: World, e: Enemy) => Math.hypot(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z);

test('closed head (idle or mid-air): shots bounce, absorb drains nothing, weak point not exposed', () => {
  const { w, e } = mk(15);
  const blocks: any[] = [];
  w.events.on('shieldBlock', (p: any) => blocks.push(p));
  step(w, 0.2);
  expect(e.ai.state).toBe('idle');
  expect(e.shielded).toBe(true);
  expect(e.weakPoints[0].exposed).toBe(false);
  damageEnemy(w, e, 50, { how: 'shot', weak: true });
  expect(e.hp).toBe(ENEMIES.jumper.hp);
  expect(blocks.length).toBe(1);
  expect(drainEnemy(w, e, 10)).toBe(0);
  // 跳んでいる間も閉じている
  e.ai.alert = 100;
  expect(until(w, () => e.ai.state === 'air')).toBe(true);
  step(w, 0.4);
  expect(e.ai.state).toBe('air');
  expect(e.pos.y).toBeGreaterThan(ENEMIES.jumper.radius + 0.5);
  expect(e.shielded).toBe(true);
  expect(e.weakPoints[0].exposed).toBe(false);
  damageEnemy(w, e, 50, { how: 'shot', weak: true });
  expect(e.hp).toBe(ENEMIES.jumper.hp);
  expect(drainEnemy(w, e, 10)).toBe(0);
});

test('after landing the head opens: weak point exposed, damage and drain work, then it closes again', () => {
  const { w, e } = mk(15);
  e.ai.alert = 100;
  expect(until(w, () => e.ai.state === 'air')).toBe(true);
  expect(until(w, () => e.ai.state === 'open')).toBe(true);
  step(w, 0.3);
  expect(e.shielded).toBe(false);
  expect(e.weakPoints[0].exposed).toBe(true);
  const hp0 = e.hp;
  damageEnemy(w, e, 10, { how: 'shot', weak: true });
  expect(hp0 - e.hp).toBeCloseTo(10 * ENEMIES.jumper.weakMultiplier, 5);
  expect(drainEnemy(w, e, 5)).toBeGreaterThan(0);
  // 開いている時間は十分長い
  const openStart = w.time;
  expect(until(w, () => e.ai.state === 'crouch')).toBe(true);
  expect(w.time - openStart).toBeGreaterThan(JUMPER.minOpen - 0.4);
  step(w, 0.3);
  expect(e.shielded).toBe(true);
  expect(e.weakPoints[0].exposed).toBe(false);
});

test('thrust at landing hurts a player standing in front, not one still far away', () => {
  // 着地点のねらい（landGap）ちょうどに立つ → 跳ばずその場で着地 → 正面に突き
  {
    const { w, e } = mk(JUMPER.landGap);
    e.ai.alert = 100;
    const attacks: any[] = [];
    w.events.on('enemyAttack', (p: any) => attacks.push(p));
    const hp0 = w.player.hp;
    expect(until(w, () => e.ai.state === 'open' && e.ai.thrustDone === true)).toBe(true);
    expect(attacks.length).toBe(1);
    expect(attacks[0].kind).toBe('jumper');
    expect(w.player.hp).toBe(hp0 - ENEMIES.jumper.damage);
    // 真上には降りない（その場で跳んでもプレイヤーと重ならない）
    expect(dist2d(w, e)).toBeGreaterThan(1.5);
  }
  // まだ遠い位置での着地では当たらない
  {
    const { w, e } = mk(30);
    e.ai.alert = 100;
    const hp0 = w.player.hp;
    expect(until(w, () => e.ai.state === 'open' && e.ai.thrustDone === true)).toBe(true);
    expect(w.player.hp).toBe(hp0);
  }
});

test('advances toward the player hop by hop and keeps a gap (never lands on top)', () => {
  const { w, e } = mk(16);
  e.ai.alert = 100;
  const d0 = dist2d(w, e);
  let landings = 0;
  let prev = e.ai.state;
  const dists: number[] = [];
  for (let t = 0; t < 30; t += 1 / 30) {
    tick(w);
    w.player.hp = w.player.maxHp; w.player.invuln = 0;
    if (prev === 'air' && e.ai.state === 'open') { landings++; dists.push(dist2d(w, e)); }
    prev = e.ai.state;
  }
  expect(landings).toBeGreaterThanOrEqual(4);
  expect(dists[0]).toBeLessThan(d0 - 2);
  // 1回の跳躍で進む距離は数メートル（速度上限 × 滞空）
  expect(d0 - dists[0]).toBeLessThanOrEqual(ENEMIES.jumper.speed * ((2 * JUMPER.jumpSpeed) / JUMPER.gravity) + 0.5);
  for (let i = 1; i < dists.length; i++) expect(dists[i]).toBeLessThanOrEqual(dists[i - 1] + 0.3);
  expect(Math.min(...dists)).toBeGreaterThan(JUMPER.landGap - 0.6);
  expect(dists[dists.length - 1]).toBeLessThan(JUMPER.landGap + 0.8);
});

test('not alerted: stays put with the head closed', () => {
  const { w, e } = mk(60);
  step(w, 4);
  expect(e.ai.state).toBe('idle');
  expect(Math.hypot(e.pos.x, e.pos.z)).toBeLessThan(0.01);
  expect(e.shielded).toBe(true);
});
