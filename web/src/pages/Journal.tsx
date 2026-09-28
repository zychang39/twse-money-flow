/** 日誌：持倉與已平倉紀錄；新增持倉一律經過買進前檢查表；平倉後可立即或稍後補寫檢討。 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { PageHead, TopBar } from '../components/Chrome';
import { DataStatus, EmptyState } from '../components/DataStatus';
import { Signed } from '../components/Change';
import { ChecklistSheet, CloseSheet, ReviewSheet } from '../components/Trades';
import { IconClipboard, IconNotebook } from '../components/Icons';
import { useDb, useHistories } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { useUser } from '../data/useUser';
import { deleteTrade, getSetting, type Trade } from '../db/db';
import { DEFAULT_PORTFOLIO, type PortfolioSettings } from '../lib/settings';
import { DEFAULT_COSTS, type CostSettings } from '../lib/costs';
import { hasReview } from '../lib/ritual';
import { adjustTrade, eventsFor, unrealizedPnl } from '../lib/corpActions';
import { tradePnl } from '../lib/sizing';
import { fmtMoney, fmtPrice } from '../lib/format';
import { useRoute } from '../router';
import type { StockRow } from '../data/types';
import { PAGE_SOURCES } from '../lib/health';

export default function Journal({ startChecklist }: { startChecklist?: boolean }) {
  const route = useRoute();
  const summary = useScoredSummary();
  const user = useUser();
  const settings = useDb(async () => ({
    portfolio: await getSetting<PortfolioSettings>('portfolio', DEFAULT_PORTFOLIO),
    costs: await getSetting<CostSettings>('costs', DEFAULT_COSTS),
  }));
  const [tab, setTab] = useState<'open' | 'closed'>(route.query.get('review') ? 'closed' : 'open');
  const [adding, setAdding] = useState(!!startChecklist);
  const [closing, setClosing] = useState<Trade | null>(null);
  const [reviewing, setReviewing] = useState<Trade | null>(null);
  const trades = user?.trades ?? [];
  const hist = useHistories(useMemo(() => [...new Set(trades.filter((t) => t.status === 'open').map((t) => t.code))], [trades]));
  const byCode = summary.data?.byCode ?? new Map<string, StockRow>();
  const open = trades.filter((t) => t.status === 'open');
  const closed = trades.filter((t) => t.status === 'closed');
  const pending = closed.filter((t) => !hasReview(t));
  const portfolio = settings?.portfolio ?? DEFAULT_PORTFOLIO;
  const day = summary.data?.date ?? '';

  useEffect(() => {
    const id = route.query.get('review');
    if (id && user) setReviewing(user.trades.find((t) => t.id === id) ?? null);
  }, [route.query.get('review'), !!user]);
  useEffect(() => { if (startChecklist) setAdding(true); }, [startChecklist]);

  return (
    <div class="page">
      <TopBar back="/discipline" actions={<button class="btn small primary" onClick={() => setAdding(true)}>新增持倉</button>} />
      <PageHead eyebrow="我該記錄或檢討什麼？" title={pending.length ? `${pending.length} 筆平倉等待檢討` : `持倉 ${open.length} 筆・已平倉 ${closed.length} 筆`}>
        <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>總資金 {fmtMoney(portfolio.capital)}・單筆風險 {portfolio.riskPct}%・<a href="#/me/settings">調整</a></p>
      </PageHead>
      <DataStatus date={summary.data?.date} uses={PAGE_SOURCES.journal} />
      <div class="segmented" role="group" aria-label="日誌分頁" style={{ marginTop: 'var(--s-4)' }}>
        <button aria-pressed={tab === 'open'} onClick={() => setTab('open')}>持倉<span class="count">{open.length}</span></button>
        <button aria-pressed={tab === 'closed'} onClick={() => setTab('closed')}>已平倉<span class="count">{closed.length}</span></button>
      </div>

      {tab === 'open' ? (
        <>
          {user && !open.length ? (
            <EmptyState icon={<IconClipboard />} title="沒有持倉" text="新增前需完成買進前檢查表。" action={<button class="btn primary" onClick={() => setAdding(true)}>開始買進前檢查表</button>} />
          ) : null}
          {open.map((t) => {
            const price = byCode.get(t.code)?.close ?? null;
            // D-01：分割、減資、除權息後，進場價、停損、目標與股數換算到目前的價格基準再比較
            const ev = eventsFor(byCode.get(t.code), hist.get(t.code));
            const a = adjustTrade(t, ev);
            const pnl = unrealizedPnl(t, price, ev);
            const hitStop = price !== null && price <= a.stop;
            const hitTarget = price !== null && price >= a.target;
            return (
              <div class="card" key={t.id}>
                <div class="row between">
                  <a class="body w6" href={`#/stock/${t.code}`}>{t.name} <span class="caption muted">{t.code}</span></a>
                  <span class="body"><Signed value={pnl} format={fmtMoney} label="未實現損益" /></span>
                </div>
                <div class="caption muted">{t.openedAt}・{t.shares.toLocaleString()} 股 @ {fmtPrice(t.entry)}・現價 {fmtPrice(price)}・停損 {fmtPrice(t.stop)}・目標 {fmtPrice(t.target)}</div>
                {a.notes.length ? (
                  <div class="caption muted" data-testid="adjusted-note">{a.notes.join('、')}：換算為 {a.shares.toLocaleString()} 股 @ {fmtPrice(a.entry)}・停損 {fmtPrice(a.stop)}・目標 {fmtPrice(a.target)}</div>
                ) : null}
                {hitStop || hitTarget ? (
                  <div class="row" style={{ gap: 'var(--s-1)', marginTop: 'var(--s-1)' }}>
                    {hitStop ? <span class="tag risk">已觸及停損</span> : null}
                    {hitTarget ? <span class="tag">已達目標價</span> : null}
                  </div>
                ) : null}
                <div class="caption muted" style={{ marginTop: 'var(--s-1)' }}>理由（{t.reasonType}）：{t.checklist.reason}</div>
                <div class="row" style={{ marginTop: 'var(--s-3)' }}>
                  <button class="btn small" onClick={() => setClosing(t)}>平倉</button>
                  <button class="btn small danger" onClick={() => confirm('刪除這筆紀錄？') && deleteTrade(t.id)}>刪除</button>
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <>
          {user && !closed.length ? <EmptyState icon={<IconNotebook />} title="尚無已平倉紀錄" text="平倉後寫下檢討，第三環才會完成。" action={<button class="btn" onClick={() => setTab('open')}>查看持倉</button>} /> : null}
          {closed.map((t) => (
            <div key={t.id} class="card">
              <div class="row between">
                <span class="body w6">{t.name} <span class="caption muted">{t.code}</span></span>
                <span class="body"><Signed value={tradePnl(t)} format={fmtMoney} label="已實現損益" /></span>
              </div>
              <div class="caption muted">{t.openedAt} → {t.closedAt}・{fmtPrice(t.entry)} → {fmtPrice(t.exit)}・{t.reasonType}{t.errorTags?.length ? `・${t.errorTags.join('、')}` : ''}</div>
              {t.adjNote ? <div class="caption muted">{t.adjNote}（進場價換算為 {fmtPrice(t.entry * (t.adjFactor ?? 1))}）</div> : null}
              {hasReview(t) ? <p class="caption t1" style={{ marginTop: 'var(--s-2)' }}>{t.review}</p> : (
                <button class="btn small" style={{ marginTop: 'var(--s-3)' }} onClick={() => setReviewing(t)}>寫下檢討</button>
              )}
            </div>
          ))}
        </>
      )}

      {summary.data ? <ChecklistSheet open={adding} onClose={() => setAdding(false)} rows={summary.data.rows} portfolio={portfolio} day={day} /> : null}
      <CloseSheet trade={closing} onClose={() => setClosing(null)} costs={settings?.costs ?? DEFAULT_COSTS} price={closing ? byCode.get(closing.code)?.close ?? null : null} day={day} />
      <ReviewSheet trade={reviewing} onClose={() => setReviewing(null)} day={day} />
    </div>
  );
}
