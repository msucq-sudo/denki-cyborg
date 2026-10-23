import * as THREE from 'three';
import type { Projectile, ProjectileOwner, World } from './types';
import { raycastLevel, segmentSphere } from './collision';
import { raycastEnemies } from './enemyUtil';
import { damagePlayer, playerCenter, PLAYER_HIT_RADIUS } from './combat';
import { damageEnemy } from '../enemies/api';
import { spawnBurst } from './effects';
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
}

const geoCache = new Map<number, THREE.SphereGeometry>();

export function spawnProjectile(world: World, o: SpawnProjectileOpts): Projectile {
  const radius = o.radius ?? 0.12;
  const size = o.size ?? radius;
  const color = o.color ?? (o.owner === 'player' ? 0x66e6ff : 0xff7a3d);
  const key = Math.round(size * 1000);
  let geo = geoCache.get(key);
  if (!geo) { geo = new THREE.SphereGeometry(size, 12, 8); geoCache.set(key, geo); }
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const mesh = new THREE.Mesh(geo, mat);
  const glow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
  glow.scale.setScalar(2.2);
  mesh.add(glow);
  mesh.position.copy(o.pos);
  world.scene.add(mesh);
  const p: Projectile = {
    pos: o.pos.clone(), vel: o.vel.clone(), radius, damage: o.damage, owner: o.owner,
    life: o.life ?? GUN.bulletLife, mesh, charged: o.charged, gravity: o.gravity ?? 0,
  };
  world.projectiles.push(p);
  return p;
}

export function updateProjectiles(world: World, dt: number): void {
  const pc = playerCenter(world);
  const next = new THREE.Vector3();
  for (const p of world.projectiles) {
    if (p.dead) continue;
    p.life -= dt;
    if (p.life <= 0) { p.dead = true; continue; }
    if (p.gravity) p.vel.y -= p.gravity * dt;
    next.copy(p.pos).addScaledVector(p.vel, dt);

    const tLevel = raycastLevel(world.colliders, p.pos, next);
    let tHit = tLevel ?? Infinity;

    if (p.owner === 'player') {
      const hit = raycastEnemies(world.enemies, p.pos, next, p.radius);
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
        spawnBurst(world, p.pos.clone().lerp(next, t), 0xff7a3d, 6, 3);
        p.dead = true;
        continue;
      }
    }

    if (tLevel !== null) {
      const hp = p.pos.clone().lerp(next, tLevel);
      world.events.emit('impact', { pos: hp, owner: p.owner });
      spawnBurst(world, hp, p.owner === 'player' ? 0x66e6ff : 0xff7a3d, p.charged ? 14 : 5, p.charged ? 4 : 2);
      p.dead = true;
      continue;
    }
    p.pos.copy(next);
    p.mesh.position.copy(p.pos);
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
