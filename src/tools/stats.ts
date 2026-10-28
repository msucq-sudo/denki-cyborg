// データ一覧：数値はすべて balance.ts などの定数から実行時に読む（複製しない）
import * as B from '../config/balance';
import { ENEMY_ORDER, ENEMY_INFO, enemyNo } from '../config/enemyInfo';
import { WEAPONS } from '../player/weapons';
import { HEAVY, CRAWLER } from '../enemies/ai';
import { WALKER } from '../enemies/kinds/walker';
import { HEAVY_WALKER } from '../enemies/kinds/heavyWalker';
import { MISSILE_BOT } from '../enemies/kinds/missileBot';
import type { EnemyKind } from '../config/balance';

const { PLAYER, CAMERA, GUN, DODGE, DASH, ABSORB, OVERLOAD, FUNCTIONS, ENEMIES, ENEMY_NOTICE, METAL, LOCKDOWN, LEVEL, BOSS, CHARACTER } = B;
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const val = (v: unknown) => (typeof v === 'number' ? fmt(v) : Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : esc(v));

/** 1行 = [項目名, 値, 定数名, 説明, 派生か] */
type Row = [string, string | number, string, string?, boolean?];
const sec = (title: string, src: string, rows: Row[], note = '') =>
  `<section><h2>${esc(title)}<span class="src">${esc(src)}</span></h2><table><tr><th>項目</th><th>値</th><th>定数</th><th>説明</th></tr>${rows
    .map(([k, v, c, d, der]) => `<tr class="row${der ? ' derived' : ''}" data-t="${esc((k + c + (d ?? '') + title).toLowerCase())}"><td>${esc(k)}</td><td class="v">${typeof v === 'number' ? fmt(v) : esc(v)}</td><td class="src">${esc(c)}</td><td class="d">${esc(d ?? '')}</td></tr>`)
    .join('')}</table>${note ? `<p class="note">${esc(note)}</p>` : ''}</section>`;
/** 定数オブジェクトを丸ごと key/value 行にする */
const objRows = (o: object, prefix: string): Row[] =>
  Object.entries(o).map(([k, v]): Row =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? [k, Object.entries(v).map(([a, b]) => `${a}=${val(b)}`).join(' / '), `${prefix}.${k}`]
      : [k, val(v), `${prefix}.${k}`]);

const WNAME: Record<string, string> = { pistol: 'ピストル', shotgun: 'ショットガン', assault: 'アサルト', rifle_dummy: 'ライフル（ダミー）' };
const tabs: Record<string, () => string> = {
  プレイヤー: () => {
    const fl = FUNCTIONS.flight;
    return [
      sec('体力・電力', 'PLAYER / LEVEL', [
        ['HP 最大', PLAYER.maxHp, 'PLAYER.maxHp', '0で死亡'],
        ['電力 最大', PLAYER.maxEnergy, 'PLAYER.maxEnergy', '撃つ・回避・ダッシュ・飛行で消費'],
        ['電力 開始時', PLAYER.startEnergy, 'PLAYER.startEnergy'],
        ['被弾後の無敵', `${PLAYER.hitInvuln} 秒`, 'PLAYER.hitInvuln'],
        ['修理キット回復量', LEVEL.repairKitHeal, 'LEVEL.repairKitHeal'],
        ['充電ポイント', `${LEVEL.chargePadRate}/秒（総量 ${LEVEL.chargePadCapacity}）`, 'LEVEL.chargePad*'],
      ]),
      sec('移動・ジャンプ', 'PLAYER / DASH', [
        ['移動速度', `${PLAYER.moveSpeed} m/s`, 'PLAYER.moveSpeed'],
        ['ダッシュ倍率', `×${DASH.speedMul}`, 'DASH.speedMul'],
        ['ダッシュ速度', `${fmt(PLAYER.moveSpeed * DASH.speedMul)} m/s`, '（派生）', 'moveSpeed × speedMul', true],
        ['ダッシュ電力消費', `${DASH.drainPerSec}/秒`, 'DASH.drainPerSec', '移動している間だけ'],
        ['ダッシュで持つ時間', `${fmt(PLAYER.maxEnergy / DASH.drainPerSec)} 秒`, '（派生）', '満タンから', true],
        ['歩幅（歩き / 走り）', `${CHARACTER.anim.strideWalk} / ${CHARACTER.anim.strideRun} m`, 'CHARACTER.anim.strideWalk / strideRun', '見た目：1歩ぶんの距離'],
        ['歩数/秒（歩き）', fmt(PLAYER.moveSpeed / (CHARACTER.anim.strideWalk / 2)), '（派生）', 'moveSpeed / (strideWalk/2)', true],
        ['歩数/秒（ダッシュ）', fmt((PLAYER.moveSpeed * DASH.speedMul) / (CHARACTER.anim.strideRun / 2)), '（派生）', 'moveSpeed×speedMul / (strideRun/2)', true],
        ['ジャンプ初速', PLAYER.jumpSpeed, 'PLAYER.jumpSpeed'],
        ['重力', PLAYER.gravity, 'PLAYER.gravity'],
        ['ジャンプ最高到達', `${fmt(PLAYER.jumpSpeed ** 2 / (2 * PLAYER.gravity))} m`, '（派生）', 'v²/2g', true],
        ['当たり半径 / 身長', `${PLAYER.radius} / ${PLAYER.height} m`, 'PLAYER.radius / height'],
      ]),
      sec('行動中の制限', 'PLAYER / CAMERA.aim', [
        ['溜め中の移動速度', `×${PLAYER.chargeMoveMul}`, 'PLAYER.chargeMoveMul'],
        ['吸収中の移動速度', `×${PLAYER.absorbMoveMul}`, 'PLAYER.absorbMoveMul', '吸収中は撃てない・ジャンプ／回避／ダッシュ／ジェットパック不可'],
        ['照準中の移動速度', `×${CAMERA.aim.moveMul}`, 'CAMERA.aim.moveMul', '右クリック長押し / LT'],
        ['照準中の感度', `×${CAMERA.aim.sensMul}`, 'CAMERA.aim.sensMul'],
        ['照準中の視野角', `${CAMERA.aim.fov}°（通常 ${CAMERA.fov}°）`, 'CAMERA.aim.fov'],
      ]),
      sec('ジェットパック【基本機能（最初から使える）】', 'FUNCTIONS.flight', [
        ['滞空中の電力消費', `${fl.flyingDrainPerSec}/秒`, 'FUNCTIONS.flight.flyingDrainPerSec', '滞空している間だけ消費'],
        ['滞空できる時間', `${fmt(PLAYER.maxEnergy / fl.flyingDrainPerSec)} 秒`, '（派生）', '満タンから', true],
        ['滞空開始の縦速度', fl.engageVy, 'FUNCTIONS.flight.engageVy', '空中でジャンプ長押し→縦速度がこれ以下で滞空'],
        ['滞空の減衰', fl.hoverDamp, 'FUNCTIONS.flight.hoverDamp', '高く飛ぶのでなく「その高さを維持」'],
      ]),
    ].join('');
  },

  武器: () => {
    const wk = GUN.weakMultiplier;
    const rows: Row[] = [
      ['単発 ダメージ', GUN.tapDamage, 'GUN.tapDamage'],
      ['単発 電力コスト', GUN.tapCost, 'GUN.tapCost'],
      ['単発 発射間隔', `${GUN.tapInterval} 秒`, 'GUN.tapInterval'],
      ['溜め開始までの長押し', `${GUN.chargeThreshold} 秒`, 'GUN.chargeThreshold'],
      ['溜め 最小ダメージ', GUN.chargeMinDamage, 'GUN.chargeMinDamage', '溜め開始直後に離した場合'],
      ['溜め 最大ダメージ', GUN.chargeMaxDamage, 'GUN.chargeMaxDamage'],
      ['溜め 最大までの時間', `${GUN.chargeTime} 秒`, 'GUN.chargeTime'],
      ['溜め 電力コスト(最大)', GUN.chargeCostTotal, 'GUN.chargeCostTotal', '溜め中に徐々に消費'],
      ['弾速（単発）', `${GUN.bulletSpeed} m/s`, 'GUN.bulletSpeed'],
      ['弾速（溜め）', `${GUN.chargedBulletSpeed} m/s`, 'GUN.chargedBulletSpeed'],
      ['弾の寿命', `${GUN.bulletLife} 秒`, 'GUN.bulletLife'],
      ['弱点倍率', `×${wk}`, 'GUN.weakMultiplier', '敵ごとの倍率は「敵」タブ（ENEMIES.weakMultiplier）'],
    ];
    const full = Math.floor(PLAYER.maxEnergy / GUN.tapCost);
    const der: Row[] = [
      ['DPS（連打）', fmt(GUN.tapDamage / GUN.tapInterval), '（派生）', 'tapDamage / tapInterval', true],
      ['DPS（連打・弱点）', fmt((GUN.tapDamage * wk) / GUN.tapInterval), '（派生）', '弱点倍率込み（GUN側）', true],
      ['ダメージ/電力（単発）', fmt(GUN.tapDamage / GUN.tapCost), '（派生）', 'tapDamage / tapCost', true],
      ['ダメージ/電力（最大溜め）', fmt(GUN.chargeMaxDamage / GUN.chargeCostTotal), '（派生）', 'chargeMaxDamage / chargeCostTotal', true],
      ['最大溜めの DPS', fmt(GUN.chargeMaxDamage / GUN.chargeTime), '（派生）', '溜め時間のみで計算', true],
      ['満タン電力で撃てる単発数', full, '（派生）', 'maxEnergy / tapCost', true],
      ['満タン電力で撃てる最大溜め数', Math.floor(PLAYER.maxEnergy / GUN.chargeCostTotal), '（派生）', 'maxEnergy / chargeCostTotal', true],
      ['満タン電力の総ダメージ（単発）', full * GUN.tapDamage, '（派生）', '', true],
    ];
    const wrows = Object.entries(WEAPONS).map(([id, w]) => {
      const impl = id === 'pistol';
      const name = WNAME[w.id] ?? w.id;
      return `<tr class="row" data-t="${esc((id + name).toLowerCase())}"><td>${esc(name)}</td><td class="src">${esc(id)}</td><td class="v ${impl ? '' : 'warn'}">${impl ? '実装済み（上の数値）' : 'モデルのみ・性能未実装'}</td></tr>`;
    }).join('');
    return sec('ピストル', 'GUN', rows) + sec('ピストルの派生値', 'GUN / PLAYER', der) +
      `<section><h2>武器ラインナップ<span class="src">WEAPONS (src/player/weapons.ts)</span></h2><table><tr><th>武器</th><th>id</th><th>状態</th></tr>${wrows}</table></section>`;
  },

  '機能・アクション': () => {
    const g = (B as Record<string, unknown>).GRAPPLE as object | undefined;
    return [
      sec('吸収アーム', 'ABSORB', [
        ['射程', `${ABSORB.range} m`, 'ABSORB.range'],
        ['敵HPを吸う速度', `${ABSORB.drainPerSec}/秒`, 'ABSORB.drainPerSec'],
        ['電力への変換率', `${fmt(ABSORB.conversion * 100)}%`, 'ABSORB.conversion'],
        ['得られる電力/秒', fmt(ABSORB.drainPerSec * ABSORB.conversion), '（派生）', 'drainPerSec × conversion', true],
        ['吸い切りボーナス', `+${ABSORB.finishBonus}`, 'ABSORB.finishBonus', '吸い切って停止させたとき'],
        ['切れる距離', `${ABSORB.breakDistance} m`, 'ABSORB.breakDistance', 'テザーが切れる'],
        ['クールダウン', `${ABSORB.cooldown} 秒`, 'ABSORB.cooldown'],
        ['電力コスト', ABSORB.cost, 'ABSORB.cost'],
        ['アーム伸び / 戻り速度', `${ABSORB.extendSpeed} / ${ABSORB.retractSpeed} m/s`, 'ABSORB.extendSpeed / retractSpeed'],
      ]),
      sec('逆流（オーバーロード）', 'OVERLOAD / BOSS', [
        ['プレイヤーが失う電力', `${OVERLOAD.energyPerSec}/秒`, 'OVERLOAD.energyPerSec', '逆流中'],
        ['爆発半径', `${OVERLOAD.explosionRadius} m`, 'OVERLOAD.explosionRadius'],
        ['爆発ダメージ', OVERLOAD.explosionDamage, 'OVERLOAD.explosionDamage'],
        ['自爆の範囲 / ダメージ', `${OVERLOAD.selfDamageRadius} m / ${OVERLOAD.selfDamage}`, 'OVERLOAD.selfDamage*', '爆心に近いとプレイヤーも被弾'],
        ['ボス：ショート時スタン / ダメージ', `${BOSS.shortStun} 秒 / ${BOSS.shortDamage}`, 'BOSS.short*', '満タン時は爆発せずショート'],
        ['敵の満タン必要量', '「敵」タブの過負荷上限', 'ENEMIES.overloadCap'],
      ]),
      sec('回避', 'DODGE', [
        ['電力コスト', DODGE.cost, 'DODGE.cost'],
        ['速度', `${DODGE.speed} m/s`, 'DODGE.speed'],
        ['継続', `${DODGE.duration} 秒`, 'DODGE.duration'],
        ['移動距離', `${fmt(DODGE.speed * DODGE.duration)} m`, '（派生）', 'speed × duration', true],
        ['無敵時間', `${DODGE.invuln} 秒`, 'DODGE.invuln'],
        ['クールダウン', `${DODGE.cooldown} 秒`, 'DODGE.cooldown'],
      ]),
      sec('スカウター【基本機能（最初から使える）】', 'FUNCTIONS.scouter', [
        ['スカウター 電力消費', `${FUNCTIONS.scouter.drainPerSec}/秒`, 'FUNCTIONS.scouter.drainPerSec', '常時使える標準装備'],
      ]),
      sec('オートエイム【特殊機能（後で解放・初期は使えない）】', 'FUNCTIONS.autoAim', [
        ['オートエイム 1発の消費', FUNCTIONS.autoAim.costPerShot, 'FUNCTIONS.autoAim.costPerShot', 'ロック中に撃った瞬間だけ'],
        ['オートエイム 角度', `${FUNCTIONS.autoAim.coneDeg}°`, 'FUNCTIONS.autoAim.coneDeg'],
        ['オートエイム 最大距離', `${FUNCTIONS.autoAim.maxRange} m`, 'FUNCTIONS.autoAim.maxRange'],
      ]),
      g ? sec('グラップル', 'GRAPPLE', objRows(g, 'GRAPPLE'))
        : '<section><h2>グラップル<span class="src">GRAPPLE</span></h2><table><tr class="row" data-t="グラップル grapple"><td class="warn">実装中（balance.ts に GRAPPLE がまだありません）</td></tr></table></section>',
      sec('敵の気づき', 'ENEMY_NOTICE', [
        ['気づく距離', `${ENEMY_NOTICE.range} m`, 'ENEMY_NOTICE.range', '見えている状態でこの距離まで近づくと反応。気づいたら sightRange まで追う'],
        ['仲間に伝わる距離', `${ENEMY_NOTICE.shareRadius} m`, 'ENEMY_NOTICE.shareRadius'],
      ]),
      sec('閉じ込め演出', 'LOCKDOWN', [
        ['有効', LOCKDOWN.enabled ? 'ON' : 'OFF', 'LOCKDOWN.enabled', 'OFFで警報照明とサイレンが止まる'],
        ['警報照明の色', '#' + LOCKDOWN.light.toString(16).padStart(6, '0'), 'LOCKDOWN.light'],
        ['サイレン回数', LOCKDOWN.sirenCycles, 'LOCKDOWN.sirenCycles', 'サイレンを鳴らす回数'],
        ['サイレン音量', LOCKDOWN.sirenVolume, 'LOCKDOWN.sirenVolume'],
      ]),
    ].join('');
  },

  敵: () => `<section><h2>敵一覧<span class="src">ENEMIES / ENEMY_INFO / METAL.drop</span></h2>
    <p class="note">列見出しクリックで並び替え、行クリックで詳細。黄色の列は派生値（ピストル単発 ${GUN.tapDamage} ダメージ・電力 ${GUN.tapCost}/発 で計算）。</p>
    <table id="etable"></table></section>`,

  強化素材: () => {
    const drops = ENEMY_ORDER.map((k) => [ENEMY_INFO[k].name, `${METAL.drop[k]} 個`, `METAL.drop.${k}`] as Row);
    return sec('メタルのドロップ量', 'METAL.drop', drops, '1体あたりの量。') +
      sec('メタルの挙動', 'METAL', [
        ['逆流撃破の倍率', `×${METAL.overloadMul}`, 'METAL.overloadMul', '逆流で爆発させて倒したときのメタル倍率'],
        ['最大かけら数', METAL.maxPieces, 'METAL.maxPieces', '見た目のかけらの最大個数'],
        ['吸い寄せ距離', `${METAL.magnetRadius} m`, 'METAL.magnetRadius'],
        ['吸い寄せ速度', `${METAL.magnetSpeed} m/s`, 'METAL.magnetSpeed'],
        ['拾う距離', `${METAL.pickupRadius} m`, 'METAL.pickupRadius'],
        ['消えるまで', `${METAL.life} 秒`, 'METAL.life'],
      ]) +
      '<section><h2>歯車<span class="src">src/level/gear.ts</span></h2><table><tr class="row" data-t="歯車 gear"><td>研究所1階には歯車が 7 個あります。</td></tr></table></section>';
  },
};

// ---- 敵テーブル ----
const kindConsts: Partial<Record<EnemyKind, [string, object][]>> = {
  crawler: [['CRAWLER', CRAWLER]], heavy: [['HEAVY', HEAVY]], walker: [['WALKER', WALKER]],
  heavyWalker: [['HEAVY_WALKER', HEAVY_WALKER]], missile: [['MISSILE_BOT', MISSILE_BOT]],
};
const r1 = (n: number) => Math.round(n * 100) / 100;
const cols: { key: string; label: string; get: (k: EnemyKind) => number | string; der?: boolean; text?: boolean }[] = [
  { key: 'no', label: 'No.', get: (k) => enemyNo(k) },
  { key: 'name', label: '名前', get: (k) => ENEMY_INFO[k].name, text: true },
  { key: 'hp', label: 'HP', get: (k) => ENEMIES[k].hp },
  { key: 'speed', label: '速度', get: (k) => ENEMIES[k].speed },
  { key: 'radius', label: '半径', get: (k) => ENEMIES[k].radius },
  { key: 'damage', label: '攻撃力', get: (k) => ENEMIES[k].damage },
  { key: 'ai', label: '攻撃間隔', get: (k) => ENEMIES[k].attackInterval },
  { key: 'ps', label: '弾速', get: (k) => ENEMIES[k].projectileSpeed },
  { key: 'wk', label: '弱点倍率', get: (k) => ENEMIES[k].weakMultiplier },
  { key: 'oc', label: '過負荷上限', get: (k) => ENEMIES[k].overloadCap },
  { key: 'sr', label: '索敵距離', get: (k) => ENEMIES[k].sightRange },
  { key: 'metal', label: 'メタル', get: (k) => METAL.drop[k] },
  { key: 'ometal', label: '逆流撃破時のメタル', get: (k) => METAL.drop[k] * METAL.overloadMul, der: true },
  { key: 'shots', label: '単発で倒す発数', get: (k) => Math.ceil(ENEMIES[k].hp / GUN.tapDamage), der: true },
  { key: 'shotsw', label: '弱点なら', get: (k) => Math.ceil(ENEMIES[k].hp / (GUN.tapDamage * ENEMIES[k].weakMultiplier)), der: true },
  { key: 'need', label: '必要電力', get: (k) => Math.ceil(ENEMIES[k].hp / GUN.tapDamage) * GUN.tapCost, der: true },
  { key: 'drain', label: '吸い切り秒', get: (k) => r1(ENEMIES[k].hp / ABSORB.drainPerSec), der: true },
  { key: 'gain', label: '吸収で得る電力', get: (k) => r1(ENEMIES[k].hp * ABSORB.conversion + ABSORB.finishBonus), der: true },
  { key: 'dps', label: '対プレイヤーDPS', get: (k) => r1(ENEMIES[k].damage / ENEMIES[k].attackInterval), der: true },
];
let sortKey = '';
let sortDir = 1;
function detailHtml(k: EnemyKind): string {
  const i = ENEMY_INFO[k];
  const tune = (kindConsts[k] ?? []).map(([n, o]) =>
    `<div><b>${esc(n)}</b> <span class="src">src/enemies</span><table>${Object.entries(o).map(([a, b]) => `<tr><td>${esc(a)}</td><td class="v">${val(b)}</td></tr>`).join('')}</table></div>`).join('')
    || '<div class="note">個別チューニング定数なし</div>';
  return `<div class="cols"><div><b>${esc(i.role)}</b><ul>${i.behavior.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
    <p>弱点：${esc(i.weakness)}<br>初登場：${esc(i.area)}<br>見た目：${esc(i.look)}</p>
    <a href="/bestiary.html" target="_blank">3Dモデルを見る（敵図鑑）</a></div>${tune}</div>`;
}
const opened = new Set<EnemyKind>();
function renderEnemies() {
  const t = document.getElementById('etable');
  if (!t) return;
  const order = [...ENEMY_ORDER];
  const c = cols.find((x) => x.key === sortKey);
  if (c) order.sort((a, b) => { const x = c.get(a), y = c.get(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sortDir; });
  const cell = (x: (typeof cols)[number], k: EnemyKind) => { const v = x.get(k); return `<td class="${x.der ? 'der' : ''} ${x.text ? '' : 'num'}">${typeof v === 'number' ? fmt(v) : esc(v)}</td>`; };
  t.innerHTML = `<tr>${cols.map((x) => `<th data-k="${x.key}">${x.label}${x.key === sortKey ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr>` +
    order.map((k) => {
      const tt = esc((ENEMY_INFO[k].name + k).toLowerCase());
      return `<tr class="er row" data-k="${k}" data-t="${tt}">${cols.map((x) => cell(x, k)).join('')}</tr>` +
        (opened.has(k) ? `<tr class="detail row" data-t="${tt}"><td colspan="${cols.length}">${detailHtml(k)}</td></tr>` : '');
    }).join('');
  t.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => { const k = th.getAttribute('data-k')!; sortDir = sortKey === k ? -sortDir : 1; sortKey = k; renderEnemies(); applyFilter(); }));
  t.querySelectorAll<HTMLElement>('tr.er').forEach((tr) => tr.addEventListener('click', () => { const k = tr.dataset.k as EnemyKind; if (opened.has(k)) opened.delete(k); else opened.add(k); renderEnemies(); applyFilter(); }));
}

// ---- 画面 ----
const main = document.getElementById('main')!;
const tabBar = document.getElementById('tabs')!;
const q = document.getElementById('q') as HTMLInputElement;
function applyFilter() {
  const s = q.value.trim().toLowerCase();
  main.querySelectorAll<HTMLElement>('tr.row').forEach((r) => r.classList.toggle('hide', !!s && !(r.dataset.t ?? '').includes(s)));
}
function show(name: string) {
  tabBar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.textContent === name));
  main.innerHTML = tabs[name]();
  if (name === '敵') renderEnemies();
  applyFilter();
  try { history.replaceState(null, '', '#' + encodeURIComponent(name)); } catch { /* 無視 */ }
}
for (const n of Object.keys(tabs)) {
  const b = document.createElement('button');
  b.textContent = n;
  b.onclick = () => show(n);
  tabBar.appendChild(b);
}
q.addEventListener('input', applyFilter);
const h = decodeURIComponent(location.hash.slice(1));
show(h in tabs ? h : Object.keys(tabs)[0]);
