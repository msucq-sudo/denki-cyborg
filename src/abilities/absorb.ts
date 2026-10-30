import * as THREE from 'three';
import { ABSORB, ALLY_LINK, ENEMIES, GRAPPLE, HACK } from '../config/balance';
import { absorbConversion, absorbDrainPerSec, overloadEnergyPerSec } from '../progression/effects';
import { KIND_MODULES } from '../enemies/kinds';
import type { Enemy, World } from '../core/types';
import { hasLineOfSight, raycastLevel } from '../core/collision';
import { raycastEnemies, isTargetable } from '../core/enemyUtil';
import { addEnergy, drainEnergy } from '../core/energy';
import { spawnBurst } from '../core/effects';
import { drainEnemy, overloadEnemy } from '../enemies/api';
import { getAbsorbArmRoot } from '../player/player';
import { getSockets, type PowerSocket } from '../core/sockets';
import { shootDown } from '../core/projectiles';
import { segmentSphere } from '../core/collision';
import {
  canGrapple, findAimedGrapple, hitGrapple, isGrappleHolding, startGrapple, surfacePoint, type GrapplePoint,
} from '../core/grapple';
import { createArmVisual, type ArmMode, type ArmVisual } from './absorbVisual';
import { getGrabbables, type ArmGrabbable } from '../core/armGrab';
import { drainSource, getPowerSources, type PowerSource } from '../core/powerSources';
import { toast } from '../core/combat';

/** アームでアイテムを掴む当たり半径（メタル） */
const DROP_GRAB_RADIUS = 0.7;
/** メタルを掴んだとき、周りこの距離のメタルもまとめて引き寄せる */
const DROP_GRAB_CLUSTER = 2.5;

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
  /** 電気を送っている固定ソケット（敵ではなく装置に刺さっている間） */
  socket: PowerSocket | null;
  socketT: number;
  /** グラップルで刺さっているポイント（引き寄せ・ぶら下がり中） */
  grapple: GrapplePoint | null;
  /** 今回の射程（グラップルポイントを狙っているときだけ長い） */
  reach: number;
  /** アームで掴んで引き戻し中のアイテム（歯車など） */
  carry: ArmGrabbable | null;
  /** 電力を吸っている固定の電力源（core/powerSources.ts） */
  source: PowerSource | null;
  /** つないでいる味方（level.data.allyArm のステージだけ）。送電で回復／吸収 */
  ally: Enemy | null;
  /** 「最大まで回復しました」を出した（つなぎ直すまで出さない） */
  allyFullShown: boolean;
  allyFloorShown: boolean;
}

const extras = new WeakMap<World, Extra>();
const LOS_GRACE = 0.25;
/** アームでミサイル等を壊すときの当たり判定の余裕 */
const ARM_SHOOT_PAD = 0.3;
const TIP_RADIUS = 0.2;
const RETRACT_DONE = 0.4;
const SHOULDER_SIDE = 0.32;

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function initAbsorb(world: World): void {
  const prev = extras.get(world);
  if (prev) world.scene.remove(prev.vis.group);
  const vis = createArmVisual();
  world.scene.add(vis.group);
  world.absorb.visual = vis.group;
  extras.set(world, {
    vis, root: new THREE.Vector3(), anchor: new THREE.Vector3(), hasAnchor: false,
    losLost: 0, overloading: false, noEnergyShown: false, sparkTimer: 0, socket: null, socketT: 0,
    grapple: null, reach: ABSORB.range, carry: null, source: null, ally: null, allyFullShown: false, allyFloorShown: false,
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
  ex.socket = null;
  ex.grapple = null;
  ex.source = null;
  ex.ally = null;
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

/** 吸収ダメージ数字は細かく出さず、この間隔でまとめて出す */
const DRAIN_POP_INTERVAL = 0.35;
let drainAcc = 0;
let drainT = 0;

export function updateAbsorb(world: World, dt: number): void {
  const ex = extras.get(world);
  if (!ex) return;
  const a = world.absorb;
  const p = world.player;
  const input = world.input;
  computeRoot(world, ex.root);

  // ---- 入力 ----
  if (input.pressed('KeyE')) {
    if (a.phase === 'idle') {
      a.phase = 'extending';
      a.dir.copy(world.aimDir).normalize();
      a.tip.copy(world.aimOrigin);
      a.length = 0;
      a.target = null;
      // グラップルポイントを狙っていれば長い射程で撃つ
      ex.reach = ABSORB.range;
      const aimed = findAimedGrapple(world);
      // anySurface：狙った先の壁・天井（グラップル射程内）にも長い射程で撃つ
      let surfaceAimed = false;
      if (!aimed && GRAPPLE.anySurface && canGrapple(world)) {
        tmpB.copy(world.aimOrigin).addScaledVector(world.aimDir, GRAPPLE.range);
        const t = raycastLevel(world.colliders, world.aimOrigin, tmpB);
        surfaceAimed = t !== null && !!surfacePoint(world, tmpC.lerpVectors(world.aimOrigin, tmpB, t));
      }
      if ((aimed || surfaceAimed) && canGrapple(world)) {
        ex.reach = GRAPPLE.range;
        world.events.emit('grappleFire', {});
      } else {
        if (aimed && world.player.energy < GRAPPLE.cost) world.events.emit('noEnergy', {});
        world.events.emit('absorbFire', {});
      }
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
      const remain = Math.max(0, ex.reach - a.length);
      const move = Math.min(step, remain);
      const p1 = tmpB.copy(a.tip).addScaledVector(a.dir, move);
      // 撃ち落とせる敵弾（ミサイルなど）はアームの先端が触れた瞬間に壊れる。アームはそのまま伸び続ける
      for (const q of world.projectiles) {
        if (q.dead || !q.shootable || q.owner !== 'enemy') continue;
        if (segmentSphere(p0, p1, q.pos, q.radius + TIP_RADIUS + ARM_SHOOT_PAD) !== null) shootDown(world, q);
      }
      const eh = raycastEnemies(world.enemies, p0, p1, TIP_RADIUS);
      const lt = raycastLevel(world.colliders, p0, p1);
      // 電源ソケット（装置）：最も近い命中を探す
      let sk: PowerSocket | null = null, st = Infinity;
      for (const s of getSockets(world)) {
        if (!s.enabled) continue;
        const t = segmentSphere(p0, p1, s.pos, s.radius);
        if (t !== null && t < st) { st = t; sk = s; }
      }
      // グラップルポイント（登録済み）。anySurface のときは壁・天井そのものにも刺さる
      let gp: GrapplePoint | null = null, gt = Infinity;
      if (canGrapple(world)) {
        const gh = hitGrapple(world, p0, p1);
        if (gh) { gp = gh.pt; gt = gh.t; }
        if (!gp && GRAPPLE.anySurface && lt !== null && !(eh && eh.t <= lt)) {
          gp = surfacePoint(world, tmpC.lerpVectors(p0, p1, lt));
          gt = lt;
        }
      }
      // アイテム（歯車など登録物・床のメタル）：一番手前なら掴んで引き戻す
      let ig: ArmGrabbable | null = null, it = Infinity;
      for (const g of getGrabbables(world)) {
        if (!g.enabled) continue;
        const t = segmentSphere(p0, p1, g.pos, g.radius);
        if (t !== null && t < it) { it = t; ig = g; }
      }
      let dropHit = false;
      for (const d of world.drops) {
        const t = segmentSphere(p0, p1, d.pos, DROP_GRAB_RADIUS);
        if (t !== null && t < it) { it = t; ig = null; dropHit = true; }
      }
      // 電力源（吸える装置）・味方（allyArm のステージだけ）
      let ps: PowerSource | null = null, pt = Infinity;
      for (const s of getPowerSources(world)) {
        if (!s.enabled) continue;
        const t = segmentSphere(p0, p1, s.pos, s.radius);
        if (t !== null && t < pt) { pt = t; ps = s; }
      }
      let al: Enemy | null = null, alT = Infinity;
      if (world.level.data.allyArm) {
        for (const e of world.enemies) {
          if (!e.allied || e.status !== 'active' || e.ai.dormant) continue;
          const t = segmentSphere(p0, p1, e.pos, e.radius + TIP_RADIUS);
          if (t !== null && t < alT) { alT = t; al = e; }
        }
      }
      const lvT = (lt ?? Infinity) + 1e-6, enT = eh ? eh.t : Infinity;
      const srcFirst = ps !== null && pt <= lvT && pt <= enT && pt <= it && pt <= st && pt <= gt && pt <= alT;
      const allyFirst = !srcFirst && al !== null && alT <= lvT && alT <= enT && alT <= it && alT <= st && alT <= gt;
      const itemFirst = !srcFirst && !allyFirst && it < Infinity && it <= (lt ?? Infinity) + 1e-6 && it <= (eh ? eh.t : Infinity) && it <= st && it <= gt;
      if (srcFirst && ps) {
        a.tip.lerpVectors(p0, p1, pt);
        a.phase = 'attached';
        a.target = null;
        ex.source = ps;
        world.events.emit('absorbAttach', { pos: a.tip.clone() });
      } else if (allyFirst && al) {
        a.tip.lerpVectors(p0, p1, alT);
        a.phase = 'attached';
        a.target = null;
        ex.ally = al;
        ex.allyFullShown = false;
        ex.allyFloorShown = false;
        world.events.emit('absorbAttach', { pos: a.tip.clone() });
      } else if (itemFirst) {
        a.tip.lerpVectors(p0, p1, it);
        if (ig) {
          ig.enabled = false;
          ex.carry = ig;
        } else if (dropHit) {
          // 当たったメタルと、その周りのメタルをまとめてプレイヤーへ飛ばす
          for (const d of world.drops) if (d.pos.distanceTo(a.tip) < DROP_GRAB_CLUSTER) d.grabbed = true;
        }
        world.events.emit('armGrab', { pos: a.tip.clone() });
        a.phase = 'retracting';
      } else if (gp && gt <= (lt ?? Infinity) + 1e-6 && gt <= (eh ? eh.t : Infinity) && gt <= st) {
        a.tip.lerpVectors(p0, p1, gt);
        if (startGrapple(world, gp)) {
          a.phase = 'attached';
          a.target = null;
          ex.grapple = gp;
        } else a.phase = 'retracting';
      } else if (sk && st <= (lt ?? Infinity) && st <= (eh ? eh.t : Infinity)) {
        a.tip.lerpVectors(p0, p1, st);
        a.phase = 'attached';
        a.target = null;
        ex.socket = sk;
        ex.socketT = 0.45;
        world.events.emit('absorbAttach', { pos: a.tip.clone() });
        sk.onFeed();
      } else if (eh && (lt === null || eh.t <= lt) && eh.enemy.shielded) {
        // 守られている（ジャンパーの閉じた頭など）：はじかれて戻る
        a.tip.copy(eh.point);
        a.phase = 'retracting';
        spawnBurst(world, eh.point, 0xd8e8ff, 8, 3);
        world.events.emit('shieldBlock', { pos: eh.point.clone() });
      } else if (eh && (lt === null || eh.t <= lt)) {
        attach(world, ex, eh.enemy, eh.point);
      } else if (lt !== null) {
        a.tip.lerpVectors(p0, p1, lt);
        a.phase = 'retracting';
      } else {
        a.tip.copy(p1);
        a.length += move;
        if (a.length >= ex.reach - 1e-4) a.phase = 'retracting';
      }
      break;
    }
    case 'attached':
      if (ex.grapple) {
        // 引き寄せ・ぶら下がりの間だけ刺さったまま。終わったら（よじ登り開始・中断）戻す
        a.tip.copy(ex.grapple.pos);
        if (!isGrappleHolding(world)) startRetract(world, ex);
      } else if (ex.socket) {
        ex.socketT -= dt;
        a.tip.copy(ex.socket.pos);
        if (ex.socketT <= 0) startRetract(world, ex);
      } else if (ex.source) updateSourceLink(world, ex, dt);
      else if (ex.ally) updateAllyLink(world, ex, dt);
      else updateAttached(world, ex, dt);
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
        // 掴んできたアイテムを手元で取得
        if (ex.carry) { const g = ex.carry; ex.carry = null; g.onGrab(); }
      } else {
        a.tip.addScaledVector(toRoot, step / d);
        a.length = d - step;
      }
      // 掴んだアイテムはアームの先に付いてくる
      if (ex.carry) { ex.carry.pos.copy(a.tip); ex.carry.obj?.position.copy(a.tip); }
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
  // 電流エフェクトは見た目のバネ腕（左肩）に沿わせる。見た目がなければ従来の根元
  const visRoot = getAbsorbArmRoot(world, tmpA) ? tmpA : ex.root;
  ex.vis.update(visRoot, a.tip, mode, world.time);
}

function updateAttached(world: World, ex: Extra, dt: number): void {
  const a = world.absorb;
  const enemy = a.target;
  if (!enemy || !world.enemies.includes(enemy) || !isTargetable(enemy)) {
    // 他の要因で消えた／倒れた：静かに解除
    startRetract(world, ex);
    return;
  }
  if (enemy.shielded) {
    // 守りに入った（ジャンパーの頭が閉じた等）：はじかれて外れる
    world.events.emit('absorbBreak', {});
    world.events.emit('shieldBlock', { pos: a.tip.clone() });
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
      const want = overloadEnergyPerSec(world) * dt;
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
  // ハッキングできる敵はつないでいる間ゆっくり吸う（コード入力の時間をつくる）
  const hackMul = KIND_MODULES[enemy.kind]?.hackable ? HACK.drainMul : 1;
  const got = drainEnemy(world, enemy, absorbDrainPerSec(world) * (ENEMIES[enemy.kind].drainMul ?? 1) * hackMul * dt);
  drainAcc += got;
  drainT += dt;
  if (drainAcc > 0 && (drainT >= DRAIN_POP_INTERVAL || enemy.hp <= 0)) {
    world.events.emit('enemyDrained', { pos: enemy.pos.clone().setY(enemy.pos.y + enemy.radius), amount: drainAcc });
    drainAcc = 0; drainT = 0;
  }
  if (got > 0) {
    const added = addEnergy(world, got * absorbConversion(world));
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

/** 線が切れる条件（距離・見通し）。切れたら true（引き戻し開始済み） */
function linkBroken(world: World, ex: Extra, at: THREE.Vector3, dt: number): boolean {
  if (world.aimOrigin.distanceTo(at) > ABSORB.breakDistance) {
    world.events.emit('absorbBreak', {});
    startRetract(world, ex);
    return true;
  }
  if (hasLineOfSight(world.colliders, world.aimOrigin, at)) ex.losLost = 0;
  else {
    ex.losLost += dt;
    if (ex.losLost > LOS_GRACE) {
      world.events.emit('absorbBreak', {});
      startRetract(world, ex);
      return true;
    }
  }
  return false;
}

/** 固定の電力源から吸う。吸い尽くしたら戻す */
function updateSourceLink(world: World, ex: Extra, dt: number): void {
  const a = world.absorb;
  const s = ex.source!;
  a.tip.copy(s.pos);
  if (!s.enabled) { startRetract(world, ex); return; }
  if (linkBroken(world, ex, s.pos, dt)) return;
  const got = drainSource(s, absorbDrainPerSec(world) * dt);
  if (got > 0) {
    const added = addEnergy(world, got * absorbConversion(world));
    a.totalAbsorbed += added;
    world.stats.energyAbsorbed += added;
    ex.sparkTimer -= dt;
    if (ex.sparkTimer <= 0) { ex.sparkTimer = 0.08; spawnBurst(world, s.pos, 0x66e6ff, 2, 2.5, 0.25); }
  }
  if (!s.enabled) {
    world.events.emit('absorbComplete', { pos: s.pos.clone() });
    startRetract(world, ex);
  }
}

/**
 * 味方とつながっている間：逆流ボタン（F）で送電＝回復（満タンで「最大まで回復しました」。ショートはしない）、
 * 離している間は味方から吸収（吸った分だけ味方の体力が減る。ALLY_LINK.drainFloor より下には減らさない）
 */
function updateAllyLink(world: World, ex: Extra, dt: number): void {
  const a = world.absorb;
  const e = ex.ally!;
  if (!world.enemies.includes(e) || !e.allied || e.status !== 'active') { startRetract(world, ex); return; }
  a.tip.copy(e.pos);
  if (linkBroken(world, ex, e.pos, dt)) return;
  const p = world.player;
  if (world.input.isDown('KeyF')) {
    if (e.hp >= e.maxHp - 1e-6) {
      endOverload(world, ex);
      if (!ex.allyFullShown) { ex.allyFullShown = true; toast(world, '最大まで回復しました', 2.5); world.events.emit('absorbComplete', { pos: e.pos.clone() }); }
      return;
    }
    if (p.energy <= 0) {
      if (!ex.noEnergyShown) { ex.noEnergyShown = true; world.events.emit('noEnergy', {}); }
      endOverload(world, ex);
      return;
    }
    if (!ex.overloading) { ex.overloading = true; p.overloading = true; world.events.emit('overloadStart', {}); }
    const room = (e.maxHp - e.hp) / ALLY_LINK.feedMul;
    const want = Math.min(overloadEnergyPerSec(world) * dt, room);
    const sent = drainEnergy(world, want) * want;
    e.hp = Math.min(e.maxHp, e.hp + sent * ALLY_LINK.feedMul);
    ex.sparkTimer -= dt;
    if (ex.sparkTimer <= 0) { ex.sparkTimer = 0.08; spawnBurst(world, e.pos, 0x66e6ff, 2, 2.5, 0.25); }
    if (e.hp >= e.maxHp - 1e-6) {
      e.hp = e.maxHp;
      endOverload(world, ex);
      if (!ex.allyFullShown) { ex.allyFullShown = true; toast(world, '最大まで回復しました', 2.5); world.events.emit('absorbComplete', { pos: e.pos.clone() }); }
    }
    return;
  }
  endOverload(world, ex);
  ex.noEnergyShown = false;
  ex.allyFullShown = false;
  const floor = e.maxHp * ALLY_LINK.drainFloor;
  const want = Math.min(absorbDrainPerSec(world) * ALLY_LINK.drainMul * dt, Math.max(0, e.hp - floor));
  if (want <= 0) {
    if (!ex.allyFloorShown) { ex.allyFloorShown = true; toast(world, 'これ以上吸うと仲間が止まってしまう', 2.5); }
    return;
  }
  e.hp -= want;
  const added = addEnergy(world, want * absorbConversion(world));
  a.totalAbsorbed += added;
  world.stats.energyAbsorbed += added;
}
