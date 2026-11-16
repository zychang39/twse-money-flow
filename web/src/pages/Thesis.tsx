/**
 * 研究筆記（2026-11；DECISIONS #470 的 M3）：
 * - #/discipline/thesis：全部筆記的清單（需要回頭看的排在最上面）；空狀態說明這是什麼、怎麼開始。
 * - #/discipline/thesis/:code：一檔一份的編輯頁。每一塊＝一個問題＋輸入；全部選填、自動儲存，沒有「完成」按鈕。
 *   我的判斷 → 什麼事會驗證（可從這檔的近期事件挑）→ 什麼情況代表我錯了（選股欄位的條件；已觸發才用琥珀色）→
 *   我的證據（三個標籤；帶入的事實自動貼好）→ 競爭優勢自問（只記錄、不計分）。
 * 計算全部在 lib/thesis.ts（純函式）；這裡只有畫面與存檔。
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { Loading } from '../components/DataStatus';
import { StockSearch } from '../components/StockSearch';
import { Button, Card, EmptyRow, List, PageTitle, Row, Section, Tag } from '../components/ui';
import { Conclusion, Interp } from '../components/kit';
import { IconChevronDown } from '../components/Icons';
import { ReminderRow, ThesisReminders, useCalendar } from '../components/ThesisReminders';
import { useAsync, useDb } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { loadStock } from '../data/api';
import type { StockHistory, StockRow } from '../data/types';
import { deleteThesis, getThesis, listTheses, logActivityKey, saveThesis, type Thesis, type ThesisBreaker, type ThesisEvidence } from '../db/db';
import type { TradingCalendar } from '../lib/tradingCalendar';
import { qualityConfig } from '../lib/config';
import { todayTpe } from '../lib/dates';
import { md } from '../lib/format';
import { upcomingEvents } from '../lib/stockFacts';
import { navigate } from '../router';
import {
  BREAKER_OPS, acknowledge, breakerFields, breakerStatus, completeness, defaultBreaker, dueItems, emptyThesis, eventStatus, evidenceAsk, evidenceDrafts,
  moatCount, normThesis, opWord, sameKindNudge, sortEvents, thesisSub, triggeredBreakers,
} from '../lib/thesis';
import '../styles/thesis.css';

const SAVE_MS = 600;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' });

// ================================================================== 清單

function Index() {
  const theses = useDb(listTheses);
  const summary = useScoredSummary();
  const [adding, setAdding] = useState(false);
  const byCode = summary.data?.byCode;
  if (!theses) return <div class="page"><TopBar back="/discipline" /><PageTitle title="研究筆記" /><Loading /></div>;
  const notes = theses.map(normThesis);
  const picker = (
    <Card testid="thesis-picker">
      <StockSearch rows={summary.data?.rows ?? []} onPick={(r) => navigate(`/discipline/thesis/${r.code}`)} placeholder="輸入代號或名稱，開始寫一份" />
    </Card>
  );
  return (
    <div class="page th-page">
      <TopBar back="/discipline" />
      <PageTitle title="研究筆記" sub={notes.length ? `${notes.length} 份・一檔一份` : '一檔一份・全部選填'} />
      {!notes.length ? (
        <Section title="這是什麼" testid="thesis-empty">
          <Card>
            <div class="ui-prose">
              <p>把「我為什麼看這家公司」寫成四件事：我的判斷、市場可能看錯什麼、什麼事會驗證、什麼情況代表我錯了。</p>
              <p>筆記跟著股票，不跟著某一筆交易，所以研究過但沒有進場也留得下來。驗證事件快到、或你寫的推翻條件成立時，簡報的「我的」分段會提醒你回來看。</p>
            </div>
          </Card>
          {picker}
        </Section>
      ) : (
        <>
          <ThesisReminders byCode={byCode} testid="thesis-due" />
          <Section title="全部筆記" testid="thesis-list">
            <List tags chev>
              {notes.map((t) => {
                const broken = triggeredBreakers(t, byCode?.get(t.code)).length;
                return (
                  <Row key={t.code} label={<>{t.name}<span class="ui-muted"> {t.code}</span></>} sub={thesisSub(t)} subWide
                    tag={broken ? <Tag tone="risk">已觸發</Tag> : null} href={`#/discipline/thesis/${t.code}`} testid={`thesis-row-${t.code}`} />
                );
              })}
            </List>
            {adding ? picker : <Button block onClick={() => setAdding(true)} testid="thesis-add">新增一份</Button>}
          </Section>
        </>
      )}
    </div>
  );
}

// ================================================================== 編輯頁

/** 讀取＋自動儲存：第一次有內容才建立紀錄（不留空白筆記）；停止輸入 0.6 秒後存檔，離開頁面時立即存。 */
function useNote(code: string, name: string) {
  const [t, setT] = useState<Thesis | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const state = useRef<{ cur: Thesis | null; exists: boolean; dirty: boolean; timer: number }>({ cur: null, exists: false, dirty: false, timer: 0 });
  useEffect(() => {
    let alive = true;
    state.current = { cur: null, exists: false, dirty: false, timer: 0 };
    setT(null);
    setSavedAt(null);
    getThesis(code).then((found) => {
      if (!alive) return;
      const init = found ? normThesis(found) : emptyThesis(code, name);
      state.current.cur = init;
      state.current.exists = !!found;
      setT(init);
    }).catch(() => { if (alive) { state.current.cur = emptyThesis(code, name); setT(state.current.cur); } });
    return () => { alive = false; };
  }, [code]);

  async function flush() {
    const s = state.current;
    clearTimeout(s.timer);
    if (!s.dirty || !s.cur) return;
    if (!s.exists && completeness(s.cur).empty) return;
    s.dirty = false;
    const saved = await saveThesis(s.cur);
    s.exists = true;
    if (s.cur) s.cur = { ...s.cur, createdAt: saved.createdAt, updatedAt: saved.updatedAt };
    setSavedAt(saved.updatedAt);
    // 寫完第一版（五個部分都有內容）：只記一次（每檔），經驗值規則在 lib/ritual.xpLedger
    if (completeness(saved).complete) void logActivityKey('thesis_done', todayTpe(), saved.code, { code: saved.code }, false);
  }
  function update(patch: Partial<Thesis>) {
    const s = state.current;
    if (!s.cur) return;
    s.cur = { ...s.cur, ...patch };
    s.dirty = true;
    setT(s.cur);
    clearTimeout(s.timer);
    s.timer = window.setTimeout(() => { void flush(); }, SAVE_MS);
  }
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); void flush(); };
  }, [code]);
  // 名稱晚一點才載入時補上（不算使用者的修改）
  useEffect(() => { if (state.current.cur && name && state.current.cur.name !== name && state.current.cur.name === code) update({ name }); }, [name, t?.code]);
  /** 丟掉還沒存檔的修改（刪除筆記前用） */
  function discard() { clearTimeout(state.current.timer); state.current.dirty = false; }
  return { t, update, flush, discard, savedAt, exists: () => state.current.exists };
}

const Toggle = () => <span class="ui-row-toggle" aria-hidden="true"><IconChevronDown /></span>;

function Events({ t, update, hist, today, cal }: { t: Thesis; update: (p: Partial<Thesis>) => void; hist: StockHistory | null | undefined; today: string; cal: TradingCalendar }) {
  const [open, setOpen] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState({ date: '', label: '' });
  const events = sortEvents(t.events);
  const has = (date: string, label: string) => t.events.some((e) => e.date === date && e.label === label);
  // 從這檔的近期事件挑（月營收公布期限、除權息、法說會、融券回補）：已加入的不再列
  const picks = hist ? upcomingEvents(hist, today, cal).map((e) => ({ date: e.date, label: e.kind === 'revenue' ? e.text.replace('公布期限', '公布') : e.label })).filter((e) => e.date >= today && !has(e.date, e.label)).slice(0, 4) : [];
  const add = (date: string, label: string, source: 'calendar' | 'custom') => { if (date && label.trim() && !has(date, label.trim())) update({ events: sortEvents([...t.events, { date, label: label.trim(), source }]) }); };
  const next = events.find((e) => eventStatus(e, today, cal).state !== 'past');
  return (
    <Section title="什麼事會驗證" testid="th-events"
      info={<p>接下來哪一件事會告訴你判斷對不對？日期到了（3 個交易日內）簡報會提醒。可以從這檔股票的近期事件挑，也可以自己輸入。「還有幾天」用交易日算，休市日不算。</p>}>
      <Conclusion>{next ? `下一件：${next.label}，${md(next.date)}` : events.length ? '事件都已經過了' : '還沒有設定'}</Conclusion>
      {events.length ? (
        <List>
          {events.map((e) => {
            const st = eventStatus(e, today, cal);
            const k = `${e.date}${e.label}`;
            return (
              <div key={k} class="th-item">
                <Row label={e.label} sub={st.text} value={md(e.date)} onClick={() => setOpen(open === k ? null : k)} noChev expanded={open === k} testid="th-event" />
                {open === k ? <div class="th-inline"><button type="button" class="btn small" onClick={() => { update({ events: t.events.filter((x) => x !== e) }); setOpen(null); }}>移除這個事件</button></div> : null}
              </div>
            );
          })}
        </List>
      ) : null}
      <div class="chips th-chips" role="group" aria-label="加入驗證事件">
        {picks.map((p) => (
          <button key={p.date + p.label} type="button" class="chip" onClick={() => add(p.date, p.label, 'calendar')} data-testid="th-event-pick">＋ {md(p.date)} {p.label}</button>
        ))}
        <button type="button" class="chip" aria-pressed={custom} onClick={() => setCustom(!custom)} data-testid="th-event-custom">自己輸入</button>
      </div>
      {custom ? (
        <Card class="th-form">
          <div class="field"><label for="th-ev-label">事件</label><input id="th-ev-label" class="input" value={draft.label} placeholder="例：第 4 季法說會" onInput={(e) => setDraft({ ...draft, label: (e.target as HTMLInputElement).value })} /></div>
          <div class="field"><label for="th-ev-date">日期</label><input id="th-ev-date" class="input" type="date" value={draft.date} onInput={(e) => setDraft({ ...draft, date: (e.target as HTMLInputElement).value })} /></div>
          <Button block disabled={!draft.date || !draft.label.trim()} onClick={() => { add(draft.date, draft.label, 'custom'); setDraft({ date: '', label: '' }); setCustom(false); }} testid="th-event-add">加入</Button>
        </Card>
      ) : null}
    </Section>
  );
}

function Breakers({ t, update, row }: { t: Thesis; update: (p: Partial<Thesis>) => void; row: StockRow | undefined }) {
  const [open, setOpen] = useState<number | null>(null);
  const fields = useMemo(breakerFields, []);
  const groups = [...new Set(fields.map((f) => f.group))];
  const set = (i: number, b: ThesisBreaker) => update({ breakers: t.breakers.map((x, j) => (j === i ? b : x)) });
  const hit = triggeredBreakers(t, row).length;
  return (
    <Section title="什麼情況代表我錯了" testid="th-breakers"
      info={<p>先寫好「看到什麼數字，就代表原本的判斷不成立」。條件從選股欄位裡挑（生意體質、基本面、估值），每天用最新資料比對；條件成立時這裡與簡報會標示「已觸發」。欄位還沒有資料時顯示「資料累積中」，不算觸發。</p>}>
      <Conclusion>{!t.breakers.length ? '還沒有設定' : hit ? `${hit} 個條件已觸發` : `${t.breakers.length} 個條件都沒有觸發`}</Conclusion>
      <List tags>
        {t.breakers.map((b, i) => {
          const st = breakerStatus(b, row);
          const unit = fields.find((f) => f.id === b.field)?.unit ?? '';
          return (
            <div key={i} class="th-item">
              <Row label={st.label} sub={st.currentText} onClick={() => setOpen(open === i ? null : i)} noChev expanded={open === i} testid="th-breaker"
                tag={st.triggered ? <Tag tone="risk">已觸發</Tag> : <Tag>{st.known ? '未觸發' : '累積中'}</Tag>} />
              {open === i ? (
                <div class="th-inline th-brk">
                  <select class="select" aria-label="欄位" value={b.field} onChange={(e) => set(i, { ...b, field: (e.target as HTMLSelectElement).value })}>
                    {groups.map((g) => <optgroup key={g} label={g}>{fields.filter((f) => f.group === g).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</optgroup>)}
                  </select>
                  <div class="th-brk-v">
                    <select class="select" aria-label="比較" value={b.op} onChange={(e) => set(i, { ...b, op: (e.target as HTMLSelectElement).value as ThesisBreaker['op'] })}>
                      {[...new Set([...BREAKER_OPS, b.op])].filter((o) => o !== 'between').map((o) => <option key={o} value={o}>{opWord(o)}</option>)}
                    </select>
                    <input class="input" type="number" inputMode="decimal" aria-label={`數值${unit ? `（${unit}）` : ''}`} value={Array.isArray(b.value) ? b.value[0] : b.value}
                      onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v)) set(i, { ...b, value: v }); }} />
                    <span class="ui-foot ui-muted">{unit}</span>
                  </div>
                  <button type="button" class="btn small" onClick={() => { update({ breakers: t.breakers.filter((_, j) => j !== i) }); setOpen(null); }}>移除這個條件</button>
                </div>
              ) : null}
            </div>
          );
        })}
        <Row label="新增條件" onClick={() => { update({ breakers: [...t.breakers, defaultBreaker(row)] }); setOpen(t.breakers.length); }} testid="th-breaker-add" />
      </List>
    </Section>
  );
}

const EV = qualityConfig.evidence;
const PICKS: { key: 'source' | 'directness' | 'timing'; label: string }[] = [
  { key: 'source', label: '誰說的' }, { key: 'directness', label: '直接或代理' }, { key: 'timing', label: '領先或落後' },
];

function Evidence({ t, update, row, hist }: { t: Thesis; update: (p: Partial<Thesis>) => void; row: StockRow | undefined; hist: StockHistory | null | undefined }) {
  const set = (i: number, e: ThesisEvidence) => update({ evidence: t.evidence.map((x, j) => (j === i ? e : x)) });
  const drafts = evidenceDrafts(row, hist).filter((d) => !t.evidence.some((e) => e.text === d.text));
  const n = t.evidence.filter((e) => e.text.trim()).length;
  const nudge = sameKindNudge(t.evidence);
  return (
    <Section title="我的證據" testid="th-evidence"
      info={<p>每條證據貼三個標籤：誰說的、它是直接證據還是代理變數、是領先還是落後指標。從這檔股票帶入的數字會自動貼好。標籤只用來提醒你想一下，不評分、不擋存檔。</p>}>
      <Conclusion>{n ? `${n} 條證據` : '還沒有寫'}</Conclusion>
      {t.evidence.map((e, i) => {
        const ask = e.text.trim() ? evidenceAsk(e) : null;
        return (
          <Card key={i} class="th-ev" testid="th-ev">
            <textarea class="input" rows={2} aria-label={`證據 ${i + 1}`} placeholder="看到什麼事實？" value={e.text} onInput={(x) => set(i, { ...e, text: (x.target as HTMLTextAreaElement).value })} />
            <div class="th-picks">
              {PICKS.map((p) => (
                <select key={p.key} class="select th-pick" aria-label={p.label} value={e[p.key]} onChange={(x) => set(i, { ...e, [p.key]: (x.target as HTMLSelectElement).value })}>
                  <option value="">{p.label}</option>
                  {EV[p.key].map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              ))}
            </div>
            {ask ? <p class="th-ask ui-foot ui-muted" data-testid="th-ask">{ask}</p> : null}
            <button type="button" class="btn small th-remove" onClick={() => update({ evidence: t.evidence.filter((_, j) => j !== i) })}>移除</button>
          </Card>
        );
      })}
      {nudge ? <Interp testid="th-nudge">{nudge}</Interp> : null}
      <div class="chips th-chips" role="group" aria-label="加入證據">
        {drafts.map((d) => (
          <button key={d.id} type="button" class="chip" data-testid="th-ev-draft"
            onClick={() => update({ evidence: [...t.evidence, { text: d.text, source: d.source, directness: d.directness, timing: d.timing }] })}>＋ {d.label}</button>
        ))}
        <button type="button" class="chip" onClick={() => update({ evidence: [...t.evidence, { text: '', source: '', directness: '', timing: '' }] })} data-testid="th-ev-add">＋ 自己寫一條</button>
      </div>
    </Section>
  );
}

function Moat({ t, update }: { t: Thesis; update: (p: Partial<Thesis>) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Section title="競爭優勢自問" testid="th-moat"
      info={<p>高報酬能維持多久，要看競爭者為什麼拿不走。這些問題沒有標準答案，公開資料也量不出來，所以只記錄你的回答，不計分。想到再寫，可以留白。</p>}>
      <List tags>
        {qualityConfig.moat.map((g) => {
          const c = moatCount(t, g.id);
          const ans = t.moat[g.id] ?? [];
          return (
            <div key={g.id} class="th-item">
              <Row label={g.name} sub={`${c.total} 題・${c.answered ? `已答 ${c.answered}` : '還沒有回答'}`} onClick={() => setOpen(open === g.id ? null : g.id)} noChev expanded={open === g.id}
                tag={<Toggle />} testid={`th-moat-${g.id}`} />
              {open === g.id ? (
                <div class="th-inline">
                  {g.questions.map((q, i) => (
                    <div key={q} class="field">
                      <label for={`th-${g.id}-${i}`}>{q}</label>
                      <textarea id={`th-${g.id}-${i}`} class="input" rows={2} value={ans[i] ?? ''}
                        onInput={(e) => { const next = g.questions.map((_, j) => (j === i ? (e.target as HTMLTextAreaElement).value : ans[j] ?? '')); update({ moat: { ...t.moat, [g.id]: next } }); }} />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </List>
    </Section>
  );
}

function Editor({ code }: { code: string }) {
  const summary = useScoredSummary();
  const row = summary.data?.byCode.get(code);
  const histQ = useAsync(() => loadStock(code).catch(() => null), [code]);
  const hist = histQ.loading ? undefined : histQ.data;
  const cal = useCalendar();
  const today = todayTpe();
  const { t, update, flush, discard, savedAt, exists } = useNote(code, row?.name ?? code);
  if (!t) return <div class="page"><TopBar back="/discipline/thesis" /><PageTitle title="研究筆記" /><Loading /></div>;
  const due = dueItems(t, row, today, cal);
  const c = completeness(t);
  async function reviewed() {
    const next = acknowledge(t as Thesis, due, new Date().toISOString());
    update({ acks: next.acks, reviewedAt: next.reviewedAt });
    await flush();
    // 回頭看筆記：每檔每天記一次（經驗值規則在 lib/ritual.xpLedger）
    await logActivityKey('thesis_review', today, code, { code }, true);
  }
  async function remove() {
    if (!confirm(`刪除「${t?.name ?? code}」的研究筆記？`)) return;
    discard();
    await deleteThesis(code);
    navigate('/discipline/thesis', true);
  }
  return (
    <div class="page th-page" data-testid="thesis-editor">
      <TopBar back="/discipline/thesis" />
      <PageTitle title={t.name} sub={<span role="status">{code}・研究筆記・{savedAt ? `已儲存 ${hhmm(savedAt)}` : '自動儲存'}</span>} />

      {due.length ? (
        <Section title="需要回頭看" testid="th-due">
          <List tags>{due.map((r) => <ReminderRow key={r.key} r={r} showName={false} />)}</List>
          <Button block onClick={reviewed} testid="th-reviewed">已回頭看過</Button>
        </Section>
      ) : null}

      <Section title="我的判斷" aside={c.complete ? undefined : `已寫 ${c.done}/${c.total}`} testid="th-view"
        info={<p>短期看的是「市場可能看錯什麼」以及「接下來什麼事會證明它看錯」；長期看的是公司本身的價值有沒有變。先用一兩句話寫下來，之後才有東西可以對照。全部選填。</p>}>
        <Card class="th-form">
          <div class="field">
            <label for="th-view-in">一句話：我認為這家公司會怎樣？</label>
            <textarea id="th-view-in" class="input" rows={2} value={t.view} placeholder="例：擴產之後，報酬率還守得住" onInput={(e) => update({ view: (e.target as HTMLTextAreaElement).value })} data-testid="th-view-in" />
          </div>
          <div class="field">
            <label for="th-gap-in">市場可能看錯什麼？</label>
            <textarea id="th-gap-in" class="input" rows={2} value={t.gap} placeholder="例：市場擔心新產能的報酬被稀釋" onInput={(e) => update({ gap: (e.target as HTMLTextAreaElement).value })} data-testid="th-gap-in" />
          </div>
        </Card>
      </Section>

      <Events t={t} update={update} hist={hist} today={today} cal={cal} />
      <Breakers t={t} update={update} row={row} />
      <Evidence t={t} update={update} row={row} hist={hist} />
      <Moat t={t} update={update} />

      <div class="ui-sec">
        <List chev>
          <Row label="看個股頁" sub={row ? undefined : '找不到這檔股票的資料'} href={`#/stock/${code}`} testid="th-to-stock" />
        </List>
        {exists() || !c.empty ? <button type="button" class="btn block th-delete" onClick={remove} data-testid="th-delete">刪除這份筆記</button> : null}
      </div>
      {!row && !summary.loading ? <List><EmptyRow>目前的資料裡沒有 {code}，推翻條件暫時無法比對。</EmptyRow></List> : null}
    </div>
  );
}

export default function ThesisPage({ code }: { code?: string }) {
  return code ? <Editor code={code} /> : <Index />;
}
