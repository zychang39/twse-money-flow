/**
 * 探索 › 動能流程（2026-10-09）：大盤狀態 → 候選池 → 檢查清單 → 組合試算 → 持股條件監看 → 回測與濾網效度。
 * 資料來自資料分支 momentum_flow/web/*.json（momentum/data.ts）；本頁任何錯誤只影響本頁（DataState）。
 * 分頁：大盤｜候選｜持股｜紀錄（網址 #/explore/momentum/{tab}）。用語：符合、未符合、資料不足、條件觸發、曝險上限、部位試算。
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { TopBar } from '../../components/Chrome';
import { PageTitle, Seg, Section, List, Row, EmptyRow, Table, StatGrid, Button, Info, NavRow } from '../../components/ui';
import { Conclusion, Interp, DataState } from '../../components/kit';
import { SeriesChart } from '../../components/SeriesChart';
import { useAsync } from '../../hooks';
import { navigate } from '../../router';
import { fmtNum, md } from '../../lib/format';
import { listTrades } from '../../db/db';
import { loadStock } from '../../data/api';
import { loadBacktest, loadHistory, loadLatest, STATE_DESC, type CandidateRow, type History, type Latest, type Tri } from '../data';
import { HELP } from '../help';
import { loadFund, plan, saveFund, type Pick } from '../lib/portfolio';
import { factorAt, parseVals, report, type Holding, type HoldingReport } from '../lib/holdings';
import '../styles/momentum.css';

const TABS = [['market', '大盤'], ['candidates', '候選'], ['holdings', '持股'], ['records', '紀錄']] as const;
type Tab = (typeof TABS)[number][0];
const TRI_TEXT: Record<Tri, string> = { 1: '符合', 0: '未符合', '-1': '資料不足' };
const TRI_CLASS: Record<Tri, string> = { 1: 'pass', 0: 'fail', '-1': 'na' };
const ymd = (d: string) => `${d.slice(0, 4)}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** 整數、不加千分位（窄表格用） */
const intText = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : String(Math.round(v)));
/** 金額以萬元表示（圖軸與線尾標籤） */
const wanText = (v: number) => `${fmtNum(v / 10000, 0)} 萬`;
const pctText = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), d)}%`);

function Help({ id }: { id: string }) {
  const h = HELP[id];
  if (!h) return null;
  return <Info title={h.title}><p><strong>定義</strong>：{h.what}</p><p><strong>為什麼檢查</strong>：{h.why}</p></Info>;
}

function TriText({ v }: { v: Tri }) {
  return <span class={`mf-tri ${TRI_CLASS[v]}`}>{TRI_TEXT[v]}</span>;
}

/** K1–K6 的數值、門檻、判定（candidates.day_rows 的 k 欄位） */
function kDetail(l: Latest, r: CandidateRow): { k: string; label: string; value: string; thr: string; res: Tri }[] {
  const [k1, k2, k3, k4, k5, k6] = r.k;
  const v = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? '—' : fmtNum(x, d));
  const ratio = k4[1] !== null && k4[3] ? (k4[1] as number) / (k4[3] as number) : null;
  return [
    { k: 'K1', label: l.k_labels.K1, value: `RS ${v(k1[1])}`, thr: `${k1[2]}–${k1[3]}`, res: k1[0] },
    { k: 'K2', label: l.k_labels.K2, value: `PR12M ${v(k2[1])}・PR3M ${v(k2[2])}`, thr: 'PR12M ≥ 80 且 PR3M ≥ 60', res: k2[0] },
    { k: 'K3', label: l.k_labels.K3, value: `個股 ${pctText(k3[1], 2)}・族群 ${pctText(k3[2], 2)}`, thr: '族群 > 0 且 個股 > 族群', res: k3[0] },
    { k: 'K4', label: l.k_labels.K4, value: `收盤 ${v(k4[1], 2)}・MA60 ${v(k4[2], 2)}・距高點 ${ratio === null ? '—' : `${fmtNum(ratio * 100, 1)}%`}`, thr: '收盤 > MA60 且 ≥ 80% H250', res: k4[0] },
    { k: 'K5', label: l.k_labels.K5, value: `處置 ${k5[1] ? '是' : '否'}・注意 ${k5[2] ? '是' : '否'}・漲停 ${v(k5[3], 0)} 次`, thr: '無處置、無注意、漲停 < 2', res: k5[0] },
    { k: 'K6', label: l.k_labels.K6, value: `${v(k6[1] === null ? null : (k6[1] as number) / 1e8, 2)} 億`, thr: '20 日平均 ≥ 0.5 億', res: k6[0] },
  ];
}

// ---------------------------------------------------------------- 大盤
function stripesOf(rows: History['rows']): { from: number; to: number; label: string }[] {
  const out: { from: number; to: number; label: string }[] = [];
  let start = 0;
  for (let i = 1; i <= rows.length; i++) {
    if (i === rows.length || rows[i][5] !== rows[start][5]) {
      const st = rows[start][5];
      out.push({ from: start, to: i - 1, label: st === null ? '不足' : `狀態 ${st}` });
      start = i;
    }
  }
  return out;
}

function MarketTab({ latest }: { latest: Latest }) {
  const hist = useAsync(loadHistory, []);
  const [all, setAll] = useState(false);
  const m = latest.market;
  const rows = hist.data?.rows ?? [];
  const dates = rows.map((r) => r[0]);
  const desc = m.state === null ? '不足 240 個交易日，狀態資料不足' : STATE_DESC[m.state];
  return (
    <>
      <Section title="狀態" aside={`基準日 ${md(latest.date)}`} testid="mf-state" info={<><p>{HELP.state.what}</p><p>{HELP.state.why}</p><p>{HELP.exposure.what} {HELP.countdown.what}</p></>} infoTitle="大盤狀態機">
        <Conclusion testid="mf-state-concl">{m.state === null ? '狀態資料不足' : `狀態 ${m.state}・曝險上限 ${Math.round((m.exposure ?? 0) * 100)}%`}</Conclusion>
        <Interp>{desc}{m.raw !== null && m.state !== null && m.raw !== m.state ? `；原始狀態 ${m.raw}，${m.raw < m.state ? `升級倒數 ${m.countdown ?? '—'} 日` : ''}` : ''}</Interp>
        <StatGrid testid="mf-state-grid" items={[
          { label: '生效狀態', value: m.state === null ? '資料不足' : `狀態 ${m.state}` },
          { label: '曝險上限', value: m.exposure === null ? '—' : `${Math.round(m.exposure * 100)}%` },
          { label: '進入日', value: m.entered ? md(m.entered) : '—' },
          { label: '升級倒數', value: m.countdown === null ? '—' : `${m.countdown} 日` },
        ]} />
      </Section>
      <Section title="近一年狀態" testid="mf-timeline" info={<p>{HELP.state.what}</p>} infoTitle="狀態時間軸">
        <DataState phase={hist.loading ? 'loading' : hist.error ? 'error' : rows.length ? 'ok' : 'empty'} reason={hist.error ? '狀態歷史暫時無法取得' : '狀態歷史累積中'} testid="mf-timeline-state">
          {rows.length ? (
            <>
              <SeriesChart dates={dates} axisKey="mkt" height={200} label="近一年加權股價指數與 60、240 日線" testid="mf-chart" format={(v) => fmtNum(v, 0)} dateFormat={ymd}
                stripes={stripesOf(rows)}
                series={[
                  { id: 'c', name: '加權指數', color: 'var(--d-1)', values: rows.map((r) => r[1]), main: true },
                  { id: 'm60', name: 'MA60', color: 'var(--d-2)', values: rows.map((r) => r[2]), dash: 'dash' },
                  { id: 'm240', name: 'MA240', color: 'var(--d-3)', values: rows.map((r) => r[3]), dash: 'dot' },
                ]} />
              <div class="ui-card mf-dense">
                <Table caption="每日原始數據（原始／生效狀態）" testid="mf-state-table" rowKey={(r) => r[0]} rows={(all ? rows : rows.slice(-20)).slice().reverse()} cols={[
                  { key: 'd', label: '日期', width: '3rem', render: (r) => md(r[0]) },
                  { key: 'c', label: '收盤', align: 'r', render: (r) => intText(r[1]) },
                  { key: 'a', label: 'MA60', align: 'r', render: (r) => intText(r[2]) },
                  { key: 'b', label: 'MA240', align: 'r', render: (r) => intText(r[3]) },
                  { key: 's', label: '原始／生效', align: 'r', width: '4.5rem', render: (r) => `${r[4] ?? '—'}／${r[5] ?? '—'}` },
                ]} />
                {rows.length > 20 ? <Button block onClick={() => setAll(!all)} testid="mf-state-more">{all ? '只看最近 20 日' : `顯示全部 ${rows.length} 日`}</Button> : null}
              </div>
            </>
          ) : null}
        </DataState>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- 候選
function Chips({ codes, names }: { codes: string[]; names: Map<string, string> }) {
  if (!codes.length) return <p class="ui-foot ui-muted mf-note">無</p>;
  return (
    <div class="mf-chips">
      {codes.map((c) => <a key={c} class="mf-chip" href={`#/stock/${c}`}>{names.get(c) ?? c} {c}</a>)}
    </div>
  );
}

function Funnel({ latest, names }: { latest: Latest; names: Map<string, string> }) {
  const [open, setOpen] = useState<string | null>(null);
  const f = latest.funnel;
  const total = Math.max(1, f.candidates);
  return (
    <Section title="漏斗" aside={`候選 ${f.candidates} 檔`} testid="mf-funnel" info={<><p>候選池 → 各項通過數 → 全通過。點任一項可看被該項濾掉（未符合或資料不足）的股票。</p><p>{HELP.level.what}</p><p>{HELP.level.why}</p></>} infoTitle="漏斗與候選等級">
      <Conclusion testid="mf-funnel-concl">候選 {f.candidates} 檔 → 全通過 {f.pass} 檔</Conclusion>
      <List label="漏斗">
        {latest.k_names.map((k) => {
          const x = f.k[k];
          const on = open === k;
          return (
            <div key={k}>
              <Row label={<span class="mf-k-head">{k} {latest.k_labels[k]}<Help id={k} /></span>} sub={<>{`未符合 ${x.fail.length}・資料不足 ${x.na.length}`}<span class="mf-funnel-bar" aria-hidden="true"><i style={{ width: `${(x.pass / total) * 100}%` }} /></span></>}
                value={`${x.pass}／${f.candidates}`} onClick={() => setOpen(on ? null : k)} expanded={on} noChev testid={`mf-funnel-${k}`} />
              {on ? (
                <div class="mf-detail" data-testid={`mf-funnel-${k}-detail`}>
                  <p class="ui-foot ui-muted">未符合</p><Chips codes={x.fail} names={names} />
                  <p class="ui-foot ui-muted">資料不足</p><Chips codes={x.na} names={names} />
                </div>
              ) : null}
            </div>
          );
        })}
        <Row label="全通過" value={`${f.pass}／${f.candidates}`} strong />
      </List>
    </Section>
  );
}

function CandidateItem({ latest, r, open, onToggle }: { latest: Latest; r: CandidateRow; open: boolean; onToggle: () => void }) {
  const sub = `${r.group_name ?? '無主族群'}・RS ${r.rs ?? '—'}・PR ${r.pr12m ?? '—'}／${r.pr3m ?? '—'}／${r.pr1m ?? '—'}${r.pullback ? '・近月回檔' : ''}${r.ref ? '・漲多投信買' : ''}`;
  return (
    <div data-testid={`mf-cand-${r.code}`}>
      <Row label={<><span class={`mf-level ${r.level === 'A' ? 'a' : ''}`} aria-label={`等級 ${r.level}`}>{r.level}</span>{r.name} <span class="ui-muted">{r.code}</span></>}
        sub={sub} value={r.near ? `差 ${r.near}` : `${r.n_pass}／6`} onClick={onToggle} expanded={open} />
      {open ? (
        <div class="mf-detail">
          <Table caption={`${r.name} 檢查明細`} rowKey={(x) => x.k} rows={kDetail(latest, r)} cols={[
            { key: 'k', label: '項目', width: '6.5rem', render: (x) => <span class="mf-k-head">{x.k} {x.label}<Help id={x.k} /></span> },
            { key: 'v', label: '數值・門檻', render: (x) => <><span>{x.value}</span><span class="cell-sub">{x.thr}</span></> },
            { key: 'r', label: '判定', align: 'r', width: '4.5rem', render: (x) => <TriText v={x.res} /> },
          ]} />
          <List chev><NavRow title="個股頁" sub={`${r.name} ${r.code}`} href={`#/stock/${r.code}`} /></List>
        </div>
      ) : null}
    </div>
  );
}

function PlanSection({ latest }: { latest: Latest }) {
  const [fund, setFund] = useState(loadFund);
  const [draft, setDraft] = useState(String(fund.total));
  const update = (next: { total: number; slots: number }) => { setFund(next); saveFund(next); };
  // 離開欄位或按 Enter 才寫入（輸入中不重算）；直接讀欄位值，不依賴 state 閉包
  const commit = (el: HTMLInputElement) => {
    const v = Math.floor(Number(el.value));
    if (Number.isInteger(v) && v > 0) { update({ ...fund, total: v }); setDraft(String(v)); } else setDraft(String(fund.total));
  };
  const picks: Pick[] = latest.lists.pass.map((r) => ({ code: r.code, name: r.name, group: r.group, price: r.close }));
  const cap = latest.market.exposure ?? 0;
  const p = plan(picks, fund.total, fund.slots, cap);
  const slotOpts = [['8', '8 名額'], ['9', '9 名額'], ['10', '10 名額']] as const;
  return (
    <Section title="組合試算" aside={`可用 ${p.usable}／${fund.slots} 名額`} testid="mf-plan" info={<><p>{HELP.plan.what}</p><p>{HELP.plan.why}</p><p>總資金只存在這台裝置的瀏覽器。部位試算不是下單，也不是建議。</p></>} infoTitle="組合試算">
      <div class="mf-inputs">
        <label class="ui-foot ui-muted">總資金（元）
          <input class="mf-input" type="number" inputMode="numeric" min={1} step={1} value={draft} data-testid="mf-fund"
            onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
            onBlur={(e) => commit(e.currentTarget as HTMLInputElement)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(e.currentTarget as HTMLInputElement); }} />
        </label>
        <span class="ui-foot ui-muted">每名額 {fmtNum(p.perSlot, 0)} 元</span>
      </div>
      <Seg options={slotOpts} value={String(fund.slots) as '8' | '9' | '10'} onChange={(v) => update({ ...fund, slots: Number(v) })} label="名額" testid="mf-slots" small />
      <Interp>{latest.market.exposure === null ? '狀態資料不足：可用名額 0' : `曝險上限 ${Math.round(cap * 100)}% → 可用名額 ${p.usable}；同一主族群最多 3 檔、合計 ≤ 35%`}</Interp>
      <div class="ui-card">
        <Table caption="部位試算" testid="mf-plan-table" rowKey={(r, i) => `${r.code ?? 'cash'}-${i}`} rows={p.rows} cols={[
          { key: 'n', label: '名額', width: '2.5rem', render: (_r, i) => String(i + 1) },
          { key: 'c', label: '代號', render: (r) => (r.code ? <>{r.name} <span class="ui-muted">{r.code}</span><span class="cell-sub">{latest.groups[r.group ?? ''] ?? ''}</span></> : '現金') },
          { key: 's', label: '股數', align: 'r', render: (r) => (r.code ? `${r.lots} 張${r.odd ? `＋${r.odd} 股` : ''}` : '—') },
          { key: 'a', label: '金額', align: 'r', width: '5.5rem', render: (r) => fmtNum(r.amount, 0) },
        ]} />
        {p.skipped.length ? <p class="ui-foot ui-muted mf-note">跳過：{p.skipped.map((s) => `${s.code}（${s.why}）`).join('、')}</p> : null}
      </div>
    </Section>
  );
}

function CandidatesTab({ latest }: { latest: Latest }) {
  const [which, setWhich] = useState<'pass' | 'new' | 'near'>('pass');
  const [open, setOpen] = useState<string | null>(null);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of ['pass', 'new', 'near'] as const) for (const r of latest.lists[k]) m.set(r.code, r.name);
    return m;
  }, [latest]);
  const rows = latest.lists[which];
  const opts = [['pass', `篩出 ${latest.lists.pass.length}`], ['new', `新觸發 ${latest.lists.new.length}`], ['near', `差一項 ${latest.lists.near.length}`]] as const;
  return (
    <>
      <Funnel latest={latest} names={names} />
      <Section title="清單" aside="A → B → C・PR12M・RS" testid="mf-lists" info={<><p>篩出＝K1–K6 全符合；新觸發＝今日全符合、前一個交易日未全符合（含資料不足）；差一項＝恰好 5 項符合、1 項未符合（資料不足者不列）。</p><p>排序：等級 A → B → C、PR12M 由高到低、RS 由高到低、代號由小到大。</p><p>{HELP.pr1m.what}{HELP.ref.what}</p></>} infoTitle="三個清單">
        <Seg options={opts} value={which} onChange={setWhich} label="清單" testid="mf-list-seg" />
        <List label="候選清單" testid="mf-list">
          {rows.length ? rows.map((r) => <CandidateItem key={r.code} latest={latest} r={r} open={open === r.code} onToggle={() => setOpen(open === r.code ? null : r.code)} />) : <EmptyRow testid="mf-list-empty">這個清單今天沒有股票</EmptyRow>}
        </List>
      </Section>
      <PlanSection latest={latest} />
    </>
  );
}

// ---------------------------------------------------------------- 持股
async function loadHoldings(latest: Latest): Promise<HoldingReport[]> {
  const trades = (await listTrades()).filter((t) => t.status === 'open');
  const stocks = await Promise.all(trades.map((t) => loadStock(t.code).catch(() => null)));
  const closes = trades.map((t, i) => {
    const h = stocks[i];
    const c = h?.c ?? [];
    for (let k = c.length - 1; k >= 0; k--) if (typeof c[k] === 'number') return c[k] as number;
    const v = parseVals(latest.stocks[t.code]);
    return v?.close ?? null;
  });
  const total = closes.reduce<number>((s, c, i) => (c === null ? s : s + c * trades[i].shares), 0);
  return trades.map((t, i) => {
    const h = stocks[i];
    const hd: Holding = { code: t.code, name: t.name, entry: t.entry, shares: t.shares, openedAt: t.openedAt || null };
    const f = h ? factorAt(h.d, h.af as (number | null)[], hd.openedAt) : null;
    return report(hd, parseVals(latest.stocks[t.code]), closes[i], f, total > 0 ? total : null);
  });
}

function HoldingsTab({ latest }: { latest: Latest }) {
  const st = useAsync(() => loadHoldings(latest), [latest]);
  const items = st.data ?? [];
  return (
    <>
      <Section title="檢查日" testid="mf-review" info={<><p>{HELP.M1.what}</p><p>{HELP.buffer.what} {HELP.buffer.why}</p></>} infoTitle="月度檢查日">
        <Conclusion>本期檢查日 {md(latest.review.R)}・下一個 {md(latest.review.next)}（含）之後第一個交易日</Conclusion>
        <Interp>月度條件以檢查日 R 的資料判定、顯示到下一個 R；每日條件以基準日 {md(latest.date)} 判定。緩衝區（RS 70–85）只標示、不觸發。</Interp>
      </Section>
      <DataState phase={st.loading ? 'loading' : st.error ? 'error' : items.length ? 'ok' : 'empty'} reason={st.error ? '持股資料暫時無法取得' : '沒有持股（我的股票 → 持股）'} testid="mf-holdings-state">
        {items.map((h) => (
          <Section key={h.code} title={`${h.name} ${h.code}`} testid={`mf-hold-${h.code}`}
            aside={h.weight === null ? undefined : `權重 ${fmtNum(h.weight * 100, 1)}%${h.weightAlert ? '・超過 20%' : ''}`}
            info={<>{h.conds.map((c) => <p key={c.id}><strong>{c.id}</strong>：{HELP[c.id]?.what} {HELP[c.id]?.why}</p>)}<p><strong>權重提示</strong>：{HELP.weight.what}</p></>} infoTitle="持股條件">
            <Interp alert={h.weightAlert}>{[
              h.passToday === null ? '今日全通過：資料不足' : `今日全通過：${h.passToday ? '是' : '否'}`,
              h.buffer ? '緩衝區（不觸發條件）' : null,
              h.weightAlert ? '單檔權重超過 20%' : null,
              h.costNote,
            ].filter(Boolean).join('・')}</Interp>
            <List label={`${h.name} 條件`}>
              {h.conds.map((c) => (
                <Row key={c.id} label={<span class="mf-k-head">{c.id} {c.label}<Help id={c.id} /></span>} sub={`${c.value}・門檻 ${c.threshold}${c.note ? `・${c.note}` : ''}`}
                  value={<span class={`mf-tri ${c.result}`}>{c.result === 'hit' ? '條件觸發' : c.result === 'ok' ? '未觸發' : '資料不足'}</span>} testid={`mf-cond-${h.code}-${c.id}`} />
              ))}
            </List>
          </Section>
        ))}
      </DataState>
    </>
  );
}

// ---------------------------------------------------------------- 紀錄
function RecordsTab() {
  const bt = useAsync(loadBacktest, []);
  const [view, setView] = useState<'cum' | 'yearly'>('cum');
  const [year, setYear] = useState<string>('all');
  const d = bt.data;
  const phase = bt.loading ? 'loading' : bt.error ? 'error' : d ? 'ok' : 'empty';
  const s = d?.summary ?? {};
  const num = (k: string) => (s[k] === null || s[k] === undefined ? null : (s[k] as number));
  const pct = (k: string) => pctText(num(k) === null ? null : (num(k) as number) * 100, 2);
  // 依年份篩選：累加檢視把該年第一個點重設為 1,000,000；「全部」顯示整段
  const curve = useMemo(() => {
    if (!d) return null;
    const idx = d.curve.dates.map((_, i) => i).filter((i) => year === 'all' || d.curve.dates[i].startsWith(year));
    if (!idx.length) return null;
    const rebase = (arr: (number | null)[]) => {
      const b = arr[idx[0]];
      return idx.map((i) => (arr[i] === null || b === null || b === 0 ? null : (arr[i] as number) / b * 1_000_000));
    };
    return { dates: idx.map((i) => d.curve.dates[i]), nav: rebase(d.curve.nav), bench: rebase(d.curve.bench), ew: rebase(d.curve.ew) };
  }, [d, year]);
  const yearOpts = [['all', '全部'], ...(d?.years ?? []).map((y) => [y, y] as [string, string])] as readonly [string, string][];
  const yearly = d ? (year === 'all' ? d.yearly : d.yearly.filter((r) => r.year === year)) : [];
  return (
    <>
      <Section title="流程回測" aside={d ? `${md(d.period[0])}–${md(d.period[1])}` : undefined} testid="mf-backtest" info={<><p>{HELP.backtest.what}</p><p>{HELP.backtest.why}</p>{d?.notes.map((n) => <p key={n}>{n}</p>)}</>} infoTitle="流程回測">
        <DataState phase={phase} reason={bt.error ? '回測結果累積中（每日排程計算後出現）' : '回測結果累積中'} testid="mf-backtest-state">
          {d && curve ? (
            <>
              <Conclusion testid="mf-bt-concl">{d.period[0].slice(0, 4)}–{d.period[1].slice(0, 4)} 年化 {pct('cagr')}・相對 0050 {pct('excess_vs_0050')}</Conclusion>
              <Interp>{`扣除手續費與證交稅後的淨值；0050 含息、等權股票池不扣成本。月超額報酬（相對 0050）${num('excess_months') ?? 0} 個月。`}</Interp>
              <StatGrid testid="mf-bt-grid" items={[
                { label: '年化報酬', value: pct('cagr') }, { label: '年化波動', value: pct('vol') }, { label: '最大回撤', value: pct('mdd') },
                { label: '年換手率', value: num('turnover') === null ? '—' : `${fmtNum(num('turnover') as number, 2)} 倍` },
                { label: '成本侵蝕（年）', value: pct('cost_drag') },
                { label: '月超額平均', value: `${pct('excess_mean')}（t ${num('excess_t') === null ? '—' : fmtNum(num('excess_t') as number, 2)}）` },
              ]} />
              <Seg options={[['cum', '累加'], ['yearly', '逐年']] as const} value={view} onChange={setView} label="檢視" testid="mf-bt-view" small />
              {yearOpts.length > 2 ? <Seg options={yearOpts} value={year} onChange={setYear} label="年份" testid="mf-bt-year" small /> : null}
              {view === 'cum' ? (
                <SeriesChart dates={curve.dates} axisKey="bt" height={200} label="淨值相對 0050 與等權股票池（萬元）" testid="mf-bt-chart" format={wanText} dateFormat={ymd}
                  series={[
                    { id: 'nav', name: '流程', color: 'var(--d-1)', values: curve.nav, main: true },
                    { id: 'b', name: '0050', color: 'var(--d-2)', values: curve.bench, dash: 'dash' },
                    { id: 'ew', name: '等權', color: 'var(--d-3)', values: curve.ew, dash: 'dot' },
                  ]} />
              ) : (
                <div class="ui-card mf-dense">
                  <Table caption="逐年" testid="mf-bt-yearly" rowKey={(r) => r.year} rows={yearly} cols={[
                    { key: 'y', label: '年', width: '3rem', render: (r) => r.year },
                    { key: 'r', label: '流程', align: 'r', render: (r) => pctText(r.ret === null ? null : r.ret * 100) },
                    { key: 'b', label: '0050', align: 'r', render: (r) => pctText(r.bench === null ? null : r.bench * 100) },
                    { key: 'e', label: '等權', align: 'r', render: (r) => pctText(r.ew === null ? null : r.ew * 100) },
                    { key: 'd', label: '回撤', align: 'r', render: (r) => <>{pctText(r.mdd === null ? null : r.mdd * 100)}<span class="cell-sub">{r.trades} 筆</span></> },
                  ]} />
                </div>
              )}
            </>
          ) : null}
        </DataState>
      </Section>
      <Section title="濾網效度" testid="mf-filters" info={<><p>{HELP.filters.what}</p><p>{HELP.filters.why}</p></>} infoTitle="濾網效度">
        <DataState phase={phase} reason="回測結果累積中" testid="mf-filters-state">
          {d ? (
            <div class="ui-card mf-dense">
              <Table caption="各項門檻的前瞻報酬差" testid="mf-filters-table" rowKey={(r) => r.k} rows={d.filters} cols={[
                { key: 'k', label: '項目', width: '5.5rem', render: (r) => `${r.k} ${r.label}` },
                { key: 'm', label: '差（P − F）', align: 'r', render: (r) => <>{pctText(r.mean_diff === null ? null : r.mean_diff * 100, 2)}<span class="cell-sub">t {r.t === null ? '—' : fmtNum(r.t, 2)}</span></> },
                { key: 'n', label: '期數', align: 'r', width: '4rem', render: (r) => <>{r.periods}{!r.enough ? <span class="cell-sub">樣本不足</span> : null}</> },
                { key: 'a', label: '檔數 P／F', align: 'r', width: '4.5rem', render: (r) => `${intText(r.avg_p)}／${intText(r.avg_f)}` },
              ]} />
            </div>
          ) : null}
        </DataState>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- 參數表
function ParamsSection({ latest }: { latest: Latest }) {
  const [open, setOpen] = useState(false);
  return (
    <Section title="參數表" testid="mf-params">
      <Button block onClick={() => setOpen(!open)} testid="mf-params-toggle">{open ? '收起' : '查看全部門檻'}</Button>
      {open ? (
        <div class="ui-card">
          <Table caption="參數表" testid="mf-params-table" rowKey={(r) => r.k} rows={latest.params} cols={[
            { key: 'k', label: '項目', width: '7rem', render: (r) => r.k },
            { key: 'v', label: '數值', render: (r) => <>{r.v}<span class="cell-sub">{r.n}</span></> },
          ]} />
        </div>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------- 頁面
export default function MomentumFlow({ tab }: { tab?: string }) {
  const cur: Tab = (TABS.some(([k]) => k === tab) ? tab : 'market') as Tab;
  const latest = useAsync(loadLatest, []);
  const l = latest.data;
  useEffect(() => { if (!tab) navigate('/explore/momentum/market', true); }, [tab]);
  const pick = (t: Tab) => navigate(`/explore/momentum/${t}`, true);
  let body: ComponentChildren = null;
  if (l) {
    body = cur === 'market' ? <MarketTab latest={l} /> : cur === 'candidates' ? <CandidatesTab latest={l} /> : cur === 'holdings' ? <HoldingsTab latest={l} /> : <RecordsTab />;
  }
  return (
    <div class="page">
      {/* 頁首固定顯示資料基準日（規格第八節）：用 center 取代捲動後換成標題的 caption */}
      <TopBar back="/explore" center={<span class="topbar-caption caption on" data-testid="mf-topbar">{l ? `資料基準日 ${ymd(l.date)}` : '動能流程'}</span>} />
      <PageTitle title="動能流程" sub={<span data-testid="mf-basis">{l ? `資料基準日 ${ymd(l.date)}・更新 ${l.generated}` : '資料基準日 —'}</span>} />
      <Seg options={TABS} value={cur} onChange={pick} label="動能流程分頁" sticky testid="mf-tabs" />
      <DataState phase={latest.loading ? 'loading' : latest.error ? 'error' : l ? 'ok' : 'empty'} reason={latest.error ? '動能流程資料暫時無法取得（每日排程計算後出現）' : '資料累積中'} testid="mf-state-root">
        {body}
        {l ? <ParamsSection latest={l} /> : null}
      </DataState>
    </div>
  );
}
