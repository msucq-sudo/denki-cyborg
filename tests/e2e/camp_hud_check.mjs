import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
const out = '.logs/camp-visual-2026-10-30';
fs.mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5337, strictPort: true, hmr: false }, logLevel: 'error' });
await server.listen();
let browser;
const errors = [], checks = [];
try {
  browser = await chromium.launch({ executablePath: 'C:/Users/masa_/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:5337/?level=floor2&gears=10&manual');
  await page.waitForFunction(() => !!window.__game);
  await page.getByRole('button', { name: 'スタート', exact: true }).click();
  const step = (n = 1) => page.evaluate(n => window.__game.step(1 / 30, n), n);
  const state = () => page.evaluate(() => {
    const g = window.__game, w = g.current, hud = document.getElementById('hud'), play = hud.querySelector('.play');
    return { level: w.level.data.camp1 ? 'camp1' : w.level.data.camp2State ? 'camp2' : w.level.data.surge ? 'surge' : 'floor2',
      state: w.state, hud: hud.className, body: document.body.className, play: play.className,
      opacity: getComputedStyle(play).opacity, visibility: getComputedStyle(play).visibility,
      hp: getComputedStyle(hud.querySelector('.bleft')).display,
      weapons: getComputedStyle(hud.querySelector('.wpn')).display,
      overlays: document.querySelectorAll('.cs-root').length, upgrade: g.upgradeScreen.debug(), drive: w.level.data.drive?.phase };
  });
  await page.evaluate(() => { const g = window.__game; g.current.player.pos.set(0, 0, 2.4); g.step(); g.input.simulateKey('KeyR', true); g.step(); g.input.simulateKey('KeyR', false); g.step(1 / 30, 180); });
  assert.equal((await state()).upgrade.phase, 'open');
  await page.getByText('閉じる', { exact: true }).click();
  await step(90);
  console.log('after upgrade', await state());
  await page.evaluate(() => { window.__game.current.level.data.nextLevel = { level: 'surge', startAt: 'drive' }; window.__game.step(1 / 30, 60); });
  console.log('surge', await state());
  await page.evaluate(() => {
    const g = window.__game, d = g.current.level.data.drive;
    d.pos.set(-1381, 0, -90); d.yaw = Math.PI / 2; d.speed = 330 / 3.6; d.phase = 'driving'; d.mode = 'west';
    g.step();
  });
  console.log('started cutscene', await state());
  await step(900);
  console.log('after success', await state());
  assert.notEqual((await state()).hp, 'none');
  assert.notEqual((await state()).weapons, 'none');
  checks.push('normal HUD returns immediately after leaving car');
  await page.evaluate(() => { const g = window.__game; g.current.player.pos.set(-1618, 0, -30); g.step(1 / 30, 60); g.render(); });
  await page.waitForTimeout(700);
  console.log('camp1', await state());
  await page.screenshot({ path: `${out}/camp1-hud.png` });
  const s = await state();
  assert.equal(s.level, 'camp1');
  assert.equal(s.visibility, 'visible');
  assert.equal(s.opacity, '1');
  assert.notEqual(s.hp, 'none');
  assert.notEqual(s.weapons, 'none');
  checks.push('floor2 upgrade -> surge success -> camp1 keeps HUD visible');
  await page.evaluate(async () => {
    const g = window.__game, w = g.current;
    const { getCamp1 } = await import('/src/level/camp1.ts');
    const { getGrabbables } = await import('/src/core/armGrab.ts');
    const at = getCamp1(w).plan.vacuum;
    getGrabbables(w).find(x => Math.hypot(x.pos.x - at.x, x.pos.z - at.z) < 0.1).onGrab();
    w.player.invuln = 999;
    g.step();
  });
  await page.keyboard.press('y');
  await step();
  assert.equal(await page.evaluate(() => window.__game.current.skills.vacuum.active), true);
  assert.ok(await page.evaluate(() => window.__game.current.skills.cooldown.vacuum > 13));
  assert.ok(await page.locator('.skill-box').isVisible());
  await step(430);
  assert.equal(await page.evaluate(() => window.__game.current.skills.cooldown.vacuum), 0);
  await page.screenshot({ path: `${out}/camp1-vacuum-ready.png` });
  checks.push('camp1 vacuum pickup, Y activation and 14 second cooldown display work');

  await page.evaluate(() => { const g = window.__game; g.current.level.data.nextLevel = { level: 'camp2', startAt: 'boss' }; g.step(1 / 30, 60); });
  assert.notEqual((await state()).hp, 'none');
  assert.notEqual((await state()).weapons, 'none');
  checks.push('camp2 entry also shows HP and weapon HUD');
  await page.evaluate(() => {
    const g = window.__game, w = g.current;
    for (const e of w.enemies) { e.hp = 0; e.status = 'dead'; }
    w.level.data.camp2State.bossDeadT = 3.2;
    w.player.hp = 0;
    g.step();
  });
  assert.equal(await page.evaluate(() => window.__game.current.state), 'gameover');
  await page.getByRole('button', { name: 'リトライ', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('denki-cyborg-save-v1')).startAt), 'freed');
  await page.reload();
  await page.waitForFunction(() => !!window.__game);
  await page.getByRole('button', { name: /^つづきから/ }).click();
  await step(3);
  assert.equal(await page.evaluate(() => window.__game.current.level.data.camp2State.phase), 'freed');
  checks.push('retry after simultaneous death/unlock saves freed checkpoint and continues correctly');

  await page.goto('http://127.0.0.1:5337/?level=surge&start=drive&manual');
  await page.waitForFunction(() => !!window.__game);
  await page.getByRole('button', { name: 'はじめから', exact: true }).click();
  await page.evaluate(() => {
    const g = window.__game, d = g.current.level.data.drive;
    d.pos.set(-1381, 0, -90); d.yaw = Math.PI / 2; d.speed = 330 / 3.6; d.phase = 'driving'; d.mode = 'west'; g.step();
    g.current.level.data.drive.cutscene.skip(); g.step();
  });
  assert.ok(await page.evaluate(() => window.__game.current.level.data.drive.pos.x < -1600));
  assert.equal(await page.evaluate(() => window.__game.current.level.data.drive.speed), 0);
  assert.equal((await state()).hud.includes('driving'), false);
  assert.notEqual((await state()).hp, 'none');
  await page.evaluate(() => { const g = window.__game; g.current.player.pos.set(-1618, 0, -30); g.step(1 / 30, 60); });
  await page.waitForTimeout(700);
  assert.equal((await state()).level, 'camp1');
  assert.equal((await state()).hud, '');
  checks.push('skipping driving cutscene completes crash, restores HUD and allows camp1 entry');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  fs.writeFileSync(`${out}/hud-result.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser?.close(); await server.close();
}
