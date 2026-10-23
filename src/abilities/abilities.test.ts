import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createWorld } from '../core/world';
import { EventBus } from '../core/events';
import { makeAABB } from '../core/collision';
import type { Enemy, World } from '../core/types';
import { ABSORB, OVERLOAD, FUNCTIONS } from '../config/balance';

const api = vi.hoisted(() => ({
  drainEnemy: vi.fn(),
  overloadEnemy: vi.fn(),
}));
vi.mock('../enemies/api', () => api);

import { initAbsorb, updateAbsorb } from './absorb';
import { initFunctions, updateFunctions } from './functions';

class FakeInput {
  keys = new Set<string>(); pressedK = new Set<string>(); mouseP = new Set<number>();
  isDown(c: string) { return this.keys.has(c); }
  pressed(c: string) { return this.pressedK.has(c); }
  mousePressed(b: number) { return this.mouseP.has(b); }
  endFrame() { this.pressedK.clear(); this.mouseP.clear(); }
}

function mkEnemy(world: World, pos: THREE.Vector3, hp = 100): Enemy {
  const root = new THREE.Group();
  root.position.copy(pos);
  world.scene.add(root);
  const wpMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshStandardMaterial({ emissive: 0xffcc00, emissiveIntensity: 0.4 }));
  wpMesh.position.set(0, 0.5, 0);
  root.add(wpMesh);
  const e: Enemy = {
    id: world.nextId++, kind: 'drone', root, pos: pos.clone(), vel: new THREE.Vector3(), radius: 0.6,
    hp, maxHp: hp, status: 'active',
    weakPoints: [{ offset: new THREE.Vector3(0, 0.5, 0), radius: 0.3, mesh: wpMesh, exposed: true }],
    tethered: false, overload: 0, ai: {}, deadTimer: 0,
  };
  world.enemies.push(e);
  return e;
}

let world: World;
let input: FakeInput;
let events: EventBus;

function step(dt = 1 / 60, n = 1) {
  for (let i = 0; i < n; i++) {
    world.time += dt;
    updateFunctions(world, dt);
    updateAbsorb(world, dt);
    input.endFrame();
  }
}

beforeEach(() => {
  api.drainEnemy.mockReset();
  api.overloadEnemy.mockReset();
  input = new FakeInput();
  events = new EventBus();
  world = createWorld(input as any, events, 1.6);
  world.state = 'playing';
  world.aimOrigin.set(0, 1.5, 0);
  world.aimDir.set(0, 0, -1);
  world.camera.position.set(0, 2, 4);
  world.camera.lookAt(0, 1.5, -10);
  world.camera.updateMatrixWorld();
  initAbsorb(world);
  initFunctions(world);
});

function fire() { input.mouseP.add(2); step(); }

describe('absorb arm', () => {
  it('extends, misses, retracts, cools down, then idles', () => {
    const fired = vi.fn(); events.on('absorbFire', fired);
    fire();
    expect(fired).toHaveBeenCalledTimes(1);
    expect(world.absorb.phase).toBe('extending');
    step(1 / 60, 10);
    expect(world.absorb.phase).toBe('extending');
    expect(world.absorb.tip.z).toBeLessThan(-3);
    step(1 / 60, 12); // 14m / 45 = 0.31s
    expect(world.absorb.phase).toBe('retracting');
    step(1 / 60, 30);
    expect(world.absorb.phase).toBe('cooldown');
    step(1 / 60, Math.ceil(ABSORB.cooldown * 60) + 2);
    expect(world.absorb.phase).toBe('idle');
  });

  it('stops at a wall', () => {
    world.colliders.push(makeAABB(new THREE.Vector3(-5, 0, -6), new THREE.Vector3(5, 5, -5.5)));
    fire();
    step(1 / 60, 20);
    expect(['retracting', 'cooldown']).toContain(world.absorb.phase);
    expect(world.absorb.tip.z).toBeGreaterThan(-6);
  });

  it('attaches, drains, converts to energy, completes with bonus', () => {
    const e = mkEnemy(world, new THREE.Vector3(0, 1.5, -6), 100);
    api.drainEnemy.mockImplementation((_w: World, en: Enemy, amt: number) => {
      const got = Math.min(en.hp, amt); en.hp -= got;
      if (en.hp <= 0) en.status = 'down';
      return got;
    });
    world.player.energy = 10;
    const attach = vi.fn(), complete = vi.fn();
    events.on('absorbAttach', attach); events.on('absorbComplete', complete);
    fire();
    step(1 / 60, 20);
    expect(world.absorb.phase).toBe('attached');
    expect(attach).toHaveBeenCalledTimes(1);
    expect(e.tethered).toBe(true);
    expect(world.player.absorbing).toBe(true);
    const e0 = world.player.energy;
    step(1 / 60, 60);
    const gained = world.player.energy - e0;
    expect(gained).toBeGreaterThan(ABSORB.drainPerSec * ABSORB.conversion * 0.9);
    expect(gained).toBeLessThan(ABSORB.drainPerSec * ABSORB.conversion * 1.1 + 0.5);
    expect(world.stats.energyAbsorbed).toBeGreaterThan(0);
    // 吸い切る
    e.hp = 0.1;
    const before = world.player.energy;
    step(1 / 60, 2);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(world.player.energy - before).toBeGreaterThanOrEqual(ABSORB.finishBonus);
    expect(world.absorb.phase).toBe('retracting');
    expect(e.tethered).toBe(false);
    expect(world.player.absorbing).toBe(false);
  });

  it('breaks when too far', () => {
    const e = mkEnemy(world, new THREE.Vector3(0, 1.5, -6));
    api.drainEnemy.mockReturnValue(0);
    const brk = vi.fn(); events.on('absorbBreak', brk);
    fire(); step(1 / 60, 20);
    expect(world.absorb.phase).toBe('attached');
    e.pos.set(0, 1.5, -ABSORB.breakDistance - 2); e.root.position.copy(e.pos);
    step();
    expect(brk).toHaveBeenCalledTimes(1);
    expect(world.absorb.phase).toBe('retracting');
    expect(e.tethered).toBe(false);
  });

  it('breaks after LOS lost beyond grace', () => {
    const e = mkEnemy(world, new THREE.Vector3(0, 1.5, -6));
    api.drainEnemy.mockReturnValue(0);
    fire(); step(1 / 60, 20);
    expect(world.absorb.phase).toBe('attached');
    world.colliders.push(makeAABB(new THREE.Vector3(-3, 0, -4), new THREE.Vector3(3, 5, -3.5)));
    step(1 / 60, 10);
    expect(world.absorb.phase).toBe('attached'); // 猶予内
    step(1 / 60, 10);
    expect(world.absorb.phase).toBe('retracting');
    expect(e.tethered).toBe(false);
  });

  it('right click again releases', () => {
    const e = mkEnemy(world, new THREE.Vector3(0, 1.5, -6));
    api.drainEnemy.mockReturnValue(0);
    fire(); step(1 / 60, 20);
    fire();
    expect(world.absorb.phase).toBe('retracting');
    expect(e.tethered).toBe(false);
  });

  it('overload consumes energy, calls overloadEnemy, explosion retracts', () => {
    const e = mkEnemy(world, new THREE.Vector3(0, 1.5, -6));
    api.drainEnemy.mockReturnValue(0);
    api.overloadEnemy.mockReturnValue('none');
    const s = vi.fn(), en = vi.fn(); events.on('overloadStart', s); events.on('overloadEnd', en);
    fire(); step(1 / 60, 20);
    world.player.energy = 50;
    api.drainEnemy.mockClear();
    input.keys.add('KeyF');
    step(1 / 60, 60);
    expect(s).toHaveBeenCalledTimes(1);
    expect(world.player.overloading).toBe(true);
    expect(world.player.energy).toBeCloseTo(50 - OVERLOAD.energyPerSec, 0);
    const sent = api.overloadEnemy.mock.calls.reduce((a, c) => a + c[2], 0);
    expect(sent).toBeCloseTo(OVERLOAD.energyPerSec, 0);
    expect(api.drainEnemy).not.toHaveBeenCalled();
    api.overloadEnemy.mockReturnValue('exploded');
    step();
    expect(world.absorb.phase).toBe('retracting');
    expect(en).toHaveBeenCalledTimes(1);
    expect(world.player.overloading).toBe(false);
    expect(e.tethered).toBe(false);
  });

  it('boss short releases', () => {
    mkEnemy(world, new THREE.Vector3(0, 1.5, -6));
    api.drainEnemy.mockReturnValue(0);
    api.overloadEnemy.mockReturnValue('shorted');
    fire(); step(1 / 60, 20);
    input.keys.add('KeyF');
    step();
    expect(world.absorb.phase).toBe('retracting');
  });

  it('overload with 0 energy emits noEnergy once and does not overload', () => {
    mkEnemy(world, new THREE.Vector3(0, 1.5, -6));
    api.drainEnemy.mockReturnValue(0);
    fire(); step(1 / 60, 20);
    world.player.energy = 0;
    const ne = vi.fn(); events.on('noEnergy', ne);
    input.keys.add('KeyF');
    step(1 / 60, 30);
    expect(ne).toHaveBeenCalledTimes(1);
    expect(api.overloadEnemy).not.toHaveBeenCalled();
    expect(world.player.overloading).toBe(false);
  });

  it('overload stops when energy runs out', () => {
    mkEnemy(world, new THREE.Vector3(0, 1.5, -6));
    api.drainEnemy.mockReturnValue(0);
    api.overloadEnemy.mockReturnValue('none');
    fire(); step(1 / 60, 20);
    world.player.energy = 5;
    input.keys.add('KeyF');
    step(1 / 60, 60);
    expect(world.player.energy).toBe(0);
    expect(world.player.overloading).toBe(false);
    const sent = api.overloadEnemy.mock.calls.reduce((a, c) => a + c[2], 0);
    expect(sent).toBeCloseTo(5, 3);
  });
});

describe('functions', () => {
  it('toggles with keys and drains', () => {
    const tg = vi.fn(); events.on('functionToggle', tg);
    input.pressedK.add('Digit1'); input.pressedK.add('Digit3');
    step(1 / 60);
    expect(world.functions.scouter).toBe(true);
    expect(world.functions.flight).toBe(true);
    expect(tg).toHaveBeenCalledTimes(2);
    const e0 = world.player.energy;
    step(1 / 60, 60);
    const expected = FUNCTIONS.scouter.drainPerSec;
    expect(e0 - world.player.energy).toBeCloseTo(expected, 1);
    input.pressedK.add('Digit1'); step();
    expect(world.functions.scouter).toBe(false);
  });

  it('cannot turn on with no energy, auto-off at zero', () => {
    world.player.energy = 0;
    const ne = vi.fn(); events.on('noEnergy', ne);
    input.pressedK.add('Digit2'); step();
    expect(world.functions.autoAim).toBe(false);
    expect(ne).toHaveBeenCalledTimes(1);

    world.player.energy = 0.005;
    input.pressedK.add('Digit1'); input.pressedK.add('Digit2'); input.pressedK.add('Digit3');
    const offs: string[] = [];
    events.on('functionToggle', (p) => { if (!p.on) offs.push(p.name); });
    step(1 / 60, 3);
    expect(world.player.energy).toBe(0);
    expect(world.functions).toEqual({ scouter: false, autoAim: false, flight: false });
    expect(offs.sort()).toEqual(['autoAim', 'flight', 'scouter']);
  });

  it('autoAim locks the in-cone enemy and prefers weak point', () => {
    const e = mkEnemy(world, new THREE.Vector3(2, 1.5, -12));
    input.pressedK.add('Digit2'); step();
    expect(world.aimTarget).toBe(e);
    expect(world.aimTargetPoint!.y).toBeCloseTo(2.0, 1); // weak point offset +0.5
    const expectDir = new THREE.Vector3(2, 0.5, -12).normalize();
    expect(world.aimDir.distanceTo(expectDir)).toBeLessThan(1e-3);
    // 視線が遮られたら外れる
    world.colliders.push(makeAABB(new THREE.Vector3(-5, 0, -6), new THREE.Vector3(5, 5, -5.5)));
    world.aimDir.set(0, 0, -1);
    step();
    expect(world.aimTarget).toBeNull();
    expect(world.aimDir.z).toBe(-1);
  });

  it('autoAim ignores enemies outside the cone', () => {
    mkEnemy(world, new THREE.Vector3(20, 1.5, -5));
    input.pressedK.add('Digit2'); step();
    expect(world.aimTarget).toBeNull();
  });

  it('scouter enhances weak point and restores on off; markers follow enemies', () => {
    const e = mkEnemy(world, new THREE.Vector3(0, 1.5, -8));
    const mesh = e.weakPoints[0].mesh;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    input.pressedK.add('Digit1'); step();
    expect(mat.emissiveIntensity).toBeGreaterThan(0.4);
    expect(mesh.children.length).toBe(1);
    const markers = world.scene.getObjectByName('scouterMarkers')!;
    expect(markers.children.length).toBe(1);
    world.enemies.length = 0;
    step();
    expect(markers.children.length).toBe(0);
    world.enemies.push(e);
    step();
    expect(markers.children.length).toBe(1);
    input.pressedK.add('Digit1'); step();
    expect(mat.emissiveIntensity).toBeCloseTo(0.4, 5);
    expect(mesh.scale.x).toBeCloseTo(1, 5);
    expect(mesh.children.length).toBe(0);
    expect(markers.children.length).toBe(0);
  });
});
