/**
 * 資料健康：一般使用者先看到白話說明（發生什麼事、影不影響今天的畫面），技術細節收在「詳細資訊」。
 * 狀態點：正常＝實心；相容模式或等待＝空心；只有影響最新資料的異常用琥珀（不使用 emoji）。
 */
import { PageHead, TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { useAsync } from '../hooks';
import { loadHealth, loadMeta } from '../data/api';
import type { HealthSource } from '../data/types';
import { InferredEvents } from '../components/InferredEvents';
import { describeSource, healthConclusion, type HealthTone } from '../lib/health';

const TIER_LABEL: Record<string, string> = { core: '核心', advanced: '進階', optional: '選配' };
const DOT: Record<HealthTone, 'green' | 'red' | 'gray'> = { ok: 'green', compat: 'gray', wait: 'gray', risk: 'red' };

function Details({ s }: { s: HealthSource }) {
  const warnings = s.format_warnings ?? [];
  const technical = s.last_message && s.last_status !== 'ok';
  if (!technical && !warnings.length) return null;
  return (
    <details class="tech">
      <summary>詳細資訊</summary>
      <dl class="caption">
        {technical ? <><dt>最近一次訊息</dt><dd class="mono">{s.last_message}</dd></> : null}
        {warnings.length ? <><dt>格式變動警告{s.format_warning_date ? `（${s.format_warning_date} 的資料）` : ''}</dt>{warnings.map((w) => <dd key={w} class="mono">{w}</dd>)}</> : null}
        <dt>最近嘗試</dt><dd>{s.last_attempt?.replace('T', ' ').slice(0, 16) ?? '—'}・連續失敗 {s.consecutive_failures} 次・來源 id {s.id}</dd>
      </dl>
    </details>
  );
}

export default function Health() {
  const health = useAsync(loadHealth, []);
  const meta = useAsync(loadMeta, []);
  return (
    <div class="page">
      <TopBar back="/" avatar={false} />
      <PageHead eyebrow="我的" title={health.data ? healthConclusion(health.data.sources) : '資料健康'} />
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
                  const d = describeSource(s);
                  return (
                    <div key={s.id} class="list-item" style={{ alignItems: 'flex-start' }}>
                      <span class={`light-dot ${DOT[d.tone]}`} aria-hidden="true" />
                      <div class="grow" style={{ minWidth: 0 }}>
                        <div class="body">{s.label}</div>
                        {d.tone !== 'ok' ? <div class={`caption ${d.tone === 'risk' ? 'risk w5' : 't1'}`}>{d.text}</div> : null}
                        <div class="caption muted">
                          {d.tone === 'ok' ? '正常・' : ''}最後成功 {s.last_success ?? '—'}{s.rows !== null && s.rows !== undefined ? `・${s.rows} 筆` : ''}
                          {s.verified === 'unverified' ? '・未以真實樣本驗證' : ''}
                        </div>
                        <Details s={s} />
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
                <div class="grow caption" style={{ minWidth: 0 }}>
                  <div>{r.at.replace('T', ' ').slice(0, 16)} · {r.requests} 次請求 · 成功 {r.ok}</div>
                  {r.failed.length ? (
                    <details class="tech">
                      <summary>{r.failed.length} 筆失敗</summary>
                      <ul class="mono">{r.failed.slice(0, 8).map((f) => <li key={f}>{f}</li>)}</ul>
                    </details>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
