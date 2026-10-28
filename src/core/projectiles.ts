import * as THREE from 'three';
import type { Projectile, ProjectileOwner, World } from './types';
import { raycastLevel, segmentSphere } from './collision';
import { getSockets } from './sockets';
import { raycastEnemies } from './enemyUtil';
import { damagePlayer, playerCenter, PLAYER_HIT_RADIUS } from './combat';
import { damageEnemy } from '../enemies/api';
import { spawnBurst, spawnShockwave } from './effects';
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
  world.projectiles.push(p);
  return p;
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
  spawnBurst(world, q.pos, 0xffd070, 10, 4);
  spawnBurst(world, q.pos, 0xffffff, 5, 2.5);
  spawnShockwave(world, q.pos, 0xffb070, (q.blast?.radius ?? 1) * 0.8, 0.25);
  world.events.emit('impact', { pos: q.pos.clone(), owner: 'player' });
  if (q.orient) world.events.emit('missileDown', { pos: q.pos.clone() });
}

function blastAt(world: World, p: Projectile, pos: THREE.Vector3): void {
  if (!p.blast) return;
  if (p.orient) world.events.emit('missileBlast', { pos: pos.clone() });
  spawnShockwave(world, pos, p.blast.color, p.blast.radius, 0.3);
  spawnBurst(world, pos, p.blast.color, 10, 4);
}

/** 弾の当たり判定にかける余裕（撃ち落としやすく） */
const SHOOT_PAD = 0.25;

export function updateProjectiles(world: World, dt: number): void {
  const pc = playerCenter(world);
  const next = new THREE.Vector3();
  for (const p of world.projectiles) {
    if (p.dead) continue;
    p.life -= dt;
    if (p.life <= 0) { p.dead = true; continue; }
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
        damagePlayer(world, p.damage);
        const hp = p.pos.clone().lerp(next, t);
        spawnBurst(world, hp, 0xff7a3d, 6, 3);
        blastAt(world, p, hp);
        p.dead = true;
        continue;
      }
    }

    if (tLevel !== null) {
      const hp = p.pos.clone().lerp(next, tLevel);
      world.events.emit('impact', { pos: hp, owner: p.owner });
      spawnBurst(world, hp, p.owner === 'player' ? 0x66e6ff : 0xff7a3d, p.charged ? 14 : 5, p.charged ? 4 : 2);
      blastAt(world, p, hp);
      p.dead = true;
      continue;
    }
    p.pos.copy(next);
    p.mesh.position.copy(p.pos);
    if (p.orient) orientMesh(p);
    if (p.trail !== undefined) {
      p.trailT = (p.trailT ?? 0) - dt;
      if (p.trailT <= 0) { p.trailT = 0.07; spawnBurst(world, p.pos, p.trail, 1, 0.6, 0.3); }
    }
  }
  // 掃除
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i];
    if (p.dead) {
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
