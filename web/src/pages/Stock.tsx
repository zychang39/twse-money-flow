import { useMemo, useState } from 'preact/hooks';
import { Nav } from '../components/Nav';
import { DataStatus, ErrorState, Loading } from '../components/DataStatus';
import { Change, Signed } from '../components/Change';
import { Composite, ScoreRow } from '../components/Scores';
import { Flags } from '../components/Flags';
import { KChart, type LowerPanel, type Overlay } from '../components/KChart';
import { IconStar, IconStarFill } from '../components/Icons';
import { ScoreDetailView } from '../components/ScoreDetail';
import { StockExtras } from '../components/StockExtras';
import { useAsync, useDb } from '../hooks';
import { loadStock, loadSummary } from '../data/api';
import { addWatch, isWatched, removeWatch } from '../db/db';
import { fmtInt, fmtLots, fmtNum, fmtPrice } from '../lib/format';
import { series, toOhlc, volumeSeries, type PriceMode } from '../lib/history';
import type { StockHistory } from '../data/types';

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

export default function Stock({ code }: { code: string }) {
  const hist = useAsync(() => loadStock(code), [code]);
  const summary = useAsync(loadSummary, []);
  const watched = useDb(() => isWatched(code), [code]);
  const [mode, setMode] = useState<PriceMode>('adj');
  const [lower, setLower] = useState('foreign');
  const [costLines, setCostLines] = useState(true);
  const row = summary.data?.byCode.get(code);
  const h = hist.data;

  const chart = useMemo(() => {
    if (!h) return null;
    const ohlc = toOhlc(h, mode);
    const volume = volumeSeries(h, cssVar('--up') || '#e5352b', cssVar('--down') || '#1e9e4a');
    const def = LOWER_PANELS.find((p) => p.id === lower) ?? LOWER_PANELS[0];
    const lowerPanel: LowerPanel = { label: def.label, kind: def.kind, signed: def.signed, data: series(h, def.key) };
    const overlays: Overlay[] = [];
    const cl = h.cost as Record<string, (number | null)[]> | undefined;
    if (costLines && cl && mode === 'raw') {
      const palette: Record<string, string> = { foreign20: '#af52de', trust20: '#ff9500', foreign60: '#5856d6', trust60: '#ffcc00' };
      const labels: Record<string, string> = { foreign20: '外資20日成本', trust20: '投信20日成本', foreign60: '外資60日成本', trust60: '投信60日成本' };
      for (const [k, arr] of Object.entries(cl)) {
        const data = arr.map((v, i) => (v === null ? null : { time: h.d[i], value: v })).filter((x): x is { time: string; value: number } => x !== null);
        if (data.length) overlays.push({ label: labels[k] ?? k, color: palette[k] ?? '#8e8e93', data });
      }
    }
    return { ohlc, volume, lowerPanel, overlays };
  }, [h, mode, lower, costLines]);

  const available = LOWER_PANELS.filter((p) => h && Array.isArray(h[p.key]) && (h[p.key] as unknown[]).some((v) => v !== null));
  const last = h ? h.d.length - 1 : -1;

  return (
    <div>
      <Nav
        title={h?.name ?? row?.name ?? code}
        back="/watchlist"
        subtitle={<span class="num">{code} · {h?.market === 'tpex' ? '上櫃' : '上市'} · {h?.industry ?? row?.industry ?? '—'}</span>}
        actions={
          <button class="icon-btn" aria-pressed={!!watched} aria-label={watched ? '從自選移除' : '加入自選'} onClick={() => (watched ? removeWatch(code) : addWatch(code))}>
            {watched ? <IconStarFill /> : <IconStar />}
          </button>
        }
      />
      <DataStatus date={h ? h.d[last] : undefined} />
      {hist.error ? <ErrorState error={hist.error} /> : null}
      {hist.loading && !h ? <Loading /> : null}
      {h && chart ? (
        <>
          <div class="card">
            <div class="row between">
              <div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700 }} class="num">{fmtPrice(h.c[last])}</div>
                <Change change={row?.change ?? null} pct={row?.change_pct ?? null} />
              </div>
              <Composite value={(row?.composite as number | null) ?? h.scores?.composite ?? null} />
            </div>
            {row ? <div style={{ marginTop: '0.75rem' }}><ScoreRow row={row} /></div> : null}
            <Flags flags={row?.flags} />
          </div>

          <div class="card">
            <div class="row between wrap">
              <div class="segmented" role="group" aria-label="價格模式">
                <button aria-pressed={mode === 'adj'} onClick={() => setMode('adj')}>還原</button>
                <button aria-pressed={mode === 'raw'} onClick={() => setMode('raw')}>原始</button>
              </div>
              {h.cost ? (
                <label class="row small"><input type="checkbox" checked={costLines} onChange={(e) => setCostLines((e.target as HTMLInputElement).checked)} /> 法人成本線（原始價）</label>
              ) : null}
            </div>
            <KChart ohlc={chart.ohlc} volume={chart.volume} overlays={chart.overlays} lower={chart.lowerPanel}
              ariaLabel={`${h.name} ${mode === 'adj' ? '還原' : '原始'} K 線圖，最新收盤 ${fmtPrice(h.c[last])}`} />
            <div class="chips" role="group" aria-label="下方指標" style={{ marginTop: '0.5rem' }}>
              {available.map((p) => (
                <button key={p.id} class="chip" aria-pressed={lower === p.id} onClick={() => setLower(p.id)}>{p.label}</button>
              ))}
            </div>
            {mode === 'raw' && h.cost ? <p class="tiny muted">法人成本線為估算值：以淨買超日股數 × 當日均價加權（見方法說明）。</p> : null}
          </div>

          <StockExtras h={h} />
          {h.scores ? <ScoreDetailView detail={h.scores} /> : null}

          <h2 class="title-2">近期籌碼</h2>
          <div class="card scroll-x">
            <table class="table">
              <thead>
                <tr><th>日期</th><th>收盤</th><th>外資</th><th>投信</th><th>自營商</th><th>融資餘額</th><th>融券餘額</th></tr>
              </thead>
              <tbody>
                {h.d.slice(-10).reverse().map((d, k) => {
                  const i = last - k;
                  return (
                    <tr key={d}>
                      <td>{d.slice(5)}</td>
                      <td>{fmtPrice(h.c[i])}</td>
                      <td><Signed value={h.fn[i]} format={fmtLots} /></td>
                      <td><Signed value={h.tn[i]} format={fmtLots} /></td>
                      <td><Signed value={h.dn[i]} format={fmtLots} /></td>
                      <td>{fmtInt(h.mb[i])}</td>
                      <td>{fmtInt(h.sb[i])}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p class="tiny muted">單位：張（法人買賣超為淨買超張數）。</p>
          </div>

          <h2 class="title-2">基本數據</h2>
          <div class="list">
            <div class="list-item"><span class="grow">成交量</span><span class="num">{fmtInt(h.v[last])} 張</span></div>
            <div class="list-item"><span class="grow">成交值</span><span class="num">{fmtNum(h.val[last], 1)} 百萬</span></div>
            <div class="list-item"><span class="grow">本益比</span><span class="num">{fmtNum(h.pe[last])}</span></div>
            <div class="list-item"><span class="grow">股價淨值比</span><span class="num">{fmtNum(h.pb[last])}</span></div>
            <div class="list-item"><span class="grow">殖利率</span><span class="num">{fmtNum(h.dy[last])}%</span></div>
            {h.shares ? <div class="list-item"><span class="grow">發行股數</span><span class="num">{fmtNum(h.shares / 1e8, 2)} 億股</span></div> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
