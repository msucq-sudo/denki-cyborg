// サージ収容所 2階：ジェネレーターを倒したあとの長いエンディングムービー（cinematic/sequencer.ts の Cutscene で再生）。
// ジェネレーターの HP が 0 になった瞬間から、プレイヤーの操作なしで最後まで流れる（スキップは Space / A 長押し・Esc）。
//  ① 溜め撃ち（前左斜め → 後ろ左斜め → 後ろ右斜め）→ 命中・大爆発・ジェネレーターが崩れ落ちる
//  ② 正面から：構えたまま → 銃を下ろす
//  ③ 背後：扉へ歩く → 錠前をガチャガチャ → 開く
//  ④ 扉の脇に寄る。住民が跳びはねながら南の出口へ出ていく
//  ⑤ 部屋の真ん中へ歩く（横から追う）→ 正面：見上げて溜める → 真上から → 天井へ発射
//  ⑥ 天井に命中して穴があく → 穴の真上から見下ろす → ジェットパックで穴を昇る
//  ⑦ 屋根の上に出る（街が見える）→ 左右を見る → 研究所へ向けて一気に飛び去る → 暗転
// 体は毎フレーム updatePlayer（ポーズ計算）のあとに、ここで位置・向き・頭・左腕などを上書きする（cutscene.ts と同じやり方）。
import * as THREE from 'three';
import type { World } from '../../core/types';
import { CHARACTER } from '../../config/balance';
import { spawnBurst, spawnShockwave } from '../../core/effects';
import { buildModel, disposeObject, type Model } from '../../enemies/models';
import { getPlayerVisual, setPlayerFacing } from '../../player/player';
import { playJetCharge, playJetLaunch, stopJetLaunch } from '../../audio/sfx';
import { solveArm } from '../../player/pose';
import type { CamPose, Runtime, Script, Shot } from '../../cinematic/sequencer';
import { buildCity, FOG_COLOR, SUN_DIR } from '../surge/city';
import { buildCompound } from '../surge/compound';
import { COMPOUND, ROAD } from '../surge/layout';
import type { Camp2Visuals } from './visuals';
import type { Residents } from './residents';
import { CAGE, CAGE_Z, CEILING_HOLE, DOOR, HALL, LOCK, STAND } from './layout';

/** ショットの名前と長さ（秒） */
export const ENDING_SHOTS = [
  { name: '前左斜め・溜める', d: 3.0 },
  { name: '後ろ左斜め・溜める', d: 2.6 },
  { name: '後ろ右斜め・発射と爆発', d: 5.4 },
  { name: '正面・構えたまま銃を下ろす', d: 3.4 },
  { name: '背後・扉へ歩いて錠前を開ける', d: 7.0 },
  { name: '背後・住民が出ていく', d: 8.5 },
  { name: '横・部屋の真ん中へ歩く', d: 2.8 },
  { name: '正面・見上げて溜める', d: 2.8 },
  { name: '真上から・溜める', d: 2.6 },
  { name: '天井の横・命中して穴があく', d: 3.0 },
  { name: '穴の真上から見下ろす', d: 2.4 },
  { name: '下から・ジェットで穴を昇る', d: 3.2 },
  { name: '屋外・屋根の上へ出る', d: 3.2 },
  { name: '横・左右を見る', d: 4.2 },
  { name: '後ろ斜め・研究所へ飛び去る', d: 3.4 },
] as const;
export const ENDING_TOTAL = ENDING_SHOTS.reduce((a, s) => a + s.d, 0);
/**
 * 天井の穴がすでにあいているとき（ボス戦中に最大溜めで割った）のショット：
 * 「見上げて溜める」「真上から・溜める」「命中して穴があく」を飛ばし、開いた穴を短く見上げてからジェットで昇る。
 * 元のショット番号 7（正面・見上げる）のカメラをそのまま使い、番号 10 以降は元のまま
 */
export const ENDING_LOOK_UP = { name: '正面・開いた穴を見上げる', d: 2.4 } as const;
export const ENDING_SHOTS_HOLE = [
  ...ENDING_SHOTS.slice(0, 7),
  ENDING_LOOK_UP,
  ...ENDING_SHOTS.slice(10),
] as const;
export const ENDING_TOTAL_HOLE = ENDING_SHOTS_HOLE.reduce((a, s) => a + s.d, 0);
/** 穴ありの版のショット番号 → 元のショット番号（見上げるショットは 7、その後は +2） */
export const holeShotToFull = (i: number): number => (i <= 7 ? i : i + 2);
/** 各ショットの開始時刻 */
const S: number[] = [];
{ let t = 0; for (const s of ENDING_SHOTS) { S.push(t); t += s.d; } S.push(t); }
const [, , S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, S13, S14, S_END] = S;

// ---- 場面の位置
/** 最初に立つ位置（ジェネレーターの方＝+Z を向く） */
const P1 = { x: 0, z: -7 };
/** ジェネレーターの浮いている位置（ここで撃たれて落ちる） */
const BOSS0 = new THREE.Vector3(-5, 3.2, 0.5);
/** 最初に立つ向き（ジェネレーターの方） */
const FACE = Math.atan2(-(BOSS0.x - P1.x), -(BOSS0.z - P1.z));
/** プレイヤー基準の位置：r=右、f=前（ジェネレーターの方） */
const loc = (r: number, f: number, y: number) => new THREE.Vector3(
  P1.x + Math.cos(FACE) * r - Math.sin(FACE) * f, y, P1.z - Math.sin(FACE) * r - Math.cos(FACE) * f);
const BOSS_R = 2.4;
/** 扉の脇（住民の通り道 x -2..2 をあける） */
const ASIDE = { x: -3.4, z: -12.4 };
/** 部屋の真ん中（天井に穴をあける所の真下） */
const CEN = { x: 0, z: 6 };
/** 天井の穴 */
const HOLE = CEILING_HOLE;
const ROOF_Y = HALL.h + 1.4;
/** 研究所の方角（火星の街では収容所の東＝+X） */
/** 街の座標（サージへの道）から、この収容所の部屋の座標へのずらし。部屋の東の壁が、道の突き当たり（建物の東の壁 COMPOUND.wallX）に来る */
const CITY_OFF = new THREE.Vector3(HALL.x1 - COMPOUND.wallX, 0, (CAGE.z0 + HALL.z1) / 2 - ROAD.junctionZ);
/** 研究所（ガレージ付近）の、この部屋の座標での位置。道の東の端、道の南側 */
const LAB_AT = new THREE.Vector3(CITY_OFF.x, 0, CITY_OFF.z + 20);
/** 研究所の方角：道に沿って東（+X）へ、少しだけ南（+Z）。ほぼ水平 */
const TO_LAB = new THREE.Vector3(LAB_AT.x - CEN.x, 40, LAB_AT.z - CEN.z).normalize();

// ---- 動きの時刻（ムービー開始からの秒）
export const BEAT = {
  /** ジェネレーターに向けて撃つ */
  fire: S2 + 1.7,
  /** 銃を下ろし始める */
  lower: S3 + 1.5,
  /** 扉：歩き出す・錠前に着く・手を止めて開く */
  turn0: S4, walk0: S4 + 0.8, lock0: S4 + 2.8, open0: S4 + 5.0, open1: S4 + 7.0,
  /** 住民が走り出す */
  exit0: S5 + 0.3,
  /** 部屋の真ん中へ歩き出す・着く */
  walk2: S5 + 5.5,
  /** 見上げる・溜め始め・天井へ発射 */
  look: S7 - 0.4, charge2: S7 + 1.1, fire2: S9 - 0.03,
  /** ジェットを噴かす・昇り始める */
  jet: S10 + 1.0, rise: S10 + 1.2,
  /** 研究所へ飛び去る */
  dash: S14 + 0.7,
} as const;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const V = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]);
const POLE_L = V(CHARACTER.gun.poleL);

export interface EndingProbe {
  /** 今のショット番号 */
  shot: number;
  /** 溜め量 0..1 */
  charge: number;
  /** ジェネレーターが撃たれたか・床に落ちたか */
  bossHit: boolean;
  bossLanded: boolean;
  /** 天井に穴があいたか・街が見えているか */
  holeOpen: boolean;
  cityShown: boolean;
  /** プレイヤーの高さ */
  playerY: number;
  playerYaw: number;
  /** 顔の向きの y 成分（1=真上、-1=真下） */
  faceUp: number;
  /** 扉の開き具合 0..1 */
  doorOpen: number;
  /** 発進の音を鳴らした回数（溜め・発進。それぞれ 1 回ずつ） */
  jetCharge: number;
  jetLaunch: number;
}

export function newEndingProbe(): EndingProbe {
  return { shot: 0, charge: 0, bossHit: false, bossLanded: false, holeOpen: false, cityShown: false, playerY: 0, playerYaw: 0, faceUp: 0, doorOpen: 0, jetCharge: 0, jetLaunch: 0 };
}

export interface EndingDeps {
  vis: Camp2Visuals;
  residents: Residents;
  /** 扉の開き具合を反映する（0..1） */
  setDoor(open: number): void;
  /** 天井の穴がすでにあいている（ボス戦中に割った）。溜め・発射・命中のショットを飛ばす */
  holeOpen?: boolean;
  /** ボス戦中に作った屋根・街・空（あれば引き継ぐ。持ち主は呼び出し側なので、ここでは捨てない） */
  opening?: CeilingOpening;
}

/** ムービー中のジェネレーター（本物の敵ではなく、見た目だけの代役） */
function makeBossActor(world: World): Model {
  const m = buildModel('boss');
  m.root.name = 'camp2-ending-boss';
  m.root.position.copy(BOSS0);
  m.root.rotation.y = FACE;                       // プレイヤーの方を向く
  for (const w of m.weakPoints) { w.exposed = false; w.mesh.visible = false; }
  m.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  world.scene.add(m.root);
  return m;
}

/** 不ぞろいな穴（天井の割れ口）の輪郭 */
function jaggedHole(cx: number, cz: number, r: number): THREE.Path {
  const path = new THREE.Path();
  const n = 20;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = (i % 2 ? 0.78 : 1.12) * (1 + 0.1 * Math.sin(i * 2.7));
    const x = cx + Math.cos(a) * r * k, z = cz + Math.sin(a) * r * k;
    if (i) path.lineTo(x, z); else path.moveTo(x, z);
  }
  path.closePath();
  return path;
}

/** 穴のあいた天井（厚い板）・屋根・建物の外壁。命中するまで隠しておく */
function buildRoof(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'camp2-ending-roof';
  const x0 = HALL.x0, x1 = HALL.x1, z0 = CAGE.z0, z1 = HALL.z1;
  const outline = () => {
    const s = new THREE.Shape();
    s.moveTo(x0, z0); s.lineTo(x1, z0); s.lineTo(x1, z1); s.lineTo(x0, z1); s.closePath();
    s.holes.push(jaggedHole(HOLE.x, HOLE.z, HOLE.r));
    return s;
  };
  // 天井＋屋根の厚い板（y: HALL.h .. ROOF_Y）。形は XY で作って、y→z になるよう寝かせる
  const slabGeo = new THREE.ExtrudeGeometry(outline(), { depth: ROOF_Y - HALL.h, bevelEnabled: false });
  slabGeo.rotateX(Math.PI / 2);
  slabGeo.translate(0, ROOF_Y, 0);
  const slab = new THREE.Mesh(slabGeo, [
    new THREE.MeshStandardMaterial({ color: 0x3a3436, roughness: 0.8, metalness: 0.3, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ color: 0x9a8f86, roughness: 0.9, metalness: 0.1, emissive: 0x3a1206, emissiveIntensity: 0.5 }),
  ]);
  slab.receiveShadow = true;
  g.add(slab);
  // 屋根の表面（明るいコンクリート）
  const plateGeo = new THREE.ShapeGeometry(outline());
  plateGeo.rotateX(Math.PI / 2);
  plateGeo.translate(0, ROOF_Y + 0.03, 0);
  const plate = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({ color: 0xa89c92, roughness: 0.95, metalness: 0.05, side: THREE.DoubleSide }));
  plate.receiveShadow = true;
  g.add(plate);
  // 屋根の上の設備（空調・パイプ）。穴をふさがない所に
  const prop = new THREE.MeshStandardMaterial({ color: 0x7c8794, roughness: 0.6, metalness: 0.5 });
  for (const [x, z, w, d, h] of [[-9, -2, 4, 3, 1.6], [9, 14, 5, 3, 1.4], [-10, 15, 3, 3, 2.2], [10, -18, 6, 2.5, 1.2], [-8, -22, 3, 3, 1.8], [3.5, 17, 2, 2, 1]] as const) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), prop);
    b.position.set(x, ROOF_Y + h / 2, z);
    b.castShadow = true;
    g.add(b);
  }
  // 屋根の縁（低い立ち上がり）
  const rim = new THREE.MeshStandardMaterial({ color: 0xc8682a, roughness: 0.6, metalness: 0.3, emissive: 0x3a1206, emissiveIntensity: 0.4 });
  const L = z1 - z0, W = x1 - x0;
  for (const [x, z, w, d] of [[(x0 + x1) / 2, z0, W, 0.4], [(x0 + x1) / 2, z1, W, 0.4], [x0, (z0 + z1) / 2, 0.4, L], [x1, (z0 + z1) / 2, 0.4, L]] as const) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, d), rim);
    b.position.set(x, ROOF_Y + 0.3, z);
    g.add(b);
  }
  // 外壁（内側の壁は裏から見えないので、外向きの板を重ねる）
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xb4a79c, roughness: 0.85, metalness: 0.15 });
  const h = HALL.h + 0.6, cy = (HALL.h - 0.6) / 2;
  const plane = (w: number, x: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    m.position.set(x, cy, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    g.add(m);
  };
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  plane(W, cx, z0 - 0.02, Math.PI);
  plane(W, cx, z1 + 0.02, 0);
  plane(L, x0 - 0.02, cz, -Math.PI / 2);
  plane(L, x1 + 0.02, cz, Math.PI / 2);
  g.visible = false;
  return g;
}

/** 穴の向こうの屋根・街・空（穴があくまで隠しておく）。ボス戦中に穴をあけたときも、エンディングも、同じものを使う */
export interface CeilingOpening {
  roof: THREE.Group;
  outdoor: THREE.Group;
  /** 街の空（カメラに追従させる） */
  sky: THREE.Object3D;
  shown: boolean;
  /** 天井を穴のあいたものに差し替え、屋根・街・空を見せる */
  show(scene: THREE.Scene, vis: Camp2Visuals): void;
  follow(camera: THREE.Camera): void;
  dispose(scene: THREE.Scene): void;
}
export function buildCeilingOpening(scene: THREE.Scene): CeilingOpening {
  const roof = buildRoof();
  scene.add(roof);
  const outdoor = new THREE.Group();
  outdoor.name = 'camp2-ending-outdoor';
  const city = buildCity();
  city.root.position.copy(CITY_OFF);
  outdoor.add(city.root);
  // 収容所の柵・庭（道の突き当たり）。建物本体は、この部屋が収容所の中なので隠す
  const comp = buildCompound();
  comp.building.visible = false;
  comp.root.position.copy(CITY_OFF);
  outdoor.add(comp.root);
  outdoor.add(buildLabLandmark(LAB_AT));
  const sun = new THREE.DirectionalLight(0xffc68f, 2.4);
  sun.position.copy(SUN_DIR).multiplyScalar(150);
  outdoor.add(sun);
  const hemi = new THREE.HemisphereLight(0xffd8b0, 0x6a4a3a, 0.9);
  outdoor.add(hemi);
  outdoor.visible = false;
  scene.add(outdoor);
  const o: CeilingOpening = {
    roof, outdoor, sky: city.sky, shown: false,
    show(sc, vis) {
      vis.ceil.visible = false;
      vis.ceilCracks.visible = false;
      roof.visible = true;
      outdoor.visible = true;
      sc.background = new THREE.Color(FOG_COLOR);
      sc.fog = new THREE.FogExp2(FOG_COLOR, 0.00038);   // 研究所の方（東 約1.6km）まで見えるように、街より薄く
      o.shown = true;
    },
    follow(camera) { city.sky.position.copy(camera.position).sub(CITY_OFF); },   // 空は city.root の子（ずらした分を戻す）
    dispose(sc) {
      sc.remove(roof, outdoor);
      disposeObject(roof);
      disposeObject(outdoor);
    },
  };
  return o;
}

/** 研究所の遠景：白と紺のパネル・シアンの光の帯の大きな建物（街に外観のモデルが無いので、遠くから見分けがつく程度に） */
function buildLabLandmark(at: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  g.name = 'camp2-ending-lab';
  g.position.copy(at);
  g.scale.setScalar(2.6);   // 1.6km 先でも見分けがつくように大きめに
  const white = new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.7, metalness: 0.1 });
  const navy = new THREE.MeshStandardMaterial({ color: 0x203c70, roughness: 0.6, metalness: 0.2 });
  const cyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x52e8ff).multiplyScalar(1.6) });
  const box = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    g.add(b);
  };
  box(navy, 90, 14, 64, 0, 7, 0);          // 低い土台
  box(white, 70, 30, 50, 0, 29, 0);        // 本棟
  box(navy, 40, 16, 34, -10, 52, 0);       // 上の階
  for (const y of [14.4, 44.2, 60.2]) box(cyan, y > 50 ? 40.4 : 70.4, 0.8, y > 50 ? 34.4 : 50.4, y > 50 ? -10 : 0, y, 0);   // シアンの光の帯
  box(cyan, 1.2, 40, 1.2, 28, 40, 26);     // 角の縦の光
  box(cyan, 1.2, 40, 1.2, -28, 40, 26);
  return g;
}

/** 飛び去るときの流れる光の筋（空中なので地面用の SpeedLines は使わない） */
class Streaks {
  readonly mesh: THREE.InstancedMesh;
  private pos: THREE.Vector3[] = [];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private one = new THREE.Vector3(1, 1, 1);
  private mat: THREE.MeshBasicMaterial;
  constructor(scene: THREE.Scene, private n = 70) {
    this.mat = new THREE.MeshBasicMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.08, 14), this.mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    for (let i = 0; i < n; i++) this.pos.push(new THREE.Vector3(1e6, 0, 0));
    scene.add(this.mesh);
  }
  update(center: THREE.Vector3, dir: THREE.Vector3, opacity: number): void {
    this.mat.opacity = opacity;
    this.mesh.visible = opacity > 0.01;
    if (!this.mesh.visible) return;
    this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const side = new THREE.Vector3(-dir.z, 0, dir.x), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.n; i++) {
      const p = this.pos[i];
      const rel = p.clone().sub(center), along = rel.dot(dir);
      if (along < -60 || along > 80 || rel.length() > 140) {
        p.copy(center).addScaledVector(dir, -40 + Math.random() * 120)
          .addScaledVector(side, (Math.random() - 0.5) * 50).addScaledVector(up, (Math.random() - 0.5) * 30);
      }
      p.addScaledVector(dir, -2.5);   // 後ろへ流れる
      this.m4.compose(p, this.q, this.one);
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}

export function endingScript(rt: Runtime, deps: EndingDeps, probe?: EndingProbe): Script {
  const world = rt.world;
  const { vis, residents } = deps;
  const scene = world.scene;
  const fx = rt.fx;
  const actor = makeBossActor(world);
  // 屋根・街・空・太陽（穴があいてから見せる）。ボス戦中にすでに穴をあけていたら、そのときのものを引き継ぐ
  const holeOpen = !!deps.holeOpen;
  const opening = deps.opening ?? buildCeilingOpening(scene);
  const ownOpening = !deps.opening;
  if (holeOpen) { opening.show(scene, vis); if (probe) { probe.holeOpen = true; probe.cityShown = true; } }
  const streaks = new Streaks(scene);

  const bolt = new THREE.Group();
  bolt.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc8fbff).multiplyScalar(2.5), fog: false })));
  bolt.add(new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({ color: 0x40e0ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
  bolt.visible = false;
  scene.add(bolt);

  const clock = { t: 0 };
  const lock = new THREE.Vector3(LOCK.x, LOCK.y, LOCK.z);
  const tmp = new THREE.Vector3(), mz = new THREE.Vector3(), aim = new THREE.Vector3();
  const faceQ = new THREE.Quaternion(), faceDir = new THREE.Vector3();
  const qs = new THREE.Quaternion(), qe = new THREE.Quaternion(), relaxEuler = new THREE.Euler();
  const st = {
    doorDone: false, jetCharged: false, gateStarted: false, fired: false, fired2: holeOpen, hit: false, hit2: holeOpen, freedDone: false, exitDone: false, gateT: -1,
    boltFrom: new THREE.Vector3(), boltTo: new THREE.Vector3(), boltT: 0, boltDur: 0, boltKind: 0,
    // ジェネレーターの落下
    by: BOSS0.y, bvy: 0, bz: BOSS0.z, tilt: 0, tiltZ: 0, landed: false, bangT: 0, smokeT: 0,
    charge: 0, hole: holeOpen,
    // 飛び去り
    flyPos: new THREE.Vector3(), jet: 0,
  };

  // ---------------------------------------------------------------- 演出の小道具
  function bossBlast(): void {
    const at = actor.root.position.clone();
    rt.flash(1, '#fff2d0');
    rt.shake(1);
    fx.flash(at, 18, 0xfff0c0, 0.4);
    fx.flash(at, 34, 0xffa040, 0.65);
    fx.spark(at, 110, 18, 0xffc866);
    fx.spark(at, 50, 10, 0x9ff4ff);
    fx.chunks(at, 30, 13, new THREE.Vector3(0, 1, 0.3), 0.15, 0.6, 1.4);
    fx.dust(at, 16, 5, 0x3a3430, 2, 2.6);
    spawnShockwave(world, at, 0xffd070, 10, 0.9);
    spawnShockwave(world, at, 0xff8a40, 6, 0.6);
    spawnBurst(world, at, 0xffa24d, 40, 10);
    for (const m of actor.eyeMats) { m.emissiveIntensity = 0; m.emissive.setHex(0x000000); }
    for (const b of actor.bodyMats) b.mat.color.copy(b.base).multiplyScalar(0.4);
    st.bvy = 3.5;
  }

  function ceilingBlast(): void {
    const at = new THREE.Vector3(HOLE.x, HALL.h - 0.1, HOLE.z);
    rt.flash(0.9, '#ffffff');
    rt.shake(0.9);
    fx.flash(at, 16, 0xffffff, 0.35);
    fx.flash(at, 30, 0x9ff4ff, 0.6);
    fx.spark(at, 90, 16, 0x9ff4ff, new THREE.Vector3(0, -1, 0), 1.5);
    fx.chunks(at, 40, 9, new THREE.Vector3(0, -1, 0), 0.15, 0.7, 2.2);
    fx.dust(at, 18, 4, 0x6a625c, -0.5, 2.5);
    spawnShockwave(world, at, 0x9ff4ff, 8, 0.8);
    // 天井を穴のあいたものに差し替える。穴の向こうに街と空が見える
    opening.show(scene, vis);
    st.hole = true;
  }

  function fireBolt(from: THREE.Vector3, to: THREE.Vector3, speed: number, kind: number): void {
    st.boltFrom.copy(from); st.boltTo.copy(to);
    st.boltDur = from.distanceTo(to) / speed;
    st.boltT = 0; st.boltKind = kind;
    bolt.visible = true;
    bolt.position.copy(from);
    world.stats.shots++;       // 反動と構えを残すため
    world.events.emit('shot', { charged: true, power: 1 });
    rt.shake(0.35);
    fx.flash(from, 4, 0xc8fbff, 0.18);
  }

  // ---------------------------------------------------------------- 溜めの量
  function charge1(T: number): number {
    if (T < S[1]) return lerp(0.04, 0.5, clamp01(T / S[1]));
    if (T < S2) return lerp(0.5, 0.95, clamp01((T - S[1]) / (S2 - S[1])));
    return lerp(0.95, 1, clamp01((T - S2) / 0.8));
  }

  // ---------------------------------------------------------------- プレイヤーの体
  /** 左手で錠前をいじる（cutscene.ts と同じ動き）。tt=錠前に着いてからの秒、stop=手を止める秒、w=ブレンド */
  function fiddleArm(tt: number, stop: number, w: number): void {
    if (w <= 0.001) return;
    const v = getPlayerVisual(world);
    const armL = v.armL;
    tmp.copy(lock);
    if (tt < stop) {
      const k = clamp01((tt - 0.35) / 0.3);
      tmp.x += (Math.sin(tt * 23) * 0.035 + Math.sin(tt * 41) * 0.015) * k;
      tmp.y += (Math.sin(tt * 31) * 0.03 + Math.sin(tt * 13) * 0.02) * k;
      tmp.z += Math.sin(tt * 17) * 0.02 * k;
    } else tmp.z += 0.04 * smooth((tt - stop) / 0.3);
    v.chest.worldToLocal(tmp);
    const Sh = armL.shoulder.position;
    const d = tmp.distanceTo(Sh);
    const stretch = Math.min(2, Math.max(1, (d / 0.97 - armL.fore) / armL.upper));
    solveArm(Sh, tmp, armL.upper * stretch, armL.fore, POLE_L, qs, qe);
    armL.shoulder.quaternion.slerp(qs, w);
    armL.elbow.quaternion.slerp(qe, w);
    const sv = lerp(v.springStretch.value, stretch, w);
    v.springStretch.value = sv;
    armL.elbow.position.y = -armL.upper * sv;
  }

  /** 銃口から target へ向けた銃の向きを世界の aimDir にする（ポーズ側がこれを読む） */
  function aimAt(target: THREE.Vector3): void {
    getPlayerVisual(world).muzzle.getWorldPosition(mz);
    world.aimDir.copy(target).sub(mz).normalize();
  }

  function posePlayer(T: number): void {
    const p = world.player;
    const v = getPlayerVisual(world);
    let x = P1.x, z = P1.z, y = 0, yaw = FACE, speed = 0;     // speed=向いている方向へ歩く速さ（歩きのアニメ用）
    let poseAim = false, charging = false, charge = 0, fly = false;
    let lookUp = 0, headDown = 0, headYaw = 0, spineYaw = 0, fiddle = -1, lamp = 0, tilt = 0, jetBoost = 0;
    let aimTarget: THREE.Vector3 | null = null;

    if (T < S4) {
      // ①② ジェネレーターに向かって溜め撃ち → 構えたまま → 銃を下ろす
      aimTarget = actor.root.position;
      poseAim = T < BEAT.lower;
      if (T < BEAT.fire) { charging = true; charge = charge1(T); }
      st.charge = charge;
      if (T >= BEAT.fire && !st.fired) {
        st.fired = true;
        v.muzzle.getWorldPosition(mz);
        fireBolt(mz.clone(), BOSS0.clone().add(new THREE.Vector3(Math.sin(FACE), 0, Math.cos(FACE)).multiplyScalar(BOSS_R * 0.7)), 46, 0);
      }
    } else if (T < S5) {
      // ③ 扉へ歩く
      const t = T - S4;
      yaw = FACE * (1 - smooth(t / 0.8));
      if (T < BEAT.walk0) { speed = 0; }
      else if (T < BEAT.lock0) {
        const u = (T - BEAT.walk0) / (BEAT.lock0 - BEAT.walk0);
        z = lerp(P1.z, STAND.z, u);
        speed = (P1.z - STAND.z) / (BEAT.lock0 - BEAT.walk0);
      } else { z = STAND.z; }
      if (T >= BEAT.lock0) {
        const tt = T - BEAT.lock0;
        const stop = BEAT.open0 - BEAT.lock0;
        fiddle = tt;
        headDown = 0.28 * smooth(tt / 0.5);
        if (tt >= stop) {
          lamp = 1;
          headDown *= 1 - 0.6 * smooth((tt - stop) / 0.4);
        } else headYaw = Math.sin(tt * 9) * 0.04;
        deps.setDoor(smooth((T - BEAT.open0) / (BEAT.open1 - BEAT.open0)));
        if (probe) probe.doorOpen = smooth((T - BEAT.open0) / (BEAT.open1 - BEAT.open0));
      }
      if (lamp && !st.freedDone) {
        st.freedDone = true;
        vis.lockLamp.color.set(0x3dff7a).multiplyScalar(1.6);
        residents.setFreed(true);
        world.events.emit('doorOpen', { pos: new THREE.Vector3((DOOR.x0 + DOOR.x1) / 2, 1.5, CAGE_Z) });
      }
    } else {
      // ④以降
      if (!st.doorDone) { st.doorDone = true; deps.setDoor(1); if (probe) probe.doorOpen = 1; }
      const aside = new THREE.Vector3(ASIDE.x, 0, ASIDE.z);
      const toC = new THREE.Vector3(CEN.x - ASIDE.x, 0, CEN.z - ASIDE.z);
      const walkLen = toC.length();
      const WALK_SPEED = 3.6;
      const walkEnd = BEAT.walk2 + walkLen / WALK_SPEED;
      const yawGap = Math.atan2(-(0 - ASIDE.x), -(-CAGE_Z - 0.2 - ASIDE.z));        // 扉のすき間の方
      const yawWalk = Math.atan2(-toC.x, -toC.z);
      const t5 = T - S5;
      if (T < BEAT.walk2 - 0.5) {
        // 扉の脇へ一歩よけて、住民の通り道をあける
        const u = smooth(t5 / 1.3);
        x = lerp(STAND.x, aside.x, u); z = lerp(STAND.z, aside.z, u);
        yaw = lerp(Math.PI / 2, yawGap, smooth((t5 - 1.3) / 0.7));
        speed = t5 < 1.3 ? 2.7 * (1 - Math.abs(2 * clamp01(t5 / 1.3) - 1) * 0.3) : 0;
        if (t5 >= 1.3) yaw = lerp(Math.PI / 2, yawGap, smooth((t5 - 1.3) / 0.7)); else yaw = Math.PI / 2;
        // 住民の様子を目で追う
        headYaw = Math.sin(t5 * 0.9) * 0.25;
      } else if (T < walkEnd) {
        const u = clamp01((T - BEAT.walk2) / (walkLen / WALK_SPEED));
        x = lerp(ASIDE.x, CEN.x, u); z = lerp(ASIDE.z, CEN.z, u);
        yaw = lerp(yawGap, yawWalk, smooth((T - (BEAT.walk2 - 0.5)) / 0.5));
        speed = T < BEAT.walk2 ? 0 : WALK_SPEED;
      } else {
        x = CEN.x; z = CEN.z;
        yaw = lerp(yawWalk, -Math.PI, smooth((T - walkEnd) / 0.5));
        const tU = T - BEAT.look;
        lookUp = smooth(tU / 0.9);
        const tC = T - BEAT.charge2;
        if (T >= BEAT.look) { poseAim = true; }
        if (tC > 0 && T < BEAT.fire2 && !holeOpen) {
          charging = true;
          charge = tC < (S8 - BEAT.charge2) ? lerp(0.02, 0.6, tC / (S8 - BEAT.charge2)) : lerp(0.6, 1, clamp01((tC - (S8 - BEAT.charge2)) / 1.4));
        }
        st.charge = charge;
        // 銃口は真上（穴の中心）へ
        aimTarget = new THREE.Vector3(HOLE.x, HALL.h, HOLE.z);
        if (T >= BEAT.fire2 && !st.fired2) {
          st.fired2 = true;
          v.muzzle.getWorldPosition(mz);
          fireBolt(mz.clone(), aimTarget.clone(), 40, 1);
        }
        // ジェットで昇る（顔は穴を見上げたまま。屋根の上に出るころに正面へ戻す）
        if (T >= BEAT.jet) {
          fly = true;
          poseAim = false;
        }
        if (T >= BEAT.rise) {
          const tr = T - BEAT.rise;
          const a = 1.39;
          const tEnd = S12 - BEAT.rise;
          if (T < S12) y = 0.5 * a * tr * tr;
          else {
            const v0 = a * tEnd, base = 0.5 * a * tEnd * tEnd, D = ENDING_SHOTS[12].d;
            const u = clamp01((T - S12) / D);
            // 速度 v0 から減速して止まる（高さ +12.5m）
            const rise = 12.5;
            y = base + rise * (1 - (1 - u) * (1 - u)) * 1;
            void v0;
          }
          x = CEN.x; z = CEN.z;
          yaw = -Math.PI;
          jetBoost = 0.4;
        }
        if (T >= S13) {
          // 屋根の上で滞空：左を見る → 右を見る
          y = 26 + Math.sin((T - S13) * 2.4) * 0.12;
          const t13 = T - S13;
          const look = t13 < 0.4 ? 0
            : t13 < 1.1 ? smooth((t13 - 0.4) / 0.7)
            : t13 < 1.7 ? 1
            : t13 < 2.7 ? 1 - 2 * smooth((t13 - 1.7) / 1.0)
            : t13 < 3.3 ? -1
            : -1 + smooth((t13 - 3.3) / 0.7);
          yaw = -Math.PI - 0.9 * look;                // 左（+X側）が正
          headYaw = 0.55 * look;
        }
        if (T >= S14) {
          // 研究所の方へ向きを変え、溜めてから一気に加速
          const t14 = T - S14;
          yaw = lerp(-Math.PI, -Math.PI / 2, smooth(t14 / 0.6));
          const td = Math.max(0, T - BEAT.dash);
          const dist = 0.5 * 75 * td * td;
          x = CEN.x + TO_LAB.x * dist; z = CEN.z + TO_LAB.z * dist;
          y = 26 + TO_LAB.y * dist - 1.2 * smooth(t14 / 0.6) * (1 - smooth(td / 0.3));
          tilt = smooth((t14 - 0.2) / 0.7);
          jetBoost = 1.5 + 2 * smooth(td / 0.6);
          if (T >= BEAT.dash - 0.62 && !st.jetCharged) { st.jetCharged = true; playJetCharge(); if (probe) probe.jetCharge++; }
          if (td > 0 && !st.exitDone) {
            st.exitDone = true;
            playJetLaunch();   // ドゥン〜ブーン（閃光・揺れと同じ瞬間）
            if (probe) probe.jetLaunch++;
            const at = new THREE.Vector3(x, y, z);
            rt.flash(0.8, '#e8faff');
            rt.shake(1);
            fx.flash(at, 22, 0xcff6ff, 0.5);
            spawnShockwave(world, at, 0x9ff4ff, 14, 0.7);
          }
        }
      }
    }
    st.flyPos.set(x, y, z);

    // ---- 位置・向き
    p.pos.set(x, y, z);
    p.root.position.copy(p.pos);
    p.invuln = Math.max(p.invuln, 0.5);
    setPlayerFacing(world, yaw);
    p.yaw = yaw;
    if (T >= BEAT.jet) lookUp *= 1 - smooth((T - S12) / 1.2);
    p.pitch = lookUp * 1.0 + (poseAim && !lookUp ? 0.05 : 0);
    const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    p.vel.set(f.x * speed, y > 0 && fly ? 0 : 0, f.z * speed);
    p.onGround = y <= 0.01;
    world.level.data.poseAim = poseAim;
    world.level.data.poseFly = fly;
    p.charging = charging;
    p.charge = charge;
    p.flying = false;           // 飛行の姿勢は poseFly で作る（p.flying は入力から毎フレーム決まる）
    v.body.visible = true;
    if (aimTarget) aimAt(aimTarget);
    if (probe) {
      probe.charge = charge; probe.playerY = y; probe.playerYaw = yaw;
    }

    // ---- 頭・背骨・腕（updatePlayer のポーズ計算のあとに上書き）
    // 頭の x 回転は正が上向き（pose.ts も pitch>0＝見上げで正）。見下ろす（headDown）は負
    // ポーズ側ですでに pitch ぶん（頭 0.36・胸 0.3）上を向くので、足りない分を足す。顔の向き y が 0.8 前後（約 55 度上）になるように
    // （正面のカメラからも顔が見える角度。飛行中は前傾（0.35）ぶんを足して、同じ向きに保つ）
    v.head.rotation.x += (0.4 + (fly ? 0.4 : 0)) * lookUp - headDown;
    v.head.rotation.y += headYaw;
    v.spine.rotation.x += 0.14 * lookUp;
    v.chest.rotation.x += 0.06 * lookUp;
    v.spine.rotation.y += spineYaw;
    p.root.updateMatrixWorld(true);
    // 見上げて撃つとき：左腕は力を抜いて下げる（支えのバネ腕が顔の前を横切らないように）
    if (lookUp > 0.001) {
      qs.setFromEuler(relaxEuler.set(0.08, 0, -0.12));
      qe.setFromEuler(relaxEuler.set(0.25, 0, 0));
      v.armL.shoulder.quaternion.slerp(qs, lookUp);
      v.armL.elbow.quaternion.slerp(qe, lookUp);
      const sv = lerp(v.springStretch.value, 1, lookUp);
      v.springStretch.value = sv;
      v.armL.elbow.position.y = -v.armL.upper * sv;
    }
    v.scouterGlow.visible = false;
    if (fiddle >= 0) {
      const stop = BEAT.open0 - BEAT.lock0;
      fiddleArm(fiddle, stop, smooth(fiddle / 0.35) * (T < S5 ? 1 : 0));
    }
    if (tilt > 0) v.pivot.rotateX(-1.0 * tilt);
    if (probe) {
      // 顔（頭のローカル -Z）が世界のどちらを向いているか。y=1 で真上
      p.root.updateMatrixWorld(true);
      v.head.getWorldQuaternion(faceQ);
      probe.faceUp = faceDir.set(0, 0, -1).applyQuaternion(faceQ).y;
    }
    // ジェット
    if (fly) {
      v.jets.children.forEach((c) => { if ((c as THREE.Mesh).isMesh) c.scale.set(1 + jetBoost * 0.8, (0.8 + Math.random() * 0.5) * (1 + jetBoost * 2.2), 1 + jetBoost * 0.8); });
      v.jetLight.intensity = 2.5 + jetBoost * 6 + Math.random() * 1.2;
    }
    // 銃の光と溜めの玉（溜めるほど明るく・大きく）
    if (charging) {
      const j = 1 + Math.sin(T * 60) * 0.12 + (Math.random() - 0.5) * 0.12;
      v.gunGlowMat.color.multiplyScalar(1 + charge * 3.5);
      v.chargeCore.scale.setScalar((0.04 + charge * 0.17) * j);
      v.chargeGlow.scale.setScalar((0.08 + charge * 0.4) * j);
      v.chargeLight.intensity = (2 + charge * 16) * j;
    }
  }

  // ---------------------------------------------------------------- ジェネレーターと弾
  function simBoss(dt: number, T: number): void {
    const r = actor.root;
    const parts = actor.parts as { orbit?: THREE.Object3D };
    if (!st.hit) {
      // まだ生きているように見える（HP 0 で固まっている）
      r.position.set(BOSS0.x, BOSS0.y + Math.sin(T * 2) * 0.06, BOSS0.z);
      if (parts.orbit) parts.orbit.rotation.y += dt * 0.9;
      return;
    }
    st.bvy -= 14 * dt;
    st.by += st.bvy * dt;
    st.bz += dt * 0.5 * (st.landed ? 0 : 1);
    st.tilt = lerp(st.tilt, 0.55, 1 - Math.exp(-2.2 * dt));
    st.tiltZ = lerp(st.tiltZ, 0.3, 1 - Math.exp(-1.5 * dt));
    if (st.by <= BOSS_R) {
      st.by = BOSS_R;
      if (st.bvy < -2 && !st.landed) {
        st.landed = true;
        if (probe) probe.bossLanded = true;
        const at = new THREE.Vector3(BOSS0.x, 0.3, st.bz);
        rt.shake(0.8);
        rt.flash(0.35, '#ffd9a0');
        fx.dust(at, 18, 7, 0x6a5a50, 1.6, 2.4);
        fx.spark(at.clone().setY(1.5), 60, 12, 0xffc866);
        fx.chunks(at, 20, 8, new THREE.Vector3(0, 1, 0), 0.1, 0.5, 2.2);
        spawnShockwave(world, at, 0xffb070, 9, 0.7);
      }
      st.bvy = st.bvy < -2 ? -st.bvy * 0.22 : 0;
    }
    r.position.set(BOSS0.x, st.by, st.bz);
    r.rotation.set(st.tilt, FACE, st.tiltZ);
    if (parts.orbit) parts.orbit.rotation.y += dt * 0.3 * Math.max(0, 1 - (T - BEAT.fire) * 0.3);
    // 火花と煙
    st.bangT -= dt; st.smokeT -= dt;
    const since = T - bossHitT;
    if (since < 5 && st.bangT <= 0) {
      st.bangT = 0.07 + Math.random() * 0.1;
      const at = r.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.3) * 2.5, (Math.random() - 0.5) * 3));
      fx.spark(at, 6, 8, 0xffc866);
      if (Math.random() < 0.35) fx.flash(at, 3.2, 0xffa060, 0.15);
    }
    if (since < 7 && st.smokeT <= 0) {
      st.smokeT = 0.15;
      fx.dust(r.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 2, 2.5, 0x2c2826, 1.4, 2.2);
    }
  }
  let bossHitT = 0;

  function simBolt(dt: number, T: number): void {
    if (!bolt.visible) return;
    st.boltT += dt;
    const u = clamp01(st.boltT / Math.max(0.001, st.boltDur));
    bolt.position.lerpVectors(st.boltFrom, st.boltTo, u);
    bolt.scale.setScalar(1 + Math.sin(T * 80) * 0.1);
    fx.flash(bolt.position, 2.2, 0x9ff4ff, 0.12);
    if (u >= 1) {
      bolt.visible = false;
      if (st.boltKind === 0 && !st.hit) { st.hit = true; bossHitT = T; if (probe) probe.bossHit = true; bossBlast(); }
      else if (st.boltKind === 1 && !st.hit2) { st.hit2 = true; if (probe) probe.holeOpen = true; ceilingBlast(); if (probe) probe.cityShown = true; }
    }
  }

  // ---------------------------------------------------------------- 住民・入口の大扉
  function simResidents(T: number): void {
    if (T >= BEAT.exit0 && !st.gateStarted) {
      st.gateStarted = true;
      st.gateT = 0;
      residents.setExit(true);
    }
  }
  function simGate(dt: number): void {
    if (st.gateT < 0) return;
    st.gateT += dt;
    vis.gate.position.y = 2.1 + 4.6 * smooth(st.gateT / 1.4);
  }

  // ---------------------------------------------------------------- カメラ
  const pp = () => world.player.pos;
  const shots: Shot[] = [];
  const add = (i: number, camera: (u: number, t: number, pose: CamPose) => void, extra: Partial<Shot> = {}) =>
    shots[i] = { name: ENDING_SHOTS[i].name, duration: ENDING_SHOTS[i].d, camera, shake: 0.2, ...extra };

  // ① 前左斜め：顔と銃の光
  add(0, (u, _t, pose) => {
    pose.pos.copy(loc(-lerp(2.2, 1.8, u), lerp(3.4, 2.9, u), 1.7));
    pose.target.copy(loc(0.15, -0.1, 1.45));
    pose.fov = 40; pose.roll = 0;
  }, { enter() { rt.fadeTo(0, 0.2); rt.flash(0.5, '#fff0d0'); } });
  // ② 後ろ左斜め
  add(1, (u, _t, pose) => {
    pose.pos.copy(loc(-lerp(2.4, 2.0, u), -lerp(3.3, 2.9, u), lerp(1.9, 1.75, u)));
    pose.target.copy(loc(0.3, 1.3, 1.5));
    pose.fov = 46; pose.roll = 0;
  });
  // ③ 後ろ右斜め：左手前にプレイヤー、右奥にジェネレーター
  add(2, (u, _t, pose) => {
    pose.pos.copy(loc(lerp(3.4, 3.9, u), -3.7, 1.9));
    pose.target.copy(loc(lerp(0.5, 1.2, smooth(u * 2)), lerp(2.5, 6.5, u), lerp(1.9, 2.4, u)));
    pose.fov = lerp(56, 60, u); pose.roll = 0;
  }, { shake: 0.3 });
  // ④ 正面（ジェネレーターと反対側）：構えたまま → 銃を下ろす
  add(3, (u, _t, pose) => {
    pose.pos.copy(loc(-lerp(2.0, 1.6, u), lerp(3.8, 3.2, u), 1.6));
    pose.target.copy(loc(0.1, 0, 1.55));
    pose.fov = 38; pose.roll = 0;
  }, { shake: 0.15 });
  // ⑤ 背後：扉へ歩く
  add(4, (u, _t, pose) => {
    const z = pp().z;
    pose.pos.set(lerp(1.2, 0.9, u), 1.75, Math.min(P1.z + 3.2, z + 3.4));
    pose.target.set(0, 1.35, lerp(-12.5, -13.6, u));
    pose.fov = lerp(52, 44, u); pose.roll = 0;
  });
  // ⑥ 背後：住民が出ていく
  add(5, (u, _t, pose) => {
    pose.pos.set(lerp(-7.5, -8.5, u), lerp(2.1, 2.8, u), lerp(-8.6, -3.5, smooth(u)));
    pose.target.set(lerp(0.4, 0.8, u), lerp(1.2, 1.1, u), lerp(-14, -3, smooth(u)));
    pose.fov = 56; pose.roll = 0;
  }, { shake: 0.2 });
  // ⑦ 横から追う：歩くプレイヤー
  add(6, (u, _t, pose) => {
    const p = pp();
    pose.pos.set(p.x + 5.2, lerp(4.0, 4.4, u), p.z + lerp(6.4, 7.2, u));
    pose.target.set(p.x - 0.2, 1.1, p.z);
    pose.fov = 48; pose.roll = 0;
  }, { shake: 0.25 });
  // ⑧ 正面：見上げて溜める
  add(7, (u, _t, pose) => {
    pose.pos.set(lerp(0.9, 1.2, u), lerp(2.0, 2.4, u), CEN.z + lerp(3.0, 2.6, u));
    pose.target.set(0, lerp(1.8, 2.0, u), CEN.z);
    pose.fov = 44; pose.roll = 0;
  });
  // ⑨ 真上から：見上げた顔
  add(8, (u, _t, pose) => {
    pose.pos.set(lerp(1.2, 0.9, u), lerp(5.8, 5.0, u), CEN.z + lerp(1.8, 1.5, u));
    pose.target.set(0, 1.9, CEN.z);
    pose.fov = 46; pose.roll = 0;
  });
  // ⑩ 天井の横：弾が当たって穴があく
  add(9, (u, _t, pose) => {
    pose.pos.set(lerp(8.0, 7.2, u), lerp(4.0, 4.6, u), CEN.z - lerp(2.6, 1.4, u));
    pose.target.set(0, lerp(8.0, 9.6, u), CEN.z);
    pose.fov = 52; pose.roll = 0;
  }, { shake: 0.4 });
  // ⑪ 穴の真上から見下ろす
  add(10, (u, _t, pose) => {
    pose.pos.set(lerp(0.9, 0.5, u), lerp(14.5, 12.6, u), CEN.z + lerp(1.4, 0.8, u));
    pose.target.set(0, lerp(1.5, 2.4, u), CEN.z);
    pose.fov = lerp(34, 28, u); pose.roll = 0;
  }, { shake: 0.25 });
  // ⑫ 下から：ジェットで穴を昇る（横・背後）
  add(11, (u, _t, pose) => {
    const py = pp().y;
    pose.pos.set(-lerp(3.2, 4.4, u), Math.max(2.4, py + lerp(0.4, 1.2, u)), CEN.z - lerp(3.6, 3.0, u));
    pose.target.set(0, py + 1.3, CEN.z);
    pose.fov = 54; pose.roll = 0;
  }, { shake: 0.35 });
  // ⑬ 屋外：屋根の上へ出る
  add(12, (u, _t, pose) => {
    const py = pp().y;
    pose.pos.set(-lerp(15, 18, u), lerp(14, 24, u), CEN.z + lerp(2.5, 1.5, u));
    pose.target.set(0, Math.max(py + 0.8, 13), CEN.z);
    pose.fov = 52; pose.roll = 0;
  }, { shake: 0.2 });
  // ⑭ 横：滞空して左右を見る
  add(13, (u, _t, pose) => {
    const py = pp().y;
    pose.pos.set(-lerp(12, 11, u), py + 0.8, CEN.z + lerp(0.5, 2.0, u));
    pose.target.set(0, py + 0.9, CEN.z);
    pose.fov = 34; pose.roll = 0;
  }, { shake: 0.15 });
  // ⑮ 後ろ斜め：どんどん小さくなる
  add(14, (u, t, pose) => {
    const lab = TO_LAB;
    const base = new THREE.Vector3(CEN.x, 26, CEN.z);
    // カメラは最初の位置に近いまま、少しだけ後ろへ引いて追う（遠ざかるのが見えるように）
    const lag = Math.max(0, t - 0.7);
    pose.pos.set(base.x - 7 - 12 * lag * lag * 0.25 * 0 - 4 * lag, base.y + 3.2 + 1.5 * lag, base.z + 5.5);
    const target = st.flyPos.clone();
    pose.target.copy(target);
    pose.fov = lerp(52, 40, smooth(u));
    pose.roll = 0;
    void lab; void u;
  }, {
    shake: 0.3,
    enter() { rt.speedLines = 0.6; },
  });

  // 穴がすでにあいているときは、溜め・発射・命中のショットを飛ばし、見上げるショットを短い専用のものに差し替える
  const playShots: Shot[] = holeOpen
    ? [...shots.slice(0, 7), { ...shots[7], name: ENDING_LOOK_UP.name, duration: ENDING_LOOK_UP.d }, ...shots.slice(10)]
    : shots;
  /** 実際の経過時間 → ムービー内の時刻。穴ありの版は、見上げるショットのあと「溜め・発射・命中」の分を飛び越える */
  const SKIP_AT = S7 + ENDING_LOOK_UP.d, SKIP_BY = S10 - SKIP_AT;
  const movieTime = (real: number) => (holeOpen && real >= SKIP_AT ? real + SKIP_BY : real);

  const streakDir = TO_LAB.clone();

  // ---------------------------------------------------------------- 全体
  return {
    shots: playShots,
    sim(simDt) {
      clock.t += simDt;
      const T = movieTime(clock.t);
      posePlayer(T);
      simBolt(simDt, T);
      simBoss(simDt, T);
      simResidents(T);
      simGate(simDt);
      // 研究所へ飛び去る間の光の筋と暗転
      if (T >= BEAT.dash - 0.2) {
        const k = smooth((T - BEAT.dash) / 0.4);
        streaks.update(st.flyPos, streakDir, 0.55 * k);
      }
      if (T >= S_END - 1.1) rt.fadeTo(1, 1.0);
      // 街の空はカメラに追従
      opening.follow(world.camera);
      if (probe) probe.shot = holeOpen ? holeShotToFull(rt.shotIndex) : rt.shotIndex;
    },
    dispose() {
      scene.remove(actor.root, bolt);
      disposeObject(actor.root);
      if (ownOpening) opening.dispose(scene);
      streaks.dispose(scene);
      stopJetLaunch();   // スキップ・World の破棄で、鳴りかけの発進音を残さない
      world.level.data.poseAim = false;
      world.level.data.poseFly = false;
      world.player.charging = false;
      world.player.charge = 0;
    },
  };
}
