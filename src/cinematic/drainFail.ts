// ルート2（ドレイン装置へ）の失敗の演出：判定地点 E を 200〜299km/h で越えた
// → ①〜⑥ は成功と同じ（drainCommon.ts）。⑦ 扉の真横のスローのあと、等倍に戻って扉に激突するが、扉は破れずに車がはね返される
// → ⑧ 止まった車の中で、ライアンが頭の後ろをかく（近い斜めのカット）→ 暗転 → 死亡画面。
// 終わったら drive.ts の onDone が呼ばれ、プレイヤーの HP が 0 になる。
import * as THREE from 'three';
import type { DriveState } from '../vehicle/types';
import { DRAIN_DOOR } from '../level/surge/layout';
import type { Runtime, Script, Shot } from './sequencer';
import { DOOR_MID_Y, DrainRun, doorSideCamera, doorTimeScale, faceCamera, introShots, lerp, smooth, ZC } from './drainCommon';
import { dentObject } from './stage';

export interface DrainFailProbe {
  carX: number;
  carY: number;
  /** 扉にぶつかった */
  hitDoor: boolean;
  /** 扉を突き破った（失敗では常に false） */
  breached: boolean;
  /** 扉がへこんだ頂点の数 */
  dented: number;
  /** 衝突の前に、スローモーションに入った最小の倍率 */
  minScaleBeforeImpact: number;
  /** 衝突の次の更新の時間の流れ（1 = 等倍に戻った）。まだなら 0 */
  scaleAfterImpact: number;
  /** 頭をかくカットに入った */
  scratching: boolean;
  finished: boolean;
}

/** 失敗のときの突入の速さ m/s の上限（≒ 290km/h） */
const V_MAX = 80.5;

export function drainFailScript(rt: Runtime, drive: DriveState, probe?: DrainFailProbe): Script {
  const V = Math.min(V_MAX, Math.max(200 / 3.6, drive.speed));
  const run = new DrainRun(rt, drive, V);
  const { car } = run;
  const st = { hit: false, hitReal: 0, dented: 0, minScale: 1, scaleAfter: 0, justHit: false, scratching: false, s8: 0, fading: false, finished: false, rebound: 0 };
  const tmp = new THREE.Vector3(), tmpB = new THREE.Vector3(), west = new THREE.Vector3(-1, 0.4, 0), east = new THREE.Vector3(1, 0.1, 0);
  const pLook = new THREE.Vector3(DRAIN_DOOR.x - 14, DRAIN_DOOR.y + 1.4, ZC);

  const finish = (): void => {
    if (!probe) return;
    probe.carX = run.x; probe.carY = car.root.position.y; probe.hitDoor = st.hit; probe.breached = run.doorHidden;
    probe.dented = st.dented; probe.minScaleBeforeImpact = st.minScale; probe.scaleAfterImpact = st.scaleAfter;
    probe.scratching = st.scratching; probe.finished = st.finished;
  };

  /** 扉にぶつかったが、破れない */
  function bump(): void {
    st.hit = true; st.justHit = true;
    run.x = run.hitX;
    const p = new THREE.Vector3(DRAIN_DOOR.x - 0.2, DOOR_MID_Y - 1.6, ZC);
    rt.world.events.emit('carWallCrash', { pos: p.clone() });
    // 扉を（車の幅より広く）凹ませる
    if (run.parts.door) st.dented = dentObject(run.parts.door, new THREE.Vector3(DRAIN_DOOR.x, DOOR_MID_Y - 1.4, ZC), east, 5.5, 1.3);
    run.dentDoor();
    run.impactMark(new THREE.Vector3(DRAIN_DOOR.x - 0.9, DOOR_MID_Y - 1.6, ZC), west.clone().setY(0).normalize(), 2.4);
    rt.fx.flash(p, 14, 0xfff0c0, 0.4);
    rt.fx.spark(p, 110, 26, 0xffc060, west, 1.6);
    rt.fx.spark(p, 50, 16, 0xffffff, west, 2.0);
    rt.fx.chunks(p, 28, 16, west, 0.08, 0.4, 1.6);
    rt.fx.dust(p.clone().setY(p.y - 0.8), 12, 7, 0x8a8f98, 1.8, 2.2);
    run.shockwave(p, 0xffe6b0);
    rt.shake(1);
    rt.flash(0.8);
    // 車はつぶれて、はね返される
    car.squash = 0.84;
    st.rebound = -17;
    run.speed = st.rebound;
    drive.car.setDriverPose('brace');
  }

  const shots: Shot[] = [
    ...introShots(run, { durs: [2.0, 1.8, 1.8, 1.7, 1.8, 1.2] }),
    // ⑦ 扉の真横：スロー → 等倍で激突 → 破れずにはね返る
    {
      name: '扉の真横（スロー→はね返される）', duration: 6,
      shake: 0.12,
      enter() {
        run.x = run.hitX - 66; run.speed = V; rt.speedLines = 0.15;
        drive.car.setDriverPose('push');
        run.place(0);
      },
      timeScale: () => doorTimeScale(run, st.hit),
      end: () => st.hit && st.hitReal > 1.7,
      camera(_u, _t, pose, dt) {
        tmp.set(st.hit ? lerp(DRAIN_DOOR.x - 4, run.x, 0.5) : Math.min(run.x + 1.2, DRAIN_DOOR.x - 4), DOOR_MID_Y - 1.8, ZC);
        pLook.lerp(tmp, 1 - Math.exp(-(st.hit ? 3 : 7) * dt));
        doorSideCamera(run, pose, 0, 0);
        pose.target.copy(pLook);
        pose.fov = st.hit ? lerp(38, 35, smooth(st.hitReal / 1.5)) : 42;
      },
    },
    // ⑧ 止まった車の中のライアンを、斜め前の近くから：頭の後ろをかく
    {
      name: 'ライアン（頭をかく）', duration: 3.0, shake: 0.1,
      enter() {
        st.scratching = true;
        rt.speedLines = 0;
        drive.car.setDriverPose('scratch');
        run.place(0);
      },
      camera(u, t, pose) {
        faceCamera(run, pose, lerp(1.1, 0.9, smooth(u)), lerp(2.3, 2.0, smooth(u)), 0.12, lerp(38, 33, smooth(u)));
        pose.roll = 0.03;
        void t;
      },
    },
  ];

  return {
    shots,
    sim(dt, rdt) {
      const si = rt.shotIndex;
      if (si <= 5) {
        run.x += V * dt;
        run.speed = V;
        run.place(dt);
        run.lines(rt.speedLines);
      } else if (si === 6) {
        if (st.justHit) { st.scaleAfter = rdt > 0 ? dt / rdt : 1; st.justHit = false; }
        if (!st.hit) {
          st.minScale = Math.min(st.minScale, rdt > 0 ? dt / rdt : 1);
          run.x += V * dt;
          if (run.dDoor() < 14) drive.car.setDriverPose('brace');
          if (run.dDoor() <= 0) bump();
          run.place(dt, V);
        } else {
          st.hitReal += rdt;
          // はね返って止まる（傾きが戻る）。止まるまでに数メートル
          run.x += run.speed * dt;
          run.speed *= Math.exp(-3.2 * dt);
          if (run.x > run.hitX) run.x = run.hitX;
          // 車体が一度はね上がって落ちる
          const hop = Math.max(0, Math.sin(Math.min(1, st.hitReal / 0.5) * Math.PI)) * 0.25 * Math.exp(-st.hitReal * 1.2);
          run.place(dt, Math.abs(run.speed), { yOffset: hop });
          // くすぶり（ボンネットから煙と火花）
          car.toWorld(0, 0.9, -car.m.frontDist + 0.9, tmpB);
          if (Math.random() < 0.3 && st.hitReal < 1.0) rt.fx.dust(tmpB, 1, 1.2, 0x55585e, 1.8, 1.2);
          if (Math.random() < 0.3) rt.fx.spark(tmpB, 2, 5, 0xffb050, undefined, 1);
        }
        run.lines(0);
      } else {
        // ⑧ 止まっている
        st.s8 += rdt;
        run.speed = 0;
        run.place(dt, 0);
        if (st.s8 > 2.25 && !st.fading) { st.fading = true; rt.fadeTo(1, 0.7); }
        if (st.s8 > 2.9) st.finished = true;
        run.lines(0);
      }
      run.updateDebris(dt);
      finish();
    },
    complete() {
      if (!st.hit) { st.hit = true; car.squash = 0.84; }
      run.x = run.hitX - 4.5;
      run.speed = 0;
      st.finished = true;
      run.place(0);
      finish();
    },
    dispose() { run.dispose(); },
  };
}
