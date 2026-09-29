/**
 * 個股籌碼明細與區間統計（純函式，定義見 METHODOLOGY §4.7.1）。
 * 資料：個股檔的 chip 區塊（近 60 個交易日＋前一日）；法人、借券賣出為「股」，融資融券餘額為「張」。
 * 合計一律先以股數相加再換算，避免逐日四捨五入的誤差累積。
 */
import { sourcesConfig, uiConfig } from './config';
import { numberFormat } from './format';

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
  /** 借券賣出餘額（股；TWT93U「借券賣出當日餘額」）；舊版部署沒有 */
  sblb?: N[];
  /** 當沖成交股數；舊版部署沒有 */
  dtv?: N[];
  /** 買進／賣出股數（法人買賣超報表）：外資（含外資自營商）、投信、自營商自行買賣、自營商避險；舊版部署沒有 */
  fb?: N[];
  fs?: N[];
  tb?: N[];
  ts?: N[];
  dsb?: N[];
  dss?: N[];
  dhb?: N[];
  dhs?: N[];
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
  /** 融資、融券餘額（張） */
  marginBal: N;
  shortBal: N;
  /** 券資比 %＝融券餘額 ÷ 融資餘額 */
  shortRatio: N;
  /** 借券賣出餘額、當沖量（股） */
  sblBal: N;
  dtVol: N;
  dtPct: N;
}

export type Unit = 'lots' | 'amount' | 'pct';
export type FlowKey = 'foreign' | 'trust' | 'dealerSelf' | 'dealerHedge' | 'total' | 'marginChg' | 'shortChg' | 'sblSell';
export type PartyKey = 'foreign' | 'trust' | 'dealerSelf';

/** 單位選單的選項名稱（「佔」＝占有，不是「估」） */
export const UNIT_NAME: Record<Unit, string> = { lots: '張', amount: '金額（億元，估）', pct: '佔成交量 %' };
/** 表格右上角「單位：…」 */
export const UNIT_LABEL: Record<Unit, string> = { lots: '張', amount: '億元（估）', pct: '佔成交量 %' };
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
      marginBal: mb,
      shortBal: sb,
      shortRatio: mb && sb !== null ? (sb / mb) * 100 : null,
      sblBal: at(b.sblb ?? [], i),
      dtVol: at(b.dtv ?? [], i),
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

// ------------------------------------------------------------------ 每日籌碼：三種檢視（法人｜信用｜借券當沖）
export type View = 'insti' | 'credit' | 'sbl';
export type ColKey = 'foreign' | 'trust' | 'dealerSelf' | 'total' | 'marginChg' | 'shortChg' | 'marginBal' | 'shortRatio' | 'sblSell' | 'sblBal' | 'dtPct' | 'dtVol';
/** flow＝當日數量（可換算單位，可加總）；level＝餘額（可換算張／金額；區間合計為增減）；ratio＝比率 %（不隨單位變動） */
export type ColKind = 'flow' | 'level' | 'ratio';

export interface ViewCol {
  key: ColKey;
  /** 欄位標題（短） */
  label: string;
  /** 完整名稱（螢幕閱讀器、底部面板） */
  full: string;
  kind: ColKind;
  /** 有正負（買超／賣超、增加／減少） */
  signed: boolean;
  /** 原始值單位為張（融資融券）；其餘數量為股 */
  lots?: boolean;
  /** 法人：標題下方顯示連買／連賣天數 */
  party?: boolean;
  /** 正、負的說法（螢幕閱讀器） */
  words?: [string, string];
}

export const VIEW_LABEL: Record<View, string> = { insti: '法人', credit: '信用', sbl: '借券當沖' };
export const VIEWS: View[] = ['insti', 'credit', 'sbl'];

export const VIEW_COLS: Record<View, ViewCol[]> = {
  insti: [
    { key: 'foreign', label: '外資', full: '外資', kind: 'flow', signed: true, party: true, words: ['買超', '賣超'] },
    { key: 'trust', label: '投信', full: '投信', kind: 'flow', signed: true, party: true, words: ['買超', '賣超'] },
    { key: 'dealerSelf', label: '自營商', full: '自營商（自行買賣）', kind: 'flow', signed: true, party: true, words: ['買超', '賣超'] },
    { key: 'total', label: '合計', full: '三大法人合計', kind: 'flow', signed: true, party: true, words: ['買超', '賣超'] },
  ],
  credit: [
    { key: 'marginChg', label: '融資增減', full: '融資增減', kind: 'flow', signed: true, lots: true, words: ['增加', '減少'] },
    { key: 'shortChg', label: '融券增減', full: '融券增減', kind: 'flow', signed: true, lots: true, words: ['增加', '減少'] },
    { key: 'marginBal', label: '融資餘額', full: '融資餘額', kind: 'level', signed: false, lots: true },
    { key: 'shortRatio', label: '券資比', full: '券資比', kind: 'ratio', signed: false },
  ],
  sbl: [
    { key: 'sblSell', label: '借券賣出', full: '借券賣出', kind: 'flow', signed: false },
    { key: 'sblBal', label: '借券賣出餘額', full: '借券賣出餘額', kind: 'level', signed: false },
    { key: 'dtPct', label: '當沖比率', full: '當沖比率', kind: 'ratio', signed: false },
    { key: 'dtVol', label: '當沖量', full: '當沖量', kind: 'flow', signed: false },
  ],
};
export const ALL_COLS: ViewCol[] = VIEWS.flatMap((v) => VIEW_COLS[v]);

/** 某欄實際使用的單位：比率固定 %；餘額沒有「佔成交量」的意義，改以張顯示（標題下方註明）。 */
export function colUnit(col: ViewCol, unit: Unit): Unit | 'ratio' {
  if (col.kind === 'ratio') return 'ratio';
  if (col.kind === 'level' && unit === 'pct') return 'lots';
  return unit;
}

function colShares(row: ChipRow, col: ViewCol): N {
  const v = row[col.key as keyof ChipRow] as N;
  if (v === null || v === undefined) return null;
  return col.lots ? v * 1000 : v;
}

/** 某列某欄在指定單位下的值。 */
export function colValue(row: ChipRow, col: ViewCol, unit: Unit): N {
  const u = colUnit(col, unit);
  if (u === 'ratio') return (row[col.key as keyof ChipRow] as N) ?? null;
  return convert(colShares(row, col), row, u);
}

/**
 * 區間合計（表格第一列）：數量欄＝加總（先以股數相加再換算）；餘額欄＝區間增減（最新 − 區間前一日）；
 * 比率欄＝區間平均（當沖比率以成交量加權、券資比＝Σ融券餘額 ÷ Σ融資餘額）。
 * rows 為新到舊的顯示範圍；all 為全部列（舊到新，用來找區間前一日）。
 */
export function colTotal(rows: ChipRow[], all: ChipRow[], col: ViewCol, unit: Unit): N {
  if (!rows.length) return null;
  const u = colUnit(col, unit);
  if (col.key === 'dtPct') return periodDaytrade(rows);
  if (col.key === 'shortRatio') {
    let s = 0, m = 0;
    for (const r of rows) if (r.shortBal !== null && r.marginBal) { s += r.shortBal; m += r.marginBal; }
    return m ? (s / m) * 100 : null;
  }
  if (col.kind === 'level') {
    const oldest = rows[rows.length - 1];
    const idx = all.findIndex((r) => r.date === oldest.date);
    const before = idx > 0 ? all[idx - 1] : null;
    const now = colShares(rows[0], col);
    const then = before ? colShares(before, col) : null;
    if (now === null || then === null || u === 'ratio') return null;
    return convert(now - then, rows[0], u);
  }
  let shares = 0, amount = 0, vol = 0, any = false, amountOk = true;
  for (const r of rows) {
    const s = colShares(r, col);
    if (s === null) continue;
    any = true;
    shares += s;
    if (r.avg === null) amountOk = false;
    else amount += s * r.avg;
    if (r.volume) vol += r.volume;
  }
  if (!any) return null;
  if (u === 'lots') return shares / 1000;
  if (u === 'amount') return amountOk ? amount / 1e8 : null;
  return vol ? (shares / vol) * 100 : null;
}

/** 連買（正）／連賣（負）天數（法人欄）。 */
export function colStreak(all: ChipRow[], col: ViewCol): number {
  return streak(all.slice(1).map((r) => r[col.key as keyof ChipRow] as N));
}

/** 精簡數字：≥ 10,000 縮寫為「1.2 萬」（≥ 100 萬取整數）；其餘依單位給小數位數。 */
export function compactNum(abs: number, unit: Unit | 'ratio'): string {
  if (abs >= 1e4) {
    const w = abs / 1e4;
    return `${w >= 100 ? numberFormat(0).format(Math.round(w)) : w.toFixed(1)}\u00a0萬`;
  }
  const digits = unit === 'lots' ? 0 : unit === 'ratio' ? 1 : abs >= 1000 ? 0 : abs >= 100 ? 1 : 2;
  return numberFormat(digits).format(abs);
}

/**
 * 每日籌碼表的「整欄」數字格式（v3，依 Apple HIG：同一欄同一種格式，小數點才對得齊）：
 * - 張：該欄（含區間合計列）最大絕對值 ≥ 10,000 → 整欄「萬張」、1 位小數；否則整欄千分位整數。
 * - 億元、佔量 %：整欄 2 位小數（該欄最大值 ≥ 100 → 1 位、≥ 1,000 → 整數）；比率 %：整欄 1 位小數。
 */
export interface ColFormat {
  digits: number;
  /** 張數以萬張顯示（整張表一起切換；未滿 1,000 張的格子寫整數張，見 cellText） */
  wan?: boolean;
}

export const WAN_THRESHOLD = 1e4;
/** 萬張表格中，絕對值小於這個數的格子改寫整數張（避免 ▲0.0） */
export const WAN_SMALL = 1e3;
/** 萬張表格中小量格子的單位後綴（表格以小字顯示「張」） */
export const LOT_SUFFIX = '\u00a0張';

/**
 * 表格格式（#6）：同一張表的同一種單位只用一種格式，單位寫在表格上方（tableUnitLabel），不黏在欄名後面。
 * - 張：整張表（含區間合計）張數欄的最大絕對值 < 10,000 → 全部千分位整數；
 *   ≥ 10,000 → 全部萬張 1 位小數，但未滿 1,000 張的格子寫「▲315 張」（至少到整數張，不出現 ▲0.0）。
 * - 億元、佔量 %：整張表依最大絕對值決定小數位（≥ 1,000 整數、≥ 100 一位、否則兩位）。
 * - 比率：一位小數。
 */
export function tableFormats(values: Record<string, N[]>, cols: ViewCol[], unit: Unit): Record<string, ColFormat> {
  const maxOf: Partial<Record<Unit | 'ratio', number>> = {};
  for (const c of cols) {
    const u = colUnit(c, unit);
    for (const v of values[c.key] ?? []) if (v !== null && Number.isFinite(v)) maxOf[u] = Math.max(maxOf[u] ?? 0, Math.abs(v));
  }
  return Object.fromEntries(cols.map((c) => [c.key, unitFormat(colUnit(c, unit), maxOf[colUnit(c, unit)] ?? 0)]));
}

function unitFormat(u: Unit | 'ratio', max: number): ColFormat {
  if (u === 'ratio') return { digits: 1 };
  if (u === 'lots') return max >= WAN_THRESHOLD ? { digits: 1, wan: true } : { digits: 0 };
  return { digits: max >= 1000 ? 0 : max >= 100 ? 1 : 2 };
}

/**
 * 每個檢視（法人／信用／借券當沖）各是一張表，各自決定格式（#6）；橫向同時顯示全部欄位時仍各組各自一種格式。
 */
export function viewFormats(values: Record<string, N[]>, unit: Unit): Record<string, ColFormat> {
  return Object.assign({}, ...VIEWS.map((v) => tableFormats(values, VIEW_COLS[v], unit)));
}

/** 表格上方的單位說明：「張」「萬張（未滿 1,000 張寫張數）」「億元（估）」…；views＝目前顯示的檢視。 */
export function tableUnitLabel(unit: Unit, fmts: Record<string, ColFormat>, views: View[]): string {
  const wanViews = views.filter((v) => VIEW_COLS[v].some((c) => colUnit(c, unit) === 'lots' && fmts[c.key]?.wan));
  const lotViews = views.filter((v) => VIEW_COLS[v].some((c) => colUnit(c, unit) === 'lots'));
  if (!wanViews.length) return UNIT_LABEL[unit];
  const wanText = '萬張（未滿千張寫張）';
  if (unit === 'lots' && wanViews.length === lotViews.length) return wanText;
  const names = wanViews.map((v) => VIEW_LABEL[v]).join('、');
  return `${UNIT_LABEL[unit]}；${unit === 'lots' ? names : '餘額'}欄為${wanText}`;
}

/** 單欄格式（卡片、底部面板等只有一欄的情境）；規則同 tableFormats。 */
export function colFormat(values: N[], col: ViewCol, unit: Unit): ColFormat {
  return tableFormats({ [col.key]: values }, [col], unit)[col.key];
}

/** 依格式寫出絕對值（不含正負號與單位）。萬張格式下未滿 1,000 張寫「315 張」。 */
export function formatAbs(abs: number, f: ColFormat): string {
  if (f.wan) return abs < WAN_SMALL ? `${numberFormat(0).format(abs)}${LOT_SUFFIX}` : numberFormat(f.digits).format(abs / 1e4);
  return numberFormat(f.digits).format(abs);
}

/**
 * 儲存格文字：有正負的欄位加 ▲▼（區間合計列的餘額欄是增減，也有正負）；比率加 %。
 * 傳入 fmt（整欄格式）時依整欄格式、萬不寫在儲存格（寫在欄位標題）；否則各自精簡（卡片、底部面板）。
 * 0 顯示「0」（整欄整數時四捨五入為 0 也是「0」）、沒有資料顯示「—」。
 */
export function cellText(v: N, col: ViewCol, unit: Unit, signed = col.signed, fmt?: ColFormat): { text: string; arrow: '' | '▲' | '▼'; body: string; dir: 'up' | 'down' | 'flat' | 'none' } {
  if (v === null || !Number.isFinite(v)) return { text: '—', arrow: '', body: '—', dir: 'none' };
  const u = colUnit(col, unit);
  let raw = fmt ? formatAbs(Math.abs(v), fmt) : compactNum(Math.abs(v), u);
  const roundsToZero = Number(raw.replace(/[^\d.]/g, '')) === 0;
  // 非 0 但四捨五入為 0（例：億元欄的 0.004）：寫成「<0.01」，不出現 ▲0.0 這種看似有方向卻是 0 的數字（#6）
  // 萬張表格中未滿 1,000 張的格子已經寫成整數張，四捨五入為 0 就是 0
  const intCell = !fmt || fmt.digits === 0 || (!!fmt.wan && Math.abs(v) < WAN_SMALL);
  if (roundsToZero && v !== 0 && !intCell) raw = `<${numberFormat(fmt!.digits).format(10 ** -fmt!.digits)}`;
  const shownZero = roundsToZero && (v === 0 || intCell);
  const body = `${shownZero ? '0' : raw}${u === 'ratio' ? '%' : ''}`;
  if (!signed || shownZero) return { text: body, arrow: '', body, dir: signed ? 'flat' : 'none' };
  const arrow = v > 0 ? '▲' : '▼';
  return { text: `${arrow}${body}`, arrow, body, dir: v > 0 ? 'up' : 'down' };
}

const UNIT_WORD: Record<Unit, string> = { lots: '張', amount: '億元', pct: '' };

/** 螢幕閱讀器的片語：「外資賣超 485 張」「融資增加 1,200 張」「券資比 3.2%」「外資買超佔成交量 3.21%」。 */
export function cellPhrase(v: N, col: ViewCol, unit: Unit, signed = col.signed): string {
  if (v === null || !Number.isFinite(v)) return `${col.full}沒有資料`;
  const u = colUnit(col, unit);
  const n = compactNum(Math.abs(v), u).replace('\u00a0', ' ');
  if (u === 'ratio') return `${col.full} ${n}%`;
  const amt = u === 'pct' ? `佔成交量 ${n}%` : ` ${n} ${UNIT_WORD[u]}`;
  // 區間合計列的餘額欄是增減
  if (signed && !col.signed) return v === 0 ? `${col.full}持平` : `${col.full}${v > 0 ? '增加' : '減少'}${amt}`;
  if (col.signed && col.words) {
    const word = v > 0 ? col.words[0] : v < 0 ? col.words[1] : '持平';
    const subject = col.key === 'marginChg' ? '融資' : col.key === 'shortChg' ? '融券' : col.full;
    return v === 0 ? `${subject}持平` : `${subject}${word}${amt}`;
  }
  return `${col.full}${amt}`;
}

/** 「9 月 24 日」 */
export function spokenDate(iso: string): string {
  return `${Number(iso.slice(5, 7))} 月 ${Number(iso.slice(8, 10))} 日`;
}

const SPOKEN_PRICE = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });

/** 一列的完整句子：「9 月 24 日，外資賣超 485 張，…；收盤 176 元，下跌 2.49%」。 */
export function rowSentence(row: ChipRow, cols: ViewCol[], unit: Unit): string {
  const parts = cols.map((c) => cellPhrase(colValue(row, c, unit), c, unit));
  const chg = row.chgPct === null ? '' : row.chgPct > 0 ? `，上漲 ${row.chgPct.toFixed(2)}%` : row.chgPct < 0 ? `，下跌 ${Math.abs(row.chgPct).toFixed(2)}%` : '，平盤';
  const close = row.close === null ? '' : `；收盤 ${SPOKEN_PRICE.format(row.close)} 元${chg}`;
  return `${spokenDate(row.date)}，${parts.join('，')}${close}`;
}

/** 底部面板：當天完整資料的 12 個主要欄位＋信用與借券的餘額。 */
export const DAY_FIELDS: { group: string; cols: ViewCol[] }[] = [
  {
    group: '三大法人',
    cols: [
      VIEW_COLS.insti[0],
      VIEW_COLS.insti[1],
      VIEW_COLS.insti[2],
      { key: 'dealerHedge' as ColKey, label: '自營商避險', full: '自營商（避險）', kind: 'flow', signed: true, party: true, words: ['買超', '賣超'] },
      VIEW_COLS.insti[3],
    ],
  },
  { group: '信用交易', cols: [VIEW_COLS.credit[0], VIEW_COLS.credit[1], VIEW_COLS.credit[2], { key: 'shortBal' as ColKey, label: '融券餘額', full: '融券餘額', kind: 'level', signed: false, lots: true }, VIEW_COLS.credit[3]] },
  { group: '借券與當沖', cols: VIEW_COLS.sbl },
];

/** 「複製這天資料」：欄位〈tab〉數值（含單位），第一行為代號與日期。 */
export function dayText(row: ChipRow, unit: Unit, meta: { code: string; name: string }): string {
  const lines = [`${meta.name} ${meta.code} ${row.date}`];
  lines.push(`收盤\t${row.close ?? '—'}`);
  lines.push(`漲跌(%)\t${row.chgPct === null ? '—' : row.chgPct.toFixed(2)}`);
  lines.push(`成交量(張)\t${row.volume === null ? '—' : Math.round(row.volume / 1000)}`);
  for (const g of DAY_FIELDS) {
    for (const c of g.cols) {
      const u = colUnit(c, unit);
      const v = colValue(row, c, unit);
      const suffix = u === 'ratio' || u === 'pct' ? '%' : u === 'amount' ? '億元' : '張';
      lines.push(`${c.full}(${suffix})\t${v === null ? '—' : v.toFixed(u === 'lots' ? 0 : 2)}`);
    }
  }
  return lines.join('\n') + '\n';
}
