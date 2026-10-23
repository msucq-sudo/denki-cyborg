// ダンジョンのレイアウト定義（純データ＋純関数）。three に依存しない。
import { ENEMIES, LEVEL } from '../config/balance';
import type { EnemyKind } from '../config/balance';

export const WALL_T = 1;       // 壁の厚み
export const CORRIDOR_L = 8;   // 通路の長さ
export const DOOR_W = 6;       // ドア/通路の幅
export const DOOR_H = 5;       // ドア/通路の高さ
export const ENTER_DEPTH = 2.5; // 部屋に入ったとみなす入口からの距離

export type Zone = 'ground' | 'platform';
export interface WaveGroup { kind: EnemyKind; count: number; zone?: Zone }
export type Wave = WaveGroup[];

export interface BlockDef {
  /** 部屋中心からのオフセット */
  lx: number; lz: number;
  sx: number; sy: number; sz: number;
  kind: 'cover' | 'platform' | 'step' | 'pillar';
}
export interface PadDef { lx: number; lz: number; y?: number; capacity?: number }
export interface KitDef { lx: number; lz: number }

export interface RoomDef {
  name: string;
  /** 区画名の看板に出す文字 */
  title: string;
  w: number; d: number; h: number;
  waves: Wave[];
  blocks: BlockDef[];
  pads: PadDef[];
  kits: KitDef[];
  lightColor: number;
  /** 高台（ウェーブの zone:'platform' の出現位置に使う） */
  platform?: { lx: number; lz: number; w: number; d: number; top: number };
  boss?: boolean;
}

const cover = (lx: number, lz: number, sx = 2.4, sy = 2.2, sz = 2.4): BlockDef => ({ lx, lz, sx, sy, sz, kind: 'cover' });

export const ROOM_DEFS: RoomDef[] = [
  {
    name: '入口：メンテナンス通路', title: '入口  メンテナンス通路', w: 20, d: 28, h: 8, waves: [],
    blocks: [], pads: [{ lx: -5, lz: -2 }], kits: [], lightColor: 0xcfe8ff,
  },
  {
    name: '第1区画：搬入ホール', title: '第1区画  搬入ホール', w: 26, d: 30, h: 9,
    waves: [[{ kind: 'drone', count: 3 }]],
    blocks: [cover(-7, 2), cover(7, 2), cover(0, 8, 4, 1.6, 2), cover(-9, -6, 2, 2.4, 2)],
    pads: [], kits: [{ lx: -11, lz: -13 }], lightColor: 0xd9d0ff,
  },
  {
    name: '第2区画：配電室', title: '第2区画  配電室', w: 30, d: 34, h: 10,
    waves: [[{ kind: 'crawler', count: 4 }], [{ kind: 'drone', count: 2 }]],
    blocks: [cover(-9, 4), cover(9, 4), cover(0, -2, 5, 1.6, 2), cover(-11, -9), cover(11, -9)],
    pads: [], kits: [{ lx: -11, lz: -13 }, { lx: 12, lz: 14 }], lightColor: 0xffe0d0,
  },
  {
    name: '第3区画：昇降プラットフォーム', title: '第3区画  昇降プラットフォーム', w: 32, d: 38, h: 12,
    waves: [[{ kind: 'gunner', count: 2, zone: 'platform' }, { kind: 'crawler', count: 3 }]],
    blocks: [
      { lx: 12, lz: -13, sx: 8, sy: 4.8, sz: 12, kind: 'platform' },
      { lx: 12, lz: -6, sx: 8, sy: 3.6, sz: 2, kind: 'step' },
      { lx: 12, lz: -4, sx: 8, sy: 2.4, sz: 2, kind: 'step' },
      { lx: 12, lz: -2, sx: 8, sy: 1.2, sz: 2, kind: 'step' },
      cover(-8, 3), cover(-2, -4, 3, 1.6, 2), cover(6, 8),
    ],
    pads: [{ lx: 12, lz: -14, y: 4.8 }], kits: [{ lx: -13, lz: -15 }], lightColor: 0xc8f0e8,
    platform: { lx: 12, lz: -13, w: 8, d: 12, top: 4.8 },
  },
  {
    name: '第4区画：重機ハンガー', title: '第4区画  重機ハンガー', w: 30, d: 34, h: 10,
    waves: [[{ kind: 'heavy', count: 1 }, { kind: 'drone', count: 2 }], [{ kind: 'gunner', count: 2 }]],
    blocks: [cover(-9, 3, 2.4, 2.6, 2.4), cover(9, 3, 2.4, 2.6, 2.4), cover(-9, -8, 2.4, 2.6, 2.4), cover(9, -8, 2.4, 2.6, 2.4)],
    pads: [], kits: [{ lx: -12, lz: 14 }, { lx: 12, lz: 14 }], lightColor: 0xffd8e8,
  },
  {
    name: '第5区画：中央制御室', title: '第5区画  中央制御室', w: 40, d: 40, h: 12,
    waves: [
      [{ kind: 'crawler', count: 3 }, { kind: 'drone', count: 2 }],
      [{ kind: 'heavy', count: 2 }, { kind: 'gunner', count: 1 }],
    ],
    blocks: [cover(-12, 6), cover(12, 6), cover(0, 0, 4, 1.8, 4), cover(-14, -6), cover(14, -6), cover(-6, -12, 3, 1.6, 2), cover(6, -12, 3, 1.6, 2)],
    pads: [{ lx: 0, lz: 13 }], kits: [{ lx: -16, lz: 14 }, { lx: 16, lz: 14 }], lightColor: 0xe8e0ff,
  },
  {
    name: '前室：最終隔壁', title: '前室  最終隔壁', w: 20, d: 22, h: 8, waves: [],
    blocks: [], pads: [{ lx: -5, lz: 0 }], kits: [{ lx: 5, lz: 0 }], lightColor: 0xffc8c8,
  },
  {
    name: '動力炉', title: '動力炉  ジェネレーター', w: 44, d: 44, h: 16,
    waves: [[{ kind: 'boss', count: 1 }]],
    blocks: [
      { lx: -10, lz: -10, sx: 2.4, sy: 16, sz: 2.4, kind: 'pillar' },
      { lx: 10, lz: -10, sx: 2.4, sy: 16, sz: 2.4, kind: 'pillar' },
      { lx: -10, lz: 10, sx: 2.4, sy: 16, sz: 2.4, kind: 'pillar' },
      { lx: 10, lz: 10, sx: 2.4, sy: 16, sz: 2.4, kind: 'pillar' },
      // 四隅の面取り（階段状）
      ...[-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [9, 6, 3].map((s) => ({
        lx: sx * (22 - s / 2), lz: sz * (22 - s / 2), sx: s, sy: 16, sz: s, kind: 'cover' as const,
      })))),
    ],
    pads: [
      { lx: -16, lz: 6, capacity: LEVEL.chargePadCapacity * 0.5 },
      { lx: 16, lz: 6, capacity: LEVEL.chargePadCapacity * 0.5 },
    ],
    kits: [{ lx: -17, lz: 17 }, { lx: 17, lz: 17 }, { lx: 0, lz: 18 }], lightColor: 0xa8f0ff, boss: true,
  },
];

export interface DoorLayout {
  /** ドアの中心 */
  cx: number; cy: number; cz: number;
  xMin: number; xMax: number; yMax: number;
  zMin: number; zMax: number;
}

export interface RoomLayout {
  index: number;
  def: RoomDef;
  cx: number; cz: number;
  xMin: number; xMax: number;
  zMin: number; zMax: number;
  h: number;
  /** 出口ドア（最後の部屋は無し） */
  door: DoorLayout | null;
}

/** 部屋を -z 方向へ一直線に並べる */
export function computeLayout(defs: RoomDef[] = ROOM_DEFS): RoomLayout[] {
  const out: RoomLayout[] = [];
  let zMax = 0;
  defs.forEach((def, i) => {
    const zMin = zMax - def.d;
    const layout: RoomLayout = {
      index: i, def, cx: 0, cz: (zMin + zMax) / 2,
      xMin: -def.w / 2, xMax: def.w / 2, zMin, zMax, h: def.h, door: null,
    };
    if (i < defs.length - 1) {
      layout.door = {
        cx: 0, cy: DOOR_H / 2, cz: zMin - WALL_T / 2,
        xMin: -DOOR_W / 2, xMax: DOOR_W / 2, yMax: DOOR_H,
        zMin: zMin - WALL_T, zMax: zMin,
      };
    }
    out.push(layout);
    zMax = zMin - 2 * WALL_T - CORRIDOR_L;
  });
  return out;
}

export interface SpawnPoint { kind: EnemyKind; x: number; y: number; z: number }

const AIR: EnemyKind[] = ['drone', 'boss'];

/** あるウェーブの出現位置（部屋の奥側中心） */
export function spawnPoints(room: RoomLayout, wave: Wave): SpawnPoint[] {
  const pts: SpawnPoint[] = [];
  wave.forEach((g, gi) => {
    for (let i = 0; i < g.count; i++) {
      const air = AIR.includes(g.kind);
      const r = ENEMIES[g.kind].radius;
      let x: number, z: number, floor = 0;
      if (g.zone === 'platform' && room.def.platform) {
        const p = room.def.platform;
        const sp = Math.min(2.5, (p.w * 0.6) / g.count);
        x = room.cx + p.lx + (i - (g.count - 1) / 2) * sp;
        z = room.cz + p.lz + gi * 0;
        floor = p.top;
      } else if (g.kind === 'boss') {
        // 中央のエネルギー柱と重ならないよう奥側に出す
        x = room.cx; z = room.zMin + room.def.d * 0.25;
      } else {
        const sp = Math.min(6, (room.def.w * 0.7) / g.count);
        x = room.cx + (i - (g.count - 1) / 2) * sp;
        z = room.zMin + room.def.d * 0.22 + gi * 4;
      }
      const y = air ? floor + 3 + (i % 3) : floor + r + 0.1;
      pts.push({ kind: g.kind, x, y, z });
    }
  });
  return pts;
}

/** ウェーブ進行の純関数 */
export type WaveAction = 'spawn' | 'wait' | 'clear';
export function nextWaveAction(waveIdx: number, totalWaves: number, alive: number): WaveAction {
  if (waveIdx < 0) return totalWaves > 0 ? 'spawn' : 'clear';
  if (alive > 0) return 'wait';
  return waveIdx + 1 < totalWaves ? 'spawn' : 'clear';
}

/** プレイヤー足元が部屋に入ったか（入口側 ENTER_DEPTH 以上内側） */
export function isInsideRoom(room: RoomLayout, x: number, y: number, z: number): boolean {
  return x > room.xMin + 0.5 && x < room.xMax - 0.5 && z < room.zMax - ENTER_DEPTH && z > room.zMin && y > -1 && y < room.h;
}

export function waveTotal(room: RoomDef): number {
  return room.waves.reduce((s, w) => s + w.reduce((a, g) => a + g.count, 0), 0);
}
