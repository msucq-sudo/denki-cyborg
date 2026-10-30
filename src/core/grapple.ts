// グラップル：吸収アームを「グラップルポイント」に刺して体を引き寄せる。
// ポイントはレベル側が registerGrapplePoint で置く（sockets.ts と同じ World ごとの登録）。
import * as THREE from 'three';
import { GRAPPLE, PLAYER } from '../config/balance';
import type { AABB, World } from './types';
import { moveCharacter, raycastLevel, segmentSphere } from './collision';
import { spendEnergy } from './energy';

export type GrappleKind = 'ledge' | 'ceiling' | 'wall';

export interface GrapplePointDef {
  /** アンカー位置。ledge＝足場の上面の縁、ceiling＝天井面 */
  pos: THREE.Vector3;
  /** 面の外向き法線（ledge＝壁から手前へ水平、ceiling＝(0,-1,0)） */
  normal: THREE.Vector3;
  radius?: number;
  kind: 'ledge' | 'ceiling';
  /** ceiling：ぶら下がった後にここへ飛び移る（隣の足場の足元位置） */
  landAt?: THREE.Vector3;
}

export interface GrapplePoint {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
  kind: GrappleKind;
  landAt: THREE.Vector3 | null;
  /** 見た目（なければ null） */
  vis: GrappleVis | null;
}

interface GrappleVis {
  group: THREE.Group;
  ring: THREE.Mesh;
  hook: THREE.Mesh;
  halo: THREE.Mesh;
  /** 狙われている度合い 0..1 */
  k: number;
  phase: number;
}

type Phase = 'none' | 'pull' | 'hang' | 'hoist';
interface GState {
  phase: Phase;
  point: GrapplePoint | null;
  speed: number;
  t: number;
  cooldown: number;
  blocked: number;
  hangPos: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** hoist の種類 */
  style: 'ledge' | 'swing';
  aimed: GrapplePoint | null;
}

const points = new WeakMap<World, GrapplePoint[]>();
const states = new WeakMap<World, GState>();

function gs(world: World): GState {
  let s = states.get(world);
  if (!s) {
    s = {
      phase: 'none', point: null, speed: 0, t: 0, cooldown: 0, blocked: 0,
      hangPos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), style: 'ledge', aimed: null,
    };
    states.set(world, s);
  }
  return s;
}

export function getGrapplePoints(world: World): GrapplePoint[] {
  let l = points.get(world);
  if (!l) points.set(world, (l = []));
  return l;
}

/** 全ポイントと見た目を消す（レベル構築の頭で呼ぶ） */
export function clearGrapplePoints(world: World): void {
  for (const p of getGrapplePoints(world)) p.vis?.group.removeFromParent();
  points.delete(world);
  states.delete(world);
}

export function registerGrapplePoint(world: World, def: GrapplePointDef): GrapplePoint {
  const pt: GrapplePoint = {
    pos: def.pos.clone(), normal: def.normal.clone().normalize(), radius: def.radius ?? GRAPPLE.pointRadius,
    kind: def.kind, landAt: def.landAt ? def.landAt.clone() : null, vis: null,
  };
  pt.vis = buildVisual(pt);
  world.scene.add(pt.vis.group);
  getGrapplePoints(world).push(pt);
  return pt;
}

// ---------------------------------------------------------------- 状態の参照

/** 引き寄せ・ぶら下がり・よじ登りのどれかの最中（射撃などを止める） */
export function isGrappling(world: World): boolean { return gs(world).phase !== 'none'; }
/** アームがまだ刺さっているべき間（引き寄せ中／ぶら下がり中） */
export function isGrappleHolding(world: World): boolean {
  const p = gs(world).phase;
  return p === 'pull' || p === 'hang';
}
export function grappleCooldown(world: World): number { return gs(world).cooldown; }
export function currentGrapple(world: World): GrapplePoint | null { return gs(world).point; }

/** 撃てる状態か（待ち時間・電力） */
export function canGrapple(world: World): boolean {
  return GRAPPLE.enabled && gs(world).phase === 'none' && gs(world).cooldown <= 0 && world.player.energy >= GRAPPLE.cost;
}

// ---------------------------------------------------------------- 照準・命中

/** 線分 p0→p1 がグラップルポイントに当たるか（最も近いもの）。壁の向こうは除外 */
export function hitGrapple(world: World, p0: THREE.Vector3, p1: THREE.Vector3): { pt: GrapplePoint; t: number } | null {
  let best: GrapplePoint | null = null, bt = Infinity;
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const lt = raycastLevel(world.colliders, p0, p1);
  for (const pt of getGrapplePoints(world)) {
    // 表側（法線側）から狙ったときだけ
    if (dir.dot(pt.normal) > 0) continue;
    const t = segmentSphere(p0, p1, pt.pos, pt.radius);
    if (t === null || t >= bt) continue;
    if (lt !== null && lt < t - 1e-4) continue;
    best = pt; bt = t;
  }
  return best ? { pt: best, t: bt } : null;
}

const _e = new THREE.Vector3();
/** 照準の先にあるグラップルポイント（射程 GRAPPLE.range） */
export function findAimedGrapple(world: World): GrapplePoint | null {
  _e.copy(world.aimOrigin).addScaledVector(world.aimDir, GRAPPLE.range);
  return hitGrapple(world, world.aimOrigin, _e)?.pt ?? null;
}

/** 点 p のいちばん近い面の法線（AABB の外側へ）。見つからなければ null */
function surfaceNormal(colliders: AABB[], p: THREE.Vector3): THREE.Vector3 | null {
  const eps = 0.06;
  let bd = Infinity;
  const n = new THREE.Vector3();
  for (const b of colliders) {
    if (!b.active) continue;
    if (p.x < b.min.x - eps || p.x > b.max.x + eps || p.y < b.min.y - eps || p.y > b.max.y + eps
      || p.z < b.min.z - eps || p.z > b.max.z + eps) continue;
    const c: [number, number, number, number][] = [
      [Math.abs(p.x - b.min.x), -1, 0, 0], [Math.abs(p.x - b.max.x), 1, 0, 0],
      [Math.abs(p.y - b.min.y), 0, -1, 0], [Math.abs(p.y - b.max.y), 0, 1, 0],
      [Math.abs(p.z - b.min.z), 0, 0, -1], [Math.abs(p.z - b.max.z), 0, 0, 1],
    ];
    for (const [d, x, y, z] of c) if (d < bd) { bd = d; n.set(x, y, z); }
  }
  return bd < eps * 2 ? n : null;
}

/** 点 p を含む（触れている）一番上が低いコライダー（縁の高さを知るため） */
function boxAt(colliders: AABB[], p: THREE.Vector3): AABB | null {
  const eps = 0.08;
  let best: AABB | null = null;
  for (const b of colliders) {
    if (!b.active) continue;
    if (p.x < b.min.x - eps || p.x > b.max.x + eps || p.y < b.min.y - eps || p.y > b.max.y + eps
      || p.z < b.min.z - eps || p.z > b.max.z + eps) continue;
    if (!best || b.max.y < best.max.y) best = b;
  }
  return best;
}

/** 縁の上に人が立てる空きがあるか */
function roomOnTop(colliders: AABB[], x: number, y: number, z: number): boolean {
  const head = new THREE.Vector3(x, y + PLAYER.height * 0.5 + 0.05, z);
  for (const b of colliders) {
    if (!b.active) continue;
    if (head.x > b.min.x - PLAYER.radius * 0.5 && head.x < b.max.x + PLAYER.radius * 0.5
      && head.y > b.min.y && head.y < b.max.y
      && head.z > b.min.z - PLAYER.radius * 0.5 && head.z < b.max.z + PLAYER.radius * 0.5) return false;
  }
  return true;
}

/**
 * anySurface 用：壁／天井に当たった点から一時的なポイントを作る（床は不可）。登録はしない。
 * 壁で、上の縁が GRAPPLE.ledgeReach 以内にあり上に立てる空きがあれば「縁（ledge）」扱いにしてよじ登る
 */
export function surfacePoint(world: World, hit: THREE.Vector3): GrapplePoint | null {
  const n = surfaceNormal(world.colliders, hit);
  if (!n || n.y > 0.5) return null;
  if (n.y < -0.5) return { pos: hit.clone(), normal: n, radius: 0.1, kind: 'ceiling', landAt: null, vis: null };
  const b = boxAt(world.colliders, hit);
  if (b && b.max.y - hit.y <= GRAPPLE.ledgeReach) {
    const top = new THREE.Vector3(hit.x, b.max.y, hit.z);
    const inX = top.x - n.x * 0.9, inZ = top.z - n.z * 0.9;
    if (roomOnTop(world.colliders, inX, top.y, inZ)) {
      return { pos: top, normal: n, radius: 0.1, kind: 'ledge', landAt: null, vis: null };
    }
  }
  return { pos: hit.clone(), normal: n, radius: 0.1, kind: 'wall', landAt: null, vis: null };
}

// ---------------------------------------------------------------- 引き寄せ

/** ぶら下がり位置（足元） */
function hangPosFor(pt: GrapplePoint, out: THREE.Vector3): THREE.Vector3 {
  const off = PLAYER.radius + 0.15;
  if (pt.kind === 'ceiling') return out.set(pt.pos.x, pt.pos.y - PLAYER.height - 0.05, pt.pos.z);
  if (pt.kind === 'ledge') return out.set(pt.pos.x + pt.normal.x * off, pt.pos.y - 1.5, pt.pos.z + pt.normal.z * off);
  return out.set(pt.pos.x + pt.normal.x * off, pt.pos.y - 1.0, pt.pos.z + pt.normal.z * off);
}

/** 刺さった瞬間に呼ぶ。電力を払って引き寄せ開始。払えない・待ち時間中は false */
export function startGrapple(world: World, pt: GrapplePoint): boolean {
  const g = gs(world);
  if (g.phase !== 'none' || g.cooldown > 0) return false;
  if (!spendEnergy(world, GRAPPLE.cost)) return false;
  g.phase = 'pull';
  g.point = pt;
  g.speed = GRAPPLE.minSpeed;
  g.t = 0;
  g.blocked = 0;
  hangPosFor(pt, g.hangPos);
  world.events.emit('grappleAttach', { pos: pt.pos.clone() });
  return true;
}

/** 中断（運動量は呼び出し側が p.vel に入れる） */
export function cancelGrapple(world: World): void {
  const g = gs(world);
  if (g.phase === 'none') return;
  finish(world, g);
}

function finish(world: World, g: GState): void {
  g.phase = 'none';
  g.point = null;
  g.cooldown = GRAPPLE.cooldown;
  g.blocked = 0;
}

const ease = (k: number) => k * k * (3 - 2 * k);
const _d = new THREE.Vector3();
const _b = new THREE.Vector3();

function startHoist(g: GState, from: THREE.Vector3, to: THREE.Vector3, style: 'ledge' | 'swing'): void {
  g.phase = 'hoist';
  g.t = 0;
  g.style = style;
  g.from.copy(from);
  g.to.copy(to);
}

/**
 * グラップル中のプレイヤー移動。毎フレーム updatePlayer の頭から呼ぶ。
 * true＝このフレームの移動はここで済んだ（通常の移動処理は飛ばす）。
 */
export function stepGrapple(world: World, dt: number): boolean {
  const g = gs(world);
  if (g.phase === 'none' || !g.point) return false;
  const p = world.player;
  const input = world.input;
  const pt = g.point;
  const release = input.pressed('KeyE') || input.pressed('Space');

  if (g.phase === 'pull') {
    // 引き寄せ中の E／ジャンプで中止（勢いは残す）
    if (release) {
      _d.subVectors(g.hangPos, p.pos).normalize();
      p.vel.copy(_d).multiplyScalar(g.speed * 0.6);
      finish(world, g);
      return false;
    }
    g.speed = Math.min(GRAPPLE.maxSpeed, g.speed + GRAPPLE.accel * dt);
    _d.subVectors(g.hangPos, p.pos);
    const dist = _d.length();
    if (dist < 0.3) {
      p.vel.set(0, 0, 0);
      world.events.emit('grappleArrive', { pos: pt.pos.clone() });
      if (pt.kind === 'ledge') {
        const to = new THREE.Vector3(pt.pos.x - pt.normal.x * 0.9, pt.pos.y + 0.03, pt.pos.z - pt.normal.z * 0.9);
        startHoist(g, p.pos, to, 'ledge');
      } else { g.phase = 'hang'; g.t = 0; }
      return true;
    }
    // 終点に近づくほど減速（行き過ぎない）
    const v = Math.min(g.speed, dist * 9 + 2);
    const step = Math.min(v * dt, dist);
    p.vel.copy(_d).multiplyScalar(step / dt / dist);
    _b.copy(p.pos);
    moveCharacter(world.colliders, p.pos, p.vel, dt, PLAYER.radius, PLAYER.height);
    const moved = p.pos.distanceTo(_b);
    if (step > 1e-4 && moved < step * 0.25) g.blocked += dt; else g.blocked = 0;
    if (g.blocked > GRAPPLE.blockedTime) { p.vel.set(0, 0, 0); finish(world, g); return false; }
    p.onGround = false;
    return true;
  }

  if (g.phase === 'hang') {
    g.t += dt;
    p.vel.set(0, 0, 0);
    p.pos.copy(g.hangPos);
    p.onGround = false;
    if (release || g.t >= GRAPPLE.hangMax) { finish(world, g); return true; }
    if (pt.landAt && g.t >= GRAPPLE.swingDelay) startHoist(g, p.pos, pt.landAt, 'swing');
    return true;
  }

  // hoist：縁へよじ登る／隣の足場へ飛び移る
  g.t += dt;
  const dur = g.style === 'ledge' ? GRAPPLE.hoistTime : GRAPPLE.swingTime;
  const k = Math.min(1, g.t / dur);
  if (g.style === 'ledge') {
    // まず真上へ（縁の外側を上がる）、次に足場の上へ
    const k1 = ease(Math.min(1, k / 0.6)), k2 = ease(Math.max(0, (k - 0.6) / 0.4));
    p.pos.set(
      g.from.x + (g.to.x - g.from.x) * k2,
      g.from.y + (g.to.y - g.from.y) * k1,
      g.from.z + (g.to.z - g.from.z) * k2,
    );
  } else {
    p.pos.lerpVectors(g.from, g.to, ease(k));
    p.pos.y += Math.sin(Math.PI * k) * 1.5;
  }
  p.vel.set(0, 0, 0);
  p.onGround = false;
  if (k >= 1) {
    p.pos.copy(g.to);
    finish(world, g);
  }
  return true;
}

// ---------------------------------------------------------------- 毎フレーム（待ち時間・見た目）

export function updateGrapple(world: World, dt: number): void {
  const g = gs(world);
  g.cooldown = Math.max(0, g.cooldown - dt);
  // 狙えるポイントを強調（撃てる状態のときだけ）
  g.aimed = world.state === 'playing' && canGrapple(world) ? findAimedGrapple(world) : null;
  for (const pt of getGrapplePoints(world)) {
    const v = pt.vis;
    if (!v) continue;
    v.phase += dt;
    const want = pt === g.aimed ? 1 : 0;
    v.k += (want - v.k) * (1 - Math.exp(-14 * dt));
    const pulse = 0.5 + 0.5 * Math.sin(v.phase * 3 + pt.pos.x);
    (v.ring.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9 + pulse * 0.8 + v.k * 1.2;
    (v.hook.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2 + pulse * 0.6 + v.k * 1.5;
    v.halo.visible = v.k > 0.02;
    v.halo.scale.setScalar(0.85 + v.k * 0.25 + pulse * 0.08);
    v.halo.rotation.z += dt * 2.5;
    (v.halo.material as THREE.MeshBasicMaterial).opacity = v.k * 0.95;
  }
}

// ---------------------------------------------------------------- 見た目

const WHITE = 0xe8f0f8, NAVY = 0x1a2a52, CYAN = 0x4fe6ff, YEL = 0xffd84a;
let sharedGeo: { plate: THREE.BufferGeometry; frame: THREE.BufferGeometry; ring: THREE.BufferGeometry; hook: THREE.BufferGeometry; halo: THREE.BufferGeometry } | null = null;

function buildVisual(pt: GrapplePoint): GrappleVis {
  sharedGeo ??= {
    plate: new THREE.BoxGeometry(0.9, 0.9, 0.1),
    frame: new THREE.BoxGeometry(1.02, 1.02, 0.06),
    ring: new THREE.TorusGeometry(0.3, 0.05, 8, 24),
    hook: new THREE.SphereGeometry(0.1, 10, 8),
    halo: new THREE.TorusGeometry(0.72, 0.045, 6, 28),
  };
  const G = sharedGeo;
  const group = new THREE.Group();
  group.name = 'grapplePoint';
  // ローカル +Z = 法線
  const inner = new THREE.Group();
  group.add(inner);
  inner.add(new THREE.Mesh(G.frame, new THREE.MeshStandardMaterial({ color: NAVY, roughness: 0.6, metalness: 0.3 })));
  const plate = new THREE.Mesh(G.plate, new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.5, metalness: 0.2 }));
  plate.position.z = 0.05;
  inner.add(plate);
  const ring = new THREE.Mesh(G.ring, new THREE.MeshStandardMaterial({ color: 0x0a3a48, emissive: CYAN, emissiveIntensity: 1.2 }));
  ring.position.z = 0.12;
  inner.add(ring);
  const hook = new THREE.Mesh(G.hook, new THREE.MeshStandardMaterial({ color: 0x4a3a00, emissive: YEL, emissiveIntensity: 1.4 }));
  hook.position.z = 0.15;
  inner.add(hook);
  const halo = new THREE.Mesh(G.halo, new THREE.MeshBasicMaterial({
    color: YEL, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  halo.position.z = 0.2;
  halo.visible = false;
  inner.add(halo);
  inner.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pt.normal);
  // ledge は縁の少し下の壁面に取り付ける
  group.position.copy(pt.pos);
  if (pt.kind === 'ledge') group.position.y -= 0.6;
  group.position.addScaledVector(pt.normal, 0.02);
  return { group, ring, hook, halo, k: 0, phase: Math.random() * 6 };
}
