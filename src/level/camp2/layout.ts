// サージ収容所 2階の間取り（数値だけ。見た目は visuals.ts、進行は ../camp2.ts）。
// 南（+Z）から入ってくる。手前が敵のいる区画（収容区画の前室）、奥（-Z）が檻。檻の正面は格子で、中央に扉がある。
//
//   z = -30 ┌────────────── 檻（住民） ──────────────┐
//           │                                          │
//   z = -14 ├══════════════╡ 扉 ╞══════════════════════┤ ← 格子（CAGE_Z）
//           │   ジェネレーターはこのあたりに降りてくる  │
//           │  敵は最初いない。扉を調べた瞬間に出る      │
//   z =  22 └──────────────── 入口（南） ───────────────┘
//          x = -16                                   x = 16
import type { EnemyKind } from '../../config/balance';

/** 前室（敵のいる区画・ボス戦の部屋） */
export const HALL = { x0: -16, x1: 16, z0: -14, z1: 22, h: 10 } as const;
/** 檻の内側 */
export const CAGE = { x0: -16, x1: 16, z0: -30, z1: -14, h: 10 } as const;
/** 格子の z と厚み */
export const CAGE_Z = -14;
export const BAR_T = 0.2;
/** 檻の扉（格子の中央）。開くと +X へスライドする */
export const DOOR = { x0: -2, x1: 2, h: 3.6, slide: 4.1 } as const;
/** 扉を調べるときに立つ位置（扉の前、檻の外）と向き（yaw=0 で -Z＝扉の方） */
export const STAND = { x: 0, z: CAGE_Z + 0.85, yaw: 0 } as const;
/** 扉の錠前（左手でいじる。ワールド座標） */
export const LOCK = { x: -0.24, y: 1.18, z: CAGE_Z + BAR_T / 2 + 0.07 } as const;
/** ジェネレーターが降りてくる位置（プレイヤーの真後ろ＝檻と反対側） */
export const BOSS_LAND = { x: 0, y: 3.6, z: STAND.z + 11 } as const;
/** 開始地点（入口の前。北＝檻の方を向く） */
export const START = { x: 0, z: 19.5, yaw: 0 } as const;
/**
 * 戦闘開始時（リトライ）：扉の前からジェネレーターの方へ数歩出た所で、ジェネレーターの方を向く。
 * 三人称カメラ（後ろ 4.2m）が格子の外に収まるよう、格子から 5.4m 離す
 */
export const FIGHT_START = { x: STAND.x, z: CAGE_Z + 5.4, yaw: Math.PI, pitch: 0.2 } as const;

/** 柱（遮蔽物）。中心と幅 */
export const PILLARS: { x: number; z: number; w: number }[] = [
  { x: -9, z: -5, w: 1.4 }, { x: 9, z: -5, w: 1.4 },
  { x: -9, z: 9, w: 1.4 }, { x: 9, z: 9, w: 1.4 },
];
/** 箱（低い遮蔽物）。中心・大きさ */
export const CRATES: { x: number; z: number; w: number; d: number; h: number }[] = [
  { x: -4.5, z: 6, w: 2.2, d: 1.4, h: 1.2 },
  { x: 5, z: 2.5, w: 1.6, d: 1.6, h: 1.6 },
  { x: -12.5, z: 15, w: 2.4, d: 2.4, h: 1.3 },
  { x: 12.5, z: 16, w: 1.8, d: 3, h: 1.1 },
  { x: 13, z: -10, w: 1.8, d: 1.8, h: 1.4 },
  { x: -13, z: -9.5, w: 2.0, d: 1.4, h: 1.0 },
];

/** 扉を調べた瞬間にジェネレーターと一緒に出てくる雑魚（図鑑 No.1〜4 から。ボス No.8 は除く）。ドローンは天井から、ほかは床に現れる */
export interface SpawnDef { kind: EnemyKind; x: number; z: number; floor?: number }
export const SPAWNS: SpawnDef[] = [
  { kind: 'crawler', x: -11, z: 3 },     // No.2
  { kind: 'walker', x: -6, z: 10 },      // No.4
  { kind: 'walker', x: 6.5, z: 11 },     // No.4
  { kind: 'drone', x: -3, z: 1 },        // No.1
  { kind: 'drone', x: 4, z: -3 },        // No.1
  { kind: 'gunner', x: -10.5, z: -7 },   // No.3
];
