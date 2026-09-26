import { useEffect, useMemo, useState } from 'preact/hooks';
import { Nav } from '../components/Nav';
import { DataStatus } from '../components/DataStatus';
import { Sheet } from '../components/Sheet';
import { StockSearch } from '../components/StockSearch';
import { Signed } from '../components/Change';
import { LineChart } from '../components/LineChart';
import { useAsync, useDb } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { loadJson, loadStock } from '../data/api';
import { deleteTrade, getSetting, listTrades, saveTrade, uid, type Trade } from '../db/db';
import { DEFAULT_PORTFOLIO, type PortfolioSettings } from '../lib/settings';
import { DEFAULT_COSTS, roundTrip, type CostSettings } from '../lib/costs';
import { byReason, closedStats, countBy, lossIfAllStopped, positionSize, rewardRisk } from '../lib/sizing';
import { correlation, equityCurve, maxDrawdown, monthlyReturns, normalize, alignTo, type DividendEvent } from '../lib/portfolio';
import { fmtMoney, fmtNum, fmtPct, fmtPrice } from '../lib/format';
import { adjClose } from '../lib/history';
import { thresholds } from '../lib/config';
import { todayTpe } from '../lib/dates';
import type { StockHistory, StockRow } from '../data/types';

const REASONS = ['籌碼', '動能', '營收', '估值', '事件', '其他'];
const ERROR_TAGS = ['追高', '攤平', '提早停利', '未守停損', '過度交易', '違反計畫', '消息面衝動', '部位過大'];
const MIN_RR = Number(thresholds.portfolio.min_reward_risk);

function autoChecklist(r: StockRow | undefined) {
  if (!r) return { trend: '', revenue: '', valuation: '' };
  const ma240 = r.ma240_gap as number | null;
  const ma60 = r.ma60_gap as number | null;
  const trend = ma240 === null || ma240 === undefined ? '' : ma240 > 0 && (ma60 ?? 0) > 0 ? '多頭（年線、季線之上）' : ma240 > 0 ? '年線之上、短線整理' : '年線之下';
  const y3 = r.revenue_yoy_3m as number | null;
  const revenue = y3 === null || y3 === undefined ? '' : y3 >= 20 ? '高成長（近 3 月年增 ≥ 20%）' : y3 > 0 ? '成長' : '衰退';
  const fp = r.fair_position as number | null;
  const valuation = fp === null || fp === undefined ? '' : fp <= 33 ? '偏便宜' : fp <= 67 ? '合理' : '偏貴';
  return { trend, revenue, valuation };
}

function NewTradeSheet({ open, onClose, rows, portfolio }: { open: boolean; onClose: () => void; rows: StockRow[]; portfolio: PortfolioSettings }) {
  const [row, setRow] = useState<StockRow | undefined>();
  const [f, setF] = useState({ market: '', trend: '', revenue: '', valuation: '', reasonType: '籌碼', reason: '', entry: '', stop: '', target: '', shares: '' });
  useEffect(() => {
    if (!row) return;
    const auto = autoChecklist(row);
    setF((x) => ({ ...x, ...Object.fromEntries(Object.entries(auto).filter(([, v]) => v)), entry: String(row.close ?? '') }));
  }, [row]);
  const entry = Number(f.entry), stop = Number(f.stop), target = Number(f.target);
  const rr = rewardRisk(entry, stop, target);
  const size = positionSize(portfolio.capital, portfolio.riskPct, entry, stop, portfolio.oddLot);
  const shares = f.shares ? Number(f.shares) : size.shares;
  const valid = !!row && !!f.market && !!f.trend && !!f.revenue && !!f.valuation && f.reason.trim().length > 0 && entry > 0 && stop > 0 && stop < entry && target > entry && shares > 0;
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });

  async function save() {
    if (!row || !valid) return;
    await saveTrade({
      id: uid(), code: row.code, name: row.name, status: 'open', openedAt: todayTpe(), entry, shares, stop, target, reasonType: f.reasonType,
      checklist: { market: f.market, trend: f.trend, revenue: f.revenue, valuation: f.valuation, reason: f.reason.trim() },
    });
    setRow(undefined);
    setF({ market: '', trend: '', revenue: '', valuation: '', reasonType: '籌碼', reason: '', entry: '', stop: '', target: '', shares: '' });
    onClose();
  }

  const sel = (k: keyof typeof f, label: string, options: string[]) => (
    <label class="field">
      <span>{label}</span>
      <select class="select" value={f[k]} onChange={set(k)} aria-label={label}>
        <option value="">請選擇</option>
        {[...new Set([f[k], ...options].filter(Boolean))].map((o) => <option key={o}>{o}</option>)}
      </select>
    </label>
  );

  return (
    <Sheet open={open} onClose={onClose} title="買進前檢查表">
      {!row ? <StockSearch rows={rows} onPick={setRow} /> : (
        <div class="row between"><span class="headline">{row.name} <span class="muted small">{row.code}</span></span><button class="btn small" onClick={() => setRow(undefined)}>更換</button></div>
      )}
      {sel('market', '1. 市場燈號（見市場頁）', ['偏多', '中性', '偏空'])}
      {sel('trend', '2. 趨勢', ['多頭（年線、季線之上）', '年線之上、短線整理', '年線之下'])}
      {sel('revenue', '3. 營收', ['高成長（近 3 月年增 ≥ 20%）', '成長', '衰退', '不適用'])}
      {sel('valuation', '4. 估值', ['偏便宜', '合理', '偏貴', '不適用'])}
      {sel('reasonType', '5. 理由類型', REASONS)}
      <label class="field"><span>理由（必填）</span><textarea class="input" rows={2} value={f.reason} onInput={set('reason')} /></label>
      <div class="grid three">
        <label class="field"><span>進場價</span><input class="input" type="number" inputMode="decimal" value={f.entry} onInput={set('entry')} /></label>
        <label class="field"><span>6. 停損價</span><input class="input" type="number" inputMode="decimal" value={f.stop} onInput={set('stop')} /></label>
        <label class="field"><span>7. 目標價</span><input class="input" type="number" inputMode="decimal" value={f.target} onInput={set('target')} /></label>
      </div>
      <div class="card glass small">
        <div>風險報酬比：<b class={rr !== null && rr < MIN_RR ? 'down' : ''}>{rr === null ? '—' : `1 : ${rr.toFixed(2)}`}</b>
          {rr !== null && rr < MIN_RR ? <span class="flag" style={{ marginLeft: '0.5rem' }}>低於 1:{MIN_RR}</span> : null}</div>
        <div>建議部位：{portfolio.oddLot ? `${size.shares} 股` : `${size.lots} 張`}（總資金 {fmtMoney(portfolio.capital)} × 單筆風險 {portfolio.riskPct}% ÷ 每股風險 {fmtNum(entry - stop)}）</div>
        <div>觸及停損的虧損：約 {fmtMoney((entry - stop) * shares)}</div>
        {entry > stop && stop > 0 && size.shares === 0 ? <div class="flag">依風險上限不足 1 張：可改用零股、放寬停損或自行輸入股數</div> : null}
      </div>
      <label class="field"><span>實際股數（預設為建議部位）</span><input class="input" type="number" inputMode="numeric" value={f.shares || String(size.shares)} onInput={set('shares')} /></label>
      <button class="btn primary" disabled={!valid} onClick={save} style={{ width: '100%' }}>{valid ? '加入持倉' : '請完成檢查表（停損 < 進場 < 目標）'}</button>
    </Sheet>
  );
}

function CloseSheet({ trade, onClose, costs, price }: { trade: Trade | null; onClose: () => void; costs: CostSettings; price: number | null }) {
  const [exit, setExit] = useState('');
  const [date, setDate] = useState(todayTpe());
  const [review, setReview] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => { if (trade) { setExit(String(price ?? trade.entry)); setTags([]); setReview(''); } }, [trade?.id]);
  if (!trade) return null;
  const px = Number(exit);
  const rt = px > 0 ? roundTrip(trade.entry, px, trade.shares, trade.code, costs) : null;
  async function done() {
    if (!trade || !(px > 0)) return;
    await saveTrade({ ...trade, status: 'closed', closedAt: date, exit: px, review, errorTags: tags, fees: rt?.costs ?? 0 });
    onClose();
  }
  return (
    <Sheet open={!!trade} onClose={onClose} title={`平倉：${trade.name}`}>
      <div class="grid two">
        <label class="field"><span>出場價</span><input class="input" type="number" inputMode="decimal" value={exit} onInput={(e) => setExit((e.target as HTMLInputElement).value)} /></label>
        <label class="field"><span>日期</span><input class="input" type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} /></label>
      </div>
      {rt ? <p class="small">損益（扣手續費與證交稅 {fmtMoney(rt.costs)}）：<Signed value={rt.pnl} format={fmtMoney} /></p> : null}
      <label class="field"><span>檢討</span><textarea class="input" rows={3} value={review} onInput={(e) => setReview((e.target as HTMLTextAreaElement).value)} /></label>
      <div class="chips wrap" role="group" aria-label="錯誤標籤" style={{ flexWrap: 'wrap' }}>
        {ERROR_TAGS.map((t) => (
          <button key={t} class="chip" aria-pressed={tags.includes(t)} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>{t}</button>
        ))}
      </div>
      <button class="btn primary" style={{ width: '100%', marginTop: '0.75rem' }} disabled={!(px > 0)} onClick={done}>確認平倉</button>
    </Sheet>
  );
}

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
    hist.data.forEach((h: StockHistory | null) => {
      if (!h) return;
      prices[h.code] = { dates: h.d, close: h.c };
      divs[h.code] = ((h.dividends as { date: string; cash: number; stock_ratio: number }[] | undefined) ?? []).map((d) => ({ date: d.date, cash: d.cash, stockRatio: d.stock_ratio }));
    });
    const eq = equityCurve(capital, trades, prices, divs, cal);
    const tr = idx.data.series['發行量加權股價報酬指數'];
    const trAligned = cal.map((d) => tr[idx.data!.dates.indexOf(d)] ?? null);
    const etfAdj = etf.data ? alignTo(cal, { dates: etf.data.d, close: adjClose(etf.data) }) : cal.map(() => null);
    return { cal, eq, trAligned, etfAdj, divs };
  }, [hist.data, idx.data, etf.data, trades, capital]);
  if (!trades.length) return <div class="empty">尚無交易紀錄。</div>;
  if (!data) return <div class="card small muted">資料載入中或資料不足（需要已部署的歷史價格）。</div>;
  const values = data.eq.map((p) => p.equity);
  const mdd = maxDrawdown(values);
  const months = monthlyReturns(data.eq);
  const realized = trades.filter((t) => t.status === 'closed').reduce((s, t) => s + ((t.exit ?? 0) - t.entry) * t.shares - (t.fees ?? 0), 0);
  const unrealized = trades.filter((t) => t.status === 'open').reduce((s, t) => s + ((byCode.get(t.code)?.close ?? t.entry) - t.entry) * t.shares, 0);
  const total = values[values.length - 1] / capital - 1;
  const trRet = data.trAligned[0] && data.trAligned[data.trAligned.length - 1] ? (data.trAligned[data.trAligned.length - 1] as number) / (data.trAligned[0] as number) - 1 : null;
  const etfFirst = data.etfAdj.find((v) => v !== null);
  const etfRet = etfFirst && data.etfAdj[data.etfAdj.length - 1] ? (data.etfAdj[data.etfAdj.length - 1] as number) / etfFirst - 1 : null;
  return (
    <>
      <div class="card">
        <div class="grid two small">
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
          { label: '我的權益', color: 'var(--tint)', values: normalize(values) },
          { label: '0050（還原）', color: '#af52de', values: normalize(data.etfAdj) },
          { label: '加權報酬指數', color: '#8e8e93', values: normalize(data.trAligned) },
        ]} />
        <p class="tiny muted">以期初資金為 100 標準化；權益曲線自動計入除息現金股利與除權配股。</p>
      </div>
      <h2 class="section-title">月報酬</h2>
      <div class="card scroll-x">
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
  const positions = open.map((t) => ({ ...t, price: byCode.get(t.code)?.close ?? t.entry, industry: byCode.get(t.code)?.industry ?? '未知' }));
  const total = positions.reduce((s, p) => s + p.price * p.shares, 0);
  const byInd = new Map<string, number>();
  positions.forEach((p) => byInd.set(p.industry ?? '未知', (byInd.get(p.industry ?? '未知') ?? 0) + p.price * p.shares));
  const loss = lossIfAllStopped(positions.map((p) => ({ shares: p.shares, stop: p.stop, price: p.price })));
  const hs = (hist.data ?? []).filter((h): h is StockHistory => !!h);
  return (
    <>
      <div class="card small">
        <div>持倉市值 {fmtMoney(total)} · 全部觸及停損的總虧損 <b class="down">{fmtMoney(loss)}</b></div>
      </div>
      <h2 class="section-title">產業集中度</h2>
      <div class="card">
        {[...byInd.entries()].sort((a, b) => b[1] - a[1]).map(([ind, v]) => (
          <div key={ind} style={{ marginBottom: '0.375rem' }}>
            <div class="row between small"><span>{ind}</span><span>{fmtPct((v / (total || 1)) * 100, 1, false)}</span></div>
            <div class="bar"><i style={{ width: `${(v / (total || 1)) * 100}%` }} /></div>
          </div>
        ))}
      </div>
      {hs.length >= 2 ? (
        <>
          <h2 class="section-title">持股相關性（近 60 日）</h2>
          <div class="card scroll-x">
            <table class="table">
              <thead><tr><th></th>{hs.map((h) => <th key={h.code}>{h.name}</th>)}</tr></thead>
              <tbody>
                {hs.map((a) => {
                  const pa = adjClose(a);
                  return (
                    <tr key={a.code}><td>{a.name}</td>{hs.map((b) => {
                      const c = a.code === b.code ? 1 : correlation(pa, alignTo(a.d, { dates: b.d, close: adjClose(b) }));
                      return <td key={b.code} class={c !== null && c > 0.7 && a.code !== b.code ? 'up' : ''}>{c === null ? '—' : c.toFixed(2)}</td>;
                    })}</tr>
                  );
                })}
              </tbody>
            </table>
            <p class="tiny muted">相關係數 &gt; 0.7 以紅色標示，代表風險可能集中。</p>
          </div>
        </>
      ) : null}
    </>
  );
}

export default function Journal() {
  const summary = useScoredSummary();
  const trades = useDb(listTrades) ?? [];
  const settings = useDb(async () => ({
    portfolio: await getSetting<PortfolioSettings>('portfolio', DEFAULT_PORTFOLIO),
    costs: await getSetting<CostSettings>('costs', DEFAULT_COSTS),
  }));
  const [tab, setTab] = useState<'open' | 'closed' | 'stats' | 'portfolio'>('open');
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState<Trade | null>(null);
  const byCode = summary.data?.byCode ?? new Map<string, StockRow>();
  const open = trades.filter((t) => t.status === 'open');
  const closed = trades.filter((t) => t.status === 'closed');
  const stats = closedStats(trades);
  const tags = countBy(closed, (t) => t.errorTags);
  const portfolio = settings?.portfolio ?? DEFAULT_PORTFOLIO;

  return (
    <div>
      <Nav title="日誌" actions={<button class="btn small primary" onClick={() => setAdding(true)}>新增持倉</button>} />
      <DataStatus date={summary.data?.date} />
      <div class="card small">總資金 {fmtMoney(portfolio.capital)} · 單筆風險 {portfolio.riskPct}% · <a href="#/more/settings">調整</a></div>
      <div class="segmented" role="group" aria-label="日誌分頁">
        {([['open', `持倉 ${open.length}`], ['closed', `已平倉 ${closed.length}`], ['stats', '統計'], ['portfolio', '組合分析']] as const).map(([id, l]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{l}</button>
        ))}
      </div>

      {tab === 'open' ? (
        <>
          {!open.length ? <div class="empty">沒有持倉。新增前需完成買進前檢查表。</div> : null}
          {open.map((t) => {
            const price = byCode.get(t.code)?.close ?? null;
            const pnl = price !== null ? (price - t.entry) * t.shares : null;
            const hitStop = price !== null && price <= t.stop;
            const hitTarget = price !== null && price >= t.target;
            return (
              <div class="card" key={t.id}>
                <div class="row between">
                  <a class="headline" href={`#/stock/${t.code}`}>{t.name} <span class="small muted">{t.code}</span></a>
                  <Signed value={pnl} format={fmtMoney} label="未實現損益" />
                </div>
                <div class="small muted">{t.openedAt} · {t.shares.toLocaleString()} 股 @ {fmtPrice(t.entry)} · 現價 {fmtPrice(price)} · 停損 {fmtPrice(t.stop)} · 目標 {fmtPrice(t.target)}</div>
                {hitStop ? <div class="flag danger">⚠︎ 已觸及停損</div> : null}
                {hitTarget ? <div class="flag">◎ 已達目標價</div> : null}
                <div class="tiny muted">理由（{t.reasonType}）：{t.checklist.reason}</div>
                <div class="row" style={{ marginTop: '0.5rem' }}>
                  <button class="btn small" onClick={() => setClosing(t)}>平倉</button>
                  <button class="btn small danger" onClick={() => confirm('刪除這筆紀錄？') && deleteTrade(t.id)}>刪除</button>
                </div>
              </div>
            );
          })}
          {open.length ? <RiskPanel open={open} byCode={byCode} /> : null}
        </>
      ) : null}

      {tab === 'closed' ? (
        <div class="list">
          {closed.map((t) => (
            <div key={t.id} class="list-item" style={{ alignItems: 'flex-start' }}>
              <div class="grow">
                <div class="small"><b>{t.name}</b> {t.openedAt} → {t.closedAt}</div>
                <div class="tiny muted">{fmtPrice(t.entry)} → {fmtPrice(t.exit)} · {t.reasonType}{t.errorTags?.length ? ` · ${t.errorTags.join('、')}` : ''}</div>
                {t.review ? <div class="tiny">{t.review}</div> : null}
              </div>
              <Signed value={((t.exit ?? 0) - t.entry) * t.shares - (t.fees ?? 0)} format={fmtMoney} />
            </div>
          ))}
          {!closed.length ? <div class="empty">尚無已平倉紀錄。</div> : null}
        </div>
      ) : null}

      {tab === 'stats' ? (
        <>
          <div class="card">
            <div class="grid two small">
              <div>交易筆數 <b>{stats.n}</b></div>
              <div>勝率 <b>{stats.winRate === null ? '—' : fmtPct(stats.winRate * 100, 1, false)}</b></div>
              <div>平均賺賠比 <b>{stats.payoff === null ? '—' : stats.payoff.toFixed(2)}</b></div>
              <div>平均持有 <b>{stats.avgHoldDays === null ? '—' : `${stats.avgHoldDays.toFixed(1)} 天`}</b></div>
              <div>期望值（金額）<b>{stats.evAmount === null ? '—' : fmtMoney(stats.evAmount)}</b></div>
              <div>期望值（R）<b>{stats.evR === null ? '—' : `${stats.evR.toFixed(2)} R`}</b></div>
            </div>
          </div>
          <h2 class="section-title">錯誤標籤頻率</h2>
          <div class="card">
            {Object.keys(tags).length ? Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
              <div key={t} class="row between small"><span>{t}</span><span>{n} 次</span></div>
            )) : <p class="small muted">尚無資料。</p>}
          </div>
          <h2 class="section-title">各理由類型績效</h2>
          <div class="card scroll-x">
            <table class="table">
              <thead><tr><th>理由</th><th>筆數</th><th>勝率</th><th>期望值</th></tr></thead>
              <tbody>{byReason(trades).map(({ reason, stats: s }) => (
                <tr key={reason}><td>{reason}</td><td>{s.n}</td><td>{s.winRate === null ? '—' : fmtPct(s.winRate * 100, 0, false)}</td><td>{s.evAmount === null ? '—' : fmtMoney(s.evAmount)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'portfolio' ? <Portfolio trades={trades} capital={portfolio.capital} byCode={byCode} /> : null}

      {summary.data ? <NewTradeSheet open={adding} onClose={() => setAdding(false)} rows={summary.data.rows} portfolio={portfolio} /> : null}
      <CloseSheet trade={closing} onClose={() => setClosing(null)} costs={settings?.costs ?? DEFAULT_COSTS} price={closing ? byCode.get(closing.code)?.close ?? null : null} />
    </div>
  );
}
