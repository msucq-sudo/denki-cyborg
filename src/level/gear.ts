// 強化素材「歯車」の3Dモデル。金色の太い歯車＋シアンに光る芯＋やわらかい光とキラキラ
import * as THREE from 'three';

export interface GearModel extends THREE.Group {
  /** 毎フレーム呼ぶ（回転・上下・きらめき）。t は経過秒 */
  tick(t: number): void;
}

function glowTexture(): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,240,170,0.95)');
  gr.addColorStop(0.25, 'rgba(120,240,255,0.45)');
  gr.addColorStop(1, 'rgba(120,240,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function starTexture(): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.translate(32, 32);
  g.fillStyle = '#fff';
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, r = i % 2 ? 4 : 30;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let sharedGlow: THREE.Texture | undefined;
let sharedStar: THREE.Texture | undefined;

/** 歯の付いた輪の形 */
function cogShape(teeth: number, rOut: number, rIn: number, rHole: number): THREE.Shape {
  const s = new THREE.Shape();
  const n = teeth * 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = (i % 4) < 2 ? rOut : rIn; // 0,1=歯の先 / 2,3=谷
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, rHole, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return s;
}

export function createGearModel(): GearModel {
  const g = new THREE.Group() as GearModel;
  g.name = 'gear';
  const spin = new THREE.Group();
  g.add(spin);

  const brass = new THREE.MeshStandardMaterial({ color: 0xf2b630, metalness: 0.75, roughness: 0.32, emissive: 0x5a3a00, emissiveIntensity: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0xb87a18, metalness: 0.7, roughness: 0.45, emissive: 0x2a1800, emissiveIntensity: 0.5 });
  const core = new THREE.MeshBasicMaterial({ color: 0x6af4ff });

  // 歯車本体（ぶ厚い）
  const body = new THREE.ExtrudeGeometry(cogShape(10, 0.62, 0.48, 0.2), {
    depth: 0.28, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.045, bevelSegments: 2, curveSegments: 6,
  });
  body.translate(0, 0, -0.14);
  spin.add(new THREE.Mesh(body, brass));
  // 内側のリング
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.045, 8, 28), dark);
  ring.position.z = 0.2;
  const ring2 = ring.clone(); ring2.position.z = -0.2;
  spin.add(ring, ring2);
  // 光る芯
  spin.add(new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), core));
  const coreCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 12), core);
  coreCyl.rotation.x = Math.PI / 2;
  spin.add(coreCyl);

  // やわらかい光
  sharedGlow ??= glowTexture();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    ...(sharedGlow ? { map: sharedGlow } : {}), color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  halo.scale.setScalar(4.2);
  g.add(halo);

  // きらめき
  sharedStar ??= starTexture();
  const stars: THREE.Sprite[] = [];
  for (let i = 0; i < 4; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      ...(sharedStar ? { map: sharedStar } : {}), color: i % 2 ? 0x9ffaff : 0xfff2b0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    g.add(sp);
    stars.push(sp);
  }

  // 遠くからでも見える細い光の柱
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.5, 9, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x7cf6ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
  );
  beam.position.y = 4.4;
  g.add(beam);

  g.tick = (t: number) => {
    spin.rotation.y = t * 1.6;
    spin.rotation.z = Math.sin(t * 0.9) * 0.18;
    spin.position.y = Math.sin(t * 2.1) * 0.12;
    (halo.material as THREE.SpriteMaterial).opacity = 0.7 + Math.sin(t * 3.1) * 0.2;
    stars.forEach((s, i) => {
      const k = (t * 0.7 + i * 0.25) % 1;
      const a = i * 1.9 + t * 0.6;
      s.position.set(Math.cos(a) * (0.5 + 0.4 * k), 0.15 + k * 0.9 - 0.3, Math.sin(a) * (0.5 + 0.4 * k));
      s.scale.setScalar(0.5 * Math.sin(k * Math.PI));
    });
  };
  g.tick(0);
  return g;
}
