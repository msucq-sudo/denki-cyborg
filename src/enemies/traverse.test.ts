import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorld } from '../core/world';
import { EventBus } from '../core/events';
import { makeAABB } from '../core/collision';
import type { EnemyKind } from '../config/balance';
import { TRAVERSE } from '../config/balance';
import type { World } from '../core/types';
import { spawnEnemy, updateEnemies } from './enemies';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
let world: World;

beforeEach(() => {
  TRAVERSE.enabled = true;
  world = createWorld({ pressed: () => false, isDown: () => false } as never, new EventBus(), 1.6);
  world.state = 'playing';
  world.colliders.push(makeAABB(V(-80, -1, -80), V(80, 0, 80), 'floor'));
  // 高さ6mの足場。プレイヤーはその上
  world.colliders.push(makeAABB(V(-6, 0, 6), V(6, 6, 14), 'platform'));
  world.player.pos.set(0, 6, 10);
});

function run(sec: number, dt = 1 / 30): void {
  for (let i = 0; i < Math.round(sec / dt); i++) { world.time += dt; updateEnemies(world, dt); }
}

/** sec 秒進めて、足場の上（高さ・奥行きとも到達）に一度でも乗ったか。距離を取る敵は着いたあと縁から降りることがあるので、最終位置では見ない */
function reachesTop(e: { pos: THREE.Vector3 }, sec: number, minY = 5, minZ = 6): boolean {
  let ok = false;
  for (let i = 0; i < Math.round(sec * 30); i++) { run(1 / 30, 1 / 30); if (e.pos.y > minY && e.pos.z > minZ) ok = true; }
  return ok;
}

function spawn(kind: EnemyKind) {
  const e = spawnEnemy(world, kind, V(0, 1.2, 0));
  e.ai.alert = 4;
  return e;
}

describe('高所への移動', () => {
  for (const kind of ['crawler', 'walker', 'heavyWalker', 'heavy', 'jumper', 'gunner', 'beamer', 'missile', 'bomber'] as EnemyKind[]) {
    it(`${kind} は6m上の足場に上がる`, () => {
      const e = spawn(kind);
      expect(reachesTop(e, 9)).toBe(true);
    });
  }

  it('9mを超える高所でも諦めずに上がる（壁登りと飛行）', () => {
    world.colliders.push(makeAABB(V(-6, 0, 20), V(6, 16, 28), 'tower'));
    world.player.pos.set(0, 16, 24);
    for (const kind of ['heavy', 'gunner'] as EnemyKind[]) {
      const e = spawnEnemy(world, kind, V(0, 1.4, 17));
      e.ai.alert = 4;
      expect(reachesTop(e, 25, 15, 18), kind).toBe(true);
    }
  });

  it('登り終えたら体の向きが元に戻る', () => {
    const e = spawn('crawler');
    run(0.7);
    expect(e.root.rotation.x).toBeLessThan(-0.5); // 登っている間はへばりつく向き
    run(10);
    expect(e.ai.trav).toBeUndefined();
    expect(e.root.rotation.x).toBeCloseTo(0, 1);
  });

  it('無効にすると地上のまま', () => {
    TRAVERSE.enabled = false;
    const e = spawn('crawler');
    run(6);
    expect(e.pos.y).toBeLessThan(2);
  });

  it('同じ高さなら使わない', () => {
    world.player.pos.set(0, 0, 10);
    const e = spawn('walker');
    run(1);
    expect(e.ai.trav).toBeUndefined();
  });
});
