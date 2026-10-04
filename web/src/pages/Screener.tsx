/**
 * 選股（M4）：策略膠囊（含「全部」）→ 分段「新觸發 n｜篩出 n」→ 立刻是股票清單（第一個螢幕至少 4 檔）。
 * 每列：名稱與代號｜價格與漲跌｜細產業｜觸發的策略與分級標籤｜觸發日與「第 k 日」（篩出才有）｜觸發以來報酬。可依細產業分組。
 * 資料：screen.json（各上架策略的目前篩出與今日新觸發；pipeline evidence/periods.screen_now）。依規則產生，非推薦。
 * 自己組條件的篩選在子頁 #/explore/screener/custom。
 */
import { useMemo } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { Conclusion, DataState, Interp, Term } from '../components/kit';
import { GradeTag } from '../components/StrategyBits';
import { List, NavRow, PageTitle, Section, Seg, Signed } from '../components/ui';
import { ChangePill } from '../components/Change';
import { useAsync, useSegParam } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { loadJson, loadSectors } from '../data/api';
import type { Grade } from '../lib/strategies';
import { setListContext } from '../lib/listContext';
import { fmtPrice } from '../lib/format';
import { tradeStatusLabel } from '../lib/tradeStatus';
import '../styles/screener.css';

/** screen.json（pipeline evidence/run.py） */
export interface ScreenStrategy { id: string; label: string; subtitle?: string; grade: Grade; limited?: boolean; rank?: number | null; date: string; cols: string[]; rows: [string, string, number, number | null][]; new: string[] }
export interface ScreenFile { strategies: ScreenStrategy[] }

const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const GRADE_ORDER: Grade[] = ['valid', 'sig_only', 'watch', 'invalid'];

interface Hit { id: string; label: string; grade: Grade; trigger: string; day: number; ret: number | null; isNew: boolean }
export interface ScreenItem { code: string; hits: Hit[] }

/** 依策略篩選、合併成每檔一列（同一檔被多個策略篩出時列出全部策略；排序：新觸發在前 → 觸發日新到舊 → 分級） */
export function screenItems(file: ScreenFile | null | undefined, pick: string, view: 'new' | 'all'): ScreenItem[] {
  const by = new Map<string, Hit[]>();
  for (const s of file?.strategies ?? []) {
    if (pick !== 'all' && s.id !== pick) continue;
    const fresh = new Set(s.new);
    for (const [code, trigger, day, ret] of s.rows) {
      const isNew = fresh.has(code);
      if (view === 'new' && !isNew) continue;
      const list = by.get(code) ?? [];
      list.push({ id: s.id, label: s.label, grade: s.grade, trigger, day, ret, isNew });
      by.set(code, list);
    }
  }
  const rank = (h: Hit[]) => Math.min(...h.map((x) => GRADE_ORDER.indexOf(x.grade)));
  const latest = (h: Hit[]) => h.map((x) => x.trigger).sort().at(-1) ?? '';
  return [...by.entries()].map(([code, hits]) => ({ code, hits: hits.sort((a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade)) }))
    .sort((a, b) => latest(b.hits).localeCompare(latest(a.hits)) || rank(a.hits) - rank(b.hits) || a.code.localeCompare(b.code));
}

export default function Screener() {
  const file = useAsync(() => loadJson<ScreenFile>('screen.json').catch(() => null), []);
  const summary = useScoredSummary();
  const sectors = useAsync(() => loadSectors().catch(() => null), []);
  const strategies = (file.data?.strategies ?? []).slice().sort((a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) || (a.rank ?? 99) - (b.rank ?? 99));
  const ids = ['all', ...strategies.map((s) => s.id)];
  const [pick, setPick] = useSegParam<string>(ids, 'all', 'st');
  const [view, setView] = useSegParam<'new' | 'all'>(['new', 'all'] as const, 'new', 'view', 'screener-view');
  const [group, setGroup] = useSegParam<'list' | 'fine'>(['list', 'fine'] as const, 'list', 'group', 'screener-group');
  const nNew = useMemo(() => screenItems(file.data, pick, 'new').length, [file.data, pick]);
  const items = useMemo(() => screenItems(file.data, pick, view), [file.data, pick, view]);
  const nAll = useMemo(() => screenItems(file.data, pick, 'all').length, [file.data, pick]);
  const byCode = summary.data?.byCode;
  const groupName = (code: string): { id: string; name: string } | null => {
    const fid = sectors.data?.stocks[code]?.[0]?.[0];
    const g = fid ? sectors.data?.groups.find((x) => x.id === fid) : null;
    return g ? { id: g.id, name: g.name } : null;
  };
  const date = strategies[0]?.date ?? null;
  const codes = items.map((i) => i.code);
  const sections = useMemo(() => {
    if (group !== 'fine') return [{ key: 'all', name: '', items }];
    const m = new Map<string, { key: string; name: string; items: ScreenItem[] }>();
    for (const it of items) {
      const g = groupName(it.code);
      const k = g?.id ?? 'x';
      if (!m.has(k)) m.set(k, { key: k, name: g?.name ?? '未分類', items: [] });
      m.get(k)!.items.push(it);
    }
    return [...m.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name, 'zh-Hant'));
  }, [items, group, sectors.data]);
  const phase = file.loading ? 'loading' : file.error ? 'error' : !strategies.length ? 'empty' : 'ok';
  const cur = strategies.find((s) => s.id === pick);
  return (
    <div class="page">
      <TopBar back="/explore" />
      <PageTitle title="選股" sub={date ? `資料至 ${md(date)}・依規則產生，非推薦` : '依規則產生，非推薦'} />
      <div class="chips scr-chips" role="group" aria-label="策略" data-testid="strategy-chips">
        {ids.map((id) => {
          const s = strategies.find((x) => x.id === id);
          return <button key={id} type="button" class="chip" aria-pressed={pick === id} onClick={() => setPick(id)}>{s ? s.label : '全部'}</button>;
        })}
      </div>
      <Seg options={[['new', `新觸發 ${nNew}`], ['all', `篩出 ${nAll}`]] as const} value={view} onChange={setView} label="新觸發或篩出" testid="screen-view" />
      <DataState phase={phase} reason={phase === 'empty' ? '策略篩出資料累積中（部署時由回測產生）' : '選股資料讀取失敗'} onRetry={() => location.reload()}>
        <div class="scr-meta">
          <Interp>{view === 'new' ? <><Term id="new_trigger">新觸發</Term>＝{date ? md(date) : '最新交易日'}條件首次成立</> : <><Term id="screened">篩出</Term>＝仍符合條件，或觸發後還在持有期內</>}{cur ? `・${cur.subtitle ?? ''}` : ''}</Interp>
          <button type="button" class="text-btn" onClick={() => setGroup(group === 'fine' ? 'list' : 'fine')} aria-pressed={group === 'fine'} data-testid="group-by-fine">{group === 'fine' ? '不分組' : '依細產業分組'}</button>
        </div>
        {items.length ? sections.map((sec) => (
          <div key={sec.key} class="scr-sec" data-testid={group === 'fine' ? `scr-group-${sec.key}` : undefined}>
            {sec.name ? <p class="scr-group-h"><a href={`#/explore/sectors/${encodeURIComponent(sec.key)}`}>{sec.name}</a><span class="ui-muted">・{sec.items.length} 檔</span></p> : null}
            <div class="ui-list" data-testid="screen-rows">
              {sec.items.map((it) => {
                const r = byCode?.get(it.code);
                const g = groupName(it.code);
                const first = it.hits[0];
                return (
                  <a key={it.code} class="scr-row" href={`#/stock/${it.code}`} onClick={() => setListContext({ name: '選股', codes })} data-testid={`scr-${it.code}`}>
                    <span class="scr-l">
                      <span class="scr-name">{(r?.name as string) ?? it.code} <span class="ui-muted ui-foot">{it.code}</span></span>
                      <span class="scr-sub">{g?.name ?? '—'}</span>
                      <span class="scr-tags">{it.hits.map((h) => <span key={h.id} class="scr-tag"><span class="scr-tag-n">{h.label}</span><GradeTag grade={h.grade} /></span>)}</span>
                      {view === 'all' ? <span class="scr-sub">{md(first.trigger)} 觸發・第 {first.day} 日</span> : null}
                    </span>
                    <span class="scr-r">
                      <span class="scr-price">{r ? fmtPrice(r.close) : '—'}</span>
                      {r ? <ChangePill change={r.change} pct={r.change_pct} status={tradeStatusLabel(r)} /> : null}
                      {view === 'all' ? <span class="scr-ret"><span class="ui-muted">觸發以來</span> <Signed v={first.ret} digits={1} unit="%" /></span> : null}
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        )) : <List><NavRow title={view === 'new' ? '今日沒有新觸發；看「篩出」' : '目前沒有篩出的股票'} onClick={() => setView(view === 'new' ? 'all' : 'new')} /></List>}
      </DataState>
      <Section title="更多">
        <Conclusion>{ok(strategies.length) ? `${strategies.length} 個上架策略` : '策略'}</Conclusion>
        <List chev>
          <NavRow title="策略庫" sub="分級、判定卡、各期間績效" href="#/explore/strategies" />
          <NavRow title="自訂條件" sub="自己組條件篩選、一鍵回測、設為追蹤" href="#/explore/screener/custom" testid="to-custom" />
        </List>
      </Section>
    </div>
  );
}
