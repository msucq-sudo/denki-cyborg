// スパークの地下特別研究室（プロシージャル）。床 y=0、部屋は x:-7..7 / z:-5..5 / 高さ3.5m
// 会話シーン撮影用。静的な小物は材質ごとに1メッシュへ結合（描画数を抑える）
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface SparkLab {
  root: THREE.Group;
  anchors: Record<string, THREE.Object3D>;
  update(dt: number): void;
  dispose(): void;
}

const FONT = '"Yu Gothic","Meiryo","Hiragino Sans","Noto Sans CJK JP",sans-serif';
const HX = 7, HZ = 5, H = 3.5; // 半幅・半奥行・天井高

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSparkLab(): SparkLab {
  const rand = mulberry32(20261027);
  const rr = (a: number, b: number) => a + (b - a) * rand();
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length) % arr.length];
  const root = new THREE.Group();
  root.name = 'SparkLab';
  const anchors: Record<string, THREE.Object3D> = {};

  // ---- 後始末用 ----
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  const texs = new Set<THREE.Texture>();
  const instanced: THREE.InstancedMesh[] = [];

  // ---- 材質 ----
  const S = (color: number, rough = 0.65, metal = 0.1, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
    mats.add(m); return m;
  };
  const B = (color: number, extra: THREE.MeshBasicMaterialParameters = {}) => {
    const m = new THREE.MeshBasicMaterial({ color, toneMapped: false, ...extra });
    mats.add(m); return m;
  };
  const M = {
    white: S(0xf1f3f5, 0.5, 0.05), offwhite: S(0xdfe5ea, 0.55, 0.05), grey: S(0x9aa4ae, 0.45, 0.5),
    dgrey: S(0x56616c, 0.5, 0.5), black: S(0x2a2f36, 0.6, 0.2), navy: S(0x24385f, 0.5, 0.2), navy2: S(0x34508a, 0.5, 0.2),
    yellow: S(0xffd83a, 0.5, 0.05), orange: S(0xff8a3c, 0.55, 0.05), red: S(0xe0524a, 0.55, 0.05), green: S(0x59c98a, 0.55, 0.05),
    pink: S(0xe98fa3, 0.6, 0.05), cardboard: S(0xc9a273, 0.9, 0), wood: S(0xb98d5c, 0.8, 0), copper: S(0xd08a4a, 0.35, 0.8),
    rubber: S(0x30343a, 0.9, 0), desk: S(0xf3efe6, 0.55, 0), cyanSoft: S(0x7fd6e8, 0.4, 0.1), bedPad: S(0x9fd3ea, 0.6, 0),
    glass: S(0xbfefff, 0.1, 0.1, { transparent: true, opacity: 0.28, depthWrite: false }),
    cyan: B(0x2ee6ff), yellowGlow: B(0xffd83a), lamp: B(0xffffff), warm: B(0xfff1c8), cyanDim: B(0x1aa6bd), liquid: B(0x6ff0c0, { transparent: true, opacity: 0.8 }),
    liquidY: B(0xffe45a, { transparent: true, opacity: 0.8 }),
  };
  const boxCols = [M.white, M.cardboard, M.navy, M.orange, M.cyanSoft, M.yellow, M.grey, M.pink];

  // ---- テクスチャ ----
  const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, aniso = 8) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d')!; draw(g, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
    texs.add(t); return t;
  };

  // ---- 結合バッチ ----
  const gcache = new Map<string, THREE.BufferGeometry>();
  const flat = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
  const cached = (key: string, make: () => THREE.BufferGeometry) => {
    let g = gcache.get(key); if (!g) { g = make(); gcache.set(key, g); geos.add(g); } return g;
  };
  const toFlat = (g: THREE.BufferGeometry) => {
    let f = flat.get(g);
    if (!f) {
      f = g.index ? g.toNonIndexed() : g.clone();
      for (const k of Object.keys(f.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') f.deleteAttribute(k);
      flat.set(g, f);
    }
    return f;
  };
  const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  const tmpM = new THREE.Matrix4(), tmpE = new THREE.Euler(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const local = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s?: THREE.Vector3) =>
    new THREE.Matrix4().compose(tmpV.set(x, y, z), tmpQ.setFromEuler(tmpE.set(rx, ry, rz, 'YXZ')), s ?? one);
  const push = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => stack.push(stack[stack.length - 1].clone().multiply(local(x, y, z, rx, ry, rz)));
  const pushM = (m: THREE.Matrix4) => stack.push(m.clone());
  const pop = () => { stack.pop(); };
  const top = () => stack[stack.length - 1];
  const addGeo = (g: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4) => {
    const f = toFlat(g).clone();
    f.applyMatrix4(tmpM.copy(top()).multiply(m));
    let l = parts.get(mat); if (!l) { l = []; parts.set(mat, l); } l.push(f);
  };
  // 箱（中心基準）。r>0 で角丸
  const box = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, r = 0.015, rx = 0, rz = 0) => {
    const rad = Math.min(r, Math.min(w, h, d) * 0.45);
    const g = rad > 0.004
      ? cached(`rb${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${rad.toFixed(3)}`, () => new RoundedBoxGeometry(w, h, d, rad >= 0.04 ? 2 : 1, rad))
      : cached(`b${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`, () => new THREE.BoxGeometry(w, h, d));
    addGeo(g, mat, local(x, y, z, rx, ry, rz));
  };
  const cyl = (mat: THREE.Material, r: number, h: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, seg = 14, r2 = r) =>
    addGeo(cached(`c${r.toFixed(3)}|${r2.toFixed(3)}|${h.toFixed(3)}|${seg}`, () => new THREE.CylinderGeometry(r2, r, h, seg)), mat, local(x, y, z, rx, ry, rz));
  const sph = (mat: THREE.Material, r: number, x: number, y: number, z: number, sy = 1, seg = 12) =>
    addGeo(cached(`s${r.toFixed(3)}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1))), mat, local(x, y, z, 0, 0, 0, new THREE.Vector3(1, sy, 1)));
  const tor = (mat: THREE.Material, R: number, t: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, arc = Math.PI * 2, seg = 24) =>
    addGeo(cached(`t${R.toFixed(3)}|${t.toFixed(3)}|${arc.toFixed(2)}|${seg}`, () => new THREE.TorusGeometry(R, t, 8, seg, arc)), mat, local(x, y, z, rx, ry, rz));
  const plane = (mat: THREE.Material, w: number, h: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
    addGeo(cached('pl', () => new THREE.PlaneGeometry(1, 1)), mat, local(x, y, z, rx, ry, rz, new THREE.Vector3(w, h, 1)));
  const tube = (mat: THREE.Material, pts: [number, number, number][], r: number, segs = 24) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    addGeo(new THREE.TubeGeometry(curve, segs, r, 6, false), mat, new THREE.Matrix4());
  };
  const noShadowMats = new Set<THREE.Material>([M.cyan, M.yellowGlow, M.lamp, M.warm, M.cyanDim, M.liquid, M.liquidY, M.glass]);

  // ---- 画面（CanvasTexture：一部は動く） ----
  interface Scr { tex: THREE.CanvasTexture; mat: THREE.MeshBasicMaterial; g: CanvasRenderingContext2D; w: number; h: number; draw: (g: CanvasRenderingContext2D, w: number, h: number, t: number) => void; every: number; acc: number; anim: boolean }
  const screens: Scr[] = [];
  const frame = (g: CanvasRenderingContext2D, w: number, h: number, title: string, col: string) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0a1a2c'); gr.addColorStop(1, '#04101c');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(46,230,255,0.18)'; g.fillRect(0, 0, w, 16);
    g.fillStyle = col; g.font = `bold 11px ${FONT}`; g.textBaseline = 'middle'; g.fillText(title, 6, 8);
    g.fillStyle = col; g.fillRect(w - 18, 5, 10, 6);
  };
  const grid = (g: CanvasRenderingContext2D, w: number, h: number, step = 20, a = 0.12) => {
    g.strokeStyle = `rgba(46,230,255,${a})`; g.lineWidth = 1; g.beginPath();
    for (let x = 0; x < w; x += step) { g.moveTo(x, 18); g.lineTo(x, h); }
    for (let y = 18; y < h; y += step) { g.moveTo(0, y); g.lineTo(w, y); }
    g.stroke();
  };
  const termLines: string[] = [];
  for (let i = 0; i < 60; i++) {
    const n = 8 + Math.floor(rand() * 24); let s = '';
    for (let k = 0; k < n; k++) s += '0123456789ABCDEF>_=:/-'[Math.floor(rand() * 22)];
    termLines.push(s);
  }
  const drawers: Record<string, { every: number; draw: Scr['draw'] }> = {
    graphCyan: { every: 0.08, draw: (g, w, h, t) => {
      frame(g, w, h, '電力波形 / ENERGY', '#2ee6ff'); grid(g, w, h);
      for (let k = 0; k < 2; k++) {
        g.strokeStyle = k ? '#ffd83a' : '#2ee6ff'; g.lineWidth = 2; g.beginPath();
        for (let x = 0; x <= w; x += 3) {
          const u = x / w * 9 + t * (1.6 + k * 0.5);
          const y = h * 0.6 - Math.sin(u) * 22 * (k ? 0.6 : 1) - Math.sin(u * 2.3 + k) * 10 - (k ? 18 : 0);
          x ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
      g.fillStyle = '#9fe9ff'; g.font = `10px ${FONT}`; g.fillText(`${(120 + Math.sin(t) * 8).toFixed(1)} kV`, w - 62, h - 8);
    } },
    barsYellow: { every: 0.12, draw: (g, w, h, t) => {
      frame(g, w, h, '出力 / OUTPUT', '#ffd83a'); grid(g, w, h, 20, 0.08);
      for (let i = 0; i < 14; i++) {
        const v = 0.25 + 0.7 * Math.abs(Math.sin(t * 1.3 + i * 0.7) * Math.cos(t * 0.5 + i));
        const bh = (h - 40) * v; g.fillStyle = i % 5 === 4 ? '#2ee6ff' : '#ffd83a';
        g.fillRect(10 + i * 17, h - 10 - bh, 12, bh);
      }
    } },
    cyborg: { every: 0.07, draw: (g, w, h, t) => {
      frame(g, w, h, 'CYBORG-01 / 同期 98%', '#2ee6ff'); grid(g, w, h, 16, 0.07);
      g.strokeStyle = '#2ee6ff'; g.lineWidth = 1.5; const cx = w * 0.4, top = 26;
      g.beginPath(); g.arc(cx, top + 12, 11, 0, 7); g.stroke();
      g.strokeRect(cx - 17, top + 26, 34, 48); g.strokeRect(cx - 32, top + 28, 12, 44); g.strokeRect(cx + 20, top + 28, 12, 44);
      g.strokeRect(cx - 15, top + 76, 13, 52); g.strokeRect(cx + 2, top + 76, 13, 52);
      g.fillStyle = '#ffd83a'; for (const [px, py] of [[cx, top + 40], [cx - 26, top + 34], [cx + 26, top + 34], [cx - 8, top + 100], [cx + 8, top + 100]]) { g.beginPath(); g.arc(px, py, 3, 0, 7); g.fill(); }
      g.strokeStyle = 'rgba(255,216,58,0.8)'; g.beginPath(); g.moveTo(cx + 34, top + 34); g.lineTo(w - 50, 40); g.moveTo(cx + 16, top + 100); g.lineTo(w - 50, 100); g.stroke();
      g.fillStyle = '#9fe9ff'; g.font = `9px ${FONT}`; g.fillText('腕部ユニット', w - 62, 36); g.fillText('脚部ユニット', w - 62, 96);
      for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(46,230,255,0.35)'; g.fillRect(w - 60, 112 + i * 9, 50 * (0.4 + 0.6 * Math.abs(Math.sin(t + i))), 5); }
      const sy = 18 + ((t * 40) % (h - 18)); g.fillStyle = 'rgba(46,230,255,0.35)'; g.fillRect(0, sy, w, 3);
    } },
    terminal: { every: 0.15, draw: (g, w, h, t) => {
      frame(g, w, h, 'TERMINAL', '#59f0a8'); g.font = '9px monospace'; g.textBaseline = 'alphabetic';
      const off = Math.floor(t * 6);
      for (let i = 0; i < 14; i++) { g.fillStyle = i % 4 === 0 ? '#2ee6ff' : '#59f0a8'; g.fillText(termLines[(off + i) % 60], 6, 30 + i * 10); }
      g.textBaseline = 'middle';
    } },
    radar: { every: 0.05, draw: (g, w, h, t) => {
      frame(g, w, h, 'スキャン / SCAN', '#2ee6ff'); const cx = w / 2, cy = h / 2 + 8, r = Math.min(w, h) * 0.38;
      g.strokeStyle = 'rgba(46,230,255,0.5)'; g.lineWidth = 1;
      for (let i = 1; i <= 3; i++) { g.beginPath(); g.arc(cx, cy, r * i / 3, 0, 7); g.stroke(); }
      g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
      const a = t * 2; const gr = g.createConicGradient ? g.createConicGradient(a - 1.2, cx, cy) : null;
      if (gr) { gr.addColorStop(0, 'rgba(46,230,255,0)'); gr.addColorStop(0.19, 'rgba(46,230,255,0.55)'); gr.addColorStop(0.2, 'rgba(46,230,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); }
      g.fillStyle = '#ffd83a'; for (const [dx, dy] of [[0.4, -0.3], [-0.5, 0.2], [0.1, 0.6]]) { g.beginPath(); g.arc(cx + dx * r, cy + dy * r, 3, 0, 7); g.fill(); }
    } },
    mars: { every: 0.5, draw: (g, w, h, t) => {
      frame(g, w, h, '火星 MARS / 地下網', '#ffb36b');
      g.fillStyle = '#5b2f22'; g.fillRect(0, 16, w, h);
      g.strokeStyle = 'rgba(255,190,130,0.5)'; g.lineWidth = 1;
      for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(30 + i * 27 % 220, 45 + (i * 53) % 90, 8 + (i * 7) % 18, 0, 7); g.stroke(); }
      g.strokeStyle = '#2ee6ff'; g.lineWidth = 2; g.beginPath(); g.moveTo(20, 130); g.lineTo(80, 100); g.lineTo(130, 110); g.lineTo(180, 70); g.lineTo(230, 80); g.stroke();
      g.fillStyle = Math.floor(t * 2) % 2 ? '#ff5a4a' : '#ffd83a'; g.beginPath(); g.arc(180, 70, 5, 0, 7); g.fill();
      g.fillStyle = '#ffd83a'; g.font = `10px ${FONT}`; g.fillText('★ フラックス', 188, 66);
    } },
    ecg: { every: 0.05, draw: (g, w, h, t) => {
      g.fillStyle = '#031208'; g.fillRect(0, 0, w, h); grid(g, w, h, 16, 0.1);
      g.strokeStyle = '#59f0a8'; g.lineWidth = 2; g.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const u = ((x / w) * 3 + t * 0.9) % 1; let y = 0;
        if (u > 0.4 && u < 0.45) y = -(u - 0.4) * 20 * 18; else if (u >= 0.45 && u < 0.5) y = -(0.5 - u) * 20 * 18 + 6; else if (u > 0.5 && u < 0.53) y = 6;
        const yy = h * 0.55 + y * (h / 100) * 4;
        x ? g.lineTo(x, yy) : g.moveTo(x, yy);
      }
      g.stroke(); g.fillStyle = '#59f0a8'; g.font = `bold 16px ${FONT}`; g.fillText('72', w - 34, 18);
    } },
    dash: { every: 0.2, draw: (g, w, h, t) => {
      frame(g, w, h, 'ENERGY CORE', '#ffd83a');
      for (let i = 0; i < 3; i++) {
        const cx = 45 + i * 80, cy = 82, v = 0.5 + 0.4 * Math.sin(t * 0.5 + i * 2);
        g.lineWidth = 7; g.strokeStyle = 'rgba(46,230,255,0.2)'; g.beginPath(); g.arc(cx, cy, 28, 0, 7); g.stroke();
        g.strokeStyle = i === 1 ? '#ffd83a' : '#2ee6ff'; g.beginPath(); g.arc(cx, cy, 28, -1.57, -1.57 + 6.28 * v); g.stroke();
        g.fillStyle = '#fff'; g.font = `bold 12px ${FONT}`; g.textAlign = 'center'; g.fillText(`${Math.round(v * 100)}%`, cx, cy); g.textAlign = 'left';
      }
      for (let i = 0; i < 4; i++) { g.fillStyle = '#2ee6ff'; g.fillRect(10, 128 + i * 6, 30 + 160 * Math.abs(Math.sin(t * 0.4 + i)), 3); }
    } },
    diag: { every: 0.2, draw: (g, w, h, t) => {
      frame(g, w, h, 'システム診断', '#59f0a8'); g.font = `10px ${FONT}`;
      const labels = ['神経回路', '電力変換', '関節モーター', '視覚センサー', '吸収コア', '外装'];
      labels.forEach((l, i) => {
        const v = Math.min(1, ((t * 0.15 + i * 0.13) % 1.3)); g.fillStyle = '#bfefff'; g.fillText(l, 8, 32 + i * 20);
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(90, 26 + i * 20, 140, 9);
        g.fillStyle = v >= 1 ? '#59f0a8' : '#ffd83a'; g.fillRect(90, 26 + i * 20, 140 * v, 9);
      });
    } },
  };
  const scrKeys = Object.keys(drawers);
  const makeScreen = (key: string, w = 256, h = 160, anim = true): Scr => {
    const d = drawers[key];
    const tex = canvasTex(w, h, (g, ww, hh) => d.draw(g, ww, hh, rand() * 20), 4);
    const c = tex.image as HTMLCanvasElement;
    const mat = B(0xffffff, { map: tex });
    const s: Scr = { tex, mat, g: c.getContext('2d')!, w, h, draw: d.draw, every: d.every, acc: rand() * d.every, anim };
    screens.push(s); return s;
  };
  const scrPool = scrKeys.filter((k) => k !== 'ecg').map((k) => makeScreen(k));
  const ecgScr = makeScreen('ecg', 256, 128);
  const scrMats = scrPool.map((s) => s.mat);
  noShadowMats.add(ecgScr.mat); scrMats.forEach((m) => noShadowMats.add(m));

  // ---- 部屋のシェル ----
  const wallTex = canvasTex(512, 896, (g, w, h) => {
    const ppm = 256;
    g.fillStyle = '#b4bcc3'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '90,100,110'},${rand() * 0.07})`; g.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1 + rand() * 3); }
    const y1 = h - 1.15 * ppm; // 下パネル上端
    g.fillStyle = '#d9e1e7'; g.fillRect(0, y1, w, h - y1);
    g.strokeStyle = 'rgba(70,85,100,0.45)'; g.lineWidth = 2;
    for (let x = 0; x <= w; x += 256) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    g.beginPath(); g.moveTo(0, y1 + 140); g.lineTo(w, y1 + 140); g.stroke();
    g.beginPath(); g.moveTo(0, h - 2.4 * ppm); g.lineTo(w, h - 2.4 * ppm); g.stroke();
    g.fillStyle = 'rgba(70,85,100,0.55)';
    for (let x of [14, 242, 270, 498]) for (let y of [y1 + 14, y1 + 126, y1 + 154, h - 14]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
    for (let x of [14, 242, 270, 498]) for (let y of [h - 2.4 * ppm - 12, h - 2.4 * ppm + 12, 14, 880 - 10]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
    g.fillStyle = '#24385f'; g.fillRect(0, y1 - 28, w, 28);
    g.fillStyle = '#2ee6ff'; g.fillRect(0, y1 - 36, w, 5);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, y1 + 190, w, 6);
  });
  wallTex.wrapS = THREE.RepeatWrapping;
  const floorTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#b9c1c8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '70,80,90'},${rand() * 0.08})`; g.fillRect(rand() * w, rand() * h, 1 + rand() * 4, 1 + rand() * 4); }
    g.strokeStyle = 'rgba(60,72,85,0.5)'; g.lineWidth = 3; g.strokeRect(1, 1, w - 2, h - 2);
    g.strokeStyle = 'rgba(60,72,85,0.2)'; g.lineWidth = 1; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    g.strokeStyle = 'rgba(60,72,85,0.18)'; for (let i = 0; i < 14; i++) { g.beginPath(); const x = rand() * w, y = rand() * h; g.moveTo(x, y); g.lineTo(x + rr(-60, 60), y + rr(-60, 60)); g.stroke(); }
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(7, 5);
  const floorMat = S(0xd2d8de, 0.75, 0.05, { map: floorTex }); floorMat.map = floorTex;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), floorMat); geos.add(floor.geometry);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; root.add(floor);
  const ceilMat = S(0xc3ccd5, 0.8, 0);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), ceilMat); geos.add(ceil.geometry);
  ceil.rotation.x = Math.PI / 2; ceil.position.y = H; root.add(ceil);
  const wall = (w: number, x: number, z: number, ry: number) => {
    const t = wallTex.clone(); t.needsUpdate = true; t.wrapS = THREE.RepeatWrapping; t.repeat.set(w / 2, 1); texs.add(t);
    const m = S(0xffffff, 0.8, 0, { map: t });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, H), m); geos.add(mesh.geometry);
    mesh.position.set(x, H / 2, z); mesh.rotation.y = ry; mesh.receiveShadow = true; root.add(mesh);
  };
  wall(14, 0, -HZ, 0); wall(14, 0, HZ, Math.PI); wall(10, HX, 0, -Math.PI / 2); wall(10, -HX, 0, Math.PI / 2);
  // 巾木・柱・天井縁
  for (const [x, z, w, d] of [[0, -HZ + 0.05, 14, 0.1], [0, HZ - 0.05, 14, 0.1], [HX - 0.05, 0, 0.1, 10], [-HX + 0.05, 0, 0.1, 10]] as const)
    box(M.navy, w, 0.12, d, x, 0.06, z, 0, 0.01);
  for (const x of [-6.9, -3.5, 0, 3.5, 6.9]) for (const z of [-4.9, 4.9]) box(M.grey, 0.28, H, 0.22, x, H / 2, z, 0, 0.03);
  for (const z of [-3.2, 3.2]) for (const x of [-6.9, 6.9]) box(M.grey, 0.22, H, 0.28, x, H / 2, z, 0, 0.03);
  box(M.navy, 14, 0.14, 0.2, 0, H - 0.07, -HZ + 0.1, 0, 0.02); box(M.navy, 14, 0.14, 0.2, 0, H - 0.07, HZ - 0.1, 0, 0.02);
  box(M.navy, 0.2, 0.14, 10, HX - 0.1, H - 0.07, 0, 0, 0.02); box(M.navy, 0.2, 0.14, 10, -HX + 0.1, H - 0.07, 0, 0, 0.02);
  // 壁上部のシアン間接照明
  box(M.cyan, 13.6, 0.03, 0.03, 0, H - 0.2, -HZ + 0.12, 0, 0); box(M.cyan, 13.6, 0.03, 0.03, 0, H - 0.2, HZ - 0.12, 0, 0);
  box(M.cyan, 0.03, 0.03, 9.6, HX - 0.12, H - 0.2, 0, 0, 0); box(M.cyan, 0.03, 0.03, 9.6, -HX + 0.12, H - 0.2, 0, 0, 0);

  // ---- 床の表示（ベッド周りの安全エリア・通路ライン） ----
  const decalTex = canvasTex(512, 320, (g, w, h) => {
    g.fillStyle = 'rgba(205,232,242,0.85)'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(36,56,95,0.35)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = '#24385f'; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, h - 14);
    g.strokeStyle = '#ffd83a'; g.lineWidth = 6; g.setLineDash([26, 16]); g.strokeRect(24, 24, w - 48, h - 48);
  });
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 3.25), S(0xffffff, 0.8, 0, { map: decalTex }));
  geos.add(decal.geometry); mats.add(decal.material as THREE.Material);
  decal.rotation.x = -Math.PI / 2; decal.position.y = 0.006; decal.receiveShadow = true; root.add(decal);
  for (const z of [-0.95, 0.95]) plane(M.yellow, 4.2, 0.07, -4.7, 0.008, z, -Math.PI / 2);
  for (let i = 0; i < 8; i++) plane(M.yellow, 0.18, 0.5, -6.3 + i * 0.5, 0.009, 0, -Math.PI / 2, 0, 0.9);

  // ---- ヘルパー：壁面のローカル座標（u=壁に沿った世界座標） ----
  type W = 'N' | 'S' | 'E' | 'W';
  const wallM = (w: W, u: number, y: number, off = 0) => {
    switch (w) {
      case 'N': return local(u, y, -HZ + off, 0, 0, 0);
      case 'S': return local(u, y, HZ - off, 0, Math.PI, 0);
      case 'E': return local(HX - off, y, u, 0, -Math.PI / 2, 0);
      default: return local(-HX + off, y, u, 0, Math.PI / 2, 0);
    }
  };

  // LED 群（ブリンク）
  type Led = { mat: THREE.MeshBasicMaterial; base: THREE.Color; period: number; phase: number; duty: number };
  const leds: Led[] = [];
  const ledCols = [0x59ff9a, 0x59ff9a, 0x2ee6ff, 0xffb02e, 0xff4a3a, 0xffffff];
  const ledMats = ledCols.map((c, i) => { const m = B(c); noShadowMats.add(m); leds.push({ mat: m, base: new THREE.Color(c), period: 0.4 + i * 0.37 + rand() * 0.5, phase: rand(), duty: 0.35 + rand() * 0.5 }); return m; });
  function ledAt(x: number, y: number, z: number) { plane(pick(ledMats), 0.011, 0.011, x, y, z); }

  // ---- 机 ----
  interface Surf { m: THREE.Matrix4; w: number; d: number; y: number; occ: [number, number, number, number][] }
  const surfaces: Surf[] = [];
  const monitor = (w: number, h: number, x: number, y: number, z: number, ry: number, tilt = -0.06) => {
    push(x, y, z, ry);
    box(M.black, w, h, 0.035, 0, h / 2 + 0.1, 0, 0, 0.012, tilt);
    const mat = pick(scrMats);
    push(0, h / 2 + 0.1, 0.0185, 0, tilt); plane(mat, w - 0.03, h - 0.03, 0, 0, 0); pop();
    box(M.dgrey, 0.05, 0.12, 0.03, 0, 0.06, -0.02, 0, 0.01); box(M.dgrey, 0.24, 0.015, 0.17, 0, 0.008, 0, 0, 0.007);
    pop();
  };
  const keyboardTex = canvasTex(256, 96, (g, w, h) => {
    g.fillStyle = '#2b3139'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 15; c++) { g.fillStyle = r === 4 ? '#3c4550' : (c + r) % 7 === 0 ? '#2ee6ff' : '#566272'; g.fillRect(4 + c * 16.6, 5 + r * 17.5, 14, 14); }
  }, 4);
  const kbMat = S(0xffffff, 0.6, 0.1, { map: keyboardTex });
  const keyboard = (x: number, z: number, ry: number) => {
    push(x, 0, z, ry); box(M.black, 0.43, 0.018, 0.15, 0, 0.009, 0, 0, 0.006); plane(kbMat, 0.41, 0.135, 0, 0.0191, 0, -Math.PI / 2); box(M.black, 0.06, 0.02, 0.1, 0.32, 0.01, 0.0, 0.2, 0.01); pop();
  };
  const chair = (x: number, z: number, ry: number) => {
    push(x, 0, z, ry);
    const col = pick([M.navy, M.navy2, M.black]);
    box(col, 0.46, 0.08, 0.44, 0, 0.5, 0, 0, 0.03); box(col, 0.44, 0.5, 0.07, 0, 0.82, -0.21, 0, 0.03, -0.12);
    cyl(M.dgrey, 0.025, 0.4, 0, 0.26, 0); cyl(M.grey, 0.06, 0.04, 0, 0.1, 0);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; box(M.dgrey, 0.3, 0.025, 0.04, Math.cos(a) * 0.15, 0.07, Math.sin(a) * 0.15, -a, 0.01); sph(M.black, 0.03, Math.cos(a) * 0.29, 0.035, Math.sin(a) * 0.29); }
    pop();
  };
  const desk = (x: number, z: number, ry: number, w: number, d: number, opt: { mon?: number; big?: boolean; chair?: boolean; laptop?: boolean } = {}) => {
    pushM(top().clone().multiply(local(x, 0, z, 0, ry, 0)));
    const dm = top().clone();
    box(M.desk, w, 0.05, d, 0, 0.735, 0, 0, 0.02);
    box(M.grey, w - 0.1, 0.03, 0.04, 0, 0.7, d / 2 - 0.05, 0, 0.01);
    box(M.navy, 0.05, 0.71, d - 0.08, -w / 2 + 0.05, 0.355, 0, 0, 0.015); box(M.navy, 0.05, 0.71, d - 0.08, w / 2 - 0.05, 0.355, 0, 0, 0.015);
    box(M.grey, w - 0.12, 0.45, 0.03, 0, 0.45, -d / 2 + 0.06, 0, 0.01);
    // 引き出し
    const dx = w / 2 - 0.3; box(M.offwhite, 0.45, 0.58, d - 0.1, dx, 0.37, 0, 0, 0.02);
    for (let i = 0; i < 3; i++) { box(M.grey, 0.2, 0.02, 0.02, dx, 0.2 + i * 0.18, d / 2 - 0.045, 0, 0.005); box(M.cyanSoft, 0.4, 0.002, 0.003, dx, 0.28 + i * 0.18, d / 2 - 0.045, 0, 0); }
    // PC本体＋LED
    box(M.dgrey, 0.2, 0.42, 0.42, -w / 2 + 0.3, 0.26, -0.05, 0, 0.02); box(M.cyan, 0.02, 0.02, 0.003, -w / 2 + 0.3, 0.4, 0.162, 0, 0);
    box(M.cyan, w - 0.1, 0.012, 0.012, 0, 0.7, d / 2 - 0.02, 0, 0);
    // 机の上
    const n = opt.mon ?? 2; const mw = opt.big ? 0.7 : 0.56, mh = opt.big ? 0.42 : 0.34; const occ: Surf['occ'] = [];
    for (let i = 0; i < n; i++) {
      const u = (i - (n - 1) / 2) * (mw + 0.05);
      monitor(mw, mh, u * 0.97, 0.76, -d / 2 + 0.22 + Math.abs(i - (n - 1) / 2) * 0.05, -(i - (n - 1) / 2) * 0.22);
      occ.push([u - mw / 2, u + mw / 2, -d / 2, -d / 2 + 0.42]);
    }
    occ.push([-0.25, 0.3, -0.02, 0.2]);
    surfaces.push({ m: dm.clone().multiply(local(0, 0.76, 0)), w, d, y: 0, occ });
    pop();
    return dm;
  };

  // 机は pushM で原点高さ0のため、キーボードはデスク上面の高さに置く
  // （keyboard() は y=0 基準なので、desk 内で push(0,0.76,0) してから呼ぶ）
  const deskTopKb = (dm: THREE.Matrix4, z: number) => { pushM(dm); push(0, 0.76, z); keyboard(0, 0, 0.03); pop(); pop(); };

  // ---- 机の配置 ----
  type DeskDef = { w: W; u: number; width: number; mon: number; big?: boolean };
  const deskDefs: DeskDef[] = [
    { w: 'N', u: -5.5, width: 2.2, mon: 3 }, { w: 'N', u: -3.3, width: 2.2, mon: 2, big: true },
    { w: 'N', u: 3.3, width: 2.2, mon: 3 }, { w: 'N', u: 5.5, width: 2.2, mon: 2 },
    { w: 'S', u: -1.2, width: 2.2, mon: 3 }, { w: 'S', u: 1.0, width: 2.2, mon: 2, big: true }, { w: 'S', u: 2.9, width: 1.6, mon: 2 },
  ];
  const wallToPos = (w: W, u: number, depth: number): [number, number, number] =>
    w === 'N' ? [u, -HZ + depth, 0] : w === 'S' ? [u, HZ - depth, Math.PI] : w === 'E' ? [HX - depth, u, -Math.PI / 2] : [-HX + depth, u, Math.PI / 2];
  const placeDesk = (w: W, u: number, width: number, mon: number, big = false, ch = true) => {
    const p = wallToPos(w, u, 0.45);
    const x = w === 'N' || w === 'S' ? p[0] : p[0], z = w === 'N' || w === 'S' ? p[1] : u;
    const dm = desk(x, z, p[2], width, 0.8, { mon, big });
    // 机ローカルにキーボード
    pushM(dm); push(0, 0.76, 0.12); keyboard(0, 0, 0.02); pop(); pop();
    if (ch) {
      const c = Math.cos(p[2]), s = Math.sin(p[2]);
      const cx = x + s * 0.95 + rr(-0.15, 0.15), cz = z + c * 0.95 + rr(-0.1, 0.1);
      if (w === 'E' || w === 'W') chair(cx, u + rr(-0.5, 0.5), p[2] + rr(-0.6, 0.6)); else chair(cx + 0 * cz, cz, p[2] + rr(-0.7, 0.7));
    }
  };
  void deskTopKb;
  // desk() 内の仮キーボード呼び出しを避けるため上の placeDesk を使用
  for (const dd of deskDefs) placeDesk(dd.w, dd.u, dd.width, dd.mon, dd.big);

  // ---- 作業台（西壁） ----
  {
    const z0 = 2.7;
    pushM(local(-HX + 0.4, 0, z0, 0, Math.PI / 2, 0));
    box(M.grey, 2.0, 0.06, 0.7, 0, 0.9, 0, 0, 0.02); box(M.navy, 1.9, 0.78, 0.6, 0, 0.45, 0, 0, 0.02);
    for (let i = 0; i < 4; i++) box(M.offwhite, 0.45, 0.2, 0.02, -0.7 + i * 0.47, 0.6, 0.31, 0, 0.01), box(M.grey, 0.18, 0.015, 0.015, -0.7 + i * 0.47, 0.63, 0.325, 0, 0.003);
    surfaces.push({ m: top().clone().multiply(local(0, 0.93, 0)), w: 2.0, d: 0.7, y: 0, occ: [[0.3, 0.8, -0.3, 0.2]] });
    // 万力・小型ロボット
    box(M.dgrey, 0.12, 0.1, 0.12, 0.55, 1.0, -0.1, 0, 0.01); box(M.red, 0.04, 0.04, 0.15, 0.55, 1.07, 0.05, 0, 0.01);
    box(M.white, 0.28, 0.14, 0.2, -0.3, 1.0, -0.1, 0.4, 0.04); sph(M.white, 0.1, -0.3, 1.18, -0.1); box(M.black, 0.12, 0.05, 0.03, -0.3, 1.2, 0.0, 0.4, 0.01); box(M.cyan, 0.08, 0.015, 0.005, -0.3, 1.2, 0.018, 0.4, 0);
    pop();
  }

  // ---- 東壁：大型モニターウォール＋コンソール＋サーバーラック ----
  {
    pushM(local(HX - 0.42, 0, 0, 0, -Math.PI / 2, 0));
    box(M.desk, 5.2, 0.05, 0.8, 0, 0.735, 0, 0, 0.02); box(M.navy, 5.1, 0.7, 0.6, 0, 0.35, -0.08, 0, 0.02); box(M.cyan, 5.1, 0.012, 0.012, 0, 0.7, 0.36, 0, 0);
    for (let i = 0; i < 6; i++) { monitor(0.6, 0.36, -2.0 + i * 0.8, 0.76, -0.12, (i - 2.5) * -0.07); }
    surfaces.push({ m: top().clone().multiply(local(0, 0.76, 0)), w: 5.2, d: 0.8, y: 0, occ: [[-2.4, 2.4, -0.4, -0.02]] });
    pop();
    for (const sx of [-1.2, 1.2]) chair(HX - 1.4, sx * 0.9, -Math.PI / 2 + rr(-0.5, 0.5));
    // 壁掛け大型画面 3x2
    const bigKeys = ['cyborg', 'graphCyan', 'mars', 'radar', 'dash', 'barsYellow'];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      const scr = scrPool[scrKeys.filter((k) => k !== 'ecg').indexOf(bigKeys[r * 3 + c])];
      pushM(wallM('E', (c - 1) * 1.5, 1.7 + r * 0.9, 0.035));
      box(M.black, 1.44, 0.84, 0.06, 0, 0, 0, 0, 0.02); plane(scr.mat, 1.38, 0.78, 0, 0, 0.032); box(M.cyan, 1.44, 0.015, 0.015, 0, -0.43, 0.02, 0, 0);
      pop();
    }
    // サーバーラック
    for (const rz of [-4.6, -3.9, -3.2, 3.2, 3.9, 4.6]) {
      pushM(local(HX - 0.52, 0, rz, 0, -Math.PI / 2, 0));
      box(M.dgrey, 0.7, 2.15, 0.9, 0, 1.075, 0, 0, 0.025); box(M.black, 0.62, 2.0, 0.02, 0, 1.08, 0.455, 0, 0.005);
      for (let u = 0; u < 14; u++) {
        const y = 0.2 + u * 0.14; const kind = Math.floor(rand() * 4);
        box(kind === 0 ? M.navy : kind === 1 ? M.grey : kind === 2 ? M.offwhite : M.black, 0.58, 0.115, 0.03, 0, y, 0.465, 0, 0.008);
        if (kind === 3) for (let k = 0; k < 7; k++) box(M.black, 0.5, 0.004, 0.005, 0, y - 0.04 + k * 0.012, 0.482, 0, 0);
        else for (let k = 0; k < 5; k++) ledAt(0.5 * (-0.3 + k * 0.06) * 1.0 - 0.1 + 0.26 * 0, y + rr(-0.03, 0.03), 0.482);
        if (kind !== 3) box(M.dgrey, 0.1, 0.04, 0.004, 0.2, y, 0.482, 0, 0);
      }
      pop();
    }
  }

  
  // ---- 棚 ----
  const shelfItem = (x: number, y: number, z: number, maxW: number, maxH: number, depth: number): number => {
    const k = rand(); let w = 0.2;
    if (k < 0.25) { // 箱
      w = rr(0.14, 0.34); const h = rr(0.1, Math.min(maxH, 0.32)); const d = rr(0.2, depth - 0.05); if (w > maxW) return 0;
      const mat = pick(boxCols); box(mat, w, h, d, x + w / 2, y + h / 2, z, 0, 0.02);
      box(mat === M.white ? M.cyanSoft : M.white, w * 0.6, 0.05, 0.004, x + w / 2, y + h * 0.55, z + d / 2 + 0.001, 0, 0);
      if (rand() < 0.4 && h + 0.15 < maxH) { const w2 = w * 0.8, h2 = rr(0.08, 0.14); box(pick(boxCols), w2, h2, d * 0.8, x + w / 2, y + h + h2 / 2, z, rr(-0.1, 0.1), 0.02); }
    } else if (k < 0.37) { // ジャー
      const r = rr(0.05, 0.075), h = rr(0.14, Math.min(maxH, 0.24)); w = r * 2 + 0.02; if (w > maxW) return 0;
      cyl(M.glass, r, h, x + w / 2, y + h / 2, z); cyl(rand() < 0.5 ? M.liquid : M.liquidY, r * 0.85, h * rr(0.4, 0.85), x + w / 2, y + h * 0.4, z); cyl(M.dgrey, r * 1.02, 0.03, x + w / 2, y + h + 0.015, z);
    } else if (k < 0.47) { // コイル
      w = 0.18; if (w > maxW) return 0;
      cyl(M.black, 0.09, 0.03, x + w / 2, y + 0.015, z); for (let i = 0; i < 3; i++) tor(M.copper, 0.07, 0.02, x + w / 2, y + 0.05 + i * 0.04, z, Math.PI / 2);
    } else if (k < 0.57) { // バッテリー
      w = rr(0.2, 0.3); if (w > maxW) return 0; const h = rr(0.1, 0.16);
      box(M.black, w, h, 0.18, x + w / 2, y + h / 2, z, 0, 0.02); box(M.yellow, w, 0.03, 0.182, x + w / 2, y + h * 0.7, z, 0, 0); box(M.green, 0.03, 0.03, 0.005, x + w * 0.2, y + h * 0.3, z + 0.092, 0, 0); box(M.grey, 0.03, 0.02, 0.03, x + w * 0.8, y + h + 0.01, z, 0, 0);
    } else if (k < 0.67) { // ロボット頭部
      w = 0.22; if (w > maxW || maxH < 0.22) return 0;
      sph(M.white, 0.1, x + w / 2, y + 0.11, z, 0.95); box(M.black, 0.13, 0.05, 0.04, x + w / 2, y + 0.115, z + 0.085, 0, 0.015); box(M.cyan, 0.09, 0.012, 0.004, x + w / 2, y + 0.118, z + 0.107, 0, 0);
      cyl(M.grey, 0.025, 0.04, x + w / 2 - 0.1, y + 0.11, z, 0, 0, Math.PI / 2); cyl(M.grey, 0.025, 0.04, x + w / 2 + 0.1, y + 0.11, z, 0, 0, Math.PI / 2); cyl(M.grey, 0.07, 0.03, x + w / 2, y + 0.015, z);
    } else if (k < 0.75) { // ロボット腕パーツ
      w = 0.34; if (w > maxW) return 0;
      cyl(M.white, 0.035, 0.2, x + 0.1, y + 0.04, z, 0, 0, Math.PI / 2); sph(M.grey, 0.045, x + 0.2, y + 0.045, z); cyl(M.navy, 0.03, 0.14, x + 0.27, y + 0.05, z + 0.02, 0, 0.3, Math.PI / 2); box(M.dgrey, 0.05, 0.07, 0.05, x + 0.34 - 0.02, y + 0.05, z + 0.03, 0.3, 0.01);
    } else if (k < 0.82) { // 歯車・スプール
      w = 0.2; if (w > maxW) return 0;
      cyl(M.grey, 0.09, 0.03, x + w / 2, y + 0.015, z, 0, 0, 0, 10); cyl(M.dgrey, 0.05, 0.034, x + w / 2, y + 0.017, z, 0, 0, 0, 10); cyl(M.orange, 0.07, 0.03, x + w / 2, y + 0.045, z, 0, 0, 0, 10);
      cyl(M.cyanSoft, 0.06, 0.1, x + w / 2 + 0.01, y + 0.1, z, 0, 0, 0, 12);
    } else if (k < 0.9) { // 本・ファイル
      const n = 3 + Math.floor(rand() * 4); w = n * 0.045; if (w > maxW) return 0;
      for (let i = 0; i < n; i++) { const h = rr(0.18, Math.min(maxH, 0.3)); box(pick([M.navy, M.red, M.yellow, M.white, M.green, M.cyanSoft]), 0.04, h, rr(0.17, 0.24), x + 0.025 + i * 0.045, y + h / 2, z, 0, 0.004, 0, rand() < 0.1 ? rr(-0.2, 0.2) : 0); }
    } else if (k < 0.95) { // 缶
      w = 0.14; if (w > maxW) return 0;
      cyl(M.yellow, 0.06, 0.2, x + w / 2, y + 0.1, z); cyl(M.black, 0.062, 0.04, x + w / 2, y + 0.1, z); cyl(M.grey, 0.062, 0.02, x + w / 2, y + 0.2, z);
    } else { // 工具箱
      w = 0.32; if (w > maxW) return 0;
      box(M.orange, w, 0.16, 0.2, x + w / 2, y + 0.08, z, 0, 0.02); tor(M.dgrey, 0.06, 0.008, x + w / 2, y + 0.17, z, 0, 0, 0, Math.PI, 12);
    }
    return w + rr(0.01, 0.05);
  };
  const shelfUnit = (cx: number, cz: number, ry: number, w: number, h: number, levels: number, fill = 0.9) => {
    const d = 0.46; pushM(local(cx, 0, cz, 0, ry, 0));
    box(M.navy, w, h, 0.02, 0, h / 2, -d / 2 + 0.01, 0, 0.005);
    for (const sx of [-w / 2, w / 2]) box(M.grey, 0.045, h, d, sx, h / 2, 0, 0, 0.012);
    const lh = (h - 0.1) / levels;
    for (let i = 0; i <= levels; i++) {
      const y = 0.08 + i * lh; box(M.offwhite, w, 0.035, d, 0, y, 0, 0, 0.01);
      if (i > 0 && i < levels && rand() < 0.7) box(M.cyan, w - 0.1, 0.01, 0.01, 0, y - 0.025, d / 2 - 0.02, 0, 0);
    }
    for (let i = 0; i < levels; i++) {
      const y0 = 0.08 + i * lh + 0.0175; let x = -w / 2 + 0.05; const lim = w / 2 - 0.05;
      let guard = 0;
      while (x < lim - 0.08 && guard++ < 40) {
        if (rand() > fill) { x += rr(0.08, 0.2); continue; }
        const used = shelfItem(x, y0, rr(-0.04, 0.04), lim - x, lh - 0.06, d);
        x += used > 0 ? used : 0.06;
      }
    }
    // 床置き：奥行きを持たせるための足
    pop();
  };
  shelfUnit(-5.6, HZ - 0.28, Math.PI, 2.0, 2.3, 5); shelfUnit(-3.6, HZ - 0.28, Math.PI, 2.0, 2.3, 5);
  shelfUnit(-HX + 0.28, -3.4, Math.PI / 2, 2.0, 2.3, 5); shelfUnit(-HX + 0.28, -5 + 0.2 + 1.0 + 2.2, Math.PI / 2, 1.6, 2.3, 5);
  shelfUnit(4.6, HZ - 0.28, Math.PI, 1.4, 2.3, 5, 0.85);

  // ---- 中央：開発ベッド ----
  const bed = new THREE.Group(); bed.name = 'bed'; root.add(bed);
  pushM(new THREE.Matrix4());
  // 台座
  box(M.navy, 2.9, 0.12, 1.3, 0, 0.06, 0, 0, 0.05); box(M.navy2, 2.6, 0.2, 1.1, 0, 0.22, 0, 0, 0.06);
  box(M.cyan, 2.62, 0.02, 1.12, 0, 0.14, 0, 0, 0.0); box(M.grey, 1.3, 0.38, 0.55, 0, 0.5, 0, 0, 0.08);
  box(M.white, 2.7, 0.12, 0.98, 0, 0.8, 0, 0, 0.05); box(M.grey, 2.55, 0.04, 0.85, 0, 0.72, 0, 0, 0.02);
  // マットレス（セクション分け）
  const padY = 0.94;
  box(M.bedPad, 0.5, 0.1, 0.84, -0.95, padY - 0.02, 0, 0, 0.04, 0, 0); box(M.bedPad, 0.9, 0.1, 0.84, -0.2, padY - 0.02, 0, 0, 0.04); box(M.bedPad, 0.9, 0.1, 0.84, 0.7, padY - 0.02, 0, 0, 0.04);
  box(M.white, 0.34, 0.09, 0.5, -1.05, padY + 0.07, 0, 0, 0.04); // 枕
  for (const sz of [-0.5, 0.5]) { box(M.grey, 2.2, 0.05, 0.05, 0, padY + 0.02, sz, 0, 0.02); box(M.cyan, 2.1, 0.012, 0.012, 0, padY + 0.05, sz, 0, 0); }
  // 拘束ベルト（開いた状態）
  for (const bx of [-0.45, 0.2, 0.9]) for (const sz of [-1, 1]) { box(M.navy, 0.09, 0.025, 0.2, bx, padY + 0.04, sz * 0.5, 0, 0.01); box(M.yellow, 0.03, 0.03, 0.04, bx, padY + 0.05, sz * 0.43, 0, 0.005); }
  // 側面パネル＋スイッチ
  for (const sz of [-1, 1]) { box(M.offwhite, 0.9, 0.18, 0.04, 0.0, 0.38, sz * 0.5, 0, 0.015); box(M.cyan, 0.1, 0.02, 0.005, 0.3, 0.38, sz * 0.526, 0, 0); box(M.red, 0.04, 0.04, 0.01, -0.1, 0.38, sz * 0.526, 0, 0.01); }
  // 頭側ヘッドギア（接続端子）
  box(M.dgrey, 0.3, 0.12, 0.45, -1.42, 1.12, 0, 0, 0.04); for (let i = 0; i < 4; i++) box(M.cyan, 0.02, 0.02, 0.02, -1.5, 1.12, -0.12 + i * 0.08, 0, 0);
  cyl(M.grey, 0.05, 0.9, -1.42, 0.7, 0);
  // 足側のケーブルポート
  box(M.dgrey, 0.2, 0.3, 0.7, 1.45, 0.4, 0, 0, 0.04); for (let i = 0; i < 5; i++) box(i % 2 ? M.yellow : M.cyan, 0.02, 0.02, 0.02, 1.56, 0.45, -0.24 + i * 0.12, 0, 0);
  // ケーブル（ベッド→床→ラック／壁へ）
  const cabMats = [M.black, M.yellow, M.red, M.cyanSoft, M.orange];
  const cabs: [[number, number, number][], number, THREE.Material][] = [
    [[[ -1.55, 1.05, -0.1], [-1.9, 0.8, -0.5], [-2.2, 0.1, -1.0], [-1.0, 0.03, -2.0], [1.5, 0.03, -3.0], [3.0, 0.03, -3.9], [5.0, 0.03, -4.0]], 0.022, M.black],
    [[[ -1.55, 1.1, 0.1], [-2.0, 0.7, 0.4], [-2.6, 0.03, 0.2], [-3.5, 0.03, -1.5], [-3.5, 0.03, -3.5], [-3.5, 0.03, -4.6]], 0.025, M.yellow],
    [[[ 1.6, 0.4, -0.2], [2.0, 0.03, -0.5], [3.0, 0.03, -1.0], [4.5, 0.03, -1.6], [5.6, 0.03, -2.2], [6.3, 0.03, -2.9]], 0.025, M.black],
    [[[ 1.6, 0.4, 0.2], [2.2, 0.03, 0.6], [3.5, 0.03, 1.5], [5.0, 0.03, 2.0], [6.2, 0.03, 3.0]], 0.018, M.red],
    [[[ -1.5, 1.05, 0.15], [-1.7, 1.8, 0.3], [-1.5, 2.8, 0.1], [-1.2, 3.4, 0.0]], 0.02, M.cyanSoft],
    [[[ 1.5, 0.5, 0.1], [2.0, 0.3, 0.4], [2.7, 0.03, 0.2]], 0.02, M.orange],
  ];
  for (const [pts, r, m] of cabs) tube(m, pts, r, 40);
  // 天井レール＋吊りライト
  box(M.dgrey, 4.0, 0.1, 0.12, 0, H - 0.2, -0.85, 0, 0.02); box(M.dgrey, 4.0, 0.1, 0.12, 0, H - 0.2, 0.85, 0, 0.02);
  for (const rx of [-1.9, 1.9]) box(M.dgrey, 0.12, 0.1, 1.82, rx, H - 0.2, 0, 0, 0.02);
  box(M.cyan, 3.9, 0.015, 0.015, 0, H - 0.26, -0.85, 0, 0); box(M.cyan, 3.9, 0.015, 0.015, 0, H - 0.26, 0.85, 0, 0);
  // 無影灯
  cyl(M.dgrey, 0.04, 0.6, 0.55, H - 0.5, 0.3, 0.0, 0, 0.0); cyl(M.grey, 0.03, 0.9, 0.55, 3.0, 0.3, 0.9, 0, 0);
  box(M.black, 0.12, 0.12, 0.6, 0.55, H - 0.2, 0.55, 0, 0.02);
  cyl(M.offwhite, 0.4, 0.07, 0.5, 2.55, 0.35, 0, 0, 0); cyl(M.warm, 0.34, 0.01, 0.5, 2.51, 0.35, 0, 0, 0, 24); cyl(M.dgrey, 0.04, 0.2, 0.5, 2.65, 0.35);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; cyl(M.lamp, 0.045, 0.012, 0.5 + Math.cos(a) * 0.2, 2.5, 0.35 + Math.sin(a) * 0.2, 0, 0, 0, 10); }
  // 医療モニタ台車＋点滴
  pushM(local(-1.2, 0, -1.55, 0, 0.2, 0));
  cyl(M.dgrey, 0.03, 1.2, 0, 0.65, 0); box(M.dgrey, 0.5, 0.04, 0.5, 0, 0.04, 0, 0.3, 0.015); for (const [cx, cz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) sph(M.black, 0.035, cx, 0.03, cz);
  box(M.black, 0.5, 0.36, 0.1, 0, 1.4, 0, 0, 0.03); pop();
  // 点滴スタンド
  pushM(local(-1.9, 0, -1.0, 0, 0, 0)); cyl(M.grey, 0.015, 1.9, 0, 0.95, 0); for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; box(M.grey, 0.3, 0.02, 0.025, Math.cos(a) * 0.15, 0.03, Math.sin(a) * 0.15, -a, 0.005); }
  box(M.grey, 0.5, 0.02, 0.02, 0, 1.88, 0); box(M.liquid, 0.1, 0.2, 0.03, -0.2, 1.74, 0, 0, 0.03); box(M.liquidY, 0.1, 0.2, 0.03, 0.2, 1.74, 0, 0, 0.03); tube(M.glass, [[-0.2, 1.62, 0], [-0.3, 1.2, 0.2], [-0.6, 1.0, 0.5], [-0.9, 0.98, 0.9]], 0.008, 12); pop();
  // ツールカート（ベッド奥）
  pushM(local(0.9, 0, -1.6, 0, -0.15, 0));
  box(M.offwhite, 1.0, 0.04, 0.55, 0, 0.9, 0, 0, 0.015); box(M.offwhite, 1.0, 0.03, 0.55, 0, 0.45, 0, 0, 0.015);
  for (const [cx, cz] of [[-0.46, -0.24], [0.46, -0.24], [-0.46, 0.24], [0.46, 0.24]]) { cyl(M.grey, 0.02, 0.9, cx, 0.45, cz); sph(M.black, 0.04, cx, 0.04, cz); }
  surfaces.push({ m: top().clone().multiply(local(0, 0.92, 0)), w: 1.0, d: 0.55, y: 0, occ: [] });
  // 工具（トレイ上）
  box(M.cyanSoft, 0.5, 0.02, 0.3, -0.2, 0.935, 0, 0, 0.01); for (let i = 0; i < 6; i++) box(i % 2 ? M.grey : M.dgrey, 0.02 + rand() * 0.02, 0.012, 0.16 + rand() * 0.06, -0.38 + i * 0.07, 0.96, rr(-0.04, 0.04), rr(-0.3, 0.3), 0.004);
  box(M.red, 0.18, 0.06, 0.12, 0.25, 0.96, 0.1, 0.2, 0.02); box(M.white, 0.22, 0.04, 0.16, 0.3, 0.95, -0.12, -0.1, 0.015);
  for (let i = 0; i < 5; i++) box(M.cardboard, 0.2 + rand() * 0.2, 0.1, 0.25, -0.3 + (i % 3) * 0.3, 0.52, -0.1 + (i > 2 ? 0.15 : 0), rr(-0.3, 0.3), 0.01);
  pop();
  pop();

  // ---- 天井：ライトパネル・パイプ・ケーブルトレイ・ダクト ----
  for (const lx of [-4.2, 0, 4.2]) for (const lz of [-2.1, 2.1]) {
    box(M.grey, 1.9, 0.05, 1.0, lx, H - 0.025, lz, 0, 0.02); box(M.lamp, 1.7, 0.03, 0.8, lx, H - 0.055, lz, 0, 0.01);
  }
  box(M.offwhite, 14, 0.4, 0.7, 0, H - 0.2, -4.1, 0, 0.04); for (let i = 0; i < 8; i++) box(M.grey, 0.06, 0.42, 0.72, -6.2 + i * 1.75, H - 0.2, -4.1, 0, 0.01);
  for (const [z, r, m] of [[-3.5, 0.08, M.navy], [-3.3, 0.05, M.yellow], [3.7, 0.05, M.grey], [-2.9, 0.04, M.cyanSoft]] as const) {
    cyl(m, r, 14, 0, H - 0.25 - r, z, 0, 0, Math.PI / 2, 12);
    for (let i = 0; i < 9; i++) cyl(M.dgrey, r * 1.3, 0.06, -6.3 + i * 1.55, H - 0.25 - r, z, 0, 0, Math.PI / 2, 12);
  }
  for (const x of [-5.9, 5.9, -2.2, 2.2]) { cyl(M.grey, 0.06, 10, x, H - 0.55, 0, Math.PI / 2, 0, 0, 12); for (let i = 0; i < 6; i++) cyl(M.dgrey, 0.08, 0.06, x, H - 0.55, -4.4 + i * 1.75, Math.PI / 2, 0, 0, 12); }
  // ケーブルトレイ
  box(M.dgrey, 14, 0.04, 0.45, 0, H - 0.4, 2.9, 0, 0.01); box(M.dgrey, 14, 0.1, 0.03, 0, H - 0.35, 2.68, 0, 0.005); box(M.dgrey, 14, 0.1, 0.03, 0, H - 0.35, 3.12, 0, 0.005);
  for (let i = 0; i < 5; i++) cyl(pick(cabMats), 0.03, 14, 0, H - 0.34, 2.8 + i * 0.07, 0, 0, Math.PI / 2, 8);
  // 垂れ下がるケーブル
  for (let i = 0; i < 8; i++) { const x = rr(-5, 5), z = rr(-3, 3); if (Math.abs(x) < 2.4 && Math.abs(z) < 1.6) continue; tube(pick(cabMats), [[x, H - 0.35, z], [x + rr(-0.2, 0.2), H - 0.9, z + rr(-0.2, 0.2)], [x + rr(-0.3, 0.3), H - 1.2, z + rr(-0.3, 0.3)]], 0.015, 8); }

  // ---- ブラストドア（西壁） ----
  pushM(wallM('W', 0, 0, 0));
  box(M.dgrey, 0.3, 2.9, 0.22, -1.25, 1.45, 0.11, 0, 0.03); box(M.dgrey, 0.3, 2.9, 0.22, 1.25, 1.45, 0.11, 0, 0.03); box(M.dgrey, 2.8, 0.3, 0.22, 0, 2.85, 0.11, 0, 0.03);
  box(M.black, 2.2, 2.7, 0.05, 0, 1.35, 0.03, 0, 0.02);
  box(M.grey, 2.1, 2.62, 0.14, 0, 1.31, 0.12, 0, 0.06);
  for (const [dx, dy] of [[-0.55, 0.85], [0.55, 0.85], [-0.55, 1.78], [0.55, 1.78]]) box(M.dgrey, 0.7, 0.7, 0.03, dx, dy + 0.2, 0.195, 0, 0.04);
  tor(M.yellow, 0.42, 0.045, 0, 1.35, 0.22, 0, 0, 0, Math.PI * 2, 28); tor(M.dgrey, 0.28, 0.03, 0, 1.35, 0.23, 0, 0, 0, Math.PI * 2, 24);
  for (let i = 0; i < 4; i++) box(M.yellow, 0.7, 0.05, 0.05, 0, 1.35, 0.235, 0, 0.01, 0, 0 + i * Math.PI / 4 + 0);
  cyl(M.red, 0.07, 0.05, 0, 1.35, 0.25, Math.PI / 2, 0, 0, 12);
  // ハザード帯
  const hz = canvasTex(256, 32, (g, w, h) => { g.fillStyle = '#ffd83a'; g.fillRect(0, 0, w, h); g.fillStyle = '#2a2f36'; for (let x = -32; x < w + 32; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 48, 0); g.lineTo(x + 32, 0); g.fill(); } }, 4);
  const hzMat = S(0xffffff, 0.6, 0, { map: hz }); hz.wrapS = THREE.RepeatWrapping; hz.repeat.set(3, 1);
  plane(hzMat, 2.1, 0.14, 0, 0.35, 0.2); plane(hzMat, 2.1, 0.14, 0, 2.55, 0.2);
  box(M.black, 0.16, 0.26, 0.04, 1.6, 1.25, 0.04, 0, 0.01); box(M.cyan, 0.08, 0.05, 0.005, 1.6, 1.3, 0.065, 0, 0); box(M.red, 0.03, 0.03, 0.005, 1.6, 1.18, 0.065, 0, 0);
  const doorLedMat = B(0xff4a3a); noShadowMats.add(doorLedMat); plane(doorLedMat, 0.2, 0.06, 0, 3.15, 0.0, 0, 0);
  box(M.black, 0.5, 0.12, 0.05, 0, 3.15, 0.03, 0, 0.02);
  const signTex = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#ffd83a'; g.fillRect(0, 0, w, h); g.fillStyle = '#2a2f36'; g.fillRect(6, 6, w - 12, h - 12); g.fillStyle = '#ffd83a';
    g.font = `bold 52px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('スパーク特別研究室', w / 2, 48); g.font = `bold 26px ${FONT}`; g.fillText('SPARK LAB / 立入禁止', w / 2, 98);
  });
  const signMat = S(0xffffff, 0.6, 0, { map: signTex });
  plane(signMat, 1.6, 0.4, 0, 3.15, 0.2);
  pop();
  void doorLedMat; // 点滅は LED 系で兼用しない（常時赤）

  // ---- ホワイトボード／ピンボード ----
  const boardMat = S(0xcfdbe4, 0.5, 0, {});
  const boardFrame = (wl: W, u: number, y: number, w: number, h: number) => {
    pushM(wallM(wl, u, y, 0.02));
    box(M.navy, w + 0.1, h + 0.1, 0.03, 0, 0, 0, 0, 0.015); box(boardMat, w, h, 0.034, 0, 0, 0, 0, 0.005);
    box(M.grey, w * 0.8, 0.04, 0.08, 0, -h / 2 - 0.02, 0.04, 0, 0.01);
    for (let i = 0; i < 4; i++) box(pick([M.red, M.navy, M.green, M.black]), 0.012, 0.012, 0.09, -w * 0.3 + i * 0.1, -h / 2 + 0.0, 0.05, 0, 0.003, Math.PI / 2);
    pop();
  };
  boardFrame('N', 0, 2.3, 4.8, 2.0); boardFrame('S', 5.25, 2.1, 2.7, 2.1); boardFrame('W', 3.15, 2.1, 3.1, 2.1);

  // ---- 中央奥：ナノ組立機（フェブリケーター） ----
  pushM(local(0, 0, -HZ + 0.6, 0, 0, 0));
  box(M.navy, 2.0, 1.0, 0.95, 0, 0.5, 0, 0, 0.05); box(M.offwhite, 1.9, 0.1, 0.9, 0, 1.05, 0, 0, 0.04);
  box(M.glass, 1.2, 0.5, 0.05, 0, 0.55, 0.49, 0, 0.02); box(M.dgrey, 1.3, 0.04, 0.06, 0, 0.8, 0.49, 0, 0.01); box(M.dgrey, 1.3, 0.04, 0.06, 0, 0.3, 0.49, 0, 0.01);
  box(M.white, 0.28, 0.2, 0.2, -0.2, 0.46, 0.05, 0.3, 0.05); box(M.cyan, 0.2, 0.02, 0.005, -0.2, 0.5, 0.155, 0.3, 0); cyl(M.grey, 0.02, 0.4, 0.35, 0.65, 0.1, 0, 0, 0.3); sph(M.cyan, 0.03, 0.4, 0.45, 0.1);
  box(M.black, 0.4, 0.3, 0.04, 0.7, 0.55, 0.49, 0, 0.01); plane(scrMats[0], 0.37, 0.27, 0.7, 0.55, 0.512);
  for (let i = 0; i < 5; i++) box(M.cyan, 0.05, 0.012, 0.005, -0.85, 0.2 + i * 0.1, 0.49, 0, 0);
  surfaces.push({ m: top().clone().multiply(local(0, 1.1, 0)), w: 1.9, d: 0.9, y: 0, occ: [] });
  pop();

  // ---- 床置き小物（箱・クレート・ケーブルドラム） ----
  for (let i = 0; i < 9; i++) {
    const w = rr(0.4, 0.7), h = rr(0.3, 0.5), d = rr(0.4, 0.6); const x = -6.3 + (i % 3) * 0.62 + rr(-0.05, 0.05), z = 4.15 - Math.floor(i / 3) * 0.55; // 南西コーナー
    if (i > 5) continue;
    const y = i > 3 ? 0.35 : 0; box(i % 2 ? M.cardboard : M.dgrey, w * 0.9, h, d * 0.9, x, y + h / 2, z, rr(-0.3, 0.3), 0.02);
    if (i % 2 === 0) box(M.yellow, w * 0.5, 0.04, 0.005, x, y + h * 0.6, z + d * 0.45, 0, 0);
  }
  cyl(M.wood, 0.4, 0.06, 6.2, 0.4, -4.1, 0, 0, 0); cyl(M.wood, 0.4, 0.06, 6.2, 0.04, -4.1, 0, 0, 0); cyl(M.copper, 0.3, 0.3, 6.2, 0.22, -4.1);
  for (let i = 0; i < 3; i++) { const a = rand() * 6.28; box(pick(cabMats), 0.5, 0.02, 0.02, rr(-5.5, 5.5), 0.012, rr(-3.5, 3.5), a, 0.005); }
  // 床の細かい部品
  for (let i = 0; i < 28; i++) {
    const x = rr(-6, 6), z = rr(-4.2, 4.2); if (Math.abs(z) < 1.2 && x < -2) continue; if (Math.abs(x) < 1.8 && Math.abs(z) < 1.0) continue;
    const k = rand(); if (k < 0.5) box(pick(boxCols), rr(0.04, 0.1), rr(0.02, 0.05), rr(0.04, 0.1), x, 0.03, z, rand() * 6, 0.005); else cyl(pick([M.grey, M.copper, M.dgrey]), rr(0.02, 0.05), rr(0.03, 0.08), x, 0.03, z, 0, 0, rand() < 0.5 ? Math.PI / 2 : 0, 8);
  }

  // ---- 机上のちらかし（紙・マグ・本・ペン・タブレット・部品） ----
  const paperDesigns = 6; // desk 用の紙 tex は壁用の 0〜5 を共有
  const dPaper: THREE.Matrix4[][] = Array.from({ length: paperDesigns }, () => []);
  const sticky: { m: THREE.Matrix4; c: number }[] = [];
  const qLay = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const qYaw = new THREE.Quaternion();
  for (const s of surfaces) {
    const count = Math.round(s.w * s.d * 22);
    let stackN = 0;
    for (let i = 0; i < count; i++) {
      const lx = rr(-s.w / 2 + 0.1, s.w / 2 - 0.1), lz = rr(-s.d / 2 + 0.08, s.d / 2 - 0.08);
      if (s.occ.some((o) => lx > o[0] - 0.05 && lx < o[1] + 0.05 && lz > o[2] - 0.05 && lz < o[3] + 0.05)) continue;
      const k = rand();
      const wm = s.m.clone().multiply(local(lx, 0, lz, 0, rand() * 6.28, 0));
      if (k < 0.5) { // 紙（1〜3枚重ね）
        const n = 1 + Math.floor(rand() * 3);
        for (let j = 0; j < n; j++) {
          const sc = rr(0.9, 1.15); const des = Math.floor(rand() * paperDesigns);
          const q = qYaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rr(-0.5, 0.5)).multiply(qLay);
          dPaper[des].push(wm.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(rr(-0.03, 0.03), 0.002 + (stackN++ % 40) * 0.0012, rr(-0.03, 0.03)), q.clone(), new THREE.Vector3(0.21 * sc, 0.297 * sc, 1))));
        }
      } else if (k < 0.6) { pushM(wm); const c = pick([M.white, M.yellow, M.cyanSoft, M.pink, M.orange, M.navy]); cyl(c, 0.04, 0.09, 0, 0.045, 0, 0, 0, 0, 12); cyl(M.rubber, 0.034, 0.005, 0, 0.088, 0, 0, 0, 0, 12); tor(c, 0.025, 0.007, 0.05, 0.045, 0, 0, 0, 0, Math.PI, 10); pop(); }
      else if (k < 0.68) { pushM(wm); const n = 1 + Math.floor(rand() * 4); for (let j = 0; j < n; j++) box(pick([M.navy, M.red, M.green, M.white, M.yellow, M.cardboard]), 0.2 - j * 0.01, 0.03, 0.15 - j * 0.005, rr(-0.01, 0.01), 0.015 + j * 0.03, rr(-0.01, 0.01), rr(-0.3, 0.3), 0.005); pop(); }
      else if (k < 0.75) { pushM(wm); for (let j = 0; j < 2; j++) cyl(pick([M.red, M.navy, M.black, M.cyanSoft]), 0.004, 0.14, j * 0.02, 0.005, j * 0.01, 0, 0, Math.PI / 2, 6); pop(); }
      else if (k < 0.8) { pushM(wm); box(M.black, 0.24, 0.012, 0.17, 0, 0.007, 0, 0, 0.008); plane(scrMats[Math.floor(rand() * scrMats.length)], 0.22, 0.15, 0, 0.0135, 0, -Math.PI / 2); pop(); }
      else if (k < 0.9) { pushM(wm); for (let j = 0; j < 4; j++) { const a = rand() * 6.28; if (rand() < 0.5) box(pick([M.grey, M.copper, M.dgrey, M.green]), rr(0.02, 0.05), 0.01, rr(0.02, 0.05), Math.cos(a) * 0.05, 0.006, Math.sin(a) * 0.05, a, 0.002); else cyl(pick([M.grey, M.copper]), rr(0.008, 0.02), rr(0.01, 0.03), Math.cos(a) * 0.05, 0.01, Math.sin(a) * 0.05, 0, 0, 1.57, 8); } pop(); }
      else if (k < 0.96) { sticky.push({ m: wm.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(0, 0.003, 0), qLay.clone(), new THREE.Vector3(0.075, 0.075, 1))), c: pick([0xffe14a, 0xff9ec2, 0x8fe6ff, 0xb7f08a]) }); }
      else { pushM(wm); cyl(M.white, 0.045, 0.1, 0, 0.05, 0, 0, 0, 0, 12); cyl(M.red, 0.047, 0.03, 0, 0.07, 0, 0, 0, 0, 12); cyl(M.cardboard, 0.04, 0.003, 0, 0.1, 0); pop(); }
    }
  }
  // 机上ランプ
  for (const s of surfaces.slice(0, 5)) { pushM(s.m.clone().multiply(local(s.w / 2 - 0.15, 0, -s.d / 2 + 0.15))); cyl(M.dgrey, 0.07, 0.02, 0, 0.01, 0); cyl(M.grey, 0.008, 0.3, 0, 0.17, 0, 0, 0, 0.3, 6); cyl(M.grey, 0.008, 0.28, -0.07, 0.35, 0, 0, 0, -0.9, 6); cyl(M.orange, 0.04, 0.07, -0.16, 0.37, 0, 0, 0, 0.5, 10, 0.06); pop(); }

  // ---- 壁の紙 ----
  const paperTexFns: ((g: CanvasRenderingContext2D, w: number, h: number) => void)[] = [];
  const ink = '#2a3340';
  const scribble = (g: CanvasRenderingContext2D, x: number, y: number, w: number, col = ink, amp = 2) => {
    g.strokeStyle = col; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y);
    for (let sx = 0; sx < w; sx += 5) g.lineTo(x + sx, y + rr(-amp, amp));
    g.stroke();
  };
  const paperBase = (g: CanvasRenderingContext2D, w: number, h: number, c = '#f6f3ea') => {
    g.fillStyle = c; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
  };
  paperTexFns[0] = (g, w, h) => { // メモ書き
    paperBase(g, w, h); g.fillStyle = ink; g.font = `bold 20px ${FONT}`; g.fillText('メモ 火星 8/12', 14, 30);
    for (let y = 52; y < h - 20; y += 16) { if (rand() < 0.1) continue; scribble(g, 14, y, rr(90, w - 40), ink, 2.2); }
    g.strokeStyle = '#e0524a'; g.lineWidth = 2.5; g.beginPath(); g.ellipse(w * 0.6, h * 0.55, 40, 16, 0.2, 0, 7); g.stroke();
  };
  paperTexFns[1] = (g, w, h) => { // スケッチ
    paperBase(g, w, h, '#f3f1e8'); g.strokeStyle = '#555'; g.lineWidth = 1.3;
    for (let i = 0; i < 3; i++) { const cx = 70 + (i % 2) * 70, cy = 70 + i * 90; for (let k = 0; k < 2; k++) { g.beginPath(); g.arc(cx + rr(-2, 2), cy + rr(-2, 2), 24 + i * 4, 0, 7); g.stroke(); } g.strokeRect(cx - 14 + rr(-2, 2), cy + 24, 28, 38); g.beginPath(); g.moveTo(cx - 30, cy + 30); g.lineTo(cx - 60, cy + 70); g.moveTo(cx + 30, cy + 30); g.lineTo(cx + 60, cy + 70); g.stroke(); }
    g.fillStyle = ink; g.font = `13px ${FONT}`; g.fillText('腕の関節 案2', 14, h - 14);
  };
  paperTexFns[2] = (g, w, h) => { // グラフ
    paperBase(g, w, h); g.strokeStyle = ink; g.lineWidth = 1.5; g.beginPath(); g.moveTo(24, 40); g.lineTo(24, 180); g.lineTo(w - 20, 180); g.stroke();
    g.strokeStyle = '#0aa6c2'; g.lineWidth = 2; g.beginPath(); for (let x = 24; x < w - 20; x += 6) { const y = 150 - Math.abs(Math.sin(x * 0.04)) * 90 + rr(-4, 4); x === 24 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
    g.fillStyle = '#ffd83a'; for (let i = 0; i < 6; i++) g.fillRect(34 + i * 30, 180 - 20 - i * 12, 16, 20 + i * 12);
    g.fillStyle = ink; g.font = `bold 15px ${FONT}`; g.fillText('電圧 / 出力比', 24, 24); for (let y = 210; y < h - 20; y += 16) scribble(g, 24, y, rr(80, 180));
  };
  paperTexFns[3] = (g, w, h) => { // 回路図
    paperBase(g, w, h, '#eef3f6'); g.strokeStyle = '#1b4f8a'; g.lineWidth = 1.6; g.beginPath();
    for (let r = 0; r < 5; r++) { const y = 40 + r * 55; g.moveTo(20, y); g.lineTo(60, y); g.strokeRect(60, y - 8, 36, 16); g.moveTo(96, y); g.lineTo(130, y); g.moveTo(130, y - 12); g.lineTo(130, y + 12); g.moveTo(138, y - 12); g.lineTo(138, y + 12); g.moveTo(138, y); g.lineTo(w - 20, y); if (r < 4) { g.moveTo(w - 20, y); g.lineTo(w - 20, y + 55); } g.moveTo(40, y); g.lineTo(40, y + (r < 4 ? 55 : 0)); }
    g.stroke(); g.fillStyle = '#e0524a'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(40, 40 + i * 55, 3, 0, 7); g.fill(); }
    g.fillStyle = ink; g.font = `12px ${FONT}`; g.fillText('吸収回路 v3', 14, h - 12);
  };
  paperTexFns[4] = (g, w, h) => { // 数式
    paperBase(g, w, h); g.fillStyle = ink; g.font = `italic 18px serif`;
    const eq = ['E = ½CV²', 'P = I·V', 'η = Pout / Pin', 'Q = ∫ I dt', 'V = IR', 'Σ I = 0', '∇·E = ρ/ε', 'ΔV → 0 ?'];
    eq.forEach((e, i) => { g.save(); g.translate(16, 34 + i * 38); g.rotate(rr(-0.05, 0.05)); g.fillText(e, 0, 0); g.restore(); });
    g.strokeStyle = '#e0524a'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(10, h - 50); g.lineTo(w - 12, h - 60); g.stroke(); g.fillStyle = '#e0524a'; g.font = `bold 16px ${FONT}`; g.fillText('要確認！', 20, h - 20);
  };
  paperTexFns[5] = (g, w, h) => { // 赤ペンで直した紙
    paperBase(g, w, h); for (let y = 30; y < h - 20; y += 15) scribble(g, 14, y, rr(100, w - 30), ink, 1.8);
    g.strokeStyle = '#e0524a'; g.lineWidth = 2; for (let i = 0; i < 5; i++) { const y = 30 + Math.floor(rand() * 10) * 15; g.beginPath(); g.moveTo(14, y); g.lineTo(rr(100, w - 30), y + rr(-3, 3)); g.stroke(); }
    g.beginPath(); g.moveTo(w - 60, h - 70); g.lineTo(w - 20, h - 30); g.moveTo(w - 20, h - 70); g.lineTo(w - 60, h - 30); g.stroke();
    g.fillStyle = '#e0524a'; g.font = `bold 15px ${FONT}`; g.fillText('だめ → もう一度', 14, h - 20);
  };
  const paperTexs = paperTexFns.map((f) => canvasTex(256, 362, f));
  const cyborgBP = canvasTex(1024, 680, (g, w, h) => {
    g.fillStyle = '#143d7a'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = '#e8f6ff'; g.lineWidth = 3;
    const fig = (cx: number, top: number, s: number, side: boolean) => {
      g.beginPath(); g.arc(cx, top + 40 * s, 36 * s, 0, 7); g.stroke();
      g.strokeRect(cx - 50 * s, top + 84 * s, 100 * s, 150 * s); g.strokeRect(cx - 80 * s, top + 90 * s, 28 * s, 140 * s); g.strokeRect(cx + 52 * s, top + 90 * s, 28 * s, 140 * s);
      g.strokeRect(cx - 46 * s, top + 238 * s, 42 * s, 190 * s); g.strokeRect(cx + 4 * s, top + 238 * s, 42 * s, 190 * s);
      g.beginPath(); g.arc(cx, top + 150 * s, 22 * s, 0, 7); g.stroke(); g.fillStyle = '#ffd83a'; g.beginPath(); g.arc(cx, top + 150 * s, 9 * s, 0, 7); g.fill();
      if (side) { g.beginPath(); g.moveTo(cx - 50 * s, top + 90 * s); g.lineTo(cx - 70 * s, top + 180 * s); g.stroke(); }
    };
    fig(260, 100, 1.2, false); fig(620, 120, 1, true);
    g.lineWidth = 1.4; g.setLineDash([8, 6]); g.beginPath(); g.moveTo(130, 70); g.lineTo(130, 640); g.moveTo(780, 70); g.lineTo(780, 640); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#e8f6ff'; g.font = `bold 34px ${FONT}`; g.fillText('CYBORG-01 設計図', 60, 56); g.font = `20px ${FONT}`;
    const notes = ['吸収コア (胸部)', '放電アーム ×2', 'ジェットパック接続部', '神経リンク', 'スカウター'];
    notes.forEach((n, i) => { g.fillText(n, 760, 150 + i * 70); g.beginPath(); g.moveTo(755, 146 + i * 70); g.lineTo(720, 160 + i * 20); g.stroke(); });
    g.strokeStyle = '#ffd83a'; g.lineWidth = 2; g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#ffd83a'; g.font = `bold 22px ${FONT}`; g.fillText('SPARK', w - 130, h - 30);
  }, 8);
  const marsMap = canvasTex(800, 600, (g, w, h) => {
    g.fillStyle = '#b5623f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(${rand() < 0.5 ? '255,200,150' : '90,40,20'},${rand() * 0.15})`; g.fillRect(rand() * w, rand() * h, 2 + rand() * 6, 2 + rand() * 6); }
    g.strokeStyle = 'rgba(80,30,20,0.6)'; g.lineWidth = 2; for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(rand() * w, rand() * h, 10 + rand() * 50, 0, 7); g.stroke(); }
    g.strokeStyle = 'rgba(255,220,170,0.5)'; g.lineWidth = 2; for (let k = 0; k < 6; k++) { g.beginPath(); for (let x = 0; x <= w; x += 20) { const y = 80 + k * 90 + Math.sin(x * 0.012 + k) * 30; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    g.strokeStyle = '#2ee6ff'; g.lineWidth = 4; g.setLineDash([14, 8]); g.beginPath(); g.moveTo(120, 480); g.lineTo(260, 380); g.lineTo(400, 400); g.lineTo(520, 280); g.lineTo(660, 300); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#ffd83a'; g.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 22 : 50; g.lineTo(560 + Math.cos(a) * r, 150 + Math.sin(a) * r); } g.fill();
    g.fillStyle = '#e0524a'; g.beginPath(); g.arc(120, 480, 12, 0, 7); g.fill(); g.font = `bold 30px ${FONT}`; g.fillStyle = '#fff'; g.fillText('ここ（研究室）', 140, 500);
    g.font = `bold 26px ${FONT}`; g.fillText('フラックス衝突点', 600, 90); g.fillText('火星 地下ルート', 30, 50);
    g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(4, 4, w - 8, h - 8);
  }, 8);
  const stickyTex = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, h - 10, w, 10);
    g.strokeStyle = 'rgba(40,40,50,0.8)'; g.lineWidth = 1.5; for (let y = 14; y < h - 16; y += 11) { g.beginPath(); g.moveTo(8, y); for (let x = 8; x < rr(30, 56); x += 4) g.lineTo(x, y + rr(-1.5, 1.5)); g.stroke(); }
  }, 4);
  const tapeTex = null;
  void tapeTex;

  interface PD { tex: THREE.Texture; w: number; h: number }
  const designs: PD[] = [...paperTexs.map((t) => ({ tex: t, w: 0.21, h: 0.297 })), { tex: cyborgBP, w: 0.9, h: 0.6 }, { tex: marsMap, w: 0.8, h: 0.6 }];
  // 壁用に配置を溜める
  const wallPl: THREE.Matrix4[][] = designs.map(() => []);
  const wallSticky: { m: THREE.Matrix4; c: number }[] = [];
  const tapes: THREE.Matrix4[] = [];
  const qz = new THREE.Quaternion(), vz = new THREE.Vector3(0, 0, 1);
  let layer = 0;
  const hang = (w: W, u: number, y: number, des: number, scale: number, rot: number, tape = true) => {
    const d = designs[des]; const off = 0.045 + ((layer++ % 30) * 0.0016);
    const m = wallM(w, u, y, off).multiply(new THREE.Matrix4().compose(new THREE.Vector3(), qz.setFromAxisAngle(vz, rot), new THREE.Vector3(d.w * scale, d.h * scale, 1)));
    wallPl[des].push(m);
    if (tape) {
      const tm = wallM(w, u + Math.sin(rot) * -d.h * scale * 0.5, y + Math.cos(rot) * d.h * scale * 0.5 - 0.005, off + 0.002).multiply(new THREE.Matrix4().compose(new THREE.Vector3(), qz.setFromAxisAngle(vz, rot + rr(-0.5, 0.5)), new THREE.Vector3(0.07, 0.03, 1)));
      tapes.push(tm);
    }
  };
  const zones: { w: W; u0: number; u1: number; y0: number; y1: number; step: number; fill: number }[] = [
    { w: 'N', u0: -6.6, u1: -2.35, y0: 1.65, y1: 3.2, step: 0.36, fill: 0.85 }, { w: 'N', u0: 2.35, u1: 6.6, y0: 1.65, y1: 3.2, step: 0.36, fill: 0.85 },
    { w: 'N', u0: -2.3, u1: 2.3, y0: 1.4, y1: 3.2, step: 0.4, fill: 0.9 },
    { w: 'S', u0: -6.6, u1: -2.5, y0: 2.55, y1: 3.2, step: 0.34, fill: 0.8 }, { w: 'S', u0: -2.3, u1: 3.6, y0: 1.5, y1: 3.2, step: 0.36, fill: 0.85 },
    { w: 'S', u0: 3.95, u1: 6.55, y0: 1.15, y1: 3.1, step: 0.4, fill: 0.9 },
    { w: 'E', u0: -4.8, u1: -2.7, y0: 2.4, y1: 3.2, step: 0.34, fill: 0.8 }, { w: 'E', u0: 2.7, u1: 4.8, y0: 2.4, y1: 3.2, step: 0.34, fill: 0.8 },
    { w: 'E', u0: -2.4, u1: 2.4, y0: 3.05, y1: 3.2, step: 0.4, fill: 0.5 },
    { w: 'W', u0: -4.8, u1: -1.5, y0: 2.55, y1: 3.2, step: 0.34, fill: 0.8 }, { w: 'W', u0: 1.7, u1: 4.6, y0: 1.2, y1: 3.1, step: 0.4, fill: 0.9 },
    { w: 'W', u0: -4.8, u1: -1.7, y0: 0.35, y1: 0.9, step: 0.4, fill: 0.0 },
  ];
  const smallDes = [0, 0, 1, 2, 3, 4, 4, 5, 1, 0];
  for (const z of zones) for (let u = z.u0 + 0.15; u < z.u1 - 0.1; u += z.step) for (let y = z.y0 + 0.2; y < z.y1 - 0.1; y += z.step * 1.15) {
    if (rand() > z.fill) continue;
    hang(z.w, u + rr(-0.1, 0.1), y + rr(-0.08, 0.08), pick(smallDes), rr(0.85, 1.35), rr(-0.18, 0.18));
  }
  // 大物（設計図・火星地図）と追加の A3 風
  hang('N', 0, 2.35, 6, 1.35, 0.01, true); hang('W', 3.15, 2.2, 7, 1.15, -0.02, true);
  hang('N', -1.55, 2.1, 6, 0.55, -0.06, true); hang('N', 1.6, 1.85, 6, 0.5, 0.05, true); hang('S', 5.25, 2.5, 6, 0.6, 0.04, true);
  hang('W', 2.2, 1.55, 7, 0.45, 0.08, true); hang('S', 4.7, 1.55, 7, 0.5, -0.05, true);
  // 付箋
  for (const z of zones) { if (z.fill === 0) continue; const n = Math.round((z.u1 - z.u0) * (z.y1 - z.y0) * 5); for (let i = 0; i < n; i++) { const w = wallM(z.w, rr(z.u0, z.u1), rr(z.y0, z.y1), 0.06 + rand() * 0.02); wallSticky.push({ m: w.multiply(new THREE.Matrix4().compose(new THREE.Vector3(), qz.setFromAxisAngle(vz, rr(-0.3, 0.3)), new THREE.Vector3(0.08, 0.08, 1))), c: pick([0xffe14a, 0xff9ec2, 0x8fe6ff, 0xb7f08a, 0xffb36b]) }); } }
  // モニター縁の付箋
  for (let i = 0; i < 14; i++) wallSticky.push({ m: wallM('E', rr(-2.2, 2.2), rr(1.2, 1.35), 0.09).multiply(new THREE.Matrix4().compose(new THREE.Vector3(), qz.setFromAxisAngle(vz, rr(-0.3, 0.3)), new THREE.Vector3(0.07, 0.07, 1))), c: pick([0xffe14a, 0xff9ec2, 0x8fe6ff]) });

  const planeGeo = new THREE.PlaneGeometry(1, 1); geos.add(planeGeo);
  const makeInst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], colors?: number[], shadow = false) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => { im.setMatrixAt(i, m); if (colors) im.setColorAt(i, new THREE.Color(colors[i])); });
    im.instanceMatrix.needsUpdate = true; im.castShadow = shadow; im.receiveShadow = false; im.frustumCulled = false;
    root.add(im); instanced.push(im);
  };
  designs.forEach((d, i) => {
    const mat = S(0xffffff, 0.8, 0, { map: d.tex, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
    makeInst(planeGeo, mat, wallPl[i]);
    if (i < paperDesigns) { const mat2 = S(0xfff6e8, 0.85, 0, { map: d.tex, side: THREE.DoubleSide }); makeInst(planeGeo, mat2, dPaper[i], undefined, true); }
  });
  const tapeMat = S(0xf2e4a8, 0.7, 0, { transparent: true, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -4 });
  makeInst(planeGeo, tapeMat, tapes);
  const stkMat = S(0xffffff, 0.9, 0, { map: stickyTex, polygonOffset: true, polygonOffsetFactor: -5, side: THREE.DoubleSide });
  makeInst(planeGeo, stkMat, wallSticky.map((s) => s.m), wallSticky.map((s) => s.c));
  makeInst(planeGeo, S(0xffffff, 0.9, 0, { map: stickyTex, side: THREE.DoubleSide }), sticky.map((s) => s.m), sticky.map((s) => s.c));

  // ---- 結合バッチを実メッシュ化 ----
  for (const [mat, list] of parts) {
    const g = mergeGeometries(list, false); list.forEach((l) => l.dispose());
    if (!g) continue; geos.add(g);
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = !noShadowMats.has(mat) && mat !== kbMat; mesh.receiveShadow = !noShadowMats.has(mat);
    root.add(mesh);
  }

  // ---- 動くもの：ロボットアーム（天井／床）、スキャンリング、ECG 台車の画面 ----
  const dyn = new THREE.Group(); root.add(dyn);
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], parent: THREE.Object3D, rot: [number, number, number] = [0, 0, 0]) => {
    geos.add(geo); const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.rotation.set(...rot); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  };
  const armRig = (base: THREE.Vector3, up: number, l1: number, l2: number) => {
    const g0 = new THREE.Group(); g0.position.copy(base); dyn.add(g0);
    mk(new THREE.CylinderGeometry(0.16, 0.19, 0.12, 20), M.dgrey, [0, 0, 0], g0);
    const j1 = new THREE.Group(); j1.position.y = 0.06 * up; g0.add(j1);
    mk(new THREE.SphereGeometry(0.11, 14, 10), M.white, [0, 0.02 * up, 0], j1);
    const j2 = new THREE.Group(); j2.position.y = 0.05 * up; j1.add(j2);
    mk(new THREE.SphereGeometry(0.075, 12, 8), M.cyan, [0, 0, 0], j2);
    mk(new THREE.CapsuleGeometry(0.055, l1, 6, 12), M.white, [0, (l1 / 2 + 0.05) * up, 0], j2);
    const j3 = new THREE.Group(); j3.position.y = (l1 + 0.1) * up; j2.add(j3);
    mk(new THREE.SphereGeometry(0.075, 12, 8), M.navy2, [0, 0, 0], j3);
    mk(new THREE.CapsuleGeometry(0.045, l2, 6, 12), M.offwhite, [0, (l2 / 2 + 0.04) * up, 0], j3);
    const j4 = new THREE.Group(); j4.position.y = (l2 + 0.08) * up; j3.add(j4);
    mk(new THREE.CylinderGeometry(0.05, 0.035, 0.12, 12), M.dgrey, [0, 0.06 * up, 0], j4);
    mk(new THREE.ConeGeometry(0.035, 0.12, 10), M.grey, [0, 0.18 * up, 0], j4, [up > 0 ? 0 : Math.PI, 0, 0]);
    mk(new THREE.SphereGeometry(0.02, 8, 6), M.cyan, [0, 0.25 * up, 0], j4);
    return { g0, j1, j2, j3, j4 };
  };
  const armC = armRig(new THREE.Vector3(-0.5, H - 0.25, -0.85), -1, 0.6, 0.55);
  const armC2 = armRig(new THREE.Vector3(0.9, H - 0.25, -0.85), -1, 0.55, 0.5);
  const armF = armRig(new THREE.Vector3(-0.2, 0.06, -1.6), 1, 0.75, 0.6);
  // スキャンリング（足側で往復）
  const ring = new THREE.Group(); ring.position.set(2.5, 1.15, -1.3); dyn.add(ring);
  mk(new THREE.TorusGeometry(0.78, 0.09, 12, 36), M.offwhite, [0, 0, 0], ring, [0, Math.PI / 2, 0]);
  mk(new THREE.TorusGeometry(0.7, 0.025, 8, 36), M.cyan, [0, 0, 0.0], ring, [0, Math.PI / 2, 0]).position.x = 0.07;
  mk(new THREE.BoxGeometry(0.16, 0.12, 0.3), M.navy, [0, -0.78, 0], ring);
  mk(new THREE.BoxGeometry(0.18, 0.06, 1.5), M.dgrey, [0, -1.12, 0], ring);
  // 床レール
  box(M.dgrey, 1.8, 0.03, 0.3, 2.5, 0.015, -1.3, 0, 0.01);
  void 0;
  // ECG 画面を台車のモニターへ
  const ecgMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.3), ecgScr.mat); geos.add(ecgMesh.geometry);
  ecgMesh.position.set(-1.2 + Math.sin(0.2) * 0.056, 1.4, -1.55 + Math.cos(0.2) * 0.056); ecgMesh.rotation.y = 0.2; dyn.add(ecgMesh);
  // 動く床アーム・ベッド上スキャナの青い走査光
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.012), B(0x2ee6ff, { transparent: true, opacity: 0.55, side: THREE.DoubleSide })); geos.add(beam.geometry); mats.add(beam.material as THREE.Material);
  beam.rotation.x = -Math.PI / 2; beam.position.set(0, 1.0, 0); beam.visible = true; dyn.add(beam);
  beam.scale.set(0.001, 0.001, 1); beam.visible = false;

  // ---- ライト ----
  const hemi = new THREE.HemisphereLight(0xffffff, 0xd2dae2, 1.15); root.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 0.7); sun.position.set(3, 6, 4.5); sun.target.position.set(0, 0, 0);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -9; sc.right = 9; sc.top = 7; sc.bottom = -7; sc.near = 1; sc.far = 18; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
  root.add(sun, sun.target);
  const spot = new THREE.SpotLight(0xfff0dc, 50, 7, 0.75, 0.8, 2); spot.position.set(0.4, H - 0.3, 0.6); spot.target.position.set(0, 0.8, 0.3);
  spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0005; spot.shadow.normalBias = 0.03; root.add(spot, spot.target);
  for (const [x, z] of [[-4.2, -2.1], [4.2, -2.1], [-4.2, 2.1], [4.2, 2.1], [0, -2.1]]) { const p = new THREE.PointLight(0xfff0d8, 9, 9, 2); p.position.set(x, H - 0.4, z); root.add(p); }
  const cy1 = new THREE.PointLight(0x2ee6ff, 6, 7, 2); cy1.position.set(5.5, 1.8, 0); root.add(cy1);
  const cy2 = new THREE.PointLight(0x2ee6ff, 5, 6, 2); cy2.position.set(0, 0.35, 0); root.add(cy2);
  const cy3 = new THREE.PointLight(0x69dfff, 4, 6, 2); cy3.position.set(-4.5, 1.4, -4); root.add(cy3);
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { /* 壁・床は影を落とさない */ } });
  floor.castShadow = false; ceil.castShadow = false;

  // ---- アンカー ----
  const A = (name: string, x: number, y: number, z: number) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); root.add(o); anchors[name] = o; return o; };
  const sparkStand = A('sparkStand', -0.8, 0, 1.5), heroStand = A('heroStand', 0.8, 0, 1.5);
  sparkStand.lookAt(0.8, 0, 1.5); heroStand.lookAt(-0.8, 0, 1.5);
  const heroBed = A('heroBed', 0.95, padY + 0.15, 0);
  // 立ちモデルを親にすると仰向け（頭=-x、胸=+y）になる向き
  heroBed.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));
  const cam = (name: string, pos: [number, number, number], target: [number, number, number], fov: number) => {
    const o = A(name, ...pos); const c = new THREE.PerspectiveCamera(fov); c.position.set(...pos); c.lookAt(...target); o.quaternion.copy(c.quaternion);
    o.userData.fov = fov; o.userData.target = new THREE.Vector3(...target);
  };
  cam('camWide', [5.4, 2.2, 4.3], [-0.5, 1.0, -0.4], 60);
  cam('camOverShoulderSpark', [-2.9, 1.72, 2.85], [0.8, 1.5, 1.45], 36);
  cam('camOverShoulderHero', [2.4, 1.72, 0.85], [-0.8, 1.5, 1.5], 38);
  cam('camBed', [0.5, 2.0, 3.0], [0, 0.95, 0], 52);
  const door = A('door', -HX + 0.5, 0, 0); door.rotation.y = Math.PI / 2;

  // ---- 更新 ----
  let t = 0;
  const arm1 = { a: 0 };
  void arm1;
  function update(dt: number) {
    t += dt;
    for (const s of screens) {
      if (!s.anim) continue;
      s.acc += dt; if (s.acc < s.every) continue; s.acc = 0;
      s.draw(s.g, s.w, s.h, t); s.tex.needsUpdate = true;
    }
    for (const l of leds) { const on = ((t / l.period + l.phase) % 1) < l.duty; l.mat.color.copy(l.base).multiplyScalar(on ? 1 : 0.12); }
    armC.g0.rotation.y = Math.PI / 2 + Math.sin(t * 0.25) * 0.5; armC.j2.rotation.z = 0.5 + Math.sin(t * 0.4) * 0.15; armC.j3.rotation.z = 0.5 + Math.sin(t * 0.55 + 1) * 0.2; armC.j4.rotation.y = t * 0.8;
    armC2.g0.rotation.y = Math.PI / 2 + Math.sin(t * 0.2 + 2) * 0.5; armC2.j2.rotation.z = 0.45 + Math.sin(t * 0.33) * 0.15; armC2.j3.rotation.z = 0.6 + Math.sin(t * 0.5) * 0.2;
    armF.g0.rotation.y = 0.2 + Math.sin(t * 0.3) * 0.4; armF.j2.rotation.z = -0.4 + Math.sin(t * 0.37) * 0.15; armF.j3.rotation.z = -0.5 + Math.sin(t * 0.5 + 0.5) * 0.25; armF.j4.rotation.y = t;
    ring.position.x = 2.5 + Math.sin(t * 0.35) * 0.15;
    cy2.intensity = 5 + Math.sin(t * 2) * 0.8;
  }

  function dispose() {
    root.removeFromParent();
    for (const im of instanced) im.dispose();
    geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); texs.forEach((x) => x.dispose());
    sun.shadow.map?.dispose(); spot.shadow.map?.dispose();
  }

  return { root, anchors, update, dispose };
}
