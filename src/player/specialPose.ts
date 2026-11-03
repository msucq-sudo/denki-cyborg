// 必殺技（電気のかめはめ波）の姿勢データ。pose.ts が毎フレーム読み、通常の姿勢の上にブレンドして重ねる。
// 構え（①）→ 溜め（②：右の腰で球を抱える）→ 発射（③④：両手を突き出す）。値は胴・脚・両手の目標位置と指の形。
import * as THREE from 'three';
import { CHARACTER, SPECIAL } from '../config/balance';
import type { World } from '../core/types';

export interface LegSP { th: number; flex: number; z: number; ank: number }
export interface SpecialPose {
  hipsY: number; spineX: number; spineY: number; chestX: number; headY: number;
  /** 胸のひねり（Y）・横の傾き（Z）。溜めで左肩を右へ巻き込む（丸める）のに使う */
  chestY: number; chestZ: number;
  /** 左の鎖骨の回転（オイラー x,y,z）。左肩アーマーごと右前へ巻き込む */
  clav: THREE.Vector3;
  /** 脚：[左, 右]（pose.ts の legT と同じ意味。th=前後、flex=膝、z=開き、ank=足首） */
  legs: [LegSP, LegSP];
  /** 両手の目標位置（胸ローカル）と、指の向き（指先が向く方向）・手のひらが向く方向（胸ローカル） */
  tR: THREE.Vector3; tL: THREE.Vector3;
  fR: THREE.Vector3; pR: THREE.Vector3; fL: THREE.Vector3; pL: THREE.Vector3;
  /** 指の曲げ（0=まっすぐ…1=握り）・開き */
  curl: number; spread: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const SX = CHARACTER.arm.shoulderX, SY = CHARACTER.arm.shoulderY - 1.3;
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (v: number): number => { const x = clamp01(v); return x * x * (3 - 2 * x); };
/** ゆっくり始まりゆっくり終わる（溜め用） */
export const easeInOut = (v: number): number => { const x = clamp01(v); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

/** 世界の向き dir（正規化）を、胴（体の向き f・腰と背骨のひねり twist）から見た向きに直す */
export function toChestDir(dir: THREE.Vector3, f: number, twist: number): THREE.Vector3 {
  return dir.clone().applyAxisAngle(UP, -f).applyAxisAngle(UP, -twist).normalize();
}

/** 両手を前（向き d）へ突き出した手の位置・向き */
function thrust(d: THREE.Vector3, reach: number): Pick<SpecialPose, 'tR' | 'tL' | 'fR' | 'pR' | 'fL' | 'pL'> {
  const P = V(0, SY, 0).addScaledVector(d, reach);
  const perp = new THREE.Vector3().crossVectors(UP, d).normalize();
  const tR = P.clone().addScaledVector(perp, -0.055);
  const tL = P.clone().addScaledVector(perp, 0.055);
  const finger = UP.clone().addScaledVector(d, 0.35).normalize();
  return { tR, tL, fR: finger.clone(), pR: d.clone(), fL: finger.clone(), pL: d.clone() };
}

/** ① 構え：左足前・右足後ろ、体を斜めに。両腕を前へ突き出す */
function keyPose(kind: 'pose' | 'charge' | 'fire', dir: THREE.Vector3, f: number): SpecialPose {
  if (kind === 'charge') {
    const hipsY = -0.8, spineY = -0.35;
    // 右の腰で球を抱える：左手が前（-Z）、右手が後ろ（+Z）、手のひらを向かい合わせ。指は上向きに巻く
    const ball = V(0.5, -0.3, -0.14);
    return {
      hipsY, spineX: -0.32, spineY, chestX: -0.1, headY: 0.95,
      // 上半身を右へ大きくひねって左肩を前に出し、左肩はアーマーごと右前へ丸める
      chestY: SPECIAL.shoulderRoll.twist, chestZ: SPECIAL.shoulderRoll.roll, clav: V(...SPECIAL.shoulderRoll.clav),
      legs: [{ th: 0.6, flex: 0.62, z: -0.2, ank: -0.3 }, { th: -0.5, flex: 0.7, z: 0.2, ank: 0.3 }],
      tR: ball.clone().add(V(0.02, 0, 0.14)), tL: ball.clone().add(V(0, 0, -0.16)),
      fR: V(0.3, 0.9, 0.1).normalize(), pR: V(0, 0, -1), fL: V(0.3, 0.9, -0.1).normalize(), pL: V(0, 0, 1),
      curl: 0.55, spread: 0.7,
    };
  }
  if (kind === 'fire') {
    const hipsY = -0.3, spineY = -0.12;
    const d = toChestDir(dir, f, hipsY + spineY);
    return {
      hipsY, spineX: 0.1, spineY, chestX: 0.05, headY: 0.4, chestY: 0, chestZ: 0, clav: V(0, 0, 0),
      legs: [{ th: 0.62, flex: 0.75, z: -0.16, ank: -0.35 }, { th: -0.52, flex: 0.4, z: 0.16, ank: 0.35 }],
      ...thrust(d, 0.8), curl: 0.1, spread: 1,
    };
  }
  const hipsY = -0.4, spineY = -0.2;
  const d = toChestDir(dir, f, hipsY + spineY);
  return {
    hipsY, spineX: -0.05, spineY, chestX: 0, headY: 0.6, chestY: 0, chestZ: 0, clav: V(0, 0, 0),
    legs: [{ th: 0.45, flex: 0.28, z: -0.12, ank: -0.25 }, { th: -0.4, flex: 0.4, z: 0.12, ank: 0.25 }],
    ...thrust(d, 0.78), curl: 0.15, spread: 1,
  };
}

function mixN(a: number, b: number, w: number): number { return a + (b - a) * w; }
function blend(a: SpecialPose, b: SpecialPose, w: number, wHands = w): SpecialPose {
  const lv = (x: LegSP, y: LegSP): LegSP => ({ th: mixN(x.th, y.th, w), flex: mixN(x.flex, y.flex, w), z: mixN(x.z, y.z, w), ank: mixN(x.ank, y.ank, w) });
  const vv = (x: THREE.Vector3, y: THREE.Vector3, k: number): THREE.Vector3 => x.clone().lerp(y, k);
  return {
    hipsY: mixN(a.hipsY, b.hipsY, w), spineX: mixN(a.spineX, b.spineX, w), spineY: mixN(a.spineY, b.spineY, w),
    chestX: mixN(a.chestX, b.chestX, w), headY: mixN(a.headY, b.headY, w),
    chestY: mixN(a.chestY, b.chestY, w), chestZ: mixN(a.chestZ, b.chestZ, w), clav: vv(a.clav, b.clav, w),
    legs: [lv(a.legs[0], b.legs[0]), lv(a.legs[1], b.legs[1])],
    tR: vv(a.tR, b.tR, wHands), tL: vv(a.tL, b.tL, wHands),
    fR: vv(a.fR, b.fR, wHands).normalize(), pR: vv(a.pR, b.pR, wHands).normalize(),
    fL: vv(a.fL, b.fL, wHands).normalize(), pL: vv(a.pL, b.pL, wHands).normalize(),
    curl: mixN(a.curl, b.curl, wHands), spread: mixN(a.spread, b.spread, wHands),
  };
}

/** いまの段階（world.special.phase / t）の姿勢。'idle' なら null */
export function specialPoseNow(world: World, f: number): SpecialPose | null {
  const out = rawPose(world, f);
  return out ? chestComp(out) : null;
}

const _ce = new THREE.Euler(), _cq = new THREE.Quaternion();
/** 胸をひねった分だけ手の目標を逆に回す（手の目標は胸ローカルなので、玉の位置が胸と一緒に動かないように） */
function chestComp(o: SpecialPose): SpecialPose {
  if (o.chestY === 0 && o.chestZ === 0) return o;
  _cq.setFromEuler(_ce.set(0, o.chestY, o.chestZ)).invert();
  for (const v of [o.tR, o.tL, o.fR, o.pR, o.fL, o.pL]) v.applyQuaternion(_cq);
  return o;
}

function rawPose(world: World, f: number): SpecialPose | null {
  const sp = world.special;
  if (sp.phase === 'idle') return null;
  const dir = sp.dir;
  const pose = keyPose('pose', dir, f);
  if (sp.phase === 'pose') return pose;
  const charge = keyPose('charge', dir, f);
  if (sp.phase === 'charge') {
    const u = sp.t / SPECIAL.charge;
    // 手は前半をかけてゆっくり右腰へ。胴の傾きは溜めの間じわじわ深くなる
    const out = blend(pose, charge, easeInOut(u), easeInOut(clamp01(u / SPECIAL.chargeHandsK)));
    // 終わりぎわは力がこもって小刻みに震える（放つ直前ほど強く）
    const k = clamp01((u - SPECIAL.chargeHandsK) / (1 - SPECIAL.chargeHandsK));
    const tr = Math.sin(sp.t * 55) * 0.008 * k * k;
    out.tR.y += tr; out.tL.y -= tr; out.spineX += tr * 1.5;
    return out;
  }
  const fire = keyPose('fire', dir, f);
  const w = Math.sqrt(clamp01(sp.t / (SPECIAL.fire * 0.6)));
  const out = blend(charge, fire, w);
  if (sp.phase === 'beam') {
    // 照射中：反動でわずかに震える
    const sh = Math.sin(sp.t * 60) * 0.012;
    out.tR.y += sh; out.tL.y -= sh; out.spineX += sh * 2;
  }
  return out;
}

/** 手の向き（指先 finger・手のひら palm。どちらも胸ローカル）→ 手の座標系（指は -Y、手のひらは -Z）の回転 */
export function handBasis(finger: THREE.Vector3, palm: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const y = finger.clone().multiplyScalar(-1).normalize();
  const z = palm.clone().multiplyScalar(-1);
  z.addScaledVector(y, -z.dot(y));
  if (z.lengthSq() < 1e-6) z.set(0, 0, 1);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
