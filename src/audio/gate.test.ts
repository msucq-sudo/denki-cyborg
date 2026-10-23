import { describe, expect, it } from 'vitest';
import { SfxGate, clamp01, stepPulse } from './gate';

describe('SfxGate 間引き（minInterval）', () => {
  it('最小間隔未満の連打は捨て、間隔を空ければ鳴る', () => {
    const g = new SfxGate({ enemyHit: { minInterval: 0.03 } });
    expect(g.tryPlay('enemyHit', 1.000, 0.05)).toBe(true);
    expect(g.tryPlay('enemyHit', 1.010, 0.05)).toBe(false);
    expect(g.tryPlay('enemyHit', 1.029, 0.05)).toBe(false);
    expect(g.tryPlay('enemyHit', 1.031, 0.05)).toBe(true);
  });

  it('SE ごとに独立している', () => {
    const g = new SfxGate({ enemyHit: { minInterval: 0.5 } });
    expect(g.tryPlay('enemyHit', 0, 0.1)).toBe(true);
    expect(g.tryPlay('impact', 0.01, 0.1)).toBe(true);
  });

  it('間引きで捨てられた呼び出しは最小間隔の起点を更新しない（間引かれた音が次の発音を延ばさない）', () => {
    const g = new SfxGate({ noEnergy: { minInterval: 0.3 } });
    expect(g.tryPlay('noEnergy', 0, 0.1)).toBe(true);
    expect(g.tryPlay('noEnergy', 0.2, 0.1)).toBe(false);
    expect(g.tryPlay('noEnergy', 0.3, 0.1)).toBe(true);
  });
});

describe('SfxGate 同時発音数（maxVoices）', () => {
  it('上限に達したら、どれかが終わるまで捨てる', () => {
    const g = new SfxGate({ shot: { maxVoices: 4 } });
    for (let i = 0; i < 4; i++) expect(g.tryPlay('shot', 0, 0.5)).toBe(true);
    expect(g.tryPlay('shot', 0.1, 0.5)).toBe(false);
    expect(g.activeVoices('shot', 0.1)).toBe(4);
    // 0.5 秒後には全部終わっているので再び鳴る
    expect(g.tryPlay('shot', 0.5, 0.5)).toBe(true);
    expect(g.activeVoices('shot', 0.5)).toBe(1);
  });

  it('1つ終わると1つ空く', () => {
    const g = new SfxGate({ shot: { maxVoices: 2 } });
    expect(g.tryPlay('shot', 0, 0.2)).toBe(true);
    expect(g.tryPlay('shot', 0, 1.0)).toBe(true);
    expect(g.tryPlay('shot', 0.1, 1.0)).toBe(false);
    expect(g.tryPlay('shot', 0.25, 1.0)).toBe(true);
  });

  it('ポリシーが無い SE は制限なし', () => {
    const g = new SfxGate({});
    for (let i = 0; i < 50; i++) expect(g.tryPlay('jump', 0, 1)).toBe(true);
  });
});

describe('stepPulse（低電力の一定間隔ビープ）', () => {
  it('非アクティブの間は発火せず、蓄積をリセットする', () => {
    let r = stepPulse(0, 1, 2, false);
    expect(r).toEqual({ acc: 0, fire: false });
    r = stepPulse(1.5, 1, 2, false);
    expect(r.acc).toBe(0);
  });

  it('アクティブなら interval 秒ごとに1回発火する', () => {
    let acc = 0;
    let fires = 0;
    for (let i = 0; i < 660; i++) {
      const r = stepPulse(acc, 1 / 60, 2, true);
      acc = r.acc;
      if (r.fire) fires++;
    }
    // 11 秒で 2・4・6・8・10 秒の 5 回
    expect(fires).toBe(5);
  });
});

describe('clamp01', () => {
  it('範囲外・非有限値を丸める', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(3)).toBe(1);
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
  });
});
