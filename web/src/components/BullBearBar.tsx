import type { Tally } from '../lib/bullbear';

/** 多方／中性／空方的項數比例條（紅＝多方 ▲、綠＝空方 ▼；文字另外寫出項數，不只靠顏色）。 */
export function BullBearBar({ t }: { t: Tally }) {
  const total = t.bull + t.bear + t.neutral || 1;
  return (
    <div class="bb-meter">
      <div class="bb-bar" role="img" aria-label={`多方 ${t.bull} 項、中性 ${t.neutral} 項、空方 ${t.bear} 項`}>
        {t.bull ? <span class="bb-seg bull" style={{ flexGrow: t.bull / total }} /> : null}
        {t.neutral ? <span class="bb-seg neutral" style={{ flexGrow: t.neutral / total }} /> : null}
        {t.bear ? <span class="bb-seg bear" style={{ flexGrow: t.bear / total }} /> : null}
      </div>
      <div class="bb-legend" aria-hidden="true">
        <span class="up">▲ 多方 {t.bull}</span>
        <span class="muted">中性 {t.neutral}</span>
        <span class="down">▼ 空方 {t.bear}</span>
      </div>
    </div>
  );
}
