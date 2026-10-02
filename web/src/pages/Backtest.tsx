import { useEffect, useState } from 'preact/hooks';
import { PageHead, TopBar } from '../components/Chrome';
import { logActivity } from '../db/db';
import { loadSummary } from '../data/api';
import { ErrorState, Loading } from '../components/DataStatus';
import { BacktestReport, type BacktestResult } from '../components/BacktestReport';
import { useAsync } from '../hooks';
import { loadJson } from '../data/api';
import { useRoute } from '../router';
import { backtestCustom, decodeConditions, describeCondition, presetScreens } from '../lib/screener';
import { screenerConfig, type Condition } from '../lib/config';

interface Index { presets: { id: string; label: string; signals?: number; status?: string }[]; period: { start: string; end: string } }
const label = (f: string) => screenerConfig.fields[f]?.label ?? f;
const unit = (f: string) => screenerConfig.fields[f]?.unit ?? '';

function CustomRun({ conditions, own }: { conditions: Condition[]; own: boolean }) {
  const [state, setState] = useState<{ progress?: string; result?: BacktestResult; error?: string }>({});
  useEffect(() => {
    const worker = new Worker(new URL('../workers/backtest.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') setState({ progress: m.text });
      else if (m.type === 'done') {
        setState({ result: m.result });
        // 「回測過自己的條件」：只在使用者儲存的條件組合跑完時記錄（紀律行為，與績效無關）
        if (own) loadSummary().then((s) => logActivity('backtest_own', s.date)).catch(() => undefined);
      }
      else setState({ error: m.text });
    };
    worker.postMessage({ base: `${location.origin}${import.meta.env.BASE_URL}data/`, conditions });
    return () => worker.terminate();
  }, [JSON.stringify(conditions)]);
  if (state.error) return <div class="banner danger">{state.error}</div>;
  if (!state.result) return <div class="card" role="status"><span class="caption muted">{state.progress ?? '準備中…'}</span><Loading /></div>;
  return <BacktestReport r={state.result} />;
}

export default function Backtest() {
  const route = useRoute();
  const decoded = decodeConditions(route.query.get('c'));
  // #11：網址的條件和內建組合相同 → 直接看該組合（不多一個同名標籤）；同名但條件不同 → 「名稱（已修改）」
  const presetList = presetScreens();
  const bc = decoded ? backtestCustom(decoded, route.query.get('name'), presetList) : null;
  const custom = bc && !bc.presetId ? decoded : null;
  const customName = bc?.name ?? '自訂條件';
  const own = route.query.get('own') === '1';
  const index = useAsync(() => loadJson<Index>('backtests/index.json'), []);
  const [sel, setSel] = useState<string>(custom ? 'custom' : route.query.get('preset') ?? bc?.presetId ?? '');
  const presetId = sel && sel !== 'custom' ? sel : !custom ? index.data?.presets.find((p) => !p.status)?.id ?? '' : '';
  const preset = useAsync(() => (presetId ? loadJson<BacktestResult & { conditions: Condition[]; description: string; subtitle?: string }>(`backtests/${presetId}.json`) : Promise.resolve(null)), [presetId]);
  const showCustom = custom && (sel === 'custom' || sel === '');
  return (
    <div class="page">
      <TopBar back="/explore" />
      <PageHead eyebrow="條件在過去表現如何？（看樣本數與可信度）" title="回測">
        <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>T 日收盤後訊號、T+1 開盤進場、持有 N 日開盤出場；已扣手續費、證交稅與滑價。</p>
      </PageHead>
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
          <p class="caption muted" style={{ marginTop: 'var(--s-3)' }}>條件：{custom!.map((c) => describeCondition(c, label, unit)).join('；')}。自訂條件在瀏覽器內計算（範圍：成交值前 600 檔、最近約 2 年；首次需下載數 MB 資料）。</p>
          <CustomRun conditions={custom!} own={own} />
        </>
      ) : preset.data ? (
        <>
          <p class="caption muted" style={{ marginTop: 'var(--s-3)' }}>{preset.data.subtitle ? <b class="t1">{preset.data.subtitle}。</b> : null}{preset.data.description} 條件：{preset.data.conditions.map((c) => describeCondition(c, label, unit)).join('；')}（預先計算，全市場）。</p>
          <BacktestReport r={preset.data} />
        </>
      ) : preset.loading || index.loading ? <Loading /> : <div class="empty"><p>尚無回測資料（資料源待處理）。</p><a class="btn" href="#/explore/screener">前往選股建立條件</a></div>}
    </div>
  );
}
