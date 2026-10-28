import * as THREE from 'three';
import { Builder, COLORS, boxGeo, polyCyl, taperGeo, unitCircle, unitStrip } from '../models';
import { moveGround, faceToward } from '../common';
import { damagePlayer, PLAYER_HIT_RADIUS } from '../../core/combat';
import { spawnBurst, spawnFlash, spawnShockwave } from '../../core/effects';
import type { KindModule } from './kind';

/** ヘビーウォーカーの調整値：4本脚の重機。突進と、踏みつけ電撃（範囲） */
export const HEAVY_WALKER = {
  stompRange: 5.5,        // 踏みつけ電撃の半径
  stompWindup: 1.0,
  /** 地面からこの高さより上にいれば電撃は当たらない（ジャンプ・ジェットパックで避けられる） */
  stompSafeHeight: 1.6,
  fieldTime: 0.6,         // 電撃が床に残る時間
  fieldDamage: 4,         // 床の電撃の1回あたりダメージ
  fieldTick: 0.25,
  chargeWindup: 0.9,
  chargeSpeed: 14,
  chargeTime: 0.9,
  chargeDamageMul: 1.2,   // 突進ダメージ = damage × これ
  wallStun: 1.8,
  recover: 0.8,
  /** プレイヤーが吸収中の凶暴化 */
  angryCooldownMul: 0.4,
  angrySpeedMul: 1.4,
  angryWindupMul: 0.7,
} as const;

const H = HEAVY_WALKER;
const ELEC = 0x7fd4ff;

export const heavyWalker: KindModule = {
  knockback: 0.2,
  build() {
    const b = new Builder();
    const white = b.body(COLORS.white, 0.5, true), silver = b.body(COLORS.silver, 0.5, true), blue = b.body(COLORS.blue, 0.5, true);
    const deep = b.body(COLORS.deepBlue, 0.65, true), navy = b.body(COLORS.navy, 0.7, true);
    // 胴体：平たい装甲ブロック + 上面プレート + 下腹
    b.block(2.3, 0.9, 2.4, white, b.vis, 0, 0.4, 0, 0.18);
    b.block(1.8, 0.12, 1.6, silver, b.vis, 0, 0.9, -0.05, 0.04);
    b.block(1.9, 0.4, 2.0, deep, b.vis, 0, -0.1, 0, 0.1);
    // 光るライン + 排気スリット
    for (const sx of [-1, 1]) {
      b.lamp(0.04, 0.05, 1.8, b.vis, sx * 1.16, 0.3, 0);
      for (let i = 0; i < 4; i++) b.mesh(boxGeo(0.03, 0.3, 0.07), navy, b.vis, sx * 1.16, 0.55, -0.6 + i * 0.4);
    }
    b.lamp(1.8, 0.05, 0.04, b.vis, 0, 0.3, 1.21);
    // 頭（前面）：箱 + バイザー + スリットの目
    b.block(0.8, 0.5, 0.55, silver, b.vis, 0, 0.6, 1.35, 0.1);
    b.block(0.7, 0.24, 0.1, navy, b.vis, 0, 0.62, 1.64, 0.03);
    for (const sx of [-1, 1]) {
      b.mesh(boxGeo(0.26, 0.07, 0.05), b.eye(), b.vis, sx * 0.18, 0.63, 1.7);
      b.prism(0.02, 0.4, 4, navy, b.vis, sx * 0.36, 1.0, 1.25);
    }
    // 4本脚（股関節 → 太もも → ピストン → すね → 大きな足）。前脚が踏みつけ担当
    const legs: THREE.Group[] = [];
    const hips: [number, number][] = [[-0.95, 0.75], [0.95, 0.75], [-0.95, -0.75], [0.95, -0.75]];
    for (const [hx, hz] of hips) {
      const s = Math.sign(hx);
      const hip = new THREE.Group();
      hip.position.set(hx, 0.15, hz);
      b.vis.add(hip);
      b.prism(0.28, 0.4, 8, blue, hip).rotation.z = Math.PI / 2;
      b.block(0.32, 0.66, 0.36, silver, hip, s * 0.22, -0.3, 0, 0.07).rotation.z = s * 0.6;
      b.prism(0.045, 0.62, 6, navy, hip, s * 0.42, -0.5, 0.2).rotation.z = s * 0.35;
      b.mesh(taperGeo(0.17, 0.12, 0.7, 6), white, hip, s * 0.4, -0.8, 0).rotation.z = -s * 0.15;
      b.block(0.6, 0.3, 0.84, deep, hip, s * 0.42, -1.22, 0.05, 0.08);
      // 足裏の電極
      b.mesh(polyCyl(0.22, 0.03, 6), b.glow(1.2), hip, s * 0.42, -1.38, 0.05).castShadow = false;
      legs.push(hip);
    }
    b.parts.legs = legs;
    // 背中の発電コア（弱点）＋放電コイル＋フレーム
    for (const sx of [-1, 1]) {
      b.prism(0.1, 0.5, 6, navy, b.vis, sx * 0.55, 1.15, -0.4);
      for (const y of [1.0, 1.15, 1.3]) b.prism(0.16, 0.04, 6, silver, b.vis, sx * 0.55, y, -0.4);
      b.lamp(0.1, 0.1, 0.1, b.vis, sx * 0.55, 1.45, -0.4, 1.8);
      b.block(0.12, 0.7, 0.2, navy, b.vis, sx * 0.5, 0.78, -1.3, 0.04);
    }
    b.block(1.12, 0.12, 0.2, navy, b.vis, 0, 1.12, -1.3, 0.04);
    b.block(1.12, 0.12, 0.2, navy, b.vis, 0, 0.44, -1.3, 0.04);
    b.block(0.9, 0.5, 0.1, silver, b.vis, 0, 0.78, -1.26, 0.03);
    b.weak(0, 0.78, -1.15, 0.45, [1.2, 0.9, 0.8], 0.32);

    // 予告（root 直下・足元）と床の電撃
    const teleMat = () => new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const floorY = -1.3 + 0.08;
    const circle = new THREE.Mesh(unitCircle(), teleMat());
    circle.rotation.x = -Math.PI / 2; circle.position.y = floorY; circle.visible = false;
    b.root.add(circle);
    const strip = new THREE.Mesh(unitStrip(), teleMat());
    strip.position.y = floorY; strip.visible = false;
    b.root.add(strip);
    const field = new THREE.Mesh(unitCircle(), new THREE.MeshBasicMaterial({
      color: ELEC, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    field.rotation.x = -Math.PI / 2; field.position.y = floorY + 0.02; field.visible = false;
    b.root.add(field);
    b.parts.teleCircle = circle;
    b.parts.teleStrip = strip;
    b.parts.field = field;
    return b.done();
  },

  update(c) {
    const { world, e, dt, spec, dirXZ, dist2d, los } = c;
    const ai = e.ai;
    const p = ai.model.parts;
    ai.state ??= 'walk';
    const angry = world.player.absorbing;
    const cdMul = angry ? H.angryCooldownMul : 1;
    const wuMul = angry ? H.angryWindupMul : 1;
    ai.atkTimer = Math.max(0, (ai.atkTimer ?? 1.5) - dt);
    if (angry) ai.atkTimer = Math.min(ai.atkTimer, spec.attackInterval * cdMul);
    const feetY = e.pos.y - e.radius;

    // 床に残った電撃
    if ((ai.fieldT ?? 0) > 0) {
      ai.fieldT -= dt;
      ai.fieldTick = (ai.fieldTick ?? 0) - dt;
      const fd = Math.hypot(world.player.pos.x - ai.fieldPos.x, world.player.pos.z - ai.fieldPos.z);
      if (ai.fieldTick <= 0 && fd < H.stompRange && world.player.pos.y < ai.fieldPos.y + 0.5) {
        ai.fieldTick = H.fieldTick;
        damagePlayer(world, H.fieldDamage);
      }
      if (Math.random() < 0.5) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * H.stompRange;
        spawnBurst(world, new THREE.Vector3(ai.fieldPos.x + Math.cos(a) * r, ai.fieldPos.y + 0.1, ai.fieldPos.z + Math.sin(a) * r), ELEC, 2, 2, 0.2);
      }
    }

    if (e.status === 'stunned') {
      ai.stunT -= dt;
      moveGround(world, e, dt, 0, 0, 30);
      ai.walk = 0;
      p.teleCircle.visible = false; p.teleStrip.visible = false;
      if (ai.stunT <= 0) { e.status = 'active'; ai.state = 'walk'; ai.atkTimer = 1.0 * cdMul; }
      return;
    }
    if (ai.alert <= 0) { moveGround(world, e, dt, 0, 0, 20); ai.walk = 0; return; }

    let wx = 0, wz = 0, accel = 10;
    switch (ai.state) {
      case 'walk': {
        faceToward(e, dirXZ.x, dirXZ.z, dt, 3);
        const sp = spec.speed * (angry ? H.angrySpeedMul : 1);
        if (dist2d > H.stompRange * 0.6) { wx = dirXZ.x * sp; wz = dirXZ.z * sp; }
        if (ai.atkTimer <= 0 && los) {
          if (dist2d < H.stompRange * 0.85 && Math.abs(c.pc.y - e.pos.y) < 3.5) {
            ai.state = 'stompWindup'; ai.stateT = ai.stateMax = H.stompWindup * wuMul;
            world.events.emit('enemyAction', { kind: e.kind, pos: e.pos.clone(), action: 'stompWindup', value: ai.stateMax });
          } else if (dist2d > 5) {
            ai.state = 'chargeWindup'; ai.stateT = ai.stateMax = H.chargeWindup * wuMul;
            ai.dir = dirXZ.clone();
          }
        }
        break;
      }
      case 'stompWindup': {
        ai.stateT -= dt; accel = 40;
        faceToward(e, dirXZ.x, dirXZ.z, dt, 4);
        const k = 1 - Math.max(0, ai.stateT) / ai.stateMax;
        ai.warn = k;
        ai.raise = k;
        p.teleCircle.visible = true;
        p.teleCircle.scale.setScalar(Math.max(0.2, H.stompRange * (0.3 + 0.7 * k)));
        p.teleCircle.material.opacity = 0.2 + 0.25 * k;
        if (ai.stateT <= 0) {
          p.teleCircle.visible = false; ai.warn = 0; ai.raise = 0; ai.stomp = 1;
          const floor = new THREE.Vector3(e.pos.x, feetY + 0.1, e.pos.z);
          spawnShockwave(world, floor, ELEC, H.stompRange, 0.45);
          spawnShockwave(world, floor, 0xffffff, H.stompRange * 0.5, 0.3);
          spawnFlash(world, floor, ELEC, 8, 12, 0.25);
          spawnBurst(world, floor, ELEC, 24, 6);
          world.events.emit('enemyAction', { kind: e.kind, pos: e.pos.clone(), action: 'stomp' });
          const hd = Math.hypot(world.player.pos.x - e.pos.x, world.player.pos.z - e.pos.z);
          if (hd < H.stompRange + 0.3 && world.player.pos.y < feetY + H.stompSafeHeight) damagePlayer(world, spec.damage);
          ai.fieldT = H.fieldTime; ai.fieldTick = H.fieldTick; ai.fieldPos = floor;
          ai.state = 'recover'; ai.stateT = H.recover; ai.atkTimer = spec.attackInterval * cdMul;
        }
        break;
      }
      case 'chargeWindup': {
        ai.stateT -= dt; accel = 40;
        const k = 1 - Math.max(0, ai.stateT) / ai.stateMax;
        ai.warn = k;
        if (ai.stateT > 0.3) { ai.dir.copy(dirXZ); faceToward(e, dirXZ.x, dirXZ.z, dt, 6); }
        else faceToward(e, ai.dir.x, ai.dir.z, dt, 6);
        p.teleStrip.visible = true;
        p.teleStrip.scale.set(e.radius * 1.9, 1, 15);
        p.teleStrip.material.opacity = 0.15 + 0.3 * k;
        if (ai.stateT <= 0) {
          p.teleStrip.visible = false; ai.warn = 0;
          ai.state = 'charge'; ai.stateT = H.chargeTime; ai.hitDone = false; ai.chargeT = 0;
          world.events.emit('enemyAction', { kind: e.kind, pos: e.pos.clone(), action: 'chargeStart' });
        }
        break;
      }
      case 'charge': {
        ai.stateT -= dt; ai.chargeT += dt; accel = 120;
        wx = ai.dir.x * H.chargeSpeed; wz = ai.dir.z * H.chargeSpeed;
        faceToward(e, ai.dir.x, ai.dir.z, dt, 8);
        const hd = Math.hypot(world.player.pos.x - e.pos.x, world.player.pos.z - e.pos.z);
        if (!ai.hitDone && hd < e.radius + PLAYER_HIT_RADIUS + 0.2 && Math.abs(c.pc.y - e.pos.y) < e.radius + 0.9) {
          damagePlayer(world, spec.damage * H.chargeDamageMul);
          ai.hitDone = true;
          spawnBurst(world, c.pc, ELEC, 12, 4);
        }
        if (ai.stateT <= 0) { ai.state = 'recover'; ai.stateT = H.recover; ai.atkTimer = spec.attackInterval * cdMul; }
        break;
      }
      case 'recover': {
        ai.stateT -= dt; accel = 25;
        if (ai.stateT <= 0) ai.state = 'walk';
        break;
      }
    }
    const res = moveGround(world, e, dt, wx, wz, accel);
    ai.walk = Math.hypot(e.vel.x, e.vel.z);
    if (ai.state === 'charge' && ai.chargeT > 0.15 && res.hitWall && ai.walk < H.chargeSpeed * 0.6) {
      // 壁に激突してスタン
      e.status = 'stunned'; ai.stunT = H.wallStun; ai.state = 'walk';
      ai.atkTimer = spec.attackInterval * cdMul;
      world.events.emit('enemyAction', { kind: e.kind, pos: e.pos.clone(), action: 'wallCrash' });
      spawnBurst(world, e.pos, 0xffe24a, 14, 5);
      spawnShockwave(world, e.pos, 0xffd070, 2.8, 0.3);
      e.vel.x *= -0.2; e.vel.z *= -0.2;
    }
    if (ai.state !== 'stompWindup') { p.teleCircle.visible = false; ai.raise = 0; }
    if (ai.state !== 'chargeWindup') p.teleStrip.visible = false;
  },

  animate(_world, e, dt, down) {
    const ai = e.ai;
    const p = ai.model.parts;
    const vis = ai.model.vis as THREE.Group;
    const legs: THREE.Group[] = p.legs;
    const t: number = ai.t ?? 0;
    ai.stomp = Math.max(0, (ai.stomp ?? 0) - dt * 4);
    // 床の電撃
    const field = p.field as THREE.Mesh;
    const fieldOn = !down && (ai.fieldT ?? 0) > 0;
    field.visible = fieldOn;
    if (fieldOn) {
      field.position.x = ai.fieldPos.x - e.pos.x; field.position.z = ai.fieldPos.z - e.pos.z;
      field.position.y = ai.fieldPos.y - e.pos.y;
      field.rotation.z = -(ai.yaw ?? 0);
      field.scale.setScalar(H.stompRange * (0.85 + 0.15 * Math.sin(t * 40)));
      (field.material as THREE.MeshBasicMaterial).opacity = 0.45 * (ai.fieldT / H.fieldTime) * (0.6 + 0.4 * Math.random());
    }
    if (!down) {
      const w = ai.walk ?? 0;
      ai.phaseW = (ai.phaseW ?? 0) + dt * (2 + w * 1.2);
      legs.forEach((l, i) => {
        // 対角の脚が同時に動く
        const ph = ai.phaseW + ((i === 0 || i === 3) ? 0 : Math.PI);
        l.rotation.x = Math.sin(ph) * 0.35 * Math.min(1, w / 1.5);
        l.position.y = 0.15 + Math.max(0, Math.sin(ph)) * 0.08 * Math.min(1, w / 1.5);
      });
      // 踏みつけ：前脚を振り上げて体を起こす → ドン
      const raise = ai.raise ?? 0;
      legs[0].rotation.x -= raise * 0.9; legs[1].rotation.x -= raise * 0.9;
      legs[0].position.y += raise * 0.35; legs[1].position.y += raise * 0.35;
      vis.rotation.x = -raise * 0.25 + ai.stomp * 0.12 + (ai.state === 'charge' ? 0.18 : 0);
      vis.position.y += Math.abs(Math.sin(ai.phaseW)) * 0.05 * Math.min(1, w / 1.5) - ai.stomp * 0.12;
      vis.rotation.z = e.status === 'stunned' ? Math.sin(t * 12) * 0.08 : 0;
    } else {
      vis.rotation.x = 0.35 * ai.collapse;
      vis.position.y = -0.55 * ai.collapse;
      legs.forEach((l, i) => { l.rotation.z = (i % 2 ? -1 : 1) * 0.6 * ai.collapse; });
    }
  },

  onRemove(_world, e) {
    const p = e.ai.model?.parts;
    if (p?.field) p.field.visible = false;
  },
};
