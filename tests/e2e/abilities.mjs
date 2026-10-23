// 使い方: node tests/e2e/abilities.mjs  （ポート5202）
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';

const port = Number(process.env.PORT ?? 5202);
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();

const exe = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
page.on('framenavigated', (f) => console.log('NAV', f.url()));
page.on('pageerror', (e) => errors.push(String(e)));
const snap = async (name) => { console.log('snap', name, Date.now() % 100000); await snapRaw(name); console.log('snapped', Date.now() % 100000); };
const snapRaw = (name) => page.screenshot({ path: `${outDir}/abilities_${name}.png`, timeout: 240000 });
const info = () => page.evaluate(() => {
  const w = window.__game.world;
  return { phase: w.absorb.phase, energy: +w.player.energy.toFixed(2), absorbing: w.player.absorbing, overloading: w.player.overloading,
    fn: { ...w.functions }, tethered: w.enemies.map((e) => e.tethered), lock: w.aimTarget?.id ?? null, tip: w.absorb.tip.toArray().map((v) => +v.toFixed(1)) };
});
const run = async (n) => { await page.evaluate((n) => window.__game.step(1 / 60, n), n); };
const result = {};
try {
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    window.__api = await import('/src/enemies/api.ts');
    const g = window.__game, w = g.world, T = g.THREE;
    g.start();
    const OX = 300; // ダンジョンから離れた場所を舞台にする
    // 床
    w.colliders.push({ min: new T.Vector3(OX - 40, -1, -40), max: new T.Vector3(OX + 40, 0, 40), active: true });
    const floor = new T.Mesh(new T.PlaneGeometry(80, 80), new T.MeshStandardMaterial({ color: 0xcfd8e3 }));
    floor.rotation.x = -Math.PI / 2; floor.position.x = OX; w.scene.add(floor);
    w.scene.add(new T.HemisphereLight(0xffffff, 0x667788, 1.6));
    const sun = new T.DirectionalLight(0xffffff, 1.5); sun.position.set(3, 8, 5); w.scene.add(sun);
    // 壁（スカウター確認用に敵2を隠す）
    const wall = new T.Mesh(new T.BoxGeometry(6, 4, 0.5), new T.MeshStandardMaterial({ color: 0x9fb0c8 }));
    wall.position.set(OX + 7, 2, -9); w.scene.add(wall);
    w.colliders.push({ min: new T.Vector3(OX + 4, 0, -9.25), max: new T.Vector3(OX + 10, 4, -8.75), active: true });
    w.player.hp = w.player.maxHp = 1e6;
    window.__spawn = (kind, x, y, z) => {
      const e = window.__api.spawnEnemy(w, kind, new T.Vector3(OX + x, y, z));
      // 位置を固定（AIの移動を無効化）して検証を決定的にする
      for (const k of ['x', 'y', 'z']) { const v = e.pos[k]; Object.defineProperty(e.pos, k, { get: () => v, set() {} }); }
      return e;
    };
    w.player.pos.set(OX, 0, 0); w.player.yaw = 0;
  });
  await page.evaluate(() => { __spawn('gunner', 0, 0.8, -8); __spawn('drone', 7, 1.6, -14); __spawn('gunner', -4, 0.8, -11); });
  await run(30);

  // 1: スカウター
  await page.evaluate(() => window.__game.input.simulateKey('Digit1', true));
  await run(2);
  await page.evaluate(() => window.__game.input.simulateKey('Digit1', false));
  const e1 = await info(); result.scouterOn = e1;
  await run(20);
  await snap('1_scouter');
  const markers = await page.evaluate(() => window.__game.world.scene.getObjectByName('scouterMarkers').children.length);
  result.markerCount = markers;

  // エネルギー消費確認
  const eA = (await info()).energy; await run(120); const eB = (await info()).energy;
  result.scouterDrain2s = +(eA - eB).toFixed(2);

  // 2: オートエイム
  await page.evaluate(() => window.__game.input.simulateKey('Digit2', true));
  await run(2);
  await page.evaluate(() => window.__game.input.simulateKey('Digit2', false));
  await run(5);
  result.autoAim = await info();

  // 3: 飛行トグル
  await page.evaluate(() => window.__game.input.simulateKey('Digit3', true));
  await run(2);
  await page.evaluate(() => window.__game.input.simulateKey('Digit3', false));
  result.flightOn = (await info()).fn;
  await page.evaluate(() => { const i = window.__game.input; for (const k of ['Digit1', 'Digit3']) { i.simulateKey(k, true); } });
  await run(2);
  await page.evaluate(() => { const i = window.__game.input; for (const k of ['Digit1', 'Digit3']) { i.simulateKey(k, false); } });
  result.afterOff = (await info()).fn;
  // スカウターは残す：もう一度ON
  await page.evaluate(() => window.__game.input.simulateKey('Digit1', true));
  await run(2);
  await page.evaluate(() => window.__game.input.simulateKey('Digit1', false));

  // 右クリックで刺す
  await page.evaluate(() => window.__game.input.simulateKey('KeyE', true));
  await run(2);
  await page.evaluate(() => window.__game.input.simulateKey('KeyE', false));
  await run(4);
  await run(20);
  result.attached = await info();
  await snap('4_attached');

  // 逆流
  const e0 = (await info()).energy;
  await page.evaluate(() => window.__game.input.simulateKey('KeyF', true));
  await run(60);
  await snap('5_overload');
  result.overload = await info();
  result.overloadEnergyDelta = +(e0 - result.overload.energy).toFixed(2);
  await page.evaluate(() => window.__game.input.simulateKey('KeyF', false));
  await run(2);

  // 任意解除
  await page.evaluate(() => window.__game.input.simulateKey('KeyE', true));
  await run(1);
  await page.evaluate(() => window.__game.input.simulateKey('KeyE', false));
  await run(3);
  result.released = await info();
  await run(90);
  result.idleAgain = (await info()).phase;

  // 電力0で全OFF
  await page.evaluate(() => { const w = window.__game.world; w.player.energy = 0.02; });
  await run(5);
  result.zeroEnergy = await info();
} finally {
  console.log('RESULT', JSON.stringify(result, null, 1));
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  await server.close();
}
