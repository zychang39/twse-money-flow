/**
 * 紀錄分頁（2026-10-09 改版）：子分頁「回測｜分解｜環境｜變體｜槓桿｜濾網」。
 * 回測＝規格回測（近 3 年，注意名單起）；分解、環境、變體、槓桿＝長期研究（2018 起，backtest.json 的 research）；
 * 濾網＝K1–K6 效度。全部是歷史統計。
 */
import { useMemo, useState } from 'preact/hooks';
import { Seg, Section, StatGrid, Table } from '../../components/ui';
import { Conclusion, DataState, Interp } from '../../components/kit';
import { SeriesChart } from '../../components/SeriesChart';
import { useAsync } from '../../hooks';
import { fmtNum, md } from '../../lib/format';
import { loadBacktest, type BacktestFile, type CondMetric, type CondRow, type LevelCell, type Perf, type Research } from '../data';
import { intText, isSig, rPct, tText, wanText, ymd } from '../fmt';
import { HELP } from '../help';

const SUBS = [['bt', '回測'], ['decomp', '分解'], ['regime', '環境'], ['variants', '變體'], ['lev', '槓桿'], ['filters', '濾網']] as const;
type Sub = (typeof SUBS)[number][0];
const PERIODS = [['full', '全期'], ['first', '前段'], ['second', '後段']] as const;
type PeriodKey = (typeof PERIODS)[number][0];
const BASES = [['state', '狀態機'], ['regime', '＋動能環境']] as const;
type BaseKey = (typeof BASES)[number][0];

/** 數字欄固定寬度（375pt 四欄數字＋名稱一行放得下） */
const NUM_W = '3.6rem';
const num2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : fmtNum(v, 2));
/** 報酬（小數）→ 百分數不帶 %（表頭註明單位；四欄數字的窄表用） */
const pNum = (v: number | null | undefined) => rPct(v).replace('%', '');
function levLabel(k: string): string {
  if (k.startsWith('L')) return `${Number(k.slice(1))} 倍`;
  if (k.startsWith('VT')) return `波動 ≤${Number(k.slice(2))}`;
  if (k === 'RL') return '依環境';
  return k;
}

function info(id: keyof typeof HELP | string) {
  const h = HELP[id];
  return h ? <><p>{h.what}</p><p>{h.why}</p></> : undefined;
}

function periodNote(r: Research, p: PeriodKey): string {
  const [a, b, c, d] = r.split_dates;
  if (p === 'first') return `前段 ${ymd(a)}–${ymd(b)}`;
  if (p === 'second') return `後段 ${ymd(c)}–${ymd(d)}`;
  return `全期 ${ymd(r.period[0])}–${ymd(r.period[1])}（${r.months} 個月）`;
}

// ---------------------------------------------------------------- 回測（規格）
function SpecBacktest({ d }: { d: BacktestFile }) {
  const [view, setView] = useState<'cum' | 'yearly'>('cum');
  const [year, setYear] = useState<string>('all');
  const s = d.summary ?? {};
  const num = (k: string) => (s[k] === null || s[k] === undefined ? null : (s[k] as number));
  const pct = (k: string) => rPct(num(k), 2);
  // 依年份篩選：累加檢視把該年第一個點重設為 1,000,000；「全部」顯示整段
  const curve = useMemo(() => {
    const idx = d.curve.dates.map((_, i) => i).filter((i) => year === 'all' || d.curve.dates[i].startsWith(year));
    if (!idx.length) return null;
    const rebase = (arr: (number | null)[]) => {
      const b = arr[idx[0]];
      return idx.map((i) => (arr[i] === null || b === null || b === 0 ? null : (arr[i] as number) / b * 1_000_000));
    };
    return { dates: idx.map((i) => d.curve.dates[i]), nav: rebase(d.curve.nav), bench: rebase(d.curve.bench), ew: rebase(d.curve.ew) };
  }, [d, year]);
  const yearOpts = [['all', '全部'], ...d.years.map((y) => [y, y] as [string, string])] as readonly [string, string][];
  const yearly = year === 'all' ? d.yearly : d.yearly.filter((r) => r.year === year);
  return (
    <Section title="流程回測" aside={`${md(d.period[0])}–${md(d.period[1])}`} testid="mf-backtest" info={<>{info('backtest')}{d.notes.map((n) => <p key={n}>{n}</p>)}</>} infoTitle="流程回測">
      <Conclusion testid="mf-bt-concl">{d.period[0].slice(0, 4)}–{d.period[1].slice(0, 4)} 年化 {pct('cagr')}・相對 0050 {pct('excess_vs_0050')}</Conclusion>
      <Interp>{`規格回測（注意名單 2023-06 起才有，所以從 2023-10 開始）；扣除手續費與證交稅。2018 起的長期結果見「分解」「變體」。`}</Interp>
      <StatGrid testid="mf-bt-grid" items={[
        { label: '年化報酬', value: pct('cagr') }, { label: '年化波動', value: pct('vol') }, { label: '最大回撤', value: pct('mdd') },
        { label: '年換手率', value: num('turnover') === null ? '—' : `${fmtNum(num('turnover') as number, 2)} 倍` },
        { label: '成本侵蝕（年）', value: pct('cost_drag') },
        { label: '月超額平均', value: `${pct('excess_mean')}（${tText(num('excess_t'))}）` },
      ]} />
      <Seg options={[['cum', '累加'], ['yearly', '逐年']] as const} value={view} onChange={setView} label="檢視" testid="mf-bt-view" small />
      {yearOpts.length > 2 ? <Seg options={yearOpts} value={year} onChange={setYear} label="年份" testid="mf-bt-year" small /> : null}
      {view === 'cum' && curve ? (
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
            { key: 'r', label: '流程', align: 'r', render: (r) => rPct(r.ret) },
            { key: 'b', label: '0050', align: 'r', render: (r) => rPct(r.bench) },
            { key: 'e', label: '等權', align: 'r', render: (r) => rPct(r.ew) },
            { key: 'd', label: '回撤', align: 'r', render: (r) => <>{rPct(r.mdd)}<span class="cell-sub">{r.trades} 筆</span></> },
          ]} />
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- 分解
function Decomp({ r }: { r: Research }) {
  const [base, setBase] = useState<BaseKey>('state');
  const a = r.attribution[base];
  const v = r.variants[base];
  const idle = r.idle_in_0050[base].full;
  const bench = r.bench_perf.full;
  const rows = [
    { k: 'selection', label: '選股', sub: '持股 − 等權股票池', p: a.selection },
    { k: 'size', label: '權值股效應', sub: '等權股票池 − 0050', p: a.size },
    { k: 'cash', label: '現金拖累', sub: '沒投入的部分 × 0050', p: a.cash },
    { k: 'total', label: '合計', sub: '流程 − 0050', p: a.total },
  ];
  return (
    <>
      <Section title="為什麼落後 0050" aside={`${ymd(r.period[0])}–${ymd(r.period[1])}`} testid="mf-decomp" info={info('decomp')} infoTitle="報酬分解">
        <Seg options={BASES} value={base} onChange={setBase} label="變體" testid="mf-decomp-base" small />
        <Conclusion testid="mf-decomp-concl">{`選股 ${rPct(a.selection.annual)}・權值股 ${rPct(a.size.annual)}・現金 ${rPct(a.cash.annual)}（每年）`}</Conclusion>
        <Interp>{`平均只投入 ${fmtNum((v.invested ?? 0) * 100, 0)}%（曝險上限平均 ${fmtNum((v.exposure ?? 0) * 100, 0)}%；出場後的空名額要到下一個檢查日才補）。年化是每日算術平均 × 252，t 值用月合計。`}</Interp>
        <div class="ui-card mf-dense">
          <Table caption="流程 − 0050 的每年分解" testid="mf-decomp-table" rowKey={(x) => x.k} rows={rows} cols={[
            { key: 'l', label: '項目', render: (x) => <>{x.label}<span class="cell-sub">{x.sub}</span></> },
            { key: 'a', label: '每年', align: 'r', width: '5.5rem', render: (x) => <span class={isSig(x.p.t) ? 'mf-sig' : undefined}>{rPct(x.p.annual)}</span> },
            { key: 't', label: 't 值', align: 'r', width: '4.5rem', render: (x) => tText(x.p.t).replace('t ', '') },
          ]} />
        </div>
      </Section>
      <Section title="閒置資金改持有 0050（對照）" testid="mf-idle" info={info('variants')} infoTitle="回測變體">
        <Conclusion testid="mf-idle-concl">{`年化 ${rPct(idle.cagr)}・0050 ${rPct(bench.cagr)}`}</Conclusion>
        <Interp>{`流程沒投入的現金改放 0050（扣手續費與 ETF 證交稅）。最大回撤 ${rPct(idle.mdd)}，0050 本身 ${rPct(bench.mdd)}；月超額 ${rPct(idle.excess_mean, 2)}（${tText(idle.excess_t)}）。現金拖累消失，但空頭時的保護也一起消失。`}</Interp>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- 環境（條件統計）
const METRICS = [['prem', '動能因子'], ['flow', '流程'], ['flow_x', '流程−0050']] as const;
/** 表格裡的短名稱（375pt 一行放得下）；完整定義在 ⓘ */
const SHORT: Record<string, string> = {
  F1: '大盤狀態 1', F2: '因子趨勢向上', F3: '波動不在高檔', F4: '大盤一年上漲', F5: '過半站上季線', F6: '權值股領漲', S3: 'F1–F3 全符合',
};
const METRIC_NOTE: Record<CondMetric, string> = {
  prem: '動能因子＝RS ≥ 90 且有流動性的股票等權，減同流動性等權的月報酬（不扣成本）',
  flow: '流程＝狀態機變體的月報酬（扣成本）',
  flow_x: '流程 − 0050 的月報酬差',
  size: '等權股票池 − 0050',
};

function Conditions({ r }: { r: Research }) {
  const [metric, setMetric] = useState<CondMetric>('prem');
  const [period, setPeriod] = useState<PeriodKey>('full');
  const rows = r.conditions.filter((c): c is CondRow => c.k !== 'levels');
  const levels = (r.conditions.find((c) => c.k === 'levels') as { levels: LevelCell[] } | undefined)?.levels ?? [];
  // 兩段期間方向一致且 |t| ≥ 2 才算穩定
  const stable = rows.filter((c) => isSig(c.first[metric].t) && isSig(c.second[metric].t) && Math.sign(c.first[metric].diff ?? 0) === Math.sign(c.second[metric].diff ?? 0));
  const sigNow = rows.filter((c) => isSig(c[period][metric].t));
  const concl = stable.length
    ? `兩段期間都顯著：${stable.map((c) => c.k).join('、')}`
    : '沒有條件在前後兩段都達到 |t| ≥ 2';
  return (
    <Section title="動能環境的歷史統計" aside={`${r.months} 個月`} testid="mf-cond" info={info('conditions')} infoTitle="條件統計">
      <Seg options={METRICS} value={metric} onChange={setMetric} label="指標" testid="mf-cond-metric" small />
      <Seg options={PERIODS} value={period} onChange={setPeriod} label="期間" testid="mf-cond-period" small />
      <Conclusion testid="mf-cond-concl">{concl}</Conclusion>
      <Interp>{`${periodNote(r, period)}；${METRIC_NOTE[metric]}。這段期間 |t| ≥ 2：${sigNow.length ? sigNow.map((c) => c.k).join('、') : '無'}。`}</Interp>
      <div class="ui-card mf-dense">
        <Table caption="條件符合與不符合的月平均" testid="mf-cond-table" rowKey={(c) => c.k} rows={rows} cols={[
          { key: 'k', label: '條件', render: (c) => <>{c.k === 'S3' ? '順風' : c.k}<span class="cell-sub">{SHORT[c.k] ?? c.label}</span></> },
          { key: 'on', label: '符合', align: 'r', width: '4.5rem', render: (c) => <>{rPct(c[period][metric].on, 2)}<span class="cell-sub">{c[period][metric].n_on} 月</span></> },
          { key: 'off', label: '不符合', align: 'r', width: '4.5rem', render: (c) => <>{rPct(c[period][metric].off, 2)}<span class="cell-sub">{c[period][metric].n_off} 月</span></> },
          { key: 'd', label: '差', align: 'r', width: '4.5rem', render: (c) => <><span class={isSig(c[period][metric].t) ? 'mf-sig' : undefined}>{rPct(c[period][metric].diff, 2)}</span><span class="cell-sub">{tText(c[period][metric].t)}</span></> },
        ]} />
      </div>
      {levels.length ? (
        <div class="ui-card mf-dense">
          <Table caption="三個環境的月平均（全期）" testid="mf-cond-levels" rowKey={(x) => x.label} rows={levels} cols={[
            { key: 'l', label: '環境', render: (x) => <>{x.label}<span class="cell-sub">{x.n} 月</span></> },
            { key: 'p', label: '動能因子', align: 'r', render: (x) => rPct(x.prem, 2) },
            { key: 'f', label: '流程', align: 'r', render: (x) => rPct(x.flow, 2) },
            { key: 'x', label: '流程−0050', align: 'r', render: (x) => rPct(x.flow_x, 2) },
          ]} />
        </div>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------- 變體
function Variants({ r }: { r: Research }) {
  const [period, setPeriod] = useState<PeriodKey>('full');
  const pick = (pp: { full: Perf; first?: Perf; second?: Perf }) => pp[period] ?? {};
  const rows: { k: string; label: string; p: Perf; note?: string }[] = [
    { k: 'always', label: '不控制', p: pick(r.variants.always.perf), note: `投入 ${fmtNum((r.variants.always.invested ?? 0) * 100, 0)}%` },
    { k: 'state', label: '狀態機', p: pick(r.variants.state.perf), note: `投入 ${fmtNum((r.variants.state.invested ?? 0) * 100, 0)}%` },
    { k: 'regime', label: '＋環境', p: pick(r.variants.regime.perf), note: `投入 ${fmtNum((r.variants.regime.invested ?? 0) * 100, 0)}%` },
    { k: 'idle', label: '閒置放 0050', p: pick(r.idle_in_0050.state), note: '對照' },
    { k: '0050', label: '0050', p: pick(r.bench_perf), note: '含息' },
    { k: 'ew', label: '等權股票池', p: pick(r.ew_perf), note: '不扣成本' },
  ];
  const s = r.variants.state.perf.full, a = r.variants.always.perf.full;
  const yearly = r.yearly;
  return (
    <Section title="回測變體" aside={`${ymd(r.period[0])}–${ymd(r.period[1])}`} testid="mf-variants" info={info('variants')} infoTitle="回測變體">
      <Conclusion testid="mf-variants-concl">{`狀態機：最大回撤 ${rPct(a.mdd)} → ${rPct(s.mdd)}，年化 ${rPct(a.cagr)} → ${rPct(s.cagr)}`}</Conclusion>
      <Seg options={PERIODS} value={period} onChange={setPeriod} label="期間" testid="mf-variants-period" small />
      <Interp>{periodNote(r, period)}</Interp>
      <div class="ui-card mf-dense">
        <p class="ui-foot ui-muted mf-unit">年化、最大回撤、最差月單位：%</p>
        <Table caption="變體比較（單位 %）" testid="mf-variants-table" rowKey={(x) => x.k} rows={rows} cols={[
          { key: 'l', label: '變體', render: (x) => <>{x.label}{x.note ? <span class="cell-sub">{x.note}</span> : null}</> },
          { key: 'c', label: '年化', align: 'r', width: NUM_W, render: (x) => pNum(x.p.cagr) },
          { key: 'm', label: '最大回撤', align: 'r', width: NUM_W, render: (x) => pNum(x.p.mdd) },
          { key: 'w', label: '最差月', align: 'r', width: NUM_W, render: (x) => pNum(x.p.worst_month) },
          { key: 'k', label: 'Calmar', align: 'r', width: NUM_W, render: (x) => num2(x.p.calmar) },
        ]} />
      </div>
      <SeriesChart dates={r.curve.dates} axisKey="variants" height={200} log label="長期淨值（對數軸，萬元）" testid="mf-variants-chart" format={wanText} dateFormat={ymd}
        series={[
          { id: 'state', name: '狀態機', color: 'var(--d-1)', values: r.curve.state, main: true },
          { id: 'always', name: '不控制', color: 'var(--d-2)', values: r.curve.always, dash: 'dash' },
          { id: 'regime', name: '＋環境', color: 'var(--d-3)', values: r.curve.regime, dash: 'dot' },
          { id: 'b', name: '0050', color: 'var(--d-2)', values: r.curve.bench, thin: true },
        ]} />
      <div class="ui-card mf-dense">
        <Table caption="逐年" testid="mf-variants-yearly" rowKey={(x) => x.year} rows={yearly} cols={[
          { key: 'y', label: '年', width: '4rem', render: (x) => <>{x.year}<span class="cell-sub">順風 {x.tailwind === null ? '—' : `${Math.round(x.tailwind * 100)}%`}</span></> },
          { key: 'a', label: '不控制', align: 'r', render: (x) => rPct(x.always) },
          { key: 's', label: '狀態機', align: 'r', render: (x) => rPct(x.state) },
          { key: 'r', label: '＋環境', align: 'r', render: (x) => rPct(x.regime) },
          { key: 'b', label: '0050', align: 'r', render: (x) => rPct(x.bench) },
        ]} />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- 槓桿
function Leverage({ r }: { r: Research }) {
  const [base, setBase] = useState<BaseKey>('state');
  const rows = r.leverage[base];
  const one = rows.find((x) => x.k === 'L1.0');
  const two = rows.find((x) => x.k === 'L2.0');
  const calls = rows.reduce((s, x) => s + x.calls, 0);
  return (
    <Section title="曝險倍數與回撤" aside={`${ymd(r.period[0])}–${ymd(r.period[1])}`} testid="mf-lev" info={info('leverage')} infoTitle="曝險倍數（槓桿）">
      <Seg options={BASES} value={base} onChange={setBase} label="變體" testid="mf-lev-base" small />
      <Conclusion testid="mf-lev-concl">{one && two ? `1 倍回撤 ${rPct(one.mdd)}・2 倍 ${rPct(two.mdd)}（年化 ${rPct(two.cagr)}）` : '—'}</Conclusion>
      <Interp>{`每個檢查日重設倍數；融資年利率 ${fmtNum(Number(r.params.financing_rate) * 100, 1)}%、維持率 ${fmtNum(Number(r.params.maintenance) * 100, 0)}% 追繳。流程平均只投入一部分，所以總曝險比倍數低（見每列第二行）。${calls ? `共 ${calls} 次追繳。` : '這段期間沒有任何一列觸發追繳。'}歷史統計，不代表未來。`}</Interp>
      <div class="ui-card mf-dense">
        <p class="ui-foot ui-muted mf-unit">年化、最大回撤、最差一年單位：%</p>
        <Table caption="各倍數的報酬與回撤（單位 %）" testid="mf-lev-table" rowKey={(x) => x.k} rows={rows} cols={[
          { key: 'l', label: '倍數', render: (x) => <>{levLabel(x.k)}<span class="cell-sub">曝險 {x.gross_avg === null ? '—' : fmtNum(x.gross_avg, 2)}{x.calls ? `・追繳 ${x.calls}` : ''}</span></> },
          { key: 'c', label: '年化', align: 'r', width: NUM_W, render: (x) => (x.dead ? '歸零' : pNum(x.cagr)) },
          { key: 'm', label: '最大回撤', align: 'r', width: NUM_W, render: (x) => pNum(x.mdd) },
          { key: 'y', label: '最差一年', align: 'r', width: NUM_W, render: (x) => pNum(x.worst_12m) },
          { key: 'k', label: 'Calmar', align: 'r', width: NUM_W, render: (x) => num2(x.calmar) },
        ]} />
      </div>
      <p class="ui-foot ui-muted mf-note">{`曝險＝平均總曝險（部位 ÷ 權益）。波動：倍數＝${fmtNum(Number(r.params.vol_target) * 100, 0)}% ÷ 近 ${r.params.vol_lookback} 日年化波動，上限 1.5 或 2 倍。依環境：順風 1.5、中性 1、逆風 0.5 倍。`}</p>
    </Section>
  );
}

// ---------------------------------------------------------------- 濾網
function Filters({ d }: { d: BacktestFile }) {
  return (
    <Section title="濾網效度" testid="mf-filters" info={info('filters')} infoTitle="濾網效度">
      <div class="ui-card mf-dense">
        <Table caption="各項門檻的前瞻報酬差" testid="mf-filters-table" rowKey={(x) => x.k} rows={d.filters} cols={[
          { key: 'k', label: '項目', width: '5.5rem', render: (x) => `${x.k} ${x.label}` },
          { key: 'm', label: '差（P − F）', align: 'r', render: (x) => <>{rPct(x.mean_diff, 2)}<span class="cell-sub">{tText(x.t)}</span></> },
          { key: 'n', label: '期數', align: 'r', width: '4rem', render: (x) => <>{x.periods}{!x.enough ? <span class="cell-sub">樣本不足</span> : null}</> },
          { key: 'a', label: '檔數 P／F', align: 'r', width: '4.5rem', render: (x) => `${intText(x.avg_p)}／${intText(x.avg_f)}` },
        ]} />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- 分頁
export function RecordsTab() {
  const bt = useAsync(loadBacktest, []);
  const [sub, setSub] = useState<Sub>('bt');
  const d = bt.data;
  const phase = bt.loading ? 'loading' : bt.error ? 'error' : d ? 'ok' : 'empty';
  const r = d?.research;
  const needsResearch = sub === 'decomp' || sub === 'regime' || sub === 'variants' || sub === 'lev';
  return (
    <>
      <Seg options={SUBS} value={sub} onChange={setSub} label="紀錄分段" testid="mf-rec-tabs" small />
      <DataState phase={phase} reason={bt.error ? '回測結果累積中（每日排程計算後出現）' : '回測結果累積中'} testid="mf-backtest-state">
        {d ? (
          needsResearch && !r ? (
            <Interp testid="mf-research-empty">長期研究資料累積中（下一次每日更新後出現）</Interp>
          ) : sub === 'bt' ? <SpecBacktest d={d} />
            : sub === 'decomp' && r ? <Decomp r={r} />
              : sub === 'regime' && r ? <Conditions r={r} />
                : sub === 'variants' && r ? <Variants r={r} />
                  : sub === 'lev' && r ? <Leverage r={r} />
                    : <Filters d={d} />
        ) : null}
      </DataState>
    </>
  );
}
