// ムービー単体モード（?movie=special）：目の前に敵を並べ、ゲージ満タンで必殺技を自動で撃つ。終わったら「ムービー終了」画面。
// 手前に弱い敵を並べ、いちばん奥に頑丈な敵（狙われる）。強化は最大にして、貫通で全員が倒れるところまで見せる。
import * as THREE from 'three';
import { SPECIAL } from '../config/balance';
import type { World } from '../core/types';
import { spawnEnemy } from '../enemies/api';
import { MOVIE_START, showMovieEnd } from '../cinematic/movieMode';
import { startSpecial } from './special';

/** 狙う敵（頑丈）を先頭に、手前から弱い敵を並べる：[種類, プレイヤーからの距離, 横ずれ, 高さ] */
const LINE: [Parameters<typeof spawnEnemy>[1], number, number, number][] = [
  ['crawler', 9, 0.1, 0], ['drone', 11.5, -0.2, 1.4], ['gunner', 14, 0.15, 0], ['walker', 16.5, -0.1, 0], ['heavy', 20, 0, 0],
];

interface MovieState { t: number; started: boolean }

/** 毎フレーム呼ぶ。最初の1回で敵を並べてゲージを満タンにし、少し待ってから撃つ */
export function updateSpecialMovie(world: World, dt: number): void {
  const d = world.level.data;
  if (!d.specialMovie) {
    d.specialMovie = { t: 0, started: false } as MovieState;
    world.special.gauge = SPECIAL.max;
    world.upgrades['skill.special'] = 5;
    const p = world.player;
    const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    d.specialMovieTarget = null;
    for (const [kind, dist, side, up] of LINE) {
      const pos = p.pos.clone().addScaledVector(fwd, dist).addScaledVector(right, side);
      pos.y += 0.9 + up;
      const e = spawnEnemy(world, kind, pos);
      if (kind === 'heavy') d.specialMovieTarget = e;
    }
  }
  const m = d.specialMovie as MovieState;
  if (m.started) return;
  m.t += dt;
  if (m.t < 0.8) return;
  m.started = true;
  startSpecial(world, {
    force: true,
    target: d.specialMovieTarget ?? undefined,
    skippable: true,
    onEnd: () => {
      d.movieEnded = true;
      d.movieReplay = () => { d.nextLevel = { level: MOVIE_START.special.level, startAt: MOVIE_START.special.start }; };
      showMovieEnd(d.movieReplay as () => void, world);
    },
  });
}
