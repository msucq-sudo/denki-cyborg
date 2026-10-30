import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
const out = '.logs/checkpoints-2026-10-30';
fs.mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5345, strictPort: true, hmr: false }, logLevel: 'error' });
await server.listen();
let browser;
const checks = [], errors = [];
try {
  browser = await chromium.launch({ executablePath: 'C:/Users/masa_/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:5345/?level=camp1&start=boss&gears=7&unlock=all&manual');
  await page.waitForFunction(() => !!window.__game);
  await page.getByRole('button', { name: 'スタート', exact: true }).click();
  await page.evaluate(() => {
    const g = window.__game;
    g.current.upgrades.body = 2; g.step();
    const s = JSON.parse(localStorage.getItem('denki-cyborg-save-v1'));
    delete s.checkpointId; delete s.resume;
    localStorage.setItem('denki-cyborg-save-v1', JSON.stringify(s));
    localStorage.removeItem('denki-cyborg-save-history-v1');
  });
  const reload = async () => { await page.reload(); await page.waitForFunction(() => !!window.__game); };
  const open = async () => { await page.locator('.screen.show').getByRole('button', { name: '途中地点を選ぶ', exact: true }).click(); };
  const choose = async id => {
    await page.locator('.checkpoint-select:visible').selectOption(id);
    await page.getByRole('button', { name: 'ここから再開', exact: true }).click();
  };
  const state = () => page.evaluate(() => {
    const g = window.__game, w = g.current;
    return { state: w.state, level: w.level.data.floor1 ? 'floor1' : w.level.data.camp1 ? 'camp1' : w.level.data.floor2 ? 'floor2' : w.level.data.surge ? 'surge' : 'camp2', floor2: w.level.data.floor2, camp1: w.level.data.camp1,
      drive: w.level.data.drive?.phase, surge: !!w.level.data.surge,
      pos: w.player.pos.toArray(), gears: w.inventory.gears, upgrades: w.upgrades, locked: g.input.locked };
  });
  await reload(); await open();
  assert.equal(await page.locator('option[value="camp2:start"]').first().isDisabled(), true);
  assert.match(await page.locator('.checkpoint-detail:visible').innerText(), /記録|現在/);
  await page.screenshot({ path: `${out}/title-picker.png` });
  await choose('floor2:start');
  let s = await state();
  assert.equal(s.floor2.sleeps, 0);
  assert.equal(s.gears, 7); assert.equal(s.upgrades.body, 2);
  checks.push('legacy single-slot save returns to lab before upgrading, preserving current gear and upgrades');
  await page.evaluate(() => { const g = window.__game; g.current.inventory.gears = 3; g.current.upgrades.body = 3; g.step(); });
  await reload(); await open(); await choose('floor2:start');
  s = await state();
  assert.equal(s.gears, 7); assert.equal(s.upgrades.body, 2);
  checks.push('first recorded checkpoint remains unchanged after spending gears and upgrading');
  await reload(); await open(); await choose('surge:garage');
  s = await state(); assert.equal(s.surge, true); assert.ok(s.pos[2] > 0 && s.pos[2] < 14);
  assert.notEqual(s.drive, 'driving');
  await reload(); await open(); await choose('surge:drive');
  await page.evaluate(() => window.__game.step(1 / 30, 3));
  s = await state(); assert.equal(s.drive, 'driving');
  checks.push('garage before boarding and driving start are separately selectable');
  for (const id of ['start', 'hall', 'L1', 'L2', 'L3', 'vestW', 'side', 'RU', 'RL', 'dead', 'alcove']) {
    await reload(); await open(); await choose(`floor1:room.${id}`);
    await page.evaluate(() => { const g = window.__game; g.current.player.invuln = 100; g.step(1 / 30, 3); });
    s = await state(); assert.equal(s.level, 'floor1', id); assert.ok(s.pos[1] > -2, id);
    assert.equal(s.gears, 7, id);
  }
  checks.push('all eleven floor1 room locations remain playable without duplicating gears');
  for (const id of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'tunnel', 'duct']) {
    await reload(); await open(); await choose(`camp1:room.${id}`);
    s = await state(); assert.ok(s.camp1, id); assert.equal(s.gears, 7, id);
    assert.equal(s.state, 'playing', id);
    await page.evaluate(() => { window.__game.current.player.invuln = 100; window.__game.step(1 / 30, 2); window.__game.render(); });
    assert.ok((await state()).pos[1] > -10, id);
  }
  checks.push('all twelve camp1 rooms and special passages can be selected and simulated without losing inventory');
  await page.keyboard.press('p'); await page.evaluate(() => window.__game.step());
  assert.equal((await state()).state, 'paused');
  await open();
  await page.setViewportSize({ width: 960, height: 540 });
  const fits = await page.locator('.checkpoint-panel:visible').evaluate(e => {
    const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
  });
  assert.equal(fits, true);
  await page.screenshot({ path: `${out}/pause-picker-960.png` });
  await page.locator('.checkpoint-select:visible').selectOption('camp1:boss');
  await page.locator('.checkpoint-select:visible').press('Enter');
  assert.equal((await state()).state, 'playing');
  checks.push('pause menu supports keyboard confirmation and fits 960x540');
  await reload(); await open();
  await page.evaluate(() => { const g = window.__game; g.input.simulateKey('PadDown', true); g.step(); g.input.simulateKey('PadDown', false); g.step(); });
  assert.equal(await page.evaluate(() => window.__game.upgradeScreen.isOpen), false);
  assert.equal((await state()).state, 'title');
  const picked = await page.locator('.checkpoint-select:visible').inputValue();
  await page.evaluate(() => { const g = window.__game; g.input.simulateKey('PadA', true); g.step(); g.input.simulateKey('PadA', false); g.step(); });
  assert.equal((await state()).state, 'playing');
  assert.equal((await state()).level, picked.split(':')[0]);
  checks.push('gamepad virtual navigation confirms a checkpoint without triggering normal continue');
  await page.waitForTimeout(300);
  if ((await state()).state === 'paused') await page.locator('.screen.show').getByRole('button', { name: '再開', exact: true }).click();
  const beforeTransition = (await state()).gears;
  await page.evaluate(() => { const g = window.__game; g.current.level.data.nextLevel = { level: 'camp2' }; g.step(1 / 30, 60); });
  const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('denki-cyborg-save-history-v1')).records.find(s => s.checkpointId === 'camp2:start'));
  assert.equal(entry.inventory.gears, beforeTransition);
  checks.push('stage entry is archived after carrying inventory into the new world');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  fs.writeFileSync(`${out}/result.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser?.close(); await server.close();
}
