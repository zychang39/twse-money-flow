import { useState } from 'preact/hooks';
import { ETF_KIND_LABEL, type EtfKind, type StockHistory } from '../data/types';
import { fmtInt, fmtNum, fmtPct, fmtPrice, md, missing } from '../lib/format';
import { fairPosition } from '../lib/fundamentals';
import { asofText } from '../lib/asof';
import { Signed } from './Change';
import { Banner } from './DataStatus';
import { IconCalendar, IconChevron } from './Icons';

interface FairMethod { method: string; label: string; cheap: number | null; fair: number | null; expensive: number | null; basis: string }
interface Fair { methods: FairMethod[]; combined: { cheap: number; fair: number; expensive: number } | null; position: number | null; price: number }
interface RevenueRow { ym: string; revenue: number; yoy: number | null; mom: number | null }
interface EventRow { date: string; type: string; text: string }
/** kind（M2 2026-10-03）：new 新增／add 加碼／reduce 減碼／exit 剔除（本次 0 股，仍列出）／hold 不變；null＝只有一天揭露、無法分類 */
interface EtfHolder { etf: string; name: string; weight: number | null; change_shares: number | null; date: string; kind?: EtfKind | 'hold' | null }

/** 持有列的變動分類標籤：不變與無法分類不顯示標籤。 */
export function HolderKindTag({ kind }: { kind: EtfHolder['kind'] }) {
  if (!kind || kind === 'hold') return null;
  return <span class="tag" style={{ marginLeft: 'var(--s-1)' }} data-testid="etf-holder-kind">{ETF_KIND_LABEL[kind]}</span>;
}
interface QuarterRow { period: string; revenue: number | null; gross_margin: number | null; net_income: number | null }
interface ShortHalt { last_cover_date: string; end: string; reason: string | null }

/**
 * 事件列（2026-10-02 健檢 #10）：日期小字在上、一行摘要（超出以 … 截斷）、點整列展開全文；整列高度 ≥ 44pt。
 * 個股頁「最近有什麼事件？」與底部面板的「近期事件」共用。
 */
export function EventItem({ e }: { e: EventRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="list-item" style={{ padding: 0, alignItems: 'stretch' }}>
      <button class="grow" aria-expanded={open} onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', minHeight: 'var(--tap)', padding: 'var(--s-2) 0', background: 'none', border: 0, color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer', minWidth: 0 }}>
        <span class="grow" style={{ minWidth: 0 }}>
          <span class="caption muted" style={{ display: 'block' }}>{md(e.date)}・{e.date.slice(0, 4)}</span>
          <span class="caption" style={{ display: 'block', overflow: open ? 'visible' : 'hidden', textOverflow: 'ellipsis', whiteSpace: open ? 'normal' : 'nowrap' }}>
            <span class="tag" style={{ marginRight: 'var(--s-1)' }}>{e.type}</span>{e.text}
          </span>
        </span>
        <span class="chev" style={{ transform: open ? 'rotate(90deg)' : undefined }} aria-hidden="true"><IconChevron /></span>
      </button>
    </div>
  );
}

/** 合理價區間（估算值）：灰階軌道＋目前位置標記，不另用顏色。位置文字由 lib/fundamentals.fairPosition 產生（可超出區間）。 */
export function FairRange({ h, detail }: { h: StockHistory; detail?: boolean }) {
  const fair = h.fair as Fair | undefined;
  if (!fair) return <p class="caption muted">資料不足以計算合理價。</p>;
  const p = fairPosition(fair);
  const pos = p.marker;
  return (
    <div>
      {fair.combined ? (
        <>
          <div class="row between caption"><span class="muted">便宜 {fmtPrice(fair.combined.cheap)}</span><span class="t1">合理 {fmtPrice(fair.combined.fair)}<span class="est">估</span></span><span class="muted">昂貴 {fmtPrice(fair.combined.expensive)}</span></div>
          <div style={{ position: 'relative', margin: 'var(--s-3) 0 var(--s-2)' }} role="img" aria-label={p.aria}>
            <div class="bar"><i style={{ width: '100%', background: 'var(--surface-3)' }} /></div>
            {pos !== null ? <span style={{ position: 'absolute', top: '-0.25rem', left: `calc(${pos * 100}% - 0.4375rem)`, width: '0.875rem', height: '0.875rem', borderRadius: '50%', background: 'var(--text-1)', boxShadow: '0 0 0 3px var(--surface-1)' }} /> : null}
          </div>
          <div class="caption" data-testid="fair-position">目前 {fmtPrice(fair.price)}・{p.text}</div>
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
                <span class="grow">{e.name} <span class="muted caption">{e.etf}</span><HolderKindTag kind={e.kind} /><span class="caption muted" style={{ display: 'block' }}>{asofText(e.date, '沒有持股日期')}</span></span>
                <span class="caption">{e.kind === 'exit' ? '本次持股 0' : e.weight !== null ? `權重 ${fmtNum(e.weight)}%` : missing('沒有權重')}</span>
                <Signed value={e.change_shares} label="持股" format={(v) => (v === null || v === undefined ? missing('沒有變動資料') : `${v > 0 ? '+' : ''}${fmtNum(v / 1000, 0)} 張`)} />
              </a>
            ))}
          </div>
          <p class="caption muted">部分涵蓋：只有部分投信的主動式 ETF 有持股資料（取自各投信官網揭露；涵蓋範圍見探索 › 主動式 ETF）。標籤為與前一次揭露相比的變動：新增、加碼、減碼、剔除（本次 0 股，仍列出）。</p>
        </>
      ) : null}
      {events && events.length ? (
        <>
          <h3 class="eyebrow" style={{ marginTop: 'var(--s-6)' }}>近期事件</h3>
          <div class="list">
            {events.map((e) => <EventItem key={`${e.date}-${e.type}-${e.text}`} e={e} />)}
          </div>
        </>
      ) : null}
    </>
  );
}
