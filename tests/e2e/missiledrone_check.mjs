// ミサイルドローンの確認: CHROME_EXE=... node tests/e2e/missiledrone_check.mjs   （ポート 5305）
// 予備動作 / 斉射の飛翔 / 撃ち落とし / 装填 のスクショ → tests/e2e/out/missiledrone_*.png、コンソールエラーの有無
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';

const port = 5305;
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
// 他担当のファイル編集による HMR リロードでテストが壊れないよう監視と HMR を切る
const server = await createServer({ root: process.cwd(), server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const winExe = `${process.env.LOCALAPPDATA}/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe`;
const exe = process.env.CHROME_EXE ?? (fs.existsSync(winExe) ? winExe : '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
// 外部フォント（Google Fonts）はサンドボックスでは届かず、スクショが「フォント待ち」で止まるので空応答にする
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info ?? '')); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const S = (dt, n) => ev(([dt, n]) => window.__game.step(dt, n), [dt, n]);
const shot = async (name, lookAt = 'E') => {
  await ev((lookAt) => {
    const w = window.__game.world, p = w.player;
    const e = window[lookAt];
    document.getElementById('hud') && (document.getElementById('hud').style.display = 'none');
    if (e) {
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, dy = e.pos.y - (p.pos.y + 1.6);
      p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)) * 0.8;
    }
    window.__game.step(1 / 600, 2);
    window.__game.render();
  }, lookAt);
  await page.screenshot({ path: `${outDir}/missiledrone_${name}.png`, timeout: 120000 });
  console.log('shot', name);
};
const missiles = () => ev(() => window.__game.world.projectiles.filter((p) => p.shootable && !p.dead).map((p) => ({ x: +p.pos.x.toFixed(1), y: +p.pos.y.toFixed(1), z: +p.pos.z.toFixed(1), hp: p.hp })));

try {
  console.log('goto');
  await page.goto(`http://localhost:${port}/?manual`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  console.log('loaded');
  await ev(async () => {
    const g = window.__game, w = g.world, T = g.THREE;
    g.start();
    const OX = 400;
    for (const o of w.scene.children.slice()) if (o !== w.player.root) o.visible = false;
    const mk = (min, max, color) => {
      w.colliders.push({ min: new T.Vector3(min[0] + OX, min[1], min[2]), max: new T.Vector3(max[0] + OX, max[1], max[2]), active: true });
      const m = new T.Mesh(new T.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]), new T.MeshStandardMaterial({ color }));
      m.position.set((max[0] + min[0]) / 2 + OX, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2);
      m.receiveShadow = true; w.scene.add(m);
    };
    mk([-30, -1, -30], [30, 0, 30], 0xdde6f5);
    mk([-30, 0, -31], [30, 14, -30], 0xffd9c8);
    mk([-31, 0, -30], [-30, 14, 30], 0xffd9c8);
    mk([30, 0, -30], [31, 14, 30], 0xffd9c8);
    mk([-30, 14, -30], [30, 15, 30], 0xeeeeee);
    mk([-30, 0, 30], [30, 14, 31], 0xffd9c8);
    w.scene.background = new T.Color(0xbfd8f0);
    w.scene.add(new T.HemisphereLight(0xffffff, 0x8899bb, 1.1));
    const d = new T.DirectionalLight(0xffffff, 2); d.position.set(OX + 5, 12, 6); w.scene.add(d);
    window.OX = OX;
    window.api = await import('/src/enemies/api.ts');
    window.ev = { enemyAttack: [], missileDown: [], missileBlast: [], enemyAction: [] };
    for (const n of Object.keys(window.ev)) g.events.on(n, (p) => window.ev[n].push(p));
    w.player.hp = 1e6; w.player.maxHp = 1e6; w.player.energy = 80;
    w.player.pos.set(OX, 0.5, 0); w.player.vel.set(0, 0, 0); w.player.yaw = 0; w.player.pitch = 0.1;
    w.level.currentRoom = -1;
    const e = window.api.spawnEnemy(w, 'missileDrone', new T.Vector3(OX + 3, 3.5, -12));
    window.E = e;
  });
  console.log('arena ready');
  await S(1 / 60, 20);
  console.log('stepped');
  const info = () => ev(() => { const w = window.__game.world, e = window.E; return { mode: e.ai.mode, pods: e.ai.pods.map((p) => +p.toFixed(2)), atk: +e.ai.atkTimer.toFixed(2), d: +Math.hypot(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z).toFixed(1), y: +e.pos.y.toFixed(1), alert: e.ai.alert, n: w.projectiles.length }; });
  console.log('start', JSON.stringify(await info()));
  check('気づいて周回している', (await info()).alert > 0);

  // 予備動作 → 斉射を待つ（ページ内で1フレームずつ進めて条件を待つ。往復を減らす）
  const until = (cond, maxFrames) => ev(([cond, maxFrames]) => {
    const f = new Function('e', 'w', `return (${cond});`);
    for (let i = 0; i < maxFrames; i++) { window.__game.step(1 / 60, 1); if (f(window.E, window.__game.world)) return i; }
    return -1;
  }, [cond, maxFrames]);
  let n = await until("e.ai.mode === 'tele' && e.ai.lit.filter((l) => l > 0.5).length >= 2", 60 * 12);
  console.log('tele at frame', n, JSON.stringify(await info()));
  check('予備動作でポッドが点灯', n >= 0 && (await ev(() => window.E.ai.lit.filter((l) => l > 0.5).length)) >= 2);
  await shot('1_telegraph');
  n = await until("e.ai.mode === 'fire' && e.ai.fireIdx >= 2", 60 * 4);
  await shot('2_ripple');
  n = await until("e.ai.mode === 'idle'", 60 * 4);
  console.log('volley done', n);
  const ms0 = await missiles();
  check('斉射でミサイルがちょうど4発', ms0.length === 4, ms0);
  check('enemyAttack が4回', (await ev(() => window.ev.enemyAttack.length)) === 4);
  check('発射後ポッドが空', (await info()).pods.every((p) => p < 1), await info());
  await S(1 / 60, 24);
  await shot('3_flare', 'E');
  const ms1 = await missiles();
  check('ミサイルが左右に開く', ms1.some((m) => m.x > 400 + 3.5) && ms1.some((m) => m.x < 400 + 2.5), ms1);
  await S(1 / 60, 25);
  await shot('4_homing', 'E');

  // 銃で1発撃ち落とす：最寄りのミサイルの方向へ狙って射撃
  const shotRes = await ev(() => {
    const g = window.__game, w = g.world, T = g.THREE;
    const m = w.projectiles.filter((p) => p.shootable && !p.dead).sort((a, b) => a.pos.distanceTo(w.player.pos) - b.pos.distanceTo(w.player.pos))[0];
    if (!m) return { none: true };
    const from = w.player.pos.clone().add(new T.Vector3(0, 1.5, 0));
    const dir = m.pos.clone().sub(from).normalize();
    const before = w.projectiles.filter((p) => p.shootable && !p.dead).length;
    // 弾を直接ミサイルの手前から撃つ（GUN.tapDamage 相当）
    const src = m.pos.clone().addScaledVector(dir, -3);
    window.api.spawnEnemy; // 参照のみ
    return { before, dir: dir.toArray(), src: src.toArray(), mpos: m.pos.toArray() };
  });
  console.log('target', JSON.stringify(shotRes));
  const down = await ev(async () => {
    const g = window.__game, w = g.world, T = g.THREE;
    const { spawnProjectile } = await import('/src/core/projectiles.ts');
    const { GUN } = await import('/src/config/balance.ts');
    const m = w.projectiles.filter((p) => p.shootable && !p.dead).sort((a, b) => a.pos.distanceTo(w.player.pos) - b.pos.distanceTo(w.player.pos))[0];
    const dir = m.pos.clone().sub(w.player.pos.clone().add(new T.Vector3(0, 1.5, 0))).normalize();
    spawnProjectile(w, { pos: m.pos.clone().addScaledVector(dir, -2), vel: dir.clone().multiplyScalar(60), damage: GUN.tapDamage, owner: 'player' });
    const before = w.projectiles.filter((p) => p.shootable && !p.dead).length;
    g.step(1 / 60, 3);
    return { before, after: w.projectiles.filter((p) => p.shootable && !p.dead).length, downEv: window.ev.missileDown.length };
  });
  check('通常弾1発でミサイル1発が落ちる', down.after <= down.before - 1 && down.downEv >= 1, down);
  await shot('5_shotdown', 'E');

  // 残りは放置：着弾（爆発）まで進めてもエラーなし
  await S(1 / 60, 60 * 4);
  check('ミサイルが着弾で消える', (await missiles()).length === 0, await missiles());

  // 装填が進み、次の斉射が来る
  const s2 = await info();
  console.log('after', JSON.stringify(s2));
  let reloaded = false;
  for (let i = 0; i < 60 * 6; i++) { await S(1 / 60, 1); if ((await info()).pods.every((p) => p === 1)) { reloaded = true; break; } }
  check('装填が完了する', reloaded, await info());
  await shot('6_reloaded');

  // 吸い切って倒れる
  await ev(() => { const w = window.__game.world; window.api.drainEnemy(w, window.E, 1e6); });
  await S(1 / 60, 20);
  await shot('7_down');
  await S(1 / 60, 60 * 5);
  check('倒れて消える', (await ev(() => window.__game.world.enemies.length)) === 0);
} finally {
  check('コンソールエラーなし', errors.length === 0, errors.slice(0, 5));
  await browser.close();
  await server.close();
}
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
