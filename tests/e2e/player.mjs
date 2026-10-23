// 使い方: node tests/e2e/player.mjs   （ポート 5201）
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = 5201;
fs.mkdirSync('tests/e2e/out', { recursive: true });
const server = spawn('node', ['node_modules/.bin/vite', '--config', 'tests/e2e/player.vite.config.mjs', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes('Local')) res(); }); setTimeout(res, 8000); });
const exe = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (n) => page.screenshot({ path: `tests/e2e/out/player_${n}.png`, timeout: 170000 });
const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };

try {
  // 初回は vite の依存最適化でリロードが入ることがあるので、2回読み込む
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForTimeout(4000);
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  // 床・壁・ライト
  await page.evaluate(() => {
    const g = window.__game, w = g.world, T = g.THREE;
    // 他担当のダンジョン等を除去して、テスト用の床だけにする
    w.colliders.length = 0;
    for (const c of [...w.scene.children]) if (c !== w.player.root) w.scene.remove(c);
    const mk = (min, max, color) => {
      w.colliders.push({ min: new T.Vector3(...min), max: new T.Vector3(...max), active: true });
      const m = new T.Mesh(new T.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]), new T.MeshStandardMaterial({ color }));
      m.position.set((max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2);
      m.receiveShadow = true; m.castShadow = true; w.scene.add(m);
    };
    mk([-20, -1, -20], [20, 0, 20], 0xdde6f5);
    mk([-20, 0, -14], [20, 6, -13], 0xffd9c8); // 前方の壁
    mk([8, 0, -6], [10, 3, -4], 0xc8e6ff);
    w.scene.background = new T.Color(0xbfd8f0);
    w.scene.add(new T.HemisphereLight(0xffffff, 0x8899bb, 1.1));
    const d = new T.DirectionalLight(0xffffff, 2); d.position.set(5, 12, 6); d.castShadow = true;
    d.shadow.camera.left = -15; d.shadow.camera.right = 15; d.shadow.camera.top = 15; d.shadow.camera.bottom = -15; w.scene.add(d);
    w.player.pos.set(0, 0.5, 0);
    window.__ev = []; for (const n of ['jump','land','dodge','shot','chargeStart','chargeFull','chargeCancel','flightStart','flightEnd','noEnergy']) g.events.on(n, (p) => window.__ev.push(n + (p && p.charged !== undefined ? ':' + p.charged : '')));
  });
  await shot('title');
  await page.evaluate(() => window.__game.start());
  const S = (dt, n) => page.evaluate(([dt, n]) => window.__game.step(dt, n), [dt, n]);
  const st = () => page.evaluate(() => { const p = window.__game.world.player; return { pos: p.pos.toArray().map((v) => +v.toFixed(2)), vy: +p.vel.y.toFixed(2), en: +p.energy.toFixed(2), g: p.onGround, fly: p.flying, ch: +p.charge.toFixed(2), proj: window.__game.world.projectiles.length, shots: window.__game.world.stats.shots }; });
  const key = (c, d) => page.evaluate(([c, d]) => window.__game.input.simulateKey(c, d), [c, d]);
  const mouse = (b, d) => page.evaluate(([b, d]) => window.__game.input.simulateMouse(b, d), [b, d]);

  await S(1 / 60, 30);
  let s = await st();
  check('接地', s.g && Math.abs(s.pos[1]) < 0.05, s);

  // 移動
  await key('KeyW', true); await S(1 / 60, 60); await key('KeyW', false);
  s = await st();
  check('W 1秒で約 -z に 6m', s.pos[2] < -5 && s.pos[2] > -7.2 && Math.abs(s.pos[0]) < 0.1, s);
  await S(1 / 60, 30);
  await shot('walk');

  // 視点（右へ）→ D 移動
  await page.evaluate(() => window.__game.input.simulateLook(-300, 0)); // 左に回す
  await S(1 / 60, 2);
  const yaw = await page.evaluate(() => window.__game.world.player.yaw);
  check('マウス左で yaw 増加', yaw > 0.5, { yaw });
  await page.evaluate(() => window.__game.input.simulateLook(300, 0)); await S(1 / 60, 2);

  // ジャンプ
  s = await st(); const y0 = s.pos[1];
  await key('Space', true); await S(1 / 60, 1); await key('Space', false);
  let maxY = 0; for (let i = 0; i < 60; i++) { await S(1 / 60, 1); maxY = Math.max(maxY, (await st()).pos[1]); }
  s = await st();
  check('ジャンプ高さ ~1.5m と着地', maxY > 1.2 && maxY < 1.8 && s.g, { maxY, s });

  // 回避
  s = await st(); const e0 = s.en, p0 = s.pos;
  await key('KeyD', true); await S(1 / 60, 2); await key('KeyC', true); await S(1 / 60, 1); await key('KeyC', false);
  const inv = await page.evaluate(() => window.__game.world.player.invuln);
  await S(1 / 60, 20); await key('KeyD', false); await S(1 / 60, 20);
  s = await st();
  check('回避 電力-4 / 無敵 / 横移動', Math.abs((e0 - s.en) - 4) < 0.01 && inv > 0.25 && s.pos[0] - p0[0] > 3, { e0, en: s.en, inv, dx: s.pos[0] - p0[0] });
  await S(1 / 60, 40);

  // 単発
  s = await st(); const e1 = s.en;
  await mouse(0, true); await S(1 / 60, 1); await mouse(0, false); await S(1 / 60, 2);
  s = await st();
  check('単発 電力-8 / 弾1 / shots=1', Math.abs((e1 - s.en) - 8) < 0.01 && s.proj >= 1 && s.shots === 1, { e1, en: s.en, proj: s.proj, shots: s.shots });
  const dmg = await page.evaluate(() => window.__game.world.projectiles[0] && { d: window.__game.world.projectiles[0].damage, v: window.__game.world.projectiles[0].vel.length(), ch: window.__game.world.projectiles[0].charged });
  check('単発弾 damage 20 speed 70', dmg && dmg.d === 20 && Math.abs(dmg.v - 70) < 0.1, dmg);
  await S(1 / 60, 120);

  // 溜め撃ち
  s = await st(); const e2 = s.en;
  await mouse(0, true); await S(1 / 60, 40); await shot('charging_half');
  await S(1 / 60, 50);
  s = await st();
  check('溜め 満タン', s.ch >= 0.99, s);
  await shot('charging_full');
  const cd = await page.evaluate(() => { const g = window.__game; g.input.simulateMouse(0, false); g.step(1 / 60, 1); const p = g.world.projectiles.find((q) => q.charged); return p && { d: p.damage, r: p.radius, v: p.vel.length() }; });
  s = await st();
  check('溜め撃ち 電力-12 / damage 48', Math.abs((e2 - s.en) - 12) < 0.05 && cd && Math.abs(cd.d - 48) < 0.01, { e2, en: s.en, cd });
  await S(1 / 60, 100);

  // 溜めキャンセル（Shift）
  s = await st(); const e3 = s.en;
  await mouse(0, true); await S(1 / 60, 30);
  await key('KeyC', true); await S(1 / 60, 1); await key('KeyC', false);
  await mouse(0, false); await S(1 / 60, 3);
  s = await st();
  const ev = await page.evaluate(() => window.__ev);
  check('溜めキャンセル 弾なし・電力減ったまま', ev.includes('chargeCancel') && s.proj === 0 && s.en < e3 && s.shots === 2, { ev: ev.slice(-6), s });
  await S(1 / 60, 40);

  // 吸収中は撃てない
  await page.evaluate(() => { window.__game.world.player.absorbing = true; });
  s = await st(); const e4 = s.en;
  await mouse(0, true); await S(1 / 60, 2); await mouse(0, false); await S(1 / 60, 2);
  s = await st();
  check('吸収中は撃てない', s.en === e4 && s.shots === 2, s);
  await page.evaluate(() => { window.__game.world.player.absorbing = false; });
  await S(1 / 60, 30);

  // 電力不足
  await page.evaluate(() => { window.__game.world.player.energy = 1; window.__ev.length = 0; });
  await mouse(0, true); await S(1 / 60, 1); await mouse(0, false); await S(1 / 60, 2);
  const ev2 = await page.evaluate(() => window.__ev);
  check('電力不足で noEnergy', ev2.includes('noEnergy') && !ev2.includes('shot:false'), ev2);
  await page.evaluate(() => { window.__game.world.player.energy = 80; });

  // 飛行
  await page.evaluate(() => { window.__game.world.functions.flight = true; });
  s = await st(); const e5 = s.en;
  await key('Space', true); await S(1 / 60, 90);
  s = await st();
  check('飛行 上昇・消費', s.fly && s.pos[1] > 4 && s.en < e5 - 8, { s, e5 });
  await shot('flying');
  await key('Space', false); await S(1 / 60, 150);
  s = await st();
  check('離すと落下→着地', s.g && !s.fly, s);
  // 電力切れで落ちる
  await page.evaluate(() => { window.__game.world.player.energy = 3; });
  await key('Space', true); await S(1 / 60, 90);
  s = await st();
  check('電力0で飛行終了', !s.fly && s.en === 0, s);
  await key('Space', false); await S(1 / 60, 120);
  await page.evaluate(() => { const w = window.__game.world; w.player.energy = 80; w.functions.flight = false; });

  // 被弾点滅
  await page.evaluate(() => { const w = window.__game.world; w.player.hp -= 10; });
  await S(1 / 60, 3);
  await shot('hit');
  await S(1 / 60, 30);

  // カメラ壁めり込み防止: 壁に背を向ける
  await page.evaluate(() => { const w = window.__game.world; w.player.pos.set(0, 0, -12.2); w.player.yaw = 0; });
  await S(1 / 60, 30);
  // 前を向いて壁の近く、カメラは手前(+z)側。後ろ向きで壁にカメラが押し付けられるケース
  await page.evaluate(() => { const w = window.__game.world; w.player.yaw = Math.PI; w.player.pos.set(0, 0, -12.2); });
  await S(1 / 60, 30);
  const cam = await page.evaluate(() => { const w = window.__game.world; return { c: w.camera.position.toArray().map((v) => +v.toFixed(2)), p: w.player.pos.toArray().map((v) => +v.toFixed(2)) }; });
  check('カメラが壁(z=-13)の内側', cam.c[2] > -13, cam);
  await shot('camwall');

  // 照準
  await page.evaluate(() => { const w = window.__game.world; w.player.yaw = 0; w.player.pos.set(0, 0, 0); w.player.pitch = 0; });
  await S(1 / 60, 5);
  const aim = await page.evaluate(() => { const w = window.__game.world; return { o: w.aimOrigin.toArray().map((v) => +v.toFixed(2)), d: w.aimDir.toArray().map((v) => +v.toFixed(3)) }; });
  check('aimDir は -z 向きで正規化', aim.d[2] < -0.9, aim);
  await shot('idle');
  // タイトル演出（HUD を隠して前から見る）
  await page.evaluate(() => {
    document.getElementById('hud').style.display = 'none';
    const w = window.__game.world; w.state = 'title'; w.player.pos.set(0, 0, 0); w.player.energy = 90;
    w.time = Math.PI / 0.3; // カメラがプレイヤーの正面(-z)側へ回る
  });
  await S(0, 2);
  const tc = await page.evaluate(() => window.__game.world.camera.position.toArray().map((v) => +v.toFixed(2)));
  check('タイトル: カメラが周りを回る', tc[2] < -4, tc);
  await shot('front');
  await page.evaluate(() => { const w = window.__game.world; w.player.flying = true; w.player.pos.y = 1.5; w.player.hp = 80; });
  await S(0, 2);
  await shot('front_fly');
  await page.evaluate(() => { const w = window.__game.world; w.player.flying = false; w.player.pos.y = 0; w.time = 4; });
  await S(0, 2);
  await shot('side');
} finally {
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAIL');
  await browser.close();
  server.kill();
}
