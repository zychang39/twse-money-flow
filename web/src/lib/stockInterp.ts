/**
 * 個股頁的解讀行（B2）與提醒門檻（B4）：純函式，模板帶入當下數值、只陳述事實（≤ 28 字），
 * 用語固定（B5）：斜率「加快／放慢」、差距「擴大／收斂」。提醒門檻來自 config/glossary.yml alerts。
 */
import type { StockHistory, StockSectorItem, StockTrend } from '../data/types';
import { alertHit } from './glossary';
import { fmtNum, fmtPrice } from './format';

type N = number | null | undefined;
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const MINUS = '−';
/** 帶號百分比：+1.23%／−0.40% */
export const sp = (v: number, d = 2) => `${v > 0 ? '+' : v < 0 ? MINUS : ''}${fmtNum(Math.abs(v), d)}%`;
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

export interface Interp { text: string | null; alert: boolean }

/** RS 百分位：「高於 84% 的股票，20 日前 85」；個股 PR ≥ 80 但細產業排名在後三分之一 → 提醒 */
export function rsInterp(rs: N, prev: N, fine?: StockSectorItem | null): Interp {
  if (!ok(rs)) return { text: null, alert: false };
  const tercile = fine && ok(fine.rank) && ok(fine.of) && fine.of > 0 ? (fine.rank / fine.of > 2 / 3 ? 3 : fine.rank / fine.of > 1 / 3 ? 2 : 1) : null;
  const alert = alertHit('stock_vs_sector', { pr: rs, sector_tercile: tercile });
  if (alert && fine) return { text: `個股強，但${fine.name}排在後三分之一`, alert };
  return { text: `高於 ${Math.round(rs)}% 的股票${ok(prev) ? `，20 日前 ${Math.round(prev)}` : ''}`, alert };
}

/** 距 52 週高：在高點時不寫「0.00%」，改寫「今天收在 52 週高點」 */
export function high52Interp(t: StockTrend['y52'] | undefined | null, dist: N): Interp {
  if (t?.at_high) return { text: '今天收在 52 週高點', alert: false };
  if (!ok(dist)) return { text: null, alert: false };
  const hi = t && ok(t.hi) ? `高點 ${fmtPrice(t.hi)}(${md(t.hi_date)})` : null;
  return { text: hi ? `${hi}，差 ${fmtNum(Math.abs(dist), 1)}%` : `距高點 ${fmtNum(Math.abs(dist), 1)}%`, alert: false };
}

/** 20 日乖離 ATR 倍數：「收盤在 20 日線上方 1.6 倍 ATR」；> 3 → 提醒 */
export function biasAtrInterp(v: N): Interp {
  if (!ok(v)) return { text: null, alert: false };
  const alert = alertHit('bias_atr', { value: v });
  return { text: `收盤在 20 日線${v >= 0 ? '上方' : '下方'} ${fmtNum(Math.abs(v), 1)} 倍 ATR${alert ? '，短期漲得快' : ''}`, alert };
}

/** 量比：「成交量是 20 日均量的 0.71 倍」；> 3 → 提醒 */
export function volRatioInterp(v: N): Interp {
  if (!ok(v)) return { text: null, alert: false };
  return { text: `成交量是 20 日均量的 ${fmtNum(v, 2)} 倍`, alert: alertHit('volume_ratio', { value: v }) };
}

/** 法人 20 日佔量：「法人 20 日淨買 953 張，佔量 1.2%」 */
export function instInterp(lots: N, pct: N): Interp {
  if (!ok(lots)) return { text: null, alert: false };
  const word = lots > 0 ? '淨買' : lots < 0 ? '淨賣' : '買賣相抵';
  return { text: `法人 20 日${word}${lots ? ` ${fmtNum(Math.abs(lots), 0)} 張` : ''}${ok(pct) ? `，佔量 ${fmtNum(Math.abs(pct), 1)}%` : ''}`, alert: false };
}

/** 千張大戶：「千張大戶 84.77%，連 3 週增加」 */
export function whaleInterp(hf: { tiers: { tier: string; pct: N }[]; whaleStreak: number } | null | undefined): Interp {
  const w = hf?.tiers.find((t) => t.tier === 'whale');
  if (!hf || !w || !ok(w.pct)) return { text: null, alert: false };
  const st = hf.whaleStreak === 0 ? '週持平' : `連 ${Math.abs(hf.whaleStreak)} 週${hf.whaleStreak > 0 ? '增加' : '減少'}`;
  return { text: `千張大戶持股 ${fmtNum(w.pct, 2)}%，${st}`, alert: false };
}

/** 融資 5 日增減 %：> 10% → 提醒 */
export function marginInterp(pct5: N, abs5: N): Interp {
  if (!ok(pct5)) return { text: null, alert: false };
  const alert = alertHit('margin_5d', { value: pct5 });
  const dir = pct5 > 0 ? '增加' : pct5 < 0 ? '減少' : '持平';
  return { text: `融資 5 日${dir}${ok(abs5) && abs5 ? ` ${fmtNum(Math.abs(abs5), 0)} 張` : ''}${alert ? '，增加得快' : ''}`, alert };
}

/** ATR%：位於自身近 1 年的第幾百分位；≥ 90 → 提醒（rank 為 0–1） */
export function atrInterp(atrPct: N, rank: N): Interp {
  if (!ok(atrPct)) return { text: null, alert: false };
  if (!ok(rank)) return { text: `每日平均波動約 ${fmtNum(atrPct, 2)}%`, alert: false };
  const r = Math.round(rank * 100);
  const alert = alertHit('atr_pct_rank', { value: r });
  return { text: `波動在自身近 1 年的第 ${r} 百分位${alert ? '，偏高' : ''}`, alert };
}

/** 斜率比較（B5）：近 10 日斜率 vs 10 日前 → 加快／放慢 */
export function slopeWord(now: N, prev: N): string | null {
  if (!ok(now) || !ok(prev)) return null;
  if (Math.abs(now - prev) < 0.05) return '持平';
  // 上升時斜率變大＝加快；下降時斜率更負＝加快（跌勢加快）
  return Math.abs(now) > Math.abs(prev) ? '加快' : '放慢';
}

/** 均線差距（B5）：20 日線與 60 日線的距離 → 擴大／收斂 */
export function gapWord(now: N, prev: N): string | null {
  if (!ok(now) || !ok(prev)) return null;
  if (Math.abs(Math.abs(now) - Math.abs(prev)) < 0.05) return '持平';
  return Math.abs(now) > Math.abs(prev) ? '擴大' : '收斂';
}

const ALIGN: Record<string, string> = { bull: '多頭排列', bear: '空頭排列', mixed: '均線糾結' };

/** 趨勢卡結論與解讀：「多頭排列 10 天」／「20 日線斜率 +1.66%，加快」 */
export function trendSummary(t: StockTrend | null | undefined): { concl: string | null; interp: string | null } {
  if (!t) return { concl: null, interp: null };
  const st = t.align?.state;
  const concl = st ? `${ALIGN[st]}${st !== 'mixed' && t.align.days ? ` ${t.align.days} 天` : ''}` : null;
  const m = t.ma['20'];
  const w = slopeWord(m?.slope, m?.slope_prev);
  const interp = ok(m?.slope) ? `20 日線 10 日斜率 ${sp(m.slope)}${w && w !== '持平' ? `，${w}` : ''}` : null;
  return { concl, interp };
}

/** 均線排列的白話（給趨勢詳情） */
export function alignName(state: string | null | undefined): string {
  return state ? ALIGN[state] ?? '—' : '—';
}

/** 注意／處置：近 10 個營業日注意 ≥ 3 次或處置中 → 提醒 */
export function attentionAlert(h: Pick<StockHistory, 'attn'>): boolean {
  const a = h.attn as { count10?: number; active?: unknown } | null | undefined;
  return alertHit('attention', { count10: a?.count10 ?? 0, disposed: !!a?.active });
}
