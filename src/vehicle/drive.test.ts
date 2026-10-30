import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import { createWorld } from '../core/world';
import type { World } from '../core/types';
import { CHECKPOINT, ROAD } from '../level/surge/layout';
import { KMH } from './types';

// 演出（cinematic/）は別担当。呼ばれたことだけ確かめるので、窓口を差し替える
const cut = vi.hoisted(() => ({ success: vi.fn(), fail: vi.fn(), onDone: [] as Array<() => void> }));
vi.mock('../cinematic/api', () => ({
  playSuccessCutscene: (...a: unknown[]) => {
    cut.success(...a);
    cut.onDone.push(a[2] as () => void);
    return { update() {}, done: false, skip() {} };
  },
  playFailCutscene: (...a: unknown[]) => {
    cut.fail(...a);
    cut.onDone.push(a[2] as () => void);
    return { update() {}, done: false, skip() {} };
  },
}));

import { getDrive, initDrive, startDrive, updateDrive, type DriveRuntime } from './drive';
import { createSim, cursorAt, DRIVE, judge, kmhOf, stepSim, TURN_Z } from './driveSim';
import { planObstacles, planZako, OBSTACLE_WIDTH } from './driveProps';

/** 偽の入力：キーを押している間／押した瞬間だけ答える */
function fakeInput() {
  const down = new Set<string>();
  const pressed = new Set<string>();
  return {
    locked: false, lastDevice: 'kbm' as const, enabled: true,
    rawDown: (k: string) => down.has(k),
    rawPressed: (k: string) => pressed.has(k),
    isDown: () => false, pressed: () => false,
    hold: (k: string) => down.add(k),
    release: (k: string) => down.delete(k),
    tap: (k: string) => pressed.add(k),
    endFrame: () => pressed.clear(),
  };
}

type Fake = ReturnType<typeof fakeInput>;
let world: World;
let input: Fake;
let drive: DriveRuntime;
let log: Array<{ ev: string; p: unknown }>;

function setup(): void {
  input = fakeInput();
  const events = new EventBus();
  world = createWorld(input as never, events, 16 / 9);
  world.state = 'playing';
  log = [];
  for (const ev of ['driveStart', 'driveBoost', 'driveHitEnemy', 'driveCrash', 'driveBump', 'driveCheckpoint'] as const) {
    events.on(ev, (p) => log.push({ ev, p }));
  }
  drive = initDrive(world, { x: 0, z: 2, yaw: 0 }) as DriveRuntime;
  cut.success.mockClear(); cut.fail.mockClear(); cut.onDone.length = 0;
}

/** n フレーム進める（入力のフレーム単位の「押した瞬間」はフレームごとに消す） */
function run(n: number, dt = 1 / 60): void {
  for (let i = 0; i < n; i++) {
    world.time += dt;
    updateDrive(world, dt);
    input.endFrame();
  }
}
const events = (name: string) => log.filter((l) => l.ev === name).map((l) => l.p as Record<string, unknown>);

/** 西向きの直線の途中へ置く（T字路は曲がった扱い） */
function placeWest(x: number, z = ROAD.junctionZ, kmh = 0): void {
  drive.mode = 'west'; drive.junctionDone = true; drive.yaw = Math.PI / 2;
  drive.pos.set(x, 0, z);
  drive.speed = kmh * KMH;
}

beforeEach(setup);

describe('initDrive / startDrive', () => {
  it('車を停車中で作り、world.level.data.drive に置く', () => {
    expect(getDrive(world)).toBe(drive);
    expect(drive.phase).toBe('parked');
    expect(drive.result).toBe('none');
    expect(world.scene.children).toContain(drive.car.root);
    expect(drive.car.driverHead).toBeTruthy();
    // 乗る前は動かない
    run(30);
    expect(drive.speed).toBe(0);
    expect(drive.pos.x).toBe(0);
  });

  it('乗ると体が隠れ、操作がロックされ、プレイヤーの位置が車に付いてくる', () => {
    startDrive(world);
    expect(drive.phase).toBe('driving');
    expect(world.player.root.visible).toBe(false);
    expect(input.locked).toBe(true);
    expect(events('driveStart').length).toBe(1);
    drive.pendingKmh = 40;
    run(60);
    expect(world.player.pos.z).toBeCloseTo(drive.pos.z, 5);
    expect(world.player.pos.z).toBeLessThan(2);
    expect(world.player.root.visible).toBe(false);
  });

  it('他のステージ遷移で入力のロックが外れても、運転中は固定し直す', () => {
    startDrive(world);
    input.locked = false;
    run(1);
    expect(input.locked).toBe(true);
  });
});

describe('タイミング加速', () => {
  it('バーの判定：中央が PERFECT、周りが GOOD、端は MISS', () => {
    expect(judge(0.5)).toBe('perfect');
    expect(judge(0.5 + DRIVE.perfectHalf - 0.001)).toBe('perfect');
    expect(judge(0.5 + DRIVE.goodHalf - 0.001)).toBe('good');
    expect(judge(0.5 + DRIVE.goodHalf + 0.01)).toBe('miss');
    expect(judge(0.02)).toBe('miss');
    expect(cursorAt(0)).toBe(0);
    expect(cursorAt(DRIVE.barPeriod / 4)).toBeCloseTo(0.5, 5);
    expect(cursorAt(DRIVE.barPeriod / 2)).toBeCloseTo(1, 5);
  });

  const pressAt = (c: number): void => {
    // カーソルが c(0..0.5 の左半分) の位置に来る瞬間に押す
    drive.cursorT = (c / 2) * DRIVE.barPeriod - 1 / 60;
    input.tap('Space');
    run(1);
  };

  it('PERFECT は大きく、GOOD は小さく加速し、MISS は加速しない', () => {
    startDrive(world);
    pressAt(0.5);
    expect(events('driveBoost')[0].quality).toBe('perfect');
    run(90);
    const perfectKmh = kmhOf(drive);
    expect(perfectKmh).toBeGreaterThan(DRIVE.gainPerfect * 0.6);

    setup(); startDrive(world);
    pressAt(0.5 - DRIVE.perfectHalf - 0.05); // GOOD の帯
    expect(events('driveBoost')[0].quality).toBe('good');
    run(90);
    const goodKmh = kmhOf(drive);
    expect(goodKmh).toBeGreaterThan(2);
    expect(goodKmh).toBeLessThan(perfectKmh * 0.7);

    setup(); startDrive(world);
    pressAt(0.05);
    expect(events('driveBoost')[0].quality).toBe('miss');
    run(90);
    expect(kmhOf(drive)).toBe(0);
  });

  it('連打：クールダウン中に押してもミス扱いで、続けて加速しない', () => {
    startDrive(world);
    pressAt(0.5);
    pressAt(0.5); // すぐもう一度（クールダウン中）
    const q = events('driveBoost').map((e) => e.quality);
    expect(q).toEqual(['perfect', 'miss']);
  });

  it('T字路を曲がり終えるまでは 90km/h で頭打ち。曲がった後は上限が外れる', () => {
    startDrive(world);
    drive.pendingKmh = 500;
    run(120);
    expect(kmhOf(drive)).toBeLessThanOrEqual(DRIVE.preTurnCapKmh + 0.01);
    expect(kmhOf(drive)).toBeGreaterThan(DRIVE.preTurnCapKmh - 12);
    // 直線に入ったら 90 を超えて上がる
    setup(); startDrive(world);
    placeWest(-50, ROAD.junctionZ, 90);
    drive.pendingKmh = 300;
    run(120);
    expect(kmhOf(drive)).toBeGreaterThan(150);
    expect(kmhOf(drive)).toBeLessThanOrEqual(DRIVE.maxKmh + 0.01);
  });

  it('転がり抵抗で、押さないと少しずつ遅くなる', () => {
    startDrive(world);
    placeWest(-50, ROAD.junctionZ, 200);
    const v0 = kmhOf(drive);
    run(60);
    expect(kmhOf(drive)).toBeLessThan(v0 - 5);
    expect(kmhOf(drive)).toBeGreaterThan(v0 - 25);
  });
});

describe('T字路', () => {
  /** 北へ進みながら、T字路の手前で舵を保つ */
  function approach(steer: 'left' | 'right' | 'none'): void {
    startDrive(world);
    drive.pendingKmh = 90;
    run(30);
    if (steer === 'left') input.hold('KeyA'); else if (steer === 'right') input.hold('KeyD');
    for (let i = 0; i < 60 * 40 && drive.mode === 'north'; i++) run(1);
  }

  it('左折：アークで西向きの直線へ入り、曲がり終えるまでは上限が掛かる', () => {
    approach('left');
    for (let i = 0; i < 60 * 8 && drive.mode !== 'west'; i++) { drive.pendingKmh = Math.max(drive.pendingKmh, 10); run(1); }
    expect(drive.mode).toBe('west');
    expect(drive.yaw).toBeCloseTo(Math.PI / 2, 5);
    expect(drive.pos.z).toBeCloseTo(ROAD.junctionZ, 3);
    expect(drive.pos.x).toBeLessThan(-5);
    expect(drive.junctionDone).toBe(true);
    expect(events('driveBump').length).toBe(0);
  });

  it('右（東）へ行くと柵に軽くぶつかって大きく減速し、立て直して左へ向かえる', () => {
    approach('right');
    input.release('KeyD');
    let bumped = false;
    let minKmh = 999;
    for (let i = 0; i < 60 * 12 && drive.mode !== 'west'; i++) {
      drive.pendingKmh = Math.max(drive.pendingKmh, 8);
      run(1);
      if (drive.mode === 'bounce') { bumped = true; minKmh = Math.min(minKmh, kmhOf(drive)); }
    }
    expect(bumped).toBe(true);
    expect(events('driveBump').length).toBe(1);
    expect(drive.phase).toBe('driving'); // 失敗ではない
    expect(world.player.hp).toBeGreaterThan(0);
    expect(drive.mode).toBe('west');
    expect(drive.yaw).toBeCloseTo(Math.PI / 2, 5);
    expect(drive.pos.z).toBeGreaterThan(ROAD.junctionZ - ROAD.width / 2);
    expect(drive.pos.z).toBeLessThan(ROAD.junctionZ + ROAD.width / 2);
  });

  it('舵を切らずに進むと北の壁にぶつかって跳ね返る', () => {
    approach('none');
    for (let i = 0; i < 60 * 10 && drive.mode === 'north'; i++) { drive.pendingKmh = Math.max(drive.pendingKmh, 8); run(1); }
    expect(drive.mode).not.toBe('north');
    expect(events('driveBump').length).toBe(1);
    expect(drive.pos.z).toBeGreaterThanOrEqual(ROAD.junctionZ - DRIVE.northWall - 0.01);
  });

  it('左右の動きは道幅（余白あり）の範囲に収まる', () => {
    startDrive(world);
    drive.pendingKmh = 60;
    input.hold('KeyD');
    run(180);
    expect(drive.pos.x).toBeLessThanOrEqual(DRIVE.latMax + 1e-6);
    input.release('KeyD');
    input.hold('KeyA');
    run(240);
    expect(drive.pos.x).toBeGreaterThanOrEqual(-DRIVE.latMax - 1e-6);
    // 曲がる区間に入る前
    expect(TURN_Z).toBeGreaterThan(ROAD.junctionZ);
  });
});

describe('障害物', () => {
  it('道幅の 1/3 で、必ず反対側に十分な空きがある。間隔は広い', () => {
    const obs = planObstacles();
    expect(obs.length).toBeGreaterThanOrEqual(8);
    expect(OBSTACLE_WIDTH).toBeCloseTo(ROAD.width / 3, 5);
    for (const o of obs) {
      expect(o.w).toBeLessThanOrEqual(ROAD.width / 3 + 1e-6);
      const left = o.z - o.w / 2 - (ROAD.junctionZ - ROAD.width / 2);
      const right = ROAD.junctionZ + ROAD.width / 2 - (o.z + o.w / 2);
      expect(Math.max(left, right)).toBeGreaterThan(DRIVE.halfWid * 2 + 1.5);
    }
    for (let i = 1; i < obs.length; i++) expect(Math.abs(obs[i].x - obs[i - 1].x)).toBeGreaterThanOrEqual(100);
    // 判定地点より手前にだけ置く
    for (const o of obs) expect(o.x).toBeGreaterThan(CHECKPOINT.x);
  });

  it('当たると crashed → driveCrash → しばらくして HP 0（死亡画面）', () => {
    startDrive(world);
    const o = drive.obstacles[0];
    placeWest(o.def.x + 20, o.def.z, 200);
    run(40);
    expect(drive.phase).toBe('crashed');
    expect(events('driveCrash').length).toBe(1);
    expect(drive.speed).toBe(0);
    expect(world.player.hp).toBeGreaterThan(0);
    run(30);
    expect(world.player.hp).toBeGreaterThan(0); // まだ 1.2 秒経っていない
    run(60);
    expect(world.player.hp).toBe(0);
  });

  it('障害物の反対側を通れば当たらない', () => {
    startDrive(world);
    const o = drive.obstacles.find((q) => q.def.z !== ROAD.junctionZ)!;
    const safeZ = ROAD.junctionZ + (o.def.z > ROAD.junctionZ ? -1 : 1) * 4;
    placeWest(o.def.x + 20, safeZ, 200);
    run(40);
    expect(drive.phase).toBe('driving');
    expect(drive.pos.x).toBeLessThan(o.def.x);
  });
});

describe('雑魚敵', () => {
  it('たくさん（約30以上）いて、障害物の上には置かない', () => {
    startDrive(world);
    expect(drive.zako.length).toBeGreaterThanOrEqual(30);
    const kinds = new Set(drive.zako.map((z) => z.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(5);
    const obs = planObstacles();
    for (const z of planZako(obs)) {
      for (const o of obs) {
        if (Math.abs(o.x - z.x) < o.d / 2 + 2) expect(Math.abs(o.z - z.z)).toBeGreaterThan(o.w / 2);
      }
    }
  });

  it('車に当たるとはね飛ばされ、イベントが出て、速度は落ちない', () => {
    startDrive(world);
    const z = drive.zako[3];
    const zz = z.pos.z;
    placeWest(z.pos.x + 14, zz, 150);
    const v0 = drive.speed;
    run(30);
    expect(z.state).toBe('flung');
    expect(z.vel.y).toBeGreaterThan(5);
    expect(Math.hypot(z.vel.x, z.vel.z)).toBeGreaterThan(5);
    expect(events('driveHitEnemy').length).toBeGreaterThanOrEqual(1);
    expect(drive.hits).toBeGreaterThanOrEqual(1);
    expect(drive.phase).toBe('driving');
    expect(drive.speed).toBeGreaterThan(v0 * 0.9);
    // 少し経つと消える（片付く）
    const root = z.root;
    run(60 * 4);
    expect(z.state).toBe('gone');
    expect(root.parent).toBeNull();
  });
});

describe('判定地点', () => {
  it('300km/h 以上で越えると成功の演出を呼び、driveCheckpoint ok=true', () => {
    startDrive(world);
    placeWest(CHECKPOINT.x + 8, ROAD.junctionZ, 320);
    drive.checkpointDone = false;
    run(20);
    expect(drive.phase).toBe('cutscene');
    expect(drive.result).toBe('success');
    expect(cut.success).toHaveBeenCalledTimes(1);
    expect(cut.fail).not.toHaveBeenCalled();
    expect(cut.success.mock.calls[0][1]).toBe(drive);
    const cp = events('driveCheckpoint');
    expect(cp.length).toBe(1);
    expect(cp[0].ok).toBe(true);
    expect(cp[0].kmh as number).toBeGreaterThanOrEqual(300);
    // 演出が終わったら done ＋ トースト（死亡はしない）
    cut.onDone[0]();
    expect(drive.phase).toBe('done');
    expect(world.player.hp).toBeGreaterThan(0);
    expect(world.toasts.some((t) => t.text.includes('サージ収容所に潜入'))).toBe(true);
  });

  it('足りないと失敗の演出を呼び、終わったら HP 0（死亡画面）', () => {
    startDrive(world);
    placeWest(CHECKPOINT.x + 8, ROAD.junctionZ, 240);
    drive.checkpointDone = false;
    run(20);
    expect(drive.phase).toBe('cutscene');
    expect(drive.result).toBe('fail');
    expect(cut.fail).toHaveBeenCalledTimes(1);
    expect(cut.success).not.toHaveBeenCalled();
    expect(events('driveCheckpoint')[0].ok).toBe(false);
    expect(world.player.hp).toBeGreaterThan(0);
    cut.onDone[0]();
    expect(drive.phase).toBe('done');
    expect(world.player.hp).toBe(0);
  });

  it('境目：300km/h ぎりぎりは成功、299 は失敗', () => {
    startDrive(world);
    placeWest(CHECKPOINT.x + 0.5, ROAD.junctionZ, 300.6);
    drive.checkpointDone = false;
    run(10);
    expect(drive.result).toBe('success');
    setup(); startDrive(world);
    placeWest(CHECKPOINT.x + 0.5, ROAD.junctionZ, 299);
    drive.checkpointDone = false;
    run(10);
    expect(drive.result).toBe('fail');
  });

  it('演出中は車を動かさず（演出が動かす）、車輪は回り続ける', () => {
    startDrive(world);
    placeWest(CHECKPOINT.x + 8, ROAD.junctionZ, 320);
    drive.checkpointDone = false;
    run(20);
    const x = drive.pos.x;
    run(30);
    expect(drive.pos.x).toBe(x);
    expect(drive.phase).toBe('cutscene');
  });
});

describe('調整（シミュレーション）', () => {
  /** 狙った品質で押す練習者。pPerfect / pGood の確率で狙い、タイミングを待って押す */
  function play(pPerfect: number, pGood: number, seed: number): { kmh: number; t: number } {
    let r = seed >>> 0;
    const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
    const s = createSim(0, 2, 0);
    let t = 0, target = -1, kmh = 0;
    const dt = 1 / 60;
    while (t < 120 && !s.checkpointDone) {
      let press = false;
      if (s.cooldown <= 0) {
        if (target < 0) { const u = rnd(); target = u < pPerfect ? 0 : u < pPerfect + pGood ? 1 : 2; }
        const d = Math.abs(cursorAt(s.cursorT) - 0.5);
        const want = target === 0 ? d < DRIVE.perfectHalf * 0.5 : target === 1 ? d > DRIVE.perfectHalf * 1.3 && d < DRIVE.goodHalf * 0.8 : d > DRIVE.goodHalf + 0.05;
        if (want) { press = true; target = -1; }
      }
      const ev = stepSim(s, { steer: s.mode === 'north' && s.pos.z < 0 ? -1 : 0, press }, dt);
      for (const e of ev) if (e.type === 'checkpoint') kmh = e.kmh;
      t += dt;
    }
    return { kmh, t };
  }

  it('そこそこ上手い人（PERFECT 6割・GOOD 3割）は 300km/h に届き、全体で 25〜35 秒前後', () => {
    let ok = 0;
    for (let k = 1; k <= 8; k++) {
      const r = play(0.6, 0.3, k * 7919);
      if (r.kmh >= CHECKPOINT.kmh) ok++;
      expect(r.t).toBeGreaterThan(22);
      expect(r.t).toBeLessThan(40);
    }
    expect(ok).toBeGreaterThanOrEqual(7);
  });

  it('雑な人（PERFECT 2割・GOOD 3.5割）は届かない', () => {
    for (let k = 1; k <= 8; k++) expect(play(0.2, 0.35, k * 7919).kmh).toBeLessThan(CHECKPOINT.kmh);
  });

  it('全部 PERFECT の人は上限（340km/h）まで行ける', () => {
    expect(play(1, 0, 1).kmh).toBeGreaterThan(335);
    expect(play(1, 0, 1).kmh).toBeLessThanOrEqual(DRIVE.maxKmh + 0.5);
  });
});
