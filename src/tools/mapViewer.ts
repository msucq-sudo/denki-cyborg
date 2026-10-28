// 1階マップビューア（map.html）：俯瞰/オービット＋フリーカメラ（WASD+右ドラッグ）。当たり判定・マーカーの表示切替付き
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { generateFloor1 } from '../level/floor1/plan';
import { buildFloor1Visuals } from '../level/floor1/visuals';

const host = document.getElementById('view')!;
const ui = document.getElementById('ui')!;
const info = document.getElementById('info')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
host.appendChild(renderer.domElement);
const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 5.9);
renderer.clippingPlanes = [clip];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb7c7d8);
scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb0c4, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(30, 80, 20);
scene.add(sun);

const plan = generateFloor1();
const vis = buildFloor1Visuals(plan);
scene.add(vis.root);

// ---- 当たり判定の枠線
const colorOf = (tag?: string): number =>
  tag === 'wall' || tag === 'partition' ? 0xff4040 : tag === 'floor' ? 0x40a0ff : tag === 'ceiling' ? 0xa0a0a0
    : tag === 'deck' || tag === 'platform' || tag === 'pillar' ? 0xffd000 : 0x30d070;
const colliderLines = new THREE.Group();
{
  const byColor = new Map<number, number[]>();
  for (const c of vis.colliders) {
    if (c.tag === 'floor' || c.tag === 'ceiling') continue;
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(c.max.x - c.min.x, c.max.y - c.min.y, c.max.z - c.min.z));
    g.translate((c.min.x + c.max.x) / 2, (c.min.y + c.max.y) / 2, (c.min.z + c.max.z) / 2);
    const arr = g.getAttribute('position').array as Float32Array;
    const key = colorOf(c.tag);
    const list = byColor.get(key) ?? [];
    for (const v of arr) list.push(v);
    byColor.set(key, list);
  }
  for (const [col, arr] of byColor) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    colliderLines.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col })));
  }
}
colliderLines.visible = false;
scene.add(colliderLines);

// ---- マーカー（先端が下の円錐）
const markers = new THREE.Group();
const KIND_COLOR: Record<string, number> = {
  drone: 0x66ccff, crawler: 0xff8844, gunner: 0xffdd33, walker: 0x66ff88, heavy: 0xff3333, heavyWalker: 0xcc44ff, missile: 0xffffff,
};
const mark = (x: number, y: number, z: number, col: number, r = 0.9, h = 6): void => {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 10), new THREE.MeshBasicMaterial({ color: col }));
  m.rotation.x = Math.PI;
  m.position.set(x, y + h / 2 + 0.3, z);
  markers.add(m);
};
const S = plan.start;
mark(S.x, 0, S.z, 0x00ff00, 1.2, 8);
for (const g of plan.gears) mark(g.x, g.y - 1, g.z, 0xffcc00, 0.9, 6);
mark(plan.power.x, 0, plan.power.z, 0xff2020, 1.1, 8);
mark(0, 0, -77, 0x20a0ff, 1.4, 9);
for (const z of plan.zones) for (const s of z.spawns) mark(s.x, s.floor ?? 0, s.z, KIND_COLOR[s.kind] ?? 0xffffff, 0.6, 4);
scene.add(markers);

// ---- カメラ
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
let fly = false;
const fl = { yaw: 0, pitch: 0, keys: new Set<string>(), drag: false };
function setView(kind: 'top' | 'iso' | 'hall' | 'fly', pos?: number[], look?: number[]): void {
  fly = kind === 'fly';
  orbit.enabled = !fly;
  if (kind === 'top') { camera.position.set(10, 190, -33.9); orbit.target.set(10, 0, -34); }
  else if (kind === 'iso') { camera.position.set(-90, 110, 70); orbit.target.set(10, 0, -34); }
  else if (kind === 'hall') { camera.position.set(0, 14, -8); orbit.target.set(0, 5, -45); }
  if (pos) camera.position.set(pos[0], pos[1], pos[2]);
  if (look) orbit.target.set(look[0], look[1], look[2]);
  camera.lookAt(orbit.target);
  if (fly) {
    const d = new THREE.Vector3().copy(orbit.target).sub(camera.position).normalize();
    fl.yaw = Math.atan2(-d.x, -d.z); fl.pitch = Math.asin(d.y);
  }
  orbit.update();
}
function addBtn(label: string, fn: () => void, toggle?: () => boolean): void {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => { fn(); if (toggle) b.classList.toggle('on', toggle()); };
  if (toggle) b.classList.toggle('on', toggle());
  ui.appendChild(b);
}
addBtn('俯瞰', () => setView('top'));
addBtn('斜め', () => setView('iso'));
addBtn('大広間', () => setView('hall'));
addBtn('フリー(WASD+右ドラッグ, E/Q上下, Shift加速)', () => setView('fly', [camera.position.x, camera.position.y, camera.position.z], [orbit.target.x, orbit.target.y, orbit.target.z]));
addBtn('当たり判定', () => { colliderLines.visible = !colliderLines.visible; }, () => colliderLines.visible);
addBtn('マーカー', () => { markers.visible = !markers.visible; }, () => markers.visible);
addBtn('天井を隠す', () => { clip.constant = clip.constant < 100 ? 999 : 5.9; }, () => clip.constant < 100);
addBtn('屋根の高さ+', () => { clip.constant += 2; });
addBtn('屋根の高さ-', () => { clip.constant -= 2; });
const legend = document.createElement('div');
legend.style.cssText = 'color:#fff;font-size:12px;text-shadow:0 1px 2px #000;width:100%';
legend.textContent = 'マーカー: 緑=スタート 金=歯車 赤=バッテリースイッチ 青=エレベーター / 敵: 水=ドローン 橙=クローラー 黄=ガンナー 緑=ウォーカー 赤=ヘビー 紫=ヘビーウォーカー 白=ミサイル / 線: 赤=壁 黄=足場 緑=小物';
ui.appendChild(legend);

addEventListener('keydown', (e) => fl.keys.add(e.code));
addEventListener('keyup', (e) => fl.keys.delete(e.code));
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('mousedown', (e) => { if (e.button === 2) fl.drag = true; });
addEventListener('mouseup', () => { fl.drag = false; });
addEventListener('mousemove', (e) => {
  if (fly && fl.drag) { fl.yaw -= e.movementX * 0.003; fl.pitch = Math.max(-1.5, Math.min(1.5, fl.pitch - e.movementY * 0.003)); }
});
const resize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener('resize', resize);
resize();
setView('top');

const clock = new THREE.Clock();
function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  vis.gears.forEach((g) => g.model.tick(t + g.x));
  if (fly) {
    camera.rotation.set(fl.pitch, fl.yaw, 0, 'YXZ');
    const sp = (fl.keys.has('ShiftLeft') ? 40 : 14) * dt;
    const f = new THREE.Vector3(-Math.sin(fl.yaw) * Math.cos(fl.pitch), Math.sin(fl.pitch), -Math.cos(fl.yaw) * Math.cos(fl.pitch));
    const r = new THREE.Vector3(Math.cos(fl.yaw), 0, -Math.sin(fl.yaw));
    if (fl.keys.has('KeyW')) camera.position.addScaledVector(f, sp);
    if (fl.keys.has('KeyS')) camera.position.addScaledVector(f, -sp);
    if (fl.keys.has('KeyD')) camera.position.addScaledVector(r, sp);
    if (fl.keys.has('KeyA')) camera.position.addScaledVector(r, -sp);
    if (fl.keys.has('KeyE')) camera.position.y += sp;
    if (fl.keys.has('KeyQ')) camera.position.y -= sp;
  } else orbit.update();
  info.textContent = `カメラ (${camera.position.x.toFixed(0)}, ${camera.position.y.toFixed(0)}, ${camera.position.z.toFixed(0)})  コライダー ${vis.colliders.length}  プリミティブ ${plan.prims.length}`;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as Record<string, unknown>).__map = { setView, camera, orbit, clip, colliderLines, markers, ready: true };
