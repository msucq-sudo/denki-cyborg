// サージ収容所 1階の間取りと配置データ（three に依存しない純データ）。設計：docs/camp-floor1-plan.md、平面図：収容所1F.png。
// 座標：x=東、z=南（北＝-z＝平面図の上）、y=上。床は y=0。壁の厚みは 1（部屋の内側の矩形の外に壁を置く）。単位 m。
//
//   E（左上の円形ホール）──F（上段中央）        H（右上の大ホール。右上隅が2階への出口）
//   │  ＼（レーザー網）     │                     │
//   │    I（小円形）        G ═(天井の隠し通路)═ D（前室）
//   │（バキューム）                               │（青いキー扉）
//   A（左下・入口）── B ── C（右下。暗い配電室。右下隅に脆い壁の J）
//   A の床にハッチ → 地下通路（歯車）
import type { EnemyKind } from '../../config/balance';

export type Mat = 'wall' | 'floor' | 'ceil' | 'metal' | 'crate' | 'glow' | 'hazard' | 'dark' | 'hidden';

export interface Box {
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
  m: Mat; c: number;
  /** 当たり判定を作る */
  col: boolean;
  tag?: string;
  /** 'C'＝C の部屋の照明と一緒に点く発光物 */
  grp?: 'C';
}
/** 円形の部屋の壁（見た目だけ。当たり判定は Box で別に置く）。角度 a は x=cx+r·cos a, z=cz+r·sin a */
export interface Arc { cx: number; cz: number; r: number; y0: number; y1: number; a0: number; a1: number; c: number }
export interface RoomRect { id: string; name: string; x0: number; x1: number; z0: number; z1: number; h: number }
export interface Lamp { x: number; y: number; z: number; color: number; room: string; power: number }
export interface GearDef { id: string; x: number; y: number; z: number; area: string }
export interface SpawnDef { kind: EnemyKind; x: number; z: number; floor?: number; mode?: 'pod' | 'drop' | 'awake' }
export interface ZoneDef {
  id: string; name: string;
  /** zone＝近づくと起きる（1体起きたら全員）／trap＝トリガーで一斉に起きる */
  mode: 'zone' | 'trap';
  face: { x: number; z: number };
  spawns: SpawnDef[];
  /** trap の2つ目の波（1つ目の残りが CAMP1.bossWave2At 以下で出る） */
  wave2?: SpawnDef[];
}
/** シャッター（扉）。開口は x0..x1 × z0..z1、高さ h */
export interface GateDef { id: string; x0: number; x1: number; z0: number; z1: number; h: number; closed: boolean; color: number; label: string }
export interface GrappleDef { x: number; y: number; z: number; nx: number; nz: number; label: string }

export interface Plan {
  boxes: Box[];
  arcs: Arc[];
  rooms: RoomRect[];
  lamps: Lamp[];
  gears: GearDef[];
  zones: ZoneDef[];
  gates: GateDef[];
  grapples: GrappleDef[];
  /** チェックポイント（YOU DIED からの再開地点） */
  checkpoints: Record<'entrance' | 'boss', { x: number; z: number; yaw: number }>;
  /** セキュリティキー（B・F に隠す） */
  keys: { id: 'B' | 'F'; x: number; y: number; z: number; hint: string }[];
  /** 青いキー扉（gates の 'key'）の手前の判定点 */
  keyDoor: { x: number; z: number };
  /** バキュームの入手アイテム（A→E の縦通路） */
  vacuum: { x: number; y: number; z: number };
  /** A の送電ソケット（床のハッチを開ける） */
  hatchSocket: { x: number; y: number; z: number; r: number };
  /** 床のハッチ（穴）と地下通路 */
  hatch: { x0: number; x1: number; z0: number; z1: number };
  tunnel: { x0: number; x1: number; z0: number; z1: number; floor: number };
  /** C の電源スイッチ（ソケット）。電気を送るまで C は暗い */
  cSocket: { x: number; y: number; z: number; r: number };
  /** J の脆い壁（溜め撃ちで壊れる）。当たり判定は x0..x1 × y0..y1 × z0..z1 */
  brittle: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; face: 'west' };
  /** E→I の斜め通路のレーザー網（当たり判定の箱と、見た目の線の両端） */
  laser: { box: { x0: number; x1: number; z0: number; z1: number; y1: number }; ax: number; az: number; bx: number; bz: number; machines: { x: number; z: number }[] };
  /** レーザー網の電力源（2つとも吸うと網が消える）＋ D の予備バッテリー */
  sources: { id: string; x: number; y: number; z: number; r: number; laser: boolean }[];
  /** G→D の天井の隠し通路（ダクト）。床 y0、天井 y1、z0..z1、x0..x1 */
  duct: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
  /** 赤ウォーカーの案内先（隠し通路の入口の下）と、案内を始める G の範囲 */
  guide: { x: number; z: number; room: { x0: number; x1: number; z0: number; z1: number } };
  /** 中ボス戦：入ると閉じ込め戦が始まる範囲（H） */
  bossTrigger: { x0: number; x1: number; z0: number; z1: number };
  /** 2階への出口（H の右上隅）。開いた扉の先の奥（z < z1）に入ると「準備中」 */
  exit: { x0: number; x1: number; z0: number; z1: number };
  /** プレイヤーの開始地点（チェックポイント 'entrance' と同じ） */
  start: { x: number; z: number; yaw: number };
  /** 赤ウォーカーの初期位置 */
  redWalker: { x: number; z: number };
  /** 部屋の内側の中心など（テスト・案内用） */
  centers: Record<string, { x: number; z: number }>;
}

export const T = 1;
export const E_C = { x: 20, z: 18, r: 13, h: 12 };
export const I_C = { x: 52, z: 50, r: 5, h: 5 };
const DEG = Math.PI / 180;

// 色
const K = {
  wall: 0x9aa1ab, wallDark: 0x6d737d, floor: 0x5d6470, ceil: 0x4a505a, metal: 0x7c8592, red: 0xff3a2a, cyan: 0x52e8ff,
  amber: 0xffb040, crate: 0xb98a5a, crate2: 0x5b8fd8, crate3: 0x45b8b2, navy: 0x203c70, blue: 0x3a7dff, steel: 0x59636f,
};

export function generateCamp1(): Plan {
  const boxes: Box[] = [];
  const arcs: Arc[] = [];
  const rooms: RoomRect[] = [];
  const lamps: Lamp[] = [];

  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: Mat, c: number, col = true, tag?: string, grp?: 'C'): void => {
    boxes.push({ x0, x1, y0, y1, z0, z1, m, c, col, tag, grp });
  };
  /** 中心 (cx,cz)・底 y0・大きさ */
  const bx = (cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, m: Mat, c: number, col = true, tag?: string): void => {
    box(cx - sx / 2, cx + sx / 2, y0, y0 + sy, cz - sz / 2, cz + sz / 2, m, c, col, tag);
  };

  interface Op { c: number; w: number; h: number }
  /**
   * 壁。axis='x'：厚み方向が x（南北に延びる壁。x=min..min+1）、'z'：厚み方向が z（東西に延びる壁）。
   * a..b は延び方向の範囲、h は高さ、ops は開口（中心・幅・高さ）
   */
  const wall = (axis: 'x' | 'z', min: number, a: number, b: number, h: number, ops: Op[] = [], grp?: 'C'): void => {
    const R = (u0: number, u1: number, y0: number, y1: number) => {
      if (u1 - u0 < 0.02 || y1 - y0 < 0.02) return;
      if (axis === 'x') box(min, min + T, y0, y1, u0, u1, 'wall', K.wall, true, 'wall');
      else box(u0, u1, y0, y1, min, min + T, 'wall', K.wall, true, 'wall');
    };
    const strip = (u0: number, u1: number, y0: number, y1: number, m: Mat, c: number, d = 0.06) => {
      if (u1 - u0 < 0.02) return;
      if (axis === 'x') { box(min - d, min, y0, y1, u0, u1, m, c, false, undefined, grp); box(min + T, min + T + d, y0, y1, u0, u1, m, c, false, undefined, grp); }
      else { box(u0, u1, y0, y1, min - d, min, m, c, false, undefined, grp); box(u0, u1, y0, y1, min + T, min + T + d, m, c, false, undefined, grp); }
    };
    let cur = a;
    for (const op of [...ops].sort((p, q) => p.c - q.c)) {
      R(cur, op.c - op.w / 2, 0, h);
      strip(cur, op.c - op.w / 2, 0, 0.9, 'dark', K.wallDark);
      strip(cur, op.c - op.w / 2, 0.9, 1.0, 'glow', K.red, 0.03);
      R(op.c - op.w / 2, op.c + op.w / 2, op.h, h);
      // 開口の枠（赤い警告色の帯）
      strip(op.c - op.w / 2, op.c + op.w / 2, op.h - 0.35, op.h, 'hazard', 0xffffff, 0.12);
      cur = op.c + op.w / 2;
    }
    R(cur, b, 0, h);
    strip(cur, b, 0, 0.9, 'dark', K.wallDark);
    strip(cur, b, 0.9, 1.0, 'glow', K.red, 0.03);
    strip(a, b, h - 0.8, h - 0.7, 'glow', K.cyan, 0.03);
  };
  /** 矩形の部屋：四方の壁と天井。ops は各辺の開口 */
  const room = (id: string, name: string, x0: number, x1: number, z0: number, z1: number, h: number,
    ops: { n?: Op[]; s?: Op[]; w?: Op[]; e?: Op[] } = {}, opt: { noWall?: ('n' | 's' | 'w' | 'e')[]; grp?: 'C'; lamp?: number } = {}): void => {
    rooms.push({ id, name, x0, x1, z0, z1, h });
    const no = opt.noWall ?? [];
    if (!no.includes('n')) wall('z', z0 - T, x0 - T, x1 + T, h, ops.n, opt.grp);
    if (!no.includes('s')) wall('z', z1, x0 - T, x1 + T, h, ops.s, opt.grp);
    if (!no.includes('w')) wall('x', x0 - T, z0, z1, h, ops.w, opt.grp);
    if (!no.includes('e')) wall('x', x1, z0, z1, h, ops.e, opt.grp);
    box(x0 - T, x1 + T, h, h + 1, z0 - T, z1 + T, 'ceil', K.ceil, true, 'ceiling');
    // 天井灯（発光パネル＋実ライト候補）。おおよそ 8m おき
    const nx = Math.max(1, Math.round((x1 - x0) / 9)), nz = Math.max(1, Math.round((z1 - z0) / 9));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const lx = x0 + ((i + 0.5) * (x1 - x0)) / nx, lz = z0 + ((j + 0.5) * (z1 - z0)) / nz;
      box(lx - 1.2, lx + 1.2, h - 0.08, h, lz - 0.35, lz + 0.35, 'glow', 0xeaf6ff, false, undefined, opt.grp);
      lamps.push({ x: lx, y: h - 0.3, z: lz, color: opt.lamp ?? 0xd8e6ff, room: id, power: 1 });
    }
  };
  /** 通路（壁2枚と天井）。axis='x'：東西に延びる、'z'：南北に延びる。a..b が延び方向、lo..hi が幅 */
  const corridor = (axis: 'x' | 'z', a: number, b: number, lo: number, hi: number, h: number): void => {
    if (axis === 'x') {
      wall('z', lo - T, a, b, h);
      wall('z', hi, a, b, h);
      box(a, b, h, h + 1, lo - T, hi + T, 'ceil', K.ceil, true, 'ceiling');
      for (let u = a + 3; u < b - 1; u += 6) { box(u - 0.6, u + 0.6, h - 0.06, h, (lo + hi) / 2 - 0.3, (lo + hi) / 2 + 0.3, 'glow', 0xeaf6ff, false); lamps.push({ x: u, y: h - 0.3, z: (lo + hi) / 2, color: 0xbfd6ff, room: 'corr', power: 0.6 }); }
    } else {
      wall('x', lo - T, a, b, h);
      wall('x', hi, a, b, h);
      box(lo - T, hi + T, h, h + 1, a, b, 'ceil', K.ceil, true, 'ceiling');
      for (let u = a + 3; u < b - 1; u += 6) { box((lo + hi) / 2 - 0.3, (lo + hi) / 2 + 0.3, h - 0.06, h, u - 0.6, u + 0.6, 'glow', 0xeaf6ff, false); lamps.push({ x: (lo + hi) / 2, y: h - 0.3, z: u, color: 0xbfd6ff, room: 'corr', power: 0.6 }); }
    }
  };

  // ================================================================ 床（建物全体。A のハッチの穴だけ空ける）
  const hatch = { x0: 6, x1: 9.6, z0: 58, z1: 60.4 };
  {
    const X0 = -2, X1 = 114, Z0 = -6, Z1 = 79;
    box(X0, X1, -1, 0, Z0, hatch.z0, 'floor', K.floor, true, 'floor');
    box(X0, X1, -1, 0, hatch.z1, Z1, 'floor', K.floor, true, 'floor');
    box(X0, hatch.x0, -1, 0, hatch.z0, hatch.z1, 'floor', K.floor, true, 'floor');
    box(hatch.x1, X1, -1, 0, hatch.z0, hatch.z1, 'floor', K.floor, true, 'floor');
  }

  // ================================================================ 部屋と通路
  // A：入口ホール（南の壁の左寄りに建物の入口、北に E への縦通路、東に B への通路）
  room('A', 'A 入口ホール', 3, 37, 56, 76, 8, {
    s: [{ c: 11, w: 6, h: 5 }], n: [{ c: 20, w: 6, h: 6 }], e: [{ c: 65.5, w: 5, h: 6 }],
  }, { lamp: 0xffd2a8 });
  corridor('z', 31, 55, 17, 23, 6);                         // A→E 縦通路（バキューム）
  // E：円形ホール
  {
    const { x: cx, z: cz, r, h } = E_C;
    rooms.push({ id: 'E', name: 'E 円形ホール', x0: cx - r, x1: cx + r, z0: cz - r, z1: cz + r, h });
    const openings = [
      { a: 90 * DEG, half: 14 * DEG, h: 6 },                                          // 南：A への縦通路
      { a: Math.asin(-4.5 / r), half: 12 * DEG, h: 6 },                               // 東：F への通路
      { a: 45 * DEG, half: 12 * DEG, h: 5 },                                          // 南東：I への斜め通路
    ];
    circleRoom(cx, cz, r, h, openings);
    box(cx - r - 1, cx + r + 1, h, h + 1, cz - r - 1, cz + r + 1, 'ceil', K.ceil, true, 'ceiling');
    for (const [lx, lz] of [[0, 0], [-7, -4], [7, -4], [-7, 5], [7, 5]] as const) {
      box(cx + lx - 1, cx + lx + 1, h - 0.08, h, cz + lz - 1, cz + lz + 1, 'glow', 0xeaf6ff, false);
      lamps.push({ x: cx + lx, y: h - 0.3, z: cz + lz, color: 0xc8dcff, room: 'E', power: 1.1 });
    }
  }
  // E→F：壁は円の外周（当たり判定の輪）とつながる所から。天井は円の外から
  wall('z', 10, 31.2, 48, 6);
  wall('z', 16, 33.3, 48, 6);
  box(33.3, 48, 6, 7, 10, 17, 'ceil', K.ceil, true, 'ceiling');
  for (const u of [36, 42]) { box(u - 0.6, u + 0.6, 5.94, 6, 13.2, 13.8, 'glow', 0xeaf6ff, false); lamps.push({ x: u, y: 5.7, z: 13.5, color: 0xbfd6ff, room: 'corr', power: 0.6 }); }
  room('F', 'F 資材室', 49, 72, 4, 24, 9, { w: [{ c: 13.5, w: 5, h: 6 }], s: [{ c: 64.5, w: 5, h: 6 }] });
  corridor('z', 25, 32, 62, 67, 6);                         // F→G
  // G：監視室（東の壁は天井まで。天井付近に D への隠し通路）
  const duct = { x0: 81, x1: 85, y0: 7.6, y1: 9.6, z0: 38, z1: 40.2 };
  room('G', 'G 監視室', 57, 81, 33, 45, 10, { n: [{ c: 64.5, w: 5, h: 6 }] }, { noWall: ['e'], lamp: 0xa8c8ff });
  // D：前室（西の壁は天井まで。北に H、南に C からのキー扉の通路）
  room('D', 'D 前室', 85, 108, 32, 50, 10, { n: [{ c: 96, w: 8, h: 7 }], s: [{ c: 92.5, w: 5, h: 6 }] }, { noWall: ['w'], lamp: 0xffc8a8 });
  // G と D のあいだの厚い壁（x 81..85、天井まで）。ダクトの穴だけ空ける
  {
    const zA = 31, zB = 51;
    box(81, 85, 0, duct.y0, zA, zB, 'wall', K.wall, true, 'wall');
    box(81, 85, duct.y0, duct.y1, zA, duct.z0, 'wall', K.wall, true, 'wall');
    box(81, 85, duct.y0, duct.y1, duct.z1, zB, 'wall', K.wall, true, 'wall');
    box(81, 85, duct.y1, 10, zA, zB, 'wall', K.wall, true, 'wall');
    // 両面の帯（ダクトの口を避ける）
    for (const [x0, x1] of [[80.94, 81], [85, 85.06]] as const) {
      box(x0, x1, 0, 0.9, 33, 45, 'dark', K.wallDark, false);
      box(x0, x1, 0.9, 1.0, 33, 45, 'glow', K.red, false);
      // ダクトの口の格子の枠（よく見ると分かる）
      box(x0, x1, duct.y0 - 0.12, duct.y0, duct.z0 - 0.1, duct.z1 + 0.1, 'metal', K.steel, false);
      box(x0, x1, duct.y1, duct.y1 + 0.12, duct.z0 - 0.1, duct.z1 + 0.1, 'metal', K.steel, false);
    }
    // ダクトの中：薄暗い金属の内張りと点々と光るガイド
    box(81, 85, duct.y0 - 0.02, duct.y0, duct.z0, duct.z1, 'metal', 0x3a414c, false);
    for (let x = 81.6; x < 85; x += 1.2) box(x - 0.1, x + 0.1, duct.y1 - 0.04, duct.y1, (duct.z0 + duct.z1) / 2 - 0.1, (duct.z0 + duct.z1) / 2 + 0.1, 'glow', K.cyan, false);
  }
  corridor('z', 51, 57, 90, 95, 6);                         // D→C（キー扉）
  room('C', 'C 配電室', 80, 104, 58, 76, 8, { n: [{ c: 92.5, w: 5, h: 6 }], w: [{ c: 65.5, w: 5, h: 6 }] }, { grp: 'C', lamp: 0xd8f0ff });
  // J：C の右下隅の小部屋（西の壁の下半分が脆い壁）
  const brittle = { x0: 97.5, x1: 98.5, y0: 0, y1: 4.5, z0: 70, z1: 76, face: 'west' as const };
  wall('z', 69, 97.5, 104, 8);
  box(97.5, 98.5, brittle.y1, 8, 70, 76, 'wall', K.wall, true, 'wall');
  rooms.push({ id: 'J', name: 'J 隠し部屋', x0: 98.5, x1: 104, z0: 70, z1: 76, h: 8 });
  lamps.push({ x: 101.2, y: 4, z: 73, color: 0xffd27a, room: 'J', power: 0.5 });
  room('B', 'B 倉庫', 51, 67, 59, 73, 8, { w: [{ c: 65.5, w: 5, h: 6 }], e: [{ c: 65.5, w: 5, h: 6 }] }, { lamp: 0xe8dcc8 });
  corridor('x', 38, 50, 63, 68, 6);                         // A→B
  corridor('x', 68, 79, 63, 68, 6);                         // B→C
  // H：大ホール（中ボス戦）。南に D、北東の隅に2階への出口
  room('H', 'H 大ホール', 83, 111, 3, 27, 12, { s: [{ c: 96, w: 8, h: 7 }], n: [{ c: 106, w: 6, h: 5 }] }, { lamp: 0xffb8b0 });
  corridor('z', 28, 31, 92, 100, 7);                        // D→H
  // 出口の奥（階段のある小部屋）
  const exit = { x0: 103, x1: 109, z0: -4, z1: 2 };
  wall('x', exit.x0 - T, exit.z0, exit.z1, 5);
  wall('x', exit.x1, exit.z0, exit.z1, 5);
  wall('z', exit.z0 - T, exit.x0 - T, exit.x1 + T, 5);
  box(exit.x0 - T, exit.x1 + T, 5, 6, exit.z0 - T, exit.z1, 'ceil', K.ceil, true, 'ceiling');
  for (let i = 0; i < 6; i++) box(exit.x0 + 0.5, exit.x1 - 0.5, 0, 0.25 + i * 0.25, exit.z0 + i * 0.5, exit.z0 + 0.5 + i * 0.5, 'metal', K.steel, false);
  box(exit.x0, exit.x1, 4.9, 5, exit.z0, exit.z1, 'glow', 0xffe0c0, false);
  lamps.push({ x: 106, y: 4.6, z: -1, color: 0xffe0c0, room: 'exit', power: 0.7 });

  // I：小さな円形の隠し部屋と、E からの斜め通路
  {
    const { x: cx, z: cz, r, h } = I_C;
    rooms.push({ id: 'I', name: 'I 隠し部屋', x0: cx - r, x1: cx + r, z0: cz - r, z1: cz + r, h });
    circleRoom(cx, cz, r, h, [{ a: -135 * DEG, half: 32 * DEG, h }]);
    box(cx - r - 1, cx + r + 1, h, h + 1, cz - r - 1, cz + r + 1, 'ceil', K.ceil, true, 'ceiling');
    lamps.push({ x: cx, y: h - 0.4, z: cz, color: 0xffe08a, room: 'I', power: 0.6 });
    box(cx - 0.8, cx + 0.8, h - 0.08, h, cz - 0.8, cz + 0.8, 'glow', 0xffe8b0, false);
  }
  diagonalCorridor();

  // ================================================================ 地下通路（A のハッチの下）
  const tunnel = { x0: 4, x1: 36, z0: 56.5, z1: 64, floor: -5 };
  {
    const fy = tunnel.floor;
    box(2, 38, fy - 1, fy, 55, 66, 'floor', 0x4a505a, true, 'floor');
    // 通路（x 4..28, z 57.5..61）と突き当たりの部屋（x 28..36, z 56.5..64）
    const wz = (zMin: number, x0: number, x1: number) => box(x0, x1, fy, -1, zMin, zMin + T, 'wall', K.wallDark, true, 'wall');
    const wx = (xMin: number, z0: number, z1: number) => box(xMin, xMin + T, fy, -1, z0, z1, 'wall', K.wallDark, true, 'wall');
    wx(3, 56.5, 62);
    wz(56.5, 3, 28); wz(61, 3, 28);
    wx(28, 55.5, 57.5); wx(28, 61, 65);
    wz(55.5, 28, 37); wz(64, 28, 37);
    wx(36, 55.5, 65);
    // ハッチの下の段（ジャンプで登れる高さ。ハッチの真下は天井が無いので高い段）
    const steps: [number, number, number][] = [[10.8, 12, -4.2], [9.6, 10.8, -3.6], [8.4, 9.6, -2.9], [7.2, 8.4, -2.0], [4, 7.2, -1.1]];
    for (const [x0, x1, top] of steps) box(x0, x1, fy, top, 57.5, 61, 'crate', K.steel, true, 'step');
    for (let x = 8; x < 34; x += 6) lamps.push({ x, y: -1.4, z: 59.2, color: 0x7ae8ff, room: 'tunnel', power: 0.5 });
    for (let x = 8; x < 34; x += 6) box(x - 0.6, x + 0.6, -1.05, -1, 59, 59.5, 'glow', K.cyan, false);
  }

  // ================================================================ 部屋の中身
  // ---- A：送電ソケット（西の壁）、ハッチ、木箱
  const hatchSocket = { x: 3.35, y: 1.7, z: 62.2, r: 0.7 };
  bx(3.2, 0, 62.2, 0.5, 3.2, 1.6, 'metal', K.steel, false);
  box(hatch.x0 - 0.3, hatch.x1 + 0.3, 0, 0.04, hatch.z0 - 0.3, hatch.z0, 'hazard', 0xffffff, false);
  box(hatch.x0 - 0.3, hatch.x1 + 0.3, 0, 0.04, hatch.z1, hatch.z1 + 0.3, 'hazard', 0xffffff, false);
  // ソケットからハッチへのケーブル（床）
  box(3.6, 6, 0, 0.05, 62.0, 62.4, 'glow', K.cyan, false);
  box(5.8, 6.2, 0, 0.05, 60.4, 62.4, 'glow', K.cyan, false);
  for (const [x, z, s, h, c] of [[30, 60, 2.4, 2.4, K.crate], [32.6, 60.3, 2, 1.6, K.crate2], [30.5, 72, 2.4, 1.6, K.crate3], [6, 71, 2, 2.4, K.crate], [24, 70, 3, 1.2, K.crate2]] as const) {
    bx(x, 0, z, s, h, s, 'crate', c, true, 'crate');
  }
  // ---- B：高く積まれた木箱（上にキー①。グラップルでしか届かない）
  bx(64, 0, 70.5, 3, 2.4, 3, 'crate', K.crate, true, 'crate');
  bx(64, 2.4, 70.5, 2.4, 2.0, 2.4, 'crate', K.crate2, true, 'crate');
  bx(64, 4.4, 70.5, 1.8, 1.6, 1.8, 'crate', K.crate3, true, 'crate');
  for (const [x, z, s, h, c] of [[55, 62, 2.4, 1.2, K.crate2], [56.5, 70, 2.4, 2.4, K.crate], [59.5, 61.2, 1.6, 1.2, K.crate3], [65.5, 61.5, 2, 1.6, K.crate]] as const) {
    bx(x, 0, z, s, h, s, 'crate', c, true, 'crate');
  }
  // ---- E：北側のキャットウォーク（高さ 6。グラップルで登る。上に電力源②と歯車）
  box(14, 26, 5.4, 6, 7.6, 10.6, 'metal', K.metal, true, 'catwalk');
  box(14, 26, 6, 7.0, 10.5, 10.6, 'metal', K.steel, false);
  for (const x of [14.5, 20, 25.5]) box(x - 0.2, x + 0.2, 0, 5.4, 10.1, 10.5, 'metal', K.steel, true, 'pillar');
  box(14, 26, 5.95, 6.0, 10.45, 10.6, 'glow', K.amber, false);
  // ---- F：北の壁沿いの中二階（高さ 5。上にキー②）
  box(49, 72, 4.4, 5, 4, 7.5, 'metal', K.metal, true, 'catwalk');
  box(49, 72, 5, 6, 7.4, 7.5, 'metal', K.steel, false);
  box(49, 72, 4.95, 5, 7.35, 7.5, 'glow', K.amber, false);
  for (const x of [52, 58, 64, 70]) box(x - 0.2, x + 0.2, 0, 4.4, 7.0, 7.4, 'metal', K.steel, true, 'pillar');
  bx(67.5, 5, 5.4, 1.6, 1.4, 1.6, 'crate', K.crate, true, 'crate');
  bx(54, 5, 5.2, 2, 1.2, 1.8, 'crate', K.crate2, true, 'crate');
  for (const [x, z, s, h, c] of [[53, 14, 2.4, 1.6, K.crate], [60, 19, 2.4, 2.4, K.crate3], [68, 13, 2, 1.2, K.crate2], [57, 10.5, 1.6, 1.2, K.crate]] as const) {
    bx(x, 0, z, s, h, s, 'crate', c, true, 'crate');
  }
  // ---- G：監視モニター（北・西の壁沿いの机）
  for (const [x, z] of [[60, 35], [66, 35], [72, 35], [58.5, 40]] as const) {
    bx(x, 0, z, 3, 1, 1.2, 'metal', K.steel, true, 'desk');
    box(x - 1.2, x + 1.2, 1.3, 2.6, z - 0.62, z - 0.55, 'glow', 0x5ad8ff, false);
  }
  // ---- C：配電盤（東の壁）と、電源スイッチ（西の壁。B からの入口の脇）
  for (let z = 60; z < 68; z += 2.6) {
    box(102.8, 104, 0, 3.2, z, z + 2.2, 'metal', K.steel, true, 'panel');
    box(102.74, 102.8, 1.2, 2.8, z + 0.3, z + 1.9, 'glow', 0x6af0a0, false, undefined, 'C');
  }
  const cSocket = { x: 80.35, y: 1.7, z: 61.5, r: 0.7 };
  bx(80.2, 0, 61.5, 0.5, 3.2, 1.6, 'metal', K.steel, false);
  for (const [x, z, s, h, c] of [[86, 72, 2.4, 1.6, K.crate], [90, 64, 2.4, 2.4, K.crate2], [94, 71, 2, 1.2, K.crate3]] as const) {
    bx(x, 0, z, s, h, s, 'crate', c, true, 'crate');
  }
  // J の脆い壁のまわりのハザード
  box(96.2, 97.5, 0, 0.04, 70, 76, 'hazard', 0xffffff, false);
  // ---- D：予備バッテリー
  bx(106.6, 0, 34, 1.4, 2.6, 1.4, 'metal', K.steel, true, 'battery');
  for (const [x, z, s, h, c] of [[88, 46, 2.4, 1.6, K.crate], [104, 46, 2.4, 2.4, K.crate3]] as const) bx(x, 0, z, s, h, s, 'crate', c, true, 'crate');
  // ---- H：北西の隅の高台（高さ 6。上に歯車）と、遮蔽物
  box(84, 91, 5.4, 6, 4, 10, 'metal', K.metal, true, 'catwalk');
  for (const [x, z] of [[84.5, 9.5], [90.5, 9.5]] as const) box(x - 0.2, x + 0.2, 0, 5.4, z - 0.2, z + 0.2, 'metal', K.steel, true, 'pillar');
  box(84, 91, 5.95, 6, 9.85, 10, 'glow', K.amber, false);
  for (const [x, z, s, h] of [[92, 18, 3, 1.8], [102, 18, 3, 1.8], [97, 22, 3, 1.4], [88, 22, 2.4, 2.4], [107, 22, 2.4, 2.4]] as const) {
    bx(x, 0, z, s, h, s, 'metal', K.steel, true, 'cover');
  }
  // 出口の扉の上の赤い斜線（2階への出口）
  box(103, 109, 0, 0.04, 3, 5.5, 'hazard', 0xffffff, false);

  // ================================================================ レーザー網（E→I の斜め通路の入口）と電力源
  const sAt = (s: number, off = 0) => ({ x: E_C.x + s / Math.SQRT2 - off / Math.SQRT2, z: E_C.z + s / Math.SQRT2 + off / Math.SQRT2 });
  const lc = sAt(17.5);
  const la = sAt(17.5, -2.4), lb = sAt(17.5, 2.4);
  const laser = {
    box: { x0: lc.x - 2.3, x1: lc.x + 2.3, z0: lc.z - 2.3, z1: lc.z + 2.3, y1: 5 },
    ax: la.x, az: la.z, bx: lb.x, bz: lb.z,
    machines: [sAt(17.5, -2.75), sAt(17.5, 2.75)],
  };
  const sources = [
    { id: 'L1', x: 8.6, y: 1.4, z: 21, r: 0.9, laser: true },
    { id: 'L2', x: 22.5, y: 7.1, z: 8.9, r: 0.9, laser: true },
    { id: 'D', x: 106.6, y: 3.2, z: 34, r: 0.8, laser: false },
  ];
  for (const s of sources.filter((q) => q.laser)) {
    box(s.x - 0.8, s.x + 0.8, s.y - 1.4, s.y - 0.75, s.z - 0.8, s.z + 0.8, 'metal', K.steel, true, 'source');
  }
  // 床のケーブル：電力源①→機械（見た目だけ）
  box(8.6, 31, 0, 0.05, 20.8, 21.2, 'glow', 0xff5a3a, false);

  // ================================================================ 歯車・キー・バキューム
  const gears: GearDef[] = [
    { id: 'tunnel', x: 32, y: -3.8, z: 60.2, area: '地下通路' },
    { id: 'E', x: 16, y: 7.1, z: 9, area: 'E キャットウォーク' },
    { id: 'I', x: I_C.x + 1.2, y: 1.2, z: I_C.z + 1.2, area: 'I 隠し部屋' },
    { id: 'J', x: 101.5, y: 1.2, z: 73, area: 'J 隠し部屋' },
    { id: 'duct', x: 83, y: 8.6, z: (duct.z0 + duct.z1) / 2, area: 'G→D 隠し通路' },
    { id: 'H', x: 86.5, y: 7.1, z: 6.5, area: 'H 高台' },
  ];
  const keys = [
    { id: 'B' as const, x: 64, y: 6.9, z: 70.5, hint: 'B の積まれた木箱の上' },
    { id: 'F' as const, x: 70.5, y: 5.9, z: 5.4, hint: 'F の中二階の奥' },
  ];

  // ================================================================ シャッター
  const gates: GateDef[] = [
    { id: 'front', x0: 8, x1: 14, z0: 76, z1: 77, h: 5, closed: true, color: 0x8a96a8, label: '建物の入口' },
    { id: 'key', x0: 90, x1: 95, z0: 57, z1: 58, h: 6, closed: true, color: K.blue, label: 'セキュリティ扉（キー2本）' },
    { id: 'hEntry', x0: 92, x1: 100, z0: 27, z1: 28, h: 7, closed: false, color: 0x8a96a8, label: 'H の入口（閉じ込め戦で閉まる）' },
    { id: 'exit', x0: 103, x1: 109, z0: 2, z1: 3, h: 5, closed: true, color: K.red, label: '2階への出口' },
  ];

  // ================================================================ 敵（1〜11番だけ：ドローン・クローラー・ガンナー・ウォーカー・ヘビー・ヘビーウォーカー・ミサイル溜めロボット・ビーマー・リーチ・赤ウォーカー）
  const zones: ZoneDef[] = [
    { id: 'A', name: 'A', mode: 'zone', face: { x: 20, z: 66 }, spawns: [
      { kind: 'drone', x: 28, z: 62, mode: 'drop' }, { kind: 'drone', x: 14, z: 61, mode: 'drop' },
    ] },
    { id: 'tunnel', name: '地下通路', mode: 'zone', face: { x: 20, z: 59 }, spawns: [
      { kind: 'leech', x: 31, z: 58.5, floor: -5, mode: 'awake' }, { kind: 'leech', x: 33.5, z: 62, floor: -5, mode: 'awake' },
    ] },
    { id: 'B', name: 'B', mode: 'zone', face: { x: 52, z: 66 }, spawns: [
      { kind: 'crawler', x: 61.5, z: 64 }, { kind: 'crawler', x: 59, z: 70.5 }, { kind: 'drone', x: 62, z: 66, mode: 'drop' },
    ] },
    { id: 'E', name: 'E', mode: 'zone', face: { x: 20, z: 30 }, spawns: [
      { kind: 'walker', x: 14, z: 14 }, { kind: 'walker', x: 27, z: 16 }, { kind: 'drone', x: 20, z: 12, mode: 'drop' }, { kind: 'drone', x: 13, z: 22, mode: 'drop' },
    ] },
    { id: 'F', name: 'F', mode: 'zone', face: { x: 50, z: 13 }, spawns: [
      { kind: 'gunner', x: 62, z: 5.6, floor: 5 }, { kind: 'gunner', x: 66, z: 19 }, { kind: 'crawler', x: 58, z: 15 }, { kind: 'crawler', x: 64, z: 11 },
      { kind: 'leech', x: 55, z: 20, mode: 'awake' },
    ] },
    { id: 'G', name: 'G', mode: 'zone', face: { x: 64, z: 34 }, spawns: [
      { kind: 'heavy', x: 70, z: 40 }, { kind: 'walker', x: 76, z: 36 }, { kind: 'walker', x: 76, z: 43 },
    ] },
    { id: 'C', name: 'C', mode: 'zone', face: { x: 81, z: 65 }, spawns: [
      { kind: 'gunner', x: 96, z: 62 }, { kind: 'gunner', x: 99, z: 66 }, { kind: 'walker', x: 90, z: 70 }, { kind: 'crawler', x: 88, z: 60 }, { kind: 'crawler', x: 86, z: 67 },
    ] },
    { id: 'D', name: 'D', mode: 'zone', face: { x: 92, z: 50 }, spawns: [
      { kind: 'heavyWalker', x: 100, z: 38 }, { kind: 'gunner', x: 90, z: 36 }, { kind: 'crawler', x: 104, z: 42 }, { kind: 'crawler', x: 92, z: 42 },
    ] },
    { id: 'boss', name: 'H 中ボス戦', mode: 'trap', face: { x: 96, z: 26 }, spawns: [
      { kind: 'beamer', x: 90, z: 8 }, { kind: 'beamer', x: 103, z: 8 },
      { kind: 'gunner', x: 86, z: 15 }, { kind: 'gunner', x: 108, z: 14 },
      { kind: 'crawler', x: 94, z: 13 }, { kind: 'crawler', x: 99, z: 14 }, { kind: 'crawler', x: 96, z: 4.3 },
      { kind: 'drone', x: 92, z: 10, mode: 'drop' }, { kind: 'drone', x: 101, z: 10, mode: 'drop' },
    ], wave2: [
      { kind: 'heavyWalker', x: 96, z: 9 }, { kind: 'missile', x: 106, z: 7 }, { kind: 'walker', x: 86, z: 17 }, { kind: 'walker', x: 108.5, z: 17.5 },
    ] },
  ];

  const start = { x: 11, z: 73, yaw: 0 };
  return {
    boxes, arcs, rooms, lamps, gears, zones, gates,
    grapples: [
      { x: 64, y: 6, z: 69.6, nx: 0, nz: -1, label: 'B の木箱の上（キー①）' },
    ],
    checkpoints: { entrance: start, boss: { x: 96, z: 46, yaw: 0 } },
    keys, keyDoor: { x: 92.5, z: 60 },
    vacuum: { x: 20, y: 1.2, z: 43 },
    hatchSocket, hatch, tunnel, cSocket, brittle, laser, sources, duct,
    guide: { x: 79.6, z: (duct.z0 + duct.z1) / 2, room: { x0: 57, x1: 81, z0: 33, z1: 45 } },
    bossTrigger: { x0: 83, x1: 111, z0: 3, z1: 24 },
    exit,
    start,
    redWalker: { x: 22, z: 64 },
    centers: {
      A: { x: 20, z: 66 }, B: { x: 59, z: 66 }, C: { x: 92, z: 67 }, D: { x: 96, z: 41 }, E: { x: E_C.x, z: E_C.z }, F: { x: 60, z: 14 },
      G: { x: 69, z: 39 }, H: { x: 97, z: 15 }, I: { x: I_C.x, z: I_C.z }, J: { x: 101, z: 73 }, AE: { x: 20, z: 43 },
    },
  };

  // ---------------------------------------------------------------- 円形の部屋
  function circleRoom(cx: number, cz: number, r: number, h: number, openings: { a: number; half: number; h: number }[]): void {
    const inOpen = (a: number) => openings.find((o) => Math.abs(Math.atan2(Math.sin(a - o.a), Math.cos(a - o.a))) < o.half);
    // 当たり判定：円周に沿って小さな箱を並べる（開口は上だけ）
    const rr = r + 0.6, n = Math.ceil((2 * Math.PI * rr) / 0.9);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      const o = inOpen(a);
      box(x - 0.65, x + 0.65, o ? o.h : 0, h, z - 0.65, z + 0.65, 'hidden', 0, true, 'wall');
    }
    // 見た目：開口の間の壁、開口の上の壁
    const sorted = [...openings].sort((p, q) => p.a - q.a);
    for (let i = 0; i < sorted.length; i++) {
      const o = sorted[i], nx = sorted[(i + 1) % sorted.length];
      let a0 = o.a + o.half, a1 = nx.a - nx.half;
      if (a1 <= a0) a1 += Math.PI * 2;
      arcs.push({ cx, cz, r, y0: 0, y1: h, a0, a1, c: K.wall });
      arcs.push({ cx, cz, r: r - 0.05, y0: 0.9, y1: 1.0, a0, a1, c: K.red });
      arcs.push({ cx, cz, r, y0: o.h, y1: h, a0: o.a - o.half, a1: o.a + o.half, c: K.wall });
    }
  }

  // ---------------------------------------------------------------- 斜めの通路（E→I）
  function diagonalCorridor(): void {
    const u = Math.SQRT1_2;
    const at = (s: number, off: number) => ({ x: E_C.x + s * u - off * u, z: E_C.z + s * u + off * u });
    const sEnd = Math.hypot(I_C.x - E_C.x, I_C.z - E_C.z) - I_C.r + 0.6;
    for (let s = E_C.r - 0.4; s <= sEnd; s += 1.0) {
      for (const off of [-3, 3]) {
        const p = at(s, off);
        box(p.x - 0.7, p.x + 0.7, 0, 5, p.z - 0.7, p.z + 0.7, 'hidden', 0, true, 'wall');
      }
    }
    for (let s = 17; s <= sEnd + 0.5; s += 1.2) {
      const p = at(s, 0);
      box(p.x - 2.2, p.x + 2.2, 5, 6, p.z - 2.2, p.z + 2.2, 'hidden', 0, true, 'ceiling');
    }
    lamps.push({ x: at(26, 0).x, y: 4.6, z: at(26, 0).z, color: 0xff8a6a, room: 'diag', power: 0.6 });
  }
}

/** 斜め通路の見た目（中心線の始点・終点）。visuals が傾けた箱で描く */
export function diagonalSpan(): { x0: number; z0: number; x1: number; z1: number; len: number } {
  const u = Math.SQRT1_2;
  const s0 = E_C.r - 0.6, s1 = Math.hypot(I_C.x - E_C.x, I_C.z - E_C.z) - I_C.r + 0.4;
  return { x0: E_C.x + s0 * u, z0: E_C.z + s0 * u, x1: E_C.x + s1 * u, z1: E_C.z + s1 * u, len: s1 - s0 };
}
