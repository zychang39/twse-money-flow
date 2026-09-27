/**
 * 法人買賣超報表（#/stock/:code/institutional）：近 1／2／3 個月逐日的買張、賣張、買賣超（張）。
 * - 上方「區間合計」一次列出外資、投信、自營商、三大法人（點一列切換）；Tab 切換下方的走勢圖與逐日明細。
 * - 走勢圖為共用日期軸的小倍數圖：收盤價、買張與賣張、每日買賣超、累計買賣超（各自一個 y 軸，不做雙軸）。
 * - 八大行庫：官方分點資料需要驗證碼，標示「資料源待處理」並說明原因與可手動查詢的地方。
 * 定義見 METHODOLOGY §4.7.2；設計紀錄見 docs/design/ROUND3.md。
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Banner } from '../components/DataStatus';
import { DaySheet, MoreMenu, mdLabel } from '../components/Chips';
import { type ChartPanel, StackedChart } from '../components/StackedChart';
import { StockToolFrame, useStock } from '../components/StockTool';
import { IconCloudOff } from '../components/Icons';
import { type ChipBlock, type ChipRow, chipRows, dayText, spokenDate } from '../lib/chips';
import {
  DAYS_PER_MONTH,
  MONTHS,
  type Months,
  PARTIES,
  PARTY_NAME,
  type Party,
  type ReportRow,
  buySellSince,
  headline,
  lotsText,
  partyFlow,
  partyTotal,
  reportCsv,
  reportRows,
  reportSentence,
  signedLots,
} from '../lib/institutional';
import { arrow, direction, fmtPrice, numberFormat } from '../lib/format';
import '../styles/tools.css';

type Tab = Party | 'banks';
const TABS: Tab[] = [...PARTIES, 'banks'];
const TAB_NAME: Record<Tab, string> = { ...PARTY_NAME, banks: '八大行庫' };

const INT = numberFormat(0);
/** 座標軸：≥ 1 萬寫成「1.2萬」 */
function axisLots(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1e4 ? `${Number((a / 1e4).toFixed(a >= 1e5 ? 0 : 1))}萬` : INT.format(Math.round(a));
  return v < 0 && s !== '0' ? `−${s}` : s;
}

/** 日期下方的小字：「548.0 ▼1.3%」（漲跌取 1 位小數，窄欄也放得下） */
function priceSub(r: ReportRow): { price: string; chg: string; dir: string } {
  return { price: fmtPrice(r.close), chg: r.chgPct === null ? '' : `${arrow(r.chgPct)}${Math.abs(r.chgPct).toFixed(1)}%`, dir: direction(r.chgPct) };
}

function Num({ v, signed }: { v: number | null; signed?: boolean }) {
  if (signed) {
    const t = signedLots(v);
    return <span class={`num ${t.dir}`}>{t.text}</span>;
  }
  return <span class="num">{v === null ? '—' : lotsText(v)}</span>;
}

/**
 * 表格放不下（窄螢幕或字級放大）時先拿掉「累計」欄（走勢圖仍有累計）：
 * 每次內容或寬度改變先試完整版面，渲染後若有儲存格被裁切就改為精簡版面。
 */
function useTableFits(ref: { current: HTMLElement | null }, deps: unknown[]): boolean {
  const [fits, setFits] = useState(true);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref.current]);
  useLayoutEffect(() => { setFits(true); }, [width, ...deps]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !fits) return;
    const clipped = [...el.querySelectorAll<HTMLElement>('th, td, .cd-sub')].some((c) => c.scrollWidth > c.clientWidth + 0.5);
    if (clipped) setFits(false);
  });
  return fits;
}

export default function Institutional({ code }: { code: string }) {
  const s = useStock(code);
  const h = s.data;
  const block = (h?.chip as ChipBlock | null | undefined) ?? null;
  const [tab, setTab] = useState<Tab>('foreign');
  const [months, setMonths] = useState<Months>(3);
  const [day, setDay] = useState<ChipRow | null>(null);
  const [status, setStatus] = useState('');
  const tableRef = useRef<HTMLDivElement>(null);
  const sumRef = useRef<HTMLElement>(null);

  const available = block ? block.d.length - 1 : 0;
  const days = Math.min(available, months * DAYS_PER_MONTH);
  const party: Party = tab === 'banks' ? 'total' : tab;
  const byParty = useMemo(() => (block ? Object.fromEntries(PARTIES.map((p) => [p, reportRows(block, p, days)])) as Record<Party, ReportRow[]> : null), [block, days]);
  const rows = byParty?.[party] ?? [];
  const chipAll = useMemo(() => (block ? chipRows(block) : []), [block]);
  const total = partyTotal(rows, party);
  const since = buySellSince(rows);
  const fits = useTableFits(tableRef, [party, days, !!block]);
  const sumFits = useTableFits(sumRef, [days, !!block, tab === 'banks']);
  const sinceAll = byParty ? buySellSince(byParty.total) : null;

  const title = !block ? '每日法人資料累積中'
    : tab === 'banks' ? '八大行庫：資料源待處理'
    : total.net === null ? `${PARTY_NAME[party]}沒有買賣超資料`
    : `${PARTY_NAME[party]}近 ${rows.length} 日${Math.round(total.net) === 0 ? '買賣超持平' : `${total.net > 0 ? '買超' : '賣超'} ${lotsText(Math.abs(total.net))} 張`}`;

  const panels: ChartPanel[] = [];
  if (rows.length) {
    panels.push({ id: 'close', title: '收盤價（元）', kind: 'lines', height: 64, series: [{ key: 'close', label: '收盤', values: rows.map((r) => r.close) }], format: (v) => numberFormat(Number.isInteger(v) ? 0 : 1).format(v), tipFormat: (v) => `${fmtPrice(v)} 元` });
    if (since) {
      panels.push({
        id: 'bs', title: '買張與賣張（張）', kind: 'lines', height: 88,
        series: [{ key: 'buy', label: '買張', values: rows.map((r) => r.buy) }, { key: 'sell', label: '賣張', values: rows.map((r) => r.sell), style: 'dashed' }],
        format: axisLots, tipFormat: (v) => `${lotsText(v)} 張`, zero: true,
      });
    }
    panels.push({ id: 'net', title: '每日買賣超（張）', kind: 'bars', height: 96, series: [{ key: 'net', label: '買賣超', values: rows.map((r) => r.net) }], format: axisLots, tipFormat: (v) => `${signedLots(v).text} 張` });
    panels.push({ id: 'cum', title: '累計買賣超（張）', kind: 'lines', height: 72, series: [{ key: 'cum', label: '累計', values: rows.map((r) => r.cum) }], format: axisLots, tipFormat: (v) => `${signedLots(v).text} 張`, zero: true });
  }

  async function copy(text: string, ok: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(ok);
    } catch {
      setStatus('瀏覽器不允許寫入剪貼簿；請改用桌面瀏覽器或允許剪貼簿權限。');
    }
  }
  const menu = block && h ? (
    <MoreMenu label="法人買賣超報表的更多動作" items={[{ label: '複製為 CSV（四個法人）', onSelect: () => copy(reportCsv(block, days, { code, name: h.name }), `已複製 CSV（${days} 日，四個法人的買張、賣張、買賣超）`) }]} />
  ) : null;

  const newest = [...rows].reverse();
  const period = rows.length ? `${mdLabel(rows[0].date)}–${mdLabel(rows[rows.length - 1].date)}` : '';

  return (
    <StockToolFrame code={code} h={h} loading={s.loading} error={s.error} tool="法人買賣超報表" title={title} actions={menu}>
      <p class="sr-only" role="status" aria-live="polite">{status}</p>
      {status ? <p class="caption muted">{status}</p> : null}
      {!block ? (
        <Banner title="每日法人資料累積中">需要至少兩個交易日的三大法人資料。</Banner>
      ) : (
        <>
          <div class="segmented ir-tabs" role="group" aria-label="法人">
            {TABS.map((t) => <button key={t} aria-pressed={t === tab} onClick={() => setTab(t)}>{TAB_NAME[t]}</button>)}
          </div>
          {tab === 'banks' ? <BanksPending /> : (
            <>
              <div class="segmented ir-months" role="group" aria-label="期間">
                {MONTHS.map((m) => (
                  <button key={m} aria-pressed={m === months} disabled={m > 1 && available < (m - 1) * DAYS_PER_MONTH + 1} onClick={() => setMonths(m)}>{m} 個月</button>
                ))}
              </div>
              <p class="body ir-sentence" data-testid="ir-sentence">{headline(rows, party)}。</p>

              {/* 區間合計：四個法人一次看（點一列切換下方的圖與明細） */}
              <section class="ir-card" aria-labelledby="ir-sum-title" ref={sumRef} data-fits={sumFits ? 'all' : 'compact'}>
                <div class="ir-card-head">
                  <h2 class="caption w6" id="ir-sum-title">區間合計・{rows.length} 日</h2>
                  <span class="caption muted">{period}・單位：張</span>
                </div>
                <table class="ir-sum">
                  <colgroup><col class="ir-c-party" /><col /><col /><col class="ir-c-net" />{sumFits ? <col class="ir-c-pct" /> : null}</colgroup>
                  <thead>
                    <tr><th scope="col"><span class="sr-only">法人</span></th><th scope="col">買張</th><th scope="col">賣張</th><th scope="col">買賣超</th>{sumFits ? <th scope="col">佔量</th> : null}</tr>
                  </thead>
                  <tbody>
                    {PARTIES.map((p) => {
                      const t = partyTotal(byParty![p], p);
                      const pct = t.pctVolume;
                      return (
                        <tr key={p} class={p === party ? 'on' : ''} aria-current={p === party ? 'true' : undefined} onClick={() => setTab(p)}>
                          <th scope="row">
                            <button class="ir-rowbtn" onClick={(e) => { e.stopPropagation(); setTab(p); }}
                              aria-label={`${PARTY_NAME[p]}：${t.buy === null ? '買張賣張沒有資料' : `買 ${INT.format(Math.round(t.buy))} 張、賣 ${INT.format(Math.round(t.sell ?? 0))} 張`}，${t.net === null ? '買賣超沒有資料' : `${t.net >= 0 ? '買超' : '賣超'} ${INT.format(Math.abs(Math.round(t.net)))} 張`}${pct === null ? '' : `，佔成交量 ${pct.toFixed(1)}%`}。切換到${PARTY_NAME[p]}`}>
                              {PARTY_NAME[p]}
                            </button>
                          </th>
                          <td aria-hidden="true"><Num v={t.buy} />{t.buy !== null && t.bsDays < t.days ? <sup class="muted">*</sup> : null}</td>
                          <td aria-hidden="true"><Num v={t.sell} />{t.sell !== null && t.bsDays < t.days ? <sup class="muted">*</sup> : null}</td>
                          <td aria-hidden="true"><Num v={t.net} signed /></td>
                          {sumFits ? <td aria-hidden="true"><span class={`num ${pct === null ? '' : pct > 0.005 ? 'up' : pct < -0.005 ? 'down' : ''}`}>{pct === null ? '—' : `${pct > 0.005 ? '▲' : pct < -0.005 ? '▼' : ''}${Math.abs(pct).toFixed(1)}%`}</span></td> : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {PARTIES.some((p) => { const t = partyTotal(byParty![p], p); return t.buy === null || t.bsDays < t.days; }) ? (
                  <p class="caption muted ir-note">
                    「—」或 *：買張與賣張{sinceAll ? `（三大法人合計）自 ${spokenDate(sinceAll)}起才完整` : '尚無完整資料'}（較早的資料只保存買賣超），合計只含有資料的日子；買賣超不受影響。
                  </p>
                ) : null}
              </section>

              <h2 class="section ir-h2">{PARTY_NAME[party]}走勢</h2>
              <StackedChart dates={rows.map((r) => r.date)} panels={panels} label={`${h?.name ?? code}${PARTY_NAME[party]}買賣超走勢`} />

              <div class="ir-table-head">
                <h2 class="section ir-h2">{PARTY_NAME[party]}逐日明細</h2>
                <span class="caption muted">單位：張</span>
              </div>
              <p class="caption muted">{rows.length} 日・點一列看當天完整籌碼{fits ? '' : '・字級較大，累計請看上方走勢圖'}</p>
              <div class="cd-wrap ir-wrap" ref={tableRef} role="region" aria-label={`${PARTY_NAME[party]}逐日明細`} data-fits={fits ? 'all' : 'compact'}>
                <table class="cd-table ir-table" style={{ ['--dt' as string]: 1 }}>
                  <colgroup>
                    <col class="ir-col-date" />
                    <col /><col /><col />{fits ? <col /> : null}
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col" class="cd-dh">日期</th>
                      <th scope="col"><span class="cd-h">買張</span></th>
                      <th scope="col"><span class="cd-h">賣張</span></th>
                      <th scope="col"><span class="cd-h">買賣超</span></th>
                      {fits ? <th scope="col"><span class="cd-h">累計</span></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    <tr class="total">
                      <th scope="row"><span class="cd-date">區間合計</span><span class="cd-sub">{rows.length} 日</span></th>
                      <td class="cd-v"><Num v={total.buy} /></td>
                      <td class="cd-v"><Num v={total.sell} /></td>
                      <td class="cd-v"><Num v={total.net} signed /></td>
                      {fits ? <td class="cd-v"><span class="muted">—</span></td> : null}
                    </tr>
                    {newest.map((r) => {
                      const p = priceSub(r);
                      const open = () => setDay(chipAll.find((c) => c.date === r.date) ?? null);
                      return (
                        <tr key={r.date} class="day" onClick={open}>
                          <th scope="row" class="cd-rowhead">
                            <span class="cd-date" aria-hidden="true">{mdLabel(r.date)}</span>
                            <span class="cd-sub" aria-hidden="true">{p.price} <span class={p.dir}>{p.chg}</span></span>
                            <button class="cd-rowbtn" aria-label={reportSentence(r, party)} aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); open(); }} />
                          </th>
                          <td class="cd-v" aria-hidden="true"><Num v={r.buy} /></td>
                          <td class="cd-v" aria-hidden="true"><Num v={r.sell} /></td>
                          <td class="cd-v" aria-hidden="true"><Num v={r.net} signed /></td>
                          {fits ? <td class="cd-v" aria-hidden="true"><Num v={r.cum} signed /></td> : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <details class="tech cd-notes">
                <summary>欄位說明與資料來源</summary>
                <p class="caption muted">
                  張＝1,000 股。外資＝外陸資（不含外資自營商）＋外資自營商；自營商＝自行買賣＋避險；三大法人＝三者合計（買賣超為官方合計數）。
                  買賣超＝買張 − 賣張；累計＝期間第一天起逐日相加；佔量＝區間買賣超 ÷ 區間成交量。
                  紅色 ▲＝買超、綠色 ▼＝賣超。一個月以 20 個交易日計。
                </p>
                <p class="caption muted">資料來源：臺灣證券交易所「三大法人買賣超日報」（T86）、證券櫃檯買賣中心「三大法人買賣明細資訊」，依政府資料開放授權條款使用。</p>
              </details>
            </>
          )}
          <DaySheet day={day} onClose={() => setDay(null)} unit="lots" market={h?.market}
            onCopy={(r) => copy(dayText(r, 'lots', { code, name: h?.name ?? code }), `已複製 ${spokenDate(r.date)}的資料`)}
            extra={(r) => <DayFlows block={block} date={r.date} />} />
        </>
      )}
    </StockToolFrame>
  );
}

/** 底部面板最上方：四個法人當天的買張、賣張、買賣超。 */
function DayFlows({ block, date }: { block: ChipBlock; date: string }) {
  const i = block.d.indexOf(date);
  if (i < 0) return null;
  return (
    <section aria-label="各法人買張與賣張">
      <h3 class="eyebrow cd-group">各法人買張／賣張（張）</h3>
      <table class="ir-sum ir-day">
        <thead><tr><th scope="col"><span class="sr-only">法人</span></th><th scope="col">買張</th><th scope="col">賣張</th><th scope="col">買賣超</th></tr></thead>
        <tbody>
          {PARTIES.map((p) => {
            const f = partyFlow(block, p, i);
            const k = (v: number | null) => (v === null ? null : v / 1000);
            return (
              <tr key={p}>
                <th scope="row">{PARTY_NAME[p]}</th>
                <td><Num v={k(f.buy)} /></td>
                <td><Num v={k(f.sell)} /></td>
                <td><Num v={k(f.net)} signed /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** 八大行庫：官方分點資料需要驗證碼，不擷取；說明原因、預計欄位與可手動查詢的地方。 */
function BanksPending() {
  return (
    <section class="ir-banks" aria-labelledby="ir-banks-title">
      <Banner kind="risk" icon={<IconCloudOff />} title={<span id="ir-banks-title">八大行庫：資料源待處理</span>}>
        八大行庫（公股行庫）的買賣超來自「券商分點」進出資料。證交所與櫃買中心的分點查詢頁都需要輸入驗證碼，也沒有免費的開放資料 API；本 App 不繞過驗證碼，因此暫時無法提供。
      </Banner>
      <div class="ir-card">
        <div class="ir-card-head">
          <h2 class="caption w6">資料接上後會列出</h2>
          <span class="caption muted">單位：張、%</span>
        </div>
        <table class="ir-sum ir-planned">
          <thead><tr><th scope="col">日期</th><th scope="col">買賣超</th><th scope="col">庫存</th><th scope="col">持股比率</th></tr></thead>
          <tbody><tr><th scope="row">—</th><td>—</td><td>—</td><td>—</td></tr></tbody>
        </table>
        <p class="caption muted ir-note">「庫存」與「持股比率」在第三方網站通常是以分點買賣超自某日起累計推估，並非官方申報的持股；本 App 若日後接上，也會標示「估」。</p>
      </div>
      <h2 class="caption w6 ir-h3">可以自行查詢的地方（另開新頁）</h2>
      <ul class="list ir-links">
        <li><a class="list-item" href="https://bsr.twse.com.tw/bshtm/" target="_blank" rel="noopener noreferrer"><span class="grow">證交所・買賣日報表查詢系統<span class="caption muted ir-link-sub">官方，上市股票分點進出；需輸入驗證碼</span></span></a></li>
        <li><a class="list-item" href="https://www.tpex.org.tw/zh-tw/mainboard/trading/info/brokerBS.html" target="_blank" rel="noopener noreferrer"><span class="grow">櫃買中心・券商買賣證券日報表<span class="caption muted ir-link-sub">官方，上櫃股票分點進出；需輸入驗證碼</span></span></a></li>
        <li><a class="list-item" href="https://histock.tw/stock/broker8.aspx" target="_blank" rel="noopener noreferrer"><span class="grow">HiStock・八大官股銀行買賣超排名<span class="caption muted ir-link-sub">第三方網站，非官方資料，本 App 不擷取、不保證正確</span></span></a></li>
      </ul>
      <p class="caption muted ir-note">八大行庫一般指臺灣銀行、土地銀行、合作金庫、第一銀行、華南銀行、彰化銀行、兆豐銀行、臺灣企銀旗下的證券商分點。</p>
    </section>
  );
}
