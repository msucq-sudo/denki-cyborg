// スパークの撮影: 正面/側面/背面/顔/ポーズ → tests/e2e/out/spark_*.png、顔ポートレート → public/assets/spark_portrait.png
// 使い方: node tests/e2e/spark_capture.mjs [port] [only]
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = Number(process.argv[2] ?? 5197);
const only = process.argv[3] ?? '';
fs.mkdirSync('tests/e2e/out', { recursive: true });
fs.mkdirSync('public/assets', { recursive: true });
const server = await createServer({ configFile: false, root: process.cwd(), server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const exe = fs.existsSync('/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
  ? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
  : path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const watch = (p) => { p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', (e) => errors.push(String(e))); };
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  watch(page);
  await page.goto(`http://localhost:${port}/spark.html?clean&still`);
  await page.waitForFunction(() => !!window.__spark);
  const shot = async (name, view, pose = 'idle') => {
    if (only && !name.includes(only)) return;
    await page.evaluate(([v, p]) => { window.__spark.pose(p); window.__spark.view(v); }, [view, pose]);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `tests/e2e/out/spark_${name}.png` });
    console.log('shot', name);
  };
  await shot('front', 'front');
  await shot('side', 'side');
  await shot('back', 'back');
  await shot('face', 'face');
  await shot('tablet', 'front', 'tablet');
  await shot('talk', 'face', 'talk');
  await shot('wave', 'front', 'wave');
  // 顔ポートレート（256px・紺背景・メガネなし）
  const p2 = await browser.newPage({ viewport: { width: 256, height: 256 } });
  watch(p2);
  await p2.goto(`http://localhost:${port}/spark.html?clean&still&bg=navy&noglasses`);
  await p2.waitForFunction(() => !!window.__spark);
  await p2.evaluate(() => { window.__spark.view('portrait'); });
  await p2.waitForTimeout(1200);
  await p2.screenshot({ path: 'public/assets/spark_portrait.png' });
  console.log('portrait saved');
} finally {
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  await browser.close(); await server.close();
}
