import { PageHead, TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { useAsync } from '../hooks';
import { loadHealth, loadMeta } from '../data/api';
import type { HealthSource } from '../data/types';
import { InferredEvents } from '../components/InferredEvents';

const TIER_LABEL: Record<string, string> = { core: '核心', advanced: '進階', optional: '選配' };

/** 狀態點：正常＝實心、需注意＝琥珀、等待或待處理＝空心（不使用 emoji）。 */
function statusIcon(s: HealthSource): { dot: 'green' | 'red' | 'gray'; text: string } {
  if (s.verified === 'pending') return { dot: 'gray', text: '資料源待處理' };
  if (s.last_status === 'failed') return { dot: 'red', text: '最近一次失敗' };
  if (s.last_status === 'pending') return { dot: 'gray', text: '等待公布' };
  if (!s.last_success) return { dot: 'gray', text: '尚未抓取' };
  if (s.lag_days !== null && s.lag_days > 2) return { dot: 'red', text: `落後 ${s.lag_days} 個交易日` };
  return { dot: 'green', text: '正常' };
}

export default function Health() {
  const health = useAsync(loadHealth, []);
  const meta = useAsync(loadMeta, []);
  return (
    <div class="page">
      <TopBar back="/" avatar={false} />
      <PageHead eyebrow="我的" title={health.data ? `${health.data.sources.filter((s) => s.last_status === 'failed').length ? `${health.data.sources.filter((s) => s.last_status === 'failed').length} 個資料源最近失敗` : '資料源大致正常'}` : '資料健康'} />
      {health.error ? <ErrorState error={health.error} /> : null}
      {health.loading ? <Loading /> : null}
      {health.data ? (
        <>
          <div class="card">
            <div class="row between"><span>市場最新交易日</span><span class="num bold">{health.data.market_date ?? '—'}</span></div>
            <div class="row between small muted"><span>歷史資料</span><span>{health.data.first_date ?? '—'} 起，共 {health.data.trading_days} 個交易日</span></div>
            <div class="row between small muted"><span>衍生資料產生時間</span><span>{meta.data?.generated_at?.replace('T', ' ').slice(0, 16) ?? '—'}</span></div>
            {health.data.closed_days.length ? <div class="small muted">臨時休市（無行情）：{health.data.closed_days.join('、')}</div> : null}
          </div>
          {(['core', 'advanced', 'optional'] as const).map((tier) => (
            <section key={tier}>
              <h2 class="section-title">{TIER_LABEL[tier]}資料</h2>
              <div class="list">
                {health.data!.sources.filter((s) => s.tier === tier).map((s) => {
                  const st = statusIcon(s);
                  return (
                    <div key={s.id} class="list-item" style={{ alignItems: 'flex-start' }}>
                      <span class={`light-dot ${st.dot}`} aria-hidden="true" />
                      <div class="grow">
                        <div class="body">{s.label}</div>
                        <div class="caption muted">
                          {st.text} · 最後成功 {s.last_success ?? '—'}{s.rows !== null && s.rows !== undefined ? ` · ${s.rows} 筆` : ''}
                          {s.verified === 'unverified' ? ' · 未以真實樣本驗證' : ''}
                        </div>
                        {s.last_message && s.last_status !== 'ok' ? <div class="caption risk">{s.last_message}</div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          <InferredEvents events={meta.data?.adjust_inferred} total={meta.data?.adjust_events} />
          <h2 class="section-title">最近執行</h2>
          <div class="list">
            {health.data.runs.map((r) => (
              <div key={r.at} class="list-item" style={{ alignItems: 'flex-start' }}>
                <span class="badge">{r.task}</span>
                <div class="grow caption">
                  <div>{r.at.replace('T', ' ').slice(0, 16)} · {r.requests} 次請求 · 成功 {r.ok}</div>
                  {r.failed.length ? <div class="caption risk">失敗：{r.failed.slice(0, 5).join('；')}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
