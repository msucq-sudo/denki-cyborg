// 主人公の手続きアニメーション。毎フレーム、すべての関節を状態から計算し直し（スカラーだけ指数平滑）、
// 状態間をなめらかにブレンドする。ゲームロジックの状態は読むだけ。
import * as THREE from 'three';
import { ABSORB, CHARACTER, DODGE } from '../config/balance';
import { moveSpeed } from '../progression/effects';
import type { World } from '../core/types';
import type { PlayerVisual, ArmRig } from './visual';

const A = CHARACTER.anim;
const G = CHARACTER.gun;
const SC = CHARACTER.scouter;
const SP = CHARACTER.spring;

export interface AnimState {
  phase: number;
  moveK: number; runK: number; fwdF: number; sideF: number;
  airK: number; flyK: number; aimK: number; supportK: number; absK: number; chargeK: number;
  landT: number; minVy: number; prevGround: boolean;
  flinchT: number; prevHp: number;
  recoilT: number; prevShots: number; shotHold: number;
  ripple: number; rippleT: number; prevAbsPhase: string;
  scK: number; stretch: number;
}

export function createAnimState(world: World): AnimState {
  return {
    phase: 0, moveK: 0, runK: 0, fwdF: 1, sideF: 0, airK: 0, flyK: 0, aimK: 0, supportK: 0, absK: 0, chargeK: 0,
    landT: 0, minVy: 0, prevGround: true, flinchT: 0, prevHp: world.player.hp,
    recoilT: 0, prevShots: world.stats.shots, shotHold: 0, ripple: 0, rippleT: 0, prevAbsPhase: 'idle', scK: 0, stretch: 1,
  };
}

const mix = (a: number, b: number, w: number): number => a + (b - a) * w;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const smooth = (cur: number, target: number, rate: number, dt: number): number => cur + (target - cur) * (1 - Math.exp(-rate * Math.max(dt, 0)));

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const AX = new THREE.Vector3(1, 0, 0);
const V = (a: number[]): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);
const CARRY_POS = V(G.carryPos), CARRY_DIR = V(G.carryDir).normalize();
const POLE_R = V(G.poleR), POLE_L = V(G.poleL);

const _u = new THREE.Vector3(), _w = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _gunPos = new THREE.Vector3(), _gunDir = new THREE.Vector3(), _aimL = new THREE.Vector3();
const _tR = new THREE.Vector3(), _tL = new THREE.Vector3(), _tip = new THREE.Vector3(), _dir = new THREE.Vector3();
const _gq = new THREE.Quaternion(), _qx = new THREE.Quaternion();
const _m4 = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _zero = new THREE.Vector3();
const _gs = new THREE.Vector3();
const _eu = new THREE.Euler();
const _qs = new THREE.Quaternion(), _qe = new THREE.Quaternion();
const _qs2 = new THREE.Quaternion(), _qe2 = new THREE.Quaternion();
const _qs3 = new THREE.Quaternion(), _qe3 = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion(), _qLean = new THREE.Quaternion(), _axis = new THREE.Vector3();
const IDENT = new THREE.Quaternion();

/** 2ボーンIK（肩ローカル）。qs=肩の回転、qe=肘の回転（肩ローカル） */
export function solveArm(S: THREE.Vector3, T: THREE.Vector3, Lu: number, Lf: number, pole: THREE.Vector3, qs: THREE.Quaternion, qe: THREE.Quaternion): void {
  _u.subVectors(T, S);
  const d = clamp(_u.length(), Math.abs(Lu - Lf) + 1e-3, Lu + Lf - 1e-3);
  _u.normalize();
  const a = Math.acos(clamp((Lu * Lu + d * d - Lf * Lf) / (2 * Lu * d), -1, 1));
  _w.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_w.lengthSq() < 1e-6) _w.set(0, 0, 1);
  _w.normalize();
  _e.copy(_u).multiplyScalar(Math.cos(a)).addScaledVector(_w, Math.sin(a));
  qs.setFromUnitVectors(DOWN, _e);
  _f.copy(_u).multiplyScalar(d).addScaledVector(_e, -Lu).multiplyScalar(1 / Lf);
  _f.applyQuaternion(_qi.copy(qs).invert()).normalize();
  qe.setFromUnitVectors(DOWN, _f);
}

interface LegT { th: number; flex: number; z: number; ank: number }
const legT: LegT[] = [{ th: 0, flex: 0, z: 0, ank: 0 }, { th: 0, flex: 0, z: 0, ank: 0 }];

const L_THIGH = 0.42, L_SHIN = 0.37;

export function poseCharacter(world: World, v: PlayerVisual, a: AnimState, dt: number): void {
  const p = world.player;
  const inp = world.input;
  const t = world.time;
  const playing = world.state === 'playing';
  const f = p.root.rotation.y;
  const vx = p.vel.x, vz = p.vel.z;
  const hs = Math.hypot(vx, vz);
  const fwd = -vx * Math.sin(f) - vz * Math.cos(f);
  const side = vx * Math.cos(f) - vz * Math.sin(f);
  const grounded = p.onGround, flying = p.flying;
  const dodging = playing && p.dodgeTimer > 0;
  const absPhase = world.absorb.phase;
  const absorbActive = absPhase === 'extending' || absPhase === 'attached' || absPhase === 'retracting';

  // ---------- 状態スカラー ----------
  a.moveK = smooth(a.moveK, grounded && !dodging && hs > 0.5 ? 1 : 0, A.moveRate, dt);
  a.runK = smooth(a.runK, hs > moveSpeed(world) * 1.25 ? 1 : 0, A.runRate, dt);
  if (hs > 0.3) { a.fwdF = smooth(a.fwdF, fwd / hs, 14, dt); a.sideF = smooth(a.sideF, side / hs, 14, dt); }
  if (grounded && hs > 0.3) a.phase += (hs / mix(A.strideWalk, A.strideRun, a.runK)) * Math.PI * 2 * dt;
  a.airK = smooth(a.airK, !grounded && !flying && !dodging ? 1 : 0, A.airRate, dt);
  a.flyK = smooth(a.flyK, flying ? 1 : 0, A.flyRate, dt);

  if (!grounded) a.minVy = Math.min(a.minVy, p.vel.y);
  if (grounded && !a.prevGround) { if (a.minVy < -4) a.landT = A.landTime * clamp(-a.minVy / 12, 0.4, 1); a.minVy = 0; }
  a.prevGround = grounded;
  a.landT = Math.max(0, a.landT - dt);
  const landK = a.landT > 0 ? Math.sin(Math.PI * (1 - a.landT / A.landTime)) : 0;

  if (p.hp < a.prevHp) a.flinchT = A.flinchTime;
  a.prevHp = p.hp;
  a.flinchT = Math.max(0, a.flinchT - dt);
  const flinch = a.flinchT > 0 ? Math.sin(Math.PI * (1 - a.flinchT / A.flinchTime)) * A.flinchAmp : 0;

  if (world.stats.shots !== a.prevShots) { a.prevShots = world.stats.shots; a.recoilT = G.recoilTime; a.shotHold = G.holdAfterShot; }
  a.recoilT = Math.max(0, a.recoilT - dt);
  a.shotHold = Math.max(0, a.shotHold - dt);
  const recoil = a.recoilT / G.recoilTime;

  // world.level.data.poseAim=true：ムービーなどで入力なしに銃を構えさせる
  const aimWant = playing && !dodging && (inp.mouse(0) || inp.mouse(2) || p.charging || a.shotHold > 0 || absorbActive || world.level.data.poseAim === true);
  a.aimK = smooth(a.aimK, aimWant ? 1 : 0, A.aimRate, dt);
  a.supportK = smooth(a.supportK, aimWant && !absorbActive && !flying ? 1 : 0, A.aimRate, dt);
  const absWant = playing && (absorbActive || (inp.isDown('KeyE') && absPhase === 'idle'));
  a.absK = smooth(a.absK, absWant ? 1 : 0, absWant ? 60 : A.absorbRate, dt);
  a.chargeK = smooth(a.chargeK, p.charging ? 1 : 0, 10, dt);

  // スプリングのリップル（接続・戻りの衝撃で震える）
  if (absPhase !== a.prevAbsPhase) {
    if (absPhase === 'attached') a.ripple = 1;
    else if (a.prevAbsPhase === 'retracting' && absPhase === 'cooldown') a.ripple = 0.8;
    a.rippleT = 0;
    a.prevAbsPhase = absPhase;
  }
  a.rippleT += dt;
  a.ripple *= Math.exp(-SP.rippleDecay * Math.max(dt, 0));

  const rollK = dodging ? 1 - p.dodgeTimer / DODGE.duration : 0;
  const tuck = dodging ? Math.pow(Math.sin(Math.PI * rollK), 0.5) : 0;

  const breath = Math.sin(t * A.breathRate);
  const sway = Math.sin(t * A.swayRate);
  const runK = a.runK, moveK = a.moveK, aimK = a.aimK;
  const ampScale = clamp(0.3 + (0.7 * hs) / moveSpeed(world), 0.3, 1);
  const legAmp = mix(A.legAmpWalk, A.legAmpRun, runK) * ampScale;
  const k0 = mix(A.kneeWalk[0], A.kneeRun[0], runK), k1 = mix(A.kneeWalk[1], A.kneeRun[1], runK);
  const cK = a.chargeK;
  const stance = aimK * (1 - moveK);
  const rise = clamp(p.vel.y / 6, -1, 1) * 0.5 + 0.5;

  // ---------- 脚 ----------
  for (let i = 0; i < 2; i++) {
    const ph = a.phase + i * Math.PI;
    const sn = Math.sin(ph);
    const s = i === 0 ? -1 : 1;
    // 待機（わずかな体重移動）
    let th = 0.02 * sway * s, flex = 0.05, z = s * 0.025, ank = 0;
    // 歩き/走り
    const lth = sn * legAmp * a.fwdF;
    const lfl = k0 + k1 * Math.pow(Math.max(0, Math.cos(ph - 0.3)), 1.5) * ampScale;
    th = mix(th, lth, moveK);
    flex = mix(flex, lfl, moveK);
    z = mix(z, s * 0.03 + sn * legAmp * 0.6 * a.sideF, moveK);
    ank = mix(ank, -(lth - lfl) * 0.8, moveK);
    // 構えのスタンス（静止時）：左足が前、右足が後ろ
    th += (i === 0 ? G.stanceFront : -G.stanceBack) * stance;
    flex += G.stanceKnee * stance;
    z += s * G.stanceSplay * stance;
    ank += -(i === 0 ? G.stanceFront : -G.stanceBack) * stance * 0.6;
    // 溜め：踏ん張り（左足を前に、足を開いて腰を落とす）
    th += (i === 0 ? 0.18 : -0.12) * cK;
    flex += A.chargeKnee * cK;
    z += s * A.chargeSplay * cK;
    ank += -(i === 0 ? 0.18 : -0.12) * cK * 0.5;
    // 空中
    const airTh = i === 0 ? mix(0.25, 0.75, rise) : mix(0.2, -0.15, rise);
    const airFl = i === 0 ? mix(0.35, 1.2, rise) : mix(0.3, 0.5, rise);
    th = mix(th, airTh, a.airK); flex = mix(flex, airFl, a.airK);
    z = mix(z, s * (0.08 + (1 - rise) * 0.1), a.airK); ank = mix(ank, -(airTh - airFl) * 0.4 + 0.15, a.airK);
    // 飛行（脚を後ろへ流す）
    th = mix(th, -0.22 + 0.03 * Math.sin(t * 5 + i), a.flyK); flex = mix(flex, 0.3, a.flyK);
    z = mix(z, s * 0.05, a.flyK); ank = mix(ank, -0.55, a.flyK);
    // ロール（体を丸める）
    th = mix(th, 1.25, tuck); flex = mix(flex, A.rollTuck + 0.2, tuck); z = mix(z, s * 0.1, tuck); ank = mix(ank, 0.2, tuck);
    // 着地の沈み込み
    flex += landK * 0.5; th += landK * 0.15;
    legT[i].th = th; legT[i].flex = flex; legT[i].z = z; legT[i].ank = ank;
  }
  const legs = [v.legL, v.legR];
  for (let i = 0; i < 2; i++) {
    const l = legs[i], T = legT[i];
    l.hip.rotation.set(T.th, 0, T.z);
    l.knee.rotation.set(-T.flex, 0, 0);
    l.ankle.rotation.set(T.ank, 0, 0);
  }
  // 足が浮かないよう、脚の鉛直方向の長さに合わせて胴を上下させる（接地時のみ）
  const hAt = (T: LegT): number => L_THIGH * Math.cos(T.th) + L_SHIN * Math.cos(T.th - T.flex);
  const groundW = (1 - a.airK) * (1 - a.flyK) * (1 - tuck);
  const bodyDrop = (Math.max(hAt(legT[0]), hAt(legT[1])) - (L_THIGH + L_SHIN)) * A.groundComp * groundW;
  const airLift = a.flyK * (0.12 + Math.sin(t * 6) * 0.03);

  // ---------- 胴 ----------
  const ph0 = a.phase;
  const lean = -mix(A.leanWalk, A.leanRun, runK) * moveK * clamp(a.fwdF, -0.5, 1);
  v.body.position.y = airLift;
  v.rig.position.y = -0.9 + bodyDrop - flinch * 0.03;
  v.hips.position.set(0.01 * sway, 0.9, 0);
  v.hips.rotation.set(0, Math.sin(ph0) * A.hipTwist * moveK * (1 - aimK * 0.7) + G.aimHipTwist * stance, Math.cos(ph0) * 0.03 * moveK);
  const recoilBack = recoil * 0.05;
  v.spine.rotation.set(
    lean + 0.012 * breath + flinch + landK * 0.2 + recoilBack * aimK,
    -Math.sin(ph0) * A.spineTwist * moveK * (1 - aimK * 0.7) + G.aimTwist * aimK, 0);
  v.chest.rotation.set(
    0.014 * breath + p.pitch * 0.3 * aimK + flinch * 0.5 - cK * 0.08,
    0, flinch * 0.25 * Math.sin(t * 40));
  v.head.rotation.set(clamp(p.pitch, -0.8, 0.8) * 0.45 - lean * 0.6 - flinch * 0.6, 0.03 * Math.sin(t * 0.7), 0);

  // 全身の傾き（飛行・ロール）は重心 pivot で
  _qLean.setFromAxisAngle(AX, -A.flyLean * a.flyK);
  v.pivot.position.y = 0.9;
  if (dodging) {
    const d = p.dodgeDir;
    const lx = d.x * Math.cos(f) - d.z * Math.sin(f);
    const lz = d.x * Math.sin(f) + d.z * Math.cos(f);
    _axis.set(lz, 0, -lx);
    if (_axis.lengthSq() < 1e-6) _axis.set(-1, 0, 0);
    _axis.normalize();
    const e = rollK * rollK * (3 - 2 * rollK); // ease
    _qRoll.setFromAxisAngle(_axis, Math.PI * 2 * A.rollSpins * e);
    v.pivot.quaternion.copy(_qRoll).multiply(_qLean);
    v.pivot.position.y = 0.9 + 0.1 * Math.sin(Math.PI * rollK);
  } else {
    v.pivot.quaternion.copy(_qLean);
  }

  p.root.updateMatrixWorld(true);

  // ---------- 腕・銃 ----------
  const chest = v.chest;
  // 照準方向（胸ローカル）
  _inv.copy(chest.matrixWorld).invert();
  _aimL.copy(world.aimDir);
  if (_aimL.lengthSq() < 1e-6) _aimL.copy(CARRY_DIR); else _aimL.transformDirection(_inv);

  // 銃：構え↔携行を補間。構え時は右肩から照準方向へ腕をまっすぐ伸ばした先（肩の高さ）にグリップを置く
  const W = v.weapon;
  const armR = v.armR, armL = v.armL;
  _m4.lookAt(_zero, _aimL, UP);
  _qx.setFromRotationMatrix(_m4); // 構え時の銃の向き
  _gs.set(W.gripR[0], W.gripR[1], W.gripR[2]).multiplyScalar(G.scale).applyQuaternion(_qx);
  _tR.copy(armR.shoulder.position).addScaledVector(_aimL, (armR.upper + armR.fore) * G.armExtend).sub(_gs); // 構え時の銃位置
  if (W.aimShift) _tR.add(_dir.set(W.aimShift[0], W.aimShift[1], W.aimShift[2]));
  _gunPos.lerpVectors(CARRY_POS, _tR, aimK);
  _gunPos.y += 0.01 * breath * (1 - aimK) - 0.03 * landK;
  if (moveK > 0.01) _gunPos.y += Math.cos(ph0 * 2) * 0.012 * moveK * (1 - aimK) * (1 + runK);
  _gunDir.lerpVectors(CARRY_DIR, _aimL, aimK).normalize();
  _gunPos.addScaledVector(_gunDir, -G.recoilKick * recoil * aimK);
  const shake = A.chargeShake * cK;
  _gunPos.x += Math.sin(t * 73) * shake; _gunPos.y += Math.cos(t * 61) * shake;
  _m4.lookAt(_zero, _gunDir, UP);
  _gq.setFromRotationMatrix(_m4);
  _qx.setFromAxisAngle(AX, G.recoilPitch * recoil * aimK);
  _gq.multiply(_qx);
  v.gunFrame.position.copy(_gunPos);
  v.gunFrame.quaternion.copy(_gq);

  _tR.set(W.gripR[0], W.gripR[1], W.gripR[2]).multiplyScalar(G.scale).applyQuaternion(_gq).add(_gunPos);
  solveArm(armR.shoulder.position, _tR, armR.upper, armR.fore, POLE_R, _qs, _qe);
  armR.shoulder.quaternion.copy(_qs);
  armR.elbow.quaternion.copy(_qe);

  // 左腕：FK（スイング）→ 銃を支えるIK → 吸収で伸ばす、の順にブレンド
  const swingAmp = mix(A.armSwingWalk, A.armSwingRun, runK) * ampScale;
  const armSwing = -Math.sin(ph0) * swingAmp * moveK * a.fwdF;
  const elbowFlex = mix(A.elbowWalk, A.elbowRun, runK) * moveK + 0.12;
  let lx = 0.05 * breath + armSwing, lz = -0.06 - 0.5 * a.airK - 0.3 * a.flyK, le = elbowFlex;
  lx = mix(lx, -0.25, a.flyK); lx = mix(lx, 0.5 * (1 - rise) - 0.3 * rise, a.airK);
  lx = mix(lx, 0.9, tuck); le = mix(le, 1.6, tuck);
  lx -= flinch * 0.6; le += flinch * 0.4;
  _qs.setFromEuler(_eu.set(lx, 0, lz));
  _qe.setFromEuler(_eu.set(le, 0, 0));
  // 支えの手
  _tL.set(W.gripL[0], W.gripL[1], W.gripL[2]).multiplyScalar(G.scale).applyQuaternion(_gq).add(_gunPos);
  // 長い武器で左手が届かないときは、バネ腕が伸びて支える
  const dSup = _tL.distanceTo(armL.shoulder.position);
  const supStretch = clamp((dSup / 0.97 - armL.fore) / armL.upper, 1, 3);
  solveArm(armL.shoulder.position, _tL, armL.upper * supStretch, armL.fore, POLE_L, _qs2, _qe2);
  _qs.slerp(_qs2, a.supportK);
  _qe.slerp(_qe2, a.supportK);
  // 吸収：肩から先端へ向けて一直線。バネが伸びて拳が先端に届く
  let stretch = mix(1, supStretch, a.supportK);
  if (a.absK > 0.001) {
    _tip.copy(world.absorb.tip);
    // 吸収側の更新はこの後なので、伸びている最中は1フレーム先の先端に合わせる
    if (absPhase === 'extending') _tip.addScaledVector(world.absorb.dir, ABSORB.extendSpeed * Math.max(dt, 0));
    chest.worldToLocal(_tip);
    _dir.subVectors(_tip, armL.shoulder.position);
    const dist = _dir.length();
    if (dist > 0.05) _dir.multiplyScalar(1 / dist); else _dir.copy(_aimL);
    _qs3.setFromUnitVectors(DOWN, _dir);
    _qe3.copy(IDENT);
    _qs.slerp(_qs3, a.absK);
    _qe.slerp(_qe3, a.absK);
    stretch = mix(stretch, Math.max(1, (dist - armL.fore - CHARACTER.arm.fistReach) / armL.upper), a.absK);
    if (absPhase === 'attached') stretch *= 1 + 0.012 * Math.sin(t * 52); // 吸収中のブルブル
  }
  const ripple = a.ripple * SP.rippleAmp * Math.sin(SP.rippleFreq * a.rippleT);
  stretch = Math.max(0.75, stretch + ripple);
  stretch += 0.02 * Math.sin(t * 2.1) * (1 - a.absK) + 0.04 * moveK * Math.sin(ph0 * 2) * (1 - a.absK);
  a.stretch = stretch; 
  v.springStretch.value = stretch;
  armL.shoulder.quaternion.copy(_qs);
  armL.elbow.quaternion.copy(_qe);
  armL.elbow.position.y = -armL.upper * stretch;
  // スプリングの発光（吸収中は電気が走る色）
  const glow = a.absK * (absPhase === 'attached' ? 0.5 + 0.25 * Math.sin(t * 18) : 0.25);
  v.springMat.emissiveIntensity = glow;
  v.springMat.emissive.setHex(p.overloading ? 0xff8a3c : CHARACTER.colors.cyan);

  // ---------- 発光パーツ ----------
  const frac = p.energy / p.maxEnergy;
  let bi = 0.2 + frac * 0.9;
  if (frac <= 0) bi = 0.08; else if (frac < 0.25) bi *= 0.6 + 0.4 * Math.sin(t * 10);
  v.batteryMat.color.setHex(CHARACTER.colors.cyan).multiplyScalar(bi);
  v.gunGlowMat.color.setHex(CHARACTER.colors.cyan).multiplyScalar(0.7 + 0.5 * a.chargeK + 1.2 * recoil);

  // スカウター（耳の装置）：ONでリング/ランプが強く脈打ち、色がシアンへ変わる
  const on = world.functions.scouter;
  a.scK = smooth(a.scK, on ? 1 : 0, 8, dt);
  const level = mix(SC.offLevel, SC.onLevel, a.scK) * (frac <= 0 ? 0.3 : 1) * (1 + SC.pulse * a.scK * Math.sin(t * SC.pulseRate) + 0.08 * Math.sin(t * 2));
  v.scouterMat.color.setHex(SC.offColor).lerp(_c.setHex(SC.onColor), a.scK).multiplyScalar(level);
  v.scouterGlowMat.color.copy(v.scouterMat.color);
  v.scouterGlowMat.opacity = mix(SC.glowOff, SC.glowOn, a.scK) * (0.75 + 0.25 * Math.sin(t * SC.pulseRate * 1.3));
  v.scouterGlow.visible = a.scK > 0.02;
  v.scouterGlow.scale.setScalar(1 + 0.25 * a.scK * (0.5 + 0.5 * Math.sin(t * SC.pulseRate)));

  // 被弾点滅
  const blink = a.flinchT > 0 && Math.floor(t * 40) % 2 === 0;
  for (const m of v.flashMats) m.emissiveIntensity = blink ? 0.9 : 0;

  // ジェット噴射
  v.jets.children.forEach((c) => { if ((c as THREE.Mesh).isMesh) { c.visible = flying; c.scale.set(1, 0.8 + Math.random() * A.jetFlicker, 1); } });
  v.jetLight.intensity = flying ? 2.5 + Math.random() * 1.2 : 0;
  v.jets.position.y = airLift;
}

const _c = new THREE.Color();

export type { ArmRig };
