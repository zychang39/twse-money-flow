/**
 * 個股頁（SPEC §5，2026-10 改版；動能與籌碼優先）。由上到下：
 *   導覽列（返回｜自選股異動分頁器｜★｜⋯）→ 名稱（LargeTitle）＋代號・市場・產業 → 價格、當日漲跌、所選區間漲跌 → 走勢圖（區間 8 格）
 *   → 狀態標籤（處置中、注意次數、融券回補、除權息；有才顯示）→ 摘要格 2×3 → 策略訊號 → sticky 分段「動能｜籌碼｜基本面｜事件」。
 * ⋯ 內含「還原價／原始價」「K 線／折線」「進階」與手勢說明；進階才顯示四個分項分數、多空條件計數、KD、MACD（綜合分已移除）。
 * 換股：頁首區域左右滑動、頂列 ‹ ›、電腦版左右方向鍵；走勢圖區域完全交給圖表手勢（長按十字線、兩指區間報酬）。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { Banner, ErrorState, Loading } from '../components/DataStatus';
import { type PagerApi, StockPager } from '../components/StockPager';
import { StockChart } from '../components/StockChart';
import { ChipsPanel, EventsPanel, FundamentalPanel, MomentumPanel, SummaryStats, mdw } from '../components/StockPanels';
import { ScoreDetailView } from '../components/ScoreDetail';
import { categoryName } from '../components/Scores';
import { Sheet } from '../components/Sheet';
import { List, PageTitle, Row, Seg, Tag, Warn } from '../components/ui';
import { IconCloudOff, IconMore, IconStar, IconStarFill } from '../components/Icons';
import { lazyPick } from '../lazy';
import { useAsync, useDb, useStockData } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { addWatch, getSetting, isWatched, removeWatch } from '../db/db';
import { DEFAULT_PORTFOLIO, type PortfolioSettings } from '../lib/settings';
import type { CategoryId } from '../lib/config';
import type { Period } from '../lib/periods';
import { usePeriod } from '../components/HeroChart';
import { type RangeBasis, getRangeBasis, setRangeBasis } from '../lib/rangeReturn';
import { isNotFound, loadInactive, loadLongHistory, loadMeta, loadStockIntraday, loadStockIntradayIndex } from '../data/api';
import { INTRADAY_PERIODS, STOCK_CHART_PERIODS, adjDiffers, dailySeries, intradaySeries } from '../lib/stockChart';
import { statusTags } from '../lib/stockFacts';
import { dataPhase, makeCalendar } from '../lib/tradingCalendar';
import { todayTpe } from '../lib/dates';
import { getListContext } from '../lib/listContext';
import { inactiveText, tradeStatusNote } from '../lib/tradeStatus';
import { navigate } from '../router';
import { PAGE_SOURCES, affectedFor } from '../lib/health';
import type { StockHistory } from '../data/types';
import '../styles/stock.css';

const SignalPanel = lazyPick(() => import('../components/SignalPanel'), 'SignalPanel');

type SegId = 'm' | 'c' | 'f' | 'e';
const SEGS = [['m', '動能'], ['c', '籌碼'], ['f', '基本面'], ['e', '事件']] as const;
const SEG_KEY = 'tmf-stock-seg';
const CHART_KEY = 'tmf-stock-chart';
const ADV_KEY = 'tmf-stock-advanced';
const read = <T extends string>(k: string, allowed: readonly T[], d: T): T => {
  try { const v = localStorage.getItem(k) as T | null; return v && allowed.includes(v) ? v : d; } catch { return d; }
};
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 無痕模式 */ } };

/** 主角區（名稱、價格、走勢圖）：左右換股時前一檔／目前／後一檔各一份。 */
function StockHero({ code, fallbackName, fallbackIndustry, status, period, onPeriod, basis, candle, swipe = false }: {
  code: string;
  fallbackName?: string | null;
  fallbackIndustry?: string | null;
  status?: string | null;
  period: Period;
  onPeriod: (p: Period) => void;
  basis: RangeBasis;
  candle: boolean;
  swipe?: boolean;
}) {
  const { data: h, error } = useStockData(code);
  const inactive = useAsync(() => (error && isNotFound(error) ? loadInactive().then((m) => m.get(code) ?? null) : Promise.resolve(null)), [code, !!error]);
  const idx = useAsync(loadStockIntradayIndex, []);
  const hasIntra = !!idx.data?.codes.includes(code);
  const periods = hasIntra ? STOCK_CHART_PERIODS : STOCK_CHART_PERIODS.filter((p) => !INTRADAY_PERIODS.includes(p));
  const eff: Period = periods.includes(period) ? period : '1Y';
  const intraOn = INTRADAY_PERIODS.includes(eff);
  const intra = useAsync(() => (intraOn && hasIntra ? loadStockIntraday(code) : Promise.resolve(null)), [code, intraOn, hasIntra]);
  const needLong = !!h && (eff === '5Y' || eff === 'ALL');
  const long = useAsync(() => (needLong ? loadLongHistory(code) : Promise.resolve(null)), [code, needLong]);
  const series = useMemo(() => {
    if (!h) return null;
    if (intraOn) return intradaySeries(intra.data, eff);
    return dailySeries(h, eff, basis, needLong ? long.data : null);
  }, [h, eff, basis, intraOn, intra.data, long.data, needLong]);
  const market = h?.market ?? inactive.data?.market;
  const industry = h?.industry ?? fallbackIndustry ?? null;
  const sub = `${code}${market ? `・${market === 'tpex' ? '上櫃' : '上市'}` : ''}${industry ? `・${industry}` : ''}`;
  const last = series?.bars[series.bars.length - 1];
  const foot = !series || !last ? null
    : series.kind === 'intraday' ? `5 分 K・${mdw(last.t)} ${last.t.slice(11, 16)}・${intra.data?.source ?? ''}`
      : `資料至 ${mdw(last.t)} 收盤${series.kind === 'weekly' ? '・週 K' : series.kind === 'close' ? '・收盤折線' : ''}${basis === 'raw' ? '・原始價' : ''}`;
  return (
    <>
      <div class={swipe ? 'swipe-zone' : ''} data-swipe={swipe ? '' : undefined}>
        <PageTitle title={h?.name ?? fallbackName ?? inactive.data?.name ?? code} sub={status ? `${sub}・${status}` : sub} />
      </div>
      {h ? (
        <StockChart series={series} candle={candle} period={eff} onPeriod={onPeriod} periods={periods}
          adjLabel={basis === 'adj' && !intraOn && adjDiffers(h, eff)} footnote={foot}
          loading={(intraOn && intra.loading) || (needLong && long.loading)}
          emptyText={intraOn ? '盤中資料暫時無法取得' : '資料累積中'} />
      ) : error ? null : <Loading hero />}
    </>
  );
}

/** 頂列「自選股異動 1/5」也可以左右滑動換股（≥ 40px 且以水平為主）。 */
function SwipeCaption({ children, onStep }: { children: ComponentChildren; onStep: (step: 1 | -1) => void }) {
  const g = useRef<{ id: number; x: number; y: number } | null>(null);
  return (
    <span class="swipe-caption swipe-zone" data-testid="swipe-caption"
      onPointerDown={(e) => { g.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; }}
      onPointerUp={(e) => {
        const s = g.current;
        g.current = null;
        if (!s || s.id !== e.pointerId) return;
        const dx = e.clientX - s.x, dy = e.clientY - s.y;
        if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5) onStep(dx < 0 ? 1 : -1);
      }}
      onPointerCancel={() => { g.current = null; }}>
      {children}
    </span>
  );
}

function NotFound({ code }: { code: string }) {
  const info = useAsync(loadInactive, []);
  if (!info.data) return null;
  const r = info.data.get(code);
  return (
    <Banner icon={<IconCloudOff />} title={r ? `${r.name}（${code}）目前沒有行情` : `找不到代號 ${code}`}
      action={<a class="btn small" href="#/search">搜尋其他股票</a>}>
      {inactiveText(r)}。
    </Banner>
  );
}

interface AttnLite { count10?: number; active?: { start: string; end: string; interval: string | null } | null }

/** 狀態標籤列（§5.3）：處置中、近 10 個營業日注意 n 次、融券最後回補 ≤ 10 營業日、除權息 ≤ 5 營業日。 */
function StatusTags({ h, today, cal }: { h: StockHistory; today: string; cal: ReturnType<typeof makeCalendar> }) {
  const a = h.attn as AttnLite | null | undefined;
  const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
  const tags: string[] = [];
  if (a?.active) tags.push(`處置中 ${md(a.active.start)}–${md(a.active.end)}${a.active.interval ? `・每 ${a.active.interval}` : ''}`);
  if (a?.count10) tags.push(`近 10 日注意 ${a.count10} 次`);
  for (const t of statusTags(h, today, cal)) tags.push(t.text);
  if (!tags.length) return null;
  return <div class="sk-tags" role="group" aria-label="狀態" data-testid="status-tags">{tags.map((t) => <Tag key={t} tone="risk">{t}</Tag>)}</div>;
}

export default function Stock({ code }: { code: string }) {
  const hist = useStockData(code);
  const summary = useScoredSummary();
  const watched = useDb(() => isWatched(code), [code]);
  const portfolio = useDb(() => getSetting<PortfolioSettings>('portfolio', DEFAULT_PORTFOLIO));
  const [period, setPeriod] = usePeriod('stock-v4', '1Y', STOCK_CHART_PERIODS);
  const [basis, setBasisState] = useState<RangeBasis>(getRangeBasis);
  const pickBasis = (b: RangeBasis) => { setBasisState(b); setRangeBasis(b); };
  const [candle, setCandle] = useState(() => read(CHART_KEY, ['candle', 'line'] as const, 'candle') === 'candle');
  const [advanced, setAdvanced] = useState(() => read(ADV_KEY, ['1', '0'] as const, '0') === '1');
  const [seg, setSegState] = useState<SegId>(() => read(SEG_KEY, ['m', 'c', 'f', 'e'] as const, 'm'));
  const setSeg = (s: SegId) => { setSegState(s); write(SEG_KEY, s); };
  const [menu, setMenu] = useState(false);
  const [score, setScore] = useState<CategoryId | null>(null);
  const pagerRef = useRef<PagerApi>(null);
  const firstCode = useRef(code);
  const row = summary.data?.byCode.get(code);
  const h = hist.data;
  const ctx = getListContext(code);
  const meta = useAsync(loadMeta, []);
  const cal = useMemo(() => makeCalendar(meta.data?.calendar), [meta.data]);
  const today = todayTpe();
  const marketDate = meta.data?.market_date ?? null;
  // 資料狀態：只有落後超過 2 個交易日或本頁用到的資料源異常才顯示一行橘色警示（資料時間已在走勢圖下方）
  const staleText = (() => {
    if (!meta.data || !marketDate) return null;
    const { phase, lag } = dataPhase(marketDate, cal);
    const failed = affectedFor(PAGE_SOURCES.stock, meta.data.sources_affected ?? meta.data.sources_failed).length;
    if (phase === 'stale') return `資料停在 ${Number(marketDate.slice(5, 7))}/${Number(marketDate.slice(8, 10))}，落後 ${lag} 個交易日`;
    return failed ? `${failed} 個資料源異常` : null;
  })();
  const asof = (d: string | null) => (d ? `資料日 ${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}${marketDate && d < marketDate ? `(${Number(marketDate.slice(5, 7))}/${Number(marketDate.slice(8, 10))} 尚未公布)` : ''}` : '無資料');

  useEffect(() => { setScore(null); setMenu(false); }, [code]);

  function go(step: 1 | -1) {
    if (!ctx) return;
    if (pagerRef.current) { pagerRef.current.go(step); return; }
    const next = ctx.codes[ctx.index + step];
    if (next) navigate(`/stock/${next}`, true, step > 0 ? 'push' : 'pop');
  }
  useEffect(() => {
    if (!ctx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.chart-wrap, .chart-box, input, textarea, select, [contenteditable="true"], [role="slider"], [role="dialog"]')) return;
      if (menu || score) return;
      e.preventDefault();
      go(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const nameOf = (c: string) => (summary.data?.byCode.get(c)?.name as string | undefined) ?? null;
  const statusOf = (c: string) => tradeStatusNote(summary.data?.byCode.get(c));
  const industryOf = (c: string) => (summary.data?.byCode.get(c)?.industry as string | undefined) ?? null;
  const prefs = portfolio ?? DEFAULT_PORTFOLIO;

  return (
    <div class="page stock-page">
      <TopBar back="/mine" avatar={false}
        caption={ctx ? (
          <SwipeCaption onStep={go}>
            <span class="sk-pager ui-foot">
              <button type="button" class="sk-pager-arrow" disabled={ctx.index === 0} onClick={() => go(-1)} aria-label="上一檔">‹</button>
              <span data-testid="list-position">{ctx.name} {ctx.index + 1}/{ctx.codes.length}</span>
              <button type="button" class="sk-pager-arrow" disabled={ctx.index === ctx.codes.length - 1} onClick={() => go(1)} aria-label="下一檔">›</button>
            </span>
          </SwipeCaption>
        ) : null}
        actions={
          <>
            <button class="icon-btn" aria-pressed={!!watched} aria-label={watched ? '從自選移除' : '加入自選'} onClick={() => (watched ? removeWatch(code) : addWatch(code))}>
              {watched ? <IconStarFill /> : <IconStar />}
            </button>
            <button class="icon-btn" aria-label="更多" aria-haspopup="dialog" onClick={() => setMenu(true)} data-testid="stock-more"><IconMore /></button>
          </>
        } />
      {ctx ? (
        <StockPager apiRef={pagerRef} codes={ctx.codes} index={ctx.index}
          onCommit={(step) => navigate(`/stock/${ctx.codes[ctx.index + step]}`, true, 'none')}
          renderPane={(c) => (
            <StockHero code={c} fallbackName={nameOf(c)} fallbackIndustry={industryOf(c)} status={statusOf(c)} period={period} onPeriod={setPeriod} basis={basis} candle={candle} swipe />
          )} />
      ) : (
        <StockHero code={code} fallbackName={row?.name as string | undefined} fallbackIndustry={row?.industry as string | undefined}
          status={tradeStatusNote(row, h?.d[h.d.length - 1])} period={period} onPeriod={setPeriod} basis={basis} candle={candle} />
      )}
      {hist.error ? (isNotFound(hist.error) ? <NotFound code={code} /> : <ErrorState error={hist.error} title="這檔股票的資料暫時無法取得" />) : null}

      {h ? (
        <div key={code} class={`stock-lower ${code !== firstCode.current ? 'fade-in' : ''}`}>
          {staleText ? <Warn testid="stock-stale">{staleText}</Warn> : null}
          <StatusTags h={h} today={today} cal={cal} />
          <SummaryStats h={h} />
          <SignalPanel code={code} />
          <div class="sk-seg">
            <Seg options={SEGS} value={seg} onChange={setSeg} label="個股分段" sticky testid="stock-seg" />
          </div>
          {seg === 'm' ? <MomentumPanel h={h} prefs={prefs} advanced={advanced} row={row} onScore={setScore} /> : null}
          {seg === 'c' ? <ChipsPanel h={h} asof={asof} /> : null}
          {seg === 'f' ? <FundamentalPanel h={h} asof={asof} /> : null}
          {seg === 'e' ? <EventsPanel h={h} today={today} cal={cal} /> : null}
          <Sheet open={!!score} onClose={() => setScore(null)} detent="half" title={score ? `${categoryName(score)}分數明細` : '分數明細'}>
            {score && h.scores ? <ScoreDetailView detail={h.scores} only={score} /> : null}
          </Sheet>
        </div>
      ) : null}

      <Sheet open={menu} onClose={() => setMenu(false)} title="顯示">
        <div class="sk-menu">
          <Seg options={[['adj', '還原價'], ['raw', '原始價']] as const} value={basis} onChange={pickBasis} label="價格基準" testid="basis-seg" />
          <Seg options={[['candle', 'K 線'], ['line', '折線']] as const} value={candle ? 'candle' : 'line'}
            onChange={(v) => { setCandle(v === 'candle'); write(CHART_KEY, v); }} label="圖表" testid="chart-kind" />
          <List>
            <Row label="進階" sub="分項分數、多空條件、KD、MACD" value={advanced ? '開' : '關'} testid="toggle-advanced"
              onClick={() => { const v = !advanced; setAdvanced(v); write(ADV_KEY, v ? '1' : '0'); if (v) setSeg('m'); setMenu(false); }} />
          </List>
          <div class="ui-prose">
            <p>還原價：除權息、分割、減資前的價格乘上還原因子，報酬含股利再投入；原始價：官方收盤價，只看價差。</p>
            <p>走勢圖手勢：長按顯示十字線與開高低收；兩指（桌機：按住拖曳）看兩點間的區間報酬，放開後保留 2 秒。1D／1W 為 5 分 K（非官方來源），虛線為前一交易日收盤。</p>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
