// サージ収容所への道のテクスチャ（canvas で描く。テスト環境など document が無いときは undefined を返し、無地で描く）
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

/** 点の汚れ（ノイズ） */
function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, seed: number, light = 'rgba(255,255,255,0.05)', dark = 'rgba(0,0,0,0.12)'): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() < 0.5 ? light : dark;
    const s = 1 + Math.floor(r() * 3);
    g.fillRect(Math.floor(r() * w), Math.floor(r() * h), s, s);
  }
}

// ---------------------------------------------------------------- 道路
/** アスファルト＋車線（u=道に沿って 8m、v=道を横切って 16m）。emissive は縁のシアンの道路鋲 */
export function asphaltTex(): { map?: THREE.Texture; emissive?: THREE.Texture } {
  const map = mk(256, 512, (g, w, h) => {
    g.fillStyle = '#34363e'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 5200, 11, 'rgba(255,255,255,0.07)', 'rgba(0,0,0,0.18)');
    const r = rng(5);
    // 路面の汚れ・タイヤ跡（走行レーンの帯）
    for (const cy of [h * 0.3, h * 0.7]) {
      for (const dy of [-26, 26]) {
        g.fillStyle = 'rgba(8,9,12,0.28)'; g.fillRect(0, cy + dy - 9, w, 18);
      }
    }
    // ひび
    g.strokeStyle = 'rgba(10,10,14,0.5)'; g.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      let x = r() * w, y = r() * h;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.4) * 24; y += (r() - 0.5) * 24; g.lineTo(x, y); }
      g.stroke();
    }
    // 縁の白線（0.15m）とセンターの破線（4m 引いて 4m 空け）
    g.fillStyle = '#d6dae0';
    g.fillRect(0, 14, w, 5); g.fillRect(0, h - 19, w, 5);
    g.fillStyle = '#e8c860';
    g.fillRect(0, h / 2 - 2, w / 2 - 6, 5);
    // 路肩の淡いシアンの帯
    g.fillStyle = 'rgba(82,232,255,0.10)';
    g.fillRect(0, 19, w, 10); g.fillRect(0, h - 29, w, 10);
  });
  const emissive = mk(256, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#52e8ff';
    for (let i = 0; i < 4; i++) { g.fillRect(i * 64 + 26, 30, 12, 8); g.fillRect(i * 64 + 26, h - 38, 12, 8); }
    g.fillStyle = '#ffb040';
    g.fillRect(8, h / 2 - 2, 10, 5);
  });
  return { map, emissive };
}

export function sidewalkTex(): THREE.Texture | undefined {
  return mk(128, 128, (g, w, h) => {
    g.fillStyle = '#8c8a8a'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 900, 3, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.10)');
    g.strokeStyle = 'rgba(40,36,36,0.65)'; g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
  });
}

/** 火星の赤い大地（30m で繰り返し） */
export function groundTex(): THREE.Texture | undefined {
  return mk(256, 256, (g, w, h) => {
    g.fillStyle = '#7d4a38'; g.fillRect(0, 0, w, h);
    const r = rng(9);
    for (let i = 0; i < 90; i++) {
      const x = r() * w, y = r() * h, rad = 8 + r() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      const dark = r() < 0.5;
      gr.addColorStop(0, dark ? 'rgba(50,25,18,0.22)' : 'rgba(210,140,100,0.16)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    speckle(g, w, h, 2600, 4, 'rgba(255,200,150,0.10)', 'rgba(30,10,5,0.18)');
  });
}

// ---------------------------------------------------------------- 建物の外壁
/**
 * 外壁タイル：8列×8行の窓（横 3m・縦 3.6m、タイル全体 24m×28.8m）。
 * style 'office'＝コンクリートに窓、'glass'＝ガラスのカーテンウォール。emissive は灯っている窓だけ
 */
export function facadeTex(style: 'office' | 'glass'): { map?: THREE.Texture; emissive?: THREE.Texture } {
  const N = 8, S = 512, C = S / N;
  const lit: { x: number; y: number; col: string }[] = [];
  const r = rng(style === 'office' ? 21 : 34);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const p = r();
    const warm = ['#ffd890', '#ffc870', '#ffe9b8'];
    const cool = ['#6fc8e0', '#9fc4e8', '#5fb0d8'];
    if (p < (style === 'office' ? 0.30 : 0.15)) lit.push({ x: i, y: j, col: (style === 'office' ? warm : cool)[Math.floor(r() * 3)] });
  }
  const map = mk(S, S, (g) => {
    if (style === 'office') {
      g.fillStyle = '#b4b8c0'; g.fillRect(0, 0, S, S);
      speckle(g, S, S, 3500, 8, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.10)');
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = i * C, y = j * C;
        // 窓の凹み
        g.fillStyle = '#51596a'; g.fillRect(x + 7, y + 9, C - 14, C - 22);
        const gr = g.createLinearGradient(x, y + 9, x + C, y + C - 13);
        gr.addColorStop(0, '#2d3c56'); gr.addColorStop(1, '#16202f');
        g.fillStyle = gr; g.fillRect(x + 10, y + 12, C - 20, C - 28);
        g.fillStyle = 'rgba(180,210,255,0.16)'; g.fillRect(x + 10, y + 12, (C - 20) * 0.45, C - 28);
        // 窓の桟
        g.fillStyle = '#7a8392'; g.fillRect(x + C / 2 - 1, y + 12, 2, C - 28);
        // 階ごとの水平の出っ張り
        g.fillStyle = '#8a929e'; g.fillRect(x, y + C - 8, C, 5);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + C - 3, C, 3);
      }
      for (let i = 0; i <= N; i++) { g.fillStyle = 'rgba(70,76,88,0.5)'; g.fillRect(i * C - 1, 0, 2, S); }
    } else {
      g.fillStyle = '#243752'; g.fillRect(0, 0, S, S);
      const gr = g.createLinearGradient(0, 0, S, S);
      gr.addColorStop(0, 'rgba(160,200,255,0.30)'); gr.addColorStop(0.5, 'rgba(60,90,140,0.0)'); gr.addColorStop(1, 'rgba(255,200,160,0.18)');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = i * C, y = j * C;
        g.fillStyle = `rgba(${20 + ((i * 7 + j * 3) % 5) * 6},${44 + ((i * 3 + j * 5) % 4) * 8},${80 + ((i + j) % 3) * 10},0.7)`;
        g.fillRect(x + 3, y + 3, C - 6, C - 14);
        g.fillStyle = '#9db4d0'; g.fillRect(x, y + C - 9, C, 6);       // 階の帯（スパンドレル）
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y + C - 3, C, 3);
      }
      for (let i = 0; i <= N; i++) { g.fillStyle = 'rgba(190,210,235,0.55)'; g.fillRect(i * C - 1, 0, 2, S); }
    }
    for (const w of lit) {
      const x = w.x * C, y = w.y * C;
      g.fillStyle = w.col;
      if (style === 'office') g.fillRect(x + 10, y + 12, C - 20, C - 28);
      else g.fillRect(x + 3, y + 3, C - 6, C - 14);
    }
  });
  const emissive = mk(S, S, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    for (const w of lit) {
      const x = w.x * C, y = w.y * C;
      g.fillStyle = w.col;
      if (style === 'office') g.fillRect(x + 10, y + 12, C - 20, C - 28);
      else g.fillRect(x + 3, y + 3, C - 6, C - 14);
    }
  });
  return { map, emissive };
}

// ---------------------------------------------------------------- 柵・シャッター・壁
/** 金網（ひし形）。背景は透明（alphaTest で使う） */
export function fenceTex(): THREE.Texture | undefined {
  return mk(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.lineCap = 'round';
    const s = w / 2;
    for (let i = -2; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s + w, h); g.stroke();
      g.beginPath(); g.moveTo(i * s + w, 0); g.lineTo(i * s, h); g.stroke();
    }
  });
}

/** ローラーシャッターの横スジ（1m で繰り返し） */
export function shutterTex(): THREE.Texture | undefined {
  return mk(64, 64, (g, w, h) => {
    g.fillStyle = '#8f99a8'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      const gr = g.createLinearGradient(0, y, 0, y + 16);
      gr.addColorStop(0, '#b4bdca'); gr.addColorStop(0.6, '#8791a0'); gr.addColorStop(1, '#4b5361');
      g.fillStyle = gr; g.fillRect(0, y, w, 16);
    }
    speckle(g, w, h, 160, 6);
  });
}

/** 収容所の壁（横 40m × 縦 14m のタイル）：コンクリートの大パネル、継ぎ目、錆の筋、格子窓 */
export function compoundWallTex(): THREE.Texture | undefined {
  return mk(1024, 360, (g, w, h) => {
    g.fillStyle = '#6d6a6c'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 9000, 17, 'rgba(255,255,255,0.06)', 'rgba(0,0,0,0.13)');
    const r = rng(13);
    // 錆・雨だれの縦筋
    for (let i = 0; i < 70; i++) {
      const x = r() * w, y0 = r() * h * 0.6, len = 40 + r() * 190;
      const gr = g.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, 'rgba(110,52,30,0.0)'); gr.addColorStop(0.2, 'rgba(110,52,30,0.28)'); gr.addColorStop(1, 'rgba(60,30,20,0)');
      g.fillStyle = gr; g.fillRect(x, y0, 2 + r() * 5, len);
    }
    // 大パネルの継ぎ目（10m × 7m）
    g.fillStyle = 'rgba(20,20,24,0.8)';
    for (let i = 0; i <= 4; i++) g.fillRect(i * (w / 4) - 2, 0, 4, h);
    g.fillRect(0, h / 2 - 2, w, 4);
    g.fillRect(0, 0, w, 3);
    // 鋲
    g.fillStyle = 'rgba(30,30,34,0.9)';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) for (const [dx, dy] of [[10, 10], [w / 4 - 10, 10], [10, h / 2 - 10], [w / 4 - 10, h / 2 - 10]]) {
      g.beginPath(); g.arc(i * (w / 4) + dx, j * (h / 2) + dy, 3, 0, 7); g.fill();
    }
    // 格子窓（細長いスリット）：各パネルの中ほどに3つ
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      for (let k = 0; k < 3; k++) {
        const x = i * (w / 4) + 70 + k * 62, y = j * (h / 2) + 46;
        g.fillStyle = '#12141a'; g.fillRect(x, y, 34, 70);
        const on = r() < 0.55;
        if (on) { g.fillStyle = '#ffb44a'; g.fillRect(x + 3, y + 3, 28, 64); }
        g.fillStyle = '#2a2c34';
        for (let b = 0; b < 4; b++) g.fillRect(x + 4 + b * 8, y, 3, 70);
      }
    }
  });
}

/** 広告看板（ネオン）。n=0..5 */
export function adTex(n: number): THREE.Texture | undefined {
  const defs: [string, string, string][] = [
    ['SURGE CITY', '#ff4ad0', '#52e8ff'],
    ['電気の街', '#52e8ff', '#ffc21a'],
    ['HOTEL OLYMPUS', '#ffc21a', '#ff5a4a'],
    ['ENERGY+', '#7aff9a', '#52e8ff'],
    ['火星ステーション', '#ff8a4a', '#ffe6a0'],
    ['NEO MARS 2099', '#9a8cff', '#ff4ad0'],
  ];
  const [text, c1, c2] = defs[n % defs.length];
  return mk(512, 256, (g, w, h) => {
    g.fillStyle = 'rgba(10,14,28,0.88)'; g.fillRect(0, 0, w, h);
    g.strokeStyle = c1; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
    g.strokeStyle = c2; g.lineWidth = 3; g.strokeRect(24, 24, w - 48, h - 48);
    let size = 90;
    const font = (s: number) => `bold ${s}px "Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo",sans-serif`;
    g.font = font(size);
    while (g.measureText(text).width > w - 90 && size > 24) { size -= 4; g.font = font(size); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = c1; g.shadowBlur = 22; g.fillStyle = '#ffffff';
    g.fillText(text, w / 2, h / 2 - 8);
    g.shadowBlur = 0; g.fillStyle = c2; g.fillRect(70, h - 62, w - 140, 7);
  }, { repeat: false, aniso: 4 });
}

/** 縦方向のグラデーション（投光器の光線・サーチライト用）。上が明るく下が消える */
export function beamTex(): THREE.Texture | undefined {
  return mk(32, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const gx = g.createLinearGradient(0, 0, w, 0);
    gx.addColorStop(0, 'rgba(0,0,0,0.85)'); gx.addColorStop(0.5, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = gx; g.fillRect(0, 0, w, h);
  }, { repeat: false });
}

/** 放射状の光（太陽・街灯のにじみ） */
export function glowTex(): THREE.Texture | undefined {
  return mk(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.65)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.15)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { repeat: false });
}

/** 看板（収容所・ガレージなど） */
export function signTex(text: string, theme: 'red' | 'cyan' | 'amber', w = 1024, h = 256): THREE.Texture | undefined {
  const col = theme === 'red' ? '#ff5a4a' : theme === 'amber' ? '#ffb040' : '#6ff0ff';
  return mk(w, h, (g, ww, hh) => {
    g.fillStyle = 'rgba(14,16,24,0.92)'; g.beginPath(); g.roundRect(6, 6, ww - 12, hh - 12, 30); g.fill();
    g.strokeStyle = col; g.lineWidth = 10; g.beginPath(); g.roundRect(6, 6, ww - 12, hh - 12, 30); g.stroke();
    let size = hh * 0.55;
    const font = (s: number) => `bold ${s}px "Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo",sans-serif`;
    g.font = font(size);
    while (g.measureText(text).width > ww - 100 && size > 20) { size -= 4; g.font = font(size); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = col; g.shadowBlur = 24; g.fillStyle = '#ffffff';
    g.fillText(text, ww / 2, hh / 2 + 4);
  }, { repeat: false, aniso: 8 });
}
