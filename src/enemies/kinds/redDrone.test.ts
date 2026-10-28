import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorld } from '../../core/world';
import { EventBus } from '../../core/events';
import { makeAABB } from '../../core/collision';
import type { Enemy, World } from '../../core/types';
import { HACK } from '../../config/balance';
import { spawnEnemy, updateEnemies } from '../enemies';
import { KIND_MODULES } from '.';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

let world: World;

beforeEach(() => {
  world = createWorld({ pressed: () => false, isDown: () => false } as never, new EventBus(), 1.6);
  world.state = 'playing';
  world.player.pos.set(0, 0, 30);
  world.colliders.push(makeAABB(V(-80, -1, -80), V(80, 0, 80), 'floor'));
});

function run(sec: number, dt = 1 / 30): void {
  for (let i = 0; i < Math.round(sec / dt); i++) { world.time += dt; updateEnemies(world, dt); }
}

function ally(pos = V(0, 2, 0)): Enemy {
  const e = spawnEnemy(world, 'redDrone', pos);
  e.allied = true;
  e.ai.allyT = HACK.allyTime;
  e.ai.allyMax = HACK.allyTime;
  return e;
}

describe('redDrone', () => {
  it('is registered as a hackable flyer with an ally AI, and has the hack cue parts', () => {
    const m = KIND_MODULES.redDrone!;
    expect(m.hackable).toBe(true);
    expect(m.flying).toBe(true);
    expect(typeof m.updateAlly).toBe('function');
    const e = spawnEnemy(world, 'redDrone', V(0, 2, 0));
    expect(e.ai.model.parts.beacon).toBeTruthy();
    expect(e.ai.model.parts.ring).toBeTruthy();
    expect(e.ai.model.weakPoints).toHaveLength(1);
  });

  it('behaves like a drone: closes in and shoots', () => {
    world.player.pos.set(0, 0, 20);
    const e = spawnEnemy(world, 'redDrone', V(0, 2, 0));
    e.ai.alert = 4;
    run(1.5);
    expect(e.pos.z).toBeGreaterThan(1);
    run(6);
    expect(world.projectiles.some((p) => p.owner === 'enemy')).toBe(true);
  });

  it('is slower while tethered', () => {
    world.player.pos.set(0, 0, 60);
    const free = spawnEnemy(world, 'redDrone', V(-30, 2, 0));
    const held = spawnEnemy(world, 'redDrone', V(30, 2, 0));
    free.ai.alert = 4; held.ai.alert = 4;
    held.tethered = true;
    run(2);
    expect(free.pos.z).toBeGreaterThan(2);
    expect(held.pos.z).toBeGreaterThan(0);
    expect(held.pos.z).toBeLessThan(free.pos.z * (HACK.jamSpeedMul + 0.3));
  });

  it('as an ally flies near the player, shoots the nearest enemy, and tints blue', () => {
    const a = ally(V(0, 2, 0));
    a.ai.atkTimer = 3.5; // 敵だったときの長い間隔が残っていても、すぐ撃ち始める
    const foe = spawnEnemy(world, 'heavy', V(8, 1, -12));
    foe.hp = foe.maxHp = 1e6;
    world.player.pos.set(0, 0, 14);
    run(0.5);
    expect(a.ai.allyTarget).toBe(foe);
    run(4);
    expect(foe.hp).toBeLessThan(foe.maxHp);
    // プレイヤーのまわりへ追いつく（最初は14m離れていた）
    expect(a.pos.distanceTo(world.player.pos)).toBeLessThan(9);
    expect(world.player.hp).toBe(world.player.maxHp);
    const hsl = { h: 0, s: 0, l: 0 };
    (a.ai.model.bodyMats[0].base as THREE.Color).getHSL(hsl);
    expect(hsl.h).toBeGreaterThan(0.45);
    expect(hsl.h).toBeLessThan(0.7);
  });

  it('does not shoot through walls', () => {
    ally(V(0, 2, 0));
    const foe = spawnEnemy(world, 'heavy', V(0, 1, -10));
    foe.hp = foe.maxHp = 1e6;
    world.colliders.push(makeAABB(V(-30, 0, -6.2), V(30, 12, -5.8)));
    world.player.pos.set(0, 0, 6);
    run(4);
    expect(foe.hp).toBe(foe.maxHp);
  });

  it('shuts down after allyTime without counting as a kill, and cleans up its bolts', () => {
    const a = ally();
    const foe = spawnEnemy(world, 'heavy', V(0, 1, -10));
    foe.hp = foe.maxHp = 1e6;
    world.player.pos.set(0, 0, 8);
    const expired: any[] = [], killed: any[] = [];
    world.events.on('allyExpire', (p) => expired.push(p));
    world.events.on('enemyKilled', (p) => killed.push(p));
    run(HACK.allyTime - 1);
    expect(a.status).toBe('active');
    run(2);
    expect(expired).toHaveLength(1);
    expect(a.status).not.toBe('active');
    expect(killed.filter((k) => k.kind === 'redDrone')).toHaveLength(0);
    expect(world.stats.kills).toBe(0);
    expect((a.ai.bolts ?? []).length).toBe(0);
    run(6);
    expect(world.enemies.includes(a)).toBe(false);
  });
});
