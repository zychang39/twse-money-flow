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

export function momentumTone(m: MomentumFacts): '強' | '弱' | '中性' | null {
  if (m.rs === null) return null;
  const known = m.ma.filter((x) => x.above !== null);
  const allAbove = known.length > 0 && known.every((x) => x.above);
  const allBelow = known.length > 0 && known.every((x) => !x.above);
  if (m.rs >= 70 && allAbove) return '強';
  if (m.rs <= 30 || allBelow) return '弱';
  return '中性';
}

function streakPhrase(name: string, s: number): string | null {
  if (Math.abs(s) < 3) return null;
  return `${name}連${s > 0 ? '買' : '賣'} ${Math.abs(s)} 日`;
}

export function valuationPhrase(pePct: N): string | null {
  if (pePct === null) return null;
  const p = Math.round(pePct);
  if (p <= 20) return `本益比位於 3 年第 ${p} 百分位（偏低）`;
  if (p >= 80) return `本益比位於 3 年第 ${p} 百分位（偏高）`;
  return `本益比位於 3 年第 ${p} 百分位（中段）`;
}

export function conclusionLine(style: InvestStyle, x: VerdictInput): string {
  const parts: string[] = [];
  if (style === 'swing') {
    const t = momentumTone(x.mom);
    if (t) parts.push(`動能${t === '中性' ? '中性' : `偏${t}`}（RS ${Math.round(x.mom.rs!)}${x.mom.alignment === 'bull' ? '、均線多頭排列' : x.mom.alignment === 'bear' ? '、均線空頭排列' : ''}）`);
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
