// サージ収容所への道（ステージ）の確認: node tests/e2e/surge_stage_check.mjs [only]   （ポート 5331。only は撮る番号をカンマ区切りで）
//   CHROME_EXE=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
// 階段の上 → 階段 → ガレージ（車の場所・シャッター）→ シャッターが開く → 道・T字路・直線の街 → 収容所の柵と建物。
// 2階の西の出口からの切り替えも確認する。出力: tests/e2e/out/surge_*.png と、描画の重さ（三角形・描画数）のログ。
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';

const port = Number(process.env.PORT ?? 5331);
const only = process.argv[2] ?? '';
const outDir = 'tests/e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const exe = process.env.CHROME_EXE ?? '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// Google Fonts を待つとスクショが固まる
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_') && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, info === undefined ? '' : JSON.stringify(info)); };
// only="05,18,23" のように番号の頭だけ指定すると、その撮影だけ行う（チェックは毎回行う）
const want = (n) => !only || only.split(',').some((k) => n.startsWith(k));
const run = (n, dt = 1 / 60) => page.evaluate(([n, dt]) => window.__game.step(dt, n), [n, dt]);

/** 画面を 1 枚保存する（プレイヤー視点：そのときのカメラのまま） */
const shot = async (name) => {
  if (!want(name)) return;
  await page.evaluate(() => window.__game.render());
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outDir}/surge_${name}.png`, timeout: 280000 });
  console.log('shot', name);
};
/** フリーカメラ（次の step までの 1 フレーム）。空はカメラに追従させる */
const cam = async (name, pos, look, fov = 70) => {
  if (!want(name)) return;
  await page.evaluate(([pos, look, fov]) => {
    const g = window.__game, c = g.current.camera;
    c.fov = fov; c.updateProjectionMatrix(); c.position.set(...pos); c.up.set(0, 1, 0); c.lookAt(...look);
    const sky = g.current.scene.getObjectByName('surgeSky');
    if (sky) sky.position.copy(c.position);
    g.render();
  }, [pos, look, fov]);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outDir}/surge_${name}.png`, timeout: 280000 });
  console.log('shot', name);
};
const place = async (x, y, z, yaw, pitch = 0.05) => {
  await page.evaluate(([x, y, z, yaw, pitch]) => {
    const p = window.__game.current.player; p.pos.set(x, y, z); p.yaw = yaw; p.pitch = pitch; p.vel.set(0, 0, 0);
    window.__game.step(1 / 60, 40);
  }, [x, y, z, yaw, pitch]);
};
/** 見えている物の三角形数と描画数（フラスタム内のメッシュ） */
const load = () => page.evaluate(() => {
  const g = window.__game, w = g.current, T = g.THREE;
  const cam = w.camera;
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const fr = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  let tris = 0, draws = 0, allTris = 0, allMeshes = 0;
  w.scene.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return;
    const geo = o.geometry;
    const n = (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
    allTris += n; allMeshes++;
    if (!o.visible) return;
    if (o.frustumCulled !== false) {
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const s = geo.boundingSphere.clone().applyMatrix4(o.matrixWorld);
      if (!fr.intersectsSphere(s)) return;
    }
    tris += n; draws++;
  });
  return { visibleTris: Math.round(tris), visibleDraws: draws, sceneTris: Math.round(allTris), sceneMeshes: allMeshes, colliders: w.colliders.length };
});

try {
  await page.goto(`http://localhost:${port}/?level=surge&manual`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  await page.evaluate(() => { window.__game.start(); window.__game.step(1 / 60, 30); });
  const d0 = await page.evaluate(() => {
    const w = window.__game.current;
    return { pos: w.player.pos.toArray().map((v) => +v.toFixed(2)), obj: w.level.data.objective, drive: !!w.level.data.drive, surge: Object.keys(w.level.data.surge ?? {}) };
  });
  check('?level=surge で階段の上から始まる', Math.abs(d0.pos[1] - 10) < 0.3 && d0.pos[2] > 40, d0);
  check('演出担当向けのオブジェクトが公開されている', ['fence', 'fencePanels', 'wall', 'building'].every((k) => d0.surge.includes(k)), d0.surge);

  // ---- 階段の上と階段
  await shot('01_stairs_top');
  await place(0, 10.05, 36, 0, 0.18);
  await shot('02_stairs_mid');
  await place(0, 0.05, 17, Math.PI, 0.1);      // 階段を振り返る（下から）
  await shot('03_stairs_from_bottom');

  // ---- ガレージ
  await place(0, 0.05, 12.5, 0, 0.12);
  await shot('04_garage_from_door');
  await cam('05_garage_overview', [-10.5, 5.6, 12.5], [2, 1.5, -4], 80);
  await cam('06_garage_overview_east', [10.5, 5.2, 12.5], [-3, 1.5, -5], 80);
  await place(3.2, 0.05, -3.8, 0.55, 0.0);
  await shot('07_garage_socket');
  const pr = await page.evaluate(() => {
    const p = document.querySelector('div[style*="64%"]');
    return p && p.style.display !== 'none' ? p.textContent : null;
  });
  check('ソケットの近くでヒントが出る', pr === '撃つ / アームで電気を送る', pr);
  await place(1.8, 0.05, 6.2, -0.4, 0.1);
  await shot('08_garage_near_car_closed');

  // ---- 電力を送る → シャッターが開く
  await page.evaluate(() => {
    const w = window.__game.current;
    w.player.energy = 60;
    // 本物の経路：電源ソケットを撃つ（onShot）
    import('/src/core/sockets.ts').then((m) => m.getSockets(w)[0].onShot());
  });
  await page.waitForTimeout(300);
  await run(40);
  await shot('09_shutter_opening');
  await run(120);
  const sh = await page.evaluate(() => {
    const w = window.__game.current, s = w.level.data.surgeState;
    return { open: s.open, powered: s.powered, shutterActive: w.level.data.surge.shutter.active, obj: w.level.data.objective };
  });
  check('電力でシャッターが開く', sh.powered && sh.open === 1 && !sh.shutterActive, sh);
  await place(2.5, 0.05, 6, 0.9, 0.1);
  const pr2 = await page.evaluate(() => {
    const p = document.querySelector('div[style*="64%"]');
    return p && p.style.display !== 'none' ? p.textContent : null;
  });
  check('開いたあと、車の近くで乗車ヒント', pr2 === 'Bボタン / Rキー：車に乗る', pr2);
  await shot('10_garage_shutter_open');
  await cam('11_garage_looking_out', [0, 2.4, 9], [0, 3, -40], 75);

  // ---- 道
  await place(0, 0.05, -16, 0, 0.1);
  await shot('12_road_out_of_garage');
  await cam('13_garage_front_from_road', [14, 5, -60], [0, 8, -8], 70);
  await place(0, 0.05, -80, Math.PI / 2, 0.08);
  await shot('14_junction_look_west');
  await place(0, 0.05, -82, -Math.PI / 2, 0.08);
  await shot('15_junction_look_east_barricade');
  await cam('16_junction_overview', [45, 70, -10], [-30, 0, -90], 75);
  await cam('17_junction_topdown', [0, 140, -75], [0, 0, -75], 70);

  // ---- 直線の街
  await cam('18_straight_city', [-30, 4.5, -90], [-400, 20, -90], 70);
  await cam('19_straight_low', [-300, 2.2, -86], [-700, 18, -90], 65);
  await cam('20_straight_far', [-800, 5, -90], [-1400, 25, -90], 60);
  await cam('21_city_sidewalk', [-500, 1.7, -80], [-540, 10, -105], 75);
  await cam('22_gantry', [-110, 3.5, -90], [-180, 12, -90], 70);

  // ---- 収容所
  await cam('23_compound_approach', [-1180, 5, -90], [-1620, 35, -90], 60);
  await cam('24_compound_closer', [-1400, 4, -90], [-1620, 30, -90], 65);
  await cam('25_fence_close', [-1470, 3.2, -90], [-1500, 5, -90], 70);
  await cam('26_wall_from_fence', [-1505, 2.5, -90], [-1620, 25, -90], 75);
  await cam('27_wall_low_road', [-1560, 1.6, -90], [-1620, 14, -90], 80);
  await cam('28_compound_aerial', [-1250, 260, 120], [-1580, 30, -90], 70);
  await cam('29_fence_side', [-1450, 6, -40], [-1500, 4, -100], 70);
  await place(-1100, 0.05, -90, Math.PI / 2, 0.08);
  await shot('30_player_view_west');

  const ld = await load();
  console.log('load (compound aerial view not applied; current camera = player at x=-1100):', ld);
  await cam('31_dummy', [0, 3, -86], [-300, 10, -90], 70);
  console.log('load (looking west from junction):', await load());

  // ---- startAt=drive
  await page.goto(`http://localhost:${port}/?level=surge&start=drive&manual`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  await page.evaluate(() => { window.__game.start(); window.__game.step(1 / 60, 20); });
  const dr = await page.evaluate(() => {
    const w = window.__game.current;
    return { retryAt: w.level.data.retryAt, open: w.level.data.surgeState.open, boarded: w.level.data.surgeState.boarded, phase: w.level.data.drive?.phase ?? null };
  });
  check("start=drive：車に乗っていて、リトライ地点が 'drive'", dr.retryAt === 'drive' && dr.open === 1 && dr.boarded, dr);
  await shot('32_start_drive');

  // ---- 2階の西の出口 → surge
  await page.goto(`http://localhost:${port}/?level=floor2&manual`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
  await page.evaluate(() => { window.__game.start(); window.__game.step(1 / 60, 20); });
  const f2 = () => page.evaluate(() => {
    const w = window.__game.current;
    return { level: w.level.data.surge ? 'surge' : 'floor2', exitOpen: w.level.data.floor2?.exitOpen, next: w.level.data.nextLevel, obj: w.level.data.objective, z: +w.player.pos.z.toFixed(1) };
  });
  // 眠る前：近づいても開かない
  await page.evaluate(() => { const p = window.__game.current.player; p.pos.set(-8.5, 0, -8.5); p.yaw = 0.6; });
  await run(90);
  let s2 = await f2();
  check('眠る前は西の出口は開かない', s2.exitOpen === 0 && s2.level === 'floor2', s2);
  await shot('40_floor2_exit_locked');
  // 眠る（本物の流れ：ベッドで R）
  await page.evaluate(() => { const p = window.__game.current.player; p.pos.set(0, 0, 2.4); p.yaw = 0; });
  await run(12);
  await page.evaluate(() => window.__game.input.simulateKey('KeyR', true)); await run(2); await page.evaluate(() => window.__game.input.simulateKey('KeyR', false));
  await run(60 * 5);
  // 強化画面を閉じて（Esc）起き上がる
  await page.evaluate(() => window.__game.input.simulateKey('Escape', true)); await run(2);
  await page.evaluate(() => window.__game.input.simulateKey('Escape', false));
  await run(60 * 3);
  s2 = await f2();
  console.log('after sleep', s2);
  await page.evaluate(() => { const p = window.__game.current.player; p.pos.set(-6.5, 0, -6.0); p.yaw = 0.62; p.pitch = 0.0; });
  await run(100);
  s2 = await f2();
  check('眠ったあと、近づくとシャッターが開く', s2.exitOpen === 1, s2);
  await shot('41_floor2_exit_open');
  // 出入口まで歩く
  const A = (-35 * Math.PI) / 180;
  const exit = { dx: Math.sin(A), dz: -Math.cos(A), depth: 5 };
  exit.x = 13 * exit.dx; exit.z = 13 * exit.dz;
  await page.evaluate((e) => { const p = window.__game.current.player; p.pos.set(e.x + e.dx * (e.depth - 1.5), 0, e.z + e.dz * (e.depth - 1.5)); p.yaw = Math.atan2(-e.dx, -e.dz); }, exit);
  // 前進入力で歩く（本物の入力）
  await page.evaluate(() => window.__game.input.simulateKey('KeyW', true));
  await run(60 * 2);
  await page.evaluate(() => window.__game.input.simulateKey('KeyW', false));
  await run(60 * 2);
  const s3 = await page.evaluate(() => {
    const w = window.__game.current;
    return { surge: !!w.level.data.surge, pos: w.player.pos.toArray().map((v) => +v.toFixed(1)), obj: w.level.data.objective };
  });
  check('西の出口から入るとサージの道へ切り替わる（階段の上）', s3.surge && Math.abs(s3.pos[1] - 10) < 0.5, s3);
  await shot('42_after_switch');
} catch (e) {
  console.log('ERROR', e);
  results.push(false);
} finally {
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  await server.close();
  const bad = results.filter((r) => !r).length;
  console.log(bad ? `${bad} FAILED` : 'ALL PASSED');
  process.exit(bad ? 1 : 0);
}
