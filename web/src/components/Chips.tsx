/**
 * 個股籌碼：區間統計卡（1／3／5／10／20／60 日）與每日明細表（預設收合）。
 * 數字一律等寬、千分位；正負同時以紅綠色與 ▲▼ 表示（買超、增加為紅）。定義見 METHODOLOGY §4.7.1。
 */
import { Fragment, type ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import {
  type ChipBlock,
  type ChipRow,
  FLOW_COLS,
  type Unit,
  UNIT_NAME,
  chipRows,
  convert,
  headerLabel,
  missingNotes,
  officialLinks,
  periodChange,
  periodDaytrade,
  rangeSentence,
  rangeStats,
  recent,
  streak,
  streakText,
  sumConverted,
  toCsv,
  toShares,
  unitDigits,
} from '../lib/chips';
import { uiConfig } from '../lib/config';
import { arrow, direction, fmtNum, fmtPrice } from '../lib/format';
import { IconChevronDown } from './Icons';

/** 帶正負的數字：顏色＋▲▼＋絕對值（0 與四捨五入後為 0 者不加符號）。 */
export function Sig({ v, digits, suffix = '' }: { v: number | null | undefined; digits: number; suffix?: string }) {
  if (v === null || v === undefined || !Number.isFinite(v)) return <span class="muted">—</span>;
  const r = Number(v.toFixed(digits));
  const d = direction(r);
  const abs = fmtNum(Math.abs(r), digits);
  return (
    <span class={`num ${d}`}>
      <span aria-hidden="true">{d === 'flat' ? abs : `${arrow(r)}${abs}`}{suffix}</span>
      <span class="sr-only">{d === 'up' ? '正 ' : d === 'down' ? '負 ' : ''}{abs}{suffix}</span>
    </span>
  );
}

function Segmented<T extends string | number>({ label, value, options, onPick, format }: {
  label: string; value: T; options: readonly T[]; onPick: (v: T) => void; format: (v: T) => string;
}) {
  return (
    <div class="segmented chip-seg" role="group" aria-label={label}>
      {options.map((o) => <button key={String(o)} aria-pressed={o === value} onClick={() => onPick(o)}>{format(o)}</button>)}
    </div>
  );
}

// ------------------------------------------------------------------ 區間統計卡
export function ChipStats({ block, sharesOut }: { block: ChipBlock; sharesOut: number | null | undefined }) {
  const cfg = uiConfig.chip;
  const [days, setDays] = useState(cfg.stats_default);
  const s = useMemo(() => rangeStats(block, days, sharesOut), [block, days, sharesOut]);
  const rows: { label: string; cell: (p: (typeof s.parties)[number]) => ComponentChildren }[] = [
    { label: '買賣超（張）', cell: (p) => <Sig v={p.lots} digits={0} /> },
    { label: '金額（億元・估）', cell: (p) => <Sig v={p.amount} digits={2} /> },
    { label: '佔區間成交量（%）', cell: (p) => <Sig v={p.pctVolume} digits={2} /> },
    { label: '佔股本（%）', cell: (p) => <Sig v={p.pctCapital} digits={3} /> },
    { label: '估計成本（元・估）', cell: (p) => <span class="num">{fmtPrice(p.cost)}</span> },
    { label: '現價相對成本（%）', cell: (p) => <Sig v={p.costRel} digits={1} /> },
    { label: '目前連續', cell: (p) => <span class="caption">{streakText(p.streak, block.d.length - 1)}</span> },
  ];
  return (
    <div class="card chip-stats-card" aria-label="籌碼區間統計">
      <div class="row between" style={{ gap: 'var(--s-2)' }}>
        <span class="body w6">區間統計</span>
        <span class="caption muted">{s.start ?? '—'}～{s.end ?? '—'}</span>
      </div>
      <div style={{ marginTop: 'var(--s-3)' }}>
        <Segmented label="統計天數" value={days} options={cfg.stats_periods} onPick={setDays} format={(n) => `${n} 日`} />
      </div>
      <p class="body t1" style={{ marginTop: 'var(--s-3)' }} data-testid="chip-sentence">{rangeSentence(s)}</p>
      <div class="scroll-x">
        <table class="chip-stats">
          <thead>
            <tr><th scope="col"><span class="sr-only">項目</span></th>{s.parties.map((p) => <th key={p.key} scope="col">{p.key === 'dealerSelf' ? <>自營商<span class="sub">（自行買賣）</span></> : p.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}><th scope="row">{r.label}</th>{s.parties.map((p) => <td key={p.key}>{r.cell(p)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>
        收盤 {fmtPrice(s.close)}・區間漲跌 <Sig v={s.change} digits={2} suffix="%" />・區間成交 {fmtNum(s.volumeLots, 0)} 張。
        金額以各日均價估算；估計成本＝區間內淨買超日的（還原）均價加權，只在區間合計為淨買超時顯示；股本以最新已發行股數計。
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ 每日明細表
const UNITS: Unit[] = ['lots', 'amount', 'pct'];

export function ChipTable({ block, code, name, market }: { block: ChipBlock; code: string; name: string; market: string | null | undefined }) {
  const cfg = uiConfig.chip;
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(cfg.table_default);
  const [unit, setUnit] = useState<Unit>('lots');
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const all = useMemo(() => chipRows(block), [block]);
  const rows = recent(all, days);
  const dg = unitDigits(unit);
  const available = all.length - 1;
  const colCount = FLOW_COLS.length + 4;
  const notes = missingNotes(rows);

  async function copy() {
    const csv = toCsv(rows, unit, { code, name });
    try {
      await navigator.clipboard.writeText(csv);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  }
  const toggleRow = (r: ChipRow) => setOpenRow(openRow === r.date ? null : r.date);

  return (
    <div class="chip-detail">
      <button class="collapsed-row" aria-expanded={open} aria-controls="chip-detail-body" onClick={() => setOpen(!open)}>
        <span>{open ? '收合明細' : '查看明細'}（每日籌碼）</span>
        <IconChevronDown />
      </button>
      {open ? (
        <div id="chip-detail-body">
          <div class="chip-controls">
            <Segmented label="明細期間" value={days} options={cfg.table_periods} onPick={setDays} format={(n) => `${n} 日`} />
            <Segmented label="單位" value={unit} options={UNITS} onPick={(u) => { setUnit(u); setCopied(null); }} format={(u) => UNIT_NAME[u]} />
          </div>
          <div class="chip-scroll" role="region" aria-label="每日籌碼明細（可左右捲動）" tabIndex={0}>
            <table class="chip-table">
              <thead>
                <tr>
                  <th scope="col">日期</th>
                  <th scope="col">收盤（元）</th>
                  <th scope="col">漲跌（%）</th>
                  {FLOW_COLS.map((c) => <th key={c.key} scope="col">{headerLabel(c.label, unit)}</th>)}
                  <th scope="col">當沖比率（%）</th>
                </tr>
              </thead>
              <tbody>
                <tr class="total">
                  <th scope="row">區間合計<span class="caption muted" style={{ display: 'block' }}>{rows.length} 日</span></th>
                  <td />
                  <td><Sig v={periodChange(rows)} digits={2} /></td>
                  {FLOW_COLS.map((c) => <td key={c.key}><Sig v={sumConverted(rows, c.key, unit)} digits={dg} /></td>)}
                  <td><span class="num">{fmtNum(periodDaytrade(rows), 1)}</span></td>
                </tr>
                {rows.map((r) => (
                  <Fragment key={r.date}>
                    <tr class={`day ${openRow === r.date ? 'open' : ''}`} onClick={() => toggleRow(r)}>
                      <th scope="row">
                        <button class="chip-date" aria-expanded={openRow === r.date} aria-label={`${r.date} 官方資料來源`} onClick={(e) => { e.stopPropagation(); toggleRow(r); }}>
                          {r.date.slice(5).replace('-', '/')}
                        </button>
                      </th>
                      <td><span class="num">{fmtPrice(r.close)}</span></td>
                      <td><Sig v={r.chgPct} digits={2} /></td>
                      {FLOW_COLS.map((c) => <td key={c.key}><Sig v={convert(toShares(r, c.key), r, unit)} digits={dg} /></td>)}
                      <td><span class="num">{fmtNum(r.dtPct, 1)}</span></td>
                    </tr>
                    {openRow === r.date ? (
                      <tr class="detail">
                        <td colSpan={colCount}>
                          <div class="chip-links">
                            <span class="caption muted">{r.date} 官方資料（{market === 'tpex' ? '櫃買中心' : '證交所'}，另開新頁）：</span>
                            {officialLinks(market, r.date).map((l) => (
                              <a key={l.url} class="caption" href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
                <tr class="streaks">
                  <th scope="row">目前連續</th>
                  <td /><td />
                  {FLOW_COLS.map((c) => <td key={c.key}>{c.party ? streakText(streak(all.slice(1).map((r) => r[c.key])), available) : ''}</td>)}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <div class="row between wrap" style={{ gap: 'var(--s-2)' }}>
            <span class="caption muted">點日期可查看該日的官方資料來源。</span>
            <button class="text-btn" onClick={copy}>{copied === 'ok' ? '已複製 CSV' : '複製為 CSV'}</button>
          </div>
          {copied === 'fail' ? <p class="caption risk">瀏覽器不允許寫入剪貼簿；請改用桌面瀏覽器或允許剪貼簿權限。</p> : null}
          <p class="caption muted">
            單位：張＝1,000 股；金額（億元）以當日均價（成交金額 ÷ 成交股數）估算，標「估」；佔成交量＝淨買賣超股數 ÷ 當日成交股數。
            外資＝外陸資（不含外資自營商）＋外資自營商；三大法人合計為官方數字；區間合計先以股數相加再換算。
          </p>
          {notes.length ? (
            <p class="caption muted">「—」表示沒有資料：{notes.map((n) => `${n.label}（${n.reason}）`).join('；')}。</p>
          ) : null}
        </div>
      ) : null}
      <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>
        八大行庫、分點券商前 15 名、主力動向與籌碼集中度需要分點進出資料，官方查詢頁有驗證碼，因此不提供。
      </p>
    </div>
  );
}
