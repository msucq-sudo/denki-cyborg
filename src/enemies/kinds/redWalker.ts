// 赤ウォーカー：ウォーカーの赤い版。吸収アームをつなぐとハッキング（abilities/hack.ts）ができ、
// 成功すると一定時間 味方になって、ほかの敵を撃つ
import * as THREE from 'three';
import { HACK } from '../../config/balance';
import type { Enemy, World } from '../../core/types';
import { hasLineOfSight, raycastLevel } from '../../core/collision';
import { isTargetable, raycastEnemies } from '../../core/enemyUtil';
import { spawnBurst } from '../../core/effects';
import { damageEnemy, shutdownEnemy } from '../api';
import { sphereGeo, boxGeo } from '../models';
import { faceToward, moveGround } from '../common';
import { animateWalker, buildWalker, updateWalker, type WalkerPalette } from './walker';
import type { KindModule } from './kind';

/** 赤ウォーカーの味方時の調整値 */
export const REDWALKER_ALLY = {
  /** 敵に近づくのをやめる距離（m） */
  stopDist: 6,
  /** プレイヤーからこれ以上離れたら、敵がいなくても追いかける（m） */
  followDist: 7,
  /** 撃つ間隔（秒） */
  interval: 0.9,
  /** 1発のダメージ = ENEMIES.redWalker.damage × この倍率 */
  damageMul: 2.5,
  /** 弾の速さ（m/s）と寿命（秒） */
  boltSpeed: 30,
  boltLife: 1.2,
  /** 残り時間がこれ以下になると点滅する（秒） */
  blinkTime: 5,
  /** 標的を探し直す間隔（秒） */
  scanInterval: 0.3,
  /** 撃つときに正面とのずれがこれ以内（cos） */
  aimCos: 0.93,
} as const;

/** 赤い配色：赤い胴体に、白銀の差し色と暗い赤の関節 */
const RED_PALETTE: WalkerPalette = { white: 0xd8322c, silver: 0xeef1f6, blue: 0x7d1620, navy: 0x2b0d12, glow: 0xff6a3a };
const CYAN = 0x40e0ff;
const BEACON_OFF = 0x0a2a33;

const _from = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
/** 味方の弾の見た目（共有。弾ごとに材質だけ作る） */
const BOLT_GEO = new THREE.SphereGeometry(0.12, 10, 8);

/** 味方の弾 */
interface Bolt { pos: THREE.Vector3; vel: THREE.Vector3; life: number; damage: number; mesh: THREE.Mesh }

function bolts(e: Enemy): Bolt[] {
  return (e.ai.bolts ??= []) as Bolt[];
}

function removeBolt(world: World, b: Bolt): void {
  world.scene.remove(b.mesh);
  (b.mesh.material as THREE.Material).dispose();
}

function clearBolts(world: World, e: Enemy): void {
  const list = e.ai.bolts as Bolt[] | undefined;
  if (!list) return;
  for (const b of list) removeBolt(world, b);
  list.length = 0;
}

export const redWalker: KindModule = {
  knockback: 0.5,
  hackable: true,

  build() {
    const lamps: THREE.MeshStandardMaterial[] = [];
    const m = buildWalker(RED_PALETTE, {
      lamps,
      decorate(b) {
        // 目は赤く
        for (const em of b.eyeMats) { em.color.setHex(0xffd0c4); em.emissive.setHex(0xff3a20); }
        const dark = b.body(0x2b0d12, 0.7, true), white = b.body(0xf2f5fa, 0.5, true);
        // ハッキングポート：背中の上に白いパネルと青緑の端子
        b.block(0.34, 0.04, 0.2, white, b.vis, 0, 0.5, -0.1, 0.012);
        const pin = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: CYAN, emissiveIntensity: 1.6, roughness: 0.4 });
        for (const px of [-0.1, -0.033, 0.033, 0.1]) b.mesh(boxGeo(0.03, 0.05, 0.1), pin, b.vis, px, 0.54, -0.1).castShadow = false;
        // アンテナ（ウォーカーより高い）：支柱 + 皿 + 先端のビーコン
        b.prism(0.02, 0.62, 4, dark, b.vis, 0.3, 0.82, -0.24);
        b.prism(0.16, 0.035, 8, white, b.vis, 0.3, 1.04, -0.24).rotation.x = -0.35;
        const beaconMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: CYAN, emissiveIntensity: 2, roughness: 0.3 });
        const beacon = b.mesh(sphereGeo(0.055), beaconMat, b.vis, 0.3, 1.16, -0.24);
        beacon.castShadow = false;
        b.parts.beacon = beacon;
        b.parts.pin = pin;
        b.parts.lamps = lamps;
      },
    });
    return m;
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
        spawnBurst(world, _from.set(e.pos.x + (Math.random() - 0.5) * 0.4, e.pos.y + 0.55, e.pos.z + (Math.random() - 0.5) * 0.4), 0xffa04a, 2, 2.5, 0.25);
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
    if (!ai.allyInit) {
      // 味方になった直後：敵だったときの射撃タイマーを持ち越さない
      ai.allyInit = true;
      ai.atkTimer = 0.3;
      ai.windup = 0;
    }
    ai.allyT = (ai.allyT ?? 0) - dt;
    updateBolts(world, e, dt);
    if (ai.allyT <= 0) {
      // 時間切れ：撃破扱いにせず停止
      world.events.emit('allyExpire', { pos: e.pos.clone() });
      shutdownEnemy(world, e);
      return;
    }

    // 標的：視界内で、壁にさえぎられていない最も近い敵
    ai.scanT = (ai.scanT ?? 0) - dt;
    const cur = ai.allyTarget as Enemy | undefined;
    if (cur && (!isTargetable(cur) || !world.enemies.includes(cur))) ai.allyTarget = undefined;
    if (ai.scanT <= 0 || !ai.allyTarget) {
      ai.scanT = REDWALKER_ALLY.scanInterval;
      ai.allyTarget = findTarget(world, e, spec.sightRange);
    }
    const target = ai.allyTarget as Enemy | undefined;

    let wishX = 0, wishZ = 0;
    ai.walk = 0;
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
        fireBolt(world, e, target, spec.damage * REDWALKER_ALLY.damageMul);
        ai.atkTimer = REDWALKER_ALLY.interval * (0.9 + Math.random() * 0.2);
      }
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
    const ai = e.ai;
    const m = ai.model;
    const t = ai.t ?? 0;
    const beacon = m.parts.beacon as THREE.Mesh | undefined;
    const beaconMat = beacon?.material as THREE.MeshStandardMaterial | undefined;
    if (e.allied) {
      tintAlly(e);
      if (down || !beaconMat) return;
      // 点滅：残り時間が少ないほど速く
      const left = ai.allyT ?? 0;
      const blink = left < REDWALKER_ALLY.blinkTime;
      const on = !blink || Math.sin(t * (14 + (REDWALKER_ALLY.blinkTime - left) * 4)) > 0;
      const glow = blink ? (on ? 0.9 : 0) : 0.22 + 0.08 * Math.sin(t * 5);
      for (const b of m.bodyMats) { b.mat.emissive.setHex(CYAN); b.mat.emissiveIntensity = glow; }
      beaconMat.emissive.setHex(CYAN);
      beaconMat.emissiveIntensity = blink ? (on ? 3 : 0.1) : 2.2;
    } else if (beaconMat && !down) {
      // ハッキングできる印：ビーコンがゆっくり点滅。つながれている間は速く
      const f = e.tethered ? 14 : 2.2;
      beaconMat.emissive.setHex(CYAN);
      beaconMat.emissiveIntensity = 0.3 + 2 * Math.max(0, Math.sin(t * f));
    }
    if (down && beaconMat) { beaconMat.emissive.setHex(BEACON_OFF); beaconMat.emissiveIntensity = 0; }
  },

  onGone(world, e) { clearBolts(world, e); },
  onRemove(world, e) { clearBolts(world, e); },
};

/** 味方の色：赤い部分を青緑系にする（初回だけ。元の色は ai.allyOrig に保存） */
function tintAlly(e: Enemy): void {
  const ai = e.ai;
  if (ai.allyTinted) return;
  ai.allyTinted = true;
  const m = ai.model;
  const hsl = { h: 0, s: 0, l: 0 };
  for (const b of m.bodyMats) {
    b.base.getHSL(hsl);
    // 赤（彩度が高い色）は青へ、銀・白は少し青みがかる程度
    b.base.setHSL(0.57, Math.min(0.85, hsl.s * 0.9 + 0.05), hsl.l);
  }
  for (const em of m.eyeMats) { em.color.setHex(0xc8f6ff); em.emissive.setHex(CYAN); }
  for (const lm of (m.parts.lamps ?? []) as THREE.MeshStandardMaterial[]) lm.emissive.setHex(CYAN);
}

/** 視界内（壁にさえぎられていない）で最も近い、撃てる敵 */
function findTarget(world: World, e: Enemy, sight: number): Enemy | undefined {
  let best: Enemy | undefined, bd = sight;
  for (const o of world.enemies) {
    if (o === e || !isTargetable(o)) continue;
    const d = o.pos.distanceTo(e.pos);
    if (d >= bd) continue;
    if (!hasLineOfSight(world.colliders, _from.set(e.pos.x, e.pos.y + 0.3, e.pos.z), o.pos)) continue;
    best = o; bd = d;
  }
  return best;
}

function fireBolt(world: World, e: Enemy, target: Enemy, damage: number): void {
  const yaw = e.ai.yaw ?? 0;
  // 砲口：ウォーカーと同じ位置（右肩の砲身の先）
  const from = new THREE.Vector3(
    e.pos.x + Math.cos(yaw) * 0.36 + Math.sin(yaw) * 0.75, e.pos.y + 0.3,
    e.pos.z - Math.sin(yaw) * 0.36 + Math.cos(yaw) * 0.75,
  );
  const dir = _dir.copy(target.pos).sub(from).normalize();
  const mat = new THREE.MeshBasicMaterial({ color: 0x7af0ff, transparent: true, opacity: 0.95 });
  const mesh = new THREE.Mesh(BOLT_GEO, mat);
  mesh.scale.set(1, 1, 3);
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(Z, dir);
  const glow = new THREE.Mesh(BOLT_GEO, new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.25, depthWrite: false }));
  glow.scale.setScalar(2);
  mesh.add(glow);
  world.scene.add(mesh);
  bolts(e).push({
    pos: from, vel: dir.clone().multiplyScalar(REDWALKER_ALLY.boltSpeed), life: REDWALKER_ALLY.boltLife, damage, mesh,
  });
  spawnBurst(world, from, 0x66e6ff, 3, 2, 0.2);
  e.ai.recoil = 1;
  world.events.emit('enemyAttack', { kind: 'walker', pos: e.pos.clone() });
}

/** 味方の弾を進める。敵に当たればダメージ、壁で消える */
function updateBolts(world: World, e: Enemy, dt: number): void {
  const list = bolts(e);
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    b.life -= dt;
    let dead = b.life <= 0;
    if (!dead) {
      _p1.copy(b.pos).addScaledVector(b.vel, dt);
      const hit = raycastEnemies(world.enemies, b.pos, _p1, 0.12);
      const tl = raycastLevel(world.colliders, b.pos, _p1);
      if (hit && (tl === null || hit.t <= tl)) {
        damageEnemy(world, hit.enemy, b.damage, { weak: hit.weak, how: 'shot', hitPos: hit.point });
        spawnBurst(world, hit.point, hit.weak ? 0xfff27a : 0x66e6ff, 7, 3);
        dead = true;
      } else if (tl !== null) {
        spawnBurst(world, b.pos.clone().lerp(_p1, tl), 0x66e6ff, 4, 2);
        dead = true;
      } else {
        b.pos.copy(_p1);
        b.mesh.position.copy(b.pos);
      }
    }
    if (dead) {
      removeBolt(world, b);
      list.splice(i, 1);
    }
  }
}
