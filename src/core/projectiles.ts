import * as THREE from 'three';
import type { Projectile, ProjectileOwner, World } from './types';
import { raycastLevel, segmentSphere } from './collision';
import { getSockets } from './sockets';
import { raycastEnemies } from './enemyUtil';
import { damagePlayer, playerCenter, PLAYER_HIT_RADIUS } from './combat';
import { damageEnemy } from '../enemies/api';
import { spawnBurst, spawnFlash, spawnShockwave } from './effects';
import { GUN } from '../config/balance';

export interface SpawnProjectileOpts {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  owner: ProjectileOwner;
  radius?: number;
  life?: number;
  charged?: boolean;
  gravity?: number;
  color?: number;
  /** 見た目のサイズ（省略時 radius） */
  size?: number;
  /** ミサイル型の見た目にする（速度方向へ向く） */
  missile?: boolean;
  /** 撃ち落とせる弾にする（hp 指定） */
  shootable?: boolean;
  hp?: number;
  homing?: Projectile['homing'];
  blast?: Projectile['blast'];
  trail?: number;
}

const geoCache = new Map<number, THREE.SphereGeometry>();
let missileGeos: { body: THREE.BufferGeometry; nose: THREE.BufferGeometry; flame: THREE.BufferGeometry } | null = null;

/** ミサイルの見た目（+Z が先端）。マテリアルは弾ごとに新規 */
function makeMissileMesh(scale: number): THREE.Group {
  if (!missileGeos) {
    const body = new THREE.CapsuleGeometry(0.1, 0.45, 3, 8); body.rotateX(Math.PI / 2);
    const nose = new THREE.ConeGeometry(0.1, 0.22, 8); nose.rotateX(Math.PI / 2); nose.translate(0, 0, 0.47);
    const flame = new THREE.SphereGeometry(0.1, 8, 6); flame.translate(0, 0, -0.38);
    missileGeos = { body, nose, flame };
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(missileGeos.body, new THREE.MeshStandardMaterial({ color: 0xf2f5fa, roughness: 0.4 })));
  g.add(new THREE.Mesh(missileGeos.nose, new THREE.MeshStandardMaterial({ color: 0xff7a3d, emissive: 0xff5a20, emissiveIntensity: 1.2 })));
  const fl = new THREE.Mesh(missileGeos.flame, new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.9, depthWrite: false }));
  fl.scale.set(1.2, 1.2, 2.2);
  g.add(fl);
  g.scale.setScalar(scale);
  return g;
}

export function spawnProjectile(world: World, o: SpawnProjectileOpts): Projectile {
  const radius = o.radius ?? 0.12;
  const size = o.size ?? radius;
  const color = o.color ?? (o.owner === 'player' ? 0x66e6ff : 0xff7a3d);
  let mesh: THREE.Object3D;
  if (o.missile) {
    mesh = makeMissileMesh(size / 0.3);
  } else if (o.blast?.damage !== undefined && o.owner === 'enemy') {
    mesh = makeOrbMesh(size, color);
  } else {
    const key = Math.round(size * 1000);
    let geo = geoCache.get(key);
    if (!geo) { geo = new THREE.SphereGeometry(size, 12, 8); geoCache.set(key, geo); }
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const m = new THREE.Mesh(geo, mat);
    const glow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
    glow.scale.setScalar(2.2);
    m.add(glow);
    mesh = m;
  }
  mesh.position.copy(o.pos);
  world.scene.add(mesh);
  const p: Projectile = {
    pos: o.pos.clone(), vel: o.vel.clone(), radius, damage: o.damage, owner: o.owner,
    life: o.life ?? GUN.bulletLife, mesh, charged: o.charged, gravity: o.gravity ?? 0,
    shootable: o.shootable, hp: o.hp, homing: o.homing, blast: o.blast, orient: o.missile, trail: o.trail,
  };
  if (p.orient) orientMesh(p);
  if (o.blast?.warnRing) addLandingRing(world, p);
  world.projectiles.push(p);
  return p;
}

// ------------------------------------------------------------------ 電気の球（範囲ダメージ弾）
/** 球・輪の共有ジオメトリ（dispose しない） */
let orbGeos: { core: THREE.SphereGeometry; arc: THREE.BoxGeometry; ring: THREE.RingGeometry; disc: THREE.CircleGeometry } | null = null;
function getOrbGeos() {
  if (!orbGeos) {
    const ring = new THREE.RingGeometry(0.93, 1, 56); ring.rotateX(-Math.PI / 2);
    const disc = new THREE.CircleGeometry(1, 40); disc.rotateX(-Math.PI / 2);
    orbGeos = { core: new THREE.SphereGeometry(1, 14, 10), arc: new THREE.BoxGeometry(0.05, 0.05, 1), ring, disc };
  }
  return orbGeos;
}

/** 電気の球：白い芯 + 青い光の殻 + ばちばち走る火花。userData.orb を毎フレーム updateOrb が動かす */
function makeOrbMesh(size: number, color: number): THREE.Group {
  const g = getOrbGeos();
  const grp = new THREE.Group();
  const core = new THREE.Mesh(g.core, new THREE.MeshBasicMaterial({ color: 0xeaffff }));
  core.scale.setScalar(size * 0.7);
  const shell = new THREE.Mesh(g.core, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }));
  shell.scale.setScalar(size);
  const halo = new THREE.Mesh(g.core, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false }));
  halo.scale.setScalar(size * 1.9);
  const crackle = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const arc = new THREE.Mesh(g.arc, new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffffff : 0xbfeaff }));
    arc.scale.set(1, 1, size * 2.6);
    arc.position.z = size * 0.9;
    const holder = new THREE.Group();
    holder.add(arc);
    crackle.add(holder);
  }
  grp.add(halo, shell, core, crackle);
  grp.userData.orb = { crackle, halo, size };
  return grp;
}

/** 球のばちばち：火花の向きをランダムに振り直し、光をゆらす */
function updateOrb(p: Projectile, dt: number): void {
  const o = p.mesh.userData.orb as { crackle: THREE.Group; halo: THREE.Mesh; size: number } | undefined;
  if (!o) return;
  o.crackle.rotation.y += dt * 9;
  for (const h of o.crackle.children) {
    if (Math.random() < 0.45) {
      h.rotation.set((Math.random() - 0.5) * 6, Math.random() * 6.28, (Math.random() - 0.5) * 6);
      h.visible = Math.random() < 0.8;
    }
  }
  o.halo.scale.setScalar(o.size * (1.7 + 0.5 * Math.random()));
}

/** 着弾予測：今の速度・重力で飛ばしたとき最初に当たる地点と時間 */
function predictLanding(world: World, p: Projectile): { pos: THREE.Vector3; t: number } | null {
  const q = p.pos.clone(), v = p.vel.clone(), n = new THREE.Vector3();
  const dt = 1 / 30;
  for (let t = 0; t < p.life; t += dt) {
    v.y -= (p.gravity ?? 0) * dt;
    n.copy(q).addScaledVector(v, dt);
    const th = raycastLevel(world.colliders, q, n);
    if (th !== null) return { pos: q.lerp(n, th), t: t + dt * th };
    q.copy(n);
  }
  return null;
}

/** 着弾予測地点の警告の輪（爆発の範囲を示す。球が近づくほど濃く脈打つ） */
function addLandingRing(world: World, p: Projectile): void {
  const b = p.blast;
  if (!b) return;
  const hit = predictLanding(world, p);
  if (!hit) return;
  // 壁に当たる場合は真下の床に輪を置く
  const below = hit.pos.clone(); below.y -= 40;
  const up = hit.pos.clone(); up.y += 0.3;
  const tf = raycastLevel(world.colliders, up, below);
  const at = tf !== null ? up.lerp(below, tf) : hit.pos.clone();
  at.y += 0.05;
  const g = getOrbGeos();
  const grp = new THREE.Group();
  const mk = (geo: THREE.BufferGeometry, sc: number, opacity: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff5a3a, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    m.scale.set(sc, 1, sc);
    m.renderOrder = 2;
    grp.add(m);
    return m;
  };
  const fill = mk(g.disc, b.radius, 0.12);
  const outer = mk(g.ring, b.radius, 0.9);
  const mid = mk(g.ring, b.radius * 0.5, 0.55);
  const core = mk(g.disc, b.radius * 0.16, 0.7);
  grp.position.copy(at);
  world.scene.add(grp);
  p.mesh.userData.ring = { grp, fill, outer, mid, core, fly: Math.max(0.2, hit.t) };
}

/** 警告の輪の脈動（球の飛行が進むほど濃くなる） */
function updateRing(p: Projectile): void {
  const r = p.mesh.userData.ring as { fill: THREE.Mesh; outer: THREE.Mesh; mid: THREE.Mesh; core: THREE.Mesh; fly: number } | undefined;
  if (!r) return;
  const k = Math.min(1, (p.age ?? 0) / r.fly);
  const pulse = 0.65 + 0.35 * Math.sin((p.age ?? 0) * (10 + 14 * k));
  const op = (m: THREE.Mesh, v: number): void => { (m.material as THREE.MeshBasicMaterial).opacity = v; };
  op(r.fill, 0.08 + 0.2 * k * pulse);
  op(r.outer, (0.5 + 0.5 * k) * (0.6 + 0.4 * pulse));
  op(r.mid, (0.3 + 0.5 * k) * pulse);
  op(r.core, 0.4 + 0.5 * k * pulse);
}

/** 警告の輪を片付ける */
function removeRing(world: World, p: Projectile): void {
  const r = p.mesh.userData.ring as { grp: THREE.Group } | undefined;
  if (!r) return;
  world.scene.remove(r.grp);
  disposeMaterials(r.grp);
  p.mesh.userData.ring = undefined;
}

const _Z = new THREE.Vector3(0, 0, 1);
const _d = new THREE.Vector3();
function orientMesh(p: Projectile): void {
  if (p.vel.lengthSq() < 1e-6) return;
  p.mesh.quaternion.setFromUnitVectors(_Z, _d.copy(p.vel).normalize());
}

/** 敵弾のホーミング（旋回速度制限つき） */
function steer(world: World, p: Projectile, pc: THREE.Vector3, dt: number): void {
  const h = p.homing;
  if (!h || (p.age ?? 0) < (h.delay ?? 0)) return;
  let sp = p.vel.length();
  if (h.speed !== undefined) {
    const a = (h.accel ?? 12) * dt;
    sp = sp < h.speed ? Math.min(h.speed, sp + a) : Math.max(h.speed, sp - a);
  }
  if (sp < 1e-4) return;
  const cur = _d.copy(p.vel).divideScalar(p.vel.length() || 1);
  const want = pc.clone().sub(p.pos).normalize();
  const ang = Math.acos(THREE.MathUtils.clamp(cur.dot(want), -1, 1));
  if (ang > 1e-4) cur.lerp(want, Math.min(1, (h.turnRate * dt) / ang)).normalize();
  p.vel.copy(cur).multiplyScalar(sp);
  void world;
}

/** 撃ち落とされた：無害に爆散 */
/** 撃ち落とせる敵弾を壊す（弾・吸収アームが当たったとき） */
export function shootDown(world: World, q: Projectile): void {
  q.dead = true;
  // 範囲ダメージ弾（電気の球）は撃ち落としても無害：小さな火花だけ。ミサイルなどは従来どおり
  const harmless = q.blast?.damage !== undefined;
  spawnBurst(world, q.pos, harmless ? (q.blast?.color ?? 0x7fe0ff) : 0xffd070, 10, 4);
  spawnBurst(world, q.pos, 0xffffff, 5, 2.5);
  spawnShockwave(world, q.pos, harmless ? (q.blast?.color ?? 0x7fe0ff) : 0xffb070, harmless ? 0.9 : (q.blast?.radius ?? 1) * 0.8, 0.25);
  world.events.emit('impact', { pos: q.pos.clone(), owner: 'player' });
  if (q.orient) world.events.emit('missileDown', { pos: q.pos.clone() });
}

/**
 * 範囲ダメージの倍率。dist は爆発の中心からプレイヤーの当たり球の表面までの距離。
 * 中心で 1、範囲の端で minMul、範囲の外は 0
 */
export function blastFalloff(dist: number, radius: number, minMul = 0.25): number {
  if (dist >= radius) return 0;
  return 1 - (1 - minMul) * (Math.max(0, dist) / radius);
}

const _bd = new THREE.Vector3();
const _bf = new THREE.Vector3();

function blastAt(world: World, p: Projectile, pos: THREE.Vector3): void {
  const b = p.blast;
  if (!b) return;
  if (p.orient) world.events.emit('missileBlast', { pos: pos.clone() });
  if (b.damage === undefined) {
    spawnShockwave(world, pos, b.color, b.radius, 0.3);
    spawnBurst(world, pos, b.color, 10, 4);
    return;
  }
  // 電気の爆発：大きな衝撃波 + 火花 + 閃光
  spawnShockwave(world, pos, b.color, b.radius, 0.4);
  spawnShockwave(world, pos, 0xffffff, b.radius * 0.55, 0.22);
  spawnBurst(world, pos, b.color, 26, 8, 0.55);
  spawnBurst(world, pos, 0xffffff, 12, 5, 0.4);
  spawnFlash(world, pos, 0xbfeaff, 10, 14, 0.2);
  world.events.emit('enemyAction', { kind: 'bomber', pos: pos.clone(), action: 'bombBlast' });
  // プレイヤーへ：中心からの距離で減衰（遮蔽物の向こうには届かない）
  const pc = playerCenter(world, _bd);
  const dist = pos.distanceTo(pc) - PLAYER_HIT_RADIUS;
  const mul = blastFalloff(dist, b.radius, b.minMul);
  if (mul <= 0) return;
  _bf.copy(pos); _bf.y += 0.2;
  const t = raycastLevel(world.colliders, _bf, pc);
  if (t !== null && t < 0.98) return;
  damagePlayer(world, b.damage * mul);
}

/** 弾の当たり判定にかける余裕（撃ち落としやすく） */
const SHOOT_PAD = 0.25;

export function updateProjectiles(world: World, dt: number): void {
  const pc = playerCenter(world);
  const next = new THREE.Vector3();
  for (const p of world.projectiles) {
    if (p.dead) continue;
    p.life -= dt;
    if (p.life <= 0) {
      if (p.blast?.onExpire) blastAt(world, p, p.pos);
      p.dead = true;
      continue;
    }
    p.age = (p.age ?? 0) + dt;
    if (p.gravity) p.vel.y -= p.gravity * dt;
    if (p.homing) steer(world, p, pc, dt);
    next.copy(p.pos).addScaledVector(p.vel, dt);

    const tLevel = raycastLevel(world.colliders, p.pos, next);
    let tHit = tLevel ?? Infinity;

    if (p.owner === 'player') {
      const hit = raycastEnemies(world.enemies, p.pos, next, p.radius);
      // 撃ち落とせる敵弾
      let tm = Infinity, target: Projectile | null = null;
      for (const q of world.projectiles) {
        if (q.dead || !q.shootable || q.owner !== 'enemy') continue;
        const t = segmentSphere(p.pos, next, q.pos, q.radius + p.radius + SHOOT_PAD);
        if (t !== null && t < tm) { tm = t; target = q; }
      }
      if (target && tm <= tHit && tm <= (hit ? hit.t : Infinity)) {
        target.hp = (target.hp ?? 1) - p.damage;
        if (target.hp <= 0) shootDown(world, target);
        else spawnBurst(world, target.pos, 0xffd070, 4, 3);
        p.dead = true;
        continue;
      }
      // 電源ソケット（装置）に当たったら作動
      let sockHit = false;
      for (const s of getSockets(world)) {
        if (!s.enabled) continue;
        const t = segmentSphere(p.pos, next, s.pos, s.radius + p.radius);
        if (t !== null && t <= tHit && t <= (hit ? hit.t : Infinity)) { s.onShot(); sockHit = true; break; }
      }
      if (sockHit) {
        spawnBurst(world, p.pos.clone().lerp(next, 0.5), 0x66e6ff, 7, 3);
        p.dead = true;
        continue;
      }
      if (hit && hit.t <= tHit) {
        damageEnemy(world, hit.enemy, p.damage, { weak: hit.weak, how: 'shot', hitPos: hit.point });
        spawnBurst(world, hit.point, hit.weak ? 0xfff27a : 0x66e6ff, p.charged ? 18 : 7, p.charged ? 5 : 3);
        p.dead = true;
        continue;
      }
    } else {
      const t = segmentSphere(p.pos, next, pc, PLAYER_HIT_RADIUS + p.radius);
      if (t !== null && t <= tHit) {
        const area = p.blast?.damage !== undefined;
        // 範囲ダメージ弾は爆発の範囲ダメージだけ（直撃の二重取りはしない）
        if (!area) damagePlayer(world, p.damage);
        const hp = p.pos.clone().lerp(next, t);
        if (!area) spawnBurst(world, hp, 0xff7a3d, 6, 3);
        blastAt(world, p, hp);
        p.dead = true;
        continue;
      }
    }

    if (tLevel !== null) {
      const hp = p.pos.clone().lerp(next, tLevel);
      if (p.blast?.damage === undefined) {
        world.events.emit('impact', { pos: hp, owner: p.owner });
        spawnBurst(world, hp, p.owner === 'player' ? 0x66e6ff : 0xff7a3d, p.charged ? 14 : 5, p.charged ? 4 : 2);
      }
      blastAt(world, p, hp);
      p.dead = true;
      continue;
    }
    p.pos.copy(next);
    p.mesh.position.copy(p.pos);
    if (p.orient) orientMesh(p);
    updateOrb(p, dt);
    updateRing(p);
    if (p.trail !== undefined) {
      p.trailT = (p.trailT ?? 0) - dt;
      if (p.trailT <= 0) { p.trailT = 0.07; spawnBurst(world, p.pos, p.trail, 1, 0.6, 0.3); }
    }
  }
  // 掃除
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i];
    if (p.dead) {
      removeRing(world, p);
      world.scene.remove(p.mesh);
      disposeMaterials(p.mesh);
      world.projectiles.splice(i, 1);
    }
  }
}

function disposeMaterials(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = (c as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) m.forEach((x) => x.dispose()); else m?.dispose();
  });
}
