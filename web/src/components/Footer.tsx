/**
 * 全站唯一的頁尾警語（2026-10-06）：「僅供研究參考，非投資建議。」保留一行小字；資料來源與 1D／1W 說明收在
 * 「資料來源與說明 ›」，點了就地展開（高度動畫；減少動態效果時直接展開）。所有頁面共用這一個元件（app.tsx）。
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { reduceMotion } from './kit';

export const DISCLAIMER = '僅供研究參考，非投資建議。';

export function Footer() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (first.current || reduceMotion()) { first.current = false; el.style.height = open ? '' : '0px'; return; }
    const target = open ? el.scrollHeight : 0;
    el.style.height = `${el.getBoundingClientRect().height}px`;
    void el.offsetHeight;
    el.style.height = `${target}px`;
    const end = () => { if (open) el.style.height = ''; };
    el.addEventListener('transitionend', end, { once: true });
    return () => el.removeEventListener('transitionend', end);
  }, [open]);
  return (
    <footer class="footer" data-testid="footer">
      <p>{DISCLAIMER}</p>
      <button type="button" class="footer-toggle" aria-expanded={open} aria-controls="footer-more" onClick={() => setOpen(!open)}>
        資料來源與說明<span class="footer-chev" aria-hidden="true">›</span>
      </button>
      <div id="footer-more" class="footer-more" ref={ref} aria-hidden={!open}>
        <p>資料來源：臺灣證券交易所、證券櫃檯買賣中心、臺灣集中保管結算所、臺灣期貨交易所、公開資訊觀測站、中央銀行、美國財政部等（政府資料開放授權條款－第 1 版）；主動式 ETF 持股取自各發行投信官網。</p>
        <p>個股 1D／1W 走勢（5 分鐘 K）：Yahoo Finance（非官方、非政府開放資料，僅供參考；集合競價成交量未提供）。加權指數 1D 以證交所每 5 秒指數統計為準，取不到時改用 Yahoo Finance（非官方）並標示。</p>
      </div>
    </footer>
  );
}
