// 運転中の見せ場：速いほど流れ込む風の筋（スピード線）。道に固定した細い光の棒を、車が追い越すたびに前方へ置き直す。
import * as THREE from 'three';

export interface SpeedLines {
  /** 車の位置 (x, z)・進む向き（-1=西 / +1=東 / 0=描かない）・速度 km/h */
  update(carX: number, carZ: number, dirX: number, kmh: number, dt: number): void;
  dispose(): void;
  readonly mesh: THREE.InstancedMesh;
}

const COUNT = 56;
const AHEAD = 90, BEHIND = 18;

export function createSpeedLines(scene: THREE.Scene): SpeedLines {
  const geo = new THREE.BoxGeometry(1, 0.035, 0.035);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xcff6ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 5;
  scene.add(mesh);
  // 筋ごとの位置（車の進行方向に対する前後 u、横 s、高さ y）と長さの個体差
  const seed = new Float32Array(COUNT * 4);
  let r = 12345;
  const rnd = (): number => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < COUNT; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    seed[i * 4] = rnd(); // 前後（0..1）
    seed[i * 4 + 1] = side * (2.2 + rnd() * 9); // 横
    seed[i * 4 + 2] = 0.3 + rnd() * 4.5; // 高さ
    seed[i * 4 + 3] = 0.6 + rnd() * 0.9; // 長さの倍率
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  let phase = 0;

  function update(carX: number, carZ: number, dirX: number, kmh: number, dt: number): void {
    const k = THREE.MathUtils.clamp((kmh - 130) / 190, 0, 1);
    if (dirX === 0 || k <= 0.01) { mesh.visible = false; return; }
    mesh.visible = true;
    mat.opacity = 0.55 * k;
    // 筋は道に対して止まっている。車が進むぶんだけ後ろへ流れる（位相を車の移動量で進める）
    phase += (kmh / 3.6) * dt;
    const span = AHEAD + BEHIND;
    for (let i = 0; i < COUNT; i++) {
      // 前方 AHEAD 〜 後方 BEHIND の範囲を周回する
      const u = (((seed[i * 4] * span + phase) % span) + span) % span;
      p.set(carX + dirX * (AHEAD - u), seed[i * 4 + 2], carZ + seed[i * 4 + 1]);
      s.set((3 + kmh * 0.05) * seed[i * 4 + 3], 1, 1);
      m4.compose(p, q, s);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function dispose(): void {
    mesh.removeFromParent();
    geo.dispose();
    mat.dispose();
    mesh.dispose();
  }
  return { update, dispose, mesh };
}
