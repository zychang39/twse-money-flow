/**
 * 選股（M4）：策略膠囊（含「全部」）→ 分段「新觸發 n｜篩出 n」→ 立刻是股票清單（第一個螢幕至少 4 檔）。
 * 每列：名稱與代號｜價格與漲跌｜細產業｜觸發的策略與分級標籤｜觸發日與「第 k 日」（篩出才有）｜觸發以來報酬。可依細產業分組。
 * 資料：screen.json（各上架策略的目前篩出與今日新觸發；pipeline evidence/periods.screen_now）。依規則產生，非推薦。
 * 自己組條件的篩選在子頁 #/explore/screener/custom。
 */
import { useMemo } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { Conclusion, DataState, Interp, Term } from '../components/kit';
import { List, NavRow, PageTitle, Section, Seg } from '../components/ui';
import { ScreenList } from '../components/ScreenList';
import { useAsync, useSegParam } from '../hooks';
import { loadJson } from '../data/api';
import { GRADE_ORDER, type ScreenFile, screenItems } from '../lib/screen';
import '../styles/screener.css';

export { screenItems };
export type { ScreenFile, ScreenItem, ScreenStrategy } from '../lib/screen';

const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

export default function Screener() {
  const file = useAsync(() => loadJson<ScreenFile>('screen.json').catch(() => null), []);
  const strategies = (file.data?.strategies ?? []).slice().sort((a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) || (a.rank ?? 99) - (b.rank ?? 99));
  const ids = ['all', ...strategies.map((s) => s.id)];
  const [pick, setPick] = useSegParam<string>(ids, 'all', 'st');
  const [view, setView] = useSegParam<'new' | 'all'>(['new', 'all'] as const, 'new', 'view', 'screener-view');
  const [group, setGroup] = useSegParam<'list' | 'fine'>(['list', 'fine'] as const, 'list', 'group', 'screener-group');
  const nNew = useMemo(() => screenItems(file.data, pick, 'new').length, [file.data, pick]);
  const items = useMemo(() => screenItems(file.data, pick, view), [file.data, pick, view]);
  const nAll = useMemo(() => screenItems(file.data, pick, 'all').length, [file.data, pick]);
  const date = strategies[0]?.date ?? null;
  const phase = file.loading ? 'loading' : file.error ? 'error' : !strategies.length ? 'empty' : 'ok';
  const cur = strategies.find((s) => s.id === pick);
  return (
    <div class="page">
      <TopBar back="/explore" />
      <PageTitle title="選股" sub={date ? `資料至 ${md(date)}・依規則產生，非推薦` : '依規則產生，非推薦'} />
      <div class="chips scr-chips wrap" role="group" aria-label="策略" data-testid="strategy-chips">
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
        {items.length ? <ScreenList items={items} view={view} group={group === 'fine'} context="選股" /> : <List><NavRow title={view === 'new' ? '今日沒有新觸發；看「篩出」' : '目前沒有篩出的股票'} onClick={() => setView(view === 'new' ? 'all' : 'new')} /></List>}
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
