// 導入（スパークの地下特別研究室）の配置。部屋は x:-7..7 / z:-5..5 / 高さ3.5m（scenes/sparkLab.ts）。
// ドアは西壁、モニターウォールは東壁、開発ベッドは中央（枕は東）。
// 向きの約束：プレイヤー（ライアン）は yaw=0 で -Z を向く（前 = (-sin yaw, -cos yaw)）。スパークは rotation.y=0 で +Z を向く（前 = (sin r, cos r)）。

export const ROOM = { x0: -7, x1: 7, z0: -5, z1: 5, h: 3.5 } as const;

/** 目覚めたあとライアンが立つ位置（ベッドの足側）。西（ドア）を向く */
export const RYAN = { x: -1.55, z: 0, yaw: Math.PI / 2 } as const;
/** ライアンの目の高さ（一人称カメラ） */
export const EYE_Y = 1.62;
/** スパークが最初に立つ位置（ライアンの右＝北 -Z 側） */
export const SPARK_START = { x: RYAN.x, z: -1.5 } as const;
/** 半円を描いて語る半径 */
export const ARC_R = 1.6;

/** 天井から侵入するウォーカーの降下口と着地点 */
export const DROP = { x: -2.0, z: 3.0, y: 3.4 } as const;
/** 戦闘中、スパークが逃げて待つ部屋の隅（北西） */
export const SAFE_CORNER = { x: -5.7, z: -3.9 } as const;
/** 戦闘開始時のライアンの位置（スパークと向き合ったまま） */
export const FIGHT_START = { x: -1.55, z: 0, yaw: Math.PI / 2 } as const;

/** モニターウォール前：的ボックスが出る位置（x）と、3体の z */
export const WALL = { x: 4.9, zs: [-1.9, 0, 1.9] as readonly number[], walkOut: 1.5 } as const;
/** 3-1 の位置：スパークが近づく／ライアンが立つ */
export const MEET = { ryan: { x: -3.0, z: -2.0, yaw: Math.PI / 2 }, spark: { x: -4.4, z: -2.4 } } as const;
/** 3-2 の終点：モニターウォールの前（ライアンは東を向く。スパークは右前＝+Z 側） */
export const AT_WALL = { ryan: { x: 2.6, z: -0.2, yaw: -Math.PI / 2 }, spark: { x: 3.3, z: 1.0 } } as const;
/** 3-2 の歩く道筋（ベッドの北側を回って東へ） */
export const WALK_RYAN: readonly [number, number][] = [[MEET.ryan.x, MEET.ryan.z], [1.9, -2.0], [AT_WALL.ryan.x, AT_WALL.ryan.z]];
export const WALK_SPARK: readonly [number, number][] = [[MEET.spark.x, MEET.spark.z], [1.9, -2.3], [AT_WALL.spark.x, AT_WALL.spark.z]];

/** 西のドア（B で外へ出る）。ライアンが立つ位置はドアの前 */
export const DOOR = { x: -6.5, z: 0, reach: 1.8 } as const;
