// 1階の通しプレイ確認: node tests/e2e/floor1_play.mjs [port]
// ?level=floor1 を開き、ガイド付きの新しい流れ（ゲート→南東エリア→行き止まり罠→右の部屋(下→上の罠)→大広間→
// エレベーター(電源なし)→西のゲート→脇の部屋の電源(アーム)→左下の罠→左上→エレベーター最終戦→クリア）を通しで確認する。
// テレポート／敵を倒す補助は使うが、ゲートのコライダーが「閉じている→開く」ことを毎回確かめる。最後に PASS/FAIL を出力。
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const port = Number(process.argv[2] ?? 5193);
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true }, logLevel: 'warn' });
await server.listen();
const exe = fs.existsSync('/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
  ? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
  : path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const checks = [];
const ok = (name, cond, extra = '') => { checks.push([name, !!cond]); console.log(cond ? 'PASS' : 'FAIL', name, extra); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const step = (n, dt = 1 / 30) => ev(([n, dt]) => window.__game.step(dt, n), [n, dt]);
const tp = (x, y, z, yaw = 0, pitch = 0) => ev(([x, y, z, yaw, pitch]) => {
  const p = window.__game.current.player; p.pos.set(x, y, z); p.vel.set(0, 0, 0); p.yaw = yaw; p.pitch = pitch; p.hp = p.maxHp; p.energy = p.maxEnergy;
}, [x, y, z, yaw, pitch]);
// 領域内の敵を倒す（他の区画の休眠中の敵は残す）
const killIn = (x0, x1, z0, z1) => ev(([x0, x1, z0, z1]) => {
  const w = window.__game.current; let n = 0;
  w.enemies.forEach((e) => { if (e.status !== 'dead' && e.pos.x >= x0 && e.pos.x <= x1 && e.pos.z >= z0 && e.pos.z <= z1) { e.hp = 0; e.status = 'dead'; e.root.visible = false; n++; } });
  return n;
}, [x0, x1, z0, z1]);
const inRect = (x0, x1, z0, z1, f = (e) => true) => ev(([x0, x1, z0, z1]) => window.__game.current.enemies.filter((e) => e.status !== 'dead' && e.pos.x >= x0 && e.pos.x <= x1 && e.pos.z >= z0 && e.pos.z <= z1), [x0, x1, z0, z1]);
const rectInfo = (x0, x1, z0, z1) => ev(([x0, x1, z0, z1]) => {
  const l = window.__game.current.enemies.filter((e) => e.status !== 'dead' && e.pos.x >= x0 && e.pos.x <= x1 && e.pos.z >= z0 && e.pos.z <= z1);
  return { n: l.length, dormant: l.filter((e) => e.ai.dormant).length, kinds: l.map((e) => e.kind).sort().join(',') };
}, [x0, x1, z0, z1]);
// ゲートのコライダーが有効か（座標は開口の中心）
const gateActive = (x, z) => ev(([x, z]) => window.__game.current.colliders.some((c) => c.tag === 'gate' && c.active && x > c.min.x && x < c.max.x && z > c.min.z && z < c.max.z), [x, z]);
const G = { start: [-23, -9.5], dead: [67, -3], rlow: [31.5, -31.5], rmid: [54, -47.5], rexit: [23, -63], l2: [-23, -45], l3n: [-42, -36.5], side: [-31.5, -28] };
const closed = (id) => gateActive(...G[id]);
const f1 = () => ev(() => JSON.parse(JSON.stringify(window.__game.current.level.data.floor1)));
const gears = () => ev(() => window.__game.current.level.data.gears);
const shot = async (name) => { await ev(() => window.__game.render()); await page.screenshot({ path: `${outDir}/floor1v3_${name}.png`, timeout: 120000 }); };
const toasts = () => ev(() => window.__game.current.toasts.map((t) => t.text));
const R = {
  start: [-96, -24, -15, -4], dead: [67, 87, -13, 9], RL: [32, 60, -47, -25], RU: [32, 60, -70, -48],
  L2: [-52, -32, -53, -37], L3: [-52, -32, -36, -20], hallFinal: [-22, 22, -70, -52],
};

try {
  await page.goto(`http://localhost:${port}/?level=floor1&manual`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  await step(2);
  await ev(() => window.__game.start());
  await step(10);
  ok('state=playing', (await ev(() => window.__game.current.state)) === 'playing');
  const start = await ev(() => window.__game.current.player.pos.toArray().map((v) => +v.toFixed(2)));
  ok('start near lab door (x<-50, y=0)', start[0] < -50 && Math.abs(start[1]) < 0.05, JSON.stringify(start));
  const total = await ev(() => window.__game.current.enemies.length);
  ok('all fight enemies exist from the start, all dormant', (await ev(() => window.__game.current.enemies.filter((e) => e.ai.dormant).length)) === total, String(total));
  for (const id of ['start', 'rexit', 'l2']) ok(`gate ${id} starts closed`, await closed(id));
  for (const id of ['dead', 'rlow', 'rmid', 'l3n', 'side']) ok(`gate ${id} starts open`, !(await closed(id)));

  // ---- 1. スタート通路：2体。1体で全員起きる。全滅までゲートは閉じたまま
  const s0 = await rectInfo(...R.start);
  ok('start corridor has exactly 2 enemies (crawler + walker)', s0.n === 2 && s0.kinds === 'crawler,walker', JSON.stringify(s0));
  await step(30 * 3);
  ok('nobody wakes at the door', (await rectInfo(...R.start)).dormant === 2);
  await tp(-41, 0, -9.5, -Math.PI / 2, 0.05); await step(12);
  await page.waitForTimeout(1200);
  await shot('start_gate_closed');
  await tp(-47, 0, -9.5, -Math.PI / 2); await step(40);
  const s1 = await rectInfo(...R.start);
  ok('one wake wakes them all (zone-wide)', s1.dormant === 0, JSON.stringify(s1));
  ok('start gate still closed while enemies live', await closed('start'));
  await tp(-27, 0, -9.5, -Math.PI / 2); await step(15);
  ok('cannot rush past: gate collider blocks (player x stays < -23.5)', (await ev(() => window.__game.current.player.pos.x)) < -23.4);
  await killIn(...R.start); await step(45);
  ok('start gate opens after the last enemy dies', !(await closed('start')));
  ok('gate state reported open', (await f1()).gates.start === true);

  // ---- 2. 南東エリアと仕切り壁
  await tp(-2, 0, -8, -0.7, 0.1); await step(10);
  await shot('partition_se_area');
  ok('partition wall blocks bullets/movement north of the SE strip', await ev(() => {
    const w = window.__game.current; return w.colliders.some((c) => c.tag === 'wall' && c.max.y > 15 && c.min.x < -5 && c.max.x > 5 && c.min.z < -17 && c.max.z > -18);
  }));
  ok('SE-area staircase is gone (no step collider on the east side)', !(await ev(() => window.__game.current.colliders.some((c) => c.tag === 'step' && c.min.x > 15 && c.min.z > -40 && c.max.z < -10))));

  // ---- 3. 行き止まり：歯車に近づくと入口が閉まり、天井／コンテナから一斉に
  await tp(72, 0, -3, -Math.PI / 2); await step(20);
  ok('dead-end: nothing happens on entering the room', !(await closed('dead')) && (await f1()).fights.dead === 'idle');
  await tp(78, 0, -2, -Math.PI / 2); await step(6);
  ok('dead-end door closes behind the player when going for the gear', await closed('dead'));
  ok('dead-end lockdown is on', (await f1()).lockdown === true);
  await tp(82, 0, -2, Math.PI / 2); await step(45);
  const d1 = await rectInfo(...R.dead);
  ok('dead-end: 3 easy enemies burst out at once', d1.n === 3 && d1.dormant === 0 && !/heavy|missile/.test(d1.kinds), JSON.stringify(d1));
  await shot('deadend_trap');
  ok('dead-end gear picked up', (await gears()) === 1);
  await killIn(...R.dead); await step(45);
  ok('dead-end door reopens after the fight', !(await closed('dead')) && (await f1()).lockdown === false);

  // ---- 4. 右の部屋 下 → 上
  await tp(36, 0, -31, -Math.PI / 2); await step(40);
  ok('right-lower holds 1-2 easy enemies', (await rectInfo(...R.RL)).n <= 2);
  await tp(57, 0, -28, 0); await step(5);
  ok('lower gear picked up', (await gears()) === 2);
  await killIn(...R.RL); await step(5);
  ok('mid door open before the upper half', !(await closed('rmid')) && !(await closed('rlow')));
  await tp(54, 0, -49.5, 0); await step(10);
  ok('no trap yet at the doorway', (await f1()).fights.RU === 'idle');
  await tp(54, 0, -56, Math.PI / 2); await step(6);
  ok('upper half: mid door + lower entry + exit are all closed', (await closed('rmid')) && (await closed('rlow')) && (await closed('rexit')));
  await step(45);
  const u1 = await rectInfo(...R.RU);
  ok('upper half: 3-4 enemies appear at once, max one walker', u1.n >= 3 && u1.n <= 4 && u1.dormant === 0 && (u1.kinds.match(/walker/g) ?? []).length <= 1 && !/heavy|missile/.test(u1.kinds), JSON.stringify(u1));
  await shot('right_upper_trap');
  await tp(57, 0, -67.5, 0); await step(5);
  ok('upper gear picked up', (await gears()) === 3);
  await killIn(...R.RU); await step(60);
  ok('upper exit door opens after the fight', !(await closed('rexit')));
  ok('mid door reopens, lower entry stays shut', !(await closed('rmid')) && (await closed('rlow')));
  await tp(26, 0, -63, Math.PI / 2); await step(20);
  await tp(15, 0, -63, Math.PI / 2); await step(45);
  ok('exit door shuts behind the player (one-way)', await closed('rexit'));
  ok('middle corridor is a wall (no gap in the hall east wall at z=-51)', await ev(() => {
    const w = window.__game.current; const pt = { x: 23, z: -51 };
    return w.colliders.some((c) => c.tag === 'wall' && pt.x > c.min.x && pt.x < c.max.x && pt.z > c.min.z && pt.z < c.max.z && c.max.y > 5);
  }));

  // ---- 5. 大広間：エレベーターは電源なし → 西のゲートが開く
  ok('west gate (to 左中央) closed before the elevator event', await closed('l2'));
  await tp(0, 0, -68, 0); await step(40);
  const t0 = await toasts();
  ok('elevator: no-power toast', t0.some((t) => t.includes('電源が入っていない')), t0.join('|'));
  ok('west gate opens', !(await closed('l2')));
  await shot('elevator_no_power');
  // アスレチック：西の階段→デッキ→ジェット→柱の上の歯車
  await tp(-18.5, 7.2, -46, -Math.PI / 2); await step(3);
  await ev(() => { const i = window.__game.input; i.simulateKey('KeyW', true); i.simulateKey('Space', true); });
  await step(1);
  for (let i = 0; i < 90; i++) await step(1);
  await ev(() => { const i = window.__game.input; i.simulateKey('KeyW', false); i.simulateKey('Space', false); });
  await step(30);
  const jp = await ev(() => window.__game.current.player.pos.toArray().map((v) => +v.toFixed(2)));
  ok('jetpack crossing lands on the 7.2m landing pad (x -11..-9)', jp[0] > -11.1 && jp[0] < -8.9 && Math.abs(jp[1] - 7.2) < 0.1, JSON.stringify(jp));
  for (const gx of [-6, 6]) { await tp(gx, 12, -46); await step(3); }
  ok('both pillar-top gears collected', (await gears()) === 5);

  // ---- 6. 左上：歯車2個（敵なし）
  await tp(-42, 0, -45, Math.PI); await step(40);
  await killIn(...R.L2); await step(3);
  await tp(-42, 0, -62, 0); await step(5);
  await tp(-47, 0, -65.5); await step(5); await tp(-37, 0, -65.5); await step(5);
  ok('upper-left gears collected (7 in total soon)', (await gears()) === 7);
  ok('upper-left room has no enemies', (await rectInfo(-52, -32, -70, -54)).n === 0);

  // ---- 7. 脇の細い部屋：アームで電源に電気を送る
  await tp(-30, 0, -28, -Math.PI / 2); await step(10);
  ok('side-room hint shown near the device', await ev(() => [...document.querySelectorAll('div')].some((d) => d.textContent === '撃つ / アームで電気を送る' && d.style.display !== 'none')));
  await tp(-31.5, 0, -28, -Math.PI / 2); await step(3);
  await tp(-30.3, 0, -33.5, -2.41, 0.05); await step(2);
  await shot('power_device_off');
  await tp(-31.5, 0, -28, -Math.PI / 2); await step(2);
  ok('not powered yet', (await f1()).powered === false);
  await ev(() => { const w = window.__game.current; w.player.energy = w.player.maxEnergy; });
  const e0 = await ev(() => window.__game.current.player.energy);
  await ev(() => window.__game.input.simulateKey('KeyE', true)); await step(2);
  await ev(() => window.__game.input.simulateKey('KeyE', false));
  await step(30);
  const st = await f1();
  const e1 = await ev(() => window.__game.current.player.energy);
  ok('arm feed powers the device', st.powered === true && st.powerVia === 'arm', JSON.stringify([st.powered, st.powerVia]));
  ok('arm feed cost ~1 energy', e0 - e1 >= 0.5 && e0 - e1 <= 3, `${e0} -> ${e1}`);
  ok('toast: power restored', (await toasts()).some((t) => t.includes('エレベーターに電力が戻った')));
  await tp(-30.3, 0, -33.5, -2.41, 0.05); await step(2);
  await shot('power_device_on');

  // ---- 8. 左下の罠
  await tp(-27, 0, -28, Math.PI / 2); await step(5);
  await tp(-39, 0, -28, Math.PI / 2); await step(6);
  ok('左下: both doors close after returning from the side room', (await closed('l3n')) && (await closed('side')));
  await step(45);
  const l3 = await rectInfo(...R.L3);
  ok('左下: 2-3 easy enemies', l3.n >= 2 && l3.n <= 3 && l3.dormant === 0 && !/heavy|missile|gunner/.test(l3.kinds), JSON.stringify(l3));
  await shot('lower_left_trap');
  await killIn(...R.L3); await step(45);
  ok('左下 doors reopen', !(await closed('l3n')) && !(await closed('side')));

  // ---- 9. エレベーター最終戦
  await tp(0, 0, -30, 0); await step(30 * 6);
  const door = () => ev(() => window.__game.current.level.data.floor1.doorOpen);
  ok('elevator door shut before the fight', (await door()) === 0);
  await tp(0, 0, -64, 0); await step(6);
  ok('final fight starts', (await f1()).fights.final === 'active');
  await step(60);
  const fi = await rectInfo(...R.hallFinal);
  ok('final fight: heavy + gunner + 2 crawlers', fi.kinds === 'crawler,crawler,gunner,heavy', JSON.stringify(fi));
  await shot('elevator_fight');
  ok('elevator door shut during the fight', (await door()) === 0);
  await killIn(...R.hallFinal); await step(30 * 3);
  ok('elevator door opens after the fight', (await door()) >= 1);
  await shot('elevator_open');
  await tp(0, 0, -72, 0); await step(20);
  await ev(() => window.__game.input.simulateKey('KeyW', true));
  await step(30 * 2);
  await ev(() => window.__game.input.simulateKey('KeyW', false));
  await step(40);
  await step(60); // 暗転→2階の生成
  // エレベーターに乗ると2階へ移動する（以前はクリア画面）。所持品（歯車）は引き継がれる
  const after = await ev(() => { const w = window.__game.current; return { state: w.state, inv: w.inventory, lvl: w.level.data.floor ?? null, n: w.level.rooms.length }; });
  ok('elevator takes the player to floor 2 (or clear)', after.state === 'clear' || (after.state === 'playing' && after.inv.gears >= 7), JSON.stringify(after));
  ok('all 7 gears', after.inv.gears === 7, after.inv.gears);
} finally {
  const failed = checks.filter((c) => !c[1]);
  console.log(`RESULT ${checks.length - failed.length}/${checks.length} passed`, failed.map((c) => c[0]));
  console.log('console errors:', errors.length ? errors.slice(0, 10) : 'none');
  await browser.close();
  await server.close();
}
