/**
 * 大戶／散戶持股（純函式，定義見 METHODOLOGY §4.7.3）。
 * 資料：個股檔的 holders 區塊（集保股權分散表，15 個持股分級、近 52 週）。
 * 門檻只能落在集保分級的邊界（張）：1、5、10、15、20、30、40、50、100、200、400、600、800、1000。
 * - 散戶門檻 X：持有「X 張以下」（X＝1 時為「不到 1 張」，只含零股分級）。
 * - 大戶門檻 Y：持有 Y 張以上（集保分級邊界為 Y×1000+1 股起）。兩者之間為中實戶。
 * v3 全站統一分級（config/ui.yml holders.tiers）：散戶 ≤ 5 張｜中實戶｜大戶 ≥ 400 張｜千張大戶 ≥ 1,000 張。
 */
import { uiConfig } from './config';
import { numberFormat } from './format';

type N = number | null;

export interface HolderBlock {
  d: string[];
  /** n[i]／p[i]：分級 i+1 各週的人數與占集保庫存比例（%） */
  n: N[][];
  p: N[][];
  /** 各週集保總股數、總人數 */
  ts: N[];
  th: N[];
}

export type Metric = 'pct' | 'holders' | 'avg';
export const METRICS: Metric[] = ['pct', 'holders', 'avg'];
export const METRIC_NAME: Record<Metric, string> = { pct: '持股比例', holders: '人數', avg: '人均張數' };
export const METRIC_UNIT: Record<Metric, string> = { pct: '%', holders: '人', avg: '張' };

export const BREAKPOINTS = uiConfig.holders.breakpoints;
export type Group = 'small' | 'mid' | 'big';
export const GROUP_NAME: Record<Group, string> = { small: '散戶', mid: '中實戶', big: '大戶' };

/** 15 個分級的名稱（不含單位，表頭註明「張」） */
export const LEVEL_SHORT: string[] = [
  '不到 1',
  ...BREAKPOINTS.slice(0, -1).map((b, i) => `${b}–${BREAKPOINTS[i + 1]}`),
  `超過 ${BREAKPOINTS[BREAKPOINTS.length - 1]}`,
];
/** 15 個分級的名稱（張） */
export const LEVEL_LABEL: string[] = [
  '不到 1 張',
  ...BREAKPOINTS.slice(0, -1).map((b, i) => `${b}–${BREAKPOINTS[i + 1]} 張`),
  `超過 ${BREAKPOINTS[BREAKPOINTS.length - 1]} 張`,
];

/** 門檻（張）→ 散戶涵蓋的最高分級（1-based）與大戶的最低分級。 */
export function smallMaxLevel(small: number): number {
  const k = BREAKPOINTS.indexOf(small);
  if (k < 0) throw new Error(`散戶門檻必須是集保分級邊界：${small}`);
  return k + 1;
}
export function bigMinLevel(big: number): number {
  const k = BREAKPOINTS.indexOf(big);
  if (k < 0) throw new Error(`大戶門檻必須是集保分級邊界：${big}`);
  return k + 2;
}
export function groupOf(level: number, small: number, big: number): Group {
  if (level <= smallMaxLevel(small)) return 'small';
  if (level >= bigMinLevel(big)) return 'big';
  return 'mid';
}

const LOTS = numberFormat(0);

export function smallLabel(small: number): string {
  return small === BREAKPOINTS[0] ? '不到 1 張' : `≤ ${LOTS.format(small)} 張`;
}
export function bigLabel(big: number): string {
  return `≥ ${LOTS.format(big)} 張`;
}
export function groupRange(g: Group, small: number, big: number): string {
  if (g === 'small') return smallLabel(small);
  if (g === 'big') return bigLabel(big);
  return small === big ? '—' : `${small === BREAKPOINTS[0] ? 1 : small}–${big} 張`;
}

/** 門檻合法：散戶門檻 < 大戶門檻（中間至少一個分級也可以是 0 個：相鄰邊界時中實戶為空）。 */
export function clampThresholds(small: number, big: number): { small: number; big: number } {
  const B = BREAKPOINTS;
  let si = Math.max(0, B.indexOf(small));
  let bi = B.indexOf(big);
  if (bi < 0) bi = B.length - 1;
  if (si >= bi) si = Math.max(0, bi - 1);
  return { small: B[si], big: B[bi] };
}

export interface GroupWeek {
  pct: N;
  holders: N;
  /** 人均張數＝持股股數 ÷ 人數 ÷ 1,000 */
  avg: N;
}

/** 某一週、某一群的合計（任何一個分級缺值 → null）。 */
export function groupWeek(b: HolderBlock, w: number, g: Group, small: number, big: number): GroupWeek {
  let pct = 0;
  let holders = 0;
  for (let lv = 1; lv <= 15; lv++) {
    if (groupOf(lv, small, big) !== g) continue;
    const p = b.p[lv - 1]?.[w] ?? null;
    const n = b.n[lv - 1]?.[w] ?? null;
    if (p === null || n === null) return { pct: null, holders: null, avg: null };
    pct += p;
    holders += n;
  }
  const ts = b.ts[w] ?? null;
  const avg = ts !== null && holders > 0 ? (pct / 100) * ts / holders / 1000 : null;
  return { pct, holders, avg };
}

export function metricValue(g: GroupWeek, m: Metric): N {
  return m === 'pct' ? g.pct : m === 'holders' ? g.holders : g.avg;
}

/** 最近 weeks 週的索引（舊到新）。 */
export function weekRange(b: HolderBlock, weeks: number): number[] {
  const n = b.d.length;
  return Array.from({ length: Math.min(weeks, n) }, (_, i) => n - Math.min(weeks, n) + i);
}

export interface GroupSeries {
  dates: string[];
  big: N[];
  small: N[];
  mid: N[];
  /** 大戶本週相對上週的變化（比例為百分點；人數為人；人均為張） */
  bigChange: N[];
  smallChange: N[];
}

export function groupSeries(b: HolderBlock, weeks: number, small: number, big: number, m: Metric): GroupSeries {
  const idx = weekRange(b, weeks);
  const val = (g: Group, w: number) => metricValue(groupWeek(b, w, g, small, big), m);
  const change = (g: Group) => idx.map((w) => {
    if (w === 0) return null;
    const a = val(g, w);
    const p = val(g, w - 1);
    return a === null || p === null ? null : a - p;
  });
  return {
    dates: idx.map((w) => b.d[w]),
    big: idx.map((w) => val('big', w)),
    small: idx.map((w) => val('small', w)),
    mid: idx.map((w) => val('mid', w)),
    bigChange: change('big'),
    smallChange: change('small'),
  };
}

const F1 = numberFormat(1);
const F2 = numberFormat(2);
const INT = numberFormat(0);

export function metricText(v: N, m: Metric): string {
  if (v === null) return '—';
  if (m === 'pct') return `${F2.format(v)}%`;
  if (m === 'holders') return `${INT.format(Math.round(v))} 人`;
  return `${INT.format(Math.round(v))} 張`;
}

/** 變化：比例為「個百分點」，人數為「人」與 %，人均為「張」。 */
export function changeText(v: N, m: Metric): string {
  if (v === null) return '—';
  const a = Math.abs(v);
  // 四捨五入後為 0 → 不帶箭頭（M3：不出現 ▲0）
  const shown = m === 'pct' ? Number(a.toFixed(2)) : Math.round(a);
  const arrow = shown === 0 ? '' : v > 0 ? '▲' : '▼';
  if (m === 'pct') return `${arrow}${F2.format(a)} 個百分點`;
  if (m === 'holders') return `${arrow}${INT.format(shown)} 人`;
  return `${arrow}${INT.format(shown)} 張`;
}

/**
 * 結論句（規則式、中性字眼）：「大戶（超過 400 張）持股 52.34%，近 12 週增加 1.20 個百分點；散戶人數同期減少 3.1%」。
 */
export function headline(b: HolderBlock, weeks: number, small: number, big: number): string {
  const s = groupSeries(b, weeks, small, big, 'pct');
  const n = s.dates.length;
  if (!n) return '集保資料累積中';
  const last = s.big[n - 1];
  if (last === null) return '集保資料不完整';
  let out = `大戶（${bigLabel(big)}）持股 ${F2.format(last)}%`;
  const first = s.big.find((v) => v !== null) ?? null;
  if (n >= 2 && first !== null) {
    const d = last - first;
    out += Math.abs(d) < 0.005 ? `，近 ${n} 週持平` : `，近 ${n} 週${d > 0 ? '增加' : '減少'} ${F2.format(Math.abs(d))} 個百分點`;
    const h = groupSeries(b, weeks, small, big, 'holders').small;
    const h0 = h.find((v) => v !== null) ?? null;
    const h1 = h[n - 1];
    if (h0 && h1 !== null) {
      const r = ((h1 - h0) / h0) * 100;
      out += Math.abs(r) < 0.05 ? `；散戶人數同期持平` : `；散戶人數同期${r > 0 ? '增加' : '減少'} ${F1.format(Math.abs(r))}%`;
    }
  }
  return out;
}

/** 短標題：「大戶持股 52.3%・近 12 週 ▲1.2」 */
export function shortTitle(b: HolderBlock, weeks: number, small: number, big: number): string {
  const s = groupSeries(b, weeks, small, big, 'pct');
  const n = s.dates.length;
  const last = n ? s.big[n - 1] : null;
  if (last === null) return '集保資料累積中';
  const first = s.big.find((v) => v !== null) ?? null;
  const d = first === null || n < 2 ? null : last - first;
  return `大戶持股 ${F1.format(last)}%${d === null ? '' : Math.abs(d) < 0.05 ? `，近 ${n} 週持平` : `，近 ${n} 週${d > 0 ? '增加' : '減少'} ${F1.format(Math.abs(d))} 個百分點`}`;
}

/** 每週對應的收盤價：該週資料日（含）之前最後一個交易日的收盤。 */
export function alignClose(weeks: string[], d: string[], c: N[]): N[] {
  const out: N[] = [];
  let j = 0;
  let last: N = null;
  for (const w of weeks) {
    while (j < d.length && d[j] <= w) { if (c[j] !== null) last = c[j]; j++; }
    out.push(last);
  }
  return out;
}

// ------------------------------------------------------------------ v3：全站統一的四級（籌碼結構）
/**
 * M3：最上面一段的門檻在顯示層可選 400／800／1,000 張（設定頁；localStorage `tmf-whale-tier`，預設 1,000）。
 * 回測、選股、指標效度評估固定用 1,000 張（pipeline 另外預先算好 400／800 張的比例與週變化）。
 */
export type WhaleTier = 400 | 800 | 1000;
export const WHALE_TIERS: WhaleTier[] = [400, 800, 1000];
export const WHALE_KEY = 'tmf-whale-tier';
export const WHALE_EVENT = 'tmf-whale-tier';
/** 回測與選股固定使用的門檻 */
export const BACKTEST_WHALE: WhaleTier = 1000;

export function getWhaleTier(): WhaleTier {
  try {
    const v = Number(localStorage.getItem(WHALE_KEY));
    return (WHALE_TIERS as number[]).includes(v) ? (v as WhaleTier) : 1000;
  } catch {
    return 1000;
  }
}

export function setWhaleTier(v: WhaleTier): void {
  try { localStorage.setItem(WHALE_KEY, String(v)); } catch { /* 無痕模式 */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(WHALE_EVENT));
}

/** 目前的四級門檻（最上面一段依設定）。 */
export function tiers(whale: WhaleTier = getWhaleTier()): { retail_max: number; big_min: number; whale_min: number } {
  return { ...uiConfig.holders.tiers, whale_min: whale };
}
/** 舊名稱（預設 1,000 張）；畫面請用 tiers() */
export const TIERS = uiConfig.holders.tiers;
export type Tier = 'retail' | 'mid' | 'big' | 'whale';
export const TIER_ORDER: Tier[] = ['retail', 'mid', 'big', 'whale'];

/** 段名：最上面一段 1,000 張叫「千張大戶」，其他寫「800 張大戶」「400 張大戶」。 */
export function tierName(t: Tier, whale: WhaleTier = getWhaleTier()): string {
  if (t === 'whale') return whale === 1000 ? '千張大戶' : `${LOTS.format(whale)} 張大戶`;
  return { retail: '散戶', mid: '中實戶', big: '大戶' }[t];
}
export const TIER_NAME: Record<Tier, string> = { retail: '散戶', mid: '中實戶', big: '大戶', whale: '千張大戶' };

/** 目前門檻下實際出現的段（門檻 400 時「大戶」段與最上面一段重合，不另列）。 */
export function tierOrder(whale: WhaleTier = getWhaleTier()): Tier[] {
  return whale <= tiers(whale).big_min ? ['retail', 'mid', 'whale'] : TIER_ORDER;
}

/** 比例條上各段的範圍（互斥）：大戶段不含最上面一段。 */
export function tierRange(t: Tier, whale: WhaleTier = getWhaleTier()): string {
  const { retail_max: r, big_min: b, whale_min: w } = tiers(whale);
  if (t === 'retail') return `≤ ${LOTS.format(r)} 張`;
  if (t === 'mid') return `${LOTS.format(r)}–${LOTS.format(b)} 張`;
  if (t === 'big') return `${LOTS.format(b)}–${LOTS.format(w)} 張`;
  return `≥ ${LOTS.format(w)} 張`;
}

/**
 * 畫面上的定義句（2026-10-02 健檢：全站只用一種寫法）：四段互斥，與比例條、15 級分布表的段名一致：
 * 「散戶 ≤ 5 張｜中實戶 5–400 張｜大戶 400–1,000 張｜千張大戶 ≥ 1,000 張」。
 * 要講「含千張大戶」的合計時用 bigInclusiveLabel（「≥ 400 張，含千張大戶」），分級定義句不再寫「大戶 ≥ 400 張」。
 */
export function tierDefinition(whale: WhaleTier = getWhaleTier()): string {
  return tierOrder(whale).map((t) => `${tierName(t, whale)} ${tierRange(t, whale)}`).join('｜');
}

/** 含最上面一段的合計：「≥ 400 張，含千張大戶」（走勢圖的「大戶」面板標題用，外層已有括號所以不再加括號）。 */
export function bigInclusiveLabel(big: number, whale: WhaleTier = getWhaleTier()): string {
  return `≥ ${LOTS.format(big)} 張，含${tierName('whale', whale)}`;
}

/** 分級（1–15）→ 比例條上的段（互斥）。 */
export function tierOf(level: number, whale: WhaleTier = getWhaleTier()): Tier {
  const t = tiers(whale);
  if (level <= smallMaxLevel(t.retail_max)) return 'retail';
  if (level >= bigMinLevel(t.whale_min)) return 'whale';
  if (level >= bigMinLevel(t.big_min)) return 'big';
  return 'mid';
}

/** 某一週四段的合計（比例、人數、人均張數；任一分級缺值 → 該段 null）。 */
export function tierWeek(b: HolderBlock, w: number, whale: WhaleTier = getWhaleTier()): Record<Tier, GroupWeek> {
  const out = {} as Record<Tier, GroupWeek>;
  for (const t of TIER_ORDER) {
    let pct = 0;
    let holders = 0;
    let bad = false;
    for (let lv = 1; lv <= 15; lv++) {
      if (tierOf(lv, whale) !== t) continue;
      const p = b.p[lv - 1]?.[w] ?? null;
      const n = b.n[lv - 1]?.[w] ?? null;
      if (p === null || n === null) { bad = true; break; }
      pct += p;
      holders += n;
    }
    const ts = b.ts[w] ?? null;
    out[t] = bad ? { pct: null, holders: null, avg: null } : { pct, holders, avg: ts !== null && holders > 0 ? (pct / 100) * ts / holders / 1000 : null };
  }
  return out;
}

export interface TierStat {
  tier: Tier;
  pct: N;
  /** 與上週相比（百分點） */
  change: N;
  /** 連續增加（正）／減少（負）週數（比例變化 |Δ| < 0.005 視為持平，中斷連續） */
  streak: number;
}

/** 最新一週四段的比例、週變化與連續週數。 */
export function tierStats(b: HolderBlock, whale: WhaleTier = getWhaleTier()): TierStat[] {
  const n = b.d.length;
  if (!n) return [];
  const weeks = Array.from({ length: n }, (_, w) => tierWeek(b, w, whale));
  return tierOrder(whale).map((t) => {
    const pct = weeks[n - 1][t].pct;
    const prev = n >= 2 ? weeks[n - 2][t].pct : null;
    let streak = 0;
    let sign = 0;
    for (let w = n - 1; w >= 1; w--) {
      const a = weeks[w][t].pct;
      const p = weeks[w - 1][t].pct;
      if (a === null || p === null || Math.abs(a - p) < 0.005) break;
      const sg = a > p ? 1 : -1;
      if (sign === 0) sign = sg;
      if (sg !== sign) break;
      streak += sg;
    }
    return { tier: t, pct, change: pct !== null && prev !== null ? pct - prev : null, streak };
  });
}

/** 一句話結論：「千張大戶本週 +0.30 個百分點，連 3 週增加」（只有 1 週 → 只寫目前比例）。 */
export function structureSentence(b: HolderBlock, whale: WhaleTier = getWhaleTier()): string {
  const st = tierStats(b, whale);
  const name = tierName('whale', whale);
  const top = st.find((s) => s.tier === 'whale');
  if (!top || top.pct === null) return '集保資料累積中';
  if (top.change === null) return `${name}持股 ${F2.format(top.pct)}%（目前只有 1 週資料，下週起可比較週變化）`;
  const d = top.change;
  if (Math.abs(d) < 0.005) return `${name}本週持平（${F2.format(top.pct)}%）`;
  const k = Math.abs(top.streak);
  return `${name}本週 ${d > 0 ? '+' : '−'}${F2.format(Math.abs(d))} 個百分點${k >= 2 ? `，連 ${k} 週${d > 0 ? '增加' : '減少'}` : ''}`;
}
