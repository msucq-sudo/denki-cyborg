// グラップルの確認: node tests/e2e/grapple_capture.mjs [port]  → tests/e2e/out/grapple_*.png
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const port = Number(process.argv[2] ?? 5191);
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true }, logLevel: 'warn' });
await server.listen();
const exe = fs.existsSync('/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
  ? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
  : path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  const gp = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  gp.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  gp.on('pageerror', (e) => errors.push(String(e)));
  await gp.goto(`http://localhost:${port}/?level=floor1&manual`);
  await gp.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  await gp.evaluate(() => { window.__game.start(); window.__game.step(1 / 60, 30); });
  const shot = async (name) => {
    await gp.evaluate(() => window.__game.render());
    await gp.screenshot({ path: `${outDir}/grapple_${name}.png`, timeout: 120000 });
    console.log('shot', name);
  };
  const info = () => gp.evaluate(() => {
    const w = window.__game.current; const p = w.player;
    return { pos: p.pos.toArray().map((v) => +v.toFixed(2)), phase: w.absorb.phase, energy: +p.energy.toFixed(1), onGround: p.onGround };
  });
  // 配置してポイントへ照準。yaw 0=北(-z)、前方 = (-sin yaw, -cos yaw)
  const setup = (x, y, z, tx, ty, tz) => gp.evaluate(([x, y, z, tx, ty, tz]) => {
    const w = window.__game.current; const p = w.player;
    w.enemies.forEach((e) => { e.hp = 0; e.status = 'dead'; e.root.visible = false; });
    p.pos.set(x, y, z); p.vel.set(0, 0, 0);
    const dx = tx - x, dz = tz - z, dy = ty - (y + 1.7);
    p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    p.energy = 80;
    window.__game.step(1 / 60, 30);
  }, [x, y, z, tx, ty, tz]);
  const step = (n) => gp.evaluate((n) => window.__game.step(1 / 60, n), n);
  const key = (k, d) => gp.evaluate(([k, d]) => window.__game.input.simulateKey(k, d), [k, d]);

  // ---- 1) 西デッキの縁（7.2m）
  await setup(-12, 0, -30, -17.5, 7.2, -41);
  await shot('1_aim');
  console.log('before', JSON.stringify(await info()));
  await key('KeyE', true); await step(2); await key('KeyE', false);
  await step(10); await shot('2_pull_a');
  await step(14); await shot('3_pull_b');
  console.log('pulling', JSON.stringify(await info()));
  await step(30); await shot('4_hoist');
  await step(60); await shot('5_top');
  console.log('after', JSON.stringify(await info()));
  const a = await info();

  // ---- 2) 柱の上（12m）
  await setup(-6, 0, -21, -6, 12, -26);
  await key('KeyE', true); await step(2); await key('KeyE', false);
  await step(40); await shot('6_pillar_pull');
  await step(60);
  console.log('pillar', JSON.stringify(await info()));
  const b = await info();

  // ---- 3) 天井 → 着地台
  await setup(-10, 0, -30, -10, 16, -37);
  await key('KeyE', true); await step(2); await key('KeyE', false);
  await step(40); await shot('7_ceiling_pull');
  await step(60);
  await gp.evaluate(() => { window.__game.current.player.pitch = -0.1; });
  await step(20); await shot('8_ceiling_hang');
  await step(80);
  console.log('ceiling', JSON.stringify(await info()));
  const c = await info();
  const ok = a.pos[1] > 7 && a.pos[1] < 7.4 && a.pos[0] < -17.5
    && b.pos[1] > 11.9 && b.pos[1] < 12.4 && b.pos[2] < -26
    && c.pos[1] > 7 && c.pos[1] < 7.4;
  console.log(ok ? 'GRAPPLE OK' : 'GRAPPLE FAIL');
  if (!ok) process.exitCode = 1;
} finally {
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  await server.close();
}
