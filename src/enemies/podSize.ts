// 休眠コンテナ（pod）の大きさ。three に依存しない（レベル配置でも使う）
export function podSize(radius: number): { w: number; d: number; h: number } {
  const w = Math.max(1.7, radius * 2 + 0.7);
  return { w, d: w, h: Math.max(2.1, radius * 2 + 0.7) };
}
