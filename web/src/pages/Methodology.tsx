/** 方法說明：直接讀取 /config（與 pipeline 相同的設定）自動產生，設定改了這頁就跟著改。 */
import { PageHead, TopBar } from '../components/Chrome';
import { CATEGORY_IDS, costsConfig, scoresConfig, thresholds, uiConfig, type Mapping } from '../lib/config';

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
      <h2 class="section" style={{ marginTop: 'var(--s-8)' }}>{title}</h2>
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
    <div class="page">
      <TopBar back="/" avatar={false} />
      <PageHead title="方法說明">
        <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>依設定檔自動產生；所有報酬、均線、RS、回測使用還原價。</p>
      </PageHead>
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
              <div key={f.id} style={{ padding: '0.5rem 0', }}>
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
          <div key={id} style={{ padding: '0.375rem 0', }}>
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
          <li>個股籌碼明細（近 {uiConfig.chip.days} 日）：外資＝外陸資＋外資自營商；自營商拆自行買賣／避險；三大法人合計用官方數字；單位可切換張、億元（以當日均價估算，標「估」）、佔當日成交量 %；區間合計先以股數相加再換算。區間統計的估計成本只計淨買超日（還原均價加權），淨賣超時不顯示。</li>
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
        <p class="small">手續費 {(costsConfig.commission.rate * 100).toFixed(4)}%（買賣各一次）× 折扣 {costsConfig.commission.discount}，最低 {costsConfig.commission.minimum} 元（可在設定關閉）；證交稅於出場時收取：股票 {(costsConfig.tax.stock * 100).toFixed(1)}%、ETF {(costsConfig.tax.etf * 100).toFixed(1)}%。</p>
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

      <Section title="介面呈現規則（不影響計算）">
        <ul class="small" style={{ paddingLeft: '1.25rem', margin: 0 }}>
          <li>變化優先：以「上次查看」的快照為基準（第一次使用以前一交易日為基準）。顯著門檻：漲跌 ≥ {uiConfig.significance.price_pct}%、綜合分 ≥ {uiConfig.significance.composite_points} 分、外資或投信新達到連買／連賣 {uiConfig.significance.inst_streak_days} 日、法人淨買賣超 ≥ 成交量 {uiConfig.significance.inst_volume_pct}%、融資變化 ≥ {uiConfig.significance.margin_pct}%、新的風險旗標；低於門檻的預設收合。</li>
          <li>資金環境燈號：任一指標為風險（紅燈）→ 保守；沒有風險且 ≥ {uiConfig.env_state.aggressive_min_green} 項有利 → 積極；其餘為中性。</li>
          <li>持股警示：收盤 ≤ 停損價為「觸及停損」；距停損 ≤ {uiConfig.significance.near_stop_pct}% 為「接近停損」；新的或嚴重的風險旗標。</li>
          <li>冷靜卡：新增持倉時若資金環境為保守、股價高於 20 日均線超過 {uiConfig.impulse.ma20_gap_pct}%、或近 5 日上漲超過 {uiConfig.impulse.price_change_5d_pct}%，先列出事實並需多確認一步。</li>
          <li>回測可信度：樣本 &lt; {uiConfig.backtest_confidence.low_below} 筆為低、≥ {uiConfig.backtest_confidence.high_from} 筆為高，其餘為中。</li>
          <li>系統清單「{uiConfig.hot_momentum.label}」（依規則產生，非推薦）：每個交易日收盤後，從{uiConfig.hot_momentum.exclude_etf ? '普通股（不含 ETF／ETN）' : '所有證券'}中取成交值排名前 {uiConfig.hot_momentum.value_rank_top} 名、RS 百分位 ≥ {uiConfig.hot_momentum.min_rs_percentile}、沒有{uiConfig.hot_momentum.max_danger_flags ? `超過 ${uiConfig.hot_momentum.max_danger_flags} 個` : ''}危險級風險旗標、注意級風險旗標最多 {uiConfig.hot_momentum.max_warn_flags} 個者，依 RS 百分位由高到低（同分依成交值）取前 {uiConfig.hot_momentum.size} 檔。只是篩選條件的結果，不代表未來表現。</li>
          <li>範例自選（新用戶歡迎卡）：{uiConfig.sample_watchlist.codes.join('、')}，放在「{uiConfig.sample_watchlist.group}」群組並標示為範例，可一鍵清除。</li>
          <li>遊戲化只獎勵紀律行為（看完簡報、完成檢查表〔含決定不進場〕、平倉檢討、備份、回測自己的條件），並設每日上限；不因下單次數、交易頻率或獲利給予任何獎勵。連續天數只計交易日，休市日不中斷。</li>
        </ul>
      </Section>

      <Section title="資料來源">
        <p class="small">證交所、櫃買中心、集保、期交所、公開資訊觀測站、美國財政部等公開資料。各來源狀態見 <a href="#/me/health">資料健康</a>。</p>
      </Section>
    </div>
  );
}
