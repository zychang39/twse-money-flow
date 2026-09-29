/**
 * 槓桿風險計算（M2；METHODOLOGY §11.3）。純函式，只做風險計算、不是建議。
 *
 * 策略的歷史數字（最大回撤、年化報酬與波動、最大不利波動、跌停鎖死發生率）由 pipeline 以「同時持有 K 檔」的組合預先模擬
 * （strategies.json → portfolio[K]、trades）。這裡依使用者輸入計算：
 * - 波動目標法倍數 L_dd ＝ min(最大可承受回撤 ÷ 組合歷史最大回撤, 最大可承受回撤 × K ÷ 單筆最大不利波動第 99 百分位)：
 *   前者讓歷史回撤放大 L 倍剛好等於可承受回撤；後者讓「1 檔遇到最差 1% 的不利波動」時，帳戶損失不超過可承受回撤。
 * - 半凱利倍數 L_k ＝ 0.5 ×（年化平均報酬 − 融資年利率）÷ 年化變異數（≤ 0 時為 0）。
 * - 倍數 L ＝ min(L_dd, L_k, 天花板 2.5)；< 0 以 0 計。
 * - 融資：自有資金 C、總部位 V＝C×L；超過自有資金的部分以融資買進（融資成數 60%）：融資買進市值 F＝C(L−1)÷0.6、融資金額＝C(L−1)。
 *   整戶維持率＝融資買進的股票市值 ÷ 融資金額（初始 1 ÷ 0.6＝166.7%），低於 130% 追繳。
 */

export interface PortfolioStats {
  days?: number;
  ann_return?: number | null;
  mu_ann?: number | null;
  vol_ann?: number | null;
  mdd?: number | null;
  current_dd?: number | null;
}

export interface TradeStats {
  mae_p50?: number | null;
  mae_p90?: number | null;
  mae_p99?: number | null;
  lock_rate?: number | null;
}

export interface LeverageRules {
  ceiling: number;
  margin_loan_ratio: number;
  maintenance_call: number;
  lock_days: number;
  limit_pct: number;
}

export interface LeverageInput {
  capital: number;
  maxDd: number; // %
  slots: number;
  interest: number; // 年利率 %
  breaker: number; // %
  accountDd: number | null; // 使用者帳戶目前自高點回撤 %（可不填）
}

export interface Scenario {
  label: string;
  loss: number; // 元
  equity: number; // 元
  maintenance: number | null; // %（沒有融資時為 null）
  call: boolean;
}

export interface LeverageResult {
  lDd: number | null;
  lKelly: number | null;
  multiple: number;
  limitedBy: 'drawdown' | 'kelly' | 'ceiling' | 'none';
  exposure: number; // 總部位（元）
  loan: number; // 融資金額（元）
  interestYear: number; // 一年融資利息（元）
  netReturn: number | null; // 扣利息後年化報酬（歷史，%）
  scenarios: Scenario[];
  breaker: boolean;
  breakerReason: string | null;
}

const fin = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const round2 = (v: number) => Math.round(v * 100) / 100;

export function leverage(input: LeverageInput, p: PortfolioStats, tr: TradeStats, rules: LeverageRules): LeverageResult {
  const C = Math.max(0, input.capital);
  const mdd = fin(p.mdd) ? Math.abs(p.mdd) / 100 : null;
  const K0 = Math.max(1, input.slots);
  const maePart = fin(tr.mae_p99) && tr.mae_p99 > 0 ? ((input.maxDd / 100) * K0) / (tr.mae_p99 / 100) : null;
  const ddPart = mdd && mdd > 0 ? (input.maxDd / 100) / mdd : null;
  const lDd = ddPart === null ? maePart : maePart === null ? ddPart : Math.min(ddPart, maePart);
  const mu = fin(p.mu_ann) ? p.mu_ann / 100 : null;
  const vol = fin(p.vol_ann) ? p.vol_ann / 100 : null;
  const lKelly = mu !== null && vol && vol > 0 ? Math.max(0, (0.5 * (mu - input.interest / 100)) / (vol * vol)) : null;
  const cands: [number, LeverageResult['limitedBy']][] = [[rules.ceiling, 'ceiling']];
  if (lDd !== null) cands.push([lDd, 'drawdown']);
  if (lKelly !== null) cands.push([lKelly, 'kelly']);
  const [raw, limitedBy] = cands.reduce((a, b) => (b[0] < a[0] ? b : a));
  const multiple = round2(Math.max(0, raw));
  const V = C * multiple;
  const loan = C * Math.max(0, multiple - 1);
  const F = loan / rules.margin_loan_ratio;
  const K = Math.max(1, input.slots);
  const lock = 1 - (1 - rules.limit_pct / 100) ** rules.lock_days; // 連續 2 日跌停 ≈ 19%
  const maint = (drop: number) => (loan > 0 ? ((F - drop) / loan) * 100 : null);
  const sc = (label: string, lossOnBook: number, lossOnFinanced: number): Scenario => {
    const m = maint(lossOnFinanced);
    return { label, loss: lossOnBook, equity: C - lossOnBook, maintenance: m === null ? null : round2(m), call: m !== null && m < rules.maintenance_call };
  };
  const scenarios: Scenario[] = [];
  if (mdd !== null) scenarios.push(sc(`歷史最大回撤（${(mdd * 100).toFixed(1)}%）重演`, V * mdd, F * mdd));
  scenarios.push(sc(`1 檔連續 ${rules.lock_days} 日跌停鎖死`, (V / K) * lock, (F / K) * lock));
  scenarios.push(sc(`全部持股連續 ${rules.lock_days} 日跌停鎖死`, V * lock, F * lock));
  const annRet = fin(p.ann_return) ? p.ann_return : null;
  const netReturn = annRet === null ? null : round2(annRet * multiple - input.interest * Math.max(0, multiple - 1));
  const acct = fin(input.accountDd) ? Math.abs(input.accountDd) : null;
  const strat = fin(p.current_dd) ? Math.abs(p.current_dd) : null;
  let breakerReason: string | null = null;
  if (acct !== null && acct >= input.breaker) breakerReason = `你的帳戶自高點回撤 ${acct.toFixed(1)}%，超過你設定的 ${input.breaker}%`;
  else if (strat !== null && strat >= input.breaker) breakerReason = `這個策略的模擬組合目前自高點回撤 ${strat.toFixed(1)}%，超過你設定的 ${input.breaker}%`;
  return {
    lDd: lDd === null ? null : round2(lDd),
    lKelly: lKelly === null ? null : round2(lKelly),
    multiple,
    limitedBy,
    exposure: V,
    loan,
    interestYear: loan * (input.interest / 100),
    netReturn,
    scenarios,
    breaker: breakerReason !== null,
    breakerReason,
  };
}

/** 同時持有檔數 → 最接近的預先模擬組合（1、3、5、10）。 */
export function nearestSlots(slots: number, available: number[]): number {
  return available.reduce((a, b) => (Math.abs(b - slots) < Math.abs(a - slots) ? b : a), available[0] ?? 1);
}

export const BREAKER_TEXT = '依你的規則，槓桿應降至 1 倍';
