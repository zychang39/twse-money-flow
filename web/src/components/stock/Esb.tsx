/**
 * 個股頁 › 興櫃股票（2026-11-14，DECISIONS #465）：只顯示興櫃有的資料（當日均價、最高、最低、成交量、均價走勢），
 * 並說明為什麼沒有分數、籌碼與估值（產品原則 5：資料不足時說明原因，不留白）。
 */
import type { StockHistory } from '../../data/types';
import { esbFacts } from '../../lib/esb';
import { fmtNum, fmtPrice } from '../../lib/format';
import { Card, Section, Signed } from '../ui';

const mdy = (iso: string) => `${Number(iso.slice(0, 4))}/${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

export function EsbPane({ h }: { h: StockHistory }) {
  const f = esbFacts(h);
  return (
    <>
      <Card testid="esb-note" label="興櫃股票說明">
        <p class="ui-body"><b>興櫃股票</b>：買賣雙方議價成交，沒有開盤價與收盤價，這裡的價格是<b>當日均價</b>（成交金額 ÷ 成交股數）。</p>
        <p class="ui-foot ui-muted">興櫃沒有三大法人、融資融券、本益比等公開資料，所以不計分，也不列入排行、選股與回測；可以搜尋、看走勢、加入自選。沒有漲跌幅限制，成交量通常較少，同一天的最高與最低可能差很多。</p>
      </Card>
      {f ? (
        <>
          <Section title="最近成交日" aside={mdy(f.date)} testid="esb-last">
            <div class="metrics">
              <div class="metric"><span class="metric-l">當日均價</span><span class="metric-v">{fmtPrice(f.avg)}</span></div>
              <div class="metric"><span class="metric-l">成交量</span><span class="metric-v">{f.lots === null ? '—' : fmtNum(f.lots, 0)}<span class="ui-unit"> 張</span></span></div>
              <div class="metric"><span class="metric-l">最高</span><span class="metric-v">{f.high === null ? '—' : fmtPrice(f.high)}</span></div>
              <div class="metric"><span class="metric-l">最低</span><span class="metric-v">{f.low === null ? '—' : fmtPrice(f.low)}</span></div>
              <div class="metric"><span class="metric-l">成交金額</span><span class="metric-v">{f.valueM === null ? '—' : fmtNum(f.valueM, 1)}<span class="ui-unit"> 百萬元</span></span></div>
            </div>
          </Section>
          <Section title="均價變化" testid="esb-ret">
            <div class="metrics">
              {f.ret.map((r) => (
                <div class="metric" key={r.n}>
                  <span class="metric-l">近 {r.n} 個成交日</span>
                  <span class="metric-v">{r.pct === null ? '—' : <Signed v={r.pct} digits={1} unit="%" />}</span>
                </div>
              ))}
              <div class="metric"><span class="metric-l">期間最高均價</span><span class="metric-v">{fmtPrice(f.rangeHigh)}</span></div>
              <div class="metric"><span class="metric-l">期間最低均價</span><span class="metric-v">{fmtPrice(f.rangeLow)}</span></div>
            </div>
            <p class="ui-foot ui-muted esb-cov" data-testid="esb-coverage">資料累積中：目前有 {f.days} 個成交日（自 {mdy(f.since)} 起）；沒有成交的日子不列入。資料來源：櫃買中心興櫃股票行情。</p>
          </Section>
        </>
      ) : <p class="ui-foot ui-muted">資料累積中：這檔興櫃股票還沒有成交紀錄。</p>}
    </>
  );
}
