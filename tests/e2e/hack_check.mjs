// 使い方: CHROME_EXE=... node tests/e2e/hack_check.mjs   （ポート 5303）
// 赤ウォーカーにハッキング → コード入力 → 味方 → 他の敵を撃つ、の流れを撮って確認する。
// 出力: tests/e2e/out/hack_*.png
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';

const port = Number(process.env.PORT ?? 5303);
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const exe = process.env.CHROME_EXE ?? '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, info === undefined ? '' : JSON.stringify(info)); };
const run = (n, dt = 1 / 60) => page.evaluate(([n, dt]) => window.__game.step(dt, n), [n, dt]);
const shot = async (name) => {
  if (process.env.NOSHOT) return;
  await page.evaluate(() => window.__game.render());
  await page.screenshot({ path: `${outDir}/hack_${name}.png`, timeout: 280000 });
  console.log('shot', name);
};
const state = () => page.evaluate(() => {
  const w = window.__game.world, h = w.hack;
  return {
    active: h.active, progress: h.progress, device: h.device, energy: +w.player.energy.toFixed(1),
    padCapture: window.__game.input.padCapture, hacking: !!w.player.hacking, phase: w.absorb.phase,
    rw: window.RW ? { allied: !!window.RW.allied, status: window.RW.status, tethered: window.RW.tethered, allyT: window.RW.ai.allyT } : null,
    foeHp: window.FOE ? Math.round(window.FOE.hp) : null, ev: window.EV,
  };
});
/** キーを1回押す（押した瞬間を1フレームだけ見せる） */
const tap = async (code) => {
  await page.evaluate((c) => window.__game.input.simulateKey(c, true), code);
  await run(2);
  await page.evaluate((c) => window.__game.input.simulateKey(c, false), code);
  await run(2);
};

try {
  await page.goto(`http://localhost:${port}/?manual`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  // ソフトウェア描画では backdrop-filter（ぼかし）が非常に遅いので、撮影中だけ切る（見た目はほぼ同じ）
  await page.addStyleTag({ content: '*, *::before, *::after { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }' });
  await page.evaluate(async () => {
    window.__api = await import('/src/enemies/api.ts');
    const g = window.__game, w = g.world, T = g.THREE;
    g.start();
    const OX = 300;
    w.colliders.push({ min: new T.Vector3(OX - 40, -1, -40), max: new T.Vector3(OX + 40, 0, 40), active: true });
    const floor = new T.Mesh(new T.PlaneGeometry(80, 80), new T.MeshStandardMaterial({ color: 0xcfd8e3 }));
    floor.rotation.x = -Math.PI / 2; floor.position.x = OX; w.scene.add(floor);
    w.scene.add(new T.HemisphereLight(0xffffff, 0x667788, 1.6));
    const sun = new T.DirectionalLight(0xffffff, 1.5); sun.position.set(OX + 3, 8, 5); w.scene.add(sun);
    w.scene.background = new T.Color(0xbfd8f0);
    w.player.hp = w.player.maxHp = 1e6;
    w.player.energy = 60;
    w.player.pos.set(OX, 0, 0); w.player.yaw = 0; w.player.pitch = 0;
    window.OX = OX;
    window.EV = { hackStart: 0, hackCancel: 0, hackSuccess: 0, allyExpire: 0, okIn: 0, badIn: 0 };
    g.events.on('hackStart', () => window.EV.hackStart++);
    g.events.on('hackCancel', () => window.EV.hackCancel++);
    g.events.on('hackSuccess', () => window.EV.hackSuccess++);
    g.events.on('allyExpire', () => window.EV.allyExpire++);
    g.events.on('hackInput', (p) => { if (p.ok) window.EV.okIn++; else window.EV.badIn++; });
    window.RW = window.__api.spawnEnemy(w, 'redWalker', new T.Vector3(OX, 0.7, -6));
    window.RW.ai.alert = 4;
  });
  await run(30);

  // ---- 吸収アームをつなぐ（E）
  await tap('KeyE');
  await run(20);
  let s = await state();
  check('arm attached and hacking started', s.phase === 'attached' && s.active && s.hacking && s.padCapture, s);
  check('hackStart emitted once', s.ev.hackStart === 1, s.ev);
  await run(10);
  await shot('1_keyboard');

  // ---- パッド表示
  await page.evaluate(() => { window.__game.input.lastDevice = 'pad'; });
  await run(2);
  await shot('2_pad');
  s = await state();
  check('device switches to pad', s.device === 'pad', s.device);
  await page.evaluate(() => { window.__game.input.lastDevice = 'kbm'; });
  await run(2);

  // ---- 途中まで入力 → ミス
  const codeKeys = await page.evaluate(() => [...window.__game.world.hack.codeKeys]);
  const codePad = await page.evaluate(() => [...window.__game.world.hack.codePad]);
  const keys = ['KeyQ', 'KeyT', 'KeyG', 'KeyZ', 'KeyX', 'KeyV', 'KeyB', 'Digit4'];
  console.log('code', codeKeys.join(' '), '|', codePad.join(' '));
  for (let i = 0; i < 3; i++) await tap(codeKeys[i]);
  s = await state();
  check('3 correct inputs counted', s.progress === 3, s);
  await run(30);
  await shot('3_progress');
  const e0 = s.energy;
  const wrong = keys[(keys.indexOf(codeKeys[3]) + 1) % 8];
  await page.evaluate((c) => window.__game.input.simulateKey(c, true), wrong);
  await run(2);
  await page.evaluate((c) => window.__game.input.simulateKey(c, false), wrong);
  await run(2);
  check('panel shakes red on a miss (fail class)', await page.evaluate(() => document.querySelector('.hack').classList.contains('fail')));
  await shot('4_fail');
  s = await state();
  check('wrong key resets progress', s.progress === 0 && s.ev.badIn === 1, s);
  check('wrong key costs energy', s.energy < e0, { before: e0, after: s.energy });

  // ---- 入力し直し（途中はパッドのボタンで）
  for (let i = 0; i < 8; i++) {
    await tap(i % 2 ? codePad[i] : codeKeys[i]);
    if (i === 5) { await run(1); await shot('5_pad_progress'); }
  }
  s = await state();
  check('allied after the full code', s.rw?.allied === true && s.ev.hackSuccess === 1, s);
  await run(4);
  await shot('6_success');
  await run(30);
  s = await state();
  check('arm released and hack state cleared', s.phase !== 'attached' && !s.active && !s.hacking && s.rw.tethered === false, s);
  await run(30);
  s = await state();
  check('padCapture cleared after success', s.padCapture === false, s);

  // ---- 味方が別の敵を撃つ
  await page.evaluate(() => {
    const g = window.__game, w = g.world, T = g.THREE, OX = window.OX;
    window.FOE = window.__api.spawnEnemy(w, 'heavy', new T.Vector3(OX + 7, 1, -14));
    window.FOE.hp = window.FOE.maxHp = 1e6;
    w.player.pos.set(OX - 2.5, 0, 3); w.player.yaw = -0.3; w.player.pitch = 0.1;
  });
  const hp0 = (await state()).foeHp;
  if (process.env.NOSHOT) for (let i = 0; i < 6; i++) { await run(30); console.log(JSON.stringify(await page.evaluate(() => ({ rw: window.RW.pos.toArray().map((v) => +v.toFixed(1)), yaw: +window.RW.ai.yaw.toFixed(2), tgt: window.RW.ai.allyTarget?.kind ?? null, foe: window.FOE.pos.toArray().map((v) => +v.toFixed(1)), hp: window.FOE.hp, bolts: (window.RW.ai.bolts ?? []).length, atk: window.RW.ai.atkTimer })))); }
  // 弾が飛んでいる瞬間を撮る
  let flying = 0;
  for (let i = 0; i < 150 && flying === 0; i++) { await run(1); flying = await page.evaluate(() => (window.RW.ai.bolts ?? []).length); }
  await run(2);
  check('ally bolt spawned', flying > 0, flying);
  await shot('7_ally_bolt');
  await run(60);
  await shot('7_ally_attack');
  await run(60);
  s = await state();
  check('ally damages the other enemy', s.foeHp < hp0, { hp0, now: s.foeHp });
  await shot('8_ally_attack2');

  // ---- 時間切れ
  await page.evaluate(() => { window.RW.ai.allyT = 4; });
  await run(150);
  await shot('9_ally_expiring');
  await run(120);
  s = await state();
  check('ally expires (shut down, not a kill)', s.ev.allyExpire === 1 && s.rw.status !== 'active', s);
  await shot('10_expired');
} catch (e) {
  console.log('EXCEPTION', String(e));
  results.push(false);
} finally {
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  check('no console errors', errors.length === 0);
  await browser.close();
  await server.close();
  console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
}
process.exit(results.every(Boolean) ? 0 : 1);
