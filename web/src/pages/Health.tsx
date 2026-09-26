import { Nav } from '../components/Nav';
import { ErrorState, Loading } from '../components/DataStatus';
import { useAsync } from '../hooks';
import { loadHealth, loadMeta } from '../data/api';
import type { HealthSource } from '../data/types';

const TIER_LABEL: Record<string, string> = { core: '核心', advanced: '進階', optional: '選配' };

function statusIcon(s: HealthSource): { icon: string; text: string } {
  if (s.verified === 'pending') return { icon: '⛔', text: '資料源待處理' };
  if (s.last_status === 'failed') return { icon: '❌', text: '最近一次失敗' };
  if (s.last_status === 'pending') return { icon: '⏳', text: '等待公布' };
  if (!s.last_success) return { icon: '○', text: '尚未抓取' };
  if (s.lag_days !== null && s.lag_days > 2) return { icon: '⚠️', text: `落後 ${s.lag_days} 個交易日` };
  return { icon: '✅', text: '正常' };
}

export default function Health() {
  const health = useAsync(loadHealth, []);
  const meta = useAsync(loadMeta, []);
  return (
    <div>
      <Nav title="資料健康" back="/more" />
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
                      <span aria-hidden="true">{st.icon}</span>
                      <div class="grow">
                        <div class="small bold">{s.label}</div>
                        <div class="tiny muted">
                          {st.text} · 最後成功 {s.last_success ?? '—'}{s.rows !== null && s.rows !== undefined ? ` · ${s.rows} 筆` : ''}
                          {s.verified === 'unverified' ? ' · 未以真實樣本驗證' : ''}
                        </div>
                        {s.last_message && s.last_status !== 'ok' ? <div class="tiny" style={{ color: 'var(--danger-text)' }}>{s.last_message}</div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          <h2 class="section-title">最近執行</h2>
          <div class="list">
            {health.data.runs.map((r) => (
              <div key={r.at} class="list-item" style={{ alignItems: 'flex-start' }}>
                <span class="badge">{r.task}</span>
                <div class="grow small">
                  <div>{r.at.replace('T', ' ').slice(0, 16)} · {r.requests} 次請求 · 成功 {r.ok}</div>
                  {r.failed.length ? <div class="tiny" style={{ color: 'var(--danger-text)' }}>失敗：{r.failed.slice(0, 5).join('；')}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
