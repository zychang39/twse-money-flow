/**
 * 個股頁 › 動能 ›「報酬來源」摘要卡（2026-10-27）：近 1 年報酬拆成市場 Beta、因子與產業、Alpha 三層；
 * 點開到 #/stock/{code}/m/attribution（完整拆解，同探索 › 報酬拆解）。定義見 METHODOLOGY §4.12。
 */
import { loadAttrFactors, loadAttrStock } from '../../data/api';
import { useAsync } from '../../hooks';
import { decompose, exposureText, periodRange } from '../../lib/attribution';
import { fmtNum } from '../../lib/format';
import { DivergingBar, SummaryCard } from '../kit';
import { Signed } from '../ui';

const fmt = (v: number) => `${v >= 0 ? '+' : '−'}${fmtNum(Math.abs(v * 100), 1)}%`;

export function AttrCard({ code, href }: { code: string; href: string }) {
  const f = useAsync(loadAttrFactors, []);
  const s = useAsync(() => loadAttrStock(code), [code]);
  const loading = f.loading || s.loading;
  const idx = f.data ? periodRange(f.data, 12) : [];
  const d = f.data && s.data ? decompose(f.data, s.data, idx) : null;
  if (!d) {
    return (
      <SummaryCard title="報酬來源" href={href} testid="mom-attr" vt="mom-attr"
        conclusion={loading ? '讀取中' : '無法拆解'}
        interp={loading ? null : f.error || s.error ? '資料暫時無法取得' : '只算普通股；上市未滿 24 個月或成交太少時無法估計'} />
    );
  }
  const layers = [
    { k: '市場 Beta', v: d.rf + d.market },
    { k: '因子與產業', v: d.total - d.rf - d.market - d.alpha },
    { k: 'Alpha', v: d.alpha },
  ];
  const max = Math.max(0.01, ...layers.map((x) => Math.abs(x.v)));
  const range = f.data && idx.length ? `${f.data.months[idx[0]]}～${f.data.months[idx[idx.length - 1]]}` : '';
  return (
    <SummaryCard title="報酬來源" href={href} testid="mom-attr" vt="mom-attr"
      conclusion={<>Alpha {fmt(d.alpha)}<span class="key-unit">（近 1 年）</span></>}
      interp={<>β {fmtNum(d.beta, 2)} {exposureText('mkt', d.beta, null)}・{range} 各月報酬加總 {fmt(d.total)}</>}>
      <span class="attr-mini" role="table" aria-label="近 1 年報酬的三層拆解">
        {layers.map((x) => (
          <span key={x.k} class="attr-mini-row" role="row">
            <span role="cell" class="ret-k">{x.k}</span>
            <span role="cell" class="ret-v"><Signed v={x.v * 100} digits={1} unit="%" /></span>
            <span role="cell" class="attr-mini-bar"><DivergingBar value={x.v} max={max} label={`${x.k} ${fmt(x.v)}`} /></span>
          </span>
        ))}
      </span>
    </SummaryCard>
  );
}
