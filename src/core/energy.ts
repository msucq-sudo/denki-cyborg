import type { World } from './types';

/** 一括消費。足りなければ消費せず false（'noEnergy' を発行） */
export function spendEnergy(world: World, amount: number): boolean {
  const p = world.player;
  if (amount <= 0) return true;
  if (p.energy < amount) {
    world.events.emit('noEnergy', {});
    return false;
  }
  setEnergy(world, p.energy - amount);
  world.stats.energyUsed += amount;
  return true;
}

/** 継続消費（毎フレーム）。実際に消費できた割合 0..1 を返す（足りない分は0まで減らす） */
export function drainEnergy(world: World, amount: number): number {
  const p = world.player;
  if (amount <= 0) return 1;
  const used = Math.min(p.energy, amount);
  setEnergy(world, p.energy - used);
  world.stats.energyUsed += used;
  return used / amount;
}

export function addEnergy(world: World, amount: number): number {
  const p = world.player;
  const before = p.energy;
  setEnergy(world, Math.min(p.maxEnergy, p.energy + amount));
  return p.energy - before;
}

export function hasEnergy(world: World, amount = 0.0001): boolean {
  return world.player.energy >= amount;
}

function setEnergy(world: World, v: number): void {
  const p = world.player;
  const prev = p.energy;
  p.energy = Math.max(0, Math.min(p.maxEnergy, v));
  const low = p.maxEnergy * 0.25;
  if (prev > 0 && p.energy <= 0) world.events.emit('energyEmpty', {});
  else if (prev > low && p.energy <= low) world.events.emit('energyLow', {});
}
