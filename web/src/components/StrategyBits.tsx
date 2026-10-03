/**
 * 策略頁、個股頁策略訊號、指標效度頁共用的小元件與 ⓘ 內容（2026-10-03）：
 * - GradeTag：全站唯一的分級標籤（有效／訊號顯著・未勝 0050／觀察中／無效），不是按鈕、不用藍色。
 * - JudgeInfo：兩個基準的差別、校正後 t 的唯一定義、分級規則、多重檢定 M 與 t ≥ 3.0 的理由（文字來自 strategies.json）。
 */
import { Tag } from './ui';
import '../styles/strategy.css';
import { type Grade, type JudgeMeta, type MultiTest, type StrategyItem, GRADE_LABEL, gradeOf, gradeTone } from '../lib/strategies';

export function GradeTag({ s, grade }: { s?: Pick<StrategyItem, 'grade' | 'enabled'>; grade?: Grade }) {
  const g = grade ?? (s ? gradeOf(s) : 'invalid');
  // 標籤不是行文：對齊稽核的「數字與單位拆行」不把標籤結尾（0050）與下一行副資訊的第一個字（月）當成同一段文字
  return <span class="st-gtag" data-audit-skip=""><Tag tone={gradeTone(g) === 'strong' ? 'strong' : 'neutral'} testid="grade-tag">{GRADE_LABEL[g]}</Tag></span>;
}

/** 校正後 t 的定義（strategies.json judge_meta.t_text；舊資料用預設文字）。 */
export const T_TEXT_DEFAULT =
  '校正後 t＝日曆時間法 t、Newey-West t、不重疊區塊 t 三者中絕對值最小者（保留正負號）。日曆時間法：同一進場日的事件先平均成一個觀測；Newey-West：落後期數＝一個持有期內平均的進場日數；不重疊區塊：依進場日每「持有日數」個交易日切一塊、區塊平均後算 t。';

/** ⓘ：兩個基準、t 的定義、分級規則、多重檢定（策略庫列表、策略頁判定卡、個股頁策略訊號共用）。 */
export function JudgeInfo({ meta, multi }: { meta?: JudgeMeta; multi?: MultiTest }) {
  const h = meta?.horizon ?? 40;
  return (
    <>
      <h3>兩個基準</h3>
      <p>{meta?.bench_text.ew ?? '相對同日等權：同一進場日、同一持有期間，股票池內全部可進場股票的平均報酬。檢定訊號是否優於在同一個股票池隨機選股。'}</p>
      <p>{meta?.bench_text['0050'] ?? '相對 0050（含息）：同一期間持有 0050 不動的報酬，代表不做選股的機會成本；0050 受少數權值股影響大。'}</p>
      <p>超額＝持有 {h} 個交易日的扣成本報酬 − 基準同期報酬（T 日收盤後訊號、T+1 開盤進場、第 {h} 個交易日開盤出場）。</p>
      <h3>校正後 t</h3>
      <p>{meta?.t_text ?? T_TEXT_DEFAULT}</p>
      <p>全站的 t 都是這一種。</p>
      <h3>分級</h3>
      <p>{meta?.grade_rule ?? '有效＝訊號檢定 t ≥ 3.0，且相對 0050 超額 > 0、t ≥ 2.0、5 檔組合 Sharpe ≥ 同期 0050；訊號顯著・未勝 0050＝只有訊號檢定 t ≥ 3.0；觀察中＝2.0 ≤ 訊號檢定 t < 3.0；其餘無效。'}</p>
      <h3>多重檢定</h3>
      {multi ? (
        <>
          <p>已測試的策略 × 變體 M＝{multi.M.toLocaleString('zh-TW')}（指標 {multi.parts.indicators}、波段策略嘗試 {multi.parts.swing_trials}，× 判定持有期 {multi.parts.horizons} 種）。</p>
          <p>{multi.reason}</p>
        </>
      ) : <p>t ≥ 3.0 對應雙尾 p ≈ 0.27%：測試的策略與變體越多，偶然達到 t ≥ 2 的越多，所以訊號檢定門檻提高到 3.0。</p>}
      <p>依規則產生，非推薦；僅供研究參考，非投資建議。</p>
    </>
  );
}

/** 文字中的「數字＋單位」（10 日、12 個月、1.5 倍、10%、≥ 70）包成不拆行的片段（中文排版：數字與單位不得拆到兩行）。 */
export function keepNum(text: string) {
  const parts = text.split(/((?:[≥≤<>]\s?)?[+−-]?\d[\d,./-]*\s?(?:個月|%|張|億|元|萬|日|週|月|年|倍|檔|筆|次|點)?)/);
  return parts.map((p, i) => (i % 2 ? <span key={i} class="ui-num">{p}</span> : p));
}
