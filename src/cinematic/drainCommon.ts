// ルート2（ドレイン装置へ）の演出 3本（成功 / 失敗 / 失速）の共通部品：
//   ・DrainRun：坂に沿って車を置く・扉まわりの部品の窓口（plant.parts）・飛び散る破片・衝撃波の輪
//   ・introShots：①〜⑥（後ろ斜め → 車内 → 後ろ上斜め → 真横 → 正面の顔 → 後ろ上）。成功と失敗が同じものを使う
//   ・doorSideCamera / faceCloseCamera：扉の真横のスロー用カメラ、ライアンの寄りカメラ
// 座標：車は東（+X）へ走る（yaw=-π/2）。車の右が +Z、前が車ローカルの -Z。坂は RAMP.yAt(x)、道の中心 z = RAMP.centerZ。
import * as THREE from 'three';
import type { World } from '../core/types';
import type { DriveState } from '../vehicle/types';
import { DRAIN_DOOR, RAMP } from '../level/surge/layout';
import { CarRig } from './carRig';
import type { CamPose, Runtime, Shot } from './sequencer';

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };

/** 扉の直前のスローモーションの倍率 */
export const DRAIN_SLOW = 0.13;
/** 道の中心 z */
export const ZC = RAMP.centerZ;
/** 扉の中心の高さ */
export const DOOR_MID_Y = DRAIN_DOOR.y + DRAIN_DOOR.h / 2;

const GRAVITY = 14;

interface Flying {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rested: boolean;
}

/** plant.ts が world.level.data.surge.plant.parts に置く部品（無くても動く） */
export interface DrainParts {
  door?: THREE.Object3D;
  doorBroken?: THREE.Object3D;
  sideWing?: THREE.Object3D;
  /** 閉じた扉の左(北)・右(南)の扉板 */
  doorPanels?: THREE.Object3D[];
  /** 壊れた扉の「飛んだ扉板」（最終位置が入っている。ここから飛ばす演出をする） */
  doorBrokenPanels?: THREE.Object3D[];
}

function firstOf(v: unknown): THREE.Object3D | undefined {
  const o = Array.isArray(v) ? v[0] : v;
  return o && (o as THREE.Object3D).isObject3D ? (o as THREE.Object3D) : undefined;
}

export function readParts(world: World): DrainParts {
  const p = (world.level.data.surge as { plant?: { parts?: Record<string, unknown> } } | undefined)?.plant?.parts;
  const many = (v: unknown): THREE.Object3D[] | undefined => {
    const a = (Array.isArray(v) ? v : v ? [v] : []).filter((o) => o && (o as THREE.Object3D).isObject3D) as THREE.Object3D[];
    return a.length ? a : undefined;
  };
  return {
    door: firstOf(p?.door), doorBroken: firstOf(p?.doorBroken), sideWing: firstOf(p?.sideWing),
    doorPanels: many(p?.doorPanels), doorBrokenPanels: many(p?.doorBrokenPanels),
  };
}

/**
 * 演出で走る範囲（x が xMin より大きい）にある障害物・雑魚・ヘビーを隠す。戻す関数と、毎フレーム隠し直す関数を返す
 * （雑魚・ヘビーは自分で visible を戻すことがあるので、演出の間は毎フレーム隠し直す）
 */
function hideEastProps(drive: unknown, xMin: number): { restore: () => void; keep: () => void } {
  type Prop = { root?: THREE.Object3D; pos?: THREE.Vector3; def?: { x: number }; actor?: { root: THREE.Object3D; pos: THREE.Vector3 } };
  const d = drive as { obstacles?: Prop[]; zako?: Prop[]; heavies?: Prop[] } | undefined;
  const hidden: THREE.Object3D[] = [];
  for (const list of [d?.obstacles, d?.zako, d?.heavies]) {
    for (const p of list ?? []) {
      const r = p?.root ?? p?.actor?.root;
      const x = p?.pos?.x ?? p?.actor?.pos?.x ?? p?.def?.x ?? r?.position.x ?? 0;
      if (r && r.visible && x > xMin) { r.visible = false; hidden.push(r); }
    }
  }
  return {
    restore: () => { for (const h of hidden) h.visible = true; },
    keep: () => { for (const h of hidden) h.visible = false; },
  };
}

export class DrainRun {
  readonly world: World;
  readonly car: CarRig;
  readonly front: number;
  readonly rear: number;
  /** 車の x と速さ（m/s。前進が正） */
  x: number;
  speed: number;
  /** 走行ショットの共通の速さ */
  readonly V: number;
  parts: DrainParts;
  private flying: Flying[] = [];
  private rings: { mesh: THREE.Mesh; age: number }[] = [];
  private panelTweens: { obj: THREE.Object3D; p0: THREE.Vector3; p1: THREE.Vector3; q0: THREE.Quaternion; q1: THREE.Quaternion; age: number }[] = [];
  private marks: THREE.Object3D[] = [];
  private shared: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private props: { restore: () => void; keep: () => void };
  private pitchSmooth = 0;
  private tmp = new THREE.Vector3();
  readonly dirE = new THREE.Vector3(1, 0, 0);
  /** 車を表示するか */
  carHidden = false;

  constructor(readonly rt: Runtime, readonly drive: DriveState, V: number) {
    this.world = rt.world;
    this.car = new CarRig(drive);
    this.front = this.car.m.frontDist;
    this.rear = this.car.m.rearDist;
    this.V = V;
    this.x = drive.pos.x;
    this.speed = V;
    this.parts = readParts(this.world);
    this.props = hideEastProps(drive, 1250);
  }

  /** 車の先頭が扉の面からどれだけ手前か（正=手前） */
  dDoor(): number { return DRAIN_DOOR.x - (this.x + this.front); }
  /** 車の先頭が扉に着く x */
  get hitX(): number { return DRAIN_DOOR.x - this.front; }

  /** 坂に沿った車の傾き（車の長さぶんの前後の高さの差から。折れ目はなめらかになる） */
  groundPitch(x: number): number {
    const h = 2.4;
    return Math.atan2(RAMP.yAt(x + h) - RAMP.yAt(x - h), 2 * h);
  }

  /** 車を（x, 坂の高さ）に置く。dt は車のばね・車輪の更新用、vis は車輪が回る見かけの速さ */
  place(dt: number, vis = this.speed, opt?: { yOffset?: number }): void {
    const c = this.car;
    c.x = this.x; c.z = ZC; c.yaw = -Math.PI / 2;
    const target = this.groundPitch(this.x);
    this.pitchSmooth += (target - this.pitchSmooth) * (dt > 0 ? 1 - Math.exp(-14 * dt) : 1);
    c.pitch = this.pitchSmooth;
    c.place(Math.abs(vis));
    c.root.position.y = RAMP.yAt(this.x) + (opt?.yOffset ?? 0);
    c.root.updateMatrixWorld(true);
    c.root.visible = !this.carHidden;
    this.drive.car.update(dt, Math.abs(vis));
  }

  /** 速度線 */
  lines(on: number): void {
    this.rt.lines.update(this.tmp.set(this.x, RAMP.yAt(this.x), ZC), this.dirE, on);
  }

  // ---------------- 扉 ----------------

  /** 扉を壊した見た目に切り替える（部品が無ければ何もしない） */
  breachDoor(): void {
    if (this.parts.door) this.parts.door.visible = false;
    if (this.parts.doorBroken) this.parts.doorBroken.visible = true;
    // 壊れた扉の「飛んだ扉板」は、扉の位置から最終位置へ飛ばす
    (this.parts.doorBrokenPanels ?? []).forEach((o, i) => {
      const p1 = o.position.clone(), q1 = o.quaternion.clone();
      const p0 = new THREE.Vector3(-0.3, 0, i % 2 ? 2.5 : -2.5);
      const q0 = new THREE.Quaternion();
      o.position.copy(p0); o.quaternion.copy(q0);
      this.panelTweens.push({ obj: o, p0, p1, q0, q1, age: 0 });
    });
  }

  /** 扉が破れずにへこんだ見た目：扉板が奥へ押され、少しゆがむ */
  dentDoor(): void {
    (this.parts.doorPanels ?? []).forEach((o, i) => {
      o.position.x += 0.55;
      o.rotation.y += (i % 2 ? -1 : 1) * 0.05;
      o.rotation.z += (i % 2 ? 1 : -1) * 0.025;
    });
  }

  /** 激突の跡（焦げた丸い跡とふち）。pos=面の中心、face=面の外向き（水平の単位ベクトル） */
  impactMark(pos: THREE.Vector3, face: THREE.Vector3, r: number): void {
    const g = new THREE.Group();
    const geo = new THREE.CircleGeometry(r, 28);
    const dark = new THREE.MeshBasicMaterial({ color: 0x14161a, transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const ring = new THREE.MeshBasicMaterial({ color: 0xff9a3a, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3 });
    const geo2 = new THREE.RingGeometry(r * 0.55, r * 0.7, 28);
    g.add(new THREE.Mesh(geo, dark), new THREE.Mesh(geo2, ring));
    g.position.copy(pos).addScaledVector(face, 0.06);
    g.lookAt(pos.clone().add(face));
    this.world.scene.add(g);
    this.marks.push(g);
    this.shared.push(geo, geo2);
    this.mats.push(dark, ring);
  }

  get doorHidden(): boolean { return this.parts.door ? !this.parts.door.visible : false; }

  private material(color: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.45 });
    this.mats.push(m);
    return m;
  }

  /** 扉の破片を飛ばす。fwd=奥（+X）へ飛ぶ割合 */
  spawnDoorDebris(count: number, fwd: number): void {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.shared.push(geo);
    const mats = [this.material(0x59646f), this.material(0x39414a), this.material(0xd2a428), this.material(0x8a96a6)];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mats[i % mats.length]);
      const w = 0.35 + Math.random() * 1.3;
      m.scale.set(0.12 + Math.random() * 0.25, 0.3 + Math.random() * 0.9, w);
      m.position.set(DRAIN_DOOR.x - 0.3, DRAIN_DOOR.y + 0.4 + Math.random() * (DRAIN_DOOR.h - 0.8), ZC + (Math.random() - 0.5) * (DRAIN_DOOR.w - 0.6));
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      const k = Math.random() < fwd ? 1 : -0.55 - Math.random() * 0.7;
      this.world.scene.add(m);
      this.flying.push({
        obj: m,
        vel: new THREE.Vector3(k * (14 + Math.random() * 30), 3 + Math.random() * 12, (m.position.z - ZC) * 2.2 + (Math.random() - 0.5) * 10),
        spin: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
        rested: false,
      });
    }
  }

  /** 破片の最大数の目安（テスト・確認用） */
  get debrisCount(): number { return this.flying.length; }

  updateDebris(dt: number): void {
    this.props.keep();
    for (const f of this.flying) {
      if (f.rested) continue;
      f.vel.y -= GRAVITY * dt;
      f.obj.position.addScaledVector(f.vel, dt);
      f.obj.rotation.x += f.spin.x * dt;
      f.obj.rotation.y += f.spin.y * dt;
      f.obj.rotation.z += f.spin.z * dt;
      const floor = RAMP.yAt(Math.min(f.obj.position.x, DRAIN_DOOR.x)) + 0.2;
      if (f.obj.position.y < floor) {
        f.obj.position.y = floor;
        if (Math.abs(f.vel.y) < 2) { f.rested = true; continue; }
        f.vel.y *= -0.35; f.vel.x *= 0.55; f.vel.z *= 0.55; f.spin.multiplyScalar(0.5);
      }
    }
    for (const tw of this.panelTweens) {
      if (tw.age >= 0.7) continue;
      tw.age = Math.min(0.7, tw.age + dt);
      const e = 1 - Math.pow(1 - tw.age / 0.7, 2.2);
      tw.obj.position.lerpVectors(tw.p0, tw.p1, e);
      tw.obj.position.y += Math.sin(Math.PI * Math.min(1, tw.age / 0.7)) * 5;
      tw.obj.quaternion.slerpQuaternions(tw.q0, tw.q1, e);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const s = 1 + r.age * 34;
      r.mesh.scale.set(s, s, s);
      const mat = r.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 1 - r.age / 0.65) * 0.85;
      if (r.age > 0.7) { this.world.scene.remove(r.mesh); this.rings.splice(i, 1); }
    }
  }

  settleDebris(): void {
    for (let i = 0; i < 240 && this.flying.some((f) => !f.rested); i++) this.updateDebris(1 / 60);
    for (const r of this.rings) this.world.scene.remove(r.mesh);
    this.rings.length = 0;
    for (const tw of this.panelTweens) { tw.age = 0.7; tw.obj.position.copy(tw.p1); tw.obj.quaternion.copy(tw.q1); }
  }

  /** 扉に当たった点に広がる衝撃波の輪（扉の面に平行、東西向きの法線） */
  shockwave(pos: THREE.Vector3, color = 0xc8f4ff): void {
    const geo = new THREE.RingGeometry(0.8, 1, 48);
    this.shared.push(geo);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    this.mats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.y = Math.PI / 2;
    mesh.position.copy(pos);
    this.world.scene.add(mesh);
    this.rings.push({ mesh, age: 0 });
  }

  dispose(): void {
    this.props.restore();
    this.car.root.visible = true;
    this.car.restore();
    for (const f of this.flying) this.world.scene.remove(f.obj);
    for (const r of this.rings) this.world.scene.remove(r.mesh);
    for (const m of this.marks) this.world.scene.remove(m);
    for (const tw of this.panelTweens) { tw.obj.position.copy(tw.p1); tw.obj.quaternion.copy(tw.q1); }
    for (const g of this.shared) g.dispose();
    for (const m of this.mats) m.dispose();
    this.flying.length = 0; this.rings.length = 0;
  }
}

// ---------------------------------------------------------------- 共通のショット ①〜⑥

export interface IntroOpts {
  /** ①〜⑥ の長さ（秒） */
  durs?: number[];
  /** ⑤⑥ の運転手の姿勢 */
  pose5?: 'push' | 'lean';
}

const _headL = new THREE.Vector3();

/** ライアンの顔（正面）：車の前から振り返って見る。dist = 顔までの距離 */
export function faceCamera(run: DrainRun, pose: CamPose, side: number, dist: number, up: number, fov: number): void {
  run.car.headLocal(_headL);
  run.car.toWorld(_headL.x + side, _headL.y + up, _headL.z - dist, pose.pos);
  run.car.toWorld(_headL.x, _headL.y - 0.12, _headL.z, pose.target);
  pose.fov = fov;
}

/**
 * ①〜⑥。走る速さは run.V の一定。各ショットの enter で車を「そのショットの始まりの x」へ置き直す（カット割り）。
 *  ① 後ろ斜め（据え置きのカメラから、車が遠ざかる）② 車内（後部座席あたりの三人称。ライアンの肩ごしにフロントガラス）
 *  ③ 後ろ上の斜め（坂に入る）④ 真横（坂を登る）⑤ 正面からライアンの顔（気合・前のめり）⑥ 後ろ上から（扉が迫る）
 */
export function introShots(run: DrainRun, opts: IntroOpts = {}): Shot[] {
  const { rt, car } = run;
  const D = opts.durs ?? [2.0, 1.8, 1.8, 1.7, 1.8, 1.2];
  const pose5 = opts.pose5 ?? 'push';
  const pLook = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const headL = new THREE.Vector3();
  let sideX = 0;
  const startAt = (x: number, lines: number, pose: 'drive' | 'push' | 'lean' = 'drive'): void => {
    run.x = x; run.speed = run.V; rt.speedLines = lines;
    run.drive.car.setDriverPose(pose);
    run.drive.car.setSteer(0);
    car.setDriverVisible(true);
    run.place(0);
  };

  return [
    // ① 斜め後ろ：据え置きのカメラから、車がぐんぐん遠ざかる
    {
      name: '後ろ斜め（遠ざかる）', duration: D[0], shake: 0.12,
      enter() {
        startAt(1300, 0.18);
        pLook.set(run.x - 1, 1.2, ZC);
      },
      camera(u, _t, pose, dt) {
        pose.pos.set(1288, 2.1, ZC + 5.6);
        tmpA.set(run.x - 1.5, 1.2 + 0.0, ZC);
        pLook.lerp(tmpA, 1 - Math.exp(-5.5 * dt));
        pose.target.copy(pLook);
        pose.fov = lerp(52, 36, smooth(u));
        pose.roll = 0;
      },
    },
    // ② 車内：後部座席のあたりから、運転するライアンの背中ごしに、道と発電所を見る
    {
      name: '車内（背中ごし）', duration: D[1], shake: 0.6,
      enter() { startAt(1335, 0.32); },
      camera(u, t, pose) {
        car.headLocal(headL);
        car.toWorld(headL.x + 0.3, headL.y + 0.42, headL.z + 1.78 - 0.2 * u, pose.pos);
        car.toWorld(headL.x - 0.04, headL.y + 0.0, headL.z - 40, pose.target);
        pose.fov = lerp(66, 58, u);
        pose.roll = Math.sin(t * 9) * 0.004;
        run.drive.car.setSteer(Math.sin(t * 5) * 0.06);
      },
    },
    // ③ 後ろ上の斜め：坂に入って登りはじめる
    {
      name: '後ろ上の斜め（坂へ）', duration: D[2], shake: 0.2,
      enter() { startAt(1488, 0.3); run.drive.car.setSteer(0); },
      camera(u, _t, pose) {
        const back = lerp(12, 17, u);
        const cx = run.x - back;
        pose.pos.set(cx, RAMP.yAt(cx) + lerp(5.2, 7.0, u), ZC + lerp(4.2, 5.8, u));
        pose.target.set(run.x + 9, RAMP.yAt(run.x + 9) + 0.9, ZC);
        pose.fov = lerp(52, 46, u);
        pose.roll = 0.02;
      },
    },
    // ④ 真横：登る車。カメラは車と同じ速さで並走（真横から）
    {
      name: '真横（坂を登る）', duration: D[3], shake: 0.08,
      enter() { startAt(1560, 0.2); sideX = run.x; },
      camera(u, _t, pose) {
        sideX = run.x + 0.8;
        const y = RAMP.yAt(run.x);
        pose.pos.set(sideX, y + 2.3, ZC + 9.8);
        pose.target.set(sideX - 0.8, y + 1.0, ZC);
        pose.fov = lerp(42, 36, u);
        pose.roll = 0;
      },
    },
    // ⑤ 正面からライアンの顔：気合を入れ、上半身ごとハンドルの上へ乗り出す
    {
      name: '正面の顔（気合）', duration: D[4], shake: 0.5,
      enter() { startAt(1628, 0.3, 'drive'); },
      camera(u, t, pose) {
        // 最初の 0.35 秒は普通に運転、そのあと前のめりになる
        if (t > 0.35) run.drive.car.setDriverPose(pose5);
        faceCamera(run, pose, 0.1, lerp(2.6, 2.0, smooth(u)), lerp(0.46, 0.38, smooth(u)), lerp(38, 31, smooth(u)));
        pose.roll = 0.05 * Math.sin(t * 2.4);
      },
    },
    // ⑥ 外から、後ろ上：扉に向かって一直線
    {
      name: '後ろ上（扉へ）', duration: D[5], shake: 0.3,
      enter() { startAt(1655, 0.3, pose5); },
      camera(u, _t, pose) {
        car.toWorld(1.8 - 0.9 * u, 3.4 - 0.5 * u, 9.6 - 1.6 * u, pose.pos);
        car.toWorld(0, 0.9, -5, pose.target);
        pose.fov = lerp(48, 40, u);
        pose.roll = 0.015;
      },
    },
  ];
}

/** 扉のそばの真横カメラ（⑦）：踊り場の南側に据えて、車が近づくのを追う。tx=見る x */
export function doorSideCamera(run: DrainRun, pose: CamPose, tx: number, fov: number): void {
  pose.pos.set(DRAIN_DOOR.x - 20, DRAIN_DOOR.y + 4.2, ZC + 16.5);
  pose.target.set(tx, DRAIN_DOOR.y + 1.4, ZC);
  pose.fov = fov;
  pose.roll = 0;
  void run;
}

/** ⑦ の時間の流れ：扉の 40m 手前からスロー、衝突した瞬間に等倍へ */
export function doorTimeScale(run: DrainRun, hit: boolean): number {
  if (hit) return 1;
  const d = run.dDoor();
  if (d >= 40) return 1;
  if (d >= 12) return lerp(1, DRAIN_SLOW, smooth((40 - d) / 28));
  return DRAIN_SLOW;
}

