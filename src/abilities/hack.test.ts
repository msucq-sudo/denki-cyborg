import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorld } from '../core/world';
import { EventBus } from '../core/events';
import { makeAABB } from '../core/collision';
import { isTargetable } from '../core/enemyUtil';
import type { Enemy, World } from '../core/types';
import { HACK } from '../config/balance';
import { spawnEnemy, updateEnemies } from '../enemies/enemies';
import { initAbsorb, updateAbsorb } from './absorb';
import {
  codeToKeys, codeToPad, generateCode, indexOfKey, initHack, stepCode, updateHack, HACK_SUCCESS_FLASH,
} from './hack';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** 種つきの乱数（テスト用） */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

describe('hack code helpers', () => {
  it('generates codeLength indices in range with no run of 3 identical', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const code = generateCode(lcg(seed));
      expect(code).toHaveLength(HACK.codeLength);
      for (const v of code) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(8);
      }
      for (let i = 2; i < code.length; i++) expect(code[i] === code[i - 1] && code[i] === code[i - 2]).toBe(false);
    }
  });

  it('survives degenerate rngs (always lowest / highest)', () => {
    for (const r of [() => 0, () => 0.999999]) {
      const code = generateCode(r);
      expect(code).toHaveLength(HACK.codeLength);
      for (let i = 2; i < code.length; i++) expect(code[i] === code[i - 1] && code[i] === code[i - 2]).toBe(false);
      for (const v of code) expect(v >= 0 && v < 8).toBe(true);
    }
  });

  it('maps indices to keyboard and pad keys, and back', () => {
    const code = [0, 3, 7];
    expect(codeToKeys(code)).toEqual(['KeyQ', 'KeyZ', 'Digit4']);
    expect(codeToPad(code)).toEqual(['PadUp', 'PadRight', 'PadY']);
    expect(indexOfKey('KeyG')).toBe(2);
    expect(indexOfKey('PadX')).toBe(6);
    expect(indexOfKey('KeyW')).toBe(-1);
  });

  it('steps: correct advances, wrong resets, last correct is done', () => {
    const code = [2, 5, 1];
    expect(stepCode(code, 0, 2)).toEqual({ ok: true, progress: 1, done: false });
    expect(stepCode(code, 1, 4)).toEqual({ ok: false, progress: 0, done: false });
    expect(stepCode(code, 2, 1)).toEqual({ ok: true, progress: 3, done: true });
  });
});

/** Input の代用（pressed/isDown/padCapture/lastDevice だけ） */
class FakeInput {
  padCapture = false;
  lastDevice: 'kbm' | 'pad' = 'kbm';
  private down = new Set<string>();
  private pressedSet = new Set<string>();
  isDown(c: string) { return this.down.has(c); }
  pressed(c: string) { return this.pressedSet.has(c); }
  rawPressed(c: string) { return this.pressedSet.has(c); }
  /** このフレームに押した */
  tap(c: string) { this.pressedSet.add(c); }
  endFrame() { this.pressedSet.clear(); }
}

let world: World;
let input: FakeInput;

function mkWorld(): World {
  input = new FakeInput();
  const w = createWorld(input as any, new EventBus(), 1.6);
  w.state = 'playing';
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

function events(name: any): any[] {
  const l: any[] = [];
  world.events.on(name, (p: any) => l.push(p));
  return l;
}

/** 吸収アームを撃って、敵につなぐ */
function attach(e: Enemy): void {
  input.tap('KeyE');
  step();
  for (let i = 0; i < 40 && world.absorb.phase === 'extending'; i++) step();
  expect(world.absorb.phase).toBe('attached');
  expect(world.absorb.target).toBe(e);
}

/** 今のコードの progress 番目の正解の番号 */
function nextIndex(): number {
  return HACK.keyboardKeys.indexOf(world.hack.codeKeys[world.hack.progress]);
}

function typeCorrect(n: number, dev: 'kbm' | 'pad' = 'kbm'): void {
  for (let i = 0; i < n; i++) {
    const idx = nextIndex();
    input.tap(dev === 'kbm' ? HACK.keyboardKeys[idx] : HACK.padKeys[idx]);
    step();
  }
}

beforeEach(() => { world = mkWorld(); });

describe('hacking flow', () => {
  it('starts when the arm attaches to a hackable enemy, with an 8-entry code', () => {
    const e = spawnEnemy(world, 'redWalker', V(0, 0.7, -6));
    const started = events('hackStart');
    attach(e);
    step();
    expect(world.hack.active).toBe(true);
    expect(world.hack.target).toBe(e);
    expect(world.hack.codeKeys).toHaveLength(HACK.codeLength);
    expect(world.hack.codePad).toHaveLength(HACK.codeLength);
    expect(world.hack.progress).toBe(0);
    expect(world.player.hacking).toBe(true);
    expect(input.padCapture).toBe(true);
    expect(started).toHaveLength(1);
    // 出題キーはキーボードとパッドで同じ番号
    world.hack.codeKeys.forEach((k, i) => expect(HACK.keyboardKeys.indexOf(k)).toBe(HACK.padKeys.indexOf(world.hack.codePad[i])));
  });

  it('does not start on non-hackable enemies', () => {
    const e = spawnEnemy(world, 'walker', V(0, 0.7, -6));
    attach(e);
    step(5);
    expect(world.hack.active).toBe(false);
    expect(input.padCapture).toBe(false);
  });

  it('completing the code makes the enemy an ally and releases the arm', () => {
    const e = spawnEnemy(world, 'redWalker', V(0, 0.7, -6));
    const ok = events('hackInput'), won = events('hackSuccess');
    attach(e);
    step();
    typeCorrect(HACK.codeLength);
    expect(ok).toHaveLength(HACK.codeLength);
    expect(ok.every((p) => p.ok)).toBe(true);
    expect(ok[HACK.codeLength - 1].progress).toBe(HACK.codeLength);
    expect(won).toHaveLength(1);
    expect(e.allied).toBe(true);
    expect(e.ai.allyT).toBeCloseTo(HACK.allyTime, 1);
    expect(isTargetable(e)).toBe(false);
    expect(world.hack.active).toBe(false);
    expect(world.hack.successFlash).toBeGreaterThan(0);
    expect(world.player.hacking).toBe(false);
    // アームは静かに戻る
    step(3);
    expect(['retracting', 'cooldown']).toContain(world.absorb.phase);
    expect(world.absorb.target).toBe(null);
    expect(e.tethered).toBe(false);
    // 押しっぱなしでジャンプしないよう少しだけ猶予してから解除
    expect(input.padCapture).toBe(true);
    step(Math.ceil((HACK_SUCCESS_FLASH) * 60));
    expect(input.padCapture).toBe(false);
    // 味方になった敵は吸収もできない
    expect(e.hp).toBeGreaterThan(0);
  });

  it('a wrong key resets progress and costs energy', () => {
    const e = spawnEnemy(world, 'redWalker', V(0, 0.7, -6));
    const ok = events('hackInput');
    attach(e);
    step();
    typeCorrect(3);
    expect(world.hack.progress).toBe(3);
    const before = world.player.energy;
    const wrong = (nextIndex() + 1) % 8;
    input.tap(HACK.keyboardKeys[wrong]);
    step();
    expect(world.hack.progress).toBe(0);
    expect(world.hack.failFlash).toBeGreaterThan(0);
    // ミス1回の損失（つないでいる間の少量の吸収が混ざるので少しだけ幅を持たせる）
    expect(before - world.player.energy).toBeGreaterThan(HACK.failEnergy - 0.3);
    expect(before - world.player.energy).toBeLessThanOrEqual(HACK.failEnergy);
    expect(ok[ok.length - 1]).toMatchObject({ ok: false, progress: 0 });
    expect(world.hack.active).toBe(true);
    expect(e.allied).toBeFalsy();
    // 続けて最初から入れ直せる
    typeCorrect(HACK.codeLength);
    expect(e.allied).toBe(true);
  });

  it('keys outside the code pool are ignored; either device works for the same index', () => {
    const e = spawnEnemy(world, 'redWalker', V(0, 0.7, -6));
    const ok = events('hackInput');
    attach(e);
    step();
    input.tap('KeyW'); input.tap('Space'); input.tap('KeyF');
    step();
    expect(ok).toHaveLength(0);
    // キーボード → パッド → キーボードと混ぜても進む
    typeCorrect(1, 'kbm');
    typeCorrect(1, 'pad');
    typeCorrect(1, 'kbm');
    expect(world.hack.progress).toBe(3);
  });

  it('shows the device that was touched last', () => {
    const e = spawnEnemy(world, 'redWalker', V(0, 0.7, -6));
    attach(e);
    step();
    expect(world.hack.device).toBe('kbm');
    input.lastDevice = 'pad';
    step();
    expect(world.hack.device).toBe('pad');
  });

  it('cancels when the tether is released, clearing padCapture', () => {
    const e = spawnEnemy(world, 'redWalker', V(0, 0.7, -6));
    const cancelled = events('hackCancel');
    attach(e);
    step();
    typeCorrect(2);
    expect(input.padCapture).toBe(true);
    input.tap('KeyE'); // 解除
    step();
    expect(world.hack.active).toBe(false);
    expect(cancelled).toHaveLength(1);
    expect(world.player.hacking).toBe(false);
    expect(input.padCapture).toBe(false);
    expect(e.allied).toBeFalsy();
  });

  it('cancels when the target is gone, and never leaves padCapture stuck', () => {
    const e = spawnEnemy(world, 'redWalker', V(0, 0.7, -6));
    attach(e);
    step();
    expect(input.padCapture).toBe(true);
    // 敵が消えた（吸い切られた等）
    world.enemies.splice(world.enemies.indexOf(e), 1);
    step();
    expect(world.hack.active).toBe(false);
    expect(input.padCapture).toBe(false);
    // 何も起きていないときに外から立てられていても、次のフレームで戻す
    input.padCapture = true;
    step();
    expect(input.padCapture).toBe(false);
  });

  it('initHack resets leftover state from a previous world', () => {
    input.padCapture = true;
    world.hack.active = true;
    world.hack.progress = 5;
    world.player.hacking = true;
    initHack(world);
    expect(input.padCapture).toBe(false);
    expect(world.hack.active).toBe(false);
    expect(world.hack.progress).toBe(0);
    expect(world.player.hacking).toBe(false);
  });
});
