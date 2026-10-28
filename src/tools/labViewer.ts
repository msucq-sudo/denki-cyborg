/// <reference types="vite/client" />
// スパーク研究室の確認ビューア（lab.html）：カメラアンカー切替・仮キャラ・歩き回り
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildSparkLab } from '../scenes/sparkLab';

const host = document.getElementById('view')!;
const ui = document.getElementById('ui')!;
const info = document.getElementById('info')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2230);
const lab = buildSparkLab();
scene.add(lab.root);
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 60);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;

const resize = () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);
resize();

// ---- 歩き回り状態 ----
const walk = { on: false, yaw: 0, pitch: 0, keys: new Set<string>() };

// ---- カメラアンカー ----
const camNames: [string, string][] = [
  ['camWide', '全景'],
  ['camBed', 'ベッド'],
  ['camOverShoulderSpark', 'スパーク越し'],
  ['camOverShoulderHero', '主人公越し'],
];
const tmp = new THREE.Vector3();
function cam(name: string) {
  const a = lab.anchors[name];
  if (!a) return;
  a.updateWorldMatrix(true, false);
  a.getWorldPosition(camera.position);
  a.getWorldQuaternion(camera.quaternion);
  camera.fov = a.userData.fov ?? 50;
  camera.updateProjectionMatrix();
  const t: THREE.Vector3 | undefined = a.userData.target;
  orbit.target.copy(t ?? camera.position.clone().add(tmp.set(0, 0, -3).applyQuaternion(camera.quaternion)));
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  walk.yaw = e.y;
  walk.pitch = e.x;
  orbit.update();
}
const addBtn = (label: string, fn: (b: HTMLButtonElement) => void) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => fn(b);
  ui.appendChild(b);
  return b;
};
for (const [n, l] of camNames) addBtn(l, () => cam(n));
addBtn('ドア側', () => {
  camera.position.set(-6.2, 1.6, 0);
  camera.fov = 55;
  camera.updateProjectionMatrix();
  orbit.target.set(0, 1.0, 0);
  orbit.update();
});

// ---- 仮キャラ（カプセル） ----
const caps = new THREE.Group();
caps.visible = false;
scene.add(caps);
const capsule = (h: number, col: number, anchor: string) => {
  const r = 0.24;
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, h - r * 2, 6, 14), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 }));
  const a = lab.anchors[anchor];
  m.position.copy(a.position).add(new THREE.Vector3(0, h / 2, 0));
  m.quaternion.copy(a.quaternion);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.2), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  nose.position.set(0, h / 2 - 0.3, r);
  m.add(nose);
  m.castShadow = true;
  caps.add(m);
};
capsule(1.8, 0x3a6df0, 'heroStand');
capsule(1.72, 0xffd83a, 'sparkStand');
addBtn('仮キャラ表示', (b) => {
  caps.visible = !caps.visible;
  b.classList.toggle('on', caps.visible);
});

// ---- Spark モデル（src/characters/spark.ts があれば配置） ----
let sparkUpdate: ((dt: number) => void) | null = null;
(async () => {
  try {
    const mods = import.meta.glob('../characters/spark.ts');
    const loader = Object.values(mods)[0];
    if (!loader) return;
    const mod: any = await loader();
    const made = mod.createSpark();
    const obj: THREE.Object3D = made?.root ?? made;
    const a = lab.anchors.sparkStand;
    obj.position.copy(a.position);
    obj.quaternion.copy(a.quaternion);
    scene.add(obj);
    if (typeof made?.update === 'function') sparkUpdate = (dt) => made.update(dt);
  } catch (e) {
    console.warn('Spark 読み込みスキップ', e);
  }
})();

// ---- 歩き回り（WASD + マウス） ----
addBtn('歩き回り', (b) => {
  walk.on = !walk.on;
  b.classList.toggle('on', walk.on);
  orbit.enabled = !walk.on;
  if (walk.on) {
    camera.position.y = 1.6;
    camera.fov = 70;
    camera.updateProjectionMatrix();
    renderer.domElement.requestPointerLock?.();
  } else document.exitPointerLock?.();
});
addEventListener('keydown', (e) => walk.keys.add(e.code));
addEventListener('keyup', (e) => walk.keys.delete(e.code));
addEventListener('mousemove', (e) => {
  if (!walk.on || document.pointerLockElement !== renderer.domElement) return;
  walk.yaw -= e.movementX * 0.0025;
  walk.pitch = Math.max(-1.3, Math.min(1.3, walk.pitch - e.movementY * 0.0025));
});
renderer.domElement.addEventListener('click', () => {
  if (walk.on) renderer.domElement.requestPointerLock?.();
});

// ---- ループ ----
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  lab.update(dt);
  sparkUpdate?.(dt);
  if (walk.on) {
    camera.quaternion.setFromEuler(new THREE.Euler(walk.pitch, walk.yaw, 0, 'YXZ'));
    const f = (walk.keys.has('KeyW') ? 1 : 0) - (walk.keys.has('KeyS') ? 1 : 0);
    const s = (walk.keys.has('KeyD') ? 1 : 0) - (walk.keys.has('KeyA') ? 1 : 0);
    const sp = (walk.keys.has('ShiftLeft') ? 4 : 2) * dt;
    camera.position.x += (-Math.sin(walk.yaw) * f + Math.cos(walk.yaw) * s) * sp;
    camera.position.z += (-Math.cos(walk.yaw) * f - Math.sin(walk.yaw) * s) * sp;
    camera.position.x = Math.max(-6.7, Math.min(6.7, camera.position.x));
    camera.position.z = Math.max(-4.7, Math.min(4.7, camera.position.z));
    camera.position.y = 1.6;
  } else orbit.update();
  renderer.render(scene, camera);
  const r = renderer.info.render;
  info.textContent = `描画 ${r.calls} / 三角形 ${(r.triangles / 1000).toFixed(0)}k\n視点ボタン：全景・ベッド・肩越し / 歩き回り：WASD+マウス（Shiftで速く）`;
  requestAnimationFrame(frame);
}
cam('camWide');
requestAnimationFrame(frame);

(window as any).__lab = {
  cam,
  lab,
  THREE,
  camera,
  renderer,
  capsules(v: boolean) {
    caps.visible = v;
  },
  stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  step(dt: number, n = 1) {
    for (let i = 0; i < n; i++) lab.update(dt);
  },
  ready: true,
};
