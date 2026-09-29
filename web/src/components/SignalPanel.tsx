/**
 * 個股頁「有效訊號面板」（M3）：只列指標效度評估判定為「有效」或「環境依賴」的指標（依 t 排序），
 * 顯示這一檔目前的狀態（觸發／接近觸發／未觸發）與該指標歷史 10 日超額報酬；點開看依據。
 * 不使用買賣字眼：狀態只描述條件是否成立。
 */
import { useState } from 'preact/hooks';
import { useAsync } from '../hooks';
import { loadJson } from '../data/api';
import {
  type EvidenceFile, type EvidenceToday, STATE_TEXT, panelItems, panelSummary, pctSigned, tText, verdictNote,
} from '../lib/evidence';
import { IconChevron } from './Icons';
import '../styles/evidence.css';

const loadEvidence = () => Promise.all([
  loadJson<EvidenceFile>('evidence.json'),
  loadJson<EvidenceToday>('evidence_today.json').catch(() => null),
]);

function md(d: string): string {
  return `${d.slice(5, 7)}/${d.slice(8, 10)}`;
}

export function SignalPanel({ code }: { code: string }) {
  const d = useAsync(loadEvidence, []);
  const [open, setOpen] = useState<string | null>(null);
  if (d.loading) return <div class="skeleton sp-skel" aria-hidden="true" />;
  if (d.error || !d.data) return <p class="caption muted">指標效度資料暫時無法取得。</p>;
  const [ev, today] = d.data;
  const h = ev.meta.config?.primary_horizon ?? 10;
  const items = panelItems(ev.rows, today, code, h);
  return (
    <div class="sp" data-testid="signal-panel">
      <p class="caption muted">{panelSummary(items)}・超額＝歷史 {h} 日、相對同日全市場（扣成本）</p>
      <div class="list ev-list">
        {items.map((it) => {
          const isOpen = open === it.row.id;
          return (
            <div key={it.row.id} class={`ev-item${isOpen ? ' open' : ''}`}>
              <button class="ev-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : it.row.id)}>
                <span class="ev-main">
                  <span class="ev-label">{it.row.label}</span>
                  <span class="ev-sub">歷史 {h} 日超額 {pctSigned(it.excess)}・t {tText(it.row.t)}{it.row.verdict === '環境依賴' ? '・環境依賴' : ''}</span>
                </span>
                <span class={`sp-state ${it.state}`}>{STATE_TEXT[it.state]}{it.date ? <span class="sp-date"> {md(it.date)}</span> : null}</span>
              </button>
              {isOpen ? (
                <div class="ev-detail">
                  <p class="caption">{it.row.definition}</p>
                  <p class="caption"><b>{it.row.verdict}</b>：{verdictNote(it.row)}</p>
                  <p class="caption muted">
                    {it.state === 'triggered' ? `這一檔在 ${md(it.date!)} 觸發（近 ${h} 個交易日內）。` : it.state === 'near' ? '這一檔目前接近觸發條件。' : '這一檔目前沒有觸發。'}
                    樣本 {it.row.n?.toLocaleString('zh-TW') ?? '—'} 筆、訊號期間 {it.row.signal_start ?? '—'} 起。
                  </p>
                  <a class="list-item brand" href="#/explore/evidence">
                    <span class="grow">指標效度表<span class="caption muted tool-sub">逐年、樣本外、大盤環境與參數表</span></span>
                    <span class="chev"><IconChevron /></span>
                  </a>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
