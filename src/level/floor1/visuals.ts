// 1階の見た目（three.js メッシュ）の生成。ゲーム本体とマップビューア（map.html）で共用する。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AABB } from '../../core/types';
import { createGearModel, type GearModel } from '../gear';
import type { GateDef, Mat, Plan, Prim } from './plan';

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- テクスチャ
export function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
/** 汚れ・染みを足す（シード固定の擬似乱数） */
export function grime(g: CanvasRenderingContext2D, s: number, seed: number, amount: number): void {
  let a = seed;
  const r = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < amount; i++) {
    const x = r() * s, y = r() * s, rad = 6 + r() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(20,24,30,${0.05 + r() * 0.12})`); gr.addColorStop(1, 'rgba(20,24,30,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // 縦の汚れ筋
  for (let i = 0; i < amount / 4; i++) {
    g.fillStyle = `rgba(15,20,26,${0.04 + r() * 0.07})`;
    g.fillRect(r() * s, r() * s * 0.5, 1 + r() * 2.5, 10 + r() * s * 0.5);
  }
}
export function panelTex(): THREE.Texture | undefined {
  return canvasTex(128, (g, s) => {
    g.fillStyle = '#8d98a6'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#5b6674'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, s - 3, s - 3);
    g.strokeStyle = '#7b8694'; g.lineWidth = 2; g.strokeRect(10, 10, s - 20, s - 20);
    g.fillStyle = '#606b79';
    for (const [x, y] of [[6, 6], [s - 6, 6], [6, s - 6], [s - 6, s - 6]]) { g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill(); }
    grime(g, s, 7, 14);
  });
}
export function floorTex(): THREE.Texture | undefined {
  return canvasTex(128, (g, s) => {
    g.fillStyle = '#7a8591'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#4c5662'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, s - 3, s - 3);
    g.fillStyle = 'rgba(30,45,65,0.12)'; g.fillRect(s / 2, 0, s / 2, s / 2); g.fillRect(0, s / 2, s / 2, s / 2);
    g.strokeStyle = 'rgba(60,200,230,0.22)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(s / 2 - 6, s / 2); g.lineTo(s / 2 + 6, s / 2); g.moveTo(s / 2, s / 2 - 6); g.lineTo(s / 2, s / 2 + 6); g.stroke();
    grime(g, s, 21, 22);
  });
}
/** 床の粗さマップ（G チャンネル）：タイルごとに磨耗ムラ。白＝粗い */
export function floorRoughTex(): THREE.Texture | undefined {
  const t = canvasTex(128, (g, s) => {
    g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, 4); g.fillRect(0, 0, 4, s);
    let a = 99;
    const r = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 26; i++) {
      const x = r() * s, y = r() * s, rad = 8 + r() * 24;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      const v = r() > 0.5 ? '255,255,255' : '120,120,120';
      gr.addColorStop(0, `rgba(${v},0.55)`); gr.addColorStop(1, `rgba(${v},0)`);
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  });
  if (t) t.colorSpace = THREE.NoColorSpace;
  return t;
}
export function hazardTex(): THREE.Texture | undefined {
  return canvasTex(128, (g, s) => {
    g.fillStyle = '#d9a416'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#161b26';
    for (let i = -2; i < 4; i++) {
      g.beginPath();
      g.moveTo(i * s / 2, s); g.lineTo(i * s / 2 + s / 4, s); g.lineTo(i * s / 2 + s / 4 + s / 2, 0); g.lineTo(i * s / 2 + s / 2, 0);
      g.closePath(); g.fill();
    }
    grime(g, s, 5, 10);
  });
}
/** 床に敷く光だまり（加算）用の放射グラデーション */
export function poolTex(): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeSign(text: string, theme: 'cyan' | 'red' | 'green' = 'cyan', w = 6): THREE.Mesh {
  const col = theme === 'red' ? '#ff6a5a' : theme === 'green' ? '#5af0a0' : '#6ff0ff';
  let map: THREE.Texture | undefined;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(20,32,66,0.88)';
    g.beginPath(); g.roundRect(8, 8, 1008, 240, 40); g.fill();
    g.strokeStyle = col; g.lineWidth = 8;
    g.beginPath(); g.roundRect(8, 8, 1008, 240, 40); g.stroke();
    let size = 100;
    const font = (s: number) => `bold ${s}px "Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo",sans-serif`;
    g.font = font(size);
    while (g.measureText(text).width > 920 && size > 30) { size -= 4; g.font = font(size); }
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 512, 132);
    map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ ...(map ? { map } : {}), transparent: true }));
}

// ---------------------------------------------------------------- ジオメトリ
function boxGeo(p: Extract<Prim, { t: 'box' }>, white: boolean): THREE.BufferGeometry {
  const sx = p.x1 - p.x0, sy = p.y1 - p.y0, sz = p.z1 - p.z0;
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, (p.z0 + p.z1) / 2);
  const pos = g.getAttribute('position'), uv = g.getAttribute('uv');
  const tile = p.tile ?? 3;
  for (let i = 0; i < pos.count; i++) {
    const f = Math.floor(i / 4); // px,nx,py,ny,pz,nz
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (f < 2) uv.setXY(i, z / tile, y / tile);
    else if (f < 4) uv.setXY(i, x / tile, z / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  addColor(g, white ? 0xffffff : p.c);
  return g;
}
function cylGeo(p: Extract<Prim, { t: 'cyl' }>): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(p.r, p.r, p.len, p.seg, 1);
  if (p.axis === 'x') g.rotateZ(Math.PI / 2);
  else if (p.axis === 'z') g.rotateX(Math.PI / 2);
  // y 軸は p.y が底面。x/z 軸は中心が (x, y, z)
  g.translate(p.x, p.axis === 'y' ? p.y + p.len / 2 : p.y, p.z);
  addColor(g, p.c);
  return g;
}
export function addColor(g: THREE.BufferGeometry, hex: number): void {
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
}

export interface PadVis { x: number; y: number; z: number; disc: THREE.MeshBasicMaterial; ring: THREE.MeshBasicMaterial }
export interface KitVis { group: THREE.Group; x: number; y: number; z: number }

export interface GateVis {
  def: GateDef;
  /** 上下にスライドするシャッター本体 */
  shutter: THREE.Group;
  lampMat: THREE.MeshBasicMaterial;
  collider: AABB;
  /** 0=閉 1=開（アニメーション用） */
  k: number;
  open: boolean;
  cx: number; cz: number;
}

export interface Floor1Visuals {
  root: THREE.Group;
  colliders: AABB[];
  doorCollider: AABB;
  leaves: [THREE.Mesh, THREE.Mesh];
  lampMat: THREE.MeshBasicMaterial;
  statusOff: THREE.Mesh;
  statusOn: THREE.Mesh;
  gates: GateVis[];
  /** 警報照明：0..1 で発光物を赤くする */
  setAlarm(k: number, color: number): void;
  knobMat: THREE.MeshBasicMaterial;
  cellMat: THREE.MeshBasicMaterial;
  cableSegs: { mat: THREE.MeshBasicMaterial; start: number; len: number }[];
  cableTotal: number;
  /** ちらつく天井灯の発光パネル（plan.lamps の添字 → マテリアルと基準色） */
  flickerPanels: Map<number, { mat: THREE.MeshBasicMaterial; base: THREE.Color }>;
  gears: { model: GearModel; x: number; y: number; z: number; taken: boolean }[];
  pads: PadVis[];
  kits: KitVis[];
  dispose(): void;
}

const mapOf = (t: THREE.Texture | undefined): THREE.MeshStandardMaterialParameters => (t ? { map: t } : {});
const DIM = new THREE.Color(0x2b3d57);

export function buildFloor1Visuals(plan: Plan): Floor1Visuals {
  const root = new THREE.Group();
  root.name = 'floor1';
  const colliders: AABB[] = [];

  // 暗い施設：反射の弱い汚れた素材（PBR）。グローは 1 を超える色で「光っている」ように見せる
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  const rough = floorRoughTex();
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  glowMat.color.setScalar(1.45);
  const mats: Record<Mat, THREE.Material> = {
    solid: std({ roughness: 0.62, metalness: 0.2, color: 0xc6ced9 }),
    panel: std({ ...mapOf(panelTex()), roughness: 0.82, metalness: 0.05, color: 0xd2d8e0 }),
    floor: std({ ...mapOf(floorTex()), ...(rough ? { roughnessMap: rough } : {}), roughness: 1.0, metalness: 0.1, color: 0xe2e8ef }),
    hazard: std({ ...mapOf(hazardTex()), roughness: 0.7, metalness: 0.0, color: 0xb4b4b4 }),
    glow: glowMat,
    glass: new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false, emissive: 0x1a4a58 }),
    cable: new THREE.MeshBasicMaterial({ color: 0x2b3d57 }),
  };
  const cellMat = mats.cable as THREE.MeshBasicMaterial;

  const buckets = new Map<Mat, THREE.BufferGeometry[]>();
  for (const p of plan.prims) {
    const g = p.t === 'box' ? boxGeo(p, p.m === 'hazard') : cylGeo(p);
    if (p.m === 'floor') addColor(g, 0xe6ecf2); // 重なる床スラブの色ちらつき防止のため固定色
    let list = buckets.get(p.m);
    if (!list) buckets.set(p.m, (list = []));
    list.push(g);
    if (p.col) {
      if (p.t === 'box') colliders.push({ min: v3(p.x0, p.y0, p.z0), max: v3(p.x1, p.y1, p.z1), active: true, tag: p.tag });
      else {
        const e = p.r * 0.9;
        colliders.push({ min: v3(p.x - e, p.y, p.z - e), max: v3(p.x + e, p.y + p.len, p.z + e), active: true, tag: 'prop' });
      }
    }
  }
  for (const [m, list] of buckets) {
    const merged = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mats[m]);
    mesh.matrixAutoUpdate = false;
    // 天井(solid の大板)は影を落とさない：ゲーム側でライトが天井越しに照らすため、solid 全体は castShadow にしつつ
    // 天井は別扱いにせず、光源側の範囲で吸収する
    mesh.castShadow = m === 'solid' || m === 'panel';
    mesh.receiveShadow = m === 'floor' || m === 'panel' || m === 'solid' || m === 'hazard';
    if (m === 'glass') { mesh.castShadow = false; mesh.renderOrder = 2; }
    root.add(mesh);
  }

  // ---- 天井灯の発光パネル（通常＝まとめて1メッシュ、ちらつき＝個別マテリアル、故障＝暗いパネル）
  let poolMat: THREE.MeshBasicMaterial | null = null;
  const flickerPanels = new Map<number, { mat: THREE.MeshBasicMaterial; base: THREE.Color }>();
  {
    const norm: THREE.BufferGeometry[] = [], dead: THREE.BufferGeometry[] = [];
    plan.lamps.forEach((l, i) => {
      const g = new THREE.BoxGeometry(3.2, 0.08, 1.0);
      g.translate(l.x, l.h - 0.04, l.z);
      if (l.power <= 0) { dead.push(g); return; }
      if (l.flicker) {
        const base = new THREE.Color(l.color).multiplyScalar(1.5);
        const mat = new THREE.MeshBasicMaterial({ color: base.clone() });
        root.add(new THREE.Mesh(g, mat));
        flickerPanels.set(i, { mat, base });
        return;
      }
      addColor(g, l.color);
      norm.push(g);
    });
    const merge = (list: THREE.BufferGeometry[], mat: THREE.Material) => {
      if (!list.length) return;
      const mg = mergeGeometries(list, false);
      list.forEach((x) => x.dispose());
      if (mg) root.add(new THREE.Mesh(mg, mat));
    };
    merge(norm, mats.glow);
    merge(dead, new THREE.MeshBasicMaterial({ color: 0x1a222c }));
    // 床の光だまり（弱い加算の疑似ライティング。実ライトが遠い灯りの下も「照らされている」ように見せる）
    const pt = poolTex();
    const pools: THREE.BufferGeometry[] = [];
    for (const l of plan.lamps) {
      if (l.power <= 0) continue;
      if (l.h > 12 && Math.abs(l.x) > 12) continue; // 大広間の端は中二階の下になる
      const r = Math.min(l.y * 0.95, 7.5) * Math.min(1, 0.55 + l.power * 0.45);
      const g = new THREE.PlaneGeometry(r * 2, r * 2);
      g.rotateX(-Math.PI / 2);
      g.translate(l.x, 0.045, l.z);
      addColor(g, new THREE.Color(l.color).multiplyScalar(0.16).getHex());
      pools.push(g);
    }
    poolMat = new THREE.MeshBasicMaterial({
      vertexColors: true, ...(pt ? { map: pt } : {}), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    merge(pools, poolMat);
  }

  // ---- 非常用電源装置の発光コア（赤＝停止／緑＝通電）
  const knobMat = new THREE.MeshBasicMaterial({ color: 0xff4a3a });
  {
    const P = plan.power;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), knobMat);
    core.position.set(P.x - 0.95, P.y + 0.35, P.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 8, 24), new THREE.MeshBasicMaterial({ color: 0x52e8ff }));
    ring.rotation.y = Math.PI / 2;
    ring.position.copy(core.position).add(new THREE.Vector3(0.05, 0, 0));
    root.add(core, ring);
  }

  // ---- ゲート（施錠できるシャッター）
  const gates: GateVis[] = [];
  {
    const hz = hazardTex();
    const metal = new THREE.MeshStandardMaterial({ color: 0x59657a, roughness: 0.55, metalness: 0.5 });
    const navy = new THREE.MeshStandardMaterial({ color: 0x16264a, roughness: 0.6, metalness: 0.3 });
    for (const def of plan.gates) {
      const along = def.axis === 'x' ? def.z1 - def.z0 : def.x1 - def.x0;
      const cx = (def.x0 + def.x1) / 2, cz = (def.z0 + def.z1) / 2;
      const H = 5;
      const frame = new THREE.Group();                 // 動かない枠・ランプ（幅方向を X に取ってから回す）
      const shutter = new THREE.Group();
      const hzMat = new THREE.MeshStandardMaterial({ roughness: 0.7, color: 0xb4b4b4 });
      if (hz) { const t = hz.clone(); t.needsUpdate = true; t.repeat.set(along / 1.2, 1); hzMat.map = t; }
      const bx = (g: THREE.Group, m: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): void => {
        const me = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
        me.position.set(x, y, z); me.castShadow = true; me.receiveShadow = true; g.add(me);
      };
      bx(shutter, metal, 0, H / 2, 0, along - 0.1, H, 0.5);
      for (const y of [1.5, 2.6, 3.7, 4.6]) bx(shutter, navy, 0, y, 0, along - 0.1, 0.16, 0.6);
      bx(shutter, hzMat, 0, 0.45, 0, along - 0.1, 0.9, 0.62);
      bx(shutter, navy, 0, H - 0.1, 0, along - 0.1, 0.2, 0.62);
      for (const sgn of [-1, 1]) bx(frame, hzMat, sgn * (along / 2 + 0.2), H / 2, 0, 0.4, H, 1.1);
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
      for (const sz of [-1, 1]) {
        bx(frame, navy, 0, 5.25, sz * 0.62, 1.6, 0.5, 0.18);
        bx(frame, lampMat, 0, 5.25, sz * 0.72, 1.2, 0.3, 0.06);
      }
      for (const g of [frame, shutter]) {
        g.position.set(cx, 0, cz);
        if (def.axis === 'x') g.rotation.y = Math.PI / 2;
        root.add(g);
      }
      const collider: AABB = { min: v3(def.x0, 0, def.z0), max: v3(def.x1, H, def.z1), active: true, tag: 'gate' };
      colliders.push(collider);
      gates.push({ def, shutter, lampMat, collider, k: 0, open: false, cx, cz });
    }
  }
  const glowBase = glowMat.color.clone();
  const setAlarm = (k: number, color: number): void => {
    const tint = new THREE.Color(color);
    glowMat.color.copy(glowBase).lerp(tint.clone().multiplyScalar(1.45), k);
    poolMat?.color.setRGB(1, 1, 1).lerp(tint, k);
  };

  // ---- エレベーター：ドア・ランプ・状態表示
  const E = plan.elevator;
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x7d8896, roughness: 0.5, metalness: 0.4 });
  const mkLeaf = (sgn: number): THREE.Mesh => {
    const g = new THREE.Group();
    void g;
    const w = (E.doorX1 - E.doorX0) / 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, E.doorH, 0.3), leafMat);
    m.position.set(sgn * w / 2, E.doorH / 2, E.doorZ);
    m.castShadow = true;
    const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 1.4, 0.34), new THREE.MeshBasicMaterial({ color: 0x1a2a44 }));
    win.position.set(0, 0.6, 0);
    m.add(win);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, 0.34), new THREE.MeshBasicMaterial({ color: 0xffc21a }));
    stripe.position.set(0, -E.doorH / 2 + 0.5, 0);
    m.add(stripe);
    root.add(m);
    return m;
  };
  const leaves: [THREE.Mesh, THREE.Mesh] = [mkLeaf(-1), mkLeaf(1)];
  const doorCollider: AABB = {
    min: v3(E.doorX0, 0, E.doorZ - 0.2), max: v3(E.doorX1, E.doorH, E.doorZ + 0.2), active: true, tag: 'elevatorDoor',
  };
  colliders.push(doorCollider);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 0.3), lampMat);
  lamp.position.set(0, E.doorH + 0.45, E.doorZ + 0.1);
  root.add(lamp);
  // 状態表示：文字なしの発光プレート（赤＝停止／緑＝運転可）
  const plate = (c: number) => new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.35, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.4) }));
  const statusOff = plate(0xff3a2a);
  statusOff.position.set(0, E.doorH + 1.1, E.doorZ + 0.3);
  const statusOn = plate(0x3dff7a);
  statusOn.position.copy(statusOff.position);
  statusOn.visible = false;
  root.add(statusOff, statusOn);

  // ---- 電力ケーブル（区間ごとに順に光る）
  const cableSegs: { mat: THREE.MeshBasicMaterial; start: number; len: number }[] = [];
  let total = 0;
  for (let i = 0; i + 1 < plan.cable.length; i++) {
    const a = plan.cable[i], b = plan.cable[i + 1];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + Math.abs(b.z - a.z);
    const mat = new THREE.MeshBasicMaterial({ color: DIM.clone() });
    const t = 0.24;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(Math.abs(b.x - a.x) + t, Math.abs(b.y - a.y) + t, Math.abs(b.z - a.z) + t), mat);
    m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    root.add(m);
    cableSegs.push({ mat, start: total, len });
    total += len;
  }

  // ---- 歯車
  const gears = plan.gears.map((g) => {
    const model = createGearModel();
    model.position.set(g.x, g.y, g.z);
    root.add(model);
    return { model, x: g.x, y: g.y, z: g.z, taken: false };
  });

  // ---- 充電ポイント・修理キット
  const padDisc = new THREE.CircleGeometry(1.6, 28), padRing = new THREE.RingGeometry(1.7, 1.95, 32);
  const pads: PadVis[] = plan.pads.map((p) => {
    const disc = new THREE.MeshBasicMaterial({ color: 0x40e8ff, transparent: true, opacity: 0.85, depthWrite: false });
    const ring = new THREE.MeshBasicMaterial({ color: 0x9ffaff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 0.1, 24), new THREE.MeshStandardMaterial({ color: 0x5c6877, roughness: 0.6, metalness: 0.3 }));
    base.position.set(p.x, p.y + 0.05, p.z);
    const d = new THREE.Mesh(padDisc, disc); d.rotation.x = -Math.PI / 2; d.position.set(p.x, p.y + 0.12, p.z);
    const r = new THREE.Mesh(padRing, ring); r.rotation.x = -Math.PI / 2; r.position.set(p.x, p.y + 0.13, p.z);
    root.add(base, d, r);
    return { x: p.x, y: p.y, z: p.z, disc, ring };
  });
  const kitWhite = new THREE.MeshStandardMaterial({ color: 0xe8eef4, emissive: 0x4a5560, roughness: 0.5 });
  const kitGreen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x44e08a).multiplyScalar(1.3) });
  const kits: KitVis[] = plan.kits.map((k) => {
    const g = new THREE.Group();
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), kitWhite); s.scale.set(1.15, 0.9, 1.15);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const b1 = new THREE.Mesh(box, kitGreen); b1.scale.set(0.64, 0.17, 0.98);
    const b2 = new THREE.Mesh(box, kitGreen); b2.scale.set(0.17, 0.64, 0.98);
    const b3 = new THREE.Mesh(box, kitGreen); b3.scale.set(0.98, 0.17, 0.64);
    g.add(s, b1, b2, b3);
    g.position.set(k.x, k.y + 1, k.z);
    root.add(g);
    return { group: g, x: k.x, y: k.y, z: k.z };
  });

  return {
    root, colliders, doorCollider, leaves, lampMat, statusOff, statusOn, gates, setAlarm, knobMat, cellMat, cableSegs, cableTotal: total,
    flickerPanels,
    gears, pads, kits,
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
