/**
 * 指標格（2026-10-02 健檢 M1-7）：整段文字改成「名稱／數值／小字」的格子，2 欄排列、數字 tabular-nums。
 * 策略卡、10 檔組合摘要、分布、資金指標都用這一個元件，不各頁各寫。
 */
import type { ComponentChildren } from 'preact';

export interface MetricItem {
  k: string;
  v: ComponentChildren;
  /** 數值下方的小字（基準、樣本數、門檻） */
  sub?: ComponentChildren;
  /** 風險語氣（琥珀；只給真正的風險） */
  risk?: boolean;
  /** 佔滿整列 */
  wide?: boolean;
}

export function MetricGrid({ items, cols = 2, label, testid }: { items: MetricItem[]; cols?: 2 | 3; label?: string; testid?: string }) {
  return (
    <dl class={`mg mg-${cols}`} aria-label={label} data-testid={testid}>
      {items.map((it) => (
        <div key={it.k} class={`mg-i${it.wide ? ' mg-wide' : ''}`}>
          <dt class="mg-k">{it.k}</dt>
          <dd class={`mg-v num${it.risk ? ' risk' : ''}`}>{it.v}</dd>
          {it.sub ? <dd class="mg-s">{it.sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/** 鍵值列（可換行）：取代會被裁切的單行 th／td。 */
export function KeyValueList({ rows, label }: { rows: { k: string; v: ComponentChildren; sub?: ComponentChildren }[]; label?: string }) {
  return (
    <dl class="kv" aria-label={label}>
      {rows.map((r) => (
        <div key={r.k} class="kv-row">
          <dt class="kv-k">{r.k}</dt>
          <dd class="kv-v">{r.v}{r.sub ? <span class="kv-sub">{r.sub}</span> : null}</dd>
        </div>
      ))}
    </dl>
  );
}
