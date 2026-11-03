// ルート2：発電所の屋上に載ったドレイン装置（台座・本体・立っている脚・入口の扉・吸い込み脚とそのエネルギー演出）。
// 座標は layout.ts の DEVICE / DEVICE_PLATFORM / STANDING_LEGS / SUCK_LEGS / DRAIN_DOOR / DOMES。plant.ts が呼ぶ。
import * as THREE from 'three';
import type { AABB } from '../../core/types';
import { hazardTex } from '../floor1/visuals';
import { Batch, rng } from './batch';
import { DEVICE, DEVICE_PLATFORM, DOMES, DRAIN_DOOR, ROAD, STANDING_LEGS, SUCK_LEGS } from './layout';
import { conduitTex, crackTex, pillarTex, steelTex } from './plantTex';
import { glowTex, signTex } from './textures';

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const col = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tag: string): AABB => ({ min: v3(x0, y0, z0), max: v3(x1, y1, z1), active: true, tag });
const CYAN = 0x52e8ff, YEL = 0xffd23a;

/** Batch → 動かしてよいメッシュ（Batch.mesh は matrixAutoUpdate=false なので戻す） */
function bm(b: Batch, mat: THREE.Material, name?: string): THREE.Mesh | null {
  const m = b.mesh(mat, { cast: false, name });
  if (m) m.matrixAutoUpdate = true;
  return m;
}

export interface DeviceParts {
  root: THREE.Group;
  colliders: AABB[];
  parts: Record<string, THREE.Object3D | THREE.Object3D[]>;
  update(t: number): void;
}

/** 吸い込み脚：貫く点（ドームの表面との交点）を求める */
function pierceHit(i: number): { hit: THREE.Vector3; s: number } {
  const F = SUCK_LEGS[i].from, P = SUCK_LEGS[i].pierce, d = DOMES[i];
  const inside = (s: number): boolean => {
    const x = F.x + (P.x - F.x) * s - d.x, y = F.y + (P.y - F.y) * s - d.baseY, z = F.z + (P.z - F.z) * s - d.z;
    return x * x + y * y + z * z < d.r * d.r;
  };
  let lo = 0.3, hi = 1;
  for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (inside(mid)) hi = mid; else lo = mid; }
  return { s: hi, hit: v3(F.x + (P.x - F.x) * hi, F.y + (P.y - F.y) * hi, F.z + (P.z - F.z) * hi) };
}

const _m4 = new THREE.Matrix4(), _pos = new THREE.Vector3(), _scl = new THREE.Vector3();

export function buildDevice(): DeviceParts {
  const root = new THREE.Group();
  root.name = 'drainDevice';
  const colliders: AABB[] = [];
  const parts: DeviceParts['parts'] = {};
  const jz = ROAD.junctionZ;
  const P = DEVICE_PLATFORM, D = DEVICE;

  // ---- 材質
  const steelT = steelTex();
  const steelMat = new THREE.MeshStandardMaterial({ vertexColors: true, ...(steelT ? { map: steelT } : {}), roughness: 0.5, metalness: 0.4, emissive: 0x1a2644 });
  const darkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.5, emissive: 0x141c34 });
  const concreteMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02 });
  const hz = hazardTex();
  const hazardMat = new THREE.MeshStandardMaterial({ vertexColors: true, ...(hz ? { map: hz } : {}), roughness: 0.7, metalness: 0, emissive: 0x201a08 });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true }); glowMat.color.setScalar(1.8);
  const glow = glowTex();

  // ================================================================ 台座（屋根の上の高さ 5m の台）
  {
    const pb = new Batch();
    pb.box((P.x0 + P.x1) / 2, (P.y0 + P.y1) / 2, jz, P.x1 - P.x0, P.y1 - P.y0, P.z1 - P.z0, 0xc9c9cf, { tu: 6 });
    const hb = new Batch();
    const zc = jz, w = P.z1 - P.z0;
    hb.box(P.x0 - 0.06, 52.5, zc, 0.12, 1.8, w, 0xffffff, { tu: 1.8 });                 // 前面の足元ハザード帯
    hb.box((P.x0 + P.x1) / 2, 55.03, P.z0 + 0.8, P.x1 - P.x0, 0.06, 1.4, 0xffffff, { tu: 1.4 });
    hb.box((P.x0 + P.x1) / 2, 55.03, P.z1 - 0.8, P.x1 - P.x0, 0.06, 1.4, 0xffffff, { tu: 1.4 });
    hb.box(P.x1 - 0.8, 55.03, zc, 1.4, 0.06, w, 0xffffff, { tu: 1.4 });
    const gb = new Batch();
    for (let x = P.x0 + 6; x < P.x1; x += 10) { gb.box(x, 55.1, P.z0 + 2.2, 1.2, 0.12, 0.3, CYAN, false); gb.box(x, 55.1, P.z1 - 2.2, 1.2, 0.12, 0.3, CYAN, false); }
    const plat = new THREE.Group(); plat.name = 'devicePlatform';
    for (const [b, m] of [[pb, concreteMat], [hb, hazardMat], [gb, glowMat]] as const) { const mesh = bm(b, m); if (mesh) plat.add(mesh); }
    root.add(plat);
    parts.platform = plat;
    colliders.push(col(P.x0, P.x1, P.y0, P.y1, P.z0, P.z1, 'drainPlatform'));
  }

  // ================================================================ 本体（下：入口の広間、上：大きな頭）
  const body = new THREE.Group(); body.name = 'deviceBody';
  root.add(body);
  parts.device = body;
  const hallX0 = D.x0, hallX1 = 1876, hallZ = 28, hallTop = 78, bodyTop = 95, capTop = D.topY;
  {
    const sb = new Batch(), db = new Batch(), gb = new Batch(), hb = new Batch();
    const T = { tu: 8, tv: 8 };
    sb.box((hallX0 + hallX1) / 2, (D.baseY + hallTop) / 2, jz, hallX1 - hallX0, hallTop - D.baseY, hallZ * 2, 0xffffff, T);
    const cx = (D.x0 + D.x1) / 2, cw = D.x1 - D.x0, cd = D.z1 - D.z0;
    sb.box(cx, (hallTop + bodyTop) / 2, jz, cw, bodyTop - hallTop, cd, 0xffffff, T);
    sb.box(cx, (bodyTop + capTop) / 2, jz, cw - 24, capTop - bodyTop, cd - 16, 0xffffff, T);
    // 下面の暗いスカート（広間の天井が本体の底に続く）
    db.box(cx, hallTop - 0.1, jz, cw + 0.6, 1.6, cd + 0.6, 0x1c2236, false);
    // 前面（西）の縦リブ（扉の脇）
    for (const s of [-1, 1]) for (let k = 0; k < 5; k++) {
      const z = jz + s * (11 + k * 3.7);
      db.box(hallX0 - 0.35, (D.baseY + hallTop) / 2, z, 0.7, hallTop - D.baseY, 0.9, 0x3a4560, false);
    }
    // 光のライン（前面・側面）
    gb.box(hallX0 - 0.1, 70.5, jz, 0.2, 0.5, hallZ * 2, CYAN, false);
    gb.box(D.x0 - 0.1, 88, jz, 0.2, 0.6, cd - 8, CYAN, false);
    gb.box(D.x0 - 0.1, 91.5, jz, 0.2, 0.35, cd - 8, YEL, false);
    for (const s of [-1, 1]) {
      gb.box(cx, 88, jz + s * (cd / 2 + 0.1), cw - 8, 0.6, 0.2, CYAN, false);
      gb.box(cx, 91.5, jz + s * (cd / 2 + 0.1), cw - 8, 0.35, 0.2, YEL, false);
    }
    // 前面の足元のハザード帯（頭の下縁）
    hb.box(D.x0 - 0.12, hallTop + 1.6, jz, 0.24, 2.4, cd, 0xffffff, { tu: 2.4 });
    // 頭の上の設備：冷却フィン・アンテナ
    for (let i = 0; i < 12; i++) db.box(1816 + i * 5, capTop + 2.5, jz + 18, 0.5, 5, 24, 0x3a4560, false);
    for (const [ax, az] of [[1798, jz - 26], [1798, jz + 26], [1886, jz - 26], [1886, jz + 26]] as const) db.cyl(ax, capTop + 7, az, 0.45, 14, 0x9aa4bc, 6, false);
    // 各吸い込み脚の取り付け部（脇の張り出し）
    for (let i = 0; i < SUCK_LEGS.length; i++) {
      const f = SUCK_LEGS[i].from, side = f.z < jz ? -1 : 1;
      sb.box(f.x, f.y, f.z + side * 3.5, 16, 12, 8, 0xffffff, T);
      db.box(f.x, f.y, f.z + side * 8, 12, 9, 1.0, 0x20283e, false);
      if (f.x > D.x1 - 6) sb.box(D.x1 - 3, f.y, f.z + side * 2, 10, 9, 7, 0xffffff, T);      // 本体の東端より外にあるので橋渡し
      { const tg = new THREE.TorusGeometry(4.3, 0.3, 8, 28); tg.translate(f.x, f.y, f.z + side * 8.6); gb.add(tg, CYAN, false); }
    }
    const parts3: [Batch, THREE.Material][] = [[sb, steelMat], [db, darkMat], [gb, glowMat], [hb, hazardMat]];
    for (const [b, m] of parts3) { const mesh = bm(b, m); if (mesh) body.add(mesh); }

    // 看板（扉の上）
    const sg = signTex('DRAIN DEVICE', 'red', 1024, 256);
    if (sg) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(20, 5), new THREE.MeshBasicMaterial({ map: sg, transparent: true, toneMapped: false }));
      sign.rotation.y = -Math.PI / 2; sign.position.set(hallX0 - 0.35, 71.5, jz);
      body.add(sign);
    }
    colliders.push(col(hallX0, hallX1, D.baseY, hallTop, jz - hallZ, jz + hallZ, 'drainHall'));
    colliders.push(col(D.x0, D.x1, hallTop, capTop, D.z0, D.z1, 'drainBody'));
  }

  // ================================================================ 立っている脚（4本）
  const standing: THREE.Object3D[] = [];
  for (const l of STANDING_LEGS) {
    const g = new THREE.Group(); g.name = 'standingLeg';
    const sb = new Batch(), gb = new Batch(), hb = new Batch();
    const out = l.z < jz ? -1 : 1;
    sb.box(l.x, l.baseY + 0.9, l.z, 12.5, 1.8, 12.5, 0x3a4560, false);                            // 足の板
    for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) sb.cyl(l.x + dx, l.baseY + 2.1, l.z + dz, 0.7, 0.8, 0x9aa4bc, 6, false);
    hb.box(l.x, l.baseY + 0.12, l.z + out * 6.35, 12.6, 0.24, 0.3, 0xffffff, { tu: 0.6 });
    sb.cyl(l.x, l.baseY + 6.8, l.z, l.radius + 0.4, 9.2, 0x59627c, 14, false);                    // 下脚
    sb.cyl(l.x, l.baseY + 3.0, l.z, l.radius + 1.3, 2.4, 0x3d4760, 14, false);                    // 付け根の太い部分
    sb.sphere(l.x, l.baseY + 12.5, l.z, l.radius + 1.7, 0x48526c, 16, 10, false);                  // 膝
    gb.cyl(l.x, l.baseY + 12.5, l.z, l.radius + 2.05, 0.8, CYAN, 18, false);
    sb.cyl(l.x, l.baseY + 19, l.z, l.radius + 0.8, 14, 0x59627c, 14, false);                      // 上脚（本体の底へ）
    sb.cyl(l.x, l.baseY + 21.5, l.z, l.radius + 1.6, 1.2, 0x3d4760, 14, false);
    // 油圧ピストン（外側）
    sb.cyl(l.x, l.baseY + 6, l.z + out * 6.1, 1.5, 9, 0x2c3550, 10, false);
    sb.cyl(l.x, l.baseY + 14, l.z + out * 6.1, 0.9, 12, 0xbcc6da, 8, false);
    gb.cyl(l.x, l.baseY + 10.6, l.z + out * 6.1, 1.65, 0.3, YEL, 12, false);
    for (const [b, m] of [[sb, darkMat], [gb, glowMat], [hb, hazardMat]] as const) { const mesh = bm(b, m); if (mesh) g.add(mesh); }
    root.add(g); standing.push(g);
    colliders.push(col(l.x - 5, l.x + 5, l.baseY, l.baseY + 24, l.z - 5, l.z + 5, 'drainLeg'));
  }
  parts.standingLegs = standing;

  // ================================================================ 入口の扉（西面）
  // 使い方（演出）：
  //   閉じた扉：parts.door（Group。原点＝扉の足元中央 (DRAIN_DOOR.x, DRAIN_DOOR.y, DRAIN_DOOR.z)。ローカル x＝東、-x が車の来る側、y＝上、z＝南）
  //     parts.doorPanels = [左(北)の扉板, 右(南)の扉板]（各 Group。原点は扉板の中心の足元。position.z を ±方向へ動かせば左右に開く）
  //   突き破った後：parts.door.visible=false; parts.doorBroken.visible=true（曲がった枠・飛んだ扉板2枚・開口の闇・火花。最初は非表示）
  //     parts.doorBrokenPanels = [扉板A, 扉板B]（doorBroken の子。飛ぶ演出をするなら位置を戻してから動かす。最終位置は踊り場の上）
  const doorLampMats: THREE.MeshBasicMaterial[] = [];
  const DW = DRAIN_DOOR.w, DH = DRAIN_DOOR.h;
  const door = new THREE.Group(); door.name = 'drainDoor';
  door.position.set(DRAIN_DOOR.x, DRAIN_DOOR.y, DRAIN_DOOR.z);
  const panelGeoParts = (): THREE.Group => {
    const g = new THREE.Group();
    const sb = new Batch(), gb = new Batch(), hb = new Batch();
    sb.box(0, DH / 2, 0, 0.9, DH, DW / 2 - 0.05, 0xffffff, { tu: 5, tv: 5 });
    hb.box(-0.47, 0.85, 0, 0.06, 1.7, DW / 2 - 0.3, 0xffffff, { tu: 1.7 });                   // 下側のハザード帯
    for (const y of [4.5, 5.2]) gb.box(-0.48, y, 0, 0.06, 0.22, DW / 2 - 0.9, 0xff3a2a, false);
    for (const y of [1.9, 6.4]) for (const z of [-2, 2]) sb.cyl(-0.5, y, z, 0.22, 0.12, 0x9aa4bc, 6, false, undefined, 0, 0, Math.PI / 2);
    for (const [b, m] of [[sb, steelMat], [hb, hazardMat], [gb, glowMat]] as const) { const mesh = bm(b, m); if (mesh) g.add(mesh); }
    return g;
  };
  const panelL = panelGeoParts(), panelR = panelGeoParts();
  panelL.name = 'doorPanelL'; panelR.name = 'doorPanelR';
  panelL.position.set(-0.25, 0, -DW / 4); panelR.position.set(-0.25, 0, DW / 4);
  const frameBatch = (b: Batch, tiltR = 0, tiltL = 0, lintelTilt = 0): void => {
    const xo = -0.7;
    b.box(xo, DH / 2 + 0.2, -(DW / 2 + 0.7), 1.5, DH + 0.4, 1.4, 0xffffff, { tu: 1.4 }, 0, tiltL);
    b.box(xo, DH / 2 + 0.2, DW / 2 + 0.7, 1.5, DH + 0.4, 1.4, 0xffffff, { tu: 1.4 }, 0, tiltR);
    b.box(xo, DH + 0.55, 0, 1.5, 1.3, DW + 2.8, 0xffffff, { tu: 1.4 }, 0, lintelTilt);
  };
  {
    const fb = new Batch(); frameBatch(fb);
    const fm = bm(fb, hazardMat); if (fm) door.add(fm);
    door.add(panelL, panelR);
    // 警告灯（枠の上の赤い回転灯）
    for (const s of [-1, 1]) {
      const m = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
      doorLampMats.push(m);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), m);
      lamp.position.set(-0.8, DH + 1.5, s * (DW / 2 - 0.5));
      door.add(lamp);
      const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.7, 0.6, 8), darkMat);
      cage.position.set(-0.8, DH + 1.15, s * (DW / 2 - 0.5)); door.add(cage);
    }
    // 開く直前の目印：扉板の合わせ目に赤い錠の光
    const lockB = new Batch();
    lockB.box(-0.72, 3.6, 0, 0.05, 1.6, 0.18, 0xff2a1a, false);
    const lk = bm(lockB, glowMat); if (lk) door.add(lk);
    root.add(door);
  }
  parts.door = door;
  parts.doorPanels = [panelL, panelR];

  const broken = new THREE.Group(); broken.name = 'drainDoorBroken';
  broken.position.copy(door.position);
  broken.visible = false;
  {
    const fb = new Batch(); frameBatch(fb, 0.35, -0.12, 0.11);
    const fm = bm(fb, hazardMat); if (fm) broken.add(fm);
    // 開口の闇と、ちぎれた縁の火の色
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(DW, DH), new THREE.MeshBasicMaterial({ color: 0x04060a }));
    hole.rotation.y = -Math.PI / 2; hole.position.set(-0.04, DH / 2, 0); broken.add(hole);
    const eb = new Batch();
    eb.box(-0.12, 0.1, 0, 0.12, 0.25, DW, 0xff8a2a, false);
    eb.box(-0.12, DH, 0, 0.12, 0.25, DW, 0xff8a2a, false);
    eb.box(-0.12, DH / 2, -DW / 2, 0.12, DH, 0.25, 0xff8a2a, false);
    eb.box(-0.12, DH / 2, DW / 2, 0.12, DH, 0.25, 0xff6a1a, false);
    for (let k = 0; k < 6; k++) eb.box(-0.15 - k * 0.1, 1 + k * 1.1, (k % 2 ? 1 : -1) * (DW / 2 - 0.5), 0.1, 0.5, 0.5, 0xffc060, false, k, k * 0.5);
    const em = bm(eb, glowMat); if (em) broken.add(em);
    // 飛んだ扉板（曲がっている：板＋折れた角）
    const flung = (x: number, y: number, z: number, rz: number, ry: number, rx: number): THREE.Group => {
      const g = new THREE.Group();
      const sb = new Batch(), gb = new Batch();
      sb.box(0, DH / 2, 0, 0.9, DH, DW / 2 - 0.05, 0xffffff, { tu: 5, tv: 5 });
      sb.box(-0.2, DH - 0.9, DW / 4 - 0.4, 0.9, 2.2, 2.2, 0xffffff, { tu: 5 }, 0, 0.6, 0.2);   // 折れ曲がった角
      gb.box(-0.48, 4.5, 0, 0.06, 0.22, 2.6, 0xff3a2a, false);
      for (const [b, m] of [[sb, steelMat], [gb, glowMat]] as const) { const mesh = bm(b, m); if (mesh) g.add(mesh); }
      g.position.set(x, y, z); g.rotation.set(rx, ry, rz);
      return g;
    };
    const A = flung(-10, 0.9, -7, 1.35, 0.45, 0.1);
    const B = flung(-23, 0.5, 6, 1.5, -0.8, -0.15);
    A.name = 'brokenPanelA'; B.name = 'brokenPanelB';
    broken.add(A, B);
    parts.doorBrokenPanels = [A, B];
    // 破片
    const dr = rng(808), db = new Batch();
    for (let k = 0; k < 16; k++) db.box(-3 - dr() * 22, 0.2 + dr() * 0.3, (dr() - 0.5) * 12, 0.3 + dr() * 0.9, 0.2 + dr() * 0.3, 0.3 + dr() * 0.9, k % 3 ? 0x59627c : 0xd9a416, false, dr() * 3, dr(), dr());
    const dm = bm(db, darkMat); if (dm) broken.add(dm);
  }
  root.add(broken);
  parts.doorBroken = broken;

  // ================================================================ 吸い込み脚（各ドームを貫く）とエネルギーの流れ
  const N_RING = 7, N_BLOB = 6, N_SPR = 5, N_SPARK = 14;
  const legs: THREE.Object3D[] = [];
  const pierceFx: THREE.Object3D[] = [];
  const nLeg = SUCK_LEGS.length;
  interface Leg { tip: THREE.Vector3; up: THREE.Vector3; q: THREE.Quaternion; len: number; yHit: number; hit: THREE.Vector3; n: THREE.Vector3; conduit: THREE.Texture | undefined; capA: THREE.Mesh; capB: THREE.Mesh }
  const L: Leg[] = [];
  const addMat = (color: number, extra: Partial<THREE.MeshBasicMaterialParameters> = {}) => new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, ...extra });
  const conduitBase = conduitTex();

  const ringGeo = new THREE.TorusGeometry(2.1, 0.2, 6, 24); ringGeo.rotateX(Math.PI / 2);
  const blobGeo = new THREE.SphereGeometry(1.0, 10, 8);
  const ringIM = new THREE.InstancedMesh(ringGeo, addMat(0xffffff), nLeg * N_RING);
  const blobIM = new THREE.InstancedMesh(blobGeo, addMat(0xffffff), nLeg * N_BLOB);
  ringIM.frustumCulled = false; blobIM.frustumCulled = false;
  const cc = new THREE.Color();
  for (let i = 0; i < nLeg * N_RING; i++) ringIM.setColorAt(i, cc.set(i % 2 ? YEL : CYAN).multiplyScalar(1.3));
  for (let i = 0; i < nLeg * N_BLOB; i++) blobIM.setColorAt(i, cc.set(i % 2 ? YEL : CYAN).multiplyScalar(1.5));
  root.add(ringIM, blobIM);

  const sprMatC = new THREE.SpriteMaterial({ ...(glow ? { map: glow } : {}), color: CYAN, opacity: 0.55, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const sprMatY = new THREE.SpriteMaterial({ ...(glow ? { map: glow } : {}), color: YEL, opacity: 0.55, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const sprites: THREE.Sprite[] = [];

  const crackT = crackTex();
  const steelLeg = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.55, emissive: 0x0c1226 });
  const rand = rng(51);

  const sparkPos = new Float32Array(nLeg * N_SPARK * 3);
  const sparkCol = new Float32Array(nLeg * N_SPARK * 3);
  const sparkVel = new Float32Array(nLeg * N_SPARK * 3);
  const sparkPh = new Float32Array(nLeg * N_SPARK);

  for (let i = 0; i < nLeg; i++) {
    const F = SUCK_LEGS[i].from, Pp = SUCK_LEGS[i].pierce, dome = DOMES[i];
    const tip = v3(Pp.x, Pp.y, Pp.z);
    const up = v3(F.x - Pp.x, F.y - Pp.y, F.z - Pp.z);
    const len = up.length(); up.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), up);
    const { hit } = pierceHit(i);
    const yHit = hit.distanceTo(tip);
    const n = v3(hit.x - dome.x, hit.y - dome.baseY, hit.z - dome.z).normalize();

    const g = new THREE.Group(); g.name = `suckLeg${i}`;
    g.position.copy(tip); g.quaternion.copy(q);
    const sb = new Batch(), gb = new Batch();
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; sb.cyl(Math.cos(a) * 2.35, len / 2, Math.sin(a) * 2.35, 0.36, len, 0x6b7592, 6, false); }
    const torusAt = (y: number, r: number, tube: number, b: Batch, color: number): void => {
      const tg = new THREE.TorusGeometry(r, tube, 8, 22); tg.rotateX(Math.PI / 2); tg.translate(0, y, 0); b.add(tg, color, false);
    };
    for (let y = yHit + 3; y < len - 2; y += 6.5) { torusAt(y, 2.35, 0.5, sb, 0x39435c); torusAt(y, 2.35, 0.14, gb, i % 2 ? YEL : CYAN); }
    sb.cyl(0, len - 0.9, 0, 3.4, 1.8, 0x39435c, 18, false);                                       // 根元のフランジ
    torusAt(len - 1.9, 3.45, 0.18, gb, CYAN);
    sb.cyl(0, 1.6, 0, 0.3, 3.2, 0x8892ab, 12, false, 2.3);                                         // 先端の尖り（ドームの中）
    torusAt(yHit, 2.95, 0.75, sb, 0x2e374e);                                                       // 貫いた所のフランジ
    torusAt(yHit + 0.2, 3.25, 0.2, gb, YEL);
    const sm = bm(sb, steelLeg), gm = bm(gb, glowMat);
    if (sm) g.add(sm);
    if (gm) g.add(gm);
    // 中を流れるエネルギーの筒
    let ct: THREE.Texture | undefined;
    if (conduitBase) { ct = conduitBase.clone(); ct.needsUpdate = true; ct.repeat.set(1, len / 10); ct.wrapS = ct.wrapT = THREE.RepeatWrapping; }
    const cmat = addMat(0xffffff, { opacity: 0.8, side: THREE.DoubleSide, ...(ct ? { map: ct } : { color: CYAN, opacity: 0.6 }) });
    const cond = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.65, len, 14, 1, true), cmat);
    cond.position.y = len / 2; cond.renderOrder = 3;
    g.add(cond);
    root.add(g); legs.push(g);

    // 貫いた点：ドームの球面に沿ったひび割れ＋光（2枚重ねて逆回し）
    const R = dome.r + 0.18, thMax = 0.62;
    const mkCap = (scale: number): THREE.BufferGeometry => {
      const cg = new THREE.SphereGeometry(R * 1.0 + scale * 0.12, 28, 10, 0, Math.PI * 2, 0, thMax * (1 + scale * 0.35));
      const pos = cg.getAttribute('position'), uv = cg.getAttribute('uv') as THREE.BufferAttribute;
      const rr = (R + scale * 0.12) * Math.sin(thMax * (1 + scale * 0.35));
      for (let k = 0; k < pos.count; k++) uv.setXY(k, 0.5 + (pos.getX(k) / rr) * 0.5, 0.5 - (pos.getZ(k) / rr) * 0.5);
      return cg;
    };
    const pivot = new THREE.Group(); pivot.name = `pierceFx${i}`;
    pivot.position.set(dome.x, dome.baseY, dome.z);
    pivot.quaternion.setFromUnitVectors(v3(0, 1, 0), n);
    const capMat = (c: number) => addMat(c, { ...(crackT ? { map: crackT } : { opacity: 0.5 }), side: THREE.DoubleSide });
    const capA = new THREE.Mesh(mkCap(0), capMat(0xffffff)), capB = new THREE.Mesh(mkCap(1), capMat(0xb8f4ff));
    capA.renderOrder = 4; capB.renderOrder = 5;
    pivot.add(capA, capB);
    root.add(pivot); pierceFx.push(pivot);
    // 貫通点の大きなにじみ（遠くからでも見える）
    const hs = new THREE.Sprite(sprMatC); hs.position.copy(hit).addScaledVector(n, 2.2); hs.scale.setScalar(22); hs.renderOrder = 6;
    const hs2 = new THREE.Sprite(sprMatY); hs2.position.copy(hit).addScaledVector(n, 3.2); hs2.scale.setScalar(12); hs2.renderOrder = 7;
    root.add(hs, hs2); sprites.push(hs, hs2);

    // 流れて行く光の玉（スプライト）
    for (let k = 0; k < N_SPR; k++) { const s = new THREE.Sprite(k % 2 ? sprMatY : sprMatC); s.renderOrder = 8; root.add(s); sprites.push(s); }

    // 火花
    for (let k = 0; k < N_SPARK; k++) {
      const idx = i * N_SPARK + k;
      const a = rand() * Math.PI * 2, sp = 5 + rand() * 11, lift = 0.4 + rand() * 0.9;
      // 法線方向と接線方向の混ぜ
      const t1 = v3(n.y, -n.x, 0).normalize();
      const t2 = new THREE.Vector3().crossVectors(n, t1);
      sparkVel[idx * 3] = (n.x * lift + (t1.x * Math.cos(a) + t2.x * Math.sin(a)) * 0.9) * sp;
      sparkVel[idx * 3 + 1] = (n.y * lift + (t1.y * Math.cos(a) + t2.y * Math.sin(a)) * 0.9) * sp;
      sparkVel[idx * 3 + 2] = (n.z * lift + (t1.z * Math.cos(a) + t2.z * Math.sin(a)) * 0.9) * sp;
      sparkPh[idx] = rand();
      cc.set(k % 3 === 0 ? 0xffffff : k % 2 ? YEL : CYAN);
      sparkCol[idx * 3] = cc.r; sparkCol[idx * 3 + 1] = cc.g; sparkCol[idx * 3 + 2] = cc.b;
    }
    L.push({ tip, up, q, len, yHit, hit, n, conduit: ct, capA, capB });
  }
  const sparkGeo = new THREE.BufferGeometry();
  const sparkAttr = new THREE.BufferAttribute(sparkPos, 3); sparkAttr.setUsage(THREE.DynamicDrawUsage);
  sparkGeo.setAttribute('position', sparkAttr);
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ size: 3.2, vertexColors: true, ...(glow ? { map: glow } : {}), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  sparks.frustumCulled = false; sparks.renderOrder = 9;
  root.add(sparks);
  parts.suckLegs = legs;
  parts.pierceFx = pierceFx;

  // ================================================================ 装置の核（頭の上の光る球・リング・光の柱）
  const coreY = capTop + 9, coreX = (D.x0 + D.x1) / 2;
  const core = new THREE.Group(); core.name = 'deviceCore';
  core.position.set(coreX, coreY, jz);
  const orbOuter = new THREE.Mesh(new THREE.SphereGeometry(7, 20, 14), addMat(CYAN, { opacity: 0.55 }));
  const orbInner = new THREE.Mesh(new THREE.SphereGeometry(4.2, 16, 12), addMat(0xfff2b0, { opacity: 0.95 }));
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(10, 0.5, 8, 40), addMat(CYAN, { opacity: 0.95 }));
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(12, 0.4, 8, 40), addMat(YEL, { opacity: 0.9 }));
  core.add(orbOuter, orbInner, ringA, ringB);
  const housing = new Batch();
  housing.cyl(coreX, capTop + 1.1, jz, 14, 2.2, 0x232b45, 28, false);
  housing.cyl(coreX, capTop + 2.4, jz, 11, 0.5, 0x39435c, 28, false);
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; housing.box(coreX + Math.cos(a) * 9, capTop + 4.5, jz + Math.sin(a) * 9, 0.9, 5, 0.9, 0x6b7592, false); }
  const hm = bm(housing, darkMat); if (hm) root.add(hm);
  root.add(core);
  const coreGlowC = new THREE.Sprite(sprMatC); coreGlowC.position.copy(core.position); coreGlowC.scale.setScalar(80); coreGlowC.renderOrder = 6;
  const coreGlowY = new THREE.Sprite(sprMatY); coreGlowY.position.copy(core.position); coreGlowY.scale.setScalar(36); coreGlowY.renderOrder = 7;
  root.add(coreGlowC, coreGlowY);
  const pt = pillarTex();
  const beamMat = addMat(CYAN, { ...(pt ? { map: pt } : { opacity: 0.2 }), opacity: 0.3, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 8, 700, 16, 1, true), beamMat);
  beam.position.set(coreX, coreY + 340, jz); beam.renderOrder = 2; beam.frustumCulled = false;
  const beam2 = new THREE.Mesh(new THREE.CylinderGeometry(2, 3.4, 700, 12, 1, true), addMat(YEL, { ...(pt ? { map: pt } : {}), opacity: 0.22, side: THREE.DoubleSide }));
  beam2.position.copy(beam.position); beam2.renderOrder = 2; beam2.frustumCulled = false;
  root.add(beam, beam2);
  parts.core = core;
  parts.beam = beam;

  // ================================================================ 毎フレーム
  const RING_SPEED = 13, BLOB_SPEED = 10;
  const q2 = new THREE.Quaternion();
  const fade = (p: number): number => Math.sqrt(Math.max(0, Math.sin(Math.PI * p)));
  const update = (t: number): void => {
    // 流れる光（ドーム → 装置）
    for (let i = 0; i < nLeg; i++) {
      const lg = L[i];
      const span = lg.len - lg.yHit;
      if (lg.conduit) lg.conduit.offset.y = -((t * 0.9 + i * 0.25) % 1);
      for (let k = 0; k < N_RING; k++) {
        const p = ((t * RING_SPEED) / span + k / N_RING + i * 0.13) % 1;
        const s = fade(p) * (0.95 + 0.15 * Math.sin(t * 8 + k));
        _pos.copy(lg.tip).addScaledVector(lg.up, lg.yHit + p * span);
        _scl.set(s, s, s);
        _m4.compose(_pos, lg.q, _scl);
        ringIM.setMatrixAt(i * N_RING + k, _m4);
      }
      for (let k = 0; k < N_BLOB; k++) {
        const p = ((t * BLOB_SPEED) / span + (k + 0.5) / N_BLOB + i * 0.21) % 1;
        const s = fade(p) * (0.75 + 0.25 * Math.sin(t * 11 + k * 2));
        _pos.copy(lg.tip).addScaledVector(lg.up, lg.yHit + p * span);
        _scl.set(s, s, s);
        q2.identity();
        _m4.compose(_pos, q2, _scl);
        blobIM.setMatrixAt(i * N_BLOB + k, _m4);
      }
      // スプライト（大きな光の玉）
      const base = i * (2 + N_SPR) + 2;
      for (let k = 0; k < N_SPR; k++) {
        const sp = sprites[base + k];
        const p = ((t * 9) / span + k / N_SPR + i * 0.17) % 1;
        sp.position.copy(lg.tip).addScaledVector(lg.up, lg.yHit + p * span);
        sp.scale.setScalar(3.5 + 4 * fade(p));
      }
      // 貫通点のひび割れの脈動
      const pulse = 0.65 + 0.35 * Math.sin(t * 5 + i * 1.7) + 0.2 * Math.sin(t * 13.3 + i);
      (lg.capA.material as THREE.MeshBasicMaterial).opacity = Math.min(1, pulse);
      (lg.capB.material as THREE.MeshBasicMaterial).opacity = Math.min(1, 0.5 * pulse + 0.2);
      lg.capB.rotation.y = -t * 0.4; lg.capA.rotation.y = t * 0.25;
      const hs = sprites[i * (2 + N_SPR)], hs2 = sprites[i * (2 + N_SPR) + 1];
      hs.scale.setScalar(20 + 6 * pulse); hs2.scale.setScalar(10 + 5 * Math.sin(t * 9 + i));
    }
    ringIM.instanceMatrix.needsUpdate = true;
    blobIM.instanceMatrix.needsUpdate = true;
    // 火花
    const DUR = 1.0, G = 16;
    for (let i = 0; i < nLeg; i++) {
      const h = L[i].hit, n = L[i].n;
      for (let k = 0; k < N_SPARK; k++) {
        const idx = i * N_SPARK + k;
        const u = (t * 1.3 + sparkPh[idx]) % 1, tt = u * DUR;
        sparkPos[idx * 3] = h.x + n.x * 0.5 + sparkVel[idx * 3] * tt;
        sparkPos[idx * 3 + 1] = h.y + n.y * 0.5 + sparkVel[idx * 3 + 1] * tt - 0.5 * G * tt * tt;
        sparkPos[idx * 3 + 2] = h.z + n.z * 0.5 + sparkVel[idx * 3 + 2] * tt;
      }
    }
    sparkAttr.needsUpdate = true;
    // 核
    const beat = 1 + 0.1 * Math.sin(t * 3.1) + 0.05 * Math.sin(t * 9.7);
    orbOuter.scale.setScalar(beat); orbInner.scale.setScalar(1 + 0.15 * Math.sin(t * 4.3 + 1));
    ringA.rotation.set(t * 0.9, t * 0.4, 0); ringB.rotation.set(Math.PI / 2 + t * 0.3, t * 1.1, 0);
    coreGlowC.scale.setScalar(70 + 12 * Math.sin(t * 3.1)); coreGlowY.scale.setScalar(32 + 8 * Math.sin(t * 4.3 + 1));
    beamMat.opacity = 0.26 + 0.08 * Math.sin(t * 2.3);
    glowMat.color.setScalar(1.6 + 0.4 * Math.sin(t * 3.1));
    // 扉の警告灯（交互に点滅）
    const blink = (Math.floor(t * 2.5) % 2);
    doorLampMats[0]?.color.setRGB(blink ? 2.2 : 0.25, blink ? 0.2 : 0.03, 0.1);
    doorLampMats[1]?.color.setRGB(blink ? 0.25 : 2.2, blink ? 0.03 : 0.2, 0.1);
  };
  return { root, colliders, parts, update };
}
