/**
 * トロッコ面のステージデータ。ここを書き換えるだけで配置を調整できる。
 *
 * 座標はすべて x（右が進行方向）。カートは x = 0 から自動で右へ走る（速度は constants.ts の MC.speed）。
 * 高さ y はレール面が基準。立った姿勢の頭が 1.8、しゃがむと 1.0、ジャンプの頂点は約 3.1（平地のとき）。
 * 敵・回収物・機材の y は「その x にあるレール面からの高さ」（段差や坂の上でもそのまま書ける）。
 * up:true を付けると「上段レール（upper）の面からの高さ」。
 *
 * 部品:
 *   gap(x0, x1)                 レールの切れ目（落ちる）。ジャンプで越える。短いレールは「ギャップとギャップの間」で作る
 *   step(x, y)                  x からレールの高さが y（絶対値）になる。上がる段差は『壁』になり、ジャンプで乗り上げないと激突（即失敗）。
 *                               下がる段差は落ちるだけ
 *   ramp(x0, x1, to)            x0〜x1 で高さが to へ変わる坂。上り坂は遅く、下り坂は速い（勢いはしばらく残る）
 *   upper(x0, x1, y)            分岐の上段レール（寄り道）。下段（ふつうの道）の上に重ねる。下段から高いジャンプで乗り上げる。
 *                               終わりの先は下段へ落ちて合流する。下をくぐるのは自由（下段の高さ＋1.8＋余裕より上に置くこと）
 *   wall(x, w, h, kind)         レール上の障害物（中心 x・幅 w・高さ h）。ジャンプで越える。当たると激突（即失敗）
 *   ceil(x0, x1, bottom, kind)  天井から下がる研究機材。bottom が低いほど下まで垂れる。
 *                               1.0 < bottom < 1.8 ならしゃがめば通れて、立っていると当たる（ダメージ）
 *   drone(x, y, opt)            ドローン。弾1発で倒せる（メタルを少し落とす）。vx は左向き速度（負）、amp/w は上下の揺れの幅と速さ
 *                               opt.trigger を指定すると「カートがその x を越えた瞬間に画面右端から飛び込んでくる奇襲」になる
 *   gunner(x)                   ガンナー。装甲で弾を弾くので撃っても倒せない。ジャンプで跳び越える。低い弾を撃つ（弾は撃ち落とせる）
 *   metal(x, y)                 メタル（ふつうの回収物。道なりにたくさん）
 *   gear(x, y, how)             歯車（レア。必ず『道から外れた寄り道』にだけ置く。how は全体マップに出す取り方の説明）
 *   check(x)                    チェックポイント（失敗したらここから。下段レール上に置くこと）
 *   goal(x)                     ゴール（ドレイン装置の部屋の駅）
 *
 * 作り方のコツ（test でも検証している）:
 *   - ギャップの幅は 6 が標準。7.0 以上は「ぎりぎり」（最大は MAX_GAP = 7.67。余裕が小さいほどシビア）
 *   - 壁・ギャップ・ガンナーの上（前後3〜5）に天井機材を置かない。上段レールの下でジャンプが要る配置もしない
 *   - 連続ジャンプの短いレールは 3 以上（これ以下だと着地してすぐ跳ぶ余裕が無い）
 *   - 歯車は『ふつうに走っただけでは取れない』場所に。取れることは test の「歯車ボット」が確かめる
 */
export type CeilKind = 'monitor' | 'pipe' | 'tank' | 'cable' | 'rack';
export type WallKind = 'crate' | 'bulkhead' | 'wreck';

export type GapItem = { t: 'gap'; x0: number; x1: number };
export type StepItem = { t: 'step'; x: number; y: number };
export type RampItem = { t: 'ramp'; x0: number; x1: number; to: number };
export type UpperItem = { t: 'upper'; x0: number; x1: number; y: number };
export type WallItem = { t: 'wall'; x: number; w: number; h: number; kind: WallKind };
export type CeilItem = { t: 'ceil'; x0: number; x1: number; bottom: number; kind: CeilKind };
export type DroneItem = { t: 'drone'; x: number; y: number; vx: number; trigger?: number; amp: number; w: number; up?: boolean };
export type GunnerItem = { t: 'gunner'; x: number };
export type MetalItem = { t: 'metal'; x: number; y: number; up?: boolean };
export type GearItem = { t: 'gear'; x: number; y: number; how: string; up?: boolean };
export type CheckItem = { t: 'check'; x: number };
export type GoalItem = { t: 'goal'; x: number };
export type StageItem = GapItem | StepItem | RampItem | UpperItem | WallItem | CeilItem | DroneItem | GunnerItem | MetalItem | GearItem | CheckItem | GoalItem;

const gap = (x0: number, x1: number): StageItem => ({ t: 'gap', x0, x1 });
const step = (x: number, y: number): StageItem => ({ t: 'step', x, y });
const ramp = (x0: number, x1: number, to: number): StageItem => ({ t: 'ramp', x0, x1, to });
const upper = (x0: number, x1: number, y: number): StageItem => ({ t: 'upper', x0, x1, y });
const wall = (x: number, w: number, h: number, kind: WallKind = 'crate'): StageItem => ({ t: 'wall', x, w, h, kind });
const ceil = (x0: number, x1: number, bottom: number, kind: CeilKind): StageItem => ({ t: 'ceil', x0, x1, bottom, kind });
const drone = (x: number, y: number, o: { vx?: number; trigger?: number; amp?: number; w?: number; up?: boolean } = {}): StageItem =>
  ({ t: 'drone', x, y, vx: o.vx ?? -1.5, trigger: o.trigger, amp: o.amp ?? 0.18, w: o.w ?? 2.2, up: o.up });
const gunner = (x: number): StageItem => ({ t: 'gunner', x });
const metal = (x: number, y: number, up = false): StageItem => ({ t: 'metal', x, y, up });
const gear = (x: number, y: number, how: string, up = false): StageItem => ({ t: 'gear', x, y, how, up });
const check = (x: number): StageItem => ({ t: 'check', x });
const goal = (x: number): StageItem => ({ t: 'goal', x });
/** メタルを横一列に並べる */
const metalRow = (x0: number, x1: number, y: number, n: number, up = false): StageItem[] =>
  Array.from({ length: n }, (_, i) => metal(n === 1 ? x0 : x0 + ((x1 - x0) * i) / (n - 1), y, up));
/** ジャンプの山なりにメタルを並べる（中央が頂点 peak） */
const metalArc = (xc: number, half: number, peak: number, n: number): StageItem[] =>
  Array.from({ length: n }, (_, i) => {
    const u = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    return metal(xc + u * half, 0.9 + (peak - 0.9) * (1 - u * u));
  });

/** 見出し（ゲームには影響しない。全体マップ画像のラベル用） */
export interface Beat { x0: number; x1: number; label: string; note: string }
export const BEATS: Beat[] = [
  { x0: 0, x1: 50, label: '1 ウォームアップ', note: 'ドローン→最初の壁' },
  { x0: 50, x1: 100, label: '2 しゃがみ＋ドローン', note: '機材/ドローン2体/壁→しゃがみ' },
  { x0: 100, x1: 178, label: '3 長いトンネル→奇襲', note: '隙間で歯車/出口でドローン3体' },
  { x0: 178, x1: 264, label: '4 段差・壁・坂', note: '段差/壁→壁/高い段差/下り坂→大ジャンプ' },
  { x0: 264, x1: 340, label: '5 ガンナー＋分岐', note: '壁→ガンナー/上段ルート(歯車)/ガンナー→低天井' },
  { x0: 340, x1: 400, label: '6 連続ジャンプ', note: '4連続ギャップ' },
  { x0: 400, x1: 456, label: '7 ぎりぎり＋分岐', note: 'ぎりぎり→すぐ次/上段ルート(歯車2)' },
  { x0: 456, x1: 488, label: '8 フィナーレ', note: 'ドローン+ギャップ/最後の壁' },
];

export const STAGE_ITEMS: StageItem[] = [
  // ============ 1 ウォームアップ（0〜50）
  ...metalRow(10, 24, 1.0, 5),
  drone(28, 1.4, { vx: -1.5 }),
  wall(38, 1.0, 1.2, 'crate'),
  ...metalArc(38, 2.2, 2.8, 5),
  check(46),

  // ============ 2 しゃがみ＋ドローン（50〜100）
  ceil(52, 60, 1.3, 'monitor'),
  ...metalRow(54, 58, 0.6, 3),
  wall(66, 1.0, 1.1, 'crate'), // しゃがむ→すぐ壁
  drone(71, 1.2, { vx: -2 }), // 2体
  drone(74, 2.6, { vx: -2, amp: 0.8, w: 3 }),
  wall(76, 1.0, 1.3, 'crate'), // 壁→すぐしゃがむ
  ...metalArc(76, 2.2, 2.8, 5),
  ceil(83, 93, 1.3, 'pipe'),
  metal(88, 0.6),
  check(98),

  // ============ 3 長いトンネル→奇襲（100〜178）
  ceil(102, 114, 1.3, 'rack'),
  ...metalRow(104, 112, 0.6, 3),
  // 機材の隙間（114〜122.6）：ふつうは立つだけで通れる。ここでジャンプすると歯車（遅れると次の機材に頭をぶつける）
  gear(118.3, 2.9, '機材の隙間でジャンプ（早すぎ・遅すぎは機材に激突）'),
  ...metalArc(118.3, 3.0, 2.0, 5),
  ceil(122.6, 135, 1.3, 'monitor'),
  ceil(135, 147, 1.35, 'pipe'),
  ceil(147, 158, 1.25, 'tank'), // ここまでで 35.4 の長いしゃがみ
  ...metalRow(126, 154, 0.6, 7),
  drone(0, 1.2, { vx: -5, trigger: 159 }), // 出口で奇襲3体
  drone(0, 1.4, { vx: -6, trigger: 164 }),
  drone(0, 2.4, { vx: -5, trigger: 170, amp: 0.6, w: 3 }),
  check(176),

  // ============ 4 段差・壁・坂（178〜264）
  step(184, 1.0), // 高さ1.0の壁：ジャンプで乗り上げる
  ...metalArc(183, 2.4, 3.0, 5),
  ...metalRow(188, 194, 1.0, 3),
  step(198, 0), // 落ちる
  wall(206, 1.0, 1.6, 'bulkhead'), // 背の高い壁
  gear(202.8, 3.0, '壁の手前で早めに跳ぶ（ふつうは壁の直前で跳ぶので届かない高さ）'),
  ...metalArc(206, 2.4, 3.0, 5),
  wall(213, 1.0, 1.2, 'crate'), // 壁→すぐ壁
  drone(222, 2.0, { vx: -2, amp: 0.7, w: 3 }),
  drone(244, 1.8, { vx: -1.5, amp: 0.7, w: 3 }),
  step(228, 2.0), // 高さ2.0の大きな段差
  ...metalRow(231, 238, 1.0, 3),
  ramp(240, 250, 0), // 下り坂。勢いがつく
  ...metalRow(242, 249, 1.0, 3),
  gap(251, 259.2), // 下り坂の勢いで跳ぶ大ジャンプ（平地の最大7.67を超える）
  check(264),

  // ============ 5 ガンナー＋分岐（264〜340）
  wall(272, 1.0, 1.4, 'bulkhead'), // 壁→ガンナー
  gunner(280),
  metal(280, 3.0),
  drone(292, 1.5, { vx: -1.5 }), // 下段は小さなドローン3体
  drone(296, 1.0, { vx: -1.5, amp: 0.4, w: 3 }),
  drone(300, 1.8, { vx: -1.5, amp: 0.5, w: 2.4 }),
  // 上段ルート（寄り道）：下段から最大ジャンプ級で乗り上げる。歯車とメタルが密、ドローンも1体
  upper(298, 316, 2.7),
  gear(307, 0.9, '上段レールへ高いジャンプで乗り上げる（下段のジャンプ地点は x≈293）', true),
  ...metalRow(300, 314, 0.9, 7, true),
  drone(312, 1.2, { vx: 0, amp: 0.3, up: true }),
  gunner(324),
  ceil(332, 340, 1.3, 'rack'), // ガンナー→すぐしゃがむ
  check(346),

  // ============ 6 連続ジャンプ（340〜400）
  gap(352, 358),
  gap(362.5, 368.5),
  gap(372, 378),
  gap(381, 387),
  ...metalArc(355, 2.0, 2.7, 3),
  metal(360.2, 1.0),
  ...metalArc(365.5, 2.0, 2.7, 3),
  metal(370.2, 1.0),
  ...metalArc(375, 2.0, 2.7, 3),
  metal(379.5, 1.0),
  ...metalArc(384, 2.0, 2.7, 3),
  drone(392, 2.0, { vx: -1.5, amp: 0.8, w: 2.8 }),
  drone(396, 1.2, { vx: -2 }),
  check(394),

  // ============ 7 ぎりぎり＋分岐（400〜470）
  gap(404, 411.1), // ぎりぎり（7.1）→すぐ次
  metal(407.5, 3.3),
  gap(414.6, 420.6),
  metal(412.8, 1.0),
  ...metalArc(417.5, 2.0, 2.7, 3),
  check(426),
  upper(432, 448, 3.0), // 上段ルート2（高さ3.0）。下段はドローン（上下に揺れる）を撃ちながら進む
  gear(436, 1.0, '上段レールへ最大級のジャンプで乗り上げる（ぎりぎり・下段のジャンプ地点は x≈427）', true),
  gear(445, 1.0, '上段の先端（上段を走りきる）', true),
  ...metalRow(434, 446, 1.0, 5, true),
  drone(436, 1.4, { vx: -1.5, amp: 0.6, w: 3 }),
  drone(442, 1.6, { vx: -1.5, amp: 0.4, w: 2.6 }),
  ...metalRow(430, 452, 0.9, 6),

  // ============ 8 フィナーレ（462〜）
  gap(458, 464), // ドローン＋ギャップ
  drone(461, 3.2, { vx: 0, amp: 0.3 }),
  ...metalArc(461, 2.2, 2.7, 3),
  wall(474, 1.0, 1.4, 'crate'), // 最後の壁
  ...metalArc(474, 2.2, 2.8, 5),
  goal(488),
];

// ---------------------------------------------------------------- 導出データ（ここは触らなくてよい）
/** 傾きのあるレール片。y0 が左端、y1 が右端の高さ */
export interface Rail {
  x0: number; x1: number; y0: number; y1: number;
  /** 左端が『壁の面』（手前のレールと高さがつながっていない） */
  face?: boolean;
  /** 上段（分岐の寄り道）。厚みのある板 */
  upper?: boolean;
  thick?: number;
}
export interface Piece { x0: number; x1: number; y0: number; y1: number }
export interface ResolvedMetal { x: number; y: number }
export interface ResolvedGear { x: number; y: number; how: string }
export interface ResolvedDrone { x: number; y: number; vx: number; trigger?: number; amp: number; w: number }
export interface ResolvedGunner { x: number; y: number }
export interface ResolvedCeil { x0: number; x1: number; /** 天井機材の下端（絶対） */ bottom: number; /** レール面からの高さ（書いた値） */ rel: number; kind: CeilKind }
export interface ResolvedWall { x0: number; x1: number; x: number; base: number; top: number; h: number; kind: WallKind }
export interface Stage {
  items: StageItem[];
  /** ギャップで切る前の高さの折れ線（下段） */
  pieces: Piece[];
  /** 下段と上段をあわせたレールの一覧 */
  rails: Rail[];
  gaps: GapItem[];
  ceils: ResolvedCeil[];
  walls: ResolvedWall[];
  drones: ResolvedDrone[];
  gunners: ResolvedGunner[];
  metals: ResolvedMetal[];
  gears: ResolvedGear[];
  checks: number[];
  goalX: number;
  length: number;
  /** いちばん低いレール面 */
  minY: number;
  maxY: number;
}

/** レールの始まり（カートの後ろに少し敷いておく） */
export const RAIL_START = -12;
/** ゴールの先に伸ばすレールの長さ */
export const RAIL_TAIL = 16;
/** 上段レールの板の厚み */
export const UPPER_THICK = 0.4;

function pick<T extends StageItem['t']>(items: StageItem[], t: T): Extract<StageItem, { t: T }>[] {
  return items.filter((i): i is Extract<StageItem, { t: T }> => i.t === t);
}

const lerpPiece = (p: { x0: number; x1: number; y0: number; y1: number }, x: number): number => {
  if (p.x1 <= p.x0) return p.y1;
  const k = Math.max(0, Math.min(1, (x - p.x0) / (p.x1 - p.x0)));
  return p.y0 + (p.y1 - p.y0) * k;
};

/** ギャップを無視した、x のレール面の高さ（敵・回収物・機材の基準） */
export function profileAt(pieces: Piece[], x: number): number {
  let best = pieces[0].y0;
  for (const p of pieces) { if (x >= p.x0 - 1e-9 && x <= p.x1 + 1e-9) best = lerpPiece(p, x); else if (x > p.x1) best = p.y1; }
  return best;
}

export function buildStage(items: StageItem[] = STAGE_ITEMS): Stage {
  const gaps = pick(items, 'gap').sort((a, b) => a.x0 - b.x0);
  const goalItem = pick(items, 'goal')[0];
  const goalX = goalItem ? goalItem.x : 0;
  const end = goalX + RAIL_TAIL;
  // ---- 高さの折れ線（step / ramp）
  const prof = [...pick(items, 'step').map((s) => ({ x: s.x, s })), ...pick(items, 'ramp').map((r) => ({ x: r.x0, r }))].sort((a, b) => a.x - b.x);
  const pieces: Piece[] = [];
  let cur = RAIL_START, h = 0;
  for (const e of prof) {
    if ('s' in e) { pieces.push({ x0: cur, x1: e.x, y0: h, y1: h }); cur = e.x; h = e.s.y; }
    else { pieces.push({ x0: cur, x1: e.r.x0, y0: h, y1: h }); pieces.push({ x0: e.r.x0, x1: e.r.x1, y0: h, y1: e.r.to }); cur = e.r.x1; h = e.r.to; }
  }
  pieces.push({ x0: cur, x1: end, y0: h, y1: h });
  const live = pieces.filter((p) => p.x1 > p.x0);
  // ---- ギャップで切る
  let main: Rail[] = live.map((p) => ({ ...p }));
  for (const g of gaps) {
    const next: Rail[] = [];
    for (const r of main) {
      if (g.x1 <= r.x0 || g.x0 >= r.x1) { next.push(r); continue; }
      if (g.x0 > r.x0) next.push({ x0: r.x0, x1: g.x0, y0: r.y0, y1: lerpPiece(r, g.x0) });
      if (g.x1 < r.x1) next.push({ x0: g.x1, x1: r.x1, y0: lerpPiece(r, g.x1), y1: r.y1 });
    }
    main = next;
  }
  main = main.map((r, i) => ({ ...r, face: !(i > 0 && main[i - 1].x1 === r.x0 && Math.abs(main[i - 1].y1 - r.y0) < 0.01) && i > 0 }));
  // ---- 上段レール（分岐）
  const ups: Rail[] = pick(items, 'upper').map((u) => ({ x0: u.x0, x1: u.x1, y0: u.y, y1: u.y, upper: true, thick: UPPER_THICK }));
  const rails = [...main, ...ups].sort((a, b) => a.x0 - b.x0);
  const at = (x: number) => profileAt(live, x);
  const upAt = (x: number) => ups.find((u) => x >= u.x0 && x <= u.x1)?.y0 ?? at(x);
  const base = (x: number, up?: boolean) => (up ? upAt(x) : at(x));
  const ys = live.flatMap((p) => [p.y0, p.y1]);
  return {
    items, pieces: live, rails, gaps,
    ceils: pick(items, 'ceil').map((c) => { const b = at((c.x0 + c.x1) / 2); return { x0: c.x0, x1: c.x1, bottom: b + c.bottom, rel: c.bottom, kind: c.kind }; }),
    walls: pick(items, 'wall').map((w) => { const b = at(w.x); return { x0: w.x - w.w / 2, x1: w.x + w.w / 2, x: w.x, base: b, top: b + w.h, h: w.h, kind: w.kind }; }),
    drones: pick(items, 'drone').map((d) => ({ x: d.x, y: d.y + base(d.trigger ?? d.x, d.up), vx: d.vx, trigger: d.trigger, amp: d.amp, w: d.w })),
    gunners: pick(items, 'gunner').map((g) => ({ x: g.x, y: at(g.x) })),
    metals: pick(items, 'metal').map((m) => ({ x: m.x, y: m.y + base(m.x, m.up) })),
    gears: pick(items, 'gear').map((g) => ({ x: g.x, y: g.y + base(g.x, g.up), how: g.how })),
    checks: pick(items, 'check').map((c) => c.x).sort((a, b) => a - b),
    goalX,
    length: goalX,
    minY: Math.min(...ys), maxY: Math.max(...ys, ...ups.map((u) => u.y0)),
  };
}

export const STAGE: Stage = buildStage();
