// ハッキングで味方になった敵の共通部品：標的選び・弾・時間切れ・見た目（青緑の色替え／点滅）、
// それとハッキングできる印（ポート＋アンテナ）の部品。赤ウォーカー／赤ドローンが使う
import * as THREE from 'three';
import type { Enemy, World } from '../../core/types';
import { hasLineOfSight, moveCharacter, raycastLevel } from '../../core/collision';
import { isTargetable, raycastEnemies } from '../../core/enemyUtil';
import { spawnBurst } from '../../core/effects';
import { damageEnemy, shutdownEnemy } from '../api';
import { boxGeo, sphereGeo, type Builder } from '../models';

/** 味方の共通調整値 */
export const ALLY = {
  /** 弾の速さ（m/s）と寿命（秒） */
  boltSpeed: 30,
  boltLife: 1.2,
  /** 残り時間がこれ以下になると点滅する（秒） */
  blinkTime: 5,
  /** 標的を探し直す間隔（秒） */
  scanInterval: 0.3,
  /** 味方になった直後の最初の射撃までの時間（秒） */
  firstShot: 0.3,
  /** 平常時にプレイヤーの後ろを保つ距離（m） */
  followGap: 3.2,
  /** プレイヤーの経路を記録する間隔（m） */
  trailSpacing: 0.45,
  /** 念のため保存する経路の最大点数 */
  trailLimit: 180,
  /** ワープや別エリアへの移動を古い経路につながない距離（m） */
  trailResetDistance: 12,
  /** 地上の仲間が別フロアの足跡へ直接追従しないための垂直到達幅（m） */
  groundWaypointHeight: 1.1,
} as const;

export const ALLY_CYAN = 0x40e0ff;
const BEACON_OFF = 0x0a2a33;
const HACK_CYAN = 0x40e0ff;

const _from = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _routeFoot = new THREE.Vector3();
const _routeVel = new THREE.Vector3();
const _routeGoal = new THREE.Vector3();
const FLYER_ROUTE_EPSILON = 0.02;
const Z = new THREE.Vector3(0, 0, 1);
/** 味方の弾の見た目（共有。弾ごとに材質だけ作る） */
const BOLT_GEO = new THREE.SphereGeometry(0.12, 10, 8);

/** 味方の弾（e.ai.bolts に持つ） */
interface Bolt { pos: THREE.Vector3; vel: THREE.Vector3; life: number; damage: number; mesh: THREE.Mesh }

function boltsOf(e: Enemy): Bolt[] {
  return (e.ai.bolts ??= []) as Bolt[];
}

function removeBolt(world: World, b: Bolt): void {
  world.scene.remove(b.mesh);
  (b.mesh.material as THREE.Material).dispose();
  b.mesh.traverse((o) => { if (o !== b.mesh) ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose(); });
}

/** 飛んでいる味方の弾をすべて消す（時間切れ・撤去のとき） */
export function clearAllyBolts(world: World, e: Enemy): void {
  const list = e.ai.bolts as Bolt[] | undefined;
  if (!list) return;
  for (const b of list) removeBolt(world, b);
  list.length = 0;
}

/**
 * プレイヤーの最近の移動経路を記録する。敵の通常 update 中にも呼ぶことで、
 * ハッキング直後から過去の曲がり角をたどれるようにする。
 */
export function recordAllyTrail(world: World, e: Enemy): void {
  const ai = e.ai;
  const trail = (ai.allyTrail ??= []) as THREE.Vector3[];
  const p = world.player.pos;
  const last = trail[trail.length - 1];
  if (!last) {
    trail.push(p.clone());
    return;
  }

  const distance = p.distanceTo(last);
  if (distance >= ALLY.trailResetDistance) {
    // チェックポイント移動・シーン移動などの瞬間移動を、歩いた経路として扱わない
    trail.length = 0;
    trail.push(p.clone());
    return;
  }
  if (distance < ALLY.trailSpacing) return;

  trail.push(p.clone());
  if (trail.length > ALLY.trailLimit) {
    const removeCount = trail.length - ALLY.trailLimit;
    trail.splice(0, removeCount);
  }
}

/**
 * プレイヤーの少し後ろにある経路上の次の点を返す。
 * 細かい道なりの点をたどるため、追従時に角を直線で突っ切って壁へ向かい続けない。
 */
export interface AllyFollowWaypoint {
  point: THREE.Vector3;
  atTrailGoal: boolean;
}

function hasAllyGroundSupport(world: World, e: Enemy, center: THREE.Vector3): boolean {
  const footY = center.y - e.radius;
  const margin = e.radius * 0.35;
  return world.colliders.some((b) => b.active
    && Math.abs(b.max.y - footY) <= 0.16
    && center.x >= b.min.x + margin && center.x <= b.max.x - margin
    && center.z >= b.min.z + margin && center.z <= b.max.z - margin);
}

/** 球の中心の線分を半径分拡張したAABBへ通し、飛行仲間の経路を高速に調べる。 */
function flyerRouteBlocked(world: World, e: Enemy, point: THREE.Vector3): boolean {
  const from = e.pos;
  const dx = point.x - from.x, dy = point.y - from.y, dz = point.z - from.z;
  const radius = Math.max(0, e.radius - FLYER_ROUTE_EPSILON);

  for (const b of world.colliders) {
    if (!b.active) continue;
    const minX = b.min.x - radius, maxX = b.max.x + radius;
    const minY = b.min.y - radius, maxY = b.max.y + radius;
    const minZ = b.min.z - radius, maxZ = b.max.z + radius;
    let enter = -Infinity, exit = Infinity;

    if (Math.abs(dx) < 1e-9) { if (from.x < minX || from.x > maxX) continue; }
    else {
      let t1 = (minX - from.x) / dx, t2 = (maxX - from.x) / dx;
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
      enter = Math.max(enter, t1); exit = Math.min(exit, t2);
      if (enter > exit) continue;
    }

    if (Math.abs(dy) < 1e-9) { if (from.y < minY || from.y > maxY) continue; }
    else {
      let t1 = (minY - from.y) / dy, t2 = (maxY - from.y) / dy;
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
      enter = Math.max(enter, t1); exit = Math.min(exit, t2);
      if (enter > exit) continue;
    }

    if (Math.abs(dz) < 1e-9) { if (from.z < minZ || from.z > maxZ) continue; }
    else {
      let t1 = (minZ - from.z) / dz, t2 = (maxZ - from.z) / dz;
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
      enter = Math.max(enter, t1); exit = Math.min(exit, t2);
      if (enter > exit) continue;
    }

    if (exit < 0 || enter > 1) continue;
    // An already-overlapping start is blocked. At ordinary wall/floor contact, allow a
    // tangent or outward path so a boundary hit at t=0 cannot reject every waypoint.
    if (from.x >= b.min.x && from.x <= b.max.x
      && from.y >= b.min.y && from.y <= b.max.y
      && from.z >= b.min.z && from.z <= b.max.z) return true;
    if (enter <= 1e-7 && exit >= 0) {
      const closestX = Math.max(b.min.x, Math.min(from.x, b.max.x));
      const closestY = Math.max(b.min.y, Math.min(from.y, b.max.y));
      const closestZ = Math.max(b.min.z, Math.min(from.z, b.max.z));
      const separating = (from.x - closestX) * dx + (from.y - closestY) * dy + (from.z - closestZ) * dz;
      if (separating >= -1e-8) continue;
    }
    return true;
  }
  return false;
}

function canReachAllyWaypoint(world: World, e: Enemy, point: THREE.Vector3): boolean {
  const flying = e.kind === 'redDrone';
  if (!flying && (Math.abs(point.y - e.pos.y) > ALLY.groundWaypointHeight || !hasAllyGroundSupport(world, e, point))) return false;
  const distance = point.distanceTo(e.pos);
  if (distance < 1e-4) return true;
  if (flying) return !flyerRouteBlocked(world, e, point);
  // Test the complete 3D route with the same body dimensions as normal movement.
  // Ground allies only accept nearby heights; they still need ramps/steps to change floors.
  _routeFoot.set(e.pos.x, e.pos.y - e.radius, e.pos.z);
  _routeVel.copy(point).sub(e.pos);
  moveCharacter(world.colliders, _routeFoot, _routeVel, 1, e.radius, e.radius * 2);
  const remaining = _routeFoot.distanceTo(_p1.copy(point).add(_routeVel.set(0, -e.radius, 0)));
  return remaining <= Math.max(0.2, e.radius * 0.3);
}

export function allyFollowWaypoint(
  world: World,
  e: Enemy,
  gap: number = ALLY.followGap,
  centerHeight: number = e.radius,
): AllyFollowWaypoint {
  recordAllyTrail(world, e);
  const ai = e.ai;
  const trail = (ai.allyTrail ?? []) as THREE.Vector3[];
  const player = world.player;
  const p = player.pos;
  const goal = p.clone();
  let remaining = gap;
  let goalIndex = 0;

  // 現在位置から、サンプルされた経路をさかのぼって trail の長さだけ後ろを探す
  const newest = trail[trail.length - 1];
  if (newest) {
    let segment = newest.distanceTo(p);
    if (segment > 1e-5) {
      if (remaining <= segment) {
        const k = remaining / segment;
        goal.copy(p).lerp(newest, k);
        goalIndex = trail.length - 1;
        remaining = 0;
      } else remaining -= segment;
    }

    for (let i = trail.length - 1; remaining > 0 && i > 0; i--) {
      const newer = trail[i], older = trail[i - 1];
      segment = newer.distanceTo(older);
      if (segment < 1e-5) continue;
      if (remaining <= segment) {
        const k = remaining / segment;
        goal.copy(newer).lerp(older, k);
        goalIndex = i - 1;
        remaining = 0;
      } else remaining -= segment;
    }

    if (remaining > 0) {
      // 経路がまだ短いときも、プレイヤーの後ろを狙えるように延長する
      const flying = e.kind === 'redDrone';
      let direction = new THREE.Vector3(player.vel.x, flying ? player.vel.y : 0, player.vel.z);
      let len = direction.length();
      if (len < 0.2 && trail.length > 1) {
        direction.subVectors(trail[1], trail[0]);
        if (!flying) direction.y = 0;
        len = direction.length();
      }
      if (len < 1e-5) {
        // player yaw 0 は -Z を向く（player/logic.ts の cameraForward と同じ規約）
        direction.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
        len = 1;
      }
      direction.multiplyScalar(1 / len);
      const oldest = trail[0];
      goal.copy(oldest).addScaledVector(direction, -remaining);
      goalIndex = 0;
    }
  }
  goal.y += centerHeight;

  goalIndex = Math.max(0, Math.min(goalIndex, trail.length - 1));
  // 目標点まで届くならそこへ直行する。障害物に当たるときは、新しい経路点から
  // 古い順へ調べ、半径込みで届く最も先の点を選ぶ。折り返し時にも最新の道を使う。
  if (canReachAllyWaypoint(world, e, goal)) {
    return { point: goal, atTrailGoal: true };
  }

  let index = -1;
  for (let i = goalIndex; i >= 0; i--) {
    _routeGoal.copy(trail[i]);
    _routeGoal.y += centerHeight;
    if (canReachAllyWaypoint(world, e, _routeGoal)) { index = i; break; }
  }
  if (index < 0) {
    // 全点に直接届かない位置では、現在地に最も近い記録点へ向かって再合流する。
    let nearestD2 = Infinity;
    index = -1;
    const flying = e.kind === 'redDrone';
    for (let i = 0; i <= goalIndex; i++) {
      const point = trail[i];
      _routeGoal.copy(point);
      _routeGoal.y += centerHeight;
      if (!flying && !hasAllyGroundSupport(world, e, _routeGoal)) continue;
      const d2 = _routeGoal.distanceToSquared(e.pos);
      if (index < 0 || d2 < nearestD2 - 0.12 || (Math.abs(d2 - nearestD2) <= 0.12 && i > index)) {
        nearestD2 = d2;
        index = i;
      }
    }
  }
  if (index < 0) return { point: e.pos.clone(), atTrailGoal: false };
  return { point: trail[index].clone().setY(trail[index].y + centerHeight), atTrailGoal: false };
}

/** from から target へ青緑の弾を撃つ。当たると damage（敵の弾ではなく専用処理） */
export function fireAllyBolt(world: World, e: Enemy, from: THREE.Vector3, target: Enemy, damage: number): void {
  const dir = _dir.copy(target.pos).sub(from).normalize();
  const mesh = new THREE.Mesh(BOLT_GEO, new THREE.MeshBasicMaterial({ color: 0x7af0ff, transparent: true, opacity: 0.95 }));
  mesh.scale.set(1, 1, 3);
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(Z, dir);
  const glow = new THREE.Mesh(BOLT_GEO, new THREE.MeshBasicMaterial({ color: ALLY_CYAN, transparent: true, opacity: 0.25, depthWrite: false }));
  glow.scale.setScalar(2);
  mesh.add(glow);
  world.scene.add(mesh);
  boltsOf(e).push({ pos: from.clone(), vel: dir.clone().multiplyScalar(ALLY.boltSpeed), life: ALLY.boltLife, damage, mesh });
  spawnBurst(world, from, 0x66e6ff, 3, 2, 0.2);
  e.ai.recoil = 1;
  world.events.emit('enemyAttack', { kind: 'walker', pos: e.pos.clone() });
}

/** 味方の弾を進める。敵に当たればダメージ、壁で消える */
export function updateAllyBolts(world: World, e: Enemy, dt: number): void {
  const list = boltsOf(e);
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    b.life -= dt;
    let dead = b.life <= 0;
    if (!dead) {
      _p1.copy(b.pos).addScaledVector(b.vel, dt);
      const hit = raycastEnemies(world.enemies, b.pos, _p1, 0.12);
      const tl = raycastLevel(world.colliders, b.pos, _p1);
      if (hit && (tl === null || hit.t <= tl)) {
        damageEnemy(world, hit.enemy, b.damage, { weak: hit.weak, how: 'shot', hitPos: hit.point });
        spawnBurst(world, hit.point, hit.weak ? 0xfff27a : 0x66e6ff, 7, 3);
        dead = true;
      } else if (tl !== null) {
        spawnBurst(world, b.pos.clone().lerp(_p1, tl), 0x66e6ff, 4, 2);
        dead = true;
      } else {
        b.pos.copy(_p1);
        b.mesh.position.copy(b.pos);
      }
    }
    if (dead) {
      removeBolt(world, b);
      list.splice(i, 1);
    }
  }
}

/** 視界内（壁にさえぎられていない）で最も近い、撃てる敵 */
export function findAllyTarget(world: World, e: Enemy, sight: number): Enemy | undefined {
  let best: Enemy | undefined, bd = sight;
  for (const o of world.enemies) {
    if (o === e || !isTargetable(o)) continue;
    const d = o.pos.distanceTo(e.pos);
    if (d >= bd) continue;
    if (!hasLineOfSight(world.colliders, _from.copy(e.pos), o.pos)) continue;
    best = o; bd = d;
  }
  return best;
}

/**
 * 味方の毎フレームの共通処理。初回の初期化・残り時間・弾の更新・時間切れ。
 * 時間切れなら 'allyExpire' を出して停止させ false を返す（呼び出し側は何もせず戻る）
 */
export function beginAllyFrame(world: World, e: Enemy, dt: number): boolean {
  const ai = e.ai;
  if (!ai.allyInit) {
    // 味方になった直後：敵だったときの射撃タイマーを持ち越さない
    ai.allyInit = true;
    ai.atkTimer = ALLY.firstShot;
    ai.windup = 0;
  }
  // ai.allyPermanent：時間切れで元に戻らない味方（サージ収容所1階の赤ウォーカー）。残り時間は満タンのまま
  if (ai.allyPermanent) ai.allyT = ai.allyMax ?? ai.allyT ?? 1;
  else ai.allyT = (ai.allyT ?? 0) - dt;
  updateAllyBolts(world, e, dt);
  if (ai.allyT <= 0) {
    // 時間切れ：撃破扱いにせず停止
    world.events.emit('allyExpire', { pos: e.pos.clone() });
    shutdownEnemy(world, e);
    return false;
  }
  return true;
}

/** 標的を一定間隔で探し直して返す（無効になったら即座に外す） */
export function updateAllyTarget(world: World, e: Enemy, dt: number, sight: number): Enemy | undefined {
  const ai = e.ai;
  ai.scanT = (ai.scanT ?? 0) - dt;
  const cur = ai.allyTarget as Enemy | undefined;
  if (cur && (
    cur === e
    || !isTargetable(cur)
    || !world.enemies.includes(cur)
    || e.pos.distanceTo(cur.pos) >= sight
    || !hasLineOfSight(world.colliders, _from.copy(e.pos), cur.pos)
  )) ai.allyTarget = undefined;
  if (ai.scanT <= 0 || !ai.allyTarget) {
    ai.scanT = ALLY.scanInterval;
    ai.allyTarget = findAllyTarget(world, e, sight);
  }
  return ai.allyTarget as Enemy | undefined;
}

// ---------------------------------------------------------------- 見た目

/** 味方の色：赤い部分を青緑系にする（初回だけ） */
export function tintAlly(e: Enemy): void {
  const ai = e.ai;
  if (ai.allyTinted) return;
  ai.allyTinted = true;
  const m = ai.model;
  const hsl = { h: 0, s: 0, l: 0 };
  for (const b of m.bodyMats) {
    b.base.getHSL(hsl);
    // 赤（彩度が高い色）は青へ、銀・白は少し青みがかる程度
    b.base.setHSL(0.57, Math.min(0.85, hsl.s * 0.9 + 0.05), hsl.l);
  }
  for (const em of m.eyeMats) { em.color.setHex(0xc8f6ff); em.emissive.setHex(ALLY_CYAN); }
  for (const lm of (m.parts.lamps ?? []) as THREE.MeshStandardMaterial[]) lm.emissive.setHex(ALLY_CYAN);
}

/**
 * 種類別 animate の最後に呼ぶ：味方なら色替え＋青緑の発光（残り少ないと点滅）、
 * 敵ならビーコンの点滅（つながれている間は速く）
 */
export function animateAllyLook(e: Enemy, down: boolean): void {
  const ai = e.ai;
  const m = ai.model;
  const t = ai.t ?? 0;
  const beaconMat = (m.parts.beacon as THREE.Mesh | undefined)?.material as THREE.MeshStandardMaterial | undefined;
  if (e.allied) {
    tintAlly(e);
    if (down || !beaconMat) {
      if (down && beaconMat) { beaconMat.emissive.setHex(BEACON_OFF); beaconMat.emissiveIntensity = 0; }
      return;
    }
    // 点滅：残り時間が少ないほど速く
    const left = ai.allyT ?? 0;
    const blink = left < ALLY.blinkTime;
    const on = !blink || Math.sin(t * (14 + (ALLY.blinkTime - left) * 4)) > 0;
    const glow = blink ? (on ? 0.9 : 0) : 0.22 + 0.08 * Math.sin(t * 5);
    for (const b of m.bodyMats) { b.mat.emissive.setHex(ALLY_CYAN); b.mat.emissiveIntensity = glow; }
    beaconMat.emissive.setHex(ALLY_CYAN);
    beaconMat.emissiveIntensity = blink ? (on ? 3 : 0.1) : 2.2;
  } else if (beaconMat) {
    if (down) { beaconMat.emissive.setHex(BEACON_OFF); beaconMat.emissiveIntensity = 0; return; }
    // ハッキングできる印：ビーコンがゆっくり点滅。つながれている間は速く
    const f = e.tethered ? 14 : 2.2;
    beaconMat.emissive.setHex(HACK_CYAN);
    beaconMat.emissiveIntensity = 0.3 + 2 * Math.max(0, Math.sin(t * f));
  }
}

// ---------------------------------------------------------------- ハッキングできる印

/**
 * ハッキングポート（上面の白いパネルと青緑の端子）と、先端にビーコンのある皿型アンテナを足す。
 * port=パネルの中心、mast=支柱の中心、mastH=支柱の長さ。b.parts.beacon に先端の球を登録する
 */
export function addHackCue(b: Builder, port: [number, number, number], mast: [number, number, number], mastH: number, scale = 1): void {
  const dark = b.body(0x2b0d12, 0.7, true), white = b.body(0xf2f5fa, 0.5, true);
  b.block(0.34 * scale, 0.04 * scale, 0.2 * scale, white, b.vis, port[0], port[1], port[2], 0.012);
  const pin = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: HACK_CYAN, emissiveIntensity: 1.6, roughness: 0.4 });
  for (const px of [-0.1, -0.033, 0.033, 0.1]) {
    b.mesh(boxGeo(0.03 * scale, 0.05 * scale, 0.1 * scale), pin, b.vis, port[0] + px * scale, port[1] + 0.04 * scale, port[2]).castShadow = false;
  }
  b.prism(0.02, mastH, 4, dark, b.vis, mast[0], mast[1], mast[2]);
  const top = mast[1] + mastH / 2;
  b.prism(0.16 * scale, 0.035, 8, white, b.vis, mast[0], top - 0.09, mast[2]).rotation.x = -0.35;
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: HACK_CYAN, emissiveIntensity: 2, roughness: 0.3 });
  const beacon = b.mesh(sphereGeo(0.055 * scale), beaconMat, b.vis, mast[0], top + 0.03, mast[2]);
  beacon.castShadow = false;
  b.parts.beacon = beacon;
  b.parts.pin = pin;
}
