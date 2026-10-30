// サージ収容所 1階（?level=camp1）の平面図。level/camp1/plan.ts のデータから描く。方眼＝10m
import type { EnemyKind } from '../../config/balance';
import { diagonalSpan, generateCamp1, type SpawnDef } from '../../level/camp1/plan';
import {
  Legend, Plot, WALL, dot, diamond, enemyMark, newCanvas, spawnBoxSize, FONT, INK,
  type EnemyMode, type PlacedEnemy, type StageSheet,
} from './common';

export function createCamp1Sheet(): StageSheet {
  const plan = generateCamp1();
  const PX = 12, PAD = 70, LEGEND_W = 420;
  const minX = -10, maxX = 120, minZ = -10, maxZ = 80;
  const W = (maxX - minX) * PX + PAD * 2 + LEGEND_W;
  const H = Math.max((maxZ - minZ) * PX + PAD * 2, 1500);
  const { cv, c } = newCanvas(W, H);
  const P = new Plot(c, PAD, PAD, PX, minX, maxX, minZ, maxZ, 10);
  const { X, Z } = P;

  // 敵（ゾーン順。wave2＝閉じ込め戦の第2波）
  interface E { p: PlacedEnemy; mode: EnemyMode; sub?: string }
  const enemies: E[] = [];
  const modeOf = (s: SpawnDef, wave2: boolean): EnemyMode => {
    const m = s.mode ?? (s.kind === 'drone' ? 'drop' : 'box');
    if (m === 'drop') return 'drop';
    if (m === 'awake') return 'awake';
    if (m === 'pod') return 'pod';
    return wave2 ? 'container' : spawnBoxSize(s.kind).style === 'container' ? 'container' : 'box';
  };
  const MODE_TXT: Record<string, string> = { drop: '天井から', awake: '起きている', pod: 'ポッド', box: '木箱から', container: 'コンテナから' };
  for (const z of plan.zones) {
    const add = (s: SpawnDef, wave2: boolean) => {
      const mode = modeOf(s, wave2);
      const fl = s.floor ?? 0;
      const sub = [fl < 0 ? '地下' : fl > 0 ? '高台' : '', wave2 ? '第2波' : ''].filter(Boolean).join('・') || undefined;
      const trapTxt = z.mode === 'trap' && !wave2 ? '・閉じ込め戦' : '';
      enemies.push({
        mode, sub,
        p: { id: enemies.length + 1, kind: s.kind, x: s.x, z: s.z, area: z.name, cell: P.cellOf(s.x, s.z), how: MODE_TXT[mode] + (sub ? `・${sub}` : '') + trapTxt },
      });
    };
    for (const s of z.spawns) add(s, false);
    for (const s of z.wave2 ?? []) add(s, true);
  }

  const circleRooms = new Set(['E', 'I']);
  const diag = diagonalSpan();

  function draw(focus: EnemyKind | null): void {
    c.globalAlpha = 1;
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);

    // 地下通路（床 -5m）。地上の床より先に、紫の点線で
    const t = plan.tunnel;
    P.rect(t, 'rgba(150,110,220,0.12)');
    // 部屋の床
    for (const r of plan.rooms) {
      if (circleRooms.has(r.id)) {
        c.beginPath(); c.arc(X((r.x0 + r.x1) / 2), Z((r.z0 + r.z1) / 2), ((r.x1 - r.x0) / 2) * PX, 0, Math.PI * 2);
        c.fillStyle = '#e9edf2'; c.fill();
      } else P.rect(r, '#e9edf2');
    }
    // 通路の床（壁の間）：部屋以外の床は、壁を描いた後の白との差で分かるよう薄く
    const corr: [number, number, number, number][] = [
      [17, 23, 31, 55], [31.2, 48, 11, 16], [62, 67, 25, 32], [90, 95, 51, 57], [38, 50, 63, 68], [68, 79, 63, 68], [92, 100, 28, 31], [103, 109, -4, 2],
    ];
    for (const [x0, x1, z0, z1] of corr) P.rect({ x0, x1, z0, z1 }, '#eef1f5');
    // 斜め通路（E→I）
    c.save(); c.strokeStyle = '#e9edf2'; c.lineWidth = 6 * PX; c.lineCap = 'butt';
    c.beginPath(); c.moveTo(X(diag.x0), Z(diag.z0)); c.lineTo(X(diag.x1), Z(diag.z1)); c.stroke(); c.restore();
    c.save(); c.strokeStyle = WALL; c.lineWidth = 1.2 * PX;
    for (const off of [-3.6, 3.6]) {
      const ox = -off * Math.SQRT1_2, oz = off * Math.SQRT1_2;
      c.beginPath(); c.moveTo(X(diag.x0 + ox), Z(diag.z0 + oz)); c.lineTo(X(diag.x1 + ox), Z(diag.z1 + oz)); c.stroke();
    }
    c.restore();

    P.grid();

    // 地下通路の壁（点線）と段
    for (const b of plan.boxes) {
      if (b.y1 > -0.5 || !b.col) continue;
      if (b.tag === 'wall') { c.save(); c.setLineDash([5, 3]); P.rect(b, 'rgba(120,80,200,0.35)', '#6a3ab8', 1); c.restore(); }
      if (b.tag === 'step') P.rect(b, 'rgba(120,80,200,0.25)', '#6a3ab8');
    }
    // 高台・キャットウォーク
    for (const b of plan.boxes) if (b.col && b.tag === 'catwalk') P.rect(b, 'rgba(90,170,230,0.30)', 'rgba(40,110,180,0.7)');
    // 家具・木箱・遮蔽物
    for (const b of plan.boxes) {
      if (!b.col || b.y0 < -0.5) continue;
      if (b.tag === 'crate') P.rect(b, '#c9a36b', '#7a5a2c');
      else if (b.tag === 'desk' || b.tag === 'panel' || b.tag === 'cover' || b.tag === 'battery' || b.tag === 'source') P.rect(b, '#9aa5b4', '#4a5562');
      else if (b.tag === 'pillar') P.rect(b, '#4a5562');
    }
    // 壁（床から立ち上がるもの。円形の部屋の当たり判定の輪は描かず、円弧で描く）
    for (const b of plan.boxes) {
      if (!b.col || b.tag !== 'wall' || b.m === 'hidden') continue;
      if (b.y0 > 0.5 || b.y0 < -0.5 || b.y1 - b.y0 < 3) continue;
      P.rect(b, WALL);
    }
    c.save(); c.strokeStyle = WALL; c.lineWidth = 1.2 * PX; c.lineCap = 'butt';
    for (const a of plan.arcs) {
      if (a.y0 !== 0) continue;
      c.beginPath(); c.arc(X(a.cx), Z(a.cz), (a.r + 0.6) * PX, a.a0, a.a1); c.stroke();
    }
    c.restore();

    // ハッチ（床の穴）
    {
      const h = plan.hatch;
      P.rect(h, '#222'); c.save(); c.strokeStyle = '#ffd83a'; c.lineWidth = 3; c.setLineDash([6, 4]);
      c.strokeRect(X(h.x0) - 2, Z(h.z0) - 2, (h.x1 - h.x0) * PX + 4, (h.z1 - h.z0) * PX + 4); c.restore();
      P.label('ハッチ（ソケットで開く→地下へ）', (h.x0 + h.x1) / 2 + 7, h.z0 - 1.4, '#7a5a00', 11, '#c9a000');
    }
    // 天井の隠し通路（ダクト）
    {
      const d = plan.duct;
      c.save(); c.setLineDash([6, 4]); P.rect({ x0: d.x0 - 2, x1: d.x1 + 2, z0: d.z0, z1: d.z1 }, 'rgba(46,230,255,0.25)', '#0a8fb0', 2); c.restore();
      P.label('天井の隠し通路（高さ7.6m）', (d.x0 + d.x1) / 2, d.z0 - 2.4, '#0a6f8a', 11, '#0a8fb0');
      // 赤ウォーカーの案内先
      dot(c, X(plan.guide.x), Z(plan.guide.z), 6, '#e0302a');
      c.save(); c.setLineDash([3, 3]); P.rect(plan.guide.room, null, 'rgba(224,48,42,0.5)', 1.5); c.restore();
    }
    // 脆い壁（J）
    {
      const b = plan.brittle;
      c.fillStyle = '#ff9a3a'; c.fillRect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * PX, (b.z1 - b.z0) * PX);
      c.strokeStyle = '#b04000'; c.lineWidth = 2; c.beginPath();
      for (let z = b.z0, i = 0; z <= b.z1; z += 0.75, i++) { const x = i % 2 ? X(b.x1) : X(b.x0); if (i === 0) c.moveTo(x, Z(z)); else c.lineTo(x, Z(z)); }
      c.stroke();
      P.label('脆い壁（溜め撃ちで壊す）', b.x0 - 5.5, (b.z0 + b.z1) / 2 + 4.6, '#b04000', 11, '#ff9a3a');
    }
    // レーザー網
    {
      const L = plan.laser;
      c.save(); c.strokeStyle = '#ff2a2a'; c.lineWidth = 4; c.shadowColor = '#ff2a2a'; c.shadowBlur = 6;
      c.beginPath(); c.moveTo(X(L.ax), Z(L.az)); c.lineTo(X(L.bx), Z(L.bz)); c.stroke(); c.restore();
      for (const m of L.machines) { c.fillStyle = '#5a1010'; c.fillRect(X(m.x) - 5, Z(m.z) - 5, 10, 10); }
      P.label('レーザー網（電力源L1・L2を吸うと消える）', (L.ax + L.bx) / 2 + 13, (L.az + L.bz) / 2 - 1, '#c01818', 11, '#ff2a2a');
    }
    // 電力源（吸収）
    for (const s of plan.sources) {
      dot(c, X(s.x), Z(s.z), 10, s.laser ? '#ff5a3a' : '#20a050', '⚡', '#fff', 12);
      P.label(s.laser ? `電力源${s.id}${s.y > 3 ? '（高所）' : ''}` : '予備バッテリー（吸える）', s.x, s.z, s.laser ? '#c03818' : '#1d7a40', 11, undefined, 22);
    }
    // 送電ソケット
    const socket = (s: { x: number; z: number }, text: string, dx: number) => {
      c.fillStyle = '#18b6d6'; c.strokeStyle = '#0a5f70'; c.lineWidth = 2;
      c.fillRect(X(s.x) - 9, Z(s.z) - 9, 18, 18); c.strokeRect(X(s.x) - 9, Z(s.z) - 9, 18, 18);
      c.fillStyle = '#fff'; c.font = 'bold 12px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('⚡', X(s.x), Z(s.z) + 0.5);
      P.label(text, s.x + dx, s.z, '#0a5f70', 11, '#18b6d6');
    };
    socket(plan.hatchSocket, '送電ソケット（ハッチ）', 7);
    socket(plan.cSocket, '電源ソケット（C の照明）', 9.5);

    // 中ボス戦の範囲・出口
    c.save(); c.setLineDash([8, 5]); P.rect(plan.bossTrigger, null, '#d02050', 2); c.restore();
    P.label('中ボス戦（入ると閉じ込め）', (plan.bossTrigger.x0 + plan.bossTrigger.x1) / 2, plan.bossTrigger.z1 - 1.5, '#d02050', 12, '#d02050');
    P.rect(plan.exit, 'rgba(140,90,210,0.35)', '#7a4ac8', 2);
    P.label('2階への出口（→ 収容所2階・扉は初期:閉）', (plan.exit.x0 + plan.exit.x1) / 2 - 16, plan.exit.z0 + 1, '#6a3ab8', 12, '#7a4ac8');

    // 扉（シャッター）
    for (const g of plan.gates) {
      const skipLabel = g.id === 'exit'; // 出口の名前は上の紫のラベルにまとめる
      const wide = g.x1 - g.x0 >= g.z1 - g.z0;
      c.fillStyle = g.id === 'key' ? '#3a7dff' : g.id === 'exit' ? '#e03030' : '#9b3cd8';
      if (wide) c.fillRect(X(g.x0), Z((g.z0 + g.z1) / 2) - 4, (g.x1 - g.x0) * PX, 8);
      else c.fillRect(X((g.x0 + g.x1) / 2) - 4, Z(g.z0), 8, (g.z1 - g.z0) * PX);
      const ty = g.id === 'front' ? g.z1 + 1.6 : g.id === 'hEntry' ? g.z0 + 1.8 : g.id === 'exit' ? g.z1 + 1.8 : g.z0 - 1.4;
      const tx = g.id === 'exit' ? (g.x0 + g.x1) / 2 - 15 : (g.x0 + g.x1) / 2;
      if (!skipLabel) P.label(`${g.label}${g.closed ? '【初期:閉】' : ''}`, tx, ty, g.id === 'key' ? '#1f4ab0' : '#6a1fa0', 11, g.id === 'key' ? '#3a7dff' : '#9b3cd8');
    }

    // 部屋名
    c.textAlign = 'center';
    for (const r of plan.rooms) {
      const cx = (r.x0 + r.x1) / 2, cz = r.id === 'J' ? r.z0 + 1.6 : r.id === 'E' ? (r.z0 + r.z1) / 2 + 2 : (r.z0 + r.z1) / 2;
      P.label(r.name, cx, cz, INK, r.id === 'J' || r.id === 'I' ? 12 : 16);
    }
    P.label('地下通路（床 -5m・ハッチから）', plan.tunnel.x1 - 7, plan.tunnel.z1 + 1.2, '#6a3ab8', 11, '#6a3ab8');

    // グラップル
    for (const g of plan.grapples) {
      diamond(c, X(g.x), Z(g.z), 11, '#ffcc1a', '#7a5a00', 'G');
      P.label('グラップル', g.x - 6, g.z - 2.4, '#7a5a00', 11);
    }
    // 敵
    for (const e of enemies) enemyMark(c, X(e.p.x), Z(e.p.z), e.p.kind, e.mode, e.p.id, focus, e.sub);
    // 赤ウォーカー（案内役。倒さずに助けると味方）
    {
      const r = plan.redWalker;
      c.globalAlpha = focus !== null && focus !== 'redWalker' ? 0.15 : 1;
      enemyMark(c, X(r.x), Z(r.z), 'redWalker', 'awake', null, focus);
      c.globalAlpha = 1;
      P.label('赤ウォーカー（案内役）', r.x, r.z, '#c0201a', 11, '#e0302a', 22);
    }
    // 歯車
    plan.gears.forEach((g, i) => {
      dot(c, X(g.x), Z(g.z), 12, '#e0a800', '⚙', '#fff', 16);
      c.fillStyle = '#8a6400'; c.font = `bold 11px ${FONT}`; c.textAlign = 'center';
      c.fillText(`歯車${i + 1}${g.y > 3 ? '（高所）' : g.y < 0 ? '（地下）' : ''}`, X(g.x), Z(g.z) + 22);
    });
    // キー
    for (const k of plan.keys) {
      diamond(c, X(k.x), Z(k.z), 12, '#3a7dff', '#0b2a70');
      c.fillStyle = '#fff'; c.font = 'bold 12px sans-serif'; c.textAlign = 'center'; c.fillText('鍵', X(k.x), Z(k.z) + 0.5);
      P.label(`キー${k.id === 'B' ? '①' : '②'}（${k.hint}）`, k.x - (k.id === 'F' ? 4 : 0), k.z, '#1f4ab0', 11, '#3a7dff', k.id === 'F' ? 24 : -24);
    }
    // バキューム
    dot(c, X(plan.vacuum.x), Z(plan.vacuum.z), 12, '#c43ab0', 'V', '#fff', 14);
    P.label('バキューム（新アビリティ）', plan.vacuum.x + 10, plan.vacuum.z, '#8a1f80', 11, '#c43ab0');
    // チェックポイント
    const cp = (p: { x: number; z: number }, text: string, dx: number) => {
      c.fillStyle = '#20a050'; c.beginPath(); c.moveTo(X(p.x), Z(p.z) + 10); c.lineTo(X(p.x), Z(p.z) - 14); c.lineTo(X(p.x) + 14, Z(p.z) - 8); c.lineTo(X(p.x), Z(p.z) - 2); c.fill();
      c.strokeStyle = '#0d5a2a'; c.lineWidth = 2; c.beginPath(); c.moveTo(X(p.x), Z(p.z) + 10); c.lineTo(X(p.x), Z(p.z) - 14); c.stroke();
      P.label(text, p.x + dx, p.z + 1.6, '#0d6a30', 11, '#20a050');
    };
    cp(plan.checkpoints.boss, 'チェックポイント（中ボス前）', 0);
    // スタート（入口のチェックポイント）
    dot(c, X(plan.start.x), Z(plan.start.z), 13, '#e02020', 'S', '#fff', 15);
    P.label('スタート／チェックポイント', plan.start.x + 1, plan.start.z + 2.2, '#e02020', 11);
    // キー扉の判定点
    dot(c, X(plan.keyDoor.x), Z(plan.keyDoor.z), 5, '#3a7dff');

    P.scale(10, '10m（方眼1マス）');
    c.fillStyle = INK; c.font = `bold 20px ${FONT}`; c.textAlign = 'left'; c.fillText('N ↑', X(minX) + 10, Z(minZ) + 20);

    // 凡例
    const L = new Legend(c, W - LEGEND_W + 10, PAD, H);
    L.title('サージ収容所 1階  平面図');
    L.note('北が上。方眼1マス＝10m。', 'A（入口）→ B/E/F … → キー2本で青い扉 → D → H（中ボス）→ 2階', '紫の点線＝地下通路（床 -5m）');
    L.swatch('壁', WALL);
    L.swatch('木箱（当たりあり）', '#c9a36b', '#7a5a2c');
    L.swatch('機械・机・遮蔽物', '#9aa5b4', '#4a5562');
    L.swatch('高台・キャットウォーク', 'rgba(90,170,230,0.5)', 'rgba(40,110,180,0.7)');
    L.swatch('地下通路の壁・段', 'rgba(120,80,200,0.35)', '#6a3ab8');
    L.modes(enemies.map((e) => e.mode).concat('awake'));
    L.item('歯車（強化素材）', (x, y) => dot(c, x, y, 9, '#e0a800'));
    L.item('鍵 セキュリティキー（2本で青い扉）', (x, y) => diamond(c, x, y, 9, '#3a7dff', '#0b2a70'));
    L.item('V バキューム（アイテム）', (x, y) => dot(c, x, y, 9, '#c43ab0'));
    L.item('⚡ 送電ソケット（電気を送ると作動）', (x, y) => { c.fillStyle = '#18b6d6'; c.fillRect(x - 8, y - 8, 16, 16); });
    L.item('⚡ 電力源（吸収アームで吸う）', (x, y) => dot(c, x, y, 9, '#ff5a3a'));
    L.item('レーザー網', (x, y) => { c.fillStyle = '#ff2a2a'; c.fillRect(x - 10, y - 2, 20, 4); });
    L.item('脆い壁（溜め撃ちで壊れる）', (x, y) => { c.fillStyle = '#ff9a3a'; c.fillRect(x - 4, y - 9, 8, 18); });
    L.item('隠し通路（天井のダクト）', (x, y) => { c.setLineDash([4, 3]); c.strokeStyle = '#0a8fb0'; c.lineWidth = 2; c.strokeRect(x - 9, y - 7, 18, 14); c.setLineDash([]); });
    L.item('ハッチ（床の穴）', (x, y) => { c.fillStyle = '#222'; c.fillRect(x - 9, y - 6, 18, 12); });
    L.item('▮ 扉（紫＝普通／青＝キー扉／赤＝出口）', (x, y) => { c.fillStyle = '#9b3cd8'; c.fillRect(x - 4, y - 8, 8, 16); });
    L.item('G グラップル', (x, y) => diamond(c, x, y, 9, '#ffcc1a', '#7a5a00'));
    L.item('チェックポイント（YOU DIED から再開）', (x, y) => { c.fillStyle = '#20a050'; c.beginPath(); c.moveTo(x - 4, y + 9); c.lineTo(x - 4, y - 9); c.lineTo(x + 8, y - 4); c.lineTo(x - 4, y + 1); c.fill(); });
    L.item('S スタート', (x, y) => dot(c, x, y, 9, '#e02020'));
    L.item('中ボス戦の範囲', (x, y) => { c.setLineDash([5, 3]); c.strokeStyle = '#d02050'; c.lineWidth = 2; c.strokeRect(x - 9, y - 7, 18, 14); c.setLineDash([]); });
    const placed = enemies.map((e) => e.p);
    L.kinds(placed, focus);
    L.list(placed, focus);
  }
  draw(null);
  return { canvas: cv, draw, placed: enemies.map((e) => e.p), fileName: 'camp1_map.png' };
}
