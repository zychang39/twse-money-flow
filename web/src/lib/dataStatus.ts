/**
 * 資料狀態頁（2026-10-02 健檢 M2）：每個資料集的來源、最新日、應有日、涵蓋率、回補進度、失敗原因。純函式，可測。
 * 「應有日」依公布時程與交易日曆推算（不是「今天」）：
 * - 每日型（行情、法人、指數、本益比、借券、當沖、外資持股、期貨法人）：最近一個交易日。
 * - 信用（融資融券）：證交所約 21:30 公布；台北時間 21:30 前的應有日是前一個交易日。
 * - 集保股權分散：每週（資料日＝該週最後營業日，週六公布）；應有日＝昨天（含）以前最近的一個週五（休市則前一交易日）。
 * - 主動式 ETF 持股：各投信隔天上午揭露；應有日＝今天的前一個交易日。
 * - 月營收：法定期限次月 10 日；10 日之後應有上個月，否則上上個月（YYYY-MM）。
 * - 季財報：Q1 5/15、Q2 8/14、Q3 11/14、Q4 3/31 之後才應有該季。
 */
import type { Health, HealthSource } from '../data/types';
import type { AsofKey } from './asof';
import { ASOF_LABEL } from './asof';
import { addDays } from './dates';
import { fmtCount, md } from './format';
import { describeSource } from './health';
import type { TradingCalendar } from './tradingCalendar';

/** 資料集 → 來源 id（config/sources.yml） */
export const DATASET_SOURCES: Record<AsofKey, string[]> = {
  quotes: ['twse_quotes', 'tpex_quotes'],
  insti: ['twse_insti', 'tpex_insti'],
  credit: ['twse_margin', 'tpex_margin'],
  valuation: ['twse_valuation', 'tpex_valuation'],
  sbl: ['twse_sbl', 'tpex_sbl'],
  daytrade: ['twse_daytrade', 'tpex_daytrade'],
  qfii: ['twse_qfii', 'tpex_qfii'],
  tdcc: ['tdcc_holders', 'tdcc_history'],
  etf_holdings: ['active_etf'],
  revenue: ['twse_revenue', 'tpex_revenue', 'mops_revenue'],
  financials: ['financials'],
  taifex: ['taifex_insti', 'taifex_oi'],
  margin_total: ['twse_margin', 'tpex_margin'], // 融資總計是融資融券回應的附表（extras），來源同信用交易
  index: ['twse_index', 'tpex_index'],
};

export const DATASET_ORDER: AsofKey[] = ['quotes', 'index', 'insti', 'credit', 'margin_total', 'valuation', 'sbl', 'daytrade', 'qfii', 'tdcc', 'etf_holdings', 'revenue', 'financials', 'taifex'];

export interface Now { today: string; hhmm: string }

/** 台北時間的今天與時刻 */
export function tpeNow(now = new Date()): Now {
  const t = new Date(now.getTime() + 8 * 3600 * 1000);
  return { today: t.toISOString().slice(0, 10), hhmm: t.toISOString().slice(11, 16) };
}

function lastTradingOnOrBefore(cal: TradingCalendar, iso: string): string {
  return cal.isTradingDay(iso) ? iso : cal.previous(iso);
}

/** 應有日（或應有月份／季度）。 */
export function expectedDate(key: AsofKey, cal: TradingCalendar, now: Now): string {
  const latestTrading = lastTradingOnOrBefore(cal, now.today);
  switch (key) {
    case 'credit':
    case 'margin_total':
      return cal.isTradingDay(now.today) && now.hhmm < '21:30' ? cal.previous(now.today) : latestTrading;
    case 'etf_holdings':
      return cal.previous(now.today);
    case 'tdcc': {
      // 昨天（含）以前最近的週五；週五休市就取前一個交易日
      let d = addDays(now.today, -1);
      while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 5) d = addDays(d, -1);
      return lastTradingOnOrBefore(cal, d);
    }
    case 'revenue': {
      const [y, m, d] = now.today.split('-').map(Number);
      const back = d > 10 ? 1 : 2;
      const mm = m - back;
      const yy = mm <= 0 ? y - 1 : y;
      const m2 = mm <= 0 ? mm + 12 : mm;
      return `${yy}-${String(m2).padStart(2, '0')}`;
    }
    case 'financials': {
      const [y, m, d] = now.today.split('-').map(Number);
      const md5 = m * 100 + d;
      if (md5 >= 1114) return `${y} Q3`;
      if (md5 >= 814) return `${y} Q2`;
      if (md5 >= 515) return `${y} Q1`;
      if (md5 >= 331) return `${y - 1} Q4`;
      return `${y - 1} Q3`;
    }
    default:
      return latestTrading;
  }
}

export type RowState = 'ok' | 'lag' | 'missing' | 'na';

export interface DatasetRow {
  key: AsofKey;
  label: string;
  sources: string[];
  latest: string | null;
  expected: string;
  state: RowState;
  /** 落後幾個交易日（每日型）或一句說明 */
  lagText: string;
  /** 涵蓋率一句話（只有集保、主動式 ETF 有） */
  coverage: string | null;
  /** 回補進度 */
  backfill: string | null;
  /** 失敗原因（來源異常時） */
  failure: string | null;
}

export interface CoverageInfo {
  tdcc?: { ratio: number; included: number; universe: number; date: string; note?: string | null } | null;
  etf?: { covered: number; total: number } | null;
}

function cmpLatest(key: AsofKey, latest: string | null, expected: string, cal: TradingCalendar): { state: RowState; lagText: string } {
  if (!latest) return { state: 'missing', lagText: '尚未取得任何資料' };
  if (key === 'revenue') {
    return latest >= expected ? { state: 'ok', lagText: '已齊' } : { state: 'lag', lagText: `應有 ${expected}，目前 ${latest}` };
  }
  if (key === 'financials') {
    return latest >= expected.replace(' Q', '-') ? { state: 'ok', lagText: '已齊' } : { state: 'lag', lagText: `應有 ${expected}` };
  }
  if (latest >= expected) return { state: 'ok', lagText: '已齊' };
  const lag = cal.tradingDaysBetween(latest, expected);
  return { state: 'lag', lagText: `落後 ${lag} 個交易日（應有 ${md(expected)}）` };
}

export function datasetRows(
  health: Health | null,
  asof: Partial<Record<string, string | null>> | undefined,
  cal: TradingCalendar,
  now: Now,
  cov: CoverageInfo = {},
): DatasetRow[] {
  const byId = new Map((health?.sources ?? []).map((s) => [s.id, s]));
  return DATASET_ORDER.map((key) => {
    const latest = asof?.[key] ?? null;
    const expected = expectedDate(key, cal, now);
    const { state, lagText } = cmpLatest(key, latest, expected, cal);
    const srcs = DATASET_SOURCES[key].map((id) => byId.get(id)).filter((s): s is HealthSource => !!s);
    const bad = srcs.map((s) => ({ s, d: describeSource(s) })).filter((x) => x.d.tone === 'risk' || x.d.tone === 'wait');
    const failure = bad.length ? bad.map((x) => `${x.s.label}：${x.d.text}${x.s.last_message && x.s.last_status === 'failed' ? `（${x.s.last_message.slice(0, 120)}）` : ''}`).join('；') : null;
    let coverage: string | null = null;
    let backfill: string | null = null;
    if (key === 'tdcc') {
      if (cov.tdcc) coverage = `最新一週（${md(cov.tdcc.date)}）${(cov.tdcc.ratio * 100).toFixed(2)}%（每日平均 ${cov.tdcc.included.toLocaleString('zh-TW')}／${cov.tdcc.universe.toLocaleString('zh-TW')} 檔）${cov.tdcc.note ? `。${cov.tdcc.note}` : ''}`;
      const bf = health?.backfill;
      if (bf?.total) {
        const done = (bf.total ?? 0) - (bf.remaining ?? 0);
        const scope = bf.codes && bf.weeks ? `、${fmtCount(bf.codes)} 檔 × ${fmtCount(bf.weeks)} 週` : '';
        const oldest = bf.oldest_week ? `（最舊 ${md(`${bf.oldest_week.slice(0, 4)}-${bf.oldest_week.slice(4, 6)}-${bf.oldest_week.slice(6, 8)}`)}）` : '';
        backfill = `全市場回補 ${fmtCount(done)}／${fmtCount(bf.total)} 次查詢（${Math.round((done / bf.total) * 100)}%）${scope}${bf.eta ? `，預計 ${bf.eta.slice(0, 16).replace('T', ' ')} 完成` : ''}；官方只保存一年${oldest}，更早的週無法取得；全市場週檔自 2026-09-24 起每週存檔`;
      }
    } else if (key === 'etf_holdings' && cov.etf) {
      coverage = `${cov.etf.covered}／${cov.etf.total} 檔主動式 ETF 有持股資料`;
    } else if (key === 'revenue') {
      const months = health?.backfilled?.mops_revenue ?? [];
      if (months.length) backfill = `月營收回補 ${months[0]}～${months[months.length - 1]}（${months.length} 個月）`;
    } else {
      const ranges = DATASET_SOURCES[key].map((id) => health?.coverage?.[id]).filter((r): r is { start?: string; end?: string } => !!r && !!r.start);
      if (ranges.length) backfill = `回補範圍 ${ranges.map((r) => `${r.start}～${r.end ?? '—'}`).join('、')}`;
    }
    return { key, label: ASOF_LABEL[key], sources: srcs.map((s) => s.label), latest, expected, state, lagText, coverage, backfill, failure };
  });
}
