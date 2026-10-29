// 西の直線に置くもの：障害物（簡単め。道幅の1/3を占める）と、はね飛ばす雑魚敵（見た目だけ・攻撃しない）。
// 配置は固定の疑似乱数で決める（毎回同じ・テストしやすい）。
import * as THREE from 'three';
import type { EnemyKind } from '../config/balance';
import { ENEMIES } from '../config/balance';
import { buildModel, disposeObject, type Model } from '../enemies/models';
import '../enemies/kinds';
import { CHECKPOINT, ROAD } from '../level/surge/layout';

export type ObstacleKind = 'barricade' | 'crates' | 'wreck';
export interface ObstacleDef { x: number; z: number; w: number; d: number; kind: ObstacleKind }
export type ZakoKind = Extract<EnemyKind, 'drone' | 'redDrone' | 'crawler' | 'walker' | 'redWalker' | 'gunner' | 'bomber' | 'leech'>;
export interface ZakoDef { x: number; z: number; kind: ZakoKind; phase: number }

/** 障害物の道幅に対する割合 */
export const OBSTACLE_WIDTH = ROAD.width / 3;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 障害物の配置。西向きの直線（z=ROAD.junctionZ が道の中心）に、約 120 m おき。
 * 横の位置は 左端寄り／右端寄り／中央 をばらけさせる（どれも反対側に十分な空きがある）
 */
export function planObstacles(): ObstacleDef[] {
  const lat = [1, -1, 0, 1, -1, -1, 0, 1, -1, 1];
  const kinds: ObstacleKind[] = ['barricade', 'crates', 'wreck', 'barricade', 'wreck', 'crates', 'barricade', 'crates', 'wreck', 'barricade'];
  const out: ObstacleDef[] = [];
  for (let i = 0; i < lat.length; i++) {
    const kind = kinds[i];
    out.push({
      x: -300 - i * 108,
      z: ROAD.junctionZ + lat[i] * (ROAD.width / 2 - OBSTACLE_WIDTH / 2 - 0.4),
      w: OBSTACLE_WIDTH,
      d: kind === 'wreck' ? 4.4 : kind === 'crates' ? 2.6 : 1.6,
      kind,
    });
  }
  return out;
}

const ZAKO_MIX: [ZakoKind, number][] = [
  ['drone', 7], ['crawler', 7], ['walker', 5], ['gunner', 5], ['redDrone', 2], ['bomber', 4], ['leech', 4], ['redWalker', 2],
];

/**
 * 雑魚敵の配置：直線の序盤〜判定地点の手前まで、2〜4体ずつの群れ（packs 個）。障害物とは重ならない。
 * 群れにすると遠くからでも「敵がいる」と読める
 */
export function planZako(obstacles: ObstacleDef[], packs = 19): ZakoDef[] {
  const r = rng(20261029);
  const bag: ZakoKind[] = [];
  for (const [k, n] of ZAKO_MIX) for (let i = 0; i < n; i++) bag.push(k);
  const out: ZakoDef[] = [];
  const x0 = -60, x1 = CHECKPOINT.x + 60;
  for (let j = 0; j < packs; j++) {
    const cx = x0 + ((x1 - x0) * (j + 0.2 + r() * 0.6)) / packs;
    const cz = ROAD.junctionZ + (r() * 2 - 1) * (ROAD.width / 2 - 3.5);
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const kind = bag[Math.floor(r() * bag.length)];
      const x = cx + (r() * 2 - 1) * 7;
      let z = clampZ(cz + (r() * 2 - 1) * 3.5);
      // 障害物の近く（手前後 12m）は避ける
      for (const o of obstacles) if (Math.abs(o.x - x) < 12 && Math.abs(o.z - z) < o.w / 2 + 1.5) z = ROAD.junctionZ + (z > ROAD.junctionZ ? -1 : 1) * (ROAD.width / 2 - 1.6);
      out.push({ x, z, kind, phase: r() * 6.28 });
    }
  }
  return out;
}

const clampZ = (z: number): number => Math.max(ROAD.junctionZ - (ROAD.width / 2 - 1.4), Math.min(ROAD.junctionZ + (ROAD.width / 2 - 1.4), z));

// ---------------------------------------------------------------- 障害物の見た目

let stripeTex: THREE.CanvasTexture | null = null;
function stripeTexture(): THREE.Texture | null {
  if (stripeTex) return stripeTex;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#f2b01e'; g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#16181f';
  for (let i = -2; i < 8; i++) {
    g.beginPath();
    g.moveTo(i * 24, 32); g.lineTo(i * 24 + 12, 32); g.lineTo(i * 24 + 28, 0); g.lineTo(i * 24 + 16, 0); g.closePath();
    g.fill();
  }
  stripeTex = new THREE.CanvasTexture(c);
  stripeTex.colorSpace = THREE.SRGBColorSpace;
  stripeTex.wrapS = THREE.RepeatWrapping;
  return stripeTex;
}

let glowTex: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.Texture | null {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export interface Obstacle {
  def: ObstacleDef;
  root: THREE.Group;
  /** 点滅する警告灯のマテリアル */
  lamps: THREE.MeshBasicMaterial[];
  /** 遠くからも見える光の柱 */
  beam: THREE.Mesh;
  hit: boolean;
}

export function buildObstacle(def: ObstacleDef): Obstacle {
  const root = new THREE.Group();
  root.position.set(def.x, 0, def.z);
  const w3 = def.w;
  const std = (color: number, rough = 0.7, metal = 0.2) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const hazard = new THREE.MeshStandardMaterial({ color: 0xf2b01e, roughness: 0.6, metalness: 0.1 });
  const tex = stripeTexture();
  if (tex) { hazard.map = tex.clone(); hazard.map.repeat.set(w3 / 2, 1); hazard.map.needsUpdate = true; hazard.color.setHex(0xffffff); }
  const concrete = std(0x8a909c, 0.9, 0.05);
  const dark = std(0x23262e, 0.6, 0.3);
  const orange = std(0xff7a1a, 0.55, 0.1);
  const lamps: THREE.MeshBasicMaterial[] = [];
  const lamp = (x: number, y: number, z: number, size = 0.32) => {
    const m = new THREE.MeshBasicMaterial({ color: 0xff5a1a, toneMapped: false });
    lamps.push(m);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), m);
    mesh.position.set(x, y, z);
    root.add(mesh);
  };
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry = 0, rz = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, ry, rz);
    mesh.castShadow = true;
    root.add(mesh);
    return mesh;
  };
  // 注意：障害物は西向きの道に横向きに置く。ローカルの Z が道の横方向（幅 w）、X が道の進行方向（厚み d）
  const w = def.w;
  if (def.kind === 'barricade') {
    // コンクリートの土台＋黄黒の大きな遮断板＋両端の警告灯
    add(new THREE.BoxGeometry(def.d, 0.7, w), concrete, 0, 0.35, 0);
    const board = add(new THREE.BoxGeometry(0.2, 1.2, w - 0.2), hazard, 0, 1.3, 0);
    board.castShadow = false;
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.2, 2.4, 0.2), dark, 0, 1.2, s * (w / 2 - 0.1));
      lamp(0, 2.55, s * (w / 2 - 0.1));
    }
  } else if (def.kind === 'crates') {
    // 積まれたコンテナ（橙）＋黄黒の帯＋上の警告灯
    add(new THREE.BoxGeometry(def.d, 2.0, w * 0.62), orange, 0, 1.0, -w * 0.18);
    add(new THREE.BoxGeometry(def.d * 0.95, 1.7, w * 0.42), std(0xe05a14, 0.6, 0.1), 0.1, 0.85, w * 0.27);
    add(new THREE.BoxGeometry(def.d * 0.9, 1.5, w * 0.5), orange, -0.1, 2.75, -w * 0.12, 0.06);
    const band = add(new THREE.BoxGeometry(def.d + 0.04, 0.4, w * 0.62 + 0.04), hazard, 0, 1.3, -w * 0.18);
    band.castShadow = false;
    lamp(0, 3.7, -w * 0.12, 0.38);
    lamp(0, 2.1, w * 0.27);
  } else {
    // 壊れた車（斜めに傾いた箱）＋橙のコーン
    const body = add(new THREE.BoxGeometry(def.d, 1.05, w * 0.62), std(0x5b4a44, 0.85, 0.3), 0, 0.85, 0, 0.14, 0.07);
    body.castShadow = true;
    add(new THREE.BoxGeometry(def.d * 0.5, 0.7, w * 0.5), std(0x3e4047, 0.7, 0.4), -0.2, 1.55, 0.05, 0.14, 0.09);
    add(new THREE.BoxGeometry(def.d * 0.9, 0.12, w * 0.64), hazard, 0, 1.4, 0, 0.14, 0.07).castShadow = false;
    for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.42, 0.42, 0.4, 12), dark, s * 1.2, 0.42, w * 0.34, 0, Math.PI / 2);
    for (const s of [-1, 1]) {
      add(new THREE.ConeGeometry(0.4, 1.0, 8), orange, 0, 0.5, s * (w / 2 - 0.4));
      lamp(0, 1.25, s * (w / 2 - 0.4), 0.26);
    }
    lamp(0, 2.2, 0, 0.36);
  }
  // 遠くから見える光の柱（橙）。点滅に合わせて明るさを変える
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xff7a2a, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 34, 10, 1, true), beamMat);
  beam.position.y = 17;
  root.add(beam);
  // 頭上の大きな警告の光（遠くから「何かある」と読める目印）
  const glowTex = (typeof document !== 'undefined') ? glowTexture() : null;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex ?? undefined, color: 0xff7a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  halo.scale.setScalar(9);
  halo.position.y = 6;
  root.add(halo);
  return { def, root, lamps, beam, hit: false };
}

/** 警告灯の点滅（時間 t）。near=近いほど柱を薄く */
export function updateObstacle(o: Obstacle, t: number, dist: number): void {
  const on = Math.floor((t + o.def.x * 0.013) * 3.2) % 2 === 0;
  for (const m of o.lamps) m.color.setHex(on ? 0xff6a22 : 0x401a08);
  const m = o.beam.material as THREE.MeshBasicMaterial;
  m.opacity = (on ? 0.85 : 0.35) * Math.min(1, dist / 30);
  const halo = o.root.children.find((c) => (c as THREE.Sprite).isSprite) as THREE.Sprite | undefined;
  if (halo) (halo.material as THREE.SpriteMaterial).opacity = (on ? 1 : 0.35) * Math.min(1, dist / 30);
}

export function disposeObstacle(o: Obstacle): void {
  o.root.removeFromParent();
  o.root.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
  });
}

// ---------------------------------------------------------------- 雑魚敵（はね飛ばされる）

export interface Zako {
  def: ZakoDef;
  kind: ZakoKind;
  model: Model;
  root: THREE.Group;
  /** 体の中心（ワールド） */
  pos: THREE.Vector3;
  radius: number;
  baseY: number;
  flying: boolean;
  state: 'idle' | 'flung' | 'gone';
  vel: THREE.Vector3;
  ang: THREE.Vector3;
  t: number;
  flash: number;
  yaw: number;
}

const FLYERS: ZakoKind[] = ['drone', 'redDrone'];

export function buildZako(def: ZakoDef): Zako {
  const model = buildModel(def.kind);
  const r = ENEMIES[def.kind].radius;
  const flying = FLYERS.includes(def.kind);
  // 低く浮く（車の高さに当たる）ドローン／地面の敵
  const baseY = flying ? 1.1 + (Math.sin(def.phase * 3) * 0.5 + 0.5) * 0.5 : r + 0.1;
  const root = model.root;
  root.position.set(def.x, baseY, def.z);
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  // 攻撃予告系のパーツは隠す
  for (const k of ['teleCircle', 'teleStrip', 'field']) if (model.parts[k]) model.parts[k].visible = false;
  return {
    def, kind: def.kind, model, root, pos: new THREE.Vector3(def.x, baseY, def.z), radius: r, baseY, flying,
    state: 'idle', vel: new THREE.Vector3(), ang: new THREE.Vector3(), t: 0, flash: 0, yaw: Math.atan2(0, 1),
  };
}

const _c = new THREE.Color();

/** 立ったまま／浮いたままの動き（ゆれ・足踏み・車の方を向く） */
export function idleZako(z: Zako, time: number, dt: number, car: THREE.Vector3): void {
  const model = z.model;
  const p = model.parts;
  const ph = z.def.phase;
  const dx = car.x - z.pos.x, dz = car.z - z.pos.z;
  if (dx * dx + dz * dz < 140 * 140) {
    const want = Math.atan2(dx, dz);
    let d = want - z.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    z.yaw += d * Math.min(1, dt * 4);
    z.root.rotation.y = z.yaw;
  }
  if (z.flying) {
    z.root.position.y = z.baseY + Math.sin(time * 2.1 + ph) * 0.18;
    if (p.ring) p.ring.rotation.y += dt * 4;
    if (p.props) for (const d of p.props as THREE.Object3D[]) d.rotation.y += dt * 40;
    model.vis.rotation.z = Math.sin(time * 1.3 + ph) * 0.08;
  } else {
    const walk = Math.abs(Math.sin(time * 5 + ph));
    z.root.position.y = z.baseY + walk * 0.07;
    model.vis.rotation.z = Math.sin(time * 5 + ph) * 0.06;
    model.vis.rotation.x = Math.sin(time * 2.2 + ph) * 0.03;
    if (p.wheel) (p.wheel as THREE.Object3D).rotation.x += dt * 5;
  }
  if (z.flash > 0) {
    z.flash = Math.max(0, z.flash - dt);
    for (const m of model.bodyMats) { m.mat.emissive.copy(_c.setHex(0xffffff)); m.mat.emissiveIntensity = z.flash * 6; }
  }
}

/** はね飛ばす。車の速度ベクトル (carVx, carVz) と、車から見た横の向き（-1/1）で飛び方が決まる */
export function flingZako(z: Zako, carVx: number, carVz: number, sideSign: number, rand: () => number = Math.random): void {
  z.state = 'flung';
  z.t = 0;
  z.flash = 0.18;
  const sp = Math.hypot(carVx, carVz);
  const fx = sp > 0.01 ? carVx / sp : 0, fz = sp > 0.01 ? carVz / sp : -1;
  // 横の向き = 進行方向の右（fx,fz を 90度回した向き）× sideSign
  const rx = -fz * sideSign, rz = fx * sideSign;
  const up = 12 + rand() * 7;
  const side = 6 + rand() * 9;
  const fwd = sp * (0.32 + rand() * 0.18);
  z.vel.set(fx * fwd + rx * side, up, fz * fwd + rz * side);
  z.ang.set((rand() - 0.5) * 18, (rand() - 0.5) * 22, (rand() - 0.5) * 18);
}

/** はね飛ばされた後の物理（重力・回転）。寿命が尽きるか、低く落ちたら 'gone' にする */
/** 戻り値：寿命が尽きた（呼び出し側が片付ける） */
export function stepFlung(z: Zako, dt: number): boolean {
  z.t += dt;
  z.vel.y -= 26 * dt;
  z.pos.addScaledVector(z.vel, dt);
  // 地面ではねる
  if (z.pos.y < z.radius && z.vel.y < 0) { z.pos.y = z.radius; z.vel.y *= -0.35; z.vel.x *= 0.7; z.vel.z *= 0.7; z.ang.multiplyScalar(0.7); }
  z.root.position.copy(z.pos);
  z.root.rotation.x += z.ang.x * dt;
  z.root.rotation.y += z.ang.y * dt;
  z.root.rotation.z += z.ang.z * dt;
  if (z.flash > 0) {
    z.flash = Math.max(0, z.flash - dt);
    for (const m of z.model.bodyMats) { m.mat.emissive.setHex(0xffffff); m.mat.emissiveIntensity = z.flash * 6; }
  }
  if (z.t > 3.2 || z.pos.y < -4) { z.state = 'gone'; return true; }
  return false;
}

export function disposeZako(z: Zako): void {
  z.root.removeFromParent();
  disposeObject(z.root);
}
