// 壊せる壁の「最初から割れている」見た目。普通の壁パネルと見分けがつくように、
// 面いっぱいの黒いひび割れ線＋ひびの奥のうっすらした橙色の光＋欠けた縁を、ブロックの子として付ける。
// ブロック（mesh）の子にするので、壊れて mesh.visible=false になれば一緒に消える（保存・復元もそのまま動く）。
import * as THREE from 'three';
import { rng } from './surge/batch';

export type PreCrackFace = '+z' | '-z' | '+x' | '-x';

const crackMat = new THREE.MeshBasicMaterial({ color: 0x0c0806 });
const glowMat = new THREE.MeshBasicMaterial({ color: 0xff8a30, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
const chipMat = new THREE.MeshStandardMaterial({ color: 0x2c2822, roughness: 1 });

/** 壁の材質を「傷んだ壁」の色にする（暗めの暖色寄り＋ごく弱い橙の自己発光） */
export function tintDamaged(mat: THREE.MeshStandardMaterial): void {
  mat.color.setHex(0x6c6258);
  mat.emissive.setHex(0x3a1606);
  mat.emissiveIntensity = 0.35;
}

/**
 * mesh（BoxGeometry のブロック）の face 側の面に、最初から見えているひび割れを付ける。
 * size はブロックの寸法（x, y, z）。座標は mesh のローカル。
 */
export function addPreCracks(mesh: THREE.Mesh, size: THREE.Vector3, face: PreCrackFace, seed: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'preCrack';
  const rand = rng(seed);
  const nz = face === '+z' || face === '-z';
  const sgn = face[0] === '+' ? 1 : -1;
  const W = nz ? size.x : size.z; // 面の横幅（u）
  const H = size.y; // 面の縦（v）
  const off = (nz ? size.z : size.x) / 2 + 0.025; // 面からわずかに浮かせる

  const seg = (m: THREE.Material, u1: number, v1: number, u2: number, v2: number, thick: number, o: number) => {
    const L = Math.hypot(u2 - u1, v2 - v1) + thick * 0.6;
    const geo = nz ? new THREE.BoxGeometry(L, thick, 0.03) : new THREE.BoxGeometry(0.03, thick, L);
    const s = new THREE.Mesh(geo, m);
    const uc = (u1 + u2) / 2, vc = (v1 + v2) / 2;
    const ang = Math.atan2(v2 - v1, u2 - u1);
    if (nz) { s.position.set(uc, vc, sgn * (off + o)); s.rotation.z = ang; }
    else { s.position.set(sgn * (off + o), vc, uc); s.rotation.x = -ang; }
    g.add(s);
  };

  // ギザギザの長いひびを、面のあちこちから数本。端まで届く本線＋枝
  const hw = W / 2 - 0.08, hh = H / 2 - 0.08;
  const clampU = (u: number) => Math.max(-hw, Math.min(hw, u));
  const clampV = (v: number) => Math.max(-hh, Math.min(hh, v));
  const main = Math.max(4, Math.round(W * 1.6));
  for (let i = 0; i < main; i++) {
    let u = (rand() - 0.5) * W * 0.9;
    let v = rand() < 0.5 ? hh : -hh;
    let a = v > 0 ? -Math.PI / 2 : Math.PI / 2; // 縁から内側へ
    const steps = 4 + Math.floor(rand() * 4);
    for (let k = 0; k < steps; k++) {
      a += (rand() - 0.5) * 1.2;
      const len = 0.35 + rand() * 0.55;
      const u2 = clampU(u + Math.cos(a) * len), v2 = clampV(v + Math.sin(a) * len);
      const thick = 0.07 - k * 0.006;
      seg(glowMat, u, v, u2, v2, thick + 0.1, 0.004);
      seg(crackMat, u, v, u2, v2, Math.max(0.03, thick), 0.012);
      if (rand() < 0.4) { // 枝
        const ab = a + (rand() < 0.5 ? 1 : -1) * (0.6 + rand() * 0.5);
        const lb = 0.25 + rand() * 0.4;
        const ub = clampU(u2 + Math.cos(ab) * lb), vb = clampV(v2 + Math.sin(ab) * lb);
        seg(glowMat, u2, v2, ub, vb, 0.1, 0.004);
        seg(crackMat, u2, v2, ub, vb, 0.035, 0.012);
      }
      u = u2; v = v2;
    }
  }

  // 欠けた縁：四隅と上端に、削れたような暗い小片
  const chip = (u: number, v: number, w: number, h: number) => {
    const s = new THREE.Mesh(nz ? new THREE.BoxGeometry(w, h, 0.07) : new THREE.BoxGeometry(0.07, h, w), chipMat);
    if (nz) s.position.set(u, v, sgn * (off + 0.005)); else s.position.set(sgn * (off + 0.005), v, u);
    s.rotation.y = (rand() - 0.5) * 0.4;
    g.add(s);
  };
  for (const cu of [-1, 1]) for (const cv of [-1, 1]) chip(cu * (W / 2 - 0.12), cv * (H / 2 - 0.12), 0.22 + rand() * 0.2, 0.18 + rand() * 0.2);
  for (let i = 0; i < 3; i++) chip((rand() - 0.5) * W * 0.8, H / 2 - 0.08, 0.15 + rand() * 0.25, 0.12 + rand() * 0.12);
  for (let i = 0; i < 2; i++) chip((rand() - 0.5) * W * 0.8, -H / 2 + 0.08, 0.15 + rand() * 0.25, 0.12 + rand() * 0.12);

  mesh.add(g);
  return g;
}
