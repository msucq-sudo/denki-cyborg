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
  aim: { fov: 42, distanceMul: 0.7, shoulderMul: 1.0, sensMul: 0.5, moveMul: 0.7, blendRate: 14 },
};

export const GUN = {
  /** タップ単発（ピストル：1発が重くて遅い） */
  tapCost: 8,
  tapDamage: 20,
  tapInterval: 0.5,
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

/** 主人公の見た目・アニメーション調整値（キャラクターシート準拠のサイボーグ）。見た目の数値はここだけ触ればよい */
export const CHARACTER = {
  colors: {
    white: 0xeceef2, grey: 0xaeb4bf, dark: 0x2b2d34, dark2: 0x3b3e49, black: 0x131418,
    yellow: 0xf2b01e, silver: 0xd2d6de, skin: 0x5e3b29, hair: 0x15110f,
    cyan: 0x4de8ff, outline: 0x0a0b10,
  },
  /** アウトライン太さ（m） */
  outline: 0.011,
  outlineSpring: 0.007,
  /** トゥーンの階調（暗→明） */
  toonTones: [0.42, 0.72, 1.0],
  /** 右腕（銃）/ 左腕（スプリング）の骨の長さ。fore は肘（バネ先端）→拳の中心 */
  arm: {
    shoulderX: 0.3, shoulderY: 1.46,
    right: { upper: 0.33, fore: 0.37 },
    left: { upper: 0.52, fore: 0.25 },
    /** 拳の中心から拳先までの距離（吸収で先端が届く位置合わせ） */
    fistReach: 0.1,
  },
  spring: { radius: 0.11, tube: 0.017, turns: 12, tubularSegs: 180, rippleAmp: 0.35, rippleFreq: 22, rippleDecay: 7 },
  /** スカウター = 耳の白い装置（顔のレンズは無し）。リング/ランプが ON で強く脈打つ。side: +1=キャラの右耳(+X) / -1=左耳 */
  scouter: {
    side: 1, offColor: 0xff7a2a, onColor: 0x4de8ff, offLevel: 0.55, onLevel: 1.7,
    pulseRate: 9, pulse: 0.3, glowOff: 0.0, glowOn: 0.8,
  },
  /** 銃の構え（胸ローカル）。武器ごとの持ち方（グリップ位置など）は weapons.ts。carry=構えていない時 / aim=構え時 */
  gun: {
    /** 武器モデルの拡大率（見た目のみ。三人称で見やすくする） */
    scale: 1.45,
    carryPos: [0.2, -0.2, -0.3],
    /** 構え時、右肩から照準方向へ腕を伸ばす割合（1=完全に伸ばしきる）。銃の高さ＝肩の高さ */
    armExtend: 0.97,
    /** 構えのスタンス（静止時）：左足が前・右足が後ろ（rad）と、膝・開き。上半身は左肩を前に半身 */
    stanceFront: 0.3, stanceBack: 0.26, stanceKnee: 0.12, stanceSplay: 0.07, aimHipTwist: -0.2,
    carryDir: [0.15, -0.45, -0.88],
    poleR: [0.5, -1, 0.3], poleL: [-0.5, -1, 0.3],
    recoilTime: 0.16, recoilKick: 0.07, recoilPitch: 0.2,
    holdAfterShot: 0.7,
    /** 構え時の上半身のひねり（+で左へ。半身で右腕・銃をカメラ側へ出す） */
    aimTwist: -0.3,
  },
  anim: {
    moveRate: 12, runRate: 8, aimRate: 14, absorbRate: 22, airRate: 12, flyRate: 7,
    /** 1周期（左右2歩）で進む距離。足が滑らないよう速度から位相を決める */
    strideWalk: 2.4, strideRun: 3.6,
    legAmpWalk: 0.55, legAmpRun: 0.85,
    kneeWalk: [0.12, 0.9], kneeRun: [0.3, 1.5],
    armSwingWalk: 0.5, armSwingRun: 0.9, elbowWalk: 0.25, elbowRun: 1.2,
    hipTwist: 0.1, spineTwist: 0.12, leanWalk: 0.06, leanRun: 0.22,
    breathRate: 1.7, breathAmp: 0.014, swayRate: 0.6,
    chargeSplay: 0.12, chargeKnee: 0.35, chargeShake: 0.006,
    rollTuck: 1.5, rollSpins: 1,
    flinchTime: 0.32, flinchAmp: 0.4,
    landTime: 0.22,
    flyLean: 0.35,
    jetFlicker: 0.5,
    /** 脚の長さの変化に合わせて胴を上下させる量（足が浮かない補正。0..1） */
    groundComp: 0.7,
  },
};
