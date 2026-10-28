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

export const ENEMY_ORDER: EnemyKind[] = ['drone', 'crawler', 'gunner', 'walker', 'redWalker', 'leech', 'heavy', 'heavyWalker', 'beamer', 'jumper', 'missileDrone', 'bomber', 'redDrone', 'missile', 'boss'];

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
  redWalker: {
    name: '赤ウォーカー', role: 'ハッキング可能',
    behavior: ['ウォーカーと同じく、ゆっくり近づきながら射撃', '吸収アームをつなぐとハッキング開始。8個のコードを入力すると味方になる', '味方の間はほかの敵を撃つ（20秒）'],
    weakness: '背中のバッテリー', area: 'ボルト研究室前', look: '（T3-C で決定）ウォーカーの赤い版',
  },
  beamer: {
    name: 'ビーマー', role: '遠距離・溜めビーム',
    behavior: ['遠くに陣取り、照準線でねらいながら長く溜める', '発射直前に照準を固定して極太ビーム（ここで避ける）', '体力が多い'],
    weakness: '溜め中だけ開く前面のレンズ（撃つと溜めが止まる）', area: 'ボルト研究室前', look: '（T3-A で決定）',
  },
  leech: {
    name: 'リーチ', role: '小型・電力泥棒',
    behavior: ['遠くから吸収アームを伸ばし、プレイヤーの電力を吸う（回避で外れる）', 'こちらの吸収アームをつなぐと全力で逃げる', '吸い切ると盗まれた電力が戻ってくる'],
    weakness: '背中のタンク', area: 'ボルト研究室前', look: '白と青のまるい小さな体に大きな目。前に紫のバネ腕の吸い口、背中にたまった電力が見える透明タンク（ここが弱点）',
  },
  jumper: {
    name: 'ジャンパー', role: '重装・跳躍',
    behavior: ['ジャンプしながらゆっくり近づく', '着地の瞬間に突き（近いと痛い）', '大きな頭の核は着地のときだけ開く。開いている間しか攻撃も吸収も効かない'],
    weakness: '頭の核（開いているときだけ）', area: 'ボルト研究室前', look: '（T3-D で決定）大きな頭の二足歩行',
  },
  missileDrone: {
    name: 'ミサイルドローン', role: '浮遊・ミサイル4連',
    behavior: ['距離を取って浮遊', 'ミサイルを4発まとめて放つ（追いかけてくる）', 'ミサイルは銃で撃つか、吸収アームを当てると一発で消える'],
    weakness: '下のコア', area: 'ボルト研究室前', look: '（T3-E で決定）',
  },
  bomber: {
    name: 'ボンバー', role: '小型・電気爆弾',
    behavior: ['電気の球を山なりに投げてくる', '球は着弾で爆発。中心ほど大ダメージ、端なら少なめ'],
    weakness: '背中の電池', area: 'ボルト研究室前', look: '（T3-F で決定）小さく丸い',
  },
  redDrone: {
    name: '赤ドローン', role: 'ハッキング可能',
    behavior: ['ドローンと同じく周回して射撃', '吸収アームをつなぐとハッキング開始。コードを入力すると味方になる'],
    weakness: '下のコア', area: 'ボルト研究室前', look: '（T3-C で決定）ドローンの赤い版',
  },
  boss: {
    name: 'ジェネレーター', role: 'ボス（サージ収容所）',
    behavior: ['弾幕・雑魚召喚', '第2形態でレーザー／突進', 'コアが周期的に露出'],
    weakness: 'コア（周期的に露出）', area: 'サージ収容所', look: '回転する装甲板に守られたコア',
  },
};
