import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/events';
import type { World } from '../core/types';
import { createWorld } from '../core/world';
import { moveCharacter } from '../core/collision';
import { getSockets } from '../core/sockets';
import { getPowerSources, drainSource } from '../core/powerSources';
import { getGrabbables } from '../core/armGrab';
import { CAMP1, ENEMY_NOTICE, PLAYER } from '../config/balance';
import { ENEMY_ORDER, enemyNo } from '../config/enemyInfo';
import { buildCamp1, getCamp1, getCamp1Memo, hitBrittleWall, pickKey, prepareCamp1RoomResume, setCamp1Memo, updateCamp1 } from './camp1';
import { generateCamp1 } from './camp1/plan';

const DT = 1 / 30;
void ENEMY_NOTICE;

function mk(startAt?: string) {
  const keys = new Set<string>();
  const input = { locked: false, pressed: (k: string) => keys.has(k), isDown: (k: string) => keys.has(k), rawPressed: (k: string) => keys.has(k), rawDown: (k: string) => keys.has(k), lastDevice: 'kbm' };
  const w = createWorld(input as never, new EventBus(), 1);
  w.state = 'playing';
  if (startAt) w.level.data.startAt = startAt;
  buildCamp1(w);
  const run = (sec: number) => { for (let i = 0; i < Math.round(sec / DT); i++) { w.time += DT; updateCamp1(w, DT); } };
  return { w, run };
}

/** 衝突つきで歩く（重力あり）。目的地の水平距離 0.5 以内か時間切れまで */
function walk(w: World, from: [number, number, number], to: [number, number], sec = 30): THREE.Vector3 {
  const pos = new THREE.Vector3(...from), vel = new THREE.Vector3();
  for (let i = 0; i < sec * 60 && Math.hypot(pos.x - to[0], pos.z - to[1]) > 0.5; i++) {
    const d = Math.hypot(to[0] - pos.x, to[1] - pos.z);
    vel.x = ((to[0] - pos.x) / d) * PLAYER.moveSpeed;
    vel.z = ((to[1] - pos.z) / d) * PLAYER.moveSpeed;
    vel.y = Math.max(-45, vel.y - PLAYER.gravity / 60);
    moveCharacter(w.colliders, pos, vel, 1 / 60, PLAYER.radius, PLAYER.height);
  }
  return pos;
}
/** 経由点を順に歩く */
function route(w: World, pts: [number, number][], y = 0): THREE.Vector3 {
  let p = new THREE.Vector3(pts[0][0], y, pts[0][1]);
  for (const q of pts.slice(1)) p = walk(w, [p.x, p.y, p.z], q);
  return p;
}
const near = (p: THREE.Vector3, x: number, z: number, r = 1) => Math.hypot(p.x - x, p.z - z) < r;

describe('camp1 (サージ収容所 1階)', () => {
  const plan = generateCamp1();

  it('uses only enemy No.1-11 (no boss) and has beamers x2 in the mid-boss fight', () => {
    const kinds = new Set(plan.zones.flatMap((z) => [...z.spawns, ...(z.wave2 ?? [])].map((s) => s.kind)));
    kinds.add('redWalker');
    for (const k of kinds) {
      expect(enemyNo(k), k).toBeGreaterThanOrEqual(1);
      expect(enemyNo(k), k).toBeLessThanOrEqual(11);
      expect(k).not.toBe('boss');
    }
    expect(ENEMY_ORDER.indexOf('redWalker') + 1).toBe(11);
    const boss = plan.zones.find((z) => z.id === 'boss')!;
    expect(boss.spawns.filter((s) => s.kind === 'beamer').length).toBe(2);
    expect(boss.spawns.length + (boss.wave2?.length ?? 0)).toBeGreaterThanOrEqual(8);
  });

  it('has rooms A-J, six gears, two keys (B, F) and checkpoints at the entrance and before the boss', () => {
    const ids = plan.rooms.map((r) => r.id);
    for (const id of 'ABCDEFGHIJ') expect(ids, id).toContain(id);
    expect(plan.gears.length).toBe(6);
    for (const area of ['地下通路', 'I 隠し部屋', 'J 隠し部屋', 'G→D 隠し通路']) expect(plan.gears.some((g) => g.area === area), area).toBe(true);
    expect(plan.gears.filter((g) => g.y > 5).length).toBeGreaterThanOrEqual(2); // 高い所の歯車
    expect(plan.keys.map((k) => k.id).sort()).toEqual(['B', 'F']);
    for (const k of plan.keys) expect(k.y).toBeGreaterThan(4); // 高い所（ジャンプでは届かない）
    expect(plan.checkpoints.entrance).toBeTruthy();
    expect(plan.checkpoints.boss).toBeTruthy();
  });

  it('starts inside A by the entrance on the left of the front facade; A connects to B, E (via the vacuum corridor)', () => {
    const { w } = mk();
    const A = plan.rooms.find((r) => r.id === 'A')!;
    expect(w.player.pos.x).toBeGreaterThan(A.x0);
    expect(w.player.pos.x).toBeLessThan((A.x0 + A.x1) / 2); // 正面（南）から見て左側
    expect(w.player.pos.z).toBeGreaterThan(A.z1 - 5);
    expect(w.level.data.retryAt).toBe('entrance');
    // A → 縦通路（バキューム）→ E
    expect(near(route(w, [[11, 73], [20, 60], [20, 43], [20, 20]]), 20, 20)).toBe(true);
    // A → B → C
    expect(near(route(w, [[11, 73], [30, 65.5], [59, 65.5], [72, 65.5], [86, 65.5]]), 86, 65.5)).toBe(true);
    // E → F → G
    expect(near(route(w, [[20, 18], [40, 13.5], [60, 14], [64.5, 28], [69, 39]]), 69, 39)).toBe(true);
  });

  it('the key door stays shut with "key needed (1/2)", and opens when both keys are collected', () => {
    const { w, run } = mk();
    const st = getCamp1(w)!.state;
    const gate = getCamp1(w)!.vis.gates.find((g) => g.def.id === 'key')!;
    // 鍵なし：C から北へは抜けられない
    w.player.pos.set(92.5, 0, 60);
    run(0.2);
    expect(w.toasts.some((t) => t.text.includes('キーが必要（0/2）'))).toBe(true);
    expect(gate.collider.active).toBe(true);
    pickKey(w, 'B');
    expect(st.keys).toEqual(['B']);
    w.toasts.length = 0;
    w.player.pos.set(92.5, 0, 62);
    run(7);
    w.player.pos.set(92.5, 0, 60);
    run(0.2);
    expect(w.toasts.some((t) => t.text.includes('キーが必要（1/2）'))).toBe(true);
    expect(gate.collider.active).toBe(true);
    pickKey(w, 'F');
    expect(st.keyDoorOpen).toBe(true);
    w.player.pos.set(86, 0, 66);
    run(1.5);
    expect(gate.collider.active).toBe(false);
    const p = walk(w, [92.5, 0, 62], [92.5, 45]);
    expect(p.z).toBeLessThan(46);
  });

  it('keys can also be picked up by touching them', () => {
    const { w, run } = mk();
    const k = plan.keys[0];
    w.player.pos.set(k.x, k.y - 0.9, k.z);
    run(0.1);
    expect(getCamp1(w)!.state.keys).toContain(k.id);
  });

  it('draining both power sources with the arm removes the laser grid', () => {
    const { w } = mk();
    const st = getCamp1(w)!.state;
    const vis = getCamp1(w)!.vis;
    const laser = getPowerSources(w).filter((s, i) => plan.sources[i].laser);
    expect(laser.length).toBe(2);
    expect(vis.laser.collider.active).toBe(true);
    // 網で通れない
    const blocked = walk(w, [24, 0, 22], [40, 38], 6);
    expect(Math.hypot(blocked.x - 40, blocked.z - 38)).toBeGreaterThan(5);
    drainSource(laser[0], 999);
    expect(st.drained.length).toBe(1);
    expect(st.laserOff).toBe(false);
    expect(vis.laser.collider.active).toBe(true);
    drainSource(laser[1], 999);
    expect(st.laserOff).toBe(true);
    expect(vis.laser.collider.active).toBe(false);
    // 斜めの通路を通って I まで行ける
    expect(near(route(w, [[24, 22], [36, 34], [49, 47], [52, 50]]), 52, 50, 1.2)).toBe(true);
  });

  it('feeding the A socket opens the floor hatch to the tunnel; the tunnel has a gear and the steps lead back up', () => {
    const { w, run } = mk();
    const st = getCamp1(w)!.state;
    const [hatchSock] = getSockets(w);
    w.player.energy = 50;
    hatchSock.onFeed();
    expect(st.hatchOpen).toBe(true);
    expect(w.player.energy).toBe(49);
    run(CAMP1.hatchTime + 0.2);
    // ハッチの穴に落ちて、地下通路の奥（歯車）まで歩ける
    const H = plan.hatch;
    const fell = walk(w, [(H.x0 + H.x1) / 2, 0.2, (H.z0 + H.z1) / 2], [32, 60]);
    expect(fell.y).toBeLessThan(-4);
    expect(near(fell, 32, 60)).toBe(true);
    // 段を登って A の床へ戻れる（最後の段からハッチの縁へはジャンプ）
    // ぶつかったらジャンプしながら西へ歩く
    const pp = fell.clone(), v = new THREE.Vector3();
    let ground = true;
    for (let i = 0; i < 60 * 12 && pp.x > 4.6; i++) {
      v.x = -PLAYER.moveSpeed; v.z = (59.2 - pp.z) * 2;
      v.y = Math.max(-45, v.y - PLAYER.gravity / 60);
      const x0 = pp.x;
      const r = moveCharacter(w.colliders, pp, v, 1 / 60, PLAYER.radius, PLAYER.height);
      if ((r.hitWall || x0 - pp.x < 0.02) && ground && r.onGround) v.y = PLAYER.jumpSpeed;
      ground = r.onGround;
    }
    expect(pp.y).toBeGreaterThan(-0.1);
    expect(pp.x).toBeLessThan(6);
  });

  it('feeding (or shooting) the C switch turns on the lights in C', () => {
    const { w, run } = mk();
    const st = getCamp1(w)!.state;
    const vis = getCamp1(w)!.vis;
    expect(st.cLit).toBe(false);
    run(0.1);
    expect(vis.glowC.color.r).toBeLessThan(0.2);
    const cs = getSockets(w).find((s) => Math.abs(s.pos.x - plan.cSocket.x) < 0.1)!;
    w.player.energy = 20;
    cs.onFeed();
    expect(st.cLit).toBe(true);
    expect(cs.enabled).toBe(false);
    run(0.1);
    expect(vis.glowC.color.r).toBeGreaterThan(1);
    // 撃っても点く
    const b = mk();
    getSockets(b.w).find((s) => Math.abs(s.pos.x - plan.cSocket.x) < 0.1)!.onShot();
    expect(getCamp1(b.w)!.state.cLit).toBe(true);
  });

  it('the brittle wall cracks a stage per shot and only breaks with a fully charged shot', () => {
    const { w, run } = mk();
    const st = getCamp1(w)!.state;
    const v = getCamp1(w)!.vis.brittle;
    expect(hitBrittleWall(w, false, 0)).toBe(false);
    run(0.05);
    expect(st.crack).toBe(1);
    expect(v.cracks[0].visible).toBe(true);
    expect(v.cracks[1].visible).toBe(false);
    hitBrittleWall(w, true, 0.5);
    expect(st.crack).toBe(3);
    for (let i = 0; i < 5; i++) hitBrittleWall(w, false, 0);
    expect(st.crack).toBe(CAMP1.crackStages);
    expect(st.wallBroken).toBe(false);
    expect(v.collider.active).toBe(true);
    expect(hitBrittleWall(w, true, 1)).toBe(true);
    expect(st.wallBroken).toBe(true);
    expect(v.collider.active).toBe(false);
    // J の中の歯車まで歩ける
    expect(near(walk(w, [92, 0, 73], [101.5, 73]), 101.5, 73)).toBe(true);
  });

  it('a fully charged bullet flying into the wall breaks it (projectile scan)', () => {
    const { w, run } = mk();
    const B = plan.brittle;
    w.projectiles.push({ pos: new THREE.Vector3(B.x0 - 3, 1.5, 73), vel: new THREE.Vector3(55, 0, 0), radius: 0.3, damage: 999, owner: 'player', life: 1, mesh: new THREE.Object3D(), charged: true });
    run(0.2);
    expect(getCamp1(w)!.state.wallBroken).toBe(true);
  });

  it('the hidden duct between G and D is high up and leads from G to D', () => {
    const { w } = mk();
    const d = plan.duct;
    expect(d.y1 - d.y0).toBeGreaterThanOrEqual(PLAYER.height + 0.1);
    expect(d.y1 - d.y0).toBeLessThan(PLAYER.height + 0.5);   // ギリギリ通れる
    expect(d.y0).toBeGreaterThan(5);                          // ジャンプでは届かない
    // ダクトの中を G 側から D 側へ歩いて抜けられる（落ちて D の床へ）
    const p = walk(w, [d.x0 - 0.6, d.y0 + 0.05, (d.z0 + d.z1) / 2], [97, (d.z0 + d.z1) / 2]);
    expect(p.x).toBeGreaterThan(86);
    expect(p.y).toBeLessThan(0.5);
    // 床からは壁で抜けられない
    const q = walk(w, [79, 0, 39], [90, 39], 5);
    expect(q.x).toBeLessThan(81);
  });

  it('the red walker becomes a permanent ally after hacking, and guides to the duct in G', () => {
    const { w, run } = mk();
    run(DT);
    const c = getCamp1(w)!;
    const e = c.walker!;
    expect(e.kind).toBe('redWalker');
    expect(c.state.ally).toBe('enemy');
    e.allied = true;
    e.ai.allyT = e.ai.allyMax = 20;
    run(DT);
    expect(c.state.ally).toBe('ally');
    expect(e.ai.allyPermanent).toBe(true);
    // G に入ると案内先が設定される
    w.player.pos.set(69, 0, 39);
    run(DT);
    expect(e.ai.guideTo).toMatchObject({ x: plan.guide.x, z: plan.guide.z });
    w.player.pos.set(20, 0, 66);
    run(DT);
    expect(e.ai.guideTo).toBeUndefined();
    // 倒されたら終わり（再出現しない）
    e.status = 'dead';
    run(DT);
    expect(c.state.ally).toBe('dead');
  });

  it('the vacuum pickup sets world.unlocks.vacuum', () => {
    const { w, run } = mk();
    expect(w.unlocks.vacuum).toBe(false);
    w.player.pos.set(plan.vacuum.x, 0, plan.vacuum.z);
    run(0.1);
    expect(w.unlocks.vacuum).toBe(true);
    expect(w.toasts.some((t) => t.text.includes('バキュームを手に入れた'))).toBe(true);
    // アームで掴むものとして登録されている（歯車6・キー2・バキューム1）
    expect(getGrabbables(w).length).toBe(9);
  });

  it('the mid-boss fight locks H, and clearing it opens the 2F exit (→ camp2)', () => {
    const { w, run } = mk();
    run(DT);
    const c = getCamp1(w)!;
    // D に入るとチェックポイント
    w.player.pos.set(96, 0, 44);
    run(DT);
    expect(w.level.data.retryAt).toBe('boss');
    w.player.pos.set(96, 0, 20);
    run(DT);
    expect(c.state.boss).toBe('active');
    expect(c.state.lockdown).toBe(true);
    // 箱が揺れてから敵が出てくる（閉じた箱の中身も「生きている」と数える）
    expect(w.level.data.remaining).toBeGreaterThan(0);
    const killH = () => { for (const e of w.enemies) if (!e.allied && e.kind !== 'redWalker' && e.pos.z < 27 && e.pos.x > 82) e.status = 'dead'; };
    run(3);
    killH();
    run(DT);
    expect(c.state.wave2).toBe(true);
    expect(c.state.boss).toBe('active');   // 2波目のコンテナはまだ開いていない
    run(3);
    killH();
    run(DT);
    expect(c.state.boss).toBe('done');
    expect(c.state.exitOpen).toBe(true);
    run(1.2);
    const exitGate = c.vis.gates.find((g) => g.def.id === 'exit')!;
    expect(exitGate.collider.active).toBe(false);
    w.player.pos.set(106, 0, -2);
    run(DT);
    expect(c.state.exitReached).toBe(true);
    expect(w.level.data.nextLevel).toEqual({ level: 'camp2' });

    const saved = getCamp1Memo();
    expect(saved?.boss).toBe(true);
    expect(saved?.fights?.boss).toBe('done');
    setCamp1Memo(saved);
    const resumed = mk('boss');
    const resumedCamp = getCamp1(resumed.w)!;
    const resumedExit = resumedCamp.vis.gates.find((g) => g.def.id === 'exit')!;
    expect(resumedCamp.state.boss).toBe('done');
    expect(resumedCamp.state.exitOpen).toBe(true);
    expect(resumedExit.collider.active).toBe(false);
    // H に入っても撃破済みボス戦が再開しない。
    resumed.w.player.pos.set(96, 0, 20);
    resumed.run(DT);
    expect(resumedCamp.state.boss).toBe('done');
    expect(resumedCamp.state.fights.boss).toBe('done');
  });

  it('remembers completed ordinary fights and does not respawn them after loading', () => {
    const { w, run } = mk();
    run(DT); // spawn enemy actors
    for (const e of w.enemies) {
      if (e.kind === 'drone' && e.pos.x > 10 && e.pos.x < 30 && e.pos.z > 58 && e.pos.z < 65) e.status = 'dead';
    }
    run(DT);
    expect(getCamp1(w)!.state.fights.A).toBe('done');
    expect(w.level.data.saveDirty).toBe(true);
    const saved = getCamp1Memo();
    expect(saved?.fights?.A).toBe('done');

    setCamp1Memo(saved);
    const resumed = mk('entrance');
    resumed.run(DT);
    expect(getCamp1(resumed.w)!.state.fights.A).toBe('done');
    expect(resumed.w.enemies.some((e) => e.kind === 'drone' && e.pos.x > 10 && e.pos.x < 30 && e.pos.z > 58 && e.pos.z < 65)).toBe(false);
  });

  it('accepts v1 memos without fights and ignores malformed memo shapes safely', () => {
    // `fights` がなかった旧形式でも、拾った物と仕掛けは復元できる。
    setCamp1Memo({
      gears: ['tunnel', 'tunnel'], keys: ['B'], vacuum: true, ally: 'dead', allyHp: 0,
      hatchOpen: true, cLit: true, wallBroken: true, laserOff: false, drained: [], boss: false,
    });
    const legacy = mk('entrance');
    const legacyCamp = getCamp1(legacy.w)!;
    expect(legacyCamp.state.gears).toEqual(['tunnel']);
    expect(legacyCamp.state.keys).toEqual(['B']);
    expect(legacyCamp.state.vacuum).toBe(true);
    expect(legacyCamp.state.hatchOpen).toBe(true);
    expect(legacyCamp.state.cLit).toBe(true);
    expect(legacyCamp.state.wallBroken).toBe(true);
    expect(legacyCamp.walker).toBeNull();

    // v1 の boss フラグだけでも、倒したボスと開いた出口を復元する。
    setCamp1Memo({
      gears: [], keys: [], vacuum: false, ally: 'dead', allyHp: 0,
      hatchOpen: false, cLit: false, wallBroken: false, laserOff: false, drained: [], boss: true,
    });
    const legacyBoss = mk('boss');
    expect(getCamp1(legacyBoss.w)!.state.boss).toBe('done');
    expect(getCamp1(legacyBoss.w)!.state.exitOpen).toBe(true);

    const malformed: Record<string, unknown> = {};
    malformed.gears = malformed; // cyclic, and not an array
    expect(() => setCamp1Memo(malformed)).not.toThrow();
    expect(getCamp1Memo()).toBeNull();
    expect(() => mk('entrance')).not.toThrow();
  });

  it('prepares every room resume at a clear canonical point', () => {
    const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'tunnel', 'duct'];
    for (const id of ids) {
      const { w } = mk();
      w.inventory.gears = 13;
      expect(prepareCamp1RoomResume(w, id), id).toBe(true);
      expect(w.player.vel.lengthSq(), id).toBe(0);
      const position = w.player.pos.clone();
      const resolved = position.clone();
      moveCharacter(w.colliders, resolved, new THREE.Vector3(), DT, PLAYER.radius, PLAYER.height);
      expect(resolved.distanceTo(position), id).toBeLessThan(1e-6);
      expect(w.inventory.gears, id).toBe(13);
    }
    const { w } = mk();
    expect(prepareCamp1RoomResume(w, 'not-a-room')).toBe(false);
    expect(prepareCamp1RoomResume(createWorld({} as never, new EventBus(), 1), 'A')).toBe(false);
    setCamp1Memo(null);
  });

  it('opens the key route for D/H and keeps memo, fight retry, and collected gears consistent', () => {
    setCamp1Memo({
      gears: ['E'], keys: ['B'], vacuum: false, ally: 'dead', allyHp: 0,
      hatchOpen: false, cLit: false, wallBroken: false, laserOff: false, drained: [], boss: true,
      fights: { A: 'done', boss: 'done' },
    });
    const { w } = mk('entrance');
    w.inventory.gears = 9;
    const c = getCamp1(w)!;
    const keyGate = c.vis.gates.find((g) => g.def.id === 'key')!;
    const hEntry = c.vis.gates.find((g) => g.def.id === 'hEntry')!;
    const exit = c.vis.gates.find((g) => g.def.id === 'exit')!;

    expect(prepareCamp1RoomResume(w, 'H')).toBe(true);
    expect(c.state.keys).toEqual(['B', 'F']);
    expect(c.state.keyDoorOpen).toBe(true);
    expect(keyGate.collider.active).toBe(false);
    expect(c.state.gears).toEqual(['E']);
    expect(c.vis.gears.find((g) => g.id === 'E')!.taken).toBe(true);
    expect(w.inventory.gears).toBe(9);
    expect(c.state.boss).toBe('idle');
    expect(c.state.fights.boss).toBe('idle');
    expect(c.state.fights.A).toBe('done');
    expect(c.state.exitOpen).toBe(false);
    expect(c.state.wave2).toBe(false);
    expect(hEntry.collider.active).toBe(false);
    expect(exit.collider.active).toBe(true);
    expect(w.level.data.retryAt).toBe('boss');
    expect(w.level.data.saveDirty).toBe(true);
    expect(getCamp1Memo()).toMatchObject({ gears: ['E'], keys: ['B', 'F'], boss: false, fights: { A: 'done', boss: 'idle' } });

    updateCamp1(w, DT);
    expect(c.state.boss).toBe('active');
    expect(c.state.fights.boss).toBe('active');
    setCamp1Memo(null);
  });

  it('retries only the selected completed room and preserves a cleared H when resuming elsewhere', () => {
    setCamp1Memo({
      gears: ['I'], keys: ['B', 'F'], vacuum: false, ally: 'dead', allyHp: 0,
      hatchOpen: false, cLit: false, wallBroken: false, laserOff: false, drained: [], boss: true,
      fights: { A: 'done', B: 'done', boss: 'done' },
    });
    const { w } = mk('entrance');
    const c = getCamp1(w)!;
    const exit = c.vis.gates.find((g) => g.def.id === 'exit')!;
    expect(prepareCamp1RoomResume(w, 'A')).toBe(true);
    expect(c.state.fights.A).toBe('idle');
    expect(c.state.fights.B).toBe('done');
    expect(c.state.fights.boss).toBe('done');
    expect(c.state.boss).toBe('done');
    expect(c.state.exitOpen).toBe(true);
    expect(exit.collider.active).toBe(false);
    expect(getCamp1Memo()).toMatchObject({ gears: ['I'], boss: true, fights: { A: 'idle', B: 'done', boss: 'done' } });
    setCamp1Memo(null);
  });

  it('restores special passages and lets the player return through them', () => {
    const iWorld = mk().w;
    expect(prepareCamp1RoomResume(iWorld, 'I')).toBe(true);
    const i = getCamp1(iWorld)!;
    expect(i.state.laserOff).toBe(true);
    expect(i.vis.laser.collider.active).toBe(false);
    const iExit = route(iWorld, [[50.5, 51.5], [49, 47], [36, 34], [24, 22]]);
    expect(near(iExit, 24, 22, 1.5)).toBe(true);

    const jWorld = mk().w;
    expect(prepareCamp1RoomResume(jWorld, 'J')).toBe(true);
    expect(getCamp1(jWorld)!.state.wallBroken).toBe(true);
    expect(getCamp1(jWorld)!.vis.brittle.collider.active).toBe(false);
    const jExit = walk(jWorld, [101.5, 0, 71], [94, 71], 8);
    expect(jExit.x).toBeLessThan(97.5);

    const tunnelWorld = mk().w;
    expect(prepareCamp1RoomResume(tunnelWorld, 'tunnel')).toBe(true);
    expect(getCamp1(tunnelWorld)!.state.hatchOpen).toBe(true);
    expect(getCamp1(tunnelWorld)!.vis.hatch.collider.active).toBe(false);
    const tunnelExit = tunnelWorld.player.pos.clone(), v = new THREE.Vector3();
    let ground = true;
    for (let step = 0; step < 60 * 12 && tunnelExit.x > 4.6; step++) {
      v.x = -PLAYER.moveSpeed; v.z = (59.2 - tunnelExit.z) * 2;
      v.y = Math.max(-45, v.y - PLAYER.gravity / 60);
      const x0 = tunnelExit.x;
      const moved = moveCharacter(tunnelWorld.colliders, tunnelExit, v, 1 / 60, PLAYER.radius, PLAYER.height);
      if ((moved.hitWall || x0 - tunnelExit.x < 0.02) && ground && moved.onGround) v.y = PLAYER.jumpSpeed;
      ground = moved.onGround;
    }
    expect(tunnelExit.y).toBeGreaterThan(-0.1);
    expect(tunnelExit.x).toBeLessThan(6);

    const ductWorld = mk().w;
    expect(prepareCamp1RoomResume(ductWorld, 'duct')).toBe(true);
    const duct = getCamp1(ductWorld)!.plan.duct;
    const ductExit = walk(ductWorld, [ductWorld.player.pos.x, ductWorld.player.pos.y, ductWorld.player.pos.z], [97, (duct.z0 + duct.z1) / 2], 8);
    expect(ductExit.x).toBeGreaterThan(86);
    expect(ductExit.y).toBeLessThan(0.5);
    setCamp1Memo(null);
  });

  it("start=boss begins in D with the retry point set", () => {
    const { w } = mk('boss');
    expect(w.level.data.retryAt).toBe('boss');
    expect(near(w.player.pos, plan.checkpoints.boss.x, plan.checkpoints.boss.z)).toBe(true);
  });
});
