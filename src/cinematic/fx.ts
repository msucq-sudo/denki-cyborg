// 演出専用のパーティクルと速度線。world.effects は実時間の dt で進むので、スローモーションに合わせて
// 演出側のスケール済み dt で進めるためにここで自前管理する。dispose で全部 scene から外して破棄する。
import * as THREE from 'three';

let glowTex: THREE.Texture | null | undefined;
function glowTexture(): THREE.Texture | null {
  if (glowTex !== undefined) return glowTex;
  if (typeof document === 'undefined') return (glowTex = null);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return (glowTex = null);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return (glowTex = new THREE.CanvasTexture(c));
}

type Kind = 'spark' | 'dust' | 'chunk' | 'flash';
interface Particle {
  kind: Kind;
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin?: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grow?: number;
}

const MAX_PARTICLES = 700;
const sparkGeo = new THREE.BoxGeometry(0.035, 0.035, 0.5);
const chunkGeo = new THREE.BoxGeometry(1, 1, 1);

export class Fx {
  readonly group = new THREE.Group();
  private list: Particle[] = [];
  private sparkMats = new Map<number, THREE.MeshBasicMaterial>();
  private chunkMat = new THREE.MeshStandardMaterial({ color: 0x9a8f80, roughness: 0.85, flatShading: true });
  private chunkMat2 = new THREE.MeshStandardMaterial({ color: 0x5d5750, roughness: 0.9, flatShading: true });
  private disposed = false;

  constructor(private scene: THREE.Scene) {
    scene.add(this.group);
  }

  get count(): number { return this.list.length; }

  private add(p: Particle): void {
    if (this.list.length >= MAX_PARTICLES) this.remove(0);
    this.group.add(p.obj);
    this.list.push(p);
  }

  private remove(i: number): void {
    const p = this.list[i];
    this.group.remove(p.obj);
    if (p.kind === 'dust' || p.kind === 'flash') ((p.obj as THREE.Sprite).material as THREE.Material).dispose();
    this.list.splice(i, 1);
  }

  private sparkMat(color: number): THREE.MeshBasicMaterial {
    let m = this.sparkMats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      this.sparkMats.set(color, m);
    }
    return m;
  }

  /** 火花。dir 方向に偏って飛び散る（dir 省略で全方向） */
  spark(pos: THREE.Vector3, count: number, speed: number, color = 0xffc866, dir?: THREE.Vector3, spread = 1): void {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(sparkGeo, this.sparkMat(color));
      m.position.copy(pos);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 - 0.1, Math.random() - 0.5).multiplyScalar(2 * spread);
      if (dir) v.addScaledVector(dir, 1.2);
      v.normalize().multiplyScalar(speed * (0.35 + Math.random() * 0.9));
      const life = 0.35 + Math.random() * 0.55;
      this.add({ kind: 'spark', obj: m, vel: v, life, max: life, size: 1 });
    }
  }

  /** 土煙・煙のふくらむ玉 */
  dust(pos: THREE.Vector3, count: number, radius: number, color = 0x9a8f80, rise = 1.2, life = 1.4): void {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.55, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * radius, Math.random() * 0.4, (Math.random() - 0.5) * radius));
      const size = 1.2 + Math.random() * 1.8;
      s.scale.setScalar(size);
      const v = new THREE.Vector3((Math.random() - 0.5) * 2.5, rise * (0.4 + Math.random()), (Math.random() - 0.5) * 2.5);
      const l = life * (0.7 + Math.random() * 0.6);
      this.add({ kind: 'dust', obj: s, vel: v, life: l, max: l, size, grow: 2.2 });
    }
  }

  /** 一瞬の閃光（加算合成の板） */
  flash(pos: THREE.Vector3, size: number, color = 0xfff0c0, life = 0.25): void {
    const mat = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.setScalar(size);
    this.add({ kind: 'flash', obj: s, vel: new THREE.Vector3(), life, max: life, size });
  }

  /** 破片（コンクリ・金属片）。重力で落ち、地面で跳ねる */
  chunks(pos: THREE.Vector3, count: number, speed: number, dir: THREE.Vector3, sizeMin = 0.12, sizeMax = 0.5, spread = 1): void {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(chunkGeo, Math.random() < 0.5 ? this.chunkMat : this.chunkMat2);
      const size = sizeMin + Math.random() * (sizeMax - sizeMin);
      m.scale.set(size, size * (0.5 + Math.random() * 0.7), size * (0.6 + Math.random() * 0.8));
      m.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 3));
      m.castShadow = false;
      const v = new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * 0.9 * spread, (Math.random() - 0.5) * spread)
        .addScaledVector(dir, 1.1).normalize().multiplyScalar(speed * (0.3 + Math.random() * 0.9));
      const spin = new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      const life = 1.6 + Math.random() * 1.6;
      this.add({ kind: 'chunk', obj: m, vel: v, spin, life, max: life, size });
    }
  }

  update(dt: number): void {
    if (this.disposed || dt <= 0) return;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) { this.remove(i); continue; }
      const k = p.life / p.max;
      switch (p.kind) {
        case 'spark': {
          p.vel.y -= 9 * dt;
          p.obj.position.addScaledVector(p.vel, dt);
          if (p.obj.position.y < 0.02) { p.obj.position.y = 0.02; p.vel.y *= -0.35; p.vel.x *= 0.7; p.vel.z *= 0.7; }
          const sp = p.vel.length();
          p.obj.lookAt(p.obj.position.x + p.vel.x, p.obj.position.y + p.vel.y, p.obj.position.z + p.vel.z);
          p.obj.scale.set(1, 1, Math.max(0.3, Math.min(3, sp * 0.12)) * (0.4 + 0.6 * k));
          break;
        }
        case 'dust': {
          p.obj.position.addScaledVector(p.vel, dt);
          p.vel.multiplyScalar(Math.exp(-1.6 * dt));
          const s = p.size * (1 + (p.grow ?? 1) * (1 - k));
          p.obj.scale.setScalar(s);
          ((p.obj as THREE.Sprite).material as THREE.SpriteMaterial).opacity = 0.55 * k;
          break;
        }
        case 'flash': {
          p.obj.scale.setScalar(p.size * (1.4 - 0.4 * k));
          ((p.obj as THREE.Sprite).material as THREE.SpriteMaterial).opacity = k;
          break;
        }
        case 'chunk': {
          p.vel.y -= 14 * dt;
          p.obj.position.addScaledVector(p.vel, dt);
          const r = p.obj.scale.y * 0.5;
          if (p.obj.position.y < r) {
            p.obj.position.y = r;
            p.vel.y = Math.abs(p.vel.y) * 0.3;
            p.vel.x *= 0.6; p.vel.z *= 0.6;
            p.spin?.multiplyScalar(0.5);
          }
          if (p.spin) {
            p.obj.rotation.x += p.spin.x * dt;
            p.obj.rotation.y += p.spin.y * dt;
            p.obj.rotation.z += p.spin.z * dt;
          }
          break;
        }
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    while (this.list.length) this.remove(this.list.length - 1);
    this.scene.remove(this.group);
    for (const m of this.sparkMats.values()) m.dispose();
    this.chunkMat.dispose();
    this.chunkMat2.dispose();
  }
}

/** 速度線：細長い光の筋を道沿いに撒く。カメラが追い越すほど速く流れて見える。 */
export class SpeedLines {
  readonly mesh: THREE.InstancedMesh;
  private pos: THREE.Vector3[] = [];
  private mat: THREE.MeshBasicMaterial;
  private quat = new THREE.Quaternion();
  private m4 = new THREE.Matrix4();
  private one = new THREE.Vector3(1, 1, 1);
  private len = 9;

  constructor(private scene: THREE.Scene, private n = 90) {
    const geo = new THREE.BoxGeometry(0.03, 0.03, this.len);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xdff3ff, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, n);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < n; i++) this.pos.push(new THREE.Vector3(1e6, 0, 0));
    scene.add(this.mesh);
  }

  /** dir=進行方向（水平の単位ベクトル）、center=カメラ付近の基準、opacity=0 なら見えない */
  update(center: THREE.Vector3, dir: THREE.Vector3, opacity: number): void {
    this.mat.opacity = opacity;
    if (opacity <= 0.001) return;
    this.quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    let dirty = false;
    for (let i = 0; i < this.n; i++) {
      const p = this.pos[i];
      const rel = p.clone().sub(center);
      const along = rel.dot(dir);
      if (along < -30 || along > 160 || Math.abs(rel.y) > 40) {
        const a = 40 + Math.random() * 110;
        const lat = (Math.random() < 0.5 ? -1 : 1) * (1.6 + Math.random() * 12);
        p.copy(center).addScaledVector(dir, a).addScaledVector(side, lat);
        p.y = 0.2 + Math.random() * 5.5;
        this.m4.compose(p, this.quat, this.one);
        this.mesh.setMatrixAt(i, this.m4);
        dirty = true;
      }
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
