/**
 * 大戶與散戶持股（#/stock/:code/holders）：集保股權分散表，門檻可調。
 * - 門檻：雙滑桿（只停在集保分級的邊界）＋常用組合；上次的設定會記住（IndexedDB）。
 * - 指標：持股比例｜人數｜人均張數；期間：3 個月｜6 個月｜1 年。
 * - 走勢：收盤價、大戶、散戶、大戶週增減（共用週別軸，各自一個 y 軸）。
 * - 最新一週的分級分布：依目前門檻分成散戶／中實戶／大戶三段，並列出期間內的變化。
 * 定義見 METHODOLOGY §4.8；設計紀錄見 docs/design/ROUND3.md。
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Banner } from '../components/DataStatus';
import { type ChartPanel, StackedChart } from '../components/StackedChart';
import { StockToolFrame, useStock } from '../components/StockTool';
import { IconSeed } from '../components/Icons';
import { getSetting, setSetting } from '../db/db';
import { uiConfig } from '../lib/config';
import { fmtPrice, numberFormat } from '../lib/format';
import {
  BREAKPOINTS,
  GROUP_NAME,
  type Group,
  type HolderBlock,
  LEVEL_LABEL,
  LEVEL_SHORT,
  METRICS,
  METRIC_NAME,
  METRIC_UNIT,
  type Metric,
  alignClose,
  bigLabel,
  changeText,
  clampThresholds,
  groupOf,
  groupRange,
  groupSeries,
  groupWeek,
  headline,
  metricText,
  shortTitle,
  smallLabel,
} from '../lib/holders';
import '../styles/tools.css';

const SETTING_KEY = 'holdersThreshold';
const PERIODS = [{ weeks: 13, label: '3 個月' }, { weeks: 26, label: '6 個月' }, { weeks: 52, label: '1 年' }] as const;
const GROUPS: Group[] = ['small', 'mid', 'big'];
const F1 = numberFormat(1);
const F2 = numberFormat(2);
const INT = numberFormat(0);

/** 座標軸數字（依指標） */
function axis(m: Metric) {
  return (v: number) => {
    if (m === 'pct') return F1.format(v);
    if (m === 'holders') return Math.abs(v) >= 1e4 ? `${Number((v / 1e4).toFixed(1))}萬` : INT.format(v);
    return Math.abs(v) >= 100 ? INT.format(v) : F1.format(v);
  };
}

/** 雙滑桿：左＝散戶門檻、右＝大戶門檻；只停在集保分級的邊界，兩者不交叉。 */
function ThresholdSlider({ small, big, onChange }: { small: number; big: number; onChange: (small: number, big: number) => void }) {
  const last = BREAKPOINTS.length - 1;
  const si = BREAKPOINTS.indexOf(small);
  const bi = BREAKPOINTS.indexOf(big);
  const pos = (i: number) => `${(i / last) * 100}%`;
  const LABELED = new Set([1, 10, 50, 100, 400, 1000]);
  return (
    <div class="hd-slider">
      <div class="hd-range" style={{ ['--a' as string]: pos(si), ['--b' as string]: pos(bi) }}>
        <div class="hd-track" aria-hidden="true">
          <span class="hd-seg small" />
          <span class="hd-seg big" />
          {BREAKPOINTS.map((b, i) => <span key={b} class="hd-tick" style={{ left: pos(i) }} />)}
        </div>
        <input type="range" min={0} max={last} step={1} value={si} aria-label="散戶門檻" aria-valuetext={`散戶：${smallLabel(small)}`}
          onInput={(e) => { const i = Math.min(Number((e.target as HTMLInputElement).value), bi - 1); (e.target as HTMLInputElement).value = String(i); onChange(BREAKPOINTS[i], big); }} />
        <input type="range" min={0} max={last} step={1} value={bi} aria-label="大戶門檻" aria-valuetext={`大戶：${bigLabel(big)}`}
          onInput={(e) => { const i = Math.max(Number((e.target as HTMLInputElement).value), si + 1); (e.target as HTMLInputElement).value = String(i); onChange(small, BREAKPOINTS[i]); }} />
      </div>
      <div class="hd-scale" aria-hidden="true">
        {BREAKPOINTS.map((b, i) => (LABELED.has(b) ? <span key={b} style={{ left: pos(i) }}>{b}</span> : null))}
      </div>
    </div>
  );
}

export default function Holders({ code }: { code: string }) {
  const s = useStock(code);
  const h = s.data;
  const block = (h?.holders as HolderBlock | null | undefined) ?? null;
  const cfg = uiConfig.holders;
  const [th, setTh] = useState(() => clampThresholds(cfg.default_small, cfg.default_big));
  const [metric, setMetric] = useState<Metric>('pct');
  const [weeks, setWeeks] = useState<number>(26);

  useEffect(() => {
    getSetting<{ small: number; big: number } | null>(SETTING_KEY, null)
      .then((v) => { if (v) setTh(clampThresholds(v.small, v.big)); })
      .catch(() => undefined);
  }, []);
  const change = (small: number, big: number) => {
    const next = clampThresholds(small, big);
    setTh(next);
    setSetting(SETTING_KEY, next).catch(() => undefined);
  };

  const n = block?.d.length ?? 0;
  const span = Math.min(weeks, n);
  const series = useMemo(() => (block ? groupSeries(block, weeks, th.small, th.big, metric) : null), [block, weeks, th, metric]);
  const closes = useMemo(() => (block && h && series ? alignClose(series.dates, h.d, h.c) : []), [block, h, series]);
  const latest = n - 1;
  const first = n - span;

  const title = !block ? '集保資料累積中' : shortTitle(block, weeks, th.small, th.big);
  const unit = METRIC_UNIT[metric];
  const panels: ChartPanel[] = series && series.dates.length ? [
    { id: 'close', title: '收盤價（元）', kind: 'lines', height: 64, series: [{ key: 'close', label: '收盤', values: closes }], format: (v) => numberFormat(Number.isInteger(v) ? 0 : 1).format(v), tipFormat: (v) => `${fmtPrice(v)} 元` },
    { id: 'big', title: `大戶（${bigLabel(th.big)}）${METRIC_NAME[metric]}（${unit}）`, kind: 'lines', height: 88, series: [{ key: 'big', label: '大戶', values: series.big }], format: axis(metric), tipFormat: (v) => metricText(v, metric) },
    { id: 'small', title: `散戶（${smallLabel(th.small)}）${METRIC_NAME[metric]}（${unit}）`, kind: 'lines', height: 88, series: [{ key: 'small', label: '散戶', values: series.small, style: 'dashed' }], format: axis(metric), tipFormat: (v) => metricText(v, metric) },
    { id: 'bigChg', title: `大戶每週增減（${metric === 'pct' ? '百分點' : unit}）`, kind: 'bars', height: 80, series: [{ key: 'bigChg', label: '大戶週增減', values: series.bigChange }], format: axis(metric), tipFormat: (v) => changeText(v, metric) },
  ] : [];

  return (
    <StockToolFrame code={code} h={h} loading={s.loading} error={s.error} tool="大戶與散戶持股" title={title}>
      {!block ? (
        <Banner icon={<IconSeed />} title="集保股權分散表資料累積中">
          集保開放資料每週只提供最新一週，本 App 每週六起逐週累積；過去一年的資料可由資料維護者執行「集保個股歷史」回補（關注清單內的股票）。
        </Banner>
      ) : (
        <>
          <p class="body ir-sentence" data-testid="hd-sentence">{headline(block, weeks, th.small, th.big)}。</p>
          {n < 4 ? (
            <Banner icon={<IconSeed />} title={`目前只有 ${n} 週資料`}>
              集保開放資料每週只提供最新一週，趨勢需要逐週累積；過去一年可由「集保個股歷史」回補（關注清單內的股票）。
            </Banner>
          ) : null}

          {/* 門檻 */}
          <section class="ir-card hd-card" aria-labelledby="hd-th-title">
            <div class="ir-card-head">
              <h2 class="caption w6" id="hd-th-title">門檻（張）</h2>
              <span class="caption muted">停在集保分級的邊界</span>
            </div>
            <div class="hd-presets" role="group" aria-label="常用門檻">
              {cfg.presets.map((p) => (
                <button key={p.label} class="chip" aria-pressed={p.small === th.small && p.big === th.big} onClick={() => change(p.small, p.big)}>{p.label}</button>
              ))}
            </div>
            <ThresholdSlider small={th.small} big={th.big} onChange={change} />
            <dl class="hd-groups">
              {GROUPS.map((g) => {
                const w = groupWeek(block, latest, g, th.small, th.big);
                return (
                  <div key={g} class={`hd-group ${g}`}>
                    <dt><span class="hd-swatch" aria-hidden="true" />{GROUP_NAME[g]}<span class="caption muted hd-range-text">{groupRange(g, th.small, th.big)}</span></dt>
                    <dd>
                      <span class="num hd-big-num">{w.pct === null ? '—' : `${F1.format(w.pct)}%`}</span>
                      <span class="caption muted">{metricText(w.holders, 'holders')}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>

          <div class="segmented ir-months" role="group" aria-label="指標">
            {METRICS.map((m) => <button key={m} aria-pressed={m === metric} onClick={() => setMetric(m)}>{METRIC_NAME[m]}</button>)}
          </div>
          <div class="segmented ir-months" role="group" aria-label="期間">
            {PERIODS.map((p) => <button key={p.weeks} aria-pressed={p.weeks === weeks} onClick={() => setWeeks(p.weeks)}>{p.label}</button>)}
          </div>

          <h2 class="section ir-h2">走勢・{series?.dates.length ?? 0} 週</h2>
          {panels.length ? <StackedChart dates={series!.dates} panels={panels} label={`${h?.name ?? code}大戶與散戶${METRIC_NAME[metric]}走勢`} /> : null}

          {/* 分級分布（最新一週），依門檻分三段 */}
          <div class="ir-table-head">
            <h2 class="section ir-h2">分級分布</h2>
            <span class="caption muted">{block.d[latest]}</span>
          </div>
          <p class="caption muted">變化：與 {span} 週前（{block.d[first].slice(5).replace('-', '/')}）相比，單位為百分點</p>
          <div class="cd-wrap ir-wrap">
            <table class="cd-table hd-table" style={{ ['--dt' as string]: 1 }}>
              <colgroup><col class="hd-col-level" /><col /><col /><col /></colgroup>
              <thead>
                <tr><th scope="col" class="cd-dh">持股分級（張）</th><th scope="col"><span class="cd-h">人數</span></th><th scope="col"><span class="cd-h">比例</span></th><th scope="col"><span class="cd-h">變化</span></th></tr>
              </thead>
              {GROUPS.map((g) => {
                const levels = Array.from({ length: 15 }, (_, i) => i + 1).filter((lv) => groupOf(lv, th.small, th.big) === g);
                if (!levels.length) return null;
                const now = groupWeek(block, latest, g, th.small, th.big);
                const then = groupWeek(block, first, g, th.small, th.big);
                const d = now.pct !== null && then.pct !== null ? now.pct - then.pct : null;
                return (
                  <tbody key={g} class={`hd-sec ${g}`}>
                    <tr class="total">
                      <th scope="rowgroup"><span class="cd-date">{GROUP_NAME[g]}</span><span class="cd-sub">{groupRange(g, th.small, th.big)}</span></th>
                      <td class="cd-v">{metricText(now.holders, 'holders').replace(' 人', '')}</td>
                      <td class="cd-v">{now.pct === null ? '—' : `${F2.format(now.pct)}%`}</td>
                      <td class={`cd-v ${d === null ? '' : d > 0.005 ? 'up' : d < -0.005 ? 'down' : ''}`}>{d === null ? '—' : `${d > 0.005 ? '▲' : d < -0.005 ? '▼' : ''}${F2.format(Math.abs(d))}`}</td>
                    </tr>
                    {levels.map((lv) => {
                      const p = block.p[lv - 1][latest];
                      const p0 = block.p[lv - 1][first];
                      const dd = p !== null && p0 !== null ? p - p0 : null;
                      const holders = block.n[lv - 1][latest];
                      return (
                        <tr key={lv} class="hd-level">
                          <th scope="row"><span class="hd-level-label" aria-hidden="true">{LEVEL_SHORT[lv - 1]}</span><span class="sr-only">{LEVEL_LABEL[lv - 1]}</span></th>
                          <td class="cd-v">{holders === null ? '—' : INT.format(holders)}</td>
                          <td class="cd-v"><span class="hd-bar" style={{ width: `${Math.min(100, p ?? 0)}%` }} aria-hidden="true" />{p === null ? '—' : `${F2.format(p)}%`}</td>
                          <td class={`cd-v ${dd === null ? '' : dd > 0.005 ? 'up' : dd < -0.005 ? 'down' : ''}`}>{dd === null ? '—' : `${dd > 0.005 ? '▲' : dd < -0.005 ? '▼' : ''}${F2.format(Math.abs(dd))}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })}
            </table>
          </div>

          <details class="tech cd-notes">
            <summary>逐週數字（{METRIC_NAME[metric]}）</summary>
            <div class="cd-wrap ir-wrap">
              <table class="cd-table hd-weeks" style={{ ['--dt' as string]: 1 }}>
                <thead><tr><th scope="col" class="cd-dh">週</th><th scope="col">收盤</th><th scope="col">大戶</th><th scope="col">散戶</th></tr></thead>
                <tbody>
                  {series ? [...series.dates.keys()].reverse().map((i) => (
                    <tr key={series.dates[i]}>
                      <th scope="row"><span class="cd-date hd-week">{series.dates[i].slice(5).replace('-', '/')}</span></th>
                      <td class="cd-v">{fmtPrice(closes[i])}</td>
                      <td class="cd-v">{metricText(series.big[i], metric)}</td>
                      <td class="cd-v">{metricText(series.small[i], metric)}</td>
                    </tr>
                  )) : null}
                </tbody>
              </table>
            </div>
          </details>
          <details class="tech cd-notes">
            <summary>計算方式與資料來源</summary>
            <p class="caption muted">
              集保股權分散表依「每週最後一個營業日」各集保戶的持股歸戶後分 15 級。門檻只能停在分級邊界：散戶＝持有「X 張以下」的分級（X＝1 時只含零股），大戶＝持有「超過 Y 張」的分級，兩者之間為中實戶。
              比例＝占集保庫存數的比例（%）；人均張數＝該群持股股數 ÷ 人數 ÷ 1,000。同一人以同一身分證歸戶，但法人、信託、專戶各自計算，大戶不等於單一主力。
            </p>
            <p class="caption muted">資料來源：臺灣集中保管結算所「集保戶股權分散表」（開放資料每週最新一週；過去一年為個股歷史查詢），依政府資料開放授權條款使用。</p>
          </details>
        </>
      )}
    </StockToolFrame>
  );
}
