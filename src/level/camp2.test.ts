import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/events';
import type { World } from '../core/types';
import { createWorld } from '../core/world';
import { moveCharacter } from '../core/collision';
import { CAMP2, PLAYER } from '../config/balance';
import { enemyNo } from '../config/enemyInfo';
import { damageEnemy, updateEnemies } from '../enemies/api';
import { buildCamp2, getCamp2, updateCamp2 } from './camp2';
import { openSpawnBoxes } from './spawnBoxes';
import { CUT_TOTAL } from './camp2/cutscene';
import { BOSS_LAND, CAGE_Z, FIGHT_START, SPAWNS, STAND, START } from './camp2/layout';

const DT = 1 / 30;

function mk(startAt?: string) {
  const keys = new Set<string>();
  const input = {
    locked: false, enabled: true,
    pressed: (k: string) => keys.has(k), isDown: () => false, mouse: () => false,
    rawPressed: (k: string) => keys.has(k), rawDown: (k: string) => keys.has(k), lastDevice: 'kbm',
  };
  const w = createWorld(input as never, new EventBus(), 1);
  w.state = 'playing';
  if (startAt) w.level.data.startAt = startAt;
  buildCamp2(w);
  const tick = () => { w.time += DT; updateEnemies(w, DT); updateCamp2(w, DT); };
  const run = (sec: number, stop?: () => boolean) => {
    for (let i = 0; i < Math.round(sec / DT); i++) { tick(); if (stop?.()) return; }
  };
  const press = (k: string) => { keys.add(k); tick(); keys.delete(k); };
  return { w, input, run, press, tick };
}

/** 前室の箱を全部開けて、ドローンと箱から出た敵を倒す */
function killFront(w: World): void {
  const c = getCamp2(w)!;
  openSpawnBoxes(w, c.boxes, 0);
  for (let i = 0; i < 90 && c.boxes.some((b) => b.state !== 'open'); i++) { w.time += DT; updateEnemies(w, DT); updateCamp2(w, DT); }
  for (const e of [...c.front, ...c.boxes.map((b) => b.enemy!)]) damageEnemy(w, e, 99999, { how: 'shot' });
}

describe('camp2 (サージ収容所 2階)', () => {
  it('places 8 enemies from No.1-11 (no boss) in the front hall, and many residents in the cage', () => {
    const { w } = mk();
    const c = getCamp2(w)!;
    // ドローンは最初から飛んでいる。地上の敵は箱の中（開くまで World にいない）
    expect(c.front.length + c.boxes.length).toBe(SPAWNS.length);
    expect(c.front.every((e) => e.kind === 'drone')).toBe(true);
    expect(c.boxes.length).toBe(SPAWNS.filter((s) => s.kind !== 'drone').length);
    expect(c.boxes.every((b) => b.state === 'closed' && b.enemy === null)).toBe(true);
    expect(c.boxes.find((b) => b.def.kind === 'heavy')?.style).toBe('container');
    expect(w.enemies.length).toBe(c.front.length);
    for (const e of [...c.front, ...c.boxes.map((b) => ({ kind: b.def.kind, pos: b.group.position }))]) {
      const no = enemyNo(e.kind);
      expect(no).toBeGreaterThanOrEqual(1);
      expect(no).toBeLessThanOrEqual(11);
      expect(e.kind).not.toBe('boss');
      expect(e.pos.z).toBeGreaterThan(CAGE_Z);   // 檻の外（前室）
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

  it('the door cannot be opened while front enemies remain', () => {
    const { w, press } = mk();
    w.player.pos.set(STAND.x, 0, STAND.z);
    press('KeyR');
    expect(getCamp2(w)!.state.phase).toBe('explore');
    expect(getCamp2(w)!.state.nearDoor).toBe(false);
  });

  it('enemies come out of the boxes; one box opening opens the rest; unopened boxes block the door', () => {
    const { w, press, run } = mk();
    const c = getCamp2(w)!;
    // ドローンだけ倒しても、閉じた箱が残っていれば扉は調べられない
    for (const e of c.front) damageEnemy(w, e, 99999, { how: 'shot' });
    w.player.pos.set(STAND.x, 0, STAND.z);
    run(DT);
    expect(c.state.nearDoor).toBe(false);
    // 近くの箱（ヘビーのコンテナ）が開く → 残りも順に開いて全員出てくる
    run(6);
    expect(c.boxes.every((b) => b.state === 'open' && b.enemy)).toBe(true);
    expect(w.enemies.filter((e) => e.status === 'active').length).toBe(c.boxes.length);
    for (const b of c.boxes) damageEnemy(w, b.enemy!, 99999, { how: 'shot' });
    run(0.5);
    w.player.pos.set(STAND.x, 0, STAND.z);
    run(DT);
    expect(c.state.nearDoor).toBe(true);
    press('KeyR');
    expect(c.state.phase).toBe('cutscene');
  });

  it('interacting with the door starts the cutscene; when it ends the fight starts and the boss acts', () => {
    const { w, input, press, run } = mk();
    killFront(w);
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
    killFront(w);
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

  it('defeating the boss opens the cage door and frees the residents', () => {
    const { w, run } = mk('boss');
    const c = getCamp2(w)!;
    const boss = c.boss!;
    boss.ai.summonT = 0;
    run(2);   // 雑魚を呼ばせておく（倒すと止まる）
    damageEnemy(w, boss, 99999, { how: 'shot' });
    run(CAMP2.openDelay - 0.5);
    expect(c.state.phase).toBe('fight');
    expect(w.level.data.objective).toBe('檻のロックを解除中…');
    expect(c.doorCollider.active).toBe(true);
    run(1 + CAMP2.doorOpenTime);
    expect(c.state.phase).toBe('freed');
    expect(c.state.doorOpen).toBe(1);
    expect(c.doorCollider.active).toBe(false);
    expect(w.toasts.some((t) => t.text.includes('住民を解放した'))).toBe(true);
    expect(w.level.data.objective).toBe('住民を解放した');
    expect(c.residents.stats().cheer).toBe(CAMP2.residents);
    expect(w.enemies.filter((e) => e.status === 'active').length).toBe(0);
    expect(w.level.bossDefeated).toBe(false);   // クリア画面はまだ出さない（この先の流れは未定）
    // 檻の中へ歩いて入れる
    const pos = new THREE.Vector3(STAND.x, 0, STAND.z), vel = new THREE.Vector3();
    for (let i = 0; i < 120; i++) { vel.set(0, -2, -6); moveCharacter(w.colliders, pos, vel, 1 / 60, PLAYER.radius, PLAYER.height); }
    expect(pos.z).toBeLessThan(CAGE_Z - 2);
  });

  it('retry (start=boss) skips the cutscene and starts the fight right away', () => {
    const { w, input, run } = mk('boss');
    const c = getCamp2(w)!;
    expect(c.state.phase).toBe('fight');
    expect(c.cut).toBeNull();
    expect(c.state.sawCutscene).toBe(false);
    expect(c.front.length + c.boxes.length).toBe(0);
    expect(c.boss?.kind).toBe('boss');
    expect(w.level.data.retryAt).toBe('boss');
    expect(input.locked).toBe(false);
    expect(w.player.pos.distanceTo(new THREE.Vector3(FIGHT_START.x, 0, FIGHT_START.z))).toBeLessThan(1e-6);
    run(1);
    expect(getCamp2(w)!.cut).toBeNull();
  });

  it('continues after freeing the residents without respawning the boss or front enemies', () => {
    const { w, run } = mk('freed');
    const c = getCamp2(w)!;
    expect(c.state.phase).toBe('freed');
    expect(c.boss).toBeNull();
    expect(c.front.length + c.boxes.length).toBe(0);
    expect(c.doorCollider.active).toBe(false);
    expect(w.level.data.retryAt).toBe('freed');
    run(1);
    expect(c.residents.stats().cheer).toBe(CAMP2.residents);
    expect(c.state.phase).toBe('freed');
  });
});
