// アームで掴めるアイテム（歯車など）。アームの先が当たると掴んで手元まで引き戻し、戻りきったら onGrab。
// メタル（world.drops）はここに登録せず、absorb.ts が直接当たりを見て「吸い寄せ」状態にする。
import type * as THREE from 'three';
import type { World } from './types';

export interface ArmGrabbable {
  pos: THREE.Vector3;
  radius: number;
  /** false＝取得済みなどで無効 */
  enabled: boolean;
  /** 引き戻し中に先端へ付いてくる見た目（なければ null） */
  obj: THREE.Object3D | null;
  /** 手元まで戻った（取得） */
  onGrab(): void;
}

const registry = new WeakMap<World, ArmGrabbable[]>();

export function getGrabbables(world: World): ArmGrabbable[] {
  let l = registry.get(world);
  if (!l) registry.set(world, (l = []));
  return l;
}
export function registerGrabbable(world: World, g: ArmGrabbable): ArmGrabbable {
  getGrabbables(world).push(g);
  return g;
}
export function clearGrabbables(world: World): void { registry.delete(world); }
