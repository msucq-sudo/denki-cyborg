// 車の見た目の確認用（スクショ）。node tests/e2e/car_shot.mjs   出力: tests/e2e/out/drive_car_*.png
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';

const port = Number(process.env.PORT ?? 5333);
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const exe = process.env.CHROME_EXE ?? '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_') && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(`http://localhost:${port}/?level=surge&start=drive&manual`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  await page.evaluate(async () => {
    const g = window.__game, w = g.current, T = g.THREE;
    g.start();
    document.getElementById('hud').style.display = 'none';
    const m = await import('/src/vehicle/carModel.ts');
    const car = m.buildCar();
    car.setEngine(true);
    w.scene.add(car.root);
    w.player.root.visible = false;
    const floor = new T.Mesh(new T.PlaneGeometry(80, 80), new T.MeshStandardMaterial({ color: 0x5a6070, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; w.scene.add(floor);
    w.scene.add(new T.HemisphereLight(0xcfe3ff, 0x303848, 1.4));
    const sun = new T.DirectionalLight(0xfff2e0, 2.2); sun.position.set(-4, 7, 5); w.scene.add(sun);
    window.__car = car; window.__cam = (px, py, pz, lx, ly, lz) => { w.camera.position.set(px, py, pz); w.camera.lookAt(lx, ly, lz); };
  });
  const shots = JSON.parse(process.env.SHOTS ?? 'null') ?? [
    ['frontq', [4.8, 1.9, -5.8], [0, 0.85, 0]],
    ['side', [7.5, 1.3, 0.2], [0, 0.8, 0]],
    ['behind', [0, 2.2, 7.5], [0, 0.9, -1]],
    ['top', [0.1, 8, 0.5], [0, 0.5, 0]],
  ];
  for (const [name, pos, look, pose, steer] of shots) {
    await page.evaluate(([pos, look, pose, steer]) => {
      window.__car.setDriverPose(pose ?? 'drive'); window.__car.setSteer(steer ?? 0);
      for (let i = 0; i < 40; i++) window.__car.update(1 / 60, 20);
      window.__cam(...pos, ...look); window.__game.render();
    }, [pos, look, pose, steer]);
    await page.screenshot({ path: `${outDir}/drive_car_${name}.png` });
    console.log('shot', name);
  }
} finally {
  if (errors.length) console.log('ERRORS', errors);
  await browser.close();
  await server.close();
}
