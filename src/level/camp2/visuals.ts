// サージ収容所 2階の見た目と当たり判定。床・壁・天井・柱・箱・檻の格子（インスタンス化）・檻の扉・照明。
import * as THREE from 'three';
import type { AABB } from '../../core/types';
import { floorTex, hazardTex, makeSign, panelTex } from '../floor1/visuals';
import { BAR_T, CAGE, CAGE_Z, CRATES, DOOR, HALL, LOCK, PILLARS } from './layout';

export interface Camp2Visuals {
  root: THREE.Group;
  colliders: AABB[];
  lights: THREE.Light[];
  /** 檻の扉（+X へスライドして開く）。原点は閉じた位置 */
  door: THREE.Group;
  doorCollider: AABB;
  /** 扉の錠前のランプ（赤＝施錠、緑＝解錠） */
  lockLamp: THREE.MeshBasicMaterial;
  /** 天井の赤い警告灯（ボス戦中に回す） */
  alarm: THREE.PointLight;
  alarmMat: THREE.MeshBasicMaterial;
  /** 檻の中を照らす灯り（解放後に明るくする） */
  cageLight: THREE.PointLight;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tag: string, seeThrough = false): AABB =>
  ({ min: v3(x0, y0, z0), max: v3(x1, y1, z1), active: true, tag, ...(seeThrough ? { seeThrough } : {}) });

/** 繰り返し回数を決めたテクスチャを { map } で返す（document が無い環境では空） */
function rep(t: THREE.Texture | undefined, x: number, y: number): { map?: THREE.Texture } {
  if (!t) return {};
  t.repeat.set(x, y);
  return { map: t };
}

export function buildCamp2Visuals(): Camp2Visuals {
  const root = new THREE.Group();
  root.name = 'camp2';
  const colliders: AABB[] = [];
  const lights: THREE.Light[] = [];
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);

  const W = HALL.x1 - HALL.x0;
  const Z0 = CAGE.z0, Z1 = HALL.z1, H = HALL.h;
  const L = Z1 - Z0;
  const cx = (HALL.x0 + HALL.x1) / 2, cz = (Z0 + Z1) / 2;

  // ---- 材質
  const floorMat = std({ ...rep(floorTex(), W / 2.5, L / 2.5), color: 0xb7a69a, roughness: 0.85, metalness: 0.15 });
  const cageFloorMat = std({ color: 0x5a4c46, roughness: 0.95, metalness: 0.05 });
  const wallMat = std({ ...rep(panelTex(), 12, 4), color: 0x9a8d88, roughness: 0.7, metalness: 0.3 });
  const darkMat = std({ color: 0x2a2628, roughness: 0.6, metalness: 0.5 });
  const trimMat = std({ color: 0xc8682a, roughness: 0.5, metalness: 0.4, emissive: 0x3a1206, emissiveIntensity: 0.6 });
  const barMat = std({ color: 0x6f747c, roughness: 0.35, metalness: 0.85 });
  const crateMat = std({ color: 0x8a6a4a, roughness: 0.8, metalness: 0.15 });
  const hazMat = std({ ...rep(hazardTex(), 2, 1), color: 0xffffff, roughness: 0.6 });

  // ---- 床（前室と檻で色を変える）
  const hallFloor = new THREE.Mesh(new THREE.PlaneGeometry(W, HALL.z1 - HALL.z0), floorMat);
  hallFloor.rotation.x = -Math.PI / 2;
  hallFloor.position.set(cx, 0, (HALL.z0 + HALL.z1) / 2);
  hallFloor.receiveShadow = true;
  const cageFloor = new THREE.Mesh(new THREE.PlaneGeometry(W, CAGE.z1 - CAGE.z0), cageFloorMat);
  cageFloor.rotation.x = -Math.PI / 2;
  cageFloor.position.set(cx, 0.001, (CAGE.z0 + CAGE.z1) / 2);
  cageFloor.receiveShadow = true;
  root.add(hallFloor, cageFloor);
  colliders.push(box(HALL.x0 - 2, -2, Z0 - 2, HALL.x1 + 2, 0, Z1 + 2, 'floor'));

  // ---- 外壁・天井
  const T = 0.6;
  const wall = (w: number, h: number, x: number, y: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    root.add(m);
  };
  wall(W, H, cx, H / 2, Z0, 0);                 // 北（檻の奥）
  wall(W, H, cx, H / 2, Z1, Math.PI);           // 南（入口）
  wall(L, H, HALL.x0, H / 2, cz, Math.PI / 2);  // 西
  wall(L, H, HALL.x1, H / 2, cz, -Math.PI / 2); // 東
  colliders.push(
    box(HALL.x0 - 2, -1, Z0 - T, HALL.x1 + 2, H + 1, Z0, 'wall'),
    box(HALL.x0 - 2, -1, Z1, HALL.x1 + 2, H + 1, Z1 + T, 'wall'),
    box(HALL.x0 - T, -1, Z0 - 2, HALL.x0, H + 1, Z1 + 2, 'wall'),
    box(HALL.x1, -1, Z0 - 2, HALL.x1 + T, H + 1, Z1 + 2, 'wall'),
    box(HALL.x0 - 2, H, Z0 - 2, HALL.x1 + 2, H + 1, Z1 + 2, 'ceiling'),
  );
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, L), darkMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, H, cz);
  root.add(ceil);
  // 天井の梁
  const beamGeo = new THREE.BoxGeometry(W, 0.5, 0.5);
  for (let z = Z0 + 3; z < Z1; z += 6) {
    const b = new THREE.Mesh(beamGeo, darkMat);
    b.position.set(cx, H - 0.25, z);
    root.add(b);
  }
  // 壁の下のオレンジの帯
  const stripeGeo = new THREE.BoxGeometry(1, 0.25, 0.06);
  for (const [x, z, ry, len] of [[cx, Z1 - 0.03, 0, W], [HALL.x0 + 0.03, cz, Math.PI / 2, L], [HALL.x1 - 0.03, cz, Math.PI / 2, L]] as const) {
    const s = new THREE.Mesh(stripeGeo, trimMat);
    s.scale.x = len;
    s.position.set(x, 1.1, z);
    s.rotation.y = ry;
    root.add(s);
  }

  // ---- 入口（南）：閉じた大扉
  const gate = new THREE.Mesh(new THREE.BoxGeometry(5, 4.2, 0.3), std({ color: 0x5a5f68, roughness: 0.5, metalness: 0.6 }));
  gate.position.set(0, 2.1, Z1 - 0.15);
  root.add(gate);
  const gateFrame = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.4, 0.5), hazMat);
  gateFrame.position.set(0, 4.4, Z1 - 0.25);
  root.add(gateFrame);

  // ---- 柱・箱
  for (const p of PILLARS) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, H, p.w), wallMat);
    m.position.set(p.x, H / 2, p.z);
    m.castShadow = m.receiveShadow = true;
    const band = new THREE.Mesh(new THREE.BoxGeometry(p.w + 0.06, 0.6, p.w + 0.06), hazMat);
    band.position.set(p.x, 0.3, p.z);
    root.add(m, band);
    colliders.push(box(p.x - p.w / 2, 0, p.z - p.w / 2, p.x + p.w / 2, H, p.z + p.w / 2, 'pillar'));
  }
  for (const c of CRATES) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.d), crateMat);
    m.position.set(c.x, c.h / 2, c.z);
    m.castShadow = m.receiveShadow = true;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(c.w + 0.05, 0.08, c.d + 0.05), darkMat);
    lid.position.set(c.x, c.h - 0.04, c.z);
    root.add(m, lid);
    colliders.push(box(c.x - c.w / 2, 0, c.z - c.d / 2, c.x + c.w / 2, c.h, c.z + c.d / 2, 'crate'));
  }

  // ---- 檻の格子（縦の棒をインスタンス化）。扉の部分は扉側で作る
  const BAR_R = 0.035, GAP = 0.3, BAR_H = H;
  const xs: number[] = [];
  for (let x = HALL.x0 + 0.2; x <= HALL.x1 - 0.2; x += GAP) if (x < DOOR.x0 - 0.15 || x > DOOR.x1 + 0.15) xs.push(x);
  const barGeo = new THREE.CylinderGeometry(BAR_R, BAR_R, BAR_H, 6);
  const bars = new THREE.InstancedMesh(barGeo, barMat, xs.length);
  const m4 = new THREE.Matrix4();
  xs.forEach((x, i) => bars.setMatrixAt(i, m4.makeTranslation(x, BAR_H / 2, CAGE_Z)));
  bars.instanceMatrix.needsUpdate = true;
  bars.castShadow = true;
  root.add(bars);
  // 横の桁（下・中・扉の上・上）
  for (const y of [0.12, 2.0, DOOR.h + 0.15, H - 0.4]) {
    for (const [x0, x1] of [[HALL.x0, DOOR.x0 - 0.15], [DOOR.x1 + 0.15, HALL.x1]] as const) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.14, BAR_T), barMat);
      r.position.set((x0 + x1) / 2, y, CAGE_Z);
      root.add(r);
    }
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(DOOR.x1 - DOOR.x0 + 0.6, 0.3, BAR_T + 0.1), hazMat);
  lintel.position.set((DOOR.x0 + DOOR.x1) / 2, DOOR.h + 0.15, CAGE_Z);
  root.add(lintel);
  for (const x of [DOOR.x0 - 0.15, DOOR.x1 + 0.15]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.24, H, BAR_T + 0.1), darkMat);
    post.position.set(x, H / 2, CAGE_Z);
    root.add(post);
  }
  // 格子の当たり判定（扉の左右）。カメラも止める（檻の中に入ると格子と住民で前が見えなくなるため）
  colliders.push(
    box(HALL.x0, 0, CAGE_Z - BAR_T / 2, DOOR.x0 - 0.05, H, CAGE_Z + BAR_T / 2, 'cageBars'),
    box(DOOR.x1 + 0.05, 0, CAGE_Z - BAR_T / 2, HALL.x1, H, CAGE_Z + BAR_T / 2, 'cageBars'),
    box(DOOR.x0 - 0.3, DOOR.h, CAGE_Z - BAR_T / 2, DOOR.x1 + 0.3, H, CAGE_Z + BAR_T / 2, 'cageBars'),
  );
  // 看板
  const sign = makeSign('収容区画 B-2', 'red', 5);
  sign.position.set(-7, DOOR.h + 1.6, CAGE_Z + 0.16);
  root.add(sign);

  // ---- 檻の扉（格子の板＋錠前）。グループ原点＝閉じた位置の中心下
  const door = new THREE.Group();
  door.position.set((DOOR.x0 + DOOR.x1) / 2, 0, CAGE_Z);
  const dw = DOOR.x1 - DOOR.x0;
  const doorBars = new THREE.InstancedMesh(new THREE.CylinderGeometry(BAR_R * 1.2, BAR_R * 1.2, DOOR.h, 6), barMat, Math.floor(dw / 0.26));
  for (let i = 0; i < doorBars.count; i++) doorBars.setMatrixAt(i, m4.makeTranslation(-dw / 2 + 0.13 + i * 0.26, DOOR.h / 2, 0));
  doorBars.instanceMatrix.needsUpdate = true;
  door.add(doorBars);
  for (const y of [0.1, 1.0, DOOR.h - 0.1]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(dw, 0.12, 0.12), barMat);
    r.position.y = y;
    door.add(r);
  }
  for (const x of [-dw / 2, dw / 2]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.12, DOOR.h, 0.14), darkMat);
    s.position.x = x;
    door.add(s);
  }
  // 錠前（前面＝前室側）
  const lockBox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.14), std({ color: 0x3a3e46, roughness: 0.4, metalness: 0.7 }));
  lockBox.position.set(LOCK.x - door.position.x, LOCK.y, LOCK.z - CAGE_Z - 0.02);
  door.add(lockBox);
  const lockLamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3020).multiplyScalar(1.6) });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.02), lockLamp);
  lamp.position.set(lockBox.position.x, LOCK.y + 0.13, lockBox.position.z + 0.075);
  door.add(lamp);
  root.add(door);
  const doorCollider = box(DOOR.x0 - 0.05, 0, CAGE_Z - BAR_T / 2, DOOR.x1 + 0.05, DOOR.h, CAGE_Z + BAR_T / 2, 'cageDoor');
  colliders.push(doorCollider);

  // ---- 檻の中：簡素な寝台と仕切り（見た目だけ）
  const bunkMat = std({ color: 0x6a5a50, roughness: 0.9 });
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.9), bunkMat);
    b.position.set(-13 + i * 5.2, 0.25, CAGE.z0 + 0.8);
    root.add(b);
  }

  // ---- 照明
  const hemi = new THREE.HemisphereLight(0xffd8c0, 0x3a2a26, 1.1);
  lights.push(hemi);
  const key = new THREE.DirectionalLight(0xffe2c8, 1.5);
  key.position.set(8, 30, 14);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -24, right: 24, top: 30, bottom: -30, near: 1, far: 80 });
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.05;
  lights.push(key, key.target as unknown as THREE.Light);
  const lampGeo = new THREE.BoxGeometry(1.6, 0.12, 0.5);
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe6c8).multiplyScalar(1.4) });
  for (const [x, z] of [[-8, 16], [8, 16], [-8, 4], [8, 4], [-8, -8], [8, -8]]) {
    const pl = new THREE.PointLight(0xffd2b0, 26, 18, 1.6);
    pl.position.set(x, H - 1.2, z);
    lights.push(pl);
    const lm = new THREE.Mesh(lampGeo, lampMat);
    lm.position.set(x, H - 0.55, z);
    root.add(lm);
  }
  // 檻の中は薄暗い青
  const cageLight = new THREE.PointLight(0x90a8ff, 18, 26, 1.5);
  cageLight.position.set(0, H - 2, (CAGE.z0 + CAGE.z1) / 2);
  lights.push(cageLight);
  // 扉の上の赤い警告灯
  const alarmMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a10).multiplyScalar(0.4) });
  const alarmLamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), alarmMat);
  alarmLamp.position.set(0, DOOR.h + 0.55, CAGE_Z + 0.2);
  root.add(alarmLamp);
  const alarm = new THREE.PointLight(0xff3018, 0, 20, 1.4);
  alarm.position.set(0, DOOR.h + 1, CAGE_Z + 1.5);
  lights.push(alarm);

  return { root, colliders, lights, door, doorCollider, lockLamp, alarm, alarmMat, cageLight };
}
