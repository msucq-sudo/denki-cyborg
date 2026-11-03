import * as THREE from 'three';
import { createWorld } from '../../core/world';
import { EventBus } from '../../core/events';
import type { World } from '../../core/types';
import { DRAIN_BOSS as D } from '../../config/balance';
import { makeAABB } from '../../core/collision';
import { spawnEnemy, updateEnemies, damageEnemy } from '../enemies';
import { updateProjectiles } from '../../core/projectiles';
import { raycastEnemies } from '../../core/enemyUtil';
import { forceAttack, getGuard } from './drainGuard';
import {
  attackWeights, createGuard, damagePart, gapRange, isArmless, pickAttack, rainSpots, teleportSpot, tryStartRegen, updateRegen,
} from './drainGuardLogic';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- 純粋なロジック
describe('drainGuardLogic: 部位HP', () => {
  test('3つの部位が別々のHPを持つ', () => {
    const g = createGuard();
    expect(g.hp).toEqual({ rArm: D.hp.rArm, body: D.hp.body, lArm: D.hp.lArm });
    damagePart(g, 'rArm', 100);
    expect(g.hp.rArm).toBe(D.hp.rArm - 100);
    expect(g.hp.body).toBe(D.hp.body);
    expect(g.hp.lArm).toBe(D.hp.lArm);
  });

  test('胴体が半分以下になった一撃で第2形態（1回だけ）', () => {
    const g = createGuard();
    const half = D.hp.body * D.phase2At;
    expect(damagePart(g, 'body', D.hp.body - half - 1).phase2).toBe(false);
    expect(g.phase).toBe(1);
    expect(damagePart(g, 'body', 2).phase2).toBe(true);
    expect(g.phase).toBe(2);
    expect(damagePart(g, 'body', 2).phase2).toBe(false);
  });

  test('胴体が0で撃破。腕が残っていても撃破', () => {
    const g = createGuard();
    const r = damagePart(g, 'body', D.hp.body + 50);
    expect(r.dead).toBe(true);
    expect(r.applied).toBe(D.hp.body);
    expect(g.dead).toBe(true);
    expect(g.hp.rArm).toBe(D.hp.rArm);
    // 撃破後は何も起きない
    expect(damagePart(g, 'lArm', 10).applied).toBe(0);
  });
});

describe('drainGuardLogic: 腕の破壊と再生', () => {
  test('腕が壊れ、残った腕が十分なHPなら半分を渡して再生が始まる', () => {
    const g = createGuard();
    const r = damagePart(g, 'rArm', D.hp.rArm + 10);
    expect(r.destroyed).toBe('rArm');
    expect(r.regenStarted).toBe(true);
    expect(g.arm.rArm).toBe('regen');
    const give = Math.floor(D.hp.lArm * D.regen.giveRatio);
    expect(g.hp.lArm).toBe(D.hp.lArm - give);
    expect(g.regen?.hpTo).toBe(give);
    // 再生中の腕には当たらない
    expect(damagePart(g, 'rArm', 50).applied).toBe(0);
  });

  test('再生時間がたつと、渡されたHPで腕が戻る', () => {
    const g = createGuard();
    damagePart(g, 'lArm', D.hp.lArm);
    const give = g.regen!.hpTo;
    expect(updateRegen(g, D.regen.time * 0.5)).toBeNull();
    expect(updateRegen(g, D.regen.time * 0.6)).toBe('lArm');
    expect(g.arm.lArm).toBe('ok');
    expect(g.hp.lArm).toBe(give);
    expect(g.regen).toBeNull();
    expect(g.regens).toBe(1);
  });

  test('残った腕のHPが閾値未満なら再生しない（両腕を壊せる）', () => {
    const g = createGuard();
    g.hp.lArm = D.regen.minHp - 1;
    const r = damagePart(g, 'rArm', D.hp.rArm);
    expect(r.destroyed).toBe('rArm');
    expect(r.regenStarted).toBe(false);
    expect(g.arm.rArm).toBe('broken');
    expect(g.hp.lArm).toBe(D.regen.minHp - 1);
    expect(isArmless(g)).toBe(false);
    const r2 = damagePart(g, 'lArm', 9999);
    expect(r2.destroyed).toBe('lArm');
    expect(g.regen).toBeNull();
    expect(isArmless(g)).toBe(true);
  });

  test('閾値ちょうどなら再生できる', () => {
    const g = createGuard();
    g.hp.lArm = D.regen.minHp;
    expect(damagePart(g, 'rArm', D.hp.rArm).regenStarted).toBe(true);
  });

  test('渡すたびにHPが半分になるので、繰り返すと必ず再生できなくなる', () => {
    const g = createGuard();
    let n = 0;
    for (let i = 0; i < 20; i++) {
      const target = i % 2 === 0 ? 'rArm' : 'lArm';
      const r = damagePart(g, target, 99999);
      if (!r.regenStarted) break;
      updateRegen(g, D.regen.time + 0.1);
      n++;
    }
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(10);
    expect(g.regen).toBeNull();
  });

  test('両腕が同時に壊れた状態では再生しない', () => {
    const g = createGuard();
    g.arm.rArm = 'broken'; g.arm.lArm = 'broken'; g.hp.rArm = 0; g.hp.lArm = 0;
    expect(tryStartRegen(g)).toBe(false);
  });
});

describe('drainGuardLogic: 攻撃の選び方', () => {
  const rand = (v: number) => () => v;

  test('第1形態の攻撃：右腕=ミサイル／左腕=電撃／近いとパンチ／遠いと突進。雨と瞬間移動は出ない', () => {
    const g = createGuard();
    const far = attackWeights(g, 14);
    expect(far.missiles).toBeGreaterThan(0);
    expect(far.bolt).toBeGreaterThan(0);
    expect(far.rush).toBeGreaterThan(0);
    expect(far.punch).toBeUndefined();
    expect(far.rain).toBeUndefined();
    expect(far.teleport).toBeUndefined();
    expect(attackWeights(g, 3).punch).toBeGreaterThan(0);
    expect(attackWeights(g, 3).rush).toBeUndefined();
  });

  test('第2形態で雨と瞬間移動が加わる', () => {
    const g = createGuard();
    g.phase = 2;
    const w = attackWeights(g, 14);
    expect(w.rain).toBeGreaterThan(0);
    expect(w.teleport).toBeGreaterThan(0);
  });

  test('片腕が壊れると、その腕の攻撃は出ない', () => {
    const g = createGuard();
    damagePart(g, 'rArm', 9999);
    g.arm.rArm = 'broken'; g.regen = null;
    const w = attackWeights(g, 14);
    expect(w.missiles).toBeUndefined();
    expect(w.bolt).toBeGreaterThan(0);
  });

  test('両腕なしは 突進・ビーム・瞬間移動→体当たり だけ', () => {
    const g = createGuard();
    g.arm.rArm = 'broken'; g.arm.lArm = 'broken'; g.phase = 2;
    const w = attackWeights(g, 14);
    expect(Object.keys(w).sort()).toEqual(['beam', 'rush', 'teleportRam']);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(pickAttack(g, { dist: 14, rand: rand(i / 40), last: null }));
    expect([...seen].sort()).toEqual(['beam', 'rush', 'teleportRam']);
    expect(gapRange(g)).toEqual(D.gap.armless);
  });

  test('同じ攻撃が続きにくい', () => {
    const g = createGuard();
    let same = 0;
    for (let i = 0; i < 200; i++) if (pickAttack(g, { dist: 14, rand: Math.random, last: 'missiles' }) === 'missiles') same++;
    let base = 0;
    for (let i = 0; i < 200; i++) if (pickAttack(g, { dist: 14, rand: Math.random, last: null }) === 'missiles') base++;
    expect(same).toBeLessThan(base);
  });
});

describe('drainGuardLogic: 場所', () => {
  const arena = { x0: -30, x1: 30, z0: -20, z1: 20 };
  test('雨の着弾点は個数ぶん・部屋の中・プレイヤーの近くにも落ちる', () => {
    const spots = rainSpots(D.rain.count, { x: 5, z: 5 }, arena, Math.random);
    expect(spots).toHaveLength(D.rain.count);
    for (const s of spots) {
      expect(s.x).toBeGreaterThanOrEqual(arena.x0); expect(s.x).toBeLessThanOrEqual(arena.x1);
      expect(s.z).toBeGreaterThanOrEqual(arena.z0); expect(s.z).toBeLessThanOrEqual(arena.z1);
    }
    expect(Math.hypot(spots[0].x - 5, spots[0].z - 5)).toBeLessThan(1e-6 + D.rain.radius * 10);
    const near = spots.filter((s) => Math.hypot(s.x - 5, s.z - 5) < D.rain.spread).length;
    expect(near).toBeGreaterThanOrEqual(Math.floor(D.rain.count * D.rain.nearPlayer) - 1);
  });

  test('瞬間移動：背後 = プレイヤーの向きの反対側', () => {
    // yaw 0 は -Z を向く → 背後は +Z
    const s = teleportSpot({ x: 0, z: 0 }, 0, true, arena, Math.random);
    expect(s.x).toBeCloseTo(0, 5);
    expect(s.z).toBeCloseTo(D.teleport.dist, 5);
    // yaw π/2 は -X を向く → 背後は +X
    const s2 = teleportSpot({ x: 0, z: 0 }, Math.PI / 2, true, arena, Math.random);
    expect(s2.x).toBeCloseTo(D.teleport.dist, 5);
    expect(s2.z).toBeCloseTo(0, 5);
  });
});

// ---------------------------------------------------------------- 実際の敵として
function mkWorld(): World {
  const w = createWorld({} as any, new EventBus(), 1);
  w.state = 'playing';
  w.player.pos.set(0, 0, 14);
  w.colliders.push(makeAABB(V(-80, -1, -80), V(80, 0, 80), 'floor'));
  w.level.rooms = [{ name: 'arena', min: V(-30, 0, -30), max: V(30, 16, 30), entered: true, cleared: false }];
  return w;
}
function spawn(w: World) {
  const e = spawnEnemy(w, 'drainGuard', V(0, 2.8, -6));
  e.ai.alert = 1e9;
  e.ai.yaw = 0;                    // +Z（プレイヤーの方）を向く。右腕は -X 側
  updateEnemies(w, 1 / 60);        // 見た目・当たり判定の球を作る
  return e;
}
function run(w: World, sec: number, dt = 1 / 30): void {
  for (let t = 0; t < sec; t += dt) { w.time += dt; w.player.invuln = 99; updateEnemies(w, dt); updateProjectiles(w, dt); }
}

describe('drainGuard: 実際の敵', () => {
  test('弾が当たった部位のHPが減る（腕に当てると胴体は減らない）', () => {
    const w = mkWorld();
    const e = spawn(w);
    const g = getGuard(e);
    const hs = e.hitSpheres!;
    const arm = hs.find((h) => h.part === 'rArm')!;
    const hit = raycastEnemies(w.enemies, arm.pos.clone().add(V(-8, 0, 0)), arm.pos.clone(), 0.1);
    expect(hit?.part).toBe('rArm');
    damageEnemy(w, e, 30, { how: 'shot', part: hit!.part, weak: hit!.weak });
    expect(g.hp.rArm).toBe(D.hp.rArm - 30);
    expect(e.hp).toBe(D.hp.body);
    // 胴体（部位指定なし）
    damageEnemy(w, e, 50, { how: 'shot' });
    expect(g.hp.body).toBe(D.hp.body - 50);
    expect(e.hp).toBe(D.hp.body - 50);
  });

  test('目玉は弱点（倍率がかかる）', () => {
    const w = mkWorld();
    const e = spawn(w);
    const eye = e.hitSpheres!.find((h) => h.weak)!;
    const hit = raycastEnemies(w.enemies, eye.pos.clone().add(V(0, 6, 0)), eye.pos.clone(), 0.05);
    expect(hit?.weak).toBe(true);
    damageEnemy(w, e, 10, { how: 'shot', part: hit!.part, weak: true });
    expect(getGuard(e).hp.body).toBe(D.hp.body - 10 * 2);
  });

  test('胴体が半分以下で第2形態に入り、咆哮する', () => {
    const w = mkWorld();
    const e = spawn(w);
    const roars: string[] = [];
    w.events.on('enemyAction', (ev) => { if (ev.action === 'gRoar') roars.push('x'); });
    damageEnemy(w, e, D.hp.body * 0.5 + 1, { how: 'shot' });
    expect(getGuard(e).phase).toBe(2);
    run(w, 0.2);
    expect(e.ai.phase).toBe(2);
    expect(roars).toHaveLength(1);
  });

  test('腕を壊すと再生が始まり、時間がたつと戻る。電流の線が出る', () => {
    const w = mkWorld();
    const e = spawn(w);
    const g = getGuard(e);
    const arm = e.hitSpheres!.find((h) => h.part === 'lArm')!;
    damageEnemy(w, e, D.hp.lArm + 1, { how: 'shot', part: 'lArm' });
    expect(g.arm.lArm).toBe('regen');
    expect(e.hitSpheres!.some((h) => h.part === 'lArm')).toBe(true);   // 次のフレームまで古い球が残る
    run(w, 0.5);
    expect(e.hitSpheres!.some((h) => h.part === 'lArm')).toBe(false);   // 再生中は当たらない
    expect((e.ai.regenBolts as THREE.Line[]).some((b) => b.visible)).toBe(true);
    run(w, D.regen.time);
    expect(g.arm.lArm).toBe('ok');
    expect(g.hp.lArm).toBeGreaterThan(0);
    expect(e.hitSpheres!.some((h) => h.part === 'lArm')).toBe(true);
    void arm;
  });

  test('閾値未満なら再生せず、両腕を壊すと腕なしの攻撃だけになる', () => {
    const w = mkWorld();
    const e = spawn(w);
    const g = getGuard(e);
    g.hp.rArm = D.regen.minHp - 10;
    damageEnemy(w, e, 9999, { how: 'shot', part: 'lArm' });   // 先に左腕: 右腕は閾値未満なので再生なし
    expect(g.arm.lArm).toBe('broken');
    damageEnemy(w, e, 9999, { how: 'shot', part: 'rArm' });
    expect(isArmless(g)).toBe(true);
    run(w, 0.2);
    expect(e.hitSpheres!.every((h) => h.part === 'body')).toBe(true);
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const A = e.ai.atk;
      e.ai.gapT = 0;
      run(w, 0.05);
      if (e.ai.atk.id) seen.add(e.ai.atk.id);
      run(w, 8);
    }
    for (const id of seen) expect(['rush', 'beam', 'teleportRam', 'teleport', 'punch']).toContain(id);
    expect(seen.has('missiles') || seen.has('bolt') || seen.has('rain')).toBe(false);
  });

  test('各攻撃が実際に出る：ミサイル・電撃・パンチ・突進・雨・ビーム・瞬間移動', () => {
    const w = mkWorld();
    const e = spawn(w);
    const events: string[] = [];
    w.events.on('enemyAction', (ev) => events.push(ev.action));
    // 右腕のミサイル：撃ち落とせる敵弾が出る
    forceAttack(w, e, 'missiles');
    run(w, D.missiles.windup + D.missiles.count * D.missiles.interval + 0.4);
    expect(w.projectiles.filter((p) => p.owner === 'enemy' && p.homing).length).toBeGreaterThanOrEqual(D.missiles.count - 1);
    run(w, 3);
    // 左腕の電撃
    w.projectiles.length = 0;
    forceAttack(w, e, 'bolt');
    run(w, D.bolt.windup + 0.2);
    expect(events).toContain('gBolt');
    run(w, 2);
    // パンチ（近い）
    w.player.pos.set(e.pos.x, 0, e.pos.z + 3.5);
    w.player.invuln = 0;
    const hp0 = w.player.hp;
    forceAttack(w, e, 'punch');
    w.player.invuln = 0;
    for (let t = 0; t < D.punch.windup + 0.5; t += 1 / 30) { w.time += 1 / 30; w.player.invuln = 0; updateEnemies(w, 1 / 30); w.player.pos.set(e.pos.x + Math.sin(e.ai.yaw) * 3.5, 0, e.pos.z + Math.cos(e.ai.yaw) * 3.5); }
    expect(events).toContain('gPunch');
    expect(w.player.hp).toBeLessThan(hp0);
    run(w, 2);
    // 突進
    w.player.pos.set(0, 0, 14);
    forceAttack(w, e, 'rush');
    run(w, D.rush.windup + 0.3);
    expect(events).toContain('gRush');
    run(w, 3);
    // 雨：床の円が並び、遅れて着弾する
    getGuard(e).phase = 2;
    e.ai.phase = 2;
    forceAttack(w, e, 'rain');
    run(w, D.rain.windup + 0.3);
    expect((e.ai.rain as unknown[]).length).toBe(D.rain.count);
    run(w, D.rain.delayMax + 0.5);
    expect((e.ai.rain as unknown[]).length).toBe(0);
    // 瞬間移動：消えて、プレイヤーの近くに現れる
    forceAttack(w, e, 'teleport');
    run(w, D.teleport.vanish + 0.2);
    expect(e.ai.hidden).toBe(true);
    expect(e.hitSpheres).toEqual([]);
    run(w, D.teleport.hidden + D.teleport.appear + 0.3);
    expect(e.ai.hidden).toBe(false);
    expect(events).toContain('gAppear');
    expect(Math.hypot(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z)).toBeLessThan(D.teleport.dist + 3);
    run(w, 6);
    // ビーム（腕なしでなくても出せる）
    forceAttack(w, e, 'beam');
    run(w, D.beam.windup + 0.3);
    expect(events).toContain('gBeamFire');
    run(w, 4);
  });

  test('ミサイルの雨：円の中にいると着弾でダメージ、外なら無傷', () => {
    const w = mkWorld();
    const e = spawn(w);
    getGuard(e).phase = 2;
    forceAttack(w, e, 'rain');
    run(w, D.rain.windup + 0.2);
    const items = e.ai.rain as { x: number; z: number }[];
    // 全部の円から離れた場所を探す
    let safe: { x: number; z: number } | null = null;
    for (let x = -26; x <= 26 && !safe; x += 1) for (let z = -26; z <= 26; z += 1) {
      if (items.every((it) => Math.hypot(it.x - x, it.z - z) > D.rain.radius + 1.5)) { safe = { x, z }; break; }
    }
    const hp0 = w.player.hp;
    if (safe) w.player.pos.set(safe.x, 0, safe.z);
    for (let t = 0; t < D.rain.delayMax + 0.6; t += 1 / 30) { w.time += 1 / 30; w.player.invuln = 0; updateEnemies(w, 1 / 30); }
    if (safe) expect(w.player.hp).toBe(hp0);
    // 円の真ん中に立つと当たる
    forceAttack(w, e, 'rain');
    run(w, D.rain.windup + 0.2);
    const it = (e.ai.rain as { x: number; z: number }[])[0];
    const hp1 = w.player.hp;
    for (let t = 0; t < D.rain.delayMax + 0.6; t += 1 / 30) { w.time += 1 / 30; w.player.invuln = 0; w.player.pos.set(it.x, 0, it.z); updateEnemies(w, 1 / 30); }
    expect(w.player.hp).toBeLessThan(hp1);
  });

  test('胴体HPが0で撃破。倒れたあとは攻撃しない', () => {
    const w = mkWorld();
    const e = spawn(w);
    damageEnemy(w, e, D.hp.body + 1, { how: 'shot' });
    expect(e.status).toBe('dead');
    expect(getGuard(e).dead).toBe(true);
    const n = w.projectiles.length;
    run(w, 1.5);
    expect(w.projectiles.length).toBe(n);
    expect(w.enemies.includes(e)).toBe(true);    // 崩れる演出のあいだは残る
    run(w, 4);
    expect(w.enemies.includes(e)).toBe(false);
  });

  test('ムービー中（inert）は当たらず動かない', () => {
    const w = mkWorld();
    const e = spawnEnemy(w, 'drainGuard', V(0, 12, -6));
    e.ai.alert = 1e9;
    e.ai.inert = true;
    run(w, 3);
    expect(e.pos.y).toBe(12);
    expect(e.hitSpheres).toEqual([]);
    expect(w.projectiles).toHaveLength(0);
  });
});
