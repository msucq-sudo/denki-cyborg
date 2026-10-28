// リーチ（吸収マン）：とても小さな電力泥棒。遠くから紫のバネ腕を伸ばしてプレイヤーの電力を吸い、
// 背中のタンクにためる。こちらの吸収アームをつなぐと、ためた電力ごとジグザグに逃げ出す。
// 吸い切ればタンクの電力は全部戻ってくる（撃破だと散って失われる）。
import * as THREE from 'three';
import { Builder, COLORS, boxGeo, cachedGeo, cylGeo, icoGeo, polyCyl, sphereGeo, taperGeo, torusGeo } from '../models';
import { faceToward, moveFlyer } from '../common';
import type { Ctx } from '../common';
import { LEECH } from '../../config/balance';
import type { Enemy, World } from '../../core/types';
import { hasLineOfSight, raycastLevel, segmentSphere } from '../../core/collision';
import { PLAYER_HIT_RADIUS } from '../../core/combat';
import { addEnergy, drainEnergy } from '../../core/energy';
import { spawnBurst, spawnFlash, spawnShockwave } from '../../core/effects';
import type { KindModule } from './kind';

/** リーチの色：アームは紫（プレイヤーの水色アームと見分ける）、ためた電力は水色 */
const MAGENTA = 0xd13bd0;
const MAGENTA_LIGHT = 0xff7af0;
const STOLEN_CYAN = 0x5fe8ff;

/** 吸い口（ローカル座標）。アームの根元 */
const MOUTH_Y = -0.1;
const MOUTH_Z = 0.46;

// 毎フレーム使い回す作業用ベクトル（状態は持たない）
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _mouth = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** 吸い口のワールド座標（体の向きと照準の上下に追従） */
export function leechMouth(e: Enemy, out: THREE.Vector3): THREE.Vector3 {
  const yaw: number = e.ai.yaw ?? 0, th: number = e.ai.pitch ?? 0;
  const ly = MOUTH_Y * Math.cos(th) - MOUTH_Z * Math.sin(th);
  const lz = MOUTH_Y * Math.sin(th) + MOUTH_Z * Math.cos(th);
  return out.set(e.pos.x + Math.sin(yaw) * lz, e.pos.y + ly, e.pos.z + Math.cos(yaw) * lz);
}

// ------------------------------------------------------------------ 腕の状態

/** 他のリーチがまだプレイヤーにつながっているか（player.leeched の判定用） */
function othersAttached(world: World, self: Enemy): boolean {
  for (const o of world.enemies) {
    if (o === self || o.kind !== 'leech') continue;
    if ((o.status === 'active' || o.status === 'stunned') && o.ai.armPhase === 'attached') return true;
  }
  return false;
}

function setLeeched(world: World, e: Enemy, on: boolean): void {
  world.player.leeched = on || othersAttached(world, e);
}

/** アームを外して巻き戻す。つながっていたら外れた合図を出す */
function breakArm(world: World, e: Enemy): void {
  const ai = e.ai;
  if (ai.armPhase === 'attached') {
    world.events.emit('leechBreak', {});
    spawnBurst(world, ai.armTip, MAGENTA_LIGHT, 8, 3.5, 0.3);
    setLeeched(world, e, false);
  }
  if (ai.armPhase === 'extending' || ai.armPhase === 'attached') {
    ai.armPhase = 'retracting';
    ai.atkCd = armCooldown(e);
  }
}

function armCooldown(e: Enemy): number {
  return e.ai.cooldownBase * (0.85 + Math.random() * 0.3);
}

/** アームを即座に消す（死亡・撤去時） */
function hideArm(world: World, e: Enemy): void {
  const ai = e.ai;
  const was = ai.armPhase === 'attached';
  ai.armPhase = 'none';
  if (ai.arm) ai.arm.group.visible = false;
  if (was) world.events.emit('leechBreak', {});
  world.player.leeched = othersAttached(world, e);
}

function fireArm(c: Ctx, mouth: THREE.Vector3): void {
  const { world, e, pc } = c;
  const ai = e.ai;
  ai.armDir.copy(pc).sub(mouth).normalize();
  ai.armTip.copy(mouth);
  ai.armLen = 0;
  ai.armPhase = 'extending';
  ai.attachT = 0;
  ai.losLost = 0;
  ensureArm(world, e);
  world.events.emit('leechFire', { pos: mouth.clone() });
  spawnFlash(world, mouth, MAGENTA_LIGHT, 3, 3, 0.15);
  spawnBurst(world, mouth, MAGENTA_LIGHT, 6, 3, 0.25);
}

/** 腕の毎フレーム処理（伸びる／つながる／巻き戻る） */
function updateArm(c: Ctx, mouth: THREE.Vector3): void {
  const { world, e, dt, pc } = c;
  const ai = e.ai;
  const p = world.player;
  switch (ai.armPhase) {
    case 'extending': {
      const move = Math.min(LEECH.armSpeed * dt, LEECH.armRange - ai.armLen);
      const p0 = _a.copy(ai.armTip);
      const p1 = _b.copy(ai.armTip).addScaledVector(ai.armDir, move);
      const lt = raycastLevel(world.colliders, p0, p1);
      const th = segmentSphere(p0, p1, pc, PLAYER_HIT_RADIUS + LEECH.tipRadius);
      if (th !== null && (lt === null || th <= lt) && p.dodgeTimer <= 0) {
        // プレイヤーに届いた：つながる
        ai.armTip.copy(pc);
        ai.armPhase = 'attached';
        ai.attachT = 0;
        ai.losLost = 0;
        ai.sparkT = 0;
        setLeeched(world, e, true);
        world.events.emit('leechAttach', { pos: pc.clone() });
        spawnBurst(world, pc, MAGENTA_LIGHT, 12, 4, 0.35);
        spawnFlash(world, pc, MAGENTA_LIGHT, 4, 4, 0.2);
      } else if (lt !== null) {
        // 壁に当たった
        ai.armTip.lerpVectors(p0, p1, lt);
        spawnBurst(world, ai.armTip, MAGENTA_LIGHT, 5, 3, 0.25);
        ai.armPhase = 'retracting';
        ai.atkCd = armCooldown(e);
      } else {
        ai.armTip.copy(p1);
        ai.armLen += move;
        if (ai.armLen >= LEECH.armRange - 1e-4) { ai.armPhase = 'retracting'; ai.atkCd = armCooldown(e); }
      }
      break;
    }
    case 'attached': {
      ai.armTip.copy(pc);
      ai.attachT += dt;
      const len = mouth.distanceTo(pc);
      // 外れる条件：回避／距離／長すぎ／見通し切れ／盗むものが無い／満タン
      let why = '';
      if (p.dodgeTimer > 0) why = 'dodge';
      else if (len > LEECH.breakDistance) why = 'far';
      else if (ai.attachT > LEECH.maxAttach) why = 'time';
      else if (p.energy <= 0) why = 'empty';
      else if (ai.stolen >= LEECH.stolenCap - 1e-6) why = 'full';
      else {
        if (hasLineOfSight(world.colliders, mouth, pc)) ai.losLost = 0;
        else {
          ai.losLost += dt;
          if (ai.losLost > LEECH.losGrace) why = 'los';
        }
      }
      if (why) { breakArm(world, e); break; }
      // 盗む：プレイヤーの電力 → ai.stolen（「使った」電力には数えない）
      const want = Math.min(LEECH.drainPerSec * dt, LEECH.stolenCap - ai.stolen);
      const got = drainEnergy(world, want) * want;
      world.stats.energyUsed = Math.max(0, world.stats.energyUsed - got);
      ai.stolen += got;
      ai.sparkT -= dt;
      if (ai.sparkT <= 0) {
        ai.sparkT = 0.12;
        spawnBurst(world, pc, STOLEN_CYAN, 2, 2.5, 0.25);
      }
      break;
    }
    case 'retracting': {
      const toMouth = _a.subVectors(mouth, ai.armTip);
      const d = toMouth.length();
      const step = LEECH.armSpeed * LEECH.retractMul * dt;
      if (d <= 0.3 + step) { ai.armTip.copy(mouth); ai.armLen = 0; ai.armPhase = 'none'; }
      else { ai.armTip.addScaledVector(toMouth, step / d); ai.armLen = d - step; }
      break;
    }
    default: break;
  }
}

// ------------------------------------------------------------------ 移動

function hoverFloorY(c: Ctx): number {
  const { world, e, dt } = c;
  const ai = e.ai;
  ai.floorT = (ai.floorT ?? 0) - dt;
  if (ai.floorT <= 0) {
    ai.floorT = 0.12;
    const t = raycastLevel(world.colliders, e.pos, _a.set(e.pos.x, e.pos.y - 8, e.pos.z));
    if (t !== null) ai.floorY = e.pos.y - 8 * t;
  }
  return ai.floorY ?? e.pos.y - LEECH.hoverHeight;
}

/** 床からの浮遊高さへ向かう上下速度 */
function hoverVy(c: Ctx, maxV: number, bob = 0.1): number {
  const { world, e } = c;
  const want = hoverFloorY(c) + LEECH.hoverHeight + Math.sin(world.time * 2.3 + e.id) * bob;
  return THREE.MathUtils.clamp((want - e.pos.y) * 3, -maxV, maxV);
}

/** つながれて逃げる：プレイヤーの反対側へ、壁を避けながらジグザグに */
function flee(c: Ctx): void {
  const { world, e, dt, spec, dirXZ } = c;
  const ai = e.ai;
  ai.fleeRamp = Math.min(1, (ai.fleeRamp ?? 0.4) + dt / LEECH.fleeRamp);
  // 0.2 秒ごとに逃げる向きを見直す（壁が近い向きは避ける）
  ai.fleeT = (ai.fleeT ?? 0) - dt;
  if (ai.fleeT <= 0 || !ai.fleeDir) {
    ai.fleeT = 0.2;
    ai.fleeDir ??= new THREE.Vector3(-dirXZ.x, 0, -dirXZ.z);
    let best = -Infinity;
    const base = Math.atan2(-dirXZ.x, -dirXZ.z);
    for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) {
      const a = base + off;
      const dx = Math.sin(a), dz = Math.cos(a);
      const t = raycastLevel(world.colliders, e.pos, _a.set(e.pos.x + dx * 4, e.pos.y, e.pos.z + dz * 4));
      const clear = t === null ? 1 : t;
      const score = clear * 1.4 + Math.cos(off) * 0.9 + (off === 0 ? 0.1 : 0);
      if (score > best) { best = score; ai.fleeDir.set(dx, 0, dz); }
    }
  }
  const fd: THREE.Vector3 = ai.fleeDir;
  const zig = Math.sin((ai.t ?? 0) * 6.5 + e.id) * 0.55;
  const wish = _b.set(fd.x - fd.z * zig, 0, fd.z + fd.x * zig).normalize().multiplyScalar(LEECH.fleeSpeed * ai.fleeRamp);
  wish.y = hoverVy(c, spec.speed, 0.25);
  moveFlyer(world, e, dt, wish, 20);
  // 怯えて振り返る
  faceToward(e, dirXZ.x, dirXZ.z, dt, 5);
}

/** ふつうの行動：好みの距離で見通しを保ち、すばやく位置を変えながら吸う機会をうかがう */
function skirmish(c: Ctx, mouth: THREE.Vector3): void {
  const { world, e, dt, spec, pc, dirXZ, dist, dist2d, los } = c;
  const ai = e.ai;
  const p = world.player;
  const full = ai.stolen >= LEECH.stolenCap - 1e-6;
  const prefMin = LEECH.prefMin + (full ? 5 : 0), prefMax = LEECH.prefMax + (full ? 5 : 0);
  const speed = spec.speed;
  const rx = dirXZ.x, rz = dirXZ.z;
  ai.orbitDir ??= Math.random() < 0.5 ? 1 : -1;
  const tx = -rz * ai.orbitDir, tz = rx * ai.orbitDir;

  // 距離
  let radial: number;
  if (!los) radial = 1;
  else if (dist2d < prefMin) radial = -1;
  else if (dist2d > prefMax) radial = 1;
  else radial = THREE.MathUtils.clamp(((prefMin + prefMax) / 2 - dist2d) * -0.25, -0.4, 0.4);

  // ときどき素早く横っ飛び
  ai.dartT = (ai.dartT ?? 0.5) - dt;
  if (ai.dartT <= 0) {
    ai.dartT = 0.9 + Math.random() * 1.3;
    ai.dartLeft = 0.28;
    const side = Math.random() < 0.5 ? 1 : -1;
    const k = (Math.random() - 0.5) * 0.8;
    ai.dartV ??= new THREE.Vector3();
    ai.dartV.set((-rz * side + rx * k), 0, (rx * side + rz * k)).normalize().multiplyScalar(speed * 1.7);
  }
  const wish = _c.set(0, 0, 0);
  if (ai.dartLeft > 0) {
    ai.dartLeft -= dt;
    wish.copy(ai.dartV);
  } else {
    wish.set((rx * radial * 0.8 + tx * 0.3) * speed, 0, (rz * radial * 0.8 + tz * 0.3) * speed);
  }
  // 予備動作中・つないでいる間はあまり動かない
  if (ai.windup > 0) wish.multiplyScalar(0.15);
  else if (ai.armPhase === 'attached') wish.multiplyScalar(0.55);
  // つないでいる間は、離されないようにプレイヤーを追う
  if (ai.armPhase === 'attached' && dist2d > prefMax) { wish.x += rx * speed * 0.7; wish.z += rz * speed * 0.7; }
  wish.y = hoverVy(c, speed, 0.12);
  const hit = moveFlyer(world, e, dt, wish, 14);
  if (hit) ai.orbitDir *= -1;
  faceToward(e, rx, rz, dt, 10);

  // ---- 攻撃：予備動作 → アーム発射
  const busy = ai.armPhase !== 'none';
  if (busy) { ai.warn = 0; return; }
  ai.atkCd -= dt;
  if (ai.windup > 0) {
    ai.windup -= dt;
    ai.warn = THREE.MathUtils.clamp(1 - ai.windup / LEECH.windup, 0, 1);
    if (ai.windup <= 0) {
      ai.warn = 0;
      if (los && p.energy > 0) fireArm(c, mouth);
      else ai.atkCd = 0.8;
    }
  } else if (ai.atkCd <= 0 && los && !full && p.energy > 0 && dist < LEECH.armRange - 1) {
    ai.windup = LEECH.windup;
  }
}

// ------------------------------------------------------------------ 見た目：腕

interface ArmVisual {
  group: THREE.Group;
  coils: THREE.InstancedMesh;
  flow: THREE.InstancedMesh;
  core: THREE.Mesh;
  bolts: THREE.Line[];
  plug: THREE.Group;
  claws: THREE.Group[];
  coilMat: THREE.MeshStandardMaterial;
}

const MAX_COILS = 64;
const COIL_SPACING = 0.16;
const FLOW_COUNT = 12;
const BOLT_POINTS = 22;

/** 紫のバネ腕（ワールド座標）。e.ai.extra に入れて removeEnemy に片付けてもらう */
function ensureArm(world: World, e: Enemy): ArmVisual {
  if (e.ai.arm) return e.ai.arm;
  const group = new THREE.Group();
  group.name = 'leechArm';
  group.visible = false;
  // バネの輪（腕に沿って並べる）
  const coilMat = new THREE.MeshStandardMaterial({ color: 0xf3d6ff, emissive: MAGENTA, emissiveIntensity: 1.1, roughness: 0.4 });
  const coils = new THREE.InstancedMesh(torusGeo(0.1, 0.028), coilMat, MAX_COILS);
  coils.frustumCulled = false;
  coils.count = 0;
  group.add(coils);
  // 芯（細い光る線）
  const core = new THREE.Mesh(
    cachedGeo('leechCore', () => new THREE.CylinderGeometry(1, 1, 1, 6, 1, true)),
    new THREE.MeshBasicMaterial({ color: MAGENTA_LIGHT, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  core.frustumCulled = false;
  group.add(core);
  // 稲妻
  const bolts: THREE.Line[] = [];
  for (const [color, op] of [[0xffd6ff, 0.9], [MAGENTA, 0.6]] as [number, number][]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_POINTS * 3), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false }));
    l.frustumCulled = false;
    group.add(l);
    bolts.push(l);
  }
  // 盗んだ電力の粒（プレイヤー → リーチへ流れる水色の粒）
  const flow = new THREE.InstancedMesh(
    sphereGeo(0.06), new THREE.MeshBasicMaterial({ color: STOLEN_CYAN, transparent: true, opacity: 0.95, depthWrite: false }), FLOW_COUNT,
  );
  flow.frustumCulled = false;
  flow.count = 0;
  group.add(flow);
  // 先端のプラグ（光る球＋爪3本）
  const plug = new THREE.Group();
  plug.add(new THREE.Mesh(
    sphereGeo(0.1), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: MAGENTA, emissiveIntensity: 1.6, roughness: 0.3 }),
  ));
  const clawGeo = cachedGeo('leechClaw', () => {
    const g = new THREE.ConeGeometry(0.04, 0.24, 5);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, 0.16);
    return g;
  });
  const clawMat = new THREE.MeshStandardMaterial({ color: 0xf3d6ff, emissive: MAGENTA, emissiveIntensity: 0.8, roughness: 0.4 });
  const claws: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.z = (i / 3) * Math.PI * 2;
    const m = new THREE.Mesh(clawGeo, clawMat);
    m.position.x = 0.07;
    pivot.add(m);
    plug.add(pivot);
    claws.push(pivot);
  }
  group.add(plug);
  world.scene.add(group);
  const arm: ArmVisual = { group, coils, flow, core, bolts, plug, claws, coilMat };
  e.ai.arm = arm;
  (e.ai.extra ??= []).push(group);
  return arm;
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _side1 = new THREE.Vector3();
const _side2 = new THREE.Vector3();

function fillBolt(line: THREE.Line, a: THREE.Vector3, b: THREE.Vector3, amp: number, time: number, seed: number): void {
  const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < BOLT_POINTS; i++) {
    const k = i / (BOLT_POINTS - 1);
    const env = Math.sin(k * Math.PI);
    const n1 = Math.sin(time * 36 + i * 12.9898 + seed) * 43758.5453;
    const n2 = Math.sin(time * 39 + i * 78.233 + seed * 2) * 24634.6345;
    const j1 = (n1 - Math.floor(n1)) * 2 - 1, j2 = (n2 - Math.floor(n2)) * 2 - 1;
    attr.setXYZ(i,
      a.x + (b.x - a.x) * k + (_side1.x * j1 + _side2.x * j2) * amp * env,
      a.y + (b.y - a.y) * k + (_side1.y * j1 + _side2.y * j2) * amp * env,
      a.z + (b.z - a.z) * k + (_side1.z * j1 + _side2.z * j2) * amp * env);
  }
  attr.needsUpdate = true;
}

/** 腕の見た目を更新（毎フレーム）。mode: extending/attached/retracting */
function drawArm(arm: ArmVisual, root: THREE.Vector3, tip: THREE.Vector3, mode: string, time: number): void {
  const group = arm.group;
  group.visible = true;
  _dir.subVectors(tip, root);
  const len = _dir.length();
  if (len > 1e-5) _dir.multiplyScalar(1 / len); else _dir.set(0, 0, 1);
  _side1.crossVectors(_dir, UP);
  if (_side1.lengthSq() < 1e-4) _side1.set(1, 0, 0);
  _side1.normalize();
  _side2.crossVectors(_dir, _side1).normalize();
  const attached = mode === 'attached';

  // バネの輪：腕に沿って並べる。つながっている間は脈打つ
  const n = Math.min(MAX_COILS, Math.max(2, Math.ceil(len / COIL_SPACING)));
  _q.setFromUnitVectors(Z_AXIS, _dir);
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const wob = mode === 'extending' ? 0.05 * Math.sin(time * 22 + i * 0.9) * Math.sin(k * Math.PI) : 0;
    _pos.copy(root).addScaledVector(_dir, len * k).addScaledVector(_side1, wob);
    const pulse = 1 + (attached ? 0.22 : 0.08) * Math.sin(time * 10 - i * 0.8);
    const s = (i % 2 === 0 ? 1 : 0.82) * pulse;
    _s.set(s, s, 1);
    _m4.compose(_pos, _q, _s);
    arm.coils.setMatrixAt(i, _m4);
  }
  arm.coils.count = n;
  arm.coils.instanceMatrix.needsUpdate = true;
  arm.coilMat.emissiveIntensity = attached ? 1.5 + 0.5 * Math.sin(time * 18) : 1.1;

  // 芯
  _pos.copy(root).addScaledVector(_dir, len * 0.5);
  _q.setFromUnitVectors(Y_AXIS, _dir);
  const r = attached ? 0.045 : 0.03;
  _s.set(r, len, r);
  _m4.compose(_pos, _q, _s);
  arm.core.matrix.copy(_m4);
  arm.core.matrixAutoUpdate = false;
  arm.core.matrixWorldNeedsUpdate = true;
  arm.core.visible = true;

  // 稲妻
  const amp = attached ? 0.09 : 0.05;
  fillBolt(arm.bolts[0], root, tip, amp, time, 1);
  fillBolt(arm.bolts[1], root, tip, amp * 1.6, time + 0.013, 7);

  // 流れる電力の粒（つながっている間だけ。プレイヤー → リーチ）
  if (attached) {
    arm.flow.visible = true;
    arm.flow.count = FLOW_COUNT;
    for (let i = 0; i < FLOW_COUNT; i++) {
      const k = 1 - ((time * 1.6 + i / FLOW_COUNT) % 1); // 1(プレイヤー側) → 0(リーチ側)
      _pos.copy(root).addScaledVector(_dir, len * k);
      const sc = 0.7 + 0.5 * Math.sin(k * Math.PI);
      _s.setScalar(sc);
      _m4.compose(_pos, IDENT_Q, _s);
      arm.flow.setMatrixAt(i, _m4);
    }
    arm.flow.instanceMatrix.needsUpdate = true;
  } else arm.flow.visible = false;

  // 先端プラグ
  arm.plug.position.copy(tip);
  arm.plug.quaternion.setFromUnitVectors(Z_AXIS, _dir);
  const claw = attached ? 0.45 : 1; // つながると爪が閉じる
  for (const c of arm.claws) c.scale.setScalar(claw);
}
const IDENT_Q = new THREE.Quaternion();

// ------------------------------------------------------------------ モジュール

export const leech: KindModule = {
  knockback: 0.5,
  flying: true,

  build() {
    const b = new Builder();
    const white = b.body(COLORS.white, 0.5, true), silver = b.body(COLORS.silver, 0.5, true);
    const blue = b.body(COLORS.blue, 0.5, true), navy = b.body(COLORS.navy, 0.7, true), deep = b.body(COLORS.deepBlue, 0.6, true);
    const magenta = new THREE.MeshStandardMaterial({ color: 0xf3d6ff, emissive: MAGENTA, emissiveIntensity: 1.0, roughness: 0.4 });
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0xffe6ff, emissive: MAGENTA, emissiveIntensity: 1.0, roughness: 0.3 });

    // 胴体：まるい面取りボディ + 青い光のベルト
    const body = b.mesh(icoGeo(0.27, 1), white);
    body.scale.set(1, 0.92, 1.05);
    const belt = b.mesh(torusGeo(0.27, 0.022), b.glow(1.5));
    belt.rotation.x = Math.PI / 2;
    belt.position.y = -0.02;
    belt.castShadow = false;
    // 下のホバー部：テーパーと光る噴射口
    b.mesh(taperGeo(0.17, 0.09, 0.1, 6), silver, b.vis, 0, -0.25, 0);
    const jetMat = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: COLORS.glowBlue, emissiveIntensity: 1.6, roughness: 0.4, transparent: true, opacity: 0.9 });
    b.mesh(polyCyl(0.075, 0.03, 6), jetMat, b.vis, 0, -0.32, 0).castShadow = false;
    b.parts.jetMat = jetMat;
    // 顔：バイザーと大きな丸い目
    b.block(0.34, 0.15, 0.1, navy, b.vis, 0, 0.09, 0.22, 0.03);
    for (const sx of [-1, 1]) b.mesh(sphereGeo(0.058), b.eye(), b.vis, sx * 0.085, 0.09, 0.275);
    // 耳（横の小さなフィン）
    for (const sx of [-1, 1]) {
      const fin = b.block(0.05, 0.15, 0.2, blue, b.vis, sx * 0.275, 0.06, -0.02, 0.015);
      fin.rotation.z = sx * 0.35;
    }
    // アンテナ（先が紫に光る）
    b.prism(0.012, 0.2, 4, navy, b.vis, 0.08, 0.34, -0.1);
    b.mesh(sphereGeo(0.032), magenta, b.vis, 0.08, 0.46, -0.1).castShadow = false;

    // 吸い口：ラッパ型のノズル + 紫のリング + 巻いたバネ（アームの根元）
    const nozzle = new THREE.Group();
    nozzle.position.set(0, MOUTH_Y, 0.3);
    b.vis.add(nozzle);
    const funnel = b.mesh(taperGeo(0.15, 0.075, 0.2, 8), silver, nozzle, 0, 0, 0.06);
    funnel.rotation.x = Math.PI / 2;
    const rim = b.mesh(polyCyl(0.155, 0.035, 8), mouthMat, nozzle, 0, 0, 0.165);
    rim.rotation.x = Math.PI / 2;
    rim.castShadow = false;
    const hole = b.mesh(polyCyl(0.1, 0.04, 8), navy, nozzle, 0, 0, 0.17);
    hole.rotation.x = Math.PI / 2;
    const coil = new THREE.Group();
    nozzle.add(coil);
    for (let i = 0; i < 4; i++) {
      const ring = b.mesh(torusGeo(0.1 + i * 0.012, 0.018), magenta, coil, 0, 0, -0.03 + i * 0.045);
      ring.castShadow = false;
    }
    b.parts.coil = coil;
    b.parts.mouthMat = mouthMat;
    b.parts.coilMat = magenta;
    b.parts.nozzle = nozzle;

    // 背中のタンク（弱点）：ガラスの筒 + 中身の水色の電力 + 上下のキャップとパイプ
    const tank = new THREE.Group();
    tank.position.set(0, 0.08, -0.31);
    b.vis.add(tank);
    const glass = new THREE.MeshStandardMaterial({ color: 0xdff4ff, roughness: 0.15, transparent: true, opacity: 0.32, depthWrite: false });
    const tankH = 0.36;
    b.mesh(cylGeo(0.105, tankH), glass, tank).castShadow = false;
    for (const sy of [-1, 1]) b.mesh(polyCyl(0.12, 0.05, 8), navy, tank, 0, sy * (tankH / 2 + 0.01), 0);
    for (const sx of [-1, 1]) b.mesh(boxGeo(0.02, tankH, 0.02), deep, tank, sx * 0.11, 0, 0);
    // 中身：下から満ちる
    const liquidMat = new THREE.MeshStandardMaterial({ color: 0xcffaff, emissive: STOLEN_CYAN, emissiveIntensity: 1.4, roughness: 0.3 });
    const fill = new THREE.Group();
    fill.position.y = -tankH / 2 + 0.01;
    tank.add(fill);
    const liquid = b.mesh(cylGeo(0.085, tankH - 0.02), liquidMat, fill, 0, (tankH - 0.02) / 2, 0);
    liquid.castShadow = false;
    fill.scale.y = 0.55; // 実行時は animate が ai.stolen に合わせて上書きする（単体表示用に半分ほど満たしておく）
    b.parts.fill = fill;
    b.parts.liquidMat = liquidMat;
    // 胴体とつなぐパイプ
    b.mesh(boxGeo(0.07, 0.05, 0.12), navy, b.vis, 0, 0.12, -0.22);
    b.mesh(boxGeo(0.07, 0.05, 0.12), navy, b.vis, 0, -0.04, -0.22);
    // 弱点：タンクの背面の目盛り窓
    b.weak(0, 0.08, -0.43, 0.2, [0.9, 1.7, 0.45], 0.075);
    return b.done();
  },

  update(c) {
    const { world, e, dt, spec, pc, dist } = c;
    const ai = e.ai;
    // ---- 状態の初期化
    ai.armPhase ??= 'none';
    ai.armTip ??= new THREE.Vector3();
    ai.armDir ??= new THREE.Vector3(0, 0, 1);
    ai.armLen ??= 0;
    ai.attachT ??= 0;
    ai.losLost ??= 0;
    ai.stolen ??= 0;
    ai.windup ??= 0;
    ai.cooldownBase ??= spec.attackInterval;
    ai.atkCd ??= 0.6 + Math.random() * 0.8;
    ai.fear ??= 0;
    ai.pitch ??= 0;

    const awake = ai.alert > 0;

    // 照準の上下：予備動作〜つないでいる間は吸い口をプレイヤーへ向ける
    const aiming = ai.windup > 0 || ai.armPhase === 'extending' || ai.armPhase === 'attached';
    const wantPitch = aiming ? -Math.asin(THREE.MathUtils.clamp((pc.y - e.pos.y) / Math.max(0.01, dist), -0.9, 0.9)) : 0;
    ai.pitch += (wantPitch - ai.pitch) * Math.min(1, dt * 10);
    const mouth = leechMouth(e, _mouth);

    // ---- つながれた：腕をしまって全力で逃げる
    if (e.tethered) {
      if (!ai.fleeing) {
        ai.fleeing = true;
        ai.fleeRamp = 0.4;
        ai.fleeT = 0;
        ai.windup = 0;
        ai.warn = 0;
        world.events.emit('leechFlee', { pos: e.pos.clone() });
        spawnBurst(world, e.pos, 0xffffff, 8, 4, 0.3);
      }
      ai.fear = LEECH.fear;
    } else if (ai.fear > 0) {
      ai.fear -= dt;
      if (ai.fear <= 0) ai.fleeing = false;
    }
    if (ai.fleeing) {
      ai.windup = 0;
      ai.warn = 0;
      if (ai.armPhase === 'extending' || ai.armPhase === 'attached') breakArm(world, e);
    }

    updateArm(c, mouth);

    if (ai.fleeing) { flee(c); return; }

    if (!awake) {
      // 待機：ふわふわ浮かぶ
      ai.warn = 0;
      ai.windup = 0;
      if (ai.armPhase === 'extending' || ai.armPhase === 'attached') breakArm(world, e);
      const wish = _c.set(0, hoverVy(c, 2, 0.1), 0);
      moveFlyer(world, e, dt, wish, 6);
      return;
    }
    skirmish(c, mouth);
  },

  animate(world, e, dt, down) {
    const ai = e.ai;
    const p = ai.model.parts;
    const vis = ai.model.vis as THREE.Group;
    const t: number = ai.t ?? 0;
    const phase: string = ai.armPhase ?? 'none';
    const armOut = phase !== 'none';
    const warn: number = ai.warn ?? 0;

    // ---- 腕
    const arm: ArmVisual | undefined = ai.arm;
    if (arm) {
      if (armOut && !down && e.status !== 'dead') drawArm(arm, leechMouth(e, _a), ai.armTip, phase, world.time);
      else arm.group.visible = false;
    }

    // ---- タンク：ためた電力に応じて満ちる
    const target = down ? 0 : THREE.MathUtils.clamp((ai.stolen ?? 0) / LEECH.stolenCap, 0, 1);
    ai.fillShown = THREE.MathUtils.lerp(ai.fillShown ?? 0, target, Math.min(1, dt * 8));
    const fill = ai.fillShown as number;
    (p.fill as THREE.Group).scale.y = Math.max(0.001, fill);
    const lm = p.liquidMat as THREE.MeshStandardMaterial;
    const full = fill > 0.97;
    lm.emissiveIntensity = down ? 0 : 0.6 + 0.9 * fill + (phase === 'attached' ? 0.5 * Math.sin(t * 16) : 0) + (full ? 0.5 * Math.sin(t * 12) : 0);

    // ---- 吸い口：予備動作で光り、腕が出ている間はバネがほどける
    const mm = p.mouthMat as THREE.MeshStandardMaterial;
    mm.emissiveIntensity = down ? 0 : 0.8 + 2.4 * warn + (phase === 'attached' ? 1.0 : phase === 'extending' ? 1.4 : 0);
    const cm = p.coilMat as THREE.MeshStandardMaterial;
    cm.emissiveIntensity = down ? 0 : 0.9 + 1.6 * warn;
    const coil = p.coil as THREE.Group;
    const coilK = armOut ? 0.35 : warn > 0 ? 1 + 0.4 * Math.sin(t * 40) * warn : 1;
    coil.scale.z = THREE.MathUtils.lerp(coil.scale.z, coilK, Math.min(1, dt * 14));

    // 噴射口
    (p.jetMat as THREE.MeshStandardMaterial).emissiveIntensity = down ? 0 : 1.2 + 0.6 * Math.sin(t * 30 + e.id) + (ai.fleeing ? 1.2 : 0);

    // ---- 姿勢
    if (!down) {
      // 速度に応じて傾く（体の向き基準）
      const yaw: number = ai.yaw ?? 0;
      const vl = e.vel.x * Math.sin(yaw) + e.vel.z * Math.cos(yaw);
      const vs = e.vel.x * Math.cos(yaw) - e.vel.z * Math.sin(yaw);
      const rx = (ai.pitch ?? 0) + THREE.MathUtils.clamp(vl * 0.03, -0.3, 0.3);
      const rz = THREE.MathUtils.clamp(-vs * 0.04, -0.35, 0.35);
      vis.rotation.x = THREE.MathUtils.lerp(vis.rotation.x, rx, Math.min(1, dt * 10));
      vis.rotation.z = THREE.MathUtils.lerp(vis.rotation.z, rz, Math.min(1, dt * 10));
      vis.position.y += Math.sin(t * 5 + e.id) * 0.02;
      // 予備動作で縮こまる／逃げる時はぶるぶる震える
      if (warn > 0) vis.scale.multiplyScalar(1 - 0.12 * warn);
      if (ai.fleeing) {
        vis.position.x += Math.sin(t * 60) * 0.015;
        vis.rotation.y = Math.sin(t * 9) * 0.25;
      } else vis.rotation.y = 0;
    } else {
      vis.rotation.z = (ai.tilt ?? 1) * 1.2 * ai.collapse;
      vis.rotation.x = 0.6 * ai.collapse;
      vis.rotation.y = 0;
    }
  },

  onHit(world, e) {
    // 撃たれると腕が外れ、予備動作も中断
    const ai = e.ai;
    ai.windup = 0;
    ai.warn = 0;
    if (ai.armPhase === 'extending' || ai.armPhase === 'attached') breakArm(world, e);
    ai.atkCd = Math.max(ai.atkCd ?? 0, 1.2);
  },

  onGone(world, e, how) {
    const ai = e.ai;
    hideArm(world, e);
    ai.windup = 0;
    ai.fleeing = false;
    const stolen: number = ai.stolen ?? 0;
    ai.stolen = 0;
    if (stolen <= 0) return;
    const center = e.pos.clone();
    if (how === 'absorb') {
      // 吸い切られた：盗んだ電力がプレイヤーに戻る
      addEnergy(world, stolen);
      spawnShockwave(world, center, STOLEN_CYAN, 2.2, 0.45);
      spawnFlash(world, center, 0xbfffff, 6, 7, 0.3);
      spawnBurst(world, center, STOLEN_CYAN, 28, 6, 0.7);
      spawnBurst(world, center, 0xffffff, 10, 4, 0.5);
    } else {
      // 撃破：電力は散って失われる
      spawnBurst(world, center, STOLEN_CYAN, 14, 7, 0.9);
    }
  },

  onRemove(world, e) {
    // 消える瞬間に腕とフラグを必ず片付ける（stolen の返却は onGone 側）
    hideArm(world, e);
    const arm: ArmVisual | undefined = e.ai.arm;
    if (arm) for (const l of arm.bolts) l.geometry.dispose();
  },
};
