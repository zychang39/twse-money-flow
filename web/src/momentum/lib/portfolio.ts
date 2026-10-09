/**
 * 組合試算（動能流程第五節；純計算，不送單）。與 pipeline/momentum_flow/portfolio.py 同一套規則：
 * - 每名額金額 S＝M ÷ N；可用名額＝floor(N × 曝險上限)。
 * - 依排序逐檔填入；同一主族群最多 3 檔、試算金額合計 ≤ 35% × M；超過者跳過。
 * - 股數（P＝未還原收盤）：整股張數＝floor(S ÷ (P × 1000))、零股＝floor((S − 張數 × 1000 × P) ÷ P)。
 * - 未填滿的名額＝「現金」；不因名額未滿放寬任何門檻。
 */
export interface Pick { code: string; name: string; group: string | null; price: number | null }
export interface PlanRow { code: string | null; name: string; group: string | null; price: number | null; lots: number; odd: number; amount: number }
export interface Plan { total: number; slots: number; perSlot: number; usable: number; rows: PlanRow[]; skipped: { code: string; why: string }[] }

export const GROUP_MAX_COUNT = 3;
export const GROUP_MAX_WEIGHT = 0.35;

export function plan(picks: Pick[], total: number, slots: number, exposure: number): Plan {
  if (!(total > 0) || !(slots > 0)) return { total, slots, perSlot: 0, usable: 0, rows: [], skipped: [] };
  const per = total / slots;
  const usable = Math.floor(slots * exposure + 1e-9);
  const maxW = GROUP_MAX_WEIGHT * total;
  const count = new Map<string, number>();
  const amount = new Map<string, number>();
  const rows: PlanRow[] = [];
  const skipped: { code: string; why: string }[] = [];
  for (const pk of picks) {
    if (rows.length >= usable) break;
    if (pk.price === null || !(pk.price > 0)) { skipped.push({ code: pk.code, why: '資料不足' }); continue; }
    const g = pk.group ?? '';
    if (g && (count.get(g) ?? 0) >= GROUP_MAX_COUNT) { skipped.push({ code: pk.code, why: `同一主族群已 ${GROUP_MAX_COUNT} 檔` }); continue; }
    const lots = Math.floor(per / (pk.price * 1000));
    const odd = Math.floor((per - lots * 1000 * pk.price) / pk.price);
    const amt = (lots * 1000 + odd) * pk.price;
    if (g && (amount.get(g) ?? 0) + amt > maxW + 1e-6) { skipped.push({ code: pk.code, why: `同一主族群試算金額合計超過 ${Math.round(GROUP_MAX_WEIGHT * 100)}%` }); continue; }
    if (g) { count.set(g, (count.get(g) ?? 0) + 1); amount.set(g, (amount.get(g) ?? 0) + amt); }
    rows.push({ code: pk.code, name: pk.name, group: pk.group, price: pk.price, lots, odd, amount: Math.round(amt) });
  }
  for (let i = rows.length; i < usable; i++) rows.push({ code: null, name: '現金', group: null, price: null, lots: 0, odd: 0, amount: Math.round(per) });
  return { total, slots, perSlot: Math.round(per), usable, rows, skipped };
}

const FUND_KEY = 'tmf-momentum-fund';
/** 總資金 M（正整數）與名額 N（8／9／10）：localStorage，讀寫都包 try/catch。 */
export function loadFund(): { total: number; slots: number } {
  try {
    const v = JSON.parse(localStorage.getItem(FUND_KEY) ?? '{}') as { total?: number; slots?: number };
    const total = Number.isInteger(v.total) && (v.total as number) > 0 ? (v.total as number) : 1_000_000;
    const slots = v.slots === 8 || v.slots === 9 || v.slots === 10 ? v.slots : 10;
    return { total, slots };
  } catch {
    return { total: 1_000_000, slots: 10 };
  }
}
export function saveFund(v: { total: number; slots: number }): void {
  try { localStorage.setItem(FUND_KEY, JSON.stringify(v)); } catch { /* 無痕模式：只在本次有效 */ }
}
