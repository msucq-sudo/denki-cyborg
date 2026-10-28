import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/events';
import type { AABB, World } from '../core/types';
import { PLAYER } from '../config/balance';
import { generateFloor1, MAX_STEP } from './floor1/plan';
import { podSize } from '../enemies/dormant';
import { ENEMIES } from '../config/balance';
import type { Plan } from './floor1/plan';
import { buildFloor1, getFloor1, updateFloor1 } from './floor1';
import { createWorld } from '../core/world';
import { updateEnemies } from '../enemies/enemies';
import { spawnProjectile, updateProjectiles } from '../core/projectiles';
import { initAbsorb, updateAbsorb } from '../abilities/absorb';
import { LOCKDOWN } from '../config/balance';

const plan = generateFloor1();

interface Surf { x0: number; x1: number; z0: number; z1: number; top: number }

/** 足場になりうる上面（床スラブ・小物・足場）。壁/天井/仕切りは除く */
function surfaces(p: Plan): Surf[] {
  const out: Surf[] = [];
  for (const q of p.prims) {
    if (q.t !== 'box' || !q.col) continue;
    if (q.tag === 'wall' || q.tag === 'ceiling' || q.tag === 'partition') continue;
    out.push({ x0: q.x0, x1: q.x1, z0: q.z0, z1: q.z1, top: q.y1 });
  }
  return out;
}
const gap = (a: Surf, b: Surf) =>
  Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.z0 - b.z1, b.z0 - a.z1));

/** 歩く／1段ジャンプ(<=1.3m)／ジェット滞空(同じ高さ以下・水平7m以内)で行ける足場の集合 */
function reachable(from: number, S: Surf[], useHover = true): Set<number> {
  const seen = new Set<number>([from]);
  const q = [from];
  while (q.length) {
    const i = q.pop()!;
    for (let j = 0; j < S.length; j++) {
      if (seen.has(j)) continue;
      const g = gap(S[i], S[j]);
      const up = S[j].top - S[i].top;
      if ((g <= 0.3 && up <= MAX_STEP + 1e-6) || (useHover && g <= 7 && up <= 0.05)) { seen.add(j); q.push(j); }
    }
  }
  return seen;
}
const under = (S: Surf[], x: number, z: number, top: number) =>
  S.findIndex((s) => Math.abs(s.top - top) < 0.06 && x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1);

describe('floor1 plan', () => {
  it('has 7 gears: dead end 1, right room 2, hall pillars 2 (high), upper-left room 2', () => {
    expect(plan.gears.length).toBe(7);
    expect(plan.gears.filter((g) => g.y > 6).length).toBe(2);
    expect(plan.gears.filter((g) => g.y < 3).length).toBe(5);
    const n = (k: string) => plan.gears.filter((g) => g.area.startsWith(k)).length;
    expect(n('行き止まり')).toBe(1);
    expect(n('右の部屋')).toBe(2);
    expect(n('左上')).toBe(2);
    expect(n('大広間')).toBe(2);
  });
  it('start corridor holds exactly 2 easy grunts', () => {
    const z = plan.zones.find((q) => q.id === 'start')!;
    expect(z.spawns.length).toBe(2);
    expect(z.spawns.every((sp) => sp.kind === 'crawler' || sp.kind === 'walker')).toBe(true);
  });
  it('heavy kinds appear only in the elevator fight; easy fights have <= 1 gunner and no missile', () => {
    for (const z of plan.zones) {
      const kinds = z.spawns.map((sp) => sp.kind);
      if (z.id !== 'final') {
        expect(kinds.some((k) => k === 'heavy' || k === 'heavyWalker' || k === 'missile'), z.id).toBe(false);
        expect(kinds.filter((k) => k === 'gunner').length, z.id).toBeLessThanOrEqual(1);
      }
    }
    const fin = plan.zones.find((q) => q.id === 'final')!.spawns.map((sp) => sp.kind);
    expect(fin.includes('heavy') || fin.includes('heavyWalker')).toBe(true);
    expect(fin.includes('gunner')).toBe(true);
    expect(fin.filter((k) => k === 'crawler').length).toBe(2);
  });
  it('trap fights are small and easy', () => {
    for (const [id, max] of [['dead', 3], ['RU', 4], ['L3', 3]] as const) {
      const z = plan.zones.find((q) => q.id === id)!;
      expect(z.spawns.length, id).toBeGreaterThanOrEqual(2);
      expect(z.spawns.length, id).toBeLessThanOrEqual(max);
      expect(z.spawns.filter((sp) => sp.kind === 'walker').length, id).toBeLessThanOrEqual(1);
    }
  });
  it('has the 8 gates; start/rexit/l2 begin closed', () => {
    const ids = plan.gates.map((g) => g.id).sort();
    expect(ids).toEqual(['dead', 'l2', 'l3n', 'rexit', 'rlow', 'rmid', 'side', 'start']);
    for (const id of ['start', 'rexit', 'l2']) expect(plan.gates.find((g) => g.id === id)!.closed).toBe(true);
  });
  it('power device is in the side narrow room', () => {
    const side = plan.rooms.find((r) => r.id === 'side')!;
    const P = plan.power;
    expect(P.x > side.x0 && P.x < side.x1 && P.z > side.z0 && P.z < side.z1).toBe(true);
  });
  it('the east crate staircase is gone and the east deck stays off the south-east area', () => {
    expect(plan.prims.some((q) => q.t === 'box' && q.tag === 'step' && q.x0 >= 17 && q.z0 > -40 && q.z1 < -10)).toBe(false);
    const eastDeck = plan.prims.filter((q) => q.t === 'box' && q.tag === 'deck' && q.x0 >= 17);
    expect(eastDeck.every((q) => q.t === 'box' && q.z1 <= -37)).toBe(true);
  });
  describe('connectivity (2D flood fill; closed gates and walls block)', () => {
    const CS = 0.5, X0 = -100, Z0 = -90, NX = 400, NZ = 220;
    const idx = (x: number, z: number) => Math.floor((z - Z0) / CS) * NX + Math.floor((x - X0) / CS);
    function grid(blocked: string[]): Uint8Array {
      const g = new Uint8Array(NX * NZ);
      const paint = (q: { x0: number; x1: number; z0: number; z1: number }, v: number) => {
        for (let zz = Math.max(0, Math.floor((q.z0 - Z0) / CS)); zz < Math.min(NZ, Math.ceil((q.z1 - Z0) / CS)); zz++)
          for (let xx = Math.max(0, Math.floor((q.x0 - X0) / CS)); xx < Math.min(NX, Math.ceil((q.x1 - X0) / CS)); xx++) g[zz * NX + xx] = v;
      };
      for (const q of plan.prims) if (q.t === 'box' && q.col && q.tag === 'floor') paint(q, 1);
      for (const q of plan.prims) if (q.t === 'box' && q.col && q.tag === 'wall' && q.y0 < 1 && q.y1 > 3) paint(q, 0);
      for (const gt of plan.gates) if (blocked.includes(gt.id)) paint(gt, 0);
      return g;
    }
    function flood(g: Uint8Array, sx: number, sz: number): Uint8Array {
      const seen = new Uint8Array(NX * NZ);
      const st = [idx(sx, sz)];
      seen[st[0]] = 1;
      while (st.length) {
        const i = st.pop()!;
        const x = i % NX, z = (i - x) / NX;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= NX || nz >= NZ) continue;
          const j = nz * NX + nx;
          if (g[j] && !seen[j]) { seen[j] = 1; st.push(j); }
        }
      }
      return seen;
    }
    const at = (seen: Uint8Array, x: number, z: number) => seen[idx(x, z)] === 1;
    const S = plan.start;
    it('start corridor is sealed while the start gate is closed', () => {
      const seen = flood(grid(['start']), S.x, S.z);
      expect(at(seen, -30, -9.5)).toBe(true);
      expect(at(seen, -10, -9.5)).toBe(false);
    });
    it('the south-east area reaches the dead end and right room but not the main hall (until the exit opens)', () => {
      const seen = flood(grid(['rexit', 'l2']), S.x, S.z);
      expect(at(seen, -10, -9.5)).toBe(true);     // 南東エリア
      expect(at(seen, 15, -30)).toBe(true);       // 仕切りの内側（下の入口前）
      expect(at(seen, 76, -2)).toBe(true);        // 行き止まり
      expect(at(seen, 45, -36)).toBe(true);       // 右の部屋 下
      expect(at(seen, 45, -60)).toBe(true);       // 右の部屋 上
      expect(at(seen, 0, -50)).toBe(false);       // 大広間（メイン）
      expect(at(seen, -10, -30)).toBe(false);     // 仕切りの北
      expect(at(seen, -42, -45)).toBe(false);
    });
    it('main hall is reached only through the right room exit; the west gate leads to the left rooms', () => {
      const seen = flood(grid(['l2']), S.x, S.z);
      expect(at(seen, 0, -50)).toBe(true);        // rexit が開けば到達
      expect(at(seen, -42, -45)).toBe(false);     // l2 が閉じている間は左の部屋に行けない
      const seen2 = flood(grid([]), S.x, S.z);
      for (const [x, z] of [[-42, -45], [-42, -28], [-27, -28], [-42, -62], [0, -72]]) expect(at(seen2, x, z), `${x},${z}`).toBe(true);
    });
    it('without the right room the south-east area is closed (rlow + rmid shut)', () => {
      const seen = flood(grid(['rexit', 'rmid', 'rlow']), S.x, S.z);
      expect(at(seen, 45, -60)).toBe(false);
      expect(at(seen, 0, -50)).toBe(false);
    });
    it('the middle corridor to the right room is walled up (no floor, no opening)', () => {
      const seen = flood(grid([]), S.x, S.z);
      expect(at(seen, 27, -51)).toBe(false);
      expect(at(seen, 23, -51)).toBe(false);
      expect(plan.doors.some((d) => d[0] >= 22 && d[0] <= 23 && d[2] <= -51 && d[3] >= -51)).toBe(false);
    });
    it('partition is a solid full-height wall around the south-east area', () => {
      const walls = plan.prims.filter((q) => q.t === 'box' && q.tag === 'wall' && q.y1 >= 15);
      const hit = (x: number, z: number) => walls.some((q) => q.t === 'box' && x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1);
      expect(hit(-10, -17.5)).toBe(true);
      expect(hit(10.5, -25)).toBe(true);
      expect(hit(16, -36.5)).toBe(true);
    });
  });
  it('start point is on a floor collider and not inside any solid', () => {
    const s = plan.start;
    const onFloor = plan.prims.some((q) => q.t === 'box' && q.col && q.tag === 'floor' && s.x > q.x0 && s.x < q.x1 && s.z > q.z0 && s.z < q.z1 && q.y1 === 0);
    expect(onFloor).toBe(true);
    const r = PLAYER.radius;
    const hit = plan.prims.some((q) => q.t === 'box' && q.col && q.tag !== 'floor' && s.x > q.x0 - r && s.x < q.x1 + r && s.z > q.z0 - r && s.z < q.z1 + r && q.y1 > 0.1 && q.y0 < 1.8);
    expect(hit).toBe(false);
  });
  it('every spawn is inside a room', () => {
    for (const z of plan.zones) for (const sp of z.spawns) {
      expect(plan.rooms.some((r) => sp.x > r.x0 && sp.x < r.x1 && sp.z > r.z0 && sp.z < r.z1), `${z.id} ${sp.kind}`).toBe(true);
    }
  });
  it('dormant pods fit: stand on the floor/deck, clear of every solid and wall', () => {
    const S = surfaces(plan);
    const bad: string[] = [];
    for (const z of plan.zones) for (const sp of z.spawns) {
      if (sp.kind === 'drone') continue;
      const fl = sp.floor ?? 0;
      const { w, d, h } = podSize(ENEMIES[sp.kind].radius);
      const half = Math.max(w, d) / 2 + 0.15;
      // 4隅が同じ高さの足場の上
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (under(S, sp.x + dx * half, sp.z + dz * half, fl) < 0) bad.push(`${z.id} ${sp.kind} (${sp.x},${sp.z}) corner not on floor`);
      }
      for (const q of plan.prims) {
        if (q.t !== 'box' || !q.col || q.tag === 'floor') continue;
        const hitXZ = sp.x + half > q.x0 && sp.x - half < q.x1 && sp.z + half > q.z0 && sp.z - half < q.z1;
        const hitY = q.y1 > fl + 0.3 && q.y0 < fl + h;
        if (hitXZ && hitY) bad.push(`${z.id} ${sp.kind} (${sp.x},${sp.z}) overlaps ${q.tag} [${q.x0},${q.x1}]x[${q.z0},${q.z1}]`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('rooms are wide and the hall is big', () => {
    const hall = plan.rooms.find((r) => r.id === 'hall')!;
    expect(hall.x1 - hall.x0).toBeGreaterThanOrEqual(45);
    expect(hall.z1 - hall.z0).toBeGreaterThanOrEqual(65);
    const start = plan.rooms.find((r) => r.id === 'start')!;
    expect(start.z1 - start.z0).toBeGreaterThanOrEqual(8);
    expect(start.x1 - start.x0).toBeGreaterThanOrEqual(35);
  });
  it('gears are reachable: floor gears on foot, hall gears only with the jetpack gap', () => {
    const S = surfaces(plan);
    const startIdx = S.findIndex((s) => s.top === 0 && plan.start.x > s.x0 && plan.start.x < s.x1 && plan.start.z > s.z0 && plan.start.z < s.z1);
    expect(startIdx).toBeGreaterThanOrEqual(0);
    const withJet = reachable(startIdx, S, true);
    const noJet = reachable(startIdx, S, false);
    for (const g of plan.gears) {
      const idx = under(S, g.x, g.z, g.y - 1.1);
      expect(idx, `gear surface at ${g.x},${g.z}`).toBeGreaterThanOrEqual(0);
      expect(withJet.has(idx), `reachable ${g.area}`).toBe(true);
      if (g.y > 6) expect(noJet.has(idx)).toBe(false);
    }
  });
});

describe('floor1 layout: open floors for big enemies', () => {
  const propBoxes = plan.prims.filter((q): q is Extract<typeof q, { t: 'box' }> =>
    q.t === 'box' && q.col && (q.tag === 'prop' || q.tag === 'cover'));
  /** 大物が歩く床の高さにある（天井・壁・床ではない）小物か */
  const overlap = (q: { x0: number; x1: number; z0: number; z1: number }, r: [number, number, number, number]) =>
    q.x1 > r[0] && q.x0 < r[1] && q.z1 > r[2] && q.z0 < r[3];

  /** 戦闘のある部屋：小物を壁際だけにして床を空ける（戦闘のない部屋は実験室らしく密に置く） */
  const FIGHT_ROOMS = ['start', 'dead', 'RU', 'L3'];
  it('no text signs remain', () => {
    expect(plan.signs.length).toBe(0);
  });
  it('fight room centers (inset 25% from the walls) hold at most 2 props', () => {
    const bad: string[] = [];
    for (const r of plan.rooms) {
      if (!FIGHT_ROOMS.includes(r.id)) continue;
      const ix = (r.x1 - r.x0) * 0.25, iz = (r.z1 - r.z0) * 0.25;
      const c: [number, number, number, number] = [r.x0 + ix, r.x1 - ix, r.z0 + iz, r.z1 - iz];
      // 1 小物＝箱の集まり：近接する箱は同じ小物として数えるため、箱ごとではなく中心の格子で重複を除く
      const hits = propBoxes.filter((q) => q.y0 < 0.5 && overlap(q, c));
      const cells = new Set(hits.map((q) => `${Math.round((q.x0 + q.x1) / 4)},${Math.round((q.z0 + q.z1) / 4)}`));
      if (cells.size > 2) bad.push(`${r.id}: ${cells.size} props in the center`);
    }
    expect(bad).toEqual([]);
  });
  it('non-fight rooms are densely furnished', () => {
    const count = (id: string) => { const r = plan.rooms.find((q) => q.id === id)!; return propBoxes.filter((q) => q.x0 >= r.x0 && q.x1 <= r.x1 && q.z0 >= r.z0 && q.z1 <= r.z1).length; };
    for (const id of ['L1', 'L2', 'RL']) expect(count(id), id).toBeGreaterThanOrEqual(8);
  });
  it('doorways have no props within 3 m', () => {
    expect(plan.doors.length).toBeGreaterThan(10);
    const bad: string[] = [];
    for (const d of plan.doors) {
      const zone: [number, number, number, number] = [d[0] - 3, d[1] + 3, d[2] - 3, d[3] + 3];
      for (const q of propBoxes) if (q.y0 < 0.5 && overlap(q, zone)) bad.push(`door [${d}] vs prop [${q.x0.toFixed(1)},${q.x1.toFixed(1)}]x[${q.z0.toFixed(1)},${q.z1.toFixed(1)}]`);
    }
    expect(bad).toEqual([]);
  });
  it('big enemies fit: every fight room keeps a >= 4 m clear lane (props cover < half of the width at any cross-section)', () => {
    const bad: string[] = [];
    for (const r of plan.rooms) {
      if (!FIGHT_ROOMS.includes(r.id)) continue;
      // x/z 方向に 1m 刻みで断面を切り、床上の小物の占有幅を差し引いた最大の連続した空きが 4m 以上あるか
      for (const axis of ['x', 'z'] as const) {
        const lo = axis === 'x' ? r.z0 : r.x0, hi = axis === 'x' ? r.z1 : r.x1;
        const a0 = axis === 'x' ? r.x0 : r.z0, a1 = axis === 'x' ? r.x1 : r.z1;
        if (hi - lo < 4.5 || a1 - a0 < 4.5) continue;
        // 壁沿いの小物が長手方向に並ぶ端（壁から 3m 以内）は除く
        for (let u = a0 + 3; u < a1 - 3; u += 1) {
          const spans = propBoxes
            .filter((q) => q.y0 < 0.5 && (axis === 'x' ? q.x0 < u && q.x1 > u && q.z1 > lo && q.z0 < hi : q.z0 < u && q.z1 > u && q.x1 > lo && q.x0 < hi))
            .map((q) => (axis === 'x' ? [Math.max(q.z0, lo), Math.min(q.z1, hi)] : [Math.max(q.x0, lo), Math.min(q.x1, hi)]))
            .sort((p, q) => p[0] - q[0]);
          let cur = lo, best = 0;
          for (const [s0, s1] of spans) { best = Math.max(best, s0 - cur); cur = Math.max(cur, s1); }
          best = Math.max(best, hi - cur);
          if (best < 4) { bad.push(`${r.id} ${axis}=${u.toFixed(1)} free ${best.toFixed(1)}m`); break; }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('floor1 runtime', () => {
  const DT = 1 / 30;
  function mk() {
    const w = createWorld({ pressed: (k: string) => k === 'KeyE', isDown: () => false } as never, new EventBus(), 1);
    w.state = 'playing';
    buildFloor1(w);
    return { w, f: getFloor1(w)! };
  }
  const run = (w: World, sec: number) => { for (let i = 0; i < Math.round(sec / DT); i++) { w.time += DT; updateFloor1(w, DT); updateEnemies(w, DT); updateProjectiles(w, DT); } };
  const tp = (w: World, x: number, z: number, y = 0) => { w.player.pos.set(x, y, z); w.player.vel.set(0, 0, 0); };
  const killAll = (w: World) => w.enemies.forEach((e) => { e.hp = 0; e.status = 'dead'; e.root.visible = false; });
  const gate = (w: World, id: string) => {
    const g = getFloor1(w)!.state.gates[id];
    return g;
  };
  /** ゲートのコライダー（開口の矩形と一致するもの） */
  const gateCol = (w: World, id: string) => {
    const d = getFloor1(w)!.plan.gates.find((q) => q.id === id)!;
    return w.colliders.find((c) => c.tag === 'gate' && Math.abs(c.min.x - d.x0) < 1e-6 && Math.abs(c.min.z - d.z0) < 1e-6 && Math.abs(c.max.x - d.x1) < 1e-6)!;
  };
  const enemiesIn = (w: World, id: string) => {
    const z = getFloor1(w)!.plan.zones.find((q) => q.id === id)!;
    return w.enemies.filter((e) => e.pos.x >= z.x0 - 2 && e.pos.x <= z.x1 + 2 && e.pos.z >= z.z0 - 2 && e.pos.z <= z.z1 + 2 && e.status !== 'dead');
  };
  const events = (w: World, name: keyof import('../core/events').GameEvents) => { const l: unknown[] = []; w.events.on(name, ((p: unknown) => l.push(p)) as never); return l; };

  it('start gate stays closed until every start-corridor enemy is dead; one wake wakes them all', () => {
    const { w } = mk();
    run(w, 0.2);
    const st = enemiesIn(w, 'start');
    expect(st.length).toBe(2);
    expect(st.every((e) => !!e.ai.dormant)).toBe(true);
    expect(gateCol(w, 'start').active).toBe(true);
    // 遠くでは起きない
    tp(w, -80, -9.5); run(w, 1.5);
    expect(st.every((e) => !!e.ai.dormant)).toBe(true);
    // 片方の近くまで来ると（もう片方が遠くても）両方起きる
    const near = Math.min(...st.map((e) => e.pos.x)) - 12;
    tp(w, near, -9.5); run(w, 2.5);
    expect(st.every((e) => !e.ai.dormant)).toBe(true);
    expect(gateCol(w, 'start').active).toBe(true);
    st[0].hp = 0; st[0].status = 'dead';
    run(w, 1);
    expect(gateCol(w, 'start').active).toBe(true);
    st[1].hp = 0; st[1].status = 'dead';
    run(w, 2);
    expect(gateCol(w, 'start').active).toBe(false);
    expect(gate(w, 'start')).toBe(true);
  });

  it('the dead-end door closes when the player nears the gear and reopens when the enemies die', () => {
    const { w, f } = mk();
    run(w, 0.2);
    const closes = events(w, 'doorClose'), starts = events(w, 'lockdownStart'), ends = events(w, 'lockdownEnd');
    tp(w, 70, -3); run(w, 0.5);
    expect(gateCol(w, 'dead').active).toBe(false);
    const g = f.plan.gears.find((q) => q.area === '行き止まり')!;
    tp(w, g.x - 4, g.z); run(w, 0.5);
    expect(gateCol(w, 'dead').active).toBe(true);
    expect(closes.length).toBe(1);
    expect(starts.length).toBe(1);
    run(w, 3);
    const foes = enemiesIn(w, 'dead');
    expect(foes.length).toBeGreaterThanOrEqual(2);
    expect(foes.every((e) => !e.ai.dormant)).toBe(true);
    killAll(w); run(w, 3);
    expect(gateCol(w, 'dead').active).toBe(false);
    expect(ends.length).toBe(1);
  });

  it('right room upper half: doors shut for good, exit opens after the fight, then shuts behind the player', () => {
    const { w } = mk();
    run(w, 0.2);
    tp(w, 40, -31); run(w, 1);
    expect(gateCol(w, 'rlow').active).toBe(false);
    expect(gateCol(w, 'rexit').active).toBe(true);
    tp(w, 54, -49.5); run(w, 0.5);
    expect(gateCol(w, 'rmid').active).toBe(false);
    tp(w, 54, -56); run(w, 0.5);
    expect(gateCol(w, 'rmid').active).toBe(true);
    expect(gateCol(w, 'rlow').active).toBe(true);
    expect(gateCol(w, 'rexit').active).toBe(true);
    run(w, 3);
    const foes = enemiesIn(w, 'RU');
    expect(foes.length).toBeGreaterThanOrEqual(3);
    expect(foes.every((e) => !e.ai.dormant)).toBe(true);
    killAll(w); run(w, 2.5);
    expect(gateCol(w, 'rexit').active).toBe(false);
    expect(gateCol(w, 'rmid').active).toBe(false);
    expect(gateCol(w, 'rlow').active).toBe(true);           // 下の入口は閉じたまま
    tp(w, 15, -63); run(w, 2);                              // 大広間へ戻った
    expect(gateCol(w, 'rexit').active).toBe(true);
  });

  it('elevator approach without power: toast, no comm, west gate opens', () => {
    const { w } = mk();
    run(w, 0.2);
    const comm = events(w, 'comm');
    expect(gateCol(w, 'l2').active).toBe(true);
    tp(w, 0, -72); run(w, 1.2);
    expect(w.toasts.some((t) => t.text.includes('電源が入っていない'))).toBe(true);
    expect(comm.length).toBe(0);
    expect(gateCol(w, 'l2').active).toBe(false);
    expect(getFloor1(w)!.state.powered).toBe(false);
  });

  it('power device: a player bullet powers it', () => {
    const { w, f } = mk();
    run(w, 0.2);
    const P = f.plan.power;
    spawnProjectile(w, { pos: new THREE.Vector3(P.x - 6, P.y, P.z), vel: new THREE.Vector3(60, 0, 0), damage: 5, owner: 'player' });
    run(w, 0.4);
    expect(f.state.powered).toBe(true);
    expect(f.state.powerVia).toBe('shot');
    expect(w.toasts.some((t) => t.text.includes('エレベーターに電力が戻った'))).toBe(true);
  });

  it('power device: the absorb arm feeds it and costs 1 energy', () => {
    const { w, f } = mk();
    run(w, 0.2);
    initAbsorb(w);
    const P = f.plan.power;
    w.player.energy = 50;
    w.aimOrigin.set(P.x - 6, P.y, P.z); w.aimDir.set(1, 0, 0);
    for (let i = 0; i < 20 && !f.state.powered; i++) { w.time += DT; updateAbsorb(w, DT); updateFloor1(w, DT); }
    expect(f.state.powered).toBe(true);
    expect(f.state.powerVia).toBe('arm');
    expect(w.player.energy).toBeCloseTo(49, 3);
  });

  it('arm feeding with no energy does nothing', () => {
    const { w, f } = mk();
    run(w, 0.2);
    initAbsorb(w);
    const P = f.plan.power;
    w.player.energy = 0.5;
    w.aimOrigin.set(P.x - 6, P.y, P.z); w.aimDir.set(1, 0, 0);
    for (let i = 0; i < 20; i++) { w.time += DT; updateAbsorb(w, DT); updateFloor1(w, DT); }
    expect(f.state.powered).toBe(false);
  });

  it('lower-left trap springs only after power, when returning from the side room', () => {
    const { w, f } = mk();
    run(w, 0.2);
    tp(w, -42, -28); run(w, 1);                               // 電源前は何も起きない
    expect(gateCol(w, 'l3n').active).toBe(false);
    expect(f.state.fights.L3).toBe('idle');
    const P = f.plan.power;
    spawnProjectile(w, { pos: new THREE.Vector3(P.x - 6, P.y, P.z), vel: new THREE.Vector3(60, 0, 0), damage: 5, owner: 'player' });
    run(w, 0.4);
    expect(f.state.powered).toBe(true);
    tp(w, -42, -28); run(w, 0.5);                             // まだ脇の部屋に入っていない
    expect(f.state.fights.L3).toBe('idle');
    tp(w, -27, -28); run(w, 0.3);
    tp(w, -39, -28); run(w, 0.5);
    expect(f.state.fights.L3).toBe('active');
    expect(gateCol(w, 'l3n').active).toBe(true);
    expect(gateCol(w, 'side').active).toBe(true);
    run(w, 3);
    const foes = enemiesIn(w, 'L3');
    expect(foes.length).toBeGreaterThanOrEqual(2);
    expect(foes.every((e) => !e.ai.dormant)).toBe(true);
    killAll(w); run(w, 3);
    expect(gateCol(w, 'l3n').active).toBe(false);
    expect(gateCol(w, 'side').active).toBe(false);
  });

  it('elevator fight starts on approach after power; the elevator opens only once it is cleared', () => {
    const { w, f } = mk();
    run(w, 0.2);
    const door = w.colliders.find((c) => c.tag === 'elevatorDoor')!;
    tp(w, 0, -72); run(w, 0.5);
    expect(f.state.fights.final).toBe('idle');                // 電源なしでは始まらない
    const P = f.plan.power;
    spawnProjectile(w, { pos: new THREE.Vector3(P.x - 6, P.y, P.z), vel: new THREE.Vector3(60, 0, 0), damage: 5, owner: 'player' });
    tp(w, -20, -20); run(w, 12);                              // ケーブルが光り終わる
    expect(f.state.fights.final).toBe('idle');
    expect(door.active).toBe(true);
    tp(w, 0, -66); run(w, 0.5);
    expect(f.state.fights.final).toBe('active');
    run(w, 4);
    const foes = enemiesIn(w, 'final');
    expect(foes.map((e) => e.kind).sort()).toEqual(['crawler', 'crawler', 'gunner', 'heavy']);
    expect(foes.every((e) => !e.ai.dormant)).toBe(true);
    expect(door.active).toBe(true);
    killAll(w); run(w, 3);
    expect(f.state.fights.final).toBe('done');
    expect(door.active).toBe(false);
    tp(w, (f.plan.elevator.x0 + f.plan.elevator.x1) / 2, (f.plan.elevator.z0 + f.plan.elevator.z1) / 2);
    run(w, 1.5);
    expect(w.level.bossDefeated).toBe(true);
  });

  it('LOCKDOWN.enabled=false keeps the doors working but skips the alarm lights', () => {
    LOCKDOWN.enabled = false;
    try {
      const { w } = mk();
      run(w, 0.2);
      const g = getFloor1(w)!;
      tp(w, 54, -56); run(w, 1);
      expect(g.state.lockdown).toBe(true);
      expect(gateCol(w, 'rmid').active).toBe(true);
      const beacon = w.scene.children.find((c) => (c as THREE.PointLight).isPointLight && (c as THREE.PointLight).distance === 26) as THREE.PointLight;
      expect(beacon.intensity).toBe(0);
    } finally { LOCKDOWN.enabled = true; }
  });
  it('lockdown beacon lights up while a trap is active and fades after', () => {
    const { w } = mk();
    run(w, 0.2);
    tp(w, 54, -56); run(w, 1.5);
    const beacon = w.scene.children.find((c) => (c as THREE.PointLight).isPointLight && (c as THREE.PointLight).distance === 26) as THREE.PointLight;
    expect(getFloor1(w)!.state.lockdown).toBe(true);
    expect(beacon.intensity).toBeGreaterThan(0);
    killAll(w); run(w, 6);
    expect(getFloor1(w)!.state.lockdown).toBe(false);
    expect(beacon.intensity).toBe(0);
  });

  it('gears are collected by touch and counted', () => {
    const { w } = mk();
    const f = getFloor1(w)!;
    for (const g of f.plan.gears.slice(0, 3)) {
      w.player.pos.set(g.x, g.y - 1.1, g.z);
      updateFloor1(w, 1 / 30);
    }
    expect(w.level.data.gears).toBe(3);
    expect(w.toasts.some((t) => t.text.includes('強化素材（歯車）を入手 ×3'))).toBe(true);
  });
});
