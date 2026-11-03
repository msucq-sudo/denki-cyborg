// シールド。LT（照準。マウスなら右ボタン）を構えている間、プレイヤーの前に水色の盾が出て、前方からの攻撃を受け止める。
// 盾には耐久（SHIELD.maxHp）があり、受けたダメージぶん減る。0 になると壊れ、電力をじわじわ使って自動で回復する
// （電力が尽きると回復も止まる）。回復し切るまでは盾は出せない。
// ダメージの出どころ（from）を渡された damagePlayer だけが盾で防げる（出どころなしの床の罠などは防げない）。
import * as THREE from 'three';
import { PLAYER, SHIELD } from '../config/balance';
import { drainEnergy } from '../core/energy';
import { cameraForward } from '../player/logic';
import type { World } from '../core/types';

const CYAN = 0x66e6ff;

// ---------------------------------------------------------------- 判定・状態
/** 盾を構えている（出ている）か */
export function shieldRaised(world: World): boolean {
  const sh = world.shield;
  return world.unlocks.shield && !sh.broken && sh.hp > 0 && world.state === 'playing' && !world.hack.active && world.input.mouse(2);
}

const _d = new THREE.Vector3();
/** 攻撃の出どころ from が盾の前方にあるか（水平方向で判定） */
export function shieldFaces(world: World, from: THREE.Vector3): boolean {
  const p = world.player;
  _d.set(from.x - p.pos.x, 0, from.z - p.pos.z);
  const len = _d.length();
  if (len < 0.05) return true; // ほぼ重なっている近接攻撃は前方扱い
  const f = cameraForward(p.yaw, 0);
  return (_d.x * f.x + _d.z * f.z) / len >= Math.cos((SHIELD.halfAngleDeg * Math.PI) / 180);
}

/** ダメージを盾で受け止める。受け止めたら true（プレイヤーは無傷）。盾が壊れる一撃も、その一撃はここで止める */
export function shieldBlocks(world: World, amount: number, from: THREE.Vector3): boolean {
  if (!shieldRaised(world) || !shieldFaces(world, from)) return false;
  const sh = world.shield;
  sh.hp = Math.max(0, sh.hp - amount);
  sh.hitAt = world.time;
  const at = new THREE.Vector3(world.player.pos.x, world.player.pos.y + PLAYER.height * 0.55, world.player.pos.z);
  const f = cameraForward(world.player.yaw, 0);
  at.x += f.x * 0.9; at.z += f.z * 0.9;
  world.events.emit('shieldBlock', { pos: at });
  if (sh.hp <= 0) {
    sh.broken = true;
    world.events.emit('shieldBreak', { pos: at });
    world.toasts.push({ text: 'シールドが壊れた！ 電力を使って回復中…', timer: 2.5 });
  }
  return true;
}

/** 毎フレーム：構え具合の更新と、壊れたあとの電力を使った回復 */
export function updateShield(world: World, dt: number): void {
  const sh = world.shield;
  if (!world.unlocks.shield) { sh.k = 0; return; }
  const target = shieldRaised(world) ? 1 : 0;
  sh.k += (target - sh.k) * (dt === 0 ? 1 : 1 - Math.exp(-SHIELD.blendRate * dt));
  if (Math.abs(sh.k - target) < 0.01) sh.k = target;

  if (sh.broken && world.state === 'playing') {
    // じわじわ電力を使って回復（電力が足りた割合だけ進む）
    const ratio = drainEnergy(world, SHIELD.recoverDrainPerSec * dt);
    sh.hp = Math.min(SHIELD.maxHp, sh.hp + SHIELD.recoverPerSec * dt * ratio);
    if (sh.hp >= SHIELD.maxHp) {
      sh.broken = false;
      world.events.emit('shieldReady', {});
      world.toasts.push({ text: 'シールド回復', timer: 1.5 });
    }
  }
  syncShieldVisual(world);
}

/** シールドを入手した（耐久は満タンから） */
export function giveShield(world: World): void {
  world.unlocks.shield = true;
  world.shield.hp = SHIELD.maxHp;
  world.shield.broken = false;
}

// ---------------------------------------------------------------- 3D モデル
export interface ShieldModel {
  group: THREE.Group;
  /** 面の素材（不透明度・色を動かす） */
  panelMat: THREE.MeshBasicMaterial;
  gridMat: THREE.LineBasicMaterial;
}

/**
 * 盾のモデル。原点＝プレイヤーの体の中心の高さ、-Z が前。半径 radius の円筒を前方 arc ラジアンぶん切り出した曲面で、
 * 六角のセル模様と縁の枠、うっすら光る面でできている。
 */
export function buildShieldModel(opt: { radius?: number; height?: number; arc?: number } = {}): ShieldModel {
  const radius = opt.radius ?? 1.0, height = opt.height ?? 1.9, arc = opt.arc ?? Math.PI * (2 / 3);
  const g = new THREE.Group();
  g.name = 'shield';
  const start = Math.PI - arc / 2;
  const panelMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const panel = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 28, 1, true, start, arc), panelMat);
  g.add(panel);

  // 六角のセル（面の上の線）
  const gridMat = new THREE.LineBasicMaterial({ color: 0xcff8ff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts: number[] = [];
  const cellH = 0.3, cols = 8, rows = Math.round(height / (cellH * 1.5));
  const at = (u: number, v: number): [number, number, number] => {
    const a = start + arc * u;
    return [radius * Math.sin(a), (v - 0.5) * height, radius * Math.cos(a)];
  };
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u0 = (c + (r % 2 ? 0.5 : 0)) / cols, v0 = r / rows;
      // 六角形の上半分（山形）を並べる
      const du = 0.5 / cols, dv = 0.5 / rows;
      const seg: [number, number][][] = [
        [[u0, v0], [u0 + du, v0 + dv]], [[u0 + du, v0 + dv], [u0 + 2 * du, v0]],
        [[u0 + 2 * du, v0], [u0 + 2 * du, v0 - dv]], [[u0, v0], [u0, v0 - dv]],
      ];
      for (const [a, b] of seg) {
        if (a[0] > 1 || b[0] > 1 || a[1] < 0 || b[1] < 0 || a[1] > 1 || b[1] > 1) continue;
        pts.push(...at(a[0] * 1, a[1] * 1), ...at(b[0] * 1, b[1] * 1));
      }
    }
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const grid = new THREE.LineSegments(gridGeo, gridMat);
  grid.scale.setScalar(1.004);
  g.add(grid);

  // 縁の枠（上下の弧と左右の縦棒）
  const frameMat = new THREE.MeshBasicMaterial({ color: 0xbaf4ff, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
  for (const y of [-height / 2, height / 2]) {
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 17 }, (_, i) => new THREE.Vector3(radius * Math.sin(start + (arc * i) / 16), y, radius * Math.cos(start + (arc * i) / 16))));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.03, 6, false), frameMat));
  }
  for (const a of [start, start + arc]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, height, 6), frameMat);
    bar.position.set(radius * Math.sin(a), 0, radius * Math.cos(a));
    g.add(bar);
  }
  return { group: g, panelMat, gridMat };
}

/**
 * 拾うアイテムの盾（床に浮かぶ紋章）。紋章形に押し出した水色の板に、縁の枠・中央の稲妻・台座の輪を付けた。
 * 原点＝アイテムの中心。回転と上下の揺れは呼び出し側が行う
 */
export function buildShieldPickup(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'shieldPickup';
  // 紋章形（上が平ら、下が尖る）の輪郭
  const outline = (s: number): THREE.Shape => {
    const sh = new THREE.Shape();
    sh.moveTo(-0.38 * s, 0.5 * s);
    sh.lineTo(0.38 * s, 0.5 * s);
    sh.lineTo(0.42 * s, 0.1 * s);
    sh.quadraticCurveTo(0.38 * s, -0.32 * s, 0, -0.6 * s);
    sh.quadraticCurveTo(-0.38 * s, -0.32 * s, -0.42 * s, 0.1 * s);
    sh.closePath();
    return sh;
  };
  const rim = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outline(1), { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }),
    new THREE.MeshStandardMaterial({ color: 0xeaf6ff, metalness: 0.6, roughness: 0.25 }),
  );
  rim.position.z = -0.05;
  g.add(rim);
  const face = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outline(0.84), { depth: 0.06, bevelEnabled: false }),
    new THREE.MeshStandardMaterial({ color: CYAN, emissive: 0x1a8ab0, emissiveIntensity: 1.1, metalness: 0.3, roughness: 0.35 }),
  );
  face.position.z = 0.06;
  g.add(face);
  // 中央の稲妻
  const bolt = new THREE.Shape();
  bolt.moveTo(0.06, 0.34); bolt.lineTo(-0.16, -0.02); bolt.lineTo(-0.02, -0.02); bolt.lineTo(-0.08, -0.34);
  bolt.lineTo(0.17, 0.06); bolt.lineTo(0.03, 0.06); bolt.closePath();
  const boltMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(bolt, { depth: 0.04, bevelEnabled: false }), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  boltMesh.position.z = 0.13;
  g.add(boltMesh);
  // 台座の輪と光の柱
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.03, 6, 28), new THREE.MeshBasicMaterial({ color: 0x8af0ff, transparent: true, opacity: 0.85 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.7;
  g.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.5, 6, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beam.position.y = 2.3;
  g.add(beam);
  return g;
}

// ---------------------------------------------------------------- プレイヤーに付ける盾
const worn = new WeakMap<World, ShieldModel>();

function syncShieldVisual(world: World): void {
  let m = worn.get(world);
  if (!m) {
    m = buildShieldModel();
    m.group.position.y = PLAYER.height * 0.5;
    m.group.visible = false;
    world.player.root.add(m.group);
    worn.set(world, m);
  }
  const sh = world.shield;
  m.group.visible = sh.k > 0.01;
  if (!m.group.visible) return;
  const hit = Math.max(0, 1 - (world.time - sh.hitAt) / 0.25);       // 受け止めた直後に光る
  const low = 1 - sh.hp / SHIELD.maxHp;                               // 耐久が減るほど薄く・ちらつく
  const flicker = low > 0.6 ? 0.75 + 0.25 * Math.sin(world.time * 40) : 1;
  m.panelMat.opacity = (0.2 + 0.5 * hit) * (1 - low * 0.5) * flicker * sh.k;
  m.gridMat.opacity = (0.5 + 0.5 * hit) * flicker * sh.k;
  m.group.scale.set(0.8 + 0.2 * sh.k, 1, 0.8 + 0.2 * sh.k);
}
