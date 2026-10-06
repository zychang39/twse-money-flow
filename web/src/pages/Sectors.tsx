/**
 * 族群輪動（M4）：層級「官方產業｜細產業｜題材與自訂」、排序「3 個月名次｜1 個月報酬｜法人買超」；
 * 每列＝名稱｜成員數｜3 個月中位數｜名次與 20 日名次變化｜站上 60 日線比例條｜新觸發檔數，點列進族群頁。
 * 右上「＋」建立自訂族群（存在本機 IndexedDB，可備份還原）。細產業約 500 個族群，用虛擬捲動。
 * 舊網址 #/explore/sectors/{產業名稱} 由 SectorGroup 轉成族群 id。
 */
import { useMemo, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { Conclusion, DataState, Interp, ProgressBar, Term } from '../components/kit';
import { Button, PageTitle, Section, Seg, Signed, Tag } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { VirtualList } from '../components/VirtualList';
import { IconPlus } from '../components/Icons';
import { useAsync, useDb, useSegParam } from '../hooks';
import { loadSectors } from '../data/api';
import { listGroups, saveGroup, uid } from '../db/db';
import { type GroupLayer, type GroupListRow, type GroupSort, LAYER_NAME, SORT_NAME, groupCrumb, isEtfGroup, rankDelta, rowFromCustom, rowFromSector, sortGroups } from '../lib/groups';
import { navigate } from '../router';
import SectorGroup from './SectorGroup';
import '../styles/sectors.css';
import { PageStale } from '../components/DataStatus';

const LAYERS = ['official', 'fine', 'theme'] as const;
const SORTS = ['rank', 'r1m', 'insti'] as const;
type N = number | null;
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

function GroupRow({ r, sort }: { r: GroupListRow; sort: GroupSort }) {
  const d = rankDelta(r.rank, r.rankPrev);
  const v: N = sort === 'r1m' ? r.med1m : sort === 'insti' ? r.insti20 : r.med3m;
  const vLabel = sort === 'r1m' ? '1 個月中位數' : sort === 'insti' ? '法人 20 日' : '3 個月中位數';
  return (
    <a class="grp-row" href={`#/explore/sectors/${encodeURIComponent(r.id)}`} data-testid={`grp-${r.id}`}>
      <span class="grp-l">
        <span class="grp-name">{r.name}{r.custom ? <Tag>自訂</Tag> : null}</span>
        <span class="grp-sub">{groupCrumb(r) ? `${groupCrumb(r)}・` : ''}{r.members} 檔{ok(r.newCount) && r.newCount > 0 ? `・新觸發 ${r.newCount}` : ''}{r.merged ? '・成員不足 5 檔' : ''}</span>
        {ok(r.above60) ? (
          <span class="grp-bar">
            <span class="grp-bar-t">站上 60 日線 {Math.round(r.above60)}%</span>
            <ProgressBar value={r.above60} label={`站上 60 日線 ${Math.round(r.above60)}%`} />
          </span>
        ) : null}
      </span>
      <span class="grp-r">
        <span class="grp-v" aria-label={`${vLabel}`}><Signed v={v} digits={1} unit="%" tone={sort === 'insti' ? 'updown' : 'plain'} /></span>
        <span class="grp-rank">{ok(r.rank) ? `${r.merged ? '依上層' : isEtfGroup(r) ? 'ETF ' : ''}第 ${r.rank} 名` : r.custom ? '未排名' : '—'}{ok(d) && d !== 0 ? <span class="grp-delta" aria-label={`20 日${d > 0 ? '上升' : '下降'} ${Math.abs(d)} 名`}>{d > 0 ? '▲' : '▼'}{Math.abs(d)}</span> : null}</span>
      </span>
    </a>
  );
}

export function SectorsList() {
  const idx = useAsync(loadSectors, []);
  const custom = useDb(listGroups, []) ?? [];
  const [layer, setLayer] = useSegParam<GroupLayer>(LAYERS, 'fine', 'layer', 'sectors-layer');
  const [sort, setSort] = useSegParam<GroupSort>(SORTS, 'rank', 'sort', 'sectors-sort');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const rows = useMemo(() => {
    const d = idx.data;
    if (!d) return [];
    const base = d.groups.filter((g) => g.layer === layer).map(rowFromSector);
    const mine = layer === 'theme' ? custom.filter((u) => u.kind === 'custom').map((u) => rowFromCustom(u, d)) : [];
    return [...mine, ...sortGroups(base, sort)];
  }, [idx.data, layer, sort, custom]);
  // 領先：股票族群（ETF 分類另外排名，不列入）
  const top = rows.filter((r) => !r.custom && !isEtfGroup(r) && !r.merged && ok(r.rank)).sort((a, b) => (a.rank as number) - (b.rank as number)).slice(0, 3);
  const create = async () => {
    const n = name.trim();
    if (!n) return;
    const id = `u-${uid()}`;
    const now = new Date().toISOString();
    await saveGroup({ id, kind: 'custom', name: n, members: [], createdAt: now, updatedAt: now });
    setAdding(false);
    setName('');
    navigate(`/explore/sectors/${id}?edit=1`);
  };
  const phase = idx.loading ? 'loading' : idx.error ? 'error' : rows.length ? 'ok' : 'empty';
  return (
    <div class="page">
      <TopBar back="/explore" actions={<button class="icon-btn" aria-label="建立自訂族群" onClick={() => setAdding(true)} data-testid="add-group"><IconPlus /></button>} />
      <PageTitle title="族群輪動" sub={idx.data ? `資料至 ${md(idx.data.date)}・名次依成員近 3 個月報酬中位數（成員 ≥ ${idx.data.min_ranked} 檔）` : ' '} />
      <PageStale />
      <Seg options={LAYERS.map((l) => [l, LAYER_NAME[l]] as const)} value={layer} onChange={setLayer} label="層級" testid="layer-seg" />
      <Section title={LAYER_NAME[layer]} testid="groups-sec" info={
        <>
          <p>官方產業＝證交所／櫃買中心產業別；細產業＝櫃買中心產業價值鏈的子類（另有人工補充），每檔股票都有細產業；成員少於 5 檔的子類別併入同類別的「（其他）」。題材＝人工整理的上中下游清單，以及產業價值鏈的主題型產業鏈（人工智慧、雲端運算、資安等，一條鏈一個題材）。</p>
          <p>3 個月中位數＝成員近 63 個交易日還原報酬的中位數；名次在同一層級中由高到低排列，成員少於 5 檔的族群依上一層排名；ETF 分類只和 ETF 分類比，排在股票族群之後。20 日名次變化＝和 20 個交易日前的名次相比。</p>
          <p>法人買超＝三大法人近 20 日淨買超金額 ÷ 成交金額。新觸發＝上架策略今日新觸發的成員檔數。</p>
        </>
      }>
        {top.length ? <Conclusion>領先：{top.map((r) => r.name).join('、')}</Conclusion> : null}
        <Interp>依「<Term id="sector_rank">{SORT_NAME[sort]}</Term>」排序・共 {rows.length} 個族群</Interp>
        <div class="chips grp-sorts" role="group" aria-label="排序">
          {SORTS.map((s) => <button key={s} type="button" class="chip" aria-pressed={sort === s} onClick={() => setSort(s)}>{SORT_NAME[s]}</button>)}
        </div>
        <DataState phase={phase} reason={phase === 'empty' ? (layer === 'theme' ? '還沒有題材或自訂族群' : '沒有族群資料') : idx.error ? '族群資料讀取失敗' : undefined} onRetry={() => location.reload()}>
          <div class="ui-list grp-list">
            <VirtualList items={rows} keyOf={(r) => r.id} estimate={92} label={`${LAYER_NAME[layer]}族群`} testid="group-list"
              render={(r) => <GroupRow r={r} sort={sort} />} />
          </div>
        </DataState>
        {layer === 'theme' && !custom.some((u) => u.kind === 'custom') ? (
          <Button variant="plain" block onClick={() => setAdding(true)} testid="add-group-row">建立自訂族群</Button>
        ) : null}
      </Section>
      <Sheet open={adding} onClose={() => setAdding(false)} title="建立自訂族群">
        <form class="grp-form" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <label class="field">
            <span class="ui-foot ui-muted">名稱</span>
            <input class="input" value={name} maxLength={20} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="例：我的 AI 伺服器" data-testid="group-name" />
          </label>
          <p class="ui-foot ui-muted">建立後可加入成員、分段（上游／中游／下游）與備註；資料只存在這台裝置，可在「備份」匯出。</p>
          <Button variant="fill" block disabled={!name.trim()} onClick={() => void create()} testid="group-create">建立</Button>
        </form>
      </Sheet>
    </div>
  );
}

/** 路由：#/explore/sectors（清單）與 #/explore/sectors/{id}（族群頁） */
export default function Sectors({ industry }: { industry?: string }) {
  return industry ? <SectorGroup id={decodeURIComponent(industry)} /> : <SectorsList />;
}
