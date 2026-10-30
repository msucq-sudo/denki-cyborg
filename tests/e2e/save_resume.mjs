// Isolated browser storage: never reads or overwrites the player's regular save.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const key = 'denki-cyborg-save-v1';
const out = '.logs/save-resume-2026-10-30';
fs.mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5198, strictPort: true }, logLevel: 'warn' });
await server.listen();
let browser;
const checks = [], errors = [];
try {
  browser = await chromium.launch({ executablePath: 'C:/Users/masa_/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  const load = async (level, extra = '') => {
    await page.goto(`http://127.0.0.1:5198/?level=${level}&manual${extra}`);
    await page.waitForFunction(() => !!window.__game);
  };
  const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  const resume = async () => {
    await page.reload();
    await page.waitForFunction(() => !!window.__game);
    await page.getByRole('button', { name: /^つづきから/ }).click();
  };
  await load('floor1');
  await page.getByRole('button', { name: 'スタート', exact: true }).click();
  assert.equal((await saved()).level, 'floor1');
  checks.push('first start creates a save');

  // Seed a completed fight via the same level tick used by gameplay.
  await page.evaluate(async () => {
    const g = window.__game, w = g.current;
    g.step();
    for (const e of w.enemies) {
      if (e.pos.x < -24 && e.pos.z > -15) { e.hp = 0; e.status = 'dead'; }
    }
    g.step();
    const { getGrabbables } = await import('/src/core/armGrab.ts');
    getGrabbables(w).find(x => x.enabled).onGrab();
    const { getSockets } = await import('/src/core/sockets.ts');
    getSockets(w)[0].onShot();
    w.inventory.metal = 17;
    g.unlock('shotgun', 'autoAim');
    w.loadout.current = 'shotgun';
    w.upgrades.body = 3;
    g.step();
  });
  const floorSave = await saved();
  assert.equal(floorSave.inventory.gears, 1);
  assert.equal(floorSave.inventory.metal, 17);
  await resume();
  const restored = await page.evaluate(async () => {
    const g = window.__game, w = g.current;
    const { getFloor1 } = await import('/src/level/floor1.ts');
    const { getGrabbables } = await import('/src/core/armGrab.ts');
    g.step(); g.render();
    return { state: w.state, inventory: w.inventory, owned: w.loadout.owned, current: w.loadout.current,
      hp: w.player.hp, maxHp: w.player.maxHp, floor: getFloor1(w).state,
      taken: getGrabbables(w).filter(x => !x.enabled).length };
  });
  assert.equal(restored.state, 'playing');
  assert.deepEqual(restored.inventory, { gears: 1, metal: 17 });
  assert.equal(restored.current, 'shotgun');
  assert.ok(restored.owned.includes('shotgun'));
  assert.equal(restored.floor.fights.start, 'done');
  assert.equal(restored.floor.powered, true);
  assert.equal(restored.taken, 1);
  assert.equal(restored.maxHp, 130);
  assert.equal(restored.hp, 130);
  await page.screenshot({ path: `${out}/floor1-continued.png` });
  checks.push('floor1 reload restores cleared fight, power, collected gear, inventory, loadout and upgraded max HP');

  // Simulate a real localStorage quota failure; failure must remain pending.
  const failure = await page.evaluate(() => {
    const g = window.__game, w = g.current;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    w.inventory.metal = 19;
    w.level.data.saveDirty = true;
    g.step();
    const pending = w.level.data.saveDirty;
    const warned = w.toasts.some(t => t.text.includes('セーブできません'));
    Storage.prototype.setItem = original;
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    return { pending, warned, dirtyAfterRetry: w.level.data.saveDirty };
  });
  assert.deepEqual(failure, { pending: true, warned: true, dirtyAfterRetry: false });
  assert.equal((await saved()).inventory.metal, 19);
  checks.push('storage failure warns, retains pending state and retries successfully');

  const preservedSave = await saved();
  await load('floor2');
  await page.getByRole('button', { name: 'はじめから', exact: true }).click();
  assert.deepEqual(await saved(), preservedSave);
  checks.push('fresh start alone preserves the previous save');
  await page.evaluate(() => {
    const g = window.__game;
    g.current.level.data.floor2.sleeps = 1;
    g.current.inventory.gears = 8;
    g.step();
  });
  await resume();
  assert.equal(await page.evaluate(() => window.__game.current.level.data.floor2.exitUnlocked), true);
  checks.push('floor2 rest and west exit unlock survive reload');
  await page.reload();
  await page.waitForFunction(() => !!window.__game);
  await page.evaluate(() => { const g = window.__game; g.input.simulateKey('KeyP', true); g.step(); g.input.simulateKey('KeyP', false); });
  assert.equal(await page.evaluate(() => window.__game.current.level.data.floor2.exitUnlocked), true);
  assert.equal(await page.evaluate(() => window.__game.current.state), 'playing');
  checks.push('title keyboard shortcut also continues the saved game');

  await load('camp1');
  await page.getByRole('button', { name: 'はじめから', exact: true }).click();
  await page.evaluate(async () => {
    const { pickKey } = await import('/src/level/camp1.ts');
    const g = window.__game;
    g.step(); pickKey(g.current, 'B'); g.step();
  });
  await resume();
  assert.deepEqual(await page.evaluate(() => window.__game.current.level.data.camp1.keys), ['B']);
  checks.push('camp1 collected security key survives reload');

  await load('camp2', '&start=boss');
  await page.getByRole('button', { name: 'はじめから', exact: true }).click();
  await page.evaluate(() => {
    const g = window.__game, w = g.current;
    for (const e of w.enemies) { e.hp = 0; e.status = 'dead'; }
    g.step(1 / 30, 200);
  });
  assert.equal((await saved()).startAt, 'freed');
  await resume();
  const freed = await page.evaluate(() => ({ phase: window.__game.current.level.data.camp2State.phase, enemies: window.__game.current.enemies.length }));
  assert.deepEqual(freed, { phase: 'freed', enemies: 0 });
  await page.evaluate(() => { window.__game.step(); window.__game.render(); });
  await page.screenshot({ path: `${out}/camp2-freed-continued.png` });
  checks.push('camp2 boss defeat and freed residents survive reload');

  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ v: 1, level: 'floor1' })), key);
  await page.reload();
  await page.waitForFunction(() => !!window.__game);
  assert.equal(await page.getByRole('button', { name: /^つづきから/ }).isVisible(), false);
  checks.push('incomplete save is ignored safely');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  fs.writeFileSync(`${out}/result.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser?.close();
  await server.close();
}
