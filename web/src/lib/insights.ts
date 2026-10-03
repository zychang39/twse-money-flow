/**
 * 個股頁的白話重點：只陳述數據（期間加總、在過去一年的相對位置、估算成本），不給建議。
 * 2026-10-02 健檢：
 * - 外資的定義與每日籌碼表一致：有 chip 區塊時用外陸資＋外資自營商（fn＋ffd）；只有個股檔 fn（外陸資，不含外資自營商）時在文字裡寫明。
 * - 估計成本與區間統計表同一個定義（lib/chips.estimatedCost：近 20 個交易日淨買超日的均價 × 還原因子加權），
 *   只在近 20 日合計為淨買超時顯示；淨賣超或持平寫「不估成本」，不再顯示 pipeline 的 cost 序列。
 * - 每一句都帶所選法人的名字（外資／投信／自營商），不寫死「外資」。
 */
import type { StockHistory } from '../data/types';
import { type ChipBlock, type FlowKey, chipRows, estimatedCost, recent, sumConverted } from './chips';
import { fmtLotsUnit, fmtPrice, pctPlain } from './format';

/** 滾動 n 日加總；不足 n 日為 null。 */
export function rollingSum(values: (number | null)[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let s = 0, k = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== null && v !== undefined) { s += v; k++; }
    if (i >= n) { const o = values[i - n]; if (o !== null && o !== undefined) { s -= o; k--; } }
    out.push(i >= n - 1 && k > 0 ? s : null);
  }
  return out;
}

/** 最新值在過去 lookback 筆中的百分位（0–100）。 */
export function percentileOfLast(values: (number | null)[], lookback = 250): number | null {
  const tail = values.slice(-lookback).filter((v): v is number => v !== null && Number.isFinite(v));
  if (tail.length < 40) return null;
  const last = tail[tail.length - 1];
  return Math.round((tail.filter((v) => v <= last).length / tail.length) * 100);
}

export type Who = 'foreign' | 'trust' | 'dealer';
export const WHO_LABEL: Record<Who, string> = { foreign: '外資', trust: '投信', dealer: '自營商' };
const KEY: Record<Who, 'fn' | 'tn' | 'dn'> = { foreign: 'fn', trust: 'tn', dealer: 'dn' };
/** 每日籌碼表的對應欄（外資＝fn＋ffd、自營商＝自行＋避險） */
const CHIP_KEY: Record<Who, FlowKey> = { foreign: 'foreign', trust: 'trust', dealer: 'dealer' };

/** 估計成本的天數（與區間統計的 20 日一致） */
export const COST_DAYS = 20;
/** 白話重點卡片下方的註解（與區間統計表的註解同一條規則） */
export const COST_RULE_NOTE = `估計成本＝近 ${COST_DAYS} 個交易日淨買超日的均價加權（還原價），只在近 ${COST_DAYS} 日合計為淨買超時顯示；資料與區間統計表同一來源。`;

export interface InstInsight {
  title: string;
  lines: string[];
  /** 柱狀圖的每日淨買賣超（張，近 60 個交易日）與對應日期；有 chip 區塊時與每日籌碼表同一定義 */
  values: (number | null)[];
  dates: string[];
  /** 估計成本句（帶「估」標記）；淨賣超或沒有資料時 null（原因寫在 lines） */
  est: string | null;
  /** 這一段文字裡「外資」的定義（含／不含外資自營商）；投信、自營商為 null */
  definition: string | null;
}

/**
 * 近 20 日淨買賣超（張）與估計成本：有 chip 區塊時以每日籌碼表的列計算（與區間統計表同一定義），
 * 沒有時以個股檔的日序列加總、不估成本（pipeline 的 cost 序列與區間統計的定義不同，不再混用）。
 */
export function recentNetAndCost(h: StockHistory, who: Who, chip: ChipBlock | null | undefined): { net: number | null; cost: number | null; adjClose: number | null; days: number; fromChip: boolean } {
  if (chip && chip.d.length > 1) {
    const rows = recent(chipRows(chip), COST_DAYS); // 新到舊
    const net = sumConverted(rows, CHIP_KEY[who], 'lots');
    const latest = rows[0];
    const adjClose = latest && latest.close !== null ? latest.close * (latest.af ?? 1) : null;
    const cost = net !== null && net > 0 ? estimatedCost(rows, CHIP_KEY[who]) : null;
    return { net, cost, adjClose, days: rows.length, fromChip: true };
  }
  const arr = (h[KEY[who]] as (number | null)[]) ?? [];
  const sums = rollingSum(arr, COST_DAYS);
  let adjClose: number | null = null;
  for (let i = h.c.length - 1; i >= 0; i--) { const v = h.c[i]; if (v !== null) { adjClose = v * (h.af[i] ?? 1); break; } }
  return { net: sums[sums.length - 1] ?? null, cost: null, adjClose, days: Math.min(COST_DAYS, arr.length), fromChip: false };
}

export function instInsight(h: StockHistory, who: Who, chip: ChipBlock | null | undefined = null): InstInsight {
  const arr = (h[KEY[who]] as (number | null)[]) ?? [];
  const sums = rollingSum(arr, COST_DAYS);
  const pct = percentileOfLast(sums);
  const name = WHO_LABEL[who];
  const r = recentNetAndCost(h, who, chip);
  const s20 = r.net;
  const title = s20 === null ? `${name}資料不足` : `${name}近 ${r.days} 日淨${Math.round(s20) === 0 ? '買賣超持平' : `${s20 > 0 ? '買' : '賣'} ${fmtLotsUnit(s20, false)}`}`;
  const lines: string[] = [];
  if (pct !== null && s20 !== null) {
    lines.push(`${name}近 ${COST_DAYS} 日淨買賣超高於過去一年 ${pct}% 的時間${pct >= 80 ? '，屬於偏高的位置' : pct <= 20 ? '，屬於偏低的位置' : ''}。`);
  }
  let streak = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v === null || v === 0) break;
    if (streak === 0) streak = v > 0 ? 1 : -1;
    else if ((v > 0) === (streak > 0)) streak += streak > 0 ? 1 : -1;
    else break;
  }
  if (Math.abs(streak) >= 2) lines.push(`${name}已連續 ${Math.abs(streak)} 日淨${streak > 0 ? '買' : '賣'}超。`);
  let est: string | null = null;
  if (s20 !== null) {
    if (s20 <= 0) lines.push(`${name}近 ${r.days} 日為${Math.round(s20) === 0 ? '買賣超持平' : '淨賣超'}，不估成本。`);
    else if (r.cost !== null && r.adjClose !== null) {
      const rel = ((r.adjClose - r.cost) / r.cost) * 100;
      est = `${name}近 ${r.days} 日估計成本約 ${fmtPrice(r.cost)} 元（淨買超日均價加權、還原價），現價${rel >= 0 ? '高' : '低'}於成本 ${pctPlain(Math.abs(rel))}。`;
    } else if (!r.fromChip) lines.push(`${name}近 ${r.days} 日為淨買超；估計成本需要每日籌碼明細（資料累積中）。`);
  }
  const definition = who === 'foreign' ? (r.fromChip ? '外資＝外陸資＋外資自營商（與每日籌碼表相同）' : '外資＝外陸資（不含外資自營商）') : null;
  let values = arr.slice(-60);
  let dates = h.d.slice(-values.length);
  if (r.fromChip && chip) {
    const rows = chipRows(chip).slice(1).slice(-60); // 舊到新、不含種子列
    const k = CHIP_KEY[who] as keyof typeof rows[number];
    values = rows.map((row) => { const v = row[k] as number | null; return v === null ? null : v / 1000; });
    dates = rows.map((row) => row.date);
  }
  return { title, lines, values, dates, est, definition };
}
