/**
 * 狀態設計：資料日期與更新時間、休市日、資料過期、資料源異常、示範資料、骨架、空狀態（附下一步）、錯誤、資料累積中。
 * 語氣平靜：不閃爍、不倒數；只有真正的風險用琥珀色。
 */
import type { ComponentChildren } from 'preact';
import { useAsync } from '../hooks';
import { loadMeta } from '../data/api';
import { businessDaysSince, todayTpe } from '../lib/dates';
import { IconClock, IconCloudOff, IconMoonRest, IconRisk, IconSeed } from './Icons';

function md(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${'日一二三四五六'[d.getUTCDay()]}）`;
}

export type DataPhase = 'fresh' | 'holiday' | 'pending' | 'stale';

/** 依資料日期與現在時間判斷：今日資料、休市、尚未更新、過期。 */
export function dataPhase(date: string, now = new Date()): { phase: DataPhase; lag: number } {
  const today = todayTpe(now);
  if (date >= today) return { phase: 'fresh', lag: 0 };
  const lag = businessDaysSince(date, now);
  const tpe = new Date(now.getTime() + 8 * 3600 * 1000);
  const dow = tpe.getUTCDay();
  if (lag > 2) return { phase: 'stale', lag };
  if (dow === 0 || dow === 6) return { phase: 'holiday', lag };
  if (lag <= 1 && tpe.getUTCHours() < 18) return { phase: 'pending', lag };
  return { phase: lag === 0 ? 'holiday' : 'pending', lag };
}

/** 頁首下方的一行資料說明：資料日期、更新時間；休市／過期／異常時以平靜的提示呈現。 */
export function DataStatus({ date, extra }: { date?: string | null; extra?: ComponentChildren }) {
  const meta = useAsync(loadMeta, []);
  if (meta.error) return <ErrorState error={meta.error} title="尚無可用資料" />;
  if (!meta.data) return <div class="meta-line" aria-hidden="true">&nbsp;</div>;
  const d = date ?? meta.data.market_date;
  if (!d) return <Banner kind="risk" icon={<IconCloudOff />} title="資料源待處理">尚未取得任何交易日資料。</Banner>;
  const gen = meta.data.generated_at ? new Date(meta.data.generated_at) : null;
  const genText = gen ? new Date(gen.getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16) : null;
  const { phase, lag } = dataPhase(d);
  const failed = meta.data.sources_failed?.length ?? 0;
  return (
    <>
      <p class="meta-line">
        {phase === 'holiday' ? <span class="meta-phase" title="休市日不會中斷你的連續天數"><IconMoonRest />今天休市・</span> : null}
        {phase === 'pending' ? <span class="meta-phase" title="通常在 17:30 與 21:30 更新"><IconClock />今天的資料尚未更新・</span> : null}
        {meta.data.demo ? <span class="meta-demo w6">示範資料（合成數據）・</span> : null}
        資料至 {md(d)} 收盤{genText ? `・${genText} 更新` : ''}{extra ? <>・{extra}</> : null}
        {failed ? <>・<a href="#/me/health">{failed} 個資料源異常</a></> : null}
      </p>
      {phase === 'stale' ? <Banner kind="risk" icon={<IconRisk />} title="資料可能過期">最新資料停在 {md(d)}，落後 {lag} 個工作日。可到「資料健康」查看原因。</Banner> : null}
    </>
  );
}

export function Banner({ kind = 'info', icon, title, children, action }: { kind?: 'info' | 'risk'; icon?: ComponentChildren; title: ComponentChildren; children?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class={`banner ${kind}`} role="status">
      {icon ? <span class="ico">{icon}</span> : null}
      <div class="grow">
        <div class="w6">{title}</div>
        {children ? <div class="muted t1">{children}</div> : null}
        {action ? <div>{action}</div> : null}
      </div>
    </div>
  );
}

/** 骨架：與實際版面相同的區塊輪廓，呼吸式淡入淡出（不閃爍）。 */
export function Loading({ label = '載入中', hero }: { label?: string; hero?: boolean }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" style={{ marginTop: 'var(--s-4)' }}>
      {hero ? (
        <>
          <div class="skeleton line" style={{ width: '30%' }} />
          <div class="skeleton hero" style={{ marginTop: 'var(--s-2)' }} />
          <div class="skeleton line" style={{ width: '45%', marginTop: 'var(--s-1)' }} />
          <div class="skeleton" style={{ minHeight: '11rem', marginTop: 'var(--s-4)' }} />
          <div class="skeleton line" style={{ minHeight: '2.75rem', marginTop: 'var(--s-3)', borderRadius: 'var(--r-pill)' }} />
        </>
      ) : (
        <>
          <div class="skeleton" />
          <div class="skeleton" style={{ marginTop: 'var(--s-3)' }} />
        </>
      )}
    </div>
  );
}

/** 空狀態：一定附上一個明確的下一步行動。 */
export function EmptyState({ icon, title, text, action }: { icon?: ComponentChildren; title: string; text?: ComponentChildren; action: ComponentChildren }) {
  return (
    <div class="empty">
      {icon ? <div class="ico">{icon}</div> : null}
      <div class="body w6">{title}</div>
      {text ? <p class="caption">{text}</p> : <div style={{ height: 'var(--s-4)' }} />}
      {action}
    </div>
  );
}

export function ErrorState({ error, title = '這部分資料暫時無法取得', retry }: { error: Error; title?: string; retry?: () => void }) {
  return (
    <Banner kind="risk" icon={<IconCloudOff />} title={title}
      action={<>{retry ? <button class="btn small" onClick={retry}>重試</button> : null} <a class="btn small" href="#/me/health">查看資料健康</a></>}>
      {error.message}。其他區塊不受影響；離線時會顯示上次快取的資料。
    </Banner>
  );
}

/** 資料累積中（例如集保資料只從開始抓取的那週起累積）。 */
export function Accumulating({ what, since, detail }: { what: string; since?: string | null; detail?: string }) {
  return (
    <Banner icon={<IconSeed />} title={`${what}資料累積中`}>
      {since ? `自 ${since} 開始累積。` : ''}{detail ?? '累積足夠期間後才會計入分數或顯示趨勢。'}
    </Banner>
  );
}
