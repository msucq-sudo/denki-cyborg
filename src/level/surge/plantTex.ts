// ルート2の発電所・坂・ドレイン装置のテクスチャ（canvas で描く。document が無い環境では undefined を返し、無地で描く）
import * as THREE from 'three';
import { rng } from './batch';

function mk(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, opt: { srgb?: boolean; aniso?: number; repeat?: boolean } = {}): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  if (opt.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = opt.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = opt.aniso ?? 8;
  return t;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, seed: number, light = 'rgba(255,255,255,0.06)', dark = 'rgba(0,0,0,0.08)'): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() < 0.5 ? light : dark;
    const s = 1 + Math.floor(r() * 2);
    g.fillRect(Math.floor(r() * w), Math.floor(r() * h), s, s);
  }
}

/**
 * 建物の外壁（クリーム色の壁）。横 24m × 縦 8m のタイル。
 * 'ribbon'＝帯状の窓つき（原子炉建屋・補助建屋）、'panel'＝窓の無い大きなパネル（タービン建屋）
 */
export function plantWallTex(kind: 'ribbon' | 'panel'): THREE.Texture | undefined {
  return mk(512, 256, (g, w, h) => {
    g.fillStyle = '#f6f1e2'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2600, kind === 'ribbon' ? 3 : 4);
    const r = rng(kind === 'ribbon' ? 31 : 32);
    // 雨だれの筋
    for (let i = 0; i < 26; i++) {
      const x = r() * w, y0 = r() * h * 0.5, len = 30 + r() * 120;
      const gr = g.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, 'rgba(120,100,70,0)'); gr.addColorStop(0.3, 'rgba(120,100,70,0.13)'); gr.addColorStop(1, 'rgba(120,100,70,0)');
      g.fillStyle = gr; g.fillRect(x, y0, 2 + r() * 3, len);
    }
    // 縦の継ぎ目（6m ごと）
    g.fillStyle = 'rgba(150,140,115,0.55)';
    for (let i = 0; i < 4; i++) g.fillRect(i * (w / 4), 0, 3, h);
    if (kind === 'ribbon') {
      // 帯状の窓
      const y0 = h * 0.26, y1 = h * 0.62;
      const gr = g.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, '#6f8499'); gr.addColorStop(0.5, '#3c4c60'); gr.addColorStop(1, '#27323f');
      g.fillStyle = gr; g.fillRect(0, y0, w, y1 - y0);
      g.fillStyle = 'rgba(190,215,235,0.22)';
      for (let x = 0; x < w; x += 64) g.fillRect(x + 6, y0 + 3, 22, (y1 - y0) - 6);
      g.fillStyle = '#c9c1a8';
      for (let x = 0; x < w; x += 32) g.fillRect(x, y0, 3, y1 - y0);
      g.fillStyle = '#fbf8ec'; g.fillRect(0, y1, w, 6);
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, y1 + 6, w, 5);
      g.fillStyle = '#d4ccb2'; g.fillRect(0, y0 - 5, w, 5);
      // 下の段の通気ルーバー
      g.fillStyle = 'rgba(80,72,58,0.55)';
      for (const x of [60, 316]) for (let k = 0; k < 6; k++) g.fillRect(x, h * 0.74 + k * 6, 56, 3);
    } else {
      // 水平の継ぎ目と大きなルーバー
      g.fillStyle = 'rgba(150,140,115,0.55)'; g.fillRect(0, h * 0.5, w, 3);
      g.fillStyle = 'rgba(80,72,58,0.5)';
      for (const x of [40, 296]) for (let k = 0; k < 9; k++) g.fillRect(x, 30 + k * 8, 80, 3);
      g.fillStyle = '#d4ccb2'; g.fillRect(0, 0, w, 4);
    }
  });
}

/** ドームの外装（半球の UV：上 = 頂点、下 = 縁）。淡いミントと白の帯、縦の継ぎ目 */
export function domeTex(): THREE.Texture | undefined {
  return mk(256, 256, (g, w, h) => {
    const bands: [number, string][] = [[0.0, '#cdeedd'], [0.30, '#f6f8f2'], [0.38, '#a8dcc4'], [0.62, '#f2f6ee'], [0.70, '#9ed6bd'], [0.92, '#f4f4ec']];
    for (let i = 0; i < bands.length; i++) {
      const y0 = bands[i][0] * h, y1 = (bands[i + 1]?.[0] ?? 1) * h;
      g.fillStyle = bands[i][1]; g.fillRect(0, y0, w, y1 - y0 + 1);
    }
    speckle(g, w, h, 1800, 7, 'rgba(255,255,255,0.10)', 'rgba(40,70,60,0.10)');
    g.fillStyle = 'rgba(70,110,95,0.35)';
    for (let i = 0; i < 16; i++) g.fillRect(i * (w / 16), 0, 2, h);          // 縦の継ぎ目
    g.fillStyle = 'rgba(70,110,95,0.5)';
    for (const b of [0.30, 0.38, 0.62, 0.70, 0.92]) g.fillRect(0, b * h - 1, w, 2);
  }, { aniso: 4 });
}

/** 円筒の建物（上から薄い黄・ミント・白の帯）。u=周、v=高さ（上が上） */
export function bandTex(): THREE.Texture | undefined {
  return mk(256, 512, (g, w, h) => {
    const bands: [number, string][] = [[0, '#9aa0a4'], [0.05, '#f2e7a8'], [0.26, '#f6f6ee'], [0.34, '#a6dcc4'], [0.58, '#f3f5ee'], [0.66, '#a0d8be'], [0.90, '#f1e6a6'], [0.97, '#8d9296']];
    for (let i = 0; i < bands.length; i++) {
      const y0 = bands[i][0] * h, y1 = (bands[i + 1]?.[0] ?? 1) * h;
      g.fillStyle = bands[i][1]; g.fillRect(0, y0, w, y1 - y0 + 1);
    }
    speckle(g, w, h, 2400, 11, 'rgba(255,255,255,0.10)', 'rgba(40,70,60,0.10)');
    // 縦長の窓スリット
    g.fillStyle = 'rgba(40,60,76,0.75)';
    for (let i = 0; i < 16; i++) for (const [a, b] of [[0.10, 0.20], [0.40, 0.50], [0.70, 0.80]]) g.fillRect(i * (w / 16) + 8, a * h, 8, (b - a) * h);
    g.fillStyle = 'rgba(70,110,95,0.4)';
    for (let i = 0; i < 8; i++) g.fillRect(i * (w / 8), 0, 2, h);
  }, { aniso: 4 });
}

/** 海（40m で繰り返し）。深い青緑にさざ波 */
export function seaTex(): THREE.Texture | undefined {
  return mk(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#1b5a78'); gr.addColorStop(1, '#14485f');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const r = rng(77);
    g.lineCap = 'round';
    for (let i = 0; i < 160; i++) {
      const x = r() * w, y = r() * h, len = 10 + r() * 30;
      g.strokeStyle = r() < 0.25 ? 'rgba(235,245,250,0.28)' : 'rgba(110,190,215,0.26)';
      g.lineWidth = 1 + r() * 1.6;
      for (const ox of [-w, 0, w]) { g.beginPath(); g.moveTo(x + ox, y); g.quadraticCurveTo(x + ox + len / 2, y - 3, x + ox + len, y); g.stroke(); }
    }
  }, { aniso: 4 });
}

/** 護岸の斜面（コンクリートブロック。6m で繰り返し） */
export function blockTex(): THREE.Texture | undefined {
  return mk(128, 128, (g, w, h) => {
    g.fillStyle = '#9a9c9e'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 900, 5, 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.14)');
    g.strokeStyle = 'rgba(40,42,46,0.7)'; g.lineWidth = 2;
    for (let j = 0; j < 4; j++) {
      const y = j * 32, off = (j % 2) * 16;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(off + i * 32, y); g.lineTo(off + i * 32, y + 32); g.stroke(); }
    }
    g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(0, 0, w, 14);
    g.fillStyle = 'rgba(30,60,70,0.22)'; g.fillRect(0, h - 22, w, 22);   // 下側は波で濡れて暗い
  }, { aniso: 4 });
}

/** ドレイン装置の鋼板（濃紺。8m で繰り返し）：パネルの継ぎ目・リベット・排気口 */
export function steelTex(): THREE.Texture | undefined {
  return mk(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#4a5878'); gr.addColorStop(1, '#394662');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 1800, 21, 'rgba(160,190,255,0.07)', 'rgba(0,0,0,0.18)');
    g.strokeStyle = '#121828'; g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, w - 3, h - 3);
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    g.fillStyle = '#4b5878';
    for (const [x, y] of [[10, 10], [w / 2 - 10, 10], [w / 2 + 10, 10], [w - 10, 10], [10, h / 2 - 10], [w - 10, h / 2 - 10], [10, h - 10], [w - 10, h - 10]]) { g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(8,10,18,0.7)';
    for (let k = 0; k < 6; k++) g.fillRect(34, 150 + k * 8, 70, 3);        // 排気口
    g.fillStyle = 'rgba(82,232,255,0.55)'; g.fillRect(150, 40, 70, 3);      // 細い光のライン
    g.fillStyle = 'rgba(255,200,60,0.45)'; g.fillRect(150, 52, 30, 3);
  }, { aniso: 8 });
}

/**
 * 坂の路面（横 24m × 幅 14m のタイル。u=登る向き(+X)）。
 * map＝暗い鋼板＋リブ＋縁のハザード帯＋黄色いシェブロン。emissive＝シアンのシェブロンと誘導灯（流して使う）
 */
export function deckTex(): { map?: THREE.Texture; emissive?: THREE.Texture } {
  const W = 512, H = 256;
  const chevron = (g: CanvasRenderingContext2D, cx: number, color: string, lw: number): void => {
    g.strokeStyle = color; g.lineWidth = lw; g.lineJoin = 'miter'; g.lineCap = 'butt';
    g.beginPath(); g.moveTo(cx - 40, 54); g.lineTo(cx, H / 2); g.lineTo(cx - 40, H - 54); g.stroke();
  };
  const map = mk(W, H, (g) => {
    g.fillStyle = '#2b2f38'; g.fillRect(0, 0, W, H);
    speckle(g, W, H, 4200, 41, 'rgba(255,255,255,0.07)', 'rgba(0,0,0,0.2)');
    // 縁のハザード帯
    for (const y0 of [0, H - 18]) {
      g.fillStyle = '#d9a416'; g.fillRect(0, y0, W, 18);
      g.fillStyle = '#161b26';
      for (let x = -20; x < W + 20; x += 24) { g.beginPath(); g.moveTo(x, y0 + 18); g.lineTo(x + 12, y0 + 18); g.lineTo(x + 24, y0); g.lineTo(x + 12, y0); g.closePath(); g.fill(); }
    }
    // ステップ状のリブ（6m ごと）
    for (let i = 0; i < 4; i++) {
      const x = i * (W / 4);
      g.fillStyle = '#4a515e'; g.fillRect(x, 18, 9, H - 36);
      g.fillStyle = '#7b8494'; g.fillRect(x, 18, 3, H - 36);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 9, 18, 6, H - 36);
    }
    // 中央の破線
    g.fillStyle = 'rgba(230,220,170,0.7)';
    for (let i = 0; i < 4; i++) g.fillRect(i * (W / 4) + 40, H / 2 - 2, 50, 4);
    // 黄色いシェブロン（12m ごと）
    for (const cx of [W * 0.25 + 60, W * 0.75 + 60]) chevron(g, cx, 'rgba(230,180,34,0.85)', 15);
  }, { aniso: 8 });
  const emissive = mk(W, H, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    for (const cx of [W * 0.25 + 60, W * 0.75 + 60]) { chevron(g, cx, '#52e8ff', 9); chevron(g, cx - 28, '#2a8fa6', 5); }
    g.fillStyle = '#52e8ff';
    for (let i = 0; i < 4; i++) { g.fillRect(i * (W / 4) + 100, 22, 24, 6); g.fillRect(i * (W / 4) + 100, H - 28, 24, 6); }
  }, { aniso: 8 });
  return { map, emissive };
}

/** 吸い込み脚の中を流れるエネルギー（u=周、v=脚に沿って 10m で繰り返し。加算合成。シアンと黄色の光の塊が交互） */
export function conduitTex(): THREE.Texture | undefined {
  return mk(32, 256, (g, w, h) => {
    g.fillStyle = 'rgb(14,52,64)'; g.fillRect(0, 0, w, h);                 // 常にうっすら光る
    const blob = (y: number, len: number, c0: string, c1: string): void => {
      const gr = g.createLinearGradient(0, y - len, 0, y + len * 0.3);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.75, c0); gr.addColorStop(0.9, c1); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, y - len, w, len * 1.3);
    };
    blob(h * 0.48, h * 0.4, 'rgba(30,170,255,0.9)', 'rgba(110,225,255,1)');
    blob(h * 0.98, h * 0.3, 'rgba(255,170,20,0.9)', 'rgba(255,225,90,1)');
  }, { srgb: false });
}

/** 貫いた点のひび割れと光（ドームに貼る。中心＝貫通点。加算合成） */
export function crackTex(): THREE.Texture | undefined {
  return mk(256, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const c = w / 2;
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(160,250,255,0.9)'); gr.addColorStop(0.35, 'rgba(40,140,190,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const r = rng(99);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2 + r() * 0.3;
      const col = i % 2 ? '#52e8ff' : '#ffd23a';
      g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = 8; g.lineWidth = 2.2 + r() * 1.6;
      let x = c, y = c, a = a0, rad = 14 + r() * 8;
      g.beginPath(); g.moveTo(x, y);
      while (rad < c - 6) {
        a += (r() - 0.5) * 0.7;
        x = c + Math.cos(a) * rad; y = c + Math.sin(a) * rad;
        g.lineTo(x, y);
        if (r() < 0.25) { // 枝分かれ
          g.moveTo(x, y); g.lineTo(x + Math.cos(a + 0.9) * 14, y + Math.sin(a + 0.9) * 14); g.moveTo(x, y);
        }
        rad += 10 + r() * 14;
      }
      g.stroke();
    }
    g.shadowBlur = 0;
    // 外周のリング
    g.strokeStyle = 'rgba(120,230,255,0.55)'; g.lineWidth = 3;
    g.beginPath(); g.arc(c, c, c * 0.5, 0, 7); g.stroke();
    g.strokeStyle = 'rgba(255,210,70,0.4)'; g.lineWidth = 2;
    g.beginPath(); g.arc(c, c, c * 0.72, 0.3, 4.2); g.stroke();
  }, { repeat: false });
}

/** 光の柱（縦のグラデーション。下が明るく上へ消える。加算合成のマスク） */
export function pillarTex(): THREE.Texture | undefined {
  return mk(16, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, h, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { repeat: false, srgb: false });
}
