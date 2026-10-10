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
  | { kind: 'progress'; value: number | null | undefined; max: number; color?: string };

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
