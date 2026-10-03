/**
 * 2026-10-03：套用共用元件（PageTitle／Section／List／Table），說明進 ⓘ。
 * 訊號追蹤（紙上交易，S3）：把選股條件設為追蹤策略，從啟用那天之後開始記錄每天的新觸發，
 * 隔天開盤進場、持有 N 個交易日後開盤出場，和回測數字並排比較（前瞻驗證）。
 * 只記錄、不下單；依規則產生，非推薦。
 */
import { useEffect, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { Card, EmptyRow, List, PageTitle, Row, Section, Signed, Table } from '../components/ui';
import { Loading } from '../components/DataStatus';
import { Sheet } from '../components/Sheet';
import { useAsync, useDb } from '../hooks';
import { loadJson, loadSignalPrices, loadSignals, loadSummary } from '../data/api';
import { deleteStrategy, listScreens, listStrategies, listTracked, saveStrategy, uid } from '../db/db';
import { labStrategy, screenerConfig, type Condition } from '../lib/config';
import { describeCondition, savedDisplayName, presetScreens } from '../lib/screener';
import { exitsTomorrow, trackStats, type Position, type Strategy } from '../lib/tracking';
import { loadPositions, syncTracking } from '../lib/trackingSync';
import { fmtCount, fmtNum, md, missing, orMissing, pctPlain, pctSigned } from '../lib/format';
import { useRoute } from '../router';
import type { Stats } from '../lib/backtest';

const label = (f: string) => screenerConfig.fields[f]?.label ?? f;
const unit = (f: string) => screenerConfig.fields[f]?.unit ?? '';
/** 追蹤欄缺值的原因：還沒有已出場的交易；回測欄缺值：沒有這個持有天數的回測。 */
const NO_CLOSED = '還沒有已出場的交易';
const NO_BT = '沒有回測';

function statusText(p: Position, horizon: number): string {
  if (p.status === 'waiting') return '等待進場';
  if (p.status === 'holding') return p.held === horizon ? '明天開盤出場' : `持有 ${p.held ?? 0}／${horizon} 日`;
  if (p.status === 'closed') return '已出場';
  return '資料不足';
}

type BacktestFile = { horizons: Record<string, { all?: Stats; out_of_sample?: Stats }>; coverage?: { limited: boolean } };

function Compare({ st, ps }: { st: Strategy; ps: Position[] }) {
  const s = trackStats(ps);
  const lab = labStrategy(st.presetId);
  const bt = useAsync(() => (st.presetId && !lab ? loadJson<BacktestFile>(`backtests/${st.presetId}.json`).catch(() => null) : Promise.resolve(null)), [st.presetId]);
  const b = bt.data?.horizons[String(st.horizon)]?.all;
  const rows: { k: string; a: string; b: string }[] = [
    { k: '已出場', a: `${fmtCount(s.closed)} 筆`, b: b ? `${fmtCount(b.n)} 筆` : missing(NO_BT) },
    { k: '絕對勝率', a: orMissing(s.winRate, pctPlain, NO_CLOSED), b: b ? orMissing(b.win_rate, pctPlain, '沒有樣本') : missing(NO_BT) },
    { k: '平均', a: orMissing(s.avg, pctSigned, NO_CLOSED), b: b ? orMissing(b.avg, pctSigned, '沒有樣本') : missing(NO_BT) },
    { k: '中位數', a: orMissing(s.median, pctSigned, NO_CLOSED), b: b ? orMissing(b.median, pctSigned, '沒有樣本') : missing(NO_BT) },
    { k: '超額', a: orMissing(s.avgExcess, pctSigned, s.closed ? '沒有指數資料' : NO_CLOSED), b: b ? orMissing(b.avg_excess, pctSigned, b.n ? '沒有指數資料' : '沒有樣本') : missing(NO_BT) },
  ];
  return (
    <Card testid="track-compare-card">
      <Table
        testid="track-compare"
        caption="追蹤與回測比較"
        cols={[
          { key: 'k', label: '項目', render: (r) => r.k },
          { key: 'a', label: '追蹤', align: 'r', width: '36%', render: (r) => r.a },
          { key: 'b', label: `回測${bt.data?.coverage?.limited ? '＊' : ''}`, align: 'r', width: '36%', render: (r) => r.b },
        ]}
        rows={rows}
        rowKey={(r) => r.k}
      />
      <p class="ui-foot ui-muted st-notes">
        {lab ? `回測見策略庫「${lab.label}」` : st.presetId ? (b ? `回測：持有 ${st.horizon} 日、全部訊號` : `回測沒有持有 ${st.horizon} 日的結果`) : '自訂條件的回測在回測頁計算'}
        {s.closed < 30 ? `・已出場 ${s.closed} 筆（少於 30 筆）` : ''}
      </p>
    </Card>
  );
}

function StrategyCard({ st, ps }: { st: Strategy; ps: Position[] }) {
  const [open, setOpen] = useState(false);
  const preset = screenerConfig.presets.find((p) => p.id === st.presetId) ?? labStrategy(st.presetId);
  const tomorrow = exitsTomorrow(ps, st.horizon);
  const shown = open ? ps : ps.slice(0, 8);
  const name = preset?.label ?? st.name;
  const info = (
    <>
      <p>{preset?.subtitle ?? st.conditions.map((c) => describeCondition(c as Condition, label, unit)).join('；')}</p>
      <p>自 {md(st.startAfter)} 之後的新觸發開始記錄（不回溯）；隔天開盤進場、持有 {st.horizon} 個交易日後開盤出場；已扣手續費、證交稅與滑價。{st.presetId ? '全市場，由每日資料預先計算。' : '自訂條件在開啟 App 時記錄當天的新觸發，沒開啟的交易日不補記。'}</p>
      <p>絕對勝率＝報酬 &gt; 0 的比例。{'＊回測樣本範圍受限時見回測頁。'}</p>
    </>
  );
  return (
    <Section title={name} info={info} testid="track-strategy" aside={`持有 ${st.horizon} 日`}>
      <Compare st={st} ps={ps} />
      <List chev testid="track-positions">
        {tomorrow.length ? <EmptyRow testid="track-exit-tomorrow">明天開盤出場：{tomorrow.map((p) => p.sig.name ?? p.sig.code).join('、')}</EmptyRow> : null}
        {ps.length ? shown.map((p) => (
          <Row
            key={p.sig.key}
            testid="track-position"
            href={`#/stock/${p.sig.code}`}
            label={`${p.sig.name ?? p.sig.code} ${p.sig.code}`}
            sub={`訊號 ${md(p.sig.signalDate)}${p.entryDate ? `・進場 ${md(p.entryDate)} ${fmtNum(p.entry ?? null)}` : ''}${p.exitDate ? `・出場 ${md(p.exitDate)}` : ''}`}
            value={p.ret === undefined ? '—' : <Signed v={p.ret * 100} unit="%" />}
            value2={statusText(p, st.horizon)}
          />
        )) : <EmptyRow>{md(st.startAfter)} 之後無新觸發</EmptyRow>}
        {ps.length > 8 ? <Row label={open ? '收合' : `顯示全部 ${ps.length} 筆`} onClick={() => setOpen(!open)} testid="track-more" /> : null}
      </List>
      <div class="st-notes">
        <button class="btn small danger" onClick={() => { if (confirm(`停止追蹤「${name}」並刪除它的紀錄？`)) deleteStrategy(st.id); }}>停止追蹤</button>
      </div>
    </Section>
  );
}

function AddSheet({ open, onClose, latest, initial }: { open: boolean; onClose: () => void; latest: string; initial?: { presetId?: string; conditions?: Condition[]; name?: string } }) {
  const saved = useDb(listScreens) ?? [];
  const presets = presetScreens();
  const [pick, setPick] = useState<string>(initial?.presetId ?? (initial?.conditions ? 'custom' : presets[0]?.id ?? ''));
  const [horizon, setHorizon] = useState('10');
  useEffect(() => { if (open) setPick(initial?.presetId ?? (initial?.conditions ? 'custom' : presets[0]?.id ?? '')); }, [open]);
  async function add() {
    const n = Math.max(1, Math.min(60, Math.round(Number(horizon) || 10)));
    const preset = screenerConfig.presets.find((p) => p.id === pick);
    const own = saved.find((s) => s.id === pick);
    const conditions = preset ? preset.conditions : own ? (own.conditions as Condition[]) : initial?.conditions ?? [];
    const name = preset ? preset.label : own ? savedDisplayName(own.name, conditions, presets) : initial?.name ?? '自訂條件';
    await saveStrategy({ id: uid(), presetId: preset?.id ?? null, name, conditions, horizon: n, startAfter: latest, enabledAt: new Date().toISOString(), active: true });
    onClose();
  }
  return (
    <Sheet open={open} onClose={onClose} title="新增追蹤策略" detent="full">
      <p class="caption muted">從 {md(latest)} 之後的交易日開始記錄新觸發（今天符合、前一個交易日不符合），不回溯過去的訊號。</p>
      <div class="menu-list" role="radiogroup" aria-label="追蹤哪個條件">
        {screenerConfig.presets.map((p) => (
          <button key={p.id} class="menu-item" role="radio" aria-checked={pick === p.id} onClick={() => setPick(p.id)}>
            <span class="grow"><span class="body">{p.label}</span><span class="caption muted" style={{ display: 'block' }}>{p.subtitle}</span></span>
          </button>
        ))}
        {saved.map((s) => (
          <button key={s.id} class="menu-item" role="radio" aria-checked={pick === s.id} onClick={() => setPick(s.id)}>
            <span class="grow"><span class="body">{savedDisplayName(s.name, s.conditions as Condition[], presets)}</span><span class="caption muted" style={{ display: 'block' }}>我的組合</span></span>
          </button>
        ))}
        {initial?.conditions && !initial.presetId ? (
          <button class="menu-item" role="radio" aria-checked={pick === 'custom'} onClick={() => setPick('custom')}>
            <span class="grow"><span class="body">{initial.name ?? '自訂條件'}</span><span class="caption muted" style={{ display: 'block' }}>選股頁目前的條件</span></span>
          </button>
        ) : null}
      </div>
      <div class="field"><label for="track-horizon">持有交易日數（N）</label>
        <input id="track-horizon" class="input" type="number" inputMode="numeric" min={1} max={60} value={horizon} onInput={(e) => setHorizon((e.target as HTMLInputElement).value)} /></div>
      <button class="btn primary block" onClick={add}>開始追蹤</button>
    </Sheet>
  );
}

export default function Tracking() {
  const route = useRoute();
  const summary = useAsync(loadSummary, []);
  const strategies = useDb(listStrategies);
  const tracked = useDb(listTracked);
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(route.query.has('preset') || route.query.has('c'));
  // 進入頁面時同步一次新觸發（App 啟動時也會同步）
  useEffect(() => { syncTracking().then((n) => { if (n) setTick((t) => t + 1); }).catch(() => undefined); }, [strategies?.length]);
  const file = useAsync(() => (strategies?.length ? loadSignals().catch(() => null) : Promise.resolve(null)), [strategies?.length]);
  const px = useAsync(() => (strategies?.some((s) => s.presetId) ? loadSignalPrices().catch(() => null) : Promise.resolve(null)), [strategies?.length]);
  const views = useAsync(async () => (strategies && tracked && !file.loading && !px.loading ? loadPositions(strategies, await listTracked(), file.data, px.data) : null),
    [strategies, tracked, file.data, file.loading, px.data, px.loading, tick]);
  const initial = (() => {
    const preset = route.query.get('preset') ?? undefined;
    const c = route.query.get('c');
    try { return { presetId: preset, conditions: c ? (JSON.parse(c) as Condition[]) : undefined, name: route.query.get('name') ?? undefined }; } catch { return { presetId: preset }; }
  })();
  const latest = summary.data?.date ?? '';
  return (
    <div class="page">
      <TopBar back="/discipline" actions={<button class="btn small" onClick={() => setAdding(true)} disabled={!latest}>新增追蹤</button>} />
      <PageTitle title="訊號追蹤" sub="只記錄、不下單・依規則產生，非推薦" />
      <Section title="追蹤策略" info={<><p>把選股條件或策略設為追蹤：每個交易日記錄新觸發的股票，隔天開盤紙上進場、持有 N 日後開盤出場，與回測並排比較（前瞻驗證）。</p><p>資料存在這台裝置（納入備份）。</p></>}>
        <List chev>
          {strategies ? <EmptyRow>{strategies.length ? `追蹤 ${strategies.length} 個條件` : '無追蹤策略'}</EmptyRow> : null}
          <Row label="新增追蹤策略" onClick={latest ? () => setAdding(true) : undefined} />
        </List>
      </Section>
      {!strategies || views.loading && !views.data ? <Loading /> : null}
      {views.data?.map((v) => <StrategyCard key={v.strategy.id} st={v.strategy} ps={v.positions} />)}
      {latest ? <AddSheet open={adding} onClose={() => setAdding(false)} latest={latest} initial={initial} /> : null}
    </div>
  );
}
