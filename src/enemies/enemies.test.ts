import * as THREE from 'three';
import { createWorld } from '../core/world';
import { EventBus } from '../core/events';
import type { World } from '../core/types';
import { ENEMIES, BOSS, OVERLOAD } from '../config/balance';
import { makeAABB } from '../core/collision';
import { spawnEnemy, updateEnemies, damageEnemy, drainEnemy, overloadEnemy } from './enemies';
import { isTargetable } from '../core/enemyUtil';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mkWorld(): World {
  const w = createWorld({} as any, new EventBus(), 1);
  w.state = 'playing';
  w.player.pos.set(0, 0, 20);
  w.colliders.push(makeAABB(V(-50, -1, -50), V(50, 0, 50), 'floor'));
  return w;
}
function collect(w: World, name: any): any[] {
  const l: any[] = [];
  w.events.on(name, (p: any) => l.push(p));
  return l;
}

test('weak multiplier is applied', () => {
  const w = mkWorld();
  const e = spawnEnemy(w, 'drone', V(0, 3, 0));
  damageEnemy(w, e, 5, { how: 'shot' });
  expect(e.hp).toBeCloseTo(25);
  damageEnemy(w, e, 5, { how: 'shot', weak: true });
  expect(e.hp).toBeCloseTo(25 - 5 * ENEMIES.drone.weakMultiplier);
});

test('shot kill emits event and removes enemy', () => {
  const w = mkWorld();
  const killed = collect(w, 'enemyKilled');
  const hits = collect(w, 'enemyHit');
  const e = spawnEnemy(w, 'drone', V(0, 3, 0));
  damageEnemy(w, e, 100, { how: 'shot', weak: true });
  expect(e.status).toBe('dead');
  expect(isTargetable(e)).toBe(false);
  expect(killed).toHaveLength(1);
  expect(killed[0].how).toBe('shot');
  expect(hits).toHaveLength(1);
  expect(hits[0].weak).toBe(true);
  expect(w.stats.kills).toBe(1);
  updateEnemies(w, 0.1);
  expect(w.enemies).toHaveLength(0);
  expect(w.scene.children.includes(e.root)).toBe(false);
});

test('drain returns actual amount and downs the enemy', () => {
  const w = mkWorld();
  const killed = collect(w, 'enemyKilled');
  const e = spawnEnemy(w, 'crawler', V(0, 1, 0));
  expect(drainEnemy(w, e, 15)).toBeCloseTo(15);
  expect(e.hp).toBeCloseTo(25);
  expect(drainEnemy(w, e, 100)).toBeCloseTo(25);
  expect(e.status).toBe('down');
  expect(isTargetable(e)).toBe(false);
  expect(killed[0].how).toBe('absorb');
  expect(w.stats.kills).toBe(1);
  expect(drainEnemy(w, e, 10)).toBe(0);
  // しばらく残ってから消える
  updateEnemies(w, 1);
  expect(w.enemies).toHaveLength(1);
  for (let i = 0; i < 6; i++) updateEnemies(w, 1);
  expect(w.enemies).toHaveLength(0);
});

test('boss drain stops at 20% HP', () => {
  const w = mkWorld();
  const b = spawnEnemy(w, 'boss', V(0, 4, 0));
  const got = drainEnemy(w, b, 10000);
  expect(got).toBeCloseTo(ENEMIES.boss.hp * 0.8);
  expect(b.hp).toBeCloseTo(ENEMIES.boss.hp * 0.2);
  expect(b.status).toBe('active');
  expect(drainEnemy(w, b, 10)).toBe(0);
});

test('overload explodes normal enemies and damages neighbours', () => {
  const w = mkWorld();
  const expl = collect(w, 'explosion');
  const killed = collect(w, 'enemyKilled');
  const a = spawnEnemy(w, 'drone', V(0, 3, 0));
  const near = spawnEnemy(w, 'gunner', V(3, 0.7, 0));
  const far = spawnEnemy(w, 'gunner', V(20, 0.7, 0));
  const cap = ENEMIES.drone.overloadCap;
  expect(overloadEnemy(w, a, cap - 1)).toBe('none');
  expect(a.status).toBe('active');
  expect(overloadEnemy(w, a, 2)).toBe('exploded');
  expect(a.status).toBe('dead');
  expect(expl).toHaveLength(1);
  expect(expl[0].radius).toBe(OVERLOAD.explosionRadius);
  expect(killed[0].how).toBe('explosion');
  expect(w.stats.explosions).toBe(1);
  expect(near.hp).toBeLessThan(ENEMIES.gunner.hp);
  expect(far.hp).toBe(ENEMIES.gunner.hp);
  expect(w.stats.kills).toBe(1);
});

test('explosion hurts the player only when close', () => {
  const w = mkWorld();
  w.player.pos.set(1, 0, 0);
  const a = spawnEnemy(w, 'drone', V(0, 1, 0));
  overloadEnemy(w, a, 100);
  expect(w.player.hp).toBe(w.player.maxHp - OVERLOAD.selfDamage);
  const w2 = mkWorld();
  const b = spawnEnemy(w2, 'drone', V(0, 1, 0));
  overloadEnemy(w2, b, 100);
  expect(w2.player.hp).toBe(w2.player.maxHp);
});

test('boss shorts instead of exploding, takes more damage while stunned', () => {
  const w = mkWorld();
  const shorts = collect(w, 'bossShort');
  const b = spawnEnemy(w, 'boss', V(0, 4, 0));
  expect(overloadEnemy(w, b, 1000)).toBe('shorted');
  expect(b.status).toBe('stunned');
  expect(b.overload).toBe(0);
  expect(b.hp).toBeCloseTo(ENEMIES.boss.hp - BOSS.shortDamage);
  expect(shorts).toHaveLength(1);
  expect(b.weakPoints[0].exposed).toBe(true);
  const hp = b.hp;
  damageEnemy(w, b, 10, { how: 'shot' });
  expect(b.hp).toBeCloseTo(hp - 15);
  // スタン終了
  for (let i = 0; i < 50; i++) { w.time += 0.1; updateEnemies(w, 0.1); }
  expect(b.status).toBe('active');
});

test('overload decays when reverse flow stops', () => {
  const w = mkWorld();
  const e = spawnEnemy(w, 'heavy', V(0, 1.2, 0));
  overloadEnemy(w, e, 20);
  for (let i = 0; i < 10; i++) { w.time += 0.1; updateEnemies(w, 0.1); }
  expect(e.overload).toBeLessThan(20);
  expect(e.overload).toBeGreaterThan(0);
});

test('boss phase 2 fires once at 50% HP', () => {
  const w = mkWorld();
  const ph = collect(w, 'bossPhase');
  const b = spawnEnemy(w, 'boss', V(0, 4, 0));
  damageEnemy(w, b, 440, { how: 'shot' });
  expect(ph).toHaveLength(0);
  damageEnemy(w, b, 20, { how: 'shot' });
  damageEnemy(w, b, 20, { how: 'shot' });
  expect(ph).toHaveLength(1);
  expect(ph[0].phase).toBe(2);
});

test('boss death does not set bossDefeated and cleans up', () => {
  const w = mkWorld();
  const b = spawnEnemy(w, 'boss', V(0, 4, 0));
  damageEnemy(w, b, 99999, { how: 'shot' });
  expect(w.level.bossDefeated).toBe(false);
  for (let i = 0; i < 40; i++) { w.time += 0.1; updateEnemies(w, 0.1); }
  expect(w.enemies).toHaveLength(0);
});

test('ground enemies settle on the floor and drones chase', () => {
  const w = mkWorld();
  const g = spawnEnemy(w, 'gunner', V(0, 3, 0));
  for (let i = 0; i < 120; i++) { w.time += 1 / 60; updateEnemies(w, 1 / 60); }
  expect(g.pos.y).toBeCloseTo(ENEMIES.gunner.radius, 1);
});

test('crawler approaches and hits the player', () => {
  const w = mkWorld();
  w.player.pos.set(0, 0, 8);
  const c = spawnEnemy(w, 'crawler', V(0, 0.6, 0));
  for (let i = 0; i < 60 * 4; i++) { w.time += 1 / 60; updateEnemies(w, 1 / 60); w.player.invuln = Math.max(0, w.player.invuln - 1 / 60); }
  expect(w.player.hp).toBeLessThan(w.player.maxHp);
  expect(c.status).toBe('active');
});
