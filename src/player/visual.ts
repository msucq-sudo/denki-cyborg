// プレイヤーの見た目（ふんわりサイボーグ）
import * as THREE from 'three';
import { PLAYER } from '../config/balance';

export interface PlayerVisual {
  body: THREE.Group;          // root の子。上下の揺れ・傾きはここに適用
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftArm: THREE.Group;
  gunPivot: THREE.Group;      // 右肩。pitch で上下に振る
  muzzle: THREE.Object3D;     // 銃口
  leftShoulder: THREE.Object3D;
  whiteMats: THREE.MeshStandardMaterial[];
  cyanMats: THREE.MeshStandardMaterial[];
  batteryMat: THREE.MeshStandardMaterial;
  visorMat: THREE.MeshStandardMaterial;
  jets: THREE.Group;
  jetMats: THREE.MeshBasicMaterial[];
  jetLight: THREE.PointLight;
  chargeGroup: THREE.Group;   // 銃口の電気球
  chargeCore: THREE.Mesh;
  chargeGlow: THREE.Mesh;
  sparks: THREE.Mesh[];
  chargeLight: THREE.PointLight;
}

export const CYAN = 0x4de8ff;

export function buildPlayerVisual(root: THREE.Group): PlayerVisual {
  while (root.children.length) root.remove(root.children[0]);

  const white = () => new THREE.MeshStandardMaterial({ color: 0xf6f8ff, roughness: 0.55, metalness: 0.05, emissive: 0xff5a5a, emissiveIntensity: 0 });
  const grey = () => new THREE.MeshStandardMaterial({ color: 0xc9d4e6, roughness: 0.5, metalness: 0.1, emissive: 0xff5a5a, emissiveIntensity: 0 });
  const cyan = (i = 1.4) => new THREE.MeshStandardMaterial({ color: 0x1b3a44, emissive: CYAN, emissiveIntensity: i, roughness: 0.3 });
  const whiteMats: THREE.MeshStandardMaterial[] = [];
  const cyanMats: THREE.MeshStandardMaterial[] = [];
  const W = () => { const m = white(); whiteMats.push(m); return m; };
  const G = () => { const m = grey(); whiteMats.push(m); return m; };
  const C = (i?: number) => { const m = cyan(i); cyanMats.push(m); return m; };
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  const body = new THREE.Group();
  root.add(body);

  // 胴体（カプセル）
  add(body, new THREE.CapsuleGeometry(0.3, 0.42, 6, 16), W(), 0, 0.98, 0);
  // 胸の発光ライン
  const chest = add(body, new THREE.TorusGeometry(0.3, 0.025, 8, 24), C(1.2), 0, 1.12, 0);
  chest.rotation.x = Math.PI / 2;
  chest.scale.set(1, 1, 1);
  // 頭
  add(body, new THREE.SphereGeometry(0.28, 20, 16), W(), 0, 1.56, 0);
  // バイザー（前=-Z）
  const visorMat = C(2.2);
  const visor = add(body, new THREE.SphereGeometry(1, 16, 12), visorMat, 0, 1.58, -0.2);
  visor.scale.set(0.22, 0.1, 0.1);
  visor.castShadow = false;
  // 耳（ヘッドホン風）
  for (const s of [-1, 1]) {
    add(body, new THREE.SphereGeometry(0.09, 10, 8), C(1.6), s * 0.29, 1.56, 0.0);
  }
  // アンテナの先
  add(body, new THREE.SphereGeometry(0.04, 8, 6), C(2), 0, 1.86, 0);

  // 脚
  const mkLeg = (x: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(x, 0.5, 0);
    add(g, new THREE.CapsuleGeometry(0.1, 0.2, 4, 10), G(), 0, -0.2, 0);
    add(g, new THREE.SphereGeometry(0.13, 10, 8), W(), 0, -0.4, -0.03).scale.set(1, 0.7, 1.3);
    body.add(g);
    return g;
  };
  const leftLeg = mkLeg(-0.13);
  const rightLeg = mkLeg(0.13);

  // 左腕（吸収アームの根元）
  const leftShoulder = new THREE.Object3D();
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.38, 1.25, 0);
  leftArm.rotation.x = -0.35;
  add(leftArm, new THREE.CapsuleGeometry(0.08, 0.22, 4, 10), G(), 0, 0, -0.2).rotation.x = Math.PI / 2;
  add(leftArm, new THREE.SphereGeometry(0.1, 10, 8), C(1.2), 0, 0, -0.42);
  leftShoulder.position.set(0, 0, -0.45);
  leftArm.add(leftShoulder);
  body.add(leftArm);

  // 右腕＋電気銃
  const gunPivot = new THREE.Group();
  gunPivot.position.set(0.38, 1.25, 0);
  add(gunPivot, new THREE.CapsuleGeometry(0.08, 0.2, 4, 10), G(), 0, 0, -0.18).rotation.x = Math.PI / 2;
  add(gunPivot, new THREE.SphereGeometry(0.1, 10, 8), W(), 0, 0, -0.38);
  const gun = add(gunPivot, new THREE.CapsuleGeometry(0.07, 0.26, 4, 10), W(), 0, 0.02, -0.55);
  gun.rotation.x = Math.PI / 2;
  const ring = add(gunPivot, new THREE.TorusGeometry(0.085, 0.02, 8, 16), C(2), 0, 0.02, -0.64);
  ring.castShadow = false;
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.78);
  gunPivot.add(muzzle);
  body.add(gunPivot);

  // 銃口の電気球
  const chargeGroup = new THREE.Group();
  muzzle.add(chargeGroup);
  const chargeCore = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xeaffff }));
  const chargeGlow = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.4, depthWrite: false }));
  chargeGroup.add(chargeCore, chargeGlow);
  const sparkGeo = new THREE.SphereGeometry(0.03, 6, 4);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xc8ffff });
  const sparks: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(sparkGeo, sparkMat); sparks.push(s); chargeGroup.add(s); }
  const chargeLight = new THREE.PointLight(CYAN, 0, 6, 2);
  chargeGroup.add(chargeLight);

  // 背中のバッテリーパック
  const pack = add(body, new THREE.CapsuleGeometry(0.15, 0.3, 4, 12), G(), 0, 1.1, 0.36);
  pack.scale.set(1.1, 1, 0.8);
  const batteryMat = C(1.5);
  const strip = add(body, new THREE.CapsuleGeometry(0.05, 0.28, 4, 8), batteryMat, 0, 1.1, 0.46);
  strip.castShadow = false;
  strip.scale.set(1.1, 1, 0.5);
  add(body, new THREE.SphereGeometry(0.06, 8, 6), batteryMat, 0, 1.38, 0.4).castShadow = false;

  // 飛行ジェット
  const jets = new THREE.Group();
  const jetMats: THREE.MeshBasicMaterial[] = [];
  for (const s of [-1, 1]) {
    const m = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.7, depthWrite: false });
    jetMats.push(m);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.7, 10), m);
    cone.rotation.x = Math.PI; // 先端を下へ
    cone.position.set(s * 0.13, -0.3, 0);
    jets.add(cone);
  }
  const jetLight = new THREE.PointLight(CYAN, 0, 7, 2);
  jetLight.position.set(0, -0.1, 0);
  jets.add(jetLight);
  root.add(jets);

  root.updateMatrixWorld(true);
  void PLAYER;
  return {
    body, leftLeg, rightLeg, leftArm, gunPivot, muzzle, leftShoulder,
    whiteMats, cyanMats, batteryMat, visorMat, jets, jetMats, jetLight,
    chargeGroup, chargeCore, chargeGlow, sparks, chargeLight,
  };
}
