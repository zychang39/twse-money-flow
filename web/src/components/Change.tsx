import { arrow, changeLabel, direction, fmtNum, fmtPct, fmtPrice } from '../lib/format';

/** 漲跌：顏色（紅漲綠跌）＋ ▲▼ 符號＋ VoiceOver 文字。 */
export function Change({ change, pct, showPrice }: { change: number | null | undefined; pct?: number | null; showPrice?: number | null }) {
  const d = direction(change);
  return (
    <span class={`num ${d}`}>
      <span class="sr-only">{changeLabel(change, pct)}</span>
      {showPrice !== undefined ? <span class="bold t1">{fmtPrice(showPrice)} </span> : null}
      <span aria-hidden="true">
        {arrow(change)} {fmtNum(change === null || change === undefined ? null : Math.abs(change))}
        {pct !== undefined ? `（${pct === null || pct === undefined ? '—' : `${Math.abs(pct).toFixed(2)}%`}）` : ''}
      </span>
    </span>
  );
}

/** 漲跌膠囊（清單列右側）：▲▼＋百分比，底色為淡紅／淡綠。 */
export function ChangePill({ change, pct }: { change: number | null | undefined; pct: number | null | undefined }) {
  const d = direction(change ?? pct);
  return (
    <span class={`pill ${d}`}>
      <span class="sr-only">{changeLabel(change, pct)}</span>
      <span aria-hidden="true">{arrow(change ?? pct)} {pct === null || pct === undefined ? '—' : `${Math.abs(pct).toFixed(2)}%`}</span>
    </span>
  );
}

/** 一般帶正負號的數值（法人買賣超等），同樣以 ▲▼ 輔助。 */
export function Signed({ value, format, label }: { value: number | null | undefined; format: (v: number | null | undefined) => string; label?: string }) {
  const d = direction(value);
  const word = d === 'up' ? '增加' : d === 'down' ? '減少' : '持平';
  return (
    <span class={`num ${d}`}>
      <span class="sr-only">{`${label ?? ''}${word} ${format(value === null || value === undefined ? value : Math.abs(value))}`}</span>
      <span aria-hidden="true">{format(value)}</span>
    </span>
  );
}

export { fmtPct };
