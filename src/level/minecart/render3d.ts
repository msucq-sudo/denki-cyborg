/**
 * トロッコ面の3D表示。遊びは x/y の横スクロール（sim.ts）のまま、見た目だけを three.js で描く（z=0 が遊びの面）。
 * 再利用: プレイヤーの3Dモデル・ポーズ（player/visual, pose）、敵の3Dモデル（enemies/models の drone / gunner）、
 *        歯車モデル（level/gear）、1階/ドレインのテクスチャと看板（level/floor1/visuals）。
 * カメラは横から少し斜めに見下ろし、カートを滑らかに追う。
 */
import * as THREE from 'three';
import { createWorld } from '../../core/world';
import { EventBus } from '../../core/events';
import type { Input } from '../../core/input';
import type { World } from '../../core/types';
import { getPlayerVisual } from '../../player/player';
import { createAnimState, poseCharacter, type AnimState } from '../../player/pose';
import type { PlayerVisual } from '../../player/visual';
import { bevelBox, boxGeo, buildModel, cylGeo, disposeObject, type Model } from '../../enemies/models';
import '../../enemies/kinds';
import { createGearModel, type GearModel } from '../gear';
import { makeMesh as makeMetalMesh } from '../../core/pickups';
import { floorTex, hazardTex, makeSign, panelTex } from '../floor1/visuals';
import { MC } from './constants';
import type { CeilKind, ResolvedCeil, ResolvedWall, Stage } from './stage';
import type { McFx, McState } from './sim';

const CEIL_MARGIN = 6.5;
/** カメラとプレイ面（z=0）の距離。画面の横幅 ≒ 1.33 * CAM_DIST */
const CAM_DIST = 13;
/** 手前/奥の線路の間隔（片側） */
const RAIL_Z = 0.45;
/** プレイヤーのモデルを、当たり判定（立ち 1.8）に合わせて縮める */
const PLAYER_SCALE = 0.8;
/** カート床の高さ（レール面から） */
const CART_FLOOR = 0.4;

const tiled = (t: THREE.Texture | undefined, rx: number, ry: number): THREE.Texture | undefined => {
  if (!t) return undefined;
  const c = t.clone();
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
};

const std = (color: number, rough = 0.6, metal = 0.35, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
const glowMat = (color: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color });

interface EnemyObj { root: THREE.Group; model: Model; kind: 'drone' | 'gunner'; base: number }
interface Particle { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number; max: number; g: number }

export class McView {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private world: World;
  private vis: PlayerVisual;
  private anim: AnimState;
  private stage: Stage;
  private env = new THREE.Group();
  private cartGroup = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private gears: { m: GearModel; ring: THREE.Mesh; i: number }[] = [];
  private metals: { m: THREE.Object3D; i: number }[] = [];
  private flags: { cloth: THREE.Mesh; x: number; mat: THREE.MeshStandardMaterial }[] = [];
  private swayers: THREE.Object3D[] = [];
  private enemyObjs = new Map<number, EnemyObj>();
  private bulletPool: THREE.Mesh[] = [];
  private shotPool: THREE.Mesh[] = [];
  private particles: Particle[] = [];
  private partPool: THREE.Mesh[] = [];
  private cyanLight: THREE.PointLight;
  private orangeLight: THREE.PointLight;
  private sun: THREE.DirectionalLight;
  private keyLight: THREE.PointLight;
  private camX = 0;
  private camY = 0;
  private crouchK = 0;
  private cartTilt = 0;
  private lastShots = 0;
  private shotsFired = 0;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private ceilY: number;
  private floorY: number;

  constructor(input: Input, stage: Stage) {
    this.stage = stage;
    this.world = createWorld(input, new EventBus(), 16 / 9);
    this.world.state = 'playing';
    this.world.level.data.poseAim = true; // 入力なしでも銃を構える
    this.scene = this.world.scene;
    this.camera = this.world.camera;
    this.camera.fov = 40;
    this.camera.near = 0.3;
    this.camera.far = 220;
    this.camera.updateProjectionMatrix();
    this.vis = getPlayerVisual(this.world);
    this.anim = createAnimState(this.world);
    // 本編の initPlayer と同じく、溜め撃ち・ジェットの演出パーツは隠しておく
    this.vis.chargeCore.visible = this.vis.chargeGlow.visible = false;
    this.vis.sparks.forEach((m) => (m.visible = false));
    this.vis.jets.children.forEach((c) => { if ((c as THREE.Mesh).isMesh) c.visible = false; });
    this.ceilY = stage.maxY + CEIL_MARGIN + 3;
    this.floorY = stage.minY - 9;

    this.scene.background = new THREE.Color(0x05080d);
    this.scene.fog = new THREE.Fog(0x05080d, 34, 78);
    this.scene.add(new THREE.AmbientLight(0x8fb0d0, 1.4));
    this.scene.add(new THREE.HemisphereLight(0x7fb4ff, 0x20140a, 0.55));
    this.sun = new THREE.DirectionalLight(0xcfe6ff, 1.6);
    this.sun.position.set(-4, 10, 12);
    this.scene.add(this.sun, this.sun.target);
    this.cyanLight = new THREE.PointLight(0x38e8ff, 38, 18, 1.6);
    this.orangeLight = new THREE.PointLight(0xff9a2e, 30, 16, 1.6);
    this.keyLight = new THREE.PointLight(0xffffff, 55, 16, 1.4);
    this.scene.add(this.cyanLight, this.orangeLight, this.keyLight);

    this.buildEnv();
    this.buildCart();
    this.world.player.root.scale.setScalar(PLAYER_SCALE);
    this.cartGroup.add(this.world.player.root);
    this.scene.add(this.cartGroup);
    this.world.player.root.position.set(0, CART_FLOOR, 0);
    this.world.player.root.rotation.y = -Math.PI / 2;
    this.reset(0);
  }

  // ---------------------------------------------------------------- 環境
  private buildEnv(): void {
    const { stage } = this;
    const L = stage.rails[0].x0, R = stage.rails[stage.rails.length - 1].x1;
    const cx = (L + R) / 2, len = R - L + 120;
    this.scene.add(this.env);
    const steel = std(0x4a5868, 0.5, 0.65, { map: tiled(panelTex(), 0.5, 0.5) });
    const steelDark = std(0x2b3440, 0.6, 0.5);
    const railMat = std(0x9fb0c2, 0.35, 0.85);
    const woodMat = std(0x5a4330, 0.9, 0.05);
    const hazard = std(0xffffff, 0.7, 0.2, { map: tiled(hazardTex(), 1, 1) });

    // ---- 奥の壁・床・天井
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, this.ceilY - this.floorY + 6), std(0x1a2532, 0.9, 0.2, { map: tiled(panelTex(), len / 6, (this.ceilY - this.floorY) / 6) }));
    wall.position.set(cx, (this.ceilY + this.floorY) / 2, -9);
    this.env.add(wall);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(len, 30), std(0x10161e, 0.95, 0.2));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(cx, this.ceilY, -2);
    this.env.add(ceil);
    const abyss = new THREE.Mesh(new THREE.PlaneGeometry(len, 30), new THREE.MeshBasicMaterial({ color: 0x1a0a06 }));
    abyss.rotation.x = -Math.PI / 2;
    abyss.position.set(cx, this.floorY, -2);
    this.env.add(abyss);
    const floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(len, 24), new THREE.MeshBasicMaterial({ color: 0xff5a20, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    floorGlow.rotation.x = -Math.PI / 2;
    floorGlow.position.set(cx, this.floorY + 0.4, -2);
    this.env.add(floorGlow);

    // ---- 奥の柱・配管・ランプ（InstancedMesh で軽く）
    const pillarGeo = boxGeo(0.9, 1, 0.9);
    const pillarN = Math.ceil(len / 14);
    const pillars = new THREE.InstancedMesh(pillarGeo, steelDark, pillarN);
    const lampsC = new THREE.InstancedMesh(boxGeo(2.6, 0.18, 0.4), glowMat(0x38e8ff), pillarN);
    const lampsO = new THREE.InstancedMesh(boxGeo(2.6, 0.18, 0.4), glowMat(0xff9a2e), pillarN);
    const m4 = new THREE.Matrix4();
    const H = this.ceilY - this.floorY;
    for (let i = 0; i < pillarN; i++) {
      const x = L - 60 + i * 14;
      m4.compose(new THREE.Vector3(x, (this.ceilY + this.floorY) / 2, -8.2), new THREE.Quaternion(), new THREE.Vector3(1, H, 1));
      pillars.setMatrixAt(i, m4);
      const lampY = stage.maxY + 6.2;
      m4.makeTranslation(x + 7, lampY, -7.8);
      (i % 2 ? lampsC : lampsO).setMatrixAt(Math.floor(i / 2), m4);
    }
    pillars.instanceMatrix.needsUpdate = true; lampsC.instanceMatrix.needsUpdate = true; lampsO.instanceMatrix.needsUpdate = true;
    lampsC.count = Math.ceil(pillarN / 2); lampsO.count = Math.floor(pillarN / 2) + 1;
    this.env.add(pillars, lampsC, lampsO);
    for (const [yy, rr] of [[stage.minY + 1.5, 0.35], [stage.maxY + 3.4, 0.5], [stage.maxY + 5.4, 0.28]] as const) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, len, 10), steel);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(cx, yy, -8.3);
      this.env.add(pipe);
      const band = new THREE.InstancedMesh(new THREE.CylinderGeometry(rr * 1.18, rr * 1.18, 0.35, 10), glowMat(0xff9a2e), Math.ceil(len / 20));
      for (let i = 0; i < band.count; i++) { m4.compose(new THREE.Vector3(L - 60 + i * 20, yy, -8.3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), new THREE.Vector3(1, 1, 1)); band.setMatrixAt(i, m4); }
      this.env.add(band);
    }

    // ---- レール・枕木・支柱・台
    const sleeperPos: THREE.Matrix4[] = [];
    const postPos: THREE.Matrix4[] = [];
    for (const r of stage.rails) {
      const dx = r.x1 - r.x0, dy = r.y1 - r.y0, segLen = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      for (const z of [-RAIL_Z, RAIL_Z]) {
        const rail = new THREE.Mesh(boxGeo(segLen, 0.13, 0.14), railMat);
        rail.position.set((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2 - 0.065, z);
        rail.rotation.z = ang;
        this.env.add(rail);
      }
      for (let x = Math.ceil(r.x0); x <= r.x1; x += 1) {
        const y = r.y0 + (dy * (x - r.x0)) / Math.max(0.001, dx);
        sleeperPos.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.2, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, ang)), new THREE.Vector3(1, 1, 1)));
      }
      // 上段レール（分岐の寄り道）：厚い板＋両端の支柱。下段の上を橋のようにまたぐ
      if (r.upper) {
        const th = r.thick ?? 0.4;
        const slab = new THREE.Mesh(boxGeo(segLen, th, 2.4), steel);
        slab.position.set((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2 - 0.13 - th / 2, 0);
        slab.rotation.z = ang;
        this.env.add(slab);
        const under = new THREE.Mesh(boxGeo(segLen, 0.06, 2.0), glowMat(0xffd24a));
        under.position.set((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2 - 0.13 - th - 0.03, 0);
        under.rotation.z = ang;
        this.env.add(under);
        for (const px of [r.x0 + 0.5, r.x1 - 0.5]) for (const dz of [-1.35, 1.35]) {
          const hgt = r.y0 - this.stage.minY + 3;
          const post = new THREE.Mesh(boxGeo(0.35, hgt, 0.35), steelDark);
          post.position.set(px, r.y0 - hgt / 2 - th, dz);
          this.env.add(post);
        }
        // 入口の注意帯（ここへ高く跳び乗る）
        const face = new THREE.Mesh(boxGeo(0.14, th + 0.1, 2.5), hazard);
        face.position.set(r.x0 - 0.04, r.y0 - th / 2 - 0.1, 0);
        this.env.add(face);
        continue;
      }
      // 高い台：床まで続く鉄骨の塊（段差の壁の面になる）
      const high = Math.max(r.y0, r.y1) > 0.3;
      if (high) {
        const sh = new THREE.Shape();
        sh.moveTo(r.x0, r.y0 - 0.3); sh.lineTo(r.x1, r.y1 - 0.3); sh.lineTo(r.x1, this.floorY); sh.lineTo(r.x0, this.floorY); sh.closePath();
        const g = new THREE.ExtrudeGeometry(sh, { depth: 2.2, bevelEnabled: false });
        g.translate(0, 0, -1.1);
        const m = new THREE.Mesh(g, std(0x3a4654, 0.55, 0.6, { map: tiled(panelTex(), 0.2, 0.2) }));
        this.env.add(m);
        // 壁の面に黄黒の注意帯
        if (r.face) {
          const f = new THREE.Mesh(boxGeo(0.12, Math.min(1.6, r.y0 + 4), 2.3), hazard);
          f.position.set(r.x0 - 0.02, r.y0 - Math.min(1.6, r.y0 + 4) / 2 + 0.05, 0);
          this.env.add(f);
          const lamp = new THREE.Mesh(boxGeo(0.14, 0.12, 2.0), glowMat(0xff9a2e));
          lamp.position.set(r.x0 - 0.06, r.y0 - 0.1, 0);
          this.env.add(lamp);
        }
        const edge = new THREE.Mesh(boxGeo(segLen, 0.08, 2.3), glowMat(0x136b7a));
        edge.position.set((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2 - 0.3, 0);
        edge.rotation.z = ang;
        this.env.add(edge);
      } else {
        for (let x = Math.ceil(r.x0 / 6) * 6; x <= r.x1; x += 6) {
          const y = r.y0 + (dy * (x - r.x0)) / Math.max(0.001, dx);
          const h = y - this.floorY;
          postPos.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.3 - h / 2, 0), new THREE.Quaternion(), new THREE.Vector3(1, h, 1)));
        }
      }
      // レール端のライト
    }
    const sleepers = new THREE.InstancedMesh(boxGeo(0.28, 0.13, 1.5), woodMat, sleeperPos.length);
    sleeperPos.forEach((m, i) => sleepers.setMatrixAt(i, m));
    const posts = new THREE.InstancedMesh(boxGeo(0.4, 1, 0.5), steelDark, postPos.length);
    postPos.forEach((m, i) => posts.setMatrixAt(i, m));
    this.env.add(sleepers, posts);

    // ---- 壁（木箱・隔壁・残骸）
    for (const w of stage.walls) this.env.add(this.makeWall(w, hazard, steel));
    // ---- 天井の研究機材
    for (const c of stage.ceils) this.env.add(this.makeCeil(c, steel, hazard));
    // ---- チェックポイント
    for (const cx of stage.checks) this.env.add(this.makeFlag(cx));
    // ---- 歯車
    // ---- メタル（ふつうの回収物。本編のメタルと同じナット型）
    stage.metals.forEach((mt, i) => {
      const m = makeMetalMesh(1);
      m.scale.multiplyScalar(2.6);
      m.rotation.x = Math.PI / 2;
      m.position.set(mt.x, mt.y, 0);
      this.env.add(m);
      this.metals.push({ m, i });
    });
    // ---- 歯車（レア。大きく光らせて目立たせる）
    stage.gears.forEach((g, i) => {
      const m = createGearModel();
      m.scale.setScalar(1.1);
      m.position.set(g.x, g.y, 0);
      this.env.add(m);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.05, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.position.set(g.x, g.y, 0);
      this.env.add(ring);
      this.gears.push({ m, ring, i });
    });
    // ---- ゴール
    this.env.add(this.makeGoal());
  }

  private makeWall(w: ResolvedWall, hazard: THREE.Material, steel: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const width = w.x1 - w.x0, d = 1.9;
    g.position.set(w.x, w.base, 0);
    if (w.kind === 'crate') {
      const body = new THREE.Mesh(bevelBox(width, w.h, d, 0.08), std(0x8a5a2a, 0.8, 0.2));
      body.position.y = w.h / 2;
      g.add(body);
      const stripe = new THREE.Mesh(boxGeo(width + 0.04, 0.3, d + 0.04), hazard);
      stripe.position.y = w.h - 0.15;
      g.add(stripe);
      const band = new THREE.Mesh(boxGeo(width + 0.06, 0.12, d + 0.06), glowMat(0xff9a2e));
      band.position.y = 0.1;
      g.add(band);
    } else if (w.kind === 'bulkhead') {
      const body = new THREE.Mesh(bevelBox(width, w.h, d + 0.4, 0.1), steel);
      body.position.y = w.h / 2;
      g.add(body);
      for (let k = 0; k < 3; k++) {
        const lamp = new THREE.Mesh(boxGeo(0.08, 0.14, 0.5), glowMat(k % 2 ? 0xff3a2a : 0xff9a2e));
        lamp.position.set(-width / 2 - 0.03, w.h * (0.25 + k * 0.25), 0);
        g.add(lamp);
      }
      const cap = new THREE.Mesh(boxGeo(width + 0.1, 0.22, d + 0.5), hazard);
      cap.position.y = w.h - 0.11;
      g.add(cap);
    } else {
      // 壊れた機械：傾いた箱＋折れた配管＋火花の光
      const a = new THREE.Mesh(bevelBox(width * 1.05, w.h * 0.8, d, 0.1), std(0x586272, 0.6, 0.5));
      a.position.y = w.h * 0.4; a.rotation.z = 0.08;
      g.add(a);
      const b = new THREE.Mesh(bevelBox(width * 0.7, w.h * 0.45, d * 0.8, 0.06), std(0x2f3844, 0.6, 0.5));
      b.position.set(0.05, w.h * 0.8, 0); b.rotation.z = -0.25;
      g.add(b);
      const pipe = new THREE.Mesh(cylGeo(0.12, 1.2), std(0x9a7a3a, 0.5, 0.6));
      pipe.position.set(-0.3, w.h * 0.95, 0.3); pipe.rotation.z = 0.7;
      g.add(pipe);
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), glowMat(0x9ff4ff));
      spark.position.set(0.25, w.h * 1.0, 0.9);
      g.add(spark);
      this.swayers.push(spark);
    }
    return g;
  }

  private makeCeil(c: ResolvedCeil, steel: THREE.Material, hazard: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const w = c.x1 - c.x0, cx = (c.x0 + c.x1) / 2;
    g.position.set(cx, 0, 0);
    const bodyH = 1.4;
    const top = c.bottom + bodyH;
    // 吊り棒
    for (let px = -w / 2 + 1; px < w / 2; px += 2.6) {
      const rod = new THREE.Mesh(cylGeo(0.06, this.ceilY - top), std(0x3b4a5c, 0.5, 0.7));
      rod.position.set(px, (this.ceilY + top) / 2, -0.4);
      g.add(rod);
    }
    const frame = new THREE.Mesh(boxGeo(w, 0.18, 2.0), steel);
    frame.position.set(0, top + 0.09, 0);
    g.add(frame);
    const kind: CeilKind = c.kind;
    if (kind === 'monitor') {
      const n = Math.max(1, Math.floor(w / 3.2));
      for (let i = 0; i < n; i++) {
        const mx = -w / 2 + (i + 0.5) * (w / n);
        const body = new THREE.Mesh(bevelBox(2.5, bodyH, 0.7, 0.07), std(0x2b3745, 0.5, 0.5));
        body.position.set(mx, c.bottom + bodyH / 2, 0);
        g.add(body);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.2, bodyH * 0.72), glowMat(i % 2 ? 0x38e8ff : 0x1fb0c8));
        screen.position.set(mx, c.bottom + bodyH / 2, 0.37);
        g.add(screen);
        this.swayers.push(screen);
      }
    } else if (kind === 'pipe') {
      for (let k = 0; k < 2; k++) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, w, 12), std(k ? 0x6a7684 : 0x8a97a6, 0.4, 0.8));
        p.rotation.z = Math.PI / 2;
        p.position.set(0, c.bottom + 0.3 + k * 0.62, k ? -0.35 : 0.3);
        g.add(p);
      }
      for (let px = -w / 2 + 1; px < w / 2; px += 3) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12), glowMat(0xff9a2e));
        ring.rotation.z = Math.PI / 2;
        ring.position.set(px, c.bottom + 0.3, 0.3);
        g.add(ring);
      }
    } else if (kind === 'tank') {
      const n = Math.max(1, Math.floor(w / 3));
      for (let i = 0; i < n; i++) {
        const mx = -w / 2 + (i + 0.5) * (w / n);
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, bodyH, 16), std(0x35506a, 0.35, 0.7));
        tank.position.set(mx, c.bottom + bodyH / 2, 0);
        g.add(tank);
        const core = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, bodyH * 0.8, 12), glowMat(0x38e8ff));
        core.position.set(mx, c.bottom + bodyH / 2, 0.18);
        core.scale.z = 0.5;
        g.add(core);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 16), glowMat(0xff9a2e));
        cap.position.set(mx, c.bottom + 0.06, 0);
        g.add(cap);
      }
    } else if (kind === 'cable') {
      for (let k = 0; k < Math.floor(w * 1.6); k++) {
        const len = 1.1 + (k % 3) * 0.35;
        const cable = new THREE.Group();
        cable.position.set(-w / 2 + (k + 0.5) * (w / Math.floor(w * 1.6)), top + 0.1, ((k * 7) % 5) * 0.3 - 0.6);
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, top - c.bottom + (len - bodyH) + 0.1, 6), std(0x10151c, 0.8, 0.2));
        cyl.position.y = -(top - c.bottom + (len - bodyH)) / 2;
        cable.add(cyl);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glowMat(k % 3 ? 0x38e8ff : 0xff9a2e));
        tip.position.y = -(top - c.bottom + (len - bodyH));
        cable.add(tip);
        g.add(cable);
        this.swayers.push(cable);
      }
    } else {
      const body = new THREE.Mesh(bevelBox(w, bodyH, 1.4, 0.1), std(0x26323f, 0.5, 0.6));
      body.position.set(0, c.bottom + bodyH / 2, 0);
      g.add(body);
      for (let px = -w / 2 + 0.8; px < w / 2 - 0.5; px += 1.4) {
        const led = new THREE.Mesh(boxGeo(0.5, 0.2, 0.06), glowMat(Math.floor(px * 3) % 2 ? 0xff9a2e : 0x38e8ff));
        led.position.set(px, c.bottom + 0.9, 0.72);
        g.add(led);
      }
    }
    // 下端の黄黒ハザード帯（ぶつかる高さの目印）
    const strip = new THREE.Mesh(boxGeo(w, 0.14, 1.6), hazard);
    strip.position.set(0, c.bottom + 0.05, 0.1);
    g.add(strip);
    return g;
  }

  private makeFlag(x: number): THREE.Group {
    const g = new THREE.Group();
    const base = this.stage.rails.find((r) => x >= r.x0 && x <= r.x1);
    g.position.set(x, base ? base.y0 : 0, 0.9);
    const pole = new THREE.Mesh(cylGeo(0.05, 3.2), std(0x9fb0c2, 0.4, 0.8));
    pole.position.y = 1.6;
    g.add(pole);
    const mat = std(0x7a4210, 0.6, 0.1, { emissive: 0x3a1c00, emissiveIntensity: 0.6 });
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8), mat);
    cloth.material.side = THREE.DoubleSide;
    cloth.position.set(0.65, 2.8, 0);
    g.add(cloth);
    this.flags.push({ cloth, x, mat });
    return g;
  }

  private makeGoal(): THREE.Group {
    const g = new THREE.Group();
    const gx = this.stage.goalX;
    const base = this.stage.rails[this.stage.rails.length - 1].y1;
    g.position.set(gx, base, 0);
    const steel = std(0x2b3a4c, 0.5, 0.7);
    for (const dz of [-1.8, 1.8]) {
      const p = new THREE.Mesh(boxGeo(0.7, 5.5, 0.7), steel);
      p.position.set(0, 2.75, dz);
      g.add(p);
    }
    const head = new THREE.Mesh(boxGeo(0.9, 0.7, 4.4), steel);
    head.position.set(0, 5.6, 0);
    g.add(head);
    const sign = makeSign('ドレイン装置室', 'cyan', 7);
    sign.position.set(0.5, 6.6, 0);
    sign.rotation.y = 0;
    g.add(sign);
    // 先の隔壁ドア
    const door = new THREE.Mesh(boxGeo(0.8, 7, 6), std(0x1d2a3a, 0.5, 0.7));
    door.position.set(12, 3.5, 0);
    g.add(door);
    const doorGlow = new THREE.Mesh(boxGeo(0.2, 5, 0.3), glowMat(0x38e8ff));
    doorGlow.position.set(11.5, 3.5, 0);
    g.add(doorGlow);
    for (const [dx, col] of [[1, 0x38e8ff], [5, 0xff9a2e], [9, 0x38e8ff]] as const) {
      const lamp = new THREE.Mesh(boxGeo(0.4, 0.2, 5), glowMat(col));
      lamp.position.set(dx, 0.2, 0);
      g.add(lamp);
    }
    return g;
  }

  // ---------------------------------------------------------------- カート
  private buildCart(): void {
    const body = new THREE.Mesh(bevelBox(2.0, 0.7, 1.4, 0.08), std(0x7a4b22, 0.7, 0.4));
    body.position.set(0, 0.35 + 0.3, 0);
    this.cartGroup.add(body);
    const rim = new THREE.Mesh(boxGeo(2.1, 0.1, 1.5), glowMat(0xff9a2e));
    rim.position.set(0, 1.0, 0);
    this.cartGroup.add(rim);
    const inner = new THREE.Mesh(boxGeo(1.8, 0.05, 1.2), std(0x1a1006, 0.9, 0.1));
    inner.position.set(0, CART_FLOOR + 0.0, 0);
    this.cartGroup.add(inner);
    for (const sx of [-1, 1]) {
      const bumper = new THREE.Mesh(boxGeo(0.14, 0.34, 1.0), std(0x9fb0c2, 0.4, 0.8));
      bumper.position.set(sx * 1.08, 0.6, 0);
      this.cartGroup.add(bumper);
      for (const dz of [-1, 1]) {
        const wheel = new THREE.Group();
        wheel.position.set(sx * MC.wheel * 1.05, 0.28, dz * RAIL_Z);
        const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.16, 16), std(0x20262e, 0.5, 0.8));
        tyre.rotation.x = Math.PI / 2;
        wheel.add(tyre);
        const hub = new THREE.Mesh(boxGeo(0.46, 0.06, 0.2), std(0xcfd8e2, 0.3, 0.9));
        hub.position.z = dz * 0.04;
        wheel.add(hub);
        this.cartGroup.add(wheel);
        this.wheels.push(wheel);
      }
    }
    const lamp = new THREE.Mesh(boxGeo(0.1, 0.18, 0.4), glowMat(0x38e8ff));
    lamp.position.set(1.12, 0.78, 0);
    this.cartGroup.add(lamp);
  }

  // ---------------------------------------------------------------- 敵・弾・演出
  private makeEnemy(kind: 'drone' | 'gunner'): EnemyObj {
    const model = buildModel(kind);
    const root = new THREE.Group();
    root.add(model.root);
    const box = new THREE.Box3().setFromObject(model.root);
    const size = box.getSize(new THREE.Vector3());
    let s: number, base: number;
    if (kind === 'drone') {
      s = (MC.droneRadius * 2.5) / Math.max(size.x, size.z);
      base = 0;
      model.root.position.y = -((box.min.y + box.max.y) / 2) * s;
    } else {
      s = (MC.gunnerH + 0.35) / size.y;
      base = -box.min.y * s;
      model.root.position.y = base;
      // 正面の装甲板（撃っても弾かれる）。root の前＝+z（root を回して -x 向きにする）
      const plate = new THREE.Mesh(bevelBox(1.0, MC.gunnerH * 0.95, 0.2, 0.05), std(0xc9772a, 0.4, 0.7));
      plate.position.set(0, MC.gunnerH * 0.5, 0.62);
      const hz = new THREE.Mesh(boxGeo(1.02, 0.22, 0.24), std(0xffffff, 0.7, 0.2, { map: tiled(hazardTex(), 1, 1) }));
      hz.position.set(0, MC.gunnerH * 0.9, 0.62);
      root.add(plate, hz);
    }
    model.root.scale.setScalar(s);
    root.rotation.y = -Math.PI / 2; // -x（来る方向）を向く
    this.scene.add(root);
    return { root, model, kind, base };
  }

  private spawnParticles(f: McFx): void {
    const cfg: Record<McFx['k'], { n: number; col: number; sp: number; life: number; g: number }> = {
      kill: { n: 14, col: 0xffb347, sp: 7, life: 0.55, g: 6 },
      deflect: { n: 6, col: 0xffe83a, sp: 5, life: 0.3, g: 10 },
      hit: { n: 10, col: 0xff4d4d, sp: 5, life: 0.5, g: 4 },
      gear: { n: 16, col: 0xffd24a, sp: 5, life: 0.7, g: 0 },
      metal: { n: 4, col: 0x8fc4ff, sp: 2.5, life: 0.3, g: 0 },
      crash: { n: 26, col: 0xff8a2e, sp: 9, life: 0.8, g: 8 },
      land: { n: 5, col: 0x8895a5, sp: 2.5, life: 0.35, g: 2 },
    };
    const c = cfg[f.k];
    for (let i = 0; i < c.n; i++) {
      const m = this.partPool.pop() ?? new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      (m.material as THREE.MeshBasicMaterial).color.setHex(i % 3 === 0 ? 0xffffff : c.col);
      m.position.set(f.x, f.y, (Math.random() - 0.5) * 0.8);
      m.visible = true;
      this.scene.add(m);
      const a = Math.random() * Math.PI * 2, s = c.sp * (0.4 + Math.random() * 0.8);
      this.particles.push({ mesh: m, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 1, vz: (Math.random() - 0.5) * 3, life: c.life, max: c.life, g: c.g });
    }
  }

  // ---------------------------------------------------------------- 更新
  /** 状態を作り直したとき（スタート・やり直し）に呼ぶ */
  reset(x: number): void {
    for (const e of this.enemyObjs.values()) { this.scene.remove(e.root); disposeObject(e.root); }
    this.enemyObjs.clear();
    for (const p of this.particles) { this.scene.remove(p.mesh); this.partPool.push(p.mesh); }
    this.particles = [];
    this.camX = x + MC.viewWidth * (0.5 - MC.cartScreenX);
    const g = this.stage.rails.find((r) => x >= r.x0 && x <= r.x1);
    this.camY = g ? g.y0 : 0;
  }

  update(st: McState, aim: { x: number; y: number }, dt: number, aspect: number): void {
    const { world, vis } = this;
    const p = world.player;
    // ---- カメラ
    if (Math.abs(this.camera.aspect - aspect) > 1e-3) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
    const tx = st.x + MC.viewWidth * (0.5 - MC.cartScreenX);
    this.camX += (tx - this.camX) * (1 - Math.exp(-9 * dt));
    const groundY = st.grounded ? st.y : Math.max(this.stage.minY, this.camY);
    this.camY += ((st.dead === 'fall' ? this.camY : Math.max(st.y * 0.55 + groundY * 0.45, this.stage.minY)) - this.camY) * (1 - Math.exp(-3.2 * dt));
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * CAM_DIST;
    const lookY = this.camY + halfH * 0.38;
    this.camera.position.set(this.camX, lookY + 1.4, CAM_DIST);
    this.camera.lookAt(this.camX, lookY - 0.1, 0);
    this.camera.up.set(0, 1, 0);
    this.camera.updateMatrixWorld(true);

    // ---- カート
    const crashed = st.dead === 'crash';
    this.cartGroup.position.set(st.x, st.y, 0);
    const targetTilt = Math.atan(st.grade) * (st.grounded ? 1 : 0.3) + (st.grounded ? 0 : THREE.MathUtils.clamp(-st.vy * 0.012, -0.25, 0.25));
    this.cartTilt += (targetTilt - this.cartTilt) * (1 - Math.exp(-14 * dt));
    this.cartGroup.rotation.z = this.cartTilt + (crashed ? 0.25 : 0);
    for (const w of this.wheels) w.rotation.z = -st.wheelRot;
    this.cartGroup.visible = !(st.dead === 'fall' && st.y < this.stage.minY - 3);
    this.cartGroup.visible = this.cartGroup.visible && !(st.invuln > 0 && Math.floor(st.t * 18) % 2 === 0 && !st.dead);
    // ---- プレイヤー（モデルとポーズは本編と同じ）
    const flip = aim.x < st.x - 0.4;
    p.root.rotation.y = flip ? Math.PI / 2 : -Math.PI / 2;
    p.root.position.set(0, CART_FLOOR, 0);
    p.pos.set(st.x, st.y, 0);
    p.vel.set(0, st.vy, 0);
    p.onGround = st.grounded;
    p.hp = Math.max(1, st.hp);
    p.pitch = 0;
    p.energy = p.maxEnergy;
    world.time += dt;
    // 照準方向（ワールド）
    const gx = st.x + 0.3, gy = st.y + (st.crouch ? 0.65 : 1.2);
    world.aimDir.set(aim.x - gx, aim.y - gy, 0);
    if (world.aimDir.lengthSq() < 0.01) world.aimDir.set(flip ? -1 : 1, 0, 0);
    world.aimDir.normalize();
    if (st.events.includes('shot')) this.shotsFired++;
    world.stats.shots = this.shotsFired;
    this.cartGroup.updateMatrixWorld(true);
    poseCharacter(world, vis, this.anim, dt);
    // しゃがみ：膝を深く曲げて体を沈める（ポーズ計算のあとに重ねる）
    this.crouchK += ((st.crouch ? 1 : 0) - this.crouchK) * (1 - Math.exp(-18 * dt));
    const k = this.crouchK;
    if (k > 0.01) {
      for (const leg of [vis.legL, vis.legR]) {
        leg.hip.rotation.x += (1.15 - leg.hip.rotation.x) * k;
        leg.knee.rotation.x += (-1.9 - leg.knee.rotation.x) * k;
        leg.ankle.rotation.x += (0.45 - leg.ankle.rotation.x) * k;
      }
      vis.rig.position.y += (-1.27 - vis.rig.position.y) * k;
      vis.spine.rotation.x += 0.3 * k;
      vis.head.rotation.x -= 0.2 * k;
    }
    p.root.updateMatrixWorld(true);

    // ---- 照明をカートに追従
    this.cyanLight.position.set(st.x + 4, st.y + 4, 5);
    this.orangeLight.position.set(st.x - 3.5, st.y + 2.5, 4);
    this.keyLight.position.set(st.x + 0.5, st.y + 3.6, 5.5);
    this.sun.position.set(st.x - 4, st.y + 10, 12);
    this.sun.target.position.set(st.x + 2, st.y, 0);

    // ---- 歯車・旗・揺れ物
    const t = st.t;
    for (const g of this.gears) {
      const picked = st.pickedGears.has(g.i);
      g.m.visible = g.ring.visible = !picked && Math.abs(this.stage.gears[g.i].x - st.x) < 40;
      if (g.m.visible) { g.m.tick(t); g.ring.scale.setScalar(1 + 0.12 * Math.sin(t * 4 + g.i)); }
    }
    for (const mt of this.metals) {
      mt.m.visible = !st.pickedMetal.has(mt.i) && Math.abs(this.stage.metals[mt.i].x - st.x) < 30;
      if (mt.m.visible) mt.m.rotation.z = t * 2.2 + mt.i;
    }
    for (const f of this.flags) {
      const passed = st.x >= f.x;
      f.mat.color.setHex(passed ? 0x38e8ff : 0x7a4210);
      f.mat.emissive.setHex(passed ? 0x0a6a7a : 0x3a1c00);
      f.cloth.rotation.y = Math.sin(t * 4 + f.x) * 0.25;
    }
    this.swayers.forEach((o, i) => { if (o.type === 'Group') o.rotation.z = Math.sin(t * 2 + i) * 0.06; else o.position.x += 0; });

    // ---- 敵
    const seen = new Set<number>();
    for (const e of st.enemies) {
      if (e.dormant || (!e.alive && e.flash <= 0)) continue;
      seen.add(e.id);
      let o = this.enemyObjs.get(e.id);
      if (!o) { o = this.makeEnemy(e.kind); this.enemyObjs.set(e.id, o); }
      o.root.visible = e.alive || e.flash > 0;
      if (e.kind === 'drone') {
        o.root.position.set(e.x, e.y, 0);
        o.root.rotation.z = Math.sin(t * 3 + e.id) * 0.12;
        const props = o.model.parts.props as THREE.Object3D[] | undefined;
        props?.forEach((b) => { b.rotation.y = t * 40; });
      } else {
        o.root.position.set(e.x, e.baseY + 0.0, 0);
        const head = o.model.parts.head as THREE.Object3D | undefined;
        if (head) head.rotation.y = Math.sin(t * 1.5) * 0.3;
      }
    }
    for (const [id, o] of this.enemyObjs) if (!seen.has(id)) { this.scene.remove(o.root); disposeObject(o.root); this.enemyObjs.delete(id); }

    // ---- 弾
    const sync = (pool: THREE.Mesh[], n: number, make: () => THREE.Mesh) => {
      while (pool.length < n) { const m = make(); this.scene.add(m); pool.push(m); }
      pool.forEach((m, i) => { m.visible = i < n; });
    };
    sync(this.bulletPool, st.bullets.length, () => new THREE.Mesh(new THREE.SphereGeometry(MC.bulletRadius * 1.5, 10, 8), glowMat(0xffa030)));
    st.bullets.forEach((b, i) => { this.bulletPool[i].position.set(b.x, b.y, 0); this.bulletPool[i].scale.setScalar(1 + 0.15 * Math.sin(t * 20 + i)); });
    sync(this.shotPool, st.shots.length, () => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.9, 3, 6), glowMat(0xffe83a)); return m; });
    st.shots.forEach((s, i) => {
      const m = this.shotPool[i];
      m.position.set(s.x - (s.vx * 0.012), s.y - s.vy * 0.012, 0);
      m.rotation.z = Math.atan2(s.vy, s.vx - st.vx * 0 ) - Math.PI / 2;
    });

    // ---- パーティクル
    for (const f of st.fx) this.spawnParticles(f);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) { this.scene.remove(pt.mesh); this.partPool.push(pt.mesh); this.particles.splice(i, 1); continue; }
      pt.vy -= pt.g * dt;
      pt.mesh.position.x += pt.vx * dt; pt.mesh.position.y += pt.vy * dt; pt.mesh.position.z += pt.vz * dt;
      const k2 = pt.life / pt.max;
      pt.mesh.scale.setScalar(0.4 + k2);
      (pt.mesh.material as THREE.MeshBasicMaterial).opacity = k2;
    }
    this.lastShots = this.shotsFired;
  }

  /** 画面上の位置 → 遊びの面（z=0）の座標 */
  pointerToWorld(px: number, py: number, w: number, h: number): { x: number; y: number } {
    this.ray.setFromCamera(new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1), this.camera);
    const hit = new THREE.Vector3();
    if (this.ray.ray.intersectPlane(this.plane, hit)) return { x: hit.x, y: hit.y };
    return { x: this.camX, y: this.camY };
  }

  /** 遊びの面の座標 → 画面位置（HUD 用） */
  worldToScreen(x: number, y: number, w: number, h: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, 0).project(this.camera);
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  render(renderer: THREE.WebGLRenderer): void { renderer.render(this.scene, this.camera); }
}
