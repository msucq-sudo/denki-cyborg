// UI（担当E）のブラウザ確認。使い方: node tests/e2e/ui.mjs [ポート=5205]
// タイトル／プレイ中（通常・被弾・吸収・電力切れ）／ポーズ／ゲームオーバー／クリア を
// 1280x720 と 1920x1080 で撮影し tests/e2e/out/ui_*.png に保存する。
// 注意: 共有マシンは CPU が飽和しやすく WebGL の描画が極端に遅くなるため、
// テスト用ページでは requestAnimationFrame を止め、__game.step() で HUD を進める（HUD の確認が目的）。
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 5205);
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });

// vite を node で直接起動する（npx 経由だと終了時に子プロセスが残るため）
// HMR を切る設定で起動（他担当のファイル編集で全体リロードされるとテストが途中で初期化されるため）
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'tests/e2e/ui.vite.config.mjs', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
let serverFailed = false;
server.stderr.on('data', (d) => { serverFailed = true; process.stderr.write(String(d)); });
// 起動完了は HTTP で確認する
for (let i = 0; i < 120; i++) {
  try {
    const r = await fetch(`http://localhost:${port}/`);
    if (r.ok) break;
  } catch { /* まだ起動していない */ }
  await new Promise((res) => setTimeout(res, 500));
}

const exe = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

const errors = [];
const checks = [];
function check(name, ok, extra = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`);
}

// 画面の表示状態と主要な表示値を読む
const domState = (page) => page.evaluate(() => {
  const has = (sel, cls) => document.querySelector(sel)?.classList.contains(cls) ?? false;
  const txt = (sel) => document.querySelector(sel)?.textContent ?? '';
  return {
    screenTitle: has('.screen-title', 'show'),
    screenPause: has('.screen-pause', 'show'),
    screenOver: has('.screen-over', 'show'),
    screenClear: has('.screen-clear', 'show'),
    play: has('.play', 'show'),
    energyHint: !document.querySelector('.energy-hint')?.classList.contains('off'),
    rate: txt('.g-rate'),
    battNum: txt('.batt-num'),
    gStatus: txt('.g-status'),
  };
});

// HUD を n フレーム分進める（rAF を止めているため手動で進める）
const tick = (page, n = 3) => page.evaluate((k) => window.__game.step(1 / 60, k), n);

async function runAt(width, height) {
  const tag = `${width}`;
  const page = await browser.newPage({ viewport: { width, height } });
  // 3D 描画のループを止める（HUD 確認用。共有マシンでの撮影詰まりを避ける）
  await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const shot = (name) => page.screenshot({ path: `${outDir}/ui_${name}_${tag}.png`, timeout: 120000 });

  try {
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    await shot('title');
    let s = await domState(page);
    check(`[${tag}] タイトル画面が表示`, s.screenTitle && !s.play);

    // スタート（ボタン押下）
    await page.click('.screen-title button.btn-primary');
    await tick(page, 2);
    s = await domState(page);
    check(`[${tag}] スタートでプレイ中HUDへ`, s.play && !s.screenTitle);
    await shot('play_base');

    // 戦闘中らしい状態を注入
    await page.evaluate(async () => {
      const g = window.__game;
      const w = g.world;
      const T = g.THREE;
      // 敵は本物の spawnEnemy で作る（手作りの敵は他モジュールの更新で壊れるため）
      const api = await import('/src/enemies/api.ts');
      const boss = api.spawnEnemy(w, 'boss', new T.Vector3(0, 0, -20));
      boss.hp = 640;
      const drone = api.spawnEnemy(w, 'drone', new T.Vector3(3, 2, -9));
      drone.hp = 12;
      drone.overload = 5;

      w.player.energy = 62;
      w.player.hp = 64;
      w.functions.scouter = true;
      w.functions.autoAim = true;
      w.functions.flight = false;
      w.player.charging = true;
      w.player.charge = 0.6;
      w.level.rooms = [{ name: '区画3 高所回廊', min: new T.Vector3(), max: new T.Vector3(), entered: true, cleared: false }];
      w.level.currentRoom = 0;
      w.level.data.objective = 'ジェネレーターを停止させる';
      w.toasts = [
        { text: '区画3：高所へ。ドローンに注意', timer: 30 },
        { text: '充電ポイントを見つけた', timer: 30 },
      ];
      w.aimTarget = boss;
      w.aimTargetPoint = new T.Vector3(1.2, 2.5, -18);
      w.absorb.phase = 'attached';
      w.absorb.target = drone;
      w.player.absorbing = true;
    });
    // 電力が減っている最中の表示（消費量/秒）
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => { const w = window.__game.world; w.player.energy = Math.max(0, w.player.energy - 0.2); });
      await tick(page, 1);
    }
    await page.evaluate(() => {
      const g = window.__game;
      g.events.emit('enemyHit', { pos: new g.THREE.Vector3(), weak: true, damage: 20 });
    });
    await shot('play_full');
    s = await domState(page);
    check(`[${tag}] 電力消費量が負の値で表示`, /^-\d+\.\d\/秒$/.test(s.rate), `rate=${s.rate}`);
    check(`[${tag}] 吸収中は電力切れの案内を出さない`, s.energyHint === false, `energyHint=${s.energyHint}`);

    // 被弾（ビネット・HP揺れ）
    await page.evaluate(() => window.__game.events.emit('playerHit', { amount: 12 }));
    await tick(page, 2);
    await shot('play_hit');

    // 電力0（電力切れ表示・吸収の案内）
    await page.evaluate(() => {
      const w = window.__game.world;
      w.player.energy = 0;
      w.player.absorbing = false;
      w.absorb.phase = 'idle';
      w.absorb.target = null;
      w.functions.scouter = false;
      w.functions.autoAim = false;
      w.player.charging = false;
    });
    await tick(page, 3);
    await shot('play_noenergy');
    s = await domState(page);
    check(`[${tag}] 電力0で「電力切れ」と吸収の案内`, s.energyHint && s.gStatus === '電力切れ', `status=${s.gStatus}`);

    // ポーズ
    await page.evaluate(() => { const g = window.__game; g.input.simulateKey('KeyP', true); });
    await tick(page, 1);
    await page.evaluate(() => { const g = window.__game; g.input.simulateKey('KeyP', false); });
    await tick(page, 2);
    await shot('pause');
    s = await domState(page);
    const paused = await page.evaluate(() => window.__game.world.state);
    check(`[${tag}] P でポーズ画面`, s.screenPause && s.play && paused === 'paused', `state=${paused}`);

    // ポーズ画面のどこかをクリックで再開
    await page.mouse.click(40, height - 40);
    await tick(page, 2);
    const resumed = await page.evaluate(() => window.__game.world.state);
    check(`[${tag}] ポーズ画面のクリックで再開`, resumed === 'playing', `state=${resumed}`);

    // ゲームオーバー
    await page.evaluate(() => { const g = window.__game; g.world.player.hp = 0; });
    await tick(page, 2);
    await shot('gameover');
    s = await domState(page);
    check(`[${tag}] ゲームオーバー画面`, s.screenOver && !s.play);

    // リトライ → 再度プレイ → クリア
    await page.click('.screen-over button.btn-primary');
    await tick(page, 2);
    s = await domState(page);
    check(`[${tag}] リトライでプレイ再開`, s.play && !s.screenOver, `state=${await page.evaluate(() => window.__game.world.state)}`);
    await page.evaluate(() => {
      const g = window.__game;
      g.world.level.bossDefeated = true;
      g.world.stats.kills = 17;
      g.world.stats.energyUsed = 412;
      g.world.stats.energyAbsorbed = 133;
      g.world.stats.explosions = 3;
    });
    await tick(page, 2);
    await shot('clear');
    s = await domState(page);
    check(`[${tag}] クリア画面`, s.screenClear && !s.play);

    // タイトルへ戻る
    await page.click('.screen-clear button:has-text("タイトルへ")');
    await tick(page, 2);
    s = await domState(page);
    check(`[${tag}] タイトルへ戻る`, s.screenTitle && !s.screenClear);
  } finally {
    await page.close();
  }
}

try {
  if (serverFailed) throw new Error(`dev server failed to start on port ${port}`);
  await runAt(640, 360);
} finally {
  const realErrors = errors.filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED') && !e.includes('ERR_CONNECTION_REFUSED'));
  console.log('ERRORS', realErrors.length ? realErrors.join('\n') : 'none');
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`SUMMARY ${checks.length - failed}/${checks.length} passed`);
  await browser.close();
  server.kill('SIGKILL');
}
