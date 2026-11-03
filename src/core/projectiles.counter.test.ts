import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorld } from './world';
import { EventBus } from './events';
import { makeAABB } from './collision';
import type { World } from './types';
import { spawnProjectile, updateProjectiles } from './projectiles';
import { spawnEnemy } from '../enemies/enemies';
import { COUNTER } from '../config/balance';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

let world: World;
beforeEach(() => {
  world = createWorld({ pressed: () => false, isDown: () => false } as never, new EventBus(), 1.6);
  world.state = 'playing';
  world.player.pos.set(0, 0, 60);
  world.colliders.push(makeAABB(V(-80, -1, -80), V(80, 0, 80), 'floor'));
});

/** 敵の電気弾（-Z 方向へ）とプレイヤー弾（+X 方向）が x=0, y=2, z=-10 で出会う */
function setup(enemyOpts: Partial<Parameters<typeof spawnProjectile>[1]> = {}, shotDamage = 10, charged = false) {
  const bolt = spawnProjectile(world, { pos: V(0, 2, -10), vel: V(0, 0, 10), damage: 6, owner: 'enemy', radius: 0.2, size: 0.2, life: 3, ...enemyOpts });
  const shot = spawnProjectile(world, { pos: V(-1, 2, -10), vel: V(70, 0, 0), damage: shotDamage, owner: 'player', charged });
  return { bolt, shot };
}

describe('カウンター', () => {
  it('敵の電気弾にプレイヤー弾が当たると、奪ってプレイヤー弾の向きへ打ち返す', () => {
    const { bolt, shot } = setup();
    expect(bolt.electric).toBe(true);
    const evs: string[] = [];
    world.events.on('counter', () => evs.push('counter'));
    updateProjectiles(world, 1 / 30);
    expect(shot.dead).toBe(true);
    expect(world.projectiles).toContain(bolt);
    expect(world.projectiles).not.toContain(shot);
    expect(bolt.owner).toBe('player');
    expect(bolt.countered).toBe(true);
    expect(bolt.damage).toBeCloseTo((6 + 10) * COUNTER.dmgMul);
    const d = bolt.vel.clone().normalize();
    expect(d.x).toBeCloseTo(1, 3);
    expect(bolt.vel.length()).toBeCloseTo(70 * COUNTER.speedMul, 3);
    expect(evs).toEqual(['counter']);
  });

  it('溜め撃ちなら倍率が上がる', () => {
    const { bolt } = setup({}, 24, true);
    updateProjectiles(world, 1 / 30);
    expect(bolt.damage).toBeCloseTo((6 + 24) * COUNTER.dmgMul * COUNTER.chargedMul);
  });

  it('ミサイル（非電気）は従来どおり撃ち落とす対象でカウンターされない', () => {
    const { bolt, shot } = setup({ missile: true, shootable: true, hp: 5, blast: { radius: 2, color: 0xff9a3d } });
    expect(bolt.electric).toBe(false);
    updateProjectiles(world, 1 / 30);
    expect(shot.dead).toBe(true);
    expect(bolt.countered).toBeUndefined();
    expect(bolt.owner).toBe('enemy');
    expect(bolt.hp).toBe(-5); // 5 - 10 → 撃ち落とされた
    expect(world.projectiles).not.toContain(bolt);
  });

  it('打ち返した弾はプレイヤーを傷つけず、敵にダメージを与える', () => {
    const { bolt } = setup();
    updateProjectiles(world, 1 / 30);
    const e = spawnEnemy(world, 'walker', V(6, 1, -10));
    const hp0 = e.hp;
    for (let i = 0; i < 30 && !bolt.dead; i++) updateProjectiles(world, 1 / 30);
    expect(bolt.dead).toBe(true);
    expect(world.player.hp).toBe(world.player.maxHp);
    expect(e.hp).toBeLessThan(hp0);
  });

  it('同じ弾を二度カウンターしない', () => {
    const { bolt } = setup();
    updateProjectiles(world, 1 / 30);
    const dmg = bolt.damage;
    spawnProjectile(world, { pos: V(bolt.pos.x - 2, 2, -10), vel: V(70, 0, 0), damage: 10, owner: 'player' });
    updateProjectiles(world, 1 / 30);
    expect(bolt.damage).toBe(dmg);
  });
});
