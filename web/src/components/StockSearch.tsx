import { useMemo, useState } from 'preact/hooks';
import type { StockRow } from '../data/types';
import { ChangePill } from './Change';
import { fmtPrice } from '../lib/format';

/** 以代號或名稱搜尋（從全市場摘要）。 */
export function StockSearch({ rows, onPick, placeholder = '輸入代號或名稱', autoFocus }: { rows: StockRow[]; onPick: (row: StockRow) => void; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const s = q.trim().toUpperCase();
    if (!s) return [];
    return rows.filter((r) => r.code.startsWith(s) || r.name.toUpperCase().includes(s)).slice(0, 12);
  }, [q, rows]);
  return (
    <div>
      <input class="input" type="search" inputMode="search" aria-label="搜尋股票" placeholder={placeholder} value={q}
        {...(autoFocus ? { 'data-autofocus': true } : {})}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      {hits.length ? (
        <div class="list" role="listbox" aria-label="搜尋結果">
          {hits.map((r) => (
            <button key={r.code} class="list-item" role="option" aria-selected="false" onClick={() => { onPick(r); setQ(''); }}>
              <span class="grow">
                <span class="body">{r.name}</span>
                <span class="caption muted" style={{ display: 'block' }}>{r.code}・{r.industry ?? '—'}</span>
              </span>
              <span class="right">
                <span class="body" style={{ display: 'block' }}>{fmtPrice(r.close)}</span>
                <ChangePill change={r.change} pct={r.change_pct} />
              </span>
            </button>
          ))}
        </div>
      ) : q.trim() ? <p class="caption muted" style={{ marginTop: 'var(--s-3)' }}>找不到「{q.trim()}」。可輸入 4–6 碼代號或公司簡稱。</p> : null}
    </div>
  );
}
