// 赤ドローン：ドローンの赤い版。吸収アームをつなぐとハッキング（abilities/hack.ts）ができ、
// 成功すると一定時間 味方になって、プレイヤーのまわりを飛びながらほかの敵を撃つ
import * as THREE from 'three';
import { HACK } from '../../config/balance';
import { spawnBurst } from '../../core/effects';
import { buildDroneWith, type DronePalette } from '../models';
import { animateDrone, updateDrone } from '../ai';
import { faceToward, moveFlyer } from '../common';
import { addHackCue, animateAllyLook, beginAllyFrame, clearAllyBolts, fireAllyBolt, updateAllyTarget } from './allyBolts';
import type { KindModule } from './kind';

/** 赤ドローンの味方時の調整値（弾・点滅などの共通値は allyBolts.ts の ALLY） */
export const REDDRONE_ALLY = {
  /** プレイヤーのまわりを周回する半径（m）と角速度（rad/s） */
  orbitRadius: 3.2,
  orbitSpeed: 0.7,
  /** プレイヤーの体の中心からの高さ（m） */
  hoverHeight: 1.5,
  /** プレイヤーからこれ以上離れたら追いつくために速く飛ぶ（m）と、その倍率 */
  catchUpDist: 12,
  catchUpMul: 2,
  /** 撃つ間隔（秒） */
  interval: 0.7,
  /** 1発のダメージ = ENEMIES.redDrone.damage × この倍率 */
  damageMul: 2.5,
  /** 撃つときに正面とのずれがこれ以内（cos） */
  aimCos: 0.9,
} as const;

/** 赤い配色：赤い胴体に、白銀の差し色と暗い赤のリング */
const RED_PALETTE: DronePalette = { white: 0xd8322c, blue: 0x7d1620, dark: 0x2b0d12, pale: 0xeef1f6, silver: 0xe9edf3, glow: 0xff6a3a };

const _spark = new THREE.Vector3();
const _want = new THREE.Vector3();
const _wish = new THREE.Vector3();

export const redDrone: KindModule = {
  knockback: 1,
  flying: true,
  hackable: true,

  build() {
    const lamps: THREE.MeshStandardMaterial[] = [];
    return buildDroneWith(RED_PALETTE, {
      lamps,
      decorate(b) {
        // 目は赤く
        for (const em of b.eyeMats) { em.color.setHex(0xffd0c4); em.emissive.setHex(0xff3a20); }
        // ハッキングできる印：上面のポートと、皿型アンテナ＋ビーコン（赤ウォーカーと同じ意匠）
        addHackCue(b, [0, 0.32, -0.08], [-0.14, 0.62, -0.1], 0.5, 0.75);
        b.parts.lamps = lamps;
      },
    });
  },

  update(c) {
    const { world, e, dt } = c;
    const jam = e.tethered;
    if (jam) {
      // つながれている間：ジャミングで周回も射撃もにぶる。火花が散る
      e.ai.alert = Math.max(e.ai.alert ?? 0, 4);
      e.ai.jamSparkT = (e.ai.jamSparkT ?? 0) - dt;
      if (e.ai.jamSparkT <= 0) {
        e.ai.jamSparkT = 0.09;
        spawnBurst(world, _spark.set(e.pos.x + (Math.random() - 0.5) * 0.5, e.pos.y + 0.3 + Math.random() * 0.3, e.pos.z + (Math.random() - 0.5) * 0.5), 0xffa04a, 2, 2.5, 0.25);
      }
    }
    updateDrone(c, jam ? { speedMul: HACK.jamSpeedMul, intervalMul: 1 / HACK.jamSpeedMul } : {});
  },

  /** 味方になっている間：プレイヤーのまわりを飛び、視界内の最も近い敵を撃つ */
  updateAlly(c) {
    const { world, e, dt, spec, pc } = c;
    const ai = e.ai;
    if (!beginAllyFrame(world, e, dt)) return;
    const target = updateAllyTarget(world, e, dt, spec.sightRange);

    // 位置：プレイヤーのまわりをゆっくり周回（離れたら速く追いつく）
    ai.orbitA = (ai.orbitA ?? e.id) + dt * REDDRONE_ALLY.orbitSpeed;
    const a = ai.orbitA as number;
    _want.set(
      pc.x + Math.cos(a) * REDDRONE_ALLY.orbitRadius,
      pc.y + REDDRONE_ALLY.hoverHeight + Math.sin(world.time * 1.3 + e.id) * 0.3,
      pc.z + Math.sin(a) * REDDRONE_ALLY.orbitRadius,
    );
    _wish.copy(_want).sub(e.pos).multiplyScalar(1.6);
    const far = e.pos.distanceTo(pc) > REDDRONE_ALLY.catchUpDist;
    const maxSp = spec.speed * (far ? REDDRONE_ALLY.catchUpMul : 1.2);
    if (_wish.length() > maxSp) _wish.setLength(maxSp);
    moveFlyer(world, e, dt, _wish, 8);

    if (target) {
      const dx = target.pos.x - e.pos.x, dz = target.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      faceToward(e, dx / d, dz / d, dt, 6);
      ai.atkTimer = (ai.atkTimer ?? 0.4) - dt;
      const yaw = ai.yaw ?? 0;
      const facing = Math.sin(yaw) * (dx / d) + Math.cos(yaw) * (dz / d);
      if (ai.atkTimer <= 0 && facing > REDDRONE_ALLY.aimCos) {
        // 砲口：ドローンの顔の前
        const from = new THREE.Vector3(e.pos.x + Math.sin(yaw) * 0.5, e.pos.y + 0.05, e.pos.z + Math.cos(yaw) * 0.5);
        fireAllyBolt(world, e, from, target, spec.damage * REDDRONE_ALLY.damageMul);
        ai.atkTimer = REDDRONE_ALLY.interval * (0.9 + Math.random() * 0.2);
      }
    } else {
      // 敵がいない：進む向き（なければプレイヤーのほう）を向く
      const vx = e.vel.x, vz = e.vel.z;
      if (Math.hypot(vx, vz) > 0.5) faceToward(e, vx, vz, dt, 4);
      else faceToward(e, pc.x - e.pos.x, pc.z - e.pos.z, dt, 3);
      ai.atkTimer = Math.max(ai.atkTimer ?? 0, 0.3);
    }
  },

  animate(_world, e, dt, down) {
    animateDrone(e, dt, down);
    animateAllyLook(e, down);
  },

  onGone(world, e) { clearAllyBolts(world, e); },
  onRemove(world, e) { clearAllyBolts(world, e); },
};
