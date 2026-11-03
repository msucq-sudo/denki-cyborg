/**
 * トロッコ面の全体マップ画像（2D canvas）。ステージデータから、横から見た全景を複数行に分けて描く。
 * 段差・坂（レールの高さ）、壁、ギャップ（余裕つき）、天井の機材、敵、歯車、連続ジャンプの区間とビート名を載せる。
 * 生成: .logs/minecart-capture.mjs → docs/minecart-stage.png
 */
import { MAX_GAP, MC } from './constants';
import { BEATS, type Stage } from './stage';
import { slopeMult } from './sim';

export const OVERVIEW = { rowLen: 130, px: 13, margin: 64, rowH: 300, headH: 120, yMax: 9.2, yMin: -3 };

/** 見出し部分の高さ（凡例＋歯車の取り方の一覧） */
const headHeight = (stage: Stage): number => OVERVIEW.headH + stage.gears.length * 17 + 30;

export function overviewSize(stage: Stage): { w: number; h: number; rows: number } {
  const total = stage.goalX + 30;
  const rows = Math.ceil(total / OVERVIEW.rowLen);
  return { w: Math.round(OVERVIEW.rowLen * OVERVIEW.px + OVERVIEW.margin * 2), h: rows * OVERVIEW.rowH + headHeight(stage), rows };
}

const FONT = '"Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';
const font = (px: number, bold = false) => `${bold ? 'bold ' : ''}${px}px ${FONT}`;
const C = { cyan: '#38e8ff', orange: '#ff9a2e', gold: '#ffd24a', red: '#ff5a5a', rail: '#9fb0c2', steel: '#26323f', steelHi: '#3a4a5c' };

export function drawOverview(ctx: CanvasRenderingContext2D, stage: Stage): void {
  const { w, h, rows } = overviewSize(stage);
  ctx.fillStyle = '#05080d'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e8f6ff'; ctx.font = font(26, true);
  ctx.fillText('トロッコ面 全体マップ（ドレイン装置への道）', OVERVIEW.margin, 38);
  ctx.font = font(14); ctx.fillStyle = '#8fb4c8';
  ctx.fillText(`全長 ${stage.goalX}　速度 ${MC.speed}/s（約${Math.round(stage.goalX / MC.speed)}秒）　平地の最大ギャップ ${MAX_GAP.toFixed(2)}　ジャンプ頂点 ${(MC.jumpV ** 2 / (2 * MC.gravity)).toFixed(1)}　メタル ${stage.metals.length}　歯車(レア) ${stage.gears.length}　ドローン ${stage.drones.length}　ガンナー ${stage.gunners.length}　壁 ${stage.walls.length}　チェックポイント ${stage.checks.length}`, OVERVIEW.margin, 62);
  // 凡例
  const items: [string, () => void][] = [
    ['レール/台', () => { ctx.fillStyle = C.steelHi; ctx.fillRect(0, -4, 22, 12); ctx.fillStyle = C.rail; ctx.fillRect(0, -6, 22, 3); }],
    ['壁（跳ぶ）', () => { ctx.fillStyle = '#8a5a2a'; ctx.fillRect(0, -12, 12, 16); ctx.fillStyle = '#d9b300'; ctx.fillRect(0, -12, 12, 4); }],
    ['低い機材（しゃがむ）', () => { ctx.fillStyle = '#26323f'; ctx.fillRect(0, -14, 20, 10); ctx.fillStyle = '#d9b300'; ctx.fillRect(0, -4, 20, 3); }],
    ['ガンナー（撃てない）', () => { ctx.fillStyle = '#c9772a'; ctx.fillRect(0, -14, 12, 16); }],
    ['ドローン', () => { gearDrone(ctx, 8, -5, 7); }],
    ['奇襲の出現点', () => { ctx.strokeStyle = C.red; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(8, -5, 8, 0, 7); ctx.stroke(); ctx.setLineDash([]); }],
    ['メタル（ふつう）', () => metalIcon(ctx, 8, -5, 6)],
    ['歯車（レア・寄り道）', () => { gearIcon(ctx, 8, -5, 8.5); ctx.strokeStyle = 'rgba(255,210,74,0.8)'; ctx.beginPath(); ctx.arc(8, -5, 12, 0, 7); ctx.stroke(); }],
    ['歯車ルート', () => { ctx.strokeStyle = C.orange; ctx.setLineDash([4, 3]); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(10, 0, 10, Math.PI, 0); ctx.stroke(); ctx.setLineDash([]); }],
    ['最大ジャンプ軌道', () => { ctx.strokeStyle = 'rgba(255,232,58,0.85)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(9, 0, 9, Math.PI, 0); ctx.stroke(); ctx.setLineDash([]); }],
    ['チェックポイント', () => { ctx.fillStyle = C.cyan; ctx.fillRect(2, -14, 2, 16); ctx.fillRect(4, -14, 10, 7); }],
  ];
  let lx = OVERVIEW.margin;
  for (const [label, draw] of items) {
    ctx.save(); ctx.translate(lx, 94); draw(); ctx.restore();
    ctx.fillStyle = '#cfe6f2'; ctx.font = font(13); ctx.fillText(label, lx + 26, 96);
    lx += 26 + ctx.measureText(label).width + 26;
  }

  ctx.font = font(13, true); ctx.fillStyle = C.gold; ctx.fillText('歯車の取り方（ふつうに走るだけでは取れない。取らなくてもクリアできる）', OVERVIEW.margin, 126);
  ctx.font = font(12);
  stage.gears.forEach((g, i) => { ctx.fillStyle = '#ffe9a8'; ctx.fillText(`★${i + 1}  x=${g.x.toFixed(1)}  ${g.how}`, OVERVIEW.margin + 8, 145 + i * 17); });

  for (let r = 0; r < rows; r++) drawRow(ctx, stage, r);
}

function metalIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = '#c9d3e0'; ctx.strokeStyle = '#5a7aa8'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#3a8fe0'; ctx.beginPath(); ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function gearIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = C.gold; ctx.strokeStyle = '#a8761a'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, rr = i % 2 === 0 ? r : r * 0.78; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2a1d08'; ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function gearDrone(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = '#2d3a4a'; ctx.strokeStyle = C.cyan; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(-r * 0.25, 0, r * 0.38, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawRow(ctx: CanvasRenderingContext2D, stage: Stage, r: number): void {
  const { rowLen, px, margin, rowH, yMax, yMin } = OVERVIEW;
  const headH = headHeight(stage);
  const rx0 = r * rowLen, rx1 = rx0 + rowLen;
  const top = headH + r * rowH;
  const X = (x: number) => margin + (x - rx0) * px;
  const oy = top + 56 + yMax * px;
  const Y = (y: number) => oy - y * px;
  const inRow = (a: number, b = a) => b >= rx0 - 2 && a <= rx1 + 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(margin - 2, top, rowLen * px + 4, rowH - 10); ctx.clip();
  const bg = ctx.createLinearGradient(0, top, 0, top + rowH);
  bg.addColorStop(0, '#0b141e'); bg.addColorStop(1, '#06090f');
  ctx.fillStyle = bg; ctx.fillRect(margin - 2, top, rowLen * px + 4, rowH);
  // 目盛りの縦線と高さの罫線
  ctx.strokeStyle = 'rgba(56,232,255,0.06)'; ctx.lineWidth = 1;
  for (let x = Math.ceil(rx0 / 10) * 10; x <= rx1; x += 10) { ctx.beginPath(); ctx.moveTo(X(x), top + 40); ctx.lineTo(X(x), Y(yMin)); ctx.stroke(); }
  ctx.font = font(10); ctx.fillStyle = 'rgba(160,200,220,0.5)';
  for (let y = 0; y <= 8; y += 2) { ctx.strokeStyle = 'rgba(160,200,220,0.12)'; ctx.beginPath(); ctx.moveTo(X(rx0), Y(y)); ctx.lineTo(X(rx1), Y(y)); ctx.stroke(); ctx.fillText(`y${y}`, margin + 2, Y(y) - 2); }

  // ---- 台（高さのあるレールは床まで続く鉄骨）とレール
  for (const rl of stage.rails) {
    if (!inRow(rl.x0, rl.x1)) continue;
    const high = Math.max(rl.y0, rl.y1) > 0.3 && !rl.upper;
    if (rl.upper) {
      ctx.fillStyle = '#3a4a5c'; ctx.fillRect(X(rl.x0), Y(rl.y0), (rl.x1 - rl.x0) * px, (rl.thick ?? 0.4) * px);
      ctx.fillStyle = C.gold; ctx.fillRect(X(rl.x0), Y(rl.y0) + (rl.thick ?? 0.4) * px, (rl.x1 - rl.x0) * px, 2);
      ctx.fillStyle = '#2a3441'; for (const px0 of [rl.x0 + 0.5, rl.x1 - 0.5]) ctx.fillRect(X(px0) - 2, Y(rl.y0) + (rl.thick ?? 0.4) * px, 4, (rl.y0 - yMin) * px);
    } else if (high) {
      ctx.fillStyle = '#1f2a37';
      ctx.beginPath(); ctx.moveTo(X(rl.x0), Y(rl.y0)); ctx.lineTo(X(rl.x1), Y(rl.y1)); ctx.lineTo(X(rl.x1), Y(yMin)); ctx.lineTo(X(rl.x0), Y(yMin)); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = C.steelHi; ctx.lineWidth = 1; ctx.stroke();
    } else {
      ctx.fillStyle = '#2a3441';
      for (let x = Math.ceil(rl.x0 / 6) * 6; x <= rl.x1; x += 6) ctx.fillRect(X(x) - 2, Y(rl.y0) + 4, 4, 28);
    }
    ctx.strokeStyle = C.rail; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(X(rl.x0), Y(rl.y0)); ctx.lineTo(X(rl.x1), Y(rl.y1)); ctx.stroke();
    // 段差の壁の面
    if (rl.upper && inRow(rl.x0)) {
      // 歯車ルート：下段から高く跳び乗る軌道（点線）
      const tEnd = (MC.jumpV + Math.sqrt(MC.jumpV ** 2 - 2 * MC.gravity * rl.y0)) / MC.gravity;
      const xt = rl.x0 - MC.wheel - MC.speed * tEnd;
      ctx.strokeStyle = C.orange; ctx.setLineDash([5, 4]); ctx.lineWidth = 2.5; ctx.beginPath();
      for (let i = 0; i <= 28; i++) { const tt = (i / 28) * tEnd; const ax = xt + MC.speed * tt, ay = MC.jumpV * tt - 0.5 * MC.gravity * tt * tt; if (i === 0) ctx.moveTo(X(ax), Y(ay)); else ctx.lineTo(X(ax), Y(ay)); }
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.orange; ctx.font = font(12, true); ctx.fillText(`歯車ルート（ここで跳ぶ x≈${xt.toFixed(0)}）`, X(xt) - 10, Y(rl.y0 + 1.6));
      ctx.fillStyle = '#ffd7a0'; ctx.font = font(11); ctx.fillText(`上段 y=${rl.y0.toFixed(1)}（端から下段へ落ちて合流）`, X(rl.x0), Y(rl.y0) - 8);
    }
    if (rl.face && inRow(rl.x0)) {
      const prev = stage.rails.find((q) => q.x1 === rl.x0);
      if (prev && rl.y0 > prev.y1 + 0.05) {
        ctx.fillStyle = C.orange; ctx.fillRect(X(rl.x0) - 3, Y(rl.y0), 3, (rl.y0 - prev.y1) * px);
        ctx.fillStyle = '#ffd7a0'; ctx.font = font(12, true); ctx.textAlign = 'center';
        ctx.fillText(`段差の壁 +${(rl.y0 - prev.y1).toFixed(1)}`, X(rl.x0) - 6, Y(rl.y0) - 8);
        ctx.textAlign = 'left';
      } else if (prev && rl.y0 < prev.y1 - 0.05) {
        ctx.fillStyle = '#9fd0e6'; ctx.font = font(11); ctx.textAlign = 'center';
        ctx.fillText(`落ちる ${(rl.y0 - prev.y1).toFixed(1)}`, X(rl.x0), Y(prev.y1) - 8);
        ctx.textAlign = 'left';
      }
    }
    // 坂
    if (Math.abs(rl.y1 - rl.y0) > 0.5 && inRow(rl.x0, rl.x1)) {
      const grade = (rl.y1 - rl.y0) / (rl.x1 - rl.x0);
      ctx.fillStyle = grade > 0 ? '#ffb27a' : '#7affc8'; ctx.font = font(12, true); ctx.textAlign = 'center';
      ctx.fillText(`${grade > 0 ? '上り坂' : '下り坂'} 速度×${slopeMult(grade).toFixed(2)}`, X((rl.x0 + rl.x1) / 2), Y((rl.y0 + rl.y1) / 2) - 14);
      ctx.textAlign = 'left';
    }
  }
  // ---- ギャップ（落下ゾーンと最大ジャンプ軌道）
  for (const g of stage.gaps) {
    if (!inRow(g.x0, g.x1)) continue;
    const left = stage.rails.find((q) => q.x1 === g.x0), right = stage.rails.find((q) => q.x0 === g.x1);
    const yl = left ? left.y1 : 0;
    ctx.fillStyle = 'rgba(255,60,60,0.14)'; ctx.fillRect(X(g.x0), Y(yMax - 2), (g.x1 - g.x0) * px, Y(yMin) - Y(yMax - 2));
    ctx.strokeStyle = 'rgba(255,232,58,0.85)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.beginPath();
    const tAir = (2 * MC.jumpV) / MC.gravity;
    for (let i = 0; i <= 24; i++) {
      const tt = (i / 24) * tAir, ax = g.x0 + MC.wheel + MC.speed * tt, ay = yl + MC.jumpV * tt - 0.5 * MC.gravity * tt * tt;
      if (i === 0) ctx.moveTo(X(ax), Y(ay)); else ctx.lineTo(X(ax), Y(ay));
    }
    ctx.stroke(); ctx.setLineDash([]);
    const gw = g.x1 - g.x0;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd7d7'; ctx.font = font(12, true);
    ctx.fillText(`ギャップ ${gw.toFixed(1)}`, X((g.x0 + g.x1) / 2), Y(-1.0));
    const margin2 = MAX_GAP - gw;
    ctx.fillStyle = margin2 < 0.8 ? '#ff9a9a' : '#ffe9a8'; ctx.font = font(11);
    ctx.fillText(margin2 < 0 ? `下り坂の勢いが必要` : `余裕 ${margin2.toFixed(2)}${margin2 < 0.8 ? '（ぎりぎり）' : ''}`, X((g.x0 + g.x1) / 2), Y(-1.8));
    if (right && right.y0 > yl + 0.3) { ctx.fillStyle = '#ffd7a0'; ctx.fillText(`着地先 +${(right.y0 - yl).toFixed(1)}`, X(g.x1) + 24, Y(right.y0) - 8); }
    ctx.textAlign = 'left';
  }
  // ---- 壁
  for (const wl of stage.walls) {
    if (!inRow(wl.x0, wl.x1)) continue;
    ctx.fillStyle = wl.kind === 'bulkhead' ? '#5a6878' : wl.kind === 'wreck' ? '#4a5260' : '#8a5a2a';
    ctx.fillRect(X(wl.x0), Y(wl.top), (wl.x1 - wl.x0) * px, wl.h * px);
    ctx.fillStyle = '#d9b300'; ctx.fillRect(X(wl.x0), Y(wl.top), (wl.x1 - wl.x0) * px, 5);
    ctx.fillStyle = '#ffd7a0'; ctx.font = font(11, true); ctx.textAlign = 'center';
    ctx.fillText(`壁 ${wl.h.toFixed(1)}`, X(wl.x), Y(wl.top) - 6);
    ctx.textAlign = 'left';
  }
  // ---- 天井の機材
  for (const c of stage.ceils) {
    if (!inRow(c.x0, c.x1)) continue;
    const x0 = X(c.x0), wpx = (c.x1 - c.x0) * px;
    ctx.fillStyle = 'rgba(80,100,125,0.35)'; ctx.fillRect(x0, Y(c.bottom + 4), wpx, 4 * px);
    ctx.fillStyle = '#26323f'; ctx.fillRect(x0, Y(c.bottom + 1.4), wpx, 1.4 * px);
    ctx.strokeStyle = 'rgba(56,232,255,0.6)'; ctx.strokeRect(x0, Y(c.bottom + 1.4), wpx, 1.4 * px);
    ctx.fillStyle = '#d9b300'; ctx.fillRect(x0, Y(c.bottom) - 3, wpx, 3);
    ctx.fillStyle = '#cfe6f2'; ctx.font = font(10);
    if (wpx > 40) ctx.fillText(`${({ monitor: 'モニター', pipe: '配管', tank: 'タンク', cable: 'ケーブル', rack: 'ラック' })[c.kind]} ${c.rel.toFixed(2)}`, x0 + 3, Y(c.bottom + 0.4));
  }
  // ---- チェックポイント・ゴール
  for (const cx of stage.checks) if (cx >= rx0 && cx < rx1) {
    const y = stage.rails.find((q) => cx >= q.x0 && cx <= q.x1)?.y0 ?? 0;
    ctx.fillStyle = C.cyan; ctx.fillRect(X(cx), Y(y + 3), 2, 3 * px); ctx.fillRect(X(cx) + 2, Y(y + 3), 12, 8);
    ctx.font = font(10); ctx.fillText(`CP ${cx}`, X(cx) + 4, Y(y + 3) - 3);
  }
  if (stage.goalX >= rx0 - 2 && stage.goalX < rx1 + 2) {
    const gy = stage.rails[stage.rails.length - 1].y1;
    ctx.strokeStyle = C.cyan; ctx.lineWidth = 3; ctx.strokeRect(X(stage.goalX), Y(gy + 5.5), 3.6 * px, 5.5 * px);
    ctx.fillStyle = C.cyan; ctx.font = font(13, true); ctx.fillText('GOAL ドレイン装置室', X(stage.goalX) - 20, Y(gy + 5.5) - 6);
  }
  // ---- メタル（ふつう）と歯車（レア・★番号つき）
  for (const m of stage.metals) if (m.x >= rx0 && m.x < rx1) metalIcon(ctx, X(m.x), Y(m.y), 4.6);
  stage.gears.forEach((g, i) => {
    if (g.x < rx0 || g.x >= rx1) return;
    ctx.strokeStyle = 'rgba(255,210,74,0.85)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(g.x), Y(g.y), 15, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    gearIcon(ctx, X(g.x), Y(g.y), 9);
    ctx.fillStyle = C.gold; ctx.font = font(13, true); ctx.textAlign = 'center'; ctx.fillText(`★${i + 1}`, X(g.x), Y(g.y) - 19); ctx.textAlign = 'left';
  });
  // ---- 敵
  for (const e of stage.drones) {
    if (e.trigger !== undefined) {
      const ex = e.trigger + MC.ambushAhead;
      if (!inRow(ex)) continue;
      ctx.save(); ctx.globalAlpha = 0.7; gearDrone(ctx, X(ex), Y(e.y), MC.droneRadius * px); ctx.restore();
      ctx.strokeStyle = C.red; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(ex), Y(e.y), MC.droneRadius * px * 1.6, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,90,90,0.9)'; ctx.beginPath(); ctx.moveTo(X(ex), Y(e.y)); ctx.lineTo(X(ex + e.vx * 1.0), Y(e.y)); ctx.stroke();
      ctx.fillStyle = '#ff9a9a'; ctx.font = font(11); ctx.fillText(`奇襲 x>${e.trigger}`, X(ex) - 18, Y(e.y) - 14);
    } else if (inRow(e.x)) {
      gearDrone(ctx, X(e.x), Y(e.y), MC.droneRadius * px);
      if (e.vx !== 0) { ctx.strokeStyle = 'rgba(255,90,90,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(e.x), Y(e.y)); ctx.lineTo(X(e.x + e.vx * 1.0), Y(e.y)); ctx.stroke(); }
    }
  }
  for (const gu of stage.gunners) if (inRow(gu.x)) {
    ctx.fillStyle = '#c9772a'; ctx.fillRect(X(gu.x) - 0.5 * px, Y(gu.y + MC.gunnerH), px, MC.gunnerH * px);
    ctx.fillStyle = '#e6a050'; ctx.fillRect(X(gu.x) - 0.62 * px, Y(gu.y + MC.gunnerH * 0.95), 0.2 * px, MC.gunnerH * 0.95 * px);
    ctx.strokeStyle = 'rgba(255,154,46,0.6)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(gu.x - MC.gunnerRange), Y(gu.y + MC.gunnerBulletY)); ctx.lineTo(X(gu.x), Y(gu.y + MC.gunnerBulletY)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffd7a0'; ctx.font = font(11, true); ctx.textAlign = 'center'; ctx.fillText('ガンナー', X(gu.x), Y(gu.y + MC.gunnerH) - 5); ctx.textAlign = 'left';
  }
  ctx.restore();

  // ---- 連続ジャンプのくくり
  const gs = stage.gaps;
  for (let i = 0; i < gs.length; i++) {
    let j = i;
    while (j + 1 < gs.length && gs[j + 1].x0 - gs[j].x1 <= 5.2) j++;
    if (j > i && gs[i].x0 >= rx0 && gs[i].x0 < rx1) {
      const a = X(gs[i].x0), b = X(Math.min(gs[j].x1, rx1)), yy = top + 52;
      ctx.strokeStyle = C.orange; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a, yy + 6); ctx.lineTo(a, yy); ctx.lineTo(b, yy); ctx.lineTo(b, yy + 6); ctx.stroke();
      ctx.fillStyle = C.orange; ctx.font = font(12, true); ctx.fillText(`連続ジャンプ ×${j - i + 1}（着地してすぐ跳ぶ）`, a + 4, yy - 4);
    }
    i = j;
  }
  const ws = [...stage.walls].sort((a, b) => a.x - b.x);
  ws.forEach((wl, k) => {
    const nx = ws[k + 1];
    if (nx && nx.x - wl.x <= 8 && wl.x >= rx0 && nx.x < rx1) {
      const yy = top + 52;
      ctx.strokeStyle = C.orange; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(wl.x), yy + 6); ctx.lineTo(X(wl.x), yy); ctx.lineTo(X(nx.x), yy); ctx.lineTo(X(nx.x), yy + 6); ctx.stroke();
      ctx.fillStyle = C.orange; ctx.font = font(12, true); ctx.fillText('壁→壁（連続）', X(wl.x) + 4, yy - 4);
    }
  });

  // ---- ビート帯
  const by = top + 4;
  BEATS.forEach((b, i) => {
    const a = Math.max(b.x0, rx0), z = Math.min(b.x1, rx1);
    if (z <= a) return;
    ctx.fillStyle = i % 2 ? 'rgba(56,232,255,0.16)' : 'rgba(255,154,46,0.16)';
    ctx.fillRect(X(a), by, (z - a) * px, 34);
    ctx.strokeStyle = i % 2 ? 'rgba(56,232,255,0.7)' : 'rgba(255,154,46,0.7)'; ctx.lineWidth = 1; ctx.strokeRect(X(a), by, (z - a) * px, 34);
    ctx.save(); ctx.beginPath(); ctx.rect(X(a), by, (z - a) * px, 34); ctx.clip();
    ctx.fillStyle = '#f2fbff'; ctx.font = font(13, true); ctx.fillText(b.label, X(a) + 6, by + 15);
    ctx.fillStyle = '#b5d3e2'; ctx.font = font(10); ctx.fillText(b.note, X(a) + 6, by + 28);
    ctx.restore();
  });
  // ---- 定規
  const ry = Y(yMin) + 4;
  ctx.fillStyle = '#0d1620'; ctx.fillRect(margin, ry, rowLen * px, 24);
  ctx.strokeStyle = '#6fa3bd'; ctx.fillStyle = '#9fd0e6'; ctx.font = font(11); ctx.lineWidth = 1;
  for (let x = Math.ceil(rx0 / 5) * 5; x <= rx1; x += 5) {
    const px0 = X(x), major = x % 20 === 0;
    ctx.beginPath(); ctx.moveTo(px0, ry); ctx.lineTo(px0, ry + (major ? 9 : 5)); ctx.stroke();
    if (major) { ctx.textAlign = 'center'; ctx.fillText(String(x), px0, ry + 21); ctx.textAlign = 'left'; }
  }
}
