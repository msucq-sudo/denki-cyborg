// サージ収容所 1階の見た目（plan.ts の純データ → three のメッシュ・当たり判定）。
// 箱は材質ごとに Batch で1つのメッシュへ結合する。動く物（シャッター・ハッチ・脆い壁・レーザー網・電力源・キー・バキューム・歯車）は個別に作って返す。
import * as THREE from 'three';
import type { AABB } from '../../core/types';
import { createGearModel, type GearModel } from '../gear';
import { floorTex, hazardTex, makeSign, panelTex } from '../floor1/visuals';
import { Batch, rng } from '../surge/batch';
import { diagonalSpan, type Box, type GateDef, type Plan } from './plan';

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const aabb = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tag: string): AABB => ({ min: v3(x0, y0, z0), max: v3(x1, y1, z1), active: true, tag });

export interface GateVis { def: GateDef; shutter: THREE.Group; lampMat: THREE.MeshBasicMaterial; collider: AABB; k: number; open: boolean; cx: number; cz: number }
export interface SourceVis { id: string; core: THREE.MeshBasicMaterial; ring: THREE.Mesh; group: THREE.Group }
export interface SocketVis { ringMat: THREE.MeshBasicMaterial; lampMat: THREE.MeshBasicMaterial }
export interface PickVis { group: THREE.Group; x: number; y: number; z: number; taken: boolean }

export interface Camp1Visuals {
  root: THREE.Group;
  colliders: AABB[];
  /** C の部屋の発光物（電気を送るまで暗い） */
  glowC: THREE.MeshBasicMaterial;
  glow: THREE.MeshBasicMaterial;
  gates: GateVis[];
  hatch: { left: THREE.Group; right: THREE.Group; collider: AABB };
  brittle: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; cracks: THREE.Group[]; collider: AABB; glow: THREE.MeshBasicMaterial; debris: THREE.Group };
  laser: { group: THREE.Group; beamMat: THREE.MeshBasicMaterial; collider: AABB; machineLamps: THREE.MeshBasicMaterial[] };
  sources: SourceVis[];
  hatchSocket: SocketVis;
  cSocket: SocketVis;
  gears: (PickVis & { id: string; model: GearModel })[];
  keys: (PickVis & { id: 'B' | 'F' })[];
  vacuum: PickVis;
  checkpoints: { boss: THREE.MeshBasicMaterial };
  exitSign: THREE.Mesh;
}

const mapOf = (t: THREE.Texture | undefined): THREE.MeshStandardMaterialParameters => (t ? { map: t } : {});

export function buildCamp1Visuals(plan: Plan): Camp1Visuals {
  const root = new THREE.Group();
  root.name = 'camp1';
  const colliders: AABB[] = [];

  // ---------------------------------------------------------------- 材質
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, ...mapOf(panelTex()), roughness: 0.75, metalness: 0.15 });
  const floorMat = new THREE.MeshStandardMaterial({ vertexColors: true, ...mapOf(floorTex()), roughness: 0.85, metalness: 0.1 });
  const ceilMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.1 });
  const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.6 });
  const crateMat = new THREE.MeshStandardMaterial({ vertexColors: true, ...mapOf(panelTex()), roughness: 0.7, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
  const hz = hazardTex();
  const hazardMat = new THREE.MeshStandardMaterial({ vertexColors: true, ...mapOf(hz), roughness: 0.7 });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  glow.color.setScalar(1.4);
  const glowC = new THREE.MeshBasicMaterial({ vertexColors: true });
  glowC.color.setScalar(0.08);

  const batches: Record<string, { b: Batch; mat: THREE.Material; cast: boolean; uv: number }> = {
    wall: { b: new Batch(), mat: wallMat, cast: true, uv: 3 },
    floor: { b: new Batch(), mat: floorMat, cast: false, uv: 2.5 },
    ceil: { b: new Batch(), mat: ceilMat, cast: false, uv: 4 },
    metal: { b: new Batch(), mat: metalMat, cast: true, uv: 2 },
    crate: { b: new Batch(), mat: crateMat, cast: true, uv: 1.2 },
    dark: { b: new Batch(), mat: darkMat, cast: false, uv: 2 },
    hazard: { b: new Batch(), mat: hazardMat, cast: false, uv: 1.2 },
    glow: { b: new Batch(), mat: glow, cast: false, uv: 0 },
    glowC: { b: new Batch(), mat: glowC, cast: false, uv: 0 },
  };
  const put = (bx: Box): void => {
    if (bx.col) colliders.push(aabb(bx.x0, bx.x1, bx.y0, bx.y1, bx.z0, bx.z1, bx.tag ?? 'wall'));
    if (bx.m === 'hidden') return;
    const key = bx.m === 'glow' && bx.grp === 'C' ? 'glowC' : bx.m;
    const t = batches[key];
    t.b.box((bx.x0 + bx.x1) / 2, (bx.y0 + bx.y1) / 2, (bx.z0 + bx.z1) / 2, bx.x1 - bx.x0, bx.y1 - bx.y0, bx.z1 - bx.z0, bx.c, t.uv ? { tu: t.uv } : false);
  };
  for (const bx of plan.boxes) put(bx);

  // 円形の部屋の壁（見た目）
  for (const a of plan.arcs) {
    const len = a.a1 - a.a0;
    const seg = Math.max(4, Math.ceil((len * a.r) / 1.5));
    // three の円柱の角度 t は x=sin t, z=cos t。こちらの角度 a は x=cos a, z=sin a → t = π/2 - a
    const g = new THREE.CylinderGeometry(a.r, a.r, a.y1 - a.y0, seg, 1, true, Math.PI / 2 - a.a1, len);
    g.translate(a.cx, (a.y0 + a.y1) / 2, a.cz);
    const isGlow = a.y1 - a.y0 < 0.3;
    if (isGlow) batches.glow.b.add(g, a.c, false);
    else batches.wall.b.add(g, a.c, { tu: 3 });
  }
  // 斜め通路の見た目（傾けた壁と天井）
  {
    const d = diagonalSpan();
    const cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2;
    const ry = -Math.PI / 4;
    const u = Math.SQRT1_2;
    for (const off of [-2.75, 2.75]) {
      batches.wall.b.box(cx - off * u, 2.5, cz + off * u, d.len, 5, 1.1, 0x9aa1ab, { tu: 3 }, ry);
      batches.glow.b.box(cx - off * u * 0.97, 0.95, cz + off * u * 0.97, d.len, 0.1, 1.15, 0xff3a2a, false, ry);
    }
    batches.ceil.b.box(cx, 5.5, cz, d.len, 1, 6.6, 0x4a505a, { tu: 4 }, ry);
    for (let k = 0.15; k < 1; k += 0.25) batches.glow.b.box(d.x0 + (d.x1 - d.x0) * k, 4.97, d.z0 + (d.z1 - d.z0) * k, 1.2, 0.06, 0.4, 0xff8a6a, false, ry);
  }
  for (const [k, t] of Object.entries(batches)) {
    // 円柱の内側も見えるよう、壁は両面
    if (k === 'wall') (t.mat as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    const m = t.b.mesh(t.mat, { cast: t.cast, receive: k !== 'glow' && k !== 'glowC', name: `camp1-${k}` });
    if (m) root.add(m);
  }

  // ---------------------------------------------------------------- シャッター
  const gates: GateVis[] = plan.gates.map((def) => {
    const w = def.x1 - def.x0, d = def.z1 - def.z0;
    const shutter = new THREE.Group();
    const along = w >= d;
    const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.5, metalness: 0.5, emissive: def.id === 'key' ? 0x0a2a80 : 0x000000 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(along ? w : 0.4, def.h, along ? 0.4 : d), mat);
    body.position.y = def.h / 2;
    body.castShadow = true;
    shutter.add(body);
    // 横の溝
    const slat = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.color).multiplyScalar(0.6), roughness: 0.6 });
    for (let y = 0.6; y < def.h; y += 0.7) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(along ? w : 0.46, 0.08, along ? 0.46 : d), slat);
      s.position.y = y;
      shutter.add(s);
    }
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
    for (const side of [-1, 1]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(along ? 0.5 : 0.5, 0.5, 0.5), lampMat);
      l.position.set(along ? side * (w / 2 + 0.4) : 0, def.h + 0.4, along ? 0 : side * (d / 2 + 0.4));
      shutter.add(l);
    }
    if (def.id === 'key') {
      // 青いキー扉：鍵穴のマーク
      const mk = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 0.5), new THREE.MeshBasicMaterial({ color: 0x8ad0ff }));
      mk.position.y = def.h / 2;
      shutter.add(mk);
    }
    const cx = (def.x0 + def.x1) / 2, cz = (def.z0 + def.z1) / 2;
    const holder = new THREE.Group();
    holder.position.set(cx, 0, cz);
    holder.add(shutter);
    root.add(holder);
    const collider = aabb(def.x0, def.x1, 0, def.h, def.z0, def.z1, `gate:${def.id}`);
    colliders.push(collider);
    return { def, shutter, lampMat, collider, k: 0, open: false, cx, cz };
  });

  // ---------------------------------------------------------------- A の床のハッチ
  const H = plan.hatch;
  const hatchMat = new THREE.MeshStandardMaterial({ color: 0x59636f, roughness: 0.5, metalness: 0.6 });
  const mkFlap = (x: number, w: number, dir: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.02, (H.z0 + H.z1) / 2);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, H.z1 - H.z0), hatchMat);
    m.position.x = (dir * w) / 2;
    m.castShadow = true;
    pivot.add(m);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.12, 0.2), new THREE.MeshBasicMaterial({ color: 0xffc21a }));
    stripe.position.x = (dir * w) / 2;
    pivot.add(stripe);
    root.add(pivot);
    return pivot;
  };
  const hw = (H.x1 - H.x0) / 2;
  const hatch = { left: mkFlap(H.x0, hw, 1), right: mkFlap(H.x1, hw, -1), collider: aabb(H.x0, H.x1, -0.2, 0, H.z0, H.z1, 'hatch') };
  colliders.push(hatch.collider);

  // ---------------------------------------------------------------- J の脆い壁（ひびが段階的に広がる）
  const B = plan.brittle;
  const brittleMat = new THREE.MeshStandardMaterial({ color: 0xb6b0a6, ...mapOf(panelTex()), roughness: 0.95, metalness: 0.02 });
  const bMesh = new THREE.Mesh(new THREE.BoxGeometry(B.x1 - B.x0, B.y1 - B.y0, B.z1 - B.z0), brittleMat);
  bMesh.position.set((B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2, (B.z0 + B.z1) / 2);
  bMesh.castShadow = bMesh.receiveShadow = true;
  root.add(bMesh);
  const crackMat = new THREE.MeshBasicMaterial({ color: 0x1a1410 });
  const crackGlow = new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, opacity: 0 });
  const cracks: THREE.Group[] = [];
  {
    const rand = rng(77);
    const fx = B.x0 - 0.02; // 西の面（C の側）
    const cz = (B.z0 + B.z1) / 2, cy = 1.6;
    // 段階ごとに、中心から外へ枝分かれする線を増やす
    let tips: { y: number; z: number; a: number }[] = [];
    for (let i = 0; i < 6; i++) tips.push({ y: cy, z: cz, a: (i / 6) * Math.PI * 2 + rand() * 0.5 });
    for (let st = 0; st < 4; st++) {
      const g = new THREE.Group();
      g.visible = false;
      const next: typeof tips = [];
      for (const t of tips) {
        const len = 0.5 + rand() * 0.6 + st * 0.15;
        const a = t.a + (rand() - 0.5) * 0.7;
        const y2 = Math.max(0.1, Math.min(B.y1 - 0.1, t.y + Math.sin(a) * len));
        const z2 = Math.max(B.z0 + 0.1, Math.min(B.z1 - 0.1, t.z + Math.cos(a) * len));
        const L = Math.hypot(y2 - t.y, z2 - t.z);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06 + st * 0.012, L + 0.04), crackMat);
        seg.position.set(fx, (t.y + y2) / 2, (t.z + z2) / 2);
        seg.rotation.x = -Math.atan2(y2 - t.y, z2 - t.z);
        g.add(seg);
        const glowSeg = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12 + st * 0.02, L + 0.1), crackGlow);
        glowSeg.position.set(fx - 0.01, seg.position.y, seg.position.z);
        glowSeg.rotation.x = seg.rotation.x;
        g.add(glowSeg);
        next.push({ y: y2, z: z2, a });
        if (rand() < 0.55) next.push({ y: y2, z: z2, a: a + (rand() < 0.5 ? 0.9 : -0.9) });
      }
      tips = next.slice(0, 18);
      root.add(g);
      cracks.push(g);
    }
  }
  const brittleCol = aabb(B.x0, B.x1, B.y0, B.y1, B.z0, B.z1, 'brittle');
  colliders.push(brittleCol);
  const debris = new THREE.Group();
  {
    const rand = rng(91);
    const dm = new THREE.MeshStandardMaterial({ color: 0x9c968c, roughness: 0.95 });
    for (let i = 0; i < 14; i++) {
      const s = 0.25 + rand() * 0.45;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.6, s), dm);
      m.position.set(B.x0 - 0.5 - rand() * 2.2, s * 0.3, B.z0 + 0.4 + rand() * (B.z1 - B.z0 - 0.8));
      m.rotation.set(rand(), rand() * 3, rand());
      debris.add(m);
    }
    debris.visible = false;
    root.add(debris);
  }

  // ---------------------------------------------------------------- レーザー網と機械
  const L = plan.laser;
  const laserGroup = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  {
    const dx = L.bx - L.ax, dz = L.bz - L.az, len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const mk = (y: number, tilt: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 6), beamMat);
      m.rotation.order = 'YXZ';
      m.rotation.set(Math.PI / 2, yaw, tilt);
      m.position.set((L.ax + L.bx) / 2, y, (L.az + L.bz) / 2);
      laserGroup.add(m);
    };
    for (let y = 0.4; y < 4.8; y += 0.55) mk(y, 0);
    // 斜めの網目
    for (let y = 1.0; y < 4.4; y += 1.1) { mk(y, 0.5); mk(y, -0.5); }
  }
  root.add(laserGroup);
  const machineLamps: THREE.MeshBasicMaterial[] = [];
  for (const mc of L.machines) {
    const g = new THREE.Group();
    g.position.set(mc.x, 0, mc.z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 5, 0.9), new THREE.MeshStandardMaterial({ color: 0x3a414c, metalness: 0.6, roughness: 0.4 }));
    body.position.y = 2.5;
    body.rotation.y = Math.PI / 4;
    g.add(body);
    const lm = new THREE.MeshBasicMaterial({ color: 0xff3020 });
    for (let y = 0.4; y < 4.8; y += 0.55) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.3), lm);
      e.position.y = y;
      g.add(e);
    }
    machineLamps.push(lm);
    root.add(g);
  }
  const laserCol = aabb(L.box.x0, L.box.x1, 0, L.box.y1, L.box.z0, L.box.z1, 'laser');
  colliders.push(laserCol);

  // ---------------------------------------------------------------- 電力源
  const sources: SourceVis[] = plan.sources.map((s) => {
    const g = new THREE.Group();
    g.position.set(s.x, s.y, s.z);
    const core = new THREE.MeshBasicMaterial({ color: s.laser ? 0xff6a3a : 0x52e8ff });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(s.r * 0.55, 16, 12), core);
    g.add(ball);
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.8, s.r * 0.8, s.r * 1.6, 10, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x59636f, metalness: 0.7, roughness: 0.4, wireframe: true }));
    g.add(cage);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(s.r * 0.95, 0.06, 6, 24), core);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    root.add(g);
    return { id: s.id, core, ring, group: g };
  });

  // ---------------------------------------------------------------- 送電ソケット（A のハッチ用・C の照明用）
  const mkSocket = (p: { x: number; y: number; z: number; r: number }, faceX: number): SocketVis => {
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x52e8ff });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xe0503c });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(p.r * 0.7, 0.08, 8, 24), ringMat);
    ring.rotation.y = Math.PI / 2;
    g.add(ring);
    const core = new THREE.Mesh(new THREE.SphereGeometry(p.r * 0.35, 12, 8), ringMat);
    g.add(core);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.6), lampMat);
    lamp.position.set(faceX * 0.05, 1.1, 0);
    g.add(lamp);
    root.add(g);
    return { ringMat, lampMat };
  };
  const hatchSocket = mkSocket(plan.hatchSocket, 1);
  const cSocket = mkSocket(plan.cSocket, 1);

  // ---------------------------------------------------------------- 歯車・キー・バキューム
  const gears = plan.gears.map((gd) => {
    const model = createGearModel();
    model.position.set(gd.x, gd.y, gd.z);
    root.add(model);
    return { id: gd.id, model, group: model as THREE.Group, x: gd.x, y: gd.y, z: gd.z, taken: false };
  });
  const keys = plan.keys.map((k) => {
    const g = new THREE.Group();
    g.position.set(k.x, k.y, k.z);
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.36, 0.05), new THREE.MeshStandardMaterial({ color: 0x2f7dff, emissive: 0x1a4cff, emissiveIntensity: 1.2, metalness: 0.3, roughness: 0.3 }));
    g.add(card);
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.06), new THREE.MeshBasicMaterial({ color: 0xfff27a }));
    chip.position.set(-0.14, 0.04, 0.01);
    g.add(chip);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 6, 24), new THREE.MeshBasicMaterial({ color: 0x8ad0ff, transparent: true, opacity: 0.8 }));
    g.add(halo);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 5, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x6aa8ff, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.y = 2.4;
    g.add(beam);
    root.add(g);
    return { id: k.id, group: g, x: k.x, y: k.y, z: k.z, taken: false };
  });
  const vacuum = (() => {
    const V = plan.vacuum;
    const g = new THREE.Group();
    g.position.set(V.x, V.y, V.z);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.7, 16), new THREE.MeshStandardMaterial({ color: 0xeef2f6, metalness: 0.4, roughness: 0.3 }));
    g.add(body);
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.2, 0.3, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x52e8ff, emissive: 0x1a8ab0, emissiveIntensity: 1.2, side: THREE.DoubleSide }));
    funnel.position.y = 0.5;
    g.add(funnel);
    for (const y of [-0.15, 0.15]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.04, 6, 24), new THREE.MeshBasicMaterial({ color: 0x7af0ff }));
      r.rotation.x = Math.PI / 2;
      r.position.y = y;
      g.add(r);
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.5, 6, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x7af0ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.y = 2.6;
    g.add(beam);
    root.add(g);
    return { group: g, x: V.x, y: V.y, z: V.z, taken: false };
  })();

  // ---------------------------------------------------------------- チェックポイントの印・看板
  const cpMat = new THREE.MeshBasicMaterial({ color: 0x3dff7a, transparent: true, opacity: 0.35, depthWrite: false });
  for (const [id, c] of Object.entries(plan.checkpoints)) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.2, 32), id === 'boss' ? cpMat : cpMat.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(c.x, 0.03, c.z);
    root.add(ring);
  }
  const signs: [string, 'cyan' | 'red' | 'green', number, number, number, number][] = [
    ['A 入口ホール', 'cyan', 20, 6.2, 56.1, 0],
    ['セキュリティ扉', 'cyan', 92.5, 6.6, 58.1, 0],
    ['C 配電室', 'cyan', 85, 6.2, 76.0 - 0.1, Math.PI],
    ['H 大ホール', 'red', 96, 8.4, 32.1, 0],
    ['E 円形ホール', 'cyan', 20, 5.0, 31.3, 0],
  ];
  for (const [text, theme, x, y, z, ry] of signs) {
    const s = makeSign(text, theme, 5);
    s.position.set(x, y, z);
    s.rotation.y = ry;
    root.add(s);
  }
  const exitSign = makeSign('2F ↑ 出口', 'red', 4);
  exitSign.position.set(106, 6.2, 3.1);
  root.add(exitSign);

  return {
    root, colliders, glow, glowC, gates, hatch,
    brittle: { mesh: bMesh, mat: brittleMat, cracks, collider: brittleCol, glow: crackGlow, debris },
    laser: { group: laserGroup, beamMat, collider: laserCol, machineLamps },
    sources, hatchSocket, cSocket, gears, keys, vacuum,
    checkpoints: { boss: cpMat },
    exitSign,
  };
}
