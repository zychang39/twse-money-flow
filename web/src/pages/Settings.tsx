import { useEffect, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { applyAppearance } from '../lib/appearance';
import { Card, List, NavRow, PageTitle, Section, Seg } from '../components/ui';
import { Interp, Term } from '../components/kit';
import { useUser } from '../data/useUser';
import { TERMS } from '../lib/glossary';
import { CHART_KEY, MOVER_KEY, MOVER_OPTIONS, RANGE_BASIS_KEY, moverTh, readPref, writePref } from '../lib/prefs';
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
import { markOnboard } from '../lib/flowTrack';


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
  const whale = useWhaleTier();
  const user = useUser();
  const read = new Set((user?.activity ?? []).filter((a) => a.type === 'term_read').map((a) => String(a.meta?.id ?? ''))).size;
  const [chart, setChart] = useState(() => readPref(CHART_KEY, ['candle', 'line'] as const, 'line'));
  const [basis, setBasis] = useState(() => readPref(RANGE_BASIS_KEY, ['adj', 'raw'] as const, 'adj'));
  const [mover, setMover] = useState(() => readPref(MOVER_KEY, MOVER_OPTIONS.map(String), String(moverTh().price_pct)));
  useEffect(() => { if (stored) setWeights(stored.weights); }, [stored?.weights]);
  if (!stored) return <div class="page"><TopBar back="/" avatar={false} /><PageTitle title="設定" /></div>;
  const total = CATEGORY_IDS.reduce((s, c) => s + weights[c], 0) || 1;

  return (
    <div class="page">
      <TopBar back="/" avatar={false} />
      <PageTitle title="設定" sub="資料只存在這台裝置" />

      <Section title="顯示" testid="set-display" info={<><p>說明層級：新手（預設）在每個指標下方顯示一行白話解讀；精簡隱藏解讀行，只在指標超過提醒門檻時於數值旁亮橘點，點橘點看說明。</p><p>分頁列預設只有圖示，可開啟文字標籤。預設圖表：個股主圖預設折線或 K 線（個股頁 ⋯ 也可切換並記住）。價格基準：還原價把除權息與分割調整回去，報酬與均線一律用還原價計算；原始價只影響圖上顯示。</p></>}>
        <Card>
          <p class="ui-foot ui-muted set-l">說明層級</p>
          <Seg options={[['novice', '新手'], ['compact', '精簡']] as const} value={stored.helpLevel === 'compact' ? 'compact' : 'novice'}
            onChange={async (v) => { await setSetting('helpLevel', v); applyAppearance(); }} label="說明層級" testid="help-level" />
          <p class="ui-foot ui-muted set-l">預設圖表類型（折線或 <Term id="k_line">K 線</Term>）</p>
          <Seg options={[['line', '折線'], ['candle', 'K 線']] as const} value={chart} onChange={(v) => { writePref(CHART_KEY, v); setChart(v); }} label="預設圖表類型" testid="chart-default" />
          <p class="ui-foot ui-muted set-l">價格基準（<Term id="adjusted_price">還原價</Term>）</p>
          <Seg options={[['adj', '還原價'], ['raw', '原始價']] as const} value={basis} onChange={(v) => { writePref(RANGE_BASIS_KEY, v); setBasis(v); }} label="價格基準" testid="basis-default" />
          <div class="switch-row st-notes">
            <span class="ui-body">分頁列顯示文字</span>
            <label class="switch"><input type="checkbox" role="switch" aria-label="分頁列顯示文字" checked={stored.tabLabels} onChange={async (e) => { await setSetting('tabLabels', (e.target as HTMLInputElement).checked); applyAppearance(); }} /><span /></label>
          </div>
          <div class="switch-row">
            <span class="ui-body">流程的進度環、連續、等級與成就</span>
            <label class="switch"><input type="checkbox" role="switch" aria-label="遊戲化" checked={stored.gamification} onChange={(e) => setSetting('gamification', (e.target as HTMLInputElement).checked)} /><span /></label>
          </div>
        </Card>
        <Interp>投資風格：{STYLE_NAME[style]}（{STYLE_DESC[style]}）</Interp>
        <Seg options={(['swing', 'long'] as const).map((v) => [v, STYLE_NAME[v]] as const)} value={style} onChange={(v) => setStyle(v)} label="投資風格" />
      </Section>

      <Section title="風險" testid="set-risk" info={<p>風險試算與檢查表用的本金與每筆風險上限（本金 × 每筆風險 %）；券商折扣只用在個人試算，策略回測固定用牌告手續費 0.1425%、證交稅 0.3%、滑價 0.1%。</p>}>
        <Card>
          <label class="field">
            <span>本金（元）</span>
            <input class="input" type="number" inputMode="numeric" value={stored.portfolio.capital} data-testid="capital"
              onChange={(e) => { markOnboard('risk_settings'); void setSetting('portfolio', { ...stored.portfolio, capital: Number((e.target as HTMLInputElement).value) }); }} />
          </label>
          <label class="field">
            <span><Term id="position_size">每筆風險</Term>（% 本金）</span>
            <input class="input" type="number" step="0.1" inputMode="decimal" value={stored.portfolio.riskPct} data-testid="risk-pct"
              onChange={(e) => { markOnboard('risk_settings'); void setSetting('portfolio', { ...stored.portfolio, riskPct: Number((e.target as HTMLInputElement).value) }); }} />
          </label>
          <label class="check">
            <input type="checkbox" checked={stored.portfolio.oddLot} onChange={(e) => setSetting('portfolio', { ...stored.portfolio, oddLot: (e.target as HTMLInputElement).checked })} />
            以零股（股數）計算部位
          </label>
          <label class="field">
            <span>券商手續費折扣（0.6 = 六折）</span>
            <input class="input" type="number" step="0.05" min="0.1" max="1" inputMode="decimal" value={stored.costs.discount}
              onChange={(e) => setSetting('costs', { ...stored.costs, discount: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label class="check">
            <input type="checkbox" checked={stored.costs.minimumEnabled} onChange={(e) => setSetting('costs', { ...stored.costs, minimumEnabled: (e.target as HTMLInputElement).checked })} />
            最低手續費 20 元
          </label>
        </Card>
      </Section>

      <Section title="門檻" testid="set-thresholds" info={<><p>異動門檻：自選股「顯著變化」的漲跌幅門檻（自上次查看的收盤價變化）；其他條件（法人連買、佔量、融資變化、新風險旗標）固定。</p><p>大戶級距：個股頁股權分散最上面一段的門檻；回測、選股與指標效度評估固定使用 {BACKTEST_WHALE.toLocaleString('zh-TW')} 張。</p></>}>
        <p class="ui-foot ui-muted set-l"><Term id="significant_change">異動門檻</Term>（漲跌幅）</p>
        <Seg options={MOVER_OPTIONS.map((v) => [String(v), `${v}%`] as const)} value={mover} onChange={(v) => { writePref(MOVER_KEY, v); setMover(v); }} label="異動門檻" testid="mover-th" />
        <p class="ui-foot ui-muted set-l"><Term id="whale">大戶級距</Term></p>
        <Seg options={WHALE_TIERS.map((t) => [String(t), `${t.toLocaleString('zh-TW')} 張`] as const)} value={String(whale)} onChange={(x) => setWhaleTier(Number(x) as typeof whale)} label="大戶級距" testid="whale-th" />
      </Section>

      <Section title="分項權重" info={<p>四個分項分數加總時的權重（只用在「進階」區）；不建議依回測結果反覆調整（過度擬合）。</p>}>
      <Card>
        {CATEGORY_IDS.map((c) => (
          <label key={c} class="field">
            <span>{scoresConfig.categories[c].label}：{weights[c]}（{((weights[c] / total) * 100).toFixed(0)}%）</span>
            <input type="range" min={0} max={100} step={5} value={weights[c]} style={{ width: '100%', minHeight: '2.75rem', margin: 0 }}
              aria-label={`${scoresConfig.categories[c].label}權重`}
              onInput={(e) => setWeights({ ...weights, [c]: Number((e.target as HTMLInputElement).value) })}
              onChange={(e) => setSetting('weights', { ...weights, [c]: Number((e.target as HTMLInputElement).value) })} />
          </label>
        ))}
        <button class="btn small" onClick={() => { setWeights(DEFAULT_WEIGHTS); setSetting('weights', DEFAULT_WEIGHTS); }}>恢復預設（等權重）</button>
      </Card>
      </Section>

      <Section title="資料" testid="set-data">
        <List chev>
          <NavRow title="備份與還原" sub="單檔 JSON 匯出／匯入：自選、日誌、持倉、設定、流程紀錄" href="#/me/backup" />
          <NavRow title="資料健康" sub="各資料源的更新狀態與相容模式" href="#/me/health" />
          <NavRow title="資料來源" sub="公開資料・授權與標示" href="#/me/data" />
        </List>
        <p class="ui-foot ui-muted set-l">盤中到價提醒</p>
        <AlertExport />
      </Section>

      <Section title="名詞表" testid="set-glossary">
        <List chev>
          <NavRow title="全部名詞" sub={`${TERMS.length} 個・已讀 ${read}・可搜尋`} href="#/me/glossary" />
        </List>
      </Section>

      <Section title="關於" info={<p>新版本上線後，開啟 App 時自動更新；操作中只在畫面下方提示，不打斷正在填寫的內容。</p>}>
        <Card><AppVersion withCheck /></Card>
        <List chev>
          <NavRow title="計算方法" sub="還原價、指標、分數、回測的定義" href="#/me/methodology" />
        </List>
        <Interp>僅供研究參考，非投資建議；依規則產生，非推薦。</Interp>
      </Section>
    </div>
  );
}
