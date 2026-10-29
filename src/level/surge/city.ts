// サージ収容所への道の「街」：道路・歩道・見えない壁、道沿いの火星の未来都市（結合したメッシュ）、街灯・ガントリー・看板、遠くの山、火星の空。
// 道は全長 約1.7km。建物は 200m ごとのかたまり（チャンク）に結合して、見えない所は描かない。霧で遠くをかすませる。
import * as THREE from 'three';
import type { AABB } from '../../core/types';
import { Batch, rng } from './batch';
import { COMPOUND, ROAD } from './layout';
import { adTex, asphaltTex, facadeTex, glowTex, groundTex, sidewalkTex } from './textures';

export const FOG_COLOR = 0xc98a66;
/** 太陽の向き（原点から太陽へ）。東の低い所。西へ走る車の後ろから照らす */
export const SUN_DIR = new THREE.Vector3(0.86, 0.26, -0.12).normalize();
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const col = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tag: string): AABB => ({ min: v3(x0, y0, z0), max: v3(x1, y1, z1), active: true, tag });

/** 道路まわりの範囲（歩道の外縁まで） */
export const WALK = (() => {
  const half = ROAD.width / 2 + ROAD.sidewalk;      // 13
  const jz = ROAD.junctionZ;
  return {
    half,
    /** 東西の道（直線）の南北の外縁 */
    ewZ0: jz - half, ewZ1: jz + half,
    /** 南北の道（ガレージから T字路）の東西の外縁と、南端 */
    nsX0: -half, nsX1: half, nsZ1: -11,
    /** 東の端（柵の少し先）と西の端（壁） */
    eastX: ROAD.eastFenceX + 0.5, westX: COMPOUND.wallX,
  };
})();

export interface CityParts {
  root: THREE.Group;
  colliders: AABB[];
  /** カメラに追従させる空（位置だけカメラに合わせる） */
  sky: THREE.Group;
  stats: { buildings: number };
}

const TINTS = [0xf2f4f8, 0xdfe6f0, 0xc9d6e6, 0xe6d6c4, 0xd9b9a0, 0xb4c4d8, 0xf0e2d2, 0xc98c6a, 0xe8c8b0, 0xaebccc];
const GLOWS = [0x52e8ff, 0xff4ad0, 0xffb040, 0x7aff9a, 0x9a8cff, 0xff6a5a];

interface Chunk { office: Batch; glass: Batch; plain: Batch; glow: Batch }
interface Rect { x0: number; x1: number; z0: number; z1: number }

export function buildCity(seed = 77): CityParts {
  const root = new THREE.Group();
  root.name = 'surgeCity';
  const colliders: AABB[] = [];
  const rand = rng(seed);
  const R = (a: number, b: number): number => a + (b - a) * rand();
  const pick = <T,>(l: readonly T[]): T => l[Math.floor(rand() * l.length)];

  // ================================================================ 材質
  const asp = asphaltTex();
  const roadMat = new THREE.MeshStandardMaterial({ ...(asp.map ? { map: asp.map } : { color: 0x34363e }), ...(asp.emissive ? { emissiveMap: asp.emissive, emissive: 0xffffff, emissiveIntensity: 1.5 } : {}), roughness: 0.85, metalness: 0.1 });
  const swT = sidewalkTex();
  const walkMat = new THREE.MeshStandardMaterial({ vertexColors: true, ...(swT ? { map: swT } : {}), roughness: 0.9, metalness: 0.05 });
  const gT = groundTex();
  if (gT) gT.repeat.set(220, 110);
  const groundMat = new THREE.MeshStandardMaterial({ ...(gT ? { map: gT } : { color: 0x7d4a38 }), roughness: 1, metalness: 0, depthWrite: false });
  const fo = facadeTex('office'), fg = facadeTex('glass');
  const facMat = (t: { map?: THREE.Texture; emissive?: THREE.Texture }, rough: number, metal: number) => new THREE.MeshStandardMaterial({
    vertexColors: true, ...(t.map ? { map: t.map } : {}), ...(t.emissive ? { emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 1.6 } : {}), roughness: rough, metalness: metal,
  });
  const officeMat = facMat(fo, 0.7, 0.1);
  const glassMat = facMat(fg, 0.35, 0.35);
  const plainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  glowMat.color.setScalar(1.5);

  // ================================================================ 地面
  {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(7000, 3400), groundMat);
    g.rotation.x = -Math.PI / 2;
    g.position.set(-800, -0.6, -90);
    g.renderOrder = -10;
    root.add(g);
  }

  // ================================================================ 道路（アスファルト）
  const { ewZ0, ewZ1, eastX, westX } = WALK;
  const jz = ROAD.junctionZ, hw = ROAD.width / 2;
  const roadQuad = (xa: number, xb: number, za: number, zb: number, along: 'x' | 'z'): THREE.Mesh => {
    const g = new THREE.PlaneGeometry(xb - xa, zb - za);
    g.rotateX(-Math.PI / 2);
    g.translate((xa + xb) / 2, 0, (za + zb) / 2);
    const pos = g.getAttribute('position'), uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      if (along === 'x') uv.setXY(i, x / 8, (z - jz) / ROAD.width + 0.5);
      else uv.setXY(i, z / 8, x / ROAD.width + 0.5);
    }
    const m = new THREE.Mesh(g, roadMat);
    m.receiveShadow = true;
    return m;
  };
  root.add(roadQuad(westX, ROAD.eastFenceX + 0.5, jz - hw, jz + hw, 'x'));
  root.add(roadQuad(-hw, hw, jz + hw, WALK.nsZ1, 'z'));

  // ---- 歩道・縁石・縁のシアンの光
  const walk = new Batch(), glow = new Batch();
  const WH = 0.2; // 歩道の高さ
  // 地面（道路）と歩道（縁石の高さ 0.2m）の当たり判定
  colliders.push(col(westX, WALK.eastX + 1, -4, 0, ewZ0, WALK.nsZ1, 'floor'));
  const sidewalk = (xa: number, xb: number, za: number, zb: number): void => {
    colliders.push(col(xa, xb, -4, WH, za, zb, 'floor'));
    walk.box((xa + xb) / 2, WH / 2 - 0.1, (za + zb) / 2, xb - xa, WH + 0.2, zb - za, 0xd6d0cc, { tu: 3 });
  };
  sidewalk(westX, WALK.eastX, ewZ0, jz - hw);                 // 東西の道の北側
  sidewalk(westX, -hw, jz + hw, ewZ1);                        // 南側（西）
  sidewalk(hw, WALK.eastX, jz + hw, ewZ1);                    // 南側（東）
  sidewalk(-WALK.half, -hw, ewZ1, WALK.nsZ1);                 // 南北の道の西
  sidewalk(hw, WALK.half, ewZ1, WALK.nsZ1);                   // 東
  {
    // 縁のシアンの光（歩道の縁石の上）
    const L = WALK.eastX - westX;
    glow.box((westX + WALK.eastX) / 2, WH + 0.005, jz - hw - 0.12, L, 0.02, 0.12, 0x52e8ff, false);
    glow.box((westX + -hw) / 2, WH + 0.005, jz + hw + 0.12, -hw - westX, 0.02, 0.12, 0x52e8ff, false);
    glow.box((hw + WALK.eastX) / 2, WH + 0.005, jz + hw + 0.12, WALK.eastX - hw, 0.02, 0.12, 0x52e8ff, false);
    const nl = WALK.nsZ1 - (jz + hw);
    for (const sx of [-1, 1]) glow.box(sx * (hw + 0.12), WH + 0.005, (jz + hw + WALK.nsZ1) / 2, 0.12, 0.02, nl, 0x52e8ff, false);
  }

  // ================================================================ 見えない壁（歩道の外縁）と天井
  {
    const T = 1, top = 45;
    const wall = (x0: number, x1: number, z0: number, z1: number, tag: string) => colliders.push(col(x0, x1, -4, top, z0, z1, tag));
    wall(-WALK.half - T, -WALK.half, ewZ1, WALK.nsZ1 + 0.5, 'roadWall');          // 南北の道の西
    wall(WALK.half, WALK.half + T, ewZ1, WALK.nsZ1 + 0.5, 'roadWall');             // 東
    wall(westX, -WALK.half, ewZ1, ewZ1 + T, 'roadWall');                           // 東西の道の南（西側）
    wall(WALK.half, WALK.eastX + T, ewZ1, ewZ1 + T, 'roadWall');                   // 南（東側）
    wall(westX, WALK.eastX + T, ewZ0 - T, ewZ0, 'roadWall');                       // 北
    wall(WALK.eastX, WALK.eastX + T, ewZ0, ewZ1 + T, 'roadWall');                  // 東の端
    colliders.push(col(westX, WALK.eastX + T, top, top + 2, ewZ0 - T, WALK.nsZ1 + 0.5, 'roadLid'));
  }

  // ================================================================ 街（建物）
  const chunks = new Map<number, Chunk>();
  const chunkAt = (x: number): Chunk => {
    const k = Math.floor((x + 1750) / 220);
    let c = chunks.get(k);
    if (!c) chunks.set(k, (c = { office: new Batch(), glass: new Batch(), plain: new Batch(), glow: new Batch() }));
    return c;
  };
  const placed: Rect[] = [];
  const hit = (r: Rect, m: number): boolean => placed.some((p) => r.x0 < p.x1 + m && r.x1 > p.x0 - m && r.z0 < p.z1 + m && r.z1 > p.z0 - m);
  // 立ち入れない所（道路・研究所・ガントリー）を先に登録
  placed.push({ x0: westX - 2, x1: WALK.eastX + 2, z0: ewZ0 - 1.5, z1: ewZ1 + 1.5 });
  placed.push({ x0: -WALK.half - 1.5, x1: WALK.half + 1.5, z0: ewZ1, z1: WALK.nsZ1 });
  placed.push({ x0: -45, x1: 45, z0: -12, z1: 52 });                      // 研究所
  let buildingCount = 0;
  const ads: Batch[] = [0, 1, 2, 3, 4, 5].map(() => new Batch());

  /** 建物1棟：屋根の飾り・ネオン・パイプ・広告までつける */
  const building = (r: Rect, h: number, face: [number, number], row: number): void => {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, w = r.x1 - r.x0, d = r.z1 - r.z0;
    const ch = chunkAt(cx);
    const glassy = rand() < (h > 60 ? 0.55 : 0.3);
    const bt = glassy ? ch.glass : ch.office;
    const tint = glassy ? pick([0xdfe8f6, 0xb8cde8, 0xc8d8ee, 0xe8dcec]) : pick(TINTS);
    const uv = { tu: 24, tv: 28.8, ou: rand(), ov: rand(), roof: [0.012, 0.012] as [number, number] };
    let rcx = cx, rcz = cz, rw = w, rd = d, topY = h;
    if (h > 42 && rand() < 0.55) {
      const ph = Math.max(10, h * R(0.15, 0.3));
      bt.box(cx, ph / 2, cz, w, ph, d, tint, uv);
      const ins = R(0.12, 0.3);
      rw = w * (1 - ins); rd = d * (1 - ins);
      rcx = cx - face[0] * (w - rw) * 0.35; rcz = cz - face[1] * (d - rd) * 0.35;   // 道と反対側へ寄せる
      bt.box(rcx, ph + (h - ph) / 2, rcz, rw, h - ph, rd, pick(TINTS), { ...uv, ou: rand(), ov: rand() });
      // 屋根の縁（ひさし）に光
      ch.glow.box(cx, ph + 0.15, cz, w + 0.3, 0.3, d + 0.3, pick(GLOWS), false);
    } else {
      bt.box(cx, h / 2, cz, w, h, d, tint, uv);
    }
    buildingCount++;
    // 屋根の飾り
    const roofType = rand();
    if (roofType < 0.3) {          // 給水タンク
      for (let i = 0; i < 1 + Math.floor(rand() * 2); i++) {
        const tx = rcx + R(-rw / 3, rw / 3), tz = rcz + R(-rd / 3, rd / 3), tr = R(1.6, 3.2);
        ch.plain.cyl(tx, topY + 2.2, tz, tr, 4.4, 0xa9b1bd, 10, false);
        ch.plain.cyl(tx, topY + 4.6, tz, tr * 0.2, 0.5, 0x6d7683, 6, false, tr);
        for (const lx of [-1, 1]) for (const lz of [-1, 1]) ch.plain.box(tx + lx * tr * 0.6, topY + 0.6, tz + lz * tr * 0.6, 0.25, 1.2, 0.25, 0x44505e, false);
      }
    } else if (roofType < 0.6) {   // アンテナ
      const ah = R(8, 30) * (h > 60 ? 1.8 : 1);
      const ax = rcx + R(-rw / 3, rw / 3), az = rcz + R(-rd / 3, rd / 3);
      ch.plain.cyl(ax, topY + ah / 2, az, 0.18, ah, 0x9ca6b4, 5, false, 0.07);
      ch.glow.box(ax, topY + ah + 0.3, az, 0.5, 0.5, 0.5, 0xff3a2a, false);
      if (rand() < 0.5) ch.plain.box(ax, topY + ah * 0.6, az, 3.2, 0.12, 0.12, 0x9ca6b4, false);
    } else if (roofType < 0.78) {  // 空調の箱とヘリポート
      for (let i = 0; i < 3; i++) ch.plain.box(rcx + R(-rw / 3, rw / 3), topY + 1.1, rcz + R(-rd / 3, rd / 3), R(2, 5), 2.2, R(2, 5), 0x8c97a6, false);
      if (rand() < 0.3 && Math.min(rw, rd) > 14) {
        ch.plain.cyl(rcx, topY + 0.15, rcz, Math.min(rw, rd) * 0.36, 0.3, 0x3a4252, 20, false);
        ch.glow.cyl(rcx, topY + 0.34, rcz, Math.min(rw, rd) * 0.3, 0.04, 0xffc21a, 20, false);
      }
    } else if (roofType < 0.88 && Math.min(rw, rd) > 12) {  // 小さなドーム
      const dr = Math.min(rw, rd) * 0.28;
      ch.plain.sphere(rcx, topY, rcz, dr, 0xe4eaf2, 14, 8, false, Math.PI / 2);
      ch.glow.cyl(rcx, topY + 0.1, rcz, dr * 1.01, 0.18, 0x52e8ff, 14, false);
    }
    // 屋根の縁の光の帯
    if (h > 30 && rand() < 0.45) {
      const gc = pick(GLOWS);
      for (const [sx, sz, bw, bd] of [[0, -1, rw, 0.25], [0, 1, rw, 0.25], [-1, 0, 0.25, rd], [1, 0, 0.25, rd]] as const) {
        ch.glow.box(rcx + sx * (rw / 2 + 0.05), topY + 0.12, rcz + sz * (rd / 2 + 0.05), sx ? bw : bw + 0.3, 0.24, sz ? bd : bd + 0.3, gc, false);
      }
    }
    // 道に面した側：ネオン看板・パイプ・店先の光の帯
    const fx = face[0], fz = face[1];
    const fcx = cx + fx * (w / 2), fcz = cz + fz * (d / 2);
    const along = fz !== 0 ? w : d;
    if (row === 1) {
      if (rand() < 0.65) {
        const sh = R(3, 7), sw = R(1.2, 2.2), sy = R(7, Math.min(24, h - 4));
        const gc = pick(GLOWS);
        const off = R(-along / 2 + 3, along / 2 - 3);
        const px = fcx + fx * 0.5 + (fz !== 0 ? off : 0), pz = fcz + fz * 0.5 + (fx !== 0 ? off : 0);
        ch.glow.box(px, sy, pz, fz !== 0 ? sw : 0.5, sh, fx !== 0 ? sw : 0.5, gc, false);
        ch.plain.box(px - fx * 0.15, sy, pz - fz * 0.15, fz !== 0 ? sw + 0.3 : 0.3, sh + 0.3, fx !== 0 ? sw + 0.3 : 0.3, 0x2a3140, false);
      }
      if (rand() < 0.5) {
        const gc = pick(GLOWS);
        ch.glow.box(fcx + fx * 0.06, 4.4, fcz + fz * 0.06, fz !== 0 ? along : 0.12, 0.14, fx !== 0 ? along : 0.12, gc, false);
        ch.plain.box(fcx + fx * 0.5, 3.6, fcz + fz * 0.5, fz !== 0 ? along : 1.0, 0.2, fx !== 0 ? along : 1.0, 0x586272, false); // 庇
      }
      if (rand() < 0.3) {
        const px = fcx + fx * 0.45 + (fz !== 0 ? w / 2 - 0.6 : 0), pz = fcz + fz * 0.45 + (fx !== 0 ? d / 2 - 0.6 : 0);
        const ph = h * R(0.5, 0.9);
        ch.plain.cyl(px, ph / 2, pz, 0.32, ph, 0x7b8594, 7, false);
        for (let y = 6; y < ph; y += 9) ch.plain.cyl(px, y, pz, 0.45, 0.35, 0x4a5362, 7, false);
      }
      if (rand() < 0.22 && h > 22) {   // 壁面の大きな広告
        const ai = Math.floor(rand() * 6);
        const aw = R(7, 12), ay = R(10, Math.min(h - 6, 30));
        const off = R(-along / 2 + aw / 2 + 1, along / 2 - aw / 2 - 1);
        const ry = fz > 0 ? 0 : fz < 0 ? Math.PI : fx > 0 ? Math.PI / 2 : -Math.PI / 2;
        ads[ai].quad(fcx + fx * 0.12 + (fz !== 0 ? off : 0), ay, fcz + fz * 0.12 + (fx !== 0 ? off : 0), aw, aw / 2, 0xffffff, ry, false);
      }
    }
  };

  /** 東西の道に沿った並び（西へ進みながら置く）。side=+1 は南側（z が増える）、-1 は北側 */
  const rowX = (o: { from: number; to: number; edge: number; side: 1 | -1; d: [number, number]; w: [number, number]; h: [number, number]; gap: [number, number]; row: number }): void => {
    let x = o.from;
    while (x > o.to) {
      const w = R(...o.w), d = R(...o.d);
      const xa = x - w;
      if (xa < o.to) break;
      const r: Rect = o.side > 0 ? { x0: xa, x1: x, z0: o.edge, z1: o.edge + d } : { x0: xa, x1: x, z0: o.edge - d, z1: o.edge };
      if (!hit(r, 2)) {
        const mod = 0.75 + 0.45 * Math.sin(x / 210) + 0.25 * Math.sin(x / 83 + 1);
        const h = (o.h[0] + (o.h[1] - o.h[0]) * Math.pow(rand(), 1.7)) * Math.max(0.5, mod);
        placed.push(r);
        building(r, h, [0, -o.side], o.row);
        x = xa - (rand() < 0.12 ? R(8, 16) : R(...o.gap));
      } else x -= 6;
    }
  };
  /** 南北の道に沿った並び（北へ進みながら置く）。side=+1 は東側、-1 は西側 */
  const rowZ = (o: { from: number; to: number; edge: number; side: 1 | -1; d: [number, number]; w: [number, number]; h: [number, number]; gap: [number, number]; row: number }): void => {
    let z = o.from;
    while (z > o.to) {
      const w = R(...o.w), d = R(...o.d);
      const za = z - w;
      if (za < o.to) break;
      const r: Rect = o.side > 0 ? { x0: o.edge, x1: o.edge + d, z0: za, z1: z } : { x0: o.edge - d, x1: o.edge, z0: za, z1: z };
      if (!hit(r, 2)) {
        const h = o.h[0] + (o.h[1] - o.h[0]) * Math.pow(rand(), 1.6);
        placed.push(r);
        building(r, h, [-o.side, 0], o.row);
        z = za - R(...o.gap);
      } else z -= 5;
    }
  };

  // ガントリー（道をまたぐ門）の柱の位置を先に確保する
  const gantryX: number[] = [];
  for (let x = -150; x > COMPOUND.fenceX + 120; x -= 170) gantryX.push(x);
  for (const gx of gantryX) {
    placed.push({ x0: gx - 4, x1: gx + 4, z0: ewZ0 - 8, z1: ewZ0 + 0.5 });
    placed.push({ x0: gx - 4, x1: gx + 4, z0: ewZ1 - 0.5, z1: ewZ1 + 8 });
  }
  // 南北の道（ガレージ前から T字路）
  for (const side of [-1, 1] as const) {
    rowZ({ from: WALK.nsZ1 - 2, to: ewZ1 + 1, edge: side * (WALK.half + 1.5), side, d: [14, 30], w: [14, 26], h: [16, 58], gap: [0, 3], row: 1 });
  }
  // 東西の道：手前の並び（1列目）、奥（2列目）、遠景（3列目）
  const farX = COMPOUND.fenceX + 30;
  for (const side of [-1, 1] as const) {
    const edge = side < 0 ? ewZ0 - 1.5 : ewZ1 + 1.5;
    rowX({ from: WALK.eastX + 70, to: farX, edge, side, d: [14, 30], w: [14, 34], h: [14, 62], gap: [0, 3], row: 1 });
  }
  for (const side of [-1, 1] as const) {
    const edge = side < 0 ? ewZ0 - 40 : ewZ1 + 40;
    rowX({ from: WALK.eastX + 80, to: farX, edge, side, d: [26, 52], w: [20, 46], h: [50, 150], gap: [2, 10], row: 2 });
  }
  for (const side of [-1, 1] as const) {
    const edge = side < 0 ? ewZ0 - 110 : ewZ1 + 110;
    rowX({ from: WALK.eastX + 120, to: farX - 40, edge, side, d: [40, 90], w: [30, 70], h: [90, 250], gap: [6, 30], row: 3 });
  }
  // 東のはて（柵の向こう）
  rowZ({ from: ewZ1 + 4, to: ewZ0 - 4, edge: WALK.eastX + 3, side: 1, d: [30, 60], w: [24, 40], h: [30, 90], gap: [0, 6], row: 1 });

  // ---- 目印：大きなドームとタワー（道から離れた所に点在）
  const landmarks = new Batch(), lmGlow = new Batch();
  for (let x = -70; x > farX; x -= R(150, 250)) {
    const side = rand() < 0.5 ? -1 : 1;
    const z = jz + side * R(110, 190);
    const kind = rand();
    const rect: Rect = { x0: x - 40, x1: x + 40, z0: z - 40, z1: z + 40 };
    if (hit(rect, 0)) continue;
    placed.push(rect);
    if (kind < 0.5) {      // ドーム
      const r = R(26, 42);
      landmarks.cyl(x, 6, z, r * 1.08, 12, 0xcfd6e0, 28, false);
      landmarks.sphere(x, 12, z, r, 0xf0f3f8, 28, 12, false, Math.PI / 2);
      lmGlow.cyl(x, 12.2, z, r * 1.01, 0.8, 0x52e8ff, 28, false);
      lmGlow.cyl(x, 12 + r * 0.5, z, r * 0.88, 0.5, 0xffb040, 28, false);
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        landmarks.box(x + Math.cos(ang) * r * 0.97, 6, z + Math.sin(ang) * r * 0.97, 3, 12, 3, 0x98a3b2, false);
      }
    } else {               // タワー
      const th = R(150, 260), tr = R(7, 11);
      landmarks.cyl(x, th / 2, z, tr * 0.4, th, 0xdce2ea, 14, false, tr);
      for (let y = 22; y < th - 10; y += 26) {
        lmGlow.cyl(x, y, z, tr * (1 - (y / th) * 0.6) + 0.5, 0.6, pick(GLOWS), 14, false);
        landmarks.cyl(x, y - 4, z, tr * (1 - (y / th) * 0.6) + 1.4, 1.2, 0x5b6676, 14, false);
      }
      landmarks.cyl(x, th + 14, z, 0.4, 28, 0xaab4c2, 6, false, 0.1);
      lmGlow.box(x, th + 28, z, 1.2, 1.2, 1.2, 0xff3a2a, false);
      landmarks.sphere(x, th - 4, z, tr * 1.3, 0xe4eaf2, 14, 8, false);
    }
  }

  // ================================================================ 街灯・ガントリー・ベンチなど（道沿いの小物）
  const furn = new Batch(), furnGlow = new Batch();
  const lamp = (x: number, z: number, dirZ: number): void => {
    furn.cyl(x, 4.5, z, 0.12, 9, 0x6e7a8a, 6, false);
    furn.box(x, 9.0, z + dirZ * 1.2, 0.14, 0.14, 2.6, 0x6e7a8a, false);
    furnGlow.box(x, 8.9, z + dirZ * 2.4, 0.5, 0.12, 1.1, 0xfff0d0, false);
    furnGlow.box(x, 0.4, z, 0.14, 0.5, 0.14, 0x52e8ff, false); // 足元の光
  };
  for (let x = 4; x > westX + 10; x -= 38) {
    lamp(x, ewZ0 + 0.9, 1);
    lamp(x - 19, ewZ1 - 0.9, -1);
  }
  for (let z = WALK.nsZ1 - 8; z > ewZ1 + 10; z -= 32) {
    furn.cyl(-WALK.half + 0.9, 4.5, z, 0.12, 9, 0x6e7a8a, 6, false);
    furn.box(-WALK.half + 2.2, 9.0, z, 2.6, 0.14, 0.14, 0x6e7a8a, false);
    furnGlow.box(-WALK.half + 3.4, 8.9, z, 1.1, 0.12, 0.5, 0xfff0d0, false);
    furn.cyl(WALK.half - 0.9, 4.5, z - 16, 0.12, 9, 0x6e7a8a, 6, false);
    furn.box(WALK.half - 2.2, 9.0, z - 16, 2.6, 0.14, 0.14, 0x6e7a8a, false);
    furnGlow.box(WALK.half - 3.4, 8.9, z - 16, 1.1, 0.12, 0.5, 0xfff0d0, false);
  }
  // ガントリー（道をまたぐ門＋光の看板）
  const banners: { x: number; ad: number }[] = [];
  gantryX.forEach((gx, i) => {
    const pz0 = ewZ0 - 4, pz1 = ewZ1 + 4;
    for (const pz of [pz0, pz1]) {
      furn.box(gx, 8.5, pz, 1.6, 17, 1.6, 0x56606f, false);
      furn.box(gx, 0.4, pz, 2.4, 0.8, 2.4, 0x3a4250, false);
      furnGlow.box(gx + 0.82, 8, pz, 0.06, 12, 0.3, 0x52e8ff, false);
    }
    furn.box(gx, 16.3, (pz0 + pz1) / 2, 1.4, 1.4, pz1 - pz0 + 1.6, 0x56606f, false);
    furn.box(gx, 14.9, (pz0 + pz1) / 2, 0.3, 0.2, pz1 - pz0, 0x8a94a4, false);
    furnGlow.box(gx + 0.72, 16.3, (pz0 + pz1) / 2, 0.06, 0.2, pz1 - pz0 + 1.6, i % 2 ? 0xff4ad0 : 0x52e8ff, false);
    banners.push({ x: gx, ad: i % 6 });
    for (let k = 0; k < 4; k++) furnGlow.box(gx + 0.1, 14.7, jz - 10.5 + k * 7, 1.2, 0.1, 0.6, 0xdff4ff, false);
  });
  for (const b of banners) {
    ads[b.ad].quad(b.x + 0.9, 12.2, jz, 14, 3.4, 0xffffff, Math.PI / 2, false);
    furn.cyl(b.x + 0.6, 14.1, jz - 6.5, 0.04, 1.2, 0x8a94a4, 4, false);
    furn.cyl(b.x + 0.6, 14.1, jz + 6.5, 0.04, 1.2, 0x8a94a4, 4, false);
  }
  // 車線の上のホログラム矢印（遠くまで続く光の道しるべ。西向きの矢印を道の真ん中の空中に）
  for (let x = -40; x > COMPOUND.fenceX + 60; x -= 60) {
    furnGlow.box(x, 6.5, jz - 3.5, 8, 0.05, 0.06, 0x52e8ff, false);
    furnGlow.box(x, 6.5, jz + 3.5, 8, 0.05, 0.06, 0x52e8ff, false);
  }

  // ================================================================ メッシュにまとめる
  const addMesh = (m: THREE.Mesh | null, cast: boolean, receive: boolean): void => { if (m) { m.castShadow = cast; m.receiveShadow = receive; root.add(m); } };
  addMesh(walk.mesh(walkMat), false, true);
  addMesh(glow.mesh(glowMat), false, false);
  for (const c of chunks.values()) {
    addMesh(c.office.mesh(officeMat), true, true);
    addMesh(c.glass.mesh(glassMat), true, true);
    addMesh(c.plain.mesh(plainMat), true, true);
    addMesh(c.glow.mesh(glowMat), false, false);
  }
  addMesh(landmarks.mesh(plainMat), true, true);
  addMesh(lmGlow.mesh(glowMat), false, false);
  addMesh(furn.mesh(plainMat), true, true);
  addMesh(furnGlow.mesh(glowMat), false, false);
  ads.forEach((b, i) => {
    const t = adTex(i);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, ...(t ? { map: t } : {}), side: THREE.DoubleSide });
    mat.color.setScalar(1.25);
    const m = b.mesh(mat);
    if (m) root.add(m);
  });

  // ================================================================ 遠くの山
  {
    const rr = rng(seed + 3);
    const ring = (scale: number, hMul: number, phase: number, c0: number, c1: number): void => {
      const K = 220, cx = -760, cz = jz, ax = 2300 * scale, az = 1150 * scale;
      const pos: number[] = [], colr: number[] = [], idx: number[] = [];
      const lo = new THREE.Color(c0), hi = new THREE.Color(c1), t = new THREE.Color();
      const rows = [{ k: 1.0, y: -10 }, { k: 0.985, y: 0.45 }, { k: 0.965, y: 1 }];
      const wave = Array.from({ length: 5 }, () => [rr() * 6.28, 0.5 + rr() * 2.5]);
      for (let i = 0; i <= K; i++) {
        const a = (i / K) * Math.PI * 2;
        let n = 0.55;
        wave.forEach(([ph, f], j) => { n += (0.5 / (j + 1)) * Math.sin(a * (f * 3 + j * 2.3) + ph + phase); });
        const jag = 0.85 + 0.3 * rr();
        const h = Math.max(25, (140 + 230 * Math.max(0, n)) * jag) * hMul;
        for (const row of rows) {
          pos.push(cx + Math.cos(a) * ax * row.k, row.y < 0 ? row.y : row.y * h, cz + Math.sin(a) * az * row.k);
          t.copy(lo).lerp(hi, Math.min(1, Math.max(0, row.y)) * (0.7 + 0.3 * rr()));
          colr.push(t.r, t.g, t.b);
        }
      }
      for (let i = 0; i < K; i++) for (let r = 0; r < 2; r++) {
        const a0 = i * 3 + r, a1 = (i + 1) * 3 + r;
        idx.push(a0, a1, a0 + 1, a1, a1 + 1, a0 + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      m.frustumCulled = false;
      root.add(m);
    };
    ring(1.0, 1.0, 0, 0x6a3a2c, 0xb87a56);
    ring(0.8, 0.6, 2.1, 0x7a4632, 0xc48a62);
  }

  // ================================================================ 空（カメラに追従）
  const sky = new THREE.Group();
  sky.name = 'surgeSky';
  {
    const g = new THREE.SphereGeometry(3500, 40, 40);
    const pos = g.getAttribute('position');
    const stops: [number, number][] = [[-1, FOG_COLOR], [0, FOG_COLOR], [0.05, 0xe39a6c], [0.2, 0xc7788a], [0.45, 0x8a5e86], [0.75, 0x4c4274], [1, 0x2a2850]];
    const c = new THREE.Color(), c2 = new THREE.Color();
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 3500;
      let k = 0;
      while (k < stops.length - 2 && y > stops[k + 1][0]) k++;
      const [y0, a] = stops[k], [y1, b] = stops[k + 1];
      const u = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
      c.set(a); c2.set(b); c.lerp(c2, u * u * (3 - 2 * u));
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    m.renderOrder = -20;
    m.frustumCulled = false;
    sky.add(m);
    // 太陽（東の低い位置。後ろから照らす）：にじみ＋芯
    const gl = glowTex();
    const sunDir = SUN_DIR;
    for (const [size, color, op] of [[1500, 0xffa860, 0.7], [520, 0xffd9a0, 0.9], [150, 0xfff4e0, 1]] as const) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({
        ...(gl ? { map: gl } : {}), color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      s.position.copy(sunDir).multiplyScalar(3200);
      s.lookAt(0, 0, 0);
      s.renderOrder = -19;
      sky.add(s);
    }
    // 星（空の上のほう）
    const sr = rng(5);
    const sp: number[] = [];
    for (let i = 0; i < 420; i++) {
      const a = sr() * Math.PI * 2, y = 0.3 + sr() * 0.7, r = Math.sqrt(1 - y * y);
      sp.push(Math.cos(a) * r * 3300, y * 3300, Math.sin(a) * r * 3300);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffe8d8, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7, depthWrite: false }));
    stars.renderOrder = -19;
    stars.frustumCulled = false;
    sky.add(stars);
    // 火星の月（ちょっといびつな丸）
    const moon = new THREE.Mesh(new THREE.SphereGeometry(70, 16, 12), new THREE.MeshBasicMaterial({ color: 0xb09a8c, fog: false }));
    moon.scale.set(1.25, 0.95, 1);
    moon.position.set(-1900, 1800, -1300);
    moon.renderOrder = -19;
    sky.add(moon);
    const moonLight = new THREE.Mesh(new THREE.SphereGeometry(70.5, 16, 12, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0xf0d8c0, fog: false }));
    moonLight.scale.copy(moon.scale);
    moonLight.position.copy(moon.position);
    moonLight.rotation.y = 0.6;
    moonLight.renderOrder = -18;
    sky.add(moonLight);
  }
  root.add(sky);

  return { root, colliders, sky, stats: { buildings: buildingCount } };
}
