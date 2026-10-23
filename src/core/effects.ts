import * as THREE from 'three';
import type { EffectInstance, World } from './types';

const sparkGeo = new THREE.SphereGeometry(0.06, 6, 4);

/** 汎用の火花バースト */
export function spawnBurst(world: World, pos: THREE.Vector3, color: number, count = 8, speed = 3, life = 0.45): void {
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(pos);
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize()
      .multiplyScalar(speed * (0.4 + Math.random()));
    world.scene.add(m);
    addEffect(world, m, life * (0.6 + Math.random() * 0.6), (e, dt) => {
      e.obj.position.addScaledVector(v, dt);
      v.y -= 6 * dt;
      const k = e.life / e.maxLife;
      ((e.obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = k;
      e.obj.scale.setScalar(0.5 + k);
    });
  }
}

/** 広がって消える球（爆発・衝撃波） */
export function spawnShockwave(world: World, pos: THREE.Vector3, color: number, radius: number, life = 0.5): void {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }),
  );
  m.position.copy(pos);
  m.scale.setScalar(0.1);
  world.scene.add(m);
  addEffect(world, m, life, (e) => {
    const k = 1 - e.life / e.maxLife;
    e.obj.scale.setScalar(0.1 + radius * Math.sqrt(k));
    ((e.obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k);
  }, true);
}

/**
 * 一瞬の閃光。ライトの追加/削除はシェーダ再コンパイルで処理落ちするため、
 * 加算合成のスプライトで表現する（intensity/distance は大きさの目安）。
 */
let flashTex: THREE.Texture | null = null;
function getFlashTexture(): THREE.Texture | null {
  if (flashTex) return flashTex;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  flashTex = new THREE.CanvasTexture(c);
  return flashTex;
}
export function spawnFlash(world: World, pos: THREE.Vector3, color: number, intensity = 6, distance = 8, life = 0.15): void {
  const mat = new THREE.SpriteMaterial({
    map: getFlashTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const s = new THREE.Sprite(mat);
  s.position.copy(pos);
  const size = Math.max(1, distance * 0.35 + intensity * 0.1);
  s.scale.setScalar(size);
  world.scene.add(s);
  addEffect(world, s, Math.max(life, 0.12), (e) => {
    const k = e.life / e.maxLife;
    (s.material as THREE.SpriteMaterial).opacity = k;
    s.scale.setScalar(size * (1.3 - 0.3 * k));
  });
}

/** 任意オブジェクトを寿命付きエフェクトとして登録（寿命で scene から外され破棄） */
export function addEffect(world: World, obj: THREE.Object3D, life: number, update?: (e: EffectInstance, dt: number) => void, ownsGeometry = false): void {
  (obj as any).__ownsGeometry = ownsGeometry;
  world.effects.push({ obj, life, maxLife: life, update });
}

export function updateEffects(world: World, dt: number): void {
  for (let i = world.effects.length - 1; i >= 0; i--) {
    const e = world.effects[i];
    e.life -= dt;
    if (e.life <= 0) {
      world.scene.remove(e.obj);
      e.obj.traverse((c) => {
        const mesh = c as THREE.Mesh;
        const m = mesh.material as THREE.Material | undefined;
        m?.dispose?.();
        if ((e.obj as any).__ownsGeometry) mesh.geometry?.dispose?.();
      });
      world.effects.splice(i, 1);
      continue;
    }
    e.update?.(e, dt);
  }
}
