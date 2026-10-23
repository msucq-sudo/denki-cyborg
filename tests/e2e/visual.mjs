// 能力の見た目確認: 第1区画でスカウターON → 吸収接続 → 逆流 → 溜め のスクショ
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
const port = Number(process.argv[2] ?? 5310);
const outDir = 'tests/e2e/out/visual';
fs.mkdirSync(outDir, { recursive: true });
execSync('npx vite build --outDir dist-e2e', { stdio: 'ignore' });
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-e2e', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes('Local')) res(); }); setTimeout(res, 8000); });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const shot = async (n) => { await page.waitForTimeout(900); await page.evaluate(() => window.__game.render()); await page.screenshot({ path: `${outDir}/${n}.png`, timeout: 120000 }); };
try {
  await page.goto(`http://localhost:${port}/?manual`);
  await page.waitForFunction(() => !!window.__game);
  await page.evaluate(() => { const g = window.__game; g.start(); g.input.simulateKey('KeyH', true); g.step(1/30, 1); g.input.simulateKey('KeyH', false); g.step(1/30, 40); });
  // 第1区画へ移動して敵を出す
  await page.evaluate(() => { const g = window.__game, w = g.current; const r = w.level.rooms[1]; w.player.pos.set((r.min.x+r.max.x)/2, 0, r.max.z - 4); g.step(1/30, 75); });
  const info = await page.evaluate(() => { const w = window.__game.current; return w.enemies.map((e) => [e.kind, e.pos.toArray().map((v) => +v.toFixed(1))]); });
  console.log('ENEMIES', JSON.stringify(info));
  // 敵を手前に寄せて止める（見た目確認用）
  await page.evaluate(() => {
    const g = window.__game, w = g.current, p = w.player;
    w.enemies.forEach((e, i) => { e.pos.set(p.pos.x - 2.5 + i * 2.5, 3.2, p.pos.z - 6); e.root.position.copy(e.pos); });
    const hold = w.enemies.map((e) => e.pos.clone());
    const raw = g.step;
    g.step = (dt, n = 1) => { for (let k = 0; k < n; k++) { w.enemies.forEach((e, i) => { if (hold[i] && e.status !== 'dead') { e.pos.copy(hold[i]); e.vel.set(0, 0, 0); e.ai.cool = 99; e.ai.attackT = 99; } }); raw(dt, 1); } };
    const t = w.enemies[1].pos; const c = p.pos.clone(); c.y += 1.4; const d = t.clone().sub(c);
    p.yaw = Math.atan2(-d.x, -d.z); p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    g.input.simulateKey('Digit1', true); g.step(1/30, 1); g.input.simulateKey('Digit1', false); g.step(1/30, 10);
  });
  await shot('1_scouter');
  await page.evaluate(() => { const g = window.__game; g.input.simulateMouse(2, true); g.step(1/30, 1); g.input.simulateMouse(2, false); g.step(1/30, 12); });
  console.log('ABSORB', await page.evaluate(() => window.__game.current.absorb.phase));
  await shot('2_absorb');
  await page.evaluate(() => { const g = window.__game; g.current.player.energy = 90; g.input.simulateKey('KeyF', true); g.step(1/30, 8); });
  await shot('3_overload');
  await page.evaluate(() => { const g = window.__game; g.step(1/30, 30); g.input.simulateKey('KeyF', false); g.step(1/30, 30); });
  console.log('AFTER', JSON.stringify(await page.evaluate(() => { const w = window.__game.current; return { phase: w.absorb.phase, explosions: w.stats.explosions, e: Math.round(w.player.energy), enemies: w.enemies.map((e) => e.status) }; })));
  await page.evaluate(() => { const g = window.__game; g.current.player.energy = 90; g.input.simulateMouse(0, true); g.step(1/30, 40); });
  await shot('4_charge');
  await page.evaluate(() => { const g = window.__game; g.input.simulateMouse(0, false); g.step(1/30, 3); });
  await shot('5_chargeshot');
} finally {
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  await browser.close(); server.kill();
}
