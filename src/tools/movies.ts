// ムービー一覧：カード1枚が1本のムービー。「再生」はゲームをムービー単体モードで同じタブに開く。
import { MOVIE_LIST, fmtSec, movieTotal } from './movieCatalog';

const root = document.getElementById('cards')!;
for (const m of MOVIE_LIST) {
  const card = document.createElement('section');
  card.className = 'card';
  const h = document.createElement('h2');
  h.textContent = m.title;
  const desc = document.createElement('div');
  desc.className = 'desc';
  desc.textContent = m.desc;
  const len = document.createElement('div');
  len.className = 'len';
  len.textContent = `長さ：${m.upTo ? '最大 約' : '約'}${fmtSec(movieTotal(m))}（${m.shots.length} ショット）`;
  const h3 = document.createElement('h3');
  h3.textContent = 'ショット';
  const ol = document.createElement('ol');
  for (const s of m.shots) {
    const li = document.createElement('li');
    li.textContent = s.name;
    const sm = document.createElement('small');
    sm.textContent = `${s.d.toFixed(1)}秒`;
    li.append(sm);
    ol.append(li);
  }
  const play = document.createElement('a');
  play.className = 'play';
  play.href = m.url;
  play.textContent = '再生';
  play.dataset.movie = m.id;
  card.append(h, desc, len, h3, ol, play);
  root.append(card);
}
