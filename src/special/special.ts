// 必殺技（電気のかめはめ波）の進行役。
//   ゲージ：ダメージ・撃破・吸収でたまる（logic.ts）。満タンで V（パッドは L スティック＋R スティック同時押し込み）。
//   ① 構え（速い）→ ② 溜め（スロー）→ ③ 発射（横から見せる）は Cutscene（黒帯・カメラ）で見せ、④ 照射は通常カメラで見せる。
//   ①〜③は敵・弾を止め、プレイヤーは操作不能・無敵。④もビームが消えるまで操作不能・無敵。
import * as THREE from 'three';
import { SPECIAL } from '../config/balance';
import type { Enemy, World } from '../core/types';
import type { EventBus } from '../core/events';
import { raycastLevel } from '../core/collision';
import { toast } from '../core/combat';
import { spawnBurst } from '../core/effects';
import { isTargetable } from '../core/enemyUtil';
import { damageEnemy } from '../enemies/enemies';
import { getPlayerVisual, setPlayerFacing } from '../player/player';
import { easeInOut } from '../player/specialPose';
import { Cutscene, type CamPose, type Runtime, type Script, type Shot } from '../cinematic/sequencer';
import { playSpecialBeam, playSpecialCharge, playSpecialFire, stopSpecialSfx } from '../audio/sfx';
import {
  beamRadius, consumeGauge, gainFromAbsorb, gainFromDamage, gainFromKill, isFull, pickTarget, pierceDamage, pierceTargets, targetDamage,
} from './logic';
import { SpecialVfx } from './vfx';

interface Run {
  world: World;
  target: Enemy;
  vfx: SpecialVfx;
  handle: Cutscene;
  /** 発射（ダメージ）を済ませたか */
  fired: boolean;
  /** ビームを出しているか */
  beamOn: boolean;
  onEnd?: () => void;
  /** 手のひらの間の位置（球・ビームの根元。毎フレーム更新） */
  mid: THREE.Vector3;
}

let run: Run | null = null;
/** 必殺技が input.locked を立てた（World が作り直されたとき自分で外すため） */
let lockedBySpecial = false;

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** ゲージをためる購読（敵へのダメージ・撃破）。吸収は updateSpecial が毎フレーム差分で見る。getWorld は今の World を返す */
export function initSpecialHooks(events: EventBus, getWorld: () => World): () => void {
  const offs = [
    events.on('enemyHit', (p) => { const w = getWorld(); if (w.state === 'playing') gainFromDamage(w, p.damage, p.weak); }),
    events.on('enemyKilled', () => { const w = getWorld(); if (w.state === 'playing') gainFromKill(w); }),
  ];
  return () => offs.forEach((o) => o());
}

/** ①〜③の間は、敵・弾・ステージの時間を止める */
export function specialFrozen(world: World): boolean {
  const ph = world.special.phase;
  return ph === 'pose' || ph === 'charge' || ph === 'fire';
}

/** 必殺技の最中（④まで含む） */
export const specialActive = (world: World): boolean => world.special.phase !== 'idle';

/** プレイヤーの目の高さ（狙いの始点） */
export function specialEye(world: World, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(world.player.pos.x, world.player.pos.y + 1.4, world.player.pos.z);
}

/** 撃つ：満タン（force=true なら無視）で、狙える敵がいれば始める。始まったら true */
export function startSpecial(world: World, opts: { target?: Enemy; force?: boolean; onEnd?: () => void; skippable?: boolean } = {}): boolean {
  const sp = world.special;
  const p = world.player;
  if (sp.phase !== 'idle' || run) return false;
  if (!opts.force && !isFull(world)) return false;
  const eye = specialEye(world);
  const target = opts.target ?? pickTarget(world, eye);
  if (!target) { toast(world, '近くに敵がいない', 1.6); return false; }

  consumeGauge(world);
  sp.dir.copy(target.pos).sub(eye).normalize();
  const yaw = Math.atan2(-sp.dir.x, -sp.dir.z);
  p.yaw = yaw; p.pitch = 0;
  setPlayerFacing(world, yaw);
  p.vel.x = p.vel.z = 0;
  p.charging = false; p.charge = 0; p.chargeSpent = 0; p.dodgeTimer = 0;
  world.input.locked = true;
  lockedBySpecial = true;
  sp.phase = 'pose'; sp.t = 0;

  const vfx = new SpecialVfx(world.scene);
  const r: Run = { world, target, vfx, handle: null as unknown as Cutscene, fired: false, beamOn: false, onEnd: opts.onEnd, mid: new THREE.Vector3() };
  r.handle = new Cutscene(world, (rt) => makeScript(rt, r), () => { sp.phase = 'beam'; sp.t = 0; }, { fadeIn: false, skippable: opts.skippable === true });
  run = r;
  return true;
}

/** 毎フレーム（プレイヤーの更新の後）。ゲージ・入力・演出の進行 */
export function updateSpecial(world: World, dt: number): void {
  // World が作り直された：古い演出の後始末
  if (run && run.world !== world) { cleanup(run, true); run = null; }
  const sp = world.special;
  if (world.state !== 'playing') return;
  if (sp.phase === 'idle') {
    if (lockedBySpecial) { world.input.locked = false; lockedBySpecial = false; }
    gainFromAbsorb(world);
    if (isFull(world)) handSparks(world, dt);
    const inp = world.input;
    if ((inp.pressed('KeyV') || inp.pressed('Special')) && !world.hack.active && !world.player.absorbing && world.player.hp > 0) {
      if (isFull(world)) startSpecial(world);
    }
    return;
  }
  const r = run;
  if (!r) { sp.phase = 'idle'; return; }
  const p = world.player;
  p.invuln = Math.max(p.invuln, 0.25);
  const vis = getPlayerVisual(world);

  if (sp.phase !== 'beam') {
    r.handle.update(world, dt);
    if (!r.handle.done) {
      const i = r.handle.shotIndex;
      sp.phase = i <= 0 ? 'pose' : i === 1 ? 'charge' : 'fire';
      sp.t = r.handle.shotTime;
    }
    vis.body.visible = true;
  } else {
    sp.t += dt;
  }

  // 手のひらの間
  vis.handR.group.getWorldPosition(_a);
  vis.handL.group.getWorldPosition(_b);
  r.mid.copy(_a).add(_b).multiplyScalar(0.5);
  if (sp.phase === 'charge') r.vfx.setBall(r.mid, easeInOut(sp.t / SPECIAL.charge));
  else if (!r.fired) r.vfx.setBall(r.mid, 0);
  if (r.beamOn) {
    r.vfx.setBeamOrigin(_a.copy(r.mid).addScaledVector(sp.dir, 0.12), sp.dir);
    r.vfx.setBeamFade(sp.phase === 'beam' ? Math.min(1, (SPECIAL.beam - sp.t) / 0.7) : 1);
  }
  r.vfx.update(dt);

  if (sp.phase === 'beam' && sp.t >= SPECIAL.beam) {
    cleanup(r, false);
    run = null;
  }
}

/** 終わり：光を消し、操作を戻す。stale=World が作り直された（音も止める） */
function cleanup(r: Run, stale: boolean): void {
  r.vfx.dispose();
  if (stale) stopSpecialSfx();
  const w = r.world;
  w.special.phase = 'idle';
  w.special.t = 0;
  w.special.muteGain = false;
  if (!stale) {
    w.input.locked = false;
    lockedBySpecial = false;
    w.player.invuln = Math.max(w.player.invuln, 0.4);
    r.onEnd?.();
  }
}

/** ゲージ満タンの間、手元にときどき電気の火花 */
function handSparks(world: World, dt: number): void {
  if (Math.random() > SPECIAL.handSparkRate * dt) return;
  const vis = getPlayerVisual(world);
  (Math.random() < 0.5 ? vis.handR : vis.handL).group.getWorldPosition(_a);
  spawnBurst(world, _a, Math.random() < 0.5 ? 0x9ff4ff : 0xffffff, 2, 1.8, 0.28);
}

/** 発射：狙った敵は即死（ボスは割合ダメージ）、ビームに触れた他の敵は最大HPの割合ダメージ */
function applyDamage(r: Run): void {
  const w = r.world;
  const eye = specialEye(w);
  w.special.muteGain = true;
  const hits = pierceTargets(w, eye, r.target, beamRadius(w));
  for (const e of [r.target, ...hits]) {
    if (!isTargetable(e)) continue;
    const dmg = e === r.target ? targetDamage(w, e) : pierceDamage(w, e);
    const shielded = e.shielded;
    e.shielded = false;   // 必殺技はガードを貫く
    damageEnemy(w, e, dmg, { how: 'explosion', hitPos: e.pos.clone().addScaledVector(w.special.dir, -1.2) });
    if (shielded && e.hp > 0) e.shielded = true;
    spawnBurst(w, e.pos, 0xbffaff, 16, 6, 0.6);
  }
  w.special.muteGain = false;
}

/** 発射の瞬間（演出から呼ぶ。スキップされた場合は complete から） */
function fireNow(r: Run, rt?: Runtime): void {
  if (r.fired) return;
  r.fired = true;
  const w = r.world;
  applyDamage(r);
  const dist = r.mid.distanceTo(r.target.pos);
  r.vfx.setBall(r.mid, 0);
  r.vfx.fireBeam(r.mid, w.special.dir, Math.min(SPECIAL.beamLength, dist + SPECIAL.beamOvershoot), beamRadius(w));
  r.beamOn = true;
  if (rt) { rt.flash(SPECIAL.flash, '#e8fdff'); rt.shake(SPECIAL.shake); }
  playSpecialFire();
  playSpecialBeam(SPECIAL.beam + SPECIAL.fireHold);
}

// ---------------------------------------------------------------- ムービー（カメラ）

/** カメラ位置 pos を、注視点 look から見て壁の手前までに押し戻して pose に入れる */
function place(r: Run, pose: CamPose, pos: THREE.Vector3, look: THREE.Vector3, fov: number): void {
  const t = raycastLevel(r.world.colliders, look, pos, { camera: true });
  if (t !== null && t < 1) pos.sub(look).multiplyScalar(Math.max(0.2, t - 0.05)).add(look);
  pose.pos.copy(pos);
  pose.target.copy(look);
  pose.fov = fov;
  pose.roll = 0;
}

function makeScript(rt: Runtime, r: Run): Script {
  const w = r.world;
  const C = SPECIAL.cam;
  const c = w.player.pos;
  const f = w.player.yaw;
  const fwd = new THREE.Vector3(-Math.sin(f), 0, -Math.cos(f));
  const right = new THREE.Vector3(Math.cos(f), 0, -Math.sin(f));
  const pos = new THREE.Vector3(), look = new THREE.Vector3();
  const lerp = THREE.MathUtils.lerp;
  const mk = (name: string, duration: number, camera: Shot['camera'], extra: Partial<Shot> = {}): Shot => ({ name, duration, camera, shake: 0.12, ...extra });

  // ① 構え：正面やや右から（こちらを向いたプレイヤーを見る）。じわっと寄る
  const pose = mk('構え・正面やや右', SPECIAL.pose, (u, _t, cam) => {
    pos.copy(c).addScaledVector(fwd, lerp(C.poseFwd, C.poseFwd - 0.5, u)).addScaledVector(right, C.poseRight).addScaledVector(UP, C.poseUp);
    look.copy(c).addScaledVector(UP, C.poseLook).addScaledVector(fwd, 0.2);
    place(r, cam, pos, look, C.fov);
  }, { shake: 0.05 });

  // ② 溜め：右側を前から後ろへ回り込む（右の腰の球が後ろから見える）。スローに始まりスローに終わる
  const charge = mk('溜め・右へ回り込む', SPECIAL.charge, (u, _t, cam) => {
    const th = THREE.MathUtils.degToRad(lerp(C.orbitFrom, C.orbitTo, easeInOut(u)));
    const dist = lerp(C.orbitDist, C.orbitDist - 0.5, easeInOut(u));
    pos.copy(c).addScaledVector(fwd, Math.cos(th) * dist).addScaledVector(right, Math.sin(th) * dist).addScaledVector(UP, C.orbitUp);
    look.copy(c).addScaledVector(UP, C.orbitLook).lerp(r.mid, 0.5);
    place(r, cam, pos, look, C.fov - 6 * u);
  }, { shake: 0.2 + 0.0, enter: () => { playSpecialCharge(SPECIAL.charge); } });

  // ③ 発射：プレイヤーの右側（ビームの向きに垂直）から見せる。ゆっくり引く
  const fire = mk('発射・真横', SPECIAL.fire + SPECIAL.fireHold, (u, _t, cam) => {
    pos.copy(c).addScaledVector(fwd, 1.3).addScaledVector(right, lerp(C.sideDist, C.sideDist + 0.9, u)).addScaledVector(UP, C.sideUp);
    look.copy(c).addScaledVector(fwd, 1.5).addScaledVector(UP, C.sideLook);
    place(r, cam, pos, look, C.fov + 4);
  }, { shake: 0.35, enter: () => fireNow(r, rt) });

  return {
    shots: [pose, charge, fire],
    sim() { /* 演出は時間を進めるだけ。世界は main.ts が止める */ },
    complete() { fireNow(r); },
    dispose() { /* 光は cleanup で片付ける */ },
  };
}
