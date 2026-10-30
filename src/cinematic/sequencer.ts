// カットシーンの進行役：ショットの並び（長さ・カメラ・時間の流れ）、黒帯・字幕・暗転・閃光、スキップ、HUD の非表示。
// 中身（車・敵・柵を動かす）は Script が持つ。main.ts は実時間の dt で全体を進めるので、スローモーションは
// ここで「Script と Fx に渡す dt」だけを timeScale 倍にして実現する（カメラのゆれ・暗転・黒帯は実時間のまま）。
import * as THREE from 'three';
import type { World } from '../core/types';
import type { CutsceneHandle } from './api';
import { createOverlay } from './overlay';
import type { Overlay } from './overlay';
import { Fx, SpeedLines } from './fx';

export interface CamPose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  /** 縦の画角（度） */
  fov: number;
  /** 傾き（rad） */
  roll: number;
}

export interface Shot {
  name: string;
  /** 長さ（実時間の秒）。end があるときは上限 */
  duration: number;
  /** 指定すると、これが true を返したらショット終了 */
  end?: () => boolean;
  enter?: () => void;
  leave?: () => void;
  /** カメラ。u=0..1 の進み具合、t=ショット内の実時間、dt=実時間 */
  camera: (u: number, t: number, pose: CamPose, dt: number) => void;
  /** 手持ちカメラのゆれの強さ（0..1。省略=0.25） */
  shake?: number;
  /** 画面下の字幕 */
  caption?: string;
  /** 時間の流れ（1=等倍、0.15=スロー）。省略=1 */
  timeScale?: (u: number, t: number) => number;
}

export interface Script {
  shots: Shot[];
  /** スケール済みの dt で世界（車・ヘビー・柵）を進める */
  sim(simDt: number, realDt: number): void;
  dispose(): void;
}

/** Script を作るときに渡す、演出の道具 */
export interface Runtime {
  readonly world: World;
  /** スローモーションに追従するパーティクル */
  readonly fx: Fx;
  readonly lines: SpeedLines;
  /** 速度線の濃さ（0=なし） */
  speedLines: number;
  /** カメラに衝撃を与える（0..1。時間でおさまる） */
  shake(amount: number): void;
  /** 画面を白く光らせる（0..1。すぐ消える） */
  flash(alpha: number, color?: string): void;
  /** 暗転：target=0..1（1=真っ暗）、seconds=かける実時間 */
  fadeTo(target: number, seconds: number): void;
  readonly fadeValue: number;
  /** 今のショット番号 */
  readonly shotIndex: number;
}

export type ScriptFactory = (rt: Runtime) => Script;

const SKIP_HOLD = 0.7;
const SKIP_GRACE = 0.9;

/** 滑らかな疑似ノイズ（-1..1） */
function wob(t: number, seed: number): number {
  return (Math.sin(t * 7.3 + seed * 12.9) + 0.6 * Math.sin(t * 13.1 + seed * 5.3) + 0.35 * Math.sin(t * 23.7 + seed * 2.1)) / 1.95;
}

export class Cutscene implements CutsceneHandle, Runtime {
  readonly fx: Fx;
  readonly lines: SpeedLines;
  speedLines = 0;
  private script: Script;
  private overlay: Overlay;
  private _done = false;
  private started = false;
  private idx = -1;
  private shotT = 0;
  private _elapsed = 0;
  private scale = 1;
  private slow = false;
  private impulse = 0;
  private flashA = 0;
  private fadeA = 1;
  private fadeTarget = 0;
  private fadeRate = 1 / 0.45;
  private holdT = 0;
  private keyHeld = false;
  private pose: CamPose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50, roll: 0 };
  private saved: { fov: number; near: number; far: number } | null = null;
  private onKey?: (e: KeyboardEvent) => void;
  private onKeyUp?: (e: KeyboardEvent) => void;
  private timer?: ReturnType<typeof setInterval>;
  private skipped = false;

  constructor(readonly world: World, factory: ScriptFactory, private onDone: () => void) {
    this.overlay = createOverlay();
    this.fx = new Fx(world.scene);
    this.lines = new SpeedLines(world.scene);
    this.script = factory(this);
    if (typeof window !== 'undefined') {
      this.onKey = (e) => {
        if (e.code === 'Escape') this.skip();
        else if (e.code === 'Space' || e.code === 'Enter') this.keyHeld = true;
      };
      this.onKeyUp = (e) => { if (e.code === 'Space' || e.code === 'Enter') this.keyHeld = false; };
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('keyup', this.onKeyUp);
    }
    if (typeof setInterval !== 'undefined') {
      // World が作り直された（タイトルへ・リトライ）ら黒帯などを残さず片付ける。ポーズ中は隠す
      this.timer = setInterval(() => this.watchdog(), 250);
      (this.timer as any)?.unref?.();
    }
  }

  // ---- 外から見える状態（テスト・デバッグ用）
  get done(): boolean { return this._done; }
  get shotIndex(): number { return this.idx; }
  get shotName(): string { return this.script.shots[this.idx]?.name ?? ''; }
  get shotNames(): string[] { return this.script.shots.map((s) => s.name); }
  get elapsed(): number { return this._elapsed; }
  /** 今のショットに入ってからの実時間 / そのショットの長さ */
  get shotTime(): number { return this.shotT; }
  get shotDuration(): number { return this.script.shots[this.idx]?.duration ?? 0; }
  get timeScale(): number { return this.scale; }
  get fadeValue(): number { return this.fadeA; }
  get wasSkipped(): boolean { return this.skipped; }
  get camPose(): CamPose { return this.pose; }

  // ---- Runtime
  shake(amount: number): void { this.impulse = Math.max(this.impulse, amount); }
  flash(alpha: number, color?: string): void { this.flashA = alpha; this.overlay.setFlash(alpha, color); }
  fadeTo(target: number, seconds: number): void {
    this.fadeTarget = target;
    this.fadeRate = seconds > 0 ? 1 / seconds : 1e6;
  }

  skip(): void {
    if (this._done) return;
    this.skipped = true;
    this.finish(true);
  }

  update(_world: World, dt: number): void {
    if (this._done) return;
    const realDt = Math.min(Math.max(dt, 0), 0.1);
    if (!this.started) this.start();
    this.readSkip(realDt);
    if (this._done) return;

    const shots = this.script.shots;
    // ショットの切り替え（enter でカメラ位置が決まるので、切り替えたその場でカメラも計算する）
    if (this.idx < 0) this.enterShot(0);
    let shot = shots[this.idx];
    const u0 = this.progress(shot);
    this.scale = shot.timeScale ? shot.timeScale(u0, this.shotT) : 1;
    this.updateSlow();
    const simDt = realDt * this.scale;
    this.script.sim(simDt, realDt);
    this.fx.update(simDt);

    this.shotT += realDt;
    this._elapsed += realDt;
    if (shot.end ? (shot.end() || this.shotT >= shot.duration) : this.shotT >= shot.duration) {
      shot.leave?.();
      if (this.idx + 1 >= shots.length) { this.finish(false); return; }
      this.enterShot(this.idx + 1);
      shot = shots[this.idx];
    }

    // 暗転・閃光（実時間）
    if (this.fadeA !== this.fadeTarget) {
      const step = this.fadeRate * realDt;
      this.fadeA = this.fadeA < this.fadeTarget ? Math.min(this.fadeTarget, this.fadeA + step) : Math.max(this.fadeTarget, this.fadeA - step);
    }
    this.flashA = Math.max(0, this.flashA - realDt * 3);
    this.overlay.setFade(this.fadeA);
    this.overlay.setFlash(this.flashA);
    this.overlay.setCaption(shot.caption ?? '');
    this.impulse *= Math.exp(-3.4 * realDt);

    // カメラ
    shot.camera(this.progress(shot), this.shotT, this.pose, realDt);
    this.applyCamera(shot);
  }

  private progress(shot: Shot): number {
    return Math.min(1, this.shotT / Math.max(0.001, shot.duration));
  }

  private enterShot(i: number): void {
    this.idx = i;
    this.shotT = 0;
    this.script.shots[i].enter?.();
  }

  private start(): void {
    this.started = true;
    const cam = this.world.camera;
    this.saved = { fov: cam.fov, near: cam.near, far: cam.far };
    cam.far = Math.max(cam.far, 3500);
    cam.updateProjectionMatrix();
    this.overlay.setLetterbox(true);
    this.overlay.setSkip(0);
    this.fadeA = 1;
    this.fadeTo(0, 0.45);
  }

  private updateSlow(): void {
    if (!this.slow && this.scale < 0.6) {
      this.slow = true;
      this.overlay.setSlow(true);
      this.world.events.emit('slowmo', { on: true });
    } else if (this.slow && this.scale > 0.85) {
      this.slow = false;
      this.overlay.setSlow(false);
      this.world.events.emit('slowmo', { on: false });
    }
  }

  private readSkip(dt: number): void {
    const inp = this.world.input as World['input'] | undefined;
    if (inp?.rawPressed?.('Escape')) { this.skip(); return; }
    // 運転中は入力がロックされているので、ロック中でも読める rawDown を使う
    const down = (c: string) => !!(inp?.rawDown ? inp.rawDown(c) : inp?.isDown?.(c));
    const held = this.keyHeld || down('Space') || down('PadA') || down('Enter');
    if (held && this._elapsed > SKIP_GRACE) this.holdT += dt;
    else this.holdT = Math.max(0, this.holdT - dt * 2);
    this.overlay.setSkip(this.holdT / SKIP_HOLD);
    if (this.holdT >= SKIP_HOLD) this.skip();
  }

  private applyCamera(shot: Shot): void {
    const cam = this.world.camera;
    const t = this._elapsed;
    const amp = shot.shake ?? 0.25;
    const imp = this.impulse;
    const p = this.pose;
    cam.position.set(
      p.pos.x + wob(t, 1) * (0.03 * amp + 0.35 * imp),
      p.pos.y + wob(t, 2) * (0.03 * amp + 0.35 * imp),
      p.pos.z + wob(t, 3) * (0.03 * amp + 0.35 * imp),
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(
      p.target.x + wob(t, 4) * (0.02 * amp + 0.25 * imp),
      p.target.y + wob(t, 5) * (0.02 * amp + 0.25 * imp),
      p.target.z + wob(t, 6) * (0.02 * amp + 0.25 * imp),
    );
    const roll = p.roll + wob(t, 7) * (0.004 * amp + 0.04 * imp);
    if (roll) cam.rotateZ(roll);
    if (Math.abs(cam.fov - p.fov) > 1e-3) {
      cam.fov = p.fov;
      cam.updateProjectionMatrix();
    }
  }

  private watchdog(): void {
    if (this._done) return;
    const cur = (globalThis as any).__game?.current as World | undefined;
    if (cur && cur !== this.world) { this.finish(true, true); return; }
    this.overlay.setHidden(this.world.state === 'paused');
  }

  /** 終わり。stale=World が作り直された（onDone は呼ばない） */
  private finish(skipped: boolean, stale = false): void {
    if (this._done) return;
    this._done = true;
    if (this.slow) { this.slow = false; this.world.events.emit('slowmo', { on: false }); }
    if (this.timer) clearInterval(this.timer);
    if (typeof window !== 'undefined') {
      if (this.onKey) window.removeEventListener('keydown', this.onKey);
      if (this.onKeyUp) window.removeEventListener('keyup', this.onKeyUp);
    }
    this.script.dispose();
    this.fx.dispose();
    this.lines.dispose();
    if (this.saved) {
      const cam = this.world.camera;
      cam.fov = this.saved.fov; cam.near = this.saved.near; cam.far = this.saved.far;
      cam.up.set(0, 1, 0);
      cam.updateProjectionMatrix();
    }
    // 真っ暗のまま終わるとき（通常の終わり・スキップ）は、黒から明ける
    this.overlay.dispose({ fadeFromBlack: !stale && (skipped || this.fadeA > 0.9) });
    if (!stale) this.onDone();
  }
}
