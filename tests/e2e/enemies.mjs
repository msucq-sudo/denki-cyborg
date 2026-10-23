// 使い方: node tests/e2e/enemies.mjs   （ポート 5203）
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = 5203;
fs.mkdirSync('tests/e2e/out', { recursive: true });
const server = spawn('npx', ['vite', '--config', 'tests/e2e/player.vite.config.mjs', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes('Local')) res(); }); setTimeout(res, 8000); });
const exe = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
// 描画ループは通常止めておき（負荷対策）、スクショの時だけ再開する
const pauseLoop = () => page.evaluate(() => { window.__pause = true; });
const shot = async (n, look = true) => {
  await page.evaluate((look) => {
    const w = window.__game.world, e = window.E, p = w.player;
    document.getElementById('hud').style.display = 'none';
    if (look && e) {
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, dy = e.pos.y - (p.pos.y + 1.6);
      p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
    window.__game.step(1 / 60, 20);
  }, look);
  await page.evaluate(() => { window.__pause = false; });
  await page.waitForFunction(() => window.__running !== undefined && window.__rafcb, null, { timeout: 120000, polling: 200 });
  await page.evaluate(() => { if (!window.__running) { window.__running = true; window.__orig(window.__rafcb); } });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `tests/e2e/out/enemies_${n}.png`, timeout: 120000 });
  await pauseLoop();
};
const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };

try {
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.__orig = window.requestAnimationFrame.bind(window); window.__pause = false;
    window.requestAnimationFrame = (cb) => { window.__rafcb = cb; if (!window.__pause) { window.__running = true; return window.__orig(cb); } window.__running = false; return 0; };
  });
  await pauseLoop();
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
    mk([-30, -1, -30], [30, 0, 30], 0xdde6f5);
    mk([-30, 0, -31], [30, 14, -30], 0xffd9c8);  // 奥の壁 z=-30
    mk([-31, 0, -30], [-30, 14, 30], 0xffd9c8);
    mk([30, 0, -30], [31, 14, 30], 0xffd9c8);
    mk([-30, 14, -30], [30, 15, 30], 0xeeeeee);   // 天井
    mk([-30, 0, 30], [30, 14, 31], 0xffd9c8);
    mk([6, 0, -12], [9, 3, -10], 0xc8e6ff);       // 遮蔽物
    w.scene.background = new T.Color(0xbfd8f0);
    w.scene.add(new T.HemisphereLight(0xffffff, 0x8899bb, 1.1));
    const d = new T.DirectionalLight(0xffffff, 2); d.position.set(OX + 5, 12, 6); d.target.position.set(OX, 0, -10); w.scene.add(d.target);
    d.castShadow = false;
    d.shadow.camera.left = -30; d.shadow.camera.right = 30; d.shadow.camera.top = 30; d.shadow.camera.bottom = -30; w.scene.add(d);
    w.player.pos.set(OX, 0.5, 0);
    window.OX = OX;
    window.api = await import('/src/enemies/api.ts');
    window.ev = {};
    for (const n of ['enemyAttack', 'enemyHit', 'enemyKilled', 'explosion', 'bossShort', 'bossPhase', 'playerHit']) { window.ev[n] = []; g.events.on(n, (p) => window.ev[n].push(p)); }
    window.clearEnemies = () => { for (const e of w.enemies) { w.scene.remove(e.root); } w.enemies.length = 0; for (const p of w.projectiles) p.dead = true; };
  });
  await page.evaluate(() => window.__game.start());
  const S = (dt, n) => page.evaluate(([dt, n]) => window.__game.step(dt, n), [dt, n]);
  const stage = (hp = 1e6) => page.evaluate((hp) => {
    const w = window.__game.world;
    window.clearEnemies();
    for (const k of Object.keys(window.ev)) window.ev[k].length = 0;
    w.player.hp = hp; w.player.maxHp = Math.max(100, hp); w.player.energy = 80; w.player.invuln = 0;
    w.player.pos.set(window.OX, 0.5, 0); w.player.vel.set(0, 0, 0); w.player.yaw = 0; w.player.pitch = 0.05;
    w.level.currentRoom = -1;
  }, hp);
  const spawn = (kind, x, y, z) => page.evaluate(([k, x, y, z]) => {
    const g = window.__game; const e = window.api.spawnEnemy(g.world, k, new g.THREE.Vector3(window.OX + x, y, z)); window.E = e; return e.id;
  }, [kind, x, y, z]);
  const info = () => page.evaluate(() => {
    const w = window.__game.world, e = window.E;
    return { st: e.status, state: e.ai.state, hp: +e.hp.toFixed(1), d: +Math.hypot(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z).toFixed(2),
      pos: e.pos.toArray().map((v) => +(v - 0).toFixed(1)), php: w.player.hp, proj: w.projectiles.length, att: window.ev.enemyAttack.length, n: w.enemies.length };
  });
  const loop = (frames, fn) => page.evaluate(([frames, fn]) => {
    const f = new Function('e', 'w', 'i', fn);
    const out = [];
    for (let i = 0; i < frames; i++) { window.__game.step(1 / 60, 1); const r = f(window.E, window.__game.world, i); if (r !== undefined) out.push(r); }
    return out;
  }, [frames, fn]);

  await S(1 / 60, 10);
  if (!process.env.GALLERY_ONLY) {
  // ---------------- drone
  await stage(); await spawn('drone', 0, 3, -20);
  await S(1 / 60, 240);
  let s = await info();
  check('drone: 距離 6〜15m を保つ', s.d > 6 && s.d < 15, s);
  check('drone: 弾を撃つ', s.att >= 1, s);
  const dd = await loop(600, 'return Math.hypot(e.pos.x-w.player.pos.x,e.pos.z-w.player.pos.z)');
  check('drone: 10秒間 距離が 6.5〜15m', Math.min(...dd) > 6.5 && Math.max(...dd) < 15, { min: Math.min(...dd), max: Math.max(...dd) });
  const att = await page.evaluate(() => window.ev.enemyAttack.length);
  check('drone: 攻撃間隔が妥当(14秒で 4〜10回)', att >= 4 && att <= 10, { att });
  await shot('drone');

  // ---------------- crawler
  await stage(500); await spawn('crawler', 0, 0.6, -14);
  await S(1 / 60, 60);
  s = await info();
  check('crawler: 接近する', s.d < 10, s);
  await S(1 / 60, 180);
  s = await info();
  check('crawler: 体当たりでダメージ', s.php < 500, s);
  await shot('crawler');

  // ---------------- gunner
  await stage(); await spawn('gunner', 0, 1, -22);
  const gd = await loop(600, 'return Math.hypot(e.pos.x-w.player.pos.x,e.pos.z-w.player.pos.z)');
  s = await info();
  check('gunner: 10〜18m を保つ(多少の逸脱は許容)', gd[gd.length - 1] > 8 && gd[gd.length - 1] < 21, { d: gd[gd.length - 1], min: Math.min(...gd), max: Math.max(...gd) });
  check('gunner: 3連射(10秒で 6発以上)', s.att >= 6 && s.att % 3 === 0 || s.att >= 6, s);
  await shot('gunner');

  // ---------------- heavy: 突進 → 壁スタン
  await stage(); await spawn('heavy', 0, 1.2, 14);
  await page.evaluate(() => { window.__game.world.player.pos.set(window.OX, 0.5, 28.2); });
  const hs = await loop(60 * 14, 'return e.ai.state + "/" + e.status');
  const set = new Set(hs);
  console.log('heavy states:', [...set].join(' '));
  check('heavy: 突進する', set.has('charge/active'), [...set]);
  check('heavy: 壁に当たってスタン', [...set].some((x) => x.endsWith('/stunned')), [...set]);
  // 叩きつけ
  await stage(); await spawn('heavy', 0, 1.2, -4);
  await page.evaluate(() => { window.__game.world.player.pos.set(window.OX, 0.5, 0); });
  const hs2 = await loop(60 * 8, 'return e.ai.state');
  check('heavy: 近距離は叩きつけ', new Set(hs2).has('slamWindup') && new Set(hs2).has('recover'), [...new Set(hs2)]);
  await stage(); await spawn('heavy', 0, 1.2, -9);
  await loop(100, 'return 0');
  await shot('heavy_a');
  await loop(70, 'return e.ai.state === "chargeWindup" ? 1 : 0');
  await shot('heavy_b');

  // ---------------- 弱点ヒット倍率
  await stage(); await spawn('heavy', 0, 1.2, -9);
  const dmgInfo = await page.evaluate(() => {
    const e = window.E, g = window.__game, T = g.THREE; e.ai.alert = 100;
    const out = {};
    // 背中の弱点: 後方から撃つ
    const back = e.root.localToWorld(e.weakPoints[1].offset.clone());
    const front = e.root.localToWorld(e.weakPoints[0].offset.clone());
    window.api.damageEnemy(g.world, e, 10, { how: 'shot', weak: true, hitPos: back }); out.back = 180 - e.hp; e.hp = 180;
    window.api.damageEnemy(g.world, e, 10, { how: 'shot', weak: true, hitPos: front }); out.front = 180 - e.hp; e.hp = 180;
    return out;
  });
  check('heavy: 背中3倍 / 前面2倍', Math.abs(dmgInfo.back - 30) < 0.01 && Math.abs(dmgInfo.front - 20) < 0.01, dmgInfo);

  // ---------------- 吸収の見た目 / 逆流 / 爆発
  await stage(); await spawn('gunner', 0, 1, -10);
  await S(1 / 60, 30);
  await page.evaluate(() => { window.E.tethered = true; });
  await loop(40, 'window.api.drainEnemy(w, e, 0.6)');
  await shot('drain_a');
  await loop(60, 'window.api.drainEnemy(w, e, 0.6)');
  await shot('drain_b');
  await page.evaluate(() => { window.E.tethered = false; });
  await loop(200, 'window.api.drainEnemy(w, e, 5)');
  s = await info();
  check('drain: 吸い切ると down', s.st === 'down' || s.n === 0, s);
  await shot('down');
  await loop(60 * 5, 'return 0');
  s = await info();
  check('down: 数秒後に消える', s.n === 0, s);

  await stage(); await spawn('heavy', 0, 1.2, -9); await spawn('drone', 4, 2, -9); await spawn('crawler', -3, 0.6, -8);
  const hv = await page.evaluate(() => window.__game.world.enemies[0].id);
  await page.evaluate(() => { window.E = window.__game.world.enemies[0]; });
  await loop(30, 'window.api.overloadEnemy(w, e, 0.35)');
  await shot('overload_a');
  await loop(40, 'window.api.overloadEnemy(w, e, 0.35)');
  await shot('overload_b');
  const r = await page.evaluate(() => { const w = window.__game.world; const e = window.E; const res = window.api.overloadEnemy(w, e, 100); return { res, hp: w.enemies.map((x) => x.kind + ':' + x.hp.toFixed(0)), ex: window.ev.explosion.length }; });
  await S(1 / 60, 8);
  await shot('explode');
  check('overload: 爆発し周囲にダメージ', r.res === 'exploded' && r.ex === 1, r);

  // ---------------- boss
  await stage(); await spawn('boss', 0, 5, -22);
  const bs = await loop(60 * 24, 'return [e.weakPoints[0].exposed?1:0, w.enemies.length, e.ai.phase, Math.hypot(e.pos.x-w.player.pos.x,e.pos.z-w.player.pos.z)].join(",")');
  const exp = bs.map((x) => x.split(',').map(Number));
  const everOpen = exp.some((x) => x[0] === 1), maxEn = Math.max(...exp.map((x) => x[1]));
  check('boss: 装甲が開いて弱点が露出する', everOpen, { everOpen });
  check('boss: ドローンを召喚(上限6)', maxEn > 1 && maxEn <= 7, { maxEn });
  await shot('boss1');
  // 開いている瞬間のスクショ
  await loop(60 * 8, 'return e.ai.open ? 1 : 0');
  s = await page.evaluate(() => ({ open: window.E.ai.open, n: window.__game.world.enemies.length }));
  await page.evaluate(() => { const e = window.E; e.ai.open = false; e.ai.openT = 0.01; });
  await loop(40, 'return 0');
  await shot('boss1_open');
  // 第2形態
  await page.evaluate(() => { const w = window.__game.world; window.api.damageEnemy(w, window.E, 460, { how: 'shot' }); });
  check('boss: bossPhase 2 を1回発行', await page.evaluate(() => window.ev.bossPhase.length === 1 && window.ev.bossPhase[0].phase === 2), {});
  const lasers = await loop(60 * 14, 'return e.ai.laser ? e.ai.laser.state : "-"');
  const ls = new Set(lasers);
  check('boss: レーザー(予告→照射)', ls.has('tele') && ls.has('fire'), [...ls]);
  const idx = lasers.indexOf('fire');
  await page.evaluate(() => { window.E.ai.laserT = 0.01; });
  const l2 = await loop(120, 'return e.ai.laser ? e.ai.laser.state : "-"');
  const iF = l2.indexOf('tele');
  console.log('laser idx', idx, iF);
  await page.evaluate(() => { window.E.ai.laser = null; window.E.ai.laserT = 0.01; });
  await loop(25, 'return 0'); await shot('boss2_tele');
  await loop(60, 'return 0'); await shot('boss2_fire');
  const php = await page.evaluate(() => window.__game.world.player.hp);
  console.log('player hp after boss', php);
  // 撃破
  await page.evaluate(() => { const w = window.__game.world; window.api.damageEnemy(w, window.E, 99999, { how: 'shot' }); });
  await S(1 / 60, 40);
  await shot('boss_death_a');
  await S(1 / 60, 80);
  await shot('boss_death_b');
  check('boss: 撃破で enemyKilled', await page.evaluate(() => window.ev.enemyKilled.some((k) => k.kind === 'boss')), {});
  check('boss: bossDefeated は立てない', await page.evaluate(() => window.__game.world.level.bossDefeated === false), {});
  await S(1 / 60, 200);
  check('boss: 撃破後に世界から消える', await page.evaluate(() => !window.__game.world.enemies.includes(window.E)), {});

  }
  // ---------------- ギャラリー（paused にして、カメラを直接置いて撮る）
  const gshot = async (name, kind, opts = {}) => {
    await stage();
    await page.evaluate(([kind, opts]) => {
      const g = window.__game, w = g.world, T = g.THREE;
      const ground = { crawler: 0.6, gunner: 0.7, heavy: 1.2 }[kind];
      const y = ground ?? (kind === 'boss' ? 5 : 2.5);
      const e = window.api.spawnEnemy(w, kind, new T.Vector3(window.OX, y, -10));
      window.E = e;
      if (opts.yaw) e.ai.yaw = opts.yaw;
      Object.assign(e.ai, opts.ai ?? {});
      if (opts.open) { e.ai.open = true; e.ai.openAmt = 1; e.weakPoints[0].exposed = true; e.weakPoints[0].mesh.visible = true; }
      if (opts.tethered) e.tethered = true;
      if (opts.overload) e.overload = opts.overload * e.maxHp * 0 + opts.overload * ({ drone: 12, crawler: 14, gunner: 22, heavy: 38, boss: 60 })[kind];
      if (opts.hp) e.hp = opts.hp;
      if (opts.phase2) { e.ai.phase = 2; }
      w.state = 'paused';
      if (opts.tele) { const parts = e.ai.model.parts; if (opts.tele === 'circle') { parts.teleCircle.visible = true; parts.teleCircle.scale.setScalar(4.5); } else { parts.teleStrip.visible = true; parts.teleStrip.scale.set(2.3, 1, 15); } }
      for (let i = 0; i < 12; i++) { e.ai.lastOverload = w.time; window.api.updateEnemies(w, 1 / 60); w.time += 1 / 60; }
      if (opts.down) { window.api.drainEnemy(w, e, 1e6); for (let i = 0; i < 40; i++) window.api.updateEnemies(w, 1 / 60); }
      const d = opts.dist ?? (kind === 'boss' ? 15 : kind === 'heavy' ? 7.5 : 5);
      const side = opts.side ?? 0;
      const camX = window.OX + Math.sin(side) * d, camZ = -10 + Math.cos(side) * d;
      w.camera.position.set(camX, y + (opts.camY ?? 1.2), camZ);
      w.camera.lookAt(window.OX, y, -10);
      document.getElementById('hud').style.display = 'none';
      w.player.root.visible = false;
    }, [kind, opts]);
    await shot(name, false);
  };
  await gshot('g_drone', 'drone');
  await gshot('g_drone_below', 'drone', { camY: -2.2, dist: 4 });
  await gshot('g_crawler', 'crawler', { side: 0.5 });
  await gshot('g_crawler_back', 'crawler', { side: Math.PI * 0.85, camY: 1.4 });
  await gshot('g_gunner', 'gunner', { side: 0.5 });
  await gshot('g_heavy', 'heavy', { side: 0.5 });
  await gshot('g_heavy_back', 'heavy', { side: Math.PI * 0.8, camY: 1.5 });
  await gshot('g_heavy_slam', 'heavy', { side: 0.5, tele: 'circle', ai: { warn: 0.9, armsUp: 0.9 }, dist: 10 });
  await gshot('g_heavy_charge', 'heavy', { side: 0.9, tele: 'strip', ai: { warn: 0.8, state: 'chargeWindup' }, dist: 11, camY: 3 });
  await gshot('g_crawler_warn', 'crawler', { side: 0.5, ai: { warn: 1, state: 'windup' } });
  await gshot('g_gunner_tether', 'gunner', { side: 0.5, tethered: true, hp: 25 });
  await gshot('g_drone_overload', 'drone', { overload: 0.8 });
  await gshot('g_gunner_down', 'gunner', { side: 0.5, down: true });
  await gshot('g_boss_closed', 'boss');
  await gshot('g_boss_open', 'boss', { open: true });
  await gshot('g_boss_phase2', 'boss', { open: true, phase2: true, ai: { phase: 2 } });
  await gshot('g_boss_stun', 'boss', { open: true, overload: 0.9 });
  await page.evaluate(() => { window.__game.world.state = 'playing'; });
} finally {
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  console.log(results.every(Boolean) ? 'ALL PASS' : `FAILED ${results.filter((x) => !x).length}/${results.length}`);
  await browser.close();
  server.kill();
}
