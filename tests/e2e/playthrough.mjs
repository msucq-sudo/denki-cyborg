// 通しプレイ自動確認: 簡易ボットがダンジョンを最初からボス撃破まで進む。
// 使い方: node tests/e2e/playthrough.mjs [maxGameSeconds=1500] [port=5300]
// - 本番ビルドを静的 preview で開き、?manual で描画ループを止めて __game.step で駆動する
// - 各区画入場時にスクショ、区画ごとの所要時間・被ダメ・電力推移・救済回数を出力
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';

const maxGame = Number(process.argv[2] ?? 1500);
const port = Number(process.argv[3] ?? 5300);
const outDir = 'tests/e2e/out/play';
fs.mkdirSync(outDir, { recursive: true });
execSync('npx vite build --outDir dist-e2e', { stdio: 'ignore' });
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-e2e', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes('Local')) res(); }); setTimeout(res, 8000); });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXE ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

async function shot(name) {
  await page.evaluate(() => window.__game.render());
  await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 120000 });
}

try {
  await page.goto(`http://localhost:${port}/?manual`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game);
  await page.evaluate(() => window.__game.step(1 / 60, 2));
  await shot('00_title');
  await page.evaluate(() => {
    const g = window.__game;
    document.querySelector('#hud button')?.click?.();
    if (g.current.state !== 'playing') g.start();
    // ボットの状態
    window.__bot = { mode: 'move', holdT: 0, stuckT: 0, lastPos: null, assists: 0, heals: 0, teleports: 0, log: [], roomStats: {}, lastRoom: -1, lastHp: 100 };
    const ev = g.events;
    for (const n of ['roomEnter', 'roomClear', 'bossStart', 'bossPhase', 'enemyKilled', 'explosion', 'absorbComplete', 'gameClear', 'gameOver'])
      ev.on(n, (p) => window.__bot.log.push([+g.current.time.toFixed(1), n, p && (p.index ?? p.kind ?? p.phase ?? '')].join(' ')));
  });
  await page.evaluate(() => window.__game.step(1 / 60, 2));
  await shot('01_start');

  let lastRoomShot = -1;
  let gameT = 0;
  while (gameT < maxGame) {
    const r = await page.evaluate(() => {
      const g = window.__game, w = g.current, b = window.__bot, inp = g.input, T = g.THREE;
      const p = w.player;
      for (let k = 0; k < 30; k++) {
        if (w.state !== 'playing') break;
        const dt = 1 / 30;
        // 救済（ボットは下手なので、進行確認のため HP が危険域なら回復して回数を記録）
        if (p.hp < 25) { p.hp = p.maxHp; b.heals++; }
        const room = w.level.currentRoom;
        if (room !== b.lastRoom) { b.roomStats[room] = { t0: w.time, dmg: 0, e0: +p.energy.toFixed(0), minE: p.energy, absorbed0: w.stats.energyAbsorbed, used0: w.stats.energyUsed }; b.lastRoom = room; }
        const rs = b.roomStats[room];
        if (rs) { if (p.hp < b.lastHp) rs.dmg += b.lastHp - p.hp; rs.minE = Math.min(rs.minE, p.energy); }
        b.lastHp = p.hp;

        const alive = w.enemies.filter((e) => e.status === 'active' || e.status === 'stunned');
        const center = p.pos.clone().add(new T.Vector3(0, 1.4, 0));
        let target = null, best = 1e9;
        for (const e of alive) { const d = e.pos.distanceTo(center); if (d < best) { best = d; target = e; } }

        const lookAt = (pt) => {
          const d = pt.clone().sub(center);
          p.yaw = Math.atan2(-d.x, -d.z);
          p.pitch = Math.max(-1.1, Math.min(1.0, Math.atan2(d.y, Math.hypot(d.x, d.z))));
        };
        const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'Space'];
        const setKey = (c, v) => { if (inp.isDown(c) !== v) inp.simulateKey(c, v); };

        if (target) {
          lookAt(target.pos);
          // ストレイフで回避っぽく
          const strafe = Math.sin(w.time * 1.3) > 0;
          setKey('KeyA', strafe); setKey('KeyD', !strafe);
          setKey('KeyW', best > 16); setKey('KeyS', best < 5);
          const a = w.absorb;
          if (a.phase === 'attached') {
            inp.mouse(0) && inp.simulateMouse(0, false);
            // 逆流：電力に余裕があり、周りに敵が多いとき
            const near = alive.filter((e) => e !== a.target && e.pos.distanceTo(a.target.pos) < 6).length;
            setKey('KeyF', p.energy > 50 && near >= 1 && a.target.kind !== 'boss');
          } else {
            setKey('KeyF', false);
            if (p.energy < 20 && best < 13 && a.phase === 'idle') {
              inp.mouse(0) && inp.simulateMouse(0, false);
              inp.simulateKey('KeyE', true); inp.simulateKey('KeyE', false); // 吸収アーム発射
            } else if (p.energy >= 12 && a.phase === 'idle') {
              // 溜め撃ち：1.25秒押して離す
              if (!inp.mouse(0)) { inp.simulateMouse(0, true); b.holdT = 0; }
              b.holdT += dt;
              if (b.holdT > 1.25) { inp.simulateMouse(0, false); b.holdT = 0; }
            } else if (p.energy >= 3 && p.energy < 12 && a.phase === 'idle') {
              if (inp.mouse(0)) inp.simulateMouse(0, false); else inp.simulateMouse(0, true);
            }
          }
          // ボス・ヘビーは時々回避
          if ((target.kind === 'heavy' || target.kind === 'boss') && Math.random() < 0.02 && p.energy > 30) { inp.simulateKey('KeyC', true); inp.simulateKey('KeyC', false); }
          b.stuckT = 0; b.bestZ = undefined;
          // 一定時間ダメージを与えられない（届かない/見えない）→ 目標の近くへ救済移動
          const hpSum = alive.reduce((s, e) => s + e.hp, 0);
          if (b.lastHpSum === undefined || hpSum < b.lastHpSum - 0.5) { b.lastHpSum = hpSum; b.noDmgT = 0; } else b.noDmgT = (b.noDmgT || 0) + dt;
          if (b.noDmgT > 10) {
            const dir = center.clone().sub(target.pos).setY(0).normalize();
            const dst = target.pos.clone().addScaledVector(dir, 6);
            p.pos.set(dst.x, Math.max(0, target.pos.y - target.radius - 0.2), dst.z); p.vel.set(0, 0, 0);
            b.teleports++; b.noDmgT = 0; b.lastHpSum = undefined;
          }
        } else {
          b.lastHpSum = undefined; b.noDmgT = 0;
          for (const k of keys) setKey(k, false);
          inp.mouse(0) && inp.simulateMouse(0, false);
          // 充電パッドがあれば電力が少ないとき寄る（データが無ければ無視）
          // 次の区画へ：-z 方向へ x=0 に寄せながら進む
          const ahead = new T.Vector3(0, 1.4, p.pos.z - 10);
          lookAt(ahead);
          p.pitch = -0.1;
          setKey('KeyW', true);
          const pos = p.pos.clone();
          // 前進（-z）が進んでいなければ引っかかり
          if (b.bestZ === undefined || pos.z < b.bestZ - 0.3) { b.bestZ = pos.z; b.stuckT = 0; } else b.stuckT += dt;
          if (b.stuckT > 1.0) {
            // 横に避ける
            const side = Math.floor(b.stuckT / 1.5) % 2 === 0;
            setKey('KeyA', side); setKey('KeyD', !side); setKey('Space', b.stuckT % 1 < 0.1);
          } else { setKey('KeyA', false); setKey('KeyD', false); setKey('Space', false); }
          if (b.stuckT > 7) {
            const nr = w.level.rooms[room + 1];
            if (nr) { p.pos.set((nr.min.x + nr.max.x) / 2, nr.min.y + 0.2, nr.max.z - 3); p.vel.set(0, 0, 0); b.teleports++; }
            b.stuckT = 0; b.bestZ = undefined;
          }
          b.lastPos = pos;
        }
        g.step(dt);
        inp.endFrame && 0;
      }
      return { t: w.time, state: w.state, room: w.level.currentRoom, hp: Math.round(p.hp), e: Math.round(p.energy), enemies: w.enemies.length, pos: p.pos.toArray().map((v) => +v.toFixed(1)) };
    });
    gameT = r.t;
    if (r.room !== lastRoomShot && r.room >= 0) {
      // 入場から少し経ってから撮る
      await page.evaluate(() => window.__game.step(1 / 30, 45));
      await shot(`room_${r.room}`);
      lastRoomShot = r.room;
      console.log('ROOM', JSON.stringify(r));
    }
    if (r.state !== 'playing') { console.log('END', JSON.stringify(r)); break; }
  }
  await shot('99_end');
  const summary = await page.evaluate(() => {
    const w = window.__game.current, b = window.__bot;
    const rooms = Object.entries(b.roomStats).map(([k, v], i, arr) => {
      const next = arr[i + 1]?.[1];
      return { room: +k, sec: Math.round((next ? next.t0 : w.time) - v.t0), dmg: Math.round(v.dmg), e0: v.e0, minE: Math.round(v.minE) };
    });
    return { state: w.state, time: Math.round(w.time), stats: w.stats, heals: b.heals, teleports: b.teleports, rooms, log: b.log.slice(-60) };
  });
  console.log('SUMMARY', JSON.stringify(summary, null, 1));
} finally {
  console.log('ERRORS', errors.length ? errors.slice(0, 20).join('\n') : 'none');
  await browser.close();
  server.kill();
}
