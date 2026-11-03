/**
 * トロッコ面の2Dオーバーレイ（3D画面の上に重ねる透明な canvas）。黄色い照準、ライフ・歯車・進行バー、READY/CLEAR の文字。
 */
import { MC } from './constants';
import type { Stage } from './stage';
import type { McState } from './sim';

export interface OverlayUi {
  pointer: { x: number; y: number } | null;
  /** 画面に出す大きな文言（READY / CLEAR など） */
  banner: string | null;
  hint: boolean;
  /** チェックポイント表示の残り（秒） */
  cpFlash: number;
}

const CYAN = '#38e8ff';
const FONT = '"Noto Sans JP", "M PLUS Rounded 1c", system-ui, sans-serif';

/** 黄色い照準 */
export function drawReticle(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = '#ffe83a'; ctx.fillStyle = '#ffe83a'; ctx.lineWidth = 2.5; ctx.shadowColor = 'rgba(255,232,58,0.8)'; ctx.shadowBlur = 8;
  const r = 14 + Math.sin(t * 5) * 0.6;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.beginPath(); ctx.moveTo(dx * (r - 5), dy * (r - 5)); ctx.lineTo(dx * (r + 8), dy * (r + 8)); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function nutIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = '#c9d3e0'; ctx.strokeStyle = '#5a7aa8'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#3a8fe0'; ctx.beginPath(); ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function gearIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = '#ffd24a'; ctx.strokeStyle = '#a8761a'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, rr = i % 2 === 0 ? r : r * 0.78; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2a1d08'; ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, st: McState, stage: Stage, ui: OverlayUi): void {
  ctx.clearRect(0, 0, w, h);
  const f = (px: number, bold = true) => `${bold ? 'bold ' : ''}${Math.round(px)}px ${FONT}`;
  const u = Math.max(14, Math.min(w, h * 1.6) / 50);
  // 奇襲の予兆（右端の赤い警告）
  if (st.enemies.some((e) => e.alive && e.dormant && e.trigger !== undefined && st.x > e.trigger - 4)) {
    const g = ctx.createLinearGradient(w - 90, 0, w, 0);
    g.addColorStop(0, 'rgba(255,60,60,0)'); g.addColorStop(1, `rgba(255,60,60,${0.3 + 0.25 * Math.sin(st.t * 14)})`);
    ctx.fillStyle = g; ctx.fillRect(w - 90, 0, 90, h);
  }
  // ライフ（バッテリーのコマ）
  ctx.font = f(u * 0.9); ctx.fillStyle = '#9fe9ff'; ctx.fillText('ライフ', 20, 30);
  for (let i = 0; i < MC.hp; i++) {
    ctx.fillStyle = i < st.hp ? CYAN : '#1b2a33'; ctx.strokeStyle = '#9fe9ff'; ctx.lineWidth = 2;
    ctx.fillRect(20 + i * (u * 1.5), 40, u * 1.2, u * 0.8); ctx.strokeRect(20 + i * (u * 1.5), 40, u * 1.2, u * 0.8);
  }
  // メタル（ふつうの回収物）と歯車（レア）
  nutIcon(ctx, w - 170, 34, u * 0.95);
  ctx.font = f(u * 1.4); ctx.fillStyle = '#c9e4ff'; ctx.textAlign = 'right';
  ctx.fillText(`× ${st.metal}`, w - 24, 50);
  gearIcon(ctx, w - 170, 74, u * 0.75);
  ctx.font = f(u * 0.95); ctx.fillStyle = st.gears > 0 ? '#ffd24a' : '#8a8f98';
  ctx.fillText(`歯車 ${st.gears}/${stage.gears.length}`, w - 24, 82);
  ctx.textAlign = 'left';
  // 進行バー
  const bw = Math.min(w * 0.4, 520), bx = (w - bw) / 2, by = 22;
  ctx.fillStyle = 'rgba(10,20,30,0.7)'; ctx.fillRect(bx, by, bw, 8);
  ctx.fillStyle = CYAN; ctx.fillRect(bx, by, bw * Math.min(1, st.x / stage.goalX), 8);
  ctx.fillStyle = '#ff9a2e';
  for (const c of stage.checks) ctx.fillRect(bx + bw * (c / stage.goalX) - 1, by - 3, 2, 14);
  ctx.strokeStyle = '#9fe9ff'; ctx.strokeRect(bx, by, bw, 8);
  if (ui.cpFlash > 0) { ctx.font = f(u); ctx.fillStyle = `rgba(56,232,255,${Math.min(1, ui.cpFlash)})`; ctx.textAlign = 'center'; ctx.fillText('チェックポイント', w / 2, by + 36); ctx.textAlign = 'left'; }
  if (ui.hint) {
    ctx.font = f(u * 0.85, false); ctx.fillStyle = 'rgba(200,235,255,0.9)'; ctx.textAlign = 'center';
    ctx.fillText('Space：ジャンプ　S / Ctrl / C：しゃがむ（押している間）　マウス：照準　左クリック：撃つ　Esc：やめる', w / 2, h - 24);
    ctx.textAlign = 'left';
  }
  if (ui.banner) {
    ctx.font = f(u * 3.2); ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(ui.banner, w / 2 + 3, h * 0.38 + 3);
    ctx.fillStyle = '#fff'; ctx.fillText(ui.banner, w / 2, h * 0.38);
    ctx.textAlign = 'left';
  }
  if (ui.pointer) drawReticle(ctx, ui.pointer.x, ui.pointer.y, st.t);
}
