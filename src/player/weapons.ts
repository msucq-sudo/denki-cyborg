// 武器モデル定義。武器は「見た目を作る関数＋持ち方の3点（右手グリップ・左手の支え・銃口）」だけを持つ。
// 座標は武器ローカル（原点＝右手で握る位置付近、銃口方向＝-Z、上＝+Y）。
// ポーズ側（pose.ts）は gripR / gripL に両手のIKを合わせ、muzzle の位置を発射位置に使う。
// 武器を増やすときは WeaponDef を1つ書いて WEAPONS に登録するだけでよい。
import type * as THREE from 'three';

export type PartKey = 'white' | 'grey' | 'dark' | 'dark2' | 'black' | 'yellow' | 'silver' | 'cyan';
type V3 = [number, number, number];

/** 武器モデルを組むための道具（visual.ts が渡す。マテリアル共有・マージ・アウトラインは向こうでやる） */
export interface WeaponBuilder {
  add(key: PartKey, geo: THREE.BufferGeometry, pos: V3, rot?: V3, scale?: V3): void;
  box(w: number, h: number, d: number): THREE.BufferGeometry;
  /** 角を面取りした箱 */
  cbox(w: number, h: number, d: number, chamfer: number, bevel?: number): THREE.BufferGeometry;
  cyl(rTop: number, rBottom: number, h: number, seg?: number): THREE.BufferGeometry;
  ball(r: number): THREE.BufferGeometry;
  torus(r: number, tube: number): THREE.BufferGeometry;
}

export interface WeaponDef {
  id: string;
  /** 右手（グリップを握る拳の中心） */
  gripR: V3;
  /** 左手（支える拳の中心）。左腕のバネは届かなければ自動で伸びる */
  gripL: V3;
  /** 銃口（弾の発射位置・チャージ球の位置） */
  muzzle: V3;
  /** 構えたときの銃の位置の補正（CHARACTER.gun.aimPos に加算） */
  aimShift?: V3;
  build(b: WeaponBuilder): void;
}

/** ピストル（電気銃）。白い角ばった装甲＋黒グリップ＋黄色ライン、銃口はシアンに発光 */
export const PISTOL: WeaponDef = {
  id: 'pistol',
  gripR: [0, -0.065, 0.045],
  gripL: [-0.045, -0.1, -0.025],
  muzzle: [0, 0.03, -0.31],
  build(b) {
    b.add('white', b.cbox(0.058, 0.07, 0.3, 0.015, 0.006), [0, 0.04, -0.07]);            // スライド
    b.add('grey', b.cbox(0.05, 0.045, 0.24, 0.012, 0.005), [0, -0.005, -0.04]);           // フレーム
    b.add('dark', b.box(0.034, 0.034, 0.07), [0, 0.03, -0.255]);                          // 銃身
    b.add('yellow', b.cbox(0.062, 0.014, 0.12, 0.006, 0.003), [0, 0.078, -0.07]);         // 黄色ライン
    b.add('black', b.cbox(0.05, 0.125, 0.06, 0.012, 0.005), [0, -0.075, 0.045], [0.2, 0, 0]); // グリップ
    b.add('dark', b.box(0.012, 0.028, 0.07), [0, -0.045, -0.06]);                         // トリガーガード
    b.add('dark', b.box(0.02, 0.016, 0.02), [0, 0.085, 0.07]);                            // リアサイト
    for (const s of [1, -1]) b.add('cyan', b.box(0.004, 0.014, 0.13), [s * 0.0305, 0.04, -0.09]); // 側面の電気ライン
    b.add('cyan', b.torus(0.026, 0.008), [0, 0.03, -0.294]);                              // 銃口リング
  },
};

/** 確認用のダミー長物（ライフル型）。ゲームには出さない。両手持ちが長物でも破綻しないかのテスト用 */
export const RIFLE_DUMMY: WeaponDef = {
  id: 'rifle_dummy',
  gripR: [0, -0.075, 0.04],
  gripL: [0, -0.06, -0.36],
  muzzle: [0, 0.035, -0.98],
  build(b) {
    b.add('white', b.cbox(0.07, 0.1, 0.42, 0.02, 0.006), [0, 0.03, -0.12]);                // レシーバー
    b.add('white', b.cbox(0.06, 0.11, 0.3, 0.02, 0.006), [0, 0.02, 0.3]);                  // ストック
    b.add('black', b.cbox(0.07, 0.12, 0.04, 0.01, 0.004), [0, 0.01, 0.46]);                // バットプレート
    b.add('grey', b.cbox(0.06, 0.07, 0.34, 0.015, 0.005), [0, 0.0, -0.5]);                 // フォアエンド
    b.add('dark', b.cyl(0.018, 0.018, 0.5, 8), [0, 0.035, -0.74], [Math.PI / 2, 0, 0]);    // 長い銃身
    b.add('black', b.cbox(0.05, 0.13, 0.06, 0.012, 0.005), [0, -0.085, 0.04], [0.2, 0, 0]); // グリップ
    b.add('black', b.cbox(0.045, 0.14, 0.07, 0.01, 0.004), [0, -0.12, -0.13], [-0.15, 0, 0]); // マガジン
    b.add('dark', b.cbox(0.05, 0.05, 0.2, 0.01, 0.004), [0, 0.1, -0.1]);                   // スコープ
    b.add('yellow', b.cbox(0.074, 0.014, 0.16, 0.006, 0.003), [0, 0.086, -0.14]);          // 黄色ライン
    for (const s of [1, -1]) b.add('cyan', b.box(0.004, 0.016, 0.22), [s * 0.0365, 0.035, -0.14]); // 側面の電気ライン
    b.add('cyan', b.torus(0.03, 0.008), [0, 0.035, -0.96]);                                // 銃口リング
  },
};

export const WEAPONS: Record<string, WeaponDef> = { pistol: PISTOL, rifle_dummy: RIFLE_DUMMY };
export const DEFAULT_WEAPON = PISTOL;
