/**
 * 盤後簡報（2026-10 改版 §4）的區塊：狀態列、加權指數、市場環境、三大法人、成交金額。
 * 只用共用元件（components/ui.tsx）；說明、門檻、資料來源一律放 ⓘ。
 */
import { useMemo } from 'preact/hooks';
import type { IndexData, IntradayData, MarketData, MarketLight, Meta, TurnoverCell, TurnoverDay } from '../data/types';
import { TAIEX } from '../data/types';
import { Card, CardLabel, EmptyRow, List, Num, Row, Section, Signed, StatGrid, Tag, Warn } from './ui';
import { HeroChart } from './HeroChart';
import { ASOF_LABEL, type AsofKey } from '../lib/asof';
import { expectedDate, tpeNow } from '../lib/dataStatus';
import { envConclusion, envCounts, envInfo, LIGHT_LABEL, type EnvValidation } from '../lib/envState';
import { fillForward, intradayWindow, sliceWindow, TONIGHT_PERIODS, type Period, type Window } from '../lib/periods';
import { dataPhase, makeCalendar, type TradingCalendar } from '../lib/tradingCalendar';
import { PAGE_SOURCES, affectedFor } from '../lib/health';
import { fmtNum } from '../lib/format';

const WD = '日一二三四五六';

/** 「10/2（五）」 */
export function mdw(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WD[d.getUTCDay()]}）`;
}

/** 台北時間的「HH:MM」 */
export function hmTpe(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16);
}

const LAG_KEYS: AsofKey[] = ['quotes', 'insti', 'credit', 'taifex'];

/** 落後的資料集（資料日早於應有日）：「三大法人至 10/1」。 */
export function laggingDatasets(meta: Meta, cal: TradingCalendar, now = tpeNow()): string[] {
  const out: string[] = [];
  for (const k of LAG_KEYS) {
    const have = meta.asof?.[k];
    if (!have) continue;
    const want = expectedDate(k, cal, now);
    if (have < want) out.push(`${ASOF_LABEL[k]}至 ${mdw(have)}`);
  }
  return out;
}

/**
 * 狀態列（單行 Footnote）：「休市・資料至 10/2（五）・18:11 更新」；交易日尚未更新時「今天的資料尚未更新・…」。
 * 只有資料集落後（或真的落後超過 2 個交易日、本頁用到的資料源異常）時多一行橘色警示。
 */
export function BriefStatus({ meta }: { meta: Meta | null }) {
  const cal = useMemo(() => (meta ? makeCalendar(meta.calendar) : null), [meta]);
  if (!meta || !cal) return <p class="ui-foot ui-muted meta-line" aria-hidden="true">&nbsp;</p>;
  const hm = hmTpe(meta.generated_at);
  const d = meta.market_date;
  const { phase } = d ? dataPhase(d, cal) : { phase: 'ok' as const };
  const failed = affectedFor(PAGE_SOURCES.tonight, meta.sources_affected ?? meta.sources_failed).length;
  return (
    <>
      <p class="ui-foot ui-muted meta-line" data-testid="brief-status">
        {phase === 'holiday' ? '休市・' : phase === 'pending' ? '今天的資料尚未更新・' : ''}
        <a class="meta-link" href="#/me/data">資料至 {mdw(d)}</a>{hm ? `・${hm} 更新` : ''}{meta.demo ? '・示範資料' : ''}
        {failed ? <>・<a class="meta-alert" href="#/me/health">{failed} 個資料源異常</a></> : null}
      </p>
    </>
  );
}

/** 狀態列下方的一行橘色警示：真的落後超過 2 個交易日，或有資料集未到應有日；沒有就不顯示。 */
export function BriefWarn({ meta }: { meta: Meta | null }) {
  const cal = useMemo(() => (meta ? makeCalendar(meta.calendar) : null), [meta]);
  if (!meta || !cal || !meta.market_date) return null;
  const { phase, lag } = dataPhase(meta.market_date, cal);
  const warn = phase === 'stale' ? [`資料可能過期：落後 ${lag} 個交易日`] : laggingDatasets(meta, cal, tpeNow());
  return warn.length ? <Warn testid="brief-lag">{warn.join('・')}</Warn> : null;
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

export function IndexCard({ index, intraday, intradayFailed, period, onPeriod, seen, isTradingToday }: {
  index: IndexData | null;
  intraday: IntradayData | null;
  /** intraday.json 讀取失敗（不是休市） */
  intradayFailed: boolean;
  period: Period;
  onPeriod: (p: Period) => void;
  seen: number | null;
  isTradingToday: boolean;
}) {
  const win = indexWindow(period, index, intraday);
  const intraPeriod = period === '1D' || period === '1W';
  const ohlc = intraday?.ohlc;
  // 1D 在休市日（或盤中走勢不是今天）標日期；只有抓取失敗才顯示單行空狀態
  const dayNote = period === '1D' && intraday && !isTradingToday ? mdw(intraday.date) : null;
  return (
    <Card testid="index-card">
      <HeroChart label={dayNote ? `加權指數・${dayNote}` : '加權指數'} win={win} period={period} onPeriod={onPeriod} seen={seen}
        format={(v) => fmtNum(v, 2)} periodsLabel="加權指數走勢期間" periods={TONIGHT_PERIODS} heroChange="daily"
        emptyText={intraPeriod && intradayFailed ? '盤中走勢讀取失敗' : '資料累積中'} />
      {period === '1D' && ohlc ? (
        <div class="index-ohlc">
          <StatGrid cols={4} testid="index-ohlc" items={[
            { label: '開', value: <Num v={ohlc.o} digits={2} /> },
            { label: '高', value: <Num v={ohlc.h} digits={2} /> },
            { label: '低', value: <Num v={ohlc.l} digits={2} /> },
            { label: '收', value: <Num v={ohlc.c} digits={2} /> },
          ]} />
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------- 市場環境

function ma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i];
  return s / n;
}

/** 指數相對 20／60／240 日均線（收盤 ÷ 均線 − 1，%）。 */
export function trendRows(index: IndexData | null): { n: number; ma: number | null; dev: number | null }[] {
  const v = fillForward(index?.series[TAIEX] ?? []) ?? [];
  const last = v.length ? v[v.length - 1] : null;
  return [20, 60, 240].map((n) => {
    const m = ma(v, n);
    return { n, ma: m, dev: m && last !== null ? (last / m - 1) * 100 : null };
  });
}

/** 燈號數值拆成右欄的短數值與副資訊：pipeline 提供 short／detail 時直接用；舊版以「（」拆開。 */
export function lightParts(l: MarketLight & { short?: string; detail?: string }): { main: string; detail: string | null } {
  if (l.short) return { main: l.short, detail: l.detail ?? null };
  const v = l.value || '—';
  const i = v.indexOf('（');
  return i > 0 ? { main: v.slice(0, i), detail: v.slice(i + 1, v.endsWith('）') ? -1 : undefined) } : { main: v, detail: null };
}

const tone = (l: MarketLight) => (l.state === 'red' ? 'risk' : l.state === 'green' ? 'strong' : 'neutral');

export function EnvCard({ market, index }: { market: MarketData | null; index: IndexData | null }) {
  const lights = market?.env?.lights ?? [];
  const env = envInfo(lights);
  const validation = (market?.env?.validation ?? null) as EnvValidation | null;
  const conclusion = envConclusion(env, validation);
  const b = market?.breadth;
  const trend = trendRows(index);
  const info = (
    <>
      <p>趨勢：加權指數收盤相對 20、60、240 日均線的乖離（收盤 ÷ 均線 − 1）。</p>
      <p>寬度：上市櫃普通股中，收盤站上 60 日均線的比例（還原價）；52 週新高／新低＝收盤創近 250 個交易日最高／最低的家數。</p>
      <p>資金指標門檻：</p>
      <ul>{lights.map((l) => <li key={l.id}>{l.label}：{l.basis || '未定義'}</li>)}</ul>
      <p>燈號：任一項「風險」計入風險；「有利」「中性」同理。外資期貨淨未平倉另列近 250 個交易日的百分位。</p>
      {validation ? <EnvValidationNote v={validation} /> : <p>回測驗證：資料尚未產生，因此只列計數、不下環境結論。</p>}
      <p>資料來源：證交所、櫃買中心、期交所、中央銀行、美國財政部。</p>
    </>
  );
  return (
    <Section title="市場環境" info={info} infoTitle="市場環境的計算方式" aside={market ? `${envCounts(env)}${conclusion ? ` → ${conclusion}` : ''}` : undefined} testid="env-card">
      <Card>
        <CardLabel>趨勢</CardLabel>
        <List tags>
          {trend.map((t) => (
            <Row key={t.n} label={`${t.n} 日均線`} sub={t.ma !== null ? <>均線 <Num v={t.ma} digits={0} /></> : '資料不足'}
              value={<Signed v={t.dev} digits={1} unit="%" tone="plain" />} />
          ))}
        </List>
        <CardLabel>寬度</CardLabel>
        <List tags>
          <Row label="站上 60 日均線" sub={b?.n_ma60 ? <><Num v={b.n_ma60} /> 檔中</> : undefined}
            value={<Num v={b?.above_ma60_pct ?? null} digits={1} unit="%" />} testid="breadth-ma60" />
          <Row label="52 週新高 − 新低" sub={b?.high52 !== undefined && b?.high52 !== null ? <>新高 <Num v={b.high52} />・新低 <Num v={b.low52 ?? null} /></> : '資料不足'}
            value={<Signed v={b?.net52 ?? null} digits={0} tone="plain" />} testid="breadth-52w" />
        </List>
        <CardLabel>資金指標</CardLabel>
        {lights.length ? (
          <List tags testid="env-lights">
            {lights.map((l) => (
              <Row key={l.id} label={l.label}
                sub={[lightParts(l).detail, l.pct250 !== undefined && l.pct250 !== null ? `近 250 日百分位 ${Math.round(l.pct250)}` : null].filter(Boolean).join('・') || undefined}
                value={lightParts(l).main} tag={<Tag tone={tone(l)}>{LIGHT_LABEL[l.state]}</Tag>} />
            ))}
          </List>
        ) : <EmptyRow>資料源待處理</EmptyRow>}
      </Card>
    </Section>
  );
}

const STATE_NAME = { conservative: '保守', neutral: '中性', aggressive: '積極' } as const;

function EnvValidationNote({ v }: { v: EnvValidation }) {
  const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(2)}%`);
  const t = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(2));
  return (
    <>
      <p>回測驗證（{v.period[0]}～{v.period[1]}，{fmtNum(v.days, 0)} 個交易日；以當日收盤的燈號狀態，計算之後 20、40 個交易日加權報酬指數的報酬）：</p>
      <ul>
        {v.states.map((s) => (
          <li key={s.state}>{STATE_NAME[s.state]}：占 {(s.share * 100).toFixed(1)}%；20 日 {pct(s.r20.mean)}（t {t(s.r20.t)}）；40 日 {pct(s.r40.mean)}（t {t(s.r40.t)}）</li>
        ))}
      </ul>
      <p>{v.show_conclusion ? '各狀態之後的報酬有顯著差異，因此顯示環境結論。' : `不顯示環境結論：${v.reason}`}</p>
    </>
  );
}

// ---------------------------------------------------------------- 三大法人

export function FlowsCard({ flow, source }: { flow: MarketData['flows'][number] | undefined; source?: string }) {
  const items = [['外資', flow?.foreign], ['投信', flow?.trust], ['自營商', flow?.dealer]] as const;
  const none = !flow || items.every(([, v]) => v === null || v === undefined);
  return (
    <Section title="三大法人" aside={flow ? `${mdw(flow.date)}${flow.est ? '・估' : ''}` : undefined} testid="flows-card"
      info={<><p>上市＋上櫃三大法人買賣超金額（億元）{flow?.est ? '；當日官方金額尚未取得，以淨買賣超張數 × 收盤價估算（標「估」）' : ''}。</p><p>資料來源：{source ?? '證交所「三大法人買賣金額統計表」、櫃買中心「三大法人買賣金額彙總表」'}。</p></>}>
      <Card>
        {none ? <EmptyRow>{flow ? `${mdw(flow.date)} 法人資料尚未公布` : '法人資料尚未取得'}</EmptyRow> : (
          <StatGrid cols={3} items={items.map(([k, v]) => ({ label: k, value: <Signed v={v ?? null} digits={1} unit="億" label={k} /> }))} />
        )}
      </Card>
    </Section>
  );
}

// ---------------------------------------------------------------- 成交金額

const ratioText = (c: TurnoverCell) => (c.ma20_ratio === null || c.ma20_ratio === undefined ? '—' : `${c.ma20_ratio.toFixed(2)}×`);

/** 長條圖：當日柱主文字色、其餘灰；底部首末日期。 */
export function Bars({ values, dates, label, height = 64 }: { values: (number | null)[]; dates: string[]; label: string; height?: number }) {
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  const n = values.length;
  return (
    <figure class="ui-bars" role="img" aria-label={label}>
      <svg viewBox={`0 0 ${n * 10} ${height}`} preserveAspectRatio="none" style={{ height: `${height}px` }}>
        {values.map((v, i) => {
          const h = max ? ((v ?? 0) / max) * height : 0;
          return <rect key={i} x={i * 10 + 1.5} width={7} y={height - h} height={h} rx={1} fill={i === n - 1 ? 'var(--text-1)' : 'var(--chart-bar)'} />;
        })}
      </svg>
      <figcaption class="ui-bars-axis ui-cap ui-muted"><span>{dates[0]?.slice(5).replace('-', '/')}</span><span>{dates[n - 1]?.slice(5).replace('-', '/')}</span></figcaption>
    </figure>
  );
}

export function TurnoverCard({ turnover }: { turnover: TurnoverDay[] | undefined }) {
  if (!turnover?.length) return null;
  const last = turnover[turnover.length - 1];
  const recent = turnover.slice(-20);
  return (
    <Section title="成交金額" aside={mdw(last.date)} testid="turnover-card"
      info={<p>上市、上櫃當日成交金額（億元）；倍數＝當日 ÷ 前 20 個交易日平均（不含當日）。長條圖為上市＋上櫃合計，近 {recent.length} 個交易日。資料來源：證交所、櫃買中心。</p>}>
      <Card>
        <List tags>
          {([['上市', last.twse, 'twse'], ['上櫃', last.tpex, 'tpex']] as const).map(([k, c, id]) => (
            <Row key={id} label={k} value={<Num v={c.value} unit="億" />} tag={<span class="ui-v" data-a="bl">{ratioText(c)}</span>} testid={`turnover-${id}`} />
          ))}
        </List>
        <Bars values={recent.map((t) => t.total.value)} dates={recent.map((t) => t.date)} label={`近 ${recent.length} 日成交金額（上市＋上櫃）`} />
      </Card>
    </Section>
  );
}
