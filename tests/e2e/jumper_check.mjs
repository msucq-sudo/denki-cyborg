// 使い方: CHROME_EXE=... node tests/e2e/jumper_check.mjs   （ポート 5304）
// ジャンパーの確認：しゃがみ(予告) / 空中(閉じている) / 着地の突き(開く) / 全開 をスクショして
// tests/e2e/out/jumper_*.png に保存し、閉じている間は撃てない・開くと撃てることを検査する
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';

const port = 5304;
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const winExe = `${process.env.LOCALAPPDATA}/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe`;
const exe = process.env.CHROME_EXE ?? (fs.existsSync(winExe) ? winExe : '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
// 外部（フォント等）への通信は切る：スクショが「フォント待ち」で止まるのを防ぐ
await page.route('**/*', (r) => (r.request().url().startsWith(`http://localhost:${port}`) ? r.continue() : r.abort()));
const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, info === undefined ? '' : JSON.stringify(info)); };

try {
  console.log('goto');
  await page.goto(`http://localhost:${port}/?manual`, { waitUntil: 'load', timeout: 240000 });
  console.log('loaded');
  await page.waitForFunction(() => !!window.__game, null, { timeout: 240000 });
  console.log('game ready');
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
    mk([-30, -1, -30], [30, 0, 30], 0x6a7488);
    mk([-30, 0, -31], [30, 14, -30], 0x8b97ad);
    mk([-31, 0, -30], [-30, 14, 30], 0x8b97ad);
    mk([30, 0, -30], [31, 14, 30], 0x8b97ad);
    mk([-30, 0, 30], [30, 14, 31], 0x8b97ad);
    w.scene.background = new T.Color(0x8fa0b8);
    w.scene.add(new T.HemisphereLight(0xffffff, 0x8899bb, 1.1));
    const d = new T.DirectionalLight(0xffffff, 2); d.position.set(OX + 5, 12, 6); d.target.position.set(OX, 0, -10); w.scene.add(d.target);
    w.scene.add(d);
    w.player.pos.set(OX, 0.5, 0);
    window.OX = OX;
    window.api = await import('/src/enemies/api.ts');
    window.ev = { enemyAttack: [], playerHit: [], shieldBlock: [] };
    for (const n of Object.keys(window.ev)) g.events.on(n, (p) => window.ev[n].push(p));
  });
  await page.evaluate(() => window.__game.start());
  await page.evaluate(() => window.__game.step(1 / 60, 10));

  // ジャンパーとプレイヤーを置く（プレイヤーは動かない）
  await page.evaluate(() => {
    const g = window.__game, w = g.world, OX = window.OX;
    w.player.pos.set(OX, 0.5, 4); w.player.vel.set(0, 0, 0); w.player.yaw = 0; w.player.pitch = 0.1; w.player.hp = w.player.maxHp = 500; w.player.invuln = 0;
    const e = window.api.spawnEnemy(g.world, 'jumper', new g.THREE.Vector3(OX, 0.95, -9));
    e.ai.alert = 1e9; e.ai.yaw = Math.PI; window.E = e;
  });
  const info = () => page.evaluate(() => {
    const e = window.E, w = window.__game.world;
    return { state: e.ai.state, airT: +(e.ai.airT ?? 0).toFixed(2), thrustT: +(e.ai.thrustT ?? 0).toFixed(2), openAmt: +(e.ai.openAmt ?? 0).toFixed(2),
      shielded: !!e.shielded, exposed: e.weakPoints[0].exposed, hp: e.hp, php: w.player.hp, y: +e.pos.y.toFixed(2),
      d: +Math.hypot(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z).toFixed(2) };
  });
  // 条件が成り立つまで 1/60 s ずつ進める
  const until = (cond, max = 1200) => page.evaluate(([cond, max]) => {
    const f = new Function('e', 'w', `return ${cond}`);
    for (let i = 0; i < max; i++) { if (f(window.E, window.__game.world)) return i; window.__game.step(1 / 60, 1); }
    return -1;
  }, [cond, max]);
  // 敵を止めたままカメラだけ整えて撮る（from: 'front' | 'side' | 'sideHigh'）
  const shot = async (name, from = 'front') => {
    await page.evaluate((from) => {
      const g = window.__game, w = g.world, e = window.E, p = w.player;
      const keep = { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch };
      const saved = w.enemies; w.enemies = [];
      const place = (dx, dz, dy = 0) => {
        p.pos.set(e.pos.x + dx, e.pos.y - e.radius + dy, e.pos.z + dz); p.vel.set(0, 0, 0);
        const ddx = e.pos.x - p.pos.x, ddz = e.pos.z - p.pos.z, ddy = (e.pos.y + 0.5) - (p.pos.y + 1.6);
        p.yaw = Math.atan2(-ddx, -ddz); p.pitch = Math.atan2(ddy, Math.hypot(ddx, ddz));
      };
      if (from === 'front') place(0, 3.2);
      else if (from === 'side') place(3.4, 1.0);
      else place(2.6, 2.6, 0.9);
      p.root.visible = false;
      document.getElementById('hud') && (document.getElementById('hud').style.display = 'none');
      g.step(1 / 60, 30);
      g.render();
      w.enemies = saved;
      p.root.visible = true;
      window.__keep = keep;
    }, from);
    await page.screenshot({ path: `${outDir}/jumper_${name}.png`, timeout: 120000 });
    await page.evaluate(() => { const p = window.__game.world.player, k = window.__keep; p.pos.set(k.x, k.y, k.z); p.yaw = k.yaw; p.pitch = k.pitch; p.vel.set(0, 0, 0); });
  };

  // ---- 初期：立っている（閉じている）
  await page.evaluate(() => window.__game.step(1 / 60, 2));
  let s = await info();
  check('開始直後は閉じている（守り・弱点なし）', s.shielded && !s.exposed, s);
  // ---- しゃがみ
  let n = await until("e.ai.state==='crouch' && e.ai.warn>0.7");
  s = await info();
  check('しゃがみ（予告）に入る', n >= 0 && s.state === 'crouch', s);
  await shot('crouch', 'side');
  // ---- 空中（頂点付近）
  n = await until("e.ai.state==='air' && e.ai.airT>0.6");
  s = await info();
  check('空中は閉じていて浮いている', n >= 0 && s.state === 'air' && s.shielded && !s.exposed && s.y > 1.5, s);
  const blocked = await page.evaluate(() => {
    const e = window.E, w = window.__game.world; const hp = e.hp; const n0 = window.ev.shieldBlock.length;
    window.api.damageEnemy(w, e, 30, { how: 'shot', weak: true });
    return { hp: e.hp === hp, blocks: window.ev.shieldBlock.length - n0 };
  });
  check('空中は撃っても弾かれる', blocked.hp && blocked.blocks === 1, blocked);
  await shot('midhop', 'side');
  await shot('midhop_front', 'front');
  // ---- 着地の突き
  n = await until("e.ai.state==='open' && e.ai.thrustT>0.3");
  s = await info();
  check('着地で頭が開く', n >= 0 && s.state === 'open' && !s.shielded && s.exposed, s);
  await shot('thrust', 'side');
  await shot('thrust_front', 'front');
  // 最初の着地（距離は遠い）で突きが空振りしたか／そうでなければダメージ
  // ---- 全開
  n = await until("e.ai.state==='open' && e.ai.thrustT>0.8");
  await shot('open', 'sideHigh');
  const dm = await page.evaluate(() => {
    const e = window.E, w = window.__game.world; const hp = e.hp;
    window.api.damageEnemy(w, e, 30, { how: 'shot', weak: true });
    return { dealt: hp - e.hp };
  });
  check('開いているときは弱点に通る（30×倍率）', dm.dealt > 30, dm);
  // ---- 閉じる
  n = await until("e.ai.state==='crouch'");
  await page.evaluate(() => window.__game.step(1 / 60, 15));
  s = await info();
  check('開き終わると再び閉じる', s.shielded && !s.exposed, s);
  // ---- 接近して突きでダメージ（プレイヤーが突っ立っている場合）
  const closing = await page.evaluate(() => {
    const e = window.E, w = window.__game.world, php = w.player.hp;
    let minD = 99; let hits = 0, hops = 0, last = e.ai.state;
    for (let i = 0; i < 60 * 40; i++) {
      window.__game.step(1 / 60, 1);
      const d = Math.hypot(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z); minD = Math.min(minD, d);
      if (last === 'air' && e.ai.state === 'open') hops++;
      last = e.ai.state;
    }
    return { minD: +minD.toFixed(2), hops, damage: php - w.player.hp, attacks: window.ev.enemyAttack.length };
  });
  check('跳んで近づき、突きでダメージを与える', closing.minD < 3.2 && closing.damage > 0 && closing.attacks > 0, closing);
  await shot('final', 'front');
} finally {
  console.log('ERRORS', errors.length ? errors.slice(0, 8).join('\n') : 'none');
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed || errors.length ? 1 : 0);
