// 使い方: node tests/e2e/bestiary_check.mjs  （ポート 5199）敵図鑑のスクショ確認
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';
const port = 5199;
fs.mkdirSync('tests/e2e/out', { recursive: true });
const server = await createServer({ server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const winExe = `${process.env.LOCALAPPDATA}/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe`;
const exe = process.env.CHROME_EXE ?? (fs.existsSync(winExe) ? winExe : '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(`http://localhost:${port}/bestiary.html`);
  await page.waitForFunction(() => window.__bestiary, null, { timeout: 60000 });
  for (const k of (process.argv.slice(2).length ? process.argv.slice(2) : ['heavyWalker', 'boss'])) {
    await page.evaluate((k) => window.__bestiary.select(k), k);
    await page.click('#t-hit'); await page.waitForTimeout(800);
    await page.screenshot({ path: `tests/e2e/out/bestiary_${k}.png` });
    await page.click('#t-hit');
  }
  await page.evaluate(() => window.__bestiary.lineup(true));
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/e2e/out/bestiary_lineup.png' });
} finally { await browser.close(); await server.close(); }
console.log('errors:', errors);
