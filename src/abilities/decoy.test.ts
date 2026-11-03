import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createWorld } from '../core/world';
import { EventBus } from '../core/events';
import type { World } from '../core/types';
import { makeAABB } from '../core/collision';
import { spawnEnemy, updateEnemies } from '../enemies/enemies';
import { makeCtx } from '../enemies/common';
import { updateProjectiles } from '../core/projectiles';
import { DECOY, canUseDecoy, decoyActive, decoyPositions, decoyTarget, decoyTimers, giveDecoy, resetDecoy, updateDecoy, useDecoy } from './decoy';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

class FakeInput {
  pressedK = new Set<string>();
  isDown() { return false; }
  mouse() { return false; }
  pressed(c: string) { return this.pressedK.has(c); }
}

function mk(): { w: World; input: FakeInput } {
  const input = new FakeInput();
  const w = createWorld(input as never, new EventBus(), 1.6);
  w.state = 'playing';
  w.player.pos.set(0, 0, 0);
  w.player.yaw = 0;
  w.player.energy = 50;
  w.colliders.push(makeAABB(V(-80, -1, -80), V(80, 0, 80), 'floor'));
  return { w, input };
}
const step = (w: World, sec: number, dt = 1 / 30): void => {
  for (let t = 0; t < sec; t += dt) { w.time += dt; updateDecoy(w, dt); updateEnemies(w, dt); updateProjectiles(w, dt); }
};

describe('hologram decoy', () => {
  it('cannot be used before it is picked up', () => {
    const { w } = mk();
    expect(canUseDecoy(w)).toBe('locked');
    expect(useDecoy(w)).toBe(false);
    expect(decoyActive(w)).toBe(false);
  });

  it('spawns 3 holograms for 10 seconds, costs energy, then has a cooldown', () => {
    const { w } = mk();
    giveDecoy(w);
    expect(canUseDecoy(w)).toBeNull();
    const e0 = w.player.energy;
    expect(useDecoy(w)).toBe(true);
    expect(w.player.energy).toBeCloseTo(e0 - DECOY.cost, 5);
    expect(decoyPositions(w).length).toBe(3);
    expect(DECOY.count).toBe(3);
    expect(DECOY.duration).toBe(10);
    // 3体はばらけて、自分の近くに出る
    const ps = decoyPositions(w);
    for (const p of ps) expect(Math.hypot(p.x, p.z)).toBeLessThan(6);
    expect(new Set(ps.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`)).size).toBe(3);
    expect(canUseDecoy(w)).toBe('cooldown');
    step(w, 9.5);
    expect(decoyActive(w)).toBe(true);
    expect(decoyTimers(w).remaining).toBeGreaterThan(0);
    step(w, 1);
    expect(decoyActive(w)).toBe(false);
    expect(w.scene.children.filter((o) => o.name === 'hologram-decoy').length).toBe(0);
    // 待ち時間が明けたらまた使える
    step(w, DECOY.cooldown);
    expect(canUseDecoy(w)).toBeNull();
    resetDecoy(w);
  });

  it('is triggered by the N key and needs energy', () => {
    const { w, input } = mk();
    giveDecoy(w);
    w.player.energy = 1;
    input.pressedK.add(DECOY.key);
    updateDecoy(w, 1 / 30);
    expect(decoyActive(w)).toBe(false);
    w.player.energy = 30;
    updateDecoy(w, 1 / 30);
    expect(decoyActive(w)).toBe(true);
  });

  it('enemies aim at the nearest hologram instead of the player', () => {
    const { w } = mk();
    giveDecoy(w);
    const e = spawnEnemy(w, 'gunner', V(0, 1, -12));
    const before = makeCtx(w, e, 1 / 30);
    expect(before.pc.x).toBeCloseTo(0, 3);
    expect(before.pc.z).toBeCloseTo(0, 3);
    useDecoy(w);
    const target = decoyTarget(w, e.pos)!;
    expect(target).not.toBeNull();
    const after = makeCtx(w, e, 1 / 30);
    expect(after.pc.distanceTo(target)).toBeLessThan(1e-6);
    // プレイヤーの体の中心とは違う位置
    expect(after.pc.distanceTo(V(0, 0.9, 0))).toBeGreaterThan(0.5);
    // その敵から一番近いホログラム
    const nearest = decoyPositions(w).sort((a, b) => a.distanceTo(e.pos) - b.distanceTo(e.pos))[0];
    expect(target.distanceTo(nearest)).toBeLessThan(1e-6);
  });

  it('enemy shots fired during the effect are aimed at a hologram, and bullets that reach one vanish', () => {
    const { w } = mk();
    giveDecoy(w);
    useDecoy(w);
    const holo = decoyPositions(w)[1];
    const e = spawnEnemy(w, 'gunner', V(holo.x + 9, 1, holo.z - 1));   // 横から見ると、ホログラムと本物は別の方向
    e.ai.alert = 100;
    const shots: THREE.Vector3[] = [];
    w.events.on('enemyAttack', (p) => shots.push(p.pos.clone()));
    let aimedAt = 0, total = 0;
    for (let t = 0; t < 4; t += 1 / 30) {
      w.time += 1 / 30;
      updateDecoy(w, 1 / 30);
      updateEnemies(w, 1 / 30);
      updateProjectiles(w, 1 / 30);
      for (const q of w.projectiles) {
        if (q.owner !== 'enemy' || q.dead || q.age === undefined || q.age > 0.05) continue;
        total++;
        const dir = q.vel.clone().normalize();
        const toHolo = decoyTarget(w, e.pos)!.sub(e.pos).normalize();   // 一番近いホログラムが標的
        if (dir.angleTo(toHolo) < 0.12) aimedAt++;   // 先読み・ばらつきぶんの余裕
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(aimedAt).toBe(total);
    // 本物のプレイヤーは無傷
    expect(w.player.hp).toBe(w.player.maxHp);
  });

  it('after the hologram disappears enemies go back to targeting the player', () => {
    const { w } = mk();
    giveDecoy(w);
    useDecoy(w);
    step(w, DECOY.duration + 0.5);
    const e = spawnEnemy(w, 'gunner', V(0, 1, -12));
    const c = makeCtx(w, e, 1 / 30);
    expect(c.pc.distanceTo(V(0, 0.9, 0))).toBeLessThan(0.2);
  });
});
