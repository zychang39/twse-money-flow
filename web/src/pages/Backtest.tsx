import { useEffect, useState } from 'preact/hooks';
import { Nav } from '../components/Nav';
import { ErrorState, Loading } from '../components/DataStatus';
import { BacktestReport, type BacktestResult } from '../components/BacktestReport';
import { useAsync } from '../hooks';
import { loadJson } from '../data/api';
import { useRoute } from '../router';
import { decodeConditions, describeCondition } from '../lib/screener';
import { screenerConfig, type Condition } from '../lib/config';

interface Index { presets: { id: string; label: string; signals?: number; status?: string }[]; period: { start: string; end: string } }
const label = (f: string) => screenerConfig.fields[f]?.label ?? f;
const unit = (f: string) => screenerConfig.fields[f]?.unit ?? '';

function CustomRun({ conditions }: { conditions: Condition[] }) {
  const [state, setState] = useState<{ progress?: string; result?: BacktestResult; error?: string }>({});
  useEffect(() => {
    const worker = new Worker(new URL('../workers/backtest.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') setState({ progress: m.text });
      else if (m.type === 'done') setState({ result: m.result });
      else setState({ error: m.text });
    };
    worker.postMessage({ base: `${location.origin}${import.meta.env.BASE_URL}data/`, conditions });
    return () => worker.terminate();
  }, [JSON.stringify(conditions)]);
  if (state.error) return <div class="banner danger">{state.error}</div>;
  if (!state.result) return <div class="card" role="status">{state.progress ?? '準備中…'}<Loading /></div>;
  return <BacktestReport r={state.result} />;
}

export default function Backtest() {
  const route = useRoute();
  const custom = decodeConditions(route.query.get('c'));
  const customName = route.query.get('name') ?? '自訂條件';
  const index = useAsync(() => loadJson<Index>('backtests/index.json'), []);
  const [sel, setSel] = useState<string>(custom ? 'custom' : '');
  const presetId = sel && sel !== 'custom' ? sel : !custom ? index.data?.presets.find((p) => !p.status)?.id ?? '' : '';
  const preset = useAsync(() => (presetId ? loadJson<BacktestResult & { conditions: Condition[]; description: string }>(`backtests/${presetId}.json`) : Promise.resolve(null)), [presetId]);
  const showCustom = custom && (sel === 'custom' || sel === '');
  return (
    <div>
      <Nav title="回測" back="/screener" subtitle="T 日收盤後訊號、T+1 開盤進場、持有 N 日開盤出場；已扣交易成本" />
      {index.error ? <ErrorState error={index.error} /> : null}
      <div class="chips" role="group" aria-label="回測對象">
        {custom ? <button class="chip" aria-pressed={!!showCustom} onClick={() => setSel('custom')}>{customName}</button> : null}
        {index.data?.presets.map((p) => (
          <button key={p.id} class="chip" aria-pressed={!showCustom && presetId === p.id} disabled={!!p.status} onClick={() => setSel(p.id)}>
            {p.label}{p.status ? `（${p.status}）` : ''}
          </button>
        ))}
      </div>
      {showCustom ? (
        <>
          <p class="small muted">條件：{custom!.map((c) => describeCondition(c, label, unit)).join('；')}。自訂條件在瀏覽器內計算（範圍：成交值前 600 檔、最近約 2 年；首次需下載數 MB 資料）。</p>
          <CustomRun conditions={custom!} />
        </>
      ) : preset.data ? (
        <>
          <p class="small muted">{preset.data.description} 條件：{preset.data.conditions.map((c) => describeCondition(c, label, unit)).join('；')}（預先計算，全市場）。</p>
          <BacktestReport r={preset.data} />
        </>
      ) : preset.loading || index.loading ? <Loading /> : <div class="empty">尚無回測資料（資料源待處理）。</div>}
    </div>
  );
}
