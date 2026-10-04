/**
 * 策略詳情「績效」分段（M5）：判定卡 → 檢視切換「累積｜逐年」→ 統計區 → 年度表 → 穩定度。
 * 數字全部來自 strategy/{id}.json 的期間檢視（pipeline evidence/periods.py）；分級一律以全期間為準。
 * 組合層級（5 檔組合、隨機選股）的基準：等權沒有持有不動的組合，改比 0050。
 */
import { useMemo, useState } from 'preact/hooks';
import { Card, List, Num, Row, Section, Seg, Signed, Table, StatGrid, Tag } from '../ui';
import { Conclusion, DivergingBar, Interp, RangeBar, Term } from '../kit';
import { BarChart, MONO, SeriesChart, type Series } from '../SeriesChart';
import { useSegParam } from '../../hooks';
import { navigate, useRoute } from '../../router';
import { useScoredSummary } from '../../data/useSummary';
import type { BenchKey, CardBench, StrategyPack } from '../../data/types';
import { BENCH_LABEL } from '../../lib/bench';
import { type StrategyItem, gradeOf, healthTone } from '../../lib/strategies';
import { monthMark, periodLabel, portBench, yearStripes, yearSummary, yearsIn } from '../../lib/strategyView';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pct = (v: number | null | undefined, d = 2) => <Signed v={v ?? null} digits={d} unit="%" tone="plain" />;
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const times = (v: number) => (v >= 10 ? `${v.toFixed(0)} 倍` : `${v.toFixed(2)} 倍`);
/** 「相對 0050」「相對等權」：中英數之間留空白 */
export const rel = (b: BenchKey) => (b === '0050' || b === '00631L' ? `相對 ${BENCH_LABEL[b]}` : `相對${BENCH_LABEL[b]}`);
const sgn = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`;

/**
 * 單色序列樣式（2026-10-04）：5 檔組合＝白色加粗帶柔光；所選基準＝淺灰實線；其餘基準＝深灰，用虛線、點線區分。
 * 靠線尾名稱、點線突顯、長按單獨顯示辨識，不靠顏色。
 */
export const PORT_COLOR = MONO.main;
const OTHER_DASH: Record<PortBenchKey, 'dash' | 'dot'> = { '0050': 'dash', tr: 'dot', '00631L': 'dash' };
type PortBenchKey = 'tr' | '0050' | '00631L';
export function benchStyle(k: PortBenchKey, selected: PortBenchKey): Pick<Series, 'color' | 'dash'> {
  return k === selected ? { color: MONO.bench } : { color: MONO.other, dash: OTHER_DASH[k] };
}

/** 校正後 t＋門檻刻度條（0～5；門檻以刻度標出） */
function TCell({ t, thr, label }: { t: number | null | undefined; thr: number; label: string }) {
  return (
    <span class="st-tcell">
      <span class="ui-num">{fin(t) ? t.toFixed(2) : '—'}</span>
      <RangeBar low={-1} high={5} label={`${label} 校正後 t ${fin(t) ? t.toFixed(2) : '無資料'}，門檻 ${thr.toFixed(1)}`}
        markers={[{ v: thr, kind: 'tick', color: 'var(--text-2)' }, ...(fin(t) ? [{ v: Math.max(-1, Math.min(5, t)), color: t >= thr ? MONO.main : MONO.other }] : [])]} />
    </span>
  );
}

export function JudgeCard({ s, opp, sig, period }: { s: StrategyItem; opp: CardBench; sig: CardBench; period: string }) {
  const g = typeof s.grade === 'object' ? s.grade : null;
  const grade = gradeOf(s);
  const h = s.health;
  const fw = s.forward ?? s.swing?.forward;
  const rows = [
    { k: '超額', a: pct(opp.excess), b: pct(sig.excess), term: 'excess_vs' },
    { k: '校正後 t', a: <TCell t={opp.t} thr={2} label="機會成本" />, b: <TCell t={sig.t} thr={3} label="訊號檢定" />, term: 'adjusted_t' },
    { k: '超額勝率', a: <Num v={opp.win} digits={1} unit="%" />, b: <Num v={sig.win} digits={1} unit="%" />, term: 'excess_win' },
    { k: '中位數超額', a: pct(opp.median), b: pct(sig.median), term: 'median_excess' },
  ];
  // 全期間＝分級的理由；其他期間只陳述該期間的兩個 t（分級不隨期間改變）
  const tt = (t: number | null | undefined) => (fin(t) ? t.toFixed(2) : '—');
  const concl = period !== 'all' ? `${periodLabel(period)}：機會成本 t ${tt(opp.t)}・訊號檢定 t ${tt(sig.t)}`
    : grade === 'valid' ? '兩項檢定都過門檻' : g?.reasons?.[0] ?? '未達門檻';
  return (
    <Section title="判定" aside={period === 'all' ? '全期間・40 日・扣成本' : `${periodLabel(period)}・40 日`} testid="st-judge">
      <Conclusion testid="judge-concl">{concl}</Conclusion>
      <Card testid="st-judge-card">
        <Table
          caption="判定卡：機會成本（相對 0050）與訊號檢定（相對同日等權）"
          testid="judge-table"
          cols={[
            { key: 'k', label: '指標', width: '30%', render: (r) => <Term id={r.term}>{r.k}</Term> },
            { key: 'a', label: <Term id="opportunity_cost">機會成本・0050</Term>, align: 'r', render: (r) => <span data-testid={`judge-opp-${r.term}`}>{r.a}</span> },
            { key: 'b', label: <Term id="signal_test">訊號檢定・等權</Term>, align: 'r', render: (r) => <span data-testid={`judge-sig-${r.term}`}>{r.b}</span> },
          ]}
          rows={rows}
          rowKey={(r) => r.k}
        />
      </Card>
      <List>
          <Row label={<Term id="strategy_health">健康度</Term>} sub={h ? `近 60 日 ${h.recent60 ? sgn(h.recent60.excess ?? 0, 2) : '—'}（${h.recent60?.n ?? h.recent_n} 筆）・全期間` : undefined}
            value={h ? (healthTone(h.status) === 'risk' ? <Tag tone="risk">{h.status}</Tag> : h.status) : '—'} testid="st-health" />
          <Row label={<Term id="forward_test">待前瞻驗證</Term>} sub={fw ? `${md(fw.since)} 起的新訊號滿 ${fw.required_days} 個交易日才比對` : undefined}
            value={fw ? (fw.ready ? (fin(fw.mean_excess) ? sgn(fw.mean_excess, 2) : '—') : `${fw.elapsed_days}／${fw.required_days} 日`) : '—'} testid="st-forward" />
      </List>
      <Interp>分級標籤以全期間計算；{g?.notes?.length ? g.notes.join('・') : '門檻在評估前寫死'}</Interp>
    </Section>
  );
}

function Cumulative({ pack, period, slots, bench }: { pack: StrategyPack; period: string; slots: number; bench: BenchKey }) {
  const v = pack.periods[period];
  const w = v.weekly;
  const [log, setLog] = useState(true);
  const summary = useScoredSummary();
  const [held, setHeld] = useState<number | null>(null);
  // 持股只存在全期間的週序列：其他期間依日期對回
  const heldBy = useMemo(() => {
    const a = pack.periods.all?.weekly;
    const m = new Map<string, string[]>();
    a?.dates.forEach((d, i) => m.set(d, a.held?.[i] ?? []));
    return m;
  }, [pack]);
  if (!w || w.dates.length < 2) return <Interp>這個期間沒有週權益序列</Interp>;
  const band = v.random.band;
  const sel = portBench(bench);
  const series: Series[] = [
    { id: 'port', name: `${slots} 檔`, color: PORT_COLOR, values: w.port, main: true },
    { id: '0050', name: '0050', ...benchStyle('0050', sel), values: w['0050'] ?? [] },
    { id: 'tr', name: '加權報酬', ...benchStyle('tr', sel), values: w.tr ?? [] },
    { id: '00631L', name: '00631L', ...benchStyle('00631L', sel), values: w['00631L'] ?? [] },
    ...(band ? [{ id: 'rnd', name: '隨機中位數', color: MONO.faint, values: band.p50, thin: true, noLegend: true }] : []),
  ];
  const name = (c: string) => (summary.data?.byCode.get(c)?.name as string | undefined) ?? c;
  const holdAt = (i: number) => heldBy.get(w.dates[i]) ?? [];
  let hi = held ?? w.dates.length - 1;
  if (held === null) while (hi > 0 && !holdAt(hi).length) hi--;
  const hold = holdAt(hi);
  return (
    <>
      <div class="st-cum-head">
        <span class="ui-foot ui-muted">權益曲線（期初＝1）</span>
        <button type="button" class="text-btn" onClick={() => setLog(!log)} aria-pressed={log} data-testid="log-toggle">{log ? '對數軸' : '線性軸'}</button>
      </div>
      <SeriesChart
        dates={w.dates}
        series={series}
        band={band ? { lo: band.p5, hi: band.p95, color: MONO.band, name: '隨機 5–95%' } : undefined}
        log={log}
        axisKey={`${period}:${log}`}
        height={240}
        format={times}
        tickFormat={(t) => (t >= 10 ? t.toFixed(0) : String(Number(t.toFixed(2))))}
        dateFormat={(d) => `${d.slice(0, 4)}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`}
        defaultHidden={['00631L']}
        stripes={yearStripes(w.dates)}
        readoutExtra={(i) => (holdAt(i).length ? `持股 ${holdAt(i).map(name).join('、')}` : '沒有持股')}
        onPick={setHeld}
        label="5 檔組合與基準的權益曲線"
        testid="st-equity"
      />
      {w.drawdown ? (
        <SeriesChart
          dates={w.dates}
          series={[{ id: 'dd', name: '回撤', color: MONO.bench, values: w.drawdown }]}
          axisKey={`${period}:dd`}
          height={96}
          zero
          format={(x) => `${x.toFixed(1)}%`}
          tickFormat={(x) => `${x.toFixed(0)}%`}
          dateFormat={(d) => `${d.slice(0, 4)}/${Number(d.slice(5, 7))}`}
          label={`${slots} 檔組合的回撤`}
          testid="st-drawdown"
        />
      ) : null}
      <p class="st-held ui-foot" data-testid="st-held">
        <span class="ui-muted">{md(w.dates[hi])} 當週持股：</span>
        {hold.length ? hold.map((c, k) => <span key={c}><a href={`#/stock/${c}`}>{name(c)}</a>{k < hold.length - 1 ? '、' : ''}</span>) : '沒有持股'}
      </p>
    </>
  );
}

function Yearly({ pack, period, bench, slots, onYear }: { pack: StrategyPack; period: string; bench: BenchKey; slots: number; onYear: (y: string) => void }) {
  const b = portBench(bench);
  const rows = yearsIn(pack.years, pack.periods[period]);
  const ys = yearSummary(rows, b);
  const bl = BENCH_LABEL[b];
  const f = (v: number | null) => (fin(v) ? sgn(v) : '—');
  return (
    <>
      <StatGrid testid="st-year-stats" items={[
        { label: '年平均報酬', value: <>{f(ys.avg)}<span class="ui-foot ui-muted"> {bl} {f(ys.avgB)}</span></> },
        { label: `勝過 ${bl} 年數`, value: <>{ys.beat}<span class="ui-unit">／{ys.m} 年</span></> },
        { label: '虧損年數', value: <>{ys.loss}<span class="ui-foot ui-muted"> {bl} {ys.lossB}</span></> },
        { label: '單年最大虧損', value: <>{f(ys.worst)}<span class="ui-foot ui-muted"> {bl} {f(ys.worstB)}</span></> },
      ]} />
      <BarChart
        labels={rows.map((r) => r.year)}
        series={[
          { id: 'port', name: `${slots} 檔`, color: MONO.main, values: rows.map((r) => r.port) },
          { id: b, name: bl, color: MONO.other, values: rows.map((r) => r.bench[b] ?? null) },
        ]}
        format={(x) => `${x.toFixed(0)}%`}
        label={`逐年報酬：${slots} 檔組合與 ${bl}（點一年＝只看該年）`}
        onPick={(i) => onYear(rows[i].year)}
        testid="st-year-bars"
      />
      <Interp>點一年＝只看該年並回到累積檢視</Interp>
    </>
  );
}

function StatsSection({ pack, period, bench, slots }: { pack: StrategyPack; period: string; bench: BenchKey; slots: number }) {
  const v = pack.periods[period];
  const b = portBench(bench);
  const bp = v.bench[b];
  const items = [
    { k: 'cagr' as const, name: '年化報酬', term: 'annual_return', f: (x: number) => sgn(x) },
    { k: 'sharpe' as const, name: 'Sharpe', term: 'sharpe', f: (x: number) => x.toFixed(2) },
    { k: 'mdd' as const, name: '最大回撤', term: 'max_drawdown', f: (x: number) => sgn(x) },
  ];
  return (
    <Section title="統計" aside={`${slots} 檔｜${BENCH_LABEL[b]}`} testid="st-stats">
      <Conclusion>{fin(v.port.sharpe) && fin(bp?.sharpe) ? `Sharpe ${v.port.sharpe.toFixed(2)}，${v.port.sharpe >= (bp?.sharpe as number) ? '不低於' : '低於'} ${BENCH_LABEL[b]} ${(bp?.sharpe as number).toFixed(2)}` : '組合統計'}</Conclusion>
      <Card>
        {items.map((it) => {
          const p = v.port[it.k], q = bp?.[it.k] ?? null, r = v.random[it.k];
          const vals = [p, q, r?.p5, r?.p95].filter(fin);
          const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
          const pad = (hi - lo) * 0.08 || 1;
          return (
            <div key={it.k} class="st-srow" data-testid={`st-stat-${it.k}`}>
              <span class="st-srow-k"><Term id={it.term}>{it.name}</Term></span>
              <span class="st-srow-v ui-num">{fin(p) ? it.f(p) : '—'}</span>
              <span class="st-srow-b ui-num ui-muted">{BENCH_LABEL[b]} {fin(q) ? it.f(q) : '—'}</span>
              <span class="st-srow-bar">
                <RangeBar low={lo - pad} high={hi + pad}
                  band={r && fin(r.p5) && fin(r.p95) ? [r.p5, r.p95] : undefined}
                  markers={[
                    ...(r && fin(r.p50) ? [{ v: r.p50, kind: 'tick' as const, color: 'var(--text-2)' }] : []),
                    ...(fin(q) ? [{ v: q, color: MONO.other }] : []),
                    ...(fin(p) ? [{ v: p, color: 'var(--text-1)' }] : []),
                  ]}
                  label={`${it.name}：${slots} 檔 ${fin(p) ? it.f(p) : '無資料'}、${BENCH_LABEL[b]} ${fin(q) ? it.f(q) : '無資料'}、隨機 5–95% ${r && fin(r.p5) && fin(r.p95) ? `${it.f(r.p5)}～${it.f(r.p95)}` : '無資料'}`} />
              </span>
            </div>
          );
        })}
        <p class="ui-foot ui-muted st-srow-legend" data-audit-skip="">
          <span><i class="st-dot" style={{ background: MONO.main }} />{slots} 檔</span>
          <span><i class="st-dot" style={{ background: MONO.other }} />{BENCH_LABEL[b]}</span>
          <span><i class="st-bandkey" /><Term id="random_band">隨機 5–95%</Term>・刻度＝中位數</span>
        </p>
      </Card>
    </Section>
  );
}

function YearTable({ pack, period, bench, slots }: { pack: StrategyPack; period: string; bench: BenchKey; slots: number }) {
  const v = pack.periods[period];
  const b = portBench(bench);
  const rows = yearsIn(pack.years, v);
  type R = { year: string; n: number; ex: number | null; port: number | null; bench: number | null; total?: boolean };
  const list: R[] = [
    ...rows.map((r) => ({ year: r.year, n: r.n, ex: r.excess[bench], port: r.port, bench: r.bench[b] ?? null })),
    { year: '合計', n: v.card.n, ex: v.card[bench].excess, port: v.port.total, bench: v.bench[b]?.total ?? null, total: true },
  ];
  const diffs = list.map((r) => (fin(r.port) && fin(r.bench) ? r.port - r.bench : null));
  const maxD = Math.max(1, ...diffs.slice(0, -1).filter(fin).map(Math.abs));
  /** 合計列的累積報酬可達數千 %：≥ 1,000 不帶小數 */
  const num = (x: number | null, d = 1) => <Signed v={x} digits={fin(x) && Math.abs(x) >= 1000 ? 0 : d} tone="plain" />;
  return (
    <Section title="年度表" aside="%" testid="st-years">
      <Card class="st-ytable">
        <Table
          caption={`年度：筆數、訊號超額（${rel(bench)}）、${slots} 檔組合、${BENCH_LABEL[b]}、差額`}
          testid="year-table"
          cols={[
            { key: 'y', label: '年份', width: '12%', render: (r) => <span class={r.total ? 'ui-strong' : r.n < 30 ? 'ui-muted' : ''}>{r.year}</span> },
            { key: 'n', label: '筆數', width: '16%', align: 'r', render: (r) => <span class={r.n < 30 && !r.total ? 'ui-muted' : ''} data-testid={r.total ? 'year-total-n' : undefined}>{r.n.toLocaleString('zh-TW')}</span> },
            { key: 'e', label: `超額`, align: 'r', render: (r) => <span data-testid={r.total ? 'year-total-ex' : undefined}>{num(r.ex, 2)}</span> },
            { key: 'p', label: `${slots} 檔`, align: 'r', render: (r) => <span data-testid={r.total ? 'year-total-port' : `year-port-${r.year}`}>{num(r.port)}</span> },
            { key: 'b', label: BENCH_LABEL[b], align: 'r', render: (r) => num(r.bench) },
            { key: 'd', label: '差額', align: 'r', width: '20%', render: (r, i) => <>{num(diffs[i])}{r.total ? null : <span class="cell-sub"><DivergingBar value={diffs[i]} max={maxD} label={`差額 ${fin(diffs[i]) ? sgn(diffs[i] as number) : '無資料'}`} /></span>}</> },
          ]}
          rows={list}
          rowKey={(r) => r.year}
        />
      </Card>
      <Interp>超額＝訊號 40 日超額（{rel(bench)}）；筆數 &lt; 30 為灰字</Interp>
    </Section>
  );
}

function Rolling({ pack, period, bench }: { pack: StrategyPack; period: string; bench: BenchKey }) {
  const r = pack.rolling3y;
  const months = r.month ?? [];
  const line = r[bench];
  const v = pack.periods[period];
  if (!months.length || !line) {
    const n = pack.monthly.month?.length ?? 0;
    return (
      <Section title="穩定度" testid="st-rolling">
        <Interp testid="rolling-wait">資料累積中：滾動 3 年需要 36 個月，目前只有 {n} 個月（自 {pack.start.slice(0, 4)}/{Number(pack.start.slice(5, 7))} 起）</Interp>
      </Section>
    );
  }
  const extra: number[] = [];
  for (const k of ['ew', '0050', 'tr', '00631L'] as const) for (const arr of [r[k]?.lo ?? [], r[k]?.hi ?? []]) for (const x of arr) if (fin(x)) extra.push(x);
  const mk = period === 'all' ? null : monthMark(months, v.from, v.to);
  const last = line.mean.filter(fin).at(-1);
  return (
    <Section title="穩定度" aside={rel(bench)} testid="st-rolling">
      <Conclusion>{fin(last) ? `最近 3 年月均超額 ${sgn(last, 2)}` : '滾動 3 年'}</Conclusion>
      <SeriesChart
        dates={months}
        series={[{ id: bench, name: BENCH_LABEL[bench], color: MONO.main, values: line.mean, main: true }]}
        band={{ lo: line.lo, hi: line.hi, color: MONO.band, name: '95% 區間' }}
        axisExtra={extra}
        zero
        axisKey="rolling"
        height={160}
        format={(x) => sgn(x, 2)}
        tickFormat={(x) => `${x.toFixed(0)}%`}
        dateFormat={(d) => `${d.slice(0, 4)}/${Number(d.slice(5, 7))}`}
        mark={mk ? { ...mk, label: periodLabel(period) } : undefined}
        label={`滾動 3 年的 40 日訊號超額（${rel(bench)}）`}
        testid="st-rolling-chart"
      />
      <Interp><Term id="rolling_3y">滾動 3 年</Term>不受期間篩選影響{mk ? '；淡藍為所選期間' : ''}</Interp>
    </Section>
  );
}

export function PerfPane({ s, pack, period, bench }: { s: StrategyItem; pack: StrategyPack; period: string; bench: BenchKey }) {
  const [pv, setPv] = useSegParam<'cum' | 'year'>(['cum', 'year'] as const, 'cum', 'pv');
  const route = useRoute();
  /** 點某一年：期間切到「只看該年」並回到累積檢視（一次換網址，兩個參數同步） */
  const onYear = (y: string) => {
    if (!pack.periods[`year:${y}`]) return;
    const qs = new URLSearchParams(route.query);
    qs.set('p', `year:${y}`);
    qs.delete('pv');
    navigate(`${route.path}?${qs.toString()}`, true, 'none');
  };
  const v = pack.periods[period];
  const slots = pack.slots;
  const cards = useMemo(() => ({ opp: v.card['0050'], sig: v.card.ew }), [v]);
  return (
    <>
      <JudgeCard s={s} opp={cards.opp} sig={cards.sig} period={period} />
      <Section title={`${slots} 檔組合`} aside={`${periodLabel(period)}・${v.from.slice(0, 4)}–${v.to.slice(0, 4)}`} testid="st-portfolio">
        <Seg options={[['cum', '累積'], ['year', '逐年']] as const} value={pv} onChange={setPv} label="累積或逐年" small testid="perf-view" />
        {pv === 'cum' ? <Cumulative pack={pack} period={period} slots={slots} bench={bench} />
          : <Yearly pack={pack} period={period} bench={bench} slots={slots} onYear={onYear} />}
      </Section>
      <StatsSection pack={pack} period={period} bench={bench} slots={slots} />
      <YearTable pack={pack} period={period} bench={bench} slots={slots} />
      <Rolling pack={pack} period={period} bench={bench} />
    </>
  );
}
