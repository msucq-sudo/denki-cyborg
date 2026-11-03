// ドレインガーディアン（ボス）の純粋なロジック：部位HP・第2形態への切り替え・腕の再生・次の攻撃の選び方。
// three.js にも World にも触らない（単体テストできる）。数値は balance.ts の DRAIN_BOSS。見た目と動きは drainGuard.ts。
import { DRAIN_BOSS } from '../../config/balance';

export type PartId = 'rArm' | 'body' | 'lArm';
export type ArmId = 'rArm' | 'lArm';
export const ARMS: readonly ArmId[] = ['rArm', 'lArm'];
export const PART_LABEL: Record<PartId, string> = { rArm: '右腕', body: '胴体', lArm: '左腕' };
/** ok=ついている／broken=壊れている／regen=再生中（この間は当たらない） */
export type ArmState = 'ok' | 'broken' | 'regen';

export type AttackId = 'missiles' | 'bolt' | 'punch' | 'rush' | 'rain' | 'teleport' | 'beam' | 'teleportRam';

export interface RegenJob { target: ArmId; source: ArmId; t: number; hpTo: number }

export interface GuardState {
  hp: Record<PartId, number>;
  max: Record<PartId, number>;
  arm: Record<ArmId, ArmState>;
  phase: 1 | 2;
  regen: RegenJob | null;
  /** これまでに腕を再生した回数 */
  regens: number;
  dead: boolean;
}

type Cfg = typeof DRAIN_BOSS;

export function createGuard(cfg: Cfg = DRAIN_BOSS): GuardState {
  return {
    hp: { rArm: cfg.hp.rArm, body: cfg.hp.body, lArm: cfg.hp.lArm },
    max: { rArm: cfg.hp.rArm, body: cfg.hp.body, lArm: cfg.hp.lArm },
    arm: { rArm: 'ok', lArm: 'ok' },
    phase: 1, regen: null, regens: 0, dead: false,
  };
}

export const otherArm = (a: ArmId): ArmId => (a === 'rArm' ? 'lArm' : 'rArm');
/** ついている（当たる・攻撃に使える）腕 */
export const armsOk = (g: GuardState): ArmId[] => ARMS.filter((a) => g.arm[a] === 'ok');
export const isArmless = (g: GuardState): boolean => armsOk(g).length === 0;

export interface DamageResult {
  /** 実際に減った量 */
  applied: number;
  /** この一撃で壊れた腕 */
  destroyed: ArmId | null;
  /** この一撃で第2形態に入った */
  phase2: boolean;
  /** この一撃で胴体が 0 になった */
  dead: boolean;
  /** この一撃で腕の再生が始まった */
  regenStarted: boolean;
}

/** 壊れた腕を、残った腕が現HPの giveRatio を渡して再生し始める。条件を満たせば true */
export function tryStartRegen(g: GuardState, cfg: Cfg = DRAIN_BOSS): boolean {
  if (g.regen || g.dead) return false;
  for (const target of ARMS) {
    if (g.arm[target] !== 'broken') continue;
    const source = otherArm(target);
    if (g.arm[source] !== 'ok' || g.hp[source] < cfg.regen.minHp) continue;
    const give = Math.floor(g.hp[source] * cfg.regen.giveRatio);
    if (give <= 0) continue;
    g.hp[source] -= give;
    g.arm[target] = 'regen';
    g.regen = { target, source, t: 0, hpTo: give };
    g.regens++;
    return true;
  }
  return false;
}

/** 部位にダメージ。腕が壊れたら再生を試す。胴体が半分以下で第2形態、0 で撃破 */
export function damagePart(g: GuardState, part: PartId, amount: number, cfg: Cfg = DRAIN_BOSS): DamageResult {
  const r: DamageResult = { applied: 0, destroyed: null, phase2: false, dead: false, regenStarted: false };
  if (g.dead || amount <= 0) return r;
  if (part === 'body') {
    const before = g.hp.body;
    g.hp.body = Math.max(0, before - amount);
    r.applied = before - g.hp.body;
    if (g.hp.body <= 0) { g.dead = true; r.dead = true; }
    else if (g.phase === 1 && g.hp.body <= g.max.body * cfg.phase2At) { g.phase = 2; r.phase2 = true; }
    return r;
  }
  if (g.arm[part] !== 'ok') return r;     // 壊れている・再生中の腕には当たらない
  const before = g.hp[part];
  g.hp[part] = Math.max(0, before - amount);
  r.applied = before - g.hp[part];
  if (g.hp[part] <= 0) {
    g.arm[part] = 'broken';
    r.destroyed = part;
    r.regenStarted = tryStartRegen(g, cfg);
  }
  return r;
}

/** 腕の再生を進める。終わった腕を返す（終わった後、もう片方が壊れていて条件を満たせば続けて再生を始める） */
export function updateRegen(g: GuardState, dt: number, cfg: Cfg = DRAIN_BOSS): ArmId | null {
  const job = g.regen;
  if (!job) return null;
  job.t += dt;
  if (job.t < cfg.regen.time) return null;
  g.arm[job.target] = 'ok';
  g.hp[job.target] = job.hpTo;
  g.regen = null;
  tryStartRegen(g, cfg);
  return job.target;
}

/** 再生の進み 0..1（再生中でなければ 0） */
export const regenProgress = (g: GuardState, cfg: Cfg = DRAIN_BOSS): number => (g.regen ? Math.min(1, g.regen.t / cfg.regen.time) : 0);

// ---------------------------------------------------------------- 攻撃の選び方
export interface PickCtx {
  /** ボスからプレイヤーまでの水平距離 */
  dist: number;
  /** 0..1 の乱数 */
  rand: () => number;
  /** 直前の攻撃（続けて同じ攻撃になりにくくする） */
  last: AttackId | null;
}

/** 今の状態で使える攻撃と重み */
export function attackWeights(g: GuardState, dist: number, cfg: Cfg = DRAIN_BOSS): Partial<Record<AttackId, number>> {
  const w: Partial<Record<AttackId, number>> = {};
  const ok = armsOk(g);
  if (ok.length === 0) {
    // 両腕なし：突進・目玉のビーム・瞬間移動からの体当たり
    w.rush = dist >= cfg.rush.minDist ? 4 : 1.5;
    w.beam = 4;
    w.teleportRam = 3;
    return w;
  }
  const close = dist <= cfg.punch.range;
  if (g.arm.rArm === 'ok') w.missiles = close ? 1.5 : 3;
  if (g.arm.lArm === 'ok') w.bolt = close ? 1.5 : 3;
  if (close) w.punch = 6;
  if (dist >= cfg.rush.minDist) w.rush = 2.2;
  if (g.phase === 2) {
    w.rain = 2.4;
    w.teleport = 2.6;
  }
  return w;
}

export function pickAttack(g: GuardState, c: PickCtx, cfg: Cfg = DRAIN_BOSS): AttackId {
  const w = attackWeights(g, c.dist, cfg);
  const entries = (Object.entries(w) as [AttackId, number][]).map(([id, v]) => [id, id === c.last ? v * 0.15 : v] as [AttackId, number]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let x = c.rand() * total;
  for (const [id, v] of entries) { x -= v; if (x <= 0) return id; }
  return entries[entries.length - 1][0];
}

/** 攻撃と攻撃の間（秒）の範囲 */
export function gapRange(g: GuardState, cfg: Cfg = DRAIN_BOSS): [number, number] {
  return isArmless(g) ? cfg.gap.armless : g.phase === 2 ? cfg.gap.p2 : cfg.gap.p1;
}

// ---------------------------------------------------------------- 場所の選び方
export interface Arena { x0: number; x1: number; z0: number; z1: number }
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** ミサイルの雨の着弾点。nearPlayer の割合はプレイヤーの周り、残りは部屋じゅうに散らす */
export function rainSpots(count: number, player: { x: number; z: number }, arena: Arena, rand: () => number, cfg: Cfg = DRAIN_BOSS): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const near = Math.round(count * cfg.rain.nearPlayer);
  const m = cfg.rain.radius;
  for (let i = 0; i < count; i++) {
    let x: number, z: number;
    if (i < near) {
      const a = rand() * Math.PI * 2, r = (i === 0 ? 0 : 1) * (1.2 + rand() * cfg.rain.spread * 0.5);
      x = player.x + Math.sin(a) * r; z = player.z + Math.cos(a) * r;
    } else {
      x = arena.x0 + rand() * (arena.x1 - arena.x0); z = arena.z0 + rand() * (arena.z1 - arena.z0);
    }
    out.push({ x: clamp(x, arena.x0 + m, arena.x1 - m), z: clamp(z, arena.z0 + m, arena.z1 - m) });
  }
  return out;
}

/**
 * 瞬間移動で現れる場所。behind=true ならプレイヤーの背後（向いている方向の反対側）。
 * playerYaw はこのゲームの yaw（前方 = (-sin yaw, -cos yaw)）
 */
export function teleportSpot(player: { x: number; z: number }, playerYaw: number, behind: boolean, arena: Arena, rand: () => number, cfg: Cfg = DRAIN_BOSS): { x: number; z: number } {
  const fx = -Math.sin(playerYaw), fz = -Math.cos(playerYaw);
  let dx: number, dz: number;
  if (behind) { dx = -fx; dz = -fz; }
  else {
    const a = rand() * Math.PI * 2;
    dx = Math.sin(a); dz = Math.cos(a);
  }
  const m = 3;
  return { x: clamp(player.x + dx * cfg.teleport.dist, arena.x0 + m, arena.x1 - m), z: clamp(player.z + dz * cfg.teleport.dist, arena.z0 + m, arena.z1 - m) };
}
