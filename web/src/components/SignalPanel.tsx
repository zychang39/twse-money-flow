/**
 * 個股頁「有效訊號面板」（M3）：只列策略庫分級為「有效」或「觀察中」（上架）的策略對應的指標（依 t 排序；沒有策略庫資料時退回判定為有效／環境依賴），
 * 顯示這一檔目前的狀態（觸發／接近觸發／未觸發）與該指標歷史超額報酬；點開看依據。
 * 2026-10-02 健檢：每列用策略庫的名字（lib/names.displayName：主標＝策略名、副標＝指標名），並同時標出兩套狀態詞彙
 * 「指標判定」與「策略分級」；區塊標題的一句結論由 lib/signalSummary 與 pages/Stock.tsx 共用，範圍說明放在清單下方。
 * 不使用買賣字眼：狀態只描述條件是否成立。
 */
import { useState } from 'preact/hooks';
import { STATE_TEXT, pctSigned, tText, verdictNote } from '../lib/evidence';
import { SIGNAL_SCOPE_NOTE, useSignalPanel } from '../lib/signalSummary';
import { gradeTone } from '../lib/strategies';
import { GRADE_NAME, VERDICT_NAME } from '../lib/status';
import { displayName } from '../lib/names';
import { fmtCount, md } from '../lib/format';
import { IconChevron } from './Icons';
import '../styles/evidence.css';

export function SignalPanel({ code }: { code: string }) {
  const d = useSignalPanel(code);
  const [open, setOpen] = useState<string | null>(null);
  if (d.loading) return <div class="skeleton sp-skel" aria-hidden="true" />;
  if (d.error || !d.data) return <p class="caption muted">指標效度資料暫時無法取得。</p>;
  const { items, horizon: h, grades } = d.data;
  return (
    <div class="sp" data-testid="signal-panel">
      <div class="list ev-list">
        {items.map((it) => {
          const isOpen = open === it.row.id;
          const name = displayName(it.row.id, it.row.label);
          const g = grades?.get(it.row.id);
          const tone = g ? gradeTone(g.grade) : 'plain';
          return (
            <div key={it.row.id} class={`ev-item${isOpen ? ' open' : ''}`}>
              <button class="ev-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : it.row.id)}>
                <span class="ev-main">
                  <span class="ev-label">{name.label}</span>
                  {name.sub ? <span class="ev-sub">{name.sub}</span> : null}
                  <span class="ev-sub">歷史 {h} 日超額 {pctSigned(it.excess)}・t {tText(it.row.t)}</span>
                  <span class="row wrap" style={{ gap: 'var(--s-1)', marginTop: 'var(--s-1)' }}>
                    <span class="tag ev-verdict" data-testid="verdict-tag">{VERDICT_NAME} {it.row.verdict}</span>
                    {g ? <span class={`tag ev-verdict${tone === 'strong' ? ' strong' : tone === 'muted' ? ' muted' : ''}`} data-testid="grade-tag">{GRADE_NAME} {g.label}</span> : null}
                  </span>
                </span>
                <span class="ev-tags">
                  <span class={`sp-state ${it.state}`}>{STATE_TEXT[it.state]}{it.date ? <span class="sp-date"> {md(it.date)}</span> : null}</span>
                </span>
              </button>
              {isOpen ? (
                <div class="ev-detail">
                  <p class="caption">{it.row.definition}</p>
                  <p class="caption"><b>{VERDICT_NAME}「{it.row.verdict}」</b>：{verdictNote(it.row)}</p>
                  {g ? <p class="caption"><b>{GRADE_NAME}「{g.label}」</b>：依校正後 t、扣成本超額、每月觸發數與樣本年數分級（門檻見策略庫）。</p> : null}
                  <p class="caption muted">
                    {it.state === 'triggered' ? `這一檔在 ${md(it.date)} 觸發（近 ${h} 個交易日內）。` : it.state === 'near' ? '這一檔目前接近觸發條件。' : '這一檔目前沒有觸發。'}
                    樣本 {fmtCount(it.row.n)} 筆、訊號期間 {it.row.signal_start ?? '—（沒有起始日）'} 起。
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
      <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>
        {grades ? SIGNAL_SCOPE_NOTE : '只列指標判定為有效或環境依賴的指標（沒有策略庫資料）'}・超額＝歷史 {h} 日、相對同日全市場（扣成本）・{VERDICT_NAME}看單一指標，{GRADE_NAME}看整套策略。
      </p>
    </div>
  );
}
