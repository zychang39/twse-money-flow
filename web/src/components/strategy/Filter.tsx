/**
 * 策略詳情「績效」「事件研究」頂部的篩選列（M5）：期間「全部｜近 5 年｜近 3 年｜近 1 年｜年份」（年份可選自某年起或只看某年）、
 * 基準「0050｜等權｜加權報酬｜00631L」。網址參數 ?p= 與 ?b=（重新整理保留）；基準另記在 tmf-bench。
 * 分級標籤永遠以全期間計算；期間不是全部時顯示「檢視 2022 起・n／708 筆・分級以全期間為準」，n < 100 加橘色「樣本不足」。
 */
import { useState } from 'preact/hooks';
import { Seg, Tag } from '../ui';
import { Sheet } from '../Sheet';
import { Term } from '../kit';
import { useSegParam } from '../../hooks';
import type { BenchKey, StrategyPack } from '../../data/types';
import { BENCH_LABEL, loadBench, saveBench } from '../../lib/bench';
import { QUICK_PERIODS, periodLabel, periodNote, yearKeys } from '../../lib/strategyView';

export const BENCH_ORDER: BenchKey[] = ['0050', 'ew', 'tr', '00631L'];

/** 期間與基準（網址參數） */
export function useStrategyFilter(pack: StrategyPack | null | undefined): { period: string; setPeriod: (k: string) => void; bench: BenchKey; setBench: (b: BenchKey) => void } {
  const keys = pack ? Object.keys(pack.periods) : ['all'];
  const [period, setPeriod] = useSegParam<string>(keys, 'all', 'p');
  const [bench, setB] = useSegParam<BenchKey>(BENCH_ORDER, loadBench(), 'b');
  const setBench = (b: BenchKey) => {
    const y = window.scrollY;
    saveBench(b);
    setB(b);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (Math.abs(window.scrollY - y) > 0) window.scrollTo(0, y); }));
  };
  return { period: pack && pack.periods[period] ? period : 'all', setPeriod, bench, setBench };
}

export function FilterBar({ pack, period, setPeriod, bench, setBench }: {
  pack: StrategyPack;
  period: string; setPeriod: (k: string) => void;
  bench: BenchKey; setBench: (b: BenchKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const yk = yearKeys(pack);
  const isYear = period.startsWith('from:') || period.startsWith('year:');
  const note = periodNote(period, pack.periods[period], pack.periods.all?.card.n ?? 0);
  const pick = (k: string) => { setPeriod(k); setOpen(false); };
  return (
    <div class="stf" data-testid="st-filter">
      <div class="chips stf-periods" role="group" aria-label="期間" data-testid="period-chips">
        {QUICK_PERIODS.filter((k) => pack.periods[k]).map((k) => (
          <button key={k} type="button" class="chip" aria-pressed={period === k} onClick={() => setPeriod(k)}>{periodLabel(k)}</button>
        ))}
        <button type="button" class="chip" aria-pressed={isYear} aria-haspopup="dialog" onClick={() => setOpen(true)} data-testid="period-year">
          {isYear ? periodLabel(period) : '年份'}
        </button>
      </div>
      <Seg options={BENCH_ORDER.map((k) => [k, BENCH_LABEL[k]] as const)} value={bench} onChange={setBench} label="比較基準" small testid="bench-switch" />
      {note ? (
        <p class="stf-note ui-foot ui-muted" data-testid="period-note">
          {note.text}{note.small ? <> <Tag tone="risk" testid="small-sample"><Term id="small_sample">樣本不足</Term></Tag></> : null}
        </p>
      ) : null}
      <Sheet open={open} onClose={() => setOpen(false)} title="選擇年份">
        <p class="ui-foot ui-muted stf-sheet-h">自某年起</p>
        <div class="chips wrap" role="group" aria-label="自某年起">
          {yk.from.map((y) => <button key={y} type="button" class="chip" aria-pressed={period === `from:${y}`} onClick={() => pick(`from:${y}`)}>{y} 起</button>)}
        </div>
        <p class="ui-foot ui-muted stf-sheet-h">只看某年</p>
        <div class="chips wrap" role="group" aria-label="只看某年" data-testid="year-only">
          {yk.year.map((y) => <button key={y} type="button" class="chip" aria-pressed={period === `year:${y}`} onClick={() => pick(`year:${y}`)}>{y} 年</button>)}
        </div>
      </Sheet>
    </div>
  );
}
