/**
 * 交易流程元件：新增持倉前檢查表（含衝動攔截的冷靜卡）、平倉、補寫檢討。
 * 遊戲化只記錄紀律行為：完成檢查表（不論最後是否建立持倉）、完成檢討。
 */
import { useEffect, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { StockSearch } from './StockSearch';
import { Signed } from './Change';
import { useAsync } from '../hooks';
import { loadMarket, loadStock } from '../data/api';
import { adjustTrade, eventsFor } from '../lib/corpActions';
import { logActivity, saveTrade, uid, type Trade } from '../db/db';
import type { StockRow } from '../data/types';
import type { PortfolioSettings } from '../lib/settings';
import { roundTrip, type CostSettings } from '../lib/costs';
import { checklistCalc, FIELD_LABEL } from '../lib/checklist';
import { envInfo } from '../lib/envState';
import { impulseFacts } from '../lib/impulse';
import { thresholds } from '../lib/config';
import { todayTpe } from '../lib/dates';
import { fmtMoney, fmtNum } from '../lib/format';

export const REASONS = ['籌碼', '動能', '營收', '估值', '事件', '其他'];
export const ERROR_TAGS = ['追高', '攤平', '提早停利', '未守停損', '過度交易', '違反計畫', '消息面衝動', '部位過大'];
const MIN_RR = Number(thresholds.portfolio.min_reward_risk);

function autoChecklist(r: StockRow | undefined) {
  if (!r) return { trend: '', revenue: '', valuation: '' };
  const ma240 = r.ma240_gap as number | null;
  const ma60 = r.ma60_gap as number | null;
  const trend = ma240 === null || ma240 === undefined ? '' : ma240 > 0 && (ma60 ?? 0) > 0 ? '多頭（年線、季線之上）' : ma240 > 0 ? '年線之上、短線整理' : '年線之下';
  const y3 = r.revenue_yoy_3m as number | null;
  const revenue = y3 === null || y3 === undefined ? '' : y3 >= 20 ? '高成長（近 3 月年增 ≥ 20%）' : y3 > 0 ? '成長' : '衰退';
  const fp = r.fair_position as number | null;
  const valuation = fp === null || fp === undefined ? '' : fp <= 33 ? '偏便宜' : fp <= 67 ? '合理' : '偏貴';
  return { trend, revenue, valuation };
}

const EMPTY = { market: '', trend: '', revenue: '', valuation: '', reasonType: '籌碼', reason: '', entry: '', stop: '', target: '', shares: '' };

/** 冷靜卡：列出事實，需要多確認一步才能繼續。語氣中性。 */
export function CalmCard({ facts, onContinue, onCancel }: { facts: string[]; onContinue: () => void; onCancel: () => void }) {
  const [ack, setAck] = useState(false);
  return (
    <div class="calm" role="group" aria-label="繼續之前的事實整理">
      <div class="body w6">繼續之前，先看一下目前的事實</div>
      <ul class="caption t1">{facts.map((f) => <li key={f}>{f}</li>)}</ul>
      <label class="check" style={{ marginTop: 'var(--s-3)' }}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck((e.target as HTMLInputElement).checked)} />
        <span class="caption">我已看過以上事實</span>
      </label>
      <div class="row" style={{ marginTop: 'var(--s-2)' }}>
        <button class="btn primary" disabled={!ack} onClick={onContinue}>繼續填寫檢查表</button>
        <button class="btn" onClick={onCancel}>先不要</button>
      </div>
    </div>
  );
}

export function ChecklistSheet({ open, onClose, rows, portfolio, day, preset }: {
  open: boolean;
  onClose: () => void;
  rows: StockRow[];
  portfolio: PortfolioSettings;
  day: string;
  preset?: StockRow;
}) {
  const market = useAsync(loadMarket, []);
  const [row, setRow] = useState<StockRow | undefined>(preset);
  const [ack, setAck] = useState(false);
  const [f, setF] = useState(EMPTY);
  useEffect(() => { if (open) { setRow(preset); setAck(false); setF(EMPTY); } }, [open, preset?.code]);
  useEffect(() => {
    if (!row) return;
    const auto = autoChecklist(row);
    setF((x) => ({ ...x, ...Object.fromEntries(Object.entries(auto).filter(([, v]) => v)), entry: String(row.close ?? '') }));
  }, [row]);
  const env = market.data ? envInfo(market.data.env?.lights) : null;
  const facts = row ? impulseFacts(row, env) : [];
  // #10：空的停損／目標不當成 0；按鈕寫出實際卡住的條件
  const calc = checklistCalc({ hasStock: !!row, ...f }, portfolio, fmtMoney);
  const { entry, stop, target, rr, shares } = calc;
  const qualitative = calc.qualitative;
  const valid = calc.blocker === null;
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  const checklist = () => ({ market: f.market, trend: f.trend, revenue: f.revenue, valuation: f.valuation, reason: f.reason.trim() });

  async function save() {
    if (!row || !valid) return;
    if (entry === null || stop === null || target === null) return;
    await saveTrade({ id: uid(), code: row.code, name: row.name, status: 'open', openedAt: todayTpe(), entry, shares, stop, target, reasonType: f.reasonType, checklist: checklist() });
    await logActivity('checklist_done', day, { outcome: 'open', code: row.code });
    onClose();
  }
  async function skip() {
    if (!row || !qualitative) return;
    await logActivity('checklist_done', day, { outcome: 'skip', code: row.code, reason: f.reason.trim() });
    onClose();
  }

  // #10：每個欄位用 <label for> 對應題目（原本 select 包在 label 裡另加 aria-label，iOS VoiceOver 會唸成目前的值）
  const sel = (k: keyof typeof f, label: string, options: string[], hint?: string) => (
    <div class="field">
      <label for={`ck-${k}`}>{label}{hint ? <span class="muted">{hint}</span> : null}</label>
      <select id={`ck-${k}`} class="select" value={f[k]} onChange={set(k)}>
        <option value="">請選擇</option>
        {[...new Set([f[k], ...options].filter(Boolean))].map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
  const num = (k: 'entry' | 'stop' | 'target' | 'shares', label: string, value: string, mode: 'decimal' | 'numeric' = 'decimal') => (
    <div class="field">
      <label for={`ck-${k}`}>{label}</label>
      <input id={`ck-${k}`} class="input" type="number" inputMode={mode} value={value} onInput={set(k)} />
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title="新增持倉前檢查表" detent="full">
      {!row ? <StockSearch rows={rows} onPick={setRow} autoFocus /> : (
        <div class="row between"><span class="body w6">{row.name} <span class="caption muted">{row.code}</span></span>{!preset ? <button class="btn small" onClick={() => setRow(undefined)}>更換</button> : null}</div>
      )}
      {row && facts.length && !ack ? (
        <div style={{ marginTop: 'var(--s-4)' }}><CalmCard facts={facts} onContinue={() => setAck(true)} onCancel={onClose} /></div>
      ) : row ? (
        <>
          {sel('market', FIELD_LABEL.market, ['偏多', '中性', '偏空'], '（見今晚頁）')}
          {sel('trend', FIELD_LABEL.trend, ['多頭（年線、季線之上）', '年線之上、短線整理', '年線之下'])}
          {sel('revenue', FIELD_LABEL.revenue, ['高成長（近 3 月年增 ≥ 20%）', '成長', '衰退', '不適用'])}
          {sel('valuation', FIELD_LABEL.valuation, ['偏便宜', '合理', '偏貴', '不適用'])}
          {sel('reasonType', FIELD_LABEL.reasonType, REASONS)}
          <div class="field"><label for="ck-reason">理由（必填）</label><textarea id="ck-reason" class="input" rows={2} value={f.reason} onInput={set('reason')} /></div>
          <div class="grid three">
            {num('entry', FIELD_LABEL.entry, f.entry)}
            {num('stop', FIELD_LABEL.stop, f.stop)}
            {num('target', FIELD_LABEL.target, f.target)}
          </div>
          <div class="card caption" data-testid="checklist-calc">
            <div>風險報酬比：<b class={rr !== null && rr < MIN_RR ? 'risk' : ''} data-testid="checklist-rr">{calc.rrText}</b>
              {rr !== null && rr < MIN_RR ? <span class="tag risk" style={{ marginLeft: 'var(--s-2)' }}>低於 1:{MIN_RR}</span> : null}</div>
            <div data-testid="checklist-size">建議部位：{calc.sizeText}</div>
            <div>觸及停損的虧損：{calc.lossIfStopped === null ? '—' : `約 ${fmtMoney(calc.lossIfStopped)}`}</div>
            {calc.size && calc.size.shares === 0 ? <div class="risk">依風險上限不足 1 張：可改用零股、放寬停損或自行輸入股數</div> : null}
          </div>
          {num('shares', `${FIELD_LABEL.shares}（預設為建議部位）`, f.shares || String(calc.size?.shares ?? ''), 'numeric')}
          <button class="btn primary block" disabled={!valid} onClick={save} data-testid="checklist-submit">{valid ? '加入持倉' : calc.blocker}</button>
          <button class="btn block" style={{ marginTop: 'var(--s-2)' }} disabled={!qualitative} onClick={skip}>檢查完，決定先不進場</button>
          <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>兩種結果都算完成一份檢查表；紀律獎勵不因是否建立持倉而不同。</p>
        </>
      ) : null}
    </Sheet>
  );
}

export function CloseSheet({ trade, onClose, costs, price, day }: { trade: Trade | null; onClose: () => void; costs: CostSettings; price: number | null; day: string }) {
  const [exit, setExit] = useState('');
  const [date, setDate] = useState(todayTpe());
  const [review, setReview] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  // D-01：持有期間的分割、減資、除權息 → 進場價與股數換算到平倉價的基準（使用者原始輸入不變，另存 adjFactor）
  const hist = useAsync(() => (trade ? loadStock(trade.code).catch(() => null) : Promise.resolve(null)), [trade?.code]);
  const adj = trade ? adjustTrade(trade, eventsFor(null, hist.data), date) : null;
  useEffect(() => { if (trade) { setExit(String(price ?? trade.entry)); setTags([]); setReview(''); setDate(todayTpe()); } }, [trade?.id]);
  const px = Number(exit);
  const rt = trade && adj && px > 0 ? roundTrip(adj.entry, px, trade.shares / adj.factor, trade.code, costs) : null;
  async function done() {
    if (!trade || !(px > 0)) return;
    const extra = adj && adj.factor !== 1 ? { adjFactor: adj.factor, adjNote: adj.notes.join('、') || undefined } : {};
    await saveTrade({ ...trade, status: 'closed', closedAt: date, exit: px, review, errorTags: tags, fees: rt?.costs ?? 0, ...extra });
    if (review.trim()) await logActivity('review_done', day, { trade: trade.id });
    onClose();
  }
  return (
    <Sheet open={!!trade} onClose={onClose} title={trade ? `平倉：${trade.name}` : '平倉'} detent="full">
      {trade ? (
        <>
          <div class="grid two">
            <label class="field"><span>出場價</span><input class="input" type="number" inputMode="decimal" value={exit} onInput={(e) => setExit((e.target as HTMLInputElement).value)} /></label>
            <label class="field"><span>日期</span><input class="input" type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} /></label>
          </div>
          {adj?.notes.length ? <p class="caption muted" data-testid="close-adjusted">{adj.notes.join('、')}：進場價換算為 {fmtNum(adj.entry)}、股數 {Math.round(trade.shares / adj.factor).toLocaleString()} 股</p> : null}
          {rt ? <p class="caption">損益（扣手續費與證交稅 {fmtMoney(rt.costs)}）：<Signed value={rt.pnl} format={fmtMoney} /></p> : null}
          <label class="field"><span>檢討（可稍後在紀律頁補寫）</span><textarea class="input" rows={3} value={review} onInput={(e) => setReview((e.target as HTMLTextAreaElement).value)} /></label>
          <div class="chips wrap" role="group" aria-label="錯誤標籤" style={{ flexWrap: 'wrap' }}>
            {ERROR_TAGS.map((t) => (
              <button key={t} class="chip" aria-pressed={tags.includes(t)} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>{t}</button>
            ))}
          </div>
          <button class="btn primary block" style={{ marginTop: 'var(--s-4)' }} disabled={!(px > 0)} onClick={done}>確認平倉</button>
        </>
      ) : null}
    </Sheet>
  );
}

export function ReviewSheet({ trade, onClose, day }: { trade: Trade | null; onClose: () => void; day: string }) {
  const [review, setReview] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => { if (trade) { setReview(trade.review ?? ''); setTags(trade.errorTags ?? []); } }, [trade?.id]);
  async function done() {
    if (!trade || !review.trim()) return;
    await saveTrade({ ...trade, review: review.trim(), errorTags: tags });
    await logActivity('review_done', day, { trade: trade.id });
    onClose();
  }
  return (
    <Sheet open={!!trade} onClose={onClose} title={trade ? `檢討：${trade.name}` : '檢討'} detent="full">
      {trade ? (
        <>
          <p class="caption muted">{trade.openedAt} → {trade.closedAt}・{fmtNum(trade.entry)} → {fmtNum(trade.exit ?? null)}（理由：{trade.reasonType}，{trade.checklist.reason}）</p>
          <label class="field"><span>這筆交易做對與做錯的地方</span><textarea class="input" rows={4} value={review} data-autofocus onInput={(e) => setReview((e.target as HTMLTextAreaElement).value)} /></label>
          <div class="chips wrap" role="group" aria-label="錯誤標籤" style={{ flexWrap: 'wrap' }}>
            {ERROR_TAGS.map((t) => (
              <button key={t} class="chip" aria-pressed={tags.includes(t)} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>{t}</button>
            ))}
          </div>
          <button class="btn primary block" style={{ marginTop: 'var(--s-4)' }} disabled={!review.trim()} onClick={done}>完成檢討</button>
        </>
      ) : null}
    </Sheet>
  );
}
