/** 市場相關的共用區塊：資金指標清單、三大法人金額列、AI 摘要。 */
import { useState } from 'preact/hooks';
import type { AiSummary, MarketData, MarketLight } from '../data/types';
import { LIGHT_LABEL, envInfo } from '../lib/envState';
import { arrow, fmtNum } from '../lib/format';
import { IconChevronDown } from './Icons';

export function LightsList({ lights }: { lights: MarketLight[] }) {
  return (
    <div class="list">
      {lights.map((l) => (
        <div key={l.id} class="list-item" style={{ alignItems: 'flex-start' }}>
          <span class={`light-dot ${l.state}`} aria-hidden="true" />
          <div class="grow">
            <div class="row between"><span class="body">{l.label}</span><span class={`caption w6 ${l.state === 'red' ? 'risk' : 'muted'}`}>{LIGHT_LABEL[l.state]}</span></div>
            <div class="caption t1">{l.value}</div>
            <div class="caption muted">{l.basis}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EnvDetail({ market }: { market: MarketData }) {
  const env = envInfo(market.env?.lights);
  const known = env.red.length + env.green.length + env.yellow.length;
  return (
    <>
      <p class="body">資金環境：<b class={env.state === 'conservative' ? 'risk' : ''}>{env.label}</b></p>
      <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>
        {market.env?.lights.length ?? 0} 項指標中 {known} 項有資料。有任一項風險即為「保守」；沒有風險且 ≥ 3 項有利為「積極」；其餘為「中性」（門檻見 config/ui.yml）。
      </p>
      {market.env ? <LightsList lights={market.env.lights} /> : <p class="caption muted">資料源待處理。</p>}
      {market.temperature ? (
        <>
          <h3 class="eyebrow" style={{ marginTop: 'var(--s-6)' }}>市場溫度（反向參考）</h3>
          <LightsList lights={market.temperature.lights} />
        </>
      ) : null}
    </>
  );
}

export function FlowsRow({ flow }: { flow: MarketData['flows'][number] | undefined }) {
  if (!flow) return null;
  const items: [string, number | null][] = [['外資', flow.foreign], ['投信', flow.trust], ['自營商', flow.dealer]];
  return (
    <div class="grid three" style={{ marginTop: 'var(--s-5)' }} role="group" aria-label={`三大法人買賣超（${flow.date}）`}>
      {items.map(([k, v]) => {
        const d = v === null ? 'flat' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
        return (
          <div key={k}>
            <div class="caption muted">{k}</div>
            <div class={`body w6 ${d}`}>
              <span aria-hidden="true">{arrow(v)} {fmtNum(v === null ? null : Math.abs(v), 1)} 億</span>
              <span class="sr-only">{`${k}${d === 'up' ? '買超' : d === 'down' ? '賣超' : ''} ${fmtNum(v === null ? null : Math.abs(v), 1)} 億元`}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AiCard({ ai }: { ai: AiSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="card">
      <button class="collapsed-row" aria-expanded={open} onClick={() => setOpen(!open)} style={{ padding: 0, minHeight: 'auto' }}>
        <span class="body t1">盤後摘要 <span class="tag">AI 生成</span></span>
        <IconChevronDown />
      </button>
      {open ? (
        <>
          <ul style={{ margin: 'var(--s-3) 0 0', paddingLeft: 'var(--s-5)' }}>
            {ai.lines.map((l) => <li key={l} class="caption t1" style={{ marginTop: 'var(--s-1)' }}>{l}</li>)}
          </ul>
          <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>由 AI 依當日衍生數據自動摘要，可能有誤；分數與依據以各頁明細為準。</p>
        </>
      ) : null}
    </div>
  );
}
