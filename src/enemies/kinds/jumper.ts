// ジャンパー：大きな頭の二足歩行。ゆっくり跳んで近づき、着地の瞬間に突く。
// 頭（装甲の花びら）は普段は閉じていて、中の核は着地して開いている間だけ撃てる・吸える。
import * as THREE from 'three';
import { Builder, COLORS, boxGeo, cachedGeo, taperGeo, unitCircle, wedgeGeo, type Model } from '../models';
import { approach, faceToward, moveGround } from '../common';
import { PLAYER } from '../../config/balance';
import { damagePlayer, PLAYER_HIT_RADIUS } from '../../core/combat';
import { spawnBurst, spawnShockwave } from '../../core/effects';
import type { Enemy, World } from '../../core/types';
import type { KindModule } from './kind';

/** ジャンパーの調整値。移動速度・攻撃間隔・ダメージは ENEMIES.jumper（speed=1回の跳躍の水平速度の上限、attackInterval=着地から次の跳躍までの周期） */
export const JUMPER = {
  /** しゃがみ（予告）の長さ（s）。この間は赤く光る */
  crouchTime: 0.75,
  /** 跳び上がりの初速（m/s）。ゆっくり浮くよう重力も弱める */
  jumpSpeed: 8.5,
  /** 空中の重力（m/s²）。滞空 = 2*jumpSpeed/gravity ≒ 1.3 秒 */
  gravity: 13,
  /** 着地点とプレイヤーの距離のねらい（m）。突きの届く少し手前に降りる（真上には降りない） */
  landGap: 2.3,
  /** 着地から突きが出るまで（s）。この間に槍を引いて構える */
  thrustAt: 0.24,
  /** 槍の先端が体の中心から届く距離（m） */
  thrustReach: 1.8,
  /** 突きの範囲（正面からの角度の cos。0.64 ≒ 50°） */
  thrustCos: 0.64,
  /** 頭の開閉の速さ（1/s）。1 が全開 */
  openRate: 6,
  /** 開いた判定の下限（openAmt がこれ以上で撃てる・吸える） */
  openThreshold: 0.5,
  /** 頭が開いている最短時間（s） */
  minOpen: 1.2,
  /** 気絶中の最短の開放（s） */
  stunOpen: 0.6,
} as const;

// ---- 寸法（体の中心 = 原点、床は -0.95）
const HEAD_Y = 0.55;
const HEAD_R = 0.72;
/** 花びらの蝶番の位置（頭の天頂からの角度）。赤道より少し下 */
const HINGE_THETA = Math.PI * 0.62;
const THIGH = 0.26;
const SHIN = 0.26;
const LEG_LEN = THIGH + SHIN;
/** 花びらの開き角（rad）：前・右・後・左 */
const PETAL_OPEN = [1.3, 1.15, 1.4, 1.15];
const CORE_REST_Y = 0.05;
const CORE_LIFT = 0.22;
const LANCE_REST = 1.3;

const smooth = (x: number) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

/** 球面上の点に飾りを置く：d=花びらの向き(水平単位), theta=天頂からの角。長手が子午線方向、上が球の法線 */
function placeOnShell(m: THREE.Object3D, d: THREE.Vector3, theta: number, lift = 0): void {
  const st = Math.sin(theta), ct = Math.cos(theta);
  const n = new THREE.Vector3(st * d.x, ct, st * d.z);
  const mer = new THREE.Vector3(ct * d.x, -st, ct * d.z);
  const tan = new THREE.Vector3().crossVectors(n, mer);
  m.position.copy(n).multiplyScalar(HEAD_R + lift);
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tan, n, mer));
}

interface JumperParts {
  hips: THREE.Group[]; knees: THREE.Group[]; feet: THREE.Group[]; arms: THREE.Group[];
  head: THREE.Group; petals: THREE.Group[]; petalDirs: THREE.Vector3[];
  core: THREE.Mesh; column: THREE.Mesh; ring: THREE.Mesh; glow: THREE.Mesh; lance: THREE.Group;
  teleCircle: THREE.Mesh;
}

function buildJumper(): Model {
  const b = new Builder();
  const white = b.body(COLORS.white, 0.5, true), silver = b.body(COLORS.silver, 0.5, true), blue = b.body(COLORS.blue, 0.5, true);
  const deep = b.body(COLORS.deepBlue, 0.6, true), navy = b.body(COLORS.navy, 0.7, true);
  const pw = b.body(COLORS.white, 0.5, true), ps = b.body(COLORS.silver, 0.5, true);
  pw.side = THREE.DoubleSide; ps.side = THREE.DoubleSide;

  // ---- 脚：腰 → 膝 → 足首（それぞれ回る）
  const hips: THREE.Group[] = [], knees: THREE.Group[] = [], feet: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.27, -0.34, 0);
    b.vis.add(hip);
    b.prism(0.1, 0.16, 6, blue, hip).rotation.z = Math.PI / 2;
    b.block(0.17, THIGH + 0.04, 0.2, white, hip, 0, -0.14, 0, 0.04);
    b.mesh(boxGeo(0.025, 0.18, 0.03), navy, hip, sx * 0.09, -0.14, 0.06);
    const knee = new THREE.Group();
    knee.position.set(0, -THIGH, 0);
    hip.add(knee);
    b.prism(0.085, 0.15, 6, deep, knee).rotation.z = Math.PI / 2;
    b.mesh(taperGeo(0.095, 0.06, SHIN, 6), silver, knee, 0, -SHIN / 2, 0);
    b.block(0.12, 0.15, 0.05, navy, knee, 0, -0.11, 0.07, 0.02);
    const foot = new THREE.Group();
    foot.position.set(0, -SHIN, 0);
    knee.add(foot);
    b.prism(0.07, 0.13, 6, blue, foot).rotation.z = Math.PI / 2;
    b.block(0.26, 0.09, 0.4, navy, foot, 0, -0.045, 0.07, 0.03);
    b.mesh(wedgeGeo(0.24, 0.08, 0.14), silver, foot, 0, -0.05, 0.3);
    b.lamp(0.04, 0.025, 0.18, foot, 0, 0.004, 0.06);
    hips.push(hip); knees.push(knee); feet.push(foot);
  }

  // ---- 小さな胴体：骨盤 + 面取りのトルソー + 胸プレート
  b.block(0.76, 0.16, 0.4, navy, b.vis, 0, -0.3, 0, 0.04);
  b.block(0.54, 0.42, 0.4, white, b.vis, 0, -0.04, 0, 0.07);
  b.block(0.38, 0.22, 0.06, silver, b.vis, 0, 0.0, 0.21, 0.02);
  b.lamp(0.26, 0.035, 0.02, b.vis, 0, -0.02, 0.245);
  b.block(0.34, 0.3, 0.12, navy, b.vis, 0, -0.02, -0.25, 0.03);
  for (const sx of [-1, 1]) b.mesh(boxGeo(0.025, 0.26, 0.03), navy, b.vis, sx * 0.275, -0.04, 0.1);
  // 首
  b.prism(0.17, 0.16, 8, navy, b.vis, 0, 0.2, 0);

  // ---- 腕（肩で回る・ぶらさがり）
  const arms: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(sx * 0.37, 0.06, 0);
    b.vis.add(sh);
    b.prism(0.09, 0.14, 6, blue, sh).rotation.z = Math.PI / 2;
    b.block(0.11, 0.3, 0.13, white, sh, sx * 0.02, -0.17, 0, 0.03);
    b.block(0.14, 0.15, 0.17, navy, sh, sx * 0.02, -0.4, 0.01, 0.03);
    arms.push(sh);
  }

  // ---- 突きの槍（胸の前。ふだんは下向きにぶら下がっている）
  const lance = new THREE.Group();
  lance.position.set(0, -0.1, 0.1);
  b.vis.add(lance);
  b.prism(0.1, 0.2, 6, blue, lance).rotation.x = Math.PI / 2;
  b.block(0.16, 0.16, 0.16, navy, lance, 0, 0, 0.14, 0.03);
  b.prism(0.055, 0.5, 6, silver, lance, 0, 0, 0.36).rotation.x = Math.PI / 2;
  b.mesh(taperGeo(0, 0.075, 0.32, 4), white, lance, 0, 0, 0.65).rotation.x = Math.PI / 2;
  b.lamp(0.14, 0.14, 0.03, lance, 0, 0, 0.5, 1.6);

  // ---- 巨大な頭：下のお椀 + 4枚の花びら（閉じた装甲）+ 中の核
  const head = new THREE.Group();
  head.position.set(0, HEAD_Y, 0);
  b.vis.add(head);
  const bowlGeo = cachedGeo('jumperBowl', () => new THREE.SphereGeometry(HEAD_R, 8, 3, 0, Math.PI * 2, HINGE_THETA, Math.PI - HINGE_THETA));
  b.mesh(bowlGeo, deep, head);
  const collarY = HEAD_R * Math.cos(HINGE_THETA);
  const collarR = HEAD_R * Math.sin(HINGE_THETA);
  b.prism(collarR + 0.03, 0.09, 8, navy, head, 0, collarY, 0);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const l = b.lamp(0.16, 0.04, 0.05, head, Math.sin(a) * (collarR + 0.04), collarY + 0.01, Math.cos(a) * (collarR + 0.04), 1.8);
    l.rotation.y = a;
  }
  // 核の台座（中）：受け皿 + 持ち上げ柱
  b.prism(0.4, 0.07, 8, navy, head, 0, collarY + 0.02, 0);
  b.prism(0.28, 0.05, 8, silver, head, 0, collarY + 0.07, 0);
  const column = b.prism(0.1, 0.3, 6, silver, head, 0, collarY, 0);

  // 花びら（蝶番で外へ倒れる）
  const petals: THREE.Group[] = [];
  const petalDirs: THREE.Vector3[] = [];
  const hingeH = collarR; // 蝶番の水平距離
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const d = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const phiC = Math.PI / 2 + a;
    const geo = cachedGeo(`jumperPetal${i}`, () => new THREE.SphereGeometry(HEAD_R, 2, 3, phiC - Math.PI / 4, Math.PI / 2, 0, HINGE_THETA));
    const pivot = new THREE.Group();
    pivot.position.set(d.x * hingeH, collarY, d.z * hingeH);
    head.add(pivot);
    const inner = new THREE.Group();
    inner.position.set(-d.x * hingeH, -collarY, -d.z * hingeH);
    pivot.add(inner);
    b.mesh(geo, i % 2 ? ps : pw, inner);
    // 子午線に沿う光のライン + リブ
    const ridge = b.lamp(0.045, 0.035, 0.34, inner, 0, 0, 0, 1.5);
    placeOnShell(ridge, d, Math.PI * 0.3, 0.012);
    const rib = b.block(0.2, 0.04, 0.16, navy, inner, 0, 0, 0, 0.012);
    placeOnShell(rib, d, Math.PI * 0.12, 0.005);
    if (i === 0) {
      // 顔：バイザーとスリットの目
      const visor = b.block(0.58, 0.22, 0.08, navy, inner, 0, 0, 0, 0.03);
      placeOnShell(visor, d, Math.PI * 0.45, 0.0);
      const eye = b.mesh(boxGeo(0.46, 0.065, 0.04), b.eye(), inner);
      placeOnShell(eye, d, Math.PI * 0.45, 0.05);
    } else if (i === 2) {
      // 後ろのアンテナ
      const ant = b.prism(0.018, 0.32, 4, navy, inner);
      placeOnShell(ant, d, Math.PI * 0.2, 0.1);
      const tip = b.lamp(0.05, 0.05, 0.05, inner, 0, 0, 0, 1.8);
      placeOnShell(tip, d, Math.PI * 0.2, 0.28);
    } else {
      // 横の耳
      const ear = b.block(0.1, 0.3, 0.3, blue, inner, 0, 0, 0, 0.025);
      placeOnShell(ear, d, Math.PI * 0.5, 0.02);
    }
    petals.push(pivot);
    petalDirs.push(d);
  }

  // 核（弱点）：開いたときだけ当たる。頭の中に置く
  const wp = b.weak(0, 0, 0, 0.42, [1, 1, 1], 0.3);
  head.add(wp.mesh);
  wp.mesh.position.set(0, CORE_REST_Y, 0);
  wp.exposed = false;
  wp.mesh.visible = false;
  // 核の回りの光のリングと、開いたときのまぶしさ
  const ring = b.mesh(cachedGeo('jumperRing', () => new THREE.TorusGeometry(0.42, 0.028, 4, 8)), b.glow(2), head, 0, CORE_REST_Y, 0);
  ring.rotation.x = Math.PI / 2;
  ring.castShadow = false;
  const glow = new THREE.Mesh(
    cachedGeo('jumperGlow', () => new THREE.SphereGeometry(0.62, 12, 8)),
    new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0, depthWrite: false }),
  );
  head.add(glow);

  // 着地点の予告（root 直下、足元）
  const circle = new THREE.Mesh(unitCircle(), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  circle.rotation.x = -Math.PI / 2;
  circle.visible = false;
  b.root.add(circle);

  const parts: JumperParts = { hips, knees, feet, arms, head, petals, petalDirs, core: wp.mesh, column, ring, glow, lance, teleCircle: circle };
  Object.assign(b.parts, parts);
  return b.done();
}

// ------------------------------------------------------------------ AI
/** 状態：idle（立って待つ）→ crouch（しゃがみ予告）→ air（跳躍）→ open（着地・頭が開く・突き）→ crouch … */
type JState = 'idle' | 'crouch' | 'air' | 'open';

function airTime(): number { return (2 * JUMPER.jumpSpeed) / JUMPER.gravity; }

function takeoff(e: Enemy, dirX: number, dirZ: number, dist2d: number, speed: number): void {
  const ai = e.ai;
  const want = THREE.MathUtils.clamp(dist2d - JUMPER.landGap, 0, speed * airTime());
  const hs = want / airTime();
  ai.hx = dirX * hs; ai.hz = dirZ * hs;
  ai.destX = e.pos.x + dirX * want; ai.destZ = e.pos.z + dirZ * want;
  ai.destY = e.pos.y - e.radius;
  e.vel.set(ai.hx, JUMPER.jumpSpeed, ai.hz);
  ai.state = 'air'; ai.airT = 0; ai.warn = 0;
}

function land(world: World, e: Enemy, stunned: boolean): void {
  const ai = e.ai;
  ai.state = 'open';
  ai.openT = 0;
  ai.thrustT = stunned ? 99 : 0;
  ai.thrustDone = stunned;
  ai.landK = 1;
  e.vel.x = 0; e.vel.z = 0;
  const foot = new THREE.Vector3(e.pos.x, e.pos.y - e.radius + 0.1, e.pos.z);
  spawnShockwave(world, foot, 0xbfe0ff, 2.6, 0.45);
  spawnBurst(world, foot, 0x9fd8ff, 10, 4);
}

function thrust(world: World, e: Enemy, dirX: number, dirZ: number, dist2d: number, pcY: number, damage: number): void {
  const ai = e.ai;
  const yaw = ai.yaw ?? 0;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const tip = new THREE.Vector3(e.pos.x + fx * JUMPER.thrustReach, e.pos.y - 0.1, e.pos.z + fz * JUMPER.thrustReach);
  const inReach = dist2d < JUMPER.thrustReach + PLAYER_HIT_RADIUS + 0.1;
  const inFront = dist2d < e.radius * 0.8 || dirX * fx + dirZ * fz > JUMPER.thrustCos;
  if (inReach && inFront && Math.abs(pcY - e.pos.y) < 1.6) {
    damagePlayer(world, damage);
  }
  spawnBurst(world, tip, 0xbfe8ff, 8, 5, 0.3);
  spawnShockwave(world, tip, 0x9fd8ff, 0.9, 0.25);
  world.events.emit('enemyAttack', { kind: e.kind, pos: e.pos.clone() });
}

export const jumper: KindModule = {
  knockback: 0.35,

  build() { return buildJumper(); },

  update(c) {
    const { world, e, dt, spec, dirXZ, dist2d, pc } = c;
    const ai = e.ai;
    const st: JState = ai.state ?? 'idle';
    if (ai.state === undefined) { ai.state = 'idle'; ai.openAmt = 0; ai.stateT = 0; }
    const stunned = e.status === 'stunned';
    const openTime = Math.max(JUMPER.minOpen, spec.attackInterval - JUMPER.crouchTime);

    if (stunned) {
      // 気絶：しゃがむ・待つ途中なら頭を開いて固まる（地上のとき）
      ai.stunT = (ai.stunT ?? 0) - dt;
      if (ai.stunT <= 0) e.status = 'active';
      if (st === 'idle' || st === 'crouch') {
        ai.state = 'open'; ai.openT = 0; ai.thrustT = 99; ai.thrustDone = true; ai.warn = 0;
      }
    }

    switch (ai.state as JState) {
      case 'idle': {
        moveGround(world, e, dt, 0, 0, 12);
        if (ai.alert > 0) { ai.state = 'crouch'; ai.stateT = JUMPER.crouchTime; }
        break;
      }
      case 'crouch': {
        moveGround(world, e, dt, 0, 0, 12);
        faceToward(e, dirXZ.x, dirXZ.z, dt, 6);
        ai.stateT -= dt;
        ai.warn = 1 - Math.max(0, ai.stateT) / JUMPER.crouchTime;
        if (ai.stateT <= 0) takeoff(e, dirXZ.x, dirXZ.z, dist2d, spec.speed);
        break;
      }
      case 'air': {
        // ふわっと浮く：重力を弱める
        e.vel.y += (PLAYER.gravity - JUMPER.gravity) * dt;
        const res = moveGround(world, e, dt, stunned ? 0 : ai.hx, stunned ? 0 : ai.hz, 40);
        ai.airT += dt;
        if ((ai.airT > 0.15 && res.onGround && e.vel.y <= 0.001) || ai.airT > airTime() * 2.5) land(world, e, stunned);
        break;
      }
      case 'open': {
        moveGround(world, e, dt, 0, 0, 12);
        ai.openT += dt;
        ai.thrustT += dt;
        faceToward(e, dirXZ.x, dirXZ.z, dt, ai.thrustT < JUMPER.thrustAt ? 10 : 1.5);
        if (!ai.thrustDone && ai.thrustT >= JUMPER.thrustAt) {
          ai.thrustDone = true;
          thrust(world, e, dirXZ.x, dirXZ.z, dist2d, pc.y, spec.damage);
        }
        if (ai.openT >= openTime && e.status !== 'stunned') {
          // 閉じて次の跳躍へ
          if (ai.alert > 0) { ai.state = 'crouch'; ai.stateT = JUMPER.crouchTime; } else ai.state = 'idle';
        }
        break;
      }
    }

    // 頭の開閉：開いている間だけ弱点が出て、守りが解ける
    ai.openAmt = approach(ai.openAmt ?? 0, ai.state === 'open' ? 1 : 0, dt * JUMPER.openRate);
    const isOpen = ai.openAmt >= JUMPER.openThreshold;
    e.shielded = !isOpen;
    for (const w of e.weakPoints) { w.exposed = isOpen; w.mesh.visible = ai.openAmt > 0.05; }
    ai.walk = 0;
  },

  animate(_world, e, dt, down) {
    const ai = e.ai;
    const p = ai.model.parts as JumperParts;
    const vis = ai.model.vis as THREE.Group;
    const t: number = ai.t ?? 0;
    const k = (r: number) => Math.min(1, dt * r);
    const st = ai.state as JState | undefined;

    if (down) {
      // 崩れ落ちる：脚が折れ、頭がうなだれて花びらが力なく開く
      const cl: number = ai.collapse;
      p.hips.forEach((h, i) => { h.rotation.x = -0.6 * cl; h.rotation.z = (i ? 1 : -1) * 0.15 * cl; });
      p.knees.forEach((n) => { n.rotation.x = 1.1 * cl; });
      p.feet.forEach((f) => { f.rotation.x = -0.5 * cl; });
      p.arms.forEach((a, i) => { a.rotation.x = 0.4 * cl; a.rotation.z = (i ? -1 : 1) * 0.3 * cl; });
      p.head.rotation.x = 0.5 * cl;
      p.head.position.y = HEAD_Y;
      p.petals.forEach((pv, i) => { pv.quaternion.setFromAxisAngle(new THREE.Vector3(p.petalDirs[i].z, 0, -p.petalDirs[i].x), 0.5 * cl); });
      p.lance.rotation.x = LANCE_REST + 0.2 * cl;
      p.column.scale.y = 1;
      vis.rotation.z = (ai.tilt ?? 1) * 1.2 * cl;
      vis.position.y = -0.4 * cl;
      return;
    }

    // ---- 姿勢の目標値
    ai.landK = Math.max(0, (ai.landK ?? 0) - dt * 3);
    const crouchTarget = st === 'crouch' ? Math.max(0.15, ai.warn ?? 0) : st === 'open' ? ai.landK * 0.9 : 0;
    const airTarget = st === 'air' ? 1 : 0;
    ai.vC = THREE.MathUtils.lerp(ai.vC ?? 0, crouchTarget, k(st === 'air' ? 30 : 14));
    ai.vAir = THREE.MathUtils.lerp(ai.vAir ?? 0, airTarget, k(airTarget ? 30 : 16));
    const c: number = ai.vC, a: number = ai.vAir;

    // 空中：上昇・落下中は脚を伸ばし、頂点付近で畳む
    const ext = Math.min(1, Math.abs(e.vel.y) / (JUMPER.jumpSpeed * 0.55));
    const groundH = -0.95 * c, groundK = 1.7 * c;
    const airH = THREE.MathUtils.lerp(-0.75, 0.1, ext), airK = THREE.MathUtils.lerp(1.35, 0.0, ext);
    const h = THREE.MathUtils.lerp(groundH, airH, a), kn = THREE.MathUtils.lerp(groundK, airK, a);
    p.hips.forEach((hip, i) => {
      const sw = (i ? 1 : -1) * 0.12 * a;
      hip.rotation.x = h + sw;
      p.knees[i].rotation.x = kn;
      p.feet[i].rotation.x = -(h + sw + kn) + 0.5 * a;
    });
    // 接地中はしゃがんだぶん体を下げて足を床につける
    const drop = Math.max(0, LEG_LEN - THIGH * Math.cos(h) - SHIN * Math.cos(h + kn)) * (1 - a);
    vis.position.y -= drop;
    vis.rotation.x = 0.16 * c - 0.1 * a * ext;

    // 腕：しゃがみで後ろへ、跳躍で振り上げる、突きで引く
    const lp = lancePose(ai.thrustT ?? 99);
    const armAir = THREE.MathUtils.lerp(-0.4, -1.3, ext);
    p.arms.forEach((arm, i) => {
      const base = 0.1 + 0.8 * c;
      arm.rotation.x = THREE.MathUtils.lerp(base, armAir, a) + 0.7 * lp.stab;
      arm.rotation.z = (i ? -1 : 1) * (0.08 + 0.35 * a);
    });

    // 槍：ふだんは下向き。着地で引いて構え、突き出す
    p.lance.rotation.x = LANCE_REST * (1 - lp.up) - 0.1 * lp.stab;
    p.lance.position.z = 0.1 + 0.9 * lp.ext;

    // ---- 頭
    const o = smooth(ai.openAmt ?? 0);
    p.head.position.y = HEAD_Y + 0.025 * Math.sin(t * 2.2 + e.id);
    p.head.rotation.x = 0.18 * c + 0.22 * o + 0.1 * lp.stab - 0.1 * a * ext;
    const ax = new THREE.Vector3();
    p.petals.forEach((pv, i) => {
      const d = p.petalDirs[i];
      ax.set(d.z, 0, -d.x); // 上 × 向き：この軸まわりに正に回すと先端が外へ倒れる
      pv.quaternion.setFromAxisAngle(ax, o * PETAL_OPEN[i] + 0.04 * o * Math.sin(t * 7 + i * 1.7));
    });
    // 核：開くと持ち上がって光る
    const coreY = CORE_REST_Y + CORE_LIFT * o;
    p.core.position.y = coreY;
    p.ring.position.y = coreY;
    p.ring.rotation.z += dt * 3;
    p.ring.scale.setScalar(0.4 + 0.7 * o);
    p.ring.visible = o > 0.02;
    p.glow.position.y = coreY;
    p.glow.scale.setScalar(0.8 + 0.5 * o + 0.06 * Math.sin(t * 10));
    (p.glow.material as THREE.MeshBasicMaterial).opacity = 0.34 * o;
    const colY = -0.27;
    const top = coreY - 0.05;
    p.column.scale.y = Math.max(0.2, (top - colY) / 0.3);
    p.column.position.y = colY + 0.15 * p.column.scale.y;
    for (const m of ai.model.weakMats as THREE.MeshStandardMaterial[]) m.emissiveIntensity = 0.5 + 1.6 * o + 0.35 * o * Math.sin(t * 9);
    // 弱点の当たり位置（root 座標）を頭の動きに合わせる
    const wp = e.weakPoints[0];
    if (wp) wp.offset.set(vis.position.x, vis.position.y + p.head.position.y + coreY, vis.position.z + coreY * Math.sin(p.head.rotation.x));

    // 着地点の予告
    const tc = p.teleCircle;
    const show = st === 'air' && ai.destX !== undefined;
    tc.visible = show;
    if (show) {
      const yaw = ai.yaw ?? 0;
      const dx = ai.destX - e.pos.x, dz = ai.destZ - e.pos.z;
      tc.position.set(dx * Math.cos(yaw) - dz * Math.sin(yaw), ai.destY - e.pos.y + 0.06, dx * Math.sin(yaw) + dz * Math.cos(yaw));
      tc.scale.setScalar(e.radius * 1.25);
      (tc.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.35 * Math.min(1, ai.airT / airTime());
    }
    vis.rotation.z = e.status === 'stunned' ? Math.sin(t * 12) * 0.06 : 0;
  },

  onRemove(_world, e) {
    const p = e.ai.model?.parts as JumperParts | undefined;
    if (p?.teleCircle) p.teleCircle.visible = false;
  },
};

/** 着地からの経過で槍の姿勢を決める：up=ぶら下がり(0)→水平(1)、ext=前への繰り出し、stab=突きの勢い */
export function lancePose(thrustT: number): { up: number; ext: number; stab: number } {
  const t0 = JUMPER.thrustAt - 0.04;   // 構え終わり
  const t1 = JUMPER.thrustAt + 0.06;   // 突き終わり
  if (thrustT < t0) {
    const s = smooth(thrustT / t0);
    return { up: 0.8 * s, ext: -0.35 * s, stab: 0 };
  }
  if (thrustT < t1) {
    const s = (thrustT - t0) / (t1 - t0);
    const f = 1 - (1 - s) * (1 - s);
    return { up: 0.8 + 0.2 * f, ext: -0.35 + 1.35 * f, stab: f };
  }
  if (thrustT < t1 + 0.5) return { up: 1, ext: 1, stab: 1 - smooth((thrustT - t1) / 0.5) * 0.5 };
  if (thrustT < t1 + 0.9) {
    const s = smooth((thrustT - t1 - 0.5) / 0.4);
    return { up: 1 - s, ext: 1 - s, stab: 0.5 * (1 - s) };
  }
  return { up: 0, ext: 0, stab: 0 };
}
