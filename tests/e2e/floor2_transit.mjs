// 1階 ⇄ 2階のエレベーター移動の確認: node tests/e2e/floor2_transit.mjs [port]
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const port = Number(process.argv[2] ?? 5197);
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true, watch: null }, logLevel: 'warn' });
await server.listen();
const exe = fs.existsSync('/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
  ? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
  : path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const gp = await browser.newPage({ viewport: { width: 1280, height: 720 } });
gp.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
gp.on('pageerror', (e) => errors.push(String(e)));
const info = () => gp.evaluate(() => {
  const w = window.__game.current; const d = w.level.data;
  return { floor: d.floor2 ? 2 : d.floor1 ? 1 : 0, state: w.state, pos: [w.player.pos.x, w.player.pos.y, w.player.pos.z].map((v) => +v.toFixed(1)),
    powered: d.floor1?.powered, doorOpen: (d.floor1 ?? d.floor2)?.doorOpen, enemies: w.enemies.length, nextFloor: d.nextFloor, hp: w.player.hp, energy: Math.round(w.player.energy) };
});
const step = (n) => gp.evaluate((n) => window.__game.step(1 / 60, n), n);
try {
  await gp.goto(`http://localhost:${port}/?level=floor1&manual`);
  await gp.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  await gp.evaluate(() => { window.__game.start(); window.__game.step(1 / 60, 20); window.__game.current.player.energy = 33; });
  console.log('1) floor1 start', JSON.stringify(await info()));
  await gp.evaluate(() => { window.__game.current.level.data.nextFloor = 2; });
  await step(90);
  console.log('2) after elevator ride', JSON.stringify(await info()));
  await step(60);
  await gp.evaluate(() => window.__game.render());
  console.log('   (floor2 arrival) energy carried over');
  await gp.evaluate(() => { const p = window.__game.current.player; p.pos.set(0, 0, 8); }); await step(20);
  await gp.evaluate(() => { const p = window.__game.current.player; p.pos.set(0, 0, 15.6); p.yaw = Math.PI; }); await step(90);
  console.log('3) after riding back', JSON.stringify(await info()));
  await step(80);
  await gp.evaluate(() => window.__game.render());
  await gp.screenshot({ path: `${outDir}/floor2_back_on_floor1.png` });
  // 1階に戻った状態でもう一度乗ると2階へ
  await gp.evaluate(() => { const p = window.__game.current.player; p.pos.set(0, 0, -77); });
  await step(90);
  console.log('4) floor1 car again', JSON.stringify(await info()));
} finally {
  console.log('errors', JSON.stringify(errors.slice(0, 8)));
  await browser.close(); await server.close();
}
