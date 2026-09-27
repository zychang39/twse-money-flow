/**
 * 多空對照（純函式，定義見 METHODOLOGY §4.9）：把基本面、籌碼面、量價面、技術面的規則式條件
 * 分成「多方」（偏多的依據）與「空方」（需留意的依據），並列出沒有觸發的條件與目前數值。
 * 每一項權重相同；項數多寡只是條件統計，不代表漲跌機率，也不是買賣建議。門檻見 config/ui.yml bull_bear。
 */
import type { StockHistory } from '../data/types';
import type { ChipBlock } from './chips';
import { uiConfig } from './config';
import { adjClose, sma } from './history';
import { numberFormat } from './format';

type N = number | null;

export type Cat = 'fund' | 'chip' | 'pv' | 'tech';
export const CATS: Cat[] = ['fund', 'chip', 'pv', 'tech'];
export const CAT_NAME: Record<Cat, string> = { fund: '基本面', chip: '籌碼面', pv: '量價面', tech: '技術面' };
export type Side = 'bull' | 'bear' | 'neutral' | 'na';
export const SIDE_NAME: Record<Side, string> = { bull: '多方', bear: '空方', neutral: '中性', na: '資料不足' };

export interface Check {
  id: string;
  cat: Cat;
  /** 條件名稱，例「近 3 月營收年增率」 */
  name: string;
  side: Side;
  /** 依據（含數值），例「近 3 月營收年增 23.4%」 */
  text: string;
}

const F1 = numberFormat(1);
const F2 = numberFormat(2);
const INT = numberFormat(0);
const num = (v: unknown): N => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const lastOf = (a: unknown): N => {
  if (!Array.isArray(a)) return null;
  for (let i = a.length - 1; i >= 0; i--) { const v = num(a[i]); if (v !== null) return v; }
  return null;
};
const pct = (v: number, digits = 1) => `${(digits === 2 ? F2 : F1).format(Math.abs(v))}%`;

// ------------------------------------------------------------------ 指標
/** 指數移動平均（第一個值為種子）。 */
export function ema(values: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}

/** RSI（Wilder 平滑）；資料不足 → null。 */
export function rsi(values: number[], n = 14): N {
  if (values.length <= n) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

/** MACD 柱狀體（DIF − DEA）序列。 */
export function macdHist(values: number[], fast = 12, slow = 26, signal = 9): number[] {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const dif = values.map((_, i) => f[i] - s[i]);
  const dea = ema(dif, signal);
  return dif.map((v, i) => v - dea[i]);
}

/** 最近一次柱狀體翻正（>0）或翻負（<0）是幾天前；超過 within 天或沒有 → null。 */
export function crossAgo(hist: number[], within: number): { days: number; up: boolean } | null {
  for (let k = 0; k < Math.min(within, hist.length - 1); k++) {
    const i = hist.length - 1 - k;
    if (hist[i] > 0 && hist[i - 1] <= 0) return { days: k, up: true };
    if (hist[i] < 0 && hist[i - 1] >= 0) return { days: k, up: false };
  }
  return null;
}

// ------------------------------------------------------------------ 規則
function mk(id: string, cat: Cat, name: string, side: Side, text: string): Check {
  return { id, cat, name, side, text };
}
const NA = (id: string, cat: Cat, name: string) => mk(id, cat, name, 'na', '沒有資料');

export function evaluate(h: StockHistory): Check[] {
  const cfg = uiConfig.bull_bear;
  const m = (h.metrics ?? {}) as Record<string, unknown>;
  const g = (k: string) => num(m[k]);
  const out: Check[] = [];

  // ---------- 基本面
  {
    const c = cfg.fundamental;
    const cat: Cat = 'fund';
    const y3 = g('revenue_yoy_3m');
    out.push(y3 === null ? NA('rev_yoy', cat, '近 3 月營收年增率')
      : mk('rev_yoy', cat, '近 3 月營收年增率', y3 >= c.revenue_yoy_good ? 'bull' : y3 <= c.revenue_yoy_bad ? 'bear' : 'neutral',
        `近 3 月營收年${y3 >= 0 ? '增' : '減'} ${pct(y3)}`));
    const hi = g('revenue_high_ratio');
    out.push(hi === null ? NA('rev_high', cat, '月營收位置')
      : mk('rev_high', cat, '月營收位置', hi >= 100 ? 'bull' : 'neutral', hi >= 100 ? '最新月營收創 12 個月新高' : `最新月營收為 12 個月高點的 ${INT.format(hi)}%`));
    const gm = g('revenue_growth_months');
    out.push(gm === null ? NA('rev_streak', cat, '營收連續年增')
      : mk('rev_streak', cat, '營收連續年增', gm >= c.growth_months ? 'bull' : 'neutral', gm > 0 ? `連續 ${INT.format(gm)} 個月年增` : '最新一個月沒有年增'));
    const roe = g('roe');
    out.push(roe === null ? NA('roe', cat, 'ROE')
      : mk('roe', cat, 'ROE', roe >= c.roe_good ? 'bull' : roe <= c.roe_bad ? 'bear' : 'neutral', `ROE ${F1.format(roe)}%`));
    const pe = g('pe_percentile');
    out.push(pe === null ? NA('pe_pct', cat, '本益比位置')
      : mk('pe_pct', cat, '本益比位置', pe <= c.pe_low_pct ? 'bull' : pe >= c.pe_high_pct ? 'bear' : 'neutral',
        `本益比位於自身 3 年第 ${INT.format(pe)} 百分位${pe <= c.pe_low_pct ? '（相對低）' : pe >= c.pe_high_pct ? '（相對高）' : ''}`));
    const fp = g('fair_position');
    out.push(fp === null ? NA('fair', cat, '合理價區間')
      : mk('fair', cat, '合理價區間', fp <= 0 ? 'bull' : fp >= 100 ? 'bear' : 'neutral',
        fp <= 0 ? '股價低於便宜價' : fp >= 100 ? '股價高於昂貴價' : `股價位於便宜價與昂貴價之間（${INT.format(fp)}%）`));
    const dy = g('dividend_yield');
    out.push(dy === null ? NA('yield', cat, '殖利率')
      : mk('yield', cat, '殖利率', dy >= c.yield_good ? 'bull' : 'neutral', `殖利率 ${F2.format(dy)}%`));
    const q = (h.quarters as { period: string; gross_margin: N }[] | null | undefined) ?? [];
    const lastQ = q[q.length - 1];
    const prevY = lastQ ? q.find((x) => x.period === `${Number(lastQ.period.slice(0, 4)) - 1}${lastQ.period.slice(4)}`) : undefined;
    const gm0 = num(lastQ?.gross_margin);
    const gm1 = num(prevY?.gross_margin);
    out.push(gm0 === null || gm1 === null ? NA('gm', cat, '毛利率（與去年同季）')
      : mk('gm', cat, '毛利率（與去年同季）', gm0 - gm1 >= c.gross_margin_pp ? 'bull' : gm0 - gm1 <= -c.gross_margin_pp ? 'bear' : 'neutral',
        `${lastQ.period} 毛利率 ${F1.format(gm0)}%，${gm0 >= gm1 ? '較去年同季增加' : '較去年同季減少'} ${F1.format(Math.abs(gm0 - gm1))} 個百分點`));
  }

  // ---------- 籌碼面
  {
    const c = cfg.chip;
    const cat: Cat = 'chip';
    for (const [id, key, who] of [['foreign', 'foreign_streak', '外資'], ['trust', 'trust_streak', '投信']] as const) {
      const s = g(key);
      out.push(s === null ? NA(id, cat, `${who}連買／連賣`)
        : mk(id, cat, `${who}連買／連賣`, s >= c.streak_days ? 'bull' : s <= -c.streak_days ? 'bear' : 'neutral',
          s === 0 ? `${who}最近一日沒有買賣超` : `${who}連${s > 0 ? '買' : '賣'} ${INT.format(Math.abs(s))} 日`));
    }
    const chip = (h.chip as ChipBlock | null | undefined) ?? null;
    let insti: N = null;
    if (chip) {
      let net = 0;
      let vol = 0;
      let days = 0;
      for (let i = Math.max(1, chip.d.length - c.insti_days); i < chip.d.length; i++) {
        const t = num(chip.tot[i]);
        const v = num(chip.v[i]);
        if (t === null || !v) continue;
        net += t;
        vol += v;
        days++;
      }
      insti = days && vol ? (net / vol) * 100 : null;
    }
    out.push(insti === null ? NA('insti', cat, `三大法人近 ${c.insti_days} 日`)
      : mk('insti', cat, `三大法人近 ${c.insti_days} 日`, insti >= c.insti_pct ? 'bull' : insti <= -c.insti_pct ? 'bear' : 'neutral',
        `三大法人近 ${c.insti_days} 日合計${insti >= 0 ? '買超' : '賣超'}，佔成交量 ${pct(insti)}`));
    const mc = g('margin_change_5d');
    const pc = g('price_change_5d');
    out.push(mc === null || pc === null ? NA('margin', cat, '融資與股價')
      : mk('margin', cat, '融資與股價', mc <= -c.margin_pct && pc > 0 ? 'bull' : mc >= c.margin_pct && pc < 0 ? 'bear' : 'neutral',
        `融資 5 日${mc >= 0 ? '增加' : '減少'} ${pct(mc)}，股價${pc >= 0 ? '上漲' : '下跌'} ${pct(pc)}${mc <= -c.margin_pct && pc > 0 ? '（籌碼沉澱）' : mc >= c.margin_pct && pc < 0 ? '（融資增加但股價下跌）' : ''}`));
    const wc = g('whale_change');
    out.push(wc === null ? NA('whale', cat, '千張大戶週變化')
      : mk('whale', cat, '千張大戶週變化', wc >= c.whale_pp ? 'bull' : wc <= -c.whale_pp ? 'bear' : 'neutral',
        `千張大戶持股週${wc >= 0 ? '增加' : '減少'} ${F2.format(Math.abs(wc))} 個百分點`));
  }

  // ---------- 量價面
  {
    const c = cfg.price_volume;
    const cat: Cat = 'pv';
    const pc = g('price_change_5d');
    const vr = g('volume_ratio_20');
    out.push(pc === null || vr === null ? NA('pv', cat, '價量配合')
      : mk('pv', cat, '價量配合', vr >= c.volume_ratio && pc > 0 ? 'bull' : vr >= c.volume_ratio && pc < 0 ? 'bear' : 'neutral',
        `近 5 日${pc >= 0 ? '上漲' : '下跌'} ${pct(pc)}，成交量為 20 日均量的 ${F1.format(vr)} 倍`));
    const dh = g('dist_52w_high');
    out.push(dh === null ? NA('high', cat, '距 52 週高點')
      : mk('high', cat, '距 52 週高點', dh >= c.near_high_pct ? 'bull' : dh <= c.far_high_pct ? 'bear' : 'neutral',
        dh >= 0 ? '創 52 週新高' : `距 52 週高點 ${pct(dh)}`));
    const rs = g('rs_percentile');
    out.push(rs === null ? NA('rs', cat, '相對強弱（RS）')
      : mk('rs', cat, '相對強弱（RS）', rs >= c.rs_strong ? 'bull' : rs <= c.rs_weak ? 'bear' : 'neutral', `RS 百分位 ${INT.format(rs)}${rs >= c.rs_strong ? '（相對強勢）' : rs <= c.rs_weak ? '（相對弱勢）' : ''}`));
    const dt = lastOf(h.dt);
    out.push(dt === null ? NA('daytrade', cat, '當沖比率')
      : mk('daytrade', cat, '當沖比率', dt >= c.daytrade_high ? 'bear' : 'neutral', `當沖比率 ${F1.format(dt)}%${dt >= c.daytrade_high ? '，短線交易偏多' : ''}`));
  }

  // ---------- 技術面（還原價）
  {
    const c = cfg.technical;
    const cat: Cat = 'tech';
    const g20 = g('ma20_gap');
    const g60 = g('ma60_gap');
    out.push(g20 === null || g60 === null ? NA('ma', cat, '月線與季線')
      : mk('ma', cat, '月線與季線', g20 > 0 && g60 > 0 ? 'bull' : g20 < 0 && g60 < 0 ? 'bear' : 'neutral',
        g20 > 0 && g60 > 0 ? '站上月線與季線' : g20 < 0 && g60 < 0 ? '跌破月線與季線' : `${g20 >= 0 ? '在月線之上' : '在月線之下'}、${g60 >= 0 ? '在季線之上' : '在季線之下'}`));
    const g240 = g('ma240_gap');
    out.push(g240 === null ? NA('ma240', cat, '年線')
      : mk('ma240', cat, '年線', g240 > 0 ? 'bull' : g240 < 0 ? 'bear' : 'neutral', `${g240 >= 0 ? '在年線之上' : '在年線之下'} ${pct(g240)}`));
    const closes = adjClose(h).filter((v): v is number => v !== null);
    const s5 = sma(closes, 5).at(-1) ?? null;
    const s10 = sma(closes, 10).at(-1) ?? null;
    const s20 = sma(closes, 20).at(-1) ?? null;
    out.push(s5 === null || s10 === null || s20 === null ? NA('align', cat, '均線排列')
      : mk('align', cat, '均線排列', s5 > s10 && s10 > s20 ? 'bull' : s5 < s10 && s10 < s20 ? 'bear' : 'neutral',
        s5 > s10 && s10 > s20 ? '5、10、20 日均線多頭排列' : s5 < s10 && s10 < s20 ? '5、10、20 日均線空頭排列' : '5、10、20 日均線糾結'));
    const r = rsi(closes, c.rsi_period);
    out.push(r === null ? NA('rsi', cat, `RSI（${c.rsi_period}）`)
      : mk('rsi', cat, `RSI（${c.rsi_period}）`, r >= c.rsi_hot ? 'bear' : r <= c.rsi_cold ? 'bull' : 'neutral',
        `RSI ${INT.format(r)}${r >= c.rsi_hot ? '，短線過熱' : r <= c.rsi_cold ? '，短線超賣' : ''}`));
    const [f, s, sg] = c.macd;
    if (closes.length < s + sg) out.push(NA('macd', cat, 'MACD'));
    else {
      const hist = macdHist(closes, f, s, sg);
      const last = hist[hist.length - 1];
      const x = crossAgo(hist, c.cross_days);
      const cross = x ? `（${x.days === 0 ? '今天' : `${x.days} 日前`}${x.up ? '黃金交叉' : '死亡交叉'}）` : '';
      out.push(mk('macd', cat, 'MACD', last > 0 ? 'bull' : last < 0 ? 'bear' : 'neutral', `MACD 柱狀體${last > 0 ? '為正' : last < 0 ? '為負' : '為零'}${cross}`));
    }
  }
  return out;
}

export interface Tally { bull: number; bear: number; neutral: number; na: number }

export function tally(checks: Check[]): Tally {
  const t: Tally = { bull: 0, bear: 0, neutral: 0, na: 0 };
  for (const c of checks) t[c.side]++;
  return t;
}

/** 標題：「多方 6 項、空方 4 項」 */
export function title(t: Tally): string {
  return `多方 ${t.bull} 項、空方 ${t.bear} 項`;
}

/** 結論句：檢查了幾項、多空各幾項、主要集中在哪一面（中性字眼）。 */
export function summary(checks: Check[]): string {
  const t = tally(checks);
  const judged = checks.length - t.na;
  const where = (side: 'bull' | 'bear') => {
    const counts = CATS.map((c) => ({ c, n: checks.filter((x) => x.cat === c && x.side === side).length })).filter((x) => x.n > 0);
    if (!counts.length) return '';
    const max = Math.max(...counts.map((x) => x.n));
    return counts.filter((x) => x.n === max).map((x) => CAT_NAME[x.c]).join('與');
  };
  let s = `有資料的 ${judged} 項條件中，多方 ${t.bull} 項、空方 ${t.bear} 項、中性 ${t.neutral} 項`;
  const b = where('bull');
  const r = where('bear');
  if (b) s += `；多方集中在${b}`;
  if (r) s += `；空方集中在${r}`;
  return s;
}
