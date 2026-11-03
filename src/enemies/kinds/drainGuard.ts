// ボス「ドレインガーディアン」（ドレイン装置の部屋）。部位HP（右腕・胴体・左腕）、部位ごとの当たり判定、攻撃の予兆つきAI。
// ロジック（HP・形態・腕の再生・攻撃の選び方）は drainGuardLogic.ts、見た目は drainGuardModel.ts、数値は balance.ts の DRAIN_BOSS。
// level/drainBoss.ts が spawnEnemy(world, 'drainGuard', …) で出し、ムービー中は ai.inert=true（当たらず動かない）にする。
import * as THREE from 'three';
import { DRAIN_BOSS as D } from '../../config/balance';
import type { Enemy, HitSphere, World } from '../../core/types';
import { damagePlayer, PLAYER_HIT_RADIUS, toast } from '../../core/combat';
import { segmentSphere } from '../../core/collision';
import { spawnBurst, spawnFlash, spawnShockwave } from '../../core/effects';
import { spawnProjectile } from '../../core/projectiles';
import { faceToward, makeCtx, moveGround, type Ctx } from '../common';
import { unitCircle } from '../models';
import type { KindModule } from './kind';
import { buildGuardModel, EYE_POS, FLOOR, type GuardParts, type GuardArmRig } from './drainGuardModel';
import {
  ARMS, PART_LABEL, armsOk, damagePart, gapRange, isArmless, pickAttack, rainSpots, regenProgress, teleportSpot, updateRegen,
  type ArmId, type Arena, type AttackId, type GuardState, type PartId,
} from './drainGuardLogic';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const rnd = Math.random;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const smooth = (t: number): number => { t = clamp01(t); return t * t * (3 - 2 * t); };

export const partsOf = (e: Enemy): GuardParts => e.ai.model.parts as GuardParts;
/** 部位HPなどの状態（HUD・テスト・level が読む） */
export const getGuard = (e: Enemy): GuardState => partsOf(e).guard;

interface Atk {
  id: AttackId | null;
  ph: string;
  t: number;
  fired: number;
  arm: ArmId;
  dir: THREE.Vector3;
  aim: THREE.Vector3;
  hit: boolean;
  /** 瞬間移動の行き先 */
  dest: THREE.Vector3;
  /** 瞬間移動のあとに続ける攻撃 */
  follow: 'punch' | 'rush' | null;
  sweep: number;
  sweepSign: number;
  dmgT: number;
}
const newAtk = (): Atk => ({ id: null, ph: 'idle', t: 0, fired: 0, arm: 'rArm', dir: new THREE.Vector3(0, 0, 1), aim: new THREE.Vector3(), hit: false, dest: new THREE.Vector3(), follow: null, sweep: 0, sweepSign: 1, dmgT: 0 });

interface RainItem { x: number; z: number; t: number; delay: number; grp: THREE.Group; disc: THREE.Mesh; ring: THREE.Mesh; fall: THREE.Group }
interface Debris { obj: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3; t: number }

const floorY = (e: Enemy): number => e.pos.y - e.radius;
const fwdOf = (e: Enemy, out: THREE.Vector3): THREE.Vector3 => out.set(Math.sin(e.ai.yaw ?? 0), 0, Math.cos(e.ai.yaw ?? 0));
function emit(world: World, e: Enemy, action: string, value?: number): void {
  world.events.emit('enemyAction', { kind: e.kind, pos: e.pos.clone(), action: action as never, value });
}
function arenaOf(world: World): Arena {
  const r = world.level.rooms[0];
  return r ? { x0: r.min.x + 4.2, x1: r.max.x - 4.2, z0: r.min.z + 4.2, z1: r.max.z - 4.2 } : { x0: -30, x1: 30, z0: -30, z1: 30 };
}

// ---------------------------------------------------------------- 共有ジオメトリ
let ringGeo: THREE.RingGeometry | null = null;
const getRing = (): THREE.RingGeometry => ringGeo ??= (() => { const g = new THREE.RingGeometry(0.9, 1, 48); g.rotateX(-Math.PI / 2); return g; })();
let discGeo: THREE.CircleGeometry | null = null;
const getDisc = (): THREE.CircleGeometry => discGeo ??= (() => { const g = new THREE.CircleGeometry(1, 40); g.rotateX(-Math.PI / 2); return g; })();
let missileGeo: THREE.BufferGeometry | null = null;
const getMissileGeo = (): THREE.BufferGeometry => missileGeo ??= (() => { const g = new THREE.CapsuleGeometry(0.2, 0.9, 3, 8); return g; })();

// ---------------------------------------------------------------- 初期化・ダメージ
function ensureInit(e: Enemy): void {
  const ai = e.ai;
  if (ai.gInit) return;
  ai.gInit = true;
  const g = getGuard(e);
  e.maxHp = g.max.body; e.hp = g.hp.body;
  ai.atk = newAtk();
  ai.gapT = 1.2;
  ai.last = null;
  ai.rain = [] as RainItem[];
  ai.debris = [] as Debris[];
  ai.extra = [] as THREE.Object3D[];
  ai.armTarget = { r: 0, l: 0 };
  ai.armAng = { r: 0, l: 0 };
  ai.armRate = 8;
  ai.walk = 0;
  ai.phase = 1;
  ai.roarT = 0;
  ai.hidden = false;
  ai.pendingPhase2 = false;
  ai.stunT = 0;
}

/** 部位にダメージ（演出つき）。filterDamage・吸収などから呼ぶ */
export function hurtPart(world: World, e: Enemy, part: PartId, amount: number): number {
  ensureInit(e);
  const g = getGuard(e);
  const r = damagePart(g, part, amount);
  if (r.destroyed) onArmDestroyed(world, e, r.destroyed, r.regenStarted);
  if (r.phase2) e.ai.pendingPhase2 = true;
  return r.applied;
}

function armPos(rig: GuardArmRig, out: THREE.Vector3): THREE.Vector3 { rig.pivot.updateWorldMatrix(true, false); return rig.pivot.getWorldPosition(out); }

function onArmDestroyed(world: World, e: Enemy, arm: ArmId, regenStarted: boolean): void {
  const ai = e.ai, P = partsOf(e), rig = P[arm];
  e.root.updateMatrixWorld(true);
  // 壊れた腕が外れて落ちる（見た目の複製）
  const d = rig.limb.clone(true);
  rig.limb.updateWorldMatrix(true, false);
  rig.limb.matrixWorld.decompose(d.position, d.quaternion, d.scale);
  world.scene.add(d);
  const side = arm === 'rArm' ? -1 : 1;
  const dir = fwdOf(e, new THREE.Vector3());
  (ai.debris as Debris[]).push({ obj: d, vel: new THREE.Vector3(dir.z * -side * 3 + dir.x * 2, 5, -dir.x * -side * 3 + dir.z * 2), spin: new THREE.Vector3((rnd() - 0.5) * 4, (rnd() - 0.5) * 3, side * 2.5), t: 0 });
  rig.limb.visible = false;
  const at = armPos(rig, new THREE.Vector3());
  spawnBurst(world, at, 0xffb050, 28, 8, 0.8);
  spawnBurst(world, at, 0x66e6ff, 16, 6, 0.6);
  spawnShockwave(world, at, 0xff9a40, 4, 0.5);
  spawnFlash(world, at, 0xffd080, 10, 14, 0.3);
  ai.armTarget[arm === 'rArm' ? 'r' : 'l'] = 0;
  emit(world, e, 'gArmBreak');
  toast(world, `${PART_LABEL[arm]}を破壊した！`, 2.5);
  if (regenStarted) {
    emit(world, e, 'gRegen');
    toast(world, `もう片方の腕から電流が流れ込む…${PART_LABEL[arm]}が再生中！`, 3);
  }
  // 腕の攻撃の最中だったら中断
  const A: Atk = ai.atk;
  if (A.id && ((A.id === 'missiles' && arm === 'rArm') || (A.id === 'bolt' && arm === 'lArm') || (A.id === 'punch' && A.arm === arm))) cancelAttack(world, e);
}

export function damageFilter(world: World, e: Enemy, damage: number, opts: { part?: string }): number {
  ensureInit(e);
  const part: PartId = opts.part === 'rArm' || opts.part === 'lArm' ? opts.part : 'body';
  if (part === 'body') return hurtPart(world, e, 'body', damage);
  hurtPart(world, e, part, damage);
  return 0;
}

// ---------------------------------------------------------------- 攻撃の開始・終了
function cancelAttack(world: World, e: Enemy): void {
  const ai = e.ai, P = partsOf(e), A: Atk = ai.atk;
  A.id = null; A.ph = 'idle';
  ai.warn = 0;
  P.teleCircle.visible = false; P.teleStrip.visible = false; P.orb.visible = false;
  ai.armTarget.r = 0; ai.armTarget.l = 0;
  endBeam(e);
  e.root.visible = true; ai.hidden = false;
  ai.gapT = lerp(...gapRange(getGuard(e)), rnd()) * 0.6;
  void world;
}

function finishAttack(e: Enemy, extraGap = 0): void {
  const ai = e.ai, P = partsOf(e), A: Atk = ai.atk;
  ai.last = A.id;
  A.id = null; A.ph = 'idle';
  ai.warn = 0;
  P.teleCircle.visible = false; P.teleStrip.visible = false; P.orb.visible = false;
  ai.armTarget.r = 0; ai.armTarget.l = 0;
  ai.armRate = 6;
  ai.punchQuick = false; ai.rushQuick = false; ai.crouch = 0; ai.eyeGlow = 0;
  const [lo, hi] = gapRange(getGuard(e));
  ai.gapT = lerp(lo, hi, rnd()) + extraGap;
}

function begin(c: Ctx, id: AttackId): void {
  const { world, e } = c;
  const ai = e.ai, A: Atk = ai.atk, g = getGuard(e);
  A.id = id; A.ph = 'windup'; A.t = 0; A.fired = 0; A.hit = false; A.follow = null; A.dmgT = 0;
  ai.armRate = 6;
  if (id === 'punch') {
    const ok = armsOk(g);
    // プレイヤーが寄っている側の腕で殴る（右腕は -X 側）
    const lateral = (c.pc.x - e.pos.x) * Math.cos(ai.yaw) - (c.pc.z - e.pos.z) * Math.sin(ai.yaw);
    const pref: ArmId = lateral > 0 ? 'lArm' : 'rArm';
    A.arm = ok.includes(pref) ? pref : ok[0];
  }
  if (id === 'teleport') A.ph = 'vanish';
  if (id === 'teleportRam') A.ph = 'vanish';
  if (id === 'rain') A.ph = 'windup';
  emit(world, e, id === 'missiles' ? 'gMissileWind' : id === 'bolt' ? 'gBoltCharge' : id === 'punch' ? 'gPunchWind' : id === 'rush' ? 'gRushWind' : id === 'beam' ? 'gBeamCharge' : id === 'rain' ? 'gRainWarn' : 'gTeleport');
}

/** テスト・確認用：待機中のボスに、指定した攻撃をすぐ始めさせる（腕がなくて使えない攻撃でもそのまま始める） */
export function forceAttack(world: World, e: Enemy, id: AttackId): void {
  ensureInit(e);
  const A: Atk = e.ai.atk;
  if (A.id) cancelAttack(world, e);
  begin(makeCtx(world, e, 1 / 60), id);
}

// ---------------------------------------------------------------- 更新
export const drainGuard: KindModule = {
  knockback: 0,
  build() { return buildGuardModel(); },
  filterDamage: damageFilter,

  update(c) {
    const { world, e, dt } = c;
    ensureInit(e);
    const ai = e.ai, P = partsOf(e), g = getGuard(e);
    updateDebris(world, e, dt);
    updateRain(world, e, dt);
    if (ai.inert) return;

    // 吸収などで胴体HPが直接減った分を部位HPに反映
    if (e.hp < g.hp.body - 1e-6) hurtPart(world, e, 'body', g.hp.body - e.hp);
    e.hp = g.hp.body;
    if (g.dead) return;

    // 腕の再生
    const prog = regenProgress(g);
    const done = updateRegen(g, dt);
    if (g.regen) regenFx(world, e, prog);
    else hideBolts(e);
    if (done) {
      const rig = P[done];
      rig.limb.visible = true; rig.limb.scale.setScalar(1);
      const at = armPos(rig, new THREE.Vector3());
      spawnBurst(world, at, 0x66e6ff, 24, 7, 0.6);
      spawnShockwave(world, at, 0x66e6ff, 3.5, 0.4);
      emit(world, e, 'gRegenDone');
      toast(world, `${PART_LABEL[done]}が再生した（HP ${Math.ceil(g.hp[done])}）`, 2.5);
      if (g.regen) { emit(world, e, 'gRegen'); toast(world, `もう片方の腕も再生中！`, 2.5); }
    }
    // 壊れた腕の付け根のスパーク
    for (const a of ARMS) {
      if (g.arm[a] === 'broken' && rnd() < dt * 7) spawnBurst(world, armPos(P[a], _a), rnd() < 0.5 ? 0xffc060 : 0x66e6ff, 2, 3, 0.35);
    }

    // 第2形態へ：咆哮
    if (ai.pendingPhase2) {
      ai.pendingPhase2 = false;
      ai.phase = 2;
      ai.phaseFlash = 1;
      ai.roarT = D.roar;
      cancelAttack(world, e);
      spawnShockwave(world, e.pos, 0xff4a30, 11, 0.8);
      spawnFlash(world, e.pos, 0xff3a20, 12, 20, 0.45);
      spawnBurst(world, e.pos, 0xff7a40, 36, 9, 0.8);
      emit(world, e, 'gRoar');
      world.events.emit('bossPhase', { phase: 2 });
      toast(world, 'ドレインガーディアンが本気を出した！', 3);
    }
    if (ai.roarT > 0) {
      ai.roarT -= dt;
      ai.armTarget.r = 1.05; ai.armTarget.l = 1.05;
      ai.warn = 0.4;
      moveWish(c, 0, 0);
      if (ai.roarT <= 0) { ai.armTarget.r = 0; ai.armTarget.l = 0; ai.gapT = 0.6; ai.warn = 0; }
      return;
    }

    const A: Atk = ai.atk;
    if (ai.stunT > 0) {
      ai.stunT -= dt;
      moveWish(c, 0, 0);
      ai.warn = 0;
      if (ai.stunT <= 0) ai.gapT = 0.4;
      return;
    }
    if (A.id) { runAttack(c, A); return; }

    // ---- 待機：プレイヤーの方を向き、距離を保つ
    faceToward(e, c.dirXZ.x, c.dirXZ.z, dt, 4);
    const armless = isArmless(g);
    const sp = D.speed * (armless ? 1.5 : 1);
    let ws = 0;
    if (c.dist2d > (armless ? 9 : 15)) ws = sp;
    else if (c.dist2d < 7 && !armless) ws = -sp * 0.6;
    moveWish(c, ws, 0);
    ai.gapT -= dt;
    if (ai.gapT <= 0) begin(c, pickAttack(g, { dist: c.dist2d, rand: rnd, last: ai.last }));
  },

  animate(world, e, dt, down) {
    animateGuard(world, e, dt, down);
  },

  onGone(world, e) {
    const ai = e.ai;
    clearRain(world, e);
    endBeam(e);
    hideBolts(e);
    ai.inert = true;
    ai.armTarget = { r: 0.2, l: 0.2 };
    for (const p of world.projectiles) if (p.owner === 'enemy') p.dead = true;
  },

  onRemove(world, e) {
    for (const d of (e.ai.debris ?? []) as Debris[]) world.scene.remove(d.obj);
    clearRain(world, e);
  },
};

/** 前後の速度 wish（+ならボスの前方向）で歩く。壁際に出ないよう範囲に収める */
function moveWish(c: Ctx, forward: number, side: number, accel = 14): void {
  const { world, e } = c;
  const yaw: number = e.ai.yaw ?? 0;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const wx = fx * forward + fz * side, wz = fz * forward - fx * side;
  const res = moveGround(world, e, c.dt, wx, wz, accel);
  e.ai.walk = Math.hypot(e.vel.x, e.vel.z);
  const ar = arenaOf(world);
  e.pos.x = THREE.MathUtils.clamp(e.pos.x, ar.x0 - 1, ar.x1 + 1);
  e.pos.z = THREE.MathUtils.clamp(e.pos.z, ar.z0 - 1, ar.z1 + 1);
  e.ai.hitWall = res.hitWall;
}

// ---------------------------------------------------------------- 各攻撃
function runAttack(c: Ctx, A: Atk): void {
  const { world, e, dt } = c;
  const ai = e.ai, P = partsOf(e), g = getGuard(e);
  A.t += dt;
  const toPlayer = _a.set(c.pc.x - e.pos.x, 0, c.pc.z - e.pos.z);
  switch (A.id) {
    // ---- 右腕：ホーミングミサイル
    case 'missiles': {
      moveWish(c, 0, 0);
      const M = D.missiles;
      if (A.ph === 'windup') {
        faceToward(e, toPlayer.x, toPlayer.z, dt, 5);
        ai.armTarget.r = 0.9 * smooth(A.t / M.windup);
        ai.warn = 0.2 + 0.5 * clamp01(A.t / M.windup);
        P.rArm.glowMat.emissiveIntensity = 1 + 2 * clamp01(A.t / M.windup);
        if (A.t >= M.windup) { A.ph = 'fire'; A.t = 0; }
      } else if (A.ph === 'fire') {
        ai.armTarget.r = 0.9;
        ai.warn = 0.5;
        while (A.fired < M.count && A.t >= A.fired * M.interval) { fireMissile(world, e, A.fired); A.fired++; }
        if (A.fired >= M.count && A.t >= M.count * M.interval + 0.2) { A.ph = 'recover'; A.t = 0; }
      } else {
        ai.armTarget.r = 0; ai.warn = 0;
        P.rArm.glowMat.emissiveIntensity = 0.9;
        if (A.t >= M.recover) finishAttack(e);
      }
      break;
    }
    // ---- 左腕：電撃弾
    case 'bolt': {
      moveWish(c, 0, 0);
      const B = D.bolt;
      if (A.ph === 'windup') {
        const k = clamp01(A.t / B.windup);
        // 狙いは発射の少し前に固定（そこから動けば避けられる）
        if (A.t < B.windup - 0.3) { faceToward(e, toPlayer.x, toPlayer.z, dt, 6); A.aim.copy(c.pc); }
        ai.armTarget.l = 0.95 * smooth(k);
        ai.warn = 0.2 + 0.5 * k;
        P.orb.visible = true; P.orb.scale.setScalar(0.15 + 0.7 * k * k);
        P.lArm.glowMat.emissiveIntensity = 1 + 2 * k;
        if (A.t >= B.windup) { A.ph = 'fire'; A.t = 0; fireBolts(world, e, A); P.orb.visible = false; }
      } else if (A.ph === 'fire') {
        ai.armTarget.l = 0.95;
        if (A.t >= 0.25) { A.ph = 'recover'; A.t = 0; }
      } else {
        ai.armTarget.l = 0; ai.warn = 0;
        P.lArm.glowMat.emissiveIntensity = 0.9;
        if (A.t >= B.recover) finishAttack(e);
      }
      break;
    }
    // ---- パンチ
    case 'punch': {
      moveWish(c, 0, 0);
      const Pn = D.punch;
      const windup = ai.punchQuick ? D.teleport.followWindup : Pn.windup;
      const key = A.arm === 'rArm' ? 'r' : 'l';
      if (A.ph === 'windup') {
        const k = clamp01(A.t / windup);
        if (k < 0.7) faceToward(e, toPlayer.x, toPlayer.z, dt, 7);
        ai.armTarget[key] = -0.9 * smooth(k);          // 腕を後ろへ引く
        ai.warn = 0.2 + 0.6 * k;
        P.teleCircle.visible = true;
        P.teleCircle.position.z = 3.5;
        P.teleCircle.scale.setScalar(Pn.hitRadius);
        (P.teleCircle.material as THREE.MeshBasicMaterial).opacity = 0.15 + 0.4 * k * (0.7 + 0.3 * Math.sin(A.t * 30));
        if (A.t >= windup) { A.ph = 'strike'; A.t = 0; ai.armRate = 40; ai.armTarget[key] = 1.5; }
      } else if (A.ph === 'strike') {
        ai.armTarget[key] = 1.5;
        if (A.t >= 0.12 && !A.hit) {
          A.hit = true;
          doPunch(world, e, c);
        }
        if (A.t >= 0.25) { A.ph = 'recover'; A.t = 0; P.teleCircle.visible = false; ai.warn = 0; ai.armRate = 5; }
      } else {
        ai.armTarget[key] = 1.2 * (1 - clamp01(A.t / Pn.recover));
        if (A.t >= Pn.recover) finishAttack(e);
      }
      break;
    }
    // ---- 突進（胴体）
    case 'rush': {
      const R = D.rush;
      const windup = ai.rushQuick ? D.teleport.followWindup + 0.35 : R.windup;
      if (A.ph === 'windup') {
        moveWish(c, 0, 0);
        const k = clamp01(A.t / windup);
        if (k < 0.55) { faceToward(e, toPlayer.x, toPlayer.z, dt, 7); A.dir.set(Math.sin(ai.yaw), 0, Math.cos(ai.yaw)); }
        ai.warn = 0.2 + 0.7 * k;
        const len = rushLength(world, e, A.dir);
        P.teleStrip.visible = true;
        P.teleStrip.scale.set(R.width, 1, len);
        (P.teleStrip.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.4 * k * (0.7 + 0.3 * Math.sin(A.t * 34));
        ai.crouch = k;
        if (A.t >= windup) { A.ph = 'dash'; A.t = 0; P.teleStrip.visible = false; emit(world, e, 'gRush'); }
      } else if (A.ph === 'dash') {
        ai.crouch = 0;
        ai.warn = 0.5;
        faceToward(e, A.dir.x, A.dir.z, dt, 30);
        moveWish(c, R.speed, 0, 200);
        if (!A.hit && Math.hypot(c.pc.x - e.pos.x, c.pc.z - e.pos.z) < e.radius * 0.9 + PLAYER_HIT_RADIUS + 0.3 && c.pc.y < e.pos.y + e.radius + 0.4) {
          A.hit = true;
          damagePlayer(world, R.damage, e.pos);
          spawnBurst(world, c.pc, 0xff9a40, 14, 6);
        }
        if (rnd() < 0.7) spawnBurst(world, _b.set(e.pos.x, floorY(e) + 0.2, e.pos.z), 0xcfd6e6, 2, 3, 0.4);
        const crashed = ai.hitWall && A.t > 0.15;
        if (crashed || A.t >= R.maxTime) {
          if (crashed) {
            ai.stunT = R.wallStun;
            spawnShockwave(world, _b.set(e.pos.x + A.dir.x * e.radius, e.pos.y, e.pos.z + A.dir.z * e.radius), 0xffd070, 6, 0.5);
            spawnBurst(world, _b, 0xffb050, 26, 8, 0.7);
            emit(world, e, 'gWallCrash');
          }
          A.ph = 'recover'; A.t = 0; ai.warn = 0;
          ai.rushQuick = false;
          e.vel.set(0, 0, 0);
        }
      } else {
        moveWish(c, 0, 0, 60);
        ai.warn = 0;
        if (A.t >= R.recover) finishAttack(e);
      }
      break;
    }
    // ---- ミサイルの雨（第2形態）
    case 'rain': {
      moveWish(c, 0, 0);
      const Rn = D.rain;
      if (A.ph === 'windup') {
        const k = clamp01(A.t / Rn.windup);
        faceToward(e, toPlayer.x, toPlayer.z, dt, 4);
        ai.armTarget.r = 1.05 * smooth(k); ai.armTarget.l = 1.05 * smooth(k);
        ai.warn = 0.3 + 0.6 * k;
        if (A.t >= Rn.windup) { A.ph = 'fire'; A.t = 0; launchRain(world, e, c); }
      } else if (A.ph === 'fire') {
        ai.armTarget.r = 1.05; ai.armTarget.l = 1.05;
        if (A.t >= 0.5) { A.ph = 'recover'; A.t = 0; ai.warn = 0; }
      } else {
        ai.armTarget.r = 0; ai.armTarget.l = 0;
        if (A.t >= Rn.recover) finishAttack(e);
      }
      break;
    }
    // ---- 瞬間移動 → 攻撃 / 体当たり
    case 'teleport':
    case 'teleportRam': {
      const T = D.teleport, ram = A.id === 'teleportRam';
      if (A.ph === 'vanish') {
        moveWish(c, 0, 0);
        const k = clamp01(A.t / T.vanish);
        ai.vanishK = k;
        ai.warn = 0.3 + 0.5 * k;
        if (A.fired === 0) {
          A.fired = 1;
          // 行き先を決めて輪で知らせる（背後も）
          const behind = rnd() < T.behindChance;
          const ar = arenaOf(world);
          const spot = teleportSpot({ x: c.pc.x, z: c.pc.z }, world.player.yaw, behind, ar, rnd);
          if (ram) {
            // 体当たり：少し離れたところから
            const away = new THREE.Vector3(spot.x - c.pc.x, 0, spot.z - c.pc.z).normalize().multiplyScalar(T.dist * 1.9);
            spot.x = THREE.MathUtils.clamp(c.pc.x + away.x, ar.x0, ar.x1); spot.z = THREE.MathUtils.clamp(c.pc.z + away.z, ar.z0, ar.z1);
          }
          A.dest.set(spot.x, floorY(e) + e.radius, spot.z);
          makeDestMarker(world, e, A.dest);
          spawnBurst(world, e.pos, 0x9a6aff, 22, 8, 0.6);
          spawnFlash(world, e.pos, 0xc8a0ff, 8, 14, 0.25);
        }
        if (A.t >= T.vanish) { A.ph = 'hidden'; A.t = 0; ai.hidden = true; e.root.visible = false; ai.vanishK = 1; }
      } else if (A.ph === 'hidden') {
        e.vel.set(0, 0, 0);
        ai.hidden = true;
        if (A.t >= T.hidden) {
          e.pos.copy(A.dest);
          e.root.position.copy(e.pos);
          ai.hidden = false; e.root.visible = true;
          const dx = c.pc.x - e.pos.x, dz = c.pc.z - e.pos.z;
          ai.yaw = Math.atan2(dx, dz);
          clearDestMarker(world, e);
          spawnBurst(world, e.pos, 0x9a6aff, 30, 9, 0.7);
          spawnShockwave(world, e.pos, 0xb890ff, 6, 0.4);
          spawnFlash(world, e.pos, 0xe0d0ff, 10, 16, 0.3);
          emit(world, e, 'gAppear');
          A.ph = 'appear'; A.t = 0;
        }
      } else {
        // 現れた：すぐ次の攻撃へ
        ai.vanishK = 1 - clamp01(A.t / T.appear);
        moveWish(c, 0, 0);
        if (A.t >= T.appear) {
          ai.vanishK = 0;
          const g2 = getGuard(e);
          const id: AttackId = ram || armsOk(g2).length === 0 ? 'rush' : 'punch';
          const last = ai.last;
          A.id = id; A.ph = 'windup'; A.t = 0; A.hit = false; A.follow = null; ai.last = last;
          if (id === 'punch') { A.arm = armsOk(g2)[0]; ai.punchQuick = true; } else { ai.rushQuick = true; }
          // 瞬間移動の直後は、プレイヤーの方を向いてすぐ構える
          A.dir.set(c.pc.x - e.pos.x, 0, c.pc.z - e.pos.z).normalize();
          emit(world, e, id === 'punch' ? 'gPunchWind' : 'gRushWind');
        }
      }
      break;
    }
    // ---- 目玉のビーム（両腕なし）
    case 'beam': {
      moveWish(c, 0, 0);
      const Bm = D.beam;
      const eye = eyeWorld(e, _b);
      if (A.ph === 'windup') {
        const k = clamp01(A.t / Bm.windup);
        faceToward(e, toPlayer.x, toPlayer.z, dt, 5);
        ai.warn = 0.2 + 0.6 * k;
        ai.eyeGlow = k;
        if (A.t < Bm.lockAt) {
          A.aim.copy(c.pc);
          A.dir.copy(A.aim).sub(eye).normalize();
        }
        showAimLine(world, e, eye, A.dir, A.t >= Bm.lockAt ? 1 : 0.4, A.t);
        if (A.t >= Bm.windup) {
          A.ph = 'fire'; A.t = 0; A.sweep = 0; A.sweepSign = rnd() < 0.5 ? -1 : 1; A.dmgT = 0;
          emit(world, e, 'gBeamFire');
          hideAimLine(e);
        }
      } else if (A.ph === 'fire') {
        ai.eyeGlow = 1;
        ai.warn = 0.6;
        const rate = Bm.sweep / Bm.fire;
        A.sweep += rate * dt * A.sweepSign;
        const dir = _a.copy(A.dir);
        const cs = Math.cos(A.sweep), sn = Math.sin(A.sweep);
        dir.set(A.dir.x * cs + A.dir.z * sn, A.dir.y, -A.dir.x * sn + A.dir.z * cs).normalize();
        const hitLen = beamLength(eye, dir);
        const end = _b.clone().addScaledVector(dir, hitLen);
        drawBeam(world, e, eye, end, A.t);
        A.dmgT -= dt;
        if (A.dmgT <= 0 && segmentSphere(eye, end, c.pc, PLAYER_HIT_RADIUS + Bm.width * 0.5) !== null) {
          A.dmgT = Bm.tick;
          damagePlayer(world, Bm.damage, eye);
        }
        if (rnd() < 0.8) spawnBurst(world, end, 0xffa060, 2, 5, 0.3);
        if (A.t >= Bm.fire) { A.ph = 'recover'; A.t = 0; endBeam(e); ai.eyeGlow = 0; ai.warn = 0; }
      } else {
        if (A.t >= Bm.recover) finishAttack(e);
      }
      break;
    }
  }
  void g; void P;
}

function rushLength(world: World, e: Enemy, dir: THREE.Vector3): number {
  const ar = arenaOf(world);
  let t = 60;
  if (Math.abs(dir.x) > 1e-4) t = Math.min(t, ((dir.x > 0 ? ar.x1 + 1 : ar.x0 - 1) - e.pos.x) / dir.x);
  if (Math.abs(dir.z) > 1e-4) t = Math.min(t, ((dir.z > 0 ? ar.z1 + 1 : ar.z0 - 1) - e.pos.z) / dir.z);
  return Math.max(4, Math.min(t, D.rush.speed * D.rush.maxTime + e.radius));
}

function fireMissile(world: World, e: Enemy, idx: number): void {
  const P = partsOf(e), M = D.missiles;
  const pos = P.rArm.muzzle.getWorldPosition(_a.set(0, 0, 0)).clone();
  const out = (idx % 2 === 0 ? -1 : 1) * (0.5 + 0.3 * (idx % 3));
  const yaw: number = e.ai.yaw;
  const vel = new THREE.Vector3(Math.cos(yaw) * out + Math.sin(yaw) * 0.6, 1.6, -Math.sin(yaw) * out + Math.cos(yaw) * 0.6).normalize().multiplyScalar(6);
  spawnProjectile(world, {
    pos, vel, damage: M.damage, owner: 'enemy', radius: 0.4, size: 0.34, life: M.life, missile: true, shootable: true, hp: M.hp,
    homing: { turnRate: M.turnRate, target: 'player', delay: 0.55, speed: M.speed, accel: 12 },
    blast: { radius: M.radius, color: 0xff9a3d }, trail: 0xffc080,
  });
  spawnBurst(world, pos, 0xffe0a0, 6, 4);
  world.events.emit('enemyAttack', { kind: e.kind, pos: pos.clone() });
  emit(world, e, 'gMissile');
}

function fireBolts(world: World, e: Enemy, A: Atk): void {
  const P = partsOf(e), B = D.bolt;
  const pos = P.lArm.muzzle.getWorldPosition(_a.set(0, 0, 0)).clone();
  const base = A.aim.clone().sub(pos).normalize();
  const n = getGuard(e).phase === 2 ? B.fan : 1;
  for (let i = 0; i < n; i++) {
    const a = (i - (n - 1) / 2) * B.fanSpread;
    const dir = new THREE.Vector3(base.x * Math.cos(a) + base.z * Math.sin(a), base.y, -base.x * Math.sin(a) + base.z * Math.cos(a)).normalize();
    spawnProjectile(world, {
      pos: pos.clone(), vel: dir.multiplyScalar(B.speed), damage: B.damage, owner: 'enemy', radius: 0.38, size: B.size, life: B.life,
      color: 0x7fe0ff, trail: 0xbfeaff,
    });
  }
  spawnBurst(world, pos, 0xbfeaff, 14, 6, 0.4);
  spawnFlash(world, pos, 0x9ae6ff, 8, 12, 0.2);
  world.events.emit('enemyAttack', { kind: e.kind, pos: pos.clone() });
  emit(world, e, 'gBolt');
}

function doPunch(world: World, e: Enemy, c: Ctx): void {
  const Pn = D.punch;
  const f = fwdOf(e, _a);
  const cx = e.pos.x + f.x * 3.5, cz = e.pos.z + f.z * 3.5;
  const at = _b.set(cx, floorY(e) + 0.4, cz);
  spawnShockwave(world, at, 0xffd070, 5, 0.35);
  spawnBurst(world, at, 0xffb050, 22, 7, 0.6);
  emit(world, e, 'gPunch');
  const d = Math.hypot(c.pc.x - cx, c.pc.z - cz);
  if (d < Pn.hitRadius + PLAYER_HIT_RADIUS * 0.4 && c.pc.y < floorY(e) + 3.2) {
    damagePlayer(world, Pn.damage, e.pos);
    spawnBurst(world, c.pc, 0xff9a40, 14, 6);
  }
}

// ---------------------------------------------------------------- ミサイルの雨
function launchRain(world: World, e: Enemy, c: Ctx): void {
  const Rn = D.rain, ai = e.ai;
  const spots = rainSpots(Rn.count, { x: c.pc.x, z: c.pc.z }, arenaOf(world), rnd);
  const fy = floorY(e);
  const redDisc = () => new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  for (const s of spots) {
    const grp = new THREE.Group();
    grp.position.set(s.x, fy + 0.06, s.z);
    const disc = new THREE.Mesh(getDisc(), redDisc());
    disc.scale.set(Rn.radius, 1, Rn.radius); disc.renderOrder = 2;
    const ring = new THREE.Mesh(getRing(), new THREE.MeshBasicMaterial({ color: 0xff6a4a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    ring.scale.set(Rn.radius, 1, Rn.radius); ring.renderOrder = 3; ring.position.y = 0.01;
    const fall = new THREE.Group();
    const body = new THREE.Mesh(getMissileGeo(), new THREE.MeshStandardMaterial({ color: 0xf2f5fa, emissive: 0xff5a20, emissiveIntensity: 0.8 }));
    body.scale.setScalar(1.2);
    fall.add(body);
    fall.visible = false;
    grp.add(disc, ring, fall);
    world.scene.add(grp);
    (ai.rain as RainItem[]).push({ x: s.x, z: s.z, t: 0, delay: lerp(Rn.delayMin, Rn.delayMax, rnd()), grp, disc, ring, fall });
  }
  emit(world, e, 'gRainLaunch');
  // 発射の見た目：腕から上へ光の筋
  for (const a of ARMS) if (getGuard(e).arm[a] === 'ok') {
    const p = partsOf(e)[a].muzzle.getWorldPosition(new THREE.Vector3());
    spawnBurst(world, p, 0xffc080, 12, 7, 0.5);
    spawnFlash(world, p, 0xff9a40, 8, 12, 0.25);
  }
}

function updateRain(world: World, e: Enemy, dt: number): void {
  const ai = e.ai;
  const list = ai.rain as RainItem[] | undefined;
  if (!list || list.length === 0) return;
  const Rn = D.rain, fy = floorY(e);
  const pc = world.player.pos;
  for (let i = list.length - 1; i >= 0; i--) {
    const it = list[i];
    it.t += dt;
    const k = clamp01(it.t / it.delay);
    const pulse = 0.65 + 0.35 * Math.sin(it.t * (8 + 16 * k));
    (it.disc.material as THREE.MeshBasicMaterial).opacity = (0.12 + 0.3 * k) * pulse + Math.min(1, it.t * 4) * 0.08;
    (it.ring.material as THREE.MeshBasicMaterial).opacity = Math.min(1, it.t * 5) * (0.6 + 0.4 * pulse);
    // 着弾の少し前からミサイルが落ちてくる
    const fallT = 0.45;
    const fk = (it.t - (it.delay - fallT)) / fallT;
    it.fall.visible = fk > 0;
    if (fk > 0) it.fall.position.y = lerp(20, 0.2, fk * fk);
    if (it.t >= it.delay) {
      const at = new THREE.Vector3(it.x, fy + 0.3, it.z);
      spawnShockwave(world, at, 0xff7a3a, Rn.radius * 1.1, 0.4);
      spawnShockwave(world, at, 0xffffff, Rn.radius * 0.5, 0.2);
      spawnBurst(world, at, 0xff9a40, 22, 8, 0.6);
      spawnBurst(world, at, 0xfff0a0, 10, 5, 0.4);
      spawnFlash(world, at, 0xffb060, 10, 14, 0.2);
      world.events.emit('missileBlast', { pos: at.clone() });
      if (Math.hypot(pc.x - it.x, pc.z - it.z) < Rn.radius + 0.35 && pc.y < fy + 3.2) damagePlayer(world, Rn.damage, at);
      removeRainItem(world, it);
      list.splice(i, 1);
    }
  }
}

function removeRainItem(world: World, it: RainItem): void {
  world.scene.remove(it.grp);
  it.grp.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; m?.dispose?.(); });
}
function clearRain(world: World, e: Enemy): void {
  const list = e.ai.rain as RainItem[] | undefined;
  if (!list) return;
  for (const it of list) removeRainItem(world, it);
  list.length = 0;
}

// ---------------------------------------------------------------- 瞬間移動の行き先の輪・ビーム・電流の表示
function addExtra(e: Enemy, o: THREE.Object3D): void { (e.ai.extra as THREE.Object3D[]).push(o); }
function dropExtra(world: World, e: Enemy, o: THREE.Object3D | undefined): void {
  if (!o) return;
  world.scene.remove(o);
  const list = e.ai.extra as THREE.Object3D[];
  const i = list.indexOf(o);
  if (i >= 0) list.splice(i, 1);
  o.traverse((c) => { const m = (c as THREE.Mesh).material as THREE.Material | undefined; m?.dispose?.(); (c as THREE.Mesh).geometry && !(c as any).userData.sharedGeo && (c as THREE.Mesh).geometry.dispose(); });
}

function makeDestMarker(world: World, e: Enemy, dest: THREE.Vector3): void {
  clearDestMarker(world, e);
  const grp = new THREE.Group();
  grp.position.set(dest.x, floorY(e) + 0.08, dest.z);
  const mk = (r: number, op: number, geo: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xb08aff, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    m.scale.set(r, 1, r); m.renderOrder = 3; m.userData.sharedGeo = true;
    grp.add(m);
    return m;
  };
  mk(3.2, 0.9, getRing()); mk(1.6, 0.6, getRing()); mk(3.2, 0.18, getDisc());
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 9, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xb08aff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  pillar.position.y = 4.5;
  grp.add(pillar);
  world.scene.add(grp);
  addExtra(e, grp);
  e.ai.destMarker = grp;
}
function clearDestMarker(world: World, e: Enemy): void {
  dropExtra(world, e, e.ai.destMarker as THREE.Object3D | undefined);
  e.ai.destMarker = undefined;
}

function eyeWorld(e: Enemy, out: THREE.Vector3): THREE.Vector3 {
  const P = partsOf(e);
  P.eye.updateWorldMatrix(true, false);
  return P.eye.getWorldPosition(out);
}

/** 目玉のビームが床に当たるまでの長さ */
function beamLength(eye: THREE.Vector3, dir: THREE.Vector3): number {
  const fy = eye.y - (EYE_POS.y + FLOOR);   // 床の高さ（目玉の高さ - 目玉の床からの高さ）
  let len: number = D.beam.length;
  if (dir.y < -0.02) len = Math.min(len, (eye.y - fy) / -dir.y);
  return len;
}

function showAimLine(world: World, e: Enemy, eye: THREE.Vector3, dir: THREE.Vector3, k: number, t: number): void {
  let line = e.ai.aimLine as THREE.Mesh | undefined;
  if (!line) {
    line = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    world.scene.add(line);
    addExtra(e, line);
    e.ai.aimLine = line;
  }
  line.visible = true;
  const len = beamLength(eye, dir);
  line.position.copy(eye).addScaledVector(dir, len / 2);
  line.quaternion.setFromUnitVectors(_b.set(0, 0, 1), dir);
  const w = k >= 1 ? 0.22 : 0.07;
  line.scale.set(w, w, len);
  (line.material as THREE.MeshBasicMaterial).opacity = k >= 1 ? 0.8 + 0.2 * Math.sin(t * 50) : 0.5;
}
function hideAimLine(e: Enemy): void { const l = e.ai.aimLine as THREE.Mesh | undefined; if (l) l.visible = false; }

function drawBeam(world: World, e: Enemy, eye: THREE.Vector3, end: THREE.Vector3, t: number): void {
  let beam = e.ai.beamMesh as THREE.Mesh | undefined;
  if (!beam) {
    beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xff5a40, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.geometry.rotateX(Math.PI / 2);
    const core = new THREE.Mesh(beam.geometry, new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    core.scale.set(0.4, 0.4, 1);
    beam.add(core);
    world.scene.add(beam);
    addExtra(e, beam);
    e.ai.beamMesh = beam;
  }
  beam.visible = true;
  const dir = _a.copy(end).sub(eye);
  const len = dir.length();
  dir.normalize();
  beam.position.copy(eye).addScaledVector(dir, len / 2);
  beam.quaternion.setFromUnitVectors(_b.set(0, 0, 1), dir);
  const w = D.beam.width * 0.5 * (1 + 0.1 * Math.sin(t * 60));
  beam.scale.set(w, w, len);
}
function endBeam(e: Enemy): void {
  const b = e.ai.beamMesh as THREE.Mesh | undefined;
  if (b) b.visible = false;
  hideAimLine(e);
}

// ---------------------------------------------------------------- 腕の再生の電流
function ensureBolts(world: World, e: Enemy): THREE.Line[] {
  let bolts = e.ai.regenBolts as THREE.Line[] | undefined;
  if (bolts) return bolts;
  bolts = [];
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 16 }, () => new THREE.Vector3()));
    const ln = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: i === 0 ? 0xffffff : 0x66e6ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    ln.frustumCulled = false;
    ln.visible = false;
    world.scene.add(ln);
    addExtra(e, ln);
    bolts.push(ln);
  }
  e.ai.regenBolts = bolts;
  return bolts;
}
function hideBolts(e: Enemy): void { for (const b of (e.ai.regenBolts ?? []) as THREE.Line[]) b.visible = false; }

function regenFx(world: World, e: Enemy, prog: number): void {
  const g = getGuard(e), P = partsOf(e), job = g.regen;
  if (!job) return;
  const bolts = ensureBolts(world, e);
  e.root.updateMatrixWorld(true);
  const rig = P[job.target], src = P[job.source];
  // 再生中の腕：だんだん大きくなり、強く光る
  rig.limb.visible = true;
  rig.limb.scale.setScalar(0.2 + 0.8 * smooth(prog));
  rig.glowMat.emissiveIntensity = 2 + 2 * Math.sin(world.time * 40);
  src.glowMat.emissiveIntensity = 2 + Math.sin(world.time * 30);
  // 電流：元の腕の肘 → 胸のコア → 再生する腕の肩
  const from = src.elbow.getWorldPosition(new THREE.Vector3());
  const mid = P.torso.getWorldPosition(new THREE.Vector3());
  const to = armPos(rig, new THREE.Vector3());
  bolts.forEach((ln, bi) => {
    ln.visible = true;
    const pos = ln.geometry.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const p = u < 0.5 ? new THREE.Vector3().lerpVectors(from, mid, u * 2) : new THREE.Vector3().lerpVectors(mid, to, (u - 0.5) * 2);
      const amp = Math.sin(u * Math.PI) * (0.35 + 0.15 * bi);
      p.x += (rnd() - 0.5) * amp; p.y += (rnd() - 0.5) * amp; p.z += (rnd() - 0.5) * amp;
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
  });
  if (rnd() < 0.6) spawnBurst(world, to, 0x66e6ff, 2, 4, 0.3);
  P.core.emissiveIntensity = 2 + Math.sin(world.time * 25);
}

// ---------------------------------------------------------------- 落ちた腕
function updateDebris(world: World, e: Enemy, dt: number): void {
  const list = e.ai.debris as Debris[] | undefined;
  if (!list) return;
  const fy = floorY(e);
  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i];
    d.t += dt;
    d.vel.y -= 22 * dt;
    d.obj.position.addScaledVector(d.vel, dt);
    const ground = fy + 1.0;
    if (d.obj.position.y < ground) {
      d.obj.position.y = ground;
      if (d.vel.y < -3) spawnBurst(world, d.obj.position.clone(), 0xffc060, 8, 5, 0.4);
      d.vel.y = Math.abs(d.vel.y) * 0.25; d.vel.x *= 0.6; d.vel.z *= 0.6; d.spin.multiplyScalar(0.5);
    }
    d.obj.rotation.x += d.spin.x * dt; d.obj.rotation.y += d.spin.y * dt; d.obj.rotation.z += d.spin.z * dt;
    if (d.t > 1 && rnd() < dt * 6) spawnBurst(world, d.obj.position.clone(), 0x66e6ff, 2, 3, 0.3);
    if (d.t > 5) { world.scene.remove(d.obj); list.splice(i, 1); }
  }
}

// ---------------------------------------------------------------- アニメ・当たり判定
const SPH = 8;
function animateGuard(world: World, e: Enemy, dt: number, down: boolean): void {
  ensureInit(e);
  const ai = e.ai, P = partsOf(e), g = getGuard(e);
  const vis = ai.model.vis as THREE.Group;
  const t: number = ai.t ?? 0;

  // ---- 体の発光：汎用のアニメ（enemies.ts）が全身を真っ赤に塗るので、このボスは控えめに上書きする（被弾=白／予兆=赤橙／第2形態=うっすら赤）
  if (!down) {
    const warn: number = ai.warn ?? 0;
    for (const b of ai.model.bodyMats as { mat: THREE.MeshStandardMaterial; base: THREE.Color }[]) {
      if (ai.flash > 0) { b.mat.emissive.setHex(0xffffff); b.mat.emissiveIntensity = 0.7 * Math.min(1, ai.flash / 0.12); }
      else if (warn > 0) { b.mat.emissive.setHex(0xff4a20); b.mat.emissiveIntensity = 0.1 + 0.35 * warn * (0.85 + 0.15 * Math.sin(t * 30)); }
      else if (ai.phase === 2) { b.mat.emissive.setHex(0xff2010); b.mat.emissiveIntensity = 0.1 + 0.05 * Math.sin(t * 4) + (ai.roarT > 0 ? 0.35 : 0); }
      else { b.mat.emissive.setHex(0x000000); b.mat.emissiveIntensity = 1; }
      b.mat.color.copy(b.base);
    }
  }
  // ---- 腕：目標角へ追従（右腕=r・左腕=l。1.0 で水平、それ以上で上へ）
  const rate = Math.min(1, ai.armRate * dt);
  for (const [key, rig] of [['r', P.rArm], ['l', P.lArm]] as const) {
    const side = key === 'r' ? -1 : 1;
    ai.armAng[key] += (ai.armTarget[key] - ai.armAng[key]) * rate;
    const sway = Math.sin(t * 1.3 + side) * 0.03;
    rig.pivot.rotation.x = -ai.armAng[key] * (Math.PI / 2) + sway;
    rig.pivot.rotation.z = side * (0.1 + 0.12 * Math.min(1, ai.armAng[key]));
  }
  if (!g.regen) {
    for (const a of ARMS) if (g.arm[a] === 'ok') P[a].limb.scale.setScalar(1);
  }
  // ---- 脚：歩きの揺れ。足が着く瞬間に重い足音
  const walk: number = down || ai.inert && !ai.movieWalk ? 0 : Math.min(1, (ai.walk ?? 0) / 2);
  ai.phaseW = (ai.phaseW ?? 0) + dt * (2.2 + (ai.walk ?? 0) * 0.9);
  const s = Math.sin(ai.phaseW);
  P.legs[0].rotation.x = s * 0.45 * walk;
  P.legs[1].rotation.x = -s * 0.45 * walk;
  const stepSign = s > 0 ? 1 : -1;
  if (walk > 0.25 && ai.stepSign !== undefined && ai.stepSign !== stepSign && !ai.inert) {
    emit(world, e, 'gStep');
  }
  ai.stepSign = stepSign;
  vis.position.y = Math.abs(s) * 0.12 * walk - 0.55 * (ai.crouch ?? 0);
  vis.rotation.x = 0.18 * (ai.crouch ?? 0) + (ai.leanBack ?? 0);

  // ---- 目玉：プレイヤーを追う。第2形態は光が強い
  const hp = world.player.pos;
  const look = _a.set(hp.x, hp.y + 1.2, hp.z);
  P.eye.parent!.updateWorldMatrix(true, false);
  P.eye.parent!.worldToLocal(look);
  look.sub(P.eye.position).normalize();
  P.iris.position.copy(look).multiplyScalar(0.84);
  P.iris.quaternion.setFromUnitVectors(_b.set(0, 0, 1), look);
  const eg: number = ai.eyeGlow ?? 0;
  if (down || g.dead) { P.irisMat.emissiveIntensity = 0; }
  else {
    P.irisMat.emissive.setHex(g.phase === 2 || eg > 0 ? 0xff3a20 : 0x30d8ff);
    P.irisMat.color.setHex(g.phase === 2 || eg > 0 ? 0xffb0a0 : 0x9fe8ff);
    P.irisMat.emissiveIntensity = (g.phase === 2 ? 2.6 : 1.8) + eg * 3 + 0.4 * Math.sin(t * 6);
  }
  P.aura.visible = g.phase === 2 && !g.dead;
  if (P.aura.visible) {
    P.auraMat.opacity = 0.2 + 0.08 * Math.sin(t * 5) + (ai.roarT > 0 ? 0.25 : 0);
    P.aura.scale.setScalar((ai.roarT > 0 ? 3.6 : 2.6) + 0.15 * Math.sin(t * 4));
  }
  P.core.emissiveIntensity = g.regen ? P.core.emissiveIntensity : 1.1 + 0.3 * Math.sin(t * 3);
  // 瞬間移動：消える・現れるときは縮む
  const vk: number = ai.vanishK ?? 0;
  vis.scale.setScalar(Math.max(0.001, 1 - 0.0 * vk));
  if (vk > 0 && !ai.hidden) {
    vis.scale.set(1 - 0.35 * vk, 1 + 0.25 * vk, 1 - 0.35 * vk);
  }
  if (!down && ai.roarT > 0) { vis.rotation.x = -0.25 * Math.sin(Math.min(1, (D.roar - ai.roarT) / 0.3) * Math.PI / 2); vis.position.x = (rnd() - 0.5) * 0.08; }

  // ---- 当たり判定の球（毎フレーム、この見た目の位置から）
  e.root.rotation.y = ai.yaw ?? 0;
  e.root.position.copy(e.pos);
  e.root.updateMatrixWorld(true);
  e.hitSpheres = buildHitSpheres(e, g, ai.inert === true || ai.hidden === true || g.dead);
  void SPH;
}

function buildHitSpheres(e: Enemy, g: GuardState, off: boolean): HitSphere[] {
  if (off) return [];
  const P = partsOf(e);
  const out: HitSphere[] = [];
  const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  for (const a of ARMS) {
    if (g.arm[a] !== 'ok') continue;
    out.push({ part: a, pos: at(P[a].fist), radius: 1.6 });
    out.push({ part: a, pos: at(P[a].elbow), radius: 1.35 });
  }
  out.push({ part: 'body', pos: at(P.torso), radius: 3.0 });
  for (const l of P.legAnchors) out.push({ part: 'body', pos: at(l), radius: 1.9 });
  out.push({ part: 'body', pos: at(P.eye), radius: 1.3, weak: true });
  return out;
}
