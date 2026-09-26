/** K 線（原始／還原切換）＋ 成交量 ＋ 下方指標面板。使用 TradingView lightweight-charts v5。 */
import { useEffect, useRef } from 'preact/hooks';
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
export interface LowerPanel { label: string; kind: 'histogram' | 'line'; data: ValuePoint[]; signed?: boolean }

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function KChart({ ohlc, volume, overlays = [], lower, height = 380, ariaLabel }: {
  ohlc: OhlcPoint[];
  volume: ValuePoint[];
  overlays?: Overlay[];
  lower?: LowerPanel | null;
  height?: number;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const up = cssVar('--up', '#e5352b');
    const down = cssVar('--down', '#1e9e4a');
    const text = cssVar('--label-2', '#666');
    const grid = cssVar('--separator', 'rgba(0,0,0,0.1)');
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
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down,
      priceLineVisible: false,
    });
    candles.setData(ohlc.map((p) => ({ ...p, time: p.time as Time })));
    for (const ov of overlays) {
      const line = chart.addSeries(LineSeries, { color: ov.color, lineWidth: 2, title: ov.label, priceLineVisible: false, lastValueVisible: false });
      line.setData(ov.data.map((p) => ({ time: p.time as Time, value: p.value })));
    }
    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }, 1);
    vol.setData(volume.map((p) => ({ time: p.time as Time, value: p.value, color: p.color })));
    if (lower && lower.data.length) {
      if (lower.kind === 'histogram') {
        const s = chart.addSeries(HistogramSeries, { priceLineVisible: false, title: lower.label }, 2);
        s.setData(lower.data.map((p) => ({ time: p.time as Time, value: p.value, color: p.color ?? (lower.signed ? (p.value >= 0 ? up : down) : cssVar('--tint', '#007aff')) })));
      } else {
        const s = chart.addSeries(LineSeries, { priceLineVisible: false, title: lower.label, color: cssVar('--tint', '#007aff'), lineWidth: 2 }, 2);
        s.setData(lower.data.map((p) => ({ time: p.time as Time, value: p.value })));
      }
    }
    const panes = chart.panes();
    if (panes[1]) panes[1].setHeight(70);
    if (panes[2]) panes[2].setHeight(110);
    const n = ohlc.length;
    if (n > 130) chart.timeScale().setVisibleLogicalRange({ from: n - 130, to: n + 2 });
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [ohlc, volume, overlays, lower]);

  return <div ref={ref} class="chart" style={{ height: `${height / 16}rem` }} role="img" aria-label={ariaLabel} />;
}
