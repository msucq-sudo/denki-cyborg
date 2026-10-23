import * as THREE from 'three';
import { CAMERA, PLAYER } from '../config/balance';
import type { World } from './types';
import type { Input } from './input';
import type { EventBus } from './events';

/** 空のワールドを作る。中身（ステージ・プレイヤー見た目）は各モジュールが追加する */
export function createWorld(input: Input, events: EventBus, aspect: number): World {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, 0.05, 400);
  const world: World = {
    scene, camera,
    state: 'title',
    time: 0,
    input, events,
    player: {
      root: new THREE.Group(),
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      yaw: 0, pitch: 0,
      hp: PLAYER.maxHp, maxHp: PLAYER.maxHp,
      energy: PLAYER.startEnergy, maxEnergy: PLAYER.maxEnergy,
      onGround: false,
      invuln: 0,
      dodgeTimer: 0, dodgeCooldown: 0, dodgeDir: new THREE.Vector3(),
      fireHold: 0, fireCooldown: 0,
      charging: false, charge: 0, chargeSpent: 0,
      flying: false,
      absorbing: false, overloading: false,
    },
    enemies: [],
    projectiles: [],
    colliders: [],
    level: { rooms: [], currentRoom: -1, bossSpawned: false, bossDefeated: false, data: {} },
    absorb: {
      phase: 'idle', tip: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), length: 0,
      target: null, cooldown: 0, totalAbsorbed: 0, visual: null,
    },
    functions: { scouter: false, autoAim: false, flight: false },
    aimOrigin: new THREE.Vector3(),
    aimDir: new THREE.Vector3(0, 0, -1),
    aimTarget: null,
    aimTargetPoint: null,
    stats: { kills: 0, shots: 0, energyUsed: 0, energyAbsorbed: 0, explosions: 0, startTime: 0, endTime: 0 },
    toasts: [],
    nextId: 1,
    effects: [],
  };
  scene.add(world.player.root);
  return world;
}
