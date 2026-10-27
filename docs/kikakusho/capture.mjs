// 企画書用スクショ撮影。使い方: node docs/kikakusho/capture.mjs [port]
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const port = Number(process.argv[2] ?? 5320);
const outDir = 'docs/kikakusho/img';
fs.mkdirSync(outDir, { recursive: true });
execSync('npx vite build --outDir dist-e2e', { stdio: 'ignore' });
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-e2e', '--port', String(port), '--strictPort'], { stdio: 'pipe', shell: true });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes('Local')) res(); }); setTimeout(res, 8000); });
const exe = path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const shot = async (n) => { await page.waitForTimeout(700); await page.evaluate(() => window.__game.render()); await page.screenshot({ path: `${outDir}/${n}.png`, timeout: 120000 }); console.log('OK', n); };
const tryShot = async (n, fn) => { try { await fn(); await shot(n); } catch (e) { console.log('SKIP', n, String(e).slice(0, 200)); } };
try {
  await page.goto(`http://localhost:${port}/?manual`);
  await page.waitForFunction(() => !!window.__game);
  await page.evaluate(() => window.__game.step(1 / 60, 2));
  await shot('title');
  await page.evaluate(() => { const g = window.__game; g.start(); g.input.simulateKey('KeyH', true); g.step(1/30, 1); g.input.simulateKey('KeyH', false); g.step(1/30, 40); });
  await page.evaluate(() => { const g = window.__game, w = g.current; const r = w.level.rooms[1]; w.player.pos.set((r.min.x+r.max.x)/2, 0, r.max.z - 4); g.step(1/30, 75); });
  // 敵を手前に固定
  await page.evaluate(() => {
    const g = window.__game, w = g.current, p = w.player;
    w.enemies.forEach((e, i) => { e.pos.set(p.pos.x - 2.5 + i * 2.5, 3.2, p.pos.z - 7); e.root.position.copy(e.pos); });
    const hold = w.enemies.map((e) => e.pos.clone());
    const raw = g.step;
    g.step = (dt, n = 1) => { for (let k = 0; k < n; k++) { w.enemies.forEach((e, i) => { if (hold[i] && e.status !== 'dead') { e.pos.copy(hold[i]); e.vel.set(0, 0, 0); e.ai.cool = 99; e.ai.attackT = 99; } }); raw(dt, 1); } };
    const t = w.enemies[Math.min(1, w.enemies.length - 1)].pos; const c = p.pos.clone(); c.y += 1.4; const d = t.clone().sub(c);
    p.yaw = Math.atan2(-d.x, -d.z); p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    g.step(1/30, 10);
  });
  await shot('hud');
  await tryShot('scouter', async () => { await page.evaluate(() => { const g = window.__game; g.input.simulateKey('Digit1', true); g.step(1/30, 1); g.input.simulateKey('Digit1', false); g.step(1/30, 10); }); });
  await tryShot('absorb', async () => { await page.evaluate(() => { const g = window.__game; g.input.simulateKey('KeyE', true); g.step(1/30, 1); g.input.simulateKey('KeyE', false); g.step(1/30, 12); }); });
  await tryShot('overload', async () => { await page.evaluate(() => { const g = window.__game; g.current.player.energy = 90; g.input.simulateKey('KeyF', true); g.step(1/30, 8); }); });
  await page.evaluate(() => { const g = window.__game; g.step(1/30, 30); g.input.simulateKey('KeyF', false); g.step(1/30, 30); });
  await tryShot('charge', async () => { await page.evaluate(() => { const g = window.__game; g.current.player.energy = 90; g.input.simulateMouse(0, true); g.step(1/30, 40); }); });
  await tryShot('chargeshot', async () => { await page.evaluate(() => { const g = window.__game; g.input.simulateMouse(0, false); g.step(1/30, 3); }); });
  await tryShot('flight', async () => { await page.evaluate(() => { const g = window.__game, p = g.current.player; p.energy = 100; g.input.simulateKey('Digit3', true); g.step(1/30, 1); g.input.simulateKey('Digit3', false); g.input.simulateKey('Space', true); g.step(1/30, 70); p.pitch = 0.35; g.step(1/30, 2); }); });
  await page.evaluate(() => { const g = window.__game; g.input.simulateKey('Space', false); });
  await tryShot('boss', async () => { await page.evaluate(() => {
    const g = window.__game, w = g.current, p = w.player; p.energy = 100; p.hp = p.maxHp;
    const n = w.level.rooms.length - 1; const r = w.level.rooms[n];
    p.pos.set((r.min.x + r.max.x) / 2, r.min.y + 0.2, r.max.z - 3); p.vel.set(0, 0, 0);
    g.step = Object.getPrototypeOf(g).step ? Object.getPrototypeOf(g).step.bind(g) : g.step;
    g.step(1/30, 120);
    const b = w.enemies.find((e) => e.kind === 'boss'); if (!b) throw new Error('no boss');
    const c = p.pos.clone(); c.y += 1.4; const d = b.pos.clone().sub(c);
    p.yaw = Math.atan2(-d.x, -d.z); p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); g.step(1/30, 10);
  }); });
} finally {
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  await browser.close(); server.kill();
}
