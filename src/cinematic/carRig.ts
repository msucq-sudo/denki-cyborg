// 演出中の車の置き方と、車に対するカメラ位置の計算。車は西向き（yaw=+π/2）で走る前提だが、yaw は自由。
import * as THREE from 'three';
import type { DriveState } from '../vehicle/types';
import { measureCar } from './stage';
import type { CarMetrics } from './stage';

/** 首の付け根（driverHead）から顔の中心までの高さ（m） */
const FACE_UP = 0.2;

export class CarRig {
  readonly m: CarMetrics;
  readonly root: THREE.Group;
  x: number;
  z: number;
  yaw: number;
  pitch = 0;
  roll = 0;
  /** 車の長さ方向の縮み（激突でつぶれる。1=そのまま） */
  squash = 1;
  private tmp = new THREE.Vector3();
  private saved: { pos: THREE.Vector3; rot: THREE.Euler; scale: THREE.Vector3; driverVisible: boolean };

  constructor(readonly drive: DriveState) {
    this.root = drive.car.root;
    this.m = measureCar(drive.car);
    this.x = drive.pos.x;
    this.z = drive.pos.z;
    this.yaw = drive.yaw;
    this.saved = {
      pos: this.root.position.clone(), rot: this.root.rotation.clone(), scale: this.root.scale.clone(),
      driverVisible: drive.car.driver.visible,
    };
    this.root.rotation.order = 'YXZ';
  }

  /** 位置と姿勢を反映（drive の pos/yaw/speed も合わせる） */
  place(speed?: number): void {
    const r = this.root;
    r.position.set(this.x, 0, this.z);
    r.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    r.scale.set(1, 1, this.squash);
    r.updateMatrixWorld(true);
    this.drive.pos.set(this.x, 0, this.z);
    this.drive.yaw = this.yaw;
    if (speed !== undefined) this.drive.speed = speed;
  }

  /** 進行方向（水平の単位ベクトル。yaw=0 なら -Z） */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** 右手方向（水平） */
  right(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** 車のローカル座標 → ワールド */
  toWorld(lx: number, ly: number, lz: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.root.localToWorld(out.set(lx, ly, lz));
  }

  /** 運転手の顔の中心の今のローカル座標（姿勢変更で動く）。driverHead は首の付け根なので、少し上げる */
  headLocal(out = new THREE.Vector3()): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    this.drive.car.driverHead.getWorldPosition(this.tmp);
    this.tmp.y += FACE_UP;
    return this.root.worldToLocal(out.copy(this.tmp));
  }

  headWorld(out = new THREE.Vector3()): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.drive.car.driverHead.getWorldPosition(out);
  }

  /** 運転手の表示（一人称のショットでは隠す） */
  setDriverVisible(v: boolean): void { this.drive.car.driver.visible = v; }

  /** 後始末：運転手を元の表示に、つぶれを戻す（位置はそのまま） */
  restore(): void {
    this.drive.car.driver.visible = this.saved.driverVisible;
    this.squash = 1;
    this.root.scale.copy(this.saved.scale);
  }
}
