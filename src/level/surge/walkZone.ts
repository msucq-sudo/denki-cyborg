// 「道路の上」の判定（歩いているとき用の純データ処理）。道路以外を歩き続けると、上から蛇が降ってきて潰される（surge.ts）。
// 道路 = ガレージ・階段ホールの中／ガレージから T字路への一本道（歩道を含む）／東西の長い直線（歩道を含む）／ルート2の坂と踊り場。
// 収容所の柵を壊して車を降りたあとの庭（yard）も道路とみなす。
import { COMPOUND, ENTRANCE, RAMP, ROAD, type SurgeRoute } from './layout';

/** 道路以外を歩いてよい秒数。これを超えると蛇が降ってきて潰される */
export const OFF_ROAD_LIMIT = 1;

const HALF = ROAD.width / 2 + ROAD.sidewalk;   // 歩道の外縁まで
const NS_Z_END = -11;                          // ガレージの北の端（これより南はガレージ・階段ホール）

/** (x, z) が道路の上か。route='drain' は東の端が坂の下まで、坂と踊り場も道路。yard=true なら収容所の庭も道路 */
export function onRoad(x: number, z: number, route: SurgeRoute, yard = false): boolean {
  const jz = ROAD.junctionZ;
  // ガレージ・階段ホール（南）
  if (z > NS_Z_END - 0.5 && Math.abs(x) < 32) return true;
  // ガレージから T字路への一本道
  if (z <= NS_Z_END && z >= jz - HALF && Math.abs(x) <= HALF) return true;
  // 東西の長い直線
  const eastX = route === 'drain' ? RAMP.footX : ROAD.eastFenceX + 0.5;
  if (Math.abs(z - jz) <= HALF && x >= COMPOUND.wallX && x <= eastX) return true;
  // ルート2：坂と踊り場
  if (route === 'drain' && x >= RAMP.footX - 1 && x <= RAMP.landingEndX + 1 && Math.abs(z - jz) <= RAMP.width / 2 + 1) return true;
  // 収容所の庭（柵を壊して建物の左側の入口へ向かう所）
  if (yard && x >= COMPOUND.wallX - 1 && x <= COMPOUND.fenceX + 1 && z >= jz + HALF - 1 && z <= ENTRANCE.yardZ1 + 1) return true;
  return false;
}
