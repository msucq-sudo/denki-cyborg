// リンガー：自分を中心に、輪っかのビームを床すれすれに広げる円盤型。
// 輪は一定の速さで外へ走り、背の低い壁のように立っている。当たると痛いので、ジャンプ・ジェットパック・
// グラップル・回避ローリングで越える（壁の向こうには届かない）。2連・3連のときは続けて飛び越える
import * as THREE from 'three';
import { Builder, COLORS, boxGeo, cachedGeo, taperGeo, torusGeo } from '../models';
import { approach, faceToward, moveGround, type Ctx } from '../common';
import { damagePlayer, playerCenter, PLAYER_HIT_RADIUS } from '../../core/combat';
import { hasLineOfSight } from '../../core/collision';
import { addEffect, spawnBurst, spawnFlash } from '../../core/effects';
import type { Enemy, World } from '../../core/types';
import type { KindModule } from './kind';

/** リンガーの調整値。輪のダメージは ENEMIES.ringer.damage、広がる速さは projectileSpeed、攻撃の間隔は attackInterval */
export const RINGER = {
  /** 輪が届く半径（m）と、輪の高さ（m。床から）と、輪の厚みの半分（m） */
  maxRadius: 17,
  height: 0.85,
  halfWidth: 0.4,
  /** 輪を出す前の予備動作（秒）。体が光って床に予告の輪が出る */
  windup: 1.0,
  /** 連続で出すときの間隔（秒）。短いほどジャンプのタイミングがきつい */
  gap: 0.75,
  /** 体力がこの割合を切ると、3連が出るようになる */
  rageHp: 0.5,
  /** 保ちたい距離（m）。遠すぎると輪が弱まるので寄る */
  keepMin: 5,
  keepMax: 11,
  /** 輪の色 */
  color: 0xff5a8a,
  rimColor: 0xffd6e4,
} as const;

// ------------------------------------------------------------------ 輪の弾（エフェクトとして動く）
let ringGeos: { band: THREE.CylinderGeometry; rim: THREE.RingGeometry } | null = null;
function getRingGeos() {
  if (!ringGeos) {
    const band = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true);
    band.translate(0, 0.5, 0);
    const rim = new THREE.RingGeometry(0.965, 1, 64);
    rim.rotateX(-Math.PI / 2);
    ringGeos = { band, rim };
  }
  return ringGeos;
}

const _pc = new THREE.Vector3();
const _org = new THREE.Vector3();

/** 輪を1本出す。baseY は輪の下の高さ（発射時の床）。当たり判定は輪の位置が動くたびに見る */
export function spawnRingBeam(world: World, cx: number, baseY: number, cz: number, speed: number, damage: number): void {
  const g = getRingGeos();
  const H = RINGER.height;
  const grp = new THREE.Group();
  const bandMat = new THREE.MeshBasicMaterial({ color: RINGER.color, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
  const band = new THREE.Mesh(g.band, bandMat);
  band.scale.set(1, H, 1);
  const topMat = new THREE.MeshBasicMaterial({ color: RINGER.rimColor, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
  const botMat = new THREE.MeshBasicMaterial({ color: RINGER.color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  const top = new THREE.Mesh(g.rim, topMat); top.position.y = H;
  const bot = new THREE.Mesh(g.rim, botMat); bot.position.y = 0.03;
  for (const o of [band, top, bot]) { o.castShadow = false; o.renderOrder = 4; }
  grp.add(band, top, bot);
  grp.position.set(cx, baseY, cz);
  grp.scale.set(0.3, 1, 0.3);
  world.scene.add(grp);

  let hit = false;
  const life = RINGER.maxRadius / speed + 0.25;
  addEffect(world, grp, life, (e) => {
    const elapsed = e.maxLife - e.life;
    const r = Math.min(RINGER.maxRadius, 0.3 + elapsed * speed);
    grp.scale.set(r, 1, r);
    const fade = 1 - Math.pow(Math.max(0, r / RINGER.maxRadius), 3);
    bandMat.opacity = 0.4 * fade; topMat.opacity = 0.95 * fade; botMat.opacity = 0.9 * fade;
    // ばちばち：輪の上に火花を散らす（描画を軽く保つため確率で）
    if (Math.random() < 0.35) {
      const a = Math.random() * Math.PI * 2;
      spawnBurst(world, _org.set(cx + Math.cos(a) * r, baseY + H * Math.random(), cz + Math.sin(a) * r), RINGER.rimColor, 1, 1.2, 0.2);
    }
    if (hit || world.state !== 'playing') return;
    const pl = world.player;
    // 当たる条件：輪の厚みの中にいて、足が輪の上端より低い（飛び越えていない）、回避の無敵中でない、壁にさえぎられていない
    const d = Math.hypot(pl.pos.x - cx, pl.pos.z - cz);
    if (Math.abs(d - r) > RINGER.halfWidth + PLAYER_HIT_RADIUS * 0.7) return;
    if (pl.pos.y > baseY + H - 0.05 || pl.pos.y + 1.8 < baseY) return;
    if (pl.dodgeTimer > 0) return;
    if (!hasLineOfSight(world.colliders, _org.set(cx, baseY + 0.45, cz), playerCenter(world, _pc))) return;
    hit = true;
    damagePlayer(world, damage);
    spawnBurst(world, _pc, RINGER.color, 12, 4, 0.4);
    spawnFlash(world, _pc, RINGER.rimColor, 4, 4, 0.15);
  });
}

// ------------------------------------------------------------------ AI
function floorY(e: Enemy): number { return e.pos.y - e.radius + 0.05; }

function update(c: Ctx): void {
  const { world, e, dt, spec, dirXZ, dist2d, los } = c;
  const ai = e.ai;
  ai.atkTimer = (ai.atkTimer ?? 1 + Math.random()) - dt;
  if (e.status === 'stunned') {
    ai.stunT = (ai.stunT ?? 0) - dt;
    moveGround(world, e, dt, 0, 0, 20);
    ai.walk = 0; ai.windup = 0; ai.rings = 0; ai.warn = 0;
    if (ai.stunT <= 0) e.status = 'active';
    return;
  }
  if (ai.alert <= 0) {
    moveGround(world, e, dt, 0, 0, 10);
    ai.walk = 0; ai.windup = 0; ai.rings = 0; ai.warn = 0;
    return;
  }

  faceToward(e, dirXZ.x, dirXZ.z, dt, 3);

  // 移動：予備動作と連続発射の間は止まる。それ以外は距離を保ってゆっくり回り込む
  const busy = (ai.windup ?? 0) > 0 || (ai.rings ?? 0) > 0;
  let wx = 0, wz = 0;
  if (!busy) {
    ai.strafeT = (ai.strafeT ?? 0) - dt;
    if (ai.strafeT <= 0 || ai.strafeDir === undefined) { ai.strafeDir = Math.random() < 0.5 ? 1 : -1; ai.strafeT = 1.5 + Math.random() * 2; }
    const radial = !los ? 1 : dist2d < RINGER.keepMin ? -1 : dist2d > RINGER.keepMax ? 1 : 0;
    const tangent = radial === 0 ? 0.8 : 0.3;
    wx = (dirXZ.x * radial - dirXZ.z * ai.strafeDir * tangent) * spec.speed;
    wz = (dirXZ.z * radial + dirXZ.x * ai.strafeDir * tangent) * spec.speed;
  }
  moveGround(world, e, dt, wx, wz, 6);
  ai.walk = Math.hypot(e.vel.x, e.vel.z);

  if ((ai.rings ?? 0) > 0) {
    // 連続発射：間隔ごとに1本ずつ
    ai.ringT -= dt;
    if (ai.ringT <= 0) {
      spawnRingBeam(world, e.pos.x, floorY(e), e.pos.z, spec.projectileSpeed, spec.damage);
      world.events.emit('enemyAction', { kind: e.kind, pos: e.pos.clone(), action: 'ringFire' });
      ai.pulse = 1;
      ai.rings--;
      ai.ringT = RINGER.gap;
      if (ai.rings <= 0) ai.atkTimer = spec.attackInterval * (0.85 + Math.random() * 0.3);
    }
    ai.warn = 0;
  } else if ((ai.windup ?? 0) > 0) {
    ai.windup -= dt;
    ai.warn = 1 - Math.max(0, ai.windup) / RINGER.windup;
    if (ai.windup <= 0) {
      ai.warn = 0;
      const rage = e.hp <= e.maxHp * RINGER.rageHp;
      ai.rings = rage ? 3 : Math.random() < 0.45 ? 2 : 1;
      ai.ringT = 0;
    }
  } else {
    ai.warn = 0;
    if (ai.atkTimer <= 0 && los && dist2d < RINGER.maxRadius - 1) {
      ai.windup = RINGER.windup;
      world.events.emit('enemyAction', { kind: e.kind, pos: e.pos.clone(), action: 'ringWarn' });
    }
  }
}

function animate(_world: World, e: Enemy, dt: number, down: boolean): void {
  const ai = e.ai;
  const p = ai.model.parts;
  const vis = ai.model.vis as THREE.Group;
  const lerp = THREE.MathUtils.lerp;
  ai.pulse = approach(ai.pulse ?? 0, 0, dt * 3);
  const spin = p.spin as THREE.Group;
  const wave = p.wave as THREE.Mesh;
  const tele = p.tele as THREE.Mesh;
  const lamps = p.lampMats as THREE.MeshStandardMaterial[];
  const warn: number = ai.warn ?? 0;
  if (!down) {
    spin.rotation.y += dt * (1.2 + warn * 14 + ai.pulse * 6);
    // 体が光る：予備動作で強く、発射の瞬間にぱっと広がる
    const glow = 0.8 + 3 * warn * (0.7 + 0.3 * Math.sin((ai.t ?? 0) * 36)) + 3 * ai.pulse;
    for (const m of lamps) m.emissiveIntensity = lerp(m.emissiveIntensity, glow, Math.min(1, dt * 14));
    // 胴の輪が発射で広がる
    wave.scale.setScalar(1 + 0.35 * ai.pulse);
    // 床の予告の輪：予備動作の間、足元に出て広がっていく
    tele.visible = warn > 0;
    if (warn > 0) {
      tele.scale.setScalar(1.2 + 1.4 * warn);
      (tele.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.5 * Math.abs(Math.sin((ai.t ?? 0) * 24));
    }
    // ゆらゆら浮く／予備動作で少し沈む
    vis.position.y += Math.sin((ai.t ?? 0) * 2.4 + e.id) * 0.025 - 0.08 * warn;
    vis.rotation.x = lerp(vis.rotation.x, Math.min(0.1, (ai.walk ?? 0) * 0.05), Math.min(1, dt * 6));
  } else {
    tele.visible = false;
    for (const m of lamps) m.emissiveIntensity = 0.05;
    vis.rotation.z = (ai.tilt ?? 1) * 0.9 * ai.collapse;
    vis.position.y = -0.25 * ai.collapse;
  }
}

export const ringer: KindModule = {
  knockback: 0.4,

  build() {
    const b = new Builder();
    const white = b.body(COLORS.white, 0.5, true), silver = b.body(COLORS.silver, 0.5, true), blue = b.body(COLORS.blue, 0.5, true);
    const navy = b.body(COLORS.navy, 0.7, true), deep = b.body(COLORS.deepBlue, 0.6, true);
    // 輪の光は電気の青ではなくピンクで統一（輪ビームと同じ色）
    const lampMats: THREE.MeshStandardMaterial[] = [];
    const lampMat = (i: number): THREE.MeshStandardMaterial => {
      const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: RINGER.color, emissiveIntensity: i, roughness: 0.4 });
      lampMats.push(m);
      return m;
    };
    // 円盤の胴：下の皿 + 上の皿 + 青い縁
    b.mesh(taperGeo(0.78, 0.5, 0.26, 12), deep, b.vis, 0, -0.52, 0);
    b.mesh(taperGeo(0.5, 0.82, 0.3, 12), white, b.vis, 0, -0.26, 0);
    b.prism(0.86, 0.1, 12, blue, b.vis, 0, -0.06, 0);
    b.mesh(taperGeo(0.7, 0.86, 0.22, 12), silver, b.vis, 0, 0.1, 0);
    // 腰の発光リング（発射で広がる）
    const wave = b.mesh(torusGeo(0.88, 0.035), lampMat(0.8), b.vis, 0, -0.06, 0);
    wave.rotation.x = Math.PI / 2;
    wave.castShadow = false;
    b.parts.wave = wave;
    // 回る外周のランプ（8個）
    const spin = new THREE.Group();
    spin.position.y = 0.2;
    b.vis.add(spin);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const l = b.mesh(boxGeo(0.12, 0.07, 0.12), lampMat(1.2), spin, Math.cos(a) * 0.74, 0, Math.sin(a) * 0.74);
      l.rotation.y = -a;
      l.castShadow = false;
    }
    b.parts.spin = spin;
    // 上の中央：エミッターのドーム（弱点のコア）と、それを囲む3本のフィン
    b.prism(0.3, 0.1, 8, navy, b.vis, 0, 0.26, 0);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const fin = b.block(0.05, 0.3, 0.2, silver, b.vis, Math.cos(a) * 0.3, 0.42, Math.sin(a) * 0.3, 0.015);
      fin.rotation.y = -a;
    }
    // 顔：前面のバイザーとスリットの目
    b.block(0.5, 0.16, 0.1, navy, b.vis, 0, 0.05, 0.8, 0.03);
    b.mesh(boxGeo(0.38, 0.045, 0.03), b.eye(), b.vis, 0, 0.05, 0.86);
    b.weak(0, 0.4, 0, 0.26, [1, 0.9, 1], 0.17);
    // 足元の予告リング（ふだんは非表示。予備動作で広がる）
    const tele = new THREE.Mesh(
      cachedGeo('ringerTele', () => new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2)),
      new THREE.MeshBasicMaterial({ color: RINGER.color, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }),
    );
    tele.position.y = -0.76;
    tele.visible = false;
    tele.castShadow = false;
    b.vis.add(tele);
    b.parts.tele = tele;
    b.parts.lampMats = lampMats;
    // 低い台座の小さな脚
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      b.block(0.16, 0.14, 0.16, navy, b.vis, sx * 0.42, -0.66, sz * 0.42, 0.03);
    }
    return b.done();
  },

  update,
  animate,
};
