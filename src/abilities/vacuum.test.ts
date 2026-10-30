import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createWorld } from '../core/world';
import { EventBus } from '../core/events';
import type { Enemy, World } from '../core/types';
import { VACUUM } from '../config/balance';

// 敵の吸い取りは簡易版（HPを減らし、0で倒れる。仲間・倒れた敵・守られた敵は吸えない）
vi.mock('../enemies/api', () => ({
  drainEnemy: vi.fn((_w: World, e: Enemy, amount: number) => {
    if (e.allied || e.shielded || (e.status !== 'active' && e.status !== 'stunned') || amount <= 0) return 0;
    const got = Math.min(amount, e.hp);
    e.hp -= got;
    if (e.hp <= 1e-6) { e.hp = 0; e.status = 'down'; }
    return got;
  }),
}));

import { updateSkills, useSkill, pickSkillSlot, SKILL_SLOTS, SKILL_KEY } from './skills';
import { vacuumTargets } from './vacuum';
import { cycleWeapon, giveWeapon, updateWeaponSwitch } from '../player/weaponSwitch';

class FakeInput {
  pressedK = new Set<string>();
  skillMenuHeld = false;
  skillStickX = 0;
  skillStickY = 0;
  padCapture = false;
  lastDevice: 'kbm' | 'pad' = 'pad';
  isDown() { return false; }
  pressed(c: string) { return this.pressedK.has(c); }
  endFrame() { this.pressedK.clear(); }
}

let world: World;
let input: FakeInput;

function mkEnemy(x: number, z: number, hp = 100, y = 1): Enemy {
  const root = new THREE.Group();
  const e: Enemy = {
    id: world.nextId++, kind: 'walker', root, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), radius: 0.7,
    hp, maxHp: hp, status: 'active', weakPoints: [], tethered: false, overload: 0, ai: {}, deadTimer: 0,
  };
  world.enemies.push(e);
  return e;
}

function step(dt = 1 / 60, n = 1) {
  for (let i = 0; i < n; i++) {
    world.time += dt;
    updateSkills(world, dt);
    updateWeaponSwitch(world);
    input.endFrame();
  }
}

beforeEach(() => {
  input = new FakeInput();
  world = createWorld(input as any, new EventBus(), 1.6);
  world.state = 'playing';
  world.player.pos.set(0, 0, 0);
  world.player.energy = 20;
});

describe('バキューム', () => {
  it('未入手なら発動しない', () => {
    const e = mkEnemy(3, 0);
    const denied = vi.fn(); world.events.on('skillDenied', denied);
    expect(world.unlocks.vacuum).toBe(false);
    input.pressedK.add('Skill'); step();
    expect(world.skills.vacuum.active).toBe(false);
    expect(denied).toHaveBeenCalledWith({ id: 'vacuum', reason: 'locked' });
    step(1 / 60, 120);
    expect(e.hp).toBe(100);
    expect(world.player.energy).toBe(20);
  });

  it('範囲内の敵だけ電力が減り、プレイヤーの電力が増える。仲間は対象外', () => {
    world.unlocks.vacuum = true;
    const near = mkEnemy(3, 2);
    const edge = mkEnemy(VACUUM.radius + 0.5, 0); // 半径0.7ぶん内側に入っている
    const far = mkEnemy(VACUUM.radius + 3, 0);
    const high = mkEnemy(1, 0, 100, 1 + VACUUM.height + 3);
    const ally = mkEnemy(-2, 0);
    ally.allied = true;
    expect(vacuumTargets(world)).toEqual([near, edge]);
    const start = vi.fn(); const end = vi.fn();
    world.events.on('vacuumStart', start); world.events.on('vacuumEnd', end);
    input.pressedK.add('Skill'); step();
    expect(start).toHaveBeenCalledTimes(1);
    expect(world.skills.vacuum.active).toBe(true);
    step(1 / 60, Math.ceil(VACUUM.duration * 60) + 5);
    expect(world.skills.vacuum.active).toBe(false);
    const each = VACUUM.drainPerSec * VACUUM.duration;
    expect(near.hp).toBeCloseTo(100 - each, 3);
    expect(edge.hp).toBeCloseTo(100 - each, 3);
    expect(far.hp).toBe(100);
    expect(high.hp).toBe(100);
    expect(ally.hp).toBe(100);
    const gain = Math.min(VACUUM.maxGain, each * 2 * VACUUM.conversion);
    expect(world.player.energy).toBeCloseTo(20 + gain, 3);
    expect(end).toHaveBeenCalledTimes(1);
    expect(end.mock.calls[0][0].count).toBe(2);
  });

  it('吸い尽くした敵は倒れ、ボーナス電力が入る', () => {
    world.unlocks.vacuum = true;
    const weak = mkEnemy(2, 0, 10);
    input.pressedK.add(SKILL_KEY); step(); // キーボードの Y でも発動
    step(1 / 60, Math.ceil(VACUUM.duration * 60) + 5);
    expect(weak.status).toBe('down');
    expect(world.player.energy).toBeCloseTo(20 + 10 * VACUUM.conversion + VACUUM.finishBonus, 3);
    expect(world.skills.vacuum.downed).toBe(1);
  });

  it('クールダウン中は発動しない', () => {
    world.unlocks.vacuum = true;
    const e = mkEnemy(2, 0);
    expect(useSkill(world)).toBe(true);
    step(1 / 60, Math.ceil(VACUUM.duration * 60) + 5);
    const hp = e.hp;
    expect(world.skills.cooldown.vacuum).toBeGreaterThan(0);
    const denied = vi.fn(); world.events.on('skillDenied', denied);
    input.pressedK.add('Skill'); step();
    expect(world.skills.vacuum.active).toBe(false);
    expect(denied).toHaveBeenCalledWith({ id: 'vacuum', reason: 'cooldown' });
    step(1 / 60, 30);
    expect(e.hp).toBe(hp);
    // クールダウンが明けたらまた使える
    step(1 / 60, Math.ceil(VACUUM.cooldown * 60));
    expect(world.skills.cooldown.vacuum).toBe(0);
    input.pressedK.add('Skill'); step();
    expect(world.skills.vacuum.active).toBe(true);
  });

  it('ハッキング中は発動しない', () => {
    world.unlocks.vacuum = true;
    world.hack.active = true;
    input.pressedK.add('Skill'); step();
    expect(world.skills.vacuum.active).toBe(false);
  });
});

describe('スキル選択', () => {
  it('スティックの向き → 枠（上=0 から時計回り）', () => {
    expect(pickSkillSlot(0, -1)).toBe(0); // 上
    expect(pickSkillSlot(1, 0)).toBe(1);  // 右
    expect(pickSkillSlot(0, 1)).toBe(2);  // 下
    expect(pickSkillSlot(-1, 0)).toBe(3); // 左
    expect(pickSkillSlot(0.2, -0.9)).toBe(0);
    expect(pickSkillSlot(0.2, 0.1)).toBeNull(); // 倒し方が足りない
    expect(SKILL_SLOTS[0]).toBe('vacuum');
  });

  it('十字キー下を押している間だけ枠を指し、入手済みのスキルを選ぶ。離しても選択は残る', () => {
    world.unlocks.vacuum = true;
    const sel = vi.fn(); world.events.on('skillSelect', sel);
    // 押していない間はスティックを倒しても何も指さない
    input.skillStickY = -1; step();
    expect(world.skills.hover).toBeNull();
    input.skillMenuHeld = true;
    input.skillStickX = 1; input.skillStickY = 0; step(); // 右＝空き枠
    expect(world.skills.hover).toBe(1);
    expect(world.skills.selected).toBe('vacuum');
    input.skillStickX = 0; input.skillStickY = -1; step(); // 上＝バキューム
    expect(world.skills.hover).toBe(0);
    input.skillMenuHeld = false; input.skillStickY = 0; step();
    expect(world.skills.hover).toBeNull();
    expect(world.skills.selected).toBe('vacuum');
    // 選択中のスキルを Y で発動
    input.pressedK.add('Skill'); step();
    expect(world.skills.vacuum.active).toBe(true);
  });
});

describe('武器の切り替え', () => {
  it('武器が1つなら何もしない', () => {
    const sw = vi.fn(); world.events.on('weaponSwitch', sw);
    input.pressedK.add('WeaponNext'); step();
    expect(world.loadout.current).toBe('pistol');
    expect(cycleWeapon(world, -1)).toBe(false);
    expect(sw).not.toHaveBeenCalled();
  });

  it('十字キー左右（WeaponPrev / WeaponNext）とキーボード 1 / 3 で持っている武器を回す', () => {
    giveWeapon(world, 'assault');
    giveWeapon(world, 'shotgun');
    expect(world.loadout.owned).toEqual(['pistol', 'shotgun', 'assault']);
    const sw = vi.fn(); world.events.on('weaponSwitch', sw);
    input.pressedK.add('WeaponNext'); step();
    expect(world.loadout.current).toBe('shotgun');
    input.pressedK.add('Digit3'); step();
    expect(world.loadout.current).toBe('assault');
    input.pressedK.add('WeaponNext'); step();
    expect(world.loadout.current).toBe('pistol'); // 一周
    input.pressedK.add('WeaponPrev'); step();
    expect(world.loadout.current).toBe('assault');
    input.pressedK.add('Digit1'); step();
    expect(world.loadout.current).toBe('shotgun');
    expect(sw.mock.calls.map((c) => c[0].id)).toEqual(['shotgun', 'assault', 'pistol', 'assault', 'shotgun']);
  });

  it('持っていない武器は飛ばす。ハッキング中は切り替えない', () => {
    giveWeapon(world, 'assault');
    input.pressedK.add('WeaponNext'); step();
    expect(world.loadout.current).toBe('assault');
    world.hack.active = true;
    input.pressedK.add('WeaponNext'); step();
    expect(world.loadout.current).toBe('assault');
    world.hack.active = false;
    input.padCapture = true;
    input.pressedK.add('WeaponNext'); step();
    expect(world.loadout.current).toBe('assault');
  });
});
