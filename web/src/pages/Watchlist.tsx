import { useMemo, useState } from 'preact/hooks';
import { Nav } from '../components/Nav';
import { DataStatus, ErrorState, Loading } from '../components/DataStatus';
import { Change, Signed } from '../components/Change';
import { Composite, ScoreRow } from '../components/Scores';
import { Flags } from '../components/Flags';
import { Sheet } from '../components/Sheet';
import { StockSearch } from '../components/StockSearch';
import { IconPlus } from '../components/Icons';
import { useDb } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { addWatch, listWatch, removeWatch, updateWatch, type WatchItem } from '../db/db';
import { fmtLots } from '../lib/format';
import { parseImport } from '../lib/importer';
import type { StockRow } from '../data/types';

type SortKey = 'custom' | 'change' | 'composite' | 'foreign' | 'trust';
const SORTS: { id: SortKey; label: string }[] = [
  { id: 'custom', label: '自訂' },
  { id: 'change', label: '漲跌幅' },
  { id: 'composite', label: '綜合分' },
  { id: 'foreign', label: '外資' },
  { id: 'trust', label: '投信' },
];

export function sortRows(items: { w: WatchItem; r: StockRow | undefined }[], key: SortKey) {
  const val = (x: { r: StockRow | undefined }): number => {
    const r = x.r;
    if (!r) return -Infinity;
    switch (key) {
      case 'change': return r.change_pct ?? -Infinity;
      case 'composite': return (r.composite as number | null) ?? -Infinity;
      case 'foreign': return r.foreign_net_lots ?? -Infinity;
      case 'trust': return r.trust_net_lots ?? -Infinity;
      default: return 0;
    }
  };
  if (key === 'custom') return [...items].sort((a, b) => a.w.order - b.w.order);
  return [...items].sort((a, b) => val(b) - val(a));
}

export function StockCard({ r, code, onRemove, editing, groups, onGroup }: {
  r: StockRow | undefined; code: string; editing?: boolean; onRemove?: () => void; groups?: string[]; onGroup?: (g: string) => void;
}) {
  if (!r) {
    return (
      <div class="card">
        <div class="row between"><span class="bold">{code}</span><span class="muted small">無資料（可能已下市或代號錯誤）</span></div>
        {editing && onRemove ? <button class="btn small danger" onClick={onRemove}>移除</button> : null}
      </div>
    );
  }
  return (
    <div class="card">
      <a href={`#/stock/${r.code}`} style={{ color: 'inherit', display: 'block' }} aria-label={`${r.name} ${r.code} 詳細資料`}>
        <div class="row between">
          <div class="grow">
            <div class="headline">{r.name} <span class="muted small num">{r.code}</span></div>
            <div class="small"><Change change={r.change} pct={r.change_pct} showPrice={r.close} /></div>
          </div>
          <Composite value={r.composite as number | null} />
        </div>
        <div style={{ marginTop: '0.625rem' }}><ScoreRow row={r} /></div>
        <div class="row wrap small" style={{ marginTop: '0.625rem', gap: '0.75rem' }}>
          <span>外資 <Signed value={r.foreign_net_lots} format={fmtLots} label="外資" /> 張{r.foreign_streak ? <span class="muted">（{r.foreign_streak > 0 ? `連買 ${r.foreign_streak}` : `連賣 ${-r.foreign_streak}`}）</span> : null}</span>
          <span>投信 <Signed value={r.trust_net_lots} format={fmtLots} label="投信" /> 張{r.trust_streak ? <span class="muted">（{r.trust_streak > 0 ? `連買 ${r.trust_streak}` : `連賣 ${-r.trust_streak}`}）</span> : null}</span>
          <span>融資 <Signed value={r.margin_change} format={fmtLots} label="融資" /> 張</span>
        </div>
        <Flags flags={r.flags} compact />
      </a>
      {editing ? (
        <div class="row wrap" style={{ marginTop: '0.5rem' }}>
          {groups && onGroup ? (
            <select class="select" style={{ width: 'auto' }} aria-label="群組" onChange={(e) => onGroup((e.target as HTMLSelectElement).value)}>
              {groups.map((g) => <option key={g}>{g}</option>)}
            </select>
          ) : null}
          {onRemove ? <button class="btn small danger" onClick={onRemove}>移除</button> : null}
        </div>
      ) : null}
    </div>
  );
}

export default function Watchlist() {
  const summary = useScoredSummary();
  const items = useDb(listWatch) ?? [];
  const [group, setGroup] = useState('全部');
  const [sort, setSort] = useState<SortKey>('custom');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [importText, setImportText] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const groups = useMemo(() => Array.from(new Set(['預設', ...items.map((i) => i.group)])), [items]);

  const rows = useMemo(() => {
    const byCode = summary.data?.byCode;
    const joined = items.filter((w) => group === '全部' || w.group === group).map((w) => ({ w, r: byCode?.get(w.code) }));
    return sortRows(joined, sort);
  }, [items, summary.data, group, sort]);

  async function doImport() {
    const known = new Set(summary.data?.rows.map((r) => r.code));
    const byName = new Map(summary.data?.rows.map((r) => [r.name, r.code]));
    const parsed = parseImport(importText, known, byName);
    for (const p of parsed.codes) await addWatch(p.code, p.group ?? (newGroup || '預設'));
    setImportText('');
    alert(`已加入 ${parsed.codes.length} 檔${parsed.unknown.length ? `；無法辨識：${parsed.unknown.join('、')}` : ''}`);
  }

  return (
    <div>
      <Nav
        title="自選"
        actions={
          <>
            <button class="btn small" onClick={() => setEditing(!editing)} aria-pressed={editing}>{editing ? '完成' : '編輯'}</button>
            <button class="icon-btn" aria-label="新增自選股" onClick={() => setAdding(true)}><IconPlus /></button>
          </>
        }
      />
      <DataStatus date={summary.data?.date} />
      <div class="chips" role="group" aria-label="群組" style={{ marginTop: '0.5rem' }}>
        {['全部', ...groups].map((g) => (
          <button key={g} class="chip" aria-pressed={group === g} onClick={() => setGroup(g)}>{g}</button>
        ))}
      </div>
      <div class="segmented" role="group" aria-label="排序" style={{ marginTop: '0.5rem' }}>
        {SORTS.map((s) => (
          <button key={s.id} aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>{s.label}</button>
        ))}
      </div>
      {summary.error ? <ErrorState error={summary.error} /> : null}
      {summary.loading && !summary.data ? <Loading /> : null}
      {!items.length ? (
        <div class="empty">
          <p>尚未加入自選股。</p>
          <button class="btn primary" onClick={() => setAdding(true)}>新增自選股</button>
        </div>
      ) : null}
      {rows.map(({ w, r }) => (
        <StockCard key={w.code} code={w.code} r={r} editing={editing} groups={groups}
          onRemove={() => removeWatch(w.code)} onGroup={(g) => updateWatch({ ...w, group: g })} />
      ))}
      <Sheet open={adding} onClose={() => setAdding(false)} title="新增自選股">
        {summary.data ? <StockSearch rows={summary.data.rows} onPick={(r) => addWatch(r.code, group === '全部' ? '預設' : group)} /> : <Loading />}
        <label class="field">
          <span>新群組名稱（選填，新增或匯入時使用）</span>
          <input class="input" value={newGroup} onInput={(e) => setNewGroup((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>貼上文字、代號清單或 CSV（每行或以逗號分隔；CSV 可含「代號,群組」）</span>
          <textarea class="input" rows={5} value={importText} onInput={(e) => setImportText((e.target as HTMLTextAreaElement).value)} placeholder={'2330 台積電\n2317, 0050\n代號,群組\n2454,半導體'} />
        </label>
        <button class="btn primary" disabled={!importText.trim()} onClick={doImport}>匯入</button>
      </Sheet>
    </div>
  );
}
