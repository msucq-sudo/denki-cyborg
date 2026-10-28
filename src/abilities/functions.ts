import * as THREE from 'three';
import { FUNCTIONS } from '../config/balance';
import type { Enemy, World } from '../core/types';
import { hasLineOfSight } from '../core/collision';
import { drainEnergy } from '../core/energy';
import { isTargetable, weakPointWorld } from '../core/enemyUtil';

/** スカウター・ジェットパックは最初から使える基本機能。オートエイムは world.unlocks で解放してから */
type FnName = 'scouter' | 'autoAim';
const KEYS: [string, FnName][] = [['Digit1', 'scouter'], ['Digit2', 'autoAim']];
/** ON の間じゅう常時消費するもの（オートエイムは射撃時のみ消費するので0） */
const DRAIN: Record<FnName, number> = {
  scouter: FUNCTIONS.scouter.drainPerSec,
  autoAim: 0,
};

interface Marker {
  group: THREE.Group;
  ring: THREE.Sprite;
  barBg: THREE.Sprite;
  barFill: THREE.Sprite;
}

interface WpSave { halo: THREE.Sprite; scale: THREE.Vector3 }

interface FnState {
  markerRoot: THREE.Group;
  markers: Map<number, Marker>;
  wps: Map<THREE.Mesh, WpSave>;
  /** 元の emissiveIntensity */
  mats: Map<THREE.Material, number>;
  haloTex: THREE.Texture;
  ringTex: THREE.Texture;
  lock: Enemy | null;
}

const states = new WeakMap<World, FnState>();

function dataTex(size: number, f: (u: number, v: number) => [number, number, number, number]): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = f((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
      const i = (y * size + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** やわらかい光の玉 */
function makeHaloTexture(): THREE.Texture {
  return dataTex(64, (u, v) => {
    const d = Math.sqrt(u * u + v * v);
    const a = Math.max(0, 1 - d);
    return [255, 240, 150, Math.round(255 * a * a)];
  });
}

/** ひし形＋輪っか（敵マーカー） */
function makeRingTexture(): THREE.Texture {
  return dataTex(64, (u, v) => {
    const d = Math.abs(u) + Math.abs(v); // ひし形距離
    const edge = Math.abs(d - 0.85);
    const a = edge < 0.09 ? 1 : edge < 0.16 ? 1 - (edge - 0.09) / 0.07 : 0;
    const inner = Math.sqrt(u * u + v * v) < 0.07 ? 1 : 0;
    return [255, 255, 255, Math.round(255 * Math.min(1, a + inner))];
  });
}

function mkSprite(map: THREE.Texture | null, color: number, opacity = 1, blending: THREE.Blending = THREE.NormalBlending): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map, color, transparent: true, opacity, depthTest: false, depthWrite: false, blending,
  }));
  s.renderOrder = 999;
  return s;
}

export function initFunctions(world: World): void {
  const prev = states.get(world);
  if (prev) world.scene.remove(prev.markerRoot);
  const markerRoot = new THREE.Group();
  markerRoot.name = 'scouterMarkers';
  markerRoot.visible = false;
  world.scene.add(markerRoot);
  states.set(world, {
    markerRoot, markers: new Map(), wps: new Map(), mats: new Map(),
    haloTex: makeHaloTexture(), ringTex: makeRingTexture(), lock: null,
  });
}

function toggle(world: World, name: FnName): void {
  const f = world.functions;
  // オートエイムは解放されるまで使えない（スカウターは最初から使える）
  if (name === 'autoAim' && !world.unlocks.autoAim) return;
  if (f[name]) {
    f[name] = false;
    world.events.emit('functionToggle', { name, on: false });
  } else {
    // スカウターは電力不要。それ以外は電力0だとONにできない
    if (name !== 'scouter' && world.player.energy <= 0) { world.events.emit('noEnergy', {}); return; }
    f[name] = true;
    world.events.emit('functionToggle', { name, on: true });
  }
}

export function updateFunctions(world: World, dt: number): void {
  const st = states.get(world);
  const f = world.functions;

  // ---- トグル ----
  for (const [key, name] of KEYS) if (world.input.pressed(key)) toggle(world, name);

  // ---- 消費・自動OFF ----
  for (const name of Object.keys(DRAIN) as FnName[]) if (f[name]) drainEnergy(world, DRAIN[name] * dt);
  if (world.player.energy <= 0) {
    for (const name of Object.keys(DRAIN) as FnName[]) {
      if (name === 'scouter') continue; // スカウターは電力切れでも動く
      if (f[name]) { f[name] = false; world.events.emit('functionToggle', { name, on: false }); }
    }
  }

  if (!st) return;
  updateScouter(world, st, dt);
  updateAutoAim(world, st);
}

// ---------------- スカウター ----------------

function restoreWp(st: FnState, mesh: THREE.Mesh): void {
  const s = st.wps.get(mesh);
  if (!s) return;
  mesh.scale.copy(s.scale);
  mesh.remove(s.halo);
  (s.halo.material as THREE.Material).dispose();
  st.wps.delete(mesh);
}

function restoreMats(st: FnState): void {
  for (const [m, v] of st.mats) (m as any).emissiveIntensity = v;
  st.mats.clear();
}

function clearScouter(st: FnState): void {
  for (const mesh of [...st.wps.keys()]) restoreWp(st, mesh);
  restoreMats(st);
  for (const [id, mk] of st.markers) removeMarker(st, id, mk);
  st.markerRoot.visible = false;
}

function removeMarker(st: FnState, id: number, mk: Marker): void {
  st.markerRoot.remove(mk.group);
  (mk.ring.material as THREE.Material).dispose();
  (mk.barBg.material as THREE.Material).dispose();
  (mk.barFill.material as THREE.Material).dispose();
  st.markers.delete(id);
}

function makeMarker(st: FnState): Marker {
  const group = new THREE.Group();
  const ring = mkSprite(st.ringTex, 0x5fe8ff, 0.95);
  ring.scale.set(0.9, 0.9, 1);
  const barBg = mkSprite(null, 0x0a2a33, 0.7);
  barBg.center.set(0, 0.5);
  barBg.position.set(-0.5, -0.62, 0);
  barBg.scale.set(1, 0.13, 1);
  const barFill = mkSprite(null, 0x5fe8ff, 1);
  barFill.center.set(0, 0.5);
  barFill.position.set(-0.5, -0.62, 0);
  barFill.renderOrder = 1000;
  barFill.scale.set(1, 0.09, 1);
  group.add(ring, barBg, barFill);
  st.markerRoot.add(group);
  return { group, ring, barBg, barFill };
}

const hpCol = new THREE.Color();

function updateScouter(world: World, st: FnState, dt: number): void {
  if (!world.functions.scouter) {
    if (st.markerRoot.visible || st.wps.size || st.mats.size || st.markers.size) clearScouter(st);
    return;
  }
  st.markerRoot.visible = true;
  const t = world.time;
  const pulse = 0.5 + 0.5 * Math.sin(t * 7);

  // スカウターは壁越しに敵を見せない：カメラから直接見えている敵だけ HP・弱点を表示
  const camEye = world.camera.position;
  const visible = new Set<Enemy>();
  for (const e of world.enemies) {
    if (isTargetable(e) && hasLineOfSight(world.colliders, camEye, e.pos)) visible.add(e);
  }

  // 弱点の強調
  const seen = new Set<THREE.Mesh>();
  for (const e of world.enemies) {
    if (!visible.has(e)) continue;
    for (const wp of e.weakPoints) seen.add(wp.mesh);
  }
  for (const mesh of [...st.wps.keys()]) if (!seen.has(mesh)) restoreWp(st, mesh);
  // 使われなくなった素材を戻す
  const usedMats = new Set<THREE.Material>();
  for (const mesh of seen) { const m = mesh.material; if (!Array.isArray(m)) usedMats.add(m); }
  for (const [m, v] of [...st.mats]) if (!usedMats.has(m)) { (m as any).emissiveIntensity = v; st.mats.delete(m); }

  for (const e of world.enemies) {
    if (!visible.has(e)) continue;
    for (const wp of e.weakPoints) {
      const mesh = wp.mesh;
      let s = st.wps.get(mesh);
      if (!s) {
        const halo = mkSprite(st.haloTex, 0xffe27a, 0.9, THREE.AdditiveBlending);
        mesh.add(halo);
        s = { halo, scale: mesh.scale.clone() };
        st.wps.set(mesh, s);
      }
      s.halo.visible = wp.exposed;
      const r = Math.max(0.15, wp.radius);
      const hs = (r * 5 / Math.max(1e-3, mesh.scale.x)) * (0.85 + 0.3 * pulse);
      s.halo.scale.set(hs, hs, 1);
      mesh.scale.copy(s.scale).multiplyScalar(wp.exposed ? 1 + 0.18 * pulse : 1);
      const mat = mesh.material;
      if (!Array.isArray(mat) && 'emissiveIntensity' in mat) {
        if (!st.mats.has(mat)) st.mats.set(mat, (mat as any).emissiveIntensity);
        (mat as any).emissiveIntensity = Math.max(st.mats.get(mat)! * 2.5, 2) * (0.75 + 0.5 * pulse);
      }
    }
  }

  // HPマーカー（見えている敵のみ）
  const alive = new Set<number>();
  const camPos = world.camera.position;
  for (const e of world.enemies) {
    if (!visible.has(e)) continue;
    alive.add(e.id);
    let mk = st.markers.get(e.id);
    if (!mk) { mk = makeMarker(st); st.markers.set(e.id, mk); }
    mk.group.position.set(e.pos.x, e.pos.y + e.radius + 0.6, e.pos.z);
    const dist = camPos.distanceTo(mk.group.position);
    mk.group.scale.setScalar(THREE.MathUtils.clamp(dist * 0.07, 0.45, 4));
    const ratio = e.maxHp > 0 ? THREE.MathUtils.clamp(e.hp / e.maxHp, 0, 1) : 0;
    mk.barFill.scale.x = Math.max(0.001, ratio);
    hpCol.set(0xff7a5c).lerp(hpCol.clone().set(0x5fe8ff), ratio);
    (mk.barFill.material as THREE.SpriteMaterial).color.copy(hpCol);
    const lockedOn = world.aimTarget === e;
    (mk.ring.material as THREE.SpriteMaterial).color.set(lockedOn ? 0xffe27a : 0x5fe8ff);
    const rs = 0.9 * (lockedOn ? 1.15 + 0.1 * pulse : 1);
    mk.ring.scale.set(rs, rs, 1);
  }
  for (const [id, mk] of [...st.markers]) if (!alive.has(id)) removeMarker(st, id, mk);
  void dt;
}

// ---------------- オートエイム ----------------

const camDir = new THREE.Vector3();
const camPosV = new THREE.Vector3();
const toPt = new THREE.Vector3();
const wpPos = new THREE.Vector3();

interface Cand { enemy: Enemy; point: THREE.Vector3; ang: number }

/** その敵の狙い点：露出弱点（カメラ中心に近いもの）→ なければ体の中心 */
function aimPointFor(world: World, e: Enemy, out: THREE.Vector3): THREE.Vector3 {
  let bestAng = Infinity;
  let found = false;
  for (const wp of e.weakPoints) {
    if (!wp.exposed) continue;
    weakPointWorld(e, wp, wpPos);
    toPt.subVectors(wpPos, camPosV).normalize();
    const ang = Math.acos(THREE.MathUtils.clamp(toPt.dot(camDir), -1, 1));
    if (ang < bestAng) { bestAng = ang; out.copy(wpPos); found = true; }
  }
  if (!found) out.copy(e.pos);
  return out;
}

function updateAutoAim(world: World, st: FnState): void {
  if (!world.functions.autoAim) {
    world.aimTarget = null;
    world.aimTargetPoint = null;
    st.lock = null;
    return;
  }
  world.camera.getWorldDirection(camDir);
  world.camera.getWorldPosition(camPosV);
  const cone = THREE.MathUtils.degToRad(FUNCTIONS.autoAim.coneDeg);
  let best: Cand | null = null;
  for (const e of world.enemies) {
    if (!isTargetable(e)) continue;
    const isLock = e === st.lock;
    const pt = aimPointFor(world, e, new THREE.Vector3());
    toPt.subVectors(pt, camPosV);
    const dist = toPt.length();
    if (dist < 1e-3) continue;
    if (world.aimOrigin.distanceTo(pt) > FUNCTIONS.autoAim.maxRange) continue;
    const ang = Math.acos(THREE.MathUtils.clamp(toPt.divideScalar(dist).dot(camDir), -1, 1));
    if (ang > cone * (isLock ? 1.2 : 1)) continue;
    if (!hasLineOfSight(world.colliders, world.aimOrigin, pt)) continue;
    const score = ang * (isLock ? 0.6 : 1); // ヒステリシス
    if (!best || score < best.ang) best = { enemy: e, point: pt, ang: score };
  }
  if (best) {
    st.lock = best.enemy;
    world.aimTarget = best.enemy;
    world.aimTargetPoint = (world.aimTargetPoint ?? new THREE.Vector3()).copy(best.point);
    const d = best.point.clone().sub(world.aimOrigin);
    if (d.lengthSq() > 1e-6) world.aimDir.copy(d.normalize());
  } else {
    st.lock = null;
    world.aimTarget = null;
    world.aimTargetPoint = null;
  }
}
