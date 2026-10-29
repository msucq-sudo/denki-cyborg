// ハッキング：hackable な敵に吸収アームをつなぐと、ランダムな8個のコード入力が始まる。
// 全部正しく入れると敵が味方になる（e.allied）。間違えると最初からやり直し＋電力を失う。
// 状態はすべて world.hack / e.ai に置く（モジュール変数は持たない）
import { HACK } from '../config/balance';
import { hackAllyTime, hackFailEnergy } from '../progression/effects';
import type { Enemy, World } from '../core/types';
import { isTargetable } from '../core/enemyUtil';
import { drainEnergy } from '../core/energy';
import { spawnBurst, spawnFlash, spawnShockwave } from '../core/effects';
import { KIND_MODULES } from '../enemies/kinds';

/** ミス時の赤い点滅の長さ（秒） */
export const HACK_FAIL_FLASH = 0.4;
/** 成功表示の長さ（秒） */
export const HACK_SUCCESS_FLASH = 2.2;

/** 0以上1未満の乱数（テストで差し替えられる） */
export type Rng = () => number;

// ---------------------------------------------------------------- 純粋な補助関数

/**
 * 出題コードを作る。要素は 0..(選択肢数-1) の番号。
 * 同じ番号が3回以上続かないようにする
 */
export function generateCode(rng: Rng = Math.random, length: number = HACK.codeLength): number[] {
  const n = HACK.keyboardKeys.length;
  const code: number[] = [];
  for (let i = 0; i < length; i++) {
    let v = Math.min(n - 1, Math.floor(rng() * n));
    if (i >= 2 && code[i - 1] === code[i - 2] && v === code[i - 1]) {
      // 3連続になるので、同じ番号を除いた中から引き直す
      const k = Math.min(n - 2, Math.floor(rng() * (n - 1)));
      v = k >= code[i - 1] ? k + 1 : k;
    }
    code.push(v);
  }
  return code;
}

/** 番号 → キーボードのキー（KeyboardEvent.code） */
export function codeToKeys(code: readonly number[]): string[] {
  return code.map((i) => HACK.keyboardKeys[i]);
}

/** 番号 → パッドの仮想キー */
export function codeToPad(code: readonly number[]): string[] {
  return code.map((i) => HACK.padKeys[i]);
}

/** キー名（キーボードでもパッドでも）→ 番号。出題に使うキーでなければ -1 */
export function indexOfKey(key: string): number {
  const k = HACK.keyboardKeys.indexOf(key);
  return k >= 0 ? k : HACK.padKeys.indexOf(key);
}

export interface HackStep {
  /** 今の入力が正しかった */
  ok: boolean;
  /** 入力後に正しく入れられた個数（間違えたら 0） */
  progress: number;
  /** コードを入れ終えた */
  done: boolean;
}

/** コード（番号列）の progress 番目に対して index を入力したときの結果 */
export function stepCode(code: readonly number[], progress: number, index: number): HackStep {
  if (index !== code[progress]) return { ok: false, progress: 0, done: false };
  const next = progress + 1;
  return { ok: true, progress: next, done: next >= code.length };
}

// ---------------------------------------------------------------- World との接続

export function initHack(world: World): void {
  const h = world.hack;
  h.active = false;
  h.target = null;
  h.codeKeys = [];
  h.codePad = [];
  h.progress = 0;
  h.failFlash = 0;
  h.successFlash = 0;
  h.device = 'kbm';
  world.player.hacking = false;
  // 前のワールドで押さえっぱなしになっていないように
  world.input.padCapture = false;
}

/** この敵はハッキングの対象か */
function isHackTarget(e: Enemy | null): e is Enemy {
  return !!e && !e.allied && isTargetable(e) && !!KIND_MODULES[e.kind]?.hackable;
}

/** 毎フレーム updateAbsorb の直後に呼ぶ */
export function updateHack(world: World, dt: number): void {
  const h = world.hack;
  const input = world.input;
  const a = world.absorb;
  h.failFlash = Math.max(0, h.failFlash - dt);
  h.successFlash = Math.max(0, h.successFlash - dt);

  const tgt = a.phase === 'attached' ? a.target : null;
  const valid = isHackTarget(tgt) && world.enemies.includes(tgt);

  // つながりが切れた／別の敵になった：中止
  if (h.active && (!valid || tgt !== h.target)) cancelHack(world);
  // つながった：開始
  if (!h.active && valid) startHack(world, tgt);

  h.device = input.lastDevice ?? 'kbm';

  if (h.active && h.target) {
    // 出題キーのどれかが押されたら1入力（キーボードもパッドも同じ番号なら受け付ける）
    let idx = -1;
    for (let i = 0; i < HACK.keyboardKeys.length; i++) {
      if (input.pressed(HACK.keyboardKeys[i]) || input.pressed(HACK.padKeys[i])) { idx = i; break; }
    }
    if (idx >= 0) {
      const code = h.codeKeys.map((k) => HACK.keyboardKeys.indexOf(k));
      const r = stepCode(code, h.progress, idx);
      h.progress = r.progress;
      world.events.emit('hackInput', { ok: r.ok, progress: r.progress });
      if (!r.ok) {
        h.failFlash = HACK_FAIL_FLASH;
        drainEnergy(world, hackFailEnergy(world));
        spawnBurst(world, h.target.pos, 0xff5a3a, 8, 4, 0.3);
      } else {
        spawnBurst(world, h.target.pos, 0x66e6ff, 3, 2.5, 0.25);
      }
      if (r.done) succeedHack(world, h.target);
    }
  }

  world.player.hacking = h.active;
  // ハッキング中は十字キー/ABXY をゲーム操作にしない。終わった（成功・中止）あとも、
  // 押しっぱなしのボタンが離されるまでは捕まえたままにする（押しっぱなしでジャンプなどが暴発しないように）。
  // このために、終了後も出題コードは「押しっぱなしのボタンがある間」だけ残しておく
  const held = h.active || (h.codeKeys.length > 0 && padHeld(input));
  if (!h.active && !held && h.codeKeys.length > 0) { h.codeKeys = []; h.codePad = []; }
  input.padCapture = held;
}

/** パッドの出題ボタン（十字キー・ABXY）のどれかが押されたままか */
function padHeld(input: World['input']): boolean {
  return HACK.padKeys.some((k) => input.isDown(k));
}

function startHack(world: World, e: Enemy): void {
  const h = world.hack;
  const code = generateCode();
  h.active = true;
  h.target = e;
  h.codeKeys = codeToKeys(code);
  h.codePad = codeToPad(code);
  h.progress = 0;
  h.failFlash = 0;
  h.successFlash = 0;
  world.events.emit('hackStart', {});
}

function cancelHack(world: World): void {
  const h = world.hack;
  h.active = false;
  h.target = null;
  h.progress = 0;
  world.events.emit('hackCancel', {});
}

/** コード完成：敵が味方になる。吸収アームは「対象でなくなった」ことで次のフレームに静かに戻る */
function succeedHack(world: World, e: Enemy): void {
  const h = world.hack;
  e.allied = true;
  e.tethered = false;
  const allyTime = hackAllyTime(world);
  e.ai.allyT = allyTime;
  e.ai.allyMax = allyTime;
  e.ai.windup = 0;
  e.ai.warn = 0;
  e.ai.alert = 0;
  h.active = false;
  h.target = null;
  h.progress = 0;
  h.successFlash = HACK_SUCCESS_FLASH;
  const pos = e.pos.clone();
  spawnShockwave(world, pos, 0x66e6ff, e.radius * 3, 0.5);
  spawnFlash(world, pos, 0x66e6ff, 8, 10, 0.25);
  spawnBurst(world, pos, 0x66e6ff, 20, 5, 0.5);
  world.events.emit('hackSuccess', { pos });
}
