/**
 * 我的股票：自選與持股合併在同一頁（分段控制「自選｜持股」，自選在左、預設）。
 * 回答「自選股有什麼新變化？」與「我的持股有沒有出事？」。
 * - 自選：使用者群組＋系統清單「熱門動能」（唯讀，依規則產生，非推薦；可一鍵複製成自己的群組或挑幾檔加入）。
 * - 新用戶還沒有自選時顯示歡迎卡：加入範例自選（config/ui.yml，標示「範例」、可一鍵清除）或從熱門動能挑選。
 * - 持股：組合走勢（環境光與走勢線同一個期間、同一個顏色）。
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { HotItem, Lists } from '../data/types';
import { Ambient, PageHead, TopBar } from '../components/Chrome';
import { DataStatus, EmptyState, ErrorState, Loading } from '../components/DataStatus';
import { HeroChart, usePeriod } from '../components/HeroChart';
import { StockListRow, type RowAction } from '../components/StockRow';
import { ChangePill } from '../components/Change';
import { QuickPreview } from '../components/QuickPreview';
import { Sheet } from '../components/Sheet';
import { StockSearch } from '../components/StockSearch';
import { ChecklistSheet, CloseSheet } from '../components/Trades';
import { IconChevron, IconChevronDown, IconClipboard, IconPlus } from '../components/Icons';
import { useAsync, useDb, useHistories, useRestoredState } from '../hooks';
import { loadInactive, loadLists } from '../data/api';
import { useScoredSummary } from '../data/useSummary';
import { useUser } from '../data/useUser';
import { addWatch, addWatchMany, clearSampleWatch, getSetting, removeWatch, updateWatch, type Trade, type WatchItem } from '../db/db';
import type { StockRow } from '../data/types';
import { DEFAULT_PORTFOLIO, type PortfolioSettings } from '../lib/settings';
import { DEFAULT_COSTS, type CostSettings } from '../lib/costs';
import { holdingsSeries } from '../lib/portfolioSeries';
import { PERIOD_LABEL, change, sliceWindow } from '../lib/periods';
import { holdConclusion, mineConclusion } from '../lib/conclusion';
import { uiConfig } from '../lib/config';
import { PAGE_SOURCES } from '../lib/health';
import { diffAll, makeSnapshot, sinceLabel, type Snapshot } from '../lib/changes';
import { holdingAlerts } from '../lib/holdings';
import { inactiveText } from '../lib/tradeStatus';
import { parseImport } from '../lib/importer';
import { baseline, commit, commitHero, heroSeen } from '../lib/seen';
import { setListContext } from '../lib/listContext';
import { fmtInt } from '../lib/format';
import { navigate, useRoute } from '../router';

type Seg = 'watch' | 'hold';
/** 系統清單的群組 id（不會與使用者群組名稱衝突） */
const HOT = '\u0000hot';
type SortKey = 'change' | 'pct' | 'composite' | 'foreign' | 'trust' | 'custom';
const SORTS: [SortKey, string][] = [['change', '依變化'], ['pct', '漲跌幅'], ['composite', '綜合分'], ['foreign', '外資'], ['trust', '投信'], ['custom', '自訂順序']];

function AddWatchSheet({ open, onClose, rows, group, groups }: { open: boolean; onClose: () => void; rows: StockRow[]; group: string; groups: string[] }) {
  const [importText, setImportText] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [msg, setMsg] = useState('');
  async function doImport() {
    const known = new Set(rows.map((r) => r.code));
    const byName = new Map(rows.map((r) => [r.name, r.code]));
    const parsed = parseImport(importText, known, byName);
    for (const p of parsed.codes) await addWatch(p.code, p.group ?? (newGroup || group));
    setImportText('');
    setMsg(`已加入 ${parsed.codes.length} 檔${parsed.unknown.length ? `；無法辨識：${parsed.unknown.join('、')}` : ''}`);
  }
  return (
    <Sheet open={open} onClose={onClose} title="加入自選股" detent="full">
      <StockSearch rows={rows} autoFocus onPick={(r) => { addWatch(r.code, newGroup || group); setMsg(`已加入 ${r.name}`); }} />
      {msg ? <p class="caption muted" role="status" style={{ marginTop: 'var(--s-2)' }}>{msg}</p> : null}
      <label class="field">
        <span>加入到群組（目前：{newGroup || group}；可輸入新群組）</span>
        <input class="input" value={newGroup} list="watch-groups" placeholder={group} onInput={(e) => setNewGroup((e.target as HTMLInputElement).value)} />
        <datalist id="watch-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      </label>
      <label class="field">
        <span>或貼上文字、代號清單或 CSV（每行或以逗號分隔；CSV 可含「代號,群組」）</span>
        <textarea class="input" rows={4} value={importText} onInput={(e) => setImportText((e.target as HTMLTextAreaElement).value)} placeholder={'2330 台積電\n2317, 0050\n代號,群組\n2454,半導體'} />
      </label>
      <button class="btn primary block" disabled={!importText.trim()} onClick={doImport}>匯入</button>
    </Sheet>
  );
}

function GroupSheet({ item, groups, onClose }: { item: WatchItem | null; groups: string[]; onClose: () => void }) {
  const [name, setName] = useState('');
  async function move(g: string) {
    if (!item || !g.trim()) return;
    // 範例自選被移到其他群組＝使用者決定留下，改為自己的自選（清除範例時不會被刪）
    await updateWatch({ ...item, group: g.trim(), origin: item.origin === 'sample' ? 'user' : item.origin });
    onClose();
  }
  return (
    <Sheet open={!!item} onClose={onClose} title="移到群組">
      <div class="menu-list">
        {groups.map((g) => (
          <button key={g} class="menu-item" onClick={() => move(g)} aria-pressed={item?.group === g}>
            <span class="grow body">{g}</span>{item?.group === g ? <span class="caption muted">目前</span> : null}
          </button>
        ))}
      </div>
      <label class="field"><span>新群組</span><input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
      <button class="btn block" disabled={!name.trim()} onClick={() => move(name)}>建立並移入</button>
    </Sheet>
  );
}

function mdLabel(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** 新用戶（還沒有任何自選）：精簡的歡迎卡，兩個起點。 */
function WelcomeCard({ onSample, onHot, hotCount, sampleNames }: { onSample: () => void; onHot: () => void; hotCount: number; sampleNames: string }) {
  return (
    <section class="card welcome" aria-labelledby="welcome-title">
      <h2 id="welcome-title" class="section">先追蹤幾檔股票</h2>
      <p class="caption muted">加入自選後，每晚只會列出自上次查看以來有顯著變化的股票。</p>
      <div class="welcome-actions">
        <button class="btn primary" onClick={onSample}>加入範例自選</button>
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
      <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>
        規則：成交值排名前 {r.value_rank_top} 名、RS 百分位 ≥ {r.min_rs_percentile}、沒有危險級風險旗標且注意級最多 {r.max_warn_flags} 個，依 RS 百分位取前 {r.size} 檔{r.exclude_etf ? '（不含 ETF）' : ''}。詳見方法說明。
      </p>
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
  const [group, setGroup] = useRestoredState('mine.group', '全部');
  const [adding, setAdding] = useState(route.query.get('add') === '1');
  const [preview, setPreview] = useState<string | null>(null);
  const [closing, setClosing] = useState<Trade | null>(null);
  const [moving, setMoving] = useState<WatchItem | null>(null);
  const [showQuiet, setShowQuiet] = useRestoredState('mine.showQuiet', false);
  const [sort, setSort] = useRestoredState<SortKey>('mine.sort', 'change');
  const [snap, setSnap] = useState<Snapshot | null | undefined>(undefined);
  const [seen, setSeen] = useState<number | null | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState('');
  const lists = useAsync(loadLists, []);
  useEffect(() => { baseline('mine').then(setSnap); heroSeen('portfolio').then(setSeen); }, []);

  const byCode = summary.data?.byCode;
  const open = useMemo(() => (user?.trades ?? []).filter((t) => t.status === 'open'), [user]);
  const holdCodes = useMemo(() => [...new Set(open.map((t) => t.code))], [open]);
  const watch = user?.watch ?? [];
  const groups = useMemo(() => Array.from(new Set(['預設', ...watch.map((w) => w.group)])), [watch]);
  const watchShown = group === HOT ? [] : watch.filter((w) => group === '全部' || w.group === group);
  const hotItems = lists.data?.hot_momentum.items ?? [];
  const watchedSet = useMemo(() => new Set(watch.map((w) => w.code)), [watch]);
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
  // 頁首結論以「全部自選」為準（不受群組篩選影響）
  const watchAll = useMemo(() => (byCode ? watch.map((w) => byCode.get(w.code)).filter((r): r is StockRow => !!r) : []), [byCode, watch]);
  const watchSig = useMemo(() => (snap === undefined ? 0 : diffAll(watchAll, snap).filter((c) => c.significant).length), [watchAll, snap]);
  const changes = useMemo(() => (snap === undefined ? [] : diffAll(rows, snap)), [rows, snap]);
  const ordered = seg === 'hold'
    ? [...changes].sort((a, b) => Number(risky.has(b.code)) - Number(risky.has(a.code)) || Number(b.significant) - Number(a.significant) || b.score - a.score)
    : changes;
  const val = (c: (typeof changes)[number]): number => {
    const r = c.row;
    switch (sort) {
      case 'pct': return r.change_pct ?? -Infinity;
      case 'composite': return (r.composite as number | null) ?? -Infinity;
      case 'foreign': return r.foreign_net_lots ?? -Infinity;
      case 'trust': return r.trust_net_lots ?? -Infinity;
      case 'custom': return -(watch.find((w) => w.code === c.code)?.order ?? 0);
      default: return 0;
    }
  };
  const sortedAll = sort === 'change' ? ordered : [...changes].sort((a, b) => val(b) - val(a));
  // 依變化排序時，沒有顯著變化的收合；改用其他排序時全部列出
  const main = sort === 'change' ? ordered.filter((c) => c.significant || risky.has(c.code)) : sortedAll;
  const quiet = sort === 'change' ? ordered.filter((c) => !c.significant && !risky.has(c.code)) : [];
  // U-01：沒有最新資料的股票（下市、長期停牌、代號錯誤）在自選與持股分段都要列出，不能無聲消失
  const missing = !byCode ? [] : seg === 'watch' ? watchShown.filter((w) => !byCode.get(w.code)).map((w) => w.code) : holdCodes.filter((c) => !byCode.get(c));
  const inactive = useAsync(loadInactive, []);

  useEffect(() => {
    if (!summary.data || !user || snap === undefined) return;
    const all = [...holdCodes, ...watch.map((w) => w.code)].map((c) => summary.data!.byCode.get(c)).filter((r): r is StockRow => !!r);
    commit('mine', makeSnapshot(all, summary.data.date));
  }, [summary.data, user, snap]);
  const latestValue = series ? series.values[series.values.length - 1] : null;
  useEffect(() => { if (seen !== undefined) commitHero('portfolio', latestValue); }, [seen, latestValue]);

  const conclusion = seg === 'watch'
    ? mineConclusion({ watchCount: watch.length, watchChanges: watchSig, holdings: holdCodes.length, alerts: risky.size })
    : holdConclusion({ holdings: holdCodes.length, alerts: risky.size, dir, periodName: PERIOD_LABEL[period] });
  const setSeg = (s: Seg) => navigate(s === 'hold' ? '/mine?seg=hold' : '/mine', true);
  const sample = uiConfig.sample_watchlist;
  const sampleNames = sample.codes.map((c) => byCode?.get(c)?.name ?? c).join('、');
  async function addSamples() {
    await addWatchMany(sample.codes.filter((c) => !byCode || byCode.has(c)), sample.group, 'sample');
    setGroup('全部');
  }
  async function copyHot() {
    const name = `熱門動能 ${mdLabel(lists.data?.date)}`;
    const n = await addWatchMany(hotItems.map((h) => h.code), name, 'hot');
    const skipped = hotItems.length - n;
    setCopied(`已建立群組「${name}」：加入 ${n} 檔${skipped ? `（${skipped} 檔原本就在自選，維持原群組）` : ''}`);
  }
  const listCodes = sortedAll.map((c) => c.code);
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
    const w = watch.find((x) => x.code === code);
    return w ? [
      { id: 'move', label: '移到群組', kind: 'move', onClick: () => setMoving(w) },
      { id: 'remove', label: '移除', kind: 'remove', onClick: () => removeWatch(code) },
    ] : [];
  }
  const sub = (code: string, reasons: string[]) => {
    const a = alertBy.get(code);
    if (a?.risk) return <span class="risk w6">{a.items[0].label.split(/[ ：]/)[0]}</span>;
    if (reasons.length) return reasons[0];
    if (seg === 'hold') {
      const shares = open.filter((t) => t.code === code).reduce((s, t) => s + t.shares, 0);
      return `${fmtInt(shares)} 股`;
    }
    if (group === HOT) {
      const h = hotItems.find((x) => x.code === code);
      return h ? `RS ${Math.round(h.rs_percentile)}・成交值第 ${h.value_rank} 名` : '';
    }
    const w = watch.find((x) => x.code === code);
    return w?.origin === 'sample' ? '範例' : w?.group ?? '';
  };

  // 新用戶（還沒有自選）只看到歡迎卡；有自選後才出現群組膠囊（含系統清單「熱門動能」）
  const showChips = seg === 'watch' && watch.length > 0;
  const sortable = rows.length > 0 && group !== HOT;
  return (
    <div class="page">
      <Ambient mood={seg === 'hold' && holdCodes.length && win ? dir : 'neutral'} />
      <TopBar caption="我的股票" actions={
        <button class="icon-btn" aria-label={seg === 'hold' ? '新增持倉（買進前檢查表）' : '加入自選股'} onClick={() => setAdding(true)}><IconPlus /></button>
      } />
      <PageHead twoLine eyebrow={seg === 'hold' ? '我的持股有沒有出事？' : '自選股出現了什麼新變化？'} title={user && summary.data ? conclusion : '我的股票'} />
      <DataStatus date={summary.data?.date} uses={PAGE_SOURCES.mine} />
      {summary.error ? <ErrorState error={summary.error} /> : null}

      <div class="segmented" role="group" aria-label="清單" style={{ marginTop: 'var(--s-5)' }}>
        <button aria-pressed={seg === 'watch'} onClick={() => setSeg('watch')}>自選<span class="count">{watch.length}</span></button>
        <button aria-pressed={seg === 'hold'} onClick={() => setSeg('hold')}>持股<span class="count">{holdCodes.length}</span></button>
      </div>

      {seg === 'hold' && !user ? <div style={{ marginTop: 'var(--s-5)' }}><Loading hero /></div> : null}
      {seg === 'hold' && holdCodes.length ? (
        <div style={{ marginTop: 'var(--s-5)' }}>
          <HeroChart label={`目前持股組合・${holdCodes.length} 檔`} win={win} period={period} onPeriod={setPeriod} seen={seen ?? null}
            format={(v) => fmtInt(v)} area caption="以現有股數 × 還原收盤價計算（除權息不造成斷層）；最新一日等於目前市值。" periodsLabel="持股組合走勢期間"
            emptyText={hist.size < holdCodes.length ? '載入持股歷史中' : '資料累積中'} />
        </div>
      ) : null}

      {seg === 'watch' && user && !watch.length ? (
        <WelcomeCard onSample={addSamples} onHot={() => setPicking(true)} hotCount={hotItems.length} sampleNames={sampleNames} />
      ) : null}

      {showChips ? (
        <div class="chips" role="group" aria-label="群組" style={{ marginTop: 'var(--s-3)' }}>
          {(watch.length ? ['全部', ...groups.filter((g) => g === '預設' ? watch.some((w) => w.group === '預設') : true)] : []).map((g) => (
            <button key={g} class="chip" aria-pressed={group === g} onClick={() => setGroup(g)}>{g}</button>
          ))}
          {hotItems.length ? (
            <button class="chip system" aria-pressed={group === HOT} onClick={() => setGroup(HOT)}>
              {lists.data?.hot_momentum.label ?? '熱門動能'}<span class="sys-mark">系統</span>
            </button>
          ) : null}
        </div>
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
          <p class="caption muted grow">{sort === 'change' ? `依${sinceLabel(snap ?? null)}的變化排序` : `依${SORTS.find((x) => x[0] === sort)![1]}排序`}・左滑可{seg === 'hold' ? '平倉' : '移除或移到其他群組'}・長按快速預覽</p>
          <select class="select sort-select" aria-label="排序" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as SortKey)}>
            {SORTS.filter(([k]) => seg === 'watch' || k !== 'custom').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      ) : group === HOT && rows.length ? <p class="caption muted" style={{ marginTop: 'var(--s-3)' }}>左滑或長按可加入自選</p> : null}

      <div class="stock-list">
        {user && seg === 'hold' && !holdCodes.length ? (
          <EmptyState icon={<IconClipboard />} title="還沒有持倉" text="新增持倉前需要完成買進前檢查表；之後持股的停損與風險旗標會出現在這裡與今晚頁。"
            action={<button class="btn primary" onClick={() => setAdding(true)}>開始買進前檢查表</button>} />
        ) : null}
        {group === HOT ? rows.map((r) => (
          <StockListRow key={r.code} code={r.code} row={r} hist={hist.get(r.code)} sub={sub(r.code, [])}
            onOpen={() => openStock(r.code)} onPreview={() => setPreview(r.code)} actions={actionsFor(r.code)} />
        )) : null}
        {group !== HOT ? main.map((c) => (
          <StockListRow key={c.code} code={c.code} row={c.row} hist={hist.get(c.code)} sub={sub(c.code, c.reasons.map((r) => r.text))}
            onOpen={() => openStock(c.code)} onPreview={() => setPreview(c.code)} actions={actionsFor(c.code)} ariaExtra={c.reasons.map((r) => r.text).join('、')} />
        )) : null}
        {group !== HOT && quiet.length ? (
          <>
            <button class="collapsed-row" aria-expanded={showQuiet || !main.length} onClick={() => setShowQuiet(!showQuiet)}>
              <span>{main.length ? `${quiet.length} 檔變化低於門檻` : `${quiet.length} 檔都沒有顯著變化`}</span><IconChevronDown />
            </button>
            {showQuiet || !main.length ? quiet.map((c) => (
              <StockListRow key={c.code} code={c.code} row={c.row} hist={hist.get(c.code)} sub={sub(c.code, [])}
                onOpen={() => openStock(c.code)} onPreview={() => setPreview(c.code)} actions={actionsFor(c.code)} />
            )) : null}
          </>
        ) : null}
        {missing.map((code) => {
          const info = inactive.data?.get(code);
          const t = seg === 'hold' ? open.find((x) => x.code === code) : undefined;
          return (
            <div key={code} class="card row between missing-card" data-testid="missing-card">
              <span class="grow" style={{ minWidth: 0 }}>
                <span class="body" style={{ display: 'block' }}>{info?.name ?? t?.name ?? code} <span class="caption muted">{code}</span></span>
                <span class="caption muted">{inactiveText(info)}{t ? `・持有 ${fmtInt(open.filter((x) => x.code === code).reduce((n, x) => n + x.shares, 0))} 股` : ''}</span>
              </span>
              {t ? <button class="btn small" onClick={() => setClosing(t)}>平倉</button>
                : <button class="btn small danger" onClick={() => removeWatch(code)}>移除</button>}
            </div>
          );
        })}
      </div>

      {seg === 'watch' && group === '全部' && watch.length && hotItems.length ? (
        <button class="card row between system-teaser" onClick={() => { setGroup(HOT); window.scrollTo({ top: 0 }); }}>
          <span>
            <span class="body" style={{ display: 'block' }}>{lists.data?.hot_momentum.label ?? '熱門動能'}・{hotItems.length} 檔</span>
            <span class="caption muted">系統清單：依規則產生，非推薦；可複製成自己的群組或挑幾檔加入</span>
          </span>
          <span class="brand" style={{ width: '1.25rem', display: 'inline-flex' }}><IconChevron /></span>
        </button>
      ) : null}

      <QuickPreview code={preview} row={previewRow} onClose={() => setPreview(null)} onOpen={() => { const c = preview!; setPreview(null); openStock(c); }}
        actions={previewTrade ? <button class="btn" onClick={() => { setPreview(null); setClosing(previewTrade); }}>平倉</button>
          : previewWatch ? <button class="btn danger" onClick={() => { removeWatch(previewWatch.code); setPreview(null); }}>移除自選</button>
          : preview ? <button class="btn" onClick={() => addWatch(preview)}>加入自選</button> : null} />
      {summary.data && prefs ? (
        seg === 'hold'
          ? <ChecklistSheet open={adding} onClose={() => setAdding(false)} rows={summary.data.rows} portfolio={prefs.portfolio} day={summary.data.date} />
          : <AddWatchSheet open={adding} onClose={() => setAdding(false)} rows={summary.data.rows} group={group === '全部' ? '預設' : group} groups={groups} />
      ) : null}
      <CloseSheet trade={closing} onClose={() => setClosing(null)} costs={prefs?.costs ?? DEFAULT_COSTS} price={closing ? byCode?.get(closing.code)?.close ?? null : null} day={summary.data?.date ?? ''} />
      <GroupSheet item={moving} groups={groups} onClose={() => setMoving(null)} />
      <HotPickSheet open={picking} onClose={() => setPicking(false)} items={hotItems} byCode={byCode} watched={watchedSet} />
    </div>
  );
}
