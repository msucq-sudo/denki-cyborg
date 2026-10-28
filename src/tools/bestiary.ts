/// <reference types="vite/client" />
// 敵図鑑（bestiary.html）：全敵の見た目とパラメーターを確認するビューア
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ENEMIES, GUN, ABSORB, PLAYER, type EnemyKind } from '../config/balance';
import { ENEMY_ORDER, ENEMY_INFO } from '../config/enemyInfo';
import { buildModel, type Model } from '../enemies/models';
import '../enemies/kinds';
import { HEAVY, CRAWLER } from '../enemies/ai';
import { WALKER } from '../enemies/kinds/walker';
import { HEAVY_WALKER } from '../enemies/kinds/heavyWalker';
import { MISSILE_BOT } from '../enemies/kinds/missileBot';

const TUNING: Partial<Record<EnemyKind, Record<string, unknown>>> = {
  heavy: HEAVY, crawler: CRAWLER, walker: WALKER, heavyWalker: HEAVY_WALKER, missile: MISSILE_BOT,
};
const FLYERS: EnemyKind[] = ['drone', 'boss'];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- three 基本セットアップ
const host = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1330);
scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x1a2547, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(5, 9, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 40 });
scene.add(sun);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 2.5;

// 円形の床（半径1を拡縮して使う）
const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: 0x16254f, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64), new THREE.MeshBasicMaterial({ color: 0x2ee6ff, side: THREE.DoubleSide }));
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01;
scene.add(ring);
// 1.8m の目安カプセル
const capsule = new THREE.Mesh(
  new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.height - PLAYER.radius * 2, 4, 12),
  new THREE.MeshBasicMaterial({ color: 0x2ee6ff, transparent: true, opacity: 0.18, depthWrite: false }),
);
scene.add(capsule);

// ---- 状態
interface Slot { kind: EnemyKind; model: Model | null; group: THREE.Group; hit: THREE.Mesh; weakBase: number[]; x: number; y: number }
let slots: Slot[] = [];
let current: EnemyKind = ENEMY_ORDER[0];
let lineupOn = false;
const opt = { weak: false, hit: false, tele: false };
const stage = new THREE.Group();
scene.add(stage);

function makeSlot(kind: EnemyKind, x: number): Slot {
  const r = ENEMIES[kind].radius;
  const group = new THREE.Group();
  const hit = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffd83a, wireframe: true, transparent: true, opacity: 0.6 }));
  hit.visible = false;
  let model: Model | null = null;
  const y = r + (FLYERS.includes(kind) ? 1 : 0);
  try {
    model = buildModel(kind);
    // ボスのコアなど出現時に隠れる弱点も見せる
    model.weakPoints.forEach((w) => { w.exposed = true; w.mesh.visible = true; });
    model.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    // 攻撃予告系は既定で非表示
    for (const k of ['teleCircle', 'teleStrip', 'field']) if (model.parts[k]) model.parts[k].visible = false;
    group.add(model.root);
  } catch (e) {
    console.warn('model build failed', kind, e);
  }
  group.add(hit);
  group.position.set(x, y, 0);
  return { kind, model, group, hit, x, y, weakBase: model ? model.weakMats.map((m) => m.emissiveIntensity) : [] };
}

function rebuild() {
  for (const s of slots) { stage.remove(s.group); s.hit.geometry.dispose(); }
  slots = [];
  const list = lineupOn ? ENEMY_ORDER : [current];
  let x = 0;
  const xs: number[] = [];
  list.forEach((k, i) => {
    if (i > 0) x += ENEMIES[list[i - 1]].radius + ENEMIES[k].radius + 1.3;
    xs.push(x);
  });
  const off = lineupOn ? xs[xs.length - 1] / 2 : 0;
  list.forEach((k, i) => { const s = makeSlot(k, xs[i] - off); slots.push(s); stage.add(s.group); });
  $('msg').hidden = lineupOn || !slots.some((s) => !s.model);
  capsule.visible = !lineupOn;
  capsule.position.set(ENEMIES[current].radius + 1.4, PLAYER.height / 2, 0);
  const span = lineupOn ? xs[xs.length - 1] / 2 + 4.5 : Math.max(3.5, ENEMIES[current].radius * 2 + 2.5);
  floor.scale.set(span, span, 1);
  ring.scale.copy(floor.scale);
  fitCamera();
  applyOptions();
  buildLabels();
}

function fitCamera() {
  if (lineupOn) {
    const w = Math.abs(slots[slots.length - 1].x) * 2 + 12;
    camera.position.set(0, w * 0.3 + 2, w * 0.95);
    controls.target.set(0, 1.2, 0);
    controls.autoRotate = false;
  } else {
    const r = ENEMIES[current].radius;
    const d = Math.max(5, r * 5.5 + 4);
    camera.position.set(d * 0.7, r + d * 0.3, d * 0.75);
    controls.target.set(0, r + (FLYERS.includes(current) ? 1 : 0), 0);
    controls.autoRotate = $<HTMLInputElement>('t-rot').checked;
  }
  controls.update();
}

function applyOptions() {
  for (const s of slots) {
    s.hit.visible = opt.hit;
    if (!s.model) continue;
    for (const bm of s.model.bodyMats) {
      bm.mat.emissive.set(opt.tele ? 0xff2a10 : 0x000000);
      bm.mat.emissiveIntensity = opt.tele ? 0.9 : 0;
    }
    const c = s.model.parts.teleCircle as THREE.Mesh | undefined;
    if (c) {
      c.visible = opt.tele;
      if (opt.tele) { c.scale.set(2.5, 2.5, 1); c.position.y = -s.y + 0.03; }
    }
    if (!opt.weak) s.model.weakMats.forEach((m, i) => { m.emissiveIntensity = s.weakBase[i]; });
  }
}

// ---- ラベル（全員並べるモード）
function buildLabels() {
  const el = $('labels');
  el.innerHTML = '';
  if (!lineupOn) return;
  for (const s of slots) {
    const d = document.createElement('div');
    d.textContent = ENEMY_INFO[s.kind].name;
    el.appendChild(d);
  }
}
const _v = new THREE.Vector3();
function updateLabels() {
  if (!lineupOn) return;
  const w = host.clientWidth, h = host.clientHeight;
  const els = $('labels').children;
  slots.forEach((s, i) => {
    _v.set(s.group.position.x, 0, 0).project(camera);
    const e = els[i] as HTMLElement;
    if (!e) return;
    e.style.left = `${(_v.x * 0.5 + 0.5) * w}px`;
    e.style.top = `${(-_v.y * 0.5 + 0.5) * h + 6}px`;
  });
}

// ---- パラメーターカード
const fmt = (n: number) => String(+n.toFixed(2));
const row = (l: string, v: string, unit = '') => `<tr><td>${l}</td><td>${v}${unit ? ` <small>${unit}</small>` : ''}</td></tr>`;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

function renderCard(kind: EnemyKind) {
  const e = ENEMIES[kind], info = ENEMY_INFO[kind];
  const tapN = Math.ceil(e.hp / GUN.tapDamage);
  const tapWeakN = Math.ceil(e.hp / (GUN.tapDamage * e.weakMultiplier));
  const chargeN = Math.ceil(e.hp / GUN.chargeMaxDamage);
  const chargeWeakN = Math.ceil(e.hp / (GUN.chargeMaxDamage * e.weakMultiplier));
  const drainSec = e.hp / ABSORB.drainPerSec;
  const gain = e.hp * ABSORB.conversion + ABSORB.finishBonus;
  let html = `<h2>${esc(info.name)}</h2><div class="role">${esc(info.role)}</div>`;
  html += '<h3>基本パラメーター</h3><table>';
  html += row('HP', fmt(e.hp)) + row('移動速度', fmt(e.speed), 'm/s') + row('半径', fmt(e.radius), 'm');
  html += row('攻撃力', fmt(e.damage)) + row('攻撃間隔', fmt(e.attackInterval), '秒');
  html += row('弾速', e.projectileSpeed ? fmt(e.projectileSpeed) : '―', e.projectileSpeed ? 'm/s' : '');
  html += row('弱点倍率', `×${fmt(e.weakMultiplier)}`) + row('過負荷上限', fmt(e.overloadCap)) + row('索敵距離', fmt(e.sightRange), 'm');
  html += '</table><h3>倒し方の目安</h3><table>';
  html += row('ピストル単発（通常）', `${tapN}発`, `／電力 ${tapN * GUN.tapCost}`);
  html += row('ピストル単発（弱点）', `${tapWeakN}発`, `／電力 ${tapWeakN * GUN.tapCost}`);
  html += row('最大溜め撃ち（通常）', `${chargeN}発`, `／電力 ${chargeN * GUN.chargeCostTotal}`);
  html += row('最大溜め撃ち（弱点）', `${chargeWeakN}発`, `／電力 ${chargeWeakN * GUN.chargeCostTotal}`);
  html += row('吸い切り時間', fmt(drainSec), '秒');
  html += row('吸い切りで得る電力', fmt(gain));
  html += row('逆流で爆発に必要な電力', fmt(e.overloadCap));
  html += '</table><h3>行動</h3><ul>' + info.behavior.map((b) => `<li>${esc(b)}</li>`).join('') + '</ul>';
  html += `<h3>弱点</h3>${esc(info.weakness)}<h3>初登場エリア</h3>${esc(info.area)}<h3>見た目メモ</h3>${esc(info.look)}`;
  const t = TUNING[kind];
  if (t) {
    html += '<details><summary>詳細パラメーター</summary><table>';
    for (const [k, v] of Object.entries(t)) html += `<tr><td class="k">${esc(k)}</td><td>${esc(typeof v === 'number' ? fmt(v) : JSON.stringify(v))}</td></tr>`;
    html += '</table></details>';
  }
  $('card').innerHTML = html;
}

// ---- リスト・操作
function renderList() {
  $('list').innerHTML = ENEMY_ORDER.map((k) => {
    const i = ENEMY_INFO[k];
    return `<button data-k="${k}"><b>${esc(i.name)}</b><span>${esc(i.role)} ／ ${esc(i.area)}</span></button>`;
  }).join('');
  $('list').onclick = (ev) => {
    const b = (ev.target as HTMLElement).closest('button');
    if (b) select(b.dataset.k as EnemyKind);
  };
}
function select(kind: EnemyKind) {
  current = kind;
  lineupOn = false;
  $('b-lineup').classList.remove('on');
  $('list').querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.k === kind));
  renderCard(kind);
  rebuild();
}
function lineup(on: boolean) {
  lineupOn = on;
  $('b-lineup').classList.toggle('on', on);
  rebuild();
}
addEventListener('keydown', (e) => {
  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!d) return;
  const i = ENEMY_ORDER.indexOf(current);
  select(ENEMY_ORDER[(i + d + ENEMY_ORDER.length) % ENEMY_ORDER.length]);
});
const bind = (id: string, f: (v: boolean) => void) => $<HTMLInputElement>(id).addEventListener('change', (e) => f((e.target as HTMLInputElement).checked));
bind('t-weak', (v) => { opt.weak = v; applyOptions(); });
bind('t-hit', (v) => { opt.hit = v; applyOptions(); });
bind('t-tele', (v) => { opt.tele = v; applyOptions(); });
bind('t-rot', (v) => { controls.autoRotate = v && !lineupOn; });
$('b-lineup').onclick = () => lineup(!lineupOn);

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const t = clock.getElapsedTime();
  if (opt.weak) {
    const p = 0.5 + 0.5 * Math.sin(t * 6);
    for (const s of slots) s.model?.weakMats.forEach((m) => { m.emissiveIntensity = 0.3 + p * 2.2; });
  }
  controls.update();
  renderer.render(scene, camera);
  updateLabels();
}

renderList();
resize();
select(current);
loop();

(window as unknown as { __bestiary: unknown }).__bestiary = { select, lineup };
