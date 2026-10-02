/**
 * 策略庫（M2）：指標效度評估判定為「有效」或「環境依賴」的指標包成的內建策略。
 * #/explore/strategies：清單；#/explore/strategies/:id：策略頁（健康度、今日新觸發、多期間與逐年報表、出場規則、樣本範圍）。
 * 策略清單依規則產生，非推薦；不提供下單。
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
import { type Hindsight, coverageText, pctSigned, tText } from '../lib/evidence';
import { BENCH_LONG, type BenchKey, benchPick } from '../lib/bench';
import { type CurveLine, curveSummary } from '../lib/curve';
import { STRATEGY_SORT, type SortState, loadSort, saveSort, sortItems } from '../lib/sorting';
import {
  type BenchCompare, type Grade, type Perf, type StrategiesFile, type StrategyItem, BENCH_KEYS, BENCH_LABEL, PERF_ROWS, basisText,
  envLine, gradeOf, gradeTone, groupName, healthTone, judgeHold, netExcess,
} from '../lib/strategies';
import { IconChevron } from '../components/Icons';
import '../styles/evidence.css';

/** 回測成本（策略頁與策略庫頁尾共用；個人試算另用設定的券商折扣） */
const COST_NOTE = '回測成本：牌告手續費 0.1425%×2、證交稅 0.3%、滑價 0.1%×2；個人試算用你在設定的券商折扣。';
const BENCH_NOTE = '判定依同日等權（40 日、扣成本）；畫面可切換顯示相對 0050 含息';

export const loadStrategies = () => loadJson<StrategiesFile>('strategies.json');

function md(d: string | null | undefined): string {
  if (!d) return '—';
  const [, m, day] = d.split('-');
  return `${Number(m)}/${Number(day)}`;
}

/** 分級標籤：有效＝強調、觀察中＝一般、停用＝弱化；琥珀只給樣本範圍受限與健康度風險。 */
function GradeTag({ s }: { s: StrategyItem }) {
  const g = gradeOf(s);
  const tone = gradeTone(g);
  return <span class={`tag ev-verdict${tone === 'strong' ? ' strong' : tone === 'muted' ? ' muted' : ''}`} data-testid="grade-tag" data-grade={g}>{s.grade_label ?? g}</span>;
}

function Tags({ s }: { s: StrategyItem }) {
  return (
    <span class="st-tags">
      <GradeTag s={s} />
      {s.verdict === '樣本範圍受限' ? <span class="tag risk">{s.verdict}</span> : null}
      {s.enabled && s.health ? <span class={`tag ${healthTone(s.health.status) === 'risk' ? 'risk' : ''}`}>{s.health.status}</span> : null}
    </span>
  );
}

/** 選定基準下的主判定持有天數（40 日；波段策略用自己的 hold）超額、t、勝率。 */
function judged(s: StrategyItem, bench: BenchKey): { hold: number; excess: number | null; t: number | null; win: number | null } {
  const hold = judgeHold(s);
  const h = s.h?.[String(hold)];
  const bt = h?.bench ?? s.swing?.full?.bench ?? (hold === 40 ? s.bench : undefined);
  if (bench === 'ew') return { hold, excess: netExcess(s, hold), t: h?.t ?? s.t ?? null, win: s.win ?? s.swing?.full?.win ?? bt?.ew?.win ?? null };
  const b = benchPick(h ?? { mean_excess: s.mean_excess, t: s.t }, bt, bench);
  return { hold, excess: b.mean_excess ?? null, t: b.t ?? null, win: b.win ?? null };
}

const winText = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${v.toFixed(0)}%`);

/** 列表的一句話：「校正後 t X・40 日扣成本超額 ±Y%・勝率 Z%・每月 N 檔」（切到其他基準時超額與勝率換基準並標示）。 */
function listLine(s: StrategyItem, bench: BenchKey): string {
  const j = judged(s, bench);
  const rel = bench === 'ew' ? '' : `（相對 ${bench === '0050' ? '0050 含息' : BENCH_LABEL[bench]}）`;
  return `校正後 t ${tText(s.t_corr)}・${j.hold} 日扣成本超額 ${pctSigned(j.excess)}${rel}・勝率 ${winText(j.win)}・每月 ${s.per_month ?? '—'} 檔`;
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

function Row({ s, bench, off }: { s: StrategyItem; bench: BenchKey; off?: boolean }) {
  return (
    <a class="ev-row st-row" href={`#/explore/strategies/${s.id}`} data-testid={`st-row-${s.id}`}>
      <span class="ev-main">
        <span class="ev-label">{s.label}</span>
        <span class="ev-sub">{s.subtitle}</span>
        {off ? (
          <span class="ev-sub">{s.grade_reason || s.reasons.join('；') || '未通過驗證'}</span>
        ) : (
          <>
            <span class="ev-sub" data-testid="st-line">{listLine(s, bench)}</span>
            <span class="ev-sub">{envLine(s)}・今日新觸發 {s.today?.length ?? 0} 檔{s.rank ? `・排名 ${s.rank}` : ''}</span>
            {s.grade_reason ? <span class="ev-sub">{s.grade_reason}</span> : null}
          </>
        )}
      </span>
      <Tags s={s} />
    </a>
  );
}

const GRADES: Grade[] = ['有效', '觀察中', '停用'];
const SECTION_TITLE: Record<Grade, string> = { 有效: '有效', 觀察中: '觀察中', 停用: '停用與未通過' };
const EMPTY_TEXT: Record<Grade, string> = {
  有效: '目前沒有分級為「有效」的策略：需要 40 與 20 日扣成本超額皆 > 0、校正後 t ≥ 3、2022 前後皆為正、逐年 ≥ 70% 為正、每月觸發 ≥ 10、樣本 ≥ 5 年。',
  觀察中: '目前沒有分級為「觀察中」的策略（40 日扣成本超額 > 0 且校正後 t ≥ 2，但未達有效）。',
  停用: '沒有停用的策略。',
};

function StrategyList({ data }: { data: StrategiesFile }) {
  const [bench, setBench] = useBenchState();
  const [sort, setSortState] = useState<SortState>(() => loadSort('strategies', STRATEGY_SORT));
  const setSort = (x: SortState) => { saveSort('strategies', x); setSortState(x); };
  const [openOff, setOpenOff] = useState(false);
  const groups = useMemo(() => {
    const by: Record<Grade, StrategyItem[]> = { 有效: [], 觀察中: [], 停用: [] };
    for (const s of data.strategies) by[gradeOf(s)].push(s);
    return { 有效: sortRows(by['有效'], sort, bench), 觀察中: sortRows(by['觀察中'], sort, bench), 停用: sortRows(by['停用'], sort, bench) };
  }, [data.strategies, sort, bench]);
  return (
    <>
      <BenchSwitch value={bench} onChange={setBench} note={BENCH_NOTE} />
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
                  {list.length ? list.map((s) => <Row key={s.id} s={s} bench={bench} off />) : <p class="list-item caption muted">{EMPTY_TEXT[g]}</p>}
                </div>
              ) : null}
            </section>
          );
        }
        return (
          <section key={g} class="st-sec" data-testid={id}>
            <h2 class="section st-sec-h">{SECTION_TITLE[g]}（{list.length}）</h2>
            <div class="list ev-list" data-testid={`${id}-list`}>
              {list.length ? list.map((s) => <Row key={s.id} s={s} bench={bench} />) : <p class="list-item caption muted">{EMPTY_TEXT[g]}</p>}
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
        <p class="caption muted">全市場集保回補中：涵蓋率 {Math.round(h.coverage * 100)}%，達 {Math.round((h.threshold ?? 0.9) * 100)}% 後自動計算。原 31 檔是 2026-09 依成交值挑的熱門股，有後見之明偏差。</p>
      ) : (
        <p class="caption">原 31 檔 {pctSigned(h.orig?.mean_excess)}（t {tText(h.orig?.t)}，{h.orig?.n ?? 0} 筆）；全市場 {pctSigned(h.full?.mean_excess)}（t {tText(h.full?.t)}，{h.full?.n ?? 0} 筆）；選樣偏差估計 {pctSigned(h.bias)}。</p>
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
      <button class="btn" disabled={!codes.length} onClick={async () => {
        const n = await addWatchMany(codes, groupName(s));
        setMsg(n ? `已加入自選群組「${groupName(s)}」${n} 檔` : '這些股票已經在群組裡');
      }}>今日觸發全部加入自選群組</button>
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
  if (kind === 'pct') return pctSigned(v, 1);
  if (kind === 'days') return `${v.toLocaleString('zh-TW')}`;
  return tText(v);
}

/** v3 M2-3：5 檔組合與 (b)(c)(d) 同期的績效指標，以及月報酬對加權報酬指數的迴歸。 */
function CompareTable({ c }: { c: BenchCompare }) {
  const cols: [string, Perf | undefined][] = [['組合', c.strategy], ['加權報酬', c.tr], ['0050', c['0050']], ['00631L', c['00631L']]];
  const r = c.regression;
  return (
    <>
      <h2 class="section st-h">與基準同期比較</h2>
      <table class="ev-table" aria-label="策略與基準的績效指標">
        <thead><tr><th scope="col">指標</th>{cols.map(([k]) => <th key={k} scope="col">{k}</th>)}</tr></thead>
        <tbody>
          {PERF_ROWS.map((row) => (
            <tr key={row.key}><th scope="row">{row.label}</th>{cols.map(([k, p]) => <td key={k}>{perfText(p, row.key, row.kind)}</td>)}</tr>
          ))}
        </tbody>
      </table>
      <p class="caption muted">
        {c.period ? `${c.period[0]}～${c.period[1]}。` : ''}月報酬對加權報酬指數迴歸：β {r?.beta?.toFixed(2) ?? '—'}、年化 α {pctSigned(r?.alpha_ann, 1)}（t {tText(r?.alpha_t)}）、R² {r?.r2?.toFixed(2) ?? '—'}（{r?.months ?? 0} 個月）。Sharpe 以無風險利率 0 計；回撤天數＝最長的回撤持續交易日數。
      </p>
    </>
  );
}

function Detail({ s, data }: { s: StrategyItem; data: StrategiesFile }) {
  const [showAlt, setShowAlt] = useState(false);
  const [yearView, setYearView] = useState<'strategy' | 'bench'>('strategy');
  const p5 = s.portfolio?.['5'];
  const cmp = s.compare;
  const [bench, setBench] = useBenchState();
  type CurveFile = { curve?: Partial<Record<BenchKey, CurveLine>> & { n?: number } };
  const curve = useAsync(() => loadJson<CurveFile>(`evidence/${s.test}.json`).catch((): CurveFile => ({})), [s.test]);
  const curveLine = curve.data?.curve?.[bench];
  const years = Object.keys({ ...(s.years ?? {}), ...(p5?.yearly ?? {}) }).sort();
  return (
    <>
      <PageHead eyebrow={s.subtitle} title={s.label}>
        <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>依規則產生，非推薦・資料至 {data.date}</p>
        <Tags s={s} />
        {s.grade_reason ? <p class="caption" data-testid="grade-reason" style={{ marginTop: 'var(--s-1)' }}>{s.grade_reason}</p> : null}
        <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>
          校正後 t {tText(s.t_corr)}・{judgeHold(s)} 日扣成本超額 {pctSigned(netExcess(s))}{s.excess_h?.['20'] !== undefined && judgeHold(s) !== 20 ? `・20 日 ${pctSigned(s.excess_h['20'])}` : ''}
          {s.mean_gross_excess !== undefined ? `・毛超額 ${pctSigned(s.mean_gross_excess)}` : ''}・每月 {s.per_month ?? '—'} 檔{s.family ? `・${s.family}` : ''}
        </p>
        {s.split2022 ? (
          <p class="caption muted" data-testid="split2022" style={{ marginTop: 'var(--s-1)' }}>
            {s.split2022.date.slice(0, 4)} 前 {pctSigned(s.split2022.pre?.mean_excess)}（t {tText(s.split2022.pre?.t)}、{(s.split2022.pre?.n ?? 0).toLocaleString('zh-TW')} 筆）／後 {pctSigned(s.split2022.post?.mean_excess)}（t {tText(s.split2022.post?.t)}、{(s.split2022.post?.n ?? 0).toLocaleString('zh-TW')} 筆）
          </p>
        ) : null}
      </PageHead>

      <h2 class="section st-h">健康度</h2>
      <div class="card">
        <p class="body"><b>{s.health?.status ?? '—'}</b></p>
        <p class="caption muted">近 60 個交易日（{md(s.health?.since)} 起、已完成 {judgeHold(s)} 日持有）平均超額 {pctSigned(s.health?.recent)}（{s.health?.recent_n ?? 0} 筆）；長期 {pctSigned(s.health?.long)}。超額＝相對同日全市場、扣成本。</p>
        <p class="caption">{envLine(s)}</p>
      </div>

      <h2 class="section st-h">今日新觸發（{md(data.date)}）</h2>
      <TodayList s={s} date={data.date} />
      {s.env && !s.env.today ? <p class="caption risk-text">今日大盤環境不符合這個策略的啟用條件。</p> : null}
      {s.enabled ? <Actions s={s} date={data.date} horizon={data.horizon} /> : <p class="caption muted">分級為「{gradeOf(s)}」（{s.grade_reason || s.reasons.join('；') || '未通過驗證'}），不能設為訊號追蹤。</p>}

      {s.hindsight ? <HindsightCard h={s.hindsight} /> : null}
      {s.swing ? <SwingCard sw={s.swing} hold={s.swing.hold} /> : null}

      <BenchSwitch value={bench} onChange={setBench} note={`${BENCH_NOTE}・目前：${BENCH_LONG[bench]}`} />
      <h2 class="section st-h">多期間表現（相對{BENCH_LABEL[bench]}）</h2>
      <table class="ev-table" aria-label={`各持有天數的超額報酬，相對${BENCH_LABEL[bench]}`}>
        <thead><tr><th scope="col">持有</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">樣本</th></tr></thead>
        <tbody>
          {Object.entries(s.h ?? {}).map(([k, v]) => {
            const b = benchPick(v, v.bench, bench);
            return <tr key={k}><th scope="row">{k} 日{k === '120' ? '＊' : ''}</th><td>{pctSigned(b.mean_excess)}</td><td>{tText(b.t)}</td><td>{(v.n ?? 0).toLocaleString('zh-TW')}</td></tr>;
          })}
        </tbody>
      </table>
      <p class="caption muted">超額扣成本，同一檔只計首次觸發；判定以 {judgeHold(s)} 日為主、20 日並列，10 日只供參考；＊120 日只做參考。</p>
      <h2 class="section st-h">累積超額曲線（相對{BENCH_LABEL[bench]}）</h2>
      {curveLine ? <><AlphaCurve line={curveLine} label={`相對${BENCH_LABEL[bench]}`} n={curve.data?.curve?.n} /><p class="caption">{curveSummary(curveLine)}</p></> : <p class="caption muted">{curve.loading ? '載入中…' : '曲線資料累積中。'}</p>}

      {p5 ? <>
      <h2 class="section st-h">逐年報酬</h2>
      <div class="segmented st-seg" role="group" aria-label="逐年報酬的欄位">
        <button aria-pressed={yearView === 'strategy'} onClick={() => setYearView('strategy')}>策略</button>
        <button aria-pressed={yearView === 'bench'} onClick={() => setYearView('bench')}>對照基準</button>
      </div>
      {yearView === 'strategy' ? (
        <table class="ev-table" aria-label="逐年報酬">
          <thead><tr><th scope="col">年份</th><th scope="col">5 檔組合</th><th scope="col">訊號超額</th><th scope="col">筆數</th></tr></thead>
          <tbody>
            {years.map((y) => (
              <tr key={y}><th scope="row">{y}</th><td>{pctSigned(p5?.yearly?.[y])}</td><td>{pctSigned(s.years?.[y])}</td><td>{(s.trades?.yearly?.[y]?.n ?? 0).toLocaleString('zh-TW')}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table class="ev-table" aria-label="逐年報酬與基準">
          <thead><tr><th scope="col">年份</th><th scope="col">5 檔組合</th><th scope="col">加權報酬</th><th scope="col">0050</th><th scope="col">00631L</th></tr></thead>
          <tbody>
            {years.map((y) => (
              <tr key={y}><th scope="row">{y}</th><td>{pctSigned(p5?.yearly?.[y], 1)}</td><td>{pctSigned(cmp?.tr?.yearly?.[y], 1)}</td><td>{pctSigned(cmp?.['0050']?.yearly?.[y], 1)}</td><td>{pctSigned(cmp?.['00631L']?.yearly?.[y], 1)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <p class="caption muted">5 檔組合：同時最多持有 5 檔、每檔 1/5 權益、依下方出場規則，扣成本。基準為同期買進持有（還原價、含息，不扣成本）；首尾年份不是完整年度。</p>
      </> : <p class="caption muted st-h">未通過驗證的策略不做 5 檔組合模擬（沒有逐年報酬與權益曲線）。</p>}

      {s.curve?.dates?.length ? (
        <>
          <h2 class="section st-h">權益曲線（每週，期初＝1）</h2>
          <EquityChart
            dates={s.curve.dates}
            series={[
              { key: 'strategy', label: '5 檔組合', values: s.curve.equity },
              { key: '0050', label: '0050', values: s.curve.etf?.['0050'] ?? [] },
              { key: 'tr', label: '加權報酬', values: s.curve.bench },
              { key: '00631L', label: '00631L', values: s.curve.etf?.['00631L'] ?? [] },
            ]}
          />
        </>
      ) : null}

      {cmp ? <CompareTable c={cmp} /> : null}

      {s.bench ? (
        <>
          <h2 class="section st-h">訊號對四種基準（{data.horizon} 日）</h2>
          <table class="ev-table" aria-label="訊號相對四種基準的超額">
            <thead><tr><th scope="col">基準</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">超額勝率</th></tr></thead>
            <tbody>
              {BENCH_KEYS.map((k) => {
                const b = s.bench?.[k];
                return <tr key={k}><th scope="row">{BENCH_LABEL[k]}</th><td>{pctSigned(b?.mean_excess)}</td><td>{tText(b?.t)}</td><td>{b?.win === null || b?.win === undefined ? '—' : `${b.win.toFixed(1)}%`}</td></tr>;
              })}
            </tbody>
          </table>
          <p class="caption muted">判定以等權為準。{s.large_cap ? `相對 0050 不顯著（t ${tText(s.t_0050)}）：${s.large_cap}。` : ''}00631L 為 2 倍槓桿 ETF（每日再平衡，長期有波動耗損），用來對照任何槓桿情境。</p>
        </>
      ) : null}

      <h2 class="section st-h">出場規則</h2>
      <div class="card">
        <p class="body"><b>{s.exit?.label ?? '—'}</b></p>
        <p class="caption muted">
          依出場規則比較（相對指數最高者）選用・期望值 {pctSigned(s.exit?.stats.ev)}、相對指數 {pctSigned(s.exit?.stats.exc_idx)}、勝率 {s.exit?.stats.win?.toFixed(1) ?? '—'}%、平均持有 {s.exit?.stats.hold?.toFixed(1) ?? '—'} 日、最大不利波動 {pctSigned(s.exit?.stats.mae)}、跌停鎖死 {s.exit?.stats.locked ?? 0} 次
        </p>
        <button class="btn small" aria-expanded={showAlt} onClick={() => setShowAlt(!showAlt)}>{showAlt ? '收起其他出場規則' : '看其他出場規則'}</button>
        {showAlt ? (
          <table class="ev-table" aria-label="出場規則比較">
            <thead><tr><th scope="col">出場</th><th scope="col">相對指數</th><th scope="col">勝率</th><th scope="col">持有日</th></tr></thead>
            <tbody>
              {(s.exit?.alternatives ?? []).map((r) => (
                <tr key={r.label}><th scope="row" class="ev-wrap">{r.label}</th><td>{pctSigned(r.exc_idx)}</td><td>{r.win === null ? '—' : `${r.win.toFixed(1)}%`}</td><td>{r.hold?.toFixed(1) ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <h2 class="section st-h">樣本範圍</h2>
      <table class="ev-table" aria-label="樣本範圍">
        <tbody>
          <tr><th scope="row">判定</th><td>{s.verdict}（t {tText(s.t)}）</td></tr>
          <tr><th scope="row">涵蓋率</th><td>{coverageText(s.coverage)}</td></tr>
          <tr><th scope="row">資料起始</th><td>{s.data_start ?? '—'}</td></tr>
          <tr><th scope="row">訊號期間</th><td>{s.signal_start ?? '—'} 起</td></tr>
          <tr><th scope="row">去重樣本</th><td>{(s.n ?? 0).toLocaleString('zh-TW')} 筆</td></tr>
          {s.param ? <tr><th scope="row">參數</th><td>{s.param}</td></tr> : null}
        </tbody>
      </table>
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

export default function Strategies({ id }: { id?: string }) {
  const d = useAsync(loadStrategies, []);
  const s = id ? d.data?.strategies.find((x) => x.id === id) : undefined;
  return (
    <div class="page has-bench">
      <TopBar back={id ? '/explore/strategies' : '/explore'} />
      {!id ? (
        <PageHead eyebrow="依指標效度評估包成的策略" title={d.data ? `策略庫：${d.data.strategies.filter((x) => gradeOf(x) === '有效').length} 個有效・${d.data.strategies.filter((x) => gradeOf(x) === '觀察中').length} 個觀察中` : '策略庫'}>
          <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>依規則產生，非推薦。每日依資料重新分級：有效、觀察中會上架並可設為訊號追蹤；停用與未通過的只列在下方供查閱。</p>
        </PageHead>
      ) : null}
      {d.loading ? <Loading /> : null}
      {d.error ? <ErrorState error={d.error} /> : null}
      {d.data && !id ? <StrategyList data={d.data} /> : null}
      {d.data && id ? (s ? <Detail s={s} data={d.data} /> : <p class="caption">找不到這個策略。</p>) : null}
    </div>
  );
}
