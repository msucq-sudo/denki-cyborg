// 1階（ボルト研究室へ向かう施設の1階）の間取りと配置データ。three に依存しない純データ生成。
// 座標：x=東、z=南（北＝-z＝マップの上）、y=上。床は y=0。壁の厚みは 1。
import { ENEMIES, type EnemyKind } from '../../config/balance';
import { podSize } from '../../enemies/podSize';

export type Mat = 'solid' | 'panel' | 'floor' | 'hazard' | 'glow' | 'glass' | 'cable';

export interface BoxPrim {
  t: 'box'; m: Mat; c: number;
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
  col: boolean; tag?: string; tile?: number;
}
export interface CylPrim {
  t: 'cyl'; m: Mat; c: number; x: number; y: number; z: number; r: number; len: number;
  axis: 'x' | 'y' | 'z'; col: boolean; seg: number;
}
export type Prim = BoxPrim | CylPrim;

export interface RoomRect { id: string; name: string; x0: number; x1: number; z0: number; z1: number; h: number }
export interface SignDef { text: string; x: number; y: number; z: number; ry: number; w: number }
/** 天井灯。y=光源の高さ、h=天井高、flicker=ちらつく、power=0 は消灯（故障） */
export interface LampDef { x: number; y: number; z: number; h: number; color: number; power: number; flicker?: boolean; elevator?: boolean }
export interface GearDef { x: number; y: number; z: number; area: string }
export interface SpawnDef { kind: EnemyKind; x: number; z: number; floor?: number; alert?: boolean; mode?: 'pod' | 'drop' }
export interface ZoneDef {
  id: string; name: string; x0: number; x1: number; z0: number; z1: number;
  /** zone=近づくと起きる（ゾーン全員が連鎖して起きる）／trap=トリガーで一斉に起きる（近づいても起きない） */
  mode: 'zone' | 'trap';
  /** ポッドの正面を向ける点（省略時は区画の中心） */
  face?: { x: number; z: number };
  spawns: SpawnDef[];
}
/** 施錠できるドア（シャッター）。rect は壁の開口（厚み方向を含む） */
export interface GateDef {
  id: string; label: string; /** 開く／閉まる条件の説明（平面図用） */ trigger: string;
  axis: 'x' | 'z'; x0: number; x1: number; z0: number; z1: number; closed: boolean;
}

export interface Plan {
  prims: Prim[];
  rooms: RoomRect[];
  signs: SignDef[];
  lamps: LampDef[];
  gears: GearDef[];
  pads: { x: number; y: number; z: number }[];
  kits: { x: number; y: number; z: number }[];
  zones: ZoneDef[];
  start: { x: number; z: number; yaw: number; hatchX: number; hatchZ: number };
  /** 非常用電源装置（脇の細い部屋）。弾かアームの命中判定は center 半径 r の球 */
  power: { x: number; y: number; z: number; r: number };
  /** グラップルポイント（吸収アームで引き寄せられる足場）。shortcut 用のテスト配置 */
  grapples: { kind: 'ledge' | 'ceiling'; x: number; y: number; z: number; nx: number; ny: number; nz: number; landAt?: { x: number; y: number; z: number }; label: string }[];
  gates: GateDef[];
  /** 平面図用の順路番号 */
  route: { n: number; x: number; z: number; label: string }[];
  elevator: {
    /** かご内（クリア判定）*/ x0: number; x1: number; z0: number; z1: number;
    /** ドア（コライダー）*/ doorX0: number; doorX1: number; doorZ: number; doorH: number;
    /** 接近トースト用の中心 */ approachX: number; approachZ: number;
  };
  /** 電力ケーブルの経路（電源装置 → エレベーター）。各区間は軸平行 */
  cable: { x: number; y: number; z: number }[];
  /** 出入口の開口（壁の厚み方向を含む矩形 x0,x1,z0,z1） */
  doors: [number, number, number, number][];
  /** ジャンプ（跳躍）で登れる1段の最大高 */
  maxStep: number;
}

export const DOOR_H = 5;
export const T = 1; // 壁の厚み
export const MAX_STEP = 1.3;

// 色
const K = {
  white: 0xeef2f6, light: 0xd3dae3, mid: 0xa5b1bf, navy: 0x203c70, dnavy: 0x16264a, cyan: 0x52e8ff,
  yellow: 0xffc21a, orange: 0xf0903f, teal: 0x45b8b2, red: 0xe0503c, green: 0x4cd68a, steel: 0x7c8a9c,
  blue: 0x5b8fd8, pale: 0xe4ecf4, brown: 0xb98a5a,
};
const CRATE_COLORS = [K.orange, K.teal, K.blue, K.light, K.yellow, K.steel, K.white];

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Op { c: number; w: number; h?: number }
type Rect = [number, number, number, number]; // x0,x1,z0,z1

export function generateFloor1(): Plan {
  const rand = mulberry32(20261027);
  const rr = (a: number, b: number) => a + (b - a) * rand();
  const pick = <V,>(arr: readonly V[]): V => arr[Math.floor(rand() * arr.length) % arr.length];

  const prims: Prim[] = [];
  const rooms: RoomRect[] = [];
  const signs: SignDef[] = [];
  const lamps: LampDef[] = [];
  const occupied: Rect[] = [];
  const zones: ZoneDef[] = [];
  const gates: GateDef[] = [];
  const gears: GearDef[] = [];
  const doors: [number, number, number, number][] = [];

  // ------------------------------------------------------------ 基本プリミティブ
  const box = (m: Mat, c: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col = true, tag?: string, tile?: number): void => {
    prims.push({ t: 'box', m, c, x0, x1, y0, y1, z0, z1, col, tag, tile });
  };
  /** 中心(x,z)・底面 y0・サイズ指定 */
  const bx = (m: Mat, c: number, cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, col = true, tag?: string): void => {
    box(m, c, cx - sx / 2, cx + sx / 2, y0, y0 + sy, cz - sz / 2, cz + sz / 2, col, tag);
  };
  const cyl = (m: Mat, c: number, x: number, y: number, z: number, r: number, len: number, axis: 'x' | 'y' | 'z', col = false, seg = 14): void => {
    prims.push({ t: 'cyl', m, c, x, y, z, r, len, axis, col, seg });
  };
  const occupy = (x0: number, x1: number, z0: number, z1: number, margin = 0): void => {
    occupied.push([x0 - margin, x1 + margin, z0 - margin, z1 + margin]);
  };

  // ------------------------------------------------------------ 壁・床・天井
  /** 壁。axis='x'：厚み方向が x（南北に延びる壁）。min=スラブの最小座標、a..b=延び方向の範囲 */
  const wall = (axis: 'x' | 'z', min: number, a: number, b: number, h: number, ops: Op[] = [], opts: { c?: number; deco?: boolean; tag?: string } = {}): void => {
    const body = opts.c ?? K.white;
    const deco = opts.deco ?? true;
    const R = (u0: number, u1: number, y0: number, y1: number, pad: number, depth: number, m: Mat, c: number, col: boolean, tile?: number) => {
      // pad: 延び方向の余白、depth: 厚み方向のはみ出し（両面）
      if (axis === 'x') box(m, c, min - depth, min + T + depth, y0, y1, u0 - pad, u1 + pad, col, col ? (opts.tag ?? 'wall') : undefined, tile);
      else box(m, c, u0 - pad, u1 + pad, y0, y1, min - depth, min + T + depth, col, col ? (opts.tag ?? 'wall') : undefined, tile);
    };
    // 面だけのはみ出し（両面の装飾）
    const face = (u0: number, u1: number, y0: number, y1: number, m: Mat, c: number, d = 0.07) => {
      if (axis === 'x') {
        box(m, c, min - d, min, y0, y1, u0, u1, false);
        box(m, c, min + T, min + T + d, y0, y1, u0, u1, false);
      } else {
        box(m, c, u0, u1, y0, y1, min - d, min, false);
        box(m, c, u0, u1, y0, y1, min + T, min + T + d, false);
      }
    };
    const sorted = [...ops].sort((p, q) => p.c - q.c);
    let cur = a;
    const piece = (u0: number, u1: number, y0: number, y1: number, lintel: boolean) => {
      if (u1 - u0 < 0.02) return;
      R(u0, u1, y0, y1, 0, 0, 'panel', body, true, 3);
      if (!deco) return;
      if (!lintel) {
        face(u0, u1, 0, 0.8, 'solid', K.navy);
        face(u0, u1, 0.8, 0.9, 'glow', K.cyan, 0.03);
      }
    };
    for (const op of sorted) {
      const oh = op.h ?? DOOR_H;
      piece(cur, op.c - op.w / 2, 0, h, false);
      if (h > oh) piece(op.c - op.w / 2, op.c + op.w / 2, oh, h, true);
      cur = op.c + op.w / 2;
      doors.push(axis === 'x' ? [min, min + T, op.c - op.w / 2, op.c + op.w / 2] : [op.c - op.w / 2, op.c + op.w / 2, min, min + T]);
      if (deco) {
        // ドア枠
        face(op.c - op.w / 2 - 0.5, op.c - op.w / 2, 0, oh, 'solid', K.navy, 0.2);
        face(op.c + op.w / 2, op.c + op.w / 2 + 0.5, 0, oh, 'solid', K.navy, 0.2);
        face(op.c - op.w / 2, op.c + op.w / 2, oh - 0.45, oh, 'solid', K.navy, 0.2);
        face(op.c - op.w / 2, op.c + op.w / 2, oh - 0.6, oh - 0.5, 'glow', K.cyan, 0.22);
        // 足元のハザード
        if (axis === 'x') {
          box('hazard', K.yellow, min - 1.2, min, 0.005, 0.03, op.c - op.w / 2, op.c + op.w / 2, false, undefined, 1.2);
          box('hazard', K.yellow, min + T, min + T + 1.2, 0.005, 0.03, op.c - op.w / 2, op.c + op.w / 2, false, undefined, 1.2);
        } else {
          box('hazard', K.yellow, op.c - op.w / 2, op.c + op.w / 2, 0.005, 0.03, min - 1.2, min, false, undefined, 1.2);
          box('hazard', K.yellow, op.c - op.w / 2, op.c + op.w / 2, 0.005, 0.03, min + T, min + T + 1.2, false, undefined, 1.2);
        }
      }
    }
    piece(cur, b, 0, h, false);
    if (deco) {
      // 上部の帯
      face(a, b, h - 0.9, h - 0.3, 'solid', K.navy);
      face(a, b, h - 0.3, h - 0.22, 'glow', K.cyan, 0.04);
    }
  };

  /** 床スラブ（壁の下まで）と天井 */
  const floorSlab = (x0: number, x1: number, z0: number, z1: number, tint = K.light): void => {
    box('floor', tint, x0 - T, x1 + T, -1, 0, z0 - T, z1 + T, true, 'floor', 2.5);
  };
  const ceilSlab = (x0: number, x1: number, z0: number, z1: number, h: number): void => {
    box('solid', K.mid, x0 - T, x1 + T, h, h + 1, z0 - T, z1 + T, true, 'ceiling');
  };
  /** 部屋の登録＋床・天井＋天井灯 */
  /** 部屋ごとの照明色：基本は冷たい青白、所々に暖色・シアンの差し色 */
  const lampColorOf = (id: string): number => {
    if (id === 'start') return 0xffc08a;
    if (id === 'hall') return 0xb4d0ff;
    if (id === 'L1' || id === 'dead') return 0x6cc8e8;
    if (id === 'L3' || id.startsWith('leg')) return 0xffa874;
    if (id.startsWith('R')) return 0x9cd2ff;
    return 0xc2d6f2;
  };
  const room = (id: string, name: string, x0: number, x1: number, z0: number, z1: number, h: number, o: { tint?: number; lampStep?: number; lampColor?: number; power?: number } = {}): void => {
    rooms.push({ id, name, x0, x1, z0, z1, h });
    floorSlab(x0, x1, z0, z1, o.tint ?? K.light);
    ceilSlab(x0, x1, z0, z1, h);
    // 天井灯（発光パネル＋ポイントライト候補）
    const step = o.lampStep ?? 10;
    const nx = Math.max(1, Math.round((x1 - x0) / step)), nz = Math.max(1, Math.round((z1 - z0) / step));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const lx = x0 + ((i + 0.5) / nx) * (x1 - x0), lz = z0 + ((j + 0.5) / nz) * (z1 - z0);
      // 発光パネルは visuals 側で生成（ちらつき・故障の個別制御のため）
      box('solid', K.dnavy, lx - 1.8, lx + 1.8, h - 0.14, h - 0.08, lz - 0.7, lz + 0.7, false);
      const hs = Math.sin(lx * 12.9898 + lz * 78.233) * 43758.5453, hv = hs - Math.floor(hs); // 位置から決まる乱数
      const basePower = (o.power ?? 1) * Math.min(1.1, (step / 10) ** 1.5); // 灯りが密な部屋は弱める
      const broken = basePower > 0 && hv < 0.1 && !id.startsWith('start');
      lamps.push({
        x: lx, y: h - 1.6, z: lz, h, color: o.lampColor ?? lampColorOf(id), power: broken ? 0 : basePower,
        flicker: !broken && hv >= 0.1 && hv < 0.27,
      });
    }
  };

  // ------------------------------------------------------------ 小物
  const crate = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, color: number, stripe = true, tag = 'prop'): void => {
    box('solid', color, x0, x1, y0, y1, z0, z1, true, tag);
    box('solid', K.dnavy, x0 - 0.04, x1 + 0.04, y1 - 0.1, y1 + 0.02, z0 - 0.04, z1 + 0.04, false);
    box('solid', K.dnavy, x0 - 0.04, x1 + 0.04, y0 + 0.0, y0 + 0.14, z0 - 0.04, z1 + 0.04, false);
    if (stripe && y1 - y0 > 0.9) {
      box('hazard', K.yellow, x0 - 0.03, x1 + 0.03, y0 + 0.3, y0 + 0.62, z0 - 0.03, z1 + 0.03, false, undefined, 0.9);
    }
  };
  /** 積み重ねコンテナ（段の高さ 1.2m 刻み） */
  const crateStack = (cx: number, cz: number, sx: number, sz: number, levels: number, color: number): void => {
    for (let i = 0; i < levels; i++) {
      const shrink = i * 0.0;
      crate(cx - sx / 2 + shrink, cx + sx / 2 - shrink, cz - sz / 2 + shrink, cz + sz / 2 - shrink, i * 1.2, (i + 1) * 1.2, i % 2 ? pick(CRATE_COLORS) : color, i === 0);
    }
    occupy(cx - sx / 2, cx + sx / 2, cz - sz / 2, cz + sz / 2, 0.7);
  };
  const container = (cx: number, cz: number, alongX: boolean, color: number): void => {
    const lx = alongX ? 6 : 2.6, lz = alongX ? 2.6 : 6, hh = 2.6;
    box('solid', color, cx - lx / 2, cx + lx / 2, 0, hh, cz - lz / 2, cz + lz / 2, true, 'prop');
    // 波板のリブ
    const n = 8;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      if (alongX) {
        const x = cx - lx / 2 + t * lx;
        box('solid', K.dnavy, x - 0.06, x + 0.06, 0.1, hh - 0.1, cz - lz / 2 - 0.05, cz + lz / 2 + 0.05, false);
      } else {
        const z = cz - lz / 2 + t * lz;
        box('solid', K.dnavy, cx - lx / 2 - 0.05, cx + lx / 2 + 0.05, 0.1, hh - 0.1, z - 0.06, z + 0.06, false);
      }
    }
    box('hazard', K.yellow, cx - lx / 2 - 0.04, cx + lx / 2 + 0.04, hh - 0.35, hh - 0.1, cz - lz / 2 - 0.04, cz + lz / 2 + 0.04, false, undefined, 0.8);
    occupy(cx - lx / 2, cx + lx / 2, cz - lz / 2, cz + lz / 2, 0.8);
  };
  const tank = (cx: number, cz: number, r: number, h: number, liquid = K.cyan): void => {
    cyl('solid', K.dnavy, cx, 0, cz, r + 0.12, 0.7, 'y', false, 16);
    cyl('glass', 0x8be9ff, cx, 0.7, cz, r, h - 1.1, 'y', false, 18);
    cyl('glow', liquid, cx, 0.9, cz, r * 0.62, h - 1.5, 'y', false, 14);
    cyl('solid', K.dnavy, cx, h - 0.4, cz, r + 0.12, 0.4, 'y', false, 16);
    cyl('glow', 0xffffff, cx, h - 0.42, cz, r * 0.5, 0.05, 'y', false, 12);
    // 当たり判定は外形に合わせた角柱
    const s = (r + 0.12) * 1.8;
    box('solid', K.dnavy, cx - s / 2, cx + s / 2, 0, h, cz - s / 2, cz + s / 2, true, 'prop');
    // 上の見た目は箱が隠れるように薄く内側へ（コライダー用の箱は同色で目立たない）
    occupy(cx - r, cx + r, cz - r, cz + r, 0.8);
  };
  const desk = (cx: number, cz: number, alongX: boolean): void => {
    const sx = alongX ? 2.4 : 1.1, sz = alongX ? 1.1 : 2.4;
    bx('solid', K.pale, cx, 0, cz, sx, 0.95, sz, true, 'prop');
    bx('solid', K.navy, cx, 0.95, cz, sx + 0.06, 0.06, sz + 0.06, false);
    const dirx = alongX ? 1 : 0;
    // モニター（2台）
    for (const o of [-0.55, 0.55]) {
      const mx = cx + (alongX ? o : 0), mz = cz + (alongX ? 0 : o);
      bx('solid', K.dnavy, mx, 1.01, mz, alongX ? 0.8 : 0.1, 0.65, alongX ? 0.1 : 0.8, false);
      const f = alongX ? 0.06 : 0.0, g = alongX ? 0 : 0.06;
      bx('glow', rand() > 0.5 ? 0x7be8ff : 0x9dffb8, mx - g * 0, 1.06, mz - f * 0, alongX ? 0.7 : 0.12, 0.55, alongX ? 0.12 : 0.7, false);
    }
    void dirx;
    occupy(cx - sx / 2, cx + sx / 2, cz - sz / 2, cz + sz / 2, 0.8);
  };
  const jars = (cx: number, cz: number, alongX: boolean): void => {
    // 標本瓶を並べたラボテーブル
    const sx = alongX ? 3.2 : 1.1, sz = alongX ? 1.1 : 3.2;
    bx('solid', K.white, cx, 0, cz, sx, 0.95, sz, true, 'prop');
    bx('solid', K.navy, cx, 0.95, cz, sx + 0.06, 0.05, sz + 0.06, false);
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5 - 0.5;
      const jx = cx + (alongX ? t * (sx - 0.5) : 0), jz = cz + (alongX ? 0 : t * (sz - 0.5));
      const col = pick([K.cyan, K.green, 0xff9ad0, K.yellow]);
      cyl('glass', 0xbff3ff, jx, 1.0, jz, 0.17, 0.5, 'y', false, 8);
      cyl('glow', col, jx, 1.02, jz, 0.1, 0.34, 'y', false, 8);
    }
    occupy(cx - sx / 2, cx + sx / 2, cz - sz / 2, cz + sz / 2, 0.8);
  };
  const cart = (cx: number, cz: number): void => {
    bx('solid', K.steel, cx, 0.25, cz, 1.3, 0.1, 0.9, true, 'prop');
    bx('solid', K.dnavy, cx, 0, cz, 1.2, 0.25, 0.8, true, 'prop');
    bx('solid', pick(CRATE_COLORS), cx - 0.2, 0.35, cz, 0.6, 0.5, 0.6, true, 'prop');
    bx('solid', K.red, cx + 0.35, 0.35, cz, 0.4, 0.35, 0.5, false);
    occupy(cx - 0.65, cx + 0.65, cz - 0.45, cz + 0.45, 0.8);
  };
  const barrels = (cx: number, cz: number): void => {
    for (const [dx, dz] of [[0, 0], [0.95, 0.2], [0.4, 0.95]] as const) {
      cyl('solid', pick([K.blue, K.orange, K.teal]), cx + dx, 0, cz + dz, 0.45, 1.15, 'y', false, 10);
      cyl('solid', K.dnavy, cx + dx, 0.55, cz + dz, 0.47, 0.1, 'y', false, 10);
    }
    box('solid', K.steel, cx - 0.5, cx + 1.45, 0, 1.15, cz - 0.5, cz + 1.45, true, 'prop');
    occupy(cx - 0.5, cx + 1.45, cz - 0.5, cz + 1.45, 0.8);
  };
  /** 壁沿いの大きな棚。side=壁の向き（その壁に背を付ける）*/
  const shelf = (side: 'N' | 'S' | 'E' | 'W', along: number, wallFace: number, len: number, hh: number): void => {
    const d = 1.4;
    let x0: number, x1: number, z0: number, z1: number;
    if (side === 'N') { x0 = along - len / 2; x1 = along + len / 2; z0 = wallFace; z1 = wallFace + d; }
    else if (side === 'S') { x0 = along - len / 2; x1 = along + len / 2; z0 = wallFace - d; z1 = wallFace; }
    else if (side === 'W') { x0 = wallFace; x1 = wallFace + d; z0 = along - len / 2; z1 = along + len / 2; }
    else { x0 = wallFace - d; x1 = wallFace; z0 = along - len / 2; z1 = along + len / 2; }
    box('solid', K.steel, x0, x1, 0, hh, z0, z1, true, 'prop');
    // 棚板と荷物（手前面）
    const front = side === 'N' ? [z1, 1] : side === 'S' ? [z0, -1] : side === 'W' ? [x1, 1] : [x0, -1];
    const levels = Math.floor(hh / 1.1);
    for (let l = 0; l < levels; l++) {
      const y = 0.15 + l * 1.1;
      const n = Math.max(2, Math.floor(len / 1.3));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const w = len / n * 0.78, hgt = rr(0.5, 0.85);
        const col = pick(CRATE_COLORS);
        const c = (side === 'N' || side === 'S') ? x0 + t * len : z0 + t * len;
        const f = front[0] as number, dr = front[1] as number;
        const o0 = dr > 0 ? f : f - 0.3, o1 = dr > 0 ? f + 0.3 : f;
        if (side === 'N' || side === 'S') box('solid', col, c - w / 2, c + w / 2, y, y + hgt, o0, o1, false);
        else box('solid', col, o0, o1, y, y + hgt, c - w / 2, c + w / 2, false);
      }
      const f = front[0] as number, dr = front[1] as number;
      const p0 = dr > 0 ? f : f - 0.06, p1 = dr > 0 ? f + 0.06 : f;
      if (side === 'N' || side === 'S') box('solid', K.navy, x0, x1, y - 0.1, y, Math.min(p0, p1) - 0.02, Math.max(p0, p1) + 0.34 * dr + 0.0, false);
      else box('solid', K.navy, Math.min(p0, p1) - 0.02, Math.max(p0, p1) + 0.34 * dr, y - 0.1, y, z0, z1, false);
    }
    occupy(x0, x1, z0, z1, 0.8);
  };
  const cableRun = (x: number, z: number, len: number, alongX: boolean, color: number = K.dnavy): void => {
    cyl('solid', color, alongX ? x + len / 2 : x, 0.13, alongX ? z : z + len / 2, 0.13, len, alongX ? 'x' : 'z', false, 6);
  };
  const floorStripe = (x0: number, x1: number, z0: number, z1: number, c: number = K.cyan): void => {
    box('glow', c, x0, x1, 0.01, 0.03, z0, z1, false);
  };

  const inside = (a: Rect, b: Rect): boolean => !(a[1] <= b[0] || b[1] <= a[0] || a[3] <= b[2] || b[3] <= a[2]);

  /** 壁沿いに小物を並べる（部屋の中央は戦闘用に空ける）。出入口の3m以内には置かない */
  const scatter = (r: Rect, n: number, keep: Rect[] = [], kinds: string[] = ['crate', 'crate', 'desk', 'jars', 'tank', 'cart', 'barrels', 'container']): void => {
    const narrow = Math.min(r[1] - r[0], r[3] - r[2]) < 14;
    const ks = narrow ? kinds.filter((k) => !['container', 'tank', 'barrels'].includes(k)) : kinds;
    const use = ks.length ? ks : ['crate', 'cart'];
    const doorKeepR: Rect[] = doors.map(([a, b, c, d]) => [a - 3.2, b + 3.2, c - 3.2, d + 3.2]);
    let placed = 0;
    for (let tries = 0; tries < n * 60 && placed < n; tries++) {
      const kind = pick(use);
      // 壁の選択（細い部屋は長辺側の壁だけ）
      const sides: ('N' | 'S' | 'W' | 'E')[] = narrow
        ? ((r[1] - r[0]) >= (r[3] - r[2]) ? ['N', 'S'] : ['W', 'E']) : ['N', 'S', 'W', 'E'];
      const side = pick(sides);
      const horiz = side === 'N' || side === 'S'; // 壁が x 方向に延びる
      // 種類ごとの [壁沿いの長さ, 奥行き]
      let len: number, dep: number;
      switch (kind) {
        case 'container': len = 6; dep = 2.6; break;
        case 'desk': len = 2.4; dep = 1.1; break;
        case 'jars': len = 3.2; dep = 1.1; break;
        case 'tank': len = 2.6; dep = 2.6; break;
        case 'barrels': len = 1.95; dep = 1.95; break;
        case 'cart': len = 1.3; dep = 0.9; break;
        default: len = rr(1.3, 2.4); dep = narrow ? 1.25 : rr(1.4, 2.4);
      }
      const lo = horiz ? r[0] : r[2], hi = horiz ? r[1] : r[3];
      if (hi - lo < len + 3) continue;
      const along = rr(lo + len / 2 + 1, hi - len / 2 - 1);
      const off = dep / 2 + 0.2;
      const cx = horiz ? along : side === 'W' ? r[0] + off : r[1] - off;
      const cz = horiz ? (side === 'N' ? r[2] + off : r[3] - off) : along;
      const fp: Rect = horiz ? [cx - len / 2, cx + len / 2, cz - dep / 2, cz + dep / 2] : [cx - dep / 2, cx + dep / 2, cz - len / 2, cz + len / 2];
      const test: Rect = [fp[0] - 0.9, fp[1] + 0.9, fp[2] - 0.9, fp[3] + 0.9];
      if (occupied.some((o) => inside(test, o)) || keep.some((k) => inside(test, k)) || doorKeepR.some((k) => inside(fp, k))) continue;
      switch (kind) {
        case 'container': container(cx, cz, horiz, pick(CRATE_COLORS)); break;
        case 'desk': desk(cx, cz, horiz); break;
        case 'jars': jars(cx, cz, horiz); break;
        case 'tank': tank(cx, cz, 1.0, rr(3.4, 5), pick([K.cyan, K.green, 0xff9ad0])); break;
        case 'barrels': barrels(cx - 0.475, cz - 0.475); break;
        case 'cart': cart(cx, cz); break;
        default: crateStack(cx, cz, horiz ? len : dep, horiz ? dep : len, !narrow && rand() > 0.6 ? 2 : 1, pick(CRATE_COLORS));
      }
      placed++;
    }
  };

  // ============================================================ 配置
  const H_HALL = 16;
  const HX = 22.5;       // 大広間の半幅
  const HZ0 = -70, HZ1 = -5;
  /** スタート通路の西端（スパーク研究室の扉の位置） */
  const SX0 = -95;

  // ---- 大広間
  room('hall', '大広間', -HX, HX, HZ0, HZ1, H_HALL, { tint: K.pale, lampStep: 11, power: 1.0 });
  wall('x', -HX - T, HZ0 - T, HZ1 + T, H_HALL, [{ c: -9.5, w: 9 }, { c: -45, w: 7 }]);     // 西
  wall('x', HX, HZ0 - T, HZ1 + T, H_HALL, [{ c: -63, w: 7 }, { c: -31.5, w: 7 }, { c: -9, w: 8 }]); // 東（中段の連絡通路は塞いだ）
  wall('z', HZ0 - T, -HX - T, HX + T, H_HALL, [{ c: 0, w: 12, h: 6 }]);                    // 北（エレベーター凹み）
  wall('z', HZ1, -HX - T, HX + T, H_HALL, []);                                              // 南
  // 大広間の仕切り壁（南東エリアを分ける）：西壁から x=10 まで東へ、x=10 を北へ、z=-37 を東壁まで
  const PZ = -18, PX = 10, PEZ = -37;
  wall('z', PZ, -HX, PX + T, H_HALL, [], { tag: 'wall' });
  wall('x', PX, PEZ, PZ + T, H_HALL, [], { tag: 'wall' });
  wall('z', PEZ, PX + T, HX, H_HALL, [], { tag: 'wall' });

  // ---- スタート通路（南西から大広間の下手西側へ）
  // 西端 SX0（研究室の扉）から大広間まで約71m。出てすぐ戦闘にならないよう長め
  room('start', 'スタート通路', SX0, -23.5, -14, -5, 6, { tint: K.light, lampStep: 9 });
  wall('x', SX0 - 1, -15, -4, 6);                              // 西端
  wall('z', -15, SX0 - 1, -23.5, 6);                           // 北
  wall('z', HZ1, SX0 - 1, -23.5, 6);                           // 南

  // ---- 左の部屋群（西）
  const LX0 = -52, LX1 = -32;
  room('L1', '左上の部屋', LX0, LX1, -70, -54, 7, { tint: K.pale, lampStep: 9 });
  room('L2', '左中央の部屋', LX0, LX1, -53, -37, 7, { tint: K.light, lampStep: 9 });
  room('L3', '左下の部屋', LX0, LX1, -36, -20, 7, { tint: K.pale, lampStep: 9 });
  wall('x', LX0 - T, -71, -19, 7);                                                          // 西
  wall('x', LX1, -71, -19, 7, [{ c: -45, w: 7 }, { c: -28, w: 7 }]);                      // 東（左中央→連絡通路／左下→脇の部屋）
  wall('z', -71, LX0 - T, LX1 + T, 7);                                                      // 北
  wall('z', -54, LX0, LX1, 7, [{ c: -42, w: 7 }]);                                          // 左上↔左中央
  wall('z', -37, LX0, LX1, 7, [{ c: -42, w: 7 }]);                                          // 左中央↔左下
  wall('z', -20, LX0 - T, LX1 + T, 7);                                                      // 南

  // 連絡通路（左中央 → 大広間）
  room('vestW', '連絡通路', -31, -23.5, -48.5, -41.5, 6, { tint: K.light, lampStep: 8 });
  wall('z', -49.5, -31, -23.5, 6);
  wall('z', -41.5, -31, -23.5, 6);
  // 脇の細い部屋（左下の東）
  room('side', '脇の細い部屋', -31, -23.5, -36, -20, 6, { tint: K.pale, lampStep: 9 });
  wall('z', -37, -31, -23.5, 6);
  wall('z', -20, -31, -23.5, 6);

  // ---- 右の部屋：下半分（入口は下の連絡通路）と上半分（出口は上の連絡通路）。間に扉1つ
  const RX0 = 32, RX1 = 60, RZ0 = -70, RZ1 = -25, RMID = -48;
  room('RU', '右の部屋（上）', RX0, RX1, RZ0, RMID, 8, { tint: K.light, lampStep: 10, power: 1.2 });
  room('RL', '右の部屋（下）', RX0, RX1, RMID + 1, RZ1, 8, { tint: K.light, lampStep: 10, power: 1.2 });
  wall('x', RX0 - T, RZ0 - T, RZ1 + T, 8, [{ c: -63, w: 7 }, { c: -31.5, w: 7 }]);          // 西
  wall('x', RX1, RZ0 - T, RZ1 + T, 8);                                                      // 東
  wall('z', RZ0 - T, RX0, RX1, 8);                                                          // 北
  wall('z', RZ1, RX0, RX1, 8);                                                              // 南
  wall('z', RMID, RX0, RX1, 8, [{ c: 54, w: 6 }]);                                          // 上下の仕切り（東寄りに扉）
  for (const [id, c] of [['vestE1', -63], ['vestE3', -31.5]] as const) {
    room(id, '連絡通路', HX + T, RX0 - T, c - 3.5, c + 3.5, 6, { tint: K.light, lampStep: 8 });
    wall('z', c - 4.5, HX + T, RX0 - T, 6);
    wall('z', c + 3.5, HX + T, RX0 - T, 6);
  }
  // 下半分の遮蔽物
  for (const [px, pz] of [[48, -33]] as const) {
    bx('solid', K.steel, px, 0, pz, 3, 3.6, 3, true, 'cover');
    bx('glow', K.cyan, px, 2.4, pz, 3.1, 0.12, 3.1, false);
    occupy(px - 1.5, px + 1.5, pz - 1.5, pz + 1.5, 0.8);
  }

  // ---- 行き止まりへの通路（東へ、少しずつ南へずれる）
  const legX: [number, number][] = [[23.5, 33.5], [34.5, 44.5], [45.5, 55.5], [56.5, 66.5]];
  legX.forEach(([lx0, lx1], k) => {
    const zn = -13 + 2 * k, zs = -5 + 2 * k;
    room(`leg${k}`, '行き止まりへの通路', lx0, lx1, zn, zs, 6, { tint: K.light, lampStep: 10, power: 0.8 });
    wall('z', zn - T, lx0, lx1, 6);
    wall('z', zs, lx0, lx1, 6);
    if (k < 3) {
      const nzn = -13 + 2 * (k + 1), nzs = -5 + 2 * (k + 1);
      wall('x', lx1, zn - T, nzs + T, 6, [{ c: (nzn + zs) / 2, w: zs - nzn }]);
    }
  });
  // 通路の最後 → 行き止まりの部屋（戦闘があるので広め）
  room('dead', '行き止まり', 67.5, 86.5, -12, 8, 7, { tint: K.pale, lampStep: 8, power: 0.55 });
  wall('x', 66.5, -13, 9, 7, [{ c: -3, w: 8 }]);              // 通路↔部屋
  wall('x', 86.5, -13, 9, 7);                                    // 東端
  wall('z', -13, 66.5, 87.5, 7);
  wall('z', 8, 67.5, 86.5, 7);

  // ---- エレベーター凹み
  room('alcove', 'エレベーター', -6, 6, -79, -71, 8, { tint: K.dnavy, lampStep: 12, power: 0.0 });
  // 凹みの両脇の壁と奥の壁
  wall('x', -7, -80, -70, 8);
  wall('x', 6, -80, -70, 8);
  wall('z', -80, -7, 7, 8);

  // ============================================================ 大広間のアスレチック
  const dH = 7.2;        // 中二階の床の高さ
  const deckT = 0.4;
  const stairColors = [K.orange, K.teal, K.light, K.blue, K.yellow, K.steel];
  // 西の階段（積み重ねコンテナ。1段 1.2m、奥行き2.4m）
  const stairs = (x0: number, x1: number, zStart: number, dirZ: number, color0: number): void => {
    for (let i = 1; i <= 5; i++) {
      const za = zStart + dirZ * 2.4 * (i - 1), zb = zStart + dirZ * 2.4 * i;
      const col = stairColors[(i + color0) % stairColors.length];
      crate(x0, x1, Math.min(za, zb), Math.max(za, zb), 0, i * 1.2, col, i % 2 === 1, 'step');
      // 手すりの支柱ではなく側面の発光ライン
      box('glow', K.cyan, x0, x1, i * 1.2 + 0.0, i * 1.2 + 0.04, Math.min(za, zb), Math.max(za, zb), false);
    }
    occupy(x0, x1, Math.min(zStart, zStart + dirZ * 12), Math.max(zStart, zStart + dirZ * 12), 1.2);
  };
  stairs(-HX, -18, -24, -1, 0);      // 西：z -24 → -36
  // 東の階段は無し（南東エリアにアスレチックは置かない）

  // 中二階のデッキ（西・北・東のコの字）
  const deck = (x0: number, x1: number, z0: number, z1: number): void => {
    box('solid', K.light, x0, x1, dH - deckT, dH, z0, z1, true, 'deck');
    box('glow', 0x2a8aa8, x0, x1, dH - deckT - 0.04, dH - deckT, z0, z1, false);
    // 床面の縁取り
    box('solid', K.navy, x0, x1, dH, dH + 0.03, z0, z1, false);
  };
  deck(-HX, -17.5, HZ0, -36);
  deck(17.5, HX, HZ0, -38);
  deck(-17.5, 17.5, HZ0, -66);
  // デッキの支柱（細い角柱）と手すり
  const post = (x: number, z: number): void => { bx('solid', K.navy, x, 0, z, 0.6, dH - deckT, 0.6, true, 'prop'); };
  for (const z of [-66.3, -56, -46, -38.5]) post(-17.9, z);
  for (const z of [-66.3, -58, -48, -39]) post(17.9, z);
  for (const x of [-15, -9, 9, 15]) post(x, -66.3);
  // 手すり（見た目のみ・低い欄干は当たり判定なしだと落下が気になるが、床の縁は落ちてよい仕様）
  const rail = (x0: number, x1: number, z0: number, z1: number): void => {
    box('solid', K.navy, x0, x1, dH + 0.95, dH + 1.05, z0, z1, false);
    box('glow', K.cyan, x0, x1, dH + 0.5, dH + 0.56, z0, z1, false);
  };
  rail(-17.65, -17.55, -66, -49); rail(-17.65, -17.55, -43, -36);   // 西デッキ内側（ジャンプ用の切れ目 z -49..-43）
  rail(17.55, 17.65, -66, -49); rail(17.55, 17.65, -43, -38);
  rail(-17.5, 17.5, -66.05, -65.95);
  occupy(-HX, -17.5, HZ0, -36, 0); occupy(17.5, HX, HZ0, -38, 0);
  // 仕切り壁（散らばる小物を避ける）
  occupy(-HX, PX + T, PZ, PZ + T, 1.6); occupy(PX, PX + T, PEZ, PZ + T, 1.6); occupy(PX + T, HX, PEZ, PEZ + T, 1.6); occupy(-17.5, 17.5, HZ0, -66, 0);

  // 柱 2×2。上面（高さ12）が足場になる
  const PH = 12;
  const pillars: Rect[] = [[-9, -3, -49, -43], [3, 9, -49, -43], [-9, -3, -32, -26], [3, 9, -32, -26]];
  pillars.forEach(([x0, x1, z0, z1]) => {
    box('panel', K.pale, x0, x1, 0, PH, z0, z1, true, 'pillar', 3);
    box('solid', K.navy, x0 - 0.15, x1 + 0.15, 0, 1.6, z0 - 0.15, z1 + 0.15, false);
    box('hazard', K.yellow, x0 - 0.17, x1 + 0.17, 1.6, 2.2, z0 - 0.17, z1 + 0.17, false, undefined, 1.2);
    for (const y of [4.5, 8, 11.4]) box('glow', K.cyan, x0 - 0.06, x1 + 0.06, y, y + 0.14, z0 - 0.06, z1 + 0.06, false);
    box('solid', K.navy, x0 - 0.12, x1 + 0.12, PH - 0.5, PH - 0.3, z0 - 0.12, z1 + 0.12, false);
    occupy(x0, x1, z0, z1, 2.2);
  });
  // 北の2本の柱：ジェットで渡る着地台（高さ7.2）＋3段で柱の上へ
  const landW: Rect = [-11, -9, -49, -43];
  const landE: Rect = [9, 11, -49, -43];
  for (const L of [landW, landE]) {
    box('solid', K.steel, L[0], L[1], 0, dH, L[2], L[3], true, 'platform');
    box('glow', K.cyan, L[0] - 0.04, L[1] + 0.04, dH - 0.2, dH - 0.1, L[2] - 0.04, L[3] + 0.04, false);
    box('hazard', K.yellow, L[0] - 0.04, L[1] + 0.04, 0, 1.2, L[2] - 0.04, L[3] + 0.04, false, undefined, 1.0);
    occupy(L[0], L[1], L[2], L[3], 1.5);
  }
  // 柱の北面に3段（8.4, 9.6, 10.8）→ 柱の上 12.0
  const pstep = (x0: number, x1: number, top: number, color: number): void => {
    crate(x0, x1, -52, -49, 0, top, color, false, 'step');
    occupy(x0, x1, -52, -49, 1);
  };
  pstep(-11, -9, 8.4, K.orange); pstep(-9, -6, 9.6, K.teal); pstep(-6, -3, 10.8, K.blue);
  pstep(9, 11, 8.4, K.orange); pstep(6, 9, 9.6, K.teal); pstep(3, 6, 10.8, K.blue);
  // 柱の上の機材（歯車の台）
  for (const sx of [-6, 6]) {
    bx('solid', K.navy, sx, PH, -46, 1.6, 0.25, 1.6, false);
    bx('glow', K.cyan, sx, PH + 0.25, -46, 1.2, 0.05, 1.2, false);
  }

  // 床の誘導ライン（入口 → 中央 → エレベーター）
  floorStripe(-HX, -0.3, -9.7, -9.3);
  floorStripe(-0.3, 0.3, -69, -19);
  floorStripe(-0.3, HX, -9.7, -9.3);
  for (const [x0, x1, z0, z1] of pillars) {
    box('hazard', K.yellow, x0 - 1.2, x1 + 1.2, 0.005, 0.03, z0 - 1.2, z1 + 1.2, false, undefined, 1.2);
    void [x0, x1, z0, z1];
  }
  // 床の大きな円形マーク代わりの四角い枠
  for (const [x0, x1, z0, z1] of [[-14, 14, -64, -58]] as Rect[]) {
    box('glow', K.cyan, x0, x1, 0.01, 0.03, z0, z0 + 0.15, false); box('glow', K.cyan, x0, x1, 0.01, 0.03, z1 - 0.15, z1, false);
  }
  // 壁の装飾（大広間）：柱型・窓状の発光パネル
  for (let k = 0; k < 6; k++) {
    const z = -63 + k * 11;
    for (const xf of [-HX, HX]) {
      const dir = xf < 0 ? 1 : -1;
      box('solid', K.navy, xf < 0 ? xf : xf - 0.5, xf < 0 ? xf + 0.5 : xf, 0, H_HALL - 1, z - 0.4, z + 0.4, false);
      void dir;
    }
  }
  for (const xf of [-HX, HX]) {
    for (let k = 0; k < 5; k++) {
      const z = -60 + k * 11;
      box('glow', 0x27688a, xf < 0 ? xf : xf - 0.08, xf < 0 ? xf + 0.08 : xf, 11, 14.5, z - 3, z + 3, false);
      box('solid', K.navy, xf < 0 ? xf : xf - 0.12, xf < 0 ? xf + 0.12 : xf, 10.8, 11, z - 3.2, z + 3.2, false);
      box('solid', K.navy, xf < 0 ? xf : xf - 0.12, xf < 0 ? xf + 0.12 : xf, 14.5, 14.7, z - 3.2, z + 3.2, false);
    }
  }
  // 天井のトラス
  for (let k = 0; k < 7; k++) {
    const z = HZ0 + 4 + k * 9.5;
    box('solid', K.navy, -HX, HX, H_HALL - 1.4, H_HALL - 0.9, z - 0.3, z + 0.3, false);
  }
  for (const x of [-12, 0, 12]) box('solid', K.navy, x - 0.3, x + 0.3, H_HALL - 1.9, H_HALL - 1.4, HZ0, HZ1, false);

  // 歯車の置き場所は小物で塞がない
  for (const [gx, gz] of [[-47, -65.5], [-37, -65.5], [57, -67.5], [57, -28], [82, -2], [-25.4, -28]]) occupy(gx, gx, gz, gz, 2.6);
  // 大広間の機材（床）：入口まわりのカバー、積み重ねコンテナ、棚、タンク
  const hallKeep: Rect[] = [
    [-HX, HX, -17, -4],     // 南東エリア（戦闘）は小物を置かない
    [10, HX + 1, -37, -4],
    [-HX, -14, -50, -40],   // 左中央への連絡通路前
    [14, HX + 1, -69, -46], // 右の部屋からの出口前
    [-14, 14, -70, -52],    // エレベーター前の戦闘エリア
    [-3.5, 3.5, -70, -17],  // 中央の通路
    [-HX, -17, -39, -23],   // 西の階段まわり
  ];
  // 手書きの主要カバー
  // 壁沿いの大物（床中央は空ける）
  container(-12, -6.4, true, K.teal);
  container(12, -6.4, true, K.orange);
  crateStack(-21.3, -20, 2.4, 3, 2, K.blue);
  tank(-15.5, -66.5, 1.5, 5.4); tank(-12.5, -66.5, 1.5, 5.4, K.green);
  tank(12.5, -66.5, 1.5, 5.4, 0xff9ad0); tank(15.5, -66.5, 1.5, 5.4);
  // 北面に近い棚（デッキの下）
  shelf('W', -57, -HX, 9, 4.8);
  shelf('E', -41.5, HX, 5, 4.8);
  
  // 探索側（西・北東）は実験室らしく密に
  scatter([-HX, HX, HZ0, HZ1], 16, hallKeep, ['crate', 'crate', 'desk', 'jars', 'cart', 'barrels', 'tank', 'desk']);

  // ---- 脇の細い部屋：非常用電源装置（弾かアームの電気で作動）
  const PWX = -25.4, PWZ = -28;
  bx('solid', K.steel, PWX, 0, PWZ, 1.5, 2.3, 1.5, true, 'machine');
  bx('solid', K.dnavy, PWX, 0, PWZ, 1.7, 0.35, 1.7, false);
  bx('solid', K.navy, PWX, 2.3, PWZ, 1.7, 0.2, 1.7, false);
  // 電池セル（正面＝西面に発光、通電で明るくなる）
  for (let i = 0; i < 3; i++) bx('cable', K.green, PWX - 0.78, 0.55 + i * 0.35, PWZ, 0.06, 0.22, 1.1, false);
  bx('solid', K.yellow, PWX - 0.78, 0.42, PWZ, 0.05, 0.08, 1.3, false);
  occupy(PWX - 3.2, PWX + 1, PWZ - 3.2, PWZ + 3.2, 0.5);

  // ---- エレベーター（かご）
  const EL = { x0: -2.6, x1: 2.6, z0: -79, z1: -75.4 };
  box('solid', K.dnavy, -3.2, -3.0, 0, 5, -79, -75, true, 'elevator');
  box('solid', K.dnavy, 3.0, 3.2, 0, 5, -79, -75, true, 'elevator');
  box('solid', K.dnavy, -3.2, 3.2, 5, 5.4, -79, -74.8, true, 'elevator');
  box('panel', K.pale, -3.0, 3.0, 0, 5, -79.0, -78.8, false, undefined, 2);
  box('floor', K.mid, -3.0, 3.0, 0.0, 0.04, -79, -75, false, undefined, 1.2);
  // かごの手すりパネル
  box('solid', K.steel, -2.4, 2.4, 1.0, 1.15, -78.8, -78.6, false);
  // 凹みの床の誘導ライン
  floorStripe(-0.3, 0.3, -74.6, -70, K.red);

  // ---- 脇の細い部屋・左の部屋・他に小物をちらす
  const doorKeep = (c: number, side: 'W' | 'E' | 'N' | 'S', edge: number, w = 7, depth = 6): Rect => {
    if (side === 'W') return [edge, edge + depth, c - w / 2 - 0.5, c + w / 2 + 0.5];
    if (side === 'E') return [edge - depth, edge, c - w / 2 - 0.5, c + w / 2 + 0.5];
    if (side === 'N') return [c - w / 2 - 0.5, c + w / 2 + 0.5, edge, edge + depth];
    return [c - w / 2 - 0.5, c + w / 2 + 0.5, edge - depth, edge];
  };
  // 左上（戦闘なし：密に）
  scatter([LX0, LX1, -70, -54], 8, [doorKeep(-42, 'S', -54)]);
  shelf('W', -62, LX0, 8, 3.6); shelf('E', -62, LX1, 6, 3.4); shelf('N', -37, -70, 7, 3.6);
  // 左中央
  scatter([LX0, LX1, -53, -37], 9, [doorKeep(-42, 'N', -53), doorKeep(-42, 'S', -37), doorKeep(-45, 'E', LX1)]);
  shelf('W', -45, LX0, 9, 3.6);
  // 左下
  scatter([LX0, LX1, -36, -20], 2, [doorKeep(-42, 'N', -36), doorKeep(-28, 'E', LX1)]);
  shelf('W', -28, LX0, 8, 3.6);
  // 脇の細い部屋
  scatter([-31, -23.5, -36, -20], 5, [doorKeep(-28, 'W', -31, 7, 4), [-29.5, -23.5, -32, -24]], ['crate', 'jars', 'cart', 'barrels', 'tank']);
  // スタート通路
  scatter([SX0, -23.5, -14, -5], 3, [[SX0, SX0 + 9, -14, -5], [-30, -23, -14, -5], [SX0, -23.5, -11.5, -7.5]], ['crate', 'barrels', 'cart', 'crate', 'jars']);
  // 右の部屋
  scatter([RX0, RX1, RZ0, RMID], 3, [doorKeep(-63, 'W', RX0, 7, 4), doorKeep(54, 'S', RMID, 7, 5)], ['crate', 'crate', 'desk', 'cart']);
  scatter([RX0, RX1, RMID + 1, RZ1], 10, [doorKeep(-31.5, 'W', RX0, 7, 4), doorKeep(54, 'N', RMID + 1, 7, 5)], ['crate', 'crate', 'desk', 'jars', 'barrels', 'cart', 'tank', 'desk', 'jars']);
  // 通路4本・行き止まり
  legX.forEach(([lx0, lx1], k) => {
    const zn = -13 + 2 * k;
    scatter([lx0, lx1, zn, zn + 8], 2, [[lx0, lx1, zn + 2.5, zn + 5.5]], ['crate', 'barrels', 'cart', 'jars']);
  });
  scatter([67.5, 86.5, -12, 8], 2, [[67.5, 72, -7, 1]], ['crate', 'desk', 'barrels']);

  // 床ケーブルの束
  for (const [x, z, len, ax] of [[-50, -10, 8, true], [-40, -6.5, 6, true], [-18, -34, 6, false], [18, -52, 8, false], [-45, -66, 7, true], [40, -30, 6, true]] as const) {
    cableRun(x, z, len, ax, pick([K.dnavy, K.navy, K.dnavy]));
  }

  // ---- スタート：スパーク研究室の隔壁ドア（西端の壁。プレイヤーはその外側に立つ）
  const HATCH = { x: SX0, z: -9.5 };
  {
    const fx = SX0; // 壁の内側の面
    // ドア枠（ハザード）と二枚扉
    box('hazard', K.yellow, fx, fx + 0.35, 0, 5.2, HATCH.z - 3.8, HATCH.z - 3.2, false, undefined, 0.8);
    box('hazard', K.yellow, fx, fx + 0.35, 0, 5.2, HATCH.z + 3.2, HATCH.z + 3.8, false, undefined, 0.8);
    box('hazard', K.yellow, fx, fx + 0.35, 4.6, 5.2, HATCH.z - 3.8, HATCH.z + 3.8, false, undefined, 0.8);
    for (const sgn of [-1, 1]) {
      const z0 = sgn < 0 ? HATCH.z - 3.2 : HATCH.z + 0.06, z1 = sgn < 0 ? HATCH.z - 0.06 : HATCH.z + 3.2;
      box('solid', 0x8d97a3, fx, fx + 0.45, 0, 4.6, z0, z1, false);
      box('solid', K.dnavy, fx + 0.45, fx + 0.5, 0.4, 4.2, z0 + 0.2, z1 - 0.2, false);
      for (const y of [1.0, 2.3, 3.6]) box('solid', K.steel, fx + 0.45, fx + 0.6, y, y + 0.18, z0 + 0.1, z1 - 0.1, false);
    }
    // 黄色い回転ハンドル（中央）
    cyl('solid', K.dnavy, fx + 0.6, 2.3, HATCH.z, 0.5, 0.25, 'x', false, 16);
    cyl('solid', K.yellow, fx + 0.8, 2.3, HATCH.z, 0.85, 0.12, 'x', false, 20);
    cyl('solid', 0x8d97a3, fx + 0.82, 2.3, HATCH.z, 0.6, 0.14, 'x', false, 20);
    box('solid', K.yellow, fx + 0.85, fx + 0.97, 1.45, 3.15, HATCH.z - 0.07, HATCH.z + 0.07, false);
    box('solid', K.yellow, fx + 0.85, fx + 0.97, 2.23, 2.37, HATCH.z - 0.85, HATCH.z + 0.85, false);
    // 床のハザード
    box('hazard', K.yellow, fx, fx + 2.2, 0.005, 0.03, HATCH.z - 3.6, HATCH.z + 3.6, false, undefined, 1.2);
  }

  // ---- ケーブル（電源装置 → エレベーター）
  const cable: { x: number; y: number; z: number }[] = [
    { x: PWX, y: 2.4, z: PWZ }, { x: PWX, y: 5.6, z: PWZ }, { x: PWX, y: 5.6, z: -45 }, { x: -HX + 1.2, y: 5.6, z: -45 },
    { x: -HX + 1.2, y: 5.6, z: -69.4 }, { x: -5.5, y: 5.6, z: -69.4 }, { x: -5.5, y: 5.6, z: -73 }, { x: -5.5, y: 2.2, z: -73 },
  ];

  // ---- 歯車（強化素材）
  gears.push(
    { x: -47, y: 1.1, z: -65.5, area: '左上の部屋' },
    { x: -37, y: 1.1, z: -65.5, area: '左上の部屋' },
    { x: 57, y: 1.1, z: -67.5, area: '右の部屋（上）' },
    { x: 57, y: 1.1, z: -28, area: '右の部屋（下）' },
    { x: 82, y: 1.1, z: -2, area: '行き止まり' },
    { x: -6, y: PH + 1.1, z: -46, area: '大広間（柱の上）' },
    { x: 6, y: PH + 1.1, z: -46, area: '大広間（柱の上）' },
  );
  // 歯車の場所を物置きで塞がないように、台座を置く
  for (const g of gears) {
    if (g.y < 3) {
      box('glow', K.cyan, g.x - 0.9, g.x + 0.9, 0.01, 0.04, g.z - 0.9, g.z + 0.9, false);
      cyl('solid', K.navy, g.x, 0.0, g.z, 0.8, 0.12, 'y', false, 16);
    }
  }

  // ---- 充電ポイント・修理キット
  const pads = [
    { x: -45, y: 0, z: -9.5 }, { x: -3, y: 0, z: -14 }, { x: -40, y: 0, z: -63 }, { x: 46, y: 0, z: -57 },
    { x: 0, y: 0, z: -66 }, { x: 74, y: 0, z: -3 }, { x: -42, y: 0, z: -29 },
  ];
  const kits = [
    { x: -30, y: 0, z: -12 }, { x: -21, y: 0, z: -8 }, { x: -49, y: 0, z: -23 }, { x: 20, y: 0, z: -8 }, { x: -20, y: 0, z: -66 },
    { x: 34.5, y: 0, z: -41 }, { x: 52, y: 0, z: -57 }, { x: 70, y: 0, z: 2 },
    { x: 0, y: 0, z: -20 }, { x: -40, y: 0, z: -45 }, { x: 40, y: 0, z: -40 },
  ];

  // ---- 出現ゾーン
  zones.push(
    // スタート通路：東端の2体。1体でも目覚めたら全員起きる。全滅するまで東のゲートは閉じたまま
    { id: 'start', name: 'スタート通路', x0: SX0 - 1, x1: -24, z0: -15, z1: -4, mode: 'zone', face: { x: SX0 + 6, z: -9.5 }, spawns: [
      { kind: 'crawler', x: -35, z: -11.5 }, { kind: 'walker', x: -31, z: -7.5 },
    ] },
    { id: 'dead', name: '行き止まり', x0: 66.5, x1: 87, z0: -13, z1: 9, mode: 'trap', spawns: [
      { kind: 'crawler', x: 78, z: -8.5 }, { kind: 'crawler', x: 78, z: 4.5 }, { kind: 'drone', x: 74, z: -2 },
    ] },
    { id: 'RL', name: '右の部屋（下）', x0: RX0, x1: RX1, z0: RMID, z1: RZ1, mode: 'zone', spawns: [
      { kind: 'crawler', x: 40, z: -28 }, { kind: 'drone', x: 50, z: -40 },
    ] },
    { id: 'RU', name: '右の部屋（上）', x0: RX0, x1: RX1, z0: RZ0, z1: RMID, mode: 'trap', spawns: [
      { kind: 'walker', x: 40, z: -58 }, { kind: 'crawler', x: 46, z: -66 },
      { kind: 'crawler', x: 52, z: -60, mode: 'drop' }, { kind: 'drone', x: 44, z: -54 },
    ] },
    { id: 'L2', name: '左中央の部屋', x0: LX0, x1: LX1, z0: -53, z1: -37, mode: 'zone', spawns: [
      { kind: 'crawler', x: -48, z: -48 },
    ] },
    { id: 'L3', name: '左下の部屋', x0: LX0, x1: LX1, z0: -36, z1: -20, mode: 'trap', spawns: [
      { kind: 'crawler', x: -48, z: -30 }, { kind: 'crawler', x: -44, z: -23.5 }, { kind: 'drone', x: -41, z: -29 },
    ] },
    // エレベーター最終戦：左右から。ヘビー＋ガンナー＋クローラー2体
    { id: 'final', name: 'エレベーター前', x0: -22, x1: 22, z0: -70, z1: -52, mode: 'trap', spawns: [
      { kind: 'heavy', x: -9, z: -62, mode: 'drop' }, { kind: 'gunner', x: 9, z: -62, mode: 'drop' },
      { kind: 'crawler', x: -7.5, z: -67.5 }, { kind: 'crawler', x: 7.5, z: -67.5 },
    ] },
  );

  // ---- ゲート（施錠ドア）。rect は壁の開口
  const gate = (id: string, label: string, trigger: string, axis: 'x' | 'z', r: Rect, closed: boolean): void => {
    gates.push({ id, label, trigger, axis, x0: r[0], x1: r[1], z0: r[2], z1: r[3], closed });
  };
  gate('start', 'スタート出口', '通路の敵を全滅で開く', 'x', [-23.5, -22.5, -14, -5], true);
  gate('dead', '行き止まりの入口', '歯車に近づくと閉まる／敵を倒すと開く', 'x', [66.5, 67.5, -7, 1], false);
  gate('rlow', '右の部屋 下の入口', '上半分に入ると永久に閉まる', 'x', [RX0 - T, RX0, -35, -28], false);
  gate('rmid', '右の部屋 上下の扉', '上半分に入ると閉まる／敵を倒すと開く', 'z', [51, 57, RMID, RMID + 1], false);
  gate('rexit', '右の部屋 上の出口', '上の敵を全滅で開く。通ると閉まる', 'x', [HX, HX + T, -66.5, -59.5], true);
  gate('l2', '西の連絡通路', 'エレベーターに近づくと開く', 'x', [-HX - T, -HX, -48.5, -41.5], true);
  gate('l3n', '左下 北の扉', '電源後に左下へ戻ると閉まる／敵を倒すと開く', 'z', [-45.5, -38.5, -37, -36], false);
  gate('side', '左下 脇の部屋の扉', '電源後に左下へ戻ると閉まる／敵を倒すと開く', 'x', [LX1, LX1 + T, -31.5, -24.5], false);

  // ---- 休眠コンテナ（pod）／降下着地点が壁・小物に埋まらないよう、最寄りの空きへずらす
  const surfTop = (x: number, z: number, fl: number): boolean => prims.some((q) =>
    q.t === 'box' && q.col && q.tag !== 'wall' && q.tag !== 'ceiling' && q.tag !== 'partition'
    && Math.abs(q.y1 - fl) < 0.06 && x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1);
  const podFits = (x: number, z: number, fl: number, kind: EnemyKind, room: RoomRect | undefined, margin: number): boolean => {
    const { w, d, h } = podSize(ENEMIES[kind].radius);
    const half = Math.max(w, d) / 2 + margin;
    if (room && (x - half < room.x0 || x + half > room.x1 || z - half < room.z0 || z + half > room.z1)) return false;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) if (!surfTop(x + dx * half, z + dz * half, fl)) return false;
    for (const q of prims) {
      if (q.t !== 'box' || !q.col || q.tag === 'floor') continue;
      if (x + half > q.x0 && x - half < q.x1 && z + half > q.z0 && z - half < q.z1 && q.y1 > fl + 0.3 && q.y0 < fl + h) return false;
    }
    return true;
  };
  const placed: { x: number; z: number }[] = [];
  const settle = (s: SpawnDef): void => {
    if (s.kind === 'drone') return;
    const fl = s.floor ?? 0;
    const room = rooms.find((r) => s.x > r.x0 && s.x < r.x1 && s.z > r.z0 && s.z < r.z1);
    const sep = (x: number, z: number) => placed.every((o) => Math.hypot(o.x - x, o.z - z) > 3.2);
    for (const margin of [0.8, 0.5, 0.15]) {
      if (podFits(s.x, s.z, fl, s.kind, room, margin) && sep(s.x, s.z)) { placed.push({ x: s.x, z: s.z }); return; }
      for (let rho = 0.5; rho <= 9; rho += 0.5) {
        for (let k = 0; k < 20; k++) {
          const a = (k / 20) * Math.PI * 2;
          const x = s.x + Math.cos(a) * rho, z = s.z + Math.sin(a) * rho;
          if (podFits(x, z, fl, s.kind, room, margin) && sep(x, z)) { s.x = +x.toFixed(2); s.z = +z.toFixed(2); placed.push({ x: s.x, z: s.z }); return; }
        }
      }
    }
  };
  for (const z of zones) { for (const s of z.spawns) settle(s); }

  return {
    prims, rooms, signs, doors, lamps, gears, pads, kits, zones, gates,
    start: { x: HATCH.x + 6, z: HATCH.z, yaw: -Math.PI / 2, hatchX: HATCH.x, hatchZ: HATCH.z },
    power: { x: PWX, y: 1.5, z: PWZ, r: 1.6 },
    // 大広間のテスト用：西デッキの縁（7.2m）・柱の上の縁（12m）・天井（→北西の着地台へ飛び移る）
    grapples: [
      { kind: 'ledge', x: -17.5, y: dH, z: -41, nx: 1, ny: 0, nz: 0, label: '西デッキ縁 7.2m' },
      { kind: 'ledge', x: -6, y: PH, z: -26, nx: 0, ny: 0, nz: 1, label: '柱の上 12m' },
      { kind: 'ceiling', x: -10, y: H_HALL, z: -37, nx: 0, ny: -1, nz: 0, landAt: { x: -10, y: dH, z: -46 }, label: '天井→着地台' },
    ],
    route: [
      { n: 1, x: -70, z: -9.5, label: 'スタート通路' }, { n: 2, x: -28, z: -9.5, label: '南東エリア' },
      { n: 3, x: 76, z: -2, label: '行き止まり' }, { n: 4, x: 46, z: -36, label: '右 下' }, { n: 5, x: 46, z: -60, label: '右 上' },
      { n: 6, x: 0, z: -50, label: '大広間' }, { n: 7, x: 0, z: -66, label: 'エレベーター（電源なし）' },
      { n: 8, x: -42, z: -45, label: '左中央' }, { n: 9, x: -27, z: -26, label: '電源' }, { n: 10, x: -42, z: -28, label: '左下の罠' },
      { n: 11, x: -42, z: -62, label: '左上' }, { n: 12, x: 0, z: -58, label: '最終戦' },
    ],
    elevator: { ...EL, doorX0: -3.0, doorX1: 3.0, doorZ: -75.1, doorH: 5, approachX: 0, approachZ: -72 },
    cable,
    maxStep: MAX_STEP,
  };
}
