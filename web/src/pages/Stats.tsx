/** 個人統計：交易統計、錯誤標籤、理由類型績效、組合權益曲線（對照 0050 與加權報酬指數）、產業集中度與相關性。 */
import { useMemo } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { Loading } from '../components/DataStatus';
import { Card, CardLabel, EmptyRow, List, Num, PageTitle, Row, Section, Signed as USigned, StatGrid, Table, type Stat } from '../components/ui';
import { useFlow, type FlowState } from '../data/useFlow';
import { compliantSplit, recentViolations, rSummary, type GroupStat } from '../lib/flowStats';
import { completionRate, VIOLATION_TAGS } from '../lib/ritual';
import { uiConfig } from '../lib/config';
import { LineChart } from '../components/LineChart';
import { useAsync, useDb } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { useUser } from '../data/useUser';
import { loadJson, loadStock } from '../data/api';
import { getSetting, type Trade } from '../db/db';
import type { StockHistory, StockRow } from '../data/types';
import { DEFAULT_PORTFOLIO, type PortfolioSettings } from '../lib/settings';
import { byReason, countBy, lossIfAllStopped, tradePnl } from '../lib/sizing';
import { adjustTrade, eventsFor, unrealizedPnl, type AdjEvent } from '../lib/corpActions';
import { alignTo, correlation, equityCurve, maxDrawdown, monthlyReturns, normalize, type DividendEvent } from '../lib/portfolio';
import { adjClose } from '../lib/history';
import { orMissing, pctSigned, ratioText } from '../lib/format';

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
  if (!data) return <List><EmptyRow>資料載入中或歷史價格不足</EmptyRow></List>;
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
      <Card>
        <StatGrid items={[
          { label: '總報酬', value: <USigned v={total * 100} unit="%" /> },
          { label: '最大回撤', value: <Num v={-mdd * 100} digits={2} unit="%" /> },
          { label: '已實現損益', value: <USigned v={realized} digits={0} unit="元" /> },
          { label: '未實現損益', value: <USigned v={unrealized} digits={0} unit="元" /> },
          { label: '0050（還原）同期', value: <USigned v={etfRet === null ? null : etfRet * 100} unit="%" tone="plain" /> },
          { label: '加權報酬指數同期', value: <USigned v={trRet === null ? null : trRet * 100} unit="%" tone="plain" /> },
        ]} />
      </Card>
      <Card>
        <LineChart dates={data.cal} ariaLabel={`權益曲線，總報酬 ${pctSigned(total * 100)}，最大回撤 ${pctSigned(-mdd * 100)}`} lines={[
          { label: '我的權益', tone: 'primary', values: normalize(values) },
          { label: '0050（還原）', tone: 'secondary', dash: '5 4', values: normalize(data.etfAdj) },
          { label: '加權報酬指數', tone: 'secondary', dash: '1 4', values: normalize(data.trAligned) },
        ]} />
      </Card>
      <Card>
        <Table cols={[
          { key: 'm', label: '月份', render: (m) => m.month },
          { key: 'r', label: '報酬', align: 'r', render: (m) => <USigned v={m.ret * 100} unit="%" /> },
        ]} rows={months} rowKey={(m) => m.month} caption="月報酬" />
      </Card>
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
      <List>
        <Row label="持倉市值" value={<Num v={total} unit="元" />} />
        <Row label="全部觸及停損的虧損" value={<span class="ui-risk"><Num v={loss} unit="元" /></span>}
          sub={positions.some((p) => !(p.stop > 0)) ? `${positions.filter((p) => !(p.stop > 0)).length} 筆未設停損，不計入` : undefined} />
      </List>
      <Card>
        <CardLabel>產業集中度</CardLabel>
        <List>
          {[...byInd.entries()].sort((a, b) => b[1] - a[1]).map(([ind, v]) => <Row key={ind} label={ind} value={<Num v={(v / (total || 1)) * 100} digits={1} unit="%" />} />)}
        </List>
      </Card>
      {hs.length >= 2 ? (
        <>
          <Card>
            <CardLabel>持股相關性（近 60 日）</CardLabel>
            <table class="ui-table">
              <thead><tr><th class="l"></th>{hs.map((h) => <th key={h.code} class="r">{h.name}</th>)}</tr></thead>
              <tbody>
                {hs.map((a) => {
                  const pa = adjClose(a);
                  return (
                    <tr key={a.code}><td class="l">{a.name}</td>{hs.map((b) => {
                      const c = a.code === b.code ? 1 : correlation(pa, alignTo(a.d, { dates: b.d, close: adjClose(b) }));
                      return <td key={b.code} class={`r ${c !== null && c > 0.7 && a.code !== b.code ? 'ui-risk' : ''}`}>{orMissing(c, ratioText, '重疊日數不足')}</td>;
                    })}</tr>
                  );
                })}
              </tbody>
            </table>
            <p class="ui-foot ui-muted">相關係數 &gt; 0.7 以橘色標示。</p>
          </Card>
        </>
      ) : null}
    </>
  );
}

function fmtR(v: number | null): string {
  if (v === null) return '—';
  const a = Math.abs(v).toFixed(2);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${a}`;
}

/** §8.8：以 R 計、合規 vs 不合規、違規標籤次數、近 20 個交易日流程完成率 */
function FlowStats({ flow }: { flow: FlowState }) {
  const s = rSummary(flow.input.trades);
  const split = compliantSplit(flow.input);
  const vio = recentViolations(flow.input);
  const done = completionRate(flow.streak.days);
  const g = uiConfig.gamification;
  const grp = (name: string, x: GroupStat): Stat[] => [
    { label: `${name}・${x.n} 筆`, value: x.enough ? <Num v={`${fmtR(x.avgR)} R`} /> : x.text, testid: `split-${name}` },
    { label: `${name}勝率`, value: x.enough ? <Num v={x.winRate === null ? null : Math.round(x.winRate * 100)} unit="%" /> : '—' },
  ];
  const [c1, c2] = grp('合規', split.compliant);
  const [v1, v2] = grp('不合規', split.violation);
  return (
    <>
      <Section title="R 統計" testid="stats-r" info={<>
        <p>R＝實現損益（含手續費與證交稅）÷ 計畫風險金額；計畫風險＝(進場價 − 停損價) × 股數。</p>
        <p>勝率＝實現損益 &gt; 0 的比例；期望值 R＝平均 R。沒有停損的交易無法換算 R，只計入筆數。</p>
      </>}>
        <Card>
          <StatGrid items={[
            { label: '已平倉', value: <Num v={s.n} unit="筆" /> },
            { label: '勝率', value: <Num v={s.winRate === null ? null : Math.round(s.winRate * 100)} unit="%" /> },
            { label: '平均獲利', value: <Num v={s.avgWinR === null ? null : `${fmtR(s.avgWinR)} R`} /> },
            { label: '平均虧損', value: <Num v={s.avgLossR === null ? null : `${fmtR(s.avgLossR)} R`} /> },
            { label: '期望值', value: <Num v={s.expectancyR === null ? null : `${fmtR(s.expectancyR)} R`} /> },
            { label: '可換算 R', value: <Num v={s.rN} unit="筆" /> },
          ]} />
        </Card>
      </Section>
      <Section title="合規與不合規" testid="stats-split" info={<>
        <p>合規＝進場前完成檢查表、有停損價、計畫風險 ≤ 每筆風險上限、平倉後 {g.review_due_trading_days} 個交易日內完成檢討、虧損出場時實際虧損 ≤ 計畫風險 × {g.loss_tolerance}，五項全過。</p>
        <p>任一組少於 {g.min_group_sample} 筆時只顯示樣本不足，不顯示數值。檢討期限內尚未檢討的平倉不列入兩組。</p>
      </>} aside={split.pending ? `待結算 ${split.pending} 筆` : undefined}>
        <Card><StatGrid items={[c1, v1, c2, v2]} /></Card>
      </Section>
      <Section title="違規標籤" aside={`近 ${vio.trades} 筆`} testid="stats-violations" info={<p>只記錄、不扣分。未檢查、無停損、超過風險上限在進場時判定；虧損超出計畫在平倉時判定；逾期檢討在平倉後第 {g.review_due_trading_days} 個交易日的期限過後判定。</p>}>
        <List>
          {VIOLATION_TAGS.map((t) => <Row key={t} label={t} value={<Num v={vio.counts[t]} unit="次" />} />)}
        </List>
      </Section>
      <Section title="流程完成率" testid="stats-completion" info={<p>近 {g.history_days} 個交易日中三環全部完成的日數；寬限日算未完成，期限未到的當日不計入。</p>}>
        <List>
          <Row label={`近 ${g.history_days} 個交易日`} value={<Num v={done.rate === null ? null : `${done.done}/${done.total}（${Math.round(done.rate * 100)}%）`} />} />
        </List>
      </Section>
    </>
  );
}

export default function Stats() {
  const summary = useScoredSummary();
  const user = useUser();
  const flow = useFlow();
  const portfolio = useDb(() => getSetting<PortfolioSettings>('portfolio', DEFAULT_PORTFOLIO)) ?? DEFAULT_PORTFOLIO;
  if (!user || !flow) return <div class="page"><TopBar back="/discipline" /><PageTitle title="個人統計" /><Loading /></div>;
  const trades = user.trades;
  const closed = trades.filter((t) => t.status === 'closed');
  const open = trades.filter((t) => t.status === 'open');
  const tags = countBy(closed, (t) => t.errorTags);
  const byCode = summary.data?.byCode ?? new Map<string, StockRow>();
  return (
    <div class="page">
      <TopBar back="/discipline" />
      <PageTitle title="個人統計" sub={`已平倉 ${closed.length} 筆・持倉 ${open.length} 筆`} />
      <FlowStats flow={flow} />
      {!trades.length ? (
        <div class="ui-sec"><List chev><Row label="無交易紀錄" sub="新增持倉前檢查表" href="#/discipline/checklist" /></List></div>
      ) : (
        <>
          <Section title="錯誤標籤" aside="自選標籤">
            <List>
              {Object.keys(tags).length ? Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([t, n]) => <Row key={t} label={t} value={<Num v={n} unit="次" />} />)
                : <EmptyRow>無</EmptyRow>}
            </List>
          </Section>
          <Section title="理由類型">
            <Card>
              <Table cols={[
                { key: 'r', label: '理由', render: (x) => x.reason },
                { key: 'n', label: '筆數', align: 'r', render: (x) => x.stats.n },
                { key: 'w', label: '勝率', align: 'r', render: (x) => <Num v={x.stats.winRate === null ? null : x.stats.winRate * 100} digits={0} unit="%" /> },
                { key: 'e', label: '期望值', align: 'r', width: '7rem', render: (x) => <USigned v={x.stats.evAmount} digits={0} unit="元" /> },
              ]} rows={byReason(trades)} rowKey={(x) => x.reason} caption="各理由類型績效" />
            </Card>
          </Section>
          <Section title="組合分析" info={<p>以期初資金為 100 標準化；權益曲線計入除息現金股利與除權配股。</p>}>
            <Portfolio trades={trades} capital={portfolio.capital} byCode={byCode} />
          </Section>
          {open.length ? (
            <Section title="持倉風險">
              <RiskPanel open={open} byCode={byCode} />
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}
