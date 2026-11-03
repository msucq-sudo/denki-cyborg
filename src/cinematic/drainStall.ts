// ルート2（ドレイン装置へ）の失速の演出：判定地点 E を 200km/h 未満で越えた
// → ①〜③ は成功・失敗と同じ型（drainCommon.ts。③で車が坂に入って減速しはじめる）
// → ④ 真横：坂の途中（STALL.climbX）で力尽きて止まる。車輪だけが空回り
// → ⑤ 坂と別棟のあいだの谷から東を見る：後ろ向きに滑り落ち、横へそれて坂の縁から飛び出し、発電所の脇の壁（PLANT.sideWing）に激突
// → ⑥ ライアンが頭の後ろをかく（あきれ）→ 暗転 → 死亡画面。
// 終わったら drive.ts の onDone が呼ばれ、プレイヤーの HP が 0 になる。
import * as THREE from 'three';
import type { DriveState } from '../vehicle/types';
import { PLANT, RAMP, STALL } from '../level/surge/layout';
import type { Runtime, Script, Shot } from './sequencer';
import { DrainRun, faceCamera, introShots, lerp, smooth, ZC } from './drainCommon';
import { dentObject } from './stage';

export interface DrainStallProbe {
  carX: number;
  carY: number;
  carZ: number;
  /** 登る勢いが尽きて滑り落ち始めた */
  sliding: boolean;
  /** 発電所の脇の壁にぶつかった */
  hitWing: boolean;
  /** 壁がへこんだ頂点の数 */
  dented: number;
  /** 登れた最大の x */
  maxX: number;
  finished: boolean;
}

const GRAV = 14;

export function drainStallScript(rt: Runtime, drive: DriveState, probe?: DrainStallProbe): Script {
  const V = Math.min(50, Math.max(24, drive.speed));
  const run = new DrainRun(rt, drive, V);
  const { car } = run;
  const wallZ = PLANT.sideWing.z0 - 0.45;
  const st = {
    z: ZC, y: 0, vx: 0, vz: 0, vy: 0, psi: 0, roll: 0, pitch: 0, phase: 'climb' as 'climb' | 'hold' | 'slide' | 'air' | 'crashed',
    holdT: 0, slideT: 0, crashReal: 0, maxX: 0, dented: 0, decel: 0, s6: 0, fading: false, finished: false, landed: false,
  };
  const tmp = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
  const pLook = new THREE.Vector3();
  const wallDir = new THREE.Vector3(0, 0, 1);
  const camBase = new THREE.Vector3();

  const finish = (): void => {
    if (!probe) return;
    probe.carX = run.x; probe.carY = car.root.position.y; probe.carZ = st.z; probe.sliding = st.phase !== 'climb' && st.phase !== 'hold';
    probe.hitWing = st.phase === 'crashed'; probe.dented = st.dented; probe.maxX = st.maxX; probe.finished = st.finished;
  };

  /** 自由な位置・向きで車を置く（坂の上でも空中でも） */
  function placeFree(dt: number, vis: number): void {
    car.x = run.x; car.z = st.z; car.yaw = -Math.PI / 2 + st.psi;
    car.pitch = st.pitch; car.roll = st.roll;
    car.place(vis);
    car.root.position.y = st.y;
    car.root.updateMatrixWorld(true);
    drive.car.update(dt, vis);
  }

  function crash(): void {
    st.phase = 'crashed'; st.crashReal = 0;
    const p = new THREE.Vector3(run.x, st.y + 0.8, wallZ);
    rt.world.events.emit('carWallCrash', { pos: p.clone() });
    const wing = run.parts.sideWing;
    run.impactMark(new THREE.Vector3(run.x, st.y + 1.0, wallZ - 0.02), new THREE.Vector3(0, 0, -1), 3.4);
    if (wing) st.dented = dentObject(wing, p.clone(), wallDir, 9, 2.6);
    const north = new THREE.Vector3(0, 0.35, -1);
    rt.fx.flash(p, 18, 0xfff0c0, 0.5);
    rt.fx.spark(p, 120, 26, 0xffc060, north, 1.6);
    rt.fx.spark(p, 60, 16, 0xffffff, north, 2.0);
    rt.fx.chunks(p.clone().setY(p.y + 1.2), 70, 20, north, 0.12, 0.7, 1.6);
    rt.fx.dust(p.clone(), 16, 9, 0x9c9486, 2.2, 2.4);
    rt.shake(1);
    rt.flash(0.9);
    car.squash = 0.86;
    st.vz = -4; st.vx *= 0.25; st.vy = Math.max(st.vy, 0) + 1;
    drive.car.setDriverPose('brace');
  }

  /** 壁の下に着地した形で確定（⑥の前・スキップ用） */
  function settle(): void {
    st.y = 0; st.vy = 0; st.vx = 0; st.vz = 0; st.landed = true;
    st.pitch = 0.04; st.roll = 0.22;
    st.z = Math.min(st.z, wallZ - 2.3);
    placeFree(0, 0);
  }

  const shots: Shot[] = [
    ...introShots(run, { durs: [1.6, 1.3, 1.8, 0, 0, 0] }).slice(0, 3),
    // ④ 真横：登る勢いが尽きて止まる。車輪だけが空回り
    {
      name: '真横（失速して止まる）', duration: 5.0, shake: 0.14,
      enter() {
        run.x = 1628; run.speed = 9; st.z = ZC; st.psi = 0; st.phase = 'climb';
        st.decel = (run.speed * run.speed) / (2 * (STALL.climbX - run.x));
        rt.speedLines = 0.08;
        drive.car.setDriverPose('lean');
        run.place(0);
      },
      end: () => st.phase === 'slide' || st.phase === 'air' || st.phase === 'crashed',
      camera(u, t, pose) {
        const y = RAMP.yAt(run.x);
        pose.pos.set(run.x + 0.8, y + 2.3, ZC + 9.8);
        pose.target.set(run.x, y + 0.9, ZC);
        pose.fov = lerp(42, 32, smooth(t / 3.4));
        pose.roll = 0;
        void u;
      },
    },
    // ⑤ 坂と別棟のあいだの谷（西の端）から東を見る：滑り落ち、縁から飛び出し、壁に激突
    {
      name: '横上（滑り落ちて激突）', duration: 7.0, shake: 0.12,
      enter() {
        rt.speedLines = 0;
        camBase.set(1611, RAMP.yAt(1640) + 5.5, ZC + 14.5);
        pLook.set(run.x, RAMP.yAt(run.x) + 1, ZC);
      },
      end: () => st.phase === 'crashed' && st.crashReal > 1.55,
      camera(u, _t, pose, dt) {
        pose.pos.copy(camBase);
        pose.pos.y = camBase.y - 3 * smooth(u);
        tmp.set(run.x, st.y + 1.0, st.z);
        pLook.lerp(tmp, 1 - Math.exp(-6 * dt));
        pose.target.copy(pLook);
        pose.fov = st.phase === 'crashed' ? lerp(42, 36, smooth(st.crashReal / 1.4)) : 42;
        pose.roll = 0;
      },
    },
    // ⑥ ライアン：あきれて頭をかく
    {
      name: 'ライアン（頭をかく）', duration: 2.7, shake: 0.1,
      enter() {
        if (!st.landed) settle();
        rt.speedLines = 0;
        drive.car.setDriverPose('scratch');
      },
      camera(u, _t, pose) {
        faceCamera(run, pose, lerp(1.1, 0.9, smooth(u)), lerp(2.3, 2.0, smooth(u)), 0.12, lerp(38, 33, smooth(u)));
        pose.roll = 0.03;
      },
    },
  ];

  return {
    shots,
    sim(dt, rdt) {
      const si = rt.shotIndex;
      st.maxX = Math.max(st.maxX, run.x);
      if (si <= 2) {
        // ①②：全速。③：坂に入って減速しはじめる
        if (si === 2) run.speed = Math.max(V * 0.55, run.speed - 5 * dt); else run.speed = V;
        run.x += run.speed * dt;
        run.place(dt);
        run.lines(rt.speedLines);
      } else if (si === 3) {
        if (st.phase === 'climb') {
          run.speed = Math.max(0, run.speed - st.decel * dt);
          run.x += run.speed * dt;
          if (run.x >= STALL.climbX || run.speed <= 0.3) { st.phase = 'hold'; st.holdT = 0; run.speed = 0; rt.shake(0.4); }
          run.place(dt);
        } else {
          // 止まって、車輪が空回りして煙が出る
          st.holdT += rdt;
          car.toWorld(1.0, 0.1, 1.45, tmpB);
          if (Math.random() < 0.8) rt.fx.dust(tmpB, 1, 1.2, 0x8a8478, 1.2, 1.2);
          if (Math.random() < 0.25) rt.fx.spark(tmpB, 2, 4, 0xffd070, undefined, 1);
          run.place(dt, 26);
          if (st.holdT > 0.8) {
            st.phase = 'slide'; st.slideT = 0; st.z = ZC; st.psi = 0; st.y = RAMP.yAt(run.x);
            st.vx = 0; st.vz = 0; st.pitch = car.pitch; st.roll = 0;
          }
        }
        run.lines(0);
      } else if (si === 4) {
        if (st.phase === 'slide') {
          st.slideT += dt;
          const t = st.slideT;
          st.vx = -5.5 * t; st.vz = 10 * t;
          st.psi = Math.min(1.2, st.psi + (0.35 + 0.7 * t) * dt);
          run.x += st.vx * dt; st.z += st.vz * dt;
          if (st.z - ZC > RAMP.width / 2) {
            // 坂の縁から飛び出す
            st.phase = 'air';
            st.vy = (RAMP.yAt(run.x + 1) - RAMP.yAt(run.x - 1)) / 2 * st.vx;
          } else {
            st.y = RAMP.yAt(run.x);
            const slope = (RAMP.yAt(run.x + 1) - RAMP.yAt(run.x - 1)) / 2;
            st.pitch = Math.atan(slope * Math.cos(st.psi));
            st.roll = Math.atan(slope * Math.sin(st.psi));
          }
          // 路面をこする火花
          car.toWorld(0.8, 0.1, 1.0, tmpB);
          if (Math.random() < 0.7) rt.fx.spark(tmpB, 2, 6, 0xffc060, undefined, 1);
          if (Math.random() < 0.5) rt.fx.dust(tmpB, 1, 1, 0x8a8478, 1.2, 1.2);
          placeFree(dt, Math.abs(st.vx));
        } else if (st.phase === 'air') {
          st.slideT += dt;
          st.vy -= GRAV * dt;
          st.vz += 6 * dt;
          run.x += st.vx * dt; st.z += st.vz * dt; st.y += st.vy * dt;
          st.psi = Math.min(1.35, st.psi + 0.5 * dt);
          st.roll += 0.5 * dt;
          st.pitch += (0.15 - st.pitch) * Math.min(1, 2 * dt);
          const reach = Math.abs(Math.sin(st.psi)) * car.m.halfLen + Math.abs(Math.cos(st.psi)) * car.m.halfWid;
          if (st.z + reach >= wallZ) crash();
          else if (st.y <= 0) settle();
          placeFree(dt, Math.hypot(st.vx, st.vz));
        } else if (st.phase === 'crashed') {
          st.crashReal += rdt;
          // 壁をずり落ちて地面へ。傾きは少し残る
          if (!st.landed) {
            st.vy -= GRAV * 1.4 * dt;
            st.y += st.vy * dt;
            st.vz *= Math.exp(-3 * dt);
            st.z += st.vz * dt;
            run.x += st.vx * dt;
            st.roll += (0.22 - st.roll) * Math.min(1, 2 * dt);
            if (st.y <= 0) {
              st.y = 0; st.landed = true; st.vy = 0;
              rt.shake(0.5);
              tmp.set(run.x, 0.3, st.z);
              rt.fx.dust(tmp, 10, 5, 0x9c9486, 1.6, 1.8);
            }
          }
          if (st.z + car.m.halfWid > wallZ + 0.1) st.z = wallZ - car.m.halfWid - 0.1;
          placeFree(dt, 0);
          if (Math.random() < 0.4) rt.fx.dust(tmpC.set(run.x, st.y + 0.8, st.z), 1, 2, 0x55585e, 1.6, 2.0);
        }
        run.lines(0);
      } else {
        st.s6 += rdt;
        placeFree(dt, 0);
        if (st.s6 > 1.95 && !st.fading) { st.fading = true; rt.fadeTo(1, 0.7); }
        if (st.s6 > 2.6) st.finished = true;
        run.lines(0);
      }
      run.updateDebris(dt);
      finish();
    },
    complete() {
      st.maxX = Math.max(st.maxX, STALL.climbX);
      if (st.phase !== 'crashed') {
        // 壁にぶつかった状態へ確定
        run.x = Math.min(run.x, 1632) - 6; st.z = wallZ - 2.3; st.psi = 1.2;
        st.phase = 'crashed'; st.landed = true;
      }
      car.squash = 0.86;
      settle();
      st.finished = true;
      finish();
    },
    dispose() { run.dispose(); },
  };
}
