// ムービー単体モード（ムービー一覧 movies.html から開く）。URL に movie=… を付けると、タイトル画面なしでそのムービーだけを流す。
//   ?level=surge&start=drive&movie=success   サージへの道：突破成功
//   ?level=surge&start=drive&movie=fail      サージへの道：失敗（ヘビーに止められる）
//   ?level=surge&start=drive&route=drain&movie=drainSuccess|drainFail|drainStall   ドレイン装置への道：突入成功／扉ではね返る／坂で失速
//   ?level=camp2&start=intro&movie=intro     収容所2階：扉を調べる（ジェネレーター登場）
//   ?level=camp2&start=movie&movie=ending    収容所2階：ジェネレーター撃破〜脱出
//   ?level=drainBoss&start=movie&movie=drainBoss   ドレイン装置の部屋：自動ドア〜ボス登場（導入ムービー）
//   ?level=dungeon&start=special&movie=special   必殺技（電気のかめはめ波）：敵を並べてゲージ満タンから自動で撃つ
// ムービーが終わる（スキップ含む）と、続きは遊ばせず「もう一度見る」「ムービー一覧へ戻る」の小さな画面を出す。このモードではセーブもしない。

import * as THREE from 'three';

export type MovieId = 'success' | 'fail' | 'intro' | 'ending' | 'drainSuccess' | 'drainFail' | 'drainStall' | 'drainBoss' | 'special';
const IDS: MovieId[] = ['success', 'fail', 'intro', 'ending', 'drainSuccess', 'drainFail', 'drainStall', 'drainBoss', 'special'];

/** URL の検索部分から、ムービー単体モードのムービーを読む（なければ null）。movie=1 と camp2 の start=movie は従来どおり ending */
export function movieFromSearch(search: string): MovieId | null {
  const q = new URLSearchParams(search);
  const m = q.get('movie');
  if (IDS.includes(m as MovieId)) return m as MovieId;
  if (m === '1') return 'ending';
  if (q.get('level') === 'camp2' && q.get('start') === 'movie') return 'ending';
  return null;
}

/** 今のページがムービー単体モードか（document の無い環境では null） */
export function movieNow(): MovieId | null {
  return typeof location !== 'undefined' ? movieFromSearch(location.search) : null;
}

/** ムービーごとのゲーム側の開始指定（ムービー一覧のリンクと、「もう一度見る」で使う） */
export const MOVIE_START: Record<MovieId, { level: string; start: string; route?: string }> = {
  success: { level: 'surge', start: 'drive' },
  fail: { level: 'surge', start: 'drive' },
  intro: { level: 'camp2', start: 'intro' },
  ending: { level: 'camp2', start: 'movie' },
  drainSuccess: { level: 'surge', start: 'drive', route: 'drain' },
  drainFail: { level: 'surge', start: 'drive', route: 'drain' },
  drainStall: { level: 'surge', start: 'drive', route: 'drain' },
  drainBoss: { level: 'drainBoss', start: 'movie' },
  special: { level: 'dungeon', start: 'special' },
};

/** ゲーム（index.html）をそのムービーだけで開く URL（base は同じ階層の index.html） */
export function movieUrl(id: MovieId): string {
  const s = MOVIE_START[id];
  return `index.html?level=${s.level}&start=${s.start}${s.route ? `&route=${s.route}` : ''}&movie=${id}`;
}

/** 終わりの小さな画面。「もう一度見る」で onReplay を呼ぶ（画面は閉じる）。document が無い環境では何もしない */
export function showMovieEnd(onReplay: () => void, world?: { scene: { background: unknown; fog: unknown; visible: boolean } }): void {
  if (world) {
    // ムービーの続き（降りた主人公・HUD など）を見せない：画面は真っ暗にする
    world.scene.background = new THREE.Color(0x000000);
    world.scene.fog = null;
    world.scene.visible = false;
  }
  if (typeof document === 'undefined' || !document.body) return;
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = 'none';
  document.getElementById('movie-end')?.remove();
  const root = document.createElement('div');
  root.id = 'movie-end';
  root.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(2,6,18,.72);font-family:"Noto Sans JP","Yu Gothic UI",sans-serif;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#12214d;border:1px solid #2ee6ff;border-radius:12px;padding:22px 30px;text-align:center;color:#e8f3ff;box-shadow:0 8px 40px rgba(0,0,0,.6);';
  const h = document.createElement('div');
  h.textContent = 'ムービー終了';
  h.style.cssText = 'font-size:20px;font-weight:700;color:#ffd83a;margin-bottom:16px;';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:14px;justify-content:center;';
  const btn = 'font:inherit;font-size:16px;font-weight:700;padding:10px 22px;border-radius:8px;cursor:pointer;text-decoration:none;';
  const again = document.createElement('button');
  again.textContent = 'もう一度見る';
  again.style.cssText = btn + 'background:#2ee6ff;color:#05102a;border:1px solid #2ee6ff;';
  again.onclick = () => { root.remove(); if (hud) hud.style.display = ''; onReplay(); };
  const back = document.createElement('a');
  back.textContent = 'ムービー一覧へ戻る';
  back.href = 'movies.html';
  back.style.cssText = btn + 'background:#1b2c63;color:#2ee6ff;border:1px solid #2ee6ff;';
  row.append(again, back);
  box.append(h, row);
  root.append(box);
  document.body.append(root);
  again.focus();
}
