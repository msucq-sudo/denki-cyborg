// サージ収容所への道（?level=surge。&start=drive で車に乗った状態から）。
// 2階の西の出口 → 階段ホール（上の踊り場から北へ下る）→ ガレージ（電力を送ってシャッターを開ける）→ 車に乗る → 運転（vehicle/）→ 判定地点 → 演出（cinematic/）
//
// 【演出担当への公開物】 world.level.data.surge = {
//   fence:       THREE.Group      道をふさぐ金属の柵全体（x = COMPOUND.fenceX。柱・網・有刺鉄線・門柱・看板）
//   fencePanels: THREE.Object3D[] 道の幅の部分のパネル 8 枚（1枚 3m、z = junctionZ±12 に並ぶ）。原点は足元中央、面は YZ 平面。突き破るときに動かす・飛ばす
//   fenceCollider: AABB           柵の当たり判定。突き破ったら active=false にする
//   wall:        THREE.Mesh       収容所の建物の壁（東向きの平面 260×70m、130×35 分割）。ジオメトリは rotateY(π/2) 済みで、ローカルの x が壁の外向き、
//                                 y が上（-35..35）、z が横。mesh.position=(wallX, 35, junctionZ)。頂点を -x（西）へ動かせば凹む → dentWall(wall, 衝突点, 半径, 深さ)（level/surge/compound.ts）が使える
//   building:    THREE.Group      壁・建物の本体・屋上の設備・看板（wall もこの子）
//   eastCollider, shutter 他       T字路の東の柵／ガレージのシャッターの当たり判定
// }
// 空・カメラ：このステージは遠くまで見えるので、world.camera.near=0.25 / far=3800 にしている（車カメラもそのまま使える）。
import * as THREE from 'three';
import type { World, AABB } from '../core/types';
import { drainEnergy } from '../core/energy';
import { toast } from '../core/combat';
import { clearSockets, getSockets } from '../core/sockets';
import { initDrive, startDrive, updateDrive } from '../vehicle/drive';
import type { DriveState } from '../vehicle/types';
import { showPrompt } from './floor1';
import { buildCity, FOG_COLOR, SUN_DIR, WALK } from './surge/city';
import { buildCompound } from './surge/compound';
import { buildLab } from './surge/lab';
import { COMPOUND, GARAGE, ROAD, STAIRS, type SurgeStart } from './surge/layout';

export const SURGE_EXPOSURE = 1.05;
/** シャッターが巻き上がる時間（秒） */
export const SHUTTER_TIME = 2.2;
/** 車に乗れる距離（m） */
const BOARD_REACH = 3.8;

export interface SurgeState {
  /** ガレージのシャッターに電力が届いたか */
  powered: boolean;
  /** シャッターの開き具合 0..1 */
  open: number;
  /** 近くで B / R が使えるか（車に乗る） */
  nearCar: boolean;
  /** 車に乗った */
  boarded: boolean;
  via: 'shot' | 'arm' | null;
}

interface Runtime {
  state: SurgeState;
  lab: ReturnType<typeof buildLab>;
  city: ReturnType<typeof buildCity>;
  comp: ReturnType<typeof buildCompound>;
  sun: THREE.DirectionalLight;
  clock: number;
  promptOn: boolean;
  doorEmitted: boolean;
  /** 開始地点が 'drive'：最初のフレームで車に乗る（initPlayer より後に呼ぶ必要があるため） */
  autoBoard: boolean;
  startAt: SurgeStart;
}
const runtimes = new WeakMap<World, Runtime>();

export function getSurge(world: World): { state: SurgeState; shutter: AABB; sockets: number } | null {
  const rt = runtimes.get(world);
  return rt ? { state: rt.state, shutter: rt.lab.shutter.collider, sockets: getSockets(world).length } : null;
}

const driveOf = (world: World): DriveState | undefined => world.level.data.drive as DriveState | undefined;

// ---------------------------------------------------------------- 構築
export function buildSurge(world: World): void {
  showPrompt(null);
  clearSockets(world);
  const scene = world.scene;
  const startAt: SurgeStart = world.level.data.startAt === 'drive' ? 'drive' : 'stairs';

  // 遠くまで見える：ニア／ファーを広げる（0.05 のままだと遠くで深度が足りずチラつく）
  world.camera.near = 0.25;
  world.camera.far = 3800;
  world.camera.updateProjectionMatrix();

  // ---- 空気：夕方の火星。赤茶の霧で遠くをかすませる
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.00072);
  const hemi = new THREE.HemisphereLight(0xf2b090, 0x6b4638, 1.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc68f, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const ext = 55;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 320 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.06;
  sun.position.copy(SUN_DIR).multiplyScalar(150);
  scene.add(sun, sun.target);

  // ---- 建物（研究所の裏・ガレージ・階段）と街と収容所
  const lab = buildLab();
  const city = buildCity();
  const comp = buildCompound();
  scene.add(lab.root, city.root, comp.root);
  for (const l of lab.lights) scene.add(l);
  for (const c of [...lab.colliders, ...city.colliders, ...comp.colliders]) world.colliders.push(c);

  // ---- ミニマップ用の区画（長い直線は含めない）
  const room = (name: string, x0: number, x1: number, z0: number, z1: number, h: number) => ({
    name, min: new THREE.Vector3(x0, 0, z0), max: new THREE.Vector3(x1, h, z1), entered: true, cleared: true,
  });
  world.level.rooms = [
    room('階段ホール', -STAIRS.width / 2, STAIRS.width / 2, GARAGE.z1 + 1, STAIRS.backZ, 17),
    room('ガレージ', GARAGE.x0, GARAGE.x1, GARAGE.z0, GARAGE.z1, GARAGE.h),
    room('道', -WALK.half, WALK.half, WALK.ewZ0, WALK.nsZ1, 40),
  ];
  world.level.currentRoom = 0;
  world.level.bossSpawned = false;
  world.level.bossDefeated = false;
  world.level.data.remaining = 0;
  world.level.data.interactNear = false;
  world.level.data.objective = 'ガレージのシャッターに電力を送れ';
  world.level.data.surge = {
    fence: comp.fence, fencePanels: comp.fencePanels, fenceCollider: comp.fenceCollider,
    wall: comp.wall, building: comp.building, eastCollider: comp.eastCollider,
    shutter: lab.shutter.collider, layout: { STAIRS, GARAGE, ROAD, COMPOUND },
  };

  const state: SurgeState = { powered: false, open: 0, nearCar: false, boarded: false, via: null };
  const rt: Runtime = { state, lab, city, comp, sun, clock: 0, promptOn: false, doorEmitted: false, autoBoard: false, startAt };
  runtimes.set(world, rt);
  world.level.data.surgeState = state;

  // ---- 電源ソケット：弾が当たる／吸収アームで電気を送ると、シャッターが開く（1階の電源と同じ）
  getSockets(world).push({
    pos: lab.socket.pos.clone(), radius: 0.7, enabled: true,
    onShot: () => power(world, rt, 'shot'),
    onFeed: () => power(world, rt, 'arm'),
  });

  // ---- 車（車担当が見た目を作る）。まだ無い間は null
  initDrive(world, { x: GARAGE.carX, z: GARAGE.carZ, yaw: 0 });
  lab.carCollider.active = !!driveOf(world);

  // ---- 開始地点
  if (startAt === 'drive') {
    // 車に乗った状態から（リトライ）。シャッターは開いている
    setOpen(rt, 1);
    state.powered = true;
    state.open = 1;
    for (const s of getSockets(world)) s.enabled = false;
    setSocketLook(rt, true);
    world.player.pos.set(GARAGE.carX, 0, GARAGE.carZ);
    world.player.yaw = 0;
    rt.autoBoard = true;
    world.level.data.objective = '西へ！ 判定地点まで 300km/h 以上を出せ';
  } else {
    world.player.pos.set(STAIRS.topX, STAIRS.topY + 0.05, STAIRS.topZ);
    world.player.yaw = 0;
    world.player.pitch = -0.28;   // 階段が見えるように少し見下ろす（正が上向き）
  }
  if (startAt === 'drive') world.player.pitch = 0;
  world.player.vel.set(0, 0, 0);
}

// ---------------------------------------------------------------- シャッター・電源
function setOpen(rt: Runtime, k: number): void {
  const s = rt.lab.shutter;
  const e = k * k * (3 - 2 * k);
  s.pivot.scale.y = Math.max(0.04, 1 - e * 0.96);
  s.pivot.visible = k < 0.999;
  s.collider.min.y = e * GARAGE.shutterH * 0.96;
  s.collider.active = k < 0.85;
}

function setSocketLook(rt: Runtime, on: boolean): void {
  const c = on ? 0x4cff8a : 0x52e8ff;
  rt.lab.socket.ringMat.color.set(c).multiplyScalar(1.6);
  rt.lab.socket.lampMat.color.set(on ? 0x3dff7a : 0xe0503c).multiplyScalar(1.6);
  rt.lab.shutter.lampMat.color.set(on ? 0x3dff7a : 0xe0503c).multiplyScalar(1.8);
}

function power(world: World, rt: Runtime, via: 'shot' | 'arm'): void {
  const st = rt.state;
  if (st.powered) return;
  if (via === 'arm') {
    if (world.player.energy < 1) { toast(world, 'エネルギーが足りない…', 2.5); world.events.emit('noEnergy', {}); return; }
    drainEnergy(world, 1);
  }
  st.powered = true;
  st.via = via;
  for (const s of getSockets(world)) s.enabled = false;
  setSocketLook(rt, true);
  toast(world, 'シャッターに電力が届いた', 3.5);
  world.events.emit('switchOn', { pos: rt.lab.socket.pos.clone() });
  world.level.data.objective = '車に乗って収容所へ向かえ';
}

// ---------------------------------------------------------------- 更新
const _tmp = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(), _fw = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function updateSurge(world: World, dt: number): void {
  const rt = runtimes.get(world);
  if (!rt) return;
  const { state, lab } = rt;
  const p = world.player;
  const input = world.input;
  rt.clock += dt;
  const t = rt.clock;

  // ---- 'drive' 開始：最初のフレームで乗る
  if (rt.autoBoard) {
    rt.autoBoard = false;
    boardCar(world, rt);
  }

  // ---- シャッター：電力が届いたら巻き上がる
  if (state.powered && state.open < 1) {
    const before = state.open;
    state.open = Math.min(1, state.open + dt / SHUTTER_TIME);
    if (before === 0 && !rt.doorEmitted) {
      rt.doorEmitted = true;
      world.events.emit('doorOpen', { pos: new THREE.Vector3(0, GARAGE.shutterH / 2, GARAGE.shutterZ) });
    }
    setOpen(rt, state.open);
  }
  // 光る物のゆらぎ
  lab.pulse.color.setScalar(1.0 + 0.5 * Math.sin(t * 4));
  if (!state.powered) lab.socket.ringMat.color.set(0x52e8ff).multiplyScalar(1.3 + 0.6 * Math.sin(t * 5));

  // ---- 車に乗る／ヒント
  const drive = driveOf(world);
  const driving = !!drive && drive.phase !== 'parked';
  const carX = drive && !driving ? drive.pos.x : GARAGE.carX;
  const carZ = drive && !driving ? drive.pos.z : GARAGE.carZ;
  lab.carCollider.active = !!drive && !driving;
  const inGarage = p.pos.x > GARAGE.x0 && p.pos.x < GARAGE.x1 && p.pos.z > GARAGE.z0 - 4 && p.pos.z < GARAGE.z1 && p.pos.y < 3;
  const dCar = Math.hypot(p.pos.x - carX, p.pos.z - carZ);
  const dSock = Math.hypot(p.pos.x - lab.socket.pos.x, p.pos.z - lab.socket.pos.z);
  let hint: string | null = null;
  state.nearCar = false;
  if (!state.boarded && !driving && p.hp > 0 && inGarage) {
    if (state.open >= 0.9) {
      if (dCar < BOARD_REACH) { hint = 'Bボタン / Rキー：車に乗る'; state.nearCar = true; }
    } else if (!state.powered) {
      if (dSock < 4.5) hint = '撃つ / アームで電気を送る';
      else if (dCar < BOARD_REACH + 1) hint = 'シャッターの電源に電力を送ろう';
    }
  }
  world.level.data.interactNear = state.nearCar;
  if (hint) {
    showPrompt(hint);
    if (!rt.promptOn) world.events.emit('interactPrompt', {});
    rt.promptOn = true;
  } else if (rt.promptOn) {
    showPrompt(null);
    rt.promptOn = false;
  }
  if (state.nearCar && (input.pressed('PadB') || input.pressed('KeyR'))) boardCar(world, rt);

  // 現在の区画（ミニマップ）
  world.level.currentRoom = p.pos.z > GARAGE.z1 ? 0 : p.pos.z > GARAGE.z0 ? 1 : 2;

  // ---- 運転・演出（車担当）
  updateDrive(world, dt);

  // ---- 収容所のサーチライトなど
  rt.comp.update(t);

  // ---- 太陽の影：車（運転中）かプレイヤーを追う。シャドウマップの 1 マスぶんの単位で動かして、ちらつきを防ぐ
  const d2 = driveOf(world);
  const follow = d2 && d2.phase !== 'parked' ? d2.pos : p.pos;
  const sun = rt.sun;
  _fw.copy(SUN_DIR).negate();                        // 光の進む向き
  _right.crossVectors(WORLD_UP, _fw).normalize();
  _up.crossVectors(_fw, _right).normalize();
  const texel = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
  const a = Math.round(follow.dot(_right) / texel) * texel, b = Math.round(follow.dot(_up) / texel) * texel;
  const c = follow.dot(_fw);
  _tmp.set(0, 0, 0).addScaledVector(_right, a).addScaledVector(_up, b).addScaledVector(_fw, c);
  sun.target.position.copy(_tmp);
  sun.position.copy(_tmp).addScaledVector(SUN_DIR, 150);
  sun.target.updateMatrixWorld();

  // ---- 空はカメラに追従
  rt.city.sky.position.copy(world.camera.position);
}

function boardCar(world: World, rt: Runtime): void {
  if (rt.state.boarded) return;
  rt.state.boarded = true;
  showPrompt(null);
  rt.promptOn = false;
  world.level.data.retryAt = 'drive';
  world.level.data.objective = '西へ！ 判定地点まで 300km/h 以上を出せ';
  startDrive(world);
}
