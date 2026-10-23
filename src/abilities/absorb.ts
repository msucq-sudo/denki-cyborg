import * as THREE from 'three';
import { ABSORB, OVERLOAD } from '../config/balance';
import type { Enemy, World } from '../core/types';
import { hasLineOfSight, raycastLevel } from '../core/collision';
import { raycastEnemies, isTargetable } from '../core/enemyUtil';
import { addEnergy, drainEnergy } from '../core/energy';
import { spawnBurst } from '../core/effects';
import { drainEnemy, overloadEnemy } from '../enemies/api';
import { createArmVisual, type ArmMode, type ArmVisual } from './absorbVisual';

/** 吸収アームの追加状態（World ごと） */
interface Extra {
  vis: ArmVisual;
  root: THREE.Vector3;
  /** 敵 root ローカルで保持した刺さり位置 */
  anchor: THREE.Vector3;
  hasAnchor: boolean;
  losLost: number;
  overloading: boolean;
  noEnergyShown: boolean;
  sparkTimer: number;
}

const extras = new WeakMap<World, Extra>();
const LOS_GRACE = 0.25;
const TIP_RADIUS = 0.2;
const RETRACT_DONE = 0.4;
const SHOULDER_SIDE = 0.32;

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function initAbsorb(world: World): void {
  const prev = extras.get(world);
  if (prev) world.scene.remove(prev.vis.group);
  const vis = createArmVisual();
  world.scene.add(vis.group);
  world.absorb.visual = vis.group;
  extras.set(world, {
    vis, root: new THREE.Vector3(), anchor: new THREE.Vector3(), hasAnchor: false,
    losLost: 0, overloading: false, noEnergyShown: false, sparkTimer: 0,
  });
}

/** アーム根元（左肩）を計算 */
function computeRoot(world: World, out: THREE.Vector3): THREE.Vector3 {
  const d = world.aimDir;
  tmpA.crossVectors(d, UP); // 右
  if (tmpA.lengthSq() < 1e-4) tmpA.set(1, 0, 0);
  tmpA.normalize();
  return out.copy(world.aimOrigin).addScaledVector(tmpA, -SHOULDER_SIDE).addScaledVector(UP, -0.1);
}

function setTether(enemy: Enemy | null, v: boolean): void {
  if (enemy) enemy.tethered = v;
}

function endOverload(world: World, ex: Extra): void {
  if (ex.overloading) {
    ex.overloading = false;
    world.events.emit('overloadEnd', {});
  }
  world.player.overloading = false;
}

/** attached から外れる共通処理 */
function startRetract(world: World, ex: Extra): void {
  const a = world.absorb;
  endOverload(world, ex);
  setTether(a.target, false);
  a.target = null;
  ex.hasAnchor = false;
  ex.losLost = 0;
  a.phase = 'retracting';
}

function attach(world: World, ex: Extra, enemy: Enemy, point: THREE.Vector3): void {
  const a = world.absorb;
  a.phase = 'attached';
  a.target = enemy;
  enemy.tethered = true;
  a.tip.copy(point);
  enemy.root.updateMatrixWorld();
  ex.anchor.copy(point);
  enemy.root.worldToLocal(ex.anchor);
  ex.hasAnchor = true;
  ex.losLost = 0;
  ex.noEnergyShown = false;
  world.events.emit('absorbAttach', { pos: point.clone() });
}

export function updateAbsorb(world: World, dt: number): void {
  const ex = extras.get(world);
  if (!ex) return;
  const a = world.absorb;
  const p = world.player;
  const input = world.input;
  computeRoot(world, ex.root);

  // ---- 入力 ----
  if (input.mousePressed(2)) {
    if (a.phase === 'idle') {
      a.phase = 'extending';
      a.dir.copy(world.aimDir).normalize();
      a.tip.copy(world.aimOrigin);
      a.length = 0;
      a.target = null;
      world.events.emit('absorbFire', {});
    } else if (a.phase === 'attached') {
      world.events.emit('absorbBreak', {});
      startRetract(world, ex);
    }
  }

  // ---- フェーズ ----
  switch (a.phase) {
    case 'extending': {
      const step = ABSORB.extendSpeed * dt;
      const p0 = tmpA.copy(a.tip);
      const remain = Math.max(0, ABSORB.range - a.length);
      const move = Math.min(step, remain);
      const p1 = tmpB.copy(a.tip).addScaledVector(a.dir, move);
      const eh = raycastEnemies(world.enemies, p0, p1, TIP_RADIUS);
      const lt = raycastLevel(world.colliders, p0, p1);
      if (eh && (lt === null || eh.t <= lt)) {
        attach(world, ex, eh.enemy, eh.point);
      } else if (lt !== null) {
        a.tip.lerpVectors(p0, p1, lt);
        a.phase = 'retracting';
      } else {
        a.tip.copy(p1);
        a.length += move;
        if (a.length >= ABSORB.range - 1e-4) a.phase = 'retracting';
      }
      break;
    }
    case 'attached':
      updateAttached(world, ex, dt);
      break;
    case 'retracting': {
      const toRoot = tmpA.subVectors(ex.root, a.tip);
      const d = toRoot.length();
      const step = ABSORB.retractSpeed * dt;
      if (d <= RETRACT_DONE + step) {
        a.tip.copy(ex.root);
        a.length = 0;
        a.phase = 'cooldown';
        a.cooldown = ABSORB.cooldown;
      } else {
        a.tip.addScaledVector(toRoot, step / d);
        a.length = d - step;
      }
      break;
    }
    case 'cooldown':
      a.cooldown -= dt;
      a.tip.copy(ex.root);
      if (a.cooldown <= 0) { a.cooldown = 0; a.phase = 'idle'; }
      break;
    default:
      break;
  }

  p.absorbing = a.phase === 'attached';
  if (a.phase !== 'attached') endOverload(world, ex);

  // ---- 見た目 ----
  let mode: ArmMode = 'hidden';
  if (a.phase === 'extending') mode = 'extending';
  else if (a.phase === 'attached') mode = ex.overloading ? 'overload' : 'attached';
  else if (a.phase === 'retracting') mode = 'retracting';
  ex.vis.update(ex.root, a.tip, mode, world.time);
}

function updateAttached(world: World, ex: Extra, dt: number): void {
  const a = world.absorb;
  const enemy = a.target;
  if (!enemy || !world.enemies.includes(enemy) || !isTargetable(enemy)) {
    // 他の要因で消えた／倒れた：静かに解除
    startRetract(world, ex);
    return;
  }

  // 先端を敵に追従
  if (ex.hasAnchor) {
    enemy.root.updateMatrixWorld();
    a.tip.copy(ex.anchor);
    enemy.root.localToWorld(a.tip);
  } else {
    a.tip.copy(enemy.pos);
  }

  // 距離・遮蔽で切断
  const dist = world.aimOrigin.distanceTo(enemy.pos);
  if (dist > ABSORB.breakDistance) {
    world.events.emit('absorbBreak', {});
    startRetract(world, ex);
    return;
  }
  if (hasLineOfSight(world.colliders, world.aimOrigin, enemy.pos)) ex.losLost = 0;
  else {
    ex.losLost += dt;
    if (ex.losLost > LOS_GRACE) {
      world.events.emit('absorbBreak', {});
      startRetract(world, ex);
      return;
    }
  }

  const p = world.player;
  const fDown = world.input.isDown('KeyF');
  if (!fDown) ex.noEnergyShown = false;

  // ---- 逆流 ----
  if (fDown) {
    if (p.energy <= 0) {
      if (!ex.noEnergyShown) { ex.noEnergyShown = true; world.events.emit('noEnergy', {}); }
      endOverload(world, ex);
    } else {
      if (!ex.overloading) {
        ex.overloading = true;
        p.overloading = true;
        world.events.emit('overloadStart', {});
      }
      const want = OVERLOAD.energyPerSec * dt;
      const sent = drainEnergy(world, want) * want;
      if (sent > 0) {
        const res = overloadEnemy(world, enemy, sent);
        ex.sparkTimer -= dt;
        if (ex.sparkTimer <= 0 && res === 'none') {
          ex.sparkTimer = 0.06;
          spawnBurst(world, a.tip, 0xffa04a, 3, 3.5, 0.3);
        }
        if (res === 'exploded') { startRetract(world, ex); return; }
        if (res === 'shorted') {
          world.events.emit('absorbBreak', {});
          startRetract(world, ex);
          return;
        }
      }
      if (p.energy <= 0) endOverload(world, ex);
      return; // 逆流中は吸収しない
    }
  } else {
    endOverload(world, ex);
  }

  // ---- 吸収 ----
  const got = drainEnemy(world, enemy, ABSORB.drainPerSec * dt);
  if (got > 0) {
    const added = addEnergy(world, got * ABSORB.conversion);
    a.totalAbsorbed += added;
    world.stats.energyAbsorbed += added;
  }
  if (!isTargetable(enemy) || enemy.hp <= 0) {
    const added = addEnergy(world, ABSORB.finishBonus);
    a.totalAbsorbed += added;
    world.stats.energyAbsorbed += added;
    world.events.emit('absorbComplete', { pos: enemy.pos.clone() });
    startRetract(world, ex);
  }
}
