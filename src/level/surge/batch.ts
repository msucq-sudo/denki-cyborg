// サージ収容所への道の見た目づくりの道具。小さな箱・円柱をたくさん作って、材質ごとに1つのメッシュへ結合する（描画呼び出しを減らす）。
// 頂点色で色を付け、UV は「世界座標をタイルの大きさで割った値」（面の向きで投影する）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface UVOpt {
  /** タイルの横・縦の大きさ（m） */
  tu?: number; tv?: number;
  /** UV のずらし（建物ごとに変えて繰り返しを目立たなくする） */
  ou?: number; ov?: number;
  /** 上面・下面を固定 UV にする（屋根を無地にする）。null で床のように (x,z)/tu */
  roof?: [number, number] | null;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

function setUV(g: THREE.BufferGeometry, o: UVOpt): void {
  const tu = o.tu ?? 4, tv = o.tv ?? tu, ou = o.ou ?? 0, ov = o.ov ?? 0;
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    if (ny >= nx && ny >= nz) {
      if (o.roof) uv.setXY(i, o.roof[0], o.roof[1]);
      else uv.setXY(i, x / tu + ou, z / tu + ov);
    } else if (nx >= nz) uv.setXY(i, z / tu + ou, y / tv + ov);
    else uv.setXY(i, x / tu + ou, y / tv + ov);
  }
}

function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): void {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
}

export class Batch {
  private list: THREE.BufferGeometry[] = [];
  get size(): number { return this.list.length; }

  /** 既存のジオメトリ（位置・法線・UV 付き）を色を付けて追加する */
  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, uv?: UVOpt | false): this {
    if (uv !== false) setUV(g, uv ?? {});
    paint(g, color);
    this.list.push(g);
    return this;
  }

  /** 箱。中心 (cx,cy,cz)・大きさ (sx,sy,sz)・Y 回転 ry・X 回転 rx（傾き）・Z 回転 rz */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, uv?: UVOpt | false, ry = 0, rx = 0, rz = 0): this {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    this.place(g, cx, cy, cz, ry, rx, rz);
    return this.add(g, color, uv);
  }

  /** 円柱（Y 軸）。r2 は上端の半径。rx/rz で傾ける */
  cyl(cx: number, cy: number, cz: number, r: number, len: number, color: THREE.ColorRepresentation, seg = 8, uv?: UVOpt | false, r2?: number, ry = 0, rx = 0, rz = 0): this {
    const g = new THREE.CylinderGeometry(r2 ?? r, r, len, seg, 1);
    this.place(g, cx, cy, cz, ry, rx, rz);
    return this.add(g, color, uv);
  }

  /** 球（半球は phiLen/thetaLen で） */
  sphere(cx: number, cy: number, cz: number, r: number, color: THREE.ColorRepresentation, ws = 16, hs = 10, uv?: UVOpt | false, thetaLen = Math.PI): this {
    const g = new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, thetaLen);
    this.place(g, cx, cy, cz, 0, 0, 0);
    return this.add(g, color, uv);
  }

  /** 板（XY 平面の長方形を Y 回転で置く）。看板・窓など */
  quad(cx: number, cy: number, cz: number, w: number, h: number, color: THREE.ColorRepresentation, ry = 0, uv?: UVOpt | false): this {
    const g = new THREE.PlaneGeometry(w, h);
    this.place(g, cx, cy, cz, ry, 0, 0);
    return this.add(g, color, uv);
  }

  private place(g: THREE.BufferGeometry, cx: number, cy: number, cz: number, ry: number, rx: number, rz: number): void {
    _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
    _m.compose(new THREE.Vector3(cx, cy, cz), _q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(_m);
  }

  /** 結合してメッシュにする（空なら null）。結合後は元のジオメトリを捨てる */
  mesh(material: THREE.Material, opts: { cast?: boolean; receive?: boolean; name?: string } = {}): THREE.Mesh | null {
    if (!this.list.length) return null;
    const merged = mergeGeometries(this.list, false);
    this.list.forEach((g) => g.dispose());
    this.list = [];
    if (!merged) return null;
    const m = new THREE.Mesh(merged, material);
    m.castShadow = !!opts.cast;
    m.receiveShadow = !!opts.receive;
    m.matrixAutoUpdate = false;
    if (opts.name) m.name = opts.name;
    return m;
  }
}

/** 乱数（シード固定） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
