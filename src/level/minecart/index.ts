/**
 * トロッコ横スクロール面のコントローラ。
 * 遊びは sim.ts（x/y の横スクロール）、見た目は render3d.ts（three.js の3D）、HUD と照準は overlay.ts（透明な2D canvas）。
 * アクティブな間は本編（3D）を止めて、こちらだけが入力を読む。main.ts の step() から update(dt)、描画から render(renderer) を呼ぶ。
 *
 * 操作: Space/W/↑=ジャンプ　S/↓/Ctrl/C=しゃがむ（押している間）　マウス=照準（黄色い十字）　左クリック=撃つ　Esc=やめる
 */
import type * as THREE from 'three';
import type { Input } from '../../core/input';
import { MC } from './constants';
import { STAGE, type Stage } from './stage';
import { createState, SIM_DT, stepSim, type McInput, type McState } from './sim';
import { McView } from './render3d';
import { drawOverlay } from './overlay';

export interface MinecartHooks {
  /** ゴールした（集めたメタルと歯車の数つき） */
  onClear?: (metal: number, gears: number) => void;
  /** 終了した（クリア・やめる どちらでも） */
  onExit?: (cleared: boolean) => void;
}

export interface Minecart {
  readonly active: boolean;
  readonly state: McState | null;
  /** デバッグ・撮影用：3D 表示 */
  readonly view: McView | null;
  start(hooks?: MinecartHooks, stage?: Stage): void;
  stop(cleared?: boolean): void;
  update(dt: number): void;
  render(renderer: THREE.WebGLRenderer): void;
}

export function createMinecart(input: Input): Minecart {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let view: McView | null = null;
  let viewStage: Stage | null = null;
  let active = false;
  let st: McState | null = null;
  let stage: Stage = STAGE;
  let hooks: MinecartHooks = {};
  let acc = 0;
  let pointer: { x: number; y: number } = { x: 0, y: 0 };
  let mouseHeld = false;
  let fireQueued = false;
  let readyT = 0;
  let cpFlash = 0;
  let exitT = 0;
  let hintT = 0;
  let w = 0, h = 0;

  const ensureCanvas = (): void => {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'minecart-canvas';
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:60;cursor:none;display:none;touch-action:none;';
    canvas.addEventListener('mousemove', (e) => { pointer = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('mousedown', (e) => { pointer = { x: e.clientX, y: e.clientY }; if (e.button === 0) { mouseHeld = true; fireQueued = true; } e.preventDefault(); });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseHeld = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
  };

  /** 本編の HUD（操作説明・体力など）は、トロッコ中は隠す */
  const setHud = (show: boolean): void => { const el = document.getElementById('hud'); if (el) el.style.display = show ? '' : 'none'; };

  const resize = (): void => {
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nw = window.innerWidth, nh = window.innerHeight;
    if (nw !== w || nh !== h || canvas.width !== Math.round(nw * dpr)) {
      w = nw; h = nh;
      canvas.width = Math.round(nw * dpr); canvas.height = Math.round(nh * dpr);
    }
    ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
  };

  const restart = (fromCheckpoint: boolean): void => {
    const cp = st && fromCheckpoint ? st.cp : undefined;
    st = createState(stage, cp);
    view?.reset(st.x);
    acc = 0; readyT = 1.0; exitT = 0;
  };

  const self: Minecart = {
    get active() { return active; },
    get state() { return st; },
    get view() { return view; },
    start(hk = {}, stg = STAGE) {
      ensureCanvas();
      hooks = hk; stage = stg;
      if (!view || viewStage !== stage) { view = new McView(input, stage); viewStage = stage; }
      input.exitLock();
      input.resetAll();
      if (document.pointerLockElement) document.exitPointerLock();
      pointer = { x: window.innerWidth * 0.62, y: window.innerHeight * 0.4 };
      mouseHeld = false; fireQueued = false; cpFlash = 0; hintT = 7;
      st = null;
      restart(false);
      active = true;
      canvas!.style.display = 'block';
      setHud(false);
      resize();
    },
    stop(cleared = false) {
      if (!active) return;
      active = false;
      mouseHeld = false;
      if (canvas) canvas.style.display = 'none';
      setHud(true);
      input.resetAll();
      input.requestLock();
      hooks.onExit?.(cleared);
    },
    update(dt) {
      if (!active || !ctx || !st || !view) return;
      resize();
      hintT -= dt;
      if (input.rawPressed('Escape')) { self.stop(false); return; }
      // 固定ステップで進める
      acc += Math.min(dt, 0.1);
      const down = (...codes: string[]) => codes.some((c) => input.rawDown(c));
      let jump = input.rawPressed('Space') || input.rawPressed('KeyW') || input.rawPressed('ArrowUp') || input.rawPressed('PadA');
      let aim = view.pointerToWorld(pointer.x, pointer.y, w, h);
      const shotEvents = new Set<string>();
      const fx: McState['fx'] = [];
      while (acc >= SIM_DT) {
        acc -= SIM_DT;
        if (readyT > 0) { readyT -= SIM_DT; continue; }
        const inp: McInput = {
          jump,
          crouch: down('KeyS', 'ArrowDown', 'ControlLeft', 'ControlRight', 'KeyC'),
          fire: mouseHeld || fireQueued || input.rawDown('PadRT'),
          aimX: aim.x, aimY: aim.y,
        };
        jump = false; fireQueued = false;
        stepSim(st, stage, inp, SIM_DT);
        for (const e of st.events) shotEvents.add(e);
        fx.push(...st.fx);
        if (st.events.includes('check')) cpFlash = 1.6;
      }
      if (cpFlash > 0) cpFlash -= dt;
      // 失敗→やり直し / クリア→戻る
      if (st.dead) {
        exitT += dt;
        if (exitT >= MC.failHold) { restart(true); aim = view.pointerToWorld(pointer.x, pointer.y, w, h); }
      } else if (st.cleared && st.clearT >= MC.clearHold) {
        hooks.onClear?.(st.metal, st.gears);
        self.stop(true);
        return;
      }
      // 描画用に、この更新の間に起きたイベントとエフェクトを st へ集約して渡す
      const snap = st as McState;
      const keepEvents = snap.events, keepFx = snap.fx;
      snap.events = [...shotEvents] as McState['events'];
      snap.fx = fx;
      view.update(snap, aim, dt, w / h);
      snap.events = keepEvents; snap.fx = keepFx;
      const banner = readyT > 0 ? 'READY' : st.dead ? (st.dead === 'fall' ? '落下！' : st.dead === 'crash' ? 'ぶつかった！' : 'やられた…') : st.cleared ? 'CLEAR!' : null;
      drawOverlay(ctx, w, h, st, stage, { pointer, banner, hint: hintT > 0 && !st.cleared, cpFlash });
    },
    render(renderer) { if (active && view) view.render(renderer); },
  };
  return self;
}
