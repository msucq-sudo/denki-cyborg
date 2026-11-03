import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorld } from '../../core/world';
import { EventBus } from '../../core/events';
import { makeAABB } from '../../core/collision';
import type { Enemy, World } from '../../core/types';
import { HACK, PLAYER } from '../../config/balance';
import { spawnEnemy, updateEnemies } from '../enemies';
import { KIND_MODULES } from '.';
import { REDDRONE_ALLY } from './redDrone';

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

  it('stays still and never shoots while an enemy (even when alerted or tethered)', () => {
    world.player.pos.set(0, 0, 20);
    const e = spawnEnemy(world, 'redDrone', V(0, 2, 0));
    e.ai.alert = 4;
    run(1.5);
    e.tethered = true;
    run(6);
    expect(e.pos.z).toBeCloseTo(0, 5);
    expect(e.pos.x).toBeCloseTo(0, 5);
    expect(world.projectiles.some((p) => p.owner === 'enemy')).toBe(false);
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

  it('follows behind a running player and catches up when there is no enemy', () => {
    const a = ally(V(0, 2, 0));
    const dt = 1 / 30;
    world.player.pos.set(0, 0, 0);
    for (let i = 0; i < 5 * 30; i++) {
      world.player.vel.set(0, 0, -PLAYER.moveSpeed);
      world.player.pos.z -= PLAYER.moveSpeed * dt;
      world.time += dt;
      updateEnemies(world, dt);
    }
    const horizontalGap = Math.hypot(a.pos.x - world.player.pos.x, a.pos.z - world.player.pos.z);
    expect(horizontalGap).toBeLessThan(8);
    expect(a.pos.z).toBeGreaterThan(world.player.pos.z + 1); // プレイヤーの後ろ
  });

  it('regroups at the player height after a vertical climb and return', () => {
    const a = ally(V(0, 2, 0));
    world.player.pos.set(0, 0, 0);
    run(0.1);

    world.player.pos.set(0, 6, 0);
    run(4);
    expect(Math.abs(a.pos.y - (world.player.pos.y + PLAYER.height * 0.5 + REDDRONE_ALLY.hoverHeight))).toBeLessThan(1.5);

    world.player.pos.set(0, 0, 0);
    run(4);
    expect(Math.abs(a.pos.y - (world.player.pos.y + PLAYER.height * 0.5 + REDDRONE_ALLY.hoverHeight))).toBeLessThan(1.5);
  });

  it('stays with the newest route around a crate when the player reverses', () => {
    const a = ally(V(-3, 2.4, 0));
    world.player.pos.set(0, 0, 0);
    world.colliders.push(makeAABB(V(-1, 0, -6), V(1, 4, -4)));
    const dt = 1 / 30;
    const route: Array<[number, number]> = [[4, 0], [4, -10], [-4, -10], [-4, 0], [4, 0], [4, -10], [-4, -10]];
    let maxGap = 0;
    for (const [x, z] of route) {
      for (let i = 0; i < 800; i++) {
        const dx = x - world.player.pos.x, dz = z - world.player.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.25) break;
        const speed = Math.min(PLAYER.moveSpeed, d * 30);
        world.player.vel.set(dx / d * speed, 0, dz / d * speed);
        world.player.pos.x += world.player.vel.x * dt;
        world.player.pos.z += world.player.vel.z * dt;
        world.time += dt;
        updateEnemies(world, dt);
        maxGap = Math.max(maxGap, Math.hypot(a.pos.x - world.player.pos.x, a.pos.z - world.player.pos.z));
      }
    }
    expect(maxGap).toBeLessThan(14);
    expect(Math.hypot(a.pos.x - world.player.pos.x, a.pos.z - world.player.pos.z)).toBeLessThan(8);
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
