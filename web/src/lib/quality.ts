/**
 * 生意體質（2026-11；DECISIONS #470）：個股檔 quality 區塊的型別與「一句話結論」（純函式）。
 * 數字全部由 pipeline/derive/quality.py 算好；這裡只負責文字、圖表序列與全市場彙整，不重算 ROIC。
 * 用語：只描述位置與事實（高於／接近／低於門檻），不寫該不該交易。
 */
import { qualityConfig, type BizKind } from './config';
import { fmtNum, MINUS } from './format';

type N = number | null | undefined;
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** [年度, ROIC %, 營收（億）, 營業利益率 %] */
export type QualityYear = [number, number | null, number | null, number | null];
export interface Quality {
  /** ok＝可以計算；fin＝金融業（報表沒有營業利益與流動負債）；none＝還沒有資料（例：舊財報檔尚未補抓新欄位、ETF） */
  status: 'ok' | 'fin' | 'none';
  period?: string;
  hurdle?: number;
  roic?: number | null;
  spread?: number | null;
  band?: 'above' | 'near' | 'below';
  op_margin?: number | null;
  nopat_margin?: number | null;
  turnover?: number | null;
  roe?: number | null;
  gap?: number | null;
  years?: QualityYear[];
  /** 最新一季不是第 4 季時的近四季：[期別, ROIC, 營收（億）, 營業利益率] */
  ttm?: [string, number | null, number | null, number | null] | null;
  n_years?: number;
  first_year?: number | null;
  median?: number | null;
  min?: number | null;
  max?: number | null;
  down_years?: number;
  rev_growth5?: number | null;
  incr_roic?: number | null;
  type?: 'steady' | 'cyclical' | 'fading' | null;
  /** ROIC 在全市場可計算者的百分位（0–100） */
  pct?: number;
  /** 盈餘配發（M5；上市公司）：[股利年度, 每股現金股利, 配發率 %] */
  payout?: [number, number | null, number | null][];
}

export const HURDLE = qualityConfig.hurdle_pct;
export const MIN_YEARS = qualityConfig.history.min_years;

export function qualityOf(h: Record<string, unknown> | null | undefined): Quality {
  const q = h?.quality as Quality | undefined;
  return q && typeof q === 'object' && typeof q.status === 'string' ? q : { status: 'none' };
}

/** 類型（有的話）優先，其次高於／接近／低於門檻；金融業 fin；沒有資料 null */
export function kindOf(q: Quality): BizKind | null {
  if (q.status === 'fin') return 'fin';
  if (q.status !== 'ok') return null;
  return q.type ?? q.band ?? null;
}
export const isKind = (v: unknown): v is BizKind => typeof v === 'string' && v in qualityConfig.labels;
export const kindName = (k: BizKind | null | undefined): string => (k && qualityConfig.labels[k] ? qualityConfig.labels[k].name : '資料累積中');
export const kindRule = (k: BizKind | null | undefined): string | null => (k && qualityConfig.labels[k] ? qualityConfig.labels[k].rule : null);

const num = (v: number, d = 1) => fmtNum(v, d);
const yuan = (v: number) => fmtNum(Math.abs(v), Math.abs(v) < 10 ? 1 : 0);

/** 賺不賺錢：每投入 100 元一年賺回多少、和門檻的關係 */
export function earnSentence(q: Quality): string {
  if (q.status === 'fin') return ok(q.roe) ? `金融業改看 ROE ${num(q.roe)}%` : '金融業不算 ROIC，改看 ROE';
  if (q.status !== 'ok' || !ok(q.roic)) return '資料累積中';
  if (q.roic < 0) return `本業虧損：每投入 100 元，一年虧 ${yuan(q.roic)} 元`;
  const rel = q.band === 'above' ? '高於' : q.band === 'below' ? '低於' : '接近';
  return `每投入 100 元，一年賺回 ${yuan(q.roic)} 元，${rel} ${num(q.hurdle ?? HURDLE, 0)} 元的門檻`;
}

/** 資料累積中的說明（原則 5：說明原因、不留白）；年度足夠時回傳 null */
export function historyGap(q: Quality): string | null {
  const n = q.n_years ?? 0;
  if (n >= MIN_YEARS) return null;
  if (!n) return '資料累積中：還沒有完整年度的財報';
  return `資料累積中：目前只有 ${n} 年（自 ${q.first_year} 年起），滿 ${MIN_YEARS} 年才分類`;
}

/** 能賺多久：年度 ROIC 的範圍與走向 */
export function lastSentence(q: Quality): string {
  if (q.status !== 'ok') return '資料累積中';
  const gap = historyGap(q);
  if (gap) return gap;
  const n = q.n_years ?? 0;
  const span = ok(q.min) && ok(q.max) ? `最低 ${num(q.min)}%、最高 ${num(q.max)}%` : '';
  if (q.type === 'steady') return `近 ${n} 年都在門檻以上，最低 ${ok(q.min) ? num(q.min) : MINUS}%`;
  if (q.type === 'cyclical') return `跟著景氣升降：近 ${n} 年${span}`;
  if (q.type === 'fading') return `營收成長，但 ROIC 連 ${q.down_years} 年下滑`;
  return ok(q.median) ? `近 ${n} 年中位數 ${num(q.median)}%（${span}）` : `近 ${n} 年${span}`;
}

/** ROE 與 ROIC 的差距：差距大＝ROE 被負債、租賃或業外放大（或拉低） */
export const GAP_WIDE = 5;
export function gapSentence(q: Quality): string | null {
  if (!ok(q.gap) || !ok(q.roe)) return null;
  const g = Math.abs(q.gap);
  // 差距的數字在列的右邊；這裡只補 ROE 與可能的原因，不重複同一個數字
  if (g < GAP_WIDE) return `ROE ${num(q.roe)}%，和 ROIC 接近，報酬不是靠舉債放大`;
  return q.gap > 0 ? `ROE ${num(q.roe)}%：負債、租賃或業外收益放大了 ROE` : `ROE ${num(q.roe)}%：業外損失或閒置資金拉低了股東報酬`;
}

/** 新增投入的報酬：下一塊錢還賺不賺 */
export function incrSentence(q: Quality): string {
  if (!ok(q.incr_roic)) return '投入資本近 3 年沒有明顯增加，或資料不足 3 年';
  const h = q.hurdle ?? HURDLE;
  return `近 3 年多投入的資本，報酬${q.incr_roic >= h ? '高於' : '低於'}門檻 ${num(h, 0)}%`;
}

export const TTM_LABEL = '近四季';
/** 圖表序列：年度由舊到新，最後接近四季（不是第 4 季時）。同一張圖只有 ROIC 與門檻（同單位，一個 Y 軸）；營收另外一張 */
export function qualitySeries(q: Quality): { labels: string[]; roic: (number | null)[]; revenue: (number | null)[]; margin: (number | null)[]; hurdle: number[] } {
  const rows: [string, number | null, number | null, number | null][] = (q.years ?? []).map(([y, r, rev, m]) => [String(y), r, rev, m]);
  // 最後一點是近四季（不是完整年度），標籤寫「近四季」，不和年度混在一起
  if (q.ttm) rows.push([TTM_LABEL, q.ttm[1], q.ttm[2], q.ttm[3]]);
  const h = q.hurdle ?? HURDLE;
  return { labels: rows.map((r) => r[0]), roic: rows.map((r) => r[1]), revenue: rows.map((r) => r[2]), margin: rows.map((r) => r[3]), hurdle: rows.map(() => h) };
}

/** 圖表的無障礙摘要（一句話） */
export function seriesSummary(q: Quality): string {
  const s = qualitySeries(q);
  const v = s.roic.filter(ok);
  if (!v.length) return '沒有年度 ROIC 資料';
  const last = s.labels[s.labels.length - 1];
  return `${s.labels[0]} 年到${last === TTM_LABEL ? last : ` ${last} 年`}的 ROIC：最低 ${num(Math.min(...v))}%、最高 ${num(Math.max(...v))}%、最新 ${num(v[v.length - 1])}%；門檻 ${num(q.hurdle ?? HURDLE, 0)}%`;
}

// ---------------------------------------------------------------- 市場與生意的落差（個股總覽）
export type Tier = '前段' | '中段' | '後段';
export const tierOf = (pct: N): Tier | null => (!ok(pct) ? null : pct >= 67 ? '前段' : pct >= 34 ? '中段' : '後段');

export interface MarketVsBiz { market: number | null; biz: number | null; text: string }
/** 市場怎麼看＝動能分與籌碼分的平均（0–100）；生意本身＝ROIC 的全市場百分位。只描述位置。 */
export function marketVsBiz(momentum: N, chip: N, q: Quality): MarketVsBiz | null {
  if (q.status !== 'ok' || !ok(q.pct)) return null;
  const parts = [momentum, chip].filter(ok);
  const market = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
  const bt = tierOf(q.pct);
  const mt = tierOf(market);
  const text = mt ? (bt === mt ? `生意與市場熱度都在${bt}` : `生意排在${bt}，市場熱度在${mt}`) : `生意排在${bt}`;
  return { market, biz: q.pct, text };
}

// ---------------------------------------------------------------- 全市場（探索 › 生意體質）
export interface BizRow { code: string; name: string; roic: number; chg: number | null; rev: number | null; roe: number | null; gap: number | null; kind: BizKind | null; pct: number | null }
export type Quad = 'up_up' | 'up_down' | 'down_up' | 'down_down';
/** 四個走向（營收 3 年變化 × ROIC 3 年變化）：名稱直接寫出條件 */
export const QUADS: { id: Quad; name: string }[] = [
  { id: 'up_up', name: '營收增・報酬升' },
  { id: 'up_down', name: '營收增・報酬降' },
  { id: 'down_up', name: '營收減・報酬升' },
  { id: 'down_down', name: '營收減・報酬降' },
];
export function quadOf(r: Pick<BizRow, 'chg' | 'rev'>): Quad | null {
  if (!ok(r.chg) || !ok(r.rev)) return null;
  return `${r.rev >= 0 ? 'up' : 'down'}_${r.chg >= 0 ? 'up' : 'down'}` as Quad;
}

type Loose = Record<string, unknown>;
/** summary 的列 → 生意體質列（沒有 ROIC 的不列入：金融業、ETF、資料累積中） */
export function bizRows(rows: Loose[]): BizRow[] {
  const n = (v: unknown) => (ok(v) ? v : null);
  return rows.filter((r) => ok(r.roic)).map((r) => ({
    code: String(r.code), name: String(r.name ?? r.code), roic: r.roic as number, chg: n(r.roic_chg3), rev: n(r.revenue_chg_3y),
    roe: n(r.roe), gap: n(r.roe_roic_gap), kind: isKind(r.biz_type) ? r.biz_type : null, pct: n(r.roic_pct),
  }));
}

export interface BizOverview { total: number; above: number; near: number; below: number; quads: Record<Quad, number>; kinds: Partial<Record<BizKind, number>>; unclassified: number }
export function bizOverview(rows: BizRow[]): BizOverview {
  const { hurdle_pct: h, near_band: b } = qualityConfig;
  const out: BizOverview = { total: rows.length, above: 0, near: 0, below: 0, quads: { up_up: 0, up_down: 0, down_up: 0, down_down: 0 }, kinds: {}, unclassified: 0 };
  for (const r of rows) {
    if (r.roic >= h + b) out.above += 1; else if (r.roic <= h - b) out.below += 1; else out.near += 1;
    const quad = quadOf(r);
    if (quad) out.quads[quad] += 1; else out.unclassified += 1;
    if (r.kind) out.kinds[r.kind] = (out.kinds[r.kind] ?? 0) + 1;
  }
  return out;
}

/** 全市場一句話：營收成長的公司裡，有幾成報酬率在下滑 */
export function overviewSentence(o: BizOverview): string {
  const growing = o.quads.up_up + o.quads.up_down;
  if (!o.total) return '資料累積中：還沒有可以計算 ROIC 的公司';
  if (!growing) return `${fmtNum(o.total, 0)} 檔可計算：高於門檻 ${fmtNum(o.above, 0)} 檔`;
  const share = Math.round((o.quads.up_down / growing) * 10);
  return share <= 0 ? '營收成長的公司，報酬率大多也在上升' : `營收成長的公司裡，約 ${share} 成的報酬率在下滑`;
}
