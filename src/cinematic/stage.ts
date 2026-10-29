// 演出が触る舞台の物（柵・壁・建物）への窓口。ステージ担当は world.level.data.surge = { fence, fencePanels, wall, building } を置く。
// 無いとき（単体テスト・ステージ未完成）は簡易の代用品を作って scene に足し、dispose で外す。
import * as THREE from 'three';
import type { World } from '../core/types';
import { COMPOUND, ROAD } from '../level/surge/layout';

export interface SurgeStage {
  fence?: THREE.Object3D;
  /** 突き破られる柵の板（1枚ずつ飛ばせる Object3D。ワールド座標の位置で判定する） */
  fencePanels: THREE.Object3D[];
  /** 激突で凹む壁（頂点が細かく分割された Mesh。Group でも中の Mesh を凹ませる） */
  wall: THREE.Object3D;
  building?: THREE.Object3D;
}

export interface ResolvedStage extends SurgeStage {
  /** 代用品を作ったか */
  standIn: boolean;
  /** 演出が足した物を外す */
  dispose(): void;
}

/** 道の中心の z（西へ伸びる直線） */
export const ROAD_Z = ROAD.junctionZ;

export function resolveStage(world: World): ResolvedStage {
  const s = world.level.data.surge as Partial<SurgeStage> | undefined;
  if (s && s.wall && s.fencePanels && s.fencePanels.length) {
    return { ...(s as SurgeStage), standIn: false, dispose() {} };
  }
  const made = buildStandInCompound(s);
  world.scene.add(made.group);
  return {
    fence: s?.fence ?? made.fence,
    fencePanels: s?.fencePanels?.length ? s.fencePanels : made.panels,
    wall: s?.wall ?? made.wall,
    building: s?.building ?? made.building,
    standIn: true,
    dispose() {
      world.scene.remove(made.group);
      disposeTree(made.group);
    },
  };
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
  });
}

/** 代用の柵・壁・建物（レイアウトの数値どおりの位置） */
export function buildStandInCompound(have?: Partial<SurgeStage>): {
  group: THREE.Group; fence: THREE.Group; panels: THREE.Object3D[]; wall: THREE.Mesh; building: THREE.Mesh;
} {
  const group = new THREE.Group();
  group.name = 'cutscene-standin-compound';
  const C = COMPOUND;
  // 柵：幅4mの板を並べる（枠＋横棒）
  const fence = new THREE.Group();
  const panels: THREE.Object3D[] = [];
  if (!have?.fencePanels?.length) {
    const frame = new THREE.MeshStandardMaterial({ color: 0x8a96a6, metalness: 0.7, roughness: 0.4 });
    const bar = new THREE.MeshStandardMaterial({ color: 0xc9d3e0, metalness: 0.6, roughness: 0.35 });
    const pw = 4, ph = 4.2;
    const n = Math.floor((C.fenceHalf * 2) / pw);
    const frameGeo = new THREE.BoxGeometry(0.2, ph, pw);
    const barGeo = new THREE.BoxGeometry(0.1, 0.12, pw);
    const postGeo = new THREE.BoxGeometry(0.3, ph, 0.2);
    for (let i = 0; i < n; i++) {
      const p = new THREE.Group();
      p.position.set(C.fenceX, ph / 2, ROAD_Z - C.fenceHalf + pw * (i + 0.5));
      p.add(new THREE.Mesh(postGeo, frame));
      for (let k = 0; k < 4; k++) {
        const b = new THREE.Mesh(barGeo, bar);
        b.position.y = -ph / 2 + 0.5 + k * 1.05;
        p.add(b);
      }
      const f = new THREE.Mesh(frameGeo, frame);
      f.scale.set(1, 0.04, 1);
      f.position.y = ph / 2 - 0.05;
      p.add(f);
      for (let k = 1; k < 8; k++) {
        const v = new THREE.Mesh(postGeo, bar);
        v.scale.set(0.3, 1, 0.5);
        v.position.z = -pw / 2 + (k * pw) / 8;
        p.add(v);
      }
      fence.add(p);
      panels.push(p);
    }
    group.add(fence);
  }
  // 壁：細かく分割した板（凹ませるため）
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x7c8794, metalness: 0.35, roughness: 0.6, flatShading: false });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(C.width, C.height, Math.round(C.width / 1.5), Math.round(C.height / 1.5)), wallMat);
  wall.rotation.y = Math.PI / 2; // 法線 +Z → +X（東向き＝道の側）
  wall.position.set(C.wallX, C.height / 2, ROAD_Z);
  wall.name = 'cutscene-standin-wall';
  const building = new THREE.Mesh(
    new THREE.BoxGeometry(C.depth, C.height, C.width),
    new THREE.MeshStandardMaterial({ color: 0x3a424e, roughness: 0.8 }),
  );
  building.position.set(C.wallX - C.depth / 2 - 0.05, C.height / 2, ROAD_Z);
  if (!have?.wall) group.add(wall);
  if (!have?.building) group.add(building);
  return { group, fence, panels, wall, building };
}

/**
 * 壁を impact（ワールド座標）の周りでへこませる。範囲内の頂点を dir（ワールドの向き）へ押し込む。
 * 戻り値＝動かした頂点の数。Group を渡したら中の Mesh すべてに行う。
 */
export function dentObject(root: THREE.Object3D, impact: THREE.Vector3, dir: THREE.Vector3, radius: number, depth: number): number {
  root.updateMatrixWorld(true);
  let moved = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const geo = mesh.geometry as THREE.BufferGeometry | undefined;
    const attr = geo?.attributes?.position;
    if (!geo || !attr) return;
    const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    const lin = new THREE.Matrix3().setFromMatrix4(inv);
    const v = new THREE.Vector3();
    const dl = new THREE.Vector3();
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
      const d = v.distanceTo(impact);
      if (d >= radius) continue;
      const k = 1 - d / radius;
      // 中心が深いすり鉢＋ふちがわずかに盛り上がる
      const bowl = k * k * (3 - 2 * k);
      const rim = Math.exp(-Math.pow((d / radius - 0.82) / 0.1, 2)) * 0.1;
      dl.copy(dir).multiplyScalar(depth * (bowl - rim)).applyMatrix3(lin);
      attr.setXYZ(i, attr.getX(i) + dl.x, attr.getY(i) + dl.y, attr.getZ(i) + dl.z);
      moved++;
    }
    if (moved) {
      attr.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
    }
  });
  return moved;
}

/** 車の寸法（ローカル座標：前=-Z、右=+X）。車担当のモデルが変わっても合うよう、実物から測る */
export interface CarMetrics {
  /** 原点から車の先頭・後端までの距離（正の値） */
  frontDist: number;
  rearDist: number;
  halfLen: number;
  halfWid: number;
  height: number;
  /** 運転手の頭のローカル座標 */
  head: THREE.Vector3;
}

export function measureCar(car: { root: THREE.Object3D; driverHead: THREE.Object3D }): CarMetrics {
  const root = car.root;
  const sp = root.position.clone(), sr = root.rotation.clone(), ss = root.scale.clone();
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const wp = new THREE.Vector3();
  car.driverHead.getWorldPosition(wp);
  const size = box.getSize(new THREE.Vector3());
  root.position.copy(sp);
  root.rotation.copy(sr);
  root.scale.copy(ss);
  root.updateMatrixWorld(true);
  // 寸法が取れない（空のモデル）ときの既定値
  const ok = size.x > 0.1 && size.z > 0.1;
  return {
    frontDist: ok ? -box.min.z : 2.4,
    rearDist: ok ? box.max.z : 2.4,
    halfLen: ok ? size.z / 2 : 2.4,
    halfWid: ok ? size.x / 2 : 1.0,
    height: ok ? size.y : 1.5,
    head: wp,
  };
}

/**
 * 運転中に道へ置かれている障害物・雑魚（車担当の drive.obstacles / drive.zako。各要素の root）のうち、
 * x が xMax より小さいもの（演出で車が走る範囲）を隠す。戻す関数を返す。無ければ何もしない
 */
export function hideDriveProps(drive: unknown, xMax: number): () => void {
  const d = drive as { obstacles?: { root?: THREE.Object3D }[]; zako?: { root?: THREE.Object3D }[] } | undefined;
  const hidden: THREE.Object3D[] = [];
  for (const list of [d?.obstacles, d?.zako]) {
    for (const p of list ?? []) {
      const r = p?.root;
      if (r && r.visible && r.position.x < xMax) { r.visible = false; hidden.push(r); }
    }
  }
  return () => { for (const h of hidden) h.visible = true; };
}
