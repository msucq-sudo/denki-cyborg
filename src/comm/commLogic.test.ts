import { describe, it, expect } from 'vitest';
import { commBlockReason, holoTarget, faceYaw, COMM_HIT_COOLDOWN } from './commLogic';

const calm = { lockdown: false, hostileNear: false, sinceHit: 99, busy: false };

describe('commBlockReason', () => {
  it('allows a call when calm', () => expect(commBlockReason(calm)).toBeNull());
  it('blocks in a lockdown', () => expect(commBlockReason({ ...calm, lockdown: true })).toBe('lockdown'));
  it('blocks while a hostile enemy is near', () => expect(commBlockReason({ ...calm, hostileNear: true })).toBe('enemy'));
  it('blocks right after being hit, then allows again', () => {
    expect(commBlockReason({ ...calm, sinceHit: COMM_HIT_COOLDOWN - 0.1 })).toBe('hit');
    expect(commBlockReason({ ...calm, sinceHit: COMM_HIT_COOLDOWN })).toBeNull();
  });
  it('busy wins over everything', () => expect(commBlockReason({ ...calm, lockdown: true, busy: true })).toBe('busy'));
});

describe('holoTarget', () => {
  it('stands ahead and to the right of the player (yaw 0 faces -Z, right is +X)', () => {
    const t = holoTarget(0, 0, 0, 0, 1, 2, 1);
    expect(t.x).toBeCloseTo(1);
    expect(t.z).toBeCloseTo(-2);
  });
  it('mirrors to the left with side=-1', () => {
    expect(holoTarget(0, 0, 0, 0, -1, 2, 1).x).toBeCloseTo(-1);
  });
  it('follows the player yaw', () => {
    const t = holoTarget(5, 0, 5, Math.PI / 2, 1, 2, 0); // yaw 90°: forward is -X
    expect(t.x).toBeCloseTo(3);
    expect(t.z).toBeCloseTo(5);
  });
});

describe('faceYaw', () => {
  it('faces +Z at yaw 0 and +X at 90°', () => {
    expect(faceYaw(0, 0, 0, 5)).toBeCloseTo(0);
    expect(faceYaw(0, 0, 5, 0)).toBeCloseTo(Math.PI / 2);
  });
});
