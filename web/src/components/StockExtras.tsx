import type { StockHistory } from '../data/types';
import { fmtNum, fmtPct, fmtPrice } from '../lib/format';
import { Signed } from './Change';

interface FairMethod { method: string; label: string; cheap: number | null; fair: number | null; expensive: number | null; basis: string }
interface Fair { methods: FairMethod[]; combined: { cheap: number; fair: number; expensive: number } | null; position: number | null; price: number }
interface RevenueRow { ym: string; revenue: number; yoy: number | null; mom: number | null }
interface EventRow { date: string; type: string; text: string }
interface EtfHolder { etf: string; name: string; weight: number | null; change_shares: number | null; date: string }

/** 個股頁的延伸區塊：健檢摘要、合理價、月營收、ETF 持有、近期事件（有資料才顯示）。 */
export function StockExtras({ h }: { h: StockHistory }) {
  const summary = h.summary_text as string[] | undefined;
  const fair = h.fair as Fair | undefined;
  const revenue = h.revenue as RevenueRow[] | undefined;
  const events = h.events as EventRow[] | undefined;
  const etfs = h.etf_holders as EtfHolder[] | undefined;
  return (
    <>
      {summary && summary.length ? (
        <div class="card glass">
          <div class="headline">健檢摘要</div>
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
            {summary.map((s) => <li key={s} class="small">{s}</li>)}
          </ul>
          <p class="tiny muted">規則式自動產生（非 AI），依據見分數明細與方法說明。</p>
        </div>
      ) : null}

      {fair ? (
        <>
          <h2 class="title-2">合理價區間</h2>
          <div class="card">
            {fair.combined ? (
              <div>
                <div class="row between small"><span class="down">便宜 {fmtPrice(fair.combined.cheap)}</span><span>合理 {fmtPrice(fair.combined.fair)}</span><span class="up">昂貴 {fmtPrice(fair.combined.expensive)}</span></div>
                <div class="bar" style={{ position: 'relative', margin: '0.5rem 0', height: '0.625rem' }} role="img"
                  aria-label={`目前價格 ${fmtPrice(fair.price)} 位於區間 ${fair.position === null ? '—' : Math.round(fair.position * 100)}%`}>
                  <i style={{ width: '100%', background: 'linear-gradient(90deg, var(--down), #ffcc00, var(--up))' }} />
                  {fair.position !== null ? <span style={{ position: 'absolute', top: '-0.25rem', left: `calc(${Math.min(Math.max(fair.position, 0), 1) * 100}% - 0.5rem)`, fontSize: '0.875rem' }} aria-hidden="true">▼</span> : null}
                </div>
                <div class="small">目前 {fmtPrice(fair.price)}，位於區間 {fair.position === null ? '—' : `${Math.round(fair.position * 100)}%`}</div>
              </div>
            ) : <p class="small muted">資料不足以計算合理價。</p>}
            <table class="table" style={{ marginTop: '0.75rem' }}>
              <thead><tr><th>方法</th><th>便宜</th><th>合理</th><th>昂貴</th></tr></thead>
              <tbody>
                {fair.methods.map((m) => (
                  <tr key={m.method}><td>{m.label}<div class="tiny muted">{m.basis}</div></td><td>{fmtPrice(m.cheap)}</td><td>{fmtPrice(m.fair)}</td><td>{fmtPrice(m.expensive)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {revenue && revenue.length ? (
        <>
          <h2 class="title-2">月營收</h2>
          <div class="card scroll-x">
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

      {etfs && etfs.length ? (
        <>
          <h2 class="title-2">主動式 ETF 持有</h2>
          <div class="list">
            {etfs.map((e) => (
              <a key={e.etf} class="list-item" href={`#/stock/${e.etf}`}>
                <span class="grow">{e.name} <span class="muted small">{e.etf}</span></span>
                <span class="small num">{e.weight !== null ? `${fmtNum(e.weight)}%` : '—'}</span>
                <Signed value={e.change_shares} format={(v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${fmtNum(v / 1000, 0)} 張`)} />
              </a>
            ))}
          </div>
        </>
      ) : null}

      {events && events.length ? (
        <>
          <h2 class="title-2">近期事件</h2>
          <div class="list">
            {events.map((e) => (
              <div key={`${e.date}-${e.type}-${e.text}`} class="list-item">
                <span class="num small muted" style={{ minWidth: '5.5rem' }}>{e.date}</span>
                <span class="badge">{e.type}</span>
                <span class="small grow">{e.text}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
