// 休眠する敵のスクショ: node tests/e2e/dormant_capture.mjs [port]
// 通路のポッド／ポッドが開く瞬間／天井から降るドローン／大広間 → tests/e2e/out/dormant_*.png
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const port = Number(process.argv[2] ?? 5193);
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true }, logLevel: 'warn' });
await server.listen();
const exe = fs.existsSync('/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
  ? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
  : path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const gp = await browser.newPage({ viewport: { width: 1280, height: 720 } });
gp.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
gp.on('pageerror', (e) => errors.push(String(e)));
const ev = (fn, arg) => gp.evaluate(fn, arg);
const shot = async (name) => { await ev(() => window.__game.render()); await gp.screenshot({ path: `${outDir}/dormant_${name}.png`, timeout: 120000 }); console.log('shot', name); };
const tp = (x, y, z, yaw, pitch = 0.05) => ev(([x, y, z, yaw, pitch]) => { const p = window.__game.current.player; p.pos.set(x, y, z); p.vel.set(0, 0, 0); p.yaw = yaw; p.pitch = pitch; p.hp = p.maxHp; }, [x, y, z, yaw, pitch]);
const step = (n, dt = 1 / 30) => ev(([n, dt]) => window.__game.step(dt, n), [n, dt]);
try {
  await gp.goto(`http://localhost:${port}/?level=floor1&manual`, { waitUntil: 'load' });
  await gp.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  await ev(() => window.__game.start());
  await step(10);
  await tp(-74, 0, -9.5, -Math.PI / 2); await step(20);
  await shot('corridor');
  // ポッドを間近で（目覚めないよう半径0に）
  await ev(() => window.__game.current.enemies.forEach((e) => { if (e.ai.dormant) e.ai.dormant.wakeRadius = 0; }));
  await tp(-65, 0, -9.0, -Math.PI / 2 - 0.35, 0.2); await step(10);
  await shot('pod_closeup');
  await tp(-56, 0, -5.5, -Math.PI * 0.75, 0.12); await step(10);
  await shot('pod_side');
  // 開く瞬間
  await ev(() => window.__game.current.enemies.forEach((e) => { if (e.ai.dormant) e.ai.dormant.wakeRadius = e.kind === 'crawler' && e.pos.z < -10 ? 100 : 0; }));
  await tp(-66, 0, -8.5, -Math.PI / 2 - 0.5, 0.12);
  for (let i = 0; i < 30 && !(await ev(() => window.__game.current.enemies.some((e) => e.ai.dormant?.phase === 'warn'))); i++) await step(1);
  await step(6);
  await shot('pod_warn');
  for (let i = 0; i < 30 && !(await ev(() => window.__game.current.enemies.some((e) => e.ai.dormant?.phase === 'open'))); i++) await step(1);
  await step(4);
  await shot('pod_open');
  await step(6);
  await shot('pod_out');
  // 天井から降るドローン（スタート通路）
  await tp(-46, 0, -9.5, -Math.PI / 2, 0.45);
  for (let i = 0; i < 60 && !(await ev(() => window.__game.current.enemies.some((e) => e.kind === 'drone' && e.ai.dormant?.phase === 'warn'))); i++) await step(1);
  await step(5);
  await shot('drone_warn');
  for (let i = 0; i < 30 && !(await ev(() => window.__game.current.enemies.some((e) => e.kind === 'drone' && e.ai.dormant?.phase === 'plunge'))); i++) await step(1);
  await step(2);
  await shot('drone_plunge');
  // 大広間
  await ev(() => window.__game.current.enemies.forEach((e) => { e.hp = 0; e.status = 'dead'; e.root.visible = false; }));
  await ev(() => window.__game.current.enemies.length);
  await gp.goto(`http://localhost:${port}/?level=floor1&manual`, { waitUntil: 'load' });
  await gp.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  await ev(() => window.__game.start()); await step(10);
  await ev(() => window.__game.current.enemies.forEach((e) => { if (e.ai.dormant) e.ai.dormant.wakeRadius = 0; }));
  const hv = await ev(() => { const e = window.__game.current.enemies.find((e) => e.kind === 'heavy'); return [e.pos.x, e.pos.z, e.ai.yaw]; });
  await tp(hv[0] + Math.sin(hv[2]) * 9, 0, hv[1] + Math.cos(hv[2]) * 9, hv[2] - 0.2, 0.12); await step(20);
  await shot('hall');
  await ev(() => window.__game.current.enemies.forEach((e) => { if (e.ai.dormant) e.ai.dormant.wakeRadius = 15; }));
  await tp(0, 0, -31, Math.PI, 0.3); await step(1);
  for (let i = 0; i < 60 && !(await ev(() => window.__game.current.enemies.some((e) => e.kind === 'drone' && e.ai.dormant?.phase === 'plunge'))); i++) await step(1);
  await step(2);
  await shot('hall_drop');
  // 大広間の第2波（ヘビーウォーカーの着地）
} finally {
  console.log('errors', JSON.stringify(errors.slice(0, 10)));
  await browser.close();
  await server.close();
}
