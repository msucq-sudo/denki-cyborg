// 1階の平面図（書き込み用）。配置データから2Dで描く。方眼＝10m（A,B,C… × 1,2,3…）
import { generateFloor1, type BoxPrim } from '../level/floor1/plan';
import type { EnemyKind } from '../config/balance';

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

const LEGEND_W = 300;
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

c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);

// 床
for (const b of boxes) if (b.tag === 'floor') rect(b, '#e9edf2');

// 方眼
const colName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : 'A' + String.fromCharCode(65 + i - 26));
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
// 敵
const KIND: Record<EnemyKind, [string, string]> = {
  drone: ['D', '#3aa0ff'], crawler: ['C', '#f08a24'], gunner: ['G', '#d4a800'], walker: ['W', '#2fa86a'],
  heavy: ['H', '#d23c3c'], heavyWalker: ['HW', '#8a3cd2'], missile: ['M', '#444'], boss: ['B', '#000'],
};
for (const z of plan.zones) {
  const lists: [typeof z.spawns, string][] = [[z.spawns, 'w1']];
  for (const [list, tag] of lists) {
    for (const s of list) {
      const [lab, col] = KIND[s.kind];
      const r = s.kind === 'heavy' || s.kind === 'heavyWalker' || s.kind === 'missile' ? 11 : 9;
      if (tag === 'w1') {
        // 地上＝ポッド（四角）、ドローン＝天井から（丸）
        if (s.kind === 'drone' || s.mode === 'drop') dot(s.x, s.z, r, col, lab);
        else {
          c.fillStyle = col; c.fillRect(X(s.x) - r, Z(s.z) - r, r * 2, r * 2);
          c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.strokeRect(X(s.x) - r, Z(s.z) - r, r * 2, r * 2);
          c.fillStyle = '#fff'; c.font = 'bold 11px sans-serif'; c.fillText(lab, X(s.x), Z(s.z) + 0.5);
        }
        if (s.floor) { c.fillStyle = '#1f5aa0'; c.font = 'bold 10px sans-serif'; c.fillText('高台', X(s.x), Z(s.z) - r - 7); }
      } else {
        // 増援（天井から）＝点線の丸
        c.beginPath(); c.arc(X(s.x), Z(s.z), r, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,0.9)'; c.fill();
        c.setLineDash([3, 2]); c.lineWidth = 2; c.strokeStyle = col; c.stroke(); c.setLineDash([]);
        c.fillStyle = col; c.font = 'bold 11px sans-serif'; c.fillText(lab, X(s.x), Z(s.z) + 0.5);
        c.font = 'bold 10px sans-serif'; c.fillText(tag === 'final' ? '最終' : '2波', X(s.x), Z(s.z) + r + 7);
      }
    }
  }
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
  c.beginPath(); c.arc(X(r.x), Z(r.z), 14, 0, Math.PI * 2); c.fillStyle = '#d02050'; c.fill();
  c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke();
  c.fillStyle = '#fff'; c.font = 'bold 15px sans-serif'; c.fillText(String(r.n), X(r.x), Z(r.z) + 1);
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
  ['■ 敵（ポッドの中）', () => { c.fillStyle = '#f08a24'; c.fillRect(LX, ly - 8, 16, 16); }],
  ['● ドローン（天井から）', () => { c.beginPath(); c.arc(LX + 8, ly, 8, 0, 7); c.fillStyle = '#3aa0ff'; c.fill(); }],
  ['◌ 天井から降りる敵（罠）', () => { c.beginPath(); c.arc(LX + 8, ly, 8, 0, 7); c.setLineDash([3, 2]); c.strokeStyle = '#8a3cd2'; c.lineWidth = 2; c.stroke(); c.setLineDash([]); }],
  ['歯車（強化素材）', () => { c.beginPath(); c.arc(LX + 8, ly, 8, 0, 7); c.fillStyle = '#e0a800'; c.fill(); }],
  ['▮ ゲート（紫）', () => { c.fillStyle = '#9b3cd8'; c.fillRect(LX + 4, ly - 8, 8, 16); }],
  ['G グラップル（アームで引き寄せ）', () => { c.fillStyle = '#ffcc1a'; c.beginPath(); c.moveTo(LX + 8, ly - 9); c.lineTo(LX + 17, ly); c.lineTo(LX + 8, ly + 9); c.lineTo(LX - 1, ly); c.fill(); }],
  ['① 順路の番号', () => { c.beginPath(); c.arc(LX + 8, ly, 8, 0, 7); c.fillStyle = '#d02050'; c.fill(); }],
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
c.fillStyle = '#28467a'; c.font = 'bold 15px "Noto Sans JP", sans-serif'; c.fillText('敵の記号', LX, ly); ly += 22;
c.font = '14px "Noto Sans JP", sans-serif'; c.fillStyle = '#222';
for (const t of ['D ドローン', 'C クローラー', 'G ガンナー', 'W ウォーカー', 'H ヘビー', 'HW ヘビーウォーカー', 'M ミサイル溜めロボット']) { c.fillText(t, LX, ly); ly += 20; }

// 保存
(document.getElementById('save') as HTMLButtonElement).onclick = () => {
  const a = document.createElement('a');
  a.download = 'floor1_map.png';
  a.href = cv.toDataURL('image/png');
  a.click();
};
(window as any).__sheetReady = true;
