/**
 * 我的股票：持股與自選合併在同一頁（分段控制切換）。回答「我的持股有沒有出事？」與「自選股有什麼新變化？」。
 * 環境光與走勢線同一個期間、同一個顏色（持股組合在所選期間的漲跌）。
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Ambient, PageHead, SearchFloat, TopBar } from '../components/Chrome';
import { DataStatus, EmptyState, ErrorState, Loading } from '../components/DataStatus';
import { HeroChart, usePeriod } from '../components/HeroChart';
import { StockListRow, type RowAction } from '../components/StockRow';
import { QuickPreview } from '../components/QuickPreview';
import { Sheet } from '../components/Sheet';
import { StockSearch } from '../components/StockSearch';
import { ChecklistSheet, CloseSheet } from '../components/Trades';
import { IconChevronDown, IconClipboard, IconPlus, IconStar } from '../components/Icons';
import { useDb, useHistories } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { useUser } from '../data/useUser';
import { addWatch, getSetting, removeWatch, updateWatch, type Trade, type WatchItem } from '../db/db';
import type { StockRow } from '../data/types';
import { DEFAULT_PORTFOLIO, type PortfolioSettings } from '../lib/settings';
import { DEFAULT_COSTS, type CostSettings } from '../lib/costs';
import { holdingsSeries } from '../lib/portfolioSeries';
import { PERIOD_LABEL, change, sliceWindow } from '../lib/periods';
import { mineConclusion } from '../lib/conclusion';
import { diffAll, makeSnapshot, sinceLabel, type Snapshot } from '../lib/changes';
import { holdingAlerts } from '../lib/holdings';
import { parseImport } from '../lib/importer';
import { baseline, commit, commitHero, heroSeen } from '../lib/seen';
import { setListContext } from '../lib/listContext';
import { fmtInt } from '../lib/format';
import { navigate, useRoute } from '../router';

type Seg = 'hold' | 'watch';

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
    await updateWatch({ ...item, group: g.trim() });
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

export default function Mine() {
  const route = useRoute();
  const seg: Seg = route.query.get('seg') === 'watch' ? 'watch' : 'hold';
  const summary = useScoredSummary();
  const user = useUser();
  const prefs = useDb(async () => ({
    portfolio: await getSetting<PortfolioSettings>('portfolio', DEFAULT_PORTFOLIO),
    costs: await getSetting<CostSettings>('costs', DEFAULT_COSTS),
  }));
  const [period, setPeriod] = usePeriod('portfolio');
  const [group, setGroup] = useState('全部');
  const [adding, setAdding] = useState(route.query.get('add') === '1');
  const [preview, setPreview] = useState<string | null>(null);
  const [closing, setClosing] = useState<Trade | null>(null);
  const [moving, setMoving] = useState<WatchItem | null>(null);
  const [showQuiet, setShowQuiet] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null | undefined>(undefined);
  const [seen, setSeen] = useState<number | null | undefined>(undefined);
  useEffect(() => { baseline('mine').then(setSnap); heroSeen('portfolio').then(setSeen); }, []);

  const byCode = summary.data?.byCode;
  const open = useMemo(() => (user?.trades ?? []).filter((t) => t.status === 'open'), [user]);
  const holdCodes = useMemo(() => [...new Set(open.map((t) => t.code))], [open]);
  const watch = user?.watch ?? [];
  const groups = useMemo(() => Array.from(new Set(['預設', ...watch.map((w) => w.group)])), [watch]);
  const watchShown = watch.filter((w) => group === '全部' || w.group === group);
  const hist = useHistories(useMemo(() => [...holdCodes, ...watch.map((w) => w.code)].filter((c, i, a) => a.indexOf(c) === i), [holdCodes, watch]));

  // 所有持股的歷史都載入後才計算，避免組合市值暫時偏低（也避免把不完整的值記成「上次查看」）
  const histReady = holdCodes.every((c) => hist.has(c));
  const series = useMemo(() => (histReady ? holdingsSeries(open, holdCodes.map((c) => hist.get(c) ?? null)) : null), [open, holdCodes, hist, histReady]);
  const win = series ? sliceWindow(series.dates, series.values, period) : null;
  const dir = win ? change(win.values).dir : 'flat';
  const alerts = useMemo(() => (byCode ? holdingAlerts(open, byCode) : []), [open, byCode]);
  const alertBy = new Map(alerts.map((a) => [a.trade.code, a]));
  const risky = new Set(alerts.filter((a) => a.risk).map((a) => a.trade.code));

  const rows = useMemo(() => {
    if (!byCode) return [];
    const codes = seg === 'hold' ? holdCodes : watchShown.map((w) => w.code);
    return codes.map((c) => byCode.get(c)).filter((r): r is StockRow => !!r);
  }, [byCode, seg, holdCodes, watchShown]);
  const changes = useMemo(() => (snap === undefined ? [] : diffAll(rows, snap)), [rows, snap]);
  const ordered = seg === 'hold'
    ? [...changes].sort((a, b) => Number(risky.has(b.code)) - Number(risky.has(a.code)) || Number(b.significant) - Number(a.significant) || b.score - a.score)
    : changes;
  const main = ordered.filter((c) => c.significant || risky.has(c.code));
  const quiet = ordered.filter((c) => !c.significant && !risky.has(c.code));
  const missing = seg === 'watch' ? watchShown.filter((w) => !byCode?.get(w.code)).map((w) => w.code) : [];

  useEffect(() => {
    if (!summary.data || !user || snap === undefined) return;
    const all = [...holdCodes, ...watch.map((w) => w.code)].map((c) => summary.data!.byCode.get(c)).filter((r): r is StockRow => !!r);
    commit('mine', makeSnapshot(all, summary.data.date));
  }, [summary.data, user, snap]);
  const latestValue = series ? series.values[series.values.length - 1] : null;
  useEffect(() => { if (seen !== undefined) commitHero('portfolio', latestValue); }, [seen, latestValue]);

  const [c1, c2] = mineConclusion({ holdings: holdCodes.length, alerts: risky.size, dir, periodName: PERIOD_LABEL[period] });
  const setSeg = (s: Seg) => navigate(s === 'watch' ? '/mine?seg=watch' : '/mine', true);
  const listCodes = ordered.map((c) => c.code);
  const openStock = (code: string) => { setListContext({ name: seg === 'hold' ? '持股' : '自選', codes: listCodes }); navigate(`/stock/${code}`); };
  const previewRow = preview ? byCode?.get(preview) : undefined;
  const previewTrade = preview ? open.find((t) => t.code === preview) : undefined;
  const previewWatch = preview ? watch.find((w) => w.code === preview) : undefined;

  function actionsFor(code: string): RowAction[] {
    if (seg === 'hold') {
      const t = open.find((x) => x.code === code);
      return t ? [{ id: 'close', label: '平倉', kind: 'move', onClick: () => setClosing(t) }] : [];
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
    return watch.find((w) => w.code === code)?.group ?? '';
  };

  return (
    <div class="page">
      <Ambient mood={holdCodes.length && win ? dir : 'neutral'} />
      <TopBar caption="我的股票" actions={
        <button class="icon-btn" aria-label={seg === 'hold' ? '新增持倉（買進前檢查表）' : '加入自選股'} onClick={() => setAdding(true)}><IconPlus /></button>
      } />
      <PageHead twoLine eyebrow={seg === 'hold' ? '我的持股有沒有出事？' : '自選股出現了什麼新變化？'} title={user && summary.data ? <>{c1}<br />{c2}</> : '我的股票'} />
      <DataStatus date={summary.data?.date} />
      {summary.error ? <ErrorState error={summary.error} /> : null}

      {!user && seg === 'hold' ? <div style={{ marginTop: 'var(--s-5)' }}><Loading hero /></div> : null}
      {holdCodes.length ? (
        <div style={{ marginTop: 'var(--s-5)' }}>
          <HeroChart label={`目前持股組合・${holdCodes.length} 檔`} win={win} period={period} onPeriod={setPeriod} seen={seen ?? null}
            format={(v) => fmtInt(v)} area caption="以現有股數 × 還原收盤價計算（除權息不造成斷層）；最新一日等於目前市值。" periodsLabel="持股組合走勢期間"
            emptyText={hist.size < holdCodes.length ? '載入持股歷史中' : '資料累積中'} />
        </div>
      ) : null}

      <div class="segmented" role="group" aria-label="清單" style={{ marginTop: 'var(--s-8)' }}>
        <button aria-pressed={seg === 'hold'} onClick={() => setSeg('hold')}>持股<span class="count">{holdCodes.length}</span></button>
        <button aria-pressed={seg === 'watch'} onClick={() => setSeg('watch')}>自選<span class="count">{watch.length}</span></button>
      </div>

      {seg === 'watch' && watch.length ? (
        <div class="chips" role="group" aria-label="群組" style={{ marginTop: 'var(--s-3)' }}>
          {['全部', ...groups].map((g) => <button key={g} class="chip" aria-pressed={group === g} onClick={() => setGroup(g)}>{g}</button>)}
        </div>
      ) : null}

      {rows.length ? <p class="caption muted" style={{ marginTop: 'var(--s-4)' }}>依{sinceLabel(snap ?? null)}的變化排序・左滑可{seg === 'hold' ? '平倉' : '移除或移到其他群組'}・長按快速預覽</p> : null}

      <div class="stock-list">
        {user && seg === 'hold' && !holdCodes.length ? (
          <EmptyState icon={<IconClipboard />} title="還沒有持倉" text="新增持倉前需要完成買進前檢查表；之後持股的停損與風險旗標會出現在這裡與今晚頁。"
            action={<button class="btn primary" onClick={() => setAdding(true)}>開始買進前檢查表</button>} />
        ) : null}
        {user && seg === 'watch' && !watch.length ? (
          <EmptyState icon={<IconStar />} title="還沒有自選股" text="加入想追蹤的股票；每晚只會列出有顯著變化的。" action={<button class="btn primary" onClick={() => setAdding(true)}>加入自選股</button>} />
        ) : null}
        {main.map((c) => (
          <StockListRow key={c.code} code={c.code} row={c.row} hist={hist.get(c.code)} sub={sub(c.code, c.reasons.map((r) => r.text))}
            onOpen={() => openStock(c.code)} onPreview={() => setPreview(c.code)} actions={actionsFor(c.code)} ariaExtra={c.reasons.map((r) => r.text).join('、')} />
        ))}
        {quiet.length ? (
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
        {missing.map((code) => (
          <div key={code} class="card row between"><span class="body">{code}</span><span class="caption muted">無資料（可能已下市或代號錯誤）</span><button class="btn small danger" onClick={() => removeWatch(code)}>移除</button></div>
        ))}
      </div>

      <SearchFloat />

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
    </div>
  );
}
