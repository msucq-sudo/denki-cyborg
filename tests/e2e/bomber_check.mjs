// ボンバーの確認: node tests/e2e/bomber_check.mjs   （ポート 5306、CHROME_EXE で Chromium を指定）
// 闘技場でボンバーに球を投げさせ、飛行中（着弾予測の輪つき）・爆発の瞬間・ダメージを確認する。
// 出力: tests/e2e/out/bomber_*.png
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';

const port = 5306;
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const exe = process.env.CHROME_EXE ?? '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, info === undefined ? '' : JSON.stringify(info)); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = async (name) => {
  await ev(() => window.__game.render());
  await page.screenshot({ path: `${outDir}/bomber_${name}.png`, timeout: 120000 });
  console.log('shot', name);
};
try {
  await page.goto(`http://localhost:${port}/?manual`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  // 遠く(x=+400)に闘技場を作る
  await ev(async () => {
    const g = window.__game, w = g.current, T = g.THREE;
    const OX = 400;
    for (const o of w.scene.children.slice()) if (o !== w.player.root) o.visible = false;
    const mk = (min, max, color) => {
      w.colliders.push({ min: new T.Vector3(min[0] + OX, min[1], min[2]), max: new T.Vector3(max[0] + OX, max[1], max[2]), active: true });
      const m = new T.Mesh(new T.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]), new T.MeshStandardMaterial({ color }));
      m.position.set((max[0] + min[0]) / 2 + OX, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2);
      m.receiveShadow = true; w.scene.add(m);
    };
    mk([-30, -1, -30], [30, 0, 30], 0x6b7488);
    mk([-30, 0, -31], [30, 14, -30], 0x8a93a8);
    mk([-31, 0, -30], [-30, 14, 30], 0x8a93a8);
    mk([30, 0, -30], [31, 14, 30], 0x8a93a8);
    mk([-30, 14, -30], [30, 15, 30], 0x7a8296);
    mk([-30, 0, 30], [30, 14, 31], 0x8a93a8);
    w.scene.background = new T.Color(0x9fb4d0);
    w.scene.add(new T.HemisphereLight(0xffffff, 0x8899bb, 1.3));
    const d = new T.DirectionalLight(0xffffff, 1.6); d.position.set(OX + 5, 12, 6); d.target.position.set(OX, 0, -10); w.scene.add(d.target); w.scene.add(d);
    window.OX = OX;
    window.log = { attack: 0, action: [], hit: [] };
    g.events.on('enemyAttack', (p) => { if (p.kind === 'bomber') window.log.attack++; });
    g.events.on('enemyAction', (p) => window.log.action.push(p.action));
    g.events.on('playerHit', (p) => window.log.hit.push(p.amount));
  });
  await ev(() => window.__game.start());
  await ev(() => window.__game.step(1 / 60, 5));
  // ボンバーを配置してプレイヤーは止まったまま向き合う
  await ev(async () => {
    const w = window.__game.current, OX = window.OX;
    const api = await import('/src/enemies/enemies.ts');
    const p = w.player;
    p.pos.set(OX, 0, 0); p.vel.set(0, 0, 0); p.yaw = 0; p.pitch = -0.12; p.hp = p.maxHp;
    const e = api.spawnEnemy(w, 'bomber', new window.__game.THREE.Vector3(OX + 1, 0.45, -11));
    e.ai.alert = 100; e.ai.atkTimer = 0.3; e.ai.yaw = 0;
    window.E = e;
  });
  const S = (dt, n) => ev(([dt, n]) => window.__game.step(dt, n), [dt, n]);
  const orbState = () => ev(() => {
    const w = window.__game.current;
    const q = w.projectiles.find((p) => p.blast && p.blast.damage !== undefined);
    return q ? { y: q.pos.y, age: q.age ?? 0, ring: !!q.mesh.userData.ring, shootable: !!q.shootable } : null;
  });
  // 振りかぶり（予告）
  let s = null;
  for (let i = 0; i < 120 && !(await ev(() => window.E.ai.windup > 0.3)); i++) await S(1 / 60, 1);
  await S(1 / 60, 20);
  await shot('windup');
  // 球が飛んだらしばらく待って飛行中を撮る
  for (let i = 0; i < 120 && !(s = await orbState()); i++) await S(1 / 60, 1);
  check('球が投げられた', !!s, s);
  check('着弾予測の輪が出ている', !!s && s.ring);
  check('撃ち落とせる球', !!s && s.shootable);
  await S(1 / 60, 25);
  await shot('flight');
  // 爆発の直前まで進めて、消えた直後を撮る
  let n = 0;
  while (await orbState()) { await S(1 / 60, 1); if (++n > 400) break; }
  check('球が爆発した', n < 400, { frames: n });
  await S(1 / 60, 6);
  await shot('blast');
  const log = await ev(() => ({ ...window.log, hp: window.__game.current.player.hp, max: window.__game.current.player.maxHp }));
  check('爆発イベント bombBlast', log.action.includes('bombBlast'), log);
  check('enemyAttack が出た', log.attack >= 1, log.attack);
  // プレイヤーに近い着弾を作る：球を目の前（足元）で爆発させ、ダメージを見る
  await ev(() => {
    const w = window.__game.current, T = window.__game.THREE;
    window.E.ai.atkTimer = 99;
    w.player.hp = w.player.maxHp; w.player.invuln = 0;
    window.log.hit.length = 0;
    const c = window.__game.current.player.pos.clone().add(new T.Vector3(1.2, 0.2, -2.5));
    import('/src/core/projectiles.ts').then(({ spawnProjectile }) => {
      spawnProjectile(w, {
        pos: c, vel: new T.Vector3(0, -2, 0), damage: 22, owner: 'enemy', radius: 0.2, size: 0.22, life: 2, gravity: 0, color: 0x7fe0ff,
        shootable: true, hp: 10, blast: { radius: 3.5, color: 0x7fe0ff, damage: 22, minMul: 0.25, onExpire: true, warnRing: true },
      });
    });
  });
  await S(1 / 60, 8);
  await shot('flight_near');
  for (let i = 0; i < 40; i++) await S(1 / 60, 1);
  await S(1 / 60, 4);
  await shot('blast_near');
  const hit = await ev(() => window.log.hit);
  check('近い爆発でダメージ（満タンより小さく 0 より大きい）', hit.length === 1 && hit[0] > 5 && hit[0] < 22, hit);
  // 数投させて動作確認（長めに走らせる）
  await ev(() => { window.E.ai.atkTimer = 0.1; window.__game.current.player.hp = window.__game.current.player.maxHp; });
  await S(1 / 60, 60 * 8);
  const orbs = await ev(() => ({ n: window.log.attack, hp: window.__game.current.player.hp, alive: window.E.status }));
  check('その後も投げ続ける', orbs.n >= 3, orbs);
  // 倒れた姿
  await ev(() => { const e = window.E; e.hp = 0; e.status = 'down'; e.ai.collapse = 0; e.deadTimer = 5; window.__game.current.player.yaw = 0; });
  await S(1 / 60, 40);
  await shot('down');
} finally {
  check('コンソールエラーなし', errors.length === 0, errors);
  await browser.close();
  await server.close();
}
process.exit(results.every(Boolean) ? 0 : 1);
