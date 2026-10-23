import * as THREE from 'three';
import { clamp, formatRate, formatTime, pct, projectToScreen, stepRate } from './format';

describe('formatTime', () => {
  it('m:ss 形式にする', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(125.9)).toBe('2:05');
    expect(formatTime(600)).toBe('10:00');
  });
  it('負の値は 0:00 にする', () => {
    expect(formatTime(-3)).toBe('0:00');
  });
});

describe('pct / clamp', () => {
  it('0..100 に収める', () => {
    expect(pct(50, 100)).toBe(50);
    expect(pct(150, 100)).toBe(100);
    expect(pct(-5, 100)).toBe(0);
    expect(pct(5, 0)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
  });
});

describe('formatRate', () => {
  it('減少は負号、増加は + 符号、ほぼ0は 0.0', () => {
    expect(formatRate(-5.2)).toEqual({ text: '-5.2/秒', kind: 'drain' });
    expect(formatRate(8)).toEqual({ text: '+8.0/秒', kind: 'gain' });
    expect(formatRate(0.01)).toEqual({ text: '0.0/秒', kind: 'idle' });
  });
});

describe('stepRate', () => {
  it('一定速度の減少に収束する', () => {
    const st = { prev: 100, rate: 0 };
    let energy = 100;
    let r = 0;
    for (let i = 0; i < 300; i++) {
      energy -= 10 / 60; // 毎秒10の消費
      r = stepRate(st, energy, 1 / 60, 0.4);
    }
    expect(r).toBeLessThan(0);
    expect(Math.abs(r + 10)).toBeLessThan(0.5);
  });
  it('dt=0 では速度を変えない', () => {
    const st = { prev: 50, rate: -3 };
    expect(stepRate(st, 40, 0, 0.4)).toBe(-3);
    expect(st.prev).toBe(40);
  });
});

describe('projectToScreen', () => {
  const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 400);
  cam.position.set(0, 0, 0);
  cam.lookAt(0, 0, -1);
  cam.updateMatrixWorld(true);

  it('正面の点は画面中央に投影される', () => {
    const s = projectToScreen(new THREE.Vector3(0, 0, -10), cam, 1280, 720);
    expect(s.visible).toBe(true);
    expect(s.x).toBeCloseTo(640, 3);
    expect(s.y).toBeCloseTo(360, 3);
  });
  it('カメラの背後の点は非表示', () => {
    const s = projectToScreen(new THREE.Vector3(0, 0, 10), cam, 1280, 720);
    expect(s.visible).toBe(false);
  });
});
