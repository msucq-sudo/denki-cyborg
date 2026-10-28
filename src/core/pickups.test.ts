import * as THREE from 'three';
import { createWorld } from './world';
import { EventBus } from './events';
import { makeAABB } from './collision';
import { METAL } from '../config/balance';
import { spawnEnemy, damageEnemy } from '../enemies/enemies';
import { updatePickups } from './pickups';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mkWorld() {
  const w = createWorld({} as any, new EventBus(), 1);
  w.state = 'playing';
  w.colliders.push(makeAABB(V(-50, -1, -50), V(50, 0, 50), 'floor'));
  return w;
}

test('killing an enemy drops metal worth its table value; strong enemies drop more', () => {
  const w = mkWorld();
  w.player.pos.set(0, 0, 40); // 遠く（吸い寄せられない）
  const c = spawnEnemy(w, 'crawler', V(0, 0.7, 0));
  damageEnemy(w, c, 999, { how: 'shot' });
  const sum = () => w.drops.reduce((s, d) => s + d.value, 0);
  expect(sum()).toBe(METAL.drop.crawler);
  const h = spawnEnemy(w, 'heavy', V(5, 1.2, 0));
  damageEnemy(w, h, 9999, { how: 'shot' });
  expect(sum()).toBe(METAL.drop.crawler + METAL.drop.heavy);
  expect(METAL.drop.heavy).toBeGreaterThan(METAL.drop.crawler);
  // 床で止まる
  for (let i = 0; i < 120; i++) updatePickups(w, 1 / 30);
  for (const d of w.drops) expect(d.pos.y).toBeGreaterThan(-0.05);
});

test('overload-explosion kills drop METAL.overloadMul times the metal', async () => {
  const { overloadEnemy } = await import('../enemies/enemies');
  const w = mkWorld();
  w.player.pos.set(0, 0, 40);
  const c = spawnEnemy(w, 'walker', V(0, 0.8, 0));
  overloadEnemy(w, c, 9999);
  const sum = w.drops.reduce((s, d) => s + d.value, 0);
  expect(sum).toBe(Math.round(METAL.drop.walker * METAL.overloadMul));
});

test('auto-aim is locked until unlocked', async () => {
  const w = mkWorld();
  expect(w.unlocks.autoAim).toBe(false);
});

test('walking near the metal pulls it in and adds it to the inventory', () => {
  const w = mkWorld();
  w.player.pos.set(0, 0, 40);
  const picked: number[] = [];
  w.events.on('metalPickup', (p) => picked.push(p.amount));
  const g = spawnEnemy(w, 'gunner', V(0, 0.7, 0));
  damageEnemy(w, g, 999, { how: 'shot' });
  for (let i = 0; i < 60; i++) updatePickups(w, 1 / 30);
  expect(w.inventory.metal).toBe(0);
  w.player.pos.set(1, 0, 1);
  for (let i = 0; i < 90; i++) updatePickups(w, 1 / 30);
  expect(w.inventory.metal).toBe(METAL.drop.gunner);
  expect(w.drops.length).toBe(0);
  expect(picked.reduce((a, b) => a + b, 0)).toBe(METAL.drop.gunner);
});
