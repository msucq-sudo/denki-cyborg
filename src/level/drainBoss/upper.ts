// ドレイン装置の部屋の「穴の上」：ボスが落ちてきた元の場所（格納庫）と、そこから西へ続く搬出通路・歯車の保管庫。
// 見た目と当たり判定だけ（進行は ../drainBoss.ts）。間取りの数値は layout.ts の UPPER / HALL / STORE / RIM / SCAFFOLD。
//  ・穴（HOLE）の上は何もさえぎらない。ただし撃破までは「plug」（穴をふさぐ当たり）＋非常シャッターの見た目で閉じておく
//    （戦闘中にグラップルなどで上へ逃げられないように。シャッターは見えるので、見えない壁ではない）。
//  ・撃破後は plug を外し、穴の東に非常足場（SCAFFOLD）が現れる。足場からグラップルで穴のふちへ → 格納庫へ。
//  ・格納庫：ボスを吊っていたケージ（架台）が穴をまたぐ。ちぎれたケーブルが穴へ垂れ、床には引きずった爪あと。
//  ・搬出通路 70m の突き当たりが歯車の保管庫（歯車 40 個）。
import * as THREE from 'three';
import type { AABB } from '../../core/types';
import { createGearModel, type GearModel } from '../gear';
import { floorTex, hazardTex, panelTex } from '../floor1/visuals';
import { GEAR_POSITIONS, HALL, HOLE, RIM, SCAFFOLD, STORE, UPPER, v3 } from './layout';

export interface UpperGear { model: GearModel; x: number; y: number; z: number; taken: boolean }

export interface UpperRoom {
  root: THREE.Group;
  colliders: AABB[];
  lights: THREE.Light[];
  gears: UpperGear[];
  /** 穴をふさぐ当たり（撃破まで有効） */
  plug: AABB;
  /** 割れた天井の断面（穴のふち）の見た目と当たりを出す（天井が割れたあと） */
  setBroken(b: boolean): void;
  /** 非常シャッターを閉じた見た目にする（plug が有効な戦闘中）。false で開く */
  setShutter(closed: boolean): void;
  /** 撃破後：plug を外し、足場を出す */
  setOpen(open: boolean): void;
  readonly open: boolean;
  update(t: number, dt: number): void;
}

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tag: string): AABB =>
  ({ min: v3(x0, y0, z0), max: v3(x1, y1, z1), active: true, tag });

function rep(t: THREE.Texture | undefined, x: number, y: number): { map?: THREE.Texture } {
  if (!t) return {};
  const c = t.clone();
  c.needsUpdate = true;
  c.wrapS = c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(x, y);
  return { map: c };
}

export function buildUpperRoom(): UpperRoom {
  const root = new THREE.Group();
  root.name = 'drainBossUpper';
  const colliders: AABB[] = [];
  const lights: THREE.Light[] = [];
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root): THREE.Mesh => {
    const me = new THREE.Mesh(g, m); me.position.set(x, y, z); parent.add(me); return me;
  };
  /** 見た目の箱と当たりを一緒に置く（x0..x1, y0..y1, z0..z1） */
  const solid = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: THREE.Material, tag: string, parent: THREE.Object3D = root, list: AABB[] = colliders): AABB => {
    mesh(B(x1 - x0, y1 - y0, z1 - z0), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, parent);
    const c = box(x0, y0, z0, x1, y1, z1, tag);
    list.push(c);
    return c;
  };
  const plane = (w: number, h: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0): THREE.Mesh => {
    const m = mesh(new THREE.PlaneGeometry(w, h), mat, x, y, z);
    m.rotation.set(rx, ry, 0);
    return m;
  };

  const U = UPPER, Hh = HALL, S = STORE, FY = U.floorY;
  const floorMat = std({ ...rep(floorTex(), 30, 26), color: 0x4a4f58, roughness: 0.85, metalness: 0.4 });
  const wallMat = std({ ...rep(panelTex(), 26, 4), color: 0x434a56, roughness: 0.8, metalness: 0.45 });
  const roofMat = std({ ...rep(panelTex(), 26, 4), color: 0x2f353f, roughness: 0.85, metalness: 0.4 });
  const darkMat = std({ color: 0x16191f, roughness: 0.6, metalness: 0.65 });
  const steelMat = std({ color: 0x59616e, roughness: 0.55, metalness: 0.7 });
  const rustMat = std({ color: 0x6b4a32, roughness: 0.9, metalness: 0.35, flatShading: true });
  const concMat = std({ color: 0x4e535c, roughness: 0.95, metalness: 0.1, flatShading: true });
  const cableMat = std({ color: 0x0f1115, roughness: 0.5, metalness: 0.5 });
  const hazMat = std({ ...rep(hazardTex(), 6, 1), color: 0xbbbbbb, roughness: 0.6 });
  const glowAmber = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa840).multiplyScalar(1.4) });
  const glowCyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5ae0ff).multiplyScalar(1.3) });
  const glowRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4a30).multiplyScalar(1.4) });
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xcfe6ff).multiplyScalar(1.3) });
  const goldMat = std({ color: 0xb98a2a, roughness: 0.4, metalness: 0.8, emissive: 0x3a2600, emissiveIntensity: 0.5 });

  const H0 = HOLE.size / 2;
  const hx0 = HOLE.x - H0, hx1 = HOLE.x + H0, hz0 = HOLE.z - H0, hz1 = HOLE.z + H0;
  const CY = FY + U.h;               // 格納庫の天井の高さ
  const HY = FY + Hh.h;              // 搬出通路の天井
  const SY = FY + S.h;               // 保管庫の天井

  // ================================================================ 床（ボスの部屋の天井板の上面 = FY）
  // 当たり：穴のまわり 4 枚（厚み slabT。ボスの部屋の天井の見た目と同じ位置）+ 通路・保管庫の床
  const slabY0 = FY - U.slabT;
  colliders.push(box(U.x0, slabY0, U.z0, hx0, FY, U.z1, 'floor'));
  colliders.push(box(hx1, slabY0, U.z0, U.x1, FY, U.z1, 'floor'));
  colliders.push(box(hx0, slabY0, U.z0, hx1, FY, hz0, 'floor'));
  colliders.push(box(hx0, slabY0, hz1, hx1, FY, U.z1, 'floor'));
  colliders.push(box(Hh.x0, FY - 1, Hh.z0, U.x0, FY, Hh.z1, 'floor'));
  colliders.push(box(S.x0, FY - 1, S.z0, S.x1, FY, S.z1, 'floor'));
  // 見た目（穴のまわり 4 枚の床）
  const fl = (x0: number, x1: number, z0: number, z1: number) =>
    plane(x1 - x0, z1 - z0, floorMat, (x0 + x1) / 2, FY + 0.01, (z0 + z1) / 2, -Math.PI / 2);
  fl(U.x0, hx0, U.z0, U.z1); fl(hx1, U.x1, U.z0, U.z1); fl(hx0, hx1, U.z0, hz0); fl(hx0, hx1, hz1, U.z1);
  fl(Hh.x0, U.x0, Hh.z0, Hh.z1);
  fl(S.x0, S.x1, S.z0, S.z1);

  // ================================================================ 格納庫の壁・天井
  const uw = U.x1 - U.x0, ul = U.z1 - U.z0, ucz = (U.z0 + U.z1) / 2;
  plane(uw, U.h, wallMat, 0, FY + U.h / 2, U.z0, 0, 0);
  plane(uw, U.h, wallMat, 0, FY + U.h / 2, U.z1, 0, Math.PI);
  plane(ul, U.h, wallMat, U.x1, FY + U.h / 2, ucz, 0, -Math.PI / 2);
  // 西の壁は戸口（搬出通路）をあける
  plane(Hh.z0 - U.z0, U.h, wallMat, U.x0, FY + U.h / 2, (U.z0 + Hh.z0) / 2, 0, Math.PI / 2);
  plane(U.z1 - Hh.z1, U.h, wallMat, U.x0, FY + U.h / 2, (Hh.z1 + U.z1) / 2, 0, Math.PI / 2);
  plane(Hh.z1 - Hh.z0, U.h - Hh.h, wallMat, U.x0, FY + (U.h + Hh.h) / 2, (Hh.z0 + Hh.z1) / 2, 0, Math.PI / 2);
  plane(uw, ul, roofMat, 0, CY, ucz, Math.PI / 2, 0);
  const WT = 1, WTOP = CY + 1;
  colliders.push(box(U.x0 - WT, FY, U.z0 - WT, U.x1 + WT, WTOP, U.z0, 'wall'));
  colliders.push(box(U.x0 - WT, FY, U.z1, U.x1 + WT, WTOP, U.z1 + WT, 'wall'));
  colliders.push(box(U.x1, FY, U.z0, U.x1 + WT, WTOP, U.z1, 'wall'));
  colliders.push(box(U.x0 - WT, FY, U.z0, U.x0, WTOP, Hh.z0, 'wall'));
  colliders.push(box(U.x0 - WT, FY, Hh.z1, U.x0, WTOP, U.z1, 'wall'));
  colliders.push(box(U.x0 - WT, HY, Hh.z0, U.x0, WTOP, Hh.z1, 'wall'));
  colliders.push(box(U.x0 - WT, CY, U.z0, U.x1 + WT, CY + WT, U.z1, 'ceil'));
  // 戸口の枠と、床の誘導ライン（穴 → 西の戸口）
  solidFrame();
  function solidFrame(): void {
    mesh(B(0.8, 0.5, Hh.z1 - Hh.z0 + 1.2), hazMat, U.x0 + 0.4, HY - 0.25, (Hh.z0 + Hh.z1) / 2);
    for (const z of [Hh.z0 - 0.3, Hh.z1 + 0.3]) mesh(B(0.8, Hh.h, 0.6), darkMat, U.x0 + 0.4, FY + Hh.h / 2, z);
  }
  for (let x = hx0 - 3; x > U.x0 + 1; x -= 3) mesh(B(1.4, 0.04, 0.35), glowAmber, x, FY + 0.03, HOLE.z);

  // ================================================================ 格納庫の機械（戸口へ向かう帯 z=0..8 は空ける）
  const crate = (x: number, z: number, w: number, d: number, h: number) => solid(x - w / 2, FY, z - d / 2, x + w / 2, FY + h, z + d / 2, steelMat, 'crate');
  crate(-28, -24, 5, 4, 3);
  mesh(B(3, 2, 3), darkMat, -28, FY + 4, -24);
  crate(-18, -26, 4, 3, 2.4); crate(26, 24, 6, 4, 3); crate(30, 14, 3, 5, 2); crate(-26, 20, 5, 5, 2.6);
  // 分電盤・サーバーラック（北の壁際）：計器のライトがまたたく
  const lampsBlink: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const x = -14 + i * 4.6;
    solid(x - 1.2, FY, U.z0, x + 1.2, FY + 4.2, U.z0 + 1.6, darkMat, 'rack');
    for (let k = 0; k < 4; k++) {
      const l = mesh(B(0.3, 0.14, 0.05), k % 2 ? glowCyan : glowAmber, x - 0.7 + k * 0.45, FY + 3.4 - (i % 3) * 0.5, U.z0 + 1.64);
      lampsBlink.push(l);
    }
  }
  // 大きなコンデンサ（東の壁際）
  for (const z of [-20, -10, 0]) {
    const c = mesh(new THREE.CylinderGeometry(1.5, 1.5, 6, 14), steelMat, U.x1 - 3, FY + 3, z);
    mesh(new THREE.TorusGeometry(1.52, 0.14, 6, 18), glowCyan, U.x1 - 3, FY + 5.2, z).rotation.x = Math.PI / 2;
    colliders.push(box(c.position.x - 1.5, FY, z - 1.5, c.position.x + 1.5, FY + 6, z + 1.5, 'cap'));
  }
  // 天井のダクトと配管（ケージのレールにつながる）
  for (const z of [-22, -12, 20, 26]) mesh(B(uw - 2, 0.9, 0.9), darkMat, 0, CY - 0.6, z);
  for (const x of [-26, -14, 16, 28]) mesh(new THREE.CylinderGeometry(0.28, 0.28, U.h, 8), cableMat, x, FY + U.h / 2, U.z1 - 0.6);
  // 天井の照明（面）
  for (const x of [-26, -10, 12, 28]) for (const z of [-24, -6, 16, 26]) mesh(B(5, 0.1, 0.6), lampMat, x, CY - 0.08, z).castShadow = false;

  // ================================================================ ケージ（ボスを吊っていた架台）：穴をまたぐ
  const cageX = 8.4, cageZ0 = hz0 - 2.2, cageZ1 = hz1 + 2.2, cageTop = CY - 1.4;
  for (const sx of [-1, 1]) for (const z of [cageZ0, cageZ1]) {
    solid(sx * cageX - 0.45, FY, z - 0.45, sx * cageX + 0.45, cageTop, z + 0.45, steelMat, 'cage');
    mesh(B(1.3, 0.3, 1.3), hazMat, sx * cageX, FY + 0.15, z);
  }
  for (const z of [cageZ0, cageZ1]) mesh(B(cageX * 2 + 1, 0.7, 0.7), steelMat, 0, cageTop, z);
  for (const sx of [-1, 1]) mesh(B(0.7, 0.7, cageZ1 - cageZ0 + 1), steelMat, sx * cageX, cageTop, HOLE.z);
  // 吊りアーム（4 本。内側へ向いた爪）：東の 1 本は根元から折れて垂れ下がり、西の 1 本は爪がねじ曲がっている
  const arms: THREE.Group[] = [];
  for (const [ax, az] of [[-1, 0], [-1, 1], [1, 0], [1, 1]] as const) {
    const g = new THREE.Group();
    g.position.set(ax * (H0 + 0.5), cageTop - 0.35, az ? hz1 - 0.6 : hz0 + 0.6);
    mesh(B(0.5, 4.2, 0.5), steelMat, 0, -2.1, 0, g);
    const claw = mesh(B(2.0, 0.45, 0.55), darkMat, -ax * 0.9, -4.3, 0, g);
    claw.rotation.z = ax * 0.1;
    mesh(B(0.3, 0.3, 0.3), glowRed, -ax * 1.7, -4.3, 0, g);
    root.add(g);
    arms.push(g);
  }
  arms[2].rotation.z = -0.9;            // 折れて垂れた腕
  arms[2].position.y -= 0.3;
  arms[1].children[1].rotation.z += 0.6; // ねじ曲がった爪
  // 太いケーブル：ケージのビームから穴の中へ垂れ、先がちぎれて火花を散らす
  const cables: { pivot: THREE.Group; tip: THREE.Mesh; ph: number }[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    const len = 6 + (i % 4) * 3.2 + (i === 3 ? 4 : 0);
    const r = i % 3 === 0 ? 0.13 : 0.07;
    const pivot = new THREE.Group();
    pivot.position.set(HOLE.x + Math.cos(a) * 3.3, cageTop - 0.35, HOLE.z + Math.sin(a) * 3.3);
    mesh(new THREE.CylinderGeometry(r, r, len, 6), cableMat, 0, -len / 2, 0, pivot);
    const tip = mesh(new THREE.SphereGeometry(r * 1.8, 6, 4), i % 2 ? glowCyan : glowAmber, 0, -len, 0, pivot);
    root.add(pivot);
    cables.push({ pivot, tip, ph: i * 1.7 });
  }
  // 床の爪あと：ケージの下から引きずった跡・ボスの足が踏み砕いた跡
  const scratchMat = new THREE.MeshBasicMaterial({ color: 0x07080a, transparent: true, opacity: 0.85, depthWrite: false });
  const scratchHi = new THREE.MeshBasicMaterial({ color: 0x9aa4b4, transparent: true, opacity: 0.35, depthWrite: false });
  for (let i = 0; i < 7; i++) {
    const m = plane(0.18 + (i % 3) * 0.06, 6 + i * 1.1, scratchMat, hx1 + 1.5 + i * 0.5, FY + 0.02, hz1 + 4 + i * 0.5, -Math.PI / 2);
    m.rotation.z = 0.12 * (i - 3);
    const h = plane(0.05, 5 + i, scratchHi, hx1 + 1.6 + i * 0.5, FY + 0.025, hz1 + 4 + i * 0.5, -Math.PI / 2);
    h.rotation.z = 0.12 * (i - 3);
  }
  // 非常灯（赤くまわる）
  const beacon = new THREE.PointLight(0xff5a30, 40, 26, 1.8);
  beacon.position.set(0, cageTop - 1.2, HOLE.z);
  lights.push(beacon);
  const beaconLamp = mesh(new THREE.SphereGeometry(0.35, 8, 6), glowRed, 0, cageTop - 0.9, HOLE.z - 0.1);
  // 格納庫の灯り
  for (const [x, z, c, k] of [[-22, -18, 0x9fc8ff, 60], [22, -16, 0x9fc8ff, 60], [-22, 22, 0xffc88a, 50], [22, 22, 0xffc88a, 50], [-14, 4, 0xffa860, 40]] as const) {
    const pl = new THREE.PointLight(c, k, 44, 1.6);
    pl.position.set(x, CY - 2.5, z);
    lights.push(pl);
  }

  // ================================================================ 穴のふち（割れた天井の断面）：割れたあとに出る
  const rim = new THREE.Group();
  rim.visible = false;
  root.add(rim);
  const rimColliders: AABB[] = [];
  {
    const lipY1 = FY - U.slabT, lipY0 = lipY1 - RIM.drop;
    const lip = (x0: number, x1: number, z0: number, z1: number) => {
      solid(x0, lipY0, z0, x1, lipY1, z1, concMat, 'rim', rim, rimColliders);
    };
    lip(hx0 - RIM.w, hx0, hz0 - RIM.w, hz1 + RIM.w);
    lip(hx1, hx1 + RIM.w, hz0 - RIM.w, hz1 + RIM.w);
    lip(hx0, hx1, hz0 - RIM.w, hz0);
    lip(hx0, hx1, hz1, hz1 + RIM.w);
    // ぎざぎざの欠け・むき出しの鉄筋・床の端の破片
    let a = 4242;
    const r = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 34; i++) {
      const side = Math.floor(r() * 4);
      const t = r();
      const x = side < 2 ? (side ? hx1 : hx0) + (side ? 1 : -1) * (0.1 + r() * 0.8) : hx0 + t * HOLE.size;
      const z = side >= 2 ? (side === 3 ? hz1 : hz0) + (side === 3 ? 1 : -1) * (0.1 + r() * 0.8) : hz0 + t * HOLE.size;
      const s = 0.3 + r() * 0.7;
      const m = mesh(B(s, s * 0.5, s * 1.2), concMat, x, FY + s * 0.2, z, rim);
      m.rotation.set((r() - 0.5) * 0.8, r() * 3, (r() - 0.5) * 0.8);
    }
    for (let i = 0; i < 16; i++) {
      const t = i / 16;
      const onX = i % 2 === 0;
      const x = onX ? hx0 + t * HOLE.size : (i % 4 === 1 ? hx0 - 0.15 : hx1 + 0.15);
      const z = onX ? (i % 4 === 0 ? hz0 - 0.15 : hz1 + 0.15) : hz0 + t * HOLE.size;
      const bar = mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.3 + r() * 1.2, 5), rustMat, x, FY + 0.5, z, rim);
      bar.rotation.set((r() - 0.5) * 0.9, 0, (r() - 0.5) * 0.9);
    }
    // 穴のふちに黄黒の注意テープ（ちぎれた柵）
    for (const [x, z, w, d] of [[HOLE.x, hz0 - 0.9, 7, 0.25], [HOLE.x, hz1 + 0.9, 5, 0.25], [hx1 + 0.9, HOLE.z, 0.25, 6]] as const) mesh(B(w, 0.5, d), hazMat, x, FY + 0.25, z, rim);
  }
  // 割れた断面が見えるように、穴の内側の側面を暗くふちどる
  const rimShade = new THREE.MeshBasicMaterial({ color: 0x0a0b0e });
  for (const [x, z, w, d] of [[HOLE.x, hz0 - 0.02, HOLE.size, 0.04], [HOLE.x, hz1 + 0.02, HOLE.size, 0.04], [hx0 - 0.02, HOLE.z, 0.04, HOLE.size], [hx1 + 0.02, HOLE.z, 0.04, HOLE.size]] as const)
    mesh(B(w, 0.5, d), rimShade, x, FY - 0.25, z, rim);

  colliders.push(...rimColliders);

  // ================================================================ 撃破までのふた：plug（当たり）+ 非常シャッター（見た目）
  const plug = box(hx0, FY - U.slabT, hz0, hx1, FY, hz1, 'ceil');
  colliders.push(plug);
  const shutter = new THREE.Group();
  shutter.position.set(HOLE.x, FY - U.slabT / 2, HOLE.z);
  shutter.visible = false;
  root.add(shutter);
  const slatCount = 6, slatD = HOLE.size / slatCount;
  const slatMat = std({ color: 0x3a3f4a, roughness: 0.45, metalness: 0.85 });
  const slats: THREE.Mesh[] = [];
  for (let i = 0; i < slatCount; i++) {
    const s = mesh(B(HOLE.size + 0.2, U.slabT * 0.9, slatD - 0.06), slatMat, 0, 0, -H0 + slatD * (i + 0.5), shutter);
    mesh(B(HOLE.size + 0.22, 0.04, 0.12), glowAmber, 0, -U.slabT * 0.46, 0, s);
    slats.push(s);
  }
  mesh(B(HOLE.size + 0.2, 0.05, 0.5), hazMat, 0, -U.slabT * 0.47, -H0 + 0.25, shutter);
  mesh(B(HOLE.size + 0.2, 0.05, 0.5), hazMat, 0, -U.slabT * 0.47, H0 - 0.25, shutter);
  let shutterK = 0, shutterWant = 0;

  // ================================================================ 非常足場（撃破後。穴の東側から穴のふちへ登る）
  const scaffold = new THREE.Group();
  scaffold.visible = false;
  root.add(scaffold);
  const scaffoldColliders: AABB[] = [];
  const scMat = std({ color: 0x8a6a2a, roughness: 0.55, metalness: 0.7 });
  const lampPts: THREE.Vector3[] = [];
  for (const p of [SCAFFOLD.a, SCAFFOLD.b]) {
    solid(p.x0, p.top - 0.4, p.z0, p.x1, p.top, p.z1, scMat, 'scaffold', scaffold, scaffoldColliders);
    for (const x of [p.x0 + 0.2, p.x1 - 0.2]) for (const z of [p.z0 + 0.2, p.z1 - 0.2])
      solid(x - 0.2, 0, z - 0.2, x + 0.2, p.top - 0.4, z + 0.2, steelMat, 'scaffold', scaffold, scaffoldColliders);
    // 手すり
    for (const z of [p.z0 + 0.05, p.z1 - 0.05]) mesh(B(p.x1 - p.x0, 0.08, 0.08), hazMat, (p.x0 + p.x1) / 2, p.top + 1, z, scaffold);
    mesh(B(0.08, 0.08, p.z1 - p.z0), hazMat, (p.x0 + p.x1) / 2, p.top + 1, (p.z0 + p.z1) / 2, scaffold);
    mesh(B(p.x1 - p.x0, 0.12, 0.4), glowCyan, (p.x0 + p.x1) / 2, p.top + 0.02, (p.z0 + p.z1) / 2, scaffold);
    lampPts.push(v3((p.x0 + p.x1) / 2, p.top + 2.4, (p.z0 + p.z1) / 2));
  }
  for (const lp of lampPts) {
    const pl = new THREE.PointLight(0x7fe6ff, 14, 14, 2);
    pl.position.copy(lp);
    pl.visible = false;
    scaffold.add(pl);
    lights.push(pl);
  }
  colliders.push(...scaffoldColliders);
  let opened = false;

  // ================================================================ 搬出通路
  const hl = U.x0 - Hh.x0, hcx = (Hh.x0 + U.x0) / 2, hcz = (Hh.z0 + Hh.z1) / 2, hw = Hh.z1 - Hh.z0;
  plane(hl, hw, roofMat, hcx, HY, hcz, Math.PI / 2, 0);
  plane(hl, Hh.h, wallMat, hcx, FY + Hh.h / 2, Hh.z0, 0, 0);
  plane(hl, Hh.h, wallMat, hcx, FY + Hh.h / 2, Hh.z1, 0, Math.PI);
  colliders.push(box(Hh.x0, FY, Hh.z0 - 1, U.x0, HY + 1, Hh.z0, 'wall'));
  colliders.push(box(Hh.x0, FY, Hh.z1, U.x0, HY + 1, Hh.z1 + 1, 'wall'));
  colliders.push(box(Hh.x0, HY, Hh.z0, U.x0, HY + 1, Hh.z1, 'ceil'));
  // 搬送レール（ボスを運んだ跡）と枕木・壁の配管・足元灯・天井灯
  for (const z of [hcz - 0.9, hcz + 0.9]) mesh(B(hl, 0.12, 0.14), steelMat, hcx, FY + 0.1, z);
  for (let x = U.x0 - 1; x > Hh.x0 + 1; x -= 2.2) mesh(B(0.3, 0.07, hw * 0.55), darkMat, x, FY + 0.04, hcz);
  for (const z of [Hh.z0 + 0.3, Hh.z1 - 0.3]) {
    mesh(new THREE.CylinderGeometry(0.2, 0.2, hl, 8), cableMat, hcx, FY + 1.1, z).rotation.z = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.1, 0.1, hl, 6), cableMat, hcx, FY + 1.6, z).rotation.z = Math.PI / 2;
  }
  for (let x = U.x0 - 4; x > Hh.x0 + 2; x -= 6) {
    mesh(B(0.5, 0.1, 1.4), x % 12 < 6 ? glowAmber : glowCyan, x, FY + 0.03, hcz + (Math.round(x) % 2 ? 1.6 : -1.6));
    mesh(B(1.6, 0.1, 0.5), lampMat, x, HY - 0.08, hcz);
  }
  for (const x of [-48, -66, -84, -99]) {
    const pl = new THREE.PointLight(0xa8d0ff, 36, 22, 1.7);
    pl.position.set(x, HY - 0.9, hcz);
    lights.push(pl);
  }
  // 距離の目印（床の黄色い帯。奥ほど間隔が狭い）
  for (const x of [-40, -60, -80, -100]) mesh(B(0.5, 0.03, hw), hazMat, x, FY + 0.025, hcz);

  // ================================================================ 歯車の保管庫
  const sw = S.x1 - S.x0, sl = S.z1 - S.z0, scx = (S.x0 + S.x1) / 2, scz = (S.z0 + S.z1) / 2;
  plane(sw, sl, roofMat, scx, SY, scz, Math.PI / 2, 0);
  plane(sw, S.h, wallMat, scx, FY + S.h / 2, S.z0, 0, 0);
  plane(sw, S.h, wallMat, scx, FY + S.h / 2, S.z1, 0, Math.PI);
  plane(sl, S.h, wallMat, S.x0, FY + S.h / 2, scz, 0, Math.PI / 2);
  plane(Hh.z0 - S.z0, S.h, wallMat, S.x1, FY + S.h / 2, (S.z0 + Hh.z0) / 2, 0, -Math.PI / 2);
  plane(S.z1 - Hh.z1, S.h, wallMat, S.x1, FY + S.h / 2, (Hh.z1 + S.z1) / 2, 0, -Math.PI / 2);
  plane(Hh.z1 - Hh.z0, S.h - Hh.h, wallMat, S.x1, FY + (S.h + Hh.h) / 2, hcz, 0, -Math.PI / 2);
  colliders.push(box(S.x0 - 1, FY, S.z0 - 1, S.x1 + 1, SY + 1, S.z0, 'wall'));
  colliders.push(box(S.x0 - 1, FY, S.z1, S.x1 + 1, SY + 1, S.z1 + 1, 'wall'));
  colliders.push(box(S.x0 - 1, FY, S.z0, S.x0, SY + 1, S.z1, 'wall'));
  colliders.push(box(S.x1, FY, S.z0, S.x1 + 1, SY + 1, Hh.z0, 'wall'));
  colliders.push(box(S.x1, FY, Hh.z1, S.x1 + 1, SY + 1, S.z1, 'wall'));
  colliders.push(box(S.x1, HY, Hh.z0, S.x1 + 1, SY + 1, Hh.z1, 'wall'));
  colliders.push(box(S.x0, SY, S.z0, S.x1, SY + 1, S.z1, 'ceil'));
  // 奥の壁の大きな歯車の飾り・左右の棚（歯車の部品が並ぶ）
  const bigGear = new THREE.Group();
  bigGear.position.set(S.x0 + 0.5, FY + 5.2, scz);
  bigGear.rotation.y = Math.PI / 2;
  mesh(new THREE.TorusGeometry(3.4, 0.45, 8, 28), goldMat, 0, 0, 0, bigGear);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const tooth = mesh(B(0.7, 0.9, 0.5), goldMat, Math.cos(a) * 3.85, Math.sin(a) * 3.85, 0, bigGear);
    tooth.rotation.z = a;
  }
  for (let i = 0; i < 4; i++) mesh(B(6.4, 0.3, 0.3), goldMat, 0, 0, 0, bigGear).rotation.z = (i / 4) * Math.PI;
  mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.6, 12), goldMat, 0, 0, 0, bigGear).rotation.x = Math.PI / 2;
  root.add(bigGear);
  for (const sz of [S.z0 + 0.9, S.z1 - 0.9]) for (let x = S.x0 + 5; x < S.x1 - 4; x += 5) {
    solid(x - 1.6, FY, sz - 0.6, x + 1.6, FY + 3.2, sz + 0.6, darkMat, 'shelf');
    mesh(B(3.0, 0.1, 1.0), glowAmber, x, FY + 1.6, sz + (sz < scz ? 0.1 : -0.1)).castShadow = false;
    for (let k = 0; k < 3; k++) mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.22, 10), goldMat, x - 1 + k, FY + 3.3, sz).rotation.x = Math.PI / 2;
  }
  // 奥の台座（歯車 4 つを高く並べる）
  solid(S.x0 + 0.4, FY, -1.9, S.x0 + 2.2, FY + 2.2, 11.1, darkMat, 'pedestal');
  mesh(B(1.7, 0.08, 12.8), glowCyan, S.x0 + 1.3, FY + 2.24, 4.6);
  for (const [x, z, c, k] of [[S.x0 + 6, scz, 0xffd27a, 110], [S.x1 - 6, scz, 0xffe0a0, 80], [scx, S.z0 + 3, 0x9fd8ff, 40], [scx, S.z1 - 3, 0x9fd8ff, 40]] as const) {
    const pl = new THREE.PointLight(c, k, 34, 1.6);
    pl.position.set(x, SY - 1.6, z);
    lights.push(pl);
    mesh(B(3, 0.1, 0.7), lampMat, x, SY - 0.1, z);
  }
  // 床の保管マーク
  mesh(B(sw - 2, 0.03, 0.3), hazMat, scx, FY + 0.025, S.z0 + 1.2);
  mesh(B(sw - 2, 0.03, 0.3), hazMat, scx, FY + 0.025, S.z1 - 1.2);

  // ================================================================ 歯車
  const gears: UpperGear[] = GEAR_POSITIONS.map((p) => {
    const model = createGearModel();
    model.position.set(p.x, p.y, p.z);
    root.add(model);
    return { model, x: p.x, y: p.y, z: p.z, taken: false };
  });

  // ================================================================ 公開
  function setBroken(b: boolean): void {
    rim.visible = b;
    for (const c of rimColliders) c.active = b;
  }
  setBroken(false);
  function setOpen(o: boolean): void {
    opened = o;
    plug.active = !o;
    if (o) shutterWant = 0;
    scaffold.visible = o;
    for (const c of scaffoldColliders) c.active = o;
    for (const pl of lights) if (pl.parent === scaffold) pl.visible = o;
  }
  for (const c of scaffoldColliders) c.active = false;

  const api: UpperRoom = {
    root, colliders, lights, gears, plug,
    setBroken,
    setShutter(closed) { shutterWant = closed && !opened ? 1 : 0; if (!closed) { shutterK = 0; shutter.visible = false; } },
    setOpen,
    get open() { return opened; },
    update(t, dt) {
      // 非常シャッターが北から閉じる
      shutterK += Math.sign(shutterWant - shutterK) * Math.min(Math.abs(shutterWant - shutterK), dt * 1.5);
      shutter.visible = shutterK > 0.001;
      slats.forEach((s, i) => { s.visible = shutterK > (i + 0.2) / slatCount; });
      // ケーブルのゆれ・火花のちらつき・非常灯
      for (const c of cables) {
        c.pivot.rotation.z = Math.sin(t * 0.9 + c.ph) * 0.07;
        c.pivot.rotation.x = Math.cos(t * 0.7 + c.ph) * 0.06;
        c.tip.visible = Math.sin(t * 9 + c.ph * 3) > -0.3;
      }
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
      beacon.intensity = 14 + 40 * pulse;
      beaconLamp.scale.setScalar(0.8 + 0.5 * pulse);
      lampsBlink.forEach((l, i) => { l.visible = Math.sin(t * (2 + (i % 5)) + i * 1.3) > -0.55; });
      for (const g of gears) if (!g.taken) g.model.tick(t + g.x);
    },
  };
  return api;
}
