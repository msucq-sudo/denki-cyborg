// 必殺技の光：溜めの球（白い芯＋シアンの光・ほとばしる電気・吸い寄せられる粒）とビーム（手元から噴き出して広がる光の束）。
// すべて加算合成。1回の必殺技ごとに作り、終わったら dispose する。
import * as THREE from 'three';
import { SPECIAL } from '../config/balance';

let glowTex: THREE.Texture | null | undefined;
function glowTexture(): THREE.Texture | null {
  if (glowTex !== undefined) return glowTex;
  if (typeof document === 'undefined') return (glowTex = null);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) return (glowTex = null);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return (glowTex = new THREE.CanvasTexture(c));
}

let streakTex: THREE.Texture | null | undefined;
/** 縦（光の進む向き）に伸びるすじの模様。横方向は円周 */
function streakTexture(): THREE.Texture | null {
  if (streakTex !== undefined) return streakTex;
  if (typeof document === 'undefined') return (streakTex = null);
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g) return (streakTex = null);
  g.fillStyle = '#5a6a70';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 150; i++) {
    const x = Math.random() * W, w = 0.6 + Math.random() * 3.2;
    const y0 = Math.random() * H, len = 40 + Math.random() * 200;
    const a = 0.25 + Math.random() * 0.75;
    const gr = g.createLinearGradient(0, y0, 0, y0 + len);
    gr.addColorStop(0, `rgba(255,255,255,0)`);
    gr.addColorStop(0.5, `rgba(255,255,255,${a})`);
    gr.addColorStop(1, `rgba(255,255,255,0)`);
    g.fillStyle = gr;
    g.fillRect(x, y0, w, len);
    if (y0 + len > H) g.fillRect(x, y0 - H, w, len);   // 継ぎ目なくつなぐ
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  return (streakTex = t);
}

const add = (map: THREE.Texture | null, color: number, opacity = 1, depthTest = true): THREE.SpriteMaterial =>
  new THREE.SpriteMaterial({ map, color, transparent: true, opacity, depthWrite: false, depthTest, blending: THREE.AdditiveBlending, toneMapped: false });

const ARCS = 7, ARC_PTS = 9, SUCK = 48, DEBRIS = 220;

export class SpecialVfx {
  readonly group = new THREE.Group();
  private ball = new THREE.Group();
  private core: THREE.Mesh;
  private halos: THREE.Sprite[] = [];
  private arcs: THREE.Line[] = [];
  private suck: THREE.Points;
  private suckData: { dir: THREE.Vector3; r: number; sp: number }[] = [];
  private ballLight = new THREE.PointLight(0x6fe6ff, 0, 6, 2);
  private ballK = 0;
  private ballR = 0.1;

  private beam = new THREE.Group();
  private layers: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; base: number }[] = [];
  private flare: THREE.Sprite[] = [];
  private beamLight = new THREE.PointLight(0x7feaff, 0, 16, 2);
  private debris: THREE.Points;
  private debrisData: { ang: number; frac: number; z: number; sp: number }[] = [];
  private beamOn = false;
  private beamAge = 0;
  private beamFade = 1;
  private beamLen = 40;
  private beamTip = SPECIAL.beamTip;
  private streak = streakTexture();
  private disposed = false;
  private time = 0;

  constructor(private scene: THREE.Scene) {
    const tex = glowTexture();
    // ---- 球
    this.core = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    this.ball.add(this.core);
    const h = (color: number, op: number, depthTest: boolean): THREE.Sprite => {
      const s = new THREE.Sprite(add(tex, color, op, depthTest));
      s.renderOrder = 20;
      this.halos.push(s);
      this.ball.add(s);
      return s;
    };
    h(0xffffff, 0.55, true);         // 白く焼けた芯のにじみ
    h(0x8fefff, 0.6, false);     // シアンの光（指の間・指の向こうへあふれる）
    h(0x1f8bff, 0.32, false);     // 外側の青
    for (let i = 0; i < ARCS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_PTS * 3), 3));
      const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xd8ffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      l.frustumCulled = false;
      this.arcs.push(l);
      this.ball.add(l);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SUCK * 3), 3));
    this.suck = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xbff6ff, size: 0.07, map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.suck.frustumCulled = false;
    for (let i = 0; i < SUCK; i++) this.suckData.push({ dir: new THREE.Vector3().randomDirection(), r: Math.random(), sp: 0.7 + Math.random() * 0.9 });
    this.ball.add(this.suck, this.ballLight);
    this.ball.visible = false;
    this.group.add(this.ball);

    // ---- ビーム（ローカル +Z が進む向き）
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DEBRIS * 3), 3));
    this.debris = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xdfffff, size: 0.2, map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.debris.frustumCulled = false;
    for (let i = 0; i < DEBRIS; i++) this.debrisData.push({ ang: Math.random() * Math.PI * 2, frac: Math.sqrt(Math.random()), z: Math.random() * 30, sp: 30 + Math.random() * 70 });
    this.beam.add(this.debris);
    const fl = (color: number, op: number): THREE.Sprite => {
      const s = new THREE.Sprite(add(tex, color, op, false));
      s.renderOrder = 22;
      this.flare.push(s);
      this.beam.add(s);
      return s;
    };
    fl(0x2a9bff, 0.8); fl(0x9ff4ff, 0.95); fl(0xffffff, 1);
    this.beam.add(this.beamLight);
    this.beam.visible = false;
    this.group.add(this.beam);
    scene.add(this.group);
  }

  /** 溜めの球：pos=ワールド位置、k=0..1 の大きさ（0 で消す）、palm=手のひらの間の広がり */
  setBall(pos: THREE.Vector3, k: number): void {
    this.ball.position.copy(pos);
    this.ballK = k;
    this.ball.visible = k > 0.001;
    this.ballR = 0.04 + (SPECIAL.ballMax - 0.04) * Math.pow(k, 0.8);
  }

  /** ビーム発射：origin=手元、dir=向き、len=長さ、radius=強化で決まる太さの目安（先端の太さに反映） */
  fireBeam(origin: THREE.Vector3, dir: THREE.Vector3, len: number, radius: number): void {
    this.beamOn = true;
    this.beamAge = 0;
    this.beamFade = 1;
    this.beamLen = len;
    this.beamTip = SPECIAL.beamTip * (radius / SPECIAL.beamRadius);
    this.beam.position.copy(origin);
    this.beam.lookAt(origin.clone().add(dir));
    for (const l of this.layers) { this.beam.remove(l.mesh); l.mesh.geometry.dispose(); l.mat.dispose(); }
    this.layers = [];
    // 外側（青・太い）→ 中（シアン）→ 芯（白・細い）。手元で細く、先で大きく広がる
    for (const [scale, color, op, useMap] of [[1, 0x2a8cff, 0.5, true], [0.64, 0x7feaff, 0.7, true], [0.3, 0xffffff, 0.85, false]] as const) {
      const geo = new THREE.CylinderGeometry(this.beamTip * scale, SPECIAL.beamBase * scale, len, 28, 1, true);
      geo.translate(0, len / 2, 0);
      geo.rotateX(Math.PI / 2);
      // 根元は明るく、先へ向かって薄れる
      const col = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i < geo.attributes.position.count; i++) {
        const k = THREE.MathUtils.clamp(geo.attributes.position.getZ(i) / len, 0, 1);
        const v = 1 - 0.8 * k;
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mat = new THREE.MeshBasicMaterial({
        color, map: useMap ? this.streak : null, transparent: true, opacity: op, side: THREE.DoubleSide, vertexColors: true,
        depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 18;
      this.beam.add(mesh);
      this.layers.push({ mesh, mat, base: op });
    }
    this.beam.visible = true;
    this.ball.visible = false;
  }

  /** ビームの根元と向きを更新（手の動きに追従） */
  setBeamOrigin(origin: THREE.Vector3, dir: THREE.Vector3): void {
    this.beam.position.copy(origin);
    this.beam.lookAt(origin.x + dir.x, origin.y + dir.y, origin.z + dir.z);
  }

  /** ビームの薄れ具合（1=そのまま、0=消える） */
  setBeamFade(a: number): void { this.beamFade = Math.max(0, Math.min(1, a)); }

  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    const t = this.time;
    if (this.ball.visible) this.updateBall(dt, t);
    if (this.beamOn) this.updateBeam(dt, t);
  }

  private updateBall(dt: number, t: number): void {
    const r = this.ballR, k = this.ballK;
    const jit = 1 + Math.sin(t * 63) * 0.07 + (Math.random() - 0.5) * 0.1;
    this.core.scale.setScalar(r * 0.45 * jit);
    this.halos[0].scale.setScalar(r * 1.9 * jit);
    this.halos[1].scale.setScalar(r * 5.2 * (0.92 + 0.08 * Math.sin(t * 31)));
    this.halos[2].scale.setScalar(r * 9.5 * (0.9 + 0.1 * Math.sin(t * 17)));
    this.ballLight.intensity = (0.3 + 1.3 * k) * jit;
    // ほとばしる電気：中心から外へジグザグ
    for (const l of this.arcs) {
      const on = Math.random() < 0.35 + 0.5 * k;
      l.visible = on;
      if (!on || Math.random() < 0.6) continue;
      const pos = l.geometry.attributes.position as THREE.BufferAttribute;
      const dir = new THREE.Vector3().randomDirection();
      const len = r * (2 + Math.random() * 3.2);
      const p = new THREE.Vector3();
      for (let i = 0; i < ARC_PTS; i++) {
        const f = i / (ARC_PTS - 1);
        p.copy(dir).multiplyScalar(len * f).add(new THREE.Vector3((Math.random() - 0.5) * r * 0.6, (Math.random() - 0.5) * r * 0.6, (Math.random() - 0.5) * r * 0.6).multiplyScalar(Math.sin(Math.PI * f)));
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;
    }
    // 吸い寄せられる粒：外から中心へ
    const sp = this.suck.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < SUCK; i++) {
      const d = this.suckData[i];
      d.r -= dt * d.sp * (0.8 + 1.4 * (1 - d.r));
      if (d.r <= 0.04) { d.r = 1; d.dir.randomDirection(); }
      const rad = r * (1 + 4.5 * d.r);
      sp.setXYZ(i, d.dir.x * rad, d.dir.y * rad, d.dir.z * rad);
    }
    sp.needsUpdate = true;
    (this.suck.material as THREE.PointsMaterial).size = 0.04 + 0.06 * k;
  }

  private updateBeam(dt: number, t: number): void {
    this.beamAge += dt;
    const age = this.beamAge;
    // 噴き出し：細く短い状態から一気に広がる
    const g = Math.min(1, age / 0.16);
    const grow = 1 - Math.pow(1 - g, 3);
    const flick = 1 + 0.07 * Math.sin(t * 72) + (Math.random() - 0.5) * 0.08;
    const w = (0.12 + 0.88 * grow) * flick * (0.55 + 0.45 * this.beamFade);
    this.beam.scale.set(w, w, 0.25 + 0.75 * grow);
    for (const l of this.layers) {
      l.mat.opacity = l.base * this.beamFade * (0.85 + 0.15 * Math.sin(t * 55 + l.base * 9));
      if (l.mat.map) l.mat.map.offset.y -= dt * (2.6 + l.base * 2) * 1.6;
    }
    // 手元の大きな光：噴き出しの瞬間が最大
    const burst = Math.max(0, 1 - age / 0.5);
    const big = (1.2 + 4.2 * burst) * (0.5 + 0.5 * this.beamFade);
    const sc = [4.2, 2.6, 1.3];
    this.flare.forEach((s, i) => {
      s.scale.setScalar(big * sc[i] / 3 * (0.92 + 0.08 * Math.sin(t * 40 + i)));
      (s.material as THREE.SpriteMaterial).opacity = Math.min(1, this.beamFade * 1.2) * (i === 2 ? 1 : 0.9);
    });
    this.beamLight.intensity = (8 + 22 * burst) * this.beamFade * flick;
    this.beamLight.position.z = 2;
    // 火花・光のつぶ：ビームの中を高速で流れる
    const pos = this.debris.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < DEBRIS; i++) {
      const d = this.debrisData[i];
      d.z += d.sp * dt;
      if (d.z > this.beamLen) { d.z = Math.random() * 2; d.ang = Math.random() * Math.PI * 2; d.frac = Math.sqrt(Math.random()); d.sp = 30 + Math.random() * 70; }
      const rad = (SPECIAL.beamBase + (this.beamTip - SPECIAL.beamBase) * (d.z / this.beamLen)) * d.frac * 1.05;
      pos.setXYZ(i, Math.cos(d.ang) * rad, Math.sin(d.ang) * rad, d.z);
    }
    pos.needsUpdate = true;
    (this.debris.material as THREE.PointsMaterial).opacity = this.beamFade;
    (this.debris.material as THREE.PointsMaterial).size = 0.16 + 0.1 * Math.random();
    if (this.beamFade <= 0.001) { this.beamOn = false; this.beam.visible = false; this.beamLight.intensity = 0; }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh | THREE.Line | THREE.Points | THREE.Sprite;
      (m as THREE.Mesh).geometry?.dispose?.();
      const mat = (m as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
    });
    this.ballLight.dispose?.();
    this.beamLight.dispose?.();
  }
}
