// ミサイルドローン：浮遊しながらミサイル4発を連射する。ミサイルは銃かアームで撃ち落とせる
import * as THREE from 'three';
import { Builder, COLORS, boxGeo, cachedGeo, taperGeo } from '../models';
import { moveFlyer, faceToward } from '../common';
import type { Ctx } from '../common';
import type { Enemy } from '../../core/types';
import { spawnProjectile } from '../../core/projectiles';
import { spawnBurst, spawnFlash } from '../../core/effects';
import type { KindModule } from './kind';

/** ミサイルドローンの調整値 */
export const MISSILE_DRONE = {
  /** 好む距離（m）。中距離を周回する */
  keepMin: 8.5, keepMax: 15,
  hoverHeight: 2.2,        // プレイヤーの体の中心よりどれだけ上を漂うか
  /** 攻撃の流れ */
  pods: 4,                 // ポッド数 = 1回の斉射数
  teleTime: 1.0,           // 予備動作（ポッドが順に点灯）の秒数
  rippleInterval: 0.13,    // 発射の間隔（秒）
  firstDelay: 1.2,         // 気づいてから最初の予備動作までの最短秒数
  /** 装填：斉射後 reloadWait 秒たってから、1本ずつ reloadStagger 秒ずらして reloadTime 秒かけて装填 */
  reloadWait: 0.7, reloadStagger: 0.35, reloadTime: 0.45,
  /** ミサイル */
  missileHp: 8,            // 通常弾（GUN.tapDamage=10）1発で落ちる
  missileRadius: 0.32,
  launchSpeed: 5.5,        // 横へ開く初速
  homingDelay: 0.5,        // 開いてからホーミング開始まで
  turnRate: 1.5,           // 旋回速度（rad/s）：避けられる程度にゆるい
  missileLife: 6,
  blastRadius: 1.4,
} as const;

const N = MISSILE_DRONE.pods;
/** ポッド i の位置（ローカル）。0,1 = 左の上下、2,3 = 右の上下 */
const podSide = (i: number) => (i < 2 ? -1 : 1);
const podRow = (i: number) => (i % 2 === 0 ? 1 : -1);
const POD_X = 0.64, POD_Y = -0.06, POD_DY = 0.13, POD_TIP_Z = 0.75;
/** 点灯・発射の順（左上 → 右上 → 左下 → 右下 と左右交互に） */
const ORDER = [0, 2, 1, 3];
const _v = new THREE.Vector3();

/** ポッド i から一発発射 */
function fireOne(c: Ctx, i: number): void {
  const { world, e, spec } = c;
  const M = MISSILE_DRONE;
  const yaw: number = e.ai.yaw ?? 0;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const toWorld = (x: number, y: number, z: number, out: THREE.Vector3) =>
    out.set(e.pos.x + x * cs + z * sn, e.pos.y + y, e.pos.z - x * sn + z * cs);
  const lx = podSide(i) * POD_X, ly = POD_Y + podRow(i) * POD_DY;
  const pos = toWorld(lx, ly, POD_TIP_Z, new THREE.Vector3());
  // 横（外側）へ大きく開きつつ上下にもずれて、前へ少し出る
  const d = new THREE.Vector3(podSide(i) * 1.0, podRow(i) * 0.38, 0.45).normalize();
  const vel = new THREE.Vector3(d.x * cs + d.z * sn, d.y, -d.x * sn + d.z * cs).multiplyScalar(M.launchSpeed);
  spawnProjectile(world, {
    pos, vel, damage: spec.damage, owner: 'enemy', radius: M.missileRadius, size: 0.26, life: M.missileLife,
    missile: true, shootable: true, hp: M.missileHp,
    homing: { turnRate: M.turnRate, target: 'player', delay: M.homingDelay, speed: spec.projectileSpeed, accel: 12 },
    blast: { radius: M.blastRadius, color: 0xff9a3d }, trail: 0xffc080,
  });
  spawnBurst(world, pos, 0xffe0a0, 5, 3);
  spawnFlash(world, pos, 0xffa050, 3, 5, 0.15);
  e.ai.pods[i] = 0;
  e.ai.lit[i] = 0;
  e.ai.recoil[i] = 1;
  world.events.emit('enemyAttack', { kind: e.kind, pos: pos.clone() });
}

function initState(ai: Enemy['ai']): void {
  ai.pods ??= [1, 1, 1, 1];        // 各ポッドの装填度 0..1
  ai.recoil ??= [0, 0, 0, 0];
  ai.lit ??= [0, 0, 0, 0];          // 予備動作で点灯した度合い
  ai.mode ??= 'idle';               // idle | tele | fire
  ai.atkTimer ??= MISSILE_DRONE.firstDelay + Math.random() * 1.2;
  ai.teleT ??= 0; ai.fireT ??= 0; ai.fireIdx ??= 0; ai.reloadClock ??= 99;
}

/** 斉射後の装填（ポッドが1本ずつ埋まる） */
function updateReload(c: Ctx): void {
  const { world, e, dt } = c;
  const ai = e.ai, M = MISSILE_DRONE;
  if (ai.mode === 'fire') return;
  ai.reloadClock += dt;
  for (let i = 0; i < N; i++) {
    if (ai.pods[i] >= 1) continue;
    const prev: number = ai.pods[i];
    const k = THREE.MathUtils.clamp((ai.reloadClock - (M.reloadWait + i * M.reloadStagger)) / M.reloadTime, 0, 1);
    ai.pods[i] = Math.max(prev, k);
    if (ai.pods[i] >= 1) world.events.emit('enemyAction', { kind: e.kind, pos: e.pos.clone(), action: 'missileLoad', value: 1 });
  }
}

export const missileDrone: KindModule = {
  knockback: 0.5,
  flying: true,
  build() {
    const b = new Builder();
    const white = b.body(COLORS.white, 0.5, true), blue = b.body(COLORS.blue, 0.5, true), dark = b.body(COLORS.navy, 0.7, true);
    const pale = b.body(COLORS.paleBlue, 0.5, true), silver = b.body(COLORS.silver, 0.5, true), deep = b.body(COLORS.deepBlue, 0.6, true);
    // 六角の胴体 + 上下のテーパー装甲（ドローンの一回り大きい版）
    b.prism(0.56, 0.36, 6, white);
    b.mesh(taperGeo(0.3, 0.56, 0.16, 6), pale, b.vis, 0, 0.26, 0);
    b.mesh(taperGeo(0.56, 0.3, 0.18, 6), silver, b.vis, 0, -0.27, 0);
    b.mesh(cachedGeo('mdBelt', () => new THREE.CylinderGeometry(0.575, 0.575, 0.026, 6, 1).rotateY(Math.PI / 6)), b.glow(), b.vis, 0, -0.03, 0).castShadow = false;
    // 顔：バイザー + スリットの目
    b.block(0.42, 0.16, 0.1, dark, b.vis, 0, 0.06, 0.5, 0.03);
    b.mesh(boxGeo(0.32, 0.05, 0.04), b.eye(), b.vis, 0, 0.06, 0.56);
    // 背面のアンテナ
    b.prism(0.015, 0.28, 4, dark, b.vis, -0.14, 0.5, -0.1);
    b.lamp(0.05, 0.05, 0.05, b.vis, -0.14, 0.66, -0.1, 1.8);

    // 回るリング（八角）+ 四隅のプロペラ
    const ring = new THREE.Group();
    ring.position.y = 0.3;
    b.vis.add(ring);
    const oct = b.mesh(cachedGeo('mdOctRing', () => new THREE.TorusGeometry(0.97, 0.05, 4, 8)), blue, ring);
    oct.rotation.x = Math.PI / 2;
    const props: THREE.Object3D[] = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
      const strut = new THREE.Group();
      strut.rotation.y = -a;
      ring.add(strut);
      b.mesh(boxGeo(0.46, 0.05, 0.07), dark, strut, 0.7, 0, 0);
      const pod = b.block(0.2, 0.12, 0.2, dark, ring, Math.cos(a) * 0.97, 0, Math.sin(a) * 0.97, 0.03);
      const blades = new THREE.Group();
      blades.position.y = 0.1;
      pod.add(blades);
      b.mesh(boxGeo(0.46, 0.018, 0.07), pale, blades);
      b.mesh(boxGeo(0.07, 0.018, 0.46), pale, blades);
      b.mesh(boxGeo(0.07, 0.04, 0.07), silver, blades);
      props.push(blades);
    }
    b.parts.ring = ring;
    b.parts.props = props;

    // 左右のミサイルポッド：ハウジング + 上下2本の発射筒（各筒が反動で引っ込む）
    const tubes: THREE.Group[] = [];
    const rimMats: THREE.MeshStandardMaterial[] = [];
    const noseMats: THREE.MeshStandardMaterial[] = [];
    const missiles: THREE.Group[] = [];
    for (const sx of [-1, 1]) {
      b.block(0.32, 0.56, 0.62, white, b.vis, sx * POD_X, POD_Y, -0.14, 0.06);
      b.block(0.07, 0.44, 0.5, blue, b.vis, sx * (POD_X + 0.17), POD_Y, -0.12, 0.02);
      b.block(0.22, 0.08, 0.34, deep, b.vis, sx * POD_X, POD_Y + 0.31, -0.18, 0.03);
      b.lamp(0.12, 0.03, 0.03, b.vis, sx * POD_X, POD_Y + 0.31, 0.0, 1.6);
      b.block(0.3, 0.08, 0.2, dark, b.vis, sx * (POD_X * 0.5), POD_Y, -0.1, 0.03);   // 胴体との接続
    }
    for (let i = 0; i < N; i++) {
      const g = new THREE.Group();
      g.position.set(podSide(i) * POD_X, POD_Y + podRow(i) * POD_DY, 0);
      b.vis.add(g);
      const tube = b.prism(0.12, 0.62, 8, silver, g, 0, 0, 0.0);
      tube.rotation.x = Math.PI / 2;
      const rim = new THREE.MeshStandardMaterial({ color: 0x1a2340, emissive: COLORS.glowBlue, emissiveIntensity: 0.3, roughness: 0.4, flatShading: true });
      rimMats.push(rim);
      const ring2 = b.prism(0.135, 0.06, 8, rim, g, 0, 0, 0.3);
      ring2.rotation.x = Math.PI / 2;
      ring2.castShadow = false;
      // 中のミサイル（筒の口から先端が顔を出す）。+Z が先端
      const m = new THREE.Group();
      g.add(m);
      const mb = b.prism(0.075, 0.7, 6, white, m, 0, 0, 0.35);
      mb.rotation.x = Math.PI / 2;
      const noseMat = new THREE.MeshStandardMaterial({ color: 0xff7a3d, emissive: 0xff5a20, emissiveIntensity: 0.9, roughness: 0.4, flatShading: true });
      noseMats.push(noseMat);
      const nose = b.mesh(taperGeo(0.0, 0.075, 0.24, 6), noseMat, m, 0, 0, 0.81);
      nose.rotation.x = Math.PI / 2;
      tubes.push(g);
      missiles.push(m);
    }
    b.parts.tubes = tubes;
    b.parts.rimMats = rimMats;
    b.parts.noseMats = noseMats;
    b.parts.missiles = missiles;

    // 下のコア（弱点）：受け口と脚
    b.prism(0.22, 0.06, 6, dark, b.vis, 0, -0.42, 0);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 3;
      const g = new THREE.Group();
      g.rotation.y = -a;
      b.vis.add(g);
      const leg = b.mesh(boxGeo(0.04, 0.3, 0.04), dark, g, 0.22, -0.5, 0);
      leg.rotation.z = 0.35;
    }
    b.weak(0, -0.52, 0, 0.26, [1, 1, 1], 0.17);
    return b.done();
  },

  update(c) {
    const { world, e, dt, spec, pc } = c;
    const ai = e.ai, M = MISSILE_DRONE;
    initState(ai);
    const wish = _v.set(0, 0, 0);
    const awake = ai.alert > 0;
    if (!awake) {
      // 待機：ゆっくり上下
      wish.y = Math.sin(world.time * 1.3 + e.id) * 0.4;
      moveFlyer(world, e, dt, wish, 6);
      ai.warn = 0;
      updateReload(c);
      return;
    }
    // ---- 周回：中距離を保って回る
    ai.orbitTimer = (ai.orbitTimer ?? 0) - dt;
    if (ai.orbitTimer <= 0 || ai.orbitDir === undefined) {
      ai.orbitDir = Math.random() < 0.5 ? 1 : -1;
      ai.orbitTimer = 2.2 + Math.random() * 2.5;
      ai.prefDist = M.keepMin + 1.5 + Math.random() * (M.keepMax - M.keepMin - 3);
    }
    const d2 = c.dist2d, speed = spec.speed;
    const rx = c.dirXZ.x, rz = c.dirXZ.z;
    const tx = -rz * ai.orbitDir, tz = rx * ai.orbitDir;
    let radial: number;
    if (!c.los) radial = 1;
    else if (d2 < M.keepMin) radial = -1;
    else if (d2 > M.keepMax) radial = 1;
    else radial = THREE.MathUtils.clamp((d2 - ai.prefDist) * 0.3, -0.5, 0.5);
    // 予備動作・発射中は動きを抑える（狙いを定める）
    const busy = ai.mode !== 'idle';
    const tang = c.los ? (busy ? 0.15 : 0.7) : 0.2;
    if (!e.tethered) {
      wish.x = (rx * radial + tx * tang) * speed;
      wish.z = (rz * radial + tz * tang) * speed;
      const wantY = pc.y + M.hoverHeight + Math.sin(world.time * 1.1 + e.id) * 0.5;
      wish.y = THREE.MathUtils.clamp((wantY - e.pos.y) * 1.2, -speed, speed);
    }
    const hit = moveFlyer(world, e, dt, wish, 6);
    if (hit && ai.orbitTimer > 0.4) ai.orbitDir *= -1;
    faceToward(e, rx, rz, dt, busy ? 4 : 6);

    updateReload(c);

    // ---- 攻撃：予備動作（ポッドが順に点灯）→ 連続発射 → 装填
    if (ai.mode === 'idle') {
      ai.warn = 0;
      for (let i = 0; i < N; i++) ai.lit[i] = 0;
      ai.atkTimer -= dt;
      const loaded = (ai.pods as number[]).every((p) => p >= 1);
      if (ai.atkTimer <= 0 && loaded && c.los && c.dist < spec.sightRange && !e.tethered) {
        ai.mode = 'tele'; ai.teleT = 0;
        ai.litCount = 0;
      }
    } else if (ai.mode === 'tele') {
      if (e.tethered) {
        // 吸収中は中断（点灯は消える）
        ai.mode = 'idle'; ai.atkTimer = 0.8; ai.warn = 0;
        return;
      }
      ai.teleT += dt;
      const f = Math.min(1, ai.teleT / M.teleTime);
      ai.warn = 0.25 + 0.75 * f;
      // 1本ずつ点灯（発射順）。点灯のたびに音
      const lit = Math.min(N, Math.floor(f * N) + 1);
      for (let k = 0; k < lit; k++) ai.lit[ORDER[k]] = Math.min(1, ai.lit[ORDER[k]] + dt * 12);
      if (lit > ai.litCount) {
        ai.litCount = lit;
        world.events.emit('enemyAction', { kind: e.kind, pos: e.pos.clone(), action: 'missileLoad', value: lit / N });
      }
      if (f >= 1) { ai.mode = 'fire'; ai.fireT = 0; ai.fireIdx = 0; }
    } else {
      // 連続発射
      ai.fireT -= dt;
      ai.warn = 0.6;
      while (ai.fireT <= 0 && ai.fireIdx < N) {
        fireOne(c, ORDER[ai.fireIdx]);
        ai.fireIdx++;
        ai.fireT += M.rippleInterval;
      }
      if (ai.fireIdx >= N) {
        ai.mode = 'idle';
        ai.warn = 0;
        ai.reloadClock = 0;
        ai.atkTimer = spec.attackInterval * (0.9 + Math.random() * 0.2);
        // 発射の反動で少し後ろへ
        e.vel.addScaledVector(c.dirXZ, -1.5);
      }
    }
  },

  animate(world, e, dt, down) {
    const ai = e.ai;
    if (!ai.pods) initState(ai);
    const p = ai.model.parts;
    const t: number = ai.t ?? 0;
    const vis = ai.model.vis as THREE.Group;
    const tubes: THREE.Group[] = p.tubes;
    const rims: THREE.MeshStandardMaterial[] = p.rimMats;
    const noses: THREE.MeshStandardMaterial[] = p.noseMats;
    const missiles: THREE.Group[] = p.missiles;
    for (let i = 0; i < N; i++) {
      const load: number = ai.pods[i];
      // 反動（引っ込んで戻る）
      ai.recoil[i] = Math.max(0, ai.recoil[i] - dt * 3.2);
      tubes[i].position.z = -0.2 * ai.recoil[i] * ai.recoil[i];
      // 装填中のミサイルは奥からせり上がる
      missiles[i].visible = load > 0.02;
      missiles[i].scale.setScalar(Math.max(0.001, load));
      missiles[i].position.z = -(1 - load) * 0.5;
      const reloading = load > 0 && load < 1;
      const lit = ai.lit[i] as number;
      const base = load >= 1 ? 0.55 : reloading ? 0.9 + 0.6 * Math.sin(t * 30) : 0.1;
      rims[i].emissiveIntensity = down ? 0 : base + lit * (2.2 + 1.2 * Math.sin(t * 40));
      rims[i].emissive.setHex(lit > 0.1 ? 0xff7a30 : COLORS.glowBlue);
      noses[i].emissiveIntensity = down ? 0 : 0.7 + lit * 2.0;
    }
    if (!down) {
      p.ring.rotation.y += dt * 4;
      for (const d of p.props as THREE.Object3D[]) d.rotation.y += dt * 40;
      // 速度に合わせて傾く（左右はロール、前後はピッチ）
      const yaw: number = ai.yaw ?? 0;
      const lx = e.vel.x * Math.cos(yaw) - e.vel.z * Math.sin(yaw);
      const lz = e.vel.x * Math.sin(yaw) + e.vel.z * Math.cos(yaw);
      const k = Math.min(1, dt * 6);
      vis.rotation.z = THREE.MathUtils.lerp(vis.rotation.z, THREE.MathUtils.clamp(-lx * 0.05, -0.3, 0.3), k);
      vis.rotation.x = THREE.MathUtils.lerp(vis.rotation.x, THREE.MathUtils.clamp(lz * 0.04, -0.25, 0.25), k);
    } else {
      p.ring.rotation.y += dt * 4 * (1 - ai.collapse);
      vis.rotation.z = ai.tilt * 1.1 * ai.collapse;
      vis.rotation.x = 0.5 * ai.collapse;
    }
    void world;
  },
};
