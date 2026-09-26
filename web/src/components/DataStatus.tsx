import { useAsync } from '../hooks';
import { loadMeta } from '../data/api';
import { businessDaysSince } from '../lib/dates';

/** 每頁顯示資料日期；資料過期、示範資料、資料源待處理時提示。 */
export function DataStatus({ date }: { date?: string | null }) {
  const meta = useAsync(loadMeta, []);
  if (meta.error) return <div class="banner danger" role="status">資料源待處理：尚無可用的衍生資料（{meta.error.message}）</div>;
  if (!meta.data) return null;
  const d = date ?? meta.data.market_date;
  if (!d) return <div class="banner danger" role="status">資料源待處理：尚未取得任何交易日資料。</div>;
  const lag = businessDaysSince(d, new Date());
  return (
    <>
      {meta.data.demo ? <div class="banner info" role="status">示範資料（合成數據，僅供介面展示）</div> : null}
      <p class="small muted" style={{ margin: '0.25rem 0' }}>
        資料日期 {d}
        {lag > 2 ? <span class="flag" style={{ marginLeft: '0.5rem' }}>資料可能過期（落後 {lag} 個工作日）</span> : null}
        {meta.data.sources_failed?.length ? (
          <a class="flag danger" style={{ marginLeft: '0.5rem' }} href="#/more/health">
            {meta.data.sources_failed.length} 個資料源異常
          </a>
        ) : null}
      </p>
    </>
  );
}

export function Loading({ label = '載入中' }: { label?: string }) {
  return (
    <div role="status" aria-label={label}>
      <div class="skeleton" />
      <div class="skeleton" style={{ marginTop: '0.75rem' }} />
    </div>
  );
}

export function ErrorState({ error }: { error: Error }) {
  return <div class="banner danger" role="alert">資料源待處理：{error.message}</div>;
}
