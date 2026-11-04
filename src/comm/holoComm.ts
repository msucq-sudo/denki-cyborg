// スパークとの通信：ビュー（Back/Select）ボタン、キーボードは J でホログラムを呼ぶ。
// ホログラムはプレイヤーの右斜め前に付いてくる。閉じ込め戦・敵が近い・被弾直後は呼べない（commLogic.ts）。
import * as THREE from 'three';
import type { World } from '../core/types';
import type { EventBus } from '../core/events';
import { createSpark, type Spark } from '../characters/spark';
import { isDormant } from '../enemies/dormant';
import { COMM_BLOCK_LINES, COMM_ENEMY_RANGE, commBlockReason, faceYaw, holoTarget, type CommBlock } from './commLogic';

const SCALE = 0.92;
const APPEAR_SEC = 0.55;
const FOLLOW = 5;
const HOLO_COLOR = new THREE.Color(0x58d8ff);

const VERT = `
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vY = wp.y;
  vN = normalize(normalMatrix * normal);
  vec4 mv = viewMatrix * wp;
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform vec3 uColor; uniform float uK; uniform float uTime; uniform float uBase; uniform float uHeight;
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
  float scan = 0.65 + 0.35 * sin(vY * 95.0 - uTime * 6.0);
  float flick = 0.9 + 0.1 * sin(uTime * 37.0) * sin(uTime * 11.0);
  float h = clamp((vY - uBase) / uHeight, 0.0, 1.0);
  float reveal = step(h, uK * 1.15 - 0.075);              // 足元から立ち上がる
  float edge = smoothstep(0.0, 0.07, uK * 1.15 - 0.075 - h); // 立ち上がりの先端は明るく
  float a = (0.28 + fres * 0.65) * scan * flick * reveal;
  vec3 c = uColor * (0.8 + fres * 0.9) + vec3(0.55, 0.9, 1.0) * (1.0 - edge) * reveal;
  gl_FragColor = vec4(c, a);
}`;

/** Spark のメッシュをホログラム材質（水色・走査線・縁取り）に差し替える。元の色を少し残して髪や目の判別を保つ */
interface HoloUniforms { uK: { value: number }; uTime: { value: number }; uBase: { value: number } }

function holofy(root: THREE.Object3D, uniformsOut: HoloUniforms[]): void {
  const cache = new Map<number, THREE.ShaderMaterial>();
  const matFor = (orig: THREE.Material): THREE.ShaderMaterial => {
    const col = (orig as THREE.MeshBasicMaterial).color as THREE.Color | undefined;
    const key = col ? col.getHex() : 0;
    let m = cache.get(key);
    if (!m) {
      const tint = HOLO_COLOR.clone();
      if (col) tint.lerp(col, 0.3);
      const uK = { value: 0 }, uTime = { value: 0 }, uBase = { value: 0 };
      m = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: { uColor: { value: tint }, uK, uTime, uBase, uHeight: { value: 1.8 * SCALE } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      cache.set(key, m);
      uniformsOut.push({ uK, uTime, uBase });
    }
    return m;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const orig = mesh.material as THREE.Material;
    if ((orig as THREE.MeshBasicMaterial).side === THREE.BackSide) { mesh.visible = false; return; } // アウトラインは消す
    mesh.material = matFor(orig);
  });
}

type Phase = 'closed' | 'opening' | 'open' | 'closing';

export interface HoloComm {
  /** 毎フレーム呼ぶ（playing 中）。呼び出しボタンの処理もここ */
  update(world: World, dt: number): void;
  /** 今ホログラムが出ているか（会話の入り口の判定用） */
  readonly active: boolean;
}

export function createHoloComm(events: EventBus): HoloComm {
  let lockdown = 0;
  let sinceHit = 99;
  events.on('lockdownStart', () => { lockdown++; });
  events.on('lockdownEnd', () => { lockdown = Math.max(0, lockdown - 1); });
  events.on('playerHit', () => { sinceHit = 0; });

  let spark: Spark | null = null;
  let scene: THREE.Scene | null = null;
  let uniforms: HoloUniforms[] = [];
  let phase: Phase = 'closed';
  let k = 0;
  let time = 0;
  let side = 1;
  let lastBlockSaid = -99;
  let lastWorld: World | null = null;
  const cur = new THREE.Vector3();

  const ensure = (world: World): Spark => {
    if (spark && scene === world.scene && spark.root.parent === world.scene) return spark;
    if (spark) spark.dispose();
    spark = createSpark({ glasses: true });
    spark.setTablet(false);
    spark.setPose('talk');
    spark.setSpeaking(true);
    uniforms = [];
    holofy(spark.root, uniforms);
    spark.root.scale.setScalar(SCALE);
    spark.root.visible = false;
    world.scene.add(spark.root);
    scene = world.scene;
    return spark;
  };

  const hostileNear = (world: World): boolean => {
    const p = world.player.pos;
    for (const e of world.enemies) {
      if (e.status !== 'active' || e.allied || isDormant(e)) continue;
      if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < COMM_ENEMY_RANGE && Math.abs(e.pos.y - p.y) < 14) return true;
    }
    return false;
  };

  const block = (world: World): CommBlock | null =>
    commBlockReason({
      lockdown: lockdown > 0,
      hostileNear: hostileNear(world),
      sinceHit,
      busy: world.input.locked || world.special.phase !== 'idle' || !!world.player.hacking || !!world.player.leeched,
    });

  /** 壁の中に立たないよう、右→左→プレイヤーの横の順で空いている位置を選ぶ */
  const pickSpot = (world: World): { x: number; y: number; z: number } => {
    const p = world.player;
    for (const s of [side, -side]) {
      const t = holoTarget(p.pos.x, p.pos.y, p.pos.z, p.yaw, s);
      const inWall = world.colliders.some((c) => c.active && !c.seeThrough
        && t.x > c.min.x && t.x < c.max.x && t.z > c.min.z && t.z < c.max.z && p.pos.y + 1 > c.min.y && p.pos.y + 1 < c.max.y);
      if (!inWall) { side = s; return t; }
    }
    return holoTarget(p.pos.x, p.pos.y, p.pos.z, p.yaw, side, 0.2, 0.9);
  };

  const say = (text: string): void => events.emit('comm', { speaker: 'スパーク', text });

  return {
    get active() { return phase === 'open' || phase === 'opening'; },
    update(world, dt) {
      time += dt;
      sinceHit += dt;
      if (lastWorld !== world) { lastWorld = world; lockdown = 0; sinceHit = 99; phase = 'closed'; k = 0; spark = null; scene = null; }
      const s = ensure(world);

      const call = world.input.pressed('Comm') || world.input.pressed('KeyJ');
      const why = block(world);
      if (call) {
        if (phase === 'open' || phase === 'opening') phase = 'closing';
        else if (why === null) {
          phase = 'opening';
          const t = pickSpot(world);
          cur.set(t.x, t.y, t.z);
          s.root.position.copy(cur);
          say('ライアン、聞こえる？ こっちは大丈夫。何かあったら言ってね。');
        } else if (why !== 'busy' && time - lastBlockSaid > 1.5) {
          lastBlockSaid = time;
          say(COMM_BLOCK_LINES[why]);
        }
      } else if ((phase === 'open' || phase === 'opening') && why !== null && why !== 'busy') {
        // 通信中に襲われた：スパークが一言残して消える
        phase = 'closing';
        say(COMM_BLOCK_LINES[why]);
      }

      if (phase === 'opening') { k = Math.min(1, k + dt / APPEAR_SEC); if (k >= 1) phase = 'open'; }
      else if (phase === 'closing') { k = Math.max(0, k - dt / (APPEAR_SEC * 0.6)); if (k <= 0) phase = 'closed'; }

      s.root.visible = phase !== 'closed';
      if (phase === 'closed') return;

      const p = world.player;
      const t = pickSpot(world);
      const f = 1 - Math.exp(-FOLLOW * dt);
      cur.x += (t.x - cur.x) * f; cur.z += (t.z - cur.z) * f; cur.y += (t.y - cur.y) * f;
      const bob = Math.sin(time * 2.2) * 0.04;
      s.root.position.set(cur.x, cur.y + bob, cur.z);
      s.root.rotation.y = faceYaw(cur.x, cur.z, p.pos.x, p.pos.z);
      s.update(dt);
      for (const u of uniforms) { u.uK.value = k; u.uTime.value = time; u.uBase.value = cur.y; }
    },
  };
}
