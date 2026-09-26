/** 方法說明：直接讀取 /config（與 pipeline 相同的設定）自動產生，設定改了這頁就跟著改。 */
import { Nav } from '../components/Nav';
import { CATEGORY_IDS, costsConfig, scoresConfig, thresholds, type Mapping } from '../lib/config';

function mappingText(m: Mapping, unit: string): string {
  switch (m.type) {
    case 'linear': {
      const better = m.x1 > m.x0 ? '越大越好' : '越小越好';
      return `線性：${m.x0}${unit} → 0 分、${m.x1}${unit} → 100 分（${better}，超出截斷）`;
    }
    case 'identity':
      return '百分位直接作為分數（0–100）';
    case 'inverse':
      return '分數 = 100 − 百分位（越低越好）';
    case 'margin_matrix':
      return `融資 5 日變化 > +${m.threshold_pct}% 且股價跌 → ${m.scores.up_price_down}；融資增且股價漲 → ${m.scores.up_price_up}；融資 < −${m.threshold_pct}% 且股價跌 → ${m.scores.down_price_down}；融資減且股價漲 → ${m.scores.down_price_up}；其餘 ${m.scores.flat}`;
  }
}

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section>
      <h2 class="title-2">{title}</h2>
      <div class="card">{children}</div>
    </section>
  );
}

export default function Methodology() {
  const th = thresholds;
  const w = scoresConfig.composite.weights;
  const wsum = CATEGORY_IDS.reduce((s, c) => s + w[c], 0);
  const rf = th.risk_flags as Record<string, { label: string; description: string; [k: string]: unknown }>;
  const bt = th.backtest;
  const fv = th.fair_value;
  const ind = th.indicators;
  return (
    <div>
      <Nav title="方法說明" back="/more" subtitle="依設定檔自動產生；所有報酬、均線、RS、回測使用還原價" />
      <Section title="綜合分">
        <p class="small">{scoresConfig.composite.description}</p>
        <table class="table">
          <thead><tr><th>類別</th><th>預設權重</th></tr></thead>
          <tbody>
            {CATEGORY_IDS.map((c) => <tr key={c}><td>{scoresConfig.categories[c].label}</td><td>{((w[c] / wsum) * 100).toFixed(0)}%</td></tr>)}
          </tbody>
        </table>
        <p class="tiny muted">類別分 = 可用因子子分數依權重平均（缺資料的因子不計）；綜合分至少需要 2 個類別有分數。權重不以歷史資料最佳化，可在設定頁調整。</p>
      </Section>

      {CATEGORY_IDS.map((cid) => {
        const cat = scoresConfig.categories[cid];
        return (
          <Section key={cid} title={cat.label}>
            <p class="small">{cat.description}</p>
            {cat.factors.map((f) => (
              <div key={f.id} style={{ padding: '0.5rem 0', borderTop: '0.5px solid var(--separator)' }}>
                <div class="row between"><span class="bold small">{f.label}</span><span class="badge">權重 {f.weight}</span></div>
                <div class="small">{f.description}</div>
                <div class="tiny muted">{mappingText(f.mapping, f.unit === '%' || f.unit === '百分點' ? (f.unit === '%' ? '%' : 'pp') : '')}</div>
              </div>
            ))}
          </Section>
        );
      })}

      <Section title="風險旗標（不併入分數）">
        {Object.entries(rf).map(([id, f]) => (
          <div key={id} style={{ padding: '0.375rem 0', borderTop: '0.5px solid var(--separator)' }}>
            <div class="bold small">{f.label}</div>
            <div class="small">{f.description}</div>
            <div class="tiny muted">
              {Object.entries(f).filter(([k]) => !['label', 'description'].includes(k)).map(([k, v]) => `${k}=${v}`).join('、')}
            </div>
          </div>
        ))}
        <p class="small">處置風險預警：官方「注意累計次數可能達處置標準」名單優先；另自行累計連續注意 ≥ {th.disposition_warning.consecutive_days} 日、近 10 日 ≥ {th.disposition_warning.within_10_days} 次、近 30 日 ≥ {th.disposition_warning.within_30_days} 次時標示「可能進入處置」。</p>
      </Section>

      <Section title="指標">
        <ul class="small" style={{ paddingLeft: '1.25rem', margin: 0 }}>
          <li>還原價：除權息、減資、面額變更、ETF 分割以「參考價 ÷ 前收」為因子向後調整；官方表未涵蓋的價格跳空（±35%）以推估處理並列在資料健康頁。</li>
          <li>RS：近 {ind.rs.windows.join('、')} 個交易日還原報酬，權重 {ind.rs.weights.map((x: number) => x * 100).join('/')}，換算成全市場普通股百分位。</li>
          <li>估值百分位：本益比與淨值比在自身近 {ind.valuation_percentile.lookback_days} 個交易日中的百分位（至少 {ind.valuation_percentile.min_observations} 日）；虧損時不計本益比。</li>
          <li>千張大戶：集保持股分級 {ind.whale.level_1000.join('、')}；400 張以上：分級 {ind.whale.level_400.join('、')}；排除分級 {ind.whale.excluded_levels.join('、')}。外資託管也計入大戶。</li>
          <li>散戶多空比（小台，微台另算）：散戶多單 = 全市場未平倉 − 法人多方未平倉；散戶空單 = 全市場未平倉 − 法人空方未平倉；多空比 = (多 − 空) ÷ 全市場未平倉。</li>
          <li>月營收：年增率、月增率、累計年增率、是否創 12 個月新高、連續成長月數。</li>
          <li>法人成本線（估算）：外資、投信的淨買超股數 × 當日均價（成交金額 ÷ 成交股數），{ind.cost_line_windows.join('／')} 日視窗，只納入淨買超日。</li>
          <li>相關性：近 {ind.correlation.window} 日還原日報酬（至少 {ind.correlation.min_observations} 日）。</li>
        </ul>
      </Section>

      <Section title="合理價區間">
        <ul class="small" style={{ paddingLeft: '1.25rem', margin: 0 }}>
          <li>本益比河流：近四季 EPS × 自身 3 年本益比第 {fv.pe_quantiles.join('／')} 百分位 → 便宜／合理／昂貴。</li>
          <li>殖利率法：近 {fv.dividend_years} 年平均現金股利 × {fv.yield_multiples.join('／')} 倍 → 便宜／合理／昂貴。</li>
          <li>淨值比法：每股淨值 × 自身 3 年淨值比第 {fv.pb_quantiles.join('／')} 百分位。</li>
          <li>綜合區間為各方法平均；股價位置 = (股價 − 便宜價) ÷ (昂貴價 − 便宜價)。</li>
        </ul>
      </Section>

      <Section title="交易成本">
        <p class="small">手續費 {(costsConfig.commission.rate * 100).toFixed(4)}%（買賣各一次）× 折扣 {costsConfig.commission.discount}，最低 {costsConfig.commission.minimum} 元（可在設定關閉）；證交稅於賣出時收取：股票 {(costsConfig.tax.stock * 100).toFixed(1)}%、ETF {(costsConfig.tax.etf * 100).toFixed(1)}%。</p>
      </Section>

      <Section title="部位大小與期望值">
        <ul class="small" style={{ paddingLeft: '1.25rem', margin: 0 }}>
          <li>張數 = 無條件捨去(總資金 × 單筆風險% ÷ (進場價 − 停損價) ÷ 1000)；可切換零股（股數）。</li>
          <li>風險報酬比 = (目標價 − 進場價) ÷ (進場價 − 停損價)，低於 1:{th.portfolio.min_reward_risk} 警告。</li>
          <li>期望值 = 勝率 × 平均獲利 − 敗率 × 平均虧損，以 R 倍數與金額呈現。</li>
        </ul>
      </Section>

      <Section title="回測規則">
        <ul class="small" style={{ paddingLeft: '1.25rem', margin: 0 }}>
          <li>T 日收盤後依已公布資料產生訊號，T+1 開盤進場，持有 N 日後開盤出場（N = {bt.horizons.join('／')}）。</li>
          <li>月營收以實際公布日生效，取不到保守假設次月 {bt.revenue_fallback_day} 日；財報以法定期限生效（Q1 {bt.financial_deadlines.Q1}、Q2 {bt.financial_deadlines.Q2}、Q3 {bt.financial_deadlines.Q3}、年報 {bt.financial_deadlines.Q4}）。</li>
          <li>排除：進場日開盤漲幅 ≥ {bt.limit_up_pct}%（開盤即漲停）、停牌、處置期間；並統計排除筆數。</li>
          <li>扣除交易成本；顯示相對加權報酬指數的超額報酬。樣本外：前 {Math.round(bt.oos_split * 100)}% 與其餘分開。樣本數 &lt; {bt.min_samples} 標示「參考性低」。</li>
          <li>使用逐日全市場歷史（含之後下市者）降低存活者偏差；回補起點以前已下市者不在資料內。</li>
        </ul>
      </Section>

      <Section title="資料來源">
        <p class="small">證交所、櫃買中心、集保、期交所、公開資訊觀測站、美國財政部等公開資料。各來源狀態見 <a href="#/more/health">資料健康</a>。</p>
      </Section>
    </div>
  );
}
