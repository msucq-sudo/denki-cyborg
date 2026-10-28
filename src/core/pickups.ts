// 敵が落とす「メタル」（強化素材）。散らばって床で跳ね、近づくと吸い寄せられて拾える。
// 状態はすべて world.drops / world.inventory に持つ（リトライで World ごと作り直すため）
import * as THREE from 'three';
import { METAL, type EnemyKind } from '../config/balance';
import type { World } from './types';
import { raycastLevel } from './collision';
import { playerCenter } from './combat';
import { spawnBurst } from './effects';

export interface MetalDrop {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  value: number;
  age: number;
  resting: boolean;
  spin: number;
}

// 見た目（共有ジオメトリ・マテリアル）：六角ナット型の金属片＋青い光
let geo: THREE.CylinderGeometry | null = null;
let holeGeo: THREE.CylinderGeometry | null = null;
let mat: THREE.MeshStandardMaterial | null = null;
let glowMat: THREE.MeshBasicMaterial | null = null;
function makeMesh(value: number): THREE.Object3D {
  geo ??= new THREE.CylinderGeometry(0.16, 0.16, 0.09, 6);
  holeGeo ??= new THREE.CylinderGeometry(0.065, 0.065, 0.1, 10);
  mat ??= new THREE.MeshStandardMaterial({ color: 0xc9d3e0, metalness: 0.85, roughness: 0.3, emissive: 0x2a5aa0, emissiveIntensity: 0.6, flatShading: true });
  glowMat ??= new THREE.MeshBasicMaterial({ color: 0x5ab8ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  const g = new THREE.Group();
  const nut = new THREE.Mesh(geo, mat);
  nut.castShadow = true;
  g.add(nut);
  const hole = new THREE.Mesh(holeGeo, glowMat);
  g.add(hole);
  const s = 1 + Math.min(1, (value - 1) * 0.25); // 量が多いかけらは大きめ
  g.scale.setScalar(s);
  return g;
}

/** 敵が倒れた位置にメタルをばらまく。mul=量の倍率（逆流で爆発させたボーナスなど） */
export function spawnMetalDrop(world: World, kind: EnemyKind, pos: THREE.Vector3, mul = 1): void {
  const total = Math.round((METAL.drop[kind] ?? 0) * mul);
  if (total <= 0) return;
  const pieces = Math.min(total, METAL.maxPieces);
  let left = total;
  for (let i = 0; i < pieces; i++) {
    const v = i === pieces - 1 ? left : Math.max(1, Math.floor(total / pieces));
    left -= v;
    const a = Math.random() * Math.PI * 2;
    const sp = 2 + Math.random() * 2.5;
    const d: MetalDrop = {
      mesh: makeMesh(v),
      pos: pos.clone().add(new THREE.Vector3(0, 0.3, 0)),
      vel: new THREE.Vector3(Math.cos(a) * sp, 5 + Math.random() * 3, Math.sin(a) * sp),
      value: v, age: 0, resting: false, spin: (Math.random() - 0.5) * 10,
    };
    d.mesh.position.copy(d.pos);
    world.scene.add(d.mesh);
    world.drops.push(d);
  }
}

const _next = new THREE.Vector3();
const _pc = new THREE.Vector3();

export function updatePickups(world: World, dt: number): void {
  if (world.drops.length === 0) return;
  playerCenter(world, _pc);
  for (const d of world.drops) {
    d.age += dt;
    const dist = d.pos.distanceTo(_pc);
    if (dist < METAL.magnetRadius && d.age > 0.45) {
      // 吸い寄せ
      const dir = _next.copy(_pc).sub(d.pos).normalize();
      const k = 1 - dist / METAL.magnetRadius;
      d.vel.lerp(dir.multiplyScalar(METAL.magnetSpeed * (0.4 + k)), Math.min(1, dt * 8));
      d.pos.addScaledVector(d.vel, dt);
      d.resting = false;
    } else if (!d.resting) {
      // 落下・バウンド
      d.vel.y -= 22 * dt;
      _next.copy(d.pos).addScaledVector(d.vel, dt);
      const t = raycastLevel(world.colliders, d.pos, _next);
      if (t !== null) {
        d.pos.lerp(_next, Math.max(0, t - 0.02));
        if (d.vel.y < 0) {
          d.vel.y = -d.vel.y * 0.35;
          d.vel.x *= 0.6; d.vel.z *= 0.6;
          if (Math.abs(d.vel.y) < 1.2) { d.resting = true; d.vel.set(0, 0, 0); }
        } else d.vel.multiplyScalar(-0.3);
      } else d.pos.copy(_next);
    }
    // 見た目：回転＋ふわふわ
    d.mesh.position.copy(d.pos);
    if (d.resting) d.mesh.position.y += 0.18 + Math.sin(world.time * 3 + d.spin) * 0.05;
    d.mesh.rotation.set(0.5, d.mesh.rotation.y + dt * (2 + Math.abs(d.spin) * 0.2), 0.3);
    // 拾う
    if (dist < METAL.pickupRadius && d.age > 0.3) {
      world.inventory.metal += d.value;
      world.events.emit('metalPickup', { amount: d.value, total: world.inventory.metal });
      spawnBurst(world, d.pos, 0x9cd4ff, 4, 2, 0.25);
      d.age = Infinity; // 削除マーク
    }
  }
  for (let i = world.drops.length - 1; i >= 0; i--) {
    const d = world.drops[i];
    if (d.age === Infinity || d.age > METAL.life) {
      world.scene.remove(d.mesh);
      world.drops.splice(i, 1);
    }
  }
}
