import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createWorld } from '../core/world';
import { EventBus } from '../core/events';
import type { World } from '../core/types';
import { ENEMIES, SPECIAL, SPECIAL_UPGRADE } from '../config/balance';
import { makeAABB } from '../core/collision';
import { spawnEnemy, damageEnemy } from '../enemies/enemies';
import {
  addGauge, consumeGauge, gainFromAbsorb, gainFromDamage, gainFromKill, isFull, pickTarget, pierceDamage, pierceTargets,
  segmentFills, targetDamage,
} from './logic';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mk(): World {
  const w = createWorld({} as any, new EventBus(), 1);
  w.state = 'playing';
  w.player.pos.set(0, 0, 0);
  w.colliders.push(makeAABB(V(-80, -1, -80), V(80, 0, 80), 'floor'));
  return w;
}
const eye = V(0, 1.4, 0);

describe('ゲージ', () => {
  it('3分割でたまり、満タンで isFull。使うと 0', () => {
    const w = mk();
    expect(segmentFills(0)).toEqual([0, 0, 0]);
    const seg = SPECIAL.max / SPECIAL.segments;
    expect(segmentFills(seg * 1.5).map((x) => +x.toFixed(2))).toEqual([1, 0.5, 0]);
    expect(isFull(w)).toBe(false);
    w.special.gauge = SPECIAL.max;
    expect(isFull(w)).toBe(true);
    consumeGauge(w);
    expect(w.special.gauge).toBe(0);
  });

  it('弱点に当てると同じダメージでも多くたまる', () => {
    const a = mk(), b = mk();
    gainFromDamage(a, 20);
    gainFromDamage(b, 20, true);
    expect(b.special.gauge).toBeCloseTo(a.special.gauge * SPECIAL.gainWeakMul);
  });

  it('ダメージ・撃破・吸収でたまり、上限で止まる', () => {
    const w = mk();
    gainFromDamage(w, 100);
    expect(w.special.gauge).toBeCloseTo(100 * SPECIAL.gainPerDamage);
    gainFromKill(w);
    expect(w.special.gauge).toBeCloseTo(100 * SPECIAL.gainPerDamage + SPECIAL.gainPerKill);
    gainFromAbsorb(w);                     // 最初の呼び出しは基準を取るだけ
    w.stats.energyAbsorbed += 40;
    gainFromAbsorb(w);
    expect(w.special.gauge).toBeCloseTo(100 * SPECIAL.gainPerDamage + SPECIAL.gainPerKill + 40 * SPECIAL.gainPerAbsorb);
    addGauge(w, 99999);
    expect(w.special.gauge).toBe(SPECIAL.max);
  });

  it('2〜3回の通常戦闘でほぼ満タンになる（雑魚5体＋吸収の目安）', () => {
    const w = mk();
    const fight = (): void => {
      for (const k of ['drone', 'crawler', 'gunner', 'walker', 'walker'] as const) { gainFromDamage(w, ENEMIES[k].hp); gainFromKill(w); }
      gainFromAbsorb(w); w.stats.energyAbsorbed += 60; gainFromAbsorb(w);
    };
    fight();
    expect(isFull(w)).toBe(false);
    fight(); fight();
    expect(isFull(w)).toBe(true);
  });

  it('演出中・ミュート中はたまらない。強化でたまりやすくなる', () => {
    const w = mk();
    w.special.phase = 'charge';
    expect(addGauge(w, 10)).toBe(0);
    w.special.phase = 'idle';
    w.special.muteGain = true;
    expect(addGauge(w, 10)).toBe(0);
    w.special.muteGain = false;
    w.upgrades['skill.special'] = 5;
    expect(addGauge(w, 10)).toBeCloseTo(10 * SPECIAL_UPGRADE.gaugeMul[4] / 100);
  });
});

describe('狙う敵', () => {
  it('射程内で視線が通る敵のうち、いまHPが最も高い敵', () => {
    const w = mk();
    spawnEnemy(w, 'drone', V(0, 1, -10));
    const heavy = spawnEnemy(w, 'heavy', V(3, 1, -20));
    spawnEnemy(w, 'gunner', V(-4, 1, -15));
    expect(pickTarget(w, eye)).toBe(heavy);
    // HPが減ればほかの敵が最大になる（現在HPで比べる）
    heavy.hp = 20;
    expect(pickTarget(w, eye)?.kind).toBe('gunner');
  });

  it('射程外・壁の向こう・味方・倒れた敵は狙わない。誰もいなければ null', () => {
    const w = mk();
    expect(pickTarget(w, eye)).toBeNull();
    const far = spawnEnemy(w, 'heavy', V(0, 1, -SPECIAL.range - 5));
    expect(pickTarget(w, eye)).toBeNull();
    far.pos.set(0, 1, -20);
    expect(pickTarget(w, eye)).toBe(far);
    w.colliders.push(makeAABB(V(-5, 0, -12), V(5, 6, -11), 'wall'));
    expect(pickTarget(w, eye)).toBeNull();
    w.colliders[w.colliders.length - 1].active = false;
    far.allied = true;
    expect(pickTarget(w, eye)).toBeNull();
    far.allied = false;
    far.status = 'down';
    expect(pickTarget(w, eye)).toBeNull();
  });
});

describe('貫通', () => {
  it('ビームの線上（太さ内）の敵だけが当たる。狙った敵・後ろの敵・横の敵は別', () => {
    const w = mk();
    const target = spawnEnemy(w, 'heavy', V(0, 1.4, -15));
    const onLine = spawnEnemy(w, 'walker', V(0.5, 1.4, -8));
    const beyond = spawnEnemy(w, 'drone', V(0, 1.4, -25));       // 狙いの先（余分に伸びる分）
    const behindPlayer = spawnEnemy(w, 'crawler', V(0, 1.4, 6));
    const aside = spawnEnemy(w, 'gunner', V(8, 1.4, -10));
    const hits = pierceTargets(w, eye, target, SPECIAL.beamRadius);
    expect(hits).toContain(onLine);
    expect(hits).toContain(beyond);
    expect(hits).not.toContain(target);
    expect(hits).not.toContain(behindPlayer);
    expect(hits).not.toContain(aside);
    // 太さが増えると横の敵も巻き込む
    expect(pierceTargets(w, eye, target, 9)).toContain(aside);
  });

  it('壁の向こうの敵は貫通しない', () => {
    const w = mk();
    const target = spawnEnemy(w, 'heavy', V(0, 1.4, -15));
    const hidden = spawnEnemy(w, 'walker', V(0, 1.4, -8));
    w.colliders.push(makeAABB(V(-3, 0, -6), V(3, 6, -5), 'wall'));
    expect(pierceTargets(w, eye, target, SPECIAL.beamRadius)).not.toContain(hidden);
  });
});

describe('ダメージ量', () => {
  it('通常の敵は即死、貫通はLv1で最大HPの60%、強化で上がる', () => {
    const w = mk();
    const g = spawnEnemy(w, 'gunner', V(0, 1, -10));
    expect(targetDamage(w, g)).toBeGreaterThanOrEqual(g.hp);
    expect(pierceDamage(w, g)).toBeCloseTo(g.maxHp * 0.6);
    w.upgrades['skill.special'] = 5;
    expect(pierceDamage(w, g)).toBeCloseTo(g.maxHp);
  });

  it('ボスは最大HPの25%まで（Lv1）。強化で割合が増え、即死はしない', () => {
    const w = mk();
    const boss = spawnEnemy(w, 'boss', V(0, 2, -20));
    expect(targetDamage(w, boss)).toBeCloseTo(boss.maxHp * 0.25);
    damageEnemy(w, boss, targetDamage(w, boss), { how: 'explosion' });
    expect(boss.hp).toBeCloseTo(boss.maxHp * 0.75);
    expect(boss.status).not.toBe('dead');
    w.upgrades['skill.special'] = 5;
    expect(targetDamage(w, boss)).toBeCloseTo(boss.maxHp * 0.5);
  });

  it('狙われた通常の敵は一撃で倒れる', () => {
    const w = mk();
    const h = spawnEnemy(w, 'heavy', V(0, 1, -10));
    damageEnemy(w, h, targetDamage(w, h), { how: 'explosion' });
    expect(h.hp).toBe(0);
    expect(h.status === 'dead' || h.status === 'down').toBe(true);
  });
});
