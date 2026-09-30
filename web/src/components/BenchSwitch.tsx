/** v3 M5-3 基準分段控制：sticky 在表格上方；切換時保持目前捲動位置（內容高度改變也不跳動）。 */
import { useState } from 'preact/hooks';
import { BENCH_KEYS, BENCH_LABEL, type BenchKey, loadBench, saveBench } from '../lib/bench';

/** 頁面層級的基準狀態：同一頁的表格、圖表、讀值都用同一個值。 */
export function useBenchState(): [BenchKey, (k: BenchKey) => void] {
  const [bench, setBench] = useState<BenchKey>(loadBench);
  const set = (k: BenchKey) => {
    const y = window.scrollY;
    saveBench(k);
    setBench(k);
    // 畫面更新後恢復捲動位置（兩個 frame：Preact 渲染＋版面計算）
    requestAnimationFrame(() => requestAnimationFrame(() => { if (Math.abs(window.scrollY - y) > 0) window.scrollTo(0, y); }));
  };
  return [bench, set];
}

export function BenchSwitch({ value, onChange, note }: { value: BenchKey; onChange: (k: BenchKey) => void; note?: string }) {
  return (
    <div class="bench-bar glass" data-testid="bench-switch">
      <div class="segmented bench-seg" role="group" aria-label="超額報酬的比較基準">
        {BENCH_KEYS.map((k) => (
          <button key={k} type="button" aria-pressed={value === k} onClick={() => { if (k !== value) onChange(k); }}>{BENCH_LABEL[k]}</button>
        ))}
      </div>
      {note ? <p class="caption muted bench-note">{note}</p> : null}
    </div>
  );
}
