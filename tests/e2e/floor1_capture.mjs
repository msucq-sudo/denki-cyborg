// 1階のスクショ: node tests/e2e/floor1_capture.mjs [port] [only]
// ?level=floor1 のプレイヤー視点を tests/e2e/out/floor1v2_*.png に保存（暗い照明の確認用）。
// only に "map" を渡すと map.html（俯瞰ビューア）も撮る。
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const port = Number(process.argv[2] ?? 5194);
const only = process.argv[3] ?? '';
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true }, logLevel: 'warn' });
await server.listen();
const exe = fs.existsSync('/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
  ? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
  : path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const hook = (page) => {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
};
const want = (n) => !only || only === 'map' || n.includes(only);
try {
  if (only === 'map') {
    const mp = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    hook(mp);
    await mp.goto(`http://localhost:${port}/map.html`);
    await mp.waitForFunction(() => window.__map?.ready, null, { timeout: 120000 });
    await mp.waitForTimeout(1200);
    await mp.screenshot({ path: `${outDir}/floor1v2_map_top.png`, timeout: 120000 });
    await mp.close();
  }

  // ---- プレイヤー視点
  const gp = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  hook(gp);
  await gp.goto(`http://localhost:${port}/?level=floor1&manual`);
  await gp.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  await gp.evaluate(() => { window.__game.start(); window.__game.step(1 / 60, 30); });
  await gp.waitForTimeout(1500);
  const gshot = async (name, args) => {
    if (!want(name)) return;
    if (args) await gp.evaluate(([x, z, yaw, pitch, y]) => {
      const w = window.__game.current; const p = w.player;
      w.enemies.forEach((e) => { e.hp = 0; e.status = 'dead'; e.root.visible = false; });
      p.pos.set(x, y, z); p.yaw = yaw; p.pitch = pitch; p.vel.set(0, 0, 0);
    }, args);
    await gp.evaluate(() => { window.__game.step(1 / 60, 40); window.__game.render(); });
    await gp.screenshot({ path: `${outDir}/floor1v2_${name}.png`, timeout: 120000 });
    console.log('shot', name);
  };
  // 配置: [x, z, yaw, pitch, y]（yaw 0=北(-z), -π/2=西(-x), π/2=東(+x), π=南）
  const view = (x, z, yaw, pitch = 0.05, y = 0) => [x, z, yaw, pitch, y];
  await gshot('start_corridor', null);
  await gshot('hall_wide', view(0, -8, 0, 0.12));
  await gshot('hall_player', view(-20, -12, -2.2));
  await gshot('hall_deck', view(-20, -50, 1.0, 0.1, 7.2));
  await gshot('left_room', view(-34, -45, -Math.PI / 2));
  await gshot('right_maze', view(34, -63, Math.PI / 2));
  await gshot('right_south', view(34, -30, Math.PI / 2));
  await gshot('battery_room', view(-42, -58, 0));
  await gshot('elevator', view(0, -62, 0));
  await gshot('side_corridor', view(-30, -45, Math.PI / 2));
  await gshot('dead_end', view(70, -3, Math.PI / 2));
} finally {
  console.log('errors', JSON.stringify(errors.slice(0, 12)));
  await browser.close();
  await server.close();
}
