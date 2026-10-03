/**
 * 個股頁的區塊內容（v3 M3）：依投資風格排序，每個區塊的標題是「一個問題＋一句結論」，數字細節放在下方。
 * 區塊標題由 pages/Stock.tsx 的 Block 提供；這裡只放內容。
 */
import type { StockHistory } from '../data/types';
import { ALIGN_NAME, type MomentumFacts, type ProfitFacts, type RevenueFacts, peRiver } from '../lib/fundamentals';
import { fmtNum, fmtPrice, missing, numberFormat, pctSigned, ratioText } from '../lib/format';
import { LineChart } from './LineChart';
import { type TechFacts, kdText, macdText } from '../lib/technical';
import { riskCalc, stopVsLimitText } from '../lib/riskCalc';
import type { PortfolioSettings } from '../lib/settings';
import { KeyValueList } from './Metrics';
import { useState } from 'preact/hooks';
import { peBand } from '../lib/verdict';
import { NetBars } from './Viz';
import { EventItem, FairRange } from './StockExtras';
import { IconChevron } from './Icons';
import '../styles/tools.css'; // .sx-*（#4：原本只有工具頁載入這份 CSS，個股頁直接開啟時樣式不存在）

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

/** 「高點 613.73（2026/6/22）・接近高點」：還原價，讓使用者核對距離的來源（#2） */
function high52Sub(f: MomentumFacts): string | undefined {
  const parts: string[] = [];
  if (f.high52) {
    const [y, m, d] = f.high52.date.split('-');
    parts.push(`高點 ${fmtPrice(f.high52.value)}（${y}/${Number(m)}/${Number(d)}，還原價）`);
  }
  if (f.dist52 !== null && f.dist52 > -5) parts.push('接近高點');
  return parts.length ? parts.join('・') : undefined;
}

/**
 * 動能：RS 百分位、距 52 週高點、量能相對 20 日均量、均線排列（20／60／240；20 日乖離寫在副標）、KD 與鈍化天數、MACD 柱狀數值與狀態。
 * 2026-10-02 健檢：6 格（2 欄排列不留單格）；MACD 主數字為柱狀值（2 位小數）、副標為狀態（方向只寫一次）。
 */
export function MomentumSection({ f, t }: { f: MomentumFacts; t?: TechFacts }) {
  const bias = t && t.bias20 !== null ? `20 日乖離 ${pctSigned(t.bias20)}・` : '';
  return (
    <>
      <dl class="sx-facts" data-testid="momentum-facts">
        <Fact k="RS 百分位" v={f.rs === null ? missing('資料不足') : `${Math.round(f.rs)}`} sub="近 3–12 個月加權報酬在全市場的百分位" />
        <Fact k="距 52 週高點" v={f.dist52 === null ? missing('不足 52 週') : pctSigned(f.dist52)} sub={high52Sub(f)} />
        <Fact k="量能" v={f.volRatio === null ? missing('不足 20 日') : `${F2.format(f.volRatio)} 倍`} sub="當日量 ÷ 20 日均量" />
        <Fact k="均線排列" v={ALIGN_NAME[f.alignment]} sub={`${bias}20／60／240 日線（還原價）`} />
        {t ? <Fact k="KD（9,3,3）" v={t.k === null ? missing('不足 9 日') : `${Math.round(t.k)}`} sub={kdText(t)} /> : null}
        {/* 主數字＝柱狀值（DIF − 訊號線，2 位小數）；狀態（翻正／翻負、DIF 零軸）只在副標寫一次 */}
        {t ? <Fact k="MACD（12,26,9）柱狀" v={t.hist === null ? missing('暖機期不足') : ratioText(t.hist)} sub={macdText(t)} /> : null}
        {/* M2（2026-10-03）：ATR 佔股價 %，風險試算的停損距離也用這個數字 */}
        {t ? <Fact k="ATR14 ÷ 股價" v={t.atrPct === null ? missing('不足 15 日') : `${t.atrPct.toFixed(2)}%`} sub={t.atr14 === null ? '14 日平均真實波幅（還原價）' : `ATR14 ${fmtPrice(t.atr14)}（還原價、Wilder 平滑）`} /> : null}
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
        <div class="row between caption wrap" style={{ marginTop: 'var(--s-3)', gap: 'var(--s-2)' }}>
          <span>本益比 {fmtNum(lastOf(h.pe))}{pePct !== null ? `（3 年第 ${Math.round(pePct)} 百分位，${peBand(pePct)}區間）` : ''}</span>
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

/** 事件：近期事件（最多 5 筆；日期在上、一行摘要、點開看全文）＋完整清單在底部面板。 */
export function EventsList({ events }: { events: EventRow[] }) {
  if (!events.length) return <p class="caption muted" style={{ marginTop: 'var(--s-3)' }}>近一年沒有除權息、處置、注意等事件紀錄。</p>;
  return (
    <div class="list sx-events" data-testid="events-list">
      {events.slice(0, 5).map((e) => <EventItem key={`${e.date}-${e.type}-${e.text}`} e={e} />)}
    </div>
  );
}

/**
 * 風險試算（M2，2026-10-03）：依設定頁的本金、每筆風險比例與 ATR 停損距離算對應股數；連續跌停 1～3 日為壓力情境。
 * 只呈現計算結果，不是進出建議；數字有缺就寫原因。
 */
export function RiskCalcCard({ price, t, prefs }: { price: number | null; t: TechFacts | null | undefined; prefs: PortfolioSettings }) {
  const [k, setK] = useState(2);
  const r = riskCalc({ capital: prefs.capital, riskPct: prefs.riskPct, oddLot: prefs.oddLot, price, atrPct: t?.atrPct ?? null, k });
  const money = (v: number) => `${fmtNum(v, 0)} 元`;
  const sizeText = r.shares <= 0 ? missing(r.reason ?? '無法計算') : r.mode === 'odd' ? `${fmtNum(r.shares, 0)} 股（零股）` : `${fmtNum(r.lots, 0)} 張（${fmtNum(r.shares, 0)} 股）`;
  return (
    <div class="card" style={{ marginTop: 'var(--s-4)' }} data-testid="risk-calc">
      <div class="row between wrap" style={{ gap: 'var(--s-2)' }}>
        <span class="body t1">風險試算</span>
        <div class="segmented inline" role="group" aria-label="ATR 倍數">
          {[2, 3].map((n) => <button key={n} aria-pressed={k === n} onClick={() => setK(n)}>{n} 倍 ATR</button>)}
        </div>
      </div>
      <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>
        本金 {money(prefs.capital)}・每筆風險 {prefs.riskPct}%（設定頁）・停損距離 ＝ {k} × ATR14（{t?.atrPct === null || t?.atrPct === undefined ? missing('不足 15 日') : `${t.atrPct.toFixed(2)}%`}）。只呈現計算結果。
      </p>
      {r.stop === null ? (
        <p class="body muted" style={{ margin: 'var(--s-3) 0 0' }}>{missing(r.reason ?? '無法計算')}</p>
      ) : (
        <>
          <KeyValueList label="風險試算" rows={[
            { k: '參考價', v: <span class="num">{fmtPrice(price)}</span>, sub: '最新收盤（未還原）' },
            { k: '停損價', v: <span class="num">{fmtPrice(r.stop)}</span>, sub: `每股風險 ${fmtPrice(r.perShare)}（${k} × ATR ${fmtPrice(r.atr)}）` },
            { k: '對應股數', v: <span class="num">{sizeText}</span>, sub: `風險上限 ${money(r.budget)}，實際承擔 ${money(r.riskAmount)}；部位 ${money(r.positionValue)}（佔本金 ${r.positionPct === null ? '—' : `${r.positionPct.toFixed(1)}%`}）` },
            { k: '一日跌停價', v: <span class="num">{fmtPrice(r.limitDown1)}</span>, sub: stopVsLimitText(r, fmtPrice) },
          ]} />
          <table class="ev-table ev-static" style={{ marginTop: 'var(--s-3)' }} aria-label="連續跌停情境">
            <thead><tr><th scope="col">連續跌停</th><th scope="col">價格</th><th scope="col">虧損</th><th scope="col">佔本金</th><th scope="col">相對計畫風險</th></tr></thead>
            <tbody>
              {r.scenarios.map((s) => (
                <tr key={s.days}>
                  <th scope="row">{s.days} 日</th>
                  <td class="num">{fmtPrice(s.price)}</td>
                  <td class="num">{money(s.loss)}</td>
                  <td class="num">{`${s.lossPct.toFixed(2)}%`}</td>
                  <td class="num">{s.r === null ? '—' : `${s.r.toFixed(1)} R`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>情境假設隔日起每天跌停（−10%）且賣不掉，停損價在跌停鎖死時無法成交；這是壓力測試，不是預測。</p>
        </>
      )}
    </div>
  );
}
