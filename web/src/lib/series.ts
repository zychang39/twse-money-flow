/**
 * 圖表資料的邊界情況（純函式）：缺漏、只有 1 點、資料少於所選期間。
 * - segments：把序列切成「連續兩點以上」的線段與「孤立點」；孤立點畫成單點標記，不會因為前後缺值而消失。
 * - coverage：所選期間 vs. 可用資料，產生「資料累積中：目前只有 N 週（自 YYYY/M/D 起）…」說明。
 */

type N = number | null | undefined;

const ok = (v: N): v is number => v !== null && v !== undefined && Number.isFinite(v);

export interface Segments {
  /** 每段為連續有值的索引（長度 ≥ 2） */
  runs: number[][];
  /** 前後都沒有值的孤立點（含整段只有 1 點） */
  singles: number[];
}

export function segments(values: N[]): Segments {
  const runs: number[][] = [];
  const singles: number[] = [];
  let cur: number[] = [];
  const flush = () => {
    if (cur.length >= 2) runs.push(cur);
    else if (cur.length === 1) singles.push(cur[0]);
    cur = [];
  };
  values.forEach((v, i) => {
    if (ok(v)) cur.push(i);
    else flush();
  });
  flush();
  return { runs, singles };
}

/** 有值的點數。 */
export function countValid(values: N[]): number {
  return values.reduce<number>((n, v) => n + (ok(v) ? 1 : 0), 0);
}

export interface Coverage {
  /** 可用的資料點數（週或交易日） */
  have: number;
  /** 所選期間需要的點數 */
  want: number;
  /** 第一筆可用資料的日期 */
  since: string | null;
  /** 可用資料少於所選期間 */
  short: boolean;
  /** 少於 2 點：畫不出走勢線，只能畫單點標記 */
  single: boolean;
}

export function coverage(dates: string[], want: number): Coverage {
  const have = dates.length;
  return { have, want, since: dates[0] ?? null, short: have < want, single: have < 2 };
}

/** 「2024/4/11」：資料起日跨年，一律寫年份（#9） */
function ymd(iso: string): string {
  return `${iso.slice(0, 4)}/${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

/**
 * 資料不足時的說明（資料足夠時回傳 null）。
 * 例：「資料累積中：目前只有 1 週（自 2026/9/18 起），所選期間超過可用資料；歷史回補中」
 */
export function coverageNote(c: Coverage, unit: '週' | '個交易日', backfilling = true): string | null {
  if (!c.short) return null;
  if (!c.have) return `資料累積中：目前還沒有資料${backfilling ? '；歷史回補中' : ''}`;
  return `資料累積中：目前只有 ${c.have} ${unit}（自 ${ymd(c.since!)} 起），所選期間超過可用資料${backfilling ? '；歷史回補中' : ''}`;
}

/**
 * 主角走勢圖的資料不足說明（#9）：數量一律是交易日數（週線取樣的視窗用取樣前的 span），日期帶年份。
 * 同一檔股票不論選哪個期間，只要資料都不夠，說的是同一個數字。
 */
export function windowCoverageNote(win: { dates: string[]; truncated: boolean; span?: { days: number; since: string } }): string | null {
  if (!win.truncated) return null;
  const days = win.span?.days ?? win.dates.length;
  const since = win.span?.since ?? win.dates[0] ?? null;
  return coverageNote({ have: days, want: Infinity, since, short: true, single: days < 2 }, '個交易日', false);
}
