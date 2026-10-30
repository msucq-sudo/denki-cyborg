// 2階（サイボーグ改造室）の平面図。配置データから2Dで描く。方眼＝5m。北が上。
// 印：エレベーター／2つの出口（北の真向かいから左右35°）／手術台／機械（オレンジ）／コンピューター（青）
import { generateFloor2, polar, H, R, T, type MapObj } from '../../level/floor2/plan';
import type { StageSheet } from './common';

export function createFloor2Sheet(): StageSheet {
const PX = 30;            // 1m あたりのピクセル
const PAD = 70;
const GRID = 5;

const plan = generateFloor2();
const MIN = -20, MAX = 22; // 描画範囲（m）。x は -20..20、z は -20..22（エレベーター・出口の通路まで）
const LEGEND_W = 440;
const W = (20 - -20) * PX + PAD * 2 + LEGEND_W;
const Hh = (MAX - MIN) * PX + PAD * 2;
const cv = document.createElement('canvas');
cv.width = W; cv.height = Hh;
const c = cv.getContext('2d')!;
const X = (x: number) => PAD + (x + 20) * PX;
const Z = (z: number) => PAD + (z - MIN) * PX;
const rad = (d: number) => (d * Math.PI) / 180;

c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, Hh);

// 方眼（5m）。列 A.. / 行 1..
c.font = 'bold 14px "Noto Sans JP", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
for (let x = -20, i = 0; x <= 20; x += GRID, i++) {
  c.strokeStyle = 'rgba(40,70,120,0.16)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(X(x), Z(MIN)); c.lineTo(X(x), Z(MAX)); c.stroke();
  if (x < 20) { c.fillStyle = '#28467a'; c.fillText(String.fromCharCode(65 + i), X(x + GRID / 2), PAD / 2); c.fillText(String.fromCharCode(65 + i), X(x + GRID / 2), Hh - PAD / 2); }
}
for (let z = MIN, j = 1; z <= MAX; z += GRID, j++) {
  c.strokeStyle = 'rgba(40,70,120,0.16)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(X(-20), Z(z)); c.lineTo(X(20), Z(z)); c.stroke();
  if (z < MAX) { c.fillStyle = '#28467a'; c.fillText(String(j), PAD / 2, Z(z + GRID / 2)); c.fillText(String(j), X(20) + PAD / 2, Z(z + GRID / 2)); }
}

// 床（円）
c.beginPath(); c.arc(X(0), Z(0), R * PX, 0, Math.PI * 2); c.fillStyle = '#e9edf2'; c.fill();

// 出口の通路・エレベーターのかごの床（フロア）。通路は外向きに伸びる帯
const strip = (x: number, z: number, dirX: number, dirZ: number, w: number, depth: number, fill: string, stroke: string) => {
  c.save();
  c.translate(X(x), Z(z));
  c.rotate(Math.atan2(dirX, -dirZ)); // 上（北）を外向きにそろえる
  c.fillStyle = fill; c.fillRect(-w / 2 * PX, -depth * PX, w * PX, depth * PX);
  c.strokeStyle = stroke; c.lineWidth = 2; c.strokeRect(-w / 2 * PX, -depth * PX, w * PX, depth * PX);
  c.restore();
};
for (const e of plan.exits) strip(e.x, e.z, e.dirX, e.dirZ, e.width, e.depth, '#f3e3e1', '#2b3442');
const el = plan.elevator;
c.fillStyle = 'rgba(140,90,210,0.30)'; c.fillRect(X(el.x0), Z(el.z0), (el.x1 - el.x0) * PX, (el.z1 - el.z0) * PX);
c.strokeStyle = '#7a4ac8'; c.lineWidth = 3; c.strokeRect(X(el.x0), Z(el.z0), (el.x1 - el.x0) * PX, (el.z1 - el.z0) * PX);

// 壁（円弧。出入口で切れる）
c.strokeStyle = '#2b3442'; c.lineWidth = T * PX; c.lineCap = 'butt';
for (const [a, b] of plan.arcs) {
  // 北から時計回り φ → canvas の角度 = φ - 90°
  c.beginPath(); c.arc(X(0), Z(0), (R + T / 2) * PX, rad(a - 90), rad(b - 90)); c.stroke();
}
// エレベーターのかごの壁・出口の通路の壁・封鎖ドア
c.fillStyle = '#2b3442';
c.fillRect(X(-2.8), Z(R + 0.2), 0.8 * PX, 5.0 * PX); c.fillRect(X(2.0), Z(R + 0.2), 0.8 * PX, 5.0 * PX);
c.fillRect(X(-2.8), Z(R + 4.9), 5.6 * PX, 0.5 * PX);
for (const e of plan.exits) {
  c.save();
  c.translate(X(e.x), Z(e.z)); c.rotate(Math.atan2(e.dirX, -e.dirZ));
  c.fillStyle = '#2b3442';
  c.fillRect(-(e.width / 2 + 0.8) * PX, -e.depth * PX, 0.8 * PX, e.depth * PX);
  c.fillRect((e.width / 2) * PX, -e.depth * PX, 0.8 * PX, e.depth * PX);
  c.fillStyle = '#d23c3c'; c.fillRect(-(e.width / 2) * PX, -(e.depth + 0.5) * PX, e.width * PX, 0.5 * PX); // 封鎖ドア
  c.restore();
}

// 方位の目盛り（北から時計回り）
c.font = 'bold 12px "Noto Sans JP", sans-serif'; c.fillStyle = '#6a7a90';
for (let a = 0; a < 360; a += 30) {
  if (plan.gaps.some((g) => Math.abs((((a - g.c) % 360) + 540) % 360 - 180) < 16)) continue;
  const p = polar(R + 2.0, a);
  c.fillText(`${a}°`, X(p.x), Z(p.z));
}

// 物体
const FILL: Record<MapObj['cat'], [string, string]> = {
  machine: ['#f4b266', '#a55a14'], computer: ['#7fb2ee', '#1f5aa0'], bed: ['#ff8a8a', '#b01818'],
};
for (const o of plan.objects) {
  if (o.kind === 'elevator') continue;
  c.save();
  c.translate(X(o.x), Z(o.z));
  c.rotate(-o.ry); // three の Y 回転（反時計・上から見て）→ canvas
  const [f, s] = FILL[o.cat];
  c.fillStyle = f; c.strokeStyle = s; c.lineWidth = 1.5;
  if (o.kind === 'tank') { c.beginPath(); c.arc(0, 0, (o.w / 2) * PX, 0, Math.PI * 2); c.fill(); c.stroke(); }
  else { c.fillRect(-o.w / 2 * PX, -o.d / 2 * PX, o.w * PX, o.d * PX); c.strokeRect(-o.w / 2 * PX, -o.d / 2 * PX, o.w * PX, o.d * PX); }
  c.restore();
}
// 手術台の位置（頭の向き）
{
  const b = plan.bed;
  c.fillStyle = '#b01818'; c.font = 'bold 13px "Noto Sans JP", sans-serif';
  c.fillText('手術台（改造ベッド）', X(0), Z(0) - 1.5 * PX);
  c.font = '11px "Noto Sans JP", sans-serif'; c.fillText('頭→西', X(0), Z(0) + 0.05 * PX);
  c.fillStyle = '#18b6d6'; c.beginPath(); c.arc(X(b.standX), Z(b.standZ), 6, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#0d6f85'; c.font = '11px "Noto Sans JP", sans-serif'; c.fillText('立ち位置（B/Rで休む）', X(b.standX), Z(b.standZ) + 16);
  c.strokeStyle = 'rgba(24,182,214,0.8)'; c.lineWidth = 2; c.setLineDash([5, 4]);
  c.beginPath(); c.arc(X(0), Z(0), b.reach * PX, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
}
// スパーク（研究者）
{
  const s = plan.spark;
  c.fillStyle = '#2faa5c'; c.strokeStyle = '#fff'; c.lineWidth = 2;
  c.beginPath(); c.arc(X(s.x), Z(s.z), 9, 0, Math.PI * 2); c.fill(); c.stroke();
  c.strokeStyle = '#2faa5c'; c.lineWidth = 3; c.beginPath(); c.moveTo(X(s.x), Z(s.z));
  c.lineTo(X(s.x) + Math.sin(s.yaw) * 20, Z(s.z) + Math.cos(s.yaw) * 20); c.stroke();
  c.fillStyle = '#fff'; c.font = 'bold 11px "Noto Sans JP", sans-serif'; c.fillText('Sp', X(s.x), Z(s.z) + 1);
  c.fillStyle = '#1d7a40'; c.font = 'bold 12px "Noto Sans JP", sans-serif'; c.fillText('スパーク', X(s.x) + 34, Z(s.z) - 12);
}
// 機械・コンピューターのラベル（種類ごとに最初の1つだけ、中心から外側へずらして置く）
c.font = '11px "Noto Sans JP", sans-serif';
const labelled = new Set<string>();
for (const o of plan.objects) {
  if (o.cat === 'bed' || o.kind === 'elevator' || o.kind === 'cart' || o.kind === 'iv') continue;
  if (labelled.has(o.kind)) continue;
  labelled.add(o.kind);
  const r = Math.hypot(o.x, o.z) || 1;
  const off = (o.cat === 'computer' ? -1.5 : 1.3);
  const lx = X(o.x + (o.x / r) * off * 1.4), ly = Z(o.z + (o.z / r) * off * 1.0);
  const w = c.measureText(o.label).width + 8;
  c.fillStyle = 'rgba(255,255,255,0.88)'; c.fillRect(lx - w / 2, ly - 8, w, 16);
  c.fillStyle = o.cat === 'computer' ? '#1f5aa0' : '#8a4a10'; c.fillText(o.label, lx, ly);
}

// エレベーター・出口・スタートの注記
const tag = (text: string, x: number, z: number, color: string, size = 15) => {
  c.font = `bold ${size}px "Noto Sans JP", sans-serif`;
  const w = c.measureText(text).width + 12;
  c.fillStyle = 'rgba(255,255,255,0.92)'; c.fillRect(X(x) - w / 2, Z(z) - 12, w, 24);
  c.strokeStyle = color; c.lineWidth = 1.5; c.strokeRect(X(x) - w / 2, Z(z) - 12, w, 24);
  c.fillStyle = color; c.fillText(text, X(x), Z(z));
};
tag('エレベーター', 0, R + 1.6, '#6a3ab8', 13);
for (const e of plan.exits) {
  tag(`${e.label}　真向かい(0°)から${e.offsetFromOpposite > 0 ? '+' : ''}${e.offsetFromOpposite}°`, e.x + e.dirX * 6.6 - (e.dirX > 0 ? 0.5 : -0.5), e.z + e.dirZ * 6.6 - 1.2, '#c02020', 12);
  tag(e.usable ? '→ サージ収容所への道（眠ったあと開く）' : '封鎖中（将来つなぐ）', e.x + e.dirX * 3.2, e.z + e.dirZ * 3.2, e.usable ? '#1d7a40' : '#c02020', 11);
}
// スタート（かごの中）
c.beginPath(); c.arc(X(plan.start.x), Z(plan.start.z), 12, 0, Math.PI * 2); c.fillStyle = '#e02020'; c.fill();
c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke();
c.fillStyle = '#fff'; c.font = 'bold 14px sans-serif'; c.fillText('S', X(plan.start.x), Z(plan.start.z) + 1);
// 北矢印
c.fillStyle = '#28467a'; c.font = 'bold 20px "Noto Sans JP", sans-serif';
c.fillText('N ↑', X(-17.5), Z(-17.5));

// 縮尺
c.textAlign = 'left'; c.font = 'bold 13px "Noto Sans JP", sans-serif';
c.fillStyle = '#28467a'; c.fillRect(X(-19) , Z(MAX) - 18, 5 * PX, 4); c.fillText('5m（方眼1マス）', X(-19), Z(MAX) - 30);

// 凡例
const LX = W - LEGEND_W + 10;
let ly = PAD;
c.fillStyle = '#28467a'; c.font = 'bold 20px "Noto Sans JP", sans-serif'; c.fillText('研究所2階  サイボーグ改造室', LX, ly); ly += 28;
c.font = '13px "Noto Sans JP", sans-serif'; c.fillStyle = '#555';
for (const t of [`円形の部屋（半径${R}m・天井高${H}m）。北が上。`, '方眼1マス＝5m。角度は北から時計回り。', 'エレベーターは南(180°)。出口は北(0°)の左右35°。']) { c.fillText(t, LX, ly); ly += 18; }
ly += 14;
const box = (fill: string, stroke: string, label: string) => {
  c.fillStyle = fill; c.fillRect(LX, ly - 8, 18, 16); c.strokeStyle = stroke; c.lineWidth = 1.5; c.strokeRect(LX, ly - 8, 18, 16);
  c.fillStyle = '#222'; c.font = '14px "Noto Sans JP", sans-serif'; c.fillText(label, LX + 28, ly + 1); ly += 26;
};
box('#2b3442', '#2b3442', '壁・出口の通路');
box('#ff8a8a', '#b01818', '手術台（研究・改造ベッド）');
box('#f4b266', '#a55a14', '機械（ロボットアーム・スキャナー・培養槽 ほか）');
box('#7fb2ee', '#1f5aa0', 'コンピューター（PC・端末・サーバー）');
box('rgba(140,90,210,0.30)', '#7a4ac8', 'エレベーター');
c.fillStyle = '#2faa5c'; c.beginPath(); c.arc(LX + 9, ly, 8, 0, 7); c.fill(); c.fillStyle = '#222'; c.font = '14px "Noto Sans JP", sans-serif'; c.fillText('Sp スパーク（研究者。矢印＝向き）', LX + 28, ly + 1); ly += 26;
box('#d23c3c', '#d23c3c', '出口のドア（西＝サージ収容所への道／東＝封鎖）');
c.fillStyle = '#e02020'; c.beginPath(); c.arc(LX + 9, ly, 8, 0, 7); c.fill(); c.fillStyle = '#222'; c.font = '14px "Noto Sans JP", sans-serif'; c.fillText('S 到着位置（かごの中）', LX + 28, ly + 1); ly += 26;
c.strokeStyle = 'rgba(24,182,214,0.9)'; c.setLineDash([5, 4]); c.lineWidth = 2; c.beginPath(); c.arc(LX + 9, ly, 8, 0, 7); c.stroke(); c.setLineDash([]);
c.fillStyle = '#222'; c.fillText('ベッドの操作範囲（B / R）', LX + 28, ly + 1); ly += 34;
c.fillStyle = '#28467a'; c.font = 'bold 15px "Noto Sans JP", sans-serif'; c.fillText('内訳', LX, ly); ly += 22;
c.font = '13px "Noto Sans JP", sans-serif'; c.fillStyle = '#222';
const count = (cat: MapObj['cat']) => plan.objects.filter((o) => o.cat === cat && o.kind !== 'elevator').length;
c.fillText(`機械 ${count('machine')} 点 ／ コンピューター ${count('computer')} 点`, LX, ly); ly += 18;
const kinds = new Map<string, number>();
for (const o of plan.objects) if (o.cat !== 'bed' && o.kind !== 'elevator') kinds.set(o.label, (kinds.get(o.label) ?? 0) + 1);
for (const [k, n] of kinds) { c.fillText(`・${k} ×${n}`, LX, ly); ly += 17; }

// 敵はいない（強調表示は何もしない）
return { canvas: cv, draw: () => {}, placed: [], fileName: 'floor2_map.png' };
}
