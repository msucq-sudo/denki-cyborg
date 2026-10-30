// サージ収容所への道（?level=surge）の平面図。level/surge/layout.ts の取り決め（数値）から描く。
// 道が 1.7km あるので、上に全体図、下に「階段〜ガレージ〜T字路」と「収容所の前」の拡大図を置く。
import { CHECKPOINT, COMPOUND, ENTRANCE, GARAGE, ROAD, STAIRS } from '../../level/surge/layout';
import { Legend, Plot, WALL, dot, newCanvas, FONT, INK, type R2, type StageSheet } from './common';

export function createSurgeSheet(): StageSheet {
  const PAD = 70, LEGEND_W = 440, GAP = 120;
  const jz = ROAD.junctionZ;
  const half = ROAD.width / 2 + ROAD.sidewalk;
  const bW = COMPOUND.wallX - COMPOUND.depth;

  const ov = { px: 0.9, minX: -1800, maxX: 100, minZ: -260, maxZ: 80, grid: 100 };
  const d1 = { px: 6, minX: -40, maxX: 40, minZ: -110, maxZ: 50, grid: 10 };
  const d2 = { px: 1.6, minX: -1800, maxX: -1340, minZ: -260, maxZ: 80, grid: 20 };
  const ovW = (ov.maxX - ov.minX) * ov.px, ovH = (ov.maxZ - ov.minZ) * ov.px;
  const d1W = (d1.maxX - d1.minX) * d1.px, d1H = (d1.maxZ - d1.minZ) * d1.px;
  const d2W = (d2.maxX - d2.minX) * d2.px, d2H = (d2.maxZ - d2.minZ) * d2.px;
  const mapW = Math.max(ovW, d1W + GAP + d2W);
  const W = mapW + PAD * 2 + LEGEND_W;
  const H = PAD + ovH + GAP + Math.max(d1H, d2H) + PAD;
  const { cv, c } = newCanvas(W, H);
  const PO = new Plot(c, PAD, PAD, ov.px, ov.minX, ov.maxX, ov.minZ, ov.maxZ, ov.grid);
  const y2 = PAD + ovH + GAP;
  const P1 = new Plot(c, PAD, y2, d1.px, d1.minX, d1.maxX, d1.minZ, d1.maxZ, d1.grid);
  const P2 = new Plot(c, PAD + d1W + GAP, y2, d2.px, d2.minX, d2.maxX, d2.minZ, d2.maxZ, d2.grid);

  const stairs: R2 = { x0: -STAIRS.width / 2, x1: STAIRS.width / 2, z0: GARAGE.z1 + 1, z1: STAIRS.backZ };
  const garage: R2 = { x0: GARAGE.x0, x1: GARAGE.x1, z0: GARAGE.z0, z1: GARAGE.z1 };
  const building: R2 = { x0: bW, x1: COMPOUND.wallX, z0: jz - COMPOUND.width / 2, z1: jz + COMPOUND.width / 2 };

  /** 道・建物など（全体図と拡大図で共通） */
  function base(P: Plot, detail: boolean): void {
    const { X, Z } = P;
    c.save();
    c.beginPath(); c.rect(P.ox, P.oy, P.w, P.h); c.clip();
    // 街（入れない）
    c.fillStyle = '#efe6dc'; c.fillRect(P.ox, P.oy, P.w, P.h);
    // 歩道・道
    const ns: R2 = { x0: -half, x1: half, z0: jz - half, z1: GARAGE.z0 - 1 };
    const ew: R2 = { x0: COMPOUND.wallX, x1: ROAD.eastFenceX + 0.5, z0: jz - half, z1: jz + half };
    P.rect(ns, '#dfe3e8'); P.rect(ew, '#dfe3e8');
    P.rect({ x0: -ROAD.width / 2, x1: ROAD.width / 2, z0: jz - ROAD.width / 2, z1: GARAGE.z0 - 1 }, '#aab2bd');
    P.rect({ x0: COMPOUND.wallX, x1: ROAD.eastFenceX, z0: jz - ROAD.width / 2, z1: jz + ROAD.width / 2 }, '#aab2bd');
    // 中央線
    c.strokeStyle = '#ffd83a'; c.lineWidth = Math.max(1, 0.3 * P.px); c.setLineDash([Math.max(4, 3 * P.px), Math.max(4, 3 * P.px)]);
    c.beginPath(); c.moveTo(X(0), Z(GARAGE.z0 - 1)); c.lineTo(X(0), Z(jz)); c.lineTo(X(COMPOUND.wallX), Z(jz)); c.stroke(); c.setLineDash([]);
    // 収容所の庭（入口の前）
    P.rect({ x0: COMPOUND.wallX, x1: COMPOUND.fenceX, z0: jz + half, z1: ENTRANCE.yardZ1 }, '#dfe3e8');
    // 階段ホール・ガレージ
    P.rect(stairs, '#e9edf2');
    P.rect(garage, '#e9edf2');
    if (detail) {
      // 段（南ほど高い）
      c.strokeStyle = 'rgba(40,70,120,0.35)'; c.lineWidth = 1;
      const n = STAIRS.steps, dz = (STAIRS.topStepZ - STAIRS.bottomZ) / n;
      for (let i = 0; i <= n; i++) { const z = STAIRS.bottomZ + i * dz; c.beginPath(); c.moveTo(X(stairs.x0), Z(z)); c.lineTo(X(stairs.x1), Z(z)); c.stroke(); }
      P.rect({ x0: stairs.x0, x1: stairs.x1, z0: STAIRS.topStepZ, z1: STAIRS.backZ }, 'rgba(90,170,230,0.30)', 'rgba(40,110,180,0.7)');
    }
    const wt = Math.max(GARAGE.wallT, detail ? 0 : 3);
    // ガレージの壁（南に入口、北にシャッター）
    const gw = (r: R2) => P.rect(r, WALL);
    gw({ x0: GARAGE.x0 - wt, x1: GARAGE.x0, z0: GARAGE.z0 - wt, z1: GARAGE.z1 + wt });
    gw({ x0: GARAGE.x1, x1: GARAGE.x1 + wt, z0: GARAGE.z0 - wt, z1: GARAGE.z1 + wt });
    gw({ x0: GARAGE.x0, x1: -GARAGE.shutterW / 2, z0: GARAGE.z0 - wt, z1: GARAGE.z0 });
    gw({ x0: GARAGE.shutterW / 2, x1: GARAGE.x1, z0: GARAGE.z0 - wt, z1: GARAGE.z0 });
    gw({ x0: GARAGE.x0, x1: -GARAGE.doorW / 2, z0: GARAGE.z1, z1: GARAGE.z1 + wt });
    gw({ x0: GARAGE.doorW / 2, x1: GARAGE.x1, z0: GARAGE.z1, z1: GARAGE.z1 + wt });
    // 階段ホールの壁
    gw({ x0: stairs.x0 - wt, x1: stairs.x0, z0: stairs.z0, z1: stairs.z1 + wt });
    gw({ x0: stairs.x1, x1: stairs.x1 + wt, z0: stairs.z0, z1: stairs.z1 + wt });
    gw({ x0: stairs.x0, x1: stairs.x1, z0: stairs.z1, z1: stairs.z1 + wt });
    // シャッター（赤）
    P.rect({ x0: -GARAGE.shutterW / 2, x1: GARAGE.shutterW / 2, z0: GARAGE.z0 - wt, z1: GARAGE.z0 }, '#e03030');
    // 東の柵
    c.strokeStyle = '#7a4a1c'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(X(ROAD.eastFenceX), Z(jz - half)); c.lineTo(X(ROAD.eastFenceX), Z(jz + half)); c.stroke();
    // 判定地点
    c.strokeStyle = '#ff8a00'; c.lineWidth = 3; c.setLineDash([8, 4]);
    c.beginPath(); c.moveTo(X(CHECKPOINT.x), Z(jz - half - 6)); c.lineTo(X(CHECKPOINT.x), Z(jz + half + 6)); c.stroke(); c.setLineDash([]);
    // 収容所の柵と建物
    c.strokeStyle = '#59636f'; c.lineWidth = 4;
    c.beginPath(); c.moveTo(X(COMPOUND.fenceX), Z(jz - COMPOUND.fenceHalf)); c.lineTo(X(COMPOUND.fenceX), Z(jz + COMPOUND.fenceHalf)); c.stroke();
    P.rect(building, '#5d6470', '#2b3442', 2);
    // 入口（非常口）
    c.fillStyle = '#20e080';
    c.fillRect(X(ENTRANCE.x) - 4, Z(ENTRANCE.z - ENTRANCE.w / 2), 8, Math.max(6, ENTRANCE.w * P.px));
    c.restore();
    P.grid(true, 13);
    c.strokeStyle = INK; c.lineWidth = 1.5; c.strokeRect(P.ox, P.oy, P.w, P.h);
  }

  function draw(): void {
    c.globalAlpha = 1;
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);

    // ---- 全体図
    base(PO, false);
    c.fillStyle = INK; c.font = `bold 15px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('全体図（方眼1マス＝100m）', PO.ox, PO.oy - 46);
    PO.label('ガレージ・階段', 0, 40, INK, 12, INK);
    PO.label('T字路', 40, jz - 30, INK, 12);
    PO.label('東は柵', ROAD.eastFenceX + 30, jz + 30, '#7a4a1c', 11);
    PO.label(`判定地点（${CHECKPOINT.kmh}km/h 以上で成功）`, CHECKPOINT.x, jz - half - 22, '#c06000', 12, '#ff8a00');
    PO.label('収容所の柵', COMPOUND.fenceX, jz - COMPOUND.fenceHalf - 12, '#3a4552', 12);
    PO.label('収容所の建物', (building.x0 + building.x1) / 2, jz - 60, '#2b3442', 13);
    PO.label('西へ一直線（車で加速）', -700, jz - 30, INK, 13);
    PO.label('街（道の外には入れない）', -400, jz + 70, '#9a7a5a', 12);
    // 拡大範囲の枠
    c.save(); c.setLineDash([5, 4]); c.strokeStyle = '#d02050'; c.lineWidth = 1.5;
    PO.rect({ x0: d1.minX, x1: d1.maxX, z0: d1.minZ, z1: d1.maxZ }, null, '#d02050', 1.5);
    PO.rect({ x0: d2.minX, x1: d2.maxX, z0: d2.minZ, z1: d2.maxZ }, null, '#d02050', 1.5);
    c.restore();
    PO.label('拡大①', d1.maxX + 30, d1.minZ + 10, '#d02050', 11);
    PO.label('拡大②', d2.maxX + 30, d2.minZ + 20, '#d02050', 11);

    // ---- 拡大①：階段〜ガレージ〜T字路
    base(P1, true);
    c.fillStyle = INK; c.font = `bold 15px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('拡大① 階段ホール〜ガレージ〜T字路（方眼1マス＝10m）', P1.ox, P1.oy - 46);
    {
      const { X, Z } = P1;
      P1.label(`階段ホール（${STAIRS.steps}段・高さ${STAIRS.topY}m）`, 0, (STAIRS.bottomZ + STAIRS.topStepZ) / 2, INK, 12);
      P1.label('ガレージ', 0, GARAGE.z1 - 3, INK, 15);
      // 車
      P1.rect({ x0: GARAGE.carX - 1.1, x1: GARAGE.carX + 1.1, z0: GARAGE.carZ - 2.3, z1: GARAGE.carZ + 2.3 }, '#ff5a3a', '#8a1f10', 2);
      c.fillStyle = '#fff'; c.font = 'bold 12px sans-serif'; c.textAlign = 'center'; c.fillText('▲', X(GARAGE.carX), Z(GARAGE.carZ - 1.2));
      P1.label('車（北向き。乗って道へ）', GARAGE.carX, GARAGE.carZ + 4.2, '#8a1f10', 11, '#ff5a3a');
      // ソケット
      c.fillStyle = '#18b6d6'; c.strokeStyle = '#0a5f70'; c.lineWidth = 2;
      c.fillRect(X(GARAGE.socketX) - 9, Z(GARAGE.socketZ) - 9 + 14, 18, 18); c.strokeRect(X(GARAGE.socketX) - 9, Z(GARAGE.socketZ) - 9 + 14, 18, 18);
      c.fillStyle = '#fff'; c.font = 'bold 12px sans-serif'; c.fillText('⚡', X(GARAGE.socketX), Z(GARAGE.socketZ) + 14.5);
      P1.label('電源ソケット', GARAGE.socketX + 12, GARAGE.socketZ + 2.3, '#0a5f70', 11, '#18b6d6');
      P1.label('シャッター', 0, GARAGE.z0 - 2.6, '#c02020', 11, '#e03030');
      // スタート（2階から降りてきた所）
      dot(c, X(STAIRS.topX), Z(STAIRS.topZ), 13, '#e02020', 'S', '#fff', 15);
      P1.label('スタート（2階の西の出口から）', STAIRS.topX, STAIRS.topZ - 3.6, '#e02020', 11, '#e02020');
      // チェックポイント（start=drive：車に乗った状態）
      const fx = X(GARAGE.carX) + 26, fy = Z(GARAGE.carZ);
      c.fillStyle = '#20a050'; c.beginPath(); c.moveTo(fx, fy + 10); c.lineTo(fx, fy - 14); c.lineTo(fx + 14, fy - 8); c.lineTo(fx, fy - 2); c.fill();
      P1.label('リトライ地点', GARAGE.carX + 9, GARAGE.carZ - 1.5, '#0d6a30', 10, '#20a050');
      P1.label('北の道', 0, -40, INK, 12);
      P1.label('T字路（西へ左折）', 0, jz + 7, INK, 12);
      P1.label('東は柵', ROAD.eastFenceX + 2, jz + half + 3, '#7a4a1c', 11);
      P1.label('← 西へ（収容所まで約1.6km）', -26, jz - 1, INK, 11);
    }

    // ---- 拡大②：収容所の前
    base(P2, true);
    c.fillStyle = INK; c.font = `bold 15px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('拡大② 判定地点〜収容所の前（方眼1マス＝20m）', P2.ox, P2.oy - 46);
    {
      P2.label(`判定地点 x=${CHECKPOINT.x}`, CHECKPOINT.x, jz - half - 16, '#c06000', 12, '#ff8a00');
      P2.label(`${CHECKPOINT.kmh}km/h 以上で通過→柵を突き破る`, CHECKPOINT.x, jz - half - 30, '#c06000', 11);
      P2.label('金属の柵', COMPOUND.fenceX + 12, jz - COMPOUND.fenceHalf + 10, '#3a4552', 12, '#59636f');
      P2.label('サージ収容所（建物）', (building.x0 + building.x1) / 2, jz - 50, '#2b3442', 14);
      P2.label('車が壁に激突して止まる', COMPOUND.wallX + 26, jz - 14, '#2b3442', 11);
      P2.label('庭（車を降りて歩く）', (COMPOUND.wallX + COMPOUND.fenceX) / 2, jz + half + 14, '#555', 11);
      P2.label('入口（非常口）→ 収容所1階', ENTRANCE.x + 40, ENTRANCE.z + 4, '#0d8a50', 12, '#20e080');
    }

    // ---- 凡例
    const L = new Legend(c, W - LEGEND_W + 10, PAD, H);
    L.title('サージ収容所への道  平面図');
    L.note('北が上。全体図・拡大図ごとに方眼の大きさが違う。', '2階の西の出口 → 階段 → ガレージ（車）→ 北の道', '→ T字路を西へ → 長い直線を加速 → 判定地点', '→ 柵を突き破って収容所の壁に激突 → 入口へ歩く', 'このステージに敵・歯車はない。');
    L.swatch('壁', WALL);
    L.swatch('道（車道）', '#aab2bd');
    L.swatch('歩道・庭（歩ける）', '#dfe3e8');
    L.swatch('街（入れない）', '#efe6dc');
    L.swatch('収容所の建物', '#5d6470', '#2b3442');
    L.swatch('上の踊り場（高さ10m）', 'rgba(90,170,230,0.5)', 'rgba(40,110,180,0.7)');
    L.item('シャッター（ソケットで開く）', (x, y) => { c.fillStyle = '#e03030'; c.fillRect(x - 10, y - 4, 20, 8); });
    L.item('⚡ 電源ソケット', (x, y) => { c.fillStyle = '#18b6d6'; c.fillRect(x - 8, y - 8, 16, 16); });
    L.item('車', (x, y) => { c.fillStyle = '#ff5a3a'; c.fillRect(x - 5, y - 9, 10, 18); });
    L.item('判定地点（速度チェック）', (x, y) => { c.strokeStyle = '#ff8a00'; c.lineWidth = 3; c.setLineDash([5, 3]); c.beginPath(); c.moveTo(x, y - 10); c.lineTo(x, y + 10); c.stroke(); c.setLineDash([]); });
    L.item('柵（東の行き止まり／収容所の柵）', (x, y) => { c.strokeStyle = '#59636f'; c.lineWidth = 4; c.beginPath(); c.moveTo(x, y - 10); c.lineTo(x, y + 10); c.stroke(); });
    L.item('入口（収容所1階へ）', (x, y) => { c.fillStyle = '#20e080'; c.fillRect(x - 4, y - 9, 8, 18); });
    L.item('S スタート', (x, y) => dot(c, x, y, 9, '#e02020'));
    L.item('リトライ地点（&start=drive）', (x, y) => { c.fillStyle = '#20a050'; c.beginPath(); c.moveTo(x - 4, y + 9); c.lineTo(x - 4, y - 9); c.lineTo(x + 8, y - 4); c.lineTo(x - 4, y + 1); c.fill(); });
    L.head('数値（layout.ts）');
    L.text(`道幅 ${ROAD.width}m＋歩道 ${ROAD.sidewalk}m×2`);
    L.text(`ガレージ ${GARAGE.x1 - GARAGE.x0}×${GARAGE.z1 - GARAGE.z0}m・シャッター幅 ${GARAGE.shutterW}m`);
    L.text(`T字路 z=${jz}・東の柵 x=${ROAD.eastFenceX}`);
    L.text(`判定地点 x=${CHECKPOINT.x}・柵 x=${COMPOUND.fenceX}・建物の壁 x=${COMPOUND.wallX}`);
    L.text(`建物 ${COMPOUND.depth}×${COMPOUND.width}m・高さ${COMPOUND.height}m`);
  }
  draw();
  return { canvas: cv, draw: () => draw(), placed: [], fileName: 'surge_map.png' };
}
