// リーチ（吸収マン）の確認: CHROME_EXE=... node tests/e2e/leech_check.mjs   （ポート 5302）
// 遠く(x=+400)に闘技場を作り、/?manual で __game.step を回して
//  1) リーチのアームがプレイヤーにつながっている画面  → tests/e2e/out/leech_attached.png
//  2) プレイヤーが吸収アームをつないで、リーチが逃げていく画面 → tests/e2e/out/leech_flee.png
// を撮り、挙動（電力が吸われる／逃げる／player.leeched の後始末）とコンソールエラーを確認する
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';

const port = 5302;
fs.mkdirSync('tests/e2e/out', { recursive: true });
// 他担当のファイル編集による HMR リロードでテストが壊れないよう、監視と HMR を切る
const server = await createServer({ root: process.cwd(), server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const exe = process.env.CHROME_EXE ?? '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info ?? '')); };

try {
  await page.goto(`http://localhost:${port}/?manual`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  // ---- 闘技場（本編のマップから離れた場所）
  await page.evaluate(async () => {
    const g = window.__game, w = g.world, T = g.THREE;
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
    w.scene.add(new T.HemisphereLight(0xffffff, 0x8899bb, 1.3));
    const d = new T.DirectionalLight(0xffffff, 1.8); d.position.set(OX + 5, 12, 6); d.target.position.set(OX, 0, -10); w.scene.add(d.target); w.scene.add(d);
    window.OX = OX;
    window.api = await import('/src/enemies/api.ts');
    window.ev = {};
    for (const n of ['leechFire', 'leechAttach', 'leechBreak', 'leechFlee', 'absorbAttach', 'enemyKilled']) { window.ev[n] = []; g.events.on(n, (p) => window.ev[n].push(p)); }
  });
  await page.evaluate(() => { window.__game.start(); });
  const S = (dt, n) => page.evaluate(([dt, n]) => window.__game.step(dt, n), [dt, n]);

  // ---- 準備：プレイヤーを闘技場の中央に、リーチを前方 9m に置く
  await page.evaluate(() => {
    const g = window.__game, w = g.world, p = w.player;
    for (const e of w.enemies.slice()) { w.scene.remove(e.root); }
    w.enemies.length = 0;
    p.hp = 100; p.maxHp = 100; p.energy = 80; p.invuln = 0;
    p.pos.set(window.OX, 0.5, 0); p.vel.set(0, 0, 0); p.yaw = 0; p.pitch = 0.05;
    w.level.currentRoom = -1;
    const e = window.api.spawnEnemy(w, 'leech', new g.THREE.Vector3(window.OX + 2, 1.6, -9));
    e.ai.alert = 100; e.ai.atkCd = 0;
    window.E = e;
    document.getElementById('hud').style.display = 'none';
  });
  await S(1 / 60, 10);

  const info = () => page.evaluate(() => {
    const w = window.__game.world, e = window.E, p = w.player;
    return {
      st: e.status, arm: e.ai.armPhase, stolen: +(e.ai.stolen ?? 0).toFixed(2), energy: +p.energy.toFixed(2), leeched: !!p.leeched,
      d: +Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z).toFixed(2), hp: +e.hp.toFixed(1), tethered: e.tethered, fleeing: !!e.ai.fleeing,
      absorb: w.absorb.phase, target: w.absorb.target === e,
      fire: window.ev.leechFire.length, attach: window.ev.leechAttach.length, brk: window.ev.leechBreak.length, flee: window.ev.leechFlee.length,
    };
  });
  /** 横から見たカメラで撮る（リーチとプレイヤーの中間を見る） */
  const shot = async (name, back = 7) => {
    await page.evaluate((back) => {
      const g = window.__game, w = g.world, e = window.E, T = g.THREE;
      const pc = w.player.pos.clone().add(new T.Vector3(0, 0.9, 0));
      const mid = pc.clone().lerp(e.pos, 0.5);
      const dir = e.pos.clone().sub(pc).setY(0).normalize();
      const side = new T.Vector3(-dir.z, 0, dir.x);
      w.camera.position.copy(mid).addScaledVector(side, back).add(new T.Vector3(0, 1.2, 0));
      w.camera.lookAt(mid);
      g.render();
      // page.screenshot は swiftshader だと極端に遅いので、描画直後に canvas を直接取り出す
      return document.querySelector('canvas').toDataURL('image/png');
    }, back).then((url) => fs.writeFileSync(`tests/e2e/out/leech_${name}.png`, Buffer.from(url.split(',')[1], 'base64')));
    console.log('shot', name);
  };
  /** 吸収アームの線がリーチに当たるまで yaw/pitch を探す（肩越しカメラなので真正面では外れる）。乗れば true */
  const aimOn = () => page.evaluate(() => {
    const g = window.__game, w = g.world, e = window.E, p = w.player;
    const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, dy = e.pos.y - (p.pos.y + 1.6);
    const yaw0 = Math.atan2(-dx, -dz), pitch0 = Math.atan2(dy, Math.hypot(dx, dz));
    for (let k = 0; k <= 30; k++) {
      for (const sgn of k === 0 ? [0] : [1, -1]) {
        for (const dp of [0, 0.03, -0.03]) {
          p.yaw = yaw0 + sgn * k * 0.01; p.pitch = pitch0 + dp;
          g.step(1 / 60, 1);
          // 吸収アームは aimOrigin から aimDir へ伸びる。その線がリーチ（半径+先端0.2）に当たるか
          const o = w.aimOrigin, d = w.aimDir;
          const rx = e.pos.x - o.x, ry = e.pos.y - o.y, rz = e.pos.z - o.z;
          const tt = rx * d.x + ry * d.y + rz * d.z;
          const off = Math.hypot(rx - d.x * tt, ry - d.y * tt, rz - d.z * tt);
          if (tt > 0 && off < 0.35) return true;
        }
      }
    }
    return false;
  });
  /** プレイヤーをリーチへ向ける */
  const aim = () => page.evaluate(() => {
    const w = window.__game.world, e = window.E, p = w.player;
    const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, dy = e.pos.y - (p.pos.y + 1.6);
    p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  });

  // ---- 1) リーチのアームがつながるまで
  let s = await info();
  for (let i = 0; i < 400 && s.arm !== 'attached'; i++) { await aim(); await S(1 / 60, 3); s = await info(); }
  check('アームがプレイヤーにつながる', s.arm === 'attached' && s.leeched && s.attach === 1 && s.fire >= 1, s);
  const e0 = s.energy;
  await S(1 / 60, 60);
  s = await info();
  check('つながっている間、電力が吸われて ai.stolen に入る', s.energy < e0 - 3 && s.stolen > 3 && Math.abs((80 - s.energy) - s.stolen) < 0.5, { e0, ...s });
  await shot('attached');

  // ---- 2) 回避で外れる
  await page.evaluate(() => { window.__game.world.player.dodgeTimer = 0.2; });
  await S(1 / 60, 2);
  s = await info();
  check('回避でアームが外れる', s.arm !== 'attached' && !s.leeched && s.brk >= 1, s);

  // ---- 3) こちらの吸収アームをつなぐ → 逃げる
  await page.evaluate(() => { const p = window.__game.world.player; p.dodgeTimer = 0; p.dodgeCooldown = 0; });
  // 再びつながれた状態から、こちらも吸収アームを撃つ（満タンで遠くへ離れていたら、位置と電力を戻す）
  await page.evaluate(() => {
    const e = window.E, T = window.__game.THREE;
    e.ai.stolen = 10; e.ai.atkCd = 0; e.pos.set(window.OX + 2, 1.6, -9); e.vel.set(0, 0, 0);
    window.__game.world.player.energy = 60;
  });
  s = await info();
  for (let i = 0; i < 400 && s.arm !== 'attached'; i++) { await aim(); await S(1 / 60, 3); s = await info(); }
  let tethered = false;
  for (let tries = 0; tries < 8 && !tethered; tries++) {
    await aimOn();
    await page.evaluate(() => { window.__game.world.player.energy = Math.max(window.__game.world.player.energy, 30); window.__game.input.simulateKey('KeyE', true); });
    await S(1 / 60, 2);
    await page.evaluate(() => window.__game.input.simulateKey('KeyE', false));
    await S(1 / 60, 22);
    s = await info();
    tethered = s.tethered && s.target;
    if (!tethered) await S(1 / 60, 60);
  }
  check('吸収アームがリーチにつながる', tethered, s);
  const dTether = s.d;
  await S(1 / 60, 12);
  await aim();
  await shot('flee');
  s = await info();
  check('つながれたら逃げる（leechFlee・アーム収納・leeched=false）', s.fleeing && s.flee === 1 && s.arm === 'none' && !s.leeched, s);
  await S(1 / 60, 20);
  s = await info();
  check('プレイヤーから遠ざかる', s.d > dTether + 1.5 || !s.tethered, { dTether, ...s });
  // 逃げ切られる（距離でつなぎが切れる）かどうかを見る
  await S(1 / 60, 90);
  s = await info();
  console.log('after chase-less 1.5s', JSON.stringify(s));

  // ---- 4) 吸い切ると盗まれた電力が戻る
  const r = await page.evaluate(() => {
    const g = window.__game, w = g.world, e = window.E, p = w.player;
    e.ai.stolen = 25; p.energy = 40;
    const before = p.energy;
    window.api.drainEnemy(w, e, 1000);
    return { before, after: p.energy, status: e.status, leeched: !!p.leeched };
  });
  check('吸い切ると盗まれた電力が戻る', r.status === 'down' && r.after >= r.before + 24.9 && !r.leeched, r);
  await S(1 / 60, 20);
  await shot('down');

  // ---- 5) 撃破で電力が失われ、player.leeched が残らない
  const r2 = await page.evaluate(() => {
    const g = window.__game, w = g.world, p = w.player;
    const e = window.api.spawnEnemy(w, 'leech', new g.THREE.Vector3(window.OX, 1.6, -8));
    e.ai.alert = 100; e.ai.atkCd = 0; window.E = e;
    return e.id;
  });
  s = await info();
  for (let i = 0; i < 400 && s.arm !== 'attached'; i++) { await aim(); await S(1 / 60, 3); s = await info(); }
  const r3 = await page.evaluate(() => {
    const w = window.__game.world, e = window.E, p = w.player;
    const attached = !!p.leeched; const en = p.energy;
    window.api.damageEnemy(w, e, 1000, { how: 'shot', weak: true });
    return { attached, en, after: p.energy, leeched: !!p.leeched, st: e.status };
  });
  check('撃破：電力は戻らず leeched が消える', r3.attached && r3.st === 'dead' && r3.after === r3.en && !r3.leeched, r3);
} finally {
  const bad = errors.filter((e) => !/favicon/i.test(e));
  check('コンソールエラーなし', bad.length === 0, bad.slice(0, 5));
  await browser.close();
  await server.close();
}
const failed = results.filter((x) => !x).length;
console.log(failed ? `LEECH CHECK FAIL (${failed})` : 'LEECH CHECK OK');
process.exit(failed ? 1 : 0);
