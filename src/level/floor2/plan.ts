// 2階（サイボーグ改造室）の間取りと配置データ。three に依存しない純データ生成。
// 座標：x=東、z=南（北＝-z＝マップの上）、y=上。床は y=0。円形の部屋の中心が原点。
// 角度 φ は「北から時計回り」（北=0°、東=90°、南=180°）。点 = (r·sinφ, -r·cosφ)。
// 物体のローカル座標は ry（Y軸回転）で置く。ローカル -z が「正面」。
// 壁沿いの物は中心を向く＝ ry = π - φ。外向きなら ry = -φ。

export type Mat = 'solid' | 'panel' | 'floor' | 'glow' | 'glass' | 'hazard' | 'metal' | 'scr0' | 'scr1' | 'scr2' | 'scr3';

interface PBase { m: Mat; c: number; x: number; y: number; z: number; ry: number; rot?: [number, number, number] }
export interface PBox extends PBase { t: 'box'; sx: number; sy: number; sz: number }
/** 円柱（既定は Y 軸。中心が (x,y,z)）。r2 を指定すると上端の半径（円錐台） */
export interface PCyl extends PBase { t: 'cyl'; r: number; r2?: number; len: number; seg: number }
/** トーラス（既定は XY 平面＝軸が Z） */
export interface PTor extends PBase { t: 'tor'; R: number; r: number; seg: number }
export type Prim = PBox | PCyl | PTor;

export interface Blocker { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; tag: string }
/** 平面図・テスト用の物体情報。w=ローカル x 方向の幅、d=ローカル z 方向の奥行き */
export interface MapObj { kind: string; cat: 'machine' | 'computer' | 'bed'; label: string; x: number; z: number; w: number; d: number; ry: number }
export interface ExitDef {
  id: string; label: string;
  /** 北から時計回りの角度（°）。elevator の真向かい＝0° からのずれ */
  angleDeg: number; offsetFromOpposite: number;
  /** 壁の開口の中心（半径 R 上） */
  x: number; z: number;
  /** 外向きの単位ベクトル */
  dirX: number; dirZ: number;
  width: number; depth: number;
  /** 今は封鎖（先の階層につなぐまで閉じたドア） */
  sealed: boolean;
  /** 封鎖ドアの中心 */
  doorX: number; doorZ: number;
}
export interface LampDef { x: number; y: number; z: number; color: number }
export interface Gap { c: number; half: number; kind: 'elevator' | 'exit' }

export const R = 13;          // 内半径
export const T = 1;           // 壁の厚み
export const H = 6;           // 天井高
export const DOOR_H = 4.4;    // 出入口の高さ
export const GAP_HALF = 10.5; // 出入口の開口（北から時計回りの半角 °）
export const EXIT_OFFSET = 35;

export interface Plan {
  prims: Prim[];
  blockers: Blocker[];
  objects: MapObj[];
  lamps: LampDef[];
  gaps: Gap[];
  exits: ExitDef[];
  rooms: { id: string; name: string; x0: number; x1: number; z0: number; z1: number; h: number }[];
  start: { x: number; z: number; yaw: number };
  elevator: {
    /** かご内（乗った判定） */ x0: number; x1: number; z0: number; z1: number;
    /** 内側の出口（ドアの位置） */ doorX0: number; doorX1: number; doorZ: number; doorH: number;
    approachX: number; approachZ: number;
  };
  bed: {
    x: number; z: number;
    /** マットレスの長さ（x方向）・幅（z方向）・上面の高さ */
    len: number; wid: number; top: number;
    /** 頭の向き（単位ベクトル） */ headX: number; headZ: number;
    /** 立って待つ位置（ベッドの南側）と、そのとき向く yaw */
    standX: number; standZ: number; standYaw: number;
    /** 寝ているときの足元（キャラ原点）の位置 */ lieX: number; lieZ: number; lieY: number; lieYaw: number;
    /** 近づいたと判定する距離（ベッド中心から） */ reach: number;
  };
  /** 出入口から壁を除いた円弧（°）[a,b]（北から時計回り、a<b、0..360） */
  arcs: [number, number][];
}

const K = {
  white: 0xeef2f6, light: 0xd3dae3, mid: 0xa5b1bf, steel: 0x7c8a9c, dark: 0x2a3342, ink: 0x161d29, navy: 0x203c70, dnavy: 0x16264a,
  cyan: 0x52e8ff, teal: 0x45b8b2, green: 0x4cd68a, red: 0xe0503c, orange: 0xf0903f, yellow: 0xffc21a, magenta: 0xd04aff, blue: 0x5b8fd8,
  pale: 0xe4ecf4, mat: 0xbfd6e6,
};

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rad = (d: number): number => (d * Math.PI) / 180;
/** 北から時計回りの角度（°）と半径 → 点 */
export const polar = (r: number, deg: number): { x: number; z: number } => ({ x: r * Math.sin(rad(deg)), z: -r * Math.cos(rad(deg)) });
/** 角度の差の絶対値（°, 0..180） */
const angDiff = (a: number, b: number): number => { const d = Math.abs((((a - b) % 360) + 540) % 360 - 180); return d; };

export function generateFloor2(): Plan {
  const rand = mulberry32(20261028);
  const prims: Prim[] = [];
  const blockers: Blocker[] = [];
  const objects: MapObj[] = [];
  const lamps: LampDef[] = [];

  // ------------------------------------------------------------ ローカル座標ヘルパー
  interface Frame {
    box(m: Mat, c: number, lx: number, y: number, lz: number, sx: number, sy: number, sz: number, rot?: [number, number, number]): void;
    cyl(m: Mat, c: number, lx: number, y: number, lz: number, r: number, len: number, rot?: [number, number, number], r2?: number, seg?: number): void;
    tor(m: Mat, c: number, lx: number, y: number, lz: number, Rr: number, r: number, rot?: [number, number, number], seg?: number): void;
    /** ローカル → ワールド */
    w(lx: number, lz: number): { x: number; z: number };
  }
  /** 中心 (cx,cz)・Y 回転 ry の物体座標系 */
  const frame = (cx: number, cz: number, ry: number): Frame => {
    const co = Math.cos(ry), si = Math.sin(ry);
    const w = (lx: number, lz: number) => ({ x: cx + lx * co + lz * si, z: cz - lx * si + lz * co });
    return {
      w,
      box(m, c, lx, y, lz, sx, sy, sz, rot) {
        const p = w(lx, lz);
        prims.push({ t: 'box', m, c, x: p.x, y, z: p.z, sx, sy, sz, ry, rot });
      },
      cyl(m, c, lx, y, lz, r, len, rot, r2, seg = 14) {
        const p = w(lx, lz);
        prims.push({ t: 'cyl', m, c, x: p.x, y, z: p.z, r, r2, len, seg, ry, rot });
      },
      tor(m, c, lx, y, lz, Rr, r, rot, seg = 28) {
        const p = w(lx, lz);
        prims.push({ t: 'tor', m, c, x: p.x, y, z: p.z, R: Rr, r, seg, ry, rot });
      },
    };
  };
  /** 回転した矩形 w×d（ローカル）に外接する AABB の当たり判定（少し絞る） */
  const block = (cx: number, cz: number, w: number, d: number, ry: number, h: number, tag: string, shrink = 0.85): void => {
    const co = Math.abs(Math.cos(ry)), si = Math.abs(Math.sin(ry));
    const hx = (co * w / 2 + si * d / 2) * shrink, hz = (si * w / 2 + co * d / 2) * shrink;
    blockers.push({ x0: cx - hx, x1: cx + hx, y0: 0, y1: h, z0: cz - hz, z1: cz + hz, tag });
  };
  /** 線に沿って小さな四角を並べた当たり判定（斜めの壁用） */
  const chain = (x0: number, z0: number, x1: number, z1: number, half: number, h: number, tag: string): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(len / (half * 1.2)));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
      blockers.push({ x0: x - half, x1: x + half, y0: 0, y1: h, z0: z - half, z1: z + half, tag });
    }
  };
  const mapObj = (kind: string, cat: MapObj['cat'], label: string, x: number, z: number, w: number, d: number, ry: number): void => {
    objects.push({ kind, cat, label, x, z, w, d, ry });
  };

  // ------------------------------------------------------------ 出入口（エレベーター 180°、出口は真向かい 0° から ±35°）
  const gaps: Gap[] = [
    { c: 180, half: GAP_HALF, kind: 'elevator' },
    { c: 360 - EXIT_OFFSET, half: GAP_HALF, kind: 'exit' },
    { c: EXIT_OFFSET, half: GAP_HALF, kind: 'exit' },
  ];
  const arcs: [number, number][] = [];
  {
    // 360° を出入口で切り分ける（昇順）
    const cuts = gaps.map((g) => [g.c - g.half, g.c + g.half] as [number, number]).sort((a, b) => a[0] - b[0]);
    let cur = cuts[cuts.length - 1][1] - 360; // 最後の開口の終わり（-360 して先頭側へ）
    for (const [a, b] of cuts) { arcs.push([cur, a]); cur = b; }
    // 最初の弧が負の範囲になる場合はそのまま持つ（描画側で扱う）
  }

  // ------------------------------------------------------------ 床・天井・壁の当たり判定
  {
    const f = frame(0, 0, 0);
    f.cyl('floor', K.light, 0, -0.2, 0, R + T + 0.4, 0.4, undefined, undefined, 72);
    f.cyl('solid', K.dark, 0, H + 0.2, 0, R + T + 0.4, 0.4, undefined, undefined, 72);
    // 床と天井の当たり判定（円形の部屋・出口の通路・エレベーターをまとめて覆う大きな板）
    blockers.push({ x0: -22, x1: 22, y0: -6, y1: 0, z0: -22, z1: 22, tag: 'floor' });
    blockers.push({ x0: -22, x1: 22, y0: H, y1: H + 3, z0: -22, z1: 22, tag: 'ceiling' });
    // 壁（円）の当たり判定：1m 角の四角を並べる。四角の最内点が R を超えないよう中心半径 R+0.56
    const N = 90;
    for (let i = 0; i < N; i++) {
      const deg = (i * 360) / N;
      if (gaps.some((g) => angDiff(deg, g.c) < g.half - 0.2)) continue;
      const p = polar(R + 0.56, deg);
      blockers.push({ x0: p.x - 0.5, x1: p.x + 0.5, y0: 0, y1: H, z0: p.z - 0.5, z1: p.z + 0.5, tag: 'wall' });
    }
  }

  // ------------------------------------------------------------ 出口（北の真向かいから左右 35°）と封鎖された短い通路
  const exits: ExitDef[] = [];
  for (const [id, label, sgn] of [['exitW', '出口A（北西）', -1], ['exitE', '出口B（北東）', 1]] as const) {
    const deg = sgn * EXIT_OFFSET;
    const phi = (deg + 360) % 360;
    const a = rad(phi);
    const dirX = Math.sin(a), dirZ = -Math.cos(a);
    const depth = 5, width = 4.4;
    const f = frame(R * dirX, R * dirZ, -a); // ローカル -z が外向き
    const sideX = width / 2 + 0.4;
    f.box('panel', K.white, -sideX, 2.6, -depth / 2, 0.8, 5.2, depth + 1.0);
    f.box('panel', K.white, sideX, 2.6, -depth / 2, 0.8, 5.2, depth + 1.0);
    f.box('solid', K.dark, 0, H - 0.5, -depth / 2, width + 1.6, 1, depth + 1.0);
    f.box('floor', K.light, 0, -0.1, -depth / 2, width + 1.6, 0.2, depth + 1.0);
    // 封鎖ドア（ハザード柄のシャッター＋赤ランプ）
    f.box('metal', K.steel, 0, 2.2, -depth - 0.25, width, 4.4, 0.5);
    f.box('hazard', K.yellow, 0, 0.45, -depth - 0.25, width, 0.9, 0.58);
    for (const y of [1.6, 2.7, 3.7]) f.box('solid', K.navy, 0, y, -depth - 0.25, width, 0.14, 0.58);
    f.box('glow', K.red, 0, 4.9, -depth + 0.1, 1.6, 0.25, 0.1);
    f.box('glow', K.red, 0, 4.9, 0.4, 3.4, 0.14, 0.1); // 開口の上の赤い枠灯
    // 当たり判定：両脇の壁と封鎖ドア（斜めなので四角を並べる）
    const e0 = f.w(-sideX, 0.4), e1 = f.w(-sideX, -depth - 0.2);
    const g0 = f.w(sideX, 0.4), g1 = f.w(sideX, -depth - 0.2);
    chain(e0.x, e0.z, e1.x, e1.z, 0.4, H, 'wall');
    chain(g0.x, g0.z, g1.x, g1.z, 0.4, H, 'wall');
    const d0 = f.w(-width / 2, -depth), d1 = f.w(width / 2, -depth);
    chain(d0.x, d0.z, d1.x, d1.z, 0.4, H, 'exitDoor');
    const dc = f.w(0, -depth - 0.25);
    exits.push({
      id, label, angleDeg: phi, offsetFromOpposite: sgn * EXIT_OFFSET, x: R * dirX, z: R * dirZ, dirX, dirZ, width, depth, sealed: true,
      doorX: dc.x, doorZ: dc.z,
    });
    lamps.push({ x: f.w(0, -2).x, y: H - 0.6, z: f.w(0, -2).z, color: 0xff6a5a });
  }

  // ------------------------------------------------------------ エレベーター（南 180°）：壁の凹みにかご
  {
    const f = frame(0, R, 0); // ローカル +z が外（南）
    f.box('floor', K.mid, 0, -0.1, 2.9, 4.8, 0.2, 5.0);
    f.box('panel', K.light, -2.4, 2.6, 2.7, 0.8, 5.2, 4.6);
    f.box('panel', K.light, 2.4, 2.6, 2.7, 0.8, 5.2, 4.6);
    f.box('panel', K.mid, 0, 2.6, 5.0, 4.8, 5.2, 0.6);
    f.box('solid', K.dark, 0, 5.3, 2.7, 4.8, 0.6, 5.2);
    f.box('glow', 0xbfe8ff, 0, 5.0, 2.6, 2.6, 0.08, 0.8);
    f.box('glow', K.cyan, 0, 2.4, 4.68, 3.2, 0.12, 0.06);     // 奥の壁の帯
    f.box('glow', K.green, 0, 4.95, 0.35, 3.0, 0.2, 0.1);     // ドア上のランプ
    f.box('hazard', K.yellow, 0, 0.02, 0.9, 4.0, 0.04, 0.5);  // 敷居
    for (const sx of [-1, 1]) f.box('solid', K.dnavy, sx * 2.1, 2.2, 0.5, 0.25, 4.4, 0.9); // ドア枠
    f.box('solid', K.dnavy, 0, 4.5, 0.5, 4.4, 0.25, 0.9);
    // 当たり判定：かごの左右・奥の壁、ドア
    blockers.push({ x0: -2.8, x1: -2.0, y0: 0, y1: H, z0: R + 0.2, z1: R + 5.2, tag: 'wall' });
    blockers.push({ x0: 2.0, x1: 2.8, y0: 0, y1: H, z0: R + 0.2, z1: R + 5.2, tag: 'wall' });
    blockers.push({ x0: -2.8, x1: 2.8, y0: 0, y1: H, z0: R + 4.9, z1: R + 5.4, tag: 'wall' });
    lamps.push({ x: 0, y: 5.0, z: R + 2.6, color: 0xbfe8ff });
  }
  const elevator = { x0: -2.0, x1: 2.0, z0: R + 0.8, z1: R + 4.8, doorX0: -2.0, doorX1: 2.0, doorZ: R + 0.55, doorH: 4.4, approachX: 0, approachZ: R - 2.5 };
  mapObj('elevator', 'machine', 'エレベーター', 0, R + 2.8, 4.0, 4.0, 0);

  // ------------------------------------------------------------ 中央：手術台（研究・改造ベッド）
  const bedLen = 2.3, bedWid = 0.85, bedTop = 0.95;
  {
    const f = frame(0, 0, 0);
    f.cyl('metal', K.steel, 0, 0.1, 0, 1.0, 0.2, undefined, undefined, 28);       // 土台
    f.cyl('solid', K.dark, 0, 0.45, 0, 0.32, 0.7, undefined, undefined, 16);      // 支柱
    f.box('solid', K.dark, 0, 0.82, 0, 1.4, 0.14, 0.7);                             // フレーム
    f.box('solid', K.mid, 0, bedTop - 0.07, 0, bedLen, 0.1, bedWid + 0.08);       // 天板
    f.box('panel', K.mat, 0, bedTop, 0, bedLen - 0.06, 0.1, bedWid);               // マットレス
    f.box('panel', K.pale, -0.88, bedTop + 0.09, 0, 0.5, 0.08, 0.5);                // 頭の枕
    for (const sz of [-1, 1]) {
      f.box('glow', K.cyan, 0, bedTop - 0.04, sz * (bedWid / 2 + 0.07), bedLen - 0.1, 0.05, 0.03); // サイドの光
      f.box('metal', K.steel, 0, bedTop + 0.12, sz * (bedWid / 2 + 0.05), 1.0, 0.04, 0.04);       // サイドレール
    }
    f.box('solid', K.dark, 1.28, bedTop - 0.1, 0, 0.3, 0.3, 0.6);                   // 足元の操作ボックス
    f.box('glow', K.green, 1.28, bedTop + 0.07, 0, 0.18, 0.02, 0.35);
    // 床の光輪（ベッドの周囲）
    f.tor('glow', K.cyan, 0, 0.03, 0, 2.6, 0.05, [Math.PI / 2, 0, 0], 56);
    f.tor('glow', K.teal, 0, 0.03, 0, 3.0, 0.03, [Math.PI / 2, 0, 0], 56);
    f.cyl('hazard', K.yellow, 0, 0.012, 0, 2.5, 0.024, undefined, undefined, 56);
    f.cyl('floor', K.mid, 0, 0.03, 0, 2.2, 0.06, undefined, undefined, 56);
    // 天井から下がる無影灯（アーム＋3連ライト）
    f.cyl('metal', K.steel, 0, H - 0.6, 0, 0.12, 1.2, undefined, undefined, 10);
    f.cyl('solid', K.dark, 0, H - 1.25, 0, 0.5, 0.18, undefined, undefined, 20);
    f.box('metal', K.steel, 0.9, H - 1.25, 0, 1.8, 0.1, 0.12);
    f.box('metal', K.steel, -0.9, H - 1.25, 0, 1.8, 0.1, 0.12);
    for (const [lx, ly] of [[0, 3.55], [1.7, 3.8], [-1.7, 3.8]] as const) {
      f.cyl('metal', K.light, lx, ly + 0.55, 0, 0.12, 1.2, undefined, undefined, 8);
      f.cyl('solid', K.white, lx, ly, 0, 0.55, 0.14, undefined, undefined, 24);
      f.cyl('glow', 0xe8f8ff, lx, ly - 0.08, 0, 0.45, 0.03, undefined, undefined, 24);
    }
    lamps.push({ x: 0, y: 3.4, z: 0, color: 0xe8f8ff });
    block(0, 0, bedLen, bedWid, 0, 1.45, 'bed', 0.95);
    mapObj('bed', 'bed', '手術台', 0, 0, bedLen, bedWid, 0);
  }

  // ------------------------------------------------------------ 中央まわりの機械
  /** ロボットアーム（床置き・中心を向く）。先端が手術台の上へ伸びる */
  const roboticArm = (deg: number, r: number, label: string): void => {
    const p = polar(r, deg);
    const ry = Math.PI - rad(deg);
    const f = frame(p.x, p.z, ry);
    f.cyl('solid', K.dark, 0, 0.18, 0, 0.55, 0.36, undefined, undefined, 20);
    f.cyl('metal', K.steel, 0, 0.5, 0, 0.36, 0.5, undefined, undefined, 18);
    f.box('solid', K.orange, 0, 0.95, 0, 0.55, 0.5, 0.5);
    f.cyl('glow', K.cyan, 0, 0.95, -0.27, 0.07, 0.04, [Math.PI / 2, 0, 0]);
    // 上腕（前=-z 方向へ倒す）→ 肘 → 前腕（下へ）
    const limb = (px: number, py: number, pz: number, tilt: number, len: number, rr: number, col: number): [number, number, number] => {
      // tilt: 鉛直から前方(-z)へ倒す角。方向 = (0, cos t, -sin t)
      const dy = Math.cos(tilt), dz = -Math.sin(tilt);
      f.cyl('metal', col, 0, py + (dy * len) / 2, pz + (dz * len) / 2, rr, len, [-tilt, 0, 0], undefined, 12);
      void px;
      return [0, py + dy * len, pz + dz * len];
    };
    const e1 = limb(0, 1.2, 0, 0.55, 1.9, 0.14, K.light);
    f.cyl('solid', K.dark, e1[0], e1[1], e1[2], 0.2, 0.34, [0, 0, Math.PI / 2], undefined, 14);
    const e2 = limb(0, e1[1], e1[2], 2.2, 1.7, 0.1, K.mid); // 水平を超えて下向きに折れる
    f.cyl('metal', K.dark, e2[0], e2[1] - 0.12, e2[2], 0.12, 0.3, undefined, 0.04, 10);
    f.cyl('glow', K.red, e2[0], e2[1] - 0.3, e2[2], 0.03, 0.07, undefined, undefined, 8);
    block(p.x, p.z, 1.1, 1.1, ry, 1.5, 'machine');
    mapObj('arm', 'machine', label, p.x, p.z, 1.1, 1.1, ry);
  };
  roboticArm(55, 3.6, 'ロボットアーム');
  roboticArm(125, 3.6, 'ロボットアーム');
  roboticArm(235, 3.6, 'ロボットアーム');
  roboticArm(305, 3.6, 'ロボットアーム');

  /** スキャナー（CT のリング）。ベッドの頭側（西）で立つ */
  {
    const f = frame(-3.6, 0, 0);
    f.box('solid', K.dark, 0, 0.3, 0, 1.3, 0.6, 2.8);
    f.box('panel', K.white, 0, 0.9, -1.35, 1.0, 1.2, 0.3);
    f.box('panel', K.white, 0, 0.9, 1.35, 1.0, 1.2, 0.3);
    f.tor('panel', K.white, 0, 1.75, 0, 1.15, 0.38, [0, Math.PI / 2, 0], 36);
    f.tor('glow', K.cyan, 0, 1.75, 0, 0.8, 0.04, [0, Math.PI / 2, 0], 36);
    f.box('glow', K.green, 0.3, 0.3, 1.5, 0.05, 0.12, 0.3);
    block(-3.6, 0, 1.3, 2.8, 0, 3.2, 'machine', 0.9);
    mapObj('scanner', 'machine', 'スキャナー', -3.6, 0, 1.3, 2.8, 0);
  }
  /** 操作卓（ベッドの東。ベッドの方を向く3画面） */
  {
    const p = polar(3.9, 90);
    const ry = Math.PI - rad(90);
    const f = frame(p.x, p.z, ry);
    f.box('solid', K.dark, 0, 0.45, 0.1, 2.0, 0.9, 0.9);
    f.box('panel', K.light, 0, 0.95, 0.05, 2.0, 0.08, 1.0);
    for (let i = -1; i <= 1; i++) {
      f.box('solid', K.ink, i * 0.62, 1.55, 0.35, 0.58, 0.4, 0.05, [-0.1, i * -0.25, 0]);
      f.box(`scr${(i + 1) % 4}` as Mat, 0xffffff, i * 0.62, 1.55, 0.31, 0.52, 0.34, 0.02, [-0.1, i * -0.25, 0]);
      f.box('metal', K.steel, i * 0.62, 1.2, 0.4, 0.05, 0.5, 0.05);
    }
    for (let i = 0; i < 6; i++) f.box('glow', [K.green, K.cyan, K.yellow][i % 3], -0.6 + i * 0.24, 0.99, -0.25, 0.14, 0.02, 0.1);
    block(p.x, p.z, 2.0, 1.0, ry, 1.0, 'machine');
    mapObj('console', 'machine', '操作卓', p.x, p.z, 2.0, 1.0, ry);
  }
  /** 培養槽（サイボーグ部品の保管）：ガラス筒＋緑の液体 */
  for (const [deg, r] of [[100, 6.3], [262, 6.3], [118, 7.6], [244, 7.6]] as const) {
    const p = polar(r, deg);
    const f = frame(p.x, p.z, Math.PI - rad(deg));
    f.cyl('solid', K.dark, 0, 0.2, 0, 0.62, 0.4, undefined, undefined, 18);
    f.cyl('glass', 0x4cd6a0, 0, 1.35, 0, 0.5, 1.9, undefined, undefined, 18);
    f.cyl('glow', 0x2fb97a, 0, 1.25, 0, 0.38, 1.5, undefined, undefined, 14);
    f.cyl('solid', K.dark, 0, 2.38, 0, 0.62, 0.22, undefined, undefined, 18);
    // 中に浮かぶ部品（義手の骨組み風）
    f.cyl('metal', K.light, 0, 1.3, 0, 0.06, 1.0, [0, 0, 0.1], undefined, 8);
    f.box('metal', K.light, 0, 1.78, 0, 0.3, 0.08, 0.1);
    f.cyl('solid', K.dark, 0, 2.7, 0, 0.1, 0.8, undefined, undefined, 8);
    block(p.x, p.z, 1.2, 1.2, 0, 2.5, 'machine');
    mapObj('tank', 'machine', '培養槽', p.x, p.z, 1.2, 1.2, 0);
  }
  /** 器具カート・点滴スタンド（ベッド脇、動線をふさがない位置） */
  for (const [deg, r, kind] of [[88, 2.4, 'cart'], [100, 2.2, 'iv'], [270, 2.3, 'cart'], [290, 2.5, 'iv'], [75, 4.8, 'cart'], [285, 4.8, 'cart']] as const) {
    const p = polar(r, deg);
    const ry = Math.PI - rad(deg);
    const f = frame(p.x, p.z, ry);
    if (kind === 'cart') {
      f.box('metal', K.steel, 0, 0.75, 0, 0.8, 0.05, 0.55);
      f.box('metal', K.steel, 0, 0.3, 0, 0.8, 0.04, 0.55);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.cyl('metal', K.dark, sx * 0.36, 0.38, sz * 0.24, 0.025, 0.76, undefined, undefined, 6);
      f.box('panel', K.pale, -0.15, 0.82, 0, 0.35, 0.1, 0.4);
      f.box('solid', K.red, 0.2, 0.84, 0.05, 0.2, 0.12, 0.22);
      f.box('glow', K.cyan, 0.25, 0.9, -0.15, 0.1, 0.02, 0.1);
      block(p.x, p.z, 0.8, 0.55, ry, 0.9, 'prop', 1);
      mapObj('cart', 'machine', '器具カート', p.x, p.z, 0.8, 0.55, ry);
    } else {
      f.cyl('metal', K.light, 0, 0.9, 0, 0.025, 1.8, undefined, undefined, 6);
      f.cyl('solid', K.dark, 0, 0.05, 0, 0.3, 0.1, undefined, undefined, 12);
      f.box('glass', 0x9fd8ff, 0.18, 1.55, 0, 0.12, 0.3, 0.05);
      f.box('glow', K.cyan, 0.18, 1.5, 0, 0.08, 0.14, 0.06);
      block(p.x, p.z, 0.5, 0.5, ry, 1.8, 'prop', 1);
      mapObj('iv', 'machine', '点滴スタンド', p.x, p.z, 0.5, 0.5, ry);
    }
  }
  /** 中間リングの装置ラック（背の高い機械）。出入口からベッドへの動線は避ける */
  for (const [deg, r, w] of [[72, 6.8, 1.0], [288, 6.8, 1.0], [150, 6.2, 1.1], [210, 6.2, 1.1], [15, 6.4, 1.1], [345, 6.4, 1.1]] as const) {
    const p = polar(r, deg);
    const ry = Math.PI - rad(deg);
    const f = frame(p.x, p.z, ry);
    f.box('solid', K.dark, 0, 1.1, 0, w, 2.2, 0.8);
    f.box('panel', K.light, 0, 1.1, -0.42, w - 0.1, 2.1, 0.04);
    for (let i = 0; i < 6; i++) {
      const y = 0.35 + i * 0.33;
      f.box('solid', K.ink, 0, y, -0.45, w - 0.2, 0.26, 0.04);
      for (let j = 0; j < 4; j++) f.box('glow', [K.green, K.cyan, K.yellow, K.orange][Math.floor(rand() * 4)], -w / 2 + 0.2 + j * 0.2, y, -0.48, 0.08, 0.05, 0.03);
    }
    block(p.x, p.z, w, 0.8, ry, 2.2, 'machine');
    mapObj('rack', 'machine', '装置ラック', p.x, p.z, w, 0.8, ry);
  }
  /** 吊り下げ式のレール（ベッドの上を囲む天井リング）とケーブルの束 */
  {
    const f = frame(0, 0, 0);
    f.tor('metal', K.steel, 0, H - 0.5, 0, 4.6, 0.09, [Math.PI / 2, 0, 0], 56);
    f.tor('glow', K.cyan, 0, H - 0.6, 0, 4.6, 0.03, [Math.PI / 2, 0, 0], 56);
    for (const deg of [55, 125, 235, 305]) {
      const p = polar(4.6, deg);
      f.cyl('metal', K.steel, p.x, H - 0.9, p.z, 0.05, 0.8, undefined, undefined, 6);
    }
    // 床のケーブル：各機械 → ベッドの土台（折れ線）
    const cable = (x0: number, z0: number, x1: number, z1: number, col: number): void => {
      const mid = { x: x1, z: z0 };
      const seg = (ax: number, az: number, bx: number, bz: number): void => {
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) return;
        const ang = Math.atan2(bx - ax, bz - az);
        const g = frame((ax + bx) / 2, (az + bz) / 2, ang);
        g.box('solid', K.ink, 0, 0.05, 0, 0.14, 0.1, len);
        g.box('glow', col, 0, 0.105, 0, 0.04, 0.012, len);
      };
      seg(x0, z0, mid.x, mid.z);
      seg(mid.x, mid.z, x1, z1);
    };
    for (const deg of [55, 125, 235, 305]) { const p = polar(3.6, deg); cable(p.x, p.z, 0.3 * Math.sign(p.x), 0.2 * Math.sign(p.z), K.cyan); }
    cable(-3.6, 0.6, -1.0, 0.6, K.green);
    const c = polar(3.9, 90); cable(c.x, c.z + 0.6, 1.2, 0.6, K.yellow);
  }

  // ------------------------------------------------------------ 壁沿い：PC・端末・サーバーラック
  {
    const SLOT = 360 / 32;
    let idx = 0;
    for (let i = 0; i < 32; i++) {
      const deg = i * SLOT;
      if (gaps.some((g) => angDiff(deg, g.c) < g.half + 5)) continue;
      const kind = ['desk', 'rack', 'desk2', 'terminal'][idx++ % 4];
      const p = polar(R - 0.65, deg);
      const ry = Math.PI - rad(deg);
      const f = frame(p.x, p.z, ry);
      const scr = (idx % 4) as 0 | 1 | 2 | 3;
      if (kind === 'desk' || kind === 'desk2') {
        const dw = 1.9;
        f.box('panel', K.light, 0, 0.76, 0, dw, 0.06, 0.8);
        for (const sx of [-1, 1]) f.box('solid', K.dark, sx * (dw / 2 - 0.05), 0.38, 0, 0.06, 0.76, 0.76);
        f.box('solid', K.dark, 0, 0.45, 0.36, dw - 0.1, 0.6, 0.04);
        f.box('solid', K.ink, -0.6, 0.3, -0.05, 0.26, 0.5, 0.5);          // PC 本体
        f.box('glow', [K.cyan, K.green, K.orange][idx % 3], -0.6, 0.45, -0.31, 0.04, 0.04, 0.02);
        const n = kind === 'desk' ? 2 : 1;
        for (let m = 0; m < n; m++) {
          const mx = n === 2 ? (m - 0.5) * 0.72 : 0.1;
          f.box('solid', K.ink, mx, 1.22, 0.22, 0.66, 0.4, 0.04, [-0.08, 0, 0]);
          f.box(`scr${(scr + m) % 4}` as Mat, 0xffffff, mx, 1.22, 0.195, 0.6, 0.34, 0.012, [-0.08, 0, 0]);
          f.cyl('metal', K.steel, mx, 0.95, 0.24, 0.025, 0.4, undefined, undefined, 6);
        }
        f.box('solid', K.dark, 0.1, 0.8, -0.18, 0.5, 0.02, 0.17);        // キーボード
        f.box('solid', K.dark, 0.5, 0.8, -0.18, 0.1, 0.02, 0.14);        // マウス
        // 椅子
        f.cyl('solid', K.navy, 0.1, 0.5, -0.85, 0.24, 0.07, undefined, undefined, 12);
        f.cyl('metal', K.steel, 0.1, 0.25, -0.85, 0.03, 0.5, undefined, undefined, 6);
        f.box('solid', K.navy, 0.1, 0.95, -0.7, 0.42, 0.5, 0.07, [0.15, 0, 0]);
        block(p.x, p.z, dw, 0.8, ry, 1.0, 'computer', 0.9);
        mapObj('desk', 'computer', 'PC・デスク', p.x, p.z, dw, 0.8, ry);
      } else if (kind === 'rack') {
        f.box('solid', K.dark, 0, 1.15, 0.15, 0.95, 2.3, 0.9);
        f.box('panel', K.steel, 0, 1.15, -0.32, 0.85, 2.2, 0.04);
        for (let u = 0; u < 11; u++) {
          const y = 0.25 + u * 0.19;
          f.box('solid', K.ink, 0, y, -0.35, 0.78, 0.15, 0.03);
          for (let j = 0; j < 5; j++) if (rand() < 0.75) f.box('glow', [K.green, K.cyan, K.yellow, K.red][Math.floor(rand() * 4)], -0.3 + j * 0.15, y, -0.375, 0.05, 0.04, 0.02);
        }
        block(p.x, p.z, 0.95, 0.9, ry, 2.3, 'computer', 0.95);
        mapObj('serverRack', 'computer', 'サーバーラック', p.x, p.z, 0.95, 0.9, ry);
      } else {
        // 立って使う端末（斜めのコンソール）
        f.box('solid', K.dark, 0, 0.5, 0.15, 1.5, 1.0, 0.6);
        f.box('solid', K.ink, 0, 1.12, -0.08, 1.5, 0.05, 0.5, [0.45, 0, 0]);
        f.box(`scr${(scr + 2) % 4}` as Mat, 0xffffff, 0, 1.14, -0.075, 1.3, 0.04, 0.4, [0.45, 0, 0]);
        f.box('glow', K.cyan, 0, 1.0, -0.17, 1.4, 0.03, 0.04);
        block(p.x, p.z, 1.5, 0.6, ry, 1.2, 'computer', 0.9);
        mapObj('terminal', 'computer', '端末', p.x, p.z, 1.5, 0.6, ry);
      }
      // 壁の大型モニター（デスク・端末の上）
      if (kind !== 'rack') {
        const q = polar(R - 0.04, deg);
        const g = frame(q.x, q.z, ry);
        g.box('solid', K.ink, 0, 3.0, 0, 1.75, 1.0, 0.1);
        g.box(`scr${(scr + 1) % 4}` as Mat, 0xffffff, 0, 3.0, -0.06, 1.6, 0.86, 0.02);
        lamps.push({ x: p.x, y: 3.0, z: p.z, color: [0x52e8ff, 0x4cd68a, 0xffc21a, 0x8fa0ff][scr] });
      }
    }
    // 壁に沿うトレイ（ケーブルの帯）と天井の発光帯は visuals 側で円弧として描く
  }

  // ------------------------------------------------------------ 天井灯
  for (let i = 0; i < 8; i++) {
    const p = polar(8.6, i * 45 + 22.5);
    lamps.push({ x: p.x, y: H - 0.1, z: p.z, color: 0xcfe8ff });
  }

  // ------------------------------------------------------------ まとめ
  const bed = {
    x: 0, z: 0, len: bedLen, wid: bedWid, top: bedTop, headX: -1, headZ: 0,
    standX: 0, standZ: 1.45, standYaw: 0,
    lieX: 0.95, lieZ: 0, lieY: bedTop + 0.1 + 0.22, lieYaw: -Math.PI / 2,
    reach: 3.0,
  };
  return {
    prims, blockers, objects, lamps, gaps, exits, arcs,
    rooms: [{ id: 'lab', name: 'サイボーグ改造室', x0: -R, x1: R, z0: -R, z1: R, h: H }],
    start: { x: 0, z: R + 2.6, yaw: 0 },
    elevator, bed,
  };
}
