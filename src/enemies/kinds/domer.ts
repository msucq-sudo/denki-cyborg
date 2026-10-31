// ドーマー：ドームシールドを展開して、その中から撃ってくる。
// ドームは外から来る弾・吸収アーム・バキュームを止めるが、中から外への敵の弾は通す。
// 倒すには (1) ドームを撃って壊す、または (2) ドームの中に入って直接たたく。壊すと持ち主はしばらくひるみ、時間がたつと張り直す。
// ドームの判定は enemies/barrier.ts、回復は medic.ts が barrier.hp を直接戻す。
import * as THREE from 'three';
import { Builder, COLORS, boxGeo, sphereGeo, taperGeo, torusGeo } from '../models';
import { faceToward, moveGround } from '../common';
import type { Ctx } from '../common';
import { fireAt } from '../ai';
import { spawnBurst, spawnShockwave } from '../../core/effects';
import { BARRIER_COLOR, barrierCenter, breakBarrier } from '../barrier';
import type { Enemy, World } from '../../core/types';
import type { KindModule } from './kind';

/** ドーマーの調整値。弾のダメージ・速さ・間隔は ENEMIES.domer */
export const DOMER = {
  /** ドームの半径（m）と耐久（プレイヤーの弾のダメージ合計） */
  radius: 4.6,
  domeHp: 70,
  /** 展開の予備動作（柱が光る・床に輪が出る）→ ドームが広がる時間（秒） */
  windup: 0.8,
  grow: 0.5,
  /** ドームが割れてから張り直し始めるまで（秒） */
  redeployCd: 9,
  /** ドームが無いとき保つ距離（m） */
  keepMin: 9,
  keepMax: 15,
  /** 1回の射撃の弾数・弾の間隔（秒）・狙ってから撃つまで（秒） */
  burst: 3,
  burstGap: 0.2,
  aimTime: 0.45,
  /** プレイヤーがドームの中に入ってきたときの間隔の倍率（焦って撃つ） */
  insideIntervalMul: 0.7,
  /** 砲口（体の中心から） */
  muzzleY: 0.3,
  muzzleZ: 0.62,
} as const;

const _from = new THREE.Vector3();
const _lead = new THREE.Vector3();
const _bc = new THREE.Vector3();

// ------------------------------------------------------------------ ドームの見た目
let domeGeos: { hemi: THREE.SphereGeometry; wire: THREE.WireframeGeometry; ring: THREE.RingGeometry } | null = null;
function getDomeGeos() {
  if (!domeGeos) {
    const hemi = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const ring = new THREE.RingGeometry(0.955, 1, 64); ring.rotateX(-Math.PI / 2);
    domeGeos = { hemi, wire: new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), ring };
  }
  return domeGeos;
}

interface DomeVis { group: THREE.Group; fill: THREE.MeshBasicMaterial; wire: THREE.LineBasicMaterial; ring: THREE.MeshBasicMaterial }

function ensureDomeVis(world: World, e: Enemy): DomeVis {
  let v = e.ai.domeVis as DomeVis | undefined;
  if (v) return v;
  const g = getDomeGeos();
  const group = new THREE.Group();
  const fill = new THREE.MeshBasicMaterial({ color: BARRIER_COLOR, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const wire = new THREE.LineBasicMaterial({ color: 0xcff6ff, transparent: true, opacity: 0.35, depthWrite: false });
  const ring = new THREE.MeshBasicMaterial({ color: BARRIER_COLOR, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const shell = new THREE.Mesh(g.hemi, fill);
  shell.renderOrder = 3;
  const lines = new THREE.LineSegments(g.wire, wire);
  lines.renderOrder = 3;
  const base = new THREE.Mesh(g.ring, ring);
  base.position.y = 0.04;
  base.renderOrder = 3;
  for (const o of [shell, lines, base]) o.castShadow = false;
  group.add(shell, lines, base);
  group.visible = false;
  world.scene.add(group);
  (e.ai.extra ??= [] as THREE.Object3D[]).push(group);
  v = { group, fill, wire, ring };
  e.ai.domeVis = v;
  return v;
}

/** ドームの毎フレームの見た目（展開の広がり・被弾の光・予告の輪） */
function updateDomeVis(world: World, e: Enemy, dt: number): void {
  const b = e.barrier;
  const v = ensureDomeVis(world, e);
  const alive = e.status === 'active' || e.status === 'stunned';
  const warn: number = e.ai.domeWarn ?? 0;   // 展開の予告（0..1）
  const up = !!b && alive && b.hp > 0 && b.k > 0;
  v.group.visible = up || (alive && warn > 0);
  if (!v.group.visible) return;
  const R = b?.radius ?? DOMER.radius;
  barrierCenter(e, _bc);
  v.group.position.copy(_bc);
  if (b) b.flash = Math.max(0, b.flash - dt * 4);
  const flash = b?.flash ?? 0;
  const t: number = e.ai.t ?? 0;
  if (up && b) {
    const k = b.k;
    const s = R * (1 - (1 - k) * (1 - k));
    v.group.scale.set(s, s, s);
    const low = 1 - b.hp / b.maxHp;   // 壊れそうなほど不安定に明滅する
    const flick = low > 0.6 ? 0.5 + 0.5 * Math.sin(t * 30) : 1;
    v.fill.opacity = (0.09 + 0.05 * Math.sin(t * 2.2) + 0.4 * flash) * flick * (k < 1 ? 1.8 : 1);
    v.wire.opacity = (0.3 + 0.6 * flash) * flick + (k < 1 ? 0.3 : 0);
    v.ring.opacity = 0.7 * flick + 0.3 * flash;
    v.fill.color.setHex(low > 0.6 ? 0xffb070 : BARRIER_COLOR);
  } else {
    // 予告：床に輪だけが点滅しながら出る
    v.group.scale.set(R, R, R);
    const pulse = 0.5 + 0.5 * Math.sin(t * 30);
    v.fill.opacity = 0;
    v.wire.opacity = 0.12 * warn * pulse;
    v.ring.opacity = (0.35 + 0.5 * pulse) * warn;
  }
}

// ------------------------------------------------------------------ AI
function ensureBarrier(e: Enemy): NonNullable<Enemy['barrier']> {
  return (e.barrier ??= { radius: DOMER.radius, hp: 0, maxHp: DOMER.domeHp, k: 0, flash: 0 });
}

function muzzle(e: Enemy, out: THREE.Vector3): THREE.Vector3 {
  const yaw: number = e.ai.yaw ?? 0;
  return out.set(e.pos.x + Math.sin(yaw) * DOMER.muzzleZ, e.pos.y + DOMER.muzzleY, e.pos.z + Math.cos(yaw) * DOMER.muzzleZ);
}

function update(c: Ctx): void {
  const { world, e, dt, spec, dirXZ, dist2d, los } = c;
  const ai = e.ai;
  const b = ensureBarrier(e);
  ai.domeCd = Math.max(0, (ai.domeCd ?? 0) - dt);
  ai.atkTimer = (ai.atkTimer ?? 0.8 + Math.random() * 0.8) - dt;

  // ドームを割られた：ひるむ。そのあと張り直しまで待つ
  if (ai.domeBroken) {
    ai.domeBroken = false;
    ai.deploy = 0; ai.domeWarn = 0; ai.windup = 0; ai.shots = 0;
    ai.domeCd = DOMER.redeployCd;
    e.status = 'stunned';
    ai.stunT = ai.domeStun ?? 1.6;
  }
  if (e.status === 'stunned') {
    ai.stunT = (ai.stunT ?? 0) - dt;
    moveGround(world, e, dt, 0, 0, 20);
    ai.walk = 0;
    if (ai.stunT <= 0) e.status = 'active';
    return;
  }
  if (ai.alert <= 0) {
    moveGround(world, e, dt, 0, 0, 10);
    ai.walk = 0; ai.domeWarn = 0; ai.deploy = 0;
    return;
  }

  faceToward(e, dirXZ.x, dirXZ.z, dt, 4);
  const up = b.hp > 0 && b.k > 0;

  // ---- ドーム：展開の予備動作 → 広がる
  if (!up && !(ai.deploy > 0) && ai.domeCd <= 0 && los) {
    ai.deploy = DOMER.windup;
    world.events.emit('enemyAction', { kind: e.kind, pos: e.pos.clone(), action: 'domeDeploy', value: 0 });
  }
  if (ai.deploy > 0) {
    ai.deploy -= dt;
    ai.domeWarn = 1 - Math.max(0, ai.deploy) / DOMER.windup;
    ai.warn = ai.domeWarn * 0.6;
    ai.windup = 0; ai.shots = 0;
    if (ai.deploy <= 0) {
      ai.domeWarn = 0; ai.warn = 0;
      b.hp = b.maxHp; b.k = 0.001; b.flash = 0.6;
      barrierCenter(e, _bc);
      spawnShockwave(world, _bc, BARRIER_COLOR, DOMER.radius, 0.5);
      spawnBurst(world, _bc, BARRIER_COLOR, 24, 5, 0.6);
      world.events.emit('enemyAction', { kind: e.kind, pos: e.pos.clone(), action: 'domeDeploy', value: 1 });
    }
  } else if (b.hp > 0 && b.k > 0 && b.k < 1) {
    b.k = Math.min(1, b.k + dt / DOMER.grow);
  }

  // ---- 移動：ドームがあるうちは据え置き。無いときは距離を保ってゆっくり動く
  const planted = ai.deploy > 0 || (b.hp > 0 && b.k > 0);
  let wx = 0, wz = 0;
  if (!planted) {
    ai.strafeT = (ai.strafeT ?? 0) - dt;
    if (ai.strafeT <= 0 || ai.strafeDir === undefined) { ai.strafeDir = Math.random() < 0.5 ? 1 : -1; ai.strafeT = 1.5 + Math.random() * 2; }
    const radial = !los ? 1 : dist2d < DOMER.keepMin ? -1 : dist2d > DOMER.keepMax ? 1 : 0;
    const tangent = radial === 0 ? 0.8 : 0.3;
    wx = (dirXZ.x * radial - dirXZ.z * ai.strafeDir * tangent) * spec.speed;
    wz = (dirXZ.z * radial + dirXZ.x * ai.strafeDir * tangent) * spec.speed;
  }
  moveGround(world, e, dt, wx, wz, 8);
  ai.walk = Math.hypot(e.vel.x, e.vel.z);

  // ---- 射撃：狙う（予告）→ 連射。ドームごしでも撃てる
  if (ai.deploy > 0) return;
  if ((ai.shots ?? 0) > 0) {
    ai.shotT -= dt;
    if (ai.shotT <= 0) {
      muzzle(e, _from);
      _lead.copy(c.pc).addScaledVector(world.player.vel, Math.min(0.2, c.dist / spec.projectileSpeed * 0.25));
      fireAt(world, _from, _lead, spec.projectileSpeed, spec.damage, 0.025, 0.2, 0xff7a3d);
      world.events.emit('enemyAttack', { kind: 'gunner', pos: e.pos.clone() });
      ai.recoil = 1;
      ai.shots--;
      ai.shotT = DOMER.burstGap;
      if (ai.shots <= 0) {
        const inside = c.pc.distanceTo(barrierCenter(e, _bc)) < b.radius && b.hp > 0;
        ai.atkTimer = spec.attackInterval * (inside ? DOMER.insideIntervalMul : 1) * (0.85 + Math.random() * 0.3);
      }
    }
  } else if ((ai.windup ?? 0) > 0) {
    ai.windup -= dt;
    ai.warn = 1 - Math.max(0, ai.windup) / DOMER.aimTime;
    if (ai.windup <= 0) { ai.warn = 0; ai.shots = DOMER.burst; ai.shotT = 0; }
  } else {
    ai.warn = 0;
    if (ai.atkTimer <= 0 && los) ai.windup = DOMER.aimTime;
  }
}

function animate(_world: World, e: Enemy, dt: number, down: boolean): void {
  const ai = e.ai;
  const p = ai.model.parts;
  const vis = ai.model.vis as THREE.Group;
  const lerp = THREE.MathUtils.lerp;
  ai.recoil = Math.max(0, (ai.recoil ?? 0) - dt * 5);
  const dome = !down && !!e.barrier && e.barrier.hp > 0 && e.barrier.k > 0;
  const warn: number = ai.domeWarn ?? 0;
  updateDomeVis(_world, e, dt);

  const emitter = p.emitter as THREE.Group;
  const head = p.head as THREE.Group;
  const pylons = p.pylonMats as THREE.MeshStandardMaterial[];
  const feet = p.feet as THREE.Group[];
  if (!down) {
    // 柱の光：展開の予告で強く、ドームが立っている間は安定して光る
    const glow = warn > 0 ? 1.5 + 3 * warn * (0.6 + 0.4 * Math.sin((ai.t ?? 0) * 40)) : dome ? 2.0 : 0.5;
    for (const m of pylons) m.emissiveIntensity = lerp(m.emissiveIntensity, glow, Math.min(1, dt * 12));
    emitter.rotation.y += dt * (dome ? 3 : 0.8 + warn * 12);
    emitter.position.y = 0.58 + (warn > 0 ? Math.sin((ai.t ?? 0) * 30) * 0.02 : 0) + 0.04 * warn;
    // 展開中は脚をふんばって低く構える
    const stance = warn > 0 || dome ? 1 : 0;
    ai.stance = lerp(ai.stance ?? 0, stance, Math.min(1, dt * 8));
    vis.position.y -= 0.07 * ai.stance;
    feet.forEach((f, i) => { f.position.x = Math.sign(f.userData.sx) * (0.42 + 0.14 * ai.stance); f.position.z = Math.sign(f.userData.sz) * (0.42 + 0.14 * ai.stance); void i; });
    // 頭：撃つ前にこちらを向いてのけぞり、撃つと反動
    const w: number = ai.warn ?? 0;
    head.rotation.x = lerp(head.rotation.x, -0.12 * (ai.windup > 0 ? w : 0) - 0.18 * ai.recoil, Math.min(1, dt * 14));
    // 歩き
    const walk = Math.min(1, (ai.walk ?? 0) / 2);
    ai.wph = (ai.wph ?? 0) + (ai.walk ?? 0) * dt * 4;
    vis.position.y += Math.abs(Math.sin(ai.wph)) * 0.03 * walk;
    vis.rotation.z = lerp(vis.rotation.z, Math.sin(ai.wph) * 0.06 * walk, Math.min(1, dt * 8));
  } else {
    for (const m of pylons) m.emissiveIntensity = 0.05;
    vis.rotation.x = -1.1 * ai.collapse;
    vis.rotation.z = (ai.tilt ?? 1) * 0.4 * ai.collapse;
    vis.position.y = -0.2 * ai.collapse;
  }
}

function onGone(world: World, e: Enemy): void {
  // 持ち主が倒れるとドームも消える
  const b = e.barrier;
  if (b && b.hp > 0 && b.k > 0) breakBarrier(world, e);
  e.ai.domeBroken = false;
  if (e.barrier) { e.barrier.hp = 0; e.barrier.k = 0; }
  const v = e.ai.domeVis as DomeVis | undefined;
  if (v) v.group.visible = false;
}

export const domer: KindModule = {
  knockback: 0.25,

  build() {
    const b = new Builder();
    const white = b.body(COLORS.white, 0.5, true), silver = b.body(COLORS.silver, 0.5, true), blue = b.body(COLORS.blue, 0.5, true);
    const navy = b.body(COLORS.navy, 0.7, true), deep = b.body(COLORS.deepBlue, 0.6, true);
    // 土台：六角の台座 + 青い縁 + どっしりした胴
    b.prism(0.7, 0.26, 6, silver, b.vis, 0, -0.56, 0);
    b.prism(0.73, 0.05, 6, blue, b.vis, 0, -0.4, 0);
    b.block(0.95, 0.5, 0.95, white, b.vis, 0, -0.12, 0, 0.1);
    b.block(0.7, 0.22, 0.1, navy, b.vis, 0, -0.1, 0.5, 0.03);
    b.lamp(0.5, 0.035, 0.03, b.vis, 0, -0.1, 0.56);
    for (const sx of [-1, 1]) b.block(0.1, 0.34, 0.7, deep, b.vis, sx * 0.5, -0.12, 0, 0.03);
    // ふんばる足（展開中は広がる）
    const feet: THREE.Group[] = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const f = new THREE.Group();
      f.position.set(sx * 0.42, -0.66, sz * 0.42);
      f.userData.sx = sx; f.userData.sz = sz;
      b.vis.add(f);
      b.block(0.26, 0.12, 0.26, navy, f, 0, 0, 0, 0.03);
      b.mesh(taperGeo(0.05, 0.09, 0.2, 4), silver, f, 0, 0.12, 0);
      feet.push(f);
    }
    b.parts.feet = feet;
    // ドームを張る4本の柱：先端のクリスタルが光る
    const pylonMats: THREE.MeshStandardMaterial[] = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const px = Math.cos(a) * 0.6, pz = Math.sin(a) * 0.6;
      const pylon = new THREE.Group();
      pylon.position.set(px, -0.08, pz);
      pylon.rotation.set(Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22);
      b.vis.add(pylon);
      b.prism(0.045, 0.62, 6, navy, pylon, 0, 0.2, 0);
      b.prism(0.065, 0.06, 6, silver, pylon, 0, 0.06, 0);
      const mat = new THREE.MeshStandardMaterial({ color: 0xcff6ff, emissive: BARRIER_COLOR, emissiveIntensity: 0.5, roughness: 0.3 });
      pylonMats.push(mat);
      const tip = b.mesh(boxGeo(0.1, 0.16, 0.1), mat, pylon, 0, 0.56, 0);
      tip.rotation.y = Math.PI / 4;
      tip.castShadow = false;
    }
    b.parts.pylonMats = pylonMats;
    // 頭の砲塔：前に砲身、目のスリット
    const head = new THREE.Group();
    head.position.set(0, 0.26, 0.04);
    b.vis.add(head);
    b.block(0.62, 0.3, 0.56, silver, head, 0, 0, 0, 0.07);
    b.block(0.5, 0.14, 0.1, navy, head, 0, 0.02, 0.28, 0.03);
    b.mesh(boxGeo(0.4, 0.045, 0.03), b.eye(), head, 0, 0.02, 0.34);
    for (const sx of [-1, 1]) {
      b.prism(0.055, 0.46, 6, navy, head, sx * 0.2, -0.02, 0.4).rotation.x = Math.PI / 2;
      b.prism(0.075, 0.07, 6, blue, head, sx * 0.2, -0.02, 0.62).rotation.x = Math.PI / 2;
    }
    b.parts.head = head;
    // 頭上のエミッター：回る輪
    const emitter = new THREE.Group();
    emitter.position.set(0, 0.58, 0);
    b.vis.add(emitter);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xcff6ff, emissive: BARRIER_COLOR, emissiveIntensity: 1.6, roughness: 0.3 });
    pylonMats.push(ringMat);
    const ring = b.mesh(torusGeo(0.2, 0.03), ringMat, emitter);
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = false;
    b.mesh(sphereGeo(0.07), ringMat, emitter).castShadow = false;
    b.parts.emitter = emitter;
    b.prism(0.06, 0.1, 6, navy, b.vis, 0, 0.46, 0);
    // 背中の電池（弱点）
    b.block(0.4, 0.34, 0.14, navy, b.vis, 0, -0.06, -0.52, 0.04);
    for (const sx of [-1, 1]) b.mesh(boxGeo(0.04, 0.3, 0.03), blue, b.vis, sx * 0.14, -0.06, -0.6);
    b.weak(0, -0.06, -0.62, 0.24, [1.2, 1.1, 0.6], 0.14);
    return b.done();
  },

  update,
  animate,
  onGone,
  onRemove(_world, e) { e.barrier = undefined; },
};

