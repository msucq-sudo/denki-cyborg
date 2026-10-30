// 赤ウォーカー：ウォーカーの赤い版。吸収アームをつなぐとハッキング（abilities/hack.ts）ができ、
// 成功すると一定時間 味方になって、ほかの敵を撃つ
import * as THREE from 'three';
import { HACK } from '../../config/balance';
import { spawnBurst } from '../../core/effects';
import { faceToward, moveGround } from '../common';
import { animateWalker, buildWalker, updateWalker, type WalkerPalette } from './walker';
import { addHackCue, animateAllyLook, beginAllyFrame, clearAllyBolts, fireAllyBolt, updateAllyTarget } from './allyBolts';
import type { KindModule } from './kind';

/** 赤ウォーカーの味方時の調整値（弾・点滅などの共通値は allyBolts.ts の ALLY） */
export const REDWALKER_ALLY = {
  /** 敵に近づくのをやめる距離（m） */
  stopDist: 6,
  /** プレイヤーからこれ以上離れたら、敵がいなくても追いかける（m） */
  followDist: 7,
  /** 撃つ間隔（秒） */
  interval: 0.9,
  /** 1発のダメージ = ENEMIES.redWalker.damage × この倍率 */
  damageMul: 2.5,
  /** 撃つときに正面とのずれがこれ以内（cos） */
  aimCos: 0.93,
} as const;

/** 赤い配色：赤い胴体に、白銀の差し色と暗い赤の関節 */
const RED_PALETTE: WalkerPalette = { white: 0xd8322c, silver: 0xeef1f6, blue: 0x7d1620, navy: 0x2b0d12, glow: 0xff6a3a };

const _spark = new THREE.Vector3();

export const redWalker: KindModule = {
  knockback: 0.5,
  hackable: true,

  build() {
    const lamps: THREE.MeshStandardMaterial[] = [];
    return buildWalker(RED_PALETTE, {
      lamps,
      decorate(b) {
        // 目は赤く
        for (const em of b.eyeMats) { em.color.setHex(0xffd0c4); em.emissive.setHex(0xff3a20); }
        // ハッキングできる印：背中の上にポート、ウォーカーより高い皿型アンテナとビーコン
        addHackCue(b, [0, 0.5, -0.1], [0.3, 0.82, -0.24], 0.62);
        b.parts.lamps = lamps;
      },
    });
  },

  update(c) {
    const { world, e, dt } = c;
    const jam = e.tethered;
    if (jam) {
      // つながれている間：ジャミングで動きも射撃もにぶる。火花が散る
      e.ai.alert = Math.max(e.ai.alert ?? 0, 4);
      e.ai.jamSparkT = (e.ai.jamSparkT ?? 0) - dt;
      if (e.ai.jamSparkT <= 0) {
        e.ai.jamSparkT = 0.09;
        spawnBurst(world, _spark.set(e.pos.x + (Math.random() - 0.5) * 0.4, e.pos.y + 0.55, e.pos.z + (Math.random() - 0.5) * 0.4), 0xffa04a, 2, 2.5, 0.25);
      }
    }
    updateWalker(c, jam
      ? { speedMul: HACK.jamSpeedMul, intervalMul: 1 / HACK.jamSpeedMul, sfxKind: 'walker' }
      : { sfxKind: 'walker' });
  },

  /** 味方になっている間：近くの敵を撃つ。敵がいなければプレイヤーについていく */
  updateAlly(c) {
    const { world, e, dt, spec, dist2d } = c;
    const ai = e.ai;
    if (!beginAllyFrame(world, e, dt)) return;
    const target = updateAllyTarget(world, e, dt, spec.sightRange);

    let wishX = 0, wishZ = 0;
    if (target) {
      const dx = target.pos.x - e.pos.x, dz = target.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      faceToward(e, dx / d, dz / d, dt, 5);
      if (d > REDWALKER_ALLY.stopDist) { wishX = (dx / d) * spec.speed; wishZ = (dz / d) * spec.speed; }
      // 射撃
      ai.atkTimer = (ai.atkTimer ?? 0.4) - dt;
      const yaw = ai.yaw ?? 0;
      const facing = Math.sin(yaw) * (dx / d) + Math.cos(yaw) * (dz / d);
      if (ai.atkTimer <= 0 && facing > REDWALKER_ALLY.aimCos) {
        // 砲口：ウォーカーと同じ位置（右肩の砲身の先）
        const from = new THREE.Vector3(
          e.pos.x + Math.cos(yaw) * 0.36 + Math.sin(yaw) * 0.75, e.pos.y + 0.3,
          e.pos.z - Math.sin(yaw) * 0.36 + Math.cos(yaw) * 0.75,
        );
        fireAllyBolt(world, e, from, target, spec.damage * REDWALKER_ALLY.damageMul);
        ai.atkTimer = REDWALKER_ALLY.interval * (0.9 + Math.random() * 0.2);
      }
    } else if (ai.guideTo) {
      // 案内中（レベルが ai.guideTo = {x, z} を置く）：その地点まで歩いて、着いたら待つ
      const g = ai.guideTo as { x: number; z: number; arrive?: number };
      const dx = g.x - e.pos.x, dz = g.z - e.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d > (g.arrive ?? 1)) {
        faceToward(e, dx / d, dz / d, dt, 4);
        wishX = (dx / d) * spec.speed; wishZ = (dz / d) * spec.speed;
      } else {
        // 着いた：プレイヤーのほうを向いて待つ
        const px = c.pc.x - e.pos.x, pz = c.pc.z - e.pos.z, pd = Math.hypot(px, pz) || 1;
        faceToward(e, px / pd, pz / pd, dt, 3);
      }
      ai.atkTimer = Math.max(ai.atkTimer ?? 0, 0.3);
    } else {
      // 敵がいない：プレイヤーのほうへ
      const dx = c.pc.x - e.pos.x, dz = c.pc.z - e.pos.z;
      const d = dist2d || 1;
      if (d > REDWALKER_ALLY.followDist) {
        faceToward(e, dx / d, dz / d, dt, 3);
        wishX = (dx / d) * spec.speed; wishZ = (dz / d) * spec.speed;
      }
      ai.atkTimer = Math.max(ai.atkTimer ?? 0, 0.3);
    }
    moveGround(world, e, dt, wishX, wishZ, 6);
    ai.walk = Math.hypot(e.vel.x, e.vel.z);
  },

  animate(world, e, dt, down) {
    animateWalker(world, e, dt, down);
    animateAllyLook(e, down);
  },

  onGone(world, e) { clearAllyBolts(world, e); },
  onRemove(world, e) { clearAllyBolts(world, e); },
};
