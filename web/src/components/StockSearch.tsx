import { useMemo, useState } from 'preact/hooks';
import type { StockRow } from '../data/types';
import { ChangePill } from './Change';
import { fmtPrice } from '../lib/format';
import { searchStocks } from '../lib/search';

/** 文字裡像代號的字串有幾個（4–6 碼，可帶一個英文字母） */
const codeCount = (text: string): number => (text.match(/(?<![\d.,])\d{4,6}[A-Za-z]?(?![\d.,]\d)/g) ?? []).length;
/** 是不是「一次好幾檔」：有換行，或有兩個以上的代號 */
export const isMultiStockText = (text: string): boolean => (/\n/.test(text.trim()) && text.trim().length > 6) || codeCount(text) >= 2;

/**
 * 以代號或名稱搜尋（從全市場摘要；排序規則與搜尋頁相同，見 lib/search）。
 * onMulti（2026-11-19）：同一個輸入框也收「一次好幾檔」——貼上多行文字或代號清單、或打了兩個以上的代號時交給呼叫端（列出來勾選），不用另一個大文字框。
 */
export function StockSearch({ rows, onPick, placeholder = '輸入代號或名稱', autoFocus, onMulti }: { rows: StockRow[]; onPick: (row: StockRow) => void; placeholder?: string; autoFocus?: boolean; onMulti?: (text: string) => void }) {
  const [q, setQ] = useState('');
  const multi = !!onMulti && codeCount(q) >= 2;
  const hits = useMemo(() => (multi ? [] : searchStocks(rows, q, 12)), [q, rows, multi]);
  const sendMulti = (text: string) => { onMulti?.(text); setQ(''); };
  return (
    <div>
      <input class="input" type="search" inputMode="search" aria-label="搜尋股票" placeholder={placeholder} value={q}
        {...(autoFocus ? { 'data-autofocus': true } : {})}
        onPaste={(e) => {
          const text = e.clipboardData?.getData('text') ?? '';
          if (onMulti && isMultiStockText(text)) { e.preventDefault(); sendMulti(text); }
        }}
        onKeyDown={(e) => { if (e.key === 'Enter' && multi) { e.preventDefault(); sendMulti(q); } }}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      {multi ? (
        <button type="button" class="btn block" style={{ marginTop: 'var(--s-2)' }} onClick={() => sendMulti(q)} data-testid="search-multi">列出這 {codeCount(q)} 檔</button>
      ) : hits.length ? (
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
