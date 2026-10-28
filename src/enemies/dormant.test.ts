import * as THREE from 'three';
import { createWorld } from '../core/world';
import { EventBus } from '../core/events';
import type { World } from '../core/types';
import { makeAABB, raycastLevel } from '../core/collision';
import { ENEMY_NOTICE } from '../config/balance';
import { spawnEnemy, updateEnemies, damageEnemy, drainEnemy, overloadEnemy } from './enemies';
import { raycastEnemies, isTargetable } from '../core/enemyUtil';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mkWorld(): World {
  const w = createWorld({} as any, new EventBus(), 1);
  w.state = 'playing';
  w.player.pos.set(0, 0, 40);
  w.colliders.push(makeAABB(V(-80, -1, -80), V(80, 0, 80), 'floor'));
  w.colliders.push(makeAABB(V(-80, 9, -80), V(80, 10, 80), 'ceiling'));
  return w;
}
const run = (w: World, sec: number) => { for (let i = 0; i < Math.round(sec * 30); i++) { w.time += 1 / 30; updateEnemies(w, 1 / 30); } };
const collect = (w: World, name: any) => { const l: any[] = []; w.events.on(name, (p: any) => l.push(p)); return l; };

test('spawnEnemy without opts is unchanged (not dormant)', () => {
  const w = mkWorld();
  const e = spawnEnemy(w, 'walker', V(0, 0.8, 0));
  expect(e.ai.dormant).toBeUndefined();
  expect(isTargetable(e)).toBe(true);
});

test('dormant enemy is untargetable and takes no damage / drain / overload', () => {
  const w = mkWorld();
  const e = spawnEnemy(w, 'crawler', V(0, 0.7, 0), { dormant: 'pod' });
  expect(isTargetable(e)).toBe(false);
  const hp = e.hp;
  damageEnemy(w, e, 999, { how: 'shot' });
  expect(drainEnemy(w, e, 999)).toBe(0);
  expect(overloadEnemy(w, e, 999)).toBe('none');
  expect(e.hp).toBe(hp);
  expect(e.status).toBe('active');
  expect(raycastEnemies(w.enemies, V(0, 0.7, 5), V(0, 0.7, -5))).toBeNull();
  // 弾はポッドの箱に当たる
  expect(raycastLevel(w.colliders, V(0, 0.7, 5), V(0, 0.7, -5))).not.toBeNull();
});

test('pod stays shut while the player is far, wakes within the radius and bursts out alerted', () => {
  const w = mkWorld();
  const warn = collect(w, 'enemyWakeWarn'), emerge = collect(w, 'enemyEmerge');
  const e = spawnEnemy(w, 'walker', V(0, 0.8, 0), { dormant: 'pod', yaw: 0 });
  w.player.pos.set(0, 0, ENEMY_NOTICE.range + 3);
  run(w, 2);
  expect(e.ai.dormant.phase).toBe('sleep');
  expect(e.root.visible).toBe(false);
  expect(warn.length).toBe(0);
  w.player.pos.set(0, 0, ENEMY_NOTICE.range - 2);
  run(w, 0.1);
  expect(warn.length).toBe(1);
  expect(warn[0].mode).toBe('pod');
  expect(isTargetable(e)).toBe(false);
  run(w, 0.3);                    // まだ予兆中（0.4s）
  expect(emerge.length).toBe(0);
  run(w, 0.3);                    // 開いて出てくる途中。まだ無敵
  expect(emerge.length).toBe(1);
  expect(emerge[0].kind).toBe('walker');
  expect(isTargetable(e)).toBe(false);
  const pod = w.colliders.find((c) => c.tag === 'pod')!;
  expect(pod.active).toBe(false);
  run(w, 0.6);
  expect(e.ai.dormant).toBeUndefined();
  expect(isTargetable(e)).toBe(true);
  expect(e.ai.alert).toBeGreaterThan(0);
  expect(e.root.visible).toBe(true);
  // ポッドの外へ出ている（前面 +Z 側）
  expect(e.pos.z).toBeGreaterThan(1.5);
});

test('waking propagates to sleeping neighbours within shareRadius, staggered', () => {
  const w = mkWorld();
  const a = spawnEnemy(w, 'crawler', V(0, 0.7, 0), { dormant: 'pod' });
  const b = spawnEnemy(w, 'crawler', V(ENEMY_NOTICE.shareRadius - 2, 0.7, 0), { dormant: 'pod' });
  const far = spawnEnemy(w, 'crawler', V(60, 0.7, 0), { dormant: 'pod' });
  w.player.pos.set(0, 0, 10);
  run(w, 1 / 30);
  expect(a.ai.dormant.phase).toBe('warn');
  expect(b.ai.dormant.phase).toBe('delay');
  expect(b.ai.dormant.t).toBeGreaterThanOrEqual(0.1);
  expect(b.ai.dormant.t).toBeLessThanOrEqual(0.4);
  expect(far.ai.dormant.phase).toBe('sleep');
  run(w, 1.5);
  expect(a.ai.dormant).toBeUndefined();
  expect(b.ai.dormant).toBeUndefined();
  expect(far.ai.dormant.phase).toBe('sleep');
});

test('drop drone hides near the ceiling, then plunges to its combat height and becomes alerted', () => {
  const w = mkWorld();
  const warn = collect(w, 'enemyWakeWarn'), emerge = collect(w, 'enemyEmerge');
  const e = spawnEnemy(w, 'drone', V(0, 3.2, 0), { dormant: 'drop' });
  expect(e.pos.y).toBeGreaterThan(7);
  expect(e.pos.y).toBeLessThan(9);       // 天井(9)の下
  expect(e.root.visible).toBe(false);
  run(w, 0.5);
  expect(e.ai.dormant.phase).toBe('sleep');
  w.player.pos.set(0, 0, 8);
  run(w, 0.1);
  expect(warn.length).toBe(1);
  expect(warn[0].mode).toBe('drop');
  expect(e.root.visible).toBe(false);    // 予兆中はまだ見えない
  run(w, 0.55);
  expect(emerge.length).toBe(1);
  expect(e.root.visible).toBe(true);
  expect(isTargetable(e)).toBe(false);
  run(w, 1.5);
  expect(e.ai.dormant).toBeUndefined();
  expect(e.pos.y).toBeLessThan(5);
  expect(e.pos.y).toBeGreaterThan(2);
  expect(isTargetable(e)).toBe(true);
  expect(e.ai.alert).toBeGreaterThan(0);
});

test('reinforcement drop of a ground enemy lands on the floor with a shockwave and is then active', () => {
  const w = mkWorld();
  const e = spawnEnemy(w, 'heavy', V(0, 1.3, 0), { dormant: 'drop' });
  w.player.pos.set(0, 0, 6);
  const before = w.effects.length;
  run(w, 3);
  expect(e.ai.dormant).toBeUndefined();
  expect(e.pos.y).toBeLessThan(1.6);
  expect(e.pos.y).toBeGreaterThan(1.0);
  expect(isTargetable(e)).toBe(true);
  expect(w.effects.length + before).toBeGreaterThan(0);
});

test('bosses are never dormant', () => {
  const w = mkWorld();
  const e = spawnEnemy(w, 'boss', V(0, 3, 0), { dormant: 'pod' });
  expect(e.ai.dormant).toBeUndefined();
});
