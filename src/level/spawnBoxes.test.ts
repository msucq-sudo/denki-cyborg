import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/events';
import { createWorld } from '../core/world';
import { updateProjectiles } from '../core/projectiles';
import { updateEnemies } from '../enemies/api';
import { boxSizeFor, createSpawnBoxes, getSpawnBoxes, openSpawnBoxes, SPAWN_BOX, spawnBoxAlive, updateSpawnBoxes } from './spawnBoxes';

const DT = 1 / 60;
function mk() {
  const w = createWorld({ pressed: () => false, isDown: () => false } as never, new EventBus(), 1);
  w.state = 'playing';
  // 床
  w.colliders.push({ min: new THREE.Vector3(-50, -1, -50), max: new THREE.Vector3(50, 0, 50), active: true, tag: 'floor' });
  w.player.pos.set(0, 0, 30);
  const run = (sec: number) => { for (let i = 0; i < Math.round(sec / DT); i++) { w.time += DT; updateSpawnBoxes(w, DT); updateEnemies(w, DT); updateProjectiles(w, DT); } };
  return { w, run };
}

describe('spawn boxes', () => {
  it('sizes the box by the enemy (small crate for drones, container for heavies)', () => {
    const d = boxSizeFor('drone'), h = boxSizeFor('heavy'), c = boxSizeFor('crawler');
    expect(d.style).toBe('crate');
    expect(h.style).toBe('container');
    expect(c.style).toBe('crate');
    expect(h.w).toBeGreaterThan(c.w);
    expect(c.w).toBeGreaterThanOrEqual(d.w);
  });

  it('hides the enemy until the player comes near; then shakes, bursts and the enemy becomes active', () => {
    const { w, run } = mk();
    const [box] = createSpawnBoxes(w, [{ kind: 'crawler', x: 0, z: 0 }]);
    const warns: unknown[] = [];
    w.events.on('enemyWakeWarn', (e) => warns.push(e));
    run(1);
    // 閉じている：敵は World にいない（見えない・当たらない・動かない）。箱には当たり判定がある
    expect(box.state).toBe('closed');
    expect(box.enemy).toBeNull();
    expect(w.enemies.length).toBe(0);
    expect(box.collider.active).toBe(true);
    expect(spawnBoxAlive([box])).toBe(1);
    // 近づく
    w.player.pos.set(0, 0, SPAWN_BOX.wakeRadius - 1);
    run(DT);
    expect(box.state).toBe('shaking');
    expect(warns.length).toBe(1);
    expect(box.enemy).toBeNull();
    run(SPAWN_BOX.shake + 0.05);
    expect(box.state).toBe('open');
    expect(box.collider.active).toBe(false);
    const e = box.enemy!;
    expect(e.kind).toBe('crawler');
    expect(e.status).toBe('active');
    expect(w.enemies).toContain(e);
    expect(spawnBoxAlive([box])).toBe(1);
    e.status = 'dead';
    expect(spawnBoxAlive([box])).toBe(0);
    // 残骸は少しして消える
    run(SPAWN_BOX.debrisLife + 1.5);
  });

  it('wakeRadius 0 boxes only open by a trigger (openSpawnBoxes), staggered', () => {
    const { w, run } = mk();
    const list = createSpawnBoxes(w, [{ kind: 'heavy', x: 0, z: 0, wakeRadius: 0 }, { kind: 'gunner', x: 6, z: 0, wakeRadius: 0 }]);
    w.player.pos.set(1, 0, 4);
    run(1);
    expect(list.every((b) => b.state === 'closed')).toBe(true);
    openSpawnBoxes(w, list, 0.3);
    run(SPAWN_BOX.shake + 0.05);
    expect(list[0].state).toBe('open');
    expect(list[1].state).toBe('shaking');
    run(0.4);
    expect(list[1].state).toBe('open');
    expect(list[0].style).toBe('container');
    expect(getSpawnBoxes(w).length).toBe(2);
  });

  it('shooting a closed box opens it early (the bullet does no damage to the hidden enemy)', () => {
    const { w, run } = mk();
    const [box] = createSpawnBoxes(w, [{ kind: 'walker', x: 0, z: 0, wakeRadius: 0 }]);
    w.projectiles.push({ pos: new THREE.Vector3(0, 0.8, 8), vel: new THREE.Vector3(0, 0, -70), radius: 0.12, damage: 10, owner: 'player', life: 1, mesh: new THREE.Object3D() });
    run(0.15);
    expect(box.state).toBe('shaking');
    expect(box.enemy).toBeNull();
    run(SPAWN_BOX.shakeShot + 0.05);
    expect(box.state).toBe('open');
    expect(box.enemy!.hp).toBe(box.enemy!.maxHp);
  });
});
