import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createWorld } from '../../core/world';
import { EventBus } from '../../core/events';
import type { World } from '../../core/types';
import { ENEMIES, GUN } from '../../config/balance';
import { makeAABB } from '../../core/collision';
import { spawnEnemy, updateEnemies } from '../enemies';
import { spawnProjectile, updateProjectiles } from '../../core/projectiles';
import { MISSILE_DRONE } from './missileDrone';

// 吸収アームのテスト用：敵 API は差し替える（abilities.test.ts と同じ方式）
const api = vi.hoisted(() => ({ drainEnemy: vi.fn(), overloadEnemy: vi.fn() }));
vi.mock('../api', () => api);
vi.mock('../../enemies/api', () => api);

import { initAbsorb, updateAbsorb } from '../../abilities/absorb';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

class FakeInput {
  keys = new Set<string>(); pressedK = new Set<string>(); mouseP = new Set<number>();
  isDown(c: string) { return this.keys.has(c); }
  pressed(c: string) { return this.pressedK.has(c); }
  mousePressed(b: number) { return this.mouseP.has(b); }
  endFrame() { this.pressedK.clear(); this.mouseP.clear(); }
}

function mkWorld(input: unknown = {}, events = new EventBus()): World {
  const w = createWorld(input as any, events, 1.6);
  w.state = 'playing';
  w.player.pos.set(0, 0, 15);
  w.colliders.push(makeAABB(V(-80, -1, -80), V(80, 0, 80), 'floor'));
  return w;
}
function step(w: World, sec: number, dt = 1 / 30): void {
  for (let t = 0; t < sec; t += dt) { w.time += dt; updateEnemies(w, dt); updateProjectiles(w, dt); }
}
const missiles = (w: World) => w.projectiles.filter((p) => p.shootable && !p.dead);
const KIND = 'missileDrone' as const;

describe('missile drone', () => {
  it('launches exactly 4 shootable missiles per volley', () => {
    const w = mkWorld();
    const attacks = vi.fn(); w.events.on('enemyAttack', attacks);
    const e = spawnEnemy(w, KIND, V(0, 3, 0));
    e.ai.alert = 100;
    e.ai.atkTimer = 0;
    // 予備動作 → 連続発射。全弾を出し切る直後までを数える
    const seen = new Set<unknown>();
    for (let t = 0; t < 2.5; t += 1 / 60) {
      w.time += 1 / 60; updateEnemies(w, 1 / 60); updateProjectiles(w, 1 / 60);
      for (const p of missiles(w)) seen.add(p);
      if (e.ai.mode === 'idle' && seen.size > 0) break;
    }
    expect(seen.size).toBe(MISSILE_DRONE.pods);
    expect(attacks).toHaveBeenCalledTimes(MISSILE_DRONE.pods);
    for (const p of seen as Set<any>) {
      expect(p.damage).toBe(ENEMIES.missileDrone.damage);
      expect(p.hp).toBe(MISSILE_DRONE.missileHp);
      expect(p.homing).toBeTruthy();
    }
    // ポッドは空になっている
    expect(e.ai.pods.every((x: number) => x === 0)).toBe(true);
  });

  it('missiles flare out sideways first, then home toward the player', () => {
    const w = mkWorld();
    const e = spawnEnemy(w, KIND, V(0, 3, 0));
    e.ai.alert = 100; e.ai.atkTimer = 0; e.ai.yaw = 0; // +Z（プレイヤー側）を向く
    step(w, 2.2, 1 / 60);
    const ms = missiles(w);
    expect(ms.length).toBe(4);
    // 左右に分かれて飛んでいる
    expect(ms.some((m) => m.pos.x > 0.3)).toBe(true);
    expect(ms.some((m) => m.pos.x < -0.3)).toBe(true);
    // 少したつとプレイヤーへ向かって近づく
    const d0 = ms.map((m) => m.pos.distanceTo(w.player.pos));
    step(w, 0.6, 1 / 60);
    const d1 = ms.map((m) => m.pos.distanceTo(w.player.pos));
    expect(d1.every((d, i) => d < d0[i])).toBe(true);
  });

  it('one pistol tap kills one missile', () => {
    const w = mkWorld();
    const e = spawnEnemy(w, KIND, V(0, 3, 0));
    e.ai.alert = 100; e.ai.atkTimer = 0;
    for (let t = 0; t < 2.5 && missiles(w).length < 4; t += 1 / 60) { w.time += 1 / 60; updateEnemies(w, 1 / 60); updateProjectiles(w, 1 / 60); }
    const ms = missiles(w);
    expect(ms.length).toBe(4);
    const m = ms[0];
    m.vel.set(0, 0, 0); m.homing = undefined; // 狙いやすいよう止める
    expect(GUN.tapDamage).toBeGreaterThanOrEqual(m.hp!);
    // 弾の飛来位置に合わせ、ミサイルへ向けてタップ弾を1発撃つ
    const from = m.pos.clone().add(V(0, 0, 4));
    spawnProjectile(w, { pos: from, vel: V(0, 0, -30), damage: GUN.tapDamage, owner: 'player' });
    updateProjectiles(w, 0.2);
    expect(m.dead).toBe(true);
    expect(missiles(w).length).toBe(3);
  });

  it('absorb arm destroys a missile it passes through', () => {
    const input = new FakeInput();
    const events = new EventBus();
    const w = mkWorld(input, events);
    w.player.pos.set(0, 0, 0);
    w.aimOrigin.set(0, 1.5, 0);
    w.aimDir.set(0, 0, -1);
    w.camera.position.set(0, 2, 4);
    w.camera.lookAt(0, 1.5, -10);
    w.camera.updateMatrixWorld();
    initAbsorb(w);
    const down = vi.fn(); events.on('missileDown', down);
    // アームの進路上（z=-4）に静止したミサイルを置く
    const m = spawnProjectile(w, {
      pos: V(0, 1.5, -4), vel: V(0, 0, 0), damage: 9, owner: 'enemy', radius: 0.32, size: 0.26,
      missile: true, shootable: true, hp: MISSILE_DRONE.missileHp,
    });
    input.pressedK.add('KeyE');
    for (let i = 0; i < 30; i++) {
      w.time += 1 / 60;
      updateAbsorb(w, 1 / 60);
      input.endFrame();
    }
    expect(m.dead).toBe(true);
    expect(down).toHaveBeenCalledTimes(1);
  });

  it('reloads the pods one by one after a volley', () => {
    const w = mkWorld();
    const e = spawnEnemy(w, KIND, V(0, 3, 0));
    e.ai.alert = 100; e.ai.atkTimer = 0;
    for (let t = 0; t < 3 && !(e.ai.mode === 'idle' && e.ai.pods.every((p: number) => p === 0)); t += 1 / 60) {
      w.time += 1 / 60; updateEnemies(w, 1 / 60); updateProjectiles(w, 1 / 60);
    }
    expect(e.ai.pods.every((p: number) => p === 0)).toBe(true);
    // 途中：一部だけ装填済み
    const partial: number[] = [];
    for (let t = 0; t < 3; t += 1 / 60) {
      w.time += 1 / 60; updateEnemies(w, 1 / 60); updateProjectiles(w, 1 / 60);
      partial.push(e.ai.pods.filter((p: number) => p >= 1).length);
      if (e.ai.mode !== 'idle') break;
    }
    expect(partial).toContain(1);
    expect(partial).toContain(3);
    expect(Math.max(...partial)).toBe(4);
    expect(e.ai.pods.every((p: number) => p === 1)).toBe(true);
    // 次の斉射はまだ先（attackInterval）
    expect(e.ai.atkTimer).toBeGreaterThan(0);
  });

  it('does not fire while unaware, and stops telegraphing when tethered', () => {
    const w = mkWorld();
    const e = spawnEnemy(w, KIND, V(0, 3, -100)); // 遠くで気づかない
    step(w, 4);
    expect(missiles(w).length).toBe(0);
    const w2 = mkWorld();
    const e2 = spawnEnemy(w2, KIND, V(0, 3, 0));
    e2.ai.alert = 100; e2.ai.atkTimer = 0;
    step(w2, 0.4);
    expect(e2.ai.mode).toBe('tele');
    e2.tethered = true;
    step(w2, 0.2);
    expect(e2.ai.mode).toBe('idle');
    step(w2, 3);
    expect(missiles(w2).length).toBe(0);
    void e;
  });
});
