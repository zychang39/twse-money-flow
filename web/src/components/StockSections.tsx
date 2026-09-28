/**
 * 個股頁的區塊內容（v3 M3）：依投資風格排序，每個區塊的標題是「一個問題＋一句結論」，數字細節放在下方。
 * 區塊標題由 pages/Stock.tsx 的 Block 提供；這裡只放內容。
 */
import type { StockHistory } from '../data/types';
import { ALIGN_NAME, type MomentumFacts, type ProfitFacts, type RevenueFacts, peRiver } from '../lib/fundamentals';
import { fmtNum, fmtPrice, numberFormat } from '../lib/format';
import { LineChart } from './LineChart';
import { NetBars } from './Viz';
import { FairRange } from './StockExtras';
import { IconChevron } from './Icons';

const F1 = numberFormat(1);
const F2 = numberFormat(2);

function Fact({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: string }) {
  return (
    <div class="sx-fact">
      <dt>{k}</dt>
      <dd class={`num ${tone ?? ''}`}>{v}</dd>
      {sub ? <dd class="sx-sub">{sub}</dd> : null}
    </div>
  );
}

/** 動能：RS 百分位、距 52 週高點、均線排列（20／60／240）、量能相對 20 日均量。 */
export function MomentumSection({ f }: { f: MomentumFacts }) {
  return (
    <>
      <dl class="sx-facts" data-testid="momentum-facts">
        <Fact k="RS 百分位" v={f.rs === null ? '—' : `${Math.round(f.rs)}`} sub="近 3–12 個月加權報酬在全市場的百分位" />
        <Fact k="距 52 週高點" v={f.dist52 === null ? '—' : `${F1.format(f.dist52)}%`} sub={f.dist52 !== null && f.dist52 > -5 ? '接近高點' : undefined} />
        <Fact k="量能" v={f.volRatio === null ? '—' : `${F2.format(f.volRatio)} 倍`} sub="當日量 ÷ 20 日均量" />
        <Fact k="均線排列" v={ALIGN_NAME[f.alignment]} sub="20／60／240 日（還原價）" />
      </dl>
      <ul class="sx-ma" aria-label="收盤與均線">
        {f.ma.map((m) => (
          <li key={m.n}>
            <span>{m.n} 日線</span>
            <span class="num">{m.value === null ? '—' : fmtPrice(m.value)}</span>
            <span class={`tag ${m.above === null ? '' : m.above ? 'sx-above' : 'sx-below'}`}>{m.above === null ? '資料不足' : m.above ? '站上' : '跌破'}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** 營收成長：近 12 個月年增率柱狀圖、創新高、連續成長月數。 */
export function RevenueSection({ f, onMore }: { f: RevenueFacts; onMore: () => void }) {
  return (
    <>
      {f.last12.length ? (
        <div style={{ marginTop: 'var(--s-4)' }}>
          <NetBars values={f.last12.map((r) => r.yoy)} dates={f.last12.map((r) => r.ym)} unit="%" height={96}
            format={(v, sign = true) => (v === null || v === undefined ? '—' : `${sign && v > 0 ? '+' : v < 0 ? '−' : ''}${F1.format(Math.abs(v))}%`)}
            words={['年增', '年減']} emphasizeRecent={false} caption={`近 ${f.last12.length} 個月營收年增率`} label={`近 ${f.last12.length} 個月營收年增率柱狀圖`} />
        </div>
      ) : null}
      <dl class="sx-facts">
        <Fact k="最新月營收" v={f.latest ? `${fmtNum(f.latest.revenue / 1e5, 1)} 億` : '—'} sub={f.latest ? `${f.latest.ym.replace('-', ' 年 ')} 月` : undefined} />
        <Fact k="近 3 月平均年增" v={f.yoy3m === null ? '—' : `${F1.format(f.yoy3m)}%`} />
        <Fact k="創 12 個月新高" v={f.latest ? (f.newHigh ? '是' : '否') : '—'} />
        <Fact k="連續年增" v={`${f.growthMonths} 個月`} />
      </dl>
      <div class="list">
        <button class="list-item brand" onClick={onMore}>月營收表、季財報與基本數據<span class="chev"><IconChevron /></span></button>
      </div>
    </>
  );
}

/** 獲利品質：單季 EPS、毛利率、ROE 趨勢。 */
export function ProfitSection({ f }: { f: ProfitFacts }) {
  const q = f.quarters;
  if (!q.length) return <p class="caption muted" style={{ marginTop: 'var(--s-3)' }}>季財報資料累積中。</p>;
  const periods = q.map((x) => x.period);
  return (
    <>
      <dl class="sx-facts">
        <Fact k="近四季 EPS" v={f.eps4 === null ? '—' : `${F2.format(f.eps4)} 元`} sub={f.eps4Prev === null ? undefined : `去年同期 ${F2.format(f.eps4Prev)} 元`} />
        <Fact k="ROE（近四季）" v={f.roe === null ? '—' : `${F1.format(f.roe)}%`} />
        <Fact k="毛利率" v={f.gm === null ? '—' : `${F1.format(f.gm)}%`} sub={f.gmYoY === null ? undefined : `較去年同季 ${f.gmYoY >= 0 ? '+' : '−'}${F1.format(Math.abs(f.gmYoY))} 個百分點`} />
      </dl>
      <div style={{ marginTop: 'var(--s-4)' }}>
        <NetBars values={q.map((x) => x.eps ?? null)} dates={periods} unit="元" height={80}
          format={(v, sign = true) => (v === null || v === undefined ? '—' : `${sign && v > 0 ? '' : v < 0 ? '−' : ''}${F2.format(Math.abs(v))} 元`)}
          words={['獲利', '虧損']} emphasizeRecent={false} caption={`單季 EPS・${periods[0]}–${periods[periods.length - 1]}`} label="單季 EPS 柱狀圖" />
      </div>
      <div style={{ marginTop: 'var(--s-4)' }}>
        <LineChart dates={periods} height={140} ariaLabel="毛利率與 ROE 趨勢" format={(v) => `${F1.format(v)}%`}
          lines={[{ label: '毛利率 %', values: q.map((x) => x.gross_margin) }, { label: 'ROE %', values: q.map((x) => x.roe ?? null), tone: 'secondary', dash: '5 4' }]} />
      </div>
    </>
  );
}

/** 估值：合理價區間；長期投資另畫本益比河流。 */
export function ValuationSection({ h, pePct, river }: { h: StockHistory; pePct: number | null; river?: boolean }) {
  const lastOf = (a: (number | null)[]) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] !== null) return a[i]; return null; };
  const r = river ? peRiver(h.d, h.c, h.pe) : null;
  return (
    <>
      <div class="card">
        <FairRange h={h} />
        <div class="row between caption" style={{ marginTop: 'var(--s-3)' }}>
          <span>本益比 {fmtNum(lastOf(h.pe))}{pePct !== null ? `（3 年第 ${Math.round(pePct)} 百分位）` : ''}</span>
          <span>淨值比 {fmtNum(lastOf(h.pb))}</span>
          <span>殖利率 {fmtNum(lastOf(h.dy))}%</span>
        </div>
      </div>
      {river ? (
        r ? (
          <div class="card" data-testid="pe-river">
            <div class="body w6">本益比河流</div>
            <p class="caption muted">收盤價與「本益比 × 隱含近四季 EPS」：區間內本益比第 20／50／80 百分位（{r.bands.map((b) => `${F1.format(b.pe)} 倍`).join('／')}）。</p>
            <LineChart dates={r.dates} height={180} ariaLabel="本益比河流" format={(v) => fmtPrice(v)}
              lines={[
                { label: '收盤', values: r.close },
                ...r.bands.map((b, i) => ({ label: `${F1.format(b.pe)} 倍`, values: b.values, tone: 'tertiary' as const, dash: i === 1 ? undefined : '4 4' })),
              ]} />
          </div>
        ) : <p class="caption muted" style={{ marginTop: 'var(--s-3)' }}>本益比資料不足（少於 20 個交易日或虧損），無法畫本益比河流。</p>
      ) : null}
    </>
  );
}

/** 外資持股比趨勢（長期投資的籌碼結構區塊）。 */
export function ForeignTrend({ d, qfii }: { d: string[]; qfii: (number | null)[] | undefined }) {
  if (!qfii || !qfii.some((v) => v !== null)) return null;
  const n = Math.min(250, d.length);
  return (
    <div class="card" data-testid="foreign-trend">
      <div class="body w6">外資持股比（近 {n} 個交易日）</div>
      <LineChart dates={d.slice(-n)} height={120} ariaLabel="外資持股比趨勢" format={(v) => `${F1.format(v)}%`} lines={[{ label: '外資持股比 %', values: qfii.slice(-n) }]} />
    </div>
  );
}

export interface EventRow { date: string; type: string; text: string }

/** 事件：近期事件（最多 5 筆）＋完整清單在底部面板。 */
export function EventsList({ events }: { events: EventRow[] }) {
  if (!events.length) return <p class="caption muted" style={{ marginTop: 'var(--s-3)' }}>近一年沒有除權息、處置、注意等事件紀錄。</p>;
  return (
    <ul class="list sx-events">
      {events.slice(0, 5).map((e) => (
        <li key={`${e.date}-${e.type}-${e.text}`} class="list-item"><span class="caption muted sx-ev-date">{e.date}</span><span class="grow"><span class="tag">{e.type}</span> {e.text}</span></li>
      ))}
    </ul>
  );
}
