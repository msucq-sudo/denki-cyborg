// すべての調整用数値はここに集約する。各モジュールはここから読むこと（マジックナンバー禁止）。

export const PLAYER = {
  maxHp: 100,
  maxEnergy: 100,
  startEnergy: 80,
  moveSpeed: 6.5,
  gravity: 24,
  jumpSpeed: 8.5,
  radius: 0.4,
  height: 1.8,
  /** 溜め中の移動速度倍率 */
  chargeMoveMul: 0.4,
  /** 吸収中の移動速度倍率 */
  absorbMoveMul: 0.8,
  /** 被弾後の短い無敵時間 */
  hitInvuln: 0.25,
};

export const CAMERA = {
  distance: 4.2,
  shoulderOffsetX: 1.25,
  heightOffset: 1.75,
  fov: 70,
  mouseSensitivity: 0.0022,
  minPitch: -1.2,
  maxPitch: 1.1,
  /** 照準（右クリック長押し / LT）：視点を寄せてズーム */
  aim: { fov: 42, distanceMul: 0.55, shoulderMul: 0.6, sensMul: 0.5, moveMul: 0.7, blendRate: 14 },
};

export const GUN = {
  /** タップ単発 */
  tapCost: 3,
  tapDamage: 6,
  tapInterval: 0.16,
  /** これ以上押し続けたら溜め開始（秒） */
  chargeThreshold: 0.18,
  /** 最大まで溜めるのにかかる時間 */
  chargeTime: 1.2,
  /** 最大溜めまでに消費する電力の合計（溜め中に徐々に消費） */
  chargeCostTotal: 12,
  /** 最大溜めダメージ（効率 4/電力。単発は 2/電力） */
  chargeMaxDamage: 48,
  /** 溜め最小ダメージ（溜め開始直後に離した場合） */
  chargeMinDamage: 10,
  bulletSpeed: 70,
  chargedBulletSpeed: 55,
  bulletLife: 1.5,
  weakMultiplier: 2,
};

export const DODGE = {
  cost: 4,
  speed: 15,
  duration: 0.22,
  invuln: 0.32,
  cooldown: 0.5,
};

/** ダッシュ（Shift長押し）。移動している間だけ電力を消費。回避よりずっと低コスト */
export const DASH = {
  speedMul: 1.55,
  drainPerSec: 1.2,
};

export const ABSORB = {
  /** 吸収アーム自体は電力消費なし */
  cost: 0,
  range: 14,
  extendSpeed: 45,
  retractSpeed: 60,
  cooldown: 0.8,
  /** 敵HPを毎秒これだけ吸う */
  drainPerSec: 20,
  /** 吸った量のうちプレイヤー電力に変換される割合 */
  conversion: 0.65,
  /** 吸い切って停止させたときのボーナス電力 */
  finishBonus: 8,
  /** この距離を超えるとテザーが切れる */
  breakDistance: 18,
};

export const OVERLOAD = {
  /** 逆流中にプレイヤーが失う電力/秒 */
  energyPerSec: 25,
  explosionRadius: 6,
  explosionDamage: 70,
  /** 爆心からこの距離内にいるとプレイヤーも被弾 */
  selfDamageRadius: 3,
  selfDamage: 15,
};

export const FUNCTIONS = {
  scouter: { drainPerSec: 0.6 },
  /** オートエイムは射撃した（ロック中の）瞬間だけ costPerShot を消費 */
  autoAim: { costPerShot: 1, coneDeg: 28, maxRange: 40 },
  /** 飛行は実際に飛んでいる間だけ消費（待機中は消費なし） */
  flight: { flyingDrainPerSec: 5, ascendAccel: 34, maxUpSpeed: 6.5, hoverGravityMul: 0.15 },
};

export type EnemyKind = 'drone' | 'crawler' | 'gunner' | 'heavy' | 'boss';

export const ENEMIES: Record<EnemyKind, {
  hp: number; speed: number; radius: number; damage: number;
  attackInterval: number; projectileSpeed: number; weakMultiplier: number;
  /** 逆流で満タンにするのに必要な電力量 */
  overloadCap: number; sightRange: number;
}> = {
  drone:   { hp: 30,  speed: 4,   radius: 0.55, damage: 6,  attackInterval: 1.8, projectileSpeed: 18, weakMultiplier: 2, overloadCap: 12, sightRange: 28 },
  crawler: { hp: 40,  speed: 6.5, radius: 0.6,  damage: 10, attackInterval: 1.0, projectileSpeed: 0,  weakMultiplier: 2, overloadCap: 14, sightRange: 24 },
  gunner:  { hp: 70,  speed: 3,   radius: 0.7,  damage: 5,  attackInterval: 2.4, projectileSpeed: 22, weakMultiplier: 2, overloadCap: 22, sightRange: 32 },
  heavy:   { hp: 180, speed: 3,   radius: 1.2,  damage: 22, attackInterval: 3.5, projectileSpeed: 0,  weakMultiplier: 3, overloadCap: 38, sightRange: 30 },
  boss:    { hp: 900, speed: 2.5, radius: 2.4,  damage: 6,  attackInterval: 2.0, projectileSpeed: 16, weakMultiplier: 2.5, overloadCap: 60, sightRange: 60 },
};

export const BOSS = {
  /** 逆流満タン時：爆発せずショート（スタン＋大ダメージ） */
  shortStun: 4,
  shortDamage: 150,
};

export const LEVEL = {
  chargePadRate: 20,     // 電力/秒
  chargePadCapacity: 80, // 1つの充電ポイントが出せる総量
  repairKitHeal: 40,
};
