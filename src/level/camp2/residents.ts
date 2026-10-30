// 檻の中の火星の住民（簡単な人型をインスタンス化して大勢並べる）。
// 体の部品ごとに InstancedMesh を1つ（胴・頭・腕×2・脚×2）。毎フレーム、各住民の行動から部品の行列を計算し直す。
// 行動：うろうろ歩く／格子をつかんで揺する／座り込む／立ち止まって見回す。解放後は跳びはねて喜ぶ。
import * as THREE from 'three';
import { CAGE, CAGE_Z } from './layout';

type Act = 'wander' | 'grab' | 'sit' | 'idle' | 'cheer';

interface Resident {
  x: number; z: number; yaw: number;
  act: Act;
  /** 今の行動の残り時間 */
  t: number;
  tx: number; tz: number;
  speed: number;
  phase: number;
  /** 体格（高さの倍率） */
  scale: number;
  seed: number;
  /** 座り具合・つかみ具合などのなめらかな値 0..1 */
  sitK: number; grabK: number; cheerK: number;
}

export interface Residents {
  root: THREE.Group;
  readonly count: number;
  update(dt: number, time: number): void;
  /** 解放された：喜ぶ */
  setFreed(on: boolean): void;
  /** テスト用：今の行動の数 */
  stats(): Record<Act, number>;
}

/** 檻の中で歩ける範囲（扉の真後ろはカメラが入るので空けておく） */
const MIN_X = CAGE.x0 + 0.8, MAX_X = CAGE.x1 - 0.8;
const MIN_Z = CAGE.z0 + 1.8, MAX_Z = CAGE_Z - 0.55;
const KEEP_OUT = { x: 3.4, z: CAGE_Z - 5 };
const inKeepOut = (x: number, z: number) => Math.abs(x) < KEEP_OUT.x && z > KEEP_OUT.z;

const SHIRTS = [0xd27a3a, 0x8a8f98, 0x3f8c8a, 0xc9b28a, 0x9a4a3a, 0x5a6a8a, 0xb8b0a4, 0x7a5a8a];
const SKINS = [0xf1c9a5, 0xd9a27a, 0xb07a52, 0x8a5a3a, 0x5e3b29, 0xe8b890];
const PANTS = [0x3a3a44, 0x4a3a30, 0x2e3a4a, 0x55504a];

export function buildResidents(count: number, seed = 7): Residents {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const root = new THREE.Group();
  root.name = 'camp2-residents';

  // 部品（原点＝関節。腕・脚は上端が原点）
  const torsoGeo = new THREE.BoxGeometry(0.44, 0.62, 0.26);
  const headGeo = new THREE.SphereGeometry(0.135, 10, 8);
  const armGeo = new THREE.BoxGeometry(0.11, 0.62, 0.11).translate(0, -0.31, 0);
  const legGeo = new THREE.BoxGeometry(0.15, 0.8, 0.16).translate(0, -0.4, 0);
  const mat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.02 });
  const mk = (g: THREE.BufferGeometry) => {
    const m = new THREE.InstancedMesh(g, mat(), count);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true;
    m.frustumCulled = false;
    root.add(m);
    return m;
  };
  const torso = mk(torsoGeo), head = mk(headGeo), armL = mk(armGeo), armR = mk(armGeo), legL = mk(legGeo), legR = mk(legGeo);

  const people: Resident[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    let x = 0, z = 0;
    do { x = MIN_X + rnd() * (MAX_X - MIN_X); z = MIN_Z + rnd() * (MAX_Z - MIN_Z); } while (inKeepOut(x, z));
    const r: Resident = {
      x, z, yaw: rnd() * Math.PI * 2, act: 'idle', t: rnd() * 3, tx: x, tz: z, speed: 0.6 + rnd() * 0.5,
      phase: rnd() * 10, scale: 0.88 + rnd() * 0.22, seed: rnd() * 100, sitK: 0, grabK: 0, cheerK: 0,
    };
    // 最初から格子をつかんでいる人・座っている人もいる
    const k = rnd();
    if (k < 0.3) startGrab(r); else if (k < 0.5) { r.act = 'sit'; r.sitK = 1; r.t = 4 + rnd() * 8; }
    people.push(r);
    torso.setColorAt(i, c.setHex(SHIRTS[Math.floor(rnd() * SHIRTS.length)]));
    head.setColorAt(i, c.setHex(SKINS[Math.floor(rnd() * SKINS.length)]));
    const sleeve = c.setHex(SHIRTS[Math.floor(rnd() * SHIRTS.length)]);
    armL.setColorAt(i, sleeve);
    armR.setColorAt(i, sleeve);
    const pants = c.setHex(PANTS[Math.floor(rnd() * PANTS.length)]);
    legL.setColorAt(i, pants);
    legR.setColorAt(i, pants);
  }
  for (const m of [torso, head, armL, armR, legL, legR]) if (m.instanceColor) m.instanceColor.needsUpdate = true;

  function startGrab(r: Resident): void {
    // 格子の前（扉の真後ろは避ける）。前室の方を向く
    let x = MIN_X + rnd() * (MAX_X - MIN_X);
    if (Math.abs(x) < KEEP_OUT.x) x = (x < 0 ? -1 : 1) * (KEEP_OUT.x + rnd() * 3);
    r.act = 'grab';
    r.tx = x;
    r.tz = MAX_Z;
    r.t = 5 + rnd() * 9;
  }

  function pickNext(r: Resident): void {
    const k = rnd();
    if (k < 0.42) {
      r.act = 'wander';
      do { r.tx = MIN_X + rnd() * (MAX_X - MIN_X); r.tz = MIN_Z + rnd() * (MAX_Z - 0.6 - MIN_Z); } while (inKeepOut(r.tx, r.tz));
      r.t = 12;
    } else if (k < 0.66) startGrab(r);
    else if (k < 0.8) { r.act = 'sit'; r.t = 5 + rnd() * 10; }
    else { r.act = 'idle'; r.t = 1.5 + rnd() * 3; }
  }

  let freed = false;
  const m4 = new THREE.Matrix4(), base = new THREE.Matrix4(), part = new THREE.Matrix4();
  const q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  const approach = (cur: number, to: number, d: number) => cur < to ? Math.min(to, cur + d) : Math.max(to, cur - d);
  const turn = (cur: number, to: number, rate: number) => {
    let d = ((to - cur + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    d = Math.max(-rate, Math.min(rate, d));
    return cur + d;
  };

  function setPart(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rx: number, ry: number, rz: number): void {
    e.set(rx, ry, rz);
    q.setFromEuler(e);
    part.compose(pos.set(x, y, z), q, one);
    m4.multiplyMatrices(base, part);
    mesh.setMatrixAt(i, m4);
  }

  function update(dt: number, time: number): void {
    for (let i = 0; i < people.length; i++) {
      const r = people[i];
      r.t -= dt;
      let walking = false;
      // ---- 行動
      if (r.act === 'cheer') {
        r.yaw = turn(r.yaw, 0, dt * 3);   // 前室（+Z）の方を向く
      } else if (r.act === 'wander' || r.act === 'grab') {
        const dx = r.tx - r.x, dz = r.tz - r.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.12) {
          walking = true;
          const sp = Math.min(d, r.speed * dt);
          r.x += (dx / d) * sp;
          r.z += (dz / d) * sp;
          r.yaw = turn(r.yaw, Math.atan2(dx, dz), dt * 5);
        } else if (r.act === 'grab') {
          r.yaw = turn(r.yaw, 0, dt * 5);
        } else r.t = Math.min(r.t, 0);
      } else if (r.act === 'idle') {
        r.yaw += Math.sin(time * 0.7 + r.seed) * dt * 0.6;   // 見回す
      }
      if (r.t <= 0 && r.act !== 'cheer') pickNext(r);
      const atBars = r.act === 'grab' && Math.hypot(r.tx - r.x, r.tz - r.z) <= 0.12;
      r.grabK = approach(r.grabK, atBars ? 1 : 0, dt * 3);
      r.sitK = approach(r.sitK, r.act === 'sit' ? 1 : 0, dt * 1.5);
      r.cheerK = approach(r.cheerK, r.act === 'cheer' ? 1 : 0, dt * 3);
      if (walking) r.phase += dt * r.speed * 7;

      // ---- 姿勢
      const swing = walking ? Math.sin(r.phase) * 0.55 : 0;
      const shake = r.grabK * Math.sin(time * 17 + r.seed * 3) * 0.06;            // 格子を揺する
      const hop = r.cheerK * Math.max(0, Math.sin(time * 7 + r.seed)) * 0.35;       // 喜んで跳ぶ
      const sit = r.sitK;
      const hipY = lerp(0.82, 0.32, sit) + hop;
      base.compose(pos.set(r.x + shake * Math.cos(r.yaw), 0, r.z - shake * Math.sin(r.yaw)), q.setFromEuler(e.set(0, r.yaw, 0)), sc.setScalar(r.scale));
      setPart(torso, i, 0, hipY + 0.31, shake * 0.3, 0.12 * r.grabK - 0.08 * sit, 0, 0);
      setPart(head, i, 0, hipY + 0.78, 0.02 + shake * 0.5, 0, Math.sin(time * 0.9 + r.seed) * 0.4 * (1 - r.grabK), 0);
      // 腕：歩き＝振る、つかむ＝前へ上げる（揺する）、喜ぶ＝上へ振り上げる、座る＝ひざの上
      const armUp = r.grabK * (1.35 + shake * 2) + r.cheerK * (2.7 + Math.sin(time * 9 + r.seed) * 0.3) + sit * 0.7;
      setPart(armL, i, -0.28, hipY + 0.56, 0, -armUp - swing, 0, -0.08 - r.cheerK * 0.3);
      setPart(armR, i, 0.28, hipY + 0.56, 0, -armUp + swing, 0, 0.08 + r.cheerK * 0.3);
      // 脚：座ると前へ投げ出す
      setPart(legL, i, -0.11, hipY, 0, swing - sit * 1.45, 0, 0);
      setPart(legR, i, 0.11, hipY, 0, -swing - sit * 1.45, 0, 0);
    }
    for (const m of [torso, head, armL, armR, legL, legR]) m.instanceMatrix.needsUpdate = true;
  }

  function setFreed(on: boolean): void {
    if (freed === on) return;
    freed = on;
    for (const r of people) {
      if (on) { r.act = 'cheer'; r.t = 1e9; } else pickNext(r);
    }
  }

  function stats(): Record<Act, number> {
    const o: Record<Act, number> = { wander: 0, grab: 0, sit: 0, idle: 0, cheer: 0 };
    for (const r of people) o[r.act]++;
    return o;
  }

  update(0, 0);
  return { root, count, update, setFreed, stats };
}
