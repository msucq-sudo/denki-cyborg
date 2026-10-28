// 強化画面（レベルアップ画面）。2階のベッドで眠り終わると開く。
// 左に項目（GUN / BODY / ARM / SKILL）と行、右に自分の3Dモデル（upgradeStage.ts）。
// 歯車（world.inventory.gears）を使ってレベルを上げる。ルールは progression/upgrades.ts、
// カーソルや数値の整形は upgradeModel.ts にあり、ここは DOM と入力とアニメーションだけ。
// 状態はこの画面のインスタンスにだけ持つ（World には置かない）。World を作り直したら自動で閉じる。
import type * as THREE from 'three';
import type { World } from '../core/types';
import type { EventBus } from '../core/events';
import type { Input } from '../core/input';
import { getLevel, maxLevel, nextCost, preview, type Track } from '../progression/upgrades';
import {
  CATEGORIES, categoryTracks, createNav, currentCategory, focusedTrack, formatStat, moveCategory, moveRow,
  setCategory, setRow, statTone, tryUpgrade, type Nav,
} from './upgradeModel';
import { createUpgradeStage, type UpgradeStage } from './upgradeStage';

export interface UpgradeScreen {
  /** 画面を描いている間 true（開く演出〜閉じる演出）。この間は本編のシーンの代わりに render() を呼ぶ */
  readonly isOpen: boolean;
  /** 開く。onClose は閉じる演出が終わって画面が消える瞬間に呼ばれる（ベッドから起きる処理など） */
  open(world: World, opts?: { onClose?: () => void }): void;
  /** 閉じる演出を始める */
  close(): void;
  update(world: World, dt: number): void;
  render(renderer: THREE.WebGLRenderer): void;
  dispose(): void;
  /** テスト・デバッグ用 */
  debug(): { phase: string; cat: string; row: number; shownGears: number };
}

type Phase = 'closed' | 'opening' | 'open' | 'closing' | 'reveal';

const T_OPEN = 0.4;
const T_CLOSE = 0.28;
const T_REVEAL = 0.5;
const NOTE_TIME = 1.6;

const ICON_GEAR = '<svg viewBox="0 0 32 32"><path d="M14 3h4l.8 3.6 2.6 1.1 3.1-2 2.8 2.8-2 3.1 1.1 2.6L30 14v4l-3.6.8-1.1 2.6 2 3.1-2.8 2.8-3.1-2-2.6 1.1L18 30h-4l-.8-3.6-2.6-1.1-3.1 2-2.8-2.8 2-3.1-1.1-2.6L2 18v-4l3.6-.8 1.1-2.6-2-3.1 2.8-2.8 3.1 2 2.6-1.1z" fill="#e0a800" stroke="#ffd83a" stroke-width="1"/><circle cx="16" cy="16" r="4.5" fill="#0a1330"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 同じクラスを付け直して CSS アニメーションを頭から再生する */
function flash(e: Element, cls: string): void {
  e.classList.remove(cls);
  void (e as HTMLElement).offsetWidth;
  e.classList.add(cls);
}

/** 値が変わった時だけ書き換える。変わったら true */
function setText(e: HTMLElement, s: string): boolean {
  if (e.textContent === s) return false;
  e.textContent = s;
  return true;
}

interface StatView { root: HTMLElement; cur: HTMLElement; arrow: HTMLElement; next: HTMLElement }
interface RowView {
  track: Track;
  root: HTMLElement;
  lvCur: HTMLElement;
  lvArrow: HTMLElement;
  lvNext: HTMLElement;
  cost: HTMLElement;
  costNum: HTMLElement;
  cells: HTMLElement[];
  stats: StatView[];
}

export function createUpgradeScreen(input: Input, events: EventBus): UpgradeScreen {
  // ---------------- 状態
  let phase: Phase = 'closed';
  let phaseT = 0;
  let world: World | null = null;
  let onClose: (() => void) | undefined;
  let prevLocked = false;
  let hadLock = false;
  const nav: Nav = createNav();
  let stage: UpgradeStage | null = null;
  let stageWeapon = '';
  let stageMode = '';
  let rows: RowView[] = [];
  let shownGears = 0;
  let gearAcc = 0;
  let lastGears = 0;
  let noteT = 0;
  let noteKind: 'ok' | 'bad' = 'ok';
  let device: 'kbm' | 'pad' = 'kbm';
  let padPrev: [boolean, boolean] = [false, false];
  let dragId = -1;
  let dragX = 0;

  // ---------------- DOM
  const root = el('div', 'us');
  const shade = el('div', 'us-shade');
  const stageEl = el('div', 'us-stage');
  const top = el('div', 'us-top');
  const title = el('div', 'us-title');
  title.append(el('span', 'us-title-en', 'UPGRADE TERMINAL'), el('span', 'us-title-ja', '強化端末'));
  const gearBox = el('div', 'us-gears');
  const gearIcon = el('span', 'us-gear-icon');
  gearIcon.innerHTML = ICON_GEAR;
  const gearNum = el('span', 'us-gear-num', '0');
  const gearDelta = el('span', 'us-gear-delta');
  gearBox.append(gearIcon, el('span', 'us-gear-label', '歯車'), gearNum, gearDelta);
  top.append(title, gearBox);

  const left = el('div', 'us-left');
  const tabsWrap = el('div', 'us-tabs');
  const chipPrev = el('span', 'us-chip');
  const chipNext = el('span', 'us-chip');
  const tabEls = CATEGORIES.map((c, i) => {
    const t = el('div', 'us-tab');
    t.append(el('span', 'us-tab-en', c.en), el('span', 'us-tab-ja', c.ja));
    t.addEventListener('click', () => { if (phase === 'open' && setCategory(nav, i)) onCategoryChanged(true); });
    return t;
  });
  tabsWrap.append(chipPrev, ...tabEls, chipNext);

  const panel = el('div', 'us-panel');
  const head = el('div', 'us-phead');
  const headEn = el('h2', 'us-phead-en');
  const headJa = el('span', 'us-phead-ja');
  const headHint = el('p', 'us-phead-hint');
  head.append(headEn, headJa, headHint);
  const rowsBox = el('div', 'us-rows');
  const note = el('div', 'us-note');
  panel.append(head, rowsBox, note);
  left.append(tabsWrap, panel);

  const foot = el('div', 'us-foot');
  const curtain = el('div', 'us-curtain');
  root.append(shade, stageEl, top, left, foot, curtain);
  document.body.appendChild(root);
  const hudRoot = document.getElementById('hud');

  // ---------------- 入力デバイスに合わせた操作表示
  function glyph(kind: string, text: string): HTMLElement {
    return el('span', `us-key ${kind}`, text);
  }
  function buildHints(): void {
    const pad = device === 'pad';
    foot.replaceChildren();
    const hint = (keys: HTMLElement[], label: string, action?: () => void, primary = false): void => {
      const h = el('div', `us-hint${action ? ' act' : ''}${primary ? ' primary' : ''}`);
      h.append(...keys, el('span', 'us-hint-label', label));
      if (action) h.addEventListener('click', action);
      foot.append(h);
    };
    hint([el('span', 'us-drag-icon', '↔')], 'ドラッグで回転');
    hint(pad ? [glyph('dir', '↑'), glyph('dir', '↓')] : [glyph('kb', '↑'), glyph('kb', '↓')], '選ぶ');
    hint(pad ? [glyph('pbtn', 'LB'), glyph('pbtn', 'RB')] : [glyph('kb', 'Q'), glyph('kb', 'E')], '項目');
    hint([pad ? glyph('pbtn pb-a', 'A') : glyph('kb wide', 'Enter')], '強化', () => tryConfirm(), true);
    hint([pad ? glyph('pbtn pb-b', 'B') : glyph('kb wide', 'Esc')], '閉じる', () => close(), true);
    chipPrev.textContent = pad ? 'LB' : 'Q';
    chipNext.textContent = pad ? 'RB' : 'E';
  }

  // ---------------- 行
  function buildRows(w: World): void {
    rows = [];
    rowsBox.replaceChildren();
    const list = categoryTracks(w, currentCategory(nav).id);
    list.forEach((t, i) => {
      const r = el('div', 'us-row');
      const rh = el('div', 'us-row-head');
      const name = el('span', 'us-name', t.name);
      const lv = el('span', 'us-lv');
      const lvCur = el('span', 'us-lv-cur');
      const lvArrow = el('span', 'us-arrow', '»');
      const lvNext = el('span', 'us-lv-next');
      lv.append(lvCur, lvArrow, lvNext);
      const cost = el('div', 'us-cost');
      const ci = el('span', 'us-cost-icon');
      ci.innerHTML = ICON_GEAR;
      const costNum = el('span', 'us-cost-num');
      cost.append(ci, costNum);
      rh.append(name, lv, cost);
      const gauge = el('div', 'us-gauge');
      const cells: HTMLElement[] = [];
      for (let k = 0; k < maxLevel(t); k++) { const c = el('i', 'us-cell'); cells.push(c); gauge.append(c); }
      const statsBox = el('div', 'us-stats');
      const stats: StatView[] = t.stats.map((line) => {
        const s = el('div', 'us-stat');
        const cur = el('span', 'us-stat-cur');
        const arrow = el('span', 'us-arrow', '»');
        const next = el('span', 'us-stat-next');
        s.append(el('span', 'us-stat-label', line.label), cur, arrow, next);
        statsBox.append(s);
        return { root: s, cur, arrow, next };
      });
      r.append(rh, gauge, statsBox);
      r.addEventListener('pointermove', () => {
        if (phase !== 'open' || !world) return;
        if (setRow(nav, world, i)) onRowChanged();
      });
      let wasFocused = false;
      let touch = false;
      r.addEventListener('pointerdown', (ev) => {
        wasFocused = nav.rows[currentCategory(nav).id] === i;
        touch = ev.pointerType !== 'mouse';
      });
      r.addEventListener('click', () => {
        if (phase !== 'open' || !world) return;
        if (setRow(nav, world, i)) onRowChanged();
        // マウスは触れた時点で選択済み。タッチは1回目で選び、2回目で強化
        if (!touch || wasFocused) tryConfirm();
      });
      rowsBox.append(r);
      rows.push({ track: t, root: r, lvCur, lvArrow, lvNext, cost, costNum, cells, stats });
    });
  }

  /** 表示を今の状態に合わせる。anim=true なら変わった数値をポップさせる */
  function refresh(w: World, anim = false, leveled?: Track): void {
    const cat = currentCategory(nav);
    setText(headEn, cat.en);
    setText(headJa, cat.ja);
    setText(headHint, cat.hint);
    tabEls.forEach((t, i) => t.classList.toggle('sel', i === nav.cat));
    const focus = focusedTrack(nav, w);
    const multi = rows.length > 1;
    for (const r of rows) {
      const t = r.track;
      const lv = getLevel(w, t.id);
      const max = maxLevel(t);
      const cost = nextCost(w, t);
      const focused = focus === t;
      r.root.classList.toggle('focus', focused);
      r.root.classList.toggle('compact', multi && !focused);
      r.root.classList.toggle('max', cost === null);
      r.root.classList.toggle('poor', cost !== null && w.inventory.gears < cost);
      const lvChanged = setText(r.lvCur, `Lv.${lv}`);
      setText(r.lvArrow, cost === null ? '' : '»');
      setText(r.lvNext, cost === null ? 'MAX' : `Lv.${lv + 1}`);
      r.lvNext.classList.toggle('maxed', cost === null);
      if (anim && lvChanged) flash(r.lvCur, 'us-pop');
      setText(r.costNum, cost === null ? '最大' : String(cost));
      r.cost.classList.toggle('poor', cost !== null && w.inventory.gears < cost);
      r.cost.classList.toggle('maxed', cost === null);
      r.cells.forEach((c, k) => {
        const filled = k < lv;
        const wasFilled = c.classList.contains('on');
        c.classList.toggle('on', filled);
        c.classList.toggle('next', k === lv && k < max);
        if (anim && filled && !wasFilled) flash(c, 'us-fill');
      });
      const pv = preview(w, t);
      pv.forEach((p, k) => {
        const s = r.stats[k];
        const changedCur = setText(s.cur, formatStat(p.line, p.cur));
        if (p.next === null) {
          setText(s.arrow, '');
          setText(s.next, '最大');
          s.next.className = 'us-stat-next maxed';
        } else {
          setText(s.arrow, '»');
          setText(s.next, formatStat(p.line, p.next));
          s.next.className = `us-stat-next ${statTone(p.line, p.cur, p.next)}`;
        }
        if (anim && changedCur && leveled === t) { flash(s.cur, 'us-pop'); flash(s.root, 'us-stat-flash'); }
      });
      if (anim && leveled === t) flash(r.root, 'us-flash');
    }
    refreshNote();
  }

  function refreshNote(): void {
    const w = world;
    if (!w) return;
    const f = focusedTrack(nav, w);
    note.classList.toggle('msg', noteT > 0);
    note.classList.toggle('bad', noteT > 0 && noteKind === 'bad');
    if (noteT > 0) return;
    setText(note, f ? f.desc : '');
  }

  function say(text: string, kind: 'ok' | 'bad'): void {
    noteT = NOTE_TIME;
    noteKind = kind;
    note.textContent = text;
    refreshNote();
  }

  // ---------------- 右の3Dモデルを今の選択に合わせる
  function syncStage(): void {
    if (!stage || !world) return;
    const f = focusedTrack(nav, world);
    const gun = currentCategory(nav).id === 'gun' && f;
    const mode = gun ? 'aim' : 'neutral';
    const weapon = gun && f ? f.id.replace(/^gun\./, '') : stageWeapon || 'pistol';
    if (mode === stageMode && weapon === stageWeapon) return;
    stageMode = mode;
    stageWeapon = weapon;
    stage.setPose(mode, weapon);
  }

  function onCategoryChanged(sound: boolean): void {
    if (!world) return;
    buildRows(world);
    refresh(world);
    syncStage();
    if (sound) events.emit('uiConfirm', {});
    noteT = 0;
    refreshNote();
  }
  function onRowChanged(): void {
    if (!world) return;
    refresh(world);
    syncStage();
    events.emit('uiMove', {});
    const i = nav.rows[currentCategory(nav).id];
    rows[i]?.root.scrollIntoView({ block: 'nearest' });
  }

  // ---------------- 強化
  function tryConfirm(): void {
    if (phase !== 'open' || !world) return;
    const w = world;
    const t = focusedTrack(nav, w);
    if (!t) return;
    const r = rows[Math.min(nav.rows[currentCategory(nav).id], rows.length - 1)];
    const cost = nextCost(w, t);
    const res = tryUpgrade(w, t);
    if (res === 'ok') {
      refresh(w, true, t);
      stage?.pulse(t.category === 'gun' ? 'gun' : 'other');
      say(`${t.name} が Lv.${getLevel(w, t.id)} になった`, 'ok');
      flash(gearNum, 'us-pop');
      gearDelta.textContent = `-${cost}`;
      flash(gearDelta, 'us-delta');
    } else {
      events.emit('uiDenied', {});
      say(res === 'max' ? 'これ以上は強化できません' : `歯車が足りません（必要 ${cost}）`, 'bad');
      if (r) flash(r.root, 'us-shake');
      flash(gearBox, 'us-shake');
      if (res === 'poor') flash(gearNum, 'us-warn');
    }
  }

  // ---------------- 開く・閉じる
  function open(w: World, opts?: { onClose?: () => void }): void {
    if (phase !== 'closed' && phase !== 'reveal') return;
    world = w;
    onClose = opts?.onClose;
    prevLocked = input.locked;
    hadLock = !!document.pointerLockElement;
    input.locked = true;
    input.exitLock();
    stage ??= createUpgradeStage();
    nav.cat = 0;
    nav.rows = { gun: 0, body: 0, arm: 0, skill: 0 };
    stageMode = '';
    stageWeapon = '';
    device = input.lastDevice;
    buildHints();
    shownGears = lastGears = w.inventory.gears;
    gearAcc = 0;
    noteT = 0;
    buildRows(w);
    refresh(w);
    syncStage();
    setNum();
    root.classList.add('on');
    root.classList.remove('reveal');
    hudRoot?.classList.add('us-open');
    curtain.style.opacity = '1';
    phase = 'opening';
    phaseT = 0;
    events.emit('uiConfirm', {});
  }

  function close(): void {
    if (phase !== 'open' && phase !== 'opening') return;
    phase = 'closing';
    phaseT = 0;
    events.emit('uiClick', {});
  }

  /** 閉じる演出が終わった。本編のシーンへ戻す */
  function finishClose(callOnClose: boolean): void {
    phase = 'reveal';
    phaseT = 0;
    root.classList.add('reveal');
    hudRoot?.classList.remove('us-open');
    input.locked = prevLocked;
    input.resetAll();
    if (hadLock) input.requestLock();
    const cb = onClose;
    onClose = undefined;
    world = null;
    if (callOnClose) cb?.();
  }

  function setNum(): void {
    setText(gearNum, String(Math.round(shownGears)));
  }

  // ---------------- 毎フレーム
  function readPad(): [boolean, boolean] {
    try {
      const pad = navigator.getGamepads?.().find((g) => g && g.connected && g.mapping === 'standard');
      return pad ? [!!pad.buttons[4]?.pressed, !!pad.buttons[5]?.pressed] : [false, false];
    } catch { return [false, false]; }
  }

  function update(w: World, dt: number): void {
    if (phase === 'closed') return;
    // World を作り直した（リトライなど）→ 演出なしで閉じる
    if (world && w !== world) { finishClose(false); phase = 'closed'; root.classList.remove('on'); curtain.style.opacity = '0'; return; }
    phaseT += dt;
    if (phase === 'reveal') {
      curtain.style.opacity = String(Math.max(0, 1 - phaseT / T_REVEAL));
      if (phaseT >= T_REVEAL) { phase = 'closed'; root.classList.remove('on', 'reveal'); }
      return;
    }
    if (!world) return;
    stage?.update(dt);

    // 入力機器の表示を切り替える
    if (input.lastDevice !== device) { device = input.lastDevice; buildHints(); }

    if (phase === 'opening') {
      curtain.style.opacity = String(Math.max(0, 1 - phaseT / T_OPEN));
      if (phaseT >= T_OPEN) phase = 'open';
    } else if (phase === 'closing') {
      curtain.style.opacity = String(Math.min(1, phaseT / T_CLOSE));
      if (phaseT >= T_CLOSE) finishClose(true);
    }

    // 歯車の数のカウントダウン
    const gears = world?.inventory.gears ?? shownGears;
    if (gears !== lastGears) { lastGears = gears; if (world) refresh(world); } // 歯車が足りるかで赤・白が変わる
    if (Math.round(shownGears) !== gears) {
      gearAcc += dt;
      const step = 1 / 18;
      while (gearAcc >= step && Math.round(shownGears) !== gears) {
        gearAcc -= step;
        shownGears += Math.sign(gears - shownGears);
      }
      setNum();
    }
    if (noteT > 0) { noteT -= dt; if (noteT <= 0) { noteT = 0; refreshNote(); } }

    if (phase === 'open' || phase === 'opening') handleInput(world);
  }

  function handleInput(w: World): void {
    const any = (...codes: string[]): boolean => codes.some((c) => input.rawPressed(c));
    const kbm = input.lastDevice === 'kbm';
    const [lb, rb] = readPad();
    const lbEdge = lb && !padPrev[0], rbEdge = rb && !padPrev[1];
    padPrev = [lb, rb];
    if (phase !== 'open') return;

    if (any('Escape', 'KeyR', 'PadB', 'Backspace')) { close(); return; }
    if (any('Enter', 'NumpadEnter', 'Space', 'PadA')) tryConfirm();
    if (any('KeyW', 'ArrowUp', 'PadUp') && moveRow(nav, w, -1)) onRowChanged();
    if (any('KeyS', 'ArrowDown', 'PadDown') && moveRow(nav, w, 1)) onRowChanged();
    const prev = any('KeyA', 'ArrowLeft', 'PadLeft') || (kbm && any('KeyQ')) || lbEdge;
    const next = any('KeyD', 'ArrowRight', 'PadRight') || (kbm && any('KeyE')) || rbEdge;
    if (prev && moveCategory(nav, -1)) onCategoryChanged(true);
    else if (next && moveCategory(nav, 1)) onCategoryChanged(true);
  }

  // ---------------- ドラッグで回す
  stageEl.addEventListener('pointerdown', (e) => {
    dragId = e.pointerId; dragX = e.clientX;
    try { stageEl.setPointerCapture(e.pointerId); } catch { /* 無視 */ }
    stageEl.classList.add('drag');
  });
  stageEl.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragId) return;
    stage?.rotate((e.clientX - dragX) * 0.011);
    dragX = e.clientX;
  });
  const endDrag = (e: PointerEvent): void => { if (e.pointerId === dragId) { dragId = -1; stageEl.classList.remove('drag'); } };
  stageEl.addEventListener('pointerup', endDrag);
  stageEl.addEventListener('pointercancel', endDrag);

  // 画面が開いている間は、ブラウザ標準のキー動作（ボタン決定・スクロール・Esc）を止める
  window.addEventListener('keydown', (e) => {
    if (phase === 'closed' || phase === 'reveal') return;
    if (['Enter', 'Space', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Backspace'].includes(e.code)) e.preventDefault();
  }, true);

  function render(renderer: THREE.WebGLRenderer): void {
    if (!stage) return;
    const rect = left.getBoundingClientRect();
    stage.render(renderer, rect.right + 24);
  }

  function dispose(): void {
    stage?.dispose();
    stage = null;
    root.remove();
  }

  return {
    get isOpen() { return phase === 'opening' || phase === 'open' || phase === 'closing'; },
    open, close, update, render, dispose,
    debug: () => ({ phase, cat: currentCategory(nav).id, row: nav.rows[currentCategory(nav).id], shownGears }),
  };
}
