// 演出用の DOM 重ね表示：シネマスコープの黒帯・字幕・暗転・閃光・スキップ表示。
// document が無い環境（vitest の node 環境）では何もしない。1回の演出につき1つ作り、終わったら必ず dispose する。

export interface Overlay {
  setLetterbox(on: boolean): void;
  setCaption(text: string): void;
  /** 0..1（1=真っ暗） */
  setFade(a: number): void;
  /** 0..1（1=真っ白） */
  setFlash(a: number, color?: string): void;
  /** スローモーション中の暗い縁取り */
  setSlow(on: boolean): void;
  /** -1=非表示、0..1=長押しの進み具合 */
  setSkip(p: number): void;
  setHidden(h: boolean): void;
  /** fadeFromBlack: スキップ時など、黒から明けるフェードを残す */
  dispose(opts?: { fadeFromBlack?: boolean }): void;
}

const NOOP: Overlay = {
  setLetterbox() {}, setCaption() {}, setFade() {}, setFlash() {}, setSlow() {}, setSkip() {}, setHidden() {}, dispose() {},
};

function div(cls: string, parent?: HTMLElement): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  parent?.append(d);
  return d;
}

export function createOverlay(): Overlay {
  if (typeof document === 'undefined' || !document.body) return NOOP;
  const root = div('cs-root');
  const vig = div('cs-vig', root);
  const top = div('cs-bar cs-top', root);
  const bottom = div('cs-bar cs-bottom', root);
  const caption = div('cs-caption', bottom);
  const flash = div('cs-flash', root);
  const fade = div('cs-fade', root);
  const skip = div('cs-skip', root);
  const skipText = div('cs-skip-text', skip);
  skipText.textContent = 'Space / A 長押しでスキップ';
  const skipBar = div('cs-skip-bar', skip);
  const skipFill = div('cs-skip-fill', skipBar);
  document.body.append(root);
  // 演出中は通常の HUD を隠す（#hud.cutscene）。車の HUD などは body.cutscene-on で隠せる
  const hud = document.getElementById('hud');
  hud?.classList.add('cutscene');
  document.body.classList.add('cutscene-on');
  let capText = '';
  let disposed = false;

  return {
    setLetterbox(on) { root.classList.toggle('on', on); },
    setCaption(text) {
      if (text === capText) return;
      capText = text;
      caption.textContent = text;
      caption.classList.toggle('show', !!text);
    },
    setFade(a) { fade.style.opacity = String(a); },
    setFlash(a, color = '#fff') { flash.style.opacity = String(a); flash.style.background = color; },
    setSlow(on) { vig.classList.toggle('on', on); },
    setSkip(p) {
      skip.classList.toggle('show', p >= 0);
      if (p >= 0) skipFill.style.width = `${Math.round(Math.min(1, p) * 100)}%`;
    },
    setHidden(h) { root.style.visibility = h ? 'hidden' : 'visible'; },
    dispose(opts) {
      if (disposed) return;
      disposed = true;
      hud?.classList.remove('cutscene');
      document.body.classList.remove('cutscene-on');
      if (opts?.fadeFromBlack) {
        // 黒帯などは消し、黒いフェードだけを残して 0.5 秒で明ける
        for (const c of [...root.children]) if (c !== fade) c.remove();
        fade.style.transition = 'opacity 0.5s ease';
        fade.style.opacity = '1';
        void fade.offsetWidth;
        fade.style.opacity = '0';
        setTimeout(() => root.remove(), 600);
      } else root.remove();
    },
  };
}
