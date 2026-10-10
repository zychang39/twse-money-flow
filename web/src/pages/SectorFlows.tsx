/**
 * 族群輪動 › 大戶流向（2026-10-10）：持股市值 ≥ 5,000 萬的集保戶每週淨增減金額（億元），依官方產業／主要細產業加總。
 * 版面目標：手機一頁看完、不必往下滑（iPhone 393×852）——
 * - 一列兩個分段：層級（官方產業｜細產業）＋期間（1 週｜4 週）；下一列分頁：流入｜流出（放不下兩個方向就切分頁）。
 * - 列數依螢幕高度決定（實測列高與底部切換列位置，至少 4、至多 10），其餘在「全部」面板；兩個分頁的橫條用同一個刻度。
 * - 點一列：面板顯示該族群近 13 週的流向與貢獻最多的個股（流入、流出各 5 檔）。
 * 計算見 pipeline/derive/whaleflow.py、METHODOLOGY §4.7.7。
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BarRow } from '../components/BarRows';
import { Conclusion, DataState, Interp, ProgressBar } from '../components/kit';
import { Sheet } from '../components/Sheet';
import { Button, List, Section, Seg } from '../components/ui';
import { NetBars } from '../components/Viz';
import { loadSectorFlows } from '../data/api';
import { useAsync, useSegParam } from '../hooks';
import {
  type Contributor,
  type FlowDir,
  type FlowLayer,
  type FlowPeriod,
  type FlowRow,
  type SectorFlows,
  FLOW_LAYER_NAME,
  FLOW_PERIOD_NAME,
  FLOW_WEEKS,
  contributors,
  flowRows,
  lastSum,
  spanText,
  splitFlows,
  yiText,
} from '../lib/sectorFlows';
import '../styles/etf.css';
import '../styles/sectors.css';

const LAYERS = ['official', 'fine'] as const;
const PERIODS = ['1w', '4w'] as const;
const DIRS = ['in', 'out'] as const;
const MIN_ROWS = 4;
const MAX_ROWS = 10;
const BUTTON_H = 60; // 「全部」按鈕＋上方間距
const TOP_N = 5;

/**
 * 列數：清單上緣到底部切換列上緣之間（扣掉「全部」按鈕）放得下幾列。列高與切換列位置都用實測值
 * （列高約 52pt；切換列含安全區域）；量不到時用 52pt 與畫面底部。
 */
function useFitRows(ref: { current: HTMLElement | null }, deps: unknown[]): number {
  const [rows, setRows] = useState(6);
  useLayoutEffect(() => {
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const row = el.querySelector('.fl-row')?.getBoundingClientRect().height || 52;
      const dock = document.querySelector('.tabbar')?.getBoundingClientRect().top;
      const bottom = dock && dock > 0 ? dock + window.scrollY - 8 : window.innerHeight + window.scrollY;
      const n = Math.floor((bottom - top - BUTTON_H) / row);
      setRows(Math.max(MIN_ROWS, Math.min(MAX_ROWS, n)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, deps);
  return rows;
}

const tone = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

/**
 * 族群一列（兩行）：名稱｜流向；橫條｜另一個期間。數值欄固定寬，每列的橫條軌道一樣長、同一個刻度（長短可直接比）。
 * 名稱獨占第一行左側，較長的細產業名稱也放得下。整列是按鈕（開面板），高度約 52pt。
 */
function FlowItem({ r, period, max, onOpen }: { r: FlowRow; period: FlowPeriod; max: number; onOpen: (id: string) => void }) {
  const otherName = period === '1w' ? '4 週' : '最新一週';
  return (
    <button type="button" class="ui-row ui-tap fl-row" onClick={() => onOpen(r.id)} data-testid="flow-row"
      aria-label={`${r.name}，大戶${FLOW_PERIOD_NAME[period]}${r.v > 0 ? '淨流入' : '淨流出'} ${yiText(Math.abs(r.v), false)}，${otherName} ${yiText(r.other)}，${r.m} 檔`}>
      <span class="fl-name" aria-hidden="true">{r.name}</span>
      <span class={`fl-v ${tone(r.v)}`} aria-hidden="true">{yiText(r.v)}</span>
      <span class="fl-bar" aria-hidden="true"><ProgressBar value={Math.abs(r.v)} max={max} color={r.v > 0 ? 'var(--up)' : 'var(--down)'} /></span>
      <span class="fl-sub ui-foot ui-muted" aria-hidden="true">{otherName} {yiText(r.other).replace(' 億', '')}</span>
    </button>
  );
}

function ContribRows({ items, max, period }: { items: Contributor[]; max: number; period: FlowPeriod }) {
  return (
    <List label="個股" testid="flow-contrib">
      {items.map((c) => (
        <BarRow key={c.code} name={c.name} sub={c.code} valueSub={c.low ? '以千張大戶計' : undefined} testid="flow-stock"
          bar={{ kind: 'diverging', value: c.v, max }}
          value={<span class={tone(c.v)}>{yiText(c.v)}</span>}
          href={`#/stock/${c.code}/holders`}
          label={`${c.name} ${c.code}，大戶${FLOW_PERIOD_NAME[period]}${c.v > 0 ? '淨流入' : c.v < 0 ? '淨流出' : '持平'} ${yiText(Math.abs(c.v), false)}${c.low ? '，股價低於 50 元，以千張大戶計' : ''}`} />
      ))}
    </List>
  );
}

/** 點一列：族群近 13 週的流向＋貢獻最多的個股 */
function GroupDetail({ data, layer, id, period }: { data: SectorFlows; layer: FlowLayer; id: string; period: FlowPeriod }) {
  const g = data[layer][id];
  const list = useMemo(() => (g ? contributors(data, g, period) : []), [data, g, period]);
  if (!g) return <Interp>這個族群沒有大戶流向資料</Interp>;
  const v = lastSum(g.f, FLOW_WEEKS[period]);
  const ins = list.filter((c) => c.v > 0).slice(0, TOP_N);
  const outs = list.filter((c) => c.v < 0).reverse().slice(0, TOP_N);
  const max = Math.max(1e-9, ...[...ins, ...outs].map((c) => Math.abs(c.v)));
  const crumb = g.path.slice(0, -1).join(' › ');
  return (
    <div class="flow-detail" data-testid="flow-detail">
      <Conclusion>{v === null ? '資料不足' : `大戶 ${FLOW_PERIOD_NAME[period]}${v > 0 ? '淨流入' : v < 0 ? '淨流出' : '持平'} ${yiText(Math.abs(v), false)}`}</Conclusion>
      <Interp>{`${crumb ? `${crumb}・` : ''}${spanText(data, period)}・${g.m} 檔（最新一週有資料 ${g.n[g.n.length - 1] ?? 0} 檔）`}</Interp>
      <NetBars values={g.f} dates={data.weeks.slice(1)} label={`${g.name}大戶每週流向（億元）`} height={96} unit="億元"
        format={(x, sign) => yiText(x, sign !== false)} words={['流入', '流出']} emphasizeRecent={false} caption={`近 ${g.f.length} 週`} />
      <h3 class="ui-sec-title flow-h3">流入最多</h3>
      {ins.length ? <ContribRows items={ins} max={max} period={period} /> : <Interp>沒有大戶淨流入的個股</Interp>}
      <h3 class="ui-sec-title flow-h3">流出最多</h3>
      {outs.length ? <ContribRows items={outs} max={max} period={period} /> : <Interp>沒有大戶淨流出的個股</Interp>}
      <Button href={`#/explore/sectors/${encodeURIComponent(id)}`} block testid="flow-group-link">族群頁</Button>
    </div>
  );
}

export function FlowInfo({ data }: { data?: SectorFlows | null }) {
  return (
    <>
      <p>大戶＝集保持股市值 ≥ {data ? Math.round(data.min_value / 1e4).toLocaleString('zh-TW') : '5,000'} 萬的集保戶。門檻以前一週收盤價換算成股數，前後兩週用同一個門檻：股價上漲不會讓中實戶自動「升級」成大戶。</p>
      <p>流向＝（本週大戶持股占比 − 上週大戶持股占比）× 本週集保總股數 × 本週收盤價，單位億元；股價漲跌本身不算流向。4 週＝最近 4 週加總。</p>
      <p>族群：一檔只算一次——官方產業依公司產業別；細產業依每檔的主要細產業（同一檔可能屬於好幾個細產業，只算第一個）。只算普通股。</p>
      <p>限制：集保持股分級最高一級是 1,000 張以上，股價低於 50 元時切不出 5,000 萬，以千張大戶代替；門檻落在分級中間時，假設該級的人在股數區間內均勻分布、按比例計入。集保總股數單週變動超過 {data ? Math.round(data.max_share_change * 100) : 3}%（除權、增資、減資）的那一週不計。</p>
      <p>集保的大戶包含外資保管帳戶、ETF、政府基金，不等於單一主力；集保資料日的持股反映 T+2 交割。這是描述性統計，未驗證能否預測後續報酬。</p>
      <p>資料來源：臺灣集中保管結算所「集保戶股權分散表」（開放資料每週最新一週；過去一年為個股歷史查詢），依政府資料開放授權條款使用。</p>
    </>
  );
}

export function FlowView() {
  const res = useAsync(loadSectorFlows, []);
  const data = res.data;
  const [layer, setLayer] = useSegParam<FlowLayer>(LAYERS, 'fine', 'flayer', 'sectors-flow-layer');
  const [period, setPeriod] = useSegParam<FlowPeriod>(PERIODS, '1w', 'fperiod', 'sectors-flow-period');
  const [dir, setDir] = useSegParam<FlowDir>(DIRS, 'in', 'fdir');
  const [openId, setOpenId] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => (data ? flowRows(data, layer, period) : []), [data, layer, period]);
  const { inflow, outflow } = useMemo(() => splitFlows(rows), [rows]);
  const fit = useFitRows(listRef, [!!data, layer]);
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.v)));
  const shown = dir === 'in' ? inflow : outflow;
  const phase = res.loading ? 'loading' : res.error ? 'error' : rows.length ? 'ok' : 'empty';
  const open = (id: string) => { setAll(false); setOpenId(id); };
  const item = (r: FlowRow) => <FlowItem key={r.id} r={r} period={period} max={max} onOpen={open} />;
  return (
    <Section title="大戶資金流向" testid="flow-sec" aside={data ? `集保 ${spanText(data, period)}` : undefined}
      info={<FlowInfo data={data} />} infoTitle="大戶資金流向">
      <div class="flow-ctrl">
        <Seg small options={LAYERS.map((l) => [l, FLOW_LAYER_NAME[l]] as const)} value={layer} onChange={setLayer} label="族群層級" testid="flow-layer" />
        <Seg small options={PERIODS.map((p) => [p, FLOW_PERIOD_NAME[p]] as const)} value={period} onChange={setPeriod} label="期間" testid="flow-period" />
      </div>
      <DataState testid="flow-body" phase={phase} reason={res.error ? '大戶流向資料讀取失敗' : phase === 'empty' ? '大戶流向資料累積中：需要兩週以上的集保資料' : undefined} onRetry={() => location.reload()}>
        <Seg options={[['in', `流入 ${inflow.length}`], ['out', `流出 ${outflow.length}`]] as const} value={dir} onChange={setDir} label="方向" testid="flow-dir" />
        <div ref={listRef}>
          <List label={`大戶${dir === 'in' ? '流入' : '流出'}最多的族群`} testid="flow-list">
            {shown.length ? shown.slice(0, fit).map(item) : <p class="ui-foot ui-muted flow-none">{dir === 'in' ? '沒有大戶淨流入的族群' : '沒有大戶淨流出的族群'}</p>}
          </List>
        </div>
        {shown.length > fit ? (
          <Button onClick={() => setAll(true)} block testid="flow-all">{`全部 ${shown.length} 個${dir === 'in' ? '流入' : '流出'}族群`}</Button>
        ) : null}
      </DataState>
      <Sheet open={all} onClose={() => setAll(false)} title={`大戶${dir === 'in' ? '流入' : '流出'}・${FLOW_LAYER_NAME[layer]}・${FLOW_PERIOD_NAME[period]}`} detent="full">
        {all ? <List label="全部族群" testid="flow-all-list">{shown.map(item)}</List> : null}
      </Sheet>
      <Sheet open={openId !== null} onClose={() => setOpenId(null)} title={openId && data ? data[layer][openId]?.name ?? '族群' : '族群'} detent="full">
        {openId && data ? <GroupDetail data={data} layer={layer} id={openId} period={period} /> : null}
      </Sheet>
    </Section>
  );
}
