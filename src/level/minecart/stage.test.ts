import { describe, expect, it } from 'vitest';
import { MAX_GAP, MC } from './constants';
import { STAGE, buildStage, type Stage } from './stage';
import { SIM_DT, cloneState, cpAt, createState, stepSim, type McInput, type McState } from './sim';

const FRAME_X = MC.speed * SIM_DT;
const NONE: McInput = { jump: false, crouch: false, fire: false, aimX: 0, aimY: 0 };
const mainRails = (s: Stage) => s.rails.filter((r) => !r.upper);

/** 高さ h を超えている時間（平地ジャンプ） */
const timeAbove = (h: number): number => {
  const disc = MC.jumpV ** 2 - 2 * MC.gravity * h;
  return disc <= 0 ? 0 : (2 * Math.sqrt(disc)) / MC.gravity;
};
const APEX = MC.jumpV ** 2 / (2 * MC.gravity);

/** 平地のレールから、ちょうど届く最大ギャップ（実シミュレーションで測る） */
function simulatedMaxGap(): number {
  let best = 0;
  for (let g = 5; g < 9; g += 0.05) {
    const stage = buildStage([{ t: 'gap', x0: 20, x1: 20 + g }, { t: 'goal', x: 60 }]);
    let ok = false;
    for (let off = -2; off <= 2 && !ok; off += 0.01) {
      const st = createState(stage, cpAt(10));
      let jumped = false;
      for (let i = 0; i < 600 && !st.dead && !st.cleared; i++) {
        const j = !jumped && st.x >= 20 + MC.wheel + off;
        if (j) jumped = true;
        stepSim(st, stage, { ...NONE, jump: j });
      }
      if (st.cleared) ok = true;
    }
    if (ok) best = g; else break;
  }
  return best;
}

// ---------------------------------------------------------------- ボット（先読みで「ぎりぎり最後」に跳ぶ）
/** ドローンの位置（t 秒後） */
const dronePos = (e: McState['enemies'][number], st: McState, t: number) => ({ x: e.x + e.vx * t, y: e.baseY + Math.sin((st.t + t) * (e.w || 2.2) + e.phase) * (e.amp ?? 0.18) });

/** 基本の方針：機材の下ではしゃがみ、ドローンは狙い撃つ（ジャンプは別に決める） */
function baseInput(st: McState, stage: Stage): McInput {
  const ahead = st.x + st.vx * 0.25;
  const crouch = stage.ceils.some((c) => ahead + MC.halfW > c.x0 && st.x - MC.halfW < c.x1 && st.y + MC.standH > c.bottom);
  const ox = st.x + 0.3, oy = st.y + (crouch ? 0.65 : 1.2);
  let aimX = st.x + 10, aimY = oy, fire = false, best = 1e9;
  for (const e of st.enemies) {
    if (e.kind !== 'drone' || !e.alive || e.dormant) continue;
    const d = e.x - st.x;
    if (d < 0 || d > 15 || d >= best) continue;
    best = d;
    // 弾の地面に対する速度 = 向き*shotSpeed + カートの速度。命中までの時間 t を繰り返しで求める
    let t = d / MC.shotSpeed;
    for (let k = 0; k < 8; k++) {
      const p = dronePos(e, st, t);
      t = Math.hypot(p.x - ox - st.vx * t, p.y - oy) / MC.shotSpeed;
    }
    const p = dronePos(e, st, t);
    const dx = (p.x - ox) / t - st.vx, dy = (p.y - oy) / t;
    const l = Math.hypot(dx, dy) || 1;
    aimX = ox + (dx / l) * 10; aimY = oy + (dy / l) * 10;
    fire = true;
  }
  return { jump: false, crouch, fire, aimX, aimY };
}

/** ジャンプなしで frames フレーム、被弾も死亡もしなければ true */
function trialNone(st0: McState, stage: Stage, frames = 72): boolean {
  const st = cloneState(st0);
  const hp = st.hp;
  for (let i = 0; i < frames; i++) {
    stepSim(st, stage, baseInput(st, stage));
    if (st.dead || st.hp < hp) return false;
    if (st.cleared) return true;
  }
  return true;
}
/** 先頭でジャンプして、被弾も死亡もせず着地するまで進めた状態。失敗なら null */
function landFrom(st0: McState, stage: Stage, jumpFirst = true): McState | null {
  const st = cloneState(st0);
  const hp = st.hp;
  let jumped = false;
  for (let i = 0; i < 130; i++) {
    const inp = baseInput(st, stage);
    inp.jump = jumpFirst && i === 0;
    stepSim(st, stage, inp);
    if (st.dead || st.hp < hp) return null;
    if (st.events.includes('jump')) jumped = true;
    if (st.cleared) return st;
    if (jumped && st.grounded) return st;
  }
  return null;
}
/** 着地した状態から先も詰まないか（すぐ次のジャンプで救えるなら OK。depth 回まで） */
function okAfter(S: McState, stage: Stage, depth: number): boolean {
  if (S.cleared) return true;
  if (!trialNone(S, stage, 12)) return false; // 障害物の直前に着地する『手前の小ジャンプ』は解にしない
  if (trialNone(S, stage, 36)) return true;
  if (depth === 0) return false;
  const c = cloneState(S);
  const hp = c.hp;
  for (let k = 0; k < 45; k++) {
    if (k % 3 === 0 && c.grounded) { const L = landFrom(c, stage); if (L && okAfter(L, stage, depth - 1)) return true; }
    stepSim(c, stage, baseInput(c, stage));
    if (c.dead || c.hp < hp) return false;
  }
  return false;
}
const trialJump = (st: McState, stage: Stage): boolean => { const L = landFrom(st, stage); return !!L && okAfter(L, stage, 2); };

/** これから k フレーム待って跳ぶ、のうち成功する k を調べ、いちばん長く続く区間（タイミングの窓）の最後のフレームを選ぶ */
function makePlan(st0: McState, stage: Stage): { wait: number; frames: number } | null {
  const c = cloneState(st0);
  const hp = c.hp;
  const ok: boolean[] = [];
  for (let k = 0; k < 75; k++) {
    ok.push(c.grounded && trialJump(c, stage));
    stepSim(c, stage, baseInput(c, stage));
    if (c.dead || c.hp < hp) break;
  }
  let best: { wait: number; frames: number } | null = null;
  for (let k = 0; k < ok.length; k++) {
    if (!ok[k]) continue;
    let e = k;
    while (e + 1 < ok.length && ok[e + 1]) e++;
    if (!best || e - k + 1 > best.frames) best = { wait: e, frames: e - k + 1 };
    k = e;
  }
  return best;
}

interface Bot { plan: { wait: number; frames: number } | null }
interface RunResult { st: McState; windows: { x: number; frames: number }[]; jumps: number[]; log: string[] }
/** ボットを 1 フレーム進める。forceJump なら、地面にいるとき今のフレームで余分にジャンプする */
function botFrame(st: McState, stage: Stage, bot: Bot, res: RunResult, forceJump = false): void {
  const inp = baseInput(st, stage);
  if (st.grounded && !bot.plan && !trialNone(st, stage)) {
    bot.plan = makePlan(st, stage);
    if (bot.plan) res.windows.push({ x: st.x + (bot.plan.wait - bot.plan.frames + 1) * FRAME_X, frames: bot.plan.frames });
  }
  if (bot.plan) {
    if (bot.plan.wait <= 0 && st.grounded) { inp.jump = true; res.jumps.push(st.x); bot.plan = null; } else bot.plan.wait--;
  }
  if (forceJump && st.grounded) { inp.jump = true; bot.plan = null; }
  stepSim(st, stage, inp);
  if (st.events.includes('hit')) res.log.push(`hit@${st.x.toFixed(1)}`);
}
function runBot(stage: Stage, from?: McState, stopX = Infinity): RunResult {
  const st = from ?? createState(stage);
  const res: RunResult = { st, windows: [], jumps: [], log: [] };
  const bot: Bot = { plan: null };
  for (let i = 0; i < 60 * 200 && !st.cleared && !st.dead && st.x < stopX; i++) botFrame(st, stage, bot, res);
  return res;
}

/** 歯車ボット：基本のボットに『余分なジャンプを1回』足して、歯車が取れる（かつ死なない）タイミングを探す */
function findGearRoute(stage: Stage, gi: number): { startX: number; forceX: number; hits: number } | null {
  const g = stage.gears[gi];
  const cpx = [...stage.checks].reverse().find((c) => c < g.x - 14) ?? 0;
  const base = createState(stage, cpAt(cpx));
  // 歯車の手前 18 〜 2 の範囲で、1フレームずつ『ここで余分に跳ぶ』を試す
  const bot: Bot = { plan: null };
  const res: RunResult = { st: base, windows: [], jumps: [], log: [] };
  while (base.x < g.x - 18 && !base.dead) botFrame(base, stage, bot, res);
  for (let f = 0; f < 150 && base.x < g.x + 1 && !base.dead; f++) {
    const st = cloneState(base);
    const b2: Bot = { plan: bot.plan ? { ...bot.plan } : null };
    const r2: RunResult = { st, windows: [], jumps: [], log: [] };
    const forceX = st.x;
    botFrame(st, stage, b2, r2, true);
    for (let i = 0; i < 400 && !st.dead && !st.cleared && st.x < g.x + 16; i++) botFrame(st, stage, b2, r2);
    if (st.pickedGears.has(gi) && !st.dead) return { startX: cpx, forceX, hits: st.hits };
    botFrame(base, stage, bot, res);
  }
  return null;
}

describe('トロッコ面の物理', () => {
  it('最大ギャップが計算どおり（実シミュレーションとも一致）', () => {
    expect(MAX_GAP).toBeCloseTo(MC.speed * ((2 * MC.jumpV) / MC.gravity) + 2 * MC.wheel, 5);
    const sim = simulatedMaxGap();
    expect(sim).toBeGreaterThan(MAX_GAP - 0.5);
    expect(sim).toBeLessThanOrEqual(MAX_GAP + 0.01);
  });

  it('壁に正面からぶつかると激突、段差の壁も同じ。下がる段差は落ちるだけ', () => {
    const s1 = buildStage([{ t: 'wall', x: 30, w: 1, h: 1.2, kind: 'crate' }, { t: 'goal', x: 80 }]);
    const a = createState(s1);
    for (let i = 0; i < 600 && !a.dead && !a.cleared; i++) stepSim(a, s1, NONE);
    expect(a.dead).toBe('crash');
    const s2 = buildStage([{ t: 'step', x: 30, y: 1 }, { t: 'goal', x: 80 }]);
    const b = createState(s2);
    for (let i = 0; i < 600 && !b.dead && !b.cleared; i++) stepSim(b, s2, NONE);
    expect(b.dead).toBe('crash');
    const s3 = buildStage([{ t: 'step', x: 30, y: -1.5 }, { t: 'goal', x: 80 }]);
    const c = createState(s3);
    for (let i = 0; i < 900 && !c.dead && !c.cleared; i++) stepSim(c, s3, NONE);
    expect(c.cleared).toBe(true);
  });

  it('上り坂は遅く、下り坂は速い', () => {
    const s = buildStage([{ t: 'ramp', x0: 20, x1: 40, to: 4 }, { t: 'ramp', x0: 80, x1: 100, to: 0 }, { t: 'goal', x: 160 }]);
    const st = createState(s);
    let up = 0, down = 0;
    for (let i = 0; i < 2000 && !st.cleared; i++) {
      stepSim(st, s, NONE);
      if (st.x > 30 && st.x < 38) up = st.vx;
      if (st.x > 88 && st.x < 98) down = st.vx;
    }
    expect(up).toBeLessThan(MC.speed - 1);
    expect(down).toBeGreaterThan(MC.speed + 1);
  });

  it('分岐：下段は上段の下をくぐれる。高いジャンプで上段に乗り、上段の端から下段へ落ちて合流する', () => {
    const s = buildStage([{ t: 'upper', x0: 40, x1: 60, y: 2.7 }, { t: 'goal', x: 100 }]);
    // 何もしない：下段を通って完走（上段の板に当たらない）
    const a = createState(s);
    for (let i = 0; i < 1200 && !a.dead && !a.cleared; i++) stepSim(a, s, NONE);
    expect(a.cleared).toBe(true);
    expect(a.y).toBeLessThan(0.1);
    // 手前で跳ぶ：上段に着地して走り、端から下段へ落ちる
    let reachedUpper = false, landedLower = false;
    for (let f = 0; f < 120 && !(reachedUpper && landedLower); f++) {
      const st = createState(s);
      reachedUpper = false; landedLower = false;
      for (let i = 0; i < 1500 && !st.dead && !st.cleared; i++) {
        stepSim(st, s, { ...NONE, jump: i === 180 + f });
        if (st.grounded && st.y > 2.6 && st.x > 41 && st.x < 59) reachedUpper = true;
        if (reachedUpper && st.grounded && st.y < 0.1 && st.x > 60) landedLower = true;
      }
      if (reachedUpper && st.cleared) break;
    }
    expect(reachedUpper).toBe(true);
    expect(landedLower).toBe(true);
    // 低すぎるジャンプは上段の板の正面に激突
    const low = createState(s);
    for (let i = 0; i < 1500 && !low.dead && !low.cleared; i++) stepSim(low, s, { ...NONE, jump: i === 240 });
    expect(['crash', null]).toContain(low.dead);
  });
});

describe('トロッコ面のステージデータ', () => {
  it('長さと、各種類の数', () => {
    expect(STAGE.goalX).toBeGreaterThanOrEqual(400);
    expect(STAGE.goalX).toBeLessThanOrEqual(500);
    expect(STAGE.goalX / MC.speed).toBeLessThanOrEqual(66);
    expect(STAGE.checks.length).toBeGreaterThanOrEqual(5);
    expect(STAGE.checks.length).toBeLessThanOrEqual(8);
    expect(STAGE.metals.length).toBeGreaterThanOrEqual(80);
    expect(STAGE.drones.length).toBeGreaterThanOrEqual(16);
    expect(STAGE.walls.length).toBeGreaterThanOrEqual(6);
    // 歯車はレア（4〜6）
    expect(STAGE.gears.length).toBeGreaterThanOrEqual(4);
    expect(STAGE.gears.length).toBeLessThanOrEqual(6);
  });

  it('ふつうのギャップは最大幅より十分狭く、ぎりぎりのものは7.0以上で最大幅未満', () => {
    const flatGaps = STAGE.gaps.filter((g) => g.x1 - g.x0 <= 6.5);
    expect(flatGaps.length).toBeGreaterThanOrEqual(5);
    const barely = STAGE.gaps.filter((g) => g.x1 - g.x0 >= 7.0 && g.x1 - g.x0 < MAX_GAP - 0.3);
    expect(barely.length).toBeGreaterThanOrEqual(1);
    for (const g of STAGE.gaps) {
      expect(g.x1 - g.x0, `gap ${g.x0}`).toBeGreaterThan(MC.wheel * 2 + 1);
      expect(g.x1 - g.x0, `gap ${g.x0}`).toBeLessThan(MAX_GAP + 1.4); // 下り坂ボーナス込み
    }
  });

  it('壁・段差は、ジャンプで越えられる高さ（滞空時間が足りる）。落ちる段差・坂もある', () => {
    for (const w of STAGE.walls) {
      expect(w.h, `wall ${w.x}`).toBeLessThanOrEqual(APEX - 0.9);
      const span = (w.x1 - w.x0) + 2 * MC.halfW;
      expect(timeAbove(w.h + MC.crashMargin + 0.05) * MC.speed, `wall ${w.x}`).toBeGreaterThan(span + 0.8);
    }
    const m = mainRails(STAGE);
    const steps = m.filter((r, i) => i > 0 && r.x0 === m[i - 1].x1 && r.y0 > m[i - 1].y1 + 0.01);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    for (const r of steps) {
      const H = r.y0 - m[m.indexOf(r) - 1].y1;
      expect(H, `step ${r.x0}`).toBeLessThanOrEqual(APEX - 0.9);
      expect(timeAbove(H + MC.crashMargin + 0.05) * MC.speed, `step ${r.x0}`).toBeGreaterThan(2 * MC.halfW + 0.8);
    }
    expect(m.some((r, i) => i > 0 && r.x0 === m[i - 1].x1 && r.y0 < m[i - 1].y1 - 0.5)).toBe(true);
    expect(m.some((r) => Math.abs(r.y1 - r.y0) > 1)).toBe(true);
  });

  it('機材はしゃがめば通れて、立っていると当たる。長いしゃがみがある', () => {
    expect(STAGE.ceils.length).toBeGreaterThanOrEqual(6);
    for (const c of STAGE.ceils) {
      expect(c.rel, `ceil ${c.x0}`).toBeGreaterThanOrEqual(MC.crouchH + 0.2);
      expect(c.rel, `ceil ${c.x0}`).toBeLessThan(MC.standH - 0.2);
      for (const p of STAGE.pieces) if (p.x1 > c.x0 && p.x0 < c.x1) expect(p.y0, `ceil ${c.x0} on slope`).toBe(p.y1);
    }
    const sorted = [...STAGE.ceils].sort((a, b) => a.x0 - b.x0);
    const runs: number[] = [];
    let s = sorted[0].x0, e = sorted[0].x1;
    for (const c of sorted.slice(1)) {
      if (c.x0 <= e + 0.01) e = Math.max(e, c.x1); else { runs.push(e - s); s = c.x0; e = c.x1; }
    }
    runs.push(e - s);
    expect(runs.filter((r) => r >= 35).length).toBeGreaterThanOrEqual(1);
    expect(runs.filter((r) => r < 15).length).toBeGreaterThanOrEqual(4);
  });

  it('ジャンプが必要な場所の上に天井機材・上段レールが無い。壁→すぐしゃがむ／しゃがむ→すぐ壁の形がある', () => {
    const m = mainRails(STAGE);
    const jumpSpots: { x0: number; x1: number; tag: string }[] = [
      ...STAGE.gaps.map((g) => ({ x0: g.x0, x1: g.x1, tag: `gap ${g.x0}` })),
      ...STAGE.walls.map((w) => ({ x0: w.x0, x1: w.x1, tag: `wall ${w.x}` })),
      ...STAGE.gunners.map((g) => ({ x0: g.x - 0.5, x1: g.x + 0.5, tag: `gunner ${g.x}` })),
      ...m.filter((r, i) => i > 0 && r.y0 > m[i - 1].y1 + 0.01).map((r) => ({ x0: r.x0, x1: r.x0, tag: `step ${r.x0}` })),
    ];
    for (const j of jumpSpots) for (const c of STAGE.ceils) {
      expect(c.x1 < j.x0 - 5 || c.x0 > j.x1 + 5.5, `ceil ${c.x0} vs ${j.tag}`).toBe(true);
    }
    for (const j of jumpSpots) for (const u of STAGE.rails.filter((r) => r.upper)) {
      expect(u.x1 < j.x0 - 3 || u.x0 > j.x1 + 3, `upper ${u.x0} vs ${j.tag}`).toBe(true);
    }
    expect(STAGE.walls.some((w) => STAGE.ceils.some((c) => c.x0 - w.x1 >= 5.5 && c.x0 - w.x1 <= 10))).toBe(true);
    expect(STAGE.ceils.some((c) => STAGE.walls.some((w) => w.x0 - c.x1 >= 4 && w.x0 - c.x1 <= 14))).toBe(true);
  });

  it('連続ジャンプ：4連続ギャップ、ぎりぎり→すぐ次、壁→壁、壁→ガンナー', () => {
    const gs = STAGE.gaps;
    let best = 1, run = 1;
    for (let i = 1; i < gs.length; i++) {
      const rail = gs[i].x0 - gs[i - 1].x1;
      if (rail <= 5 && rail >= 3) run++; else run = 1;
      best = Math.max(best, run);
    }
    expect(best).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < gs.length; i++) { const rail = gs[i].x0 - gs[i - 1].x1; if (rail < 8) expect(rail, `rail before gap ${gs[i].x0}`).toBeGreaterThanOrEqual(3); }
    expect(gs.some((g, i) => g.x1 - g.x0 >= 7.0 && i + 1 < gs.length && gs[i + 1].x0 - g.x1 <= 5)).toBe(true);
    const ws = [...STAGE.walls].sort((a, b) => a.x - b.x);
    expect(ws.some((w, i) => i + 1 < ws.length && ws[i + 1].x - w.x >= 5 && ws[i + 1].x - w.x <= 8)).toBe(true);
    expect(STAGE.gunners.some((g) => STAGE.walls.some((w) => g.x - w.x >= 5 && g.x - w.x <= 10))).toBe(true);
  });

  it('ガンナー・チェックポイント・ゴールは水平な下段レールの上にある。ガンナーは跳び越えられる高さ', () => {
    const flatOn = (x: number) => mainRails(STAGE).some((r) => x >= r.x0 + 1 && x <= r.x1 - 1 && r.y0 === r.y1);
    for (const g of STAGE.gunners) expect(flatOn(g.x), `gunner ${g.x}`).toBe(true);
    for (const c of STAGE.checks) expect(flatOn(c), `check ${c}`).toBe(true);
    expect(flatOn(STAGE.goalX)).toBe(true);
    const span = (MC.gunnerHalfW + MC.halfW) * 2;
    expect(timeAbove(MC.gunnerH + 0.1) * MC.speed).toBeGreaterThan(span + 0.8);
  });

  it('上段レールの下は、立って通れる高さがある。分岐が2つ以上あり、上段に歯車がある', () => {
    const ups = STAGE.rails.filter((r) => r.upper);
    expect(ups.length).toBeGreaterThanOrEqual(2);
    for (const u of ups) {
      expect(u.y0 - (u.thick ?? 0.4), `upper ${u.x0}`).toBeGreaterThanOrEqual(MC.standH + 0.3);
      // 上へ跳び乗れる高さ（頂点より低い）
      expect(u.y0, `upper ${u.x0}`).toBeLessThan(APEX);
      expect(STAGE.gears.some((g) => g.x > u.x0 && g.x < u.x1 && g.y > u.y0), `gear on upper ${u.x0}`).toBe(true);
    }
  });

  it('チェックポイントは進行順', () => {
    for (let i = 1; i < STAGE.checks.length; i++) expect(STAGE.checks[i]).toBeGreaterThan(STAGE.checks[i - 1]);
  });

  it('何もしないと途中で失敗する', () => {
    const st = createState(STAGE);
    for (let i = 0; i < 60 * 60 && !st.dead; i++) stepSim(st, STAGE, NONE);
    expect(st.dead).not.toBeNull();
    expect(st.x).toBeLessThan(100);
  });
});

describe('ボットによるステージ通し', () => {
  const run = runBot(STAGE);

  it('ジャンプ・しゃがみ・射撃だけで、歯車に寄り道せずゴールまでクリアできる（被弾は3回まで）', () => {
    expect(run.st.dead, `dead=${run.st.dead} @${run.st.x.toFixed(1)} ${run.log.join(',')}`).toBeNull();
    expect(run.st.cleared).toBe(true);
    expect(run.st.hits, run.log.join(',')).toBeLessThanOrEqual(3);
    // ふつうに走ると歯車は1つも取れない（レア）。メタルはたくさん取れる
    expect([...run.st.pickedGears].map((i) => `#${i}@${STAGE.gears[i].x}`).join(",")).toBe("");
    expect(run.st.metal).toBeGreaterThan(40);
    expect(run.st.kills).toBeGreaterThanOrEqual(10);
  });

  it('すべてのジャンプにタイミングの余裕がある（最低3フレーム）。ぎりぎりのジャンプは狭い', () => {
    expect(run.jumps.length).toBeGreaterThanOrEqual(18);
    const summary = run.windows.map((q) => `${q.x.toFixed(0)}:${q.frames}`).join(' ');
    for (const w of run.windows) expect(w.frames, `jump window @${w.x.toFixed(1)} ${summary}`).toBeGreaterThanOrEqual(3);
    for (const g of STAGE.gaps.filter((q) => q.x1 - q.x0 >= 7.0 && q.x1 - q.x0 < MAX_GAP - 0.3)) {
      const w = run.windows.find((q) => q.x > g.x0 - 8 && q.x < g.x1);
      expect(w, `barely gap ${g.x0}`).toBeDefined();
      expect(w!.frames).toBeLessThanOrEqual(8);
    }
  });

  it('途中のチェックポイントから再開してもクリアできる', () => {
    for (const c of [STAGE.checks[2], STAGE.checks[4], STAGE.checks[STAGE.checks.length - 1]]) {
      const r = runBot(STAGE, createState(STAGE, cpAt(c)));
      expect(r.st.dead, `from ${c}: dead @${r.st.x.toFixed(1)}`).toBeNull();
      expect(r.st.cleared).toBe(true);
    }
  });

  it('歯車ボット：どの歯車も、余分なジャンプ1回の寄り道で取れる（死なずに）', () => {
    expect(STAGE.gears.length).toBeGreaterThan(0);
    STAGE.gears.forEach((g, i) => {
      const r = findGearRoute(STAGE, i);
      expect(r, `gear #${i} (x=${g.x}): ${g.how}`).not.toBeNull();
    });
  }, 120_000);

  it('ドローンは1発で倒れてメタルを落とし、ガンナーは弾を弾く', () => {
    const stage = buildStage([{ t: 'drone', x: 8, y: 1.2, vx: 0, amp: 0.18, w: 2.2 }, { t: 'gunner', x: 40 }, { t: 'goal', x: 100 }]);
    const st = createState(stage);
    const drone = st.enemies.find((e) => e.kind === 'drone')!;
    for (let i = 0; i < 21 && drone.alive; i++) stepSim(st, stage, { jump: false, crouch: false, fire: true, aimX: drone.x, aimY: drone.y });
    expect(drone.alive).toBe(false);
    expect(st.metal).toBeGreaterThanOrEqual(1);
    const st2 = createState(stage, cpAt(30));
    const g = st2.enemies.find((e) => e.kind === 'gunner')!;
    let deflected = false;
    for (let i = 0; i < 40; i++) { stepSim(st2, stage, { jump: false, crouch: false, fire: true, aimX: g.x, aimY: 1.0 }); if (st2.events.includes('deflect')) deflected = true; }
    expect(deflected).toBe(true);
    expect(g.alive).toBe(true);
  });

  it('チェックポイントから再開すると位置・メタル・歯車を引き継ぐ', () => {
    const cp = STAGE.checks[2];
    const b = createState(STAGE, { x: cp, metal: 7, gears: 1, pickedMetal: [1], pickedGears: [0] });
    expect(b.x).toBe(cp);
    expect(b.metal).toBe(7);
    expect(b.gears).toBe(1);
    expect(b.cpCount).toBe(3);
  });
});
