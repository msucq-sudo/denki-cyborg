// 使い方: node tests/e2e/audio.mjs [出力PNG] [ポート]
// ヘッドレスでは音は聞けないため、window.__audioDebug（発音を許可された SE 名・回数・継続音の状態）で確認する。
// 1) 全イベントを __game.events.emit で発火 → 各SEが発音許可されたか
// 2) 継続音：world の値を書き換えて開始/停止を確認
// 3) コンソールエラーが無いこと
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const out = process.argv[2] ?? 'tests/e2e/out/audio_check.png';
const port = Number(process.argv[3] ?? 5206);
fs.mkdirSync(out.split('/').slice(0, -1).join('/') || '.', { recursive: true });

const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => {
  server.stdout.on('data', (d) => { if (String(d).includes('Local')) res(); });
  setTimeout(res, 8000);
});

const exe = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

// 全イベントと、その発火に使うペイロード。SE 名は event 名と同じ（enemyKilled など一部は同名）
const EVENTS = [
  ['shot', { charged: false, power: 0 }],
  ['shot', { charged: true, power: 0.5 }],
  ['chargeStart', {}],
  ['chargeFull', {}],
  ['chargeCancel', {}],
  ['dodge', {}],
  ['jump', {}],
  ['land', {}],
  ['flightStart', {}],
  ['flightEnd', {}],
  ['impact', { owner: 'player' }],
  ['enemyHit', { weak: false, damage: 6 }],
  ['enemyHit', { weak: true, damage: 12 }],
  ['enemyKilled', { kind: 'drone', how: 'shot' }],
  ['enemyKilled', { kind: 'crawler', how: 'absorb' }],
  ['enemyKilled', { kind: 'gunner', how: 'explosion' }],
  ['enemyAttack', { kind: 'drone' }],
  ['enemyAttack', { kind: 'crawler' }],
  ['enemyAttack', { kind: 'gunner' }],
  ['enemyAttack', { kind: 'heavy' }],
  ['enemyAttack', { kind: 'boss' }],
  ['playerHit', { amount: 6 }],
  ['absorbFire', {}],
  ['absorbAttach', {}],
  ['absorbBreak', {}],
  ['absorbComplete', {}],
  ['overloadStart', {}],
  ['overloadEnd', {}],
  ['explosion', { radius: 6 }],
  ['bossShort', {}],
  ['functionToggle', { name: 'scouter', on: true }],
  ['functionToggle', { name: 'scouter', on: false }],
  ['energyLow', {}],
  ['energyEmpty', {}],
  ['noEnergy', {}],
  ['charging', { amount: 5 }],
  ['repair', { amount: 40 }],
  ['roomEnter', { index: 1, name: 'test' }],
  ['roomClear', { index: 1 }],
  ['doorOpen', {}],
  ['bossStart', {}],
  ['bossPhase', { phase: 2 }],
  ['gameStart', {}],
  ['gameOver', {}],
  ['gameClear', {}],
  ['uiClick', {}],
];

const SE_NAMES = [...new Set(EVENTS.map(([n]) => n))];

try {
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  // 1) 全イベントを発火し、SE が発音許可されたか
  const sfxResult = await page.evaluate((events) => {
    const g = window.__game;
    const dbg = window.__audioDebug;
    const V = g.THREE.Vector3;
    const before = {};
    for (const [n] of events) before[n] = dbg.played[n] ?? 0;
    const log = [];
    for (const [name, payload] of events) {
      const p = { ...payload };
      if (name === 'impact' || name === 'enemyHit' || name === 'enemyKilled' || name === 'enemyAttack'
          || name === 'absorbAttach' || name === 'absorbComplete' || name === 'explosion' || name === 'bossShort' || name === 'doorOpen') {
        p.pos = new V(0, 0, 0);
      }
      g.events.emit(name, p);
      g.step(1 / 60, 1);
      log.push(name);
    }
    return { before, afterCount: Object.fromEntries(Object.keys(before).map((k) => [k, dbg.played[k] ?? 0])), last: dbg.lastSfx, ctxState: dbg.ctxState, lastError: dbg.lastError };
  }, EVENTS);

  // 時間を空けて再発火（間引きで捨てられないことの確認）
  await page.waitForTimeout(400);

  // 2) 開始・停止
  await page.evaluate(() => window.__game.start());
  // 継続音は world の値から updateAudio を直接呼んで確認する（step() では各モジュールが値を上書きするため）
  const loopCheck = await page.evaluate(async () => {
    const g = window.__game;
    const w = g.world;
    const dbg = window.__audioDebug;
    // 開発サーバー上の同じモジュールインスタンスを読む（main.ts と同一 URL）
    const { updateAudio } = await import('/src/audio/sfx.ts');
    const tick = (n = 2) => { for (let i = 0; i < n; i++) updateAudio(w, 1 / 60); };
    const snap = () => ({ ...dbg.loops });
    const res = {};
    tick();
    res.idle = snap();

    // 吸収中
    w.absorb.phase = 'attached';
    w.absorb.target = w.enemies[0] ?? null;
    tick();
    res.absorb = snap();
    // 逆流に切り替わると吸収ハムは止まり、逆流ループが鳴る
    w.player.overloading = true;
    if (w.enemies[0]) w.enemies[0].overload = (w.enemies[0].overload ?? 0) + 5;
    tick();
    res.overload = snap();
    w.player.overloading = false;
    w.absorb.phase = 'idle';
    w.absorb.target = null;

    // 飛行・溜め・スカウター
    w.player.flying = true;
    w.player.charging = true;
    w.player.charge = 0.6;
    w.functions.scouter = true;
    tick();
    res.flightChargeScouter = snap();
    w.player.flying = false;
    w.player.charging = false;
    w.functions.scouter = false;
    tick();
    res.afterOff = snap();

    // 電力25%以下の警告：2秒おきに発火（2.5秒間で1回）
    const beepsBefore = dbg.lowPowerBeeps;
    w.player.energy = w.player.maxEnergy * 0.2;
    tick(150);
    res.lowPowerBeeps = dbg.lowPowerBeeps - beepsBefore;
    w.player.energy = w.player.maxEnergy;

    // 継続音はポーズ中に止まる
    w.absorb.phase = 'attached';
    tick();
    res.beforePause = snap();
    w.state = 'paused';
    tick();
    res.paused = snap();
    w.state = 'playing';
    w.absorb.phase = 'idle';
    tick();
    res.resumedIdle = snap();
    return res;
  });

  // 3) 再発火の間引きを確認するため、enemyHit を連打
  const hitBurst = await page.evaluate(() => {
    const g = window.__game;
    const dbg = window.__audioDebug;
    const V = g.THREE.Vector3;
    const beforePlayed = dbg.played.enemyHit ?? 0;
    const beforeSup = dbg.suppressed.enemyHit ?? 0;
    // 同一フレーム内の連打（実時間がほぼ進まない）→ 30ms 間引きで大半が捨てられる
    for (let i = 0; i < 10; i++) g.events.emit('enemyHit', { pos: new V(), weak: false, damage: 1 });
    return { played: (dbg.played.enemyHit ?? 0) - beforePlayed, suppressed: (dbg.suppressed.enemyHit ?? 0) - beforeSup };
  });

  await page.waitForTimeout(300);
  try {
    await page.screenshot({ path: out, timeout: 60000 });
  } catch (e) {
    console.log('SCREENSHOT_SKIPPED', String(e).split('\n')[0]);
  }

  const pass = {
    // 同じ実時間内に連続発火するため間引きが入る SE もあるので、名前ごとに 1 回以上発音されたことを確認
    allSfxAccepted: SE_NAMES.every((n) => {
      const delta = (sfxResult.afterCount[n] ?? 0) - (sfxResult.before[n] ?? 0);
      return delta >= 1;
    }),
    contextAvailable: sfxResult.ctxState !== 'none',
    noSfxError: !sfxResult.lastError,
    loopsOn: loopCheck.absorb.absorb === true && loopCheck.overload.overload === true
      && loopCheck.flightChargeScouter.flight === true && loopCheck.flightChargeScouter.charge === true
      && loopCheck.flightChargeScouter.scouter === true,
    loopsExclusive: loopCheck.overload.absorb === false,
    loopsOffAfter: Object.values(loopCheck.afterOff).every((v) => v === false),
    lowPowerBeeps: loopCheck.lowPowerBeeps === 1,
    loopsStopOnPause: Object.values(loopCheck.paused).every((v) => v === false),
    enemyHitThrottled: hitBurst.played >= 1 && hitBurst.suppressed >= 1,
  };
  const ok = Object.values(pass).every(Boolean);
  console.log('SFX', JSON.stringify({ ctxState: sfxResult.ctxState, last: sfxResult.last, lastError: sfxResult.lastError }));
  console.log('LOOPS', JSON.stringify(loopCheck));
  console.log('HITBURST', JSON.stringify(hitBurst));
  console.log('PASS', JSON.stringify(pass), ok ? 'ALL OK' : 'FAILED');
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  if (!ok) process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
