// 「ドレイン装置へ向かうダンジョン」の間取りと配置データ（three に依存しない純データ）。設計は drain.ts の冒頭を参照。
// 座標：x=東、z=南（北＝-z＝平面図の上）、y=上。床は y=0（A・C・D・E・F・I・G）。B とロープの高さは y=32。
//
//        B(y32) ═══ロープ═══ G(目的地・高い)        ポンプ室(閉)       F
//         │ （足場が点在する）   │ ←扉(セキュリティ3つ)                   │ ←狭い暗い通路
//         │  縦の吹き抜け       E ─────(レーザー x=86)───────────── E東
//         │                  I   │ ←縦通路
//         A ──── C ──── D(戦闘)───┘
import type { EnemyKind } from '../../config/balance';

export type Mat = 'wall' | 'floor' | 'ceil' | 'metal' | 'dark' | 'glow' | 'hazard' | 'pipe' | 'tank' | 'rope' | 'hidden';

export interface Box {
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
  m: Mat; c: number;
  /** 当たり判定を作る */
  col: boolean;
  tag?: string;
}
export interface Cyl { cx: number; cy: number; cz: number; r: number; len: number; axis: 'x' | 'y' | 'z'; m: Mat; c: number; col: boolean }
export interface RoomRect { id: string; name: string; x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; h: number }
export interface Lamp { x: number; y: number; z: number; color: number; room: string; power: number }
export interface SpawnDef { kind: EnemyKind; x: number; z: number; floor?: number; mode?: 'pod' | 'drop' | 'awake'; neutral?: boolean }
export interface ZoneDef {
  id: string; name: string;
  /** zone＝近づくと起きる／trap＝入ると扉が閉まり、トリガーで一斉に起きる */
  mode: 'zone' | 'trap';
  face: { x: number; z: number };
  spawns: SpawnDef[];
  /** trap の起動範囲（y 付き） */
  trigger?: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number };
  /** trap：戦闘中に閉まる扉 */
  closes?: string[];
  /** trap：戦闘が終わると開く扉（closes と同じとは限らない） */
  opens?: string[];
}
/** シャッター（扉）。開口は x0..x1 × z0..z1、床 y0 から高さ h */
export interface GateDef { id: string; x0: number; x1: number; z0: number; z1: number; y0: number; h: number; closed: boolean; color: number; label: string }
export interface GrappleDef { x: number; y: number; z: number; nx: number; nz: number; label: string }
/** 動く足場（天面 y。axis 方向に amp だけ往復する） */
export interface MovingPlatform { id: string; x: number; y: number; z: number; sx: number; sz: number; axis: 'x' | 'z'; amp: number; speed: number; phase: number }
/** 壊せるブロック（電気＝溜め撃ちで壊れる） */
export interface BreakableDef { id: string; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; face: '+z' | '-z' | '+x' | '-x'; label: string }
/** セキュリティ装置（電源）：吸収アームで吸い尽くす／弾やアームの電撃で壊すと作動停止 */
export interface SecurityDef { id: 'I' | 'D' | 'F'; x: number; y: number; z: number; r: number; label: string }
export interface Plan {
  boxes: Box[];
  cyls: Cyl[];
  rooms: RoomRect[];
  lamps: Lamp[];
  zones: ZoneDef[];
  gates: GateDef[];
  grapples: GrappleDef[];
  platforms: MovingPlatform[];
  breakables: BreakableDef[];
  securities: SecurityDef[];
  /** E の隠し主電源（レーザーを止める） */
  mainPower: { x: number; y: number; z: number; r: number };
  /** E の中央を仕切るレーザー（当たり判定の箱と見た目の位置） */
  laser: { x0: number; x1: number; z0: number; z1: number; y1: number; machines: { x: number; z: number }[] };
  /** 落ちたら即死の場所（足元が y 未満で、この範囲にいたら死亡） */
  pits: { x0: number; x1: number; z0: number; z1: number; y: number; label: string }[];
  /** A の地下にあるホログラムデコイ */
  decoy: { x: number; y: number; z: number };
  /** G の扉（ドレイン装置の部屋へ）。調べる範囲 */
  drainDoor: { x: number; y: number; z: number; w: number; h: number; reach: number };
  /** チェックポイント（やられたら再開する地点） */
  checkpoints: Record<'entrance' | 'bTop' | 'rope' | 'dFront' | 'eWest' | 'goal', { x: number; y: number; z: number; yaw: number }>;
  /** チェックポイントを通過扱いにする範囲（入ったら更新） */
  checkpointZones: { id: 'entrance' | 'bTop' | 'rope' | 'dFront' | 'eWest' | 'goal'; x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }[];
  /** 吹き抜けでドローンを湧かせる範囲 */
  spawner: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; kinds: EnemyKind[]; interval: number; max: number };
  /** 吹き抜けの中（spawner が動く範囲）と、ロープの範囲 */
  shaft: { x0: number; x1: number; z0: number; z1: number };
  /** G のドローン用ハッチ・ステージの出口はない。スタート地点 */
  start: { x: number; z: number; yaw: number };
  /** 部屋の内側の中心（テスト・案内用） */
  centers: Record<string, { x: number; z: number }>;
  /** 隠し通路（ダクト）の範囲 */
  duct: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
}

export const T = 1;
/** B と綱渡りの床の高さ */
export const B_Y = 32;
/** 隠し通路の床の高さ */
export const DUCT_Y = 40;
/** 空中の足場の厚み（側面にグラップルで刺さって縁によじ登れる高さ） */
export const PLATFORM_THICK = 2.8;
/** レーザーの x */
export const LASER_X = 86;

const K = {
  wall: 0x7c8590, wallDark: 0x4d5560, floor: 0x3e4550, ceil: 0x30363f, metal: 0x66707c, red: 0xff3a2a, cyan: 0x52e8ff,
  amber: 0xffb040, steel: 0x59636f, pipe: 0x8a6a48, tank: 0x5f7c8c, green: 0x3dff7a, navy: 0x203c70,
};

export function generateDrain(): Plan {
  const boxes: Box[] = [];
  const cyls: Cyl[] = [];
  const rooms: RoomRect[] = [];
  const lamps: Lamp[] = [];
  const gates: GateDef[] = [];
  const grapples: GrappleDef[] = [];

  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: Mat, c: number, col = true, tag?: string): void => {
    boxes.push({ x0, x1, y0, y1, z0, z1, m, c, col, tag });
  };
  const bx = (cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, m: Mat, c: number, col = true, tag?: string): void => {
    box(cx - sx / 2, cx + sx / 2, y0, y0 + sy, cz - sz / 2, cz + sz / 2, m, c, col, tag);
  };
  const cyl = (cx: number, cy: number, cz: number, r: number, len: number, axis: 'x' | 'y' | 'z', m: Mat, c: number, col = false): void => {
    cyls.push({ cx, cy, cz, r, len, axis, m, c, col });
  };

  interface Op { c: number; w: number; h: number; y0?: number }
  /**
   * 壁。axis='x'：厚み方向が x（南北に延びる。x=min..min+1）、'z'：厚み方向が z（東西に延びる）。
   * a..b は延び方向、h は高さ、ops は開口（中心・幅・上端 h・下端 y0）。yb は壁の根元の高さ
   */
  const wall = (axis: 'x' | 'z', min: number, a: number, b: number, h: number, ops: Op[] = [], yb = 0, m: Mat = 'wall'): void => {
    const R = (u0: number, u1: number, y0: number, y1: number): void => {
      if (u1 - u0 < 0.02 || y1 - y0 < 0.02) return;
      if (axis === 'x') box(min, min + T, yb + y0, yb + y1, u0, u1, m, m === 'wall' ? K.wall : K.wallDark, true, 'wall');
      else box(u0, u1, yb + y0, yb + y1, min, min + T, m, m === 'wall' ? K.wall : K.wallDark, true, 'wall');
    };
    let cur = a;
    for (const op of [...ops].sort((p, q) => p.c - q.c)) {
      R(cur, op.c - op.w / 2, 0, h);
      if (op.y0) R(op.c - op.w / 2, op.c + op.w / 2, 0, op.y0);
      R(op.c - op.w / 2, op.c + op.w / 2, op.h, h);
      cur = op.c + op.w / 2;
    }
    R(cur, b, 0, h);
  };

  /** 長方形から穴を引いた残りの長方形群 */
  type R4 = [number, number, number, number]; // x0,x1,z0,z1
  const subtract = (base: R4, holes: R4[]): R4[] => {
    let cur: R4[] = [base];
    for (const h of holes) {
      const next: R4[] = [];
      for (const r of cur) {
        if (h[1] <= r[0] || h[0] >= r[1] || h[3] <= r[2] || h[2] >= r[3]) { next.push(r); continue; }
        if (h[0] > r[0]) next.push([r[0], h[0], r[2], r[3]]);
        if (h[1] < r[1]) next.push([h[1], r[1], r[2], r[3]]);
        const x0 = Math.max(r[0], h[0]), x1 = Math.min(r[1], h[1]);
        if (h[2] > r[2]) next.push([x0, x1, r[2], h[2]]);
        if (h[3] < r[3]) next.push([x0, x1, h[3], r[3]]);
      }
      cur = next;
    }
    return cur;
  };
  const floor = (x0: number, x1: number, z0: number, z1: number, yb = 0, holes: R4[] = [], c = K.floor): void => {
    for (const [a, b, d, e] of subtract([x0, x1, z0, z1], holes)) box(a, b, yb - 1, yb, d, e, 'floor', c, true, 'floor');
  };

  /** 矩形の部屋：四方の壁・床・天井・天井灯。ops は各辺の開口 */
  const room = (id: string, name: string, x0: number, x1: number, z0: number, z1: number, h: number,
    ops: { n?: Op[]; s?: Op[]; w?: Op[]; e?: Op[] } = {},
    opt: { yb?: number; noWall?: ('n' | 's' | 'w' | 'e')[]; noCeil?: boolean; noFloor?: boolean; holes?: R4[]; lampN?: number; lamp?: number; power?: number; noRoom?: boolean } = {}): void => {
    const yb = opt.yb ?? 0;
    if (!opt.noRoom) rooms.push({ id, name, x0, x1, z0, z1, y0: yb, y1: yb + h, h });
    const no = opt.noWall ?? [];
    if (!no.includes('n')) wall('z', z0 - T, x0 - T, x1 + T, h, ops.n, yb);
    if (!no.includes('s')) wall('z', z1, x0 - T, x1 + T, h, ops.s, yb);
    if (!no.includes('w')) wall('x', x0 - T, z0, z1, h, ops.w, yb);
    if (!no.includes('e')) wall('x', x1, z0, z1, h, ops.e, yb);
    if (!opt.noFloor) floor(x0 - T, x1 + T, z0 - T, z1 + T, yb, opt.holes ?? []);
    if (!opt.noCeil) box(x0 - T, x1 + T, yb + h, yb + h + 1, z0 - T, z1 + T, 'ceil', K.ceil, true, 'ceiling');
    const n = opt.lampN ?? Math.max(1, Math.round(((x1 - x0) * (z1 - z0)) / 150));
    const nx = Math.max(1, Math.round(Math.sqrt(n * (x1 - x0) / (z1 - z0))));
    const nz = Math.max(1, Math.round(n / nx));
    if (opt.power !== 0) {
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const lx = x0 + ((i + 0.5) * (x1 - x0)) / nx, lz = z0 + ((j + 0.5) * (z1 - z0)) / nz;
        if (!opt.noCeil) box(lx - 1, lx + 1, yb + h - 0.08, yb + h, lz - 0.3, lz + 0.3, 'glow', opt.lamp ?? 0xcfe0ff, false);
        lamps.push({ x: lx, y: yb + h - 0.3, z: lz, color: opt.lamp ?? 0xcfe0ff, room: id, power: opt.power ?? 0.8 });
      }
    }
  };
  /** 通路（壁2枚・床・天井）。axis='x'：東西、'z'：南北 */
  const corridor = (id: string, axis: 'x' | 'z', a: number, b: number, lo: number, hi: number, h: number, lamp = 0xbfd6ff, power = 0.5): void => {
    if (axis === 'x') {
      wall('z', lo - T, a, b, h); wall('z', hi, a, b, h);
      floor(a, b, lo - T, hi + T);
      box(a, b, h, h + 1, lo - T, hi + T, 'ceil', K.ceil, true, 'ceiling');
      for (let u = a + 3; u < b - 1; u += 7) { box(u - 0.5, u + 0.5, h - 0.06, h, (lo + hi) / 2 - 0.25, (lo + hi) / 2 + 0.25, 'glow', lamp, false); if (power > 0) lamps.push({ x: u, y: h - 0.3, z: (lo + hi) / 2, color: lamp, room: id, power }); }
    } else {
      wall('x', lo - T, a, b, h); wall('x', hi, a, b, h);
      floor(lo - T, hi + T, a, b);
      box(lo - T, hi + T, h, h + 1, a, b, 'ceil', K.ceil, true, 'ceiling');
      for (let u = a + 3; u < b - 1; u += 7) { box((lo + hi) / 2 - 0.25, (lo + hi) / 2 + 0.25, h - 0.06, h, u - 0.5, u + 0.5, 'glow', lamp, false); if (power > 0) lamps.push({ x: (lo + hi) / 2, y: h - 0.3, z: u, color: lamp, room: id, power }); }
    }
  };
  /** 下り階段（南へ下る）。step 数 n、1段 riser・run。最上段の手前が (x0..x1, zStart)。階段の下の天井＝上の床 */
  const stairsDown = (x0: number, x1: number, zStart: number, n: number, riser: number, run: number, yTop = 0): number => {
    for (let i = 0; i < n; i++) box(x0, x1, yTop - (n + 1) * riser, yTop - (i + 1) * riser, zStart + i * run, zStart + (i + 1) * run, 'metal', K.steel, true, 'step');
    return zStart + n * run;
  };
  const deco = {
    tank: (x: number, z: number, r = 1.1, h = 3.6): void => {
      cyl(x, h / 2, z, r, h, 'y', 'tank', K.tank, true);
      cyl(x, h + 0.2, z, r * 0.7, 0.4, 'y', 'metal', K.steel, false);
      cyl(x, h * 0.55, z, r + 0.05, 0.18, 'y', 'glow', 0x52e8ff, false);
    },
    pump: (x: number, z: number): void => {
      bx(x, 0, z, 1.8, 1.0, 1.2, 'metal', K.steel, true);
      cyl(x - 0.4, 1.5, z, 0.45, 1.0, 'y', 'pipe', K.pipe, false);
      cyl(x + 0.5, 0.5, z, 0.25, 1.4, 'x', 'pipe', K.pipe, false);
      bx(x + 0.5, 1.0, z - 0.62, 0.3, 0.2, 0.05, 'glow', K.amber, false);
    },
    generator: (x: number, z: number): void => {
      bx(x, 0, z, 2.2, 2.0, 1.4, 'metal', K.wallDark, true);
      bx(x, 1.2, z - 0.72, 1.6, 0.18, 0.05, 'glow', K.cyan, false);
      bx(x - 0.7, 0.4, z - 0.72, 0.25, 0.25, 0.05, 'glow', K.green, false);
    },
    cabinet: (x: number, z: number): void => {
      bx(x, 0, z, 1.0, 2.4, 0.9, 'dark', 0x2a3038, true);
      bx(x, 1.5, z - 0.46, 0.6, 0.12, 0.04, 'glow', K.red, false);
    },
  };
  type DecoKind = keyof typeof deco;
  /** 壁沿いに装置を並べる（x 方向に等間隔）。開口を避けるため skip 範囲を渡す */
  const row = (z: number, xa: number, xb: number, step: number, kinds: DecoKind[], skip: [number, number][] = []): void => {
    let i = 0;
    for (let x = xa; x <= xb; x += step, i++) {
      if (skip.some(([a, b]) => x > a - 1.5 && x < b + 1.5)) continue;
      (deco[kinds[i % kinds.length]] as (x: number, z: number) => void)(x, z);
    }
  };
  /** 配管（天井近く）の折れ線。axis 揃いの線分をつなぐ */
  const pipeRun = (pts: [number, number, number][], r = 0.22, m: Mat = 'pipe', c = K.pipe): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0, z0] = pts[i], [x1, y1, z1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      const axis = Math.abs(x1 - x0) > 1e-6 ? 'x' : Math.abs(y1 - y0) > 1e-6 ? 'y' : 'z';
      cyl((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, r, len + r * 2, axis, m, c, false);
      cyl(x1, y1, z1, r * 1.35, r * 1.2, axis, 'metal', K.steel, false);
    }
  };
  /** 床を這うケーブル（細い箱＋光る筋）。G の扉へ向かう */
  const cable = (pts: [number, number][], w = 0.35): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      box(Math.min(x0, x1) - w / 2, Math.max(x0, x1) + w / 2, 0, 0.22, Math.min(z0, z1) - w / 2, Math.max(z0, z1) + w / 2, 'dark', 0x20262e, false);
      box(Math.min(x0, x1) - w / 6, Math.max(x0, x1) + w / 6, 0.22, 0.26, Math.min(z0, z1) - w / 6, Math.max(z0, z1) + w / 6, 'glow', 0x2a7a90, false);
    }
  };

  // ================================================================ 部屋の座標
  const A = { x0: 4, x1: 30, z0: 66, z1: 90 };
  const HALL = { x0: 4, x1: 30, z0: 10, z1: 66 };          // A の北の巨大な吹き抜け
  const Bq = { x0: 4, x1: 24, z0: 10, z1: 28 };             // 高い所の B
  const C = { x0: 44, x1: 66, z0: 68, z1: 90 };
  const D = { x0: 76, x1: 124, z0: 62, z1: 90 };
  const I = { x0: 52, x1: 66, z0: 56, z1: 67 };
  const E = { x0: 38, x1: 134, z0: 41, z1: 53 };
  const G = { x0: 50, x1: 78, z0: 14, z1: 40 };
  const F = { x0: 114, x1: 140, z0: 12, z1: 30 };
  const H_A = 45;      // A と吹き抜けの天井高
  const G_H = 52;      // G の天井高
  const BH = 12;       // B の高さ

  // ================================================================ A + 吹き抜け（ひとつの縦長のホール）
  // A の地下への階段：x 5..8、z 70..81（12 段 × 0.35）。地下室 x 5..20、z 80.8..89
  const aHole: R4 = [5, 8, 70, 81];
  rooms.push({ id: 'A', name: 'A 入口ホール', x0: A.x0, x1: A.x1, z0: A.z0, z1: A.z1, y0: 0, y1: 12, h: 12 });
  rooms.push({ id: 'shaft', name: 'A〜B 吹き抜け', x0: HALL.x0, x1: HALL.x1, z0: HALL.z0, z1: HALL.z1, y0: 0, y1: H_A, h: H_A });
  wall('x', A.x0 - T, 9, A.z1, H_A);                                 // 西の外壁（吹き抜けまで通し）
  // 東の外壁。A→C の通路の口、B から出るロープと隠し通路の口（高い所）
  wall('x', A.x1, 9, A.z1, H_A, [{ c: 79, w: 6, h: 5 }, { c: 20, w: 4, h: B_Y + 6, y0: B_Y }, { c: 24.5, w: 4, h: DUCT_Y + 4, y0: DUCT_Y }]);
  // ロープの下の空洞（吹き抜けの東）を囲う壁と天井
  wall('z', 8, 30, 50, G_H);
  wall('z', 40, 30, 50, G_H);
  box(30, 50, G_H, G_H + 1, 8, 41, 'ceil', K.ceil, true, 'ceiling');
  wall('z', A.z1, A.x0 - T, A.x1 + T, H_A);                          // 南の外壁
  wall('z', 9 - T + 0, A.x0 - T, A.x1 + T, H_A);                     // 北の外壁（B の北の壁と共通）
  floor(A.x0 - T, A.x1 + T, A.z0, A.z1 + T, 0, [aHole]);
  box(A.x0 - T, A.x1 + T, H_A, H_A + 1, 8, A.z1 + T, 'ceil', K.ceil, true, 'ceiling');
  // A の天井灯（高い）
  for (const [lx, lz] of [[10, 72], [24, 72], [10, 84], [24, 84]] as const) {
    box(lx - 1.2, lx + 1.2, 11.6, 12, lz - 0.4, lz + 0.4, 'glow', 0xffd2a8, false);
    box(lx - 0.15, lx + 0.15, 12, H_A, lz - 0.15, lz + 0.15, 'dark', 0x20262e, false);
    lamps.push({ x: lx, y: 11.4, z: lz, color: 0xffd2a8, room: 'A', power: 1.6 });
  }
  // 階段の脇の壁と階段（地下室へ）。入口側（北）は開いている
  {
    box(4.6, 5, -4.4, 1.0, 70, 81, 'metal', K.wallDark, true, 'rail');
    box(8, 8.4, -4.4, 1.0, 70, 81, 'metal', K.wallDark, true, 'rail');
    const zEnd = stairsDown(5, 8, 70, 12, 0.35, 0.9);
    // 地下室（x 5..20、z 80.8..89、床 y=-4.2、天井＝A の床）
    box(4, 21, -5.2, -4.2, zEnd, 90, 'floor', 0x2c333c, true, 'floor');
    box(4, 5, -5.2, -1, zEnd - 0.8, 90, 'wall', K.wallDark, true, 'wall');
    box(20, 21, -5.2, -1, zEnd - 0.8, 90, 'wall', K.wallDark, true, 'wall');
    box(5, 21, -5.2, -1, 89, 90, 'wall', K.wallDark, true, 'wall');
    box(8, 20, -5.2, -1, zEnd - 0.8, zEnd, 'wall', K.wallDark, true, 'wall');
    for (const [lx, lz] of [[10, 85], [16, 85]] as const) {
      box(lx - 0.8, lx + 0.8, -1.08, -1, lz - 0.25, lz + 0.25, 'glow', 0x7ae8ff, false);
      lamps.push({ x: lx, y: -1.4, z: lz, color: 0x7ae8ff, room: 'abase', power: 0.35 });
    }
    rooms.push({ id: 'abase', name: 'A 地下室', x0: 5, x1: 20, z0: zEnd, z1: 89, y0: -5.2, y1: -1, h: 4.2 });
    box(10, 18, -4.2, -3.9, 85, 89, 'hazard', 0xffffff, false);
  }
  // 吹き抜けの壁の灯り
  for (const [lx, ly, lz] of [[5.2, 6, 56], [29, 14, 50], [5.2, 20, 44], [29, 26, 38], [5.2, 34, 56]] as const) {
    box(lx - 0.2, lx + 0.2, ly - 1, ly + 1, lz - 0.3, lz + 0.3, 'glow', 0x6a7a90, false);
    lamps.push({ x: lx < 15 ? lx + 1 : lx - 1, y: ly, z: lz, color: 0x7a90b0, room: 'shaft', power: 0.7 });
  }
  // 吹き抜けの中の太い柱・配管（見た目。足場の背景）
  for (const [px, pz] of [[7, 20], [27, 20], [7, 62], [27, 62]] as const) cyl(px, 22, pz, 0.9, 44, 'y', 'pipe', K.wallDark, false);

  // ================================================================ 動く足場・静的な足場（A→B）
  const platforms: MovingPlatform[] = [
    { id: 'm1', x: 21, y: 11, z: 56, sx: 3.2, sz: 3.2, axis: 'x', amp: 5, speed: 1.4, phase: 0 },
    { id: 'm2', x: 16, y: 26, z: 44, sx: 3.2, sz: 3.2, axis: 'x', amp: 6, speed: 1.1, phase: 2 },
  ];
  const statics: [number, number, number, number, number][] = [
    // [中心 x, 天面 y, 中心 z, 幅 x, 幅 z]
    [9, 6, 60, 4, 4], [8, 16, 51, 3.2, 3.2], [24, 21, 48, 3.2, 3.2], [24, 30.2, 39, 3.2, 3.2],
  ];
  for (const [px, py, pz, sx, sz] of statics) {
    // 側面が高い（グラップルの縁によじ登れる）ように厚くする
    box(px - sx / 2, px + sx / 2, py - PLATFORM_THICK, py, pz - sz / 2, pz + sz / 2, 'metal', K.steel, true, 'platform');
    box(px - sx / 2 + 0.2, px + sx / 2 - 0.2, py - 0.02, py, pz - sz / 2 + 0.2, pz + sz / 2 - 0.2, 'glow', 0x3a7a90, false);
    cyl(px, py - PLATFORM_THICK - 3, pz, 0.12, 6, 'y', 'dark', 0x20262e, false);
  }

  // ================================================================ B（高い所）。入ると扉が閉まって戦闘
  {
    const yb = B_Y;
    rooms.push({ id: 'B', name: 'B 空中の制御室', x0: Bq.x0, x1: Bq.x1, z0: Bq.z0, z1: Bq.z1, y0: yb, y1: yb + BH, h: BH });
    wall('z', Bq.z0 - T, Bq.x0 - T, Bq.x1 + T, BH, [], yb);
    wall('z', Bq.z1, Bq.x0 - T, Bq.x1 + T, BH, [{ c: 14, w: 12, h: 6 }], yb);
    wall('x', Bq.x0 - T, Bq.z0, Bq.z1, BH, [], yb);
    // 東の壁：ロープへの出口（下）と、隠し通路の口（高い所 y 8..12）
    wall('x', Bq.x1, Bq.z0, Bq.z1, BH, [{ c: 20, w: 4, h: 5 }, { c: 24.5, w: 4, h: BH, y0: DUCT_Y - yb }], yb);
    // 床（B と手前の張り出し）。下は何もない
    floor(Bq.x0 - T, Bq.x1 + T, Bq.z0 - T, Bq.z1 + T, yb);
    box(6, 22, yb - 2, yb, 28, 37, 'floor', K.floor, true, 'floor');
    box(6, 22, yb - 2, yb - 1, 28, 37, 'dark', 0x20262e, false);
    box(Bq.x0 - T, Bq.x1 + T, yb + BH, yb + BH + 1, Bq.z0 - T, Bq.z1 + T, 'ceil', K.ceil, true, 'ceiling');
    // 張り出しの手すり
    box(6, 6.2, yb, yb + 1.1, 28, 37, 'metal', K.steel, true, 'rail');
    box(21.8, 22, yb, yb + 1.1, 28, 37, 'metal', K.steel, true, 'rail');
    for (const [lx, lz] of [[10, 16], [18, 16], [10, 23], [18, 23]] as const) {
      box(lx - 1, lx + 1, yb + BH - 0.08, yb + BH, lz - 0.3, lz + 0.3, 'glow', 0xcfe0ff, false);
      lamps.push({ x: lx, y: yb + BH - 0.3, z: lz, color: 0xcfe0ff, room: 'B', power: 1.0 });
    }
    lamps.push({ x: 14, y: yb + 4, z: 32.5, color: 0x9ac0ff, room: 'B', power: 0.8 });
    // B の下の支柱と、床の外周
    for (const [px, pz] of [[5, 11], [23, 11], [5, 27], [23, 27]] as const) cyl(px, yb / 2, pz, 0.8, yb, 'y', 'metal', K.steel, true);
    // B の中の機械
    for (const x of [7, 11, 17, 21]) deco.cabinet(x, 11.2 + 0);
    // 隠し通路の入口の棚（壁にくっついた高い足場）。グラップルで上がる
    box(20, 24, DUCT_Y - 1, DUCT_Y, 21.5, 27.5, 'metal', K.steel, true, 'shelf');
    box(20, 20.3, DUCT_Y - 3, DUCT_Y, 21.5, 27.5, 'dark', 0x20262e, false);
    grapples.push({ x: 20.2, y: DUCT_Y, z: 24.5, nx: -1, nz: 0, label: '棚の縁' });
  }

  // ================================================================ ロープ（綱渡り）と隠し通路（ダクト）
  const ropeBox: Box = { x0: 25, x1: 50, y0: B_Y - 0.15, y1: B_Y, z0: 19.5, z1: 20.5, m: 'rope', c: 0x2a2f36, col: true, tag: 'rope' };
  boxes.push(ropeBox);
  // 端の支え
  box(25, 26, B_Y - 1.2, B_Y, 18.6, 21.4, 'metal', K.steel, false);
  // 浮島（遠隔攻撃の敵が乗る）：低い手すり付き
  const islands: [number, number][] = [[36, 12], [40, 28]];
  for (const [ix, iz] of islands) {
    box(ix - 3, ix + 3, B_Y - 0.8, B_Y, iz - 3, iz + 3, 'metal', K.steel, true, 'platform');
    cyl(ix, B_Y - 12, iz, 0.6, 24, 'y', 'dark', 0x20262e, false);
    for (const [x0, x1, z0, z1] of [[ix - 3, ix + 3, iz - 3, iz - 2.8], [ix - 3, ix + 3, iz + 2.8, iz + 3], [ix - 3, ix - 2.8, iz - 3, iz + 3], [ix + 2.8, ix + 3, iz - 3, iz + 3]] as const) {
      box(x0, x1, B_Y, B_Y + 1.3, z0, z1, 'metal', K.wallDark, true, 'rail');
    }
  }
  // 隠し通路（ダクト）：x 25..50、z 21.5..27.5（内側 22.5..26.5）、床 y=40、天井 y=44
  const duct = { x0: 24, x1: 50, y0: DUCT_Y, y1: DUCT_Y + 4, z0: 22.5, z1: 26.5 };
  {
    box(24, 50, DUCT_Y - 1, DUCT_Y, 21.5, 27.5, 'metal', K.steel, true, 'duct');
    box(24, 50, DUCT_Y + 4, DUCT_Y + 5, 21.5, 27.5, 'metal', K.steel, true, 'duct');
    box(24, 50, DUCT_Y, DUCT_Y + 4, 21.5, 22.5, 'metal', K.wallDark, true, 'duct');
    box(24, 50, DUCT_Y, DUCT_Y + 4, 26.5, 27.5, 'metal', K.wallDark, true, 'duct');
    for (let x = 28; x < 50; x += 5) {
      box(x - 0.4, x + 0.4, DUCT_Y + 3.92, DUCT_Y + 4, 24, 25, 'glow', 0x7ae8ff, false);
      lamps.push({ x, y: DUCT_Y + 3.4, z: 24.5, color: 0x7ae8ff, room: 'duct', power: 0.35 });
    }
    for (let x = 27; x < 49; x += 1.6) box(x, x + 0.3, DUCT_Y, DUCT_Y + 0.04, 22.6, 26.4, 'hazard', 0xffffff, false);
    rooms.push({ id: 'duct', name: '隠し通路', x0: 25, x1: 49, z0: 22.5, z1: 26.5, y0: DUCT_Y, y1: DUCT_Y + 4, h: 4 });
    rooms.push({ id: 'rope', name: '綱渡り', x0: 25, x1: 49, z0: 10, z1: 40, y0: B_Y - 6, y1: B_Y + 8, h: 14 });
  }

  // ================================================================ G（目的地・高い）
  {
    room('G', 'G ドレイン装置前室', G.x0, G.x1, G.z0, G.z1, G_H, { s: [{ c: 55, w: 6, h: 5 }], w: [{ c: 21, w: 3, h: B_Y + 6, y0: B_Y }, { c: 24.5, w: 4, h: DUCT_Y + 4, y0: DUCT_Y }] }, { noRoom: false, power: 0 });
    // G のむこう（ロープ側）の壁：開口を y 32〜38 / 40〜44 に作ったので、足場（着地台）を置く
    box(G.x0, G.x0 + 5, B_Y - 2, B_Y, 17, 23, 'metal', K.steel, true, 'platform');
    box(G.x0, G.x0 + 5, DUCT_Y - 2, DUCT_Y, 22.5, 26.5, 'metal', K.steel, true, 'platform');
    // 降りる足場
    for (const [x0, top] of [[56, 24], [60, 16], [64, 8]] as const) {
      box(x0, x0 + 3.2, top - 0.6, top, 18, 22, 'metal', K.steel, true, 'platform');
      cyl(x0 + 1.6, top / 2, 20, 0.15, top, 'y', 'dark', 0x20262e, false);
    }
    // 巨大なパイプとタンク（ドレイン装置に集まる配管）
    for (const x of [54, 62, 70, 76]) cyl(x, G_H / 2, 38.5, 0.8, G_H, 'y', 'pipe', K.pipe, false);
    for (const x of [66, 72, 76]) deco.tank(x, 36, 1.5, 5);
    deco.generator(75, 24);
    // 高い所の灯り
    for (const [lx, ly, lz, c] of [[56, 16, 24, 0x9ac0ff], [66, 32, 24, 0x9ac0ff], [64, 6, 30, 0xffd2a8], [58, 44, 20, 0x9ac0ff], [70, 12, 26, 0xffd2a8]] as const) {
      box(lx - 0.6, lx + 0.6, ly - 0.1, ly, lz - 0.2, lz + 0.2, 'glow', c, false);
      lamps.push({ x: lx, y: ly - 0.4, z: lz, color: c, room: 'G', power: 2.6 });
    }
    lamps.push({ x: 64, y: 4, z: 17, color: 0xff8a60, room: 'G', power: 1.6 });
    lamps.push({ x: 60, y: 7, z: 30, color: 0xffd2a8, room: 'G', power: 1.6 });
    lamps.push({ x: 70, y: 7, z: 30, color: 0xffd2a8, room: 'G', power: 1.6 });
  }
  // ドレイン装置の部屋への扉（G の北の壁）
  const drainDoor = { x: 64, y: 0, z: G.z0, w: 8, h: 6, reach: 6 };
  {
    box(60, 68, 0, 6.6, G.z0, G.z0 + 0.4, 'metal', 0x3a424e, false);
    box(60.4, 67.6, 0.4, 6.0, G.z0 + 0.4, G.z0 + 0.46, 'glow', 0x2a6a88, false);
    cyl(64, 3.2, G.z0 + 0.5, 2.0, 0.2, 'z', 'metal', K.steel, false);
    cyl(64, 3.2, G.z0 + 0.62, 1.5, 0.12, 'z', 'glow', 0xff6a3a, false);
    box(59, 69, 0, 0.05, G.z0, G.z0 + 2, 'hazard', 0xffffff, false);
  }

  // ================================================================ C・コリドー
  room('C', 'C 配電室', C.x0, C.x1, C.z0, C.z1, 7, { w: [{ c: 79, w: 6, h: 5 }], e: [{ c: 79, w: 6, h: 5 }], n: [{ c: 59, w: 4, h: 4 }] }, { lamp: 0xd8c8a8, power: 0.9, lampN: 4 });
  corridor('ac', 'x', 31, 43, 76, 82, 5);
  corridor('cd', 'x', 67, 75, 76, 82, 5);
  corridor('dn', 'z', 54, 61, 76, 82, 5);
  room('D', 'D 動力室', D.x0, D.x1, D.z0, D.z1, 9, { w: [{ c: 79, w: 6, h: 5 }], n: [{ c: 79, w: 6, h: 5 }] },
    { holes: [[119, 122, 72.5, 84]], lamp: 0xffb890, power: 1.1, lampN: 6 });
  // D の地下への階段（ブロックでふさがれている）
  {
    box(118.6, 119, -4.4, 3.0, 72.5, 84, 'metal', K.wallDark, true, 'rail');
    box(122, 122.4, -4.4, 3.0, 72.5, 84, 'metal', K.wallDark, true, 'rail');
    const zEnd = stairsDown(119, 122, 72.5, 12, 0.35, 0.9);
    box(104, 125, -5.2, -4.2, zEnd, 90, 'floor', 0x2c333c, true, 'floor');
    box(104, 105, -5.2, -1, zEnd - 0.8, 90, 'wall', K.wallDark, true, 'wall');
    box(124, 125, -5.2, -1, zEnd - 0.8, 90, 'wall', K.wallDark, true, 'wall');
    box(105, 125, -5.2, -1, 89, 90, 'wall', K.wallDark, true, 'wall');
    box(105, 119, -5.2, -1, zEnd - 0.8, zEnd, 'wall', K.wallDark, true, 'wall');
    for (const [lx, lz] of [[110, 86], [118, 86]] as const) {
      box(lx - 0.8, lx + 0.8, -1.08, -1, lz - 0.25, lz + 0.25, 'glow', 0xff9a60, false);
      lamps.push({ x: lx, y: -1.4, z: lz, color: 0xff9a60, room: 'dbase', power: 0.35 });
    }
    rooms.push({ id: 'dbase', name: 'D 地下', x0: 105, x1: 124, z0: zEnd, z1: 89, y0: -5.2, y1: -1, h: 4.2 });
  }
  // D の遮蔽物と装置
  for (const [cx, cz, sx, sz] of [[90, 70, 4, 2], [90, 84, 4, 2], [100, 77, 2, 6], [110, 70, 4, 2], [110, 84, 4, 2]] as const) bx(cx, 0, cz, sx, 1.4, sz, 'metal', K.steel, true);
  row(88.5, 80, 118, 8, ['tank', 'generator', 'pump', 'cabinet'], []);
  row(63.6, 95, 118, 8, ['cabinet', 'pump', 'cabinet'], []);

  // ================================================================ I（小部屋）：C の北の壁の「壊せるブロック」の先
  room('I', 'I 隠し部屋', I.x0, I.x1, I.z0, I.z1, 5, { s: [{ c: 59, w: 4, h: 4 }] }, { lamp: 0xffe08a, power: 0.5, lampN: 1, noFloor: false });
  // C と I の境のブロックの位置はそのまま壁の開口（C の north / I の south は同じ壁）。重複する壁は片方で十分
  deco.tank(54, 58, 0.9, 3); deco.generator(63, 58.2);

  // ================================================================ E（長い暗い部屋）。西端に G への扉、中央にレーザー、東端に狭い通路
  room('E', 'E 暗い長廊下', E.x0, E.x1, E.z0, E.z1, 6, {
    n: [{ c: 55, w: 6, h: 5 }, { c: 131.7, w: 1.4, h: 3.5 }],
    s: [{ c: 79, w: 6, h: 5 }, { c: 46, w: 2, h: 3.5 }],
  }, { power: 0, lamp: 0x405060 });
  // E のごく弱い灯り（ほぼ真っ暗）
  for (const lx of [44, 60, 76, 100, 118]) {
    box(lx - 0.4, lx + 0.4, 5.92, 6, 46.8, 47.2, 'glow', 0x30406a, false);
    lamps.push({ x: lx, y: 5.5, z: 47, color: 0x4a5a8a, room: 'E', power: 0.28 });
  }
  // E の機械が壁際に並ぶ（暗くて見えにくい）
  row(41.9 + 0.9, 42, 126, 8, ['pump', 'cabinet', 'generator', 'tank'], [[52, 58], [129, 135], [LASER_X - 2, LASER_X + 2]]);
  row(52.2, 41, 125, 9, ['cabinet', 'pump', 'tank'], [[76, 82], [43, 49], [LASER_X - 2, LASER_X + 2]]);
  // G の扉へ向かう床のケーブルと配管（G のそばの壁沿い）
  cable([[134, 47], [60, 47]]);
  cable([[60, 47], [55, 47], [55, 42]]);
  pipeRun([[41, 5.2, 41.6], [55, 5.2, 41.6]], 0.2);
  pipeRun([[134, 5.2, 41.6], [60, 5.2, 41.6], [55, 5.2, 41.6], [55, 5.2, 41.0]], 0.28);
  // レーザー装置の柱（天井から床まで）
  const laser = { x0: LASER_X - 0.6, x1: LASER_X + 0.6, z0: E.z0, z1: E.z1, y1: 6, machines: [{ x: LASER_X, z: E.z0 + 0.7 }, { x: LASER_X, z: E.z1 - 0.7 }] };
  // 主電源の隠し部屋（E の南の壁の外）：x 44..48、z 54..58
  {
    box(43, 44, 0, 4, 54, 58.6, 'wall', K.wallDark, true, 'wall');
    box(48, 49, 0, 4, 54, 58.6, 'wall', K.wallDark, true, 'wall');
    box(43, 49, 0, 4, 58, 58.6, 'wall', K.wallDark, true, 'wall');
    box(43, 49, 4, 5, 53, 58.6, 'ceil', K.ceil, true, 'ceiling');
    box(44, 48, -1, 0, 54, 58, 'floor', K.floor, true, 'floor');
    lamps.push({ x: 46, y: 3.4, z: 56, color: 0xff6a3a, room: 'E', power: 0.5 });
    // 主電源へのケーブル（ブロックの前から E の床を這う）
    cable([[46, 54.5], [46, 49], [58, 49], [58, 44]], 0.25);
  }
  // E→F の狭い通路（x 131..132.4、z 31..40）。壁だけ・ほぼ光なし
  {
    const px0 = 131, px1 = 132.4;
    wall('x', px0 - T, 31, 41, 4);
    wall('x', px1, 31, 41, 4);
    floor(px0 - T, px1 + T, 30, 41);
    box(px0 - T, px1 + T, 4, 5, 31, 41, 'ceil', K.ceil, true, 'ceiling');
    for (const z of [34, 38]) box(px0, px1, 0, 0.05, z, z + 0.2, 'glow', 0x401810, false);
    rooms.push({ id: 'pass', name: '狭い通路', x0: px0, x1: px1, z0: 31, z1: 41, y0: 0, y1: 4, h: 4 });
    // 通路の口をわざと目立たなくする機械
    bx(129.5, 0, 42.4, 1.6, 2.2, 1.0, 'dark', 0x20262e, true);
    bx(134, 0, 42.4, 1.6, 2.2, 1.0, 'dark', 0x20262e, true);
  }

  // ================================================================ F（東北の部屋）
  room('F', 'F 冷却ポンプ室', F.x0, F.x1, F.z0, F.z1, 8, { s: [{ c: 131.7, w: 1.4, h: 3.5 }] }, { lamp: 0xa8c8ff, power: 0.7, lampN: 3 });
  row(13.3, 116, 138, 6, ['tank', 'pump', 'generator'], []);
  row(28.8, 116, 126, 6, ['cabinet', 'pump'], []);
  pipeRun([[F.x0, 6.5, 14], [F.x0 - 3, 6.5, 14]], 0.3);
  // G の東側の空間：ポンプ室（閉鎖。装置の置き場。壁越しに配管が G につながる）
  {
    room('pumpHall', 'ポンプ室（閉鎖）', 82, 112, 16, 38, 12, {}, { power: 0, noRoom: true, noFloor: false });
    for (const [px, pz, r, h] of [[88, 22, 2.4, 9], [96, 22, 2.4, 9], [104, 22, 2.4, 9], [92, 32, 3, 7], [102, 32, 3, 7]] as const) cyl(px, h / 2, pz, r, h, 'y', 'tank', K.tank, true);
    pipeRun([[88, 10, 22], [88, 10, 30], [79, 10, 30]], 0.4);
    pipeRun([[104, 10, 22], [104, 10, 30], [79, 10, 30]], 0.4);
  }

  // ================================================================ C・A・D などの装置（壁沿い）
  row(89.3, 6, 28, 6, ['tank', 'generator', 'pump', 'cabinet'], []);
  row(88.6, 46, 64, 6, ['pump', 'cabinet', 'generator'], []);
  row(69.4, 46, 62, 8, ['cabinet', 'pump'], [[57, 61]]);
  // C にも G へ向かうケーブル
  cable([[62, 80], [78, 79]], 0.3);
  pipeRun([[44, 6.2, 70], [66, 6.2, 70], [66, 6.2, 74]], 0.25);

  // ================================================================ ゲート
  const gate = (id: string, x0: number, x1: number, z0: number, z1: number, y0: number, h: number, closed: boolean, color: number, label: string): void => {
    gates.push({ id, x0, x1, z0, z1, y0, h, closed, color, label });
  };
  gate('bEntry', 8, 20, Bq.z1, Bq.z1 + T, B_Y, 6, false, 0xff3a2a, 'B 入口');
  gate('bExit', Bq.x1, Bq.x1 + T, 18, 22, B_Y, 5, true, 0xff3a2a, 'B 出口（綱渡り）');
  gate('dWest', D.x0 - T, D.x0, 76, 82, 0, 5, false, 0xff3a2a, 'D 入口（西）');
  gate('dNorth', 76, 82, D.z0 - T, D.z0, 0, 5, false, 0xff3a2a, 'D 出口（北）');
  gate('gDoor', 52, 58, E.z0 - T, E.z0, 0, 5, true, 0x3a7dff, 'G の扉（セキュリティ封鎖）');

  // ================================================================ ブロック・セキュリティ・主電源
  const breakables: BreakableDef[] = [
    { id: 'iWall', x0: 57, x1: 61, y0: 0, y1: 4, z0: 67, z1: 68, face: '+z', label: 'C→I の壊せる壁' },
    { id: 'dBlock', x0: 119, x1: 122, y0: 0, y1: 3, z0: 72.5, z1: 75.5, face: '-z', label: 'D 地下へのブロック' },
    { id: 'eBlock', x0: 45, x1: 47, y0: 0, y1: 3.5, z0: 53, z1: 54, face: '-z', label: 'E の主電源のブロック' },
  ];
  const securities: SecurityDef[] = [
    { id: 'I', x: 59, y: 1.4, z: 60.5, r: 1.0, label: 'I のセキュリティ装置' },
    { id: 'D', x: 113, y: -2.9, z: 86.2, r: 1.0, label: 'D 地下のセキュリティ装置' },
    { id: 'F', x: 127, y: 1.4, z: 17.5, r: 1.0, label: 'F のセキュリティ装置' },
  ];
  const mainPower = { x: 46, y: 1.4, z: 56.2, r: 1.0 };

  // ================================================================ 敵
  const zones: ZoneDef[] = [
    {
      id: 'A', name: 'A 入口ホール', mode: 'zone', face: { x: 17, z: 78 }, spawns: [
        { kind: 'crawler', x: 12, z: 72 }, { kind: 'crawler', x: 24, z: 74 }, { kind: 'gunner', x: 10, z: 86 }, { kind: 'gunner', x: 26, z: 86 },
        { kind: 'walker', x: 18, z: 80 }, { kind: 'drone', x: 14, z: 76, mode: 'awake' }, { kind: 'drone', x: 22, z: 78, mode: 'awake' },
      ],
    },
    {
      id: 'C', name: 'C 配電室', mode: 'zone', face: { x: 55, z: 79 }, spawns: [
        { kind: 'walker', x: 50, z: 72 }, { kind: 'walker', x: 62, z: 86 }, { kind: 'heavy', x: 56, z: 82 }, { kind: 'bomber', x: 48, z: 86 },
        { kind: 'leech', x: 60, z: 74, mode: 'awake' }, { kind: 'redMedic', x: 64, z: 72, mode: 'awake', neutral: true },
      ],
    },
    {
      id: 'I', name: 'I 隠し部屋', mode: 'zone', face: { x: 59, z: 62 }, spawns: [
        { kind: 'crawler', x: 55, z: 62 }, { kind: 'crawler', x: 63, z: 60 }, { kind: 'domer', x: 59, z: 58 },
      ],
    },
    {
      id: 'D', name: 'D 動力室', mode: 'trap', face: { x: 100, z: 76 },
      trigger: { x0: 80, x1: 122, z0: 64, z1: 88, y0: -1, y1: 6 }, closes: ['dWest', 'dNorth'], opens: ['dWest', 'dNorth'],
      spawns: [
        { kind: 'heavyWalker', x: 108, z: 76, mode: 'pod' }, { kind: 'walker', x: 96, z: 66, mode: 'pod' }, { kind: 'walker', x: 96, z: 87, mode: 'pod' },
        { kind: 'gunner', x: 88, z: 74, mode: 'pod' }, { kind: 'gunner', x: 88, z: 80, mode: 'pod' }, { kind: 'missile', x: 114, z: 66, mode: 'pod' },
        { kind: 'beamer', x: 118, z: 86, mode: 'pod' }, { kind: 'jumper', x: 102, z: 70, mode: 'pod' }, { kind: 'jumper', x: 102, z: 84, mode: 'pod' },
        { kind: 'bomber', x: 92, z: 76, mode: 'pod' }, { kind: 'drone', x: 100, z: 76, mode: 'drop' }, { kind: 'drone', x: 110, z: 78, mode: 'drop' },
        { kind: 'drone', x: 90, z: 70, mode: 'drop' }, { kind: 'domer', x: 106, z: 86, mode: 'pod' },
      ],
    },
    {
      id: 'dbase', name: 'D 地下', mode: 'zone', face: { x: 113, z: 86 }, spawns: [
        { kind: 'crawler', x: 108, z: 86, floor: -4.2 }, { kind: 'crawler', x: 118, z: 87, floor: -4.2 },
      ],
    },
    {
      id: 'Ew', name: 'E 西', mode: 'zone', face: { x: 66, z: 47 }, spawns: [
        { kind: 'gunner', x: 62, z: 45 }, { kind: 'walker', x: 70, z: 49 }, { kind: 'leech', x: 74, z: 47, mode: 'awake' }, { kind: 'bomber', x: 50, z: 47 },
      ],
    },
    {
      id: 'Ee', name: 'E 東', mode: 'zone', face: { x: 110, z: 47 }, spawns: [
        { kind: 'heavy', x: 104, z: 47 }, { kind: 'jumper', x: 116, z: 44 }, { kind: 'crawler', x: 96, z: 50 }, { kind: 'crawler', x: 122, z: 50 }, { kind: 'domer', x: 126, z: 47 },
      ],
    },
    {
      id: 'F', name: 'F 冷却ポンプ室', mode: 'zone', face: { x: 126, z: 22 }, spawns: [
        { kind: 'gunner', x: 120, z: 18 }, { kind: 'gunner', x: 134, z: 24 }, { kind: 'missile', x: 136, z: 16 }, { kind: 'missile', x: 118, z: 26 },
        { kind: 'jumper', x: 124, z: 24 }, { kind: 'drone', x: 126, z: 20, mode: 'awake' }, { kind: 'drone', x: 132, z: 20, mode: 'awake' },
        { kind: 'redMedic', x: 138, z: 27, mode: 'awake', neutral: true },
      ],
    },
    {
      id: 'B', name: 'B 空中の制御室', mode: 'trap', face: { x: 14, z: 19 }, trigger: { x0: 7, x1: 21, z0: 12, z1: 27, y0: B_Y - 1, y1: B_Y + 6 },
      closes: ['bEntry', 'bExit'], opens: ['bEntry', 'bExit'],
      spawns: [
        { kind: 'drone', x: 9, z: 14, floor: B_Y, mode: 'drop' }, { kind: 'drone', x: 19, z: 14, floor: B_Y, mode: 'drop' }, { kind: 'drone', x: 9, z: 24, floor: B_Y, mode: 'drop' },
        { kind: 'drone', x: 19, z: 24, floor: B_Y, mode: 'drop' }, { kind: 'missileDrone', x: 14, z: 13, floor: B_Y, mode: 'drop' }, { kind: 'missileDrone', x: 14, z: 25, floor: B_Y, mode: 'drop' },
        { kind: 'missile', x: 8, z: 19, floor: B_Y, mode: 'pod' }, { kind: 'gunner', x: 20, z: 19, floor: B_Y, mode: 'pod' }, { kind: 'redDrone', x: 14, z: 23, floor: B_Y, mode: 'awake', neutral: true },
        { kind: 'redMedic', x: 6, z: 12, floor: B_Y, mode: 'awake', neutral: true },
      ],
    },
    {
      id: 'shaft', name: 'A〜B 吹き抜け', mode: 'zone', face: { x: 17, z: 50 }, spawns: [
        { kind: 'missileDrone', x: 12, z: 56, floor: 8, mode: 'awake' }, { kind: 'missileDrone', x: 17, z: 46, floor: 18, mode: 'awake' },
        { kind: 'drone', x: 18, z: 52, floor: 12, mode: 'awake' }, { kind: 'drone', x: 10, z: 44, floor: 20, mode: 'awake' },
      ],
    },
    {
      id: 'rope', name: '綱渡り', mode: 'zone', face: { x: 38, z: 20 }, spawns: [
        { kind: 'missile', x: 36, z: 12, floor: B_Y, mode: 'awake' }, { kind: 'gunner', x: 40, z: 28, floor: B_Y, mode: 'awake' },
        { kind: 'missileDrone', x: 32, z: 20, floor: B_Y + 3, mode: 'awake' }, { kind: 'missileDrone', x: 44, z: 20, floor: B_Y + 4, mode: 'awake' },
        { kind: 'drone', x: 38, z: 16, floor: B_Y + 2, mode: 'awake' }, { kind: 'drone', x: 38, z: 32, floor: B_Y + 5, mode: 'awake' },
      ],
    },
  ];

  const centers: Record<string, { x: number; z: number }> = {};
  for (const r of rooms) centers[r.id] = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };

  const pits: Plan['pits'] = [
    { x0: HALL.x0 - 0.5, x1: HALL.x1 + 0.5, z0: 9, z1: A.z0 - 0.2, y: -1.5, label: 'A〜B の吹き抜け' },
    { x0: 24, x1: 49.6, z0: 9, z1: 41, y: -1.5, label: '綱渡りの下' },
  ];

  return {
    boxes, cyls, rooms, lamps, zones, gates, grapples, platforms, breakables, securities, mainPower, laser, pits,
    decoy: { x: 14, y: -3.3, z: 85 },
    drainDoor,
    checkpoints: {
      entrance: { x: 17, y: 0, z: 86, yaw: Math.PI },
      bTop: { x: 14, y: B_Y, z: 33, yaw: 0 },
      rope: { x: 21, y: B_Y, z: 20, yaw: -Math.PI / 2 },
      dFront: { x: 71, y: 0, z: 79, yaw: -Math.PI / 2 },
      eWest: { x: 79, y: 0, z: 49, yaw: Math.PI },
      goal: { x: 64, y: 0, z: 24, yaw: Math.PI },
    },
    checkpointZones: [
      { id: 'entrance', x0: A.x0, x1: A.x1, z0: 68, z1: A.z1, y0: -1, y1: 5 },
      { id: 'dFront', x0: 68, x1: 75, z0: 76, z1: 82, y0: -1, y1: 5 },
      { id: 'bTop', x0: 6, x1: 22, z0: 29, z1: 37, y0: B_Y - 1, y1: B_Y + 4 },
      { id: 'rope', x0: 6, x1: 24, z0: 11, z1: 27, y0: B_Y - 1, y1: B_Y + 4 },
      { id: 'eWest', x0: 72, x1: 86, z0: 42, z1: 52, y0: -1, y1: 5 },
      { id: 'goal', x0: G.x0, x1: G.x1, z0: G.z0, z1: G.z1, y0: -1, y1: 5 },
    ],
    spawner: { x0: 6, x1: 28, z0: 36, z1: 62, y0: 6, y1: 36, kinds: ['drone', 'drone', 'missileDrone'], interval: 5.5, max: 6 },
    shaft: { x0: HALL.x0, x1: HALL.x1, z0: 31, z1: A.z0 },
    start: { x: 17, z: 86, yaw: Math.PI },
    centers,
    duct,
  };
}
