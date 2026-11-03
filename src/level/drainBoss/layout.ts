// ドレイン装置の部屋（?level=drainBoss）の間取り。数値だけ（見た目は visuals.ts、進行は ../drainBoss.ts、ムービーは cutscene.ts）。
//
//   z = -30 ┌──── キーボードとモニターの壁（北・正面）────┬──────┐
//           │                                            │ ドレ │
//           │          ボスの部屋（68 x 60 m）           │ イン │  ← 装置は東の壁際（プレイヤーの右手）
//           │       中央は広く空いている（動き回れる）     │ 装置 │
//   z =  30 ├────────────── 自動ドア ───────────────────┴──────┘
//           │  通路（幅6m・長さ48m）まっすぐ北へ
//   z =  78 └ スタート
//   x = -34                                            x = 34
// 北が正面（yaw=0 で -Z を向く）。東（+X）がプレイヤーの右手。
import * as THREE from 'three';

/** ボスの部屋（床は y=0）。通常のドレイン装置ダンジョンの部屋（最大でも 30x22 m）よりはるかに広い */
export const ARENA = { x0: -34, x1: 34, z0: -30, z1: 30, h: 20 } as const;
/** 通路 */
export const CORRIDOR = { x0: -3, x1: 3, z0: 30, z1: 78, h: 4.6 } as const;
/** 自動ドア（通路とボスの部屋の境目） */
export const DOOR = { z: 30, x0: -3, x1: 3, h: 4.4, thick: 0.9, openDist: 7 } as const;
/** 通路のスタート（北向き） */
export const START = { x: 0, z: 74, yaw: 0 } as const;

/** 北の壁のキーボードとモニター */
export const CONSOLE = { x0: -32, x1: 21, depth: 3.4, deskH: 1.15, screenRows: [2.6, 4.9, 7.2], screenH: 2.0, screenW: 3.0, cols: 17 } as const;
/** ドレイン装置（東の壁際）。箱型の本体 */
export const DEVICE = { x0: 23, x1: 34, z0: -21, z1: 7, h: 12 } as const;
/** 装置の吸い込み口（西向きの面 x=DEVICE.x0。プレイヤーの側）。y, z */
export const INTAKES: { y: number; z: number }[] = [{ y: 4.2, z: -14 }, { y: 4.2, z: -7 }, { y: 4.2, z: 0 }];

/** ボスの落ちてくる天井の穴の中心（真下に着地）と大きさ */
export const HOLE = { x: 0, z: 4, size: 10.2, tiles: 3 } as const;
/** ボスが着地する場所 / 戦闘開始時にボスが立つ場所（ムービーで2歩進んだ先）/ 歩幅 */
export const BOSS_LAND = { x: 0, z: 4 } as const;
export const STEP = 3.2;
export const BOSS_FIGHT = { x: 0, z: BOSS_LAND.z + STEP * 2 } as const;
/** ムービー中にライアンが立ち止まる位置 / 戦闘開始時のライアン（北向き） */
export const RYAN_STOP = { x: 0, z: 20, yaw: 0 } as const;
export const FIGHT_START = { x: 0, z: 19, yaw: 0, pitch: 0.12 } as const;

/** 床の高さ */
export const FLOOR_Y = 0;
export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- 穴の上の部屋（ボスが落ちてきた元の場所）
//   ボスの部屋の天井（y=20）の上に、同じ広さの「ボスの格納庫」がある。床の穴からここへ上がれる。
//   格納庫の西の壁の戸口から、まっすぐな搬出通路が西へ 70m。突き当たりが歯車の保管庫。
//   ┌─────────── 格納庫（68x60m・高さ10m。床=ボスの部屋の天井）──────────┐
//   │   ケージ（ボスを吊っていた架台）が穴をまたぐ                     │
//   │                       ┌穴┐                                        │
//   戸口 ←────────────────────┴──┴────────────────────────────────────────┘
//   ↓ 搬出通路（幅6m・長さ70m）→ 歯車の保管庫（24x24m）
/** 格納庫。床の上面 floorY（ボスの部屋の天井の上面）。ボスの部屋の壁を延ばした形 */
export const UPPER = { x0: -34, x1: 34, z0: -30, z1: 30, floorY: 20, slabT: 0.5, h: 10 } as const;
/** 搬出通路（西の壁の戸口から西へ）。床は floorY */
export const HALL = { x0: -104, x1: -34, z0: 1, z1: 7, h: 6 } as const;
/** 歯車の保管庫 */
export const STORE = { x0: -128, x1: -104, z0: -8, z1: 16, h: 8 } as const;
/** 穴のふちの厚み（割れた天井の断面。穴をふさがないよう外側へ張り出す）と、下へ垂れる深さ */
export const RIM = { w: 2.0, drop: 1.7 } as const;
/** 撃破後に現れる非常足場（ボスの部屋の東側、穴の隣）。上面の高さと範囲 */
export const SCAFFOLD = {
  a: { x0: 16, x1: 20, z0: 2, z1: 6, top: 6.5 },
  b: { x0: 8, x1: 12, z0: 2, z1: 6, top: 13 },
} as const;
/** 穴の西のふち（足場 b から狙う）と各足場のグラップルポイント。法線は「狙う側」へ向く */
export const GRAPPLE_PTS: { x: number; y: number; z: number; nx: number; nz: number }[] = [
  { x: SCAFFOLD.a.x0, y: SCAFFOLD.a.top, z: 4, nx: -1, nz: 0 },
  { x: SCAFFOLD.b.x1, y: SCAFFOLD.b.top, z: 4, nx: 1, nz: 0 },
  { x: HOLE.x - HOLE.size / 2, y: UPPER.floorY, z: HOLE.z, nx: 1, nz: 0 },
];

/** 保管庫の歯車（床に 6x6 の格子 + 奥の台座に 4 つ）。順番がセーブの番号 */
export const GEAR_FLOOR_Y = UPPER.floorY + 1.25;
export const GEAR_POSITIONS: { x: number; y: number; z: number }[] = (() => {
  const out: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) out.push({ x: -107.5 - i * 3.4, y: GEAR_FLOOR_Y, z: 4 + (j - 2.5) * 3.6 });
  for (const z of [-0.6, 2.2, 5.8, 8.6]) out.push({ x: -126.8, y: GEAR_FLOOR_Y + 2.2, z });
  return out;
})();
