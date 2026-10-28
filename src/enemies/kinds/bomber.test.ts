import * as THREE from 'three';
import { createWorld } from '../../core/world';
import { EventBus } from '../../core/events';
import type { World } from '../../core/types';
import { ENEMIES } from '../../config/balance';
import { makeAABB } from '../../core/collision';
import { playerCenter, PLAYER_HIT_RADIUS } from '../../core/combat';
import { spawnEnemy, updateEnemies } from '../enemies';
import { spawnProjectile, updateProjectiles, shootDown, blastFalloff } from '../../core/projectiles';
import { BOMBER } from './bomber';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mkWorld(): World {
  const w = createWorld({} as any, new EventBus(), 1);
  w.state = 'playing';
  w.player.pos.set(0, 0, 0);
  w.player.hp = w.player.maxHp = 100;
  w.colliders.push(makeAABB(V(-80, -1, -80), V(80, 0, 80), 'floor'));
  return w;
}
function step(w: World, sec: number, dt = 1 / 60): void {
  for (let t = 0; t < sec; t += dt) { w.time += dt; w.player.invuln = 0; updateEnemies(w, dt); updateProjectiles(w, dt); }
}
/** 地面に置いた範囲ダメージ弾を、プレイヤーの体の中心から dist はなれた所で爆発させる */
function blastAtDistance(w: World, dist: number, dmg = 20): number {
  const pc = playerCenter(w);
  w.player.hp = 100;
  w.player.invuln = 0;
  // プレイヤーの横（+x）の、同じ高さに置いて寿命ゼロで爆発
  spawnProjectile(w, {
    pos: V(pc.x + dist, pc.y, pc.z), vel: V(0, 0, 0), damage: dmg, owner: 'enemy', radius: 0.1, life: 0.001,
    blast: { radius: BOMBER.blastRadius, color: 0x7fe0ff, damage: dmg, minMul: BOMBER.minMul, onExpire: true },
  });
  updateProjectiles(w, 0.01);
  return 100 - w.player.hp;
}

test('爆発ダメージは中心で最大・端で minMul・外は 0', () => {
  const w = mkWorld();
  const R = BOMBER.blastRadius;
  // 当たり球の表面ぶんを引いた距離で測る：中心（体の表面が中心に接する）
  expect(blastAtDistance(w, PLAYER_HIT_RADIUS)).toBeCloseTo(20, 4);
  expect(blastAtDistance(w, PLAYER_HIT_RADIUS + R * 0.5)).toBeCloseTo(20 * (1 - 0.75 * 0.5), 3);
  const edge = blastAtDistance(w, PLAYER_HIT_RADIUS + R - 0.01);
  expect(edge).toBeGreaterThan(20 * BOMBER.minMul - 0.1);
  expect(edge).toBeLessThan(20 * BOMBER.minMul + 0.2);
  expect(blastAtDistance(w, PLAYER_HIT_RADIUS + R + 0.05)).toBe(0);
  // 近いほど大きい
  expect(blastAtDistance(w, PLAYER_HIT_RADIUS + 1)).toBeGreaterThan(blastAtDistance(w, PLAYER_HIT_RADIUS + 2.5));
});

test('blastFalloff', () => {
  expect(blastFalloff(0, 3.5)).toBe(1);
  expect(blastFalloff(3.5, 3.5)).toBe(0);
  expect(blastFalloff(3.499, 3.5, 0.25)).toBeCloseTo(0.25, 2);
});

test('範囲ダメージの無いブラスト（ミサイル）はプレイヤーに当たらない', () => {
  const w = mkWorld();
  const pc = playerCenter(w);
  spawnProjectile(w, { pos: pc.clone().add(V(1, 0, 0)), vel: V(0, 0, 0), damage: 16, owner: 'enemy', radius: 0.1, life: 0.001, blast: { radius: 3, color: 0xff9a3d } });
  updateProjectiles(w, 0.01);
  expect(w.player.hp).toBe(100);
});

test('直撃でも二重にダメージを受けない', () => {
  const w = mkWorld();
  const pc = playerCenter(w);
  spawnProjectile(w, {
    pos: pc.clone().add(V(0, 0, -2)), vel: V(0, 0, 20), damage: 20, owner: 'enemy', radius: 0.2, life: 2,
    blast: { radius: BOMBER.blastRadius, color: 0x7fe0ff, damage: 20, minMul: BOMBER.minMul, onExpire: true },
  });
  updateProjectiles(w, 0.1);
  const lost = 100 - w.player.hp;
  expect(lost).toBeGreaterThan(17);
  expect(lost).toBeLessThanOrEqual(20);
  expect(w.projectiles.length).toBe(0);
});

test('壁・床に当たって爆発し、近くのプレイヤーにダメージ', () => {
  const w = mkWorld();
  w.player.pos.set(0, 0, 0);
  spawnProjectile(w, {
    pos: V(2, 2, 0), vel: V(0, -10, 0), damage: 20, owner: 'enemy', radius: 0.2, life: 3,
    blast: { radius: BOMBER.blastRadius, color: 0x7fe0ff, damage: 20, minMul: BOMBER.minMul, onExpire: true },
  });
  updateProjectiles(w, 0.3);
  expect(w.projectiles.length).toBe(0);
  expect(w.player.hp).toBeLessThan(100);
  expect(w.player.hp).toBeGreaterThan(100 - 20);
});

test('信管：何にも当たらなくても寿命で爆発する', () => {
  const w = mkWorld();
  w.player.pos.set(0, 0, 0);
  const seen: string[] = [];
  w.events.on('enemyAction', (p) => seen.push(p.action));
  spawnProjectile(w, {
    pos: V(1.5, 30, 0), vel: V(0, 0, 0), damage: 20, owner: 'enemy', radius: 0.2, life: 0.1,
    blast: { radius: BOMBER.blastRadius, color: 0x7fe0ff, damage: 20, onExpire: true },
  });
  updateProjectiles(w, 0.2);
  expect(seen).toContain('bombBlast');   // 高い所（範囲外）で爆発 → ダメージなし
  expect(w.player.hp).toBe(100);
});

test('撃ち落とすと無害（至近距離でもダメージなし）', () => {
  const w = mkWorld();
  const pc = playerCenter(w);
  const seen: string[] = [];
  w.events.on('enemyAction', (p) => seen.push(p.action));
  const q = spawnProjectile(w, {
    pos: pc.clone().add(V(0.5, 0, 0)), vel: V(0, 0, 0), damage: 20, owner: 'enemy', radius: 0.2, life: 3, shootable: true, hp: 10,
    blast: { radius: BOMBER.blastRadius, color: 0x7fe0ff, damage: 20, onExpire: true, warnRing: true },
  });
  shootDown(w, q);
  updateProjectiles(w, 0.05);
  expect(w.player.hp).toBe(100);
  expect(seen).not.toContain('bombBlast');
  expect(w.projectiles.length).toBe(0);
  // 警告の輪もシーンから消える
  expect(w.scene.children.filter((o) => o.userData.ring).length).toBe(0);
});

test('プレイヤーの弾で撃ち落とせる', () => {
  const w = mkWorld();
  const q = spawnProjectile(w, {
    pos: V(0, 5, 0), vel: V(0, 0, 0), damage: 20, owner: 'enemy', radius: 0.2, life: 3, shootable: true, hp: BOMBER.orbHp,
    blast: { radius: BOMBER.blastRadius, color: 0x7fe0ff, damage: 20, onExpire: true },
  });
  spawnProjectile(w, { pos: V(0, 5, 5), vel: V(0, 0, -30), damage: 20, owner: 'player' });
  updateProjectiles(w, 0.2);
  expect(q.dead).toBe(true);
  expect(w.player.hp).toBe(100);
});

test('ボンバーは山なりの球を投げ、止まっているプレイヤーの近くに落ちる', () => {
  const w = mkWorld();
  w.player.pos.set(0, 0, 0);
  const e = spawnEnemy(w, 'bomber', V(0, 0.45, -11));
  e.ai.alert = 100;
  e.ai.atkTimer = 0.01;
  e.ai.yaw = 0;
  let orb: any = null, landed: THREE.Vector3 | null = null, lastPos = new THREE.Vector3();
  const attacks: string[] = [];
  w.events.on('enemyAttack', (p) => attacks.push(p.kind));
  let ringSeen = false, maxY = 0;
  for (let t = 0; t < 4 && !landed; t += 1 / 60) {
    w.time += 1 / 60; w.player.invuln = 0;
    updateEnemies(w, 1 / 60);
    updateProjectiles(w, 1 / 60);
    if (!orb && w.projectiles.length) orb = w.projectiles[0];
    if (orb) {
      if (orb.dead) landed = lastPos.clone();
      else { lastPos.copy(orb.pos); maxY = Math.max(maxY, orb.pos.y); }
      if (w.scene.children.some((o) => o.userData.ring)) ringSeen = true;
    }
  }
  expect(attacks).toContain('bomber');
  expect(orb).not.toBeNull();
  expect(orb.shootable).toBe(true);
  expect(orb.blast.damage).toBe(ENEMIES.bomber.damage);
  expect(maxY).toBeGreaterThan(e.pos.y + 0.8);     // 山なり
  expect(ringSeen).toBe(true);
  expect(landed).not.toBeNull();
  // 着弾点はプレイヤー付近（ばらつきの範囲内）
  const miss = Math.hypot(landed!.x, landed!.z);
  expect(miss).toBeLessThan(BOMBER.spread * 1.5 + 0.8);
});

test('スタン中は投げない・警戒していなければ投げない', () => {
  const w = mkWorld();
  const e = spawnEnemy(w, 'bomber', V(0, 0.45, -10));
  e.ai.alert = 0;
  e.ai.atkTimer = 0;
  step(w, 0.6);
  expect(w.projectiles.length).toBe(0);
  e.ai.alert = 100;
  e.status = 'stunned';
  e.ai.stunT = 5;
  step(w, 2);
  expect(w.projectiles.length).toBe(0);
});
