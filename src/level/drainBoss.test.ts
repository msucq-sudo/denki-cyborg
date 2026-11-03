import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/events';
import type { World } from '../core/types';
import { createWorld } from '../core/world';
import { DRAIN_BOSS } from '../config/balance';
import { damageEnemy, updateEnemies } from '../enemies/api';
import { initPlayer, updatePlayer } from '../player/player';
import { generateDrain } from './drain/plan';
import { buildDrainBoss, getDrainBoss, getDrainBossMemo, setDrainBossMemo, updateDrainBoss } from './drainBoss';
import { BEAT, BOSS_CUT_TOTAL, SHOTS } from './drainBoss/cutscene';
import { ARENA, BOSS_FIGHT, CONSOLE, CORRIDOR, DEVICE, DOOR, FIGHT_START, GEAR_POSITIONS, GRAPPLE_PTS, HALL, HOLE, SCAFFOLD, START, STORE, UPPER } from './drainBoss/layout';
import { moveCharacter, raycastLevel } from '../core/collision';
import { getGrapplePoints } from '../core/grapple';
import { GRAPPLE, PLAYER } from '../config/balance';
import { activeCheckpointId, checkpointChoices, CHECKPOINT_TARGETS } from '../core/checkpoints';
import { describeSave, readSave, writeSave, type SaveData } from '../core/save';
import { MOVIE_LIST } from '../tools/movieCatalog';
import { movieFromSearch, movieUrl } from '../cinematic/movieMode';
import { setPlayerFacing } from '../player/player';

const DT = 1 / 30;

function mk(startAt?: string, withPlayer = false) {
  const keys = new Set<string>();
  const input = {
    locked: false, enabled: true, mouseDX: 0, mouseDY: 0, mousePressed: () => false, mouseReleased: () => false,
    pressed: (k: string) => keys.has(k), isDown: () => false, mouse: () => false,
    rawPressed: () => false, rawDown: () => false, lastDevice: 'kbm',
  };
  const w = createWorld(input as never, new EventBus(), 1);
  w.state = 'playing';
  if (startAt) w.level.data.startAt = startAt;
  buildDrainBoss(w);
  if (withPlayer) initPlayer(w);
  const tick = () => { w.time += DT; w.player.invuln = Math.max(w.player.invuln, 0); if (withPlayer) updatePlayer(w, DT); updateEnemies(w, DT); updateDrainBoss(w, DT); };
  const run = (sec: number, stop?: () => boolean) => { for (let i = 0; i < Math.round(sec / DT); i++) { tick(); if (stop?.()) return; } };
  return { w, input, run, tick };
}

/** ドアに近づいて開くのを待ち、入口をまたぐ（ムービーが始まる） */
function enter(w: World, run: (sec: number, stop?: () => boolean) => void): void {
  w.player.pos.set(0, 0, DOOR.z + 4);
  run(2);
  w.player.pos.set(0, 0, DOOR.z + 1.5);
  run(DT * 2);
}

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
beforeEach(() => { (globalThis as any).localStorage = new MemStorage(); setDrainBossMemo(null); });
afterEach(() => { delete (globalThis as any).localStorage; setDrainBossMemo(null); });

describe('ドレイン装置の部屋（drainBoss）', () => {
  it('ボスの部屋は、ドレイン装置ダンジョンのどの部屋よりもはるかに広い', () => {
    const arena = (ARENA.x1 - ARENA.x0) * (ARENA.z1 - ARENA.z0);
    const biggest = Math.max(...generateDrain().rooms.filter((r) => r.id !== 'rope').map((r) => (r.x1 - r.x0) * (r.z1 - r.z0)));
    expect(arena).toBeGreaterThan(biggest * 2.5);
    expect(ARENA.x1 - ARENA.x0).toBeGreaterThanOrEqual(60);
  });

  it('キーボード・モニターの壁は北の壁際、ドレイン装置は東の壁際：真ん中の広い床をふさがない', () => {
    const { w } = mk();
    const desks = w.colliders.filter((c) => c.tag === 'desk');
    const dev = w.colliders.filter((c) => c.tag === 'device');
    expect(desks.length).toBeGreaterThan(0);
    expect(dev.length).toBeGreaterThan(0);
    for (const d of desks) expect(d.max.z - ARENA.z0).toBeLessThanOrEqual(CONSOLE.depth + 0.01);
    for (const d of dev) expect(ARENA.x1 - d.min.x).toBeLessThanOrEqual(ARENA.x1 - DEVICE.x0 + 0.5);
    // 部屋の中央の 40x36m には、壁際のもの以外の当たり判定がない
    const centre = new THREE.Box3(new THREE.Vector3(-20, 0.2, -18), new THREE.Vector3(20, 6, 20));
    for (const c of w.colliders) {
      if (c.tag === 'floor' || c.tag === 'ceil' || c.tag === 'wall' || !c.active) continue;   // 撃破後に出る足場は有効になるまで数えない
      const b = new THREE.Box3(c.min, c.max);
      expect(b.intersectsBox(centre), c.tag).toBe(false);
    }
  });

  it('通路のスタートは北向き。ドアは閉まっていて、ザコ敵はいない', () => {
    const { w } = mk();
    const d = getDrainBoss(w)!;
    expect(d.state.phase).toBe('corridor');
    expect(w.player.pos.x).toBeCloseTo(START.x);
    expect(w.player.pos.z).toBeCloseTo(START.z);
    expect(START.z).toBeGreaterThan(CORRIDOR.z0);
    expect(d.state.doorOpen).toBe(0);
    expect(d.vis.doorCollider.active).toBe(true);
    expect(w.enemies).toHaveLength(0);
    expect(w.level.data.retryAt).toBe('corridor');
  });

  it('近づくと自動ドアがスライドで開き、入るとムービーが始まる（ボスだけが出る）', () => {
    const { w, input, run } = mk();
    const d = getDrainBoss(w)!;
    w.player.pos.set(0, 0, DOOR.z + DOOR.openDist + 5);
    run(1);
    expect(d.state.doorOpen).toBe(0);
    w.player.pos.set(0, 0, DOOR.z + 4);
    run(0.5);
    expect(d.state.doorOpen).toBeGreaterThan(0);
    expect(d.state.doorOpen).toBeLessThan(1);
    run(2);
    expect(d.state.doorOpen).toBe(1);
    expect(d.vis.doorCollider.active).toBe(false);
    expect(d.state.phase).toBe('corridor');
    enter(w, run);
    expect(d.state.phase).toBe('cutscene');
    expect(d.cut).not.toBeNull();
    expect(input.locked).toBe(true);
    expect(w.enemies).toHaveLength(1);
    expect(w.enemies[0].kind).toBe('drainGuard');
    expect(w.enemies[0].ai.inert).toBe(true);
  });

  it('導入ムービーは9ショット。時刻の順番が合い、最後まで見ると戦闘が始まる', () => {
    expect(SHOTS).toHaveLength(9);
    expect(BOSS_CUT_TOTAL).toBeGreaterThan(30);
    const order = [BEAT.walkEnd, BEAT.aim0, BEAT.charge0, BEAT.crack0, BEAT.chargeEnd, BEAT.tilesBreak, BEAT.land, BEAT.step1, BEAT.step2, BEAT.aimEnd, BOSS_CUT_TOTAL];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    const { w, input, run } = mk();
    const d = getDrainBoss(w)!;
    enter(w, run);
    expect(d.state.phase).toBe('cutscene');
    const names: string[] = [];
    let minY = 99, maxCharge = 0, maxCrack = 0;
    run(BOSS_CUT_TOTAL + 3, () => {
      if (d.cut) {
        if (names[names.length - 1] !== d.cut.shotName) names.push(d.cut.shotName);
        minY = Math.min(minY, d.probe.bossY); maxCharge = Math.max(maxCharge, d.probe.charge); maxCrack = Math.max(maxCrack, d.probe.crack);
      }
      return d.state.phase !== 'cutscene';
    });
    expect(names).toEqual(SHOTS.map((s) => s.name));
    expect(minY).toBeLessThan(3);           // 着地した
    expect(maxCharge).toBeGreaterThan(0.9);   // 溜めた
    expect(maxCrack).toBeGreaterThan(0.9);    // ひび割れた
    expect(d.state.phase).toBe('fight');
    expect(d.state.sawCutscene).toBe(true);
    expect(input.locked).toBe(false);
    expect(w.level.data.retryAt).toBe('boss');
    expect(w.level.bossSpawned).toBe(true);
    const b = d.boss!;
    expect(b.ai.inert).toBe(false);
    expect(b.pos.x).toBeCloseTo(BOSS_FIGHT.x);
    expect(b.pos.z).toBeCloseTo(BOSS_FIGHT.z);
    expect(w.player.pos.z).toBeCloseTo(FIGHT_START.z);
    expect(w.enemies).toHaveLength(1);
    expect(d.vis.tilesBroken).toBe(true);
  });

  it('途中でスキップしても、見終えたときと同じ終了状態になる', () => {
    const finalState = (skipAt: number | null) => {
      const { w, run } = mk();
      const d = getDrainBoss(w)!;
      enter(w, run);
      if (skipAt === null) run(BOSS_CUT_TOTAL + 3, () => d.state.phase !== 'cutscene');
      else { run(skipAt); d.cut!.skip(); }
      run(0.2);
      const b = d.boss!;
      return JSON.stringify({
        phase: d.state.phase, boss: [b.pos.x, b.pos.y, b.pos.z].map((v) => Math.round(v * 100) / 100), vis: b.root.visible, inert: b.ai.inert,
        player: [w.player.pos.x, w.player.pos.z, w.player.yaw], door: d.state.doorOpen, tiles: d.vis.tilesBroken, locked: w.input.locked,
        retry: w.level.data.retryAt, aim: w.level.data.poseAim, charging: w.player.charging, enemies: w.enemies.length,
      });
    };
    const natural = finalState(null);
    for (const t of [1, 6, 15, 20, 26, 30]) expect(finalState(t), `skip@${t}`).toBe(natural);
  });

  it('start=boss（リトライ・チェックポイント）は、ムービーなしでボス戦の開始状態から。ザコ敵なし', () => {
    const { w, input } = mk('boss');
    const d = getDrainBoss(w)!;
    expect(d.state.phase).toBe('fight');
    expect(d.cut).toBeNull();
    expect(input.locked).toBe(false);
    expect(w.enemies.map((e) => e.kind)).toEqual(['drainGuard']);
    expect(d.boss!.ai.inert).toBe(false);
    expect(d.boss!.pos.z).toBeCloseTo(BOSS_FIGHT.z);
    expect(w.player.pos.z).toBeCloseTo(FIGHT_START.z);
    expect(d.state.doorOpen).toBe(1);
    expect(w.level.data.retryAt).toBe('boss');
    expect(w.level.bossSpawned).toBe(true);
  });

  it('ボスを倒すと「準備中」の案内になり、撃破が記録される。ゲームクリア画面にはならない', () => {
    const { w, run } = mk('boss');
    const d = getDrainBoss(w)!;
    expect(getDrainBossMemo()).toBeNull();
    damageEnemy(w, d.boss!, 99999, { how: 'shot' });
    run(0.5);
    expect(d.state.phase).toBe('defeated');
    expect(d.state.defeated).toBe(true);
    expect(getDrainBossMemo()).toEqual({ defeated: true });
    expect(w.level.bossDefeated).toBe(false);
    expect(String(w.level.data.objective)).toContain('準備中');
    expect(w.toasts.some((t) => t.text.includes('準備中'))).toBe(true);
    expect(w.level.data.saveDirty).toBe(true);
    run(4);
    expect(w.enemies).toHaveLength(0);
    // 撃破済みの記録から入り直すと、ボスもムービーもない
    const again = mk('corridor');
    const d2 = getDrainBoss(again.w)!;
    expect(d2.state.defeated).toBe(true);
    expect(d2.state.phase).toBe('defeated');
    again.w.player.pos.set(0, 0, DOOR.z + 1);
    again.run(2);
    expect(d2.cut).toBeNull();
    expect(again.w.enemies).toHaveLength(0);
    const again2 = mk('boss');
    expect(getDrainBoss(again2.w)!.boss).toBeNull();
    expect(again2.w.enemies).toHaveLength(0);
  });

  it('記録の読み込み：壊れた形は捨てる', () => {
    setDrainBossMemo({ defeated: true });
    expect(getDrainBossMemo()).toEqual({ defeated: true });
    for (const bad of [null, 1, 'x', [], { defeated: 'yes' }, {}]) { setDrainBossMemo(bad); expect(getDrainBossMemo()).toBeNull(); }
  });

  it('プレイヤーが通路を歩いてドアを通ると、ムービーのあと戦える（実際の移動で）', () => {
    const { w, run } = mk(undefined, true);
    const d = getDrainBoss(w)!;
    // 通路の途中からまっすぐ歩く（北＝-Z）
    w.player.pos.set(0, 0, DOOR.z + 12);
    const keys = new Set(['KeyW']);
    (w.input as unknown as { isDown: (k: string) => boolean }).isDown = (k) => keys.has(k);
    run(8, () => d.state.phase === 'cutscene');
    expect(d.state.phase).toBe('cutscene');
    expect(w.player.pos.z).toBeGreaterThan(DOOR.z);
    run(BOSS_CUT_TOTAL + 3, () => d.state.phase === 'fight');
    expect(d.state.phase).toBe('fight');
    setPlayerFacing(w, 0);
  });
});

describe('チェックポイント・セーブ・ムービー一覧', () => {
  it('チェックポイントに「ドレイン装置・通路」「ドレイン装置・ボス戦」がある（選択できる）', () => {
    const t = CHECKPOINT_TARGETS.filter((c) => c.level === 'drainBoss');
    expect(t.map((c) => [c.id, c.startAt, c.label])).toEqual([
      ['drainBoss:corridor', 'corridor', 'ドレイン装置・通路'],
      ['drainBoss:boss', 'boss', 'ドレイン装置・ボス戦'],
    ]);
    const choices = checkpointChoices(null, [], 'floor1');
    for (const id of ['drainBoss:corridor', 'drainBoss:boss']) expect(choices.find((c) => c.id === id)?.disabled, id).toBe(false);
  });

  it('いまの場所から正しいチェックポイントIDになる', () => {
    const a = mk('corridor').w;
    expect(activeCheckpointId(a, 'drainBoss', 'corridor')).toBe('drainBoss:corridor');
    const b = mk('boss').w;
    expect(activeCheckpointId(b, 'drainBoss', 'boss')).toBe('drainBoss:boss');
  });

  it('drainBoss のセーブを書いて読める。旧セーブ（drain など）も読める', () => {
    const base: SaveData = {
      v: 1, savedAt: 5, level: 'drainBoss', startAt: 'boss', checkpointId: 'drainBoss:boss', levelMemo: { defeated: true },
      inventory: { gears: 3, metal: 9 }, upgrades: {}, functions: { scouter: true, autoAim: false, flight: true },
      unlocks: { autoAim: false, vacuum: false, shield: false }, loadout: { owned: ['pistol'], current: 'pistol' }, selectedSkill: 'vacuum',
    };
    expect(writeSave(base)).toBe(true);
    const r = readSave()!;
    expect(r.level).toBe('drainBoss');
    expect(r.startAt).toBe('boss');
    expect(r.levelMemo).toEqual({ defeated: true });
    expect(describeSave(r)).toBe('ドレイン装置の部屋・ボス戦');
    expect(describeSave({ ...base, startAt: 'corridor', checkpointId: 'drainBoss:corridor' })).toBe('ドレイン装置の部屋・通路');
    // 通路・ボス戦以外の開始地点は読み込まない
    writeSave({ ...base, savedAt: 6, startAt: 'bogus', checkpointId: undefined });
    expect(readSave()).toBeNull();
    // 旧セーブ
    expect(writeSave({ ...base, savedAt: 7, level: 'drain', startAt: 'goal', checkpointId: 'drain:goal', levelMemo: { secs: [], mainOff: false, broken: [], fights: {}, minecart: true } })).toBe(true);
    expect(readSave()!.level).toBe('drain');
  });

  it('導入ムービーがムービー一覧とムービー単体モードに登録されている', () => {
    const m = MOVIE_LIST.find((x) => x.id === 'drainBoss')!;
    expect(m).toBeTruthy();
    expect(m.shots.map((s) => s.name)).toEqual(SHOTS.map((s) => s.name));
    expect(m.shots.reduce((a, s) => a + s.d, 0)).toBeCloseTo(BOSS_CUT_TOTAL, 6);
    expect(movieUrl('drainBoss')).toBe('index.html?level=drainBoss&start=movie&movie=drainBoss');
    expect(movieFromSearch('?level=drainBoss&start=movie&movie=drainBoss')).toBe('drainBoss');
  });

  it('start=movie はムービーだけ（終わると「ムービー終了」。戦闘にならない）', () => {
    const { w, run } = mk('movie');
    const d = getDrainBoss(w)!;
    run(DT * 2);
    expect(d.state.phase).toBe('cutscene');
    run(BOSS_CUT_TOTAL + 3, () => d.state.phase !== 'cutscene');
    expect(d.state.phase).toBe('movieEnd');
    expect(w.level.data.movieEnded).toBe(true);
    expect(w.level.bossSpawned).toBe(false);
  });

  it('balance の数値：HPは部位ごと・腕の再生は閾値つき', () => {
    expect(DRAIN_BOSS.hp.body).toBeGreaterThan(DRAIN_BOSS.hp.rArm);
    expect(DRAIN_BOSS.regen.minHp).toBeLessThan(DRAIN_BOSS.hp.lArm);
    expect(DRAIN_BOSS.regen.giveRatio).toBeGreaterThan(0);
    expect(DRAIN_BOSS.regen.giveRatio).toBeLessThan(1);
    expect(DRAIN_BOSS.phase2At).toBe(0.5);
  });
});

void (null as unknown as World);

describe('穴の上の部屋（ボスが落ちてきた元の場所）', () => {
  const defeat = () => {
    const m = mk('boss');
    const d = getDrainBoss(m.w)!;
    damageEnemy(m.w, d.boss!, 99999, { how: 'shot' });
    m.run(0.5);
    return { ...m, d };
  };
  const inside = (w: World, x: number, y: number, z: number) =>
    w.colliders.some((c) => c.active && x > c.min.x && x < c.max.x && y > c.min.y && y < c.max.y && z > c.min.z && z < c.max.z);
  const holeBlocked = (w: World, x: number = HOLE.x, z: number = HOLE.z) => raycastLevel(w.colliders, new THREE.Vector3(x, 2, z), new THREE.Vector3(x, UPPER.floorY + 8, z)) !== null;

  it('穴のまわりには上の階の床がある。穴の上は撃破前だけシャッターでふさがり、撃破後は何もない', () => {
    const { w } = mk('boss');
    const H = HOLE.size / 2;
    for (const [dx, dz] of [[-H - 3, 0], [H + 3, 0], [0, -H - 3], [0, H + 3]] as number[][]) {
      expect(inside(w, HOLE.x + dx, UPPER.floorY - 0.2, HOLE.z + dz), `床 ${dx},${dz}`).toBe(true);
    }
    expect(holeBlocked(w)).toBe(true);                          // 戦闘中は plug（非常シャッター）で閉じている
    expect(getGrapplePoints(w)).toHaveLength(0);
    expect(getDrainBoss(w)!.up.open).toBe(false);
    const { w: w2 } = defeat();
    expect(holeBlocked(w2)).toBe(false);
    expect(holeBlocked(w2, HOLE.x + H - 0.3, HOLE.z + H - 0.3)).toBe(false);
    expect(holeBlocked(w2, HOLE.x - H + 0.3, HOLE.z - H + 0.3)).toBe(false);
    // 穴の真上の空間に、有効な当たりは何もない（床から天井まで）
    for (let y = 0.5; y < UPPER.floorY + UPPER.h - 1; y += 0.5) {
      for (const [dx, dz] of [[0, 0], [-H + 0.4, -H + 0.4], [H - 0.4, H - 0.4], [-H + 0.4, H - 0.4]] as number[][]) {
        expect(inside(w2, HOLE.x + dx, y, HOLE.z + dz), `y=${y} ${dx},${dz}`).toBe(false);
      }
    }
  });

  it('ムービーで天井が割れたあとも、穴の上の部屋は見えている（上の階が残る）', () => {
    const { w, run } = mk();
    const d = getDrainBoss(w)!;
    enter(w, run);
    run(BEAT.tilesBreak + 0.5, () => d.vis.tilesBroken);
    run(1);
    expect(d.vis.tilesBroken).toBe(true);
    expect(d.state.phase).toBe('cutscene');
    expect(d.up.root.visible).toBe(true);
  });

  it('撃破すると穴の東に足場が現れ、グラップルポイントで穴のふちまで登れる距離になっている', () => {
    const { w, d } = defeat();
    expect(d.up.open).toBe(true);
    expect(getGrapplePoints(w)).toHaveLength(GRAPPLE_PTS.length);
    for (const sc of [SCAFFOLD.a, SCAFFOLD.b]) expect(inside(w, (sc.x0 + sc.x1) / 2, sc.top - 0.2, (sc.z0 + sc.z1) / 2)).toBe(true);
    const eye = (sc: { x0: number; x1: number; z0: number; z1: number; top: number }) => new THREE.Vector3((sc.x0 + sc.x1) / 2, sc.top + 1.5, (sc.z0 + sc.z1) / 2);
    const pt = (i: number) => new THREE.Vector3(GRAPPLE_PTS[i].x, GRAPPLE_PTS[i].y, GRAPPLE_PTS[i].z);
    const floorStand = new THREE.Vector3(HOLE.x + 4, 1.5, HOLE.z);
    expect(floorStand.distanceTo(pt(0))).toBeLessThan(GRAPPLE.range);        // 床 → 足場 a
    expect(eye(SCAFFOLD.a).distanceTo(pt(1))).toBeLessThan(GRAPPLE.range);   // 足場 a → 足場 b
    expect(eye(SCAFFOLD.b).distanceTo(pt(2))).toBeLessThan(GRAPPLE.range);   // 足場 b → 穴のふち
    // 視線が通る（間に壁・天井がない）
    expect(raycastLevel(w.colliders, eye(SCAFFOLD.a), pt(1).add(new THREE.Vector3(0.1, 0.1, 0)))).toBeNull();
    expect(raycastLevel(w.colliders, eye(SCAFFOLD.b), pt(2).add(new THREE.Vector3(0.1, 0.1, 0)))).toBeNull();
    // 法線は狙う側へ（a は西から、b・ふちは東から）
    expect(GRAPPLE_PTS.map((g) => g.nx)).toEqual([-1, 1, 1]);
    expect(GRAPPLE_PTS[2].y).toBe(UPPER.floorY);
  });

  it('撃破済みの記録から入り直すと、最初から足場がある（シャッターは閉じない）', () => {
    setDrainBossMemo({ defeated: true });
    const { w } = mk('boss');
    expect(getDrainBoss(w)!.up.open).toBe(true);
    expect(getGrapplePoints(w)).toHaveLength(GRAPPLE_PTS.length);
    expect(holeBlocked(w)).toBe(false);
    const c = mk('corridor');
    expect(getDrainBoss(c.w)!.up.open).toBe(true);
  });

  it('搬出通路は格納庫から保管庫までつながり、歩いて行ける。歯車は 40 個、どれも壁や棚の中にない', () => {
    const { w } = defeat();
    expect(GEAR_POSITIONS).toHaveLength(40);
    expect(new Set(GEAR_POSITIONS.map((g) => `${g.x},${g.y},${g.z}`)).size).toBe(40);
    for (const g of GEAR_POSITIONS) {
      expect(g.x).toBeGreaterThan(STORE.x0); expect(g.x).toBeLessThan(STORE.x1);
      expect(g.z).toBeGreaterThan(STORE.z0); expect(g.z).toBeLessThan(STORE.z1);
      expect(g.y).toBeGreaterThan(UPPER.floorY);
      expect(inside(w, g.x, g.y, g.z), `${g.x},${g.z}`).toBe(false);
    }
    // 穴の西のふちの床から、通路を歩いて保管庫の奥まで（重力あり）
    const pos = new THREE.Vector3(HOLE.x - HOLE.size / 2 - 2, UPPER.floorY + 0.05, HOLE.z);
    const vel = new THREE.Vector3();
    for (let i = 0; i < 30 * 30 && pos.x > STORE.x0 + 3; i++) {
      vel.set(-7, vel.y - 20 * DT, 0);
      const r = moveCharacter(w.colliders, pos, vel, DT, PLAYER.radius, PLAYER.height);
      if (r.onGround) vel.y = 0;
    }
    expect(pos.x).toBeLessThanOrEqual(STORE.x0 + 3);
    expect(pos.y).toBeGreaterThan(UPPER.floorY - 0.5);
    expect(pos.y).toBeLessThan(UPPER.floorY + 1);
    expect(HALL.x1).toBe(UPPER.x0);
    // 保管庫の中を南北に歩いて、歯車の列の両端まで行ける
    for (const gz of [GEAR_POSITIONS[0].z, GEAR_POSITIONS[5].z]) {
      const q = new THREE.Vector3(STORE.x1 - 2, UPPER.floorY + 0.05, HALL.z0 + 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < 400 && Math.abs(q.z - gz) > 0.3; i++) { v.set(0, v.y - 20 * DT, Math.sign(gz - q.z) * 5); const r = moveCharacter(w.colliders, q, v, DT, PLAYER.radius, PLAYER.height); if (r.onGround) v.y = 0; }
      expect(Math.abs(q.z - gz)).toBeLessThan(0.5);
    }
  });

  it('歯車は触れると取れて所持数が増え、記録（セーブ）に残る。入り直しても戻らない', () => {
    const { w, run } = defeat();
    const before = w.inventory.gears;
    const g0 = GEAR_POSITIONS[0], g7 = GEAR_POSITIONS[7];
    w.player.pos.set(g0.x, UPPER.floorY, g0.z);
    run(DT * 2);
    expect(w.inventory.gears).toBe(before + 1);
    expect(getDrainBoss(w)!.up.gears[0].taken).toBe(true);
    expect(getDrainBoss(w)!.up.gears[0].model.visible).toBe(false);
    expect(getDrainBossMemo()).toEqual({ defeated: true, gears: [0] });
    expect(w.level.data.saveDirty).toBe(true);
    run(DT * 4);
    expect(w.inventory.gears).toBe(before + 1);                 // 同じ歯車では増えない
    w.player.pos.set(g7.x, UPPER.floorY, g7.z);
    run(DT * 2);
    expect(getDrainBossMemo()!.gears).toEqual([0, 7]);
    // セーブ → 入り直し
    const saved = getDrainBossMemo();
    setDrainBossMemo(null);
    setDrainBossMemo(saved);
    const again = mk('boss');
    const d2 = getDrainBoss(again.w)!;
    expect(d2.up.gears.filter((g) => g.taken)).toHaveLength(2);
    expect(d2.up.gears[0].model.visible).toBe(false);
    expect(d2.up.gears[1].model.visible).toBe(true);
    expect(again.w.level.data.gears).toBe(2);
    again.w.player.pos.set(g0.x, UPPER.floorY, g0.z);
    again.run(DT * 3);
    expect(again.w.inventory.gears).toBe(0);                    // もう取れない
  });

  it('記録の読み込み：歯車の番号が壊れていたら捨てる。旧形式（歯車なし）は読める', () => {
    setDrainBossMemo({ defeated: true, gears: [1, 2] });
    expect(getDrainBossMemo()).toEqual({ defeated: true, gears: [1, 2] });
    for (const bad of [{ defeated: true, gears: [1, 1] }, { defeated: true, gears: [40] }, { defeated: true, gears: [-1] }, { defeated: true, gears: 'x' }, { defeated: true, gears: [0.5] }]) {
      setDrainBossMemo(bad);
      expect(getDrainBossMemo()).toBeNull();
    }
    setDrainBossMemo({ defeated: true });
    expect(getDrainBossMemo()).toEqual({ defeated: true });
  });
});
