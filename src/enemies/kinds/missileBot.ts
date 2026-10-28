import * as THREE from 'three';
import { Builder, COLORS, boxGeo, taperGeo } from '../models';
import { moveGround, faceToward } from '../common';
import type { Ctx } from '../common';
import { ENEMIES } from '../../config/balance';
import type { EnemyKind } from '../../config/balance';
import type { Enemy, World } from '../../core/types';
import { spawnProjectile } from '../../core/projectiles';
import { spawnBurst, spawnFlash, spawnShockwave } from '../../core/effects';
import type { KindModule } from './kind';

/** ミサイル溜めロボットの調整値 */
export const MISSILE_BOT = {
  /** 好む距離（m） */
  keepMin: 12, keepMax: 18,
  /** 護衛 */
  escortKinds: ['crawler', 'drone', 'walker'] as EnemyKind[],
  escortMax: 3,           // 同時に生きている護衛の上限
  escortPerCast: 2,       // 1回の召喚で出す数
  summonCooldown: 6,      // 召喚の間隔（秒）
  summonRadius: 3.2,
  /** ミサイル */
  missiles: 6,            // 1回の斉射数
  volleyTime: 1.0,        // 斉射にかける時間（秒）
  recover: 1.5,           // 斉射後の硬直（秒）
  missileHp: 15,          // 撃ち落とすのに必要なダメージ
  missileRadius: 0.35,
  launchSpeed: 5,         // 発射直後の上昇速度
  homingDelay: 0.5,       // 上昇してからホーミング開始まで
  turnRate: 1.9,          // 旋回速度（rad/s）
  missileLife: 6,
  blastRadius: 1.6,
  /** 溜めの妨害 */
  disruptDamage: 30,      // この時間窓内の被ダメージ合計でひるむ
  disruptWindow: 0.6,
  disruptCharge: 0.35,    // 溜めが減る量（0..1）
  disruptStun: 0.9,       // 溜めが止まる秒数
  overloadDrain: 0.6,     // 逆流中に溜めが減る量/秒（逆流割合で変化）
} as const;

const N = MISSILE_BOT.missiles;
const TUBE_COLS = [-0.55, 0, 0.55];
const TUBE_ROWS = [-0.28, 0.28];
const POD_POS = new THREE.Vector3(0, 0.95, -0.55);
const POD_TILT = -0.6;
const TUBE_TOP = 0.95;


/** チューブ i の先端（ローカル座標、vis 基準） */
function tubeTipLocal(i: number, out: THREE.Vector3): THREE.Vector3 {
  const x = TUBE_COLS[i % 3], z = TUBE_ROWS[Math.floor(i / 3)];
  const c = Math.cos(POD_TILT), s = Math.sin(POD_TILT);
  const y = TUBE_TOP;
  return out.set(POD_POS.x + x, POD_POS.y + y * c - z * s, POD_POS.z + y * s + z * c);
}

function aliveEscorts(world: World, e: Enemy): Enemy[] {
  const ids: number[] = e.ai.escorts ?? [];
  const list: Enemy[] = [];
  for (const id of ids) {
    const o = world.enemies.find((x) => x.id === id);
    if (o && (o.status === 'active' || o.status === 'stunned')) list.push(o);
  }
  e.ai.escorts = list.map((o) => o.id);
  return list;
}

function summonEscorts(c: Ctx, spawn: Parameters<KindModule['update']>[1], count: number): void {
  const { world, e } = c;
  const M = MISSILE_BOT;
  const ids: number[] = e.ai.escorts ?? (e.ai.escorts = []);
  const base = Math.random() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const kind = M.escortKinds[Math.floor(Math.random() * M.escortKinds.length)];
    const a = base + (i / count) * Math.PI * 2;
    const feet = e.pos.y - e.radius;
    const rr = ENEMIES[kind].radius;
    const pos = new THREE.Vector3(
      e.pos.x + Math.cos(a) * M.summonRadius, feet + rr + (kind === 'drone' ? 1.4 : 0.1), e.pos.z + Math.sin(a) * M.summonRadius,
    );
    const s = spawn(world, kind, pos);
    s.ai.alert = 5;
    ids.push(s.id);
    spawnFlash(world, pos, 0x5ab8ff, 6, 6, 0.25);
    spawnBurst(world, pos, 0x9cc2ff, 8, 3);
  }
  spawnShockwave(world, e.pos, 0x5ab8ff, 3, 0.4);
  world.events.emit('enemyAction', { kind: e.kind, pos: e.pos.clone(), action: 'summon' });
}

function fireOne(c: Ctx, idx: number): void {
  const { world, e } = c;
  const M = MISSILE_BOT;
  const yaw: number = e.ai.yaw ?? 0;
  const loc = tubeTipLocal(idx, new THREE.Vector3());
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const pos = new THREE.Vector3(
    e.pos.x + loc.x * cs + loc.z * sn, e.pos.y + loc.y, e.pos.z - loc.x * sn + loc.z * cs,
  );
  // 上＋外側へ打ち出す
  const side = TUBE_COLS[idx % 3];
  const dirL = new THREE.Vector3(side * 0.7, 1.6, -0.3).normalize();
  const vel = new THREE.Vector3(dirL.x * cs + dirL.z * sn, dirL.y, -dirL.x * sn + dirL.z * cs).multiplyScalar(M.launchSpeed);
  spawnProjectile(world, {
    pos, vel, damage: c.spec.damage, owner: 'enemy', radius: M.missileRadius, size: 0.3, life: M.missileLife,
    missile: true, shootable: true, hp: M.missileHp,
    homing: { turnRate: M.turnRate, target: 'player', delay: M.homingDelay, speed: c.spec.projectileSpeed, accel: 14 },
    blast: { radius: M.blastRadius, color: 0xff9a3d }, trail: 0xffc080,
  });
  spawnBurst(world, pos, 0xffe0a0, 5, 3);
  world.events.emit('enemyAttack', { kind: e.kind, pos: pos.clone() });
}

export const missileBot: KindModule = {
  knockback: 0.3,
  build() {
    const b = new Builder();
    const white = b.body(COLORS.white, 0.5, true), blue = b.body(COLORS.blue, 0.5, true), deep = b.body(COLORS.deepBlue, 0.7, true);
    const silver = b.body(COLORS.silver, 0.5, true), navy = b.body(COLORS.navy, 0.7, true);
    // 胴体：大きな面取り装甲 + 側面アーマー + 排気スリット
    b.block(2.1, 1.3, 2.1, white, b.vis, 0, 0, 0, 0.18);
    for (const sx of [-1, 1]) {
      b.block(0.14, 0.5, 1.4, silver, b.vis, sx * 1.05, 0.3, 0.1, 0.04);
      for (let i = 0; i < 3; i++) b.mesh(boxGeo(0.03, 0.22, 0.07), navy, b.vis, sx * 1.07, -0.2, 0.5 - i * 0.28);
    }
    // キャタピラ脚：箱 + 起動輪 + ゴツい突起
    const legs: THREE.Mesh[] = [];
    for (const sx of [-1, 1]) {
      legs.push(b.block(0.6, 0.6, 1.8, deep, b.vis, sx * 0.85, -0.8, 0, 0.1));
      for (const z of [0.9, -0.9]) b.prism(0.3, 0.64, 8, blue, b.vis, sx * 0.85, -0.8, z).rotation.z = Math.PI / 2;
      for (let i = 0; i < 5; i++) b.mesh(boxGeo(0.64, 0.05, 0.1), navy, b.vis, sx * 0.85, -1.1, -0.7 + i * 0.35);
    }
    b.parts.legs = legs;
    // 頭：箱 + バイザー + スリットの目 + アンテナ
    b.block(0.8, 0.5, 0.66, silver, b.vis, 0, 0.8, 0.7, 0.1);
    b.block(0.7, 0.26, 0.1, navy, b.vis, 0, 0.82, 1.04, 0.03);
    b.mesh(boxGeo(0.56, 0.08, 0.05), b.eye(), b.vis, 0, 0.83, 1.1);
    b.prism(0.02, 0.35, 4, navy, b.vis, 0.3, 1.15, 0.5);
    b.lamp(0.05, 0.05, 0.05, b.vis, 0.3, 1.34, 0.5, 1.8);
    // 背中のミサイルポッド
    const pod = new THREE.Group();
    pod.position.copy(POD_POS);
    pod.rotation.x = POD_TILT;
    b.vis.add(pod);
    b.block(1.9, 0.22, 1.2, blue, pod, 0, 0, 0, 0.05);
    for (const sx of [-1, 1]) b.block(0.08, 0.5, 1.2, deep, pod, sx * 0.97, 0.3, 0, 0.02);
    const missiles: THREE.Group[] = [];
    const tubeMats: THREE.MeshStandardMaterial[] = [];
    const noseMats: THREE.MeshStandardMaterial[] = [];
    for (let i = 0; i < N; i++) {
      const x = TUBE_COLS[i % 3], z = TUBE_ROWS[Math.floor(i / 3)];
      b.prism(0.2, 0.8, 8, silver, pod, x, 0.5, z);
      const rim = new THREE.MeshStandardMaterial({ color: 0x1a2340, emissive: COLORS.glowBlue, emissiveIntensity: 0, roughness: 0.4, flatShading: true });
      tubeMats.push(rim);
      b.prism(0.215, 0.07, 8, rim, pod, x, 0.9, z).castShadow = false;
      // 中のミサイル（溜まるにつれて顔を出す）
      const m = new THREE.Group();
      m.position.set(x, 0.55, z);
      b.prism(0.1, 0.5, 6, b.body(COLORS.white, 0.5, true), m, 0, 0.3, 0);
      const noseMat = new THREE.MeshStandardMaterial({ color: 0xff7a3d, emissive: COLORS.glowBlue, emissiveIntensity: 0.3, roughness: 0.4, flatShading: true });
      noseMats.push(noseMat);
      b.mesh(taperGeo(0.0, 0.1, 0.24, 6), noseMat, m, 0, 0.67, 0);
      pod.add(m);
      m.scale.setScalar(0.001);
      missiles.push(m);
    }
    b.parts.missiles = missiles;
    b.parts.tubeMats = tubeMats;
    b.parts.noseMats = noseMats;
    // 溜めゲージ（胴体の両脇、下から伸びる）
    const gaugeMat = new THREE.MeshBasicMaterial({ color: COLORS.glowBlue });
    const gauges: THREE.Group[] = [];
    for (const sx of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(sx * 1.05, -0.35, -0.3);
      b.vis.add(g);
      const bar = new THREE.Mesh(boxGeo(0.1, 1, 0.14), gaugeMat);
      bar.position.y = 0.5;
      g.add(bar);
      g.scale.y = 0.001;
      gauges.push(g);
    }
    b.parts.gauges = gauges;
    b.parts.gaugeMat = gaugeMat;
    // 弱点：背面下のパワーセル（枠で囲って目立たせる）
    b.block(1.0, 0.1, 0.24, navy, b.vis, 0, 0.42, -1.12, 0.03);
    b.block(1.0, 0.1, 0.24, navy, b.vis, 0, -0.42, -1.12, 0.03);
    for (const sx of [-1, 1]) b.block(0.1, 0.9, 0.24, navy, b.vis, sx * 0.5, 0, -1.12, 0.03);
    b.weak(0, 0.0, -1.18, 0.42, [1.3, 1, 0.8], 0.26);
    return b.done();
  },

  update(c, spawn) {
    const { world, e, dt, spec, dirXZ, dist2d } = c;
    const ai = e.ai;
    const M = MISSILE_BOT;
    ai.charge ??= 0; ai.stunC ??= 0; ai.summonCd ??= 0.4; ai.volley ??= 0; ai.recover ??= 0;
    ai.hpPrev ??= e.hp; ai.dmgWin ??= 0; ai.dmgWinT ??= 0;
    ai.walk ??= 0;

    // ---- 被ダメージ監視（吸収中の減少は除く）
    const lost = ai.hpPrev - e.hp;
    ai.hpPrev = e.hp;
    ai.dmgWinT -= dt;
    if (ai.dmgWinT <= 0) ai.dmgWin = 0;
    if (lost > 0 && !e.tethered) {
      ai.dmgWin += lost;
      ai.dmgWinT = M.disruptWindow;
      if (ai.dmgWin >= M.disruptDamage && ai.volley <= 0) {
        ai.dmgWin = 0;
        if (ai.charge > 0.02) {
          ai.charge = Math.max(0, ai.charge - M.disruptCharge);
          ai.stunC = M.disruptStun;
          world.events.emit('enemyAction', { kind: e.kind, pos: e.pos.clone(), action: 'missileDisrupt' });
          spawnBurst(world, e.pos.clone().setY(e.pos.y + 1.2), 0x5ab8ff, 14, 5);
          spawnShockwave(world, e.pos, 0x9cc2ff, 2.6, 0.3);
        }
      }
    }
    // ---- 過負荷で溜めが抜ける
    if (e.overload > 0 && world.time - ai.lastOverload < 0.3 && ai.volley <= 0) {
      ai.charge = Math.max(0, ai.charge - M.overloadDrain * (0.3 + 0.7 * e.overload / spec.overloadCap) * dt);
    }
    ai.stunC = Math.max(0, ai.stunC - dt);

    const awake = ai.alert > 0;
    const escorts = aliveEscorts(world, e);

    // ---- 移動：距離を保ち、護衛の後ろに隠れる
    faceToward(e, dirXZ.x, dirXZ.z, dt, 4);
    let wx = 0, wz = 0;
    if (awake && !e.tethered && ai.volley <= 0) {
      const sp = spec.speed;
      if (dist2d < M.keepMin) { wx = -dirXZ.x * sp; wz = -dirXZ.z * sp; }
      else if (dist2d > M.keepMax) { wx = dirXZ.x * sp; wz = dirXZ.z * sp; }
      else if (escorts.length > 0) {
        // 護衛の重心の向こう側へ寄る
        let cx = 0, cz = 0;
        for (const o of escorts) { cx += o.pos.x; cz += o.pos.z; }
        cx /= escorts.length; cz /= escorts.length;
        const tx = cx - dirXZ.x * 3.5 - e.pos.x, tz = cz - dirXZ.z * 3.5 - e.pos.z;
        const d = Math.hypot(tx, tz);
        if (d > 1) { wx = (tx / d) * sp * 0.6; wz = (tz / d) * sp * 0.6; }
      }
    }
    moveGround(world, e, dt, wx, wz, 12);
    ai.walk = Math.hypot(e.vel.x, e.vel.z);

    if (!awake) { ai.warn = 0; return; }

    // ---- 護衛の召喚
    ai.summonCd -= dt;
    if (ai.summonCd <= 0 && escorts.length < M.escortMax && ai.volley <= 0) {
      ai.summonCd = M.summonCooldown;
      summonEscorts(c, spawn, Math.min(M.escortPerCast, M.escortMax - escorts.length));
    }

    // ---- 溜め／斉射
    if (ai.volley > 0) {
      ai.volleyT -= dt;
      const interval = M.volleyTime / N;
      while (ai.volleyT <= 0 && ai.volley > 0) {
        fireOne(c, N - ai.volley);
        ai.volley--;
        ai.volleyT += interval;
      }
      ai.warn = 0.6;
      if (ai.volley <= 0) { ai.charge = 0; ai.recover = M.recover; ai.warn = 0; }
      return;
    }
    if (ai.recover > 0) { ai.recover -= dt; ai.warn = 0; return; }

    const paused = e.tethered || ai.stunC > 0;
    ai.chargePaused = paused;
    const prevCharge: number = ai.charge;
    if (!paused) ai.charge = Math.min(1, ai.charge + dt / spec.attackInterval);
    // 装填音：1本ぶん溜まるごと / 80%超は警告ビープ
    if (Math.floor(ai.charge * N) > Math.floor(prevCharge * N) && ai.charge < 1) {
      world.events.emit('enemyAction', { kind: e.kind, pos: e.pos.clone(), action: 'missileLoad', value: ai.charge });
    }
    if (ai.charge > 0.8 && !paused) {
      ai.beepT = (ai.beepT ?? 0) - dt;
      if (ai.beepT <= 0) {
        ai.beepT = 0.32 - 0.2 * ((ai.charge - 0.8) / 0.2);
        world.events.emit('enemyAction', { kind: e.kind, pos: e.pos.clone(), action: 'missileBeep', value: ai.charge });
      }
    }
    ai.warn = ai.charge > 0.8 ? (ai.charge - 0.8) / 0.2 : 0;
    if (ai.charge >= 1) {
      ai.volley = N;
      ai.volleyT = 0;
      ai.warn = 1;
      spawnFlash(world, e.pos, 0xff9a3d, 8, 10, 0.3);
    }
  },

  animate(world, e, dt, down) {
    const ai = e.ai;
    const p = ai.model.parts;
    const t: number = ai.t ?? 0;
    const charge: number = down ? 0 : ai.charge ?? 0;
    const firing = (ai.volley ?? 0) > 0;
    const loaded = firing ? ai.volley : charge * N;  // 装填済みの本数（小数）
    const missiles: THREE.Group[] = p.missiles;
    const tubes: THREE.MeshStandardMaterial[] = p.tubeMats;
    const noses: THREE.MeshStandardMaterial[] = p.noseMats;
    const stunned = (ai.stunC ?? 0) > 0;
    const hot = charge > 0.8 ? 0.5 + 0.5 * Math.sin(t * 24) : 0;
    for (let i = 0; i < N; i++) {
      const f = THREE.MathUtils.clamp(loaded - i, 0, 1);
      // 発射済みは空
      const s = firing ? (i >= N - ai.volley ? 1 : 0.001) : Math.max(0.001, f);
      missiles[i].scale.setScalar(s);
      const lit = !down && f > 0.001;
      tubes[i].emissiveIntensity = down ? 0 : (lit ? 1.1 + hot : 0.15) * (stunned ? 0.4 + 0.6 * Math.abs(Math.sin(t * 30)) : 1);
      noses[i].emissive.setHex(charge > 0.8 ? 0xff7a30 : COLORS.glowBlue);
      noses[i].emissiveIntensity = down ? 0 : 0.4 + 1.2 * f + hot;
    }
    // ゲージ
    const gm: THREE.MeshBasicMaterial = p.gaugeMat;
    gm.color.setHex(charge > 0.8 ? 0xff7a30 : stunned ? 0x9cc2ff : COLORS.glowBlue);
    for (const g of p.gauges as THREE.Group[]) g.scale.y = Math.max(0.001, charge * 1.2);
    // 歩行の揺れ／倒れ
    const vis = ai.model.vis as THREE.Group;
    if (!down) {
      ai.phaseW = (ai.phaseW ?? 0) + dt * (2 + (ai.walk ?? 0) * 1.5);
      vis.position.y += Math.abs(Math.sin(ai.phaseW)) * 0.04 * Math.min(1, (ai.walk ?? 0) / 1.5);
      if (firing) vis.rotation.x = -0.08;
      else vis.rotation.x = THREE.MathUtils.lerp(vis.rotation.x, 0, Math.min(1, dt * 8));
    } else {
      vis.rotation.x = 0.5 * ai.collapse;
      vis.position.y = -0.3 * ai.collapse;
      gm.color.setHex(0x333840);
    }
  },

  onRemove(world, e) {
    // 追加メッシュは持たない（ゲージのマテリアルのみ破棄）
    const gm = e.ai.model?.parts?.gaugeMat as THREE.Material | undefined;
    gm?.dispose();
    void world;
  },
};
