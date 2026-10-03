/**
 * 個股頁「總覽」分段（M3）：四環（籌碼／動能／基本面／估值，點一下跳到對應分段）＋綜合分、
 * 六個重點指標（每格一行解讀；超過提醒門檻時解讀行轉橘，精簡模式改為數值旁的橘點）、策略訊號。
 */
import { useMemo } from 'preact/hooks';
import type { StockHistory, StockRow } from '../../data/types';
import type { ChipBlock } from '../../lib/chips';
import { CATEGORY_IDS, type CategoryId } from '../../lib/config';
import { holderFacts, instTable, positionFacts, rsFacts, volatilityFacts } from '../../lib/stockFacts';
import { biasAtrInterp, high52Interp, instInterp, rsInterp, sp, volRatioInterp, whaleInterp } from '../../lib/stockInterp';
import { fmtNum } from '../../lib/format';
import { Conclusion, DivergingBar, Metric, ProgressBar, RangeBar, Ring } from '../kit';
import { Section, Signed } from '../ui';
import { categoryName, completeness } from '../Scores';
import { lazyPick } from '../../lazy';

const SignalPanel = lazyPick(() => import('../SignalPanel'), 'SignalPanel');

type N = number | null | undefined;
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export type StockSeg = 'o' | 'm' | 'c' | 'f' | 'e';
/** 四環對應的分段：估值放在基本面分段 */
const RING_SEG: Record<CategoryId, StockSeg> = { chip: 'c', momentum: 'm', fundamental: 'f', valuation: 'f' };
const RING_COLOR: Record<CategoryId, string> = { chip: 'var(--c-blue)', momentum: 'var(--c-cyan)', fundamental: 'var(--c-indigo)', valuation: 'var(--c-purple)' };

export function OverviewPane({ h, row, onSeg }: { h: StockHistory; row?: StockRow; onSeg: (s: StockSeg) => void }) {
  const f = useMemo(() => {
    const rs = rsFacts(h);
    const pos = positionFacts(h);
    const vo = volatilityFacts(h);
    const m = h.metrics ?? {};
    const t20 = instTable(h.chip as ChipBlock | null | undefined, 20)?.rows.find((r) => r.party === 'total') ?? null;
    const hf = holderFacts(h);
    const t = h.trend ?? null;
    return {
      rs, pos, t, hf, t20,
      biasAtr: ok(t?.bias_atr) ? t!.bias_atr : vo.biasAtr,
      vr: ok(m.vol_ratio) ? (m.vol_ratio as number) : null,
      fine: h.sectors?.fine?.[0] ?? null,
    };
  }, [h]);
  const scoreOf = (id: CategoryId): N => (row?.[id] as N) ?? h.scores?.categories[id]?.score ?? null;
  const composite: N = (row?.composite as N) ?? h.scores?.composite ?? null;
  const dist52 = ok(f.t?.y52?.from_hi) ? f.t!.y52!.from_hi : f.pos.dist52;
  const rsI = rsInterp(f.rs.now, f.rs.prev, f.fine);
  const hiI = high52Interp(f.t?.y52, dist52);
  const biasI = biasAtrInterp(f.biasAtr);
  const vrI = volRatioInterp(f.vr);
  const instI = instInterp(f.t20?.lots, f.t20?.pctVolume);
  const whI = whaleInterp(f.hf);
  const y52 = f.t?.y52;
  return (
    <>
      <Section title="分數" testid="stock-scores">
        <Conclusion testid="score-concl">{ringsConclusion(CATEGORY_IDS.map((id) => [categoryName(id), scoreOf(id)]))}</Conclusion>
        <div class="rings" data-testid="score-rings">
          {CATEGORY_IDS.map((id) => {
            const c = completeness(h.scores, id);
            return (
              <Ring key={id} value={scoreOf(id)} color={RING_COLOR[id]} label={categoryName(id)} sub={c === null ? '無明細' : `資料 ${Math.round(c * 100)}%`}
                onClick={() => onSeg(RING_SEG[id])} testid={`ring-${id}`} />
            );
          })}
        </div>
        <a class="score-link ui-foot" href={`#/stock/${h.code}/scores`} data-testid="to-scores">綜合分 {ok(composite) ? Math.round(composite) : '—'}・查看全部因子</a>
      </Section>

      <Section title="重點指標" testid="stock-summary">
        <Conclusion>
          {ok(f.rs.now) ? `RS ${Math.round(f.rs.now)}` : 'RS —'}・{y52?.at_high ? '52 週新高' : ok(dist52) ? `距高點 ${fmtNum(Math.abs(dist52), 1)}%` : '距高點 —'}・{ok(f.vr) ? `量 ${fmtNum(f.vr, 2)} 倍` : '量 —'}
        </Conclusion>
        <div class="metrics" data-testid="stock-stats">
          <Metric term="market_percentile" label="RS 百分位" value={ok(f.rs.now) ? Math.round(f.rs.now) : '—'}
            graphic={<ProgressBar value={f.rs.now} label={`RS 百分位 ${ok(f.rs.now) ? Math.round(f.rs.now) : '無資料'}`} />}
            interp={rsI.text} alert={rsI.alert} />
          <Metric term="high_52w" label="距 52 週高" value={y52?.at_high ? '新高' : <Signed v={dist52} digits={1} unit="%" tone="plain" />}
            graphic={y52 && ok(y52.lo) && ok(y52.hi) && ok(f.t?.close) ? <RangeBar low={y52.lo} high={y52.hi} markers={[{ v: f.t!.close as number, color: 'var(--text-1)' }]} label={`52 週區間 ${y52.lo}～${y52.hi}`} /> : null}
            interp={hiI.text} />
          <Metric term="bias_atr" label="20 日乖離" value={ok(f.biasAtr) ? <>{fmtNum(f.biasAtr, 2)}<span class="key-unit">倍 ATR</span></> : '—'}
            graphic={ok(f.biasAtr) ? <DivergingBar value={f.biasAtr} max={4} tone="plain" label={`20 日乖離 ${fmtNum(f.biasAtr, 2)} 倍 ATR（刻度 ±4）`} /> : null}
            interp={biasI.text} alert={biasI.alert} alertText="20 日乖離超過 3 倍 ATR" />
          <Metric term="volume_ratio" label="量比" value={ok(f.vr) ? <>{fmtNum(f.vr, 2)}<span class="key-unit">倍</span></> : '—'}
            graphic={ok(f.vr) ? <ProgressBar value={Math.min(f.vr, 4)} max={4} color={vrI.alert ? 'var(--risk)' : 'var(--c-cyan)'} label={`量比 ${fmtNum(f.vr, 2)} 倍（刻度 0～4）`} /> : null}
            interp={vrI.text} alert={vrI.alert} alertText="量比超過 3 倍" />
          <Metric term="insti_share" label="法人 20 日佔量" value={<Signed v={f.t20?.pctVolume} digits={1} unit="%" />}
            graphic={ok(f.t20?.pctVolume) ? <DivergingBar value={f.t20!.pctVolume} max={20} label={`法人 20 日佔量 ${fmtNum(f.t20!.pctVolume as number, 1)}%（刻度 ±20%）`} /> : null}
            interp={instI.text} />
          <Metric term="whale" label="千張大戶週變化" value={ok(f.hf?.whaleChange) ? <Signed v={f.hf!.whaleChange} digits={2} unit="百分點" tone="plain" /> : '—'}
            graphic={ok(f.hf?.whaleChange) ? <DivergingBar value={f.hf!.whaleChange} max={1} tone="plain" label={`千張大戶週變化 ${fmtNum(f.hf!.whaleChange as number, 2)} 百分點（刻度 ±1）`} /> : null}
            interp={whI.text} />
        </div>
      </Section>

      <SignalPanel code={h.code} />
    </>
  );
}

/** 四環的結論行：最高與最低的分項（B1） */
function ringsConclusion(items: [string, N][]): string {
  const v = items.filter((x): x is [string, number] => ok(x[1]));
  if (!v.length) return '分數：資料不足';
  const hi = v.reduce((a, b) => (b[1] > a[1] ? b : a));
  const lo = v.reduce((a, b) => (b[1] < a[1] ? b : a));
  return hi[0] === lo[0] ? `${hi[0]} ${Math.round(hi[1])}` : `${hi[0]} ${Math.round(hi[1])} 最高、${lo[0]} ${Math.round(lo[1])} 最低`;
}

/** 「+1.23%」 */
export const pctText = (v: N, d = 2) => (ok(v) ? sp(v, d) : '—');
