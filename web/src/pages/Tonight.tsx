/**
 * 今晚：每晚儀式的首頁。依序回答 ①大盤環境能不能積極？②我的持股有沒有出事？③自選股出現了什麼新變化？④我該記錄或檢討什麼？
 * 頁首環境光只代表資金環境燈號（有風險＝琥珀，其餘＝中性灰藍），不使用紅綠。
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Ambient, Block, PageHead, TopBar } from '../components/Chrome';
import { DataStatus, EmptyState, ErrorState, Loading } from '../components/DataStatus';
import { HeroChart } from '../components/HeroChart';
import { AiCard, EnvDetail, FlowsRow } from '../components/Market';
import { RitualPanel } from '../components/Ritual';
import { Sheet } from '../components/Sheet';
import { ChangePill } from '../components/Change';
import { StockMiniRow } from '../components/StockRow';
import { IconChevron, IconChevronDown, IconClipboard, IconStar } from '../components/Icons';
import { useAsync, useHistories, useRestoredState } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { useUser } from '../data/useUser';
import { loadAiSummary, loadIndex, loadMarket } from '../data/api';
import { TAIEX, type StockRow } from '../data/types';
import { logActivityOnce } from '../db/db';
import { envInfo, tonightMood } from '../lib/envState';
import { tonightConclusion } from '../lib/conclusion';
import { diffAll, makeSnapshot, sinceLabel, type Snapshot } from '../lib/changes';
import { holdingAlerts } from '../lib/holdings';
import { levelFor, ritualRings, streaks, totalXp } from '../lib/ritual';
import { TONIGHT_DEFAULT_PERIOD, TONIGHT_PERIODS, sliceWindow, type Period } from '../lib/periods';
import { PAGE_SOURCES } from '../lib/health';
import { baseline, commit, commitHero, heroSeen } from '../lib/seen';
import { setListContext } from '../lib/listContext';
import { todayTpe } from '../lib/dates';
import { fmtNum, fmtPrice } from '../lib/format';
import { navigate } from '../router';

function md(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${'日一二三四五六'[d.getUTCDay()]}）`;
}

export default function Tonight() {
  const summary = useScoredSummary();
  const market = useAsync(loadMarket, []);
  const index = useAsync(loadIndex, []);
  const ai = useAsync(loadAiSummary, []);
  const user = useUser();
  // 每晚都從 3M 開始（盤後簡報的脈絡）；期間只影響走勢圖，主角數字下方固定是「今日」漲跌
  const [period, setPeriod] = useState<Period>(TONIGHT_DEFAULT_PERIOD);
  const [envOpen, setEnvOpen] = useState(false);
  const [showCalm, setShowCalm] = useState(false);
  const [showQuiet, setShowQuiet] = useRestoredState('tonight.showQuiet', false);
  const [snap, setSnap] = useState<Snapshot | null | undefined>(undefined);
  const [seen, setSeen] = useState<number | null | undefined>(undefined);
  const [animate, setAnimate] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { baseline('tonight').then(setSnap); heroSeen('taiex').then(setSeen); }, []);

  const day = summary.data?.date ?? market.data?.date ?? null;
  const env = envInfo(market.data?.env?.lights);
  const byCode = summary.data?.byCode;
  const open = useMemo(() => (user?.trades ?? []).filter((t) => t.status === 'open'), [user]);
  // D-01：持股的停損依個股檔的完整還原事件換算（分割可能發生在很久以前，summary 只有近期事件）
  const holdHist = useHistories(useMemo(() => [...new Set(open.map((t) => t.code))], [open]));
  const alerts = useMemo(() => (byCode ? holdingAlerts(open, byCode, undefined, holdHist) : []), [open, byCode, holdHist]);
  const risky = alerts.filter((a) => a.risk);
  const calm = alerts.filter((a) => !a.risk);
  const holdCodes = new Set(open.map((t) => t.code));
  const watchRows = useMemo(() => (byCode && user ? user.watch.map((w) => byCode.get(w.code)).filter((r): r is StockRow => !!r && !holdCodes.has(r.code)) : []), [byCode, user]);
  const changes = useMemo(() => (snap === undefined ? [] : diffAll(watchRows, snap)), [watchRows, snap]);
  const sig = changes.filter((c) => c.significant);
  const quiet = changes.filter((c) => !c.significant);

  const taiex = index.data ? sliceWindow(index.data.dates, index.data.series[TAIEX] ?? [], period) : null;
  const latestTaiex = index.data ? (index.data.series[TAIEX] ?? []).filter((v) => v !== null).pop() ?? null : null;
  const flow = market.data?.flows[market.data.flows.length - 1];

  const today = todayTpe();
  const ritual = day && user ? ritualRings(day, user.activity, user.trades, today) : null;
  const tradingDays = index.data?.dates ?? [];
  const st = user ? streaks(tradingDays, user.activity) : undefined;
  const lv = user ? levelFor(totalXp(user.activity)) : undefined;

  // 下次開啟時的比較基準
  useEffect(() => {
    if (!summary.data || !user || snap === undefined) return;
    commit('tonight', makeSnapshot(watchRows, summary.data.date));
  }, [summary.data, user, snap]);
  useEffect(() => { if (seen !== undefined) commitHero('taiex', latestTaiex); }, [seen, latestTaiex]);

  // 捲到簡報底部＝看完今晚簡報
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

  // 三環都完成：記錄一次並播放低調的完成動畫
  useEffect(() => {
    if (!ritual?.complete || !day || !user) return;
    if (user.activity.some((a) => a.type === 'ritual_done' && a.day === day)) return;
    logActivityOnce('ritual_done', day).then((added) => added && setAnimate(true));
  }, [ritual?.complete, day, user]);

  const conclusion = tonightConclusion({ holdings: open.length, alerts: risky.length, env: env.state, watchChanges: sig.length, watchCount: user?.watch.length ?? 0 });
  const openStock = (code: string, name: string, codes: string[]) => { setListContext({ name, codes }); navigate(`/stock/${code}`); };
  const envAnswer = !market.data ? '' : env.state === 'conservative'
    ? `資金環境偏保守：${env.red.length} 項指標亮起風險`
    : env.state === 'aggressive' ? `資金面有利：${env.green.length} 項指標有利` : env.state === 'neutral' ? '資金環境中性，沒有指標亮起風險' : '資金指標資料不足';

  return (
    <div class="page">
      <Ambient mood={tonightMood(env.state)} />
      <TopBar caption={day ? `${md(day)}盤後簡報` : '盤後簡報'} />
      <PageHead twoLine title={summary.data && market.data && user ? conclusion : '今晚的盤後簡報'}>
        <div class="row" style={{ marginTop: 'var(--s-4)' }}>
          <button class="env-pill" onClick={() => setEnvOpen(true)} aria-haspopup="dialog" disabled={!market.data}>
            <span class={`env-dot ${env.state}`} aria-hidden="true" />
            <span class="w6">資金環境：{market.data ? env.label : '—'}</span>
            <span class="muted">{env.counts}</span>
          </button>
        </div>
        <DataStatus date={day} uses={PAGE_SOURCES.tonight} />
      </PageHead>

      <Block question="大盤環境能不能積極？" answer={envAnswer}>
        {market.error ? <ErrorState error={market.error} /> : null}
        <div class="block-body">
          {index.data ? (
            <HeroChart label="加權指數" win={taiex} period={period} onPeriod={setPeriod} seen={seen ?? null}
              format={(v) => fmtNum(v, 2)} periodsLabel="加權指數走勢期間" periods={TONIGHT_PERIODS} heroChange="daily" />
          ) : index.loading ? <Loading hero /> : null}
          <FlowsRow flow={flow} />
          {market.data ? (
            <button class="card row between" onClick={() => setEnvOpen(true)} style={{ marginTop: 'var(--s-4)' }}>
              <span>
                <span class="body" style={{ display: 'block' }}>{market.data.env?.lights.length ?? 0} 項資金指標</span>
                <span class="caption muted">{(market.data.env?.lights ?? []).map((l) => `${l.label.replace(/（.*?）/, '')}${l.state === 'red' ? '（風險）' : ''}`).join('・')}</span>
              </span>
              <span class="brand" style={{ width: '1.25rem', display: 'inline-flex' }}><IconChevron /></span>
            </button>
          ) : null}
          {ai.data && ai.data.date === market.data?.date ? <AiCard ai={ai.data} /> : null}
        </div>
      </Block>

      <Block question="我的持股有沒有出事？" answer={!user ? '' : !open.length ? '還沒有持倉' : risky.length ? `${risky.length} 檔需要注意` : '沒有需要注意的持股'}>
        <div class="block-body">
          {user && !open.length ? (
            <EmptyState icon={<IconClipboard />} title="建立第一筆持倉" text="先完成新增持倉前檢查表（市場、趨勢、營收、估值、停損與目標），持股出狀況時這裡會提醒你。"
              action={<a class="btn primary" href="#/discipline/checklist">開始新增持倉前檢查表</a>} />
          ) : null}
          {risky.map((a) => (
            <a key={a.trade.id} class="card" href={`#/stock/${a.trade.code}`} onClick={() => setListContext({ name: '持股', codes: alerts.map((x) => x.trade.code) })}>
              <div class="row between"><span><span class="body w6">{a.trade.name}</span> <span class="caption muted">{a.trade.code}</span></span><span class="body w5">{fmtPrice(a.row?.close)}</span></div>
              <div class="row between wrap" style={{ marginTop: 'var(--s-1)' }}>
                <span class="row wrap" style={{ gap: 'var(--s-1)' }}>{a.items.map((i) => <span key={i.label} class="tag risk">{i.label}</span>)}</span>
                <ChangePill change={a.row?.change} pct={a.row?.change_pct} />
              </div>
              {a.items[0]?.detail ? <p class="caption muted" style={{ marginTop: 'var(--s-3)' }}>{a.items.map((i) => i.detail).filter(Boolean).join(' ')}</p> : null}
            </a>
          ))}
          {calm.length ? (
            <>
              <button class="collapsed-row" aria-expanded={showCalm} onClick={() => setShowCalm(!showCalm)}>
                <span>{risky.length ? `其他 ${calm.length} 檔持股沒有需要注意的事` : `${calm.length} 檔持股都沒有需要注意的事`}</span><IconChevronDown />
              </button>
              {showCalm ? calm.map((a) => a.row ? <StockMiniRow key={a.trade.id} row={a.row} text={`停損 ${fmtPrice(a.trade.stop)}・目標 ${fmtPrice(a.trade.target)}`} onOpen={() => openStock(a.trade.code, '持股', alerts.map((x) => x.trade.code))} /> : null) : null}
            </>
          ) : null}
        </div>
      </Block>

      <Block question="自選股出現了什麼新變化？" answer={!user ? '' : !watchRows.length ? '還沒有自選股' : sig.length ? `${sig.length} 檔有顯著變化` : '沒有顯著變化'}>
        {watchRows.length ? <p class="caption muted">{sinceLabel(snap ?? null)}；門檻見設定。</p> : null}
        <div class="block-body stock-list">
          {user && !user.watch.length ? (
            <EmptyState icon={<IconStar />} title="加入想追蹤的股票" text="可以先加入範例自選，或從依規則產生的「熱門動能」挑幾檔；每晚只列出有顯著變化的。"
              action={<a class="btn primary" href="#/mine">開始加入自選</a>} />
          ) : null}
          {sig.map((c) => <StockMiniRow key={c.code} row={c.row} text={c.reasons.slice(0, 2).map((r) => r.text).join('、')} onOpen={() => openStock(c.code, '自選的新變化', changes.map((x) => x.code))} />)}
          {quiet.length ? (
            <>
              <button class="collapsed-row" aria-expanded={showQuiet} onClick={() => setShowQuiet(!showQuiet)}>
                <span>{sig.length ? `另外 ${quiet.length} 檔變化低於門檻` : `${quiet.length} 檔自選股的變化都低於門檻`}</span><IconChevronDown />
              </button>
              {showQuiet ? quiet.map((c) => <StockMiniRow key={c.code} row={c.row} text="變化低於門檻" onOpen={() => openStock(c.code, '自選', changes.map((x) => x.code))} />) : null}
            </>
          ) : null}
        </div>
        <div ref={endRef} aria-hidden="true" style={{ height: '1px' }} />
      </Block>

      <Block question="我該記錄或檢討什麼？" answer={ritual ? (ritual.complete ? '今晚的紀律已完成' : `今晚的紀律：還差 ${ritual.rings.filter((r) => !r.done).length} 項`) : ''}>
        <div class="block-body">
          {ritual && user ? (
            <RitualPanel rings={ritual.rings} complete={ritual.complete} animate={animate} gamification={user.gamification}
              streak={user.gamification ? st : undefined} level={user.gamification ? lv : undefined} />
          ) : <Loading />}
        </div>
      </Block>

      {summary.error ? <ErrorState error={summary.error} /> : null}

      <Sheet open={envOpen} onClose={() => setEnvOpen(false)} title="資金環境燈號">
        {market.data ? <EnvDetail market={market.data} /> : null}
        <a class="btn block" href="#/explore/market" style={{ marginTop: 'var(--s-6)' }}>查看市場溫度與法人金額</a>
      </Sheet>
    </div>
  );
}
