/**
 * 狀態設計：資料日期與更新時間、休市日、資料過期、資料源異常、示範資料、骨架、空狀態（附下一步）、錯誤、資料累積中。
 * 語氣平靜：不閃爍、不倒數；只有真正的風險用琥珀色。
 */
import type { ComponentChildren } from 'preact';
import { useAsync } from '../hooks';
import { stageLine, stageLineText } from '../lib/stages';
import { loadMeta } from '../data/api';
import { makeCalendar } from '../lib/tradingCalendar';
import { freshView } from '../lib/freshness';
import { affectedFor, asofSummary } from '../lib/health';
import type { AsofKey } from '../lib/asof';
import { IconClock, IconCloudOff, IconMoonRest, IconSeed } from './Icons';
import { StaleNote } from './kit';

function md(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${'日一二三四五六'[d.getUTCDay()]}）`;
}

/**
 * 頁首下方的一行資料說明：資料日期、更新時間；休市／過期／異常時以平靜的提示呈現。
 * uses：這一頁實際用到的資料來源 id（見 lib/health 的 PAGE_SOURCES）。只有其中有來源異常、
 * 而且影響最新資料時，才在最後加一段琥珀色小字「N 個資料源異常」（連到資料健康頁）；沒傳 uses 的頁面不顯示。
 * asof（2026-10-02 健檢 M1-4）：這一頁用到的資料集，第二行小字標各自的資料日「各資料集：三大法人 10/2・融資融券 10/1・…」，
 * 因為頁首的「資料至」只是收盤行情的日期，法人、信用、集保各有自己的日期。
 */
export function DataStatus({ date, extra, uses, asof }: { date?: string | null; extra?: ComponentChildren; uses?: string[]; asof?: AsofKey[] }) {
  const meta = useAsync(loadMeta, []);
  if (meta.error) return <ErrorState error={meta.error} title="尚無可用資料" />;
  if (!meta.data) return <div class="meta-line" aria-hidden="true">&nbsp;</div>;
  const d = date ?? meta.data.market_date;
  if (!d) return <Banner kind="risk" icon={<IconCloudOff />} title="資料源待處理">尚未取得任何交易日資料。</Banner>;
  const gen = meta.data.generated_at ? new Date(meta.data.generated_at) : null;
  const genText = gen ? new Date(gen.getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16) : null;
  // 2026-10-06：資料新鮮度規則（lib/freshness）——凌晨看前一個交易日的資料不是「尚未更新」，落後以各資料集的應有日判斷
  const fv = freshView(meta.data, makeCalendar(meta.data.calendar));
  const failed = affectedFor(uses, meta.data.sources_affected ?? meta.data.sources_failed).length;
  const asofLine = asof ? asofSummary(meta.data.asof, asof) : null;
  return (
    <>
      <p class="meta-line">
        {fv.holiday ? <span class="meta-phase" title="休市日不會中斷你的連續天數"><IconMoonRest />今天休市・</span> : null}
        {!fv.holiday && fv.todayNotUpdated ? <span class="meta-phase" title="預期公布時間已過、資料還沒進來：收盤行情 15:00、三大法人與期貨法人 16:00、融資融券 22:00"><IconClock />今天的資料尚未更新・</span> : null}
        {meta.data.demo ? <span class="meta-demo w6">示範資料（合成數據）・</span> : null}
        <a href="#/me/data" class="meta-link" title="資料狀態：每個資料集的來源、最新日、應有日、涵蓋率、回補進度">資料至 {md(d)} 收盤</a>{genText ? `・${genText} 更新` : ''}{extra ? <>・{extra}</> : null}
        {failed ? <>・<a class="meta-alert" href="#/me/health">{failed} 個資料源異常</a></> : null}
        {fv.next ? <><br /><span class="meta-next" data-testid="meta-next">{fv.next}</span></> : null}
      </p>
      {asofLine ? <p class="meta-line asof-line" data-testid="asof-line" style={{ marginTop: 0 }}>各資料集：{asofLine}</p> : null}
      {/* 只列落後的資料集與資料日（最新的不列）；橘色標題＋一行說明，點進資料健康頁 */}
      {fv.lagging ? <StaleNote lead="資料落後">{fv.lagging}</StaleNote> : null}
    </>
  );
}

/**
 * 各資料集的資料日（獨立一行，給沒有 DataStatus 的頁面或區塊）：「各資料集：三大法人 10/2・融資融券 10/1」。
 * meta.json 還沒有 asof（舊版）時不顯示。
 */
export function AsOf({ keys, prefix = '各資料集：' }: { keys: AsofKey[]; prefix?: string }) {
  const meta = useAsync(loadMeta, []);
  const line = meta.data ? asofSummary(meta.data.asof, keys) : null;
  if (!line) return null;
  return <p class="meta-line asof-line" data-testid="asof-line">{prefix}{line}</p>;
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

/**
 * M3.4：今晚頁狀態列顯示分段更新（收盤行情、法人、信用）各段的狀態。
 * M1-2：依交易日曆——休市日寫「休市・最近交易日 10/2：收盤行情 完成・法人 完成・信用 未更新」；
 * 交易日 14:15 之前寫「今天尚未開始更新（約 14:15 起）」。
 */
export function StageStatus() {
  const meta = useAsync(loadMeta, []);
  if (!meta.data?.schedule) return null;
  const tpe = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
  const line = stageLine(meta.data, tpe.slice(0, 10), makeCalendar(meta.data.calendar), tpe.slice(11, 16));
  return (
    <p class="meta-line stage-line" data-testid="stage-status" data-kind={line.kind} aria-label={`分段更新：${stageLineText(line)}`}>
      {line.message ? <span class="stage waiting">{line.message}</span> : null}
      {line.prefix ? <span class="stage-prefix">{line.prefix}</span> : null}
      {line.items.map((s, i) => (
        <span key={s.id} class={`stage ${s.state}`}>{i ? '・' : ''}{s.label} {s.text}</span>
      ))}
    </p>
  );
}

/**
 * 資料落後（F 節，M7；2026-10-06 改用資料新鮮度規則）：頁首下方一行橘色提示，只列落後的資料集（資料日早於應有日）
 * 與落後交易日數，點進資料健康頁。全部最新、休市、還沒到預期公布時間都不顯示（那些不是錯誤）。
 */
export function PageStale({ testid = 'page-stale' }: { testid?: string }) {
  const meta = useAsync(loadMeta, []);
  if (!meta.data?.market_date) return null;
  const fv = freshView(meta.data, makeCalendar(meta.data.calendar));
  if (!fv.lagging) return null;
  return <StaleNote lead="資料落後" testid={testid}>{fv.lagging}</StaleNote>;
}
