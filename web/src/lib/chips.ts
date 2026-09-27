/**
 * 個股籌碼明細與區間統計（純函式，定義見 METHODOLOGY §4.7.1）。
 * 資料：個股檔的 chip 區塊（近 60 個交易日＋前一日）；法人、借券賣出為「股」，融資融券餘額為「張」。
 * 合計一律先以股數相加再換算，避免逐日四捨五入的誤差累積。
 */
import { sourcesConfig, uiConfig } from './config';

type N = number | null;

export interface ChipBlock {
  d: string[];
  c: N[];
  chg: N[];
  v: N[];
  avg: N[];
  af: N[];
  mb: N[];
  sb: N[];
  fn: N[];
  ffd: N[];
  tn: N[];
  dn: N[];
  dself: N[];
  dhedge: N[];
  tot: N[];
  sbls: N[];
  dt: N[];
}

export interface ChipRow {
  date: string;
  close: N;
  chgPct: N;
  /** 成交股數 */
  volume: N;
  /** 當日均價（成交金額 ÷ 成交股數） */
  avg: N;
  af: N;
  /** 以下法人與借券賣出為「股」；外資＝外陸資（不含外資自營商）＋外資自營商 */
  foreign: N;
  trust: N;
  dealerSelf: N;
  dealerHedge: N;
  dealer: N;
  total: N;
  sblSell: N;
  /** 融資、融券餘額增減為「張」 */
  marginChg: N;
  shortChg: N;
  dtPct: N;
}

export type Unit = 'lots' | 'amount' | 'pct';
export type FlowKey = 'foreign' | 'trust' | 'dealerSelf' | 'dealerHedge' | 'total' | 'marginChg' | 'shortChg' | 'sblSell';
export type PartyKey = 'foreign' | 'trust' | 'dealerSelf';

export const UNIT_NAME: Record<Unit, string> = { lots: '張', amount: '金額', pct: '佔成交量' };
/** 欄位標題上的單位字樣 */
export const UNIT_SUFFIX: Record<Unit, string> = { lots: '張', amount: '億元・估', pct: '佔量 %' };

export const FLOW_COLS: { key: FlowKey; label: string; inLots?: boolean; party?: boolean }[] = [
  { key: 'foreign', label: '外資', party: true },
  { key: 'trust', label: '投信', party: true },
  { key: 'dealerSelf', label: '自營商（自行買賣）', party: true },
  { key: 'dealerHedge', label: '自營商（避險）', party: true },
  { key: 'total', label: '三大法人合計', party: true },
  { key: 'marginChg', label: '融資增減', inLots: true },
  { key: 'shortChg', label: '融券增減', inLots: true },
  { key: 'sblSell', label: '借券賣出' },
];

export const PARTY_LABEL: Record<PartyKey, string> = { foreign: '外資', trust: '投信', dealerSelf: '自營商（自行買賣）' };

const num = (v: unknown): N => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const at = (a: N[] | undefined, i: number): N => num(a?.[i]);

function addN(a: N, b: N): N {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

/** 由 chip 區塊建立逐日列（舊到新，含第一筆「前一日」種子列；種子列的增減為 null）。 */
export function chipRows(b: ChipBlock): ChipRow[] {
  return b.d.map((date, i) => {
    const mb = at(b.mb, i);
    const sb = at(b.sb, i);
    const pmb = i > 0 ? at(b.mb, i - 1) : null;
    const psb = i > 0 ? at(b.sb, i - 1) : null;
    const fn = at(b.fn, i);
    return {
      date,
      close: at(b.c, i),
      chgPct: i > 0 ? at(b.chg, i) : null,
      volume: at(b.v, i),
      avg: at(b.avg, i),
      af: at(b.af, i),
      foreign: fn === null ? null : addN(fn, at(b.ffd, i)),
      trust: at(b.tn, i),
      dealerSelf: at(b.dself, i),
      dealerHedge: at(b.dhedge, i),
      dealer: at(b.dn, i),
      total: at(b.tot, i),
      sblSell: at(b.sbls, i),
      marginChg: mb !== null && pmb !== null ? mb - pmb : null,
      shortChg: sb !== null && psb !== null ? sb - psb : null,
      dtPct: at(b.dt, i),
    };
  });
}

/** 取最近 n 個交易日（不含種子列），新到舊。 */
export function recent(rows: ChipRow[], n: number): ChipRow[] {
  const start = Math.max(1, rows.length - n);
  return rows.slice(start).reverse();
}

/** 欄位值換成「股」（融資融券增減原本是張）。 */
export function toShares(row: ChipRow, key: FlowKey): N {
  const v = row[key];
  if (v === null) return null;
  return FLOW_COLS.find((c) => c.key === key)?.inLots ? v * 1000 : v;
}

/** 股數 → 指定單位：張、億元（以當日均價估算）、佔當日成交量 %。 */
export function convert(shares: N, row: Pick<ChipRow, 'avg' | 'volume'>, unit: Unit): N {
  if (shares === null) return null;
  if (unit === 'lots') return shares / 1000;
  if (unit === 'amount') return row.avg === null ? null : (shares * row.avg) / 1e8;
  return row.volume ? (shares / row.volume) * 100 : null;
}

/** 區間合計：張＝Σ股 ÷ 1000；金額＝Σ(股 × 當日均價) ÷ 1e8；佔量＝Σ股 ÷ Σ成交股數（同一批有資料的日子）。 */
export function sumConverted(rows: ChipRow[], key: FlowKey, unit: Unit): N {
  let shares = 0;
  let amount = 0;
  let vol = 0;
  let any = false;
  let amountOk = true;
  for (const r of rows) {
    const s = toShares(r, key);
    if (s === null) continue;
    any = true;
    shares += s;
    if (r.avg === null) amountOk = false;
    else amount += s * r.avg;
    if (r.volume) vol += r.volume;
  }
  if (!any) return null;
  if (unit === 'lots') return shares / 1000;
  if (unit === 'amount') return amountOk ? amount / 1e8 : null;
  return vol ? (shares / vol) * 100 : null;
}

/** 區間漲跌 %：逐日（還原）漲跌連乘。 */
export function periodChange(rows: ChipRow[]): N {
  let f = 1;
  let any = false;
  for (const r of rows) {
    if (r.chgPct === null) continue;
    f *= 1 + r.chgPct / 100;
    any = true;
  }
  return any ? (f - 1) * 100 : null;
}

/** 區間當沖比率：Σ(當沖比率 × 成交股數) ÷ Σ成交股數（以成交量加權）。 */
export function periodDaytrade(rows: ChipRow[]): N {
  let num_ = 0;
  let den = 0;
  for (const r of rows) {
    if (r.dtPct === null || !r.volume) continue;
    num_ += r.dtPct * r.volume;
    den += r.volume;
  }
  return den ? num_ / den : null;
}

/** 連買（正）／連賣（負）天數：由最新一天往回數同方向的天數；最新一天為 0 或無資料 → 0。 */
export function streak(values: N[]): number {
  let n = 0;
  let sign = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v === null || v === 0) break;
    const s = v > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    if (s !== sign) break;
    n += 1;
  }
  return n * sign;
}

export function streakText(s: number, available: number): string {
  if (s === 0) return '—';
  const n = Math.abs(s);
  return `連${s > 0 ? '買' : '賣'} ${n >= available ? `${n}+` : n} 日`;
}

export interface PartyStats {
  key: PartyKey;
  label: string;
  /** 區間淨買賣超（股） */
  shares: N;
  lots: N;
  /** 億元（以各日均價估算） */
  amount: N;
  pctVolume: N;
  pctCapital: N;
  /** 估計成本（元，還原後均價；只計淨買超日；區間合計為淨賣超或持平時為 null） */
  cost: N;
  /** 現價相對估計成本 % */
  costRel: N;
  streak: number;
}

export interface RangeStats {
  days: number;
  rows: ChipRow[];
  start: string | null;
  end: string | null;
  close: N;
  change: N;
  volumeLots: N;
  parties: PartyStats[];
}

/** 估計成本：區間內淨買超 > 0 的日子，Σ(淨買超股數 × 當日均價 × 還原因子) ÷ Σ淨買超股數（同 §4.7 法人成本線）。 */
export function estimatedCost(rows: ChipRow[], key: FlowKey): N {
  let num_ = 0;
  let den = 0;
  for (const r of rows) {
    const s = toShares(r, key);
    if (s === null || s <= 0 || r.avg === null) continue;
    num_ += s * r.avg * (r.af ?? 1);
    den += s;
  }
  return den > 0 ? num_ / den : null;
}

export function rangeStats(b: ChipBlock, days: number, sharesOut: number | null | undefined): RangeStats {
  const all = chipRows(b);
  const rows = recent(all, days); // 新到舊
  const latest = rows[0];
  const close = latest ? latest.close : null;
  const adjClose = close !== null && latest ? close * (latest.af ?? 1) : null;
  let vol = 0;
  for (const r of rows) vol += r.volume ?? 0;
  const parties = (Object.keys(PARTY_LABEL) as PartyKey[]).map((key) => {
    const lots = sumConverted(rows, key, 'lots');
    const shares = lots === null ? null : lots * 1000;
    const cost = lots !== null && lots > 0 ? estimatedCost(rows, key) : null;
    return {
      key,
      label: PARTY_LABEL[key],
      shares,
      lots,
      amount: sumConverted(rows, key, 'amount'),
      pctVolume: sumConverted(rows, key, 'pct'),
      pctCapital: shares !== null && sharesOut ? (shares / sharesOut) * 100 : null,
      cost,
      costRel: cost && adjClose !== null ? (adjClose / cost - 1) * 100 : null,
      streak: streak(all.slice(1).map((r) => r[key])),
    };
  });
  return {
    days,
    rows,
    start: rows.length ? rows[rows.length - 1].date : null,
    end: latest ? latest.date : null,
    close,
    change: periodChange(rows),
    volumeLots: rows.length ? vol / 1000 : null,
    parties,
  };
}

/** 規則式白話結論：挑佔成交量比例最大的法人＋最長的連買／連賣；只陳述數字，不做建議。 */
export function rangeSentence(s: RangeStats, cfg = uiConfig.chip): string {
  if (!s.rows.length) return '資料不足。';
  const period = s.days === 1 ? '最近一個交易日' : `近 ${s.days} 日`;
  const usable = s.parties.filter((p) => p.pctVolume !== null);
  if (!usable.length) return `${period}沒有三大法人資料。`;
  const main = usable.reduce((a, b) => (Math.abs(b.pctVolume!) > Math.abs(a.pctVolume!) ? b : a));
  const parts: string[] = [];
  if (Math.abs(main.pctVolume!) < cfg.sentence_min_pct) {
    parts.push(`${period}${usable.map((p) => p.label).join('、')}的買賣超都不到成交量的 ${cfg.sentence_min_pct}%`);
  } else {
    parts.push(`${period}${main.label}${main.pctVolume! > 0 ? '買超' : '賣超'}佔成交量 ${Math.abs(main.pctVolume!).toFixed(1)}%`);
  }
  const streaky = s.parties.filter((p) => Math.abs(p.streak) >= cfg.streak_min);
  if (streaky.length) {
    const top = streaky.reduce((a, b) => (Math.abs(b.streak) > Math.abs(a.streak) ? b : a));
    const word = top.streak > 0 ? '買超' : '賣超';
    parts.push(top.key === main.key && Math.abs(main.pctVolume!) >= cfg.sentence_min_pct
      ? `且已連 ${Math.abs(top.streak)} 日${word}`
      : `${top.label}連 ${Math.abs(top.streak)} 日${word}`);
  }
  return `${parts.join('，')}。`;
}

/** 表格與 CSV 的數值格式：張為整數、金額 2 位小數、佔量 2 位小數。 */
export function unitDigits(unit: Unit): number {
  return unit === 'lots' ? 0 : 2;
}

export function headerLabel(label: string, unit: Unit): string {
  return `${label}（${UNIT_SUFFIX[unit]}）`;
}

/** 缺值原因（表格下方註記）。 */
export const MISSING_REASON: Record<FlowKey | 'dtPct' | 'chgPct', string> = {
  foreign: '該日沒有三大法人資料（官方未公布或此代號不在三大法人表）',
  trust: '該日沒有三大法人資料（官方未公布或此代號不在三大法人表）',
  dealerSelf: '官方資料沒有拆分自營商自行買賣',
  dealerHedge: '官方資料沒有拆分自營商避險',
  total: '該日沒有三大法人資料',
  marginChg: '非融資融券標的，或缺前一日餘額',
  shortChg: '非融資融券標的，或缺前一日餘額',
  sblSell: '非借券標的或當日無借券資料（借券只回補近一年）',
  dtPct: '非現股當沖標的，或當日無當沖統計',
  chgPct: '缺前一日收盤',
};

/** 目前顯示範圍內有缺值的欄位與原因。 */
export function missingNotes(rows: ChipRow[]): { key: string; label: string; reason: string }[] {
  const out: { key: string; label: string; reason: string }[] = [];
  const cols: { key: FlowKey | 'dtPct' | 'chgPct'; label: string }[] = [
    { key: 'chgPct', label: '漲跌 %' },
    ...FLOW_COLS.map((c) => ({ key: c.key, label: c.label })),
    { key: 'dtPct', label: '當沖比率' },
  ];
  for (const c of cols) {
    if (rows.some((r) => r[c.key] === null)) out.push({ key: c.key, label: c.label, reason: MISSING_REASON[c.key] });
  }
  return out;
}

function csvNum(v: N, digits: number): string {
  return v === null ? '' : v.toFixed(digits);
}

/** CSV（與表格相同的欄位與單位；第一列資料為區間合計）。數字不含千分位，方便對帳。 */
export function toCsv(rows: ChipRow[], unit: Unit, meta: { code: string; name: string }): string {
  const dg = unitDigits(unit);
  const head = ['日期', '收盤', '漲跌(%)', ...FLOW_COLS.map((c) => `${c.label}(${UNIT_SUFFIX[unit]})`), '當沖比率(%)'];
  const lines = [`# ${meta.name} ${meta.code}，單位：${UNIT_NAME[unit]}${unit === 'amount' ? '（以當日均價估算）' : ''}`, head.join(',')];
  const totals = [
    `區間合計(${rows.length}日)`,
    csvNum(rows[0]?.close ?? null, 2),
    csvNum(periodChange(rows), 2),
    ...FLOW_COLS.map((c) => csvNum(sumConverted(rows, c.key, unit), dg)),
    '',
  ];
  lines.push(totals.join(','));
  for (const r of rows) {
    lines.push(
      [
        r.date,
        csvNum(r.close, 2),
        csvNum(r.chgPct, 2),
        ...FLOW_COLS.map((c) => csvNum(convert(toShares(r, c.key), r, unit), dg)),
        csvNum(r.dtPct, 2),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

/** 該日的官方資料來源（證交所或櫃買的 HTML 報表），網址取自 config/sources.yml。 */
export function officialLinks(market: string | null | undefined, date: string): { label: string; url: string }[] {
  const m = market === 'tpex' ? 'tpex' : 'twse';
  const ymd = date.replaceAll('-', '');
  const slash = date.replaceAll('-', '/');
  const items: [string, string][] = [
    [`${m}_insti`, '三大法人買賣超'],
    [`${m}_margin`, '融資融券餘額'],
    [`${m}_sbl`, '借券賣出'],
    [`${m}_daytrade`, '現股當沖'],
    [`${m}_quotes`, '收盤行情'],
  ];
  const out: { label: string; url: string }[] = [];
  for (const [id, label] of items) {
    const url = sourcesConfig[id]?.url;
    if (!url) continue;
    out.push({
      label: `${m === 'tpex' ? '櫃買' : '證交所'}・${label}`,
      url: url.replace('{date}', ymd).replace('{date_slash}', slash).replace('response=json', 'response=html'),
    });
  }
  return out;
}
