/** 個股頁「進階」：lightweight-charts 完整 K 線（還原／原始、成交量、下方指標、法人成本線〔估〕）。另切 chunk，按下才載入。 */
import { useMemo, useState } from 'preact/hooks';
import { KChart, type LowerPanel, type Overlay } from './KChart';
import type { StockHistory } from '../data/types';
import { series, toOhlc, volumeSeries, type PriceMode } from '../lib/history';
import { fmtPrice } from '../lib/format';

export interface LowerDef { id: string; label: string; key: keyof StockHistory; kind: 'histogram' | 'line'; signed?: boolean }
export const LOWER_PANELS: LowerDef[] = [
  { id: 'foreign', label: '外資', key: 'fn', kind: 'histogram', signed: true },
  { id: 'trust', label: '投信', key: 'tn', kind: 'histogram', signed: true },
  { id: 'dealer', label: '自營商', key: 'dn', kind: 'histogram', signed: true },
  { id: 'margin', label: '融資', key: 'mb', kind: 'line' },
  { id: 'short', label: '融券', key: 'sb', kind: 'line' },
  { id: 'sbl', label: '借券', key: 'sbl', kind: 'line' },
  { id: 'whale', label: '大戶持股比', key: 'whale', kind: 'line' },
  { id: 'qfii', label: '外資持股比', key: 'qfii', kind: 'line' },
  { id: 'daytrade', label: '當沖比率', key: 'dt', kind: 'histogram' },
  { id: 'pe', label: '本益比', key: 'pe', kind: 'line' },
  { id: 'pb', label: '淨值比', key: 'pb', kind: 'line' },
  { id: 'dy', label: '殖利率', key: 'dy', kind: 'line' },
];

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export default function AdvancedChart({ h }: { h: StockHistory }) {
  const [mode, setMode] = useState<PriceMode>('adj');
  const [lower, setLower] = useState('foreign');
  const [costLines, setCostLines] = useState(true);
  const chart = useMemo(() => {
    const ohlc = toOhlc(h, mode);
    const volume = volumeSeries(h, cssVar('--up') || '#ff5c4d', cssVar('--down') || '#2ed47a');
    const def = LOWER_PANELS.find((p) => p.id === lower) ?? LOWER_PANELS[0];
    const lowerPanel: LowerPanel = { label: def.label, kind: def.kind, signed: def.signed, data: series(h, def.key) };
    const overlays: Overlay[] = [];
    const cl = h.cost as Record<string, (number | null)[]> | undefined;
    if (costLines && cl && mode === 'raw') {
      // 成本線屬於估算值；以灰階與虛實區分，不另外使用其他顏色
      const style: Record<string, string> = { foreign20: cssVar('--text-1'), trust20: cssVar('--text-2'), foreign60: cssVar('--text-2'), trust60: cssVar('--text-3') };
      const labels: Record<string, string> = { foreign20: '外資20日成本（估）', trust20: '投信20日成本（估）', foreign60: '外資60日成本（估）', trust60: '投信60日成本（估）' };
      for (const [k, arr] of Object.entries(cl)) {
        const data = arr.map((v, i) => (v === null ? null : { time: h.d[i], value: v })).filter((x): x is { time: string; value: number } => x !== null);
        if (data.length) overlays.push({ label: labels[k] ?? k, color: style[k] ?? cssVar('--text-2'), data });
      }
    }
    return { ohlc, volume, lowerPanel, overlays };
  }, [h, mode, lower, costLines]);
  const available = LOWER_PANELS.filter((p) => Array.isArray(h[p.key]) && (h[p.key] as unknown[]).some((v) => v !== null));
  const last = h.d.length - 1;
  return (
    <div>
      <div class="row between wrap">
        <div class="segmented inline" role="group" aria-label="價格模式">
          <button aria-pressed={mode === 'adj'} onClick={() => setMode('adj')}>還原</button>
          <button aria-pressed={mode === 'raw'} onClick={() => setMode('raw')}>原始</button>
        </div>
        {h.cost ? (
          <label class="check caption"><input type="checkbox" checked={costLines} onChange={(e) => setCostLines((e.target as HTMLInputElement).checked)} /> 法人成本線<span class="est">估</span>（原始價）</label>
        ) : null}
      </div>
      <KChart ohlc={chart.ohlc} volume={chart.volume} overlays={chart.overlays} lower={chart.lowerPanel}
        ariaLabel={`${h.name} ${mode === 'adj' ? '還原' : '原始'} K 線圖，最新收盤 ${fmtPrice(h.c[last])}`} />
      <div class="chips" role="group" aria-label="下方指標" style={{ marginTop: 'var(--s-2)' }}>
        {available.map((p) => <button key={p.id} class="chip" aria-pressed={lower === p.id} onClick={() => setLower(p.id)}>{p.label}</button>)}
      </div>
      {mode === 'raw' && h.cost ? <p class="caption muted">法人成本線為估算值：以淨買超日股數 × 當日均價加權（見方法說明）。</p> : null}
    </div>
  );
}
