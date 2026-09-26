import { useMemo, useState } from 'preact/hooks';
import type { StockRow } from '../data/types';

/** 以代號或名稱搜尋（從全市場摘要）。 */
export function StockSearch({ rows, onPick, placeholder = '輸入代號或名稱' }: { rows: StockRow[]; onPick: (row: StockRow) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const s = q.trim().toUpperCase();
    if (!s) return [];
    return rows.filter((r) => r.code.startsWith(s) || r.name.toUpperCase().includes(s)).slice(0, 12);
  }, [q, rows]);
  return (
    <div>
      <input class="input" type="search" inputMode="search" aria-label="搜尋股票" placeholder={placeholder} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      {hits.length ? (
        <div class="list" role="listbox">
          {hits.map((r) => (
            <button key={r.code} class="list-item" role="option" onClick={() => { onPick(r); setQ(''); }}>
              <span class="num bold">{r.code}</span>
              <span class="grow">{r.name}</span>
              <span class="small muted">{r.industry ?? ''}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
