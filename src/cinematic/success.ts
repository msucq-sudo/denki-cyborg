// 成功の演出：判定地点を 300km/h 以上で越えた → 柵を突き破り、収容所の壁に激突する。
// ①前方斜めから ②道ばたに据えたカメラを走り抜ける ③車内（背中側）④後ろの引き ⑤正面から顔 ⑥真横（スロー→壁に激突）
import * as THREE from 'three';
import type { World } from '../core/types';
import type { DriveState } from '../vehicle/types';
import { KMH } from '../vehicle/types';
import { COMPOUND } from '../level/surge/layout';
import { CarRig } from './carRig';
import type { Runtime, Script, Shot } from './sequencer';
import { dentObject, hideDriveProps, resolveStage, ROAD_Z } from './stage';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };

/** スローモーションの倍率 */
export const SLOW_SCALE = 0.13;

interface Flying {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rested: boolean;
}

/** ⑥の状態をテストから見られるように */
export interface SuccessProbe {
  fenceBroken: boolean;
  crashed: boolean;
  /** 車の先頭が柵の x からどれだけ手前か（正=柵の手前） */
  d: number;
  carX: number;
  carSpeed: number;
  dented: number;
  flying: number;
}

export function successScript(rt: Runtime, drive: DriveState, probe?: SuccessProbe): Script {
  const world: World = rt.world;
  const stage = resolveStage(world);
  const car = new CarRig(drive);
  const fenceX = COMPOUND.fenceX, wallX = COMPOUND.wallX;
  const zc = ROAD_Z;
  /** 車は道の中央を走る */
  const carZ = zc;
  const V = Math.min(110, Math.max(300 * KMH, drive.speed));
  const front = car.m.frontDist;
  const flying: Flying[] = [];
  const hiddenPanels: THREE.Object3D[] = [];
  // 演出で走る範囲にある障害物・雑魚は隠す（車が突き抜けて見えないように）
  const restoreProps = hideDriveProps(drive, -850);
  const st = { carX: drive.pos.x, speed: V, fenceBroken: false, crashed: false, crashReal: 0, rebound: 0, dented: 0, fadeStarted: false };
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
  const pLook = new THREE.Vector3();
  let passed = false;

  /** 車の先頭が柵の面から手前にどれだけか */
  const dFence = () => st.carX - front - fenceX;
  const dWall = () => st.carX - front - wallX;

  const finish = () => { if (probe) { probe.d = dFence(); probe.carX = st.carX; probe.carSpeed = st.speed; probe.fenceBroken = st.fenceBroken; probe.crashed = st.crashed; probe.dented = st.dented; probe.flying = flying.length; } };

  function breakFence(): void {
    st.fenceBroken = true;
    const hitPos = new THREE.Vector3(fenceX, 1.2, zc);
    world.events.emit('fenceBreak', { pos: hitPos.clone() });
    const lat = car.m.halfWid + 2.4;
    for (const p of stage.fencePanels) {
      p.getWorldPosition(tmpA);
      const dz = tmpA.z - carZ;
      if (Math.abs(dz) > lat) continue;
      world.scene.attach(p);
      const k = 1 - Math.abs(dz) / lat;
      flying.push({
        obj: p,
        vel: new THREE.Vector3(-V * (0.5 + 0.35 * k) * (0.8 + Math.random() * 0.4), 3 + Math.random() * 6 * (0.5 + k), clampAbs(dz * 1.4, 5) + (Math.random() - 0.5) * 3),
        spin: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 8),
        rested: false,
      });
    }
    // 火花・破片・閃光
    const dirW = new THREE.Vector3(-1, 0.2, 0);
    rt.fx.spark(hitPos, 70, 22, 0xffd070, dirW, 1.4);
    rt.fx.spark(hitPos, 40, 14, 0xfff2c0, dirW, 1.8);
    rt.fx.flash(hitPos, 6, 0xffe9a8, 0.3);
    rt.fx.chunks(hitPos, 18, 16, dirW, 0.1, 0.35, 1.2);
    rt.fx.dust(hitPos.clone().setY(0.3), 6, 5, 0xb3a690, 1.5, 1.2);
    rt.shake(0.55);
    rt.flash(0.18);
    st.speed *= 0.97;
  }

  function wallCrash(): void {
    st.crashed = true;
    st.carX = wallX + front;
    const pos = new THREE.Vector3(wallX, 1.1, carZ);
    world.events.emit('carWallCrash', { pos: pos.clone() });
    // 壁を凹ませる：車の幅より広く、深く（へこみの中心は車より少し上）
    st.dented = dentObject(stage.wall, pos.clone().setY(3), new THREE.Vector3(-1, 0, 0), 12, 3.2);
    const east = new THREE.Vector3(1, 0.35, 0);
    rt.fx.flash(pos, 16, 0xfff0c0, 0.5);
    rt.fx.spark(pos, 120, 26, 0xffc060, east, 1.6);
    rt.fx.spark(pos, 60, 16, 0xffffff, east, 2.0);
    rt.fx.chunks(pos.clone().setY(2.2), 70, 20, east, 0.12, 0.7, 1.6);
    rt.fx.dust(pos.clone().setY(1), 18, 9, 0x9c9486, 2.2, 2.4);
    rt.fx.dust(pos.clone().setY(3), 10, 7, 0x6b6660, 3.2, 3.0);
    rt.shake(1);
    rt.flash(0.95);
    // 車はつぶれて少し跳ね返る
    st.rebound = 6;
    car.squash = 0.86;
    car.pitch = 0.07;
    car.roll = 0.035;
    drive.car.setDriverPose('brace');
    st.speed = 0;
  }

  function clampAbs(v: number, m: number): number { return Math.max(-m, Math.min(m, v)); }

  // ---------------- ショット ----------------
  const headL = new THREE.Vector3();

  const shots: Shot[] = [
    // ① 前方斜めから：運転する主人公ごと車を捉えて並走
    {
      name: '前方斜め', duration: 2.0, shake: 0.35,
      enter() { st.carX = -980; drive.car.setDriverPose('drive'); car.setDriverVisible(true); rt.speedLines = 0.3; },
      camera(u, _t, pose) {
        car.headLocal(headL);
        car.toWorld(3.1 - 1.1 * u, 1.2 + 0.15 * u, -(front + 6.2 - 2.4 * u), pose.pos);
        car.toWorld(headL.x, headL.y - 0.25, headL.z, pose.target);
        pose.fov = lerp(48, 40, u);
        pose.roll = 0.03;
      },
    },
    // ② 道ばたに据えたカメラの横を、猛スピードで走り抜けて遠ざかる
    {
      name: '道ばた', duration: 1.8, shake: 0.12,
      enter() {
        st.carX = -1180 + 62;
        rt.speedLines = 0.25;
        pLook.set(st.carX - 6, 1.0, zc);
      },
      camera(u, t, pose, dt) {
        pose.pos.set(-1180, 0.7, zc + 5.4);
        // 車を目で追う：少し遅れてついていく（通過の瞬間にぶれる）
        tmpA.set(st.carX - 2, 0.9, carZ);
        pLook.lerp(tmpA, 1 - Math.exp(-6.5 * dt));
        pose.target.copy(pLook);
        pose.fov = lerp(54, 34, smooth(u));
        pose.roll = 0;
        if (!passed && st.carX < -1180) { passed = true; rt.shake(0.5); }
        void t;
      },
    },
    // ③ 車内：主人公の背中側から、前方の道
    {
      name: '車内', duration: 1.6, shake: 0.7,
      enter() { st.carX = -1180; rt.speedLines = 0.35; car.setDriverVisible(true); },
      camera(u, t, pose) {
        car.headLocal(headL);
        car.toWorld(headL.x + 0.3, headL.y + 0.42, headL.z + 1.75 - 0.2 * u, pose.pos);
        car.toWorld(headL.x - 0.05, headL.y - 0.05, headL.z - 30, pose.target);
        pose.fov = lerp(64, 58, u);
        pose.roll = Math.sin(t * 9) * 0.004;
        drive.car.setSteer(Math.sin(t * 5) * 0.08);
      },
    },
    // ④ 後ろの引き：収容所がどんどん近づく
    {
      name: '後ろの引き', duration: 2.0, shake: 0.1,
      enter() { st.carX = -1250; rt.speedLines = 0.12; drive.car.setSteer(0); },
      camera(u, t, pose) {
        // 車の後方 40m あたりから、少しだけ遅れて追う（距離がじわじわ開き、収容所が正面にそびえる）
        const camX = -1250 + 40 - V * 0.8 * t;
        pose.pos.set(camX, 3.6 + 2.0 * u, zc + 2.2);
        pose.target.set(st.carX - 22, 6.0, zc - 0.5);
        pose.fov = lerp(32, 29, u);
        pose.roll = 0;
      },
    },
    // ⑤ 正面から：ハンドルを握る主人公の顔
    {
      name: '正面の顔', duration: 1.5, shake: 0.45,
      enter() { st.carX = -1300; rt.speedLines = 0.3; drive.car.setDriverPose('drive'); },
      camera(u, t, pose) {
        car.headLocal(headL);
        car.toWorld(headL.x + 0.1, headL.y + 0.1, headL.z - 2.5 + 0.5 * u, pose.pos);
        car.toWorld(headL.x, headL.y - 0.3, headL.z, pose.target);
        pose.fov = lerp(37, 32, u);
        pose.roll = 0.05 * Math.sin(t * 2);
      },
    },
    // ⑥ 真横：柵を突き破る（スロー）→ 元の速度で壁に激突
    {
      name: '真横', duration: 14,
      shake: 0.15,
      enter() {
        st.carX = fenceX + 44 + front;
        rt.speedLines = 0.18;
        drive.car.setDriverPose('drive');
        car.setDriverVisible(true);
        // カメラと車の間にある柵の板は隠す（見えなくなるので）
        for (const p of stage.fencePanels) {
          p.getWorldPosition(tmpA);
          if (tmpA.z > carZ + 3.2 && tmpA.z < carZ + 16 && p.visible) { p.visible = false; hiddenPanels.push(p); }
        }
      },
      timeScale() {
        if (st.crashed) {
          const t = st.crashReal;
          if (t < 0.16) return 0.03; // ヒットストップ
          return lerp(0.3, 0.8, smooth((t - 0.16) / 1.2));
        }
        const d = dFence();
        if (d >= 40) return 1;
        if (d >= 14) return lerp(1, SLOW_SCALE, smooth((40 - d) / 26));
        if (d >= -6) return SLOW_SCALE;
        if (d >= -22) return lerp(SLOW_SCALE, 1, smooth((-6 - d) / 16));
        return 1;
      },
      end() { return st.crashed && st.crashReal >= 2.4; },
      camera(u, t, pose) {
        // 柵の少し手前（東）に据えて、車が通り抜けるのを真横に近い角度で撮る。通り過ぎたら車を追って壁まで並走
        const plantX = fenceX + 4.5;
        const camX = Math.max(wallX + 11, Math.min(plantX, st.carX + 8));
        const k = st.crashed ? smooth(st.crashReal / 1.9) : 0;
        pose.pos.set(camX + 14 * k, 2.0 + 0.3 * k, carZ + 10.5 + 3 * k);
        const tx = st.crashed ? lerp(st.carX, wallX + 1, k) : Math.min(fenceX - 0.5, st.carX - 1);
        pose.target.set(tx, lerp(1.4, 2.6, k), carZ);
        pose.fov = st.crashed ? lerp(46, 40, k) : 46;
        pose.roll = 0;
        void u; void t;
      },
    },
  ];

  const fwd = new THREE.Vector3();

  const script: Script = {
    shots,
    sim(dt, rdt) {
      const si = rt.shotIndex;
      // --- 車の動き
      if (si <= 4) {
        st.carX -= V * dt;
        st.speed = V;
      } else if (si === 5) {
        if (!st.crashed) {
          st.carX -= st.speed * dt;
          // 柵を突き破る
          if (!st.fenceBroken && dFence() <= 0) breakFence();
          if (st.fenceBroken && dFence() > -5) {
            // 通過中は車体の側面・下から火花
            const p = tmpB.set(st.carX - front * 0.2, 0.3, carZ + (Math.random() - 0.5) * 1.6);
            rt.fx.spark(p, 3, 9, 0xffcf80, tmpC.set(-0.3, 1, 0), 1.2);
          }
          if (dWall() <= 0) wallCrash();
          // 激突の直前に身構える
          if (!st.crashed && dWall() < 36) drive.car.setDriverPose('brace');
        } else {
          st.crashReal += rdt;
          // 跳ね返り→停止、傾きが戻る
          st.carX += st.rebound * dt;
          st.rebound *= Math.exp(-4.5 * dt);
          car.pitch *= Math.exp(-2 * dt);
          car.roll *= Math.exp(-1.2 * dt);
          if (st.carX < wallX + front) st.carX = wallX + front;
          st.speed = Math.abs(st.rebound);
          // 暗転
          if (st.crashReal > 1.55 && !st.fadeStarted) { st.fadeStarted = true; rt.fadeTo(1, 0.8); }
          // くすぶり
          if (Math.random() < 0.5) rt.fx.dust(tmpB.set(wallX + 1, 0.5, carZ), 1, 4, 0x6b6660, 1.6, 1.8);
          if (Math.random() < 0.25) rt.fx.spark(tmpB.set(wallX + 1.5, 0.8, carZ + (Math.random() - 0.5) * 2), 2, 5, 0xffb050, undefined, 1);
        }
      }
      car.x = st.carX;
      car.z = zc + (si <= 4 ? Math.sin(rt.world.time * 1.3) * 0.25 : 0);
      if (si <= 4) { car.pitch = -0.012; car.roll = Math.sin(rt.world.time * 2.1) * 0.006; }
      car.yaw = Math.PI / 2;
      car.place(st.speed);
      drive.car.update(dt, st.speed);

      // --- 飛んでいく柵の板
      for (const f of flying) {
        if (f.rested) continue;
        f.vel.y -= 14 * dt;
        f.obj.position.addScaledVector(f.vel, dt);
        f.obj.rotation.x += f.spin.x * dt;
        f.obj.rotation.y += f.spin.y * dt;
        f.obj.rotation.z += f.spin.z * dt;
        if (f.obj.position.y < 0.15) {
          f.obj.position.y = 0.15;
          if (Math.abs(f.vel.y) < 2) { f.rested = true; continue; }
          f.vel.y *= -0.35; f.vel.x *= 0.55; f.vel.z *= 0.55; f.spin.multiplyScalar(0.5);
        }
      }

      // --- 速度線（道沿い）
      car.forward(fwd);
      rt.lines.update(tmpA.set(st.carX, 0, zc), fwd, si === 5 && st.crashed ? 0 : rt.speedLines);
      finish();
    },
    dispose() {
      for (const p of hiddenPanels) p.visible = true;
      restoreProps();
      car.restore();
      stage.dispose();
    },
  };
  return script;
}
