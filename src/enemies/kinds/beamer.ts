// ビーマー：遠距離で長く溜めて極太ビームを撃つ砲台型。
// 溜め中は照準線（サイトレーザー）がプレイヤーを追い、最後の lockTime で固定（赤く点滅）→ 発射。
// 弱点は前面のレンズ。溜め中だけシャッターが開いて露出し、強く撃つと溜めが中断してスタンする。
import * as THREE from 'three';
import { Builder, COLORS, boxGeo, sphereGeo, torusGeo, unitCylinder } from '../models';
import { moveGround } from '../common';
import type { Ctx } from '../common';
import { BEAMER, ENEMIES } from '../../config/balance';
import type { Enemy, World } from '../../core/types';
import { raycastLevel, segmentSphere } from '../../core/collision';
import { damagePlayer, PLAYER_HIT_RADIUS } from '../../core/combat';
import { spawnBurst, spawnFlash, spawnShockwave } from '../../core/effects';
import type { KindModule } from './kind';

/** 砲の回転軸（ローカル座標、体の中心基準） */
/** 上半身を脚の上へ持ち上げる量 */
const BODY_Y = 0.45;
const BEAMER_RADIUS = ENEMIES.beamer.radius;
const PIVOT = new THREE.Vector3(0, 0.85 + BODY_Y, 0.1);
/** 回転軸からレンズ（弱点）までの距離 */
const LENS_DIST = 3.2;
/** 回転軸から砲口までの距離（ビームの始点） */
const MUZZLE_DIST = 3.3;
/** 砲身の上下角の見た目上の上限（rad） */
const PITCH_MAX = 1.0;
const COIL_COUNT = 4;
const RING_COUNT = 3;

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** 砲身の上下角（照準ベクトルから。下向きが正） */
function pitchOf(aim: THREE.Vector3): number {
  return THREE.MathUtils.clamp(-Math.asin(THREE.MathUtils.clamp(aim.y, -1, 1)), -PITCH_MAX, PITCH_MAX);
}

/** 回転軸のワールド座標（yaw は ai.yaw） */
function pivotWorld(e: Enemy, out: THREE.Vector3): THREE.Vector3 {
  const yaw: number = e.ai.yaw ?? 0;
  return out.set(e.pos.x + PIVOT.z * Math.sin(yaw), e.pos.y + PIVOT.y, e.pos.z + PIVOT.z * Math.cos(yaw));
}

/** 砲口のワールド座標 */
function muzzleWorld(e: Enemy, out: THREE.Vector3): THREE.Vector3 {
  return pivotWorld(e, out).addScaledVector(e.ai.aim as THREE.Vector3, MUZZLE_DIST);
}

/** dir を target へ maxAngle だけ回す */
function turnToward(dir: THREE.Vector3, target: THREE.Vector3, maxAngle: number): void {
  const ang = dir.angleTo(target);
  if (ang < 1e-4) return;
  dir.lerp(target, Math.min(1, maxAngle / ang)).normalize();
}

/** 円柱メッシュ（半径1・長さ1）を a→b に置く。radius は半径 */
function placeBeam(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number): void {
  const dir = _b.subVectors(b, a);
  const len = dir.length();
  if (len < 1e-4) { m.visible = false; return; }
  dir.multiplyScalar(1 / len);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, dir);
  m.scale.set(radius, len, radius);
}

/** 弱点の位置・露出・見た目を今の状態に合わせる */
function syncLens(e: Enemy): void {
  const wp = e.weakPoints[0];
  if (!wp) return;
  const ai = e.ai;
  const aim: THREE.Vector3 | undefined = ai.aim;
  if (aim) {
    const pitch = pitchOf(aim);
    wp.offset.set(PIVOT.x, PIVOT.y - Math.sin(pitch) * LENS_DIST, PIVOT.z + Math.cos(pitch) * LENS_DIST);
  }
  if (e.status === 'down' || e.status === 'dead') return;
  // 溜め中（とスタン中）だけシャッターが開いてレンズが撃てる
  wp.exposed = ai.state === 'charge' || e.status === 'stunned';
  wp.mesh.visible = wp.exposed;
}

/** 照準線・ビームなどシーン直下のメッシュを用意する（ai.extra に入れて removeEnemy で片付く） */
function ensureMeshes(world: World, e: Enemy): void {
  const ai = e.ai;
  if (ai.aimLine) return;
  const mk = (color: number, opacity: number): THREE.Mesh => {
    const m = new THREE.Mesh(unitCylinder(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    m.visible = false;
    m.frustumCulled = false;
    world.scene.add(m);
    (ai.extra ??= []).push(m);
    return m;
  };
  ai.aimLine = mk(COLORS.glowBlue, 0.7);
  ai.beamMesh = mk(0x7fd0ff, 0.55);
  const core = new THREE.Mesh(unitCylinder(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }));
  core.scale.set(0.5, 1, 0.5);
  ai.beamMesh.add(core);
  // 照準線の先端（当たる場所）と、砲口・着弾のグロー
  const dot = new THREE.Mesh(sphereGeo(0.16), new THREE.MeshBasicMaterial({ color: COLORS.glowBlue, transparent: true, opacity: 0.9, depthWrite: false }));
  dot.visible = false;
  dot.frustumCulled = false;
  world.scene.add(dot);
  (ai.extra ??= []).push(dot);
  ai.aimDot = dot;
  const hit = new THREE.Mesh(sphereGeo(1), new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.8, depthWrite: false }));
  hit.visible = false;
  hit.frustumCulled = false;
  world.scene.add(hit);
  (ai.extra ??= []).push(hit);
  ai.beamHit = hit;
}

function hideLines(e: Enemy): void {
  const ai = e.ai;
  if (ai.aimLine) ai.aimLine.visible = false;
  if (ai.aimDot) ai.aimDot.visible = false;
  if (ai.beamMesh) ai.beamMesh.visible = false;
  if (ai.beamHit) ai.beamHit.visible = false;
}

/** 始点から dir 方向へ beamLength まで。壁（コライダー）で止まる */
function rayEnd(world: World, start: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const far = _a.copy(start).addScaledVector(dir, BEAMER.beamLength);
  const t = raycastLevel(world.colliders, start, far);
  return out.copy(start).lerp(far, t === null ? 1 : t);
}

/** 溜めを中断してスタンさせる（レンズへの強い一撃） */
function interrupt(world: World, e: Enemy): void {
  const ai = e.ai;
  const pos = muzzleWorld(e, new THREE.Vector3());
  ai.state = 'idle';
  ai.st = 0;
  ai.chargeK = 0;
  ai.locked = false;
  ai.cd = 1.2;
  ai.warn = 0;
  e.status = 'stunned';
  ai.stunT = BEAMER.interruptStun;
  hideLines(e);
  spawnBurst(world, pos, 0xffe24a, 16, 6, 0.5);
  spawnBurst(world, pos, COLORS.glowBlue, 10, 4, 0.4);
  spawnShockwave(world, pos, 0x9cc2ff, 2.2, 0.35);
  spawnFlash(world, pos, 0xbfe8ff, 6, 8, 0.2);
  world.events.emit('beamInterrupt', { pos: pos.clone() });
}

function startCharge(world: World, e: Enemy): void {
  const ai = e.ai;
  ensureMeshes(world, e);
  ai.state = 'charge';
  ai.st = 0;
  ai.locked = false;
  ai.chgSparkT = 0;
  world.events.emit('beamCharge', { pos: muzzleWorld(e, new THREE.Vector3()) });
}

function fire(c: Ctx): void {
  const { world, e } = c;
  const ai = e.ai;
  ai.state = 'fire';
  ai.st = 0;
  ai.hitDone = false;
  ai.recoil = 1;
  ai.chargeK = 1;
  ai.warn = 0;
  if (ai.aimLine) ai.aimLine.visible = false;
  if (ai.aimDot) ai.aimDot.visible = false;
  const muzzle = muzzleWorld(e, new THREE.Vector3());
  spawnFlash(world, muzzle, 0xbfe8ff, 10, 14, 0.25);
  spawnShockwave(world, muzzle, 0x7fd0ff, 2.4, 0.3);
  world.events.emit('beamFire', { pos: muzzle.clone() });
  world.events.emit('enemyAttack', { kind: e.kind, pos: muzzle.clone() });
}

/** 戦闘の1フレーム（スタン以外） */
function step(c: Ctx): void {
  const { world, e, dt, spec, pc, dirXZ, dist, dist2d, los } = c;
  const ai = e.ai;
  const B = BEAMER;
  ai.state ??= 'idle';
  ai.st ??= 0;
  ai.cd ??= 1.2;
  ai.walk ??= 0;
  ai.chargeK ??= 0;
  ai.recoil ??= 0;
  ai.recoil = Math.max(0, ai.recoil - dt * 3);
  if (!ai.aim) {
    const yaw: number = ai.yaw ?? 0;
    ai.aim = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  }
  const aim: THREE.Vector3 = ai.aim;
  const awake = ai.alert > 0;

  // ---- スタンの処理（敵共通：stunT を数えて戻る）
  if (e.status === 'stunned') {
    ai.stunT = (ai.stunT ?? 0) - dt;
    ai.state = 'idle';
    ai.chargeK = 0;
    ai.warn = 0;
    hideLines(e);
    moveGround(world, e, dt, 0, 0, 14);
    ai.walk = 0;
    if (ai.stunT <= 0) { e.status = 'active'; ai.cd = Math.max(ai.cd, 1.0); }
    return;
  }

  // ---- 照準のターゲット（砲の軸 → プレイヤーの体）
  const piv = pivotWorld(e, new THREE.Vector3());
  const toP = _b.copy(pc).sub(piv).normalize();
  const tracking = ai.state === 'idle' ? awake : ai.state === 'charge' && !ai.locked;
  if (tracking) {
    const rate = ai.state === 'charge' ? B.trackRate : 2.2;
    turnToward(aim, toP, rate * dt);
  }
  // 体の向き＝照準の水平方向
  if (Math.hypot(aim.x, aim.z) > 0.05) ai.yaw = Math.atan2(aim.x, aim.z);

  // ---- 移動：待機中だけ。距離を保ち、射線が通らなければゆっくり回り込む
  let wx = 0, wz = 0;
  if (awake && ai.state === 'idle' && !e.tethered) {
    const sp = spec.speed;
    if (dist2d < B.prefMin) { wx = -dirXZ.x * sp; wz = -dirXZ.z * sp; }
    else if (dist2d > B.prefMax) { wx = dirXZ.x * sp; wz = dirXZ.z * sp; }
    else if (!los) {
      ai.strafeT = (ai.strafeT ?? 0) - dt;
      if (ai.strafeT <= 0 || !ai.strafe) { ai.strafeT = 2.5; ai.strafe = Math.random() < 0.5 ? -1 : 1; }
      const s = sp * 0.7;
      wx = -dirXZ.z * ai.strafe * s + dirXZ.x * sp * 0.3;
      wz = dirXZ.x * ai.strafe * s + dirXZ.z * sp * 0.3;
    }
  }
  moveGround(world, e, dt, wx, wz, 8);
  ai.walk = Math.hypot(e.vel.x, e.vel.z);

  if (!awake && ai.state === 'idle') { ai.warn = 0; ai.chargeK = 0; return; }

  switch (ai.state) {
    case 'idle': {
      ai.warn = 0;
      ai.chargeK = 0;
      ai.cd -= dt;
      // 砲がだいたいプレイヤーの方を向いてから溜め始める
      if (ai.cd <= 0 && los && !e.tethered && dist <= spec.sightRange - 2 && aim.angleTo(toP) < 0.5) startCharge(world, e);
      break;
    }
    case 'charge': {
      if (!e.tethered) ai.st += dt;   // 吸収アームがつながっている間は溜まらない
      ai.chargeK = Math.min(1, ai.st / B.chargeTime);
      const lockAt = B.chargeTime - B.lockTime;
      if (!ai.locked && ai.st >= lockAt) {
        ai.locked = true;
        const m = muzzleWorld(e, new THREE.Vector3());
        spawnFlash(world, m, 0xff5a40, 5, 8, 0.15);
      }
      ai.warn = ai.locked ? 0.55 : 0;
      // 溜めの火花（レンズに集まる）
      ai.chgSparkT -= dt;
      if (ai.chgSparkT <= 0) {
        ai.chgSparkT = 0.22 - 0.14 * ai.chargeK;
        spawnBurst(world, muzzleWorld(e, new THREE.Vector3()).addScaledVector(aim, 0.4), COLORS.paleBlue, 2, 1.5, 0.3);
      }
      // 照準線：細い青 → ロック後は太い赤で点滅
      const start = muzzleWorld(e, new THREE.Vector3());
      const end = rayEnd(world, start, aim, new THREE.Vector3());
      const line: THREE.Mesh = ai.aimLine;
      const mat = line.material as THREE.MeshBasicMaterial;
      line.visible = true;
      if (ai.locked) {
        const blink = Math.sin(world.time * 60) > -0.2 ? 1 : 0.25;
        mat.color.setHex(0xff3a2a);
        mat.opacity = 0.95 * blink;
        placeBeam(line, start, end, 0.07);
      } else {
        mat.color.setHex(COLORS.glowBlue);
        mat.opacity = 0.55 + 0.25 * ai.chargeK;
        placeBeam(line, start, end, 0.035 + 0.02 * ai.chargeK);
      }
      const dot: THREE.Mesh = ai.aimDot;
      dot.visible = true;
      dot.position.copy(end);
      (dot.material as THREE.MeshBasicMaterial).color.setHex(ai.locked ? 0xff3a2a : COLORS.glowBlue);
      dot.scale.setScalar(ai.locked ? 1.6 : 1);
      if (ai.st >= B.chargeTime) fire(c);
      break;
    }
    case 'fire': {
      ai.st += dt;
      const start = muzzleWorld(e, new THREE.Vector3());
      const end = rayEnd(world, start, aim, new THREE.Vector3());
      const k = ai.st / B.fireTime;
      // 太さ：一瞬で最大になり、終わりに向けて細る
      const w = (B.beamWidth / 2) * (k < 0.15 ? 0.5 + k / 0.15 * 0.5 : 1 - 0.7 * ((k - 0.15) / 0.85) ** 2) * (0.95 + 0.05 * Math.sin(world.time * 90));
      const beam: THREE.Mesh = ai.beamMesh;
      beam.visible = true;
      placeBeam(beam, start, end, Math.max(0.02, w));
      (beam.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.35 * (1 - k);
      const glow: THREE.Mesh = ai.beamHit;
      glow.visible = true;
      glow.position.copy(end);
      glow.scale.setScalar(0.5 + 0.6 * (1 - k));
      if (Math.random() < 0.6) spawnBurst(world, end, 0xbfe8ff, 2, 4, 0.3);
      // 当たり判定：1発につき1回だけ（壁で止まったビームは届かない）
      if (!ai.hitDone && segmentSphere(start, end, pc, PLAYER_HIT_RADIUS + B.beamWidth / 2) !== null) {
        ai.hitDone = true;
        damagePlayer(world, spec.damage);
      }
      ai.warn = 0;
      if (ai.st >= B.fireTime) {
        ai.state = 'recover';
        ai.st = 0;
        ai.chargeK = 0;
        beam.visible = false;
        glow.visible = false;
      }
      break;
    }
    case 'recover': {
      ai.st += dt;
      ai.chargeK = 0;
      ai.warn = 0;
      if (ai.st >= B.recover) { ai.state = 'idle'; ai.st = 0; ai.cd = spec.attackInterval; }
      break;
    }
  }
}

export const beamer: KindModule = {
  knockback: 0.15,

  build() {
    const b = new Builder();
    const white = b.body(COLORS.white, 0.5, true), blue = b.body(COLORS.blue, 0.5, true), deep = b.body(COLORS.deepBlue, 0.6, true);
    const silver = b.body(COLORS.silver, 0.5, true), navy = b.body(COLORS.navy, 0.7, true), pale = b.body(COLORS.paleBlue, 0.5, true);
    const FOOT = -BEAMER_RADIUS + 0.07;
    // 上半身（胴体・砲座）は脚の上に持ち上げる
    const top = new THREE.Group();
    top.position.y = BODY_Y;
    b.vis.add(top);

    // 3 点で支える脚（前に 2 本・後ろに 1 本）。ピストン付き
    const strut = (a: THREE.Vector3, c: THREE.Vector3, w: number, m: THREE.Material): THREE.Mesh => {
      const d = new THREE.Vector3().subVectors(c, a);
      const len = d.length();
      const me = b.block(w, len, w, m, b.vis, 0, 0, 0, Math.min(0.05, w * 0.25));
      me.position.copy(a).add(c).multiplyScalar(0.5);
      me.quaternion.setFromUnitVectors(UP, d.normalize());
      return me;
    };
    const legs: [THREE.Vector3, THREE.Vector3][] = [
      [new THREE.Vector3(-0.5, BODY_Y - 0.1, 0.3), new THREE.Vector3(-1.5, FOOT, 1.1)],
      [new THREE.Vector3(0.5, BODY_Y - 0.1, 0.3), new THREE.Vector3(1.5, FOOT, 1.1)],
      [new THREE.Vector3(0, BODY_Y - 0.1, -0.45), new THREE.Vector3(0, FOOT, -1.85)],
    ];
    for (const [hip, foot] of legs) {
      strut(hip, foot, 0.3, white);
      // 脚の外側に付いたピストン
      const p0 = hip.clone().lerp(foot, 0.12).add(new THREE.Vector3(0, 0.22, 0));
      const p1 = hip.clone().lerp(foot, 0.72).add(new THREE.Vector3(0, 0.22, 0));
      strut(p0, p1, 0.1, silver);
      // 関節の円筒と足パッド
      b.prism(0.26, 0.4, 8, blue, b.vis, hip.x, hip.y, hip.z).rotation.z = Math.PI / 2;
      const knee = hip.clone().lerp(foot, 0.55);
      b.prism(0.2, 0.34, 6, navy, b.vis, knee.x, knee.y, knee.z).rotation.z = Math.PI / 2;
      b.prism(0.42, 0.14, 8, deep, b.vis, foot.x, FOOT, foot.z);
      b.prism(0.3, 0.06, 8, navy, b.vis, foot.x, FOOT - 0.06, foot.z);
    }

    // 胴体：面取りの大きな装甲ブロック + 側面アーマー + 光るライン
    b.block(1.7, 0.95, 1.6, white, top, 0, 0.02, 0, 0.18);
    b.block(1.4, 0.2, 1.3, silver, top, 0, -0.5, 0, 0.05);
    for (const sx of [-1, 1]) {
      b.block(0.14, 0.6, 1.2, blue, top, sx * 0.88, 0.05, 0, 0.04);
      b.lamp(0.04, 0.05, 1.0, top, sx * 0.96, 0.05, 0, 1.4);
      for (let i = 0; i < 3; i++) b.mesh(boxGeo(0.03, 0.26, 0.07), navy, top, sx * 0.92, -0.2, -0.4 + i * 0.4);
    }
    // 背面のラジエーター
    b.block(1.1, 0.7, 0.2, deep, top, 0, 0.1, -0.88, 0.04);
    for (let i = 0; i < 4; i++) b.mesh(boxGeo(0.9, 0.04, 0.05), silver, top, 0, -0.1 + i * 0.16, -1.0);
    // 旋回リングと砲座
    b.prism(0.78, 0.14, 8, navy, top, 0, 0.55, 0.0);
    b.block(1.3, 0.34, 1.2, white, top, 0, 0.7, 0.0, 0.08);
    for (const sx of [-1, 1]) b.block(0.18, 0.55, 0.9, blue, top, sx * 0.6, 1.0, 0.1, 0.05);

    // ---- 砲（ローカル +Z が砲口。回転軸まわりで上下する）
    const cannon = new THREE.Group();
    cannon.position.copy(PIVOT);
    b.vis.add(cannon);
    b.prism(0.2, 0.9, 8, silver, cannon, 0, 0, 0).rotation.z = Math.PI / 2;   // 砲耳（横軸）
    b.block(0.74, 0.7, 1.1, white, cannon, 0, 0, 0.05, 0.14);                   // 砲尾
    b.block(0.8, 0.56, 0.45, deep, cannon, 0, 0.02, -0.72, 0.08);               // カウンターウェイト
    b.block(0.5, 0.1, 0.4, silver, cannon, 0, 0.4, -0.1, 0.03);
    // 砲身：細長い八角の筒 + 青いコイルリング
    b.prism(0.28, 2.7, 8, silver, cannon, 0, 0, 1.75).rotation.x = Math.PI / 2;
    const coilMats: THREE.MeshStandardMaterial[] = [];
    for (let i = 0; i < COIL_COUNT; i++) {
      const m = b.glow(0.3);
      coilMats.push(m);
      const z = 0.85 + i * 0.5;
      const ring = b.prism(0.4, 0.16, 8, m, cannon, 0, 0, z);
      ring.rotation.x = Math.PI / 2;
      ring.castShadow = false;
      b.prism(0.36, 0.06, 8, navy, cannon, 0, 0, z + 0.11).rotation.x = Math.PI / 2;
    }
    b.parts.coilMats = coilMats;
    // 上のレール・スコープ
    b.block(0.14, 0.12, 2.1, deep, cannon, 0, 0.44, 1.5, 0.03);
    for (const sx of [-1, 1]) b.block(0.05, 0.3, 1.1, pale, cannon, sx * 0.3, 0.12, 0.6, 0.02).rotation.z = sx * 0.4;
    b.block(0.24, 0.24, 0.55, navy, cannon, 0.32, 0.46, 0.45, 0.05);
    b.mesh(boxGeo(0.18, 0.18, 0.04), b.eye(), cannon, 0.32, 0.46, 0.74);
    b.prism(0.02, 0.5, 4, navy, cannon, -0.3, 0.66, -0.1);
    b.lamp(0.06, 0.06, 0.06, cannon, -0.3, 0.93, -0.1, 1.8);
    // 砲口のレンズ室
    b.prism(0.54, 0.4, 8, deep, cannon, 0, 0, LENS_DIST - 0.25).rotation.x = Math.PI / 2;
    b.prism(0.46, 0.1, 8, silver, cannon, 0, 0, LENS_DIST - 0.5).rotation.x = Math.PI / 2;
    const lensMat = b.glow(0.5);
    const lens = b.prism(0.38, 0.06, 12, lensMat, cannon, 0, 0, LENS_DIST - 0.07);
    lens.rotation.x = Math.PI / 2;
    lens.castShadow = false;
    b.parts.lensMat = lensMat;
    // 弱点：レンズの中心（溜め中だけ露出する）
    const wp = b.weak(0, 0, 0, 0.5, [1, 1, 0.5], 0.2);
    cannon.add(wp.mesh);
    wp.mesh.position.set(0, 0, LENS_DIST - 0.02);
    wp.offset.set(PIVOT.x, PIVOT.y, PIVOT.z + LENS_DIST);
    wp.exposed = false;
    wp.mesh.visible = false;
    // レンズのシャッター（上下に開く。閉じていても細く光が漏れる）
    const shutters: THREE.Mesh[] = [];
    for (const s of [1, -1]) shutters.push(b.block(0.9, 0.34, 0.1, silver, cannon, 0, s * 0.19, LENS_DIST + 0.05, 0.03));
    b.parts.shutters = shutters;
    // 溜めのエネルギー球と、集まってくるリング
    const orb = new THREE.Mesh(sphereGeo(1), new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.85, depthWrite: false }));
    orb.position.set(0, 0, LENS_DIST + 0.35);
    orb.visible = false;
    cannon.add(orb);
    b.parts.orb = orb;
    const rings: THREE.Mesh[] = [];
    for (let i = 0; i < RING_COUNT; i++) {
      const r = new THREE.Mesh(torusGeo(1, 0.04), new THREE.MeshBasicMaterial({ color: 0x9cc2ff, transparent: true, opacity: 0, depthWrite: false }));
      r.position.set(0, 0, LENS_DIST + 0.3);
      r.visible = false;
      cannon.add(r);
      rings.push(r);
    }
    b.parts.rings = rings;
    b.parts.cannon = cannon;
    // 砲口まわりの整流板
    for (const sx of [-1, 1]) b.block(0.08, 0.46, 0.5, pale, cannon, sx * 0.6, 0, LENS_DIST - 0.4, 0.02);
    return b.done();
  },

  update(c) {
    step(c);
    syncLens(c.e);
  },

  animate(world, e, dt, down) {
    const ai = e.ai;
    const p = ai.model.parts;
    const t: number = ai.t ?? 0;
    const state: string = ai.state ?? 'idle';
    const k: number = down ? 0 : ai.chargeK ?? 0;
    const firing = !down && state === 'fire';
    const stunned = !down && e.status === 'stunned';
    const vis = ai.model.vis as THREE.Group;
    const cannon = p.cannon as THREE.Group;
    if (!ai.aim) {
      const yaw: number = ai.yaw ?? 0;
      ai.aim = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    }
    // 砲身の向き
    const pitch = pitchOf(ai.aim);
    cannon.rotation.x = down ? THREE.MathUtils.lerp(pitch, 0.55, ai.collapse) : pitch;
    ai.recoil ??= 0;
    cannon.position.z = PIVOT.z - 0.4 * ai.recoil;

    // レンズの光：溜まるほど白く強く
    const lensMat: THREE.MeshStandardMaterial = p.lensMat;
    if (down) {
      lensMat.emissiveIntensity = 0;
      lensMat.color.setHex(0x333840);
    } else {
      const flick = stunned ? 0.3 + Math.random() * 0.7 : 1;
      lensMat.color.setHex(0x9fd8ff);
      lensMat.emissive.setHex(k > 0.8 || firing ? 0xdff4ff : COLORS.glowBlue);
      lensMat.emissiveIntensity = (firing ? 6 : 0.5 + 4.5 * k * k) * flick;
    }
    // コイルが手前から順に点灯
    const coils: THREE.MeshStandardMaterial[] = p.coilMats;
    for (let i = 0; i < coils.length; i++) {
      const f = THREE.MathUtils.clamp(k * (coils.length + 0.5) - i, 0, 1);
      coils[i].emissiveIntensity = down ? 0 : firing ? 3 : 0.3 + 2.4 * f * (0.85 + 0.15 * Math.sin(t * 30 + i));
    }
    // シャッター
    const wantOpen = !down && (state === 'charge' || state === 'fire' || stunned) ? 1 : 0;
    ai.open = THREE.MathUtils.lerp(ai.open ?? 0, wantOpen, Math.min(1, dt * (wantOpen ? 12 : 6)));
    const shutters: THREE.Mesh[] = p.shutters;
    shutters[0].position.y = 0.19 + 0.45 * ai.open;
    shutters[1].position.y = -0.19 - 0.45 * ai.open;
    // エネルギー球・リング
    const orb = p.orb as THREE.Mesh;
    const charging = !down && (state === 'charge' || firing);
    orb.visible = charging && k > 0.03;
    if (orb.visible) {
      const s = firing ? 0.75 * (1 - 0.5 * (ai.st / BEAMER.fireTime)) : 0.06 + 0.5 * k * k + 0.03 * Math.sin(t * 40);
      orb.scale.setScalar(Math.max(0.01, s));
    }
    const rings: THREE.Mesh[] = p.rings;
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      r.visible = !down && state === 'charge';
      if (!r.visible) continue;
      const ph = (t * (1.4 + 2 * k) + i / rings.length) % 1;
      r.scale.setScalar(2.4 * (1 - ph) + 0.35);
      (r.material as THREE.MeshBasicMaterial).opacity = Math.sin(ph * Math.PI) * (0.25 + 0.7 * k);
    }

    if (!down) {
      // 歩行の揺れ（重いので小さく）
      ai.phaseW = (ai.phaseW ?? 0) + dt * (1.6 + (ai.walk ?? 0) * 1.5);
      vis.position.y += Math.abs(Math.sin(ai.phaseW)) * 0.04 * Math.min(1, (ai.walk ?? 0) / 1.5);
      // 溜めで踏ん張って沈み、ロック中は震える。発射の反動で少しのけぞる
      vis.position.y -= 0.1 * k;
      if (ai.locked && state === 'charge') vis.position.x += Math.sin(t * 70) * 0.012;
      vis.rotation.x = THREE.MathUtils.lerp(vis.rotation.x, -0.06 * ai.recoil, Math.min(1, dt * 14));
    } else {
      vis.rotation.x = 0.25 * ai.collapse;
      vis.rotation.z = (ai.tilt ?? 1) * 0.25 * ai.collapse;
      vis.position.y = -0.3 * ai.collapse;
    }
    void world;
  },

  onHit(world, e, damage, opts) {
    // 溜め中にレンズへ強い一撃が入ると溜めが中断してスタン
    if (opts.weak && e.ai.state === 'charge' && damage >= BEAMER.interruptDamage) interrupt(world, e);
  },

  onGone(_world, e) {
    // 倒れた・吸い切られたら照準線とビームを消す
    hideLines(e);
    e.ai.chargeK = 0;
    e.ai.state = 'down';
  },
};
