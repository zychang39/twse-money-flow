import { useEffect, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { applyAppearance } from '../lib/appearance';
import { Card, PageTitle, Section, Seg } from '../components/ui';
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
    helpLevel: await getSetting<string>('helpLevel', 'novice'),
    tabLabels: await getSetting<boolean>('tabLabels', false),
    gamification: await getSetting<boolean>('gamification', true),
    portfolio: await getSetting<PortfolioSettings>('portfolio', DEFAULT_PORTFOLIO),
  }));
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const style = useInvestStyle();
  useEffect(() => { if (stored) setWeights(stored.weights); }, [stored?.weights]);
  if (!stored) return <div class="page"><TopBar back="/" avatar={false} /><PageTitle title="設定" /></div>;
  const total = CATEGORY_IDS.reduce((s, c) => s + weights[c], 0) || 1;

  return (
    <div class="page">
      <TopBar back="/" avatar={false} />
      <PageTitle title="設定" sub="資料只存在這台裝置" />

      <Section title="投資風格" info={<p>{STYLE_DESC[style]}。決定個股頁區塊順序、預設期間與摘要的側重點；不影響分數計算。</p>}>
        <Seg options={(['swing', 'long'] as const).map((v) => [v, STYLE_NAME[v]] as const)} value={style} onChange={(v) => setStyle(v)} label="投資風格" />
      </Section>

      <Section title="顯示" info={<><p>說明層級：新手（預設）在每個指標下方顯示一行白話解讀；精簡隱藏解讀行，只在指標超過提醒門檻時於數值旁亮橘點，點橘點看說明。</p><p>分頁列預設只有圖示，可開啟文字標籤。</p></>}>
        <Card>
          <Seg options={[['novice', '新手'], ['compact', '精簡']] as const} value={stored.helpLevel === 'compact' ? 'compact' : 'novice'}
            onChange={async (v) => { await setSetting('helpLevel', v); applyAppearance(); }} label="說明層級" testid="help-level" />
          <div class="switch-row st-notes">
            <span class="ui-body">分頁列顯示文字</span>
            <label class="switch"><input type="checkbox" role="switch" aria-label="分頁列顯示文字" checked={stored.tabLabels} onChange={async (e) => { await setSetting('tabLabels', (e.target as HTMLInputElement).checked); applyAppearance(); }} /><span /></label>
          </div>
        </Card>
      </Section>

      <WhaleTierSetting />

      <Section title="流程顯示" info={<p>流程頁的三環、連續、等級與成就只獎勵流程（簡報、檢查表、停損、檢討、備份），不因交易次數、獲利或開啟次數給予獎勵；沒有扣分。關閉後只顯示文字狀態；紀錄仍保存在本機並納入備份。</p>}>
        <Card>
          <div class="switch-row">
            <span class="ui-body">三環、連續、等級與成就</span>
            <label class="switch"><input type="checkbox" role="switch" aria-label="遊戲化" checked={stored.gamification} onChange={(e) => setSetting('gamification', (e.target as HTMLInputElement).checked)} /><span /></label>
          </div>
        </Card>
      </Section>

      <Section title="分項權重" info={<p>四個分項分數加總時的權重（只用在「進階」區）；不建議依回測結果反覆調整（過度擬合）。</p>}>
      <Card>
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
      </Card>
      </Section>

      <Section title="交易成本" info={<p>個人試算用的券商手續費折扣與最低手續費；策略回測固定用牌告手續費 0.1425%、證交稅 0.3%、滑價 0.1%。</p>}>
      <Card>
        <label class="field">
          <span>手續費折扣（0.6 = 六折）</span>
          <input class="input" type="number" step="0.05" min="0.1" max="1" inputMode="decimal" value={stored.costs.discount}
            onChange={(e) => setSetting('costs', { ...stored.costs, discount: Number((e.target as HTMLInputElement).value) })} />
        </label>
        <label class="check">
          <input type="checkbox" checked={stored.costs.minimumEnabled} onChange={(e) => setSetting('costs', { ...stored.costs, minimumEnabled: (e.target as HTMLInputElement).checked })} />
          最低手續費 20 元
        </label>
      </Card>
      </Section>

      <Section title="資金與風控" info={<p>風險試算與檢查表用的本金與每筆風險上限。</p>}>
      <Card>
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
          以零股（股數）計算部位
        </label>
      </Card>
      </Section>

      <Section title="盤中到價提醒">
        <AlertExport />
      </Section>

      <Section title="版本" info={<p>新版本上線後，開啟 App 時自動更新；操作中只在畫面下方提示，不打斷正在填寫的內容。</p>}>
        <Card><AppVersion withCheck /></Card>
      </Section>
    </div>
  );
}

/** M3：籌碼結構最上面一段的門檻（只影響顯示；回測與選股固定 1,000 張）。 */
function WhaleTierSetting() {
  const v = useWhaleTier();
  return (
    <Section title="大戶門檻" aside="顯示用" info={<p>個股頁股權分散最上面一段的門檻。回測、選股與指標效度評估固定使用 {BACKTEST_WHALE.toLocaleString('zh-TW')} 張。</p>}>
      <Seg options={WHALE_TIERS.map((t) => [String(t), `${t.toLocaleString('zh-TW')} 張`] as const)} value={String(v)} onChange={(x) => setWhaleTier(Number(x) as typeof v)} label="大戶門檻" />
    </Section>
  );
}
