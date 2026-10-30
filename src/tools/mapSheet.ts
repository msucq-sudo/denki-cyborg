// 全ステージの平面図（mapsheet.html）。上のタブでステージを切り替える。#camp1 のようにハッシュでも指定できる。
// 各図は src/tools/mapsheet/*.ts が配置データ（src/level/）から描く。ホイールで拡大縮小、ドラッグで移動。
import type { EnemyKind } from '../config/balance';
import { ENEMY_COLOR, ENEMY_INFO, ENEMY_ORDER, enemyNo, enemyNoLabel } from '../config/enemyInfo';
import type { StageSheet } from './mapsheet/common';
import { createFloor1Sheet } from './mapsheet/floor1';
import { createFloor2Sheet } from './mapsheet/floor2';
import { createSurgeSheet } from './mapsheet/surge';
import { createCamp1Sheet } from './mapsheet/camp1';
import { createCamp2Sheet } from './mapsheet/camp2';
import { createDungeonSheet } from './mapsheet/dungeon';

interface StageDef {
  id: string; label: string; title: string; level: string;
  /** 途中から始めるリンク（クエリの追加分） */
  starts?: { label: string; q: string }[];
  make: () => StageSheet;
}
const STAGES: StageDef[] = [
  { id: 'floor1', label: '研究所1階', title: '研究所1階', level: 'floor1', make: createFloor1Sheet },
  { id: 'floor2', label: '研究所2階', title: '研究所2階（サイボーグ改造室）', level: 'floor2', make: createFloor2Sheet },
  { id: 'surge', label: 'サージ収容所への道', title: 'サージ収容所への道', level: 'surge', starts: [{ label: '車に乗った所から', q: '&start=drive' }], make: createSurgeSheet },
  { id: 'camp1', label: '収容所1階', title: 'サージ収容所 1階', level: 'camp1', starts: [{ label: '中ボス前から', q: '&start=boss' }], make: createCamp1Sheet },
  { id: 'camp2', label: '収容所2階', title: 'サージ収容所 2階', level: 'camp2', starts: [{ label: 'ボス戦から', q: '&start=boss' }], make: createCamp2Sheet },
  { id: 'dungeon', label: '動力炉', title: '動力炉（アルファ版ダンジョン）', level: 'dungeon', make: createDungeonSheet },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tabs = $('tabs'), view = $('view'), filter = $('enemyFilter'), filterBar = $('filterBar');
const playLinks = $('play'), tbl = $('placedTable') as HTMLTableElement, tblHead = $('tableHead'), zoomLabel = $('zoom');

const cache = new Map<string, StageSheet>();
let cur: { def: StageDef; sheet: StageSheet } | null = null;
let focus: EnemyKind | null = null;

// ---------------------------------------------------------------- 拡大縮小・移動
let scale = 1, tx = 0, ty = 0;
function apply(): void {
  if (!cur) return;
  cur.sheet.canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  zoomLabel.textContent = `${Math.round(scale * 100)}%`;
}
function fit(): void {
  if (!cur) return;
  const cv = cur.sheet.canvas, r = view.getBoundingClientRect();
  scale = Math.min(r.width / cv.width, r.height / cv.height) * 0.98;
  tx = (r.width - cv.width * scale) / 2; ty = (r.height - cv.height * scale) / 2;
  apply();
}
function zoomAt(f: number, px: number, py: number): void {
  const ns = Math.min(6, Math.max(0.05, scale * f));
  tx = px - ((px - tx) / scale) * ns; ty = py - ((py - ty) / scale) * ns;
  scale = ns; apply();
}
view.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = view.getBoundingClientRect();
  zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
let drag: { x: number; y: number; tx: number; ty: number } | null = null;
view.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, tx, ty }; view.setPointerCapture(e.pointerId); view.classList.add('drag'); });
view.addEventListener('pointermove', (e) => { if (!drag) return; tx = drag.tx + e.clientX - drag.x; ty = drag.ty + e.clientY - drag.y; apply(); });
const endDrag = () => { drag = null; view.classList.remove('drag'); };
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);
view.addEventListener('dblclick', (e) => { const r = view.getBoundingClientRect(); zoomAt(2, e.clientX - r.left, e.clientY - r.top); });
$('fit').onclick = fit;
$('actual').onclick = () => { const r = view.getBoundingClientRect(); zoomAt(1 / scale, r.width / 2, r.height / 2); };
$('zin').onclick = () => { const r = view.getBoundingClientRect(); zoomAt(1.4, r.width / 2, r.height / 2); };
$('zout').onclick = () => { const r = view.getBoundingClientRect(); zoomAt(1 / 1.4, r.width / 2, r.height / 2); };
window.addEventListener('resize', () => { if (cur) fit(); });

// ---------------------------------------------------------------- ステージの切り替え
for (const s of STAGES) {
  const b = document.createElement('button');
  b.textContent = s.label; b.dataset.id = s.id;
  b.onclick = () => show(s.id);
  tabs.append(b);
}

function show(id: string): void {
  const def = STAGES.find((s) => s.id === id) ?? STAGES[0];
  let sheet = cache.get(def.id);
  if (!sheet) {
    try { sheet = def.make(); } catch (err) {
      console.error(`[mapsheet] ${def.id} の図を作れませんでした`, err);
      view.innerHTML = `<p class="err">${def.title} の図を作れませんでした：${String(err)}</p>`;
      cur = null;
      return;
    }
    cache.set(def.id, sheet);
  }
  if (cur) cur.sheet.canvas.removeAttribute('id');
  view.replaceChildren(sheet.canvas);
  sheet.canvas.id = 'sheet'; // 旧 tests/e2e/mapsheet_capture.mjs が #sheet を読む
  cur = { def, sheet };
  focus = null; sheet.draw(null);
  document.title = `${def.title} 平面図`;
  for (const b of tabs.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.id === def.id);
  history.replaceState(null, '', '#' + def.id);
  // ゲームで開くリンク
  const q = def.level === 'dungeon' ? './?level=dungeon' : `./?level=${def.level}`;
  playLinks.innerHTML = `<a href="${q}" target="_blank">▶ ゲームで開く（?level=${def.level}）↗</a>` +
    (def.starts ?? []).map((st) => `<a href="${q}${st.q}" target="_blank">▶ ${st.label} ↗</a>`).join('');
  buildFilter(sheet);
  buildTable(sheet);
  fit();
}

function buildFilter(sheet: StageSheet): void {
  filter.replaceChildren();
  filterBar.style.display = sheet.placed.length ? '' : 'none';
  if (!sheet.placed.length) return;
  const mk = (label: string, k: EnemyKind | null, color: string) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.background = color; b.style.color = '#fff';
    b.onclick = () => { focus = k; sheet.draw(focus); for (const x of filter.querySelectorAll('button')) x.classList.toggle('on', x === b); };
    filter.append(b);
    return b;
  };
  mk('全部', null, '#28467a').classList.add('on');
  for (const k of ENEMY_ORDER) {
    const n = sheet.placed.filter((p) => p.kind === k).length;
    if (n) mk(`${enemyNo(k)} ${ENEMY_INFO[k].name} ×${n}`, k, ENEMY_COLOR[k]);
  }
}

function buildTable(sheet: StageSheet): void {
  tblHead.style.display = sheet.placed.length ? '' : 'none';
  tbl.style.display = sheet.placed.length ? '' : 'none';
  tbl.innerHTML = '<tr><th>#</th><th>図鑑No.</th><th>敵</th><th>出方</th><th>場所</th><th>番地</th><th>座標(x, z)</th></tr>' +
    sheet.placed.map((p) => `<tr><td>#${p.id}</td><td>${enemyNoLabel(p.kind)}</td><td style="color:${ENEMY_COLOR[p.kind]};font-weight:700">${ENEMY_INFO[p.kind].name}</td>` +
      `<td>${p.how}</td><td>${p.area}</td><td>${p.cell}</td><td>${p.x.toFixed(1)}, ${p.z.toFixed(1)}</td></tr>`).join('');
}

$('save').onclick = () => {
  if (!cur) return;
  const a = document.createElement('a');
  a.download = cur.sheet.fileName;
  a.href = cur.sheet.canvas.toDataURL('image/png');
  a.click();
};

window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== cur?.def.id) show(id); });
// Web フォントが届いてから描く（届かなくても 1.5 秒で始める）
const fontsReady = (document as Document & { fonts?: FontFaceSet }).fonts?.ready ?? Promise.resolve();
void Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]).then(() => {
  show(location.hash.slice(1) || 'floor1');
  (window as unknown as { __sheetReady: boolean }).__sheetReady = true;
});
