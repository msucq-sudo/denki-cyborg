/**
 * SE の間引き（最小間隔）と同時発音数制限。AudioContext に依存しない純粋なロジック。
 * 時刻は秒単位の任意の単調増加値（呼び出し側が performance.now()/1000 などを渡す）。
 */

export interface SfxPolicy {
  /** 同じSEの連続発音を、この秒数未満なら間引く */
  minInterval?: number;
  /** 同じSEの同時発音数の上限 */
  maxVoices?: number;
}

export class SfxGate {
  private last = new Map<string, number>();
  private ends = new Map<string, number[]>();

  constructor(private policy: Record<string, SfxPolicy | undefined>) {}

  /** 発音してよいか判定する。許可された場合は発音区間（now〜now+duration）を登録する */
  tryPlay(name: string, now: number, duration: number): boolean {
    const p = this.policy[name] ?? {};
    const last = this.last.get(name);
    if (p.minInterval !== undefined && last !== undefined && now - last < p.minInterval) return false;
    const list = (this.ends.get(name) ?? []).filter((t) => t > now);
    if (p.maxVoices !== undefined && list.length >= p.maxVoices) {
      this.ends.set(name, list);
      return false;
    }
    list.push(now + duration);
    this.ends.set(name, list);
    this.last.set(name, now);
    return true;
  }

  /** いま鳴っている（終了していない）同名SEの数 */
  activeVoices(name: string, now: number): number {
    return (this.ends.get(name) ?? []).filter((t) => t > now).length;
  }
}

/**
 * 一定間隔の発火を作るための純関数。active が false の間はリセットする。
 * 戻り値の fire が true のフレームで発火する。
 */
export function stepPulse(
  acc: number,
  dt: number,
  interval: number,
  active: boolean,
): { acc: number; fire: boolean } {
  if (!active) return { acc: 0, fire: false };
  const next = acc + dt;
  if (next >= interval) return { acc: next - interval, fire: true };
  return { acc: next, fire: false };
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
