// ボンバー：ちっちゃくて丸い、電気の球を山なりに投げる小型ロボ
import * as THREE from 'three';
import { Builder, COLORS, boxGeo, icoGeo, sphereGeo, taperGeo } from '../models';
import { moveGround, faceToward, approach, type Ctx } from '../common';
import { spawnProjectile } from '../../core/projectiles';
import { raycastLevel } from '../../core/collision';
import { spawnBurst } from '../../core/effects';
import type { KindModule } from './kind';
import type { Enemy, World } from '../../core/types';

/** ボンバーの調整値。爆発の中心ダメージは ENEMIES.bomber.damage、投げる間隔は attackInterval */
export const BOMBER = {
  /** この距離（m）を保つ：近すぎれば下がり、遠ければ寄る。間は横にちょこちょこ動く */
  keepMin: 8,
  keepMax: 14,
  /** これより近いとは投げない（自爆になるので） */
  minThrowDist: 3.5,
  /** 投げる前の振りかぶり（秒）と、腕を振り抜く時間 */
  windup: 0.7,
  swing: 0.14,
  /** 連投のときの短い振りかぶり・連投する確率・連投の間隔（秒） */
  quickWindup: 0.4,
  volleyChance: 0.4,
  volleyGap: 0.3,
  /** 山なりの軌道：球の重力と、最低でもかける飛行時間（秒）。水平の速さは ENEMIES.bomber.projectileSpeed */
  gravity: 16,
  minFlight: 1.1,
  /** プレイヤーの移動の先読み（飛行時間 × この割合ぶん先を狙う） */
  leadMul: 0.5,
  /** 着弾点のばらつき（m）。遠いほど大きい */
  spread: 1.6,
  /** 爆発の半径（m）と、範囲の端でのダメージ倍率（中心は 1、範囲の外は 0） */
  blastRadius: 3.5,
  minMul: 0.25,
  blastColor: 0x7fe0ff,
  /** 球の大きさ（m）・撃ち落とすのに必要な威力・着弾予測より余分に持つ信管（秒） */
  orbSize: 0.22,
  orbHp: 10,
  fuseExtra: 0.8,
  /** 腕（肩を支点に x 軸回転）：構え・振りかぶり・離す瞬間の角度（rad）と、肩から球までの長さ */
  restAngle: -1.0,
  windAngle: -3.6,
  releaseAngle: -2.4,
  armLen: 0.38,
  shoulder: { x: 0.36, y: 0.08, z: 0 },
} as const;

const _hand = new THREE.Vector3();

/** 腕が角度 a のときの手（球の位置）のローカル座標 */
function handLocal(a: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(BOMBER.shoulder.x, BOMBER.shoulder.y - BOMBER.armLen * Math.cos(a), BOMBER.shoulder.z - BOMBER.armLen * Math.sin(a));
}

/** 球を投げる：プレイヤーの足元（先読み＋ばらつき）に落ちるよう放物線の初速を決める */
function launchOrb(c: Ctx): void {
  const { world, e, spec } = c;
  const yaw: number = e.ai.yaw ?? 0;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const loc = handLocal(BOMBER.releaseAngle, _hand);
  const from = new THREE.Vector3(
    e.pos.x + loc.x * cs + loc.z * sn, e.pos.y + loc.y, e.pos.z - loc.x * sn + loc.z * cs,
  );
  const pl = world.player;
  // 飛行時間は距離から。先読みした位置でもう一度見積もる
  const flightFor = (x: number, z: number): number =>
    Math.max(BOMBER.minFlight, Math.hypot(x - from.x, z - from.z) / spec.projectileSpeed);
  let T = flightFor(pl.pos.x, pl.pos.z);
  let tx = pl.pos.x + pl.vel.x * T * BOMBER.leadMul, tz = pl.pos.z + pl.vel.z * T * BOMBER.leadMul;
  T = flightFor(tx, tz);
  tx = pl.pos.x + pl.vel.x * T * BOMBER.leadMul; tz = pl.pos.z + pl.vel.z * T * BOMBER.leadMul;
  // ばらつき（円盤内で一様）
  const D = Math.hypot(tx - from.x, tz - from.z);
  const sr = BOMBER.spread * THREE.MathUtils.clamp(D / 10, 0.6, 1.5) * Math.sqrt(Math.random());
  const sa = Math.random() * Math.PI * 2;
  tx += Math.cos(sa) * sr; tz += Math.sin(sa) * sr;
  T = flightFor(tx, tz);
  // 狙う高さ：その地点の床（ジャンプ中でも足元の床へ）
  const top = new THREE.Vector3(tx, pl.pos.y + 0.6, tz), bot = new THREE.Vector3(tx, pl.pos.y - 30, tz);
  const th = raycastLevel(world.colliders, top, bot);
  const ty = th !== null ? top.y + (bot.y - top.y) * th : pl.pos.y;
  // 離散積分（先に速度を更新）の沈み込みぶんを少し補正
  const g = BOMBER.gravity;
  const vy = (ty - from.y + 0.5 * g * T * T + 0.5 * g * T / 60) / T;
  const vel = new THREE.Vector3((tx - from.x) / T, vy, (tz - from.z) / T);
  spawnProjectile(world, {
    pos: from, vel, damage: spec.damage, owner: 'enemy', radius: BOMBER.orbSize * 0.9, size: BOMBER.orbSize,
    life: T + BOMBER.fuseExtra, gravity: g, color: BOMBER.blastColor, shootable: true, hp: BOMBER.orbHp,
    blast: { radius: BOMBER.blastRadius, color: BOMBER.blastColor, damage: spec.damage, minMul: BOMBER.minMul, onExpire: true, warnRing: true },
    trail: 0x9fe8ff,
  });
  spawnBurst(world, from, 0xbfeaff, 6, 3, 0.3);
  world.events.emit('enemyAttack', { kind: e.kind, pos: from.clone() });
}

function update(c: Ctx): void {
  const { world, e, dt, spec, dirXZ, dist2d, los } = c;
  const ai = e.ai;
  ai.atkTimer = (ai.atkTimer ?? 0.8 + Math.random() * 1.2) - dt;
  ai.orb = ai.orb ?? 0.4;
  if (e.status === 'stunned') {
    ai.stunT = (ai.stunT ?? 0) - dt;
    moveGround(world, e, dt, 0, 0, 20);
    ai.walk = 0; ai.windup = 0; ai.swing = 0; ai.warn = 0;
    if (ai.stunT <= 0) e.status = 'active';
    return;
  }
  if (ai.alert <= 0) {
    moveGround(world, e, dt, 0, 0, 10);
    ai.walk = 0; ai.warn = 0; ai.windup = 0; ai.swing = 0;
    ai.orb = approach(ai.orb, 0.4, dt);
    return;
  }

  faceToward(e, dirXZ.x, dirXZ.z, dt, 5);

  // 移動：距離を保ちつつ、ちょこちょこ横に動く。振りかぶり中はほとんど止まる
  ai.strafeT = (ai.strafeT ?? 0) - dt;
  if (ai.strafeT <= 0 || ai.strafeDir === undefined) {
    ai.strafeDir = Math.random() < 0.5 ? 1 : -1;
    ai.strafeT = 1.2 + Math.random() * 1.8;
  }
  const radial = !los ? 1 : dist2d < BOMBER.keepMin ? -1 : dist2d > BOMBER.keepMax ? 1 : 0;
  const busy = (ai.windup ?? 0) > 0 || (ai.swing ?? 0) > 0;
  const tangent = radial === 0 ? 1 : 0.45;
  const sp = spec.speed * (busy ? 0.2 : 1);
  moveGround(
    world, e, dt,
    (dirXZ.x * radial * 0.9 - dirXZ.z * ai.strafeDir * tangent) * sp,
    (dirXZ.z * radial * 0.9 + dirXZ.x * ai.strafeDir * tangent) * sp, 8,
  );
  ai.walk = Math.hypot(e.vel.x, e.vel.z);

  // 投げる：振りかぶり（予告）→ 腕を振り抜く → 球が手を離れる
  if ((ai.swing ?? 0) > 0) {
    ai.swing -= dt;
    ai.warn = 1;
    if (ai.swing <= 0) {
      ai.warn = 0;
      launchOrb(c);
      ai.recoil = 1;
      ai.orb = 0;
      if (!ai.volleyed && Math.random() < BOMBER.volleyChance) {
        ai.volleyed = true; ai.quick = true;
        ai.atkTimer = BOMBER.volleyGap;
      } else {
        ai.volleyed = false;
        ai.atkTimer = spec.attackInterval * (0.85 + Math.random() * 0.3);
      }
    }
  } else if ((ai.windup ?? 0) > 0) {
    ai.windup -= dt;
    ai.warn = 1 - Math.max(0, ai.windup) / ai.windupLen;
    ai.orb = 0.55 + 0.45 * ai.warn;
    if (ai.windup <= 0) ai.swing = BOMBER.swing;
  } else {
    ai.warn = 0;
    ai.orb = Math.min(0.55, ai.orb + dt * 1.4);   // 投げたあとは次の球をこしらえる
    if (ai.atkTimer <= 0 && los && dist2d > BOMBER.minThrowDist) {
      ai.windupLen = ai.quick ? BOMBER.quickWindup : BOMBER.windup;
      ai.quick = false;
      ai.windup = ai.windupLen;
    }
  }
}

function animate(_world: World, e: Enemy, dt: number, down: boolean): void {
  const ai = e.ai;
  const p = ai.model.parts;
  const vis = ai.model.vis as THREE.Group;
  const arm = p.arm as THREE.Group, orb = p.orb as THREE.Group, armL = p.armL as THREE.Group;
  const legs = [p.legL, p.legR] as THREE.Group[];
  ai.recoil = Math.max(0, (ai.recoil ?? 0) - dt * 4);
  const lerp = THREE.MathUtils.lerp;
  const k = Math.min(1, dt * 12);

  if (!down) {
    // ちょこちょこ歩き：体を左右にゆらし、足を交互に出す
    const walk = Math.min(1, (ai.walk ?? 0) / 2.5);
    ai.wph = (ai.wph ?? 0) + (ai.walk ?? 0) * dt * 3.2;
    legs[0].rotation.x = Math.sin(ai.wph) * 0.7 * walk;
    legs[1].rotation.x = -Math.sin(ai.wph) * 0.7 * walk;
    vis.rotation.z = lerp(vis.rotation.z, Math.sin(ai.wph) * 0.13 * walk, k);
    vis.position.y += Math.abs(Math.sin(ai.wph)) * 0.035 * walk;
    // 体の傾き：振りかぶりでのけぞり、投げたあとは前のめり
    const lean = -0.28 * (ai.windup > 0 ? ai.warn : 0) + 0.32 * ai.recoil;
    vis.rotation.x = lerp(vis.rotation.x, lean, Math.min(1, dt * 14));
    vis.rotation.y = 0;
    armL.rotation.x = -Math.sin(ai.wph) * 0.5 * walk;
    // 腕：構え → 振りかぶり → 振り抜き
    let target = BOMBER.restAngle + Math.sin((ai.t ?? 0) * 3) * 0.05;
    let snap = Math.min(1, dt * 10);
    if ((ai.windup ?? 0) > 0) {
      const w = ai.warn * ai.warn * (3 - 2 * ai.warn);
      target = lerp(BOMBER.restAngle, BOMBER.windAngle, w);
      snap = Math.min(1, dt * 18);
    } else if ((ai.swing ?? 0) > 0) {
      const s = 1 - ai.swing / BOMBER.swing;
      target = lerp(BOMBER.windAngle, BOMBER.releaseAngle + 0.5, s);
      snap = 1;
    }
    arm.rotation.x = lerp(arm.rotation.x, target, snap);
    // 手の中の球：ためるほど大きく、ばちばちと光る
    const o: number = ai.orb ?? 0;
    orb.visible = o > 0.06;
    orb.scale.setScalar(Math.max(0.01, o));
    const pulse = 1 + 0.2 * Math.sin((ai.t ?? 0) * 40) + 0.35 * (ai.warn ?? 0);
    (p.orbHalo as THREE.Mesh).scale.setScalar(1.9 * pulse);
    for (const h of (p.crackle as THREE.Group).children) {
      if (Math.random() < 0.4 + 0.4 * (ai.warn ?? 0)) {
        h.rotation.set((Math.random() - 0.5) * 6, Math.random() * 6.28, (Math.random() - 0.5) * 6);
        h.visible = Math.random() < 0.85;
      }
    }
  } else {
    // 丸いのでごろんと横に転がって倒れる
    ai.orb = 0;
    orb.visible = false;
    vis.rotation.z = (ai.tilt ?? 1) * 1.5 * ai.collapse;
    vis.rotation.x = lerp(vis.rotation.x, 0, k);
    vis.position.y = -0.1 * ai.collapse;
    arm.rotation.x = lerp(arm.rotation.x, -0.3, k);
    legs[0].rotation.x = 0.5 * ai.collapse;
    legs[1].rotation.x = -0.35 * ai.collapse;
    armL.rotation.x = lerp(armL.rotation.x, 0.3, k);
  }
}

export const bomber: KindModule = {
  knockback: 0.5,
  build() {
    const b = new Builder();
    const white = b.body(COLORS.white, 0.5, true), silver = b.body(COLORS.silver, 0.5, true), blue = b.body(COLORS.blue, 0.5, true);
    const navy = b.body(COLORS.navy, 0.7, true), pale = b.body(COLORS.paleBlue, 0.5, true);
    // 丸い胴体：面ごとの陰影の多面体球 + 青い腹巻き + 光るライン
    b.mesh(icoGeo(0.37, 1), white);
    b.prism(0.385, 0.07, 10, blue, b.vis, 0, -0.02, 0);
    b.prism(0.392, 0.018, 10, b.glow(1.5), b.vis, 0, -0.02, 0).castShadow = false;
    // 頭のてっぺん：銀のキャップ + アンテナ + ランプ
    b.mesh(taperGeo(0.13, 0.24, 0.09, 8), silver, b.vis, 0, 0.35, 0);
    b.prism(0.012, 0.2, 4, navy, b.vis, -0.09, 0.5, -0.04);
    b.lamp(0.045, 0.045, 0.045, b.vis, -0.09, 0.62, -0.04, 1.8);
    // 顔：バイザーとスリットの目
    b.block(0.36, 0.17, 0.08, navy, b.vis, 0, 0.1, 0.34, 0.03);
    b.mesh(boxGeo(0.27, 0.05, 0.03), b.eye(), b.vis, 0, 0.1, 0.395);
    // 頬のランプ
    for (const sx of [-1, 1]) b.lamp(0.03, 0.05, 0.05, b.vis, sx * 0.3, 0.1, 0.2, 1.4);
    // 足：ちょこんとした二本脚（関節 + すね + 靴）
    const legs: THREE.Group[] = [];
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(sx * 0.16, -0.28, 0.02);
      b.vis.add(leg);
      b.prism(0.07, 0.1, 6, silver, leg, 0, -0.02, 0);
      b.block(0.17, 0.075, 0.26, navy, leg, 0, -0.14, 0.04, 0.025);
      b.mesh(boxGeo(0.17, 0.02, 0.08), blue, leg, 0, -0.1, 0.12);
      legs.push(leg);
    }
    b.parts.legL = legs[0];
    b.parts.legR = legs[1];
    // 左腕：小さな飾りの腕
    const armL = new THREE.Group();
    armL.position.set(-0.36, 0.08, 0);
    b.vis.add(armL);
    b.prism(0.08, 0.1, 6, blue, armL).rotation.z = Math.PI / 2;
    b.block(0.085, 0.2, 0.085, white, armL, -0.01, -0.13, 0, 0.025);
    b.block(0.1, 0.09, 0.1, navy, armL, -0.01, -0.26, 0, 0.03);
    b.parts.armL = armL;
    // 右腕（投げ腕）：肩を支点に回る。先端の三つ又の手で電気の球をつかむ
    const arm = new THREE.Group();
    arm.position.set(BOMBER.shoulder.x, BOMBER.shoulder.y, BOMBER.shoulder.z);
    arm.rotation.x = BOMBER.restAngle;
    b.vis.add(arm);
    b.prism(0.095, 0.13, 6, blue, arm).rotation.z = Math.PI / 2;
    b.block(0.1, 0.22, 0.1, white, arm, 0.01, -0.14, 0, 0.03);
    b.lamp(0.02, 0.12, 0.03, arm, 0.065, -0.14, 0, 1.4);
    b.prism(0.055, 0.06, 6, silver, arm, 0.01, -0.27, 0);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const prong = b.block(0.035, 0.12, 0.035, navy, arm, Math.cos(a) * 0.12, -BOMBER.armLen + 0.03, Math.sin(a) * 0.12, 0.01);
      prong.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    }
    // 手の中の球（ためるほど大きくなる）
    const orb = new THREE.Group();
    orb.position.set(0, -BOMBER.armLen, 0);
    arm.add(orb);
    const core = new THREE.Mesh(sphereGeo(0.1), new THREE.MeshBasicMaterial({ color: 0xeaffff }));
    const shell = new THREE.Mesh(sphereGeo(0.15), new THREE.MeshBasicMaterial({ color: BOMBER.blastColor, transparent: true, opacity: 0.5, depthWrite: false }));
    const halo = new THREE.Mesh(sphereGeo(0.15), new THREE.MeshBasicMaterial({ color: BOMBER.blastColor, transparent: true, opacity: 0.2, depthWrite: false }));
    halo.scale.setScalar(1.9);
    const crackle = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const holder = new THREE.Group();
      const spark = new THREE.Mesh(boxGeo(0.02, 0.02, 0.2), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffffff : 0xbfeaff }));
      spark.position.z = 0.16;
      holder.add(spark);
      holder.rotation.set(i * 1.3, i * 1.9, i * 0.7);
      crackle.add(holder);
    }
    orb.add(halo, shell, core, crackle);
    b.parts.arm = arm;
    b.parts.orb = orb;
    b.parts.orbHalo = halo;
    b.parts.crackle = crackle;
    // 背中の電池（弱点）：ケース + 端子 + ブラケット
    b.block(0.26, 0.24, 0.1, navy, b.vis, 0, 0.03, -0.37, 0.03);
    for (const sx of [-1, 1]) {
      b.mesh(boxGeo(0.04, 0.05, 0.05), silver, b.vis, sx * 0.07, 0.17, -0.37);
      b.mesh(boxGeo(0.03, 0.2, 0.03), pale, b.vis, sx * 0.14, 0.03, -0.35);
    }
    b.weak(0, 0.03, -0.43, 0.2, [1.1, 0.9, 0.55], 0.1);
    return b.done();
  },
  update,
  animate,
};
