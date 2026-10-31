import type { World } from '../core/types';
import type { EventBus, GameEvents } from '../core/events';
import { CHARACTER, ENEMIES, LOCKDOWN } from '../config/balance';
import { moveSpeed } from '../progression/effects';
import { SfxGate, clamp01, stepPulse, type SfxPolicy } from './gate';
import { tone, noise, createLoop, type Eng, type Loop, type LoopName } from './synth';

/* ------------------------------------------------------------------ */
/* 設定                                                               */
/* ------------------------------------------------------------------ */

const MASTER_GAIN = 0.5;
/** エンジン音が最高になる速度（340km/h を m/s に） */
const ENGINE_MAX_MPS = 340 / 3.6;
/** 電力25%以下の警告ビープ間隔（秒） */
const LOW_POWER_INTERVAL = 2;
const LOW_POWER_RATIO = 0.25;

/** SE ごとの間引き・同時発音数。ここに無いものは制限なし */
const SFX_POLICY: Record<string, SfxPolicy> = {
  shot: { maxVoices: 4 },
  enemyHit: { minInterval: 0.03, maxVoices: 8 },
  impact: { minInterval: 0.02, maxVoices: 6 },
  enemyKilled: { maxVoices: 6 },
  enemyAttack: { minInterval: 0.1, maxVoices: 4 },
  playerHit: { minInterval: 0.08, maxVoices: 2 },
  noEnergy: { minInterval: 0.3 },
  charging: { minInterval: 0.12, maxVoices: 2 },
  explosion: { maxVoices: 3 },
  uiClick: { minInterval: 0.05 },
  lowPowerBeep: { minInterval: 0.5 },
  heartbeat: { minInterval: 0.4 },
  footstep: { minInterval: 0.12, maxVoices: 2 },
  metalPickup: { minInterval: 0.05, maxVoices: 3 },
  armGrab: { minInterval: 0.1, maxVoices: 2 },
  enemyNotice: { minInterval: 0.6, maxVoices: 1 },
  walkerShot: { minInterval: 0.08, maxVoices: 3 },
  missileLaunch: { minInterval: 0.05, maxVoices: 6 },
  missileLoad: { minInterval: 0.1, maxVoices: 3 },
  missileBeep: { minInterval: 0.1, maxVoices: 2 },
  missileDown: { minInterval: 0.04, maxVoices: 4 },
  missileBlast: { minInterval: 0.05, maxVoices: 3 },
  missileDisrupt: { minInterval: 0.3 },
  summon: { minInterval: 0.3, maxVoices: 2 },
  crawlerDodge: { minInterval: 0.1, maxVoices: 3 },
  domeDeploy: { minInterval: 0.3, maxVoices: 2 },
  domeBreak: { minInterval: 0.2, maxVoices: 2 },
  ringWarn: { minInterval: 0.3, maxVoices: 2 },
  ringFire: { minInterval: 0.2, maxVoices: 3 },
  healStart: { minInterval: 0.4, maxVoices: 2 },
  stompWindup: { maxVoices: 2 },
  stomp: { maxVoices: 2 },
  chargeStart: { maxVoices: 2 },
  wallCrash: { maxVoices: 2 },
  zoneWave: { minInterval: 0.5 },
  gearPickup: { maxVoices: 2 },
  interactPrompt: { minInterval: 0.3 },
  padEmpty: { minInterval: 0.6 },
  flightFail: { minInterval: 0.5 },
  wakeWarn: { minInterval: 0.15, maxVoices: 3 },
  emerge: { minInterval: 0.1, maxVoices: 3 },
  uiMove: { minInterval: 0.03, maxVoices: 2 },
  uiConfirm: { minInterval: 0.06, maxVoices: 2 },
  uiDenied: { minInterval: 0.15, maxVoices: 2 },
  upgrade: { minInterval: 0.1, maxVoices: 2 },
  boostPerfect: { minInterval: 0.1, maxVoices: 2 },
  boostGood: { minInterval: 0.1, maxVoices: 2 },
  boostMiss: { minInterval: 0.1, maxVoices: 2 },
  driveHit: { minInterval: 0.04, maxVoices: 5 },
  driveBump: { minInterval: 0.2, maxVoices: 2 },
  driveCrash: { maxVoices: 2 },
  driveCheckpoint: { maxVoices: 2 },
  fenceBreak: { maxVoices: 2 },
  carWallCrash: { maxVoices: 2 },
  carCaught: { maxVoices: 2 },
  slowmo: { maxVoices: 2 },
  vacuumStart: { maxVoices: 1 },
  vacuumEnd: { maxVoices: 1 },
  skillSelect: { minInterval: 0.05, maxVoices: 2 },
  skillDenied: { minInterval: 0.2 },
  weaponSwitch: { minInterval: 0.06, maxVoices: 2 },
};

/* ------------------------------------------------------------------ */
/* 状態（AudioContext 等の音声リソースのみ。ゲーム状態は持たない）          */
/* ------------------------------------------------------------------ */

interface AudioDebug {
  /** AudioContext の state（無い環境では 'none'） */
  ctxState: string;
  /** 最後に発音を許可された SE 名 */
  lastSfx: string | null;
  /** SE 名 → 発音を許可された回数 */
  played: Record<string, number>;
  /** SE 名 → 間引き・同時発音制限で捨てられた回数 */
  suppressed: Record<string, number>;
  /** 継続音が鳴っているか */
  loops: Record<LoopName, boolean>;
  /** 低電力警告ビープの回数 */
  lowPowerBeeps: number;
  /** 同名SEの現在の発音数（発音区間が終わっていないもの） */
  activeVoices: (name: string) => number;
  /** 最後に発生したエラー（無ければ null） */
  lastError: string | null;
}

let engine: Eng | null = null;
let gate: SfxGate = new SfxGate(SFX_POLICY);
let loops: Partial<Record<LoopName, Loop>> = {};
let lowPowerAcc = 0;
/** 閉じ込め戦の進行中（サイレン用） */
let lockdownOn = 0;
let unsubscribers: Array<() => void> = [];
let warnedError = false;
/** 聞き手（プレイヤー）の位置。距離減衰に使う */
let listener: { x: number; y: number; z: number } | null = null;
let hpLowAcc = 0;
let footAcc = 0;
let sirenT = 0;
/** サイレン1回（ウーー↑↓）の長さ。synth.ts の SirenLoop の LFO 0.62Hz に合わせる */
const SIREN_PERIOD = 1 / 0.62;
let debug: AudioDebug = makeDebug();

function makeDebug(): AudioDebug {
  return {
    get ctxState() { return engine?.ctx.state ?? 'none'; },
    lastSfx: null,
    played: {},
    suppressed: {},
    loops: { absorb: false, overload: false, flight: false, charge: false, scouter: false, siren: false, engine: false },
    lowPowerBeeps: 0,
    activeVoices: (name: string) => gate.activeVoices(name, nowSec()),
    lastError: null,
  };
}

/** 距離減衰（0.2〜1）。聞き手が不明なら 1 */
function att(pos?: { x: number; y: number; z: number }): number {
  if (!listener || !pos) return 1;
  const d = Math.hypot(pos.x - listener.x, pos.y - listener.y, pos.z - listener.z);
  return Math.min(1, Math.max(0.2, 1.1 - d / 45));
}

function nowSec(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

function reportError(where: string, e: unknown): void {
  debug.lastError = `${where}: ${String(e)}`;
  if (!warnedError) {
    warnedError = true;
    console.warn(`[audio] ${where} failed; sound disabled for this step`, e);
  }
}

/* ------------------------------------------------------------------ */
/* 初期化・再開                                                        */
/* ------------------------------------------------------------------ */

function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** 音声の SE を発音する。間引き・同時発音制限を通ったものだけ合成する */
function play(name: string, duration: number, fn: (x: Eng, t: number) => void): void {
  if (!engine) return;
  if (!gate.tryPlay(name, nowSec(), duration)) {
    debug.suppressed[name] = (debug.suppressed[name] ?? 0) + 1;
    return;
  }
  debug.lastSfx = name;
  debug.played[name] = (debug.played[name] ?? 0) + 1;
  try {
    fn(engine, engine.ctx.currentTime);
  } catch (e) {
    reportError(`sfx ${name}`, e);
  }
}

export function initAudio(events: EventBus): void {
  // 2回目以降の呼び出しでは前回の購読を外す（HMR 対策）
  for (const u of unsubscribers) u();
  unsubscribers = [];
  stopAllLoops();

  let ctx: AudioContext | null = null;
  try {
    const AC = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    if (AC) ctx = new AC() as AudioContext;
  } catch (e) {
    reportError('AudioContext', e);
    ctx = null;
  }
  engine = null;
  if (ctx) {
    try {
      const master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 12;
      comp.ratio.value = 3;
      comp.attack.value = 0.005;
      comp.release.value = 0.2;
      master.connect(comp);
      comp.connect(ctx.destination);
      engine = { ctx, master, noise: createNoiseBuffer(ctx) };
    } catch (e) {
      reportError('audio graph', e);
      engine = null;
    }
  }

  debug = makeDebug();
  (globalThis as any).__audioDebug = debug;
  // AudioContext が無くても購読はする（play が何もしないだけ）
  subscribe(events);
}

/** ユーザー操作後に呼ぶ。AudioContext を再開する（失敗しても無視） */
export function resumeAudio(): void {
  try {
    const p = engine?.ctx.resume();
    if (p && typeof p.catch === 'function') p.catch((e: unknown) => reportError('resume', e));
  } catch (e) {
    reportError('resume', e);
  }
}

/* ------------------------------------------------------------------ */
/* EventBus の購読 → SE                                                */
/* ------------------------------------------------------------------ */

function sub<K extends keyof GameEvents>(events: EventBus, name: K, fn: (p: GameEvents[K]) => void): void {
  unsubscribers.push(events.on(name, (p) => {
    try { fn(p); } catch (e) { reportError(`event ${String(name)}`, e); }
  }));
}

function subscribe(events: EventBus): void {
  // --- 銃 ---
  sub(events, 'shot', (p) => {
    if (p.charged) {
      const k = clamp01(p.power);
      play('shot', 0.4, (x, t) => {
        tone(x, t, { type: 'sine', f: 140 + 40 * k, f2: 55, dur: 0.35, gain: 0.25 + 0.3 * k, attack: 0.004 });
        noise(x, t, { dur: 0.25, gain: 0.05 + 0.12 * k, attack: 0.003, filter: { type: 'bandpass', f: 2600, f2: 700, q: 1.2 } });
      });
    } else {
      play('shot', 0.08, (x, t) => {
        tone(x, t, { type: 'triangle', f: 1400, f2: 500, dur: 0.08, gain: 0.16, attack: 0.002 });
      });
    }
  });
  sub(events, 'chargeStart', () => play('chargeStart', 0.25, (x, t) => {
    tone(x, t, { type: 'sine', f: 300, f2: 700, dur: 0.25, gain: 0.1, attack: 0.02 });
  }));
  sub(events, 'chargeFull', () => play('chargeFull', 0.4, (x, t) => {
    tone(x, t, { type: 'triangle', f: 1320, dur: 0.25, gain: 0.13 });
    tone(x, t, { type: 'sine', f: 1760, at: 0.06, dur: 0.3, gain: 0.12 });
  }));
  sub(events, 'chargeCancel', () => play('chargeCancel', 0.18, (x, t) => {
    tone(x, t, { type: 'triangle', f: 600, f2: 250, dur: 0.18, gain: 0.1 });
  }));

  // --- 動作 ---
  sub(events, 'dodge', () => play('dodge', 0.18, (x, t) => {
    noise(x, t, { dur: 0.18, gain: 0.2, attack: 0.02, filter: { type: 'bandpass', f: 800, f2: 4000, q: 1.5 } });
  }));
  sub(events, 'jump', () => play('jump', 0.12, (x, t) => {
    tone(x, t, { type: 'sine', f: 260, f2: 420, dur: 0.12, gain: 0.18 });
  }));
  sub(events, 'land', () => play('land', 0.08, (x, t) => {
    tone(x, t, { type: 'sine', f: 150, f2: 110, dur: 0.08, gain: 0.12 });
  }));
  sub(events, 'flightStart', () => play('flightStart', 0.35, (x, t) => {
    noise(x, t, { dur: 0.35, gain: 0.14, attack: 0.1, filter: { type: 'lowpass', f: 400, f2: 2000, q: 0.8 } });
    tone(x, t, { type: 'sine', f: 300, f2: 600, dur: 0.35, gain: 0.05 });
  }));
  sub(events, 'flightEnd', () => play('flightEnd', 0.3, (x, t) => {
    noise(x, t, { dur: 0.3, gain: 0.12, attack: 0.01, filter: { type: 'lowpass', f: 2000, f2: 300, q: 0.8 } });
  }));

  // --- 命中・撃破・被弾 ---
  sub(events, 'impact', () => play('impact', 0.05, (x, t) => {
    noise(x, t, { dur: 0.04, gain: 0.18, attack: 0.002, filter: { type: 'highpass', f: 3000 } });
    tone(x, t, { type: 'triangle', f: 900, dur: 0.03, gain: 0.08 });
  }));
  sub(events, 'enemyHit', (p) => {
    if (p.weak) {
      play('enemyHit', 0.15, (x, t) => {
        tone(x, t, { type: 'triangle', f: 2200, f2: 2400, dur: 0.14, gain: 0.16 });
        tone(x, t, { type: 'sine', f: 3300, dur: 0.1, gain: 0.04 });
      });
    } else {
      play('enemyHit', 0.09, (x, t) => {
        tone(x, t, { type: 'triangle', f: 1400, f2: 1100, dur: 0.09, gain: 0.15 });
      });
    }
  });
  sub(events, 'enemyKilled', (p) => {
    switch (p.how) {
      case 'shot':
        play('enemyKilled', 0.25, (x, t) => {
          tone(x, t, { type: 'sine', f: 220, f2: 60, dur: 0.25, gain: 0.25 });
          noise(x, t, { dur: 0.22, gain: 0.2, filter: { type: 'lowpass', f: 1200, f2: 200 } });
        });
        break;
      case 'absorb':
        // 電源が落ちる下降音
        play('enemyKilled', 0.6, (x, t) => {
          tone(x, t, { type: 'sawtooth', f: 900, f2: 120, dur: 0.6, gain: 0.09, filter: { type: 'lowpass', f: 2000, f2: 300 } });
        });
        break;
      case 'explosion':
        play('enemyKilled', 0.6, (x, t) => {
          tone(x, t, { type: 'sine', f: 120, f2: 40, dur: 0.6, gain: 0.35 });
          noise(x, t, { dur: 0.6, gain: 0.3, filter: { type: 'lowpass', f: 900, f2: 100 } });
        });
        break;
    }
  });
  sub(events, 'enemyAttack', (p) => {
    // ウォーカー・ミサイルは専用。ヘビーウォーカーは enemyAction 側
    if (p.kind === 'walker' || p.kind === 'redWalker') { onWalkerShot(p.pos); return; }
    if (p.kind === 'missile' || p.kind === 'missileDrone') { onMissileLaunch(p.pos); return; }
    // ビーマーは beamFire 側で鳴らす
    if (p.kind === 'beamer') return;
    if (p.kind === 'jumper') { onJumperThrust(p.pos); return; }
    if (p.kind === 'bomber') { onBomberThrow(p.pos); return; }
    if (p.kind === 'heavyWalker') return;
    // 攻撃の予兆。種類ごとに音色を変える
    play('enemyAttack', 0.45, (x, t) => {
      switch (p.kind) {
        case 'drone':
        case 'redDrone':
          tone(x, t, { type: 'triangle', f: 330, dur: 0.1, gain: 0.1 });
          tone(x, t, { type: 'triangle', f: 330, at: 0.14, dur: 0.1, gain: 0.1 });
          break;
        case 'crawler':
          tone(x, t, { type: 'sine', f: 260, f2: 200, dur: 0.18, gain: 0.12 });
          break;
        case 'gunner':
          tone(x, t, { type: 'triangle', f: 440, dur: 0.08, gain: 0.1 });
          tone(x, t, { type: 'triangle', f: 440, at: 0.1, dur: 0.08, gain: 0.1 });
          tone(x, t, { type: 'triangle', f: 440, at: 0.2, dur: 0.08, gain: 0.1 });
          break;
        case 'heavy':
          tone(x, t, { type: 'sine', f: 110, f2: 90, dur: 0.45, gain: 0.3 });
          noise(x, t, { dur: 0.3, gain: 0.04, filter: { type: 'lowpass', f: 200 } });
          break;
        case 'boss':
          tone(x, t, { type: 'sine', f: 150, dur: 0.5, gain: 0.2 });
          tone(x, t, { type: 'triangle', f: 300, at: 0.2, dur: 0.25, gain: 0.08 });
          break;
      }
    });
  });
  sub(events, 'playerHit', () => play('playerHit', 0.25, (x, t) => {
    tone(x, t, { type: 'sine', f: 90, f2: 50, dur: 0.25, gain: 0.3 });
    noise(x, t, { dur: 0.12, gain: 0.15, filter: { type: 'lowpass', f: 500 } });
  }));

  // --- 吸収アーム ---
  sub(events, 'absorbFire', () => play('absorbFire', 0.22, (x, t) => {
    tone(x, t, { type: 'triangle', f: 300, f2: 1500, dur: 0.22, gain: 0.12 });
    noise(x, t, { dur: 0.2, gain: 0.05, filter: { type: 'bandpass', f: 1000, f2: 3000, q: 1 } });
  }));
  sub(events, 'absorbAttach', () => play('absorbAttach', 0.08, (x, t) => {
    tone(x, t, { type: 'triangle', f: 1200, dur: 0.03, gain: 0.14 });
    noise(x, t, { dur: 0.05, gain: 0.16, filter: { type: 'bandpass', f: 2000, q: 3 } });
    tone(x, t, { type: 'triangle', f: 500, at: 0.02, dur: 0.06, gain: 0.1 });
  }));
  sub(events, 'absorbBreak', () => play('absorbBreak', 0.12, (x, t) => {
    tone(x, t, { type: 'triangle', f: 500, f2: 120, dur: 0.1, gain: 0.18 });
    noise(x, t, { dur: 0.06, gain: 0.1, filter: { type: 'lowpass', f: 400 } });
  }));
  // --- グラップル ---
  sub(events, 'grappleFire', () => play('grappleFire', 0.2, (x, t) => {
    tone(x, t, { type: 'sawtooth', f: 500, f2: 2400, dur: 0.16, gain: 0.07, filter: { type: 'lowpass', f: 3000 } });
    noise(x, t, { dur: 0.14, gain: 0.05, filter: { type: 'bandpass', f: 3500, q: 1.5 } });
  }));
  sub(events, 'grappleAttach', () => play('grappleAttach', 0.7, (x, t) => {
    // ガシャッと刺さる＋ワイヤーを巻き取るうなり（上がっていく）
    tone(x, t, { type: 'square', f: 180, f2: 90, dur: 0.07, gain: 0.16 });
    noise(x, t, { dur: 0.06, gain: 0.18, filter: { type: 'bandpass', f: 1800, q: 4 } });
    tone(x, t, { type: 'sawtooth', f: 220, f2: 900, at: 0.05, dur: 0.5, gain: 0.07, filter: { type: 'lowpass', f: 1800 } });
    noise(x, t, { at: 0.05, dur: 0.5, gain: 0.04, filter: { type: 'bandpass', f: 2500, f2: 5000, q: 1 } });
  }));
  sub(events, 'grappleArrive', () => play('grappleArrive', 0.2, (x, t) => {
    tone(x, t, { type: 'sine', f: 140, f2: 60, dur: 0.18, gain: 0.25 });
    noise(x, t, { dur: 0.08, gain: 0.12, filter: { type: 'lowpass', f: 900 } });
  }));
  sub(events, 'absorbComplete', () => play('absorbComplete', 0.5, (x, t) => {
    // 満足感のある上昇アルペジオ
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => tone(x, t, { type: 'triangle', f, at: i * 0.07, dur: 0.22, gain: 0.13 }));
  }));

  // --- 逆流・爆発・ボス ---
  sub(events, 'overloadStart', () => play('overloadStart', 0.3, (x, t) => {
    tone(x, t, { type: 'sawtooth', f: 200, f2: 500, dur: 0.3, gain: 0.1, filter: { type: 'lowpass', f: 1500 } });
  }));
  sub(events, 'overloadEnd', () => play('overloadEnd', 0.25, (x, t) => {
    tone(x, t, { type: 'sawtooth', f: 500, f2: 150, dur: 0.25, gain: 0.1, filter: { type: 'lowpass', f: 1500 } });
  }));
  sub(events, 'explosion', (p) => play('explosion', 0.8, (x, t) => {
    const s = Math.min(1.4, Math.max(0.7, p.radius / 6));
    tone(x, t, { type: 'sine', f: 110 * s, f2: 35, dur: 0.7, gain: 0.4 });
    noise(x, t, { dur: 0.8, gain: 0.3, filter: { type: 'lowpass', f: 1000, f2: 80 } });
  }));
  sub(events, 'bossShort', () => play('bossShort', 0.6, (x, t) => {
    for (let i = 0; i < 4; i++) {
      noise(x, t, { at: i * 0.05, dur: 0.03, gain: 0.2, filter: { type: 'highpass', f: 2000 } });
    }
    tone(x, t, { type: 'triangle', f: 800, f2: 200, dur: 0.5, gain: 0.15 });
  }));

  // --- 機能・電力 ---
  // スカウターの切り替えは無音
  sub(events, 'functionToggle', (p) => p.name !== 'scouter' && play('functionToggle', 0.2, (x, t) => {
    if (p.on) {
      tone(x, t, { type: 'sine', f: 660, dur: 0.08, gain: 0.14 });
      tone(x, t, { type: 'sine', f: 990, at: 0.07, dur: 0.12, gain: 0.14 });
    } else {
      tone(x, t, { type: 'sine', f: 990, dur: 0.08, gain: 0.14 });
      tone(x, t, { type: 'sine', f: 660, at: 0.07, dur: 0.12, gain: 0.14 });
    }
  }));
  sub(events, 'energyLow', () => play('energyLow', 0.3, (x, t) => {
    tone(x, t, { type: 'triangle', f: 660, dur: 0.12, gain: 0.14 });
    tone(x, t, { type: 'triangle', f: 520, at: 0.14, dur: 0.14, gain: 0.14 });
  }));
  sub(events, 'energyEmpty', () => play('energyEmpty', 0.9, (x, t) => {
    tone(x, t, { type: 'sine', f: 220, f2: 40, dur: 0.9, gain: 0.2 });
    tone(x, t, { type: 'sawtooth', f: 400, f2: 60, dur: 0.9, gain: 0.05, filter: { type: 'lowpass', f: 400, f2: 80 } });
  }));
  sub(events, 'noEnergy', () => play('noEnergy', 0.2, (x, t) => {
    tone(x, t, { type: 'square', f: 180, dur: 0.07, gain: 0.05, filter: { type: 'lowpass', f: 600 } });
    tone(x, t, { type: 'square', f: 180, at: 0.1, dur: 0.07, gain: 0.05, filter: { type: 'lowpass', f: 600 } });
  }));
  sub(events, 'charging', (p) => play('charging', 0.1, (x, t) => {
    const g = 0.03 + 0.04 * clamp01(p.amount / 10);
    noise(x, t, { dur: 0.03, gain: g, filter: { type: 'bandpass', f: 5000, q: 2 } });
    noise(x, t, { at: 0.05, dur: 0.03, gain: g * 0.7, filter: { type: 'bandpass', f: 6500, q: 2 } });
  }));
  sub(events, 'repair', () => play('repair', 0.3, (x, t) => {
    [1046, 1318, 1568, 2093].forEach((f, i) => tone(x, t, { type: 'sine', f, at: i * 0.05, dur: 0.2, gain: 0.1 }));
  }));

  // --- ルーム・ドア ---
  sub(events, 'roomEnter', () => play('roomEnter', 0.5, (x, t) => {
    tone(x, t, { type: 'sine', f: 880, dur: 0.4, gain: 0.12 });
    tone(x, t, { type: 'sine', f: 1320, at: 0.12, dur: 0.5, gain: 0.12 });
  }));
  sub(events, 'roomClear', () => play('roomClear', 0.6, (x, t) => {
    tone(x, t, { type: 'triangle', f: 523, dur: 0.12, gain: 0.14 });
    tone(x, t, { type: 'triangle', f: 659, at: 0.12, dur: 0.12, gain: 0.14 });
    tone(x, t, { type: 'triangle', f: 784, at: 0.24, dur: 0.3, gain: 0.14 });
  }));
  sub(events, 'doorClose', () => play('doorClose', 1.0, (x, t) => {
    // ガシャン＋ゴゴゴ（閉まる）
    tone(x, t, { type: 'sawtooth', f: 45, f2: 60, dur: 0.6, gain: 0.2, filter: { type: 'lowpass', f: 200 } });
    noise(x, t, { at: 0.5, dur: 0.18, gain: 0.25, filter: { type: 'lowpass', f: 900 } });
    tone(x, t, { type: 'sine', f: 90, f2: 40, at: 0.5, dur: 0.3, gain: 0.3, attack: 0.002 });
  }));
  sub(events, 'lockdownStart', () => { lockdownOn++; sirenT = 0; });
  sub(events, 'lockdownEnd', () => { lockdownOn = Math.max(0, lockdownOn - 1); });
  sub(events, 'doorOpen', () => play('doorOpen', 1.0, (x, t) => {
    // プシュー＋ゴゴゴ
    noise(x, t, { dur: 0.5, gain: 0.12, attack: 0.08, filter: { type: 'highpass', f: 1500 } });
    tone(x, t, { type: 'sawtooth', f: 60, f2: 45, dur: 1.0, gain: 0.2, filter: { type: 'lowpass', f: 200 } });
  }));

  // --- ボス・ゲーム状態 ---
  sub(events, 'bossStart', () => play('bossStart', 1.4, (x, t) => {
    for (let i = 0; i < 3; i++) {
      tone(x, t, { type: 'triangle', f: i % 2 === 0 ? 220 : 165, at: i * 0.35, dur: 0.33, gain: 0.16 });
    }
    tone(x, t, { type: 'sine', f: 55, dur: 1.0, gain: 0.25 });
  }));
  sub(events, 'bossPhase', () => play('bossPhase', 1.2, (x, t) => {
    tone(x, t, { type: 'triangle', f: 300, f2: 900, dur: 0.4, gain: 0.15 });
    for (let i = 0; i < 2; i++) {
      tone(x, t, { type: 'triangle', f: i % 2 === 0 ? 220 : 165, at: 0.45 + i * 0.35, dur: 0.33, gain: 0.14 });
    }
  }));
  sub(events, 'gameStart', () => play('gameStart', 1.0, (x, t) => {
    tone(x, t, { type: 'sine', f: 200, f2: 1200, dur: 0.6, gain: 0.14 });
    noise(x, t, { dur: 0.6, gain: 0.05, attack: 0.2, filter: { type: 'highpass', f: 2000, f2: 6000 } });
    [523, 659, 784].forEach((f) => tone(x, t, { type: 'triangle', f, at: 0.4, dur: 0.5, gain: 0.08 }));
  }));
  sub(events, 'gameOver', () => play('gameOver', 1.3, (x, t) => {
    tone(x, t, { type: 'triangle', f: 520, f2: 90, dur: 1.2, gain: 0.2 });
    tone(x, t, { type: 'sine', f: 260, f2: 50, dur: 1.2, gain: 0.12 });
  }));
  sub(events, 'gameClear', () => play('gameClear', 1.5, (x, t) => {
    [523, 659, 784, 1046].forEach((f, i) => tone(x, t, { type: 'triangle', f, at: i * 0.12, dur: 0.2, gain: 0.13 }));
    [1046, 1318, 1568].forEach((f) => tone(x, t, { type: 'triangle', f, at: 0.5, dur: 0.9, gain: 0.1 }));
  }));
  sub(events, 'uiClick', () => play('uiClick', 0.05, (x, t) => {
    tone(x, t, { type: 'sine', f: 700, f2: 500, dur: 0.05, gain: 0.12 });
  }));
  subscribeNew(events);
  subscribeWake(events);
  subscribePhase3(events);
  subscribeUpgrade(events);
  subscribeDrive(events);
  subscribeSkill(events);
}

/* ------------------------------------------------------------------ */
/* 継続音                                                             */
/* ------------------------------------------------------------------ */

function stopAllLoops(): void {
  lockdownOn = 0;
  for (const k of Object.keys(loops) as LoopName[]) {
    loops[k]?.stop();
    delete loops[k];
  }
  for (const k of Object.keys(debug.loops) as LoopName[]) debug.loops[k] = false;
  lowPowerAcc = 0;
  hpLowAcc = 0;
}

function syncLoop(name: LoopName, ratio: number | null): void {
  const cur = loops[name];
  if (ratio === null) {
    if (cur) {
      cur.stop();
      delete loops[name];
    }
    debug.loops[name] = false;
    return;
  }
  if (!engine) return;
  if (!cur) {
    loops[name] = createLoop(name, engine);
  }
  loops[name]!.set(ratio);
  debug.loops[name] = true;
}

/** 毎フレーム呼ぶ。継続音の開始/停止と更新、低電力の警告ビープ */
export function updateAudio(world: World, dt: number): void {
  try {
    if (!engine) return;
    if (world.state !== 'playing') {
      stopAllLoops();
      return;
    }
    const p = world.player;
    const target = world.absorb.target;
    listener = { x: p.pos.x, y: p.pos.y, z: p.pos.z };

    // 吸収中（逆流していないとき）：ハム＋電気音
    const absorbing = world.absorb.phase === 'attached' && !p.overloading;
    syncLoop('absorb', absorbing ? 0.5 : null);

    // 逆流中：target の過負荷率でピッチ上昇
    let overloadRatio = 0;
    if (p.overloading && target) {
      const cap = ENEMIES[target.kind].overloadCap;
      overloadRatio = cap > 0 ? clamp01(target.overload / cap) : 0;
    }
    syncLoop('overload', p.overloading ? overloadRatio : null);

    syncLoop('flight', p.flying ? 0.5 : null);
    syncLoop('charge', p.charging ? clamp01(p.charge) : null);
    syncLoop('scouter', null); // スカウターは音なし
    // 車のエンジン：運転中（と演出中）は速度に合わせて鳴らし、それ以外は止める
    const drv = world.level.data.drive as { phase?: string; speed?: number } | undefined;
    const engineOn = !!drv && (drv.phase === 'driving' || drv.phase === 'cutscene');
    syncLoop('engine', engineOn ? Math.max(0.03, clamp01(Math.abs(drv!.speed ?? 0) / ENGINE_MAX_MPS)) : null);
    // サイレンは閉じ込め開始から LOCKDOWN.sirenCycles 回（1回≒1.6秒）鳴ったら止める
    sirenT += dt;
    const sirenOn = LOCKDOWN.enabled && lockdownOn > 0 && sirenT < LOCKDOWN.sirenCycles * SIREN_PERIOD;
    syncLoop('siren', sirenOn ? LOCKDOWN.sirenVolume : null);

    // 電力25%以下：2秒おきの小さな警告ビープ
    const lowPower = p.maxEnergy > 0 && p.energy / p.maxEnergy <= LOW_POWER_RATIO;
    const pulse = stepPulse(lowPowerAcc, dt, LOW_POWER_INTERVAL, lowPower);
    lowPowerAcc = pulse.acc;
    if (pulse.fire) {
      debug.lowPowerBeeps += 1;
      play('lowPowerBeep', 0.12, (x, t) => {
        tone(x, t, { type: 'sine', f: 1000, dur: 0.07, gain: 0.08 });
      });
    }

    // 足音（重量級：ドスドス）。地上を歩いた距離で鳴らす（半歩ごと＝ストライド/2）
    const sp = Math.hypot(p.vel.x, p.vel.z);
    if (p.onGround && !p.flying && sp > 0.8) {
      const run = sp > moveSpeed(world) * 1.15;
      const half = (run ? CHARACTER.anim.strideRun : CHARACTER.anim.strideWalk) / 2;
      footAcc += sp * dt;
      if (footAcc >= half) { footAcc -= half; playFootstep(run); }
    } else footAcc = Math.min(footAcc, 0.0);

    // HP25%以下：心音（ドクン、ドクン）
    const hpLow = p.maxHp > 0 && p.hp > 0 && p.hp / p.maxHp <= 0.25;
    const hb = stepPulse(hpLowAcc, dt, 1.1, hpLow);
    hpLowAcc = hb.acc;
    if (hb.fire) {
      play('heartbeat', 0.4, (x, t) => {
        tone(x, t, { type: 'sine', f: 80, f2: 45, dur: 0.14, gain: 0.22, attack: 0.005 });
        tone(x, t, { type: 'sine', f: 70, f2: 40, at: 0.17, dur: 0.16, gain: 0.16, attack: 0.005 });
      });
    }
  } catch (e) {
    reportError('updateAudio', e);
  }
}

/** 主人公の足音。重いサイボーグ：低いドスッ＋金属のカチャ。走りは強め */
let footAlt = false;
export function playFootstep(run: boolean): void {
  footAlt = !footAlt;
  const g = run ? 1.25 : 1;
  const pitch = footAlt ? 1 : 0.92; // 左右で少し変える
  play('footstep', 0.2, (x, t) => {
    tone(x, t, { type: 'sine', f: 95 * pitch, f2: 38, dur: 0.16, gain: 0.26 * g, attack: 0.003 });
    noise(x, t, { dur: 0.09, gain: 0.16 * g, attack: 0.002, filter: { type: 'lowpass', f: 700, f2: 150, q: 0.7 } });
    noise(x, t, { at: 0.012, dur: 0.035, gain: 0.04 * g, filter: { type: 'bandpass', f: 2600 * pitch, q: 3 } });
  });
}

/* ------------------------------------------------------------------ */
/* 追加分：新しい敵・ギミック                                           */
/* ------------------------------------------------------------------ */

type P3 = { x: number; y: number; z: number };

/** ウォーカー：単発の砲撃（ドローンより重く、ガンナーより軽い） */
function onWalkerShot(pos: P3): void {
  const a = att(pos);
  play('walkerShot', 0.3, (x, t) => {
    tone(x, t, { type: 'sine', f: 240, f2: 90, dur: 0.22, gain: 0.2 * a, attack: 0.003 });
    tone(x, t, { type: 'triangle', f: 700, f2: 300, dur: 0.1, gain: 0.1 * a });
    noise(x, t, { dur: 0.1, gain: 0.07 * a, filter: { type: 'bandpass', f: 2200, f2: 900, q: 1 } });
  });
}

/** ミサイル発射：1発ごとのシュッ（飛翔のヒス込み） */
function onMissileLaunch(pos: P3): void {
  const a = att(pos);
  play('missileLaunch', 0.5, (x, t) => {
    noise(x, t, { dur: 0.5, gain: 0.16 * a, attack: 0.04, filter: { type: 'bandpass', f: 500, f2: 3500, q: 0.9 } });
    tone(x, t, { type: 'sine', f: 180, f2: 420, dur: 0.3, gain: 0.07 * a });
    noise(x, t, { at: 0.2, dur: 0.3, gain: 0.04 * a, filter: { type: 'highpass', f: 3500 } });
  });
}

function onEnemyAction(p: GameEvents['enemyAction']): void {
  const a = att(p.pos);
  switch (p.action) {
    case 'crawlerDodge':
      play('crawlerDodge', 0.15, (x, t) => {
        noise(x, t, { dur: 0.1, gain: 0.12 * a, attack: 0.005, filter: { type: 'bandpass', f: 1800, f2: 4500, q: 2 } });
        tone(x, t, { type: 'triangle', f: 500, f2: 900, dur: 0.07, gain: 0.07 * a });
      });
      break;
    case 'stompWindup': {
      const d = Math.min(1.2, Math.max(0.5, p.value ?? 1));
      play('stompWindup', d, (x, t) => {
        tone(x, t, { type: 'sawtooth', f: 120, f2: 900, dur: d, gain: 0.07 * a, attack: 0.15, filter: { type: 'lowpass', f: 600, f2: 2500 } });
        tone(x, t, { type: 'sine', f: 60, f2: 160, dur: d, gain: 0.14 * a, attack: 0.2 });
      });
      break;
    }
    case 'stomp':
      play('stomp', 0.8, (x, t) => {
        tone(x, t, { type: 'sine', f: 95, f2: 32, dur: 0.5, gain: 0.45 * a, attack: 0.002 });
        noise(x, t, { dur: 0.35, gain: 0.25 * a, filter: { type: 'lowpass', f: 900, f2: 120 } });
        // 電撃のバチバチ＋床に残る電気
        for (let i = 0; i < 6; i++) {
          noise(x, t, { at: 0.02 + i * 0.09 + Math.random() * 0.04, dur: 0.04, gain: (0.16 - i * 0.02) * a, filter: { type: 'bandpass', f: 2500 + Math.random() * 3500, q: 3 } });
        }
        tone(x, t, { type: 'sawtooth', f: 1500, f2: 400, at: 0.05, dur: 0.5, gain: 0.04 * a, filter: { type: 'bandpass', f: 1800, q: 2 } });
      });
      break;
    case 'chargeStart':
      play('chargeStart', 0.7, (x, t) => {
        tone(x, t, { type: 'sawtooth', f: 70, f2: 220, dur: 0.6, gain: 0.12 * a, attack: 0.03, filter: { type: 'lowpass', f: 500, f2: 1600 } });
        tone(x, t, { type: 'square', f: 300, f2: 700, dur: 0.4, gain: 0.03 * a, filter: { type: 'lowpass', f: 1200 } });
        noise(x, t, { dur: 0.5, gain: 0.08 * a, attack: 0.05, filter: { type: 'bandpass', f: 900, f2: 2200, q: 1 } });
      });
      break;
    case 'wallCrash':
      play('wallCrash', 0.7, (x, t) => {
        tone(x, t, { type: 'sine', f: 120, f2: 45, dur: 0.35, gain: 0.35 * a, attack: 0.002 });
        noise(x, t, { dur: 0.15, gain: 0.2 * a, filter: { type: 'bandpass', f: 1500, q: 1.5 } });
        tone(x, t, { type: 'triangle', f: 880, f2: 760, at: 0.02, dur: 0.5, gain: 0.1 * a });
        tone(x, t, { type: 'sine', f: 1330, at: 0.02, dur: 0.4, gain: 0.05 * a });
        noise(x, t, { at: 0.15, dur: 0.05, gain: 0.1 * a, filter: { type: 'highpass', f: 4000 } });
      });
      break;
    case 'summon':
      // ワープ音：上がって下がる＋きらめき
      play('summon', 0.7, (x, t) => {
        tone(x, t, { type: 'sine', f: 400, f2: 1800, dur: 0.25, gain: 0.12 * a, attack: 0.01 });
        tone(x, t, { type: 'sine', f: 1800, f2: 600, at: 0.2, dur: 0.3, gain: 0.1 * a });
        [1568, 2093, 2637].forEach((f, i) => tone(x, t, { type: 'sine', f, at: 0.1 + i * 0.06, dur: 0.2, gain: 0.05 * a }));
        noise(x, t, { dur: 0.4, gain: 0.05 * a, attack: 0.1, filter: { type: 'highpass', f: 3000, f2: 6000 } });
      });
      break;
    case 'missileLoad': {
      // 溜めるほど音程が上がる装填音
      const k = clamp01(p.value ?? 0);
      play('missileLoad', 0.2, (x, t) => {
        const f = 400 + 700 * k;
        tone(x, t, { type: 'triangle', f, f2: f * 1.25, dur: 0.14, gain: 0.1 * a });
        noise(x, t, { dur: 0.04, gain: 0.07 * a, filter: { type: 'highpass', f: 3500 } });
      });
      break;
    }
    case 'missileBeep': {
      const k = clamp01(((p.value ?? 0.8) - 0.8) / 0.2);
      play('missileBeep', 0.08, (x, t) => {
        tone(x, t, { type: 'square', f: 1200 + 500 * k, dur: 0.06, gain: 0.035 * a, filter: { type: 'lowpass', f: 3000 } });
      });
      break;
    }
    case 'domeDeploy':
      // ドームが広がる：低い立ち上がり＋上昇するうなり（value=1 が展開の瞬間）
      if ((p.value ?? 0) >= 1) {
        play('domeDeploy', 0.8, (x, t) => {
          tone(x, t, { type: 'sine', f: 90, f2: 200, dur: 0.5, gain: 0.3 * a, attack: 0.01 });
          tone(x, t, { type: 'sawtooth', f: 300, f2: 1400, dur: 0.45, gain: 0.07 * a, attack: 0.02, filter: { type: 'lowpass', f: 1200, f2: 4000 } });
          noise(x, t, { dur: 0.4, gain: 0.07 * a, attack: 0.02, filter: { type: 'bandpass', f: 2500, q: 1.5 } });
        });
      } else {
        play('domeDeploy', 0.8, (x, t) => {
          tone(x, t, { type: 'sawtooth', f: 120, f2: 520, dur: 0.8, gain: 0.07 * a, attack: 0.1, filter: { type: 'lowpass', f: 600, f2: 2200 } });
          tone(x, t, { type: 'square', f: 440, at: 0.2, dur: 0.06, gain: 0.04 * a });
          tone(x, t, { type: 'square', f: 440, at: 0.4, dur: 0.06, gain: 0.04 * a });
          tone(x, t, { type: 'square', f: 440, at: 0.6, dur: 0.06, gain: 0.04 * a });
        });
      }
      break;
    case 'domeBreak':
      // ガラスのように割れる：ぱりん＋低いドン
      play('domeBreak', 0.8, (x, t) => {
        tone(x, t, { type: 'sine', f: 140, f2: 50, dur: 0.35, gain: 0.3 * a, attack: 0.002 });
        noise(x, t, { dur: 0.35, gain: 0.2 * a, attack: 0.002, filter: { type: 'highpass', f: 2500 } });
        for (let i = 0; i < 5; i++) tone(x, t, { type: 'triangle', f: 2200 + Math.random() * 2400, at: 0.02 + i * 0.045, dur: 0.12, gain: 0.05 * a });
      });
      break;
    case 'ringWarn':
      // 輪を出す前の充電：高くなっていくうなり
      play('ringWarn', 1.1, (x, t) => {
        tone(x, t, { type: 'sawtooth', f: 160, f2: 900, dur: 1.0, gain: 0.07 * a, attack: 0.15, filter: { type: 'lowpass', f: 700, f2: 3000 } });
        tone(x, t, { type: 'sine', f: 80, f2: 240, dur: 1.0, gain: 0.14 * a, attack: 0.2 });
      });
      break;
    case 'ringFire':
      // 輪が広がる：ボンッ＋外へ走る波
      play('ringFire', 0.7, (x, t) => {
        tone(x, t, { type: 'sine', f: 180, f2: 50, dur: 0.35, gain: 0.32 * a, attack: 0.002 });
        tone(x, t, { type: 'sawtooth', f: 1800, f2: 300, dur: 0.6, gain: 0.06 * a, attack: 0.005, filter: { type: 'bandpass', f: 1500, q: 2 } });
        noise(x, t, { dur: 0.3, gain: 0.1 * a, filter: { type: 'bandpass', f: 1200, f2: 300, q: 1 } });
      });
      break;
    case 'healStart':
      // 回復の開始：やさしい上昇音
      play('healStart', 0.4, (x, t) => {
        tone(x, t, { type: 'sine', f: 660, dur: 0.1, gain: 0.07 * a });
        tone(x, t, { type: 'sine', f: 880, at: 0.09, dur: 0.1, gain: 0.07 * a });
        tone(x, t, { type: 'sine', f: 1320, at: 0.18, dur: 0.18, gain: 0.06 * a });
      });
      break;
    case 'jumperLand':
      // 重い着地のドスン＋装甲が開くカシャ
      play('jumperLand', 0.5, (x, t) => {
        tone(x, t, { type: 'sine', f: 110, f2: 40, dur: 0.3, gain: 0.35 * a, attack: 0.002 });
        noise(x, t, { dur: 0.18, gain: 0.18 * a, filter: { type: 'lowpass', f: 800, f2: 150 } });
        tone(x, t, { type: 'triangle', f: 1200, f2: 1600, at: 0.08, dur: 0.06, gain: 0.06 * a });
        tone(x, t, { type: 'triangle', f: 1500, f2: 2000, at: 0.14, dur: 0.06, gain: 0.05 * a });
      });
      break;
    case 'bombBlast':
      // 電気の爆発：低いドン＋バチバチ
      play('bombBlast', 0.7, (x, t) => {
        tone(x, t, { type: 'sine', f: 130, f2: 40, dur: 0.45, gain: 0.4 * a, attack: 0.002 });
        noise(x, t, { dur: 0.4, gain: 0.25 * a, filter: { type: 'lowpass', f: 2500, f2: 200 } });
        for (let i = 0; i < 5; i++) {
          noise(x, t, { at: 0.03 + i * 0.07 + Math.random() * 0.03, dur: 0.035, gain: (0.14 - i * 0.02) * a, filter: { type: 'bandpass', f: 3000 + Math.random() * 3000, q: 3 } });
        }
      });
      break;
    case 'missileDisrupt':
      // 溜めが途切れるパワーダウン＋グリッチ
      play('missileDisrupt', 0.5, (x, t) => {
        tone(x, t, { type: 'sawtooth', f: 900, f2: 90, dur: 0.45, gain: 0.1 * a, filter: { type: 'lowpass', f: 2500, f2: 200 } });
        for (let i = 0; i < 4; i++) {
          noise(x, t, { at: i * 0.06, dur: 0.03, gain: 0.12 * a, filter: { type: 'bandpass', f: 1500 + i * 900, q: 4 } });
        }
      });
      break;
  }
}

function subscribeNew(events: EventBus): void {
  sub(events, 'enemyNotice', (p) => {
    // 気づき：短い警戒音（2音）。群れでも1回
    const a = att(p.pos);
    play('enemyNotice', 0.35, (x, t) => {
      tone(x, t, { type: 'triangle', f: 880, dur: 0.09, gain: 0.11 * a });
      tone(x, t, { type: 'triangle', f: 1175, at: 0.09, dur: 0.14, gain: 0.11 * a });
      tone(x, t, { type: 'sine', f: 2350, at: 0.09, dur: 0.1, gain: 0.03 * a });
    });
  });
  sub(events, 'enemyAction', onEnemyAction);
  sub(events, 'missileDown', (p) => {
    const a = att(p.pos);
    play('missileDown', 0.4, (x, t) => {
      // 撃ち落とした気持ちいいパン＋電気の破裂
      tone(x, t, { type: 'triangle', f: 1800, f2: 500, dur: 0.12, gain: 0.2 * a, attack: 0.002 });
      noise(x, t, { dur: 0.1, gain: 0.22 * a, attack: 0.002, filter: { type: 'highpass', f: 2500 } });
      tone(x, t, { type: 'sine', f: 220, f2: 80, dur: 0.25, gain: 0.2 * a });
      tone(x, t, { type: 'sine', f: 2093, at: 0.05, dur: 0.2, gain: 0.07 * a });
    });
  });
  sub(events, 'missileBlast', (p) => {
    const a = att(p.pos);
    play('missileBlast', 0.5, (x, t) => {
      tone(x, t, { type: 'sine', f: 140, f2: 45, dur: 0.4, gain: 0.3 * a, attack: 0.003 });
      noise(x, t, { dur: 0.4, gain: 0.25 * a, filter: { type: 'lowpass', f: 1400, f2: 150 } });
    });
  });

  // --- フロア1のギミック ---
  sub(events, 'gearPickup', () => play('gearPickup', 0.8, (x, t) => {
    // 明るい取得音（ピロリン＋きらめき）
    [988, 1319, 1976].forEach((f, i) => tone(x, t, { type: 'triangle', f, at: i * 0.07, dur: 0.28, gain: 0.13 }));
    [2637, 3136, 3951].forEach((f, i) => tone(x, t, { type: 'sine', f, at: 0.18 + i * 0.05, dur: 0.35, gain: 0.05 }));
    tone(x, t, { type: 'sine', f: 330, f2: 660, dur: 0.15, gain: 0.08 });
  }));
  sub(events, 'interactPrompt', () => play('interactPrompt', 0.05, (x, t) => {
    tone(x, t, { type: 'sine', f: 1500, dur: 0.04, gain: 0.04 });
  }));
  // アームでアイテムを掴んだ：カチッ＋短い巻き取り
  sub(events, 'armGrab', () => play('armGrab', 0.3, (x, t) => {
    noise(x, t, { dur: 0.04, gain: 0.12, filter: { type: 'bandpass', f: 3200, q: 3 } });
    tone(x, t, { type: 'square', f: 900, dur: 0.05, gain: 0.04, filter: { type: 'lowpass', f: 2500 } });
    tone(x, t, { type: 'sawtooth', f: 500, f2: 260, at: 0.05, dur: 0.22, gain: 0.04, filter: { type: 'lowpass', f: 1600 } });
  }));
  // メタルを拾った：金属片のチャリン（量が多いほど明るく）
  sub(events, 'metalPickup', (p) => play('metalPickup', 0.25, (x, t) => {
    const up = Math.min(1, p.amount / 4);
    tone(x, t, { type: 'triangle', f: 1600 + 600 * up, dur: 0.08, gain: 0.07, attack: 0.002 });
    tone(x, t, { type: 'sine', f: 2400 + 800 * up, at: 0.04, dur: 0.14, gain: 0.05 });
    noise(x, t, { dur: 0.04, gain: 0.04, filter: { type: 'bandpass', f: 5000, q: 3 } });
  }));
  sub(events, 'switchOn', () => play('switchOn', 1.6, (x, t) => {
    // レバーのガコン＋立ち上がる電気ハム＋サージ
    tone(x, t, { type: 'sine', f: 110, f2: 50, dur: 0.25, gain: 0.35, attack: 0.002 });
    noise(x, t, { dur: 0.08, gain: 0.2, filter: { type: 'bandpass', f: 1200, q: 2 } });
    tone(x, t, { type: 'triangle', f: 700, f2: 600, at: 0.03, dur: 0.2, gain: 0.08 });
    tone(x, t, { type: 'sawtooth', f: 60, f2: 240, at: 0.2, dur: 1.2, gain: 0.1, attack: 0.3, filter: { type: 'lowpass', f: 300, f2: 1800 } });
    tone(x, t, { type: 'sine', f: 400, f2: 1600, at: 0.25, dur: 1.0, gain: 0.07, attack: 0.3 });
    noise(x, t, { at: 0.25, dur: 1.0, gain: 0.05, attack: 0.4, filter: { type: 'bandpass', f: 2000, f2: 6000, q: 2 } });
  }));
  sub(events, 'powerRestored', () => play('powerRestored', 1.0, (x, t) => {
    // 電気が届いた確認音
    tone(x, t, { type: 'sine', f: 300, f2: 1200, dur: 0.2, gain: 0.1 });
    [784, 1047, 1568].forEach((f, i) => tone(x, t, { type: 'triangle', f, at: 0.18 + i * 0.1, dur: 0.4, gain: 0.12 }));
  }));
  sub(events, 'elevatorLocked', () => play('elevatorLocked', 0.5, (x, t) => {
    tone(x, t, { type: 'square', f: 150, dur: 0.14, gain: 0.07, filter: { type: 'lowpass', f: 700 } });
    tone(x, t, { type: 'square', f: 120, at: 0.18, dur: 0.2, gain: 0.07, filter: { type: 'lowpass', f: 700 } });
  }));
  sub(events, 'elevatorOpen', () => play('elevatorOpen', 1.4, (x, t) => {
    // 油圧のプシュー＋スライド
    noise(x, t, { dur: 0.5, gain: 0.14, attack: 0.05, filter: { type: 'highpass', f: 2000, f2: 1000 } });
    noise(x, t, { at: 0.3, dur: 1.0, gain: 0.08, attack: 0.2, filter: { type: 'bandpass', f: 400, f2: 700, q: 1 } });
    tone(x, t, { type: 'sawtooth', f: 50, f2: 80, at: 0.2, dur: 1.1, gain: 0.12, filter: { type: 'lowpass', f: 250 } });
    tone(x, t, { type: 'sine', f: 1200, at: 1.2, dur: 0.15, gain: 0.07 });
  }));
  sub(events, 'elevatorRide', () => play('elevatorRide', 1.6, (x, t) => {
    // 上昇する唸り（クリアのジングルの下で鳴る）
    tone(x, t, { type: 'sawtooth', f: 70, f2: 260, dur: 1.5, gain: 0.1, attack: 0.3, filter: { type: 'lowpass', f: 300, f2: 1500 } });
    tone(x, t, { type: 'sine', f: 200, f2: 800, dur: 1.5, gain: 0.07, attack: 0.3 });
  }));
  sub(events, 'zoneWave', () => play('zoneWave', 0.6, (x, t) => {
    // 敵出現の警告（気づきより低く重い2連）
    tone(x, t, { type: 'sawtooth', f: 330, dur: 0.14, gain: 0.07, filter: { type: 'lowpass', f: 1500 } });
    tone(x, t, { type: 'sawtooth', f: 247, at: 0.17, dur: 0.22, gain: 0.07, filter: { type: 'lowpass', f: 1500 } });
    noise(x, t, { dur: 0.3, gain: 0.05, attack: 0.1, filter: { type: 'highpass', f: 3000, f2: 5000 } });
  }));
  sub(events, 'padEmpty', () => play('padEmpty', 0.3, (x, t) => {
    tone(x, t, { type: 'triangle', f: 400, f2: 250, dur: 0.2, gain: 0.08 });
  }));
  sub(events, 'flightFail', () => play('flightFail', 0.4, (x, t) => {
    // ジェットが点火に失敗するスプッター
    for (let i = 0; i < 3; i++) {
      noise(x, t, { at: i * 0.07, dur: 0.05, gain: 0.1 - i * 0.025, filter: { type: 'lowpass', f: 900 - i * 200 } });
    }
    tone(x, t, { type: 'sine', f: 160, f2: 60, dur: 0.25, gain: 0.08 });
  }));
}

/** 休眠中の敵：ポッド / 天井ドロップの予兆と飛び出し */
function subscribeWake(events: EventBus): void {
  sub(events, 'enemyWakeWarn', (p) => {
    const a = att(p.pos);
    play('wakeWarn', 0.4, (x, t) => {
      if (p.mode === 'pod') {
        // 警報ブリップ2回
        tone(x, t, { type: 'square', f: 1000, dur: 0.07, gain: 0.05 * a, filter: { type: 'lowpass', f: 2500 } });
        tone(x, t, { type: 'square', f: 1000, at: 0.13, dur: 0.07, gain: 0.05 * a, filter: { type: 'lowpass', f: 2500 } });
      } else {
        // ハッチのロック解除：カチッ＋点滅音
        tone(x, t, { type: 'triangle', f: 600, f2: 400, dur: 0.06, gain: 0.09 * a });
        tone(x, t, { type: 'square', f: 800, at: 0.12, dur: 0.05, gain: 0.04 * a, filter: { type: 'lowpass', f: 2000 } });
        noise(x, t, { at: 0.02, dur: 0.05, gain: 0.08 * a, filter: { type: 'bandpass', f: 1200, q: 2 } });
      }
    });
  });
  sub(events, 'enemyEmerge', (p) => {
    const a = att(p.pos);
    play('emerge', 1.0, (x, t) => {
      if (p.mode === 'pod') {
        // 空気圧のプシュー＋金属扉がバンと開く
        noise(x, t, { dur: 0.35, gain: 0.16 * a, attack: 0.01, filter: { type: 'highpass', f: 2500, f2: 1200 } });
        tone(x, t, { type: 'sine', f: 140, f2: 55, at: 0.2, dur: 0.3, gain: 0.3 * a, attack: 0.002 });
        noise(x, t, { at: 0.2, dur: 0.12, gain: 0.2 * a, filter: { type: 'bandpass', f: 1400, q: 1.5 } });
        tone(x, t, { type: 'triangle', f: 760, f2: 640, at: 0.22, dur: 0.45, gain: 0.08 * a });
      } else {
        // ハッチの金属音＋落下のヒュー、約0.5秒後に着地ドスン
        tone(x, t, { type: 'triangle', f: 520, f2: 380, dur: 0.25, gain: 0.12 * a });
        noise(x, t, { dur: 0.1, gain: 0.15 * a, filter: { type: 'bandpass', f: 1000, q: 1.5 } });
        noise(x, t, { at: 0.1, dur: 0.4, gain: 0.1 * a, attack: 0.1, filter: { type: 'bandpass', f: 3500, f2: 800, q: 1 } });
        tone(x, t, { type: 'sine', f: 800, f2: 200, at: 0.1, dur: 0.4, gain: 0.05 * a });
        tone(x, t, { type: 'sine', f: 100, f2: 40, at: 0.5, dur: 0.3, gain: 0.3 * a, attack: 0.002 });
        noise(x, t, { at: 0.5, dur: 0.2, gain: 0.15 * a, filter: { type: 'lowpass', f: 700, f2: 150 } });
      }
    });
  });
}

/** 試聴ボード用：継続音を直接 ON/OFF する（ゲーム本体は使わない） */
export function auditionLoop(name: LoopName, on: boolean, ratio = 0.5): void {
  syncLoop(name, on ? ratio : null);
}

/** 試聴ボード用：低HPの心音を鳴らす */
export function auditionHeartbeat(): void {
  play('heartbeat', 0.4, (x, t) => {
    tone(x, t, { type: 'sine', f: 80, f2: 45, dur: 0.14, gain: 0.22, attack: 0.005 });
    tone(x, t, { type: 'sine', f: 70, f2: 40, at: 0.17, dur: 0.16, gain: 0.16, attack: 0.005 });
  });
}

// ---------------------------------------------------------------- Phase 3（新しい雑魚・ハッキング）

/** ジャンパー：着地からの突き（シュッ＋金属音） */
function onJumperThrust(pos: P3): void {
  const a = att(pos);
  play('jumperThrust', 0.3, (x, t) => {
    noise(x, t, { dur: 0.12, gain: 0.14 * a, attack: 0.004, filter: { type: 'bandpass', f: 1200, f2: 4000, q: 1.5 } });
    tone(x, t, { type: 'triangle', f: 1800, f2: 900, at: 0.08, dur: 0.15, gain: 0.08 * a });
  });
}

/** ボンバー：電気の球を投げる（ブォン＋ジジッ） */
function onBomberThrow(pos: P3): void {
  const a = att(pos);
  play('bomberThrow', 0.35, (x, t) => {
    noise(x, t, { dur: 0.25, gain: 0.1 * a, attack: 0.02, filter: { type: 'bandpass', f: 400, f2: 1600, q: 1 } });
    tone(x, t, { type: 'square', f: 600, f2: 1100, dur: 0.2, gain: 0.03 * a, filter: { type: 'lowpass', f: 2500 } });
  });
}

function subscribePhase3(events: EventBus): void {
  // ---- ビーマー
  sub(events, 'beamCharge', (p) => {
    const a = att(p.pos);
    // 長い溜め：じわじわ上がるうなり
    play('beamCharge', 2.6, (x, t) => {
      tone(x, t, { type: 'sawtooth', f: 90, f2: 520, dur: 2.5, gain: 0.08 * a, attack: 0.3, filter: { type: 'lowpass', f: 400, f2: 2400 } });
      tone(x, t, { type: 'sine', f: 180, f2: 1040, dur: 2.5, gain: 0.06 * a, attack: 0.3 });
      noise(x, t, { at: 1.9, dur: 0.6, gain: 0.05 * a, attack: 0.2, filter: { type: 'highpass', f: 4000 } });
    });
  });
  sub(events, 'beamFire', (p) => {
    const a = att(p.pos);
    play('beamFire', 0.7, (x, t) => {
      tone(x, t, { type: 'sawtooth', f: 160, f2: 60, dur: 0.6, gain: 0.25 * a, attack: 0.003, filter: { type: 'lowpass', f: 3000, f2: 400 } });
      noise(x, t, { dur: 0.45, gain: 0.28 * a, attack: 0.003, filter: { type: 'bandpass', f: 2000, f2: 500, q: 0.8 } });
      tone(x, t, { type: 'sine', f: 70, f2: 35, dur: 0.6, gain: 0.35 * a });
    });
  });
  sub(events, 'beamInterrupt', (p) => {
    const a = att(p.pos);
    play('beamInterrupt', 0.5, (x, t) => {
      tone(x, t, { type: 'sawtooth', f: 1000, f2: 80, dur: 0.45, gain: 0.12 * a, filter: { type: 'lowpass', f: 2500, f2: 200 } });
      noise(x, t, { dur: 0.06, gain: 0.15 * a, filter: { type: 'highpass', f: 3000 } });
    });
  });
  // ---- リーチ
  sub(events, 'leechFire', (p) => {
    const a = att(p.pos);
    play('leechFire', 0.3, (x, t) => {
      tone(x, t, { type: 'triangle', f: 500, f2: 1400, dur: 0.2, gain: 0.08 * a });
      noise(x, t, { dur: 0.15, gain: 0.05 * a, filter: { type: 'bandpass', f: 3000, q: 2 } });
    });
  });
  sub(events, 'leechAttach', () => play('leechAttach', 0.5, (x, t) => {
    // 吸われる：下がっていくズズッ
    tone(x, t, { type: 'sawtooth', f: 700, f2: 220, dur: 0.45, gain: 0.1, filter: { type: 'lowpass', f: 1800, f2: 500 } });
    tone(x, t, { type: 'square', f: 140, dur: 0.12, gain: 0.04, filter: { type: 'lowpass', f: 800 } });
  }));
  sub(events, 'leechBreak', () => play('leechBreak', 0.2, (x, t) => {
    tone(x, t, { type: 'triangle', f: 900, f2: 1500, dur: 0.1, gain: 0.08 });
    noise(x, t, { dur: 0.06, gain: 0.06, filter: { type: 'highpass', f: 3000 } });
  }));
  sub(events, 'leechFlee', (p) => {
    const a = att(p.pos);
    // あわてて逃げる：ピロピロ
    play('leechFlee', 0.4, (x, t) => {
      [1400, 1900, 1400, 1900].forEach((f, i) => tone(x, t, { type: 'square', f, at: i * 0.07, dur: 0.06, gain: 0.03 * a, filter: { type: 'lowpass', f: 3000 } }));
    });
  });
  // ---- ハッキング
  sub(events, 'hackStart', () => play('hackStart', 0.4, (x, t) => {
    [880, 1320, 1760].forEach((f, i) => tone(x, t, { type: 'square', f, at: i * 0.06, dur: 0.07, gain: 0.04, filter: { type: 'lowpass', f: 4000 } }));
  }));
  sub(events, 'hackInput', (p) => {
    if (p.ok) {
      // 正解：進むほど音が上がる
      const f = 700 + p.progress * 90;
      play('hackOk', 0.1, (x, t) => tone(x, t, { type: 'square', f, dur: 0.07, gain: 0.05, filter: { type: 'lowpass', f: 4000 } }));
    } else {
      play('hackFail', 0.3, (x, t) => {
        tone(x, t, { type: 'sawtooth', f: 180, f2: 120, dur: 0.25, gain: 0.12, filter: { type: 'lowpass', f: 1200 } });
        noise(x, t, { dur: 0.12, gain: 0.1, filter: { type: 'bandpass', f: 2500, q: 2 } });
      });
    }
  });
  sub(events, 'hackCancel', () => play('hackCancel', 0.25, (x, t) => {
    tone(x, t, { type: 'square', f: 600, f2: 300, dur: 0.2, gain: 0.04, filter: { type: 'lowpass', f: 2000 } });
  }));
  sub(events, 'hackSuccess', () => play('hackSuccess', 0.8, (x, t) => {
    [1047, 1319, 1568, 2093].forEach((f, i) => tone(x, t, { type: 'square', f, at: i * 0.08, dur: 0.14, gain: 0.05, filter: { type: 'lowpass', f: 5000 } }));
    tone(x, t, { type: 'sine', f: 2093, at: 0.32, dur: 0.4, gain: 0.06 });
  }));
  sub(events, 'allyExpire', (p) => {
    const a = att(p.pos);
    play('allyExpire', 0.6, (x, t) => {
      tone(x, t, { type: 'sawtooth', f: 800, f2: 100, dur: 0.55, gain: 0.08 * a, filter: { type: 'lowpass', f: 2000, f2: 300 } });
    });
  });
  // ---- 守られた敵に弾かれる（カキン）
  sub(events, 'shieldBlock', (p) => {
    const a = att(p.pos);
    play('shieldBlock', 0.25, (x, t) => {
      tone(x, t, { type: 'triangle', f: 2400, f2: 2100, dur: 0.2, gain: 0.08 * a, attack: 0.001 });
      tone(x, t, { type: 'sine', f: 3600, dur: 0.12, gain: 0.03 * a });
      noise(x, t, { dur: 0.03, gain: 0.08 * a, filter: { type: 'highpass', f: 5000 } });
    });
  });
}

/* ------------------------------------------------------------------ */
/* 強化画面                                                            */
/* ------------------------------------------------------------------ */

function subscribeUpgrade(events: EventBus): void {
  // カーソル移動：小さなチック
  sub(events, 'uiMove', () => play('uiMove', 0.04, (x, t) => {
    tone(x, t, { type: 'sine', f: 1250, f2: 1050, dur: 0.035, gain: 0.07, attack: 0.002 });
  }));
  // 決定・項目の切り替え：2音の短い上昇
  sub(events, 'uiConfirm', () => play('uiConfirm', 0.16, (x, t) => {
    tone(x, t, { type: 'triangle', f: 760, dur: 0.07, gain: 0.1, attack: 0.002 });
    tone(x, t, { type: 'triangle', f: 1140, at: 0.055, dur: 0.1, gain: 0.1, attack: 0.002 });
  }));
  // 受け付けない（歯車不足・最大レベル）：低いブブッ
  sub(events, 'uiDenied', () => play('uiDenied', 0.28, (x, t) => {
    tone(x, t, { type: 'square', f: 150, f2: 120, dur: 0.1, gain: 0.07, filter: { type: 'lowpass', f: 700 } });
    tone(x, t, { type: 'square', f: 150, f2: 110, at: 0.13, dur: 0.12, gain: 0.07, filter: { type: 'lowpass', f: 700 } });
  }));
  // 強化できた：歯車のラチェット音＋明るい上昇アルペジオ（レベルが高いほど少し高い）
  sub(events, 'upgrade', (p) => play('upgrade', 0.9, (x, t) => {
    const k = 1 + 0.045 * Math.max(0, p.level - 2);
    for (let i = 0; i < 4; i++) {
      noise(x, t, { at: i * 0.045, dur: 0.025, gain: 0.1, filter: { type: 'bandpass', f: 3000 + i * 500, q: 4 } });
      tone(x, t, { type: 'square', f: 420 + i * 70, at: i * 0.045, dur: 0.03, gain: 0.03, filter: { type: 'lowpass', f: 2200 } });
    }
    [523, 659, 784, 1046].forEach((f, i) => tone(x, t, { type: 'triangle', f: f * k, at: 0.2 + i * 0.065, dur: 0.24, gain: 0.12 }));
    tone(x, t, { type: 'sine', f: 2093 * k, at: 0.46, dur: 0.4, gain: 0.06 });
    tone(x, t, { type: 'sine', f: 180, f2: 360, at: 0.18, dur: 0.25, gain: 0.1 });
  }));
}

/* ------------------------------------------------------------------ */
/* スキル（バキューム）・武器の切り替え                                 */
/* ------------------------------------------------------------------ */

function subscribeSkill(events: EventBus): void {
  // バキューム：空気ごと吸い込む「ゴォォッ」＋下がっていく吸引音＋ビリビリの放電。長さは吸い込む時間に合わせる
  sub(events, 'vacuumStart', (p) => {
    const d = Math.max(0.4, p.duration);
    play('vacuumStart', d + 0.2, (x, t) => {
      noise(x, t, { dur: d, gain: 0.22, attack: d * 0.35, filter: { type: 'bandpass', f: 280, f2: 2600, q: 1.1 } });
      noise(x, t, { dur: d * 0.9, gain: 0.08, attack: 0.05, filter: { type: 'lowpass', f: 900, f2: 200, q: 0.7 } });
      tone(x, t, { type: 'sawtooth', f: 900, f2: 110, dur: d, gain: 0.07, attack: 0.04, filter: { type: 'lowpass', f: 1800, f2: 500 } });
      tone(x, t, { type: 'sine', f: 70, f2: 50, dur: d, gain: 0.16, attack: 0.1 });
      const n = Math.round(d / 0.11);
      for (let i = 0; i < n; i++) {
        noise(x, t, { at: 0.05 + i * 0.11 + Math.random() * 0.04, dur: 0.035, gain: 0.07, filter: { type: 'highpass', f: 3500 + Math.random() * 2000 } });
      }
    });
  });
  // 吸い終わり：ゴクッと飲み込む上昇音（吸えたら明るいチャイム）
  sub(events, 'vacuumEnd', (p) => play('vacuumEnd', 0.5, (x, t) => {
    tone(x, t, { type: 'sine', f: 180, f2: 760, dur: 0.16, gain: 0.2, attack: 0.004 });
    noise(x, t, { dur: 0.12, gain: 0.1, filter: { type: 'bandpass', f: 1800, f2: 400, q: 1.5 } });
    if (p.gained > 0) {
      tone(x, t, { type: 'triangle', f: 1046, at: 0.12, dur: 0.22, gain: 0.1 });
      tone(x, t, { type: 'triangle', f: 1568, at: 0.2, dur: 0.28, gain: 0.08 });
    }
  }));
  sub(events, 'skillSelect', () => play('skillSelect', 0.08, (x, t) => {
    tone(x, t, { type: 'sine', f: 980, f2: 1320, dur: 0.06, gain: 0.08, attack: 0.002 });
  }));
  sub(events, 'skillDenied', () => play('skillDenied', 0.22, (x, t) => {
    tone(x, t, { type: 'square', f: 170, f2: 130, dur: 0.09, gain: 0.06, filter: { type: 'lowpass', f: 800 } });
    tone(x, t, { type: 'square', f: 160, f2: 120, at: 0.11, dur: 0.09, gain: 0.06, filter: { type: 'lowpass', f: 800 } });
  }));
  // 武器の切り替え：ガチャッ（機械音2つ）
  sub(events, 'weaponSwitch', () => play('weaponSwitch', 0.16, (x, t) => {
    noise(x, t, { dur: 0.04, gain: 0.14, filter: { type: 'bandpass', f: 2400, q: 3 } });
    tone(x, t, { type: 'triangle', f: 520, f2: 380, dur: 0.05, gain: 0.08 });
    noise(x, t, { at: 0.08, dur: 0.05, gain: 0.16, filter: { type: 'bandpass', f: 1500, q: 3 } });
    tone(x, t, { type: 'triangle', f: 760, at: 0.08, dur: 0.06, gain: 0.08 });
  }));
}

/* ------------------------------------------------------------------ */
/* サージ収容所への道：運転・演出                                       */
/* ------------------------------------------------------------------ */

function subscribeDrive(events: EventBus): void {
  // 乗り込んでエンジン始動：キュイーンと立ち上がる
  sub(events, 'driveStart', () => play('driveStart', 0.9, (x, t) => {
    tone(x, t, { type: 'sawtooth', f: 80, f2: 420, dur: 0.7, gain: 0.07, attack: 0.05, filter: { type: 'lowpass', f: 600, f2: 3000 } });
    tone(x, t, { type: 'sine', f: 55, f2: 90, dur: 0.6, gain: 0.2, attack: 0.02 });
    noise(x, t, { at: 0.02, dur: 0.06, gain: 0.12, filter: { type: 'bandpass', f: 2200, q: 2 } }); // ドアのカチッ
  }));
  // タイミング加速：PERFECT は気持ちよく突き抜ける。GOOD は軽く。MISS は鈍いブザー
  sub(events, 'driveBoost', (p) => {
    if (p.quality === 'perfect') {
      play('boostPerfect', 0.8, (x, t) => {
        tone(x, t, { type: 'sawtooth', f: 200, f2: 1400, dur: 0.45, gain: 0.1, attack: 0.01, filter: { type: 'lowpass', f: 800, f2: 5000 } });
        noise(x, t, { dur: 0.5, gain: 0.2, attack: 0.02, filter: { type: 'bandpass', f: 600, f2: 4500, q: 0.9 } });
        tone(x, t, { type: 'sine', f: 90, f2: 40, dur: 0.3, gain: 0.3, attack: 0.002 });
        [1320, 1760, 2349].forEach((f, i) => tone(x, t, { type: 'triangle', f, at: 0.04 + i * 0.05, dur: 0.22, gain: 0.08 }));
      });
    } else if (p.quality === 'good') {
      play('boostGood', 0.5, (x, t) => {
        tone(x, t, { type: 'sawtooth', f: 180, f2: 800, dur: 0.3, gain: 0.07, attack: 0.01, filter: { type: 'lowpass', f: 700, f2: 3000 } });
        noise(x, t, { dur: 0.3, gain: 0.1, attack: 0.02, filter: { type: 'bandpass', f: 500, f2: 2500, q: 0.9 } });
        tone(x, t, { type: 'triangle', f: 988, at: 0.03, dur: 0.15, gain: 0.07 });
      });
    } else {
      play('boostMiss', 0.3, (x, t) => {
        tone(x, t, { type: 'square', f: 130, f2: 95, dur: 0.18, gain: 0.07, filter: { type: 'lowpass', f: 600 } });
        noise(x, t, { dur: 0.08, gain: 0.05, filter: { type: 'lowpass', f: 900 } });
      });
    }
  });
  // 雑魚をはね飛ばす：ゴッという低い衝撃＋金属のガシャン
  sub(events, 'driveHitEnemy', (p) => {
    const a = att(p.pos);
    play('driveHit', 0.35, (x, t) => {
      tone(x, t, { type: 'sine', f: 220, f2: 60, dur: 0.22, gain: 0.3 * a, attack: 0.002 });
      noise(x, t, { dur: 0.16, gain: 0.2 * a, attack: 0.002, filter: { type: 'bandpass', f: 1800, f2: 500, q: 1 } });
      tone(x, t, { type: 'triangle', f: 1500 + Math.random() * 700, f2: 700, at: 0.02, dur: 0.12, gain: 0.07 * a });
    });
  });
  // T字路で壁・柵に軽くぶつかる（失敗ではない）：ドンッ＋ガシャ
  sub(events, 'driveBump', (p) => {
    const a = att(p.pos);
    play('driveBump', 0.5, (x, t) => {
      tone(x, t, { type: 'sine', f: 120, f2: 45, dur: 0.3, gain: 0.35 * a, attack: 0.002 });
      noise(x, t, { dur: 0.2, gain: 0.22 * a, attack: 0.002, filter: { type: 'lowpass', f: 1400, f2: 250 } });
      tone(x, t, { type: 'triangle', f: 520, f2: 330, at: 0.02, dur: 0.25, gain: 0.08 * a });
    });
  });
  // 障害物に激突：大きな衝撃＋破片が散る
  sub(events, 'driveCrash', () => play('driveCrash', 1.6, (x, t) => {
    tone(x, t, { type: 'sine', f: 110, f2: 30, dur: 1.0, gain: 0.55, attack: 0.002 });
    noise(x, t, { dur: 0.9, gain: 0.4, attack: 0.002, filter: { type: 'lowpass', f: 2400, f2: 150 } });
    noise(x, t, { at: 0.04, dur: 0.35, gain: 0.25, filter: { type: 'bandpass', f: 3000, f2: 900, q: 1 } });
    for (let i = 0; i < 6; i++) tone(x, t, { type: 'triangle', f: 700 + Math.random() * 1600, f2: 300, at: 0.08 + i * 0.07, dur: 0.14, gain: 0.05 });
    tone(x, t, { type: 'sawtooth', f: 90, f2: 25, at: 0.05, dur: 1.2, gain: 0.12, filter: { type: 'lowpass', f: 300 } });
  }));
  // 判定地点：成功は上昇のきらめき、失敗は下がるブザー
  sub(events, 'driveCheckpoint', (p) => play('driveCheckpoint', 1.2, (x, t) => {
    if (p.ok) {
      [523, 784, 1046, 1568].forEach((f, i) => tone(x, t, { type: 'triangle', f, at: i * 0.07, dur: 0.35, gain: 0.1 }));
      tone(x, t, { type: 'sawtooth', f: 120, f2: 520, dur: 0.6, gain: 0.07, attack: 0.05, filter: { type: 'lowpass', f: 800, f2: 4000 } });
    } else {
      tone(x, t, { type: 'sawtooth', f: 330, f2: 110, dur: 0.9, gain: 0.12, filter: { type: 'lowpass', f: 1500, f2: 250 } });
      tone(x, t, { type: 'square', f: 196, at: 0.0, dur: 0.18, gain: 0.05, filter: { type: 'lowpass', f: 900 } });
      tone(x, t, { type: 'square', f: 147, at: 0.2, dur: 0.3, gain: 0.05, filter: { type: 'lowpass', f: 900 } });
    }
  }));

  // ---- 演出
  // 柵を突き破る：金属が砕けて飛び散る
  sub(events, 'fenceBreak', (p) => {
    const a = att(p.pos);
    play('fenceBreak', 1.4, (x, t) => {
      noise(x, t, { dur: 0.7, gain: 0.35 * a, attack: 0.002, filter: { type: 'highpass', f: 1800, f2: 5500 } });
      noise(x, t, { at: 0.02, dur: 0.5, gain: 0.3 * a, attack: 0.002, filter: { type: 'bandpass', f: 2600, f2: 700, q: 0.8 } });
      tone(x, t, { type: 'sine', f: 160, f2: 45, dur: 0.5, gain: 0.35 * a, attack: 0.002 });
      for (let i = 0; i < 9; i++) {
        tone(x, t, { type: 'triangle', f: 1200 + Math.random() * 3200, f2: 500 + Math.random() * 400, at: 0.03 + i * 0.05, dur: 0.16, gain: 0.07 * a });
      }
    });
  });
  // 壁に激突：腹に響く超大音量の衝撃＋崩れる音
  sub(events, 'carWallCrash', (p) => {
    const a = att(p.pos);
    play('carWallCrash', 2.6, (x, t) => {
      tone(x, t, { type: 'sine', f: 85, f2: 22, dur: 1.8, gain: 0.8 * a, attack: 0.002 });
      tone(x, t, { type: 'sawtooth', f: 70, f2: 20, dur: 1.6, gain: 0.2 * a, filter: { type: 'lowpass', f: 260 } });
      noise(x, t, { dur: 1.5, gain: 0.55 * a, attack: 0.002, filter: { type: 'lowpass', f: 3000, f2: 120 } });
      noise(x, t, { at: 0.03, dur: 0.6, gain: 0.3 * a, filter: { type: 'bandpass', f: 2400, f2: 600, q: 0.8 } });
      for (let i = 0; i < 12; i++) tone(x, t, { type: 'triangle', f: 400 + Math.random() * 2400, f2: 200, at: 0.1 + i * 0.08, dur: 0.18, gain: 0.05 * a });
      noise(x, t, { at: 0.5, dur: 1.4, gain: 0.18 * a, attack: 0.1, filter: { type: 'lowpass', f: 900, f2: 200 } }); // 崩れる土煙
    });
  });
  // ヘビーが車を受け止める：重い金属の衝突音＋タイヤの悲鳴
  sub(events, 'carCaught', (p) => {
    const a = att(p.pos);
    play('carCaught', 2.2, (x, t) => {
      // 長いスキッド
      noise(x, t, { dur: 0.9, gain: 0.16 * a, attack: 0.03, filter: { type: 'bandpass', f: 3200, f2: 1100, q: 4 } });
      tone(x, t, { type: 'sawtooth', f: 1500, f2: 600, dur: 0.8, gain: 0.04 * a, filter: { type: 'bandpass', f: 1500, q: 3 } });
      // ガンッ：重い金属の衝突（inharmonic な打撃音）
      const t0 = 0.55;
      tone(x, t, { type: 'sine', f: 95, f2: 32, at: t0, dur: 0.9, gain: 0.6 * a, attack: 0.002 });
      noise(x, t, { at: t0, dur: 0.5, gain: 0.4 * a, attack: 0.002, filter: { type: 'bandpass', f: 1600, f2: 400, q: 0.9 } });
      [180, 233, 331, 457].forEach((f, i) => tone(x, t, { type: 'square', f, f2: f * 0.97, at: t0 + 0.01, dur: 0.7 - i * 0.1, gain: 0.05 * a, filter: { type: 'bandpass', f: f * 2, q: 5 } }));
      tone(x, t, { type: 'triangle', f: 2100, f2: 1400, at: t0 + 0.05, dur: 0.4, gain: 0.07 * a });
      // 残響のきしみ
      noise(x, t, { at: t0 + 0.2, dur: 1.2, gain: 0.1 * a, attack: 0.2, filter: { type: 'lowpass', f: 700, f2: 120 } });
    });
  });
  // スローモーション：入る時はピッチが落ちるウォーン、戻る時は逆に巻き上がる
  sub(events, 'slowmo', (p) => play('slowmo', 1.0, (x, t) => {
    if (p.on) {
      tone(x, t, { type: 'sine', f: 900, f2: 110, dur: 0.7, gain: 0.14, attack: 0.01 });
      noise(x, t, { dur: 0.6, gain: 0.14, attack: 0.02, filter: { type: 'bandpass', f: 3500, f2: 300, q: 0.8 } });
      tone(x, t, { type: 'triangle', f: 440, f2: 55, dur: 0.8, gain: 0.07 });
    } else {
      tone(x, t, { type: 'sine', f: 110, f2: 900, dur: 0.45, gain: 0.12, attack: 0.02 });
      noise(x, t, { dur: 0.5, gain: 0.16, attack: 0.15, filter: { type: 'bandpass', f: 300, f2: 4000, q: 0.8 } });
      tone(x, t, { type: 'sine', f: 55, f2: 40, at: 0.4, dur: 0.3, gain: 0.2 });
    }
  }));
}
