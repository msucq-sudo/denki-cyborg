import type { Camera, Vector3 } from 'three';

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** v / max を 0..100 にする（max<=0 なら 0） */
export function pct(v: number, max: number): number {
  return max > 0 ? clamp((v / max) * 100, 0, 100) : 0;
}

/** 秒 → m:ss */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export interface RateState {
  prev: number;
  rate: number;
}

/**
 * 値の変化から「毎秒の変化量」を指数平滑化で求める。
 * tau は平滑化の時定数（秒）。発砲のような離散的な消費も滑らかな消費量として見える。
 */
export function stepRate(state: RateState, value: number, dt: number, tau: number): number {
  if (dt > 0) {
    const raw = (value - state.prev) / dt;
    const a = 1 - Math.exp(-dt / tau);
    state.rate += (raw - state.rate) * a;
  }
  state.prev = value;
  return state.rate;
}

const RATE_EPS = 0.05;

/** 電力の変化量表示。減っている時は負号、増えている時は + 符号 */
export function formatRate(rate: number): { text: string; kind: 'drain' | 'gain' | 'idle' } {
  if (rate <= -RATE_EPS) return { text: `${rate.toFixed(1)}/秒`, kind: 'drain' };
  if (rate >= RATE_EPS) return { text: `+${rate.toFixed(1)}/秒`, kind: 'gain' };
  return { text: '0.0/秒', kind: 'idle' };
}

/** ワールド座標の点を画面座標へ投影。カメラの背後（NDC z>1）は visible=false */
export function projectToScreen(
  p: Vector3,
  cam: Camera,
  width: number,
  height: number,
): { x: number; y: number; visible: boolean } {
  const v = p.clone().project(cam);
  return {
    x: ((v.x + 1) / 2) * width,
    y: ((1 - v.y) / 2) * height,
    visible: v.z >= -1 && v.z <= 1,
  };
}
