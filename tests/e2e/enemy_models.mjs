// 使い方: node tests/e2e/enemy_models.mjs [kind...]  （ポート 5195）
// 全敵モデルを 前3/4 + 背面3/4 で描画して tests/e2e/out/mech_<kind>.png に保存
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';

const port = 5195;
fs.mkdirSync('tests/e2e/out', { recursive: true });
const server = await createServer({ server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const kinds = process.argv.slice(2).length ? process.argv.slice(2)
  : ['drone', 'crawler', 'gunner', 'heavy', 'boss', 'walker', 'heavyWalker', 'missile'];
const winExe = `${process.env.LOCALAPPDATA}/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe`;
const exe = process.env.CHROME_EXE ?? (fs.existsSync(winExe) ? winExe : '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 480 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(`http://localhost:${port}/tests/e2e/enemy_models.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  for (const k of kinds) {
    await page.evaluate((k) => window.show(k), k);
    const st = await page.evaluate(() => window.stats());
    await page.screenshot({ path: `tests/e2e/out/mech_${k}.png` });
    console.log(k, JSON.stringify(st));
  }
} finally {
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  await server.close();
}
