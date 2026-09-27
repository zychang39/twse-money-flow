import { CATEGORY_IDS, scoresConfig, type CategoryId } from '../lib/config';
import type { ScoreDetail, StockRow } from '../data/types';
import { ScoreRing } from './Viz';

export function scoreText(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : String(Math.round(v));
}

/** 類別名稱（籌碼、動能、基本面、估值）。 */
export function categoryName(id: CategoryId): string {
  return scoresConfig.categories[id].label.replace(/分$/, '');
}

/** 資料完整度：有資料的因子數 ÷ 設定中的因子數。 */
export function completeness(detail: ScoreDetail | undefined, id: CategoryId): number | null {
  const got = detail?.categories[id];
  if (!got) return null;
  const total = scoresConfig.categories[id].factors.length;
  const have = got.factors.filter((f) => f.score !== null && f.score !== undefined).length;
  return total ? have / total : null;
}

export function compositeCompleteness(detail: ScoreDetail | undefined): number | null {
  if (!detail) return null;
  let have = 0, total = 0;
  for (const id of CATEGORY_IDS) {
    total += scoresConfig.categories[id].factors.length;
    have += detail.categories[id]?.factors.filter((f) => f.score !== null && f.score !== undefined).length ?? 0;
  }
  return total ? have / total : null;
}

/** 四環分數（籌碼／動能／基本面／估值），每環下方標示資料完整度。點選開啟該類別明細。 */
export function ScoreRings({ row, detail, onPick }: { row?: Partial<StockRow>; detail?: ScoreDetail; onPick?: (id: CategoryId) => void }) {
  return (
    <div class="rings4">
      {CATEGORY_IDS.map((id) => {
        const v = (row?.[id] as number | null | undefined) ?? detail?.categories[id]?.score ?? null;
        const c = completeness(detail, id);
        const name = categoryName(id);
        const inner = (
          <>
            <ScoreRing value={v} size={64} stroke={4} label={name} />
            <span class="caption t1" style={{ display: 'block', marginTop: 'var(--s-2)' }}>{name}</span>
            <span class="caption muted" style={{ display: 'block' }}>{c === null ? '資料 —' : `資料 ${Math.round(c * 100)}%`}</span>
          </>
        );
        const label = `${name}分數 ${scoreText(v)}，資料完整度 ${c === null ? '未知' : `${Math.round(c * 100)}%`}`;
        return onPick ? (
          <button key={id} class="ring-btn" onClick={() => onPick(id)} aria-description={`${label}，查看明細`}>{inner}</button>
        ) : <div key={id} aria-label={label} role="group">{inner}</div>;
      })}
    </div>
  );
}
