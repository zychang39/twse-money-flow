/**
 * 指標效度表（M1；v3 M5）：每個指標一列，點開看依據（持有期、累積超額曲線、逐年、樣本外、環境、參數、出場比較）。
 * - 預設排序：判定分級 → 同級內 t 由高到低（不依超額排序）；「排序」選單可改，選擇記在 localStorage。
 * - 基準分段控制（等權｜加權報酬｜0050｜00631L）sticky 在列表上方，同頁所有數字、表格與曲線同步；判定一律以等權為準。
 * 資料由 pipeline 預先計算（evidence.json、evidence/{id}.json），與 docs/INDICATOR_EVIDENCE.md 同步。
 */
import { useMemo, useState } from 'preact/hooks';
import { PageHead, TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { useAsync } from '../hooks';
import { loadJson } from '../data/api';
import { LineChart } from '../components/LineChart';
import { AlphaCurve } from '../components/AlphaCurve';
import { BenchSwitch, useBenchState } from '../components/BenchSwitch';
import { SortMenu } from '../components/SortMenu';
import {
  type Brief, type EvidenceFile, type EvidenceRow, type EvidenceToday, type Filter, type Hindsight, type WeeklyCoverage,
  ciText, counts, coverageLabel, coverageText, delistText, filterRows, pctSigned, tText, verdictNote, verdictTone,
} from '../lib/evidence';
import { BENCH_LABEL, BENCH_LONG, type BenchKey, benchPick } from '../lib/bench';
import type { CurveData } from '../lib/curve';
import { curveSummary } from '../lib/curve';
import { type SortState, loadSort, saveSort, sortItems } from '../lib/sorting';
import '../styles/evidence.css';

const DOC_URL = 'https://github.com/zychang39/twse-money-flow/blob/main/docs/INDICATOR_EVIDENCE.md';

type BenchMap = Record<string, { mean_excess: number | null; t: number | null; ci?: [number | null, number | null]; win?: number | null } | null>;

interface HorizonStats extends Brief {
  win_ci?: [number | null, number | null];
  mae?: number | null;
  mean_net?: number | null;
  mean_exc_idx?: number | null;
  locked?: number;
  bench?: BenchMap;
  groups?: {
    years?: Record<string, Brief>;
    oos?: Brief;
    regime?: { on: Brief; off: Brief };
    trend?: { on: Brief; off: Brief };
    quarter_end?: { on: Brief; off: Brief };
  };
}

interface ExitRule { label: string; chosen: boolean; n: number; ev: number | null; exc_idx: number | null; win: number | null; hold: number | null; mae: number | null; locked: number; rel?: Partial<Record<BenchKey, number | null>> }

interface Detail {
  variants?: Record<string, { label: string; raw: number; horizons: Record<string, HorizonStats>; false_breakout?: number | null }>;
  grid?: { chosen: string; sensitive: boolean; note?: string; table: { key: string; n: number; mean_excess: number | null; t: number | null }[] } | null;
  oos?: Brief & { kind?: string } | null;
  exits?: { rules: ExitRule[]; peak_train?: { day: number; train: [string, string] } };
  quintile?: { months: number; q_mean: (number | null)[]; rho_mean: number | null; rho_t: number | null };
  curve?: CurveData & Partial<Record<BenchKey, import('../lib/curve').CurveLine>>;
  per_day?: Record<string, { n: number; mean_excess: number | null; t: number | null; per_day_ann: number | null; ref: boolean }>;
  n_wf?: { chosen: number | null; steps: { valid: [string, string]; n_days: number; valid_mean_excess: number | null; valid_n: number }[] } | null;
}

function VerdictTag({ row }: { row: EvidenceRow }) {
  const tone = verdictTone(row.verdict);
  const cov = row.verdict === '樣本範圍受限' ? null : coverageLabel(row.coverage?.ratio);
  return (
    <span class="ev-tags">
      <span class={`tag ev-verdict ${tone === 'risk' ? 'risk' : tone === 'strong' ? 'strong' : ''}`}>{row.verdict}</span>
      {cov ? <span class="tag ev-verdict risk">{cov}</span> : null}
      {row.large_cap ? <span class="tag ev-verdict">{row.large_cap}</span> : null}
    </span>
  );
}

/** v3 M0-4：原 31 檔 vs 全市場（涵蓋率 ≥ 90% 後才比較）。 */
function HindsightCard({ h }: { h: Hindsight }) {
  if (h.status === 'waiting') {
    return <p class="caption muted">原 31 檔 vs 全市場：涵蓋率 {Math.round(h.coverage * 100)}%，達 {Math.round((h.threshold ?? 0.9) * 100)}% 後自動計算「選樣偏差估計」。</p>;
  }
  return (
    <>
      <h4 class="ev-h">原 31 檔 vs 全市場</h4>
      <table class="ev-table" aria-label="原 31 檔與全市場比較">
        <thead><tr><th scope="col">樣本</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">樣本</th></tr></thead>
        <tbody>
          <tr><th scope="row">原 31 檔</th><td>{pctSigned(h.orig?.mean_excess)}</td><td>{tText(h.orig?.t)}</td><td>{(h.orig?.n ?? 0).toLocaleString('zh-TW')}</td></tr>
          <tr><th scope="row">全市場</th><td>{pctSigned(h.full?.mean_excess)}</td><td>{tText(h.full?.t)}</td><td>{(h.full?.n ?? 0).toLocaleString('zh-TW')}</td></tr>
          <tr class="ev-chosen"><th scope="row">選樣偏差估計</th><td>{pctSigned(h.bias)}</td><td>—</td><td>—</td></tr>
        </tbody>
      </table>
      <p class="caption muted">選樣偏差估計＝原 31 檔 − 全市場（10 日超額）。原 31 檔是 2026-09 依當時成交值挑選的熱門股，有後見之明偏差。</p>
    </>
  );
}

/** v3 M0-3：千張大戶資料的每週涵蓋率（universe 內有資料的比例）。 */
export function CoverageChart({ weeks }: { weeks: WeeklyCoverage[] }) {
  if (!weeks.length) return null;
  const last = weeks[weeks.length - 1];
  return (
    <div class="card ev-cov">
      <h2 class="section">千張大戶資料涵蓋率（每週）</h2>
      <p class="caption muted">最新一週 {Math.round(last.ratio * 100)}%（每日平均 {last.included.toLocaleString('zh-TW')}／{last.universe.toLocaleString('zh-TW')} 檔）。低於 50% 標示「樣本範圍受限」、50–90% 標示「部分涵蓋」。</p>
      <LineChart
        ariaLabel={`千張大戶資料每週涵蓋率，最新 ${Math.round(last.ratio * 100)}%`}
        dates={weeks.map((w) => w.date)}
        format={(v) => `${v.toFixed(0)}%`}
        lines={[
          { label: '涵蓋率', values: weeks.map((w) => w.ratio * 100) },
          { label: '90%', values: weeks.map(() => 90), tone: 'tertiary', dash: '4 3' },
          { label: '50%', values: weeks.map(() => 50), tone: 'tertiary', dash: '1 3' },
        ]}
      />
    </div>
  );
}


function BriefCells({ b }: { b: Brief | undefined }) {
  if (!b || !b.n) return <td colSpan={3} class="ev-empty">{b?.note ?? '本期間無此環境樣本'}</td>;
  return (
    <>
      <td>{pctSigned(b.mean_excess)}</td>
      <td>{tText(b.t)}</td>
      <td>{b.n.toLocaleString('zh-TW')}</td>
    </>
  );
}

function GroupTable({ h }: { h: HorizonStats }) {
  const g = h.groups ?? {};
  const envRows: [string, Brief | undefined][] = [
    ['年線上', g.regime?.on], ['年線下', g.regime?.off],
    ['60 日漲', g.trend?.on], ['60 日跌', g.trend?.off],
    ['季底作帳', g.quarter_end?.on], ['其他期間', g.quarter_end?.off],
  ];
  return (
    <table class="ev-table" aria-label="分組結果">
      <thead><tr><th scope="col">分組</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">樣本</th></tr></thead>
      <tbody>
        {Object.entries(g.years ?? {}).map(([y, b]) => <tr key={y}><th scope="row">{y}</th><BriefCells b={b} /></tr>)}
        {envRows.map(([label, b]) => <tr key={label}><th scope="row">{label}</th><BriefCells b={b} /></tr>)}
      </tbody>
    </table>
  );
}

/** 列表的一句話：選定基準下的 10 日超額與 t（分組型只有等權）。 */
function rowLine(row: EvidenceRow, bench: BenchKey, horizon: number): string {
  const n = (row.n ?? 0).toLocaleString('zh-TW');
  if (row.kind === 'quintile') return `Q5−Q1 ${pctSigned(row.mean_excess)}／月・t ${tText(row.t)}・${n} 個月（分組只有等權）`;
  const b = benchPick(row, row.bench, bench);
  return `${horizon} 日超額（${BENCH_LABEL[bench]}）${pctSigned(b.mean_excess)}・t ${tText(b.t)}・${n} 筆`;
}

function DetailPanel({ row, horizon, bench }: { row: EvidenceRow; horizon: number; bench: BenchKey }) {
  const d = useAsync(() => loadJson<Detail>(`evidence/${row.id}.json`), [row.id]);
  const main = d.data?.variants?.main;
  const hs = main?.horizons ?? {};
  const h = hs[String(horizon)];
  const oos = d.data?.oos;
  const line = d.data?.curve?.[bench];
  const nonEw = bench !== 'ew';
  return (
    <div class="ev-detail">
      <p class="caption">{row.definition}</p>
      <p class="caption"><b>{row.verdict}</b>：{verdictNote(row)}{row.reasons?.length ? `（${row.reasons.join('；')}）` : ''}</p>
      <p class="caption muted">
        訊號期間 {row.signal_start ?? '—'}～{row.signal_end ?? '—'}・資料起始 {row.data_start ?? '—'}・{coverageText(row.coverage)}
        {row.param ? `・參數 ${row.param}` : ''}
      </p>
      {row.delist ? <p class="caption muted">{delistText(row)}</p> : null}
      {row.note && row.coverage && row.coverage.ratio < 0.9 ? <p class="caption risk-text">{row.note}</p> : null}
      {row.hindsight ? <HindsightCard h={row.hindsight} /> : null}
      {d.loading ? <Loading /> : null}
      {d.error ? <ErrorState error={d.error} /> : null}
      {row.kind === 'quintile' && d.data?.quintile ? (
        <table class="ev-table" aria-label="五分組每月平均報酬">
          <thead><tr><th scope="col">組別</th><th scope="col">每月平均</th></tr></thead>
          <tbody>
            {d.data.quintile.q_mean.map((v, i) => <tr key={i}><th scope="row">{i === 0 ? 'Q1（最低）' : i === 4 ? 'Q5（最高）' : `Q${i + 1}`}</th><td>{pctSigned(v)}</td></tr>)}
            <tr><th scope="row">秩相關</th><td>{d.data.quintile.rho_mean?.toFixed(3) ?? '—'}（t {tText(d.data.quintile.rho_t)}）</td></tr>
          </tbody>
        </table>
      ) : null}
      {main ? (
        <>
          <h4 class="ev-h">持有天數（相對{BENCH_LABEL[bench]}）</h4>
          <table class="ev-table" aria-label={`各持有天數，相對${BENCH_LABEL[bench]}`}>
            <thead><tr><th scope="col">持有</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">每持有日年化</th></tr></thead>
            <tbody>
              {Object.entries(hs).map(([k, s]) => {
                const b = benchPick(s, s.bench, bench);
                const perDay = b.mean_excess === null || b.mean_excess === undefined ? null : (b.mean_excess / Number(k)) * 250;
                return <tr key={k}><th scope="row">{k} 日{d.data?.per_day?.[k]?.ref ? '＊' : ''}</th><td>{pctSigned(b.mean_excess)}</td><td>{tText(b.t)}</td><td>{pctSigned(perDay, 1)}</td></tr>;
              })}
            </tbody>
          </table>
          <p class="caption muted">
            超額＝相對{BENCH_LONG[bench]}，事件扣成本。每持有日年化＝超額 ÷ N × 250，讓不同持有天數可以比較；持有越久 beta 暴露與回撤越大，所以比的是超額，不是總報酬。＊120 日只做參考、不進判定。
            {d.data?.n_wf?.chosen ? ` walk-forward 選定持有 ${d.data.n_wf.chosen} 日（訓練窗選每持有日最高者）。` : ''}
          </p>
          <p class="caption muted">{horizon} 日：95% 區間 {ciText(benchPick(h, h?.bench, bench).ci ?? (nonEw ? undefined : h?.ci))}（bootstrap 只算等權與 0050）、最大不利波動平均 {pctSigned(h?.mae)}、跌停鎖死 {h?.locked ?? 0} 次。</p>
          {h?.bench ? (
            <>
              <h4 class="ev-h">四種基準（{horizon} 日）</h4>
              <table class="ev-table" aria-label="相對四種基準的超額">
                <thead><tr><th scope="col">基準</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">95% 區間</th></tr></thead>
                <tbody>
                  {(['ew', 'tr', '0050', '00631L'] as BenchKey[]).map((k) => {
                    const b = benchPick(h, h.bench, k);
                    return <tr key={k} class={k === bench ? 'ev-chosen' : ''}><th scope="row">{BENCH_LABEL[k]}</th><td>{pctSigned(b.mean_excess)}</td><td>{tText(b.t)}</td><td class="ev-ci">{b.ci ? ciText(b.ci) : '—'}</td></tr>;
                  })}
                </tbody>
              </table>
              <p class="caption muted">判定以等權為準；bootstrap 區間只算等權與 0050。{row.large_cap ? `相對 0050 不顯著：${row.large_cap}。` : ''}</p>
            </>
          ) : null}
          <h4 class="ev-h">累積超額曲線（進場後第 1～60 日，相對{BENCH_LABEL[bench]}）</h4>
          {line ? <AlphaCurve line={line} label={`相對${BENCH_LABEL[bench]}`} n={d.data?.curve?.n} /> : <p class="caption muted">{d.data?.curve ? '這個基準沒有曲線資料。' : '只有判定為有效、環境依賴的指標與三方同買才計算累積超額曲線。'}</p>}
          {line ? <p class="caption">{curveSummary(line)}</p> : null}
          {oos ? <p class="caption">樣本外（{oos.kind === 'walk_forward' ? 'walk-forward 驗證期' : '最後 1/3'}，{oos.start} 起，等權）：{pctSigned(oos.mean_excess)}（t {tText(oos.t)}，{oos.n} 筆）</p> : null}
          {h ? <><h4 class="ev-h">逐年與大盤環境（{horizon} 日，等權）</h4><GroupTable h={h} /></> : null}
          {Object.entries(d.data?.variants ?? {}).filter(([k]) => k !== 'main').length ? (
            <>
              <h4 class="ev-h">變體與條件分解（{horizon} 日，等權）</h4>
              <table class="ev-table" aria-label="變體比較">
                <thead><tr><th scope="col">變體</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">樣本</th></tr></thead>
                <tbody>
                  {Object.entries(d.data?.variants ?? {}).filter(([k]) => k !== 'main').map(([k, v]) => {
                    const s = v.horizons[String(horizon)];
                    return <tr key={k}><th scope="row" class="ev-wrap">{v.label}</th><BriefCells b={s} /></tr>;
                  })}
                </tbody>
              </table>
            </>
          ) : null}
          {d.data?.grid ? (
            <>
              <h4 class="ev-h">參數表（選定 {d.data.grid.chosen}{d.data.grid.sensitive ? '・參數敏感' : ''}；等權）</h4>
              {d.data.grid.note ? <p class="caption muted">{d.data.grid.note}</p> : null}
              <table class="ev-table" aria-label="參數表">
                <thead><tr><th scope="col">參數</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">樣本</th></tr></thead>
                <tbody>
                  {d.data.grid.table.map((g) => (
                    <tr key={g.key} class={g.key === d.data?.grid?.chosen ? 'ev-chosen' : ''}><th scope="row" class="ev-wrap">{g.key}</th><td>{pctSigned(g.mean_excess)}</td><td>{tText(g.t)}</td><td>{g.n.toLocaleString('zh-TW')}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          {d.data?.exits ? (
            <>
              <h4 class="ev-h">出場規則比較（相對{BENCH_LABEL[bench]}）</h4>
              <table class="ev-table" aria-label={`出場規則，相對${BENCH_LABEL[bench]}`}>
                <thead><tr><th scope="col">出場</th><th scope="col">相對{BENCH_LABEL[bench]}</th><th scope="col">勝率</th><th scope="col">持有日</th></tr></thead>
                <tbody>
                  {d.data.exits.rules.filter((r) => r.chosen || r.label.startsWith('固定')).map((r) => (
                    <tr key={r.label}><th scope="row" class="ev-wrap">{r.label}<span class="th-unit">MAE {pctSigned(r.mae, 1)}・鎖死 {r.locked}</span></th><td>{pctSigned(bench === 'tr' ? r.exc_idx : r.rel?.[bench])}</td><td>{r.win === null ? '—' : `${r.win.toFixed(1)}%`}</td><td>{r.hold?.toFixed(1) ?? '—'}</td></tr>
                  ))}
                </tbody>
              </table>
              <p class="caption muted">
                同樣的進場、各規則各自去重；勝率為扣成本報酬 &gt; 0 的比例，MAE＝最大不利波動平均，鎖死＝出場日跌停賣不掉的次數。
                {d.data.exits.peak_train ? ` 峰值日固定出場的 N＝訓練窗（${d.data.exits.peak_train.train[0]}～${d.data.exits.peak_train.train[1]}）曲線的峰值日 ${d.data.exits.peak_train.day}，不看全樣本。` : ''}
              </p>
            </>
          ) : null}
        </>
      ) : null}
      <a class="list-item brand" href={DOC_URL} target="_blank" rel="noopener">
        <span class="grow">完整報告<span class="caption muted tool-sub">全部參數格與出場規則（GitHub）</span></span>
      </a>
    </div>
  );
}

function Row({ row, horizon, bench }: { row: EvidenceRow; horizon: number; bench: BenchKey }) {
  const [open, setOpen] = useState(false);
  return (
    <div class={`ev-item${open ? ' open' : ''}`} data-testid={`ev-row-${row.id}`}>
      <button class="ev-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class="ev-main">
          <span class="ev-label">{row.label}</span>
          <span class="ev-sub" data-testid="ev-line">{rowLine(row, bench, horizon)}</span>
          <span class="ev-sub">{row.family}</span>
        </span>
        <VerdictTag row={row} />
      </button>
      {open ? <DetailPanel row={row} horizon={horizon} bench={bench} /> : null}
    </div>
  );
}

/** 排序用的數值：t、10 日超額（依選定基準）、近期健康度（近 60 日超額）、今日新觸發數。 */
function sortable(rows: EvidenceRow[], today: EvidenceToday | null, bench: BenchKey) {
  return rows.map((r) => {
    const b = r.kind === 'quintile' ? { mean_excess: r.mean_excess, t: r.t } : benchPick(r, r.bench, bench);
    const trig = today?.tests[r.id]?.t ?? {};
    return {
      row: r,
      label: r.label,
      verdict: r.verdict,
      t: b.t ?? null,
      excess: b.mean_excess ?? null,
      health: r.recent?.mean_excess ?? null,
      today: Object.values(trig).filter((d) => d === today?.date).length,
    };
  });
}

export default function Evidence() {
  const d = useAsync(() => loadJson<EvidenceFile>('evidence.json'), []);
  const today = useAsync(() => loadJson<EvidenceToday>('evidence_today.json').catch(() => null), []);
  const [filter, setFilter] = useState<Filter>('all');
  const [bench, setBench] = useBenchState();
  const [sort, setSortState] = useState<SortState>(() => loadSort('evidence'));
  const setSort = (s: SortState) => { saveSort('evidence', s); setSortState(s); };
  const rows = d.data?.rows ?? [];
  const c = counts(rows);
  const horizon = d.data?.meta.config?.primary_horizon ?? 10;
  const tThr = d.data?.meta.config?.stats.t_threshold ?? 2.5;
  const shown = useMemo(
    () => sortItems(sortable(filterRows(rows, filter), today.data ?? null, bench), sort).map((x) => x.row),
    [rows, filter, today.data, bench, sort],
  );
  return (
    <div class="page has-bench">
      <TopBar back="/explore" />
      <PageHead eyebrow="哪些指標在台股有統計證據？" title={d.data ? `${c['有效']} 項有效・${c['環境依賴']} 項環境依賴` : '指標效度表'}>
        <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>
          {d.data ? `共 ${rows.length} 項・資料至 ${d.data.meta.data_end ?? '—'}・` : ''}僅供研究參考，非投資建議。
        </p>
      </PageHead>
      {d.loading ? <Loading /> : null}
      {d.error ? <ErrorState error={d.error} /> : null}
      {d.data?.meta.error ? <div class="banner danger">評估暫時無法產生：{d.data.meta.error}</div> : null}
      {d.data ? (
        <>
          <div class="card ev-warn">
            <p class="caption">
              <b>多重檢定警語：</b>同時測試數十個指標，即使全部無效也會有幾項看起來顯著。因此「有效」的門檻提高到 t ≥ {tThr}，
              並要求逐年多數為正、樣本外為正、參數不敏感。評估期間大盤有 {Math.round((d.data.meta.regime_share ?? 0) * 100)}% 的交易日在年線上（以多頭為主），籌碼類資料自 {d.data.meta.starts?.insti ?? '—'} 起。
              判定以同日等權 universe 為準；對等權有效、但相對 0050 不顯著的標「未勝過大型股」。
            </p>
          </div>
          {d.data.meta.coverage_weekly?.whale?.length ? <CoverageChart weeks={d.data.meta.coverage_weekly.whale} /> : null}
          <BenchSwitch value={bench} onChange={setBench} note={`超額相對：${BENCH_LONG[bench]}`} />
          <div class="segmented ev-filter" role="group" aria-label="篩選">
            {([['all', `全部 ${rows.length}`], ['usable', `可用 ${c['有效'] + c['環境依賴']}`], ['other', `其他 ${rows.length - c['有效'] - c['環境依賴']}`]] as [Filter, string][]).map(([k, label]) => (
              <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
          <SortMenu id="evidence" value={sort} onChange={setSort} />
          <div class="list ev-list" data-testid="ev-list">{shown.map((r) => <Row key={r.id} row={r} horizon={horizon} bench={bench} />)}</div>
          <p class="caption muted ev-foot">
            universe：上市櫃普通股，排除 ETF、存託憑證、處置股、變更交易（全額交割）、上市櫃未滿 120 日、20 日均成交值 &lt; 2,000 萬、股價 &lt; 10 元（共 {d.data.meta.universe_stocks?.toLocaleString('zh-TW') ?? '—'} 檔，含之後下市者）。
            訊號日隔天開盤進場、第 N 日開盤出場、扣成本；同一檔只計首次觸發。
          </p>
        </>
      ) : null}
    </div>
  );
}
