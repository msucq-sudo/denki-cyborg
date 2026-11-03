// ルート2（ドレイン装置へ。world.level.data.surgeRoute === 'drain'）の終点：発電所・坂・ドレイン装置の 3D モデル。
// surge.ts が route が 'drain' のときだけ呼ぶ（root を scene へ、colliders を world.colliders へ、update(t) を毎フレーム）。
//
// 作るもの（座標は level/surge/layout.ts の定数）：
//   ・坂（RAMP：footX→topX、高さ 0→topY、幅 width、中心 z=RAMP.centerZ）と、その上の踊り場（topX→landingEndX）、坂の下の支え
//   ・発電所（PLANT：x0..x1 × z0..z1、高さ roofY。伊方のような海沿いの原発：クリーム色の建屋・ミント色の帯のドーム・円筒の建屋・白いタンク）
//     と、脇の別棟（PLANT.sideWing。滑り落ちた車がぶつかる壁）・タービン建屋・補助建屋・煙突・護岸と海（北側）・森の丘
//   ・ドレイン装置（plantDevice.ts：台座・本体・立っている脚・扉・吸い込み脚とエネルギー演出）
//
// 演出が触る物（parts の名前と意味）：
//   door / doorPanels / doorBroken / doorBrokenPanels … 入口の扉（使い方は plantDevice.ts の「入口の扉」の注釈）
//   suckLegs[4]       吸い込み脚（DOMES[i] ↔ SUCK_LEGS[i] と同じ順。Group。原点＝ドーム側の先端）
//   pierceFx[4]       ドームが貫かれた所のひび割れの光（Group）
//   domes[4]          ドーム（Mesh。材質は個別なので emissiveIntensity を上げれば光る）
//   sideWing          坂の脇の別棟（激突する壁。Group）
//   ramp              坂全体（Group。ローカル原点＝坂の下 (RAMP.footX, 0, RAMP.centerZ)、x＝坂に沿って、y＝坂の面の上）
//   device            装置の本体（Group）／ platform 台座 ／ standingLegs[4] 立っている脚 ／ core 頭の上の光る核 ／ beam 光の柱
//   plant             発電所の本体（Group）／ sea 海 ／ stack 煙突
import * as THREE from 'three';
import type { AABB } from '../../core/types';
import { hazardTex } from '../floor1/visuals';
import { Batch, rng } from './batch';
import { DEVICE_PLATFORM, DOMES, PLANT, RAMP, ROAD } from './layout';
import { buildDevice } from './plantDevice';
import { bandTex, blockTex, deckTex, domeTex, plantWallTex, seaTex } from './plantTex';

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const col = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tag: string): AABB => ({ min: v3(x0, y0, z0), max: v3(x1, y1, z1), active: true, tag });

export interface DrainPlantParts {
  root: THREE.Group;
  colliders: AABB[];
  /** 演出が触る部品（door, doorPanels, doorBroken, suckLegs, domes, sideWing, ramp, device … 上の注釈のとおり） */
  parts: Record<string, THREE.Object3D | THREE.Object3D[]>;
  /** 毎フレームの動き（ドームの脈動・装置の光・坂の誘導灯・海など）。t=ステージの経過秒 */
  update(t: number): void;
}

const CREAM = 0xffffff, MINT = 0xa6dcc4, WHITE = 0xf1efe6, CONCRETE = 0x9b9a96;

/** Batch → メッシュ（動かすかもしれないので matrixAutoUpdate を戻す） */
function bm(b: Batch, mat: THREE.Material, name?: string): THREE.Mesh | null {
  const m = b.mesh(mat, { name });
  if (m) m.matrixAutoUpdate = true;
  return m;
}

/** 発電所・坂・ドレイン装置を作る。surge.ts が scene.add(root) し、colliders を world.colliders へ足し、world.level.data.surge.plant に置く */
export function buildDrainPlant(): DrainPlantParts {
  const root = new THREE.Group();
  root.name = 'surgeDrainPlant';
  const colliders: AABB[] = [];
  const parts: DrainPlantParts['parts'] = {};
  const jz = ROAD.junctionZ;
  const rand = rng(2024);
  const R = (a: number, b: number) => a + (b - a) * rand();

  // ---------------------------------------------------------------- 材質
  const wRib = plantWallTex('ribbon'), wPan = plantWallTex('panel'), bT = bandTex(), dT = domeTex(), blkT = blockTex();
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, ...(wRib ? { map: wRib } : {}), roughness: 0.85, metalness: 0.02, emissive: 0x8a8272 });
  const panelMat = new THREE.MeshStandardMaterial({ vertexColors: true, ...(wPan ? { map: wPan } : {}), roughness: 0.85, metalness: 0.02, emissive: 0x8a8272 });
  const plainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, emissive: 0x6c675b });
  const steelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5, emissive: 0x0c1020 });
  const blockMat = new THREE.MeshStandardMaterial({ vertexColors: true, ...(blkT ? { map: blkT } : {}), roughness: 0.95, metalness: 0, emissive: 0x24241f });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true }); glowMat.color.setScalar(1.8);
  const hz = hazardTex();
  const hazardMat = new THREE.MeshStandardMaterial({ vertexColors: true, ...(hz ? { map: hz } : {}), roughness: 0.7, metalness: 0, emissive: 0x201a08 });
  const bandMat = new THREE.MeshStandardMaterial({ ...(bT ? { map: bT } : { color: 0xcfe8da }), roughness: 0.8, metalness: 0.02, emissive: 0x303a30 });

  // ================================================================ 敷地（コンクリートの広場）と護岸・海（北側）
  const yard = new Batch();
  yard.box((RAMP.footX + 2300) / 2, -0.27, (-262 + 110) / 2, 2300 - RAMP.footX, 0.6, 372, 0xcfcabd, { tu: 10 });
  const ym = bm(yard, plainMat, 'plantYard'); if (ym) root.add(ym);

  const sea = new THREE.Group(); sea.name = 'plantSea';
  const seaT = seaTex();
  if (seaT) seaT.repeat.set(70, 40);
  const seaMat = new THREE.MeshStandardMaterial({ ...(seaT ? { map: seaT } : { color: 0x1b5a78 }), roughness: 1, metalness: 0, emissive: 0x103a50 });
  const seaMesh = new THREE.Mesh(new THREE.PlaneGeometry(2700, 1500), seaMat);
  seaMesh.rotation.x = -Math.PI / 2; seaMesh.position.set(1620 + 1350, -0.15, -277 - 750); seaMesh.renderOrder = -9;
  sea.add(seaMesh);
  {
    const wall = new Batch(), slope = new Batch();
    const x0 = 1600, x1 = 2300, cx = (x0 + x1) / 2, len = x1 - x0;
    wall.box(cx, 1.75, -262.7, len, 3.5, 1.4, 0xc4c1b6, { tu: 6 });                         // 護岸の上の壁
    wall.box(cx, 3.6, -262.7, len, 0.2, 1.9, 0xd8d5ca, { tu: 6 });
    const dz = 14, dy = 5, ang = -Math.atan2(dy, dz), l = Math.hypot(dy, dz);
    slope.box(cx, 0.6, -263.4 - dz / 2, len, 1.6, l, 0xffffff, { tu: 6 }, 0, ang);           // 海へ下る斜面（コンクリートブロック）
    for (let x = x0 + 8; x < x1; x += 40) wall.box(x, 4.4, -262.7, 0.4, 1.8, 0.4, 0x59627c, false);
    wall.box(x0 - 0.5, 1.75, -270, 1.0, 3.5, 16, 0xc4c1b6, { tu: 6 });                       // 西の端の返し
    const a = bm(wall, plainMat), b = bm(slope, blockMat);
    if (a) sea.add(a);
    if (b) sea.add(b);
    colliders.push(col(x0, x1, 0, 3.6, -263.4, -262, 'seawall'));
  }
  root.add(sea);
  parts.sea = sea;

  // ================================================================ 発電所の本体（原子炉建屋）
  const plant = new THREE.Group(); plant.name = 'plantMain';
  root.add(plant);
  parts.plant = plant;
  const mainW = new Batch(), mainP = new Batch(), mainS = new Batch(), mainG = new Batch(), mainH = new Batch();
  const px0 = PLANT.x0, px1 = PLANT.x1, pz0 = PLANT.z0, pz1 = PLANT.z1, ry = PLANT.roofY;
  const pcx = (px0 + px1) / 2, pcz = (pz0 + pz1) / 2, pw = px1 - px0, pd = pz1 - pz0;
  mainW.box(pcx, ry / 2, pcz, pw, ry, pd, CREAM, { tu: 24, tv: 8 });
  // 土台（灰色の基礎）・上端のミント色の帯・柱型・屋根
  mainP.box(pcx, 2.5, pcz, pw + 0.8, 5, pd + 0.8, 0x8e8c86, { tu: 8 });
  const faceBand = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, color: number): void => {
    mainP.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, color, false);
  };
  for (const [y0, y1, c] of [[44.2, 48.6, MINT], [48.6, 49.6, WHITE]] as const) {
    faceBand(px0 - 0.25, px1 + 0.25, pz0 - 0.25, pz0 + 0.1, y0, y1, c); faceBand(px0 - 0.25, px1 + 0.25, pz1 - 0.1, pz1 + 0.25, y0, y1, c);
    faceBand(px0 - 0.25, px0 + 0.1, pz0 - 0.25, pz1 + 0.25, y0, y1, c); faceBand(px1 - 0.1, px1 + 0.25, pz0 - 0.25, pz1 + 0.25, y0, y1, c);
  }
  for (let x = px0 + 10; x < px1; x += 20) {
    mainP.box(x, ry / 2 + 2, pz0 - 0.35, 2.2, ry - 4, 0.7, 0xd8d0b8, false);
    mainP.box(x, ry / 2 + 2, pz1 + 0.35, 2.2, ry - 4, 0.7, 0xd8d0b8, false);
  }
  for (let z = pz0 + 11; z < pz1; z += 22) {
    if (Math.abs(z - jz) < 14) continue;
    mainP.box(px0 - 0.35, ry / 2 + 2, z, 0.7, ry - 4, 2.2, 0xd8d0b8, false);
  }
  for (let z = pz0 + 11; z < pz1; z += 22) mainP.box(px1 + 0.35, ry / 2 + 2, z, 0.7, ry - 4, 2.2, 0xd8d0b8, false);
  mainP.box(pcx, ry + 0.125, pcz, pw, 0.25, pd, CONCRETE, false);                              // 屋根の面
  // 屋根の縁の立ち上がり（坂が上る西の中央は開ける）
  const par = (x0: number, x1: number, z0: number, z1: number): void => { mainP.box((x0 + x1) / 2, ry + 0.9, (z0 + z1) / 2, x1 - x0, 1.3, z1 - z0, 0xd2cfc4, false); };
  par(px0, px1, pz0, pz0 + 0.8); par(px0, px1, pz1 - 0.8, pz1); par(px1 - 0.8, px1, pz0, pz1);
  par(px0, px0 + 0.8, pz0, jz - 10); par(px0, px0 + 0.8, jz + 10, pz1);
  // 屋根の設備：避けるのはドームと台座
  const inDome = (x: number, z: number, m: number): boolean => DOMES.some((d) => Math.hypot(x - d.x, z - d.z) < d.r + m);
  const inPlat = (x: number, z: number, m: number): boolean => x > DEVICE_PLATFORM.x0 - m && x < DEVICE_PLATFORM.x1 + m && z > DEVICE_PLATFORM.z0 - m && z < DEVICE_PLATFORM.z1 + m;
  for (let n = 0, k = 0; n < 160 && k < 34; n++) {
    const x = R(px0 + 8, px1 - 8), z = R(pz0 + 6, pz1 - 6);
    if (inDome(x, z, 7) || inPlat(x, z, 6)) continue;
    if (Math.abs(z - (jz - 52)) < 4 || Math.abs(z - (jz + 52)) < 4) continue;            // パイプラックの帯
    k++;
    const w = R(4, 8), d = R(3, 6), h = R(2, 4.5);
    mainP.box(x, ry + 0.25 + h / 2, z, w, h, d, k % 3 ? 0xcfcac0 : 0xe4e0d4, false);
    mainS.cyl(x, ry + 0.25 + h + 0.12, z, Math.min(w, d) * 0.32, 0.25, 0x30343c, 10, false);   // ファン
  }
  for (let n = 0, k = 0; n < 120 && k < 14; n++) {
    const x = R(px0 + 8, px1 - 8), z = R(pz0 + 6, pz1 - 6);
    if (inDome(x, z, 6) || inPlat(x, z, 5) || Math.abs(z - (jz - 52)) < 4 || Math.abs(z - (jz + 52)) < 4) continue;
    k++;
    if (k % 3 === 0) { mainP.cyl(x, ry + 0.25 + 2.6, z, 2.4, 5.2, WHITE, 14, false); mainP.cyl(x, ry + 0.25 + 5.3, z, 1.2, 0.5, 0x9aa09c, 10, false, 2.3); }   // 小さな白いタンク
    else mainS.cyl(x, ry + 0.25 + 3.5, z, 0.45, 7, 0xb8bdc4, 8, false);                       // 通気管
  }
  // パイプラック（ドームと台座の間を走る）
  for (const zr of [jz - 52, jz + 52]) {
    for (const dy of [1.6, 2.7]) mainS.cyl(pcx, ry + 0.25 + dy, zr + (dy > 2 ? 0.8 : -0.5), 0.55, pw - 20, dy > 2 ? 0xe8e6de : 0xb8bdc4, 10, false, undefined, 0, 0, Math.PI / 2);
    for (let x = px0 + 14; x < px1 - 10; x += 14) mainS.box(x, ry + 0.25 + 0.8, zr, 0.5, 1.6, 2.4, 0x59627c, false);
  }
  mainP.box(px0 + 8, ry + 0.25 + 4, jz - 75, 10, 8, 7, 0xd8d0b8, false);                      // 屋上の階段室
  mainP.box(px0 + 8, ry + 0.25 + 4, jz + 75, 10, 8, 7, 0xd8d0b8, false);
  // 側面のパイプ（南の壁に沿って下りる）
  for (let i = 0; i < 3; i++) mainS.cyl(px0 + 60 + i * 1.5, ry / 2, pz1 + 1.6, 0.5, ry, 0xb8bdc4, 8, false);
  // 窓まわりの明かり：側面の高所に非常灯
  for (let x = px0 + 20; x < px1; x += 40) { mainG.box(x, 43.5, pz0 - 0.5, 1.0, 0.5, 0.3, 0xfff0c0, false); mainG.box(x, 43.5, pz1 + 0.5, 1.0, 0.5, 0.3, 0xfff0c0, false); }
  // 扉まわり：南北の壁の大きなシャッター
  for (let x = px0 + 30; x < px1 - 20; x += 60) { mainP.box(x, 5, pz1 + 0.3, 9, 9, 0.5, 0x7d8088, false); mainH.box(x, 0.5, pz1 + 0.7, 9.6, 1.0, 0.2, 0xffffff, { tu: 1 }); }
  for (const [b, m] of [[mainW, wallMat], [mainP, plainMat], [mainS, steelMat], [mainG, glowMat], [mainH, hazardMat]] as const) { const mesh = bm(b, m); if (mesh) plant.add(mesh); }
  colliders.push(col(px0, px1, 0, ry, pz0, pz1, 'plant'));

  // ---------------------------------------------------------------- ドーム（4基）：ミントと白の帯の半球
  const domeMeshes: THREE.Mesh[] = [];
  const domeMats: THREE.MeshStandardMaterial[] = [];
  const domeGeo = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const rimB = new Batch();
  DOMES.forEach((d, i) => {
    const m = new THREE.MeshStandardMaterial({ ...(dT ? { map: dT } : { color: 0xcfe8da }), roughness: 0.55, metalness: 0.05, emissive: 0x40c0a0, emissiveIntensity: 0.3 });
    const mesh = new THREE.Mesh(domeGeo, m);
    mesh.scale.setScalar(d.r); mesh.position.set(d.x, d.baseY + 0.25, d.z); mesh.name = `dome${i}`;
    plant.add(mesh); domeMeshes.push(mesh); domeMats.push(m);
    rimB.cyl(d.x, d.baseY + 0.9, d.z, d.r + 0.5, 1.3, WHITE, 40, false);
    rimB.cyl(d.x, d.baseY + 0.25 + d.r + 0.5, d.z, 0.25, 2.2, 0xb8bdc4, 6, false);          // 避雷針
    rimB.box(d.x + d.r * 0.55, d.baseY + 5, d.z - 6, 3, 1.6, 2.4, 0xcfcac0, false);          // 点検ハッチ
  });
  { const rm = bm(rimB, plainMat); if (rm) plant.add(rm); }
  parts.domes = domeMeshes;

  // ================================================================ 脇の別棟（坂の脇の低い翼。滑り落ちた車がぶつかる壁）
  const SW = PLANT.sideWing;
  {
    const g = new THREE.Group(); g.name = 'plantSideWing';
    const b = new Batch(), pb = new Batch(), hb = new Batch(), sb = new Batch();
    const cx = (SW.x0 + SW.x1) / 2, cz = (SW.z0 + SW.z1) / 2, w = SW.x1 - SW.x0, d = SW.z1 - SW.z0, h = SW.height;
    b.box(cx, h / 2, cz, w, h, d, CREAM, { tu: 24, tv: 8 });
    pb.box(cx, 1.5, cz, w + 0.6, 3, d + 0.6, 0x8e8c86, { tu: 8 });
    pb.box(cx, h + 0.15, cz, w + 0.8, 0.3, d + 0.8, CONCRETE, false);
    pb.box(cx, h - 2.2, SW.z0 - 0.2, w + 0.4, 3.6, 0.5, MINT, false);                       // 坂側（北面）のミントの帯
    pb.box(cx, h - 2.2, SW.z1 + 0.2, w + 0.4, 3.6, 0.5, MINT, false);
    pb.box(cx, h - 0.2, SW.z0 - 0.2, w + 0.4, 0.8, 0.6, WHITE, false);
    pb.box(SW.x0 - 0.2, h - 2.2, cz, 0.5, 3.6, d + 0.4, MINT, false);
    // 北面（坂側）の大きな荷下ろし扉とハザード帯
    for (let x = SW.x0 + 14; x < SW.x1 - 10; x += 28) {
      pb.box(x, 4.5, SW.z0 - 0.15, 10, 8, 0.4, 0x6e727c, false);
      hb.box(x, 0.45, SW.z0 - 0.3, 11, 0.9, 0.2, 0xffffff, { tu: 0.9 });
      sb.box(x, 9.2, SW.z0 - 0.35, 10.4, 0.5, 0.3, 0x59627c, false);
    }
    for (let x = SW.x0 + 20; x < SW.x1; x += 40) pb.box(x, h / 2, SW.z0 - 0.4, 1.8, h - 4, 0.8, 0xd8d0b8, false);
    // 屋根の設備
    for (let i = 0; i < 9; i++) {
      const x = SW.x0 + 14 + i * 20, z = cz + (i % 2 ? 14 : -10);
      pb.box(x, h + 0.3 + 1.6, z, 6.5, 3.2, 4.5, i % 3 ? 0xcfcac0 : 0xe4e0d4, false);
      sb.cyl(x, h + 0.3 + 3.35, z, 1.6, 0.25, 0x30343c, 10, false);
    }
    sb.cyl((SW.x0 + SW.x1) / 2, h + 2.2, cz + 24, 0.55, w - 20, 0xb8bdc4, 10, false, undefined, 0, 0, Math.PI / 2);
    for (const [bb, m] of [[b, wallMat], [pb, plainMat], [hb, hazardMat], [sb, steelMat]] as const) { const mesh = bm(bb, m); if (mesh) g.add(mesh); }
    root.add(g);
    parts.sideWing = g;
    colliders.push(col(SW.x0, SW.x1, 0, SW.height, SW.z0, SW.z1, 'plantSideWing'));
  }

  // ================================================================ 周りの建物：タービン建屋・補助建屋・円筒の建屋・タンク・煙突
  const site = new Batch(), siteP = new Batch(), siteS = new Batch(), siteG = new Batch(), siteT = new Batch();
  const beacons: THREE.Mesh[] = [];
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  const box3 = (x0: number, x1: number, z0: number, z1: number, h: number, kind: 'ribbon' | 'panel', tag: string): void => {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    (kind === 'ribbon' ? site : siteT).box(cx, h / 2, cz, w, h, d, CREAM, { tu: 24, tv: 8 });
    siteP.box(cx, 1.5, cz, w + 0.6, 3, d + 0.6, 0x8e8c86, { tu: 8 });
    siteP.box(cx, h + 0.15, cz, w + 0.4, 0.3, d + 0.4, CONCRETE, false);
    siteP.box(cx, h - 1.8, z0 - 0.2, w + 0.5, 3, 0.5, MINT, false); siteP.box(cx, h - 1.8, z1 + 0.2, w + 0.5, 3, 0.5, MINT, false);
    siteP.box(x1 + 0.2, h - 1.8, cz, 0.5, 3, d + 0.5, MINT, false);
    colliders.push(col(x0, x1, 0, h, z0, z1, tag));
  };
  // タービン建屋（長い無窓の白い箱）
  box3(1960, 2130, -190, -112, 36, 'panel', 'turbineHall');
  for (let x = 1975; x < 2125; x += 15) siteP.box(x, 36.3 + 1.2, -151, 8, 2.4, 40, 0xe4e0d4, false);    // 屋根の通気塔
  siteS.cyl(2045, 38.5, -128, 0.8, 120, 0xb8bdc4, 10, false, undefined, 0, 0, Math.PI / 2);
  // 補助建屋
  box3(1960, 2050, -100, -8, 26, 'ribbon', 'auxBuilding');
  for (let i = 0; i < 5; i++) { siteP.box(1975 + i * 16, 26.3 + 1.5, -54 + (i % 2 ? 14 : -14), 6, 3, 5, 0xcfcac0, false); }
  // 円筒の建屋：ミント・白・薄い黄の帯（円柱は別メッシュ）
  const cyls: { x: number; z: number; r: number; h: number }[] = [{ x: 1690, z: -170, r: 19, h: 76 }, { x: 2085, z: -60, r: 15, h: 54 }];
  const cylGroup = new THREE.Group(); cylGroup.name = 'plantCylinders';
  for (const c of cyls) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, c.h, 40, 1), bandMat);
    m.position.set(c.x, c.h / 2, c.z); cylGroup.add(m);
    siteP.cyl(c.x, c.h + 0.5, c.z, c.r + 0.7, 1.0, 0x8d9296, 40, false);                           // 屋上の縁
    siteP.cyl(c.x, c.h + 2.5, c.z, c.r * 0.45, 3, WHITE, 24, false);                                // 屋上の機械室
    siteP.cyl(c.x, 1.5, c.z, c.r + 0.8, 3, 0x8e8c86, 40, false);
    for (let a = 0; a < 24; a++) { const t = (a / 24) * Math.PI * 2; siteS.cyl(c.x + Math.cos(t) * (c.r + 0.3), c.h + 1.7, c.z + Math.sin(t) * (c.r + 0.3), 0.08, 1.8, 0x9aa09c, 4, false); }
    siteS.cyl(c.x, c.h + 8, c.z, 0.2, 8, 0x9aa09c, 5, false);
    const bc = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), beaconMat); bc.position.set(c.x, c.h + 12.2, c.z); cylGroup.add(bc); beacons.push(bc);
    colliders.push(col(c.x - c.r, c.x + c.r, 0, c.h, c.z - c.r, c.z + c.r, 'plantCylinder'));
  }
  root.add(cylGroup);
  parts.cylinders = cylGroup;
  // 煙突（赤白の縞）
  {
    const sx = 2112, sz = -30, segs = 10, H = 150;
    for (let i = 0; i < segs; i++) {
      const y0 = (i / segs) * H, y1 = ((i + 1) / segs) * H, r0 = 6 - 2.6 * (i / segs), r1 = 6 - 2.6 * ((i + 1) / segs);
      siteP.cyl(sx, (y0 + y1) / 2, sz, r0, y1 - y0, i % 2 ? 0xd8342a : 0xf1efe6, 16, false, r1);
    }
    siteP.cyl(sx, 1.5, sz, 8, 3, 0x8e8c86, 16, false);
    const bc = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), beaconMat); bc.position.set(sx, H + 1.6, sz); cylGroup.add(bc); beacons.push(bc);
    colliders.push(col(sx - 7, sx + 7, 0, H, sz - 7, sz + 7, 'plantStack'));
    parts.stack = cylGroup;
  }
  // 白いタンク群（敷地の南）とパイプラック
  {
    const addTank = (x: number, z: number, r: number, h: number): void => {
      siteP.cyl(x, h / 2 + 0.6, z, r, h, WHITE, 24, false);
      siteP.sphere(x, h + 0.6, z, r, WHITE, 24, 6, false, Math.PI / 2);
      siteP.cyl(x, 0.3, z, r + 0.4, 0.6, 0x8e8c86, 24, false);
      siteS.cyl(x + r * 0.7, h / 2, z + r * 0.7, 0.25, h, 0x9aa09c, 5, false);
      colliders.push(col(x - r, x + r, 0, h + r * 0.6, z - r, z + r, 'plantTank'));
    };
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) addTank(1800 + i * 28, 56 + j * 26, 8.5, 14);
    for (let i = 0; i < 4; i++) addTank(1590 + i * 22, 44, 6.5, 11);
    for (let i = 0; i < 3; i++) addTank(2080 + i * 24, 30, 7, 12);
    // 地上のパイプ（建屋とタンクの間）
    for (const dz of [0, 1.2]) siteS.cyl(1890, 3.2 + dz, 38 + dz, 0.6, 200, dz ? 0xe8e6de : 0xb8bdc4, 10, false, undefined, 0, 0, Math.PI / 2);
    for (let x = 1795; x < 1990; x += 14) siteS.box(x, 1.6, 38.6, 0.5, 3.2, 2.2, 0x59627c, false);
    // 変電所：碍子と鉄塔（細身の格子）
    for (let i = 0; i < 5; i++) {
      const x = 2170 + i * 14, z = 40;
      siteS.box(x, 9, z, 0.7, 18, 0.7, 0xb8bdc4, false); siteS.box(x, 17, z, 9, 0.5, 0.5, 0xb8bdc4, false);
      for (const dx of [-3.5, 0, 3.5]) siteS.cyl(x + dx, 15, z, 0.35, 3.5, 0xc8a070, 6, false);
    }
  }
  // 投光器の柱（広場の端に並ぶ）
  for (let x = 1580; x < 2300; x += 60) for (const z of [-236, 82]) {
    siteS.cyl(x, 11, z, 0.35, 22, 0x59627c, 6, false);
    siteG.box(x, 22.4, z, 3.6, 0.9, 0.5, 0xfff0c0, false);
  }
  for (const [b, m] of [[site, wallMat], [siteT, panelMat], [siteP, plainMat], [siteS, steelMat], [siteG, glowMat]] as const) { const mesh = bm(b, m); if (mesh) root.add(mesh); }

  // ================================================================ 坂（road → 装置の入口）
  const rampG = new THREE.Group(); rampG.name = 'drainRamp';
  const th = Math.atan2(RAMP.topY, RAMP.topX - RAMP.footX), Lr = Math.hypot(RAMP.topX - RAMP.footX, RAMP.topY);
  rampG.position.set(RAMP.footX, 0, RAMP.centerZ);
  rampG.rotation.z = th;
  root.add(rampG);
  const HW = RAMP.width / 2;
  const deckT = deckTex();
  const mkDeckMat = (repX: number): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3, ...(deckT.map ? { map: deckT.map.clone() } : { color: 0x2b2f38 }), ...(deckT.emissive ? { emissiveMap: deckT.emissive.clone(), emissive: 0xffffff, emissiveIntensity: 1.6 } : {}) });
    for (const t of [m.map, m.emissiveMap]) if (t) { t.repeat.set(repX, 1); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; }
    return m;
  };
  const deckMat = mkDeckMat(Lr / 24);
  let landingMat: THREE.MeshStandardMaterial | undefined;
  {
    const sb = new Batch(), cb = new Batch(), hb = new Batch(), gb = new Batch(), ab = new Batch();
    cb.box(Lr / 2, -0.9, 0, Lr + 0.4, 1.8, RAMP.width + 0.6, 0x4a4f5a, false);                         // 床板
    sb.box(Lr / 2, -2.7, 0, Lr, 1.7, 5.4, 0x3a4560, false);                                           // 下の太い桁
    for (let x = 6; x < Lr; x += 12) sb.box(x, -2.1, 0, 0.9, 1.3, RAMP.width - 1, 0x2e3850, false);
    hb.box(Lr / 2, -0.9, HW + 0.4, Lr + 0.4, 1.7, 0.12, 0xffffff, { tu: 1.7 });
    hb.box(Lr / 2, -0.9, -HW - 0.4, Lr + 0.4, 1.7, 0.12, 0xffffff, { tu: 1.7 });
    for (let x = 0.3; x < Lr - 1; x += 6) cb.box(x, 0.12, 0, 0.5, 0.24, RAMP.width - 2.2, 0x59627c, false);   // 段のリブ
    for (const s of [-1, 1]) {
      const z = s * (HW - 0.1);
      // 柵は付けない（真横のショットで車が隠れるため）。低い縁石と光る誘導灯・光のラインだけ
      cb.box(Lr / 2, 0.12, z, Lr, 0.25, 0.55, 0x6c717c, false);                                        // 縁石
      for (let x = 2; x < Lr; x += 8) gb.box(x + 4, 0.3, z, 0.5, 0.12, 0.5, (x / 8) % 2 ? 0xffd23a : 0x52e8ff, false);
      gb.box(Lr / 2, 0.27, z - s * 0.3, Lr, 0.06, 0.06, 0x52e8ff, false);                            // 縁の光のライン
    }
    // 門型の枠は付けない（ムービーで車の前を柱が横切るため）
    for (const [b, m] of [[cb, plainMat], [sb, steelMat], [hb, hazardMat], [gb, glowMat], [ab, glowMat]] as const) { const mesh = bm(b, m); if (mesh) rampG.add(mesh); }
    const top = new THREE.Mesh(new THREE.PlaneGeometry(Lr, RAMP.width - 0.2), deckMat);
    top.rotation.x = -Math.PI / 2; top.position.set(Lr / 2, 0.03, 0);
    rampG.add(top);
  }
  // 坂の下の支え（地面から床板の下まで）
  {
    const pb = new Batch(), sb = new Batch();
    const pillars: { x: number; h: number }[] = [];
    for (let x = RAMP.footX + 24; x <= PLANT.x0; x += 24) pillars.push({ x, h: RAMP.yAt(x) - 3.7 });
    pillars.forEach((p, i) => {
      for (const s of [-1, 1]) {
        const z = jz + s * 5.4;
        pb.box(p.x, 0.5, z, 3.6, 1.0, 3.6, 0x8e8c86, { tu: 4 });
        pb.box(p.x, p.h / 2 + 0.5, z, 1.9, p.h, 1.9, 0x9a9a98, { tu: 4 });
      }
      sb.box(p.x, p.h + 0.4, jz, 1.8, 1.0, 13.2, 0x3a4560, false);                                      // 梁
      if (p.h > 9) {
        const mid = p.h * 0.5;
        sb.box(p.x, mid, jz, 1.0, 0.8, 9.0, 0x3a4560, false);
        const len = Math.hypot(9.0, mid - 1.5), a = -Math.atan2(mid - 1.5, 9.0);
        sb.box(p.x, (mid + 1.5) / 2, jz, 0.5, 0.5, len, 0x59627c, false, 0, a);
        sb.box(p.x, (mid + 1.5) / 2, jz, 0.5, 0.5, len, 0x59627c, false, 0, -a);
        const nx = pillars[i + 1];
        if (nx) for (const s of [-1, 1]) sb.box((p.x + nx.x) / 2, mid + (nx.h - p.h) * 0.25, jz + s * 5.4, 24, 0.7, 0.7, 0x3a4560, false, 0, 0, Math.atan2(nx.h * 0.5 - p.h * 0.5, 24));
      }
    });
    const a = bm(pb, plainMat), b = bm(sb, steelMat);
    if (a) rampG.parent!.add(a);
    if (b) rampG.parent!.add(b);
  }
  // 踊り場（坂の上→扉）の路面と縁石
  {
    landingMat = mkDeckMat(1);
    const landing = new THREE.Mesh(new THREE.PlaneGeometry(RAMP.landingEndX - RAMP.topX, RAMP.width - 0.2), landingMat);
    landing.rotation.x = -Math.PI / 2; landing.position.set((RAMP.topX + RAMP.landingEndX) / 2, RAMP.topY + 0.04, jz);
    root.add(landing);
    const lb = new Batch(), gb = new Batch();
    for (const s of [-1, 1]) {
      lb.box((RAMP.topX + RAMP.landingEndX) / 2, RAMP.topY + 0.12, jz + s * (HW - 0.1), RAMP.landingEndX - RAMP.topX, 0.25, 0.55, 0x6c717c, false);
      gb.box((RAMP.topX + RAMP.landingEndX) / 2, RAMP.topY + 0.27, jz + s * (HW - 0.4), RAMP.landingEndX - RAMP.topX, 0.08, 0.06, 0x52e8ff, false);
    }
    const a = bm(lb, plainMat), b = bm(gb, glowMat);
    if (a) root.add(a);
    if (b) root.add(b);
  }
  parts.ramp = rampG;

  // ================================================================ 森の丘（東と南）と林床
  {
    const forest = new THREE.Group(); forest.name = 'plantHills';
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x3c6a40, roughness: 1, metalness: 0, depthWrite: false });
    const mkFloor = (x0: number, x1: number, z0: number, z1: number): void => {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), floorMat);
      f.rotation.x = -Math.PI / 2; f.position.set((x0 + x1) / 2, -0.35, (z0 + z1) / 2); f.renderOrder = -8; forest.add(f);
    };
    mkFloor(1640, 3300, 118, 640); mkFloor(2310, 3300, -270, 118);
    const hillMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, emissive: 0x0e1c10 });
    const hills: [number, number, number, number, number][] = [
      [2440, -150, 210, 270, 115], [2540, 130, 240, 230, 160], [2720, -250, 270, 210, 140], [2760, 50, 300, 270, 210], [2420, 300, 210, 190, 95],
      [1930, 430, 270, 200, 125], [1680, 500, 230, 210, 105], [2180, 460, 250, 210, 150], [2500, 450, 280, 220, 175], [3000, -80, 320, 300, 230],
    ];
    const c1 = new THREE.Color(0x24442c), c2 = new THREE.Color(0x4f8048), c3 = new THREE.Color(0x35603a), tc = new THREE.Color();
    for (const [hx, hzz, rx, rz, hh] of hills) {
      const g = new THREE.SphereGeometry(1, 36, 16, 0, Math.PI * 2, 0, Math.PI / 2);
      const pos = g.getAttribute('position');
      const cols = new Float32Array(pos.count * 3);
      const seed = hx * 0.013 + hzz * 0.007;
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
        const nz = Math.sin(x * 6 + seed) * Math.cos(z * 5 - seed) * 0.07 + Math.sin(x * 15 + z * 11) * 0.025;
        const s = 1 + nz * (y > 0.01 ? 1 : 0);
        pos.setXYZ(k, x * rx * s, y * hh * s, z * rz * s);
        const tex = (Math.sin(x * 61 + z * 47) + Math.sin(x * 113 - z * 89)) * 0.5;
        tc.copy(c1).lerp(c2, Math.min(1, y * 0.8 + 0.15 * tex + 0.1)).lerp(c3, 0.25 + 0.25 * tex);
        cols[k * 3] = tc.r; cols[k * 3 + 1] = tc.g; cols[k * 3 + 2] = tc.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, hillMat);
      m.position.set(hx, -0.3, hzz);
      forest.add(m);
    }
    root.add(forest);
    parts.hills = forest;
  }

  // ================================================================ ドレイン装置
  const dev = buildDevice();
  root.add(dev.root);
  for (const c of dev.colliders) colliders.push(c);
  Object.assign(parts, dev.parts);

  // ================================================================ 毎フレーム
  const emT = deckMat.emissiveMap;
  const update = (t: number): void => {
    dev.update(t);
    if (emT) emT.offset.x = -((t * 0.45) % 1);                                  // 誘導灯が坂を駆け上がる
    if (landingMat?.emissiveMap) landingMat.emissiveMap.offset.x = -((t * 0.45) % 1);
    deckMat.emissiveIntensity = 1.5 + 0.4 * Math.sin(t * 3);
    glowMat.color.setScalar(1.7 + 0.3 * Math.sin(t * 2.4));
    domeMats.forEach((m, i) => { m.emissiveIntensity = 0.24 + 0.12 * Math.sin(t * 2.2 + i * 1.3) + 0.06 * Math.sin(t * 7.1 + i); });
    if (seaT) { seaT.offset.set((t * 0.004) % 1, (t * 0.002) % 1); }
    const on = Math.floor(t * 0.9) % 2;
    beaconMat.color.setRGB(on ? 2.2 : 0.35, on ? 0.2 : 0.04, 0.1);
  };
  return { root, colliders, parts, update };
}
