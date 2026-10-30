// 動力炉（アルファ版ダンジョン。?level=dungeon／既定のステージ）の平面図。level/layout.ts のデータから描く。方眼＝10m
// 部屋は北（-z）へ一直線に並ぶ。最後の部屋が動力炉（ジェネレーター戦）
import type { EnemyKind } from '../../config/balance';
import { CORRIDOR_L, DOOR_W, WALL_T, computeLayout, spawnPoints } from '../../level/layout';
import { Legend, Plot, WALL, dot, enemyMark, newCanvas, FONT, INK, type EnemyMode, type PlacedEnemy, type StageSheet } from './common';

export function createDungeonSheet(): StageSheet {
  const layouts = computeLayout();
  const PX = 9, PAD = 70, LEGEND_W = 440, T = WALL_T, hw = DOOR_W / 2;
  const last = layouts[layouts.length - 1];
  const minX = -30, maxX = 30;
  const minZ = Math.floor((last.zMin - 4) / 10) * 10, maxZ = 10;
  const W = (maxX - minX) * PX + PAD * 2 + LEGEND_W;
  const H = (maxZ - minZ) * PX + PAD * 2;
  const { cv, c } = newCanvas(W, H);
  const P = new Plot(c, PAD, PAD, PX, minX, maxX, minZ, maxZ, 10);
  const { X, Z } = P;

  interface E { p: PlacedEnemy; mode: EnemyMode; sub: string }
  const enemies: E[] = [];
  for (const L of layouts) {
    L.def.waves.forEach((wave, wi) => {
      for (const s of spawnPoints(L, wave)) {
        const boss = s.kind === 'boss';
        const sub = `W${wi + 1}${s.y > 4 && !boss ? '・高台' : ''}`;
        enemies.push({
          mode: boss ? 'boss' : 'wave', sub,
          p: { id: enemies.length + 1, kind: s.kind, x: s.x, z: s.z, area: L.def.name, how: boss ? 'ボス' : `第${wi + 1}ウェーブ${s.y > 4 && !boss ? '・高台' : ''}`, cell: P.cellOf(s.x, s.z) },
        });
      }
    });
  }
  // 近くに重なる印は右・下へずらす（ゲームでは同じ所から順に出てくるため、図では並べて見せる）
  const placedPx: { x: number; y: number }[] = [];
  const offs = enemies.map((e) => {
    const bx = X(e.p.x), by = Z(e.p.z);
    for (let k = 0; k < 40; k++) {
      const x = bx + (k % 5) * 30 - 60, y = by + Math.floor(k / 5) * 34;
      if (!placedPx.some((q) => Math.abs(q.x - x) < 28 && Math.abs(q.y - y) < 32)) { placedPx.push({ x, y }); return { x, y }; }
    }
    placedPx.push({ x: bx, y: by }); return { x: bx, y: by };
  });

  function draw(focus: EnemyKind | null): void {
    c.globalAlpha = 1;
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
    for (const L of layouts) P.rect({ x0: L.xMin, x1: L.xMax, z0: L.zMin, z1: L.zMax }, L.def.boss ? '#e4f6fa' : '#e9edf2');
    for (let i = 0; i < layouts.length - 1; i++) {
      const a = layouts[i], b = layouts[i + 1];
      P.rect({ x0: -hw, x1: hw, z0: b.zMax + T, z1: a.zMin - T }, '#eef1f5');
    }
    P.grid();
    // 壁
    for (const [i, L] of layouts.entries()) {
      const { xMin, xMax, zMin, zMax } = L;
      P.rect({ x0: xMin - T, x1: xMin, z0: zMin - T, z1: zMax + T }, WALL);
      P.rect({ x0: xMax, x1: xMax + T, z0: zMin - T, z1: zMax + T }, WALL);
      const ns = (z0: number, z1: number, gap: boolean) => {
        if (!gap) { P.rect({ x0: xMin, x1: xMax, z0, z1 }, WALL); return; }
        P.rect({ x0: xMin, x1: -hw, z0, z1 }, WALL); P.rect({ x0: hw, x1: xMax, z0, z1 }, WALL);
      };
      ns(zMin - T, zMin, !!L.door);
      ns(zMax, zMax + T, i > 0);
      // 出口のドア（部屋を片付けると開く）
      if (L.door) { c.fillStyle = '#9b3cd8'; c.fillRect(X(L.door.xMin), Z(L.door.cz) - 4, (L.door.xMax - L.door.xMin) * PX, 8); }
    }
    for (let i = 0; i < layouts.length - 1; i++) {
      const a = layouts[i], b = layouts[i + 1];
      P.rect({ x0: -hw - T, x1: -hw, z0: b.zMax + T, z1: a.zMin - T }, WALL);
      P.rect({ x0: hw, x1: hw + T, z0: b.zMax + T, z1: a.zMin - T }, WALL);
    }
    // 中身
    for (const L of layouts) {
      const { cx, cz, def } = L;
      for (const b of def.blocks) {
        const r = { x0: cx + b.lx - b.sx / 2, x1: cx + b.lx + b.sx / 2, z0: cz + b.lz - b.sz / 2, z1: cz + b.lz + b.sz / 2 };
        if (b.kind === 'cover') P.rect(r, def.boss ? WALL : '#c9a36b', def.boss ? undefined : '#7a5a2c');
        else if (b.kind === 'platform') P.rect(r, 'rgba(90,170,230,0.35)', 'rgba(40,110,180,0.8)');
        else if (b.kind === 'step') P.rect(r, 'rgba(60,140,220,0.65)', '#1f5aa0');
        else P.rect(r, WALL);
      }
      if (def.platform) P.label(`高台（${def.platform.top}m）`, cx + def.platform.lx, cz + def.platform.lz + 3.5, '#1f5aa0', 11);
      if (def.boss) {
        c.beginPath(); c.arc(X(cx), Z(cz), 3.4 * PX, 0, Math.PI * 2); c.fillStyle = 'rgba(94,240,255,0.5)'; c.fill();
        c.strokeStyle = '#0a8fb0'; c.lineWidth = 2; c.stroke();
        P.label('エネルギー柱', cx, cz + 5.2, '#0a6f8a', 11);
      }
      for (const p of def.pads) dot(c, X(cx + p.lx), Z(cz + p.lz), 9, '#18b6d6', '電');
      for (const k of def.kits) dot(c, X(cx + k.lx), Z(cz + k.lz), 8, '#ff6b8a', '+', '#fff', 15);
      // 部屋名
      const title = def.title.replace(/\s+/g, ' ');
      P.label(title, cx, L.index === 0 ? L.zMax - 9 : L.zMax - 3, INK, 15);
      if (def.waves.length) P.label(`ウェーブ ${def.waves.length} 回`, cx, L.zMax - 6, '#555', 11);
    }
    // 敵
    enemies.forEach((e, i) => enemyMark(c, offs[i].x, offs[i].y, e.p.kind, e.mode, e.p.id, focus, e.sub));
    // スタート
    const s0 = layouts[0];
    dot(c, X(s0.cx), Z(s0.zMax - 3), 13, '#e02020', 'S', '#fff', 15);
    P.label('スタート', s0.cx + 6, s0.zMax - 3, '#e02020', 12);
    P.scale(10, '10m（方眼1マス）');
    c.fillStyle = INK; c.font = `bold 20px ${FONT}`; c.textAlign = 'left'; c.fillText('N ↑', X(minX) + 10, Z(minZ) + 20);

    const Lg = new Legend(c, W - LEGEND_W + 10, PAD, H);
    Lg.title('動力炉（アルファ版ダンジョン）');
    Lg.note('北が上。方眼1マス＝10m。南のスタートから北へ一直線。',
      `部屋と部屋は長さ${CORRIDOR_L}mの通路でつながる。`, '部屋に入ると敵のウェーブ。全滅でドアが開く。', '最奥の動力炉でジェネレーター（ボス）戦。');
    Lg.swatch('壁・柱', WALL);
    Lg.swatch('遮蔽物（箱）', '#c9a36b', '#7a5a2c');
    Lg.swatch('高台', 'rgba(90,170,230,0.5)', 'rgba(40,110,180,0.8)');
    Lg.swatch('登れる段', 'rgba(60,140,220,0.8)', '#1f5aa0');
    Lg.item('▮ ドア（部屋を片付けると開く）', (x, y) => { c.fillStyle = '#9b3cd8'; c.fillRect(x - 10, y - 4, 20, 8); });
    Lg.modes(enemies.map((e) => e.mode));
    Lg.item('W1/W2 何回目のウェーブで出るか', (x, y) => { c.fillStyle = '#1f5aa0'; c.font = `bold 11px ${FONT}`; c.textAlign = 'center'; c.fillText('W1', x, y); });
    Lg.item('電 充電ポイント', (x, y) => dot(c, x, y, 8, '#18b6d6'));
    Lg.item('+ 修理キット', (x, y) => dot(c, x, y, 8, '#ff6b8a'));
    Lg.item('S スタート', (x, y) => dot(c, x, y, 9, '#e02020'));
    Lg.head('部屋（南から順に）');
    layouts.forEach((L, i) => Lg.text(`${i + 1}. ${L.def.name}（${L.def.w}×${L.def.d}m）`));
    const all = enemies.map((e) => e.p);
    Lg.kinds(all, focus);
    Lg.list(all, focus);
  }
  draw(null);
  return { canvas: cv, draw, placed: enemies.map((e) => e.p), fileName: 'dungeon_map.png' };
}
