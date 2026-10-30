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
