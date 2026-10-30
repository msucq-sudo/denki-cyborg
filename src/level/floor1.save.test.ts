import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/events';
import type { World } from '../core/types';
import { createWorld } from '../core/world';
import { spawnProjectile, updateProjectiles } from '../core/projectiles';
import { updateEnemies } from '../enemies/enemies';
import { buildFloor1, getFloor1, getFloor1Memo, restoreFloor1Memo, updateFloor1 } from './floor1';

const DT = 1 / 30;
function makeWorld(): World {
  const world = createWorld({ pressed: () => false, isDown: () => false } as never, new EventBus(), 1);
  world.state = 'playing';
  buildFloor1(world);
  return world;
}
function step(world: World, count = 1): void {
  for (let i = 0; i < count; i++) {
    world.time += DT;
    updateFloor1(world, DT);
    updateEnemies(world, DT);
    updateProjectiles(world, DT);
  }
}
function enemiesIn(world: World, zoneId: string) {
  const zone = getFloor1(world)!.plan.zones.find((item) => item.id === zoneId)!;
  return world.enemies.filter((enemy) => enemy.status !== 'dead'
    && enemy.pos.x >= zone.x0 - 2 && enemy.pos.x <= zone.x1 + 2
    && enemy.pos.z >= zone.z0 - 2 && enemy.pos.z <= zone.z1 + 2);
}

describe('floor1 save memo', () => {
  it('keeps collected gears hidden and does not count them twice after restore', () => {
    const first = makeWorld();
    step(first, 2);
    const gear = getFloor1(first)!.plan.gears[0];
    first.player.pos.set(gear.x, gear.y - 1.1, gear.z);
    step(first);
    expect(first.inventory.gears).toBe(1);
    const memo = getFloor1Memo(first);

    const resumed = makeWorld();
    resumed.inventory.gears = first.inventory.gears;
    restoreFloor1Memo(resumed, memo);
    step(resumed);

    expect(resumed.inventory.gears).toBe(1);
    expect(getFloor1(resumed)!.state.gears).toBe(1);
  });

  it('keeps completed fights cleared and does not spawn their enemies again', () => {
    const first = makeWorld();
    step(first, 2);
    for (const enemy of enemiesIn(first, 'start')) enemy.status = 'dead';
    step(first);
    expect(getFloor1(first)!.state.fights.start).toBe('done');
    const memo = getFloor1Memo(first);

    const resumed = makeWorld();
    restoreFloor1Memo(resumed, memo);
    const initialCount = enemiesIn(resumed, 'start').length;
    step(resumed, 3);

    expect(getFloor1(resumed)!.state.fights.start).toBe('done');
    expect(initialCount).toBe(0);
    expect(enemiesIn(resumed, 'start')).toHaveLength(0);
  });

  it('restarts an active encounter with full HP without first-tick duplicate spawns', () => {
    const first = makeWorld();
    step(first, 2);
    first.player.pos.set(54, 0, -56);
    step(first);
    expect(getFloor1(first)!.state.fights.RU).toBe('active');
    const memo = getFloor1Memo(first);

    const resumed = makeWorld();
    restoreFloor1Memo(resumed, memo);
    const restored = enemiesIn(resumed, 'RU');
    expect(restored.length).toBeGreaterThan(0);
    expect(restored.every((enemy) => enemy.hp === enemy.maxHp)).toBe(true);
    const before = restored.length;
    step(resumed, 3);

    expect(getFloor1(resumed)!.state.fights.RU).toBe('active');
    expect(enemiesIn(resumed, 'RU')).toHaveLength(before);
  });

  it('restores powered state, gate state, and pad capacity; rejects malformed data safely', () => {
    const first = makeWorld();
    step(first, 2);
    const floor = getFloor1(first)!;
    first.player.pos.set(0, 0, -72);
    step(first, 2);
    expect(floor.state.gates.l2).toBe(true);
    const pad = floor.plan.pads[0];
    first.player.energy = 0;
    first.player.pos.set(pad.x, pad.y, pad.z);
    step(first, 15);
    const spentCapacity = (getFloor1Memo(first) as any).padRemain[0] as number;
    expect(spentCapacity).toBeLessThan(80);
    const power = floor.plan.power;
    first.player.pos.set(power.x - 10, 0, power.z);
    spawnProjectile(first, {
      pos: new THREE.Vector3(power.x - 6, power.y, power.z),
      vel: new THREE.Vector3(60, 0, 0), damage: 5, owner: 'player',
    });
    step(first, 15);
    expect(floor.state.powered).toBe(true);
    const memo = getFloor1Memo(first);

    const resumed = makeWorld();
    restoreFloor1Memo(resumed, memo);
    expect(getFloor1(resumed)!.state.powered).toBe(true);
    expect(getFloor1(resumed)!.state.powerVia).toBe('shot');
    expect(getFloor1(resumed)!.state.gates.l2).toBe(true);
    expect((getFloor1Memo(resumed) as any).gateWants.l2).toBe(true);
    expect((getFloor1Memo(resumed) as any).padRemain[0]).toBe(spentCapacity);
    expect(resumed.colliders.find((c) => c.tag === 'gate' && Math.abs(c.min.z - floor.plan.gates.find((g) => g.id === 'l2')!.z0) < 1e-6)?.active).toBe(false);
    step(resumed);
    expect(getFloor1(resumed)!.state.gates.l2).toBe(true);

    const before = getFloor1Memo(resumed);
    restoreFloor1Memo(resumed, { v: 1, player: { x: Number.NaN } });
    expect(getFloor1Memo(resumed)).toEqual(before);
  });
});
