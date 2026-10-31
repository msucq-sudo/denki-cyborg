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
export const torusGeo = (r: number, t: number) => geo(`t${r}_${t}`, () => new THREE.TorusGeometry(r, t, 8, 24));
export const cylGeo = (r: number, h: number) => geo(`y${r}_${h}`, () => new THREE.CylinderGeometry(r, r, h, 14));
export { geo as cachedGeo };

// ---- ゴツゴツ・メカ用の角ばったジオメトリ（すべて共有キャッシュ）
export const boxGeo = (x: number, y: number, z: number) => geo(`bx${x}_${y}_${z}`, () => new THREE.BoxGeometry(x, y, z));
/** 面取りボックス（角を斜めに落とした箱）。中心原点、外形 x*y*z */
export const bevelBox = (x: number, y: number, z: number, bevel = Math.min(0.12, Math.min(x, y, z) * 0.22)) =>
  geo(`bb${x}_${y}_${z}_${bevel}`, () => {
    const hx = x / 2 - bevel, hy = y / 2 - bevel, c = bevel;
    const sh = new THREE.Shape();
    sh.moveTo(-hx + c, -hy); sh.lineTo(hx - c, -hy); sh.lineTo(hx, -hy + c); sh.lineTo(hx, hy - c);
    sh.lineTo(hx - c, hy); sh.lineTo(-hx + c, hy); sh.lineTo(-hx, hy - c); sh.lineTo(-hx, -hy + c); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: z - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 });
    g.translate(0, 0, -(z / 2 - bevel));
    return g;
  });
/** 低ポリ角柱（seg 角形）。平らな面が +z を向く */
export const polyCyl = (r: number, h: number, seg = 6) =>
  geo(`pc${r}_${h}_${seg}`, () => { const g = new THREE.CylinderGeometry(r, r, h, seg, 1); g.rotateY(Math.PI / seg); return g; });
/** 先細りの角柱（上 rt・下 rb） */
export const taperGeo = (rt: number, rb: number, h: number, seg = 6) =>
  geo(`tp${rt}_${rb}_${h}_${seg}`, () => { const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1); g.rotateY(Math.PI / seg); return g; });
/** くさび（後ろ -z が高く、前 +z が低い斜面） */
export const wedgeGeo = (x: number, y: number, z: number) =>
  geo(`wd${x}_${y}_${z}`, () => {
    const sh = new THREE.Shape();
    sh.moveTo(-z / 2, -y / 2); sh.lineTo(z / 2, -y / 2); sh.lineTo(z / 2, y / 2); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: x, bevelEnabled: false });
    g.translate(0, 0, -x / 2);
    g.rotateY(Math.PI / 2);
    return g;
  });
export const octaGeo = (r: number) => geo(`oc${r}`, () => new THREE.OctahedronGeometry(r, 0));
export const icoGeo = (r: number, d = 1) => geo(`ic${r}_${d}`, () => new THREE.IcosahedronGeometry(r, d));
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
  /** 目の発光色（明るい青白） */
  eyeBlue: 0x66ddff,
  weak: 0xffe24a,
  // ---- 敵の共通パレット（白と青）。新しい見た目はこちらを使う
  white: 0xf2f5fa,
  silver: 0xc3cddb,
  paleBlue: 0x9cc2ff,
  blue: 0x3a7bff,
  deepBlue: 0x1f45a8,
  navy: 0x1a2340,
  glowBlue: 0x5ab8ff,
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

export class Builder {
  root = new THREE.Group();
  vis = new THREE.Group();
  weakPoints: WeakPoint[] = [];
  bodyMats: TintMat[] = [];
  eyeMats: THREE.MeshStandardMaterial[] = [];
  weakMats: THREE.MeshStandardMaterial[] = [];
  parts: Record<string, any> = {};
  constructor() { this.root.add(this.vis); }

  /** flat=true で面ごとの陰影（角ばった見た目） */
  body(color: number, rough = 0.55, flat = false): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: flat ? 0.15 : 0.12, flatShading: flat });
    this.bodyMats.push({ mat: m, base: new THREE.Color(color) });
    return m;
  }
  /** 面取りボックスを置く */
  block(w: number, h: number, d: number, m: THREE.Material, parent: THREE.Object3D = this.vis, x = 0, y = 0, z = 0, bevel?: number): THREE.Mesh {
    return this.mesh(bevelBox(w, h, d, bevel), m, parent, x, y, z);
  }
  /** 低ポリ角柱を置く */
  prism(r: number, h: number, seg: number, m: THREE.Material, parent: THREE.Object3D = this.vis, x = 0, y = 0, z = 0): THREE.Mesh {
    return this.mesh(polyCyl(r, h, seg), m, parent, x, y, z);
  }
  /** 青く光る薄い箱（ランプ・ライン） */
  lamp(w: number, h: number, d: number, parent: THREE.Object3D, x: number, y: number, z: number, intensity = 1.4): THREE.Mesh {
    const me = this.mesh(boxGeo(w, h, d), this.glow(intensity), parent, x, y, z);
    me.castShadow = false;
    return me;
  }
  eye(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: COLORS.eyeBlue, emissiveIntensity: 1.6, roughness: 0.3 });
    this.eyeMats.push(m);
    return m;
  }
  /** 青く光る小さなランプ・ライン用（演出で変化しない） */
  glow(intensity = 1.2): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x9fd8ff, emissive: COLORS.glowBlue, emissiveIntensity: intensity, roughness: 0.4 });
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

/** ドローン系の配色（赤ドローンなどが差し替える） */
export interface DronePalette {
  white: number; blue: number; dark: number; pale: number; silver: number;
  /** ベルト・ランプの発光色。省略すると標準の青 */
  glow?: number;
}

/** 標準のドローン（白と青） */
export const DRONE_PALETTE: DronePalette = { white: COLORS.white, blue: COLORS.blue, dark: COLORS.navy, pale: COLORS.paleBlue, silver: COLORS.silver };

/**
 * 色違いのドローンを組み立てる。lamps には色を変えられるランプ・ベルトの材質を集める。
 * decorate は仕上げ前に呼ばれ、パーツの追加や目の色変更ができる
 */
export function buildDroneWith(
  pal: DronePalette = DRONE_PALETTE,
  opts: { lamps?: THREE.MeshStandardMaterial[]; decorate?(b: Builder): void } = {},
): Model {
  const b = new Builder();
  const white = b.body(pal.white, 0.5, true), blue = b.body(pal.blue, 0.5, true), dark = b.body(pal.dark, 0.7, true);
  const pale = b.body(pal.pale, 0.5, true), silver = b.body(pal.silver, 0.5, true);
  // 発光材質：標準は青。glow 指定があればその色にして、後から色を変えられるよう lamps に集める
  const glowMat = (intensity: number): THREE.MeshStandardMaterial => {
    if (pal.glow === undefined) return b.glow(intensity);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: pal.glow, emissiveIntensity: intensity, roughness: 0.4 });
    opts.lamps?.push(m);
    return m;
  };
  // 六角の胴体 + 上下のテーパー装甲
  b.prism(0.42, 0.32, 6, white);
  b.mesh(taperGeo(0.24, 0.42, 0.14, 6), pale, b.vis, 0, 0.23, 0);
  b.mesh(taperGeo(0.42, 0.24, 0.16, 6), silver, b.vis, 0, -0.24, 0);
  // 光るベルト + パネルライン
  b.mesh(polyCyl(0.435, 0.024, 6), glowMat(1.2), b.vis, 0, -0.03, 0).castShadow = false;
  for (const sx of [-1, 1]) b.mesh(boxGeo(0.02, 0.3, 0.5), dark, b.vis, sx * 0.375, 0, 0);
  // アンテナ
  b.prism(0.014, 0.24, 4, dark, b.vis, 0.12, 0.45, -0.05);
  { const l = b.mesh(boxGeo(0.045, 0.045, 0.045), glowMat(1.8), b.vis, 0.12, 0.58, -0.05); l.castShadow = false; }
  // 回るリング（六角）+ プロペラ
  const ring = new THREE.Group();
  b.vis.add(ring);
  const hex = b.mesh(geo('droneHexRing', () => new THREE.TorusGeometry(0.58, 0.05, 4, 6)), blue, ring);
  hex.rotation.x = Math.PI / 2;
  const props: THREE.Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    // 胴体とポッドをつなぐ支柱
    const strut = new THREE.Group();
    strut.rotation.y = -a;
    ring.add(strut);
    b.mesh(boxGeo(0.2, 0.05, 0.06), dark, strut, 0.44, 0, 0);
    const pod = b.block(0.17, 0.12, 0.17, dark, ring, Math.cos(a) * 0.58, 0.0, Math.sin(a) * 0.58, 0.03);
    const blades = new THREE.Group();
    blades.position.y = 0.1;
    pod.add(blades);
    b.mesh(boxGeo(0.42, 0.018, 0.07), pale, blades);
    b.mesh(boxGeo(0.07, 0.018, 0.42), pale, blades);
    b.mesh(boxGeo(0.07, 0.04, 0.07), silver, blades);
    props.push(blades);
  }
  b.parts.ring = ring;
  b.parts.props = props;
  // 顔：バイザーとスリットの目
  b.block(0.34, 0.14, 0.1, dark, b.vis, 0, 0.05, 0.37, 0.03);
  b.mesh(boxGeo(0.26, 0.05, 0.04), b.eye(), b.vis, 0, 0.05, 0.43);
  // 下のコア（弱点）をつかむ受け口と脚
  b.prism(0.2, 0.06, 6, dark, b.vis, 0, -0.35, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 3;
    const g = new THREE.Group();
    g.rotation.y = -a;
    b.vis.add(g);
    const leg = b.mesh(boxGeo(0.035, 0.26, 0.035), dark, g, 0.2, -0.42, 0);
    leg.rotation.z = 0.35;
  }
  b.weak(0, -0.45, 0, 0.22, [1, 1, 1], 0.16);
  opts.decorate?.(b);
  return b.done();
}

function buildDrone(): Model { return buildDroneWith(); }

/** クローラー系の配色（赤クローラーなどが差し替える） */
export interface CrawlerPalette {
  white: number; silver: number; dark: number; deep: number; blue: number;
  /** 背中のストライプの発光色。省略すると標準の青 */
  glow?: number;
}
export const CRAWLER_PALETTE: CrawlerPalette = { white: COLORS.white, silver: COLORS.silver, dark: COLORS.navy, deep: COLORS.deepBlue, blue: COLORS.blue };

/** 色違いのクローラーを組み立てる。lamps には色を変えられるランプの材質を集める。decorate は仕上げ前に呼ばれる */
export function buildCrawlerWith(
  pal: CrawlerPalette = CRAWLER_PALETTE,
  opts: { lamps?: THREE.MeshStandardMaterial[]; decorate?(b: Builder): void } = {},
): Model {
  const b = new Builder();
  const white = b.body(pal.white, 0.5, true), silver = b.body(pal.silver, 0.5, true), dark = b.body(pal.dark, 0.7, true);
  const deep = b.body(pal.deep, 0.6, true), blue = b.body(pal.blue, 0.5, true);
  // 低く構えた装甲ボディ
  b.block(0.8, 0.34, 1.05, white, b.vis, 0, 0.04, 0, 0.07);
  b.block(0.6, 0.1, 0.78, silver, b.vis, 0, 0.26, 0.03, 0.03);
  // 前面の傾斜アーマー
  b.mesh(wedgeGeo(0.5, 0.16, 0.2), silver, b.vis, 0, 0.26, 0.5);
  // 背中の青いストライプ
  for (const sx of [-1, 1]) {
    if (pal.glow === undefined) { b.lamp(0.03, 0.02, 0.62, b.vis, sx * 0.17, 0.315, 0.02); continue; }
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: pal.glow, emissiveIntensity: 1.4, roughness: 0.4 });
    opts.lamps?.push(m);
    b.mesh(boxGeo(0.03, 0.02, 0.62), m, b.vis, sx * 0.17, 0.315, 0.02).castShadow = false;
  }
  // 側面のパネルライン
  for (const sx of [-1, 1]) for (const z of [-0.25, 0.1, 0.4]) b.mesh(boxGeo(0.02, 0.2, 0.025), dark, b.vis, sx * 0.4, 0.04, z);
  // 脚（付け根で回る）：上腿 → 膝 → すね → 爪
  const legs: THREE.Group[] = [];
  const hips: [number, number][] = [[-0.34, 0.3], [0.34, 0.3], [-0.34, -0.3], [0.34, -0.3]];
  for (const [hx, hz] of hips) {
    const s = Math.sign(hx);
    const hip = new THREE.Group();
    hip.position.set(hx, -0.1, hz);
    b.vis.add(hip);
    b.prism(0.09, 0.16, 6, blue, hip).rotation.z = Math.PI / 2;
    b.block(0.12, 0.3, 0.12, silver, hip, s * 0.1, -0.1, 0, 0.03).rotation.z = s * 0.78;
    b.prism(0.075, 0.12, 6, deep, hip, s * 0.2, -0.2, 0).rotation.z = Math.PI / 2;
    b.mesh(taperGeo(0.07, 0.035, 0.4, 4), silver, hip, s * 0.25, -0.39, 0).rotation.z = s * 0.25;
    b.mesh(taperGeo(0.035, 0.0, 0.14, 4), dark, hip, s * 0.3, -0.6, 0);
    legs.push(hip);
  }
  (b.parts as any).legs = legs;
  // 頭：くさび型 + 吊り目のスリット + 牙
  b.block(0.46, 0.26, 0.32, dark, b.vis, 0, 0.1, 0.58, 0.05);
  for (const sx of [-1, 1]) {
    b.mesh(boxGeo(0.16, 0.05, 0.04), b.eye(), b.vis, sx * 0.11, 0.14, 0.75).rotation.z = -sx * 0.3;
    b.mesh(taperGeo(0.0, 0.05, 0.24, 4), silver, b.vis, sx * 0.13, -0.02, 0.8).rotation.x = Math.PI / 2;
  }
  // 背中の電池（弱点）と固定ブラケット
  b.block(0.36, 0.1, 0.52, dark, b.vis, 0, 0.36, -0.15, 0.03);
  for (const sx of [-1, 1]) for (const dz of [-0.22, 0.22]) b.mesh(boxGeo(0.04, 0.14, 0.04), dark, b.vis, sx * 0.17, 0.43, -0.15 + dz);
  b.weak(0, 0.46, -0.15, 0.24, [1, 0.7, 1.4], 0.19);
  opts.decorate?.(b);
  return b.done();
}

function buildCrawler(): Model { return buildCrawlerWith(); }

function buildGunner(): Model {
  const b = new Builder();
  const white = b.body(COLORS.white, 0.5, true), blue = b.body(COLORS.deepBlue, 0.6, true), dark = b.body(COLORS.navy, 0.7, true);
  const silver = b.body(COLORS.silver, 0.5, true), bright = b.body(COLORS.blue, 0.5, true);
  // 胴体：装甲トルソー + 胸プレート + 背負いユニット
  b.block(0.95, 0.85, 0.7, white, b.vis, 0, 0.02, 0, 0.1);
  b.block(0.72, 0.4, 0.12, silver, b.vis, 0, 0.14, 0.36, 0.04);
  b.lamp(0.5, 0.04, 0.02, b.vis, 0, 0.14, 0.43);
  b.block(0.6, 0.5, 0.22, dark, b.vis, 0, 0.12, -0.42, 0.05);
  for (const sx of [-1, 1]) b.prism(0.05, 0.3, 6, silver, b.vis, sx * 0.2, 0.5, -0.45);
  b.block(0.8, 0.12, 0.62, dark, b.vis, 0, -0.38, 0, 0.03);
  // 肩アーマー（左）と静止した左腕
  b.block(0.3, 0.28, 0.54, bright, b.vis, -0.55, 0.32, 0.04, 0.06);
  b.prism(0.12, 0.2, 6, dark, b.vis, -0.55, 0.12, 0.04).rotation.z = Math.PI / 2;
  b.block(0.2, 0.46, 0.24, blue, b.vis, -0.55, -0.12, 0.05, 0.04);
  b.block(0.26, 0.2, 0.3, dark, b.vis, -0.55, -0.44, 0.08, 0.04);
  // 脚
  const legs: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.26, -0.35, 0);
    b.vis.add(hip);
    b.block(0.26, 0.16, 0.28, blue, hip, 0, -0.04, 0, 0.04);
    b.mesh(taperGeo(0.1, 0.08, 0.16, 6), silver, hip, 0, -0.17, 0.02);
    b.prism(0.025, 0.2, 4, dark, hip, 0, -0.14, 0.14);
    b.block(0.3, 0.12, 0.46, dark, hip, 0, -0.29, 0.07, 0.04);
    legs.push(hip);
  }
  (b.parts as any).legs = legs;
  // 頭（グループごと首振り）
  const head = new THREE.Group();
  head.position.set(0, 0.64, 0.04);
  b.vis.add(head);
  b.prism(0.14, 0.12, 6, dark, b.vis, 0, 0.49, 0.02);
  b.block(0.54, 0.36, 0.48, silver, head, 0, 0, 0, 0.07);
  b.block(0.44, 0.18, 0.1, dark, head, 0, 0.02, 0.25, 0.03);
  b.mesh(boxGeo(0.36, 0.07, 0.04), b.eye(), head, 0, 0.02, 0.31);
  for (const sx of [-1, 1]) b.block(0.07, 0.2, 0.22, bright, head, sx * 0.3, 0, -0.02, 0.02);
  b.parts.head = head;
  // 頭のセンサー（弱点）
  b.prism(0.03, 0.16, 6, dark, b.vis, 0, 0.9, 0);
  b.block(0.16, 0.04, 0.16, dark, b.vis, 0, 0.82, 0, 0.015);
  b.weak(0, 1.0, 0, 0.2, [1, 1, 1], 0.12);
  // 砲腕
  const arm = new THREE.Group();
  arm.position.set(0.52, 0.02, 0.1);
  b.vis.add(arm);
  b.block(0.26, 0.34, 0.3, bright, arm, 0.0, 0, 0, 0.06);
  b.block(0.22, 0.22, 0.4, dark, arm, 0, 0, 0.3, 0.05);
  b.prism(0.065, 0.3, 8, silver, arm, 0, 0, 0.58).rotation.x = Math.PI / 2;
  b.block(0.14, 0.1, 0.22, bright, arm, 0, 0.16, 0.28, 0.03);
  b.block(0.15, 0.15, 0.08, dark, arm, 0, 0, 0.7, 0.02);
  b.lamp(0.09, 0.09, 0.04, arm, 0, 0, 0.75, 1.8);
  b.parts.arm = arm;
  return b.done();
}

function buildHeavy(): Model {
  const b = new Builder();
  const white = b.body(COLORS.white, 0.5, true), deep = b.body(COLORS.deepBlue, 0.6, true), dark = b.body(COLORS.navy, 0.7, true);
  const silver = b.body(COLORS.silver, 0.5, true), blue = b.body(COLORS.blue, 0.5, true);
  // 胴体：巨大な装甲ブロック
  b.block(2.0, 1.4, 1.7, white, b.vis, 0, 0.15, 0, 0.18);
  b.block(1.6, 0.14, 1.3, silver, b.vis, 0, 0.9, 0, 0.05);
  b.block(2.02, 0.4, 1.4, dark, b.vis, 0, -0.35, 0, 0.08);
  // 光るライン（側面・前面）
  for (const sx of [-1, 1]) {
    b.lamp(0.04, 0.05, 1.4, b.vis, sx * 1.03, -0.05, 0.0, 1.2);
    for (let i = 0; i < 4; i++) b.mesh(boxGeo(0.03, 0.4, 0.06), dark, b.vis, sx * 1.02, 0.45, -0.5 + i * 0.35);
  }
  b.lamp(1.4, 0.05, 0.04, b.vis, 0, -0.05, 0.87, 1.2);
  // 足（大きな箱足 + くさびのつま先）
  const legs: THREE.Mesh[][] = [];
  for (const sx of [-1, 1]) {
    legs.push([
      b.block(0.76, 0.56, 1.1, deep, b.vis, sx * 0.72, -0.9, 0.05, 0.1),
      b.mesh(wedgeGeo(0.7, 0.3, 0.3), blue, b.vis, sx * 0.72, -1.05, 0.72),
      b.prism(0.12, 0.3, 6, silver, b.vis, sx * 0.72, -0.55, 0),
    ]);
  }
  // 演出（cinematic/）の歩き用：左右の足のパーツ
  b.parts.legs = legs;
  // 腕（肩で回る）：肩関節 + 肩パッド + ピストン + 拳
  const arms: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(sx * 1.05, 0.35, 0.1);
    b.vis.add(sh);
    b.prism(0.32, 0.44, 8, blue, sh).rotation.z = Math.PI / 2;
    b.block(0.5, 0.2, 0.7, white, sh, sx * 0.03, 0.36, 0, 0.06);
    b.block(0.3, 0.55, 0.32, deep, sh, sx * 0.05, -0.3, 0, 0.06);
    b.prism(0.05, 0.5, 6, silver, sh, sx * 0.05, -0.3, 0.24);
    b.block(0.72, 0.64, 0.72, silver, sh, sx * 0.1, -0.78, 0.12, 0.1);
    for (const dx of [-0.2, 0, 0.2]) b.block(0.14, 0.14, 0.1, dark, sh, sx * 0.1 + dx, -0.68, 0.52, 0.03);
    arms.push(sh);
  }
  (b.parts as any).arms = arms;
  // 頭（バイザー付きヘルメット）
  b.block(0.8, 0.5, 0.6, deep, b.vis, 0, 1.1, 0.4, 0.1);
  b.block(0.5, 0.1, 0.4, silver, b.vis, 0, 1.4, 0.4, 0.03);
  b.block(0.7, 0.24, 0.1, dark, b.vis, 0, 1.12, 0.72, 0.03);
  for (const sx of [-1, 1]) {
    b.mesh(boxGeo(0.25, 0.07, 0.05), b.eye(), b.vis, sx * 0.18, 1.13, 0.78);
    b.prism(0.02, 0.4, 4, dark, b.vis, sx * 0.34, 1.5, 0.3);
  }
  // 前の小さな弱点（受け口つき）
  const front = b.weak(0, 0.12, 1.12, 0.2, [1, 1, 1], 0.14);
  b.prism(0.26, 0.2, 8, dark, b.vis, 0, 0.12, 0.95).rotation.x = Math.PI / 2;
  // 背中：コイル2本と、フレームに囲われた大きなバッテリー（弱点）
  for (const sx of [-1, 1]) {
    b.prism(0.1, 0.5, 6, dark, b.vis, sx * 0.55, 1.15, -0.4);
    for (const y of [1.0, 1.15, 1.3]) b.prism(0.16, 0.04, 6, silver, b.vis, sx * 0.55, y, -0.4);
    b.lamp(0.1, 0.1, 0.1, b.vis, sx * 0.55, 1.45, -0.4, 1.8);
  }
  for (const sx of [-1, 1]) b.block(0.14, 0.7, 0.22, dark, b.vis, sx * 0.5, 0.75, -1.3, 0.04);
  b.block(1.14, 0.12, 0.22, dark, b.vis, 0, 1.12, -1.3, 0.04);
  b.block(1.14, 0.12, 0.22, dark, b.vis, 0, 0.42, -1.3, 0.04);
  b.block(1.0, 0.6, 0.12, silver, b.vis, 0, 0.78, -0.95, 0.03);
  const back = b.weak(0, 0.78, -1.2, 0.5, [0.9, 1.1, 0.7], 0.45);
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
  const coral = b.body(COLORS.white, 0.5, true), orange = b.body(COLORS.silver, 0.5, true), red = b.body(COLORS.deepBlue, 0.5, true), dark = b.body(COLORS.navy, 0.7, true);
  const lid = b.body(COLORS.blue, 0.5, true);
  // コア本体（青い核の収納部）：多面体
  b.mesh(icoGeo(1.6, 1), red, b.vis, 0, 0, 0);
  b.mesh(icoGeo(1.75, 1), dark, b.vis, 0, 0, -0.1).scale.set(1, 0.7, 1);
  // 周囲を回る装甲板（面で区切った多面体の板）
  const orbit = new THREE.Group();
  b.vis.add(orbit);
  const plates: THREE.Mesh[] = [];
  const plateGeo = geo('bossPlate', () => new THREE.SphereGeometry(2.05, 3, 3, 0, 0.7, Math.PI * 0.22, Math.PI * 0.56));
  const plateMat = coral;
  plateMat.side = THREE.DoubleSide;
  orange.side = THREE.DoubleSide;
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(plateGeo, i % 2 ? plateMat : orange);
    p.rotation.y = (i / 6) * Math.PI * 2;
    p.castShadow = true;
    orbit.add(p);
    plates.push(p);
  }
  (b.parts as any).plates = plates;
  b.parts.orbit = orbit;
  // 目のランプ（スリット）
  for (let i = 0; i < 3; i++) {
    const a = (i - 1) * 0.5;
    const eye = b.mesh(boxGeo(0.34, 0.1, 0.1), b.eye(), b.vis, Math.sin(a) * 2.0, 1.45, Math.cos(a) * 1.4);
    eye.rotation.y = a;
  }
  // 前面のまぶた（コアを隠す）：面取りブロック
  const lidTop = b.block(2.7, 0.62, 1.3, lid, b.vis, 0, 0.55, 1.9, 0.2);
  const lidBot = b.block(2.7, 0.62, 1.3, lid, b.vis, 0, -0.55, 1.9, 0.2);
  b.parts.lidTop = lidTop;
  b.parts.lidBot = lidBot;
  // 弱点コア（前面。体の球の表面付近に出して判定が弱点優先になるようにする）
  const wp = b.weak(0, 0, 1.45, 1.0, [1, 1, 1], 0.95);
  b.parts.core = wp.mesh;
  return b.done();
}

/** 新しい敵の種類は kinds/ に1ファイルずつ置き、ここに登録する（kinds/index.ts） */
let kindBuilders: Partial<Record<EnemyKind, () => Model>> = {};
export function registerKindBuilders(b: Partial<Record<EnemyKind, () => Model>>): void { kindBuilders = { ...kindBuilders, ...b }; }

export function buildModel(kind: EnemyKind): Model {
  switch (kind) {
    case 'drone': return buildDrone();
    case 'crawler': return buildCrawler();
    case 'gunner': return buildGunner();
    case 'heavy': return buildHeavy();
    case 'boss': return buildBoss();
    default: {
      const f = kindBuilders[kind];
      if (!f) throw new Error(`no model for enemy kind: ${kind}`);
      return f();
    }
  }
}

export function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = (c as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) m.forEach((x) => x.dispose()); else m?.dispose?.();
  });
}
