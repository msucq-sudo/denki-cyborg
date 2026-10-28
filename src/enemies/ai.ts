import * as THREE from 'three';
import { PLAYER } from '../config/balance';
import type { Enemy, World } from '../core/types';
import { hasLineOfSight, raycastLevel } from '../core/collision';
import { damagePlayer, PLAYER_HIT_RADIUS } from '../core/combat';
import { spawnProjectile } from '../core/projectiles';
import { spawnBurst, spawnShockwave } from '../core/effects';
import { approach, faceToward, moveFlyer, moveGround, type Ctx } from './common';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** 弾を撃つ。from → target 方向に spread（ラジアン程度の乱れ）を付ける */
export function fireAt(
  world: World, from: THREE.Vector3, target: THREE.Vector3, speed: number, damage: number, spread = 0.02,
  size = 0.2, color = 0xff7a3d,
): void {
  const dir = _v.copy(target).sub(from).normalize();
  dir.x += (Math.random() - 0.5) * spread * 2;
  dir.y += (Math.random() - 0.5) * spread * 2;
  dir.z += (Math.random() - 0.5) * spread * 2;
  dir.normalize();
  spawnProjectile(world, {
    pos: from.clone(), vel: dir.clone().multiplyScalar(speed), damage, owner: 'enemy',
    radius: size * 0.8, size, life: 4, color,
  });
}

/** 予備動作（0..1）を設定。見た目側が赤く光らせる */
function warn(e: Enemy, k: number): void { e.ai.warn = k; }

// ---------------------------------------------------------------- drone
export function updateDrone(c: Ctx): void {
  const { world, e, dt, spec, pc } = c;
  const ai = e.ai;
  ai.t = (ai.t ?? 0) + dt;
  const wish = _w.set(0, 0, 0);
  const awake = ai.alert > 0;
  if (!awake) {
    // 待機：ゆっくり上下
    wish.y = Math.sin(world.time * 1.3 + e.id) * 0.4;
    moveFlyer(world, e, dt, wish, 6);
    return;
  }
  // 周回方向を時々反転
  ai.orbitTimer = (ai.orbitTimer ?? 0) - dt;
  if (ai.orbitTimer <= 0 || ai.orbitDir === undefined) {
    ai.orbitDir = Math.random() < 0.5 ? 1 : -1;
    ai.orbitTimer = 2 + Math.random() * 2.5;
    ai.prefDist = 9.5 + Math.random() * 3;
  }
  const d2 = c.dist2d;
  const speed = spec.speed;
  // 放射方向（プレイヤーへ向かう）と接線
  const rx = c.dirXZ.x, rz = c.dirXZ.z;
  const tx = -rz * ai.orbitDir, tz = rx * ai.orbitDir;
  let radial = 0;
  if (!c.los) radial = 1;                        // 見えなければ近づく
  else if (d2 < 8) radial = -1;
  else if (d2 > 14) radial = 1;
  else radial = THREE.MathUtils.clamp((d2 - ai.prefDist) * 0.3, -0.5, 0.5);
  const tang = c.los ? (ai.windup > 0 ? 0.3 : 0.75) : 0.2;
  wish.x = (rx * radial + tx * tang) * speed;
  wish.z = (rz * radial + tz * tang) * speed;
  // 高さ：プレイヤーの頭上くらいを漂う
  const wantY = pc.y + 1.6 + Math.sin(world.time * 1.1 + e.id) * 0.5;
  wish.y = THREE.MathUtils.clamp((wantY - e.pos.y) * 1.2, -speed, speed);
  const hit = moveFlyer(world, e, dt, wish, 7);
  if (hit && ai.orbitTimer > 0.4) ai.orbitDir *= -1;
  faceToward(e, rx, rz, dt, 6);

  // 攻撃：予備動作 0.35 秒 → 発射
  ai.atkTimer = (ai.atkTimer ?? 0.8 + Math.random() * 1.2) - dt;
  if (ai.windup > 0) {
    ai.windup -= dt;
    warn(e, 1 - Math.max(0, ai.windup) / 0.35);
    if (ai.windup <= 0) {
      warn(e, 0);
      if (c.los) {
        const from = _v.set(Math.sin(ai.yaw ?? 0) * 0.5, 0.05, Math.cos(ai.yaw ?? 0) * 0.5).add(e.pos).clone();
        // 少し先読み（弱め）
        const lead = pc.clone().addScaledVector(world.player.vel, Math.min(0.25, c.dist / spec.projectileSpeed * 0.3));
        fireAt(world, from, lead, spec.projectileSpeed, spec.damage, 0.015);
        world.events.emit('enemyAttack', { kind: 'drone', pos: e.pos.clone() });
      }
      ai.atkTimer = spec.attackInterval * (0.85 + Math.random() * 0.3);
    }
  } else if (ai.atkTimer <= 0 && c.los && c.dist < spec.sightRange) {
    ai.windup = 0.35;
  }
}

// ---------------------------------------------------------------- crawler
export const CRAWLER = {
  windup: 0.4,
  /** 回避：弾の接近検知距離 / 最接近がこの値未満なら避ける */
  dodgeSense: 6,
  dodgeMiss: 1.2,
  dodgeChance: 0.45,
  dodgeCooldown: 1.5,
  dodgeTime: 0.22,
  dodgeSpeed: 12,
  /** 吸収中の猛攻 */
  aggroSpeed: 1.3,
  aggroCooldown: 0.35,
  aggroWindup: 0.7,
};

/** 自分に向かってくるプレイヤー弾を探す（最も近いもの） */
function findIncomingBullet(world: World, e: Enemy) {
  let best: { p: World['projectiles'][number]; dir: THREE.Vector3; side: number } | null = null;
  let bestD = Infinity;
  for (const p of world.projectiles) {
    if (p.owner !== 'player' || p.dead) continue;
    const sp = p.vel.length();
    if (sp < 0.01) continue;
    const dir = p.vel.clone().divideScalar(sp);
    const rel = _v.copy(e.pos).sub(p.pos); // 弾 → 敵
    const t = rel.dot(dir);
    if (t < 0 || rel.length() > CRAWLER.dodgeSense) continue;
    const off = rel.clone().addScaledVector(dir, -t); // 弾道から敵へのずれ
    if (off.length() >= CRAWLER.dodgeMiss) continue;
    if (t < bestD) {
      bestD = t;
      // 弾道に対する敵の側（左右）。ほぼ正面ならランダム
      const cross = dir.x * rel.z - dir.z * rel.x;
      best = { p, dir, side: Math.abs(cross) > 0.05 ? Math.sign(cross) : (Math.random() < 0.5 ? 1 : -1) };
    }
  }
  return best;
}

export function updateCrawler(c: Ctx): void {
  const { world, e, dt, spec } = c;
  const ai = e.ai;
  ai.state ??= 'chase';
  const aggro = world.player.absorbing; // 吸収中は猛攻
  ai.atkTimer = Math.max(0, (ai.atkTimer ?? 0.5) - dt);
  ai.dodgeCd = Math.max(0, (ai.dodgeCd ?? 0) - dt);
  if (aggro) ai.atkTimer = Math.min(ai.atkTimer, spec.attackInterval * CRAWLER.aggroCooldown);
  let wx = 0, wz = 0, accel = 30;
  let res;
  if (ai.alert <= 0) {
    res = moveGround(world, e, dt, 0, 0, 30);
    ai.walk = 0;
    return;
  }
  // 弾を避ける（突進中・吸収中は避けない）
  if (!aggro && ai.dodgeCd <= 0 && (ai.state === 'chase' || ai.state === 'recover')) {
    const inc = findIncomingBullet(world, e);
    if (inc && inc.p !== ai.dodgeSeen) {
      ai.dodgeSeen = inc.p; // 1発につき1回だけ判定
      if (Math.random() < CRAWLER.dodgeChance) {
        // 弾道に垂直な方向へ（敵がいる側へ）
        const px = -inc.dir.z * inc.side, pz = inc.dir.x * inc.side;
        const l = Math.hypot(px, pz) || 1;
        ai.dodgeDir = { x: px / l, z: pz / l };
        ai.state = 'dodge'; ai.stateT = CRAWLER.dodgeTime; ai.dodgeCd = CRAWLER.dodgeCooldown;
        world.events.emit('enemyAction', { kind: 'crawler', pos: e.pos.clone(), action: 'crawlerDodge' });
      }
    }
  }
  switch (ai.state) {
    case 'dodge': {
      ai.stateT -= dt;
      wx = ai.dodgeDir.x * CRAWLER.dodgeSpeed; wz = ai.dodgeDir.z * CRAWLER.dodgeSpeed; accel = 200;
      faceToward(e, c.dirXZ.x, c.dirXZ.z, dt, 12);
      if (ai.stateT <= 0) ai.state = 'chase';
      break;
    }
    case 'chase': {
      faceToward(e, c.dirXZ.x, c.dirXZ.z, dt, 12);
      let dx = c.dirXZ.x, dz = c.dirXZ.z;
      if (ai.stuck > 0.3) { // 壁に引っかかったら横にずれる
        ai.strafe ??= Math.random() < 0.5 ? 1 : -1;
        dx += -c.dirXZ.z * ai.strafe; dz += c.dirXZ.x * ai.strafe;
      } else ai.strafe = undefined;
      const l = Math.hypot(dx, dz) || 1;
      const sp = spec.speed * (aggro ? CRAWLER.aggroSpeed : 1);
      wx = (dx / l) * sp; wz = (dz / l) * sp;
      if (c.dist2d < 2.6 && ai.atkTimer <= 0 && Math.abs(c.pc.y - e.pos.y) < 2.2) {
        ai.windupDur = CRAWLER.windup * (aggro ? CRAWLER.aggroWindup : 1);
        ai.state = 'windup'; ai.stateT = ai.windupDur; ai.lunge = c.dirXZ.clone();
      }
      accel = 25;
      break;
    }
    case 'windup': {
      ai.stateT -= dt;
      wx = wz = 0; accel = 60;
      faceToward(e, c.dirXZ.x, c.dirXZ.z, dt, 16);
      warn(e, 1 - Math.max(0, ai.stateT) / ai.windupDur);
      if (ai.stateT > 0.12) ai.lunge.copy(c.dirXZ); // 直前で方向を固定
      if (ai.stateT <= 0) {
        ai.state = 'lunge'; ai.stateT = 0.32; ai.hitDone = false; warn(e, 0);
        world.events.emit('enemyAttack', { kind: 'crawler', pos: e.pos.clone() });
      }
      break;
    }
    case 'lunge': {
      ai.stateT -= dt;
      wx = ai.lunge.x * 13; wz = ai.lunge.z * 13; accel = 200;
      if (!ai.hitDone && c.dist < e.radius + PLAYER_HIT_RADIUS + 0.15) {
        damagePlayer(world, spec.damage);
        ai.hitDone = true;
        spawnBurst(world, e.pos, 0xff7a3d, 6, 3);
      }
      if (ai.stateT <= 0) { ai.state = 'recover'; ai.stateT = aggro ? 0.35 : 0.6; ai.atkTimer = spec.attackInterval * (aggro ? CRAWLER.aggroCooldown : 1); }
      break;
    }
    case 'recover': {
      ai.stateT -= dt;
      accel = 40;
      if (ai.stateT <= 0) ai.state = 'chase';
      break;
    }
  }
  res = moveGround(world, e, dt, wx, wz, accel);
  ai.stuck = res.hitWall && ai.state === 'chase' ? (ai.stuck ?? 0) + dt : Math.max(0, (ai.stuck ?? 0) - dt * 2);
  ai.walk = Math.hypot(e.vel.x, e.vel.z);
}

// ---------------------------------------------------------------- gunner
function findCover(world: World, e: Enemy, pc: THREE.Vector3): THREE.Vector3 | null {
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 4 + Math.random() * 3.5;
    const cand = new THREE.Vector3(e.pos.x + Math.cos(a) * d, e.pos.y, e.pos.z + Math.sin(a) * d);
    if (!hasLineOfSight(world.colliders, e.pos, cand)) continue;
    // 足元に床があること
    if (raycastLevel(world.colliders, cand, _v.set(cand.x, cand.y - e.radius - 1.2, cand.z)) === null) continue;
    const eyeC = cand.clone(); eyeC.y += 0.4;
    if (hasLineOfSight(world.colliders, eyeC, pc)) continue;
    const dd = Math.hypot(cand.x - pc.x, cand.z - pc.z);
    if (dd < 8 || dd > 22) continue;
    return cand;
  }
  return null;
}

export function updateGunner(c: Ctx): void {
  const { world, e, dt, spec, pc } = c;
  const ai = e.ai;
  ai.state ??= 'hold';
  ai.atkTimer = (ai.atkTimer ?? 1 + Math.random()) - dt;
  if (ai.alert <= 0) { moveGround(world, e, dt, 0, 0, 20); ai.walk = 0; return; }
  let wx = 0, wz = 0;
  const rx = c.dirXZ.x, rz = c.dirXZ.z;
  switch (ai.state) {
    case 'hold': {
      faceToward(e, rx, rz, dt, 8);
      ai.strafeT = (ai.strafeT ?? 0) - dt;
      if (ai.strafeT <= 0) { ai.strafeDir = Math.random() < 0.5 ? 1 : -1; ai.strafeT = 1.2 + Math.random() * 1.5; }
      let radial = 0;
      if (!c.los) radial = 1;
      else if (c.dist2d < 10) radial = -1;
      else if (c.dist2d > 18) radial = 1;
      const tang = c.los ? 0.5 : 0.15;
      wx = (rx * radial + -rz * ai.strafeDir * tang) * spec.speed;
      wz = (rz * radial + rx * ai.strafeDir * tang) * spec.speed;
      if (ai.atkTimer <= 0 && c.los) { ai.state = 'windup'; ai.stateT = 0.65; }
      break;
    }
    case 'windup': {
      ai.stateT -= dt;
      faceToward(e, rx, rz, dt, 10);
      warn(e, 1 - Math.max(0, ai.stateT) / 0.65);
      if (ai.stateT <= 0) { warn(e, 0); ai.state = 'burst'; ai.burstLeft = 3; ai.burstT = 0; }
      break;
    }
    case 'burst': {
      faceToward(e, rx, rz, dt, 10);
      ai.burstT -= dt;
      if (ai.burstT <= 0 && ai.burstLeft > 0) {
        ai.burstLeft--; ai.burstT = 0.2;
        const yaw = ai.yaw ?? 0;
        const from = new THREE.Vector3(
          e.pos.x + Math.sin(yaw) * 0.8 + Math.cos(yaw) * 0.5, e.pos.y + 0.05, e.pos.z + Math.cos(yaw) * 0.8 - Math.sin(yaw) * 0.5);
        const lead = pc.clone().addScaledVector(world.player.vel, Math.min(0.2, c.dist / spec.projectileSpeed * 0.25));
        fireAt(world, from, lead, spec.projectileSpeed, spec.damage, 0.02, 0.17);
        world.events.emit('enemyAttack', { kind: 'gunner', pos: e.pos.clone() });
        ai.recoil = 1;
      }
      if (ai.burstLeft <= 0 && ai.burstT <= 0) {
        ai.state = 'cover'; ai.stateT = 1.8;
        ai.atkTimer = spec.attackInterval;
        ai.cover = findCover(world, e, pc);
      }
      break;
    }
    case 'cover': {
      ai.stateT -= dt;
      if (ai.cover) {
        const dx = ai.cover.x - e.pos.x, dz = ai.cover.z - e.pos.z;
        const dd = Math.hypot(dx, dz);
        if (dd > 0.4) { wx = (dx / dd) * spec.speed * 1.6; wz = (dz / dd) * spec.speed * 1.6; faceToward(e, dx, dz, dt, 8); }
        else faceToward(e, rx, rz, dt, 8);
      } else {
        ai.strafeDir ??= 1;
        wx = -rz * ai.strafeDir * spec.speed * 1.4; wz = rx * ai.strafeDir * spec.speed * 1.4;
        faceToward(e, rx, rz, dt, 8);
      }
      if (ai.stateT <= 0) { ai.state = 'hold'; ai.cover = null; }
      break;
    }
  }
  moveGround(world, e, dt, wx, wz, 24);
  ai.walk = Math.hypot(e.vel.x, e.vel.z);
  ai.recoil = Math.max(0, (ai.recoil ?? 0) - dt * 8);
}

// ---------------------------------------------------------------- heavy
export const HEAVY = {
  slamRange: 4.5,
  slamWindup: 0.9,
  chargeWindup: 1.0,
  chargeSpeed: 15,
  chargeMax: 0.95,
  stun: 1.6,
};

export function updateHeavy(c: Ctx): void {
  const { world, e, dt, spec } = c;
  const ai = e.ai;
  ai.state ??= 'walk';
  const tele = ai.model.parts;
  ai.atkTimer = Math.max(0, (ai.atkTimer ?? 1.5) - dt);

  // スタン中
  if (e.status === 'stunned') {
    ai.stunT -= dt;
    moveGround(world, e, dt, 0, 0, 30);
    ai.walk = 0;
    if (ai.stunT <= 0) { e.status = 'active'; ai.state = 'walk'; ai.atkTimer = 1.2; }
    return;
  }
  if (ai.alert <= 0) { moveGround(world, e, dt, 0, 0, 20); ai.walk = 0; return; }

  let wx = 0, wz = 0, accel = 12;
  switch (ai.state) {
    case 'walk': {
      faceToward(e, c.dirXZ.x, c.dirXZ.z, dt, 3);
      const near = c.dist2d < HEAVY.slamRange * 0.9;
      if (!near) { wx = c.dirXZ.x * spec.speed; wz = c.dirXZ.z * spec.speed; }
      if (ai.atkTimer <= 0 && c.los) {
        if (c.dist2d < HEAVY.slamRange && Math.abs(c.pc.y - e.pos.y) < 3.5) {
          ai.state = 'slamWindup'; ai.stateT = HEAVY.slamWindup;
        } else if (c.dist2d > 5) {
          ai.state = 'chargeWindup'; ai.stateT = HEAVY.chargeWindup;
          ai.dir = c.dirXZ.clone();
        }
      }
      break;
    }
    case 'slamWindup': {
      ai.stateT -= dt; accel = 40;
      faceToward(e, c.dirXZ.x, c.dirXZ.z, dt, 5);
      const k = 1 - Math.max(0, ai.stateT) / HEAVY.slamWindup;
      warn(e, k);
      tele.teleCircle.visible = true;
      tele.teleCircle.scale.setScalar(Math.max(0.2, HEAVY.slamRange * (0.3 + 0.7 * k)));
      (tele.teleCircle.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.25 * k;
      ai.armsUp = k;
      if (ai.stateT <= 0) {
        tele.teleCircle.visible = false; warn(e, 0);
        // 叩きつけ
        const floor = new THREE.Vector3(e.pos.x, e.pos.y - e.radius + 0.1, e.pos.z);
        spawnShockwave(world, floor, 0xffb070, HEAVY.slamRange, 0.45);
        spawnBurst(world, floor, 0xffa24d, 14, 5);
        world.events.emit('enemyAttack', { kind: 'heavy', pos: e.pos.clone() });
        const hd = Math.hypot(world.player.pos.x - e.pos.x, world.player.pos.z - e.pos.z);
        if (hd < HEAVY.slamRange + 0.3 && world.player.pos.y < floor.y + 1.6) damagePlayer(world, spec.damage);
        ai.state = 'recover'; ai.stateT = 0.9; ai.atkTimer = spec.attackInterval; ai.armsUp = 0;
        ai.slam = 1;
      }
      break;
    }
    case 'chargeWindup': {
      ai.stateT -= dt; accel = 40;
      const k = 1 - Math.max(0, ai.stateT) / HEAVY.chargeWindup;
      warn(e, k);
      if (ai.stateT > 0.3) { ai.dir.copy(c.dirXZ); faceToward(e, c.dirXZ.x, c.dirXZ.z, dt, 6); }
      else faceToward(e, ai.dir.x, ai.dir.z, dt, 6);
      tele.teleStrip.visible = true;
      tele.teleStrip.scale.set(e.radius * 1.9, 1, 15);
      (tele.teleStrip.material as THREE.MeshBasicMaterial).opacity = 0.15 + 0.3 * k;
      if (ai.stateT <= 0) {
        tele.teleStrip.visible = false; warn(e, 0);
        ai.state = 'charge'; ai.stateT = HEAVY.chargeMax; ai.hitDone = false; ai.chargeT = 0;
        world.events.emit('enemyAttack', { kind: 'heavy', pos: e.pos.clone() });
      }
      break;
    }
    case 'charge': {
      ai.stateT -= dt; ai.chargeT += dt; accel = 120;
      wx = ai.dir.x * HEAVY.chargeSpeed; wz = ai.dir.z * HEAVY.chargeSpeed;
      faceToward(e, ai.dir.x, ai.dir.z, dt, 8);
      const hd = Math.hypot(world.player.pos.x - e.pos.x, world.player.pos.z - e.pos.z);
      if (!ai.hitDone && hd < e.radius + PLAYER_HIT_RADIUS + 0.2 && Math.abs(c.pc.y - e.pos.y) < e.radius + 0.9) {
        damagePlayer(world, spec.damage);
        ai.hitDone = true;
        spawnBurst(world, c.pc, 0xff7a3d, 10, 4);
      }
      if (ai.stateT <= 0) { ai.state = 'recover'; ai.stateT = 0.8; ai.atkTimer = spec.attackInterval; }
      break;
    }
    case 'recover': {
      ai.stateT -= dt; accel = 25;
      ai.slam = Math.max(0, (ai.slam ?? 0) - dt * 3);
      if (ai.stateT <= 0) ai.state = 'walk';
      break;
    }
  }
  const res = moveGround(world, e, dt, wx, wz, accel);
  ai.walk = Math.hypot(e.vel.x, e.vel.z);
  if (ai.state === 'charge' && ai.chargeT > 0.15 && res.hitWall && ai.walk < HEAVY.chargeSpeed * 0.6) {
    // 壁にぶつかってスタン
    e.status = 'stunned'; ai.stunT = HEAVY.stun; ai.state = 'walk';
    ai.atkTimer = spec.attackInterval;
    spawnBurst(world, e.pos, 0xffe24a, 14, 5);
    spawnShockwave(world, e.pos, 0xffd070, 2.5, 0.3);
    e.vel.x *= -0.2; e.vel.z *= -0.2;
  }
  if (ai.state !== 'slamWindup') tele.teleCircle.visible = false;
  if (ai.state !== 'chargeWindup') tele.teleStrip.visible = false;
}

export { approach, PLAYER };
