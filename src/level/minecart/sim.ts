/**
 * トロッコ面のシミュレーション（描画・入力に依存しない純粋なロジック）。固定ステップ（SIM_DT）で進める。
 * 描画（render3d.ts）はこの状態を読むだけ。テストからも同じ関数を呼んで、ステージがクリア可能かを確かめる。
 *
 * 座標は x（進行方向）と y（高さ）だけ。y はワールドの絶対値（レールの高さも絶対値）。
 */
import { METAL } from '../../config/balance';
import { MC } from './constants';
import type { Stage, Rail } from './stage';

export const SIM_DT = 1 / 60;

export interface McEnemy {
  id: number;
  kind: 'drone' | 'gunner';
  x: number;
  y: number;
  vx: number;
  baseY: number;
  alive: boolean;
  /** 奇襲ドローン: まだ出現していない */
  dormant: boolean;
  trigger?: number;
  fireT: number;
  phase: number;
  /** ドローンの上下の揺れ（振幅・角速度） */
  amp: number;
  w: number;
  /** 弾かれた/やられた演出用 */
  flash: number;
}
export interface McBullet { x: number; y: number; vx: number; vy: number }
export interface McShot { x: number; y: number; vx: number; vy: number; life: number }
export type McEventName = 'metal' | 'jump' | 'land' | 'shot' | 'kill' | 'deflect' | 'hit' | 'gear' | 'check' | 'fall' | 'crash' | 'clear' | 'enemyShot';
export interface McCheckpoint { x: number; metal: number; gears: number; pickedMetal: number[]; pickedGears: number[] }
/** チェックポイント（または開始地点）の記録を作る */
export const cpAt = (x: number): McCheckpoint => ({ x, metal: 0, gears: 0, pickedMetal: [], pickedGears: [] });
/** 描画用の一瞬の演出（爆発・火花・取得） */
export interface McFx { k: 'kill' | 'deflect' | 'hit' | 'gear' | 'metal' | 'crash' | 'land'; x: number; y: number }
export type McDead = null | 'fall' | 'hit' | 'crash';

export interface McState {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  crouch: boolean;
  hp: number;
  invuln: number;
  /** 集めたメタル（ふつうの回収物） */
  metal: number;
  /** 集めた歯車（レア。寄り道でしか取れない） */
  gears: number;
  pickedMetal: Set<number>;
  pickedGears: Set<number>;
  enemies: McEnemy[];
  bullets: McBullet[];
  shots: McShot[];
  shotCd: number;
  jumpBuf: number;
  cp: McCheckpoint;
  cpCount: number;
  dead: McDead;
  deadT: number;
  cleared: boolean;
  clearT: number;
  /** 描画用: 直近フレームで起きたイベント */
  events: McEventName[];
  fx: McFx[];
  /** 統計 */
  hits: number;
  kills: number;
  /** 倒した敵からもらったメタル（統計） */
  metalFromKills: number;
  /** 描画用: 車輪の回転 */
  wheelRot: number;
  /** 描画用: 足元の坂の傾き（dy/dx） */
  grade: number;
}
export interface McInput {
  /** このステップでジャンプを押した瞬間 */
  jump: boolean;
  crouch: boolean;
  fire: boolean;
  /** 照準（ワールド座標） */
  aimX: number;
  aimY: number;
}
export const NO_INPUT: McInput = { jump: false, crouch: false, fire: false, aimX: 0, aimY: 0 };

// ---------------------------------------------------------------- 地面
const lerpRail = (r: Rail, x: number): number => {
  if (r.x1 <= r.x0) return r.y1;
  const k = Math.max(0, Math.min(1, (x - r.x0) / (r.x1 - r.x0)));
  return r.y0 + (r.y1 - r.y0) * k;
};
const gradeOf = (r: Rail): number => (r.x1 > r.x0 ? (r.y1 - r.y0) / (r.x1 - r.x0) : 0);

/**
 * 走っている最中の地面。同じ x に複数のレール（上段・下段）があるので、機体の高さ y にいちばん近い面を選ぶ（0.3 以内）。
 * 中心がレール上ならその高さ、無ければ車輪が乗っているレール（ギャップの縁）。無ければ null
 * y を省略すると、いちばん低い面
 */
export function groundAt(stage: Stage, x: number, y?: number): { y: number; grade: number } | null {
  const pick = (cands: { y: number; grade: number }[]): { y: number; grade: number } | null => {
    if (!cands.length) return null;
    if (y === undefined) return cands.reduce((a, b) => (b.y < a.y ? b : a));
    const near = cands.filter((c) => Math.abs(c.y - y) <= 0.3);
    return near.length ? near.reduce((a, b) => (Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a)) : null;
  };
  const center: { y: number; grade: number }[] = [];
  for (const r of stage.rails) if (x >= r.x0 && x <= r.x1) center.push({ y: lerpRail(r, x), grade: gradeOf(r) });
  const c = pick(center);
  if (c) return c;
  const wheel: { y: number; grade: number }[] = [];
  for (const r of stage.rails) if (x + MC.wheel >= r.x0 && x - MC.wheel <= r.x1) wheel.push({ y: lerpRail(r, x), grade: gradeOf(r) });
  return pick(wheel);
}

/** 空中から降りてきたとき、足元に着地できるレールの高さ（車輪が乗れて、機体が上にあるもののうち最も高い面）。無ければ null */
export function landingAt(stage: Stage, x: number, y: number): { y: number; grade: number } | null {
  let best: { y: number; grade: number } | null = null;
  for (const r of stage.rails) {
    if (x + MC.wheel >= r.x0 && x - MC.wheel <= r.x1) {
      const gy = lerpRail(r, x);
      if (gy <= y + 0.15 && (!best || gy > best.y)) best = { y: gy, grade: gradeOf(r) };
    }
  }
  return best;
}

export const slopeMult = (grade: number): number => 1 - Math.max(-MC.slopeMax, Math.min(MC.slopeMax, grade * MC.slopeK));

// ---------------------------------------------------------------- 生成
export function makeEnemies(stage: Stage): McEnemy[] {
  const list: McEnemy[] = [];
  let id = 0;
  for (const d of stage.drones) {
    list.push({ id: id++, kind: 'drone', x: d.x, y: d.y, baseY: d.y, vx: d.vx, alive: true, dormant: d.trigger !== undefined, trigger: d.trigger, fireT: 0, phase: id * 1.7, flash: 0, amp: d.amp, w: d.w });
  }
  for (const g of stage.gunners) {
    list.push({ id: id++, kind: 'gunner', x: g.x, y: g.y, baseY: g.y, vx: 0, alive: true, dormant: false, fireT: MC.gunnerFirstDelay, phase: 0, flash: 0, amp: 0, w: 0 });
  }
  return list;
}

export function createState(stage: Stage, cp?: McCheckpoint): McState {
  const start: McCheckpoint = cp ?? cpAt(0);
  const g = groundAt(stage, start.x);
  return {
    t: 0, x: start.x, y: g ? g.y : 0, vx: MC.speed, vy: 0, grounded: true, crouch: false,
    hp: MC.hp, invuln: 0, metal: start.metal, gears: start.gears, pickedMetal: new Set(start.pickedMetal), pickedGears: new Set(start.pickedGears),
    // チェックポイントより後ろの敵だけ復活（手前の敵は、すでに通り過ぎている）
    enemies: makeEnemies(stage).filter((e) => (e.trigger ?? e.x) >= start.x - 6),
    bullets: [], shots: [], shotCd: 0, jumpBuf: 0,
    cp: start, cpCount: stage.checks.filter((c) => c <= start.x).length,
    dead: null, deadT: 0, cleared: false, clearT: 0, events: [], fx: [], hits: 0, kills: 0, metalFromKills: 0, wheelRot: 0, grade: 0,
  };
}

/** 先読み（ボット・テスト用）のための複製 */
export function cloneState(st: McState): McState { return structuredClone(st); }

export const playerH = (st: Pick<McState, 'crouch'>): number => (st.crouch ? MC.crouchH : MC.standH);

/** 円と軸平行ボックスの当たり */
function circleBox(cx: number, cy: number, r: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const nx = Math.max(x0, Math.min(cx, x1));
  const ny = Math.max(y0, Math.min(cy, y1));
  return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
}

function hurt(st: McState): void {
  if (st.invuln > 0 || st.dead) return;
  st.hp--;
  st.hits++;
  st.invuln = MC.invuln;
  st.events.push('hit');
  st.fx.push({ k: 'hit', x: st.x, y: st.y + 1 });
  if (st.hp <= 0) { st.dead = 'hit'; st.deadT = 0; }
}

function crash(st: McState, kind: 'crash' | 'fall'): void {
  if (st.dead) return;
  st.dead = kind; st.deadT = 0;
  st.events.push(kind);
  st.fx.push({ k: 'crash', x: st.x + MC.halfW, y: st.y + 0.8 });
}

export function stepSim(st: McState, stage: Stage, inp: McInput, dt = SIM_DT): void {
  st.events.length = 0;
  st.fx.length = 0;
  st.t += dt;
  for (const e of st.enemies) if (e.flash > 0) e.flash -= dt;
  if (st.dead) {
    st.deadT += dt;
    if (st.dead === 'fall') { st.vy -= MC.gravity * dt; st.y += st.vy * dt; }
    return;
  }

  if (st.cleared) {
    // ゴール後：ゆっくり減速して駅に止まる
    st.clearT += dt;
    const k = Math.max(0, 1 - st.clearT / MC.clearHold);
    st.vx = MC.speed * k * k;
    st.x += st.vx * dt;
    st.wheelRot += st.vx * dt * 2;
    st.invuln = 0;
    return;
  }

  // ---- 走行（接地中は坂で速度が変わる。空中は勢いを保つ）
  if (st.grounded) {
    const target = MC.speed * slopeMult(st.grade);
    st.vx += (target - st.vx) * (1 - Math.exp(-MC.speedRelax * dt));
  }
  st.x += st.vx * dt;
  st.wheelRot += st.vx * dt * 2;
  if (st.invuln > 0) st.invuln -= dt;
  st.crouch = inp.crouch;

  // ---- 接地・ジャンプ・重力
  if (inp.jump) st.jumpBuf = MC.jumpBuffer; else if (st.jumpBuf > 0) st.jumpBuf -= dt;
  const takeoff = (): void => {
    st.grounded = false;
    st.vy = Math.max(MC.jumpV * 0.8, MC.jumpV + st.grade * st.vx);
    st.jumpBuf = 0;
    st.events.push('jump');
  };
  if (st.grounded) {
    const g = groundAt(stage, st.x, st.y);
    if (!g) { st.grounded = false; st.vy = Math.max(0, st.grade * st.vx); } // レールの端・段差を下りた
    else { st.y = g.y; st.grade = g.grade; if (st.jumpBuf > 0) takeoff(); }
  }
  if (!st.grounded) {
    st.vy -= MC.gravity * dt;
    const ny = st.y + st.vy * dt;
    const land = st.vy < 0 ? landingAt(stage, st.x, st.y) : null;
    if (land && ny <= land.y) {
      st.y = land.y; st.vy = 0; st.grounded = true; st.grade = land.grade;
      st.events.push('land'); st.fx.push({ k: 'land', x: st.x, y: st.y });
      if (st.jumpBuf > 0) takeoff();
    } else st.y = ny;
    if (st.y < stage.minY - MC.fallBelow) { crash(st, 'fall'); return; }
  }

  // ---- 壁・段差への激突（正面からぶつかったら即失敗）
  const hh = playerH(st);
  for (const r of stage.rails) {
    if (r.upper) {
      // 上段のレールは厚みのある板。下をくぐるのは OK。手前から正面にぶつかる（高さが足りない）と激突、板の下で跳んで頭をぶつけると被弾
      const bottom = r.y0 - (r.thick ?? 0.4);
      if (st.x + MC.halfW > r.x0 && st.x - MC.halfW < r.x1 && st.y < r.y0 - MC.crashMargin && st.y + hh > bottom) {
        if (st.x < r.x0) { crash(st, 'crash'); return; }
        if (st.vy > 0) { st.vy = 0; hurt(st); }
      }
      continue;
    }
    // レールの左端は「壁の面」。機体の前端が越えていて、まだ後端が越えていないのに、足が壁の上面より下
    if (r.face && st.x + MC.halfW > r.x0 && st.x - MC.halfW < r.x0 && st.y < r.y0 - MC.crashMargin) {
      crash(st, st.y < r.y0 - 2.2 ? 'fall' : 'crash');
      return;
    }
  }
  for (const w of stage.walls) {
    if (st.x + MC.halfW > w.x0 && st.x - MC.halfW < w.x1 && st.y < w.top - MC.crashMargin) { crash(st, 'crash'); return; }
  }

  // ---- 射撃
  if (st.shotCd > 0) st.shotCd -= dt;
  if (inp.fire && st.shotCd <= 0) {
    const ox = st.x + 0.3, oy = st.y + (st.crouch ? 0.65 : 1.2);
    let dx = inp.aimX - ox, dy = inp.aimY - oy;
    const len = Math.hypot(dx, dy);
    if (len < 0.4) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
    st.shots.push({ x: ox, y: oy, vx: dx * MC.shotSpeed + st.vx, vy: dy * MC.shotSpeed, life: MC.shotLife });
    st.shotCd = MC.shotCooldown;
    st.events.push('shot');
  }

  // ---- 敵
  for (const e of st.enemies) {
    if (!e.alive) continue;
    if (e.dormant) {
      if (e.trigger !== undefined && st.x >= e.trigger) { e.dormant = false; e.x = st.x + MC.ambushAhead; }
      continue;
    }
    if (e.kind === 'drone') {
      e.x += e.vx * dt;
      e.y = e.baseY + Math.sin(st.t * (e.w || 2.2) + e.phase) * (e.amp ?? 0.18);
    } else {
      const d = e.x - st.x;
      if (d > 0 && d < MC.gunnerRange) {
        e.fireT -= dt;
        if (e.fireT <= 0) {
          e.fireT = MC.gunnerInterval;
          st.bullets.push({ x: e.x - 0.7, y: e.baseY + MC.gunnerBulletY, vx: -MC.gunnerBulletSpeed, vy: 0 });
          st.events.push('enemyShot');
        }
      }
    }
  }

  // ---- 弾（自機）
  for (const s of st.shots) {
    for (let k = 0; k < 2; k++) {
      s.x += (s.vx * dt) / 2; s.y += (s.vy * dt) / 2;
      for (const e of st.enemies) {
        if (!e.alive || e.dormant || s.life <= 0) continue;
        if (e.kind === 'drone') {
          if (Math.hypot(s.x - e.x, s.y - e.y) < MC.droneRadius + MC.shotRadius) { e.alive = false; s.life = 0; st.kills++; st.events.push('kill'); st.fx.push({ k: 'kill', x: e.x, y: e.y }); st.metal += METAL.drop.drone; st.metalFromKills++; }
        } else if (s.x > e.x - MC.gunnerHalfW - MC.shotRadius && s.x < e.x + MC.gunnerHalfW + MC.shotRadius && s.y > e.baseY - 0.1 && s.y < e.baseY + MC.gunnerH + MC.shotRadius) {
          s.life = 0; e.flash = 0.15; st.events.push('deflect'); st.fx.push({ k: 'deflect', x: s.x, y: s.y });
        }
      }
    }
    // 敵の弾は撃ち落とせる
    for (const b of st.bullets) {
      if (s.life > 0 && Math.hypot(s.x - b.x, s.y - b.y) < MC.bulletRadius + MC.shotRadius + 0.15) { s.life = 0; b.x = -1e9; st.events.push('kill'); st.fx.push({ k: 'kill', x: s.x, y: s.y }); }
    }
    s.life -= dt;
    if (s.y < stage.minY - 8 || s.y > stage.maxY + 14) s.life = 0;
  }
  st.shots = st.shots.filter((s) => s.life > 0);

  // ---- 弾（敵）
  for (const b of st.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
  st.bullets = st.bullets.filter((b) => b.x > st.x - 8 && b.x > -1e8);

  // ---- 被弾判定
  const px0 = st.x - MC.halfW, px1 = st.x + MC.halfW, py0 = st.y, py1 = st.y + playerH(st);
  for (const c of stage.ceils) {
    if (px1 > c.x0 && px0 < c.x1 && py1 > c.bottom) hurt(st);
  }
  for (const e of st.enemies) {
    if (!e.alive || e.dormant) continue;
    if (e.kind === 'drone') {
      if (circleBox(e.x, e.y, MC.droneRadius, px0, py0, px1, py1)) {
        if (st.invuln <= 0) { e.alive = false; e.flash = 0.2; st.fx.push({ k: 'kill', x: e.x, y: e.y }); }
        hurt(st);
      }
    } else if (px1 > e.x - MC.gunnerHalfW && px0 < e.x + MC.gunnerHalfW && py0 < e.baseY + MC.gunnerH) hurt(st);
  }
  for (const b of st.bullets) {
    if (circleBox(b.x, b.y, MC.bulletRadius, px0, py0, px1, py1)) {
      b.x = -1e9; // 消す
      hurt(st);
    }
  }
  st.bullets = st.bullets.filter((b) => b.x > -1e8);
  st.enemies = st.enemies.filter((e) => e.alive || e.flash > 0 || e.x > st.x - 4);

  // ---- メタル（ふつうの回収物）と歯車（レア）
  stage.metals.forEach((m, i) => {
    if (st.pickedMetal.has(i)) return;
    if (circleBox(m.x, m.y, MC.metalRadius, px0, py0, px1, py1)) { st.pickedMetal.add(i); st.metal++; st.events.push('metal'); st.fx.push({ k: 'metal', x: m.x, y: m.y }); }
  });
  stage.gears.forEach((g, i) => {
    if (st.pickedGears.has(i)) return;
    if (circleBox(g.x, g.y, MC.gearRadius, px0, py0, px1, py1)) { st.pickedGears.add(i); st.gears++; st.events.push('gear'); st.fx.push({ k: 'gear', x: g.x, y: g.y }); }
  });

  // ---- チェックポイント・ゴール
  while (st.cpCount < stage.checks.length && st.x >= stage.checks[st.cpCount]) {
    st.cp = { x: stage.checks[st.cpCount], metal: st.metal, gears: st.gears, pickedMetal: [...st.pickedMetal], pickedGears: [...st.pickedGears] };
    st.cpCount++;
    st.events.push('check');
  }
  if (st.x >= stage.goalX) { st.cleared = true; st.clearT = 0; st.events.push('clear'); }
}
