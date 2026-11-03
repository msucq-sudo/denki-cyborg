// ドレイン装置へ向かうダンジョン（?level=drain）の平面図。level/drain/plan.ts の数値から描く。方眼＝10m
// 高さの違う場所（B・綱渡り・隠し通路は高さ 32〜44m、地下室は -4m）も同じ平面に重ねて描き、色と注記で区別する。
import type { EnemyKind } from '../../config/balance';
import { B_Y, DUCT_Y, LASER_X, generateDrain } from '../../level/drain/plan';
import { STAGE } from '../../level/minecart/stage';
import { drawOverview, overviewSize } from '../../level/minecart/overview';
import { Legend, Plot, WALL, dot, enemyMark, newCanvas, FONT, INK, type EnemyMode, type PlacedEnemy, type StageSheet } from './common';

export function createDrainSheet(): StageSheet {
  const plan = generateDrain();
  const PX = 8, PAD = 70, LEGEND_W = 440;
  const minX = 0, maxX = 142, minZ = 5, maxZ = 95;
  const W = (maxX - minX) * PX + PAD * 2 + LEGEND_W;
  const H = (maxZ - minZ) * PX + PAD * 2;
  // ドレイン装置の部屋への扉の奥：トロッコ面（stage.ts のデータから毎回描く。overview.ts は docs/minecart-stage.png と共通）
  const MC_GAP = 50, MC_HEAD = 68;
  const ov = overviewSize(STAGE);
  const WT = Math.max(W, ov.w);
  const HT = H + MC_GAP + MC_HEAD + ov.h;
  const { cv, c } = newCanvas(WT, HT);
  const P = new Plot(c, PAD, PAD, PX, minX, maxX, minZ, maxZ, 10);
  const { X, Z } = P;

  interface E { p: PlacedEnemy; mode: EnemyMode }
  const enemies: E[] = [];
  let id = 1;
  for (const z of plan.zones) for (const s of z.spawns) {
    const fly = s.kind === 'drone' || s.kind === 'missileDrone' || s.kind === 'redDrone';
    const mode: EnemyMode = s.neutral || s.mode === 'awake' ? (fly ? 'fly' : 'awake') : s.mode === 'drop' || (!s.mode && fly) ? 'drop' : 'pod';
    const how = s.neutral ? '襲ってこない（待機）' : mode === 'pod' ? 'ポッド' : mode === 'drop' ? '天井から' : fly ? '最初から飛んでいる' : '最初から起きている';
    const area = z.name + (s.floor ? `（高さ ${Math.round(s.floor)}m）` : '');
    enemies.push({ mode, p: { id: id++, kind: s.kind, x: s.x, z: s.z, area, cell: P.cellOf(s.x, s.z), how } });
  }

  function draw(focus: EnemyKind | null): void {
    c.globalAlpha = 1;
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, WT, HT);
    // 部屋（低い所 → 高い所の順に塗る）
    const order = [...plan.rooms].sort((a, b) => a.y0 - b.y0);
    for (const r of order) {
      const high = r.y0 >= 20, low = r.y1 <= 0;
      P.rect(r, high ? '#dfe9f7' : low ? '#efe6f2' : r.id === 'E' ? '#d7dbe2' : '#e9edf2');
    }
    // 落ちたら即死の場所（斜線）
    for (const pit of plan.pits) {
      c.save();
      c.beginPath(); c.rect(X(pit.x0), Z(pit.z0), (pit.x1 - pit.x0) * PX, (pit.z1 - pit.z0) * PX); c.clip();
      c.fillStyle = 'rgba(180,40,40,0.10)'; c.fillRect(X(pit.x0), Z(pit.z0), (pit.x1 - pit.x0) * PX, (pit.z1 - pit.z0) * PX);
      c.strokeStyle = 'rgba(180,40,40,0.35)'; c.lineWidth = 1;
      for (let k = -400; k < 800; k += 12) { c.beginPath(); c.moveTo(X(pit.x0) + k, Z(pit.z0)); c.lineTo(X(pit.x0) + k + 600, Z(pit.z0) + 600); c.stroke(); }
      c.restore();
    }
    P.grid();
    // 壁
    for (const b of plan.boxes) if (b.tag === 'wall' && b.y1 - b.y0 > 0.5) P.rect(b, WALL);
    // 動く足場・静的な足場（吹き抜け）
    for (const b of plan.boxes) if (b.tag === 'platform' || b.tag === 'shelf') P.rect(b, '#8fa0b4', '#4a5562');
    for (const m of plan.platforms) {
      const x0 = m.axis === 'x' ? m.x - m.amp - m.sx / 2 : m.x - m.sx / 2, x1 = m.axis === 'x' ? m.x + m.amp + m.sx / 2 : m.x + m.sx / 2;
      const z0 = m.axis === 'z' ? m.z - m.amp - m.sz / 2 : m.z - m.sz / 2, z1 = m.axis === 'z' ? m.z + m.amp + m.sz / 2 : m.z + m.sz / 2;
      c.save(); c.setLineDash([4, 3]); c.strokeStyle = '#e08a00'; c.lineWidth = 2; c.strokeRect(X(x0), Z(z0), (x1 - x0) * PX, (z1 - z0) * PX); c.restore();
      P.rect({ x0: m.x - m.sx / 2, x1: m.x + m.sx / 2, z0: m.z - m.sz / 2, z1: m.z + m.sz / 2 }, '#ffb040', '#a05a00');
    }
    // 綱渡り（ロープ）と隠し通路
    c.strokeStyle = '#6a4a20'; c.lineWidth = 3; c.beginPath(); c.moveTo(X(25), Z(20)); c.lineTo(X(50), Z(20)); c.stroke();
    P.label(`綱渡り（高さ ${B_Y}m・落ちたら即死）`, 37, 15.5, '#6a4a20', 12, '#6a4a20');
    c.save(); c.setLineDash([6, 4]); c.strokeStyle = '#1f6ac0'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(X(20), Z(24.5)); c.lineTo(X(50), Z(24.5)); c.stroke(); c.restore();
    P.label(`隠し通路（高さ ${DUCT_Y}m・棚にグラップルで上がる）`, 37, 29.5, '#1f6ac0', 12, '#1f6ac0');
    // 階段（地下室へ）
    for (const b of plan.boxes) if (b.tag === 'step') P.rect(b, '#b8a8c8');
    // 壊せるブロック
    for (const b of plan.breakables) {
      P.rect(b, '#c9a36b', '#7a5a2c', 2);
      P.label(b.id === 'iWall' ? '壊せる壁' : b.id === 'dBlock' ? '壊せるブロック' : '壊せるブロック（主電源の前）', (b.x0 + b.x1) / 2, b.z0 - 2.2, '#7a5a2c', 11, '#7a5a2c');
    }
    // シャッター
    for (const g of plan.gates) {
      P.rect(g, g.id === 'gDoor' ? '#3a7dff' : '#e03030');
      if (g.id === 'gDoor') P.label('G の扉（セキュリティ3つで開く）', (g.x0 + g.x1) / 2 + 2, g.z0 + 2.6, '#1a4fc0', 12, '#3a7dff');
    }
    // レーザー
    c.fillStyle = '#ff3020'; c.fillRect(X(LASER_X) - 3, Z(plan.laser.z0), 6, (plan.laser.z1 - plan.laser.z0) * PX);
    P.label('レーザー', LASER_X, plan.laser.z0 + 2.6, '#c01808', 12, '#ff3020');
    // セキュリティ装置・主電源
    for (const s of plan.securities) { dot(c, X(s.x), Z(s.z), 9, '#ff5a3a', s.id, '#fff', 12); P.label(s.label, s.x, s.z + 3.2, '#b02a10', 11, '#ff5a3a'); }
    dot(c, X(plan.mainPower.x), Z(plan.mainPower.z), 9, '#ffc21a', '主', '#000', 12);
    P.label('主電源（レーザーを止める）', plan.mainPower.x + 2, plan.mainPower.z + 3.2, '#8a6a00', 11, '#ffc21a');
    // ホログラムデコイ・ドレイン装置の扉
    dot(c, X(plan.decoy.x), Z(plan.decoy.z), 9, '#18b6d6', 'H', '#fff', 12);
    P.label('ホログラムデコイ（地下）', plan.decoy.x, plan.decoy.z + 3.2, '#0a6a80', 11, '#18b6d6');
    P.rect({ x0: 60, x1: 68, z0: 13.2, z1: 14.4 }, '#ff6a3a');
    P.label('ドレイン装置の部屋への扉', 64, 11.2, '#b03a10', 12, '#ff6a3a');
    // 部屋名
    const names: [string, number, number][] = [
      ['A 入口ホール（階段で地下へ）', 17, 88], ['A〜B 吹き抜け（足場を上る）', 17, 62], [`B（高さ ${B_Y}m・戦闘）`, 14, 19], ['G 目的地（高い）', 64, 30],
      ['C 配電室', 55, 85], ['D 動力室（戦闘）', 100, 86], ['I', 59, 58], ['E 暗い長廊下', 110, 51], ['F 冷却ポンプ室', 126, 22], ['E→F 狭い暗い通路', 138, 36],
      ['ポンプ室（閉鎖）', 96, 27],
    ];
    for (const [t, x, z] of names) P.label(t, x, z, INK, 13);
    // 敵
    for (const e of enemies) enemyMark(c, X(e.p.x), Z(e.p.z), e.p.kind, e.mode, e.p.id, focus);
    // チェックポイントとスタート
    for (const [cid, cp] of Object.entries(plan.checkpoints)) {
      const x = X(cp.x) + 10, y = Z(cp.z);
      c.fillStyle = '#20a050'; c.beginPath(); c.moveTo(x, y + 10); c.lineTo(x, y - 12); c.lineTo(x + 12, y - 6); c.lineTo(x, y); c.fill();
      c.strokeStyle = '#0d5a2a'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y + 10); c.lineTo(x, y - 12); c.stroke();
      P.label(cid, cp.x + 3, cp.z + 2.4, '#0d6a30', 10);
    }
    dot(c, X(plan.start.x), Z(plan.start.z), 13, '#e02020', 'S', '#fff', 15);
    P.scale(10, '10m（方眼1マス）');
    c.fillStyle = INK; c.font = `bold 20px ${FONT}`; c.textAlign = 'left'; c.fillText('N ↑', X(minX) + 10, Z(minZ) + 20);

    const L = new Legend(c, W - LEGEND_W + 10, PAD, H);
    L.title('ドレイン装置へ向かうダンジョン  平面図');
    L.note('北が上。方眼1マス＝10m。高さの違う場所も重ねて描いてある。',
      '正規ルート：セキュリティ装置 I・D地下・F を止めて E の扉から G へ。',
      '近道：A→吹き抜け→B（戦闘）→綱渡り（または隠し通路）→ G。');
    L.swatch('壁', WALL);
    L.swatch('高い所の部屋（B・綱渡り・隠し通路・G）', '#dfe9f7');
    L.swatch('地下室（A・D）', '#efe6f2');
    L.swatch('落ちたら即死', 'rgba(180,40,40,0.25)', '#b42828');
    L.swatch('動く足場（点線＝動く範囲）', '#ffb040', '#a05a00');
    L.swatch('静かな足場', '#8fa0b4', '#4a5562');
    L.swatch('壊せるブロック（溜め撃ち）', '#c9a36b', '#7a5a2c');
    L.swatch('扉（戦闘・セキュリティで閉まる）', '#e03030');
    L.item('セキュリティ装置', (x, y) => dot(c, x, y, 8, '#ff5a3a', 'I'));
    L.item('主電源', (x, y) => dot(c, x, y, 8, '#ffc21a', '主', '#000'));
    L.modes(enemies.map((e) => e.mode));
    L.item('S スタート', (x, y) => dot(c, x, y, 9, '#e02020'));
    L.item('チェックポイント', (x, y) => { c.fillStyle = '#20a050'; c.beginPath(); c.moveTo(x - 4, y + 9); c.lineTo(x - 4, y - 9); c.lineTo(x + 8, y - 4); c.lineTo(x - 4, y + 1); c.fill(); });
    const all = enemies.map((e) => e.p);
    L.kinds(all, focus);
    L.list(all, focus);
    // ---- トロッコ面
    c.fillStyle = INK; c.font = `bold 26px ${FONT}`; c.textAlign = 'left';
    c.fillText('トロッコ面（ドレイン装置の部屋への扉を調べると始まる横スクロール）', PAD, H + MC_GAP + 30);
    c.font = `14px ${FONT}`; c.fillStyle = '#4a5a78';
    c.fillText('配置は src/level/minecart/stage.ts。ここで見える図はそのデータから毎回描いている。ゲームで開くには上の「トロッコ面から」リンク。', PAD, H + MC_GAP + 50);
    c.save(); c.translate(0, H + MC_GAP + MC_HEAD); drawOverview(c, STAGE); c.restore();
  }
  draw(null);
  return { canvas: cv, draw, placed: enemies.map((e) => e.p), fileName: 'drain_map.png' };
}
