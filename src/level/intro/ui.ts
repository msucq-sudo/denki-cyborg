// 導入のUI：操作の説明（画像つき）、「戦う」ボタン、出発の はい／いいえ、チュートリアル2のチェックリスト。
// document が無い環境（vitest の node）では何もしない。カーソルが要る画面では、ポインターロックを外す。
import type { Input } from '../../core/input';

const FONT = '"Yu Gothic","Meiryo","Hiragino Sans","Noto Sans CJK JP",sans-serif';
const STYLE_ID = 'intro-ui-style';

function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
.intro-modal{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:rgba(6,10,24,.72);font-family:${FONT};color:#fff}
.intro-card{width:min(980px,94vw);max-height:92vh;overflow:auto;padding:22px 26px;border-radius:18px;background:linear-gradient(180deg,#16224a,#0d1530);border:2px solid #6ff0ff;box-shadow:0 0 30px rgba(80,230,255,.45)}
.intro-card h2{margin:0 0 4px;font-size:26px;letter-spacing:.06em}
.intro-card .sub{margin:0 0 14px;color:#9fb6e8;font-size:15px}
.intro-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.intro-tile{padding:12px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(111,240,255,.35)}
.intro-tile h3{margin:6px 0 4px;font-size:19px;color:#6ff0ff}
.intro-tile p{margin:2px 0;font-size:14.5px;line-height:1.55;color:#e8f0ff}
.intro-tile svg{width:100%;height:auto;border-radius:8px;background:#0a1127;display:block}
.intro-keys{margin-top:6px;font-size:13px;color:#ffd86a}
.intro-btns{display:flex;justify-content:center;gap:18px;margin-top:18px}
.intro-btn{font:800 22px ${FONT};padding:12px 46px;border-radius:999px;border:2px solid #6ff0ff;background:rgba(20,36,80,.9);color:#fff;cursor:pointer;box-shadow:0 0 16px rgba(80,230,255,.5)}
.intro-btn.sel,.intro-btn:hover{background:#2ad0ee;color:#052030}
.intro-ask{position:fixed;left:50%;bottom:16%;transform:translateX(-50%);z-index:40;display:flex;gap:22px;font-family:${FONT}}
.intro-check{position:fixed;left:22px;top:150px;z-index:15;padding:10px 16px;border-radius:12px;background:rgba(10,20,50,.78);border:2px solid #6ff0ff;color:#fff;font:700 16px ${FONT};line-height:1.8;pointer-events:none}
.intro-check .on{color:#7dff9c}
.intro-check .ttl{color:#6ff0ff;font-size:14px;letter-spacing:.08em}
`;
  document.head.appendChild(st);
}

// ---- 説明用の図（インラインSVG）。左＝ライアン（青）、右＝ウォーカー（灰）
const SVG_HEAD = '<svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg">';
const RYAN = (x: number) => `<g transform="translate(${x} 0)"><rect x="-13" y="62" width="26" height="46" rx="8" fill="#2f6fd6"/><circle cx="0" cy="50" r="13" fill="#f2c9a8"/><rect x="-11" y="42" width="22" height="8" rx="4" fill="#1a2a52"/><rect x="-10" y="106" width="8" height="26" fill="#1a2a52"/><rect x="2" y="106" width="8" height="26" fill="#1a2a52"/></g>`;
const WALKER = (x: number) => `<g transform="translate(${x} 0)"><rect x="-16" y="60" width="32" height="48" rx="6" fill="#aab3c4"/><rect x="-13" y="40" width="26" height="22" rx="6" fill="#d9deea"/><circle cx="-5" cy="50" r="3.5" fill="#ff5a4a"/><circle cx="5" cy="50" r="3.5" fill="#ff5a4a"/><rect x="-12" y="106" width="9" height="26" fill="#6b7488"/><rect x="3" y="106" width="9" height="26" fill="#6b7488"/></g>`;
const FLOOR = '<rect x="0" y="132" width="240" height="18" fill="#15204a"/>';

const ART = {
  attack: `${SVG_HEAD}${FLOOR}${RYAN(40)}<rect x="52" y="76" width="30" height="7" rx="3" fill="#9fb0d8"/>` +
    '<g fill="#ffe56a"><rect x="92" y="77" width="14" height="4" rx="2"/><rect x="116" y="77" width="14" height="4" rx="2"/><rect x="140" y="77" width="14" height="4" rx="2"/></g>' +
    `${WALKER(196)}<g stroke="#ffe56a" stroke-width="3"><line x1="170" y1="68" x2="160" y2="58"/><line x1="172" y1="84" x2="160" y2="92"/><line x1="168" y1="76" x2="156" y2="76"/></g></svg>`,
  absorb: `${SVG_HEAD}${FLOOR}${RYAN(40)}${WALKER(196)}` +
    '<path d="M180 80 C150 60 110 100 62 82" fill="none" stroke="#6ff0ff" stroke-width="4" stroke-linecap="round" stroke-dasharray="3 7"/>' +
    '<circle cx="62" cy="82" r="6" fill="#6ff0ff"/><rect x="20" y="14" width="64" height="16" rx="4" fill="none" stroke="#fff" stroke-width="2"/><rect x="23" y="17" width="46" height="10" fill="#7dff9c"/>' +
    '<text x="90" y="27" fill="#7dff9c" font-size="14" font-weight="800">+</text></svg>',
  send: `${SVG_HEAD}${FLOOR}${RYAN(40)}${WALKER(196)}` +
    '<path d="M62 82 C100 100 150 60 180 80" fill="none" stroke="#ffc400" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M118 62 L108 84 L120 84 L110 106" fill="none" stroke="#ffe56a" stroke-width="5" stroke-linejoin="round"/>' +
    '<circle cx="196" cy="84" r="22" fill="none" stroke="#ff7a3a" stroke-width="3" stroke-dasharray="4 5"/></svg>',
};

let modal: HTMLElement | null = null;
let ask: HTMLElement | null = null;
let check: HTMLElement | null = null;
let onFightCb: (() => void) | null = null;
let onPickCb: ((yes: boolean) => void) | null = null;
let pick = 0;

function releasePointer(): void {
  if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock();
}

/** 操作の説明（攻撃・吸収・送電を画像つきで）と「戦う」ボタン。ボタンを押すとチュートリアル1が始まる */
export function showExplain(onFight: () => void): void {
  if (typeof document === 'undefined') { onFight(); return; }
  ensureStyle();
  hideExplain();
  releasePointer();
  onFightCb = onFight;
  const m = document.createElement('div');
  m.className = 'intro-modal';
  m.innerHTML = `<div class="intro-card">
    <h2>電気の戦い方</h2><p class="sub">ライアンの武器は3つ。まずは1体、倒してみよう。</p>
    <div class="intro-grid">
      <div class="intro-tile">${ART.attack}<h3>① 攻撃</h3><p>ピストルで敵を撃つ。撃つたびに電力を少し使う。溜めて撃つと強い。</p><div class="intro-keys">左クリック／RT（長押しで溜め）</div></div>
      <div class="intro-tile">${ART.absorb}<h3>② 吸収</h3><p>左手のアームを敵につなぐと、敵の電力を奪って自分の電力にできる。</p><div class="intro-keys">E／LB（つないだまま待つ）</div></div>
      <div class="intro-tile">${ART.send}<h3>③ 送電</h3><p>吸収でつないだまま送電すると、電力を装置へ送り返せる。入れすぎた敵は爆発する。</p><div class="intro-keys">つないだまま F／X を長押し</div></div>
    </div>
    <div class="intro-btns"><button class="intro-btn sel" data-act="fight">戦う</button></div>
  </div>`;
  m.querySelector('[data-act="fight"]')!.addEventListener('click', () => fightNow());
  document.body.appendChild(m);
  modal = m;
}

function fightNow(): void {
  const cb = onFightCb;
  hideExplain();
  cb?.();
}

export function hideExplain(): void {
  modal?.remove();
  modal = null;
  onFightCb = null;
}

/** 出発の はい／いいえ。選んだら onPick(true=はい) */
export function showChoice(onPickFn: (yes: boolean) => void): void {
  if (typeof document === 'undefined') { onPickFn(true); return; }
  ensureStyle();
  hideChoice();
  releasePointer();
  onPickCb = onPickFn;
  pick = 0;
  const a = document.createElement('div');
  a.className = 'intro-ask';
  a.innerHTML = '<button class="intro-btn sel" data-yes="1">はい</button><button class="intro-btn" data-yes="0">いいえ</button>';
  a.querySelectorAll<HTMLButtonElement>('.intro-btn').forEach((b) => b.addEventListener('click', () => choose(b.dataset.yes === '1')));
  document.body.appendChild(a);
  ask = a;
}

function choose(yes: boolean): void {
  const cb = onPickCb;
  hideChoice();
  cb?.(yes);
}

export function hideChoice(): void {
  ask?.remove();
  ask = null;
  onPickCb = null;
}

/** キーボード・コントローラーでの操作（ポインターロック外でも rawPressed が通る） */
export function updateIntroUi(input: Input): void {
  if (modal && (input.rawPressed('PadA') || input.rawPressed('Enter') || input.rawPressed('Space'))) { fightNow(); return; }
  if (ask) {
    const btns = ask.querySelectorAll<HTMLButtonElement>('.intro-btn');
    if (input.rawPressed('ArrowLeft') || input.rawPressed('PadLeft') || input.rawPressed('KeyA')) pick = 0;
    if (input.rawPressed('ArrowRight') || input.rawPressed('PadRight') || input.rawPressed('KeyD')) pick = 1;
    btns.forEach((b, i) => b.classList.toggle('sel', i === pick));
    if (input.rawPressed('PadA') || input.rawPressed('Enter') || input.rawPressed('Space')) choose(pick === 0);
  }
}

export function introUiOpen(): boolean {
  return !!modal || !!ask;
}

/** チュートリアル2のチェックリスト（null で消す） */
export function setChecklist(items: { label: string; done: boolean }[] | null): void {
  if (typeof document === 'undefined') return;
  if (!items) { check?.remove(); check = null; return; }
  ensureStyle();
  if (!check) { check = document.createElement('div'); check.className = 'intro-check'; document.body.appendChild(check); }
  check.innerHTML = '<div class="ttl">れんしゅう</div>' + items.map((i) => `<div class="${i.done ? 'on' : ''}">${i.done ? '✔' : '□'} ${i.label}</div>`).join('');
}
