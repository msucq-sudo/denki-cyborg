import type { World } from '../core/types';
import type { EventBus, GameEvents } from '../core/events';
import { ENEMIES } from '../config/balance';
import { SfxGate, clamp01, stepPulse, type SfxPolicy } from './gate';
import { tone, noise, createLoop, type Eng, type Loop, type LoopName } from './synth';

/* ------------------------------------------------------------------ */
/* 設定                                                               */
/* ------------------------------------------------------------------ */

const MASTER_GAIN = 0.5;
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
let unsubscribers: Array<() => void> = [];
let warnedError = false;
let debug: AudioDebug = makeDebug();

function makeDebug(): AudioDebug {
  return {
    get ctxState() { return engine?.ctx.state ?? 'none'; },
    lastSfx: null,
    played: {},
    suppressed: {},
    loops: { absorb: false, overload: false, flight: false, charge: false, scouter: false },
    lowPowerBeeps: 0,
    activeVoices: (name: string) => gate.activeVoices(name, nowSec()),
    lastError: null,
  };
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
    // 攻撃の予兆。種類ごとに音色を変える
    play('enemyAttack', 0.45, (x, t) => {
      switch (p.kind) {
        case 'drone':
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
  sub(events, 'functionToggle', (p) => play('functionToggle', 0.2, (x, t) => {
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
}

/* ------------------------------------------------------------------ */
/* 継続音                                                             */
/* ------------------------------------------------------------------ */

function stopAllLoops(): void {
  for (const k of Object.keys(loops) as LoopName[]) {
    loops[k]?.stop();
    delete loops[k];
  }
  for (const k of Object.keys(debug.loops) as LoopName[]) debug.loops[k] = false;
  lowPowerAcc = 0;
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
    syncLoop('scouter', world.functions.scouter ? 0.5 : null);

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
  } catch (e) {
    reportError('updateAudio', e);
  }
}
