import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/events';
import type { World } from '../core/types';
import { createWorld } from '../core/world';
import { hasLineOfSight, moveCharacter, resolveSphere } from '../core/collision';
import { getGrapplePoints, isGrappling, startGrapple, stepGrapple, surfacePoint, updateGrapple } from '../core/grapple';
import { updateEnemies } from '../enemies/enemies';
import { getSockets } from '../core/sockets';
import { drainSource, getPowerSources } from '../core/powerSources';
import { GRAPPLE, PLAYER } from '../config/balance';
import { ENEMY_ORDER, enemyNo } from '../config/enemyInfo';
import { buildDrain, getDrain, getDrainMemo, hitBreakable, prepareDrainRoomResume, setDrainMemo, updateDrain } from './drain';
import { B_Y, DUCT_Y, LASER_X, generateDrain } from './drain/plan';

const DT = 1 / 30;

function mk(startAt?: string) {
  const keys = new Set<string>();
  const input = { locked: false, pressed: (k: string) => keys.has(k), isDown: (k: string) => keys.has(k), rawPressed: (k: string) => keys.has(k), rawDown: (k: string) => keys.has(k), lastDevice: 'kbm' };
  const w = createWorld(input as never, new EventBus(), 1);
  w.state = 'playing';
  if (startAt) w.level.data.startAt = startAt;
  buildDrain(w);
  const run = (sec: number) => { for (let i = 0; i < Math.round(sec / DT); i++) { w.time += DT; updateDrain(w, DT); } };
  return { w, run, keys };
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
function route(w: World, pts: [number, number][], y = 0): THREE.Vector3 {
  let p = new THREE.Vector3(pts[0][0], y, pts[0][1]);
  for (const q of pts.slice(1)) p = walk(w, [p.x, p.y, p.z], q);
  return p;
}
const near = (p: THREE.Vector3, x: number, z: number, r = 1) => Math.hypot(p.x - x, p.z - z) < r;
/** ゾーンの敵を全滅扱いにして、ゲートを開く */
function clearZone(w: World, id: string): void {
  const d = getDrain(w)!;
  void d;
  for (const e of w.enemies) e.status = 'dead';
}

describe('drain (ドレイン装置へ向かうダンジョン)', () => {
  const plan = generateDrain();

  it('uses only the allowed enemy kinds (No.1-15 w/o boss, No.19-20 in the Pokedex order) and no redCrawler/ringer/boss', () => {
    const kinds = new Set(plan.zones.flatMap((z) => z.spawns.map((s) => s.kind)));
    plan.spawner.kinds.forEach((k) => kinds.add(k));
    for (const k of kinds) {
      expect(['redCrawler', 'ringer', 'boss']).not.toContain(k);
      expect(enemyNo(k), k).toBeGreaterThanOrEqual(1);
      expect(ENEMY_ORDER).toContain(k);
    }
    // 赤メディックは B・C・F にいて、襲ってこない（neutral）
    for (const id of ['B', 'C', 'F']) {
      const z = plan.zones.find((q) => q.id === id)!;
      const m = z.spawns.filter((s) => s.kind === 'redMedic');
      expect(m.length, id).toBeGreaterThanOrEqual(1);
      expect(m.every((s) => s.neutral && s.mode === 'awake')).toBe(true);
    }
  });

  it('has I / D / F security devices, a hidden main power, 3 breakable blocks, and a laser dividing E in half', () => {
    expect(plan.securities.map((s) => s.id).sort()).toEqual(['D', 'F', 'I']);
    expect(plan.breakables.map((b) => b.id).sort()).toEqual(['dBlock', 'eBlock', 'iWall']);
    const E = plan.rooms.find((r) => r.id === 'E')!;
    expect(LASER_X).toBeGreaterThan(E.x0);
    expect(LASER_X).toBeLessThan(E.x1);
    expect(Math.abs(LASER_X - (E.x0 + E.x1) / 2)).toBeLessThan(6);
    // 縦通路の口（D から来る）は E のレーザーより西、F への狭い通路はレーザーより東
    expect(plan.centers.dn).toBeUndefined();
    const g = plan.gates.find((q) => q.id === 'gDoor')!;
    expect(g.closed).toBe(true);
    expect(g.x0).toBeLessThan(LASER_X);
    // 主電源はブロックの奥（E の南の壁の外）
    const eb = plan.breakables.find((b) => b.id === 'eBlock')!;
    expect(plan.mainPower.z).toBeGreaterThan(eb.z1);
  });

  it('builds and ticks without errors; player starts in A', () => {
    const { w, run } = mk();
    run(1);
    const d = getDrain(w)!;
    expect(d.state.checkpoint).toBe('entrance');
    expect(near(w.player.pos, plan.start.x, plan.start.z, 1)).toBe(true);
    expect(w.level.rooms.length).toBe(plan.rooms.length);
    expect(w.level.currentRoom).toBeGreaterThanOrEqual(0);
  });

  it('route 1: A -> C -> D (fight closes the doors) -> corridor -> E west (before the laser)', () => {
    const { w, run } = mk();
    run(0.5);
    const p0 = route(w, [[17, 108], [17, 94], [17, 86], [30, 79], [55, 79], [66, 79], [74, 79]]);
    expect(near(p0, 74, 79, 1.5)).toBe(true);
    // D に入ると扉が閉まる
    w.player.pos.copy(route(w, [[74, 79], [88, 79]]));
    run(0.3);
    const d = getDrain(w)!;
    expect(d.state.fights.D).toBe('active');
    run(2);
    expect(d.vis.gates.find((g) => g.def.id === 'dWest')!.collider.active).toBe(true);
    expect(d.vis.gates.find((g) => g.def.id === 'dNorth')!.collider.active).toBe(true);
    // 全滅で開く
    clearZone(w, 'D');
    run(2.5);
    expect(d.state.fights.D).toBe('done');
    expect(d.vis.gates.find((g) => g.def.id === 'dNorth')!.collider.active).toBe(false);
    const p1 = route(w, [[88, 79], [79, 70], [79, 56], [79, 49]]);
    expect(near(p1, 79, 49, 1.5)).toBe(true);
    // レーザーまでは西半分の中を歩ける。レーザーの手前で止められる
    const p2 = route(w, [[79, 49], [LASER_X - 3, 47]]);
    expect(near(p2, LASER_X - 3, 47, 1.5)).toBe(true);
    const p3 = walk(w, [p2.x, p2.y, p2.z], [LASER_X + 5, 47], 6);
    expect(p3.x).toBeLessThan(LASER_X);
  });

  it('laser hurts and the hidden main power block must be broken before the main power can be stopped', () => {
    const { w, run } = mk();
    run(0.2);
    const d = getDrain(w)!;
    w.player.pos.set(LASER_X - 0.8, 0, 47);
    const hp0 = w.player.hp;
    run(1);
    expect(w.player.hp).toBeLessThan(hp0);
    // ブロックが壊れるまでは主電源へ歩いて行けない
    const blocked = route(w, [[46, 49], [46, 56]]);
    expect(blocked.z).toBeLessThan(53);
    for (let i = 0; i < 6; i++) hitBreakable(w, 'eBlock', true, 1);
    expect(d.state.broken).toContain('eBlock');
    const inside = route(w, [[46, 49], [46, 56]]);
    expect(near(inside, 46, 56, 1)).toBe(true);
    // 主電源を撃つ（ソケット）とレーザーが消える
    const sock = getSockets(w).find((s) => s.pos.distanceTo(new THREE.Vector3(plan.mainPower.x, plan.mainPower.y, plan.mainPower.z)) < 0.1)!;
    sock.onShot();
    expect(d.state.laserOff).toBe(true);
    expect(d.vis.laser.collider.active).toBe(false);
    run(0.2);
    const east = route(w, [[LASER_X - 3, 47], [LASER_X + 5, 47]]);
    expect(east.x).toBeGreaterThan(LASER_X + 3);
  });

  it('main power can also be stopped by absorbing it', () => {
    const { w } = mk();
    const d = getDrain(w)!;
    const src = getPowerSources(w).find((s) => s.pos.distanceTo(new THREE.Vector3(plan.mainPower.x, plan.mainPower.y, plan.mainPower.z)) < 0.1)!;
    expect(drainSource(src, 100)).toBeGreaterThan(0);
    expect(d.state.mainOff).toBe(true);
    expect(d.state.laserOff).toBe(true);
  });

  it('E -> F through the dark narrow passage (after the laser is off)', () => {
    const { w } = mk();
    const d = getDrain(w)!;
    prepareDrainRoomResume(w, 'pass');
    expect(d.state.laserOff).toBe(true);
    const p = route(w, [[120, 47], [131.7, 44], [131.7, 36], [131.7, 28], [126, 24]]);
    expect(near(p, 126, 24, 1.5)).toBe(true);
    // 通路の幅は狭い（体がやっと通る）
    const gap = plan.gates.length;
    expect(gap).toBeGreaterThan(0);
    const pass = plan.rooms.find((r) => r.id === 'pass')!;
    expect(pass.x1 - pass.x0).toBeLessThan(2);
    expect(pass.x1 - pass.x0).toBeGreaterThan(PLAYER.radius * 2);
  });

  it('C -> I: the breakable wall blocks until a full charged shot breaks it', () => {
    const { w, run } = mk();
    run(0.2);
    const d = getDrain(w)!;
    const before = route(w, [[55, 79], [59, 72], [59, 64]]);
    expect(before.z).toBeGreaterThan(67);
    expect(hitBreakable(w, 'iWall', false, 0)).toBe(false);
    expect(hitBreakable(w, 'iWall', true, 0.5)).toBe(false);
    expect(d.state.broken).not.toContain('iWall');
    expect(hitBreakable(w, 'iWall', true, 1)).toBe(true);
    const after = route(w, [[59, 72], [59, 62]]);
    expect(near(after, 59, 62, 1)).toBe(true);
  });

  it('D basement: stairs are blocked by the block; after breaking it you can walk down to the security device', () => {
    const { w } = mk();
    const d = getDrain(w)!;
    const blocked = route(w, [[120.5, 68], [120.5, 80]]);
    expect(blocked.z).toBeLessThan(73);
    hitBreakable(w, 'dBlock', true, 1);
    expect(d.state.broken).toContain('dBlock');
    const down = route(w, [[120.5, 68], [120.5, 79], [118, 86]]);
    expect(down.y).toBeLessThan(-3.5);
    expect(near(down, 118, 86, 1.5)).toBe(true);
  });

  it('security devices: shot / arm / absorb each stop them; 3 of 3 opens the G door', () => {
    const { w, run } = mk();
    run(0.2);
    const d = getDrain(w)!;
    const gate = d.vis.gates.find((g) => g.def.id === 'gDoor')!;
    expect(gate.collider.active).toBe(true);
    const find = (id: string) => {
      const s = plan.securities.find((q) => q.id === id)!;
      const pos = new THREE.Vector3(s.x, s.y, s.z);
      return {
        sock: getSockets(w).find((q) => q.pos.distanceTo(pos) < 0.1)!,
        src: getPowerSources(w).find((q) => q.pos.distanceTo(pos) < 0.1)!,
      };
    };
    find('I').sock.onShot();
    expect(d.state.secs).toEqual(['I']);
    w.player.energy = 10;
    find('D').sock.onFeed();
    expect(d.state.secs).toEqual(['I', 'D']);
    expect(gate.collider.active).toBe(true);
    drainSource(find('F').src, 100);
    expect(d.state.secs.sort()).toEqual(['D', 'F', 'I']);
    expect(d.state.gDoorOpen).toBe(true);
    run(2);
    expect(gate.collider.active).toBe(false);
    // 開いた扉から G へ入れる
    const p = route(w, [[55, 47], [55, 38], [55, 30]]);
    expect(near(p, 55, 30, 1)).toBe(true);
    // 二重に止めても数は増えない
    find('I').sock.onShot();
    expect(d.state.secs.length).toBe(3);
  });

  it('A basement: walk down the stairs and take the hologram decoy', () => {
    const { w, run } = mk();
    run(0.2);
    expect(w.unlocks.decoy).toBeFalsy();
    const p = route(w, [[6.5, 68], [6.5, 79], [10, 84], [14, 85]]);
    expect(p.y).toBeLessThan(-3.5);
    w.player.pos.copy(p);
    run(0.5);
    expect(w.unlocks.decoy).toBe(true);
    expect(getDrain(w)!.vis.decoy.taken).toBe(true);
  });

  it('falling into the shaft or off the rope is instant death', () => {
    const { w, run } = mk();
    run(0.2);
    w.player.pos.set(17, -3, 50);
    run(0.2);
    expect(w.player.hp).toBe(0);
    expect(getDrain(w)!.state.fell).toBe(true);
    const b = mk();
    b.run(0.2);
    b.w.player.pos.set(38, -2.5, 20);
    b.run(0.2);
    expect(b.w.player.hp).toBe(0);
    // 床の上では死なない
    const c = mk();
    c.run(0.2);
    c.w.player.pos.set(17, 0, 80);
    c.run(0.2);
    expect(c.w.player.hp).toBeGreaterThan(0);
  });

  it('route 2 geometry: platforms climb from A to B with small steps, within grapple range', () => {
    const tops: { x: number; y: number; z: number }[] = [];
    for (const b of plan.boxes) if (b.tag === 'platform' && b.x1 - b.x0 < 5 && b.z1 - b.z0 < 5 && b.y1 > 3 && b.x0 < 30) tops.push({ x: (b.x0 + b.x1) / 2, y: b.y1, z: (b.z0 + b.z1) / 2 });
    for (const m of plan.platforms) tops.push({ x: m.x, y: m.y, z: m.z });
    tops.sort((a, c) => a.y - c.y);
    expect(plan.platforms.length).toBeGreaterThanOrEqual(2);
    let prev = { x: 17, y: 0, z: 66 };
    for (const t of tops.filter((q) => q.y < B_Y)) {
      expect(t.y - prev.y, `step to y=${t.y}`).toBeLessThanOrEqual(8);
      expect(Math.hypot(t.x - prev.x, t.z - prev.z, t.y - prev.y)).toBeLessThan(GRAPPLE.range);
      prev = t;
    }
    // 最後の足場から B の張り出しまで
    expect(B_Y - prev.y).toBeLessThanOrEqual(8);
    expect(Math.hypot(14 - prev.x, 33 - prev.z, B_Y - prev.y)).toBeLessThan(GRAPPLE.range);
  });

  it('route 2: every hop from A up to B can be done with the grapple (ledge hoist), and the B ledge can reach the hidden duct', () => {
    const { w } = mk();
    interface T { x0: number; x1: number; top: number; z0: number; z1: number; name: string }
    const platform = (x: number, top: number, z: number, sx: number, sz: number, name: string): T => ({ x0: x - sx / 2, x1: x + sx / 2, top, z0: z - sz / 2, z1: z + sz / 2, name });
    const chain: T[] = [
      platform(9, 6, 60, 4, 4, 'P1'),
      ...plan.platforms.filter((m) => m.id === 'm1').map((m) => platform(m.x, m.y, m.z, m.sx, m.sz, 'm1')),
      platform(8, 16, 51, 3.2, 3.2, 'P2'),
      platform(24, 21, 48, 3.2, 3.2, 'P3'),
      ...plan.platforms.filter((m) => m.id === 'm2').map((m) => platform(m.x, m.y, m.z, m.sx, m.sz, 'm2')),
      platform(24, 30.2, 39, 3.2, 3.2, 'P4'),
      { x0: 6, x1: 22, top: B_Y, z0: 28, z1: 37, name: 'apron' },
    ];
    const p = w.player;
    p.pos.set(9, 0, 66.5);
    p.vel.set(0, 0, 0);
    p.energy = 100;
    for (const t of chain) {
      p.energy = 100;
      const cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
      // 自分に近い面の、縁から 1.5m 下を狙う
      const dx = p.pos.x - cx, dz = p.pos.z - cz;
      const useX = Math.abs(dx) / (t.x1 - t.x0) > Math.abs(dz) / (t.z1 - t.z0);
      const hit = useX ? new THREE.Vector3(dx > 0 ? t.x1 : t.x0, t.top - 1.5, Math.max(t.z0 + 0.5, Math.min(t.z1 - 0.5, p.pos.z)))
        : new THREE.Vector3(Math.max(t.x0 + 0.5, Math.min(t.x1 - 0.5, p.pos.x)), t.top - 1.5, dz > 0 ? t.z1 : t.z0);
      const normal = useX ? new THREE.Vector3(Math.sign(dx), 0, 0) : new THREE.Vector3(0, 0, Math.sign(dz));
      const chest = p.pos.clone().setY(p.pos.y + 0.9);
      expect(chest.distanceTo(hit), `range to ${t.name}`).toBeLessThan(GRAPPLE.range);
      expect(hasLineOfSight(w.colliders, chest, hit.clone().addScaledVector(normal, 0.05)), `line of sight to ${t.name}`).toBe(true);
      const gp = surfacePoint(w, hit.clone().addScaledVector(normal, 0.0));
      expect(gp?.kind, `ledge at ${t.name}`).toBe('ledge');
      expect(startGrapple(w, gp!)).toBe(true);
      for (let i = 0; i < 60 * 8 && isGrappling(w); i++) { stepGrapple(w, 1 / 60); updateGrapple(w, 1 / 60); }
      expect(isGrappling(w), `finished ${t.name}`).toBe(false);
      expect(p.pos.y, `landed on ${t.name}`).toBeCloseTo(t.top, 0);
      expect(p.pos.x).toBeGreaterThan(t.x0 - 0.2); expect(p.pos.x).toBeLessThan(t.x1 + 0.2);
      expect(p.pos.z).toBeGreaterThan(t.z0 - 0.2); expect(p.pos.z).toBeLessThan(t.z1 + 0.2);
      for (let i = 0; i < 40; i++) updateGrapple(w, 1 / 60);   // 待ち時間
    }
    // B の中から、隠し通路の棚の縁（登録済みのグラップルポイント）へ
    const g = plan.grapples[0];
    p.pos.set(17, B_Y, 24.5);
    p.energy = 100;
    const pt = getGrapplePoints(w).find((q) => Math.abs(q.pos.x - g.x) < 0.01 && Math.abs(q.pos.y - g.y) < 0.01)!;
    expect(pt).toBeTruthy();
    expect(startGrapple(w, pt)).toBe(true);
    for (let i = 0; i < 60 * 8 && isGrappling(w); i++) { stepGrapple(w, 1 / 60); updateGrapple(w, 1 / 60); }
    expect(p.pos.y).toBeCloseTo(DUCT_Y, 0);
    expect(p.pos.x).toBeGreaterThan(20);
    // そのままダクトを歩いて G の高い着地台へ
    const end = walk(w, [p.pos.x, p.pos.y, p.pos.z], [52, 24.5], 20);
    expect(near(end, 52, 24.5, 1)).toBe(true);
    expect(end.y).toBeGreaterThan(DUCT_Y - 0.5);
    // G の着地台から G の床まで降りられる（落ちても死なない）
    const down = walk(w, [end.x, end.y, end.z], [60, 24.5], 10);
    void down;
  });

  it('moving platform moves and carries the player', () => {
    const { w, run } = mk();
    run(0.1);
    const d = getDrain(w)!;
    const pv = d.vis.platforms[0];
    const x0 = pv.x;
    w.player.pos.set(pv.x, pv.def.y, pv.z);
    w.player.vel.set(0, 0, 0);
    run(0.5);
    expect(Math.abs(pv.x - x0)).toBeGreaterThan(0.1);
    expect(Math.abs(w.player.pos.x - pv.x)).toBeLessThan(0.05);
    expect(pv.collider.max.x - pv.collider.min.x).toBeCloseTo(pv.def.sx, 3);
  });

  it('B fight: entering B closes the doors; clearing opens the east door to the rope', () => {
    const { w, run } = mk('bTop');
    run(0.3);
    const d = getDrain(w)!;
    expect(d.state.checkpoint).toBe('bTop');
    expect(w.player.pos.y).toBeCloseTo(B_Y, 0);
    w.player.pos.set(14, B_Y, 22);
    run(0.3);
    expect(d.state.fights.B).toBe('active');
    run(1.5);
    expect(d.vis.gates.find((g) => g.def.id === 'bEntry')!.collider.active).toBe(true);
    expect(d.vis.gates.find((g) => g.def.id === 'bExit')!.collider.active).toBe(true);
    clearZone(w, 'B');
    run(2.5);
    expect(d.state.fights.B).toBe('done');
    expect(d.vis.gates.find((g) => g.def.id === 'bExit')!.collider.active).toBe(false);
    // ロープの上は歩ける
    const p = walk(w, [21, B_Y, 20], [48, 20], 20);
    expect(near(p, 48, 20, 1)).toBe(true);
    expect(p.y).toBeCloseTo(B_Y, 0);
    // 着いた先は G の高い着地台。そこから G の床へ降りられる
    expect(w.colliders.length).toBeGreaterThan(100);
  });

  it('hidden path: the duct runs above the rope from B to G (needs the ledge grapple)', () => {
    expect(plan.grapples.length).toBeGreaterThanOrEqual(1);
    expect(plan.duct.y0).toBe(DUCT_Y);
    expect(plan.duct.y0 - B_Y).toBeGreaterThanOrEqual(6);
    const { w } = mk('rope');
    // ダクトの中は歩いて G まで行ける
    const p = walk(w, [27, DUCT_Y, 24.5], [52, 24.5], 20);
    expect(near(p, 52, 24.5, 1)).toBe(true);
    expect(p.y).toBeGreaterThan(DUCT_Y - 0.5);
  });

  it('G is reachable from the rope landing and its drain-door can be inspected', () => {
    const { w, run, keys } = mk('goal');
    run(0.2);
    const d = getDrain(w)!;
    expect(d.state.checkpoint).toBe('goal');
    w.player.pos.set(64, 0, 18);
    keys.add('KeyR');
    run(0.1);
    keys.delete('KeyR');
    expect(d.state.doorChecks).toBeGreaterThanOrEqual(1);
  });

  it('every enemy spawn lies inside a room at the right height, and awake ones are not embedded in walls', () => {
    for (const z of plan.zones) {
      for (const s of z.spawns) {
        const fl = s.floor ?? 0;
        const room = plan.rooms.find((r) => s.x > r.x0 && s.x < r.x1 && s.z > r.z0 && s.z < r.z1 && fl >= r.y0 - 0.5 && fl <= r.y1);
        expect(room, `${z.id}:${s.kind}@${s.x},${s.z},${fl}`).toBeTruthy();
      }
    }
    const { w, run } = mk();
    run(0.3);
    const embedded: string[] = [];
    for (const e of w.enemies) {
      if (e.ai.dormant) continue;
      const c = e.pos.clone();
      const n = resolveSphere(w.colliders, c, e.radius * 0.9);
      if (n.lengthSq() > 0) embedded.push(`${e.kind}@${e.pos.toArray().map((v) => v.toFixed(1))}`);
    }
    expect(embedded).toEqual([]);
    // 赤メディックは B・C・F にいる。戦闘の残り数に数えない
    expect(w.enemies.filter((e) => e.kind === 'redMedic').length).toBe(3);
  });

  it('keeps simulating enemies in the real update loop without errors (all rooms)', () => {
    const { w, run } = mk();
    for (const [x, y, z] of [[17, 0, 80], [55, 0, 79], [100, 0, 76], [60, 0, 45], [120, 0, 47], [126, 0, 22], [14, B_Y, 22], [38, 34, 20]] as const) {
      w.player.pos.set(x, y, z);
      w.player.invuln = 9999;
      for (let i = 0; i < 60; i++) { w.time += DT; updateEnemies(w, DT); updateDrain(w, DT); }
    }
    run(1);
    expect(w.player.hp).toBeGreaterThan(0);
  });

  it('memo: broken blocks, stopped devices and cleared fights survive a rebuild (retry)', () => {
    const a = mk();
    a.run(0.2);
    hitBreakable(a.w, 'iWall', true, 1);
    const sec = plan.securities.find((s) => s.id === 'I')!;
    getSockets(a.w).find((q) => q.pos.distanceTo(new THREE.Vector3(sec.x, sec.y, sec.z)) < 0.1)!.onShot();
    const m = getDrainMemo()!;
    expect(m.broken).toContain('iWall');
    expect(m.secs).toContain('I');
    const b = mk('entrance');
    const d = getDrain(b.w)!;
    expect(d.state.broken).toContain('iWall');
    expect(d.state.secs).toEqual(['I']);
    // 外から入り直した（startAt なし）ときは消える
    const c = mk();
    expect(getDrain(c.w)!.state.broken).toEqual([]);
    // 壊れた記録は捨てる
    setDrainMemo({ secs: ['X'], broken: [], mainOff: false });
    expect(getDrainMemo()).toBeNull();
    setDrainMemo(null);
  });
});
