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
  /** すき間のある物（檻の格子など）。体や弾は止めるが、三人称カメラの壁よけは通り抜ける */
  seeThrough?: boolean;
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
  /** ハッキング中（hack モジュールが毎フレーム設定） */
  hacking?: boolean;
  /** リーチの吸収アームにつながれている（leech が毎フレーム設定。HUD 表示用） */
  leeched?: boolean;
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
  /** ハッキングされて味方になった。true の間は撃っても当たらず、吸収できず、部屋のクリア判定にも数えない */
  allied?: boolean;
  /** 守られている（ジャンパーの閉じた頭など）。true の間は弾が当たってもダメージ0（はじく）、吸収アームも刺さらない */
  shielded?: boolean;
  /** ドームシールド（ドーマー）。展開中は外からの弾・吸収アームを止める。中心は足元（enemies/barrier.ts） */
  barrier?: Barrier;
}

export interface Barrier {
  radius: number;
  hp: number;
  maxHp: number;
  /** 展開の進み 0..1。1 になるまでは守らない */
  k: number;
  /** 被弾の光（1→0） */
  flash: number;
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
  /** 撃ち落とせる弾（敵弾のみ）。player の弾が当たると hp が減り、0 で無害に爆散 */
  shootable?: boolean;
  hp?: number;
  /** 経過時間（ホーミング開始待ちなど） */
  age?: number;
  /** ホーミング：delay 秒後から旋回（rad/s）。speed があればその速さへ加減速 */
  homing?: { turnRate: number; target: 'player'; delay?: number; speed?: number; accel?: number };
  /** 命中時の小爆発（見た目のみ） */
  blast?: {
    radius: number; color: number;
    /** プレイヤーへの範囲ダメージ（爆発の中心での値）。省略なら見た目だけ。中心から離れるほど減る */
    damage?: number;
    /** 範囲の端でのダメージ倍率（0..1、既定 0.25）。範囲の外は 0 */
    minMul?: number;
    /** 寿命が尽きたときも爆発する（信管） */
    onExpire?: boolean;
    /** 飛んでいる間、着弾予測地点に警告の輪を出す */
    warnRing?: boolean;
  };
  /** メッシュを速度方向へ向ける（+Z が先端） */
  orient?: boolean;
  /** 軌跡の火花の色 */
  trail?: number;
  trailT?: number;
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
  hack: HackState;
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
  /**
   * 後から解放する特殊機能（スカウター・ジェットパックは最初から使える基本機能なので含めない）。
   * どれも未解放のうちは左上の「特殊機能」パネルを出さない
   */
  unlocks: { autoAim: boolean; vacuum: boolean };
  /** 武器の所持と装備中の武器（player/weaponSwitch.ts が切り替える） */
  loadout: LoadoutState;
  /** スキル（バキュームなど）の選択・クールダウン（abilities/skills.ts / vacuum.ts が使う） */
  skills: SkillState;
  /** 強化素材の所持数（歯車＝探索で拾う／メタル＝敵が落とす） */
  inventory: { gears: number; metal: number };
  /** 強化のレベル（項目 id → レベル。無ければ1）。progression/upgrades.ts が使う */
  upgrades: Record<string, number>;
  /** 床に落ちているメタル（pickups.ts が管理） */
  drops: import('./pickups').MetalDrop[];
}

/** 武器の所持。owned は WEAPON_ORDER の並び（切り替えの順番）。current は装備中の武器 id */
export interface LoadoutState {
  owned: string[];
  current: string;
}

export type SkillId = 'vacuum';

export interface SkillState {
  /** 選択中のスキル（Y / キーボードの Y で発動する） */
  selected: SkillId;
  /** スキル選択の画面で右スティックが指している枠（0..）。指していなければ null（HUD 表示用） */
  hover: number | null;
  /** 残りクールダウン（秒） */
  cooldown: Record<SkillId, number>;
  /** バキュームの実行中の状態 */
  vacuum: { active: boolean; t: number; gained: number; downed: number };
}

export interface EffectInstance {
  obj: THREE.Object3D;
  life: number;
  maxLife: number;
  update?: (e: EffectInstance, dt: number) => void;
}

/** ハッキングの状態（abilities/hack.ts が所有） */
export interface HackState {
  /** コード入力中 */
  active: boolean;
  target: Enemy | null;
  /** 出題コード（キーボード用とパッド用。同じ並びの番号から作る） */
  codeKeys: string[];
  codePad: string[];
  /** 正しく入力できた個数 */
  progress: number;
  /** 表示に使う入力機器（最後に触った機器） */
  device: 'kbm' | 'pad';
  /** ミス時の赤い点滅の残り時間 */
  failFlash: number;
  /** 成功表示の残り時間 */
  successFlash: number;
}
