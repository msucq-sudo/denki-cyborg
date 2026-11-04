// 導入ムービー（cinematic/sequencer.ts の Cutscene で再生）。台詞の音声は public/assets/voice（cinematic/voice.ts）。
// ① 目覚め　：一人称で目覚めてスパークと話す → 半円・指立て・指さし・ビンタ・にらみ合い
// ② 乱入　　：天井からウォーカーが降りてくる → スパーク「やっちまいなさい！」（このあとチュートリアル1）
// ③ 的ボックス：モニターウォールの前へ移動 → 床から的ボックスが出てウォーカーが登場（このあとチュートリアル2）
// ④ 出発　　：スパーク「この建物の2階に…」（はい／いいえ）→ 「はい」は しゅっぱーつ、「いいえ」はハイキックを寸止め
// プレイヤーの体は毎フレーム updatePlayer のあと（レベルの tick の最後）にここで向き・頭を上書きする。
import * as THREE from 'three';
import type { Enemy, World } from '../../core/types';
import type { Spark, SparkPose } from '../../characters/spark';
import type { Runtime, Script, Shot } from '../../cinematic/sequencer';
import { voiceLen, voicePlaying } from '../../cinematic/voice';
import { getPlayerVisual, setPlayerFacing } from '../../player/player';
import { spawnBurst, spawnShockwave } from '../../core/effects';
import * as L from './layout';
import type { TargetBox } from './props';

export interface IntroStage {
  world: World;
  spark: Spark;
  /** ② チュートリアル1のウォーカー（降下口から着地点へ動かす） */
  walker?: Enemy;
  /** ③ 的ボックスと、その中から出てくる3体 */
  wall?: { boxes: TargetBox[]; walkers: Enemy[] };
  /** 天井の降下口（開閉の見た目） */
  hatch?: { open(k: number): void };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
/** スパークの向き（rotation.y）：(dx,dz) の方向を向く */
const sparkYaw = (dx: number, dz: number) => Math.atan2(dx, dz);
/** ライアンの向き（yaw）：(dx,dz) の方向を向く */
const ryanYaw = (dx: number, dz: number) => Math.atan2(-dx, -dz);

const EYE = new THREE.Vector3(L.RYAN.x, L.EYE_Y, L.RYAN.z);

function placeRyan(world: World, x: number, z: number, yaw: number): void {
  const p = world.player;
  p.pos.set(x, 0, z);
  p.vel.set(0, 0, 0);
  p.yaw = yaw;
  p.pitch = 0;
  setPlayerFacing(world, yaw);
  p.root.position.copy(p.pos);
  p.invuln = Math.max(p.invuln, 0.5);
}

function placeSpark(spark: Spark, x: number, z: number, yaw: number, pose?: SparkPose, speed?: number): void {
  spark.root.position.set(x, 0, z);
  spark.root.rotation.y = yaw;
  if (pose) spark.setPose(pose, speed);
}

/** ライアンの一人称（西向きを基準に、右へ φ・上へ θ）。dir を target に入れる */
function firstPerson(pose: { pos: THREE.Vector3; target: THREE.Vector3; fov: number; roll: number }, from: THREE.Vector3, phi: number, theta: number, fov = 62): void {
  pose.pos.copy(from);
  pose.target.set(from.x - Math.cos(phi) * Math.cos(theta), from.y + Math.sin(theta), from.z - Math.sin(phi) * Math.cos(theta));
  pose.fov = fov;
  pose.roll = 0;
}

/** 道筋（折れ線）上を、全長の割合 k（0..1）で進んだ位置と向き */
export function alongPath(pts: readonly [number, number][], k: number): { x: number; z: number; dx: number; dz: number } {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); lens.push(l); total += l; }
  let d = clamp01(k) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const u = lens[i] > 0 ? Math.min(1, d / lens[i]) : 1;
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      return { x: lerp(ax, bx, u), z: lerp(az, bz, u), dx: (bx - ax) / (lens[i] || 1), dz: (bz - az) / (lens[i] || 1) };
    }
    d -= lens[i];
  }
  return { x: pts[0][0], z: pts[0][1], dx: 1, dz: 0 };
}

/** ライアンの頭を指定方向（ワールドの方位）へ向ける。体の向き yaw との差（±1.3 まで） */
function headToward(world: World, bodyYaw: number, targetYaw: number, k = 0.85): number {
  return Math.max(-1.3, Math.min(1.3, wrap(targetYaw - bodyYaw))) * k;
}

/** 台詞の間だけ口を動かす（音声が無い環境でもショット中は動かす） */
function talkMouth(spark: Spark, on: boolean): void {
  spark.setSpeaking(on);
}

// =====================================================================================
// ① 目覚め
// =====================================================================================
const W = {
  dark: voiceLen('1-1_spark', 1.0), wake: 5.4, cheer: voiceLen('1-3_spark', 0.9), look: voiceLen('1-4_ryan', 0.7),
  arc: voiceLen('1-5_spark', 0.5), finger: voiceLen('1-6_spark', 0.4), point: voiceLen('1-7_spark', 0.5),
  ask: voiceLen('1-8_ryan', 0.4), slap: voiceLen('1-9_spark', 1.0), glare: voiceLen('1-11_ryan', 0.5), placate: voiceLen('1-12_spark', 0.6),
} as const;
export const WAKE_TOTAL = Object.values(W).reduce((a, b) => a + b, 0);

export function wakeScript(rt: Runtime, st: IntroStage): Script {
  const { world, spark } = st;
  const S = { t: 0 };
  const blink = { a: false, b: false, c: false };
  const hit = { done: false };
  const C = new THREE.Vector3(L.RYAN.x, 0, L.RYAN.z);
  const sparkFront = { x: L.RYAN.x - 1.05, z: 0 };
  const tmp = new THREE.Vector3();

  const speakerPose = (pose: SparkPose, speed?: number) => spark.setPose(pose, speed);

  const shots: Shot[] = [
    // 1-1 暗闇：目を閉じている。スパークの声だけ
    {
      name: '1-1 暗闇', duration: W.dark, voice: '1-1_spark', caption: 'スパーク「やっと完成、今度は動くかしら」', shake: 0,
      enter() { S.t = 0; rt.fadeTo(1, 0); placeSpark(spark, L.SPARK_START.x, L.SPARK_START.z, 0, 'idle'); },
      camera(_u, _t, pose) { pose.pos.set(L.RYAN.x + 0.5, 1.05, 0); pose.target.set(L.RYAN.x + 0.5, 2.6, 0); pose.fov = 62; pose.roll = 0; },
    },
    // 1-2 まばたき → 目が開く → 起き上がる → 左右を見る → 右にスパーク（ゆっくり）
    {
      name: '1-2 目覚め', duration: W.wake, shake: 0.1,
      enter() { S.t = 0; blink.a = blink.b = blink.c = false; rt.fadeTo(1, 0); },
      camera(_u, t, pose) {
        if (!blink.a && t > 0.5) { blink.a = true; rt.fadeTo(0.45, 0.45); }
        if (!blink.b && t > 1.3) { blink.b = true; rt.fadeTo(1, 0.14); }
        if (!blink.c && t > 1.55) { blink.c = true; rt.fadeTo(0, 0.6); }
        const rise = smooth(seg(t, 1.9, 4.0));
        const pos = tmp.set(lerp(L.RYAN.x + 0.5, L.RYAN.x, rise), lerp(1.05, L.EYE_Y, rise), 0);
        // 見上げる → 正面 → 左（スパークと反対）→ 右（スパーク）
        const theta = lerp(1.35, 0, rise);
        const phi = t < 4.0 ? 0 : t < 4.7 ? lerp(0, -0.8, smooth(seg(t, 4.0, 4.7))) : lerp(-0.8, 0.85, smooth(seg(t, 4.7, 5.4)));
        firstPerson(pose, pos, phi, theta);
      },
    },
    // 1-3 やった♪（スパークが静かに喜ぶ）
    {
      name: '1-3 喜ぶ', duration: W.cheer, voice: '1-3_spark', caption: 'スパーク「やった♪」',
      enter() { S.t = 0; speakerPose('cheer', 3); },
      camera(_u, _t, pose) {
        firstPerson(pose, EYE, 0.85, -0.05);
        pose.target.set(L.SPARK_START.x, 1.4, L.SPARK_START.z);
      },
    },
    // 1-4 ここは？おれはなんだ？（周囲を見る）
    {
      name: '1-4 周囲を見る', duration: W.look, voice: '1-4_ryan', caption: 'ライアン「ここは？おれはなんだ？」',
      enter() { S.t = 0; speakerPose('idle', 3); },
      camera(_u, t, pose) {
        const phi = t < 1.6 ? lerp(0.85, -0.7, smooth(t / 1.6)) : lerp(-0.7, 0.15, smooth(seg(t, 1.6, 3.0)));
        firstPerson(pose, EYE, phi, -0.04);
      },
    },
    // 1-5 左肩の後ろから：スパークがライアンの右 → 前 → 左へ半円を回りながら語る
    {
      name: '1-5 半円', duration: W.arc, voice: '1-5_spark', caption: 'スパーク「あなたはわたしがつくった最強サイボーグ♪ こんなのを3日で作り上げちゃうなんて、わたしって天才！」',
      enter() { S.t = 0; speakerPose('talk', 5); spark.setGait(0.5); },
      camera(_u, _t, pose) {
        const v = getPlayerVisual(world);
        pose.pos.set(L.RYAN.x + 1.3, 1.78, 0.62);
        v.head.getWorldPosition(tmp);
        pose.target.set(lerp(tmp.x, spark.root.position.x, 0.62), 1.35, lerp(tmp.z, spark.root.position.z, 0.62));
        pose.fov = 46;
        pose.roll = 0;
      },
    },
    // 1-6 一人称：スパーク上半身。「ただ一つ！」で指を立てて顔を近づける
    {
      name: '1-6 指を立てる', duration: W.finger, voice: '1-6_spark', caption: 'スパーク「あなたの任務は…ただ一つ！私を守ること！」',
      enter() { S.t = 0; spark.setGait(0); placeSpark(spark, sparkFront.x - 0.25, 0, Math.PI / 2, 'talk', 6); },
      camera(_u, t, pose) {
        firstPerson(pose, EYE, 0, 0, 52);
        pose.target.set(spark.root.position.x, 1.42, spark.root.position.z);
        pose.pos.x -= 0.05 * smooth(seg(t, 1.3, 2.4));
      },
    },
    // 1-7 遠くを指さして決めポーズ
    {
      name: '1-7 指さし', duration: W.point, voice: '1-7_spark', caption: 'スパーク「そして、火星を救うこと」',
      enter() { S.t = 0; placeSpark(spark, sparkFront.x - 0.1, 0, Math.PI / 2, 'talk', 6); },
      camera(u, _t, pose) {
        firstPerson(pose, EYE, 0, 0, lerp(54, 46, smooth(u)));
        pose.target.set(spark.root.position.x, lerp(1.4, 1.5, smooth(u)), spark.root.position.z);
      },
    },
    // 1-8 スパークの右後方から：ライアンが顔を傾けて質問（スパークは腰に手）
    {
      name: '1-8 それって2つ？', duration: W.ask, voice: '1-8_ryan', caption: 'ライアン「それって２つじゃねぇのか？」',
      enter() { S.t = 0; placeSpark(spark, sparkFront.x, 0, Math.PI / 2, 'hips', 5); },
      camera(u, _t, pose) {
        pose.pos.set(spark.root.position.x - 1.3, 1.72, 1.6);
        pose.target.set(L.RYAN.x - 0.6, 1.45, 0);
        pose.fov = lerp(40, 36, smooth(u));
        pose.roll = 0;
      },
    },
    // 1-9 うるさい！＋ビンタ（同時）→ ライアンが右を向く
    {
      name: '1-9 ビンタ', duration: W.slap, voice: '1-9_spark', caption: 'スパーク「うるさ〜い！」', shake: 0.15,
      enter() { S.t = 0; hit.done = false; speakerPose('slapWind', 10); },
      camera(u, _t, pose) {
        pose.pos.set(spark.root.position.x - 1.3, 1.72, 1.6);
        pose.target.set(L.RYAN.x - 0.6, 1.45, 0);
        pose.fov = lerp(40, 36, smooth(u));
        pose.roll = 0;
      },
    },
    // 1-11 真横：にらみ合い
    {
      name: '1-11 にらみ合い', duration: W.glare, voice: '1-11_ryan', caption: 'ライアン「なにすんだよ！てめぇ！」',
      enter() { S.t = 0; placeSpark(spark, L.RYAN.x - 0.9, 0, Math.PI / 2, 'hips', 5); },
      camera(u, _t, pose) {
        pose.pos.set(lerp(-2.25, -2.1, u), 1.5, 3.7);
        pose.target.set(-2.1, 1.35, 0);
        pose.fov = 38;
        pose.roll = 0;
      },
    },
    // 1-12 まあまあ
    {
      name: '1-12 まあまあ', duration: W.placate, voice: '1-12_spark', caption: 'スパーク「まあまあ」',
      enter() { S.t = 0; speakerPose('placate', 7); },
      camera(u, _t, pose) {
        pose.pos.set(lerp(-2.1, -2.2, u), 1.48, 3.5);
        pose.target.set(-2.1, 1.35, 0);
        pose.fov = lerp(38, 34, smooth(u));
        pose.roll = 0;
      },
    },
  ];

  /** 毎フレーム：スパークとライアンの動き（updatePlayer のあと） */
  function pose(simDt: number): void {
    S.t += simDt;
    const t = S.t;
    const idx = rt.shotIndex;
    const v = getPlayerVisual(world);
    const inFirstPerson = idx <= 3 || idx === 5 || idx === 6;   // 1-1〜1-4・1-6・1-7 はライアンの目線（体は隠す）
    placeRyan(world, L.RYAN.x, L.RYAN.z, L.RYAN.yaw);
    v.body.visible = !inFirstPerson;
    v.head.rotation.z = 0;
    const lipSync = voicePlaying();
    talkMouth(spark, lipSync && !(idx === 3 || idx === 7 || idx === 9));   // ライアンの台詞（1-4・1-8・1-11）の間はスパークは黙る

    if (idx === 4) {
      // 半円：右（-Z）→ 前（西）→ 左（+Z）
      const a = Math.PI * smooth(t / (W.arc - 0.9));
      const x = C.x - L.ARC_R * Math.sin(a), z = C.z - L.ARC_R * Math.cos(a);
      const tx = -Math.cos(a), tz = Math.sin(a);                         // 進行方向
      const toC = sparkYaw(C.x - x, C.z - z);
      const along = sparkYaw(tx, tz);
      spark.root.position.set(x, 0, z);
      spark.root.rotation.y = along + wrap(toC - along) * 0.5;
      v.head.rotation.y = headToward(world, L.RYAN.yaw, ryanYaw(x - C.x, z - C.z));
      if (t > W.arc - 0.9) spark.setGait(0);
    } else if (idx === 5) {
      // 「ただ一つ！」で人差し指を立て、顔を近づける
      if (t > 1.3) spark.setPose('fingerUp', 8);
      const k = smooth(seg(t, 1.3, 2.6));
      placeSpark(spark, lerp(sparkFront.x - 0.25, sparkFront.x + 0.05, k), 0, Math.PI / 2);
    } else if (idx === 6) {
      if (t > 0.35) spark.setPose('point', 7);
    } else if (idx === 7) {
      v.head.rotation.z = 0.32 * smooth(seg(t, 0.4, 1.0));
      v.head.rotation.y = headToward(world, L.RYAN.yaw, ryanYaw(-1, 0)) * 0.3;
    } else if (idx === 8) {
      // 振りかぶり → ビンタ（振り抜く）。当たった瞬間にライアンの顔が右へ飛ぶ
      if (t > 0.3) spark.setPose('slap', 24);
      const step = smooth(seg(t, 0.2, 0.5));
      spark.root.position.x = lerp(sparkFront.x, sparkFront.x + 0.35, step);
      if (!hit.done && t > 0.45) {
        hit.done = true;
        rt.shake(0.7);
        rt.flash(0.25);
        spawnBurst(world, new THREE.Vector3(L.RYAN.x - 0.15, 1.55, 0), 0xffffff, 8, 2.5, 0.25);
      }
      const hk = smooth(seg(t, 0.45, 0.6));
      v.head.rotation.y = -1.0 * hk + 0.15 * smooth(seg(t, 0.8, 1.6));
      v.head.rotation.z = 0.2 * hk;
    } else if (idx === 9) {
      // 顔を戻してにらみ返す
      const k = smooth(seg(t, 0.2, 0.9));
      v.head.rotation.y = lerp(-0.4, 0, k);
      v.spine.rotation.x = -0.05 * k;
      spark.root.position.x = sparkFront.x + 0.35;
    } else if (idx === 10) {
      spark.root.position.x = sparkFront.x + 0.35;
    } else if (idx <= 3) {
      spark.root.position.set(L.SPARK_START.x, 0, L.SPARK_START.z);
      spark.root.rotation.y = 0;
    }
  }

  return {
    shots,
    sim(simDt) { spark.update(simDt); pose(simDt); },
    complete() {
      spark.setGait(0);
      spark.setSpeaking(false);
      placeRyan(world, L.RYAN.x, L.RYAN.z, L.RYAN.yaw);
      placeSpark(spark, L.RYAN.x - 0.9, 0, Math.PI / 2, 'placate');
      getPlayerVisual(world).body.visible = true;
    },
    dispose() { spark.setSpeaking(false); spark.setGait(0); },
  };
}

// =====================================================================================
// ② ウォーカー乱入（天井から）
// =====================================================================================
const WK = { drop: 3.4, behind: 2.8, shout: voiceLen('2-3_spark', 0.7) } as const;

export function walkerScript(rt: Runtime, st: IntroStage): Script {
  const { world, spark } = st;
  const S = { t: 0 };
  const fx = { open: false, landed: false };
  const sp = { x: L.RYAN.x - 0.9, z: 0 };
  const hitPos = new THREE.Vector3(L.DROP.x, 0.05, L.DROP.z);

  const shots: Shot[] = [
    // 2-1 真横：天井が開いてウォーカーが降りてくる。2人は向き合いから横を向く
    {
      name: '2-1 乱入', duration: WK.drop, shake: 0.2,
      enter() { S.t = 0; fx.open = false; fx.landed = false; spark.setPose('hips', 5); },
      camera(u, _t, pose) {
        pose.pos.set(-6.3, 1.65, 0.6);
        pose.target.set(-2.0, lerp(1.2, 1.6, smooth(u)), 1.5);
        pose.fov = 50;
        pose.roll = 0;
      },
    },
    // 2-2 ウォーカーの背後：ウォーカーの背中と、向こうのライアンとスパーク
    {
      name: '2-2 背後', duration: WK.behind, shake: 0.12,
      enter() { S.t = 0; spark.setPose('idle', 6); },
      camera(u, _t, pose) {
        pose.pos.set(L.DROP.x - 0.25 + 0.5 * u, 1.9, L.DROP.z + 1.9);
        pose.target.set(-2.0, 1.25, 0);
        pose.fov = 44;
        pose.roll = 0;
      },
    },
    // 2-3 スパークにクローズアップ：「さあ！ライアン！やっちまいなさい！」
    {
      name: '2-3 やっちまいなさい', duration: WK.shout, voice: '2-3_spark', caption: 'スパーク「さあ！ライアン！やっちまいなさい！」',
      enter() { S.t = 0; spark.setPose('command', 9); },
      camera(u, _t, pose) {
        pose.pos.set(sp.x + 0.62 - 0.1 * u, 1.62, 1.15);
        pose.target.set(sp.x, 1.55, 0);
        pose.fov = lerp(34, 30, smooth(u));
        pose.roll = 0.02;
      },
    },
  ];

  function pose(simDt: number): void {
    S.t += simDt;
    const t = S.t;
    const idx = rt.shotIndex;
    const v = getPlayerVisual(world);
    v.body.visible = true;
    v.head.rotation.z = 0;
    // 2人が向き合い（東西）→ 降下口の方（+Z）を向く
    const turn = idx === 0 ? smooth(seg(t, 0.55, 1.4)) : 1;
    const ryanY = lerp(L.RYAN.yaw, Math.PI, turn);
    placeRyan(world, L.RYAN.x, L.RYAN.z, ryanY);
    const sY = lerp(Math.PI / 2, 0, turn);
    placeSpark(spark, sp.x, sp.z, sY);
    spark.setSpeaking(voicePlaying());

    // 降下：天井が開き、ウォーカーが落ちてくる
    const e = st.walker;
    if (idx === 0 && e) {
      if (!fx.open && t > 0.15) { fx.open = true; st.hatch?.open(1); spawnBurst(world, new THREE.Vector3(L.DROP.x, 3.3, L.DROP.z), 0x9ff4ff, 16, 4, 0.5); }
      const k = seg(t, 0.8, 1.45);
      const y = L.DROP.y * (1 - k * k);
      e.pos.set(L.DROP.x, y, L.DROP.z);
      e.root.position.copy(e.pos);
      e.ai.yaw = ryanYaw(0, 1) + Math.PI;     // 部屋の中心（-Z）を向く
      if (!fx.landed && k >= 1) {
        fx.landed = true;
        rt.shake(0.6);
        spawnShockwave(world, hitPos, 0xffe08a, 3.2, 0.5);
        spawnBurst(world, hitPos, 0x9ff4ff, 14, 5, 0.5);
      }
    }
    if (idx >= 1 && e) { e.pos.set(L.DROP.x, 0, L.DROP.z); e.root.position.copy(e.pos); }
    if (idx === 1) st.hatch?.open(1);
  }

  return {
    shots,
    sim(simDt) { spark.update(simDt); pose(simDt); },
    complete() {
      placeRyan(world, L.RYAN.x, L.RYAN.z, Math.PI);
      placeSpark(spark, sp.x, sp.z, 0, 'command');
      if (st.walker) { st.walker.pos.set(L.DROP.x, 0, L.DROP.z); st.walker.root.position.copy(st.walker.pos); }
      st.hatch?.open(1);
    },
    dispose() { spark.setSpeaking(false); },
  };
}

// =====================================================================================
// ③ モニターウォール：床から的ボックスが出て、ウォーカーが登場
// =====================================================================================
const M = {
  cheer: voiceLen('3-1_spark', 0.9), walk: 5.6, rise: 3.7, like: voiceLen('3-3_ryan', 0.5), look: 1.8,
  inv: voiceLen('3-5_spark', 0.5), what: voiceLen('3-6_ryan', 0.5), pistol: voiceLen('3-7_spark', 0.4), hand: 2.0,
  arm: voiceLen('3-9_spark', 0.4), roger: voiceLen('3-10_ryan', 0.5), grap: voiceLen('3-11_spark', 0.5),
} as const;

export function wallScript(rt: Runtime, st: IntroStage): Script {
  const { world, spark } = st;
  const S = { t: 0 };
  const tmp = new THREE.Vector3();
  const rz = L.AT_WALL.ryan, sz = L.AT_WALL.spark;
  const cheered = { a: false };
  const WALK = M.walk;
  const boxFx = { rose: [false, false, false], landed: [false, false, false] };

  /** 的ボックスの動き（t = 的ボックスのショットに入ってからの時間）：せり上がる → 扉が開く → ウォーカーが出てくる → ボックスは床へ戻る */
  function boxes(t: number): void {
    const wall = st.wall;
    if (!wall) return;
    for (let i = 0; i < wall.boxes.length; i++) {
      const t0 = i * 0.25;
      const box = wall.boxes[i];
      const e = wall.walkers[i];
      box.setRise(smooth(seg(t, t0, t0 + 0.9)) * (1 - smooth(seg(t, t0 + 2.35, t0 + 3.05))));
      box.setOpen(smooth(seg(t, t0 + 0.9, t0 + 1.4)) * (1 - smooth(seg(t, t0 + 2.3, t0 + 2.6))));
      const out = smooth(seg(t, t0 + 1.2, t0 + 2.3));
      if (e) {
        e.pos.set(WALL.x + 0.15 - out * (L.WALL.walkOut + 0.15), 0, L.WALL.zs[i]);
        e.root.position.copy(e.pos);
        e.root.visible = t > t0 + 0.9;
        e.ai.yaw = -Math.PI / 2;
      }
      if (!boxFx.rose[i] && t > t0 + 0.05) { boxFx.rose[i] = true; spawnShockwave(world, new THREE.Vector3(WALL.x, 0.05, L.WALL.zs[i]), 0x7fe8ff, 1.8, 0.45); }
      if (!boxFx.landed[i] && t > t0 + 2.3) { boxFx.landed[i] = true; spawnBurst(world, new THREE.Vector3(WALL.x - L.WALL.walkOut, 0.1, L.WALL.zs[i]), 0x9ff4ff, 8, 3, 0.4); }
    }
  }
  const WALL = { x: L.WALL.x };

  const shots: Shot[] = [
    // 3-1 斜めから：スパークが近づく
    {
      name: '3-1 やったね', duration: M.cheer, voice: '3-1_spark', caption: 'スパーク「やったね♪」',
      enter() { S.t = 0; cheered.a = false; spark.setPose('idle', 6); },
      camera(u, _t, pose) {
        pose.pos.set(lerp(-3.7, -3.5, u), 1.7, 0.1);
        pose.target.set(-3.65, 1.2, -2.2);
        pose.fov = 46;
        pose.roll = 0;
      },
    },
    // 3-2 上から：2人がモニターウォールへ歩く
    {
      name: '3-2 こっちに来て', duration: WALK, voice: '3-2_spark', caption: 'スパーク「こっちに来て」',
      enter() { S.t = 0; spark.setGait(0.55); },
      camera(u, _t, pose) {
        pose.pos.set(lerp(-1.5, 1.6, smooth(u)), 7.2, 2.4);
        pose.target.set(lerp(-2.5, 3.2, smooth(u)), 0, -1.0);
        pose.fov = 46;
        pose.roll = 0;
      },
    },
    // 3-3a ライアンの後ろ：床から的ボックスが出てきて、ウォーカーが登場
    {
      name: '3-3a 的ボックス', duration: M.rise, shake: 0.2,
      enter() { S.t = 0; spark.setGait(0); },
      camera(u, _t, pose) {
        pose.pos.set(rz.x - 1.2, 1.75, rz.z + 0.7 + 0.3 * u);
        pose.target.set(WALL.x - 0.7, 1.1, 0);
        pose.fov = 54;
        pose.roll = 0;
      },
    },
    // 3-3 さっきのやつと一緒か
    {
      name: '3-3 一緒か', duration: M.like, voice: '3-3_ryan', caption: 'ライアン「さっきのやつと一緒か」',
      enter() { S.t = 0; },
      camera(u, _t, pose) {
        pose.pos.set(rz.x - 1.2 + 0.2 * u, 1.72, rz.z + 0.8);
        pose.target.set(WALL.x - 0.7, 1.2, 0);
        pose.fov = lerp(52, 48, smooth(u));
        pose.roll = 0;
      },
    },
    // 3-4 ライアンの右斜め前からウォーカーを映す
    {
      name: '3-4 ウォーカーを見る', duration: M.look,
      enter() { S.t = 0; },
      camera(u, _t, pose) {
        pose.pos.set(rz.x + 0.1, 1.45, 3.5);
        pose.target.set(WALL.x - 1.5, 1.0, lerp(-1.5, 1.5, smooth(u)));
        pose.fov = 40;
        pose.roll = 0;
      },
    },
    // 3-5 一人称：スパーク「コイツラが火星を侵略しているの」
    {
      name: '3-5 侵略', duration: M.inv, voice: '3-5_spark', caption: 'スパーク「コイツラが火星を侵略しているの」',
      enter() { S.t = 0; spark.setPose('talk', 5); },
      camera(_u, _t, pose) { fpAtWall(pose, 52); },
    },
    // 3-6 ライアンの右斜め前：顔を傾ける
    {
      name: '3-6 侵略？', duration: M.what, voice: '3-6_ryan', caption: 'ライアン「侵略？」',
      enter() { S.t = 0; },
      camera(u, _t, pose) {
        pose.pos.set(rz.x + 1.0, 1.6, rz.z + 1.05);
        pose.target.set(rz.x, 1.58, rz.z);
        pose.fov = lerp(34, 31, smooth(u));
        pose.roll = 0;
      },
    },
    // 3-7 一人称：ピストルで攻撃できる
    {
      name: '3-7 ピストル', duration: M.pistol, voice: '3-7_spark', caption: 'スパーク「あなたのピストルで敵を攻撃できるわ」',
      enter() { S.t = 0; spark.setPose('talk', 5); },
      camera(_u, _t, pose) { fpAtWall(pose, 52); },
    },
    // 3-8 一人称：右手のピストルを見る → 近づけて向きを変える
    {
      name: '3-8 右手のピストル', duration: M.hand,
      enter() { S.t = 0; },
      camera(u, _t, pose) {
        const eye = tmp.set(rz.x, L.EYE_Y, rz.z).clone();
        pose.pos.copy(eye);
        // 右手（東向きの右＝+Z）のほうを見下ろす
        const k = smooth(seg(u, 0, 0.35)) * (1 - 0.4 * smooth(seg(u, 0.7, 1)));
        pose.target.set(eye.x + 0.7, eye.y - 0.55 * k, eye.z + 0.35 * k);
        pose.fov = lerp(60, 44, smooth(seg(u, 0.35, 0.9)));
        pose.roll = 0.05 * Math.sin(u * 6);
      },
    },
    // 3-9 一人称：左手のアームで電力を奪って
    {
      name: '3-9 左手のアーム', duration: M.arm, voice: '3-9_spark', caption: 'スパーク「でも電力には限りがあるの、だからあなたの左手のアームで、コイツラから電力を奪って」',
      enter() { S.t = 0; spark.setPose('talk', 5); },
      camera(_u, _t, pose) { fpAtWall(pose, 52); },
    },
    // 3-10 右斜め前：了解だ
    {
      name: '3-10 了解だ', duration: M.roger, voice: '3-10_ryan', caption: 'ライアン「了解だ」',
      enter() { S.t = 0; },
      camera(u, _t, pose) {
        pose.pos.set(rz.x + 1.05, 1.6, rz.z + 1.0);
        pose.target.set(rz.x, 1.58, rz.z);
        pose.fov = lerp(36, 33, smooth(u));
        pose.roll = 0;
      },
    },
    // 3-11 一人称：送電もできるし、グラップラーとしても使える
    {
      name: '3-11 送電とグラップラー', duration: M.grap, voice: '3-11_spark', caption: 'スパーク「あなたのアームは電力を送ることもできるし、グラップラーとしても使えるわよ」',
      enter() { S.t = 0; spark.setPose('talk', 5); },
      camera(_u, _t, pose) { fpAtWall(pose, 52); },
    },
  ];

  /** ライアンの目線でスパークの顔を見る */
  function fpAtWall(pose: { pos: THREE.Vector3; target: THREE.Vector3; fov: number; roll: number }, fov: number): void {
    pose.pos.set(rz.x, L.EYE_Y, rz.z);
    pose.target.set(sz.x, 1.5, sz.z);
    pose.fov = fov;
    pose.roll = 0;
  }

  function pose(simDt: number): void {
    S.t += simDt;
    const t = S.t;
    const idx = rt.shotIndex;
    const v = getPlayerVisual(world);
    v.head.rotation.z = 0;
    v.head.rotation.y = 0;
    const firstPersonShot = idx === 5 || idx === 7 || idx === 8 || idx === 9 || idx === 11;
    v.body.visible = !firstPersonShot;
    spark.setSpeaking(voicePlaying());

    if (idx === 0) {
      // スパークが駆け寄る。ライアンは西（スパークのほう）を向いて待つ
      placeRyan(world, L.MEET.ryan.x, L.MEET.ryan.z, L.MEET.ryan.yaw);
      const k = smooth(t / (M.cheer - 0.4));
      const x = lerp(L.SAFE_CORNER.x, L.MEET.spark.x, k), z = lerp(L.SAFE_CORNER.z, L.MEET.spark.z, k);
      placeSpark(spark, x, z, sparkYaw(L.MEET.ryan.x - x, L.MEET.ryan.z - z));
      spark.setGait(k < 1 ? 1 : 0);
      if (k >= 1 && !cheered.a) { cheered.a = true; spark.setPose('cheer', 6); }
      v.head.rotation.y = headToward(world, L.MEET.ryan.yaw, ryanYaw(x - L.MEET.ryan.x, z - L.MEET.ryan.z));
    } else if (idx === 1) {
      // 東へ歩く（スパークが先導。ライアンは少し遅れてついていく）
      const k = smooth(t / (WALK - 0.2));
      const a = alongPath(L.WALK_SPARK, k);
      placeSpark(spark, a.x, a.z, sparkYaw(a.dx, a.dz));
      if (t > 0.25) spark.setPose('idle', 6);
      const b = alongPath(L.WALK_RYAN, smooth(seg(t, 0.5, WALK - 0.2)));
      placeRyan(world, b.x, b.z, ryanYaw(b.dx, b.dz));
      spark.setGait(k < 1 ? 0.55 : 0);
      world.player.vel.set(b.dx * 2.2 * (k < 1 ? 1 : 0), 0, b.dz * 2.2 * (k < 1 ? 1 : 0));
    } else {
      // モニターウォールの前
      placeRyan(world, rz.x, rz.z, rz.yaw);
      placeSpark(spark, sz.x, sz.z, sparkYaw(rz.x - sz.x, rz.z - sz.z));
      spark.setGait(0);
      if (idx === 2) { boxes(t); if (t > 0.3) spark.setPose('idle', 5); }
      else boxes(99);
      if (idx === 6 || idx === 10) v.head.rotation.z = 0.28 * smooth(seg(t, 0.3, 0.9));
      if (idx === 3 || idx === 4) v.head.rotation.y = 0;
      if (idx === 5 || idx === 7 || idx === 9 || idx === 11) v.head.rotation.y = headToward(world, rz.yaw, ryanYaw(sz.x - rz.x, sz.z - rz.z), 0.9);
    }
  }

  return {
    shots,
    sim(simDt) { spark.update(simDt); pose(simDt); },
    complete() {
      spark.setGait(0);
      spark.setSpeaking(false);
      placeRyan(world, rz.x, rz.z, rz.yaw);
      placeSpark(spark, sz.x, sz.z, sparkYaw(rz.x - sz.x, rz.z - sz.z), 'idle');
      boxes(99);
      getPlayerVisual(world).body.visible = true;
    },
    dispose() { spark.setSpeaking(false); spark.setGait(0); },
  };
}

// =====================================================================================
// ④ 出発（4-1 の問いかけ、はい／いいえの返事）
// =====================================================================================
export function askScript(rt: Runtime, st: IntroStage): Script {
  const { world, spark } = st;
  const rz = L.AT_WALL.ryan, sz = L.AT_WALL.spark;
  const v = getPlayerVisual(world);
  const shots: Shot[] = [{
    name: '4-1 この建物の2階', duration: voiceLen('4-1_spark', 0.5), voice: '4-1_spark',
    caption: 'スパーク「この建物の2階に、チームで使ってた研究所があるの、だけどコイツラがいて行けないの。あなたが先に行ってコイツラをぶっ潰してってわけ。いい？」',
    enter() { spark.setPose('talk', 5); },
    camera(u, _t, pose) {
      pose.pos.set(rz.x, L.EYE_Y, rz.z);
      pose.target.set(sz.x, 1.5, sz.z);
      pose.fov = lerp(54, 48, smooth(u));
      pose.roll = 0;
    },
  }];
  return {
    shots,
    sim(simDt) {
      spark.update(simDt);
      placeRyan(world, rz.x, rz.z, rz.yaw);
      placeSpark(spark, sz.x, sz.z, sparkYaw(rz.x - sz.x, rz.z - sz.z));
      spark.setSpeaking(voicePlaying());
      v.body.visible = false;
      v.head.rotation.y = headToward(world, rz.yaw, ryanYaw(sz.x - rz.x, sz.z - rz.z), 0.9);
    },
    complete() { v.body.visible = true; spark.setSpeaking(false); },
    dispose() { spark.setSpeaking(false); },
  };
}

/** 「はい」：手を上げて しゅっぱーつ！ */
export function yesScript(rt: Runtime, st: IntroStage): Script {
  const { world, spark } = st;
  const rz = L.AT_WALL.ryan, sz = L.AT_WALL.spark;
  const v = getPlayerVisual(world);
  const shots: Shot[] = [{
    name: '4-3a しゅっぱーつ', duration: voiceLen('4-3a_spark', 0.7), voice: '4-3a_spark', caption: 'スパーク「よし！じゃあ、しゅっぱーつ！」',
    enter() { spark.setPose('cheer', 8); },
    camera(u, _t, pose) {
      pose.pos.set(rz.x, L.EYE_Y, rz.z);
      pose.target.set(sz.x, lerp(1.5, 1.7, smooth(u)), sz.z);
      pose.fov = lerp(52, 56, smooth(u));
      pose.roll = 0;
    },
  }];
  return {
    shots,
    sim(simDt) {
      spark.update(simDt);
      placeRyan(world, rz.x, rz.z, rz.yaw);
      placeSpark(spark, sz.x, sz.z, sparkYaw(rz.x - sz.x, rz.z - sz.z));
      spark.setSpeaking(voicePlaying());
      v.body.visible = false;
    },
    complete() { v.body.visible = true; spark.setSpeaking(false); },
    dispose() { spark.setSpeaking(false); },
  };
}

/** 「いいえ」：腕組み → スレスレのハイキック（当てない）。このあと選択に戻る */
export function noScript(rt: Runtime, st: IntroStage): Script {
  const { world, spark } = st;
  const rz = L.AT_WALL.ryan, sz = L.AT_WALL.spark;
  const v = getPlayerVisual(world);
  const S = { t: 0 };
  const shots: Shot[] = [{
    name: '4-3b いいから', duration: voiceLen('4-3b_spark', 1.1), voice: '4-3b_spark', caption: 'スパーク「いいから〜！さっさと言ってちょうだい♪」', shake: 0.15,
    enter() { S.t = 0; spark.setPose('crossed', 6); },
    camera(u, _t, pose) {
      // ライアンの斜め前から：スパークの全身が入るように
      pose.pos.set(rz.x + 1.2, 1.55, rz.z + 2.6);
      pose.target.set((rz.x + sz.x) / 2, 1.1, (rz.z + sz.z) / 2);
      pose.fov = lerp(42, 40, smooth(u));
      pose.roll = 0;
    },
  }];
  return {
    shots,
    sim(simDt) {
      S.t += simDt;
      spark.update(simDt);
      placeRyan(world, rz.x, rz.z, rz.yaw);
      // 近づいて、スレスレでハイキック（ライアンには当たらない）
      const close = smooth(seg(S.t, 0.5, 1.1));
      placeSpark(spark, lerp(sz.x, rz.x + 1.25, close), lerp(sz.z, rz.z + 0.3, close), sparkYaw(rz.x - sz.x, rz.z - sz.z));
      if (S.t > 1.1) spark.setPose('kick', 20);
      if (S.t > 1.75) spark.setPose('crossed', 6);
      spark.setSpeaking(voicePlaying());
      v.body.visible = true;
      v.head.rotation.y = 0;
      v.head.rotation.x = S.t > 1.1 && S.t < 1.8 ? -0.12 : 0;   // のけぞる
    },
    complete() { v.body.visible = true; spark.setSpeaking(false); placeSpark(spark, sz.x, sz.z, sparkYaw(rz.x - sz.x, rz.z - sz.z), 'idle'); },
    dispose() { spark.setSpeaking(false); },
  };
}
