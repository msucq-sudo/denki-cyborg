// 赤クローラー：クローラーの赤い版。動きは同じ（走って体当たり・弾をよける）。吸収アームをつなぐとハッキング
// （abilities/hack.ts）ができ、成功すると一定時間 味方になって、近くの敵に飛びかかる
import * as THREE from 'three';
import { HACK } from '../../config/balance';
import { spawnBurst } from '../../core/effects';
import { buildCrawlerWith, type CrawlerPalette } from '../models';
import { animateCrawler, updateCrawler } from '../ai';
import { faceToward, moveGround } from '../common';
import { damageEnemy } from '../api';
import { addHackCue, animateAllyLook, beginAllyFrame, updateAllyTarget } from './allyBolts';
import type { KindModule } from './kind';

/** 赤クローラーの味方時の調整値（点滅などの共通値は allyBolts.ts の ALLY） */
export const REDCRAWLER_ALLY = {
  /** 敵がいないとき、プレイヤーからこれ以上離れたら追いかける（m） */
  followDist: 5,
  /** この距離（m）まで近づいたら飛びかかる */
  lungeRange: 2.6,
  /** 飛びかかる前のため（秒）・飛びかかる時間（秒）・速さ（m/s）・着地後の硬直（秒） */
  windup: 0.22,
  lungeTime: 0.3,
  lungeSpeed: 14,
  recover: 0.35,
  /** 次に飛びかかるまでの間隔（秒） */
  cooldown: 0.5,
  /** 1回のダメージ = ENEMIES.redCrawler.damage × この倍率 */
  damageMul: 3.5,
} as const;

/** 赤い配色：赤い胴体に、白銀の差し色と暗い赤の関節 */
const RED_PALETTE: CrawlerPalette = { white: 0xd8322c, silver: 0xeef1f6, dark: 0x2b0d12, deep: 0x7d1620, blue: 0xa81f28, glow: 0xff6a3a };

const _spark = new THREE.Vector3();

export const redCrawler: KindModule = {
  knockback: 1,
  hackable: true,

  build() {
    const lamps: THREE.MeshStandardMaterial[] = [];
    return buildCrawlerWith(RED_PALETTE, {
      lamps,
      decorate(b) {
        // 目は赤く
        for (const em of b.eyeMats) { em.color.setHex(0xffd0c4); em.emissive.setHex(0xff3a20); }
        // ハッキングできる印：前の甲板のポートと、背中の脇の皿型アンテナ＋ビーコン
        addHackCue(b, [0, 0.335, 0.2], [0.26, 0.62, 0.12], 0.56, 0.62);
        b.parts.lamps = lamps;
      },
    });
  },

  update(c) {
    const { world, e, dt } = c;
    if (!e.tethered) { updateCrawler(c); return; }
    // つながれている間：ジャミングで動きも攻撃もにぶる。火花が散る
    e.ai.alert = Math.max(e.ai.alert ?? 0, 4);
    e.ai.jamSparkT = (e.ai.jamSparkT ?? 0) - dt;
    if (e.ai.jamSparkT <= 0) {
      e.ai.jamSparkT = 0.09;
      spawnBurst(world, _spark.set(e.pos.x + (Math.random() - 0.5) * 0.5, e.pos.y + 0.4, e.pos.z + (Math.random() - 0.5) * 0.5), 0xffa04a, 2, 2.5, 0.25);
    }
    updateCrawler({
      ...c,
      spec: { ...c.spec, speed: c.spec.speed * HACK.jamSpeedMul, attackInterval: c.spec.attackInterval / HACK.jamSpeedMul },
    });
  },

  /** 味方になっている間：近くの敵へ走って飛びかかる。敵がいなければプレイヤーについていく */
  updateAlly(c) {
    const { world, e, dt, spec, dist2d } = c;
    const ai = e.ai;
    if (!beginAllyFrame(world, e, dt)) return;
    if (!ai.crawlerAlly) { ai.crawlerAlly = true; ai.state = 'chase'; ai.stateT = 0; ai.atkTimer = 0.3; }
    const target = updateAllyTarget(world, e, dt, spec.sightRange);
    ai.atkTimer = Math.max(0, (ai.atkTimer ?? 0) - dt);

    let wx = 0, wz = 0, accel = 30;
    switch (ai.state) {
      case 'windup': {
        ai.stateT -= dt;
        accel = 60;
        if (target) {
          const dx = target.pos.x - e.pos.x, dz = target.pos.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
          faceToward(e, dx / d, dz / d, dt, 16);
          if (ai.stateT > 0.08) ai.lunge = { x: dx / d, z: dz / d };
        }
        ai.warn = 1 - Math.max(0, ai.stateT) / REDCRAWLER_ALLY.windup;
        if (ai.stateT <= 0) {
          ai.warn = 0;
          ai.state = 'lunge'; ai.stateT = REDCRAWLER_ALLY.lungeTime; ai.hitDone = false;
          world.events.emit('enemyAttack', { kind: 'crawler', pos: e.pos.clone() });
        }
        break;
      }
      case 'lunge': {
        ai.stateT -= dt;
        const L = ai.lunge as { x: number; z: number };
        wx = L.x * REDCRAWLER_ALLY.lungeSpeed; wz = L.z * REDCRAWLER_ALLY.lungeSpeed; accel = 200;
        if (!ai.hitDone && target && target.pos.distanceTo(e.pos) < e.radius + target.radius + 0.25) {
          damageEnemy(world, target, spec.damage * REDCRAWLER_ALLY.damageMul, { how: 'shot', hitPos: target.pos.clone() });
          spawnBurst(world, target.pos, 0x7af0ff, 8, 3.5);
          ai.hitDone = true;
        }
        if (ai.stateT <= 0) { ai.state = 'recover'; ai.stateT = REDCRAWLER_ALLY.recover; ai.atkTimer = REDCRAWLER_ALLY.cooldown; }
        break;
      }
      case 'recover': {
        ai.stateT -= dt;
        accel = 40;
        if (ai.stateT <= 0) ai.state = 'chase';
        break;
      }
      default: {
        ai.state = 'chase';
        if (target) {
          const dx = target.pos.x - e.pos.x, dz = target.pos.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
          faceToward(e, dx / d, dz / d, dt, 12);
          wx = (dx / d) * spec.speed; wz = (dz / d) * spec.speed;
          if (d < REDCRAWLER_ALLY.lungeRange && ai.atkTimer <= 0 && Math.abs(target.pos.y - e.pos.y) < 2.2) {
            ai.state = 'windup'; ai.stateT = REDCRAWLER_ALLY.windup; ai.lunge = { x: dx / d, z: dz / d };
          }
        } else if (ai.guideTo) {
          // 案内中（レベルが ai.guideTo = {x, z} を置く）：その地点まで走って、着いたら待つ
          const g = ai.guideTo as { x: number; z: number; arrive?: number };
          const dx = g.x - e.pos.x, dz = g.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
          if (d > (g.arrive ?? 1)) { faceToward(e, dx / d, dz / d, dt, 10); wx = (dx / d) * spec.speed; wz = (dz / d) * spec.speed; }
        } else {
          // 敵がいない：プレイヤーのほうへ
          const dx = c.pc.x - e.pos.x, dz = c.pc.z - e.pos.z, d = dist2d || 1;
          if (d > REDCRAWLER_ALLY.followDist) { faceToward(e, dx / d, dz / d, dt, 10); wx = (dx / d) * spec.speed; wz = (dz / d) * spec.speed; }
        }
        break;
      }
    }
    moveGround(world, e, dt, wx, wz, accel);
    ai.walk = Math.hypot(e.vel.x, e.vel.z);
  },

  animate(_world, e, dt, down) {
    animateCrawler(e, dt, down);
    animateAllyLook(e, down);
  },
};
