/**
 * 個股頁：預設只顯示主角數字、走勢、一句話健檢、四環分數；往下捲才展開法人、籌碼、營收、估值等區塊。
 * 左右滑動切換同一清單的上一檔／下一檔；「進階」切換成 lightweight-charts 完整 K 線；細節用底部面板。
 * 環境光與走勢線同一個期間、同一個顏色。
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Ambient, Block, TopBar } from '../components/Chrome';
import { Accumulating, DataStatus, ErrorState, Loading } from '../components/DataStatus';
import { HeroChart, usePeriod } from '../components/HeroChart';
import { ScoreRings, compositeCompleteness, categoryName, scoreText } from '../components/Scores';
import { ScoreDetailView } from '../components/ScoreDetail';
import { StockExtras, FairRange } from '../components/StockExtras';
import { ChipDaily, ChipStats } from '../components/Chips';
import { Sheet } from '../components/Sheet';
import { NetBars } from '../components/Viz';
import { Signed } from '../components/Change';
import { healthLine } from '../components/QuickPreview';
import { IconChevron, IconStar, IconStarFill } from '../components/Icons';
import { lazy } from '../lazy';
import { useAsync, useDb } from '../hooks';
import { loadStock } from '../data/api';
import { useScoredSummary } from '../data/useSummary';
import { addWatch, isWatched, removeWatch } from '../db/db';
import type { CategoryId } from '../lib/config';
import type { ChipBlock } from '../lib/chips';
import { adjClose } from '../lib/history';
import { change, sliceWindow } from '../lib/periods';
import { instInsight, type Who } from '../lib/insights';
import { getListContext } from '../lib/listContext';
import { commitHero, heroSeen } from '../lib/seen';
import { fmtInt, fmtLots, fmtNum, fmtPct, fmtPrice } from '../lib/format';
import { navigate } from '../router';
import { PAGE_SOURCES } from '../lib/health';

const AdvancedChart = lazy(() => import('../components/AdvancedChart'));

type SheetKind = { kind: 'score'; id?: CategoryId } | { kind: 'more' } | null;

function lastOf(a: unknown): number | null {
  if (!Array.isArray(a)) return null;
  for (let i = a.length - 1; i >= 0; i--) if (a[i] !== null && a[i] !== undefined) return a[i] as number;
  return null;
}
function agoOf(a: unknown, n: number): number | null {
  if (!Array.isArray(a) || a.length <= n) return null;
  return (a[a.length - 1 - n] as number | null) ?? null;
}

export default function Stock({ code }: { code: string }) {
  const hist = useAsync(() => loadStock(code), [code]);
  const summary = useScoredSummary();
  const watched = useDb(() => isWatched(code), [code]);
  const [period, setPeriod] = usePeriod('stock');
  const [advanced, setAdvanced] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [who, setWho] = useState<Who>('foreign');
  const [seen, setSeen] = useState<number | null | undefined>(undefined);
  const [drag, setDrag] = useState(0);
  const g = useRef<{ x: number; y: number; lock: 'h' | 'v' | null } | null>(null);
  const row = summary.data?.byCode.get(code);
  const h = hist.data;
  const ctx = getListContext(code);

  useEffect(() => { setSeen(undefined); heroSeen(`stock:${code}`).then(setSeen); setAdvanced(false); setSheet(null); }, [code]);
  const adj = useMemo(() => (h ? adjClose(h) : []), [h]);
  const win = h ? sliceWindow(h.d, adj, period) : null;
  const dir = win ? change(win.values).dir : 'flat';
  const latest = lastOf(adj);
  useEffect(() => { if (seen !== undefined) commitHero(`stock:${code}`, latest); }, [seen, latest, code]);
  const inst = h ? instInsight(h, who) : null;

  // 左右滑動切換同一清單的上一檔／下一檔（圖表區與橫向捲動區除外）
  function go(step: 1 | -1) {
    if (!ctx) return;
    const next = ctx.codes[ctx.index + step];
    if (next) navigate(`/stock/${next}`, true, step > 0 ? 'push' : 'pop');
  }
  const onDown = (e: PointerEvent) => {
    if (!ctx || (e.target as HTMLElement).closest('.chart-wrap, .chips, .periods, .sheet, button, a, input, .chart-box, .scroll-x, .chip-scroll, .nb-bars')) return;
    g.current = { x: e.clientX, y: e.clientY, lock: null };
  };
  const onMove = (e: PointerEvent) => {
    const s = g.current;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.lock) s.lock = Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5 ? 'h' : Math.abs(dy) > 12 ? 'v' : null;
    if (s.lock === 'h') setDrag(dx);
  };
  const onUp = () => {
    const s = g.current;
    g.current = null;
    if (!s || s.lock !== 'h') { setDrag(0); return; }
    if (drag < -80 && ctx && ctx.index < ctx.codes.length - 1) go(1);
    else if (drag > 80 && ctx && ctx.index > 0) go(-1);
    setDrag(0);
  };

  const comp = (row?.composite as number | null | undefined) ?? h?.scores?.composite ?? null;
  const cc = compositeCompleteness(h?.scores);
  const mb = h ? lastOf(h.mb) : null, mb5 = h ? agoOf(h.mb, 5) : null;
  const sb = h ? lastOf(h.sb) : null, sb5 = h ? agoOf(h.sb, 5) : null;
  const revenue = (h?.revenue as { ym: string; revenue: number; yoy: number | null; mom: number | null }[] | undefined) ?? [];
  const rev = revenue[revenue.length - 1];
  const pePct = h ? lastOf((h.series as Record<string, unknown> | undefined)?.pe_percentile) : null;
  const chip = (h?.chip as ChipBlock | null | undefined) ?? null;

  return (
    <div class="page swipe-page" style={{ transform: drag ? `translateX(${drag * 0.4}px)` : undefined, opacity: drag ? 1 - Math.min(0.4, Math.abs(drag) / 600) : undefined }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <Ambient mood={win ? dir : 'neutral'} />
      <TopBar back="/mine" avatar={false}
        caption={ctx ? (
          <span class="row" style={{ justifyContent: 'center', gap: 'var(--s-1)' }}>
            <button class="text-btn" disabled={ctx.index === 0} onClick={() => go(-1)} aria-label="上一檔">‹</button>
            {ctx.name} {ctx.index + 1} / {ctx.codes.length}
            <button class="text-btn" disabled={ctx.index === ctx.codes.length - 1} onClick={() => go(1)} aria-label="下一檔">›</button>
          </span>
        ) : null}
        actions={
          <>
            <button class="icon-btn" aria-pressed={!!watched} aria-label={watched ? '從自選移除' : '加入自選'} onClick={() => (watched ? removeWatch(code) : addWatch(code))}>
              {watched ? <IconStarFill /> : <IconStar />}
            </button>
            <button class="text-btn" aria-pressed={advanced} onClick={() => setAdvanced(!advanced)}>{advanced ? '簡潔' : '進階'}</button>
          </>
        } />
      <header class="page-head">
        <div class="eyebrow">{code}・{h?.market === 'tpex' ? '上櫃' : '上市'}・{h?.industry ?? row?.industry ?? '—'}</div>
        <h1 class="title">{h?.name ?? row?.name ?? code}</h1>
      </header>
      {hist.error ? <ErrorState error={hist.error} title="找不到這檔股票的資料" /> : null}
      {hist.loading && !h ? <Loading hero /> : null}

      {h ? (
        <>
          <div style={{ marginTop: 'var(--s-2)' }}>
            {advanced ? <AdvancedChart h={h} /> : (
              <HeroChart label="收盤價（還原）" win={win} period={period} onPeriod={setPeriod} seen={seen ?? null}
                format={(v) => fmtPrice(v)} formatDelta={(v) => fmtNum(v, v >= 100 ? 1 : 2)} area height={200} periodsLabel="股價走勢期間" />
            )}
          </div>
          <DataStatus date={h.d[h.d.length - 1]} uses={PAGE_SOURCES.stock} />

          <p class="body" style={{ marginTop: 'var(--s-6)' }}>{healthLine(h.summary_text) ?? '健檢摘要資料不足。'}</p>
          {row?.flags?.length ? (
            <div class="row wrap" style={{ gap: 'var(--s-1)', marginTop: 'var(--s-2)' }} role="group" aria-label="風險旗標">
              {row.flags.map((f) => <span key={f.id} class="tag risk" title={f.detail}>{f.label}</span>)}
            </div>
          ) : null}
          <div style={{ marginTop: 'var(--s-6)' }}>
            <ScoreRings row={row} detail={h.scores} onPick={(id) => setSheet({ kind: 'score', id })} />
          </div>
          <button class="collapsed-row" style={{ marginTop: 'var(--s-3)' }} onClick={() => setSheet({ kind: 'score' })}>
            <span>綜合分 {scoreText(comp)}（資料完整度 {cc === null ? '—' : `${Math.round(cc * 100)}%`}）・查看全部因子</span>
            <IconChevron />
          </button>

          <Block question="法人" answer={inst?.title}>
            <div class="segmented" role="group" aria-label="法人" style={{ marginTop: 'var(--s-4)' }}>
              {(['foreign', 'trust', 'dealer'] as const).map((w) => (
                <button key={w} aria-pressed={who === w} onClick={() => setWho(w)}>{{ foreign: '外資', trust: '投信', dealer: '自營商' }[w]}</button>
              ))}
            </div>
            {inst ? (
              <>
                <div style={{ marginTop: 'var(--s-5)' }}>
                  <NetBars values={inst.values} dates={h.d.slice(-inst.values.length)} caption={`${{ foreign: '外資', trust: '投信', dealer: '自營商' }[who]}每日淨買賣超（張）・近 ${inst.values.length} 個交易日`}
                    label={`${{ foreign: '外資', trust: '投信', dealer: '自營商' }[who]}近 60 日每日淨買賣超柱狀圖：${inst.title}`} />
                </div>
                <div class="card">
                  <div class="body w6">白話重點</div>
                  {inst.lines.map((l) => <p key={l} class="caption t1" style={{ marginTop: 'var(--s-1)' }}>{l}</p>)}
                  {inst.est ? <p class="caption t1" style={{ marginTop: 'var(--s-1)' }}>{inst.est}<span class="est">估</span></p> : null}
                  {!inst.lines.length && !inst.est ? <p class="caption muted">資料累積中。</p> : null}
                </div>
              </>
            ) : null}
          </Block>

          <Block question="籌碼" answer={mb !== null && mb5 ? `融資 5 日${mb >= mb5 ? '增加' : '減少'} ${fmtPct(((mb - mb5) / mb5) * 100, 1, false).replace('-', '')}` : '融資融券'}>
            <div class="list" style={{ marginTop: 'var(--s-4)' }}>
              <div class="list-item"><span class="grow">融資餘額</span><span class="body">{fmtInt(mb)} 張</span><span class="caption" style={{ minWidth: '4.5rem', textAlign: 'right' }}><Signed value={mb !== null && mb5 !== null ? mb - mb5 : null} format={fmtLots} label="5 日" /></span></div>
              <div class="list-item"><span class="grow">融券餘額</span><span class="body">{fmtInt(sb)} 張</span><span class="caption" style={{ minWidth: '4.5rem', textAlign: 'right' }}><Signed value={sb !== null && sb5 !== null ? sb - sb5 : null} format={fmtLots} label="5 日" /></span></div>
              {row?.whale_pct !== null && row?.whale_pct !== undefined ? <div class="list-item"><span class="grow">千張大戶持股比</span><span class="body">{fmtNum(row.whale_pct as number, 1)}%</span></div> : null}
              {row?.foreign_hold_pct !== null && row?.foreign_hold_pct !== undefined ? <div class="list-item"><span class="grow">外資持股比</span><span class="body">{fmtNum(row.foreign_hold_pct as number, 1)}%</span></div> : null}
            </div>
            {row && (row.whale_pct === null || row.whale_pct === undefined) ? <Accumulating what="集保大戶持股" detail="集保股權分散表官方只提供最新一週，每週六起逐週累積。" /> : null}
            {chip ? (
              <>
                <ChipStats block={chip} sharesOut={h.shares} />
                <ChipDaily block={chip} code={code} name={h.name} market={h.market} />
              </>
            ) : <Accumulating what="每日籌碼明細" detail="需要至少兩個交易日的法人與融資融券資料。" />}
          </Block>

          <Block question="營收" answer={rev ? `${rev.ym.slice(0, 4)} 年 ${Number(rev.ym.slice(5, 7))} 月營收年增 ${rev.yoy === null ? '—' : `${rev.yoy.toFixed(1)}%`}` : '沒有月營收資料（ETF 或資料累積中）'}>
            <div class="list" style={{ marginTop: 'var(--s-4)' }}>
              {rev ? (
                <>
                  <div class="list-item"><span class="grow">單月營收</span><span class="body">{fmtNum(rev.revenue / 1e5, 1)} 億</span></div>
                  <div class="list-item"><span class="grow">近 3 月年增率</span><span class="body"><Signed value={(row?.revenue_yoy_3m as number | null) ?? null} format={(v) => fmtPct(v, 1)} /></span></div>
                </>
              ) : null}
              <button class="list-item brand" onClick={() => setSheet({ kind: 'more' })}>基本數據、月營收、季財報與事件<span class="chev"><IconChevron /></span></button>
            </div>
          </Block>

          <Block question="估值" answer={h.fair ? '合理價區間' : `本益比 ${fmtNum(lastOf(h.pe))}`}>
            <div class="card">
              <FairRange h={h} />
              <div class="row between caption" style={{ marginTop: 'var(--s-3)' }}>
                <span>本益比 {fmtNum(lastOf(h.pe))}{pePct !== null ? `（3 年第 ${Math.round(pePct)} 百分位）` : ''}</span>
                <span>淨值比 {fmtNum(lastOf(h.pb))}</span>
                <span>殖利率 {fmtNum(lastOf(h.dy))}%</span>
              </div>
            </div>
          </Block>

          <Sheet open={!!sheet} onClose={() => setSheet(null)} detent={sheet?.kind === 'score' && sheet.id ? 'half' : 'full'}
            title={sheet?.kind === 'score' ? (sheet.id ? `${categoryName(sheet.id)}分數明細` : '分數明細') : '基本數據、營收、財報與事件'}>
            {sheet?.kind === 'score' && h.scores ? <ScoreDetailView detail={h.scores} only={sheet.id} /> : null}
            {sheet?.kind === 'more' ? <StockExtras h={h} /> : null}
          </Sheet>
        </>
      ) : null}
    </div>
  );
}
