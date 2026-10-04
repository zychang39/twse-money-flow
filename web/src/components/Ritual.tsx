/**
 * 流程頁的視覺元件（M6 起流程頁改為每日步驟＋一個進度環，三環已移除）：近 20 個交易日逐日小點、進度環動畫只播一次的開關。
 * 動效在 prefers-reduced-motion 時關閉（flow.css）。
 */
import { useEffect, useState } from 'preact/hooks';
import type { DayDot } from '../lib/ritual';
import { mdw } from './Brief';
import '../styles/flow.css';

/** 同一天同一個分數只播放一次填滿動畫（換日或分數改變才再播）。 */
export function useRingAnimation(key: string | null): boolean {
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (!key) return;
    try {
      const k = 'tmf-flow-anim';
      if (localStorage.getItem(k) !== key) { localStorage.setItem(k, key); setAnimate(true); }
    } catch { /* 無法存取 localStorage：不播動畫 */ }
  }, [key]);
  return animate;
}

/** 近 20 個交易日逐日小點：完成實心、寬限空心、未完成淡、期限未到外框、開始使用前最淡；休市日不畫。 */
export function FlowDots({ days }: { days: DayDot[] }) {
  const n = days.length;
  const W = 20 * n, R = 5;
  const word: Record<DayDot['state'], string> = { done: '完成', grace: '寬限', missed: '未完成', open: '進行中', na: '不適用' };
  const summary = days.map((d) => `${mdw(d.day)} ${word[d.state]}`).join('、');
  return (
    <div class="flow-dots" role="img" aria-label={`近 ${n} 個交易日：${summary}`}>
      <svg viewBox={`0 0 ${W} 16`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {days.map((d, i) => (
          <circle key={d.day} class={`d-${d.state}`} cx={10 + i * 20} cy={8} r={d.state === 'grace' || d.state === 'open' ? R - 0.75 : R} />
        ))}
      </svg>
      {n ? (
        <div class="flow-dots-axis ui-foot ui-muted" aria-hidden="true"><span>{mdw(days[0].day)}</span><span>{mdw(days[n - 1].day)}</span></div>
      ) : null}
    </div>
  );
}
