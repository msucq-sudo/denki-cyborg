// 休眠する敵。コンテナ（pod）の中、または天井の上（drop）で待機し、近づくと目を覚まして出てくる。
// 休眠中は AI なし・狙えない・ダメージなし（isTargetable が false）。
// 出てくる演出が終わった瞬間に ai.dormant を消して通常の敵になる。
import * as THREE from 'three';
import { ENEMY_NOTICE } from '../config/balance';
import type { AABB, Enemy, World } from '../core/types';
import { makeAABB, raycastLevel } from '../core/collision';
import { spawnBurst, spawnFlash, spawnShockwave } from '../core/effects';
import { moveGround } from './common';
import { podSize } from './podSize';

export type DormantMode = 'pod' | 'drop';
export interface DormantOpts {
  dormant?: DormantMode;
  /** この距離（水平）までプレイヤーが来たら目覚める。省略時は ENEMY_NOTICE.range */
  wakeRadius?: number;
  /** pod の正面の向き（rad, +Z 基準）。90度単位に丸める */
  yaw?: number;
}

type Phase = 'sleep' | 'delay' | 'warn' | 'open' | 'plunge' | 'land';

const WARN_POD = 0.4;
const OPEN_POD = 0.55;
const WARN_DROP = 0.5;
const LAND_TIME = 0.3;
const PLUNGE_MAX = 3;
const STAGGER_MIN = 0.15, STAGGER_MAX = 0.4;
const WAKE_DY = 14;

interface PodRig {
  group: THREE.Group;
  leafL: THREE.Group;
  leafR: THREE.Group;
  lamp: THREE.MeshBasicMaterial;
  eyes: THREE.MeshBasicMaterial;
  collider: AABB;
  shell: AABB | null;
  fx: number; fz: number;     // 正面（ワールド・軸平行）
  size: { w: number; d: number; h: number };
  baseX: number; baseZ: number;
}
interface HatchRig {
  group: THREE.Group;
  flapL: THREE.Group;
  flapR: THREE.Group;
  lamp: THREE.MeshBasicMaterial;
  ceilY: number;
}
interface Telegraph { cone: THREE.Mesh; ring: THREE.Mesh }

export interface DormantState {
  mode: DormantMode;
  phase: Phase;
  wakeRadius: number;
  /** 現フェーズの経過秒（delay は残り秒） */
  t: number;
  /** 出てくる演出中は通常のアニメを回す */
  show: boolean;
  home: THREE.Vector3;
  flying: boolean;
  pod?: PodRig;
  hatch?: HatchRig;
  tele?: Telegraph;
  startY: number;
  floorY: number;
  seed: number;
}

export function isDormant(e: Enemy): boolean { return !!e.ai.dormant; }

export { podSize };

// ------------------------------------------------------------------ 共有ジオメトリ・マテリアル
let G: { box: THREE.BoxGeometry } | null = null;
let M: Record<'white' | 'navy' | 'dark' | 'yellow' | 'glass' | 'steel', THREE.MeshStandardMaterial> | null = null;
function shared() {
  G ??= { box: new THREE.BoxGeometry(1, 1, 1) };
  M ??= {
    white: new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.55, metalness: 0.15 }),
    navy: new THREE.MeshStandardMaterial({ color: 0x203c70, roughness: 0.5, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0b1226, roughness: 0.9, metalness: 0.1 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xffc21a, roughness: 0.6, metalness: 0.1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1a4a66, emissive: 0x2aa8c8, emissiveIntensity: 0.7, roughness: 0.2 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x7c8a9c, roughness: 0.5, metalness: 0.5 }),
  };
  return { g: G, m: M };
}
function mk(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, shadow = true): THREE.Mesh {
  const { g } = shared();
  const m = new THREE.Mesh(g.box, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// ------------------------------------------------------------------ 作成
export function makeDormant(world: World, e: Enemy, opts: DormantOpts, flying: boolean): void {
  let mode: DormantMode = opts.dormant ?? 'pod';
  if (flying) mode = 'drop';
  const home = e.pos.clone();
  const st: DormantState = {
    mode, phase: 'sleep', wakeRadius: opts.wakeRadius ?? ENEMY_NOTICE.range, t: 0, show: false,
    home, flying, startY: home.y, floorY: home.y - e.radius, seed: Math.random() * 10,
  };
  e.ai.dormant = st;
  e.root.visible = false;
  if (mode === 'pod') {
    // 床の高さ（足元）を探す
    const t = raycastLevel(world.colliders, home, new THREE.Vector3(home.x, home.y - 3, home.z));
    st.floorY = t === null ? home.y - e.radius - 0.1 : home.y - 3 * t;
    st.pod = buildPod(world, e, st, opts.yaw ?? e.ai.yaw ?? 0);
    e.ai.yaw = Math.atan2(st.pod.fx, st.pod.fz);
  } else {
    const up = new THREE.Vector3(home.x, home.y + 40, home.z);
    const tc = raycastLevel(world.colliders, home, up);
    const ceilY = tc === null ? home.y + 12 : home.y + 40 * tc;
    const td = raycastLevel(world.colliders, home, new THREE.Vector3(home.x, home.y - 20, home.z));
    st.floorY = td === null ? home.y - e.radius - 0.1 : home.y - 20 * td;
    st.startY = Math.max(home.y, Math.min(home.y + 10.5, ceilY - e.radius - 0.35));
    e.pos.y = st.startY;
    e.root.position.copy(e.pos);
    st.hatch = buildHatch(world, home.x, ceilY, home.z);
  }
}

function buildPod(world: World, e: Enemy, st: DormantState, rawYaw: number): PodRig {
  const { m } = shared();
  const size = podSize(e.radius);
  const { w: W, d: D, h: H } = size;
  const q = Math.round(rawYaw / (Math.PI / 2));
  const yaw = q * (Math.PI / 2);
  const fx = Math.round(Math.sin(yaw)), fz = Math.round(Math.cos(yaw));
  const group = new THREE.Group();
  group.position.set(st.home.x, st.floorY, st.home.z);
  group.rotation.y = yaw;
  world.scene.add(group);

  // 土台・本体・四隅の柱・帯
  mk(group, m.navy, 0, 0.125, 0, W + 0.16, 0.25, D + 0.16);
  const bh = H - 0.47;
  mk(group, m.white, 0, 0.25 + bh / 2, -0.06, W, bh, D - 0.12);
  mk(group, m.navy, 0, 0.25 + bh * 0.62, -0.06, W + 0.06, 0.09, D - 0.06);
  mk(group, m.navy, 0, 0.25 + bh * 0.2, -0.06, W + 0.06, 0.09, D - 0.06);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mk(group, m.navy, sx * (W / 2 + 0.02), H / 2, sz * (D / 2 - 0.02), 0.16, H - 0.1, 0.16);
  // 側面の通気スリット
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) mk(group, m.dark, sx * (W / 2 + 0.01), 0.25 + bh * (0.3 + i * 0.09), -0.1, 0.03, 0.06, D * 0.4, false);
  // 面取りされた天板（4角錐台）
  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry((W / 2 - 0.12) / Math.SQRT1_2, (W / 2 + 0.12) / Math.SQRT1_2, 0.22, 4, 1),
    m.navy);
  lid.rotation.y = Math.PI / 4;
  lid.position.y = H - 0.11;
  lid.castShadow = true;
  group.add(lid);
  // 前面の凹み（ドアが開くと見える）
  const doorH = bh - 0.55;
  mk(group, m.dark, 0, 0.25 + doorH / 2, D / 2 - 0.125, W - 0.3, doorH, 0.02, false);
  mk(group, new THREE.MeshBasicMaterial({ color: 0x1fb6d8 }), 0, 0.25 + doorH - 0.05, D / 2 - 0.12, W - 0.34, 0.04, 0.02, false);
  // ドア（左右に開く）
  const lw = W / 2 - 0.04;
  const leaf = (side: -1 | 1): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(side * (W / 2 - 0.02), 0, D / 2 - 0.06);
    const c = -side * lw / 2;                       // 中心は蝶番から内側へ
    mk(pivot, m.white, c, 0.25 + doorH / 2, 0, lw, doorH, 0.1);
    mk(pivot, m.navy, -side * (lw - 0.04), 0.25 + doorH / 2, 0.02, 0.08, doorH - 0.1, 0.11);   // 合わせ目の縁
    mk(pivot, m.navy, c, 0.25 + doorH * 0.55, 0.02, lw - 0.1, 0.07, 0.11);
    mk(pivot, m.yellow, c, 0.25 + 0.11, 0.03, lw - 0.1, 0.13, 0.11);                               // 注意帯
    for (let i = 0; i < 3; i++) mk(pivot, m.dark, c + (i - 1) * lw * 0.28, 0.25 + 0.11, 0.045, 0.07, 0.14, 0.1, false);
    group.add(pivot);
    return pivot;
  };
  const leafL = leaf(-1), leafR = leaf(1);
  // 窓：中に暗いシルエットと目の光
  const wy = 0.25 + doorH + 0.275;
  const ww = W * 0.62;
  mk(group, m.navy, 0, wy, D / 2 - 0.115, ww + 0.12, 0.4, 0.03, false);
  mk(group, m.glass, 0, wy, D / 2 - 0.095, ww, 0.3, 0.02, false);
  mk(group, m.dark, 0, wy - 0.07, D / 2 - 0.08, 0.5, 0.15, 0.02, false);        // 肩
  mk(group, m.dark, 0, wy + 0.02, D / 2 - 0.08, 0.2, 0.18, 0.02, false);        // 頭
  const eyes = new THREE.MeshBasicMaterial({ color: 0xffaa33 });
  mk(group, eyes, -0.05, wy + 0.04, D / 2 - 0.07, 0.04, 0.035, 0.02, false);
  mk(group, eyes, 0.05, wy + 0.04, D / 2 - 0.07, 0.04, 0.035, 0.02, false);
  // 状態ランプ
  const lamp = new THREE.MeshBasicMaterial({ color: 0x40e0ff });
  mk(group, m.navy, 0, H + 0.03, D / 2 - 0.22, 0.36, 0.08, 0.3);
  mk(group, lamp, 0, H + 0.13, D / 2 - 0.22, 0.22, 0.13, 0.2, false);
  // 土台前面の黄色い注意ストライプ
  const n = Math.max(4, Math.round(W / 0.42));
  for (let i = 0; i < n; i++) mk(group, m.yellow, -W / 2 + (i + 0.5) * (W / n), 0.125, D / 2 + 0.085, W / n * 0.5, 0.2, 0.02, false);

  // 当たり判定（弾はこの箱に当たる）。ワールド軸平行
  const ax = Math.abs(fx) > 0 ? D : W, az = Math.abs(fz) > 0 ? D : W;
  const collider = makeAABB(
    new THREE.Vector3(st.home.x - ax / 2, st.floorY, st.home.z - az / 2),
    new THREE.Vector3(st.home.x + ax / 2, st.floorY + H, st.home.z + az / 2), 'pod');
  world.colliders.push(collider);
  return { group, leafL, leafR, lamp, eyes, collider, shell: null, fx, fz, size, baseX: st.home.x, baseZ: st.home.z };
}

function buildHatch(world: World, x: number, ceilY: number, z: number): HatchRig {
  const { m } = shared();
  const group = new THREE.Group();
  group.position.set(x, ceilY, z);
  mk(group, m.navy, 0, -0.04, 0, 1.7, 0.08, 1.7);
  mk(group, m.dark, 0, -0.09, 0, 1.2, 0.02, 1.2, false);
  for (const s of [-1, 1]) {
    mk(group, m.yellow, s * 0.82, -0.09, 0, 0.08, 0.02, 1.7, false);
    mk(group, m.yellow, 0, -0.09, s * 0.82, 1.7, 0.02, 0.08, false);
  }
  const flap = (side: -1 | 1): THREE.Group => {
    const p = new THREE.Group();
    p.position.set(side * 0.6, -0.11, 0);
    mk(p, m.steel, -side * 0.3, 0, 0, 0.6, 0.05, 1.2);
    mk(p, m.yellow, -side * 0.3, -0.03, 0, 0.1, 0.02, 1.2, false);
    group.add(p);
    return p;
  };
  const lamp = new THREE.MeshBasicMaterial({ color: 0xffb02a });
  mk(group, lamp, 0, -0.12, 1.0, 0.18, 0.06, 0.18, false);
  world.scene.add(group);
  return { group, flapL: flap(-1), flapR: flap(1), lamp, ceilY };
}

// ------------------------------------------------------------------ 目覚め
/** 目覚めさせる。delay 秒後に予兆から開始。近くの休眠仲間も少し遅れて連鎖する */
export function wakeDormant(world: World, e: Enemy, delay = 0): void {
  const d = e.ai.dormant as DormantState | undefined;
  if (!d || d.phase !== 'sleep') return;
  d.phase = 'delay';
  d.t = delay;
  if (delay <= 0) startWarn(world, e, d);
  for (const o of world.enemies) {
    const od = o.ai.dormant as DormantState | undefined;
    if (!od || od.phase !== 'sleep' || o === e) continue;
    if (o.pos.distanceTo(e.pos) < ENEMY_NOTICE.shareRadius || o.pos.distanceTo(d.home) < ENEMY_NOTICE.shareRadius) {
      wakeDormant(world, o, STAGGER_MIN + Math.random() * (STAGGER_MAX - STAGGER_MIN));
    }
  }
}

function startWarn(world: World, e: Enemy, d: DormantState): void {
  d.phase = 'warn';
  d.t = 0;
  world.events.emit('enemyWakeWarn', { pos: d.home.clone(), mode: d.mode });
  if (d.mode === 'drop' && d.hatch) {
    const h = d.hatch;
    const top = h.ceilY - 0.1;
    const height = Math.max(0.5, top - d.floorY);
    const rad = e.radius + 0.8;
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, rad, height, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    cone.position.set(d.home.x, d.floorY + height / 2, d.home.z);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(rad * 0.7, rad, 28),
      new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(d.home.x, d.floorY + 0.04, d.home.z);
    world.scene.add(cone, ring);
    d.tele = { cone, ring };
    spawnFlash(world, new THREE.Vector3(d.home.x, h.ceilY - 0.3, d.home.z), 0xff4a30, 8, 10, 0.3);
  }
}

function disposeTele(world: World, d: DormantState): void {
  if (!d.tele) return;
  for (const o of [d.tele.cone, d.tele.ring]) {
    world.scene.remove(o);
    o.geometry.dispose();
    (o.material as THREE.Material).dispose();
  }
  d.tele = undefined;
}

const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

// ------------------------------------------------------------------ 更新
export function updateDormant(world: World, e: Enemy, dt: number): void {
  const d = e.ai.dormant as DormantState | undefined;
  if (!d) return;
  const pod = d.pod, hatch = d.hatch;
  const time = e.ai.t ?? 0;

  switch (d.phase) {
    case 'sleep': {
      const p = world.player.pos;
      if (Math.hypot(p.x - d.home.x, p.z - d.home.z) < d.wakeRadius && Math.abs(p.y - d.floorY) < WAKE_DY) wakeDormant(world, e, 0);
      else {
        const pulse = 0.55 + 0.45 * Math.sin(time * 2.2 + d.seed);
        if (pod) pod.lamp.color.setRGB(0.1 + 0.15 * pulse, 0.55 + 0.35 * pulse, 0.7 + 0.3 * pulse);
        if (hatch) hatch.lamp.color.setRGB(0.5 + 0.4 * pulse, 0.3 + 0.2 * pulse, 0.05);
      }
      break;
    }
    case 'delay':
      d.t -= dt;
      if (d.t <= 0) startWarn(world, e, d);
      break;
    case 'warn': {
      d.t += dt;
      const dur = d.mode === 'pod' ? WARN_POD : WARN_DROP;
      const blink = Math.sin(d.t * 36) > 0 ? 1 : 0.25;
      if (pod) {
        pod.lamp.color.setRGB(1 * blink, 0.1 * blink, 0.05 * blink);
        pod.eyes.color.setRGB(1, 0.1 + 0.2 * blink, 0.05);
        pod.group.position.set(pod.baseX + (Math.random() - 0.5) * 0.03, d.floorY, pod.baseZ + (Math.random() - 0.5) * 0.03);
      }
      if (hatch) {
        hatch.lamp.color.setRGB(1 * blink, 0.1 * blink, 0.05 * blink);
        const a = ease(d.t / 0.3) * 1.4;
        hatch.flapL.rotation.z = -a;
        hatch.flapR.rotation.z = a;
        if (d.tele) {
          const m = d.tele.cone.material as THREE.MeshBasicMaterial;
          m.opacity = (0.12 + 0.2 * Math.min(1, d.t / 0.3)) * (0.7 + 0.3 * Math.sin(d.t * 30));
          (d.tele.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.4 * blink;
        }
      }
      if (d.t >= dur) startEmerge(world, e, d);
      break;
    }
    case 'open': {
      d.t += dt;
      if (!pod) break;
      const k = d.t / OPEN_POD;
      const a = ease(d.t / 0.22) * 1.9 + Math.sin(Math.min(1, d.t / 0.22) * Math.PI) * 0.12;
      pod.leafL.rotation.y = -a;
      pod.leafR.rotation.y = a;
      // 敵が歩み出る（小さくジャンプ）
      const kk = Math.min(1, Math.max(0, (d.t - 0.12) / (OPEN_POD - 0.12)));
      const out = pod.size.d / 2 + e.radius + 0.5;
      e.pos.set(d.home.x + pod.fx * out * ease(kk), d.home.y + 0.35 * Math.sin(Math.PI * kk), d.home.z + pod.fz * out * ease(kk));
      if (k >= 1) finish(world, e, d);
      break;
    }
    case 'plunge': {
      d.t += dt;
      if (d.flying) {
        e.vel.y = Math.max(-30, e.vel.y - 60 * dt);
        e.pos.y += e.vel.y * dt;
        if (e.pos.y <= d.home.y || d.t > PLUNGE_MAX) { e.pos.y = d.home.y; e.vel.set(0, 0, 0); startLand(world, e, d); }
      } else {
        e.vel.y -= 35 * dt;
        e.pos.x = d.home.x; e.pos.z = d.home.z;
        moveGround(world, e, dt, 0, 0, 40);
        if ((e.ai.onGround && d.t > 0.1) || d.t > PLUNGE_MAX) { startLand(world, e, d); }
      }
      break;
    }
    case 'land':
      d.t += dt;
      if (d.t >= (d.flying ? 0.12 : LAND_TIME)) finish(world, e, d);
      else if (!d.flying) moveGround(world, e, dt, 0, 0, 40);
      break;
  }
}

function startEmerge(world: World, e: Enemy, d: DormantState): void {
  d.t = 0;
  d.show = true;
  e.root.visible = true;
  if (d.mode === 'pod' && d.pod) {
    const pod = d.pod;
    d.phase = 'open';
    pod.collider.active = false;
    pod.group.position.set(pod.baseX, d.floorY, pod.baseZ);
    pod.eyes.color.setHex(0xff3020);
    pod.lamp.color.setHex(0xff2010);
    const front = new THREE.Vector3(d.home.x + pod.fx * pod.size.d / 2, d.floorY + pod.size.h * 0.4, d.home.z + pod.fz * pod.size.d / 2);
    spawnBurst(world, front, 0xeaf6ff, 22, 4.5, 0.8);
    spawnBurst(world, front.clone().add(new THREE.Vector3(-pod.fz * 0.5, 0.3, pod.fx * 0.5)), 0xcfe8ff, 10, 3, 0.7);
    spawnBurst(world, front.clone().add(new THREE.Vector3(pod.fz * 0.5, 0.3, -pod.fx * 0.5)), 0xcfe8ff, 10, 3, 0.7);
    spawnFlash(world, front, 0xfff0c0, 8, 9, 0.25);
    spawnShockwave(world, front, 0xcfe8ff, 1.6, 0.3);
    world.events.emit('enemyEmerge', { kind: e.kind, pos: front.clone(), mode: 'pod' });
  } else {
    d.phase = 'plunge';
    e.vel.set(0, d.flying ? -6 : -8, 0);
    const from = new THREE.Vector3(d.home.x, e.pos.y, d.home.z);
    e.pos.copy(from);
    spawnBurst(world, from, 0xffd0c0, 12, 3, 0.5);
    spawnFlash(world, from, 0xff5a30, 8, 9, 0.25);
    world.events.emit('enemyEmerge', { kind: e.kind, pos: from.clone(), mode: 'drop' });
  }
}

function startLand(world: World, e: Enemy, d: DormantState): void {
  d.phase = 'land';
  d.t = 0;
  disposeTele(world, d);
  if (d.hatch) d.hatch.lamp.color.setHex(0x553300);
  const feet = new THREE.Vector3(e.pos.x, d.floorY + 0.1, e.pos.z);
  if (d.flying) {
    spawnShockwave(world, e.pos, 0xcfe8ff, e.radius * 2.2, 0.3);
    spawnBurst(world, e.pos, 0xffffff, 8, 3, 0.4);
  } else {
    spawnShockwave(world, feet, 0xd8ecff, e.radius * 4 + 1.5, 0.5);
    spawnBurst(world, feet, 0xbfc9d6, 22, 5, 0.6);
    spawnFlash(world, feet, 0xffffff, 8, 8, 0.2);
  }
  e.vel.set(0, 0, 0);
}

function finish(world: World, e: Enemy, d: DormantState): void {
  disposeTele(world, d);
  if (d.pod) {
    const pod = d.pod;
    pod.group.position.set(pod.baseX, d.floorY, pod.baseZ);
    pod.lamp.color.setHex(0x6a7480);
    pod.eyes.color.setHex(0x222a38);
    // 空のポッドは奥半分だけ遮蔽物（カバー）として残す
    const { w: W, d: D, h: H } = pod.size;
    const ax = Math.abs(pod.fx) > 0 ? D / 2 : W, az = Math.abs(pod.fz) > 0 ? D / 2 : W;
    const cx = d.home.x - pod.fx * D / 4, cz = d.home.z - pod.fz * D / 4;
    pod.shell = makeAABB(new THREE.Vector3(cx - ax / 2, d.floorY, cz - az / 2), new THREE.Vector3(cx + ax / 2, d.floorY + H, cz + az / 2), 'pod');
    world.colliders.push(pod.shell);
  }
  e.vel.set(0, 0, 0);
  e.ai.dormant = undefined;
  e.ai.alert = 6;
  e.root.visible = true;
}
