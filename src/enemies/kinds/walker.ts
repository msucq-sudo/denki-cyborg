import * as THREE from 'three';
import { Builder, COLORS, boxGeo, wedgeGeo, type Model } from '../models';
import { moveGround, faceToward, type Ctx } from '../common';
import { fireAt } from '../ai';
import type { KindModule } from './kind';
import type { Enemy, World } from '../../core/types';
import type { EnemyKind } from '../../config/balance';

/** ウォーカーの調整値：一輪で転がる砲台。何も考えずにまっすぐ近づき、撃ち続ける */
export const WALKER = {
  /** これより近いと前進をやめる（m） */
  stopDist: 4.5,
  windup: 0.4,
  /** 弾の乱れ */
  spread: 0.025,
  wheelRadius: 0.42,
} as const;

const _from = new THREE.Vector3();

/** ウォーカー系の配色（赤ウォーカーなどが差し替える） */
export interface WalkerPalette {
  white: number; silver: number; blue: number; navy: number;
  /** ランプの発光色。省略すると標準の青いランプ */
  glow?: number;
}

/** 標準のウォーカー（白と青） */
export const WALKER_PALETTE: WalkerPalette = { white: COLORS.white, silver: COLORS.silver, blue: COLORS.blue, navy: COLORS.navy };

/** 調整用の速度・攻撃間隔の倍率（既定は等倍） */
export interface WalkerTune {
  speedMul?: number;
  intervalMul?: number;
  /** 発射音のために通知する敵の種類（色違いが元のウォーカーの音を借りる） */
  sfxKind?: EnemyKind;
}

/**
 * 色違いのウォーカーを組み立てる。
 * lamps には色を変えられるランプの材質を集める。decorate は仕上げ前に呼ばれ、パーツの追加や目の色変更ができる
 */
export function buildWalker(
  pal: WalkerPalette = WALKER_PALETTE,
  opts: { lamps?: THREE.MeshStandardMaterial[]; decorate?(b: Builder): void } = {},
): Model {
  const b = new Builder();
  const white = b.body(pal.white, 0.5, true), silver = b.body(pal.silver, 0.5, true), blue = b.body(pal.blue, 0.5, true), navy = b.body(pal.navy, 0.7, true);
  // ランプ：標準は青。glow 指定があればその色の発光材質を使い、後から色を変えられるよう lamps に集める
  const lamp = (w: number, h: number, d: number, parent: THREE.Object3D, x: number, y: number, z: number, intensity = 1.4): THREE.Mesh => {
    if (pal.glow === undefined) return b.lamp(w, h, d, parent, x, y, z, intensity);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: pal.glow, emissiveIntensity: intensity, roughness: 0.4 });
    opts.lamps?.push(m);
    const me = b.mesh(boxGeo(w, h, d), m, parent, x, y, z);
    me.castShadow = false;
    return me;
  };
  // 一輪（下）：八角タイヤ + ハブ + 星形スポーク
  const wheel = new THREE.Group();
  wheel.position.set(0, -0.28, 0);
  b.vis.add(wheel);
  b.prism(0.42, 0.26, 8, navy, wheel).rotation.z = Math.PI / 2;
  for (const sx of [-1, 1]) b.prism(0.36, 0.04, 8, silver, wheel, sx * 0.13, 0, 0).rotation.z = Math.PI / 2;
  b.prism(0.27, 0.27, 6, blue, wheel).rotation.z = Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const spoke = b.block(0.28, 0.07, 0.7, silver, wheel, 0, 0, 0, 0.02);
    spoke.rotation.x = (i / 3) * Math.PI;
  }
  // 車輪カバー（左右のフェンダー）
  for (const sx of [-1, 1]) b.block(0.07, 0.46, 0.78, white, b.vis, sx * 0.22, -0.1, 0, 0.025);
  // 胴体：面取りの砲台ボックス + 傾斜した肩
  b.block(0.9, 0.55, 0.84, white, b.vis, 0, 0.22, 0, 0.09);
  b.mesh(wedgeGeo(0.9, 0.16, 0.5), silver, b.vis, 0, 0.55, -0.1);
  for (const sx of [-1, 1]) {
    lamp(0.03, 0.04, 0.6, b.vis, sx * 0.455, 0.2, 0.0);
    for (const z of [-0.3, 0.05]) b.mesh(boxGeo(0.02, 0.3, 0.025), navy, b.vis, sx * 0.455, 0.25, z);
  }
  // 顔：バイザーとスリットの目
  b.block(0.52, 0.22, 0.1, navy, b.vis, 0, 0.3, 0.41, 0.03);
  b.mesh(boxGeo(0.4, 0.07, 0.04), b.eye(), b.vis, 0, 0.31, 0.47);
  // 長い砲身（右肩）：関節 + シュラウド + 角柱の砲身 + マズルブレーキ
  const gun = new THREE.Group();
  gun.position.set(0.36, 0.3, 0.05);
  b.vis.add(gun);
  b.prism(0.13, 0.2, 6, blue, gun).rotation.z = Math.PI / 2;
  b.block(0.17, 0.17, 0.3, navy, gun, 0, 0, 0.2, 0.03);
  b.prism(0.06, 0.62, 8, silver, gun, 0, 0, 0.4).rotation.x = Math.PI / 2;
  b.block(0.14, 0.14, 0.1, navy, gun, 0, 0, 0.68, 0.025);
  lamp(0.07, 0.07, 0.03, gun, 0, 0, 0.74, 1.8);
  // 背中のバッテリー（弱点）：ケース + ブラケット
  b.block(0.44, 0.1, 0.22, navy, b.vis, 0, 0.4, -0.4, 0.03);
  for (const sx of [-1, 1]) b.mesh(boxGeo(0.04, 0.16, 0.04), navy, b.vis, sx * 0.2, 0.48, -0.4);
  b.prism(0.015, 0.2, 4, navy, b.vis, -0.3, 0.7, -0.15);
  b.weak(0, 0.5, -0.38, 0.22, [1.2, 0.8, 0.9], 0.15);
  b.parts.wheel = wheel;
  b.parts.gun = gun;
  opts.decorate?.(b);
  return b.done();
}

/** ウォーカーの AI：まっすぐ近づいて撃つ。tune で速度・攻撃間隔を変えられる（赤ウォーカーのジャム用） */
export function updateWalker(c: Ctx, tune: WalkerTune = {}): void {
  const { world, e, dt, spec, pc, dirXZ, dist, dist2d, los } = c;
  const ai = e.ai;
  ai.atkTimer = (ai.atkTimer ?? 0.8 + Math.random()) - dt;
  if (e.status === 'stunned') {
    ai.stunT = (ai.stunT ?? 0) - dt;
    moveGround(world, e, dt, 0, 0, 20);
    ai.walk = 0;
    if (ai.stunT <= 0) e.status = 'active';
    return;
  }
  if (ai.alert <= 0) { moveGround(world, e, dt, 0, 0, 10); ai.walk = 0; ai.warn = 0; return; }

  // まっすぐ前進（遮蔽も横移動もしない）
  faceToward(e, dirXZ.x, dirXZ.z, dt, 3);
  const go = !los || dist2d > WALKER.stopDist;
  const sp = go ? spec.speed * (tune.speedMul ?? 1) : 0;
  moveGround(world, e, dt, dirXZ.x * sp, dirXZ.z * sp, 6);
  ai.walk = Math.hypot(e.vel.x, e.vel.z);

  // 射撃：予告 → 単発。歩きながら撃ち続ける
  if (ai.windup > 0) {
    ai.windup -= dt;
    ai.warn = 1 - Math.max(0, ai.windup) / WALKER.windup;
    if (ai.windup <= 0) {
      ai.warn = 0;
      if (los) {
        const yaw = ai.yaw ?? 0;
        _from.set(
          e.pos.x + Math.cos(yaw) * 0.36 + Math.sin(yaw) * 0.75, e.pos.y + 0.3,
          e.pos.z - Math.sin(yaw) * 0.36 + Math.cos(yaw) * 0.75,
        );
        const lead = pc.clone().addScaledVector(world.player.vel, Math.min(0.2, dist / spec.projectileSpeed * 0.2));
        fireAt(world, _from.clone(), lead, spec.projectileSpeed, spec.damage, WALKER.spread, 0.2);
        world.events.emit('enemyAttack', { kind: tune.sfxKind ?? e.kind, pos: e.pos.clone() });
        ai.recoil = 1;
      }
      ai.atkTimer = spec.attackInterval * (tune.intervalMul ?? 1) * (0.9 + Math.random() * 0.2);
    }
  } else if (ai.atkTimer <= 0 && los) {
    ai.windup = WALKER.windup;
  }
}

/** ウォーカーのアニメ（車輪・前傾・反動・倒れ） */
export function animateWalker(_world: World, e: Enemy, dt: number, down: boolean): void {
  const ai = e.ai;
  const p = ai.model.parts;
  const vis = ai.model.vis as THREE.Group;
  ai.recoil = Math.max(0, (ai.recoil ?? 0) - dt * 6);
  if (!down) {
    // 車輪を進んだ距離ぶん回す・体を少し前傾
    (p.wheel as THREE.Group).rotation.x += ((ai.walk ?? 0) / WALKER.wheelRadius) * dt;
    vis.rotation.x = THREE.MathUtils.lerp(vis.rotation.x, Math.min(0.12, (ai.walk ?? 0) * 0.06), Math.min(1, dt * 6));
    vis.position.y += Math.sin((ai.t ?? 0) * 6) * 0.015 * Math.min(1, (ai.walk ?? 0));
    (p.gun as THREE.Group).position.z = 0.05 - ai.recoil * 0.12;
    (p.gun as THREE.Group).rotation.x = -(ai.warn ?? 0) * 0.08 - ai.recoil * 0.25;
  } else {
    // 横倒し
    vis.rotation.z = (ai.tilt ?? 1) * 1.3 * ai.collapse;
    vis.position.y = -0.25 * ai.collapse;
  }
}

export const walker: KindModule = {
  knockback: 0.7,
  build() { return buildWalker(); },
  update(c) { updateWalker(c); },
  animate(world, e, dt, down) { animateWalker(world, e, dt, down); },
};
