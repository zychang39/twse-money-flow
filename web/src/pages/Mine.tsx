/**
 * 我的股票：自選與持股合併在同一頁（分段控制「自選｜持股」，自選在左、預設）。
 * 自選股異動與持倉狀態（2026-10-03：頁首與說明套用共用元件）。
 * - 自選：使用者群組＋系統清單「熱門動能」（唯讀，依規則產生，非推薦；可一鍵複製成自己的群組或挑幾檔加入）。
 *   群組的建立、改名、刪除（可復原）與系統清單的顯示／隱藏在 components/WatchGroups（2026-11-15；DECISIONS #466）。
 * - 新用戶還沒有自選時顯示歡迎卡：主要動作「搜尋並加入股票」（與右上角「＋」同一個搜尋面板）；
 *   次要：加入範例自選（config/ui.yml，標示「範例」、可一鍵清除）或從熱門動能挑選。
 * - 持股：組合走勢（環境光與走勢線同一個期間、同一個顏色）。
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { HotItem, Lists } from '../data/types';
import { Ambient, TopBar } from '../components/Chrome';
import { Info, PageTitle, Seg as UiSeg } from '../components/ui';
import { BriefWarn, md as mdShort } from '../components/Brief';
import { ErrorState, Loading } from '../components/DataStatus';
import { HeroChart, usePeriod } from '../components/HeroChart';
import { StockListRow, type RowAction } from '../components/StockRow';
import { ChangePill } from '../components/Change';
import { QuickPreview } from '../components/QuickPreview';
import { Sheet } from '../components/Sheet';
import { WatchImport } from '../components/WatchImport';
import { ChecklistSheet, CloseSheet } from '../components/Trades';
import { IconChevron, IconPlus } from '../components/Icons';
import { createPortal } from 'preact/compat';
import { useAsync, useDb, useHistories, useRestoredState } from '../hooks';
import { loadInactive, loadLists, loadMeta } from '../data/api';
import { useScoredSummary } from '../data/useSummary';
import { useUser } from '../data/useUser';
import { addWatch, addWatchMany, clearSampleWatch, getSetting, putWatchInGroup, removeWatchFromGroup, restoreWatchGroup, restoreWatchItems, setWatchGroups, type Trade, type WatchGroupUndo, type WatchItem } from '../db/db';
import { GroupBar, GroupEditor, UndoToast, undoText } from '../components/WatchGroups';
import { DEFAULT_GROUP, DEFAULT_WATCH_PREFS, HOT_LIST, cleanGroupName, currentGroup, effectiveGroups, groupCounts, groupsOf, inGroup, lastGroup, orderIn, rememberGroup } from '../lib/watchGroups';
import type { StockRow } from '../data/types';
import { DEFAULT_PORTFOLIO, type PortfolioSettings } from '../lib/settings';
import { DEFAULT_COSTS, type CostSettings } from '../lib/costs';
import { holdingsSeries } from '../lib/portfolioSeries';
import { change, sliceWindow } from '../lib/periods';
import { uiConfig } from '../lib/config';
import { diffAll, makeSnapshot, type Snapshot } from '../lib/changes';
import { WATCH_SCOPE, snapshotRows, watchRows as watchRowsOf, watchSummary } from '../lib/watchChanges';
import { holdingAlerts } from '../lib/holdings';
import { inactiveText } from '../lib/tradeStatus';
import { baseline, commit, commitHero, heroSeen } from '../lib/seen';
import { setListContext } from '../lib/listContext';
import { fmtInt, fmtNum, pctSigned } from '../lib/format';
import { navigate, useRoute } from '../router';
import { trackHoldings, trackMovers } from '../lib/flowTrack';
import { Term } from '../components/kit';
import { hasStop } from '../lib/ritual';

type Seg = 'watch' | 'hold';
/** 系統清單的群組 id（不會與使用者群組名稱衝突） */
const HOT = '\u0000hot';
type SortKey = 'change' | 'pct' | 'rs' | 'foreign' | 'trust' | 'custom';
/** 熱門動能清單的排序（M2，2026-10-03）：每檔列實際數值，可依 RS、成交值、20 日乖離、漲跌幅排序 */
type HotSortKey = 'rs' | 'value' | 'bias' | 'pct';
const HOT_SORTS: [HotSortKey, string][] = [['rs', 'RS 百分位'], ['value', '成交值'], ['bias', '20 日乖離'], ['pct', '漲跌幅']];
function hotSorted(items: HotItem[], key: HotSortKey): HotItem[] {
  const v = (h: HotItem): number => key === 'rs' ? h.rs_percentile : key === 'value' ? h.value_million ?? -Infinity : key === 'bias' ? h.ma20_gap ?? -Infinity : h.change_pct ?? -Infinity;
  return [...items].sort((a, b) => v(b) - v(a) || a.value_rank - b.value_rank);
}
/** 熱門動能每檔的副標：實際數值＋標記 */
export function hotSub(h: HotItem): string {
  const parts = [`RS\u00a0${Math.round(h.rs_percentile)}`, `成交值第\u00a0${h.value_rank}\u00a0名`];
  if (h.value_million !== null && h.value_million !== undefined) parts.push(`${fmtNum(h.value_million / 100, 1)}\u00a0億`);
  if (h.ma20_gap !== null && h.ma20_gap !== undefined) parts.push(`乖離\u00a0${pctSigned(h.ma20_gap)}`);
  return parts.join('・');
}
/** 2026-11-15：預設依加入順序、全部列出（不再預設「依變化」，也不收合未達門檻的）；「變化在前」是選項之一 */
const SORTS: [SortKey, string][] = [['custom', '加入順序'], ['change', '變化在前'], ['pct', '漲跌幅'], ['rs', 'RS 百分位'], ['foreign', '外資'], ['trust', '投信']];

/**
 * 加入自選股（2026-11-19 重排；DECISIONS #473）。
 * - 第一欄是群組：大輸入框（好點、好打字），下面一排現有群組可以直接點；沒打就是目前正在看的群組，打新名稱就建立。
 * - 面板高度依內容（不撐滿整頁），欄位落在畫面下半部、拇指碰得到的地方；列出股票後才往上長。
 * - 加入股票的方式合在一起（components/WatchImport）：選截圖、貼上文字、輸入代號或名稱（一次好幾檔也用同一個輸入框）。
 * - 一檔可以在多個群組：已在別的群組的股票照樣加進來，原本的群組不動。
 */
function AddWatchSheet({ open, onClose, rows, group, groups, watchGroups, files, onFilesTaken }: {
  open: boolean; onClose: () => void; rows: StockRow[]; group: string; groups: string[]; watchGroups: Map<string, string[]>; files: File[] | null; onFilesTaken: () => void;
}) {
  const [name, setName] = useState('');
  useEffect(() => { if (!open) setName(''); }, [open]);
  const target = cleanGroupName(name) || group;
  return (
    <Sheet open={open} onClose={onClose} title="加入自選股">
      <div class="add-group">
        <label class="field">
          <span>加入到群組</span>
          <input class="input input-lg" value={name} placeholder={group} enterkeyhint="done" autocomplete="off" data-testid="add-group-name"
            onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </label>
        <div class="add-group-chips" role="group" aria-label="加入到哪裡">
          {groups.map((g) => <button key={g} type="button" class="chip" aria-pressed={g === target} onClick={() => setName(g === group ? '' : g)}>{g}</button>)}
        </div>
        {groups.includes(target) ? null : <p class="caption muted" role="status" data-testid="add-group-new">「{target}」是新群組，加入股票時建立。</p>}
      </div>
      <WatchImport rows={rows} watchGroups={watchGroups} group={target} open={open} files={files} onFilesTaken={onFilesTaken} />
    </Sheet>
  );
}

/**
 * 單檔的群組（左滑「群組」）：勾選＝也放進那個群組，取消＝離開那個群組；至少留在一個群組（要整檔拿掉用「移除」）。
 */
function GroupSheet({ item, groups, onClose }: { item: WatchItem | null; groups: string[]; onClose: () => void }) {
  const [name, setName] = useState('');
  useEffect(() => { if (!item) setName(''); }, [!item]);
  const mine = item ? groupsOf(item) : [];
  const all = [...groups, ...mine.filter((g) => !groups.includes(g))];
  const toggle = (g: string) => { if (item) void setWatchGroups(item.code, mine.includes(g) ? mine.filter((x) => x !== g) : [...mine, g]); };
  async function create() {
    const g = cleanGroupName(name);
    if (!item || !g) return;
    await setWatchGroups(item.code, [...mine, g]);
    setName('');
  }
  return (
    <Sheet open={!!item} onClose={onClose} title="放在哪些群組">
      <p class="caption muted">一檔股票可以同時在多個群組。</p>
      <div class="list" data-testid="group-sheet-list">
        {all.map((g) => {
          const on = mine.includes(g);
          return (
            <label key={g} class="list-item check-row">
              <input type="checkbox" checked={on} disabled={on && mine.length === 1} onChange={() => toggle(g)} />
              <span class="grow body">{g}</span>
              {on && mine.length === 1 ? <span class="caption muted">至少一個</span> : null}
            </label>
          );
        })}
      </div>
      <label class="field"><span>新群組</span><input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
      <button class="btn block" disabled={!cleanGroupName(name)} onClick={create}>建立並加入</button>
    </Sheet>
  );
}

/** 選取多檔後「加到群組」：點一個群組就把選取的都加進去；可以勾「同時從目前的群組移除」（＝移過去）。 */
function BulkGroupSheet({ codes, from, groups, onClose, onDone }: { codes: string[] | null; from: string; groups: string[]; onClose: () => void; onDone: (text: string, removed: WatchItem[]) => void }) {
  const [name, setName] = useState('');
  const [leave, setLeave] = useState(false);
  useEffect(() => { if (!codes) { setName(''); setLeave(false); } }, [!codes]);
  async function put(raw: string) {
    const g = cleanGroupName(raw);
    if (!codes || !g) return;
    await putWatchInGroup(codes, g);
    const removed = leave ? await removeWatchFromGroup(codes, from) : [];
    onDone(`已把 ${codes.length} 檔${leave ? '移到' : '加到'}「${g}」`, removed);
  }
  return (
    <Sheet open={!!codes} onClose={onClose} title={`把 ${codes?.length ?? 0} 檔加到群組`}>
      <div class="menu-list" data-testid="bulk-group-list">
        {groups.filter((g) => g !== from).map((g) => <button key={g} class="menu-item" onClick={() => put(g)}><span class="grow body">{g}</span></button>)}
      </div>
      <label class="field"><span>新群組</span><input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
      <button class="btn block" disabled={!cleanGroupName(name)} onClick={() => put(name)}>建立並加入</button>
      <label class="list-item check-row" style={{ marginTop: 'var(--s-3)' }}>
        <input type="checkbox" checked={leave} onChange={() => setLeave(!leave)} />
        <span class="grow body">同時從「{from}」移除</span>
      </label>
    </Sheet>
  );
}

/**
 * 選取模式的底部動作列（2026-11-19；DECISIONS #473）：取代底部導覽列的位置（選取期間導覽列收起來），
 * 動作就在拇指旁邊：全選｜加到群組｜移除。移除不跳確認，改用「復原」。
 */
function SelectBar({ count, total, onAll, onGroup, onRemove }: { count: number; total: number; onAll: () => void; onGroup: () => void; onRemove: () => void }) {
  useEffect(() => {
    document.documentElement.dataset.selecting = '1';
    return () => { delete document.documentElement.dataset.selecting; };
  }, []);
  return createPortal((
    <div class="select-bar glass" role="toolbar" aria-label="已選取股票的動作" data-testid="select-bar">
      <button type="button" class="select-bar-btn" onClick={onAll}>{count === total && total ? '取消全選' : '全選'}</button>
      <span class="grow" />
      <button type="button" class="select-bar-btn" disabled={!count} onClick={onGroup}>加到群組</button>
      <button type="button" class="select-bar-btn danger" disabled={!count} onClick={onRemove} data-testid="select-remove">移除{count ? ` ${count} 檔` : ''}</button>
    </div>
  ), document.body);
}

function mdLabel(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * 新用戶（還沒有任何自選）：歡迎卡。主要動作是「搜尋並加入股票」（#13：打開與右上角「＋」相同的搜尋面板，
 * 搜尋結果直接加入自選）；範例自選與熱門動能改為次要選項。
 */
function WelcomeCard({ onSearch, onSample, onHot, hotCount, sampleNames }: { onSearch: () => void; onSample: () => void; onHot: () => void; hotCount: number; sampleNames: string }) {
  return (
    <section class="card welcome" aria-labelledby="welcome-title">
      <h2 id="welcome-title" class="section">無自選股</h2>
      <p class="caption muted">自選股每晚只列出自上次查看以來有顯著變化的股票。</p>
      <button class="btn primary block welcome-main" onClick={onSearch}>搜尋並加入股票</button>
      <div class="welcome-actions">
        <button class="btn" onClick={onSample}>加入範例自選</button>
        <button class="btn" onClick={onHot} disabled={!hotCount}>從熱門動能挑選</button>
      </div>
      <p class="caption muted">範例：{sampleNames}（標示「範例」，可一鍵清除）。熱門動能依規則每日產生，非推薦。</p>
    </section>
  );
}

/** 從熱門動能挑幾檔加入自選（勾選後一次加入）。 */
function HotPickSheet({ open, onClose, items, byCode, watched }: { open: boolean; onClose: () => void; items: HotItem[]; byCode?: Map<string, StockRow>; watched: Set<string> }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  useEffect(() => { if (open) { setSel(new Set()); setMsg(''); } }, [open]);
  const toggle = (code: string) => setSel((cur) => { const n = new Set(cur); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  async function addSel() {
    const n = await addWatchMany([...sel], '熱門動能', 'hot');
    setMsg(`已加入 ${n} 檔`);
    setSel(new Set());
  }
  return (
    <Sheet open={open} onClose={onClose} title="從熱門動能挑選" detent="full">
      <p class="caption muted">依規則產生，非推薦。勾選想追蹤的幾檔，會加入「熱門動能」群組。</p>
      <div class="list">
        {items.map((h) => {
          const r = byCode?.get(h.code);
          const done = watched.has(h.code);
          return (
            <label key={h.code} class="list-item check-row">
              <input type="checkbox" checked={done || sel.has(h.code)} disabled={done} onChange={() => toggle(h.code)} />
              <span class="grow"><span class="body">{h.name ?? r?.name ?? h.code}</span>
                <span class="caption muted" style={{ display: 'block' }}>
                  <span class="nowrap">{h.code}</span>・{done ? '已在自選' : <><span class="nowrap">RS 百分位 {Math.round(h.rs_percentile)}</span>・<span class="nowrap">成交值第 {h.value_rank} 名</span></>}
                </span>
              </span>
              {r ? <ChangePill change={r.change} pct={r.change_pct} /> : null}
            </label>
          );
        })}
      </div>
      <div class="sheet-sticky">
        {msg ? <p class="caption muted" role="status">{msg}</p> : null}
        <button class="btn primary block" disabled={!sel.size} onClick={addSel}>{sel.size ? `加入 ${sel.size} 檔到自選` : '勾選要加入的股票'}</button>
      </div>
    </Sheet>
  );
}

/** 熱門動能群組的說明列：規則、日期、複製與挑選。 */
function HotHeader({ lists, onCopy, onPick, copied }: { lists: Lists; onCopy: () => void; onPick: () => void; copied: string }) {
  const r = lists.hot_momentum.rule;
  return (
    <div class="card system-note">
      <div class="row between wrap" style={{ gap: 'var(--s-2)' }}>
        <span class="tag">依規則產生，非推薦</span>
        <span class="caption muted">{mdLabel(lists.date)} 收盤後產生・唯讀</span>
      </div>
      <div class="row between" style={{ marginTop: 'var(--s-2)' }}>
        <span class="caption muted">成交值前 {r.value_rank_top} 名・RS 百分位 ≥ {r.min_rs_percentile}・前 {r.size} 檔</span>
        <Info title="熱門動能的規則">
          <p>成交值排名前 {r.value_rank_top} 名、RS 百分位 ≥ {r.min_rs_percentile}、沒有危險級風險旗標且注意級最多 {r.max_warn_flags} 個，依 RS 百分位取前 {r.size} 檔{r.exclude_etf ? '（不含 ETF）' : ''}。</p>
          <p>每檔列出 RS 百分位、成交值排名與金額、20 日乖離；標記處置／注意股、20 日乖離 &gt; {r.mark_bias_above ?? 20}%、漲停（漲幅 ≥ {r.mark_limit_up_pct ?? 9.5}%）、流動性不足（成交值 &lt; {fmtNum((r.mark_low_value_million ?? 100) / 100, 0)} 億）。</p>
        </Info>
      </div>
      <div class="row wrap" style={{ gap: 'var(--s-2)', marginTop: 'var(--s-3)' }}>
        <button class="btn small" onClick={onCopy}>複製成我的群組</button>
        <button class="btn small" onClick={onPick}>挑幾檔加入</button>
      </div>
      {copied ? <p class="caption muted" role="status" style={{ marginTop: 'var(--s-2)' }}>{copied}</p> : null}
    </div>
  );
}

export default function Mine() {
  const route = useRoute();
  // 自選是預設；舊網址 ?seg=watch 仍然有效，持股為 ?seg=hold
  const seg: Seg = route.query.get('seg') === 'hold' ? 'hold' : 'watch';
  const summary = useScoredSummary();
  const user = useUser();
  const prefs = useDb(async () => ({
    portfolio: await getSetting<PortfolioSettings>('portfolio', DEFAULT_PORTFOLIO),
    costs: await getSetting<CostSettings>('costs', DEFAULT_COSTS),
  }));
  const [period, setPeriod] = usePeriod('portfolio');
  // 目前看的群組（沒有「全部」；2026-11-15）：返回時還原，否則用上次看的（localStorage），都沒有就是第一個群組
  const [groupRaw, setGroupRaw] = useRestoredState('mine.group', lastGroup());
  const setGroup = (g: string) => { rememberGroup(g); setGroupRaw(g); };
  const [adding, setAdding] = useState(route.query.get('add') === '1');
  const [preview, setPreview] = useState<string | null>(null);
  const [closing, setClosing] = useState<Trade | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  // 選取模式（一次移除或加到群組）；shots＝頁面上「從截圖加入」選好的截圖
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<string[] | null>(null);
  const [removed, setRemoved] = useState<{ text: string; items: WatchItem[] } | null>(null);
  const [shots, setShots] = useState<File[] | null>(null);
  const shotRef = useRef<HTMLInputElement>(null);
  const dragSel = useRef<{ start: string; to: boolean; active: boolean } | null>(null);
  const dragEndAt = useRef(0);
  const [sort, setSort] = useRestoredState<SortKey>('mine.sort2', 'custom');
  const [hotSort, setHotSort] = useRestoredState<HotSortKey>('mine.hotSort', 'rs');
  const [snap, setSnap] = useState<Snapshot | null | undefined>(undefined);
  const [seen, setSeen] = useState<number | null | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState('');
  const lists = useAsync(loadLists, []);
  const meta = useAsync(loadMeta, []);
  // M1-1：與今晚頁共用同一個快照範圍（WATCH_SCOPE），兩頁的「自選顯著變化」檔數才會一致
  useEffect(() => { baseline(WATCH_SCOPE).then(setSnap); heroSeen('portfolio').then(setSeen); }, []);

  const byCode = summary.data?.byCode;
  const open = useMemo(() => (user?.trades ?? []).filter((t) => t.status === 'open'), [user]);
  const holdCodes = useMemo(() => [...new Set(open.map((t) => t.code))], [open]);
  const watch = user?.watch ?? [];
  // 群組＝有股票的＋使用者建立、還沒有股票的（lib/watchGroups）；「預設」沒有股票時不顯示
  const watchPrefs = user?.watchPrefs ?? DEFAULT_WATCH_PREFS;
  const groups = useMemo(() => effectiveGroups(watch, watchPrefs), [watch, watchPrefs]);
  const counts = useMemo(() => groupCounts(watch), [watch]);
  const hotHidden = watchPrefs.hidden.includes(HOT_LIST);
  // 群組的編輯直接在頁面上展開（不另開面板）：focusNew＝按「＋」進來，游標在新群組名稱
  const [groupEdit, setGroupEdit] = useState<{ focusNew?: boolean } | null>(null);
  const [undo, setUndo] = useState<WatchGroupUndo | null>(null);
  const hotItems = useMemo(() => hotSorted(lists.data?.hot_momentum.items ?? [], hotSort), [lists.data, hotSort]);
  const hotShown = hotItems.length > 0 && !hotHidden;
  // 剛建立或剛改名的群組要等資料重讀後才在清單裡：pendingGroup 記著，這段期間不跳走
  const pendingGroup = useRef<string | null>(null);
  if (pendingGroup.current && groups.includes(pendingGroup.current)) pendingGroup.current = null;
  const pickNewGroup = (g: string) => { pendingGroup.current = g; setGroup(g); };
  // 目前看的群組被刪除、改名或隱藏 → 換到第一個群組（都沒有就是系統清單）
  const group = currentGroup(groupRaw, groups, hotShown ? HOT : null, pendingGroup.current);
  const watchShown = group === HOT ? [] : watch.filter((w) => inGroup(w, group));
  const watchedSet = useMemo(() => new Set(watch.map((w) => w.code)), [watch]);
  const watchGroupsOf = useMemo(() => new Map(watch.map((w) => [w.code, groupsOf(w)] as const)), [watch]);
  // 換群組或換分段：離開選取模式
  useEffect(() => { setSelecting(false); setSel(new Set()); }, [group, seg]);
  const samples = watch.filter((w) => w.origin === 'sample');
  const hist = useHistories(useMemo(() => [...holdCodes, ...watch.map((w) => w.code)].filter((c, i, a) => a.indexOf(c) === i), [holdCodes, watch]));

  // 所有持股的歷史都載入後才計算，避免組合市值暫時偏低（也避免把不完整的值記成「上次查看」）
  const histReady = holdCodes.every((c) => hist.has(c));
  const series = useMemo(() => (histReady ? holdingsSeries(open, holdCodes.map((c) => hist.get(c) ?? null)) : null), [open, holdCodes, hist, histReady]);
  const win = series ? sliceWindow(series.dates, series.values, period) : null;
  const dir = win ? change(win.values).dir : 'flat';
  const alerts = useMemo(() => (byCode ? holdingAlerts(open, byCode, undefined, hist) : []), [open, byCode, hist]);
  const alertBy = new Map(alerts.map((a) => [a.trade.code, a]));
  const risky = new Set(alerts.filter((a) => a.risk).map((a) => a.trade.code));

  const rows = useMemo(() => {
    if (!byCode) return [];
    const codes = seg === 'hold' ? holdCodes : group === HOT ? hotItems.map((h) => h.code) : watchShown.map((w) => w.code);
    return codes.map((c) => byCode.get(c)).filter((r): r is StockRow => !!r);
  }, [byCode, seg, holdCodes, watchShown, group, hotItems]);
  // 頁首結論以「全部自選（不含同時持有的）」為準，與今晚頁同一個函式、同一個快照（M1-1）；不受群組篩選影響
  const watchSum = useMemo(() => watchSummary(watchRowsOf(watch, user?.trades ?? [], byCode), snap ?? null), [byCode, watch, user, snap]);
  const watchSig = snap === undefined ? 0 : watchSum.significant.length;
  // 流程步驟 2「看持倉」與 3「看自選異動」：記下開過持股清單、開過異動清單（當時清單上的代號）
  const moverKey = watchSum.significant.map((c) => c.code).join(',');
  useEffect(() => {
    if (!user || !byCode || snap === undefined) return;
    if (seg === 'hold') trackHoldings();
    else if (watch.length) trackMovers(moverKey ? moverKey.split(',') : []);
  }, [seg, !!user, !!byCode, snap === undefined, moverKey, watch.length]);
  const changes = useMemo(() => (snap === undefined ? [] : diffAll(rows, snap)), [rows, snap]);
  // 持股沒有「加入順序」：預設是風險與變化在前
  const sortKey: SortKey = seg === 'hold' && sort === 'custom' ? 'change' : sort;
  const ordered = [...changes].sort((a, b) => (seg === 'hold' ? Number(risky.has(b.code)) - Number(risky.has(a.code)) : 0) || Number(b.significant) - Number(a.significant) || b.score - a.score);
  const val = (c: (typeof changes)[number]): number => {
    const r = c.row;
    switch (sortKey) {
      case 'pct': return r.change_pct ?? -Infinity;
      case 'rs': return (r.rs_percentile as number | null) ?? -Infinity;
      case 'foreign': return r.foreign_net_lots ?? -Infinity;
      case 'trust': return r.trust_net_lots ?? -Infinity;
      case 'custom': { const w = watch.find((x) => x.code === c.code); return -(w ? orderIn(w, group) : 0); }
      default: return 0;
    }
  };
  // 2026-11-15：一律全部列出，不收合「未達門檻」的（有顯著變化的那幾檔，原因仍然寫在名稱下面）
  const main = sortKey === 'change' ? ordered : [...changes].sort((a, b) => val(b) - val(a));
  // U-01：沒有最新資料的股票（下市、長期停牌、代號錯誤）在自選與持股分段都要列出，不能無聲消失
  const missing = !byCode ? [] : seg === 'watch' ? watchShown.filter((w) => !byCode.get(w.code)).map((w) => w.code) : holdCodes.filter((c) => !byCode.get(c));
  const inactive = useAsync(loadInactive, []);

  useEffect(() => {
    if (!summary.data || !user || snap === undefined) return;
    commit(WATCH_SCOPE, makeSnapshot(snapshotRows(user.watch, user.trades, summary.data.byCode), summary.data.date));
  }, [summary.data, user, snap]);
  const latestValue = series ? series.values[series.values.length - 1] : null;
  useEffect(() => { if (seen !== undefined) commitHero('portfolio', latestValue); }, [seen, latestValue]);

  const setSeg = (s: Seg) => navigate(s === 'hold' ? '/mine?seg=hold' : '/mine', true);
  const sample = uiConfig.sample_watchlist;
  const sampleNames = sample.codes.map((c) => byCode?.get(c)?.name ?? c).join('、');
  async function addSamples() {
    await addWatchMany(sample.codes.filter((c) => !byCode || byCode.has(c)), sample.group, 'sample');
    setGroup(sample.group);
  }
  async function copyHot() {
    const name = `熱門動能 ${mdLabel(lists.data?.date)}`;
    const res = await putWatchInGroup(hotItems.map((h) => h.code), name);
    setCopied(`已建立群組「${name}」：${res.added + res.joined + res.same} 檔${res.joined ? `（${res.joined} 檔原本就在自選，原本的群組不動）` : ''}`);
  }
  // 個股頁分頁器的清單＝列表上顯示的順序與檔數（顯著 → 未達門檻 → 沒有最新資料的股票），兩邊的數量一致
  const listCodes = [...(group === HOT ? rows.map((r) => r.code) : main.map((c) => c.code)), ...(group === HOT ? [] : missing)];
  const openStock = (code: string) => { setListContext({ name: seg === 'hold' ? '持股' : group === HOT ? '熱門動能' : '自選', codes: listCodes }); navigate(`/stock/${code}`); };
  const previewRow = preview ? byCode?.get(preview) : undefined;
  const previewTrade = preview ? open.find((t) => t.code === preview) : undefined;
  const previewWatch = preview ? watch.find((w) => w.code === preview) : undefined;

  function actionsFor(code: string): RowAction[] {
    if (seg === 'hold') {
      const t = open.find((x) => x.code === code);
      return t ? [{ id: 'close', label: '平倉', kind: 'move', onClick: () => setClosing(t) }] : [];
    }
    if (group === HOT) {
      return watchedSet.has(code) ? [] : [{ id: 'add', label: '加入自選', kind: 'move', onClick: () => addWatch(code, '熱門動能', 'hot') }];
    }
    return watchedSet.has(code) ? [
      { id: 'move', label: '群組', kind: 'move', onClick: () => setMoving(code) },
      { id: 'remove', label: '移除', kind: 'remove', onClick: () => removeFrom([code]) },
    ] : [];
  }
  const nameOf = (code: string) => byCode?.get(code)?.name ?? code;
  /** 從目前的群組移除（還在別的群組的只離開這個群組）；不跳確認，底部出現「復原」 */
  async function removeFrom(codes: string[]) {
    const items = await removeWatchFromGroup(codes, group);
    if (!items.length) return;
    setUndo(null);
    setRemoved({ text: `已從「${group}」移除 ${items.length === 1 ? nameOf(items[0].code) : `${items.length} 檔`}`, items });
  }
  const endSelect = () => { setSelecting(false); setSel(new Set()); };
  const toggleSel = (code: string) => {
    if (performance.now() - dragEndAt.current < 250) return; // 剛滑完放開：起點那一列的點擊不再反轉一次
    setSel((cur) => { const n = new Set(cur); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  };
  // 按住圓圈往上下滑：經過的每一檔都變成同一個狀態（與 iOS 清單的連續選取相同）
  const codeAt = (el: Element | null) => (el?.closest('.srow-wrap') as HTMLElement | null)?.dataset.code ?? null;
  function selDown(e: PointerEvent) {
    if (!selecting || !(e.target as Element).closest('.srow-check')) return;
    const code = codeAt(e.target as Element);
    if (!code) return;
    dragSel.current = { start: code, to: !sel.has(code), active: false };
    // 放開不一定在清單上（也可能被瀏覽器取消）：在 window 上收
    window.addEventListener('pointerup', selUp, { once: true });
    window.addEventListener('pointercancel', selUp, { once: true });
  }
  function selMove(e: PointerEvent) {
    const d = dragSel.current;
    if (!d) return;
    if (e.pointerType === 'mouse' && !e.buttons) { selUp(); return; }
    const code = codeAt(document.elementFromPoint(e.clientX, e.clientY));
    if (!code || (!d.active && code === d.start)) return;
    d.active = true;
    setSel((cur) => {
      if (cur.has(code) === d.to && cur.has(d.start) === d.to) return cur;
      const n = new Set(cur);
      for (const c of [d.start, code]) { if (d.to) n.add(c); else n.delete(c); }
      return n;
    });
  }
  function selUp() {
    if (dragSel.current?.active) dragEndAt.current = performance.now();
    dragSel.current = null;
  }
  const sub = (code: string, reasons: { text: string; risk?: boolean }[]) => {
    const base = subBase(code, reasons);
    // 2026-10-06：停損改為選填；沒有有效停損的持倉一律加「未設停損」（中性標籤：是紀錄的事實，不是風險警示）
    if (seg === 'hold' && open.some((t) => t.code === code && !hasStop(t))) return <span>{base} <span class="tag" data-testid="no-stop-tag">未設停損</span></span>;
    return base;
  };
  const subBase = (code: string, reasons: { text: string; risk?: boolean }[]) => {
    const a = alertBy.get(code);
    if (a?.risk) return <span class="tag risk">{a.items[0].label.split(/[ ：]/)[0]}</span>;
    // M2：風險旗標用橘色小標籤（其餘理由是一般副資訊）
    if (reasons.length && reasons[0].risk) return <span class="tag risk">{reasons[0].text.replace(/^新風險旗標：/, '')}</span>;
    if (reasons.length) return reasons[0].text;
    if (seg === 'hold') {
      const shares = open.filter((t) => t.code === code).reduce((s, t) => s + t.shares, 0);
      return `${fmtInt(shares)} 股`;
    }
    if (group === HOT) {
      const h = hotItems.find((x) => x.code === code);
      if (!h) return '';
      return h.marks?.length ? <span>{hotSub(h)} <span class="tag risk">{h.marks.join('・')}</span></span> : hotSub(h);
    }
    const w = watch.find((x) => x.code === code);
    return w?.origin === 'sample' ? '範例' : ''; // 清單一次只看一個群組，不用再寫群組名稱
  };

  // 新用戶（還沒有自選）只看到歡迎卡；有自選後才出現群組膠囊（含系統清單「熱門動能」）
  // 有自選、或已經建立過群組，就顯示群組列（含「＋」與「編輯」）
  // 移到群組、加入自選的群組選單：一定有「預設」可以選
  const moveGroups = groups.includes(DEFAULT_GROUP) ? groups : [DEFAULT_GROUP, ...groups];
  const showChips = seg === 'watch' && (watch.length > 0 || groups.length > 0);
  const hotLabel = lists.data?.hot_momentum.label ?? '熱門動能';
  const emptyGroup = seg === 'watch' && !!user && group !== HOT && groups.includes(group) && !(counts.get(group) ?? 0);
  const sortable = rows.length > 0 && group !== HOT;
  const userGroup = seg === 'watch' && !!group && group !== HOT;
  const selectable = [...main.map((c) => c.code), ...missing];
  return (
    <div class="page">
      <Ambient mood={seg === 'hold' && holdCodes.length && win ? dir : 'neutral'} />
      <TopBar actions={
        <button class="icon-btn" aria-label={seg === 'hold' ? '新增持倉（新增持倉前檢查表）' : '加入自選股'} onClick={() => setAdding(true)}><IconPlus /></button>
      } />
      <PageTitle title="我的股票" sub={user && summary.data ? `${seg === 'watch' ? `自選 ${watch.length} 檔・異動 ${watchSig} 檔` : `持倉 ${holdCodes.length} 檔・警示 ${risky.size} 檔`}・資料至 ${mdShort(summary.data.date)}` : '\u00a0'} />
      <BriefWarn meta={meta.data ?? null} />
      {summary.error ? <ErrorState error={summary.error} /> : null}
      {summary.loading && !summary.data ? <Loading /> : null}

      <div class="mine-seg"><UiSeg options={[['watch', `自選 ${watch.length}`], ['hold', `持股 ${holdCodes.length}`]] as const} value={seg} onChange={setSeg} label="清單" testid="mine-seg" /></div>
      {/* M1-1：與今晚頁相同的比較基準文字，放在自選分段的最上方 */}
      {seg === 'watch' && user && watch.length && snap !== undefined ? (
        <p class="interp" data-testid="watch-basis">{watchSum.basis}：{watchSig ? <>{watchSig} 檔有<Term id="significant_change">顯著變化</Term></> : <>沒有<Term id="significant_change">顯著變化</Term></>}</p>
      ) : null}

      {seg === 'hold' && !user ? <div style={{ marginTop: 'var(--s-5)' }}><Loading hero /></div> : null}
      {seg === 'hold' && holdCodes.length ? (
        <div style={{ marginTop: 'var(--s-5)' }}>
          <HeroChart label={`目前持股組合・${holdCodes.length} 檔`} win={win} period={period} onPeriod={setPeriod} seen={seen ?? null}
            format={(v) => fmtInt(v)} area caption="以現有股數 × 還原收盤價計算（除權息不造成斷層）；最新一日等於目前市值。" periodsLabel="持股組合走勢期間"
            emptyText={hist.size < holdCodes.length ? '載入持股歷史中' : '資料累積中'} />
        </div>
      ) : null}

      {seg === 'watch' && user && !watch.length && !groups.length ? (
        <WelcomeCard onSearch={() => setAdding(true)} onSample={addSamples} onHot={() => setPicking(true)} hotCount={hotItems.length} sampleNames={sampleNames} />
      ) : null}

      {showChips ? (
        <>
          <GroupBar groups={groups} group={group} onPick={setGroup} hot={hotShown ? { id: HOT, label: hotLabel } : null}
            editing={!!groupEdit} onNew={() => setGroupEdit({ focusNew: true })} onEdit={() => setGroupEdit({})} onDone={() => setGroupEdit(null)} />
          {groupEdit ? (
            <GroupEditor focusNew={!!groupEdit.focusNew} onClose={() => setGroupEdit(null)}
              groups={groups} counts={counts} prefs={watchPrefs} hot={hotItems.length ? { label: hotLabel, count: hotItems.length } : null}
              onCreated={(g) => { if (groupEdit.focusNew) { pickNewGroup(g); setGroupEdit(null); } }}
              onRenamed={(from, to) => { if (group === from) pickNewGroup(to); }}
              onDeleted={(u) => { setRemoved(null); setUndo(u); }} />
          ) : null}
        </>
      ) : null}

      {seg === 'watch' && samples.length && group !== HOT ? (
        <div class="banner info sample-note" role="status">
          <div class="grow"><span class="w6">範例自選</span>：{samples.length} 檔示範用的股票，隨時可以清除。</div>
          <button class="btn small" onClick={() => clearSampleWatch()}>清除範例</button>
        </div>
      ) : null}

      {seg === 'watch' && group === HOT && lists.data ? (
        <HotHeader lists={lists.data} onCopy={copyHot} onPick={() => setPicking(true)} copied={copied} />
      ) : null}

      {sortable ? (
        <div class="row between" style={{ marginTop: 'var(--s-4)', alignItems: 'flex-start' }}>
          {selecting ? (
            <>
              <p class="caption muted grow" role="status" data-testid="select-count">已選 {sel.size} 檔・按住圓圈上下滑可連續選取</p>
              <button type="button" class="text-btn w6" onClick={endSelect} data-testid="select-done">完成</button>
            </>
          ) : (
            <>
              <p class="caption muted grow">{rows.length} 檔・左滑可{seg === 'hold' ? '平倉' : '移除'}・長按快速預覽</p>
              {userGroup ? <button type="button" class="text-btn" onClick={() => setSelecting(true)} data-testid="select-start">選取</button> : null}
              <select class="select sort-select" aria-label="排序" value={sortKey} onChange={(e) => setSort((e.target as HTMLSelectElement).value as SortKey)}>
                {SORTS.filter(([k]) => seg === 'watch' || k !== 'custom').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </>
          )}
        </div>
      ) : group === HOT && rows.length ? (
        <div class="row between" style={{ marginTop: 'var(--s-4)', alignItems: 'flex-start' }}>
          <p class="caption muted grow">依{HOT_SORTS.find((x) => x[0] === hotSort)![1]}由高到低・左滑或長按可加入自選</p>
          <select class="select sort-select" aria-label="熱門動能排序" value={hotSort} onChange={(e) => setHotSort((e.target as HTMLSelectElement).value as HotSortKey)}>
            {HOT_SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      ) : null}

      <div class="stock-list" onPointerDown={selDown} onPointerMove={selMove} onDragStart={(e) => { if (selecting) e.preventDefault(); }}>
        {user && seg === 'hold' && !holdCodes.length ? (
          // M1-10：沒有持倉時只佔一列（主要動作就在列上），不用整塊高的空狀態
          <div class="list">
            <button class="list-item brand" onClick={() => setAdding(true)} data-testid="holdings-empty-row">
              <span class="grow" style={{ textAlign: 'left' }}><span class="body">新增持倉前檢查表</span><span class="caption muted" style={{ display: 'block' }}>無持倉</span></span>
              <span class="chev"><IconChevron /></span>
            </button>
          </div>
        ) : null}
        {group === HOT ? rows.map((r) => (
          <StockListRow key={r.code} code={r.code} row={r} hist={hist.get(r.code)} sub={sub(r.code, [])}
            onOpen={() => openStock(r.code)} onPreview={() => setPreview(r.code)} actions={actionsFor(r.code)} />
        )) : null}
        {group !== HOT ? main.map((c) => (
          <StockListRow key={c.code} code={c.code} row={c.row} hist={hist.get(c.code)} sub={sub(c.code, c.reasons)}
            onOpen={() => openStock(c.code)} onPreview={() => setPreview(c.code)} actions={actionsFor(c.code)} ariaExtra={c.reasons.map((r) => r.text).join('、')}
            select={selecting ? { checked: sel.has(c.code), onToggle: () => toggleSel(c.code) } : undefined} />
        )) : null}
        {missing.map((code) => {
          const info = inactive.data?.get(code);
          const t = seg === 'hold' ? open.find((x) => x.code === code) : undefined;
          return (
            <div key={code} class="card row between missing-card" data-testid="missing-card">
              {selecting ? <input type="checkbox" class="missing-check" aria-label={`選取 ${code}`} checked={sel.has(code)} onChange={() => toggleSel(code)} /> : null}
              <span class="grow" style={{ minWidth: 0 }}>
                <span class="body" style={{ display: 'block' }}>{info?.name ?? t?.name ?? code} <span class="caption muted">{code}</span></span>
                <span class="caption muted">{inactiveText(info)}{t ? `・持有 ${fmtInt(open.filter((x) => x.code === code).reduce((n, x) => n + x.shares, 0))} 股` : ''}</span>
              </span>
              {t ? <button class="btn small" onClick={() => setClosing(t)}>平倉</button>
                : selecting ? null : <button class="btn small danger" onClick={() => removeFrom([code])}>移除</button>}
            </div>
          );
        })}
      </div>

      {emptyGroup ? (
        <div class="card group-empty" data-testid="group-empty">
          <p class="body">「{group}」還沒有股票</p>
          <p class="caption muted">可以搜尋、貼上代號，或從券商庫存截圖加入。</p>
          <div class="add-more">
            <button class="btn primary" onClick={() => setAdding(true)}>加入股票</button>
            <button class="btn" onClick={() => shotRef.current?.click()}>從截圖加入</button>
          </div>
        </div>
      ) : null}
      {/* 清單最後：繼續加進這個群組（截圖直接開相簿，選好就辨識） */}
      {userGroup && !emptyGroup && !selecting && user && watchShown.length ? (
        <div class="add-more" data-testid="add-more">
          <button class="btn" onClick={() => setAdding(true)}><IconPlus />加入股票</button>
          <button class="btn" onClick={() => shotRef.current?.click()}>從截圖加入</button>
        </div>
      ) : null}
      <input ref={shotRef} type="file" accept="image/*" multiple hidden data-testid="page-shot-file"
        onChange={(e) => {
          const input = e.target as HTMLInputElement;
          const files = [...(input.files ?? [])];
          input.value = '';
          if (files.length) { setShots(files); setAdding(true); }
        }} />
      {selecting ? (
        <SelectBar count={sel.size} total={selectable.length}
          onAll={() => setSel(sel.size === selectable.length ? new Set() : new Set(selectable))}
          onGroup={() => setBulk([...sel])}
          onRemove={() => { void removeFrom([...sel]); endSelect(); }} />
      ) : null}
      <QuickPreview code={preview} row={previewRow} onClose={() => setPreview(null)} onOpen={() => { const c = preview!; setPreview(null); openStock(c); }}
        actions={previewTrade ? <button class="btn" onClick={() => { setPreview(null); setClosing(previewTrade); }}>平倉</button>
          : previewWatch ? <button class="btn danger" onClick={() => { void removeFrom([previewWatch.code]); setPreview(null); }}>{userGroup ? `從「${group}」移除` : '移除自選'}</button>
          : preview ? <button class="btn" onClick={() => addWatch(preview)}>加入自選</button> : null} />
      {summary.data && prefs ? (
        seg === 'hold'
          ? <ChecklistSheet open={adding} onClose={() => setAdding(false)} rows={summary.data.rows} portfolio={prefs.portfolio} day={summary.data.date} />
          : <AddWatchSheet open={adding} onClose={() => setAdding(false)} rows={summary.data.all} group={!group || group === HOT ? DEFAULT_GROUP : group} groups={moveGroups} watchGroups={watchGroupsOf}
              files={shots} onFilesTaken={() => setShots(null)} />
      ) : null}
      <CloseSheet trade={closing} onClose={() => setClosing(null)} costs={prefs?.costs ?? DEFAULT_COSTS} price={closing ? byCode?.get(closing.code)?.close ?? null : null} day={summary.data?.date ?? ''} />
      <GroupSheet item={moving ? watch.find((w) => w.code === moving) ?? null : null} groups={moveGroups} onClose={() => setMoving(null)} />
      <BulkGroupSheet codes={bulk} from={group} groups={moveGroups} onClose={() => setBulk(null)}
        onDone={(text, items) => { setBulk(null); endSelect(); setUndo(null); setRemoved({ text, items }); }} />
      {removed ? <UndoToast text={removed.text} onDone={() => setRemoved(null)} onUndo={removed.items.length ? () => { void restoreWatchItems(removed.items); setRemoved(null); } : undefined} /> : null}
      {undo ? <UndoToast text={undoText(undo)} onDone={() => setUndo(null)} onUndo={() => { void restoreWatchGroup(undo); setUndo(null); }} /> : null}
      <HotPickSheet open={picking} onClose={() => setPicking(false)} items={hotItems} byCode={byCode} watched={watchedSet} />
    </div>
  );
}
