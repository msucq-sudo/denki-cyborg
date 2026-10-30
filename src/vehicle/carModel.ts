// 車の見た目：主人公と同じ配色（白・グレー・黒・黄・シアン）の、面取りした装甲板のスポーツバギー。
// 運転席は開いていて、本物の主人公モデル（buildPlayerVisual）が座ってハンドルを握る。
// 座標：車のローカルで -Z が前、+X が運転手の右、+Y が上。原点は地面（車輪の接地面）の中心。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHARACTER as C } from '../config/balance';
import { buildPlayerVisual, cbox, makeToonGradient, outlineMaterial, poly, type PlayerVisual } from '../player/visual';
import { solveArm } from '../player/pose';
import type { CarVisual } from './types';

/** 車体の大きさ（m）。当たり判定・カメラ・演出が使う */
export const CAR = {
  length: 4.9, width: 2.3, height: 1.15,
  halfLen: 2.45, halfWid: 1.15,
  wheelRadius: 0.46,
  /** 前輪・後輪の車軸（前が -Z） */
  frontZ: -1.5, rearZ: 1.45, trackX: 1.0,
  /** 運転手の腰の位置と、ハンドル中心（車のローカル） */
  hip: { x: 0, y: 0.8, z: 0.45 },
  wheel: { y: 1.25, z: -0.1, r: 0.17 },
};

export type DriverPose = 'drive' | 'lean' | 'brace';

export interface CarModel extends CarVisual {
  /** 運転手のリグ（座る姿勢の計算で使う本物の主人公モデル） */
  driverVisual: PlayerVisual;
  /** 加速の閃光 0..1（排気が一瞬大きくなる） */
  boostFlash(k: number): void;
  /** ヘッドライトとアンダーグロー */
  lights: { head: THREE.SpotLight; under: THREE.PointLight };
  /** 排気の光の明るさ（0..1、速度に応じて自動。エンジン停止中は 0） */
  setEngine(on: boolean): void;
  readonly pose: DriverPose;
}

type Key = 'white' | 'grey' | 'dark' | 'dark2' | 'black' | 'yellow' | 'silver' | 'cyan' | 'lamp' | 'red' | 'glass';
type V3 = [number, number, number];

/** 側面のシルエット（前方向 f[m]・高さ y[m]）を、幅 w で左右に押し出した装甲板。f が大きいほど前（-Z） */
function side(pts: [number, number][], w: number, bevel = 0.015): THREE.BufferGeometry {
  const g = poly(pts, w, bevel);
  g.rotateY(Math.PI / 2);
  return g;
}

class Parts {
  private map = new Map<Key, THREE.BufferGeometry[]>();
  private _q = new THREE.Quaternion();
  private _e = new THREE.Euler();
  private _m = new THREE.Matrix4();
  add(key: Key, geo: THREE.BufferGeometry, p: V3, r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]): void {
    this._q.setFromEuler(this._e.set(r[0], r[1], r[2]));
    this._m.compose(new THREE.Vector3(p[0], p[1], p[2]), this._q, new THREE.Vector3(s[0], s[1], s[2]));
    geo.applyMatrix4(this._m);
    const g = geo.index ? geo.toNonIndexed() : geo;
    let l = this.map.get(key);
    if (!l) this.map.set(key, (l = []));
    l.push(g);
  }
  /** 左右対称に追加（x を反転）。回転は z・y 軸まわりを反転する */
  mirror(key: Key, make: () => THREE.BufferGeometry, p: V3, r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]): void {
    this.add(key, make(), p, r, s);
    this.add(key, make(), [-p[0], p[1], p[2]], [r[0], -r[1], -r[2]], s);
  }
  finalize(mats: Record<Key, THREE.Material>, outMat: THREE.Material, noOutline: Set<Key>, castShadow = true): THREE.Group {
    const out = new THREE.Group();
    this.map.forEach((list, key) => {
      const geo = mergeGeometries(list, false);
      if (!geo) return;
      list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(geo, mats[key]);
      mesh.castShadow = castShadow && !noOutline.has(key);
      out.add(mesh);
      if (!noOutline.has(key)) out.add(new THREE.Mesh(geo, outMat));
    });
    this.map.clear();
    return out;
  }
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);

export function buildCar(): CarModel {
  const col = C.colors;
  const gradient = makeToonGradient();
  const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: gradient });
  const glow = (color: number, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });
  const cyanMat = glow(col.cyan, 1.1);
  const lampMat = glow(0xe6ffff, 1.6);
  const redMat = glow(0xff3a2a, 1.2);
  const glassMat = new THREE.MeshBasicMaterial({ color: 0x7fdcff, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
  const mats: Record<Key, THREE.Material> = {
    white: toon(new THREE.Color(col.white).multiplyScalar(0.72).getHex()), grey: toon(new THREE.Color(col.grey).multiplyScalar(0.75).getHex()), dark: toon(col.dark), dark2: toon(col.dark2), black: toon(col.black),
    yellow: toon(col.yellow), silver: toon(col.silver), cyan: cyanMat, lamp: lampMat, red: redMat, glass: glassMat,
  };
  const noOutline = new Set<Key>(['cyan', 'lamp', 'red', 'glass']);
  const outMat = outlineMaterial(0.012);

  const root = new THREE.Group();
  /** 車体全体（サスの上下・傾き用） */
  const chassis = new THREE.Group();
  root.add(chassis);

  // ================= 車体（静的パーツを材質ごとに1メッシュへ） =================
  const P = new Parts();
  const Z = (f: number): number => -f; // 前方向 f → ローカル z
  const H = CAR.hip;

  // 床下（ダーク）＋スキッドプレート
  P.add('dark', side([[-2.3, 0.36], [-0.85, 0.36], [-0.85, 0.22], [0.58, 0.22], [0.58, 0.36], [2.45, 0.34], [2.35, 0.2], [-2.2, 0.2]], 1.4), [0, 0, 0]);
  P.add('black', side([[-1.6, 0.14], [1.7, 0.14], [1.75, 0.22], [-1.55, 0.22]], 0.9), [0, 0, 0]);

  // 後部の装甲（テールからシートの後ろまで）
  P.add('white', side([[-2.4, 0.36], [-2.42, 0.82], [-2.0, 1.0], [-1.2, 1.04], [-0.82, 0.9], [-0.82, 0.36]], 1.3), [0, 0, 0]);
  P.add('dark', box(0.9, 0.05, 0.9), [0, 1.045, Z(-1.65)]);                                  // 後ろのデッキのベント
  for (let i = 0; i < 4; i++) P.add('black', box(0.7, 0.02, 0.05), [0, 1.075, Z(-1.3 - i * 0.18)]);

  // 前部の装甲（ボンネット）：低く尖ったノーズ
  P.add('white', side([[0.58, 0.36], [0.55, 1.0], [0.95, 0.95], [1.9, 0.78], [2.4, 0.62], [2.5, 0.5], [2.48, 0.36]], 1.3), [0, 0, 0]);
  // ボンネットの黄色いストライプ＋逆三角マーク（主人公の胸と同じ）
  P.add('yellow', side([[0.7, 0.978], [1.9, 0.805], [1.9, 0.82], [0.7, 0.995]], 0.16, 0.004), [0, 0.0, 0]);
  P.add('yellow', poly([[-0.14, 0.0], [0.14, 0.0], [0, -0.26]], 0.015, 0.004), [0, 0.86, Z(1.46)], [-Math.PI / 2 + 0.17, 0, 0]);
  // ノーズ下のスプリッター
  P.add('dark2', cbox(1.5, 0.05, 0.3, 0.02, 0.004), [0, 0.3, Z(2.52)], [0, 0, 0]);
  P.add('yellow', cbox(1.5, 0.025, 0.06, 0.01, 0.003), [0, 0.3, Z(2.68)]);
  for (const s of [1, -1]) P.add('grey', cbox(0.05, 0.22, 0.4, 0.015, 0.004), [s * 0.74, 0.34, Z(2.55)]); // カナード

  // コックピットの側壁（開いた運転席）
  for (const s of [1, -1]) {
    P.add('white', side([[-0.85, 0.22], [-0.85, 0.82], [-0.3, 0.84], [0.58, 0.98], [0.58, 0.22]], 0.13), [s * 0.655, 0, 0]);
    P.add('yellow', side([[-0.8, 0.76], [0.5, 0.92], [0.5, 0.95], [-0.8, 0.79]], 0.135, 0.003), [s * 0.655, 0, 0]);
    P.add('dark2', side([[-0.8, 0.5], [0.5, 0.5], [0.5, 0.62], [-0.8, 0.62]], 0.14, 0.003), [s * 0.655, 0, 0]);
  }
  // 床・シート・ダッシュ
  P.add('dark', box(1.18, 0.05, 1.43), [0, 0.225, Z(-0.135)]);
  P.add('black', box(1.18, 0.02, 1.43), [0, 0.25, Z(-0.135)]);
  P.add('dark', cbox(0.5, 0.5, 0.5, 0.05, 0.01), [0, 0.5, H.z - 0.02]);                         // 座面の土台
  P.add('dark2', cbox(0.72, 0.16, 0.62, 0.05, 0.01), [0, H.y - 0.09, H.z - 0.02]);              // 座面
  P.add('dark2', cbox(0.62, 0.46, 0.12, 0.06, 0.01), [0, H.y + 0.26, H.z + 0.3], [0.16, 0, 0]);   // 背もたれ（背中が後ろから見えるよう低く）
  P.add('yellow', cbox(0.4, 0.05, 0.125, 0.015, 0.003), [0, H.y + 0.1, H.z + 0.3], [0.16, 0, 0]);
  P.add('cyan', box(0.03, 0.3, 0.01), [0, H.y + 0.28, H.z + 0.22], [0.16, 0, 0]);
  for (const s of [1, -1]) P.add('grey', cbox(0.07, 0.5, 0.2, 0.03, 0.006), [s * 0.36, H.y + 0.14, H.z + 0.12]);  // 左右のサイドサポート
  // ダッシュ（計器フード）とコラム
  P.add('dark2', side([[0.15, 0.9], [0.62, 0.9], [0.62, 1.14], [0.5, 1.2], [0.3, 1.18], [0.15, 1.06]], 1.0), [0, 0, 0]);
  P.add('black', box(0.5, 0.012, 0.1), [0, 1.2, Z(0.4)]);
  P.add('cyan', box(0.34, 0.01, 0.02), [0, 1.205, Z(0.42)]);
  P.add('dark', cyl(0.035, 0.035, 0.42, 8), [0, 1.15, Z(0.24)], [-1.0, 0, 0]);
  // ペダル
  for (const s of [-1, 1]) P.add('silver', box(0.1, 0.012, 0.16), [s * 0.14, 0.45, Z(0.5)], [0.5, 0, 0]);

  // フロントガラス（ごく低く、斜めに）と枠
  P.add('glass', box(1.12, 0.42, 0.012), [0, 1.3, Z(0.5)], [-0.62, 0, 0]);
  P.add('yellow', cbox(1.16, 0.035, 0.04, 0.01, 0.003), [0, 1.47, Z(0.38)], [-0.62, 0, 0]);
  for (const s of [1, -1]) P.add('dark', box(0.04, 0.48, 0.04), [s * 0.58, 1.27, Z(0.5)], [-0.62, 0, s * 0.12]);

  // 後部のフィン（運転手の背中の脇から尾翼へ）
  for (const s of [1, -1]) {
    P.add('white', side([[-0.82, 0.82], [-0.88, 1.3], [-1.5, 1.3], [-2.35, 1.1], [-2.4, 0.88]], 0.09), [s * 0.64, 0, 0]);
    P.add('yellow', side([[-1.5, 1.3], [-2.35, 1.1], [-2.35, 1.15], [-1.5, 1.35]], 0.095, 0.003), [s * 0.64, 0, 0]);
    P.add('cyan', box(0.012, 0.025, 0.9), [s * 0.7, 1.16, Z(-1.62)], [0.22, 0, 0]);
  }
  // リアウイング
  P.add('white', cbox(1.9, 0.07, 0.44, 0.03, 0.008), [0, 1.3, Z(-2.5)], [0.1, 0, 0]);
  P.add('grey', cbox(1.0, 0.05, 0.2, 0.02, 0.005), [0, 1.12, Z(-2.5)]);
  for (const s of [1, -1]) P.add('yellow', cbox(0.05, 0.3, 0.55, 0.02, 0.005), [s * 0.95, 1.28, Z(-2.5)]);
  // 排気ノズル
  for (const s of [1, -1]) {
    P.add('black', cyl(0.2, 0.17, 0.3, 12), [s * 0.4, 0.66, Z(-2.5)], [Math.PI / 2, 0, 0]);
    P.add('silver', new THREE.TorusGeometry(0.2, 0.02, 6, 14), [s * 0.4, 0.66, Z(-2.65)]);
  }
  // テールランプ
  P.add('red', box(1.0, 0.045, 0.02), [0, 0.92, Z(-2.43)]);
  // ヘッドライト（ノーズ）
  for (const s of [1, -1]) {
    P.add('lamp', cbox(0.42, 0.07, 0.04, 0.025, 0.004), [s * 0.45, 0.66, Z(2.5)], [0, -s * 0.12, s * 0.12]);
    P.add('dark', cbox(0.5, 0.12, 0.05, 0.03, 0.004), [s * 0.45, 0.66, Z(2.49)], [0, -s * 0.12, s * 0.12]);
  }
  // 側面のポッド（ホイール間）＋ライン
  for (const s of [1, -1]) {
    P.add('white', side([[-0.7, 0.34], [-0.55, 0.62], [0.65, 0.64], [0.85, 0.34]], 0.24), [s * 0.8, 0, 0]);
    P.add('cyan', box(0.015, 0.02, 1.15), [s * 0.925, 0.5, Z(0.05)]);
    P.add('yellow', box(0.02, 0.05, 0.3), [s * 0.925, 0.4, Z(-0.45)]);
    P.add('black', box(0.02, 0.1, 0.4), [s * 0.925, 0.52, Z(0.55)]);
  }
  // サスアーム（車体→ハブ）
  for (const s of [1, -1]) for (const wz of [CAR.frontZ, CAR.rearZ]) {
    P.add('grey', cyl(0.03, 0.03, 0.38, 6), [s * 0.82, 0.55, wz], [0, 0, Math.PI / 2 + s * 0.22]);
    P.add('grey', cyl(0.025, 0.025, 0.4, 6), [s * 0.82, 0.38, wz + 0.13], [0, 0, Math.PI / 2 - s * 0.1]);
  }
  // 車輪の上の泥よけ（フェンダー）：アーチ形の板を、車体からステーで支える
  for (const s of [1, -1]) for (const wz of [CAR.frontZ, CAR.rearZ]) {
    const c = -wz;
    P.add('white', side([[c - 0.62, 0.84], [c - 0.45, 1.0], [c - 0.2, 1.08], [c + 0.2, 1.08], [c + 0.45, 1.0], [c + 0.62, 0.84],
      [c + 0.55, 0.84], [c + 0.4, 0.95], [c + 0.2, 1.01], [c - 0.2, 1.01], [c - 0.4, 0.95], [c - 0.55, 0.84]], 0.36, 0.012), [s * 1.0, 0, 0]);
    P.add('yellow', side([[c - 0.2, 1.08], [c + 0.2, 1.08], [c + 0.2, 1.1], [c - 0.2, 1.1]], 0.365, 0.004), [s * 1.0, 0, 0]);
    P.add('grey', box(0.3, 0.05, 0.1), [s * 0.8, 0.98, wz]);
  }
  P.add('cyan', box(1.0, 0.02, 0.02), [0, 0.2, Z(2.2)]);                                         // 床下グロー（前）

  const hull = P.finalize(mats, outMat, noOutline);
  chassis.add(hull);

  // ================= 車輪 =================
  const wheels: { pivot: THREE.Group; spin: THREE.Group; front: boolean }[] = [];
  const mkWheel = (x: number, z: number, front: boolean): void => {
    const W = new Parts();
    const R = CAR.wheelRadius;
    // タイヤ（面取りした円柱）：本体＋サイドの縁
    W.add('black', cyl(R, R, 0.34, 20), [0, 0, 0], [0, 0, Math.PI / 2]);
    W.add('dark2', cyl(R * 0.98, R * 0.98, 0.36, 20), [0, 0, 0], [0, 0, Math.PI / 2], [0.94, 1, 0.94]);
    const out = Math.sign(x);
    // ホイール（外側）
    W.add('silver', cyl(R * 0.66, R * 0.66, 0.05, 16), [out * 0.185, 0, 0], [0, 0, Math.PI / 2]);
    W.add('dark', cyl(R * 0.5, R * 0.5, 0.06, 16), [out * 0.2, 0, 0], [0, 0, Math.PI / 2]);
    W.add('yellow', cyl(R * 0.16, R * 0.16, 0.08, 8), [out * 0.22, 0, 0], [0, 0, Math.PI / 2]);
    // スポーク（回転が見える）
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      W.add('white', cbox(0.04, R * 0.9, 0.09, 0.01, 0.003), [out * 0.215, Math.cos(a) * R * 0.28, Math.sin(a) * R * 0.28], [a, 0, 0]);
    }
    // 目印（タイヤの側面の黄色い弧）
    W.add('yellow', box(0.02, 0.06, 0.26), [out * 0.176, R * 0.84, 0]);
    W.add('cyan', new THREE.TorusGeometry(R * 0.66, 0.012, 5, 22), [out * 0.213, 0, 0], [0, Math.PI / 2, 0]);
    const spin = W.finalize(mats, outMat, noOutline);
    const pivot = new THREE.Group();
    pivot.position.set(x, R, z);
    const spinG = new THREE.Group();
    spinG.add(spin);
    pivot.add(spinG);
    chassis.add(pivot);
    wheels.push({ pivot, spin: spinG, front });
  };
  mkWheel(CAR.trackX, CAR.frontZ, true);
  mkWheel(-CAR.trackX, CAR.frontZ, true);
  mkWheel(CAR.trackX, CAR.rearZ, false);
  mkWheel(-CAR.trackX, CAR.rearZ, false);

  // ================= ハンドル =================
  const wheelRig = new THREE.Group();
  wheelRig.position.set(0, CAR.wheel.y, CAR.wheel.z);
  wheelRig.rotation.x = -0.5;
  const rim = new THREE.Group(); // 舵で回る
  wheelRig.add(rim);
  {
    const R = CAR.wheel.r;
    const WP = new Parts();
    WP.add('black', new THREE.TorusGeometry(R, 0.024, 8, 22), [0, 0, 0]);
    WP.add('dark2', box(R * 2, 0.04, 0.03), [0, 0, 0]);
    WP.add('dark2', box(0.04, R, 0.03), [0, -R * 0.5, 0]);
    WP.add('yellow', cyl(0.05, 0.05, 0.04, 10), [0, 0, 0], [Math.PI / 2, 0, 0]);
    WP.add('yellow', cbox(0.07, 0.03, 0.04, 0.01, 0.003), [0, R, 0]); // 12時のマーク
    WP.add('cyan', box(0.03, 0.012, 0.012), [0, 0, 0.025]);
    rim.add(WP.finalize(mats, outMat, noOutline));
  }
  // 手の位置（ハンドルのローカル）：3時と9時
  const gripR = new THREE.Object3D(); gripR.position.set(CAR.wheel.r, 0.0, 0.0);
  const gripL = new THREE.Object3D(); gripL.position.set(-CAR.wheel.r, 0.0, 0.0);
  rim.add(gripR, gripL);
  chassis.add(wheelRig);

  // ================= 排気の炎・光 =================
  const flameMat = new THREE.MeshBasicMaterial({ color: col.cyan, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xeaffff, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const flames: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const g = new THREE.Group();
    g.position.set(s * 0.4, 0.66, Z(-2.68));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.17, 1, 12, 1, true), flameMat);
    cone.rotation.x = -Math.PI / 2; // 先端が +Z（後ろ）
    cone.position.z = 0.5;
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.7, 10, 1, true), coreMat);
    core.rotation.x = -Math.PI / 2;
    core.position.z = 0.35;
    g.add(cone, core);
    chassis.add(g);
    flames.push(g);
  }

  // ================= ライト =================
  const head = new THREE.SpotLight(0xdff8ff, 0, 70, 0.5, 0.6, 1.2);
  head.position.set(0, 0.7, Z(2.4));
  head.target.position.set(0, 0.2, Z(30));
  chassis.add(head, head.target);
  const under = new THREE.PointLight(col.cyan, 0, 7, 2);
  under.position.set(0, 0.25, 0);
  chassis.add(under);

  // ================= 運転手（本物の主人公モデル） =================
  const driver = new THREE.Group();
  const pv = buildPlayerVisual(driver);
  // ライトはシーン全体の負荷になるので、座っているだけの運転手からは外す
  pv.jetLight.removeFromParent();
  pv.chargeLight.removeFromParent();
  pv.jets.visible = false;
  pv.chargeGroup.visible = false;
  pv.gunFrame.visible = false;
  pv.scouterMat.color.setHex(C.scouter.onColor).multiplyScalar(1.6);
  pv.scouterGlowMat.color.copy(pv.scouterMat.color);
  pv.scouterGlowMat.opacity = 0.6;
  pv.springMat.emissiveIntensity = 0.25;
  pv.batteryMat.color.setHex(col.cyan).multiplyScalar(1.1);
  driver.position.set(H.x, H.y - 0.9, H.z);
  driver.rotation.y = 0; // 主人公のモデルは -Z が前なので車と同じ向き
  chassis.add(driver);

  // ---- 状態 ----
  const st = {
    spin: 0, steer: 0, steerTarget: 0, t: 0, engine: false, speed: 0, flash: 0,
    pose: 'drive' as DriverPose, leanK: 0, braceK: 0, bob: 0,
  };

  const _qs = new THREE.Quaternion(), _qe = new THREE.Quaternion();
  const _tgt = new THREE.Vector3();
  const POLE_R = new THREE.Vector3(0.7, -1, 0.15), POLE_L = new THREE.Vector3(-0.7, -1, 0.15);

  /** 座った姿勢を毎フレーム計算（膝・腰・背中・首・腕。腕はハンドルの握り位置へ IK） */
  function poseDriver(dt: number): void {
    const v = pv;
    const k = 1 - Math.exp(-8 * Math.max(dt, 0));
    st.leanK += ((st.pose === 'lean' ? 1 : 0) - st.leanK) * k;
    st.braceK += ((st.pose === 'brace' ? 1 : 0) - st.braceK) * k;
    const lean = st.leanK, brace = st.braceK;
    const breath = Math.sin(st.t * 2.2);
    const speedK = Math.min(1, st.speed / 90);
    const shake = Math.sin(st.t * 47) * 0.01 * speedK;
    const steer = st.steer;

    // 脚：太ももをほぼ水平に、すねを下へ。ペダルに足を置く
    v.legR.hip.rotation.set(1.42, 0, 0.09);
    v.legL.hip.rotation.set(1.42, 0, -0.09);
    v.legR.knee.rotation.set(-1.62, 0, 0);
    v.legL.knee.rotation.set(-1.62, 0, 0);
    v.legR.ankle.rotation.set(0.34 + brace * 0.15, 0, 0);
    v.legL.ankle.rotation.set(0.26, 0, 0);
    v.rig.position.y = -0.9;
    v.hips.position.set(0, 0.9, 0);
    v.hips.rotation.set(0.0, 0, 0);
    // 背中：シートにもたれる → 前へ乗り出す（lean）→ 衝撃に備えて丸まる（brace）
    v.spine.rotation.set(0.1 - lean * 0.5 - brace * 0.42 + 0.01 * breath + shake, steer * 0.08, -steer * 0.05);
    v.chest.rotation.set(0.0 - lean * 0.1 - brace * 0.22, steer * 0.12, 0);
    // 首：前を見る。lean は首を上げて遠くを覗く、brace は顔を伏せる
    v.head.rotation.set(-0.06 + lean * 0.4 - brace * 0.55 + 0.02 * Math.sin(st.t * 1.3), -steer * 0.28 + 0.02 * Math.sin(st.t * 0.9), -steer * 0.06);

    // ハンドルを舵に合わせて回す
    rim.rotation.z = -steer * 1.25;
    chassis.updateMatrixWorld(true);
    // 腕（肩ローカルで IK）
    const chest = v.chest;
    gripR.getWorldPosition(_tgt);
    chest.worldToLocal(_tgt);
    solveArm(v.armR.shoulder.position, _tgt, v.armR.upper, v.armR.fore, POLE_R, _qs, _qe);
    v.armR.shoulder.quaternion.copy(_qs);
    v.armR.elbow.quaternion.copy(_qe);
    gripL.getWorldPosition(_tgt);
    chest.worldToLocal(_tgt);
    const dist = _tgt.distanceTo(v.armL.shoulder.position);
    const stretch = Math.min(3, Math.max(1, (dist / 0.97 - v.armL.fore) / v.armL.upper));
    solveArm(v.armL.shoulder.position, _tgt, v.armL.upper * stretch, v.armL.fore, POLE_L, _qs, _qe);
    v.armL.shoulder.quaternion.copy(_qs);
    v.armL.elbow.quaternion.copy(_qe);
    v.armL.elbow.position.y = -v.armL.upper * stretch;
    v.springStretch.value = stretch;
  }

  function update(dt: number, speedMps: number): void {
    st.t += dt;
    st.speed = speedMps;
    st.steer += (st.steerTarget - st.steer) * (1 - Math.exp(-12 * Math.max(dt, 0)));
    // 車輪：進んだ距離ぶん回す・前輪は舵
    st.spin += (speedMps / CAR.wheelRadius) * dt;
    for (const w of wheels) {
      w.spin.rotation.x = -st.spin;
      if (w.front) w.pivot.rotation.y = -st.steer * 0.5;
    }
    // 車体：速度で細かく震え、加減速でわずかに前後に傾く
    const sk = Math.min(1, Math.abs(speedMps) / 90);
    st.bob = Math.sin(st.t * 38) * 0.006 * sk + Math.sin(st.t * 13) * 0.008 * sk;
    chassis.position.y = st.bob;
    chassis.rotation.z = -st.steer * 0.03 * Math.min(1, Math.abs(speedMps) / 30);
    // 排気：速度に応じて伸びる。加速の閃光で一瞬大きく
    st.flash = Math.max(0, st.flash - dt * 2.4);
    const on = st.engine ? 1 : 0;
    const len = on * (0.25 + Math.min(1, Math.abs(speedMps) / 94) * 1.6 + st.flash * 1.4) * (0.92 + 0.08 * Math.sin(st.t * 60));
    const wid = 0.75 + Math.min(1, Math.abs(speedMps) / 94) * 0.35 + st.flash * 0.5;
    for (const f of flames) {
      f.visible = on > 0 && len > 0.05;
      f.scale.set(wid, wid, Math.max(0.01, len));
    }
    flameMat.opacity = 0.55 + 0.3 * Math.min(1, Math.abs(speedMps) / 94) + 0.15 * st.flash;
    // ライト
    head.intensity = on ? 90 : 0;
    under.intensity = on ? 3 + st.flash * 5 : 0;
    poseDriver(dt);
  }

  function dispose(): void {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) x.dispose();
    });
    driver.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) x.dispose();
    });
    gradient.dispose();
    root.removeFromParent();
  }

  poseDriver(0);
  update(0, 0);

  return {
    root, driver, driverHead: pv.head, driverVisual: pv,
    setSteer(v: number) { st.steerTarget = Math.max(-1, Math.min(1, v)); },
    update,
    setDriverPose(p: DriverPose) { st.pose = p; },
    boostFlash(k: number) { st.flash = Math.max(st.flash, k); },
    lights: { head, under },
    setEngine(on: boolean) { st.engine = on; },
    get pose() { return st.pose; },
    dispose,
  };
}
