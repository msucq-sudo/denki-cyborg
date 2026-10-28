// 強化画面の確認: CHROME_EXE=... node tests/e2e/upgrade_check.mjs   （ポート 5321）
// 2階のベッドで眠る → 強化画面が開く → GUN / BODY / ARM / SKILL を巡る → 強化・拒否 → 閉じる → 起き上がって操作が戻る。
// 出力: tests/e2e/out/upgrade_*.png
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';

const port = Number(process.env.PORT ?? 5321);
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const exe = process.env.CHROME_EXE ?? '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// Google Fonts を待つとスクショが固まる
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_') && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, info === undefined ? '' : JSON.stringify(info)); };
const run = (n, dt = 1 / 60) => page.evaluate(([n, dt]) => window.__game.step(dt, n), [n, dt]);
const shot = async (name) => {
  await run(50); // ポーズの切り替え（なめらかに動く）が落ち着くまで
  await page.evaluate(() => window.__game.render());
  await page.waitForTimeout(900); // CSS アニメーション（壁時計）が落ち着くのを待つ
  await page.evaluate(() => window.__game.render());
  await page.screenshot({ path: `${outDir}/upgrade_${name}.png`, timeout: 280000 });
  console.log('shot', name);
};
const tap = async (code) => {
  await page.evaluate((c) => window.__game.input.simulateKey(c, true), code);
  await run(2);
  await page.evaluate((c) => window.__game.input.simulateKey(c, false), code);
  await run(2);
};
const st = () => page.evaluate(() => {
  const g = window.__game, w = g.current;
  return { ...g.upgradeScreen.debug(), open: g.upgradeScreen.isOpen, gears: w.inventory.gears, up: { ...w.upgrades }, locked: g.input.locked,
    phase: w.level.data.floor2.phase, held: w.level.data.floor2.held, hp: w.player.hp, maxHp: w.player.maxHp };
});
const dom = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent), sel);

try {
  await page.goto(`http://localhost:${port}/?level=floor2&gears=10&manual`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  await page.addStyleTag({ content: '*, *::before, *::after { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }' });
  await page.evaluate(() => { window.__game.start(); window.__game.step(1 / 60, 20); });
  let s = await st();
  check('?gears=10 で歯車10個', s.gears === 10, s.gears);

  // ---- ベッドで眠る（本物の流れ）
  await page.evaluate(() => { const p = window.__game.current.player; p.pos.set(0, 0, 2.4); p.yaw = 0; });
  await run(12);
  await tap('KeyR');
  await run(60 * 5); // walk + lie + sleep
  s = await st();
  check('眠り終わると強化画面が開く', s.open && s.phase === 'rest' && s.held, s);
  check('操作はロックされている', s.locked === true);
  await run(60 * 9); // autoWake(7秒) を超えても起きない
  s = await st();
  check('画面が開いている間は自動で起きない', s.phase === 'rest' && s.open, s.phase);
  check('歯車の表示', (await dom('.us-gear-num'))[0] === '10', await dom('.us-gear-num'));
  check('タブ順 GUN BODY ARM SKILL', (await dom('.us-tab-en')).join() === 'GUN,BODY,ARM,SKILL', await dom('.us-tab-en'));
  await shot('01_gun');
  check('GUN は行1つ（ピストル）', (await dom('.us-name')).join() === 'ピストル', await dom('.us-name'));

  // ---- BODY
  await tap('KeyD');
  s = await st();
  check('D で BODY へ', s.cat === 'body', s.cat);
  await shot('02_body');

  // ---- ARM
  await tap('ArrowRight');
  await shot('03_arm');

  // ---- SKILL（2行目にフォーカス）
  await tap('KeyE');
  await tap('KeyS');
  s = await st();
  check('SKILL の2行目', s.cat === 'skill' && s.row === 1, s);
  check('SKILL は4行', (await dom('.us-name')).length === 4);
  await shot('04_skill');

  // ---- 強化（素早さ Lv1→2: 歯車2）
  const before = (await st()).gears;
  await tap('Enter');
  s = await st();
  check('強化で歯車が減りレベルが上がる', s.gears < before && s.up['skill.speed'] === 2, { before, s: s.gears, up: s.up });
  await run(60);
  check('歯車表示が減る', (await dom('.us-gear-num'))[0] === String(s.gears), await dom('.us-gear-num'));
  await shot('05_levelup');

  // ---- 拒否（歯車不足）
  await page.evaluate(() => { window.__game.current.inventory.gears = 0; });
  await tap('Enter');
  await run(30);
  s = await st();
  check('歯車不足ではレベルが上がらない', s.up['skill.speed'] === 2 && s.gears === 0, s.up);
  const denied = await page.evaluate(() => window.__audioDebug?.played?.uiDenied ?? 0);
  check('拒否音', denied >= 1, denied);
  await page.waitForTimeout(100);
  await page.evaluate(() => window.__game.render());
  await page.screenshot({ path: `${outDir}/upgrade_06_denied.png` });

  // ---- 最大まで（BODY）
  await page.evaluate(() => { window.__game.current.inventory.gears = 99; });
  await tap('KeyA'); await tap('KeyA'); await tap('KeyA'); // SKILL→ARM→BODY→GUN ではなく BODY へ戻す
  await tap('KeyD');
  s = await st();
  if (s.cat !== 'body') { await tap('KeyD'); }
  for (let i = 0; i < 6; i++) await tap('Enter');
  s = await st();
  const hpOk = s.maxHp > 100;
  check('BODY を最大まで上げる（最大HPが増える）', s.up.body >= 5 && hpOk, { up: s.up, maxHp: s.maxHp });
  await shot('07_body_max');
  await tap('Enter');
  const msg = await dom('.us-note');
  check('最大では「これ以上」と出る', /これ以上/.test(msg[0]), msg);

  // ---- GUN を最大近くまで
  await tap('KeyA');
  await tap('Enter'); await tap('Enter');
  await shot('08_gun_lv3');

  // ---- パッド表示
  await page.evaluate(() => { window.__game.input.lastDevice = 'pad'; });
  await run(2);
  await shot('09_pad_hints');
  await page.evaluate(() => { window.__game.input.lastDevice = 'kbm'; });

  // ---- 閉じる → 起き上がる
  await run(2);
  await tap('Escape');
  await run(60);
  s = await st();
  check('閉じると画面が消える', !s.open, s);
  check('起き上がりが始まる', s.phase === 'wake' || s.phase === 'free', s.phase);
  await run(60 * 2);
  s = await st();
  check('起きて自由に動ける状態に戻る', s.phase === 'free' && s.locked === false, s);
  await page.evaluate(() => window.__game.render());
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}/upgrade_10_after.png` });
  // 入力が通る（Space でジャンプ）。画面を閉じたキーが漏れていない
  const vy = await page.evaluate(async () => {
    const g = window.__game, p = g.current.player;
    g.input.simulateKey('Space', true); g.step(1 / 60, 3);
    const v = p.vel.y; g.input.simulateKey('Space', false); g.step(1 / 60, 1);
    return v;
  });
  check('Space でジャンプできる', vy > 0, vy);
  check('強化は残る', (await st()).up.body >= 5);

  // ---- 960x540 でも破綻しない
  await page.setViewportSize({ width: 960, height: 540 });
  await page.evaluate(() => { window.dispatchEvent(new Event('resize')); window.__game.current.inventory.gears = 5; window.__game.openUpgrade(); window.__game.step(1 / 60, 40); });
  await page.evaluate(() => { const i = window.__game.input; i.simulateKey('KeyE', true); window.__game.step(1 / 60, 2); i.simulateKey('KeyE', false); i.simulateKey('KeyE', true); window.__game.step(1 / 60, 2); i.simulateKey('KeyE', false); i.simulateKey('KeyE', true); window.__game.step(1 / 60, 2); i.simulateKey('KeyE', false); window.__game.step(1 / 60, 2); });
  await shot('11_small_skill');
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  check('960x540 で横スクロールなし', noOverflow);
  await page.evaluate(() => { const i = window.__game.input; i.simulateKey('KeyQ', true); window.__game.step(1 / 60, 2); i.simulateKey('KeyQ', false); window.__game.step(1 / 60, 2); i.simulateKey('KeyQ', true); window.__game.step(1 / 60, 2); i.simulateKey('KeyQ', false); window.__game.step(1 / 60, 2); i.simulateKey('KeyQ', true); window.__game.step(1 / 60, 2); i.simulateKey('KeyQ', false); window.__game.step(1 / 60, 2); });
  await shot('12_small_gun');
  // デバッグで開いた画面も Esc で閉じて、本編の描画に戻る
  await tap('Escape');
  await run(60);
  s = await st();
  check('openUpgrade() で開いた画面も閉じられる', !s.open, s);
} catch (e) {
  console.log('ERROR', e);
  results.push(false);
}
console.log('console errors:', errors.length ? errors : 'none');
check('コンソールエラーなし', errors.length === 0);
await browser.close();
await server.close();
process.exit(results.every(Boolean) ? 0 : 1);
