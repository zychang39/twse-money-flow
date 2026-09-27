import type { StockHistory } from '../data/types';
import { fmtInt, fmtNum, fmtPct, fmtPrice } from '../lib/format';
import { Signed } from './Change';
import { Banner } from './DataStatus';
import { IconCalendar } from './Icons';

interface FairMethod { method: string; label: string; cheap: number | null; fair: number | null; expensive: number | null; basis: string }
interface Fair { methods: FairMethod[]; combined: { cheap: number; fair: number; expensive: number } | null; position: number | null; price: number }
interface RevenueRow { ym: string; revenue: number; yoy: number | null; mom: number | null }
interface EventRow { date: string; type: string; text: string }
interface EtfHolder { etf: string; name: string; weight: number | null; change_shares: number | null; date: string }
interface QuarterRow { period: string; revenue: number | null; gross_margin: number | null; net_income: number | null }
interface ShortHalt { last_cover_date: string; end: string; reason: string | null }

/** 合理價區間（估算值）：灰階軌道＋目前位置標記，不另用顏色。 */
export function FairRange({ h, detail }: { h: StockHistory; detail?: boolean }) {
  const fair = h.fair as Fair | undefined;
  if (!fair) return <p class="caption muted">資料不足以計算合理價。</p>;
  const pos = fair.position === null ? null : Math.min(Math.max(fair.position, 0), 1);
  return (
    <div>
      {fair.combined ? (
        <>
          <div class="row between caption"><span class="muted">便宜 {fmtPrice(fair.combined.cheap)}</span><span class="t1">合理 {fmtPrice(fair.combined.fair)}<span class="est">估</span></span><span class="muted">昂貴 {fmtPrice(fair.combined.expensive)}</span></div>
          <div style={{ position: 'relative', margin: 'var(--s-3) 0 var(--s-2)' }} role="img"
            aria-label={`目前價格 ${fmtPrice(fair.price)}，位於合理價估算區間的 ${pos === null ? '—' : Math.round(pos * 100)}%`}>
            <div class="bar"><i style={{ width: '100%', background: 'var(--surface-3)' }} /></div>
            {pos !== null ? <span style={{ position: 'absolute', top: '-0.25rem', left: `calc(${pos * 100}% - 0.4375rem)`, width: '0.875rem', height: '0.875rem', borderRadius: '50%', background: 'var(--text-1)', boxShadow: '0 0 0 3px var(--surface-1)' }} /> : null}
          </div>
          <div class="caption">目前 {fmtPrice(fair.price)}，位於區間 {pos === null ? '—' : `${Math.round(pos * 100)}%`}</div>
        </>
      ) : <p class="caption muted">各方法結果不足以合併成區間。</p>}
      {detail ? (
        <div class="scroll-x"><table class="table" style={{ marginTop: 'var(--s-3)' }}>
          <thead><tr><th>方法</th><th>便宜</th><th>合理</th><th>昂貴</th></tr></thead>
          <tbody>
            {fair.methods.map((m) => (
              <tr key={m.method}><td>{m.label}<div class="muted">{m.basis}</div></td><td>{fmtPrice(m.cheap)}</td><td>{fmtPrice(m.fair)}</td><td>{fmtPrice(m.expensive)}</td></tr>
            ))}
          </tbody>
        </table></div>
      ) : null}
    </div>
  );
}

/** 個股延伸資料（底部面板）：合理價方法、月營收、季財報、主動式 ETF 持有、近期事件、停券。 */
export function StockExtras({ h }: { h: StockHistory }) {
  const revenue = h.revenue as RevenueRow[] | undefined;
  const events = h.events as EventRow[] | undefined;
  const etfs = h.etf_holders as EtfHolder[] | undefined;
  const quarters = h.quarters as QuarterRow[] | undefined;
  const halt = h.short_halt as ShortHalt | null | undefined;
  const last = h.d.length - 1;
  return (
    <>
      <h3 class="eyebrow">基本數據（{h.d[last]}）</h3>
      <div class="list">
        <div class="list-item"><span class="grow">成交量</span><span>{fmtInt(h.v[last])} 張</span></div>
        <div class="list-item"><span class="grow">成交值</span><span>{fmtNum(h.val[last], 1)} 百萬</span></div>
        <div class="list-item"><span class="grow">本益比／淨值比／殖利率</span><span>{fmtNum(h.pe[last])}／{fmtNum(h.pb[last])}／{fmtNum(h.dy[last])}%</span></div>
        {h.shares ? <div class="list-item"><span class="grow">發行股數</span><span>{fmtNum(h.shares / 1e8, 2)} 億股</span></div> : null}
      </div>
      {halt ? <Banner icon={<IconCalendar />} title={`融券最後回補日 ${halt.last_cover_date}`}>停券至 {halt.end}{halt.reason ? `，${halt.reason}` : ''}</Banner> : null}
      {h.fair ? (
        <>
          <h3 class="eyebrow" style={{ marginTop: 'var(--s-4)' }}>合理價估算方法</h3>
          <div class="card"><FairRange h={h} detail /></div>
        </>
      ) : null}
      {revenue && revenue.length ? (
        <>
          <h3 class="eyebrow" style={{ marginTop: 'var(--s-6)' }}>月營收</h3>
          <div class="scroll-x">
            <table class="table">
              <thead><tr><th>年月</th><th>營收（百萬）</th><th>年增率</th><th>月增率</th></tr></thead>
              <tbody>
                {revenue.slice(-12).reverse().map((r) => (
                  <tr key={r.ym}><td>{r.ym}</td><td>{fmtNum(r.revenue / 1000, 1)}</td>
                    <td><Signed value={r.yoy} format={(v) => fmtPct(v, 1)} /></td>
                    <td><Signed value={r.mom} format={(v) => fmtPct(v, 1)} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {quarters && quarters.length ? (
        <>
          <h3 class="eyebrow" style={{ marginTop: 'var(--s-6)' }}>季財報（單季）</h3>
          <div class="scroll-x">
            <table class="table">
              <thead><tr><th>季度</th><th>營收（億）</th><th>毛利率</th><th>稅後淨利（億）</th></tr></thead>
              <tbody>
                {quarters.slice().reverse().map((q) => (
                  <tr key={q.period}><td>{q.period}</td><td>{fmtNum(q.revenue === null ? null : q.revenue / 1e5, 1)}</td>
                    <td>{q.gross_margin === null ? '—' : `${fmtNum(q.gross_margin, 1)}%`}</td>
                    <td><Signed value={q.net_income === null ? null : q.net_income / 1e5} format={(v) => fmtNum(v, 2)} /></td></tr>
                ))}
              </tbody>
            </table>
            <p class="caption muted">MOPS 財報彙總（仟元換算為億元）；單季 = 本季累計 − 上季累計。</p>
          </div>
        </>
      ) : null}
      {etfs && etfs.length ? (
        <>
          <h3 class="eyebrow" style={{ marginTop: 'var(--s-6)' }}>主動式 ETF 持有</h3>
          <div class="list">
            {etfs.map((e) => (
              <a key={e.etf} class="list-item" href={`#/stock/${e.etf}`}>
                <span class="grow">{e.name} <span class="muted caption">{e.etf}</span></span>
                <span class="caption">{e.weight !== null ? `${fmtNum(e.weight)}%` : '—'}</span>
                <Signed value={e.change_shares} format={(v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${fmtNum(v / 1000, 0)} 張`)} />
              </a>
            ))}
          </div>
        </>
      ) : null}
      {events && events.length ? (
        <>
          <h3 class="eyebrow" style={{ marginTop: 'var(--s-6)' }}>近期事件</h3>
          <div class="list">
            {events.map((e) => (
              <div key={`${e.date}-${e.type}-${e.text}`} class="list-item" style={{ alignItems: 'flex-start' }}>
                <span class="caption muted" style={{ minWidth: '5.5rem' }}>{e.date}</span>
                <span class="grow caption"><span class="badge">{e.type}</span> {e.text}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
