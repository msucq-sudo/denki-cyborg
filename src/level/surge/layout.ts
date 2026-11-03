// サージ収容所への道（?level=surge）の配置の取り決め。ステージ・車・演出の3担当が共通で読む（純データ）。
// 座標：+X=東、-Z=北（前方）、+Y=上。単位 m。数値の微調整は担当が行ってよいが、名前は変えないこと。
//
//  [2階の西の出口] → 階段ホール（上の踊り場 y=STAIRS.topY から北へ下る）
//    → ガレージ（床 y=0）。車は北向きに停まっている。北のシャッターは電力を送ると開く（吸収アーム／弾）
//    → 北へ一本道 → T字路（東は柵で通れない／西へ左折）
//    → 西へ長い直線（街は道の外。入れない）→ 判定地点（ここで 300km/h 以上なら成功）
//    → 収容所の金属の柵 → 収容所の大きな建物の壁

export const STAIRS = {
  /** 2階から来たときのスタート地点（上の踊り場） */
  topX: 0, topY: 10, topZ: 43,
  /** 階段の下（ガレージの南の入口。ここから北が平ら） */
  bottomZ: 16,
  /** 階段ホールの内側の幅（x=±width/2） */
  width: 10,
  /** 段数（1段の高さ = topY/steps ≒ 0.29 m。プレイヤーが歩いて登れる高さ） */
  steps: 35,
  /** 階段の最上段の端（ここから北が上の踊り場）と、踊り場の奥の壁 */
  topStepZ: 40, backZ: 46.5,
  /** 階段ホールの天井の高さ（階段の面から） */
  headroom: 5,
};

export const GARAGE = {
  x0: -12, x1: 12, z0: -10, z1: 14, h: 7,
  /** 壁の厚み／南の入口（階段ホールへ）の幅と高さ */
  wallT: 1, doorW: 8, doorH: 5,
  /** 停まっている車（北向き。yaw=0 が -Z 向き） */
  carX: 0, carZ: 2,
  /** 北のシャッター（道へ出る） */
  shutterZ: -10, shutterW: 9, shutterH: 5,
  /** シャッターを開けるための電源ソケット（core/sockets.ts） */
  socketX: 6.2, socketY: 1.6, socketZ: -9.4,
};

export const ROAD = {
  width: 16,
  /** 歩道の幅（見えない壁は歩道の外縁。道の中心から width/2 + sidewalk） */
  sidewalk: 5,
  /** ガレージから北へ T字路まで */
  junctionZ: -90,
  /** T字路の東側：柵（ここから先には行けない） */
  eastFenceX: 22,
  /** ルート2（'drain'）のとき、T字路の西側をふさぐ封鎖の位置（東の柵の鏡写し。左へ曲がると跳ね返る） */
  westBlockX: -22,
  /** 西へ伸びる直線の終わり（収容所の建物の壁） */
  straightEndX: -1700,
};

/** 判定地点：ここを越えた時点の速度で成功／失敗が決まる（西向きに走るので x がこれより小さくなったら越えた） */
export const CHECKPOINT = { x: -1380, kmh: 300 };

export const COMPOUND = {
  /** 収容所の金属の柵（道をふさぐ。成功時は突き破る） */
  fenceX: -1500,
  /** 柵の南北の広がり（道の中心 z=ROAD.junctionZ からの半幅） */
  fenceHalf: 140,
  /** 建物の壁（車が激突して止まる面） */
  wallX: -1620,
  /** 建物の大きさ（西へ奥行き、南北の幅、高さ） */
  depth: 160, width: 260, height: 70,
};

/** レベルの開始地点（world.level.data.startAt）。'stairs'（既定）＝2階から降りてきた所、'drive'＝車に乗った状態（リトライ用） */
export type SurgeStart = 'stairs' | 'drive';

/**
 * 激突のあと：車を降りて歩く建物の外。入口は建物を正面（東）から見て左側（南）の非常口。
 * ここに入ると「サージ収容所 1階」（level 'camp1'）へ。yardZ1 は歩ける庭の南端
 */
export const ENTRANCE = {
  x: COMPOUND.wallX, z: ROAD.junctionZ + 60,
  /** 入口の幅（z 方向）と、入ったとみなす壁からの距離 */
  w: 5, reach: 2.6,
  yardZ1: ROAD.junctionZ + 75,
};

// =====================================================================================================================
// 【2本目の道（ルート2）：ドレイン装置へ向かう道】 world.level.data.surgeRoute === 'drain'
// 収容所 2階のボスを倒したあと（camp2Cleared）の2周目。同じガレージ・同じ北の道から出て、T字路を「右折」して東へ走る。
// 西は封鎖される（ROAD.westBlockX。左へ曲がると跳ね返る）。東へ約 1.4km の一直線 → 判定地点（CHECKPOINT_E）→ 平らな道 120m
// → 坂道（RAMP）→ 巨大な発電所の屋上に載ったドレイン装置の入口（DRAIN_DOOR）。
//
//   y (m)
//   62 |                                                                              ┌────────────┐ ドレイン装置
//   55 |                                                                    ______ ┌─┤ DEVICE      │ 脚（STANDING_LEGS）
//      |                                                         ______/ ← RAMP    │ │ [扉]        │ 吸い込み脚（SUCK_LEGS）が
//   50 |                                                _______/          ┌─ 屋上 ─┴─┴────────────┴── ドーム（DOMES）を貫く
//      |                                      _______/                    │ 発電所（PLANT）               │
//    0 |=======================================/ ← foot 1520       ───────┴────────────────────────────┘
//      x=0(T字路)         1400(判定地点E)   1520(坂の下)      1740  1760(坂の上)  1784(扉)    1960(発電所の東端)
//
//   平面（北が上。z=ROAD.junctionZ が道の中心）
//     T字路 (0,-90) ──────────→ 東へ 1400m ──→ 判定E ──→ 平ら 120m ──→ 坂の下 ──→(240m の坂)──→ 踊り場 ──→ 扉
//     西 (-22) は封鎖
// 車は判定地点 CHECKPOINT_E を越えた時点の速度で決まる：
//   ≥ kmh(300)        'success'：坂を駆け上がり、扉を突き破って／開けて入る（→ level 'drain'）
//   ≥ stallKmh(200)   'fail'   ：坂は登り切るが、扉にはね返される → 死亡画面
//   <  stallKmh       'stall'  ：坂の途中（STALL.climbX）で失速 → 滑り落ちて発電所の脇の壁（PLANT.sideWing）に激突 → 死亡画面
// 坂は演出が車を動かす（走行シミュレーションに坂の物理はない）。
// =====================================================================================================================

/** ルート：'camp'＝収容所へ（既定）、'drain'＝ドレイン装置へ（収容所 2階クリア後） */
export type SurgeRoute = 'camp' | 'drain';

/** 東の判定地点：x がこれより大きくなったら越えた */
export const CHECKPOINT_E = { x: 1400, kmh: 300, stallKmh: 200 };

/** 坂道：判定地点のあと平らな道 120m（1400→1520）、その先に一直線の坂（+X へ登る。道の中心 z のまま、幅 14m） */
export const RAMP = {
  /** 坂の下（高さ 0）と上の端 */
  footX: 1520, topX: 1760,
  /** 坂の長さ（x 方向）と上の高さ。傾き ≒ 12.9° */
  length: 240, topY: 55,
  /** 坂の幅（z 方向。中心は ROAD.junctionZ）。ガードレールは幅の外側 */
  width: 14,
  centerZ: ROAD.junctionZ,
  /** 坂の上の踊り場（高さ topY の平ら）：x が topX → landingEndX。その先に扉 */
  landingEndX: 1784,
  /** 坂の途中の高さ：x のときの y */
  yAt(x: number): number { return x <= 1520 ? 0 : x >= 1760 ? 55 : ((x - 1520) / 240) * 55; },
};

/** 発電所（巨大な建物。屋根の高さ roofY）。坂の上の端は屋根のすぐ上（roofY より 0.4m〜5m 上）で建物に差しかかる */
export const PLANT = {
  /** 建物の範囲（x0 = 坂の高さが roofY を越える所。x1 は東端）。z は道の中心 ± */
  x0: 1740, x1: 1960,
  z0: ROAD.junctionZ - 110, z1: ROAD.junctionZ + 110,
  /** 屋根の高さ（建物の高さ） */
  roofY: 50,
  /**
   * 坂の脇の別棟（低い翼）：滑り落ちた車が横へ流れてぶつかる壁。壁面は z = sideWing.z0（北側）/ z1（南側）の坂側の面
   * （坂の南側 = z が大きい側に置く。x は坂の途中〜上までの範囲）
   */
  sideWing: { x0: 1540, x1: 1736, z0: ROAD.junctionZ + 22, z1: ROAD.junctionZ + 100, height: 30 },
};

/** 坂の途中で失速する地点（x）と、滑り落ちて止まる所（x）。stall 演出の目安 */
export const STALL = { climbX: 1640, slideEndX: 1530 };

/** 屋根の上のドーム（発電所の炉）。吸い込み脚が頂点近くを貫く。屋根の高さ PLANT.roofY の上に半球 */
export const DOMES = [
  { x: 1830, z: ROAD.junctionZ - 78, r: 20 },
  { x: 1830, z: ROAD.junctionZ + 78, r: 20 },
  { x: 1910, z: ROAD.junctionZ - 78, r: 20 },
  { x: 1910, z: ROAD.junctionZ + 78, r: 20 },
].map((d) => ({ ...d, baseY: PLANT.roofY, topY: PLANT.roofY + d.r }));

/** ドレイン装置の台座（屋根の上の高さ 5m の台）。上面が坂の上と同じ高さ RAMP.topY。踊り場もこの上 */
export const DEVICE_PLATFORM = {
  x0: 1760, x1: 1920,
  z0: ROAD.junctionZ - 45, z1: ROAD.junctionZ + 45,
  y0: PLANT.roofY, y1: RAMP.topY,
};

/** ドレイン装置の本体（台座の上の大きな箱型の機械。扉は西面） */
export const DEVICE = {
  x0: RAMP.landingEndX, x1: 1900,
  z0: ROAD.junctionZ - 40, z1: ROAD.junctionZ + 40,
  baseY: RAMP.topY, topY: 100,
};

/** ドレイン装置の入口の扉（閉まっている。西向きの面。足元 y は踊り場の高さ） */
export const DRAIN_DOOR = {
  x: RAMP.landingEndX, y: RAMP.topY, z: ROAD.junctionZ,
  /** 幅（z 方向）・高さ */
  w: 10, h: 7,
  /** 扉の外向き（車が来る側）：西 */
  facing: 'west' as const,
};

/** 装置を支える太い脚（台座の上に立つ。足元 y = baseY、上端は本体の底） */
export const STANDING_LEGS = [
  { x: 1798, z: ROAD.junctionZ - 36 }, { x: 1798, z: ROAD.junctionZ + 36 },
  { x: 1886, z: ROAD.junctionZ - 36 }, { x: 1886, z: ROAD.junctionZ + 36 },
].map((l) => ({ ...l, baseY: RAMP.topY, topY: RAMP.topY + 30, radius: 4 }));

/**
 * 吸い込み脚：装置の側面の高さ from から、ドームの頂点近く to へ斜めに伸びて貫く（貫く点 pierce は頂点より少し下）。
 * ドームと同じ順（DOMES[i] ↔ SUCK_LEGS[i]）
 */
export const SUCK_LEGS = DOMES.map((d) => {
  const side = d.z < ROAD.junctionZ ? -1 : 1;
  return {
    from: { x: d.x, y: DEVICE.baseY + 24, z: ROAD.junctionZ + side * (DEVICE.z1 - DEVICE.z0) / 2 },
    pierce: { x: d.x, y: d.topY - 3, z: d.z },
    radius: 2.2,
  };
});

/** ルート2の道そのもの：T字路から東へ、坂の下まで（道・歩道・街灯を作る範囲）。z は道の中心 */
export const EAST_ROUTE = {
  z: ROAD.junctionZ,
  /** 道の東の端＝坂の下 */
  roadEndX: RAMP.footX,
  /** 西の封鎖 */
  westBlockX: ROAD.westBlockX,
};

/**
 * ルートの決め方：URL の ?route=drain|camp があればそれ、なければ収容所 2階をクリア済み（camp2Cleared）なら 'drain'、まだなら 'camp'。
 * （URL の指定はデバッグ用。セーブには影響しない）
 */
export function chooseSurgeRoute(camp2Cleared: boolean, urlRoute?: string | null): SurgeRoute {
  if (urlRoute === 'drain' || urlRoute === 'camp') return urlRoute;
  return camp2Cleared ? 'drain' : 'camp';
}
