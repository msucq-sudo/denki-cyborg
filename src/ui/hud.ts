import type { Enemy, Toast, World } from '../core/types';
import type { EventBus } from '../core/events';
import { ABSORB, DODGE, ENEMIES, FUNCTIONS, GUN } from '../config/balance';
import type { EnemyKind } from '../config/balance';
import { clamp, formatRate, formatTime, pct, projectToScreen, stepRate } from './format';
import type { RateState } from './format';

export interface HudCallbacks { onStart(): void; onRetry(): void; onResume(): void; onTitle(): void }
export interface Hud { update(world: World, dt: number): void; showScreen(world: World): void }

const KIND_NAME: Record<EnemyKind, string> = {
  drone: 'ドローン',
  crawler: 'クローラー',
  gunner: 'ガンナー',
  heavy: 'ヘビー',
  boss: 'ジェネレーター',
};

const ABSORB_RATE = ABSORB.drainPerSec * ABSORB.conversion;
const ABSORBING_PHASES: string[] = ['extending', 'attached', 'retracting'];
const EMPTY_EPS = 0.0001;
const RATE_TAU = 0.4;
const HIT_TIME = 0.28;
const VIG_DECAY = 2.5;
const BOSS_FLASH_TIME = 0.8;
const LOW_ENERGY_PCT = 25;
const LOW_HP_PCT = 30;
const SVG_NS = 'http://www.w3.org/2000/svg';

type FnName = keyof World['functions'];

// ---------- DOM ヘルパ ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function svgEl(tag: string, cls = ''): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  if (cls) e.setAttribute('class', cls);
  return e as SVGElement;
}

/** 値が変わった時だけ DOM を触る */
function setText(e: HTMLElement, s: string): void {
  if (e.textContent !== s) e.textContent = s;
}

function setCls(e: Element, name: string, on: boolean): void {
  if (e.classList.contains(name) !== on) e.classList.toggle(name, on);
}

function setW(e: HTMLElement, p: number): void {
  const s = `${Math.round(p * 10) / 10}%`;
  if (e.style.width !== s) e.style.width = s;
}

function setOpacity(e: HTMLElement, v: number): void {
  const s = String(Math.round(clamp(v, 0, 1) * 100) / 100);
  if (e.style.opacity !== s) e.style.opacity = s;
}

/** 同じクラスを付け直してCSSアニメーションを頭から再生する */
function flash(e: HTMLElement, cls: string): void {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}

// ---------- 表示部品 ----------

interface KeyRow { id: string; keys: string; label: string }

const KEY_ROWS: KeyRow[] = [
  { id: 'move', keys: 'WASD', label: '移動' },
  { id: 'look', keys: 'マウス', label: '視点' },
  { id: 'lmb', keys: '左クリック', label: '射撃（長押しで溜め）' },
  { id: 'rmb', keys: 'E', label: '吸収アーム（発射 / 解除）' },
  { id: 'aim', keys: '右クリック', label: '照準（長押しでズーム）' },
  { id: 'f', keys: 'F', label: '吸収中 長押しで逆流' },
  { id: 'shift', keys: 'C', label: '回避' },
  { id: 'dash', keys: 'Shift', label: 'ダッシュ（移動中のみ低消費）' },
  { id: 'space', keys: 'Space', label: 'ジャンプ（飛行ONで長押し）' },
  { id: 'k1', keys: '1', label: 'スカウター' },
  { id: 'k2', keys: '2', label: 'オートエイム' },
  { id: 'k3', keys: '3', label: '飛行' },
  { id: 'p', keys: 'P', label: '一時停止' },
  { id: 'h', keys: 'H', label: '操作表示の切替' },
];

/** 操作一覧。register に渡すと行要素を id 付きで登録する（状況に応じたハイライト用） */
function buildKeyList(register?: Record<string, HTMLElement>): HTMLElement {
  const ul = el('ul', 'keys');
  for (const row of KEY_ROWS) {
    const li = el('li', 'key-row');
    li.append(el('kbd', 'kbd', row.keys), el('span', 'key-label', row.label));
    ul.append(li);
    if (register) register[row.id] = li;
  }
  return ul;
}

function buildStats(): { node: HTMLElement; set(w: World): void } {
  const node = el('dl', 'stats');
  const vals: Record<'time' | 'kills' | 'used' | 'absorbed' | 'explosions', HTMLElement> = {
    time: el('dd'), kills: el('dd'), used: el('dd'), absorbed: el('dd'), explosions: el('dd'),
  };
  const rows: [keyof typeof vals, string][] = [
    ['time', '経過時間'], ['kills', '撃破数'], ['used', '使用電力'], ['absorbed', '吸収電力'], ['explosions', '爆発'],
  ];
  for (const [k, label] of rows) node.append(el('dt', '', label), vals[k]);
  return {
    node,
    set(w: World) {
      const s = w.stats;
      setText(vals.time, formatTime(s.endTime - s.startTime));
      setText(vals.kills, `${s.kills}`);
      setText(vals.used, `${Math.round(s.energyUsed)}`);
      setText(vals.absorbed, `${Math.round(s.energyAbsorbed)}`);
      setText(vals.explosions, `${s.explosions}`);
    },
  };
}

// ---------- 本体 ----------

export function createHUD(root: HTMLElement, cb: HudCallbacks): Hud {
  // この HUD インスタンス内の UI 状態（World 側には置かない）
  const subscribed = new WeakSet<EventBus>();
  let curWorld: World | null = null;
  let lastWorld: World | null = null;
  let screenState = '';
  let helpCollapsed = false;
  let hitT = 0;
  let hitWeak = false;
  let vigT = 0;
  let bossFlashT = 0;
  let bossPhase = 1;
  let ringDash = -1;
  const rate: RateState = { prev: 0, rate: 0 };
  const toastEls = new Map<Toast, HTMLElement>();
  const keyEls: Record<string, HTMLElement> = {};

  // ----- プレイ中 HUD -----
  const playRoot = el('div', 'play');
  const vignette = el('div', 'vignette');

  const scouterFx = el('div', 'scouter-fx');
  scouterFx.append(
    el('div', 'scanline'),
    el('i', 'corner tl'), el('i', 'corner tr'), el('i', 'corner bl'), el('i', 'corner br'),
  );

  const crosshair = el('div', 'crosshair');
  const ring = svgEl('svg', 'ch-ring') as SVGSVGElement;
  ring.setAttribute('viewBox', '0 0 36 36');
  const ringBg = svgEl('circle', 'ring-bg');
  const ringFg = svgEl('circle', 'ring-fg');
  for (const c of [ringBg, ringFg]) {
    c.setAttribute('cx', '18');
    c.setAttribute('cy', '18');
    c.setAttribute('r', '15.5');
    c.setAttribute('pathLength', '100');
  }
  ringFg.setAttribute('stroke-dasharray', '100');
  ringFg.setAttribute('stroke-dashoffset', '100');
  ring.append(ringBg, ringFg);
  crosshair.append(ring, el('span', 'ch-dot'), el('span', 'ch-absorb'));

  const hitmark = el('div', 'hitmark');
  hitmark.append(el('span', 'x', '×'), el('span', 'weak-lbl', 'WEAK'));

  const lockon = el('div', 'lockon off');
  lockon.append(el('div', 'lockon-d'));

  const bossBox = el('div', 'boss off');
  const bossName = el('div', 'boss-name', KIND_NAME.boss);
  const bossBar = el('div', 'bar');
  const bossFill = el('div', 'fill');
  bossBar.append(bossFill);
  const bossNum = el('div', 'boss-num');
  bossBox.append(bossName, bossBar, bossNum);

  const objBox = el('div', 'objective off');
  const roomEl = el('div', 'room');
  const objEl = el('div', 'obj');
  objBox.append(roomEl, objEl);

  const controls = el('div', 'controls');
  const ctlHead = el('div', 'ctl-head');
  const ctlTitle = el('span', 'ctl-title', '操作');
  const ctlToggle = el('span', 'ctl-toggle', 'H: 隠す');
  ctlHead.append(ctlTitle, ctlToggle);
  controls.append(ctlHead, buildKeyList(keyEls));

  const toastBox = el('div', 'toasts');

  const absBox = el('div', 'absorb off');
  const absHead = el('div', 'ab-head');
  const absName = el('span', 'ab-name');
  const absStatus = el('span', 'ab-status');
  absHead.append(absName, absStatus);
  const absBar = el('div', 'bar');
  const absHpFill = el('div', 'fill');
  absBar.append(absHpFill);
  const absOvRow = el('div', 'ab-ov off');
  const absOvBar = el('div', 'bar ov');
  const absOvFill = el('div', 'fill');
  absOvBar.append(absOvFill);
  absOvRow.append(el('div', 'ab-ov-label', '過負荷'), absOvBar);
  const absHint = el('div', 'ab-hint');
  absBox.append(absHead, absBar, absOvRow, absHint);

  const energyHint = el('div', 'energy-hint off', 'Eで敵から吸収！');

  const bleft = el('div', 'bleft');
  const gauge = el('div', 'panel-s gauge');
  const gHead = el('div', 'g-head');
  const gLabel = el('span', 'g-label', '電力');
  const gStatus = el('span', 'g-status');
  const gRate = el('span', 'g-rate');
  gHead.append(gLabel, gStatus, gRate);
  const battRow = el('div', 'batt-row');
  const batt = el('div', 'batt');
  const battFill = el('div', 'batt-fill');
  const battNum = el('span', 'batt-num');
  batt.append(battFill, battNum);
  battRow.append(batt, el('div', 'batt-nub'));
  gauge.append(gHead, battRow);

  const hpBox = el('div', 'panel-s hpbar');
  const hpHead = el('div', 'g-head');
  const hpNum = el('span', 'hp-num');
  hpHead.append(el('span', 'g-label', 'HP'), hpNum);
  const hpBar = el('div', 'bar hp');
  const hpFill = el('div', 'fill');
  hpBar.append(hpFill);
  hpBox.append(hpHead, hpBar);
  bleft.append(gauge, hpBox);

  // 揺れは一度だけ再生して外す
  const onShakeEnd = (e: Event) => (e.currentTarget as HTMLElement).classList.remove('shake');
  gauge.addEventListener('animationend', onShakeEnd);
  hpBox.addEventListener('animationend', onShakeEnd);

  const bright = el('div', 'bright');
  const slotDefs: { name: FnName; key: string; label: string; cost: string }[] = [
    { name: 'scouter', key: '1', label: 'スカウター', cost: `${FUNCTIONS.scouter.drainPerSec}/秒` },
    { name: 'autoAim', key: '2', label: 'オートエイム', cost: `射撃時 ${FUNCTIONS.autoAim.costPerShot}/発` },
    { name: 'flight', key: '3', label: '飛行', cost: `飛行時のみ ${FUNCTIONS.flight.flyingDrainPerSec}/秒` },
  ];
  const slotEls = {} as Record<FnName, { root: HTMLElement; state: HTMLElement; cost: HTMLElement }>;
  for (const s of slotDefs) {
    const root = el('div', 'slot');
    const state = el('span', 'slot-state', 'OFF');
    const cost = el('span', 'slot-cost', s.cost);
    const top = el('div', 'slot-top');
    top.append(el('kbd', 'kbd', s.key), state);
    root.append(top, el('div', 'slot-name', s.label), cost);
    slotEls[s.name] = { root, state, cost };
    bright.append(root);
  }

  playRoot.append(
    vignette, scouterFx, crosshair, lockon, hitmark, bossBox, objBox,
    controls, toastBox, absBox, energyHint, bleft, bright,
  );

  // ----- タイトル -----
  const scrTitle = el('section', 'screen screen-title');
  const tPanel = el('div', 'panel-big');
  const tTitle = el('h1', 'game-title', '電気サイボーグ');
  const tSub = el('p', 'game-sub', '電力を吸い、使い、生き延びろ');
  const tTips = el('ul', 'tips');
  for (const t of [
    '移動 WASD ・ 視点 マウス',
    '左クリック 射撃（長押しで溜め撃ち）',
    'E 吸収アーム（敵から電力を吸う） ・ 右クリック 照準',
    '1〜3 機能 ・ C 回避 ・ Shift ダッシュ ・ H 操作表示',
    'Xboxパッド: Lスティック移動 ・ Rスティック視点 ・ RT射撃 ・ LT照準 ・ LB吸収 ・ A ジャンプ ・ B/RB 回避 ・ Lスティック押込 ダッシュ ・ X 逆流 ・ Y 飛行 ・ 十字キー左/上 機能 ・ Start ポーズ',
  ]) tTips.append(el('li', '', t));
  const tRow = el('div', 'btn-row');
  tPanel.append(tTitle, tSub, tTips, tRow);
  scrTitle.append(tPanel);

  // ----- ポーズ -----
  const scrPause = el('section', 'screen screen-pause');
  const pPanel = el('div', 'panel-big');
  pPanel.append(el('h2', 'screen-h', '一時停止'), buildKeyList());
  const pRow = el('div', 'btn-row');
  pPanel.append(pRow, el('p', 'click-hint', 'クリックで視点操作に戻ります'));
  scrPause.append(pPanel);

  // ----- ゲームオーバー / クリア -----
  const scrOver = el('section', 'screen screen-over');
  const oPanel = el('div', 'panel-big');
  const overStats = buildStats();
  oPanel.append(el('h2', 'screen-h', '機能停止…'), overStats.node);
  const oRow = el('div', 'btn-row');
  oPanel.append(oRow);
  scrOver.append(oPanel);

  const scrClear = el('section', 'screen screen-clear');
  const cPanel = el('div', 'panel-big');
  const clearStats = buildStats();
  cPanel.append(el('h2', 'screen-h', '動力炉 停止 — ミッション完了'), clearStats.node);
  const cRow = el('div', 'btn-row');
  cPanel.append(cRow);
  scrClear.append(cPanel);

  // ----- ボタン -----
  function click(fn: () => void): void {
    lastWorld?.events.emit('uiClick', {});
    fn();
  }

  function btn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', `btn ${cls}`, label);
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      click(onClick);
    });
    return b;
  }

  tRow.append(btn('スタート', 'btn-primary', () => cb.onStart()));
  pRow.append(
    btn('再開', 'btn-primary', () => cb.onResume()),
    btn('タイトルへ', '', () => cb.onTitle()),
  );
  oRow.append(
    btn('リトライ', 'btn-primary', () => cb.onRetry()),
    btn('タイトルへ', '', () => cb.onTitle()),
  );
  cRow.append(
    btn('もう一度', 'btn-primary', () => cb.onRetry()),
    btn('タイトルへ', '', () => cb.onTitle()),
  );

  // ポーズ画面はどこをクリックしても再開（「クリックで視点操作に戻ります」）
  scrPause.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    click(() => cb.onResume());
  });

  root.replaceChildren(playRoot, scrTitle, scrPause, scrOver, scrClear);

  // ---------- イベント購読（EventBus は全 World 共通なので 1 回だけ） ----------
  function subscribe(bus: EventBus): void {
    if (subscribed.has(bus)) return;
    subscribed.add(bus);
    bus.on('playerHit', () => {
      vigT = 1;
      flash(hpBox, 'shake');
    });
    bus.on('enemyHit', (p) => {
      hitT = HIT_TIME;
      hitWeak = p.weak;
      flash(hitmark, 'pop');
    });
    bus.on('noEnergy', () => flash(gauge, 'shake'));
    bus.on('bossPhase', (p) => {
      bossPhase = p.phase;
      bossFlashT = BOSS_FLASH_TIME;
    });
  }

  /** 見た World が変わったら UI 側の一時状態を捨てる */
  function attach(world: World): void {
    subscribe(world.events);
    lastWorld = world;
    if (world === curWorld) return;
    curWorld = world;
    rate.prev = world.player.energy;
    rate.rate = 0;
    hitT = 0;
    hitWeak = false;
    vigT = 0;
    bossFlashT = 0;
    bossPhase = 1;
    for (const e of toastEls.values()) e.remove();
    toastEls.clear();
    screenState = '';
  }

  function applyScreens(world: World): void {
    const st = world.state;
    if (st === screenState) return;
    screenState = st;
    setCls(scrTitle, 'show', st === 'title');
    setCls(playRoot, 'show', st === 'playing' || st === 'paused');
    setCls(scrPause, 'show', st === 'paused');
    setCls(scrOver, 'show', st === 'gameover');
    setCls(scrClear, 'show', st === 'clear');
    if (st === 'gameover') overStats.set(world);
    if (st === 'clear') clearStats.set(world);
  }

  function syncToasts(world: World): void {
    const live = new Set<Toast>(world.toasts);
    for (const [t, e] of toastEls) {
      if (live.has(t)) continue;
      toastEls.delete(t);
      e.classList.add('out');
      setTimeout(() => e.remove(), 350);
    }
    for (const t of world.toasts) {
      if (toastEls.has(t)) continue;
      const e = el('div', 'toast', t.text);
      toastBox.append(e);
      toastEls.set(t, e);
    }
  }

  function updateLockOn(world: World): void {
    const tgt = world.aimTarget;
    const tp = world.aimTargetPoint;
    if (!tgt || !tp || tgt.status === 'dead') {
      setCls(lockon, 'off', true);
      return;
    }
    const s = projectToScreen(tp, world.camera, window.innerWidth, window.innerHeight);
    setCls(lockon, 'off', !s.visible);
    if (s.visible) lockon.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
  }

  // ---------- 公開 API ----------

  function showScreen(world: World): void {
    attach(world);
    applyScreens(world);
  }

  function update(world: World, dt: number): void {
    attach(world);
    applyScreens(world);
    const st = world.state;
    if (st !== 'playing' && st !== 'paused') return;

    const p = world.player;
    const fn = world.functions;
    const ab = world.absorb;
    const absorbActive = p.absorbing || ABSORBING_PHASES.includes(ab.phase);

    if (world.input.pressed('KeyH')) helpCollapsed = !helpCollapsed;

    // タイマー
    hitT = Math.max(0, hitT - dt);
    vigT = Math.max(0, vigT - dt * VIG_DECAY);
    bossFlashT = Math.max(0, bossFlashT - dt);

    // 電力ゲージ
    const eRate = stepRate(rate, p.energy, dt, RATE_TAU);
    const ePct = pct(p.energy, p.maxEnergy);
    const empty = p.energy <= EMPTY_EPS;
    const low = !empty && ePct <= LOW_ENERGY_PCT;
    setCls(batt, 'low', low);
    setCls(batt, 'empty', empty);
    setCls(gauge, 'empty', empty);
    setW(battFill, ePct);
    setText(battNum, `${Math.round(p.energy)} / ${p.maxEnergy}`);
    setText(gStatus, empty ? '電力切れ' : low ? '残りわずか' : '');
    const rt = formatRate(eRate);
    setText(gRate, rt.text);
    setCls(gRate, 'drain', rt.kind === 'drain');
    setCls(gRate, 'gain', rt.kind === 'gain');

    // HP
    const hpPct = pct(p.hp, p.maxHp);
    setW(hpFill, hpPct);
    setText(hpNum, `${Math.ceil(p.hp)} / ${p.maxHp}`);
    setCls(hpBox, 'low', hpPct <= LOW_HP_PCT);
    setOpacity(vignette, Math.max(vigT * 0.9, hpPct <= LOW_HP_PCT ? 0.2 : 0));

    // クロスヘア・ヒットマーカー
    setCls(crosshair, 'charging', p.charging);
    if (p.charging) {
      const d = 100 * (1 - clamp(p.charge, 0, 1));
      if (d !== ringDash) {
        ringDash = d;
        ringFg.setAttribute('stroke-dashoffset', d.toFixed(2));
      }
    }
    setCls(crosshair, 'full', p.charging && p.charge >= 0.999);
    setCls(crosshair, 'is-absorb', p.absorbing);
    setCls(hitmark, 'on', hitT > 0);
    setCls(hitmark, 'weak', hitWeak);
    updateLockOn(world);

    // スカウター演出
    setCls(scouterFx, 'on', fn.scouter);

    // 吸収・逆流
    const target: Enemy | null = ab.target;
    const attached = ab.phase === 'attached' && !!target && target.status !== 'dead';
    setCls(absBox, 'off', !attached);
    if (attached && target) {
      const over = p.overloading;
      setCls(absBox, 'overloading', over);
      setText(absName, KIND_NAME[target.kind]);
      setText(absStatus, over ? '逆流中' : `吸収中 ＋${ABSORB_RATE.toFixed(1)}/秒`);
      setW(absHpFill, pct(target.hp, target.maxHp));
      setCls(absOvRow, 'off', !over);
      if (over) {
        const cap = ENEMIES[target.kind].overloadCap;
        setW(absOvFill, cap > 0 ? pct(target.overload, cap) : 0);
      }
      setText(absHint, over ? '' : 'F長押しで逆流');
    }

    // 電力切れで吸収もしていない時の案内
    setCls(energyHint, 'off', !(empty && !absorbActive));

    // ボス HP
    const boss = world.enemies.find((e) => e.kind === 'boss' && e.status !== 'dead');
    setCls(bossBox, 'off', !boss);
    if (boss) {
      setW(bossFill, pct(boss.hp, boss.maxHp));
      setText(bossNum, `${Math.ceil(boss.hp)} / ${boss.maxHp}`);
      setCls(bossBox, 'red', bossPhase >= 2 || bossFlashT > 0);
      setCls(bossBox, 'flash', bossFlashT > 0);
    }

    // 目的・区画
    const ri = world.level.currentRoom;
    const roomName = ri >= 0 ? (world.level.rooms[ri]?.name ?? '') : '';
    const objective = world.level.data.objective;
    const objStr = typeof objective === 'string' ? objective : '';
    setText(roomEl, roomName);
    setText(objEl, objStr ? `目的: ${objStr}` : '');
    setCls(roomEl, 'off', !roomName);
    setCls(objEl, 'off', !objStr);
    setCls(objBox, 'off', !roomName && !objStr);

    // 操作表示
    setCls(controls, 'off', st === 'paused');
    setCls(controls, 'collapsed', helpCollapsed);
    setText(ctlToggle, helpCollapsed ? 'H: 表示' : 'H: 隠す');

    // 機能スロット
    for (const s of slotDefs) {
      const on = fn[s.name];
      const sl = slotEls[s.name];
      setCls(sl.root, 'on', on);
      setCls(sl.root, 'nopower', empty);
      setText(sl.state, on ? 'ON' : 'OFF');
    }
    setText(
      slotEls.flight.cost,
      p.flying ? `飛行中 ${FUNCTIONS.flight.flyingDrainPerSec}/秒` : `飛行時のみ ${FUNCTIONS.flight.flyingDrainPerSec}/秒`,
    );

    // 状況に応じた操作キーのハイライト
    setCls(keyEls.f, 'hl', attached);
    setCls(keyEls.rmb, 'hl', empty && !absorbActive);
    setCls(keyEls.space, 'hl', fn.flight);
    setCls(keyEls.shift, 'dim', p.energy < DODGE.cost);
    setCls(keyEls.lmb, 'dim', p.energy < GUN.tapCost);
    setCls(keyEls.k1, 'dim', empty);
    setCls(keyEls.k2, 'dim', empty);
    setCls(keyEls.k3, 'dim', empty);

    // トースト
    syncToasts(world);
  }

  return { update, showScreen };
}
