// 台詞の音声（public/assets/voice/<id>.mp3。ElevenLabs で作ったものを置く）。document / Audio が無い環境（vitest の node）では何もしない。
// ムービーの Shot.voice から再生し、次の台詞・ムービーの終わり・スキップで止まる。

/** 各音声の長さ（秒）。ショットの長さは「音声＋あき」で決める */
export const VOICE_SEC: Readonly<Record<string, number>> = {
  '1-1_spark': 3.52, '1-3_spark': 1.2, '1-4_ryan': 2.96, '1-5_spark': 7.92, '1-6_spark': 4.16, '1-7_spark': 2.8,
  '1-8_ryan': 2.8, '1-9_spark': 1.68, '1-11_ryan': 2.72, '1-12_spark': 2.48, '2-3_spark': 2.8,
  '3-1_spark': 1.36, '3-2_spark': 1.2, '3-3_ryan': 2.4, '3-5_spark': 3.12, '3-6_ryan': 1.44, '3-7_spark': 2.88,
  '3-9_spark': 7.04, '3-10_ryan': 1.36, '3-11_spark': 5.2, '4-1_spark': 11.92, '4-3a_spark': 2.64, '4-3b_spark': 3.2,
};

let cur: HTMLAudioElement | null = null;

/** 音声の長さ＋あき */
export function voiceLen(id: string, pad = 0.5): number {
  return (VOICE_SEC[id] ?? 1) + pad;
}

export function playVoice(id: string): void {
  stopVoice();
  if (typeof Audio === 'undefined') return;
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const a = new Audio(`${base}assets/voice/${id}.mp3`);
  a.volume = 1;
  cur = a;
  a.play().catch(() => { /* 自動再生が許可されていない・ファイルが無い：無音で進める */ });
}

export function stopVoice(): void {
  if (!cur) return;
  cur.pause();
  cur = null;
}

/** いま台詞が鳴っているか（口パク用） */
export function voicePlaying(): boolean {
  return !!cur && !cur.paused && !cur.ended;
}
