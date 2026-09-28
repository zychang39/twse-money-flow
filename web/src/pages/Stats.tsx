/** 個人統計：交易統計、錯誤標籤、理由類型績效、組合權益曲線（對照 0050 與加權報酬指數）、產業集中度與相關性。 */
import { useMemo } from 'preact/hooks';
import { PageHead, TopBar } from '../components/Chrome';
import { EmptyState, Loading } from '../components/DataStatus';
import { Signed } from '../components/Change';
import { LineChart } from '../components/LineChart';
import { IconBars } from '../components/Icons';
import { useAsync, useDb } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { useUser } from '../data/useUser';
import { loadJson, loadStock } from '../data/api';
import { getSetting, type Trade } from '../db/db';
import type { StockHistory, StockRow } from '../data/types';
import { DEFAULT_PORTFOLIO, type PortfolioSettings } from '../lib/settings';
import { byReason, closedStats, countBy, lossIfAllStopped, tradePnl } from '../lib/sizing';
import { adjustTrade, eventsFor, unrealizedPnl, type AdjEvent } from '../lib/corpActions';
import { alignTo, correlation, equityCurve, maxDrawdown, monthlyReturns, normalize, type DividendEvent } from '../lib/portfolio';
import { adjClose } from '../lib/history';
import { fmtMoney, fmtPct } from '../lib/format';

function Portfolio({ trades, capital, byCode }: { trades: Trade[]; capital: number; byCode: Map<string, StockRow> }) {
  const codes = [...new Set(trades.map((t) => t.code))];
  const hist = useAsync(() => Promise.all(codes.map((c) => loadStock(c).catch(() => null))), [codes.join(',')]);
  const idx = useAsync(() => loadJson<{ dates: string[]; series: Record<string, (number | null)[]> }>('index.json'), []);
  const etf = useAsync(() => loadStock('0050').catch(() => null), []);
  const data = useMemo(() => {
    if (!hist.data || !idx.data || !trades.length) return null;
    const first = trades.map((t) => t.openedAt.slice(0, 10)).sort()[0];
    const cal = idx.data.dates.filter((d) => d >= first);
    if (cal.length < 2) return null;
    const prices: Record<string, { dates: string[]; close: (number | null)[] }> = {};
    const divs: Record<string, DividendEvent[]> = {};
    const adj: Record<string, AdjEvent[]> = {};
    hist.data.forEach((h: StockHistory | null) => {
      if (!h) return;
      prices[h.code] = { dates: h.d, close: h.c };
      adj[h.code] = eventsFor(null, h);
      divs[h.code] = ((h.dividends as { date: string; cash: number; stock_ratio: number }[] | undefined) ?? []).map((d) => ({ date: d.date, cash: d.cash, stockRatio: d.stock_ratio }));
    });
    const eq = equityCurve(capital, trades, prices, divs, cal, adj);
    const tr = idx.data.series['發行量加權股價報酬指數'];
    const trAligned = cal.map((d) => tr[idx.data!.dates.indexOf(d)] ?? null);
    const etfAdj = etf.data ? alignTo(cal, { dates: etf.data.d, close: adjClose(etf.data) }) : cal.map(() => null);
    return { cal, eq, trAligned, etfAdj };
  }, [hist.data, idx.data, etf.data, trades, capital]);
  if (!data) return <div class="card caption muted">資料載入中或資料不足（需要已部署的歷史價格）。</div>;
  const values = data.eq.map((p) => p.equity);
  const mdd = maxDrawdown(values);
  const months = monthlyReturns(data.eq);
  const realized = trades.filter((t) => t.status === 'closed').reduce((s, t) => s + tradePnl(t), 0);
  const histBy = new Map((hist.data ?? []).filter((h): h is StockHistory => !!h).map((h) => [h.code, h]));
  const unrealized = trades.filter((t) => t.status === 'open')
    .reduce((s, t) => s + (unrealizedPnl(t, byCode.get(t.code)?.close ?? null, eventsFor(byCode.get(t.code), histBy.get(t.code))) ?? 0), 0);
  const total = values[values.length - 1] / capital - 1;
  const trRet = data.trAligned[0] && data.trAligned[data.trAligned.length - 1] ? (data.trAligned[data.trAligned.length - 1] as number) / (data.trAligned[0] as number) - 1 : null;
  const etfFirst = data.etfAdj.find((v) => v !== null);
  const etfRet = etfFirst && data.etfAdj[data.etfAdj.length - 1] ? (data.etfAdj[data.etfAdj.length - 1] as number) / etfFirst - 1 : null;
  return (
    <>
      <div class="card">
        <div class="grid two caption">
          <div>總報酬 <b><Signed value={total * 100} format={(v) => fmtPct(v)} /></b></div>
          <div>最大回撤 <b>{fmtPct(-mdd * 100)}</b></div>
          <div>已實現損益 <Signed value={realized} format={fmtMoney} /></div>
          <div>未實現損益 <Signed value={unrealized} format={fmtMoney} /></div>
          <div>0050（還原）同期 {etfRet === null ? '—' : fmtPct(etfRet * 100)}</div>
          <div>加權報酬指數同期 {trRet === null ? '—' : fmtPct(trRet * 100)}</div>
        </div>
      </div>
      <div class="card">
        <LineChart dates={data.cal} ariaLabel={`權益曲線，總報酬 ${fmtPct(total * 100)}，最大回撤 ${fmtPct(-mdd * 100)}`} lines={[
          { label: '我的權益', tone: 'primary', values: normalize(values) },
          { label: '0050（還原）', tone: 'secondary', dash: '5 4', values: normalize(data.etfAdj) },
          { label: '加權報酬指數', tone: 'secondary', dash: '1 4', values: normalize(data.trAligned) },
        ]} />
        <p class="caption muted">以期初資金為 100 標準化；權益曲線自動計入除息現金股利與除權配股。</p>
      </div>
      <h3 class="eyebrow" style={{ marginTop: 'var(--s-6)' }}>月報酬</h3>
      <div class="scroll-x">
        <table class="table"><thead><tr><th>月份</th><th>報酬</th></tr></thead>
          <tbody>{months.map((m) => <tr key={m.month}><td>{m.month}</td><td><Signed value={m.ret * 100} format={(v) => fmtPct(v)} /></td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

function RiskPanel({ open, byCode }: { open: Trade[]; byCode: Map<string, StockRow> }) {
  const codes = [...new Set(open.map((t) => t.code))];
  const hist = useAsync(() => Promise.all(codes.map((c) => loadStock(c).catch(() => null))), [codes.join(',')]);
  // D-01：股數、停損換算到目前的價格基準（分割後市值與停損虧損才正確）
  const histBy = new Map((hist.data ?? []).filter((h): h is StockHistory => !!h).map((h) => [h.code, h]));
  const positions = open.map((t) => {
    const a = adjustTrade(t, eventsFor(byCode.get(t.code), histBy.get(t.code)));
    return { ...t, shares: t.shares / a.factor, stop: a.stop, price: byCode.get(t.code)?.close ?? a.entry, industry: byCode.get(t.code)?.industry ?? '未知' };
  });
  const total = positions.reduce((s, p) => s + p.price * p.shares, 0);
  const byInd = new Map<string, number>();
  positions.forEach((p) => byInd.set(p.industry ?? '未知', (byInd.get(p.industry ?? '未知') ?? 0) + p.price * p.shares));
  const loss = lossIfAllStopped(positions.map((p) => ({ shares: p.shares, stop: p.stop, price: p.price })));
  const hs = (hist.data ?? []).filter((h): h is StockHistory => !!h);
  return (
    <>
      <div class="card caption">持倉市值 {fmtMoney(total)}・全部觸及停損的總虧損 <b class="risk">{fmtMoney(loss)}</b></div>
      <h3 class="eyebrow" style={{ marginTop: 'var(--s-6)' }}>產業集中度</h3>
      <div class="card">
        {[...byInd.entries()].sort((a, b) => b[1] - a[1]).map(([ind, v]) => (
          <div key={ind} style={{ marginBottom: 'var(--s-2)' }}>
            <div class="row between caption"><span>{ind}</span><span>{fmtPct((v / (total || 1)) * 100, 1, false)}</span></div>
            <div class="bar"><i style={{ width: `${(v / (total || 1)) * 100}%` }} /></div>
          </div>
        ))}
      </div>
      {hs.length >= 2 ? (
        <>
          <h3 class="eyebrow" style={{ marginTop: 'var(--s-6)' }}>持股相關性（近 60 日）</h3>
          <div class="scroll-x">
            <table class="table">
              <thead><tr><th></th>{hs.map((h) => <th key={h.code}>{h.name}</th>)}</tr></thead>
              <tbody>
                {hs.map((a) => {
                  const pa = adjClose(a);
                  return (
                    <tr key={a.code}><td>{a.name}</td>{hs.map((b) => {
                      const c = a.code === b.code ? 1 : correlation(pa, alignTo(a.d, { dates: b.d, close: adjClose(b) }));
                      return <td key={b.code} class={c !== null && c > 0.7 && a.code !== b.code ? 'risk w6' : ''}>{c === null ? '—' : c.toFixed(2)}</td>;
                    })}</tr>
                  );
                })}
              </tbody>
            </table>
            <p class="caption muted">相關係數 &gt; 0.7 以琥珀色標示，代表風險可能集中。</p>
          </div>
        </>
      ) : null}
    </>
  );
}

export default function Stats() {
  const summary = useScoredSummary();
  const user = useUser();
  const portfolio = useDb(() => getSetting<PortfolioSettings>('portfolio', DEFAULT_PORTFOLIO)) ?? DEFAULT_PORTFOLIO;
  if (!user) return <div class="page"><TopBar back="/discipline" /><Loading /></div>;
  const trades = user.trades;
  const closed = trades.filter((t) => t.status === 'closed');
  const open = trades.filter((t) => t.status === 'open');
  const stats = closedStats(trades);
  const tags = countBy(closed, (t) => t.errorTags);
  const byCode = summary.data?.byCode ?? new Map<string, StockRow>();
  const topTag = Object.entries(tags).sort((a, b) => b[1] - a[1])[0];
  return (
    <div class="page">
      <TopBar back="/discipline" />
      <PageHead eyebrow="我的紀律與結果" title={stats.n ? <>已平倉 {stats.n} 筆{topTag ? <>，<br />最常見的錯誤是「{topTag[0]}」</> : ''}</> : '個人統計'} />
      {!trades.length ? (
        <EmptyState icon={<IconBars />} title="還沒有交易紀錄" text="建立持倉並平倉後，這裡會出現勝率、期望值與錯誤標籤。" action={<a class="btn primary" href="#/discipline/checklist">開始買進前檢查表</a>} />
      ) : (
        <>
          <div class="card" style={{ marginTop: 'var(--s-5)' }}>
            <div class="grid two caption">
              <div>交易筆數 <b>{stats.n}</b>{stats.n < 20 ? <span class="tag" style={{ marginLeft: 'var(--s-1)' }}>樣本少</span> : null}</div>
              <div>勝率 <b>{stats.winRate === null ? '—' : fmtPct(stats.winRate * 100, 1, false)}</b></div>
              <div>平均賺賠比 <b>{stats.payoff === null ? '—' : stats.payoff.toFixed(2)}</b></div>
              <div>平均持有 <b>{stats.avgHoldDays === null ? '—' : `${stats.avgHoldDays.toFixed(1)} 天`}</b></div>
              <div>期望值（金額）<b>{stats.evAmount === null ? '—' : fmtMoney(stats.evAmount)}</b></div>
              <div>期望值（R）<b>{stats.evR === null ? '—' : `${stats.evR.toFixed(2)} R`}</b></div>
            </div>
          </div>
          <h3 class="eyebrow" style={{ marginTop: 'var(--s-6)' }}>錯誤標籤頻率</h3>
          <div class="card">
            {Object.keys(tags).length ? Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
              <div key={t} class="row between caption" style={{ minHeight: '2rem' }}><span>{t}</span><span>{n} 次</span></div>
            )) : <p class="caption muted">尚無資料。</p>}
          </div>
          <h3 class="eyebrow" style={{ marginTop: 'var(--s-6)' }}>各理由類型績效</h3>
          <div class="scroll-x">
            <table class="table">
              <thead><tr><th>理由</th><th>筆數</th><th>勝率</th><th>期望值</th></tr></thead>
              <tbody>{byReason(trades).map(({ reason, stats: s }) => (
                <tr key={reason}><td>{reason}</td><td>{s.n}</td><td>{s.winRate === null ? '—' : fmtPct(s.winRate * 100, 0, false)}</td><td>{s.evAmount === null ? '—' : fmtMoney(s.evAmount)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <h2 class="section" style={{ marginTop: 'var(--s-10)' }}>組合分析</h2>
          <Portfolio trades={trades} capital={portfolio.capital} byCode={byCode} />
          {open.length ? (
            <>
              <h2 class="section" style={{ marginTop: 'var(--s-10)' }}>持倉風險</h2>
              <RiskPanel open={open} byCode={byCode} />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
