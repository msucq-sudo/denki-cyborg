// 車と運転の確認: CHROME_EXE=... node tests/e2e/drive_check.mjs   （ポート 5332）
// ?level=surge&start=drive で車に乗った状態から始め、運転・タイミング加速・T字路・敵のはね飛ばし・障害物・判定地点を確かめる。
// 出力: tests/e2e/out/drive_*.png
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';

const port = Number(process.env.PORT ?? 5332);
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const exe = process.env.CHROME_EXE ?? '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1024), height: Number(process.env.H ?? 576) } });
// Google Fonts を待つとスクショが固まる
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_') && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, info === undefined ? '' : JSON.stringify(info)); };
const run = (n, dt = 1 / 60) => page.evaluate(([n, dt]) => window.__game.step(dt, n), [n, dt]);
const shot = async (name) => {
  await page.evaluate(() => window.__game.render());
  await page.waitForTimeout(300); // CSS アニメーション（壁時計）が落ち着くのを待つ
  await page.screenshot({ path: `${outDir}/drive_${name}.png`, timeout: 280000 });
  console.log('shot', name);
};
const st = () => page.evaluate(() => {
  const d = window.__drive.state, w = window.__drive.world;
  return {
    phase: d.phase, mode: d.mode, kmh: Math.round(d.speed * 3.6), x: +d.pos.x.toFixed(1), z: +d.pos.z.toFixed(1), yaw: +d.yaw.toFixed(2),
    hp: w.player.hp, hits: d.hits, locked: window.__game.input.locked, playerVisible: w.player.root.visible, bumps: d.bumps,
    presses: d.presses, perfects: d.perfects, goods: d.goods, misses: d.misses, result: d.result,
  };
});
/** 次のフレームで加速ボタンを押す。q='perfect'|'good'|'miss' でカーソルの位置を合わせてから */
const press = async (q = 'perfect') => {
  await page.evaluate((q) => {
    const d = window.__drive.state;
    const P = 1.6; // DRIVE.barPeriod
    const c = q === 'perfect' ? 0.5 : q === 'good' ? 0.34 : 0.05;
    d.cursorT = (c / 2) * P - 1 / 60;
    d.cooldown = 0;
    window.__game.input.simulateKey('Space', true);
  }, q);
  await run(1);
  await page.evaluate(() => window.__game.input.simulateKey('Space', false));
};
/** ページ内で条件が成り立つまで（最大 max フレーム）進める。往復を減らして速くする。pressEvery>0 なら一定間隔で PERFECT を押す */
const runUntil = (cond, max, pressEvery = 0) => page.evaluate(([cond, max, pressEvery]) => {
  const g = window.__game, d = window.__drive.state;
  const fn = new Function('d', `return (${cond})`);
  for (let i = 0; i < max; i++) {
    if (pressEvery && i % pressEvery === 0) { d.cursorT = 0.25 * 1.6 - 1 / 60; d.cooldown = 0; g.input.simulateKey('Space', true); }
    g.step(1 / 60, 1);
    if (pressEvery && i % pressEvery === 0) g.input.simulateKey('Space', false);
    if (fn(d)) return i;
  }
  return -1;
}, [cond, max, pressEvery]);
const hold = (k, on = true) => page.evaluate(([k, on]) => window.__game.input.simulateKey(k, on), [k, on]);
const evLog = () => page.evaluate(() => window.__evlog);

try {
  await page.goto(`http://localhost:${port}/?level=surge&start=drive&manual`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  await page.addStyleTag({ content: '*, *::before, *::after { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }' });
  await page.evaluate(() => {
    const g = window.__game;
    window.__evlog = [];
    for (const e of ['driveStart', 'driveBoost', 'driveHitEnemy', 'driveCrash', 'driveBump', 'driveCheckpoint', 'gameOver']) g.events.on(e, (p) => window.__evlog.push({ e, ...(p && p.quality ? { q: p.quality } : {}), ...(p && p.ok !== undefined ? { ok: p.ok, kmh: Math.round(p.kmh) } : {}) }));
    g.start();
    g.step(1 / 60, 10);
  });
  await page.waitForFunction(() => !!window.__drive, null, { timeout: 30000 });
  let s = await st();
  check('start=drive で乗って運転中', s.phase === 'driving', s);
  check('体が隠れ、操作がロックされる', s.playerVisible === false && s.locked === true, s);
  check('通常 HUD に driving クラス', await page.evaluate(() => document.getElementById('hud').classList.contains('driving')));

  // ---- 車の近景（本物のゲームのシーンで）
  await page.evaluate(() => {
    const d = window.__drive.state, T = window.__game.THREE, cam = window.__game.current.camera;
    window.__camShot = (name, off, look) => {
      const p = d.pos, r = d.car.root;
      const m = new T.Matrix4().makeRotationY(r.rotation.y);
      const o = new T.Vector3(...off).applyMatrix4(m).add(new T.Vector3(p.x, 0, p.z));
      const l = new T.Vector3(...look).applyMatrix4(m).add(new T.Vector3(p.x, 0, p.z));
      cam.position.copy(o); cam.lookAt(l); cam.fov = 50; cam.updateProjectionMatrix();
    };
  });
  const closeups = [
    ['front', [-4.2, 1.9, -5.6], [0, 1.0, 0.3]],
    ['side', [-7.0, 1.4, 0.4], [0, 1.0, 0.4]],
    ['behind', [-1.6, 2.6, 5.4], [0, 1.15, -0.4]],
  ];
  for (const [n, off, look] of closeups) {
    await page.evaluate(([n, off, look]) => { window.__game.current.world; window.__camShot(n, off, look); }, [n, off, look]);
    await shot(`car_${n}`);
  }

  // ---- 通常の運転：加速して、バーの HUD
  await run(5);
  await press('perfect');
  await run(20);
  s = await st();
  check('PERFECT で加速する', s.kmh > 5 && s.perfects === 1, s);
  await shot('start_perfect');
  await runUntil('false', 60 * 4, 40);
  s = await st();
  check('T字路の手前は 90km/h まで', s.kmh <= 91, s);
  await press('good');
  await run(20);
  await shot('turn_hint');
  check('「← 左折」が出ている', await page.evaluate(() => !document.querySelector('.dv-turn').classList.contains('off')));

  // ---- 右（東）へ行って壁に軽くぶつかる（失敗ではない）
  await hold('KeyD', true);
  const bumped = (await runUntil("d.mode === 'bounce'", 60 * 25, 10)) >= 0;
  await hold('KeyD', false);
  await run(8);
  await shot('bump');
  s = await st();
  check('東の柵に軽くぶつかる（失敗にならない）', bumped && s.phase === 'driving' && s.hp > 0, s);
  // 立て直し → 左折して西へ
  await runUntil("d.mode === 'west'", 60 * 8, 10);
  s = await st();
  check('立て直して西向きの直線に入る', s.mode === 'west' && Math.abs(s.yaw - 1.57) < 0.02, s);
  await shot('west_start');

  // ---- 速度が上がる：直線の序盤
  await page.evaluate(() => window.__drive.teleport(-100));
  await page.evaluate(() => window.__drive.setSpeed(200));
  await run(30);
  await runUntil('false', 60 * 2, 25);
  s = await st();
  check('直線で 90km/h を超えて加速できる', s.kmh > 150, s);
  check('速いと風の筋（スピード線）が出る', await page.evaluate(() => window.__drive.state.fx.mesh.visible));
  await shot('fast');

  // ---- 雑魚をはね飛ばす
  const zk = await page.evaluate(() => {
    const d = window.__drive.state;
    const z = d.zako.find((q) => q.state === 'idle' && q.pos.x < -200);
    window.__zk = z;
    window.__drive.teleport(z.pos.x + 40, z.pos.z);
    window.__drive.setSpeed(150);
    return { kind: z.kind, x: z.pos.x, z: z.pos.z };
  });
  await run(40);
  const before = (await st()).hits;
  await runUntil(`d.hits > ${before}`, 80);
  await run(6);
  s = await st();
  check('雑魚をはね飛ばした', s.hits > before && (await page.evaluate(() => window.__zk.state)) === 'flung', { ...s, zk });
  await shot('fling');
  await run(8);
  await shot('fling2');
  const hitEv = await evLog();
  check('driveHitEnemy が出る', hitEv.some((e) => e.e === 'driveHitEnemy'));
  // 数体まとめて（カメラから見て多数）
  await page.evaluate(() => {
    const d = window.__drive.state;
    const xs = d.zako.filter((q) => q.state === 'idle').map((q) => q.pos.x).sort((a, b) => b - a);
    window.__drive.teleport(xs[0] + 70); window.__drive.setSpeed(190);
  });
  await run(70);
  await shot('zako_road');

  // ---- 障害物の近く（読みやすさ）
  const ob = await page.evaluate(() => {
    const o = window.__drive.obstacles();
    return o.find((q) => q.kind === 'barricade') ?? o[0];
  });
  await page.evaluate((ob) => {
    const safe = -90 + (ob.z > -90 ? -4 : 4);
    window.__drive.teleport(ob.x + 70, safe); window.__drive.setSpeed(150);
    // 手前の雑魚は片付けて見やすく
    for (const z of window.__drive.state.zako) if (z.state === 'idle' && Math.abs(z.pos.x - ob.x) < 200) z.root.visible = false;
  }, ob);
  await run(10);
  await shot('obstacle_far');
  await page.evaluate((ob) => { window.__drive.teleport(ob.x + 24, -90 + (ob.z > -90 ? -4 : 4)); }, ob);
  await run(8);
  await shot('obstacle_near');
  for (const kind of ['crates', 'wreck']) {
    const o2 = await page.evaluate((kind) => window.__drive.obstacles().find((q) => q.kind === kind), kind);
    await page.evaluate((o2) => { window.__drive.teleport(o2.x + 22, -90 + (o2.z > -90 ? -4 : 4)); window.__drive.setSpeed(60); }, o2);
    await run(8);
    await shot(`obstacle_${kind}`);
  }

  // ---- 障害物に激突 → 死亡画面
  await page.evaluate((ob) => { window.__drive.teleport(ob.x + 30, ob.z); window.__drive.setSpeed(200); }, ob);
  await runUntil("d.phase === 'crashed'", 90);
  s = await st();
  check('障害物に当たると crashed', s.phase === 'crashed', s);
  await run(6);
  await shot('crash');
  await run(14);
  await shot('crash_later');
  await run(70);
  s = await st();
  check('しばらくして HP 0 → ゲームオーバー', s.hp === 0 && (await page.evaluate(() => window.__game.current.state)) === 'gameover', s);
  await shot('gameover');
  check('driveCrash が出る', (await evLog()).some((e) => e.e === 'driveCrash'));
  check('衝突後も通常 HUD は隠れたまま（運転 HUD だけ消える）', await page.evaluate(() => document.getElementById('hud').classList.contains('driving') && document.querySelector('.dv').classList.contains('off')));

  // ---- 判定地点（別の World で）
  await page.goto(`http://localhost:${port}/?level=surge&start=drive&manual`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  await page.addStyleTag({ content: '*, *::before, *::after { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }' });
  await page.evaluate(() => {
    const g = window.__game; window.__evlog = [];
    for (const e of ['driveCheckpoint', 'fenceBreak', 'carWallCrash', 'carCaught', 'slowmo']) g.events.on(e, (p) => window.__evlog.push({ e, ...(p && p.ok !== undefined ? { ok: p.ok, kmh: Math.round(p.kmh) } : {}) }));
    g.start(); g.step(1 / 60, 10);
  });
  await page.evaluate(() => { window.__drive.teleport(-1330); window.__drive.setSpeed(320); });
  await run(30);
  await shot('checkpoint_ok_pre');
  await runUntil("d.phase !== 'driving'", 60 * 3);
  s = await st();
  check('判定地点を 320km/h で越えると cutscene(success)', s.phase === 'cutscene' && s.result === 'success', s);
  check('driveCheckpoint ok=true', (await evLog()).some((e) => e.e === 'driveCheckpoint' && e.ok === true));
  await run(60 * 2);
  await shot('cutscene_success');
} finally {
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (errors.length) console.log('ERRORS', errors.slice(0, 10));
  await browser.close();
  await server.close();
  process.exit(failed || errors.length ? 1 : 0);
}
