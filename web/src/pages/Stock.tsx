/**
 * 個股頁：預設只顯示主角數字、走勢、一句話健檢、四環分數；往下捲才展開法人、籌碼、營收、估值等區塊。
 * 換股（M5）：只在頁首區域（股票名稱、頂列「自選 1／3」）左右滑動、點頂列的 ‹ ›，或電腦版的左右方向鍵；
 * 走勢圖區域完全交給圖表手勢（單指查價、兩指或按住拖曳選區間），不會換股（Apple 股市式，頂列與下方內容不動）；
 * 「進階」切換成 lightweight-charts 完整 K 線；細節用底部面板。
 * 環境光與走勢線同一個期間、同一個顏色。
 */
import { Fragment, type ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Ambient, Block, TopBar } from '../components/Chrome';
import { Accumulating, Banner, DataStatus, ErrorState, Loading } from '../components/DataStatus';
import { HeroChart, usePeriod } from '../components/HeroChart';
import { type PagerApi, StockPager } from '../components/StockPager';
import { ScoreRings, compositeCompleteness, categoryName, scoreText } from '../components/Scores';
import { ScoreDetailView } from '../components/ScoreDetail';
import { creditAnswer, creditSummary } from '../lib/credit';
import { type HolderBlock, structureSentence } from '../lib/holders';
import { Sheet } from '../components/Sheet';
import { NetBars } from '../components/Viz';
import { IconChevron, IconCloudOff, IconStar, IconStarFill } from '../components/Icons';
import { lazy, lazyPick } from '../lazy';
import type { EventRow } from '../components/StockSections';
import type { Conference } from '../components/Research';
import { useAsync, useDb, useStockData } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { addWatch, isWatched, removeWatch } from '../db/db';
import type { CategoryId } from '../lib/config';
import type { ChipBlock } from '../lib/chips';
import { adjClose } from '../lib/history';
import { LONG_PERIODS, STOCK_PERIODS, change, periodStart, type Period } from '../lib/periods';
import { heroWindows, windowFor, withDaily, type HeroWindows } from '../lib/heroSeries';
import { type RangeBasis, getRangeBasis, setRangeBasis } from '../lib/rangeReturn';
import { isNotFound, loadInactive, loadLongHistory } from '../data/api';
import { inactiveText, tradeStatusNote } from '../lib/tradeStatus';
import type { StockHistory } from '../data/types';
import { SECTION_ORDER, STYLE_DESC, STYLE_NAME, STYLE_PERIOD, type SectionId } from '../lib/style';
import { useInvestStyle } from '../hooks';
import { type QuarterRow, type RevenueRow, momentumAnswer, momentumFacts, profitAnswer, profitFacts, revenueAnswer, revenueFacts } from '../lib/fundamentals';
import { conclusionLine, valuationPhrase } from '../lib/verdict';
import { techFacts } from '../lib/technical';
import { instInsight, type Who } from '../lib/insights';
import { getListContext } from '../lib/listContext';
import { commitHero, heroSeen } from '../lib/seen';
import { fmtNum, fmtPrice } from '../lib/format';
import { navigate } from '../router';
import { restorePending } from '../lib/scrollRestore';
import { PAGE_SOURCES } from '../lib/health';
import { evaluate, tally, title as bbTitle } from '../lib/bullbear';
import { BullBearBar } from '../components/BullBearBar';

/** 第一次繪製時先畫的區塊數（主角區之下）：結論、有效訊號面板、四環分數 */
const FIRST_SECTIONS = 3;

const AdvancedChart = lazy(() => import('../components/AdvancedChart'));
// 下方區塊的細節元件延後載入：個股頁的 JS 先只包含主角區與區塊標題（一句話結論），縮短 LCP 與 TBT
const chips = () => import('../components/Chips');
const credit = () => import('../components/Credit');
const sections = () => import('../components/StockSections');
const ChipDaily = lazyPick(chips, 'ChipDaily');
const ChipStats = lazyPick(chips, 'ChipStats');
const ForeignHolding = lazyPick(credit, 'ForeignHolding');
const MarginCard = lazyPick(credit, 'MarginCard');
const ShortCard = lazyPick(credit, 'ShortCard');
const StructureBlock = lazyPick(() => import('../components/Structure'), 'StructureBlock');
const EventsList = lazyPick(sections, 'EventsList');
const ForeignTrend = lazyPick(sections, 'ForeignTrend');
const MomentumSection = lazyPick(sections, 'MomentumSection');
const ProfitSection = lazyPick(sections, 'ProfitSection');
const RevenueSection = lazyPick(sections, 'RevenueSection');
const ValuationSection = lazyPick(sections, 'ValuationSection');
const Research = lazyPick(() => import('../components/Research'), 'Research');
const StockExtras = lazyPick(() => import('../components/StockExtras'), 'StockExtras');
const SignalPanel = lazyPick(() => import('../components/SignalPanel'), 'SignalPanel');

type SheetKind = { kind: 'score'; id?: CategoryId } | { kind: 'more' } | null;

function lastOf(a: unknown): number | null {
  if (!Array.isArray(a)) return null;
  for (let i = a.length - 1; i >= 0; i--) if (a[i] !== null && a[i] !== undefined) return a[i] as number;
  return null;
}

/**
 * 主角走勢的視窗（v3 M5）：期間在個股檔範圍內（約 4.5 年）直接用；5Y／10Y／ALL 超過時載入長歷史股價檔
 * （收盤回補 10 年）；10Y、ALL 改為週線取樣。回傳還原價與原始價（同一組日期與取樣點，見 lib/heroSeries）。
 */
function useHeroWindow(code: string, h: StockHistory | null, period: Period): HeroWindows {
  const needLong = !!h && LONG_PERIODS.includes(period) && (period === 'ALL' || periodStart(h.d, period).truncated);
  const long = useAsync(() => (needLong ? loadLongHistory(code) : Promise.resolve(null)), [code, needLong]);
  return useMemo(() => {
    if (!h) return { adj: null, raw: null };
    const L = needLong && long.data && long.data.d.length > h.d.length ? long.data : null;
    // 「今日」一律用個股檔的日資料（#3），不受期間與週線取樣影響
    return withDaily(L ? heroWindows(L.d, L.c, L.af, period) : heroWindows(h.d, h.c, h.af, period), h.d, h.c, h.af);
  }, [h, long.data, period, needLong]);
}

/** 主角區（名稱、股價、走勢圖）：個股頁左右換股時，前一檔／目前／後一檔各一份。 */
function StockHero({ code, fallbackName, fallbackIndustry, status, period, onPeriod, seen, basis, onBasis, advanced = false, swipe = false }: {
  code: string;
  fallbackName?: string | null;
  fallbackIndustry?: string | null;
  /** U-02：今日無成交／停牌中（中性文字，不是資料問題） */
  status?: string | null;
  period: Period;
  onPeriod: (p: Period) => void;
  seen: number | null;
  /** M5：價格基準（還原／原始）：主角數字、走勢、今日與期間漲跌、區間報酬、進階圖與成本線一起切換 */
  basis: RangeBasis;
  onBasis: (b: RangeBasis) => void;
  advanced?: boolean;
  /** M5：頁首（名稱列）是左右換股的區域（data-swipe）；走勢圖區域不換股 */
  swipe?: boolean;
}) {
  const { data: h, error } = useStockData(code);
  const win = windowFor(useHeroWindow(code, h, period), basis);
  const inactive = useAsync(() => (error && isNotFound(error) ? loadInactive().then((m) => m.get(code) ?? null) : Promise.resolve(null)), [code, !!error]);
  const market = h?.market ?? inactive.data?.market;
  return (
    <>
      <header class={`page-head ${swipe ? 'swipe-zone' : ''}`} data-swipe={swipe ? '' : undefined}>
        <div class="eyebrow">{code}{market ? `・${market === 'tpex' ? '上櫃' : '上市'}` : ''}{h || fallbackIndustry ? `・${h?.industry ?? fallbackIndustry ?? '—'}` : ''}</div>
        <h1 class="title">{h?.name ?? fallbackName ?? inactive.data?.name ?? code}</h1>
        {h && status ? <p class="caption muted trade-note" data-testid="trade-note">{status}</p> : null}
      </header>
      {h ? (
        <div style={{ marginTop: 'var(--s-2)' }}>
          {advanced ? <AdvancedChart h={h} mode={basis} onMode={onBasis} /> : (
            <HeroChart label={basis === 'raw' ? '收盤價（原始）' : '收盤價（還原）'} win={win} period={period} onPeriod={onPeriod} seen={basis === 'adj' ? seen : null}
              format={(v) => fmtPrice(v)} formatDelta={(v) => fmtNum(v, v >= 100 ? 1 : 2)} area height={200} periodsLabel="股價走勢期間"
              periods={STOCK_PERIODS} heroChange="both" basis={basis} onBasis={onBasis} />
          )}
        </div>
      ) : error ? null : <Loading hero />}
    </>
  );
}

/**
 * M5：頂列「自選 1／3」那一列也可以左右滑動換股（滑動距離 ≥ 40px 且以水平為主），與點 ‹ › 相同。
 */
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

/** U-01：沒有個股檔（下市、長期停牌或代號錯誤）時的友善說明，不露出 HTTP 404。 */
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

export default function Stock({ code }: { code: string }) {
  const hist = useStockData(code);
  const summary = useScoredSummary();
  const watched = useDb(() => isWatched(code), [code]);
  const style = useInvestStyle();
  // v3：鍵名改為 stock-v3-{風格}，讓預設期間（波段 1Y、長期 5Y）對既有使用者也生效（舊鍵可能存 1D）
  const [period, setPeriod] = usePeriod(`stock-v3-${style}`, STYLE_PERIOD[style], STOCK_PERIODS);
  const [advanced, setAdvanced] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [who, setWho] = useState<Who>('foreign');
  const [seen, setSeen] = useState<number | null | undefined>(undefined);
  // M5：價格基準（還原／原始）由頁面統一管理並記住（前後一檔的主角區同步）
  const [basis, setBasisState] = useState<RangeBasis>(getRangeBasis);
  const pickBasis = (b: RangeBasis) => { setBasisState(b); setRangeBasis(b); };
  const pagerRef = useRef<PagerApi>(null);
  // 首次繪製只畫前兩個區塊；其餘在捲動接近時（哨兵進入下一個畫面高度內）一次補一個，降低個股頁的主執行緒阻塞（TBT）。
  // 返回時要還原捲動位置（restorePending）則直接畫出全部，頁面高度才夠。
  const [shown, setShown] = useState(FIRST_SECTIONS);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => { setShown(restorePending() ? SECTION_ORDER.swing.length : FIRST_SECTIONS); }, [code]);
  useEffect(() => {
    const el = sentinel.current;
    if (!hist.data || !el || shown >= SECTION_ORDER.swing.length) return;
    if (restorePending()) { setShown(SECTION_ORDER.swing.length); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setShown((n) => n + 1); }, { rootMargin: '0px 0px 100% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [code, !!hist.data, shown]);
  const allSections = shown >= SECTION_ORDER.swing.length;
  // 下方內容只在「換股之後」淡入；第一次開啟直接顯示（淡入會延後最大內容繪製 LCP）
  const firstCode = useRef(code);
  const row = summary.data?.byCode.get(code);
  const h = hist.data;
  const ctx = getListContext(code);

  useEffect(() => { setSeen(undefined); heroSeen(`stock:${code}`).then(setSeen); setAdvanced(false); setSheet(null); }, [code]);
  const adj = useMemo(() => (h ? adjClose(h) : []), [h]);
  const win = windowFor(useHeroWindow(code, h, period), basis);
  const dir = win ? change(win.values).dir : 'flat';
  const latest = lastOf(adj);
  useEffect(() => { if (seen !== undefined) commitHero(`stock:${code}`, latest); }, [seen, latest, code]);
  const inst = h ? instInsight(h, who) : null;

  // 同一清單的上一檔／下一檔：左右滑動主角區（StockPager）或點頂列的 ‹ ›，兩者走同一個動畫
  function go(step: 1 | -1) {
    if (!ctx) return;
    if (pagerRef.current) { pagerRef.current.go(step); return; }
    const next = ctx.codes[ctx.index + step];
    if (next) navigate(`/stock/${next}`, true, step > 0 ? 'push' : 'pop');
  }
  // M5：電腦版左右方向鍵換股；焦點在圖表（圖表用方向鍵查價）、輸入框或底部面板時不換股
  useEffect(() => {
    if (!ctx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.chart-wrap, .chart-box, input, textarea, select, [contenteditable="true"], [role="slider"], [role="dialog"]')) return;
      if (sheet) return;
      e.preventDefault();
      go(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const nameOf = (c: string) => (summary.data?.byCode.get(c)?.name as string | undefined) ?? null;
  const statusOf = (c: string) => tradeStatusNote(summary.data?.byCode.get(c));
  const industryOf = (c: string) => (summary.data?.byCode.get(c)?.industry as string | undefined) ?? null;

  const comp = (row?.composite as number | null | undefined) ?? h?.scores?.composite ?? null;
  const cc = compositeCompleteness(h?.scores);
  const credit = useMemo(() => creditSummary({
    d: h?.d ?? [], adj, mb: h?.mb ?? [], sb: h?.sb ?? [], sbl: h?.sbl as (number | null)[] | undefined, qfii: h?.qfii as (number | null)[] | undefined,
    marginUsage: (row?.margin_usage as number | null | undefined) ?? null,
    lastCover: ((h?.short_halt as { last_cover_date?: string | null } | null | undefined)?.last_cover_date) ?? null,
  }), [h, adj, row]);
  const holders = (h?.holders as HolderBlock | null | undefined) ?? null;
  const pePct = h ? lastOf((h.series as Record<string, unknown> | undefined)?.pe_percentile) : null;
  const chip = (h?.chip as ChipBlock | null | undefined) ?? null;
  const bb = useMemo(() => (h ? tally(evaluate(h)) : null), [h]);
  const tech = useMemo(() => (h ? techFacts(h.h, h.l, h.c, h.af) : null), [h]);
  const mom = useMemo(() => momentumFacts(adj, (h?.metrics ?? {}) as Record<string, unknown>, h?.d ?? []), [adj, h]);
  const rev = useMemo(() => revenueFacts((h?.revenue as RevenueRow[] | undefined) ?? []), [h]);
  const profit = useMemo(() => profitFacts((h?.quarters as QuarterRow[] | undefined) ?? []), [h]);
  const metrics = (h?.metrics ?? {}) as Record<string, unknown>;
  const verdict = h ? conclusionLine(style, {
    mom, rev, profit, pePct, pv: credit.pv.label,
    foreignStreak: Number(metrics.foreign_streak ?? 0) || 0, trustStreak: Number(metrics.trust_streak ?? 0) || 0,
  }) : '';
  const events = (h?.events as EventRow[] | undefined) ?? [];
  const confs = (h?.conferences as Conference[] | undefined) ?? [];
  const WHO_NAME = { foreign: '外資', trust: '投信', dealer: '自營商' } as const;

  /** 各區塊：標題＝一個問題＋一句結論，細節在下方；順序見 lib/style.ts 的 SECTION_ORDER。 */
  const sections: Record<SectionId, () => ComponentChildren> = !h ? {} as Record<SectionId, () => ComponentChildren> : {
    conclusion: () => (
      <Block id="sec-conclusion" question={`整體狀態如何？（${STYLE_NAME[style]}）`} answer={verdict}>
        {row?.flags?.length ? (
          <div class="row wrap" style={{ gap: 'var(--s-1)', marginTop: 'var(--s-2)' }} role="group" aria-label="風險旗標">
            {row.flags.map((f) => <span key={f.id} class="tag risk" title={f.detail}>{f.label}</span>)}
          </div>
        ) : null}
      </Block>
    ),
    signals: () => (
      <Block id="sec-signals" question="有統計證據的訊號觸發了嗎？" answer="只列策略庫分級為有效或觀察中的策略對應的指標">
        <SignalPanel code={code} />
      </Block>
    ),
    scores: () => (
      <Block id="sec-scores" question="四環分數" answer={`綜合分 ${scoreText(comp)}`}>
        <div style={{ marginTop: 'var(--s-4)' }}>
          <ScoreRings row={row} detail={h.scores} onPick={(id) => setSheet({ kind: 'score', id })} />
        </div>
        <button class="collapsed-row" style={{ marginTop: 'var(--s-3)' }} onClick={() => setSheet({ kind: 'score' })}>
          <span>綜合分 {scoreText(comp)}（資料完整度 {cc === null ? '—' : `${Math.round(cc * 100)}%`}）・查看全部因子</span>
          <IconChevron />
        </button>
        {bb ? (
          <section class="sx-bb" aria-label="多空">
            <p class="caption muted">多空條件：{bbTitle(bb)}</p>
            <BullBearBar t={bb} />
          </section>
        ) : null}
        <div class="list">
          <a class="list-item brand" href={`#/stock/${code}/bullbear`}>
            <span class="grow">多空對照<span class="caption muted tool-sub">基本面、籌碼面、量價面、技術面的多方與空方並排比較</span></span>
            <span class="chev"><IconChevron /></span>
          </a>
        </div>
      </Block>
    ),
    momentum: () => (
      <Block id="sec-momentum" question="動能夠不夠強？" answer={momentumAnswer(mom)}>
        <MomentumSection f={mom} t={tech ?? undefined} />
      </Block>
    ),
    institutional: () => (
      <Block id="sec-institutional" question="法人在買還是賣？" answer={inst?.title}>
        <div class="segmented" role="group" aria-label="法人" style={{ marginTop: 'var(--s-4)' }}>
          {(['foreign', 'trust', 'dealer'] as const).map((w) => (
            <button key={w} aria-pressed={who === w} onClick={() => setWho(w)}>{WHO_NAME[w]}</button>
          ))}
        </div>
        {inst ? (
          <>
            <div style={{ marginTop: 'var(--s-5)' }}>
              <NetBars values={inst.values} dates={h.d.slice(-inst.values.length)} caption={`${WHO_NAME[who]}每日淨買賣超（張）・近 ${inst.values.length} 個交易日`}
                label={`${WHO_NAME[who]}近 60 日每日淨買賣超柱狀圖：${inst.title}`} />
            </div>
            <div class="card">
              <div class="body w6">白話重點</div>
              {inst.lines.map((l) => <p key={l} class="caption t1" style={{ marginTop: 'var(--s-1)' }}>{l}</p>)}
              {inst.est ? <p class="caption t1" style={{ marginTop: 'var(--s-1)' }}>{inst.est}<span class="est">估</span></p> : null}
              {!inst.lines.length && !inst.est ? <p class="caption muted">資料累積中。</p> : null}
            </div>
          </>
        ) : null}
        <ForeignHolding s={credit} />
        {chip ? (
          <>
            <ChipStats block={chip} sharesOut={h.shares} />
            <ChipDaily block={chip} code={code} name={h.name} market={h.market} />
          </>
        ) : <Accumulating what="每日籌碼明細" detail="需要至少兩個交易日的法人與融資融券資料。" />}
        <div class="list">
          <a class="list-item brand" href={`#/stock/${code}/institutional`}>
            <span class="grow">法人買賣超報表<span class="caption muted tool-sub">近 3 個月逐日買張、賣張・外資／投信／自營商／三大法人</span></span>
            <span class="chev"><IconChevron /></span>
          </a>
        </div>
      </Block>
    ),
    credit: () => (
      <Block id="sec-credit" question="融資與空方在做什麼？" answer={creditAnswer(credit)}>
        <MarginCard s={credit} />
        <ShortCard s={credit} />
      </Block>
    ),
    structure: () => (
      <Block id="sec-structure" question="大戶在增加還是減少？" answer={holders && holders.d.length ? structureSentence(holders) : '集保資料累積中'}>
        <StructureBlock block={holders} d={h.d} c={h.c} name={h.name} code={code}
          extra={style === 'long' ? <ForeignTrend d={h.d} qfii={h.qfii as (number | null)[] | undefined} /> : undefined} />
      </Block>
    ),
    revenue: () => (
      <Block id="sec-revenue" question={style === 'long' ? '營收有沒有在成長？' : '營收與基本面如何？'} answer={revenueAnswer(rev)}>
        <RevenueSection f={rev} onMore={() => setSheet({ kind: 'more' })} />
      </Block>
    ),
    profit: () => (
      <Block id="sec-profit" question="獲利品質好不好？" answer={profitAnswer(profit)}>
        <ProfitSection f={profit} />
      </Block>
    ),
    valuation: () => (
      <Block id="sec-valuation" question="現在貴不貴？" answer={valuationPhrase(pePct) ?? (h.fair ? '合理價區間（估）' : `本益比 ${fmtNum(lastOf(h.pe))}`)}>
        <ValuationSection h={h} pePct={pePct} river={style === 'long'} />
      </Block>
    ),
    events: () => (
      <Block id="sec-events" question="最近有什麼事件？" answer={events.length || confs.length ? `近一年 ${events.length} 筆事件、${confs.length} 場法說會` : '近一年沒有事件紀錄'}>
        <EventsList events={events} />
        <Research code={code} name={h.name} market={h.market} conferences={confs} />
      </Block>
    ),
  };

  return (
    <div class="page stock-page">
      <Ambient mood={win ? dir : 'neutral'} />
      <TopBar back="/mine" avatar={false}
        caption={ctx ? (
          <SwipeCaption onStep={go}>
            <span class="row" style={{ justifyContent: 'center', gap: 'var(--s-1)' }}>
              <button class="text-btn pager-arrow" disabled={ctx.index === 0} onClick={() => go(-1)} aria-label="上一檔">‹</button>
              <span data-testid="list-position">{ctx.name} {ctx.index + 1} / {ctx.codes.length}</span>
              <button class="text-btn pager-arrow" disabled={ctx.index === ctx.codes.length - 1} onClick={() => go(1)} aria-label="下一檔">›</button>
            </span>
          </SwipeCaption>
        ) : null}
        actions={
          <>
            <button class="icon-btn" aria-pressed={!!watched} aria-label={watched ? '從自選移除' : '加入自選'} onClick={() => (watched ? removeWatch(code) : addWatch(code))}>
              {watched ? <IconStarFill /> : <IconStar />}
            </button>
            <button class="text-btn" aria-pressed={advanced} onClick={() => setAdvanced(!advanced)}>{advanced ? '簡潔' : '進階'}</button>
          </>
        } />
      {ctx && !advanced ? (
        <StockPager apiRef={pagerRef} codes={ctx.codes} index={ctx.index}
          onCommit={(step) => navigate(`/stock/${ctx.codes[ctx.index + step]}`, true, 'none')}
          renderPane={(c, current) => (
            <StockHero code={c} fallbackName={nameOf(c)} fallbackIndustry={industryOf(c)} status={statusOf(c)} period={period} onPeriod={setPeriod}
              seen={current ? seen ?? null : null} basis={basis} onBasis={pickBasis} swipe />
          )} />
      ) : (
        <StockHero code={code} fallbackName={row?.name as string | undefined} fallbackIndustry={row?.industry as string | undefined}
          status={tradeStatusNote(row, h?.d[h.d.length - 1])} period={period} onPeriod={setPeriod} seen={seen ?? null} advanced={advanced}
          basis={basis} onBasis={pickBasis} />
      )}
      {hist.error ? (isNotFound(hist.error) ? <NotFound code={code} /> : <ErrorState error={hist.error} title="這檔股票的資料暫時無法取得" />) : null}

      {h ? (
        /* 換股後下方內容整段換成新的一檔（淡入）；頂列與主角區不重新載入 */
        <div key={code} class={`stock-lower ${code !== firstCode.current ? 'fade-in' : ''}`} data-style={style}>
          {/* U-02：資料狀態看市場最新交易日；這一檔無成交／停牌另在主角數字旁說明，不當成資料問題 */}
          <DataStatus uses={PAGE_SOURCES.stock} />
          {SECTION_ORDER[style].slice(0, shown).map((id) => <Fragment key={id}>{sections[id]()}</Fragment>)}
          {!allSections ? <div ref={sentinel} class="skeleton sections-placeholder" aria-hidden="true" /> : null}
          <p class="caption muted style-note" data-testid="style-note">
            區塊順序依投資風格「{STYLE_NAME[style]}」排列（{STYLE_DESC[style]}），可在 <a href="#/me/settings">設定</a> 變更。
          </p>

          <Sheet open={!!sheet} onClose={() => setSheet(null)} detent={sheet?.kind === 'score' && sheet.id ? 'half' : 'full'}
            title={sheet?.kind === 'score' ? (sheet.id ? `${categoryName(sheet.id)}分數明細` : '分數明細') : '基本數據、營收、財報與事件'}>
            {sheet?.kind === 'score' && h.scores ? <ScoreDetailView detail={h.scores} only={sheet.id} /> : null}
            {sheet?.kind === 'more' ? <StockExtras h={h} /> : null}
          </Sheet>
        </div>
      ) : null}
    </div>
  );
}
