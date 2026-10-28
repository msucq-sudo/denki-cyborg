// ハッキングの強化（味方の時間・入力ミスの電力）が実際の流れに効くか（敵・吸収・ハックは本物を使う）
import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorld } from '../core/world';
import { EventBus } from '../core/events';
import { makeAABB } from '../core/collision';
import type { Enemy, World } from '../core/types';
import { HACK } from '../config/balance';
import { spawnEnemy, updateEnemies } from '../enemies/enemies';
import { initAbsorb, updateAbsorb } from '../abilities/absorb';
import { initHack, updateHack } from '../abilities/hack';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

class FakeInput {
  padCapture = false;
  lastDevice: 'kbm' | 'pad' = 'kbm';
  private pressedSet = new Set<string>();
  isDown(_c: string) { return false; }
  pressed(c: string) { return this.pressedSet.has(c); }
  tap(c: string) { this.pressedSet.add(c); }
  endFrame() { this.pressedSet.clear(); }
}

let world: World;
let input: FakeInput;

function mkWorld(level: number): World {
  input = new FakeInput();
  const w = createWorld(input as any, new EventBus(), 1.6);
  w.state = 'playing';
  w.upgrades['skill.hack'] = level;
  w.player.pos.set(0, 0, 0);
  w.aimOrigin.set(0, 0.8, 0);
  w.aimDir.set(0, 0, -1);
  w.camera.position.set(0, 1.5, 3);
  w.camera.lookAt(0, 0.8, -10);
  w.camera.updateMatrixWorld();
  w.colliders.push(makeAABB(V(-60, -1, -60), V(60, 0, 60), 'floor'));
  initAbsorb(w);
  initHack(w);
  return w;
}

function step(n = 1, dt = 1 / 60) {
  for (let i = 0; i < n; i++) {
    world.time += dt;
    updateAbsorb(world, dt);
    updateHack(world, dt);
    updateEnemies(world, dt);
    input.endFrame();
  }
}

function attach(e: Enemy): void {
  input.tap('KeyE');
  step();
  for (let i = 0; i < 40 && world.absorb.phase === 'extending'; i++) step();
  expect(world.absorb.target).toBe(e);
}

const nextIndex = () => HACK.keyboardKeys.indexOf(world.hack.codeKeys[world.hack.progress]);

function hackSucceeds(level: number): Enemy {
  world = mkWorld(level);
  const e = spawnEnemy(world, 'redWalker', V(0, 0.7, -6));
  attach(e);
  step();
  for (let i = 0; i < HACK.codeLength; i++) { input.tap(HACK.keyboardKeys[nextIndex()]); step(); }
  expect(e.allied).toBe(true);
  return e;
}

describe('ハッキングの強化', () => {
  beforeEach(() => { world = mkWorld(1); });

  it('Lv1 は味方の時間 HACK.allyTime、Lv4 は 36 秒', () => {
    const e1 = hackSucceeds(1);
    expect(e1.ai.allyMax).toBe(HACK.allyTime);
    expect(e1.ai.allyT).toBeCloseTo(HACK.allyTime, 1);
    const e4 = hackSucceeds(4);
    expect(e4.ai.allyMax).toBe(36);
    expect(e4.ai.allyT).toBeCloseTo(36, 0);
  });

  it('入力ミスで失う電力が強化で減る（Lv4 は 0）', () => {
    const lost = (level: number) => {
      world = mkWorld(level);
      const e = spawnEnemy(world, 'redWalker', V(0, 0.7, -6));
      attach(e);
      step();
      world.player.energy = 50;
      input.tap(HACK.keyboardKeys[(nextIndex() + 1) % 8]);
      const before = world.player.energy;
      step();
      return before - world.player.energy;
    };
    // 吸収の少量の回復が混ざるので幅を持たせる
    expect(lost(1)).toBeGreaterThan(HACK.failEnergy - 0.3);
    expect(lost(3)).toBeGreaterThan(0.7);
    expect(lost(3)).toBeLessThanOrEqual(1);
    expect(lost(4)).toBeLessThanOrEqual(0);
  });
});
