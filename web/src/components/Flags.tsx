import type { Flag } from '../data/types';

export function Flags({ flags, compact }: { flags: Flag[] | undefined | null; compact?: boolean }) {
  if (!flags || !flags.length) return null;
  return (
    <div class="row wrap" style={{ gap: '0.375rem', marginTop: compact ? '0.25rem' : '0.5rem' }} role="group" aria-label={`風險旗標：${flags.map((f) => f.label).join('、')}`}>
      {flags.map((f) => (
        <span key={f.id} class={`flag ${f.level === 'danger' ? 'danger' : ''}`} title={f.detail}>
          ⚠︎ {f.label}
        </span>
      ))}
    </div>
  );
}
