/**
 * v3 M5-3 基準切換：等權｜加權報酬｜0050｜00631L。同一頁的表格、圖表與讀值同步（同一個 state 由頁面往下傳），
 * 選擇記在 localStorage（tmf-bench），切換不改變捲動位置。判定一律以等權為準，其他基準只是換個比較對象。
 */
export type BenchKey = 'ew' | 'tr' | '0050' | '00631L';
export const BENCH_KEYS: BenchKey[] = ['ew', 'tr', '0050', '00631L'];
export const BENCH_LABEL: Record<BenchKey, string> = { ew: '等權', tr: '加權報酬', '0050': '0050', '00631L': '00631L' };
export const BENCH_LONG: Record<BenchKey, string> = {
  ew: '同日等權 universe（判定用）',
  tr: '加權報酬指數',
  '0050': '0050 買進持有（大型股）',
  '00631L': '00631L 買進持有（2 倍槓桿、每日再平衡）',
};

const KEY = 'tmf-bench';

export function loadBench(): BenchKey {
  try {
    const v = localStorage.getItem(KEY);
    if (v && (BENCH_KEYS as string[]).includes(v)) return v as BenchKey;
  } catch {
    /* 私密瀏覽：用預設 */
  }
  return 'ew';
}

export function saveBench(k: BenchKey): void {
  try {
    localStorage.setItem(KEY, k);
  } catch {
    /* 不影響畫面 */
  }
}

export interface BenchStatLike { mean_excess?: number | null; t?: number | null; ci?: [number | null, number | null] | null; win?: number | null }

/** 某一組統計在選定基準下的超額與 t：等權沿用主結果（判定用），其他基準讀 bench[key]。 */
export function benchPick(
  main: { mean_excess?: number | null; t?: number | null; ci?: [number | null, number | null] | null } | undefined,
  bench: Record<string, BenchStatLike | null | undefined> | null | undefined,
  k: BenchKey,
): BenchStatLike {
  if (k === 'ew') return { mean_excess: main?.mean_excess ?? bench?.ew?.mean_excess ?? null, t: main?.t ?? bench?.ew?.t ?? null, ci: main?.ci ?? bench?.ew?.ci ?? null };
  const b = bench?.[k];
  return { mean_excess: b?.mean_excess ?? null, t: b?.t ?? null, ci: b?.ci ?? null, win: b?.win ?? null };
}
