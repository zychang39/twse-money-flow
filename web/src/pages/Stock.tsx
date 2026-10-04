/**
 * 個股頁（M3，2026-10 恢復環境光改版）。由上到下：
 *   導覽列（返回｜自選分頁器｜★｜⋯）→ 代號・市場・族群路徑（可點）→ 名稱（大標題）→ 收盤價（還原）→ 主角數字 56
 *   → 當日漲跌、所選期間漲跌 → 走勢圖（預設發光折線，⋯ 可改 K 線並記住）→ 期間膠囊 1D～ALL（一律顯示）→ 資料時間
 *   → 狀態標籤 → 黏性分段「總覽｜動能｜籌碼｜基本面｜事件」（存在網址 ?seg=，並記住上次選擇）。
 * 環境光跟著主角的當日漲跌。換股：頁首區域左右滑動、頂列 ‹ ›、電腦版左右方向鍵；走勢圖區域只給圖表手勢（D4）。
 * 1D／1W：個股 5 分 K。當日無成交（no_trade）、來源缺資料（missing）、尚未涵蓋（不在分 K 清單）各自說明原因，不留白（F 節）。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { Banner, ErrorState, Loading } from '../components/DataStatus';
import { HeroChart } from '../components/HeroChart';
import { type PagerApi, StockPager } from '../components/StockPager';
import { StockChart } from '../components/StockChart';
import { EventsPanel, FundamentalPanel, mdw } from '../components/StockPanels';
import { ChipsPane } from '../components/stock/Chips';
import { OverviewPane, type StockSeg } from '../components/stock/Overview';
import { MomentumPane } from '../components/stock/Momentum';
import { Sheet } from '../components/Sheet';
import { StaleNote, Term } from '../components/kit';
import { List, Row, Seg, Tag } from '../components/ui';
import { IconCloudOff, IconMore, IconStar, IconStarFill } from '../components/Icons';
import { useAsync, useDb, useInvestStyle, useSegParam, useStockData } from '../hooks';
import { STYLE_PERIOD } from '../lib/style';
import { useScoredSummary } from '../data/useSummary';
import { addWatch, isWatched, removeWatch } from '../db/db';
import type { Period } from '../lib/periods';
import { usePeriod } from '../components/HeroChart';
import { type RangeBasis, getRangeBasis, setRangeBasis } from '../lib/rangeReturn';
import { isNotFound, loadInactive, loadLongHistory, loadMeta, loadStockIntraday, loadStockIntradayIndex } from '../data/api';
import { INTRADAY_PERIODS, STOCK_CHART_PERIODS, adjDiffers, dailyChange, dailySeries, intradayReason, intradaySeries, kSeries, seriesWindow } from '../lib/stockChart';
import { windowCoverageNote } from '../lib/series';
import { statusTags } from '../lib/stockFacts';
import { dataPhase, makeCalendar } from '../lib/tradingCalendar';
import { todayTpe } from '../lib/dates';
import { getListContext } from '../lib/listContext';
import { inactiveText, tradeStatusNote } from '../lib/tradeStatus';
import { fmtNum, fmtPrice } from '../lib/format';
import { priceDigits } from '../components/StockChart';
import { navigate } from '../router';
import { evaluate, tally, title as bbTitle } from '../lib/bullbear';
import { PAGE_SOURCES, affectedFor } from '../lib/health';
import { moodOf, useAmbient } from '../lib/ambient';
import type { StockHistory } from '../data/types';
import '../styles/stock.css';
import { markOnboard, trackStock } from '../lib/flowTrack';
import { CHART_KEY, readPref, writePref } from '../lib/prefs';

const SEGS = [['o', '總覽'], ['m', '動能'], ['c', '籌碼'], ['f', '基本面'], ['e', '事件']] as const;
const SEG_IDS = SEGS.map((s) => s[0]) as StockSeg[];
/** 圖表種類（D2）：預設折線、K 線為選項並記住（鍵在 lib/prefs，設定頁可改預設） */
const read = readPref;
const write = writePref;
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

/** 代號・市場・族群路徑（官方產業 › 細產業）；族群可點，進入族群頁。 */
function Crumb({ code, h, market, industry }: { code: string; h: StockHistory | null; market?: string | null; industry: string | null }) {
  const off = h?.sectors?.official ?? null;
  const fine = h?.sectors?.fine?.[0] ?? null;
  const link = (id: string, name: string) => <a class="crumb-link" href={`#/explore/sectors/${encodeURIComponent(id)}`}>{name}</a>;
  return (
    <p class="stock-crumb ui-foot ui-muted" data-testid="stock-crumb">
      <span>{code}</span>
      {market ? <span>・{market === 'tpex' ? '上櫃' : '上市'}</span> : null}
      {off ? <span>・{link(off.id, off.name)}</span> : industry ? <span>・{industry}</span> : null}
      {fine ? <span> › {link(fine.id, fine.name)}</span> : null}
    </p>
  );
}

/** 主角區（路徑、名稱、價格、走勢圖）：左右換股時前一檔／目前／後一檔各一份。 */
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
  const intraOn = INTRADAY_PERIODS.includes(period);
  const intra = useAsync(() => (intraOn && hasIntra ? loadStockIntraday(code) : Promise.resolve(null)), [code, intraOn, hasIntra]);
  // 5Y／ALL：折線需要長歷史；K 線的月 K 也要用長歷史補齊個股檔以前的月份
  const needLong = !!h && (period === '5Y' || period === 'ALL');
  const long = useAsync(() => (needLong ? loadLongHistory(code) : Promise.resolve(null)), [code, needLong]);
  const series = useMemo(() => {
    if (!h) return null;
    if (intraOn) return intradaySeries(intra.data, period);
    return candle ? kSeries(h, period, basis, needLong ? long.data : null) : dailySeries(h, period, basis, needLong ? long.data : null);
  }, [h, period, basis, intraOn, intra.data, long.data, needLong, candle]);
  const win = useMemo(() => (h && series && !candle ? seriesWindow(series, h, basis) : null), [series, h, basis, candle]);
  const market = h?.market ?? inactive.data?.market;
  const industry = h?.industry ?? fallbackIndustry ?? null;
  const last = series?.bars[series.bars.length - 1];
  const coverage = series?.truncated ? windowCoverageNote({ dates: series.bars.map((b) => b.t), truncated: true, span: series.span }) : null;
  const kindNote = series?.kind === 'weekly' ? (candle ? '週 K' : '週線取樣') : series?.kind === 'monthly' ? '月 K' : series?.kind === 'quarterly' ? '季 K（月 K 超過圖寬）' : series?.kind === 'close' ? '收盤折線' : candle && series?.kind === 'daily' ? '日 K' : '';
  const synth = series?.synthUntil ? `${Number(series.synthUntil.slice(0, 4))}/${Number(series.synthUntil.slice(5, 7))} 以前以收盤價合成` : '';
  const foot0 = !series || !last ? null
    : series.kind === 'intraday' ? `5 分 K・${mdw(last.t)} ${last.t.slice(11, 16)}・${intra.data?.source ?? ''}`
      : [`資料至 ${mdw(last.t)} 收盤`, kindNote, synth, basis === 'raw' ? '原始價' : ''].filter(Boolean).join('・');
  const foot = coverage && candle ? <><span data-testid="hero-coverage">{coverage}</span>{foot0 ? `・${foot0}` : ''}</> : foot0;
  const showAdj = basis === 'adj' && !intraOn && !!h && adjDiffers(h, period);
  // 當日漲跌一律用日資料（盤中與週 K 的相鄰兩點不是「前一交易日」）；1D／1W 沒有分鐘資料時主角數字也用它
  const today = h ? dailyChange(h, intraOn ? 'raw' : basis) : null;
  const label = intraOn ? '成交價（5 分 K）' : basis === 'adj' ? <Term id="adjusted_price">收盤價（還原）</Term> : '收盤價（原始）';
  const empty = intraOn ? (hasIntra && intra.loading ? '載入中…' : intradayReason(code, idx.data, !!idx.error || !!intra.error)) : '資料累積中';
  const name = h?.name ?? fallbackName ?? inactive.data?.name ?? code;
  return (
    <>
      <div class={swipe ? 'swipe-zone' : ''} data-swipe={swipe ? '' : undefined}>
        <Crumb code={code} h={h ?? null} market={market} industry={industry} />
        <header class="ui-head stock-head">
          <h1 class="ui-large">{name}</h1>
          {status ? <div class="ui-foot ui-muted ui-head-sub">{status}</div> : null}
        </header>
      </div>
      {h ? (
        candle ? (
          <StockChart series={series} candle period={period} onPeriod={onPeriod} periods={STOCK_CHART_PERIODS} label={label}
            adjLabel={showAdj} footnote={foot}
            loading={(intraOn && intra.loading) || (needLong && long.loading)} today={today} emptyText={empty} />
        ) : (
          <div class="hero-plain stock-hero" data-testid="stock-hero">
            <HeroChart label={label} win={win} period={period} onPeriod={onPeriod} format={fmtPrice} formatDelta={(v) => fmtNum(v, priceDigits(last?.c ?? today?.close ?? 0))} area heroChange="both" holdToScrub
              periods={STOCK_CHART_PERIODS} periodsLabel="股價走勢期間" emptyText={empty} basis={showAdj ? 'adj' : undefined}
              heroTestid="stock-price" periodsTestid="stock-periods" fallback={today ? { value: today.close, abs: today.abs, pct: today.pct, date: today.date } : null} />
            {foot ? <div class="sc-foot ui-foot ui-muted" data-testid="data-time">{foot}</div> : null}
          </div>
        )
      ) : error ? null : <Loading hero />}
    </>
  );
}

/** 頂列「自選 1/5」也可以左右滑動換股（≥ 40px 且以水平為主）。 */
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

/** 狀態標籤（有才顯示，橘色）：處置中、近 10 日注意 n 次、融券最後回補在 10 日內、除權息在 5 日內。 */
function StatusTags({ h, today, cal }: { h: StockHistory; today: string; cal: ReturnType<typeof makeCalendar> }) {
  const a = h.attn as AttnLite | null | undefined;
  const tags: string[] = [];
  if (a?.active) tags.push(`處置中 ${md(a.active.start)}–${md(a.active.end)}${a.active.interval ? `・每 ${a.active.interval}` : ''}`);
  if (a?.count10) tags.push(`近 10 日注意 ${a.count10} 次`);
  for (const t of statusTags(h, today, cal)) tags.push(t.text);
  if (!tags.length) return null;
  return <div class="sk-tags" role="group" aria-label="狀態" data-testid="status-tags">{tags.map((t) => <Tag key={t} tone="risk">{t}</Tag>)}</div>;
}

export default function Stock({ code }: { code: string }) {
  // 同選股頁：用版面效果，很快離開也會記到
  useLayoutEffect(() => trackStock(code), [code]);
  const hist = useStockData(code);
  const summary = useScoredSummary();
  const watched = useDb(() => isWatched(code), [code]);
  // 投資風格（設定）只決定預設期間（波段 1Y、長期 5Y）與第一次開啟的分段（長期＝基本面）；各自記住
  const style = useInvestStyle();
  const [period, setPeriod] = usePeriod(`stock-v5-${style}`, STYLE_PERIOD[style], STOCK_CHART_PERIODS);
  const pickPeriod = (p: typeof period) => { if (p === '1D') markOnboard('period_1d'); setPeriod(p); };
  const [basis, setBasisState] = useState<RangeBasis>(getRangeBasis);
  const pickBasis = (b: RangeBasis) => { setBasisState(b); setRangeBasis(b); };
  const [candle, setCandle] = useState(() => read(CHART_KEY, ['candle', 'line'] as const, 'line') === 'candle');
  const [seg, setSeg] = useSegParam<StockSeg>(SEG_IDS, style === 'long' ? 'f' : 'o', 'seg', 'stock');
  const [menu, setMenu] = useState(false);
  const pagerRef = useRef<PagerApi>(null);
  const firstCode = useRef(code);
  const row = summary.data?.byCode.get(code);
  const h = hist.data;
  const ctx = getListContext(code);
  const meta = useAsync(loadMeta, []);
  const cal = useMemo(() => makeCalendar(meta.data?.calendar), [meta.data]);
  const today = todayTpe();
  const marketDate = meta.data?.market_date ?? null;
  const dayChg = h ? dailyChange(h, 'raw') : null;
  const bb = useMemo(() => (h && menu ? bbTitle(tally(evaluate(h))) : undefined), [h, menu]);
  useAmbient(moodOf(dayChg?.abs));
  // 資料狀態：落後超過 2 個交易日或本頁用到的資料源異常才顯示（橘色，連到資料健康頁）
  const staleText = (() => {
    if (!meta.data || !marketDate) return null;
    const { phase, lag } = dataPhase(marketDate, cal);
    const failed = affectedFor(PAGE_SOURCES.stock, meta.data.sources_affected ?? meta.data.sources_failed).length;
    const parts = [
      phase === 'stale' ? `資料停在 ${md(marketDate)}，落後 ${lag} 個交易日` : '',
      failed ? `${failed} 個資料源異常` : '',
    ].filter(Boolean);
    return parts.length ? parts.join('・') : null;
  })();
  const asof = (d: string | null) => (d ? `資料日 ${md(d)}${marketDate && d < marketDate ? `(${md(marketDate)} 尚未公布)` : ''}` : '無資料');

  useEffect(() => { setMenu(false); }, [code]);

  // 換股時保留網址上的分段（沒有 ?seg= 時分段由記住的值決定，網址保持乾淨）
  const segQuery = typeof location !== 'undefined' && /[?&]seg=/.test(location.hash) ? `?seg=${seg}` : '';
  function go(step: 1 | -1) {
    if (!ctx) return;
    if (pagerRef.current) { pagerRef.current.go(step); return; }
    const next = ctx.codes[ctx.index + step];
    if (next) { markOnboard('swipe'); navigate(`/stock/${next}${segQuery}`, true, step > 0 ? 'push' : 'pop'); }
  }
  useEffect(() => {
    if (!ctx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.chart-wrap, .chart-box, input, textarea, select, [contenteditable="true"], [role="slider"], [role="dialog"], [role="group"]')) return;
      if (menu) return;
      e.preventDefault();
      go(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // 分段列以下的內容區也可左右滑動換股：水平位移 > 12px 且 |dx| > 2|dy| 才鎖定；超過 30% 寬或速度夠快才換；
  // 排除圖表、分段列、期間膠囊、可橫向捲動的元素、螢幕左右 20px（M3）
  const sw = useRef<{ id: number; x: number; y: number; t: number; lock: boolean | null } | null>(null);
  const NOSWIPE = '.chart-wrap, .sc2-plot, .sc-wrap, .ui-seg, .segmented, .periods, .chips, .heat, input, textarea, select, [data-noswipe], [role="slider"]';
  const lowerSwipe = ctx ? {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest(NOSWIPE) || e.clientX < 20 || e.clientX > window.innerWidth - 20) return;
      // 可橫向捲動的祖先（例：寬表格）
      for (let el = t; el && el !== e.currentTarget; el = el.parentElement) if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') return;
      sw.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), lock: null };
    },
    onPointerMove: (e: PointerEvent) => {
      const g = sw.current;
      if (!g || g.id !== e.pointerId || g.lock !== null) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.abs(dx) > 12 && Math.abs(dx) > 2 * Math.abs(dy)) g.lock = true;
      else if (Math.abs(dy) > 12) g.lock = false;
    },
    onPointerUp: (e: PointerEvent) => {
      const g = sw.current;
      sw.current = null;
      if (!g || g.id !== e.pointerId || !g.lock) return;
      const dx = e.clientX - g.x;
      const v = Math.abs(dx) / Math.max(1, performance.now() - g.t);
      if (Math.abs(dx) > window.innerWidth * 0.3 || (v > 0.6 && Math.abs(dx) > 40)) go(dx < 0 ? 1 : -1);
    },
    onPointerCancel: () => { sw.current = null; },
  } : {};
  const nameOf = (c: string) => (summary.data?.byCode.get(c)?.name as string | undefined) ?? null;
  const statusOf = (c: string) => tradeStatusNote(summary.data?.byCode.get(c));
  const industryOf = (c: string) => (summary.data?.byCode.get(c)?.industry as string | undefined) ?? null;

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
          onCommit={(step) => { markOnboard('swipe'); navigate(`/stock/${ctx.codes[ctx.index + step]}${segQuery}`, true, 'none'); }}
          renderPane={(c) => (
            <StockHero code={c} fallbackName={nameOf(c)} fallbackIndustry={industryOf(c)} status={statusOf(c)} period={period} onPeriod={pickPeriod} basis={basis} candle={candle} swipe />
          )} />
      ) : (
        <StockHero code={code} fallbackName={row?.name as string | undefined} fallbackIndustry={row?.industry as string | undefined}
          status={tradeStatusNote(row, h?.d[h.d.length - 1])} period={period} onPeriod={pickPeriod} basis={basis} candle={candle} />
      )}
      {hist.error ? (isNotFound(hist.error) ? <NotFound code={code} /> : <ErrorState error={hist.error} title="這檔股票的資料暫時無法取得" />) : null}

      {h ? (
        <div key={code} class={`stock-lower ${code !== firstCode.current ? 'fade-in' : ''}`} {...lowerSwipe}>
          {staleText ? <StaleNote lead="資料可能過期" testid="stock-stale">{staleText}</StaleNote> : null}
          <StatusTags h={h} today={today} cal={cal} />
          <div class="sk-seg">
            <Seg options={SEGS} value={seg} onChange={setSeg} label="個股分段" sticky testid="stock-seg" />
          </div>
          {seg === 'o' ? <OverviewPane h={h} row={row} onSeg={setSeg} /> : null}
          {seg === 'm' ? <MomentumPane h={h} /> : null}
          {seg === 'c' ? <ChipsPane h={h} asof={asof} /> : null}
          {seg === 'f' ? <FundamentalPanel h={h} asof={asof} /> : null}
          {seg === 'e' ? <EventsPanel h={h} today={today} cal={cal} /> : null}
        </div>
      ) : null}

      <Sheet open={menu} onClose={() => setMenu(false)} title="顯示">
        <div class="sk-menu">
          <Seg options={[['line', '折線'], ['candle', 'K 線']] as const} value={candle ? 'candle' : 'line'}
            onChange={(v) => { setCandle(v === 'candle'); write(CHART_KEY, v); }} label="圖表" testid="chart-kind" />
          <Seg options={[['adj', '還原價'], ['raw', '原始價']] as const} value={basis} onChange={pickBasis} label="價格基準" testid="basis-seg" />
          <List chev>
            <Row label="分數明細" sub="四個分項分數的因子" href={`#/stock/${code}/scores`} testid="to-scores" />
            <Row label="多空條件" sub="規則式條件計數" value={bb} href={`#/stock/${code}/bullbear`} testid="to-bullbear" />
            <Row label="設定" href="#/me/settings" testid="menu-settings" />
          </List>
          <div class="ui-prose">
            <p>還原價：除權息、分割、減資前的價格乘上還原因子，報酬含股利再投入；原始價：官方收盤價，只看價差。</p>
            <p>走勢圖手勢：長按查價（主角數字跟著變）；兩指（桌機：按住拖曳）看兩點間的區間報酬，放開後保留 2 秒。1D／1W 為 5 分 K（非官方來源），虛線為前一交易日收盤。K 線：1M／3M 日 K、YTD／1Y 週 K、5Y／ALL 月 K。</p>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
