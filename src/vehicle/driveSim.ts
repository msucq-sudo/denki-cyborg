// 運転の計算（見た目・シーンに触れない純粋な数値処理）。drive.ts がこれを毎フレーム進める。
// 座標：+X=東、-Z=北、yaw=0 が -Z（北）向き、+π/2 が -X（西）向き。ヘディング f = (-sin yaw, -cos yaw)。
// 道：ガレージから北へ一本道 → T字路（junctionZ）→ 左折して西へ長い直線 → 判定地点。
import { CHECKPOINT, ROAD } from '../level/surge/layout';

/** 調整用の数値（km/h は表示用の単位。内部の速度は m/s） */
export const DRIVE = {
  /** タイミングバー：カーソルが左→右→左と1往復する秒数 */
  barPeriod: 1.6,
  /** 中央からの半幅（バー全体を 0..1 とする）。この中なら PERFECT / GOOD */
  perfectHalf: 0.09,
  goodHalf: 0.22,
  /** 加速量（km/h）。PERFECT が大、GOOD が小、MISS は 0 */
  gainPerfect: 24,
  gainGood: 10,
  /** 押したあと次に受け付けるまでの秒数（連打対策。クールダウン中に押すと延長される） */
  cooldownHit: 0.25,
  cooldownMiss: 0.5,
  cooldownSpam: 0.35,
  /** 加速が速度に反映される時間定数（秒） */
  boostTau: 0.18,
  /** 転がり抵抗：毎秒 drag0 + drag1 × 速度(km/h) だけ減る */
  drag0: 5,
  drag1: 0.03,
  /** 上限（km/h）。T字路を曲がり終えるまでは preTurnCap */
  maxKmh: 340,
  preTurnCapKmh: 90,
  /** 左右の動き：最大横速度 (m/s)・道の端からの余白に残す範囲（中心からの最大オフセット） */
  latSpeed: 9.5,
  latMax: ROAD.width / 2 - 1.6,
  /** 車が動いていないと横に動けない（この速度 m/s で全開） */
  latFullSpeed: 6,
  /** 曲がりの半径 (m) と、曲がる指示を受け付け始める手前の距離 */
  turnRadius: 11,
  turnWindow: 28,
  /** 「← 左折」を出し始める手前の距離 */
  turnHintDist: 70,
  /** 北の行き止まり（T字路の向こう側の壁）の位置（junctionZ からの距離） */
  northWall: 6.5,
  /** 東の柵（ここに触れると跳ね返る）手前の余白 */
  eastWallGap: 3,
  /** 壁にぶつかった時の跳ね返り速度 (m/s)・時間 (s)・立て直しの旋回 (rad/s)・速度 (m/s) */
  bounceSpeed: 5,
  bounceTime: 0.55,
  recoverTurnRate: 2.2,
  recoverSpeed: 7,
  /** 車の大きさ（半分）：当たり判定用 */
  halfLen: 2.3,
  halfWid: 1.05,
} as const;

export type Quality = 'perfect' | 'good' | 'miss';
export type DriveMode = 'north' | 'turn' | 'east' | 'bounce' | 'recover' | 'west';

export interface SimState {
  pos: { x: number; y: number; z: number };
  yaw: number;
  /** 進行方向への速度 (m/s)。跳ね返り中だけ負 */
  speed: number;
  mode: DriveMode;
  /** なめらかにした舵 -1..1（見た目の傾き・前輪用） */
  steer: number;
  latVel: number;
  /** T字路の手前で受け付けた曲がる向き（-1=左, 1=右, 0=なし） */
  intent: -1 | 0 | 1;
  turnDir: -1 | 0 | 1;
  turnPhi: number;
  turnCx: number;
  turnCz: number;
  /** まだ反映していない加速分 (km/h) */
  pendingKmh: number;
  cursorT: number;
  cooldown: number;
  bounceT: number;
  junctionDone: boolean;
  /** 統計（デバッグ・テスト用） */
  presses: number;
  perfects: number;
  goods: number;
  misses: number;
  /** 判定地点を越えたか */
  checkpointDone: boolean;
}

export type SimEvent =
  | { type: 'boost'; quality: Quality; kmh: number }
  | { type: 'turnStart'; dir: -1 | 1 }
  | { type: 'junctionDone' }
  | { type: 'bounce'; where: 'east' | 'north'; kmh: number }
  | { type: 'checkpoint'; kmh: number };

export interface SimInput {
  /** -1=左, 1=右（アナログ可） */
  steer: number;
  /** このフレームで加速ボタンが押された */
  press: boolean;
}

export function createSim(x: number, z: number, yaw = 0): SimState {
  return {
    pos: { x, y: 0, z }, yaw, speed: 0, mode: 'north', steer: 0, latVel: 0, intent: 0,
    turnDir: 0, turnPhi: 0, turnCx: 0, turnCz: 0, pendingKmh: 0, cursorT: 0, cooldown: 0, bounceT: 0,
    junctionDone: false, presses: 0, perfects: 0, goods: 0, misses: 0, checkpointDone: false,
  };
}

/** タイミングバーのカーソル位置 0..1（三角波） */
export function cursorAt(t: number): number {
  const ph = (((t / DRIVE.barPeriod) % 1) + 1) % 1;
  return ph < 0.5 ? ph * 2 : 2 - ph * 2;
}

export function judge(c: number): Quality {
  const d = Math.abs(c - 0.5);
  if (d <= DRIVE.perfectHalf) return 'perfect';
  if (d <= DRIVE.goodHalf) return 'good';
  return 'miss';
}

export const kmhOf = (s: SimState): number => Math.max(0, s.speed) * 3.6;

/** いまの速度上限 (km/h)。T字路を曲がり終えるまでは低い */
export function speedCapKmh(s: SimState): number {
  return s.mode === 'west' ? DRIVE.maxKmh : DRIVE.preTurnCapKmh;
}

const JZ = ROAD.junctionZ;
/** 曲がり始める z（ここで向きを決める） */
export const TURN_Z = JZ + DRIVE.turnRadius;

/** 判定地点までの道のり (m)。T字路の手前なら、T字路までの距離も足す */
export function distToCheckpoint(s: SimState): number {
  if (s.mode === 'west' || s.mode === 'turn') return Math.max(0, s.pos.x - CHECKPOINT.x);
  return Math.max(0, s.pos.z - JZ) + Math.max(0, -CHECKPOINT.x);
}

/** 「← 左折」を出す区間か（T字路の手前で、まだ曲がっていない） */
export function turnHintActive(s: SimState): boolean {
  if (s.mode === 'north') return s.pos.z <= TURN_Z + DRIVE.turnHintDist;
  return s.mode === 'bounce' || s.mode === 'recover';
}

const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

function bounce(s: SimState, where: 'east' | 'north', out: SimEvent[]): void {
  out.push({ type: 'bounce', where, kmh: kmhOf(s) });
  s.speed = -DRIVE.bounceSpeed;
  s.pendingKmh = 0;
  s.mode = 'bounce';
  s.bounceT = DRIVE.bounceTime;
  s.latVel = 0;
}

/** 1ステップ進める。起きたことを返す（音・演出・HUD は drive.ts が受ける） */
export function stepSim(s: SimState, inp: SimInput, dt: number): SimEvent[] {
  const out: SimEvent[] = [];
  if (dt <= 0) return out;
  const steerIn = Math.max(-1, Math.min(1, inp.steer));

  // ---- タイミングバー
  s.cursorT += dt;
  s.cooldown = Math.max(0, s.cooldown - dt);
  if (inp.press) {
    s.presses++;
    if (s.cooldown > 0) {
      // クールダウン中の連打：ミス扱いで待ち時間が延びる
      s.cooldown = Math.max(s.cooldown, DRIVE.cooldownSpam);
      s.misses++;
      out.push({ type: 'boost', quality: 'miss', kmh: kmhOf(s) });
    } else {
      const q = judge(cursorAt(s.cursorT));
      s.cooldown = q === 'miss' ? DRIVE.cooldownMiss : DRIVE.cooldownHit;
      if (q === 'perfect') { s.pendingKmh += DRIVE.gainPerfect; s.perfects++; }
      else if (q === 'good') { s.pendingKmh += DRIVE.gainGood; s.goods++; }
      else s.misses++;
      out.push({ type: 'boost', quality: q, kmh: kmhOf(s) + s.pendingKmh });
    }
  }

  // ---- 速度：加速 → 転がり抵抗 → 上限
  if (s.mode !== 'bounce') {
    const d = s.pendingKmh * (1 - Math.exp(-dt / DRIVE.boostTau));
    s.pendingKmh -= d;
    s.speed += d / 3.6;
    if (s.speed > 0) s.speed = Math.max(0, s.speed - ((DRIVE.drag0 + DRIVE.drag1 * kmhOf(s)) / 3.6) * dt);
    const cap = speedCapKmh(s) / 3.6;
    if (s.speed > cap) s.speed = cap;
  }

  // ---- 舵（見た目用のなめらかな値）
  s.steer += (steerIn - s.steer) * (1 - Math.exp(-9 * dt));

  const p = s.pos;
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  const lat = (): number => {
    const target = steerIn * DRIVE.latSpeed * Math.min(1, Math.max(0, s.speed) / DRIVE.latFullSpeed);
    s.latVel += (target - s.latVel) * (1 - Math.exp(-10 * dt));
    return s.latVel * dt;
  };

  switch (s.mode) {
    case 'north': {
      p.x += lat();
      if (p.x > DRIVE.latMax) { p.x = DRIVE.latMax; s.latVel = 0; } else if (p.x < -DRIVE.latMax) { p.x = -DRIVE.latMax; s.latVel = 0; }
      p.z += fz * s.speed * dt;
      // 曲がる指示を受け付ける区間：舵を倒した向きを覚えておく
      if (p.z <= TURN_Z + DRIVE.turnWindow && Math.abs(steerIn) > 0.5) s.intent = steerIn < 0 ? -1 : 1;
      if (p.z <= TURN_Z && s.intent !== 0) {
        s.mode = 'turn';
        s.turnDir = s.intent;
        s.turnPhi = 0;
        s.turnCx = p.x + s.turnDir * DRIVE.turnRadius;
        s.turnCz = TURN_Z;
        p.z = TURN_Z;
        out.push({ type: 'turnStart', dir: s.turnDir });
      } else if (p.z <= JZ - DRIVE.northWall) {
        p.z = JZ - DRIVE.northWall;
        bounce(s, 'north', out);
      }
      break;
    }
    case 'turn': {
      s.turnPhi = Math.min(Math.PI / 2, s.turnPhi + (Math.max(0, s.speed) / DRIVE.turnRadius) * dt);
      const phi = s.turnPhi, R = DRIVE.turnRadius;
      if (s.turnDir === -1) {
        // 左折：円の中心は進行方向の左（西）
        p.x = s.turnCx + R * Math.cos(phi); p.z = s.turnCz - R * Math.sin(phi); s.yaw = phi;
      } else {
        p.x = s.turnCx - R * Math.cos(phi); p.z = s.turnCz - R * Math.sin(phi); s.yaw = -phi;
      }
      if (phi >= Math.PI / 2) {
        if (s.turnDir === -1) {
          s.mode = 'west'; s.yaw = Math.PI / 2; p.z = JZ; s.junctionDone = true; s.intent = 0;
          out.push({ type: 'junctionDone' });
        } else {
          s.mode = 'east'; s.yaw = -Math.PI / 2; p.z = JZ;
        }
      }
      break;
    }
    case 'east': {
      p.x += s.speed * dt;
      if (p.x >= ROAD.eastFenceX - DRIVE.eastWallGap) { p.x = ROAD.eastFenceX - DRIVE.eastWallGap; bounce(s, 'east', out); }
      break;
    }
    case 'bounce': {
      p.x += fx * s.speed * dt;
      p.z += fz * s.speed * dt;
      s.bounceT -= dt;
      s.speed *= Math.exp(-3.5 * dt);
      if (s.bounceT <= 0) { s.mode = 'recover'; s.speed = 1.5; s.intent = 0; }
      break;
    }
    case 'recover': {
      // 左へ旋回して西向きに立て直す（東向きからは北を経由して半回転）
      s.speed = Math.min(DRIVE.recoverSpeed, s.speed + 9 * dt);
      const need = (((Math.PI / 2 - s.yaw) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const step = DRIVE.recoverTurnRate * dt;
      if (need <= step || need > Math.PI * 1.5) {
        s.yaw = Math.PI / 2;
        s.mode = 'west';
        s.junctionDone = true;
        s.intent = 0;
        p.z = Math.max(JZ - DRIVE.latMax, Math.min(JZ + DRIVE.latMax, p.z));
        out.push({ type: 'junctionDone' });
      } else s.yaw = wrapPi(s.yaw + step);
      p.x += -Math.sin(s.yaw) * s.speed * dt;
      p.z += -Math.cos(s.yaw) * s.speed * dt;
      break;
    }
    case 'west': {
      // 西向き：右手は北（-Z）。右に切ると z が減る
      p.z -= lat();
      const lo = JZ - DRIVE.latMax, hi = JZ + DRIVE.latMax;
      if (p.z > hi) { p.z = hi; s.latVel = 0; } else if (p.z < lo) { p.z = lo; s.latVel = 0; }
      p.x -= s.speed * dt;
      if (!s.checkpointDone && p.x < CHECKPOINT.x) {
        s.checkpointDone = true;
        out.push({ type: 'checkpoint', kmh: kmhOf(s) });
      }
      break;
    }
  }
  return out;
}
