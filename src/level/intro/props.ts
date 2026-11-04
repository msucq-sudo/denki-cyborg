// 導入の小道具：天井の降下口と、床から出てくる的ボックス（チュートリアル2のウォーカーが入っている）。
import * as THREE from 'three';

const BOX = new THREE.BoxGeometry(1, 1, 1);

function glowMat(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}

export interface TargetBox {
  root: THREE.Group;
  /** 0=床の下、1=せり上がった */
  setRise(k: number): void;
  /** 扉（手前＝西側）の開き 0..1 */
  setOpen(k: number): void;
  dispose(): void;
}

/** 的ボックス（幅 1.7 × 奥行 1.7 × 高さ 2.4）。-X 側（部屋の中心側）に観音開きの扉。ウォーカーはこの中から出てくる */
export function buildTargetBox(x: number, z: number): TargetBox {
  const root = new THREE.Group();
  root.name = 'intro-target-box';
  const hull = new THREE.MeshStandardMaterial({ color: 0x27304f, roughness: 0.55, metalness: 0.5 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xdfe6f2, roughness: 0.4, metalness: 0.2 });
  const glow = glowMat(0x58e6ff);
  const warn = glowMat(0xffc400);
  const mats: THREE.Material[] = [hull, trim, glow, warn];
  const part = (m: THREE.Material, sx: number, sy: number, sz: number, px: number, py: number, pz: number, parent: THREE.Object3D = root): THREE.Mesh => {
    const me = new THREE.Mesh(BOX, m);
    me.scale.set(sx, sy, sz);
    me.position.set(px, py, pz);
    parent.add(me);
    return me;
  };
  const W = 1.7, H = 2.4, T = 0.12;
  // 中は空洞（後ろ・左右・天井・床）
  part(hull, T, H, W, W / 2 - T / 2, H / 2, 0);              // 奥（+X）
  part(hull, W, H, T, 0, H / 2, W / 2 - T / 2);              // +Z 側
  part(hull, W, H, T, 0, H / 2, -W / 2 + T / 2);             // -Z 側
  part(hull, W, T, W, 0, H - T / 2, 0);                      // 天井
  part(hull, W, T, W, 0, T / 2, 0);                          // 床
  part(trim, W + 0.1, 0.1, W + 0.1, 0, H + 0.02, 0);         // 天面の縁
  part(glow, 0.06, H - 0.4, 0.06, -W / 2 - 0.01, H / 2, W / 2 - 0.1);
  part(glow, 0.06, H - 0.4, 0.06, -W / 2 - 0.01, H / 2, -W / 2 + 0.1);
  part(warn, 0.04, 0.12, W - 0.5, -W / 2 - 0.02, H - 0.25, 0);    // 上部の黄色い帯
  // 扉（観音開き。中心から ±Z へスライド）
  const doorL = part(trim, 0.08, H - 0.3, W / 2 - 0.02, -W / 2 + 0.02, H / 2, -W / 4);
  const doorR = part(trim, 0.08, H - 0.3, W / 2 - 0.02, -W / 2 + 0.02, H / 2, W / 4);
  for (const d of [doorL, doorR]) part(warn, 0.02, H - 0.9, 0.08, -0.05, 0, d.position.z > 0 ? -0.18 : 0.18, d);
  // 的のマーク（扉の上）
  const tex = (() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(0,0,0,0)';
    g.clearRect(0, 0, 128, 128);
    for (const [r, col] of [[60, '#ff5a4a'], [42, '#ffffff'], [24, '#ff5a4a'], [8, '#ffffff']] as const) {
      g.fillStyle = col; g.beginPath(); g.arc(64, 64, r, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  let targetMat: THREE.MeshBasicMaterial | null = null;
  if (tex) {
    targetMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), targetMat);
    m.rotation.y = -Math.PI / 2;
    m.position.set(-W / 2 - 0.04, H + 0.45, 0);
    root.add(m);
    mats.push(targetMat);
  }
  root.position.set(x, -H - 0.05, z);
  root.visible = false;

  const base = -H - 0.05;
  return {
    root,
    setRise(k) { root.position.y = base + (H + 0.05) * k; root.visible = k > 0.01; },
    setOpen(k) {
      doorL.position.z = -W / 4 - (W / 4 - 0.04) * k;
      doorR.position.z = W / 4 + (W / 4 - 0.04) * k;
    },
    dispose() { root.removeFromParent(); for (const m of mats) m.dispose(); tex?.dispose(); },
  };
}

export interface Hatch {
  root: THREE.Group;
  /** 0=閉、1=開 */
  open(k: number): void;
  dispose(): void;
}

/** 天井の降下口（ウォーカーが入ってくる）。天井 y=h の少し下に、2枚の板が左右へ開く */
export function buildHatch(x: number, z: number, h: number): Hatch {
  const root = new THREE.Group();
  root.name = 'intro-hatch';
  const dark = new THREE.MeshBasicMaterial({ color: 0x05070d });
  const plate = new THREE.MeshStandardMaterial({ color: 0x3a4466, roughness: 0.5, metalness: 0.6 });
  const rim = glowMat(0xff7a3a);
  const hole = new THREE.Mesh(BOX, dark);
  hole.scale.set(1.8, 0.04, 1.8);
  hole.position.set(0, 0, 0);
  root.add(hole);
  const flaps: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(BOX, plate);
    f.scale.set(0.9, 0.08, 1.84);
    f.position.set(s * 0.45, -0.04, 0);
    root.add(f);
    flaps.push(f);
  }
  const r = new THREE.Mesh(BOX, rim);
  r.scale.set(1.96, 0.02, 1.96);
  r.position.y = -0.1;
  root.add(r);
  root.position.set(x, h - 0.03, z);
  return {
    root,
    open(k) {
      flaps[0].position.x = -0.45 - 0.85 * k;
      flaps[1].position.x = 0.45 + 0.85 * k;
      r.visible = k < 0.99;
    },
    dispose() { root.removeFromParent(); dark.dispose(); plate.dispose(); rim.dispose(); },
  };
}
