// 使い方: node tests/e2e/beamer_check.mjs   （ポート 5301）
// ビーマーの溜め中（照準線）・ロック・発射・中断を撮影し、挙動をチェックする
// 出力: tests/e2e/out/beamer_{charge,lock,fire,interrupt}.png
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = 5301;
fs.mkdirSync('tests/e2e/out', { recursive: true });
const server = spawn('npx', ['vite', '--config', 'tests/e2e/player.vite.config.mjs', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes('Local')) res(); }); setTimeout(res, 8000); });
const winExe = `${process.env.LOCALAPPDATA}/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe`;
const exe = process.env.CHROME_EXE ?? (fs.existsSync(winExe) ? winExe : '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const T0 = Date.now();
const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info), `[${((Date.now() - T0) / 1000).toFixed(0)}s]`); };

try {
  await page.goto(`http://localhost:${port}/?manual`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  // 遠く(x=+400)に闘技場を作る
  await page.evaluate(async () => {
    const g = window.__game, w = g.world, T = g.THREE;
    const OX = 400;
    for (const o of w.scene.children.slice()) if (o !== w.player.root) o.visible = false;
    const mk = (min, max, color) => {
      w.colliders.push({ min: new T.Vector3(min[0] + OX, min[1], min[2]), max: new T.Vector3(max[0] + OX, max[1], max[2]), active: true });
      const m = new T.Mesh(new T.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]), new T.MeshStandardMaterial({ color }));
      m.position.set((max[0] + min[0]) / 2 + OX, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2);
      m.receiveShadow = true; m.castShadow = true; w.scene.add(m);
    };
    mk([-40, -1, -40], [40, 0, 40], 0xdde6f5);
    mk([-40, 0, -41], [40, 14, -40], 0xffd9c8);
    mk([-41, 0, -40], [-40, 14, 40], 0xffd9c8);
    mk([40, 0, -40], [41, 14, 40], 0xffd9c8);
    mk([-40, 14, -40], [40, 15, 40], 0xeeeeee);
    mk([-40, 0, 40], [40, 14, 41], 0xffd9c8);
    w.scene.background = new T.Color(0xbfd8f0);
    w.scene.add(new T.HemisphereLight(0xffffff, 0x8899bb, 1.1));
    const d = new T.DirectionalLight(0xffffff, 2); d.position.set(OX + 5, 12, 6); d.target.position.set(OX, 0, -10); w.scene.add(d.target); w.scene.add(d);
    window.OX = OX;
    window.api = await import('/src/enemies/api.ts');
    window.ev = {};
    for (const n of ['beamCharge', 'beamFire', 'beamInterrupt', 'enemyAttack', 'playerHit']) { window.ev[n] = []; g.events.on(n, (p) => window.ev[n].push(p)); }
  });
  await page.evaluate(() => window.__game.start());
  const S = (dt, n) => page.evaluate(([dt, n]) => window.__game.step(dt, n), [dt, n]);
  // 条件が成り立つまで 1/30 秒ずつ進める（描画後のヘッドレスは step が遅いので粗めに）
  const until = (fn, max = 1200) => page.evaluate(([fn, max]) => {
    const f = new Function('e', 'w', `return (${fn});`);
    for (let i = 0; i < max; i++) { if (f(window.E, window.__game.world)) return i; window.__game.step(1 / 30, 1); }
    return -1;
  }, [fn, max]);
  const info = () => page.evaluate(() => {
    const w = window.__game.world, e = window.E;
    return { st: e.status, state: e.ai.state, k: +(e.ai.chargeK ?? 0).toFixed(2), locked: !!e.ai.locked, hp: +e.hp.toFixed(1), php: w.player.hp,
      exposed: e.weakPoints[0].exposed, d: +Math.hypot(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z).toFixed(1),
      ev: Object.fromEntries(Object.entries(window.ev).map(([k, v]) => [k, v.length])) };
  });
  // 側面から全体（ビーマーとプレイヤー）を見るカメラで撮る
  // 描画した直後に canvas を読む（page.screenshot は ?manual のヘッドレスだと待たされるため）
  const shot = async (name, cam = { x: 16, y: 4, z: -11, ly: 1.5, lz: -11 }) => {
    const url = await page.evaluate((cam) => {
      const g = window.__game, w = g.world, OX = window.OX;
      w.camera.position.set(OX + cam.x, cam.y, cam.z);
      w.camera.lookAt(OX, cam.ly, cam.lz);
      g.render();
      return document.querySelector('canvas').toDataURL('image/png');
    }, cam);
    fs.writeFileSync(`tests/e2e/out/beamer_${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  };
  const stage = () => page.evaluate(() => {
    const w = window.__game.world;
    for (const e of w.enemies) w.scene.remove(e.root);
    w.enemies.length = 0;
    for (const k of Object.keys(window.ev)) window.ev[k].length = 0;
    w.player.hp = 100; w.player.maxHp = 100; w.player.energy = 80; w.player.invuln = 0;
    w.player.pos.set(window.OX, 0.5, 2); w.player.vel.set(0, 0, 0); w.player.yaw = 0; w.player.pitch = 0;
    w.level.currentRoom = -1;
    const g = window.__game;
    const e = window.api.spawnEnemy(w, 'beamer', new g.THREE.Vector3(window.OX, 1.1, -20));
    e.ai.alert = 1e6; e.ai.cd = 0.2;
    window.E = e;
  });

  // ---- 1周：溜め → ロック → 発射
  await stage();
  await S(1 / 30, 5);
  let s = await info();
  check('待機中：レンズは露出していない', s.state === 'idle' && s.exposed === false, s);
  check('溜めが始まる', (await until('e.ai.state === "charge" && e.ai.st > 1.0')) >= 0, await info());
  s = await info();
  check('溜め中：レンズ露出・beamCharge 発行', s.exposed && s.ev.beamCharge === 1, s);
  await shot('charge');
  check('照準がロックされる', (await until('e.ai.locked')) >= 0, await info());
  await S(1 / 30, 8);
  await shot('lock');
  check('発射する', (await until('e.ai.state === "fire"')) >= 0, await info());
  await S(1 / 30, 6);
  await shot('fire');
  await S(1 / 30, 40);
  s = await info();
  check('ダメージは1回(30)・beamFire/enemyAttack 1回', s.php === 70 && s.ev.beamFire === 1 && s.ev.enemyAttack === 1 && s.ev.playerHit === 1, s);
  check('発射後：レンズは閉じる', s.exposed === false, s);

  // ---- 2周目：ロックを見て横へ避ける
  await stage();
  await until('e.ai.locked');
  await page.evaluate(() => { window.__game.world.player.pos.x += 8; });
  await until('e.ai.state === "recover"');
  s = await info();
  check('ロック後に避ければ無傷', s.php === 100 && s.ev.beamFire === 1, s);

  // ---- 3周目：溜め中に弱点を撃って中断
  await stage();
  await until('e.ai.state === "charge" && e.ai.st > 0.8');
  await page.evaluate(() => { window.api.damageEnemy(window.__game.world, window.E, 12, { weak: true, how: 'shot' }); });
  await S(1 / 30, 6);
  s = await info();
  check('弱点への一撃で中断・スタン', s.st === 'stunned' && s.state === 'idle' && s.ev.beamInterrupt === 1 && s.ev.beamFire === 0, s);
  await shot('interrupt');
  await S(1 / 30, 60);
  s = await info();
  check('スタン後に復帰する', s.st === 'active', s);
} finally {
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  console.log(results.every(Boolean) ? 'ALL PASS' : `FAILED ${results.filter((x) => !x).length}/${results.length}`);
  await browser.close();
  server.kill();
}
