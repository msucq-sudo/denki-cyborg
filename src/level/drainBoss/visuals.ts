// ドレイン装置の部屋の見た目と当たり判定：通路・自動ドア・ボスの部屋（広い）・キーボードとモニターの壁・ドレイン装置（東の壁際）・天井の穴。
// 動くもの（モニターのちらつき・電気の流れ・装置の吸い込み・天井のひび割れと落下）は update(t, dt) / setCrack / breakTiles で動かす。
import * as THREE from 'three';
import type { AABB } from '../../core/types';
import { floorTex, hazardTex, panelTex } from '../floor1/visuals';
import { ARENA, CONSOLE, CORRIDOR, DEVICE, DOOR, HOLE, INTAKES, BOSS_LAND, v3 } from './layout';

export interface DrainBossVisuals {
  root: THREE.Group;
  colliders: AABB[];
  lights: THREE.Light[];
  /** 自動ドア k=0 閉 .. 1 開 */
  setDoor(k: number): void;
  readonly doorCollider: AABB;
  /** 天井のひび割れ 0..1 */
  setCrack(k: number): void;
  /** 天井の板が割れて落ちる（穴があく）。immediate=true で落ちる演出なしに穴だけ開いた状態にする */
  breakTiles(immediate?: boolean): void;
  readonly tilesBroken: boolean;
  /** 床のがれきを置く */
  showRubble(): void;
  /** 毎フレーム */
  update(t: number, dt: number): void;
  /** 装置の吸い込みの強さ（戦闘中は少し強くなど） */
  suck: number;
  /** 装置の位置（調べる・演出用） */
  devicePos: THREE.Vector3;
  /** 落ちてくる板の位置（砂ぼこりの発生点） */
  tileCenters: THREE.Vector3[];
}

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tag: string): AABB =>
  ({ min: v3(x0, y0, z0), max: v3(x1, y1, z1), active: true, tag });

function rep(t: THREE.Texture | undefined, x: number, y: number): { map?: THREE.Texture } {
  if (!t) return {};
  const c = t.clone();
  c.needsUpdate = true;
  c.repeat.set(x, y);
  return { map: c };
}

/** モニターの画面：データが流れているような絵（色違い4種） */
function screenTex(hue: string, seed: number): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 192;
  const g = c.getContext('2d');
  if (!g) return undefined;
  let a = seed;
  const r = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.fillStyle = '#04101a'; g.fillRect(0, 0, 256, 192);
  g.strokeStyle = hue; g.fillStyle = hue;
  g.globalAlpha = 0.9;
  g.lineWidth = 2; g.strokeRect(3, 3, 250, 186);
  for (let i = 0; i < 14; i++) { g.globalAlpha = 0.35 + r() * 0.6; g.fillRect(10, 12 + i * 12, 20 + r() * 200, 5); }
  g.globalAlpha = 0.9;
  g.beginPath();
  for (let i = 0; i <= 32; i++) { const y = 150 + Math.sin(i * 0.7 + seed) * 12 + (r() - 0.5) * 18; i === 0 ? g.moveTo(10 + i * 7, y) : g.lineTo(10 + i * 7, y); }
  g.stroke();
  for (let i = 0; i < 4; i++) { g.globalAlpha = 0.5; g.fillRect(150 + i * 25, 100 - r() * 70, 16, 4 + r() * 70); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function crackTex(): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  if (!g) return undefined;
  let a = 7;
  const r = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  const branch = (x: number, y: number, ang: number, len: number, w: number, depth: number): void => {
    if (len < 8 || depth > 5) return;
    const segs = 5;
    let px = x, py = y;
    for (let i = 0; i < segs; i++) {
      ang += (r() - 0.5) * 0.9;
      const nx = px + Math.cos(ang) * len / segs, ny = py + Math.sin(ang) * len / segs;
      for (const [lw, col] of [[w + 5, 'rgba(255,120,40,0.35)'], [w + 2, '#0c0a08'], [Math.max(0.8, w * 0.35), '#ffb060']] as const) {
        g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round';
        g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
      }
      px = nx; py = ny;
      if (r() < 0.55) branch(px, py, ang + (r() < 0.5 ? 0.8 : -0.8) * (0.5 + r()), len * 0.55, w * 0.7, depth + 1);
    }
  };
  for (let i = 0; i < 9; i++) branch(256, 256, (i / 9) * Math.PI * 2 + r() * 0.5, 190 + r() * 60, 5, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildDrainBossVisuals(): DrainBossVisuals {
  const root = new THREE.Group();
  root.name = 'drainBoss';
  const colliders: AABB[] = [];
  const lights: THREE.Light[] = [];
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const add = (m: THREE.Object3D) => { root.add(m); return m; };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root): THREE.Mesh => {
    const me = new THREE.Mesh(g, m); me.position.set(x, y, z); parent.add(me); return me;
  };
  const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

  const A = ARENA, C = CORRIDOR;
  const floorMat = std({ ...rep(floorTex(), 34, 30), color: 0x6a7480, roughness: 0.8, metalness: 0.35 });
  const corrFloorMat = std({ ...rep(floorTex(), 3, 24), color: 0x55606c, roughness: 0.8, metalness: 0.35 });
  const wallMat = std({ ...rep(panelTex(), 26, 5), color: 0x59616e, roughness: 0.75, metalness: 0.4 });
  const corrWallMat = std({ ...rep(panelTex(), 24, 2), color: 0x4a525e, roughness: 0.75, metalness: 0.4 });
  const darkMat = std({ color: 0x1b1e26, roughness: 0.6, metalness: 0.6 });
  const trimMat = std({ color: 0xe0a21c, roughness: 0.6, metalness: 0.3, emissive: 0x3a2800, emissiveIntensity: 0.4 });
  const hazMat = std({ ...rep(hazardTex(), 8, 1), color: 0xcccccc, roughness: 0.6 });
  const cableMat = std({ color: 0x14161c, roughness: 0.5, metalness: 0.5 });
  const glowCyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5ae0ff).multiplyScalar(1.3) });
  const glowAmber = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa840).multiplyScalar(1.3) });

  // ================================================================ 通路
  const cw = C.x1 - C.x0, cl = C.z1 - C.z0, ccz = (C.z0 + C.z1) / 2;
  const cf = mesh(new THREE.PlaneGeometry(cw, cl), corrFloorMat, 0, 0, ccz);
  cf.rotation.x = -Math.PI / 2; cf.receiveShadow = true;
  const cc = mesh(new THREE.PlaneGeometry(cw, cl), corrWallMat, 0, C.h, ccz);
  cc.rotation.x = Math.PI / 2;
  for (const sx of [-1, 1]) {
    const w = mesh(new THREE.PlaneGeometry(cl, C.h), corrWallMat, sx * cw / 2, C.h / 2, ccz);
    w.rotation.y = -sx * Math.PI / 2;
  }
  const endWall = mesh(new THREE.PlaneGeometry(cw, C.h), corrWallMat, 0, C.h / 2, C.z1);
  endWall.rotation.y = Math.PI;
  colliders.push(box(C.x0, -2, C.z0 - 1, C.x1, 0, C.z1 + 1, 'floor'));
  colliders.push(box(C.x0 - 1, -2, C.z0 - 0.4, C.x0, C.h + 1, C.z1 + 1, 'wall'));
  colliders.push(box(C.x1, -2, C.z0 - 0.4, C.x1 + 1, C.h + 1, C.z1 + 1, 'wall'));
  colliders.push(box(C.x0, C.h, C.z0 - 0.4, C.x1, C.h + 1, C.z1 + 1, 'ceil'));
  colliders.push(box(C.x0, -2, C.z1, C.x1, C.h + 1, C.z1 + 1, 'wall'));
  // 通路の飾り：床の黄色い誘導ライン・壁際の配管・天井の照明・ケーブル（ドレイン装置の方へ集まる）
  for (let z = C.z0 + 2; z < C.z1 - 1; z += 4) {
    const lamp = mesh(B(0.5, 0.1, 1.6), glowAmber, 0, 0.03, z);
    lamp.castShadow = false;
  }
  for (const sx of [-1, 1]) {
    mesh(B(0.5, 0.5, cl), darkMat, sx * (cw / 2 - 0.3), C.h - 0.5, ccz);
    mesh(new THREE.CylinderGeometry(0.22, 0.22, cl, 10), cableMat, sx * (cw / 2 - 0.35), 1.1, ccz).rotation.x = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.12, 0.12, cl, 8), cableMat, sx * (cw / 2 - 0.35), 1.6, ccz).rotation.x = Math.PI / 2;
    for (let z = C.z0 + 3; z < C.z1; z += 6) mesh(B(0.12, 2.2, 0.35), trimMat, sx * (cw / 2 - 0.08), 1.2, z);
  }
  const corrLampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xcfe6ff).multiplyScalar(1.4) });
  for (const z of [72, 60, 48, 38]) {
    mesh(B(2.4, 0.12, 0.6), corrLampMat, 0, C.h - 0.12, z);
    const pl = new THREE.PointLight(0xb8d4ff, 38, 17, 1.6);
    pl.position.set(0, C.h - 0.8, z);
    lights.push(pl);
  }
  mesh(B(cw, 0.1, 0.9), hazMat, 0, 0.02, C.z1 - 1.5);

  // ================================================================ ボスの部屋
  const aw = A.x1 - A.x0, al = A.z1 - A.z0, acx = (A.x0 + A.x1) / 2, acz = (A.z0 + A.z1) / 2;
  const af = mesh(new THREE.PlaneGeometry(aw, al), floorMat, acx, 0, acz);
  af.rotation.x = -Math.PI / 2; af.receiveShadow = true;
  colliders.push(box(A.x0 - 2, -2, A.z0 - 2, A.x1 + 2, 0, A.z1 + 2, 'floor'));
  // 壁（北・西・東・南は戸口をあけて）
  const wall = (w: number, h: number, x: number, y: number, z: number, ry: number) => {
    const m = mesh(new THREE.PlaneGeometry(w, h), wallMat, x, y, z); m.rotation.y = ry; return m;
  };
  wall(aw, A.h, acx, A.h / 2, A.z0, 0);
  wall(al, A.h, A.x0, A.h / 2, acz, Math.PI / 2);
  wall(al, A.h, A.x1, A.h / 2, acz, -Math.PI / 2);
  wall(aw / 2 - DOOR.x1, A.h, (A.x0 + DOOR.x0) / 2, A.h / 2, A.z1, Math.PI);
  wall(aw / 2 - DOOR.x1, A.h, (A.x1 + DOOR.x1) / 2, A.h / 2, A.z1, Math.PI);
  wall(DOOR.x1 - DOOR.x0, A.h - DOOR.h, 0, (A.h + DOOR.h) / 2, A.z1, Math.PI);
  colliders.push(box(A.x0 - 1, -2, A.z0 - 1, A.x1 + 1, A.h + 1, A.z0, 'wall'));
  colliders.push(box(A.x0 - 1, -2, A.z0, A.x0, A.h, A.z1 + 1, 'wall'));   // 西の壁は天井の高さまで（上の階の戸口をふさがない）
  colliders.push(box(A.x1, -2, A.z0, A.x1 + 1, A.h + 1, A.z1 + 1, 'wall'));
  colliders.push(box(A.x0, -2, A.z1, DOOR.x0, A.h + 1, A.z1 + 1, 'wall'));
  colliders.push(box(DOOR.x1, -2, A.z1, A.x1, A.h + 1, A.z1 + 1, 'wall'));
  colliders.push(box(DOOR.x0, DOOR.h, A.z1, DOOR.x1, A.h + 1, A.z1 + 1, 'wall'));
  // 天井の当たりは upper.ts（穴の上の部屋の床）が持つ：穴のまわり 4 枚 + 穴をふさぐ plug（撃破まで）
  // 柱の出っぱり（壁際。動きを邪魔しない）と、壁の黄色いライン
  for (let z = A.z0 + 6; z < A.z1 - 3; z += 12) {
    mesh(B(1.2, A.h, 1.2), darkMat, A.x0 + 0.6, A.h / 2, z);
    colliders.push(box(A.x0, 0, z - 0.6, A.x0 + 1.2, A.h, z + 0.6, 'pillar'));
  }
  mesh(B(0.1, 0.5, al), trimMat, A.x0 + 0.06, 3.2, acz);
  mesh(B(aw, 0.5, 0.1), trimMat, acx, 0.5, A.z1 - 0.06);
  // 天井：穴のまわりの4枚 + 穴にはまった9枚のタイル
  const H0 = HOLE.size / 2;
  const ceilMat = std({ ...rep(panelTex(), 20, 4), color: 0x3c424e, roughness: 0.85, metalness: 0.35 });
  const ceilSlab = (x0: number, x1: number, z0: number, z1: number) =>
    mesh(B(x1 - x0, 0.5, z1 - z0), ceilMat, (x0 + x1) / 2, A.h + 0.25 - 0.5, (z0 + z1) / 2);
  const hx0 = HOLE.x - H0, hx1 = HOLE.x + H0, hz0 = HOLE.z - H0, hz1 = HOLE.z + H0;
  ceilSlab(A.x0, hx0, A.z0, A.z1); ceilSlab(hx1, A.x1, A.z0, A.z1);
  ceilSlab(hx0, hx1, A.z0, hz0); ceilSlab(hx0, hx1, hz1, A.z1);
  // 天井の照明（面）と実ライト
  const panelLamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd8e6ff).multiplyScalar(1.5) });
  for (const z of [-22, -8, 16, 24]) for (const x of [-24, -8, 8, 24]) {
    if (Math.abs(x - HOLE.x) < H0 + 2 && Math.abs(z - HOLE.z) < H0 + 2) continue;
    mesh(B(6, 0.12, 0.7), panelLamp, x, A.h - 0.56, z).castShadow = false;
  }
  for (const [x, z] of [[-22, -14], [-22, 16], [6, 18], [-2, -16], [14, 0]] as const) {
    const pl = new THREE.PointLight(0xc4d8ff, 120, 46, 1.5);
    pl.position.set(x, A.h - 2, z);
    lights.push(pl);
  }
  const hemi = new THREE.HemisphereLight(0x6f86b0, 0x1a1d26, 1.35);
  lights.push(hemi);
  const sun = new THREE.DirectionalLight(0xbfd0ff, 0.8);
  sun.position.set(-10, 30, 20);
  sun.target.position.set(0, 0, 0);
  lights.push(sun, sun.target as unknown as THREE.Light);

  const tiles: THREE.Mesh[] = [];
  const tileVel: THREE.Vector3[] = [];
  const tileSpin: THREE.Vector3[] = [];
  const tileState: boolean[] = [];     // 落下中
  const ts = HOLE.size / HOLE.tiles;
  const tileMat = std({ ...rep(panelTex(), 1, 1), color: 0x3c424e, roughness: 0.85, metalness: 0.35 });
  const tileCenters: THREE.Vector3[] = [];
  for (let i = 0; i < HOLE.tiles; i++) for (let j = 0; j < HOLE.tiles; j++) {
    const t = mesh(B(ts - 0.04, 0.5, ts - 0.04), tileMat, hx0 + ts * (i + 0.5), A.h - 0.25, hz0 + ts * (j + 0.5));
    tiles.push(t);
    tileCenters.push(t.position.clone());
    tileVel.push(v3((Math.random() - 0.5) * 3, -2 - Math.random() * 3, (Math.random() - 0.5) * 3));
    tileSpin.push(v3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3));
    tileState.push(false);
  }
  // ひび割れ（タイルの下面に貼る。割れる前に広がる）
  const crackT = crackTex();
  const crackMat = new THREE.MeshBasicMaterial({ ...(crackT ? { map: crackT } : {}), transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide });
  const crack = mesh(new THREE.PlaneGeometry(HOLE.size * 1.15, HOLE.size * 1.15), crackMat, HOLE.x, A.h - 0.52, HOLE.z);
  crack.rotation.x = Math.PI / 2;
  crack.visible = false;
  crack.renderOrder = 4;
  let crackK = 0;
  let broken = false;
  const rubble = new THREE.Group();
  rubble.visible = false;
  root.add(rubble);
  let rubbleMade = false;

  // ================================================================ 自動ドア
  const doorMat = std({ color: 0x353b48, roughness: 0.5, metalness: 0.7 });
  const doorGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a3a).multiplyScalar(1.3) });
  const panels: THREE.Group[] = [];
  const dw = (DOOR.x1 - DOOR.x0) / 2;
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(s * dw / 2, DOOR.h / 2, DOOR.z);
    mesh(B(dw, DOOR.h, 0.4), doorMat, 0, 0, 0, g);
    mesh(B(dw - 0.2, 0.18, 0.44), hazMat, 0, -DOOR.h / 2 + 0.6, 0, g);
    mesh(B(0.12, DOOR.h - 0.6, 0.46), doorGlow, -s * (dw / 2 - 0.08), 0, 0, g).castShadow = false;
    root.add(g);
    panels.push(g);
  }
  mesh(B(DOOR.x1 - DOOR.x0 + 1.2, 0.6, DOOR.thick), darkMat, 0, DOOR.h + 0.3, DOOR.z);
  const doorCollider = box(DOOR.x0, 0, DOOR.z - 0.3, DOOR.x1, DOOR.h, DOOR.z + 0.3, 'door');
  colliders.push(doorCollider);
  const doorLight = new THREE.PointLight(0xff7a40, 14, 9, 2);
  doorLight.position.set(0, DOOR.h - 0.4, DOOR.z + 1.2);
  lights.push(doorLight);
  // 部屋の側から見た戸口まわり（ドアが開く様子が見えるように）
  const doorFill = new THREE.PointLight(0x9cc0ff, 70, 26, 1.6);
  doorFill.position.set(-2, 7, DOOR.z - 4);
  lights.push(doorFill);
  let doorK = 0;
  function setDoor(k: number): void {
    doorK = k;
    const e = k * k * (3 - 2 * k);
    panels[0].position.x = -dw / 2 - e * (dw + 0.15);
    panels[1].position.x = dw / 2 + e * (dw + 0.15);
    doorCollider.active = k < 0.6;
    doorLight.color.setHex(k > 0.05 ? 0x6affb0 : 0xff7a40);
    doorGlow.color.setHex(k > 0.05 ? 0x6affb0 : 0xff6a3a).multiplyScalar(1.3);
  }
  void doorK;

  // ================================================================ キーボードとモニターの壁（北）
  const K = CONSOLE;
  const cwid = K.x1 - K.x0, cx = (K.x0 + K.x1) / 2;
  const deskMat = std({ color: 0x2a303c, roughness: 0.55, metalness: 0.5 });
  mesh(B(cwid, K.deskH, K.depth), deskMat, cx, K.deskH / 2, A.z0 + K.depth / 2);
  mesh(B(cwid, 0.08, K.depth + 0.15), trimMat, cx, K.deskH + 0.04, A.z0 + K.depth / 2);
  colliders.push(box(K.x0, 0, A.z0, K.x1, K.deskH + 0.1, A.z0 + K.depth, 'desk'));
  // 壁一面のモニター枠（黒）
  mesh(B(cwid + 1, 11, 0.3), darkMat, cx, 6.7, A.z0 + 0.15);
  // モニター：色違い4種のインスタンス
  const variants = [['#5ae0ff', 11], ['#6aff9a', 23], ['#ffb040', 37], ['#ff6a8a', 53]] as const;
  const screenMats: THREE.MeshBasicMaterial[] = [];
  const screenInst: THREE.InstancedMesh[] = [];
  const total = K.cols * K.screenRows.length;
  const per = Math.ceil(total / variants.length);
  variants.forEach(([hue, seed], vi) => {
    const tex = screenTex(hue, seed);
    const mat = new THREE.MeshBasicMaterial({ ...(tex ? { map: tex } : {}), color: new THREE.Color(1.25, 1.25, 1.25) });
    screenMats.push(mat);
    const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(K.screenW * 0.92, K.screenH * 0.9), mat, per);
    inst.count = 0;
    screenInst.push(inst);
    root.add(inst);
    void vi;
  });
  const bezelInst = new THREE.InstancedMesh(B(K.screenW, K.screenH, 0.25), darkMat, total);
  root.add(bezelInst);
  const m4 = new THREE.Matrix4();
  let n = 0;
  for (let r = 0; r < K.screenRows.length; r++) for (let c = 0; c < K.cols; c++) {
    const x = K.x0 + (c + 0.5) * (cwid / K.cols), y = K.screenRows[r] + 0.5;
    m4.makeTranslation(x, y, A.z0 + 0.45);
    bezelInst.setMatrixAt(n, m4);
    const vi = (c + r * 2) % variants.length;
    const inst = screenInst[vi];
    m4.makeTranslation(x, y, A.z0 + 0.6);
    inst.setMatrixAt(inst.count++, m4);
    n++;
  }
  bezelInst.count = n;
  for (const inst of screenInst) inst.instanceMatrix.needsUpdate = true;
  bezelInst.instanceMatrix.needsUpdate = true;
  // 上段の大型スクリーン3枚
  const bigTex = screenTex('#5ae0ff', 71);
  const bigMat = new THREE.MeshBasicMaterial({ ...(bigTex ? { map: bigTex } : {}), color: new THREE.Color(1.3, 1.3, 1.3) });
  screenMats.push(bigMat);
  for (const bx of [-18, 0, 18]) {
    mesh(B(15, 4.6, 0.3), darkMat, bx, 13.3, A.z0 + 0.4);
    mesh(new THREE.PlaneGeometry(14.2, 4.0), bigMat, bx, 13.3, A.z0 + 0.58);
  }
  // キーボード（机の上）：2列
  const kbN = Math.floor(cwid / 0.8);
  const kbGeo = B(0.62, 0.05, 0.24), keyGeo = B(0.54, 0.012, 0.15);
  const kb = new THREE.InstancedMesh(kbGeo, std({ color: 0x1a1d24, roughness: 0.5, metalness: 0.4 }), kbN * 2);
  const keys = new THREE.InstancedMesh(keyGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), kbN * 2);
  const tint = new THREE.Color();
  let q = 0;
  for (const row of [0, 1]) for (let i = 0; i < kbN; i++) {
    const x = K.x0 + 0.5 + i * 0.8, z = A.z0 + 1.1 + row * 1.4;
    m4.makeTranslation(x, K.deskH + 0.12, z);
    kb.setMatrixAt(q, m4);
    m4.makeTranslation(x, K.deskH + 0.16, z + 0.01);
    keys.setMatrixAt(q, m4);
    tint.setHSL([0.52, 0.38, 0.1, 0.0][(i + row) % 4] ?? 0.52, 0.9, 0.55);
    keys.setColorAt(q, tint);
    q++;
  }
  root.add(kb, keys);
  // 机の上の小さなモニター（キーボードの奥）
  for (let i = 0; i < 12; i++) {
    const x = K.x0 + 2 + i * (cwid - 4) / 11;
    mesh(B(1.5, 0.9, 0.12), darkMat, x, K.deskH + 0.55, A.z0 + 2.3);
    mesh(new THREE.PlaneGeometry(1.3, 0.72), screenMats[i % 4], x, K.deskH + 0.55, A.z0 + 2.37).rotation.y = 0;
  }
  const consoleLight = new THREE.PointLight(0x62d8ff, 220, 40, 1.5);
  consoleLight.position.set(cx, 6, A.z0 + 6);
  lights.push(consoleLight);

  // ================================================================ ドレイン装置（東の壁際）
  const D = DEVICE;
  const dcx = (D.x0 + D.x1) / 2, dcz = (D.z0 + D.z1) / 2, dwid = D.x1 - D.x0, dlen = D.z1 - D.z0;
  const devMat = std({ ...rep(panelTex(), 3, 4), color: 0x4a525e, roughness: 0.6, metalness: 0.6 });
  const devDark = std({ color: 0x20242c, roughness: 0.5, metalness: 0.7 });
  const group = new THREE.Group();
  group.name = 'drainDevice';
  root.add(group);
  mesh(B(dwid, D.h, dlen), devMat, dcx, D.h / 2, dcz, group);
  mesh(B(dwid + 0.6, 1.2, dlen + 0.6), devDark, dcx, 0.6, dcz, group);                  // 土台
  mesh(B(dwid + 0.4, 0.8, dlen + 0.4), devDark, dcx, D.h + 0.4, dcz, group);            // 天板
  mesh(B(dwid + 0.62, 0.35, dlen + 0.62), hazMat, dcx, 1.4, dcz, group);                // 黄黒の帯
  colliders.push(box(D.x0, 0, D.z0, D.x1, D.h + 1, D.z1, 'device'));
  colliders.push(box(D.x0 - 0.3, 0, D.z0 - 0.3, D.x1, 1.8, D.z1 + 0.3, 'device'));
  // 上のコイルとタンク
  const coilMat = std({ color: 0x2c313c, roughness: 0.4, metalness: 0.8 });
  const rings: THREE.Mesh[] = [];
  for (const [zz, hh] of [[-15, 4.5], [-7, 6], [1, 4.5]] as const) {
    mesh(new THREE.CylinderGeometry(1.7, 2.0, hh, 14), coilMat, dcx + 1, D.h + 0.8 + hh / 2, zz, group);
    for (let i = 0; i < 4; i++) {
      const rg = mesh(new THREE.TorusGeometry(1.95 - i * 0.02, 0.14, 8, 22), glowCyan, dcx + 1, D.h + 1.6 + i * (hh / 4.6), zz, group);
      rg.rotation.x = Math.PI / 2;
      rings.push(rg);
    }
  }
  // 吸い込み口：奥まった枠・光る円・回る輪（西向きの面）
  const intakeRings: THREE.Mesh[] = [];
  const intakeCores: THREE.Mesh[] = [];
  for (const it of INTAKES) {
    mesh(B(1.4, 5.6, 5.6), devDark, D.x0 + 0.1, it.y, it.z, group);
    const core = mesh(new THREE.CircleGeometry(2.2, 28), glowCyan.clone(), D.x0 - 0.62, it.y, it.z, group);
    core.rotation.y = -Math.PI / 2;
    intakeCores.push(core);
    for (const r of [2.45, 1.7, 0.95]) {
      const tr = mesh(new THREE.TorusGeometry(r, 0.12, 8, 28), glowAmber, D.x0 - 0.7, it.y, it.z, group);
      tr.rotation.y = Math.PI / 2;
      intakeRings.push(tr);
    }
    mesh(B(0.5, 6.2, 6.2), trimMat, D.x0 - 0.05, it.y, it.z, group);
    const pl = new THREE.PointLight(0x62d8ff, 70, 18, 1.8);
    pl.position.set(D.x0 - 3, it.y, it.z);
    lights.push(pl);
  }
  // 面の通気口・インジケーター
  for (let z = D.z0 + 1.5; z < D.z1 - 1; z += 1.1) for (const y of [9.2, 10.4]) mesh(B(0.12, 0.45, 0.8), devDark, D.x0 - 0.02, y, z, group);
  const indMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(1.5) });
  for (let i = 0; i < 12; i++) mesh(B(0.14, 0.3, 0.5), i % 3 === 0 ? indMat : glowCyan, D.x0 - 0.03, 7.6, D.z0 + 1.2 + i * 2.2, group);
  // 装置の大きな目印の光
  const devLight = new THREE.PointLight(0xffa860, 160, 36, 1.5);
  devLight.position.set(D.x0 - 4, 7, dcz);
  lights.push(devLight);
  // 天井へ伸びる太い管
  for (const z of [-17, -3, 4]) mesh(new THREE.CylinderGeometry(0.6, 0.6, A.h - D.h - 0.8, 10), cableMat, D.x1 - 2.5, (A.h + D.h) / 2, z, group);

  // ---- ケーブル：モニターの壁・天井 → 装置へ（電気が流れ込む）
  const curves: THREE.CatmullRomCurve3[] = [];
  const laneZ = [A.z0 + K.depth + 0.3, A.z0 + K.depth + 0.9, A.z0 + K.depth + 1.5];
  [-26, -9, 7].forEach((sx, i) => {
    const it = INTAKES[i];
    curves.push(new THREE.CatmullRomCurve3([
      v3(sx, K.deskH * 0.4, A.z0 + K.depth), v3(sx, 0.22, laneZ[i]), v3(D.x0 - 3.5 + i, 0.22, laneZ[i]),
      v3(D.x0 - 3.2 + i, 0.22, it.z), v3(D.x0 - 2.0, it.y - 1.2, it.z), v3(D.x0 - 0.6, it.y, it.z),
    ], false, 'catmullrom', 0.2));
  });
  [-6, 8].forEach((sx, i) => {
    const zz = [-26, -23][i];
    curves.push(new THREE.CatmullRomCurve3([
      v3(sx - 8, A.h - 0.8, zz), v3(sx, A.h - 0.6, zz), v3(D.x0 - 2, A.h - 0.6, zz + 1), v3(dcx - 1, A.h - 3, zz + 6), v3(dcx + 1, D.h + 4.6, [-15, 1][i]),
    ], false, 'catmullrom', 0.2));
  });
  curves.push(new THREE.CatmullRomCurve3([
    v3(A.x0 + 1.5, 0.22, 0), v3(-10, 0.22, 27.4), v3(D.x0 - 3, 0.22, 27.4), v3(D.x0 - 1.5, 0.22, 11), v3(D.x0 - 0.5, 1.4, 7.5),
  ], false, 'catmullrom', 0.2));
  for (const cv of curves) {
    const tube = new THREE.Mesh(new THREE.TubeGeometry(cv, 80, 0.2, 8, false), cableMat);
    root.add(tube);
  }
  // 流れる電気の粒
  const PER = 16;
  const flowGeo = new THREE.SphereGeometry(0.27, 6, 4);
  const flowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9aeaff).multiplyScalar(1.6), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const flow = new THREE.InstancedMesh(flowGeo, flowMat, curves.length * PER);
  flow.frustumCulled = false;
  root.add(flow);
  // 吸い込み口に渦を巻いて吸われる粒
  const SW = 26;
  const swirlMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc070).multiplyScalar(1.6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const swirl = new THREE.InstancedMesh(new THREE.SphereGeometry(0.21, 6, 4), swirlMat, INTAKES.length * SW);
  swirl.frustumCulled = false;
  root.add(swirl);
  // 稲妻（装置の上 ⇔ 天井）
  const arcs: THREE.Line[] = [];
  for (let i = 0; i < 5; i++) {
    const geo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 14 }, () => v3(0, 0, 0)));
    const ln = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    ln.frustumCulled = false;
    root.add(ln);
    arcs.push(ln);
  }

  // ---- 床のがれき
  function makeRubble(): void {
    if (rubbleMade) return;
    rubbleMade = true;
    let a = 99;
    const r = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
    const mats = [std({ color: 0x5a5f6a, roughness: 0.9, flatShading: true }), std({ color: 0x3c414c, roughness: 0.9, flatShading: true })];
    for (let i = 0; i < 26; i++) {
      const s = 0.25 + r() * (i < 5 ? 1.3 : 0.7);
      const m = new THREE.Mesh(B(s * (1 + r()), s * 0.6, s * (1 + r())), mats[i % 2]);
      const ang = r() * Math.PI * 2, rad = 1 + r() * 7;
      m.position.set(HOLE.x + Math.cos(ang) * rad, s * 0.25, BOSS_LAND.z + Math.sin(ang) * rad);
      m.rotation.set((r() - 0.5) * 0.6, r() * 3, (r() - 0.5) * 0.6);
      rubble.add(m);
    }
  }

  const tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(1, 1, 1);
  const tmpM = new THREE.Matrix4();
  const ARC_SRC = [v3(D.x0 + 1, D.h + 9, -15), v3(D.x0 + 1, D.h + 9, -7), v3(D.x0 + 1, D.h + 9, 1), v3(D.x0 + 3, D.h + 3, -11), v3(D.x0 + 3, D.h + 3, -3)];

  const api: DrainBossVisuals = {
    root, colliders, lights,
    setDoor, doorCollider,
    setCrack(k: number) {
      crackK = Math.max(0, Math.min(1, k));
      crack.visible = crackK > 0 && !broken;
      crackMat.opacity = Math.min(1, crackK * 1.4);
      crack.scale.setScalar(0.3 + 0.7 * crackK);
    },
    breakTiles(immediate = false) {
      if (broken) return;
      broken = true;
      crack.visible = false;
      tiles.forEach((t, i) => {
        if (immediate) t.visible = false; else tileState[i] = true;
      });
      if (immediate) showRubble();
    },
    get tilesBroken() { return broken; },
    showRubble,
    update(t, dt) {
      // モニター：ちらつきと流れるスクロール
      screenMats.forEach((m, i) => {
        const f = 1.05 + 0.2 * Math.sin(t * (3 + i) + i * 2) + (Math.sin(t * 29 + i * 5) > 0.97 ? -0.4 : 0);
        m.color.setRGB(f, f, f);
        if (m.map) m.map.offset.y = (m.map.offset.y - dt * (0.05 + i * 0.02)) % 1;
      });
      // 流れる電気（装置へ）
      let idx = 0;
      curves.forEach((cv, ci) => {
        for (let i = 0; i < PER; i++) {
          const u = (i / PER + t * (0.22 + 0.04 * (ci % 3)) * (0.7 + 0.6 * api.suck)) % 1;
          cv.getPointAt(u, tmpP);
          const s = 0.8 + 0.5 * Math.sin(u * 40 + t * 8);
          tmpM.compose(tmpP, tmpQ, tmpS.set(s, s, s));
          flow.setMatrixAt(idx++, tmpM);
        }
      });
      flow.instanceMatrix.needsUpdate = true;
      // 吸い込み口の渦
      idx = 0;
      INTAKES.forEach((it, ii) => {
        for (let i = 0; i < SW; i++) {
          const u = (i / SW + t * (0.5 + 0.35 * api.suck)) % 1;       // 0=遠い 1=口
          const rad = 5.5 * (1 - u) * (1 - u);
          const ang = i * 2.4 + t * 4 + u * 9;
          tmpP.set(D.x0 - 0.4 - 7 * (1 - u) * (1 - u), it.y + Math.cos(ang) * rad, it.z + Math.sin(ang) * rad);
          const s = 0.5 + 1.1 * u;
          tmpM.compose(tmpP, tmpQ, tmpS.set(s, s, s));
          swirl.setMatrixAt(ii * SW + i, tmpM);
        }
      });
      swirl.instanceMatrix.needsUpdate = true;
      intakeRings.forEach((r, i) => { r.rotation.x += dt * (1.5 + i * 0.4) * (i % 2 ? -1 : 1); });
      intakeCores.forEach((c, i) => ((c.material as THREE.MeshBasicMaterial).color.setRGB(0.4 + 0.3 * Math.sin(t * 6 + i), 1.2 + 0.4 * Math.sin(t * 5 + i), 1.5)));
      rings.forEach((r, i) => ((r.material as THREE.MeshBasicMaterial).color.setScalar(0.9 + 0.5 * Math.sin(t * 5 - i * 0.7)).multiply(new THREE.Color(0x5ae0ff))));
      devLight.intensity = 150 + 40 * Math.sin(t * 4) + 60 * api.suck;
      // 稲妻
      arcs.forEach((ln, i) => {
        const on = Math.sin(t * 7 + i * 3.1) > 0.15;
        ln.visible = on;
        if (!on) return;
        const pos = ln.geometry.attributes.position as THREE.BufferAttribute;
        const a0 = ARC_SRC[i], a1 = tmpP.set(a0.x - 1 - i, A.h - 0.6, a0.z + (i % 2 ? 3 : -3));
        for (let k = 0; k < pos.count; k++) {
          const u = k / (pos.count - 1), amp = Math.sin(u * Math.PI) * 0.9;
          pos.setXYZ(k, a0.x + (a1.x - a0.x) * u + (Math.random() - 0.5) * amp, a0.y + (a1.y - a0.y) * u, a0.z + (a1.z - a0.z) * u + (Math.random() - 0.5) * amp);
        }
        pos.needsUpdate = true;
      });
      // 落ちる天井タイル
      tiles.forEach((tl, i) => {
        if (!tileState[i]) return;
        tileVel[i].y -= 24 * dt;
        tl.position.addScaledVector(tileVel[i], dt);
        tl.rotation.x += tileSpin[i].x * dt; tl.rotation.y += tileSpin[i].y * dt; tl.rotation.z += tileSpin[i].z * dt;
        if (tl.position.y < 0.5) { tileState[i] = false; tl.visible = false; }
      });
    },
    suck: 0.3,
    devicePos: v3(dcx, 6, dcz),
    tileCenters,
  };
  function showRubble(): void { makeRubble(); rubble.visible = true; }
  setDoor(0);
  return api;
}
