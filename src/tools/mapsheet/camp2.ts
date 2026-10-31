// サージ収容所 2階（?level=camp2）の平面図。level/camp2/layout.ts の数値から描く。方眼＝5m
import type { EnemyKind } from '../../config/balance';
import { BOSS_LAND, CAGE, CAGE_Z, CRATES, DOOR, FIGHT_START, HALL, LOCK, PILLARS, SPAWNS, STAND, START } from '../../level/camp2/layout';
import { Legend, Plot, WALL, dot, enemyMark, newCanvas, FONT, INK, type EnemyMode, type PlacedEnemy, type StageSheet } from './common';

export function createCamp2Sheet(): StageSheet {
  const PX = 22, PAD = 70, LEGEND_W = 420, T = 1;
  const minX = -20, maxX = 20, minZ = -35, maxZ = 25;
  const W = (maxX - minX) * PX + PAD * 2 + LEGEND_W;
  const H = (maxZ - minZ) * PX + PAD * 2;
  const { cv, c } = newCanvas(W, H);
  const P = new Plot(c, PAD, PAD, PX, minX, maxX, minZ, maxZ, 5);
  const { X, Z } = P;

  interface E { p: PlacedEnemy; mode: EnemyMode }
  const enemies: E[] = SPAWNS.map((s, i) => {
    const fly = s.kind === 'drone';
    const mode: EnemyMode = fly ? 'drop' : 'awake';
    const how = fly ? '扉を調べた瞬間・天井から' : '扉を調べた瞬間・床に出る';
    return { mode, p: { id: i + 1, kind: s.kind, x: s.x, z: s.z, area: '前室', how, cell: P.cellOf(s.x, s.z) } };
  });
  const boss: PlacedEnemy = { id: enemies.length + 1, kind: 'boss', x: BOSS_LAND.x, z: BOSS_LAND.z, area: '前室（檻を調べたあと）', how: 'ボス（天井から降りてくる）', cell: P.cellOf(BOSS_LAND.x, BOSS_LAND.z) };

  function draw(focus: EnemyKind | null): void {
    c.globalAlpha = 1;
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
    P.rect(HALL, '#e9edf2');
    P.rect(CAGE, '#f3ece0');
    P.grid();
    // 外壁
    c.fillStyle = WALL;
    P.rect({ x0: HALL.x0 - T, x1: HALL.x1 + T, z0: CAGE.z0 - T, z1: CAGE.z0 }, WALL);
    P.rect({ x0: HALL.x0 - T, x1: HALL.x0, z0: CAGE.z0, z1: HALL.z1 }, WALL);
    P.rect({ x0: HALL.x1, x1: HALL.x1 + T, z0: CAGE.z0, z1: HALL.z1 }, WALL);
    P.rect({ x0: HALL.x0 - T, x1: HALL.x1 + T, z0: HALL.z1, z1: HALL.z1 + T }, WALL);
    // 入口（南）：閉じた大扉
    P.rect({ x0: -3, x1: 3, z0: HALL.z1, z1: HALL.z1 + T }, '#9b3cd8');
    P.label('入口（南・閉じた大扉）', 0, HALL.z1 + 2.2, '#6a1fa0', 12, '#9b3cd8');
    // 格子（檻の正面）と扉
    c.save(); c.strokeStyle = '#59636f'; c.lineWidth = 4; c.setLineDash([2, 4]);
    c.beginPath(); c.moveTo(X(HALL.x0), Z(CAGE_Z)); c.lineTo(X(DOOR.x0), Z(CAGE_Z)); c.moveTo(X(DOOR.x1), Z(CAGE_Z)); c.lineTo(X(HALL.x1), Z(CAGE_Z)); c.stroke(); c.restore();
    c.fillStyle = '#e03030'; c.fillRect(X(DOOR.x0), Z(CAGE_Z) - 5, (DOOR.x1 - DOOR.x0) * PX, 10);
    P.label('檻の扉（調べるとボス戦）', 6.5, CAGE_Z + 1.4, '#c02020', 12, '#e03030');
    dot(c, X(LOCK.x), Z(LOCK.z) - 8, 5, '#ffd83a');
    // 扉の前の立ち位置
    dot(c, X(STAND.x), Z(STAND.z), 7, '#18b6d6');
    // 柱・箱
    for (const p of PILLARS) P.rect({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.w / 2, z1: p.z + p.w / 2 }, WALL);
    for (const b of CRATES) P.rect({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2 }, '#c9a36b', '#7a5a2c');
    // 部屋名
    P.label('前室（ボス戦の部屋・敵は扉を調べた瞬間に出る）', 0, 16.5, INK, 16);
    P.label('檻（住民が捕まっている）', 0, (CAGE.z0 + CAGE.z1) / 2, '#7a5a2c', 16);
    // 敵
    for (const e of enemies) enemyMark(c, X(e.p.x), Z(e.p.z), e.p.kind, e.mode, e.p.id, focus);
    // ボス（ジェネレーター）が降りてくる位置
    c.save(); c.setLineDash([6, 4]); c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); c.arc(X(BOSS_LAND.x), Z(BOSS_LAND.z), 3 * PX, 0, Math.PI * 2); c.stroke(); c.restore();
    enemyMark(c, X(boss.x), Z(boss.z), 'boss', 'boss', boss.id, focus);
    P.label('ジェネレーター（ボス）が降りてくる', BOSS_LAND.x, BOSS_LAND.z + 3.8, '#111', 12, '#000');
    // スタート・リトライ地点
    dot(c, X(START.x), Z(START.z), 13, '#e02020', 'S', '#fff', 15);
    P.label('スタート', START.x + 3, START.z, '#e02020', 12);
    {
      const x = X(FIGHT_START.x) + 30, y = Z(FIGHT_START.z);
      c.fillStyle = '#20a050'; c.beginPath(); c.moveTo(x, y + 10); c.lineTo(x, y - 14); c.lineTo(x + 14, y - 8); c.lineTo(x, y - 2); c.fill();
      c.strokeStyle = '#0d5a2a'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y + 10); c.lineTo(x, y - 14); c.stroke();
      dot(c, X(FIGHT_START.x), Z(FIGHT_START.z), 5, '#20a050');
      P.label('チェックポイント（ボス戦のリトライ）', FIGHT_START.x + 7.5, FIGHT_START.z + 1.2, '#0d6a30', 11, '#20a050');
    }
    P.scale(5, '5m（方眼1マス）');
    c.fillStyle = INK; c.font = `bold 20px ${FONT}`; c.textAlign = 'left'; c.fillText('N ↑', X(minX) + 10, Z(minZ) + 20);

    const L = new Legend(c, W - LEGEND_W + 10, PAD, H);
    L.title('サージ収容所 2階  平面図');
    L.note('北が上。方眼1マス＝5m。', '南の入口から入り、前室の敵を倒して北の檻の扉を調べる。', '扉を調べるとジェネレーター（ボス）が降りてくる。');
    L.swatch('壁・柱', WALL);
    L.swatch('箱（遮蔽物）', '#c9a36b', '#7a5a2c');
    L.swatch('敵の隠れた木箱', 'rgba(185,138,90,0.45)', '#8a5a26');
    L.swatch('敵の隠れたコンテナ', 'rgba(74,85,98,0.35)', '#4a5562');
    L.item('格子（檻の正面）', (x, y) => { c.setLineDash([2, 3]); c.strokeStyle = '#59636f'; c.lineWidth = 4; c.beginPath(); c.moveTo(x - 10, y); c.lineTo(x + 10, y); c.stroke(); c.setLineDash([]); });
    L.item('檻の扉', (x, y) => { c.fillStyle = '#e03030'; c.fillRect(x - 10, y - 4, 20, 8); });
    L.modes(enemies.map((e) => e.mode).concat('boss'));
    L.item('扉を調べる立ち位置', (x, y) => dot(c, x, y, 7, '#18b6d6'));
    L.item('S スタート', (x, y) => dot(c, x, y, 9, '#e02020'));
    L.item('チェックポイント', (x, y) => { c.fillStyle = '#20a050'; c.beginPath(); c.moveTo(x - 4, y + 9); c.lineTo(x - 4, y - 9); c.lineTo(x + 8, y - 4); c.lineTo(x - 4, y + 1); c.fill(); });
    const all = [...enemies.map((e) => e.p), boss];
    L.kinds(all, focus);
    L.list(all, focus);
  }
  draw(null);
  return { canvas: cv, draw, placed: [...enemies.map((e) => e.p), boss], fileName: 'camp2_map.png' };
}
