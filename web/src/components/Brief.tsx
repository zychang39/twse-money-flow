/**
 * 盤後簡報（M2）：加權指數主視覺（不放卡片、環境光跟隨當日漲跌）＋分段 總覽｜市場｜資金｜我的。
 * 每個區塊：標題 → 結論行（只放數字與事實）→ 圖形 → 解讀行；說明一律放名詞說明面板。
 */
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { IndexData, IntradayData, MarketData, MarketLight, Meta, TurnoverCell, TurnoverDay } from '../data/types';
import { TAIEX } from '../data/types';
import { Card, List, Num, Row, Section, Seg, Signed, Table, Tag } from './ui';
import { Conclusion, Interp, LevelAxis, MiniLine, StaleNote, SummaryCard, Term } from './kit';
import { BarSeries } from './SeriesChart';
import { HeroChart } from './HeroChart';
import { ASOF_LABEL, type AsofKey } from '../lib/asof';
import { expectedDate, tpeNow } from '../lib/dataStatus';
import { envCounts, envInfo, LIGHT_LABEL } from '../lib/envState';
import { fillForward, intradayWindow, sliceWindow, TONIGHT_PERIODS, type Period, type Window } from '../lib/periods';
import { dataPhase, makeCalendar, type TradingCalendar } from '../lib/tradingCalendar';
import { PAGE_SOURCES, affectedFor } from '../lib/health';
import { fmtNum } from '../lib/format';

const WD = '日一二三四五六';

/** 「10/2（五）」 */
export function mdw(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`;
}

/** 「10/2」 */
export const md = (iso: string | null | undefined): string => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '—');

/** 台北時間的「HH:MM」 */
export function hmTpe(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16);
}

const LAG_KEYS: AsofKey[] = ['quotes', 'insti', 'credit', 'taifex'];

/** 落後的資料集（資料日早於應有日）：「三大法人 10/1」。 */
export function laggingDatasets(meta: Meta, cal: TradingCalendar, now = tpeNow()): string[] {
  const out: string[] = [];
  for (const k of LAG_KEYS) {
    const have = meta.asof?.[k];
    if (!have) continue;
    const want = expectedDate(k, cal, now);
    if (have < want) out.push(`${ASOF_LABEL[k]} ${md(have)}`);
  }
  return out;
}

/** 頁首資料時間（一行）：「休市・資料至 10/2(五)・18:11 更新」。 */
export function BriefStatus({ meta }: { meta: Meta | null }) {
  const cal = useMemo(() => (meta ? makeCalendar(meta.calendar) : null), [meta]);
  if (!meta || !cal) return <span aria-hidden="true">&nbsp;</span>;
  const hm = hmTpe(meta.generated_at);
  const d = meta.market_date;
  const { phase } = d ? dataPhase(d, cal) : { phase: 'ok' as const };
  const failed = affectedFor(PAGE_SOURCES.tonight, meta.sources_affected ?? meta.sources_failed).length;
  return (
    <span class="meta-line" data-testid="brief-status">
      {phase === 'holiday' ? '休市・' : phase === 'pending' ? '今天的資料尚未更新・' : ''}
      <a class="meta-link" href="#/me/data">資料至 {mdw(d)}</a>{hm ? `・${hm} 更新` : ''}{meta.demo ? '・示範資料' : ''}
      {failed ? <>・<a class="meta-alert" href="#/me/health">{failed} 個資料源異常</a></> : null}
    </span>
  );
}

/** 資料落後提示（橘色，可點進資料健康頁）：真的落後超過 2 個交易日，或有資料集未到應有日；沒有就不顯示。 */
export function BriefWarn({ meta }: { meta: Meta | null }) {
  const cal = useMemo(() => (meta ? makeCalendar(meta.calendar) : null), [meta]);
  if (!meta || !cal || !meta.market_date) return null;
  const { phase, lag } = dataPhase(meta.market_date, cal);
  if (phase === 'stale') {
    return <div class="brief-stale" data-testid="brief-lag"><StaleNote lead="資料可能過期">{`收盤行情停在 ${mdw(meta.market_date)}，落後 ${lag} 個交易日`}</StaleNote></div>;
  }
  const warn = laggingDatasets(meta, cal, tpeNow());
  return warn.length ? <div class="brief-stale" data-testid="brief-lag"><StaleNote>{warn.join('・')}</StaleNote></div> : null;
}

// ---------------------------------------------------------------- 加權指數

/** 1D：最近交易日每分鐘（前收虛線）；1W：最近 5 個交易日 5 分鐘；其餘日資料。 */
export function indexWindow(period: Period, index: IndexData | null, intra: IntradayData | null): Window | null {
  if (!index) return null;
  const daily = { dates: index.dates, values: index.series[TAIEX] ?? [] };
  if (period === '1D') {
    const w = intradayWindow(intra, daily);
    return w && intra?.prev_close ? { ...w, base: intra.prev_close } : w;
  }
  if (period === '1W' && intra?.days?.length) {
    const days = intra.days.filter((d) => d.points.length);
    if (days.length) {
      const filled = fillForward(daily.values);
      const w: Window = {
        dates: days.flatMap((d) => d.points.map((p) => `${d.date}T${p.t}`)),
        values: days.flatMap((d) => d.points.map((p) => p.v)),
        truncated: false,
        daily: filled ? { dates: daily.dates, values: filled } : undefined,
      };
      return days[0].prev_close ? { ...w, base: days[0].prev_close } : w;
    }
  }
  return sliceWindow(index.dates, daily.values, period);
}

/** 加權指數當日漲跌（環境光顏色）。 */
export function indexDayChange(index: IndexData | null): number | null {
  const v = fillForward(index?.series[TAIEX] ?? []) ?? [];
  return v.length >= 2 ? v[v.length - 1] - v[v.length - 2] : null;
}

/** 主視覺：加權指數（主數字 56、主走勢圖含 1D／1W、區間膠囊），直接放在背景上。 */
export function IndexHero({ index, intraday, intradayFailed, period, onPeriod, seen, isTradingToday }: {
  index: IndexData | null;
  intraday: IntradayData | null;
  intradayFailed: boolean;
  period: Period;
  onPeriod: (p: Period) => void;
  seen: number | null;
  isTradingToday: boolean;
}) {
  const win = indexWindow(period, index, intraday);
  const intraPeriod = period === '1D' || period === '1W';
  const ohlc = intraday?.ohlc;
  const dayNote = period === '1D' && intraday && !isTradingToday ? md(intraday.date) : null;
  return (
    <div class="hero-plain" data-testid="index-card">
      <HeroChart label={dayNote ? `加權指數・${dayNote}` : '加權指數'} win={win} period={period} onPeriod={onPeriod} seen={seen} area
        format={(v) => fmtNum(v, 2)} periodsLabel="加權指數走勢期間" periods={TONIGHT_PERIODS} heroChange="daily"
        emptyText={intraPeriod && intradayFailed ? '盤中走勢讀取失敗' : intraPeriod ? '分鐘資料累積中' : '資料累積中'} />
      {period === '1D' && ohlc ? (
        <p class="index-ohlc-line" data-testid="index-ohlc">
          開 <Num v={ohlc.o} digits={2} />・高 <Num v={ohlc.h} digits={2} />・低 <Num v={ohlc.l} digits={2} />・收 <Num v={ohlc.c} digits={2} />
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- 計算

function maAt(values: number[], n: number, end: number): number | null {
  if (end + 1 < n) return null;
  let s = 0;
  for (let i = end - n + 1; i <= end; i++) s += values[i];
  return s / n;
}

export interface TrendRow { n: number; ma: number | null; dev: number | null; slope: number | null; slopePrev: number | null }

/** 指數 20／60／240 日均線：均線價、乖離（收盤 ÷ 均線 − 1）、近 10 日斜率與 10 日前的斜率（%）。 */
export function trendRows(index: IndexData | null): { last: number | null; rows: TrendRow[] } {
  const v = fillForward(index?.series[TAIEX] ?? []) ?? [];
  const e = v.length - 1;
  const last = e >= 0 ? v[e] : null;
  const rows = [20, 60, 240].map((n) => {
    const m = maAt(v, n, e), m10 = maAt(v, n, e - 10), m20 = maAt(v, n, e - 20);
    return {
      n, ma: m,
      dev: m && last !== null ? (last / m - 1) * 100 : null,
      slope: m && m10 ? (m / m10 - 1) * 100 : null,
      slopePrev: m10 && m20 ? (m10 / m20 - 1) * 100 : null,
    };
  });
  return { last, rows };
}

/** 燈號數值拆成右欄的短數值與副資訊：pipeline 提供 short／detail 時直接用；舊版以「（」拆開。 */
export function lightParts(l: MarketLight & { short?: string; detail?: string }): { main: string; detail: string | null } {
  // 年月「2026-08」改寫成「2026/08」：數字中的斜線不會被拆行（連字號會）
  const ym = (t: string | null) => (t ? t.replace(/(\d{4})-(\d{2})(?!-)/g, '$1/$2') : t);
  if (l.short) return { main: l.short, detail: ym(l.detail ?? null) };
  const v = l.value || '—';
  const i = v.indexOf('（');
  return i > 0 ? { main: v.slice(0, i), detail: ym(v.slice(i + 1, v.endsWith('）') ? -1 : undefined)) } : { main: v, detail: null };
}

const lightTone = (l: MarketLight) => (l.state === 'red' ? 'risk' : l.state === 'green' ? 'strong' : 'neutral');

/** 「風險 3・有利 1・中性 1」 */
export function envLine(market: MarketData | null): string {
  const lights = market?.env?.lights ?? [];
  return lights.length ? envCounts(envInfo(lights)) : '資料源待處理';
}

const flowTotal = (f: MarketData['flows'][number] | undefined) => (f ? (f.foreign ?? 0) + (f.trust ?? 0) + (f.dealer ?? 0) : null);
const ratio = (c: TurnoverCell | undefined) => (c?.ma20_ratio === null || c?.ma20_ratio === undefined ? null : c.ma20_ratio);
const yi = (v: number) => `${fmtNum(v, 0)} 億`;
const trend10 = (s: number | null, p: number | null) => (s === null || p === null ? '' : s > 0 && s > p ? '加快' : s > 0 ? '放慢' : '');

// ---------------------------------------------------------------- 總覽

export function Overview({ market, index, onSeg, rows }: {
  market: MarketData | null;
  index: IndexData | null;
  onSeg: (s: 'market' | 'money' | 'mine') => void;
  /** 下方的列（今日流程、新觸發、自選異動、領先族群） */
  rows: ComponentChildren;
}) {
  const flow = market?.flows[market.flows.length - 1];
  const turn = market?.turnover?.[market.turnover.length - 1];
  const tot = flowTotal(flow);
  const dchg = indexDayChange(index);
  const v = fillForward(index?.series[TAIEX] ?? []) ?? [];
  const pct = dchg !== null && v.length >= 2 ? (dchg / v[v.length - 2]) * 100 : null;
  return (
    <div class="seg-pane" data-testid="pane-overview">
      <Section title="今日市場">
        <Conclusion testid="overview-conclusion">
          加權 <Signed v={pct} digits={2} unit="%" kind="arrow" />・量 <Num v={ratio(turn?.total)} digits={2} unit="倍" />・法人 <Signed v={tot} digits={0} unit="億" />
        </Conclusion>
        <SummaryCard title="市場環境" conclusion={envLine(market)} onClick={() => onSeg('market')} testid="sum-env"
          interp={<>五項資金指標的判定，點開看每一項的數值與門檻</>} />
        <div class="sum-grid">
          <SummaryCard title="三大法人合計" conclusion={<Signed v={tot} digits={1} unit="億" />} onClick={() => onSeg('money')} testid="sum-flows"
            interp={flow ? `${md(flow.date)}・外資 ${fmtNum(flow.foreign ?? 0, 0)} 億` : '尚未公布'} />
          <SummaryCard title="成交金額" conclusion={turn ? <><Num v={turn.total.value} digits={0} unit="億" /></> : '—'} onClick={() => onSeg('money')} testid="sum-turnover"
            interp={turn ? `20 日平均的 ${fmtNum(ratio(turn.total) ?? 0, 2)} 倍` : undefined} />
        </div>
      </Section>
      <div class="ui-sec">
        <List chev>{rows}</List>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 市場

export function MarketPane({ market, index }: { market: MarketData | null; index: IndexData | null }) {
  const { last, rows } = trendRows(index);
  const above = rows.filter((r) => r.dev !== null && r.dev > 0).map((r) => r.n);
  const b = market?.breadth;
  const bh = market?.breadth_hist;
  const recent = bh ? { v: bh.above_ma60.slice(-60), d: bh.dates.slice(-60) } : null;
  const r20 = rows[0];
  return (
    <div class="seg-pane" data-testid="pane-market">
      <Section title="趨勢" testid="trend-card">
        <Conclusion>{rows.every((r) => r.dev === null) ? '資料累積中' : above.length === 3 ? '站上 20／60／240 日線' : above.length ? `站上 ${above.join('／')} 日線` : '跌破 20／60／240 日線'}</Conclusion>
        <Card>
          <LevelAxis label="加權指數與均線" format={(x) => fmtNum(x, 0)} testid="trend-axis" levels={[
            { name: '240 日', v: rows[2].ma, color: 'var(--c-purple)' },
            { name: '60 日', v: rows[1].ma, color: 'var(--c-indigo)' },
            { name: '20 日', v: rows[0].ma, color: 'var(--c-blue)' },
            { name: '現值', v: last, color: 'var(--text-1)', main: true },
          ]} />
          <Table testid="trend-table" rowKey={(r) => String(r.n)} cols={[
            { key: 'n', label: '均線', width: '22%', render: (r: TrendRow) => <Term id="ma">{`${r.n} 日`}</Term> },
            { key: 'ma', label: '均線價', render: (r) => <Num v={r.ma} digits={0} /> },
            { key: 'dev', label: <Term id="bias">乖離</Term>, render: (r) => <Signed v={r.dev} digits={1} unit="%" tone="plain" /> },
            { key: 'slope', label: <Term id="slope">近 10 日斜率</Term>, width: '30%', render: (r) => <Signed v={r.slope} digits={2} unit="%" tone="plain" /> },
          ]} rows={rows} />
          <Interp>{r20.slope !== null ? `20 日線近 10 日 ${r20.slope > 0 ? '+' : r20.slope < 0 ? '−' : ''}${Math.abs(r20.slope).toFixed(2)}%${r20.slopePrev !== null ? `，10 日前 ${r20.slopePrev > 0 ? '+' : r20.slopePrev < 0 ? '−' : ''}${Math.abs(r20.slopePrev).toFixed(2)}%` : ''}${trend10(r20.slope, r20.slopePrev) ? `，${trend10(r20.slope, r20.slopePrev)}` : ''}` : null}</Interp>
        </Card>
      </Section>
      <Section title="寬度" testid="breadth-card">
        <Conclusion><Term id="breadth">站上 60 日線</Term> <Num v={b?.above_ma60_pct ?? null} digits={1} unit="%" /></Conclusion>
        <Card>
          <div class="breadth-line">
            <MiniLine values={recent?.v} w={320} h={56} base={50} color="var(--c-cyan)" testid="breadth-mini" />
          </div>
          <Interp>{recent && recent.v.length ? `近 60 日介於 ${fmtNum(Math.min(...recent.v.filter((x): x is number => x !== null)), 0)}%～${fmtNum(Math.max(...recent.v.filter((x): x is number => x !== null)), 0)}%（虛線 50%）` : '資料累積中'}</Interp>
          <List>
            <Row label={<Term id="new_high_low">52 週新高 − 新低</Term>} sub={b?.high52 !== undefined && b?.high52 !== null ? <>新高 <Num v={b.high52} /> 家・新低 <Num v={b.low52 ?? null} /> 家</> : '資料不足'}
              value={<Signed v={b?.net52 ?? null} digits={0} unit="家" />} testid="breadth-52w" />
            <Row label="站上 60 日線家數" sub={b?.n_ma60 ? <>共 <Num v={b.n_ma60} /> 檔普通股</> : undefined}
              value={<Num v={b?.above_ma60_pct !== undefined && b?.above_ma60_pct !== null && b?.n_ma60 ? Math.round((b.above_ma60_pct / 100) * b.n_ma60) : null} unit="檔" />} testid="breadth-ma60" />
          </List>
        </Card>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- 資金

export function MoneyPane({ market }: { market: MarketData | null }) {
  const lights = market?.env?.lights ?? [];
  const flows = market?.flows ?? [];
  const flow = flows[flows.length - 1];
  const f20 = flows.slice(-20);
  const sum20 = f20.reduce((s, f) => s + (flowTotal(f) ?? 0), 0);
  return (
    <div class="seg-pane" data-testid="pane-money">
      <Section title="資金指標" testid="env-lights-card">
        <Conclusion><Term id="market_env">{envLine(market)}</Term></Conclusion>
        {lights.length ? (
          <List tags testid="env-lights">
            {lights.map((l) => (
              <Row key={l.id} label={l.label}
                subWide sub={[lightParts(l).detail, l.pct250 !== undefined && l.pct250 !== null ? `近 250 日百分位 ${Math.round(l.pct250)}` : null].filter(Boolean).join('・') || undefined}
                value={lightParts(l).main} tag={<Tag tone={lightTone(l)}>{LIGHT_LABEL[l.state]}</Tag>} />
            ))}
          </List>
        ) : <Card><p class="ds-line">資料源待處理</p></Card>}
      </Section>
      <FlowsSection flows={flows} flow={flow} sum20={sum20} source={market?.flows_source} />
      <TurnoverSection turnover={market?.turnover} />
    </div>
  );
}

function FlowsSection({ flows, flow, sum20, source }: { flows: MarketData['flows']; flow: MarketData['flows'][number] | undefined; sum20: number; source?: string }) {
  const f20 = flows.slice(-20);
  const items = [['外資', flow?.foreign], ['投信', flow?.trust], ['自營商', flow?.dealer]] as const;
  return (
    <Section title={<Term id="insti">三大法人</Term>} aside={flow ? `${md(flow.date)}${flow.est ? '・估' : ''}` : undefined} testid="flows-card"
      info={<><p>上市＋上櫃三大法人買賣超金額（億元）{flow?.est ? '；當日官方金額尚未取得，以淨買賣超張數 × 收盤價估算（標「估」）' : ''}。</p><p>資料來源：{source ?? '證交所、櫃買中心'}。</p></>}>
      <Conclusion>近 20 日合計 <Signed v={f20.length ? sum20 : null} digits={0} unit="億" /></Conclusion>
      <Card>
        <div class="flow-cells">
          {items.map(([k, v]) => (
            <div key={k} class="flow-cell"><span class="metric-l">{k}</span><span class="flow-v" data-a="bl"><Signed v={v ?? null} digits={1} unit="億" label={k} /></span></div>
          ))}
        </div>
        <BarSeries testid="flows-bars" label="近 20 日三大法人合計買賣超（億元）" dates={f20.map((f) => f.date)} signed words={['淨買超', '淨賣超']} unit="億" height={140}
          stacks={[{ id: 'total', name: '合計', color: 'var(--up)', values: f20.map((f) => flowTotal(f)) }]}
          format={(v) => `${fmtNum(v, 0)}`}
          readout={(i) => (
            <>
              <span class="sc2-r-item">合計 <Signed v={flowTotal(f20[i])} digits={1} unit="億" /></span>
              <span class="sc2-r-item">外資 <Signed v={f20[i].foreign ?? null} digits={1} unit="億" /></span>
              <span class="sc2-r-item">投信 <Signed v={f20[i].trust ?? null} digits={1} unit="億" /></span>
              <span class="sc2-r-item">自營商 <Signed v={f20[i].dealer ?? null} digits={1} unit="億" /></span>
              {f20[i].est ? <span class="sc2-r-item">估算</span> : null}
            </>
          )} />
      </Card>
    </Section>
  );
}

function TurnoverSection({ turnover }: { turnover: TurnoverDay[] | undefined }) {
  const [win, setWin] = useState<'20' | '60'>('20');
  if (!turnover?.length) return <Section title="成交金額"><Card><p class="ds-line">資料累積中</p></Card></Section>;
  const last = turnover[turnover.length - 1];
  const n = Number(win);
  const recent = turnover.slice(-n);
  const totals = turnover.map((t) => t.total.value);
  const ma = turnover.map((_, i) => (i >= 19 ? totals.slice(i - 19, i + 1).reduce((s: number, v) => s + (v ?? 0), 0) / 20 : null)).slice(-n);
  return (
    <Section title={<Term id="turnover">成交金額</Term>} aside={md(last.date)} testid="turnover-card">
      <div class="key-line" data-testid="turnover-total">
        <span class="key-v"><Num v={last.total.value} digits={0} /><span class="key-unit">億</span></span>
        <span class="key-v2"><Num v={ratio(last.total)} digits={2} /><span class="key-unit">倍</span></span>
      </div>
      <Interp>是前 20 個交易日平均的 {fmtNum(ratio(last.total) ?? 0, 2)} 倍</Interp>
      <Card>
        <List tags>
          {([['上市', last.twse, 'twse'], ['上櫃', last.tpex, 'tpex']] as const).map(([k, c, id]) => (
            <Row key={id} label={k} value={<Num v={c.value} digits={0} unit="億" />} tag={<span class="ui-v" data-a="bl"><Num v={ratio(c)} digits={2} unit="倍" /></span>} testid={`turnover-${id}`} />
          ))}
        </List>
        <Seg options={[['20', '20 日'], ['60', '60 日']] as const} value={win} onChange={setWin} label="成交金額區間" small testid="turnover-win" />
        <BarSeries testid="turnover-bars" label={`近 ${recent.length} 日成交金額（上市＋上櫃，億元）`} dates={recent.map((t) => t.date)} height={160}
          stacks={[
            { id: 'twse', name: '上市', color: 'var(--c-blue)', values: recent.map((t) => t.twse.value) },
            { id: 'tpex', name: '上櫃', color: 'var(--c-cyan)', values: recent.map((t) => t.tpex.value) },
          ]}
          line={{ name: '20 日均線', color: 'var(--c-purple)', values: ma }}
          format={(v) => fmtNum(v, 0)}
          readout={(i) => (
            <>
              <span class="sc2-r-item">合計 {yi(recent[i].total.value ?? 0)}</span>
              <span class="sc2-r-item"><i style={{ background: 'var(--c-blue)' }} />上市 {yi(recent[i].twse.value ?? 0)}</span>
              <span class="sc2-r-item"><i style={{ background: 'var(--c-cyan)' }} />上櫃 {yi(recent[i].tpex.value ?? 0)}</span>
              <span class="sc2-r-item">倍數 {fmtNum(ratio(recent[i].total) ?? 0, 2)}</span>
            </>
          )} />
      </Card>
    </Section>
  );
}
