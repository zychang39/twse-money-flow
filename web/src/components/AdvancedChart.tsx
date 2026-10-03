/** 個股頁「進階」：lightweight-charts 完整 K 線（還原／原始、成交量、下方指標、法人成本線〔估〕）。另切 chunk，按下才載入。 */
import { useMemo, useState } from 'preact/hooks';
import { KChart, type LowerPanel, type Overlay } from './KChart';
import type { StockHistory } from '../data/types';
import { series, sma, toOhlc, volumeSeries, type PriceMode } from '../lib/history';
import { fmtPrice } from '../lib/format';
import { costLineFor } from '../lib/heroSeries';

export interface LowerDef { id: string; label: string; key: keyof StockHistory; kind: 'histogram' | 'line'; signed?: boolean; unit: string }
export const MA_DAYS = [5, 10, 20, 60, 240];
export const LOWER_PANELS: LowerDef[] = [
  { id: 'foreign', label: '外資', key: 'fn', kind: 'histogram', signed: true, unit: '張' },
  { id: 'trust', label: '投信', key: 'tn', kind: 'histogram', signed: true, unit: '張' },
  { id: 'dealer', label: '自營商', key: 'dn', kind: 'histogram', signed: true, unit: '張' },
  { id: 'margin', label: '融資餘額', key: 'mb', kind: 'line', unit: '張' },
  { id: 'short', label: '融券餘額', key: 'sb', kind: 'line', unit: '張' },
  { id: 'sbl', label: '借券賣出餘額', key: 'sbl', kind: 'line', unit: '張' },
  { id: 'whale', label: '大戶持股比', key: 'whale', kind: 'line', unit: '%' },
  { id: 'qfii', label: '外資持股比', key: 'qfii', kind: 'line', unit: '%' },
  { id: 'daytrade', label: '當沖比率', key: 'dt', kind: 'histogram', unit: '%' },
  { id: 'pe', label: '本益比', key: 'pe', kind: 'line', unit: '倍' },
  { id: 'pb', label: '淨值比', key: 'pb', kind: 'line', unit: '倍' },
  { id: 'dy', label: '殖利率', key: 'dy', kind: 'line', unit: '%' },
];

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** mode／onMode：M5 起由個股頁統一管理價格基準（與主角走勢同步）；沒有提供時自行管理。 */
export default function AdvancedChart({ h, mode: ctlMode, onMode }: { h: StockHistory; mode?: PriceMode; onMode?: (m: PriceMode) => void }) {
  const [ownMode, setOwnMode] = useState<PriceMode>('adj');
  const mode = ctlMode ?? ownMode;
  const setMode = (m: PriceMode) => (onMode ? onMode(m) : setOwnMode(m));
  const [lower, setLower] = useState('foreign');
  const [costLines, setCostLines] = useState(true);
  // M2（2026-10-03）：K 線／折線、5／10／20／60／240 日均線、對數座標（長區間）
  const [kind, setKind] = useState<'candle' | 'line'>('candle');
  const [showMa, setShowMa] = useState(true);
  const [logScale, setLogScale] = useState(false);
  const chart = useMemo(() => {
    const ohlc = toOhlc(h, mode);
    const volume = volumeSeries(h, cssVar('--up') || '#ff5c4d', cssVar('--down') || '#2ed47a');
    const def = LOWER_PANELS.find((p) => p.id === lower) ?? LOWER_PANELS[0];
    const lowerPanel: LowerPanel = { label: def.label, kind: def.kind, signed: def.signed, unit: def.unit, data: series(h, def.key) };
    const overlays: Overlay[] = [];
    if (showMa) {
      // 均線用與 K 線同一個價格基準的收盤算（還原模式乘上還原因子），灰階由深到淺＝短到長
      const closes = h.c.map((c, i) => (c === null || c === undefined ? null : c * (mode === 'adj' ? h.af[i] ?? 1 : 1)));
      const inks = ['--ink-1', '--ink-2', '--ink-3', '--ink-4', '--text-3'];
      MA_DAYS.forEach((n, k) => {
        const data = sma(closes, n).map((v, i) => (v === null ? null : { time: h.d[i], value: v })).filter((x): x is { time: string; value: number } => x !== null);
        if (data.length) overlays.push({ label: `${n} 日線`, color: cssVar(inks[k]) || cssVar('--text-2'), data });
      });
    }
    const cl = h.cost as Record<string, (number | null)[]> | undefined;
    if (costLines && cl) {
      // 成本線屬於估算值；以灰階與虛實區分，不另外使用其他顏色
      const style: Record<string, string> = { foreign20: cssVar('--text-1'), trust20: cssVar('--text-2'), foreign60: cssVar('--text-2'), trust60: cssVar('--text-3') };
      const labels: Record<string, string> = { foreign20: '外資20日成本（估）', trust20: '投信20日成本（估）', foreign60: '外資60日成本（估）', trust60: '投信60日成本（估）' };
      for (const [k, arr] of Object.entries(cl)) {
        // M5：成本線以原始價計算；還原模式時每一天乘上當天的還原因子，與 K 線同一個價格基準
        const conv = costLineFor(arr, h.af, mode);
        const data = conv.map((v, i) => (v === null ? null : { time: h.d[i], value: v })).filter((x): x is { time: string; value: number } => x !== null);
        if (data.length) overlays.push({ label: labels[k] ?? k, color: style[k] ?? cssVar('--text-2'), data });
      }
    }
    return { ohlc, volume, lowerPanel, overlays };
  }, [h, mode, lower, costLines, showMa]);
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
          <label class="check caption"><input type="checkbox" checked={costLines} onChange={(e) => setCostLines((e.target as HTMLInputElement).checked)} /> 法人成本線<span class="est">估</span>（{mode === 'adj' ? '還原價' : '原始價'}）</label>
        ) : null}
      </div>
      <div class="row between wrap" style={{ marginTop: 'var(--s-2)', gap: 'var(--s-2)' }}>
        <div class="segmented inline" role="group" aria-label="主圖">
          <button aria-pressed={kind === 'candle'} onClick={() => setKind('candle')}>K 線</button>
          <button aria-pressed={kind === 'line'} onClick={() => setKind('line')}>折線</button>
        </div>
        <label class="check caption"><input type="checkbox" checked={showMa} onChange={(e) => setShowMa((e.target as HTMLInputElement).checked)} /> 均線 {MA_DAYS.join('／')} 日</label>
        <label class="check caption"><input type="checkbox" checked={logScale} onChange={(e) => setLogScale((e.target as HTMLInputElement).checked)} /> 對數座標</label>
      </div>
      <KChart ohlc={chart.ohlc} volume={chart.volume} overlays={chart.overlays} lower={chart.lowerPanel} kind={kind} logScale={logScale}
        ariaLabel={`${h.name} ${mode === 'adj' ? '還原' : '原始'} ${kind === 'candle' ? 'K 線圖' : '收盤折線圖'}（K 線圖），最新收盤 ${fmtPrice(h.c[last])}`} />
      <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>
        {showMa ? `均線＝${MA_DAYS.join('／')} 日簡單移動平均（${mode === 'adj' ? '還原價' : '原始價'}，由深到淺）・` : ''}{logScale ? '價格軸為對數座標・' : ''}成交量單位：張・下方指標：{(LOWER_PANELS.find((p) => p.id === lower) ?? LOWER_PANELS[0]).label}（{(LOWER_PANELS.find((p) => p.id === lower) ?? LOWER_PANELS[0]).unit}）
        {(LOWER_PANELS.find((p) => p.id === lower) ?? LOWER_PANELS[0]).signed ? <>・<span class="up" aria-hidden="true">■</span> 紅色＝淨買超 <span class="down" aria-hidden="true">■</span> 綠色＝淨賣超</> : null}
        ・拖曳或移動游標可查看每日數值。
      </p>
      <div class="chips" role="group" aria-label="下方指標" style={{ marginTop: 'var(--s-2)' }}>
        {available.map((p) => <button key={p.id} class="chip" aria-pressed={lower === p.id} onClick={() => setLower(p.id)}>{p.label}</button>)}
      </div>
      {h.cost ? <p class="caption muted">法人成本線為估算值：以淨買超日股數 × 當日均價加權（見方法說明）{mode === 'adj' ? '；還原模式已乘上還原因子，與 K 線同一基準' : ''}。</p> : null}
    </div>
  );
}
