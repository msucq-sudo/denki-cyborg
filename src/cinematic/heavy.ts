// 演出用のヘビー。敵として World に登録せず、見た目（buildModel('heavy')）だけを scene に置いて歩かせる。
// （敵の AI・当たり判定・部屋のクリア判定に影響しない）
import * as THREE from 'three';
import { buildModel, disposeObject } from '../enemies/models';
import type { Model } from '../enemies/models';

export type HeavyMode = 'walk' | 'idle' | 'brace' | 'skid';

export class HeavyActor {
  readonly model: Model;
  readonly root: THREE.Group;
  /** 地面の位置と向き（yaw: 0=+Z 向き、π/2=+X 向き。モデルの正面は +Z） */
  readonly pos = new THREE.Vector3();
  yaw = 0;
  /** 体を前後に傾ける（rad。マイナスで後ろへのけぞる） */
  lean = 0;
  mode: HeavyMode = 'idle';
  private groundY: number;
  private phase = Math.random() * 6;
  private braceK = 0;
  private legs: THREE.Mesh[][];
  private legBase: THREE.Vector3[][];
  private arms: THREE.Group[];
  private disposed = false;

  constructor(private scene: THREE.Scene, x: number, z: number, yaw: number) {
    this.model = buildModel('heavy');
    this.root = this.model.root;
    this.root.userData.__heavy = true; // テスト・確認用の目印
    // 予告の円は出さない
    this.model.parts.teleCircle.visible = false;
    this.model.parts.teleStrip.visible = false;
    const box = new THREE.Box3().setFromObject(this.root);
    this.groundY = -box.min.y;
    this.legs = this.model.parts.legs ?? [];
    this.legBase = this.legs.map((side) => side.map((m) => m.position.clone()));
    this.arms = this.model.parts.arms ?? [];
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.apply();
    scene.add(this.root);
  }

  /** 目的地へ歩く。着いたら true。向きは進行方向へなめらかに回す */
  walkTo(tx: number, tz: number, speed: number, dt: number): boolean {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const step = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    this.turnTo(Math.atan2(dx, dz), dt, 8);
    this.mode = 'walk';
    this.phase += step * 2.9; // 歩幅（歩いた距離に合わせて足を出す）
    return step >= d - 1e-6;
  }

  turnTo(yaw: number, dt: number, rate = 6): void {
    let d = yaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, rate * dt);
  }

  /** 毎フレーム：姿勢（歩き・構え・踏ん張り）を反映 */
  update(dt: number): void {
    if (this.disposed) return;
    const vis = this.model.vis;
    const bracing = this.mode === 'brace' || this.mode === 'skid';
    this.braceK += ((bracing ? 1 : 0) - this.braceK) * Math.min(1, dt * 7);
    const walk = this.mode === 'walk' ? 1 : 0;
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    // 体：ゆさゆさ（上下・左右の傾き・首ふり）
    vis.position.y = Math.abs(s) * 0.13 * walk;
    vis.rotation.z = s * 0.07 * walk;
    vis.rotation.y = s * 0.06 * walk;
    vis.rotation.x = this.lean + this.braceK * 0.12 + (this.mode === 'skid' ? -0.1 : 0);
    // 足：交互に前へ出して持ち上げる（テクテク）
    for (let i = 0; i < this.legs.length; i++) {
      const side = i === 0 ? 1 : -1;
      const ph = side * s, lift = Math.max(0, side * c);
      for (let j = 0; j < this.legs[i].length; j++) {
        const m = this.legs[i][j], b = this.legBase[i][j];
        m.position.z = b.z + ph * 0.5 * walk;
        m.position.y = b.y + lift * 0.28 * walk;
      }
    }
    // 腕：歩きでは振り、構えでは前へ突き出す（受け止める姿勢）
    for (let i = 0; i < this.arms.length; i++) {
      const swing = Math.sin(this.phase + (i ? Math.PI : 0)) * 0.45 * walk;
      this.arms[i].rotation.x = swing * (1 - this.braceK) + -1.45 * this.braceK;
      this.arms[i].rotation.z = (i ? -1 : 1) * 0.0 + (i ? 1 : -1) * 0.12 * this.braceK;
    }
    this.apply();
  }

  private apply(): void {
    this.root.position.set(this.pos.x, this.pos.y + this.groundY, this.pos.z);
    this.root.rotation.y = this.yaw;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.root);
    disposeObject(this.root);
  }
}
