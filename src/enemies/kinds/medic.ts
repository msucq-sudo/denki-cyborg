// メディック：とても小さな衛生兵。攻撃はしない。傷ついた仲間（とドーム）のそばへ行き、アームを伸ばして回復する。
// 傷ついた仲間がいなければ、ドームを張るドーマーの中や仲間のそばに隠れてついていく。プレイヤーが近づくと逃げる。
// 先に倒さないと、ほかの敵がどんどん元気になる
import * as THREE from 'three';
import { Builder, COLORS, boxGeo, icoGeo, sphereGeo } from '../models';
import { approach, faceToward, moveGround, type Ctx } from '../common';
import { hasLineOfSight } from '../../core/collision';
import { isTargetable } from '../../core/enemyUtil';
import { spawnBurst } from '../../core/effects';
import { activeBarrier, barrierCenter } from '../barrier';
import type { Enemy, World } from '../../core/types';
import type { KindModule } from './kind';

/** メディックの調整値 */
export const MEDIC = {
  /** アームの届く距離（m。相手の表面まで） */
  reach: 4.5,
  /** 1秒あたりの回復 = max(minHeal, 相手の最大HP × healFrac)。ドームは domeHeal */
  healFrac: 0.12,
  minHeal: 9,
  domeHeal: 16,
  /** 回復相手を探し直す間隔（秒）と、探す範囲（m） */
  scanInterval: 0.3,
  scanRange: 30,
  /** 回復するとき相手から保ちたい距離（m。プレイヤーの反対側に回る） */
  standOff: 2.2,
  /** プレイヤーがこの距離（m）より近いと逃げる */
  fleeDist: 6,
  /** アームの伸びる・戻る速さ（m/s）と、畳んだときの長さ（m） */
  extendSpeed: 14,
  retractSpeed: 22,
  foldedLen: 0.16,
  /** 肩（体の中心から） */
  shoulder: { x: 0.2, y: 0.04, z: 0.1 },
  color: 0x5af0a0,
} as const;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function armOrigin(e: Enemy, out: THREE.Vector3): THREE.Vector3 {
  const yaw: number = e.ai.yaw ?? 0, cs = Math.cos(yaw), sn = Math.sin(yaw);
  const s = MEDIC.shoulder;
  return out.set(e.pos.x + s.x * cs + s.z * sn, e.pos.y + s.y, e.pos.z - s.x * sn + s.z * cs);
}

function barrierNeedsHeal(o: Enemy): boolean {
  const b = o.barrier;
  return !!b && b.hp > 0 && b.hp < b.maxHp - 0.5;
}

/** 回復する相手：傷ついている（またはドームが傷ついている）敵のうち、弱っていて近い順 */
function pickTarget(world: World, e: Enemy): Enemy | undefined {
  let best: Enemy | undefined, bs = Infinity;
  for (const o of world.enemies) {
    if (o === e || o.kind === 'boss' || !isTargetable(o)) continue;
    const hurt = o.hp < o.maxHp - 0.5 || barrierNeedsHeal(o);
    if (!hurt) continue;
    const d = o.pos.distanceTo(e.pos);
    if (d > MEDIC.scanRange) continue;
    const score = (o.hp / o.maxHp) * 10 + d * 0.25;
    if (score < bs) { bs = score; best = o; }
  }
  return best;
}

/** 傷ついた仲間がいないとき、隠れ場所にする仲間：ドームを張っているドーマー、なければ最も近い仲間 */
function pickEscort(world: World, e: Enemy): Enemy | undefined {
  let best: Enemy | undefined, bd = Infinity;
  for (const o of world.enemies) {
    if (o === e || o.kind === 'medic' || o.kind === 'boss' || !isTargetable(o)) continue;
    const d = o.pos.distanceTo(e.pos) - (activeBarrier(o) ? 6 : 0);   // ドームの持ち主を優先
    if (d < bd && d < MEDIC.scanRange) { bd = d; best = o; }
  }
  return best;
}

function update(c: Ctx): void {
  const { world, e, dt, spec, dist2d, dirXZ, los } = c;
  const ai = e.ai;
  if (e.status === 'stunned') {
    ai.stunT = (ai.stunT ?? 0) - dt;
    moveGround(world, e, dt, 0, 0, 20);
    ai.walk = 0; ai.healing = false;
    if (ai.stunT <= 0) e.status = 'active';
    return;
  }
  // 吸収アームでつながれている間は、あわてて何もできない
  if (e.tethered) { moveGround(world, e, dt, 0, 0, 20); ai.walk = 0; ai.healing = false; return; }

  // ---- 回復する相手を決める
  ai.scanT = (ai.scanT ?? 0) - dt;
  const cur = ai.healTarget as Enemy | undefined;
  if (cur && (!isTargetable(cur) || !world.enemies.includes(cur) || (cur.hp >= cur.maxHp - 0.01 && !barrierNeedsHeal(cur)))) ai.healTarget = undefined;
  if (ai.scanT <= 0 || (!ai.healTarget && ai.scanT < 0.05)) {
    ai.scanT = MEDIC.scanInterval;
    ai.healTarget = pickTarget(world, e);
    ai.escort = ai.healTarget ? undefined : pickEscort(world, e);
  }
  const target = ai.healTarget as Enemy | undefined;
  const escort = ai.escort as Enemy | undefined;

  // ---- 行きたい場所
  let goalX = e.pos.x, goalZ = e.pos.z, goalHold = 0.8;
  const anchor = target ?? escort;
  if (anchor && isTargetable(anchor)) {
    const b = activeBarrier(anchor);
    if (target) {
      // プレイヤーの反対側（相手の陰）に回り込む
      const px = c.pc.x - anchor.pos.x, pz = c.pc.z - anchor.pos.z, pd = Math.hypot(px, pz) || 1;
      goalX = anchor.pos.x - (px / pd) * MEDIC.standOff;
      goalZ = anchor.pos.z - (pz / pd) * MEDIC.standOff;
      goalHold = 0.6;
    } else if (b) {
      // ドームの中に隠れる：持ち主の少し後ろ側に自分の定位置を決める
      const ang = (e.id * 2.399) % (Math.PI * 2);
      barrierCenter(anchor, _a);
      goalX = _a.x + Math.cos(ang) * b.radius * 0.45;
      goalZ = _a.z + Math.sin(ang) * b.radius * 0.45;
      goalHold = 0.7;
    } else {
      // 仲間のそばにいる：プレイヤーの反対側
      const px = c.pc.x - anchor.pos.x, pz = c.pc.z - anchor.pos.z, pd = Math.hypot(px, pz) || 1;
      goalX = anchor.pos.x - (px / pd) * 2.6;
      goalZ = anchor.pos.z - (pz / pd) * 2.6;
      goalHold = 1.0;
    }
  }
  let wx = 0, wz = 0;
  const gx = goalX - e.pos.x, gz = goalZ - e.pos.z, gd = Math.hypot(gx, gz);
  if (gd > goalHold) { wx = (gx / gd) * spec.speed; wz = (gz / gd) * spec.speed; }
  // プレイヤーが近いと逃げる（ドームの中にいるときは動きすぎない）
  if (los && dist2d < MEDIC.fleeDist) {
    const k = 1 - dist2d / MEDIC.fleeDist;
    wx += -dirXZ.x * spec.speed * (0.4 + 1.2 * k);
    wz += -dirXZ.z * spec.speed * (0.4 + 1.2 * k);
  }
  const sp = Math.hypot(wx, wz);
  if (sp > spec.speed * 1.3) { wx *= spec.speed * 1.3 / sp; wz *= spec.speed * 1.3 / sp; }
  moveGround(world, e, dt, wx, wz, 14);
  ai.walk = Math.hypot(e.vel.x, e.vel.z);

  // ---- 向き：回復中は相手、動いているときは進行方向、そうでなければプレイヤーのほう
  // ---- 回復：届く距離にいて、壁にさえぎられていなければアームを伸ばす
  let healing = false;
  if (target) {
    armOrigin(e, _a);
    const reachD = _a.distanceTo(target.pos) - target.radius * 0.6;
    if (reachD <= MEDIC.reach && hasLineOfSight(world.colliders, _a, target.pos)) {
      healing = true;
      faceToward(e, target.pos.x - e.pos.x, target.pos.z - e.pos.z, dt, 10);
      ai.armGoal = Math.max(MEDIC.foldedLen, reachD);
      if (ai.armLen >= ai.armGoal - 0.15) healTick(world, e, target, dt);
    }
  }
  if (!healing) {
    ai.armGoal = MEDIC.foldedLen;
    if (sp > 0.3) faceToward(e, wx, wz, dt, 8);
    else faceToward(e, dirXZ.x, dirXZ.z, dt, 3);
  }
  if (healing && !ai.healing) world.events.emit('enemyAction', { kind: e.kind, pos: e.pos.clone(), action: 'healStart' });
  ai.healing = healing;
}

/** 回復の1フレーム分。傷ついた本体を優先し、無傷ならドームを直す */
function healTick(world: World, e: Enemy, target: Enemy, dt: number): void {
  const ai = e.ai;
  let healed = false;
  if (target.hp < target.maxHp - 0.01) {
    const rate = Math.max(MEDIC.minHeal, target.maxHp * MEDIC.healFrac);
    target.hp = Math.min(target.maxHp, target.hp + rate * dt);
    healed = true;
  } else if (barrierNeedsHeal(target)) {
    const b = target.barrier!;
    b.hp = Math.min(b.maxHp, b.hp + MEDIC.domeHeal * dt);
    healed = true;
  }
  if (!healed) return;
  ai.healFx = (ai.healFx ?? 0) - dt;
  if (ai.healFx <= 0) {
    ai.healFx = 0.22;
    _b.set(target.pos.x + (Math.random() - 0.5) * target.radius, target.pos.y + target.radius * (0.2 + Math.random() * 0.8), target.pos.z + (Math.random() - 0.5) * target.radius);
    spawnBurst(world, _b, MEDIC.color, 3, 1.4, 0.55);
  }
}

function animate(_world: World, e: Enemy, dt: number, down: boolean): void {
  const ai = e.ai;
  const p = ai.model.parts;
  const vis = ai.model.vis as THREE.Group;
  const arm = p.arm as THREE.Group, rod = p.rod as THREE.Mesh, glow = p.glow as THREE.Mesh, hand = p.hand as THREE.Group;
  const legs = [p.legL, p.legR] as THREE.Group[];
  const lamps = p.lampMats as THREE.MeshStandardMaterial[];
  const lerp = THREE.MathUtils.lerp;
  const healing: boolean = !down && !!ai.healing;

  if (!down) {
    // アームの長さ：目標に向けて伸び縮み
    ai.armLen = approach(ai.armLen ?? MEDIC.foldedLen, ai.armGoal ?? MEDIC.foldedLen, (ai.armLen < (ai.armGoal ?? 0) ? MEDIC.extendSpeed : MEDIC.retractSpeed) * dt);
    // アームの向き：回復中は相手へ。そうでなければ前方やや下で待機
    const t = ai.healTarget as Enemy | undefined;
    let ly = -0.35, lx = 0, lz = 1;
    if (healing && t) {
      armOrigin(e, _a);
      _b.set(t.pos.x - _a.x, t.pos.y - _a.y, t.pos.z - _a.z).normalize();
      const yaw: number = ai.yaw ?? 0, cs = Math.cos(yaw), sn = Math.sin(yaw);
      lx = _b.x * cs - _b.z * sn; lz = _b.x * sn + _b.z * cs; ly = _b.y;
    }
    arm.rotation.order = 'YXZ';
    const ty = Math.atan2(lx, lz), tx = -Math.asin(THREE.MathUtils.clamp(ly, -1, 1));
    arm.rotation.y = lerp(arm.rotation.y, ty, Math.min(1, dt * 16));
    arm.rotation.x = lerp(arm.rotation.x, tx, Math.min(1, dt * 16));
    rod.scale.z = Math.max(0.01, ai.armLen);
    rod.position.z = ai.armLen / 2;
    glow.visible = healing;
    glow.scale.z = Math.max(0.01, ai.armLen);
    glow.position.z = ai.armLen / 2;
    (glow.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.2 * Math.sin((ai.t ?? 0) * 18);
    hand.position.z = ai.armLen;
    // ランプ：回復中は脈打つ
    const g = healing ? 2.2 + 1.6 * Math.sin((ai.t ?? 0) * 14) : 0.9;
    for (const m of lamps) m.emissiveIntensity = lerp(m.emissiveIntensity, g, Math.min(1, dt * 10));
    // ちょこちょこ歩き
    const walk = Math.min(1, (ai.walk ?? 0) / 3);
    ai.wph = (ai.wph ?? 0) + (ai.walk ?? 0) * dt * 3.6;
    legs[0].rotation.x = Math.sin(ai.wph) * 0.8 * walk;
    legs[1].rotation.x = -Math.sin(ai.wph) * 0.8 * walk;
    vis.position.y += Math.abs(Math.sin(ai.wph)) * 0.03 * walk + Math.sin((ai.t ?? 0) * 3 + e.id) * 0.01;
    vis.rotation.z = lerp(vis.rotation.z, Math.sin(ai.wph) * 0.12 * walk, Math.min(1, dt * 8));
  } else {
    glow.visible = false;
    rod.scale.z = 0.01;
    for (const m of lamps) m.emissiveIntensity = 0.05;
    vis.rotation.z = (ai.tilt ?? 1) * 1.5 * ai.collapse;
    vis.position.y = -0.08 * ai.collapse;
  }
}

export const medic: KindModule = {
  knockback: 1,

  build() {
    const b = new Builder();
    const white = b.body(COLORS.white, 0.5, true), silver = b.body(COLORS.silver, 0.5, true), navy = b.body(COLORS.navy, 0.7, true);
    const pale = b.body(COLORS.paleBlue, 0.5, true);
    const lampMats: THREE.MeshStandardMaterial[] = [];
    const lampMat = (i: number): THREE.MeshStandardMaterial => {
      const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: MEDIC.color, emissiveIntensity: i, roughness: 0.4 });
      lampMats.push(m);
      return m;
    };
    // まるい小さな体 + 胸の「＋」マーク（緑に光る）
    b.mesh(icoGeo(0.2, 1), white, b.vis, 0, 0.02, 0);
    const plusMat = lampMat(0.9);
    b.mesh(boxGeo(0.1, 0.03, 0.02), plusMat, b.vis, 0, 0.0, 0.19).castShadow = false;
    b.mesh(boxGeo(0.03, 0.1, 0.02), plusMat, b.vis, 0, 0.0, 0.19).castShadow = false;
    // 顔：大きな目のバイザーと、頭の上の十字アンテナ
    b.block(0.24, 0.08, 0.06, navy, b.vis, 0, 0.1, 0.17, 0.02);
    b.mesh(boxGeo(0.17, 0.035, 0.02), b.eye(), b.vis, 0, 0.1, 0.205);
    b.prism(0.012, 0.12, 4, navy, b.vis, 0, 0.27, -0.02);
    b.mesh(sphereGeo(0.03), lampMat(1.6), b.vis, 0, 0.34, -0.02).castShadow = false;
    // 小さな足
    const legs: THREE.Group[] = [];
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(sx * 0.09, -0.17, 0.02);
      b.vis.add(leg);
      b.prism(0.035, 0.07, 6, silver, leg, 0, -0.02, 0);
      b.block(0.09, 0.05, 0.13, navy, leg, 0, -0.08, 0.02, 0.015);
      legs.push(leg);
    }
    b.parts.legL = legs[0];
    b.parts.legR = legs[1];
    // 左腕：小さな飾り
    b.block(0.05, 0.12, 0.05, pale, b.vis, -0.22, -0.02, 0.02, 0.015);
    // 右肩のアーム：根元は小さな箱。ロッドが伸び縮みし、先端に手（三つ又）がつく
    const arm = new THREE.Group();
    arm.position.set(MEDIC.shoulder.x, MEDIC.shoulder.y, MEDIC.shoulder.z);
    b.vis.add(arm);
    b.block(0.09, 0.09, 0.09, silver, arm, 0, 0, -0.01, 0.02);
    const rod = b.mesh(boxGeo(0.03, 0.03, 1), b.body(COLORS.silver, 0.4, true), arm, 0, 0, MEDIC.foldedLen / 2);
    rod.scale.z = MEDIC.foldedLen;
    rod.castShadow = false;
    const glow = new THREE.Mesh(
      boxGeo(0.08, 0.08, 1),
      new THREE.MeshBasicMaterial({ color: MEDIC.color, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    glow.visible = false;
    glow.castShadow = false;
    arm.add(glow);
    const hand = new THREE.Group();
    hand.position.z = MEDIC.foldedLen;
    arm.add(hand);
    b.mesh(sphereGeo(0.045), lampMat(1.4), hand).castShadow = false;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const prong = b.mesh(boxGeo(0.015, 0.015, 0.07), navy, hand, Math.cos(a) * 0.04, Math.sin(a) * 0.04, 0.04);
      prong.rotation.set(-Math.sin(a) * 0.4, Math.cos(a) * 0.4, 0);
    }
    arm.rotation.x = 0.35;
    b.parts.arm = arm; b.parts.rod = rod; b.parts.glow = glow; b.parts.hand = hand;
    b.parts.lampMats = lampMats;
    // 背中の小さなタンク（弱点）
    b.block(0.14, 0.16, 0.06, navy, b.vis, 0, 0.03, -0.2, 0.02);
    b.weak(0, 0.03, -0.24, 0.15, [1, 1, 0.6], 0.075);
    return b.done();
  },

  update,
  animate,
};
