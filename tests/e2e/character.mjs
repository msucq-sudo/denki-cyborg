// 主人公の見た目確認: 3面図＋各アニメ状態のスクショを docs/character/ へ保存
// 使い方: node tests/e2e/character.mjs [port] [only]   （only を付けると名前が含まれるものだけ撮る）
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const port = Number(process.argv[2] ?? 5320);
const only = process.argv[3] ?? '';
const SUF = process.env.SUF ?? ''; // 調整用: ファイル名の接尾辞
const TUNE = process.env.TUNE ? JSON.parse(process.env.TUNE) : null; // 例 {"gun.aimTwist":0.4}
const outDir = 'docs/character';
fs.mkdirSync(outDir, { recursive: true });
execSync('npx vite build --outDir dist-e2e', { stdio: 'ignore' });
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-e2e', '--port', String(port), '--strictPort'], { stdio: 'pipe', shell: true });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes('Local')) res(); }); setTimeout(res, 8000); });
const exe = fs.existsSync('/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
  ? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
  : path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

// カメラ: tps=ゲームのまま / front,side,back,q(斜め前) = キャラ周りの確認用
const shot = async (name, view = 'tps', opt = {}) => {
  if (only && !name.includes(only)) return;
  await page.waitForTimeout(400);
  await page.evaluate(([view, opt]) => {
    const g = window.__game, w = g.current, p = w.player, c = w.camera;
    if (view !== 'tps') {
      const f = p.root.rotation.y;
      const ang = { front: 0, q: 0.7, side: Math.PI / 2, back: Math.PI, qb: Math.PI - 0.7, sideL: -Math.PI / 2 }[view] + f;
      const d = opt.dist ?? 3.4, h = opt.h ?? 1.1;
      const base = new g.THREE.Vector3(p.pos.x, p.pos.y + h, p.pos.z);
      c.position.set(base.x - Math.sin(ang) * d, base.y + (opt.up ?? 0.15), base.z - Math.cos(ang) * d);
      c.fov = opt.fov ?? 38; c.updateProjectionMatrix(); c.lookAt(base.x, base.y + (opt.look ?? 0.05), base.z);
    }
    g.render();
    return { cam: c.position.toArray().map((v) => +v.toFixed(2)), p: p.pos.toArray().map((v) => +v.toFixed(2)), rotY: +p.root.rotation.y.toFixed(2) };
  }, [view, opt]).then((r) => console.log(name, JSON.stringify(r)));
  await page.screenshot({ path: `${outDir}/${name}${SUF}.png`, timeout: 120000 });
  console.log('shot', name);
};
const S = (dt, n) => page.evaluate(([dt, n]) => window.__game.step(dt, n), [dt, n]);
const key = (c, d) => page.evaluate(([c, d]) => window.__game.input.simulateKey(c, d), [c, d]);
const mouse = (b, d) => page.evaluate(([b, d]) => window.__game.input.simulateMouse(b, d), [b, d]);
const info = () => page.evaluate(() => { const p = window.__game.current.player; return { pos: p.pos.toArray().map((v) => +v.toFixed(1)), g: p.onGround, fly: p.flying, e: +p.energy.toFixed(0) }; });
try {
  await page.goto(`http://localhost:${port}/?manual`);
  await page.waitForFunction(() => !!window.__game);
  if (TUNE) await page.evaluate((t) => { for (const [k, v] of Object.entries(t)) { const ks = k.split('.'); let o = window.__game[k.split('.')[0] === 'camera' ? 'camera' : 'character']; for (const q of ks.slice(k.split('.')[0] === 'camera' ? 1 : 0, -1)) o = o[q]; o[ks.at(-1)] = v; } }, TUNE);
  await page.evaluate(() => { const g = window.__game; g.start(); document.getElementById('hud').style.display = 'none'; g.step(1 / 30, 30); g.current.player.energy = 100; });
  // ---- 3面図（待機）----
  await S(1 / 60, 90);
  for (const v of ['front', 'q', 'side', 'back']) await shot(`sheet_${v}`, v);
  await shot('sheet_head', 'front', { dist: 1.3, h: 1.62, look: 0, fov: 34, up: 0 });
  await shot('sheet_headside', 'side', { dist: 1.3, h: 1.62, look: 0, fov: 34, up: 0 });
  await shot('idle_tps');
  // ---- スカウターON ----
  await key('Digit1', true); await S(1 / 60, 1); await key('Digit1', false); await S(1 / 60, 40);
  await shot('scouter_on_head', 'q', { dist: 1.3, h: 1.62, look: 0, fov: 34, up: 0 });
  await shot('scouter_on_front', 'front', { dist: 1.3, h: 1.62, look: 0, fov: 34, up: 0 });
  await shot('scouter_on_side', 'sideL', { dist: 1.3, h: 1.62, look: 0, fov: 34, up: 0 });
  await shot('scouter_on_tps');
  await key('Digit1', true); await S(1 / 60, 1); await key('Digit1', false); await S(1 / 60, 30);
  // ---- 歩き・走り ----
  await key('KeyW', true); await S(1 / 60, 40);
  await shot('walk_side', 'side', { dist: 4 }); await shot('walk_tps');
  await key('ShiftLeft', true); await S(1 / 60, 40);
  await shot('run_side', 'side', { dist: 4 }); await shot('run_tps');
  await S(1 / 60, 7); await shot('run_side2', 'side', { dist: 4 });
  await key('ShiftLeft', false); await key('KeyW', false); await S(1 / 60, 40);
  // ---- 回避 ----
  await key('KeyD', true); await S(1 / 60, 3); await key('KeyC', true); await S(1 / 60, 1); await key('KeyC', false);
  await S(1 / 60, 3); await shot('dodge_mid', 'q', { dist: 4 }); await S(1 / 60, 3); await shot('dodge_mid2', 'q', { dist: 4 });
  await key('KeyD', false); await S(1 / 60, 40);
  // ---- 射撃（ゲーム内TPSカメラ＝tps / 照準カメラ＝右クリック長押し）----
  await mouse(0, true); await S(1 / 60, 8); await mouse(0, false); await S(1 / 60, 3);
  await shot('aim_fire_tps');                       // 左クリックのみ（通常TPSカメラ）
  await S(1 / 60, 60);
  await mouse(2, true); await S(1 / 60, 25);
  await shot('aim_ads_tps');                        // 右クリック照準カメラ（ゲームそのまま）
  await shot('aim_q', 'q', { dist: 3 }); await shot('aim_side', 'side', { dist: 3 }); await shot('aim_back', 'back', { dist: 3 });
  await page.evaluate(() => window.__game.input.simulateLook(0, -160)); await S(1 / 60, 20);
  await shot('aim_ads_up_tps');
  await page.evaluate(() => window.__game.input.simulateLook(0, 160)); await S(1 / 60, 20);
  await mouse(0, true); await S(1 / 60, 1); await mouse(0, false); await S(1 / 60, 3);
  await shot('shoot_recoil_q', 'q', { dist: 3 }); await shot('shoot_recoil_tps');
  // ダミー長物（ライフル）に差し替えて確認
  await page.evaluate(() => window.__game.setWeapon('rifle_dummy'));
  await S(1 / 60, 30);
  await shot('rifle_ads_tps'); await shot('rifle_q', 'q', { dist: 3 }); await shot('rifle_side', 'side', { dist: 3 }); await shot('rifle_back', 'back', { dist: 3 });
  await mouse(2, false); await mouse(0, true); await S(1 / 60, 8); await mouse(0, false); await S(1 / 60, 2);
  await shot('rifle_fire_tps');
  await S(1 / 60, 60); await shot('rifle_carry_q', 'q', { dist: 3 });
  await page.evaluate(() => window.__game.setWeapon('pistol'));
  await S(1 / 60, 40); await mouse(2, true); await S(1 / 60, 20); await mouse(2, false); await S(1 / 60, 40);
  // ---- 溜め ----
  await mouse(0, true); await S(1 / 60, 60);
  await shot('charge_q', 'q', { dist: 3.2 }); await shot('charge_tps');
  await mouse(0, false); await S(1 / 60, 50);
  // ---- ジャンプ・飛行 ----
  await key('Space', true); await S(1 / 60, 1); await key('Space', false); await S(1 / 60, 8);
  await shot('jump_side', 'side', { dist: 4, h: 1.4 });
  await S(1 / 60, 25); await shot('fall_side', 'side', { dist: 4, h: 1.4 });
  await S(1 / 60, 60);
  await key('Digit3', true); await S(1 / 60, 1); await key('Digit3', false);
  await key('Space', true); await S(1 / 60, 1); await key('Space', false); await S(1 / 60, 8);
  await key('Space', true); await S(1 / 60, 40);
  console.log('FLY', JSON.stringify(await info()));
  await shot('fly_side', 'side', { dist: 4, h: 1.4 }); await shot('fly_tps');
  await key('Space', false); await S(1 / 60, 90);
  // ---- 吸収（第1区画の敵）----
  await page.evaluate(() => { const g = window.__game, w = g.current; const r = w.level.rooms[1]; w.player.pos.set((r.min.x + r.max.x) / 2, 0, r.max.z - 4); g.step(1 / 30, 75); });
  await page.evaluate(() => {
    const g = window.__game, w = g.current, p = w.player;
    w.colliders.forEach((c) => { if (c.min.y >= -0.01) c.active = false; }); // 確認用：壁を無効化して吸収を必ず届かせる
    w.enemies.forEach((e, i) => { e.pos.set(p.pos.x - 2.5 + i * 2.5, 3.2, p.pos.z - 6); e.root.position.copy(e.pos); });
    const hold = w.enemies.map((e) => e.pos.clone());
    const raw = g.step;
    g.step = (dt, n = 1) => { for (let k = 0; k < n; k++) { w.enemies.forEach((e, i) => { if (hold[i] && e.status !== 'dead') { e.pos.copy(hold[i]); e.vel.set(0, 0, 0); e.ai.cool = 99; e.ai.attackT = 99; } }); raw(dt, 1); } };
    const t = w.enemies[1].pos; const c = p.pos.clone(); c.y += 1.4; const d = t.clone().sub(c);
    p.yaw = Math.atan2(-d.x, -d.z); p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    g.step(1 / 30, 10);
  });
  console.log('ENEMIES', await page.evaluate(() => window.__game.current.enemies.map((e) => e.kind + e.pos.toArray().map((v) => v.toFixed(1)))));
  await key('KeyE', true); await S(1 / 60, 1); await key('KeyE', false);
  for (let i = 0; i < 0; i++) { await S(1 / 60, 1); console.log('abs', await page.evaluate(() => { const w = window.__game.current; return [w.absorb.phase, w.absorb.tip.toArray().map((v) => +v.toFixed(1)), w.aimDir.toArray().map((v) => +v.toFixed(2)), w.player.pitch.toFixed(2)]; })); }
  await S(1 / 60, 1); await shot('absorb_extending_side', 'sideL', { dist: 7, h: 1.6, fov: 50 });
  await S(1 / 60, 2); await shot('absorb_extending2_side', 'sideL', { dist: 7, h: 1.6, fov: 50 });
  await S(1 / 60, 30);
  console.log('ABSORB', await page.evaluate(() => window.__game.current.absorb.phase));
  await shot('absorb_attached_side', 'sideL', { dist: 11, h: 1.8, fov: 42 }); await shot('absorb_attached_tps');
  await shot('absorb_attached_q', 'q', { dist: 4, h: 1.5, fov: 50 });
  await key('KeyE', true); await S(1 / 60, 1); await key('KeyE', false); await S(1 / 60, 3);
  await shot('absorb_retract_side', 'sideL', { dist: 7, h: 1.6, fov: 50 });
  await S(1 / 60, 25); await shot('absorb_ripple_q', 'q', { dist: 3.2 });
} finally {
  console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
  await browser.close(); server.kill();
}
