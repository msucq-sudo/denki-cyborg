import * as THREE from 'three';
import { createWorld } from '../../core/world';
import { EventBus } from '../../core/events';
import type { World } from '../../core/types';
import { ENEMIES } from '../../config/balance';
import { makeAABB } from '../../core/collision';
import { spawnEnemy, updateEnemies, damageEnemy } from '../enemies';
import { spawnProjectile, updateProjectiles } from '../../core/projectiles';
import { MISSILE_BOT } from './missileBot';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mkWorld(): World {
  const w = createWorld({} as any, new EventBus(), 1);
  w.state = 'playing';
  w.player.pos.set(0, 0, 15);
  w.colliders.push(makeAABB(V(-80, -1, -80), V(80, 0, 80), 'floor'));
  return w;
}
function step(w: World, sec: number, dt = 1 / 30): void {
  for (let t = 0; t < sec; t += dt) { w.time += dt; updateEnemies(w, dt); updateProjectiles(w, dt); }
}

test('charge fills over attackInterval', () => {
  const w = mkWorld();
  const e = spawnEnemy(w, 'missile', V(0, 1.1, 0));
  e.ai.alert = 100;
  step(w, ENEMIES.missile.attackInterval * 0.5);
  expect(e.ai.charge).toBeGreaterThan(0.4);
  expect(e.ai.charge).toBeLessThan(0.6);
  // 護衛を召喚している
  expect(e.ai.escorts.length).toBeGreaterThan(0);
});

test('damage burst disrupts charge, tether pauses it', () => {
  const w = mkWorld();
  const e = spawnEnemy(w, 'missile', V(0, 1.1, 0));
  e.ai.alert = 100;
  step(w, 3);
  const before = e.ai.charge;
  expect(before).toBeGreaterThan(0.3);
  damageEnemy(w, e, MISSILE_BOT.disruptDamage + 1, { how: 'shot' });
  step(w, 1 / 30);
  expect(e.ai.charge).toBeLessThan(before - MISSILE_BOT.disruptCharge + 0.05);
  expect(e.ai.stunC).toBeGreaterThan(0);
  // 吸収中は止まる
  step(w, 1);
  e.tethered = true;
  const c0 = e.ai.charge;
  step(w, 1);
  expect(e.ai.charge).toBeCloseTo(c0, 5);
});

test('full charge fires a volley of shootable missiles', () => {
  const w = mkWorld();
  const e = spawnEnemy(w, 'missile', V(0, 1.1, 0));
  e.ai.alert = 100;
  e.ai.charge = 0.999;
  step(w, 1.3);
  const ms = w.projectiles.filter((p) => p.shootable);
  expect(ms.length).toBe(MISSILE_BOT.missiles);
  expect(ms[0].damage).toBe(ENEMIES.missile.damage);
  expect(e.ai.charge).toBeLessThan(0.2);
});

test('player bullet shoots down a missile', () => {
  const w = mkWorld();
  const m = spawnProjectile(w, {
    pos: V(0, 5, 0), vel: V(0, 0, 0), damage: 16, owner: 'enemy', radius: 0.35, size: 0.3,
    missile: true, shootable: true, hp: 15,
  });
  spawnProjectile(w, { pos: V(0, 5, 5), vel: V(0, 0, -30), damage: 20, owner: 'player' });
  updateProjectiles(w, 0.2);
  expect(m.dead).toBe(true);
  expect(w.projectiles.length).toBe(0);
});
