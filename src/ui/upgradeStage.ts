// 強化画面の右側に出す、自分の3Dモデルの展示台（ステージ）。
// ゲーム本編のシーンとは別のシーン＋カメラを、同じレンダラーで描く（コンテキストを増やさない）。
// モデルは本編と同じ buildPlayerVisual / poseCharacter で作るので、見た目も構えも本物と同じ。
// 作るのは最初に開いたとき1回だけ。閉じても持ち続けて使い回す（開閉のたびに GPU リソースを作り直さない）。
import * as THREE from 'three';
import { CHARACTER } from '../config/balance';
import type { World } from '../core/types';
import { buildPlayerVisual, type PlayerVisual } from '../player/visual';
import { createAnimState, poseCharacter, type AnimState } from '../player/pose';
import { DEFAULT_WEAPON, WEAPONS } from '../player/weapons';

export type StageMode = 'neutral' | 'aim';

export interface UpgradeStage {
  /** 立ち姿 / 銃を構える。weaponId は持たせる武器（'pistol' など）。同じ値なら何もしない */
  setPose(mode: StageMode, weaponId?: string): void;
  /** 強化できた時の演出。kind='gun' は銃を撃つ反動も出す */
  pulse(kind: 'gun' | 'other'): void;
  /** ドラッグで回す（ラジアン）。しばらく触らないと元の向きにゆっくり戻る */
  rotate(dyaw: number): void;
  update(dt: number): void;
  /** 全画面に描く。panelPx = 左のメニューが占める幅（モデルをその分だけ右へ寄せる） */
  render(renderer: THREE.WebGLRenderer, panelPx: number): void;
  dispose(): void;
}

const BASE_YAW = { neutral: Math.PI - 0.38, aim: Math.PI - 0.85 };
const LOOK_Y = 0.9;
/** 全身（約1.9m）が縦に収まる割合 */
const FIT = 0.7;
const FOV = 28;

function radialTexture(stops: [number, string][], size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createUpgradeStage(): UpgradeStage {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060b18);

  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 60);

  // ---- 背景：モデルの後ろにぼんやり青い光
  const glowTex = radialTexture([[0, 'rgba(64,130,220,0.85)'], [0.35, 'rgba(34,80,160,0.45)'], [1, 'rgba(6,11,24,0)']]);
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 14),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, toneMapped: false, depthWrite: false }),
  );
  back.position.set(0, 1.3, -3.2);
  scene.add(back);

  // ---- 展示台
  const deck = new THREE.Group();
  scene.add(deck);
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x1a2640, roughness: 0.55, metalness: 0.6 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.08, 0.12, 48), deckMat);
  base.position.y = -0.06;
  base.receiveShadow = true;
  const glowMat = new THREE.MeshBasicMaterial({ color: CHARACTER.colors.cyan, toneMapped: false });
  const ring1 = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.925, 64), glowMat);
  ring1.rotation.x = -Math.PI / 2; ring1.position.y = 0.003;
  const ringDim = new THREE.MeshBasicMaterial({ color: 0x2f6fc0, toneMapped: false, transparent: true, opacity: 0.8 });
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.635, 64), ringDim);
  ring2.rotation.x = -Math.PI / 2; ring2.position.y = 0.003;
  // 台の縁の目盛り
  const tickGeo = new THREE.BoxGeometry(0.02, 0.004, 0.09);
  const ticks = new THREE.InstancedMesh(tickGeo, ringDim, 48);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    pos.set(Math.sin(a) * 0.975, 0.004, Math.cos(a) * 0.975);
    ticks.setMatrixAt(i, m4.compose(pos, q, s1));
  }
  const floorGlowTex = radialTexture([[0, 'rgba(80,170,255,0.55)'], [0.6, 'rgba(40,90,180,0.18)'], [1, 'rgba(10,20,50,0)']]);
  const floorGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshBasicMaterial({ map: floorGlowTex, transparent: true, toneMapped: false, depthWrite: false }),
  );
  floorGlow.rotation.x = -Math.PI / 2; floorGlow.position.y = -0.125;
  // 強化の波紋（台の上を広がるリング）
  const waveMat = new THREE.MeshBasicMaterial({ color: 0xbff7ff, toneMapped: false, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const wave = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64), waveMat);
  wave.rotation.x = -Math.PI / 2; wave.position.y = 0.01;
  wave.visible = false;
  deck.add(base, ring1, ring2, ticks, floorGlow, wave);

  // ---- ライト：やわらかい正面＋左右の縁取り
  scene.add(new THREE.HemisphereLight(0xa9c6f2, 0x1a2338, 1.6));
  const key = new THREE.DirectionalLight(0xfff6ea, 2.6);
  key.position.set(-2.2, 3.6, 3.4);
  key.target.position.set(0, 1, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -1.6; key.shadow.camera.right = 1.6;
  key.shadow.camera.top = 2.4; key.shadow.camera.bottom = -0.6;
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 10;
  key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03;
  scene.add(key, key.target);
  const rimR = new THREE.DirectionalLight(0x4de8ff, 2.2);
  rimR.position.set(2.8, 2.4, -2.6);
  const rimL = new THREE.DirectionalLight(0x6a8cff, 1.6);
  rimL.position.set(-3, 1.8, -2.2);
  scene.add(rimR, rimL);

  // ---- モデル（本編と同じビルダー）
  const turn = new THREE.Group();
  scene.add(turn);
  const root = new THREE.Group();
  turn.add(root);
  const vis: PlayerVisual = buildPlayerVisual(root);
  vis.jets.visible = false;
  vis.chargeGroup.visible = false;

  // poseCharacter は World を読むので、必要な項目だけの見せかけのワールドを渡す
  const input = { aim: false };
  const fake = {
    time: 0,
    state: 'playing',
    player: {
      root, vel: new THREE.Vector3(), onGround: true, flying: false, dodgeTimer: 0, dodgeDir: new THREE.Vector3(),
      charging: false, overloading: false, pitch: 0, hp: 100, maxHp: 100, energy: 100, maxEnergy: 100,
    },
    input: { mouse: (b: number) => input.aim && b === 2, isDown: () => false },
    absorb: { phase: 'idle', tip: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1) },
    aimDir: new THREE.Vector3(0, 0, -1),
    stats: { shots: 0 },
    functions: { scouter: true },
    upgrades: {}, // pose.ts が移動速度の強化を読む（見せるだけなので全部レベル1）
  } as unknown as World;
  const anim: AnimState = createAnimState(fake);

  let mode: StageMode = 'neutral';
  let weaponId = DEFAULT_WEAPON.id;
  let yawBase = BASE_YAW.neutral;
  let userYaw = 0;
  let idle = 0;
  let t = 0;
  let waveT = 9;
  const up = new THREE.Vector3(0, 1, 0);

  // 最初に1回だけ描画する前に姿勢を落ち着かせる
  turn.rotation.y = yawBase;

  function setPose(m: StageMode, w: string = weaponId): void {
    mode = m;
    input.aim = m === 'aim';
    if (w !== weaponId) {
      weaponId = w;
      vis.setWeapon(WEAPONS[w] ?? DEFAULT_WEAPON);
    }
  }

  function pulse(kind: 'gun' | 'other'): void {
    waveT = 0;
    if (kind === 'gun') (fake.stats as { shots: number }).shots++;
  }

  function rotate(d: number): void {
    userYaw += d;
    idle = 0;
  }

  function update(dt: number): void {
    t += dt;
    idle += dt;
    (fake as unknown as { time: number }).time = t;
    // 向き：基本の向き＋ゆっくりした揺れ＋ドラッグ分（触らないと戻る）
    yawBase += (BASE_YAW[mode] - yawBase) * (1 - Math.exp(-5 * dt));
    if (idle > 3) userYaw *= Math.exp(-1.2 * dt);
    turn.rotation.y = yawBase + userYaw + Math.sin(t * 0.5) * 0.18;
    turn.updateMatrixWorld(true);
    fake.aimDir.set(0, 0.03, -1).applyAxisAngle(up, turn.rotation.y);
    poseCharacter(fake, vis, anim, dt);
    // 強化の波紋
    if (waveT < 1) {
      waveT = Math.min(1, waveT + dt / 0.9);
      wave.visible = true;
      wave.scale.setScalar(0.4 + waveT * 1.4);
      waveMat.opacity = (1 - waveT) * 0.9;
    } else wave.visible = false;
    ring1.scale.setScalar(1 + (waveT < 1 ? 0.012 : 0));
    glowMat.color.setHex(CHARACTER.colors.cyan).multiplyScalar(1 + (waveT < 1 ? (1 - waveT) * 1.2 : 0) + 0.12 * Math.sin(t * 2));
  }

  function render(renderer: THREE.WebGLRenderer, panelPx: number): void {
    const w = renderer.domElement.clientWidth || window.innerWidth;
    const h = renderer.domElement.clientHeight || window.innerHeight;
    const aspect = w / h;
    // モデルの中心を、メニューを除いた右側の真ん中へ
    const freeW = Math.max(w - panelPx, w * 0.35);
    const cx = (w - freeW / 2) / w; // 0..1
    const tanH = Math.tan((FOV * Math.PI) / 360);
    // 縦に収める距離と、横（メニューを除いた幅に約1.5m）に収める距離の大きいほう
    const distV = (1.9 / FIT / 2) / tanH;
    const distH = (1.5 / 2) / (tanH * aspect * (freeW / w));
    const dist = Math.max(distV, distH);
    camera.aspect = aspect;
    camera.position.set(0, LOOK_Y + 0.28, dist);
    camera.lookAt(0, LOOK_Y, 0);
    camera.setViewOffset(w, h, (0.5 - cx) * w, 0, w, h);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  function dispose(): void {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        const mm = x as THREE.Material & { map?: THREE.Texture | null; gradientMap?: THREE.Texture | null };
        mm.map?.dispose(); mm.gradientMap?.dispose();
        x.dispose();
      }
    });
    scene.background = null;
  }

  setPose('neutral');
  update(0.016);
  return { setPose, pulse, rotate, update, render, dispose };
}
