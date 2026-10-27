import * as THREE from 'three';

export type ArmMode = 'hidden' | 'extending' | 'attached' | 'retracting' | 'overload';

export interface ArmVisual {
  group: THREE.Group;
  update(root: THREE.Vector3, tip: THREE.Vector3, mode: ArmMode, time: number): void;
}

const MAX_NODES = 56;
const NODE_SPACING = 0.32;
const PARTICLES = 22;
const BOLT_POINTS = 28;

const CYAN = new THREE.Color(0x5fe8ff);
const WHITE = new THREE.Color(0xffffff);
const ORANGE = new THREE.Color(0xff8a3c);
const YELLOW = new THREE.Color(0xffe27a);

/** 吸収アームの見た目：節のあるチューブ＋先端のプラグ＋稲妻＋流れる光の粒 */
export function createArmVisual(): ArmVisual {
  const group = new THREE.Group();
  group.name = 'absorbArm';
  group.visible = false;

  // 節（InstancedMesh）
  const nodeMat = new THREE.MeshStandardMaterial({
    color: 0xe9fbff, emissive: CYAN, emissiveIntensity: 0.9, roughness: 0.45, metalness: 0.1,
  });
  const nodes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), nodeMat, MAX_NODES);
  nodes.frustumCulled = false;
  nodes.count = 0;
  nodes.visible = false; // 節のチューブは本体のバネ腕に置き換え（電流・光の粒・稲妻だけ残す）
  group.add(nodes);

  // 稲妻ライン
  const makeBolt = (color: number, opacity: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_POINTS * 3), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    l.frustumCulled = false;
    group.add(l);
    return l;
  };
  const boltA = makeBolt(0xaef6ff, 0.9);
  const boltB = makeBolt(0x5fe8ff, 0.6);

  // 先端のプラグ（球＋爪3本）
  const plug = new THREE.Group();
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: CYAN, emissiveIntensity: 1.2, roughness: 0.35 }),
  );
  head.visible = false;
  plug.add(head);
  const clawGeo = new THREE.ConeGeometry(0.06, 0.32, 6);
  clawGeo.rotateX(Math.PI / 2); // 先が +Z を向く
  clawGeo.translate(0, 0, 0.2);
  const clawMat = new THREE.MeshStandardMaterial({ color: 0xdff9ff, emissive: CYAN, emissiveIntensity: 0.7, roughness: 0.4 });
  const claws: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.z = (i / 3) * Math.PI * 2;
    const c = new THREE.Mesh(clawGeo, clawMat);
    c.position.x = 0.1;
    c.visible = false;
    pivot.add(c);
    plug.add(pivot);
    claws.push(c);
  }
  group.add(plug);

  // 光の粒
  const partMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
  const parts = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 6, 5), partMat, PARTICLES);
  parts.frustumCulled = false;
  parts.setColorAt(0, WHITE);
  parts.count = 0;
  group.add(parts);

  // 先端のやわらかい光（強度のみ変更。light 数は変えない）
  const tipLight = new THREE.PointLight(0x5fe8ff, 0, 6, 2);
  plug.add(tipLight);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const side1 = new THREE.Vector3();
  const side2 = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const col = new THREE.Color();
  const IDENT = new THREE.Quaternion();

  const fillBolt = (line: THREE.Line, a: THREE.Vector3, b: THREE.Vector3, amp: number, time: number, seed: number) => {
    const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < BOLT_POINTS; i++) {
      const k = i / (BOLT_POINTS - 1);
      const env = Math.sin(k * Math.PI); // 両端は固定
      const n1 = Math.sin(time * 38 + i * 12.9898 + seed) * 43758.5453;
      const n2 = Math.sin(time * 41 + i * 78.233 + seed * 2) * 24634.6345;
      const j1 = (n1 - Math.floor(n1)) * 2 - 1;
      const j2 = (n2 - Math.floor(n2)) * 2 - 1;
      attr.setXYZ(i,
        a.x + (b.x - a.x) * k + (side1.x * j1 + side2.x * j2) * amp * env,
        a.y + (b.y - a.y) * k + (side1.y * j1 + side2.y * j2) * amp * env,
        a.z + (b.z - a.z) * k + (side1.z * j1 + side2.z * j2) * amp * env);
    }
    attr.needsUpdate = true;
  };

  function update(root: THREE.Vector3, tip: THREE.Vector3, mode: ArmMode, time: number): void {
    if (mode === 'hidden') { group.visible = false; return; }
    group.visible = true;
    dir.subVectors(tip, root);
    const len = dir.length();
    if (len > 1e-5) dir.multiplyScalar(1 / len); else dir.set(0, 0, -1);
    side1.crossVectors(dir, up);
    if (side1.lengthSq() < 1e-4) side1.set(1, 0, 0);
    side1.normalize();
    side2.crossVectors(dir, side1).normalize();

    const overload = mode === 'overload';
    const attached = mode === 'attached' || overload;
    const tint = overload ? ORANGE : CYAN;

    // 節
    const n = Math.min(MAX_NODES, Math.max(2, Math.ceil(len / NODE_SPACING)));
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const wob = mode === 'extending' ? 0.08 * Math.sin(time * 20 + i * 0.9) * Math.sin(k * Math.PI) : 0;
      pos.copy(root).addScaledVector(dir, len * k).addScaledVector(side1, wob).addScaledVector(up, wob * 0.5);
      const pulse = 1 + 0.18 * Math.sin(time * 9 - i * 0.7) * (attached ? 1 : 0.4);
      const s = (i % 2 === 0 ? 1.15 : 0.8) * pulse * (overload ? 1.15 : 1);
      sc.set(s, s, s * 1.5);
      q.setFromUnitVectors(Z, dir);
      m4.compose(pos, q, sc);
      nodes.setMatrixAt(i, m4);
    }
    nodes.count = n;
    nodes.instanceMatrix.needsUpdate = true;
    nodeMat.emissive.copy(tint);
    nodeMat.emissiveIntensity = overload ? 1.6 + 0.8 * Math.sin(time * 40) : 0.9;

    // 稲妻
    const amp = overload ? 0.22 : attached ? 0.1 : 0.05;
    fillBolt(boltA, root, tip, amp, time, 1);
    fillBolt(boltB, root, tip, amp * 1.6, time + 0.013, 7);
    (boltA.material as THREE.LineBasicMaterial).color.set(overload ? 0xffe1b0 : 0xaef6ff);
    (boltB.material as THREE.LineBasicMaterial).color.copy(tint);
    boltA.visible = boltB.visible = attached || mode === 'extending';

    // プラグ
    plug.position.copy(tip);
    plug.lookAt(tip.x + dir.x, tip.y + dir.y, tip.z + dir.z);
    const open = attached ? 0.04 : mode === 'extending' ? 0.16 : 0.1;
    for (const c of claws) c.position.x += (open - c.position.x) * 0.4;
    const hm = head.material as THREE.MeshStandardMaterial;
    hm.emissive.copy(tint);
    hm.emissiveIntensity = attached ? 1.6 + 0.6 * Math.sin(time * 18) : 1.0;
    tipLight.color.copy(tint);
    tipLight.intensity = attached ? (overload ? 3 + 2 * Math.sin(time * 45) : 1.6) : 0.6;

    // 光の粒：吸収は敵(先端)→プレイヤー(根元)、逆流は根元→先端
    if (attached) {
      const speed = overload ? 1.9 : 1.2;
      for (let i = 0; i < PARTICLES; i++) {
        const p = (time * speed + i / PARTICLES) % 1;
        const along = overload ? p : 1 - p; // 吸収: 先端→根元 / 逆流: 根元→先端
        const wobble = 0.1 * Math.sin(time * 14 + i * 2.1);
        pos.copy(root).addScaledVector(dir, len * along)
          .addScaledVector(side1, wobble).addScaledVector(side2, wobble * 0.7);
        const s = (overload ? 1.5 : 1.15) * (0.7 + 0.5 * Math.sin(i * 1.7 + time * 6));
        sc.set(s, s, s);
        m4.compose(pos, IDENT, sc);
        parts.setMatrixAt(i, m4);
        col.copy(overload ? (i % 2 ? YELLOW : ORANGE) : (i % 2 ? WHITE : CYAN));
        parts.setColorAt(i, col);
      }
      parts.count = PARTICLES;
      parts.instanceMatrix.needsUpdate = true;
      if (parts.instanceColor) parts.instanceColor.needsUpdate = true;
    } else {
      parts.count = 0;
    }
  }

  return { group, update };
}
