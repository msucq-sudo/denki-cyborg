import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createWorld } from '../core/world';
import { EventBus } from '../core/events';
import { SHIELD } from '../config/balance';
import { damagePlayer } from '../core/combat';
import { giveShield, shieldRaised, updateShield, buildShieldModel, buildShieldPickup } from './shield';

function mk(aiming = true) {
  const input = { mouse: (b: number) => aiming && b === 2, isDown: () => false, pressed: () => false } as never;
  const w = createWorld(input, new EventBus(), 1);
  w.state = 'playing';
  w.player.yaw = 0;   // yaw=0 で -Z を向く
  w.player.invuln = 0;
  return w;
}
const front = new THREE.Vector3(0, 1, -5);
const back = new THREE.Vector3(0, 1, 5);

describe('shield', () => {
  it('does nothing before it is picked up', () => {
    const w = mk();
    expect(shieldRaised(w)).toBe(false);
    damagePlayer(w, 10, front);
    expect(w.player.hp).toBe(w.player.maxHp - 10);
  });

  it('blocks only attacks from the front while aiming, and loses durability', () => {
    const w = mk();
    giveShield(w);
    damagePlayer(w, 10, front);
    expect(w.player.hp).toBe(w.player.maxHp);
    expect(w.shield.hp).toBe(SHIELD.maxHp - 10);
    damagePlayer(w, 10, back);                               // 背後は防げない
    expect(w.player.hp).toBe(w.player.maxHp - 10);
    w.player.invuln = 0;
    damagePlayer(w, 10);                                     // 出どころなし（罠など）は防げない
    expect(w.player.hp).toBe(w.player.maxHp - 20);
  });

  it('does not block when not aiming', () => {
    const w = mk(false);
    giveShield(w);
    damagePlayer(w, 10, front);
    expect(w.player.hp).toBe(w.player.maxHp - 10);
    expect(w.shield.hp).toBe(SHIELD.maxHp);
  });

  it('breaks, then recovers by draining energy, and stalls with no energy', () => {
    const w = mk();
    giveShield(w);
    damagePlayer(w, SHIELD.maxHp + 5, front);
    expect(w.player.hp).toBe(w.player.maxHp);                // 壊れる一撃も止める
    expect(w.shield.broken).toBe(true);
    expect(shieldRaised(w)).toBe(false);
    damagePlayer(w, 10, front);                              // 壊れている間は防げない
    expect(w.player.hp).toBe(w.player.maxHp - 10);

    w.player.energy = w.player.maxEnergy;
    const before = w.player.energy;
    updateShield(w, 1);
    expect(w.player.energy).toBeCloseTo(before - SHIELD.recoverDrainPerSec, 5);
    expect(w.shield.hp).toBeCloseTo(SHIELD.recoverPerSec, 5);

    w.player.energy = 0;                                     // 電力切れ：回復が止まる
    const hp = w.shield.hp;
    updateShield(w, 1);
    expect(w.shield.hp).toBe(hp);

    w.player.energy = w.player.maxEnergy;
    for (let i = 0; i < 200 && w.shield.broken; i++) updateShield(w, 0.5);
    expect(w.shield.broken).toBe(false);
    expect(w.shield.hp).toBe(SHIELD.maxHp);
  });

  it('builds the in-game panel and the pickup models', () => {
    const m = buildShieldModel();
    expect(m.group.children.length).toBeGreaterThan(4);
    expect(buildShieldPickup().children.length).toBeGreaterThan(3);
  });
});
