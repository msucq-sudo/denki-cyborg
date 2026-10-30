// Bed -> upgrade -> wake using the real animation loop and isolated browser storage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const out = '.logs/upgrade-freeze-2026-10-30';
fs.mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5322, strictPort: true, hmr: false }, logLevel: 'error' });
await server.listen();
let browser, page;
const checks = [], errors = [];
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXE ?? 'C:/Users/masa_/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:5322/?level=floor2&gears=10');
  await page.waitForFunction(() => !!window.__game);
  await page.getByRole('button', { name: 'スタート', exact: true }).click();
  await page.evaluate(() => { const p = window.__game.current.player; p.pos.set(0, 0, 2.4); p.vel.set(0, 0, 0); });
  await page.waitForFunction(() => window.__game.current.level.data.floor2.nearBed);
  await page.keyboard.press('r');
  await page.waitForFunction(() => window.__game.upgradeScreen.debug().phase === 'open', null, { timeout: 90000 });
  assert.deepEqual(errors, []);
  checks.push('real frame loop reaches upgrade screen through bed without exception');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.current.upgrades['gun.pistol'] === 2);
  assert.equal(await page.evaluate(() => window.__game.current.inventory.gears), 9);
  await page.keyboard.press('d');
  await page.waitForFunction(() => window.__game.upgradeScreen.debug().cat === 'body');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.current.upgrades.body === 2);
  checks.push('keyboard upgrades gun and body and deducts gears');
  await page.screenshot({ path: `${out}/upgrading.png` });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__game.upgradeScreen.isOpen && window.__game.current.level.data.floor2.phase === 'free' && !window.__game.input.locked, null, { timeout: 12000 });
  const before = await page.evaluate(() => ({ z: window.__game.current.player.pos.z, time: window.__game.current.time }));
  await page.keyboard.down('s');
  await page.waitForFunction(z => Math.abs(window.__game.current.player.pos.z - z) > 0.7, before.z, { timeout: 5000 });
  await page.keyboard.up('s');
  assert.ok(await page.evaluate(time => window.__game.current.time > time, before.time));
  assert.equal(await page.evaluate(() => window.__game.current.state), 'playing');
  checks.push('closing wakes player, releases input and allows movement on real frame loop');
  await page.screenshot({ path: `${out}/awake-and-moving.png` });

  // Simulated standard gamepad validates the pollGamepad path; physical hardware is separate QA.
  await page.evaluate(() => {
    window.testPadButtons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: window.testPadButtons }] });
    const p = window.__game.current.player; p.pos.set(0, 0, 2.4); p.vel.set(0, 0, 0);
  });
  const padTap = async index => {
    await page.evaluate(i => { window.testPadButtons[i] = { pressed: true, value: 1 }; }, index);
    await page.waitForFunction(() => window.__game.input.lastDevice === 'pad');
    await page.waitForTimeout(120);
    await page.evaluate(i => { window.testPadButtons[i] = { pressed: false, value: 0 }; }, index);
    await page.waitForTimeout(120);
  };
  await page.waitForFunction(() => window.__game.current.level.data.floor2.nearBed);
  await padTap(1);
  await page.waitForFunction(() => window.__game.upgradeScreen.debug().phase === 'open', null, { timeout: 90000 });
  await padTap(0);
  await page.waitForFunction(() => window.__game.current.upgrades['gun.pistol'] === 3);
  await padTap(1);
  await page.waitForFunction(() => !window.__game.upgradeScreen.isOpen && window.__game.current.level.data.floor2.phase === 'free' && !window.__game.input.locked, null, { timeout: 12000 });
  checks.push('reopening and upgrading/closing through simulated standard gamepad succeeds');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('denki-cyborg-save-v1')));
  assert.equal(saved.upgrades['gun.pistol'], 3);
  assert.equal(saved.upgrades.body, 2);
  checks.push('upgrades remain saved after closing');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  console.log('FAILURE STATE', await page?.evaluate(() => { const g = window.__game; return { state: g.current.state, time: g.current.time, input: { locked: g.input.locked }, floor: g.current.level.data.floor2, screen: g.upgradeScreen.debug() }; }).catch(() => null));
  throw error;
} finally {
  fs.writeFileSync(`${out}/result.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser?.close();
  await server.close();
}
