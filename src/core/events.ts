import type * as THREE from 'three';
import type { EnemyKind } from '../config/balance';

export type EnemyAction =
  | 'crawlerDodge' | 'stompWindup' | 'stomp' | 'chargeStart' | 'wallCrash'
  | 'summon' | 'missileLoad' | 'missileBeep' | 'missileDisrupt';

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
  /** ドア（シャッター）が閉まる */
  doorClose: { pos: THREE.Vector3 };
  /** 閉じ込め戦の開始／終了（赤い警報照明＋サイレン） */
  lockdownStart: { zone: string };
  lockdownEnd: { zone: string };
  bossStart: {};
  bossPhase: { phase: number };
  gameStart: {};
  gameOver: {};
  gameClear: {};
  uiClick: {};
  /** 敵が初めてプレイヤーに気づいた */
  enemyNotice: { kind: EnemyKind; pos: THREE.Vector3 };
  /** 敵の個別アクション（SE用）。value は 0..1 の進行度など */
  enemyAction: { kind: EnemyKind; pos: THREE.Vector3; action: EnemyAction; value?: number };
  /** ミサイルが撃ち落とされた / 着弾して爆発した */
  missileDown: { pos: THREE.Vector3 };
  missileBlast: { pos: THREE.Vector3 };
  /** 休眠中の敵が起きる予兆（ポッドのランプ点灯 / 天井ハッチの点滅） */
  enemyWakeWarn: { pos: THREE.Vector3; mode: 'pod' | 'drop' };
  /** 休眠中の敵が飛び出す（ポッドが開く / 天井から落下開始） */
  enemyEmerge: { kind: EnemyKind; pos: THREE.Vector3; mode: 'pod' | 'drop' };
  /** 強化素材（歯車）取得 */
  gearPickup: {};
  /** 敵が落としたメタルを拾った */
  metalPickup: { amount: number; total: number };
  /** 操作ヒントが出た */
  interactPrompt: {};
  /** 緊急バッテリーのスイッチON */
  switchOn: { pos: THREE.Vector3 };
  /** 電力がエレベーターまで届いた */
  powerRestored: { pos: THREE.Vector3 };
  /** 電源のないエレベーターに近づいた */
  elevatorLocked: { pos: THREE.Vector3 };
  /** エレベーターのドアが開く */
  elevatorOpen: { pos: THREE.Vector3 };
  /** エレベーターに乗った（クリア） */
  elevatorRide: {};
  /** 階の移動（エレベーター）。to は移動先の階 */
  floorChange: { from: number; to: number };
  /** 改造ベッドに横になり始めた（2階） */
  sleepStart: {};
  /** 眠りの演出が終わった。ここに強化（アップグレード）画面を後で差し込む */
  sleepComplete: {};
  /** ベッドから起き上がった */
  wakeUp: {};
  /** ゾーンの敵の波が出現（wave: 1 or 2） */
  zoneWave: { wave: number };
  /** 空の充電ポイントに乗った */
  padEmpty: {};
  /** ジェットパックが使えない（電力切れ） */
  flightFail: {};
  /** グラップル：アームをポイントへ撃った／刺さった（引き寄せ開始）／到着した */
  grappleFire: {};
  grappleAttach: { pos: THREE.Vector3 };
  grappleArrive: { pos: THREE.Vector3 };
  /** 吸収アームでアイテム（歯車・メタル）を掴んだ */
  armGrab: { pos: THREE.Vector3 };
  /** 無線通信（スパーク等）。duration 秒で自動で消える（省略時は文字数から） */
  comm: { speaker: string; text: string; duration?: number };
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
