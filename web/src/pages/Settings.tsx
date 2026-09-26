import { useEffect, useState } from 'preact/hooks';
import { Nav } from '../components/Nav';
import { useDb } from '../hooks';
import { getSetting, setSetting } from '../db/db';
import { CATEGORY_IDS, scoresConfig } from '../lib/config';
import { DEFAULT_PORTFOLIO, type PortfolioSettings } from '../lib/settings';
import { DEFAULT_WEIGHTS, type Weights } from '../lib/scores';
import { DEFAULT_COSTS, type CostSettings } from '../lib/costs';
import { AlertExport } from '../components/AlertExport';


export default function Settings() {
  const stored = useDb(async () => ({
    weights: await getSetting<Weights>('weights', DEFAULT_WEIGHTS),
    costs: await getSetting<CostSettings>('costs', DEFAULT_COSTS),
    theme: await getSetting<string>('theme', 'auto'),
    portfolio: await getSetting<PortfolioSettings>('portfolio', DEFAULT_PORTFOLIO),
  }));
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  useEffect(() => { if (stored) setWeights(stored.weights); }, [stored?.weights]);
  if (!stored) return <div><Nav title="設定" back="/more" /></div>;
  const total = CATEGORY_IDS.reduce((s, c) => s + weights[c], 0) || 1;

  function applyTheme(t: string) {
    setSetting('theme', t);
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  return (
    <div>
      <Nav title="設定" back="/more" />
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
        <p class="tiny muted">權重只影響綜合分的加總方式；不建議依回測結果反覆調整（過度擬合）。</p>
      </div>

      <h2 class="section-title">交易成本</h2>
      <div class="card">
        <label class="field">
          <span>手續費折扣（0.6 = 六折）</span>
          <input class="input" type="number" step="0.05" min="0.1" max="1" inputMode="decimal" value={stored.costs.discount}
            onChange={(e) => setSetting('costs', { ...stored.costs, discount: Number((e.target as HTMLInputElement).value) })} />
        </label>
        <label class="row" style={{ minHeight: '2.75rem' }}>
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
        <label class="row" style={{ minHeight: '2.75rem' }}>
          <input type="checkbox" checked={stored.portfolio.oddLot} onChange={(e) => setSetting('portfolio', { ...stored.portfolio, oddLot: (e.target as HTMLInputElement).checked })} />
          以零股（股數）計算建議部位
        </label>
      </div>

      <h2 class="section-title">外觀</h2>
      <div class="card">
        <div class="segmented" role="group" aria-label="外觀">
          {[['auto', '跟隨系統'], ['light', '淺色'], ['dark', '深色']].map(([v, l]) => (
            <button key={v} aria-pressed={stored.theme === v} onClick={() => applyTheme(v)}>{l}</button>
          ))}
        </div>
      </div>

      <h2 class="section-title">盤中到價提醒</h2>
      <AlertExport />
    </div>
  );
}
