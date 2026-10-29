// サージ収容所への道の運転 HUD：速度計（300km/h の目標つき）・タイミングバー・判定地点までの距離・「← 左折」・操作ヒント。
// 通常のプレイ HUD（hud.ts）には触らない。body 直下に自分の DOM を置き、#hud に 'driving' クラスだけ付けて
// 運転に関係ない部品（照準・電力ゲージ等）を driveHud.css で隠す。
import './driveHud.css';

export type JudgeQuality = 'perfect' | 'good' | 'miss';

export interface DriveHudView {
  kmh: number;
  maxKmh: number;
  targetKmh: number;
  /** タイミングバーのカーソル位置 0..1 */
  cursor: number;
  perfectHalf: number;
  goodHalf: number;
  /** 受け付け待ちの残り（秒）。>0 の間はバーを暗くする */
  cooldown: number;
  distLeft: number;
  totalDist: number;
  /** 「← 左折」を出す */
  turnHint: boolean;
  /** 曲がり損ねて立て直し中 */
  recovering: boolean;
  device: 'kbm' | 'pad';
  hits: number;
}

export interface DriveHud {
  update(v: DriveHudView): void;
  judge(q: JudgeQuality): void;
  show(): void;
  /** 自分の表示を隠す。通常 HUD は隠したまま（衝突・演出の間に照準や電力ゲージが出てこないように） */
  hide(): void;
  /** 通常 HUD も元に戻す（新しいワールドを作るとき） */
  reset(): void;
  dispose(): void;
  readonly visible: boolean;
}

const NOOP: DriveHud = { update() {}, judge() {}, show() {}, hide() {}, reset() {}, dispose() {}, visible: false };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const JUDGE_TEXT: Record<JudgeQuality, string> = { perfect: 'PERFECT!', good: 'GOOD', miss: 'MISS' };

const HINT = {
  kbm: '<kbd>Space</kbd> 加速　<kbd>A</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd> 左右',
  pad: '<kbd>A</kbd> 加速　<kbd>左スティック</kbd> 左右',
};
const TURN_HINT = { kbm: '<kbd>A</kbd> / <kbd>←</kbd> を押して曲がる', pad: '<kbd>左スティック</kbd> を左へ' };

let singleton: DriveHud | null = null;

/** HUD は1つだけ作って使い回す（ワールドを作り直しても DOM を増やさない） */
export function getDriveHud(): DriveHud {
  if (typeof document === 'undefined') return NOOP;
  if (singleton) return singleton;
  singleton = createDriveHud();
  return singleton;
}

function createDriveHud(): DriveHud {
  const root = el('div', 'dv off');
  const vig = el('div', 'dv-vig');
  const flash = el('div', 'dv-flash');

  // 左折の案内
  const turn = el('div', 'dv-turn off', '<span class="dv-turn-arrow">←</span><span class="dv-turn-text">左折！</span><small class="dv-turn-sub"></small>');
  const turnSub = turn.querySelector('.dv-turn-sub') as HTMLElement;

  // 上：判定地点までの距離
  const top = el('div', 'dv-top');
  const topText = el('div', 'dv-top-text', '判定地点まで <b class="dv-dist">0</b> m');
  const topGoal = el('div', 'dv-top-goal');
  const prog = el('div', 'dv-prog', '<i></i>');
  top.append(topText, prog, topGoal);
  const dist = topText.querySelector('.dv-dist') as HTMLElement;
  const progFill = prog.querySelector('i') as HTMLElement;

  // 右下：速度計
  const speed = el('div', 'dv-speed');
  const kmhBox = el('div', 'dv-kmh', '<b>0</b><small>km/h</small>');
  const kmhNum = kmhBox.querySelector('b') as HTMLElement;
  const sbar = el('div', 'dv-sbar', '<i></i><u class="dv-t300"><span>300</span></u>');
  const sFill = sbar.querySelector('i') as HTMLElement;
  const t300 = sbar.querySelector('.dv-t300') as HTMLElement;
  speed.append(kmhBox, sbar, el('div', 'dv-sgoal', '300 km/h 以上で突入しろ！'));

  // 下：タイミングバー
  const timing = el('div', 'dv-timing');
  const fb = el('div', 'dv-fb');
  const bar = el('div', 'dv-bar', '<div class="dv-good"></div><div class="dv-perf"></div><div class="dv-cur"></div>');
  const good = bar.querySelector('.dv-good') as HTMLElement;
  const perf = bar.querySelector('.dv-perf') as HTMLElement;
  const cur = bar.querySelector('.dv-cur') as HTMLElement;
  const hint = el('div', 'dv-hint');
  timing.append(fb, bar, hint);

  const hitsEl = el('div', 'dv-hits off');

  root.append(vig, flash, turn, top, speed, timing, hitsEl);
  document.body.appendChild(root);

  // 前回の値（変わったときだけ DOM を触る）
  const last: Record<string, string> = {};
  const set = (key: string, e: HTMLElement, v: string, prop: 'text' | 'html' | 'style-left' | 'style-width' | 'style-opacity' = 'text'): void => {
    if (last[key] === v) return;
    last[key] = v;
    if (prop === 'text') e.textContent = v;
    else if (prop === 'html') e.innerHTML = v;
    else if (prop === 'style-left') e.style.left = v;
    else if (prop === 'style-width') e.style.width = v;
    else e.style.opacity = v;
  };
  const cls = (e: Element, name: string, on: boolean): void => { if (e.classList.contains(name) !== on) e.classList.toggle(name, on); };

  let visible = false;
  let fbTimer = 0;
  let hudRoot: HTMLElement | null = null;

  const api: DriveHud = {
    get visible() { return visible; },
    show() {
      if (visible) return;
      visible = true;
      root.classList.remove('off');
      hudRoot = document.getElementById('hud');
      hudRoot?.classList.add('driving');
    },
    hide() {
      if (!visible) return;
      visible = false;
      root.classList.add('off');
    },
    reset() {
      visible = false;
      root.classList.add('off');
      (hudRoot ?? document.getElementById('hud'))?.classList.remove('driving');
      document.getElementById('hud')?.classList.remove('driving');
    },
    judge(q) {
      fb.textContent = JUDGE_TEXT[q];
      fb.className = `dv-fb ${q}`;
      // アニメーションを再生し直す
      void fb.offsetWidth;
      fb.classList.add('pop');
      clearTimeout(fbTimer);
      fbTimer = window.setTimeout(() => { fb.className = 'dv-fb'; }, 850);
      if (q !== 'miss') {
        flash.className = `dv-flash ${q}`;
        void flash.offsetWidth;
        flash.classList.add('go');
      }
    },
    update(v) {
      const kmh = Math.max(0, Math.round(v.kmh));
      set('kmh', kmhNum, String(kmh));
      const ratio = Math.min(1, v.kmh / v.maxKmh);
      set('sfill', sFill, `${(ratio * 100).toFixed(1)}%`, 'style-width');
      set('t300', t300, `${((v.targetKmh / v.maxKmh) * 100).toFixed(1)}%`, 'style-left');
      cls(speed, 'ok', v.kmh >= v.targetKmh);
      cls(speed, 'near', v.kmh >= v.targetKmh * 0.85 && v.kmh < v.targetKmh);
      // 速度が出るほど画面の縁が光る
      set('vig', vig, (Math.max(0, v.kmh - 60) / (v.maxKmh - 60)).toFixed(2), 'style-opacity');

      set('dist', dist, String(Math.max(0, Math.round(v.distLeft))));
      set('prog', progFill, `${(Math.max(0, Math.min(1, 1 - v.distLeft / v.totalDist)) * 100).toFixed(1)}%`, 'style-width');
      const need = v.kmh >= v.targetKmh;
      set('goal', topGoal, need ? `${v.targetKmh} km/h クリア！このまま突っ込め` : `突入には ${v.targetKmh} km/h 以上が必要`);
      cls(topGoal, 'ok', need);

      set('cur', cur, `${(v.cursor * 100).toFixed(1)}%`, 'style-left');
      set('good', good, `${((0.5 - v.goodHalf) * 100).toFixed(1)}%`, 'style-left');
      set('goodw', good, `${(v.goodHalf * 200).toFixed(1)}%`, 'style-width');
      set('perf', perf, `${((0.5 - v.perfectHalf) * 100).toFixed(1)}%`, 'style-left');
      set('perfw', perf, `${(v.perfectHalf * 200).toFixed(1)}%`, 'style-width');
      cls(bar, 'cool', v.cooldown > 0);
      set('hint', hint, HINT[v.device], 'html');

      cls(turn, 'off', !v.turnHint);
      cls(turn, 'recover', v.recovering);
      set('turnsub', turnSub, v.recovering ? '立て直し中…そのまま左へ！' : TURN_HINT[v.device], 'html');

      const hh = v.hits > 0;
      cls(hitsEl, 'off', !hh);
      set('hits', hitsEl, `HIT ×${v.hits}`);
    },
    dispose() {
      api.reset();
      root.remove();
      singleton = null;
    },
  };
  return api;
}
