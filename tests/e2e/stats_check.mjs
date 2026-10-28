// 使い方: node tests/e2e/stats_check.mjs  （ポート 5190）データ一覧のスクショ確認
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';
const port = 5190;
fs.mkdirSync('tests/e2e/out', { recursive: true });
const server = await createServer({ server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const winExe = `${process.env.LOCALAPPDATA}/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe`;
const exe = process.env.CHROME_EXE ?? (fs.existsSync(winExe) ? winExe : '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell');
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/stats.html`, { waitUntil: 'load' });
const names = ['player', 'weapon', 'func', 'enemy', 'material'];
const btns = await page.$$('#tabs button');
for (let i = 0; i < btns.length; i++) {
  await btns[i].click();
  if (i === 3) { await page.click('#etable tr.er[data-k="heavyWalker"]'); await page.click('#etable th[data-k="hp"]'); }
  await page.waitForTimeout(200);
  await page.screenshot({ path: `tests/e2e/out/stats_${names[i]}.png`, fullPage: true });
}
await page.fill('#q', 'ダッシュ');
await btns[0].click(); await page.fill('#q', 'ダッシュ');
await page.screenshot({ path: 'tests/e2e/out/stats_search.png' });
console.log('errors:', errors);
await browser.close(); await server.close();
