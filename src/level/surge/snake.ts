// 道路の外を歩いたときに、上から降ってきてプレイヤーを潰す大蛇。頭から落ちてきて、地面に叩きつけて止まる。
import * as THREE from 'three';

const SEGMENTS = 18;
/** 落ちはじめの頭の高さ (m) と、落ちきるまでの秒数 */
const START_H = 50;
const FALL_TIME = 0.55;

export interface CrushSnake {
  root: THREE.Group;
  /** 経過秒 */
  t: number;
  /** 地面に落ちた */
  landed: boolean;
  /** 落ちはじめにこの位置（xz）を追う。落ちる直前に固定 */
  x: number; z: number;
  groundY: number;
}

const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2f5d3a, roughness: 0.55, metalness: 0.1 });
const bellyMat = new THREE.MeshStandardMaterial({ color: 0xc7c079, roughness: 0.6 });
const stripeMat = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.7 });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd020 });

/** 蛇を作る（まだ scene に入れない）。root の原点は頭の先、-y 方向へ胴体が伸びる（頭が下・尾が上） */
export function buildSnake(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'crushSnake';
  // 頭（下に向けた楕円）
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10), bodyMat);
  head.scale.set(1, 1.25, 1.6);
  g.add(head);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), eyeMat);
    eye.position.set(sx * 0.95, 0.2, 1.2);
    g.add(eye);
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.1, 6), bellyMat);
    fang.position.set(sx * 0.5, -1.4, 1.5);
    fang.rotation.x = Math.PI;
    g.add(fang);
  }
  // 胴体：頭の上へ、ゆるいS字に細くなりながら伸びる
  for (let i = 1; i <= SEGMENTS; i++) {
    const k = i / SEGMENTS;
    const r = 1.35 * (1 - k * 0.65);
    const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), i % 3 === 0 ? stripeMat : bodyMat);
    seg.position.set(Math.sin(i * 0.7) * 1.6 * k * 2, i * 1.5 + 1.2, Math.cos(i * 0.55) * 1.2 * k * 2);
    g.add(seg);
  }
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), bellyMat);
  belly.position.set(0, -0.3, 1.1);
  g.add(belly);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return g;
}

export function spawnSnake(scene: THREE.Scene, x: number, z: number, groundY: number): CrushSnake {
  const root = buildSnake();
  root.position.set(x, groundY + START_H, z);
  scene.add(root);
  return { root, t: 0, landed: false, x, z, groundY };
}

/** 1ステップ進める。落ちきった瞬間に true を1回だけ返す */
export function stepSnake(s: CrushSnake, dt: number, follow?: { x: number; z: number }): boolean {
  if (s.landed) return false;
  s.t += dt;
  const u = Math.min(1, s.t / FALL_TIME);
  // 落ちる間、はじめは足元を追い、最後の 0.15 秒は固定（逃げ切れない）
  if (follow && u < 0.7) { s.x = follow.x; s.z = follow.z; }
  const h = START_H * (1 - u * u);
  s.root.position.set(s.x, s.groundY + h, s.z);
  if (u >= 1) { s.landed = true; return true; }
  return false;
}

export function disposeSnake(s: CrushSnake): void {
  s.root.removeFromParent();
  s.root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
  });
}
