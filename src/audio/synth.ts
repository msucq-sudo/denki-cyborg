/**
 * WebAudio による合成の下回り。音声ファイルは使わない。
 * すべて AudioContext の時刻（ctx.currentTime 基準）で予約する。
 */

export interface Eng {
  ctx: AudioContext;
  /** SE・継続音の出力先（マスターゲイン） */
  master: AudioNode;
  /** 共有ノイズバッファ（約2秒の白色ノイズ） */
  noise: AudioBuffer;
}

export interface FilterOpts {
  type: BiquadFilterType;
  f: number;
  /** 指定すると dur の間に f → f2 へ掃引する */
  f2?: number;
  q?: number;
}

function applyFilter(x: Eng, f: FilterOpts, start: number, dur: number): BiquadFilterNode {
  const node = x.ctx.createBiquadFilter();
  node.type = f.type;
  node.frequency.setValueAtTime(f.f, start);
  if (f.f2 !== undefined) node.frequency.exponentialRampToValueAtTime(Math.max(20, f.f2), start + dur);
  node.Q.value = f.q ?? 0.7;
  return node;
}

/** 立ち上がり（attack）→ 指数減衰。ふんわりした包絡 */
function envelope(g: GainNode, start: number, dur: number, peak: number, attack: number): void {
  const a = Math.min(attack, dur * 0.5);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + a);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
}

export interface ToneOpts {
  type?: OscillatorType;
  /** 開始周波数 */
  f: number;
  /** 指定すると dur の間に f → f2 へ掃引する */
  f2?: number;
  /** t0 からの遅延（秒） */
  at?: number;
  dur: number;
  gain: number;
  attack?: number;
  filter?: FilterOpts;
}

/** 単音（サイン/三角波中心）。音程の掃引・フィルター・短い包絡に対応 */
export function tone(x: Eng, t0: number, o: ToneOpts): void {
  const start = t0 + (o.at ?? 0);
  const osc = x.ctx.createOscillator();
  osc.type = o.type ?? 'triangle';
  osc.frequency.setValueAtTime(Math.max(20, o.f), start);
  if (o.f2 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), start + o.dur);
  const g = x.ctx.createGain();
  envelope(g, start, o.dur, o.gain, o.attack ?? 0.008);
  osc.connect(g);
  let last: AudioNode = g;
  if (o.filter) {
    const fl = applyFilter(x, o.filter, start, o.dur);
    g.connect(fl);
    last = fl;
  }
  last.connect(x.master);
  osc.start(start);
  osc.stop(start + o.dur + 0.03);
}

export interface NoiseOpts {
  at?: number;
  dur: number;
  gain: number;
  attack?: number;
  filter: FilterOpts;
}

/** フィルターを通したノイズの一瞬（息・摩擦・ビリビリ系） */
export function noise(x: Eng, t0: number, o: NoiseOpts): void {
  const start = t0 + (o.at ?? 0);
  const src = x.ctx.createBufferSource();
  src.buffer = x.noise;
  src.loop = true;
  const g = x.ctx.createGain();
  envelope(g, start, o.dur, o.gain, o.attack ?? 0.005);
  const fl = applyFilter(x, o.filter, start, o.dur);
  src.connect(fl);
  fl.connect(g);
  g.connect(x.master);
  src.start(start, Math.random() * (x.noise.duration - 0.5));
  src.stop(start + o.dur + 0.03);
}

/* ------------------------------------------------------------------ */
/* 継続音（ループ）                                                    */
/* ------------------------------------------------------------------ */

export type LoopName = 'absorb' | 'overload' | 'flight' | 'charge' | 'scouter';

export interface Loop {
  /** 0..1 の制御値（overload: 過負荷率、charge: 溜め率）。不要なループでは無視 */
  set(ratio: number): void;
  stop(): void;
}

const FADE = 0.06;

/** 継続音の共通部分：出力ゲインと停止処理 */
class LoopBase implements Loop {
  readonly out: GainNode;
  private sources: AudioScheduledSourceNode[] = [];
  private stopped = false;

  constructor(protected x: Eng) {
    this.out = x.ctx.createGain();
    this.out.gain.setValueAtTime(0.0001, x.ctx.currentTime);
    this.out.gain.setTargetAtTime(1, x.ctx.currentTime, FADE);
    this.out.connect(x.master);
  }

  protected src<T extends AudioScheduledSourceNode>(n: T): T {
    n.start(this.x.ctx.currentTime);
    this.sources.push(n);
    return n;
  }

  protected osc(type: OscillatorType, f: number): OscillatorNode {
    const o = this.x.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    return this.src(o);
  }

  protected noiseSrc(): AudioBufferSourceNode {
    const s = this.x.ctx.createBufferSource();
    s.buffer = this.x.noise;
    s.loop = true;
    return this.src(s);
  }

  /** LFO を param に接続（depth はそのまま param の変化量） */
  protected lfo(rate: number, depth: number, param: AudioParam): void {
    const l = this.x.ctx.createOscillator();
    l.frequency.value = rate;
    const d = this.x.ctx.createGain();
    d.gain.value = depth;
    l.connect(d);
    d.connect(param);
    this.src(l);
  }

  set(_ratio: number): void { /* 各ループで上書き */ }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.x.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0.0001, t, FADE);
    for (const s of this.sources) {
      try { s.stop(t + 0.35); } catch { /* 既に停止済み */ }
    }
    setTimeout(() => {
      try { this.out.disconnect(); } catch { /* ignore */ }
    }, 500);
  }
}

/** 吸収中：低いハム＋ゆらぐ電気音（LFO） */
class AbsorbLoop extends LoopBase {
  constructor(x: Eng) {
    super(x);
    const hum = x.ctx.createGain();
    hum.gain.value = 0.11;
    this.osc('sine', 92).connect(hum);
    hum.connect(this.out);

    const hum2 = x.ctx.createGain();
    hum2.gain.value = 0.035;
    const hum2Lp = x.ctx.createBiquadFilter();
    hum2Lp.type = 'lowpass';
    hum2Lp.frequency.value = 700;
    this.osc('triangle', 184).connect(hum2).connect(hum2Lp).connect(this.out);

    // ゆらぐ電気音：中域の三角波を LFO で明滅させる
    const flutter = x.ctx.createGain();
    flutter.gain.value = 0.03;
    this.osc('triangle', 1250).connect(flutter).connect(this.out);
    this.lfo(5.5, 0.022, flutter.gain);
  }
}

/** 逆流中：高く激しいブザー。ratio（過負荷率）でピッチが上がる */
class OverloadLoop extends LoopBase {
  private saw: OscillatorNode;

  constructor(x: Eng) {
    super(x);
    const lp = x.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    lp.Q.value = 2;
    lp.connect(this.out);

    const sawGain = x.ctx.createGain();
    sawGain.gain.value = 0.06;
    this.saw = this.osc('sawtooth', 180);
    this.saw.connect(sawGain).connect(lp);
    this.lfo(14, 0.02, sawGain.gain);

    const sq = x.ctx.createGain();
    sq.gain.value = 0.03;
    this.osc('square', 90).connect(sq).connect(lp);
  }

  set(ratio: number): void {
    const t = this.x.ctx.currentTime;
    this.saw.frequency.setTargetAtTime(180 + 340 * ratio, t, 0.05);
  }
}

/** 飛行中：噴射のノイズループ */
class FlightLoop extends LoopBase {
  constructor(x: Eng) {
    super(x);
    const bp = x.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 0.8;
    const g = x.ctx.createGain();
    g.gain.value = 0.07;
    this.noiseSrc().connect(bp).connect(g).connect(this.out);
    this.lfo(7, 180, bp.frequency);
  }
}

/** 溜め中：ピッチが上がるうなり（わずかにずらした2音の唸り） */
class ChargeLoop extends LoopBase {
  private a: OscillatorNode;
  private b: OscillatorNode;
  private g: GainNode;

  constructor(x: Eng) {
    super(x);
    const lp = x.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2000;
    this.g = x.ctx.createGain();
    this.g.gain.value = 0.03;
    this.a = this.osc('triangle', 180);
    this.b = this.osc('triangle', 182);
    this.a.connect(this.g);
    this.b.connect(this.g);
    this.g.connect(lp).connect(this.out);
  }

  set(ratio: number): void {
    const t = this.x.ctx.currentTime;
    const f = 180 + 260 * ratio;
    this.a.frequency.setTargetAtTime(f, t, 0.05);
    this.b.frequency.setTargetAtTime(f * 1.012, t, 0.05);
    this.g.gain.setTargetAtTime(0.02 + 0.05 * ratio, t, 0.05);
  }
}

/** スカウターON：ごく小さい高周波のスキャン音（ほぼ聞こえないレベル） */
class ScouterLoop extends LoopBase {
  constructor(x: Eng) {
    super(x);
    const g = x.ctx.createGain();
    g.gain.value = 0.0035;
    this.osc('sine', 5200).connect(g).connect(this.out);
    this.lfo(1.5, 0.0015, g.gain);
  }
}

export function createLoop(name: LoopName, x: Eng): Loop {
  switch (name) {
    case 'absorb': return new AbsorbLoop(x);
    case 'overload': return new OverloadLoop(x);
    case 'flight': return new FlightLoop(x);
    case 'charge': return new ChargeLoop(x);
    case 'scouter': return new ScouterLoop(x);
  }
}
