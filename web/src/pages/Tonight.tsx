/**
 * 盤後簡報（2026-10 改版 §4）。由上到下：狀態列 → 加權指數 →（有警示時）持倉 → 市場環境 → 三大法人 → 成交金額
 * →（無警示時）持倉 → 自選股異動 → 新觸發 → 流程。只陳述數字與事實；說明、門檻、來源收在 ⓘ。
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { ErrorState } from '../components/DataStatus';
import { BriefStatus, EnvCard, FlowsCard, IndexCard, TurnoverCard, mdw } from '../components/Brief';
import { List, Num, PageTitle, Row, Section, Signed, Tag } from '../components/ui';
import { FlowBriefRow } from '../components/Ritual';
import { IconChevronDown } from '../components/Icons';
import { useAsync, useHistories, useRestoredState } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { useUser } from '../data/useUser';
import { loadIndex, loadIntraday, loadJson, loadMarket, loadMeta } from '../data/api';
import type { StockRow } from '../data/types';
import { TAIEX } from '../data/types';
import { logActivityOnce } from '../db/db';
import { makeSnapshot, type Snapshot } from '../lib/changes';
import { WATCH_SCOPE, snapshotRows, watchRows as watchRowsOf, watchSub, watchSummary } from '../lib/watchChanges';
import { holdingAlerts } from '../lib/holdings';
import { TONIGHT_DEFAULT_PERIOD, type Period } from '../lib/periods';
import { makeCalendar } from '../lib/tradingCalendar';
import { baseline, commit, commitHero, heroSeen } from '../lib/seen';
import { setListContext } from '../lib/listContext';
import { todayTpe } from '../lib/dates';
import { fmtPrice } from '../lib/format';
import { newTriggers, type StrategiesLite } from '../lib/briefTriggers';
import { navigate } from '../router';

/** 清單列左側：「名稱 代號」 */
function NameCode({ row }: { row: StockRow }) {
  return <>{row.name}<span class="ui-muted"> {row.code}</span></>;
}

function PriceValue({ row }: { row: StockRow }) {
  return <Num v={fmtPrice(row.close)} />;
}

export default function Tonight() {
  const summary = useScoredSummary();
  const market = useAsync(loadMarket, []);
  const index = useAsync(loadIndex, []);
  const intraday = useAsync(() => loadIntraday().then((d) => ({ d, failed: false })).catch(() => ({ d: null, failed: true })), []);
  const meta = useAsync(loadMeta, []);
  const strategies = useAsync(() => loadJson<StrategiesLite>('strategies.json').catch(() => null), []);
  const user = useUser();
  const [period, setPeriod] = useState<Period>(TONIGHT_DEFAULT_PERIOD);
  const [showCalm, setShowCalm] = useState(false);
  const [showQuiet, setShowQuiet] = useRestoredState('tonight.showQuiet', false);
  const [snap, setSnap] = useState<Snapshot | null | undefined>(undefined);
  const [seen, setSeen] = useState<number | null | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { baseline(WATCH_SCOPE).then(setSnap); heroSeen('taiex').then(setSeen); }, []);

  const day = summary.data?.date ?? market.data?.date ?? null;
  const byCode = summary.data?.byCode;
  const open = useMemo(() => (user?.trades ?? []).filter((t) => t.status === 'open'), [user]);
  const holdHist = useHistories(useMemo(() => [...new Set(open.map((t) => t.code))], [open]));
  const alerts = useMemo(() => (byCode ? holdingAlerts(open, byCode, undefined, holdHist) : []), [open, byCode, holdHist]);
  const risky = alerts.filter((a) => a.risk);
  const calm = alerts.filter((a) => !a.risk);
  const watchRows = useMemo(() => watchRowsOf(user?.watch ?? [], user?.trades ?? [], byCode), [byCode, user]);
  const watchSum = useMemo(() => watchSummary(watchRows, snap ?? null), [watchRows, snap]);
  const changes = snap === undefined ? [] : watchSum.changes;
  const sig = snap === undefined ? [] : watchSum.significant;
  const quiet = snap === undefined ? [] : watchSum.quiet;

  const calendar = useMemo(() => (meta.data ? makeCalendar(meta.data.calendar) : null), [meta.data]);
  const today = todayTpe();
  const isTradingToday = calendar ? calendar.isTradingDay(today) : true;
  const latestTaiex = index.data ? (index.data.series[TAIEX] ?? []).filter((v) => v !== null).pop() ?? null : null;
  const flow = market.data?.flows[market.data.flows.length - 1];
  const trig = strategies.data ? newTriggers(strategies.data) : null;

  useEffect(() => {
    if (!summary.data || !user || snap === undefined) return;
    commit(WATCH_SCOPE, makeSnapshot(snapshotRows(user.watch, user.trades, summary.data.byCode), summary.data.date));
  }, [summary.data, user, snap]);
  useEffect(() => { if (seen !== undefined) commitHero('taiex', latestTaiex); }, [seen, latestTaiex]);

  // 捲到簡報底部＝看完盤後簡報（簡報環）
  useEffect(() => {
    const el = endRef.current;
    if (!el || !day) return;
    let timer = 0;
    const io = new IntersectionObserver(([e]) => {
      clearTimeout(timer);
      if (e.isIntersecting) timer = window.setTimeout(() => logActivityOnce('brief_read', day), 600);
    }, { threshold: 0.5 });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(timer); };
  }, [day, summary.data]);

  const openStock = (code: string, name: string, codes: string[]) => { setListContext({ name, codes }); navigate(`/stock/${code}`); };

  const holdings = (
    <Section title="持倉" testid="holdings" aside={user && open.length ? `${open.length} 檔${risky.length ? `・警示 ${risky.length}` : ''}` : undefined}>
      <List tags chev>
        {user && !open.length ? <Row label="無持倉" href="#/discipline/checklist" testid="holdings-empty-row" /> : null}
        {risky.map((a) => (
          <Row key={a.trade.id} label={a.row ? <NameCode row={a.row} /> : `${a.trade.name} ${a.trade.code}`}
            sub={a.items.map((i) => i.label).join('・')}
            value={a.row ? <PriceValue row={a.row} /> : '—'} value2={<Signed v={a.row?.change_pct} kind="arrow" unit="%" />}
            tag={<Tag tone="risk">警示</Tag>}
            onClick={() => openStock(a.trade.code, '持倉', alerts.map((x) => x.trade.code))} />
        ))}
        {calm.length ? (
          <Row label={risky.length ? `其餘 ${calm.length} 檔無警示` : `${calm.length} 檔無警示`} onClick={() => setShowCalm(!showCalm)} noChev
            tag={<span class="ui-row-toggle" aria-hidden="true"><IconChevronDown /></span>} testid="holdings-calm" />
        ) : null}
        {showCalm ? calm.map((a) => a.row ? (
          <Row key={a.trade.id} label={<NameCode row={a.row} />} sub={<>停損 <Num v={fmtPrice(a.trade.stop)} /></>}
            value={<PriceValue row={a.row} />} value2={<Signed v={a.row.change_pct} kind="arrow" unit="%" />}
            onClick={() => openStock(a.trade.code, '持倉', alerts.map((x) => x.trade.code))} />
        ) : null) : null}
      </List>
    </Section>
  );

  return (
    <div class="page brief-page">
      <TopBar />
      <PageTitle title="盤後簡報" aside={day ? mdw(day) : undefined} sub={<BriefStatus meta={meta.data ?? null} />} />

      <div class="ui-sec">
        <IndexCard index={index.data ?? null} intraday={intraday.data?.d ?? null} intradayFailed={!!intraday.data?.failed}
          period={period} onPeriod={setPeriod} seen={seen ?? null} isTradingToday={isTradingToday} />
      </div>

      {risky.length ? holdings : null}

      <EnvCard market={market.data ?? null} index={index.data ?? null} />
      {market.error ? <ErrorState error={market.error} /> : null}
      <FlowsCard flow={flow} source={market.data?.flows_source} />
      <TurnoverCard turnover={market.data?.turnover} />

      {!risky.length ? holdings : null}

      <Section title="自選股異動" testid="watch-changes"
        aside={watchRows.length && snap !== undefined ? watchSum.basis.replace(/^自上次查看（(.+)）以來$/, '較 $1') : undefined}
        info={<p>列出相對上次查看（第一次使用時相對前一交易日）有顯著變化的自選股；門檻在設定頁。副資訊：外資＋投信當日合計買賣超張數、佔 20 日均量的比例，與量比（當日成交量 ÷ 20 日均量）。右側：收盤價、漲跌幅、RS 百分位（全市場相對強弱排名，100 為最強）。</p>}>
        <List tags extra chev>
          {user && !user.watch.length ? <Row label="尚無自選股" href="#/mine" testid="watch-empty" /> : null}
          {sig.map((c) => (
            <Row key={c.code} label={<NameCode row={c.row} />} sub={watchSub(c.row)} subWide
              value={<PriceValue row={c.row} />} tag={<span class="ui-v" data-a="bl"><Signed v={c.row.change_pct} kind="arrow" unit="%" /></span>}
              extra={<span class="ui-v ui-foot" data-testid="rs-pct">RS <Num v={(c.row.rs_percentile as number | null | undefined) ?? null} digits={0} /></span>}
              onClick={() => openStock(c.code, '自選股異動', changes.map((x) => x.code))} />
          ))}
          {quiet.length ? (
            <Row label={sig.length ? `其餘 ${quiet.length} 檔未達門檻` : `${quiet.length} 檔未達門檻`} onClick={() => setShowQuiet(!showQuiet)} noChev
              tag={<span class="ui-row-toggle" aria-hidden="true"><IconChevronDown /></span>} testid="watch-quiet" />
          ) : null}
          {showQuiet ? quiet.map((c) => (
            <Row key={c.code} label={<NameCode row={c.row} />} sub={watchSub(c.row)} subWide
              value={<PriceValue row={c.row} />} tag={<span class="ui-v" data-a="bl"><Signed v={c.row.change_pct} kind="arrow" unit="%" /></span>}
              extra={<span class="ui-v ui-foot">RS <Num v={(c.row.rs_percentile as number | null | undefined) ?? null} digits={0} /></span>}
              onClick={() => openStock(c.code, '自選股異動', changes.map((x) => x.code))} />
          )) : null}
        </List>
      </Section>

      <div class="ui-sec">
        <List chev>
          <Row label={trig ? `新觸發 ${trig.stocks} 檔（${trig.strategies} 個策略）` : '新觸發'} sub={trig?.date ? mdw(trig.date) : undefined}
            href="#/discipline/tracking" testid="new-triggers" />
          <FlowBriefRow />
        </List>
      </div>
      <div ref={endRef} aria-hidden="true" style={{ height: '1px' }} />

      {summary.error ? <ErrorState error={summary.error} /> : null}
    </div>
  );
}
