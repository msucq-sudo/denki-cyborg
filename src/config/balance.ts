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
  absorbMoveMul: 0.35,
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

/** グラップル（吸収アームを足場の「フック」に刺して体を引き寄せる） */
export const GRAPPLE = {
  /** false: グラップルポイントだけに刺さる。true: 向きが合う壁・天井ならどこでも刺さる（レベルデザイン用の切替） */
  anySurface: false,
  /** 狙える最大距離（m）。吸収アームの射程より長い */
  range: 22,
  /** 1回の電力消費 */
  cost: 2,
  /** 終了後の再使用待ち（秒） */
  cooldown: 0.6,
  /** 引き寄せ速度（m/s）：加速して最大まで */
  minSpeed: 9,
  maxSpeed: 22,
  accel: 60,
  /** ポイント当たり判定の標準半径 */
  pointRadius: 1.2,
  /** 縁のよじ登り時間 */
  hoistTime: 0.5,
  /** 天井でぶら下がれる最大時間（過ぎたら自動で離す） */
  hangMax: 4,
  /** 天井から adjacent 足場へ飛ぶ（landAt）までの待ち */
  swingDelay: 0.3,
  swingTime: 0.8,
  /** 引き寄せ中に進めない状態がこの秒数続いたら中止 */
  blockedTime: 0.2,
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
  /** スカウターは電力消費なし（常時使える標準装備） */
  scouter: { drainPerSec: 0 },
  /** オートエイムは射撃した（ロック中の）瞬間だけ costPerShot を消費 */
  autoAim: { costPerShot: 1, coneDeg: 28, maxRange: 40 },
  /**
   * ジェットパック（常に装備）。空中でジャンプ長押し → 縦速度が engageVy 以下になったら滞空。
   * 高く飛ぶのではなく「その高さを維持」する。滞空中だけ消費
   */
  flight: { flyingDrainPerSec: 6, engageVy: 0.5, hoverDamp: 10 },
};

export type EnemyKind = 'drone' | 'crawler' | 'gunner' | 'heavy' | 'walker' | 'redWalker' | 'heavyWalker' | 'missile' | 'beamer' | 'leech' | 'jumper' | 'missileDrone' | 'bomber' | 'redDrone' | 'boss';

export const ENEMIES: Record<EnemyKind, {
  hp: number; speed: number; radius: number; damage: number;
  attackInterval: number; projectileSpeed: number; weakMultiplier: number;
  /** 逆流で満タンにするのに必要な電力量 */
  overloadCap: number; sightRange: number;
  /** 吸収アームで吸う速さの倍率（省略=1） */
  drainMul?: number;
}> = {
  drone:   { hp: 30,  speed: 4,   radius: 0.55, damage: 6,  attackInterval: 1.8, projectileSpeed: 18, weakMultiplier: 2, overloadCap: 12, sightRange: 28 },
  crawler: { hp: 40,  speed: 6.5, radius: 0.6,  damage: 10, attackInterval: 1.0, projectileSpeed: 0,  weakMultiplier: 2, overloadCap: 14, sightRange: 24 },
  gunner:  { hp: 70,  speed: 3,   radius: 0.7,  damage: 5,  attackInterval: 2.4, projectileSpeed: 22, weakMultiplier: 2, overloadCap: 22, sightRange: 32 },
  heavy:   { hp: 180, speed: 3,   radius: 1.2,  damage: 22, attackInterval: 3.5, projectileSpeed: 0,  weakMultiplier: 3, overloadCap: 38, sightRange: 30 },
  /** ウォーカー：ゆっくり近づきながら遠距離射撃（何も考えずに前進） */
  walker:  { hp: 50,  speed: 1.6, radius: 0.7,  damage: 6,  attackInterval: 2.0, projectileSpeed: 16, weakMultiplier: 2, overloadCap: 18, sightRange: 30 },
  /** ヘビーウォーカー：突進＋踏みつけ電撃（範囲）。damage=踏みつけ */
  heavyWalker: { hp: 220, speed: 2.2, radius: 1.3, damage: 18, attackInterval: 3.0, projectileSpeed: 0, weakMultiplier: 2.5, overloadCap: 42, sightRange: 30 },
  /** ミサイル溜めロボット：護衛を召喚→ミサイルを溜めて発射。damage=ミサイル1発、attackInterval=溜め時間 */
  missile: { hp: 160, speed: 1.8, radius: 1.1,  damage: 16, attackInterval: 7.0, projectileSpeed: 11, weakMultiplier: 2.5, overloadCap: 34, sightRange: 34 },
  /** 赤ウォーカー：ウォーカーの赤い版。ハッキングできる（吸収アームをつなぐとコード入力）。T3-C で調整 */
  redWalker: { hp: 60, speed: 1.8, radius: 0.7, damage: 7, attackInterval: 1.8, projectileSpeed: 17, weakMultiplier: 2, overloadCap: 20, sightRange: 30 },
  /** ビーマー：遠距離で長く溜めて極太ビーム。体力が多い。damage=ビーム1発 */
  beamer:  { hp: 240, speed: 2,   radius: 1.1,  damage: 30, attackInterval: 3.5, projectileSpeed: 0,  weakMultiplier: 3, overloadCap: 45, sightRange: 42 },
  /** リーチ（吸収マン）：とても小さい。吸収アームでプレイヤーの電力を吸う。つながれると逃げる */
  leech:   { hp: 30,  speed: 5,   radius: 0.32, damage: 0,  attackInterval: 3.0, projectileSpeed: 0,  weakMultiplier: 2, overloadCap: 10, sightRange: 26 },
  /** ジャンパー：大きな頭の二足歩行。ジャンプでゆっくり移動し、着地の瞬間に突き。頭（核）が開いている間しか攻撃も吸収も効かない。speed=1回の跳躍の水平速度の上限、attackInterval=着地から次の跳躍までの周期。T3-D で調整 */
  jumper:  { hp: 120, speed: 3.2, radius: 0.95, damage: 16, attackInterval: 2.5, projectileSpeed: 0,  weakMultiplier: 2.5, overloadCap: 30, sightRange: 30 },
  /** ミサイルドローン：4発のミサイルを放つドローン。ミサイルは撃つかアームを当てると消せる。damage=ミサイル1発。T3-E で調整 */
  missileDrone: { hp: 45, speed: 3.5, radius: 0.7, damage: 9, attackInterval: 4.5, projectileSpeed: 9, weakMultiplier: 2, overloadCap: 14, sightRange: 32 },
  /** ボンバー：小さく丸い。電気の球を投げ、着弾で爆発（中心ほど大ダメージ）。damage=爆心ダメージ。T3-F で調整 */
  bomber:  { hp: 35,  speed: 3.2, radius: 0.45, damage: 22, attackInterval: 2.4, projectileSpeed: 12, weakMultiplier: 2, overloadCap: 12, sightRange: 26 },
  /** 赤ドローン：ドローンの赤い版。ハッキングできる。つなぐと吸収が遅くなる(HACK.drainMul)ので、コード入力の時間が取れるよう体力は多め */
  redDrone: { hp: 60, speed: 4,   radius: 0.55, damage: 6,  attackInterval: 1.8, projectileSpeed: 18, weakMultiplier: 2, overloadCap: 14, sightRange: 28 },
  boss:    { hp: 900, speed: 2.5, radius: 2.4,  damage: 6,  attackInterval: 2.0, projectileSpeed: 16, weakMultiplier: 2.5, overloadCap: 60, sightRange: 60 },
};

/**
 * 敵の「気づき」。プレイヤーがこの距離まで近づく（かつ見えている）まで反応しない。
 * 一度気づいたら sightRange まで追い続ける。撃たれた場合も気づく。
 */
export const ENEMY_NOTICE = {
  range: 15,
  /** 気づいた敵の周りこの距離の仲間も気づく */
  shareRadius: 9,
};

/**
 * 敵を倒すと落とす「メタル」（強化素材）。雑魚は少なめ、強い敵は多め。
 * drop=1体あたりの量。見た目のかけらは最大 maxPieces 個に分けて散らばる
 */
export const METAL = {
  drop: { drone: 1, crawler: 1, gunner: 2, walker: 2, heavy: 6, heavyWalker: 8, missile: 10, boss: 30 } as Record<EnemyKind, number>,
  maxPieces: 6,
  /** 逆流（送電）で爆発させて倒したときの倍率（2＝通常の2倍） */
  overloadMul: 2,
  /** これより近いと吸い寄せられる（m） */
  magnetRadius: 6,
  magnetSpeed: 16,
  /** これより近いと拾う（m） */
  pickupRadius: 1.1,
  /** 拾われないまま消えるまで（秒） */
  life: 90,
};

export const BOSS = {
  /** 逆流満タン時：爆発せずショート（スタン＋大ダメージ） */
  shortStun: 4,
  shortDamage: 150,
};

/** 閉じ込め戦の演出。enabled=false で赤い警報照明とサイレンを両方止める（ドアの開閉はそのまま） */
/** 閉じ込め戦の演出。enabled=false で赤い照明とサイレンを消す（扉の開閉はそのまま）。sirenCycles=サイレンを鳴らす回数 */
export const LOCKDOWN = { enabled: true, light: 0xff2a20, sirenVolume: 0.5, sirenCycles: 3 };

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
    // 重量級：歩幅を大きく・足の回転はゆっくり（のっしのっし）。進む速さは同じ
    strideWalk: 3.7, strideRun: 5.2,
    legAmpWalk: 0.82, legAmpRun: 1.05,
    kneeWalk: [0.15, 1.05], kneeRun: [0.35, 1.6],
    armSwingWalk: 0.42, armSwingRun: 0.8, elbowWalk: 0.22, elbowRun: 1.1,
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

/** ビーマーの攻撃（溜め→ロック→発射）。T3-A で調整 */
export const BEAMER = {
  /** 好む距離 */
  prefMin: 16, prefMax: 28,
  /** 溜めの合計時間（照準線がプレイヤーを追う） */
  chargeTime: 2.6,
  /** 発射直前に照準を固定する時間（ここで避ける） */
  lockTime: 0.55,
  /** 溜め中の照準の追従速度（rad/秒） */
  trackRate: 1.6,
  /** ビームの持続・太さ・長さ */
  fireTime: 0.35, beamWidth: 0.8, beamLength: 60,
  /** 発射後の硬直 */
  recover: 1.4,
  /** 溜め中にレンズへ1回でこれ以上のダメージが入ると溜め中断 */
  interruptDamage: 18,
  interruptStun: 1.3,
};

/** リーチ（吸収マン）の吸収アーム */
export const LEECH = {
  /** 好む距離 */
  prefMin: 8, prefMax: 13,
  /** アームを撃つ前の予備動作 */
  windup: 0.6,
  armRange: 15, armSpeed: 20,
  /** アーム先端の当たり半径（プレイヤーの当たり半径に足す） */
  tipRadius: 0.15,
  /** アームを巻き戻す速さ（armSpeed の倍率） */
  retractMul: 2.5,
  /** つながっている間にプレイヤーから吸う電力/秒 */
  drainPerSec: 7,
  /** この距離を超える／この秒数たつとアームが外れる */
  breakDistance: 18, maxAttach: 5,
  /** 見通しが切れてもこの秒数まではつながったまま */
  losGrace: 0.25,
  /** プレイヤーにアームをつながれたときの逃げ足 */
  fleeSpeed: 8.5,
  /** 逃げ足が最高速になるまでの秒数（つながれた直後は少し出遅れる） */
  fleeRamp: 0.45,
  /** つなぎが切れた後も、この秒数は怯えて逃げ続ける */
  fear: 1.0,
  /** 浮く高さ（床から） */
  hoverHeight: 1.1,
  /** 盗んだ電力をためられる上限（吸い切ると戻ってくる） */
  stolenCap: 40,
};

/** ハッキング。KindModule.hackable=true の敵に吸収アームをつなぐとコード入力が始まる。T3-C で調整 */
export const HACK = {
  codeLength: 8,
  /** キーボードの出題キー（ゲームで使っていないキー。KeyboardEvent.code） */
  keyboardKeys: ['KeyQ', 'KeyT', 'KeyG', 'KeyZ', 'KeyX', 'KeyV', 'KeyB', 'Digit4'],
  /** コントローラーの出題ボタン（Input が作る仮想キー） */
  padKeys: ['PadUp', 'PadDown', 'PadLeft', 'PadRight', 'PadA', 'PadB', 'PadX', 'PadY'],
  /** 入力ミスで失う電力 */
  failEnergy: 3,
  /** ハッキング中（つながっている間）の吸収速度の倍率 */
  drainMul: 0.3,
  /** つながれている間の敵の速度倍率 */
  jamSpeedMul: 0.5,
  /** 味方でいる時間 */
  allyTime: 20,
};
