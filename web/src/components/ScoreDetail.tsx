import { CATEGORY_IDS, scoresConfig, type CategoryId } from '../lib/config';
import { fmtNum } from '../lib/format';
import type { ScoreDetail } from '../data/types';
import { categoryName, completeness, scoreText } from './Scores';

/** 分數明細：每個因子的原始值、子分數、權重與說明；缺資料的因子標示「資料不足」且不計入。 */
export function ScoreDetailView({ detail, only }: { detail: ScoreDetail; only?: CategoryId }) {
  const ids = only ? [only] : CATEGORY_IDS;
  return (
    <>
      {ids.map((cid) => {
        const cat = scoresConfig.categories[cid];
        const got = detail.categories[cid];
        const c = completeness(detail, cid);
        return (
          <div class="card" key={cid}>
            <div class="row between">
              <div class="body w6">{categoryName(cid)}</div>
              <div class="body w6"><span class="sr-only">{`${cat.label} `}</span>{scoreText(got?.score)}</div>
            </div>
            <p class="caption muted" style={{ margin: 'var(--s-1) 0 var(--s-3)' }}>{cat.description}・資料完整度 {c === null ? '—' : `${Math.round(c * 100)}%`}</p>
            {cat.factors.map((f) => {
              const v = got?.factors.find((x) => x.id === f.id);
              const s = v?.score ?? null;
              return (
                <div key={f.id} style={{ padding: 'var(--s-2) 0' }}>
                  <div class="row between caption">
                    <span>{f.label} <span class="muted">×{f.weight}</span></span>
                    <span>
                      {v?.raw !== null && v?.raw !== undefined ? `${fmtNum(v.raw, 2)} ${f.unit}` : <span class="muted">資料不足（不計入）</span>}
                      <span class="w6" style={{ marginLeft: 'var(--s-2)' }}>{scoreText(s)}</span>
                    </span>
                  </div>
                  <div class="bar" aria-hidden="true" style={{ marginTop: 'var(--s-1)' }}><i style={{ width: `${s ?? 0}%` }} /></div>
                  {v?.detail ? <div class="caption muted">{v.detail}</div> : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
