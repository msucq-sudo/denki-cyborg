// ドレインガーディアンの見た目。原点は胴体の中心（足の裏は y = -FLOOR）。+Z が正面。
// 分厚い胴体・胴体の上の大きな目玉・とても太い脚・大きな2本の腕（右腕=ミサイルポッド／左腕=電撃砲）。
// 右・左はボス自身から見た左右（正面から見ると画面の逆側）。右腕は -X、左腕は +X。
import * as THREE from 'three';
import { Builder, boxGeo, polyCyl, sphereGeo, taperGeo, unitCircle, unitStrip } from '../models';
import type { Model } from '../models';
import { createGuard } from './drainGuardLogic';

/** 足の裏の高さ（原点から下へ）。ENEMIES.drainGuard.radius と同じ */
export const FLOOR = 2.8;
export const SHOULDER = { x: 3.75, y: 3.3, z: 0.1 };
/** 腕の長さ（肩から拳の先まで） */
export const ARM_LEN = 6;
export const EYE_POS = { x: 0, y: 5.5, z: 0.15 };

const PAL = {
  steel: 0x3b4150, steel2: 0x2a2e3a, plate: 0x59606e, dark: 0x16181f, red: 0xb52a3a, hazard: 0xe0a21c,
  glow: 0x5ab8ff, hot: 0xff5a30,
};

export interface GuardArmRig {
  pivot: THREE.Group;
  /** 拳の先（ミサイル／電撃の発射点） */
  muzzle: THREE.Object3D;
  /** 拳の中心（パンチの当たり・当たり判定） */
  fist: THREE.Object3D;
  /** 肘 */
  elbow: THREE.Object3D;
  /** 壊れたときの見た目の切り替え用（腕全体） */
  limb: THREE.Group;
  /** 発光材質（溜め・再生中に光らせる） */
  glowMat: THREE.MeshStandardMaterial;
}

function buildArm(b: Builder, side: -1 | 1, mats: { steel: THREE.Material; plate: THREE.Material; dark: THREE.Material; red: THREE.Material }, left: boolean): GuardArmRig {
  const pivot = new THREE.Group();
  pivot.position.set(side * SHOULDER.x, SHOULDER.y, SHOULDER.z);
  b.vis.add(pivot);
  const limb = new THREE.Group();
  pivot.add(limb);
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, emissive: PAL.glow, emissiveIntensity: 0.9, roughness: 0.4 });
  // 肩の球 → 二の腕 → 肘 → 前腕+拳
  b.mesh(sphereGeo(1.25), mats.plate, limb, 0, 0, 0);
  b.block(1.8, 2.7, 1.8, mats.steel, limb, 0, -1.6, 0, 0.18);
  b.block(0.14, 2.0, 0.6, glowMat, limb, side * 0.92, -1.6, 0.4, 0.03).castShadow = false;
  const elbow = new THREE.Group();
  elbow.position.set(0, -3.05, 0);
  limb.add(elbow);
  b.mesh(sphereGeo(1.0), mats.plate, elbow, 0, 0, 0);
  b.block(2.5, 2.5, 2.7, mats.steel, limb, 0, -4.45, 0.05, 0.26);
  b.block(2.6, 0.45, 2.8, mats.red, limb, 0, -3.6, 0.05, 0.1);
  const fist = new THREE.Group();
  fist.position.set(0, -4.5, 0.25);
  limb.add(fist);
  const muzzle = new THREE.Group();
  if (!left) {
    // 右腕：ミサイルポッド（拳の先に3本の発射管）
    b.block(2.3, 0.5, 2.3, mats.dark, limb, 0, -5.8, 0.1, 0.08);
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.74;
      b.prism(0.3, 0.8, 8, mats.dark, limb, x, -6.2, 0.1);
      b.mesh(sphereGeo(0.2), glowMat, limb, x, -6.6, 0.1).castShadow = false;
    }
    muzzle.position.set(0, -6.7, 0.1);
  } else {
    // 左腕：電撃砲（太い砲身とコイル）
    b.block(2.0, 0.5, 2.0, mats.dark, limb, 0, -5.8, 0.1, 0.08);
    b.mesh(taperGeo(0.55, 0.85, 1.7, 10), mats.dark, limb, 0, -6.6, 0.1);
    for (let i = 0; i < 3; i++) b.mesh(new THREE.TorusGeometry(0.82 - i * 0.06, 0.09, 6, 14), glowMat, limb, 0, -6.2 - i * 0.36, 0.1).rotation.x = Math.PI / 2;
    muzzle.position.set(0, -7.6, 0.1);
  }
  limb.add(muzzle);
  return { pivot, muzzle, fist, elbow, limb, glowMat };
}

export interface GuardParts {
  guard: ReturnType<typeof createGuard>;
  rArm: GuardArmRig;
  lArm: GuardArmRig;
  legs: THREE.Group[];
  eye: THREE.Group;
  iris: THREE.Mesh;
  irisMat: THREE.MeshStandardMaterial;
  eyeball: THREE.Mesh;
  aura: THREE.Mesh;
  auraMat: THREE.MeshBasicMaterial;
  core: THREE.MeshStandardMaterial;
  teleCircle: THREE.Mesh;
  teleStrip: THREE.Mesh;
  orb: THREE.Mesh;
  orbMat: THREE.MeshBasicMaterial;
  torso: THREE.Object3D;
  legAnchors: THREE.Object3D[];
}

export function buildGuardModel(): Model {
  const b = new Builder();
  const steel = b.body(PAL.steel, 0.55, true), steel2 = b.body(PAL.steel2, 0.6, true), plate = b.body(PAL.plate, 0.5, true);
  const dark = b.body(PAL.dark, 0.7, true), red = b.body(PAL.red, 0.5, true), hazard = b.body(PAL.hazard, 0.6, true);
  const core = new THREE.MeshStandardMaterial({ color: 0x4a1a0a, emissive: PAL.hot, emissiveIntensity: 1.1, roughness: 0.4 });

  // ---- 脚：とても太い。足の裏が -FLOOR
  const legs: THREE.Group[] = [];
  const legAnchors: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 1.7, 0.1, 0);
    b.vis.add(hip);
    const leg = new THREE.Group();
    hip.add(leg);
    b.block(2.8, 1.8, 2.9, steel2, leg, 0, -0.45, 0, 0.26);
    b.block(2.7, 1.8, 2.8, steel, leg, 0, -2.0, 0.05, 0.26);
    b.block(2.5, 0.3, 2.6, red, leg, 0, -1.15, 0.05, 0.08);
    b.block(3.1, 0.7, 3.6, plate, leg, 0, -2.55, 0.45, 0.16);    // 足
    b.block(3.15, 0.14, 3.65, hazard, leg, 0, -2.2, 0.45, 0.03);
    const a = new THREE.Object3D();
    a.position.set(0, -1.3, 0.1);
    leg.add(a);
    legAnchors.push(a);
    legs.push(hip);
  }
  // ---- 腰と胴体
  b.block(5.2, 1.0, 3.4, dark, b.vis, 0, 0.55, 0, 0.2);
  const torso = new THREE.Group();
  torso.position.set(0, 2.45, 0);
  b.vis.add(torso);
  b.block(6.0, 3.5, 3.9, steel, torso, 0, 0, 0, 0.4);
  b.block(5.0, 2.3, 0.55, plate, torso, 0, 0.1, 2.0, 0.16);                         // 胸のプレート
  b.mesh(boxGeo(2.6, 1.1, 0.2), core, torso, 0, 0.1, 2.34).castShadow = false;        // 胸のコア（ドレイン装置につながる光）
  for (let i = 0; i < 4; i++) b.mesh(boxGeo(0.4, 0.13, 0.22), dark, torso, -1.05 + i * 0.7, -0.8, 2.34);
  b.block(6.2, 0.42, 4.1, red, torso, 0, -1.7, 0, 0.1);
  b.block(6.2, 0.34, 4.1, hazard, torso, 0, 1.7, 0, 0.1);
  // 背中の排気
  for (let i = 0; i < 3; i++) b.prism(0.4, 1.5, 8, dark, torso, -1.6 + i * 1.6, 1.3, -2.2);
  // 肩のアーマー
  for (const sx of [-1, 1]) b.block(2.4, 0.6, 2.8, plate, b.vis, sx * 3.75, 4.75, 0.1, 0.14);
  // ---- 腕
  const armMats = { steel, plate, dark, red };
  const rArm = buildArm(b, -1, armMats, false);
  const lArm = buildArm(b, 1, armMats, true);

  // ---- 目玉（胴体の上）
  b.block(2.9, 0.5, 2.6, dark, b.vis, 0, 4.45, 0.1, 0.12);
  b.mesh(new THREE.TorusGeometry(1.3, 0.2, 8, 22), red, b.vis, EYE_POS.x, 4.8, EYE_POS.z).rotation.x = Math.PI / 2;
  const eye = new THREE.Group();
  eye.position.set(EYE_POS.x, EYE_POS.y, EYE_POS.z);
  b.vis.add(eye);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xe9eef5, roughness: 0.25, emissive: 0x303844, emissiveIntensity: 0.5 });
  const eyeball = b.mesh(sphereGeo(1.2), eyeMat, eye, 0, 0, 0);
  const irisMat = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x30d8ff, emissiveIntensity: 1.8, roughness: 0.3 });
  b.eyeMats.push(irisMat);
  const iris = b.mesh(sphereGeo(0.6), irisMat, eye, 0, 0, 0.82);
  iris.scale.set(1, 1, 0.5);
  iris.castShadow = false;
  const pupil = b.mesh(sphereGeo(0.27), new THREE.MeshBasicMaterial({ color: 0x05070c }), iris, 0, 0, 0.55);
  pupil.castShadow = false;

  // ---- 第2形態のオーラ（目玉のまわり）
  const auraMat = new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const aura = new THREE.Mesh(sphereGeo(1), auraMat);
  aura.scale.setScalar(2.6);
  aura.position.set(EYE_POS.x, EYE_POS.y, EYE_POS.z);
  aura.visible = false;
  b.vis.add(aura);

  // ---- 左腕の溜め球
  const orbMat = new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
  const orb = new THREE.Mesh(sphereGeo(1), orbMat);
  orb.visible = false;
  lArm.muzzle.add(orb);

  // ---- 予兆（足元の赤い円と帯。root 直下なので向きに追従する）
  const teleMat = () => new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const fy = -FLOOR + 0.07;
  const teleCircle = new THREE.Mesh(unitCircle(), teleMat());
  teleCircle.rotation.x = -Math.PI / 2; teleCircle.position.y = fy; teleCircle.visible = false; teleCircle.renderOrder = 2;
  b.root.add(teleCircle);
  const teleStrip = new THREE.Mesh(unitStrip(), teleMat());
  teleStrip.position.y = fy; teleStrip.visible = false; teleStrip.renderOrder = 2;
  b.root.add(teleStrip);
  void polyCyl;

  const parts: GuardParts = {
    guard: createGuard(), rArm, lArm, legs, eye, iris, irisMat, eyeball, aura, auraMat, core, teleCircle, teleStrip, orb, orbMat, torso, legAnchors,
  };
  Object.assign(b.parts, parts);
  return b.done();
}
