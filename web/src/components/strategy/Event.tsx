/**
 * 策略詳情「事件研究」分段（M5）：檢視切換「合併｜逐年」累積超額曲線（1–120 日、95% 區間；Y 軸依四個基準一起算好固定）→
 * 多期間表 → 逐筆 40 日超額分布 → 最大／最小 10 筆 → 出場規則表（2021 年底前選）。
 * 曲線與多期間來自 strategy/{id}.json 的期間檢視；分布與最大最小來自逐筆檔 strategy/{id}-signals.json（只在這個分段載入）。
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Card, CardLabel, EmptyRow, List, Num, Row, Section, Seg, Signed, Table } from '../ui';
import { Conclusion, Interp, Term } from '../kit';
import { MONO, SeriesChart, type Series } from '../SeriesChart';
import { useAsync, useSegParam } from '../../hooks';
import { useScoredSummary } from '../../data/useSummary';
import { loadJson } from '../../data/api';
import type { BenchKey, StrategyPack } from '../../data/types';
import { BENCH_LABEL } from '../../lib/bench';
import type { StrategiesFile, StrategyItem } from '../../lib/strategies';
import { type Signals, excessOf, extremes, histogram, periodLabel, signalIdx } from '../../lib/strategyView';
import { setListContext } from '../../lib/listContext';
import { rel } from './Perf';
import { EDGE_TEXT } from '../../lib/curve';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const sgn = (v: number, d = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`;
const md = (iso: string) => `${iso.slice(2, 4)}/${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const BENCHES: BenchKey[] = ['ew', '0050', 'tr', '00631L'];
/** 最近三年由舊到新：深灰點線、淺灰虛線、白色實線；更早的年份最淡的細線 */
const RECENT: Pick<Series, 'color' | 'dash'>[] = [{ color: MONO.other, dash: 'dot' }, { color: MONO.bench, dash: 'dash' }, { color: MONO.main }];

function Curves({ pack, period, bench }: { pack: StrategyPack; period: string; bench: BenchKey }) {
  const [ev, setEv] = useSegParam<'all' | 'year'>(['all', 'year'] as const, 'all', 'ev');
  const [focusYear, setFocusYear] = useState<string | null>(null);
  const v = pack.periods[period];
  const line = v.curve?.[bench];
  const days = (line?.mean.length ?? 120);
  const dates = useMemo(() => Array.from({ length: days }, (_, i) => String(i + 1)), [days]);
  // 合併：Y 軸＝四個基準的平均與區間一起算（切換基準不重新縮放）
  const extraAll = useMemo(() => {
    const out: number[] = [];
    for (const b of BENCHES) for (const k of ['mean', 'lo', 'hi'] as const) for (const x of v.curve?.[b]?.[k] ?? []) if (fin(x)) out.push(x);
    return out;
  }, [v]);
  const years = Object.keys(pack.periods).filter((k) => k.startsWith('year:')).map((k) => k.slice(5))
    .filter((y) => y >= v.from.slice(0, 4) && y <= v.to.slice(0, 4)).sort();
  const extraYears = useMemo(() => {
    const out: number[] = [];
    for (const y of years) for (const b of BENCHES) for (const x of pack.periods[`year:${y}`]?.curve?.[b]?.mean ?? []) if (fin(x)) out.push(x);
    return out;
  }, [pack, years.join()]);
  const recent = years.slice(-3);
  const at40 = line?.mean[39];
  const peak = line ? line.mean.reduce<{ i: number; v: number } | null>((best, x, i) => (fin(x) && (!best || x > best.v) ? { i, v: x } : best), null) : null;
  return (
    <Section title="累積超額" aside={`${rel(bench)}・不扣成本`} testid="st-event">
      <Conclusion testid="event-concl">{fin(at40) ? `第 40 日 ${sgn(at40)}${peak ? (peak.i === days - 1 ? `・${EDGE_TEXT}` : `・峰值第 ${peak.i + 1} 日 ${sgn(peak.v)}`) : ''}` : '累積超額'}</Conclusion>
      <Seg options={[['all', '合併'], ['year', '逐年']] as const} value={ev} onChange={setEv} label="合併或逐年" small testid="event-view" />
      {ev === 'all' ? (
        line ? (
          <SeriesChart
            dates={dates}
            series={[{ id: bench, name: BENCH_LABEL[bench], color: MONO.main, values: line.mean, main: true }]}
            band={{ lo: line.lo, hi: line.hi, color: MONO.band, name: '95% 區間' }}
            axisExtra={extraAll}
            zero
            axisKey={`ev:${period}`}
            height={200}
            format={(x) => sgn(x)}
            tickFormat={(x) => `${x.toFixed(0)}%`}
            dateFormat={(d) => `第 ${d} 日`}
            label={`進場後累積超額（${rel(bench)}）`}
            testid="event-curve"
          />
        ) : <Interp>這個期間沒有累積超額曲線</Interp>
      ) : (
        <>
          <div class="chips wrap" role="group" aria-label="突顯年份" data-testid="event-years">
            {years.map((y) => <button key={y} type="button" class="chip" aria-pressed={focusYear === y} onClick={() => setFocusYear(focusYear === y ? null : y)}>{y}</button>)}
          </div>
          <SeriesChart
            dates={dates}
            series={years.map((y): Series => {
              const k = recent.indexOf(y);
              return { id: y, name: y, ...(k >= 0 ? RECENT[k + 3 - recent.length] : { color: MONO.faint }), values: pack.periods[`year:${y}`]?.curve?.[bench]?.mean ?? [], thin: k < 0, noLegend: true, noEnd: k < 0 };
            })}
            focus={focusYear}
            axisExtra={extraYears}
            zero
            axisKey={`evy:${period}`}
            height={200}
            format={(x) => sgn(x)}
            tickFormat={(x) => `${x.toFixed(0)}%`}
            dateFormat={(d) => `第 ${d} 日`}
            label={`各年的進場後累積超額（${rel(bench)}）`}
            testid="event-years-chart"
          />
          <Interp>最近三年較亮；點年份膠囊單獨突顯</Interp>
        </>
      )}
    </Section>
  );
}

function Multi({ pack, period, bench }: { pack: StrategyPack; period: string; bench: BenchKey }) {
  const m = pack.periods[period].multi;
  const rows = Object.keys(m).sort((a, b) => Number(a) - Number(b)).map((h) => ({ h, c: m[h][bench], n: m[h].n }));
  return (
    <Section title="多期間" aside={`${rel(bench)}・扣成本`} testid="st-multi">
      <Card>
        <Table
          caption={`各持有天數的超額，${rel(bench)}`}
          testid="multi-table"
          cols={[
            { key: 'h', label: '持有', width: '17%', render: (r) => `${r.h} 日` },
            { key: 'e', label: <Term id="excess_vs">超額</Term>, align: 'r', render: (r) => <Signed v={r.c?.excess ?? null} unit="%" tone="plain" /> },
            { key: 't', label: <Term id="adjusted_t">校正後 t</Term>, align: 'r', render: (r) => (fin(r.c?.t) ? (r.c?.t as number).toFixed(2) : '—') },
            { key: 'w', label: <Term id="excess_win">超額勝率</Term>, align: 'r', render: (r) => <Num v={r.c?.win ?? null} digits={1} unit="%" /> },
            { key: 'n', label: '樣本', align: 'r', width: '17%', render: (r) => (r.c?.n ?? r.n).toLocaleString('zh-TW') },
          ]}
          rows={rows}
          rowKey={(r) => r.h}
        />
      </Card>
      <Interp>120 日只做參考；判定用 40 日</Interp>
    </Section>
  );
}

/** 分布直方圖：每格的筆數；標出平均與中位數 */
function Histo({ vals, bench }: { vals: number[]; bench: BenchKey }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(360);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => setW(Math.max(240, Math.round(es[0].contentRect.width))));
    ro.observe(el);
    setW(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);
  const h = histogram(vals);
  const H = 150, top = 22, bottom = 20;
  const k = h.counts.length;
  const max = Math.max(1, ...h.counts);
  const x = (v: number) => ((v - h.lo) / (h.width * Math.max(1, k))) * w;
  const bw = w / Math.max(1, k);
  const y = (c: number) => top + (1 - c / max) * (H - top - bottom);
  const marks = [
    ...(fin(h.mean) ? [{ v: h.mean, name: '平均', cls: 'mean' }] : []),
    ...(fin(h.median) ? [{ v: h.median, name: '中位數', cls: 'median' }] : []),
  ];
  const pos = vals.filter((v) => v > 0).length;
  return (
    <div ref={ref} class="st-hist" data-testid="st-hist">
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`40 日超額分布（${rel(bench)}）：${h.n} 筆，平均 ${fin(h.mean) ? sgn(h.mean) : '無資料'}，中位數 ${fin(h.median) ? sgn(h.median) : '無資料'}`}>
        {h.counts.map((c, i) => {
          return <rect key={i} x={i * bw + 0.5} y={y(c)} width={Math.max(1, bw - 1)} height={H - bottom - y(c)} rx={1.5} fill={MONO.other} />;
        })}
        {fin(0) && 0 >= h.lo && 0 <= h.lo + h.width * k ? <line class="sc2-zero" x1={x(0)} x2={x(0)} y1={top} y2={H - bottom} /> : null}
        {marks.map((m, j) => {
          const xx = Math.max(0, Math.min(w, x(m.v)));
          const right = xx < w / 2;
          return (
            <g key={m.cls} class={`st-hist-m ${m.cls}`}>
              <line x1={xx} x2={xx} y1={top - 4} y2={H - bottom} />
              <text x={right ? xx + 4 : xx - 4} y={10 + j * 11} text-anchor={right ? 'start' : 'end'}>{m.name} {sgn(m.v)}</text>
            </g>
          );
        })}
        <text class="sc2-xl" x={0} y={H - 4}>{h.under ? '≤ ' : ''}{h.lo}%</text>
        <text class="sc2-xl" x={w} y={H - 4} text-anchor="end">{h.over ? '≥ ' : ''}{h.lo + h.width * k}%</text>
      </svg>
      <p class="ui-foot ui-muted st-hist-foot">{h.n.toLocaleString('zh-TW')} 筆・正超額 {h.n ? ((pos / h.n) * 100).toFixed(1) : '—'}%・每格 {h.width}%（兩端合併）</p>
    </div>
  );
}

function Distribution({ s, pack, period, bench }: { s: StrategyItem; pack: StrategyPack; period: string; bench: BenchKey }) {
  const sig = useAsync(() => loadJson<Signals>(`strategy/${encodeURIComponent(s.id)}-signals.json`).catch(() => null), [s.id]);
  const summary = useScoredSummary();
  const v = pack.periods[period];
  const xs = useMemo(() => excessOf(sig.data, signalIdx(sig.data, v.from, v.to), bench), [sig.data, v, bench]);
  const { top, bottom } = useMemo(() => extremes(xs), [xs]);
  const codes = (sig.data?.code ?? []) as string[];
  const dates = (sig.data?.signal ?? []) as string[];
  const name = (c: string) => (summary.data?.byCode.get(c)?.name as string | undefined) ?? c;
  const ctx = () => setListContext({ name: s.label, codes: [...top, ...bottom].map((x) => codes[x.i]) });
  const row = (x: { i: number; v: number }, k: number) => (
    <Row key={`${x.i}`} label={<>{name(codes[x.i])} <span class="ui-muted ui-foot">{codes[x.i]}</span></>} sub={`訊號 ${md(dates[x.i])}`}
      value={<Signed v={x.v} unit="%" tone="plain" />} href={`#/stock/${codes[x.i]}`} onClick={ctx} testid={`ext-${k}`} />
  );
  if (sig.loading) return <Section title="逐筆分布"><List><EmptyRow>載入逐筆資料</EmptyRow></List></Section>;
  if (!sig.data) return <Section title="逐筆分布"><List><EmptyRow>沒有逐筆資料</EmptyRow></List></Section>;
  return (
    <>
      <Section title="逐筆分布" aside={`40 日・${rel(bench)}`} testid="st-dist">
        <Histo vals={xs.map((x) => x.v)} bench={bench} />
        <Interp>判定卡為同日先平均，與逐筆平均不同</Interp>
      </Section>
      <Section title="最大 10 筆" aside={periodLabel(period)} testid="st-top">
        <List chev>{top.map(row)}</List>
      </Section>
      <Section title="最小 10 筆" aside={periodLabel(period)} testid="st-bottom">
        <List chev>{bottom.map(row)}</List>
      </Section>
    </>
  );
}

/** 出場規則的短名（表格用）。 */
export function exitShort(rule: string, p: string): string {
  const n = p.replace('-', '−');
  switch (rule) {
    case 'fixed': return `固定 ${p} 日`;
    case 'ma': return `跌破 ${p} 日線`;
    case 'stop': return `停損 ${n}%`;
    case 'trailing': return `高點回落 ${p}%`;
    case 'atr': return `回落 ${p} 倍 ATR`;
    case 'entry_low': return '跌破進場日低點';
    case 'exhaust': return '量縮且漲跌 ≤ 2%';
    case 'peak': return `第 ${p} 日出場`;
    default: return `${rule} ${p}`;
  }
}

function Exits({ s, data }: { s: StrategyItem; data: StrategiesFile }) {
  const ex = s.exits;
  const train = (ex?.train_end ?? data.judge_meta?.exits_train_end ?? '2021-12-31').slice(0, 4);
  if (!ex || !ex.rules.length) return <Section title="出場規則"><List><EmptyRow>沒有出場規則比較</EmptyRow></List></Section>;
  return (
    <Section title="出場規則" aside={`${train} 年底前選・全期間`} testid="st-exits">
      <Conclusion>選定：{ex.chosen ? exitShort(ex.chosen.rule, ex.chosen.param) : '—'}{ex.chosen?.basis === 'fallback' ? '（預設）' : ''}</Conclusion>
      <Card>
        <CardLabel aside="扣成本・相對 0050">事件平均</CardLabel>
        <Table
          caption="出場規則：樣本內與樣本外"
          cols={[
            { key: 'r', label: <Term id="exit_rule">規則</Term>, render: (r) => <span class={r.chosen ? 'ui-strong' : ''}>{exitShort(r.rule, r.param)}{r.chosen ? <span class="ui-foot ui-muted">・選定</span> : null}</span> },
            { key: 'i', label: '樣本內', align: 'r', width: '24%', render: (r) => <Signed v={r.in_sample.rel?.['0050'] ?? null} unit="%" tone="plain" /> },
            { key: 'o', label: <Term id="out_of_sample">樣本外</Term>, align: 'r', width: '24%', render: (r) => <Signed v={r.oos.rel?.['0050'] ?? null} unit="%" tone="plain" /> },
          ]}
          rows={ex.rules}
          rowKey={(r) => `${r.rule}:${r.param}`}
        />
      </Card>
      <Interp>{train} 年底前的訊號選參數；{ex.oos_start?.slice(0, 4) ?? '2022'} 年起為樣本外；分級與組合一律固定 40 日</Interp>
    </Section>
  );
}

export function EventPane({ s, data, pack, period, bench }: { s: StrategyItem; data: StrategiesFile; pack: StrategyPack; period: string; bench: BenchKey }) {
  return (
    <>
      <Curves pack={pack} period={period} bench={bench} />
      <Multi pack={pack} period={period} bench={bench} />
      <Distribution s={s} pack={pack} period={period} bench={bench} />
      <Exits s={s} data={data} />
    </>
  );
}

export { Exits as ExitsSection };
