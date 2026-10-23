import type * as THREE from 'three';
import type { EnemyKind } from '../config/balance';

/** ゲーム内イベント。SE・UI・演出はこれを購読する。発行側は emit するだけ。 */
export interface GameEvents {
  shot: { charged: boolean; power: number };
  chargeStart: {};
  chargeFull: {};
  chargeCancel: {};
  dodge: {};
  jump: {};
  land: {};
  flightStart: {};
  flightEnd: {};
  impact: { pos: THREE.Vector3; owner: 'player' | 'enemy' };
  enemyHit: { pos: THREE.Vector3; weak: boolean; damage: number };
  /** 吸収で敵HPを吸った量（一定間隔でまとめて通知） */
  enemyDrained: { pos: THREE.Vector3; amount: number };
  enemyKilled: { kind: EnemyKind; pos: THREE.Vector3; how: 'shot' | 'absorb' | 'explosion' };
  enemyAttack: { kind: EnemyKind; pos: THREE.Vector3 };
  playerHit: { amount: number };
  absorbFire: {};
  absorbAttach: { pos: THREE.Vector3 };
  absorbBreak: {};
  absorbComplete: { pos: THREE.Vector3 };
  overloadStart: {};
  overloadEnd: {};
  explosion: { pos: THREE.Vector3; radius: number };
  bossShort: { pos: THREE.Vector3 };
  functionToggle: { name: 'scouter' | 'autoAim' | 'flight'; on: boolean };
  energyEmpty: {};
  energyLow: {};
  noEnergy: {};
  charging: { amount: number };
  repair: { amount: number };
  roomEnter: { index: number; name: string };
  roomClear: { index: number };
  doorOpen: { pos: THREE.Vector3 };
  bossStart: {};
  bossPhase: { phase: number };
  gameStart: {};
  gameOver: {};
  gameClear: {};
  uiClick: {};
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers: { [K in keyof GameEvents]?: Handler<GameEvents[K]>[] } = {};

  on<K extends keyof GameEvents>(name: K, fn: Handler<GameEvents[K]>): () => void {
    const list = (this.handlers[name] ??= []) as Handler<GameEvents[K]>[];
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  emit<K extends keyof GameEvents>(name: K, payload: GameEvents[K]): void {
    const list = this.handlers[name] as Handler<GameEvents[K]>[] | undefined;
    if (!list) return;
    for (const fn of [...list]) {
      try { fn(payload); } catch (e) { console.error(`[event ${String(name)}]`, e); }
    }
  }

  clear(): void { this.handlers = {}; }
}
