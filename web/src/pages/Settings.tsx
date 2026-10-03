import { useEffect, useState } from 'preact/hooks';
import { PageHead, ThemeSwitch, TopBar } from '../components/Chrome';
import { useDb, useInvestStyle } from '../hooks';
import { STYLE_DESC, STYLE_NAME, setStyle } from '../lib/style';
import { getSetting, setSetting } from '../db/db';
import { CATEGORY_IDS, scoresConfig } from '../lib/config';
import { DEFAULT_PORTFOLIO, type PortfolioSettings } from '../lib/settings';
import { DEFAULT_WEIGHTS, type Weights } from '../lib/scores';
import { DEFAULT_COSTS, type CostSettings } from '../lib/costs';
import { AlertExport } from '../components/AlertExport';
import { AppVersion } from '../components/AppVersion';
import { useWhaleTier } from '../components/Structure';
import { BACKTEST_WHALE, WHALE_TIERS, setWhaleTier } from '../lib/holders';


export default function Settings() {
  const stored = useDb(async () => ({
    weights: await getSetting<Weights>('weights', DEFAULT_WEIGHTS),
    costs: await getSetting<CostSettings>('costs', DEFAULT_COSTS),
    ambient: await getSetting<boolean>('ambient', true),
    gamification: await getSetting<boolean>('gamification', true),
    portfolio: await getSetting<PortfolioSettings>('portfolio', DEFAULT_PORTFOLIO),
  }));
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const style = useInvestStyle();
  useEffect(() => { if (stored) setWeights(stored.weights); }, [stored?.weights]);
  if (!stored) return <div class="page"><TopBar back="/" avatar={false} /><PageHead title="設定" /></div>;
  const total = CATEGORY_IDS.reduce((s, c) => s + weights[c], 0) || 1;

  return (
    <div class="page">
      <TopBar back="/" avatar={false} />
      <PageHead title="設定" />

      <h2 class="section-title">投資風格</h2>
      <div class="card">
        <div class="segmented" role="group" aria-label="投資風格">
          {(['swing', 'long'] as const).map((v) => (
            <button key={v} aria-pressed={style === v} onClick={() => setStyle(v)}>{STYLE_NAME[v]}</button>
          ))}
        </div>
        <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>{STYLE_DESC[style]}。決定個股頁區塊順序、預設期間與一句話結論的側重點；不影響分數計算。</p>
      </div>

      <h2 class="section-title">外觀</h2>
      <div class="card">
        <ThemeSwitch />
        <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>預設深色，不跟隨系統；也可以從右上角頭像選單的第一列切換。</p>
        <div class="switch-row" style={{ marginTop: 'var(--s-3)' }}>
          <span><span class="body" style={{ display: 'block' }}>環境光</span><span class="caption muted">頁首柔和光暈：今晚頁代表資金環境（有風險偏琥珀），我的股票與個股頁跟著所選期間的漲跌。關閉即為純黑的「夜間簡報」樣式；系統開啟減少透明度或減少動態效果時會自動關閉。</span></span>
          <label class="switch"><input type="checkbox" role="switch" aria-label="環境光" checked={stored.ambient} onChange={(e) => setSetting('ambient', (e.target as HTMLInputElement).checked)} /><span /></label>
        </div>
      </div>

      <WhaleTierSetting />

      <h2 class="section-title">遊戲化</h2>
      <div class="card">
        <div class="switch-row">
          <span><span class="body" style={{ display: 'block' }}>紀律圓環、等級與徽章</span><span class="caption muted">只獎勵紀律行為（看完簡報、檢查表、檢討、備份），不因交易次數或獲利給予任何獎勵。關閉後改為純文字待辦；紀錄仍保存在本機並納入備份。</span></span>
          <label class="switch"><input type="checkbox" role="switch" aria-label="遊戲化" checked={stored.gamification} onChange={(e) => setSetting('gamification', (e.target as HTMLInputElement).checked)} /><span /></label>
        </div>
      </div>

      <h2 class="section-title">綜合分權重</h2>
      <div class="card">
        {CATEGORY_IDS.map((c) => (
          <label key={c} class="field">
            <span>{scoresConfig.categories[c].label}：{weights[c]}（{((weights[c] / total) * 100).toFixed(0)}%）</span>
            <input type="range" min={0} max={100} step={5} value={weights[c]} style={{ width: '100%', minHeight: '2.75rem' }}
              aria-label={`${scoresConfig.categories[c].label}權重`}
              onInput={(e) => setWeights({ ...weights, [c]: Number((e.target as HTMLInputElement).value) })}
              onChange={(e) => setSetting('weights', { ...weights, [c]: Number((e.target as HTMLInputElement).value) })} />
          </label>
        ))}
        <button class="btn small" onClick={() => { setWeights(DEFAULT_WEIGHTS); setSetting('weights', DEFAULT_WEIGHTS); }}>恢復預設（等權重）</button>
        <p class="caption muted">權重只影響綜合分的加總方式；不建議依回測結果反覆調整（過度擬合）。</p>
      </div>

      <h2 class="section-title">交易成本</h2>
      <div class="card">
        <label class="field">
          <span>手續費折扣（0.6 = 六折）</span>
          <input class="input" type="number" step="0.05" min="0.1" max="1" inputMode="decimal" value={stored.costs.discount}
            onChange={(e) => setSetting('costs', { ...stored.costs, discount: Number((e.target as HTMLInputElement).value) })} />
        </label>
        <label class="check">
          <input type="checkbox" checked={stored.costs.minimumEnabled} onChange={(e) => setSetting('costs', { ...stored.costs, minimumEnabled: (e.target as HTMLInputElement).checked })} />
          最低手續費 20 元
        </label>
      </div>

      <h2 class="section-title">資金與風控</h2>
      <div class="card">
        <label class="field">
          <span>總資金（元）</span>
          <input class="input" type="number" inputMode="numeric" value={stored.portfolio.capital}
            onChange={(e) => setSetting('portfolio', { ...stored.portfolio, capital: Number((e.target as HTMLInputElement).value) })} />
        </label>
        <label class="field">
          <span>單筆最大風險（% 總資金）</span>
          <input class="input" type="number" step="0.1" inputMode="decimal" value={stored.portfolio.riskPct}
            onChange={(e) => setSetting('portfolio', { ...stored.portfolio, riskPct: Number((e.target as HTMLInputElement).value) })} />
        </label>
        <label class="check">
          <input type="checkbox" checked={stored.portfolio.oddLot} onChange={(e) => setSetting('portfolio', { ...stored.portfolio, oddLot: (e.target as HTMLInputElement).checked })} />
          以零股（股數）計算建議部位
        </label>
      </div>

      <h2 class="section-title">盤中到價提醒</h2>
      <AlertExport />

      <h2 class="section-title">版本</h2>
      <div class="card">
        <AppVersion withCheck />
        <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>新版本上線後，開啟 App 時會自動更新；正在操作時只在畫面下方提示，不會打斷正在填寫的內容。</p>
      </div>
    </div>
  );
}

/** M3：籌碼結構最上面一段的門檻（只影響顯示；回測與選股固定 1,000 張）。 */
function WhaleTierSetting() {
  const v = useWhaleTier();
  return (
    <>
      <h2 class="section-title">大戶門檻（顯示）</h2>
      <div class="card">
        <div class="segmented" role="group" aria-label="大戶門檻">
          {WHALE_TIERS.map((t) => <button key={t} aria-pressed={v === t} onClick={() => setWhaleTier(t)}>{t.toLocaleString('zh-TW')} 張</button>)}
        </div>
        <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>個股頁「籌碼結構」最上面一段的門檻。回測、選股與指標效度評估固定使用 {BACKTEST_WHALE.toLocaleString('zh-TW')} 張。</p>
      </div>
    </>
  );
}
