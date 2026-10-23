import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LEVEL, PLAYER } from '../config/balance';
import type { AABB, Enemy, World } from '../core/types';
import type { EventBus } from '../core/events';
import { aabbFromCenter, makeAABB } from '../core/collision';
import { addEnergy } from '../core/energy';
import { healPlayer, toast } from '../core/combat';
import { isTargetable } from '../core/enemyUtil';
import { spawnEnemy } from '../enemies/api';
import {
  CORRIDOR_L, DOOR_H, DOOR_W, WALL_T, computeLayout, isInsideRoom, nextWaveAction, spawnPoints, waveTotal,
} from './layout';
import type { RoomLayout } from './layout';

// ---------------------------------------------------------------- 共有キャッシュ（ジオメトリ/マテリアル）
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 14, 1);
const kitSphereGeo = new THREE.SphereGeometry(0.42, 14, 10);
const kitBarGeo = new THREE.BoxGeometry(1, 1, 1);
const padDiscGeo = new THREE.CircleGeometry(1.6, 28);
const padRingGeo = new THREE.RingGeometry(1.7, 1.95, 32);

const mats = {
  floor: new THREE.MeshLambertMaterial({ color: 0x93a4c0 }),
  wall: new THREE.MeshLambertMaterial({ color: 0xd6cfee }),
  trim: new THREE.MeshLambertMaterial({ color: 0xf3ecff }),
  ceiling: new THREE.MeshLambertMaterial({ color: 0x8480b8 }),
  crate: new THREE.MeshLambertMaterial({ color: 0xf5c4ae }),
  plat: new THREE.MeshLambertMaterial({ color: 0xa8e6cf }),
  pillar: new THREE.MeshLambertMaterial({ color: 0xe3d9ff }),
  pipe: new THREE.MeshLambertMaterial({ color: 0xa7a2c9 }),
  door: new THREE.MeshLambertMaterial({ color: 0xc4cdea }),
  glow: new THREE.MeshBasicMaterial({ color: 0x60f0ff }),
  glowWarm: new THREE.MeshBasicMaterial({ color: 0xffa070 }),
  kitWhite: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x555555 }),
  kitGreen: new THREE.MeshBasicMaterial({ color: 0x44e08a }),
};
const NO_SHADOW = new Set<THREE.Material>([mats.ceiling, mats.glow, mats.glowWarm]);

// ---------------------------------------------------------------- 実行時状態
interface DoorRT { group: THREE.Group; stripeMat: THREE.MeshBasicMaterial; collider: AABB; open: number; target: 0 | 1; cx: number; cy: number; cz: number }
interface PadRT {
  x: number; y: number; z: number; capacity: number; remaining: number;
  disc: THREE.MeshBasicMaterial; ring: THREE.MeshBasicMaterial; pointsMat: THREE.PointsMaterial;
  points: THREE.Points; seeds: number[]; chargingNow: boolean; emitTimer: number; accum: number;
}
interface KitRT { group: THREE.Group; x: number; y: number; z: number; taken: boolean }
interface RoomRT { entered: boolean; cleared: boolean; waveIdx: number; spawned: Enemy[]; timer: number }
interface PendingToast { at: number; text: string; dur: number; room: number }
interface Runtime {
  layouts: RoomLayout[];
  rooms: RoomRT[];
  doors: (DoorRT | null)[];
  pads: PadRT[];
  kits: KitRT[];
  pending: PendingToast[];
  clock: number;
  placed: boolean;
  bossSpawnTimer: number;
  boss: Enemy | null;
  bossKillTimer: number;
  column: THREE.Group | null;
  sun: THREE.DirectionalLight;
  lights: THREE.PointLight[];
  warned: boolean;
}

const runtimes = new WeakMap<World, Runtime>();
const unsubs = new WeakMap<EventBus, () => void>();

// ---------------------------------------------------------------- 静的メッシュのバッチ
class Batch {
  private map = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  add(mat: THREE.Material, geo: THREE.BufferGeometry, pos: THREE.Vector3, scale: THREE.Vector3, rot?: THREE.Euler): void {
    if (rot) this.q.setFromEuler(rot); else this.q.identity();
    this.m.compose(pos, this.q, scale);
    const g = geo.clone();
    g.applyMatrix4(this.m);
    let list = this.map.get(mat);
    if (!list) this.map.set(mat, (list = []));
    list.push(g);
  }
  flush(parent: THREE.Object3D): void {
    for (const [mat, list] of this.map) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = !NO_SHADOW.has(mat);
      mesh.receiveShadow = !(mat instanceof THREE.MeshBasicMaterial);
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
    }
    this.map.clear();
  }
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function makeSign(text: string): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(24,32,70,0.82)';
  g.beginPath(); g.roundRect(8, 8, 1008, 240, 40); g.fill();
  g.strokeStyle = '#6ff0ff'; g.lineWidth = 8;
  g.beginPath(); g.roundRect(8, 8, 1008, 240, 40); g.stroke();
  let size = 96;
  const font = (s: number) => `bold ${s}px "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif`;
  g.font = font(size);
  while (g.measureText(text).width > 920 && size > 30) { size -= 4; g.font = font(size); }
  g.fillStyle = '#ffffff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 132);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.75), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  return mesh;
}

// ---------------------------------------------------------------- 構築
export function buildDungeon(world: World): void {
  unsubs.get(world.events)?.();
  unsubs.delete(world.events);

  const layouts = computeLayout();
  const scene = world.scene;
  const root = new THREE.Group();
  root.name = 'dungeon';
  scene.add(root);

  scene.background = new THREE.Color(0x353a73);
  scene.fog = new THREE.Fog(0x353a73, 35, 120);
  scene.add(new THREE.HemisphereLight(0xcdeeff, 0xb8a4e6, 1.15));
  const sun = new THREE.DirectionalLight(0xfff0e0, 0.8);
  sun.position.set(10, 30, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 80;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  const batch = new Batch();
  const solid = (mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tag: string): void => {
    world.colliders.push(makeAABB(v3(x0, y0, z0), v3(x1, y1, z1), tag));
    batch.add(mat, BOX, v3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), v3(x1 - x0, y1 - y0, z1 - z0));
  };
  const vis = (mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => {
    batch.add(mat, BOX, v3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), v3(x1 - x0, y1 - y0, z1 - z0));
  };
  const cyl = (mat: THREE.Material, x: number, y: number, z: number, r: number, len: number, axis: 'x' | 'y' | 'z'): void => {
    const rot = axis === 'x' ? new THREE.Euler(0, 0, Math.PI / 2) : axis === 'z' ? new THREE.Euler(Math.PI / 2, 0, 0) : undefined;
    batch.add(mat, CYL, v3(x, y, z), v3(r, len, r), rot);
  };

  const rt: Runtime = {
    layouts, rooms: [], doors: [], pads: [], kits: [], pending: [], clock: 0, placed: false,
    bossSpawnTimer: -1, boss: null, bossKillTimer: -1, column: null, sun, lights: [], warned: false,
  };
  const dyn = new THREE.Group();
  root.add(dyn);
  // 点光源は3本のプールを現在の部屋とその前後に割り当てる（シェーダー負荷を抑える）
  for (let k = 0; k < 3; k++) {
    const pl = new THREE.PointLight(0xffffff, 170, 46, 2);
    root.add(pl);
    rt.lights.push(pl);
  }

  const T = WALL_T;
  const hw = DOOR_W / 2;

  layouts.forEach((L, i) => {
    const { xMin, xMax, zMin, zMax, h, cx, cz } = L;
    const def = L.def;
    const hasExit = !!L.door;
    const hasEntry = i > 0;

    // 床・天井・側壁
    solid(mats.floor, xMin - T, xMax + T, -1, 0, zMin - T, zMax + T, 'floor');
    solid(mats.ceiling, xMin - T, xMax + T, h, h + 1, zMin - T, zMax + T, 'ceiling');
    solid(mats.wall, xMin - T, xMin, 0, h, zMin - T, zMax + T, 'wall');
    solid(mats.wall, xMax, xMax + T, 0, h, zMin - T, zMax + T, 'wall');
    // 北壁（出口）/ 南壁（入口）：ドア用の開口付き
    const nsWall = (z0: number, z1: number, gap: boolean): void => {
      if (!gap) { solid(mats.wall, xMin, xMax, 0, h, z0, z1, 'wall'); return; }
      solid(mats.wall, xMin, -hw, 0, h, z0, z1, 'wall');
      solid(mats.wall, hw, xMax, 0, h, z0, z1, 'wall');
      solid(mats.wall, -hw, hw, DOOR_H, h, z0, z1, 'wall');
    };
    nsWall(zMin - T, zMin, hasExit);
    nsWall(zMax, zMax + T, hasEntry);

    // 内装：幅木・光る線・天井コーブ
    const segs = (gap: boolean): [number, number][] => (gap ? [[xMin, -hw], [hw, xMax]] : [[xMin, xMax]]);
    const nsDecor = (zFace: number, dir: number, gap: boolean): void => {
      for (const [a, b] of segs(gap)) {
        vis(mats.trim, a, b, 0, 0.6, zFace, zFace + dir * 0.28);
        vis(mats.glow, a, b, 1.5, 1.62, zFace, zFace + dir * 0.08);
        vis(mats.trim, a, b, h - 0.7, h, zFace, zFace + dir * 0.32);
      }
    };
    nsDecor(zMin, 1, hasExit);
    nsDecor(zMax, -1, hasEntry);
    for (const [xf, dir] of [[xMin, 1], [xMax, -1]] as const) {
      vis(mats.trim, Math.min(xf, xf + dir * 0.28), Math.max(xf, xf + dir * 0.28), 0, 0.6, zMin, zMax);
      vis(mats.glow, Math.min(xf, xf + dir * 0.08), Math.max(xf, xf + dir * 0.08), 1.5, 1.62, zMin, zMax);
      vis(mats.trim, Math.min(xf, xf + dir * 0.32), Math.max(xf, xf + dir * 0.32), h - 0.7, h, zMin, zMax);
    }
    // 丸い角柱
    if (!def.boss) {
      for (const x of [xMin + 0.35, xMax - 0.35]) for (const z of [zMin + 0.35, zMax - 0.35]) cyl(mats.trim, x, h / 2, z, 0.75, h, 'y');
    }
    // 配管
    for (const x of [xMin + 1.1, xMax - 1.1]) {
      cyl(mats.pipe, x, h - 1.4, cz, 0.28, def.d - 1, 'z');
      cyl(mats.glow, x, h - 1.4, cz, 0.3, 0.2, 'z');
    }
    cyl(mats.pipe, xMin + 0.55, h / 2, cz - def.d / 4, 0.22, h, 'y');
    cyl(mats.pipe, xMax - 0.55, h / 2, cz + def.d / 4, 0.22, h, 'y');
    cyl(mats.pipe, cx, h - 0.45, zMin + 0.7, 0.2, def.w - 2, 'x');

    // ブロック（遮蔽物・高台・柱）
    for (const b of def.blocks) {
      const c = v3(cx + b.lx, b.sy / 2, cz + b.lz);
      world.colliders.push(aabbFromCenter(c, v3(b.sx, b.sy, b.sz), b.kind));
      const big = b.sy > 10 && b.kind === 'cover';
      const mat = b.kind === 'platform' || b.kind === 'step' ? mats.plat : b.kind === 'pillar' ? mats.pillar : big ? mats.wall : mats.crate;
      batch.add(mat, BOX, c, v3(b.sx, b.sy, b.sz));
      if (big) continue;
      const x0 = c.x - b.sx / 2, x1 = c.x + b.sx / 2, z0 = c.z - b.sz / 2, z1 = c.z + b.sz / 2;
      if (b.kind === 'pillar') {
        for (const y of [1.2, h - 1.2]) vis(mats.glow, x0 - 0.06, x1 + 0.06, y, y + 0.14, z0 - 0.06, z1 + 0.06);
      } else {
        // 天面の縁取り
        vis(mats.trim, x0 - 0.05, x1 + 0.05, b.sy, b.sy + 0.08, z0 - 0.05, z1 + 0.05);
        vis(mats.glow, x0 - 0.03, x1 + 0.03, b.sy * 0.55, b.sy * 0.55 + 0.1, z0 - 0.03, z1 + 0.03);
      }
    }

    // 看板（北壁の内側）
    const sign = makeSign(def.title);
    sign.position.set(cx, 6.5, zMin + 0.45);
    dyn.add(sign);

    // ドア
    if (L.door) {
      const D = L.door;
      const g = new THREE.Group();
      g.position.set(D.cx, D.cy, D.cz);
      const body = new THREE.Mesh(BOX, mats.door);
      body.scale.set(DOOR_W, DOOR_H, 0.7);
      body.castShadow = true;
      g.add(body);
      const stripeMat = new THREE.MeshBasicMaterial({ color: 0xff9a6a });
      for (const [sx, sy, sw, sh] of [[0, 0, 0.35, DOOR_H - 0.6], [0, 0, DOOR_W - 0.6, 0.3]] as const) {
        const st = new THREE.Mesh(BOX, stripeMat);
        st.scale.set(sw, sh, 0.8);
        st.position.set(sx, sy, 0);
        g.add(st);
      }
      dyn.add(g);
      const collider = makeAABB(v3(D.xMin, 0, D.zMin), v3(D.xMax, DOOR_H, D.zMax), 'door');
      world.colliders.push(collider);
      rt.doors.push({ group: g, stripeMat, collider, open: 0, target: 0, cx: D.cx, cy: D.cy, cz: D.cz });
    } else rt.doors.push(null);

    // 充電ポイント
    for (const p of def.pads) {
      const px = cx + p.lx, pz = cz + p.lz, py = p.y ?? 0;
      cyl(mats.trim, px, py + 0.05, pz, 2.05, 0.1, 'y');
      const disc = new THREE.MeshBasicMaterial({ color: 0x40e8ff, transparent: true, opacity: 0.85, depthWrite: false });
      const ring = new THREE.MeshBasicMaterial({ color: 0x9ffaff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
      const d = new THREE.Mesh(padDiscGeo, disc);
      d.rotation.x = -Math.PI / 2; d.position.set(px, py + 0.12, pz);
      const r = new THREE.Mesh(padRingGeo, ring);
      r.rotation.x = -Math.PI / 2; r.position.set(px, py + 0.13, pz);
      dyn.add(d, r);
      const n = 14;
      const arr = new Float32Array(n * 3);
      const seeds: number[] = [];
      for (let k = 0; k < n; k++) seeds.push(Math.random());
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const pointsMat = new THREE.PointsMaterial({ color: 0xaffcff, size: 0.16, transparent: true, opacity: 1, depthWrite: false });
      const pts = new THREE.Points(geo, pointsMat);
      pts.frustumCulled = false;
      dyn.add(pts);
      const cap = p.capacity ?? LEVEL.chargePadCapacity;
      rt.pads.push({ x: px, y: py, z: pz, capacity: cap, remaining: cap, disc, ring, pointsMat, points: pts, seeds, chargingNow: false, emitTimer: 0, accum: 0 });
    }

    // 修理キット
    for (const k of def.kits) {
      const g = new THREE.Group();
      const s = new THREE.Mesh(kitSphereGeo, mats.kitWhite);
      s.scale.set(1.15, 0.9, 1.15);
      const b1 = new THREE.Mesh(kitBarGeo, mats.kitGreen); b1.scale.set(0.64, 0.17, 0.98);
      const b2 = new THREE.Mesh(kitBarGeo, mats.kitGreen); b2.scale.set(0.17, 0.64, 0.98);
      const b3 = new THREE.Mesh(kitBarGeo, mats.kitGreen); b3.scale.set(0.98, 0.17, 0.64);
      g.add(s, b1, b2, b3);
      const x = cx + k.lx, z = cz + k.lz;
      g.position.set(x, 1.0, z);
      dyn.add(g);
      rt.kits.push({ group: g, x, y: 0, z, taken: false });
    }

    // ボス部屋：中央のエネルギー柱
    if (def.boss) {
      cyl(mats.trim, cx, 0.25, cz, 3.4, 0.5, 'y');
      cyl(mats.glow, cx, 0.52, cz, 3.0, 0.06, 'y');
      const col = new THREE.Group();
      col.position.set(cx, 0, cz);
      const outer = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, h, 20, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x5ef0ff, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
      outer.position.y = h / 2;
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, h, 12), new THREE.MeshBasicMaterial({ color: 0xe8ffff }));
      core.position.y = h / 2;
      col.add(outer, core);
      // 柱は遮蔽物として当たり判定を持たせる（ボスが柱の中に重ならないように）
      world.colliders.push(aabbFromCenter(v3(cx, h / 2, cz), v3(2.6, h, 2.6), 'pillar'));
      const ringGeo = new THREE.TorusGeometry(2.1, 0.12, 8, 28);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x9ffaff });
      for (let k = 0; k < 4; k++) {
        const rg = new THREE.Mesh(ringGeo, ringMat);
        rg.rotation.x = Math.PI / 2;
        rg.position.y = 2 + k * 3.6;
        rg.userData.k = k;
        col.add(rg);
      }
      dyn.add(col);
      rt.column = col;
    }

    rt.rooms.push({ entered: false, cleared: false, waveIdx: -1, spawned: [], timer: -1 });
  });

  // 通路
  for (let i = 0; i < layouts.length - 1; i++) {
    const a = layouts[i], b = layouts[i + 1];
    const zA = a.zMin - T, zB = b.zMax + T;
    solid(mats.floor, -hw - T, hw + T, -1, 0, zB, zA, 'floor');
    solid(mats.ceiling, -hw - T, hw + T, DOOR_H, DOOR_H + 1, zB, zA, 'ceiling');
    solid(mats.wall, -hw - T, -hw, 0, DOOR_H, zB, zA, 'wall');
    solid(mats.wall, hw, hw + T, 0, DOOR_H, zB, zA, 'wall');
    for (const sx of [-1, 1]) {
      vis(mats.trim, sx > 0 ? hw - 0.25 : -hw, sx > 0 ? hw : -hw + 0.25, 0, 0.5, zB, zA);
      vis(mats.glow, sx > 0 ? hw - 0.07 : -hw, sx > 0 ? hw : -hw + 0.07, 1.4, 1.5, zB, zA);
    }
    vis(mats.glow, -0.4, 0.4, DOOR_H - 0.08, DOOR_H, zB, zA);
    void CORRIDOR_L;
  }

  batch.flush(root);

  // 看板用マテリアルなど動的物の影設定
  dyn.traverse((o) => { if (o instanceof THREE.Mesh && o.material === mats.door) o.castShadow = true; });

  // ワールドの状態
  world.level.rooms = layouts.map((L) => ({
    name: L.def.name, min: v3(L.xMin, 0, L.zMin), max: v3(L.xMax, L.h, L.zMax), entered: false, cleared: false,
  }));
  world.level.currentRoom = -1;
  world.level.bossSpawned = false;
  world.level.bossDefeated = false;
  world.level.data.objective = '奥へ進め';
  world.level.data.remaining = 0;

  // プレイヤー初期位置（部屋0の手前、向きは奥＝-z）
  world.player.pos.set(layouts[0].cx, 0, layouts[0].zMax - 3);
  world.player.yaw = 0;
  world.player.pitch = 0;

  runtimes.set(world, rt);
  assignLights(world, rt);
  unsubs.set(world.events, world.events.on('enemyKilled', (e) => {
    const r = runtimes.get(world);
    if (!r || e.kind !== 'boss' || !world.level.bossSpawned || r.bossKillTimer >= 0) return;
    r.bossKillTimer = 2;
  }));
}

// ---------------------------------------------------------------- 更新
function openDoor(world: World, rt: Runtime, i: number): void {
  const d = rt.doors[i];
  if (!d || d.target === 1) return;
  d.target = 1;
  d.stripeMat.color.set(0x60f0ff);
  world.events.emit('doorOpen', { pos: v3(d.cx, d.cy, d.cz) });
}
function closeDoor(rt: Runtime, i: number): void {
  const d = rt.doors[i];
  if (!d || d.target === 0) return;
  d.target = 0;
  d.stripeMat.color.set(0xff9a6a);
  d.collider.active = true;
  d.group.visible = true;
}

function schedule(rt: Runtime, room: number, delay: number, text: string, dur = 3.4): void {
  rt.pending.push({ at: rt.clock + delay, text, dur, room });
}

function enterRoom(world: World, rt: Runtime, j: number): void {
  const rr = rt.rooms[j];
  rr.entered = true;
  world.level.rooms[j].entered = true;
  world.level.currentRoom = j;
  world.events.emit('roomEnter', { index: j, name: world.level.rooms[j].name });
  if (j > 0) closeDoor(rt, j - 1);
  rt.pending = rt.pending.filter((t) => t.room >= j);
  const def = rt.layouts[j].def;
  toast(world, def.name, 3);
  switch (j) {
    case 0:
      schedule(rt, j, 3.2, 'WASDで移動、マウスで視点');
      schedule(rt, j, 6.6, '左クリックで射撃（長押しで溜め撃ち）');
      schedule(rt, j, 10, '電力は自然には回復しない。無駄撃ちに注意');
      schedule(rt, j, 13.4, '床の光るパッドは充電ポイント。上に乗ると電力が回復する');
      break;
    case 1: schedule(rt, j, 3.2, 'ドローンは下のコアが弱点。右クリックで電力を吸い取れる'); break;
    case 2: schedule(rt, j, 3.2, 'クローラーは背中の電池が弱点。回避はC'); break;
    case 3: schedule(rt, j, 3.2, '高台は飛行（3キー）で。階段状の足場からも登れる'); break;
    case 4: schedule(rt, j, 3.2, 'ヘビーの弱点は背中。スカウター（1キー）で弱点が見える'); break;
    case 6: schedule(rt, j, 3.2, 'この先、強力な反応'); break;
    case 7: rt.bossSpawnTimer = 1.5; break;
  }
}

function clearRoom(world: World, rt: Runtime, i: number): void {
  const rr = rt.rooms[i];
  if (rr.cleared) return;
  rr.cleared = true;
  world.level.rooms[i].cleared = true;
  world.events.emit('roomClear', { index: i });
  openDoor(world, rt, i);
}

function aliveCount(rr: RoomRT): number {
  let n = 0;
  for (const e of rr.spawned) if (isTargetable(e)) n++;
  return n;
}

function spawnWave(world: World, rt: Runtime, i: number): void {
  const L = rt.layouts[i];
  const rr = rt.rooms[i];
  rr.waveIdx++;
  rr.spawned = [];
  const wave = L.def.waves[rr.waveIdx];
  if (rr.waveIdx > 0) toast(world, `第${rr.waveIdx + 1}波！`, 2);
  for (const p of spawnPoints(L, wave)) {
    try {
      rr.spawned.push(spawnEnemy(world, p.kind, v3(p.x, p.y, p.z)));
    } catch (err) {
      if (!rt.warned) { rt.warned = true; console.warn('[level] spawnEnemy failed', err); }
    }
  }
}

function assignLights(world: World, rt: Runtime): void {
  const base = Math.max(0, world.level.currentRoom);
  const idxs = [base, base + 1, base - 1].map((n) => (n >= 0 && n < rt.layouts.length ? n : -1));
  rt.lights.forEach((pl, k) => {
    const L = idxs[k] >= 0 ? rt.layouts[idxs[k]] : null;
    pl.visible = true;
    if (!L) { pl.intensity = 0; return; }
    pl.color.set(L.def.lightColor);
    pl.intensity = L.def.boss ? 300 : 170;
    pl.position.set(L.cx, L.h - 1.8, L.cz);
  });

}

export function updateLevel(world: World, dt: number): void {
  const rt = runtimes.get(world);
  if (!rt) return;
  const p = world.player;
  rt.clock += dt;

  // 初回：プレイヤーが原点のままなら開始位置へ（initPlayer が上書きした場合の保険）
  if (!rt.placed) {
    rt.placed = true;
    if (p.pos.lengthSq() < 1e-6) { p.pos.set(rt.layouts[0].cx, 0, rt.layouts[0].zMax - 3); p.yaw = 0; }
  }

  assignLights(world, rt);

  // 太陽をプレイヤーに追従
  rt.sun.position.set(p.pos.x + 10, p.pos.y + 30, p.pos.z + 8);
  rt.sun.target.position.copy(p.pos);

  // 予約トースト
  for (let k = rt.pending.length - 1; k >= 0; k--) {
    if (rt.clock >= rt.pending[k].at) { toast(world, rt.pending[k].text, rt.pending[k].dur); rt.pending.splice(k, 1); }
  }

  // 部屋への進入
  for (let j = 0; j < rt.layouts.length; j++) {
    if (!rt.rooms[j].entered && isInsideRoom(rt.layouts[j], p.pos.x, p.pos.y, p.pos.z)) enterRoom(world, rt, j);
  }

  // 現在の部屋の進行
  const cur = world.level.currentRoom;
  if (cur >= 0) {
    const L = rt.layouts[cur];
    const rr = rt.rooms[cur];
    if (!rr.cleared) {
      if (L.def.boss) updateBoss(world, rt, dt);
      else {
        const action = nextWaveAction(rr.waveIdx, L.def.waves.length, aliveCount(rr));
        if (action === 'wait') rr.timer = -1;
        else {
          if (rr.timer < 0) rr.timer = action === 'clear' ? 0.5 : rr.waveIdx < 0 ? 0.8 : 1.5;
          rr.timer -= dt;
          if (rr.timer <= 0) {
            rr.timer = -1;
            if (action === 'spawn') spawnWave(world, rt, cur); else clearRoom(world, rt, cur);
          }
        }
      }
    }
  }

  // ボス撃破後の遅延
  if (rt.bossKillTimer < 0 && rt.boss && rt.boss.status === 'dead' && !world.level.bossDefeated) rt.bossKillTimer = 2;
  if (rt.bossKillTimer >= 0 && !world.level.bossDefeated) {
    rt.bossKillTimer -= dt;
    if (rt.bossKillTimer <= 0) {
      world.level.bossDefeated = true;
      if (!rt.rooms[7].cleared) { rt.rooms[7].cleared = true; world.level.rooms[7].cleared = true; world.events.emit('roomClear', { index: 7 }); }
    }
  }

  updateDoors(rt, dt);
  updatePads(world, rt, dt);
  updateKits(world, rt, dt);
  if (rt.column) {
    rt.column.children.forEach((c) => {
      if (c.userData.k !== undefined) {
        c.rotation.z = rt.clock * (0.6 + c.userData.k * 0.2);
        c.position.y = 2 + c.userData.k * 3.6 + Math.sin(rt.clock * 1.5 + c.userData.k) * 0.4;
      }
    });
  }
  updateObjective(world, rt);
}

function updateBoss(world: World, rt: Runtime, dt: number): void {
  const i = 7;
  const rr = rt.rooms[i];
  if (rt.bossSpawnTimer > 0) {
    rt.bossSpawnTimer -= dt;
    if (rt.bossSpawnTimer <= 0) {
      const pts = spawnPoints(rt.layouts[i], rt.layouts[i].def.waves[0]);
      try {
        rt.boss = spawnEnemy(world, 'boss', v3(pts[0].x, pts[0].y, pts[0].z));
        rr.spawned = [rt.boss];
      } catch (err) {
        if (!rt.warned) { rt.warned = true; console.warn('[level] spawnEnemy(boss) failed', err); }
      }
      world.level.bossSpawned = true;
      world.events.emit('bossStart', {});
      toast(world, '動力炉の守護機「ジェネレーター」起動', 3);
      schedule(rt, 7, 3.2, 'コアが開いた時が弱点。吸収と逆流も狙え', 4);
    }
  }
}

function updateDoors(rt: Runtime, dt: number): void {
  for (const d of rt.doors) {
    if (!d) continue;
    const prev = d.open;
    d.open = Math.max(0, Math.min(1, d.open + (d.target === 1 ? dt : -dt * 2) / 0.9));
    if (d.open === prev) continue;
    d.group.position.y = d.cy + d.open * DOOR_H;
    d.collider.min.y = d.open * DOOR_H;
    d.collider.active = d.open < 0.98;
    d.group.visible = d.open < 0.995;
  }
}

const _col = new THREE.Color();
const GRAY = new THREE.Color(0x77788a);
const CYAN = new THREE.Color(0x40e8ff);
const RING_CYAN = new THREE.Color(0x9ffaff);

function updatePads(world: World, rt: Runtime, dt: number): void {
  const pl = world.player;
  for (const pad of rt.pads) {
    const s = pad.remaining / pad.capacity;
    const dist = Math.hypot(pad.x - pl.pos.x, pad.z - pl.pos.z);
    const on = dist < 1.8 && pl.pos.y > pad.y - 0.6 && pl.pos.y < pad.y + 2.5;
    pad.chargingNow = false;
    if (on && pad.remaining > 0 && pl.energy < pl.maxEnergy && pl.hp > 0) {
      const gained = addEnergy(world, Math.min(LEVEL.chargePadRate * dt, pad.remaining));
      if (gained > 0) {
        pad.remaining = Math.max(0, pad.remaining - gained);
        pad.accum += gained;
        pad.chargingNow = true;
        pad.emitTimer -= dt;
        if (pad.emitTimer <= 0) {
          world.events.emit('charging', { amount: pad.accum });
          pad.accum = 0; pad.emitTimer = 0.3;
        }
      }
    }
    // 見た目：残量で光が弱まり、枯渇で灰色に
    const k = Math.max(0, Math.min(1, s));
    pad.disc.color.copy(GRAY).lerp(CYAN, Math.pow(k, 0.6));
    pad.ring.color.copy(GRAY).lerp(RING_CYAN, Math.pow(k, 0.6));
    const pulse = 0.5 + 0.5 * Math.sin(rt.clock * 3);
    pad.disc.opacity = 0.25 + 0.55 * k + (pad.chargingNow ? 0.2 : 0);
    pad.ring.opacity = 0.35 + 0.5 * k * (0.7 + 0.3 * pulse);
    pad.pointsMat.opacity = k > 0 ? 0.3 + 0.7 * k : 0;
    pad.points.visible = k > 0;
    if (k > 0) {
      const arr = pad.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const speed = pad.chargingNow ? 1.6 : 0.5;
      for (let n = 0; n < pad.seeds.length; n++) {
        const t = (rt.clock * speed * (0.6 + pad.seeds[n] * 0.6) + pad.seeds[n] * 7) % 1;
        const ang = pad.seeds[n] * 40 + rt.clock * 0.8;
        const rad = (0.3 + 1.2 * pad.seeds[n]) * (1 - t * 0.4);
        arr.setXYZ(n, pad.x + Math.cos(ang) * rad, pad.y + 0.2 + t * 2.2, pad.z + Math.sin(ang) * rad);
      }
      arr.needsUpdate = true;
    }
  }
}

function updateKits(world: World, rt: Runtime, dt: number): void {
  void dt;
  const pl = world.player;
  for (const kit of rt.kits) {
    if (kit.taken) continue;
    kit.group.rotation.y = rt.clock * 1.8;
    kit.group.position.y = kit.y + 1.0 + Math.sin(rt.clock * 2.2 + kit.x) * 0.15;
    if (pl.hp >= pl.maxHp || pl.hp <= 0) continue;
    const dx = kit.x - pl.pos.x, dz = kit.z - pl.pos.z;
    const cy = pl.pos.y + PLAYER.height * 0.5;
    if (dx * dx + dz * dz < 1.4 * 1.4 && Math.abs(kit.group.position.y - cy) < 1.6) {
      kit.taken = true;
      kit.group.parent?.remove(kit.group);
      const before = pl.hp;
      healPlayer(world, LEVEL.repairKitHeal);
      world.events.emit('repair', { amount: pl.hp - before });
    }
  }
}

function updateObjective(world: World, rt: Runtime): void {
  const cur = world.level.currentRoom;
  let objective = '奥へ進め';
  let remaining = 0;
  if (world.level.bossDefeated) objective = '動力炉を制圧した';
  else if (cur >= 0) {
    const L = rt.layouts[cur];
    const rr = rt.rooms[cur];
    if (L.def.boss) {
      objective = 'ジェネレーターを倒せ';
      remaining = world.level.bossSpawned ? aliveCount(rr) : 1;
    } else if (rr.cleared) {
      objective = '次の区画へ進め';
    } else {
      const alive = aliveCount(rr);
      let later = 0;
      for (let w = rr.waveIdx + 1; w < L.def.waves.length; w++) later += L.def.waves[w].reduce((a, g) => a + g.count, 0);
      // 未スポーンの現在ウェーブ分（スポーン待ち）
      remaining = rr.waveIdx < 0 ? waveTotal(L.def) : alive + later;
      objective = remaining > 0 ? `敵を全滅させろ 残り${remaining}` : '次の区画へ進め';
    }
  }
  world.level.data.objective = objective;
  world.level.data.remaining = remaining;
}
