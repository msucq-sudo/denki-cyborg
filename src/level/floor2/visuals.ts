// 2階の見た目（three.js メッシュ）の生成。円形の壁は本物の円弧、当たり判定は小さな四角の並び（plan.blockers）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AABB } from '../../core/types';
import { addColor, canvasTex, floorRoughTex, floorTex, grime, hazardTex, makeSign, panelTex } from '../floor1/visuals';
import { DOOR_H, H, R, T, type Mat, type Plan, type Prim } from './plan';

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const rad = (d: number): number => (d * Math.PI) / 180;

// ---------------------------------------------------------------- モニターの画面テクスチャ（4種）
function screenTex(kind: 0 | 1 | 2 | 3): THREE.Texture | undefined {
  return canvasTex(256, (g, s) => {
    const accent = ['#4cf0a0', '#52e8ff', '#ffc21a', '#c48cff'][kind];
    g.fillStyle = '#04101a'; g.fillRect(0, 0, s, s);
    g.strokeStyle = accent; g.fillStyle = accent; g.lineWidth = 2;
    let a = 11 + kind * 7;
    const r = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
    if (kind === 0) { // コードの行
      for (let y = 14; y < s - 8; y += 14) {
        g.globalAlpha = 0.9;
        let x = 12 + (r() < 0.4 ? 20 : 0);
        const n = 2 + Math.floor(r() * 4);
        for (let i = 0; i < n; i++) { const w = 10 + r() * 50; g.fillRect(x, y, w, 5); x += w + 8; }
      }
    } else if (kind === 1) { // 心電図・波形
      g.globalAlpha = 0.25; for (let i = 1; i < 8; i++) { g.fillRect(0, i * 32, s, 1); g.fillRect(i * 32, 0, 1, s); }
      g.globalAlpha = 1;
      for (let row = 0; row < 2; row++) {
        g.beginPath();
        for (let x = 0; x < s; x += 3) {
          const y = 70 + row * 100 + Math.sin(x * 0.09 + row) * 14 + ((x % 64) < 6 ? -40 : 0) + (r() - 0.5) * 4;
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
    } else if (kind === 2) { // 棒グラフ
      for (let i = 0; i < 9; i++) { const h = 30 + r() * 150; g.globalAlpha = 0.85; g.fillRect(18 + i * 26, s - 24 - h, 16, h); }
      g.globalAlpha = 0.5; g.fillRect(10, s - 22, s - 20, 2);
      g.globalAlpha = 0.9; g.fillRect(14, 14, 90, 8);
    } else { // 人体のワイヤーフレーム（骨格スキャン風）
      g.globalAlpha = 0.9;
      g.beginPath(); g.arc(128, 52, 22, 0, 7); g.stroke();
      g.beginPath(); g.moveTo(128, 76); g.lineTo(128, 150); g.moveTo(80, 100); g.lineTo(176, 100);
      g.moveTo(80, 100); g.lineTo(66, 150); g.moveTo(176, 100); g.lineTo(190, 150);
      g.moveTo(128, 150); g.lineTo(104, 225); g.moveTo(128, 150); g.lineTo(152, 225); g.stroke();
      for (const [x, y] of [[128, 100], [80, 100], [176, 100], [128, 150], [104, 190], [152, 190]]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
      g.globalAlpha = 0.35; g.strokeRect(40, 14, s - 80, s - 28);
    }
    g.globalAlpha = 1;
    grime(g, s, 3 + kind, 4);
  });
}

// ---------------------------------------------------------------- ジオメトリ
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qr = new THREE.Quaternion(), _e = new THREE.Euler();
function primGeo(p: Prim): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (p.t === 'box') g = new THREE.BoxGeometry(p.sx, p.sy, p.sz);
  else if (p.t === 'cyl') g = new THREE.CylinderGeometry(p.r2 ?? p.r, p.r, p.len, p.seg, 1);
  else g = new THREE.TorusGeometry(p.R, p.r, 8, p.seg);
  _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.ry);
  if (p.rot) { _qr.setFromEuler(_e.set(p.rot[0], p.rot[1], p.rot[2], 'XYZ')); _q.multiply(_qr); }
  _m.compose(v3(p.x, p.y, p.z), _q, v3(1, 1, 1));
  g.applyMatrix4(_m);
  if (!p.m.startsWith('scr')) planarUV(g, 3);
  addColor(g, p.m.startsWith('scr') ? 0xffffff : p.c);
  return g;
}
/** 法線の向きに応じた平面 UV（世界座標 / tile）。床・壁・パネルのテクスチャのタイル用 */
function planarUV(g: THREE.BufferGeometry, tile: number): void {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    if (ny >= nx && ny >= nz) uv.setXY(i, x / tile, z / tile);
    else if (nx >= nz) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
}

export interface Floor2Visuals {
  root: THREE.Group;
  colliders: AABB[];
  doorCollider: AABB;
  leaves: [THREE.Mesh, THREE.Mesh];
  /** エレベーターのドア上のランプ */
  lampMat: THREE.MeshBasicMaterial;
  /** ベッドの手元ランプ（近くにいると点滅させる） */
  glowMat: THREE.MeshBasicMaterial;
  dispose(): void;
}

export function buildFloor2Visuals(plan: Plan): Floor2Visuals {
  const root = new THREE.Group();
  root.name = 'floor2';
  const colliders: AABB[] = [];

  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  const mapOf = (t: THREE.Texture | undefined): THREE.MeshStandardMaterialParameters => (t ? { map: t } : {});
  const rough = floorRoughTex();
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  glowMat.color.setScalar(1.5);
  const scr = (k: 0 | 1 | 2 | 3) => {
    const t = screenTex(k);
    const m = new THREE.MeshBasicMaterial({ ...(t ? { map: t } : { color: 0x335566 }) });
    m.color.setScalar(1.25);
    return m;
  };
  const mats: Record<Mat, THREE.Material> = {
    solid: std({ roughness: 0.55, metalness: 0.25, color: 0xc6ced9 }),
    panel: std({ ...mapOf(panelTex()), roughness: 0.7, metalness: 0.1, color: 0xd8dee6 }),
    floor: std({ ...mapOf(floorTex()), ...(rough ? { roughnessMap: rough } : {}), roughness: 0.9, metalness: 0.12, color: 0xe2e8ef }),
    glow: glowMat,
    glass: new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false, emissive: 0x18503c }),
    hazard: std({ ...mapOf(hazardTex()), roughness: 0.7, metalness: 0, color: 0xb4b4b4 }),
    metal: std({ roughness: 0.38, metalness: 0.7, color: 0xd5dbe3 }),
    scr0: scr(0), scr1: scr(1), scr2: scr(2), scr3: scr(3),
  };

  // ---- プリミティブ（材質ごとに結合）
  const buckets = new Map<Mat, THREE.BufferGeometry[]>();
  for (const p of plan.prims) {
    let list = buckets.get(p.m);
    if (!list) buckets.set(p.m, (list = []));
    list.push(primGeo(p));
  }
  for (const [m, list] of buckets) {
    const merged = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mats[m]);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = m === 'solid' || m === 'panel' || m === 'metal';
    mesh.receiveShadow = m === 'floor' || m === 'panel' || m === 'solid' || m === 'metal' || m === 'hazard';
    if (m === 'glass') mesh.renderOrder = 2;
    root.add(mesh);
  }

  // ---- 円形の壁（出入口で切れた円弧）
  const wallMat = new THREE.MeshStandardMaterial({ ...mapOf(panelTex()), roughness: 0.75, metalness: 0.08, color: 0xdfe5ee, side: THREE.DoubleSide });
  const trimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x52e8ff).multiplyScalar(1.4), side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2433, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide });
  const shell = (r: number, y0: number, y1: number, a: number, b: number, mat: THREE.Material): THREE.Mesh => {
    // 北から時計回り φ ∈ [a,b]（度）→ CylinderGeometry の θ = π-φ
    const g = new THREE.CylinderGeometry(r, r, y1 - y0, Math.max(4, Math.ceil((b - a) / 3)), 1, true, Math.PI - rad(b), rad(b - a));
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const arcLen = r * rad(b - a);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * arcLen / 3, uv.getY(i) * (y1 - y0) / 3);
    g.translate(0, (y0 + y1) / 2, 0);
    const me = new THREE.Mesh(g, mat);
    me.castShadow = me.receiveShadow = true;
    root.add(me);
    return me;
  };
  for (const [a, b] of plan.arcs) {
    shell(R, 0, H, a, b, wallMat);
    shell(R + T, 0, H, a, b, wallMat);
    shell(R - 0.02, 0, 0.35, a, b, dark);                 // 幅木
    shell(R - 0.03, H - 1.0, H - 0.88, a, b, trimMat);    // 天井近くの発光帯
    shell(R - 0.03, 2.2, 2.28, a, b, trimMat);            // 腰の高さの細い光の線
    shell(R - 0.02, H - 0.8, H, a, b, dark);              // 天井際の帯
  }
  // 出入口の上（まぐさ）と縁
  for (const gp of plan.gaps) {
    const a = gp.c - gp.half, b = gp.c + gp.half;
    shell(R, DOOR_H, H, a, b, wallMat);
    shell(R + T, DOOR_H, H, a, b, wallMat);
    const under = new THREE.RingGeometry(R, R + T, 12, 1, rad(a) - Math.PI / 2, rad(b - a));
    under.rotateX(Math.PI / 2);
    under.translate(0, DOOR_H, 0);
    root.add(new THREE.Mesh(under, dark));
    shell(R - 0.03, DOOR_H - 0.12, DOOR_H, a, b, trimMat);
    // 両脇の壁の断面
    for (const e of [a, b]) {
      const mid = e === a ? 1 : -1;
      const phi = rad(e) + (mid * rad(0.0));
      const cx = (R + T / 2) * Math.sin(phi), cz = -(R + T / 2) * Math.cos(phi);
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.06, DOOR_H, T), dark);
      jamb.position.set(cx, DOOR_H / 2, cz);
      jamb.rotation.y = Math.PI - phi;
      root.add(jamb);
    }
  }

  // ---- 当たり判定
  for (const b of plan.blockers) colliders.push({ min: v3(b.x0, b.y0, b.z0), max: v3(b.x1, b.y1, b.z1), active: true, tag: b.tag });

  // ---- エレベーターのドア（左右スライド）
  const E = plan.elevator;
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x8e99a8, roughness: 0.45, metalness: 0.5 });
  const mkLeaf = (sgn: number): THREE.Mesh => {
    const w = (E.doorX1 - E.doorX0) / 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, E.doorH, 0.22), leafMat);
    m.position.set(sgn * w / 2, E.doorH / 2, E.doorZ);
    m.castShadow = true;
    const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 1.4, 0.26), new THREE.MeshBasicMaterial({ color: 0x1a2a44 }));
    win.position.set(0, 0.6, 0);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, 0.26), new THREE.MeshBasicMaterial({ color: 0xffc21a }));
    stripe.position.set(0, -E.doorH / 2 + 0.5, 0);
    m.add(win, stripe);
    root.add(m);
    return m;
  };
  const leaves: [THREE.Mesh, THREE.Mesh] = [mkLeaf(-1), mkLeaf(1)];
  const doorCollider: AABB = { min: v3(E.doorX0, 0, E.doorZ - 0.2), max: v3(E.doorX1, E.doorH, E.doorZ + 0.2), active: true, tag: 'elevatorDoor' };
  colliders.push(doorCollider);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x3dff7a });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.4, 0.2), lampMat);
  lamp.position.set(0, E.doorH + 0.2, E.doorZ - 0.5);
  root.add(lamp);

  // ---- 看板（エレベーター・封鎖された出口）
  const el = makeSign('エレベーター', 'green', 3.4);
  el.position.set(0, 5.2, R - 0.1);
  el.rotation.y = Math.PI;
  root.add(el);
  for (const ex of plan.exits) {
    const s = makeSign('封鎖中', 'red', 2.8);
    s.position.set(ex.doorX - ex.dirX * 0.4, 3.7, ex.doorZ - ex.dirZ * 0.4);
    s.rotation.y = Math.atan2(-ex.dirX, -ex.dirZ);
    root.add(s);
  }

  return {
    root, colliders, doorCollider, leaves, lampMat, glowMat,
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mt = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mt)) mt.forEach((x) => x.dispose()); else mt?.dispose?.();
      });
    },
  };
}
