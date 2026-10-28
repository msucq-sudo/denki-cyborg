import type * as THREE from 'three';
import type { Enemy, Toast, World } from '../core/types';
import type { EventBus } from '../core/events';
import { ABSORB, DODGE, ENEMIES, GUN } from '../config/balance';
import type { EnemyKind } from '../config/balance';
import { ENEMY_INFO } from '../config/enemyInfo';
import { clamp, formatRate, formatTime, pct, projectToScreen, stepRate } from './format';
import type { RateState } from './format';

export interface HudCallbacks { onStart(): void; onRetry(): void; onResume(): void; onTitle(): void }
export interface HudWeapon { name: string; owned: boolean; icon?: string }
export interface Hud {
  update(world: World, dt: number): void;
  showScreen(world: World): void;
  /** 武器リストを差し替える（selected は選択中の index） */
  setWeapons(list: HudWeapon[], selected: number): void;
}

const KIND_NAME = Object.fromEntries(
  Object.entries(ENEMY_INFO).map(([k, v]) => [k, v.name]),
) as Record<EnemyKind, string>;

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

/** コミュ：1秒あたりの表示文字数 / 間隔 */
const COMM_CPS = 32;
const COMM_GAP = 0.35;
const MAP_FPS = 15;
const MAP_MAX = 190;
const MAP_MIN = 96;
const PORTRAIT_URL = `${(import.meta as any).env?.BASE_URL ?? '/'}assets/spark_portrait.png`;

// 特殊機能スロットのアイコン（インラインSVG）
const ICON_SCOUTER = '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="10" fill="none" stroke="#2ee6ff" stroke-width="2"/><circle cx="16" cy="16" r="3.2" fill="#2ee6ff"/></svg>';
const ICON_JET = '<svg viewBox="0 0 32 32"><rect x="9" y="4" width="14" height="16" rx="4" fill="none" stroke="#2ee6ff" stroke-width="2"/><path d="M12 22 L13.5 29 L15 22Z M17 22 L18.5 29 L20 22Z" fill="#ffd83a"/></svg>';
const ICON_AIM = '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="10" fill="none" stroke="#ffd83a" stroke-width="2" stroke-dasharray="4 3"/><circle cx="16" cy="16" r="1.8" fill="#ffd83a"/></svg>';
const ICON_GEAR = '<svg viewBox="0 0 32 32"><path d="M14 3h4l.8 3.6 2.6 1.1 3.1-2 2.8 2.8-2 3.1 1.1 2.6L30 14v4l-3.6.8-1.1 2.6 2 3.1-2.8 2.8-3.1-2-2.6 1.1L18 30h-4l-.8-3.6-2.6-1.1-3.1 2-2.8-2.8 2-3.1-1.1-2.6L2 18v-4l3.6-.8 1.1-2.6-2-3.1 2.8-2.8 3.1 2 2.6-1.1z" fill="#e0a800" stroke="#ffd83a" stroke-width="1"/><circle cx="16" cy="16" r="4.5" fill="#2ee6ff"/></svg>';
const ICON_METAL = '<svg viewBox="0 0 32 32"><path d="M16 4l10.4 6v12L16 28 5.6 22V10z" fill="#c9d3e0" stroke="#5ab8ff" stroke-width="1.6"/><circle cx="16" cy="16" r="4.2" fill="#12214d" stroke="#5ab8ff" stroke-width="1.4"/></svg>';
const ICON_GUN ='<svg viewBox="0 0 32 32"><path d="M4 12h18l4 3v4h-9l-2 7h-5l1.5-7H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M22 6l-3 5h4l-3 5" fill="none" stroke="#ffd83a" stroke-width="1.8" stroke-linejoin="round"/></svg>';

interface SlotDef { id: 'scouter' | 'jet' | 'aim'; key: string; label: string; icon: string }

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

/** keys=キーボード/マウス、pad=Xboxパッド */
interface KeyRow { id: string; keys: string; pad: string; label: string }

const KEY_ROWS: KeyRow[] = [
  { id: 'move', keys: 'WASD', pad: 'Lスティック', label: '移動' },
  { id: 'look', keys: 'マウス', pad: 'Rスティック', label: '視点' },
  { id: 'lmb', keys: '左クリック', pad: 'RT', label: '射撃（長押しで溜め）' },
  { id: 'rmb', keys: 'E', pad: 'LB', label: '吸収アーム（発射 / 解除）' },
  { id: 'aim', keys: '右クリック', pad: 'LT', label: '照準（長押しでズーム）' },
  { id: 'f', keys: 'F', pad: 'X', label: '吸収中 長押しで逆流' },
  { id: 'shift', keys: 'C', pad: 'RB', label: '回避' },
  { id: 'interact', keys: 'R', pad: 'B（装置の近く）', label: '調べる / 2階：ベッドで休む' },
  { id: 'dash', keys: 'Shift', pad: 'L押込', label: 'ダッシュ（移動中のみ低消費）' },
  { id: 'space', keys: 'Space', pad: 'A', label: 'ジャンプ' },
  { id: 'jet', keys: 'Space長押し（空中）', pad: 'A長押し', label: 'ジェット（ホバー）' },
  { id: 'k1', keys: '1', pad: '十字左', label: 'スカウター' },
  { id: 'k2', keys: '2', pad: '十字上', label: 'オートエイム' },
  { id: 'p', keys: 'P', pad: 'Start', label: '一時停止' },
  { id: 'h', keys: 'H', pad: '—', label: '操作表示の切替' },
];

/** 操作一覧。register に渡すと行要素を id 付きで登録する（状況に応じたハイライト用） */
function buildKeyList(register?: Record<string, HTMLElement>): HTMLElement {
  const ul = el('ul', 'keys');
  for (const row of KEY_ROWS) {
    const li = el('li', 'key-row');
    li.append(el('kbd', 'kbd', row.keys), el('kbd', 'kbd pad', row.pad), el('span', 'key-label', row.label));
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

/** ダメージ数字の表示時間（秒） */
const DMG_NUM_LIFE = 0.8;

export function createHUD(root: HTMLElement, cb: HudCallbacks): Hud {
  // この HUD インスタンス内の UI 状態（World 側には置かない）
  const subscribed = new WeakSet<EventBus>();
  let curWorld: World | null = null;
  let lastWorld: World | null = null;
  let screenState = '';
  let helpCollapsed = true;
  let hitT = 0;
  let hitWeak = false;
  let vigT = 0;
  let bossFlashT = 0;
  let bossPhase = 1;
  let ringDash = -1;
  const rate: RateState = { prev: 0, rate: 0 };
  const toastEls = new Map<Toast, HTMLElement>();
  const keyEls: Record<string, HTMLElement> = {};
  const dmgBox = el('div', 'dmg-layer');
  const dmgNums: { el: HTMLElement; pos: THREE.Vector3; age: number; dx: number }[] = [];

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

  const bossBox = el('div', 'boss off sc-only');
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

  const absBox = el('div', 'absorb off sc-only');
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

  // 左下：体力と電気（スカウター連動）
  const bleft = el('div', 'panel bleft sc-only');
  bleft.append(el('div', 'pn-title', '体力と電気'));
  const hpBox = el('div', 'hpbar');
  const hpHead = el('div', 'g-head');
  const hpNum = el('span', 'hp-num');
  hpHead.append(el('span', 'g-label hp-l', 'HP'), hpNum);
  const hpBar = el('div', 'bar hp');
  const hpFill = el('div', 'fill');
  hpBar.append(hpFill);
  hpBox.append(hpHead, hpBar);
  const gauge = el('div', 'gauge');
  const gHead = el('div', 'g-head');
  const gLabel = el('span', 'g-label', '電力');
  const gStatus = el('span', 'g-status');
  const gRate = el('span', 'g-rate');
  gHead.append(gLabel, gStatus, gRate);
  const batt = el('div', 'batt');
  const battFill = el('div', 'batt-fill');
  const battNum = el('span', 'batt-num');
  batt.append(battFill, battNum);
  gauge.append(gHead, batt);
  bleft.append(hpBox, gauge);

  // 揺れは一度だけ再生して外す
  const onShakeEnd = (e: Event) => (e.currentTarget as HTMLElement).classList.remove('shake');
  gauge.addEventListener('animationend', onShakeEnd);
  hpBox.addEventListener('animationend', onShakeEnd);

  // 左上：特殊機能（後から解放するものだけ。スカウター・ジェットパックは基本機能なので出さない）
  // 解放済みのものが1つも無い間はパネルごと隠す
  const funcs = el('div', 'panel funcs off');
  funcs.append(el('div', 'pn-title', '特殊機能'));
  const slotRow = el('div', 'slot-row');
  const slotDefs: SlotDef[] = [
    { id: 'aim', key: '2', label: 'エイム', icon: ICON_AIM },
  ];
  void ICON_SCOUTER; void ICON_JET;
  const slotEls = {} as Record<SlotDef['id'], { root: HTMLElement; state: HTMLElement }>;
  for (const s of slotDefs) {
    const root = el('div', `slot slot-${s.id}`);
    const ic = el('div', 'slot-icon');
    ic.innerHTML = s.icon;
    const state = el('span', 'slot-state', 'OFF');
    root.append(ic, el('div', 'slot-name', s.label), state, el('div', 'slot-key', s.key));
    slotEls[s.id] = { root, state };
    slotRow.append(root);
  }
  const commBadge = el('div', 'comm-badge off', '通信あり');
  funcs.append(slotRow);

  // 右下：武器選択
  const wpn = el('div', 'panel wpn');
  wpn.append(el('div', 'pn-title', '武器選択'));
  const wpnRow = el('div', 'wpn-row');
  wpn.append(wpnRow);
  function setWeapons(list: HudWeapon[], selected: number): void {
    wpnRow.replaceChildren();
    list.forEach((w, i) => {
      const r = el('div', `wslot${i === selected && w.owned ? ' sel' : ''}${w.owned ? '' : ' locked'}`);
      const ic = el('div', 'wslot-icon');
      if (w.owned) ic.innerHTML = w.icon ?? ICON_GUN;
      r.append(ic, el('div', 'wslot-name', w.name), el('div', 'wslot-sub', w.owned ? (i === selected ? '装備中' : '') : '未入手'));
      wpnRow.append(r);
    });
  }
  setWeapons([
    { name: '電気銃', owned: true },
    { name: 'ショットガン', owned: false },
    { name: 'アサルト', owned: false },
  ], 0);

  // 右上：ミニマップ（スカウター連動）
  const mapBox = el('div', 'panel mini sc-only');
  mapBox.append(el('div', 'pn-title', 'マップ'));
  const mapCv = document.createElement('canvas');
  mapCv.className = 'mini-cv';
  mapBox.append(mapCv);
  const mapCtx = mapCv.getContext('2d');
  const mapB = { x0: 0, z0: 0, sc: 1, ox: 0, oy: 0, w: 0, h: 0, rooms: -1, dpr: 1 };
  let mapAcc = 1;

  // 右上：マップの隣に強化素材（歯車・メタル）の所持数
  const invBox = el('div', 'panel inv');
  invBox.append(el('div', 'pn-title', '強化素材'));
  const invRow = (icon: string, label: string) => {
    const r = el('div', 'inv-row');
    const ic = el('span', 'inv-icon'); ic.innerHTML = icon;
    const n = el('span', 'inv-num', '0');
    r.append(ic, el('span', 'inv-label', label), n);
    invBox.append(r);
    return { row: r, num: n, last: -1 };
  };
  const invGear = invRow(ICON_GEAR, '歯車');
  const invMetal = invRow(ICON_METAL, 'メタル');
  invBox.append(commBadge); // スカウターOFF中に通信が来たときの印（会話は後で実装）
  const topRight = el('div', 'tr');
  topRight.append(invBox, mapBox);

  // 通信ウィンドウ（スカウター連動）
  const comm = el('div', 'panel comm sc-only off');
  const portrait = el('div', 'cm-portrait');
  portrait.append(el('span', 'cm-ph', 'S'));
  const portraitImg = document.createElement('img');
  portraitImg.className = 'cm-img';
  portraitImg.alt = '';
  portraitImg.addEventListener('load', () => portrait.classList.add('has-img'));
  portraitImg.addEventListener('error', () => portrait.classList.remove('has-img'));
  portraitImg.src = PORTRAIT_URL;
  portrait.append(portraitImg);
  const commBody = el('div', 'cm-body');
  const commName = el('div', 'cm-name');
  const commText = el('div', 'cm-text');
  commBody.append(commName, commText);
  comm.append(portrait, commBody);
  interface CommMsg { speaker: string; text: string; duration: number }
  const commQueue: CommMsg[] = [];
  let commCur: CommMsg | null = null;
  let commT = 0;
  let commGap = 0;

  playRoot.append(
    vignette, scouterFx, crosshair, lockon, hitmark, dmgBox, bossBox, objBox,
    controls, toastBox, absBox, energyHint, bleft, funcs, wpn, topRight, comm,
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
    '1 スカウター ON/OFF ・ Space長押し（空中）ジェットパック ・ C 回避 ・ Shift ダッシュ ・ H 操作表示',
    'Xboxパッド: Lスティック移動 ・ Rスティック視点 ・ RT射撃 ・ LT照準 ・ LB吸収 ・ A ジャンプ（空中で長押し＝ジェット） ・ RB 回避 ・ B インタラクト ・ Lスティック押込 ダッシュ ・ X 逆流 ・ 十字キー左 スカウター ・ Start ポーズ',
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
    bus.on('enemyHit', (p) => popNumber(p.pos, p.damage, p.weak ? 'weak' : p.damage >= 20 ? 'big' : ''));
    bus.on('enemyDrained', (p) => popNumber(p.pos, p.amount, 'drain'));
    bus.on('noEnergy', () => flash(gauge, 'shake'));
    bus.on('comm', (p) => {
      commQueue.push({ speaker: p.speaker, text: p.text, duration: p.duration ?? Math.max(3.5, 1.5 + p.text.length * 0.12) });
    });
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
    commQueue.length = 0;
    commCur = null;
    commT = 0;
    commGap = 0;
    setCls(comm, 'off', true);
    mapB.rooms = -1;
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

  /** ダメージ数字：ワールド座標に追従して上へ浮かび、消える */
  function popNumber(pos: THREE.Vector3, value: number, kind: string): void {
    if (dmgNums.length >= 40) return;
    const text = kind === 'drain' ? `-${Math.round(value)}` : String(Math.round(value));
    const e = el('div', `dmg-num ${kind}`.trim(), text);
    dmgBox.append(e);
    dmgNums.push({ el: e, pos: pos.clone(), age: 0, dx: (Math.random() - 0.5) * 36 });
  }

  function updateDmgNums(world: World, dt: number): void {
    for (let i = dmgNums.length - 1; i >= 0; i--) {
      const n = dmgNums[i];
      n.age += dt;
      if (n.age >= DMG_NUM_LIFE) { n.el.remove(); dmgNums.splice(i, 1); continue; }
      const s = projectToScreen(n.pos, world.camera, window.innerWidth, window.innerHeight);
      const k = n.age / DMG_NUM_LIFE;
      n.el.style.opacity = s.visible ? String(1 - k * k) : '0';
      n.el.style.transform = `translate(${(s.x + n.dx * k).toFixed(1)}px, ${(s.y - 70 * k).toFixed(1)}px) translate(-50%, -50%)`;
    }
  }

  function updateLockOn(world: World): void {
    const tgt = world.aimTarget;
    const tp = world.aimTargetPoint;
    if (!tgt || !tp || tgt.status === 'dead' || tgt.ai.dormant) {
      setCls(lockon, 'off', true);
      return;
    }
    const s = projectToScreen(tp, world.camera, window.innerWidth, window.innerHeight);
    setCls(lockon, 'off', !s.visible);
    if (s.visible) lockon.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
  }

  /** ミニマップの範囲をレベル全体に合わせる */
  function fitMap(world: World): void {
    const rooms = world.level.rooms;
    mapB.rooms = rooms.length;
    if (!rooms.length) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of rooms) {
      x0 = Math.min(x0, r.min.x); x1 = Math.max(x1, r.max.x);
      z0 = Math.min(z0, r.min.z); z1 = Math.max(z1, r.max.z);
    }
    const pad = 4;
    const sw = Math.max(1, x1 - x0 + pad * 2);
    const sh = Math.max(1, z1 - z0 + pad * 2);
    const k = MAP_MAX / Math.max(sw, sh);
    mapB.w = Math.round(clamp(sw * k, MAP_MIN, MAP_MAX));
    mapB.h = Math.round(clamp(sh * k, MAP_MIN, MAP_MAX));
    mapB.sc = Math.min(mapB.w / sw, mapB.h / sh);
    mapB.x0 = x0 - pad;
    mapB.z0 = z0 - pad;
    mapB.ox = (mapB.w - sw * mapB.sc) / 2;
    mapB.oy = (mapB.h - sh * mapB.sc) / 2;
    mapB.dpr = Math.min(window.devicePixelRatio || 1, 2);
    mapCv.width = Math.round(mapB.w * mapB.dpr);
    mapCv.height = Math.round(mapB.h * mapB.dpr);
    mapCv.style.width = `${mapB.w}px`;
    mapCv.style.height = `${mapB.h}px`;
  }

  function drawMap(world: World): void {
    const c = mapCtx;
    if (!c) return;
    if (mapB.rooms !== world.level.rooms.length) fitMap(world);
    if (!mapB.w) return;
    const tx = (x: number) => (x - mapB.x0) * mapB.sc + mapB.ox;
    const ty = (z: number) => (z - mapB.z0) * mapB.sc + mapB.oy;
    c.setTransform(mapB.dpr, 0, 0, mapB.dpr, 0, 0);
    c.clearRect(0, 0, mapB.w, mapB.h);
    c.lineWidth = 1;
    world.level.rooms.forEach((r, i) => {
      const x = tx(r.min.x), y = ty(r.min.z);
      const w = (r.max.x - r.min.x) * mapB.sc, h = (r.max.z - r.min.z) * mapB.sc;
      let fill = '';
      let stroke = 'rgba(143,166,207,0.4)';
      if (i === world.level.currentRoom) { fill = 'rgba(46,230,255,0.28)'; stroke = '#2ee6ff'; }
      else if (r.cleared) { fill = 'rgba(46,230,255,0.10)'; stroke = 'rgba(46,230,255,0.55)'; }
      else if (r.entered) { fill = 'rgba(255,216,58,0.10)'; stroke = 'rgba(255,216,58,0.6)'; }
      if (fill) { c.fillStyle = fill; c.fillRect(x, y, w, h); }
      c.strokeStyle = stroke;
      c.strokeRect(x + 0.5, y + 0.5, w, h);
    });
    // 敵の位置はマップに出さない（スカウターで敵の位置が分からないようにする）
    const p = world.player;
    c.save();
    c.translate(tx(p.pos.x), ty(p.pos.z));
    c.rotate(-p.yaw);
    c.fillStyle = '#2ee6ff';
    c.shadowColor = '#2ee6ff';
    c.shadowBlur = 6;
    c.beginPath();
    c.moveTo(0, -6);
    c.lineTo(4.5, 5);
    c.lineTo(0, 2.5);
    c.lineTo(-4.5, 5);
    c.closePath();
    c.fill();
    c.restore();
  }

  /** 通信：キューを進める。スカウターOFF／ポーズ中は止める */
  function updateComm(dt: number, scouterOn: boolean, playing: boolean): void {
    setCls(commBadge, 'off', scouterOn || (!commCur && commQueue.length === 0));
    if (!scouterOn || !playing) return;
    if (!commCur) {
      if (commGap > 0) commGap -= dt;
      if (commGap <= 0 && commQueue.length) {
        commCur = commQueue.shift() ?? null;
        commT = 0;
        if (commCur) {
          setText(commName, commCur.speaker);
          setText(commText, '');
          setCls(comm, 'off', false);
        }
      }
      return;
    }
    commT += dt;
    setText(commText, commCur.text.slice(0, Math.floor(commT * COMM_CPS)));
    if (commT >= commCur.duration) {
      commCur = null;
      commGap = COMM_GAP;
      setCls(comm, 'off', true);
    }
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

    updateDmgNums(world, dt);
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

    // スカウター：HUD の表示を連動させる
    setCls(playRoot, 'sc-off', !fn.scouter);
    setCls(scouterFx, 'on', fn.scouter);
    if (fn.scouter) {
      mapAcc += dt;
      if (mapAcc >= 1 / MAP_FPS) {
        mapAcc = 0;
        drawMap(world);
      }
    }
    updateComm(dt, fn.scouter, st === 'playing');

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
    // 部屋名は表示しない（目的だけ）
    const roomName = '';
    const objective = world.level.data.objective;
    const objStr = typeof objective === 'string' ? objective : '';
    setText(roomEl, roomName);
    setText(objEl, objStr ? `目的: ${objStr}` : '');
    setCls(roomEl, 'off', !roomName);
    setCls(objEl, 'off', !objStr);
    setCls(objBox, 'off', !roomName && !objStr);

    // 強化素材の所持数（増えたら弾む）
    for (const [r, v] of [[invGear, world.inventory.gears], [invMetal, world.inventory.metal]] as const) {
      if (r.last !== v) {
        if (r.last >= 0 && v > r.last) flash(r.row, 'pop');
        r.last = v;
        setText(r.num, String(v));
      }
    }

    // 操作表示
    setCls(controls, 'off', st === 'paused');
    setCls(controls, 'collapsed', helpCollapsed);
    setText(ctlToggle, helpCollapsed ? 'H: 表示' : 'H: 隠す');

    // 特殊機能スロット：解放済みのものだけ表示。1つも無ければパネルごと隠す
    const unlocked: Record<SlotDef['id'], boolean> = { scouter: false, jet: false, aim: world.unlocks.autoAim };
    setCls(funcs, 'off', !slotDefs.some((d) => unlocked[d.id]));
    const slotOn: Record<SlotDef['id'], boolean> = { scouter: fn.scouter, jet: p.flying, aim: fn.autoAim };
    for (const d of slotDefs) {
      const sl = slotEls[d.id];
      sl.root.style.display = unlocked[d.id] ? '' : 'none';
      setCls(sl.root, 'on', slotOn[d.id]);
      setCls(sl.root, 'nopower', empty && d.id !== 'scouter');
      setText(sl.state, slotOn[d.id] ? 'ON' : 'OFF');
    }

    // 状況に応じた操作キーのハイライト
    setCls(keyEls.f, 'hl', attached);
    setCls(keyEls.rmb, 'hl', empty && !absorbActive);
    setCls(keyEls.jet, 'hl', p.flying);
    setCls(keyEls.shift, 'dim', p.energy < DODGE.cost);
    setCls(keyEls.lmb, 'dim', p.energy < GUN.tapCost);
    setCls(keyEls.k1, 'dim', false); // スカウターは電力不要
    setCls(keyEls.k2, 'off', !world.unlocks.autoAim); // 未解放の機能は操作一覧にも出さない
    setCls(keyEls.k2, 'dim', empty);

    // トースト
    syncToasts(world);
  }

  return { update, showScreen, setWeapons };
}
