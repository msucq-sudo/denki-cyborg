import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createWorld } from './world';
import { EventBus } from './events';
import { makeAABB } from './collision';
import type { World } from './types';
import { GRAPPLE, PLAYER } from '../config/balance';

vi.mock('../enemies/api', () => ({ drainEnemy: vi.fn(), overloadEnemy: vi.fn() }));

import { initAbsorb, updateAbsorb } from '../abilities/absorb';
import {
  registerGrapplePoint, stepGrapple, updateGrapple, isGrappling, clearGrapplePoints, findAimedGrapple,
} from './grapple';

class FakeInput {
  keys = new Set<string>(); pressedK = new Set<string>();
  isDown(c: string) { return this.keys.has(c); }
  pressed(c: string) { return this.pressedK.has(c); }
  mousePressed() { return false; }
  endFrame() { this.pressedK.clear(); }
}

let world: World;
let input: FakeInput;
let events: EventBus;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** main.ts と同じ順：プレイヤー移動（グラップル）→ 吸収アーム → グラップル更新 */
function step(n = 1, dt = 1 / 60) {
  for (let i = 0; i < n; i++) {
    world.time += dt;
    stepGrapple(world, dt);
    updateAbsorb(world, dt);
    updateGrapple(world, dt);
    input.endFrame();
  }
}
function aimAt(p: THREE.Vector3) {
  world.aimDir.copy(p).sub(world.aimOrigin).normalize();
}
const fire = () => { input.pressedK.add('KeyE'); step(); };

beforeEach(() => {
  input = new FakeInput();
  events = new EventBus();
  world = createWorld(input as any, events, 1.6);
  world.state = 'playing';
  world.player.pos.set(0, 0, 0);
  world.player.energy = 50;
  world.aimOrigin.set(0, 1.5, 0);
  world.colliders.push(makeAABB(V(-50, -1, -50), V(50, 0, 50), 'floor'));
  // 高さ5の台（南面 z=-10、上面 y=5）
  world.colliders.push(makeAABB(V(-4, 0, -20), V(4, 5, -10), 'deck'));
  initAbsorb(world);
});
afterEach(() => { GRAPPLE.anySurface = false; });

describe('grapple', () => {
  it('ledge: fire at the point, get pulled and hoisted on top', () => {
    const arrive = vi.fn(); events.on('grappleArrive', arrive);
    const attach = vi.fn(); events.on('grappleAttach', attach);
    registerGrapplePoint(world, { pos: V(0, 5, -10), normal: V(0, 0, 1), kind: 'ledge' });
    aimAt(V(0, 5, -10));
    expect(findAimedGrapple(world)).not.toBeNull();
    fire();
    step(30);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(isGrappling(world)).toBe(true);
    expect(world.player.energy).toBeCloseTo(50 - GRAPPLE.cost, 5);
    step(240);
    expect(arrive).toHaveBeenCalledTimes(1);
    expect(isGrappling(world)).toBe(false);
    const p = world.player.pos;
    expect(p.y).toBeCloseTo(5.03, 1);        // 台の上
    expect(p.z).toBeLessThan(-10.5);          // 縁より奥
    expect(p.z).toBeGreaterThan(-12);
    expect(world.absorb.phase === 'retracting' || world.absorb.phase === 'cooldown' || world.absorb.phase === 'idle').toBe(true);
  });

  it('plain wall without a grapple point: no grapple (anySurface=false)', () => {
    aimAt(V(0, 3, -10));
    fire();
    step(60);
    expect(isGrappling(world)).toBe(false);
    expect(world.player.energy).toBe(50);
    expect(world.player.pos.z).toBe(0);
  });

  it('anySurface=true lets the arm stick to a plain wall', () => {
    GRAPPLE.anySurface = true;
    aimAt(V(0, 3, -10));
    fire();
    step(30);
    expect(isGrappling(world)).toBe(true);
    step(120);
    expect(world.player.pos.z).toBeLessThan(-8);
  });

  it('E during the pull cancels it and keeps momentum', () => {
    registerGrapplePoint(world, { pos: V(0, 5, -10), normal: V(0, 0, 1), kind: 'ledge' });
    aimAt(V(0, 5, -10));
    fire();
    step(25);
    expect(isGrappling(world)).toBe(true);
    const z0 = world.player.pos.z;
    input.pressedK.add('KeyE');
    step();
    expect(isGrappling(world)).toBe(false);
    expect(world.player.vel.length()).toBeGreaterThan(3);
    expect(world.player.vel.y).toBeGreaterThan(0);
    expect(world.player.pos.z).toBeLessThanOrEqual(z0 + 0.01);
    expect(world.absorb.phase).not.toBe('attached');
  });

  it('needs energy: no grapple and noEnergy when too low', () => {
    world.player.energy = GRAPPLE.cost - 0.5;
    const noE = vi.fn(); events.on('noEnergy', noE);
    registerGrapplePoint(world, { pos: V(0, 5, -10), normal: V(0, 0, 1), kind: 'ledge' });
    aimAt(V(0, 5, -10));
    fire();
    step(40);
    expect(isGrappling(world)).toBe(false);
    expect(world.player.energy).toBeCloseTo(GRAPPLE.cost - 0.5, 5);
    expect(noE).toHaveBeenCalled();
  });

  it('cooldown: cannot re-grapple immediately after finishing', () => {
    registerGrapplePoint(world, { pos: V(0, 5, -10), normal: V(0, 0, 1), kind: 'ledge' });
    aimAt(V(0, 5, -10));
    fire();
    step(40);
    input.pressedK.add('KeyE');
    step();                                  // 中断
    expect(isGrappling(world)).toBe(false);
    const e = world.player.energy;
    step(5);
    fire();                                  // まだ待ち時間 or アーム戻り中
    step(30);
    expect(world.player.energy).toBe(e);
  });

  it('ceiling: hangs, then releases with Space', () => {
    world.colliders.push(makeAABB(V(-50, 16, -50), V(50, 17, 50), 'ceiling'));
    registerGrapplePoint(world, { pos: V(0, 16, -3), normal: V(0, -1, 0), kind: 'ceiling' });
    world.aimOrigin.set(0, 1.5, 0);
    aimAt(V(0, 16, -3));
    fire();
    step(200);
    expect(isGrappling(world)).toBe(true);        // ぶら下がり中
    expect(world.player.pos.y).toBeCloseTo(16 - PLAYER.height - 0.05, 1);
    input.pressedK.add('Space');
    step();
    expect(isGrappling(world)).toBe(false);
  });

  it('ceiling with landAt: swings onto the adjacent platform', () => {
    world.colliders.push(makeAABB(V(-50, 16, -50), V(50, 17, 50), 'ceiling'));
    registerGrapplePoint(world, { pos: V(0, 16, -3), normal: V(0, -1, 0), kind: 'ceiling', landAt: V(0, 5, -14) });
    aimAt(V(0, 16, -3));
    fire();
    step(300);
    expect(isGrappling(world)).toBe(false);
    expect(world.player.pos.distanceTo(V(0, 5, -14))).toBeLessThan(0.1);
  });

  it('does not stick through walls and clear removes points', () => {
    world.colliders.push(makeAABB(V(-2, 0, -6), V(2, 8, -5.5)));
    registerGrapplePoint(world, { pos: V(0, 6, -10), normal: V(0, 0, 1), kind: 'ledge' });
    aimAt(V(0, 6, -10));
    expect(findAimedGrapple(world)).toBeNull();
    clearGrapplePoints(world);
    expect(findAimedGrapple(world)).toBeNull();
  });
});
