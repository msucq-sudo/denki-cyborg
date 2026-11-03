// 赤メディック：メディックの赤い版。敵のときはメディックと同じ（傷ついた仲間とドームを回復、隠れてついていく、プレイヤーから逃げる）。
// 吸収アームをつなぐとハッキング（abilities/hack.ts）ができ、成功すると一定時間 味方になって、
// プレイヤーのそばについていき、傷ついたプレイヤーと味方の敵を回復する
import * as THREE from 'three';
import { HACK, PLAYER } from '../../config/balance';
import { spawnBurst } from '../../core/effects';
import { healPlayer } from '../../core/combat';
import { hasLineOfSight } from '../../core/collision';
import { buildMedicWith, animateMedic, updateMedic, MEDIC, type MedicPalette } from './medic';
import { faceToward, moveGround } from '../common';
import { addHackCue, animateAllyLook, beginAllyFrame } from './allyBolts';
import type { Enemy, World } from '../../core/types';
import type { KindModule } from './kind';

/** 赤メディックの味方時の調整値（点滅などの共通値は allyBolts.ts の ALLY） */
export const REDMEDIC_ALLY = {
  /** プレイヤーのそばで保つ距離（m）。これより遠いと近づく */
  followDist: 3,
  /** プレイヤーを回復する：毎秒の回復量（最大HPの割合）。傷ついた味方の敵は max(minHeal, 最大HP × healFrac) */
  playerHealFrac: 0.07,
  /** 回復相手を探し直す間隔（秒） */
  scanInterval: 0.3,
} as const;

/** 赤い配色：赤い胴体に、暗い赤のバイザー */
const RED_PALETTE: MedicPalette = { white: 0xd8322c, navy: 0x2b0d12, pale: 0xa81f28, lamp: 0xff6a3a };

const _a = new THREE.Vector3();
const _spark = new THREE.Vector3();

function chest(world: World): THREE.Vector3 {
  const p = world.player;
  return _a.set(p.pos.x, p.pos.y + PLAYER.height * 0.6, p.pos.z);
}

/** 味方の敵で、傷ついていて近い順に一番弱っているもの */
function pickHurtAlly(world: World, e: Enemy): Enemy | undefined {
  let best: Enemy | undefined, bs = Infinity;
  for (const o of world.enemies) {
    if (o === e || !o.allied || o.status === 'dead' || o.status === 'down' || o.hp >= o.maxHp - 0.5) continue;
    const d = o.pos.distanceTo(e.pos);
    if (d > MEDIC.scanRange) continue;
    const score = (o.hp / o.maxHp) * 10 + d * 0.25;
    if (score < bs) { bs = score; best = o; }
  }
  return best;
}

export const redMedic: KindModule = {
  knockback: 1,
  hackable: true,

  build() {
    return buildMedicWith(RED_PALETTE, (b) => {
      for (const em of b.eyeMats) { em.color.setHex(0xffd0c4); em.emissive.setHex(0xff3a20); }
      // ハッキングできる印：頭の横のポートと、小さな皿型アンテナ＋ビーコン
      addHackCue(b, [0, 0.215, -0.1], [0.12, 0.32, -0.12], 0.3, 0.45);
    });
  },

  update(c) {
    const { world, e, dt } = c;
    if (!e.tethered) { updateMedic(c); return; }
    // つながれている間：ジャミングで動きがにぶる。火花が散る
    e.ai.alert = Math.max(e.ai.alert ?? 0, 4);
    e.ai.jamSparkT = (e.ai.jamSparkT ?? 0) - dt;
    if (e.ai.jamSparkT <= 0) {
      e.ai.jamSparkT = 0.09;
      spawnBurst(world, _spark.set(e.pos.x + (Math.random() - 0.5) * 0.3, e.pos.y + 0.2, e.pos.z + (Math.random() - 0.5) * 0.3), 0xffa04a, 2, 2.5, 0.25);
    }
    updateMedic({ ...c, spec: { ...c.spec, speed: c.spec.speed * HACK.jamSpeedMul } });
  },

  /** 味方になっている間：プレイヤーのそばについていき、傷ついたプレイヤー→傷ついた味方の順に回復する */
  updateAlly(c) {
    const { world, e, dt, spec } = c;
    const ai = e.ai;
    if (!beginAllyFrame(world, e, dt)) return;
    const p = world.player;

    // 回復相手：プレイヤーが傷ついていればプレイヤー、そうでなければ傷ついた味方の敵
    ai.scanT = (ai.scanT ?? 0) - dt;
    if (ai.scanT <= 0) { ai.scanT = REDMEDIC_ALLY.scanInterval; ai.allyHurt = pickHurtAlly(world, e); }
    let hurtAlly = ai.allyHurt as Enemy | undefined;
    if (hurtAlly && (!world.enemies.includes(hurtAlly) || !hurtAlly.allied || hurtAlly.hp >= hurtAlly.maxHp - 0.01 || hurtAlly.status === 'dead' || hurtAlly.status === 'down')) hurtAlly = ai.allyHurt = undefined;
    const healPlayerNow = p.hp > 0 && p.hp < p.maxHp - 0.01;
    const tpos = healPlayerNow ? chest(world) : hurtAlly?.pos;

    // 行きたい場所：回復相手（なければプレイヤー）のそば
    const gx = (healPlayerNow || !hurtAlly ? p.pos.x : hurtAlly.pos.x) - e.pos.x;
    const gz = (healPlayerNow || !hurtAlly ? p.pos.z : hurtAlly.pos.z) - e.pos.z;
    const gd = Math.hypot(gx, gz) || 1;
    let wx = 0, wz = 0;
    const hold = healPlayerNow ? MEDIC.standOff : REDMEDIC_ALLY.followDist;
    if (gd > hold) { wx = (gx / gd) * spec.speed; wz = (gz / gd) * spec.speed; }
    moveGround(world, e, dt, wx, wz, 14);
    ai.walk = Math.hypot(e.vel.x, e.vel.z);

    // アームを伸ばして回復
    let healing = false;
    if (tpos) {
      const org = e.pos;
      const reachD = org.distanceTo(tpos) - (healPlayerNow ? PLAYER.radius : hurtAlly!.radius) * 0.6;
      if (reachD <= MEDIC.reach && hasLineOfSight(world.colliders, org, tpos)) {
        healing = true;
        faceToward(e, tpos.x - e.pos.x, tpos.z - e.pos.z, dt, 10);
        ai.armGoal = Math.max(MEDIC.foldedLen, reachD);
        // アームの回復中の向き・長さの表示は medic の animate が ai.healTarget.pos を見る
        ai.healTarget = { pos: tpos.clone() };
        if (ai.armLen >= ai.armGoal - 0.15) {
          if (healPlayerNow) healPlayer(world, p.maxHp * REDMEDIC_ALLY.playerHealFrac * dt);
          else if (hurtAlly) hurtAlly.hp = Math.min(hurtAlly.maxHp, hurtAlly.hp + Math.max(MEDIC.minHeal, hurtAlly.maxHp * MEDIC.healFrac) * dt);
          ai.healFx = (ai.healFx ?? 0) - dt;
          if (ai.healFx <= 0) {
            ai.healFx = 0.22;
            spawnBurst(world, _spark.set(tpos.x + (Math.random() - 0.5) * 0.4, tpos.y + (Math.random() - 0.5) * 0.6, tpos.z + (Math.random() - 0.5) * 0.4), MEDIC.color, 3, 1.4, 0.55);
          }
        }
      }
    }
    if (!healing) {
      ai.armGoal = MEDIC.foldedLen;
      ai.healTarget = undefined;
      if (Math.hypot(wx, wz) > 0.3) faceToward(e, wx, wz, dt, 8);
      else faceToward(e, p.pos.x - e.pos.x, p.pos.z - e.pos.z, dt, 3);
    }
    if (healing && !ai.healing) world.events.emit('enemyAction', { kind: 'medic', pos: e.pos.clone(), action: 'healStart' });
    ai.healing = healing;
  },

  animate(world, e, dt, down) {
    animateMedic(world, e, dt, down);
    animateAllyLook(e, down);
  },
};
