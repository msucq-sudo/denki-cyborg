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
    hack: {
      active: false, target: null, codeKeys: [], codePad: [], progress: 0,
      device: 'kbm', failFlash: 0, successFlash: 0,
    },
    absorb: {
      phase: 'idle', tip: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), length: 0,
      target: null, cooldown: 0, totalAbsorbed: 0, visual: null,
    },
    // スカウターは最初から装備・ON。flight=ジェットパック装備（常にtrue）
    functions: { scouter: true, autoAim: false, flight: true },
    aimOrigin: new THREE.Vector3(),
    aimDir: new THREE.Vector3(0, 0, -1),
    aimTarget: null,
    aimTargetPoint: null,
    stats: { kills: 0, shots: 0, energyUsed: 0, energyAbsorbed: 0, explosions: 0, startTime: 0, endTime: 0 },
    toasts: [],
    nextId: 1,
    effects: [],
    unlocks: { autoAim: false },
    inventory: { gears: 0, metal: 0 },
    upgrades: {},
    drops: [],
  };
  scene.add(world.player.root);
  return world;
}
