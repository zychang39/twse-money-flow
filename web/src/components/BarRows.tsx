/**
 * 密集橫條列（2026-10-09）：名稱｜橫條｜數值，每列 44pt（點擊區域下限），列與列之間只有橫線（.ui-row + .ui-row）。
 * 主動式 ETF 總覽（持股變動）與詳細頁（加碼／減碼、持股占比）共用：
 * - 名稱欄固定寬（6.5em）：每列橫條的 0 軸對齊；名稱過長以「…」截斷（朗讀用 label 的全名）。
 * - 第二行（副資訊）在名稱與數值各自的下方，不佔整列；沒有 › 欄（整列可點時仍是連結）。
 * - 橫條：發散（值可正負，以 0 為中線，紅＝正、綠＝負）或單向（0～max）；同一張圖用同一個 max。
 */
import type { ComponentChildren } from 'preact';
import { DivergingBar, ProgressBar } from './kit';

export type BarSpec =
  | { kind: 'diverging'; value: number | null | undefined; max: number }
  | { kind: 'progress'; value: number | null | undefined; max: number; color?: string }
  /** 順風檢查：從 0 畫到這一類的報酬，另有 0 與大盤兩條線（過了大盤那條線＝贏過大盤）；x、over 來自 lib/tailwind.barScale */
  | { kind: 'wind'; value: number | null | undefined; market: number | null | undefined; x: (v: number) => number; over: (v: number) => boolean; /** 圓點：第二個參考值（類股＝排除最大權值股的等權籃子） */ dot?: number | null };

/**
 * 兩條線的橫條（2026-11-19；順風選股）：同一張圖共用刻度，0 與大盤的線在每一列的同一個位置，上下連成兩條直線，
 * 把圖分成三區——0 的左邊（賠錢）、0 到大盤之間（賺錢但輸大盤）、大盤右邊（贏過大盤）。紅＝正、綠＝負（漲跌的顏色）。
 */
export function WindTrack({ value, market, x, over, dot }: { value: number | null | undefined; market: number | null | undefined; x: (v: number) => number; over: (v: number) => boolean; dot?: number | null }) {
  const has = typeof value === 'number' && Number.isFinite(value);
  const x0 = x(0);
  const xv = has ? x(value) : x0;
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  return (
    <span class="wtrack">
      {has ? <i class={`wtrack-fill ${value >= 0 ? 'pos' : 'neg'} ${over(value) ? 'over' : ''}`} style={{ left: pct(Math.min(x0, xv)), width: pct(Math.abs(xv - x0)) }} /> : null}
      <i class="wtrack-zero" style={{ left: pct(x0) }} />
      {typeof market === 'number' && Number.isFinite(market) ? <i class="wtrack-mkt" style={{ left: pct(x(market)) }} /> : null}
      {typeof dot === 'number' && Number.isFinite(dot) ? <i class={`wtrack-dot ${over(dot) ? 'over' : ''}`} style={{ left: pct(x(dot)) }} /> : null}
    </span>
  );
}

export interface BarRowProps {
  name: string;
  /** 名稱下方一行（例：「2330・+360 張」） */
  sub?: ComponentChildren;
  bar: BarSpec;
  value: ComponentChildren;
  /** 數值下方一行（例：「新增」「佔均額 4.8%」） */
  valueSub?: ComponentChildren;
  /** 有 href 才是連結（海外持股不連到個股頁）；只有 onClick 時是按鈕（開面板） */
  href?: string;
  onClick?: () => void;
  /** 整列的朗讀文字 */
  label: string;
  testid?: string;
}

export function BarRow({ name, sub, bar, value, valueSub, href, onClick, label, testid }: BarRowProps) {
  const inner = (
    <>
      <span class="br-name" aria-hidden="true">
        <span class="br-label">{name}</span>
        {sub ? <span class="br-sub ui-foot ui-muted">{sub}</span> : null}
      </span>
      <span class="br-bar" aria-hidden="true">
        {bar.kind === 'diverging'
          ? <DivergingBar value={bar.value} max={bar.max} />
          : bar.kind === 'wind'
            ? <WindTrack value={bar.value} market={bar.market} x={bar.x} over={bar.over} dot={bar.dot} />
            : <ProgressBar value={bar.value} max={bar.max} color={bar.color ?? 'var(--d-2)'} />}
      </span>
      <span class="br-v" aria-hidden="true">
        <span class="br-value ui-num">{value}</span>
        {valueSub ? <span class="br-sub ui-foot ui-muted">{valueSub}</span> : null}
      </span>
    </>
  );
  if (href) return <a class="ui-row ui-tap br-row" href={href} onClick={onClick} data-testid={testid} aria-label={label}>{inner}</a>;
  // 沒有連結、只開面板（族群大戶流向的列）：按鈕
  if (onClick) return <button type="button" class="ui-row ui-tap br-row br-btn" onClick={onClick} data-testid={testid} aria-label={label}>{inner}</button>;
  return <div class="ui-row br-row br-static" data-testid={testid} aria-label={label}>{inner}</div>;
}
