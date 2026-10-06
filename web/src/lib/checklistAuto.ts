/**
 * 新增持倉前檢查表 1–5 自動帶出（2026-10-06；純函式）。
 * 檢查表的定位是「進場前看懂現況」，不是關卡：系統有資料的項目一律自動判定，資料缺漏時才退回手動選單，
 * 而且不擋住送出。判定規則：
 * 1. 市場燈號：盤後簡報的資金環境（lib/envState.envInfo：任一項偏空 → 保守；沒有偏空且 ≥ 3 項偏多 → 積極；其餘中性），
 *    保守／中性／積極 對應原本的選項 偏空／中性／偏多。
 * 2. 趨勢：收盤相對 60 日均線（季線）與 240 日均線（年線）的乖離（summary 的 ma60_gap、ma240_gap，還原價）：
 *    兩線之上 → 多頭；年線之上、季線之下 → 短線整理；年線之下 → 年線之下。
 * 3. 營收：近 3 個月逐月營收年增率的平均（與 pipeline revenue_yoy_3m 同定義）：≥ checklist.revenue_high_growth_pct → 高成長；
 *    > 0 → 成長；≤ 0 → 衰退。
 * 4. 估值：本益比在自身近 indicators.valuation_percentile.lookback_days 個交易日的百分位（＝估值環的本益比因子）：
 *    ≤ checklist.valuation_low_max → 位置低；≤ valuation_mid_max → 位置中；其餘 → 位置高；虧損或沒有本益比 → 不適用。
 * 5. 理由類型：目前符合的內建選股條件（config/screener.yml presets，依條件欄位的分組）；都不符合時取四環
 *    （籌碼／動能／基本面／估值）分數最高者。
 * 原本的答案文字（例「多頭（年線、季線之上）」）照舊存進紀錄，舊紀錄與統計不受影響。
 */
import type { MarketData, StockHistory, StockRow } from '../data/types';
import type { ChecklistSnapshot } from '../db/db';
import type { RevenueRow } from './fundamentals';
import { envInfo } from './envState';
import { dateLabel, envSummary, isLagging, signed, STANCE_LABEL } from './entryFacts';
import { scoresConfig, screenerConfig, sourcesConfig, thresholds, uiConfig } from './config';
import { matches } from './screener';
import { isEtfCode } from './costs';
import { fmtPrice } from './format';

export type AutoKey = 'market' | 'trend' | 'revenue' | 'valuation' | 'reasonType';
/** 標籤語意色（同 components/ui 的 TagTone） */
export type Tone = 'risk' | 'neutral' | 'strong';

export const AUTO_KEYS: AutoKey[] = ['market', 'trend', 'revenue', 'valuation', 'reasonType'];

export const REASONS = ['籌碼', '動能', '營收', '估值', '事件', '其他'];

/** 各題的選項（存進紀錄的文字）與列上的短標籤 */
export function optionsFor(key: AutoKey, cfg = uiConfig.checklist): { value: string; short: string }[] {
  switch (key) {
    case 'market': return [{ value: '偏多', short: '偏多' }, { value: '中性', short: '中性' }, { value: '偏空', short: '偏空' }];
    case 'trend': return [{ value: TREND.bull, short: '多頭' }, { value: TREND.range, short: '整理' }, { value: TREND.bear, short: '年線下' }];
    case 'revenue': return [{ value: revHigh(cfg), short: '高成長' }, { value: '成長', short: '成長' }, { value: '衰退', short: '衰退' }, { value: '不適用', short: '不適用' }];
    case 'valuation': return [{ value: '本益比位置低', short: '位置低' }, { value: '本益比位置中', short: '位置中' }, { value: '本益比位置高', short: '位置高' }, { value: '不適用', short: '不適用' }];
    case 'reasonType': return REASONS.map((r) => ({ value: r, short: r }));
  }
}
const TREND = { bull: '多頭（年線、季線之上）', range: '年線之上、短線整理', bear: '年線之下' };
const revHigh = (cfg = uiConfig.checklist) => `高成長（近 3 月年增 ≥ ${cfg.revenue_high_growth_pct}%）`;

/** 存的答案 → 列上的短標籤（舊紀錄的自由文字原樣顯示） */
export function shortOf(key: AutoKey, value: string): string {
  return optionsFor(key).find((o) => o.value === value)?.short ?? value;
}

export const AUTO_LABEL: Record<AutoKey, string> = { market: '1. 市場燈號', trend: '2. 趨勢', revenue: '3. 營收', valuation: '4. 估值', reasonType: '5. 理由類型' };

export interface AutoItem {
  key: AutoKey;
  /** 自動判定的答案（存進紀錄的文字）；null＝資料不足 */
  value: string | null;
  /** 列上的判定標籤 */
  short: string;
  tone: Tone;
  /** 依據數字（列右側數值；等寬數字） */
  main: string;
  /** 依據的補充（副資訊） */
  basis: string;
  /** 資料日（YYYY-MM-DD 或月份 YYYY-MM） */
  date: string | null;
  dateText: string;
  stale: boolean;
  /** 資料不足的原因 */
  missing: string | null;
  /** 說明頁「判定規則與現值」的現值 */
  facts: { label: string; value: string }[];
  /** 依據數字（存進快照，供日後復盤） */
  numbers: Record<string, number | string | null>;
}

export interface AutoInput {
  row: StockRow | undefined;
  /** 個股檔（營收逐月、近 20 日低點）；沒有載入時營收退回 summary 的近 3 月平均 */
  hist?: StockHistory | null;
  market?: MarketData | null;
  /** 最新交易日（summary 的資料日） */
  latest?: string | null;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pct = (v: number, d = 1) => `${signed(v, d)}%`;
const price = fmtPrice;
const lack = (key: AutoKey, missing: string, date: string | null = null): AutoItem => ({
  key, value: null, short: '資料不足', tone: 'neutral', main: '—', basis: missing, date, dateText: date ? dateLabel(date) : '', stale: false, missing, facts: [], numbers: {},
});

// ------------------------------------------------------------------ 1. 市場燈號

export function autoMarket(market: MarketData | null | undefined, latest: string | null | undefined): AutoItem {
  const lights = market?.env?.lights ?? [];
  const env = envInfo(lights);
  if (!market || env.state === 'unknown') return lack('market', market ? '資金指標都還沒有資料' : '盤後簡報資料尚未載入');
  const sum = envSummary(lights);
  const value = env.state === 'conservative' ? '偏空' : env.state === 'aggressive' ? '偏多' : '中性';
  const date = market.date ?? null;
  return {
    key: 'market', value, short: value, tone: value === '偏空' ? 'risk' : value === '偏多' ? 'strong' : 'neutral',
    main: env.state === 'conservative' ? `${env.red.length} 項偏空` : `${env.green.length} 項偏多`,
    basis: `資金環境${env.label}`,
    date, dateText: `簡報 ${dateLabel(date)}`, stale: isLagging('daily', date, latest), missing: null,
    facts: [
      { label: '資金環境', value: env.label },
      { label: '判定依據', value: sum.basis },
      ...lights.map((l) => ({ label: l.label, value: STANCE_LABEL[l.state === 'green' ? 'bull' : l.state === 'red' ? 'bear' : l.state === 'yellow' ? 'neutral' : 'none'] })),
    ],
    numbers: { env: env.state, red: env.red.length, green: env.green.length, yellow: env.yellow.length, gray: env.gray.length },
  };
}

// ------------------------------------------------------------------ 2. 趨勢

export function autoTrend(row: StockRow | undefined, latest: string | null | undefined): AutoItem {
  const g60 = row?.ma60_gap, g240 = row?.ma240_gap, close = row?.close;
  if (!row || !fin(close)) return lack('trend', '沒有收盤價');
  if (!fin(g240)) return lack('trend', '歷史不足 240 個交易日，算不出年線', row.last_trade_date ?? latest ?? null);
  const ma60 = fin(g60) ? close / (1 + g60 / 100) : null;
  const ma240 = close / (1 + g240 / 100);
  const value = g240 > 0 && fin(g60) && g60 > 0 ? TREND.bull : g240 > 0 ? TREND.range : TREND.bear;
  const date = row.last_trade_date ?? latest ?? null;
  return {
    key: 'trend', value, short: shortOf('trend', value), tone: 'neutral',
    main: price(close),
    basis: `季線 ${ma60 === null ? '—' : `${price(ma60)} (${pct(g60 as number)})`}・年線 ${price(ma240)} (${pct(g240)})`,
    date, dateText: dateLabel(date), stale: !row.last_trade_date && isLagging('daily', date, latest), missing: null,
    facts: [
      { label: '收盤', value: price(close) },
      { label: '60 日均線（季線）', value: ma60 === null ? '—（歷史不足 60 日）' : price(ma60) },
      { label: '季線乖離', value: fin(g60) ? pct(g60, 2) : '—（歷史不足 60 日）' },
      { label: '240 日均線（年線）', value: price(ma240) },
      { label: '年線乖離', value: pct(g240, 2) },
    ],
    numbers: { close, ma60: ma60 === null ? null : round2(ma60), ma240: round2(ma240), gap60: fin(g60) ? g60 : null, gap240: g240 },
  };
}
const round2 = (v: number) => Math.round(v * 100) / 100;

// ------------------------------------------------------------------ 3. 營收

const monthText = (ym: string) => `${Number(ym.slice(5, 7))} 月`;

export function autoRevenue(row: StockRow | undefined, hist: StockHistory | null | undefined, latest: string | null | undefined, cfg = uiConfig.checklist): AutoItem {
  if (!row) return lack('revenue', '尚未選擇股票');
  const rows = ((hist?.revenue as RevenueRow[] | undefined) ?? []).filter((r) => r.ym);
  const last3 = rows.slice(-3);
  const monthly = last3.length === 3 && last3.every((r) => fin(r.yoy)) ? last3 : null;
  const avg = monthly ? monthly.reduce((s, r) => s + (r.yoy as number), 0) / 3 : fin(row.revenue_yoy_3m) ? (row.revenue_yoy_3m as number) : null;
  if (avg === null) {
    if (isEtfCode(row.code)) return { ...lack('revenue', 'ETF 沒有月營收'), value: '不適用', short: '不適用', missing: null, basis: 'ETF 沒有月營收' };
    return lack('revenue', rows.length ? '近 3 個月有月份缺少去年同期營收，算不出年增率' : hist === undefined ? '月營收載入中' : '沒有月營收資料');
  }
  const value = avg >= cfg.revenue_high_growth_pct ? revHigh(cfg) : avg > 0 ? '成長' : '衰退';
  const date = monthly ? monthly[2].ym : (rows[rows.length - 1]?.ym ?? null);
  return {
    key: 'revenue', value, short: shortOf('revenue', value), tone: 'neutral',
    main: pct(avg),
    basis: monthly ? monthly.slice().reverse().map((r) => `${monthText(r.ym)} ${pct(r.yoy as number)}`).join('・') : '近 3 月年增率平均（逐月數字載入中）',
    date, dateText: date ? dateLabel(date) : '', stale: isLagging('revenue', date, latest), missing: null,
    facts: [
      ...(monthly ? monthly.slice().reverse().map((r) => ({ label: `${r.ym.slice(0, 4)}/${r.ym.slice(5, 7)} 年增率`, value: pct(r.yoy as number, 2) })) : []),
      { label: '3 個月平均', value: pct(avg, 2) },
    ],
    numbers: { yoy3m: round2(avg), ...(monthly ? Object.fromEntries(monthly.map((r) => [r.ym, r.yoy])) : {}) },
  };
}

// ------------------------------------------------------------------ 4. 估值

export function autoValuation(row: StockRow | undefined, latest: string | null | undefined, cfg = uiConfig.checklist): AutoItem {
  if (!row) return lack('valuation', '尚未選擇股票');
  const date = row.last_trade_date ?? latest ?? null;
  const pe = row.pe, pp = row.pe_percentile;
  const base = { key: 'valuation' as const, date, dateText: dateLabel(date), stale: false, missing: null };
  if (!fin(pe) || pe <= 0) {
    return {
      ...base, value: '不適用', short: '不適用', tone: 'neutral', main: '—', basis: isEtfCode(row.code) ? 'ETF 沒有本益比' : '虧損或沒有本益比',
      facts: [{ label: '本益比', value: '—（虧損或沒有本益比，不計算位置）' }], numbers: { pe: null, pePercentile: null },
    };
  }
  if (!fin(pp)) return { ...lack('valuation', `本益比 ${pe.toFixed(1)} 倍；歷史不足 ${thresholds.indicators.valuation_percentile.min_observations} 個交易日，算不出百分位`, date), main: `${pe.toFixed(1)} 倍` };
  const value = pp <= cfg.valuation_low_max ? '本益比位置低' : pp <= cfg.valuation_mid_max ? '本益比位置中' : '本益比位置高';
  return {
    ...base, value, short: shortOf('valuation', value), tone: 'neutral',
    main: `${pe.toFixed(1)} 倍`,
    basis: `歷史第 ${Math.round(pp)} 百分位（近 ${lookbackYears()} 年）`,
    facts: [{ label: '本益比', value: `${pe.toFixed(2)} 倍` }, { label: '自身歷史百分位', value: `第 ${pp.toFixed(1)}` }],
    numbers: { pe, pePercentile: pp },
  };
}
const lookbackYears = () => Math.round(Number(thresholds.indicators.valuation_percentile.lookback_days) / 252);

// ------------------------------------------------------------------ 5. 理由類型

const GROUP_REASON: Record<string, string> = { 籌碼: '籌碼', 動能: '動能', 基本面: '營收', 估值: '估值' };
const RING_REASON: Record<string, string> = { chip: '籌碼', momentum: '動能', fundamental: '營收', valuation: '估值' };

/** 內建條件的理由類型：條件欄位分組（config/screener.yml fields.group）最多的一組；流動性不算 */
export function presetReason(conditions: { field: string }[]): string | null {
  const count = new Map<string, number>();
  for (const c of conditions) {
    const r = GROUP_REASON[screenerConfig.fields[c.field]?.group ?? ''];
    if (r) count.set(r, (count.get(r) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [r, n] of count) if (best === null || n > (count.get(best) ?? 0)) best = r;
  return best;
}

export function autoReason(row: StockRow | undefined, latest: string | null | undefined): AutoItem {
  if (!row) return lack('reasonType', '尚未選擇股票');
  const date = row.last_trade_date ?? latest ?? null;
  const hits = screenerConfig.presets.filter((p) => matches(row, p.conditions));
  const hit = hits.find((p) => presetReason(p.conditions));
  if (hit) {
    const value = presetReason(hit.conditions) as string;
    return {
      key: 'reasonType', value, short: value, tone: 'neutral', main: '',
      basis: `符合內建條件「${hit.label}」${hits.length > 1 ? `等 ${hits.length} 個` : ''}`,
      date, dateText: dateLabel(date), stale: false, missing: null,
      facts: hits.map((p) => ({ label: `符合「${p.label}」`, value: `${p.subtitle}（${presetReason(p.conditions) ?? '—'}）` })),
      numbers: { preset: hit.id, presets: hits.map((p) => p.id).join(',') },
    };
  }
  const rings = (['chip', 'momentum', 'fundamental', 'valuation'] as const).map((k) => ({ k, v: row[k] })).filter((x): x is { k: typeof x.k; v: number } => fin(x.v));
  if (!rings.length) return lack('reasonType', '沒有符合的內建條件，四環分數也都沒有資料');
  const top = rings.reduce((a, b) => (b.v > a.v ? b : a));
  const value = RING_REASON[top.k];
  return {
    key: 'reasonType', value, short: value, tone: 'neutral', main: `${Math.round(top.v)} 分`,
    basis: `四環最高：${scoresConfig.categories[top.k].label}`,
    date, dateText: dateLabel(date), stale: false, missing: null,
    facts: [
      { label: '符合的內建條件', value: '無' },
      ...rings.map((r) => ({ label: scoresConfig.categories[r.k].label, value: `${Math.round(r.v)} 分` })),
    ],
    numbers: { ring: top.k, score: top.v },
  };
}

export function autoItems(i: AutoInput): Record<AutoKey, AutoItem> {
  return {
    market: autoMarket(i.market, i.latest),
    trend: autoTrend(i.row, i.latest),
    revenue: autoRevenue(i.row, i.hist, i.latest),
    valuation: autoValuation(i.row, i.latest),
    reasonType: autoReason(i.row, i.latest),
  };
}

// ------------------------------------------------------------------ 說明頁內容

export interface ItemDoc { what: string; why: string; rules: string[]; source: string }

export function itemDoc(key: AutoKey, row: StockRow | undefined, cfg = uiConfig.checklist): ItemDoc {
  const quotes = sourcesConfig[row?.market === 'tpex' ? 'tpex_quotes' : 'twse_quotes']?.label ?? '每日收盤行情';
  const env = uiConfig.env_state;
  switch (key) {
    case 'market': return {
      what: '盤後簡報的資金環境燈號：外資台指期淨未平倉、台幣匯率、大盤與年線、M1B／M2、美國 10 年期殖利率五項資金指標的彙總。',
      why: '動能策略在大盤偏空時，勝率與報酬明顯下降；先確認大環境，再看個股。',
      rules: [
        `${env.conservative_min_red <= 1 ? '任一項' : `${env.conservative_min_red} 項以上`}偏空 → 資金環境保守 → 偏空`,
        `沒有偏空且 ${env.aggressive_min_green} 項以上偏多 → 資金環境積極 → 偏多`,
        '其餘 → 資金環境中性 → 中性',
        '每項指標的門檻見「新增持倉前的事實」各列說明',
      ],
      source: '盤後簡報（market.json）；各指標來源見各列說明',
    };
    case 'trend': return {
      what: '收盤價相對 60 日均線（季線）與 240 日均線（年線）的位置與乖離 %。均線以還原價計算，除權息不造成斷層。',
      why: '確認這筆是順勢還是逆勢進場：站上季線與年線代表中長期平均成本都在下方。',
      rules: ['收盤高於年線且高於季線 → 多頭（年線、季線之上）', '收盤高於年線、低於季線 → 年線之上、短線整理', '收盤低於或等於年線 → 年線之下'],
      source: `${quotes}（還原價）`,
    };
    case 'revenue': return {
      what: '近 3 個月每個月的營收年增率（與去年同月比較），以及三個月的平均。',
      why: '確認股價動能背後是否有基本面支撐。',
      rules: [`3 個月平均 ≥ ${cfg.revenue_high_growth_pct}% → 高成長`, '> 0% → 成長', '≤ 0% → 衰退', 'ETF 或沒有月營收 → 不適用'],
      source: `${sourcesConfig.mops_revenue?.label ?? '月營收'}、${sourcesConfig[row?.market === 'tpex' ? 'tpex_revenue' : 'twse_revenue']?.label ?? '月營收'}`,
    };
    case 'valuation': return {
      what: `目前本益比，以及它在自身近 ${thresholds.indicators.valuation_percentile.lookback_days} 個交易日（約 ${lookbackYears()} 年）本益比之中的百分位（0＝最低、100＝最高）；與估值環的本益比因子同一個定義。`,
      why: '位置越高，同樣的利空造成的回檔幅度通常越大。',
      rules: [
        `百分位 ≤ ${cfg.valuation_low_max} → 本益比位置低`,
        `≤ ${cfg.valuation_mid_max} → 本益比位置中`,
        `> ${cfg.valuation_mid_max} → 本益比位置高`,
        '虧損或沒有本益比 → 不適用',
        `觀察值少於 ${thresholds.indicators.valuation_percentile.min_observations} 個交易日 → 資料不足`,
      ],
      source: sourcesConfig[row?.market === 'tpex' ? 'tpex_valuation' : 'twse_valuation']?.label ?? '本益比／殖利率／淨值比',
    };
    case 'reasonType': return {
      what: '這筆持倉的理由分類：籌碼、動能、營收、估值、事件、其他。',
      why: '日後復盤時，用來統計哪一類理由的成效較好（個人統計頁「依理由類型」）。',
      rules: [
        ...screenerConfig.presets.map((p) => `符合內建條件「${p.label}」（${p.subtitle}）→ ${presetReason(p.conditions) ?? '—'}`),
        '同時符合多個 → 取設定檔順序的第一個',
        '都不符合 → 四環（籌碼／動能／基本面／估值）分數最高者；基本面對應「營收」',
        '事件、其他只能手動選',
      ],
      source: '每日選股欄位（summary.json）與四環分數',
    };
  }
}

// ------------------------------------------------------------------ 理由草稿、停損參考價、頂部摘要

/** 理由草稿：只寫事實（觸發的訊號＋1–4 的依據數字），不寫任何建議用語 */
export function reasonDraft(row: StockRow | undefined, items: Record<AutoKey, AutoItem>, streakMin = uiConfig.chip.streak_min): string {
  if (!row) return '';
  const parts: string[] = [];
  const fs = row.foreign_streak, ts = row.trust_streak;
  if (fin(fs) && fs >= streakMin) parts.push(`外資連 ${fs} 日買超`);
  if (fin(ts) && ts >= streakMin) parts.push(`投信連 ${ts} 日買超`);
  const hits = screenerConfig.presets.filter((p) => matches(row, p.conditions));
  if (hits.length) parts.push(`符合「${hits.map((p) => p.label).join('」「')}」`);
  const m = items.market;
  if (m.value && m.basis) parts.push(m.basis);
  const t = items.trend.numbers;
  if (items.trend.value && fin(t.gap240)) {
    const g60 = t.gap60, g240 = t.gap240 as number;
    if (fin(g60) && g60 > 0) parts.push(`站上季線，乖離 ${pct(g60, 0)}`);
    else if (fin(g60)) parts.push(`低於季線，乖離 ${pct(g60, 0)}`);
    parts.push(g240 > 0 ? `站上年線，乖離 ${pct(g240, 0)}` : `低於年線，乖離 ${pct(g240, 0)}`);
  }
  const y3 = items.revenue.numbers.yoy3m;
  if (fin(y3)) parts.push(`近 3 月營收年增 ${pct(y3, 0)}`);
  const v = items.valuation.numbers;
  if (fin(v.pe) && fin(v.pePercentile)) parts.push(`本益比 ${v.pe.toFixed(1)} 倍，歷史第 ${Math.round(v.pePercentile)} 百分位`);
  else if (items.valuation.value === '不適用' && !isEtfCode(row.code)) parts.push('虧損或沒有本益比');
  return parts.join('；');
}

export interface StopRef { id: 'ma60' | 'low' | 'pct'; label: string; price: number }

/** 停損參考價：季線價、近 N 日低點（還原價換算到目前價格基準）、進場價 −7%（thresholds.backtest.stop_loss_pct） */
export function stopRefs(row: StockRow | undefined, hist: StockHistory | null | undefined, entry: number | null, cfg = uiConfig.checklist): StopRef[] {
  const out: StopRef[] = [];
  const close = row?.close, g60 = row?.ma60_gap;
  if (fin(close) && fin(g60)) out.push({ id: 'ma60', label: '季線', price: round2(close / (1 + g60 / 100)) });
  if (hist?.l?.length) {
    const n = hist.l.length;
    const afLast = hist.af?.[n - 1] || 1;
    const lows: number[] = [];
    for (let i = Math.max(0, n - cfg.stop_low_days); i < n; i++) {
      const v = hist.l[i];
      if (fin(v) && v > 0) lows.push((v * (hist.af?.[i] ?? 1)) / afLast);
    }
    if (lows.length) out.push({ id: 'low', label: `近 ${cfg.stop_low_days} 日低點`, price: round2(Math.min(...lows)) });
  }
  const sl = Number(thresholds.backtest.stop_loss_pct ?? -7);
  if (entry !== null && entry > 0) out.push({ id: 'pct', label: `進場價 ${signed(sl, 0)}%`, price: round2(entry * (1 + sl / 100)) });
  return out;
}

/** 表單頂部的中性摘要：環境偏保守或估值位置高時，只列事實（不彈警告、不阻擋）；其餘情況為 null */
export function topSummary(items: Record<AutoKey, AutoItem>, effective: Partial<Record<AutoKey, string>> = {}): string | null {
  const parts: string[] = [];
  const market = effective.market ?? items.market.value;
  if (market === '偏空') parts.push(items.market.value === '偏空' ? `${items.market.basis}（${items.market.main}）` : '市場燈號：偏空（手動）');
  const val = effective.valuation ?? items.valuation.value;
  if (val === '本益比位置高') parts.push(items.valuation.value === '本益比位置高' ? `本益比 ${items.valuation.main}，${items.valuation.basis}` : '估值：本益比位置高（手動）');
  return parts.length ? parts.join('・') : null;
}

// ------------------------------------------------------------------ 手動調整與快照

export type Overrides = Partial<Record<AutoKey, string>>;

/** 採用的答案：手動調整優先，其次自動判定；都沒有為空字串 */
export function effectiveOf(items: Record<AutoKey, AutoItem>, overrides: Overrides, key: AutoKey): string {
  return overrides[key] ?? items[key].value ?? '';
}

/** 存檔用的快照：每項的判定結果、依據數字、資料日與來源（auto／manual） */
export function buildSnapshot(items: Record<AutoKey, AutoItem>, overrides: Overrides, dataDate: string | null, at: string): ChecklistSnapshot {
  const out: ChecklistSnapshot = { at, dataDate, items: {} };
  for (const k of AUTO_KEYS) {
    const it = items[k];
    const manual = overrides[k] !== undefined && overrides[k] !== it.value;
    out.items[k] = {
      source: manual ? 'manual' : 'auto',
      result: effectiveOf(items, overrides, k) || null,
      auto: it.value,
      basis: it.basis,
      main: it.main,
      numbers: it.numbers,
      date: it.date,
      stale: it.stale,
    };
  }
  return out;
}

/** 檢查表完成（流程頁的「進場前完成檢查表」）：1–5 每一項都有答案（自動或手動）；理由、停損、目標另計 */
export function snapshotDone(s: ChecklistSnapshot): boolean {
  return AUTO_KEYS.every((k) => !!s.items[k]?.result);
}
