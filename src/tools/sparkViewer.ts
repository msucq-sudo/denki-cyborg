// スパーク確認用ビューア：ターンテーブル、ポーズ/カメラ/メガネ切替、身長1.8mの基準カプセル
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createSpark, type SparkPose } from '../characters/spark';

type View = 'front' | 'side' | 'back' | 'face' | 'portrait';
const q = new URLSearchParams(location.search);
const clean = q.has('clean');
if (clean) document.body.classList.add('clean');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BG = { light: 0xcfd6e2, navy: 0x1a2238 };
let bgNavy = q.get('bg') === 'navy';
const applyBg = (): void => { scene.background = new THREE.Color(bgNavy ? BG.navy : BG.light); };
applyBg();

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = !clean && !q.has('still');
controls.autoRotateSpeed = 1.5;

// 柔らかい研究室ライティング
scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9ea8, 1.3));
const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(2.5, 4, 3); scene.add(key);
const rim = new THREE.DirectionalLight(0x9ec8ff, 0.9); rim.position.set(-3, 2.5, -3); scene.add(rim);
const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.MeshToonMaterial({ color: 0x9aa4b8 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002; scene.add(floor);

const spark = createSpark({ glasses: !q.has('noglasses') });
scene.add(spark.root);

// 身長1.8m（主人公）の基準カプセル
const refCap = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.3, 6, 16), new THREE.MeshBasicMaterial({ color: 0x4de8ff, transparent: true, opacity: 0.18, depthWrite: false }));
refCap.position.set(0.85, 0.9, 0);
refCap.visible = false;
scene.add(refCap);

const VIEWS: Record<View, { pos: [number, number, number]; target: [number, number, number]; fov: number }> = {
  front: { pos: [0, 1.0, 4.2], target: [0, 0.88, 0], fov: 35 },
  side: { pos: [4.2, 1.0, 0], target: [0, 0.88, 0], fov: 35 },
  back: { pos: [0, 1.0, -4.2], target: [0, 0.88, 0], fov: 35 },
  face: { pos: [0, 1.62, 1.05], target: [0, 1.6, 0], fov: 30 },
  portrait: { pos: [0.05, 1.6, 0.95], target: [0, 1.57, 0], fov: 34 }, // コムのポートレート用
};
const view = (v: View): void => {
  const d = VIEWS[v];
  camera.position.set(...d.pos); controls.target.set(...d.target);
  camera.fov = d.fov; camera.updateProjectionMatrix();
  controls.autoRotate = false; spinBtn.classList.remove('on');
  controls.update();
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const spinBtn = $('btnSpin'), glassBtn = $('btnGlasses'), bgBtn = $('btnBg'), refBtn = $('btnRef');
const setPoseBtn = (p: SparkPose): void => document.querySelectorAll<HTMLButtonElement>('[data-pose]').forEach((b) => b.classList.toggle('on', b.dataset.pose === p));
const pose = (p: SparkPose): void => { spark.setPose(p); setPoseBtn(p); };
const glasses = (on: boolean): void => { spark.setGlasses(on); glassBtn.classList.toggle('on', on); };

document.querySelectorAll<HTMLButtonElement>('[data-pose]').forEach((b) => b.addEventListener('click', () => pose(b.dataset.pose as SparkPose)));
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.addEventListener('click', () => view(b.dataset.view as View)));
let glassOn = !q.has('noglasses');
glassBtn.addEventListener('click', () => { glassOn = !glassOn; glasses(glassOn); });
bgBtn.addEventListener('click', () => { bgNavy = !bgNavy; applyBg(); bgBtn.textContent = bgNavy ? '背景: 紺' : '背景: 明'; });
spinBtn.addEventListener('click', () => { controls.autoRotate = !controls.autoRotate; spinBtn.classList.toggle('on', controls.autoRotate); });
refBtn.addEventListener('click', () => { refCap.visible = !refCap.visible; refBtn.classList.toggle('on', refCap.visible); });
bgBtn.textContent = bgNavy ? '背景: 紺' : '背景: 明';
spinBtn.classList.toggle('on', controls.autoRotate);
glasses(glassOn);
pose((q.get('pose') as SparkPose) || 'idle');
view((q.get('view') as View) || 'front');
controls.autoRotate = !clean && !q.has('still');
spinBtn.classList.toggle('on', controls.autoRotate);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  spark.update(Math.min(clock.getDelta(), 0.05));
  controls.update();
  renderer.render(scene, camera);
});

(window as unknown as { __spark: unknown }).__spark = { pose, view, glasses };
