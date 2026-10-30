// 演出の確認用の簡易ステージ（テストと tests/e2e/cutscene_check.mjs 用。本編では使わない）。
// ステージ担当の本物が出来ていないときに、道・街・柵・壁・ライトだけを置いて演出を単体で見られるようにする。
import * as THREE from 'three';
import type { World } from '../core/types';
import { COMPOUND, ROAD } from '../level/surge/layout';
import { buildStandInCompound } from './stage';
import type { SurgeStage } from './stage';

/** 簡易の火星の街と、道・柵・壁・建物を scene に置き、world.level.data.surge に登録する */
export function buildDemoStage(world: World): SurgeStage {
  const scene = world.scene;
  const zc = ROAD.junctionZ;
  scene.background = new THREE.Color(0xc98a66);
  scene.fog = new THREE.Fog(0xc98a66, 120, 1400);
  scene.add(new THREE.HemisphereLight(0xffd8b0, 0x5a3a30, 1.1));
  const sun = new THREE.DirectionalLight(0xffe2c0, 2.2);
  sun.position.set(300, 400, 200);
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 1200), new THREE.MeshStandardMaterial({ color: 0x6b4a3c, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-900, -0.02, zc);
  scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(1800, ROAD.width), new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.8 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(-800, 0, zc);
  scene.add(road);
  // 中央線
  const line = new THREE.Mesh(new THREE.PlaneGeometry(1800, 0.25), new THREE.MeshBasicMaterial({ color: 0xffd060 }));
  line.rotation.x = -Math.PI / 2;
  line.position.set(-800, 0.01, zc);
  scene.add(line);

  // 道の両側のビル（疑似乱数で決め打ち）
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const bmat = [0x4a5568, 0x6b7280, 0x3b4252, 0x7a6a5a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
  for (let x = 200; x > COMPOUND.fenceX + 100; x -= 18 + rnd() * 14) {
    for (const s of [-1, 1]) {
      const w = 12 + rnd() * 14, h = 18 + rnd() * 80, d = 14 + rnd() * 20;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bmat[Math.floor(rnd() * bmat.length)]);
      b.position.set(x, h / 2, zc + s * (ROAD.width / 2 + 10 + d / 2 + rnd() * 12));
      scene.add(b);
    }
  }
  const made = buildStandInCompound();
  scene.add(made.group);
  const stage: SurgeStage = { fence: made.fence, fencePanels: made.panels, wall: made.wall, building: made.building };
  world.level.data.surge = stage;
  return stage;
}
