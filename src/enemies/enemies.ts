import * as THREE from 'three';
import type { Enemy, World } from '../core/types';
import { ENEMIES, BOSS, OVERLOAD, METAL } from '../config/balance';
import type { EnemyKind } from '../config/balance';
import { damagePlayer, playerCenter } from '../core/combat';
import { spawnBurst, spawnFlash, spawnShockwave } from '../core/effects';
import { isTargetable } from '../core/enemyUtil';
import { buildModel, disposeObject, type Model } from './models';
import { fall, faceToward, makeCtx, separate } from './common';
import { updateCrawler, updateDrone, updateGunner, updateHeavy } from './ai';
import { initBossAI, updateBoss } from './boss';
import { KIND_MODULES } from './kinds';
import { makeDormant, updateDormant, type DormantOpts } from './dormant';
import { spawnMetalDrop } from '../core/pickups';

export interface DamageOpts { weak?: boolean; how: 'shot' | 'explosion' | 'absorb'; hitPos?: THREE.Vector3 }
export type OverloadResult = 'none' | 'exploded' | 'shorted';

/** ノックバックの効きやすさ */
const KNOCKBACK_BASE: Partial<Record<EnemyKind, number>> = { drone: 1, crawler: 1, gunner: 0.8, heavy: 0.25, boss: 0 };
function knockbackOf(kind: EnemyKind): number { return KNOCKBACK_BASE[kind] ?? KIND_MODULES[kind]?.knockback ?? 0.5; }
function isFlyer(kind: EnemyKind): boolean { return kind === 'drone' || kind === 'boss' || !!KIND_MODULES[kind]?.flying; }
const DOWN_TIME = 4;
const FLASH_TIME = 0.12;
const BOSS_DRAIN_FLOOR = 0.2;
const BOSS_STUN_DAMAGE_MUL = 1.5;
const OVERLOAD_DECAY = 0.1;      // cap に対する毎秒の自然減少割合
const OVERLOAD_HOLD = 0.2;       // 最後に逆流を受けてからこの秒数は減らない
const BOSS_DEATH_TIME = 2.8;

const WHITE = new THREE.Color(0xffffff);
const RED = new THREE.Color(0xff2a10);
const PHASE_RED = new THREE.Color(0xff2010);
const CYAN = new THREE.Color(0x40e0ff);
const GREY = new THREE.Color(0x555050);

// ------------------------------------------------------------------ spawn
export function spawnEnemy(world: World, kind: EnemyKind, pos: THREE.Vector3, opts?: DormantOpts): Enemy {
  const spec = ENEMIES[kind];
  const model = buildModel(kind);
  model.root.position.copy(pos);
  world.scene.add(model.root);
  model.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).castShadow !== false) o.castShadow = true; });
  const e: Enemy = {
    id: world.nextId++,
    kind,
    root: model.root,
    pos: pos.clone(),
    vel: new THREE.Vector3(),
    radius: spec.radius,
    hp: spec.hp, maxHp: spec.hp,
    status: 'active',
    weakPoints: model.weakPoints,
    tethered: false,
    overload: 0,
    ai: { model, yaw: Math.random() * Math.PI * 2, alert: 0, flash: 0, warn: 0, lastOverload: -10, spin: Math.random() * 6 },
    deadTimer: 0,
  };
  model.root.rotation.y = e.ai.yaw;
  if (kind === 'heavy') e.weakPoints[0].mesh.userData.front = true;
  if (kind === 'boss') {
    initBossAI(world, e);
    e.weakPoints[0].exposed = false;
    e.weakPoints[0].mesh.visible = false;
  }
  world.enemies.push(e);
  // 休眠（コンテナ／天井の中で待機）。ボスは対象外
  if (opts?.dormant && kind !== 'boss') makeDormant(world, e, opts, isFlyer(kind));
  return e;
}

// ------------------------------------------------------------------ damage
function impulse(world: World, e: Enemy, amount: number, from?: THREE.Vector3): void {
  const k = knockbackOf(e.kind);
  if (k <= 0) return;
  const src = from ?? world.player.pos;
  const dx = e.pos.x - src.x, dz = e.pos.z - src.z;
  const d = Math.hypot(dx, dz) || 1;
  const sp = THREE.MathUtils.clamp(amount * 0.12, 0.8, 4) * k;
  e.vel.x += (dx / d) * sp;
  e.vel.z += (dz / d) * sp;
}

function weakMulFor(e: Enemy, hitPos?: THREE.Vector3): number {
  const base = ENEMIES[e.kind].weakMultiplier;
  e.root.updateMatrixWorld();
  if (e.kind === 'heavy' && hitPos && e.weakPoints.length > 1) {
    // 前面の小さい弱点は倍率控えめ（背中が大本命）
    const w0 = e.root.localToWorld(e.weakPoints[0].offset.clone());
    const w1 = e.root.localToWorld(e.weakPoints[1].offset.clone());
    if (hitPos.distanceTo(w0) < hitPos.distanceTo(w1)) return Math.min(base, 2);
  }
  return base;
}

export function checkBossPhase(world: World, e: Enemy): void {
  if (e.kind !== 'boss' || e.ai.phase === 2 || e.status === 'dead' || e.status === 'down') return;
  if (e.hp <= e.maxHp * 0.5) {
    e.ai.phase = 2;
    e.ai.laserT = 4;
    e.ai.atkTimer = 1.5;
    e.ai.summonT = 3;
    e.ai.phaseFlash = 1;
    spawnShockwave(world, e.pos, 0xff4a30, 9, 0.7);
    spawnFlash(world, e.pos, 0xff3a20, 10, 16, 0.4);
    world.events.emit('bossPhase', { phase: 2 });
  }
}

export function damageEnemy(world: World, enemy: Enemy, amount: number, opts: DamageOpts): void {
  if (!isTargetable(enemy)) return;
  let dmg = amount;
  if (opts.weak) dmg *= weakMulFor(enemy, opts.hitPos);
  if (enemy.kind === 'boss' && enemy.status === 'stunned') dmg *= BOSS_STUN_DAMAGE_MUL;
  enemy.hp = Math.max(0, enemy.hp - dmg);
  enemy.ai.flash = FLASH_TIME;
  enemy.ai.alert = Math.max(enemy.ai.alert ?? 0, 5);
  world.events.emit('enemyHit', { pos: (opts.hitPos ?? enemy.pos).clone(), weak: !!opts.weak, damage: dmg });
  if (enemy.hp <= 0) {
    if (opts.how === 'absorb') downEnemy(world, enemy);
    else killEnemy(world, enemy, opts.how, false);
    return;
  }
  impulse(world, enemy, dmg, opts.how === 'explosion' ? opts.hitPos : undefined);
  checkBossPhase(world, enemy);
}

export function drainEnemy(world: World, enemy: Enemy, amount: number): number {
  if (!isTargetable(enemy) || amount <= 0) return 0;
  let allowed = enemy.hp;
  if (enemy.kind === 'boss') allowed = Math.max(0, enemy.hp - enemy.maxHp * BOSS_DRAIN_FLOOR);
  const actual = Math.min(amount, allowed);
  if (actual <= 0) return 0;
  enemy.hp -= actual;
  if (enemy.hp <= 1e-6) {
    enemy.hp = 0;
    downEnemy(world, enemy);
  } else {
    checkBossPhase(world, enemy);
  }
  return actual;
}

/** 吸い切られて停止（崩れ落ちる） */
function downEnemy(world: World, e: Enemy): void {
  e.hp = 0;
  e.status = 'down';
  e.deadTimer = DOWN_TIME;
  e.ai.warn = 0;
  e.ai.state = 'down';
  clearTelegraphs(e);
  const model: Model = e.ai.model;
  for (const m of model.eyeMats) { m.emissiveIntensity = 0; m.emissive.setHex(0x000000); }
  for (const m of model.weakMats) { m.emissiveIntensity = 0; m.opacity = 0.35; m.color.copy(GREY); }
  for (const w of e.weakPoints) w.exposed = false;
  for (const b of model.bodyMats) b.mat.color.copy(b.base).multiplyScalar(0.45);
  e.ai.tilt = Math.random() < 0.5 ? 1 : -1;
  e.ai.collapse = 0;
  world.stats.kills++;
  world.events.emit('enemyKilled', { kind: e.kind, pos: e.pos.clone(), how: 'absorb' });
  spawnBurst(world, e.pos, 0x66e6ff, 10, 3);
  spawnMetalDrop(world, e.kind, e.pos);
}

function clearTelegraphs(e: Enemy): void {
  const p = e.ai.model?.parts;
  if (p?.teleCircle) p.teleCircle.visible = false;
  if (p?.teleStrip) p.teleStrip.visible = false;
  if (e.ai.beam) e.ai.beam.visible = false;
  e.ai.laser = null;
}

/** 撃破（弾・爆発）。小爆発して消える。ボスは大爆発演出 */
function killEnemy(world: World, e: Enemy, how: 'shot' | 'explosion' | 'absorb', instant: boolean): void {
  e.hp = 0;
  e.status = 'dead';
  e.tethered = false;
  clearTelegraphs(e);
  world.stats.kills++;
  world.events.emit('enemyKilled', { kind: e.kind, pos: e.pos.clone(), how });
  spawnMetalDrop(world, e.kind, e.pos); // 倒すとメタルを落とす
  if (e.kind === 'boss') {
    e.deadTimer = BOSS_DEATH_TIME;
    e.ai.deathT = 0;
    e.ai.deathBang = 0;
    for (const w of e.weakPoints) w.exposed = false;
    spawnShockwave(world, e.pos, 0xffd070, 7, 0.8);
    spawnFlash(world, e.pos, 0xffc060, 12, 20, 0.5);
    return;
  }
  e.deadTimer = 0.05;
  e.root.visible = false;
  if (!instant) {
    const r = e.radius;
    spawnShockwave(world, e.pos, 0xffb070, r * 2.2, 0.35);
    spawnFlash(world, e.pos, 0xffa040, 6, 8, 0.2);
    spawnBurst(world, e.pos, 0xffa24d, 16, 5);
    spawnBurst(world, e.pos, 0xfff27a, 8, 3);
  }
}

// ------------------------------------------------------------------ overload
export function overloadEnemy(world: World, enemy: Enemy, amount: number): OverloadResult {
  if (!isTargetable(enemy) || amount <= 0) return 'none';
  const cap = ENEMIES[enemy.kind].overloadCap;
  enemy.overload = Math.min(cap, enemy.overload + amount);
  enemy.ai.lastOverload = world.time;
  if (enemy.overload < cap) return 'none';

  if (enemy.kind === 'boss') {
    enemy.overload = 0;
    enemy.status = 'stunned';
    enemy.ai.stunT = BOSS.shortStun;
    enemy.ai.open = true; enemy.ai.openLeft = 0;
    enemy.weakPoints[0].exposed = true; enemy.weakPoints[0].mesh.visible = true;
    enemy.ai.laser = null;
    clearTelegraphs(enemy);
    enemy.ai.flash = 0.3;
    spawnShockwave(world, enemy.pos, 0x66e6ff, 9, 0.6);
    spawnFlash(world, enemy.pos, 0x88f0ff, 10, 18, 0.35);
    spawnBurst(world, enemy.pos, 0x66e6ff, 30, 7, 0.7);
    world.events.emit('bossShort', { pos: enemy.pos.clone() });
    enemy.hp = Math.max(0, enemy.hp - BOSS.shortDamage);
    if (enemy.hp <= 0) killEnemy(world, enemy, 'explosion', false);
    else checkBossPhase(world, enemy);
    return 'shorted';
  }

  // 爆発
  const pos = enemy.pos.clone();
  const R = OVERLOAD.explosionRadius;
  enemy.status = 'dead';   // 自分を巻き込まないよう先に dead に
  spawnShockwave(world, pos, 0xff9a3d, R, 0.6);
  spawnShockwave(world, pos, 0xfff0a0, R * 0.5, 0.35);
  spawnFlash(world, pos, 0xffa040, 14, 20, 0.35);
  spawnBurst(world, pos, 0xffa24d, 36, 8, 0.7);
  spawnBurst(world, pos, 0xfff27a, 16, 5, 0.6);
  world.events.emit('explosion', { pos, radius: R });
  for (const o of [...world.enemies]) {
    if (o === enemy || !isTargetable(o)) continue;
    const d = Math.max(0, o.pos.distanceTo(pos) - o.radius * 0.5);
    if (d >= R) continue;
    const falloff = 1 - 0.7 * (d / R);
    damageEnemy(world, o, OVERLOAD.explosionDamage * falloff, { how: 'explosion', hitPos: pos });
  }
  if (playerCenter(world).distanceTo(pos) < OVERLOAD.selfDamageRadius) damagePlayer(world, OVERLOAD.selfDamage);
  world.stats.explosions++;
  killEnemy(world, enemy, 'explosion', true);
  // 逆流（送電）で爆発させて倒した：メタルを追加で落とす（合計 METAL.overloadMul 倍）
  spawnMetalDrop(world, enemy.kind, pos, METAL.overloadMul - 1);
  return 'exploded';
}

// ------------------------------------------------------------------ update
export function updateEnemies(world: World, dt: number): void {
  for (const e of world.enemies) {
    updateOne(world, e, dt);
  }
  separate(world.enemies.filter((e) => !e.ai.dormant));
  for (let i = world.enemies.length - 1; i >= 0; i--) {
    const e = world.enemies[i];
    if ((e.status === 'dead' || e.status === 'down') && e.deadTimer <= 0) {
      removeEnemy(world, e);
      world.enemies.splice(i, 1);
    } else if (e.status !== 'dead') {
      e.root.position.copy(e.pos);
    }
  }
}

function updateOne(world: World, e: Enemy, dt: number): void {
  const ai = e.ai;
  ai.t = (ai.t ?? 0) + dt;
  ai.flash = Math.max(0, ai.flash - dt);

  if (e.status === 'dead') {
    e.deadTimer -= dt;
    if (e.kind === 'boss') bossDeath(world, e, dt);
    return;
  }
  if (e.status === 'down') {
    e.deadTimer -= dt;
    ai.collapse = Math.min(1, ai.collapse + dt * 2.5);
    if (isFlyer(e.kind)) {
      e.vel.y = Math.max(-25, e.vel.y - 24 * dt);
      e.pos.addScaledVector(e.vel, dt);
      if (resolveFloor(world, e)) e.vel.set(0, 0, 0);
    } else fall(world, e, dt);
    animate(world, e, dt);
    return;
  }

  // overload 自然減少
  if (e.overload > 0 && world.time - ai.lastOverload > OVERLOAD_HOLD) {
    e.overload = Math.max(0, e.overload - ENEMIES[e.kind].overloadCap * OVERLOAD_DECAY * dt);
  }

  // 休眠中：AI なし。目覚め演出中だけ通常のアニメを回す
  if (ai.dormant) {
    if (world.state === 'playing') updateDormant(world, e, dt);
    if (ai.dormant?.show) animate(world, e, dt);
    else if (ai.dormant) e.root.rotation.y = ai.yaw ?? 0;
    return;
  }

  if (world.state === 'playing') {
    const c = makeCtx(world, e, dt);
    switch (e.kind) {
      case 'drone': updateDrone(c); break;
      case 'crawler': updateCrawler(c); break;
      case 'gunner': updateGunner(c); break;
      case 'heavy': updateHeavy(c); break;
      case 'boss': updateBoss(c, spawnEnemy); break;
      default: KIND_MODULES[e.kind]?.update(c, spawnEnemy); break;
    }
    if (e.kind === 'boss') checkBossPhase(world, e);
  }
  animate(world, e, dt);
}

import { resolveSphere } from '../core/collision';
function resolveFloor(world: World, e: Enemy): boolean {
  return resolveSphere(world.colliders, e.pos, e.radius * 0.8).lengthSq() > 0;
}

// ------------------------------------------------------------------ visuals
const _c = new THREE.Color();

function animate(world: World, e: Enemy, dt: number): void {
  const ai = e.ai;
  const model: Model = ai.model;
  const vis = model.vis;
  const spec = ENEMIES[e.kind];
  const t = ai.t;
  const hpRatio = e.maxHp > 0 ? e.hp / e.maxHp : 0;
  const down = e.status === 'down';

  e.root.rotation.y = ai.yaw ?? 0;

  // ---- 体の発光（優先度：被弾 > 予備動作 > 過負荷 > 第2形態 > 吸収）
  let glowColor: THREE.Color | null = null;
  let glow = 0;
  if (!down) {
    const k = spec.overloadCap > 0 ? e.overload / spec.overloadCap : 0;
    if (ai.flash > 0) { glowColor = WHITE; glow = 1.2 * (ai.flash / FLASH_TIME) + 0.3; }
    else if (ai.warn > 0) { glowColor = RED; glow = 0.4 + 0.9 * ai.warn * (0.7 + 0.3 * Math.sin(t * 30)); }
    else if (k > 0.02) { glowColor = RED; glow = k * (1.1 + 0.4 * Math.sin(t * (8 + 14 * k))); }
    else if (ai.phase === 2) { glowColor = PHASE_RED; glow = 0.5 + 0.15 * Math.sin(t * 4); }
    else if (e.tethered) { glowColor = CYAN; glow = 0.25 + 0.15 * Math.sin(t * 40); }
    if (ai.phaseFlash > 0) { ai.phaseFlash = Math.max(0, ai.phaseFlash - dt); glowColor = PHASE_RED; glow = Math.max(glow, 1.5 * ai.phaseFlash); }
    for (const b of model.bodyMats) {
      if (glowColor) { b.mat.emissive.copy(glowColor); b.mat.emissiveIntensity = glow; }
      else { b.mat.emissive.setHex(0x000000); b.mat.emissiveIntensity = 1; }
      // 過負荷で赤熱：ベース色を赤へ寄せる
      if (k > 0.02) b.mat.color.copy(b.base).lerp(_c.setHex(0xff3010), Math.min(1, k) * 0.6);
      else b.mat.color.copy(b.base);
    }
    // 目
    for (const m of model.eyeMats) {
      let inten = 1.6;
      if (ai.warn > 0) inten = 2.5 + 2 * ai.warn;
      if (e.tethered) inten = (0.3 + 1.3 * hpRatio) * (0.6 + 0.4 * Math.sin(t * 35 + e.id));
      m.emissiveIntensity = inten;
    }
    // 弱点：ふんわり点滅
    for (const m of model.weakMats) m.emissiveIntensity = 0.75 + 0.25 * Math.sin(t * 3 + e.id);
  }

  // ---- 震え・膨張
  let jx = 0, jy = 0, jz = 0;
  let scale = 1;
  if (!down) {
    const k = spec.overloadCap > 0 ? e.overload / spec.overloadCap : 0;
    scale = 1 + 0.28 * k + (k > 0.7 ? 0.04 * Math.sin(t * 40) : 0);
    if (e.tethered) {
      const a = 0.04 + 0.05 * (1 - hpRatio);
      jx += (Math.random() - 0.5) * a * e.radius * 2; jy += (Math.random() - 0.5) * a * e.radius * 2; jz += (Math.random() - 0.5) * a * e.radius * 2;
      ai.sparkT = (ai.sparkT ?? 0) - dt;
      if (ai.sparkT <= 0) {
        ai.sparkT = 0.12;
        const p = e.pos.clone().add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.3), (Math.random() - 0.5)).multiplyScalar(e.radius * 1.4));
        spawnBurst(world, p, 0x66e6ff, 2, 2, 0.25);
      }
    }
    if (k > 0.5) { const a = 0.03 * k; jx += (Math.random() - 0.5) * a; jz += (Math.random() - 0.5) * a; }
    if (e.status === 'stunned' && e.kind !== 'boss') { jx += Math.sin(t * 50) * 0.04; }
    if (e.status === 'stunned' && e.kind === 'boss') { jx += (Math.random() - 0.5) * 0.12; jy += (Math.random() - 0.5) * 0.12; }
  }
  vis.scale.setScalar(scale);
  vis.position.set(jx, jy, jz);

  // ---- 種類別アニメ
  const p = model.parts;
  switch (e.kind) {
    case 'drone': {
      if (!down) {
        p.ring.rotation.y += dt * 4;
        for (const d of p.props) d.rotation.y += dt * 40;
        vis.rotation.z = THREE.MathUtils.lerp(vis.rotation.z, THREE.MathUtils.clamp(-e.vel.x * 0.05, -0.3, 0.3), Math.min(1, dt * 6));
      } else {
        vis.rotation.z = ai.tilt * 1.1 * ai.collapse;
        vis.rotation.x = 0.5 * ai.collapse;
      }
      break;
    }
    case 'crawler': {
      const legs: THREE.Group[] = p.legs;
      if (!down) {
        const w = ai.walk ?? 0;
        ai.phaseW = (ai.phaseW ?? 0) + dt * (4 + w * 2.5);
        legs.forEach((l, i) => { l.rotation.x = Math.sin(ai.phaseW + (i % 2 ? Math.PI : 0) + (i > 1 ? 1 : 0)) * 0.6 * Math.min(1, w / 2); });
        vis.position.y += Math.abs(Math.sin(ai.phaseW)) * 0.03 * Math.min(1, w / 2);
        // 予備動作で縮む
        if (ai.state === 'windup') { vis.scale.set(1.1, 0.8, 1.1); vis.position.y -= 0.1; }
        if (ai.state === 'lunge') vis.scale.set(0.9, 0.9, 1.25);
      } else {
        vis.rotation.z = Math.PI * ai.collapse;       // ひっくり返る
        vis.position.y = -0.15 * ai.collapse;
        legs.forEach((l) => { l.rotation.x *= 0.9; });
      }
      break;
    }
    case 'gunner': {
      const legs: THREE.Group[] = p.legs;
      if (!down) {
        const w = ai.walk ?? 0;
        ai.phaseW = (ai.phaseW ?? 0) + dt * (3 + w * 2);
        legs.forEach((l, i) => { l.rotation.x = Math.sin(ai.phaseW + i * Math.PI) * 0.5 * Math.min(1, w / 1.5); });
        p.arm.rotation.x = -(ai.recoil ?? 0) * 0.3 - (ai.state === 'windup' ? 0.15 : 0);
        p.head.rotation.y = Math.sin(t * 1.5 + e.id) * 0.15;
        vis.position.y += Math.abs(Math.sin(ai.phaseW)) * 0.03 * Math.min(1, w / 1.5);
      } else {
        vis.rotation.x = -1.2 * ai.collapse;
        vis.position.y = -0.2 * ai.collapse;
      }
      break;
    }
    case 'heavy': {
      const arms: THREE.Group[] = p.arms;
      if (!down) {
        const w = ai.walk ?? 0;
        ai.phaseW = (ai.phaseW ?? 0) + dt * (2 + w);
        const up = ai.armsUp ?? 0;
        arms.forEach((a, i) => { a.rotation.x = -up * 2.4 + (ai.slam ?? 0) * 1.2 + Math.sin(ai.phaseW + i * Math.PI) * 0.25 * Math.min(1, w / 2); });
        vis.position.y += Math.abs(Math.sin(ai.phaseW)) * 0.05 * Math.min(1, w / 2);
        if (ai.state === 'chargeWindup') vis.rotation.x = 0.15 * ai.warn;
        else if (ai.state === 'charge') vis.rotation.x = 0.3;
        else vis.rotation.x = THREE.MathUtils.lerp(vis.rotation.x, 0, Math.min(1, dt * 8));
        if (e.status === 'stunned') vis.rotation.z = Math.sin(t * 12) * 0.08;
        else vis.rotation.z = 0;
      } else {
        vis.rotation.x = 0.9 * ai.collapse;
        vis.position.y = -0.35 * ai.collapse;
        arms.forEach((a) => { a.rotation.x = 0.4 * ai.collapse; });
      }
      break;
    }
    case 'boss': {
      const open = ai.openAmt ?? 0;
      const plates: THREE.Mesh[] = p.plates;
      p.orbit.rotation.y += dt * (e.status === 'stunned' ? 0.2 : ai.phase === 2 ? 1.6 : 0.8);
      plates.forEach((pl, i) => {
        const s = 1 + open * 0.4;
        pl.scale.setScalar(s);
        pl.rotation.x = Math.sin(t * 0.7 + i) * 0.1 * (1 - open) + open * (i % 2 ? 0.25 : -0.25);
      });
      p.lidTop.position.y = 0.55 + open * 1.6;
      p.lidBot.position.y = -0.55 - open * 1.6;
      p.lidTop.rotation.x = -open * 0.5;
      p.lidBot.rotation.x = open * 0.5;
      p.core.scale.setScalar(1 + 0.04 * Math.sin(t * 5) + (open > 0.5 ? 0.06 : 0));
      break;
    }
    default: KIND_MODULES[e.kind]?.animate(world, e, dt, down); break;
  }
}

function bossDeath(world: World, e: Enemy, dt: number): void {
  const ai = e.ai;
  ai.deathT += dt;
  const model: Model = ai.model;
  // 連鎖爆発
  ai.deathBang -= dt;
  if (ai.deathBang <= 0 && ai.deathT < BOSS_DEATH_TIME - 0.5) {
    ai.deathBang = 0.14;
    const off = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(e.radius * 1.6);
    const p = e.pos.clone().add(off);
    spawnShockwave(world, p, 0xffb070, 2.2 + Math.random() * 1.5, 0.4);
    spawnBurst(world, p, 0xffa24d, 10, 6);
    spawnFlash(world, p, 0xffa040, 6, 10, 0.15);
  }
  const k = ai.deathT / BOSS_DEATH_TIME;
  model.vis.position.set((Math.random() - 0.5) * 0.3 * (1 - k), (Math.random() - 0.5) * 0.3 * (1 - k), (Math.random() - 0.5) * 0.3 * (1 - k));
  model.vis.scale.setScalar(k < 0.8 ? 1 : Math.max(0.01, 1 - (k - 0.8) / 0.2));
  for (const b of model.bodyMats) { b.mat.emissive.setHex(0xff8030); b.mat.emissiveIntensity = 0.5 + 0.8 * Math.sin(ai.deathT * 30); }
  if (e.deadTimer <= 0 && !ai.finalBang) {
    ai.finalBang = true;
    spawnShockwave(world, e.pos, 0xfff0a0, 16, 1.0);
    spawnShockwave(world, e.pos, 0xff7a3d, 11, 0.8);
    spawnFlash(world, e.pos, 0xffd080, 16, 30, 0.6);
    spawnBurst(world, e.pos, 0xffa24d, 50, 12, 1.0);
    spawnBurst(world, e.pos, 0xfff27a, 30, 8, 0.9);
  }
}

function removeEnemy(world: World, e: Enemy): void {
  world.scene.remove(e.root);
  disposeObject(e.root);
  KIND_MODULES[e.kind]?.onRemove?.(world, e);
  const extra: THREE.Object3D[] | undefined = e.ai.extra;
  if (extra) for (const o of extra) { world.scene.remove(o); disposeObject(o); }
  // 共有ジオメトリは dispose しない
  // down の遅れ消し等で weakPoints を無効に
  for (const w of e.weakPoints) w.exposed = false;
  void faceToward;
}
