/**
 * 指標效度表（M1）：每個指標一列，點開看依據（持有期、逐年、樣本外、環境、參數、出場比較）。
 * 資料由 pipeline 預先計算（evidence.json、evidence/{id}.json），與 docs/INDICATOR_EVIDENCE.md 同步。
 */
import { useState } from 'preact/hooks';
import { PageHead, TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { useAsync } from '../hooks';
import { loadJson } from '../data/api';
import { LineChart } from '../components/LineChart';
import {
  type Brief, type EvidenceFile, type EvidenceRow, type Filter, type Hindsight, type WeeklyCoverage, FAMILIES, ciText,
  counts, coverageLabel, coverageText, delistText, filterRows, pctSigned, rowSummary, sortRows, tText, verdictNote, verdictTone,
} from '../lib/evidence';
import '../styles/evidence.css';

const DOC_URL = 'https://github.com/zychang39/twse-money-flow/blob/main/docs/INDICATOR_EVIDENCE.md';

interface HorizonStats extends Brief {
  win_ci?: [number | null, number | null];
  mae?: number | null;
  mean_net?: number | null;
  mean_exc_idx?: number | null;
  locked?: number;
  groups?: {
    years?: Record<string, Brief>;
    oos?: Brief;
    regime?: { on: Brief; off: Brief };
    trend?: { on: Brief; off: Brief };
    quarter_end?: { on: Brief; off: Brief };
  };
}

interface Detail {
  variants?: Record<string, { label: string; raw: number; horizons: Record<string, HorizonStats>; false_breakout?: number | null }>;
  grid?: { chosen: string; sensitive: boolean; note?: string; table: { key: string; n: number; mean_excess: number | null; t: number | null }[] } | null;
  oos?: Brief & { kind?: string } | null;
  exits?: { rules: { label: string; chosen: boolean; n: number; ev: number | null; exc_idx: number | null; win: number | null; hold: number | null; mae: number | null; locked: number }[] };
  quintile?: { months: number; q_mean: (number | null)[]; rho_mean: number | null; rho_t: number | null };
}

function VerdictTag({ row }: { row: EvidenceRow }) {
  const tone = verdictTone(row.verdict);
  const cov = row.verdict === '樣本範圍受限' ? null : coverageLabel(row.coverage?.ratio);
  return (
    <span class="ev-tags">
      <span class={`tag ev-verdict ${tone === 'risk' ? 'risk' : tone === 'strong' ? 'strong' : ''}`}>{row.verdict}</span>
      {cov ? <span class="tag ev-verdict risk">{cov}</span> : null}
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

function DetailPanel({ row, horizon }: { row: EvidenceRow; horizon: number }) {
  const d = useAsync(() => loadJson<Detail>(`evidence/${row.id}.json`), [row.id]);
  const main = d.data?.variants?.main;
  const hs = main?.horizons ?? {};
  const h = hs[String(horizon)];
  const oos = d.data?.oos;
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
          <h4 class="ev-h">持有天數</h4>
          <table class="ev-table" aria-label="各持有天數">
            <thead><tr><th scope="col">持有</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">勝率</th></tr></thead>
            <tbody>
              {Object.entries(hs).map(([k, s]) => (
                <tr key={k}><th scope="row">{k} 日</th><td>{pctSigned(s.mean_excess)}</td><td>{tText(s.t)}</td><td>{s.win === null || s.win === undefined ? '—' : `${s.win.toFixed(1)}%`}</td></tr>
              ))}
            </tbody>
          </table>
          <p class="caption muted">超額＝相對同日全市場（扣成本）。{horizon} 日：95% 區間 {ciText(h?.ci)}、最大不利波動平均 {pctSigned(h?.mae)}、跌停鎖死 {h?.locked ?? 0} 次。</p>
          {oos ? <p class="caption">樣本外（{oos.kind === 'walk_forward' ? 'walk-forward 驗證期' : '最後 1/3'}，{oos.start} 起）：{pctSigned(oos.mean_excess)}（t {tText(oos.t)}，{oos.n} 筆）</p> : null}
          {h ? <><h4 class="ev-h">逐年與大盤環境（{horizon} 日）</h4><GroupTable h={h} /></> : null}
          {Object.entries(d.data?.variants ?? {}).filter(([k]) => k !== 'main').length ? (
            <>
              <h4 class="ev-h">變體</h4>
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
              <h4 class="ev-h">參數表（選定 {d.data.grid.chosen}{d.data.grid.sensitive ? '・參數敏感' : ''}）</h4>
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
              <h4 class="ev-h">出場規則比較</h4>
              <table class="ev-table" aria-label="出場規則">
                <thead><tr><th scope="col">出場</th><th scope="col">相對指數</th><th scope="col">勝率</th><th scope="col">持有日</th></tr></thead>
                <tbody>
                  {d.data.exits.rules.filter((r) => r.chosen).map((r) => (
                    <tr key={r.label}><th scope="row" class="ev-wrap">{r.label}</th><td>{pctSigned(r.exc_idx)}</td><td>{r.win === null ? '—' : `${r.win.toFixed(1)}%`}</td><td>{r.hold?.toFixed(1) ?? '—'}</td></tr>
                  ))}
                </tbody>
              </table>
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

function Row({ row, horizon }: { row: EvidenceRow; horizon: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div class={`ev-item${open ? ' open' : ''}`}>
      <button class="ev-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class="ev-main">
          <span class="ev-label">{row.label}</span>
          <span class="ev-sub">{rowSummary(row, horizon)}</span>
        </span>
        <VerdictTag row={row} />
      </button>
      {open ? <DetailPanel row={row} horizon={horizon} /> : null}
    </div>
  );
}

export default function Evidence() {
  const d = useAsync(() => loadJson<EvidenceFile>('evidence.json'), []);
  const [filter, setFilter] = useState<Filter>('all');
  const rows = d.data ? sortRows(d.data.rows) : [];
  const c = counts(rows);
  const horizon = d.data?.meta.config?.primary_horizon ?? 10;
  const tThr = d.data?.meta.config?.stats.t_threshold ?? 2.5;
  const shown = filterRows(rows, filter);
  return (
    <div class="page">
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
            </p>
          </div>
          {d.data.meta.coverage_weekly?.whale?.length ? <CoverageChart weeks={d.data.meta.coverage_weekly.whale} /> : null}
          <div class="segmented ev-filter" role="group" aria-label="篩選">
            {([['all', `全部 ${rows.length}`], ['usable', `可用 ${c['有效'] + c['環境依賴']}`], ['other', `其他 ${rows.length - c['有效'] - c['環境依賴']}`]] as [Filter, string][]).map(([k, label]) => (
              <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
          {FAMILIES.map((fam) => {
            const list = shown.filter((r) => r.family === fam);
            if (!list.length) return null;
            return (
              <section key={fam} class="ev-group">
                <h2 class="section">{fam}</h2>
                <div class="list ev-list">{list.map((r) => <Row key={r.id} row={r} horizon={horizon} />)}</div>
              </section>
            );
          })}
          <p class="caption muted ev-foot">
            universe：上市櫃普通股，排除 ETF、存託憑證、處置股、上市櫃未滿 120 日、20 日均成交值 &lt; 2,000 萬、股價 &lt; 10 元（共 {d.data.meta.universe_stocks?.toLocaleString('zh-TW') ?? '—'} 檔）。
            訊號日隔天開盤進場、第 N 日開盤出場、扣成本；同一檔只計首次觸發。
          </p>
        </>
      ) : null}
    </div>
  );
}
