/**
 * 信用與空方（v3 M2-2）：拆成「散戶信用（融資）」與「空方（融券與借券）」兩張卡；外資持股移到法人區塊。
 * 每個數字都標明比較基準（與 N 個交易日前（日期）相比）。定義見 METHODOLOGY §4.7.5。
 */
import { type CreditSummary, type Delta, basisText, deltaMissingReason, foreignHoldLine, lotsDelta, marginUsageText } from '../lib/credit';
import '../styles/tools.css'; // .cr-*（#4／#5：原本只有工具頁載入這份 CSS，個股頁直接開啟時樣式不存在）
import { uiConfig } from '../lib/config';
import { missing, numberFormat } from '../lib/format';

const INT = numberFormat(0);
const F1 = numberFormat(1);
const F2 = numberFormat(2);

/** 變化值：「▲1,234 張（+3.2%）」；缺值一律「—（原因）」。 */
const deltaText = (d: Delta, name: string): string => (d.abs === null ? missing(deltaMissingReason(d, name)) : lotsDelta(d));
/** 餘額：「1,234 張」；缺值「—（沒有融資資料）」。 */
const balText = (v: number | null, name: string): string => (v === null ? missing(`沒有${name}資料`) : `${INT.format(v)} 張`);

function Row({ k, v, sub, testid }: { k: string; v: string; sub?: string; testid?: string }) {
  return (
    <div class="cr-row" data-testid={testid}>
      <dt>{k}{sub ? <span class="cr-basis">{sub}</span> : null}</dt>
      <dd class="num">{v}</dd>
    </div>
  );
}

export function MarginCard({ s }: { s: CreditSummary }) {
  const m = s.margin;
  const usage = marginUsageText(m.usage);
  const pv = s.pv;
  return (
    <section class="cr-card" aria-labelledby="cr-margin">
      <h3 class="cr-title" id="cr-margin">散戶信用（融資）</h3>
      {pv.label ? (
        <div class="cr-pv" data-testid="pv-label">
          <span class="tag cr-pv-tag">{pv.label.label}・{pv.label.tag}</span>
          <p class="caption t1">{pv.label.note}</p>
          <p class="caption muted">股價（還原）{pv.price.pct === null ? missing(deltaMissingReason(pv.price, '股價')) : `${pv.price.pct >= 0 ? '+' : '−'}${F2.format(Math.abs(pv.price.pct))}%`}、融資 {deltaText(pv.margin, '融資')}；{basisText(pv.price)}。</p>
        </div>
      ) : (
        <p class="caption muted cr-pv" data-testid="pv-label">價量解讀：不套用標籤——{pv.reason ?? `股價或融資 ${uiConfig.credit.pv_days} 日持平或資料不足`}（股價為還原價，{basisText(pv.price)}）。</p>
      )}
      <dl class="cr-dl">
        <Row k="融資餘額" v={balText(m.d5.now, '融資')} />
        <Row k="5 日變化" sub={basisText(m.d5)} v={deltaText(m.d5, '融資')} testid="margin-d5" />
        <Row k="20 日變化" sub={basisText(m.d20)} v={deltaText(m.d20, '融資')} />
        <Row k="融資使用率" sub={usage.reason ?? '融資餘額 ÷ 融資限額'} v={usage.reason ? '—' : usage.text} testid="margin-usage" />
      </dl>
    </section>
  );
}

export function ShortCard({ s }: { s: CreditSummary }) {
  const x = s.short;
  const cfg = uiConfig.credit;
  return (
    <section class="cr-card" aria-labelledby="cr-short">
      <h3 class="cr-title" id="cr-short">空方（融券與借券）</h3>
      <dl class="cr-dl">
        <Row k="融券餘額" sub={`${basisText(x.bal)}：${deltaText(x.bal, '融券')}`} v={balText(x.bal.now, '融券')} />
        <Row k="借券賣出餘額" sub={x.sbl.now === null ? '非借券標的或沒有資料' : `${basisText(x.sbl)}：${deltaText(x.sbl, '借券')}`} v={x.sbl.now === null ? missing('非借券標的或沒有資料') : `${INT.format(x.sbl.now)} 張`} />
        <Row k="券資比" sub="融券餘額 ÷ 融資餘額（最新一日）" v={x.ratio === null ? missing(x.bal.now === null ? '沒有融券資料' : '融資餘額為 0 或沒有資料') : `${F1.format(x.ratio)}%`} testid="short-ratio" />
        <Row k="融券最後回補日" sub={x.lastCover ? '股東會或除權息前，融券須在此日前買回' : '近期沒有停止融券或強制回補'} v={x.lastCover ?? missing('近期沒有')} />
      </dl>
      {x.high ? (
        <p class="caption cr-risk" role="note" data-testid="squeeze-note">
          券資比 ≥ {cfg.short_ratio_high}% 偏高：融券終究要買回，若股價上漲或接近最後回補日，回補買盤可能推升股價（軋空風險）；比例越高，回補壓力越集中。
        </p>
      ) : null}
    </section>
  );
}

/** 外資持股比與 20 日變化（法人區塊）：標籤左、數值右，變化值與數值同一行並留間距（#5）。 */
export function ForeignHolding({ s }: { s: CreditSummary }) {
  const f = s.foreign.chg;
  const line = foreignHoldLine(f);
  if (!line) return null;
  return (
    <dl class="cr-dl cr-foreign" data-testid="foreign-hold">
      <div class="cr-row">
        <dt>外資持股比<span class="cr-basis">{f.thenDate && line.dir === 'na' ? `與 ${f.days} 個交易日前相比（${Number(f.thenDate.slice(5, 7))}/${Number(f.thenDate.slice(8, 10))} 無資料）` : basisText(f)}</span></dt>
        <dd class="num cr-inline">
          <span>{line.value}</span>
          <span class={`cr-chg ${line.dir === 'na' ? 'muted' : line.dir}`} data-testid="foreign-hold-change">{line.change}</span>
        </dd>
      </div>
    </dl>
  );
}
