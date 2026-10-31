// ドーマー・赤クローラー・リンガー・メディックのテスト
import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorld } from '../../core/world';
import { EventBus } from '../../core/events';
import { makeAABB } from '../../core/collision';
import { updateEffects } from '../../core/effects';
import { spawnProjectile, updateProjectiles } from '../../core/projectiles';
import type { Enemy, World } from '../../core/types';
import { ENEMIES, HACK } from '../../config/balance';
import { spawnEnemy, updateEnemies } from '../enemies';
import { damageBarrier, hitBarriers, isBarrierProtected } from '../barrier';
import { KIND_MODULES } from '.';
import { MEDIC } from './medic';
import { DOMER } from './domer';
import { RINGER, spawnRingBeam } from './ringer';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

let world: World;

beforeEach(() => {
  world = createWorld({ pressed: () => false, isDown: () => false } as never, new EventBus(), 1.6);
  world.state = 'playing';
  world.player.pos.set(0, 0, 30);
  world.colliders.push(makeAABB(V(-80, -1, -80), V(80, 0, 80), 'floor'));
});

function run(sec: number, dt = 1 / 30): void {
  for (let i = 0; i < Math.round(sec / dt); i++) {
    world.time += dt;
    updateEnemies(world, dt);
    updateProjectiles(world, dt);
    updateEffects(world, dt);
  }
}

function collect(name: any): any[] {
  const l: any[] = [];
  world.events.on(name, (p: any) => l.push(p));
  return l;
}

describe('domer', () => {
  function deployed(): Enemy {
    world.player.pos.set(0, 0, 14);
    const e = spawnEnemy(world, 'domer', V(0, ENEMIES.domer.radius, 0));
    e.ai.alert = 4;
    run(2);
    return e;
  }

  it('deploys a dome after noticing the player', () => {
    const e = deployed();
    expect(e.barrier).toBeTruthy();
    expect(e.barrier!.k).toBe(1);
    expect(e.barrier!.hp).toBe(DOMER.domeHp);
  });

  it('stops player shots from outside and takes the damage on the dome', () => {
    const e = deployed();
    const hp = e.hp;
    spawnProjectile(world, { pos: V(0, 1, 12), vel: V(0, 0, -40), damage: 10, owner: 'player', life: 2 });
    run(0.5);
    expect(e.barrier!.hp).toBeLessThan(DOMER.domeHp);
    expect(e.hp).toBe(hp);
  });

  it('lets shots fired from inside the dome reach the domer', () => {
    const e = deployed();
    const dome = e.barrier!.hp;
    spawnProjectile(world, { pos: V(0, 1, 3), vel: V(0, 0, -40), damage: 10, owner: 'player', life: 2 });
    run(0.3);
    expect(e.hp).toBeLessThan(ENEMIES.domer.hp);
    expect(e.barrier!.hp).toBe(dome);
  });

  it('does not block enemy shots (the domer shoots through its own dome)', () => {
    deployed();
    world.player.hp = world.player.maxHp;
    run(6);
    expect(world.player.hp).toBeLessThan(world.player.maxHp);
  });

  it('flags enemies inside the dome as protected from outside only', () => {
    const e = deployed();
    const ally = spawnEnemy(world, 'walker', V(1, 0.7, 1));
    expect(isBarrierProtected(world, ally, V(0, 1, 14))).toBe(true);
    expect(isBarrierProtected(world, ally, V(0, 1, 2))).toBe(false);
    expect(e.barrier!.hp).toBeGreaterThan(0);
  });

  it('breaks, stuns its owner, then redeploys after a while', () => {
    const e = deployed();
    damageBarrier(world, e, 999, V(0, 1, 4));
    expect(e.barrier!.hp).toBe(0);
    run(0.1);
    expect(e.status).toBe('stunned');
    run(3);
    expect(e.status).toBe('active');
    expect(e.barrier!.hp).toBe(0);
    run(DOMER.redeployCd + 3);
    expect(e.barrier!.hp).toBeGreaterThan(0);
  });

  it('stops blocking once its owner goes down', () => {
    const e = deployed();
    expect(hitBarriers(world, V(0, 1, 12), V(0, 1, 2))).not.toBeNull();
    e.status = 'down';
    expect(hitBarriers(world, V(0, 1, 12), V(0, 1, 2))).toBeNull();
  });
});

describe('redCrawler', () => {
  it('is hackable and has the hack cue', () => {
    expect(KIND_MODULES.redCrawler!.hackable).toBe(true);
    expect(typeof KIND_MODULES.redCrawler!.updateAlly).toBe('function');
    const e = spawnEnemy(world, 'redCrawler', V(0, 0.7, 0));
    expect(e.ai.model.parts.beacon).toBeTruthy();
    expect(e.ai.model.parts.legs).toHaveLength(4);
  });

  it('as an enemy it charges the player like a crawler', () => {
    world.player.pos.set(0, 0, 12);
    const e = spawnEnemy(world, 'redCrawler', V(0, 0.7, 0));
    e.ai.alert = 4;
    const z0 = e.pos.z;
    run(1);
    expect(e.pos.z).toBeGreaterThan(z0 + 2);
  });

  it('as an ally it runs at and bites a nearby enemy', () => {
    const e = spawnEnemy(world, 'redCrawler', V(0, 0.7, 0));
    e.allied = true;
    e.ai.allyT = HACK.allyTime; e.ai.allyMax = HACK.allyTime;
    const foe = spawnEnemy(world, 'gunner', V(0, 0.7, 8));
    foe.ai.alert = 0;
    run(3);
    expect(foe.hp).toBeLessThan(ENEMIES.gunner.hp);
  });
});

describe('ringer', () => {
  it('a ring beam hurts a player standing on the floor', () => {
    world.player.pos.set(0, 0, 6);
    spawnRingBeam(world, 0, 0.05, 0, 7, 6);
    run(1.5);
    expect(world.player.hp).toBeLessThan(world.player.maxHp);
  });

  it('can be jumped over', () => {
    world.player.pos.set(0, 0, 6);
    spawnRingBeam(world, 0, 0.05, 0, 7, 6);
    // 輪が来る間じゅう空中にいる（ジェットパックなどで越える）
    for (let i = 0; i < 45; i++) { world.player.pos.y = RINGER.height + 0.5; run(1 / 30, 1 / 30); }
    expect(world.player.hp).toBe(world.player.maxHp);
  });

  it('is blocked by walls', () => {
    world.player.pos.set(0, 0, 6);
    world.colliders.push(makeAABB(V(-6, 0, 3), V(6, 4, 3.4), 'wall'));
    spawnRingBeam(world, 0, 0.05, 0, 7, 6);
    run(1.5);
    expect(world.player.hp).toBe(world.player.maxHp);
  });

  it('warns, then fires rings on its own', () => {
    world.player.pos.set(0, 0, 9);
    const warn = collect('enemyAction');
    const e = spawnEnemy(world, 'ringer', V(0, ENEMIES.ringer.radius, 0));
    e.ai.alert = 4;
    run(8);
    const actions = warn.map((a) => a.action);
    expect(actions).toContain('ringWarn');
    expect(actions).toContain('ringFire');
  });
});

describe('medic', () => {
  it('heals a hurt ally that is in reach', () => {
    const foe = spawnEnemy(world, 'walker', V(0, 0.7, 0));
    foe.hp = 10;
    const m = spawnEnemy(world, 'medic', V(2, 0.3, 0));
    run(3);
    expect(foe.hp).toBeGreaterThan(25);
    expect(m.ai.model.parts.rod.scale.z).toBeGreaterThan(0.5);
  });

  it('walks over to a hurt ally from a distance', () => {
    const foe = spawnEnemy(world, 'walker', V(0, 0.7, 0));
    foe.hp = 10;
    const m = spawnEnemy(world, 'medic', V(12, 0.3, 0));
    run(4);
    expect(m.pos.distanceTo(foe.pos)).toBeLessThan(MEDIC.reach + 1);
    expect(foe.hp).toBeGreaterThan(10);
  });

  it('repairs a damaged dome', () => {
    const d = spawnEnemy(world, 'domer', V(0, ENEMIES.domer.radius, 0));
    d.barrier = { radius: DOMER.radius, hp: 20, maxHp: DOMER.domeHp, k: 1, flash: 0 };
    spawnEnemy(world, 'medic', V(2, 0.3, 0));
    run(2);
    expect(d.barrier.hp).toBeGreaterThan(30);
  });

  it('never heals allied (hacked) enemies or the boss, and does not heal full-hp enemies', () => {
    const ally = spawnEnemy(world, 'walker', V(0, 0.7, 0));
    ally.allied = true; ally.hp = 5;
    const m = spawnEnemy(world, 'medic', V(2, 0.3, 0));
    run(2);
    expect(ally.hp).toBe(5);
    expect(m.ai.healing).toBeFalsy();
  });

  it('runs away from the player', () => {
    world.player.pos.set(0, 0, 4);
    const m = spawnEnemy(world, 'medic', V(0, 0.3, 0));
    const d0 = m.pos.distanceTo(world.player.pos);
    run(1.5);
    expect(m.pos.distanceTo(world.player.pos)).toBeGreaterThan(d0);
  });
});
