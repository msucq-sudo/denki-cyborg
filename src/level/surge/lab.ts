// 研究所の裏側：階段ホール（2階の西の出口から降りてくる）とガレージ。白と紺のパネル・シアンの光の帯・ハザード柄の、このゲームの研究所の見た目。
// 座標は layout.ts（+X=東、-Z=北、床 y=0）。階段は南（+Z）が高く、北（-Z）へ下る。
import * as THREE from 'three';
import type { AABB } from '../../core/types';
import { floorRoughTex, floorTex, hazardTex, panelTex } from '../floor1/visuals';
import { Batch } from './batch';
import { GARAGE, STAIRS } from './layout';
import { shutterTex, signTex } from './textures';

const K = {
  white: 0xeef2f6, light: 0xd3dae3, mid: 0xa5b1bf, steel: 0x7c8a9c, dark: 0x2a3342, ink: 0x161d29, navy: 0x203c70, dnavy: 0x16264a,
  cyan: 0x52e8ff, green: 0x4cd68a, red: 0xe0503c, orange: 0xf0903f, yellow: 0xffc21a, blue: 0x5b8fd8,
};
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const col = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tag: string): AABB => ({ min: v3(x0, y0, z0), max: v3(x1, y1, z1), active: true, tag });

export interface LabParts {
  root: THREE.Group;
  colliders: AABB[];
  /** 北のシャッター：pivot の scale.y を 1→0 に下げると巻き上がる（上端が支点） */
  shutter: { pivot: THREE.Group; collider: AABB; lampMat: THREE.MeshBasicMaterial };
  /** 電源ソケット（ワールド座標）と、その光の輪（作動で緑に） */
  socket: { pos: THREE.Vector3; ringMat: THREE.MeshBasicMaterial; lampMat: THREE.MeshBasicMaterial };
  /** 停まっている車の当たり判定（運転が始まったら無効にする） */
  carCollider: AABB;
  /** 部屋の明かり（scene に足す） */
  lights: THREE.PointLight[];
  /** 動かす光（コンベアの矢印など）の材質 */
  pulse: THREE.MeshBasicMaterial;
}

export function buildLab(): LabParts {
  const root = new THREE.Group();
  root.name = 'surgeLab';
  const colliders: AABB[] = [];

  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  const map = (t: THREE.Texture | undefined): THREE.MeshStandardMaterialParameters => (t ? { map: t } : {});
  const rough = floorRoughTex();
  const mats = {
    panel: std({ ...map(panelTex()), roughness: 0.7, metalness: 0.1, color: 0xdde3ea }),
    floor: std({ ...map(floorTex()), ...(rough ? { roughnessMap: rough } : {}), roughness: 0.85, metalness: 0.12, color: 0xe2e8ef }),
    hazard: std({ ...map(hazardTex()), roughness: 0.7, metalness: 0, color: 0xc0c0c0 }),
    solid: std({ roughness: 0.55, metalness: 0.3, color: 0xd0d6de }),
    metal: std({ roughness: 0.38, metalness: 0.7, color: 0xd5dbe3 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
  mats.glow.color.setScalar(1.5);
  const B = { panel: new Batch(), floor: new Batch(), hazard: new Batch(), solid: new Batch(), metal: new Batch(), glow: new Batch() };
  const T = 3; // テクスチャのタイル（m）
  const G = GARAGE, S = STAIRS, wt = G.wallT;

  // ================================================================ ガレージ
  const x0 = G.x0, x1 = G.x1, z0 = G.z0, z1 = G.z1, H = G.h;
  const ow = G.shutterW / 2;   // 北の開口の半幅
  const dw = G.doorW / 2;      // 南の入口の半幅
  // 床（外の道へ出る敷居まで）・天井
  B.floor.box(0, -0.2, (z0 - wt + z1 + wt) / 2, x1 - x0 + 2 * wt, 0.4, z1 - z0 + 2 * wt, 0xffffff, { tu: T });
  colliders.push(col(x0 - wt, x1 + wt, -3, 0, z0 - wt, z1 + wt, 'floor'));
  B.solid.box(0, H + 0.3, (z0 + z1) / 2, x1 - x0 + 2 * wt, 0.6, z1 - z0 + 2 * wt, K.dark, false);
  colliders.push(col(x0 - wt, x1 + wt, H, H + 3, z0 - wt, z1 + wt, 'ceiling'));
  // 壁：西・東
  for (const sx of [-1, 1]) {
    const cx = sx * (x1 + wt / 2);
    B.panel.box(cx, (H + 1) / 2, (z0 + z1) / 2, wt, H + 1, z1 - z0 + 2 * wt, 0xffffff, { tu: T });
    colliders.push(col(Math.min(sx * x1, sx * (x1 + wt)), Math.max(sx * x1, sx * (x1 + wt)), 0, H + 1, z0 - wt, z1 + wt, 'wall'));
  }
  // 北の壁（シャッターの開口）・南の壁（階段ホールへの入口）
  const wallWithGap = (zc: number, half: number, gapH: number, tag: string): void => {
    const sidew = x1 + wt - half;
    for (const sx of [-1, 1]) {
      const cx = sx * (half + sidew / 2);
      B.panel.box(cx, (H + 1) / 2, zc, sidew, H + 1, wt, 0xffffff, { tu: T });
      colliders.push(col(Math.min(sx * half, sx * (half + sidew)), Math.max(sx * half, sx * (half + sidew)), 0, H + 1, zc - wt / 2, zc + wt / 2, tag));
    }
    B.panel.box(0, gapH + (H + 1 - gapH) / 2, zc, half * 2, H + 1 - gapH, wt, 0xffffff, { tu: T });
    colliders.push(col(-half, half, gapH, H + 1, zc - wt / 2, zc + wt / 2, tag));
  };
  wallWithGap(z0 - wt / 2, ow, G.shutterH, 'wall');
  wallWithGap(z1 + wt / 2, dw, G.doorH, 'wall');

  // ---- 壁の飾り：幅木のハザード帯・紺の帯・シアンの光の線・柱
  const L = z1 - z0;
  for (const sx of [-1, 1]) {
    B.hazard.box(sx * (x1 - 0.04), 0.17, (z0 + z1) / 2, 0.08, 0.34, L, 0xffffff, { tu: 1.6 });
    B.solid.box(sx * (x1 - 0.05), 0.95, (z0 + z1) / 2, 0.1, 1.0, L, K.dnavy, false);
    B.glow.box(sx * (x1 - 0.05), 5.7, (z0 + z1) / 2, 0.06, 0.1, L, K.cyan, false);
    B.glow.box(sx * (x1 - 0.05), 1.55, (z0 + z1) / 2, 0.04, 0.04, L, K.cyan, false);
    // 柱（6m おき）
    for (let z = z0 + 3; z < z1; z += 6) {
      B.solid.box(sx * (x1 - 0.2), H / 2, z, 0.4, H, 0.5, K.light, false);
      B.glow.box(sx * (x1 - 0.42), 3.2, z, 0.04, 2.4, 0.08, K.cyan, false);
    }
  }
  // 北・南の壁の帯
  for (const [zz, sgn, gap] of [[z0 - 0.04, 1, ow], [z1 + 0.04, -1, dw]] as const) {
    for (const sx of [-1, 1]) {
      const wx = (gap + x1) / 2, ww = x1 - gap;
      B.hazard.box(sx * wx, 0.17, zz, ww, 0.34, 0.08, 0xffffff, { tu: 1.6 });
      B.solid.box(sx * wx, 0.95, zz + sgn * 0.01, ww, 1.0, 0.1, K.dnavy, false);
      B.glow.box(sx * wx, 5.7, zz + sgn * 0.01, ww, 0.1, 0.06, K.cyan, false);
    }
  }
  // 開口の枠（ハザード柄の柱と黒い枠）
  for (const sx of [-1, 1]) {
    B.hazard.box(sx * (ow + 0.15), G.shutterH / 2, z0 + 0.05, 0.3, G.shutterH, 0.5, 0xffffff, { tu: 1.2 });
    B.hazard.box(sx * (dw + 0.15), G.doorH / 2, z1 - 0.05, 0.3, G.doorH, 0.5, 0xffffff, { tu: 1.2 });
  }
  B.solid.box(0, G.shutterH + 0.3, z0 + 0.05, ow * 2 + 0.6, 0.6, 0.55, K.ink, false);
  B.solid.box(0, G.doorH + 0.3, z1 - 0.05, dw * 2 + 0.6, 0.6, 0.55, K.ink, false);
  B.glow.box(0, G.doorH + 0.02, z1 - 0.33, dw * 2, 0.06, 0.04, K.cyan, false);
  B.glow.box(0, G.shutterH + 0.02, z0 + 0.33, ow * 2, 0.06, 0.04, K.cyan, false);

  // ---- 天井：梁・照明パネル・レール・配管
  for (let z = z0 + 1; z <= z1; z += 6) B.solid.box(0, H - 0.3, z, x1 - x0, 0.6, 0.5, K.dark, false);
  for (const lx of [-6.5, 6.5]) {
    for (const lz of [-7, -1, 5, 11]) B.glow.box(lx, H - 0.02, lz, 3.6, 0.05, 1.0, 0xdff4ff, false);
    B.solid.box(lx, H - 0.1, (z0 + z1) / 2, 0.5, 0.2, L, K.ink, false); // 光の台座の溝
  }
  // 走行クレーン（天井レール＋橋）
  for (const rx of [-9.5, 9.5]) {
    B.metal.box(rx, H - 0.9, (z0 + z1) / 2, 0.3, 0.3, L, K.steel, false);
    B.glow.box(rx, H - 1.07, (z0 + z1) / 2, 0.05, 0.03, L, K.yellow, false);
  }
  B.metal.box(0, H - 1.2, 4.5, 19.5, 0.5, 0.7, K.orange, false);
  B.solid.box(2.4, H - 1.95, 4.5, 1.1, 0.9, 1.0, K.dark, false);
  B.metal.cyl(2.4, H - 3.0, 4.5, 0.04, 1.2, K.steel, 6, false);
  B.solid.box(2.4, H - 3.7, 4.5, 0.5, 0.35, 0.5, K.yellow, false);
  // 配管：東西の壁の上部
  for (const sx of [-1, 1]) {
    B.metal.cyl(sx * (x1 - 0.55), 4.5, (z0 + z1) / 2, 0.17, L, K.mid, 10, false, undefined, 0, Math.PI / 2);
    B.metal.cyl(sx * (x1 - 0.55), 4.0, (z0 + z1) / 2, 0.11, L, K.steel, 8, false, undefined, 0, Math.PI / 2);
    for (let z = z0 + 2; z < z1; z += 5) B.solid.box(sx * (x1 - 0.55), 4.25, z, 0.22, 0.9, 0.2, K.dark, false);
    B.glow.box(sx * (x1 - 0.55), 4.5, z0 + 5.2, 0.38, 0.05, 0.1, K.yellow, false);
  }

  // ---- 床：駐車ベイ（車の下）・光の矢印・ガイドライン
  const cx = G.carX, cz = G.carZ;
  B.solid.box(cx, 0.03, cz, 5.6, 0.06, 7.6, K.dark, false);
  B.floor.box(cx, 0.065, cz, 5.2, 0.02, 7.2, 0xffffff, { tu: T });
  for (const sx of [-1, 1]) {
    B.hazard.box(cx + sx * 2.7, 0.05, cz, 0.3, 0.08, 7.6, 0xffffff, { tu: 1 });
    B.glow.box(cx + sx * 2.45, 0.1, cz, 0.06, 0.02, 7.2, K.cyan, false);
  }
  for (const sz of [-1, 1]) B.glow.box(cx, 0.1, cz + sz * 3.5, 5.0, 0.02, 0.07, K.cyan, false);
  // 床のガイドライン（階段の入口 → 車 → シャッター）。矢印は明るさを動かす
  B.glow.box(0, 0.025, (z1 + cz + 3.8) / 2, 0.14, 0.02, z1 - cz - 3.8, K.cyan, false);
  B.glow.box(-2.7, 0.025, (z0 + cz - 3.8) / 2, 0.1, 0.02, cz - 3.8 - z0, K.yellow, false);
  B.glow.box(2.7, 0.025, (z0 + cz - 3.8) / 2, 0.1, 0.02, cz - 3.8 - z0, K.yellow, false);
  const pulse = new THREE.MeshBasicMaterial({ vertexColors: true });
  const arrows = new Batch();
  for (let i = 0; i < 4; i++) {
    const az = z0 + 2.2 + i * 1.5;
    arrows.box(-0.25, 0.03, az, 0.12, 0.02, 0.9, K.yellow, false, 0.6);
    arrows.box(0.25, 0.03, az, 0.12, 0.02, 0.9, K.yellow, false, -0.6);
  }
  // ---- 床の汚れ・排水溝・ライン
  for (const sz of [-6, 9]) B.solid.box(0, 0.01, sz, x1 - x0 - 4, 0.02, 0.3, K.ink, false);
  B.hazard.box(0, 0.015, z0 + 0.4, ow * 2 + 0.6, 0.03, 0.8, 0xffffff, { tu: 1.2 });

  // ---- 西の壁：作業台・工具棚・モニター
  const bench = (x: number, z: number): void => {
    B.metal.box(x, 0.9, z, 0.9, 0.06, 3.2, K.light, false);
    B.solid.box(x - 0.05, 0.45, z, 0.7, 0.9, 3.0, K.dnavy, false);
    B.solid.box(x + 0.05, 1.35, z - 0.6, 0.06, 0.7, 1.2, K.ink, false, 0, 0, 0.0);
    B.glow.box(x + 0.03, 1.35, z - 0.6, 0.02, 0.58, 1.08, 0x7fe8ff, false);
    for (let i = 0; i < 5; i++) B.glow.box(x - 0.2, 0.93, z + 0.2 + i * 0.45, 0.14, 0.02, 0.07, [K.green, K.cyan, K.yellow][i % 3], false);
    B.solid.box(x + 0.1, 0.99, z + 1.0, 0.4, 0.12, 0.4, K.red, false);
    colliders.push(col(x - 0.55, x + 0.55, 0, 1.6, z - 1.6, z + 1.6, 'prop'));
  };
  bench(-11.4, -5.5);
  bench(-11.4, 3.5);
  // 工具キャビネット
  for (const z of [-1.2, 9]) {
    B.solid.box(-11.5, 1.05, z, 1.0, 2.1, 1.6, K.navy, false);
    B.panel.box(-10.97, 1.05, z, 0.06, 1.9, 1.5, 0xffffff, { tu: 1.5 });
    for (let i = 0; i < 4; i++) B.glow.box(-10.93, 0.4 + i * 0.5, z + 0.5, 0.03, 0.06, 0.3, [K.cyan, K.green][i % 2], false);
    colliders.push(col(-12, -10.9, 0, 2.1, z - 0.8, z + 0.8, 'prop'));
  }
  // 樽・コンテナ
  for (const [bx, bz, c] of [[-11.2, 12.4, K.yellow], [-10.4, 12.7, K.red], [-11.4, 11.4, K.blue]] as const) {
    B.solid.cyl(bx, 0.55, bz, 0.4, 1.1, c, 12, false);
    B.glow.box(bx, 0.9, bz, 0.7, 0.05, 0.7, 0xffffff, false); // 蓋のリングの照り返し
    colliders.push(col(bx - 0.42, bx + 0.42, 0, 1.1, bz - 0.42, bz + 0.42, 'prop'));
  }

  // ---- 東の壁：棚・充電スタンド
  for (const z of [-6.5, 6.5, 10.5]) {
    B.metal.box(11.4, 1.15, z, 1.0, 0.06, 2.6, K.steel, false);
    B.metal.box(11.4, 2.0, z, 1.0, 0.06, 2.6, K.steel, false);
    B.metal.box(11.4, 0.3, z, 1.0, 0.06, 2.6, K.steel, false);
    for (const dz of [-1.25, 1.25]) B.metal.box(11.4, 1.1, z + dz, 0.08, 2.2, 0.08, K.dark, false);
    for (const [ly, dz, w, c] of [[1.4, -0.7, 0.7, K.orange], [1.4, 0.4, 0.8, K.blue], [2.3, -0.5, 0.9, K.yellow], [0.55, 0.0, 1.2, K.light], [0.55, 0.9, 0.5, K.red], [2.3, 0.7, 0.5, K.cyan]] as const) {
      B.solid.box(11.4, ly, z + dz, 0.8, 0.5, w, c, false);
    }
    colliders.push(col(10.9, 12, 0, 2.6, z - 1.3, z + 1.3, 'prop'));
  }
  // 充電スタンド（太い柱＋シアンの光）
  B.solid.cyl(11.2, 1.0, -1.0, 0.45, 2.0, K.light, 14, false);
  B.glow.box(10.74, 1.2, -1.0, 0.04, 1.3, 0.14, K.cyan, false);
  B.solid.box(11.2, 2.05, -1.0, 1.0, 0.18, 1.0, K.dark, false);
  colliders.push(col(10.7, 11.7, 0, 2.2, -1.5, -0.5, 'prop'));
  B.metal.cyl(10.4, 0.5, -1.0, 0.03, 1.0, K.steel, 6, false);

  // ---- 北の壁：シャッターの電源ソケット周り
  const sk = G.socketX;
  B.solid.box(sk, 1.6, z0 + 0.22, 1.1, 1.4, 0.36, K.dark, false);
  B.metal.box(sk, 1.6, z0 + 0.42, 0.88, 1.18, 0.06, K.steel, false);
  // 電気のマーク（稲妻：斜めの板3枚）
  B.glow.box(sk - 0.04, 1.95, z0 + 0.46, 0.1, 0.4, 0.02, K.yellow, false, 0, 0, 0.35);
  B.glow.box(sk + 0.02, 1.7, z0 + 0.46, 0.34, 0.08, 0.02, K.yellow, false, 0, 0, 0);
  B.glow.box(sk + 0.04, 1.45, z0 + 0.46, 0.1, 0.4, 0.02, K.yellow, false, 0, 0, 0.35);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(K.cyan).multiplyScalar(1.6), side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 8, 28), ringMat);
  ring.position.set(sk, 1.6, z0 + 0.5);
  root.add(ring);
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(K.red).multiplyScalar(1.6) });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.06), lampMat);
  lamp.position.set(sk, 2.45, z0 + 0.45);
  root.add(lamp);
  // ケーブルの束：ソケット → 上 → シャッターのモーター
  B.solid.box(sk, 3.5, z0 + 0.12, 0.2, 1.8, 0.16, K.ink, false);
  B.solid.box(sk - 1.3, G.shutterH + 0.55, z0 + 0.12, 2.8, 0.18, 0.16, K.ink, false);
  B.glow.box(sk, 3.5, z0 + 0.21, 0.04, 1.8, 0.02, K.cyan, false);
  // 巻き上げモーターの箱（開口の上）
  B.solid.box(0, G.shutterH + 0.9, z0 + 0.4, ow * 2 + 1.2, 0.9, 0.8, K.navy, false);
  B.metal.cyl(0, G.shutterH + 0.45, z0 + 0.42, 0.35, ow * 2 + 0.6, K.steel, 14, false, undefined, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) B.glow.box(sx * (ow + 0.2), G.shutterH - 0.4, z0 + 0.35, 0.1, 0.1, 0.1, K.red, false);
  // シャッターの両脇の警告灯（作動で緑）
  const shutLampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(K.red).multiplyScalar(1.8) });
  for (const sx of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), shutLampMat);
    l.position.set(sx * (ow + 0.75), G.shutterH - 0.2, z0 + 0.3);
    root.add(l);
  }

  // ---- 看板
  const mkSign = (text: string, theme: 'cyan' | 'red' | 'amber', w: number, h: number, x: number, y: number, z: number, ry: number): void => {
    const t = signTex(text, theme);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ ...(t ? { map: t } : { color: 0x335577 }), transparent: true }));
    m.position.set(x, y, z); m.rotation.y = ry;
    root.add(m);
  };
  mkSign('ガレージ', 'cyan', 4.6, 1.15, 0, G.shutterH + 1.75, z0 + 0.82, 0);
  mkSign('シャッター電源', 'amber', 2.4, 0.6, sk, 2.9, z0 + 0.46, 0);
  mkSign('階段 ↑ 2F サイボーグ改造室', 'cyan', 3.4, 0.85, 0, G.doorH + 1.25, z1 - 0.34, Math.PI);

  // ---- 車の前の整備リフトのアーム（飾り）
  for (const sx of [-1, 1]) {
    B.solid.box(cx + sx * 3.2, 0.5, cz - 1.5, 0.3, 1.0, 0.3, K.orange, false);
    B.solid.box(cx + sx * 3.2, 0.5, cz + 1.5, 0.3, 1.0, 0.3, K.orange, false);
    B.glow.box(cx + sx * 3.2, 1.03, cz - 1.5, 0.12, 0.04, 0.12, K.green, false);
    colliders.push(col(cx + sx * 3.2 - 0.2, cx + sx * 3.2 + 0.2, 0, 1.0, cz - 1.7, cz - 1.3, 'prop'));
    colliders.push(col(cx + sx * 3.2 - 0.2, cx + sx * 3.2 + 0.2, 0, 1.0, cz + 1.3, cz + 1.7, 'prop'));
  }
  // 停まっている車の当たり判定
  const carCollider = col(cx - 1.15, cx + 1.15, 0, 1.7, cz - 2.4, cz + 2.4, 'car');
  colliders.push(carCollider);

  // ================================================================ 階段ホール
  const hw = S.width / 2;
  const N = S.steps, rise = S.topY / N, tread = (S.topStepZ - S.bottomZ) / N;
  const zS = z1 + wt;            // ホールの南端の壁の始まり（ガレージの南の壁の外面）
  const zB = S.backZ;
  const topCeil = S.topY + S.headroom + 1.5;
  // 床（ホールの手前の平らな所）
  B.floor.box(0, -0.2, (zS + S.bottomZ) / 2, hw * 2 + 2 * wt, 0.4, S.bottomZ - zS + 0.01, 0xffffff, { tu: T });
  colliders.push(col(-hw - wt, hw + wt, -3, 0, zS, S.bottomZ, 'floor'));
  // 階段
  for (let i = 0; i < N; i++) {
    const za = S.bottomZ + i * tread, zb = za + tread, top = (i + 1) * rise;
    B.panel.box(0, top / 2, (za + zb) / 2, hw * 2, top, tread, K.light, { tu: T });
    colliders.push(col(-hw, hw, -0.2, top, za, zb, 'stairs'));
    // 段鼻（ハザード＋光）
    B.hazard.box(0, top - 0.02, za + 0.09, hw * 2 - 0.1, 0.05, 0.18, 0xffffff, { tu: 1 });
    if (i % 2 === 0) B.glow.box(0, top - 0.04, zb - 0.015, hw * 2 - 0.3, 0.025, 0.03, K.cyan, false);
  }
  // 上の踊り場
  B.floor.box(0, S.topY - 0.2, (S.topStepZ + zB) / 2, hw * 2, 0.4, zB - S.topStepZ, 0xffffff, { tu: T });
  colliders.push(col(-hw, hw, S.topY - 3, S.topY, S.topStepZ, zB, 'floor'));
  // 側壁・奥の壁
  const hallTop = topCeil + 0.6;
  for (const sx of [-1, 1]) {
    B.panel.box(sx * (hw + wt / 2), hallTop / 2, (zS + zB + wt) / 2, wt, hallTop, zB + wt - zS, 0xffffff, { tu: T });
    colliders.push(col(Math.min(sx * hw, sx * (hw + wt)), Math.max(sx * hw, sx * (hw + wt)), -3, hallTop, zS, zB + wt, 'wall'));
  }
  B.panel.box(0, hallTop / 2, zB + wt / 2, hw * 2 + 2 * wt, hallTop, wt, 0xffffff, { tu: T });
  colliders.push(col(-hw - wt, hw + wt, -3, hallTop, zB, zB + wt, 'wall'));
  // 側壁の飾り：斜めの光の帯・紺の帯・手すり
  const ang = Math.atan2(S.topY, S.topStepZ - S.bottomZ);
  const slopeLen = Math.hypot(S.topY, S.topStepZ - S.bottomZ);
  const zMid = (S.bottomZ + S.topStepZ) / 2;
  for (const sx of [-1, 1]) {
    const wx = sx * (hw - 0.06);
    B.solid.box(wx, S.topY / 2 + 0.75, zMid, 0.1, 1.0, slopeLen, K.dnavy, false, 0, -ang);
    B.glow.box(wx, S.topY / 2 + 1.45, zMid, 0.06, 0.08, slopeLen, K.cyan, false, 0, -ang);
    B.glow.box(wx, S.topY / 2 + 3.6, zMid, 0.06, 0.1, slopeLen, K.cyan, false, 0, -ang);
    // 手すり（壁から少し離す）
    const rx = sx * (hw - 0.35);
    B.metal.cyl(rx, S.topY / 2 + 1.0, zMid, 0.045, slopeLen, K.steel, 8, false, undefined, 0, Math.PI / 2 - ang);
    for (let i = 0; i < N; i += 4) {
      const za = S.bottomZ + (i + 0.5) * tread;
      const top = (i + 1) * rise;
      B.metal.cyl(rx, top + 0.5, za, 0.03, 1.0, K.steel, 6, false);
    }
    // 踊り場の手すり
    B.metal.cyl(rx, S.topY + 1.0, (S.topStepZ + zB) / 2, 0.045, zB - S.topStepZ, K.steel, 8, false, undefined, 0, Math.PI / 2);
  }
  // 天井：5段ごとに高さを上げる段々の天井。照明パネルつき
  for (let g = 0; g * 5 < N; g++) {
    const i0 = g * 5, i1 = Math.min(N, i0 + 5);
    const za = S.bottomZ + i0 * tread, zb = S.bottomZ + i1 * tread;
    const yb = i1 * rise + S.headroom;
    B.solid.box(0, yb + 0.4, (za + zb) / 2, hw * 2, 0.8, zb - za, K.dark, false);
    B.glow.box(0, yb - 0.02, (za + zb) / 2, 2.2, 0.04, Math.max(0.6, zb - za - 0.8), 0xdff4ff, false);
    B.solid.box(0, yb - 0.12, zb - 0.1, hw * 2, 0.24, 0.2, K.ink, false);
  }
  {
    const yb = S.topY + S.headroom + 1.2;
    B.solid.box(0, yb + 0.4, (S.topStepZ + zB) / 2, hw * 2, 0.8, zB - S.topStepZ, K.dark, false);
    B.glow.box(0, yb - 0.02, (S.topStepZ + zB) / 2, 2.4, 0.04, 2.6, 0xdff4ff, false);
    colliders.push(col(-hw, hw, S.topY + S.headroom + 1.2, S.topY + S.headroom + 4, S.topStepZ, zB, 'ceiling'));
  }
  // 天井の当たり判定（階段の上は段々）
  for (let g = 0; g * 5 < N; g++) {
    const i0 = g * 5, i1 = Math.min(N, i0 + 5);
    colliders.push(col(-hw, hw, i1 * rise + S.headroom, i1 * rise + S.headroom + 4, S.bottomZ + i0 * tread, S.bottomZ + i1 * tread, 'ceiling'));
  }
  // 奥の壁：2階へ戻るドア（飾り）と案内
  B.solid.box(0, S.topY + 2.2, zB - 0.05, 3.4, 4.4, 0.12, K.steel, false);
  B.hazard.box(0, S.topY + 0.3, zB - 0.12, 3.4, 0.6, 0.06, 0xffffff, { tu: 1.2 });
  for (const sx of [-1, 1]) B.solid.box(sx * 1.85, S.topY + 2.3, zB - 0.12, 0.3, 4.6, 0.2, K.dnavy, false);
  B.solid.box(0, S.topY + 4.7, zB - 0.12, 4.0, 0.3, 0.2, K.dnavy, false);
  B.glow.box(0, S.topY + 4.9, zB - 0.25, 3.4, 0.08, 0.04, K.green, false);
  mkSign('2F サイボーグ改造室', 'cyan', 3.6, 0.9, 0, S.topY + 5.8, zB - 0.12, Math.PI);
  mkSign('B1 ガレージ ↓', 'amber', 3.4, 0.85, 0, S.topY + 3.0, S.bottomZ + 1, 0);
  // 下の出入口の上（ガレージ側の壁の上）にも飾り帯
  B.glow.box(0, 6.2, zS + 0.05, hw * 2, 0.08, 0.04, K.cyan, false);

  // ================================================================ 研究所の外殻（道から見える側）
  {
    const sh = 36, bt = 0.5;
    // 北の面（道に面する）：左右と上
    for (const sx of [-1, 1]) {
      B.panel.box(sx * (x1 + wt + 14), sh / 2, (z0 - wt + zB + wt) / 2, 28, sh, zB + wt - z0 + wt, 0xe6ebf2, { tu: 4 });
    }
    B.panel.box(0, H + 1 + (sh - H - 1) / 2, (z0 - wt + z1 + wt) / 2, (x1 + wt) * 2, sh - H - 1, z1 - z0 + 2 * wt, 0xe6ebf2, { tu: 4 });
    // 階段ホールの外殻（上と左右）
    B.panel.box(0, hallTop + (sh - hallTop) / 2, (zS + zB + wt) / 2, (hw + wt) * 2, sh - hallTop, zB + wt - zS, 0xe6ebf2, { tu: 4 });
    for (const sx of [-1, 1]) B.panel.box(sx * (hw + wt + 3.5), sh / 2, (zS + zB + wt) / 2, 7, sh, zB + wt - zS, 0xe6ebf2, { tu: 4 });
    // 外観の帯：シアンの横線・紺のライン・看板
    const fz = z0 - wt - 0.04;
    B.solid.box(0, 12, fz, 80, 1.2, 0.2, K.dnavy, false);
    B.glow.box(0, 12.7, fz - 0.05, 80, 0.12, 0.08, K.cyan, false);
    B.solid.box(0, 24, fz, 80, 1.2, 0.2, K.dnavy, false);
    B.glow.box(0, 24.7, fz - 0.05, 80, 0.12, 0.08, K.cyan, false);
    for (let x = -38; x <= 38; x += 4) B.solid.box(x, 18, fz, 0.35, 12, 0.3, K.light, false);
    void bt;
  }
  mkSign('サイボーグ研究所', 'cyan', 14, 3.5, 0, 17, z0 - wt - 0.2, Math.PI);

  // ---- シャッター本体（上端が支点。巻き上げは scale.y を縮める）
  const pivot = new THREE.Group();
  pivot.position.set(0, G.shutterH, z0 + 0.05);
  const sb = new Batch();
  sb.box(0, -G.shutterH / 2, 0, ow * 2 - 0.02, G.shutterH, 0.2, 0xffffff, { tu: 1, tv: 1 });
  const sMat = std({ ...map(shutterTex()), roughness: 0.5, metalness: 0.6, color: 0xffffff });
  const sMesh = sb.mesh(sMat, { cast: true, receive: true });
  if (sMesh) { sMesh.matrixAutoUpdate = true; pivot.add(sMesh); }
  const bar = new Batch();
  bar.box(0, -G.shutterH + 0.3, 0.02, ow * 2, 0.6, 0.28, 0xffffff, { tu: 1.2 });
  const barMesh = bar.mesh(mats.hazard, { cast: true });
  if (barMesh) { barMesh.matrixAutoUpdate = true; pivot.add(barMesh); }
  // 中央の南向きの帯（電力が必要）の表示
  const sgT = signTex('電力を送れ', 'amber', 1024, 256);
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.05), new THREE.MeshBasicMaterial({ ...(sgT ? { map: sgT } : { color: 0x886633 }), transparent: true }));
  sg.position.set(0, -2.4, 0.11);
  pivot.add(sg);
  root.add(pivot);
  const shutterCollider = col(-ow, ow, 0, G.shutterH, z0 - 0.5, z0 + 0.2, 'shutter');
  colliders.push(shutterCollider);

  // ---- 結合したメッシュをシーンへ
  const cast = (m: THREE.Mesh | null, c: boolean, r: boolean): void => { if (m) { m.castShadow = c; m.receiveShadow = r; root.add(m); } };
  cast(B.panel.mesh(mats.panel), true, true);
  cast(B.floor.mesh(mats.floor), false, true);
  cast(B.hazard.mesh(mats.hazard), false, true);
  cast(B.solid.mesh(mats.solid), true, true);
  cast(B.metal.mesh(mats.metal), true, true);
  cast(B.glow.mesh(mats.glow), false, false);
  cast(arrows.mesh(pulse), false, false);

  // ---- 明かり
  const lights: THREE.PointLight[] = [];
  const pl = (c: number, p: number, d: number, x: number, y: number, z: number): void => {
    const l = new THREE.PointLight(c, p, d, 2);
    l.position.set(x, y, z);
    lights.push(l);
  };
  pl(0xeaf6ff, 150, 24, 0, 5.6, 0);
  pl(0xdff0ff, 110, 20, 0, 5.4, -6);
  pl(0xdff0ff, 90, 18, 0, 5.4, 9);
  pl(0x52e8ff, 40, 12, 0, 6, 12.5);                          // 階段の入口
  pl(0xeaf6ff, 90, 20, 0, S.topY + 4.4, 43);                  // 上の踊り場
  pl(0xdff0ff, 80, 20, 0, 8.8, 28);                           // 階段の途中
  pl(0xdff0ff, 70, 16, 0, 3.4, 18.5);                         // 階段の下

  return { root, colliders, shutter: { pivot, collider: shutterCollider, lampMat: shutLampMat }, socket: { pos: v3(sk, G.socketY, z0 + 0.6), ringMat, lampMat }, carCollider, lights, pulse };
}
