// サージ収容所：道をふさぐ金属の柵、柵の向こうの庭、巨大な建物の壁（東向き）。T字路の東の端の柵（通行止め）もここで作る。
import * as THREE from 'three';
import type { AABB } from '../../core/types';
import { hazardTex } from '../floor1/visuals';
import { Batch, rng } from './batch';
import { COMPOUND, ROAD } from './layout';
import { beamTex, compoundWallTex, fenceTex, groundTex, signTex } from './textures';

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const col = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tag: string): AABB => ({ min: v3(x0, y0, z0), max: v3(x1, y1, z1), active: true, tag });

/** 柵の高さ */
export const FENCE_H = 9;

export interface CompoundParts {
  root: THREE.Group;
  colliders: AABB[];
  /** 道をふさぐ金属の柵全体（柱・網・有刺鉄線・門柱） */
  fence: THREE.Group;
  /** 道の幅の部分の柵のパネル（1枚 3m）。突き破るときに動かす／飛ばす。原点はパネルの足元中央、パネルの面は YZ 平面 */
  fencePanels: THREE.Object3D[];
  /** 柵の当たり判定（突き破ったら active=false） */
  fenceCollider: AABB;
  /** 建物の壁：東向きの平面。ジオメトリは rotateY(π/2) 済みでローカルの x が壁の外向き、z が横方向（-z 側が +z 方向…対称）、y が上（-35..35）。mesh.position=(wallX, 35, 壁の中心z) */
  wall: THREE.Mesh;
  /** 壁・建物・屋上の設備・看板をまとめたもの（wall もこの子） */
  building: THREE.Group;
  /** T字路の東の端の柵 */
  eastCollider: AABB;
  /** 毎フレームの演出（サーチライトなど） */
  update(t: number): void;
}

/**
 * 壁を凹ませる。hit はワールド座標の衝突点。radius の範囲を深さ depth（m）まで滑らかに西へ押し込む（何度呼んでも重ねて凹む）
 */
export function dentWall(wall: THREE.Mesh, hit: THREE.Vector3, radius: number, depth: number): void {
  const g = wall.geometry as THREE.BufferGeometry;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const off = wall.position;
  for (let i = 0; i < pos.count; i++) {
    const wy = pos.getY(i) + off.y, wz = pos.getZ(i) + off.z;
    const d = Math.hypot(wz - hit.z, wy - hit.y);
    if (d >= radius) continue;
    const k = (Math.cos((Math.PI * d) / radius) + 1) / 2;
    pos.setX(i, pos.getX(i) - depth * k);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
}

export function buildCompound(): CompoundParts {
  const root = new THREE.Group();
  root.name = 'surgeCompound';
  const colliders: AABB[] = [];
  const jz = ROAD.junctionZ, hw = ROAD.width / 2;
  const fx = COMPOUND.fenceX, wx = COMPOUND.wallX;
  const zN = jz - COMPOUND.fenceHalf, zS = jz + COMPOUND.fenceHalf;   // 柵の北端・南端
  const rand = rng(404);

  const fT = fenceTex();
  const meshMat = new THREE.MeshStandardMaterial({ ...(fT ? { map: fT } : { color: 0x99a3ae }), color: 0xc4ced8, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
  const frameMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.65 });
  const concreteMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.05 });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  glowMat.color.setScalar(1.6);
  const hz = hazardTex();
  const hazardMat = new THREE.MeshStandardMaterial({ vertexColors: true, ...(hz ? { map: hz } : {}), roughness: 0.7, metalness: 0 });

  /** 金網の面（YZ 平面、東向き）。len×h を 1.6m の網目で */
  const meshPlane = (len: number, h: number): THREE.PlaneGeometry => {
    const g = new THREE.PlaneGeometry(len, h);
    g.rotateY(Math.PI / 2);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len) / 1.6, (uv.getY(i) * h) / 1.6);
    return g;
  };

  // ================================================================ 柵
  const fence = new THREE.Group();
  fence.name = 'surgeFence';
  fence.position.set(fx, 0, 0);          // 以降は柵のローカル（x=0 が柵の線）
  root.add(fence);
  const sb = new Batch();                // 柱・横棒・有刺鉄線（静的部分）
  const staticSeg = (za: number, zb: number): void => {
    const len = zb - za, zc = (za + zb) / 2;
    const m = new THREE.Mesh(meshPlane(len, FENCE_H - 1.2), meshMat);
    m.position.set(0, 0.4 + (FENCE_H - 1.2) / 2, zc);
    m.receiveShadow = true;
    fence.add(m);
    for (let z = za; z <= zb + 0.01; z += 4) {
      sb.box(0, FENCE_H / 2 + 0.3, z, 0.35, FENCE_H + 0.6, 0.35, 0x59636f, false);
      // 上の「く」の字の腕（外＝東＝道の側へ傾く）と有刺鉄線
      sb.box(0.5, FENCE_H + 0.7, z, 1.2, 0.12, 0.12, 0x59636f, false, 0, 0, 0.5);
      sb.box(-0.5, FENCE_H + 0.7, z, 1.2, 0.12, 0.12, 0x59636f, false, 0, 0, -0.5);
    }
    sb.box(0, 0.35, zc, 0.2, 0.2, len, 0x7b8694, false);
    sb.box(0, FENCE_H - 0.8, zc, 0.2, 0.2, len, 0x7b8694, false);
    for (const [ox, oy] of [[0.9, FENCE_H + 1.0], [-0.9, FENCE_H + 1.0], [0, FENCE_H + 0.6]] as const) sb.box(ox, oy, zc, 0.06, 0.06, len, 0x2a2f38, false);
  };
  staticSeg(zN, jz - 12);
  staticSeg(jz + 12, zS);
  // 庭の南北の側面の柵（柵から壁まで）
  for (const zz of [zN, zS]) {
    const len = fx - wx;
    const m = new THREE.Mesh(meshPlane(len, FENCE_H - 1.2).rotateY(-Math.PI / 2), meshMat);
    m.position.set(-len / 2, 0.4 + (FENCE_H - 1.2) / 2, zz);
    fence.add(m);
    for (let x = 0; x > -len; x -= 6) sb.box(x, FENCE_H / 2 + 0.3, zz, 0.35, FENCE_H + 0.6, 0.35, 0x59636f, false);
    sb.box(-len / 2, FENCE_H - 0.8, zz, len, 0.2, 0.2, 0x7b8694, false);
  }
  // 道の幅のパネル（突き破れる）
  const panelW = 3;
  const panelMeshGeo = meshPlane(panelW, FENCE_H - 1.2);
  const pb = new Batch();
  pb.box(0, FENCE_H / 2 + 0.3, -panelW / 2, 0.35, FENCE_H + 0.6, 0.3, 0x59636f, false);
  pb.box(0.5, FENCE_H + 0.7, -panelW / 2, 1.2, 0.12, 0.12, 0x59636f, false, 0, 0, 0.5);
  pb.box(-0.5, FENCE_H + 0.7, -panelW / 2, 1.2, 0.12, 0.12, 0x59636f, false, 0, 0, -0.5);
  pb.box(0, 0.35, 0, 0.2, 0.2, panelW, 0x7b8694, false);
  pb.box(0, FENCE_H - 0.8, 0, 0.2, 0.2, panelW, 0x7b8694, false);
  for (const [ox, oy] of [[0.9, FENCE_H + 1.0], [-0.9, FENCE_H + 1.0], [0, FENCE_H + 0.6]] as const) pb.box(ox, oy, 0, 0.06, 0.06, panelW, 0x2a2f38, false);
  pb.box(0, 4.5, 0, 0.08, 0.14, panelW, 0x7b8694, false, 0, 0, 0);
  const panelFrameGeo = pb.mesh(frameMat)!.geometry;
  const fencePanels: THREE.Object3D[] = [];
  const nPanels = 8;
  for (let i = 0; i < nPanels; i++) {
    const g = new THREE.Group();
    g.name = `fencePanel${i}`;
    g.position.set(0, 0, jz - 12 + panelW / 2 + i * panelW);
    const frame = new THREE.Mesh(panelFrameGeo, frameMat);
    frame.castShadow = true;
    const net = new THREE.Mesh(panelMeshGeo, meshMat);
    net.position.set(0, 0.4 + (FENCE_H - 1.2) / 2, 0);
    g.add(frame, net);
    fence.add(g);
    fencePanels.push(g);
  }
  // 北端の柱（最後の1本）
  sb.box(0, FENCE_H / 2 + 0.3, jz + 12, 0.35, FENCE_H + 0.6, 0.35, 0x59636f, false);
  // 門柱：パネルの両脇に太い柱、赤い警告灯、「立入禁止」の看板、ハザード帯
  for (const sz of [-1, 1]) {
    const gz = jz + sz * (12 + 1.6);
    const cb = new Batch();
    cb.box(0, 6, gz, 2.2, 12, 2.2, 0x7d7a7a, { tu: 3 });
    cb.box(0, 12.3, gz, 2.8, 0.6, 2.8, 0x4a4a52, false);
    const m = cb.mesh(concreteMat, { cast: true, receive: true });
    if (m) { m.matrixAutoUpdate = true; fence.add(m); }
    const hb = new Batch();
    for (const y of [1.2, 4.0, 6.8]) hb.box(1.15, y, gz, 0.1, 0.9, 2.3, 0xffffff, { tu: 1.2 });
    const hm = hb.mesh(hazardMat);
    if (hm) { hm.matrixAutoUpdate = true; fence.add(hm); }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3a2a).multiplyScalar(1.8) }));
    lamp.position.set(0, 13.2, gz);
    fence.add(lamp);
  }
  const keepOut = signTex('立入禁止', 'red', 1024, 256);
  const kS = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshBasicMaterial({ ...(keepOut ? { map: keepOut } : { color: 0xaa3333 }), transparent: true }));
  kS.rotation.y = Math.PI / 2;
  kS.position.set(1.3, 10.4, jz);
  fence.add(kS);
  // 門の上のアーチ梁
  sb.box(0, 12.0, jz, 1.0, 0.9, 12 * 2 + 4.4, 0x4a4a52, false);
  const sm = sb.mesh(frameMat, { cast: true, receive: true });
  if (sm) { sm.matrixAutoUpdate = true; fence.add(sm); }
  const fenceCollider = col(fx - 0.5, fx + 0.5, -2, FENCE_H + 1, jz - hw - 5, jz + hw + 5, 'surgeFence');
  colliders.push(fenceCollider);

  // ================================================================ 庭（柵と建物の壁の間）
  {
    const gT = groundTex();
    if (gT) gT.repeat.set(1, 1);
    const g = new THREE.PlaneGeometry(fx - wx, zS - zN);
    g.rotateX(-Math.PI / 2);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ((fx - wx) / 14), uv.getY(i) * ((zS - zN) / 14));
    const yard = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8a7a76, ...(gT ? { map: gT } : {}), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 }));
    yard.position.set((fx + wx) / 2, -0.05, (zN + zS) / 2);
    yard.receiveShadow = true;
    root.add(yard);
  }

  // ================================================================ 建物の壁
  const building = new THREE.Group();
  building.name = 'surgeBuilding';
  root.add(building);
  const wallT = compoundWallTex();
  const wallMat = new THREE.MeshStandardMaterial({ ...(wallT ? { map: wallT } : { color: 0x6d6a6c }), roughness: 0.92, metalness: 0.05 });
  const W = COMPOUND.width, Hh = COMPOUND.height;
  const wg = new THREE.PlaneGeometry(W, Hh, Math.round(W / 2), Math.round(Hh / 2));
  wg.rotateY(Math.PI / 2);                       // 法線が +X（東）向きに
  {
    const pos = wg.getAttribute('position'), uv = wg.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getZ(i) / 40, (pos.getY(i) + Hh / 2) / 14);
  }
  const wall = new THREE.Mesh(wg, wallMat);
  wall.name = 'surgeWall';
  wall.position.set(wx, Hh / 2, jz);
  wall.receiveShadow = true;
  wall.castShadow = true;
  building.add(wall);
  // 建物の本体（前面は壁の平面が担当なので描かない）
  {
    const dep = COMPOUND.depth;
    const bg = new THREE.BoxGeometry(dep, Hh, W);
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    const sideMat = new THREE.MeshStandardMaterial({ ...(wallT ? { map: wallT } : { color: 0x6d6a6c }), roughness: 0.92, metalness: 0.05 });
    const body = new THREE.Mesh(bg, [hidden, sideMat, sideMat, sideMat, sideMat, sideMat]);   // px,nx,py,ny,pz,nz
    body.position.set(wx - dep / 2, Hh / 2, jz);
    body.castShadow = true; body.receiveShadow = true;
    building.add(body);
  }
  const wallCollider = col(wx - 6, wx, -3, Hh + 20, jz - W / 2 - 4, jz + W / 2 + 4, 'surgeWall');
  colliders.push(wallCollider);

  // ---- 壁の飾り（凹む範囲を避ける）：ハザード帯・投光器・看板
  const deco = new Batch(), decoGlow = new Batch(), hazDeco = new Batch();
  const dx = wx + 0.2;
  for (const [za, zb] of [[jz - W / 2, jz - 34], [jz + 34, jz + W / 2]] as const) {
    hazDeco.box(dx, 2.0, (za + zb) / 2, 0.3, 4, zb - za, 0xffffff, { tu: 4 });
  }
  deco.box(dx, Hh - 1, jz, 0.8, 2, W, 0x3a3a42, false);       // 屋根際の梁
  decoGlow.box(dx + 0.45, Hh - 2.2, jz, 0.06, 0.4, W, 0xff3a2a, false);
  // 投光器（2段）。光のにじみを加算で
  const washes = new Batch();
  for (const y of [26, 50]) {
    for (let z = jz - W / 2 + 8; z < jz + W / 2 - 4; z += 20) {
      if (y === 26 && Math.abs(z - jz) < 40) continue;
      deco.box(dx + 0.7, y, z, 1.4, 1.0, 1.8, 0x23262e, false);
      decoGlow.box(dx + 1.45, y - 0.05, z, 0.1, 0.7, 1.4, 0xfff2d8, false);
      washes.quad(dx + 0.5, y - 10, z, 12, 20, 0xffe8c0, Math.PI / 2, false);
    }
  }
  // 非常口と警告灯
  for (const z of [jz - 100, jz + 100, jz - 60, jz + 60]) {
    deco.box(dx + 0.3, 4, z, 0.6, 8, 5, 0x2a2f38, false);
    decoGlow.box(dx + 0.65, 8.6, z, 0.1, 0.5, 4, 0xff3a2a, false);
  }
  for (const m of [deco.mesh(concreteMat, { cast: true, receive: true }), hazDeco.mesh(hazardMat, { receive: true }), decoGlow.mesh(glowMat)]) { if (m) building.add(m); }
  const bt = beamTex();
  const washMesh = washes.mesh(new THREE.MeshBasicMaterial({
    vertexColors: true, ...(bt ? { map: bt } : {}), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  if (washMesh) { washMesh.renderOrder = 5; building.add(washMesh); }
  // 看板：サージ収容所（霧の中でも見えるよう fog を切る）
  {
    const t = signTex('サージ収容所', 'red', 2048, 384);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(150, 28), new THREE.MeshBasicMaterial({ ...(t ? { map: t } : { color: 0xaa3322 }), transparent: true, fog: false }));
    s.rotation.y = Math.PI / 2;
    s.position.set(dx + 0.5, 58, jz);
    s.material.color.setScalar(1.4);
    building.add(s);
    const lbl = signTex('SURGE DETENTION CAMP', 'cyan', 2048, 256);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(90, 11), new THREE.MeshBasicMaterial({ ...(lbl ? { map: lbl } : { color: 0x2299aa }), transparent: true, fog: false }));
    s2.rotation.y = Math.PI / 2;
    s2.position.set(dx + 0.5, 40, jz);
    building.add(s2);
  }

  // ---- 屋上の設備：中央の炉、冷却塔、煙突、アンテナ、赤い航空障害灯
  {
    const rb = new Batch(), rg = new Batch();
    const rx = wx - COMPOUND.depth * 0.45;
    // 中央の巨大な円筒（サージ炉）
    rb.cyl(rx, Hh + 36, jz, 30, 72, 0x6f7480, 28, false, 24);
    for (let y = Hh + 8; y < Hh + 66; y += 14) rg.cyl(rx, y, jz, 30 - (y - Hh) * 0.08 + 0.3, 0.8, 0xff5a3a, 28, false);
    rb.cyl(rx, Hh + 80, jz, 24, 16, 0x3a3d46, 28, false, 15);
    rg.cyl(rx, Hh + 89, jz, 12, 1, 0x52e8ff, 20, false);
    // 冷却塔
    for (const sz of [-1, 1]) {
      const zz = jz + sz * 80;
      rb.cyl(rx + 20, Hh + 30, zz, 20, 60, 0x8a8e98, 24, false, 13);
      rg.cyl(rx + 20, Hh + 61, zz, 13.5, 0.8, 0xffb040, 24, false);
    }
    // 煙突
    for (const [ox, sz] of [[-30, -1], [-30, 1], [30, -1], [30, 1]] as const) {
      const zz = jz + sz * 110, xx = rx + ox;
      rb.cyl(xx, Hh + 45, zz, 5, 90, 0x7a7e88, 14, false, 4);
      for (let y = Hh + 12; y < Hh + 84; y += 24) rb.cyl(xx, y, zz, 5.2, 6, 0xd6d0cc, 14, false);
      rg.box(xx, Hh + 92, zz, 2.4, 2.4, 2.4, 0xff3a2a, false);
    }
    // 屋上の箱・アンテナ
    for (let i = 0; i < 26; i++) {
      const bx = rx + (rand() - 0.5) * 120, bz = jz + (rand() - 0.5) * 230, bw = 8 + rand() * 20, bh = 4 + rand() * 12;
      rb.box(bx, Hh + bh / 2, bz, bw, bh, 6 + rand() * 16, 0x666b76, false);
    }
    for (let i = 0; i < 9; i++) {
      const ax = wx - 15 - rand() * 120, az = jz + (rand() - 0.5) * 240, ah = 30 + rand() * 60;
      rb.cyl(ax, Hh + ah / 2, az, 0.5, ah, 0x9aa2ae, 5, false, 0.15);
      rg.box(ax, Hh + ah + 0.5, az, 1.2, 1.2, 1.2, 0xff3a2a, false);
    }
    // 屋根の縁の赤い光
    rg.box(wx - 0.5, Hh + 0.4, jz, 0.8, 0.8, W, 0xff3a2a, false);
    const rm = rb.mesh(concreteMat, { cast: true, receive: true });
    const rgm = rg.mesh(glowMat);
    if (rm) building.add(rm);
    if (rgm) building.add(rgm);
  }

  // ---- 庭の投光塔・警備塔
  {
    const tb = new Batch(), tg = new Batch();
    for (const x of [fx - 30, fx - 60, fx - 90]) for (const sz of [-1, 1]) {
      const zz = jz + sz * 45;
      tb.cyl(x, 17, zz, 0.5, 34, 0x59636f, 6, false, 0.35);
      tb.box(x, 34.5, zz, 3.4, 1.2, 1.4, 0x2a2f38, false);
      tg.box(x + 0.4, 34.2, zz, 2.8, 0.25, 1.1, 0xfff2d8, false);
    }
    for (const zz of [zN, zS]) {
      tb.box(fx - 4, 7, zz, 6, 14, 6, 0x6d6a6c, { tu: 4 });
      tb.box(fx - 4, 14.8, zz, 8, 0.6, 8, 0x3a3a42, false);
      tg.box(fx - 4 + 4.1, 12, zz, 0.1, 0.9, 5, 0xff3a2a, false);
    }
    const tm = tb.mesh(concreteMat, { cast: true, receive: true }), tgm = tg.mesh(glowMat);
    if (tm) root.add(tm);
    if (tgm) root.add(tgm);
  }

  // ---- サーチライト：屋上の角と警備塔から、ゆっくり空を掃く
  const lights: { pivot: THREE.Group; base: number; speed: number; amp: number }[] = [];
  {
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const geo = new THREE.CylinderGeometry(14, 0.6, 500, 14, 1, true);
    geo.translate(0, 250, 0);
    const mk = (x: number, y: number, z: number, base: number, speed: number, amp: number): void => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      pivot.add(new THREE.Mesh(geo, beamMat));
      root.add(pivot);
      lights.push({ pivot, base, speed, amp });
    };
    mk(fx - 4, 15.5, zN, 0.2, 0.5, 0.5);
    mk(fx - 4, 15.5, zS, -0.2, 0.43, 0.5);
    mk(wx - 3, Hh + 4, jz - 125, 0.15, 0.31, 0.4);
    mk(wx - 3, Hh + 4, jz + 125, -0.15, 0.37, 0.4);
  }

  // ================================================================ T字路の東の端：通行止めの柵
  const ex = ROAD.eastFenceX;
  {
    const eb = new Batch(), ehz = new Batch(), eg = new Batch();
    const zA = jz - hw - 5, zB = jz + hw + 5;
    // コンクリートのバリケード（ハザード柄）
    for (let z = zA + 2; z < zB; z += 4.2) {
      ehz.box(ex - 0.2, 0.55, z, 1.1, 1.1, 4.0, 0xffffff, { tu: 1.6 });
      eb.box(ex - 0.2, 1.15, z, 0.6, 0.2, 4.0, 0x6d6a6c, false);
    }
    // 金網の柵（高さ 6m）と柱
    const g = meshPlane(zB - zA, 5);
    const fm = new THREE.Mesh(g, meshMat);
    fm.position.set(ex + 0.4, 3.7, (zA + zB) / 2);
    root.add(fm);
    for (let z = zA; z <= zB + 0.01; z += 4) {
      eb.box(ex + 0.4, 3.5, z, 0.3, 7, 0.3, 0x59636f, false);
      eg.box(ex + 0.4, 7.2, z, 0.3, 0.3, 0.3, 0xff3a2a, false);
    }
    eb.box(ex + 0.4, 6.4, (zA + zB) / 2, 0.2, 0.2, zB - zA, 0x7b8694, false);
    eb.box(ex + 0.4, 1.5, (zA + zB) / 2, 0.2, 0.2, zB - zA, 0x7b8694, false);
    const m1 = eb.mesh(frameMat, { cast: true, receive: true }), m2 = ehz.mesh(hazardMat, { cast: true, receive: true }), m3 = eg.mesh(glowMat);
    for (const m of [m1, m2, m3]) if (m) root.add(m);
    // 看板：通行止め
    const t = signTex('通行止め', 'red', 1024, 256);
    for (const z of [jz - 5.5, jz + 5.5]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), new THREE.MeshBasicMaterial({ ...(t ? { map: t } : { color: 0xaa3333 }), transparent: true }));
      s.rotation.y = -Math.PI / 2;
      s.position.set(ex - 0.8, 3.2, z);
      root.add(s);
    }
  }
  const eastCollider = col(ex - 0.9, ex + 0.9, -2, 8, jz - hw - 5, jz + hw + 5, 'eastFence');
  colliders.push(eastCollider);

  building.updateMatrixWorld(true);

  return {
    root, colliders, fence, fencePanels, fenceCollider, wall, building, eastCollider,
    update(t: number) {
      for (const l of lights) {
        l.pivot.rotation.z = Math.sin(t * l.speed) * l.amp;
        l.pivot.rotation.x = Math.cos(t * l.speed * 0.8) * l.amp * 0.8 + l.base;
      }
    },
  };
}
