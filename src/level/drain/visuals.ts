// 「ドレイン装置へ向かうダンジョン」の見た目（plan.ts の純データ → three のメッシュ・当たり判定）。
// 箱・円柱は材質ごとに Batch で1つのメッシュへ結合する。動く物（シャッター・壊せるブロック・レーザー・セキュリティ装置・動く足場・拾う物）は個別に作って返す。
import * as THREE from 'three';
import type { AABB } from '../../core/types';
import { buildDecoyPickup } from '../../abilities/decoy';
import { floorTex, hazardTex, makeSign, panelTex } from '../floor1/visuals';
import { Batch, rng } from '../surge/batch';
import { addPreCracks, tintDamaged } from '../preCrack';
import { B_Y, LASER_X, PLATFORM_THICK, type BreakableDef, type GateDef, type Mat, type MovingPlatform, type Plan, type SecurityDef } from './plan';

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const aabb = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tag: string): AABB => ({ min: v3(x0, y0, z0), max: v3(x1, y1, z1), active: true, tag });

export interface GateVis { def: GateDef; shutter: THREE.Group; lampMat: THREE.MeshBasicMaterial; collider: AABB; k: number; open: boolean; cx: number; cz: number }
export interface BreakVis { def: BreakableDef; mesh: THREE.Mesh; cracks: THREE.Group[]; collider: AABB; glow: THREE.MeshBasicMaterial; debris: THREE.Group }
export interface DeviceVis { id: string; core: THREE.MeshBasicMaterial; ring: THREE.Mesh; group: THREE.Group; light: THREE.PointLight }
export interface PlatformVis { def: MovingPlatform; mesh: THREE.Group; collider: AABB; x: number; z: number; dx: number; dz: number }

export interface DrainVisuals {
  root: THREE.Group;
  colliders: AABB[];
  glow: THREE.MeshBasicMaterial;
  gates: GateVis[];
  breakables: BreakVis[];
  laser: { group: THREE.Group; beamMat: THREE.MeshBasicMaterial; collider: AABB; machineLamps: THREE.MeshBasicMaterial[] };
  securities: DeviceVis[];
  mainPower: DeviceVis;
  platforms: PlatformVis[];
  decoy: { group: THREE.Group; x: number; y: number; z: number; taken: boolean };
  doorGlow: THREE.MeshBasicMaterial;
  checkpoints: Record<string, THREE.MeshBasicMaterial>;
}

const mapOf = (t: THREE.Texture | undefined): THREE.MeshStandardMaterialParameters => (t ? { map: t } : {});

export function buildDrainVisuals(plan: Plan): DrainVisuals {
  const root = new THREE.Group();
  root.name = 'drain';
  const colliders: AABB[] = [];

  // ---------------------------------------------------------------- 材質（全体に暗い）
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, ...mapOf(panelTex()), roughness: 0.8, metalness: 0.2 });
  const floorMat = new THREE.MeshStandardMaterial({ vertexColors: true, ...mapOf(floorTex()), roughness: 0.9, metalness: 0.1 });
  const ceilMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.1 });
  const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.65 });
  const darkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
  const pipeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.7 });
  const tankMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.75 });
  const ropeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.3 });
  const hz = hazardTex();
  const hazardMat = new THREE.MeshStandardMaterial({ vertexColors: true, ...mapOf(hz), roughness: 0.7 });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  glow.color.setScalar(1.3);

  const batches: Record<Exclude<Mat, 'hidden'>, { b: Batch; mat: THREE.Material; cast: boolean; uv: number }> = {
    wall: { b: new Batch(), mat: wallMat, cast: true, uv: 3 },
    floor: { b: new Batch(), mat: floorMat, cast: false, uv: 2.5 },
    ceil: { b: new Batch(), mat: ceilMat, cast: false, uv: 4 },
    metal: { b: new Batch(), mat: metalMat, cast: true, uv: 2 },
    dark: { b: new Batch(), mat: darkMat, cast: false, uv: 2 },
    hazard: { b: new Batch(), mat: hazardMat, cast: false, uv: 1.2 },
    glow: { b: new Batch(), mat: glow, cast: false, uv: 0 },
    pipe: { b: new Batch(), mat: pipeMat, cast: true, uv: 0 },
    tank: { b: new Batch(), mat: tankMat, cast: true, uv: 0 },
    rope: { b: new Batch(), mat: ropeMat, cast: false, uv: 0 },
  };
  for (const bx of plan.boxes) {
    if (bx.col) colliders.push(aabb(bx.x0, bx.x1, bx.y0, bx.y1, bx.z0, bx.z1, bx.tag ?? 'wall'));
    if (bx.m === 'hidden') continue;
    const t = batches[bx.m];
    t.b.box((bx.x0 + bx.x1) / 2, (bx.y0 + bx.y1) / 2, (bx.z0 + bx.z1) / 2, bx.x1 - bx.x0, bx.y1 - bx.y0, bx.z1 - bx.z0, bx.c, t.uv ? { tu: t.uv } : false);
  }
  for (const c of plan.cyls) {
    if (c.m === 'hidden') continue;
    const t = batches[c.m];
    const rx = c.axis === 'z' ? Math.PI / 2 : 0, rz = c.axis === 'x' ? Math.PI / 2 : 0;
    t.b.cyl(c.cx, c.cy, c.cz, c.r, c.len, c.c, 10, false, undefined, 0, rx, rz);
    if (c.col) {
      const hx = c.axis === 'x' ? c.len / 2 : c.r, hy = c.axis === 'y' ? c.len / 2 : c.r, hz2 = c.axis === 'z' ? c.len / 2 : c.r;
      colliders.push(aabb(c.cx - hx, c.cx + hx, c.cy - hy, c.cy + hy, c.cz - hz2, c.cz + hz2, 'machine'));
    }
  }
  // ロープ：支え綱（見た目）
  {
    const rp = batches.rope.b;
    for (const z of [19.2, 20.8]) rp.box(37.5, B_Y + 0.9, z, 25, 0.06, 0.06, 0x4a4f58, false);
    for (let x = 27; x < 50; x += 3) {
      rp.box(x, B_Y + 0.45, 19.2, 0.05, 0.9, 0.05, 0x4a4f58, false);
      rp.box(x, B_Y + 0.45, 20.8, 0.05, 0.9, 0.05, 0x4a4f58, false);
    }
    for (let x = 26; x < 50; x += 2.4) batches.glow.b.box(x, B_Y + 0.01, 20, 0.5, 0.02, 0.16, 0x7a5a20, false);
  }
  for (const [k, t] of Object.entries(batches)) {
    const m = t.b.mesh(t.mat, { cast: t.cast, receive: k !== 'glow', name: `drain-${k}` });
    if (m) root.add(m);
  }

  // ---------------------------------------------------------------- 底なしの穴（見た目だけ：とても暗い床と赤い警告の格子）
  {
    const dm = new THREE.MeshBasicMaterial({ color: 0x07090c });
    for (const p of plan.pits) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(p.x1 - p.x0, p.z1 - p.z0), dm);
      m.rotation.x = -Math.PI / 2;
      m.position.set((p.x0 + p.x1) / 2, -14, (p.z0 + p.z1) / 2);
      root.add(m);
    }
    const lineMat = new THREE.LineBasicMaterial({ color: 0x5a1410, transparent: true, opacity: 0.8 });
    const pts: number[] = [];
    const h = plan.pits[0];
    for (let x = h.x0 + 2; x < h.x1; x += 4) pts.push(x, -13.9, h.z0, x, -13.9, h.z1);
    for (let z = h.z0 + 2; z < h.z1; z += 4) pts.push(h.x0, -13.9, z, h.x1, -13.9, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    root.add(new THREE.LineSegments(g, lineMat));
  }

  // ---------------------------------------------------------------- シャッター
  const gates: GateVis[] = plan.gates.map((def) => {
    const w = def.x1 - def.x0, d = def.z1 - def.z0;
    const shutter = new THREE.Group();
    const along = w >= d;
    const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.5, metalness: 0.5, emissive: def.id === 'gDoor' ? 0x0a2a80 : 0x200404 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(along ? w : 0.4, def.h, along ? 0.4 : d), mat);
    body.position.y = def.h / 2;
    body.castShadow = true;
    shutter.add(body);
    const slat = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.color).multiplyScalar(0.6), roughness: 0.6 });
    for (let y = 0.6; y < def.h; y += 0.7) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(along ? w : 0.46, 0.08, along ? 0.46 : d), slat);
      s.position.y = y;
      shutter.add(s);
    }
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
    for (const side of [-1, 1]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), lampMat);
      l.position.set(along ? side * (w / 2 + 0.4) : 0, def.h + 0.4, along ? 0 : side * (d / 2 + 0.4));
      shutter.add(l);
    }
    if (def.id === 'gDoor') {
      // セキュリティ扉：3つのランプ（装置を止めるたびに点く）
      const mk = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.5), new THREE.MeshBasicMaterial({ color: 0x8ad0ff }));
      mk.position.y = def.h / 2;
      shutter.add(mk);
    }
    const cx = (def.x0 + def.x1) / 2, cz = (def.z0 + def.z1) / 2;
    const holder = new THREE.Group();
    holder.position.set(cx, def.y0, cz);
    holder.add(shutter);
    root.add(holder);
    const collider = aabb(def.x0, def.x1, def.y0, def.y0 + def.h, def.z0, def.z1, `gate:${def.id}`);
    colliders.push(collider);
    return { def, shutter, lampMat, collider, k: 0, open: false, cx, cz };
  });

  // ---------------------------------------------------------------- 壊せるブロック（ひびが段階的に広がる）
  const breakables: BreakVis[] = plan.breakables.map((B, bi) => {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a8478, ...mapOf(panelTex()), roughness: 0.95, metalness: 0.02 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(B.x1 - B.x0, B.y1 - B.y0, B.z1 - B.z0), mat);
    mesh.position.set((B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2, (B.z0 + B.z1) / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    // 最初から割れている見た目（普通の壁と区別がつく）。mesh の子なので壊れれば一緒に消える
    tintDamaged(mat);
    addPreCracks(mesh, new THREE.Vector3(B.x1 - B.x0, B.y1 - B.y0, B.z1 - B.z0), B.face, 301 + bi * 17);
    const crackMat = new THREE.MeshBasicMaterial({ color: 0x120e0a });
    const crackGlow = new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, opacity: 0 });
    const cracks: THREE.Group[] = [];
    const rand = rng(77 + bi * 13);
    // ひびを刻む面（face の向き）。面上の座標 (u: 横, v: 縦)
    const nz = B.face === '+z' || B.face === '-z';
    const sgn = B.face[0] === '+' ? 1 : -1;
    const fx = nz ? 0 : (sgn > 0 ? B.x1 : B.x0) + sgn * 0.02;
    const fz = nz ? (sgn > 0 ? B.z1 : B.z0) + sgn * 0.02 : 0;
    const u0 = nz ? B.x0 : B.z0, u1 = nz ? B.x1 : B.z1;
    const cu = (u0 + u1) / 2, cv = (B.y0 + B.y1) / 2;
    let tips: { v: number; u: number; a: number }[] = [];
    for (let i = 0; i < 6; i++) tips.push({ v: cv, u: cu, a: (i / 6) * Math.PI * 2 + rand() * 0.5 });
    for (let st = 0; st < 4; st++) {
      const g = new THREE.Group();
      g.visible = false;
      const next: typeof tips = [];
      for (const t of tips) {
        const len = 0.4 + rand() * 0.5 + st * 0.12;
        const a = t.a + (rand() - 0.5) * 0.7;
        const v2 = Math.max(B.y0 + 0.1, Math.min(B.y1 - 0.1, t.v + Math.sin(a) * len));
        const u2 = Math.max(u0 + 0.1, Math.min(u1 - 0.1, t.u + Math.cos(a) * len));
        const L = Math.hypot(v2 - t.v, u2 - t.u);
        const mkSeg = (m: THREE.Material, thick: number, extra: number, off: number) => {
          const geo = nz ? new THREE.BoxGeometry(L + extra, thick, 0.03) : new THREE.BoxGeometry(0.03, thick, L + extra);
          const seg = new THREE.Mesh(geo, m);
          const uc = (t.u + u2) / 2, vc = (t.v + v2) / 2;
          if (nz) { seg.position.set(uc, vc, fz + sgn * off); seg.rotation.z = Math.atan2(v2 - t.v, u2 - t.u); }
          else { seg.position.set(fx + sgn * off, vc, uc); seg.rotation.x = -Math.atan2(v2 - t.v, u2 - t.u); }
          g.add(seg);
        };
        mkSeg(crackMat, 0.06 + st * 0.012, 0.04, 0);
        mkSeg(crackGlow, 0.12 + st * 0.02, 0.1, 0.01);
        next.push({ v: v2, u: u2, a });
        if (rand() < 0.55) next.push({ v: v2, u: u2, a: a + (rand() < 0.5 ? 0.9 : -0.9) });
      }
      tips = next.slice(0, 18);
      root.add(g);
      cracks.push(g);
    }
    const collider = aabb(B.x0, B.x1, B.y0, B.y1, B.z0, B.z1, `breakable:${B.id}`);
    colliders.push(collider);
    const debris = new THREE.Group();
    {
      const dm = new THREE.MeshStandardMaterial({ color: 0x9c968c, roughness: 0.95 });
      for (let i = 0; i < 12; i++) {
        const s = 0.22 + rand() * 0.4;
        const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.6, s), dm);
        const spread = 1.2 + rand() * 1.6;
        m.position.set(nz ? B.x0 + rand() * (B.x1 - B.x0) : cu + sgn * spread, s * 0.3 + Math.max(0, B.y0), nz ? fz + sgn * spread : B.z0 + rand() * (B.z1 - B.z0));
        m.rotation.set(rand(), rand() * 3, rand());
        debris.add(m);
      }
      debris.visible = false;
      root.add(debris);
    }
    return { def: B, mesh, cracks, collider, glow: crackGlow, debris };
  });

  // ---------------------------------------------------------------- レーザーと装置
  const L = plan.laser;
  const laserGroup = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  {
    const len = L.z1 - L.z0;
    const mk = (y: number, tilt: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 6), beamMat);
      m.rotation.order = 'YXZ';
      m.rotation.set(Math.PI / 2, 0, tilt);
      m.position.set(LASER_X, y, (L.z0 + L.z1) / 2);
      laserGroup.add(m);
    };
    for (let y = 0.35; y < L.y1 - 0.2; y += 0.5) mk(y, 0);
  }
  root.add(laserGroup);
  const machineLamps: THREE.MeshBasicMaterial[] = [];
  for (const mc of L.machines) {
    const g = new THREE.Group();
    g.position.set(mc.x, 0, mc.z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, L.y1, 1.0), new THREE.MeshStandardMaterial({ color: 0x3a414c, metalness: 0.6, roughness: 0.4 }));
    body.position.y = L.y1 / 2;
    g.add(body);
    const lm = new THREE.MeshBasicMaterial({ color: 0xff3020 });
    for (let y = 0.35; y < L.y1 - 0.2; y += 0.5) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.34), lm);
      e.position.y = y;
      g.add(e);
    }
    machineLamps.push(lm);
    root.add(g);
  }
  const laserCol = aabb(L.x0, L.x1, 0, L.y1, L.z0, L.z1, 'laser');
  colliders.push(laserCol);

  // ---------------------------------------------------------------- セキュリティ装置・主電源
  const mkDevice = (id: string, s: { x: number; y: number; z: number; r: number }, color: number, label: string): DeviceVis => {
    const g = new THREE.Group();
    g.position.set(s.x, s.y, s.z);
    // 台座の筐体
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 1.5), new THREE.MeshStandardMaterial({ color: 0x2f3844, metalness: 0.7, roughness: 0.4 }));
    base.position.y = -0.95;
    g.add(base);
    const core = new THREE.MeshBasicMaterial({ color });
    g.add(new THREE.Mesh(new THREE.SphereGeometry(s.r * 0.5, 16, 12), core));
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.8, s.r * 0.8, s.r * 1.6, 10, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x59636f, metalness: 0.7, roughness: 0.4, wireframe: true }));
    g.add(cage);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(s.r * 0.95, 0.06, 6, 24), core);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    void label;
    const light = new THREE.PointLight(color, 6, 7, 2);
    light.position.y = 0.4;
    g.add(light);
    root.add(g);
    return { id, core, ring, group: g, light };
  };
  const secColors: Record<SecurityDef['id'], string> = { I: 'SEC-I', D: 'SEC-D', F: 'SEC-F' };
  const securities = plan.securities.map((s) => mkDevice(s.id, s, 0xff5a3a, secColors[s.id]));
  const mainPower = mkDevice('main', plan.mainPower, 0xffc21a, 'MAIN');

  // ---------------------------------------------------------------- 動く足場
  const platforms: PlatformVis[] = plan.platforms.map((def) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(def.sx, PLATFORM_THICK, def.sz), new THREE.MeshStandardMaterial({ color: 0x59636f, metalness: 0.7, roughness: 0.4 }));
    body.position.y = -PLATFORM_THICK / 2;
    body.castShadow = true;
    g.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(def.sx - 0.4, 0.04, def.sz - 0.4), new THREE.MeshBasicMaterial({ color: 0xffb040 }));
    top.position.y = 0.01;
    g.add(top);
    const hz3 = new THREE.Mesh(new THREE.BoxGeometry(def.sx + 0.05, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xffc21a }));
    hz3.position.set(0, -0.3, def.sz / 2);
    g.add(hz3);
    g.position.set(def.x, def.y, def.z);
    root.add(g);
    const collider = aabb(def.x - def.sx / 2, def.x + def.sx / 2, def.y - PLATFORM_THICK, def.y, def.z - def.sz / 2, def.z + def.sz / 2, 'platform:move');
    colliders.push(collider);
    return { def, mesh: g, collider, x: def.x, z: def.z, dx: 0, dz: 0 };
  });

  // ---------------------------------------------------------------- ホログラムデコイ（A の地下）
  const decoyG = buildDecoyPickup();
  decoyG.position.set(plan.decoy.x, plan.decoy.y, plan.decoy.z);
  root.add(decoyG);
  const decoy = { group: decoyG, x: plan.decoy.x, y: plan.decoy.y, z: plan.decoy.z, taken: false };

  // ---------------------------------------------------------------- チェックポイントの印・看板
  const checkpoints: Record<string, THREE.MeshBasicMaterial> = {};
  for (const [id, c] of Object.entries(plan.checkpoints)) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x3dff7a, transparent: true, opacity: id === 'entrance' ? 0.6 : 0.25, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.2, 32), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(c.x, c.y + 0.03, c.z);
    root.add(ring);
    checkpoints[id] = mat;
  }
  const signs: [string, 'cyan' | 'red' | 'green', number, number, number, number][] = [
    ['A 入口ホール', 'cyan', 17, 8, 90 - 0.1, Math.PI],
    ['C 配電室', 'cyan', 55, 5.6, 89.9, Math.PI],
    ['D 動力室', 'red', 100, 7, 89.9, Math.PI],
    ['E 暗い長廊下', 'cyan', 55, 4.8, 41.2, 0],
    ['G ドレイン装置前室', 'green', 55, 5.8, 39.9, Math.PI],
    ['F 冷却ポンプ室', 'cyan', 126, 6.4, 12.2, 0],
  ];
  for (const [text, theme, x, y, z, ry] of signs) {
    const s = makeSign(text, theme, 5);
    s.position.set(x, y, z);
    s.rotation.y = ry;
    root.add(s);
  }
  // ドレイン装置の扉の看板と光
  const doorGlow = new THREE.MeshBasicMaterial({ color: 0xff6a3a });
  {
    const d = plan.drainDoor;
    const s = makeSign('ドレイン装置', 'red', 5);
    s.position.set(d.x, 8.2, 14.45);
    root.add(s);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.08, 6, 32), doorGlow);
    ring.position.set(d.x, 3.2, 14.55);
    root.add(ring);
  }

  return { root, colliders, glow, gates, breakables, laser: { group: laserGroup, beamMat, collider: laserCol, machineLamps }, securities, mainPower, platforms, decoy, doorGlow, checkpoints };
}

