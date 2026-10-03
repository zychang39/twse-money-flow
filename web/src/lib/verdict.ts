/**
 * 一句話結論（v3 M3）：依投資風格調整側重點；規則式、只陳述數字與現象，不給買賣建議。定義見 METHODOLOGY §4.14。
 * - 波段動能：動能（RS、均線）→ 法人連買／連賣 → 融資價量解讀。
 * - 長期投資：營收成長 → 獲利（ROE）→ 估值位置（本益比 3 年百分位）。
 */
import type { InvestStyle } from './style';
import type { MomentumFacts, ProfitFacts, RevenueFacts } from './fundamentals';
import type { PvLabel } from './credit';
import { numberFormat } from './format';

type N = number | null;
const F1 = numberFormat(1);

export interface VerdictInput {
  mom: MomentumFacts;
  foreignStreak: number;
  trustStreak: number;
  pv: PvLabel | null;
  rev: RevenueFacts;
  profit: ProfitFacts;
  /** 本益比在自身 3 年的百分位（0–100） */
  pePct: N;
}

export type LongTone = '強' | '弱' | '中性';
export type ShortPos = 'up' | 'down' | 'dip' | 'rebound' | 'na';

/**
 * 動能分成兩個時間尺度（#7；METHODOLOGY §4.14）：
 * - 長期強度：RS 百分位與年線。強＝RS ≥ 70 且（站上 240 日線或均線多頭排列）；弱＝RS ≤ 30，或跌破 240 日線且空頭排列；其餘中性。
 * - 短期位置：20／60 日線。up＝兩條都站上；down＝兩條都跌破；dip＝跌破 20、仍在 60 之上；rebound＝站上 20、仍在 60 之下。
 * 原本把兩者合成一個「中性」，會出現「動能中性（RS 88、均線多頭排列）」但同頁寫「跌破 20 日線」的矛盾。
 */
export function momentumState(m: MomentumFacts): { long: LongTone; short: ShortPos } | null {
  if (m.rs === null) return null;
  const at = (n: number) => m.ma.find((x) => x.n === n)?.above ?? null;
  const a20 = at(20), a60 = at(60), a240 = at(240);
  const long: LongTone = m.rs >= 70 && (a240 === true || m.alignment === 'bull') ? '強'
    : m.rs <= 30 || (a240 === false && m.alignment === 'bear') ? '弱' : '中性';
  const short: ShortPos = a20 === null || a60 === null ? 'na'
    : a20 && a60 ? 'up' : !a20 && !a60 ? 'down' : !a20 ? 'dip' : 'rebound';
  return { long, short };
}

const SHORT_TEXT: Record<Exclude<ShortPos, 'na'>, string> = {
  up: '短期偏強（站上 20／60 日線）',
  down: '短期轉弱（跌破 20／60 日線）',
  dip: '短期轉弱（跌破 20 日線）',
  rebound: '短期回升（站上 20 日線）',
};

/**
 * 動能子句：長短期一致時合成一句「動能偏強（RS 87、均線多頭排列）」；
 * 不一致時分開寫「長期動能強（RS 88、均線多頭排列），短期轉弱（跌破 20 日線）」。不使用買賣字眼。
 */
export function momentumPhrase(m: MomentumFacts): string | null {
  const st = momentumState(m);
  if (!st) return null;
  const facts = `RS ${Math.round(m.rs!)}${m.alignment === 'bull' ? '、均線多頭排列' : m.alignment === 'bear' ? '、均線空頭排列' : ''}`;
  if (st.long === '強' && st.short === 'up') return `動能偏強（${facts}）`;
  if (st.long === '弱' && st.short === 'down') return `動能偏弱（${facts}）`;
  const long = `長期動能${st.long}（${facts}）`;
  return st.short === 'na' ? long : `${long}，${SHORT_TEXT[st.short]}`;
}

function streakPhrase(name: string, s: number): string | null {
  if (Math.abs(s) < 3) return null;
  return `${name}連${s > 0 ? '買' : '賣'} ${Math.abs(s)} 日`;
}

/** 本益比百分位的三段：低 ≤ 20、高 ≥ 80、其餘為中（2026-10-02 健檢：全站用「低／中／高區間」，不用偏低／中段／偏高）。 */
export const PE_PCT_LOW = 20;
export const PE_PCT_HIGH = 80;
export function peBand(pePct: number): '低' | '中' | '高' {
  const p = Math.round(pePct);
  return p <= PE_PCT_LOW ? '低' : p >= PE_PCT_HIGH ? '高' : '中';
}

/**
 * 「本益比位於 3 年第 78 百分位（中區間；低 ≤ 20、高 ≥ 80）」：每一句寫自己的基準。
 * 合理價區間的滑桿是另一個基準（本益比、淨值比、殖利率三法平均），文字見 lib/fundamentals.fairPosition。
 */
export function valuationPhrase(pePct: N): string | null {
  if (pePct === null) return null;
  const p = Math.round(pePct);
  return `本益比位於 3 年第 ${p} 百分位（${peBand(p)}區間；低 ≤ ${PE_PCT_LOW}、高 ≥ ${PE_PCT_HIGH}）`;
}

export function conclusionLine(style: InvestStyle, x: VerdictInput): string {
  const parts: string[] = [];
  if (style === 'swing') {
    const mp = momentumPhrase(x.mom);
    if (mp) parts.push(mp);
    const inst = [streakPhrase('外資', x.foreignStreak), streakPhrase('投信', x.trustStreak)].filter(Boolean) as string[];
    if (inst.length) parts.push(inst.join('、'));
    if (x.pv) parts.push(`${x.pv.label}（${x.pv.tag}）`);
    if (!parts.length) return '動能與籌碼資料不足。';
  } else {
    const r = x.rev;
    if (r.latest) {
      if (r.growthMonths >= 3) parts.push(`營收連續 ${r.growthMonths} 個月年增${r.newHigh ? '、創 12 個月新高' : ''}`);
      else if (r.latest.yoy !== null) parts.push(`${Number(r.latest.ym.slice(5, 7))} 月營收年${r.latest.yoy >= 0 ? '增' : '減'} ${F1.format(Math.abs(r.latest.yoy))}%${r.newHigh ? '、創 12 個月新高' : ''}`);
    }
    if (x.profit.roe !== null) parts.push(`ROE ${F1.format(x.profit.roe)}%`);
    const v = valuationPhrase(x.pePct);
    if (v) parts.push(v);
    if (!parts.length) return '營收、獲利與估值資料不足。';
  }
  return `${parts.join('，')}。`;
}
