/**
 * 流程（原「紀律」）的視覺元件：三環（流程頁直徑 120、簡報頁 24 小環）、近 20 個交易日逐日小點、簡報頁底部一列。
 * - 顏色只用流程三環專用色（--ring-1～3）；不適用的環畫細底環加「—」。
 * - 動效只有環填滿一次（--dur-ring 0.6 秒 ease-out）；prefers-reduced-motion 時關閉（flow.css）。
 * - 遊戲化關閉時：不畫環、不顯示連續，只留文字狀態。
 */
import { useEffect, useState } from 'preact/hooks';
import { Row } from './ui';
import { useFlow } from '../data/useFlow';
import type { DayDot, DayRings, Ring } from '../lib/ritual';
import { mdw } from './Brief';
import '../styles/flow.css';

const RING_INDEX: Record<Ring['id'], 1 | 2 | 3> = { brief: 1, entry: 2, review: 3 };

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

/** 流程頁三環：同心圓，外→內＝簡報、進場、檢討。SVG 高度 132（＝右側 3 列 × 44），環直徑 120 置中。 */
export function FlowRings({ rings, animate }: { rings: Ring[]; animate?: boolean }) {
  const S = 120, W = 12, GAP = 3, H = 132;
  return (
    <svg class={`flow-rings ${animate ? 'anim' : ''}`} viewBox={`0 ${-(H - S) / 2} ${S} ${H}`} aria-hidden="true">
      {rings.map((r, i) => {
        const rad = S / 2 - W / 2 - i * (W + GAP);
        const n = RING_INDEX[r.id];
        if (r.status === 'na') {
          return (
            <g key={r.id} class={`na ring-${n}`}>
              <circle class="track thin" cx={S / 2} cy={S / 2} r={rad} fill="none" />
              <rect class="na-gap" x={S / 2 - 8} y={S / 2 - rad - 4} width={16} height={8} />
              <line class="na-dash" x1={S / 2 - 5} x2={S / 2 + 5} y1={S / 2 - rad} y2={S / 2 - rad} />
            </g>
          );
        }
        return (
          <g key={r.id} class={`ring-${n}`}>
            <circle class="track" cx={S / 2} cy={S / 2} r={rad} fill="none" stroke-width={W} />
            {r.progress > 0 ? (
              <circle class="arc" cx={S / 2} cy={S / 2} r={rad} fill="none" stroke-width={W} stroke-linecap="round" pathLength={1}
                stroke-dasharray={`${r.progress} 1`} transform={`rotate(-90 ${S / 2} ${S / 2})`} />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** 簡報頁的三個 24px 小環（並排）。 */
export function MiniRings({ rings, animate }: { rings: Ring[]; animate?: boolean }) {
  return (
    <span class={`flow-mini ${animate ? 'anim' : ''}`} aria-hidden="true">
      {rings.map((r) => {
        const n = RING_INDEX[r.id];
        return (
          <svg key={r.id} viewBox="0 0 24 24" class={`ring-${n} ${r.status === 'na' ? 'na' : ''}`}>
            {r.status === 'na' ? (
              <>
                <circle class="track thin" cx={12} cy={12} r={10} fill="none" />
                <line class="na-dash" x1={8.5} x2={15.5} y1={12} y2={12} />
              </>
            ) : (
              <>
                <circle class="track" cx={12} cy={12} r={10} fill="none" stroke-width={4} />
                {r.progress > 0 ? <circle class="arc" cx={12} cy={12} r={10} fill="none" stroke-width={4} stroke-linecap="round" pathLength={1}
                  stroke-dasharray={`${r.progress} 1`} transform="rotate(-90 12 12)" /> : null}
              </>
            )}
          </svg>
        );
      })}
    </span>
  );
}

/** 環的圖例小點（右側三列的圖示）。 */
export function RingDot({ id }: { id: Ring['id'] }) {
  return <svg viewBox="0 0 24 24" class={`flow-dot-ico ring-${RING_INDEX[id]}`} aria-hidden="true"><circle cx={12} cy={12} r={5} /></svg>;
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

/** 三環的文字摘要（VoiceOver） */
export function ringsSummary(r: DayRings): string {
  return `流程 ${r.score}：${r.rings.map((x) => `${x.label}${x.text}`).join('、')}`;
}

/**
 * 簡報頁底部一列（§4-9）：「流程｜三個 24px 小環｜1/1・連續 12 日」，點入流程頁。
 * 放在簡報頁的 <List chev> 裡；遊戲化關閉時只顯示分數。
 */
export function FlowBriefRow() {
  const flow = useFlow();
  const animate = useRingAnimation(flow && flow.gamification ? `brief:${flow.day}:${flow.rings.score}` : null);
  if (!flow) return <Row label="流程" href="#/discipline" testid="flow-brief-row" />;
  const { rings, streak, gamification } = flow;
  const text = gamification ? `${rings.score}・連續 ${streak.current} 日` : rings.score;
  return (
    <Row label="流程" href="#/discipline" testid="flow-brief-row"
      ariaLabel={`${ringsSummary(rings)}${gamification ? `；連續 ${streak.current} 日` : ''}`}
      value={<span class="flow-brief-v">{gamification ? <MiniRings rings={rings.rings} animate={animate} /> : null}<span>{text}</span></span>} />
  );
}
