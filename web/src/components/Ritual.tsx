/** 今晚的紀律（三環）。關閉遊戲化時改為純文字待辦，不顯示環、等級與連續天數。 */
import type { RingState } from '../lib/ritual';
import { Rings3 } from './Viz';
import { IconCheck, IconChevron } from './Icons';

export function RitualPanel({ rings, complete, animate, gamification, streak, level }: {
  rings: RingState[];
  complete: boolean;
  animate?: boolean;
  gamification: boolean;
  streak?: { current: number; best: number };
  level?: { level: number; progress: number };
}) {
  const action = rings.find((r) => !r.done && r.action)?.action;
  const summary = `今晚的紀律：${rings.map((r) => `${r.label}${r.done ? '已完成' : `未完成（${r.status}）`}`).join('、')}`;
  if (!gamification) {
    return (
      <div class="list" aria-label={summary}>
        {rings.map((r) => (
          <div key={r.id} class="list-item">
            <span class={r.done ? 't1' : 'muted'} aria-hidden="true" style={{ width: '1.25rem', display: 'inline-flex' }}>{r.done ? <IconCheck /> : '○'}</span>
            <span class="grow body">{r.label}</span>
            <span class="caption muted">{r.status}</span>
          </div>
        ))}
        {action ? <a class="list-item brand" href={action.href}>{action.label}<span class="chev"><IconChevron /></span></a> : null}
      </div>
    );
  }
  return (
    <div>
      <div class="discipline" role="group" aria-label={summary}>
        <Rings3 progress={rings.map((r) => r.progress)} complete={complete} animate={animate} />
        <div class="legend">
          {rings.map((r, i) => (
            <div key={r.id}>
              <i style={{ opacity: [1, 0.72, 0.46][i] }} />
              <span class="caption t1">{r.label}</span>
              <span class="caption muted">{r.status}</span>
            </div>
          ))}
          {action ? <a class="caption w5" href={action.href} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 'var(--tap)' }}>{action.label}<span style={{ width: '0.875rem', display: 'inline-flex' }}><IconChevron /></span></a> : null}
        </div>
      </div>
      {streak || level ? (
        <p class="caption muted" style={{ marginTop: 'var(--s-4)' }}>
          {streak ? `連續 ${streak.current} 天完成儀式（最佳 ${streak.best} 天）・休市日不中斷` : ''}
          {level ? `・紀律等級\u00a0${level.level}` : ''}
        </p>
      ) : null}
    </div>
  );
}
