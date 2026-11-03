// ルート2（ドレイン装置へ）の成功の演出：判定地点 E を 300km/h 以上で越えた → 坂を駆け上がり、扉を突き破って装置の中へ。
// ①後ろ斜め（遠ざかる）②車内（背中ごし）③後ろ上の斜め（坂へ）④真横（登る）⑤正面のライアンの顔（気合）⑥後ろ上（扉へ）
// ⑦扉の真横：スロー → 衝突の瞬間に等倍へ戻り、扉を粉砕して車が中へ消える → 暗転
// 終わったら drive.ts の onDone が呼ばれ、level 'drain'（startAt 'entrance'）へ進む。
// ①〜⑥ は drainCommon.ts（失敗と共通）。扉の部品は world.level.data.surge.plant.parts.door / doorBroken（無くても動く）。
import * as THREE from 'three';
import type { DriveState } from '../vehicle/types';
import { DRAIN_DOOR } from '../level/surge/layout';
import type { Runtime, Script, Shot } from './sequencer';
import { DOOR_MID_Y, DrainRun, doorSideCamera, doorTimeScale, introShots, lerp, smooth, ZC } from './drainCommon';

/** テスト・確認用：いまの状態 */
export interface DrainSuccessProbe {
  carX: number;
  carY: number;
  /** 扉の前まで着いた（衝突した） */
  atDoor: boolean;
  /** 扉を突き破った */
  breached: boolean;
  /** 扉の本体（parts.door）を隠して壊れた扉に替えた */
  doorSwapped: boolean;
  /** 車が扉の面を通り抜けた */
  pastDoor: boolean;
  /** 衝突の前に、スローモーションに入った最小の倍率 */
  minScaleBeforeImpact: number;
  /** 衝突の次の更新の時間の流れ（1 = 等倍に戻った）。まだなら 0 */
  scaleAfterImpact: number;
  /** 飛んだ破片の数 */
  debris: number;
  /** 演出が最後まで進んだ（暗転した） */
  finished: boolean;
}

export function drainSuccessScript(rt: Runtime, drive: DriveState, probe?: DrainSuccessProbe): Script {
  const V = Math.min(95, Math.max(300 / 3.6, drive.speed));
  const run = new DrainRun(rt, drive, V);
  const { car } = run;
  const st = { hit: false, hitReal: 0, fading: false, finished: false, minScale: 1, scaleAfter: 0, justHit: false, drift: 0 };
  const tmp = new THREE.Vector3(), tmpB = new THREE.Vector3(), west = new THREE.Vector3(-1, 0.25, 0), east = new THREE.Vector3(1, 0.1, 0);
  const pLook = new THREE.Vector3(DRAIN_DOOR.x - 14, DRAIN_DOOR.y + 1.4, ZC);

  const finish = (): void => {
    if (!probe) return;
    probe.carX = run.x; probe.carY = car.root.position.y; probe.atDoor = st.hit; probe.breached = st.hit;
    probe.doorSwapped = run.doorHidden; probe.pastDoor = run.x - run.rear > DRAIN_DOOR.x;
    probe.minScaleBeforeImpact = st.minScale; probe.scaleAfterImpact = st.scaleAfter; probe.debris = run.debrisCount; probe.finished = st.finished;
  };

  /** 車が扉に突っ込んだ瞬間 */
  function breach(): void {
    st.hit = true; st.justHit = true;
    run.x = run.hitX;
    run.breachDoor();
    const p = new THREE.Vector3(DRAIN_DOOR.x - 0.2, DOOR_MID_Y - 1.4, ZC);
    rt.world.events.emit('fenceBreak', { pos: p.clone() });
    rt.world.events.emit('carWallCrash', { pos: p.clone() });
    run.spawnDoorDebris(26, 0.4);
    rt.fx.flash(p, 22, 0xfff0c0, 0.5);
    rt.fx.flash(p.clone().setX(p.x - 3), 12, 0xffffff, 0.3);
    rt.fx.spark(p, 140, 34, 0xffc060, west, 1.7);
    rt.fx.spark(p, 70, 22, 0xffffff, east, 1.8);
    rt.fx.chunks(p, 60, 24, west, 0.12, 0.7, 1.7);
    rt.fx.dust(p.clone().setY(p.y - 1), 14, 8, 0x8a8f98, 2.0, 2.0);
    run.shockwave(p);
    rt.shake(1);
    rt.flash(0.95);
    run.speed = V * 0.8;
  }

  const shots: Shot[] = [
    ...introShots(run),
    // ⑦ 扉の真横：スロー → 衝突で等倍 → 突き破って中へ
    {
      name: '扉の真横（スロー→突破）', duration: 9,
      shake: 0.12,
      enter() {
        run.x = run.hitX - 72; run.speed = V; rt.speedLines = 0.15;
        drive.car.setDriverPose('push');
        run.place(0);
      },
      timeScale: () => doorTimeScale(run, st.hit),
      end: () => st.finished,
      camera(u, _t, pose, dt) {
        // 車を目で追う。衝突のあとは扉の穴を見る
        tmp.set(st.hit ? DRAIN_DOOR.x - 3 : Math.min(run.x + 1.2, DRAIN_DOOR.x - 4), DOOR_MID_Y - 1.8, ZC);
        pLook.lerp(tmp, 1 - Math.exp(-(st.hit ? 3 : 7) * dt));
        doorSideCamera(run, pose, 0, 0);
        pose.target.copy(pLook);
        pose.fov = st.hit ? lerp(38, 34, smooth(st.hitReal / 1.6)) : 42;
        void u;
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
      } else {
        if (st.justHit) { st.scaleAfter = rdt > 0 ? dt / rdt : 1; st.justHit = false; }
        if (!st.hit) {
          st.minScale = Math.min(st.minScale, rdt > 0 ? dt / rdt : 1);
          run.x += V * dt;
          if (run.dDoor() < 14) drive.car.setDriverPose('brace');
          if (run.dDoor() <= 0) breach();
        } else {
          st.hitReal += rdt;
          // 突き抜けて装置の中へ。車体が扉の面を抜けたら見えなくなる
          run.x += run.speed * dt;
          run.speed *= Math.exp(-0.5 * dt);
          if (run.x - run.rear > DRAIN_DOOR.x + 0.3) run.carHidden = true;
          // 扉の穴からくすぶる煙と火花
          if (Math.random() < 0.5) rt.fx.dust(tmpB.set(DRAIN_DOOR.x - 0.6, DRAIN_DOOR.y + 0.6 + Math.random() * 5, ZC + (Math.random() - 0.5) * 8), 1, 3, 0x6b6f78, 1.6, 1.8);
          if (Math.random() < 0.3) rt.fx.spark(tmpB.set(DRAIN_DOOR.x - 0.4, DRAIN_DOOR.y + Math.random() * 6, ZC + (Math.random() - 0.5) * 9), 2, 7, 0xffc060, west, 1);
          if (st.hitReal > 1.45 && !st.fading) { st.fading = true; rt.fadeTo(1, 0.75); }
          if (st.hitReal > 2.3) st.finished = true;
        }
        run.place(dt, st.hit ? run.speed : V);
        run.lines(st.hit ? 0 : rt.speedLines);
      }
      run.updateDebris(dt);
      finish();
    },
    complete() {
      if (!st.hit) { st.hit = true; run.breachDoor(); run.spawnDoorDebris(26, 0.4); }
      run.x = DRAIN_DOOR.x + run.rear + 6; run.carHidden = true;
      st.finished = true;
      run.place(0);
      run.settleDebris();
      finish();
    },
    dispose() { run.dispose(); },
  };
}


