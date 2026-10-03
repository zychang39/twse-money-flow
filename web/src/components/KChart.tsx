/** K 線（原始／還原切換）＋ 成交量 ＋ 下方指標面板。使用 TradingView lightweight-charts v5。
 * 成交量與下方指標的座標軸、數值標籤都帶單位（張數為完整的千分位整數（不縮寫））；
 * 手指拖曳或滑鼠移動時，圖上方的讀數顯示該日日期、價格、成交量與下方指標（含單位）。 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { dirClass, fmtLotsUnit, fmtPrice } from '../lib/format';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type Time,
} from 'lightweight-charts';

export interface OhlcPoint { time: string; open: number; high: number; low: number; close: number }
export interface ValuePoint { time: string; value: number; color?: string }
export interface Overlay { label: string; color: string; data: ValuePoint[] }
export interface LowerPanel { label: string; kind: 'histogram' | 'line'; data: ValuePoint[]; signed?: boolean; unit?: string }

/** 依單位格式化：張 → 完整的千分位整數；% → 1 位小數；倍 → 1 位小數。 */
export function formatUnit(v: number, unit: string | undefined, signed = false): string {
  if (!Number.isFinite(v)) return '—';
  if (unit === '張') return fmtLotsUnit(v, signed);
  if (unit === '%') return `${v.toFixed(1)}%`;
  if (unit === '倍') return `${v.toFixed(1)} 倍`;
  return v.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
}

interface Readout { time: string; ohlc: OhlcPoint | null; volume: number | null; lower: number | null }

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function KChart({ ohlc, volume, overlays = [], lower, height = 380, ariaLabel, kind = 'candle', logScale = false }: {
  ohlc: OhlcPoint[];
  volume: ValuePoint[];
  overlays?: Overlay[];
  lower?: LowerPanel | null;
  height?: number;
  ariaLabel: string;
  /** 主圖：K 線或收盤折線（M2，2026-10-03） */
  kind?: 'candle' | 'line';
  /** 主圖價格軸用對數座標（長區間用） */
  logScale?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const latest = (): Readout | null => {
    const last = ohlc[ohlc.length - 1];
    if (!last) return null;
    return {
      time: last.time,
      ohlc: last,
      volume: volume.find((p) => p.time === last.time)?.value ?? null,
      lower: lower?.data.find((p) => p.time === last.time)?.value ?? null,
    };
  };
  const [readout, setReadout] = useState<Readout | null>(latest);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const up = cssVar('--up', '#e5352b');
    const down = cssVar('--down', '#1e9e4a');
    const text = cssVar('--text-2', '#888');
    const grid = cssVar('--surface-2', 'rgba(128,128,128,0.15)');
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: text,
        fontFamily: getComputedStyle(document.body).fontFamily,
        attributionLogo: true,
        panes: { separatorColor: grid, enableResize: false },
      },
      grid: { vertLines: { visible: false }, horzLines: { color: grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, rightOffset: 3 },
      localization: { locale: 'zh-TW' },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;
    if (kind === 'line') {
      const line = chart.addSeries(LineSeries, { color: cssVar('--text-1', '#eee'), lineWidth: 2, priceLineVisible: false });
      line.setData(ohlc.map((p) => ({ time: p.time as Time, value: p.close })));
    } else {
      const candles = chart.addSeries(CandlestickSeries, {
        upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down,
        priceLineVisible: false,
      });
      candles.setData(ohlc.map((p) => ({ ...p, time: p.time as Time })));
    }
    // 對數座標：PriceScaleMode.Logarithmic（1）；線性為 0
    chart.priceScale('right').applyOptions({ mode: logScale ? 1 : 0 });
    for (const ov of overlays) {
      const line = chart.addSeries(LineSeries, { color: ov.color, lineWidth: 2, title: ov.label, priceLineVisible: false, lastValueVisible: false });
      line.setData(ov.data.map((p) => ({ time: p.time as Time, value: p.value })));
    }
    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'custom', minMove: 1, formatter: (v: number) => fmtLotsUnit(v, false) },
      priceLineVisible: false, lastValueVisible: false,
    }, 1);
    vol.setData(volume.map((p) => ({ time: p.time as Time, value: p.value, color: p.color })));
    if (lower && lower.data.length) {
      if (lower.kind === 'histogram') {
        const s = chart.addSeries(HistogramSeries, {
          priceLineVisible: false, lastValueVisible: false,
          priceFormat: { type: 'custom', minMove: lower.unit === '張' ? 1 : 0.01, formatter: (v: number) => formatUnit(v, lower.unit, lower.signed) },
        }, 2);
        s.setData(lower.data.map((p) => ({ time: p.time as Time, value: p.value, color: p.color ?? (lower.signed ? (p.value > 0 ? up : p.value < 0 ? down : cssVar('--text-2', '#888')) : cssVar('--text-2', '#888')) })));
      } else {
        const s = chart.addSeries(LineSeries, {
          priceLineVisible: false, lastValueVisible: false, color: cssVar('--text-2', '#888'), lineWidth: 2,
          priceFormat: { type: 'custom', minMove: lower.unit === '張' ? 1 : 0.01, formatter: (v: number) => formatUnit(v, lower.unit) },
        }, 2);
        s.setData(lower.data.map((p) => ({ time: p.time as Time, value: p.value })));
      }
    }
    const panes = chart.panes();
    if (panes[1]) panes[1].setHeight(70);
    if (panes[2]) panes[2].setHeight(110);
    const n = ohlc.length;
    if (n > 130) chart.timeScale().setVisibleLogicalRange({ from: n - 130, to: n + 2 });
    const byTime = (arr: { time: string }[]) => new Map(arr.map((p) => [p.time, p]));
    const ohlcAt = byTime(ohlc) as Map<string, OhlcPoint>;
    const volAt = byTime(volume) as Map<string, ValuePoint>;
    const lowerAt = byTime(lower?.data ?? []) as Map<string, ValuePoint>;
    setReadout(latest());
    chart.subscribeCrosshairMove((param) => {
      const t = typeof param.time === 'string' ? param.time : null;
      if (!t) { setReadout(latest()); return; }
      setReadout({ time: t, ohlc: ohlcAt.get(t) ?? null, volume: volAt.get(t)?.value ?? null, lower: lowerAt.get(t)?.value ?? null });
    });
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [ohlc, volume, overlays, lower, kind, logScale]);

  return (
    <div>
      <div class="k-readout caption" aria-hidden="true">
        {readout ? (
          <>
            <span class="muted">{readout.time}</span>
            {readout.ohlc ? <span>開 {fmtPrice(readout.ohlc.open)}・高 {fmtPrice(readout.ohlc.high)}・低 {fmtPrice(readout.ohlc.low)}・收 {fmtPrice(readout.ohlc.close)}</span> : null}
            <span>量 {readout.volume === null ? '—' : fmtLotsUnit(readout.volume, false)}</span>
            {lower ? (
              <span class={lower.signed ? dirClass(readout.lower) : ''}>
                {lower.label} {readout.lower === null ? '—' : lower.signed && readout.lower
                  ? `${readout.lower > 0 ? '▲ 淨買超 ' : '▼ 淨賣超 '}${formatUnit(Math.abs(readout.lower), lower.unit)}`
                  : formatUnit(readout.lower, lower.unit)}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      <div ref={ref} class="chart-box" style={{ height: `${height / 16}rem` }} role="img" aria-label={ariaLabel} />
    </div>
  );
}
