// ホログラムデコイ（罠アイテム。ドレイン装置へ向かうダンジョンの A の地下で入手 → world.unlocks.decoy）。
// N キー（パッドは右スティック押し込み）で、プレイヤーそっくりのホログラムを DECOY.count 体、自分のまわりに出す。
// DECOY.duration 秒のあいだ、敵は本物のプレイヤーではなくホログラムを狙って撃つ（enemies/common.ts の makeCtx が decoyTarget を見る）。
// 敵の弾がホログラムに触れると弾はかき消える。ホログラムは攻撃を受けない（当たらない）。使うと電力を DECOY.cost 使い、DECOY.cooldown 秒の待ち時間。
import * as THREE from 'three';
import type { World } from '../core/types';
import { hasLineOfSight } from '../core/collision';
import { spendEnergy } from '../core/energy';
import { spawnBurst } from '../core/effects';
import { PLAYER } from '../config/balance';

export const DECOY = {
  /** 出すホログラムの数 */
  count: 3,
  /** 持続（秒） */
  duration: 10,
  /** 再使用までの待ち（秒。使った瞬間から数える） */
  cooldown: 14,
  /** 1回の電力消費 */
  cost: 6,
  /** プレイヤーからの散らし幅（m） */
  spread: 2.8,
  /** 使うキー */
  key: 'KeyN',
  /** 敵の弾がかき消える距離（ホログラムの体の中心から） */
  blockRadius: 0.8,
} as const;

interface Holo { root: THREE.Group; chest: THREE.Vector3; phase: number }
interface DecoyState { holos: Holo[]; t: number; cooldown: number }
const states = new WeakMap<World, DecoyState>();

function st(world: World): DecoyState {
  let s = states.get(world);
  if (!s) states.set(world, (s = { holos: [], t: 0, cooldown: 0 }));
  return s;
}

/** ホログラムが出ている（敵がそちらを狙う）か */
export function decoyActive(world: World): boolean { return st(world).holos.length > 0; }
/** 出ているホログラムの体の中心（テスト・表示用） */
export function decoyPositions(world: World): THREE.Vector3[] { return st(world).holos.map((h) => h.chest.clone()); }
/** 残り持続（秒）と再使用までの待ち（秒） */
export function decoyTimers(world: World): { remaining: number; cooldown: number } {
  const s = st(world);
  return { remaining: s.holos.length ? s.t : 0, cooldown: s.cooldown };
}

/** from から一番近いホログラムの体の中心（新しい Vector3）。出ていなければ null */
export function decoyTarget(world: World, from: THREE.Vector3): THREE.Vector3 | null {
  const s = states.get(world);
  if (!s || s.holos.length === 0) return null;
  let best: Holo | null = null, bd = Infinity;
  for (const h of s.holos) {
    const d = h.chest.distanceToSquared(from);
    if (d < bd) { bd = d; best = h; }
  }
  return best ? best.chest.clone() : null;
}

/** ホログラムデコイを入手した */
export function giveDecoy(world: World): void { world.unlocks.decoy = true; }

const holoMat = new THREE.MeshBasicMaterial({ color: 0x66e6ff, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, wireframe: false });

function buildHolo(world: World): THREE.Group {
  const g = new THREE.Group();
  g.name = 'hologram-decoy';
  // プレイヤーの見た目をそのまま複製して、ホログラムの材質に差し替える
  const copy = world.player.root.clone(true);
  copy.position.set(0, 0, 0);
  copy.rotation.set(0, 0, 0);
  copy.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.material = holoMat; m.castShadow = false; m.receiveShadow = false; }
  });
  g.add(copy);
  // 足元の光る輪と、たて方向の走査線
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 28), new THREE.MeshBasicMaterial({ color: 0x7af0ff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  g.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.1, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x66e6ff, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beam.position.y = 1.0;
  g.add(beam);
  return g;
}

/** 使えない理由（使えるなら null） */
export function canUseDecoy(world: World): 'locked' | 'cooldown' | 'energy' | null {
  if (!world.unlocks.decoy) return 'locked';
  if (st(world).cooldown > 0) return 'cooldown';
  if (world.player.energy < DECOY.cost) return 'energy';
  return null;
}

/** ホログラムを出す。出せたら true */
export function useDecoy(world: World): boolean {
  const why = canUseDecoy(world);
  if (why) {
    if (why === 'cooldown') world.toasts.push({ text: 'ホログラムデコイはまだ使えない', timer: 1.2 });
    else if (why === 'energy') world.events.emit('noEnergy', {});
    return false;
  }
  if (!spendEnergy(world, DECOY.cost)) return false;
  const s = st(world);
  clearHolos(world, s);
  const p = world.player;
  const chestY = PLAYER.height * 0.5;
  const me = new THREE.Vector3(p.pos.x, p.pos.y + chestY, p.pos.z);
  // 自分の前方を中心に、横一列から少し弧を描いて並べる（左・正面・右）
  const fx = Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  const rx = -fz, rz = fx;
  const offs: [number, number][] = [[-1, 0.9], [0, 2.2], [1, 0.9]];
  for (let i = 0; i < DECOY.count; i++) {
    const [lat, fwd] = offs[i % offs.length];
    let k = 1;
    const target = new THREE.Vector3();
    for (let tries = 0; tries < 4; tries++, k *= 0.55) {
      target.set(p.pos.x + rx * lat * DECOY.spread * k + fx * fwd * k, p.pos.y, p.pos.z + rz * lat * DECOY.spread * k + fz * fwd * k);
      if (hasLineOfSight(world.colliders, me, new THREE.Vector3(target.x, target.y + chestY, target.z))) break;
    }
    const root = buildHolo(world);
    root.position.copy(target);
    root.rotation.y = p.yaw;
    world.scene.add(root);
    s.holos.push({ root, chest: new THREE.Vector3(target.x, target.y + chestY, target.z), phase: Math.random() * 6 });
    spawnBurst(world, root.position.clone().setY(target.y + 1), 0x66e6ff, 10, 3, 0.4);
  }
  s.t = DECOY.duration;
  s.cooldown = DECOY.cooldown;
  world.events.emit('decoyUse', { pos: p.pos.clone() });
  world.toasts.push({ text: `ホログラムを${DECOY.count}体出した（${DECOY.duration}秒）`, timer: 2 });
  return true;
}

function clearHolos(world: World, s: DecoyState): void {
  for (const h of s.holos) {
    spawnBurst(world, h.chest.clone(), 0x66e6ff, 6, 2, 0.3);
    h.root.removeFromParent();
  }
  s.holos = [];
}

/** 毎フレーム：持続・待ち時間の更新、ゆらぎ、キー入力、敵弾のかき消し */
export function updateDecoy(world: World, dt: number): void {
  const s = st(world);
  s.cooldown = Math.max(0, s.cooldown - dt);
  if (world.state === 'playing' && !world.hack.active && world.player.hp > 0 && world.input.pressed(DECOY.key)) useDecoy(world);
  if (s.holos.length === 0) return;
  s.t -= dt;
  if (s.t <= 0) { clearHolos(world, s); world.events.emit('decoyEnd', {}); return; }
  const blink = s.t < 2 ? (Math.sin(s.t * 18) > 0 ? 1 : 0.3) : 1;
  for (const h of s.holos) {
    h.phase += dt;
    h.root.position.y = h.chest.y - PLAYER.height * 0.5 + Math.sin(h.phase * 2.4) * 0.04;
    holoMat.opacity = 0.32 + 0.2 * (0.5 + 0.5 * Math.sin(h.phase * 9)) * blink;
  }
  // 敵の弾はホログラムに触れるとかき消える
  for (const q of world.projectiles) {
    if (q.dead || q.owner !== 'enemy') continue;
    for (const h of s.holos) {
      if (q.pos.distanceTo(h.chest) < DECOY.blockRadius + q.radius) {
        q.dead = true;
        spawnBurst(world, q.pos.clone(), 0x66e6ff, 6, 3, 0.3);
        break;
      }
    }
  }
}

/** ワールドを作り直すときの後始末（テスト用） */
export function resetDecoy(world: World): void {
  const s = states.get(world);
  if (s) clearHolos(world, s);
  states.delete(world);
}

/** ホログラムデコイの入手アイテムの見た目（浮かぶ円盤＋立体の人影） */
export function buildDecoyPickup(): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.12, 20), new THREE.MeshStandardMaterial({ color: 0x2b3a50, metalness: 0.7, roughness: 0.35 }));
  g.add(base);
  const mat = new THREE.MeshBasicMaterial({ color: 0x66e6ff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.32, 4, 8), mat);
  body.position.y = 0.45;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat);
  head.position.y = 0.82;
  g.add(head);
  for (const y of [0.08, 0.3]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.02, 6, 24), mat);
    r.rotation.x = Math.PI / 2;
    r.position.y = y;
    g.add(r);
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.45, 5, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0x66e6ff, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beam.position.y = 2.5;
  g.add(beam);
  return g;
}
