import { describe, expect, it } from 'vitest';
import { GUN, CAMERA } from '../config/balance';
import { applyLook, chargeAdvance, chargeDamage, moveVector, smoothAngle, cameraForward } from './logic';

describe('chargeDamage', () => {
  it('端点と中間値', () => {
    expect(chargeDamage(0)).toBe(GUN.chargeMinDamage);
    expect(chargeDamage(1)).toBe(GUN.chargeMaxDamage);
    expect(chargeDamage(0.5)).toBeCloseTo((GUN.chargeMinDamage + GUN.chargeMaxDamage) / 2);
    expect(chargeDamage(2)).toBe(GUN.chargeMaxDamage);
  });
});

describe('chargeAdvance', () => {
  it('chargeTime 秒で満タン、総コストは chargeCostTotal', () => {
    let c = 0, spent = 0;
    for (let i = 0; i < 200; i++) { const r = chargeAdvance(c, 0.01, 100); c = r.charge; spent += r.cost; }
    expect(c).toBeCloseTo(1);
    expect(spent).toBeCloseTo(GUN.chargeCostTotal);
  });
  it('電力が尽きたら止まる', () => {
    const r = chargeAdvance(0.5, 0.1, 0);
    expect(r.charge).toBe(0.5);
    expect(r.cost).toBe(0);
    const r2 = chargeAdvance(0, 0.6, 3);
    expect(r2.cost).toBeCloseTo(3);
    expect(r2.charge).toBeLessThan(0.5);
  });
});

describe('moveVector', () => {
  it('yaw=0 で W は -Z、D は +X', () => {
    const f = moveVector(0, 1, 0); expect(f.x).toBeCloseTo(0); expect(f.z).toBeCloseTo(-1);
    const r = moveVector(0, 0, 1); expect(r.x).toBeCloseTo(1); expect(r.z).toBeCloseTo(0);
  });
  it('yaw を回すとカメラ相対になる（左90度向き: W は -X）', () => {
    const f = moveVector(Math.PI / 2, 1, 0); expect(f.x).toBeCloseTo(-1); expect(f.z).toBeCloseTo(0);
  });
  it('斜めは正規化される', () => {
    const d = moveVector(0.3, 1, 1); expect(Math.hypot(d.x, d.z)).toBeCloseTo(1);
    const n = moveVector(0, 0, 0); expect(n.x).toBeCloseTo(0); expect(n.z).toBeCloseTo(0);
  });
});

describe('applyLook / camera', () => {
  it('pitch はクランプ、右移動で yaw 減少', () => {
    expect(applyLook(0, 0, 0, -1e6).pitch).toBe(CAMERA.maxPitch);
    expect(applyLook(0, 0, 0, 1e6).pitch).toBe(CAMERA.minPitch);
    expect(applyLook(0, 0, 100, 0).yaw).toBeLessThan(0);
  });
  it('cameraForward は単位ベクトル', () => {
    const f = cameraForward(0.7, 0.4);
    expect(Math.hypot(f.x, f.y, f.z)).toBeCloseTo(1);
  });
  it('smoothAngle は最短方向', () => {
    expect(smoothAngle(3, -3, 100, 1)).toBeGreaterThan(3);
  });
});
