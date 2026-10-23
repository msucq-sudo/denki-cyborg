import type * as THREE from 'three';
import type { EnemyKind } from '../config/balance';
import type { Input } from './input';
import type { EventBus } from './events';

export type GameState = 'title' | 'playing' | 'paused' | 'gameover' | 'clear';

/** 静的な当たり判定ボックス（ワールド座標）。active=false なら無視（開いたドアなど） */
export interface AABB {
  min: THREE.Vector3;
  max: THREE.Vector3;
  active: boolean;
  tag?: string;
}

export interface Player {
  root: THREE.Group;          // 見た目（player モジュールが中身を作る）
  /** 足元の位置 */
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;                // カメラ/向きの水平角
  pitch: number;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  onGround: boolean;
  invuln: number;             // 残り無敵時間（秒）
  dodgeTimer: number;
  dodgeCooldown: number;
  dodgeDir: THREE.Vector3;
  /** 射撃ボタン押下時間 */
  fireHold: number;
  fireCooldown: number;
  charging: boolean;
  /** 0..1 */
  charge: number;
  /** 溜めで消費済みの電力 */
  chargeSpent: number;
  flying: boolean;
  /** absorb モジュールが毎フレーム設定 */
  absorbing: boolean;
  overloading: boolean;
}

export interface WeakPoint {
  /** 敵 root からのローカル座標 */
  offset: THREE.Vector3;
  radius: number;
  mesh: THREE.Mesh;           // 弱点の見た目（スカウターで強調される）
  /** false の間は弱点判定なし（ボスのコアが閉じている等） */
  exposed: boolean;
}

export type EnemyStatus = 'active' | 'stunned' | 'down' | 'dead';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  root: THREE.Group;
  /** 体の中心位置（ワールド）。root.position と同期させる */
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  hp: number;
  maxHp: number;
  status: EnemyStatus;
  weakPoints: WeakPoint[];
  /** absorb モジュールが設定 */
  tethered: boolean;
  /** 逆流量（0..overloadCap） */
  overload: number;
  /** 汎用の AI 用タイマーなど（enemies モジュールが自由に使う） */
  ai: Record<string, any>;
  /** 倒れてから消えるまで等の演出用 */
  deadTimer: number;
}

export type ProjectileOwner = 'player' | 'enemy';

export interface Projectile {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  damage: number;
  owner: ProjectileOwner;
  life: number;
  mesh: THREE.Object3D;
  charged?: boolean;
  /** 重力の影響（0=なし） */
  gravity?: number;
  dead?: boolean;
}

export type AbsorbPhase = 'idle' | 'extending' | 'attached' | 'retracting' | 'cooldown';

export interface AbsorbState {
  phase: AbsorbPhase;
  /** アーム先端（ワールド） */
  tip: THREE.Vector3;
  dir: THREE.Vector3;
  length: number;
  target: Enemy | null;
  cooldown: number;
  /** 吸収で得た電力の累計（統計用） */
  totalAbsorbed: number;
  /** absorb モジュールの見た目など */
  visual: THREE.Object3D | null;
}

export interface FunctionsState {
  scouter: boolean;
  autoAim: boolean;
  flight: boolean;
}

export interface Stats {
  kills: number;
  shots: number;
  energyUsed: number;
  energyAbsorbed: number;
  explosions: number;
  startTime: number;
  endTime: number;
}

/** ダンジョンの状態。level モジュールが所有。他モジュールは読み取りのみ */
export interface LevelState {
  rooms: RoomInfo[];
  currentRoom: number;
  bossSpawned: boolean;
  bossDefeated: boolean;
  data: Record<string, any>;
}

export interface RoomInfo {
  name: string;
  min: THREE.Vector3;
  max: THREE.Vector3;
  entered: boolean;
  cleared: boolean;
}

export interface Toast {
  text: string;
  timer: number;
}

export interface World {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  state: GameState;
  time: number;
  input: Input;
  events: EventBus;
  player: Player;
  enemies: Enemy[];
  projectiles: Projectile[];
  colliders: AABB[];
  level: LevelState;
  absorb: AbsorbState;
  functions: FunctionsState;
  /** 射撃・吸収の発射位置（肩/銃口）。player モジュールが毎フレーム更新 */
  aimOrigin: THREE.Vector3;
  /** 射撃・吸収の方向（正規化）。player が計算→ functions(オートエイム) が補正 */
  aimDir: THREE.Vector3;
  /** オートエイムのロック対象（UI のロックオン表示に使う） */
  aimTarget: Enemy | null;
  aimTargetPoint: THREE.Vector3 | null;
  stats: Stats;
  toasts: Toast[];
  /** 汎用の連番 */
  nextId: number;
  /** 一時的な演出（effects.ts が管理） */
  effects: EffectInstance[];
}

export interface EffectInstance {
  obj: THREE.Object3D;
  life: number;
  maxLife: number;
  update?: (e: EffectInstance, dt: number) => void;
}
