// カットシーンの確認: CHROME_EXE=... node tests/e2e/cutscene_check.mjs   （ポート 5333）
// ステージ・車は別担当の本物があればそれを使い、無ければ簡易の街（cinematic/standins.ts）＋本物の車モデルで撮る。
// 成功・失敗の全ショットの中ほど、スローの柵破り、壁の凹み、死亡画面を撮る。出力: tests/e2e/out/cutscene_*.png
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';

const port = Number(process.env.PORT ?? 5333);
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const exe = process.env.CHROME_EXE ?? '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// Google Fonts を待つとスクショが固まる
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_') && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const PART = process.env.PART ?? 'all'; // success / fail / death / all
const want = (n) => PART === 'all' || PART === n;
const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, info === undefined ? '' : JSON.stringify(info)); };

const shot = async (name, wait = 900) => {
  await page.evaluate(() => window.__game.render());
  await page.waitForTimeout(wait); // 黒帯の CSS トランジション（壁時計）が落ち着くのを待つ
  await page.evaluate(() => window.__game.render());
  await page.screenshot({ path: `${outDir}/cutscene_${name}.png`, timeout: 280000 });
  console.log('shot', name);
};

try {
  await page.goto(`http://localhost:${port}/?level=surge&start=drive&manual`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  await page.addStyleTag({ content: '*, *::before, *::after { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }' });
  await page.evaluate(() => { window.__game.start(); });

  // ---- 舞台と車を用意する（本物があればそれを使う）
  const setup = await page.evaluate(async () => {
    const g = window.__game;
    const w = g.current;
    const THREE = g.THREE;
    const cin = {
      standins: await import('/src/cinematic/standins.ts'),
      seq: await import('/src/cinematic/sequencer.ts'),
      success: await import('/src/cinematic/success.ts'),
      fail: await import('/src/cinematic/fail.ts'),
      car: await import('/src/vehicle/carModel.ts'),
      layout: await import('/src/level/surge/layout.ts'),
    };
    window.__cin = cin;
    const real = !!w.level.data.surge?.wall;
    if (!real) cin.standins.buildDemoStage(w);
    w.player.root.visible = false;
    let drive = w.level.data.drive;
    const realCar = !!drive;
    if (!drive) {
      const car = cin.car.buildCar();
      car.setEngine(true);
      w.scene.add(car.root);
      drive = { phase: 'driving', car, pos: new THREE.Vector3(-1380, 0, cin.layout.ROAD.junctionZ), yaw: Math.PI / 2, speed: 330 / 3.6, result: 'none' };
      w.level.data.drive = drive;
    }
    return { real, realCar };
  });
  console.log('stage', setup);

  /** 実時間 1/60 ずつ進めて render。cond が true になったら止める */
  const advance = (cond, maxSec = 30) => page.evaluate(([cond, maxSec]) => {
    const h = window.__h, w = window.__game.current;
    const f = new Function('h', 'p', `return (${cond});`);
    let t = 0;
    while (!h.done && !f(h, window.__probe) && t < maxSec) { h.update(w, 1 / 60); t += 1 / 60; }
    return { t, done: h.done, shot: h.shotName, idx: h.shotIndex, scale: h.timeScale };
  }, [cond, maxSec]);

  const start = (kind, speedKmh) => page.evaluate(([kind, speedKmh]) => {
    const g = window.__game, w = g.current, cin = window.__cin;
    const drive = w.level.data.drive;
    drive.speed = speedKmh / 3.6;
    drive.pos.set(-1380, 0, cin.layout.ROAD.junctionZ);
    window.__probe = kind === 'success'
      ? { fenceBroken: false, crashed: false, d: 0, carX: 0, carSpeed: 0, dented: 0, flying: 0 }
      : { heavies: 0, caught: false, stopped: false, carX: 0, carSpeed: 0, pushed: 0 };
    window.__ev = [];
    for (const n of ['fenceBreak', 'carWallCrash', 'carCaught', 'slowmo']) g.events.on(n, (p) => window.__ev.push(n + (p && 'on' in p ? `:${p.on}` : '')));
    window.__done = 0;
    const fac = kind === 'success' ? (rt) => cin.success.successScript(rt, drive, window.__probe) : (rt) => cin.fail.failScript(rt, drive, window.__probe);
    window.__h = new cin.seq.Cutscene(w, fac, () => { window.__done++; });
    return window.__h.shotNames;
  }, [kind, speedKmh]);

  // ================= 成功 =================
  if (want('success')) {
  const names = await start('success', 330);
  check('成功: 6ショット', names.length === 6, names);
  let hudCls = await page.evaluate(() => document.getElementById('hud').className);
  const shotMid = ['01_front34', '02_roadside', '03_incar', '04_wide', '05_face'];
  const frac = [0.5, 0.3, 0.5, 0.6, 0.55];
  for (let i = 0; i < 5; i++) {
    await advance(`h.shotIndex === ${i} && h.shotTime >= h.shotDuration * ${frac[i]}`);
    await shot('success_' + shotMid[i]);
    if (i === 1) {
      await advance('h.shotIndex === 1 && h.shotTime >= h.shotDuration * 0.5');
      await shot('success_02b_roadside_pass', 300);
    }
  }
  hudCls = await page.evaluate(() => document.getElementById('hud').className);
  check('演出中は #hud に cutscene クラス', hudCls.includes('cutscene'), hudCls);
  // ⑥ 進入（まだ等倍）→ スロー中の柵破り
  await advance('h.shotIndex === 5 && p.d < 22');
  await shot('success_06a_approach', 400);
  await advance('h.shotIndex === 5 && p.d < 2.5');
  await shot('success_06b_slow_before', 400);
  await advance('p.fenceBroken && p.d < -0.8');
  await shot('success_06c_slow_break', 400);
  await advance('p.fenceBroken && p.d < -3.0');
  await shot('success_06d_slow_after', 400);
  await advance('p.fenceBroken && p.d < -5.5');
  await shot('success_06d2_slow_later', 400);
  const slow = await page.evaluate(() => window.__h.timeScale);
  check('柵破りはスロー（倍率 < 0.2）', slow < 0.2, slow);
  await advance('h.timeScale > 0.95 && p.d < -30');
  await shot('success_06e_fast_to_wall', 400);
  await advance('p.crashed');
  await page.evaluate(() => { window.__h.update(window.__game.current, 1 / 60); window.__h.update(window.__game.current, 1 / 60); });
  await shot('success_07a_crash_flash', 50);
  await advance('p.crashed && h.shotTime > 0', 5);
  await page.evaluate(() => { const h = window.__h, w = window.__game.current; for (let i = 0; i < 70; i++) h.update(w, 1 / 60); });
  await shot('success_07b_dent', 500);
  await advance('false', 30);
  const evS = await page.evaluate(() => ({ ev: window.__ev, done: window.__done, probe: window.__probe, hud: document.getElementById('hud').className, cs: !!document.querySelector('.cs-root') }));
  console.log(JSON.stringify(evS));
  check('成功: onDone 1回', evS.done === 1);
  check('成功: 柵・壁のイベント', evS.ev.includes('fenceBreak') && evS.ev.includes('carWallCrash'), evS.ev);
  check('成功: 壁が凹んだ', evS.probe.dented > 50, evS.probe.dented);
  await page.waitForTimeout(800);
  check('成功: 終了後に黒帯 DOM と HUD クラスが残らない', !(await page.evaluate(() => !!document.querySelector('.cs-root'))) && !evS.hud.includes('cutscene'), evS.hud);

  }
  // ================= 失敗 =================
  if (want('fail')) {
  // 成功で飛んだ柵の板はそのまま。位置・車を戻す
  await page.evaluate(() => {
    const w = window.__game.current, d = w.level.data.drive;
    d.car.root.scale.set(1, 1, 1); d.car.setDriverPose('drive');
  });
  const fnames = await start('fail', 240);
  check('失敗: 5ショット', fnames.length === 5, fnames);
  const fm = ['01_incar', '02_face', '03_pov', '04_aerial'];
  for (let i = 0; i < 4; i++) {
    await advance(`h.shotIndex === ${i} && h.shotTime >= h.shotDuration * ${i === 0 ? 0.8 : 0.6}`);
    await shot('fail_' + fm[i]);
  }
  await advance('h.shotIndex === 4 && h.shotTime > 0.1');
  await shot('fail_05a_side_before', 400);
  await advance('p.caught', 10);
  await page.evaluate(() => { const h = window.__h, w = window.__game.current; for (let i = 0; i < 9; i++) h.update(w, 1 / 60); });
  await shot('fail_05b_impact', 100);
  await advance('p.caught && h.timeScale > 0.1 && p.pushed > 0.8', 10);
  await shot('fail_05c_push', 100);
  await advance('p.stopped', 10);
  await page.evaluate(() => { const h = window.__h, w = window.__game.current; for (let i = 0; i < 30; i++) h.update(w, 1 / 60); });
  await shot('fail_05d_stopped', 100);
  await advance('false', 30);
  const evF = await page.evaluate(() => ({ ev: window.__ev.slice(-8), done: window.__done, probe: window.__probe, x: window.__game.current.level.data.drive.pos.x }));
  console.log(JSON.stringify(evF));
  check('失敗: onDone 1回', evF.done === 1);
  check('失敗: carCaught が出た', evF.ev.includes('carCaught'), evF.ev);
  check('失敗: 柵まで届かない', evF.x > -1500, evF.x);
  const leftover = await page.evaluate(() => { let n = 0; window.__game.current.scene.traverse((o) => { if (o.userData && o.userData.__heavy) n++; }); return n; });
  check('失敗: ヘビー片付け', leftover === 0);

  }
  // ================= 死亡画面 =================
  if (want('death')) {
  await page.evaluate(() => { const g = window.__game, w = g.current; w.player.hp = 0; g.step(1 / 60, 3); });
  const state = await page.evaluate(() => window.__game.current.state);
  check('hp 0 で gameover', state === 'gameover', state);
  await page.waitForTimeout(5200); // 画面のフェードイン（CSS）
  await shot('death', 300);
  const titleTxt = await page.evaluate(() => document.querySelector('.over-title')?.textContent);
  check('死亡画面は YOU DIED', titleTxt === 'YOU DIED', titleTxt);
  const btns = await page.evaluate(() => [...document.querySelectorAll('.screen-over .btn')].map((b) => b.textContent));
  check('ボタンは リトライ／終了', btns.join() === 'リトライ,終了', btns);
  }
  check('エラーなし', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  console.error('ERROR', e);
  results.push(false);
} finally {
  await browser.close();
  await server.close();
}
const ng = results.filter((r) => !r).length;
console.log(ng ? `FAILED ${ng}` : 'ALL PASS');
process.exit(ng ? 1 : 0);
