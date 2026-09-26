import { CATEGORY_IDS, scoresConfig } from '../lib/config';
import type { StockRow } from '../data/types';

function cls(v: number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return v >= 65 ? 'hi' : v <= 35 ? 'lo' : '';
}

export function scoreText(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : String(Math.round(v));
}

/** 四項分數（籌碼／動能／基本面／估值）。 */
export function ScoreRow({ row }: { row: Partial<StockRow> }) {
  return (
    <div class="score-row">
      {CATEGORY_IDS.map((id) => {
        const v = row[id] as number | null | undefined;
        const label = scoresConfig.categories[id].label.replace('分', '');
        return (
          <div key={id} class={`score ${cls(v)}`}>
            <span class="sr-only">{`${label}分數 ${scoreText(v)}`}</span>
            <div class="val" aria-hidden="true">{scoreText(v)}</div>
            <div class="lbl" aria-hidden="true">{label}</div>
          </div>
        );
      })}
    </div>
  );
}

export function Composite({ value }: { value: number | null | undefined }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <span class="sr-only">{`綜合分 ${scoreText(value)}`}</span>
      <div class={`composite ${value !== null && value !== undefined && value >= 65 ? 'up' : value !== null && value !== undefined && value <= 35 ? 'down' : ''}`} aria-hidden="true">
        {scoreText(value)}
      </div>
      <div class="tiny muted" aria-hidden="true">綜合分</div>
    </div>
  );
}
