import { CATEGORY_IDS, scoresConfig } from '../lib/config';
import { fmtNum } from '../lib/format';
import type { ScoreDetail } from '../data/types';
import { scoreText } from './Scores';

/** 分數明細：每個因子的原始值、子分數、權重與說明。 */
export function ScoreDetailView({ detail }: { detail: ScoreDetail }) {
  return (
    <>
      <h2 class="title-2">分數明細</h2>
      {CATEGORY_IDS.map((cid) => {
        const cat = scoresConfig.categories[cid];
        const got = detail.categories[cid];
        return (
          <div class="card" key={cid}>
            <div class="row between">
              <div class="headline">{cat.label}</div>
              <div class="bold num" aria-label={`${cat.label} ${scoreText(got?.score)}`}>{scoreText(got?.score)}</div>
            </div>
            <p class="small muted" style={{ margin: '0.25rem 0 0.5rem' }}>{cat.description}</p>
            {cat.factors.map((f) => {
              const v = got?.factors.find((x) => x.id === f.id);
              const s = v?.score ?? null;
              return (
                <div key={f.id} style={{ padding: '0.375rem 0', borderTop: '0.5px solid var(--separator)' }}>
                  <div class="row between">
                    <span class="small">{f.label} <span class="tiny muted">×{f.weight}</span></span>
                    <span class="small num">
                      {v?.raw !== null && v?.raw !== undefined ? `${fmtNum(v.raw, 2)} ${f.unit}` : <span class="muted">資料不足</span>}
                      <span class="bold" style={{ marginLeft: '0.5rem' }}>{scoreText(s)}</span>
                    </span>
                  </div>
                  <div class="bar" aria-hidden="true"><i style={{ width: `${s ?? 0}%` }} /></div>
                  {v?.detail ? <div class="tiny muted">{v.detail}</div> : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
