// 敵が隠れている箱（木箱・金属のコンテナ）。プレイヤーが近づく／区画の戦闘が始まる／箱を撃つと、
// 箱がガタガタ揺れて（SPAWN_BOX.shake 秒）はじけ飛び、中から敵が飛び出して戦い始める。どのステージでも使える共通モジュール。
//
// 【使い方】（camp1.ts が使用例）
//   1) 作る（レベルの build で1回）：
//        const boxes = createSpawnBoxes(world, [
//          { kind: 'crawler', x: 10, z: 5, yaw: Math.PI },                 // 近づくと開く（既定 SPAWN_BOX.wakeRadius）
//          { kind: 'heavy', x: 20, z: 8, wakeRadius: 0, style: 'container' }, // 0＝近づいても開かない（トリガー専用）
//          { kind: 'drone', x: 4, z: 2, floor: 5 },                         // floor＝箱の置かれた床の高さ
//        ]);
//      箱の大きさは敵の大きさから自動（ドローン等は小箱、ヘビー系はコンテナ）。style で木箱／コンテナを指定もできる。
//      createSpawnBoxes は同じ World で何度呼んでもよい（全部 getSpawnBoxes(world) に入る）。
//   2) 毎フレーム（レベルの tick）：updateSpawnBoxes(world, dt)
//        近づいた・撃たれた箱が開く。開いた箱は box.enemy に敵が入る（それまでは null＝敵は World にいない：見えず、当たらず、動かない）。
//   3) きっかけで開ける：openSpawnBoxes(world, list, gap)（閉じ込め戦の開始など。gap 秒ずつずらす）／openSpawnBox(world, box, delay)
//   4) 状態：box.state（'closed'→'shaking'→'open'）、box.enemy、spawnBoxAlive(list)（まだ開いていない箱＋生きている敵の数）、
//      onOpen(box) コールバック（def.onOpen）で、開いたときに区画の他の箱も開けるなどができる。
//   後始末は不要（World ごとに持つ。World を作り直せば消える）。残骸は SPAWN_BOX.debrisLife 秒で消える。
import * as THREE from 'three';
import { ENEMIES, type EnemyKind } from '../config/balance';
import type { AABB, Enemy, World } from '../core/types';
import { segmentAABB } from '../core/collision';
import { spawnBurst } from '../core/effects';
import { spawnEnemy } from '../enemies/api';

/** 調整値（balance.ts には足さず、ここに置く：共通モジュールの既定値） */
export const SPAWN_BOX = {
  /** 近づくと開く距離（水平。m） */
  wakeRadius: 11,
  /** 揺れている時間（秒）。撃たれたときはもっと短い */
  shake: 0.5,
  shakeShot: 0.18,
  /** 残骸が残る時間（秒） */
  debrisLife: 3.5,
  /** 飛び出すときの速さ（前へ・上へ。m/s） */
  hopForward: 4,
  hopUp: 5,
};

/** コンテナ（大きな金属の箱）にする敵 */
const BIG: EnemyKind[] = ['heavy', 'heavyWalker', 'missile', 'beamer', 'boss', 'jumper'];
const AIR: EnemyKind[] = ['drone', 'leech', 'missileDrone', 'redDrone', 'boss'];

export interface SpawnBoxDef {
  kind: EnemyKind;
  x: number; z: number;
  /** 箱の置かれた床の高さ（既定 0） */
  floor?: number;
  /** 箱の正面（扉・敵が飛び出す向き）。+Z 基準の rad（敵の yaw と同じ）。既定 0 */
  yaw?: number;
  /** この水平距離まで来たら開く。0 なら近づいても開かない（openSpawnBox だけ）。既定 SPAWN_BOX.wakeRadius */
  wakeRadius?: number;
  /** 'crate'＝木箱、'container'＝金属のコンテナ。既定は敵の大きさで自動 */
  style?: 'crate' | 'container';
  /** 開いて敵が出た瞬間 */
  onOpen?: (box: SpawnBox) => void;
}

export type SpawnBoxState = 'closed' | 'shaking' | 'open';

export interface SpawnBox {
  def: SpawnBoxDef;
  style: 'crate' | 'container';
  /** 箱の大きさ（幅・奥行き・高さ） */
  size: { w: number; d: number; h: number };
  state: SpawnBoxState;
  /** 揺れ始めるまでの待ち（openSpawnBox の delay）と、揺れの経過 */
  delay: number;
  t: number;
  shakeTime: number;
  /** 開いた後の敵（開く前は null） */
  enemy: Enemy | null;
  group: THREE.Group;
  collider: AABB;
}

interface Debris { obj: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3; life: number; rest: boolean; floor: number; mats: THREE.Material[] }
interface Store { boxes: SpawnBox[]; debris: Debris[] }
const stores = new WeakMap<World, Store>();
function store(world: World): Store {
  let s = stores.get(world);
  if (!s) stores.set(world, (s = { boxes: [], debris: [] }));
  return s;
}

export function getSpawnBoxes(world: World): SpawnBox[] { return store(world).boxes; }

/** まだ開いていない箱（中身も生きているとみなす）＋開いて出てきた敵のうち生きている数 */
export function spawnBoxAlive(list: SpawnBox[]): number {
  let n = 0;
  for (const b of list) {
    if (b.state !== 'open') n++;
    else if (b.enemy && !b.enemy.allied && (b.enemy.status === 'active' || b.enemy.status === 'stunned')) n++;
  }
  return n;
}

/** 敵の種類に合う箱の大きさと種類 */
export function boxSizeFor(kind: EnemyKind, style?: 'crate' | 'container'): { style: 'crate' | 'container'; w: number; d: number; h: number } {
  const r = ENEMIES[kind].radius;
  const st = style ?? (BIG.includes(kind) ? 'container' : 'crate');
  if (st === 'container') {
    const w = Math.max(2.6, r * 2 + 1.0);
    return { style: st, w, d: w * 1.25, h: Math.max(2.6, r * 2 + 0.9) };
  }
  const s = Math.max(1.1, r * 2 + 0.5);
  return { style: st, w: s, d: s, h: Math.max(1.0, r * 2 + 0.35) };
}

// ---------------------------------------------------------------- 見た目
const WOOD = [0xb98a5a, 0xa8794b, 0xc49866];
function buildBox(style: 'crate' | 'container', w: number, d: number, h: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  if (style === 'crate') {
    const wood = new THREE.MeshStandardMaterial({ color: WOOD[seed % WOOD.length], roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 });
    // 6枚の板（はじけるときに1枚ずつ飛ぶ）。名前 'panel'
    const t = 0.08;
    const panels: [number, number, number, number, number, number][] = [
      [0, h / 2, d / 2 - t / 2, w, h, t], [0, h / 2, -d / 2 + t / 2, w, h, t],
      [w / 2 - t / 2, h / 2, 0, t, h, d - 2 * t], [-w / 2 + t / 2, h / 2, 0, t, h, d - 2 * t],
      [0, h - t / 2, 0, w - 2 * t, t, d - 2 * t], [0, t / 2, 0, w - 2 * t, t, d - 2 * t],
    ];
    for (const [x, y, z, sx, sy, sz] of panels) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wood);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.name = 'panel';
      // 板の補強（×の桟）
      if (sz === t || sx === t) {
        const along = sz === t ? 'x' : 'z';
        for (const s of [-1, 1]) {
          const brace = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? Math.hypot(sx, sy) * 0.9 : 0.1, 0.1, along === 'z' ? Math.hypot(sz, sy) * 0.9 : 0.1), dark);
          brace.position.set(along === 'x' ? 0 : (x > 0 ? 0.05 : -0.05), 0, along === 'z' ? 0 : (z > 0 ? 0.05 : -0.05));
          if (along === 'x') brace.rotation.z = s * Math.atan2(sy, sx); else brace.rotation.x = s * Math.atan2(sy, sz);
          m.add(brace);
        }
      }
      g.add(m);
    }
  } else {
    const steel = new THREE.MeshStandardMaterial({ color: [0x5b8fd8, 0xc8503c, 0x45b8b2][seed % 3], roughness: 0.55, metalness: 0.55 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x3a414c, roughness: 0.5, metalness: 0.7 });
    const body = new THREE.Group();
    body.name = 'body';
    const t = 0.1;
    // 背面・側面・天井・床（正面＝+Z は扉）
    for (const [x, y, z, sx, sy, sz] of [
      [0, h / 2, -d / 2 + t / 2, w, h, t], [w / 2 - t / 2, h / 2, 0, t, h, d], [-w / 2 + t / 2, h / 2, 0, t, h, d],
      [0, h - t / 2, 0, w, t, d], [0, t / 2, 0, w, t, d],
    ] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), steel);
      m.position.set(x, y, z);
      m.castShadow = true;
      body.add(m);
    }
    // 波板の筋
    for (let z = -d / 2 + 0.3; z < d / 2; z += 0.35) {
      for (const sx of [-1, 1]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, h * 0.92, 0.12), frame);
        r.position.set(sx * (w / 2 + 0.02), h / 2, z);
        body.add(r);
      }
    }
    g.add(body);
    // 扉2枚（ヒンジが左右の端）。名前 'doorL' / 'doorR'
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.name = side < 0 ? 'doorL' : 'doorR';
      hinge.position.set(side * (w / 2), 0, d / 2);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(w / 2, h, t), steel);
      leaf.position.set(-side * (w / 4), h / 2, 0);
      leaf.castShadow = true;
      hinge.add(leaf);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, h * 0.9, 0.12), frame);
      bar.position.set(-side * (w / 2 - 0.2), h / 2, 0.06);
      hinge.add(bar);
      g.add(hinge);
    }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.15), new THREE.MeshBasicMaterial({ color: 0xff3a2a }));
    lamp.position.set(0, h + 0.08, d / 2 - 0.2);
    lamp.name = 'lamp';
    g.add(lamp);
  }
  return g;
}

// ---------------------------------------------------------------- 作成
/** 箱を置く（中の敵はまだ作らない）。作った箱を返す（getSpawnBoxes(world) にも入る） */
export function createSpawnBoxes(world: World, defs: SpawnBoxDef[]): SpawnBox[] {
  const st = store(world);
  const out: SpawnBox[] = [];
  for (const def of defs) {
    const sz = boxSizeFor(def.kind, def.style);
    const group = buildBox(sz.style, sz.w, sz.d, sz.h, st.boxes.length + out.length);
    const fl = def.floor ?? 0;
    group.position.set(def.x, fl, def.z);
    group.rotation.y = def.yaw ?? 0;
    world.scene.add(group);
    // 当たり判定は向きによらず、回した箱を囲む（90°単位で置く想定）
    const yaw = def.yaw ?? 0;
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
    const hx = (sz.w * c + sz.d * s) / 2, hz = (sz.w * s + sz.d * c) / 2;
    const collider: AABB = { min: new THREE.Vector3(def.x - hx, fl, def.z - hz), max: new THREE.Vector3(def.x + hx, fl + sz.h, def.z + hz), active: true, tag: 'spawnBox' };
    world.colliders.push(collider);
    out.push({ def, style: sz.style, size: { w: sz.w, d: sz.d, h: sz.h }, state: 'closed', delay: 0, t: 0, shakeTime: SPAWN_BOX.shake, enemy: null, group, collider });
  }
  st.boxes.push(...out);
  return out;
}

/** 箱を開ける（delay 秒後に揺れ始め、揺れが終わるとはじけて敵が出る）。もう開いている／揺れているなら何もしない */
export function openSpawnBox(world: World, box: SpawnBox, delay = 0, shake = SPAWN_BOX.shake): void {
  if (box.state !== 'closed') return;
  box.state = 'shaking';
  box.delay = Math.max(0, delay);
  box.t = 0;
  box.shakeTime = shake;
  if (box.delay <= 0) startShake(world, box);
}
/** まとめて開ける（gap 秒ずつずらす） */
export function openSpawnBoxes(world: World, list: SpawnBox[], gap = 0.15): void {
  let i = 0;
  for (const b of list) if (b.state === 'closed') openSpawnBox(world, b, i++ * gap);
}

function startShake(world: World, box: SpawnBox): void {
  world.events.emit('enemyWakeWarn', { pos: box.group.position.clone().setY(box.group.position.y + box.size.h / 2), mode: 'pod' });
}

// ---------------------------------------------------------------- 更新
const _p1 = new THREE.Vector3();
const _fw = new THREE.Vector3();

export function updateSpawnBoxes(world: World, dt: number): void {
  const st = stores.get(world);
  if (!st) return;
  const p = world.player.pos;
  for (const b of st.boxes) {
    if (b.state === 'closed') {
      // 近づいた
      const wr = b.def.wakeRadius ?? SPAWN_BOX.wakeRadius;
      if (wr > 0 && Math.hypot(p.x - b.def.x, p.z - b.def.z) < wr && Math.abs(p.y - (b.def.floor ?? 0)) < 8 && world.player.hp > 0) openSpawnBox(world, b);
      // 撃たれた：早めに開く
      else if (hitByShot(world, b, dt)) openSpawnBox(world, b, 0, SPAWN_BOX.shakeShot);
    } else if (b.state === 'shaking') {
      if (b.delay > 0) {
        b.delay -= dt;
        if (b.delay <= 0) startShake(world, b);
        continue;
      }
      b.t += dt;
      // ガタガタ：だんだん激しく
      const k = Math.min(1, b.t / b.shakeTime);
      const a = 0.03 + 0.09 * k;
      const yaw = b.def.yaw ?? 0;
      b.group.position.set(b.def.x + (Math.random() - 0.5) * a * 2, (b.def.floor ?? 0) + Math.abs(Math.sin(b.t * 40)) * a, b.def.z + (Math.random() - 0.5) * a * 2);
      b.group.rotation.set((Math.random() - 0.5) * a, yaw + (Math.random() - 0.5) * a * 1.5, (Math.random() - 0.5) * a);
      if (b.t >= b.shakeTime) burst(world, st, b);
    }
  }
  // 残骸
  for (let i = st.debris.length - 1; i >= 0; i--) {
    const d = st.debris[i];
    d.life -= dt;
    if (!d.rest) {
      d.vel.y -= 18 * dt;
      d.obj.position.addScaledVector(d.vel, dt);
      d.obj.rotation.x += d.spin.x * dt; d.obj.rotation.y += d.spin.y * dt; d.obj.rotation.z += d.spin.z * dt;
      if (d.obj.position.y < d.floor + 0.05) {
        d.obj.position.y = d.floor + 0.05;
        if (Math.abs(d.vel.y) < 1.5) { d.rest = true; d.vel.set(0, 0, 0); }
        else { d.vel.y *= -0.3; d.vel.x *= 0.5; d.vel.z *= 0.5; d.spin.multiplyScalar(0.4); }
      }
    }
    if (d.life < 1) d.obj.scale.setScalar(Math.max(0.01, d.life));
    if (d.life <= 0) {
      d.obj.removeFromParent();
      d.obj.traverse((o) => { (o as THREE.Mesh).geometry?.dispose?.(); });
      st.debris.splice(i, 1);
    }
  }
}

/** 自分の弾が閉じた箱に当たるか（当たった弾は消す） */
function hitByShot(world: World, b: SpawnBox, dt: number): boolean {
  for (const q of world.projectiles) {
    if (q.dead || q.owner !== 'player') continue;
    _p1.copy(q.pos).addScaledVector(q.vel, dt * 1.5);
    if (segmentAABB(q.pos, _p1, b.collider) === null) continue;
    q.dead = true;
    spawnBurst(world, q.pos.clone().lerp(_p1, 0.5), b.style === 'crate' ? 0xc49866 : 0xd8e0ea, 6, 3);
    return true;
  }
  return false;
}

/** はじける：残骸を飛ばし、敵を出す */
function burst(world: World, st: Store, b: SpawnBox): void {
  b.state = 'open';
  b.collider.active = false;
  const fl = b.def.floor ?? 0;
  const yaw = b.def.yaw ?? 0;
  b.group.position.set(b.def.x, fl, b.def.z);
  b.group.rotation.set(0, yaw, 0);
  _fw.set(Math.sin(yaw), 0, Math.cos(yaw));
  const center = new THREE.Vector3(b.def.x, fl + b.size.h / 2, b.def.z);
  b.group.updateMatrixWorld(true);
  if (b.style === 'crate') {
    // 板が四方へ飛び散る
    for (const ch of [...b.group.children]) {
      const wp = new THREE.Vector3();
      ch.getWorldPosition(wp);
      world.scene.attach(ch);
      const out = wp.clone().sub(center).setY(0);
      if (out.lengthSq() < 1e-4) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      out.normalize();
      st.debris.push({
        obj: ch, vel: out.multiplyScalar(4 + Math.random() * 4).setY(3 + Math.random() * 5),
        spin: new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 10),
        life: SPAWN_BOX.debrisLife + Math.random() * 0.8, rest: false, floor: fl, mats: [],
      });
    }
    b.group.removeFromParent();
    spawnBurst(world, center, 0xc49866, 18, 6, 0.6);
  } else {
    // コンテナ：扉がバンと開く。本体は少し残して消える
    for (const ch of b.group.children) {
      if (ch.name === 'doorL') ch.rotation.y = -1.9;
      if (ch.name === 'doorR') ch.rotation.y = 1.9;
      if (ch.name === 'lamp') ((ch as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(0x3dff7a);
    }
    st.debris.push({ obj: b.group, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: SPAWN_BOX.debrisLife + 1.5, rest: true, floor: fl, mats: [] });
    spawnBurst(world, center.clone().addScaledVector(_fw, b.size.d / 2), 0xd8e0ea, 14, 5, 0.5);
  }
  world.events.emit('impact', { pos: center.clone(), owner: 'enemy' });
  // 敵が飛び出す
  const r = ENEMIES[b.def.kind].radius;
  const air = AIR.includes(b.def.kind);
  const pos = new THREE.Vector3(b.def.x, air ? fl + Math.max(1.4, b.size.h) : fl + r + 0.1, b.def.z);
  try {
    const e = spawnEnemy(world, b.def.kind, pos);
    e.ai.yaw = yaw;
    e.root.rotation.y = yaw;
    e.ai.alert = 4;   // すぐにプレイヤーに気づく
    if (!air) e.vel.set(_fw.x * SPAWN_BOX.hopForward, SPAWN_BOX.hopUp, _fw.z * SPAWN_BOX.hopForward);
    b.enemy = e;
    world.events.emit('enemyEmerge', { kind: e.kind, pos: pos.clone(), mode: 'pod' });
  } catch (err) {
    console.warn('[spawnBoxes] spawnEnemy failed', err);
  }
  b.def.onOpen?.(b);
}
