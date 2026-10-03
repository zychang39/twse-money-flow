/**
 * 指標效度表（M1；v3 M5）：每個指標一列，點開看依據（持有期、累積超額曲線、逐年、樣本外、環境、參數、出場比較）。
 * - 預設排序：判定分級 → 同級內 t 由高到低（不依超額排序）；「排序」選單可改，選擇記在 localStorage。
 * - 基準分段控制（等權｜加權報酬｜0050｜00631L）sticky 在列表上方，同頁所有數字、表格與曲線同步；判定一律以等權為準。
 * 2026-10-02 健檢：列的第一行固定是「判定依據（等權）」，第二行才是目前基準；名稱用全站名稱表（有策略的指標顯示策略名）；
 * 兩層門檻（指標判定 t ≥ 2.5、策略分級校正後 t ≥ 3／2）各自寫清楚；缺值附原因。
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
  ciText, coverageLabel, coverageText, delistText, filterRows, verdictNote, verdictTone,
} from '../lib/evidence';
import { fmtCount, md, missing, pctPlain, pctSigned, ratioPct, ratioText, tText } from '../lib/format';
import { BENCH_LABEL, BENCH_LONG, type BenchKey, benchPick } from '../lib/bench';
import type { CurveData } from '../lib/curve';
import { curveSummary } from '../lib/curve';
import { type SortState, loadSort, saveSort, sortItems } from '../lib/sorting';
import { displayName } from '../lib/names';
import { GRADE_NAME, VERDICT_NAME, gradeByTestMap, gradeCounts, gradeSummary, gradingThresholds, thresholdNote, verdictCounts, verdictSummary } from '../lib/status';
import type { StrategiesFile } from '../lib/strategies';
import { gradeTone } from '../lib/strategies';
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

function VerdictTag({ row, grade }: { row: EvidenceRow; grade?: { grade: string; label: string } }) {
  const tone = verdictTone(row.verdict);
  const cov = row.verdict === '樣本範圍受限' ? null : coverageLabel(row.coverage?.ratio);
  return (
    <span class="tags">
      <span class={`tag ev-verdict ${tone === 'risk' ? 'risk' : tone === 'strong' ? 'strong' : ''}`} title={VERDICT_NAME}>{row.verdict}</span>
      {grade ? <span class={`tag ev-verdict${gradeTone(grade.grade as never) === 'strong' ? ' strong' : gradeTone(grade.grade as never) === 'muted' ? ' muted' : ''}`} title={GRADE_NAME}>策略{grade.label}</span> : null}
      {cov ? <span class="tag ev-verdict risk">{cov}</span> : null}
      {row.large_cap ? <span class="tag ev-verdict">{row.large_cap}</span> : null}
    </span>
  );
}

/** v3 M0-4：原 31 檔 vs 全市場（涵蓋率 ≥ 90% 後才比較）。 */
function HindsightCard({ h }: { h: Hindsight }) {
  if (h.status === 'waiting') {
    return <p class="caption muted">原 31 檔 vs 全市場：涵蓋率 {ratioPct(h.coverage)}，達 {ratioPct(h.threshold ?? 0.9, 0)} 後自動計算「選樣偏差估計」。</p>;
  }
  return (
    <>
      <h4 class="ev-h">原 31 檔 vs 全市場</h4>
      <table class="ev-table ev-static" aria-label="原 31 檔與全市場比較">
        <thead><tr><th scope="col">樣本</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">樣本</th></tr></thead>
        <tbody>
          <tr><th scope="row">原 31 檔</th><td>{pctSigned(h.orig?.mean_excess)}</td><td>{tText(h.orig?.t)}</td><td>{fmtCount(h.orig?.n ?? 0)}</td></tr>
          <tr><th scope="row">全市場</th><td>{pctSigned(h.full?.mean_excess)}</td><td>{tText(h.full?.t)}</td><td>{fmtCount(h.full?.n ?? 0)}</td></tr>
          <tr class="ev-chosen"><th scope="row">選樣偏差估計</th><td>{pctSigned(h.bias)}</td><td>—</td><td>—</td></tr>
        </tbody>
      </table>
      <p class="caption muted">選樣偏差估計＝原 31 檔 − 全市場（40 日超額）。原 31 檔是 2026-09 依當時成交值挑選的熱門股，有後見之明偏差。</p>
    </>
  );
}

/** v3 M0-3：千張大戶資料的每週涵蓋率（universe 內有資料的比例）。 */
export function CoverageChart({ weeks, backfill }: { weeks: WeeklyCoverage[]; backfill?: string | null }) {
  if (!weeks.length) return null;
  const last = weeks[weeks.length - 1];
  const best = weeks.reduce((a, b) => (b.ratio > a.ratio ? b : a), weeks[0]);
  return (
    <div class="card ev-cov">
      <h2 class="section">千張大戶資料涵蓋率（每週）</h2>
      <p class="caption muted">
        最新一週（{md(last.date)}）{ratioPct(last.ratio)}（每日平均 {fmtCount(last.included)}／{fmtCount(last.universe)} 檔）；期間最高 {ratioPct(best.ratio)}（{md(best.date)}）。
        分母＝當週 universe（上市櫃普通股、20 日均成交值 ≥ 5,000 萬、股價 ≥ 10 元、非處置）的每日平均檔數。低於 50% 標示「樣本範圍受限」、50–90% 標示「部分涵蓋」。
      </p>
      {backfill ? <p class="caption muted">{backfill}</p> : null}
      <LineChart
        ariaLabel={`千張大戶資料每週涵蓋率，最新 ${ratioPct(last.ratio)}`}
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
      <td>{fmtCount(b.n)}</td>
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
    <table class="ev-table ev-static" aria-label="分組結果">
      <thead><tr><th scope="col">分組</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">樣本</th></tr></thead>
      <tbody>
        {Object.entries(g.years ?? {}).map(([y, b]) => <tr key={y}><th scope="row">{y}</th><BriefCells b={b} /></tr>)}
        {envRows.map(([label, b]) => <tr key={label}><th scope="row">{label}</th><BriefCells b={b} /></tr>)}
      </tbody>
    </table>
  );
}

/** 列的第一行：判定依據（等權）；第二行：目前基準（非等權時）。 */
function judgeLine(row: EvidenceRow, horizon: number): string {
  const n = fmtCount(row.n ?? 0);
  if (row.kind === 'quintile') return `判定依據：Q5−Q1 ${pctSigned(row.mean_excess)}／月・t ${tText(row.t)}・${n} 個月（分組只有等權）`;
  return `判定依據（等權 ${horizon} 日）：超額 ${pctSigned(row.mean_excess)}・t ${tText(row.t)}・${n} 筆`;
}
function benchLine(row: EvidenceRow, bench: BenchKey): string | null {
  if (row.kind === 'quintile' || bench === 'ew') return null;
  const b = benchPick(row, row.bench, bench);
  return `相對${BENCH_LABEL[bench]}：超額 ${pctSigned(b.mean_excess)}・t ${tText(b.t)}・超額勝率 ${pctPlain(b.win)}`;
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
      <p class="caption"><b>{VERDICT_NAME}：{row.verdict}</b>・{verdictNote(row)}{row.reasons?.length ? `（${row.reasons.join('；')}）` : ''}</p>
      <p class="caption muted">
        訊號期間 {row.signal_start ? `${row.signal_start}～${row.signal_end ?? '資料結束'}` : missing('沒有訊號')}・資料起始 {row.data_start ?? missing('沒有起始日')}・涵蓋率 {coverageText(row.coverage)}
        {row.param ? `・參數 ${row.param}` : ''}
      </p>
      {row.delist ? <p class="caption muted">{delistText(row)}</p> : null}
      {row.note && row.coverage && row.coverage.ratio < 0.9 ? <p class="caption risk-text">{row.note}</p> : null}
      {row.hindsight ? <HindsightCard h={row.hindsight} /> : null}
      {d.loading ? <Loading /> : null}
      {d.error ? <ErrorState error={d.error} /> : null}
      {row.kind === 'quintile' && d.data?.quintile ? (
        <table class="ev-table ev-static" aria-label="五分組每月平均報酬">
          <thead><tr><th scope="col">組別</th><th scope="col">每月平均</th></tr></thead>
          <tbody>
            {d.data.quintile.q_mean.map((v, i) => <tr key={i}><th scope="row">{i === 0 ? 'Q1（最低）' : i === 4 ? 'Q5（最高）' : `Q${i + 1}`}</th><td>{pctSigned(v)}</td></tr>)}
            <tr><th scope="row">秩相關</th><td>{ratioText(d.data.quintile.rho_mean, 3)}（t {tText(d.data.quintile.rho_t)}）</td></tr>
          </tbody>
        </table>
      ) : null}
      {main ? (
        <>
          <h4 class="ev-h">持有天數（相對{BENCH_LABEL[bench]}）</h4>
          <table class="ev-table ev-static" aria-label={`各持有天數，相對${BENCH_LABEL[bench]}`}>
            <thead><tr><th scope="col">持有</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">每持有日年化</th><th scope="col">樣本</th></tr></thead>
            <tbody>
              {Object.entries(hs).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, s]) => {
                const b = benchPick(s, s.bench, bench);
                const perDay = b.mean_excess === null || b.mean_excess === undefined ? null : (b.mean_excess / Number(k)) * 250;
                return <tr key={k} class={Number(k) === horizon ? 'ev-chosen' : undefined}><th scope="row">{k} 日{d.data?.per_day?.[k]?.ref ? '＊' : ''}</th><td>{pctSigned(b.mean_excess)}</td><td>{tText(b.t)}</td><td>{pctSigned(perDay)}</td><td>{fmtCount(s.n ?? 0)}</td></tr>;
              })}
            </tbody>
          </table>
          <p class="caption muted">
            超額＝相對{BENCH_LONG[bench]}，事件扣成本；各持有天數各自去重，樣本數不同。每持有日年化＝超額 ÷ N × 250，讓不同持有天數可以比較；持有越久 beta 暴露與回撤越大，所以比的是超額，不是總報酬。＊120 日只做參考、不進判定。
            {d.data?.n_wf?.chosen ? ` walk-forward 選定持有 ${d.data.n_wf.chosen} 日（訓練窗選每持有日最高者）。` : ''}
          </p>
          <p class="caption muted">{horizon} 日：95% 區間 {ciText(benchPick(h, h?.bench, bench).ci ?? (nonEw ? undefined : h?.ci))}（bootstrap 只算等權與 0050）、最大不利波動平均 {pctSigned(h?.mae)}、跌停鎖死 {h?.locked ?? 0} 次、絕對勝率 {pctPlain(h?.win)}。</p>
          {h?.bench ? (
            <>
              <h4 class="ev-h">四種基準（{horizon} 日）</h4>
              <table class="ev-table ev-static" aria-label="相對四種基準的超額">
                <thead><tr><th scope="col">基準</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">超額勝率</th></tr></thead>
                <tbody>
                  {(['ew', 'tr', '0050', '00631L'] as BenchKey[]).map((k) => {
                    const b = benchPick(h, h.bench, k);
                    const win = h.bench?.[k]?.win;
                    return <tr key={k} class={k === bench ? 'ev-chosen' : ''}><th scope="row">{BENCH_LABEL[k]}</th><td>{pctSigned(b.mean_excess)}</td><td>{tText(b.t)}</td><td>{pctPlain(win)}</td></tr>;
                  })}
                </tbody>
              </table>
              <p class="caption muted">判定以等權為準；超額勝率＝超額 &gt; 0 的比例。{row.large_cap ? `相對 0050 不顯著：${row.large_cap}。` : ''}</p>
            </>
          ) : null}
          <h4 class="ev-h">累積超額曲線（進場後第 1～60 日，相對{BENCH_LABEL[bench]}）</h4>
          {line ? <AlphaCurve line={line} label={`相對${BENCH_LABEL[bench]}`} n={d.data?.curve?.n} /> : <p class="caption muted">累積超額曲線：—（{d.data?.curve ? `這個基準沒有曲線資料（pipeline 沒有 ${BENCH_LABEL[bench]} 序列）` : '只有判定為有效、環境依賴的指標與三方同買才計算累積超額曲線'}）。</p>}
          {line ? <p class="caption">{curveSummary(line)}</p> : null}
          {line ? <p class="caption muted">曲線樣本＝{horizon} 日去重事件 {fmtCount(d.data?.curve?.n ?? 0)} 筆、第 k 日收盤、不扣成本；與上表（各持有天數各自去重、扣成本）的筆數與數值不同。</p> : null}
          {oos ? <p class="caption">樣本外（{oos.kind === 'walk_forward' ? 'walk-forward 驗證期' : '最後 1/3'}，{oos.start} 起，等權）：{pctSigned(oos.mean_excess)}（t {tText(oos.t)}，{fmtCount(oos.n)} 筆）</p> : null}
          {h ? <><h4 class="ev-h">逐年與大盤環境（{horizon} 日，等權）</h4><GroupTable h={h} /></> : null}
          {Object.entries(d.data?.variants ?? {}).filter(([k]) => k !== 'main').length ? (
            <>
              <h4 class="ev-h">變體與條件分解（{horizon} 日，等權）</h4>
              <table class="ev-table ev-static" aria-label="變體比較">
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
              <table class="ev-table ev-static" aria-label="參數表">
                <thead><tr><th scope="col">參數</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">樣本</th></tr></thead>
                <tbody>
                  {d.data.grid.table.map((g) => (
                    <tr key={g.key} class={g.key === d.data?.grid?.chosen ? 'ev-chosen' : ''}><th scope="row" class="ev-wrap">{g.key}</th><td>{pctSigned(g.mean_excess)}</td><td>{tText(g.t)}</td><td>{fmtCount(g.n)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          {d.data?.exits ? (
            <>
              <h4 class="ev-h">出場規則比較（相對{BENCH_LABEL[bench]}）</h4>
              <table class="ev-table ev-static" aria-label={`出場規則，相對${BENCH_LABEL[bench]}`}>
                <thead><tr><th scope="col">出場</th><th scope="col">相對{BENCH_LABEL[bench]}</th><th scope="col">絕對勝率</th><th scope="col">持有日</th></tr></thead>
                <tbody>
                  {d.data.exits.rules.filter((r) => r.chosen || r.label.startsWith('固定')).map((r) => (
                    <tr key={r.label}><th scope="row" class="ev-wrap">{r.label}<span class="th-unit">MAE {pctSigned(r.mae)}・鎖死 {r.locked}</span></th><td>{pctSigned(bench === 'tr' ? r.exc_idx : r.rel?.[bench])}</td><td>{pctPlain(r.win)}</td><td>{r.hold === null ? '—' : r.hold.toFixed(1)}</td></tr>
                  ))}
                </tbody>
              </table>
              <p class="caption muted">
                同樣的進場、各規則各自去重；絕對勝率為扣成本報酬 &gt; 0 的比例，MAE＝最大不利波動平均，鎖死＝出場日跌停賣不掉的次數。
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

function Row({ row, horizon, bench, grade }: { row: EvidenceRow; horizon: number; bench: BenchKey; grade?: { grade: string; label: string } }) {
  const [open, setOpen] = useState(false);
  const name = displayName(row.id, row.label);
  const bl = benchLine(row, bench);
  return (
    <div class={`ev-item${open ? ' open' : ''}`} data-testid={`ev-row-${row.id}`}>
      <button class="ev-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class="ev-main">
          <span class="st-card-head"><span class="ev-label">{name.label}</span><VerdictTag row={row} grade={grade} /></span>
          {name.sub ? <span class="ev-sub">{name.sub}</span> : null}
          <span class="ev-sub" data-testid="ev-line">{judgeLine(row, horizon)}</span>
          {bl ? <span class="ev-sub" data-testid="ev-bench-line">{bl}</span> : null}
          <span class="ev-sub">{row.family}</span>
        </span>
      </button>
      {open ? <DetailPanel row={row} horizon={horizon} bench={bench} /> : null}
    </div>
  );
}

/** 排序用的數值：t、超額（依選定基準）、近期健康度（近 60 日超額）、今日新觸發數。 */
function sortable(rows: EvidenceRow[], today: EvidenceToday | null, bench: BenchKey) {
  return rows.map((r) => {
    const b = r.kind === 'quintile' ? { mean_excess: r.mean_excess, t: r.t } : benchPick(r, r.bench, bench);
    const trig = today?.tests[r.id]?.t ?? {};
    return {
      row: r,
      // 依畫面上顯示的名稱排序（有策略的指標顯示策略名；2026-10-02 健檢 M1-1 名稱表）
      label: displayName(r.id, r.label).label,
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
  const st = useAsync(() => loadJson<StrategiesFile>('strategies.json').catch(() => null), []);
  const [filter, setFilter] = useState<Filter>('all');
  const [bench, setBench] = useBenchState();
  const [sort, setSortState] = useState<SortState>(() => loadSort('evidence'));
  const setSort = (s: SortState) => { saveSort('evidence', s); setSortState(s); };
  const rows = d.data?.rows ?? [];
  const c = verdictCounts(rows);
  const horizon = d.data?.meta.config?.primary_horizon ?? 40;
  const tThr = d.data?.meta.config?.stats.t_threshold ?? 2.5;
  const grading = gradingThresholds(d.data?.meta.config);
  const grades = gradeByTestMap(st.data?.strategies);
  const gc = gradeCounts(st.data?.strategies);
  const shown = useMemo(
    () => sortItems(sortable(filterRows(rows, filter), today.data ?? null, bench), sort).map((x) => x.row),
    [rows, filter, today.data, bench, sort],
  );
  return (
    <div class="page has-bench">
      <TopBar back="/explore" />
      <PageHead eyebrow="哪些指標在台股有統計證據？" title={d.data ? `${VERDICT_NAME}：${verdictSummary(c)}` : '指標效度表'}>
        <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>
          {d.data ? `共 ${c.total} 項指標・資料至 ${md(d.data.meta.data_end)}・` : ''}僅供研究參考，非投資建議。
          {st.data ? <>{GRADE_NAME}另見 <a href="#/explore/strategies">策略庫：{gradeSummary(gc)}</a>（有策略的指標在列上顯示策略名與分級）。</> : null}
        </p>
      </PageHead>
      {d.loading ? <Loading /> : null}
      {d.error ? <ErrorState error={d.error} /> : null}
      {d.data?.meta.error ? <div class="banner danger">評估暫時無法產生：{d.data.meta.error}</div> : null}
      {d.data ? (
        <>
          <div class="card ev-warn">
            <p class="caption">
              <b>多重檢定警語：</b>同時測試數十個指標，即使全部無效也會有幾項看起來顯著。因此{VERDICT_NAME}「有效」的門檻提高到 t ≥ {tThr}，
              並要求逐年多數為正、樣本外為正、參數不敏感。評估期間大盤有 {ratioPct(d.data.meta.regime_share ?? 0, 0)} 的交易日在年線上（以多頭為主），籌碼類資料自 {d.data.meta.starts?.insti ?? missing('沒有起始日')} 起。
            </p>
            <p class="caption muted" data-testid="threshold-note">{thresholdNote(tThr, grading)} 判定以同日等權 universe 為準；對等權有效、但相對 0050 不顯著的標「未勝過大型股」。</p>
          </div>
          {d.data.meta.coverage_weekly?.whale?.length ? <CoverageChart weeks={d.data.meta.coverage_weekly.whale} backfill={d.data.meta.coverage_backfill ?? null} /> : null}
          <BenchSwitch value={bench} onChange={setBench} note={`第一行固定是判定依據（等權）；切換只改第二行「相對基準」的超額、t、超額勝率。目前：${BENCH_LONG[bench]}`} />
          <div class="segmented ev-filter" role="group" aria-label="篩選">
            {([['all', `全部 ${c.total}`], ['usable', `可用 ${c.usable}`], ['other', `其他 ${c.total - c.usable}`]] as [Filter, string][]).map(([k, label]) => (
              <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
          <SortMenu id="evidence" value={sort} onChange={setSort} />
          <div class="list ev-list" data-testid="ev-list">{shown.map((r) => <Row key={r.id} row={r} horizon={horizon} bench={bench} grade={grades?.get(r.id)} />)}</div>
          <p class="caption muted ev-foot">
            universe：上市櫃普通股，排除 ETF、存託憑證、處置股、變更交易（全額交割）、上市櫃未滿 {d.data.meta.config?.universe?.min_listed_days ?? 120} 日、20 日均成交值 &lt; {((d.data.meta.config?.universe?.min_avg_value ?? 5e7) / 1e4).toLocaleString('zh-TW')} 萬、股價 &lt; {d.data.meta.config?.universe?.min_close ?? 10} 元（共 {fmtCount(d.data.meta.universe_stocks)} 檔，含之後下市者）。
            訊號日隔天開盤進場、第 N 日開盤出場、扣成本；同一檔只計首次觸發。
          </p>
        </>
      ) : null}
    </div>
  );
}
