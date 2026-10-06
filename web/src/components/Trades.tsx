/**
 * 交易流程元件：新增持倉前檢查表（含事實頁、1–5 自動帶出、說明頁）、平倉、補寫檢討。
 * 流程紀錄：檢查表、停損、計畫風險與檢討時間存在交易紀錄（db.saveTrade 自動補 v5 欄位）；平倉時記出場原因。
 * 檢查表可由網址帶入參考價、停損價、股數（個股頁風險試算 → #/discipline/checklist?code=&price=&stop=&shares=）。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { StockSearch } from './StockSearch';
import { Signed } from './Change';
import { useAsync } from '../hooks';
import { loadMarket, loadStock } from '../data/api';
import { adjustTrade, eventsFor } from '../lib/corpActions';
import { logActivity, saveTrade, uid, type ExitReason, type Trade } from '../db/db';
import { EXIT_REASON_LABEL } from '../lib/ritual';
import type { StockHistory, StockRow } from '../data/types';
import type { PortfolioSettings } from '../lib/settings';
import { roundTrip, type CostSettings } from '../lib/costs';
import { checklistCalc, FIELD_LABEL, priceOf, type ChecklistPrefill } from '../lib/checklist';
import { AUTO_LABEL, autoItems, buildSnapshot, effectiveOf, itemDoc, reasonDraft, snapshotDone, stopRefs, topSummary, type AutoKey, type Overrides } from '../lib/checklistAuto';
import { envSummary, lightDoc, lightRow, stockFactDoc, stockFactRows } from '../lib/entryFacts';
import { FactDetail, FactsView, ItemDetail, ItemRows, NavStack } from './EntryCheck';
import { Section } from './ui';
import { Skeleton } from './kit';
import { envInfo } from '../lib/envState';
import { impulseFacts } from '../lib/impulse';
import { thresholds } from '../lib/config';
import { todayTpe } from '../lib/dates';
import { fmtMoney, fmtNum, fmtPrice } from '../lib/format';

export { REASONS } from '../lib/checklistAuto';
export const ERROR_TAGS = ['追高', '攤平', '提早停利', '未守停損', '過度交易', '違反計畫', '消息面衝動', '部位過大'];
const MIN_RR = Number(thresholds.portfolio.min_reward_risk);

const EMPTY = { reason: '', entry: '', stop: '', target: '', shares: '' };
type Detail = { kind: 'fact'; id: string } | { kind: 'item'; key: AutoKey } | null;

/**
 * 新增持倉前檢查表（2026-10-06 重做）：檢查表是「進場前看懂現況」，不是關卡。
 * - 符合冷靜卡條件（lib/impulse）時先顯示事實頁：資金環境總結＋每項指標一列，「繼續填寫檢查表」直接可按。
 * - 1–5 由系統自動帶出（lib/checklistAuto），資料不足時退回手動選單；理由、停損、目標選填。
 * - 只有缺進場價或股數時「加入持倉」停用，按鈕寫出缺哪一欄。每一列都能推入說明頁（面板內 push）。
 */
export function ChecklistSheet({ open, onClose, rows, portfolio, day, preset, prefill }: {
  open: boolean;
  onClose: () => void;
  rows: StockRow[];
  portfolio: PortfolioSettings;
  day: string;
  preset?: StockRow;
  /** 由個股頁風險試算帶入的參考價、停損價、股數（字串；不合法的已在解析時忽略） */
  prefill?: ChecklistPrefill;
}) {
  const market = useAsync(loadMarket, []);
  const [row, setRow] = useState<StockRow | undefined>(preset);
  const [factsDone, setFactsDone] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [overrides, setOverrides] = useState<Overrides>({});
  /** 使用者改過理由（之後資料再載入也不覆蓋草稿） */
  const [reasonEdited, setReasonEdited] = useState(false);
  const [detail, setDetail] = useState<Detail>(null);
  const carried = { ...(prefill?.entry ? { entry: prefill.entry } : {}), ...(prefill?.stop ? { stop: prefill.stop } : {}), ...(prefill?.shares ? { shares: prefill.shares } : {}) };
  // 只在開啟的那一刻重設（避免頁面重新繪製時把已填的欄位清掉）；開啟後才載入到的帶入股票另外補上
  // 進場價預帶最新收盤（個股頁帶入的參考價優先）
  const entryFor = (r: StockRow | undefined) => (!r ? '' : prefill?.entry && (!prefill.code || r.code === prefill.code) ? prefill.entry : String(r.close ?? ''));
  const wasOpen = useRef(false);
  useEffect(() => {
    // 重新開啟同一檔（preset 不變）時 row 不會改變，進場價在這裡一併帶入
    if (open && !wasOpen.current) { setRow(preset); setFactsDone(false); setF({ ...EMPTY, ...carried, entry: entryFor(preset) }); setOverrides({}); setReasonEdited(false); setDetail(null); }
    wasOpen.current = open;
  }, [open]);
  useEffect(() => { if (open && preset && !row) setRow(preset); }, [preset?.code]);
  // 換股：進場價重新帶入，理由回到草稿，手動調整清空
  useEffect(() => {
    if (!row) return;
    setF((x) => ({ ...x, entry: entryFor(row), reason: '' }));
    setOverrides({});
    setReasonEdited(false);
    setDetail(null);
  }, [row?.code]);

  // 個股檔：營收逐月年增率、近 20 日低點、說明頁走勢（載入中為 undefined，失敗為 null）
  const histQ = useAsync(() => (row ? loadStock(row.code).catch(() => null) : Promise.resolve(null)), [row?.code]);
  const hist: StockHistory | null | undefined = !row ? null : histQ.loading || (histQ.data && histQ.data.code !== row.code) ? undefined : histQ.data;
  const latest = day || market.data?.date || null;
  const items = useMemo(() => autoItems({ row, hist, market: market.data, latest }), [row, hist, market.data, latest]);
  const draft = useMemo(() => reasonDraft(row, items), [row, items]);
  useEffect(() => { if (!reasonEdited) setF((x) => ({ ...x, reason: draft })); }, [draft, reasonEdited]);

  const env = market.data ? envInfo(market.data.env?.lights) : null;
  const facts = row ? impulseFacts(row, env) : [];
  const showFacts = !!row && facts.length > 0 && !factsDone;
  // 資金燈號還沒載入時不先畫表單（載入後才知道要不要先顯示事實頁，避免畫面跳換）
  const waiting = !!row && market.loading && !factsDone;
  const lights = market.data?.env?.lights ?? [];
  const calc = checklistCalc({ hasStock: !!row, ...f }, portfolio, fmtMoney);
  const { entry, stop, target, rr, shares } = calc;
  const valid = calc.blocker === null;
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  const eff = (k: AutoKey) => effectiveOf(items, overrides, k);
  const setOverride = (k: AutoKey, v: string | undefined) => setOverrides((o) => {
    const n = { ...o };
    if (v === undefined || v === items[k].value) delete n[k];
    else n[k] = v;
    return n;
  });
  const refs = stopRefs(row, hist, entry);
  const summaryLine = topSummary(items, overrides);

  async function save() {
    if (!row || !valid || entry === null) return;
    const snapshot = buildSnapshot(items, overrides, latest, new Date().toISOString());
    await saveTrade({
      id: uid(), code: row.code, name: row.name, status: 'open', openedAt: todayTpe(), entry, shares,
      // 停損、目標選填：未填存 0（hasStop＝false → 持股列表「未設停損」）
      stop: stop ?? 0, target: target ?? 0,
      reasonType: eff('reasonType') || '其他',
      checklist: { market: eff('market'), trend: eff('trend'), revenue: eff('revenue'), valuation: eff('valuation'), reason: f.reason.trim() },
      checklistSnapshot: snapshot,
      checklistDone: snapshotDone(snapshot),
    });
    await logActivity('checklist_done', day, { outcome: 'open', code: row.code });
    onClose();
  }
  async function skip() {
    if (!row) return;
    await logActivity('checklist_done', day, { outcome: 'skip', code: row.code, reason: f.reason.trim() });
    onClose();
  }

  // #10：每個欄位用 <label for> 對應題目（原本 select 包在 label 裡另加 aria-label，iOS VoiceOver 會唸成目前的值）
  const num = (k: 'entry' | 'stop' | 'target' | 'shares', label: string, value: string, mode: 'decimal' | 'numeric' = 'decimal', note?: string | null, children?: ComponentChildren) => (
    <div class="field">
      <label for={`ck-${k}`}>{label}</label>
      <input id={`ck-${k}`} class="input" type="number" inputMode={mode} value={value} onInput={set(k)} aria-describedby={note ? `ck-${k}-note` : undefined} />
      {children}
      {note ? <p id={`ck-${k}-note`} class="ck-note ui-foot ui-muted">{note}</p> : null}
    </div>
  );

  // ---- 說明頁（面板內推入）
  let detailNode: ComponentChildren | null = null;
  let detailTitle = '';
  if (row && detail?.kind === 'fact') {
    const l = lights.find((x) => x.id === detail.id);
    const doc = l ? lightDoc(l, latest) : stockFactDoc(detail.id, row, hist, latest);
    detailTitle = doc.title;
    detailNode = <FactDetail doc={doc} />;
  } else if (row && detail?.kind === 'item') {
    const k = detail.key;
    detailTitle = AUTO_LABEL[k].replace(/^\d\. /, '');
    detailNode = <ItemDetail k={k} item={items[k]} doc={itemDoc(k, row)} override={overrides[k]} onSet={(v) => setOverride(k, v)} />;
  }

  const root = (
    <>
      {!row ? <StockSearch rows={rows} onPick={setRow} autoFocus /> : (
        <div class="row between"><span class="body w6">{row.name} <span class="caption muted">{row.code}</span></span>{!preset ? <button class="btn small" onClick={() => setRow(undefined)}>更換</button> : null}</div>
      )}
      {waiting ? <div class="ck" style={{ marginTop: 'var(--s-4)' }}><Skeleton lines={5} testid="checklist-loading" /></div> : row && showFacts ? (
        <FactsView summary={envSummary(lights)} envRows={lights.map((l) => lightRow(l, latest))} stockRows={stockFactRows(row, latest)} stockName={row.name}
          onOpen={(id) => setDetail({ kind: 'fact', id })} onContinue={() => setFactsDone(true)} onCancel={onClose} />
      ) : row ? (
        <div class="ck" data-testid="checklist-form">
          {summaryLine ? <p class="ck-summary ui-foot" role="note" data-testid="ck-summary">{summaryLine}</p> : null}
          <Section title="進場前現況" aside="自動帶出・點列看依據">
            <ItemRows items={items} overrides={overrides} onOpen={(key) => setDetail({ kind: 'item', key })} onSet={setOverride} />
          </Section>
          <div class="field">
            <label for="ck-reason">{FIELD_LABEL.reason}</label>
            <textarea id="ck-reason" class="input" rows={3} value={f.reason} aria-describedby="ck-reason-note"
              onInput={(e) => { setReasonEdited(true); setF({ ...f, reason: (e.target as HTMLTextAreaElement).value }); }} />
            <p id="ck-reason-note" class="ck-note ui-foot ui-muted">依目前觸發的訊號與 1–4 帶入的事實草稿，可直接修改或清空。</p>
          </div>
          {num('entry', FIELD_LABEL.entry, f.entry)}
          {num('stop', FIELD_LABEL.stop, f.stop, 'decimal', calc.stopNote, refs.length ? (
            <div class="chips ck-ref" role="group" aria-label="停損參考價（點一下填入）">
              {refs.map((r) => (
                <button key={r.id} type="button" class="chip" aria-pressed={priceOf(f.stop) === r.price} onClick={() => setF({ ...f, stop: String(r.price) })} data-testid={`stop-ref-${r.id}`}>
                  {r.label} {fmtPrice(r.price)}
                </button>
              ))}
            </div>
          ) : null)}
          {num('target', FIELD_LABEL.target, f.target, 'decimal', calc.targetNote)}
          <div class="card caption" data-testid="checklist-calc">
            <div>風險報酬比：<b class={rr !== null && rr < MIN_RR ? 'risk' : ''} data-testid="checklist-rr">{calc.rrText}</b>
              {rr !== null && rr < MIN_RR ? <span class="tag risk" style={{ marginLeft: 'var(--s-2)' }}>低於 1:{MIN_RR}</span> : null}</div>
            <div data-testid="checklist-size">建議部位：{calc.sizeText}</div>
            <div>觸及停損的虧損：{calc.lossIfStopped === null ? (stop === null ? '—（未填停損，無法計算）' : '—（停損不低於進場價，無法計算）') : `約 ${fmtMoney(calc.lossIfStopped)}`}</div>
            {calc.size && calc.size.shares === 0 ? <div class="risk">風險上限換算的股數小於 1 張：可改用零股、放寬停損或自行輸入股數</div> : null}
          </div>
          {num('shares', FIELD_LABEL.shares, f.shares || String(calc.size?.shares ?? ''), 'numeric', calc.size ? '預設為建議部位，可自行修改' : '未填停損時沒有建議部位，請自行輸入')}
          <button class="btn primary block" disabled={!valid} onClick={save} data-testid="checklist-submit">{valid ? '加入持倉' : calc.blocker}</button>
          <button class="btn block" style={{ marginTop: 'var(--s-2)' }} disabled={!calc.qualitative} onClick={skip} data-testid="checklist-skip">檢查完，決定先不進場</button>
        </div>
      ) : null}
    </>
  );

  return (
    <Sheet open={open} onClose={onClose} title={detailNode ? detailTitle : '新增持倉前檢查表'} detent="full"
      back={detailNode ? { label: showFacts ? '事實' : '檢查表', onBack: () => setDetail(null) } : undefined}>
      <NavStack root={root} detail={detailNode} onPop={() => setDetail(null)} />
    </Sheet>
  );
}

export function CloseSheet({ trade, onClose, costs, price, day }: { trade: Trade | null; onClose: () => void; costs: CostSettings; price: number | null; day: string }) {
  const [exit, setExit] = useState('');
  const [date, setDate] = useState(todayTpe());
  const [review, setReview] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [reason, setReason] = useState<ExitReason | ''>('');
  // D-01：持有期間的分割、減資、除權息 → 進場價與股數換算到平倉價的基準（使用者原始輸入不變，另存 adjFactor）
  const hist = useAsync(() => (trade ? loadStock(trade.code).catch(() => null) : Promise.resolve(null)), [trade?.code]);
  const adj = trade ? adjustTrade(trade, eventsFor(null, hist.data), date) : null;
  useEffect(() => { if (trade) { setExit(String(price ?? trade.entry)); setTags([]); setReview(''); setReason(''); setDate(todayTpe()); } }, [trade?.id]);
  const px = Number(exit);
  const rt = trade && adj && px > 0 ? roundTrip(adj.entry, px, trade.shares / adj.factor, trade.code, costs) : null;
  async function done() {
    if (!trade || !(px > 0) || !reason) return;
    const extra = adj && adj.factor !== 1 ? { adjFactor: adj.factor, adjNote: adj.notes.join('、') || undefined } : {};
    await saveTrade({ ...trade, status: 'closed', closedAt: date, exit: px, exitReason: reason, review, errorTags: tags, fees: rt?.costs ?? 0, ...extra });
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
          <div class="field">
            <label for="close-reason">出場原因</label>
            <select id="close-reason" class="select" value={reason} onChange={(e) => setReason((e.target as HTMLSelectElement).value as ExitReason | '')} data-testid="close-reason">
              <option value="">請選擇</option>
              {(Object.keys(EXIT_REASON_LABEL) as ExitReason[]).map((k) => <option key={k} value={k}>{EXIT_REASON_LABEL[k]}</option>)}
            </select>
          </div>
          <label class="field"><span>檢討（平倉後 3 個交易日內完成；可稍後在日誌補寫）</span><textarea class="input" rows={3} value={review} onInput={(e) => setReview((e.target as HTMLTextAreaElement).value)} /></label>
          <div class="chips wrap" role="group" aria-label="錯誤標籤" style={{ flexWrap: 'wrap' }}>
            {ERROR_TAGS.map((t) => (
              <button key={t} class="chip" aria-pressed={tags.includes(t)} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>{t}</button>
            ))}
          </div>
          <button class="btn primary block" style={{ marginTop: 'var(--s-4)' }} disabled={!(px > 0) || !reason} onClick={done}>{reason ? '確認平倉' : '請選擇出場原因'}</button>
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
          <p class="caption muted">{trade.openedAt} → {trade.closedAt}・{fmtNum(trade.entry)} → {fmtNum(trade.exit ?? null)}（理由：{trade.reasonType || '未分類'}{trade.checklist.reason?.trim() ? `，${trade.checklist.reason.trim()}` : ''}）</p>
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
