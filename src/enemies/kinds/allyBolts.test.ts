import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorld } from '../../core/world';
import { EventBus } from '../../core/events';
import { makeAABB } from '../../core/collision';
import type { Enemy, World } from '../../core/types';
import { allyFollowWaypoint, recordAllyTrail } from './allyBolts';
import { spawnEnemy } from '../enemies';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
let world: World;

beforeEach(() => {
  world = createWorld({ pressed: () => false, isDown: () => false } as never, new EventBus(), 1.6);
  world.state = 'playing';
  world.player.pos.set(0, 0, 0);
  world.colliders.push(makeAABB(V(-80, -1, -80), V(80, 0, 80), 'floor'));
});

function ally(kind: 'redWalker' | 'redDrone', pos: THREE.Vector3): Enemy {
  const e = spawnEnemy(world, kind, pos);
  e.allied = true;
  return e;
}

describe('ally trail following', () => {
  it('records vertical travel and resets on a large 3D relocation', () => {
    const e = ally('redDrone', V(0, 1.5, 0));
    recordAllyTrail(world, e);
    world.player.pos.y = 3;
    recordAllyTrail(world, e);
    expect((e.ai.allyTrail as THREE.Vector3[]).map((p) => p.y)).toEqual([0, 3]);

    world.player.pos.y = 16;
    recordAllyTrail(world, e);
    const trail = e.ai.allyTrail as THREE.Vector3[];
    expect(trail).toHaveLength(1);
    expect(trail[0].y).toBe(16);
  });

  it('keeps the flyer on the 3D trail when it climbs and returns', () => {
    const e = ally('redDrone', V(0, 1.5, 0));
    allyFollowWaypoint(world, e, 3.2, 1.5);

    world.player.pos.y = 10;
    const ascending = allyFollowWaypoint(world, e, 3.2, 1.5);
    expect(ascending.point.y).toBeCloseTo(8.3, 1);

    world.player.pos.y = 0;
    const returning = allyFollowWaypoint(world, e, 3.2, 1.5);
    expect(returning.point.y).toBeCloseTo(4.7, 1);
  });

  it('does not send the ground walker toward a separate-height trail segment', () => {
    const e = ally('redWalker', V(0, 0.7, 0));
    allyFollowWaypoint(world, e);
    world.player.pos.y = 10;

    const waypoint = allyFollowWaypoint(world, e);
    expect(waypoint.point.y).toBeCloseTo(e.radius, 2);
    expect(waypoint.point.distanceTo(e.pos)).toBeLessThan(0.1);
  });

  it('finds a lower flyer route under a ceiling when the normal hover height is blocked', () => {
    const e = ally('redDrone', V(0, 1, 0));
    world.colliders.push(makeAABB(V(-4, 1.8, -4), V(4, 4, 4), 'ceiling'));

    const normalHeight = allyFollowWaypoint(world, e, 0.8, 2.4);
    const lowRoute = allyFollowWaypoint(world, e, 0.8, 0.9);

    expect(normalHeight.atTrailGoal).toBe(false);
    expect(lowRoute.atTrailGoal).toBe(true);
    expect(lowRoute.point.y).toBeCloseTo(0.9, 2);
  });

  it('uses flyer radius when checking a narrow corner gap and allows a wider one', () => {
    const runGap = (gap: number) => {
      const e = ally('redDrone', V(0, 2, 0));
      allyFollowWaypoint(world, e, 0.8, 2); // trail starts at the near side of the wall
      world.colliders.push(
        makeAABB(V(1.7, 0, -5), V(2.3, 4, -gap / 2)),
        makeAABB(V(1.7, 0, gap / 2), V(2.3, 4, 5)),
      );
      world.player.pos.set(4, 0, 0);
      return allyFollowWaypoint(world, e, 0.8, 2);
    };

    const narrow = runGap(0.8);
    expect(narrow.atTrailGoal).toBe(false); // 0.8m gap is narrower than the 1.1m drone
    expect(narrow.point.x).toBeCloseTo(0, 2); // stays at the reachable trail point

    world = createWorld({ pressed: () => false, isDown: () => false } as never, new EventBus(), 1.6);
    world.state = 'playing';
    world.player.pos.set(0, 0, 0);
    world.colliders.push(makeAABB(V(-80, -1, -80), V(80, 0, 80), 'floor'));
    const wide = runGap(1.4);
    expect(wide.atTrailGoal).toBe(true);
    expect(wide.point.x).toBeCloseTo(3.2, 1);
  });

  it('does not reject a flyer route that leaves a wall from exact radius contact', () => {
    const e = ally('redDrone', V(1.15, 2, 0)); // wall begins at x=1.7; radius=0.55
    world.colliders.push(makeAABB(V(1.7, 0, -2), V(4, 4, 2), 'wall'));
    world.player.pos.set(0, 0, 0);

    const waypoint = allyFollowWaypoint(world, e, 0, 2);

    expect(waypoint.atTrailGoal).toBe(true);
    expect(waypoint.point.x).toBeCloseTo(0, 2);
  });
});
