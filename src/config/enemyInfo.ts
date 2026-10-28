import type { EnemyKind } from './balance';

/** 敵の表示名・説明（HUD・敵図鑑が参照）。数値は balance.ts の ENEMIES */
export interface EnemyInfo {
  name: string;
  /** 一言の役割 */
  role: string;
  /** 行動の説明（箇条書き） */
  behavior: string[];
  weakness: string;
  /** 初登場エリア */
  area: string;
  /** 見た目のメモ */
  look: string;
}

export const ENEMY_ORDER: EnemyKind[] = ['drone', 'crawler', 'gunner', 'walker', 'heavy', 'heavyWalker', 'missile', 'boss'];

/** 図鑑番号（ENEMY_ORDER の順に 1 から）。マップ・図鑑・データ一覧で共通 */
export function enemyNo(kind: EnemyKind): number { return ENEMY_ORDER.indexOf(kind) + 1; }
/** 'No.01' 形式 */
export function enemyNoLabel(kind: EnemyKind): string { return `No.${String(enemyNo(kind)).padStart(2, '0')}`; }
/** マップの印の色（種類ごと） */
export const ENEMY_COLOR: Record<EnemyKind, string> = {
  drone: '#3aa0ff', crawler: '#f08a24', gunner: '#c79a00', walker: '#2fa86a',
  heavy: '#d23c3c', heavyWalker: '#8a3cd2', missile: '#444c5c', boss: '#000000',
};

export const ENEMY_INFO: Record<EnemyKind, EnemyInfo> = {
  drone: {
    name: 'ドローン', role: '浮遊射撃',
    behavior: ['プレイヤーの頭上あたりを周回', '距離を取って単発射撃（予備動作0.35秒）'],
    weakness: '下のコア', area: 'ボルト研究室前', look: '白と青の球体＋回転リング',
  },
  crawler: {
    name: 'クローラー', role: '近接・素早い',
    behavior: ['地上を走って接近し体当たり', '撃たれると横へ回避することがある', 'プレイヤーが吸収中は攻撃が激しくなる'],
    weakness: '背中の電池', area: 'ボルト研究室前', look: '4本脚の小型',
  },
  gunner: {
    name: 'ガンナー', role: '中距離・3連射',
    behavior: ['距離を保って3連射', '撃った後は物陰へ移動'],
    weakness: '頭のセンサー', area: 'ボルト研究室前', look: '2本脚＋砲腕',
  },
  walker: {
    name: 'ウォーカー', role: '遠距離・のろのろ前進',
    behavior: ['ゆっくりまっすぐ近づいてくる（何も考えない）', '遠くから射撃し続ける'],
    weakness: '背中のバッテリー', area: 'ボルト研究室前', look: '一輪で転がる丸い砲台。右肩に長い砲身',
  },
  heavy: {
    name: 'ヘビー', role: '重量・近接',
    behavior: ['突進（壁に当たるとスタン）', '腕の叩きつけ'],
    weakness: '背中のバッテリー（×3）', area: 'ボルト研究室前', look: '大きな丸い体と太い腕',
  },
  heavyWalker: {
    name: 'ヘビーウォーカー', role: '重量・範囲電撃',
    behavior: ['突進', '足で地面を叩き、電流で周囲に範囲ダメージ', 'プレイヤーが吸収中は攻撃が激しくなる'],
    weakness: '背中の発電コア', area: 'ボルト研究室前', look: '平たい甲羅の4本脚の重機。足裏と背中のコイルが青く光る',
  },
  missile: {
    name: 'ミサイル溜めロボット', role: '強敵・召喚＋溜めミサイル',
    behavior: ['雑魚敵を周りに召喚して守らせる', 'その間にミサイルを溜め、溜まったら一斉発射', '溜まる前に倒すか、溜めを妨害する', 'ミサイルは撃ち落とせる'],
    weakness: '背中・ポッド下のパワーセル（回り込んで狙う）', area: 'ボルト研究室前', look: '白い胴体＋青いキャタピラ、背中に6連ミサイルポッド。溜まるとミサイルが顔を出しゲージが伸びる',
  },
  boss: {
    name: 'ジェネレーター', role: 'ボス（サージ収容所）',
    behavior: ['弾幕・雑魚召喚', '第2形態でレーザー／突進', 'コアが周期的に露出'],
    weakness: 'コア（周期的に露出）', area: 'サージ収容所', look: '回転する装甲板に守られたコア',
  },
};
