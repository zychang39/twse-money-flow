/**
 * 研究筆記的純函式（2026-11；DECISIONS #470 的 M3）。
 * 一檔股票一份筆記：一句話判斷、市場可能看錯什麼、驗證事件、推翻條件、證據（三個標籤）、競爭優勢自問。
 * - 推翻條件用選股條件的格式（lib/screener.testCondition）：條件成立＝已觸發（真正的風險，介面用琥珀色）。
 *   欄位還沒有資料時不算觸發，顯示「資料累積中」。
 * - 驗證事件的「還有幾天」一律用交易日曆算（休市日不算），不是日曆天。
 * - 提醒只在有事時出現：推翻條件已觸發、或驗證事件在 REMIND_TRADING_DAYS 個交易日內；按「已回頭看過」後同一件事不再提醒（acks）。
 * - 全部欄位選填、不擋存檔；這裡的提問只提醒，不評分。
 */
import type { StockHistory, StockRow } from '../data/types';
import type { ChecklistSnapshotItem, Thesis, ThesisBreaker, ThesisEvent, ThesisEvidence, ThesisVerdict, Trade } from '../db/db';
import type { RevenueRow } from './fundamentals';
import type { TradingCalendar } from './tradingCalendar';
import { qualityConfig, screenerConfig, type BizKind, type Condition, type EvidenceTag } from './config';
import { describeCondition, testCondition } from './screener';
import { formatUnit, md } from './format';
import { tradePnl } from './sizing';

/** 驗證事件在這麼多個交易日內（含當天）才提醒 */
export const REMIND_TRADING_DAYS = 3;
/** 推翻條件可以選的欄位：選股欄位裡與基本面、估值、生意體質有關的（籌碼與動能每天變動，不適合當「論點錯了」的條件） */
const BREAKER_GROUPS = ['生意體質', '基本面', '估值'];
/** 編輯時只給「低於／高於」兩種（少一個選擇）；舊資料或匯入的其他比較照樣判定 */
export const BREAKER_OPS: Condition['op'][] = ['<', '>'];

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const fieldLabel = (f: string) => screenerConfig.fields[f]?.label ?? f;
const fieldUnit = (f: string) => screenerConfig.fields[f]?.unit ?? '';

export function emptyThesis(code: string, name: string): Thesis {
  return { code, name, view: '', gap: '', events: [], breakers: [], evidence: [], moat: {}, createdAt: '', updatedAt: '' };
}

/** 舊資料或匯入的資料缺欄位時補齊（不改已有的值） */
export function normThesis(t: Partial<Thesis> & { code: string }): Thesis {
  return {
    ...emptyThesis(t.code, t.name ?? t.code),
    ...t,
    events: Array.isArray(t.events) ? t.events : [],
    breakers: Array.isArray(t.breakers) ? t.breakers : [],
    evidence: Array.isArray(t.evidence) ? t.evidence : [],
    moat: t.moat && typeof t.moat === 'object' ? t.moat : {},
  };
}

// ------------------------------------------------------------------ 推翻條件

export function breakerFields(): { id: string; label: string; unit: string; group: string }[] {
  return Object.entries(screenerConfig.fields)
    .filter(([, f]) => BREAKER_GROUPS.includes(f.group))
    .map(([id, f]) => ({ id, label: f.label, unit: f.unit, group: f.group }))
    .sort((a, b) => BREAKER_GROUPS.indexOf(a.group) - BREAKER_GROUPS.indexOf(b.group));
}

/** 新增推翻條件時的預設值：有 ROIC 時用「ROIC 低於門檻」，否則用「近 3 月營收年增率 < 0」 */
export function defaultBreaker(row: StockRow | undefined): ThesisBreaker {
  if (fin(row?.roic) && screenerConfig.fields.roic) return { field: 'roic', op: '<', value: qualityConfig.hurdle_pct };
  return { field: 'revenue_yoy_3m', op: '<', value: 0 };
}

const OP_WORD: Record<string, string> = { '<': '低於', '<=': '不高於', '>': '高於', '>=': '不低於', '==': '等於' };
export const opWord = (op: string): string => OP_WORD[op] ?? op;
const withUnit = (v: number, unit: string) => (unit === '%' ? `${v}%` : unit ? `${v} ${unit}` : String(v));

/** 「ROIC（簡式）低於 20%」：用白話寫出條件（between 沿用選股頁的寫法） */
export function breakerText(b: ThesisBreaker): string {
  if (b.op === 'between' || Array.isArray(b.value)) return describeCondition(b as Condition, fieldLabel, fieldUnit).trim();
  return `${fieldLabel(b.field)}${opWord(b.op)} ${withUnit(b.value, fieldUnit(b.field))}`;
}

export interface BreakerStatus {
  /** 欄位目前的數值；沒有資料為 null */
  current: number | null;
  /** 有資料才能判定；沒有資料時 triggered 一定是 false */
  known: boolean;
  triggered: boolean;
  /** 「現在 31.3%」／「資料累積中」 */
  currentText: string;
  label: string;
}

export function breakerStatus(b: ThesisBreaker, row: StockRow | undefined): BreakerStatus {
  const v = row?.[b.field];
  const known = fin(v);
  const unit = fieldUnit(b.field);
  return {
    current: known ? v : null,
    known,
    triggered: known && !!row && testCondition(row, b as Condition),
    currentText: known ? `現在 ${formatUnit(v, unit || undefined)}` : '資料累積中',
    label: breakerText(b),
  };
}

export const triggeredBreakers = (t: Thesis, row: StockRow | undefined): ThesisBreaker[] => t.breakers.filter((b) => breakerStatus(b, row).triggered);

// ------------------------------------------------------------------ 驗證事件

export interface EventStatus {
  /** past＝已過；today＝今天；soon＝REMIND_TRADING_DAYS 個交易日內；later＝更久以後 */
  state: 'past' | 'today' | 'soon' | 'later';
  /** 距離事件還有幾個交易日（今天＝0；已過為負的日曆天概念不需要，固定 -1） */
  tradingDays: number;
  /** 「今天」「2 個交易日後」「已過」 */
  text: string;
}

export function eventStatus(e: ThesisEvent, today: string, cal: TradingCalendar, within = REMIND_TRADING_DAYS): EventStatus {
  if (!e.date || e.date < today) return { state: 'past', tradingDays: -1, text: '已過' };
  if (e.date === today) return { state: 'today', tradingDays: 0, text: '今天' };
  const n = cal.tradingDaysBetween(today, e.date);
  // 事件落在連假裡（中間沒有交易日）：下一個交易日前就到了，視為 1 個交易日內
  const days = Math.max(1, n);
  return { state: days <= within ? 'soon' : 'later', tradingDays: days, text: `${days} 個交易日後` };
}

export const sortEvents = (events: ThesisEvent[]): ThesisEvent[] => [...events].sort((a, b) => a.date.localeCompare(b.date));

// ------------------------------------------------------------------ 證據與三個標籤

const TAGS = qualityConfig.evidence;
const tagOf = (list: EvidenceTag[], id: string) => list.find((x) => x.id === id);

export const tagName = (kind: 'source' | 'directness' | 'timing', id: string): string => tagOf(TAGS[kind], id)?.name ?? '';

/** 一條證據要顯示的一句提問（最多一句：來源 → 直接／代理 → 領先／落後 的順序取第一個有提問的） */
export function evidenceAsk(e: ThesisEvidence): string | null {
  return tagOf(TAGS.source, e.source)?.ask ?? tagOf(TAGS.directness, e.directness)?.ask ?? tagOf(TAGS.timing, e.timing)?.ask ?? null;
}

/** 至少兩條、而且三個標籤都一樣（或來源都一樣）→ 提醒找另一種證據；只提醒、不擋存檔 */
export function sameKindNudge(evidence: ThesisEvidence[]): string | null {
  const ev = evidence.filter((e) => e.text.trim() && (e.source || e.directness || e.timing));
  if (ev.length < 2) return null;
  const same = (k: keyof ThesisEvidence) => ev.every((e) => e[k] && e[k] === ev[0][k]);
  return same('source') || (same('directness') && same('timing')) ? TAGS.same_kind_ask : null;
}

export interface EvidenceDraft extends ThesisEvidence { id: string; label: string }

const signedPct = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`;

/**
 * 可以一鍵帶入的事實（自動貼好標籤）：最新月營收年增率、ROIC、單季毛利率＝官方資料・直接證據・落後指標；
 * 法人買賣超＝官方資料・代理變數（那是市場的看法，不能證明公司本身的報酬）。沒有資料的項目不列。
 */
export function evidenceDrafts(row: StockRow | undefined, hist?: StockHistory | null): EvidenceDraft[] {
  const out: EvidenceDraft[] = [];
  const official = { source: 'official', directness: 'direct', timing: 'lagging' };
  const rev = ((hist?.revenue as RevenueRow[] | undefined) ?? []).filter((r) => r.ym);
  const last = rev[rev.length - 1];
  if (last && fin(last.yoy)) {
    out.push({ id: 'revenue', label: '月營收', text: `${Number(last.ym.slice(5, 7))} 月營收年增 ${signedPct(last.yoy)}`, ...official });
  } else if (fin(row?.revenue_yoy_3m)) {
    out.push({ id: 'revenue', label: '月營收', text: `近 3 月營收年增 ${signedPct(row.revenue_yoy_3m as number)}`, ...official });
  }
  if (fin(row?.roic)) out.push({ id: 'roic', label: 'ROIC', text: `ROIC（簡式）${(row.roic as number).toFixed(1)}%，門檻 ${qualityConfig.hurdle_pct}%`, ...official });
  const quarters = (hist?.quarters as { period: string; gross_margin: number | null }[] | undefined) ?? [];
  const q = quarters[quarters.length - 1];
  if (q && fin(q.gross_margin)) out.push({ id: 'margin', label: '毛利率', text: `${q.period} 毛利率 ${q.gross_margin.toFixed(1)}%`, ...official });
  const f5 = row?.foreign_net_5d, t5 = row?.trust_net_5d;
  if (fin(f5) || fin(t5)) {
    const net = (fin(f5) ? f5 : 0) + (fin(t5) ? t5 : 0);
    const lots = Math.round(Math.abs(net)).toLocaleString('en-US');
    out.push({ id: 'insti', label: '法人', text: `外資與投信近 5 日合計${net >= 0 ? '買超' : '賣超'} ${lots} 張`, source: 'official', directness: 'proxy', timing: '' });
  }
  return out;
}

// ------------------------------------------------------------------ 完成度

export const PARTS = ['view', 'gap', 'events', 'breakers', 'evidence'] as const;
export type Part = typeof PARTS[number];
export const PART_LABEL: Record<Part, string> = { view: '判斷', gap: '市場可能看錯什麼', events: '驗證事件', breakers: '推翻條件', evidence: '證據' };

export function partsDone(t: Thesis): Record<Part, boolean> {
  return {
    view: !!t.view.trim(),
    gap: !!t.gap.trim(),
    events: t.events.some((e) => e.date && e.label.trim()),
    breakers: t.breakers.length > 0,
    evidence: t.evidence.some((e) => e.text.trim()),
  };
}

export interface Completeness { done: number; total: number; missing: Part[]; complete: boolean; empty: boolean }

/** 第一版寫完＝五個部分都有內容（競爭優勢自問另計，不影響） */
export function completeness(t: Thesis): Completeness {
  const d = partsDone(t);
  const missing = PARTS.filter((p) => !d[p]);
  return { done: PARTS.length - missing.length, total: PARTS.length, missing, complete: missing.length === 0, empty: missing.length === PARTS.length && moatAnswered(t).total === 0 };
}

/** 清單列的副資訊：「判斷・驗證事件 2・推翻條件 1」；空白時說明還沒寫什麼 */
export function thesisSub(t: Thesis): string {
  const c = completeness(t);
  if (c.complete) return `驗證事件 ${t.events.length}・推翻條件 ${t.breakers.length}・證據 ${t.evidence.filter((e) => e.text.trim()).length}`;
  return `已寫 ${c.done}/${c.total}・還沒寫：${c.missing.map((p) => PART_LABEL[p]).join('、')}`;
}

// ------------------------------------------------------------------ 競爭優勢自問

export function moatCount(t: Thesis, groupId: string): { answered: number; total: number } {
  const g = qualityConfig.moat.find((x) => x.id === groupId);
  const total = g?.questions.length ?? 0;
  const ans = t.moat[groupId] ?? [];
  return { answered: ans.slice(0, total).filter((a) => a?.trim()).length, total };
}

export function moatAnswered(t: Thesis): { total: number } {
  return { total: qualityConfig.moat.reduce((s, g) => s + moatCount(t, g.id).answered, 0) };
}

// ------------------------------------------------------------------ 提醒（簡報「我的」分段）

export const ackKey = {
  breaker: (b: ThesisBreaker) => `b:${b.field}${b.op}${Array.isArray(b.value) ? b.value.join('~') : b.value}`,
  event: (e: ThesisEvent) => `e:${e.date}:${e.label}`,
};

export interface Reminder {
  code: string;
  name: string;
  /** breaker＝推翻條件已觸發（風險，琥珀）；event＝驗證事件快到了（一般文字） */
  kind: 'breaker' | 'event';
  text: string;
  /** 右側數值欄：「今天」「2 個交易日後」；breaker 為現值 */
  when: string;
  date: string | null;
  key: string;
}

/** 一份筆記目前到期的事（還沒按過「已回頭看過」的）。 */
export function dueItems(t: Thesis, row: StockRow | undefined, today: string, cal: TradingCalendar): Reminder[] {
  const acks = new Set(t.acks ?? []);
  const out: Reminder[] = [];
  for (const b of t.breakers) {
    const st = breakerStatus(b, row);
    const key = ackKey.breaker(b);
    if (st.triggered && !acks.has(key)) out.push({ code: t.code, name: t.name, kind: 'breaker', text: `碰到推翻條件：${st.label}`, when: st.currentText.replace(/^現在 /, ''), date: null, key });
  }
  for (const e of sortEvents(t.events)) {
    const st = eventStatus(e, today, cal);
    const key = ackKey.event(e);
    if ((st.state === 'today' || st.state === 'soon') && !acks.has(key)) {
      out.push({ code: t.code, name: t.name, kind: 'event', text: `${e.label}・${md(e.date)}`, when: st.text, date: e.date, key });
    }
  }
  return out;
}

/** 全部筆記的提醒：推翻條件在前，其次事件由近到遠。沒有筆記或沒有到期的事 → 空陣列（畫面不顯示這一塊）。 */
export function reminders(theses: Thesis[], byCode: Map<string, StockRow> | undefined, today: string, cal: TradingCalendar): Reminder[] {
  const all = theses.flatMap((t) => dueItems(t, byCode?.get(t.code), today, cal));
  return all.sort((a, b) => (a.kind === b.kind ? (a.date ?? '').localeCompare(b.date ?? '') || a.code.localeCompare(b.code) : a.kind === 'breaker' ? -1 : 1));
}

/** 按下「已回頭看過」：把目前到期的事記成看過，更新 reviewedAt；順便清掉已經不存在的舊紀錄 */
export function acknowledge(t: Thesis, due: Reminder[], nowIso: string): Thesis {
  const live = new Set([...t.breakers.map(ackKey.breaker), ...t.events.map(ackKey.event)]);
  const acks = [...new Set([...(t.acks ?? []), ...due.map((d) => d.key)])].filter((k) => live.has(k));
  return { ...t, acks, reviewedAt: nowIso };
}

// ------------------------------------------------------------------ 檢查表：生意類型（只記錄，不算進完成）

export interface BizItem {
  /** 類型或高低（config/quality.yml labels 的鍵）；沒有資料為 null */
  kind: BizKind | null;
  /** 列上的標籤文字；沒有資料時是原因（資料累積中） */
  short: string;
  /** 依據數字（列右側）：「31.3%」；沒有 ROIC 時為空字串 */
  main: string;
  basis: string;
  missing: string | null;
}

const BIZ_KINDS: BizKind[] = ['steady', 'cyclical', 'fading', 'above', 'near', 'below', 'fin'];

/** summary 的 biz_type 與 roic → 檢查表「生意類型」一列。不留白：沒有資料時寫出原因。 */
export function bizItem(row: StockRow | undefined): BizItem {
  if (!row) return { kind: null, short: '資料不足', main: '', basis: '尚未選擇股票', missing: '尚未選擇股票' };
  const raw = row.biz_type;
  const kind = typeof raw === 'string' && (BIZ_KINDS as string[]).includes(raw) ? (raw as BizKind) : null;
  const roic = fin(row.roic) ? row.roic : null;
  if (kind === 'fin') return { kind, short: qualityConfig.labels.fin.name, main: '', basis: '金融業不算 ROIC，改看 ROE', missing: null };
  if (!kind) {
    const why = 'biz_type' in row ? '季財報的資產與營業利益欄位還沒有資料' : '這一版的資料還沒有生意體質欄位';
    return { kind: null, short: '資料累積中', main: roic === null ? '' : `${roic.toFixed(1)}%`, basis: why, missing: why };
  }
  const l = qualityConfig.labels[kind];
  return { kind, short: l.name, main: roic === null ? '' : `${roic.toFixed(1)}%`, basis: `ROIC（簡式）${roic === null ? '—' : `${roic.toFixed(1)}%`}・門檻 ${qualityConfig.hurdle_pct}%`, missing: null };
}

/** 存進檢查表快照的格式（同 1–5 的欄位；source 固定 auto） */
export function bizSnapshot(row: StockRow | undefined, dataDate: string | null): ChecklistSnapshotItem {
  const b = bizItem(row);
  return {
    source: 'auto', result: b.kind ? b.short : null, auto: b.kind ? b.short : null, basis: b.basis, main: b.main,
    numbers: { biz_type: b.kind, roic: fin(row?.roic) ? row.roic : null, hurdle: qualityConfig.hurdle_pct }, date: dataDate, stale: false,
  };
}

// ------------------------------------------------------------------ 平倉檢討：論點對了嗎 × 賺賠

export const VERDICTS: [ThesisVerdict, string][] = [['right', '對'], ['wrong', '錯'], ['unknown', '還不知道']];
export const VERDICT_LABEL: Record<ThesisVerdict, string> = { right: '對', wrong: '錯', unknown: '還不知道' };

export interface VerdictMatrix {
  /** [賺, 賠] × [論點對, 論點錯] 的筆數 */
  winRight: number; winWrong: number; lossRight: number; lossWrong: number;
  unknown: number;
  /** 回答過（含還不知道）的筆數 */
  answered: number;
}

/** 已平倉且回答過「原本的論點對了嗎」的交易：把結果和論點分開看（賺錢但論點錯、賠錢但論點對要分開記）。 */
export function verdictMatrix(trades: Trade[]): VerdictMatrix {
  const m: VerdictMatrix = { winRight: 0, winWrong: 0, lossRight: 0, lossWrong: 0, unknown: 0, answered: 0 };
  for (const t of trades) {
    if (t.status !== 'closed' || !t.thesisVerdict) continue;
    m.answered++;
    if (t.thesisVerdict === 'unknown') { m.unknown++; continue; }
    const win = tradePnl(t) > 0;
    if (t.thesisVerdict === 'right') { if (win) m.winRight++; else m.lossRight++; } else if (win) m.winWrong++; else m.lossWrong++;
  }
  return m;
}
