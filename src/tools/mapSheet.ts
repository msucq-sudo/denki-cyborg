// 1階の平面図（書き込み用）。配置データから2Dで描く。方眼＝10m（A,B,C… × 1,2,3…）
import { generateFloor1, type BoxPrim } from '../level/floor1/plan';
import type { EnemyKind } from '../config/balance';
import { ENEMY_COLOR, ENEMY_INFO, ENEMY_ORDER, enemyNo, enemyNoLabel } from '../config/enemyInfo';

const PX = 12;            // 1m あたりのピクセル
const PAD = 70;           // 余白（方眼ラベル用）
const GRID = 10;          // 方眼（m）

const plan = generateFloor1();
const boxes = plan.prims.filter((p): p is BoxPrim => p.t === 'box');

// 範囲（床の外形から）
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (const b of boxes) {
  if (b.tag !== 'floor') continue;
  minX = Math.min(minX, b.x0); maxX = Math.max(maxX, b.x1);
  minZ = Math.min(minZ, b.z0); maxZ = Math.max(maxZ, b.z1);
}
minX = Math.floor((minX - 2) / GRID) * GRID; maxX = Math.ceil((maxX + 2) / GRID) * GRID;
minZ = Math.floor((minZ - 2) / GRID) * GRID; maxZ = Math.ceil((maxZ + 2) / GRID) * GRID;

const LEGEND_W = 360;
const W = (maxX - minX) * PX + PAD * 2 + LEGEND_W;
const H = (maxZ - minZ) * PX + PAD * 2;
const cv = document.getElementById('sheet') as HTMLCanvasElement;
cv.width = W; cv.height = H;
const c = cv.getContext('2d')!;
const X = (x: number) => PAD + (x - minX) * PX;
const Z = (z: number) => PAD + (z - minZ) * PX;
const rect = (b: { x0: number; x1: number; z0: number; z1: number }, fill: string, stroke?: string, lw = 1) => {
  c.fillStyle = fill; c.fillRect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * PX, (b.z1 - b.z0) * PX);
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.strokeRect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * PX, (b.z1 - b.z0) * PX); }
};

// 配置されている敵の一覧（通し番号 #1, #2…）。ゾーン順・出現順
interface Placed { id: number; kind: EnemyKind; x: number; z: number; zone: string; mode: 'pod' | 'drop'; high: boolean }
const placed: Placed[] = [];
for (const zn of plan.zones) {
  for (const s of [...zn.spawns, ...((zn as { then?: typeof zn.spawns }).then ?? [])]) {
    const mode = s.kind === 'drone' || (s as { mode?: string }).mode === 'drop' ? 'drop' : 'pod';
    placed.push({ id: placed.length + 1, kind: s.kind, x: s.x, z: s.z, zone: zn.name, mode, high: !!s.floor });
  }
}
/** 方眼の番地（例：C9） */
const cellOf = (x: number, z: number) => `${colName(Math.floor((x - minX) / GRID))}${Math.floor((z - minZ) / GRID) + 1}`;
const colName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : 'A' + String.fromCharCode(65 + i - 26));

/** 強調表示する敵の種類（null＝全部） */
let focus: EnemyKind | null = null;

function draw(): void {
c.globalAlpha = 1;
c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);

// 床
for (const b of boxes) if (b.tag === 'floor') rect(b, '#e9edf2');

// 方眼
c.font = 'bold 15px "Noto Sans JP", sans-serif';
c.textAlign = 'center'; c.textBaseline = 'middle';
for (let x = minX, i = 0; x <= maxX; x += GRID, i++) {
  c.strokeStyle = 'rgba(40,70,120,0.18)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(X(x), Z(minZ)); c.lineTo(X(x), Z(maxZ)); c.stroke();
  if (x < maxX) {
    c.fillStyle = '#28467a';
    c.fillText(colName(i), X(x + GRID / 2), PAD / 2);
    c.fillText(colName(i), X(x + GRID / 2), H - PAD / 2);
  }
}
for (let z = minZ, j = 1; z <= maxZ; z += GRID, j++) {
  c.strokeStyle = 'rgba(40,70,120,0.18)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(X(minX), Z(z)); c.lineTo(X(maxX), Z(z)); c.stroke();
  if (z < maxZ) {
    c.fillStyle = '#28467a';
    c.fillText(String(j), PAD / 2, Z(z + GRID / 2));
    c.fillText(String(j), X(maxX) + PAD / 2, Z(z + GRID / 2));
  }
}

// 足場（高台デッキ）・アスレチックの段
for (const b of boxes) {
  if (!b.col) continue;
  if (b.tag === 'deck') rect(b, 'rgba(90,170,230,0.30)', 'rgba(40,110,180,0.7)');
}
for (const b of boxes) if (b.col && b.tag === 'step') rect(b, 'rgba(60,140,220,0.65)', '#1f5aa0');
// 家具・ポッド
for (const b of boxes) if (b.col && b.tag === 'prop') rect(b, '#c9a36b', '#7a5a2c');
// 壁・柱（当たり判定があって背の高いもの）
for (const b of boxes) {
  if (!b.col || b.tag === 'floor' || b.tag === 'ceiling' || b.tag === 'deck' || b.tag === 'step' || b.tag === 'prop' || b.tag === 'pod') continue;
  if (b.y1 - b.y0 < 3 || b.y0 > 2) continue;
  rect(b, '#2b3442');
}

// 部屋名（ゲーム内では表示しない。図の参照用）
c.font = 'bold 16px "Noto Sans JP", sans-serif';
const named = new Set<string>();
for (const r of plan.rooms) {
  if (named.has(r.name) && r.name.includes('通路')) continue;
  named.add(r.name);
  const cx = X((r.x0 + r.x1) / 2), cz = Z((r.z0 + r.z1) / 2);
  const w = c.measureText(r.name).width + 12;
  if ((r.x1 - r.x0) * PX < w && (r.z1 - r.z0) * PX < 40) continue;
  c.fillStyle = 'rgba(255,255,255,0.8)'; c.fillRect(cx - w / 2, cz - 12, w, 24);
  c.fillStyle = '#28467a'; c.fillText(r.name, cx, cz);
}

// 目印
const dot = (x: number, z: number, r: number, fill: string, label?: string, labelColor = '#fff', font = 'bold 12px sans-serif') => {
  c.beginPath(); c.arc(X(x), Z(z), r, 0, Math.PI * 2); c.fillStyle = fill; c.fill();
  c.lineWidth = 1.5; c.strokeStyle = '#ffffff'; c.stroke();
  if (label) { c.fillStyle = labelColor; c.font = font; c.fillText(label, X(x), Z(z) + 0.5); }
};
// 充電ポイント・修理キット
for (const p of plan.pads) dot(p.x, p.z, 9, '#18b6d6', '電');
for (const k of plan.kits) dot(k.x, k.z, 8, '#ff6b8a', '+', '#fff', 'bold 15px sans-serif');
// 敵：中の数字＝図鑑番号（No.）、右上の小さい #＝配置の通し番号。■ポッド ●天井から
for (const p of placed) {
  const col = ENEMY_COLOR[p.kind];
  const big = p.kind === 'heavy' || p.kind === 'heavyWalker' || p.kind === 'missile';
  const r = big ? 13 : 11;
  const dim = focus !== null && focus !== p.kind;
  c.globalAlpha = dim ? 0.15 : 1;
  const x = X(p.x), z = Z(p.z);
  if (focus === p.kind) { c.beginPath(); c.arc(x, z, r + 9, 0, Math.PI * 2); c.fillStyle = 'rgba(255,214,0,0.45)'; c.fill(); }
  if (p.mode === 'drop') {
    c.beginPath(); c.arc(x, z, r, 0, Math.PI * 2); c.fillStyle = col; c.fill();
    c.setLineDash([3, 2]); c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke(); c.setLineDash([]);
  } else {
    c.fillStyle = col; c.fillRect(x - r, z - r, r * 2, r * 2);
    c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.strokeRect(x - r, z - r, r * 2, r * 2);
  }
  c.textAlign = 'center';
  c.fillStyle = '#fff'; c.font = 'bold 13px sans-serif'; c.fillText(String(enemyNo(p.kind)), x, z + 0.5);
  // 通し番号
  c.font = 'bold 10px sans-serif';
  const tag = `#${p.id}`;
  const tw = c.measureText(tag).width + 6;
  c.fillStyle = '#111'; c.fillRect(x + r - 2, z - r - 9, tw, 13);
  c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText(tag, x + r + 1, z - r - 2);
  c.textAlign = 'center';
  if (p.high) { c.fillStyle = '#1f5aa0'; c.font = 'bold 10px sans-serif'; c.fillText('高台', x, z + r + 8); }
  c.globalAlpha = 1;
}
// 歯車
plan.gears.forEach((g, i) => {
  dot(g.x, g.z, 12, '#e0a800', '⚙', '#fff', 'bold 16px sans-serif');
  c.fillStyle = '#8a6400'; c.font = 'bold 11px sans-serif';
  c.fillText(`歯車${i + 1}${g.y > 3 ? '（高所）' : ''}`, X(g.x), Z(g.z) + 22);
});
// スタート・バッテリー・エレベーター
dot(plan.start.x, plan.start.z, 13, '#e02020', 'S', '#fff', 'bold 15px sans-serif');
c.fillStyle = '#e02020'; c.font = 'bold 12px "Noto Sans JP", sans-serif'; c.fillText('スタート', X(plan.start.x), Z(plan.start.z) + 24);
dot(plan.power.x, plan.power.z, 13, '#20a050', '電', '#fff', 'bold 13px sans-serif');
c.fillStyle = '#20a050'; c.fillText('電源（撃つ／アームで給電）', X(plan.power.x) + 4, Z(plan.power.z) + 24);

// グラップルポイント（黄色い菱形）。法線方向に短い線
for (const g of plan.grapples) {
  const x = X(g.x), z = Z(g.z);
  c.fillStyle = '#ffcc1a'; c.strokeStyle = '#7a5a00'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(x, z - 11); c.lineTo(x + 11, z); c.lineTo(x, z + 11); c.lineTo(x - 11, z); c.closePath(); c.fill(); c.stroke();
  c.fillStyle = '#7a5a00'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.fillText('G', x, z + 0.5);
  if (g.landAt) {
    c.setLineDash([4, 3]); c.beginPath(); c.moveTo(x, z); c.lineTo(X(g.landAt.x), Z(g.landAt.z)); c.stroke(); c.setLineDash([]);
  }
  c.font = 'bold 11px "Noto Sans JP", sans-serif'; c.fillStyle = '#7a5a00';
  c.fillText(g.label, x + g.nx * 70, z + 24 + g.nz * 12);
}

// ゲート（紫の棒）。トリガーの説明つき
c.textAlign = 'center';
for (const g of plan.gates) {
  const along = g.axis === 'x' ? g.z1 - g.z0 : g.x1 - g.x0;
  const cx = (g.x0 + g.x1) / 2, cz = (g.z0 + g.z1) / 2;
  c.fillStyle = '#9b3cd8';
  if (g.axis === 'x') c.fillRect(X(cx) - 4, Z(cz) - along * PX / 2, 8, along * PX);
  else c.fillRect(X(cx) - along * PX / 2, Z(cz) - 4, along * PX, 8);
  c.font = 'bold 11px "Noto Sans JP", sans-serif';
  const txt = `${g.label}${g.closed ? '【初期:閉】' : ''}`;
  const sub2 = g.trigger;
  const w = Math.max(c.measureText(txt).width, c.measureText(sub2).width) + 8;
  const ox = X(cx) + (g.axis === 'x' ? (cx > 0 ? 8 : -8) : 0), oy = Z(cz) + (g.axis === 'z' ? -34 : 16);
  const lx = Math.min(Math.max(ox, PAD + w / 2), W - LEGEND_W - w / 2);
  c.fillStyle = 'rgba(255,255,255,0.88)'; c.fillRect(lx - w / 2, oy - 12, w, 28);
  c.strokeStyle = '#9b3cd8'; c.lineWidth = 1; c.strokeRect(lx - w / 2, oy - 12, w, 28);
  c.fillStyle = '#6a1fa0'; c.fillText(txt, lx, oy - 4);
  c.font = '10px "Noto Sans JP", sans-serif'; c.fillStyle = '#444'; c.fillText(sub2, lx, oy + 8);
}
// 順路番号 ①②③…
for (const r of plan.route) {
  // 敵の印と見分けるため、白地に赤い縁の丸
  c.beginPath(); c.arc(X(r.x), Z(r.z), 14, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill();
  c.lineWidth = 3; c.strokeStyle = '#d02050'; c.stroke();
  c.fillStyle = '#d02050'; c.font = 'bold 15px sans-serif'; c.fillText(String(r.n), X(r.x), Z(r.z) + 1);
}
c.textAlign = 'center';
const el = plan.elevator;
rect({ x0: el.x0, x1: el.x1, z0: el.z0, z1: el.z1 }, 'rgba(140,90,210,0.35)', '#7a4ac8', 2);
c.fillStyle = '#6a3ab8'; c.font = 'bold 14px "Noto Sans JP", sans-serif';
c.fillText('エレベーター（ゴール）', X((el.x0 + el.x1) / 2), Z(el.z0) - 12);

// 縮尺
c.fillStyle = '#28467a'; c.font = 'bold 13px "Noto Sans JP", sans-serif'; c.textAlign = 'left';
c.fillRect(X(minX) + 10, Z(maxZ) - 18, 10 * PX, 4);
c.fillText('10m（方眼1マス）', X(minX) + 10, Z(maxZ) - 30);

// 凡例
const LX = W - LEGEND_W + 10;
let ly = PAD;
c.textAlign = 'left';
c.fillStyle = '#28467a'; c.font = 'bold 20px "Noto Sans JP", sans-serif'; c.fillText('研究所1階  平面図', LX, ly); ly += 26;
c.font = '13px "Noto Sans JP", sans-serif'; c.fillStyle = '#555';
c.fillText('北が上。方眼1マス＝10m。', LX, ly); ly += 18;
c.fillText('「C4の箱を消す」のように方眼で指定可', LX, ly); ly += 30;
const legend: [string, () => void][] = [
  ['壁・柱', () => { c.fillStyle = '#2b3442'; c.fillRect(LX, ly - 8, 18, 16); }],
  ['家具・箱（当たりあり）', () => { c.fillStyle = '#c9a36b'; c.fillRect(LX, ly - 8, 18, 16); }],
  ['高台デッキ（高さ7.2m）', () => { c.fillStyle = 'rgba(90,170,230,0.5)'; c.fillRect(LX, ly - 8, 18, 16); }],
  ['登れる段（アスレチック）', () => { c.fillStyle = 'rgba(60,140,220,0.8)'; c.fillRect(LX, ly - 8, 18, 16); }],
  ['■ 敵（ポッドの中）数字＝図鑑No.', () => { c.fillStyle = '#f08a24'; c.fillRect(LX, ly - 8, 16, 16); }],
  ['● 敵（天井から降りる）', () => { c.beginPath(); c.arc(LX + 8, ly, 8, 0, 7); c.fillStyle = '#3aa0ff'; c.fill(); }],
  ['#12 配置の通し番号', () => { c.fillStyle = '#111'; c.fillRect(LX, ly - 7, 22, 13); }],
  ['歯車（強化素材）', () => { c.beginPath(); c.arc(LX + 8, ly, 8, 0, 7); c.fillStyle = '#e0a800'; c.fill(); }],
  ['▮ ゲート（紫）', () => { c.fillStyle = '#9b3cd8'; c.fillRect(LX + 4, ly - 8, 8, 16); }],
  ['G グラップル（アームで引き寄せ）', () => { c.fillStyle = '#ffcc1a'; c.beginPath(); c.moveTo(LX + 8, ly - 9); c.lineTo(LX + 17, ly); c.lineTo(LX + 8, ly + 9); c.lineTo(LX - 1, ly); c.fill(); }],
  ['① 順路の番号', () => { c.beginPath(); c.arc(LX + 8, ly, 8, 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 2.5; c.strokeStyle = '#d02050'; c.stroke(); }],
  ['電 充電ポイント', () => { c.beginPath(); c.arc(LX + 8, ly, 8, 0, 7); c.fillStyle = '#18b6d6'; c.fill(); }],
  ['+ 修理キット', () => { c.beginPath(); c.arc(LX + 8, ly, 8, 0, 7); c.fillStyle = '#ff6b8a'; c.fill(); }],
];
for (const [label, draw] of legend) {
  draw(); c.fillStyle = '#222'; c.font = '14px "Noto Sans JP", sans-serif'; c.fillText(label, LX + 28, ly + 1); ly += 26;
}
ly += 10;
ly += 6;
c.fillStyle = '#d02050'; c.font = 'bold 15px "Noto Sans JP", sans-serif'; c.fillText('順路', LX, ly); ly += 22;
c.font = '13px "Noto Sans JP", sans-serif'; c.fillStyle = '#222';
for (const r of plan.route) { c.fillText(`${r.n}. ${r.label}`, LX, ly); ly += 18; }
ly += 8;
c.fillStyle = '#28467a'; c.font = 'bold 15px "Noto Sans JP", sans-serif'; c.fillText('敵の図鑑番号（この階の数）', LX, ly); ly += 22;
for (const k of ENEMY_ORDER) {
  const n = placed.filter((p) => p.kind === k).length;
  if (k === 'boss' && n === 0) continue;
  c.globalAlpha = focus !== null && focus !== k ? 0.3 : 1;
  c.fillStyle = ENEMY_COLOR[k]; c.fillRect(LX, ly - 8, 16, 16);
  c.fillStyle = '#fff'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.fillText(String(enemyNo(k)), LX + 8, ly + 1);
  c.textAlign = 'left'; c.fillStyle = '#222'; c.font = '13px "Noto Sans JP", sans-serif';
  c.fillText(`${enemyNoLabel(k)} ${ENEMY_INFO[k].name}  ×${n}`, LX + 24, ly + 1);
  ly += 20;
}
c.globalAlpha = 1;
ly += 10;
c.fillStyle = '#28467a'; c.font = 'bold 15px "Noto Sans JP", sans-serif'; c.fillText('配置一覧（#・No.・場所・番地）', LX, ly); ly += 20;
c.font = '12px "Noto Sans JP", sans-serif';
for (const p of placed) {
  if (ly > H - 12) { c.fillStyle = '#888'; c.fillText('…（続きは画面下の表）', LX, ly); break; }
  c.globalAlpha = focus !== null && focus !== p.kind ? 0.3 : 1;
  c.fillStyle = ENEMY_COLOR[p.kind];
  c.fillText(`#${p.id}`, LX, ly);
  c.fillStyle = '#222';
  c.fillText(`${enemyNoLabel(p.kind)} ${ENEMY_INFO[p.kind].name}${p.mode === 'drop' ? '（天井）' : ''}  ${p.zone}  ${cellOf(p.x, p.z)}`, LX + 34, ly);
  ly += 16;
}
c.globalAlpha = 1;
}
draw();

// ---- 画面上の操作：番号ボタンで種類ごとに強調／配置の表
const bar = document.getElementById('enemyFilter');
if (bar) {
  const mk = (label: string, k: EnemyKind | null, color: string) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.background = color; b.style.color = '#fff';
    b.onclick = () => { focus = k; draw(); for (const x of bar.querySelectorAll('button')) x.classList.toggle('on', x === b); };
    bar.append(b);
    return b;
  };
  mk('全部', null, '#28467a').classList.add('on');
  for (const k of ENEMY_ORDER) {
    if (!placed.some((p) => p.kind === k)) continue;
    mk(`${enemyNo(k)} ${ENEMY_INFO[k].name}`, k, ENEMY_COLOR[k]);
  }
}
const tbl = document.getElementById('placedTable');
if (tbl) {
  tbl.innerHTML = '<tr><th>#</th><th>図鑑No.</th><th>敵</th><th>出方</th><th>場所</th><th>番地</th><th>座標(x, z)</th></tr>' +
    placed.map((p) => `<tr><td>#${p.id}</td><td>${enemyNoLabel(p.kind)}</td><td style="color:${ENEMY_COLOR[p.kind]};font-weight:700">${ENEMY_INFO[p.kind].name}</td>` +
      `<td>${p.mode === 'drop' ? '天井から' : 'ポッド'}${p.high ? '・高台' : ''}</td><td>${p.zone}</td><td>${cellOf(p.x, p.z)}</td><td>${p.x.toFixed(1)}, ${p.z.toFixed(1)}</td></tr>`).join('');
}

// 保存
(document.getElementById('save') as HTMLButtonElement).onclick = () => {
  const a = document.createElement('a');
  a.download = 'floor1_map.png';
  a.href = cv.toDataURL('image/png');
  a.click();
};
(window as any).__sheetReady = true;
