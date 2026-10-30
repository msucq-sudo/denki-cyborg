import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createWorld } from '../core/world';
import { EventBus } from '../core/events';
import { makeAABB } from '../core/collision';
import type { Enemy, World } from '../core/types';
import { ABSORB, DASH, DODGE, FUNCTIONS, GUN, HACK, OVERLOAD, PLAYER } from '../config/balance';
import { damagePlayer } from '../core/combat';
import { chargeDamage } from '../player/logic';

const api = vi.hoisted(() => ({
  drainEnemy: vi.fn(),
  overloadEnemy: vi.fn(),
}));
vi.mock('../enemies/api', () => api);

import { initAbsorb, updateAbsorb } from '../abilities/absorb';
import { initPlayer, updateGun, updatePlayer } from '../player/player';
import {
  ALL_TRACKS, ARM_TRACK, BODY_TRACK, GUN_TRACKS, SKILL_TRACKS, canUpgrade, getLevel, maxLevel, nextCost, preview, statAt, upgrade,
} from './upgrades';
import * as fx from './effects';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

class FakeInput {
  keys = new Set<string>(); pressedK = new Set<string>(); mouseD = new Set<number>(); mouseP = new Set<number>(); mouseR = new Set<number>();
  mouseDX = 0; mouseDY = 0; lastDevice = 'kbm'; padCapture = false;
  isDown(c: string) { return this.keys.has(c); }
  pressed(c: string) { return this.pressedK.has(c); }
  mouse(b: number) { return this.mouseD.has(b); }
  mousePressed(b: number) { return this.mouseP.has(b); }
  mouseReleased(b: number) { return this.mouseR.has(b); }
  endFrame() { this.pressedK.clear(); this.mouseP.clear(); this.mouseR.clear(); }
}

let world: World;
let input: FakeInput;

function mkWorld(): World {
  input = new FakeInput();
  const w = createWorld(input as any, new EventBus(), 1);
  w.state = 'playing';
  w.colliders.push(makeAABB(V(-50, -1, -50), V(50, 0, 50), 'floor'));
  initPlayer(w);
  return w;
}

function mkEnemy(w: World, pos: THREE.Vector3, hp = 100): Enemy {
  const root = new THREE.Group();
  root.position.copy(pos);
  w.scene.add(root);
  const e: Enemy = {
    id: w.nextId++, kind: 'drone', root, pos: pos.clone(), vel: new THREE.Vector3(), radius: 0.6,
    hp, maxHp: hp, status: 'active', weakPoints: [], tethered: false, overload: 0, ai: {}, deadTimer: 0,
  };
  w.enemies.push(e);
  return e;
}

const setLv = (id: string, lv: number) => { world.upgrades[id] = lv; };

beforeEach(() => {
  api.drainEnemy.mockReset();
  api.overloadEnemy.mockReset();
  world = mkWorld();
});

describe('データ', () => {
  it('Lv1 の値は balance.ts の定数と同じ', () => {
    const L1 = (id: string, key: string) => statAt(world, id, key);
    expect(L1('gun.pistol', 'damage')).toBe(GUN.tapDamage);
    expect(L1('gun.pistol', 'chargeDamage')).toBe(GUN.chargeMaxDamage);
    expect(L1('gun.pistol', 'cost')).toBe(GUN.tapCost);
    expect(L1('body', 'maxHp')).toBe(PLAYER.maxHp);
    expect(L1('body', 'reduction')).toBe(0);
    expect(L1('arm', 'drainPerSec')).toBe(ABSORB.drainPerSec);
    expect(L1('arm', 'conversion') / 100).toBe(ABSORB.conversion);
    expect(L1('arm', 'overloadPerSec')).toBe(OVERLOAD.energyPerSec);
    expect(L1('skill.jetpack', 'drainPerSec')).toBe(FUNCTIONS.flight.flyingDrainPerSec);
    expect(L1('skill.speed', 'moveSpeed')).toBe(PLAYER.moveSpeed);
    expect(L1('skill.speed', 'dashSpeed')).toBeCloseTo(PLAYER.moveSpeed * DASH.speedMul, 3);
    expect(L1('skill.dodge', 'cost')).toBe(DODGE.cost);
    expect(L1('skill.dodge', 'invuln')).toBe(DODGE.invuln);
    expect(L1('skill.hack', 'allyTime')).toBe(HACK.allyTime);
    expect(L1('skill.hack', 'failEnergy')).toBe(HACK.failEnergy);
  });

  it('effects の関数もレベル1では定数どおり', () => {
    expect(fx.gunDamage(world)).toBe(GUN.tapDamage);
    expect(fx.gunChargeMaxDamage(world)).toBe(GUN.chargeMaxDamage);
    expect(fx.gunTapCost(world)).toBe(GUN.tapCost);
    expect(fx.playerMaxHp(world)).toBe(PLAYER.maxHp);
    expect(fx.damageTakenMul(world)).toBe(1);
    expect(fx.absorbDrainPerSec(world)).toBe(ABSORB.drainPerSec);
    expect(fx.absorbConversion(world)).toBe(ABSORB.conversion);
    expect(fx.overloadEnergyPerSec(world)).toBe(OVERLOAD.energyPerSec);
    expect(fx.flightDrainPerSec(world)).toBe(FUNCTIONS.flight.flyingDrainPerSec);
    expect(fx.moveSpeed(world)).toBe(PLAYER.moveSpeed);
    expect(fx.dodgeCost(world)).toBe(DODGE.cost);
    expect(fx.dodgeInvuln(world)).toBe(DODGE.invuln);
    expect(fx.hackAllyTime(world)).toBe(HACK.allyTime);
    expect(fx.hackFailEnergy(world)).toBe(HACK.failEnergy);
  });

  it('全項目：段階の長さがそろい、良くなる方向に単調', () => {
    for (const t of ALL_TRACKS) {
      expect(t.costs.length + 1).toBe(maxLevel(t));
      for (const s of t.stats) {
        expect(s.values.length).toBe(maxLevel(t));
        for (let i = 1; i < s.values.length; i++) {
          if (s.lowerIsBetter) expect(s.values[i]).toBeLessThanOrEqual(s.values[i - 1]);
          else expect(s.values[i]).toBeGreaterThanOrEqual(s.values[i - 1]);
        }
        expect(s.values[s.values.length - 1]).not.toBe(s.values[0]);
      }
    }
    expect(GUN_TRACKS.map((t) => maxLevel(t))).toEqual([5]);
    expect([BODY_TRACK, ARM_TRACK].map((t) => maxLevel(t))).toEqual([5, 5]);
    expect(SKILL_TRACKS.map((t) => maxLevel(t))).toEqual([4, 4, 4, 4]);
  });

  it('preview は今と次の値を返す', () => {
    setLv('body', 2);
    const pv = preview(world, BODY_TRACK).find((x) => x.line.key === 'maxHp')!;
    expect(pv.cur).toBe(115);
    expect(pv.next).toBe(130);
    setLv('body', 5);
    expect(preview(world, BODY_TRACK)[0].next).toBeNull();
  });
});

describe('upgrade', () => {
  it('歯車を使ってレベルが上がり、upgrade イベントが出る', () => {
    const got: any[] = [];
    world.events.on('upgrade', (e: any) => got.push(e));
    world.inventory.gears = 3;
    const cost = nextCost(world, ARM_TRACK)!;
    expect(cost).toBe(1);
    expect(canUpgrade(world, ARM_TRACK)).toBe(true);
    expect(upgrade(world, ARM_TRACK)).toBe(true);
    expect(getLevel(world, 'arm')).toBe(2);
    expect(world.inventory.gears).toBe(3 - cost);
    expect(got).toEqual([{ id: 'arm', level: 2 }]);
  });

  it('歯車が足りないと何も変わらない', () => {
    world.inventory.gears = 1;
    expect(upgrade(world, ARM_TRACK)).toBe(true); // 1個で Lv2
    expect(world.inventory.gears).toBe(0);
    expect(canUpgrade(world, ARM_TRACK)).toBe(false);
    expect(upgrade(world, ARM_TRACK)).toBe(false);
    expect(getLevel(world, 'arm')).toBe(2);
    expect(world.inventory.gears).toBe(0);
  });

  it('最大レベルでは上がらない・歯車も減らない', () => {
    world.inventory.gears = 100;
    for (const t of ALL_TRACKS) while (upgrade(world, t)) { /* 最大まで */ }
    for (const t of ALL_TRACKS) {
      expect(getLevel(world, t.id)).toBe(maxLevel(t));
      expect(nextCost(world, t)).toBeNull();
      expect(canUpgrade(world, t)).toBe(false);
    }
    const left = world.inventory.gears;
    expect(upgrade(world, BODY_TRACK)).toBe(false);
    expect(world.inventory.gears).toBe(left);
    // 全部最大にする合計 = 各項目のコスト合計
    const total = ALL_TRACKS.reduce((a, t) => a + t.costs.reduce((x, y) => x + y, 0), 0);
    expect(100 - left).toBe(total);
  });

  it('歯車は1階の7個では全部を最大にできない（選ぶ必要がある）', () => {
    const total = ALL_TRACKS.reduce((a, t) => a + t.costs.reduce((x, y) => x + y, 0), 0);
    expect(total).toBeGreaterThan(7 * 3);
    const firstCosts = ALL_TRACKS.map((t) => t.costs[0]).reduce((a, b) => a + b, 0);
    expect(firstCosts).toBeGreaterThan(7); // 全項目をLv2にするだけで7個を超える
  });
});

describe('BODY', () => {
  it('最大HPが増え、今のHPも同じだけ増える', () => {
    world.inventory.gears = 10;
    world.player.hp = 60;
    expect(upgrade(world, BODY_TRACK)).toBe(true);
    expect(world.player.maxHp).toBe(115);
    expect(world.player.hp).toBe(75);
  });

  it('World を作り直しても（階の移動・リトライ）次のフレームで最大HPが合う。HPは増えない', () => {
    setLv('body', 4);
    world.player.hp = 70;
    expect(world.player.maxHp).toBe(PLAYER.maxHp);
    updatePlayer(world, 1 / 60);
    expect(world.player.maxHp).toBe(145);
    expect(world.player.hp).toBe(70);
  });

  it('被ダメージ軽減が damagePlayer に効く', () => {
    world.player.hp = 100; world.player.maxHp = 100;
    damagePlayer(world, 10);
    expect(world.player.hp).toBe(90);
    world.player.invuln = 0;
    setLv('body', 5);
    const hit: any[] = [];
    world.events.on('playerHit', (e: any) => hit.push(e));
    damagePlayer(world, 10);
    expect(world.player.hp).toBeCloseTo(90 - 8);
    expect(hit[0].amount).toBeCloseTo(8);
  });
});

describe('GUN（ピストル）', () => {
  function shoot(): number {
    world.player.energy = 100;
    input.mouseP.add(0); input.mouseD.add(0);
    updateGun(world, 1 / 60);
    input.endFrame();
    input.mouseD.delete(0); input.mouseR.add(0);
    updateGun(world, 1 / 60);
    input.endFrame();
    const b = world.projectiles.filter((p) => p.owner === 'player');
    expect(b.length).toBe(1);
    return b[0].damage;
  }

  it('Lv1 の単発は GUN.tapDamage、電力は GUN.tapCost', () => {
    world.player.energy = 100;
    expect(shoot()).toBe(GUN.tapDamage);
    expect(world.player.energy).toBe(100 - GUN.tapCost);
  });

  it('Lv3 の単発は Lv3 のダメージと消費電力', () => {
    setLv('gun.pistol', 3);
    expect(shoot()).toBe(13);
    expect(world.player.energy).toBe(100 - 7);
  });

  it('溜め撃ちの最大ダメージが上がる', () => {
    setLv('gun.pistol', 5);
    world.player.energy = 100;
    input.mouseP.add(0); input.mouseD.add(0);
    updateGun(world, 1 / 60);
    input.endFrame();
    for (let i = 0; i < 120; i++) { updateGun(world, 1 / 60); input.endFrame(); }
    expect(world.player.charge).toBe(1);
    input.mouseD.delete(0); input.mouseR.add(0);
    updateGun(world, 1 / 60);
    input.endFrame();
    const charged = world.projectiles.filter((p) => p.owner === 'player' && p.charged);
    expect(charged.length).toBe(1);
    expect(charged[0].damage).toBe(41);
  });

  it('chargeDamage は最大値を渡せる（省略は GUN.chargeMaxDamage）', () => {
    expect(chargeDamage(1)).toBe(GUN.chargeMaxDamage);
    expect(chargeDamage(1, 82)).toBe(82);
    expect(chargeDamage(0, 82)).toBe(GUN.chargeMinDamage);
  });
});

describe('ARM', () => {
  function absorbFor(sec: number, lv: number) {
    world = mkWorld();
    initAbsorb(world);
    setLv('arm', lv);
    const e = mkEnemy(world, V(0, 1, -5));
    api.drainEnemy.mockImplementation((_w: World, en: Enemy, amount: number) => { en.hp -= amount; return amount; });
    world.player.energy = 0;
    world.absorb.phase = 'attached';
    world.absorb.target = e;
    e.tethered = true;
    world.absorb.tip.copy(e.pos);
    world.player.pos.set(0, 0, 0);
    const calls0 = api.drainEnemy.mock.calls.length;
    for (let i = 0; i < sec * 60; i++) {
      world.time += 1 / 60;
      updateAbsorb(world, 1 / 60);
      if (world.absorb.phase !== 'attached') break;
    }
    return { drained: api.drainEnemy.mock.calls.slice(calls0).reduce((a, c) => a + c[2], 0), energy: world.player.energy };
  }

  it('ARM が高いほど速く吸い、変換率も高い', () => {
    const a1 = absorbFor(0.5, 1);
    const a5 = absorbFor(0.5, 5);
    expect(a1.drained).toBeCloseTo(ABSORB.drainPerSec * 0.5, 1);
    expect(a5.drained).toBeCloseTo(34 * 0.5, 1);
    expect(a1.energy).toBeCloseTo(a1.drained * ABSORB.conversion, 1);
    expect(a5.energy).toBeCloseTo(a5.drained * 0.85, 1);
    expect(a5.energy).toBeGreaterThan(a1.energy * 1.5);
  });

  it('逆流で送る電力/秒が上がる', () => {
    const sent = (lv: number) => {
      world = mkWorld();
      initAbsorb(world);
      setLv('arm', lv);
      const e = mkEnemy(world, V(0, 1, -5));
      api.overloadEnemy.mockReturnValue('none');
      world.player.energy = 100;
      world.absorb.phase = 'attached';
      world.absorb.target = e;
      e.tethered = true;
      world.absorb.tip.copy(e.pos);
      input.keys.add('KeyF');
      world.time += 1 / 60;
      updateAbsorb(world, 1);
      input.keys.delete('KeyF');
      return 100 - world.player.energy;
    };
    expect(sent(1)).toBeCloseTo(OVERLOAD.energyPerSec);
    expect(sent(5)).toBeCloseTo(40);
  });
});

describe('SKILL', () => {
  const stepPlayer = (n = 1) => { for (let i = 0; i < n; i++) { world.time += 1 / 60; updatePlayer(world, 1 / 60); input.endFrame(); } };

  it('回避：消費電力と無敵時間が強化の値になる', () => {
    setLv('skill.dodge', 1);
    world.player.energy = 50;
    input.pressedK.add('KeyC');
    stepPlayer();
    expect(world.player.energy).toBe(50 - DODGE.cost);
    expect(world.player.invuln).toBeCloseTo(DODGE.invuln, 2);

    world = mkWorld();
    setLv('skill.dodge', 4);
    world.player.energy = 50;
    input.pressedK.add('KeyC');
    stepPlayer();
    expect(world.player.energy).toBe(50 - 2.5);
    expect(world.player.invuln).toBeGreaterThan(0.4);
    expect(world.player.invuln).toBeLessThanOrEqual(0.45);
  });

  it('素早さ：Lv4 は水平速度が速い', () => {
    const speedAfter = (lv: number) => {
      world = mkWorld();
      setLv('skill.speed', lv);
      world.player.onGround = true;
      input.keys.add('KeyW');
      stepPlayer(60);
      input.keys.delete('KeyW');
      return Math.hypot(world.player.vel.x, world.player.vel.z);
    };
    const v1 = speedAfter(1), v4 = speedAfter(4);
    expect(v1).toBeCloseTo(PLAYER.moveSpeed, 1);
    expect(v4).toBeCloseTo(7.67, 1);
  });

  it('ジェットパック：滞空の消費電力が減る', () => {
    const used = (lv: number) => {
      world = mkWorld();
      setLv('skill.jetpack', lv);
      world.player.pos.set(0, 10, 0);
      world.player.onGround = false;
      world.player.energy = 100;
      input.keys.add('Space');
      stepPlayer(60);
      input.keys.delete('Space');
      expect(world.player.flying).toBe(true);
      return 100 - world.player.energy;
    };
    const u1 = used(1), u4 = used(4);
    expect(u1).toBeGreaterThan(FUNCTIONS.flight.flyingDrainPerSec * 0.8);
    expect(u4 / u1).toBeCloseTo(0.55, 1);
  });
});
