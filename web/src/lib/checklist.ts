/**
 * 新增持倉前檢查表的計算與提示（#10；純函式）。
 * - 停損或目標是空的時，不計算風險報酬比與建議部位（原本 Number('') = 0，被當成停損 0 元 → 「1 : −1.00」「每股風險＝進場價」）。
 * - 2026-10-06：檢查表不是關卡。1–5 由系統自動帶出（lib/checklistAuto），理由、停損、目標都是選填；
 *   「加入持倉」只在缺進場價或股數時停用，按鈕寫出缺哪一欄。停損 ≥ 進場、目標 ≤ 進場只在欄位下方說明，不擋送出
 *   （存檔後停損不算有效停損，持股列表顯示「未設停損」）。
 */
import { positionSize, rewardRisk } from './sizing';

export interface ChecklistInput {
  hasStock: boolean;
  /** 1–5 與理由不再影響能否送出（2026-10-06）；保留選填欄位，舊呼叫端不用改 */
  market?: string;
  trend?: string;
  revenue?: string;
  valuation?: string;
  reason?: string;
  entry: string;
  stop: string;
  target: string;
  /** 使用者自行輸入的股數（空字串＝用建議部位） */
  shares: string;
}

export interface ChecklistCalc {
  entry: number | null;
  stop: number | null;
  target: number | null;
  /** 風險報酬比；缺停損或目標、或價格順序不對時為 null */
  rr: number | null;
  rrText: string;
  /** 建議部位（缺停損或停損 ≥ 進場時為 null） */
  size: { shares: number; lots: number } | null;
  sizeText: string;
  perShareRisk: number | null;
  /** 實際股數（使用者輸入優先） */
  shares: number;
  lossIfStopped: number | null;
  /** 已選股票（可以「決定先不進場」） */
  qualitative: boolean;
  /** 卡住「加入持倉」的第一個條件（只有選股、進場價、股數）；null＝可以加入 */
  blocker: string | null;
  /** 停損欄的說明（停損 ≥ 進場價時不計入風險計算）；沒有問題為 null */
  stopNote: string | null;
  /** 目標欄的說明（目標 ≤ 進場價時不計算風險報酬比）；沒有問題為 null */
  targetNote: string | null;
}

/** 空字串、非數字、≤ 0 → null（價格一定為正） */
export function priceOf(s: string): number | null {
  if (!s.trim()) return null;
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export const FIELD_LABEL = {
  market: '1. 市場燈號',
  trend: '2. 趨勢',
  revenue: '3. 營收',
  valuation: '4. 估值',
  reasonType: '5. 理由類型',
  reason: '理由（選填，建議填寫供復盤）',
  entry: '進場價',
  stop: '6. 停損價（選填）',
  target: '7. 目標價（選填）',
  shares: '實際股數',
} as const;

export function checklistCalc(f: ChecklistInput, p: { capital: number; riskPct: number; oddLot: boolean }, fmt: (v: number) => string = String): ChecklistCalc {
  const entry = priceOf(f.entry);
  const stop = priceOf(f.stop);
  const target = priceOf(f.target);
  const orderOk = entry !== null && stop !== null && stop < entry;
  const targetOk = entry !== null && target !== null && target > entry;
  const rr = orderOk && targetOk ? rewardRisk(entry, stop, target) : null;
  const perShareRisk = orderOk ? entry - stop : null;
  const sized = orderOk ? positionSize(p.capital, p.riskPct, entry, stop, p.oddLot) : null;
  const size = sized ? { shares: sized.shares, lots: sized.lots } : null;
  const typed = f.shares.trim() ? Number(f.shares) : null;
  const shares = typed !== null && Number.isFinite(typed) ? Math.max(0, Math.floor(typed)) : size?.shares ?? 0;

  let rrText: string;
  if (stop === null && target === null) rrText = '—（未填停損與目標，無法計算）';
  else if (stop === null) rrText = '—（未填停損，無法計算）';
  else if (target === null) rrText = '—（未填目標，無法計算）';
  else if (!orderOk) rrText = '—（停損不低於進場價，無法計算）';
  else if (!targetOk) rrText = '—（目標不高於進場價，無法計算）';
  else rrText = rr === null ? '—' : `1 : ${rr.toFixed(2)}`;

  let sizeText: string;
  if (entry === null) sizeText = '—（填入進場價後計算）';
  else if (stop === null) sizeText = '—（未填停損，無法依單筆風險換算）';
  else if (!orderOk || !sized) sizeText = '—（停損不低於進場價，無法換算）';
  else sizeText = `${p.oddLot ? `${sized.shares} 股` : `${sized.lots} 張`}（總資金 ${fmt(p.capital)} × 單筆風險 ${p.riskPct}% ÷ 每股風險 ${(entry - stop).toFixed(2)}）`;

  const qualitative = f.hasStock;
  const blocker =
    !f.hasStock ? '請先選擇股票'
    : entry === null ? '請填入「進場價」'
    : shares <= 0 ? (size && size.shares === 0 && typed === null ? '股數為 0：風險上限換算的股數小於 1 張，請改用零股或自行輸入股數'
      : typed === null ? `請填入「${FIELD_LABEL.shares}」` : '請輸入大於 0 的股數')
    : null;
  const stopNote = entry !== null && stop !== null && stop >= entry ? '停損價不低於進場價：不計入風險計算，存檔後視為未設停損' : null;
  const targetNote = entry !== null && target !== null && target <= entry ? '目標價不高於進場價：不計算風險報酬比' : null;

  return {
    entry, stop, target, rr, rrText, size, sizeText, perShareRisk, shares,
    lossIfStopped: perShareRisk !== null ? perShareRisk * shares : null,
    qualitative, blocker, stopNote, targetNote,
  };
}

/**
 * 檢查表 7 題是否完成（流程頁進場環、合規交易的「進場前完成檢查表」）：
 * 1 市場燈號、2 趨勢、3 營收、4 估值、5 理由類型（含理由文字）、6 停損價（低於進場價）、7 目標價（高於進場價）。
 * 舊交易沒有 checklistDone 欄位時由已存的答案推得（遷移 v5 也用這個函式補欄位）。
 * skipStop：違規標籤「未檢查」不重複計入第 6 題（停損另記「無停損」）。
 */
export function checklistComplete(t: {
  checklist?: { market?: string; trend?: string; revenue?: string; valuation?: string; reason?: string } | null;
  reasonType?: string;
  entry: number;
  stop: number;
  target: number;
}, opts: { skipStop?: boolean } = {}): boolean {
  const c = t.checklist ?? {};
  const filled = (s: string | undefined) => !!s && s.trim().length > 0;
  return filled(c.market) && filled(c.trend) && filled(c.revenue) && filled(c.valuation)
    && filled(t.reasonType) && filled(c.reason)
    && (opts.skipStop || (Number.isFinite(t.stop) && t.stop > 0 && t.stop < t.entry))
    && Number.isFinite(t.target) && t.target > t.entry;
}

/** 個股頁風險試算「帶入檢查表」的網址參數（#/discipline/checklist?code=2330&price=123.5&stop=110&shares=150）。 */
export interface ChecklistPrefill {
  code?: string;
  /** 進場價（參考價） */
  entry?: string;
  stop?: string;
  shares?: string;
}

/**
 * 解析帶入參數：代號轉大寫（E-08）；價格必須是正數；股數必須是正整數。不合法的參數直接忽略（不猜、不補 0），
 * 其餘照常帶入；停損 ≥ 參考價時仍帶入，由檢查表的提示（「停損價要低於進場價」）說明。
 */
export function parseChecklistQuery(q: URLSearchParams | string): ChecklistPrefill {
  const p = typeof q === 'string' ? new URLSearchParams(q.replace(/^[^?]*\?/, '')) : q;
  const out: ChecklistPrefill = {};
  const rawCode = p.get('code');
  if (rawCode) {
    let c = rawCode;
    try { c = decodeURIComponent(rawCode); } catch { /* 原樣使用 */ }
    c = c.replace(/\s+/g, '').toUpperCase();
    if (/^[0-9A-Z]{4,6}$/.test(c)) out.code = c;
  }
  const num = (k: string): number | null => {
    const s = p.get(k);
    if (s === null || !s.trim()) return null;
    const v = Number(s);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const price = num('price');
  if (price !== null) out.entry = String(price);
  const stop = num('stop');
  if (stop !== null) out.stop = String(stop);
  const shares = num('shares');
  if (shares !== null && Number.isInteger(shares)) out.shares = String(shares);
  return out;
}
