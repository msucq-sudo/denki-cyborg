import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/events';
import type { World } from '../core/types';
import { createWorld } from '../core/world';
import { moveCharacter } from '../core/collision';
import { CAMP2, PLAYER } from '../config/balance';
import { enemyNo } from '../config/enemyInfo';
import { damageEnemy, updateEnemies } from '../enemies/api';
import { isWalking } from '../audio/sfx';
import { initPlayer, updatePlayer } from '../player/player';
import { buildCamp2, getCamp2, updateCamp2 } from './camp2';
import { CUT_TOTAL } from './camp2/cutscene';
import { ENDING_SHOTS, ENDING_SHOTS_HOLE, ENDING_TOTAL, ENDING_TOTAL_HOLE } from './camp2/ending';
import { spawnProjectile } from '../core/projectiles';
import { chargeDamage } from '../player/logic';
import { gunChargeMaxDamage } from '../progression/effects';
import { BOSS_LAND, CAGE_Z, CEILING_HOLE, FIGHT_START, SPAWNS, STAND, START } from './camp2/layout';

const DT = 1 / 30;

function mk(startAt?: string, withPlayer = false) {
  const keys = new Set<string>();
  const input = {
    locked: false, enabled: true, mouseDX: 0, mouseDY: 0, mousePressed: () => false, mouseReleased: () => false,
    pressed: (k: string) => keys.has(k), isDown: () => false, mouse: () => false,
    rawPressed: (k: string) => keys.has(k), rawDown: (k: string) => keys.has(k), lastDevice: 'kbm',
  };
  const w = createWorld(input as never, new EventBus(), 1);
  w.state = 'playing';
  if (startAt) w.level.data.startAt = startAt;
  buildCamp2(w);
  const tick = () => { w.time += DT; if (withPlayer) updatePlayer(w, DT); updateEnemies(w, DT); updateCamp2(w, DT); };
  const run = (sec: number, stop?: () => boolean) => {
    for (let i = 0; i < Math.round(sec / DT); i++) { tick(); if (stop?.()) return; }
  };
  const press = (k: string) => { keys.add(k); tick(); keys.delete(k); };
  return { w, input, run, press, tick };
}

describe('camp2 (サージ収容所 2階)', () => {
  it('starts quiet: no enemies in the front hall until the door is examined; many residents in the cage', () => {
    const { w } = mk();
    const c = getCamp2(w)!;
    expect(c.front.length).toBe(0);
    expect(w.enemies.length).toBe(0);
    for (const s of SPAWNS) {
      const no = enemyNo(s.kind);
      expect(no).toBeGreaterThanOrEqual(1);
      expect(no).toBeLessThanOrEqual(11);
      expect(s.kind).not.toBe('boss');
      expect(s.z).toBeGreaterThan(CAGE_Z);   // 檻の外（前室）
    }
    expect(c.residents.count).toBe(CAMP2.residents);
    expect(c.state.phase).toBe('explore');
    expect(w.player.pos.z).toBeCloseTo(START.z);
    // 檻の扉と格子の当たり判定（カメラも止める）
    expect(w.colliders.some((b) => b.tag === 'cageBars' && !b.seeThrough)).toBe(true);
    expect(c.doorCollider.active).toBe(true);
  });

  it('residents move around (wander / grab the bars / sit)', () => {
    const { w, run } = mk();
    const c = getCamp2(w)!;
    const before = (c.residents.root.children[0] as THREE.InstancedMesh).instanceMatrix.array.slice();
    run(3);
    const after = (c.residents.root.children[0] as THREE.InstancedMesh).instanceMatrix.array;
    let moved = 0;
    for (let i = 0; i < before.length; i++) if (Math.abs(before[i] - after[i]) > 1e-4) moved++;
    expect(moved).toBeGreaterThan(50);
    const s = c.residents.stats();
    expect(s.grab + s.wander + s.sit + s.idle).toBe(CAMP2.residents);
    expect(s.grab).toBeGreaterThan(0);
  });

  it('the cage bars block walking into the cage', () => {
    const { w } = mk();
    const pos = new THREE.Vector3(6, 0, CAGE_Z + 2), vel = new THREE.Vector3();
    for (let i = 0; i < 120; i++) {
      vel.set(0, -2, -6);
      moveCharacter(w.colliders, pos, vel, 1 / 60, PLAYER.radius, PLAYER.height);
    }
    expect(pos.z).toBeGreaterThan(CAGE_Z);
  });

  it('the door can be examined right away, and the minions appear together with the boss', () => {
    const { w, press, run } = mk();
    w.player.pos.set(STAND.x, 0, STAND.z);
    run(DT);
    expect(getCamp2(w)!.state.nearDoor).toBe(true);
    press('KeyR');
    const c = getCamp2(w)!;
    expect(c.state.phase).toBe('cutscene');
    expect(w.enemies.length).toBe(0);
    c.cut!.skip();
    expect(c.state.phase).toBe('fight');
    expect(c.boss?.kind).toBe('boss');
    expect(c.front.length).toBe(SPAWNS.length);
    expect(c.front.every((e) => e.status !== 'dead' && e.ai.alert > 0 && e.pos.z > CAGE_Z)).toBe(true);
  });

  it('interacting with the door starts the cutscene; when it ends the fight starts and the boss acts', () => {
    const { w, input, press, run } = mk();
    run(0.5);
    w.player.pos.set(STAND.x + 0.6, 0, STAND.z + 1);
    run(DT);
    expect(getCamp2(w)!.state.nearDoor).toBe(true);
    expect(w.level.data.interactNear).toBe(true);
    press('PadB');
    const c = getCamp2(w)!;
    expect(c.state.phase).toBe('cutscene');
    expect(c.cut).not.toBeNull();
    expect(input.locked).toBe(true);
    expect(w.enemies.some((e) => e.kind === 'boss')).toBe(false);   // ムービー中は代役（本物のボスはまだ）
    const shots: string[] = [];
    const beats: string[] = [];
    let elapsed = 0, minBossY = 99;
    const cut = c.cut!;
    run(CUT_TOTAL + 2, () => {
      elapsed += DT;
      if (cut.shotName && shots[shots.length - 1] !== cut.shotName) shots.push(cut.shotName);
      if (beats[beats.length - 1] !== c.probe.beat) beats.push(c.probe.beat);
      minBossY = Math.min(minBossY, c.probe.bossY);
      return c.state.phase !== 'cutscene';
    });
    expect(shots).toEqual(['真横・扉をいじる', '背後・降下', '左斜め後ろ・振り向く', '首の後ろ・構える']);
    expect(beats).toEqual(['reach', 'fiddle', 'freeze', 'look', 'turn', 'aim']);
    expect(elapsed).toBeGreaterThan(CUT_TOTAL - 0.2);
    expect(elapsed).toBeLessThan(CUT_TOTAL + 0.5);
    expect(minBossY).toBeLessThan(BOSS_LAND.y + 0.2);
    // 戦闘開始：プレイヤーはジェネレーターの方を向き、入力が戻る。リトライ地点が設定される
    expect(c.state.phase).toBe('fight');
    expect(c.state.sawCutscene).toBe(true);
    expect(input.locked).toBe(false);
    expect(w.level.data.retryAt).toBe('boss');
    expect(w.level.data.poseAim).toBe(false);
    const boss = c.boss!;
    expect(boss.kind).toBe('boss');
    expect(w.enemies).toContain(boss);
    expect(boss.pos.distanceTo(new THREE.Vector3(BOSS_LAND.x, BOSS_LAND.y, BOSS_LAND.z))).toBeLessThan(0.5);
    expect(Math.abs(Math.cos(w.player.yaw) + 1)).toBeLessThan(1e-6);   // yaw=π（+Z＝ジェネレーターの方）
    expect(boss.pos.z).toBeGreaterThan(w.player.pos.z);                   // 檻と反対側（プレイヤーの背後だった側）
    // 扉から数歩前に出ている（扉の近く）。三人称カメラ（後ろ 4.2m）が格子の外に収まる
    expect(w.player.pos.z).toBeCloseTo(FIGHT_START.z, 5);
    expect(w.player.pos.z - STAND.z).toBeGreaterThan(2.5);
    expect(w.player.pos.z - STAND.z).toBeLessThan(6);
    expect(w.player.pos.z - 4.2 * Math.cos(FIGHT_START.pitch) - 0.3).toBeGreaterThan(CAGE_Z);
    expect(boss.pos.z - w.player.pos.z).toBeGreaterThan(5);
    // ボスが動く・撃つ
    const p0 = boss.pos.clone();
    run(4);
    expect(boss.pos.distanceTo(p0)).toBeGreaterThan(0.3);
    expect(w.projectiles.length).toBeGreaterThan(0);
  });

  it('skipping the cutscene goes straight to the fight', () => {
    const { w, press, run } = mk();
    w.player.pos.set(STAND.x, 0, STAND.z);
    run(DT);
    press('KeyR');
    const c = getCamp2(w)!;
    run(1);
    expect(w.scene.getObjectByName('camp2-boss-actor')).toBeDefined();
    c.cut!.skip();
    expect(c.state.phase).toBe('fight');
    expect(c.boss?.kind).toBe('boss');
    expect(w.scene.getObjectByName('camp2-boss-actor')).toBeUndefined(); // 代役は片付く
  });

  it('the boss summons minions (No.1-11) with a visible wind-up', () => {
    const { w, run } = mk('boss');
    const c = getCamp2(w)!;
    const boss = c.boss!;
    const acts: number[] = [];
    w.events.on('enemyAction', (p) => { if (p.kind === 'boss' && p.action === 'summon') acts.push(p.value ?? -1); });
    const effects0 = w.effects.length;
    boss.ai.summonT = 0;
    run(DT * 2);
    expect(boss.ai.summon).not.toBeNull();             // 呼ぶ動作中
    expect(w.effects.length).toBeGreaterThan(effects0); // 出現地点の光の柱
    expect(w.enemies.filter((e) => e.ai.summoned).length).toBe(0);
    run(2);
    const minions = w.enemies.filter((e) => e.ai.summoned);
    expect(minions.length).toBe(CAMP2.summon1.length);
    for (const m of minions) {
      expect(CAMP2.summon1).toContain(m.kind);
      expect(enemyNo(m.kind)).toBeLessThanOrEqual(11);
      expect(m.pos.z).toBeGreaterThan(CAGE_Z);
    }
    expect(acts).toEqual([0, 1]);
  });

  it('phase 2 adds a charge attack', () => {
    const { w, run } = mk('boss');
    const boss = getCamp2(w)!.boss!;
    const acts: string[] = [];
    w.events.on('enemyAction', (p) => { if (p.kind === 'boss') acts.push(p.action); });
    damageEnemy(w, boss, boss.maxHp * 0.55, { how: 'shot' });
    expect(boss.ai.phase).toBe(2);
    boss.ai.chargeT = 0;
    boss.ai.laserT = 99;
    boss.ai.summonT = 99;
    run(DT * 3);
    expect(boss.ai.charge?.state).toBe('tele');
    expect(acts).toContain('chargeStart');
    run(1.2);
    expect(boss.ai.charge === null || boss.ai.charge.state === 'dash').toBe(true);
  });

  it('defeating the boss (HP 0) starts the ending movie right away', () => {
    const { w, input, run } = mk('boss');
    const c = getCamp2(w)!;
    const boss = c.boss!;
    boss.ai.summonT = 0;
    run(2);   // 雑魚を呼ばせておく
    expect(w.enemies.length).toBeGreaterThan(1);
    damageEnemy(w, boss, 99999, { how: 'shot' });
    run(DT * 2);
    expect(c.state.phase).toBe('ending');
    expect(c.cut).not.toBeNull();
    expect(input.locked).toBe(true);
    expect(w.level.data.retryAt).toBe('ending');
    expect(w.enemies.every((e) => e.status !== 'active' || e.root.visible === false)).toBe(true);
    expect(w.level.data.nextLevel).toBeUndefined();
    run(0.5);
    expect(c.cut!.shotName).toBe(ENDING_SHOTS[0].name);
    expect(w.scene.getObjectByName('camp2-ending-boss')).toBeDefined();
    expect(w.player.invuln).toBeGreaterThan(0);
  });

  it('the ending movie plays all shots in order, opens the door, lets the residents out, makes a hole in the ceiling, then requests floor2', () => {
    const { w, input, run } = mk('ending', true);   // 体のポーズ計算（updatePlayer）も回す：顔の向きを測るため
    initPlayer(w);
    const c = getCamp2(w)!;
    run(DT * 2);
    expect(c.state.phase).toBe('ending');
    const cut = c.cut!;
    const shots: string[] = [];
    const faceMin: number[] = [];
    const walk: number[] = [];   // 足音が鳴る状態（歩いている）のフレーム数・ショットごと
    const seen = { hit: false, landed: false, hole: false, city: false, maxY: 0, door: 0, exitMax: 0, charge: 0 };
    run(ENDING_TOTAL + 3, () => {
      if (cut.shotName && shots[shots.length - 1] !== cut.shotName) shots.push(cut.shotName);
      const p = c.endingProbe;
      seen.hit ||= p.bossHit; seen.landed ||= p.bossLanded; seen.hole ||= p.holeOpen; seen.city ||= p.cityShown;
      seen.maxY = Math.max(seen.maxY, p.playerY); seen.door = Math.max(seen.door, p.doorOpen);
      seen.charge = Math.max(seen.charge, p.charge);
      if (isWalking(w.player)) walk[p.shot] = (walk[p.shot] ?? 0) + 1;
      if (p.shot >= 7 && p.shot <= 11 && cut.shotTime > 0.8) faceMin[p.shot] = Math.min(faceMin[p.shot] ?? 1, p.faceUp);
      seen.exitMax = Math.max(seen.exitMax, c.residents.exitStats().gone);
      return c.cut === null;
    });
    expect(shots).toEqual(ENDING_SHOTS.map((s) => s.name));
    // 見上げるショット（7〜11）では、顔が真上近く（y>=0.75）を向いている
    for (let sh = 7; sh <= 11; sh++) expect(faceMin[sh], `shot ${sh}`).toBeGreaterThanOrEqual(0.75);
    // 足音：扉へ歩く（4）・脇へよける／部屋の真ん中へ歩く（5, 6）では鳴る状態。立ち止まり・見上げ・飛行（0〜3, 7〜14）では鳴らない
    for (const sh of [4, 5, 6]) expect(walk[sh] ?? 0, `walk shot ${sh}`).toBeGreaterThan(20);
    for (const sh of [0, 1, 2, 3, 7, 8, 9, 10, 11, 12, 13, 14]) expect(walk[sh] ?? 0, `no steps in shot ${sh}`).toBe(0);
    // 飛び去る発進音は、溜め・発進とも 1 回ずつ
    expect(c.endingProbe.jetCharge).toBe(1);
    expect(c.endingProbe.jetLaunch).toBe(1);
    expect(seen.charge).toBe(1);
    expect(seen.hit && seen.landed).toBe(true);
    expect(seen.door).toBe(1);
    expect(seen.exitMax).toBe(CAMP2.residents);
    expect(seen.hole && seen.city).toBe(true);
    expect(seen.maxY).toBeGreaterThan(20);
    expect(w.scene.getObjectByName('camp2-ending-boss')).toBeUndefined();   // 片付く
    expect(w.scene.getObjectByName('camp2-ending-roof')).toBeUndefined();
    expect(w.level.data.nextLevel).toEqual({ level: 'floor2' });
    expect(input.locked).toBe(true);   // 切り替え（main.ts）が解除する
    expect(w.level.data.poseFly).toBe(false);
  });

  // ---- 天井のひび割れ：最大溜めの一発だけで穴があく
  const shootCeiling = (w: World, charge: number, charged = true) => {
    spawnProjectile(w, {
      pos: new THREE.Vector3(CEILING_HOLE.x, 7.5, CEILING_HOLE.z), vel: new THREE.Vector3(0, 40, 0),
      damage: charged ? chargeDamage(charge, gunChargeMaxDamage(w)) : 5, owner: 'player', charged, radius: 0.2,
    });
  };

  it('has visible cracks on the ceiling from the start', () => {
    const { w } = mk('boss');
    const root = w.scene.getObjectByName('camp2-ceil-cracks')!;
    expect(root).toBeDefined();
    expect(root.visible).toBe(true);
    expect(getCamp2(w)!.state.holeOpen).toBe(false);
  });

  it('a full-charge shot at the cracked ceiling opens the hole (during the boss fight)', () => {
    const { w, run } = mk('boss');
    const c = getCamp2(w)!;
    const bursts: string[] = [];
    w.events.on('explosion', () => bursts.push('explosion'));
    shootCeiling(w, 1);
    run(DT * 3);
    expect(c.state.holeOpen).toBe(true);
    expect(c.state.phase).toBe('fight');
    expect(bursts).toContain('explosion');
    expect(w.toasts.some((t) => t.text.includes('穴'))).toBe(true);
    expect(w.scene.getObjectByName('camp2-ending-roof')!.visible).toBe(true);
    expect(w.scene.getObjectByName('camp2-ceil-cracks')!.visible).toBe(false);
  });

  it('weaker shots only chip the ceiling and do not open it', () => {
    const { w, run } = mk('boss');
    const c = getCamp2(w)!;
    shootCeiling(w, 0.6);
    shootCeiling(w, 0, false);
    run(DT * 3);
    expect(c.state.holeOpen).toBe(false);
    expect(w.scene.getObjectByName('camp2-ceil-cracks')!.visible).toBe(true);
  });

  it('if the hole is already open, the ending skips the look-up/charge/hit shots and ends the same way', () => {
    const { w, input, run } = mk('boss');
    const c = getCamp2(w)!;
    shootCeiling(w, 1);
    run(DT * 3);
    expect(c.state.holeOpen).toBe(true);
    damageEnemy(w, c.boss!, 99999, { how: 'shot' });
    run(DT * 2);
    expect(c.state.phase).toBe('ending');
    const cut = c.cut!;
    const shots: string[] = [];
    const seen = { maxY: 0, charge: 0, shotIdx: new Set<number>() };
    run(ENDING_TOTAL_HOLE + 3, () => {
      if (cut.shotName && shots[shots.length - 1] !== cut.shotName) shots.push(cut.shotName);
      seen.maxY = Math.max(seen.maxY, c.endingProbe.playerY);
      seen.charge = Math.max(seen.charge, c.endingProbe.charge);
      return c.cut === null;
    });
    expect(ENDING_TOTAL_HOLE).toBeLessThan(ENDING_TOTAL);
    expect(shots).toEqual(ENDING_SHOTS_HOLE.map((s) => s.name));
    expect(shots).not.toContain('天井の横・命中して穴があく');
    expect(shots).not.toContain('真上から・溜める');
    expect(c.endingProbe.holeOpen && c.endingProbe.cityShown).toBe(true);
    expect(seen.maxY).toBeGreaterThan(20);
    expect(c.endingProbe.jetLaunch).toBe(1);
    expect(w.level.data.nextLevel).toEqual({ level: 'floor2' });
    expect(w.scene.getObjectByName('camp2-ending-roof')).toBeUndefined();
    expect(input.locked).toBe(true);
  });

  it('skipping the shortened ending ends in the same state as the full one', () => {
    const { w, run } = mk('boss');
    const c = getCamp2(w)!;
    shootCeiling(w, 1);
    run(DT * 3);
    damageEnemy(w, c.boss!, 99999, { how: 'shot' });
    run(2);
    c.cut!.skip();
    expect(c.cut).toBeNull();
    expect(w.level.data.nextLevel).toEqual({ level: 'floor2' });
    expect(w.scene.getObjectByName('camp2-ending-boss')).toBeUndefined();
    expect(w.scene.getObjectByName('camp2-ending-roof')).toBeUndefined();
    expect(w.scene.visible).toBe(false);
  });

  it('skipping the ending goes straight to floor2 and cleans up', () => {
    const { w, run } = mk('ending');
    run(1);
    const c = getCamp2(w)!;
    c.cut!.skip();
    expect(c.cut).toBeNull();
    expect(w.level.data.nextLevel).toEqual({ level: 'floor2' });
    expect(w.scene.getObjectByName('camp2-ending-boss')).toBeUndefined();
    expect(w.scene.getObjectByName('camp2-ending-outdoor')).toBeUndefined();
    expect(w.scene.visible).toBe(false);
  });

  it('movie-only mode (ending) shows the end screen instead of loading floor2 or looping', () => {
    const { w, run } = mk('movie');
    run(DT * 2);
    const c = getCamp2(w)!;
    expect(c.state.phase).toBe('ending');
    expect(w.level.data.retryAt).toBeUndefined();
    c.cut!.skip();
    expect(w.level.data.nextLevel).toBeUndefined();
    expect(w.level.data.movieEnded).toBe(true);
    (w.level.data.movieReplay as () => void)();   // 「もう一度見る」
    expect(w.level.data.nextLevel).toEqual({ level: 'camp2', startAt: 'movie' });
  });

  it('movie-only mode (intro) plays just the door cutscene, with no fight afterwards', () => {
    const { w, run } = mk('intro');
    run(DT * 2);
    const c = getCamp2(w)!;
    expect(c.state.phase).toBe('cutscene');
    expect(c.cut!.shotName).toBe('真横・扉をいじる');
    expect(w.enemies.length).toBe(0);
    c.cut!.skip();
    expect(w.enemies.length).toBe(0);
    expect(c.boss).toBeNull();
    expect(w.level.data.movieEnded).toBe(true);
    (w.level.data.movieReplay as () => void)();
    expect(w.level.data.nextLevel).toEqual({ level: 'camp2', startAt: 'intro' });
  });

  it('residents leave through the door gap and the south exit (exit behaviour)', () => {
    const { w, run } = mk();
    const r = getCamp2(w)!.residents;
    r.setFreed(true);
    r.setExit(true);
    expect(r.stats().exit).toBe(CAMP2.residents);
    let steps = 0, near = 0;
    r.onStep = (x, z) => { steps++; if (z > CAGE_Z && z < 22 && Math.abs(x) < 4) near++; };
    const mesh = r.root.children[0] as THREE.InstancedMesh;
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    let crossed = 0;
    for (let i = 0; i < Math.round(18 / DT); i++) {
      run(DT);
      if (i === Math.round(5 / DT)) {
        // 途中：扉のすき間（x -2..2）を通って前室に出ている人がいる
        for (let k = 0; k < r.count; k++) { mesh.getMatrixAt(k, m); v.setFromMatrixPosition(m); if (v.z > CAGE_Z && v.z < 12 && Math.abs(v.x) < 3.5 && v.y > -1) crossed++; }
      }
    }
    expect(crossed).toBeGreaterThan(5);
    // 脱出中は跳んで着地するたびに足音（住民の足音）が鳴る：64人が走り抜けるので数百歩
    expect(steps).toBeGreaterThan(300);
    expect(near).toBeGreaterThan(50);
    expect(r.exitStats()).toEqual({ running: 0, gone: CAMP2.residents });
    for (let k = 0; k < r.count; k++) { mesh.getMatrixAt(k, m); v.setFromMatrixPosition(m); expect(v.y).toBeLessThan(-10); }   // 出口を出たら見えない
  });

  it('retry (start=boss) skips the cutscene and starts the fight right away', () => {
    const { w, input, run } = mk('boss');
    const c = getCamp2(w)!;
    expect(c.state.phase).toBe('fight');
    expect(c.cut).toBeNull();
    expect(c.state.sawCutscene).toBe(false);
    expect(c.front.length).toBe(SPAWNS.length);
    expect(c.boss?.kind).toBe('boss');
    expect(w.level.data.retryAt).toBe('boss');
    expect(input.locked).toBe(false);
    expect(w.player.pos.distanceTo(new THREE.Vector3(FIGHT_START.x, 0, FIGHT_START.z))).toBeLessThan(1e-6);
    run(1);
    expect(getCamp2(w)!.cut).toBeNull();
  });

  it('starting from "住民解放後" (start=freed) opens with the ending movie, without the boss or front enemies', () => {
    const { w, run } = mk('freed');
    run(0.3);
    const c = getCamp2(w)!;
    expect(c.state.phase).toBe('ending');
    expect(c.cut).not.toBeNull();
    expect(c.boss).toBeNull();
    expect(c.front.length).toBe(0);
    expect(w.level.data.retryAt).toBe('ending');
  });
});
