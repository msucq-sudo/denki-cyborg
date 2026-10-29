// 失敗の演出：300km/h に届かなかった → 横から現れたヘビー3体が、車を受け止める。
// ①車内（背中側）から、前方にヘビーが歩いてくる ②主人公の顔：身を乗り出す ③主人公の視点：あと2体 ④斜め上から全体 ⑤真横のスローで衝突
import * as THREE from 'three';
import type { World } from '../core/types';
import type { DriveState } from '../vehicle/types';
import { COMPOUND } from '../level/surge/layout';
import { CarRig } from './carRig';
import { HeavyActor } from './heavy';
import type { Runtime, Script, Shot } from './sequencer';
import { hideDriveProps, ROAD_Z } from './stage';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };

/** ヘビーの当たりの半径（腕を前に出した分を含む）m */
const RH = 1.55;
/** 衝突シーンのスロー倍率 */
export const FAIL_SLOW = 0.3;

export interface FailProbe {
  heavies: number;
  caught: boolean;
  stopped: boolean;
  carX: number;
  carSpeed: number;
  /** ヘビーが押されて下がった距離（m） */
  pushed: number;
}

export function failScript(rt: Runtime, drive: DriveState, probe?: FailProbe): Script {
  const world: World = rt.world;
  const car = new CarRig(drive);
  const zc = ROAD_Z;
  const front = car.m.frontDist;
  // ヘビーが立つ位置：判定地点から少し先の道の上
  const xH = Math.max(COMPOUND.fenceX + 60, drive.pos.x - 70);
  const heavies: HeavyActor[] = [];
  const headL = new THREE.Vector3();
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
  const clock = { t: 0 };
  // 演出の範囲にある障害物・雑魚は隠す
  const restoreProps = hideDriveProps(drive, drive.pos.x + 80);

  // 最終位置（ヘビーが道の上で縦に並ぶ：先頭 A を B・C が後ろから支える）
  const spots = [
    { x: xH, z: zc },
    { x: xH - 3.3, z: zc - 1.5 },
    { x: xH - 6.5, z: zc + 1.4 },
  ];

  const st = {
    carX: drive.pos.x, speed: 11,
    // ⑤の衝突
    contact: false, stopped: false, stopReal: 0, rebound: 0, pushed: 0, fadeStarted: false,
    // 1次元（西向きを正とした距離）での位置
    dA: -spots[0].x, dB: -spots[1].x, dC: -spots[2].x,
    reachedA: false,
  };
  /** 車の位置を、A の正面からの距離 gap で決める */
  const setGap = (gap: number) => { st.carX = spots[0].x + RH + gap + front; };

  function spawn(i: number, x: number, z: number, yaw: number): HeavyActor {
    const h = new HeavyActor(world.scene, x, z, yaw);
    heavies[i] = h;
    return h;
  }

  function faceEast(h: HeavyActor, dt: number): void { h.turnTo(Math.PI / 2, dt, 7); }

  /** 視線の先：実際のヘビーの位置（まだ出ていなければ最終位置） */
  const targets = [0, 1, 2].map((i) => () => {
    const h = heavies[i];
    return tmpA.set(h ? h.pos.x : spots[i].x, 1.4, h ? h.pos.z : spots[i].z);
  });

  const shots: Shot[] = [
    // ① 車内（主人公の背中側）：前方の道ばたからヘビーがテクテク歩いてくる
    {
      name: '車内・ヘビー出現', duration: 2.6, shake: 0.6,
      enter() {
        setGap(72); st.speed = 12; clock.t = 0;
        drive.car.setDriverPose('drive');
        car.setDriverVisible(true);
        spawn(0, spots[0].x, zc + 9.5, Math.PI);
      },
      camera(u, t, pose) {
        car.headLocal(headL);
        car.toWorld(headL.x + 0.3, headL.y + 0.25, headL.z + 1.5, pose.pos);
        // 道の先 → ヘビーへ視線がよっていく
        car.toWorld(headL.x, headL.y + 0.1, headL.z - 40, tmpB);
        heavies[0].root.getWorldPosition(tmpC);
        tmpC.y += 0.3;
        pose.target.lerpVectors(tmpB, tmpC, 0.6 + 0.4 * smooth(u));
        pose.fov = lerp(46, 28, smooth(u));
        pose.roll = Math.sin(t * 8) * 0.004;
      },
    },
    // ② 主人公の顔：「なんだあれ」と身を乗り出す
    {
      name: '顔・身を乗り出す', duration: 1.6, shake: 0.35, caption: '…なんだ、あれは？',
      enter() { setGap(42); st.speed = 11.2; clock.t = 0; },
      camera(u, t, pose) {
        car.headLocal(headL);
        car.toWorld(headL.x + 0.3, headL.y + 0.12, headL.z - 2.6 + 0.5 * u, pose.pos);
        car.toWorld(headL.x, headL.y - 0.04, headL.z, pose.target);
        pose.fov = lerp(30, 24, smooth(u));
        pose.roll = 0.04 * Math.sin(t * 1.7);
      },
    },
    // ③ 主人公の視点：あと2体が左右から歩いてきて、3体が受け止める構えをとる
    {
      name: '主人公の視点', duration: 2.2, shake: 0.5, caption: 'ヘビーが…三体！？',
      enter() {
        setGap(34); st.speed = 10.4; clock.t = 0;
        car.setDriverVisible(false);
        spawn(1, spots[1].x, spots[1].z - 10.5, 0);
        spawn(2, spots[2].x, spots[2].z + 10.5, Math.PI);
      },
      camera(u, t, pose) {
        car.headLocal(headL);
        car.toWorld(headL.x, headL.y + 0.03, headL.z - 0.3, pose.pos);
        // 視線が A → B → C と移る
        const keys: [number, number][] = [[0, 0], [0.26, 0], [0.42, 1], [0.58, 1], [0.76, 2], [1, 2]];
        let f = 2;
        for (let i = 0; i < keys.length - 1; i++) {
          const [u0, f0] = keys[i], [u1, f1] = keys[i + 1];
          if (u <= u1) { f = lerp(f0, f1, smooth((u - u0) / (u1 - u0))); break; }
        }
        const lo = Math.floor(f), hi = Math.min(2, lo + 1);
        targets[lo]();
        pose.target.copy(tmpA);
        targets[hi]();
        pose.target.lerp(tmpA, f - lo);
        pose.fov = lerp(58, 46, smooth(u));
        pose.roll = Math.sin(t * 7) * 0.006;
      },
    },
    // ④ 斜め上から：街全体・ヘビー・車
    {
      name: '俯瞰', duration: 1.8, shake: 0.08,
      enter() {
        setGap(25); st.speed = 9.8; clock.t = 0;
        car.setDriverVisible(true);
      },
      camera(u, _t, pose) {
        // ヘビーの背後の上空から東（街の方）を見下ろす：ヘビー3体の背中、向かってくる車、道の先に広がる街が一度に入る
        const hx = spots[0].x;
        pose.pos.set(hx - 34 - 4 * u, lerp(21, 25, u), zc + lerp(17, 20, u));
        pose.target.set(hx + 30, 3, zc - 1);
        pose.fov = 50;
        pose.roll = 0;
      },
    },
    // ⑤ 真横のスロー：車がヘビー3体にぶつかり、押し戻されながら止められる
    {
      name: '真横・衝突', duration: 9, shake: 0.12,
      enter() {
        setGap(7.5); st.speed = 11; clock.t = 0;
        car.setDriverVisible(true);
        drive.car.setDriverPose('brace');
        st.dA = -spots[0].x; st.dB = -spots[1].x; st.dC = -spots[2].x;
      },
      timeScale() {
        if (st.contact && !st.stopped) {
          // 衝突の瞬間はほぼ静止（ヒットストップ）してからスロー
          return clock.t < 0.12 ? 0.04 : FAIL_SLOW * 0.8;
        }
        if (st.stopped) return lerp(0.3, 0.7, smooth(st.stopReal / 1.2));
        return lerp(1, FAIL_SLOW, smooth(clock.t / 0.3));
      },
      end() { return st.stopped && st.stopReal >= 1.9; },
      camera(u, t, pose) {
        const xc = spots[0].x + RH;
        pose.pos.set(xc - 0.5, 1.6, zc + 14);
        pose.target.set(xc - 0.8 + Math.min(2, st.pushed) * 0.3, 1.3, zc);
        pose.fov = 38;
        pose.roll = 0;
        void u; void t;
      },
    },
  ];

  // 衝突後に横から見える押し込み量を、各ヘビーの位置に反映
  const applyHeavyPos = () => {
    heavies[0]?.pos.set(-st.dA, 0, spots[0].z);
    heavies[1]?.pos.set(-st.dB, 0, spots[1].z);
    heavies[2]?.pos.set(-st.dC, 0, spots[2].z);
  };

  const fwd = new THREE.Vector3();

  const script: Script = {
    shots,
    sim(dt, rdt) {
      const si = rt.shotIndex;
      clock.t += rdt;
      const [a, b, c] = heavies;

      // --- ヘビー：歩き → 構え
      if (si <= 4) {
        if (a) {
          if (!st.reachedA) {
            st.reachedA = a.walkTo(spots[0].x, spots[0].z, 3.3, dt);
            if (st.reachedA) a.mode = 'idle';
          } else faceEast(a, dt);
          if (si >= 1 && st.reachedA) { faceEast(a, dt); if (si >= 2) a.mode = 'brace'; }
          if (si >= 2) a.mode = si === 4 && st.contact ? 'skid' : 'brace';
          a.update(dt);
        }
        for (const [h, i] of [[b, 1], [c, 2]] as [HeavyActor | undefined, number][]) {
          if (!h) continue;
          if (si < 4 || !st.contact) {
            const arrived = h.walkTo(spots[i].x, spots[i].z, 4.2, dt);
            if (arrived) { faceEast(h, dt); h.mode = Math.abs(h.yaw - Math.PI / 2) < 0.5 ? 'brace' : 'idle'; }
          }
          if (si === 4 && st.contact) h.mode = 'skid';
          h.update(dt);
        }
      }

      // --- 車
      if (si < 4) {
        st.carX -= st.speed * dt;
        // ②の途中で身を乗り出す
        if (si === 1 && clock.t > 0.3) drive.car.setDriverPose('lean');
        if (si === 2) drive.car.setDriverPose('lean');
        if (si === 3) drive.car.setDriverPose('lean');
      } else if (si === 4) {
        // 1次元（西向きを正）で衝突を解く
        if (!st.contact) {
          st.speed = Math.max(0, st.speed - 0.4 * dt);
          st.carX -= st.speed * dt;
          if (-st.carX + front >= st.dA - RH) {
            st.contact = true;
            clock.t = 0;
            const hit = tmpA.set(spots[0].x + RH, 1.0, zc);
            world.events.emit('carCaught', { pos: hit.clone() });
            rt.fx.flash(hit, 9, 0xfff0c0, 0.35);
            rt.fx.spark(hit, 60, 14, 0xffd070, tmpB.set(1, 0.3, 0), 1.6);
            rt.fx.dust(hit.clone().setY(0.4), 10, 5, 0xa89c88, 1.4, 1.6);
            rt.shake(0.85);
            rt.flash(0.35);
          }
        }
        if (st.contact && !st.stopped) {
          const frontD = -st.carX + front;
          st.dA = Math.max(st.dA, frontD + RH);
          st.dB = Math.max(st.dB, st.dA + 3.2);
          st.dC = Math.max(st.dC, st.dB + 3.2);
          const engaged = (st.dA > spots[0].x * -1 + 0.001 ? 1 : 0) + (st.dB > -spots[1].x + 0.001 ? 1 : 0) + (st.dC > -spots[2].x + 0.001 ? 1 : 0);
          // 押すほど強くブレーキがかかる（3体が踏ん張る）
          st.speed = Math.max(0, st.speed - (10 + 15 * engaged) * dt);
          st.carX -= st.speed * dt;
          st.pushed = st.dA + spots[0].x;
          // 足元の火花・土煙（押されて滑っている間）
          if (st.speed > 0.3) {
            for (const [h, i] of [[a, 0], [b, 1], [c, 2]] as [HeavyActor, number][]) {
              if (!h || i + 1 > engaged) continue;
              tmpB.set(h.pos.x + 1.0, 0.1, h.pos.z + (Math.random() - 0.5) * 1.6);
              rt.fx.spark(tmpB, 2, 7, 0xffc870, tmpC.set(0.6, 0.7, 0), 1);
              if (Math.random() < 0.35) rt.fx.dust(tmpB, 1, 1.5, 0xa89c88, 0.8, 1.2);
            }
          }
          if (st.speed <= 0.02) {
            st.stopped = true;
            st.stopReal = 0;
            st.rebound = 1.4;
            drive.car.setDriverPose('lean');
          }
        } else if (st.stopped) {
          st.stopReal += rdt;
          st.carX += st.rebound * dt;
          st.rebound *= Math.exp(-6 * dt);
          if (st.stopReal > 0.9 && !st.fadeStarted) { st.fadeStarted = true; rt.fadeTo(1, 0.8); }
          if (Math.random() < 0.25) rt.fx.dust(tmpB.set(spots[0].x + RH + 0.8, 0.5, zc), 1, 3, 0x8a8174, 1.0, 1.6);
        }
        // ヘビーの位置・姿勢
        applyHeavyPos();
        const push = st.contact ? clamp01(st.speed / 8) : 0;
        if (a) a.lean = -0.18 * push - (st.contact ? 0.05 : 0);
        if (b) b.lean = -0.12 * push;
        if (c) c.lean = -0.1 * push;
        for (const h of heavies) h?.update(dt);
        // 車体：先頭が少しつぶれる
        car.squash = st.contact ? lerp(1, 0.95, clamp01(st.pushed / 1.2)) : 1;
        car.pitch = st.contact ? -0.025 : 0;
      }

      car.x = st.carX;
      car.z = zc;
      car.yaw = Math.PI / 2;
      car.place(st.speed);
      drive.car.update(dt, st.speed);

      car.forward(fwd);
      rt.lines.update(tmpA.set(st.carX, 0, zc), fwd, 0);

      if (probe) {
        probe.heavies = heavies.filter(Boolean).length;
        probe.caught = st.contact;
        probe.stopped = st.stopped;
        probe.carX = st.carX;
        probe.carSpeed = st.speed;
        probe.pushed = st.pushed;
      }
    },
    dispose() {
      for (const h of heavies) h?.dispose();
      restoreProps();
      heavies.length = 0;
      car.restore();
    },
  };
  return script;
}
