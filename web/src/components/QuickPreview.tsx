/** 長按清單列叫出的快速預覽：價格、近 1 個月走勢、四環分數、健檢一句話、動作。 */
import type { ComponentChildren } from 'preact';
import { Sheet } from './Sheet';
import { ChangePill } from './Change';
import { ScoreRings } from './Scores';
import { Sparkline } from './Viz';
import { useAsync } from '../hooks';
import { loadStock } from '../data/api';
import type { StockRow } from '../data/types';
import { adjClose } from '../lib/history';
import { direction, fmtPrice } from '../lib/format';

export function healthLine(summaryText: unknown): string | null {
  const s = Array.isArray(summaryText) ? (summaryText as string[]).filter(Boolean) : [];
  if (!s.length) return null;
  return s.join('；') + (s.join('').endsWith('。') ? '' : '。');
}

export function QuickPreview({ code, row, onClose, onOpen, actions }: { code: string | null; row: StockRow | undefined; onClose: () => void; onOpen: () => void; actions?: ComponentChildren }) {
  const hist = useAsync(() => (code ? loadStock(code).catch(() => null) : Promise.resolve(null)), [code]);
  const h = hist.data;
  return (
    <Sheet open={!!code} onClose={onClose} title={row ? `${row.name} ${row.code}` : code ?? ''}>
      {row ? (
        <>
          <div class="row between">
            <span class="title">{fmtPrice(row.close)}</span>
            <ChangePill change={row.change} pct={row.change_pct} />
          </div>
          <div style={{ margin: 'var(--s-3) 0' }}>
            <Sparkline values={h ? adjClose(h).slice(-22) : null} dir={direction(row.change)} w={320} h={72} />
            <div class="caption muted">近 1 個月（還原價）；虛線＝昨收</div>
          </div>
          {h?.summary_text ? <p class="body" style={{ margin: 'var(--s-3) 0' }}>{healthLine(h.summary_text)}</p> : null}
          <ScoreRings row={row} detail={h?.scores} />
          <div class="grid two" style={{ marginTop: 'var(--s-5)' }}>
            <button class="btn primary" onClick={onOpen}>開啟個股頁</button>
            {actions}
          </div>
        </>
      ) : <p class="caption muted">這檔股票目前沒有資料（可能已下市或代號錯誤）。</p>}
    </Sheet>
  );
}
