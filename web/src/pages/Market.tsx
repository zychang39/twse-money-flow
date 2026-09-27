import { useMemo, useState } from 'preact/hooks';
import { Nav } from '../components/Nav';
import { DataStatus, ErrorState, Loading } from '../components/DataStatus';
import { Change, Signed } from '../components/Change';
import { LineChart } from '../components/LineChart';
import { useAsync } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { loadJson } from '../data/api';
import { fmtLots, fmtNum, fmtPct } from '../lib/format';

export interface Light { id: string; label: string; state: 'green' | 'yellow' | 'red' | 'gray'; value: string; basis: string }
export interface Sector { industry: string; count: number; up: number; down: number; foreign_1: number | null; trust_1: number | null; [k: string]: string | number | null }
export interface EtfMove { code: string; name: string; etfs: number; net_shares: number; net_value: number | null; detail: string }
export interface MarketData {
  date: string;
  taiex: { close: number | null; change: number | null; ma240: number | null };
  breadth: { up: number; down: number; flat: number };
  flows: { date: string; foreign: number | null; trust: number | null; dealer: number | null }[];
  sectors: Sector[];
  env?: { summary: string; lights: Light[] };
  temperature?: { lights: Light[]; retail?: { date: string; mtx: number | null; tmf: number | null }[] };
  etf_ranking?: { date: string | null; add: EtfMove[]; reduce: EtfMove[]; status?: string };
  active_etfs?: { code: string; name: string; close: number; value_million_20d: number | null }[];
}

function heatColor(v: number | null, scale: number): string {
  if (v === null || v === undefined) return 'var(--fill-strong)';
  const x = Math.max(-1, Math.min(1, v / scale));
  // 紅漲（正）綠跌（負），以透明度表示強度
  return x >= 0 ? `rgba(229, 53, 43, ${0.25 + 0.7 * x})` : `rgba(30, 158, 74, ${0.25 + 0.7 * -x})`;
}

function Lights({ lights }: { lights: Light[] }) {
  return (
    <div class="list">
      {lights.map((l) => (
        <div key={l.id} class="list-item" style={{ alignItems: 'flex-start' }}>
          <span class={`light ${l.state}`} role="img" aria-label={{ green: '綠燈', yellow: '黃燈', red: '紅燈', gray: '無資料' }[l.state]} />
          <div class="grow">
            <div class="row between small"><span class="bold">{l.label}</span><span class="num">{l.value}</span></div>
            <div class="tiny muted">{l.basis}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SectorStocks({ industry }: { industry: string }) {
  const summary = useScoredSummary();
  const rows = useMemo(() => (summary.data?.rows ?? []).filter((r) => r.industry === industry)
    .sort((a, b) => ((b.foreign_net_5d ?? 0) + (b.trust_net_5d ?? 0)) * (b.close ?? 0) - ((a.foreign_net_5d ?? 0) + (a.trust_net_5d ?? 0)) * (a.close ?? 0)), [summary.data, industry]);
  return (
    <div>
      <Nav title={industry} back="/market" subtitle="依外資＋投信近 5 日買超金額排序" />
      {summary.loading ? <Loading /> : null}
      <div class="list">
        {rows.map((r) => (
          <a key={r.code} class="list-item" href={`#/stock/${r.code}`}>
            <span class="grow">{r.name} <span class="small muted">{r.code}</span></span>
            <span class="small"><Change change={r.change} pct={r.change_pct} /></span>
            <span class="small num" style={{ minWidth: '4.5rem', textAlign: 'right' }}>
              <Signed value={(r.foreign_net_5d ?? 0) + (r.trust_net_5d ?? 0)} format={fmtLots} /> 張
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function Market({ sector }: { sector?: string }) {
  const market = useAsync(() => loadJson<MarketData>('market.json'), []);
  const [period, setPeriod] = useState<1 | 5 | 20>(5);
  const [metric, setMetric] = useState<'net' | 'ret'>('net');
  if (sector) return <SectorStocks industry={sector} />;
  const m = market.data;
  const values = m ? m.sectors.map((s) => (s[`${metric}_${period}`] as number | null) ?? 0) : [];
  const scale = Math.max(1e-9, ...values.map((v) => Math.abs(v)));
  return (
    <div>
      <Nav title="市場" />
      <DataStatus date={m?.date} />
      {market.error ? <ErrorState error={market.error} /> : null}
      {market.loading ? <Loading /> : null}
      {m ? (
        <>
          <div class="card">
            <div class="row between">
              <div>
                <div class="small muted">加權指數</div>
                <div class="headline num">{fmtNum(m.taiex.close, 2)} <Change change={m.taiex.change} /></div>
              </div>
              <div class="small" style={{ textAlign: 'right' }}>
                <div>年線 {fmtNum(m.taiex.ma240, 0)}</div>
                <div>上漲 {m.breadth.up} · 下跌 {m.breadth.down} · 平盤 {m.breadth.flat}</div>
              </div>
            </div>
          </div>

          <h2 class="title-2">資金環境燈號</h2>
          {m.env ? <Lights lights={m.env.lights} /> : <div class="card small muted">資料源待處理（期貨、匯率、利率資料尚未就緒）。</div>}

          <h2 class="title-2">市場溫度</h2>
          {m.temperature ? <Lights lights={m.temperature.lights} /> : <div class="card small muted">資料源待處理。</div>}

          <h2 class="title-2">三大法人買賣超（億元）</h2>
          <div class="card">
            <LineChart dates={m.flows.map((f) => f.date)} ariaLabel="三大法人每日買賣超金額" format={(v) => v.toFixed(0)} lines={[
              { label: '外資', color: '#af52de', values: m.flows.map((f) => f.foreign) },
              { label: '投信', color: '#ff9500', values: m.flows.map((f) => f.trust) },
              { label: '自營商', color: '#8e8e93', values: m.flows.map((f) => f.dealer) },
            ]} />
          </div>

          <h2 class="title-2">產業資金輪動</h2>
          <div class="row wrap">
            <div class="segmented" role="group" aria-label="期間">
              {([1, 5, 20] as const).map((k) => <button key={k} aria-pressed={period === k} onClick={() => setPeriod(k)}>{k} 日</button>)}
            </div>
            <div class="segmented" role="group" aria-label="指標">
              <button aria-pressed={metric === 'net'} onClick={() => setMetric('net')}>法人淨買超</button>
              <button aria-pressed={metric === 'ret'} onClick={() => setMetric('ret')}>漲跌幅</button>
            </div>
          </div>
          <div class="heat" style={{ marginTop: '0.75rem' }}>
            {m.sectors.map((s) => {
              const v = s[`${metric}_${period}`] as number | null;
              const r = s[`ret_${period}`] as number | null;
              const n = s[`net_${period}`] as number | null;
              return (
                <button key={s.industry} style={{ background: heatColor(v, scale), color: 'var(--label)' }} onClick={() => (location.hash = `#/market/${encodeURIComponent(s.industry)}`)}
                  aria-label={`${s.industry}：法人淨買超 ${fmtNum(n, 1)} 億、漲跌幅中位數 ${fmtPct(r)}（${period} 日）`}>
                  <div class="bold">{s.industry}</div>
                  <div aria-hidden="true">{metric === 'net' ? `${n !== null && n > 0 ? '▲' : n !== null && n < 0 ? '▼' : ''} ${fmtNum(n, 1)} 億` : `${r !== null && r > 0 ? '▲' : r !== null && r < 0 ? '▼' : ''} ${fmtPct(r)}`}</div>
                  <div class="tiny" aria-hidden="true">{s.count} 檔</div>
                </button>
              );
            })}
          </div>
          <p class="tiny muted">法人淨買超金額 = Σ(三大法人淨買超股數 × 收盤價)；漲跌幅為產業內個股還原報酬的中位數。點選產業查看個股。</p>

          <h2 class="title-2">主動式 ETF 加碼／減碼</h2>
          {m.etf_ranking && m.etf_ranking.add.length ? (
            <div class="grid two">
              {(['add', 'reduce'] as const).map((k) => (
                <div class="card" key={k}>
                  <div class="headline">{k === 'add' ? '跨檔加碼' : '跨檔減碼'}</div>
                  {m.etf_ranking![k].slice(0, 10).map((e) => (
                    <a key={e.code} class="row between small" href={`#/stock/${e.code}`} style={{ minHeight: '2.25rem', color: 'inherit' }}>
                      <span>{e.name} <span class="muted">{e.code}</span></span>
                      <span class="num">{e.etfs} 檔 · <Signed value={e.net_shares / 1000} format={fmtLots} /> 張</span>
                    </a>
                  ))}
                </div>
              ))}
            </div>
          ) : <div class="card small muted">{m.etf_ranking?.status ?? '資料源待處理：主動式 ETF 每日持股揭露尚未取得。'}</div>}
          {m.active_etfs && m.active_etfs.length ? (
            <div class="card">
              <div class="headline">主動式 ETF 清單（{m.active_etfs.length} 檔，依 20 日均成交值）</div>
              {m.active_etfs.slice(0, 30).map((e) => (
                <a key={e.code} class="row between small" href={`#/stock/${e.code}`} style={{ minHeight: '2.25rem', color: 'inherit' }}>
                  <span>{e.name} <span class="muted">{e.code}</span></span>
                  <span class="num">{fmtNum(e.close, 2)} · {e.value_million_20d === null ? '—' : `${fmtNum(e.value_million_20d, 0)} 百萬`}</span>
                </a>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
