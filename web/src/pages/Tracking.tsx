/**
 * 訊號追蹤（紙上交易，S3）：把選股條件設為追蹤策略，從啟用那天之後開始記錄每天的新觸發，
 * 隔天開盤進場、持有 N 個交易日後開盤出場，和回測數字並排比較（前瞻驗證）。
 * 只記錄、不下單；依規則產生，非推薦。
 */
import { useEffect, useState } from 'preact/hooks';
import { PageHead, TopBar } from '../components/Chrome';
import { Loading } from '../components/DataStatus';
import { Sheet } from '../components/Sheet';
import { useAsync, useDb } from '../hooks';
import { loadJson, loadSignalPrices, loadSignals, loadSummary } from '../data/api';
import { deleteStrategy, listScreens, listStrategies, listTracked, saveStrategy, uid } from '../db/db';
import { labStrategy, screenerConfig, type Condition } from '../lib/config';
import { describeCondition, savedDisplayName, presetScreens } from '../lib/screener';
import { exitsTomorrow, trackStats, type Position, type Strategy } from '../lib/tracking';
import { loadPositions, syncTracking } from '../lib/trackingSync';
import { fmtNum } from '../lib/format';
import { useRoute } from '../router';
import type { Stats } from '../lib/backtest';

const label = (f: string) => screenerConfig.fields[f]?.label ?? f;
const unit = (f: string) => screenerConfig.fields[f]?.unit ?? '';
const md = (iso?: string | null) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '—');
const pct = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), digits)}%`);
const dir = (v: number | null | undefined) => (v === null || v === undefined || Math.abs(v) < 1e-9 ? '' : v > 0 ? 'up' : 'down');

function StatusTag({ p, horizon }: { p: Position; horizon: number }) {
  if (p.status === 'waiting') return <span class="tag">等待進場</span>;
  if (p.status === 'holding') return <span class="tag">{p.held === horizon ? '明天開盤出場' : `持有中 第 ${p.held ?? 0}／${horizon} 日`}</span>;
  if (p.status === 'closed') return <span class="tag">已出場</span>;
  return <span class="tag">資料不足</span>;
}

type BacktestFile = { horizons: Record<string, { all?: Stats; out_of_sample?: Stats }>; coverage?: { limited: boolean } };

function Compare({ st, ps }: { st: Strategy; ps: Position[] }) {
  const s = trackStats(ps);
  const lab = labStrategy(st.presetId);
  const bt = useAsync(() => (st.presetId && !lab ? loadJson<BacktestFile>(`backtests/${st.presetId}.json`).catch(() => null) : Promise.resolve(null)), [st.presetId]);
  const b = bt.data?.horizons[String(st.horizon)]?.all;
  return (
    <div>
      {/* 手機寬度不需要左右滑動：指標為列、追蹤／回測為欄 */}
      <table class="table" data-testid="track-compare">
        <thead><tr><th /><th>追蹤（前瞻）</th><th>回測{bt.data?.coverage?.limited ? '＊' : ''}</th></tr></thead>
        <tbody>
          <tr><td>已出場</td><td>{s.closed} 筆</td><td>{b?.n ?? '—'} 筆</td></tr>
          <tr><td>勝率</td><td>{s.winRate === null ? '—' : `${fmtNum(s.winRate, 1)}%`}</td><td>{b?.win_rate === undefined ? '—' : `${fmtNum(b.win_rate, 1)}%`}</td></tr>
          <tr><td>平均</td><td class={dir(s.avg)}>{pct(s.avg)}</td><td>{pct(b?.avg)}</td></tr>
          <tr><td>中位數</td><td>{pct(s.median)}</td><td>{pct(b?.median)}</td></tr>
          <tr><td>超額</td><td>{pct(s.avgExcess)}</td><td>{pct(b?.avg_excess)}</td></tr>
        </tbody>
      </table>
      <p class="tiny muted">
        {bt.data?.coverage?.limited ? '＊回測樣本範圍受限（條件欄位只涵蓋部分股票），見回測頁。' : ''}
        {lab ? `策略庫「${lab.label}」的歷史統計見策略頁。` : st.presetId ? (b ? `回測：持有 ${st.horizon} 日、全部訊號（新觸發），詳見回測頁。` : `回測沒有持有 ${st.horizon} 日的結果（有 5／10／20 日）。`) : '自訂條件請到回測頁計算。'}
        {s.closed < 30 ? ` 已出場 ${s.closed} 筆，樣本還少，先別據此下結論。` : ''}
      </p>
    </div>
  );
}

function StrategyCard({ st, ps }: { st: Strategy; ps: Position[] }) {
  const [open, setOpen] = useState(false);
  const preset = screenerConfig.presets.find((p) => p.id === st.presetId) ?? labStrategy(st.presetId);
  const tomorrow = exitsTomorrow(ps, st.horizon);
  const shown = open ? ps : ps.slice(0, 8);
  return (
    <section class="card" style={{ marginTop: 'var(--s-4)' }} aria-labelledby={`st-${st.id}`} data-testid="track-strategy">
      <div class="row between">
        <h2 class="section" id={`st-${st.id}`} style={{ margin: 0 }}>{preset?.label ?? st.name}</h2>
        <button class="btn small danger" onClick={() => { if (confirm(`停止追蹤「${preset?.label ?? st.name}」並刪除它的紀錄？`)) deleteStrategy(st.id); }}>停止追蹤</button>
      </div>
      <p class="caption muted">{preset?.subtitle ?? st.conditions.map((c) => describeCondition(c as Condition, label, unit)).join('；')}</p>
      <p class="caption muted">自 {md(st.startAfter)} 之後的新觸發開始記錄（不回溯）・隔天開盤進場、持有 {st.horizon} 個交易日後開盤出場・已扣手續費、證交稅與滑價
        {st.presetId ? '・全市場，由每日資料預先計算' : '・自訂條件在打開 App 時記錄當天的新觸發，沒打開的交易日不會補記'}</p>
      <Compare st={st} ps={ps} />
      {tomorrow.length ? <p class="caption" data-testid="track-exit-tomorrow">明天開盤出場：{tomorrow.map((p) => p.sig.name ?? p.sig.code).join('、')}</p> : null}
      {ps.length ? (
        <div class="list" style={{ marginTop: 'var(--s-2)' }}>
          {shown.map((p) => (
            <a key={p.sig.key} class="list-item" href={`#/stock/${p.sig.code}`} data-testid="track-position">
              <span class="grow" style={{ minWidth: 0 }}>
                <span class="body">{p.sig.name ?? p.sig.code} <span class="caption muted">{p.sig.code}</span></span>
                <span class="caption muted" style={{ display: 'block' }}>
                  訊號 {md(p.sig.signalDate)}{p.entryDate ? `・進場 ${md(p.entryDate)} ${fmtNum(p.entry ?? null)}` : ''}{p.exitDate ? `・出場 ${md(p.exitDate)} ${fmtNum(p.exit ?? null)}` : ''}
                </span>
              </span>
              <span class="right">
                <StatusTag p={p} horizon={st.horizon} />
                <span class={`body num ${dir(p.ret)}`} style={{ display: 'block' }}>{p.ret === undefined ? '—' : pct(p.ret * 100)}</span>
                {p.excess !== undefined && p.excess !== null ? <span class="caption muted nowrap" style={{ display: 'block' }}>超額 {pct(p.excess * 100)}</span> : null}
              </span>
            </a>
          ))}
        </div>
      ) : <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>還沒有新觸發。每個交易日收盤後更新；啟用當天以前的訊號不會列入。</p>}
      {ps.length > 8 ? <button class="btn small" onClick={() => setOpen(!open)}>{open ? '收合' : `顯示全部 ${ps.length} 筆`}</button> : null}
    </section>
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
      <PageHead eyebrow="紀律・前瞻驗證" title="訊號追蹤" />
      <p class="caption muted">把選股條件設為追蹤策略：每個交易日自動記錄新觸發的股票，隔天開盤「紙上」進場、持有 N 日後開盤出場，和回測並排比較，檢查回測結果在啟用之後是否仍然成立。只記錄、不下單；依規則產生，非推薦。資料存在這台裝置（納入備份）。</p>
      {!strategies || views.loading && !views.data ? <Loading /> : null}
      {strategies && !strategies.length ? (
        <div class="empty">
          <p>還沒有追蹤策略。</p>
          <button class="btn primary" onClick={() => setAdding(true)} disabled={!latest}>新增追蹤策略</button>
        </div>
      ) : null}
      {views.data?.map((v) => <StrategyCard key={v.strategy.id} st={v.strategy} ps={v.positions} />)}
      {latest ? <AddSheet open={adding} onClose={() => setAdding(false)} latest={latest} initial={initial} /> : null}
    </div>
  );
}
