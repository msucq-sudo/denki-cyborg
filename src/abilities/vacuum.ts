// バキューム（スキル）。発動すると、自分を中心とした円の中にいる敵全員から VACUUM.duration 秒かけて電力（敵HP）を吸い取り、
// 自分の電力にする。吸う処理は吸収アーム（absorb.ts）と同じく enemies/api の drainEnemy を使う（吸い切ると倒れる・ボスは下限あり・
// 守られている敵は吸えない）。仲間（ハッキングした味方）・眠っている敵は isTargetable で除外。
//
// 演出：
//  - 敵 → 自分へ、光の粒が渦を描きながら流れ込む＋ギザギザの電気の筋
//  - 敵：しぼむ・暗くなる・震える（enemies の毎フレームの見た目更新の後に上書きする）
//  - 自分：足元に内向きの波紋、腰の高さに回る渦、始まりと終わりに閃光
//  - 効果音は 'vacuumStart' / 'vacuumEnd' イベントで audio/sfx.ts が鳴らす
import * as THREE from 'three';
import type { Enemy, World } from '../core/types';
import { ENEMIES, VACUUM } from '../config/balance';
import { isBarrierProtected } from '../enemies/barrier';
import { addEnergy, spendEnergy } from '../core/energy';
import { isTargetable } from '../core/enemyUtil';
import { drainEnemy } from '../enemies/api';
import { addEffect, spawnFlash } from '../core/effects';

/** プレイヤーの足元から体の中心（吸い込む先）までの高さ */
const CENTER_Y = 1.1;
/** 吸った量の数字を出す間隔（1体ごと） */
const POP_INTERVAL = 0.3;
/** 1体あたり光の粒を出す間隔 */
const MOTE_INTERVAL = 0.035;
const RIPPLE_INTERVAL = 0.22;
const CYAN = 0x66e6ff;
const BOLT_POINTS = 12;

interface TargetFx {
  enemy: Enemy;
  /** 数字表示用にためている吸った量 */
  popAcc: number;
  popT: number;
  moteT: number;
  bolt: THREE.Line;
}

interface VacVis {
  root: THREE.Group;
  vortex: THREE.Group;
  targets: Map<number, TargetFx>;
  /** 一度でも吸えた敵（終了時の数） */
  touched: Set<number>;
  rippleT: number;
}

const visuals = new WeakMap<World, VacVis>();
const moteGeo = new THREE.SphereGeometry(0.07, 6, 4);
const rippleGeo = new THREE.RingGeometry(0.94, 1, 48);
const _c = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _side = new THREE.Vector3();
const _col = new THREE.Color();

/** 吸い込む中心（プレイヤーの体の中心。ワールド座標） */
export function vacuumCenter(world: World, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(world.player.pos).setY(world.player.pos.y + CENTER_Y);
}

/** 円の中にいて吸える敵（仲間・眠っている敵・倒れた敵・守られている敵は除く） */
export function vacuumTargets(world: World): Enemy[] {
  const c = vacuumCenter(world, _c);
  const out: Enemy[] = [];
  for (const e of world.enemies) {
    if (!isTargetable(e) || e.allied || e.shielded || isBarrierProtected(world, e, c)) continue;
    const dx = e.pos.x - c.x, dz = e.pos.z - c.z;
    if (Math.hypot(dx, dz) - e.radius > VACUUM.radius) continue;
    if (Math.abs(e.pos.y - c.y) - e.radius > VACUUM.height) continue;
    out.push(e);
  }
  return out;
}

/** 使えない理由（使えるなら null）。未入手・クールダウンは skills.ts が見る */
export function canUseVacuum(world: World): 'energy' | null {
  if (VACUUM.cost > 0 && world.player.energy < VACUUM.cost) return 'energy';
  return null;
}

export function startVacuum(world: World): void {
  const v = world.skills.vacuum;
  if (VACUUM.cost > 0 && !spendEnergy(world, VACUUM.cost)) return;
  v.active = true;
  v.t = 0;
  v.gained = 0;
  v.downed = 0;
  const c = vacuumCenter(world);
  world.events.emit('vacuumStart', { pos: c.clone(), radius: VACUUM.radius, duration: VACUUM.duration });
  spawnFlash(world, c, CYAN, 5, 6, 0.25);
  ensureVis(world);
}

/** 毎フレーム。実行中でなければ何もしない */
export function updateVacuum(world: World, dt: number): void {
  const v = world.skills.vacuum;
  if (!v.active) return;
  const prevT = v.t;
  v.t += dt;
  const drainDt = Math.max(0, Math.min(v.t, VACUUM.duration) - prevT);
  const vis = ensureVis(world);
  const c = vacuumCenter(world, new THREE.Vector3());
  const targets = vacuumTargets(world);
  const seen = new Set<number>();

  for (const e of targets) {
    seen.add(e.id);
    let fx = vis.targets.get(e.id);
    if (!fx) {
      fx = { enemy: e, popAcc: 0, popT: 0, moteT: 0, bolt: makeBolt() };
      vis.root.add(fx.bolt);
      vis.targets.set(e.id, fx);
    }
    // ---- 吸う ----
    let amount = VACUUM.drainPerSec * (ENEMIES[e.kind]?.drainMul ?? 1) * drainDt;
    if (!VACUUM.canKill) amount = Math.min(amount, Math.max(0, e.hp - 1));
    const got = amount > 0 ? drainEnemy(world, e, amount) : 0;
    if (got > 0) {
      const want = Math.min(got * VACUUM.conversion, Math.max(0, VACUUM.maxGain - v.gained));
      v.gained += want;
      const added = addEnergy(world, want);
      world.stats.energyAbsorbed += added;
      fx.popAcc += got;
      vis.touched.add(e.id);
    }
    fx.popT += dt;
    const downed = got > 0 && (e.hp <= 0 || !isTargetable(e));
    if (fx.popAcc > 0 && (fx.popT >= POP_INTERVAL || downed)) {
      world.events.emit('enemyDrained', { pos: e.pos.clone().setY(e.pos.y + e.radius), amount: fx.popAcc });
      fx.popAcc = 0; fx.popT = 0;
    }
    if (downed) {
      v.downed++;
      const added = addEnergy(world, VACUUM.finishBonus);
      world.stats.energyAbsorbed += added;
      continue;
    }
    // ---- 見た目（敵がしぼむ・暗くなる・震える＋粒と筋） ----
    shrinkEnemy(e, envelope(v.t), world.time);
    updateBolt(fx.bolt, e.pos, c, e.radius);
    fx.moteT -= dt;
    while (fx.moteT <= 0) {
      fx.moteT += MOTE_INTERVAL;
      spawnMote(world, e);
    }
  }
  // 円から出た・倒れた敵の筋を消す
  for (const [id, fx] of vis.targets) {
    if (seen.has(id) && isTargetable(fx.enemy)) continue;
    vis.root.remove(fx.bolt);
    disposeLine(fx.bolt);
    vis.targets.delete(id);
  }

  // ---- 自分の周りの渦と波紋 ----
  vis.vortex.position.copy(world.player.pos).setY(world.player.pos.y + 0.9);
  const env = envelope(v.t);
  vis.vortex.rotation.y -= dt * (7 + 5 * env);
  vis.vortex.scale.setScalar(0.6 + 0.6 * env + 0.05 * Math.sin(world.time * 30));
  vis.vortex.children.forEach((ch, i) => {
    const m = (ch as THREE.Line).material as THREE.LineBasicMaterial;
    m.opacity = env * (0.55 + 0.35 * Math.sin(world.time * 22 + i * 2.1));
  });
  vis.rippleT -= dt;
  if (vis.rippleT <= 0 && v.t < VACUUM.duration) {
    vis.rippleT = RIPPLE_INTERVAL;
    spawnRipple(world);
  }

  if (v.t >= VACUUM.duration) endVacuum(world);
}

function endVacuum(world: World): void {
  const v = world.skills.vacuum;
  const vis = visuals.get(world);
  let count = 0;
  if (vis) {
    count = vis.touched.size;
    for (const fx of vis.targets.values()) {
      if (fx.popAcc > 0) world.events.emit('enemyDrained', { pos: fx.enemy.pos.clone().setY(fx.enemy.pos.y + fx.enemy.radius), amount: fx.popAcc });
    }
    world.scene.remove(vis.root);
    vis.root.traverse((o) => disposeLine(o as THREE.Line));
    visuals.delete(world);
  }
  v.active = false;
  const c = vacuumCenter(world);
  world.events.emit('vacuumEnd', { pos: c.clone(), gained: v.gained, count });
  if (v.gained > 0) spawnFlash(world, c, CYAN, 8, 7, 0.3);
}

/** 0→1（立ち上がり 0.15 秒）→ 終わり際に 0 へ */
function envelope(t: number): number {
  const up = Math.min(1, t / 0.15);
  const down = Math.min(1, Math.max(0, (VACUUM.duration - t) / 0.2));
  return up * down;
}

function ensureVis(world: World): VacVis {
  let vis = visuals.get(world);
  if (vis) return vis;
  const root = new THREE.Group();
  root.name = 'vacuumFx';
  const vortex = new THREE.Group();
  // 渦：3本の対数らせん（外から中心へ巻き込む）
  for (let arm = 0; arm < 3; arm++) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      const r = 2.2 * Math.pow(1 - u, 1.4) + 0.12;
      const a = arm * ((Math.PI * 2) / 3) + u * Math.PI * 2.4;
      pts.push(new THREE.Vector3(Math.cos(a) * r, (u - 0.5) * 0.5, Math.sin(a) * r));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: arm === 1 ? 0xffffff : CYAN, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    vortex.add(line);
  }
  root.add(vortex);
  world.scene.add(root);
  vis = { root, vortex, targets: new Map(), touched: new Set(), rippleT: 0 };
  visuals.set(world, vis);
  return vis;
}

function makeBolt(): THREE.Line {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_POINTS * 3), 3));
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
}

/** 敵 → 自分へのギザギザの電気の筋。毎フレーム形を変え、ときどき消えてちらつく */
function updateBolt(bolt: THREE.Line, from: THREE.Vector3, to: THREE.Vector3, r: number): void {
  const attr = bolt.geometry.getAttribute('position') as THREE.BufferAttribute;
  _a.copy(to).sub(from);
  const len = _a.length();
  _side.set(-_a.z, 0, _a.x).normalize();
  for (let i = 0; i < BOLT_POINTS; i++) {
    const u = i / (BOLT_POINTS - 1);
    const amp = Math.sin(Math.PI * u) * Math.min(0.6, 0.08 * len + r * 0.3);
    _b.copy(from).addScaledVector(_a, u)
      .addScaledVector(_side, (Math.random() - 0.5) * 2 * amp);
    _b.y += (Math.random() - 0.5) * 2 * amp;
    attr.setXYZ(i, _b.x, _b.y, _b.z);
  }
  attr.needsUpdate = true;
  bolt.geometry.computeBoundingSphere();
  bolt.visible = Math.random() > 0.25;
  (bolt.material as THREE.LineBasicMaterial).color.setHex(Math.random() < 0.3 ? 0xffffff : CYAN);
}

/** 敵から自分へ、渦を描いて吸い込まれる光の粒 */
function spawnMote(world: World, e: Enemy): void {
  const m = new THREE.Mesh(moteGeo, new THREE.MeshBasicMaterial({
    color: Math.random() < 0.25 ? 0xffffff : CYAN, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  const start = e.pos.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(e.radius * 1.6));
  const swirl = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.9);
  const lift = (Math.random() - 0.3) * 0.8;
  m.position.copy(start);
  world.scene.add(m);
  const target = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  addEffect(world, m, 0.38 + Math.random() * 0.15, (fx) => {
    const u = 1 - fx.life / fx.maxLife;
    const ease = u * u; // だんだん速く（吸い込まれる）
    vacuumCenter(world, target);
    dir.copy(target).sub(start);
    side.set(-dir.z, 0, dir.x).normalize();
    m.position.copy(start).addScaledVector(dir, ease)
      .addScaledVector(side, Math.sin(Math.PI * u) * swirl);
    m.position.y += Math.sin(Math.PI * u) * lift;
    m.scale.setScalar(1.3 - 0.8 * u);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.6 * u;
  });
}

/** 足元の波紋：円の縁から中心へ縮んでいく（吸い込みの向き） */
function spawnRipple(world: World): void {
  const m = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({
    color: CYAN, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  m.rotation.x = -Math.PI / 2;
  world.scene.add(m);
  addEffect(world, m, 0.6, (fx) => {
    const u = 1 - fx.life / fx.maxLife;
    m.position.copy(world.player.pos).setY(world.player.pos.y + 0.06);
    m.scale.setScalar(Math.max(0.05, VACUUM.radius * (1 - u * u)));
    (m.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.sin(Math.PI * u);
  });
}

/** 吸われている敵：しぼむ・暗くなる・震える（enemies の見た目更新の後に毎フレーム上書き） */
function shrinkEnemy(e: Enemy, env: number, t: number): void {
  const model = e.ai.model as {
    vis?: THREE.Group;
    bodyMats?: { mat: THREE.MeshStandardMaterial; base: THREE.Color }[];
    eyeMats?: THREE.MeshStandardMaterial[];
  } | undefined;
  if (!model?.vis) return;
  const hpRatio = e.maxHp > 0 ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : 0;
  const k = env * (0.55 + 0.45 * (1 - hpRatio));
  const vis = model.vis;
  vis.scale.multiplyScalar(1 - 0.2 * k);
  vis.scale.y *= 1 - 0.08 * k * (0.5 + 0.5 * Math.sin(t * 45 + e.id));
  const j = 0.07 * e.radius * k;
  vis.position.x += (Math.random() - 0.5) * 2 * j;
  vis.position.y += (Math.random() - 0.5) * 2 * j;
  vis.position.z += (Math.random() - 0.5) * 2 * j;
  for (const b of model.bodyMats ?? []) {
    b.mat.color.multiplyScalar(1 - 0.55 * k);
    b.mat.emissive.copy(_col.setHex(CYAN));
    b.mat.emissiveIntensity = (0.05 + 0.35 * Math.random()) * k;
  }
  for (const m of model.eyeMats ?? []) m.emissiveIntensity *= 0.15 + 0.45 * Math.random() * (1 - k * 0.5);
}

function disposeLine(o: THREE.Line): void {
  if (!(o as any).isLine) return;
  o.geometry?.dispose();
  (o.material as THREE.Material)?.dispose?.();
}

/** テスト・デバッグ用：見た目を消す */
export function resetVacuumVisual(world: World): void {
  const vis = visuals.get(world);
  if (!vis) return;
  world.scene.remove(vis.root);
  vis.root.traverse((o) => disposeLine(o as THREE.Line));
  visuals.delete(world);
}
