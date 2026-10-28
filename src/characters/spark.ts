// スパーク（火星の天才研究者）の見た目：手続き生成。主人公と同じトゥーン＋裏面法線アウトライン。
// 足元 y=0、+Z 向き。キャラ右手 = -X（ここにタブレット）、左 = +X。単位は m、身長 約1.72。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CHARACTER as C } from '../config/balance';

export type SparkPose = 'idle' | 'tablet' | 'talk' | 'wave';
export interface Spark {
  root: THREE.Group;
  setPose(p: SparkPose): void;
  update(dt: number): void;
  setGlasses(on: boolean): void;
  dispose(): void;
}

type V3 = [number, number, number];

// ---- 色（キャラシート）----
const K = {
  hair: 0xf2d27a, hairLight: 0xfbe7a6, hairDark: 0xd9b25a, brow: 0xc19a46,
  eye: 0x7f95c6, skin: 0xf7dcc8, lip: 0xc2655f,
  coat: 0xeef0f3, coatShade: 0xcfd4dc, black: 0x1b1b1f,
  belt: 0x5a5d63, silver: 0xd2d6de, yellow: 0xf2b01e,
  pants: 0x3a3b40, pantsDark: 0x2c2d31, tablet: 0x2c2e34, earring: 0x9fd6ff,
};

function makeGradient(): THREE.DataTexture {
  const data = new Uint8Array(C.toonTones.map((v) => Math.round(v * 255)));
  const t = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** 裏面を法線方向へ押し出すアウトライン */
function outlineMat(thick: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: C.colors.outline, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed += normalize(normal) * ${thick.toFixed(4)};`);
  };
  m.customProgramCacheKey = () => 'sparkOutline' + thick;
  return m;
}

/** 先細りのリボン状チューブ（髪束）。ref は幅方向の基準ベクトル */
function strandGeo(pts: THREE.Vector3[], w: (t: number) => number, th: (t: number) => number, ref = new THREE.Vector3(1, 0, 0), seg = 30, rad = 8): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const pos: number[] = [];
  const idx: number[] = [];
  const W = new THREE.Vector3(), N = new THREE.Vector3(), P = new THREE.Vector3(), T = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, P); curve.getTangentAt(t, T);
    W.copy(ref).addScaledVector(T, -ref.dot(T));
    if (W.lengthSq() < 1e-6) W.set(0, 0, 1).addScaledVector(T, -T.z);
    W.normalize(); N.crossVectors(T, W);
    const ww = w(t), tt = th(t);
    for (let j = 0; j < rad; j++) {
      const a = (j / rad) * Math.PI * 2, c = Math.cos(a) * ww, s = Math.sin(a) * tt;
      pos.push(P.x + W.x * c + N.x * s, P.y + W.y * c + N.y * s, P.z + W.z * c + N.z * s);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < rad; j++) {
    const a = i * rad + j, b = i * rad + ((j + 1) % rad), c = (i + 1) * rad + j, d = (i + 1) * rad + ((j + 1) % rad);
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 髪の経路：キー点を密にサンプルして横方向にうねりを足す */
function wavyPath(keys: V3[], n: number, amp: number, freq: number, phase: number, zAmp = 0.35): THREE.Vector3[] {
  const c = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k)), false, 'catmullrom', 0.5);
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = c.getPointAt(t);
    const env = Math.min(1, t * 2.2) * (0.35 + 0.65 * t);
    p.x += Math.sin(t * freq * Math.PI * 2 + phase) * amp * env;
    p.z += Math.cos(t * freq * Math.PI * 2 + phase) * amp * zAmp * env;
    out.push(p);
  }
  return out;
}

// コートの外形（高さ→半径）。X は ×1.2、Z は ×0.75 に潰す
const COAT_PROFILE: [number, number][] = [[0.36, 0.31], [0.5, 0.285], [0.7, 0.25], [0.9, 0.215], [1.05, 0.2], [1.2, 0.195], [1.3, 0.19], [1.37, 0.165], [1.42, 0.12], [1.45, 0.085]];
const COAT_SX = 1.2, COAT_SZ = 0.75;
function coatR(y: number): number {
  const p = COAT_PROFILE;
  if (y <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) if (y <= p[i][0]) { const t = (y - p[i - 1][0]) / (p[i][0] - p[i - 1][0]); return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t; }
  return p[p.length - 1][1];
}

export function createSpark(opts: { glasses?: boolean } = {}): Spark {
  const root = new THREE.Group();
  root.name = 'Spark';
  const gradient = makeGradient();
  const matCache = new Map<string, THREE.Material>();
  const toon = (color: number, side: THREE.Side = THREE.FrontSide): THREE.MeshToonMaterial => {
    const k = color + ':' + side;
    let m = matCache.get(k) as THREE.MeshToonMaterial | undefined;
    if (!m) { m = new THREE.MeshToonMaterial({ color, gradientMap: gradient, side }); matCache.set(k, m); }
    return m;
  };
  const basic = (color: number, opacity = 1): THREE.MeshBasicMaterial => {
    const k = 'b' + color + ':' + opacity;
    let m = matCache.get(k) as THREE.MeshBasicMaterial | undefined;
    if (!m) { m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide }); matCache.set(k, m); }
    return m;
  };
  const outCache = new Map<number, THREE.MeshBasicMaterial>();
  const outM = (t: number): THREE.MeshBasicMaterial => { let m = outCache.get(t); if (!m) { m = outlineMat(t); outCache.set(t, m); } return m; };

  // ---- 関節（絶対座標の rest を持つ）----
  const restOf = (o: THREE.Object3D): THREE.Vector3 => (o.userData.rest as THREE.Vector3) ?? new THREE.Vector3();
  const joint = (parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group => {
    const g = new THREE.Group();
    g.userData.rest = new THREE.Vector3(x, y, z);
    g.position.set(x, y, z).sub(restOf(parent));
    parent.add(g);
    return g;
  };
  /** 絶対座標でメッシュを追加。geo のスケールは事前に焼き込む */
  const put = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, p: V3, r: V3 = [0, 0, 0], ol: number | null = 0.005): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(p[0], p[1], p[2]).sub(restOf(parent));
    m.rotation.set(r[0], r[1], r[2]);
    if (ol) m.add(new THREE.Mesh(geo, outM(ol)));
    parent.add(m);
    return m;
  };
  const sph = (r: number, sx = 1, sy = 1, sz = 1, ws = 18, hs = 14): THREE.BufferGeometry => { const g = new THREE.SphereGeometry(r, ws, hs); g.scale(sx, sy, sz); return g; };
  const cyl = (rt: number, rb: number, h: number, seg = 16, sx = 1, sz = 1): THREE.BufferGeometry => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.scale(sx, 1, sz); return g; };
  const rbox = (w: number, h: number, d: number, r = 0.01): THREE.BufferGeometry => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  /** 閉じた薄殻の回転体（外面→内面）。phi 範囲を指定してコートの前開きを作る */
  const shell = (prof: [number, number][], thick: number, phi0: number, phiLen: number, sx: number, sz: number): THREE.BufferGeometry => {
    const outer = prof.map(([y, r]) => new THREE.Vector2(r, y));
    const inner = prof.map(([y, r]) => new THREE.Vector2(r - thick, y)).reverse();
    const g = new THREE.LatheGeometry([...outer, ...inner, outer[0]], 40, phi0, phiLen);
    g.scale(sx, 1, sz);
    return g;
  };

  const body = new THREE.Group(); // 全体
  root.add(body);
  const upper = joint(body, 0, 1.0, 0); // 胴（呼吸）
  const headJ = joint(upper, 0, 1.46, 0);

  // ================= 足 =================
  const legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  for (const s of [-1, 1]) {
    const hx = s * 0.088;
    const hip = joint(body, hx, 0.93, 0);
    const knee = joint(hip, hx, 0.5, 0);
    const ankle = joint(knee, hx, 0.11, 0);
    legs.push({ hip, knee });
    // ゆったりカーゴパンツ（太もも→膝→足首で絞る）
    put(hip, cyl(0.098, 0.082, 0.43, 16, 1, 0.95), toon(K.pants), [hx, 0.715, 0], [0, 0, 0], 0.006);
    put(hip, sph(0.095, 1, 0.9, 0.95), toon(K.pants), [hx, 0.93, 0], [0, 0, 0], 0.006);
    put(knee, sph(0.083, 1, 0.9, 0.95), toon(K.pants), [hx, 0.5, 0.004], [0, 0, 0], 0.006);
    put(knee, cyl(0.084, 0.066, 0.4, 16, 1, 0.95), toon(K.pants), [hx, 0.31, 0], [0, 0, 0], 0.006);
    put(knee, rbox(0.03, 0.12, 0.09, 0.008), toon(K.pantsDark), [hx + s * 0.082, 0.36, 0.0], [0, 0, 0], 0.004); // カーゴポケット
    put(knee, cyl(0.07, 0.074, 0.04, 14), toon(K.pantsDark), [hx, 0.15, 0], [0, 0, 0], 0.005); // すそのギャザー
    // ブーツ：白い甲と黒ソール、黒/黄のストラップ
    put(ankle, cyl(0.066, 0.07, 0.15, 16), toon(K.coat), [hx, 0.15, -0.005], [0, 0, 0], 0.005);
    put(ankle, rbox(0.108, 0.085, 0.2, 0.035), toon(K.coat), [hx, 0.07, 0.055], [0, 0, 0], 0.006);
    put(ankle, sph(0.058, 0.95, 0.75, 1.15), toon(K.coat), [hx, 0.065, 0.12], [0, 0, 0], 0.006);
    put(ankle, rbox(0.122, 0.034, 0.29, 0.015), toon(K.black), [hx, 0.017, 0.062], [0, 0, 0], 0.005);
    put(ankle, cyl(0.073, 0.073, 0.022, 16), toon(K.black), [hx, 0.15, -0.005], [0, 0, 0], 0.004);
    put(ankle, cyl(0.07, 0.07, 0.016, 16), toon(K.yellow), [hx, 0.185, -0.005], [0, 0, 0], 0.004);
    put(ankle, rbox(0.1, 0.02, 0.05, 0.008), toon(K.black), [hx, 0.1, 0.1], [0, 0, 0], 0.004);
    put(ankle, rbox(0.03, 0.022, 0.052, 0.008), toon(K.yellow), [hx + s * 0.05, 0.1, 0.1], [0, 0, 0], 0.003);
    put(ankle, rbox(0.04, 0.03, 0.06, 0.01), toon(K.yellow), [hx + s * 0.062, 0.12, 0.0], [0, 0, 0], 0.003);
  }
  // 右太もものホルスター（黒ポーチ＋黄アクセント）
  put(legs[0].hip, rbox(0.07, 0.15, 0.06, 0.015), toon(K.black), [-0.145, 0.7, 0.07], [0, 0.2, 0], 0.005);
  put(legs[0].hip, rbox(0.075, 0.025, 0.065, 0.008), toon(K.yellow), [-0.145, 0.75, 0.07], [0, 0.2, 0], 0.003);
  put(legs[0].hip, rbox(0.075, 0.02, 0.065, 0.008), toon(K.yellow), [-0.145, 0.65, 0.07], [0, 0.2, 0], 0.003);
  put(legs[0].hip, rbox(0.1, 0.03, 0.1, 0.01), toon(K.black), [-0.11, 0.85, 0.06], [0, 0.1, 0], 0.004);

  // ================= 胴：黒タートルネック =================
  const torsoProf: [number, number][] = [[0.9, 0.15], [1.0, 0.125], [1.08, 0.112], [1.18, 0.125], [1.27, 0.148], [1.34, 0.14], [1.4, 0.1], [1.43, 0.058], [1.46, 0.048], [1.54, 0.044]];
  put(upper, shell(torsoProf, 0.01, 0, Math.PI * 2, 1.05, 0.72), toon(K.black), [0, 0, 0], [0, 0, 0], 0.005);
  put(upper, sph(0.062, 1, 0.9, 0.9), toon(K.black), [0.067, 1.27, 0.062], [0, 0, 0], 0.004); // 胸のふくらみ
  put(upper, sph(0.062, 1, 0.9, 0.9), toon(K.black), [-0.067, 1.27, 0.062], [0, 0, 0], 0.004);
  put(upper, cyl(0.052, 0.058, 0.07, 18), toon(K.black), [0, 1.5, 0], [0, 0, 0], 0.004); // 首のロール
  // ベルト（グレーのウェビング）とバックル、IDカード
  put(body, cyl(0.138, 0.138, 0.04, 22, 1.05, 0.74), toon(K.belt), [0, 1.0, 0], [0, 0, 0], 0.004);
  put(body, rbox(0.05, 0.045, 0.014, 0.006), toon(K.silver), [0, 1.0, 0.108], [0, 0, 0], 0.003);
  put(body, rbox(0.026, 0.026, 0.016, 0.004), toon(K.belt), [0, 1.0, 0.112], [0, 0, 0], 0.002);
  put(body, rbox(0.012, 0.04, 0.008, 0.003), toon(K.silver), [0.13, 0.985, 0.075], [0, 0.5, 0], 0.002); // クリップ
  put(body, rbox(0.055, 0.075, 0.006, 0.006), toon(K.coat), [0.135, 0.93, 0.083], [0, 0.55, 0], 0.003); // IDカード
  put(body, rbox(0.045, 0.02, 0.008, 0.003), toon(K.hairDark), [0.135, 0.96, 0.086], [0, 0.55, 0], 0.001);
  put(body, rbox(0.05, 0.065, 0.04, 0.01), toon(K.black), [-0.14, 0.97, 0.06], [0, -0.5, 0], 0.004); // 右腰の小ポーチ
  put(body, rbox(0.052, 0.014, 0.042, 0.005), toon(K.yellow), [-0.14, 0.99, 0.06], [0, -0.5, 0], 0.003);

  // ================= ロング白衣 =================
  const GAP = 0.5, SLIT = 0.07;
  const coatMat = toon(K.coat);
  for (const [p0, len] of [[GAP, Math.PI - SLIT - GAP], [Math.PI + SLIT, Math.PI - SLIT - GAP]] as [number, number][]) {
    put(body, shell(COAT_PROFILE, 0.012, p0, len, COAT_SX, COAT_SZ), coatMat, [0, 0, 0], [0, 0, 0], 0.006);
  }
  // 立ち襟
  put(upper, shell([[1.43, 0.082], [1.47, 0.092], [1.52, 0.105]], 0.01, 0.55, Math.PI * 2 - 1.1, 1, 0.9), toon(K.coat), [0, 0, 0], [0, 0, 0], 0.005);
  /** コート表面上の点と向き */
  const onCoat = (y: number, phi: number, off: number): { p: V3; yaw: number } => {
    const r = coatR(y), a = r * COAT_SX, b = r * COAT_SZ;
    const nx = Math.sin(phi) / a, nz = Math.cos(phi) / b, nl = Math.hypot(nx, nz);
    return { p: [a * Math.sin(phi) + (nx / nl) * off, y, b * Math.cos(phi) + (nz / nl) * off], yaw: Math.atan2(nx, nz) };
  };
  // ラペル（折り返し襟）。+X 側で作り、-X は左右反転
  for (const s of [-1, 1]) {
    const sh = new THREE.Shape();
    const pts: [number, number][] = [[0.0, 0.15], [0.06, 0.12], [0.085, 0.04], [0.04, -0.06], [0.0, -0.15], [-0.02, -0.02]];
    pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
    const lg = new THREE.ExtrudeGeometry(sh, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
    lg.translate(0, 0, -0.005);
    if (s < 0) {
      lg.scale(-1, 1, 1);
      const a = lg.index ? (lg.index.array as Uint16Array | Uint32Array) : null;
      if (a) for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; }
      else {
        const p = lg.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i += 3) { const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1); p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)); p.setXYZ(i + 2, x, y, z); }
      }
      lg.computeVertexNormals();
    }
    put(upper, lg, toon(K.coat), [s * 0.1, 1.28, 0.128], [0.1, s * 0.5, s * -0.1], 0.004);
  }
  // ポケット類（胸ポケット=左胸/+X、腰のパッチポケット）
  const pocket = (y: number, phi: number, w: number, h: number): void => {
    const c = onCoat(y, phi, 0.008);
    put(body, rbox(w, h, 0.016, 0.006), toon(K.coat), c.p, [0, c.yaw, 0], 0.004);
    const f = onCoat(y + h / 2 - 0.012, phi, 0.017);
    put(body, rbox(w * 0.96, 0.022, 0.006, 0.003), toon(K.coatShade), f.p, [0, f.yaw, 0], 0.002);
  };
  pocket(1.16, 1.0, 0.075, 0.07);   // 胸（左）
  pocket(0.82, 0.98, 0.125, 0.14);  // 腰 左
  pocket(0.82, -0.98, 0.125, 0.14); // 腰 右
  {
    const c = onCoat(1.2, 1.0, 0.02); // ペン（青・黒）
    put(body, cyl(0.0045, 0.0045, 0.05, 8), toon(0x2f6fd6), [c.p[0] + 0.012 * Math.cos(c.yaw), c.p[1], c.p[2] - 0.012 * Math.sin(c.yaw)], [0, 0, 0], 0.0025);
    put(body, cyl(0.0045, 0.0045, 0.05, 8), toon(K.black), [c.p[0] - 0.012 * Math.cos(c.yaw), c.p[1] - 0.004, c.p[2] + 0.012 * Math.sin(c.yaw)], [0, 0, 0], 0.0025);
  }

  // ================= 腕 =================
  interface ArmRig { sh: THREE.Group; el: THREE.Group; hand: THREE.Group }
  const UP = 0.27, FORE = 0.25;
  const arm = (s: number): ArmRig => {
    const sx = s * 0.175, sy = 1.385;
    const sh = joint(upper, sx, sy, 0);
    const el = joint(sh, sx, sy - UP, 0);
    const hand = joint(el, sx, sy - UP - FORE, 0);
    // 上腕：白衣の袖
    put(sh, sph(0.056), toon(K.coat), [sx, sy, 0], [0, 0, 0], 0.005);
    put(sh, cyl(0.054, 0.05, UP, 14), toon(K.coat), [sx, sy - UP / 2, 0], [0, 0, 0], 0.005);
    put(el, sph(0.05), toon(K.coat), [sx, sy - UP, 0], [0, 0, 0], 0.005);
    // 前腕：袖まくりのカフス、下は黒いタートル袖、手は肌
    put(el, cyl(0.05, 0.052, 0.07, 14), toon(K.coat), [sx, sy - UP - 0.035, 0], [0, 0, 0], 0.005);
    put(el, cyl(0.056, 0.056, 0.03, 14), toon(K.coatShade), [sx, sy - UP - 0.08, 0], [0, 0, 0], 0.005);
    put(el, cyl(0.038, 0.03, FORE - 0.085, 12), toon(K.black), [sx, sy - UP - 0.095 - (FORE - 0.095) / 2 + 0.01, 0], [0, 0, 0], 0.004);
    put(hand, sph(0.033, 0.85, 1.2, 0.7), toon(K.skin), [sx, sy - UP - FORE - 0.02, 0], [0, 0, 0], 0.003);
    put(hand, sph(0.014, 0.8, 1.3, 0.8), toon(K.skin), [sx + s * -0.028, sy - UP - FORE - 0.03, 0.018], [0.5, 0, 0], 0.002); // 親指
    return { sh, el, hand };
  };
  const armR = arm(-1), armL = arm(1);

  // タブレット（右手）。右前腕に付け、タブレットポーズで画面が顔のほうを向く
  const tabMount = new THREE.Group();
  tabMount.position.set(0, -0.03, 0);
  armR.hand.add(tabMount);
  {
    const tb = new THREE.Group();
    tb.position.set(0.085, 0.085, 0.0);
    const tbody = new THREE.Mesh(new RoundedBoxGeometry(0.235, 0.165, 0.014, 3, 0.012), toon(K.tablet));
    tbody.add(new THREE.Mesh(tbody.geometry, outM(0.004)));
    tb.add(tbody);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.215, 0.145), basic(0x182436));
    scr.position.z = -0.0075; scr.rotation.y = Math.PI;
    tb.add(scr);
    for (let i = 0; i < 4; i++) {
      const ln = new THREE.Mesh(new THREE.PlaneGeometry(0.06 + (i % 2) * 0.05, 0.007), basic(0x6fd0ff, 0.9));
      ln.position.set(-0.05 + (i % 2) * 0.03, 0.04 - i * 0.02, -0.0078); ln.rotation.y = Math.PI;
      tb.add(ln);
    }
    const chart = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), basic(0x3a86b8, 0.8));
    chart.position.set(0.068, -0.01, -0.0078); chart.rotation.y = Math.PI;
    tb.add(chart);
    tabMount.add(tb);
  }
  tabMount.rotation.x = 2.6;

  // ================= 頭 =================
  const HC: V3 = [0, 1.605, 0];
  const HA = 0.098, HB = 0.113, HCZ = 0.105; // 頭の楕円体半径
  const headGeo = (): THREE.BufferGeometry => {
    const g = new THREE.SphereGeometry(1, 32, 24);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y < 0) { const k = 1 + y * 0.12; x *= 1 - (-y) * 0.14 * (z > 0 ? 1.3 : 0.6); z *= k * (1 - (-y) * 0.06); } // あごを少しすぼめる
      p.setXYZ(i, x * HA, y * HB, z * HCZ);
    }
    g.computeVertexNormals();
    return g;
  };
  put(headJ, headGeo(), toon(K.skin), HC, [0, 0, 0], 0.005);
  put(headJ, cyl(0.04, 0.045, 0.06, 12), toon(K.skin), [0, 1.485, 0], [0, 0, 0], null);
  for (const s of [-1, 1]) {
    put(headJ, sph(0.018, 0.55, 1.1, 0.8), toon(K.skin), [s * 0.097, 1.595, -0.004], [0, 0, 0], 0.003);
    put(headJ, sph(0.0055), new THREE.MeshBasicMaterial({ color: K.earring }), [s * 0.1, 1.575, 0.0], [0, 0, 0], null); // ピアス
  }
  /** 顔の表面点（x, 目の高さからの dy）と外向き法線 */
  const facePt = (x: number, dy: number, off = 0): { p: THREE.Vector3; q: THREE.Quaternion } => {
    const k = 1 - (x / HA) ** 2 - (dy / HB) ** 2;
    const z = HCZ * Math.sqrt(Math.max(0.02, k));
    const n = new THREE.Vector3(x / (HA * HA), dy / (HB * HB), z / (HCZ * HCZ)).normalize();
    const p = new THREE.Vector3(HC[0] + x, HC[1] + dy, HC[2] + z).addScaledVector(n, off);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    return { p, q };
  };
  const faceGroup = (x: number, dy: number, off = 0.0008): THREE.Group => {
    const f = facePt(x, dy, off);
    const g = new THREE.Group();
    g.position.copy(f.p).sub(restOf(headJ)); g.quaternion.copy(f.q);
    headJ.add(g);
    return g;
  };
  const flat = (parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, z: number, x = 0, y = 0, opacity = 1): THREE.Mesh => {
    const m = new THREE.Mesh(geo, basic(color, opacity));
    m.position.set(x, y, z); parent.add(m); return m;
  };
  const circ = (rx: number, ry: number, seg = 20): THREE.BufferGeometry => { const g = new THREE.CircleGeometry(1, seg); g.scale(rx, ry, 1); return g; };
  // 目
  const eyes: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const g = faceGroup(s * 0.041, -0.012);
    g.scale.set(1.2, 1.2, 1);
    const sc = new THREE.Group(); g.add(sc);
    flat(sc, circ(0.0185, 0.0195), 0xf7f5f3, 0);
    flat(sc, circ(0.0128, 0.0175), K.eye, 0.0004, s * -0.0006, -0.0006);
    flat(sc, circ(0.0125, 0.007), 0x5a6fa4, 0.0006, s * -0.0006, 0.0075);     // 虹彩の上側の濃い部分
    flat(sc, circ(0.0058, 0.0092), 0x23283a, 0.0008, s * -0.0006, -0.0006);
    flat(sc, circ(0.0034, 0.0034, 12), 0xffffff, 0.001, s * 0.0032, 0.0062);
    flat(sc, circ(0.0016, 0.0016, 10), 0xffffff, 0.001, s * -0.0035, -0.0065);
    // 上まぶたのラッシュ＋目尻の跳ね
    const lash = new THREE.Mesh(new THREE.TorusGeometry(1, 0.085, 5, 20, Math.PI * 1.02), basic(0x4a3a30));
    lash.scale.set(0.0195, 0.0195, 0.12); lash.position.set(0, 0.0008, 0.0012); lash.rotation.z = -0.03;
    sc.add(lash);
    const tail = flat(sc, new THREE.PlaneGeometry(0.011, 0.0032), 0x4a3a30, 0.0012, s * 0.0205, 0.0035);
    tail.rotation.z = s * 0.35;
    flat(sc, new THREE.PlaneGeometry(0.02, 0.0012), 0xd6a79a, 0.0006, 0, -0.0192); // 下まつげの薄い線
    eyes.push(sc);
    // 眉
    const bg = faceGroup(s * 0.042, 0.03, 0.0012);
    bg.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(s * -0.017, -0.001, 0), new THREE.Vector3(s * -0.006, 0.0035, 0), new THREE.Vector3(s * 0.008, 0.004, 0), new THREE.Vector3(s * 0.018, -0.0025, 0)]), 10, 0.0013, 5), basic(K.brow)));
    flat(faceGroup(s * 0.058, -0.045, 0.0006), circ(0.012, 0.007), 0xf2a79a, 0, 0, 0, 0.3); // チーク
  }
  // 鼻（小さな影の線）
  {
    const ng = faceGroup(0.003, -0.036, 0.0008);
    flat(ng, new THREE.PlaneGeometry(0.007, 0.0016), 0xd49a86, 0, 0, 0).rotation.z = 0.3;
  }
  const mouthG = faceGroup(0, -0.066, 0.0008);
  const mouthOpen = new THREE.Mesh(circ(0.0085, 0.0075, 16), basic(0x7a2f35));
  mouthOpen.position.set(0, -0.003, 0.0002); mouthOpen.scale.y = 0.01; mouthG.add(mouthOpen);
  const smile = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.0135, 0.0045, 0), new THREE.Vector3(-0.007, -0.0013, 0.0006), new THREE.Vector3(0, -0.0032, 0.0008), new THREE.Vector3(0.007, -0.0013, 0.0006), new THREE.Vector3(0.0135, 0.0045, 0)]), 14, 0.0016, 5), basic(K.lip));
  mouthG.add(smile);

  // メガネ（細い黒の角丸フレーム）
  const glasses = new THREE.Group();
  headJ.add(glasses);
  {
    const gm = toon(K.black);
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        const x = s * 0.043 + 0.0315 * Math.sign(c) * Math.abs(c) ** 0.55, dy = -0.008 + 0.0235 * Math.sign(sn) * Math.abs(sn) ** 0.55;
        pts.push(facePt(x, dy, 0.011).p.sub(restOf(headJ)));
      }
      glasses.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 56, 0.0016, 5, true), gm));
      const a = facePt(s * 0.0745, -0.01, 0.011).p.sub(restOf(headJ));
      const b = new THREE.Vector3(s * 0.099, HC[1] - 0.008, -0.006).sub(restOf(headJ));
      glasses.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 4, 0.0014, 4), gm)); // テンプル
    }
    const br = [facePt(-0.0115, 0.002, 0.011).p, facePt(0, 0.007, 0.0145).p, facePt(0.0115, 0.002, 0.011).p].map((v) => v.sub(restOf(headJ)));
    glasses.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(br), 8, 0.0014, 4), gm));
  }
  glasses.visible = opts.glasses !== false;

  // ================= 髪 =================
  const hairMats = [toon(K.hair, THREE.DoubleSide), toon(K.hairLight, THREE.DoubleSide), toon(K.hairDark, THREE.DoubleSide)];
  const hm = (i: number): THREE.MeshToonMaterial => hairMats[i % 3] as THREE.MeshToonMaterial;
  // 頭頂のキャップ（額は見せる）
  {
    const g = new THREE.SphereGeometry(1, 36, 22, 0, Math.PI * 2, 0, 1.78);
    g.scale(HA + 0.013, HB + 0.014, HCZ + 0.012);
    g.rotateX(-0.42);
    put(headJ, g, hm(0), [HC[0], HC[1] + 0.004, HC[2] - 0.006], [0, 0, 0], null);
    put(headJ, sph(0.12, 1.0, 1.08, 1.0), hm(0), [0, 1.59, -0.048], [0, 0, 0], 0.004); // 後頭部のボリューム
  }
  const sway: { g: THREE.Group; ax: number; az: number; f: number; ph: number }[] = [];
  const addStrand = (parent: THREE.Object3D, pts: THREE.Vector3[], wFn: (t: number) => number, tFn: (t: number) => number, mi: number, ref: THREE.Vector3, ol: number | null = 0.003): THREE.Mesh => {
    const geo = strandGeo(pts.map((p) => p.clone().sub(restOf(parent))), wFn, tFn, ref);
    const m = new THREE.Mesh(geo, hm(mi));
    if (ol) m.add(new THREE.Mesh(geo, outM(ol)));
    parent.add(m);
    return m;
  };
  const taper = (w0: number, w1: number, tip = 0.55) => (t: number): number => (w0 + (w1 - w0) * Math.min(1, t * 1.3)) * (t > tip ? Math.max(0.04, 1 - ((t - tip) / (1 - tip)) ** 1.6) : 1);
  const frontRef = new THREE.Vector3(0.7, 0, 0.7);
  for (const s of [-1, 1]) {
    // サイドバング：分け目 → こめかみ → 頬の横 → 肩の前
    for (let k = 0; k < 2; k++) {
      const o = k * 0.012;
      const keys: V3[] = [[s * 0.004, 1.712, 0.058], [s * (0.05 + o), 1.7, 0.092], [s * (0.095 + o), 1.65, 0.105], [s * (0.112 + o), 1.585, 0.1], [s * (0.122 + o), 1.52, 0.092], [s * (0.14 + o), 1.44, 0.095], [s * (0.15 + o), 1.33, 0.12], [s * (0.14 + o), 1.2, 0.135]];
      addStrand(headJ, wavyPath(keys, 26, 0.008, 1.2, k, 0.3), taper(0.026 - k * 0.004, 0.02, 0.6), () => 0.011, k, new THREE.Vector3(0.6, 0, 0.8), 0.003);
    }
    // 肩から前に垂れるウェーブ髪（胸の前）
    for (let k = 0; k < 3; k++) {
      const x0 = s * (0.115 + k * 0.022);
      const keys: V3[] = [[s * 0.1, 1.6, -0.03], [x0, 1.5, 0.0], [x0 + s * 0.012, 1.4, 0.09 + k * 0.005], [x0 - s * 0.01, 1.28, 0.155 + k * 0.008], [x0 + s * 0.01, 1.12, 0.17 + k * 0.01], [x0 - s * 0.012, 0.98 - k * 0.07, 0.17 + k * 0.01]];
      addStrand(upper, wavyPath(keys, 36, 0.02, 1.7 + k * 0.3, k * 1.7 + (s > 0 ? 0 : 1.2)), taper(0.036 - k * 0.003, 0.032, 0.6), () => 0.017, k + 1, frontRef.clone().setX(0.7 * s));
    }
  }
  // 背中の大きな髪（腿まで）。支点は首の後ろ
  const hairPivot = joint(upper, 0, 1.55, -0.08);
  const backZ = (y: number, bulge = 0): number => -(coatR(Math.min(y, 1.3)) * COAT_SZ + 0.035 + bulge) + (y > 1.4 ? 0.04 : 0);
  const backStrand = (x0: number, yEnd: number, mi: number, wd: number, amp: number, freq: number, ph: number): void => {
    const ys = [1.64, 1.58, 1.46, 1.3, 1.1, 0.9, yEnd];
    const keys: V3[] = ys.map((y, i) => {
      const t = i / (ys.length - 1);
      const sp = Math.min(1, 0.15 + t * 1.6);
      return [x0 * sp, y, y > 1.6 ? -0.1 : backZ(y, 0.012 * Math.sin(t * 5 + ph))] as V3;
    });
    const g = new THREE.Group();
    g.position.copy(restOf(hairPivot)).sub(restOf(upper));
    g.userData.rest = restOf(hairPivot).clone();
    upper.add(g);
    addStrand(g, wavyPath(keys, 40, amp, freq, ph, 0.5), taper(wd, wd * 0.9, 0.78), (t) => 0.02 + t * 0.012, mi, new THREE.Vector3(1, 0, 0), 0.003);
    sway.push({ g, ax: 0.012 + Math.abs(x0) * 0.04, az: 0.014, f: 0.8 + Math.abs(ph) * 0.07, ph });
  };
  backStrand(0, 0.54, 2, 0.115, 0.012, 1.4, 0.3);
  backStrand(-0.06, 0.52, 0, 0.075, 0.018, 1.8, 1.2);
  backStrand(0.06, 0.54, 0, 0.075, 0.018, 1.7, 2.4);
  [-0.19, -0.145, -0.1, -0.05, 0.05, 0.1, 0.145, 0.19].forEach((x, i) => backStrand(x, 0.52 + ((i * 37) % 11) * 0.011, i % 3, 0.042, 0.026, 1.7 + (i % 3) * 0.35, i * 1.3));
  backStrand(-0.215, 0.68, 1, 0.035, 0.02, 1.9, 0.7);
  backStrand(0.215, 0.64, 1, 0.035, 0.02, 1.9, 2.9);
  for (const s of [-1, 1]) { // ハイライト束（キャップ上）
    const keys: V3[] = [[s * 0.012, 1.722, 0.02], [s * 0.05, 1.715, -0.02], [s * 0.085, 1.68, -0.06], [s * 0.1, 1.63, -0.1]];
    addStrand(headJ, wavyPath(keys, 14, 0.004, 1, 0), taper(0.016, 0.012, 0.4), () => 0.006, 1, new THREE.Vector3(0.7, 0.5, 0), null);
  }

  // ================= アニメーション =================
  const POSES: Record<SparkPose, Record<string, number>> = {
    idle:   { rsx: -0.3, rsz: -0.1, rex: -1.55, lsx: 0.04, lsz: 0.1, lex: -0.45, lez: 0, hp: 0.0, hr: 0, tb: 0 },
    tablet: { rsx: -0.55, rsz: -0.08, rex: -1.8, lsx: 0.05, lsz: 0.1, lex: -0.6, lez: 0, hp: 0.28, hr: 0.03, tb: 0.1 },
    talk:   { rsx: -0.3, rsz: -0.1, rex: -1.55, lsx: -0.25, lsz: 0.28, lex: -1.0, lez: 0, hp: -0.02, hr: 0.09, tb: 0 },
    wave:   { rsx: -0.3, rsz: -0.1, rex: -1.55, lsx: 0.1, lsz: 2.55, lex: -0.2, lez: 0, hp: -0.04, hr: -0.08, tb: 0 },
  };
  let pose: SparkPose = 'idle';
  const cur: Record<string, number> = { ...POSES.idle };
  let time = 0, blinkT = 2.5, blink = 0;
  const setPose = (p: SparkPose): void => { pose = p; };
  const update = (dt: number): void => {
    time += dt;
    const tgt = POSES[pose];
    const kk = 1 - Math.exp(-6 * dt);
    for (const k of Object.keys(tgt)) cur[k] += (tgt[k] - cur[k]) * kk;
    const br = Math.sin(time * 1.7); // 呼吸
    upper.scale.set(1 + br * 0.005, 1 + br * 0.006, 1 + br * 0.012);
    upper.rotation.x = br * 0.006;
    const wv = pose === 'wave' ? Math.sin(time * 7) : 0;
    const up = cur.lsz > 1 ? 1 : 0;
    armR.sh.rotation.set(cur.rsx + br * 0.01, 0, cur.rsz);
    armR.el.rotation.set(cur.rex, 0, 0);
    armL.sh.rotation.set(cur.lsx + br * 0.01, 0, cur.lsz + wv * 0.04 * up);
    armL.el.rotation.set(cur.lex + (pose === 'talk' ? Math.sin(time * 3.1) * 0.12 : 0), 0, cur.lez + wv * 0.35 * up);
    tabMount.rotation.x = 2.5 + cur.tb + Math.sin(time * 1.1) * 0.01;
    headJ.rotation.set(cur.hp + Math.sin(time * 0.8) * 0.01, Math.sin(time * 0.37) * 0.04, cur.hr + (pose === 'talk' ? Math.sin(time * 1.3) * 0.03 : 0));
    const talking = pose === 'talk' ? Math.max(0, Math.sin(time * 11) * Math.sin(time * 4.3 + 1)) : 0;
    mouthOpen.scale.y = 0.01 + talking * 1.1 + (pose === 'wave' ? 0.35 : 0);
    smile.scale.y = 1 - talking * 0.4;
    blinkT -= dt; // まばたき
    if (blinkT <= 0) { blink = 0.16; blinkT = 2.5 + Math.random() * 3; }
    if (blink > 0) blink -= dt;
    const bl = blink > 0 ? Math.abs(blink - 0.08) / 0.08 : 1;
    for (const e of eyes) e.scale.y = 0.08 + 0.92 * Math.min(1, bl);
    for (const s of sway) s.g.rotation.set(Math.sin(time * s.f + s.ph) * s.ax, 0, Math.sin(time * s.f * 0.8 + s.ph * 1.3) * s.az); // 髪のゆれ
  };
  const setGlasses = (on: boolean): void => { glasses.visible = on; };
  const dispose = (): void => {
    const geos = new Set<THREE.BufferGeometry>();
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) geos.add(m.geometry); });
    geos.forEach((g) => g.dispose());
    matCache.forEach((m) => m.dispose());
    outCache.forEach((m) => m.dispose());
    gradient.dispose();
  };
  update(0);
  return { root, setPose, update, setGlasses, dispose };
}
