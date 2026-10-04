/**
 * 族群頁（M4）：#/explore/sectors/{id}。內建族群（細產業、官方產業、題材）或自訂族群（u-…，存在本機）。
 * 頁首（層級路徑、名稱、名次、成員數）→ 結論行 → 主圖＝族群等權指數對加權指數（同一起點 100）
 * → 分段「成員｜上中下游｜統計」（?tab=）。右上「編輯」可增刪成員、設定分段與備註（內建族群的編輯另存，可還原）。
 * 上中下游只列成員與使用者自己的備註，不做「受惠程度」之類的評等。
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { Conclusion, DataState, Interp, Term } from '../components/kit';
import { Button, EmptyRow, List, Num, Row, Section, Seg, Signed, Table, Tag } from '../components/ui';
import { SeriesChart } from '../components/SeriesChart';
import { Sheet } from '../components/Sheet';
import { StockSearch } from '../components/StockSearch';
import { useAsync, useDb, useHistories, useSegParam } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { loadIndex, loadSector, loadSectors } from '../data/api';
import type { SectorDetail, SectorMember, SectorsIndex } from '../data/types';
import { TAIEX } from '../data/types';
import { type UserGroup, deleteGroup, getGroup, saveGroup } from '../db/db';
import { LAYER_NAME, STREAMS, applyMembers, applyStreams, customStats, equalWeightIndex, median, resolveGroupId } from '../lib/groups';
import { setListContext } from '../lib/listContext';
import { fmtNum, fmtPrice } from '../lib/format';
import { navigate, useRoute } from '../router';
import '../styles/sectors.css';
import { markOnboard } from '../lib/flowTrack';

const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const dfmt = (d: string) => `${d.slice(0, 4)}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const TABS = ['members', 'streams', 'stats'] as const;
type Tab = (typeof TABS)[number];
const PERIODS = [['63', '3 個月'], ['126', '6 個月'], ['250', '1 年']] as const;

/** 成員（內建族群用檔案裡的欄位；自訂與編輯加入的成員用全市場摘要＋sectors.json 個股欄補齊） */
function buildMembers(codes: string[], file: SectorMember[] | null, idx: SectorsIndex | null, byCode: Map<string, { name: string; close: number | null; change_pct: number | null }> | undefined): SectorMember[] {
  const fromFile = new Map((file ?? []).map((m) => [m.code, m]));
  return codes.map((c) => {
    const f = fromFile.get(c);
    if (f) return f;
    const s = idx?.stocks[c];
    const r = byCode?.get(c);
    return { code: c, name: r?.name ?? c, close: r?.close ?? null, chg: null, chg_pct: r?.change_pct ?? null, rs: s?.[6] ?? null, r1m: s?.[3] ?? null, r3m: s?.[4] ?? null, stream: null, inst20: s?.[9] ?? null };
  });
}

function MemberRow({ m, codes, groupName }: { m: SectorMember; codes: string[]; groupName: string }) {
  const pct = ok(m.chg_pct) ? m.chg_pct : ok(m.chg) && ok(m.close) && m.close - m.chg > 0 ? (m.chg / (m.close - m.chg)) * 100 : null;
  return (
    <Row label={<>{m.name} <span class="ui-muted ui-foot">{m.code}</span>{m.new ? <Tag>新觸發</Tag> : null}</>}
      sub={`RS ${ok(m.rs) ? Math.round(m.rs) : '—'}・1 個月 ${ok(m.r1m) ? `${m.r1m > 0 ? '+' : m.r1m < 0 ? '−' : ''}${fmtNum(Math.abs(m.r1m), 1)}%` : '—'}・法人 20 日 ${ok(m.inst20) ? `${m.inst20 > 0 ? '+' : m.inst20 < 0 ? '−' : ''}${fmtNum(Math.abs(m.inst20), 1)}%` : '—'}`}
      value={<Num v={ok(m.close) ? fmtPrice(m.close) : null} />} value2={<Signed v={pct} digits={2} unit="%" kind="arrow" />}
      href={`#/stock/${m.code}`} onClick={() => setListContext({ name: groupName, codes })} testid={`mem-${m.code}`} />
  );
}

export default function SectorGroup({ id: key }: { id: string }) {
  const route = useRoute();
  useEffect(() => markOnboard('group_page'), []);
  const idx = useAsync(loadSectors, []);
  const id = idx.data ? resolveGroupId(key, idx.data) : null;
  // 舊網址（產業名稱）→ 族群 id
  useEffect(() => { if (id && id !== key) navigate(`/explore/sectors/${encodeURIComponent(id)}`, true, 'none'); }, [id, key]);
  const isCustom = key.startsWith('u-');
  const file = useAsync<SectorDetail | null>(() => (id && !isCustom ? loadSector(id) : Promise.resolve(null)), [id, isCustom]);
  const user = useDb(() => getGroup(isCustom ? key : `edit:${key}`), [key]);
  const summary = useScoredSummary();
  const index = useAsync(loadIndex, []);
  const [tab, setTab] = useSegParam<Tab>(TABS, 'members', 'tab');
  const [period, setPeriod] = useState<'63' | '126' | '250'>('250');
  const [editing, setEditing] = useState(route.query.get('edit') === '1');
  const d = file.data;
  const baseCodes = d ? d.members.map((m) => m.code) : [];
  const codes = isCustom ? user?.members ?? [] : applyMembers(baseCodes, user);
  const name = isCustom ? user?.name ?? '自訂族群' : d?.name ?? key;
  const members = useMemo(
    () => buildMembers(codes, d?.members ?? null, idx.data ?? null, summary.data?.byCode as never).sort((a, b) => (b.rs ?? -1) - (a.rs ?? -1)),
    [codes.join(','), d, idx.data, summary.data],
  );
  const streams = applyStreams(d?.streams ?? {}, user, codes);
  const edited = !isCustom && !!user && (user.members.length > 0 || (user.removed ?? []).length > 0 || !!user.streams || !!user.notes);
  // 等權指數：內建＝檔案；自訂或改過成員＝前端用個股歷史計算
  const needHist = isCustom || (edited && (user!.members.length > 0 || (user!.removed ?? []).length > 0));
  const hists = useHistories(needHist ? codes : []);
  const idxSeries = useMemo(() => {
    if (needHist) return codes.length && hists.size >= codes.length ? equalWeightIndex(codes.map((c) => hists.get(c) ?? null), 250) : null;
    if (!d) return null;
    return { dates: d.index.dates, values: d.index.values.map((v) => (ok(v) ? v : NaN)) };
  }, [needHist, hists, d, codes.join(',')]);
  const chart = useMemo(() => {
    if (!idxSeries || !idxSeries.dates.length || !index.data) return null;
    const n = Math.min(Number(period), idxSeries.dates.length);
    const dates = idxSeries.dates.slice(-n);
    const g = idxSeries.values.slice(-n);
    const tx = index.data.series[TAIEX] ?? [];
    const tmap = new Map(index.data.dates.map((dd, i) => [dd, tx[i]]));
    const t = dates.map((dd) => tmap.get(dd) ?? null);
    const g0 = g.find((v) => ok(v)), t0 = t.find((v) => ok(v));
    return {
      dates,
      g: g.map((v) => (ok(v) && ok(g0) ? (v / g0) * 100 : null)),
      t: t.map((v) => (ok(v) && ok(t0) ? ((v as number) / t0) * 100 : null)),
    };
  }, [idxSeries, index.data, period]);
  const gLast = chart?.g.filter(ok).at(-1) ?? null;
  const tLast = chart?.t.filter(ok).at(-1) ?? null;
  const st = d?.stats;
  const cst = isCustom || edited ? customStats(codes, idx.data) : null;
  const rank = cst && isCustom ? cst.rank : st?.rank ?? null;
  const of = cst && isCustom ? cst.of : st?.of ?? null;
  const med3 = cst ? cst.med3m : st?.med['3M'] ?? null;
  const layerName = isCustom ? '自訂族群' : d ? (d.layer === 'theme' ? '題材' : LAYER_NAME[d.layer as 'official' | 'fine']) : '';
  const path = isCustom ? [] : d?.path ?? [];
  const phase = idx.loading || (!isCustom && file.loading) ? 'loading' : idx.error || file.error ? 'error' : !isCustom && !d ? 'empty' : isCustom && !user ? 'empty' : 'ok';
  const notes = user?.notes ?? {};
  const listCodes = members.map((m) => m.code);
  return (
    <div class="page">
      <TopBar back="/explore/sectors" actions={phase === 'ok' ? <button type="button" class="text-btn" onClick={() => setEditing(true)} data-testid="group-edit">編輯</button> : undefined} />
      <p class="stock-crumb ui-foot ui-muted" data-testid="group-path">{[layerName, ...path.slice(0, -1)].filter(Boolean).join(' › ')}</p>
      <header class="ui-head stock-head">
        <h1 class="ui-large">{name}</h1>
        <div class="ui-foot ui-muted ui-head-sub">
          {ok(rank) ? `第 ${rank}／${of} 名${!isCustom && st?.merged ? '（成員不足 5 檔，名次依上層）' : ''}` : isCustom ? '未排名' : st?.merged ? '成員不足，名次依上層' : '—'}・{codes.length} 檔{edited ? '・已編輯' : ''}{idx.data ? `・資料至 ${md(idx.data.date)}` : ''}
        </div>
      </header>
      <DataState phase={phase} reason={phase === 'empty' ? (isCustom ? '找不到這個自訂族群（可能已刪除或在其他裝置建立）' : `找不到族群「${key}」`) : '族群資料讀取失敗'} onRetry={() => location.reload()}>
        <Section title="走勢" testid="group-chart-sec">
          <Conclusion testid="group-concl">3 個月中位數 {ok(med3) ? `${med3 > 0 ? '+' : med3 < 0 ? '−' : ''}${fmtNum(Math.abs(med3), 2)}%` : '—'}{ok(st?.rank_prev) && ok(st?.rank) && !isCustom ? `・20 日前第 ${st!.rank_prev} 名` : ''}</Conclusion>
          <Interp>{chart && ok(gLast) && ok(tLast) ? `等權指數 ${PERIODS.find((p) => p[0] === period)![1]}${gLast >= tLast ? '領先' : '落後'}加權指數 ${fmtNum(Math.abs(gLast - tLast), 1)} 點（起點 100）` : needHist && codes.length ? '載入成員歷史中' : null}</Interp>
          {chart ? (
            <SeriesChart dates={chart.dates} axisKey={`g${period}`} height={200} label={`${name}等權指數與加權指數（起點 100）`} testid="group-chart" format={(v) => fmtNum(v, 1)} dateFormat={dfmt}
              series={[{ id: 'g', name: '族群等權', color: 'var(--c-blue)', values: chart.g, main: true }, { id: 't', name: '加權指數', color: 'var(--c-purple)', values: chart.t }]} />
          ) : <List><EmptyRow>{codes.length ? '資料累積中' : '還沒有成員：點右上「編輯」加入股票'}</EmptyRow></List>}
          <Seg small options={PERIODS} value={period} onChange={setPeriod} label="走勢期間" />
        </Section>

        <div class="sk-seg">
          <Seg options={[['members', '成員'], ['streams', '上中下游'], ['stats', '統計']] as const} value={tab} onChange={setTab} label="族群分段" sticky testid="group-tabs" />
        </div>

        {tab === 'members' ? (
          <Section title="成員" testid="group-members" aside={`${members.length} 檔・依 RS 排序`}>
            {notes[''] ? <p class="grp-note" data-testid="group-note">{notes['']}</p> : null}
            <List chev testid="member-rows">
              {members.length ? members.map((m) => <MemberRow key={m.code} m={m} codes={listCodes} groupName={name} />) : <EmptyRow>還沒有成員</EmptyRow>}
            </List>
          </Section>
        ) : null}

        {tab === 'streams' ? (
          <Section title="上中下游" testid="group-streams" info={<p>分段來自櫃買中心產業價值鏈或人工整理的題材清單；可在「編輯」自己調整並寫備註。這裡只列成員，不評估受惠程度。</p>}>
            {Object.keys(streams).length ? Object.entries(streams).map(([s, cs]) => (
              <details key={s} class="grp-stream" open data-testid={`stream-${s}`}>
                <summary><span class="grp-stream-name">{s}</span><span class="ui-foot ui-muted">{cs.length} 檔</span></summary>
                {notes[s] ? <p class="grp-note">{notes[s]}</p> : null}
                <List chev>
                  {members.filter((m) => cs.includes(m.code)).map((m) => <MemberRow key={m.code} m={m} codes={listCodes} groupName={name} />)}
                </List>
              </details>
            )) : <List><EmptyRow>這個族群沒有上中下游分段資料；可在「編輯」自己分段</EmptyRow></List>}
          </Section>
        ) : null}

        {tab === 'stats' ? <StatsPane d={d} codes={codes} idx={idx.data ?? null} custom={isCustom || edited} /> : null}
      </DataState>

      <Sheet open={editing} onClose={() => setEditing(false)} detent="full" title={isCustom ? '編輯自訂族群' : `編輯「${name}」`}>
        {/* 等本機的族群資料載入完才畫（編輯器用它當初始值） */}
        {editing && user !== null ? (
          <GroupEditor key={`${key}:${user?.updatedAt ?? ''}`} isCustom={isCustom} baseId={key} name={name} codes={codes} baseCodes={baseCodes} streams={streams} user={user ?? null}
            nameOf={(c) => summary.data?.byCode.get(c)?.name as string | undefined ?? c} rows={summary.data?.rows ?? []} onDone={() => setEditing(false)} />
        ) : null}
      </Sheet>
    </div>
  );
}

function StatsPane({ d, codes, idx, custom }: { d: SectorDetail | null | undefined; codes: string[]; idx: SectorsIndex | null; custom: boolean }) {
  const st = d?.stats;
  const cst = custom ? customStats(codes, idx) : null;
  const rows = (['1M', '3M', '6M', '12M'] as const).map((k) => ({
    k,
    v: cst ? (k === '1M' ? cst.med1m : k === '3M' ? cst.med3m : k === '6M' ? median(codes.map((c) => idx?.stocks[c]?.[5] ?? null)) : null) : st?.med[k] ?? null,
  }));
  const h = d?.history;
  return (
    <>
      <Section title="各期間中位數" testid="group-stats">
        <Conclusion>{ok(rows[1].v) ? `3 個月 ${rows[1].v > 0 ? '+' : rows[1].v < 0 ? '−' : ''}${fmtNum(Math.abs(rows[1].v), 2)}%` : '—'}{ok(cst?.above60 ?? st?.above60) ? `・站上 60 日線 ${Math.round((cst?.above60 ?? st?.above60) as number)}%` : ''}</Conclusion>
        <div class="ui-card">
          <Table caption="成員報酬中位數" rowKey={(r) => r.k} rows={rows} cols={[
            { key: 'k', label: '期間', render: (r) => r.k },
            { key: 'v', label: '成員中位數', align: 'r', render: (r) => <Signed v={r.v} digits={2} unit="%" tone="plain" /> },
          ]} />
        </div>
        <List>
          <Row label={<Term id="breadth">站上 60 日線</Term>} value={<Num v={cst?.above60 ?? st?.above60 ?? null} digits={0} unit="%" />} />
          <Row label="近 60 日創新高" value={<Num v={cst?.high60 ?? st?.high60 ?? null} unit="檔" />} />
          {!custom && st ? <Row label={<Term id="insti">法人買超（近 5 日）</Term>} sub="淨買超金額 ÷ 成交金額" value={<Signed v={st.insti5} digits={2} unit="%" />} /> : null}
          {!custom && st ? <Row label="法人買超（近 20 日）" sub="淨買超金額 ÷ 成交金額" value={<Signed v={st.insti20} digits={2} unit="%" />} /> : null}
        </List>
      </Section>
      {h && h.dates.length >= 2 && !custom ? (
        <>
          <Section title="名次走勢" testid="group-rank">
            <Interp>數字越小越前面；近 {h.dates.length} 個交易日</Interp>
            <SeriesChart dates={h.dates} axisKey="rank" height={140} label="族群名次走勢" format={(v) => fmtNum(v, 0)} dateFormat={dfmt}
              series={[{ id: 'r', name: '名次', color: 'var(--c-indigo)', values: h.rank ?? [], main: true }]} />
          </Section>
          <Section title="寬度" testid="group-breadth">
            <Interp>成員站上 60 日線的比例（%）</Interp>
            <SeriesChart dates={h.dates} axisKey="breadth" height={140} label="站上 60 日線比例" format={(v) => `${fmtNum(v, 0)}%`} dateFormat={dfmt}
              series={[{ id: 'b', name: '站上 60 日線', color: 'var(--c-cyan)', values: h.breadth ?? [], main: true }]} />
          </Section>
        </>
      ) : custom ? <List><EmptyRow>自訂或編輯過的族群只計算目前的統計（沒有名次與寬度的歷史）</EmptyRow></List> : null}
    </>
  );
}

/** 編輯：成員增刪、分段（上游／中游／下游）、備註；自訂族群可改名與刪除，內建族群可還原 */
function GroupEditor({ isCustom, baseId, name, codes, baseCodes, streams, user, nameOf, rows, onDone }: {
  isCustom: boolean; baseId: string; name: string; codes: string[]; baseCodes: string[]; streams: Record<string, string[]>; user: UserGroup | null;
  nameOf: (c: string) => string; rows: import('../data/types').StockRow[]; onDone: () => void;
}) {
  const [nm, setNm] = useState(name);
  const [list, setList] = useState<string[]>(codes);
  const [seg, setSegOf] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const [s, cs] of Object.entries(streams)) for (const c of cs) m[c] = s;
    return m;
  });
  const [notes, setNotes] = useState<Record<string, string>>(user?.notes ?? {});
  const segNames = [...new Set([...STREAMS, ...Object.keys(streams)])];
  const save = async () => {
    const now = new Date().toISOString();
    const st: Record<string, string[]> = {};
    for (const c of list) { const s = seg[c]; if (s) (st[s] ??= []).push(c); }
    // 每個分段都存（空的也存），才能覆蓋內建分段裡被移出的代號
    for (const s of segNames) st[s] ??= [];
    const cleanNotes = Object.fromEntries(Object.entries(notes).filter(([, v]) => v.trim()));
    if (isCustom) {
      await saveGroup({ id: baseId, kind: 'custom', name: nm.trim() || name, members: list, streams: st, notes: cleanNotes, createdAt: user?.createdAt ?? now, updatedAt: now });
    } else {
      // 內建族群：只存和內建成員的差異（加入、移除）
      const added = list.filter((c) => !baseCodes.includes(c));
      const removed = baseCodes.filter((c) => !list.includes(c));
      await saveGroup({ id: `edit:${baseId}`, kind: 'edit', base: baseId, name: '', members: added, removed, streams: st, notes: cleanNotes, createdAt: user?.createdAt ?? now, updatedAt: now });
    }
    onDone();
  };
  const remove = async () => {
    await deleteGroup(isCustom ? baseId : `edit:${baseId}`);
    onDone();
    if (isCustom) navigate('/explore/sectors?layer=theme');
  };
  return (
    <div class="grp-editor" data-testid="group-editor">
      {isCustom ? (
        <label class="field">
          <span>名稱</span>
          <input class="input" value={nm} maxLength={20} onInput={(e) => setNm((e.target as HTMLInputElement).value)} data-testid="edit-name" />
        </label>
      ) : null}
      <label class="field">
        <span>族群備註</span>
        <textarea class="input" rows={2} value={notes[''] ?? ''} onInput={(e) => setNotes({ ...notes, '': (e.target as HTMLTextAreaElement).value })} data-testid="edit-note" />
      </label>
      <p class="ui-foot ui-muted">加入成員</p>
      <StockSearch rows={rows} onPick={(r) => { if (!list.includes(r.code)) setList([...list, r.code]); }} />
      <p class="ui-foot ui-muted grp-editor-h">成員 {list.length} 檔（可指定分段）</p>
      <div class="ui-list" data-testid="edit-members">
        {list.length ? list.map((c) => (
          <div key={c} class="grp-edit-row">
            <span class="grp-edit-name">{nameOf(c)} <span class="ui-muted ui-foot">{c}</span></span>
            <select class="select grp-edit-seg" aria-label={`${nameOf(c)}的分段`} value={seg[c] ?? ''} onChange={(e) => setSegOf({ ...seg, [c]: (e.target as HTMLSelectElement).value })}>
              <option value="">未分段</option>
              {segNames.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" class="text-btn" aria-label={`移除${nameOf(c)}`} onClick={() => setList(list.filter((x) => x !== c))} data-testid={`edit-remove-${c}`}>移除</button>
          </div>
        )) : <p class="ui-foot ui-muted grp-edit-empty">還沒有成員：用上方搜尋加入</p>}
      </div>
      {segNames.filter((s) => list.some((c) => seg[c] === s)).map((s) => (
        <label key={s} class="field">
          <span>{s}備註</span>
          <textarea class="input" rows={2} value={notes[s] ?? ''} onInput={(e) => setNotes({ ...notes, [s]: (e.target as HTMLTextAreaElement).value })} />
        </label>
      ))}
      <Button variant="fill" block onClick={() => void save()} testid="edit-save">儲存</Button>
      {isCustom ? <Button variant="plain" block onClick={() => void remove()} testid="edit-delete">刪除這個族群</Button>
        : user ? <Button variant="plain" block onClick={() => void remove()} testid="edit-reset">還原成內建成員與分段</Button> : null}
    </div>
  );
}
