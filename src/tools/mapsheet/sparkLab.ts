// スパークの地下特別研究室（会話シーン）の平面図。src/scenes/sparkLab.ts の置き場所を写している。方眼＝1m
// 戦闘のない部屋なので敵は無し。3D は lab.html で見られる。
import {
  Legend, Plot, WALL, dot, newCanvas, FONT, INK,
  type R2, type StageSheet,
} from './common';

const HX = 7, HZ = 5;

export function createSparkLabSheet(): StageSheet {
  const PX = 80, PAD = 70, LEGEND_W = 420;
  const minX = -HX - 1, maxX = HX + 1, minZ = -HZ - 1, maxZ = HZ + 1;
  const W = (maxX - minX) * PX + PAD * 2 + LEGEND_W;
  const H = Math.max((maxZ - minZ) * PX + PAD * 2, 1000);
  const { cv, c } = newCanvas(W, H);
  const P = new Plot(c, PAD, PAD, PX, minX, maxX, minZ, maxZ, 1);
  const { X, Z } = P;

  /** 中心 (cx,cz)・幅 w（壁沿いの向き）・奥行き d の箱。ry で回転（真上から見て） */
  const box = (cx: number, cz: number, w: number, d: number, fill: string, stroke = '#4a5562', ry = 0): void => {
    c.save(); c.translate(X(cx), Z(cz)); c.rotate(ry);
    c.fillStyle = fill; c.fillRect(-w / 2 * PX, -d / 2 * PX, w * PX, d * PX);
    c.strokeStyle = stroke; c.lineWidth = 1.5; c.strokeRect(-w / 2 * PX, -d / 2 * PX, w * PX, d * PX);
    c.restore();
  };
  const R = (x0: number, x1: number, z0: number, z1: number): R2 => ({ x0, x1, z0, z1 });

  // 机の配置（sparkLab.ts の deskDefs。壁から 0.45m・幅×奥行0.8m）
  const desks: { w: 'N' | 'S'; u: number; width: number }[] = [
    { w: 'N', u: -5.5, width: 2.2 }, { w: 'N', u: -3.3, width: 2.2 }, { w: 'N', u: 3.3, width: 2.2 }, { w: 'N', u: 5.5, width: 2.2 },
    { w: 'S', u: -1.2, width: 2.2 }, { w: 'S', u: 1.0, width: 2.2 }, { w: 'S', u: 2.9, width: 1.6 },
  ];
  // 壁際の棚（中心 x,z／幅／壁に沿う向き）
  const shelves: { x: number; z: number; w: number; vert: boolean }[] = [
    { x: -5.6, z: HZ - 0.28, w: 2.0, vert: false }, { x: -3.6, z: HZ - 0.28, w: 2.0, vert: false }, { x: 4.6, z: HZ - 0.28, w: 1.4, vert: false },
    { x: -HX + 0.28, z: -3.4, w: 2.0, vert: true }, { x: -HX + 0.28, z: -1.6, w: 1.6, vert: true },
  ];

  function draw(): void {
    c.globalAlpha = 1;
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);

    // 床と壁（壁の厚みは外側に 0.4m）
    P.rect(R(-HX, HX, -HZ, HZ), '#e9edf2');
    P.grid();
    c.fillStyle = WALL;
    c.fillRect(X(-HX - 0.4), Z(-HZ - 0.4), (2 * HX + 0.8) * PX, 0.4 * PX);
    c.fillRect(X(-HX - 0.4), Z(HZ), (2 * HX + 0.8) * PX, 0.4 * PX);
    c.fillRect(X(HX), Z(-HZ), 0.4 * PX, 2 * HZ * PX);
    c.fillRect(X(-HX - 0.4), Z(-HZ), 0.4 * PX, 2 * HZ * PX);

    // ブラストドア（西壁・中央。幅 2.8m）
    c.fillStyle = '#ffd83a'; c.fillRect(X(-HX - 0.4), Z(-1.4), 0.4 * PX, 2.8 * PX);
    c.strokeStyle = '#2a2f36'; c.lineWidth = 2; c.strokeRect(X(-HX - 0.4), Z(-1.4), 0.4 * PX, 2.8 * PX);
    P.label('ブラストドア（出入口）', -HX + 1.6, 0, '#7a5a00', 13, '#c9a000');

    // 東壁：大型モニターウォール＋コンソール（幅 5.2m）、サーバーラック
    box(HX - 0.42, 0, 0.8, 5.2, '#f3efe6', '#4a5562');
    P.label('モニターウォール', HX - 1.0, 0, INK, 13);
    for (const rz of [-4.6, -3.9, -3.2, 3.2, 3.9, 4.6]) box(HX - 0.52, rz, 0.9, 0.7, '#56616c', '#2a2f36');
    P.label('サーバーラック', HX - 1.3, -3.9, INK, 12, undefined, -26);
    P.label('サーバーラック', HX - 1.3, 3.9, INK, 12, undefined, -34);

    // 机（北・南）
    for (const d of desks) {
      const z = d.w === 'N' ? -HZ + 0.45 : HZ - 0.45;
      box(d.u, z, d.width, 0.8, '#f3efe6');
    }
    // 棚
    for (const s of shelves) box(s.x, s.z, s.vert ? 0.46 : s.w, s.vert ? s.w : 0.46, '#9aa5b4');
    // 作業台（西壁）
    box(-HX + 0.4, 2.7, 0.7, 2.0, '#24385f', '#10203f');
    P.label('作業台', -HX + 1.6, 2.7, INK, 12);
    // ナノ組立機（北・中央）
    box(0, -HZ + 0.6, 2.0, 0.95, '#24385f', '#10203f');
    P.label('ナノ組立機', 0, -HZ + 1.55, INK, 12);
    // 南西の木箱、ケーブルドラム
    for (let i = 0; i < 6; i++) box(-6.3 + (i % 3) * 0.62, 4.15 - Math.floor(i / 3) * 0.55, 0.5, 0.45, '#c9a36b', '#7a5a2c');
    c.beginPath(); c.arc(X(6.2), Z(-4.1), 0.4 * PX, 0, Math.PI * 2); c.fillStyle = '#d08a4a'; c.fill(); c.strokeStyle = '#7a4a1a'; c.lineWidth = 1.5; c.stroke();
    P.label('ケーブルドラム', 6.2, -4.1, INK, 11, undefined, 24);

    // 中央：開発ベッド（台座 2.9×1.3、マットレス 2.7×0.98）。頭が西（-x）
    box(0, 0, 2.9, 1.3, '#24385f', '#10203f');
    box(0, 0, 2.6, 0.9, '#9fd3ea', '#2e7da0');
    box(-1.05, 0, 0.34, 0.5, '#ffffff', '#6a8aa0');
    box(-1.42, 0, 0.3, 0.45, '#56616c', '#2a2f36');
    P.label('開発ベッド（頭＝西）', 0, 0, '#10203f', 13);

    // 周辺機器
    box(-1.2, -1.55, 0.5, 0.5, '#2a2f36', '#10161c', 0.2);
    P.label('医療モニタ', -1.2, -1.55, INK, 11, undefined, -22);
    c.beginPath(); c.arc(X(-1.9), Z(-1.0), 0.15 * PX, 0, Math.PI * 2); c.fillStyle = '#9aa4ae'; c.fill();
    P.label('点滴', -2.3, -1.0, INK, 11);
    box(0.9, -1.6, 1.0, 0.55, '#dfe5ea', '#4a5562', -0.15);
    P.label('ツールカート', 0.9, -1.6, INK, 11);
    box(2.5, -1.3, 1.8, 0.3, '#56616c', '#2a2f36');
    c.beginPath(); c.arc(X(2.5), Z(-1.3), 0.78 * PX, 0, Math.PI * 2); c.strokeStyle = '#2ee6ff'; c.lineWidth = 3; c.setLineDash([6, 4]); c.stroke(); c.setLineDash([]);
    P.label('スキャンリング（往復）', 2.5, -2.4, '#0a6f8a', 11, '#2ee6ff');
    dot(c, X(-0.2), Z(-1.6), 8, '#e0524a', 'A', '#fff', 11);
    P.label('床アーム', -0.2, -1.6, INK, 11, undefined, 20);
    for (const ax of [-0.5, 0.9]) dot(c, X(ax), Z(-0.85), 7, '#2ee6ff', '↓', '#073', 11);
    P.label('天井アーム×2', 0.2, -0.85, '#0a6f8a', 11, undefined, -18);

    // 会話の立ち位置・カメラ
    dot(c, X(-0.8), Z(1.5), 12, '#e0302a', 'ス', '#fff', 13);
    P.label('スパーク', -0.8, 1.5, '#c0201a', 12, '#e0302a', 24);
    dot(c, X(0.8), Z(1.5), 12, '#1f6ad6', '主', '#fff', 13);
    P.label('主人公（立ち）', 0.8, 1.5, '#1f4ab0', 12, '#3a7dff', 24);
    dot(c, X(0.95), Z(0), 8, '#1f6ad6', '寝');
    const cams: [string, number, number][] = [['広角', 5.4, 4.3], ['肩越し(ス)', -2.9, 2.85], ['肩越し(主)', 2.4, 0.85], ['ベッド', 0.5, 3.0]];
    for (const [n, x, z] of cams) {
      c.fillStyle = '#7a4ac8'; c.beginPath(); c.moveTo(X(x), Z(z) - 9); c.lineTo(X(x) + 9, Z(z) + 7); c.lineTo(X(x) - 9, Z(z) + 7); c.closePath(); c.fill();
      P.label(`カメラ：${n}`, x, z, '#6a3ab8', 11, '#7a4ac8', -22);
    }

    // 部屋名・スケール・北
    c.fillStyle = INK; c.font = `bold 20px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('スパーク特別研究室（14m × 10m・天井高 3.5m）', X(minX) + 10, Z(minZ) + 20);
    P.scale(2, '2m');
    c.fillText('N ↑', X(maxX) - 60, Z(minZ) + 20);

    // 凡例
    const L = new Legend(c, W - LEGEND_W + 10, PAD, H);
    L.title('スパーク特別研究室  平面図');
    L.note('北が上。方眼1マス＝1m。', '戦闘のない会話シーン用の部屋。', '3D は lab.html で見られる。');
    L.swatch('壁', WALL);
    L.swatch('机（モニター付き）', '#f3efe6', '#4a5562');
    L.swatch('棚・遮蔽物', '#9aa5b4', '#4a5562');
    L.swatch('濃い青の機械（ベッド台座・作業台・ナノ組立機）', '#24385f', '#10203f');
    L.swatch('サーバーラック', '#56616c', '#2a2f36');
    L.swatch('木箱', '#c9a36b', '#7a5a2c');
    L.swatch('ブラストドア（西壁）', '#ffd83a', '#2a2f36');
    L.item('スパーク／主人公の立ち位置', (x, y) => dot(c, x, y, 9, '#e0302a'));
    L.item('カメラ位置', (x, y) => { c.fillStyle = '#7a4ac8'; c.beginPath(); c.moveTo(x, y - 8); c.lineTo(x + 8, y + 6); c.lineTo(x - 8, y + 6); c.fill(); });
    L.item('スキャンリング（動く）', (x, y) => { c.setLineDash([4, 3]); c.strokeStyle = '#2ee6ff'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, 8, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); });
  }
  draw();
  return { canvas: cv, draw, placed: [], fileName: 'spark_lab_map.png' };
}
