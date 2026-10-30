// 武器の切り替え。パッドの十字キー左右（仮想キー WeaponPrev / WeaponNext）とキーボードの 1 / 3 で、
// 持っている武器の中を前／次へ回す。見た目の差し替えは 'weaponSwitch' イベントを main.ts が受けて行う。
import type { World } from '../core/types';

/** 切り替えの順番（HUD の武器選択の並びも同じ） */
export const WEAPON_ORDER = ['pistol', 'shotgun', 'assault'] as const;
export const WEAPON_NAMES: Record<string, string> = { pistol: '電気銃', shotgun: 'ショットガン', assault: 'アサルト' };

const PREV_KEYS = ['WeaponPrev', 'Digit1'];
const NEXT_KEYS = ['WeaponNext', 'Digit3'];

/** 持っている武器を WEAPON_ORDER の並びにして返す */
export function ownedInOrder(world: World): string[] {
  const owned = new Set(world.loadout.owned);
  return WEAPON_ORDER.filter((id) => owned.has(id));
}

/** 武器を手に入れる（並びは WEAPON_ORDER に合わせる） */
export function giveWeapon(world: World, id: string): void {
  if (world.loadout.owned.includes(id)) return;
  world.loadout.owned = [...world.loadout.owned, id];
  world.loadout.owned = ownedInOrder(world);
}

/** 前（dir=-1）／次（dir=+1）の持っている武器へ。切り替えたら true（1つしか持っていなければ何もしない） */
export function cycleWeapon(world: World, dir: 1 | -1): boolean {
  const list = ownedInOrder(world);
  if (list.length < 2) return false;
  const i = list.indexOf(world.loadout.current);
  const next = list[((i < 0 ? 0 : i + dir) + list.length) % list.length];
  if (next === world.loadout.current) return false;
  world.loadout.current = next;
  world.events.emit('weaponSwitch', { id: next });
  return true;
}

/** 毎フレーム。ハッキング中（コード入力中）は切り替えない */
export function updateWeaponSwitch(world: World): void {
  const inp = world.input;
  if (world.hack.active || inp.padCapture) return;
  if (PREV_KEYS.some((k) => inp.pressed(k))) cycleWeapon(world, -1);
  else if (NEXT_KEYS.some((k) => inp.pressed(k))) cycleWeapon(world, 1);
}
