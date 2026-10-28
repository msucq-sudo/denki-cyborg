// 使い方: node tests/e2e/mapsheet_capture.mjs  （ポート 5192）
// 1階の平面図（mapsheet.html）を docs/maps/floor1_map.png に保存する
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';

const port = 5192;
fs.mkdirSync('docs/maps', { recursive: true });
const server = await createServer({ server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const winExe = `${process.env.LOCALAPPDATA}/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe`;
const exe = process.env.CHROME_EXE ?? (fs.existsSync(winExe) ? winExe : '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell');
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(`http://localhost:${port}/mapsheet.html`);
  await page.waitForFunction(() => window.__sheetReady === true, null, { timeout: 60000 });
  await page.waitForTimeout(500); // フォント
  const png = await page.evaluate(() => document.getElementById('sheet').toDataURL('image/png').split(',')[1]);
  fs.writeFileSync('docs/maps/floor1_map.png', Buffer.from(png, 'base64'));
  console.log('saved docs/maps/floor1_map.png');
} finally {
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  await server.close();
}
