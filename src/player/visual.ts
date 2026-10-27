// プレイヤーの見た目：重装・パワータイプのサイボーグ（キャラクターシート準拠）
// すべてコード生成。関節ごとの Group を持つリグ（腰→胴→胸→首→頭 / 肩→肘→手 / 股→膝→足首）。
// 各関節の静的パーツはマテリアルごとに1メッシュへマージし、アウトライン（裏面法線押し出し）を重ねる。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHARACTER as C } from '../config/balance';
import { DEFAULT_WEAPON, type WeaponBuilder, type WeaponDef } from './weapons';

export const CYAN = C.colors.cyan;

export interface ArmRig { shoulder: THREE.Group; elbow: THREE.Group; upper: number; fore: number }
export interface LegRig { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group }

export interface PlayerVisual {
  /** root の子。カメラが近すぎる時の非表示、上下の揺れ・傾きはここ */
  body: THREE.Group;
  /** 回避ロール用の回転軸（重心位置）。rig はこの下 */
  pivot: THREE.Group;
  rig: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Group;
  head: THREE.Group;
  legL: LegRig;
  legR: LegRig;
  armL: ArmRig;
  armR: ArmRig;
  /** 銃（胸の子。位置と向きはポーズ側で毎フレーム決める） */
  gunFrame: THREE.Group;
  muzzle: THREE.Object3D;
  /** スプリング腕の伸び量（1=縮んだ状態）。シェーダーの uniform */
  springStretch: { value: number };
  springMat: THREE.MeshToonMaterial;
  flashMats: THREE.MeshToonMaterial[];
  batteryMat: THREE.MeshBasicMaterial;
  gunGlowMat: THREE.MeshBasicMaterial;
  /** スカウター（耳の装置）のシアンのリング/ランプ。ON で強く光る */
  scouterMat: THREE.MeshBasicMaterial;
  scouterGlowMat: THREE.MeshBasicMaterial;
  scouterGlow: THREE.Mesh;
  /** 現在の武器（持ち方3点を含む） */
  weapon: WeaponDef;
  /** 武器モデルを差し替える（持ち方・銃口は WeaponDef に従って自動で合う） */
  setWeapon(def: WeaponDef): void;
  jets: THREE.Group;
  jetMats: THREE.MeshBasicMaterial[];
  jetLight: THREE.PointLight;
  chargeGroup: THREE.Group;
  chargeCore: THREE.Mesh;
  chargeGlow: THREE.Mesh;
  sparks: THREE.Mesh[];
  chargeLight: THREE.PointLight;
}

type Key = 'white' | 'grey' | 'dark' | 'dark2' | 'black' | 'yellow' | 'silver' | 'skin' | 'hair' | 'cyan' | 'battery' | 'lamp' | 'scouter';
type V3 = [number, number, number];

interface Joint { g: THREE.Group; rest: THREE.Vector3; parts: Map<Key, THREE.BufferGeometry[]> }

// ---- ジオメトリ小物 -------------------------------------------------------
/** 多角形（XY）を Z 方向に押し出した角ばった装甲板（Z中心） */
function poly(pts: [number, number][], depth: number, bevel = 0.012): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
}
/** 角を面取りした箱 */
function cbox(w: number, h: number, d: number, c: number, bevel = 0.01): THREE.BufferGeometry {
  const x = w / 2, y = h / 2;
  return poly([[-x + c, -y], [x - c, -y], [x, -y + c], [x, y - c], [x - c, y], [-x + c, y], [-x, y - c], [-x, -y + c]], d, bevel);
}
const mirror = (pts: [number, number][], s: number): [number, number][] => (s > 0 ? pts : pts.map(([x, y]) => [-x, y] as [number, number]).reverse());

/** らせん（Y 軸沿い、上から下へ）。t∈[0,1] */
class Helix extends THREE.Curve<THREE.Vector3> {
  constructor(private r: number, private len: number, private turns: number) { super(); }
  getPoint(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = t * this.turns * Math.PI * 2;
    return out.set(Math.cos(a) * this.r, -t * this.len, Math.sin(a) * this.r);
  }
}

function makeToonGradient(): THREE.DataTexture {
  const data = new Uint8Array(C.toonTones.map((v) => Math.round(v * 255)));
  const t = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** アウトライン：裏面を法線方向へ押し出し。stretch を渡すとバネのシェーダー伸びにも追従 */
function outlineMaterial(thick: number, stretch?: { value: number }): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: C.colors.outline, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    let vs = sh.vertexShader;
    if (stretch) {
      sh.uniforms.uStretch = stretch;
      vs = 'attribute float aAxial;\nuniform float uStretch;\n' + vs;
      vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed.y += aAxial * (uStretch - 1.0);`);
    }
    vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed += normalize(normal) * ${thick.toFixed(4)};`);
    sh.vertexShader = vs;
  };
  return m;
}

export function buildPlayerVisual(root: THREE.Group): PlayerVisual {
  while (root.children.length) root.remove(root.children[0]);

  const col = C.colors;
  const gradient = makeToonGradient();
  const flashMats: THREE.MeshToonMaterial[] = [];
  const toon = (color: number, side: THREE.Side = THREE.FrontSide): THREE.MeshToonMaterial => {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: gradient, side, emissive: 0xff3030, emissiveIntensity: 0 });
    flashMats.push(m);
    return m;
  };
  const batteryMat = new THREE.MeshBasicMaterial({ color: col.cyan, toneMapped: false });
  const gunGlowMat = new THREE.MeshBasicMaterial({ color: col.cyan, toneMapped: false });
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(col.cyan).multiplyScalar(0.45), toneMapped: false });
  const scouterMat = new THREE.MeshBasicMaterial({ color: C.scouter.offColor, toneMapped: false });
  const mats: Record<Key, THREE.Material> = {
    white: toon(col.white), grey: toon(col.grey), dark: toon(col.dark), dark2: toon(col.dark2), black: toon(col.black),
    yellow: toon(col.yellow), silver: toon(col.silver), skin: toon(col.skin), hair: toon(col.hair, THREE.DoubleSide),
    cyan: gunGlowMat, battery: batteryMat, lamp: lampMat, scouter: scouterMat,
  };
  const noOutline = new Set<Key>(['cyan', 'battery', 'hair', 'lamp', 'scouter']);
  const outMat = outlineMaterial(C.outline);

  const joints: Joint[] = [];
  const joint = (parent: Joint | null, x: number, y: number, z: number): Joint => {
    const g = new THREE.Group();
    const rest = new THREE.Vector3(x, y, z);
    g.position.copy(rest);
    if (parent) { g.position.sub(parent.rest); parent.g.add(g); }
    const j: Joint = { g, rest, parts: new Map() };
    joints.push(j);
    return j;
  };
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _m = new THREE.Matrix4();
  /** 絶対（初期姿勢）座標でパーツを追加。回転はジオメトリ中心まわり */
  const add = (j: Joint, key: Key, geo: THREE.BufferGeometry, p: V3, r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]): void => {
    _q.setFromEuler(_e.set(r[0], r[1], r[2]));
    _m.compose(new THREE.Vector3(p[0] - j.rest.x, p[1] - j.rest.y, p[2] - j.rest.z), _q, new THREE.Vector3(s[0], s[1], s[2]));
    geo.applyMatrix4(_m);
    const g = geo.index ? geo.toNonIndexed() : geo;
    let l = j.parts.get(key);
    if (!l) j.parts.set(key, (l = []));
    l.push(g);
  };
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const ball = (r: number) => new THREE.SphereGeometry(r, 10, 8);
  const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);

  const rig = joint(null, 0, 0, 0);
  const hips = joint(rig, 0, 0.9, 0);
  const spine = joint(hips, 0, 1.0, 0);
  const chest = joint(spine, 0, 1.3, 0);
  const head = joint(chest, 0, 1.56, 0);

  // ================= 腰 =================
  add(hips, 'dark', box(0.38, 0.2, 0.26), [0, 0.93, 0]);
  add(hips, 'dark', box(0.22, 0.12, 0.2), [0, 0.84, 0]);
  add(hips, 'white', cbox(0.44, 0.065, 0.3, 0.015, 0.006), [0, 1.0, 0]);                 // ベルト
  add(hips, 'white', cbox(0.075, 0.055, 0.02, 0.01, 0.004), [0, 1.0, -0.158]);              // バックル
  add(hips, 'black', box(0.095, 0.12, 0.085), [0.255, 0.97, -0.09]);                       // 右ポーチ
  add(hips, 'black', box(0.085, 0.1, 0.07), [-0.235, 0.97, 0.13]);                         // 左ポーチ（背面寄り）
  add(hips, 'dark2', box(0.2, 0.09, 0.05), [0, 0.99, 0.15]);                               // 腰の後ろ
  for (const s of [1, -1]) {
    add(hips, 'white', cbox(0.05, 0.15, 0.2, 0.02, 0.006), [s * 0.215, 0.88, 0]);          // 腰の側面装甲
    add(hips, 'black', ball(0.085), [s * 0.13, 0.9, 0]);                                    // 股関節
  }

  // ================= 腹（腹筋） =================
  add(spine, 'dark', box(0.36, 0.3, 0.22), [0, 1.15, 0]);
  for (const s of [1, -1]) for (const y of [1.07, 1.14, 1.21]) add(spine, 'dark2', cbox(0.1, 0.055, 0.025, 0.012, 0.004), [s * 0.055, y, -0.115]);
  add(spine, 'dark2', box(0.3, 0.2, 0.04), [0, 1.14, 0.12]);

  // ================= 胸 =================
  add(chest, 'dark', box(0.5, 0.32, 0.27), [0, 1.35, 0]);
  add(chest, 'white', poly([[-0.22, 0.17], [0.22, 0.17], [0.255, 0.06], [0.2, -0.07], [0.07, -0.13], [-0.07, -0.13], [-0.2, -0.07], [-0.255, 0.06]], 0.12), [0, 1.4, -0.09]);
  add(chest, 'dark', box(0.012, 0.27, 0.03), [0, 1.395, -0.158]);                          // 胸の中央ライン
  add(chest, 'yellow', poly([[-0.043, 0.032], [0.043, 0.032], [0, -0.034]], 0.012, 0.004), [0, 1.47, -0.152]); // 逆三角マーク
  add(chest, 'white', poly([[-0.24, 0.17], [0.24, 0.17], [0.27, 0.0], [0.18, -0.12], [-0.18, -0.12], [-0.27, 0.0]], 0.1), [0, 1.4, 0.115]); // 背面装甲
  add(chest, 'dark', box(0.14, 0.07, 0.03), [0, 1.46, 0.175]);                              // 背面ベント
  add(chest, 'grey', cbox(0.2, 0.2, 0.07, 0.03, 0.008), [0, 1.32, 0.205]);                  // バッテリーパック
  for (const s of [1, -1]) add(chest, 'battery', box(0.018, 0.15, 0.012), [s * 0.045, 1.32, 0.245]);
  add(chest, 'white', cyl(0.115, 0.15, 0.075, 6), [0, 1.53, 0.02]);                          // 襟
  add(chest, 'dark', cyl(0.06, 0.066, 0.1, 8), [0, 1.57, 0]);                               // 首

  // 肩アーマー（胸に固定）
  for (const s of [1, -1]) {
    const x = s * 0.315;
    add(chest, 'white', poly(mirror([[-0.13, -0.08], [0.125, -0.1], [0.14, -0.01], [0.105, 0.08], [-0.03, 0.135], [-0.135, 0.09]], s), 0.27), [x, 1.46, 0]);
    add(chest, 'grey', poly(mirror([[-0.1, 0.0], [0.115, 0.0], [0.125, -0.09], [0.08, -0.14], [-0.08, -0.14]], s), 0.23), [x + s * 0.005, 1.33, 0]);
    add(chest, 'yellow', cbox(0.075, 0.024, 0.13, 0.012, 0.004), [x - s * 0.005, 1.608, 0], [0, 0, -s * 0.28]); // 肩上の黄色パネル
    add(chest, 'black', ball(0.075), [s * C.arm.shoulderX, C.arm.shoulderY, 0]);            // 肩関節
  }

  // ================= 頭 =================
  const hy = 1.665;
  const skull = ball(0.125); add(head, 'skin', skull, [0, hy, 0], [0, 0, 0], [0.92, 1.0, 1.0]);
  add(head, 'skin', box(0.026, 0.04, 0.03), [0, hy - 0.012, -0.112]);                       // 鼻
  for (const e of [1, -1]) {
    add(head, 'dark', box(0.034, 0.012, 0.012), [e * 0.05, hy + 0.012, -0.113]);                // 目
    add(head, 'hair', box(0.056, 0.014, 0.016), [e * 0.05, hy + 0.04, -0.112], [0, 0, e * 0.18]); // 眉
  }
  // あごひげ（顔の下半分〜もみあげ）
  add(head, 'hair', new THREE.SphereGeometry(0.134, 14, 8, Math.PI * 0.85, Math.PI * 1.3, Math.PI * 0.56, Math.PI * 0.44), [0, hy, 0], [0, 0, 0], [0.93, 0.95, 1.0]);
  // 髪（ツンツンのモヒカン気味）
  add(head, 'hair', new THREE.SphereGeometry(0.133, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.36), [0, hy + 0.012, 0.004], [0, 0, 0], [0.95, 1.0, 1.0]);
  // 後頭部の短髪
  add(head, 'hair', new THREE.SphereGeometry(0.134, 14, 8, Math.PI * 0.1, Math.PI * 0.8, 0, Math.PI * 0.66), [0, hy + 0.01, 0.004], [0, 0, 0], [0.95, 1.0, 1.0]);
  const spikes: [number, number, number, number, number, number][] = [
    // x, z, baseY, height, tiltX, tiltZ
    [0, -0.075, hy + 0.12, 0.085, -0.45, 0], [0, -0.03, hy + 0.13, 0.11, -0.2, 0], [0, 0.02, hy + 0.13, 0.115, 0.1, 0],
    [0, 0.07, hy + 0.115, 0.1, 0.45, 0], [0, 0.11, hy + 0.08, 0.08, 0.8, 0],
    [0.05, -0.05, hy + 0.115, 0.07, -0.35, -0.35], [-0.05, -0.05, hy + 0.115, 0.07, -0.35, 0.35],
    [0.06, 0.02, hy + 0.11, 0.075, 0.1, -0.5], [-0.06, 0.02, hy + 0.11, 0.075, 0.1, 0.5],
    [0.05, 0.08, hy + 0.09, 0.065, 0.5, -0.4], [-0.05, 0.08, hy + 0.09, 0.065, 0.5, 0.4],
    [0.085, -0.02, hy + 0.085, 0.05, 0, -0.9], [-0.085, -0.02, hy + 0.085, 0.05, 0, 0.9],
  ];
  for (const [x, z, y, h0, tx, tz] of spikes) {
    const h = h0 * 0.78;
    const dir = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(tx, 0, tz));
    add(head, 'hair', new THREE.ConeGeometry(0.032, h, 5), [x + dir.x * h / 2, y + dir.y * h / 2, z + dir.z * h / 2], [tx, 0, tz]);
  }
  // 耳のヘッドホン装置（両耳）。スカウター側は少し大きく、シアンのリングとランプが付く（ON で強く光る）
  const sc = C.scouter.side;
  for (const s of [1, -1]) {
    const big = s === sc;
    const r = big ? 0.07 : 0.058;
    add(head, 'white', cyl(r, r, 0.05, 8), [s * 0.13, hy, 0.01], [0, 0, Math.PI / 2]);
    add(head, 'dark2', cyl(0.038, 0.038, 0.058, 8), [s * 0.135, hy, 0.01], [0, 0, Math.PI / 2]);
    add(head, big ? 'scouter' : 'lamp', cyl(0.018, 0.018, 0.066, 8), [s * 0.137, hy, 0.01], [0, 0, Math.PI / 2]);
    add(head, 'white', cbox(0.03, 0.06, 0.09, 0.01, 0.004), [s * 0.128, hy + 0.02, 0.085]);   // 後ろへ回るバンド
    if (big) {
      add(head, 'scouter', new THREE.TorusGeometry(0.052, 0.007, 6, 16), [s * 0.158, hy, 0.01], [0, Math.PI / 2, 0]); // 外周リング
      add(head, 'white', cbox(0.03, 0.03, 0.05, 0.008, 0.003), [s * 0.12, hy + 0.062, -0.01]);
      add(head, 'scouter', ball(0.013), [s * 0.12, hy + 0.088, -0.012]);                        // ランプ
    }
  }
  // 発光グロー（加算）。耳の装置の外側に円盤
  const scouterGlowMat = new THREE.MeshBasicMaterial({
    color: C.scouter.offColor, transparent: true, opacity: C.scouter.glowOff, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const scouterGlow = new THREE.Mesh(new THREE.CircleGeometry(0.085, 20), scouterGlowMat);
  scouterGlow.position.set(sc * 0.172, hy - head.rest.y, 0.01);
  scouterGlow.rotation.y = sc * Math.PI / 2;
  head.g.add(scouterGlow);

  // ================= 腕 =================
  const sx = C.arm.shoulderX, sy = C.arm.shoulderY;
  const mkArm = (s: 1 | -1, upper: number, fore: number): ArmRig => {
    const sh = joint(chest, s * sx, sy, 0);
    const el = joint(sh, s * sx, sy - upper, 0);
    const ey = sy - upper;
    const fy = ey - fore; // 拳の中心
    add(el, 'black', ball(0.062), [s * sx, ey, 0]);
    if (s > 0) {
      // 右腕：上腕（暗いスーツ＋小さな装甲）、前腕は白装甲、黒グローブ
      add(sh, 'dark', cyl(0.075, 0.065, upper, 8), [s * sx, sy - upper / 2, 0]);
      add(sh, 'white', cbox(0.07, 0.14, 0.14, 0.025, 0.006), [s * sx + 0.045, sy - 0.2, 0]);
      add(el, 'dark', cyl(0.062, 0.052, fore * 0.8, 8), [s * sx, ey - fore * 0.4, 0]);
      add(el, 'white', cbox(0.125, 0.24, 0.05, 0.03, 0.006), [s * sx, ey - 0.15, -0.06]);
      add(el, 'white', cbox(0.05, 0.22, 0.11, 0.02, 0.006), [s * sx + 0.075, ey - 0.15, 0]);
      add(el, 'white', cbox(0.13, 0.05, 0.14, 0.015, 0.005), [s * sx, ey - 0.01, 0]);
      add(el, 'black', cbox(0.105, 0.115, 0.125, 0.025, 0.008), [s * sx, fy, -0.005]);   // 拳
      add(el, 'white', cbox(0.09, 0.04, 0.105, 0.012, 0.004), [s * sx, fy + 0.05, -0.012]);
      add(el, 'black', box(0.03, 0.07, 0.06), [s * sx + s * 0.0, fy + 0.0, -0.075]);        // 指
    } else {
      // 左腕：スプリングが上腕。肘（=バネ先端）に黄色い手首バンド→白い前腕装甲→黒い拳
      add(sh, 'dark', cyl(0.07, 0.07, 0.08, 8), [s * sx, sy - 0.04, 0]);
      add(el, 'yellow', cyl(0.108, 0.108, 0.075, 8), [s * sx, ey - 0.04, 0]);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        add(el, 'black', cbox(0.034, 0.034, 0.02, 0.006, 0.002), [s * sx + Math.sin(a) * 0.109, ey - 0.04, Math.cos(a) * 0.109], [0, a, 0]);
      }
      add(el, 'dark', cyl(0.085, 0.075, 0.04, 8), [s * sx, ey - 0.095, 0]);
      add(el, 'white', cbox(0.155, 0.15, 0.17, 0.035, 0.008), [s * sx, ey - 0.17, 0]);
      add(el, 'white', cbox(0.12, 0.05, 0.11, 0.02, 0.006), [s * sx, ey - 0.24, -0.075]);
      add(el, 'black', cbox(0.115, 0.115, 0.13, 0.025, 0.008), [s * sx, fy - 0.0, -0.005]);
      add(el, 'black', box(0.03, 0.07, 0.06), [s * sx, fy - 0.0, -0.08]);
    }
    return { shoulder: sh.g, elbow: el.g, upper, fore };
  };
  const armR = mkArm(1, C.arm.right.upper, C.arm.right.fore);
  const armL = mkArm(-1, C.arm.left.upper, C.arm.left.fore);

  // スプリング（TubeGeometry。伸びはシェーダーで Y を aAxial 分だけずらす＝ピッチが広がる）
  const SP = C.spring;
  const springStretch = { value: 1 };
  const tubeGeo = new THREE.TubeGeometry(new Helix(SP.radius, C.arm.left.upper, SP.turns), SP.tubularSegs, SP.tube, 6, false);
  {
    const curve = new Helix(SP.radius, C.arm.left.upper, SP.turns);
    const radial = 6;
    const axial = new Float32Array(tubeGeo.attributes.position.count);
    for (let i = 0; i <= SP.tubularSegs; i++) {
      const y = curve.getPointAt(i / SP.tubularSegs).y;
      for (let j = 0; j <= radial; j++) axial[i * (radial + 1) + j] = y;
    }
    tubeGeo.setAttribute('aAxial', new THREE.BufferAttribute(axial, 1));
  }
  const springMat = new THREE.MeshToonMaterial({ color: col.silver, gradientMap: gradient, emissive: col.cyan, emissiveIntensity: 0 });
  springMat.onBeforeCompile = (sh) => {
    sh.uniforms.uStretch = springStretch;
    sh.vertexShader = 'attribute float aAxial;\nuniform float uStretch;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y += aAxial * (uStretch - 1.0);');
  };
  const springMesh = new THREE.Mesh(tubeGeo, springMat);
  springMesh.frustumCulled = false;
  armL.shoulder.add(springMesh);
  const springOutline = new THREE.Mesh(tubeGeo, outlineMaterial(C.outlineSpring, springStretch));
  springOutline.frustumCulled = false;
  armL.shoulder.add(springOutline);

  // ================= 脚 =================
  const mkLeg = (s: 1 | -1): LegRig => {
    const x = s * 0.13;
    const hip = joint(hips, x, 0.9, 0);
    const knee = joint(hip, x, 0.48, 0);
    const ankle = joint(knee, x, 0.11, 0);
    // 太もも
    add(hip, 'dark', cyl(0.095, 0.08, 0.4, 8), [x, 0.69, 0]);
    add(hip, 'white', poly(mirror([[-0.055, 0.17], [0.06, 0.17], [0.07, 0.0], [0.05, -0.17], [-0.05, -0.17], [-0.06, 0.0]], s), 0.08), [x + s * 0.025, 0.71, -0.085]);
    add(hip, 'white', cbox(0.05, 0.3, 0.14, 0.025, 0.006), [x + s * 0.09, 0.72, 0.0]);
    add(hip, 'grey', cbox(0.12, 0.1, 0.05, 0.02, 0.006), [x, 0.78, 0.085]);
    // 膝
    add(knee, 'black', ball(0.085), [x, 0.48, 0]);
    add(knee, 'white', poly([[-0.07, 0.04], [0.07, 0.04], [0.08, -0.03], [0.04, -0.07], [-0.04, -0.07], [-0.08, -0.03]], 0.06), [x, 0.51, -0.1]);
    // すね
    add(knee, 'dark', cyl(0.075, 0.06, 0.34, 8), [x, 0.3, 0]);
    add(knee, 'white', poly([[-0.055, 0.16], [0.055, 0.16], [0.068, -0.02], [0.05, -0.17], [-0.05, -0.17], [-0.068, -0.02]], 0.07), [x + s * 0.02, 0.31, -0.085]);
    add(knee, 'white', cbox(0.12, 0.22, 0.05, 0.03, 0.006), [x, 0.35, 0.095]);
    add(knee, 'grey', cbox(0.04, 0.2, 0.11, 0.02, 0.005), [x + s * 0.08, 0.3, 0]);
    // 足首・ブーツ
    add(ankle, 'black', ball(0.065), [x, 0.12, 0]);
    add(ankle, 'white', cbox(0.15, 0.1, 0.2, 0.03, 0.008), [x, 0.15, 0.0]);
    add(ankle, 'white', cbox(0.17, 0.085, 0.17, 0.03, 0.008), [x, 0.085, -0.125]);       // つま先装甲
    add(ankle, 'grey', cbox(0.19, 0.06, 0.09, 0.015, 0.005), [x, 0.18, -0.09]);
    add(ankle, 'black', box(0.19, 0.045, 0.36), [x, 0.025, -0.04]);                     // ソール
    add(ankle, 'yellow', cbox(0.2, 0.04, 0.09, 0.012, 0.004), [x, 0.032, -0.205]);        // つま先の黄色
    add(ankle, 'yellow', cbox(0.2, 0.04, 0.07, 0.012, 0.004), [x, 0.032, 0.13]);          // かかとの黄色
    return { hip: hip.g, knee: knee.g, ankle: ankle.g };
  };
  const legR = mkLeg(1);
  const legL = mkLeg(-1);

  // ================= 武器（胸の子。銃口は -Z。モデルは WeaponDef から作る） =================
  const gun = joint(chest, 0, 0, 0);
  gun.rest.set(0, 0, 0); // 武器はローカル座標でそのまま組む
  gun.g.position.set(0, 0, 0);

  const finalize = (j: Joint, out?: THREE.Mesh[]): void => {
    j.parts.forEach((list, key) => {
      const geo = mergeGeometries(list, false);
      if (!geo) return;
      list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(geo, mats[key]);
      mesh.castShadow = key !== 'cyan' && key !== 'battery' && key !== 'lamp' && key !== 'scouter';
      j.g.add(mesh);
      out?.push(mesh);
      if (!noOutline.has(key)) { const o = new THREE.Mesh(geo, outMat); j.g.add(o); out?.push(o); }
    });
    j.parts.clear();
  };
  for (const j of joints) if (j !== gun) finalize(j);

  const muzzle = new THREE.Object3D();
  gun.g.add(muzzle);
  const gunMeshes: THREE.Mesh[] = [];
  const wb: WeaponBuilder = {
    add: (key, geo, pos, rot, scl) => add(gun, key, geo, pos, rot, scl),
    box, cyl, ball, cbox,
    torus: (r, t) => new THREE.TorusGeometry(r, t, 6, 12),
  };
  const state = { weapon: DEFAULT_WEAPON };
  const setWeapon = (def: WeaponDef): void => {
    for (const m of gunMeshes) { gun.g.remove(m); if (m.material !== outMat) m.geometry.dispose(); }
    gunMeshes.length = 0;
    def.build(wb);
    finalize(gun, gunMeshes);
    muzzle.position.set(def.muzzle[0], def.muzzle[1], def.muzzle[2]);
    gun.g.scale.setScalar(C.gun.scale);
    state.weapon = def;
  };
  setWeapon(DEFAULT_WEAPON);


  // 銃口の電気球
  const chargeGroup = new THREE.Group();
  muzzle.add(chargeGroup);
  const chargeCore = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xeaffff }));
  const chargeGlow = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.4, depthWrite: false }));
  chargeGroup.add(chargeCore, chargeGlow);
  const sparkGeo = new THREE.SphereGeometry(0.03, 6, 4);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xc8ffff });
  const sparks: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(sparkGeo, sparkMat); sparks.push(s); chargeGroup.add(s); }
  const chargeLight = new THREE.PointLight(CYAN, 0, 6, 2);
  chargeGroup.add(chargeLight);

  // ---- 階層：root → body → pivot(重心) → rig ----
  head.g.scale.setScalar(1.15);
  head.g.position.y += 0.03;
  const body = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.y = 0.9;
  rig.g.position.y = -0.9;
  pivot.add(rig.g);
  body.add(pivot);
  root.add(body);

  // 飛行ジェット（ブーツ下）
  const jets = new THREE.Group();
  const jetMats: THREE.MeshBasicMaterial[] = [];
  for (const s of [-1, 1]) {
    const m = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.7, depthWrite: false });
    jetMats.push(m);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.7, 10), m);
    cone.rotation.x = Math.PI;
    cone.position.set(s * 0.13, -0.3, 0);
    jets.add(cone);
  }
  const jetLight = new THREE.PointLight(CYAN, 0, 7, 2);
  jetLight.position.set(0, -0.1, 0);
  jets.add(jetLight);
  root.add(jets);

  root.updateMatrixWorld(true);
  return {
    body, pivot, rig: rig.g, hips: hips.g, spine: spine.g, chest: chest.g, head: head.g,
    legL, legR, armL, armR, gunFrame: gun.g, muzzle,
    springStretch, springMat, flashMats, batteryMat, gunGlowMat, scouterMat, scouterGlowMat, scouterGlow,
    get weapon() { return state.weapon; }, setWeapon,
    jets, jetMats, jetLight, chargeGroup, chargeCore, chargeGlow, sparks, chargeLight,
  };
}
