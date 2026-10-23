// 使い方: node tests/e2e/smoke.mjs [出力PNG] [秒数] [ポート]
// dev サーバーを起動 → ゲーム開始 → 簡単な入力を流す → スクショ保存 → コンソールエラーと状態を出力
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const out = process.argv[2] ?? 'tests/e2e/out/smoke.png';
const seconds = Number(process.argv[3] ?? 4);
const port = Number(process.argv[4] ?? 5199);
fs.mkdirSync(out.split('/').slice(0, -1).join('/') || '.', { recursive: true });

const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes('Local')) res(); }); setTimeout(res, 8000); });

const exe = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out.replace(/\.png$/, '_title.png') });
  await page.evaluate(() => window.__game.start());
  // 前進しながら射撃
  await page.evaluate(() => { const g = window.__game; g.input.simulateKey('KeyW', true); });
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    await page.evaluate(() => { const g = window.__game; g.input.simulateMouse(0, true); });
    await page.waitForTimeout(120);
    await page.evaluate(() => { const g = window.__game; g.input.simulateMouse(0, false); });
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.__game.input.simulateKey('KeyW', false));
  await page.screenshot({ path: out });
  const state = await page.evaluate(() => {
    const w = window.__game.world;
    return { state: w.state, hp: w.player.hp, energy: +w.player.energy.toFixed(1), pos: w.player.pos.toArray().map((v) => +v.toFixed(2)),
      enemies: w.enemies.length, room: w.level.currentRoom, rooms: w.level.rooms.length, colliders: w.colliders.length, projectiles: w.projectiles.length };
  });
  console.log('STATE', JSON.stringify(state));
} finally {
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  server.kill();
}
