/**
 * 策略庫（M2）：指標效度評估包成的內建策略，依資料重新分級（有效／觀察中／停用）。
 * #/explore/strategies：清單；#/explore/strategies/:id：策略頁（健康度、今日新觸發、多期間與逐年報表、出場規則、樣本範圲）。
 * 策略清單依規則產生，非推薦；不提供下單。
 *
 * 2026-10-02 健檢：
 * - 數字只有一個來源：策略數＝lib/status.gradeCounts；基準切換時超額、t、勝率整組一起換，判定用的等權數字另外固定標「判定（等權）」。
 * - 勝率分成「絕對勝率」（報酬 > 0）與「超額勝率（相對 X）」（超額 > 0）。
 * - 卡片改成指標格（名稱＋標籤／一句規則／2×2 指標／未達列）；缺值一律附原因。
 */
import { useMemo, useState } from 'preact/hooks';
import { PageHead, TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { useAsync, useDb } from '../hooks';
import { loadJson } from '../data/api';
import { addWatchMany, listStrategies, saveStrategy, uid } from '../db/db';
import { LAB_PREFIX } from '../lib/config';
import { EquityChart } from '../components/EquityChart';
import { AlphaCurve } from '../components/AlphaCurve';
import { BenchSwitch, useBenchState } from '../components/BenchSwitch';
import { SortMenu } from '../components/SortMenu';
import { SwingCard } from '../components/SwingCard';
import { KeyValueList, MetricGrid, type MetricItem } from '../components/Metrics';
import { type Hindsight, coverageText } from '../lib/evidence';
import { fmtCount, md, missing, pctPlain, pctSigned, ratioPct, ratioText, tText } from '../lib/format';
import { BENCH_LONG, type BenchKey } from '../lib/bench';
import { type CurveLine, curveSummary } from '../lib/curve';
import { STRATEGY_SORT, type SortState, loadSort, saveSort, sortItems } from '../lib/sorting';
import { type GradeCounts, gradeCounts, gradeSummary, isListed, verdictDefinition, DEFAULT_GRADING } from '../lib/status';
import {
  type BenchCompare, type Grade, type Perf, type StrategiesFile, type StrategyItem, BENCH_KEYS, BENCH_LABEL, PERF_ROWS, basisText,
  benchTable, envLine, gradeOf, gradeTone, groupName, healthTone, judgeHold, judged, netExcess, paramRows,
} from '../lib/strategies';
import { IconChevron } from '../components/Icons';
import '../styles/evidence.css';

/** 回測成本（策略頁與策略庫頁尾共用；個人試算另用設定的券商折扣） */
const COST_NOTE = '回測成本：牌告手續費 0.1425%×2、證交稅 0.3%、滑價 0.1%×2；個人試算用你在設定的券商折扣。';
const benchNote = (hold: number) => `判定一律用同日等權（${hold} 日、扣成本），不隨切換改變；切換只改變「相對基準」那一組的超額、t、超額勝率。`;
const relLabel = (bench: BenchKey) => (bench === '0050' ? '0050 含息' : BENCH_LABEL[bench]);

export const loadStrategies = () => loadJson<StrategiesFile>('strategies.json');

/** 分級標籤：有效＝強調、觀察中＝一般、停用＝弱化；琥珀只給樣本範圍受限與健康度風險。 */
function GradeTag({ s }: { s: StrategyItem }) {
  const g = gradeOf(s);
  const tone = gradeTone(g);
  return <span class={`tag ev-verdict${tone === 'strong' ? ' strong' : tone === 'muted' ? ' muted' : ''}`} data-testid="grade-tag" data-grade={g}>{s.grade_label ?? g}</span>;
}

function Tags({ s }: { s: StrategyItem }) {
  return (
    <span class="tags">
      <GradeTag s={s} />
      {s.limited ? <span class="tag risk">資料不足</span> : s.verdict === '樣本範圍受限' ? <span class="tag risk">{s.verdict}</span> : null}
      {s.enabled && s.health && s.health.status !== '資料累積中' ? <span class={`tag ${healthTone(s.health.status) === 'risk' ? 'risk' : ''}`}>{s.health.status}</span> : null}
    </span>
  );
}

/** 卡片與頁首共用的 2×2 指標：判定（等權）兩格固定，相對基準一格隨切換，每月觸發一格。 */
function coreMetrics(s: StrategyItem, bench: BenchKey, compact: boolean): MetricItem[] {
  const j = judged(s, bench);
  const ew = judged(s, 'ew');
  const hold = judgeHold(s);
  const items: MetricItem[] = [
    { k: '校正後 t（判定・等權）', v: tText(s.t_corr), sub: compact ? undefined : `日曆時間法 t ${tText(ew.t)}` },
    { k: `${hold} 日扣成本超額（判定・等權）`, v: pctSigned(netExcess(s)), sub: compact ? undefined : `超額勝率 ${pctPlain(ew.win)}・絕對勝率 ${pctPlain(s.win)}` },
  ];
  if (bench === 'ew') items.push({ k: '超額勝率（相對等權）', v: pctPlain(ew.win), sub: `絕對勝率 ${pctPlain(s.win)}` });
  else items.push({ k: `${hold} 日超額（相對 ${relLabel(bench)}）`, v: pctSigned(j.excess), sub: `t ${tText(j.t)}・超額勝率 ${pctPlain(j.win)}` });
  items.push({ k: '每月觸發', v: s.per_month === null || s.per_month === undefined ? missing('沒有樣本') : `${s.per_month} 檔`, sub: compact ? undefined : `去重樣本 ${fmtCount(s.n)} 筆` });
  return items;
}

function sortRows(list: StrategyItem[], sort: SortState, bench: BenchKey) {
  return sortItems(
    list.map((s) => {
      const j = judged(s, bench);
      return {
        s, label: s.label, verdict: s.verdict, t: j.t, excess: j.excess, health: s.health?.recent ?? null, today: s.today?.length ?? 0,
        rank: s.rank ?? null, t_corr: s.t_corr ?? null, win: j.win, per_month: s.per_month ?? null, family: s.family ?? s.selection?.family ?? null,
      };
    }),
    sort,
  ).map((x) => x.s);
}

/** 策略卡：名稱＋標籤／一句規則／2×2 指標／未達列（只列未達，已通過的不列）。 */
function Row({ s, bench, off }: { s: StrategyItem; bench: BenchKey; off?: boolean }) {
  return (
    <a class="ev-row st-row st-card" href={`#/explore/strategies/${s.id}`} data-testid={`st-row-${s.id}`}>
      <span class="ev-main">
        <span class="st-card-head"><span class="ev-label">{s.label}</span><Tags s={s} /></span>
        <span class="ev-sub st-rule">{s.subtitle}</span>
        {off ? (
          <span class="ev-sub st-unmet">{s.grade_reason || s.reasons.join('；') || '未達分級門檻'}</span>
        ) : (
          <>
            <MetricGrid items={coreMetrics(s, bench, true)} label={`${s.label} 的指標`} testid="st-metrics" />
            <span class="ev-sub">{envLine(s)}・今日新觸發 {s.today?.length ?? 0} 檔{s.rank ? `・排名 ${s.rank}` : ''}</span>
            {s.grade_reason ? <span class="ev-sub st-unmet" data-testid="st-unmet">{s.grade_reason}</span> : null}
            {s.limited && s.limited_note ? <span class="ev-sub risk-text">{s.limited_note}</span> : null}
          </>
        )}
      </span>
    </a>
  );
}

const GRADES: Grade[] = ['有效', '觀察中', '停用'];
const SECTION_TITLE: Record<Grade, string> = { 有效: '有效', 觀察中: '觀察中', 停用: '停用與未通過' };
function emptyText(g: Grade): string {
  if (g === '有效') return `目前沒有分級為「有效」的策略。${verdictDefinition(DEFAULT_GRADING)}`;
  if (g === '觀察中') return '目前沒有分級為「觀察中」的策略（40 日扣成本超額 > 0 且校正後 t ≥ 2，但未達有效）。';
  return '沒有停用的策略。';
}

function StrategyList({ data }: { data: StrategiesFile }) {
  const [bench, setBench] = useBenchState();
  const [sort, setSortState] = useState<SortState>(() => loadSort('strategies', STRATEGY_SORT));
  const setSort = (x: SortState) => { saveSort('strategies', x); setSortState(x); };
  const [openOff, setOpenOff] = useState(false);
  const groups = useMemo(() => {
    const by: Record<Grade, StrategyItem[]> = { 有效: [], 觀察中: [], 停用: [] };
    for (const s of data.strategies) by[gradeOf(s)].push(s);
    // 資料不足區的策略不排名：放在同一分級的最後
    const lim = (l: StrategyItem[]) => [...l.filter((s) => !s.limited), ...l.filter((s) => s.limited)];
    return { 有效: lim(sortRows(by['有效'], sort, bench)), 觀察中: lim(sortRows(by['觀察中'], sort, bench)), 停用: sortRows(by['停用'], sort, bench) };
  }, [data.strategies, sort, bench]);
  return (
    <>
      <BenchSwitch value={bench} onChange={setBench} note={`${benchNote(data.horizon)}目前：${BENCH_LONG[bench]}`} />
      <SortMenu id="strategies" value={sort} onChange={setSort} options={STRATEGY_SORT} />
      {GRADES.map((g) => {
        const list = groups[g];
        const id = `st-sec-${g}`;
        if (g === '停用') {
          return (
            <section key={g} class="st-sec" data-testid={id}>
              <button type="button" class="collapsed-row st-fold" aria-expanded={openOff} aria-controls={`${id}-list`} onClick={() => setOpenOff(!openOff)}>
                <span class="section st-sec-h">{SECTION_TITLE[g]}（{list.length}）</span>
                <IconChevron />
              </button>
              {openOff ? (
                <div class="list ev-list" id={`${id}-list`} data-testid={`${id}-list`}>
                  {list.length ? list.map((s) => <Row key={s.id} s={s} bench={bench} off />) : <p class="list-item caption muted">{emptyText(g)}</p>}
                </div>
              ) : null}
            </section>
          );
        }
        return (
          <section key={g} class="st-sec" data-testid={id}>
            <h2 class="section st-sec-h">{SECTION_TITLE[g]}（{list.length}）</h2>
            <div class="list ev-list" data-testid={`${id}-list`}>
              {list.length ? list.map((s) => <Row key={s.id} s={s} bench={bench} />) : <p class="list-item caption muted">{emptyText(g)}</p>}
            </div>
          </section>
        );
      })}
      <p class="caption muted ev-foot" data-testid="cost-note">{COST_NOTE}</p>
    </>
  );
}

/** v3 M5-5 今日新觸發：每列可展開，列出各條件的當日數值（觸發依據）；0 檔時說明原因。 */
function TodayList({ s, date }: { s: StrategyItem; date: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!s.today?.length) {
    return <div class="list"><div class="list-item caption muted" data-testid="today-empty">今天沒有新觸發：{s.today_note ?? '沒有股票首次同時符合全部條件。'}</div></div>;
  }
  return (
    <div class="list" data-testid="today-list">
      {s.today.map((x) => (
        <div key={x.code} class="st-trig">
          <button type="button" class="ev-row" aria-expanded={open === x.code} onClick={() => setOpen(open === x.code ? null : x.code)}>
            <span class="ev-main"><span class="ev-label">{x.name} <span class="muted">{x.code}</span></span><span class="ev-sub">觸發依據（{md(date)}）</span></span>
            <span aria-hidden="true" class="muted">{open === x.code ? '▲' : '▼'}</span>
          </button>
          {open === x.code ? (
            <div class="ev-detail">
              <ul class="st-basis">{(x.basis ?? []).map((b) => <li key={b.label} class="caption">{basisText(b)}</li>)}</ul>
              <a class="btn small" href={`#/stock/${x.code}`}>看個股頁</a>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function HindsightCard({ h }: { h: Hindsight }) {
  return (
    <div class="card" data-testid="hindsight-card">
      <p class="body"><b>原 31 檔 vs 全市場</b></p>
      {h.status === 'waiting' ? (
        <p class="caption muted">全市場集保回補中：涵蓋率 {ratioPct(h.coverage)}，達 {ratioPct(h.threshold ?? 0.9, 0)} 後自動計算。原 31 檔是 2026-09 依成交值挑的熱門股，有後見之明偏差。</p>
      ) : (
        <p class="caption">原 31 檔 {pctSigned(h.orig?.mean_excess)}（t {tText(h.orig?.t)}，{fmtCount(h.orig?.n ?? 0)} 筆）；全市場 {pctSigned(h.full?.mean_excess)}（t {tText(h.full?.t)}，{fmtCount(h.full?.n ?? 0)} 筆）；選樣偏差估計 {pctSigned(h.bias)}。</p>
      )}
    </div>
  );
}

function Actions({ s, date, horizon }: { s: StrategyItem; date: string; horizon: number }) {
  const tracked = useDb(() => listStrategies(), []);
  const [msg, setMsg] = useState('');
  const presetId = LAB_PREFIX + s.id;
  const isTracked = (tracked ?? []).some((t) => t.presetId === presetId && t.active);
  const codes = (s.today ?? []).map((x) => x.code);
  return (
    <div class="st-actions">
      {codes.length ? (
        <button class="btn" onClick={async () => {
          const n = await addWatchMany(codes, groupName(s));
          setMsg(n ? `已加入自選群組「${groupName(s)}」${n} 檔` : '這些股票已經在群組裡');
        }}>今日觸發全部加入自選群組</button>
      ) : null}
      <button class="btn" disabled={isTracked} onClick={async () => {
        await saveStrategy({ id: uid(), presetId, name: s.label, conditions: [], horizon, startAfter: date, enabledAt: new Date().toISOString(), active: true });
        setMsg(`已設為訊號追蹤：${md(date)} 之後的新觸發開始記錄（紀律 → 訊號追蹤）`);
      }}>{isTracked ? '已在訊號追蹤' : '設為訊號追蹤'}</button>
      {msg ? <p class="caption" role="status">{msg}</p> : null}
    </div>
  );
}

function perfText(p: Perf | undefined, key: keyof Perf, kind: 'pct' | 'ratio' | 'days'): string {
  const v = p?.[key];
  if (v === null || v === undefined || typeof v === 'object') return '—';
  if (kind === 'pct') return pctSigned(v);
  if (kind === 'days') return fmtCount(v);
  return ratioText(v);
}

/** v3 M2-3：組合與 (b)(c)(d) 同期的績效指標，以及月報酬對加權報酬指數的迴歸。 */
function CompareTable({ c, slots }: { c: BenchCompare; slots: number }) {
  const cols: [string, Perf | undefined][] = [[`${slots} 檔組合`, c.strategy], ['加權報酬', c.tr], ['0050', c['0050']], ['00631L', c['00631L']]];
  const r = c.regression;
  return (
    <>
      <h2 class="section st-h">與基準同期比較</h2>
      <table class="ev-table ev-static" aria-label="策略與基準的績效指標">
        <thead><tr><th scope="col">指標</th>{cols.map(([k]) => <th key={k} scope="col">{k}</th>)}</tr></thead>
        <tbody>
          {PERF_ROWS.map((row) => (
            <tr key={row.key}><th scope="row">{row.label}</th>{cols.map(([k, p]) => <td key={k}>{perfText(p, row.key, row.kind)}</td>)}</tr>
          ))}
        </tbody>
      </table>
      <p class="caption muted">
        {c.period ? `${c.period[0]}～${c.period[1]}。` : ''}
        {r && r.months >= 6
          ? `月報酬對加權報酬指數迴歸：β ${ratioText(r.beta)}、年化 α ${pctSigned(r.alpha_ann)}（t ${tText(r.alpha_t)}）、R² ${ratioText(r.r2)}（${r.months} 個月）。`
          : `月報酬迴歸：—（同期月數 ${r?.months ?? 0} 個，不足 6 個月）。`}
        Sharpe 以無風險利率 0 計；回撤天數＝最長的回撤持續交易日數。
      </p>
    </>
  );
}

/** 健康度卡：資料累積中時寫清楚缺什麼，不印「— 起」。 */
function HealthCard({ s, minRecent = 20 }: { s: StrategyItem; minRecent?: number }) {
  const h = s.health;
  const hold = judgeHold(s);
  if (!h) return <div class="card"><p class="caption muted">健康度：—（這套策略沒有近期統計）。</p></div>;
  const items: MetricItem[] = [
    { k: '近 60 個交易日平均超額', v: h.recent_n >= minRecent ? pctSigned(h.recent) : missing(`樣本 ${h.recent_n} 筆，需 ${minRecent} 筆`), sub: `已完成 ${hold} 日持有的 ${fmtCount(h.recent_n)} 筆${h.since ? `・${md(h.since)} 起` : ''}` },
    { k: '長期平均超額', v: pctSigned(h.long), sub: '相對同日等權、扣成本' },
  ];
  return (
    <div class="card">
      <p class="body"><b>{h.status}</b></p>
      <MetricGrid items={items} label="健康度" />
      <p class="caption">{envLine(s)}</p>
    </div>
  );
}

/** 出場規則卡：沒有比較結果時寫原因，不印整段破折號。 */
function ExitCard({ s }: { s: StrategyItem }) {
  const [showAlt, setShowAlt] = useState(false);
  const ex = s.exit;
  const hold = judgeHold(s);
  const st = ex?.stats ?? {};
  const hasStats = st.n !== undefined && st.n !== null;
  return (
    <div class="card">
      <p class="body"><b>{ex?.label ?? `固定 ${hold} 日`}</b></p>
      {hasStats ? (
        <MetricGrid items={[
          { k: '期望值（扣成本）', v: pctSigned(st.ev) },
          { k: '相對加權報酬', v: pctSigned(st.exc_idx) },
          { k: '絕對勝率', v: pctPlain(st.win) },
          { k: '平均持有', v: st.hold === null || st.hold === undefined ? '—' : `${st.hold.toFixed(1)} 日` },
          { k: '最大不利波動平均', v: pctSigned(st.mae) },
          { k: '跌停鎖死', v: `${st.locked ?? 0} 次` },
        ]} label="出場規則統計" />
      ) : (
        <p class="caption muted">出場規則比較：—（{s.kind === 'swing' ? '波段策略以固定持有日出場，不另比較出場規則' : '指標判定未達有效／環境依賴時不計算出場規則比較'}）。</p>
      )}
      <p class="caption muted">依出場規則比較（相對加權報酬最高者）選用；勝率為絕對勝率（扣成本報酬 &gt; 0）。</p>
      {ex?.alternatives?.length ? (
        <>
          <button class="btn small" aria-expanded={showAlt} onClick={() => setShowAlt(!showAlt)}>{showAlt ? '收起其他出場規則' : '看其他出場規則'}</button>
          {showAlt ? (
            <table class="ev-table ev-static" aria-label="出場規則比較">
              <thead><tr><th scope="col">出場</th><th scope="col">相對加權報酬</th><th scope="col">絕對勝率</th><th scope="col">持有日</th></tr></thead>
              <tbody>
                {ex.alternatives.map((r) => (
                  <tr key={r.label}><th scope="row" class="ev-wrap">{r.label}</th><td>{pctSigned(r.exc_idx)}</td><td>{pctPlain(r.win)}</td><td>{r.hold === null ? '—' : r.hold.toFixed(1)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** 樣本範圍：指標判定與策略分級分開寫（不再出現「判定：無效」配頁首「觀察中」）；參數用中文標籤並另列原始參數。 */
function ScopeList({ s }: { s: StrategyItem }) {
  const hold = judgeHold(s);
  const gates = s.swing?.gates;
  const passed = gates ? Object.values(gates.checks ?? {}).filter(Boolean).length : 0;
  const total = gates ? Object.keys(gates.checks ?? {}).length : 0;
  const params = paramRows(s.param);
  const rows = [
    s.kind === 'swing'
      ? { k: '上線門檻', v: total ? `${passed}／${total} 項通過` : '—（最終測試段只在部署時計算）', sub: '波段策略不做指標判定；策略分級見頁首' }
      : { k: '指標判定', v: `${s.verdict}`, sub: `等權 ${hold} 日 t ${tText(s.t)}（指標效度表的判定）；策略分級見頁首` },
    { k: '涵蓋率', v: coverageText(s.coverage) },
    { k: '資料起始', v: s.data_start ?? missing('沒有這個資料集的起始日') },
    { k: '訊號期間', v: s.signal_start ? `${s.signal_start}～${s.signal_end ?? '資料結束'}` : missing('沒有訊號') },
    { k: '去重樣本', v: `${fmtCount(s.n ?? 0)} 筆` },
    ...(params.length ? [{ k: '參數', v: params.map((p) => `${p.label} ${p.value}`).join('、'), sub: `原始參數：${s.param}` }] : []),
  ];
  return <KeyValueList rows={rows} label="樣本範圍" />;
}

function Detail({ s, data }: { s: StrategyItem; data: StrategiesFile }) {
  const [yearView, setYearView] = useState<'strategy' | 'bench'>('strategy');
  const hold = judgeHold(s);
  const slots = s.curve?.slots ?? s.swing?.portfolio?.slots ?? 5;
  const p5 = s.portfolio?.[String(slots)] ?? s.portfolio?.['5'];
  const cmp = s.compare;
  const listed = isListed(s);
  const [bench, setBench] = useBenchState();
  type CurveFile = { curve?: Partial<Record<BenchKey, CurveLine>> & { n?: number } };
  const curve = useAsync(() => loadJson<CurveFile>(`evidence/${s.test}.json`).catch((): CurveFile => ({})), [s.test]);
  const curveLine = curve.data?.curve?.[bench];
  const years = Object.keys({ ...(s.years ?? {}), ...(p5?.yearly ?? {}) }).sort();
  const bt = benchTable(s);
  const hs = Object.entries(s.h ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  return (
    <>
      <PageHead eyebrow={s.subtitle} title={s.label}>
        <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>依規則產生，非推薦・資料至 {md(data.date)}</p>
        <Tags s={s} />
        {s.grade_reason ? <p class="caption risk-text" data-testid="grade-reason" style={{ marginTop: 'var(--s-1)' }}>{s.grade_reason}</p> : null}
        {s.limited && s.limited_note ? <p class="caption risk-text" style={{ marginTop: 'var(--s-1)' }}>{s.limited_note}</p> : null}
        <MetricGrid items={coreMetrics(s, bench, false)} label="策略的判定與目前基準" testid="st-head-metrics" />
        {s.excess_h?.['20'] !== undefined && hold !== 20 ? <p class="caption muted">20 日扣成本超額（等權）{pctSigned(s.excess_h['20'])}{s.mean_gross_excess !== undefined ? `・毛超額 ${pctSigned(s.mean_gross_excess)}` : ''}{s.family ? `・${s.family}` : ''}</p> : null}
        {s.split2022 ? (
          <p class="caption muted" data-testid="split2022" style={{ marginTop: 'var(--s-1)' }}>
            {s.split2022.date.slice(0, 4)} 前 {pctSigned(s.split2022.pre?.mean_excess)}（t {tText(s.split2022.pre?.t)}、{fmtCount(s.split2022.pre?.n ?? 0)} 筆）／後 {pctSigned(s.split2022.post?.mean_excess)}（t {tText(s.split2022.post?.t)}、{fmtCount(s.split2022.post?.n ?? 0)} 筆）
          </p>
        ) : null}
      </PageHead>

      <h2 class="section st-h">健康度</h2>
      <HealthCard s={s} />

      <h2 class="section st-h">今日新觸發（{md(data.date)}）</h2>
      <TodayList s={s} date={data.date} />
      {s.env && !s.env.today ? <p class="caption risk-text">今日大盤環境不符合這個策略的啟用條件。</p> : null}
      {s.enabled ? <Actions s={s} date={data.date} horizon={data.horizon} /> : <p class="caption muted">分級為「{gradeOf(s)}」（{s.grade_reason || s.reasons.join('；') || '未達分級門檻'}），不能設為訊號追蹤。</p>}

      {s.hindsight ? <HindsightCard h={s.hindsight} /> : null}
      {s.swing ? <SwingCard sw={s.swing} hold={s.swing.hold} /> : null}

      <BenchSwitch value={bench} onChange={setBench} note={`${benchNote(hold)}目前：${BENCH_LONG[bench]}`} />
      <h2 class="section st-h">多期間表現（相對{BENCH_LABEL[bench]}）</h2>
      <table class="ev-table ev-static" aria-label={`各持有天數的超額報酬，相對${BENCH_LABEL[bench]}`}>
        <thead><tr><th scope="col">持有</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">超額勝率</th><th scope="col">樣本</th></tr></thead>
        <tbody>
          {hs.map(([k, v]) => {
            const b = bench === 'ew' ? { mean_excess: v.mean_excess, t: v.t, win: v.bench?.ew?.win } : v.bench?.[bench] ?? {};
            return (
              <tr key={k} class={Number(k) === hold ? 'ev-chosen' : undefined}>
                <th scope="row">{k} 日{k === '120' ? '＊' : ''}</th><td>{pctSigned(b.mean_excess)}</td><td>{tText(b.t)}</td><td>{pctPlain(b.win)}</td><td>{fmtCount(v.n ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="caption muted">超額扣成本，各持有天數各自去重（同一檔在持有期間內不重複計入），所以每一列的樣本不同；判定以 {hold} 日為主、20 日並列，其餘只供參考；＊120 日只做參考。t 為日曆時間法（未校正）；判定用的校正後 t 在頁首。</p>
      <h2 class="section st-h">累積超額曲線（相對{BENCH_LABEL[bench]}）</h2>
      {curveLine ? (
        <>
          <AlphaCurve line={curveLine} label={`相對${BENCH_LABEL[bench]}`} n={curve.data?.curve?.n} />
          <p class="caption">{curveSummary(curveLine)}</p>
          <p class="caption muted">曲線樣本＝{hold} 日去重事件 {fmtCount(curve.data?.curve?.n ?? 0)} 筆，看進場後第 k 日收盤的累積超額、不扣成本；與上表（各持有天數各自去重、扣成本）的筆數與數值不同。</p>
        </>
      ) : <p class="caption muted">累積超額曲線：—（{curve.loading ? '載入中' : curve.data?.curve ? `這個基準沒有曲線資料（pipeline 沒有 ${BENCH_LABEL[bench]} 的序列）` : '這套策略沒有曲線檔；重新部署後產生'}）。</p>}

      {listed && (p5 || s.curve?.dates?.length) ? (
        <>
          <h2 class="section st-h">{slots} 檔組合</h2>
          <p class="caption muted">同時最多持有 {slots} 檔、每檔 1/{slots} 權益、依出場規則，扣成本{s.kind === 'swing' ? '；含共用規則（大盤 240 日線下不開新倉、20 日乖離 &gt; 20% 不進場）' : ''}。基準為同期持有不動（還原價、含息，不扣成本）；首尾年份不是完整年度。</p>
          {s.curve?.dates?.length ? (
            <EquityChart
              dates={s.curve.dates}
              series={[
                { key: 'strategy', label: `${slots} 檔組合`, values: s.curve.equity },
                { key: '0050', label: '0050', values: s.curve.etf?.['0050'] ?? [], missing: s.curve.missing?.['0050'] ?? '資料檔沒有 0050 序列' },
                { key: 'tr', label: '加權報酬', values: s.curve.bench ?? [], missing: s.curve.missing?.tr ?? '資料檔沒有加權報酬指數序列' },
                { key: '00631L', label: '00631L', values: s.curve.etf?.['00631L'] ?? [], missing: s.curve.missing?.['00631L'] ?? '資料檔沒有 00631L 序列' },
              ]}
            />
          ) : <p class="caption muted">權益曲線：—（這套策略沒有週權益序列）。</p>}
          <h3 class="ev-h">逐年報酬</h3>
          {p5 && cmp ? (
            <div class="segmented st-seg" role="group" aria-label="逐年報酬的欄位">
              <button aria-pressed={yearView === 'strategy'} onClick={() => setYearView('strategy')}>策略</button>
              <button aria-pressed={yearView === 'bench'} onClick={() => setYearView('bench')}>對照基準</button>
            </div>
          ) : null}
          {yearView === 'strategy' || !p5 || !cmp ? (
            <table class="ev-table ev-static" aria-label="逐年報酬">
              <thead><tr><th scope="col">年份</th>{p5 ? <th scope="col">{slots} 檔組合</th> : null}<th scope="col">訊號超額</th>{s.trades ? <th scope="col">筆數</th> : null}</tr></thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y}><th scope="row">{y}</th>{p5 ? <td>{pctSigned(p5.yearly?.[y])}</td> : null}<td>{pctSigned(s.years?.[y])}</td>{s.trades ? <td>{fmtCount(s.trades.yearly?.[y]?.n ?? 0)}</td> : null}</tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table class="ev-table ev-static" aria-label="逐年報酬與基準">
              <thead><tr><th scope="col">年份</th><th scope="col">{slots} 檔組合</th><th scope="col">加權報酬</th><th scope="col">0050</th><th scope="col">00631L</th></tr></thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y}><th scope="row">{y}</th><td>{pctSigned(p5?.yearly?.[y])}</td><td>{pctSigned(cmp?.tr?.yearly?.[y])}</td><td>{pctSigned(cmp?.['0050']?.yearly?.[y])}</td><td>{pctSigned(cmp?.['00631L']?.yearly?.[y])}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {cmp ? <CompareTable c={cmp} slots={slots} /> : null}
        </>
      ) : (
        <p class="caption muted st-h">{listed ? `組合模擬：—（這套策略沒有組合模擬資料）。` : `分級為「${gradeOf(s)}」：不顯示組合模擬與權益曲線（只對上架的策略模擬）。`}</p>
      )}

      {bt ? (
        <>
          <h2 class="section st-h">訊號對四種基準（{hold} 日）</h2>
          <table class="ev-table ev-static" aria-label="訊號相對四種基準的超額">
            <thead><tr><th scope="col">基準</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">超額勝率</th></tr></thead>
            <tbody>
              {BENCH_KEYS.map((k) => {
                const b = bt[k];
                return <tr key={k} class={k === bench ? 'ev-chosen' : undefined}><th scope="row">{BENCH_LABEL[k]}</th><td>{pctSigned(b?.mean_excess)}</td><td>{tText(b?.t)}</td><td>{pctPlain(b?.win)}</td></tr>;
              })}
            </tbody>
          </table>
          <p class="caption muted">判定以等權為準；超額勝率＝超額 &gt; 0 的比例（絕對勝率見頁首）。{s.large_cap ? `相對 0050 不顯著（t ${tText(s.t_0050)}）：${s.large_cap}。` : ''}00631L 為 2 倍槓桿 ETF（每日再平衡，長期有波動耗損），用來對照任何槓桿情境。</p>
        </>
      ) : null}

      <h2 class="section st-h">出場規則</h2>
      <ExitCard s={s} />

      <h2 class="section st-h">樣本範圍</h2>
      <ScopeList s={s} />
      {s.note ? <p class="caption risk-text">{s.note}</p> : null}
      <p class="caption muted">{s.definition}</p>
      <p class="caption muted" data-testid="cost-note">{COST_NOTE}</p>
      <div class="st-actions">
        <a class="btn" href={`#/explore/leverage?s=${s.id}`}>槓桿風險計算</a>
        <a class="btn" href="#/explore/evidence">指標效度表</a>
      </div>
    </>
  );
}

function headTitle(c: GradeCounts): string {
  return `策略庫：${gradeSummary(c)}`;
}

export default function Strategies({ id }: { id?: string }) {
  const d = useAsync(loadStrategies, []);
  const s = id ? d.data?.strategies.find((x) => x.id === id) : undefined;
  return (
    <div class="page has-bench">
      <TopBar back={id ? '/explore/strategies' : '/explore'} />
      {!id ? (
        <PageHead eyebrow="依指標效度評估包成的策略" title={d.data ? headTitle(gradeCounts(d.data.strategies)) : '策略庫'}>
          <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>依規則產生，非推薦。每日依資料重新分級：有效、觀察中會上架並可設為訊號追蹤；停用與未通過的只列在下方供查閱。</p>
        </PageHead>
      ) : null}
      {d.loading ? <Loading /> : null}
      {d.error ? <ErrorState error={d.error} /> : null}
      {d.data && !id ? <StrategyList data={d.data} /> : null}
      {d.data && id ? (s ? <Detail key={s.id} s={s} data={d.data} /> : <p class="caption">找不到這個策略。</p>) : null}
    </div>
  );
}
