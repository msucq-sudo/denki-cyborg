import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorld } from '../../core/world';
import { EventBus } from '../../core/events';
import { makeAABB } from '../../core/collision';
import type { Enemy, World } from '../../core/types';
import { ENEMIES, HACK } from '../../config/balance';
import { spawnEnemy, updateEnemies } from '../enemies';
import { KIND_MODULES } from '.';
import { REDWALKER_ALLY } from './redWalker';

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

function ally(pos = V(0, 0.7, 0)): Enemy {
  const e = spawnEnemy(world, 'redWalker', pos);
  e.allied = true;
  e.ai.allyT = HACK.allyTime;
  e.ai.allyMax = HACK.allyTime;
  return e;
}

describe('redWalker', () => {
  it('is registered as hackable with an ally AI, and has a beacon part', () => {
    const m = KIND_MODULES.redWalker!;
    expect(m.hackable).toBe(true);
    expect(typeof m.updateAlly).toBe('function');
    const e = spawnEnemy(world, 'redWalker', V(0, 0.7, 0));
    expect(e.ai.model.parts.beacon).toBeTruthy();
    expect(e.ai.model.weakPoints).toHaveLength(1);
  });

  it('rolls at the player and shoots like a walker', () => {
    world.player.pos.set(0, 0, 14);
    const e = spawnEnemy(world, 'redWalker', V(0, 0.7, 0));
    e.ai.alert = 4;
    run(1);
    expect(e.pos.z).toBeGreaterThan(0.5); // 前進する
    run(4);
    expect(world.projectiles.some((p) => p.owner === 'enemy')).toBe(true);
  });

  it('is slowed while tethered', () => {
    const free = spawnEnemy(world, 'redWalker', V(-20, 0.7, 0));
    const held = spawnEnemy(world, 'redWalker', V(20, 0.7, 0));
    world.player.pos.set(0, 0, 40);
    free.ai.alert = 4; held.ai.alert = 4;
    held.tethered = true;
    run(1.5);
    const dFree = free.pos.z, dHeld = held.pos.z;
    expect(dFree).toBeGreaterThan(1);
    expect(dHeld).toBeLessThan(dFree * (HACK.jamSpeedMul + 0.25));
    expect(dHeld).toBeGreaterThan(0);
  });

  it('as an ally shoots the nearest enemy, tints blue, and keeps its weapon off the player', () => {
    const a = ally();
    const foe = spawnEnemy(world, 'heavy', V(0, 1, -10));
    const hp0 = foe.hp;
    world.player.pos.set(0, 0, 12);
    const hits: number[] = [];
    world.events.on('enemyHit', (p) => hits.push(p.damage));
    run(0.5);
    expect(a.ai.allyTarget).toBe(foe); // 視界内の敵を標的にして、そちらへ転がる
    expect(a.pos.z).toBeLessThan(0);
    run(4.5);
    expect(foe.hp).toBeLessThan(hp0);
    expect(hits.length).toBeGreaterThan(0);
    expect(world.player.hp).toBe(world.player.maxHp);
    // 見た目：赤 → 青緑
    const base = a.ai.model.bodyMats[0].base as THREE.Color;
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    expect(hsl.h).toBeGreaterThan(0.45);
    expect(hsl.h).toBeLessThan(0.7);
  });

  it('does not shoot through walls', () => {
    ally();
    const foe = spawnEnemy(world, 'heavy', V(0, 1, -10));
    world.colliders.push(makeAABB(V(-30, 0, -6.2), V(30, 8, -5.8)));
    world.player.pos.set(0, 0, 12);
    const hp0 = foe.hp;
    run(4);
    expect(foe.hp).toBe(hp0);
  });

  it('follows the player when there is nothing to shoot', () => {
    const a = ally(V(0, 0.7, 0));
    world.player.pos.set(0, 0, -25);
    run(4);
    expect(a.pos.z).toBeLessThan(-3);
  });

  it('shuts down after allyTime without counting as a kill, and cleans up its bolts', () => {
    const a = ally();
    const foe = spawnEnemy(world, 'heavy', V(0, 1, -10));
    foe.hp = foe.maxHp = 1e6; // 倒れない的（撃破数に混ざらないように）
    world.player.pos.set(0, 0, 12);
    const expired: any[] = [], killed: any[] = [];
    world.events.on('allyExpire', (p) => expired.push(p));
    world.events.on('enemyKilled', (p) => killed.push(p));
    run(HACK.allyTime - 1);
    expect(a.status).toBe('active');
    expect(a.ai.allyT).toBeGreaterThan(0);
    run(2);
    expect(expired).toHaveLength(1);
    expect(a.status).not.toBe('active');
    expect(killed.filter((k) => k.kind === 'redWalker')).toHaveLength(0);
    expect(world.stats.kills).toBe(0);
    expect((a.ai.bolts ?? []).length).toBe(0);
    // 崩れ落ちたあと、ワールドから消える
    run(6);
    expect(world.enemies.includes(a)).toBe(false);
    expect(ENEMIES.redWalker.hp).toBeGreaterThan(0);
    expect(REDWALKER_ALLY.interval).toBeGreaterThan(0);
  });
});
