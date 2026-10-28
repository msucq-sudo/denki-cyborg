// 効果音ボード：全 SE をボタンで試聴する。ゲームと同じ EventBus → sfx.ts の経路で鳴らす
import * as THREE from 'three';
import { EventBus, type GameEvents } from '../core/events';
import { initAudio, resumeAudio, auditionLoop, auditionHeartbeat, playFootstep } from '../audio/sfx';
import type { LoopName } from '../audio/synth';

const bus = new EventBus();
initAudio(bus);

const P = (): THREE.Vector3 => new THREE.Vector3(0, 0, 0);

type Item =
  | { label: string; ev: () => void }
  | { label: string; loop: LoopName; ratio?: number };

/** イベントを発行するボタン */
function e<K extends keyof GameEvents>(label: string, name: K, payload: GameEvents[K]): Item {
  return { label, ev: () => bus.emit(name, payload) };
}
/** 敵のアクション */
function act(label: string, kind: GameEvents['enemyAction']['kind'], action: GameEvents['enemyAction']['action'], value?: number): Item {
  return e(label, 'enemyAction', { kind, pos: P(), action, value });
}
function atk(label: string, kind: GameEvents['enemyAttack']['kind']): Item {
  return e(label, 'enemyAttack', { kind, pos: P() });
}
function lp(label: string, loop: LoopName, ratio?: number): Item { return { label: `ループ: ${label}`, loop, ratio }; }

const GROUPS: Array<{ title: string; items: Item[] }> = [
  {
    title: 'プレイヤー',
    items: [
      e('ショット(タップ)', 'shot', { charged: false, power: 0 }),
      e('ショット(溜め弱)', 'shot', { charged: true, power: 0.4 }),
      e('ショット(溜め満タン)', 'shot', { charged: true, power: 1 }),
      e('溜め開始', 'chargeStart', {}),
      e('溜め完了', 'chargeFull', {}),
      e('溜めキャンセル', 'chargeCancel', {}),
      lp('溜め中', 'charge', 0.6),
      e('回避', 'dodge', {}),
      e('ジャンプ', 'jump', {}),
      e('着地', 'land', {}),
      e('飛行開始', 'flightStart', {}),
      e('飛行終了', 'flightEnd', {}),
      lp('ジェット（ホバリング）', 'flight'),
      e('ジェット不発(電力切れ)', 'flightFail', {}),
      e('被弾', 'playerHit', { amount: 10 }),
      { label: '低HPの心音', ev: () => auditionHeartbeat() },
      { label: '足音（歩き・4歩）', ev: () => { for (let i = 0; i < 4; i++) setTimeout(() => playFootstep(false), i * 600); } },
      { label: '足音（走り・6歩）', ev: () => { for (let i = 0; i < 6; i++) setTimeout(() => playFootstep(true), i * 280); } },
      e('吸収アーム発射', 'absorbFire', {}),
      e('吸収くっつく', 'absorbAttach', { pos: P() }),
      e('吸収切れる', 'absorbBreak', {}),
      e('吸収完了', 'absorbComplete', { pos: P() }),
      lp('吸収中', 'absorb'),
      e('グラップル発射(ジッ)', 'grappleFire', {}),
      e('グラップル刺さる＋引き寄せ', 'grappleAttach', { pos: P() }),
      e('グラップル到着', 'grappleArrive', { pos: P() }),
      e('逆流開始', 'overloadStart', {}),
      lp('逆流中(低)', 'overload', 0.1),
      lp('逆流中(高)', 'overload', 0.9),
      e('逆流終了', 'overloadEnd', {}),
      e('電力ローの警告', 'energyLow', {}),
      e('電力切れ', 'energyEmpty', {}),
      e('電力なし(撃てない)', 'noEnergy', {}),
      e('機能ON', 'functionToggle', { name: 'autoAim', on: true }),
      e('機能OFF', 'functionToggle', { name: 'autoAim', on: false }),
      e('充電中', 'charging', { amount: 5 }),
      e('修理キット', 'repair', { amount: 20 }),
      e('充電ポイント(空)', 'padEmpty', {}),
    ],
  },
  {
    title: '敵',
    items: [
      e('弾が当たる', 'impact', { pos: P(), owner: 'player' }),
      e('命中', 'enemyHit', { pos: P(), weak: false, damage: 5 }),
      e('弱点命中', 'enemyHit', { pos: P(), weak: true, damage: 10 }),
      e('撃破(ショット)', 'enemyKilled', { kind: 'drone', pos: P(), how: 'shot' }),
      e('撃破(吸収)', 'enemyKilled', { kind: 'drone', pos: P(), how: 'absorb' }),
      e('撃破(爆発)', 'enemyKilled', { kind: 'drone', pos: P(), how: 'explosion' }),
      e('爆発', 'explosion', { pos: P(), radius: 6 }),
      e('気づいた！', 'enemyNotice', { kind: 'gunner', pos: P() }),
      e('休眠:予兆(ポッド)', 'enemyWakeWarn', { pos: P(), mode: 'pod' }),
      e('休眠:予兆(天井)', 'enemyWakeWarn', { pos: P(), mode: 'drop' }),
      e('休眠:飛び出し(ポッド)', 'enemyEmerge', { kind: 'walker', pos: P(), mode: 'pod' }),
      e('休眠:落下(天井)', 'enemyEmerge', { kind: 'drone', pos: P(), mode: 'drop' }),
      atk('ドローン攻撃', 'drone'),
      atk('クローラー攻撃', 'crawler'),
      act('クローラー回避', 'crawler', 'crawlerDodge'),
      atk('ガンナー攻撃', 'gunner'),
      atk('ヘビー攻撃', 'heavy'),
      atk('ウォーカー砲撃', 'walker'),
      act('ヘビーW:踏みつけ溜め', 'heavyWalker', 'stompWindup', 1),
      act('ヘビーW:踏みつけ電撃', 'heavyWalker', 'stomp'),
      act('ヘビーW:突進開始', 'heavyWalker', 'chargeStart'),
      act('ヘビーW:壁激突スタン', 'heavyWalker', 'wallCrash'),
      act('ミサイル:護衛召喚', 'missile', 'summon'),
      act('ミサイル:装填(低)', 'missile', 'missileLoad', 0.2),
      act('ミサイル:装填(高)', 'missile', 'missileLoad', 0.75),
      act('ミサイル:警告ビープ', 'missile', 'missileBeep', 0.95),
      act('ミサイル:溜め妨害', 'missile', 'missileDisrupt'),
      atk('ミサイル発射(1発)', 'missile'),
      e('ミサイル撃ち落とし', 'missileDown', { pos: P() }),
      e('ミサイル着弾爆発', 'missileBlast', { pos: P() }),
      e('ビーマー:溜め', 'beamCharge', { pos: P() }),
      e('ビーマー:発射', 'beamFire', { pos: P() }),
      e('ビーマー:溜め中断', 'beamInterrupt', { pos: P() }),
      e('リーチ:アーム発射', 'leechFire', { pos: P() }),
      e('リーチ:吸われる', 'leechAttach', { pos: P() }),
      e('リーチ:外れる', 'leechBreak', {}),
      e('リーチ:逃げる', 'leechFlee', { pos: P() }),
      act('ジャンパー:着地', 'jumper', 'jumperLand'),
      atk('ジャンパー:突き', 'jumper'),
      e('はじかれる(カキン)', 'shieldBlock', { pos: P() }),
      atk('ミサイルドローン発射', 'missileDrone'),
      atk('ボンバー:投げる', 'bomber'),
      act('ボンバー:電気爆発', 'bomber', 'bombBlast'),
      e('ハッキング開始', 'hackStart', {}),
      e('ハッキング:正解', 'hackInput', { ok: true, progress: 4 }),
      e('ハッキング:ミス', 'hackInput', { ok: false, progress: 0 }),
      e('ハッキング:中断', 'hackCancel', {}),
      e('ハッキング成功', 'hackSuccess', { pos: P() }),
      e('味方の時間切れ', 'allyExpire', { pos: P() }),
      atk('ボス攻撃', 'boss'),
      e('ボスのショート', 'bossShort', { pos: P() }),
      e('ボス登場', 'bossStart', {}),
      e('ボスフェーズ', 'bossPhase', { phase: 2 }),
    ],
  },
  {
    title: 'ギミック',
    items: [
      e('歯車(強化素材)取得', 'gearPickup', {}),
      e('メタル取得（小）', 'metalPickup', { amount: 1, total: 1 }),
      e('メタル取得（大）', 'metalPickup', { amount: 5, total: 6 }),
      e('操作ヒント表示', 'interactPrompt', {}),
      e('緊急スイッチON', 'switchOn', { pos: P() }),
      e('電力復旧', 'powerRestored', { pos: P() }),
      e('エレベーター:ロック', 'elevatorLocked', { pos: P() }),
      e('エレベーター:ドア開く', 'elevatorOpen', { pos: P() }),
      e('エレベーター:乗る', 'elevatorRide', {}),
      e('敵の波(出現)', 'zoneWave', { wave: 2 }),
      e('部屋に入る', 'roomEnter', { index: 0, name: 'テスト' }),
      e('部屋クリア', 'roomClear', { index: 0 }),
      e('ドア開く', 'doorOpen', { pos: P() }),
      e('ドア閉まる', 'doorClose', { pos: P() }),
      lp('閉じ込めサイレン', 'siren', 0.5),
    ],
  },
  {
    title: 'UI',
    items: [
      e('UIクリック', 'uiClick', {}),
      e('ゲーム開始', 'gameStart', {}),
      e('ゲームオーバー', 'gameOver', {}),
      e('ゲームクリア', 'gameClear', {}),
    ],
  },
];

const root = document.getElementById('root')!;
const loopOn: Partial<Record<LoopName, boolean>> = {};

for (const g of GROUPS) {
  const h = document.createElement('h2');
  h.textContent = g.title;
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const it of g.items) {
    const b = document.createElement('button');
    b.textContent = it.label;
    b.addEventListener('click', () => {
      resumeAudio();
      if ('ev' in it) {
        it.ev();
      } else {
        const on = !loopOn[it.loop];
        // 同じ種類のループは1つだけ（他のボタンの表示も更新）
        loopOn[it.loop] = on;
        auditionLoop(it.loop, on, it.ratio ?? 0.5);
        for (const o of grid.parentElement!.querySelectorAll<HTMLButtonElement>('button[data-loop="' + it.loop + '"]')) o.classList.remove('on');
        if (on) b.classList.add('on');
      }
    });
    if ('loop' in it) b.dataset.loop = it.loop;
    grid.appendChild(b);
  }
  root.append(h, grid);
}
