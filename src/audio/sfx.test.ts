import { describe, it, expect, beforeAll } from 'vitest';
import { EventBus, type GameEvents } from '../core/events';
import { initAudio } from './sfx';

/** 何を呼んでも受け付ける偽の WebAudio ノード */
function fakeNode(): any {
  const f: any = new Proxy(function () {}, {
    get: (_t, k) => {
      if (k === 'connect') return (n: any) => n;
      if (k === 'getChannelData') return () => new Float32Array(8);
      if (k === 'currentTime') return 0;
      if (k === 'duration') return 2;
      if (k === 'sampleRate') return 100;
      if (k === 'state') return 'running';
      if (typeof k === 'symbol') return undefined;
      return fakeNode();
    },
    set: () => true,
    apply: () => fakeNode(),
  });
  return f;
}
class FakeAC { constructor() { return fakeNode(); } }

const v = { x: 0, y: 0, z: 0 } as any;
/** 追加した SE イベントと、その発音名（__audioDebug.played のキー） */
const NEW: Array<[keyof GameEvents, any, string]> = [
  ['enemyNotice', { kind: 'walker', pos: v }, 'enemyNotice'],
  ['enemyAction', { kind: 'crawler', pos: v, action: 'crawlerDodge' }, 'crawlerDodge'],
  ['enemyAction', { kind: 'heavyWalker', pos: v, action: 'stompWindup', value: 1 }, 'stompWindup'],
  ['enemyAction', { kind: 'heavyWalker', pos: v, action: 'stomp' }, 'stomp'],
  ['enemyAction', { kind: 'heavyWalker', pos: v, action: 'chargeStart' }, 'chargeStart'],
  ['enemyAction', { kind: 'heavyWalker', pos: v, action: 'wallCrash' }, 'wallCrash'],
  ['enemyAction', { kind: 'missile', pos: v, action: 'summon' }, 'summon'],
  ['enemyAction', { kind: 'missile', pos: v, action: 'missileLoad', value: 0.5 }, 'missileLoad'],
  ['enemyAction', { kind: 'missile', pos: v, action: 'missileBeep', value: 0.9 }, 'missileBeep'],
  ['enemyAction', { kind: 'missile', pos: v, action: 'missileDisrupt' }, 'missileDisrupt'],
  ['enemyAttack', { kind: 'walker', pos: v }, 'walkerShot'],
  ['enemyAttack', { kind: 'missile', pos: v }, 'missileLaunch'],
  ['missileDown', { pos: v }, 'missileDown'],
  ['missileBlast', { pos: v }, 'missileBlast'],
  ['gearPickup', {}, 'gearPickup'],
  ['interactPrompt', {}, 'interactPrompt'],
  ['switchOn', { pos: v }, 'switchOn'],
  ['powerRestored', { pos: v }, 'powerRestored'],
  ['elevatorLocked', { pos: v }, 'elevatorLocked'],
  ['elevatorOpen', { pos: v }, 'elevatorOpen'],
  ['elevatorRide', {}, 'elevatorRide'],
  ['zoneWave', { wave: 1 }, 'zoneWave'],
  ['padEmpty', {}, 'padEmpty'],
  ['flightFail', {}, 'flightFail'],
  ['doorClose', { pos: v }, 'doorClose'],
  ['enemyWakeWarn', { pos: v, mode: 'pod' }, 'wakeWarn'],
  ['enemyEmerge', { kind: 'walker', pos: v, mode: 'drop' }, 'emerge'],
  // Phase 3
  ['beamCharge', { pos: v }, 'beamCharge'],
  ['beamFire', { pos: v }, 'beamFire'],
  ['beamInterrupt', { pos: v }, 'beamInterrupt'],
  ['leechFire', { pos: v }, 'leechFire'],
  ['leechAttach', { pos: v }, 'leechAttach'],
  ['leechBreak', {}, 'leechBreak'],
  ['leechFlee', { pos: v }, 'leechFlee'],
  ['hackStart', {}, 'hackStart'],
  ['hackInput', { ok: true, progress: 3 }, 'hackOk'],
  ['hackInput', { ok: false, progress: 0 }, 'hackFail'],
  ['hackCancel', {}, 'hackCancel'],
  ['hackSuccess', { pos: v }, 'hackSuccess'],
  ['allyExpire', { pos: v }, 'allyExpire'],
  ['shieldBlock', { pos: v }, 'shieldBlock'],
  ['enemyAction', { kind: 'jumper', pos: v, action: 'jumperLand' }, 'jumperLand'],
  ['enemyAction', { kind: 'bomber', pos: v, action: 'bombBlast' }, 'bombBlast'],
  ['enemyAttack', { kind: 'jumper', pos: v }, 'jumperThrust'],
  ['enemyAttack', { kind: 'bomber', pos: v }, 'bomberThrow'],
  // 強化画面
  ['uiMove', {}, 'uiMove'],
  ['uiConfirm', {}, 'uiConfirm'],
  ['uiDenied', {}, 'uiDenied'],
  ['upgrade', { id: 'body', level: 3 }, 'upgrade'],
];

describe('sfx 新規イベントのハンドラ', () => {
  let bus: EventBus;
  beforeAll(() => {
    (globalThis as any).AudioContext = FakeAC;
    bus = new EventBus();
    initAudio(bus);
  });

  it.each(NEW)('%s → %s が発音される', (ev, payload, name) => {
    const dbg = (globalThis as any).__audioDebug;
    const before = dbg.played[name] ?? 0;
    bus.emit(ev, payload);
    expect(dbg.lastError).toBeNull();
    expect(dbg.played[name] ?? 0).toBe(before + 1);
  });
});
