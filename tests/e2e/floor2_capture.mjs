// 2階のスクショ: node tests/e2e/floor2_capture.mjs [port] [only]
// ?level=floor2 の部屋の全景・ベッドのプロンプト・眠りの演出（B/R キー）を tests/e2e/out/floor2_*.png に保存。
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const port = Number(process.argv[2] ?? 5196);
const only = process.argv[3] ?? '';
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true, watch: null }, logLevel: 'warn' });
await server.listen();
const exe = fs.existsSync('/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
  ? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
  : path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const gp = await browser.newPage({ viewport: { width: 1280, height: 720 } });
gp.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
gp.on('pageerror', (e) => errors.push(String(e)));
const want = (n) => !only || n.includes(only);
try {
  await gp.goto(`http://localhost:${port}/?level=floor2&manual`);
  await gp.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  await gp.evaluate(() => { window.__game.start(); window.__game.step(1 / 60, 20); });
  await gp.waitForTimeout(800);
  const shot = async (name) => {
    if (!want(name)) return;
    await gp.evaluate(() => window.__game.render());
    await gp.screenshot({ path: `${outDir}/floor2_${name}.png`, timeout: 120000 });
    console.log('shot', name);
  };
  const place = async (x, z, yaw, pitch = 0.05) => {
    const r = await gp.evaluate(([x, z, yaw, pitch]) => {
      const p = window.__game.current.player; p.pos.set(x, 0, z); p.yaw = yaw; p.pitch = pitch; p.vel.set(0, 0, 0);
      window.__game.step(1 / 60, 30);
      return [p.pos.x.toFixed(2), p.pos.y.toFixed(2), p.pos.z.toFixed(2)].join(',');
    }, [x, z, yaw, pitch]);
    console.log('placed', x, z, '->', r);
  };
  /** デバッグカメラ（次の step までの 1 フレーム）。fov 指定 */
  const cam = async (name, pos, look, fov = 70) => {
    if (!want(name)) return;
    await gp.evaluate(([pos, look, fov]) => {
      const g = window.__game, c = g.current.camera;
      c.fov = fov; c.updateProjectionMatrix(); c.position.set(...pos); c.up.set(0, 1, 0); c.lookAt(...look);
      g.render();
    }, [pos, look, fov]);
    await gp.screenshot({ path: `${outDir}/floor2_${name}.png`, timeout: 120000 });
    console.log('shot', name);
  };

  // ---- 到着（エレベーターの中）
  await gp.evaluate(() => { const w = window.__game.current; w.player.pos.set(0, 0, 15.6); w.player.yaw = 0; });
  await gp.evaluate(() => window.__game.step(1 / 60, 5));
  await shot('arrive_car');
  await gp.evaluate(() => window.__game.step(1 / 60, 90));
  // ---- 全景
  await cam('overview_south', [0, 5.4, 12.2], [0, 0.4, -3], 85);
  await cam('overview_north', [0, 5.4, -12], [0, 0.4, 3], 85);
  await cam('overview_east', [-11.5, 4.8, 0], [3, 0.8, 0], 85);
  await cam('overview_west', [11.5, 4.8, 0], [-3, 0.8, 0], 85);
  await cam('topdown', [0, 5.7, 0.2], [0, 0, 0], 120);
  await cam('bed_close', [2.6, 2.2, 3.0], [0, 0.9, 0], 60);
  await cam('machines_close', [-6.5, 2.6, -3.5], [-2.5, 1.2, 0], 70);
  // ---- プレイヤー視点
  await place(0, 9, 0);
  await shot('player_south');
  await place(0, 2.4, 0, 0.12);
  await shot('bed_prompt');
  await place(-3, -5, -0.61, 0.0);   // 北東の出口を見る
  await shot('exit_ne');
  await place(3, -5, 0.61, 0.0);     // 北西の出口
  await shot('exit_nw');
  await place(6, 7, Math.PI * 0.8, 0.1);
  await shot('wall_computers');
  await place(0, 6, Math.PI, 0.1);   // エレベーター側を向く
  await shot('elevator_view');

  // ---- 眠りの演出（R キー。パッド B は PadB を simulate）
  if (want('sleep')) {
    await place(0, 2.4, 0, 0.12);
    const info = () => gp.evaluate(() => { const f = window.__game.current.level.data.floor2; return `${f.phase} t=${f.t.toFixed(2)}`; });
    await gp.evaluate(() => { const i = window.__game.input; i.simulateKey('PadB', true); i.simulateKey('KeyC', true); window.__game.step(1 / 60, 1); i.simulateKey('PadB', false); i.simulateKey('KeyC', false); });
    console.log('after B:', await info());
    const adv = (s) => gp.evaluate((n) => window.__game.step(1 / 60, n), Math.round(s * 60));
    await adv(0.35); await shot('sleep_1_walk'); console.log(await info());
    await adv(0.7); await shot('sleep_2_lie_start'); console.log(await info());
    await adv(0.6); await shot('sleep_3_lie_mid'); console.log(await info());
    await adv(0.8); await shot('sleep_4_lie_end'); console.log(await info());
    await adv(1.2); await shot('sleep_5_asleep'); console.log(await info());
    await adv(0.7); await shot('sleep_6_rest'); console.log(await info());
    // 起きる（もう一度 R）
    await gp.evaluate(() => { const i = window.__game.input; i.simulateKey('KeyR', true); window.__game.step(1 / 60, 1); i.simulateKey('KeyR', false); });
    await adv(0.5); await shot('sleep_7_wake_mid'); console.log(await info());
    await adv(1.2); await shot('sleep_8_after'); console.log(await info());
    const locked = await gp.evaluate(() => window.__game.input.locked);
    console.log('input locked after wake:', locked);
  }
} finally {
  console.log('errors', JSON.stringify(errors.slice(0, 12)));
  await browser.close();
  await server.close();
}
