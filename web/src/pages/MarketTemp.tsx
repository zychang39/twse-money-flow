/**
 * 市場溫度（M4：長度規則）：黏性分段「指標｜期貨｜寬度｜法人」（?seg=）。
 * 指標＝資金指標＋市場溫度；期貨＝期貨與選擇權；寬度＝市場寬度；法人＝三大法人＋外資＋投信買超金額前 10。
 */
import { useMemo } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { BreadthList, FlowsCard, FuturesCard, LightsBasis, LightsList, ValidationNote } from '../components/Market';
import { EmptyRow, List, PageTitle, Row, Section, Seg, Signed } from '../components/ui';
import { useAsync, useSegParam } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { loadMarket } from '../data/api';
import { envConclusion, envCounts, envInfo } from '../lib/envState';
import { setListContext } from '../lib/listContext';
import { md } from '../lib/format';
import { PageStale } from '../components/DataStatus';

export default function MarketTemp() {
  const market = useAsync(loadMarket, []);
  const summary = useScoredSummary();
  const [seg, setSeg] = useSegParam(['env', 'fut', 'breadth', 'flows'] as const, 'env', 'seg', 'market-temp');
  const m = market.data;
  const env = envInfo(m?.env?.lights);
  const conclusion = envConclusion(env, m?.env?.validation);
  const amount = (r: { foreign_net_lots?: number | null; trust_net_lots?: number | null; close?: number | null }) =>
    (((r.foreign_net_lots ?? 0) + (r.trust_net_lots ?? 0)) * 1000 * (r.close ?? 0)) / 1e8;
  const top = useMemo(() => (summary.data ? [...summary.data.rows].filter((r) => (r.value_million ?? 0) > 50)
    .sort((a, b) => amount(b) - amount(a)).slice(0, 10) : []), [summary.data]);
  return (
    <div class="page">
      <TopBar back="/explore" />
      <PageTitle title="市場溫度" sub={m ? `資料至 ${md(m.date)}・${envCounts(env)}${conclusion ? ` → ${conclusion}` : ''}` : undefined} />
      <PageStale />
      {market.error ? <ErrorState error={market.error} /> : null}
      {market.loading ? <Loading /> : null}
      {m ? (
        <div class="sk-seg">
          <Seg options={[['env', '指標'], ['fut', '期貨'], ['breadth', '寬度'], ['flows', '法人']] as const} value={seg} onChange={setSeg} label="市場溫度分段" sticky testid="market-seg" />
        </div>
      ) : null}
      {m && seg === 'env' ? (
        <>
          <Section title="資金指標" testid="env-lights" info={
            <>
              <p>5 項指標中任一項為風險 → 保守；沒有風險且有利 ≥ 3 項 → 積極；其餘中性。結論只在驗證顯著時顯示。</p>
              {m.env ? <LightsBasis lights={m.env.lights} /> : null}
              <p>外資台指期淨未平倉百分位：最新值在最近 250 個交易日中的百分位（≤ 最新值的日數 ÷ 250）。</p>
              <ValidationNote v={m.env?.validation} />
            </>
          }>
            {m.env ? <LightsList lights={m.env.lights} /> : <List><EmptyRow>資料源待處理</EmptyRow></List>}
          </Section>

          {m.temperature ? (
            <Section title="市場溫度" testid="temp-lights" info={
              <>
                <p>反向參考：過熱標風險、過冷標有利；只列數字與門檻，未經效度驗證。</p>
                <LightsBasis lights={m.temperature.lights} />
              </>
            }>
              <LightsList lights={m.temperature.lights} />
            </Section>
          ) : null}
        </>
      ) : null}
      {m && seg === 'fut' ? (
          <Section title="期貨與選擇權" info={
            <>
              <p>外資台指期淨未平倉：大台約當口數＝大台＋小台 ÷ 4＋微台 ÷ 20；正＝淨多、負＝淨空。</p>
              <p>小台散戶多空比：(散戶多 − 散戶空) ÷ 小台全市場未平倉；散戶多＝全市場 − 三大法人多方未平倉。</p>
              <p>選擇權 P/C 比：賣權未平倉量 ÷ 買權未平倉量 × 100；只列數字，不設門檻。</p>
              <p>資料來源：臺灣期貨交易所。</p>
            </>
          }>
            <FuturesCard market={m} />
          </Section>
      ) : null}
      {m && seg === 'breadth' ? (
          <Section title="市場寬度" info={
            <>
              <p>普通股（不含 ETF、ETN）。漲跌家數用官方漲跌（相對參考價）。</p>
              <p>站上均線：還原收盤價高於 20／60／240 日均線的比例，分母為當日有收盤且均線可算的檔數。</p>
              <p>60 日新高／新低：收盤 ≥／≤ 近 60 日最高／最低收盤。52 週新高／新低：還原收盤 ≥／≤ 最近 250 個交易日（含當日）最高／最低收盤；窗內至少 240 個收盤的股票才列入（{m.breadth.n52 ?? 0} 檔）。</p>
            </>
          }>
            <BreadthList breadth={m.breadth} />
          </Section>
      ) : null}
      {m && seg === 'flows' ? (
        <>
          <Section title="三大法人" info={
            <>
              <p>{m.flows_source ?? '三大法人買賣超金額（億元）'}</p>
              <p>外資＝外資及陸資（不含外資自營商）；自營商＝自行買賣＋避險。標「估」的日子以個股買賣超股數 × 收盤價估算。</p>
            </>
          }>
            <FlowsCard flows={m.flows} />
          </Section>

          <Section title="外資＋投信買超金額" info={<p>當日外資＋投信淨買賣超張數 × 1,000 × 收盤價（億元）；只列當日成交金額 5,000 萬元以上的股票，前 10 名。</p>}>
            <List chev>
              {top.length ? top.map((r) => (
                <Row key={r.code} label={<>{r.name} <span class="ui-muted">{r.code}</span></>} value={<Signed v={amount(r)} digits={2} unit="億" />}
                  href={`#/stock/${r.code}`} onClick={() => setListContext({ name: '外資＋投信買超金額', codes: top.map((x) => x.code) })} />
              )) : <EmptyRow>資料載入中</EmptyRow>}
            </List>
          </Section>
        </>
      ) : null}
    </div>
  );
}
