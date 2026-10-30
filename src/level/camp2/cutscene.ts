// サージ収容所 2階：檻の扉を調べたときのムービー（cinematic/sequencer.ts の Cutscene で再生する）。
// ① 真横：プレイヤーが扉の錠前を左手でガチャガチャいじる
// ② 背後（ジェネレーターの後ろ）：ジェネレーターの後ろ姿が上から降りてくる。プレイヤーと一緒に映る
// ③ 左斜め後ろ：まだいじっている → 手を止める → 振り向いて真後ろを確かめる → 体ごと向き直る → 銃を構える
// ④ 首の後ろ：ジェネレーターに銃を向けた構図 → 通常の三人称カメラへなめらかにつなぐ
// プレイヤーの体は、毎フレーム updatePlayer（ポーズ計算）のあとに、ここで向き・頭・背骨・左腕を上書きする。
import * as THREE from 'three';
import type { World } from '../../core/types';
import { CHARACTER } from '../../config/balance';
import { buildModel, disposeObject, type Model } from '../../enemies/models';
import { getPlayerVisual, setPlayerFacing } from '../../player/player';
import { solveArm } from '../../player/pose';
import type { Runtime, Script, Shot } from '../../cinematic/sequencer';
import { BOSS_LAND, FIGHT_START, LOCK, STAND } from './layout';

/** ショットの長さ（秒） */
export const CUT = { side: 3.0, descend: 3.6, turn: 4.8, aim: 3.0 } as const;
export const CUT_TOTAL = CUT.side + CUT.descend + CUT.turn + CUT.aim;
/** ジェネレーターが降り始める高さ */
const BOSS_TOP = 16;
/** ②の終わりの高さ（そこから③の間にゆっくり BOSS_LAND.y まで下がる） */
const BOSS_MID = 5.0;

// ---- ③の中の動きの時刻（ムービー開始からの秒）
const T3 = CUT.side + CUT.descend;
const T4 = T3 + CUT.turn;
export const BEAT = {
  /** 錠前に手を伸ばし終える */
  reach: 0.35,
  /** 手を止める */
  freeze: T3 + 1.3,
  /** 振り向き始め・終わり */
  look0: T3 + 1.8, look1: T3 + 2.6,
  /** 体ごと向き直る */
  turn0: T3 + 2.9, turn1: T3 + 3.8,
  /** 銃を構える */
  aim: T3 + 3.8,
  /** ④：構えたまま扉から前へ出る（FIGHT_START まで） */
  step0: T4 + 0.2, step1: T4 + 2.4,
} as const;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const V = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]);
const POLE_L = V(CHARACTER.gun.poleL);

export interface Camp2CutProbe {
  /** 今の動き */
  beat: 'reach' | 'fiddle' | 'freeze' | 'look' | 'turn' | 'aim';
  bossY: number;
  facing: number;
}

/** ムービー中のジェネレーター（本物の敵ではなく、見た目だけの代役。戦闘開始で本物に入れ替える） */
function makeBossActor(world: World): Model {
  const m = buildModel('boss');
  m.root.name = 'camp2-boss-actor';
  m.root.position.set(BOSS_LAND.x, BOSS_TOP, BOSS_LAND.z);
  m.root.rotation.y = Math.atan2(STAND.x - BOSS_LAND.x, STAND.z - BOSS_LAND.z); // プレイヤーの方を向く（+Z が正面）
  for (const w of m.weakPoints) { w.exposed = false; w.mesh.visible = false; }
  m.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  m.root.visible = false;
  world.scene.add(m.root);
  return m;
}

export function camp2Script(rt: Runtime, probe?: Camp2CutProbe): Script {
  const world = rt.world;
  const actor = makeBossActor(world);
  const clock = { t: 0 };
  const lock = new THREE.Vector3(LOCK.x, LOCK.y, LOCK.z);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), head = new THREE.Vector3();
  const qs = new THREE.Quaternion(), qe = new THREE.Quaternion();
  const bossPos = () => actor.root.position;

  function bossY(T: number): number {
    if (T < CUT.side) return BOSS_TOP;
    if (T < T3) { const u = (T - CUT.side) / CUT.descend; return lerp(BOSS_TOP, BOSS_MID, 1 - (1 - u) * (1 - u)); }
    if (T < T4) return lerp(BOSS_MID, BOSS_LAND.y, smooth((T - T3) / CUT.turn));
    return BOSS_LAND.y + Math.sin((T - T4) * 2.2) * 0.08;
  }

  /** プレイヤーの体（updatePlayer のポーズ計算のあとに上書き） */
  function posePlayer(T: number): void {
    const p = world.player;
    // ④で構えたまま前（+Z＝ジェネレーターの方）へ歩み出る。vel を入れておくと歩きのアニメになる
    const stepU = clamp01((T - BEAT.step0) / (BEAT.step1 - BEAT.step0));
    const stepK = smooth(stepU);
    p.pos.set(STAND.x, 0, lerp(STAND.z, FIGHT_START.z, stepK));
    const stepV = stepU > 0 && stepU < 1 ? (6 * stepU * (1 - stepU) * (FIGHT_START.z - STAND.z)) / (BEAT.step1 - BEAT.step0) : 0;
    p.vel.set(0, 0, stepV);
    p.invuln = Math.max(p.invuln, 0.5);
    const turnK = smooth((T - BEAT.turn0) / (BEAT.turn1 - BEAT.turn0));
    const facing = STAND.yaw + turnK * Math.PI;           // 左回りに半回転（振り向いた側＝左へ）
    setPlayerFacing(world, facing);
    p.yaw = facing;
    p.pitch = lerp(0, FIGHT_START.pitch, turnK);
    p.root.position.copy(p.pos);
    world.level.data.poseAim = T >= BEAT.aim;
    if (probe) {
      probe.facing = facing;
      probe.beat = T < BEAT.reach ? 'reach' : T < BEAT.freeze ? 'fiddle' : T < BEAT.look0 ? 'freeze' : T < BEAT.turn0 ? 'look' : T < BEAT.aim ? 'turn' : 'aim';
    }
    const v = getPlayerVisual(world);
    // 裏で動く通常カメラが、振り向いた背中側（格子）に押し込まれると体を隠してしまうので、ムービー中は常に表示する
    v.body.visible = true;
    // 振り向く：頭と背骨をひねって左肩ごしに真後ろを見る。体が向き直るにつれ戻す
    const lookK = smooth((T - BEAT.look0) / (BEAT.look1 - BEAT.look0)) * (1 - turnK);
    const down = T < BEAT.look0 ? 0.28 * smooth(T / 0.5) * (T < BEAT.freeze ? 1 : 1 - smooth((T - BEAT.freeze) / 0.4) * 0.6) : 0;
    v.head.rotation.x += down;                           // 錠前を見下ろす
    v.head.rotation.y = 1.25 * lookK + (T < BEAT.freeze ? Math.sin(T * 9) * 0.04 : 0);
    v.spine.rotation.y += 0.6 * lookK;
    v.chest.rotation.y = 0.15 * lookK;
    p.root.updateMatrixWorld(true);

    // 左手で錠前をいじる（ガチャガチャ）→ 止める → 振り向くときに離す
    const w = smooth(T / BEAT.reach) * (1 - smooth((T - BEAT.look0) / 0.45));
    if (w <= 0.001) return;
    const armL = v.armL;
    tmp.copy(lock);
    if (T < BEAT.freeze) {
      const k = clamp01((T - BEAT.reach) / 0.3);
      tmp.x += (Math.sin(T * 23) * 0.035 + Math.sin(T * 41) * 0.015) * k;
      tmp.y += (Math.sin(T * 31) * 0.03 + Math.sin(T * 13) * 0.02) * k;
      tmp.z += Math.sin(T * 17) * 0.02 * k;
    } else {
      // 手を止めて、ほんの少し引く
      tmp.z += 0.04 * smooth((T - BEAT.freeze) / 0.3);
    }
    v.chest.worldToLocal(tmp);
    const S = armL.shoulder.position;
    const d = tmp.distanceTo(S);
    const stretch = Math.min(2, Math.max(1, (d / 0.97 - armL.fore) / armL.upper));
    solveArm(S, tmp, armL.upper * stretch, armL.fore, POLE_L, qs, qe);
    armL.shoulder.quaternion.slerp(qs, w);
    armL.elbow.quaternion.slerp(qe, w);
    const st = lerp(v.springStretch.value, stretch, w);
    v.springStretch.value = st;
    armL.elbow.position.y = -armL.upper * st;
  }

  const shots: Shot[] = [
    // ① 真横：プレイヤーと扉。錠前をいじる
    {
      name: '真横・扉をいじる', duration: CUT.side, shake: 0.15,
      camera(u, _t, pose) {
        pose.pos.set(lerp(5.0, 4.3, smooth(u)), 1.35, STAND.z - 0.35);
        pose.target.set(STAND.x - 0.1, 1.15, STAND.z - 0.4);
        pose.fov = 40;
        pose.roll = 0;
      },
    },
    // ② ジェネレーターの背後から：後ろ姿が上から降りてきて、扉の前のプレイヤーと一緒に映る
    {
      name: '背後・降下', duration: CUT.descend, shake: 0.3,
      enter() { actor.root.visible = true; rt.shake(0.15); },
      camera(u, _t, pose) {
        // ジェネレーターの背中側の近く・低い位置から見上げる：降りてくる後ろ姿が手前に大きく、奥に扉の前のプレイヤーが小さく
        pose.pos.set(lerp(1.7, 1.4, u), lerp(0.85, 1.1, u), BOSS_LAND.z + lerp(5.8, 5.2, u));
        pose.target.set(0.3, lerp(4.2, 3.3, smooth(u)), BOSS_LAND.z - 6);
        pose.fov = 58;
        pose.roll = 0;
      },
    },
    // ③ プレイヤーの左斜め後ろ：手を止めて振り向き、向き直って銃を構える
    {
      name: '左斜め後ろ・振り向く', duration: CUT.turn, shake: 0.2,
      camera(u, _t, pose) {
        pose.pos.set(STAND.x - lerp(2.2, 2.4, u), lerp(1.55, 1.6, u), STAND.z + lerp(2.1, 2.4, u));
        pose.target.set(STAND.x + 0.05, 1.3, STAND.z - 0.25);
        pose.fov = 42;
        pose.roll = 0;
      },
    },
    // ④ 首の後ろから：ジェネレーターに銃を向けた構図 → 三人称カメラへ
    {
      name: '首の後ろ・構える', duration: CUT.aim, shake: 0.12, caption: 'ボス：ジェネレーター',
      camera(u, _t, pose) {
        const v = getPlayerVisual(world);
        v.head.getWorldPosition(head);
        // プレイヤーは +Z（ジェネレーター）を向いている。首の後ろ＝-Z 側、右肩（-X）寄り
        tmp.set(head.x - 0.32, head.y + 0.12, head.z - 0.62);
        tmp2.copy(bossPos());
        // 後半は updatePlayer が置いた通常のカメラ（world.camera の今の位置・向き）へ寄せていく
        const k = smooth((u - 0.55) / 0.45);
        const cam = world.camera;
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        pose.pos.copy(tmp).lerp(cam.position, k);
        pose.target.copy(tmp2).lerp(fwd.multiplyScalar(10).add(cam.position), k);
        pose.fov = lerp(40, cam.fov, k);
        pose.roll = 0;
      },
    },
  ];

  return {
    shots,
    sim(simDt) {
      clock.t += simDt;
      const T = clock.t;
      // ジェネレーター（代役）
      actor.root.position.y = bossY(T);
      const parts = actor.parts as { orbit?: THREE.Object3D };
      if (parts.orbit) parts.orbit.rotation.y += simDt * 0.9;
      if (probe) probe.bossY = actor.root.position.y;
      posePlayer(T);
    },
    dispose() {
      world.scene.remove(actor.root);
      disposeObject(actor.root);
      world.level.data.poseAim = false;
    },
  };
}
