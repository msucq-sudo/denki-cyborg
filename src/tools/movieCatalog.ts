// ムービー一覧（movies.html）のデータ。カメラの割り・長さは各ムービーの台本から読む（成功・失敗の演出だけは台本が関数の中なので、ここに写してある）。
import { CUT } from '../level/camp2/cutscene';
import { ENDING_SHOTS } from '../level/camp2/ending';
import { SHOTS as DRAIN_BOSS_SHOTS } from '../level/drainBoss/cutscene';
import { movieUrl, type MovieId } from '../cinematic/movieMode';
import { SPECIAL } from '../config/balance';

export interface MovieInfo {
  id: MovieId;
  title: string;
  desc: string;
  shots: { name: string; d: number }[];
  /** 最後のショットが「終わり次第」で長さが上限のとき true（合計は最長） */
  upTo?: boolean;
  url: string;
}

export const MOVIE_LIST: MovieInfo[] = [
  {
    id: 'success', title: 'サージへの道：突破成功',
    desc: '判定地点を300km/h以上で越え、収容所の柵を突き破って壁に激突する。',
    shots: [
      { name: '前方斜め', d: 2.0 }, { name: '道ばた', d: 1.8 }, { name: '車内', d: 1.6 },
      { name: '後ろの引き', d: 2.0 }, { name: '正面の顔', d: 1.5 }, { name: '真横', d: 14 },
    ],
    upTo: true, url: movieUrl('success'),
  },
  {
    id: 'fail', title: 'サージへの道：失敗（ヘビーに止められる）',
    desc: '速度が足りず、現れたヘビー3体に車を受け止められる。',
    shots: [
      { name: '車内・ヘビー出現', d: 2.6 }, { name: '顔・身を乗り出す', d: 1.6 }, { name: '主人公の視点', d: 2.2 },
      { name: '俯瞰', d: 1.8 }, { name: '真横・衝突', d: 9 },
    ],
    upTo: true, url: movieUrl('fail'),
  },
  {
    id: 'drainSuccess', title: 'ドレイン装置への道：突入成功',
    desc: '判定地点を300km/h以上で越え、発電所の上のドレイン装置へ坂を駆け上がり、扉を突き破って中へ入る。',
    shots: [
      { name: '斜め後ろ・走り去る', d: 2.0 }, { name: '車内・後部座席から', d: 1.8 }, { name: '後ろ斜め上・坂を登る', d: 1.85 },
      { name: '真横・坂を登る', d: 1.75 }, { name: 'ライアンの顔・身を乗り出す', d: 1.8 }, { name: '後ろ上から', d: 1.2 },
      { name: '真横・スロー→扉を貫通', d: 4.5 },
    ],
    url: movieUrl('drainSuccess'),
  },
  {
    id: 'drainFail', title: 'ドレイン装置への道：失敗（扉ではね返る）',
    desc: '200〜299km/h。坂は登り切るが、扉を破れずにはね返される。ライアンが頭をかく。',
    shots: [
      { name: '斜め後ろ・走り去る', d: 2.0 }, { name: '車内・後部座席から', d: 1.8 }, { name: '後ろ斜め上・坂を登る', d: 1.85 },
      { name: '真横・坂を登る', d: 1.75 }, { name: 'ライアンの顔・身を乗り出す', d: 1.8 }, { name: '後ろ上から', d: 1.2 },
      { name: '真横・スロー→扉ではね返る', d: 4.5 }, { name: '斜め・頭をかく', d: 3.05 },
    ],
    url: movieUrl('drainFail'),
  },
  {
    id: 'drainStall', title: 'ドレイン装置への道：失敗（坂で失速）',
    desc: '200km/h未満。坂の途中で失速してずり落ち、発電所の壁に激突する。',
    shots: [
      { name: '斜め後ろ・走り去る', d: 1.6 }, { name: '車内・後部座席から', d: 1.3 }, { name: '後ろ斜め上・坂を登る', d: 1.8 },
      { name: '真横・失速して空転', d: 3.7 }, { name: 'ずり落ちて壁に激突', d: 3.5 }, { name: '斜め・頭をかく', d: 2.5 },
    ],
    url: movieUrl('drainStall'),
  },
  {
    id: 'intro', title: '収容所2階：扉を調べる（ジェネレーター登場）',
    desc: '檻の扉の錠前をいじっていると、背後にジェネレーターが降りてくる。振り向いて銃を構える。',
    shots: [
      { name: '真横・扉をいじる', d: CUT.side }, { name: '背後・降下', d: CUT.descend },
      { name: '左斜め後ろ・振り向く', d: CUT.turn }, { name: '首の後ろ・構える', d: CUT.aim },
    ],
    url: movieUrl('intro'),
  },
  {
    id: 'ending', title: '収容所2階：ジェネレーター撃破〜脱出',
    desc: '溜め撃ちでジェネレーターを倒し、檻を開けて住民を逃がす。天井に穴をあけ、ジェットパックで研究所へ飛び去る。',
    shots: ENDING_SHOTS.map((s) => ({ name: s.name, d: s.d })),
    url: movieUrl('ending'),
  },
  {
    id: 'drainBoss', title: 'ドレイン装置の部屋：自動ドア〜ボス登場（導入）',
    desc: '通路の先の自動ドアが開き、ライアンがモニターの壁とドレイン装置の部屋へ入る。銃を構えて溜めていると天井がひび割れ、ボス「ドレインガーディアン」がドスンと降ってくる。重い2歩でせまり、戦闘開始。',
    shots: DRAIN_BOSS_SHOTS.map((s) => ({ name: s.name, d: s.d })),
    url: movieUrl('drainBoss'),
  },
  {
    id: 'special', title: '必殺技：電気のかめはめ波',
    desc: 'ゲージ満タンで V（パッドは L スティック＋R スティック同時押し込み）。いちばんHPの高い敵を撃ち抜き、ビームに触れた敵も巻き込む。構え → 溜め（スロー）→ 発射 → 照射。',
    shots: [
      { name: '正面やや右・構え', d: SPECIAL.pose }, { name: '右へ回り込む・溜め（スロー）', d: SPECIAL.charge },
      { name: '真横（右側）・発射', d: SPECIAL.fire + SPECIAL.fireHold }, { name: '通常カメラ・照射', d: SPECIAL.beam },
    ],
    url: movieUrl('special'),
  },
];

export const movieTotal = (m: MovieInfo): number => m.shots.reduce((a, s) => a + s.d, 0);
export const fmtSec = (t: number): string => {
  const s = Math.round(t);
  return s >= 60 ? `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒` : `${s}秒`;
};
