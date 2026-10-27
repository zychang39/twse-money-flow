/**
 * 報酬拆解（2026-10-27；探索 › 報酬拆解；定義見 METHODOLOGY §4.12；資料 pipeline/derive/attribution.py）。純函式，可測。
 *
 * 三層：市場 Beta（CAPM 的 β ×（大盤 − 無風險））→ 因子與產業（同業籃子扣掉自己的市場 Beta、規模、價值、動能、獲利、低波動）
 * → Alpha（剩下的）。期間拆解用各月報酬加總（各層可以相加），另附複利的實際報酬。
 */
import type { AttrFactorKey, AttrFactors, AttrModel, AttrStock } from '../data/types';

export const ATTR_PERIODS = [['3', '3 個月'], ['6', '6 個月'], ['12', '1 年'], ['24', '2 年']] as const;
export type AttrPeriod = (typeof ATTR_PERIODS)[number][0];
export const FACTOR_KEYS: AttrFactorKey[] = ['smb', 'hml', 'umd', 'rmw', 'lv'];
/** 畫面用的短名稱（完整定義在因子分段） */
export const FACTOR_SHORT: Record<AttrFactorKey, string> = { smb: '規模', hml: '價值', umd: '動能', rmw: '獲利', lv: '低波動' };

type N = number | null | undefined;
const ok = (v: N): v is number => typeof v === 'number' && Number.isFinite(v);

/** 期間涵蓋的月份位置（最後 n 個月；最後一個月可能還沒過完） */
export function periodRange(f: AttrFactors, months: number): number[] {
  const n = f.months.length;
  return Array.from({ length: Math.min(months, n - 1) }, (_, i) => n - Math.min(months, n - 1) + i);
}

/** 複利報酬；任一個月缺值 → null */
export function compound(series: N[], idx: number[]): number | null {
  let v = 1;
  for (const i of idx) {
    const r = series[i];
    if (!ok(r)) return null;
    v *= 1 + r;
  }
  return v - 1;
}

const sum = (series: N[], idx: number[]): number | null => {
  let s = 0;
  for (const i of idx) {
    const r = series[i];
    if (!ok(r)) return null;
    s += r;
  }
  return s;
};

export interface Rulers {
  stock: number | null;
  market: number | null;
  peer: number | null;
  style: number | null;
  styleLabel: string | null;
}

/** 三把尺（複利）：大盤（報酬指數）、同業籃子、同風格籃子（期初的規模 × 價值分組） */
export function rulers(f: AttrFactors, s: AttrStock, idx: number[]): Rulers {
  const g = idx.length ? s.style[idx[0]] : null;
  return {
    stock: compound(s.r, idx),
    market: compound(f.mkt, idx),
    peer: compound(s.peer, idx),
    style: g === null || g === undefined ? null : compound(f.style_ret[g], idx),
    styleLabel: g === null || g === undefined ? null : f.style_labels[g] ?? null,
  };
}

export interface Decomp {
  /** 各月報酬加總（各層加起來等於這個數） */
  total: number;
  /** 複利的實際報酬 */
  compound: number | null;
  rf: number;
  market: number;
  /** 產業（同業籃子扣掉自己的市場 Beta）；沒有多因子模型時 null */
  ind: number | null;
  factors: Partial<Record<AttrFactorKey, number>>;
  /** 剩下的（＝跟選股判斷有關的部分，混著運氣） */
  alpha: number;
  /** 只用 CAPM 時的 Alpha（模型越完整，Alpha 越少） */
  alphaCapm: number;
  beta: number;
  /** 期間內缺資料而沒算到的因子 */
  missing: AttrFactorKey[];
}

/** 期間拆解；個股或大盤在期間內缺值、或沒有 CAPM（不足 24 個月）→ null */
export function decompose(f: AttrFactors, s: AttrStock, idx: number[]): Decomp | null {
  const total = sum(s.r, idx);
  const rf = sum(f.rf, idx);
  const mk = sum(f.mkt, idx);
  const beta = s.capm?.b.mkt;
  if (total === null || rf === null || mk === null || !ok(beta)) return null;
  const market = beta * (mk - rf);
  const alphaCapm = total - rf - market;
  const full = s.full;
  const factors: Partial<Record<AttrFactorKey, number>> = {};
  const missing: AttrFactorKey[] = [];
  let ind: number | null = null;
  if (full) {
    const bi = full.b.ind;
    const si = sum(s.ind, idx);
    ind = ok(bi) && si !== null ? bi * si : null;
    for (const k of FACTOR_KEYS) {
      const b = full.b[k];
      if (!ok(b)) continue;
      const fk = sum(f.f[k], idx);
      if (fk === null) missing.push(k);
      else factors[k] = b * fk;
    }
  }
  const layer2 = (ind ?? 0) + Object.values(factors).reduce((a, b) => a + (b ?? 0), 0);
  return {
    total, compound: compound(s.r, idx), rf, market, ind, factors,
    alpha: full ? alphaCapm - layer2 : alphaCapm, alphaCapm, beta, missing,
  };
}

/** 年化 Alpha（月 α × 12） */
export const annualAlpha = (m: AttrModel | null): number | null => (m && ok(m.alpha) ? m.alpha * 12 : null);

/**
 * 要多少年的月資料，才能在統計上分辨這個 Alpha（t ≥ 2）：n ＝（2 × 殘差標準差 ÷ |α|）² 個月。
 * α 幾乎為 0 → Infinity（分不出來）。
 */
export function yearsToTell(m: AttrModel | null): number | null {
  if (!m || !ok(m.alpha) || !ok(m.resid_sd)) return null;
  if (Math.abs(m.alpha) < 1e-6) return Infinity;
  return ((2 * m.resid_sd) / Math.abs(m.alpha)) ** 2 / 12;
}

/** 曝險的白話（|t| ≥ 2 才說；其餘「不明顯」） */
export function exposureText(key: string, b: N, t: N): string | null {
  if (!ok(b)) return null;
  if (key === 'mkt') return b >= 1.2 ? '比大盤敏感' : b <= 0.8 ? '比大盤溫和' : '跟大盤差不多';
  if (!ok(t) || Math.abs(t) < 2) return '不明顯';
  const pos = b > 0;
  switch (key) {
    case 'ind': return pos ? '跟同業同進退' : '跟同業反向';
    case 'smb': return pos ? '偏小型股' : '偏大型股';
    case 'hml': return pos ? '偏便宜（價值）' : '偏昂貴（成長）';
    case 'umd': return pos ? '偏近期強勢' : '偏近期弱勢';
    case 'rmw': return pos ? '偏高獲利' : '偏低獲利';
    case 'lv': return pos ? '偏低波動' : '偏高波動';
    default: return null;
  }
}

export interface FactorTrend { key: AttrFactorKey; r1: number | null; r3: number | null; r12: number | null; tailwind: boolean | null }

/** 因子順逆風：近 1／3／12 個月報酬；近 12 個月為正＝順風（Ehsani & Linnainmaa 2022 的因子動能） */
export function factorTrend(f: AttrFactors, key: AttrFactorKey): FactorTrend {
  const s = f.f[key];
  const r = (m: number) => compound(s, periodRange(f, m));
  const r12 = r(12);
  return { key, r1: r(1), r3: r(3), r12, tailwind: r12 === null ? null : r12 > 0 };
}

/** 兩個因子月報酬的相關（重疊的月份 ≥ 12 才算） */
export function factorCorr(f: AttrFactors, a: AttrFactorKey, b: AttrFactorKey): number | null {
  const xs: number[] = [];
  const ys: number[] = [];
  f.months.forEach((_, i) => {
    const x = f.f[a][i];
    const y = f.f[b][i];
    if (ok(x) && ok(y)) { xs.push(x); ys.push(y); }
  });
  if (xs.length < 12) return null;
  const mx = xs.reduce((p, v) => p + v, 0) / xs.length;
  const my = ys.reduce((p, v) => p + v, 0) / ys.length;
  let sxy = 0; let sxx = 0; let syy = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
  return sxx > 1e-12 && syy > 1e-12 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** 各把尺的貼合度（月報酬 R²），由高到低；同業籃子排第一時代表比族群分組貼近 */
export function rulerFit(s: AttrStock): { key: string; label: string; r2: number }[] {
  const labels: Record<string, string> = { market: '大盤（報酬指數）', official: '官方產業（等權）', fine: '主要細產業（族群）', peer: '同業籃子' };
  return Object.entries(s.fit)
    .filter((e): e is [string, { r2: number; n: number }] => !!e[1] && ok(e[1].r2))
    .map(([key, v]) => ({ key, label: labels[key] ?? key, r2: v.r2 }))
    .sort((a, b) => b.r2 - a.r2);
}
