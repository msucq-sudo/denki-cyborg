import * as THREE from 'three';
import { createWorld } from '../../core/world';
import { EventBus } from '../../core/events';
import type { World } from '../../core/types';
import { ENEMIES, BEAMER } from '../../config/balance';
import { makeAABB } from '../../core/collision';
import { spawnEnemy, updateEnemies, damageEnemy } from '../enemies';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mkWorld(): World {
  const w = createWorld({} as any, new EventBus(), 1);
  w.state = 'playing';
  w.player.pos.set(0, 0, 20);
  w.colliders.push(makeAABB(V(-80, -1, -80), V(80, 0, 80), 'floor'));
  return w;
}
const DT = 1 / 30;
function step(w: World, sec: number): void {
  for (let t = 0; t < sec - 1e-9; t += DT) { w.time += DT; updateEnemies(w, DT); }
}
/** 条件を満たすまで進める（最大 maxSec 秒） */
function until(w: World, cond: () => boolean, maxSec = 12): void {
  for (let t = 0; t < maxSec && !cond(); t += DT) { w.time += DT; updateEnemies(w, DT); }
}
function spawn(w: World) {
  const e = spawnEnemy(w, 'beamer', V(0, ENEMIES.beamer.radius, 0));
  e.ai.alert = 1e6;
  e.ai.cd = 0.1;
  return e;
}

test('溜め→ロック→発射でダメージは1発につき1回だけ', () => {
  const w = mkWorld();
  const log: string[] = [];
  w.events.on('beamCharge', () => log.push('charge'));
  w.events.on('beamFire', () => log.push('fire'));
  w.events.on('enemyAttack', () => log.push('attack'));
  let hits = 0;
  w.events.on('playerHit', () => hits++);
  const e = spawn(w);
  const hp0 = w.player.hp;
  // 溜め中：ビームはまだ出ていない
  until(w, () => e.ai.state === 'charge');
  step(w, BEAMER.chargeTime * 0.5);
  expect(e.ai.state).toBe('charge');
  expect(w.player.hp).toBe(hp0);
  expect(e.ai.locked).toBe(false);
  // ロック（最後の lockTime）
  until(w, () => !!e.ai.locked);
  expect(e.ai.state).toBe('charge');
  expect(e.ai.st).toBeGreaterThanOrEqual(BEAMER.chargeTime - BEAMER.lockTime - 1e-6);
  const aimLocked = e.ai.aim.clone();
  // 発射。毎フレーム無敵を解いても 1 回しか当たらない
  until(w, () => e.ai.state === 'fire');
  expect(e.ai.aim.distanceTo(aimLocked)).toBeLessThan(1e-6);   // ロック中は照準が動かない
  for (let i = 0; i < Math.ceil(BEAMER.fireTime / DT) + 2; i++) {
    w.player.invuln = 0;
    step(w, DT);
  }
  expect(hits).toBe(1);
  expect(w.player.hp).toBe(hp0 - ENEMIES.beamer.damage);
  expect(e.ai.state).toBe('recover');
  expect(log).toEqual(['charge', 'fire', 'attack']);
  // 硬直 → 待機 → 次の溜めまで attackInterval 待つ
  step(w, BEAMER.recover + 0.1);
  expect(e.ai.state).toBe('idle');
  expect(e.ai.cd).toBeGreaterThan(ENEMIES.beamer.attackInterval - 0.3);
});

test('ロック前は照準がプレイヤーを追い、ロック後は動いても外れる', () => {
  const w = mkWorld();
  const e = spawn(w);
  const hp0 = w.player.hp;
  until(w, () => e.ai.state === 'charge');
  step(w, 0.5);
  // 溜め中にゆっくり横へ動く → 照準が追う
  w.player.pos.x = 3;
  step(w, 0.8);
  const toPlayer = new THREE.Vector3(3 - e.pos.x, 1 - e.pos.y, 20 - e.pos.z).normalize();
  expect(e.ai.aim.angleTo(toPlayer)).toBeLessThan(0.15);
  // ロックされたあとで大きく避ければ当たらない
  until(w, () => !!e.ai.locked);
  w.player.pos.x = 9;
  until(w, () => e.ai.state === 'recover');
  expect(e.ai.state).toBe('recover');
  expect(w.player.hp).toBe(hp0);
});

test('壁がビームを遮る', () => {
  const w = mkWorld();
  let hits = 0;
  w.events.on('playerHit', () => hits++);
  const e = spawn(w);
  until(w, () => e.ai.state === 'charge');
  // 溜め中に間へ壁が立つ（z=10）
  w.colliders.push(makeAABB(V(-6, 0, 9.5), V(6, 8, 10.5), 'wall'));
  const hp0 = w.player.hp;
  until(w, () => e.ai.state === 'fire');
  step(w, DT * 3);
  expect(e.ai.state).toBe('fire');
  // ビームの長さは壁までで止まる
  const beam = e.ai.beamMesh as THREE.Mesh;
  expect(beam.visible).toBe(true);
  expect(beam.scale.y).toBeLessThan(11);
  expect(beam.scale.y).toBeGreaterThan(6);
  step(w, BEAMER.fireTime + 0.2);
  expect(hits).toBe(0);
  expect(w.player.hp).toBe(hp0);
});

test('射線が通らないと溜めを始めない', () => {
  const w = mkWorld();
  w.colliders.push(makeAABB(V(-30, 0, 9.5), V(30, 8, 10.5), 'wall'));
  const e = spawn(w);
  step(w, 4);
  expect(e.ai.state).toBe('idle');
});

test('溜め中にレンズへ強い一撃で中断・スタン、弱いと中断しない', () => {
  const w = mkWorld();
  const events: string[] = [];
  w.events.on('beamInterrupt', () => events.push('interrupt'));
  const e = spawn(w);
  until(w, () => e.ai.state === 'charge');
  step(w, 0.3);
  // 弱点でも威力が足りない（×3 で interruptDamage 未満）
  damageEnemy(w, e, BEAMER.interruptDamage / ENEMIES.beamer.weakMultiplier - 1, { weak: true, how: 'shot' });
  expect(e.ai.state).toBe('charge');
  // 弱点以外は何発当てても止まらない
  damageEnemy(w, e, 60, { how: 'shot' });
  expect(e.ai.state).toBe('charge');
  // 弱点への強い一撃
  damageEnemy(w, e, BEAMER.interruptDamage, { weak: true, how: 'shot' });
  expect(events).toEqual(['interrupt']);
  expect(e.status).toBe('stunned');
  expect(e.ai.state).toBe('idle');
  expect(e.ai.stunT).toBeCloseTo(BEAMER.interruptStun, 5);
  // スタン中はビームを撃たず、明けたら active に戻る
  const hp0 = w.player.hp;
  step(w, BEAMER.interruptStun - 0.1);
  expect(e.status).toBe('stunned');
  expect(w.player.hp).toBe(hp0);
  step(w, 0.3);
  expect(e.status).toBe('active');
  expect(e.ai.state).toBe('idle');
});

test('レンズは待機中は露出せず、溜め中だけ露出する', () => {
  const w = mkWorld();
  const e = spawnEnemy(w, 'beamer', V(0, ENEMIES.beamer.radius, 0));
  expect(e.weakPoints.length).toBe(1);
  expect(e.weakPoints[0].exposed).toBe(false);
  e.ai.alert = 1e6;
  e.ai.cd = 1.0;
  step(w, 0.5);
  expect(e.ai.state).toBe('idle');
  expect(e.weakPoints[0].exposed).toBe(false);
  until(w, () => e.ai.state === 'charge');
  step(w, DT);
  expect(e.weakPoints[0].exposed).toBe(true);
  // レンズは砲口側（前方）にある
  const wp = e.weakPoints[0];
  expect(wp.offset.z).toBeGreaterThan(2);
  until(w, () => e.ai.state === 'fire');
  step(w, DT);
  expect(e.weakPoints[0].exposed).toBe(false);
});

test('倒れると照準線とビームが消える', () => {
  const w = mkWorld();
  const e = spawn(w);
  until(w, () => e.ai.state === 'charge');
  step(w, 0.5);
  expect((e.ai.aimLine as THREE.Mesh).visible).toBe(true);
  damageEnemy(w, e, 1e6, { how: 'shot' });
  expect((e.ai.aimLine as THREE.Mesh).visible).toBe(false);
  expect((e.ai.beamMesh as THREE.Mesh).visible).toBe(false);
  // 消えるときに extra（照準線など）がシーンから外れる
  step(w, 0.5);
  expect(w.enemies.length).toBe(0);
  for (const o of e.ai.extra as THREE.Object3D[]) expect(o.parent).toBeNull();
});

test('距離を保つ：近すぎると下がり、遠すぎると寄る', () => {
  const w = mkWorld();
  w.player.pos.set(0, 0, 6);
  const e = spawn(w);
  e.ai.cd = 100;
  step(w, 3);
  const d1 = Math.hypot(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z);
  expect(d1).toBeGreaterThan(6.5);
  const w2 = mkWorld();
  w2.player.pos.set(0, 0, 38);
  const e2 = spawn(w2);
  e2.ai.cd = 100;
  step(w2, 3);
  expect(e2.pos.z).toBeGreaterThan(3);
});
