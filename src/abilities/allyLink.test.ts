// 吸収アーム：味方への送電（回復）・味方からの吸収、固定の電力源からの吸収（abilities/absorb.ts）
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createWorld } from '../core/world';
import { EventBus } from '../core/events';
import type { Enemy, World } from '../core/types';
import { ALLY_LINK } from '../config/balance';
import { getPowerSources } from '../core/powerSources';
import { initAbsorb, updateAbsorb } from './absorb';

class FakeInput {
  keys = new Set<string>(); pressedK = new Set<string>();
  isDown(c: string) { return this.keys.has(c); }
  pressed(c: string) { return this.pressedK.has(c); }
  mousePressed() { return false; }
  endFrame() { this.pressedK.clear(); }
}

let world: World;
let input: FakeInput;

function mkAlly(pos: THREE.Vector3, hp: number, maxHp = 60): Enemy {
  const root = new THREE.Group();
  root.position.copy(pos);
  const e: Enemy = {
    id: world.nextId++, kind: 'redWalker', root, pos: pos.clone(), vel: new THREE.Vector3(), radius: 0.7,
    hp, maxHp, status: 'active', weakPoints: [], tethered: false, overload: 0, ai: {}, deadTimer: 0, allied: true,
  };
  world.enemies.push(e);
  return e;
}
function step(n = 1, dt = 1 / 60) {
  for (let i = 0; i < n; i++) { world.time += dt; updateAbsorb(world, dt); input.endFrame(); }
}
function fire() { input.pressedK.add('KeyE'); step(); }

beforeEach(() => {
  input = new FakeInput();
  world = createWorld(input as never, new EventBus(), 1.6);
  world.state = 'playing';
  world.aimOrigin.set(0, 1.5, 0);
  world.aimDir.set(0, 0, -1);
  initAbsorb(world);
});

describe('ally link (level.data.allyArm)', () => {
  it('passes through allies when the stage does not allow it', () => {
    mkAlly(new THREE.Vector3(0, 1.5, -5), 30);
    fire();
    step(20);
    expect(world.absorb.phase).not.toBe('attached');
  });

  it('feeding (F) heals the ally without shorting it and says "最大まで回復しました" when full', () => {
    world.level.data.allyArm = true;
    const e = mkAlly(new THREE.Vector3(0, 1.5, -5), 30);
    world.player.energy = 100;
    fire();
    step(15);
    expect(world.absorb.phase).toBe('attached');
    input.keys.add('KeyF');
    step(60 * 6);
    expect(e.hp).toBe(e.maxHp);
    expect(e.status).toBe('active');
    expect(e.overload).toBe(0);
    expect(world.player.energy).toBeLessThan(100);
    expect(world.toasts.filter((t) => t.text === '最大まで回復しました').length).toBe(1);
  });

  it('draining the ally lowers its hp (and gives energy) down to the floor, never below', () => {
    world.level.data.allyArm = true;
    const e = mkAlly(new THREE.Vector3(0, 1.5, -5), 60);
    world.player.energy = 10;
    fire();
    step(15);
    expect(world.absorb.phase).toBe('attached');
    step(60);
    expect(e.hp).toBeLessThan(60);
    expect(world.player.energy).toBeGreaterThan(10);
    step(60 * 20);
    expect(e.hp).toBeCloseTo(60 * ALLY_LINK.drainFloor, 3);
    expect(e.status).toBe('active');
  });
});

describe('power sources', () => {
  it('the arm drains a fixed power source until empty, then onEmpty fires once', () => {
    let empty = 0;
    getPowerSources(world).push({ pos: new THREE.Vector3(0, 1.5, -6), radius: 0.9, enabled: true, amount: 10, max: 10, onEmpty: () => { empty++; } });
    world.player.energy = 20;
    fire();
    step(15);
    expect(world.absorb.phase).toBe('attached');
    step(60 * 5);
    expect(empty).toBe(1);
    expect(world.player.energy).toBeGreaterThan(20);
    expect(world.absorb.phase).not.toBe('attached');
  });
});
