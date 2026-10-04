/**
 * 盤後簡報（M2）：頁首（標題、資料時間）→ 加權指數主視覺（環境光跟隨當日漲跌、主數字 56、1D／1W）→
 * 分段 總覽｜市場｜資金｜我的（網址 ?seg=，重新整理後停在同一分段）。
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TopBar, useAmbient } from '../components/Chrome';
import { BriefStatus, BriefWarn, IndexHero, MarketPane, MoneyPane, Overview, indexDayChange, md } from '../components/Brief';
import { List, Num, PageTitle, Row, Section, Seg, Signed, Tag } from '../components/ui';
import { Conclusion, DataState, Term } from '../components/kit';
import { IconChevronDown } from '../components/Icons';
import { useAsync, useHistories, useRestoredState, useSegParam } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { useUser } from '../data/useUser';
import { useFlow } from '../data/useFlow';
import { loadIndex, loadIntraday, loadJson, loadMarket, loadMeta, loadSectors } from '../data/api';
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
import { gradeId, newTriggers, type StrategiesLite } from '../lib/briefTriggers';
import { moodOf } from '../lib/ambient';
import { navigate } from '../router';
import { trackMarket } from '../lib/flowTrack';

type BriefSeg = 'overview' | 'market' | 'money' | 'mine';
const SEGS = [['overview', '總覽'], ['market', '市場'], ['money', '資金'], ['mine', '我的']] as const;

function NameCode({ row }: { row: StockRow }) {
  return <>{row.name}<span class="ui-muted"> {row.code}</span></>;
}

export default function Tonight() {
  const summary = useScoredSummary();
  const market = useAsync(loadMarket, []);
  const index = useAsync(loadIndex, []);
  const intraday = useAsync(() => loadIntraday().then((d) => ({ d, failed: false })).catch(() => ({ d: null, failed: true })), []);
  const meta = useAsync(loadMeta, []);
  const strategies = useAsync(() => loadJson<StrategiesLite>('strategies.json').catch(() => null), []);
  const sectors = useAsync(() => loadSectors().catch(() => null), []);
  const user = useUser();
  const flow = useFlow();
  const [seg, setSeg] = useSegParam<BriefSeg>(SEGS.map(([k]) => k), 'overview');
  const [period, setPeriod] = useState<Period>(TONIGHT_DEFAULT_PERIOD);
  const [showCalm, setShowCalm] = useState(false);
  const [showQuiet, setShowQuiet] = useRestoredState('tonight.showQuiet', false);
  const [snap, setSnap] = useState<Snapshot | null | undefined>(undefined);
  const [seen, setSeen] = useState<number | null | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);

  useAmbient(moodOf(indexDayChange(index.data ?? null)));
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
  const isTradingToday = calendar ? calendar.isTradingDay(todayTpe()) : true;
  const latestTaiex = index.data ? (index.data.series[TAIEX] ?? []).filter((v) => v !== null).pop() ?? null : null;
  const trig = strategies.data ? newTriggers(strategies.data) : null;
  const trigCodes = useMemo(() => {
    const out: string[] = [];
    for (const s of strategies.data?.strategies ?? []) {
      if (gradeId(s.grade) === 'invalid') continue;
      for (const x of s.today ?? []) if (!out.includes(x.code)) out.push(x.code);
    }
    return out;
  }, [strategies.data]);
  const leaders = useMemo(() => (sectors.data?.groups ?? [])
    .filter((g) => g.layer === 'fine' && g.rank !== null && !g.merged && !g.id.startsWith('e-'))
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)).slice(0, 3), [sectors.data]);

  useEffect(() => {
    if (!summary.data || !user || snap === undefined) return;
    commit(WATCH_SCOPE, makeSnapshot(snapshotRows(user.watch, user.trades, summary.data.byCode), summary.data.date));
  }, [summary.data, user, snap]);
  useEffect(() => { if (seen !== undefined) commitHero('taiex', latestTaiex); }, [seen, latestTaiex]);

  // 看完市場分段＝流程第 1 步「看大盤」（市場分段捲到底）
  useEffect(() => {
    const el = endRef.current;
    if (!el || !day || seg !== 'market') return;
    let timer = 0;
    const io = new IntersectionObserver(([e]) => {
      clearTimeout(timer);
      if (e.isIntersecting) timer = window.setTimeout(() => { void logActivityOnce('brief_read', day); trackMarket(); }, 600);
    }, { threshold: 0.5 });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(timer); };
  }, [day, seg, market.data]);

  const openStock = (code: string, name: string, codes: string[]) => { setListContext({ name, codes }); navigate(`/stock/${code}`); };
  const nextStep = flow ? flow.steps.steps.find((r) => r.status === 'todo' && !r.optional) : null;

  const overviewRows = (
    <>
      <Row label="今日流程" testid="flow-brief-row" href="#/discipline"
        value={flow ? <Num v={flow.steps.score} /> : undefined}
        sub={flow ? (flow.steps.complete ? '今日已完成' : nextStep ? `下一步：${nextStep.n} ${nextStep.title}` : undefined) : undefined} />
      <Row label="新觸發" testid="new-triggers" href="#/explore/screener?view=new"
        value={trig ? <Num v={trig.stocks} unit="檔" /> : '—'} sub={trig?.date ? `${md(trig.date)}・${trig.strategies} 個策略` : undefined} />
      <Row label="自選異動" testid="watch-changes-row" onClick={() => setSeg('mine')}
        value={snap === undefined ? '—' : <Num v={sig.length} unit="檔" />} sub={user?.watch.length ? `自選 ${user.watch.length} 檔` : '尚無自選股'} />
      <Row label="領先族群・細產業" testid="leaders-row" href="#/explore/sectors?layer=fine"
        sub={leaders.length ? leaders.map((g) => g.name).join('、') : '資料累積中'}
        value={leaders.length ? <span class="ui-foot ui-muted">3 個月名次</span> : undefined} />
    </>
  );

  const holdings = (
    <Section title="持倉" testid="holdings" aside={user && open.length ? `${open.length} 檔${risky.length ? `・警示 ${risky.length}` : ''}` : undefined}>
      <List tags chev>
        {user && !open.length ? <Row label="無持倉" sub="新增持倉前先完成檢查表" href="#/discipline/checklist" testid="holdings-empty-row" /> : null}
        {risky.map((a) => (
          <Row key={a.trade.id} label={a.row ? <NameCode row={a.row} /> : `${a.trade.name} ${a.trade.code}`}
            sub={a.items.map((i) => i.label).join('・')}
            value={a.row ? <Num v={fmtPrice(a.row.close)} /> : '—'} value2={<Signed v={a.row?.change_pct} kind="arrow" unit="%" />}
            tag={<Tag tone="risk">警示</Tag>}
            onClick={() => openStock(a.trade.code, '持倉', alerts.map((x) => x.trade.code))} />
        ))}
        {calm.length ? (
          <Row label={risky.length ? `其餘 ${calm.length} 檔無警示` : `${calm.length} 檔無警示`} onClick={() => setShowCalm(!showCalm)} noChev expanded={showCalm}
            tag={<span class="ui-row-toggle" aria-hidden="true"><IconChevronDown /></span>} testid="holdings-calm" />
        ) : null}
        {showCalm ? calm.map((a) => a.row ? (
          <Row key={a.trade.id} label={<NameCode row={a.row} />} sub={<>停損 <Num v={fmtPrice(a.trade.stop)} /></>}
            value={<Num v={fmtPrice(a.row.close)} />} value2={<Signed v={a.row.change_pct} kind="arrow" unit="%" />}
            onClick={() => openStock(a.trade.code, '持倉', alerts.map((x) => x.trade.code))} />
        ) : null) : null}
      </List>
    </Section>
  );

  return (
    <div class="page brief-page">
      <TopBar />
      <PageTitle title="盤後簡報" sub={<BriefStatus meta={meta.data ?? null} />} />
      <BriefWarn meta={meta.data ?? null} />
      <DataState phase={index.loading ? 'loading' : index.error ? 'error' : 'ok'} reason="加權指數資料暫時無法取得" onRetry={() => location.reload()}>
        <IndexHero index={index.data ?? null} intraday={intraday.data?.d ?? null} intradayFailed={!!intraday.data?.failed}
          period={period} onPeriod={setPeriod} seen={seen ?? null} isTradingToday={isTradingToday} />
      </DataState>

      <Seg options={SEGS} value={seg} onChange={setSeg} label="簡報分段" sticky testid="brief-seg" />

      {seg === 'overview' ? <Overview market={market.data ?? null} index={index.data ?? null} onSeg={setSeg} rows={overviewRows} /> : null}
      {seg === 'market' ? <MarketPane market={market.data ?? null} index={index.data ?? null} /> : null}
      {seg === 'money' ? <MoneyPane market={market.data ?? null} /> : null}
      {seg === 'mine' ? (
        <div class="seg-pane" data-testid="pane-mine">
          {holdings}
          <Section title="自選異動" testid="watch-changes"
            aside={watchRows.length && snap !== undefined ? watchSum.basis.replace(/^自上次查看（(.+)）以來$/, '較 $1') : undefined}>
            <Conclusion>{snap === undefined ? ' ' : sig.length ? `${sig.length} 檔有顯著變化` : watchRows.length ? '沒有自選股達到異動門檻' : '尚無自選股'}</Conclusion>
            <List tags extra chev>
              {user && !user.watch.length ? <Row label="加入第一檔自選" href="#/search" testid="watch-empty" /> : null}
              {sig.map((c) => (
                <Row key={c.code} label={<NameCode row={c.row} />} sub={watchSub(c.row)} subWide
                  value={<Num v={fmtPrice(c.row.close)} />} tag={<span class="ui-v" data-a="bl"><Signed v={c.row.change_pct} kind="arrow" unit="%" /></span>}
                  extra={<span class="ui-v ui-foot" data-testid="rs-pct">RS <Num v={(c.row.rs_percentile as number | null | undefined) ?? null} digits={0} /></span>}
                  onClick={() => openStock(c.code, '自選異動', changes.map((x) => x.code))} />
              ))}
              {quiet.length ? (
                <Row label={sig.length ? `其餘 ${quiet.length} 檔未達門檻` : `${quiet.length} 檔未達門檻`} onClick={() => setShowQuiet(!showQuiet)} noChev expanded={showQuiet}
                  tag={<span class="ui-row-toggle" aria-hidden="true"><IconChevronDown /></span>} testid="watch-quiet" />
              ) : null}
              {showQuiet ? quiet.map((c) => (
                <Row key={c.code} label={<NameCode row={c.row} />} sub={watchSub(c.row)} subWide
                  value={<Num v={fmtPrice(c.row.close)} />} tag={<span class="ui-v" data-a="bl"><Signed v={c.row.change_pct} kind="arrow" unit="%" /></span>}
                  extra={<span class="ui-v ui-foot">RS <Num v={(c.row.rs_percentile as number | null | undefined) ?? null} digits={0} /></span>}
                  onClick={() => openStock(c.code, '自選異動', changes.map((x) => x.code))} />
              )) : null}
            </List>
          </Section>
          <Section title={<Term id="new_trigger">新觸發</Term>} testid="new-trigger-list" aside={trig?.date ? md(trig.date) : undefined}>
            <Conclusion>{trigCodes.length ? `${trigCodes.length} 檔・${trig?.strategies ?? 0} 個策略` : '今日沒有新觸發'}</Conclusion>
            <List tags chev>
              {trigCodes.slice(0, 20).map((code) => {
                const r = byCode?.get(code);
                return (
                  <Row key={code} label={r ? <NameCode row={r} /> : code} value={r ? <Num v={fmtPrice(r.close)} /> : '—'}
                    tag={<span class="ui-v" data-a="bl"><Signed v={r?.change_pct ?? null} kind="arrow" unit="%" /></span>}
                    onClick={() => openStock(code, '新觸發', trigCodes)} />
                );
              })}
              {trigCodes.length > 20 ? <Row label={`查看全部 ${trigCodes.length} 檔`} href="#/explore/screener?view=new" /> : null}
            </List>
          </Section>
        </div>
      ) : null}
      <div ref={endRef} aria-hidden="true" style={{ height: '1px' }} />
      {summary.error ? <p class="ds-line">自選與持倉資料暫時無法取得</p> : null}
    </div>
  );
}
