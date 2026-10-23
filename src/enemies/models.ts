import * as THREE from 'three';
import type { EnemyKind } from '../config/balance';
import { ENEMIES } from '../config/balance';
import type { WeakPoint } from '../core/types';

/** 共有ジオメトリ（dispose しない） */
const geoCache = new Map<string, THREE.BufferGeometry>();
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g as T;
}
export const sphereGeo = (r: number) => geo(`s${r}`, () => new THREE.SphereGeometry(r, 16, 12));
export const capsuleGeo = (r: number, len: number) => geo(`c${r}_${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10));
const torusGeo = (r: number, t: number) => geo(`t${r}_${t}`, () => new THREE.TorusGeometry(r, t, 8, 24));
const cylGeo = (r: number, h: number) => geo(`y${r}_${h}`, () => new THREE.CylinderGeometry(r, r, h, 14));
export const unitCylinder = () => geo('unitCyl', () => new THREE.CylinderGeometry(1, 1, 1, 12, 1, true));
export const unitCircle = () => geo('unitCircle', () => new THREE.CircleGeometry(1, 28));
/** z=0 から z=+1 に伸びる板（XZ 平面、幅1） */
export const unitStrip = () => geo('unitStrip', () => {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, 0.5);
  return g;
});

export const COLORS = {
  coral: 0xff8a6e,
  orange: 0xffa24d,
  dullRed: 0xc9584f,
  dark: 0x4a3a3e,
  eye: 0xff2a2a,
  weak: 0xffe24a,
};

export interface TintMat { mat: THREE.MeshStandardMaterial; base: THREE.Color }

export interface Model {
  root: THREE.Group;
  /** 揺れ・膨張などの演出をかける内側のグループ */
  vis: THREE.Group;
  weakPoints: WeakPoint[];
  bodyMats: TintMat[];
  eyeMats: THREE.MeshStandardMaterial[];
  weakMats: THREE.MeshStandardMaterial[];
  parts: Record<string, any>;
}

class Builder {
  root = new THREE.Group();
  vis = new THREE.Group();
  weakPoints: WeakPoint[] = [];
  bodyMats: TintMat[] = [];
  eyeMats: THREE.MeshStandardMaterial[] = [];
  weakMats: THREE.MeshStandardMaterial[] = [];
  parts: Record<string, any> = {};
  constructor() { this.root.add(this.vis); }

  body(color: number, rough = 0.55): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.12 });
    this.bodyMats.push({ mat: m, base: new THREE.Color(color) });
    return m;
  }
  eye(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: 0x551111, emissive: COLORS.eye, emissiveIntensity: 1.6, roughness: 0.3 });
    this.eyeMats.push(m);
    return m;
  }
  weakMat(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color: COLORS.weak, emissive: 0xffd030, emissiveIntensity: 0.9, roughness: 0.4, transparent: true, opacity: 0.85,
    });
    this.weakMats.push(m);
    return m;
  }
  mesh(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = this.vis, x = 0, y = 0, z = 0): THREE.Mesh {
    const me = new THREE.Mesh(g, m);
    me.position.set(x, y, z);
    me.castShadow = true;
    parent.add(me);
    return me;
  }
  weak(x: number, y: number, z: number, r: number, scale: [number, number, number] = [1, 1, 1], visualR = r): WeakPoint {
    const mesh = this.mesh(sphereGeo(visualR), this.weakMat(), this.vis, x, y, z);
    mesh.scale.set(...scale);
    mesh.castShadow = false;
    // 弱点の周りのうっすらした光
    const halo = new THREE.Mesh(
      sphereGeo(visualR),
      new THREE.MeshBasicMaterial({ color: 0xffe866, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    halo.scale.setScalar(1.7);
    mesh.add(halo);
    const wp: WeakPoint = { offset: new THREE.Vector3(x, y, z), radius: r, mesh, exposed: true };
    this.weakPoints.push(wp);
    return wp;
  }
  done(): Model {
    return {
      root: this.root, vis: this.vis, weakPoints: this.weakPoints, bodyMats: this.bodyMats,
      eyeMats: this.eyeMats, weakMats: this.weakMats, parts: this.parts,
    };
  }
}

function buildDrone(): Model {
  const b = new Builder();
  const coral = b.body(COLORS.coral), orange = b.body(COLORS.orange), dark = b.body(COLORS.dark, 0.7);
  const body = b.mesh(sphereGeo(0.42), coral);
  body.scale.set(1, 0.85, 1);
  // 回るリング + プロペラ
  const ring = new THREE.Group();
  b.vis.add(ring);
  const torus = b.mesh(torusGeo(0.58, 0.06), orange, ring);
  torus.rotation.x = Math.PI / 2;
  const props: THREE.Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const pod = b.mesh(sphereGeo(0.09), dark, ring, Math.cos(a) * 0.58, 0.02, Math.sin(a) * 0.58);
    const disc = b.mesh(cylGeo(0.2, 0.025), orange, pod, 0, 0.1, 0);
    props.push(disc);
  }
  b.parts.ring = ring;
  b.parts.props = props;
  // 顔
  b.mesh(sphereGeo(0.2), dark, b.vis, 0, 0.04, 0.3);
  b.mesh(sphereGeo(0.12), b.eye(), b.vis, 0, 0.04, 0.42);
  // 下のコア（弱点）
  b.mesh(cylGeo(0.05, 0.12), dark, b.vis, 0, -0.38, 0);
  b.weak(0, -0.45, 0, 0.22, [1, 1, 1], 0.16);
  return b.done();
}

function buildCrawler(): Model {
  const b = new Builder();
  const orange = b.body(COLORS.orange), coral = b.body(COLORS.coral), dark = b.body(COLORS.dark, 0.7);
  const body = b.mesh(sphereGeo(0.45), orange, b.vis, 0, 0.05, 0);
  body.scale.set(1, 0.78, 1.18);
  const legs: THREE.Group[] = [];
  const hips: [number, number][] = [[-0.34, 0.3], [0.34, 0.3], [-0.34, -0.3], [0.34, -0.3]];
  for (const [hx, hz] of hips) {
    const hip = new THREE.Group();
    hip.position.set(hx, -0.1, hz);
    b.vis.add(hip);
    const leg = b.mesh(capsuleGeo(0.075, 0.3), coral, hip, Math.sign(hx) * 0.1, -0.25, 0);
    leg.rotation.z = -Math.sign(hx) * 0.3;
    b.mesh(sphereGeo(0.1), dark, hip, Math.sign(hx) * 0.18, -0.5, 0);
    legs.push(hip);
  }
  (b.parts as any).legs = legs;
  b.mesh(sphereGeo(0.19), dark, b.vis, 0, 0.1, 0.5);
  b.mesh(sphereGeo(0.09), b.eye(), b.vis, -0.1, 0.13, 0.64);
  b.mesh(sphereGeo(0.09), b.eye(), b.vis, 0.1, 0.13, 0.64);
  // 背中の電池（弱点）
  b.mesh(capsuleGeo(0.06, 0.3), dark, b.vis, 0, 0.36, -0.15).rotation.x = Math.PI / 2;
  b.weak(0, 0.46, -0.15, 0.24, [1, 0.7, 1.4], 0.19);
  return b.done();
}

function buildGunner(): Model {
  const b = new Builder();
  const coral = b.body(COLORS.coral), orange = b.body(COLORS.orange), dark = b.body(COLORS.dark, 0.7);
  const body = b.mesh(sphereGeo(0.5), coral, b.vis, 0, -0.05, 0);
  body.scale.set(1, 1.1, 1);
  const legs: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.26, -0.35, 0);
    b.vis.add(hip);
    b.mesh(capsuleGeo(0.12, 0.14), orange, hip, 0, -0.1, 0);
    const foot = b.mesh(sphereGeo(0.15), dark, hip, 0, -0.2, 0.05);
    foot.scale.set(1, 0.9, 1.4);
    legs.push(hip);
  }
  (b.parts as any).legs = legs;
  // 頭
  const head = b.mesh(sphereGeo(0.3), orange, b.vis, 0, 0.64, 0.04);
  b.mesh(sphereGeo(0.17), dark, b.vis, 0, 0.66, 0.2);
  b.mesh(sphereGeo(0.1), b.eye(), b.vis, 0, 0.66, 0.31);
  b.parts.head = head;
  // 頭のセンサー（弱点）
  b.mesh(cylGeo(0.02, 0.14), dark, b.vis, 0, 0.9, 0);
  b.weak(0, 1.0, 0, 0.2, [1, 1, 1], 0.12);
  // 砲腕
  const arm = new THREE.Group();
  arm.position.set(0.5, 0.02, 0.1);
  b.vis.add(arm);
  const cannon = b.mesh(capsuleGeo(0.11, 0.5), dark, arm, 0, 0, 0.3);
  cannon.rotation.x = Math.PI / 2;
  b.mesh(sphereGeo(0.13), orange, arm, 0, 0, 0);
  b.parts.arm = arm;
  return b.done();
}

function buildHeavy(): Model {
  const b = new Builder();
  const red = b.body(COLORS.dullRed), orange = b.body(COLORS.orange), dark = b.body(COLORS.dark, 0.7);
  const body = b.mesh(sphereGeo(1.0), red, b.vis, 0, 0.15, 0);
  body.scale.set(1.1, 0.95, 1.0);
  // 足
  for (const sx of [-1, 1]) {
    const foot = b.mesh(sphereGeo(0.5), orange, b.vis, sx * 0.72, -0.72, 0.05);
    foot.scale.set(1, 0.9, 1.3);
  }
  // 腕
  const arms: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(sx * 1.0, 0.35, 0.1);
    b.vis.add(sh);
    b.mesh(sphereGeo(0.3), orange, sh);
    const fist = b.mesh(sphereGeo(0.42), red, sh, sx * 0.1, -0.55, 0.15);
    fist.scale.set(1, 0.9, 1);
    arms.push(sh);
  }
  (b.parts as any).arms = arms;
  // 頭
  b.mesh(sphereGeo(0.38), orange, b.vis, 0, 0.98, 0.45);
  b.mesh(sphereGeo(0.24), dark, b.vis, 0, 1.0, 0.7);
  b.mesh(sphereGeo(0.12), b.eye(), b.vis, 0, 1.0, 0.86);
  // 前の小さな弱点
  const front = b.weak(0, 0.12, 1.12, 0.2, [1, 1, 1], 0.14);
  b.mesh(sphereGeo(0.22), dark, b.vis, 0, 0.12, 1.0);
  // 背中の大きなバッテリー（弱点）
  b.mesh(capsuleGeo(0.16, 0.9), dark, b.vis, 0, 0.3, -0.98).rotation.z = Math.PI / 2;
  const back = b.weak(0, 0.3, -1.2, 0.5, [0.9, 1.1, 0.7], 0.45);
  b.parts.frontWeak = front.mesh;
  b.parts.backWeak = back.mesh;
  // 予告表示（root 直下、足元）
  const teleMat = () => new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const circle = new THREE.Mesh(unitCircle(), teleMat());
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = -ENEMIES.heavy.radius + 0.08;
  circle.visible = false;
  b.root.add(circle);
  const strip = new THREE.Mesh(unitStrip(), teleMat());
  strip.position.y = -ENEMIES.heavy.radius + 0.08;
  strip.visible = false;
  b.root.add(strip);
  b.parts.teleCircle = circle;
  b.parts.teleStrip = strip;
  return b.done();
}

function buildBoss(): Model {
  const b = new Builder();
  const coral = b.body(COLORS.coral), orange = b.body(COLORS.orange), red = b.body(COLORS.dullRed), dark = b.body(COLORS.dark, 0.7);
  // コア本体
  b.mesh(sphereGeo(1.6), red, b.vis, 0, 0, 0);
  b.mesh(sphereGeo(1.75), dark, b.vis, 0, 0, -0.1).scale.set(1, 0.7, 1);
  // 周囲を回る装甲板
  const orbit = new THREE.Group();
  b.vis.add(orbit);
  const plates: THREE.Mesh[] = [];
  const plateGeo = geo('bossPlate', () => new THREE.SphereGeometry(2.05, 12, 8, 0, 0.7, Math.PI * 0.22, Math.PI * 0.56));
  const plateMat = coral;
  plateMat.side = THREE.DoubleSide;
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(plateGeo, i % 2 ? plateMat : orange);
    (p.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    p.rotation.y = (i / 6) * Math.PI * 2;
    p.castShadow = true;
    orbit.add(p);
    plates.push(p);
  }
  (b.parts as any).plates = plates;
  b.parts.orbit = orbit;
  // 赤い目のランプ
  for (let i = 0; i < 3; i++) {
    const a = (i - 1) * 0.5;
    b.mesh(sphereGeo(0.14), b.eye(), b.vis, Math.sin(a) * 2.0, 1.45, Math.cos(a) * 1.4);
  }
  // 前面のまぶた（コアを隠す）
  const lidTop = b.mesh(sphereGeo(1.2), orange, b.vis, 0, 0.55, 1.9);
  lidTop.scale.set(1.15, 0.5, 0.55);
  const lidBot = b.mesh(sphereGeo(1.2), orange, b.vis, 0, -0.55, 1.9);
  lidBot.scale.set(1.15, 0.5, 0.55);
  b.parts.lidTop = lidTop;
  b.parts.lidBot = lidBot;
  // 弱点コア（前面。体の球の表面付近に出して判定が弱点優先になるようにする）
  const wp = b.weak(0, 0, 1.45, 1.0, [1, 1, 1], 0.95);
  b.parts.core = wp.mesh;
  return b.done();
}

export function buildModel(kind: EnemyKind): Model {
  switch (kind) {
    case 'drone': return buildDrone();
    case 'crawler': return buildCrawler();
    case 'gunner': return buildGunner();
    case 'heavy': return buildHeavy();
    case 'boss': return buildBoss();
  }
}

export function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = (c as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) m.forEach((x) => x.dispose()); else m?.dispose?.();
  });
}
