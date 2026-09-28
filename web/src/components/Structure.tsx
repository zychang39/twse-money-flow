/**
 * 籌碼結構（v3 M2-3）：集保股權分散表的四級（散戶／中實戶／大戶／千張大戶，定義見 config/ui.yml holders.tiers）。
 * - StructureBar：一條堆疊比例條＋每段的本週變化箭頭（百分點）。
 * - HolderTrend：走勢圖（比例｜人數｜人均張數；3 個月｜6 個月｜1 年），資料不足時單點＋說明。
 * - StructureBlock：個股頁區塊（一句話結論在區塊標題）；走勢放在「查看趨勢」點開的底部面板。
 */
import { useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { type ChartPanel, StackedChart } from './StackedChart';
import { Sheet } from './Sheet';
import { IconChevron } from './Icons';
import { fmtPrice, numberFormat } from '../lib/format';
import {
  METRICS,
  METRIC_NAME,
  METRIC_UNIT,
  TIERS,
  TIER_NAME,
  type HolderBlock,
  type Metric,
  alignClose,
  bigLabel,
  changeText,
  groupSeries,
  metricText,
  smallLabel,
  tierDefinition,
  tierRange,
  tierStats,
} from '../lib/holders';
import { coverage, coverageNote } from '../lib/series';
import '../styles/tools.css';

const F1 = numberFormat(1);
const F2 = numberFormat(2);
const INT = numberFormat(0);

export const HOLDER_PERIODS = [{ weeks: 13, label: '3 個月' }, { weeks: 26, label: '6 個月' }, { weeks: 52, label: '1 年' }] as const;

function axis(m: Metric) {
  return (v: number) => {
    if (m === 'pct') return F1.format(v);
    if (m === 'holders') return Math.abs(v) >= 1e4 ? `${Number((v / 1e4).toFixed(1))}萬` : INT.format(v);
    return Math.abs(v) >= 100 ? INT.format(v) : F1.format(v);
  };
}

/** 堆疊比例條（最新一週）＋每段本週變化。 */
export function StructureBar({ block }: { block: HolderBlock }) {
  const st = tierStats(block);
  const total = st.reduce((a, s) => a + (s.pct ?? 0), 0) || 100;
  return (
    <div class="st-bar-wrap" data-testid="structure-bar">
      <div class="st-bar" role="img" aria-label={`籌碼結構（${block.d[block.d.length - 1]}）：${st.map((s) => `${TIER_NAME[s.tier]} ${s.pct === null ? '沒有資料' : `${F1.format(s.pct)}%`}`).join('、')}`}>
        {st.map((s) => <span key={s.tier} class={`st-seg ${s.tier}`} style={{ width: `${((s.pct ?? 0) / total) * 100}%` }} />)}
      </div>
      <dl class="st-legend">
        {st.map((s) => {
          const d = s.change;
          const dir = d === null || Math.abs(d) < 0.005 ? 'flat' : d > 0 ? 'up' : 'down';
          return (
            <div key={s.tier} class={`st-item ${s.tier}`}>
              <dt><span class="st-swatch" aria-hidden="true" />{TIER_NAME[s.tier]}<span class="st-range">{tierRange(s.tier)}</span></dt>
              <dd>
                <span class="num st-pct">{s.pct === null ? '—' : `${F1.format(s.pct)}%`}</span>
                <span class={`num st-chg ${dir}`}>
                  {d === null ? <span class="muted">週變化 —</span> : (
                    <>
                      <span aria-hidden="true">{dir === 'up' ? '▲' : dir === 'down' ? '▼' : ''}{F2.format(Math.abs(d))}</span>
                      <span class="sr-only">本週{dir === 'up' ? '增加' : dir === 'down' ? '減少' : '持平'} {F2.format(Math.abs(d))} 個百分點</span>
                    </>
                  )}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/** 走勢圖（比例｜人數｜人均張數）；資料不足時標題仍寫所選期間，另外說明。 */
export function HolderTrend({ block, d, c, name }: { block: HolderBlock; d: string[]; c: (number | null)[]; name: string }) {
  const [metric, setMetric] = useState<Metric>('pct');
  const [weeks, setWeeks] = useState<number>(26);
  const { retail_max: small, big_min: big, whale_min: whale } = TIERS;
  const s400 = useMemo(() => groupSeries(block, weeks, small, big, metric), [block, weeks, metric]);
  const s1000 = useMemo(() => groupSeries(block, weeks, small, whale, metric), [block, weeks, metric]);
  const closes = useMemo(() => alignClose(s400.dates, d, c), [s400, d, c]);
  const unit = METRIC_UNIT[metric];
  const label = HOLDER_PERIODS.find((p) => p.weeks === weeks)!.label;
  const note = coverageNote(coverage(block.d.slice(-weeks), weeks), '週');
  const panels: ChartPanel[] = s400.dates.length ? [
    { id: 'close', title: '收盤價（元）', kind: 'lines', height: 64, series: [{ key: 'close', label: '收盤', values: closes }], format: (v) => numberFormat(Number.isInteger(v) ? 0 : 1).format(v), tipFormat: (v) => `${fmtPrice(v)} 元` },
    { id: 'whale', title: `千張大戶（${bigLabel(whale)}）${METRIC_NAME[metric]}（${unit}）`, kind: 'lines', height: 80, series: [{ key: 'whale', label: '千張大戶', values: s1000.big }], format: axis(metric), tipFormat: (v) => metricText(v, metric) },
    { id: 'big', title: `大戶（${bigLabel(big)}，含千張）${METRIC_NAME[metric]}（${unit}）`, kind: 'lines', height: 80, series: [{ key: 'big', label: '大戶', values: s400.big }], format: axis(metric), tipFormat: (v) => metricText(v, metric) },
    { id: 'small', title: `散戶（${smallLabel(small)}）${METRIC_NAME[metric]}（${unit}）`, kind: 'lines', height: 80, series: [{ key: 'small', label: '散戶', values: s400.small, style: 'dashed' }], format: axis(metric), tipFormat: (v) => metricText(v, metric) },
    { id: 'whaleChg', title: `千張大戶每週增減（${metric === 'pct' ? '百分點' : unit}）`, kind: 'bars', height: 72, series: [{ key: 'whaleChg', label: '千張大戶週增減', values: s1000.bigChange }], format: axis(metric), tipFormat: (v) => changeText(v, metric) },
  ] : [];
  return (
    <div class="hd-trend">
      <div class="segmented ir-months" role="group" aria-label="指標">
        {METRICS.map((m) => <button key={m} aria-pressed={m === metric} onClick={() => setMetric(m)}>{METRIC_NAME[m]}</button>)}
      </div>
      <div class="segmented ir-months" role="group" aria-label="期間">
        {HOLDER_PERIODS.map((p) => <button key={p.weeks} aria-pressed={p.weeks === weeks} onClick={() => setWeeks(p.weeks)}>{p.label}</button>)}
      </div>
      <h3 class="section ir-h2">走勢・{label}</h3>
      {note ? <p class="caption muted hd-note" data-testid="hd-coverage" role="note">{note}。集保開放資料每週只提供最新一週，過去一年由「集保個股歷史」回補（關注清單內的股票）。</p> : null}
      {panels.length ? <StackedChart dates={s400.dates} panels={panels} label={`${name}籌碼結構${METRIC_NAME[metric]}走勢`} /> : null}
    </div>
  );
}

/** 個股頁「籌碼結構」區塊的內容（標題由頁面的 Block 提供）。 */
export function StructureBlock({ block, d, c, name, code, extra }: { block: HolderBlock | null; d: string[]; c: (number | null)[]; name: string; code: string; extra?: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  if (!block || !block.d.length) {
    return <p class="caption muted" style={{ marginTop: 'var(--s-3)' }}>集保股權分散表資料累積中：官方開放資料每週只提供最新一週，每週六起逐週累積。</p>;
  }
  return (
    <>
      <StructureBar block={block} />
      <p class="caption muted st-def">分級：{tierDefinition()}。資料日 {block.d[block.d.length - 1]}，變化為與前一週相比（百分點）。</p>
      {extra}
      <div class="list">
        <button class="list-item brand" onClick={() => setOpen(true)}>
          <span class="grow">查看趨勢<span class="caption muted tool-sub">千張大戶、大戶、散戶的持股比例、人數、人均張數逐週走勢</span></span>
          <span class="chev"><IconChevron /></span>
        </button>
        <a class="list-item brand" href={`#/stock/${code}/holders`}>
          <span class="grow">15 級完整分布<span class="caption muted tool-sub">集保每個持股分級的人數、比例與期間變化</span></span>
          <span class="chev"><IconChevron /></span>
        </a>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} detent="full" title="籌碼結構趨勢">
        {open ? <HolderTrend block={block} d={d} c={c} name={name} /> : null}
      </Sheet>
    </>
  );
}
