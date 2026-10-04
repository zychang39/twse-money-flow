/**
 * 策略庫與策略詳情（M5，2026-10 恢復環境光改版）。依規則產生，非推薦；不提供下單。
 * #/explore/strategies：每列＝名稱＋分級標籤｜相對 0050 與等權的 40 日超額與校正後 t｜近 3 年相對 0050 迷你折線｜今日新觸發檔數。
 *   無效的策略收在摺疊列。
 * #/explore/strategies/:id：名稱＋分級標籤 → 一行結論「0050 +4.19%・t 2.45｜等權 +5.07%・t 3.24｜708 筆」→ 規則一句話（名詞可點）→
 *   分段（?seg=）標的｜績效｜事件研究｜規則，預設「標的」。績效與事件研究頂部有期間與基準篩選列（?p= ?b=）。
 * 數字：strategies.json（分級、判定、健康度、出場規則、樣本）、screen.json（標的）、strategy/{id}.json（期間檢視）。
 */
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { DataState, Interp, MiniLine, Term } from '../components/kit';
import { EmptyRow, List, Num, PageTitle, Row, Section, Seg, Tag, Warn } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { SwingCard } from '../components/SwingCard';
import { GradeTag, JudgeInfo, keepNum } from '../components/StrategyBits';
import { ScreenList } from '../components/ScreenList';
import { signalSub } from '../components/SignalPanel';
import { FilterBar, useStrategyFilter } from '../components/strategy/Filter';
import { JudgeCard, PerfPane } from '../components/strategy/Perf';
import { EventPane, ExitsSection } from '../components/strategy/Event';
import { useAsync, useDb, useSegParam } from '../hooks';
import { loadJson, loadStrategyPack } from '../data/api';
import type { CardBench } from '../data/types';
import { addWatchMany, listStrategies, saveStrategy, uid } from '../db/db';
import { LAB_PREFIX } from '../lib/config';
import { fmtCount, md, pctPlain, pctSigned, tText } from '../lib/format';
import { isListed } from '../lib/status';
import { type ScreenFile, screenItems } from '../lib/screen';
import { type StrategiesFile, type StrategyItem, GRADE_ORDER, gradeOf, groupName, paramRows } from '../lib/strategies';
import '../styles/strategy.css';

export const loadStrategies = () => loadJson<StrategiesFile>('strategies.json');
const loadScreen = () => loadJson<ScreenFile>('screen.json').catch(() => null);

const sigT = (s: StrategyItem) => s.judge?.sig.t ?? s.t_corr ?? -99;
const byGrade = (a: StrategyItem, b: StrategyItem) => GRADE_ORDER[gradeOf(a)] - GRADE_ORDER[gradeOf(b)] || sigT(b) - sigT(a);
const GRADE_SHORT = { valid: '有效', sig_only: '訊號顯著', watch: '觀察中', invalid: '無效' } as const;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 兩個基準的 40 日超額與 t（判定卡，全期間） */
const sides = (s: StrategyItem) => (s.judge ? { opp: s.judge.opp, ew: s.judge.sig } : null);

// ---------------------------------------------------------------- 清單

function ListRow({ s, fresh }: { s: StrategyItem; fresh: number | null }) {
  const sd = sides(s);
  const sp = s.spark?.v ?? null;
  const last = sp?.at(-1);
  return (
    <a class="stl-row" href={`#/explore/strategies/${s.id}`} data-testid={`st-row-${s.id}`}>
      <span class="stl-l">
        <span class="stl-name">{s.label}<GradeTag s={s} /></span>
        <span class="stl-sub">{keepNum(s.subtitle)}</span>
        {sd ? <span class="stl-blks ui-foot">{signalSub(sd as Parameters<typeof signalSub>[0])}</span> : null}
      </span>
      <span class="stl-r">
        {sp && sp.length >= 2 ? (
          <span class="stl-spark" aria-label={`近 3 年相對 0050 ${fin(last) ? `${last > 0 ? '+' : last < 0 ? '−' : ''}${Math.abs(last).toFixed(0)}%` : ''}`} role="img">
            <MiniLine values={sp} base={0} w={64} h={24} color={fin(last) && last >= 0 ? 'var(--up)' : 'var(--down)'} />
          </span>
        ) : null}
        {fresh !== null ? <span class={`stl-new ui-foot ${fresh ? '' : 'ui-muted'}`}>新觸發 {fresh}</span> : null}
      </span>
    </a>
  );
}

function StrategyList({ data }: { data: StrategiesFile }) {
  const [openOff, setOpenOff] = useState(false);
  const screen = useAsync(loadScreen, []);
  const { listed, off } = useMemo(() => {
    const all = [...data.strategies].sort(byGrade);
    return { listed: all.filter((s) => isListed(s)), off: all.filter((s) => !isListed(s)) };
  }, [data.strategies]);
  const fresh = (s: StrategyItem) => {
    const sc = screen.data?.strategies.find((x) => x.id === s.id);
    return sc ? sc.new.length : isListed(s) ? (s.today?.length ?? 0) : null;
  };
  const counts = (['valid', 'sig_only', 'watch'] as const).map((g) => [g, listed.filter((s) => gradeOf(s) === g).length] as const).filter(([, n]) => n > 0);
  return (
    <>
      <PageTitle title="策略庫" sub={`資料至 ${md(data.date)}・依規則產生，非推薦`} />
      <Section title="上架" aside={`${listed.length} 套`} info={<JudgeInfo meta={data.judge_meta} multi={data.multi_test} />} testid="st-sec-listed">
        <Interp><Term id="strategy_grade">分級</Term> {counts.map(([g, n]) => `${GRADE_SHORT[g]} ${n}`).join('・')}；折線＝近 3 年<Term id="portfolio5">5 檔組合</Term><Term id="excess_vs">相對 0050</Term></Interp>
        <div class="ui-list stl-list" data-testid="st-sec-listed-list">
          {listed.length ? listed.map((s) => <ListRow key={s.id} s={s} fresh={fresh(s)} />) : <EmptyRow>無上架策略</EmptyRow>}
        </div>
      </Section>
      <Section title="無效" aside={`${off.length} 套`} testid="st-sec-off">
        <List chev class="st-list">
          <Row label={openOff ? '收合' : `展開 ${off.length} 套`} onClick={() => setOpenOff(!openOff)} testid="st-fold" ariaLabel={openOff ? '收合無效的策略' : '展開無效的策略'} />
        </List>
        {openOff ? <div class="ui-list stl-list" data-testid="st-sec-off-list">{off.map((s) => <ListRow key={s.id} s={s} fresh={null} />)}</div> : null}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- 規則一句話（名詞可點）

const TERM_WORDS: [RegExp, string][] = [
  [/RS(?: 百分位)?/, 'market_percentile'],
  [/量比|量(?= ?≥)/, 'volume_ratio'],
  [/營收年增率|年增率/, 'revenue_yoy'],
  [/投信|外資/, 'insti'],
  [/千張大戶|大戶/, 'whale'],
  [/52 週最高收盤|52 週高點/, 'high_52w'],
  [/乖離/, 'bias'],
  [/20 日均線|20 日線|60 日線|年線/, 'ma'],
  [/融資/, 'margin'],
];

/** 規則一句話：名詞包成可點的說明；數字＋單位不拆行 */
export function ruleText(text: string): ComponentChildren[] {
  const re = new RegExp(TERM_WORDS.map(([r]) => `(${r.source})`).join('|'), 'g');
  const out: ComponentChildren[] = [];
  let last = 0;
  const seen = new Set<string>();
  for (const m of text.matchAll(re)) {
    const k = m.slice(1).findIndex((g) => g !== undefined);
    const id = TERM_WORDS[k][1];
    if (seen.has(id)) continue; // 同一名詞只標第一次
    seen.add(id);
    out.push(...keepNum(text.slice(last, m.index)));
    out.push(<Term key={`t${m.index}`} id={id}>{m[0]}</Term>);
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(...keepNum(text.slice(last)));
  return out;
}

// ---------------------------------------------------------------- 標的

function Targets({ s, data }: { s: StrategyItem; data: StrategiesFile }) {
  const screen = useAsync(loadScreen, []);
  const nNew = useMemo(() => screenItems(screen.data, s.id, 'new').length, [screen.data, s.id]);
  // 第一個螢幕就要看到股票：今日沒有新觸發時預設「篩出」
  const [view, setView] = useSegParam<'new' | 'all'>(['new', 'all'] as const, nNew > 0 || !screen.data ? 'new' : 'all', 'view');
  const has = screen.data?.strategies.some((x) => x.id === s.id) ?? false;
  const items = useMemo(() => screenItems(screen.data, s.id, view), [screen.data, s.id, view]);
  const nAll = useMemo(() => screenItems(screen.data, s.id, 'all').length, [screen.data, s.id]);
  const listed = isListed(s);
  const phase = screen.loading ? 'loading' : 'ok';
  return (
    <>
      {listed && has ? (
        <>
          <Seg options={[['new', `新觸發 ${nNew}`], ['all', `篩出 ${nAll}`]] as const} value={view} onChange={setView} label="新觸發或篩出" small testid="screen-view" />
          <DataState phase={phase} onRetry={() => location.reload()}>
            <Interp>{view === 'new' ? <><Term id="new_trigger">新觸發</Term>＝{md(data.date)} 條件首次成立</> : <><Term id="screened">篩出</Term>＝仍符合條件，或觸發後還在 40 日持有期內</>}</Interp>
            {items.length ? <ScreenList items={items} view={view} context={s.label} showTags={false} />
              : <List><Row label={view === 'new' ? `${md(data.date)} 無新觸發；看「篩出」` : '目前沒有篩出的股票'} onClick={() => setView(view === 'new' ? 'all' : 'new')} testid="today-empty" /></List>}
          </DataState>
        </>
      ) : (
        <List chev={(s.today?.length ?? 0) > 0}>
          {(s.today ?? []).length
            ? (s.today ?? []).map((x) => <Row key={x.code} label={`${x.name} ${x.code}`} href={`#/stock/${x.code}`} />)
            : <EmptyRow testid="today-empty">{listed ? `${md(data.date)} 無新觸發` : '無效的策略不產生篩出清單'}</EmptyRow>}
        </List>
      )}
      <TargetActions s={s} data={data} codes={items.map((i) => i.code)} />
    </>
  );
}

function TargetActions({ s, data, codes }: { s: StrategyItem; data: StrategiesFile; codes: string[] }) {
  const tracked = useDb(() => listStrategies(), []);
  const [msg, setMsg] = useState('');
  const presetId = LAB_PREFIX + s.id;
  const isTracked = (tracked ?? []).some((t) => t.presetId === presetId && t.active);
  if (!isListed(s)) return null;
  return (
    <Section title="更多" testid="st-today">
      <List chev>
        <Row label={isTracked ? '已在訊號追蹤' : '設為訊號追蹤'} sub={`${md(data.date)} 之後的新觸發`} testid="st-track"
          onClick={isTracked ? undefined : async () => {
            await saveStrategy({ id: uid(), presetId, name: s.label, conditions: [], horizon: data.horizon, startAfter: data.date, enabledAt: new Date().toISOString(), active: true });
            setMsg('已設為訊號追蹤');
          }} value={msg || undefined} />
        <Row label="槓桿風險" sub="以 5 檔組合試算回撤" href={`#/explore/leverage?s=${s.id}`} testid="st-leverage" />
        {codes.length ? (
          <Row label="加入自選群組" sub={groupName(s)} onClick={async () => {
            const n = await addWatchMany(codes, groupName(s));
            setMsg(n ? `已加入 ${n} 檔` : '已在群組裡');
          }} />
        ) : null}
      </List>
    </Section>
  );
}

// ---------------------------------------------------------------- 規則

const CHECK_LABEL: Record<string, string> = {
  sig_t: '訊號檢定 t ≥ 3.0',
  opp_excess: '相對 0050 超額 > 0',
  opp_t: '相對 0050 t ≥ 2.0',
  sharpe: '5 檔組合 Sharpe ≥ 同期 0050',
  sample: '樣本期間 ≥ 3 年且去重樣本 ≥ 300 筆',
};

function Rules({ s, data }: { s: StrategyItem; data: StrategiesFile }) {
  const [gatesOpen, setGatesOpen] = useState(false);
  const gm = data.judge_meta?.sample;
  const smp = s.sample;
  const params = paramRows(s.param);
  const revenue = /營收/.test(`${s.definition ?? ''}${s.subtitle}`);
  const g = typeof s.grade === 'object' ? s.grade : null;
  const swing = s.swing?.gates;
  const checks: [string, boolean][] = swing
    ? Object.entries(swing.checks ?? {}).map(([k, v]) => [swing.labels?.[k] ?? k, Boolean(v)])
    : Object.entries(g?.checks ?? {}).map(([k, v]) => [CHECK_LABEL[k] ?? k, Boolean(v)]);
  const passed = checks.filter(([, v]) => v).length;
  return (
    <>
      <Section title="條件與樣本" testid="st-rules">
        <List>
          {params.length ? <Row label="參數" sub={params.map((p) => `${p.label} ${p.value}`).join('・')} testid="st-params" /> : <Row label="參數" value="無（固定條件）" />}
          <Row label="含下市股票" value={smp ? (smp.includes_delisted ? '是' : '否') : '—'} testid="st-delisted" />
          <Row label="股票池" sub="普通股・成交值 ≥ 5,000 萬・股價 ≥ 10 元" value={gm ? <>{fmtCount(gm.universe_stocks)}<span class="ui-unit">檔</span></> : '—'} />
          <Row label="訊號期間" value={s.signal_start ? `${s.signal_start.slice(0, 7)} 起` : '—'} />
          <Row label="去重樣本" value={<>{fmtCount(s.judge?.sig.n ?? s.n ?? 0)}<span class="ui-unit">筆</span></>} />
          <Row label="持有期間下市" value={<>{fmtCount(smp?.delisted_events ?? 0)}<span class="ui-unit">筆</span></>} />
          {revenue ? <Row label="月營收生效" sub="遇休市順延，不提前" value="次月 10 日" /> : null}
          <Row label="交易成本" sub="手續費・證交稅・滑價，來回" value={<Num v={0.79} digits={2} unit="%" />} />
          {checks.length ? <Row label={swing ? '上線門檻' : '分級門檻'} value={`${passed}/${checks.length}`} onClick={() => setGatesOpen(true)} testid="st-gates" /> : null}
          {s.hindsight?.status === 'waiting' ? <Row label="原 31 檔 vs 全市場" sub={`涵蓋率達 ${pctPlain((s.hindsight.threshold ?? 0.9) * 100, 0)} 後計算`} value="—" /> : null}
        </List>
        {s.limited && s.limited_note ? <Warn>{keepNum(s.limited_note)}</Warn> : null}
      </Section>
      <Section title="定義" testid="st-def">
        <div class="ui-card md-body">
          <p class="st-rule">{ruleText(s.subtitle)}</p>
          {s.definition ? <p class="ui-foot ui-muted">{s.definition}</p> : null}
          {s.note ? <p class="ui-foot ui-muted">{s.note}</p> : null}
          <p class="ui-foot ui-muted">{smp?.universe_text ?? gm?.universe_text}</p>
          <p class="ui-foot ui-muted">成本：手續費 0.1425%（買賣各一次、不打折）、證交稅 0.3%、滑價 0.1%（買賣各一次），來回約 0.79%。基準不扣成本。</p>
        </div>
      </Section>
      <Sheet open={gatesOpen} onClose={() => setGatesOpen(false)} title={swing ? '上線門檻' : '分級門檻'}>
        <List testid="gate-list">
          {checks.map(([k, v]) => <Row key={k} label={k} value={v ? '通過' : <Tag tone="risk">未通過</Tag>} />)}
        </List>
        {s.swing ? <SwingCard sw={s.swing} hold={s.swing.hold} /> : null}
        {g?.rule ? <p class="ui-foot ui-muted">{g.rule}</p> : null}
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------- 策略頁

const SEGS = ['t', 'p', 'e', 'r'] as const;
type SegKey = typeof SEGS[number];
const SEG_NAME: Record<SegKey, string> = { t: '標的', p: '績效', e: '事件研究', r: '規則' };

/** 沒有期間檢視檔（無效的策略）：判定卡只有全期間 */
function NoPack({ s, data, seg }: { s: StrategyItem; data: StrategiesFile; seg: 'p' | 'e' }) {
  const j = s.judge;
  const side = (x: { excess: number | null; t: number | null; win?: number | null; n: number } | undefined): CardBench => ({ excess: x?.excess ?? null, t: x?.t ?? null, win: x?.win ?? null, median: null, n: x?.n ?? 0 });
  return (
    <>
      <Interp testid="no-pack">{isListed(s) ? '期間檢視資料讀取失敗；以下為全期間' : '無效的策略只保留全期間判定'}</Interp>
      {seg === 'p' && j ? <JudgeCard s={s} opp={side(j.opp)} sig={side(j.sig)} period="all" /> : null}
      {seg === 'e' ? <ExitsSection s={s} data={data} /> : null}
    </>
  );
}

function Detail({ s, data }: { s: StrategyItem; data: StrategiesFile }) {
  const [seg, setSeg] = useSegParam<SegKey>(SEGS, 't', 'seg');
  const needPack = seg === 'p' || seg === 'e';
  const pack = useAsync(() => (isListed(s) ? loadStrategyPack(s.id).catch(() => null) : Promise.resolve(null)), [s.id]);
  const f = useStrategyFilter(pack.data);
  const sd = sides(s);
  const concl = sd ? (
    <>
      <span class="sig-blk">0050 {pctSigned(sd.opp.excess)}・t {tText(sd.opp.t)}</span>｜<span class="sig-blk">等權 {pctSigned(sd.ew.excess)}・t {tText(sd.ew.t)}</span>｜<span class="sig-blk">{fmtCount(sd.ew.n)} 筆</span>
    </>
  ) : null;
  return (
    <>
      <PageTitle title={s.label} sub={`資料至 ${md(data.date)}・依規則產生，非推薦`} aside={<GradeTag s={s} />} />
      {concl ? <p class="concl st-concl" data-testid="st-concl">{concl}</p> : null}
      <p class="st-rule st-rule-head" data-testid="st-rule">{ruleText(s.subtitle)}</p>
      <Seg options={SEGS.map((k) => [k, SEG_NAME[k]] as const)} value={seg} onChange={setSeg} label="策略分段" sticky testid="st-seg" />
      <div class="st-pane" data-testid={`st-pane-${seg}`}>
        {seg === 't' ? <Targets s={s} data={data} /> : null}
        {seg === 'r' ? <Rules s={s} data={data} /> : null}
        {needPack ? (
          pack.loading ? <DataState phase="loading"><span /></DataState>
            : pack.data ? (
              <>
                <FilterBar pack={pack.data} {...f} />
                {seg === 'p' ? <PerfPane s={s} pack={pack.data} period={f.period} bench={f.bench} />
                  : <EventPane s={s} data={data} pack={pack.data} period={f.period} bench={f.bench} />}
              </>
            ) : <NoPack s={s} data={data} seg={seg} />
        ) : null}
      </div>
    </>
  );
}

export default function Strategies({ id }: { id?: string }) {
  const d = useAsync(loadStrategies, []);
  const s = id ? d.data?.strategies.find((x) => x.id === id) : undefined;
  const phase = d.loading ? 'loading' : d.error ? 'error' : 'ok';
  return (
    <div class="page">
      <TopBar back={id ? '/explore/strategies' : '/explore'} caption={id && s ? s.label : undefined} />
      <DataState phase={phase} reason="策略資料讀取失敗" onRetry={() => location.reload()}>
        {d.data && !id ? <StrategyList data={d.data} /> : null}
        {d.data && id ? (s ? <Detail key={s.id} s={s} data={d.data} /> : <List><EmptyRow>找不到這個策略</EmptyRow></List>) : null}
      </DataState>
    </div>
  );
}
