/**
 * 個股頁的共用區塊（M3 後）：風險試算、基本面、事件；總覽／動能／籌碼分段在 components/stock/。
 * 只組合共用元件（components/ui.tsx）；數字全部來自 lib/stockFacts.ts（純函式、已測試），這裡不做計算。
 * 公式、門檻、資料來源、方法說明一律放 ⓘ；區塊標題用名詞。
 */
import type { FreshKey } from '../lib/freshness';
import { useState } from 'preact/hooks';
import type { StockHistory } from '../data/types';
import { pastConferences, revenueSummary, upcomingEvents, valuationFacts } from '../lib/stockFacts';
import { riskCalc, stopVsLimitText } from '../lib/riskCalc';
import type { PortfolioSettings } from '../lib/settings';
import type { TradingCalendar } from '../lib/tradingCalendar';
import { fmtNum, fmtPrice, numberFormat } from '../lib/format';
import { Button, Card, CardLabel, EmptyRow, List, Num, Row, Section, Seg, Table, Tag, Signed } from './ui';
import { Conclusion, Interp, Term } from './kit';
import { SeriesChart } from './SeriesChart';
import { NetBars } from './Viz';
import { markOnboard } from '../lib/flowTrack';

type N = number | null;
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const WD = '日一二三四五六';
/** 「10/12（一）」 */
export function mdw(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`;
}
const md = (iso: string | null | undefined) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '—');
const price = (v: N) => <Num v={ok(v) ? fmtPrice(v) : null} />;
const pctPlain = (v: N, digits = 2) => <Signed v={v} digits={digits} unit="%" tone="plain" />;
/** 本益比超過這個倍數＝獲利接近零，不畫在估值圖上（2026-10-09：一個 6,400 倍的極端值把近 3 年壓成貼底的線） */
export const PE_CAP = 500;

/** 風險試算（§5【動能】）：不足一張自動零股、部位佔本金、停損價相對一日跌停價；底部「帶入檢查表」。 */
export function RiskCalcSection({ h, prefs, atr, price: ref }: { h: StockHistory; prefs: PortfolioSettings; atr: N; price: N }) {
  const [k, setK] = useState<'2' | '3'>('2');
  const r = riskCalc({ capital: prefs.capital, riskPct: prefs.riskPct, oddLot: prefs.oddLot, price: ref, atr, k: Number(k), etf: h.industry === 'ETF' });
  const sizeV = r.shares <= 0 ? '—' : r.mode === 'odd' ? <Num v={r.shares} unit="股" /> : <Num v={r.lots} unit="張" />;
  const href = r.ok && r.stop !== null && ref !== null
    ? `#/discipline/checklist?code=${encodeURIComponent(h.code)}&price=${ref}&stop=${Math.round(r.stop * 100) / 100}&shares=${r.shares}`
    : undefined;
  return (
    <Section title="風險試算" testid="risk-calc" info={
      <>
        <p>停損價＝參考價 − k × ATR14。參考價是最新收盤（未還原）；ATR14 以還原價計算後換回最新原始價基準，兩者同一基準。</p>
        <p>股數＝本金 × 每筆風險 % ÷ 每股風險。整張不足 1 張時自動改用零股計算。</p>
        <p>連續跌停：每天以前一日價格 × 0.9 依升降單位進位，假設跌停鎖死賣不掉、停損價無法成交；R＝虧損 ÷ 計畫風險。這是壓力情境，不是預測。</p>
        <p>只呈現計算結果，不是進出建議。</p>
      </>
    }>
      <Seg small options={[['2', '2 倍 ATR'], ['3', '3 倍 ATR']] as const} value={k} onChange={setK} label="ATR 倍數" />
      <List chev>
        <Row label="本金與每筆風險" sub={`本金 ${numberFormat(0).format(prefs.capital)} 元・每筆風險 ${prefs.riskPct}%`} href="#/me/settings" testid="risk-settings" />
      </List>
      {r.stop === null ? <List><EmptyRow>{r.reason ?? '無法計算'}</EmptyRow></List> : (
        <>
          <List testid="risk-rows">
            <Row label="參考價" sub="最新收盤(未還原)" value={price(ref)} />
            <Row label="停損價" sub={`每股風險 ${fmtPrice(r.perShare)}(${k} × ATR ${fmtPrice(r.atr)})`} value={price(r.stop)} />
            <Row label="股數" sub={r.shares > 0 ? (r.mode === 'odd' ? `零股${r.autoOdd ? '(不足 1 張)' : ''}・部位 ${numberFormat(0).format(r.positionValue)} 元` : `${numberFormat(0).format(r.shares)} 股・部位 ${numberFormat(0).format(r.positionValue)} 元`) : (r.reason ?? '')}
              value={sizeV} testid="risk-shares" />
            <Row label="部位佔本金" value={<Num v={r.positionPct} digits={1} unit="%" />} />
            <Row label="一日跌停價" sub={stopVsLimitText(r, fmtPrice)} value={price(r.limitDown1)} testid="risk-limit" />
          </List>
          <Card>
            <CardLabel>連續跌停</CardLabel>
            <Table caption="連續跌停情境" testid="limit-down-table" rowKey={(s) => String(s.days)} rows={r.scenarios} cols={[
              { key: 'd', label: '跌停', width: '3.5rem', render: (s) => `${s.days} 日` },
              { key: 'p', label: '價格', align: 'r', render: (s) => fmtPrice(s.price) },
              { key: 'l', label: '虧損', align: 'r', render: (s) => (r.shares > 0 ? numberFormat(0).format(Math.round(s.loss)) : '—') },
              { key: 'c', label: '佔本金', align: 'r', width: '4.5rem', render: (s) => (r.shares > 0 ? <Num v={s.lossPct} digits={2} unit="%" /> : '—') },
              { key: 'r', label: 'R', align: 'r', width: '3rem', render: (s) => (s.r === null ? '—' : fmtNum(s.r, 1)) },
            ]} />
            <span onClick={() => { if (href) markOnboard('risk_to_checklist'); }}><Button variant="fill" block href={href} disabled={!href} testid="to-checklist">帶入檢查表</Button></span>
          </Card>
        </>
      )}
    </Section>
  );
}

// ================================================================== 基本面
const ymText = (ym: string) => `${ym.slice(0, 4)}/${Number(ym.slice(5, 7))}`;
const sgn = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), d)}%`;

/** 基本面（M3）：營收（年增率柱狀圖 → 近 12 個月表）、季財報表、估值（本益比走勢 → 數值）。每區塊有結論行與解讀行。 */
export function FundamentalPanel({ h, asof }: { h: StockHistory; asof: (d: string | null, key?: FreshKey) => string }) {
  const rev = revenueSummary(h);
  const val = valuationFacts(h);
  const [allRev, setAllRev] = useState(false);
  const quarters = (h.quarters as { period: string; revenue: N; gross_margin: N; eps?: N; roe?: N }[] | undefined) ?? [];
  const revRows = ((h.revenue as { ym: string; revenue: number; yoy: N; mom: N }[] | undefined) ?? []).slice().reverse();
  const yi = (v: N) => (ok(v) ? v / 1e5 : null);
  const n750 = Math.min(756, h.d.length);
  const peRaw = h.pe.slice(-n750).map((v) => (ok(v) && v > 0 ? v : null));
  const peOver = peRaw.filter((v) => v !== null && v > PE_CAP).length;
  const pe = peRaw.map((v) => (v !== null && v > PE_CAP ? null : v));
  const revInterp = rev.latest
    ? [rev.newHigh ? '創 12 個月新高' : null, rev.growthMonths > 0 ? `連續 ${rev.growthMonths} 個月年增` : '最新一月年減', ok(rev.yoy3m) ? `近 3 月平均 ${sgn(rev.yoy3m)}` : null].filter(Boolean).join('，')
    : null;
  return (
    <>
      <Section title="營收" aside={rev.latest ? `${Number(rev.latest.ym.slice(5, 7))} 月` : undefined} testid="sec-revenue" info={
        <><p>月營收年增率＝當月營收 ÷ 去年同月 − 1。創 12 個月新高＝最新一個月營收 ≥ 前 11 個月最大值；連續年增月數＝由最新一個月往回數年增率 &gt; 0 的月數；近 3 月平均年增＝最近 3 個月年增率的平均。月營收法定公布期限為次月 10 日。</p></>
      }>
        {rev.latest ? (
          <Conclusion testid="revenue-concl">{Number(rev.latest.ym.slice(5, 7))} 月 {fmtNum(yi(rev.latest.revenue) ?? 0, 1)}<span class="key-unit"> 億</span>・年增 {ok(rev.latest.yoy) ? sgn(rev.latest.yoy) : '—'}</Conclusion>
        ) : null}
        <Interp>{revInterp}</Interp>
        {rev.last12.length ? (
          <Card>
            <NetBars values={rev.yoy12.map((r) => r.yoy)} dates={rev.yoy12.map((r) => r.ym)} unit="%" height={96}
              format={(v, sign = true) => (v === null || v === undefined ? '—' : `${sign && v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), 1)}%`)}
              words={['年增', '年減']} emphasizeRecent={false} neutral caption={`近 ${rev.yoy12.length} 個月營收年增率`} label={`近 ${rev.yoy12.length} 個月營收年增率柱狀圖`} />
          </Card>
        ) : <List><EmptyRow>沒有月營收資料</EmptyRow></List>}
        {revRows.length ? (
          <div class="ui-card">
            <Table caption="月營收" testid="revenue-table" rowKey={(r) => r.ym} rows={allRev ? revRows : revRows.slice(0, 12)} cols={[
              { key: 'm', label: '月份', render: (r) => ymText(r.ym) },
              { key: 'r', label: '營收(億)', align: 'r', render: (r) => fmtNum(r.revenue / 1e5, 1) },
              { key: 'y', label: <Term id="revenue_yoy">年增</Term>, align: 'r', render: (r) => pctPlain(r.yoy, 1) },
              { key: 'o', label: '月增', align: 'r', render: (r) => pctPlain(r.mom, 1) },
            ]} />
            {revRows.length > 12 ? <Button variant="plain" block onClick={() => setAllRev(!allRev)}>{allRev ? '只看近 12 個月' : `全部 ${revRows.length} 個月`}</Button> : null}
          </div>
        ) : null}
      </Section>
      <Section title="季財報" testid="sec-quarters" aside={quarters.length ? quarters[quarters.length - 1].period : undefined}>
        {quarters.length ? (
          <>
            <Conclusion>{(() => { const q = quarters[quarters.length - 1]; return `${q.period} 毛利率 ${ok(q.gross_margin) ? `${fmtNum(q.gross_margin, 1)}%` : '—'}${ok(q.eps) ? `・EPS ${fmtNum(q.eps, 2)}` : ''}`; })()}</Conclusion>
            <div class="ui-card">
              <Table caption="季財報" testid="quarters-table" rowKey={(r) => r.period} rows={quarters.slice(-8).reverse()} cols={[
                { key: 'p', label: '季', render: (r) => r.period },
                { key: 'r', label: '營收(億)', align: 'r', render: (r) => (ok(r.revenue) ? fmtNum(r.revenue / 1e5, 1) : '—') },
                { key: 'g', label: '毛利率', align: 'r', render: (r) => <Num v={r.gross_margin} digits={1} unit="%" /> },
                { key: 'e', label: 'EPS', align: 'r', render: (r) => <Num v={r.eps ?? null} digits={2} /> },
              ]} />
            </div>
          </>
        ) : <List><EmptyRow>沒有季財報資料</EmptyRow></List>}
      </Section>
      <Section title="估值" aside={asof(val.date, 'valuation')} testid="sec-valuation" info={<p>本益比 3 年百分位＝最新本益比在自身近 756 個交易日（約 3 年）本益比中的百分位（0–100）；本益比 ≤ 0（虧損）不計。淨值比、殖利率為證交所／櫃買中心每日公布值。</p>}>
        <Conclusion>{ok(val.pe) ? <>本益比 {fmtNum(val.pe, 1)}<span class="key-unit"> 倍</span></> : '本益比：虧損或未公布'}</Conclusion>
        <Interp>{ok(val.pePct3y) ? `位於自身近 3 年的第 ${Math.round(val.pePct3y)} 百分位` : null}</Interp>
        {pe.filter((v) => v !== null).length >= 2 ? (
          <>
            {/* 對數軸：本益比是比值，30 → 300 與 3 → 30 是同樣的倍數；線性軸會被少數極端值壓扁 */}
            <SeriesChart dates={h.d.slice(-n750)} axisKey="pe" log height={140} label="近 3 年本益比" testid="pe-chart" format={(v) => fmtNum(v, 1)}
              tickFormat={(v) => fmtNum(v, v >= 10 ? 0 : 1)} dateFormat={(d) => `${d.slice(2, 4)}/${Number(d.slice(5, 7))}`}
              series={[{ id: 'pe', name: '本益比', color: 'var(--d-1)', values: pe, main: true }]} />
            {peOver ? <p class="sc2-note ui-foot ui-muted" data-testid="pe-over">{peOver} 日本益比超過 {PE_CAP} 倍（獲利接近零），未畫出</p> : null}
          </>
        ) : null}
        <List>
          <Row label={<Term id="pe">本益比</Term>} sub={`3 年百分位 ${ok(val.pePct3y) ? Math.round(val.pePct3y) : '—'}`} value={<Num v={val.pe} digits={2} unit="倍" fallback="虧損或未公布" />} />
          <Row label={<Term id="pb">淨值比</Term>} value={<Num v={val.pb} digits={2} unit="倍" />} />
          <Row label={<Term id="dividend_yield">殖利率</Term>} value={<Num v={val.dy} digits={2} unit="%" />} />
        </List>
      </Section>
    </>
  );
}

// ================================================================== 事件
interface Attn { count10: number; count30: number; days: { date: string; reason: string }[]; disposition: { start: string; end: string; interval: string | null; reason: string | null; measure?: string | null }[]; active: { start: string; end: string; interval: string | null } | null }
interface Conf { date: string; time?: string | null; place?: string | null; text: string; host?: string | null }

export function EventsPanel({ h, today, cal }: { h: StockHistory; today: string; cal: TradingCalendar }) {
  const up = upcomingEvents(h, today, cal);
  const attn = h.attn as Attn | null | undefined;
  const fallback = ((h.events as { date: string; type: string; text: string }[] | undefined) ?? []).filter((e) => e.type === '注意' || e.type === '處置');
  const records: { date: string; kind: '注意' | '處置'; text: string }[] = attn
    ? [
        ...attn.days.map((d) => ({ date: d.date, kind: '注意' as const, text: d.reason })),
        ...attn.disposition.map((d) => ({ date: d.start, kind: '處置' as const, text: `${md(d.start)}–${md(d.end)}${d.interval ? `・約每 ${d.interval}撮合` : ''}${d.measure ? `・${d.measure}` : ''}${d.reason ? `・${d.reason}` : ''}` })),
      ].sort((a, b) => b.date.localeCompare(a.date))
    : fallback.map((e) => ({ date: e.date, kind: e.type as '注意' | '處置', text: e.text }));
  const confs = pastConferences(h, today) as Conf[];
  return (
    <>
      <Section title="即將發生" testid="sec-upcoming" info={<p>月營收公布期限＝次月 10 日，遇休市日順延到下一個交易日；除權息含預告；法說會來自公開資訊觀測站；融券最後回補日來自停止融券公告。</p>}>
        <Conclusion>{up.length ? `${mdw(up[0].date)} ${up[0].label}` : '近期沒有排定的事件'}</Conclusion>
        <List tags>
          {up.length ? up.map((e) => (
            <Row key={`${e.kind}${e.date}`} label={e.text} sub={e.overdue ? '期限已過、尚未取得' : undefined} value={mdw(e.date)} tag={<Tag>{e.label}</Tag>} />
          )) : <EmptyRow>無</EmptyRow>}
        </List>
      </Section>
      <Section title="注意／處置紀錄" aside={attn ? `近 10 日 ${attn.count10} 次・近 30 日 ${attn.count30} 次` : undefined} testid="sec-attn"
        info={<p>近 30 個營業日的注意股公告（一天算一次）與近一年的處置期間，只列交易所公告的事實，不預測是否會被處置。</p>}>
        <Conclusion>{attn?.active ? `處置中，到 ${mdw(attn.active.end)}` : attn ? `近 10 日注意 ${attn.count10} 次` : records.length ? `${records.length} 筆紀錄` : '沒有注意或處置紀錄'}</Conclusion>
        <Interp alert={!!attn && (attn.count10 >= 3 || !!attn.active)}>{attn && (attn.count10 >= 3 || attn.active) ? '近 10 個營業日注意 3 次以上或處置中' : null}</Interp>
        <List tags>
          {records.length ? records.map((r, i) => (
            <Row key={`${r.date}${i}`} label={<span class="sk-clamp2">{r.text}</span>} value={md(r.date)} tag={<Tag tone="risk">{r.kind}</Tag>} />
          )) : <EmptyRow>近 30 個營業日無注意、近一年無處置</EmptyRow>}
        </List>
      </Section>
      <Section title="近一年法說會" testid="sec-conf" info={<p>公開資訊觀測站法人說明會一覽；主辦單位由說明文字擷取。</p>}>
        <Conclusion>{confs.length ? `${confs.length} 場，最近 ${mdw(confs[0].date)}` : '近一年沒有法說會紀錄'}</Conclusion>
        <List>
          {confs.length ? confs.map((c) => (
            <Row key={c.date + c.text} label={c.host ?? (c.place || '法說會')} sub={c.text} value={md(c.date)} />
          )) : <EmptyRow>近一年無法說會紀錄</EmptyRow>}
        </List>
      </Section>
    </>
  );
}
