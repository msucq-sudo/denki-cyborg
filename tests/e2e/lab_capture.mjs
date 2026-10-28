// スパーク研究室のスクショ: node tests/e2e/lab_capture.mjs [port] [only]
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const port = Number(process.argv[2] ?? 5196);
const only = process.argv[3] ?? '';
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true }, logLevel: 'warn' });
await server.listen();
const exe = fs.existsSync('/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
  ? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
  : path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(`http://localhost:${port}/lab.html`);
  await page.waitForFunction(() => window.__lab?.ready, null, { timeout: 120000 });
  const shots = [
    ['wide', 'camWide'], ['bed', 'camBed'], ['osSpark', 'camOverShoulderSpark'], ['osHero', 'camOverShoulderHero'],
  ];
  for (const [n, c] of shots) {
    if (only && !n.includes(only)) continue;
    await page.evaluate((c) => { window.__lab.cam(c); window.__lab.step(1 / 30, 20); }, c);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${outDir}/lab_${n}.png`, timeout: 120000 });
    console.log('shot', n, JSON.stringify(await page.evaluate(() => window.__lab.stats())));
  }
  // 仮キャラ付き
  if (!only || only === 'cap') {
    await page.evaluate(() => { window.__lab.capsules(true); window.__lab.cam('camWide'); });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${outDir}/lab_wide_caps.png`, timeout: 120000 });
  }
} finally {
  console.log('errors', JSON.stringify(errors.slice(0, 10)));
  await browser.close();
  await server.close();
}
