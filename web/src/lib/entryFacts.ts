/**
 * 新增持倉前的事實頁（2026-10-06 重新排版；純函式）：
 * - 頂部一列「資金環境：保守／中性／積極」＋判定依據（判定規則沿用 lib/envState.envInfo，不另創）。
 * - 每項資金指標一列：名稱｜目前數值｜狀態（偏多／中性／偏空）｜資料日期（落後最新交易日時標「資料落後」）。
 * - 每列的說明頁：這是什麼／為什麼進場前要看／目前數值與判定門檻（直接讀 config/thresholds.yml 的 market_env，
 *   與 pipeline/derive/extras.market_env 用的是同一份設定）／近期走勢與資料來源。
 * - 這檔股票觸發冷靜卡的事實（相對 20 日均線、近 5 日漲幅）也是一列，門檻讀 config/ui.yml 的 impulse。
 */
import type { LightPoint, LightStateT, MarketLight, StockHistory, StockRow } from '../data/types';
import { envInfo, type EnvState } from './envState';
import { sourcesConfig, thresholds, uiConfig } from './config';
import { md } from './format';

export type Stance = 'bull' | 'neutral' | 'bear' | 'none';
export const STANCE_LABEL: Record<Stance, string> = { bull: '偏多', neutral: '中性', bear: '偏空', none: '資料不足' };
export const stanceOf = (s: LightStateT): Stance => (s === 'green' ? 'bull' : s === 'red' ? 'bear' : s === 'yellow' ? 'neutral' : 'none');
/** 語意色沿用資金指標列（Brief.lightTone）：偏空＝琥珀（風險）、偏多＝主文字、其餘中性 */
export const stanceTone = (s: Stance): 'risk' | 'strong' | 'neutral' => (s === 'bear' ? 'risk' : s === 'bull' ? 'strong' : 'neutral');

const MINUS = '−';
/** 帶號數字（負號 U+2212）：+8.2、−3.1 */
export function signed(v: number, digits: number): string {
  const s = Math.abs(v).toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${v > 0 ? '+' : v < 0 ? MINUS : ''}${s}`;
}
const num = (v: number, digits: number) => v.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// ------------------------------------------------------------------ 日期與落後

/** 「10/5」；月資料「2026/08」；沒有日期 →「日期未提供」 */
export function dateLabel(d: string | null | undefined): string {
  if (!d) return '日期未提供';
  const ym = d.match(/^(\d{4})-(\d{2})$/);
  return ym ? `${ym[1]}/${ym[2]}` : md(d);
}

const dayMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

/** 資料型態：daily＝台灣交易日資料；ust＝美國交易日（時差＋美國假日）；monthly＝月資料（M1B／M2）；revenue＝月營收 */
export type LagKind = 'daily' | 'ust' | 'monthly' | 'revenue';

/**
 * 資料是否落後於最新交易日（latest＝summary 的資料日）：
 * - daily：資料日早於最新交易日。
 * - ust：早於最新交易日超過 checklist.ust_lag_days 個日曆日（台北的 T 日只會有美國的 T−1，週一只會有上週五）。
 * - monthly：月份比最新交易日所在月份早超過 checklist.monthly_lag_months 個月（月資料約落後一個月公布）。
 * - revenue：次月 backtest.revenue_fallback_day 日之後還沒有上個月的營收，才算落後。
 */
export function isLagging(kind: LagKind, date: string | null | undefined, latest: string | null | undefined, cfg = uiConfig.checklist): boolean {
  if (!date || !latest) return false;
  if (kind === 'daily') return date.slice(0, 10) < latest.slice(0, 10);
  if (kind === 'ust') return (dayMs(latest) - dayMs(date)) / 86_400_000 > cfg.ust_lag_days;
  const ym = date.slice(0, 7);
  const now = monthIndex(latest.slice(0, 7));
  if (kind === 'monthly') return now - monthIndex(ym) > cfg.monthly_lag_months;
  const day = Number(latest.slice(8, 10));
  const expected = now - (day > Number(thresholds.backtest.revenue_fallback_day) ? 1 : 2);
  return monthIndex(ym) < expected;
}

// ------------------------------------------------------------------ 資金環境總結

export interface EnvSummary {
  state: EnvState;
  /** 保守／中性／積極／資料不足 */
  label: string;
  /** 一句判定依據：「5 項中 1 項偏空（任一項偏空即判定為保守）」 */
  basis: string;
}

export function envSummary(lights: MarketLight[] | null | undefined, cfg = uiConfig.env_state): EnvSummary {
  const env = envInfo(lights, cfg);
  const total = (lights ?? []).length;
  const gray = env.gray.length ? `、${env.gray.length} 項資料不足` : '';
  const redRule = cfg.conservative_min_red <= 1 ? '任一項偏空即判定為保守' : `${cfg.conservative_min_red} 項以上偏空即判定為保守`;
  const greenRule = `沒有偏空且 ${cfg.aggressive_min_green} 項以上偏多即判定為積極`;
  let basis: string;
  if (env.state === 'unknown') basis = total ? `${total} 項資金指標都還沒有資料` : '資金指標資料源待處理';
  else if (env.state === 'conservative') basis = `${total} 項中 ${env.red.length} 項偏空${gray}（${redRule}）`;
  else if (env.state === 'aggressive') basis = `${total} 項中 ${env.green.length} 項偏多、沒有偏空${gray}（${greenRule}）`;
  else basis = `${total} 項中 ${env.green.length} 項偏多、沒有偏空${gray}（偏多未達 ${cfg.aggressive_min_green} 項，判定為中性）`;
  return { state: env.state, label: env.label, basis };
}

// ------------------------------------------------------------------ 每項指標一列

export interface FactRow {
  id: string;
  label: string;
  /** 窄螢幕（≤ 390pt）用的短名稱：長的指標名稱在 375pt 寬不換行（說明頁標題仍用完整名稱） */
  short?: string;
  /** 目前數值（短）；沒有資料為「—」 */
  value: string;
  stance: Stance;
  /** 狀態標籤文字（偏多／中性／偏空／資料不足；股票事實列沒有標籤，門檻寫在副資訊） */
  tag: string;
  date: string | null;
  dateText: string;
  stale: boolean;
  /** 副資訊（股票事實列：提醒門檻） */
  note: string | null;
}

const SHORT_LABEL: Record<string, string> = { futures: '外資期貨淨部位' };
const LIGHT_KIND: Record<string, LagKind> = { futures: 'daily', fx: 'daily', ma240: 'daily', m1b: 'monthly', ust: 'ust' };

/** 燈號的主數值：pipeline 有 short 就用；舊版取 value 的「（」之前 */
export function lightMain(l: MarketLight): string {
  if (l.short) return l.short;
  const v = l.value || '—';
  const i = v.indexOf('（');
  return i > 0 ? v.slice(0, i) : v;
}

export function lightRow(l: MarketLight, latest: string | null | undefined): FactRow {
  const stance = stanceOf(l.state);
  const date = l.date ?? null;
  return {
    id: l.id,
    label: l.label,
    ...(SHORT_LABEL[l.id] && l.label.length > 8 ? { short: SHORT_LABEL[l.id] } : {}),
    value: stance === 'none' ? '—' : lightMain(l),
    stance,
    tag: STANCE_LABEL[stance],
    date,
    dateText: stance === 'none' ? (l.detail ?? l.basis ?? '資料源待處理') : dateLabel(date),
    stale: stance !== 'none' && isLagging(LIGHT_KIND[l.id] ?? 'daily', date, latest),
    note: null,
  };
}

/** 冷靜卡的股票事實列：相對 20 日均線、近 5 日漲幅（超過 config/ui.yml impulse 的提醒門檻才列出） */
export function stockFactRows(row: StockRow | undefined, latest: string | null | undefined, cfg = uiConfig.impulse): FactRow[] {
  if (!row) return [];
  const out: FactRow[] = [];
  const date = row.last_trade_date ?? latest ?? null;
  const base = { date, dateText: dateLabel(date), stale: false, note: null, stance: 'neutral' as Stance };
  const gap = row.ma20_gap as number | null | undefined;
  if (typeof gap === 'number' && Number.isFinite(gap) && gap > cfg.ma20_gap_pct) {
    out.push({ ...base, id: 'ma20_gap', label: '相對 20 日均線', value: `${signed(gap, 1)}%`, tag: '', note: `提醒門檻 +${cfg.ma20_gap_pct}%` });
  }
  const p5 = row.price_change_5d as number | null | undefined;
  if (typeof p5 === 'number' && Number.isFinite(p5) && p5 > cfg.price_change_5d_pct) {
    out.push({ ...base, id: 'price_change_5d', label: '近 5 日漲幅', value: `${signed(p5, 1)}%`, tag: '', note: `提醒門檻 +${cfg.price_change_5d_pct}%` });
  }
  return out;
}

// ------------------------------------------------------------------ 說明頁

export interface DocTable {
  /** 欄名：日期、判定數值、原始數值… */
  cols: string[];
  rows: { d: string; cells: string[] }[];
}

export interface FactDoc {
  title: string;
  what: string;
  why: string;
  /** 目前數值（名稱、數值） */
  current: { label: string; value: string }[];
  /** 判定門檻（程式實際使用的設定值，逐條） */
  rules: string[];
  /** 走勢小圖用的數值（舊→新）；不足 2 點不畫 */
  chart: (number | null)[];
  /** 小圖的基準線（例：0、門檻） */
  base?: number | null;
  /** 原始數值表（新→舊） */
  table: DocTable | null;
  /** 沒有歷史資料時的說明 */
  noHistory: string;
  source: string;
  dateText: string;
}

const env = () => thresholds.market_env;
const src = (key: string, fallback: string) => sourcesConfig[key]?.label ?? fallback;
const fmtD = (d: string) => dateLabel(d);

function seriesTable(series: LightPoint[] | undefined, cols: string[], cells: (p: LightPoint) => string[]): DocTable | null {
  if (!series?.length) return null;
  return { cols, rows: [...series].reverse().map((p) => ({ d: fmtD(p.d), cells: cells(p) })) };
}
const opt = (v: number | null | undefined, f: (x: number) => string) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : f(v));

/** 資金指標的說明頁內容 */
export function lightDoc(l: MarketLight, latest: string | null | undefined): FactDoc {
  const row = lightRow(l, latest);
  const s = l.series;
  const chart = (s ?? []).map((p) => p.v);
  const common = {
    title: l.label,
    chart,
    dateText: row.stance === 'none' ? row.dateText : `資料日 ${row.dateText}${row.stale ? '（資料落後）' : ''}`,
    noHistory: row.stance === 'none' ? `目前沒有資料：${row.note ?? '資料源待處理'}` : '資料累積中：這次部署的資料沒有附近期序列',
  };
  const stance = { label: '判定', value: row.tag };
  const e = env();
  switch (l.id) {
    case 'futures': {
      const c = e.futures_net_oi;
      return {
        ...common,
        what: '外資在台指期貨多單減空單的未平倉口數，負值代表淨空單。台指期、小型台指、微型台指換算成大台約當口數（大台 + 小台 ÷ 4 + 微台 ÷ 20）後加總。',
        why: '外資常以期貨空單替現貨部位避險或表達看法。淨空單水位高時，大盤下檔風險與波動通常較大，個股動能較容易被大盤拖累。',
        current: [
          { label: '淨未平倉', value: row.value },
          ...(l.pct250 !== undefined && l.pct250 !== null ? [{ label: '近 250 個交易日百分位', value: `第 ${Math.round(l.pct250)}` }] : []),
          stance,
        ],
        rules: [
          `≥ ${num(c.bullish_above, 0)} 口：偏多`,
          `≤ ${signed(c.bearish_below, 0).replace('+', '')} 口：偏空`,
          '介於兩者之間：中性',
        ],
        base: 0,
        table: seriesTable(s, ['日期', '淨未平倉（口）'], (p) => [opt(p.v, (v) => signed(v, 0))]),
        source: src('taifex_insti', '期交所三大法人期貨未平倉'),
      };
    }
    case 'fx': {
      const c = e.usd_twd_change_20d_pct;
      return {
        ...common,
        what: '美元兌新台幣匯率，以及近 20 個交易日的變化幅度。數值下降代表新台幣升值。',
        why: '外資資金匯入台股時需要換成新台幣，新台幣升值通常伴隨資金淨流入；快速貶值則常反映資金匯出，權值股與大盤較缺少外資資金支撐。',
        current: [
          { label: 'USD/TWD', value: row.value },
          ...(s?.length ? [{ label: '20 日變化', value: opt(s[s.length - 1].v, (v) => `${signed(v, 2)}%`) }] : []),
          stance,
        ],
        rules: [
          `20 日變化 ≤ ${signed(c.inflow_below, 0)}%（新台幣升值）：偏多`,
          `20 日變化 ≥ ${signed(c.outflow_above, 0)}%（新台幣貶值）：偏空`,
          '介於兩者之間：中性',
        ],
        base: 0,
        table: seriesTable(s, ['日期', '20 日變化', 'USD/TWD'], (p) => [opt(p.v, (v) => `${signed(v, 2)}%`), opt(p.x, (v) => num(v, 3))]),
        source: src('fx_usdtwd', '期交所每日匯率'),
      };
    }
    case 'ma240': {
      const band = e.index_vs_ma240_pct.neutral_band;
      return {
        ...common,
        what: '加權指數收盤相對 240 日均線（年線）的乖離率。',
        why: '年線約等於市場近一年的平均成本。大盤在年線之上代表中長期趨勢向上；跌破年線時，系統性回檔的機率與幅度通常較大，個股也較難獨立走強。',
        current: [{ label: '相對年線', value: row.value }, stance],
        rules: [`乖離 > +${band}%：偏多`, `乖離 < ${MINUS}${band}%：偏空`, `±${band}% 以內（年線附近）：中性`],
        base: 0,
        table: seriesTable(s, ['日期', '相對年線', '加權指數'], (p) => [opt(p.v, (v) => `${signed(v, 2)}%`), opt(p.x, (v) => num(v, 0))]),
        source: src('twse_index', '證交所上市指數'),
      };
    }
    case 'm1b': {
      const c = e.m1b_m2_gap;
      const last = s?.[s.length - 1];
      return {
        ...common,
        what: 'M1B 是活期性資金（通貨淨額＋支票、活期、活期儲蓄存款），M2 再加上定期存款等準貨幣；比較兩者的年增率。',
        why: 'M1B 年增率高於 M2（黃金交叉）代表資金從定存移向活存，市場資金較活絡；反之（死亡交叉）代表資金趨於保守。月資料，落後約一個月公布。',
        current: [
          ...(last ? [{ label: 'M1B 年增率', value: opt(last.x, (v) => `${num(v, 2)}%`) }, { label: 'M2 年增率', value: opt(last.y, (v) => `${num(v, 2)}%`) }] : []),
          { label: 'M1B − M2', value: last ? opt(last.v, (v) => `${signed(v, 2)} 個百分點`) : row.value },
          stance,
        ],
        rules: [`M1B 年增率 − M2 年增率 > ${num(c.bullish_above, 0)} 個百分點：偏多`, `否則：偏空（這項沒有中性）`],
        base: 0,
        table: seriesTable(s, ['月份', 'M1B − M2', 'M1B', 'M2'], (p) => [opt(p.v, (v) => signed(v, 2)), opt(p.x, (v) => `${num(v, 2)}%`), opt(p.y, (v) => `${num(v, 2)}%`)]),
        source: src('cbc_money', '央行貨幣總計數'),
      };
    }
    case 'ust': {
      const c = e.us10y_change_20d_bp;
      return {
        ...common,
        what: '美國 10 年期公債殖利率是全球資金成本的基準利率；另列近 20 個交易日的變動（bp，1bp＝0.01 個百分點）。',
        why: '殖利率快速上升會壓縮高本益比成長股的估值，也影響外資對新興市場的資金配置。',
        current: [
          { label: '殖利率', value: row.value },
          ...(s?.length ? [{ label: '20 日變化', value: opt(s[s.length - 1].v, (v) => `${signed(v, 0)}bp`) }] : []),
          stance,
        ],
        rules: [
          `20 日變化 ≥ +${c.tightening_above}bp（資金成本上升）：偏空`,
          `20 日變化 ≤ ${signed(c.easing_below, 0)}bp（資金成本下降）：偏多`,
          '介於兩者之間：中性',
        ],
        base: 0,
        table: seriesTable(s, ['日期', '20 日變化', '殖利率'], (p) => [opt(p.v, (v) => `${signed(v, 0)}bp`), opt(p.x, (v) => `${num(v, 2)}%`)]),
        source: src('ust_10y', '美國財政部 10 年期公債殖利率'),
      };
    }
    default:
      return {
        ...common,
        what: l.label,
        why: '這項指標參與資金環境的判定。',
        current: [{ label: '目前數值', value: row.value }, stance],
        rules: [l.basis],
        table: seriesTable(s, ['日期', '數值'], (p) => [opt(p.v, (v) => num(v, 2))]),
        source: '—（這項指標沒有登錄資料來源）',
      };
  }
}

/** 股票事實列的說明頁（相對 20 日均線、近 5 日漲幅）；歷史取個股檔的 trend.series（還原價） */
export function stockFactDoc(id: string, row: StockRow, hist: StockHistory | null | undefined, latest: string | null | undefined, cfg = uiConfig.impulse): FactDoc {
  const fr = stockFactRows(row, latest, { ...cfg, ma20_gap_pct: -Infinity, price_change_5d_pct: -Infinity }).find((r) => r.id === id);
  const ser = hist?.trend?.series;
  const n = 20;
  const quotes = src(row.market === 'tpex' ? 'tpex_quotes' : 'twse_quotes', '每日收盤行情');
  const common = { title: fr?.label ?? id, dateText: `資料日 ${fr?.dateText ?? '日期未提供'}`, noHistory: '資料累積中：個股走勢尚未載入或歷史不足', source: `${quotes}（還原價）` };
  if (id === 'ma20_gap') {
    const pts = ser ? ser.dates.map((d, i) => ({ d, c: ser.close[i], m: ser.ma20[i] })).filter((p) => p.c !== null && p.m !== null && p.m > 0).slice(-n) : [];
    const gaps = pts.map((p) => ((p.c as number) / (p.m as number) - 1) * 100);
    return {
      ...common,
      what: '收盤價相對 20 日均線（月線）的乖離率。',
      why: '乖離越大，代表股價離近一個月的平均成本越遠；回到均線附近時，拉回幅度也可能較大。',
      current: [{ label: '相對 20 日均線', value: fr?.value ?? '—' }],
      rules: [`> +${cfg.ma20_gap_pct}%：列入這一頁（提醒門檻，不影響其他判定）`],
      chart: gaps,
      base: 0,
      table: pts.length ? { cols: ['日期', '相對 20 日均線', '收盤', '20 日均線'], rows: pts.map((p, i) => ({ d: fmtD(p.d), cells: [`${signed(gaps[i], 1)}%`, num(p.c as number, 2), num(p.m as number, 2)] })).reverse() } : null,
    };
  }
  const closes = ser ? ser.dates.map((d, i) => ({ d, c: ser.close[i] })) : [];
  const pts = closes.map((p, i) => ({ d: p.d, c: p.c, r: i >= 5 && p.c !== null && closes[i - 5].c ? (p.c / (closes[i - 5].c as number) - 1) * 100 : null }))
    .filter((p) => p.r !== null).slice(-n);
  return {
    ...common,
    what: '近 5 個交易日的累計漲跌幅（還原價，除權息不造成斷層）。',
    why: '短期急漲後，進場價與近期成本的差距較大，之後的波動通常也較高。',
    current: [{ label: '近 5 日漲幅', value: fr?.value ?? '—' }],
    rules: [`> +${cfg.price_change_5d_pct}%：列入這一頁（提醒門檻，不影響其他判定）`],
    chart: pts.map((p) => p.r),
    base: 0,
    table: pts.length ? { cols: ['日期', '近 5 日漲跌', '收盤'], rows: pts.map((p) => ({ d: fmtD(p.d), cells: [`${signed(p.r as number, 1)}%`, num(p.c as number, 2)] })).reverse() } : null,
  };
}
