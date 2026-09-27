import type { InferredEvent } from '../data/types';

/** 資料健康頁：列出每一筆以價格跳空推估的還原事件，標示「推估」，供人工檢查。 */
export function InferredEvents({ events, total }: { events: InferredEvent[] | undefined; total?: number }) {
  const list = [...(events ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section aria-label="還原價推估事件">
      <h2 class="section-title">還原價推估事件（{list.length} 筆{total !== undefined ? ` / 全部 ${total} 筆` : ''}）</h2>
      <p class="small muted">
        只有在「前一個交易日之後到跳空當天」沒有任何官方除權息、減資、面額變更或分割事件可以解釋 ±35% 以上的跳空時才推估；官方事件與推估不會同時作用在同一個跳空上。請對照公司公告檢查。
      </p>
      <div class="list">
        {list.length ? list.map((e) => (
          <a key={`${e.code}-${e.date}`} class="list-item" href={`#/stock/${e.code}`}>
            <span class="badge">推估</span>
            <span class="grow small">{e.name} <span class="muted">{e.code}</span></span>
            <span class="small num muted">{e.date}</span>
            <span class="small num">因子 {e.factor.toFixed(4)}</span>
          </a>
        )) : <div class="list-item small muted">目前沒有推估事件。</div>}
      </div>
    </section>
  );
}
