// 平面図（mapsheet.html）の共通部品。各ステージの図は StageSheet を返す関数で作る。
// 座標：x=東、z=南（北＝-z＝図の上）。1m = px ピクセル。方眼の番地は A,B,C… × 1,2,3…
import type { EnemyKind } from '../../config/balance';
import { ENEMIES } from '../../config/balance';
import { ENEMY_COLOR, ENEMY_INFO, ENEMY_ORDER, enemyNo, enemyNoLabel } from '../../config/enemyInfo';

/** 図に置いた敵1体（表・強調ボタン用） */
export interface PlacedEnemy {
  id: number; kind: EnemyKind; x: number; z: number;
  /** 区画・部屋の名前 */ area: string;
  /** 出方（ポッド・箱・天井から など） */ how: string;
  /** 方眼の番地 */ cell: string;
}
export interface StageSheet {
  canvas: HTMLCanvasElement;
  /** focus＝強調する敵の種類（null＝全部） */
  draw(focus: EnemyKind | null): void;
  placed: PlacedEnemy[];
  fileName: string;
}

export const FONT = '"Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';
export const INK = '#28467a';
export const WALL = '#2b3442';

export const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : 'A' + String.fromCharCode(65 + i - 26));

export interface R2 { x0: number; x1: number; z0: number; z1: number }

/** ワールド座標 → キャンバス座標の変換と、方眼などの描画 */
export class Plot {
  constructor(
    public c: CanvasRenderingContext2D,
    /** 図の左上（キャンバス座標） */ public ox: number, public oy: number,
    public px: number,
    public minX: number, public maxX: number, public minZ: number, public maxZ: number,
    public gridM: number,
  ) {}
  X = (x: number): number => this.ox + (x - this.minX) * this.px;
  Z = (z: number): number => this.oy + (z - this.minZ) * this.px;
  get w(): number { return (this.maxX - this.minX) * this.px; }
  get h(): number { return (this.maxZ - this.minZ) * this.px; }
  cellOf = (x: number, z: number): string => `${colName(Math.floor((x - this.minX) / this.gridM))}${Math.floor((z - this.minZ) / this.gridM) + 1}`;

  rect(b: R2, fill: string | null, stroke?: string, lw = 1): void {
    const { c } = this;
    const x = this.X(b.x0), y = this.Z(b.z0), w = (b.x1 - b.x0) * this.px, h = (b.z1 - b.z0) * this.px;
    if (fill) { c.fillStyle = fill; c.fillRect(x, y, w, h); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.strokeRect(x, y, w, h); }
  }
  /** 方眼と番地（labels=false で線だけ） */
  grid(labels = true, size = 15): void {
    const { c } = this;
    c.font = `bold ${size}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.strokeStyle = 'rgba(40,70,120,0.18)'; c.lineWidth = 1;
    for (let x = this.minX, i = 0; x <= this.maxX + 1e-6; x += this.gridM, i++) {
      c.beginPath(); c.moveTo(this.X(x), this.Z(this.minZ)); c.lineTo(this.X(x), this.Z(this.maxZ)); c.stroke();
      if (labels && x < this.maxX - 1e-6) {
        c.fillStyle = INK;
        c.fillText(colName(i), this.X(x + this.gridM / 2), this.oy - 22);
        c.fillText(colName(i), this.X(x + this.gridM / 2), this.oy + this.h + 22);
      }
    }
    for (let z = this.minZ, j = 1; z <= this.maxZ + 1e-6; z += this.gridM, j++) {
      c.beginPath(); c.moveTo(this.X(this.minX), this.Z(z)); c.lineTo(this.X(this.maxX), this.Z(z)); c.stroke();
      if (labels && z < this.maxZ - 1e-6) {
        c.fillStyle = INK;
        c.fillText(String(j), this.ox - 22, this.Z(z + this.gridM / 2));
        c.fillText(String(j), this.ox + this.w + 22, this.Z(z + this.gridM / 2));
      }
    }
  }
  /** 縮尺バー（左下） */
  scale(meters: number, text: string): void {
    const { c } = this;
    c.fillStyle = INK; c.font = `bold 13px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillRect(this.ox + 10, this.oy + this.h - 18, meters * this.px, 4);
    c.fillText(text, this.ox + 10, this.oy + this.h - 30);
  }
  /** 白地のラベル（中心 x,z） */
  label(text: string, x: number, z: number, color = INK, size = 14, stroke?: string, dy = 0): void {
    tag(this.c, text, this.X(x), this.Z(z) + dy, color, size, stroke);
  }
}

/** 白地のラベル（キャンバス座標） */
export function tag(c: CanvasRenderingContext2D, text: string, x: number, y: number, color = INK, size = 14, stroke?: string): void {
  c.font = `bold ${size}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  const w = c.measureText(text).width + 10, h = size + 8;
  c.fillStyle = 'rgba(255,255,255,0.88)'; c.fillRect(x - w / 2, y - h / 2, w, h);
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.2; c.strokeRect(x - w / 2, y - h / 2, w, h); }
  c.fillStyle = color; c.fillText(text, x, y + 0.5);
}

/** 丸い印（キャンバス座標） */
export function dot(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, label?: string, labelColor = '#fff', size = 12): void {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = fill; c.fill();
  c.lineWidth = 1.5; c.strokeStyle = '#ffffff'; c.stroke();
  if (label) { c.fillStyle = labelColor; c.font = `bold ${size}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, x, y + 0.5); }
}
/** 菱形の印 */
export function diamond(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke: string, label?: string): void {
  c.fillStyle = fill; c.strokeStyle = stroke; c.lineWidth = 2;
  c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath(); c.fill(); c.stroke();
  if (label) { c.fillStyle = stroke; c.font = `bold ${Math.round(r)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, x, y + 0.5); }
}

/** 敵の出方 */
export type EnemyMode = 'pod' | 'drop' | 'box' | 'container' | 'awake' | 'fly' | 'wave' | 'boss';
export const MODE_LABEL: Record<EnemyMode, string> = {
  pod: 'ポッド', drop: '天井から', box: '木箱から', container: 'コンテナから', awake: '最初から起きている', fly: '最初から飛んでいる', wave: 'ウェーブで出現', boss: 'ボス',
};

const BIG: EnemyKind[] = ['heavy', 'heavyWalker', 'missile', 'boss', 'beamer'];

/** 敵の印。中の数字＝図鑑No.、右上の #＝配置の通し番号 */
export function enemyMark(c: CanvasRenderingContext2D, x: number, y: number, kind: EnemyKind, mode: EnemyMode, id: number | null, focus: EnemyKind | null, sub?: string): void {
  const col = ENEMY_COLOR[kind];
  const r = kind === 'boss' ? 17 : BIG.includes(kind) ? 13 : 11;
  c.save();
  c.globalAlpha = focus !== null && focus !== kind ? 0.15 : 1;
  if (focus === kind) { c.beginPath(); c.arc(x, y, r + 9, 0, Math.PI * 2); c.fillStyle = 'rgba(255,214,0,0.45)'; c.fill(); }
  c.lineWidth = 1.5; c.strokeStyle = '#fff';
  if (mode === 'drop' || mode === 'fly' || mode === 'awake' || mode === 'boss') {
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = col; c.fill();
    if (mode === 'drop') { c.setLineDash([3, 2]); c.lineWidth = 2; }
    if (mode === 'boss') { c.lineWidth = 3; c.strokeStyle = '#ffd83a'; }
    c.stroke(); c.setLineDash([]);
    if (mode === 'fly') { c.beginPath(); c.arc(x, y, r + 3.5, 0, Math.PI * 2); c.strokeStyle = col; c.lineWidth = 1.5; c.stroke(); }
  } else {
    c.fillStyle = col; c.fillRect(x - r, y - r, r * 2, r * 2);
    if (mode === 'box') { c.strokeStyle = '#8a5a26'; c.lineWidth = 3.5; c.strokeRect(x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2); }
    else if (mode === 'container') { c.strokeStyle = '#4a5562'; c.lineWidth = 3.5; c.strokeRect(x - r - 2, y - r - 2, r * 2 + 4, r * 2 + 4); c.strokeStyle = '#fff'; c.lineWidth = 1; c.strokeRect(x - r + 1.5, y - r + 1.5, r * 2 - 3, r * 2 - 3); }
    else if (mode === 'wave') { c.setLineDash([4, 2]); c.strokeStyle = '#fff'; c.lineWidth = 2; c.strokeRect(x - r, y - r, r * 2, r * 2); c.setLineDash([]); }
    else c.strokeRect(x - r, y - r, r * 2, r * 2);
  }
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#fff'; c.font = 'bold 13px sans-serif'; c.fillText(String(enemyNo(kind)), x, y + 0.5);
  if (id !== null) {
    c.font = 'bold 10px sans-serif';
    const t = `#${id}`;
    const tw = c.measureText(t).width + 6;
    c.fillStyle = '#111'; c.fillRect(x + r - 2, y - r - 9, tw, 13);
    c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText(t, x + r + 1, y - r - 2);
    c.textAlign = 'center';
  }
  if (sub) { c.fillStyle = '#1f5aa0'; c.font = `bold 10px ${FONT}`; c.fillText(sub, x, y + r + 8); }
  c.restore();
}

/** 凡例（右の欄）。ly を進めながら上から書く */
export class Legend {
  ly: number;
  constructor(public c: CanvasRenderingContext2D, public lx: number, top: number, public maxY: number) { this.ly = top; }
  title(text: string): void {
    const { c } = this; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillStyle = INK; c.font = `bold 20px ${FONT}`; c.fillText(text, this.lx, this.ly); this.ly += 28;
  }
  note(...lines: string[]): void {
    const { c } = this; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.font = `13px ${FONT}`; c.fillStyle = '#555';
    for (const t of lines) { c.fillText(t, this.lx, this.ly); this.ly += 18; }
    this.ly += 8;
  }
  head(text: string, color = INK): void {
    const { c } = this; c.textAlign = 'left'; c.textBaseline = 'middle';
    this.ly += 6; c.fillStyle = color; c.font = `bold 15px ${FONT}`; c.fillText(text, this.lx, this.ly); this.ly += 22;
  }
  item(label: string, icon: (x: number, y: number) => void): void {
    const { c } = this;
    c.save(); icon(this.lx + 9, this.ly); c.restore();
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillStyle = '#222'; c.font = `14px ${FONT}`; c.fillText(label, this.lx + 28, this.ly + 1); this.ly += 25;
  }
  swatch(label: string, fill: string, stroke?: string): void {
    this.item(label, (x, y) => {
      this.c.fillStyle = fill; this.c.fillRect(x - 9, y - 8, 18, 16);
      if (stroke) { this.c.strokeStyle = stroke; this.c.lineWidth = 1.5; this.c.strokeRect(x - 9, y - 8, 18, 16); }
    });
  }
  text(t: string, color = '#222', size = 13): void {
    const { c } = this; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillStyle = color; c.font = `${size}px ${FONT}`; c.fillText(t, this.lx, this.ly); this.ly += size + 5;
  }
  /** 敵の出方の凡例（使っている出方だけ） */
  modes(used: Iterable<EnemyMode>): void {
    const set = new Set(used);
    const order: EnemyMode[] = ['pod', 'box', 'container', 'drop', 'awake', 'fly', 'wave', 'boss'];
    for (const m of order) {
      if (!set.has(m)) continue;
      this.item(`敵（${MODE_LABEL[m]}）`, (x, y) => enemyMark(this.c, x, y, 'crawler', m, null, null));
    }
    this.item('#12 配置の通し番号／中の数字＝図鑑No.', (x, y) => { this.c.fillStyle = '#111'; this.c.fillRect(x - 11, y - 7, 22, 13); });
  }
  /** 敵の種類の一覧（図鑑No.・名前・数） */
  kinds(placed: PlacedEnemy[], focus: EnemyKind | null): void {
    const { c } = this;
    this.head('敵の図鑑番号（このステージの数）');
    for (const k of ENEMY_ORDER) {
      const n = placed.filter((p) => p.kind === k).length;
      if (n === 0) continue;
      c.globalAlpha = focus !== null && focus !== k ? 0.3 : 1;
      c.fillStyle = ENEMY_COLOR[k]; c.fillRect(this.lx, this.ly - 8, 16, 16);
      c.fillStyle = '#fff'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.fillText(String(enemyNo(k)), this.lx + 8, this.ly + 1);
      c.textAlign = 'left'; c.fillStyle = '#222'; c.font = `13px ${FONT}`;
      c.fillText(`${enemyNoLabel(k)} ${ENEMY_INFO[k].name}  ×${n}`, this.lx + 24, this.ly + 1);
      this.ly += 20;
    }
    c.globalAlpha = 1;
  }
  /** 配置一覧（入りきらなければ途中まで） */
  list(placed: PlacedEnemy[], focus: EnemyKind | null): void {
    const { c } = this;
    this.head('配置一覧（#・No.・出方・場所・番地）');
    c.font = `12px ${FONT}`; c.textAlign = 'left';
    for (const p of placed) {
      if (this.ly > this.maxY - 12) { c.globalAlpha = 1; c.fillStyle = '#888'; c.fillText('…（続きは画面下の表）', this.lx, this.ly); break; }
      c.globalAlpha = focus !== null && focus !== p.kind ? 0.3 : 1;
      c.fillStyle = ENEMY_COLOR[p.kind]; c.fillText(`#${p.id}`, this.lx, this.ly);
      c.fillStyle = '#222'; c.fillText(`${enemyNoLabel(p.kind)} ${ENEMY_INFO[p.kind].name}（${p.how}） ${p.area}  ${p.cell}`, this.lx + 34, this.ly);
      this.ly += 16;
    }
    c.globalAlpha = 1;
  }
}

/** 敵が隠れる箱の大きさ（level/spawnBoxes.ts の boxSizeFor と同じ式。three を読み込まないよう写している） */
export function spawnBoxSize(kind: EnemyKind, style?: 'crate' | 'container'): { style: 'crate' | 'container'; w: number; d: number } {
  const big: EnemyKind[] = ['heavy', 'heavyWalker', 'missile', 'beamer', 'boss', 'jumper'];
  const r = ENEMIES[kind].radius;
  const st = style ?? (big.includes(kind) ? 'container' : 'crate');
  if (st === 'container') { const w = Math.max(2.6, r * 2 + 1.0); return { style: st, w, d: w * 1.25 }; }
  const s = Math.max(1.1, r * 2 + 0.5);
  return { style: st, w: s, d: s };
}

/** 新しいキャンバス（白地） */
export function newCanvas(w: number, h: number): { cv: HTMLCanvasElement; c: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w); cv.height = Math.ceil(h);
  const c = cv.getContext('2d')!;
  return { cv, c };
}
