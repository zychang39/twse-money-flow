/**
 * 策略庫（2026-10-03 改版，SPEC §6）。依規則產生，非推薦；不提供下單。
 * #/explore/strategies：清單（上架一張卡、無效收在摺疊列）；每列＝名稱｜副標條件｜單一分級標籤。
 * #/explore/strategies/:id：規則一句話 → 判定卡（(a) 機會成本・相對 0050｜(b) 訊號檢定・相對等權）→ 健康度 →
 *   事件研究（累積超額 120 日、多期間、逐年訊號超額）→ 組合回測（對數權益曲線、逐年 5 檔｜0050｜差額、隨機選股模擬）→
 *   出場規則（2021 年底前選、2022 起樣本外）→ 樣本與成本 → 新觸發。
 * 數字全部來自 strategies.json（pipeline/evidence/judge.py）；t 全站只有「校正後 t」一種。說明、公式、門檻都在 ⓘ。
 */
import { useMemo, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { Card, CardLabel, EmptyRow, List, Num, PageTitle, Row, Section, Seg, Signed, StatGrid, Table, Tag, Warn } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { EquityChart } from '../components/EquityChart';
import { AlphaCurve } from '../components/AlphaCurve';
import { SwingCard } from '../components/SwingCard';
import { GradeTag, JudgeInfo } from '../components/StrategyBits';
import { useAsync, useDb } from '../hooks';
import { loadJson } from '../data/api';
import { addWatchMany, listStrategies, saveStrategy, uid } from '../db/db';
import { LAB_PREFIX } from '../lib/config';
import { fmtCount, md, pctPlain, ratioText, tText } from '../lib/format';
import { BENCH_KEYS, BENCH_LABEL, type BenchKey, loadBench, saveBench } from '../lib/bench';
import { type CurveLine, EDGE_TEXT, peakAtEdge } from '../lib/curve';
import { isListed } from '../lib/status';
import {
  type StrategiesFile, type StrategyItem, GRADE_ORDER, envLine, gradeNotes, gradeOf, groupName, healthLong, healthTone, paramRows,
} from '../lib/strategies';
import '../styles/strategy.css';

export const loadStrategies = () => loadJson<StrategiesFile>('strategies.json');

const sigT = (s: StrategyItem) => s.judge?.sig.t ?? s.t_corr ?? -99;
const byGrade = (a: StrategyItem, b: StrategyItem) => GRADE_ORDER[gradeOf(a)] - GRADE_ORDER[gradeOf(b)] || sigT(b) - sigT(a);
const pctOr = (v: number | null | undefined) => <Signed v={v ?? null} unit="%" tone="plain" />;
const nowrap = (t: string) => <span class="ui-num">{t}</span>;
/** 不帶號的百分比（勝率、涵蓋率）：與 Signed 同一種數字＋單位排法。 */
const pctN = (v: number | null | undefined) => <Num v={v ?? null} digits={2} unit="%" />;

/** 頁面層級的基準（記在 localStorage tmf-bench；切換時保持捲動位置）。 */
function useBench(): [BenchKey, (k: BenchKey) => void] {
  const [bench, setBench] = useState<BenchKey>(loadBench);
  const set = (k: BenchKey) => {
    const y = window.scrollY;
    saveBench(k);
    setBench(k);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (Math.abs(window.scrollY - y) > 0) window.scrollTo(0, y); }));
  };
  return [bench, set];
}

// ---------------------------------------------------------------- 清單

function StrategyList({ data }: { data: StrategiesFile }) {
  const [openOff, setOpenOff] = useState(false);
  const { listed, off } = useMemo(() => {
    const all = [...data.strategies].sort(byGrade);
    return { listed: all.filter((s) => isListed(s)), off: all.filter((s) => !isListed(s)) };
  }, [data.strategies]);
  const row = (s: StrategyItem) => (
    <Row key={s.id} label={<>{s.label}<GradeTag s={s} /></>} sub={s.subtitle} href={`#/explore/strategies/${s.id}`} testid={`st-row-${s.id}`} />
  );
  return (
    <>
      <PageTitle title="策略庫" sub={`資料至 ${md(data.date)}・依規則產生，非推薦`} />
      <Section title="上架" aside={`${listed.length} 套`} info={<JudgeInfo meta={data.judge_meta} multi={data.multi_test} />} testid="st-sec-listed">
        <List chev class="st-list" testid="st-sec-listed-list">
          {listed.length ? listed.map(row) : <EmptyRow>無上架策略</EmptyRow>}
        </List>
      </Section>
      <Section title="無效" aside={`${off.length} 套`} testid="st-sec-off">
        <List chev class="st-list" testid="st-sec-off-list">
          <Row label={openOff ? '收合' : `展開 ${off.length} 套`} onClick={() => setOpenOff(!openOff)} testid="st-fold" ariaLabel={openOff ? '收合無效的策略' : '展開無效的策略'} />
          {openOff ? off.map(row) : null}
        </List>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- 策略頁

function JudgeSection({ s, data }: { s: StrategyItem; data: StrategiesFile }) {
  const j = s.judge;
  const h = j?.horizon ?? 40;
  if (!j) {
    return <Section title="判定"><List><EmptyRow>沒有判定卡資料（重新部署後產生）</EmptyRow></List></Section>;
  }
  const g = typeof s.grade === 'object' ? s.grade : null;
  const p = j.opp.port, b = j.opp.bench_port;
  const rows = [
    { k: '年化報酬', p: pctOr(p.cagr), b: pctOr(b.cagr) },
    { k: 'Sharpe', p: ratioText(p.sharpe), b: ratioText(b.sharpe) },
    { k: '最大回撤', p: pctOr(p.mdd), b: pctOr(b.mdd) },
  ];
  return (
    <Section title="判定" aside={`${h} 日・扣成本`} info={<JudgeInfo meta={data.judge_meta} multi={data.multi_test} />} testid="st-judge">
      <Card testid="st-judge-card">
        <StatGrid testid="st-judge-grid" items={[
          { label: '(a) 機會成本・0050', value: pctOr(j.opp.excess), testid: 'judge-opp' },
          { label: '(b) 訊號檢定・等權', value: pctOr(j.sig.excess), testid: 'judge-sig' },
          { label: '校正後 t', value: tText(j.opp.t) },
          { label: '校正後 t', value: tText(j.sig.t) },
          { label: '超額勝率', value: pctN(j.opp.win) },
          { label: '樣本', value: <>{fmtCount(j.sig.n)}<span class="ui-unit">筆</span></> },
        ]} />
        <CardLabel aside={j.opp.period ? `${md(j.opp.period[0])}（${j.opp.period[0].slice(0, 4)}）起` : undefined}>{j.opp.slots} 檔組合 vs 0050</CardLabel>
        <Table
          caption={`${j.opp.slots} 檔組合與同期 0050`}
          cols={[
            { key: 'k', label: '指標', render: (r) => r.k },
            { key: 'p', label: `${j.opp.slots} 檔組合`, align: 'r', width: '30%', render: (r) => r.p },
            { key: 'b', label: '0050', align: 'r', width: '30%', render: (r) => r.b },
          ]}
          rows={rows}
          rowKey={(r) => r.k}
        />
      </Card>
      {g && (g.reasons?.length || g.notes.length) ? (
        <List testid="grade-reason">
          {(g.reasons ?? []).map((r) => <Row key={r} label={r} />)}
          {g.notes.map((n) => <Row key={n} label={n} sub={NOTE_TEXT[n]} />)}
        </List>
      ) : null}
    </Section>
  );
}

const NOTE_TEXT: Record<string, string> = {
  樣本不足: '樣本期間 < 3 年或去重樣本 < 300 筆，最高觀察中',
  待前瞻驗證: '合併後的新訊號滿 60 個交易日才比對',
};

function HealthSection({ s }: { s: StrategyItem }) {
  const h = s.health;
  if (!h) return null;
  const r = h.recent60 ?? { excess: h.recent, n: h.recent_n };
  const risk = healthTone(h.status) === 'risk';
  return (
    <Section title="健康度" info={<><p>近 60 日＝最近 60 個交易日內、已完成 40 日持有的去重事件；長期＝全部訊號期間。皆為相對同日等權的扣成本超額。</p><p>近期樣本少於 20 筆時不比較。{envLine(s)}。</p></>}>
      <List>
        <Row
          testid="st-health"
          label={<>近 60 日 {pctOr(r.excess)} {nowrap(`(${fmtCount(r.n)} 筆)`)}｜長期 {pctOr(healthLong(h))}</>}
          value={risk ? <Tag tone="risk">{h.status}</Tag> : undefined}
        />
      </List>
    </Section>
  );
}

type CurveFile = { curve?: Partial<Record<BenchKey, CurveLine>> & { n?: number; days?: number } };

function EventSection({ s, bench, setBench }: { s: StrategyItem; bench: BenchKey; setBench: (k: BenchKey) => void }) {
  const curve = useAsync(() => loadJson<CurveFile>(`evidence/${s.test}.json`).catch((): CurveFile => ({})), [s.test]);
  const line = curve.data?.curve?.[bench];
  const hs = Object.entries(s.h ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  const yearly = s.event?.yearly ?? [];
  const days = curve.data?.curve?.days ?? line?.mean.length ?? 120;
  const info = (
    <>
      <p>累積超額：判定持有期（40 日）的去重事件，進場後第 k 個交易日收盤的累積報酬減去同期基準（不扣成本），同一進場日先平均再對日期平均；灰帶為 95% 區間（日期分層 bootstrap）。觀察窗 {days} 日；峰值落在第 {days} 日時標「{EDGE_TEXT}」，真正的峰值可能在窗外。</p>
      <p>多期間：各持有天數各自去重、扣成本；120 日只做參考。逐年訊號超額：相對同日等權、扣成本。</p>
      <p>基準切換只改變比較對象；分級以判定卡為準。</p>
    </>
  );
  const pick = (v: NonNullable<StrategyItem['h']>[string]) => (bench === 'ew' ? { mean_excess: v.mean_excess ?? null, win: v.bench?.ew?.win ?? null } : { mean_excess: v.bench?.[bench]?.mean_excess ?? null, win: v.bench?.[bench]?.win ?? null });
  return (
    <Section title="事件研究" info={info} testid="st-event">
      <Seg options={BENCH_KEYS.map((k) => [k, BENCH_LABEL[k]] as const)} value={bench} onChange={setBench} label="比較基準" sticky testid="bench-switch" />
      <Card>
        <CardLabel aside={line ? (peakAtEdge(line) ? EDGE_TEXT : line.peak ? `峰值第 ${line.peak} 日` : undefined) : undefined}>累積超額・相對{BENCH_LABEL[bench]}</CardLabel>
        {line ? <AlphaCurve line={line} label={`相對${BENCH_LABEL[bench]}`} n={curve.data?.curve?.n} />
          : <EmptyRow>{curve.loading ? '載入中' : '這個基準沒有曲線資料'}</EmptyRow>}
      </Card>
      {hs.length ? (
        <Card>
          <CardLabel>多期間・相對{BENCH_LABEL[bench]}</CardLabel>
          <Table
            caption={`各持有天數的超額，相對${BENCH_LABEL[bench]}`}
            cols={[
              { key: 'h', label: '持有', render: ([k]) => `${k} 日` },
              { key: 'e', label: '超額', align: 'r', render: ([, v]) => pctOr(pick(v).mean_excess) },
              { key: 'w', label: '超額勝率', align: 'r', render: ([, v]) => pctN(pick(v).win) },
              { key: 'n', label: '樣本', align: 'r', render: ([, v]) => fmtCount(v.n ?? 0) },
            ]}
            rows={hs}
            rowKey={([k]) => k}
          />
        </Card>
      ) : null}
      {yearly.length ? (
        <Card testid="st-event-yearly">
          <CardLabel>逐年訊號超額・相對等權</CardLabel>
          <Table
            caption="逐年訊號超額"
            cols={[
              { key: 'y', label: '年份', render: (r) => r.year },
              { key: 'e', label: '超額', align: 'r', render: (r) => pctOr(r.excess) },
              { key: 'n', label: '筆數', align: 'r', render: (r) => fmtCount(r.n) },
            ]}
            rows={yearly}
            rowKey={(r) => r.year}
          />
        </Card>
      ) : null}
    </Section>
  );
}

function PortfolioSection({ s, data }: { s: StrategyItem; data: StrategiesFile }) {
  const slots = s.curve?.slots ?? data.judge_meta?.slots ?? 5;
  const sel = s.selection;
  const rnd = sel?.random;
  const info = (
    <>
      <p>{sel?.rule_text ?? data.judge_meta?.selection_rule}</p>
      {rnd ? <p>隨機選股：同一天觸發多於空位時改用隨機順序，其餘規則相同，{rnd.n} 次（種子 {rnd.seed}）；列出年化報酬與最大回撤的中位數與 5%～95% 分位。</p> : null}
      <p>權益曲線每週取樣、期初＝1、Y 軸對數；基準為同期持有不動（還原價、含息，不扣成本）。00631L 為 2 倍槓桿 ETF（每日再平衡），預設隱藏。首尾年份不是完整年度。</p>
    </>
  );
  const yearly = s.yearly ?? [];
  return (
    <Section title="組合回測" aside={`${slots} 檔・固定 ${data.judge_meta?.horizon ?? 40} 日`} info={info} testid="st-portfolio">
      {s.curve?.dates?.length ? (
        <Card>
          <EquityChart
            dates={s.curve.dates}
            series={[
              { key: 'strategy', label: `${slots} 檔`, values: s.curve.equity },
              { key: '0050', label: '0050', values: s.curve.etf?.['0050'] ?? [], missing: s.curve.missing?.['0050'] ?? '沒有 0050 序列' },
              { key: 'tr', label: '加權報酬', values: s.curve.bench ?? [], missing: s.curve.missing?.tr ?? '沒有加權報酬指數序列' },
              { key: '00631L', label: '00631L', values: s.curve.etf?.['00631L'] ?? [], missing: s.curve.missing?.['00631L'] ?? '沒有 00631L 序列' },
            ]}
          />
        </Card>
      ) : <List><EmptyRow>沒有週權益序列</EmptyRow></List>}
      {yearly.length ? (
        <Card testid="st-yearly">
          <CardLabel>逐年報酬</CardLabel>
          <Table
            caption={`逐年：${slots} 檔組合、0050、差額`}
            cols={[
              { key: 'y', label: '年份', render: (r) => r.year },
              { key: 'p', label: `${slots} 檔組合`, align: 'r', render: (r) => pctOr(r.port) },
              { key: 'b', label: '0050', align: 'r', render: (r) => pctOr(r.bench) },
              { key: 'd', label: '差額', align: 'r', render: (r) => <Signed v={r.diff} unit="%" tone="plain" /> },
            ]}
            rows={yearly}
            rowKey={(r) => r.year}
          />
        </Card>
      ) : null}
      {rnd && sel?.spec ? (
        <Card testid="st-random">
          <CardLabel aside={`隨機 ${rnd.n} 次`}>選股規則 vs 隨機選股</CardLabel>
          <Table
            caption="選股規則與隨機選股模擬"
            cols={[
              { key: 'k', label: '指標', render: (r) => r.k },
              { key: 'r', label: '規則', align: 'r', width: '23%', render: (r) => pctOr(r.spec) },
              { key: 'm', label: '中位數', align: 'r', width: '23%', render: (r) => pctOr(r.q.p50) },
              { key: 'q', label: '5～95%', align: 'r', width: '30%', render: (r) => nowrap(`${pctRange(r.q.p5)}～${pctRange(r.q.p95)}`) },
            ]}
            rows={[
              { k: '年化報酬', spec: sel.spec.cagr, q: rnd.cagr },
              { k: '最大回撤', spec: sel.spec.mdd, q: rnd.mdd },
            ]}
            rowKey={(r) => r.k}
          />
        </Card>
      ) : null}
    </Section>
  );
}

/** 區間端點：整數百分比、帶號（U+2212）；單位在表頭。 */
function pctRange(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v).toFixed(0);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${a}`;
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

function ExitSection({ s, data }: { s: StrategyItem; data: StrategiesFile }) {
  const ex = s.exits;
  const train = (ex?.train_end ?? data.judge_meta?.exits_train_end ?? '2021-12-31').slice(0, 4);
  const info = (
    <>
      <p>同樣的進場、不同的出場（固定持有、跌破均線、停損、高點回落、ATR 回落、跌破進場日低點、量縮整理、固定第 N 日；最長 {ex?.max_days ?? 60} 日）。</p>
      <p>每種出場的參數與「選定」的出場，只用 {train} 年底以前的訊號選（{ex?.metric ?? '樣本內相對 0050 平均超額'}，樣本內 ≥ {ex?.min_events ?? 30} 筆）；{ex?.oos_start?.slice(0, 4) ?? '2022'} 年起的結果列為樣本外，不參與選擇。數字為事件平均、扣成本、相對 0050。</p>
      <p>「第 N 日出場」的 N＝樣本內累積超額曲線的峰值日。</p>
      <p>{data.judge_meta?.exit_note ?? '分級、組合回測與槓桿風險一律用固定 40 日出場；出場規則比較只供參考。'}</p>
      {ex?.note ? <p>{ex.note}</p> : null}
    </>
  );
  if (!ex || !ex.rules.length) {
    return <Section title="出場規則" info={info}><List><EmptyRow>沒有出場規則比較</EmptyRow></List></Section>;
  }
  return (
    <Section title="出場規則" aside={`${train} 年底前選`} info={info} testid="st-exits">
      <Card>
        <CardLabel aside="相對 0050">選定：{ex.chosen ? exitShort(ex.chosen.rule, ex.chosen.param) : '—'}{ex.chosen?.basis === 'fallback' ? '（預設）' : ''}</CardLabel>
        <Table
          caption="出場規則：樣本內與樣本外"
          cols={[
            { key: 'r', label: '出場', render: (r) => <span class={r.chosen ? 'ui-strong' : ''}>{exitShort(r.rule, r.param)}</span> },
            { key: 'i', label: '樣本內', align: 'r', width: '28%', render: (r) => pctOr(r.in_sample.rel?.['0050']) },
            { key: 'o', label: '樣本外', align: 'r', width: '28%', render: (r) => pctOr(r.oos.rel?.['0050']) },
          ]}
          rows={ex.rules}
          rowKey={(r) => `${r.rule}:${r.param}`}
        />
      </Card>
    </Section>
  );
}

function SampleSection({ s, data }: { s: StrategyItem; data: StrategiesFile }) {
  const [swingOpen, setSwingOpen] = useState(false);
  const gm = data.judge_meta?.sample;
  const smp = s.sample;
  const params = paramRows(s.param);
  const revenue = /營收/.test(`${s.definition ?? ''}${s.subtitle}`);
  const gates = s.swing?.gates;
  const passed = gates ? Object.values(gates.checks ?? {}).filter(Boolean).length : 0;
  const total = gates ? Object.keys(gates.checks ?? {}).length : 0;
  const info = (
    <>
      <p>{smp?.universe_text ?? gm?.universe_text}</p>
      {gm ? <p>2017 年起曾進入股票池 {fmtCount(gm.universe_stocks)} 檔，其中 {fmtCount(gm.stopped_stocks)} 檔在資料最後一個月已無收盤價、{fmtCount(gm.official_delisted)} 檔名列官方終止上市櫃。</p> : null}
      {revenue && gm ? <p>{gm.revenue_timing}</p> : null}
      <p>成本：手續費 0.1425%（買賣各一次、不打折）、證交稅 0.3%、滑價 0.1%（買賣各一次），來回約 0.79%。基準不扣成本。</p>
      {s.definition ? <p>{s.definition}</p> : null}
      {s.note ? <p>{s.note}</p> : null}
    </>
  );
  return (
    <Section title="樣本與成本" info={info} testid="st-sample">
      <List>
        <Row label="含下市股票" value={smp ? (smp.includes_delisted ? '是' : '否') : '—'} testid="st-delisted" />
        <Row label="股票池" sub="普通股・成交值 ≥ 5,000 萬" value={gm ? <>{fmtCount(gm.universe_stocks)}<span class="ui-unit">檔</span></> : '—'} />
        <Row label="訊號期間" value={s.signal_start ? `${s.signal_start.slice(0, 7)} 起` : '—'} />
        <Row label="去重樣本" value={<>{fmtCount(s.judge?.sig.n ?? s.n ?? 0)}<span class="ui-unit">筆</span></>} />
        <Row label="持有期間下市" value={<>{fmtCount(smp?.delisted_events ?? 0)}<span class="ui-unit">筆</span></>} />
        {s.coverage ? <Row label="涵蓋率" sub={`每日平均 ${fmtCount(s.coverage.included)}／${fmtCount(s.coverage.universe)} 檔`} value={pctN(s.coverage.ratio * 100)} /> : null}
        {revenue ? <Row label="月營收生效" sub="遇休市順延，不提前" value="次月 10 日" /> : null}
        <Row label="交易成本" sub="手續費・證交稅・滑價，來回" value={<Num v={0.79} digits={2} unit="%" />} />
        {params.length ? <Row label="參數" sub={params.map((p) => `${p.label} ${p.value}`).join('・')} /> : null}
        {s.hindsight?.status === 'waiting' ? <Row label="原 31 檔 vs 全市場" sub={`涵蓋率達 ${pctPlain((s.hindsight.threshold ?? 0.9) * 100, 0)} 後計算`} value="—" /> : null}
        {gates ? <Row label="上線門檻" value={`${passed}/${total}`} onClick={() => setSwingOpen(true)} testid="st-gates" /> : null}
      </List>
      {s.limited && s.limited_note ? <Warn>{s.limited_note}</Warn> : null}
      {s.swing ? (
        <Sheet open={swingOpen} onClose={() => setSwingOpen(false)} title="上線門檻">
          <SwingCard sw={s.swing} hold={s.swing.hold} />
        </Sheet>
      ) : null}
    </Section>
  );
}

function TriggerSection({ s, data }: { s: StrategyItem; data: StrategiesFile }) {
  const tracked = useDb(() => listStrategies(), []);
  const [msg, setMsg] = useState('');
  const presetId = LAB_PREFIX + s.id;
  const isTracked = (tracked ?? []).some((t) => t.presetId === presetId && t.active);
  const codes = (s.today ?? []).map((x) => x.code);
  const listed = isListed(s);
  return (
    <Section title="新觸發" aside={md(data.date)} testid="st-today">
      <List chev={codes.length > 0}>
        {codes.length
          ? (s.today ?? []).map((x) => <Row key={x.code} label={`${x.name} ${x.code}`} href={`#/stock/${x.code}`} />)
          : <EmptyRow testid="today-empty">{md(data.date)} 無新觸發</EmptyRow>}
      </List>
      {listed ? (
        <List chev>
          {codes.length ? (
            <Row label="加入自選群組" sub={groupName(s)} onClick={async () => {
              const n = await addWatchMany(codes, groupName(s));
              setMsg(n ? `已加入 ${n} 檔` : '已在群組裡');
            }} value={msg || undefined} />
          ) : null}
          <Row label={isTracked ? '已在訊號追蹤' : '設為訊號追蹤'} sub={`${md(data.date)} 之後的新觸發`} testid="st-track"
            onClick={isTracked ? undefined : async () => {
              await saveStrategy({ id: uid(), presetId, name: s.label, conditions: [], horizon: data.horizon, startAfter: data.date, enabledAt: new Date().toISOString(), active: true });
              setMsg('已設為訊號追蹤');
            }} />
          <Row label="槓桿風險" href={`#/explore/leverage?s=${s.id}`} />
        </List>
      ) : null}
    </Section>
  );
}

function Detail({ s, data }: { s: StrategyItem; data: StrategiesFile }) {
  const [bench, setBench] = useBench();
  const notes = gradeNotes(s);
  return (
    <>
      <PageTitle title={s.label} sub={`資料至 ${md(data.date)}・依規則產生，非推薦`} aside={<GradeTag s={s} />} />
      <Section title="規則">
        <Card testid="st-rule">
          <p class="st-rule">{s.subtitle}</p>
          {notes.length ? <p class="st-notes ui-foot ui-muted" data-testid="grade-notes">{notes.join('・')}</p> : null}
        </Card>
      </Section>
      <JudgeSection s={s} data={data} />
      <HealthSection s={s} />
      <EventSection s={s} bench={bench} setBench={setBench} />
      <PortfolioSection s={s} data={data} />
      <ExitSection s={s} data={data} />
      <SampleSection s={s} data={data} />
      <TriggerSection s={s} data={data} />
    </>
  );
}

export default function Strategies({ id }: { id?: string }) {
  const d = useAsync(loadStrategies, []);
  const s = id ? d.data?.strategies.find((x) => x.id === id) : undefined;
  return (
    <div class="page">
      <TopBar back={id ? '/explore/strategies' : '/explore'} caption={id && s ? '策略' : undefined} />
      {d.loading ? <Loading /> : null}
      {d.error ? <ErrorState error={d.error} /> : null}
      {d.data && !id ? <StrategyList data={d.data} /> : null}
      {d.data && id ? (s ? <Detail key={s.id} s={s} data={d.data} /> : <List><EmptyRow>找不到這個策略</EmptyRow></List>) : null}
    </div>
  );
}
