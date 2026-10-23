// 先に `npx vite build --outDir dist-level` してから: node tests/e2e/level.mjs [部屋番号,...]  (port 5204, 静的 preview。dev だと他担当の編集で HMR リロードされるため)  — 重い環境ではスクショに時間がかかるので長めのタイムアウト
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = 5204;
fs.mkdirSync('tests/e2e/out', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-level', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes('Local')) res(); }); setTimeout(res, 8000); });
const exe = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const log = (...a) => console.log(...a);
const frames = (n = 2) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const only = process.argv[2] ?? 'all';
try {
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await frames();
  await page.screenshot({ path: 'tests/e2e/out/level_title.png' });

  // ---- 1. 通しの挙動：歩いて入室→ドア閉→敵→全滅→ドア開
  await page.evaluate(() => {
    window.__events = [];
    const g = window.__game;
    for (const n of ['roomEnter', 'roomClear', 'doorOpen', 'bossStart', 'charging', 'repair']) g.events.on(n, (p) => window.__events.push(n + ':' + (p?.index ?? '')));
    g.start();
    g.world.player.invuln = 1e9; g.world.player.hp = 60; // 修理キットのテスト用
  });
  const doors = () => page.evaluate(() => window.__game.world.colliders.filter((c) => c.tag === 'door').map((c) => c.active));
  const st = () => page.evaluate(() => {
    const w = window.__game.world;
    return { cur: w.level.currentRoom, obj: w.level.data.objective, rem: w.level.data.remaining, enemies: w.enemies.length, pos: w.player.pos.toArray().map((v) => +v.toFixed(1)), energy: +w.player.energy.toFixed(1), hp: w.player.hp, toasts: w.toasts.map((t) => t.text), ev: window.__events.join(',') };
  });
  log('START', JSON.stringify(await st()), 'doors', JSON.stringify(await doors()));
  await page.evaluate(() => window.__game.step(1 / 60, 90)); // 1.5秒：部屋0 clear -> door0 open
  log('ROOM0 after 1.5s', JSON.stringify(await st()), 'doors', JSON.stringify(await doors()));
  // 部屋0の充電パッドで充電
  await page.evaluate(() => { const w = window.__game.world; w.player.energy = 20; w.player.pos.set(-5, 0, -16); });
  await page.evaluate(() => window.__game.step(1 / 60, 60));
  log('CHARGE', JSON.stringify(await st()));
  // 歩いて第1区画へ
  await page.evaluate(() => { const w = window.__game.world; w.player.pos.set(0, 0, -3); w.player.yaw = 0; window.__game.input.simulateKey('KeyW', true); });
  for (let i = 0; i < 40; i++) { await page.evaluate(() => window.__game.step(1 / 30, 15)); const s = await st(); if (s.cur >= 1) break; }
  await page.evaluate(() => window.__game.input.simulateKey('KeyW', false));
  await page.evaluate(() => window.__game.step(1 / 60, 20));
  log('ENTERED ROOM1', JSON.stringify(await st()), 'doors', JSON.stringify(await doors()));
  await page.evaluate(() => window.__game.step(1 / 60, 90));
  log('WAVE1 spawned', JSON.stringify(await st()));
  await frames(); await page.screenshot({ path: 'tests/e2e/out/level_room1_fight.png' });
  // 全滅させる
  await page.evaluate(() => { for (const e of window.__game.world.enemies) { e.status = 'dead'; } window.__game.step(1 / 60, 90); });
  log('ROOM1 CLEARED', JSON.stringify(await st()), 'doors', JSON.stringify(await doors()));
  await frames(); await page.screenshot({ path: 'tests/e2e/out/level_room1_cleared.png' });

  // ---- 2. 各部屋へテレポートしてスクショ
  const list = only === 'all' ? [3, 5, 7] : only.split(',').map(Number);
  for (const i of list) {
    await page.evaluate((i) => {
      const w = window.__game.world; const r = w.level.rooms[i];
      for (const e of w.enemies) e.status = 'dead';
      w.player.pos.set((r.min.x + r.max.x) / 2, 0, r.max.z - 4);
      w.player.yaw = 0; w.player.pitch = -0.1;
      window.__game.step(1 / 60, 20);
    }, i);
    await frames(3);
    await page.screenshot({ path: `tests/e2e/out/level_room${i}.png` });
    log('ROOM', i, JSON.stringify(await st()));
  }
  // 高台
  await page.evaluate(() => {
    const w = window.__game.world; const r = w.level.rooms[3];
    w.player.pos.set(12, 4.9, r.min.z + 8); w.player.vel.set(0, 0, 0); w.player.yaw = 0.3; w.player.pitch = -0.2;
    window.__game.step(1 / 60, 30);
  });
  await frames(3);
  await page.screenshot({ path: 'tests/e2e/out/level_room3_platform.png' });
  log('PLATFORM', JSON.stringify(await st()));
  // ボス部屋：入室→1.5秒後にボスspawn
  await page.evaluate(() => {
    const w = window.__game.world; const r = w.level.rooms[7];
    w.player.pos.set(0, 0, r.max.z - 4); w.player.yaw = 0; w.player.pitch = 0.0;
    window.__game.step(1 / 60, 150);
  });
  await frames(3);
  await page.screenshot({ path: 'tests/e2e/out/level_boss.png' });
  const bs = await page.evaluate(() => { const w = window.__game.world; return { bossSpawned: w.level.bossSpawned, kinds: w.enemies.map((e) => e.kind), ev: window.__events.join(',') }; });
  log('BOSS', JSON.stringify(bs));
  await page.evaluate(() => { const w = window.__game.world; const b = w.enemies.find((e) => e.kind === 'boss'); if (b) { b.status = 'dead'; window.__game.events.emit('enemyKilled', { kind: 'boss', pos: b.pos, how: 'shot' }); } window.__game.step(1 / 60, 150); });
  log('BOSS KILLED', JSON.stringify(await page.evaluate(() => ({ defeated: window.__game.world.level.bossDefeated, state: window.__game.world.state }))));
  log('ERRORS', errors.length ? errors.join('\n') : 'none');
} finally {
  await browser.close();
  server.kill();
}
