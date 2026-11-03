// ドレイン装置の部屋：導入ムービー（cinematic/sequencer.ts の Cutscene で再生する）。9ショット。
// 「左斜め前」＝ライアンの前（北）で左（西）寄りのカメラが、ライアンの顔のほうを振り返って見る位置。
// 「左斜め後ろ」＝ライアンの後ろ（南）で左寄りのカメラ（肩ごし）。ライアンは北（-Z）を向いている。
//  ① 左斜め前：自動ドアがスライドして開き、ライアンがとことこ入ってくる（足音）
//  ② 左斜め後ろ・やや高め：モニターの壁とドレイン装置のほうへ歩く
//  ③ パン：左（モニターの壁）→右（ドレイン装置の全体）
//  ④ 左斜め前：銃を構えて溜め始める（溜めの光と音）
//  ⑤ 左斜め後ろ：溜めている間に天井がひび割れ、粉と破片が降る
//  ⑥ 左斜め前：溜めをやめて銃を下ろし、天井を見上げる
//  ⑦ 左斜め後ろ：天井が割れてボスがドスンと降ってくる（揺れ・砂ぼこり・着地音）
//  ⑧ ボスの後ろ上から：ボスが重い足取りで2歩、ライアンへ近づく（足音と小さな揺れ）
//  ⑨ 左斜め前：ライアンが銃を構える → 戦闘開始
// スキップしたときも complete() が同じ終了状態（ボスが着地・2歩進んだ位置、天井に穴とがれき、戦闘開始の位置）にする。
import * as THREE from 'three';
import type { Enemy, World } from '../../core/types';
import { getPlayerVisual, setPlayerFacing } from '../../player/player';
import type { Runtime, Script, Shot } from '../../cinematic/sequencer';
import type { DrainBossVisuals } from './visuals';
import { BOSS_FIGHT, BOSS_LAND, DOOR, FIGHT_START, HOLE, RYAN_STOP, STEP } from './layout';
import { FLOOR } from '../../enemies/kinds/drainGuardModel';

/** ショットの名前と長さ（ムービー一覧 tools/movieCatalog.ts もこれを読む） */
export const SHOTS = [
  { name: '左斜め前・自動ドアが開いて入ってくる', d: 3.8 },
  { name: '左斜め後ろ・モニターと装置へ歩く', d: 4.4 },
  { name: 'パン・左から右へドレイン装置を見渡す', d: 5.2 },
  { name: '左斜め前・銃を構えて溜める', d: 3.8 },
  { name: '左斜め後ろ・天井がひび割れる', d: 4.6 },
  { name: '左斜め前・溜めをやめて銃を下ろす', d: 2.4 },
  { name: '左斜め後ろ・ボスが降ってくる', d: 3.8 },
  { name: 'ボスの後ろ上から・重い2歩', d: 4.4 },
  { name: '左斜め前・銃を構える（戦闘開始）', d: 3.0 },
] as const;
export const BOSS_CUT_TOTAL = SHOTS.reduce((s, x) => s + x.d, 0);
const S: number[] = [];
{ let t = 0; for (const x of SHOTS) { S.push(t); t += x.d; } S.push(t); }

/** 時刻（ムービー開始からの秒） */
export const BEAT = {
  doorOpen0: 0.5, doorOpen1: 2.0,
  walkEnd: S[2],
  aim0: S[3] + 0.35, charge0: S[3] + 0.9, chargeFull: S[4] + 2.6, chargeEnd: S[5],
  lookUp0: S[4] + 3.2, lower: S[5] + 0.7,
  crack0: S[4], crack1: S[4] + 3.6, tilesBreak: S[6] + 0.3,
  land: S[6] + 0.3 + Math.sqrt((2 * (BOSS_TOP() - FLOOR)) / 30),
  step1: S[7] + 0.5, step2: S[7] + 1.9, stepDur: 0.85,
  aimEnd: S[8] + 0.5,
} as const;
function BOSS_TOP(): number { return 25; }

export interface BossCutProbe {
  shot: number; bossY: number; bossZ: number; doorK: number; charge: number; crack: number; ryanZ: number;
}
export const newBossCutProbe = (): BossCutProbe => ({ shot: 0, bossY: 0, bossZ: 0, doorK: 0, charge: 0, crack: 0, ryanZ: 0 });

export interface BossCutDeps {
  vis: DrainBossVisuals;
  /** ムービーの間 inert にして置いておく本物のボス（降りてくるまで非表示） */
  boss: Enemy;
  setDoor(k: number): void;
  probe?: BossCutProbe;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 戦闘開始の状態（ムービーの終わり・スキップ・リトライの共通）：ボスは2歩進んだ位置、ライアンは北向き */
export function applyFightStartState(world: World, vis: DrainBossVisuals, boss: Enemy | null): void {
  vis.setDoor(1);
  vis.setCrack(0);
  vis.breakTiles(true);
  vis.showRubble();
  const p = world.player;
  p.pos.set(FIGHT_START.x, 0, FIGHT_START.z);
  p.vel.set(0, 0, 0);
  p.yaw = FIGHT_START.yaw; p.pitch = FIGHT_START.pitch;
  p.charging = false; p.charge = 0; p.chargeSpent = 0;
  setPlayerFacing(world, FIGHT_START.yaw);
  world.level.data.poseAim = false;
  if (boss) {
    boss.pos.set(BOSS_FIGHT.x, FLOOR, BOSS_FIGHT.z);
    boss.vel.set(0, 0, 0);
    boss.root.position.copy(boss.pos);
    boss.root.visible = true;
    boss.ai.yaw = 0;
    boss.ai.crouch = 0;
    boss.ai.walk = 0;
    boss.ai.movieWalk = false;
    boss.ai.inert = false;
  }
}

export function drainBossScript(rt: Runtime, deps: BossCutDeps): Script {
  const world = rt.world;
  const { vis, boss, probe } = deps;
  const clock = { t: 0 };
  const R = world.player.pos;
  const lastFx = { crack: 0, dust: 0, step: [false, false], landed: false, tiles: false, chunkT: 0 };
  const tmp = new THREE.Vector3(), head = new THREE.Vector3();
  const panCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-31, 6, -30), new THREE.Vector3(-10, 6, -30), new THREE.Vector3(14, 6.5, -30),
    new THREE.Vector3(31, 6.5, -17), new THREE.Vector3(30, 6, -5),
  ], false, 'catmullrom', 0.3);

  /** ライアン：歩く・構える・溜める・見上げる */
  function poseRyan(T: number): void {
    const p = world.player;
    const walking = T < BEAT.walkEnd;
    const z0 = DOOR.z + 4, speed = (z0 - RYAN_STOP.z) / BEAT.walkEnd;
    p.pos.set(RYAN_STOP.x, 0, walking ? z0 - speed * T : RYAN_STOP.z);
    p.vel.set(0, 0, walking ? -speed : 0);
    p.onGround = true; p.flying = false;
    p.invuln = Math.max(p.invuln, 0.5);
    p.yaw = 0; p.pitch = 0;
    setPlayerFacing(world, 0);
    p.root.position.copy(p.pos);
    const aim = (T >= BEAT.aim0 && T < BEAT.lower) || T >= BEAT.aimEnd;
    world.level.data.poseAim = aim;
    // 溜め：光と音（updateAudio が p.charging を見て溜め音を鳴らす）
    const charging = T >= BEAT.charge0 && T < BEAT.chargeEnd;
    p.charging = charging;
    p.charge = charging ? clamp01((T - BEAT.charge0) / (BEAT.chargeFull - BEAT.charge0)) : 0;
    const v = getPlayerVisual(world);
    v.body.visible = true;
    // 天井を見上げる（この体は head.rotation.x が正で上を向く）
    const up = smooth((T - BEAT.lookUp0) / 0.5) * (1 - smooth((T - (BEAT.lower + 0.3)) / 0.6));
    v.head.rotation.x += 0.42 * up;
    p.root.updateMatrixWorld(true);
    if (probe) { probe.charge = p.charge; probe.ryanZ = p.pos.z; }
  }

  function bossAt(T: number): void {
    const b = boss;
    const ai = b.ai;
    ai.inert = true;
    ai.yaw = 0;
    if (T < BEAT.tilesBreak) { b.root.visible = false; b.pos.set(BOSS_LAND.x, BOSS_TOP(), BOSS_LAND.z); }
    else {
      b.root.visible = true;
      const tau = T - BEAT.tilesBreak;
      const y = Math.max(FLOOR, BOSS_TOP() - 15 * tau * tau);
      let z = BOSS_LAND.z;
      // 重い2歩
      let walking = false;
      for (const [i, t0] of [BEAT.step1, BEAT.step2].entries()) {
        const k = clamp01((T - t0) / BEAT.stepDur);
        z += STEP * smooth(k);
        if (k > 0 && k < 1) walking = true;
        if (k >= 0.5 && !lastFx.step[i]) {
          lastFx.step[i] = true;
          // 足が着く：小さな揺れと音
          rt.shake(0.28);
          world.events.emit('enemyAction', { kind: b.kind, pos: b.pos.clone(), action: 'gStep' });
          tmp.set(b.pos.x + (i ? 1.4 : -1.4), 0.2, b.pos.z + 1.4);
          rt.fx.dust(tmp, 4, 2.5, 0x8d8579, 0.9, 1.0);
        }
      }
      b.pos.set(BOSS_LAND.x, y, z);
      ai.walk = walking ? 2.6 : 0;
      ai.movieWalk = walking;
      // 着地：ドスン
      if (y <= FLOOR + 1e-6 && !lastFx.landed) {
        lastFx.landed = true;
        rt.shake(1);
        rt.flash(0.35, '#ffe9c4');
        tmp.set(b.pos.x, 0.3, b.pos.z);
        rt.fx.dust(tmp, 26, 9, 0x8d8579, 1.6, 2.2);
        rt.fx.dust(tmp, 12, 4, 0xb5ab9b, 3.2, 1.6);
        rt.fx.chunks(tmp, 20, 9, new THREE.Vector3(0, 1, 0), 0.15, 0.6, 1.8);
        rt.fx.spark(tmp, 24, 9, 0xffc866);
        rt.fx.flash(tmp.clone().setY(1.2), 8, 0xffe9c4, 0.3);
        world.events.emit('enemyAction', { kind: b.kind, pos: b.pos.clone(), action: 'gLand' });
        world.events.emit('explosion', { pos: b.pos.clone(), radius: 4 });
        ai.landT = 0;
      }
      if (lastFx.landed) {
        ai.landT = (ai.landT ?? 0) + 0.016;
      }
      ai.crouch = lastFx.landed ? Math.max(0, 1 - (T - BEAT.land) / 0.8) : 0;
    }
    b.root.position.copy(b.pos);
    if (probe) { probe.bossY = b.pos.y; probe.bossZ = b.pos.z; }
  }

  const rynFL = (pose: { pos: THREE.Vector3; target: THREE.Vector3 }, side = 2.3, ahead = 3.1, h = 1.55): void => {
    pose.pos.set(R.x - side, h, R.z - ahead);
    pose.target.set(R.x + 0.1, 1.38, R.z);
  };
  const rynBL = (pose: { pos: THREE.Vector3 }, side = 2.2, behind = 2.7, h = 1.6): void => {
    pose.pos.set(R.x - side, h, R.z + behind);
  };

  const shots: Shot[] = [
    // ① 左斜め前：ドアが開いて入ってくる。カメラは部屋の中の左寄りで、ドアと歩いてくるライアンを正面から
    {
      name: SHOTS[0].name, duration: SHOTS[0].d, shake: 0.15,
      camera(u, _t, pose) {
        pose.pos.set(-3.9, 1.6, Math.min(DOOR.z - 3.6, R.z - 3.4));
        pose.target.set(0.2 + 0.1 * u, 1.4, R.z - 0.2);
        pose.fov = 50; pose.roll = 0;
      },
    },
    // ② 左斜め後ろ・やや高め：歩く先にモニターの壁と、右にドレイン装置
    {
      name: SHOTS[1].name, duration: SHOTS[1].d, shake: 0.2,
      camera(u, _t, pose) {
        rynBL(pose, 3.0, 4.2, 2.4);
        pose.target.set(R.x + 5, 4.2, R.z - 15);
        pose.fov = 58; pose.roll = 0;
        void u;
      },
    },
    // ③ パン：左（モニターの壁）→ 右（ドレイン装置の全体）
    {
      name: SHOTS[2].name, duration: SHOTS[2].d, shake: 0.1,
      camera(u, _t, pose) {
        pose.pos.set(-6, 3.2, 27);
        panCurve.getPoint(smooth(u), pose.target);
        pose.fov = 62; pose.roll = 0;
      },
    },
    // ④ 左斜め前：銃を構えて溜める
    {
      name: SHOTS[3].name, duration: SHOTS[3].d, shake: 0.12,
      camera(u, _t, pose) {
        rynFL(pose, lerp(2.6, 2.1, smooth(u)), lerp(3.4, 2.9, smooth(u)));
        pose.fov = 42; pose.roll = 0;
      },
    },
    // ⑤ 左斜め後ろ：溜めている間に天井がひび割れ、粉と破片が降る
    {
      name: SHOTS[4].name, duration: SHOTS[4].d, shake: 0.35,
      camera(u, _t, pose) {
        rynBL(pose, 2.3, 2.5, 1.45);
        pose.target.set(0.6, lerp(5.5, 8.5, smooth(u)), 8);
        pose.fov = 72; pose.roll = 0;
      },
    },
    // ⑥ 左斜め前：溜めをやめて銃を下ろす（天井を見上げる）
    {
      name: SHOTS[5].name, duration: SHOTS[5].d, shake: 0.18,
      camera(u, _t, pose) {
        rynFL(pose, 2.3, 3.0, 1.45);
        pose.target.set(R.x + 0.1, lerp(1.5, 1.6, u), R.z);
        pose.fov = 42; pose.roll = 0;
      },
    },
    // ⑦ 左斜め後ろ：ボスが降ってくる
    {
      name: SHOTS[6].name, duration: SHOTS[6].d, shake: 0.3,
      camera(u, _t, pose) {
        rynBL(pose, 2.4, 2.6, 1.5);
        pose.target.set(0.5, lerp(7.5, 4.5, smooth(u)), 6);
        pose.fov = 66; pose.roll = 0;
      },
    },
    // ⑧ ボスの後ろ上から（ライアンも入る）：重い2歩
    {
      name: SHOTS[7].name, duration: SHOTS[7].d, shake: 0.2,
      camera(u, _t, pose) {
        const bz = boss.pos.z;
        pose.pos.set(BOSS_LAND.x + 15, 11.5, bz - 13);
        pose.target.set(0, 2.4, bz + (R.z - bz) * 0.62);
        pose.fov = 52; pose.roll = 0;
        void u;
      },
    },
    // ⑨ 左斜め前：銃を構える → 通常カメラへ
    {
      name: SHOTS[8].name, duration: SHOTS[8].d, shake: 0.12,
      camera(u, _t, pose) {
        rynFL(pose, lerp(2.2, 2.4, u), lerp(3.0, 2.8, u), 1.5);
        // 後半は通常の三人称カメラ（world.camera の今の位置・向き）へ寄せていく
        const k = smooth((u - 0.6) / 0.4);
        const cam = world.camera;
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        pose.pos.lerp(cam.position, k);
        pose.target.lerp(fwd.multiplyScalar(10).add(cam.position), k);
        pose.fov = lerp(42, cam.fov, k); pose.roll = 0;
      },
    },
  ];

  return {
    shots,
    sim(simDt) {
      clock.t += simDt;
      const T = clock.t;
      // ドア
      const dk = smooth((T - BEAT.doorOpen0) / (BEAT.doorOpen1 - BEAT.doorOpen0));
      deps.setDoor(dk);
      if (probe) { probe.doorK = dk; probe.shot = rt.shotIndex; }
      // 天井：ひび割れ → 破片と粉 → 割れる
      const ck = smooth((T - BEAT.crack0) / (BEAT.crack1 - BEAT.crack0));
      if (!vis.tilesBroken) vis.setCrack(ck);
      if (probe) probe.crack = ck;
      if (T >= BEAT.crack0 && T < BEAT.tilesBreak) {
        lastFx.dust -= simDt;
        lastFx.chunkT -= simDt;
        const intensity = T < BEAT.tilesBreak - 0.01 ? ck : 1;
        if (lastFx.dust <= 0) {
          lastFx.dust = 0.22 - 0.14 * intensity;
          tmp.set(HOLE.x + (Math.random() - 0.5) * 8, 19.2, HOLE.z + (Math.random() - 0.5) * 8);
          rt.fx.dust(tmp, 2, 2, 0x9a8f80, -2.2, 2.6);
          if (Math.random() < 0.5) world.events.emit('enemyAction', { kind: boss.kind, pos: tmp.clone(), action: 'gCrack' });
        }
        if (lastFx.chunkT <= 0 && ck > 0.25) {
          lastFx.chunkT = 0.5 - 0.35 * intensity;
          tmp.set(HOLE.x + (Math.random() - 0.5) * 8, 19.4, HOLE.z + (Math.random() - 0.5) * 8);
          rt.fx.chunks(tmp, 1 + Math.floor(intensity * 3), 2.2, new THREE.Vector3(0, -1, 0), 0.12, 0.45, 0.5);
          rt.shake(0.1 + 0.12 * intensity);
        }
      }
      if (T >= BEAT.tilesBreak && !lastFx.tiles) {
        lastFx.tiles = true;
        vis.breakTiles();
        rt.shake(0.6);
        rt.flash(0.15, '#ffffff');
        for (const c of vis.tileCenters) {
          tmp.copy(c).setY(19.6);
          rt.fx.dust(tmp, 3, 3, 0x9a8f80, -1.5, 2.4);
        }
        tmp.set(HOLE.x, 19.5, HOLE.z);
        rt.fx.chunks(tmp, 28, 5, new THREE.Vector3(0, -1, 0), 0.2, 0.8, 2.2);
        world.events.emit('enemyAction', { kind: boss.kind, pos: tmp.clone(), action: 'gCrack' });
        world.events.emit('explosion', { pos: tmp.clone(), radius: 5 });
      }
      poseRyan(T);
      bossAt(T);
    },
    complete() {
      applyFightStartState(world, vis, boss);
      deps.setDoor(1);
    },
    dispose() {
      world.level.data.poseAim = false;
      const p = world.player;
      p.charging = false; p.charge = 0;
    },
  };
}
