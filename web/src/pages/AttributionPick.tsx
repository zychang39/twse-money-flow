/**
 * 探索 › 順風選股 › ② 找股票（2026-11-19；#/explore/attribution?seg=pick&src=&k=；DECISIONS #475）。
 * 依 Freddy〈法人級選股實戰〉單元 2、3 的做法（只取方法，說明用自己的話寫）：名單優先從「能力圈 × 順風的類型」的交集找——
 * - 從風格：那一檔風格 ETF 的持股，加上特徵也屬於這一類的公司；依類股的狀態分三堆。
 * - 從類股：同產業的公司；依各自主要風格的狀態分三堆。
 * - 我的名單：自選（或其中一個群組）每一檔的兩個狀態，放進 3×3 矩陣；附名單檢查（檔數、是不是押同一個類股、同一陣風）。
 * 能力圈（熟悉／不碰的類股）存在 IndexedDB 的設定。清單依規則產生，非推薦；狀態只排研究時間的先後，不是進出場訊號。
 */
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { Conclusion } from '../components/kit';
import { Sheet } from '../components/Sheet';
import { List, Row, Section, Seg, Signed, Tag } from '../components/ui';
import { loadAttrTags, loadSummary } from '../data/api';
import type { Tailwind, WindState } from '../data/types';
import { useUser } from '../data/useUser';
import { getSetting, setSetting } from '../db/db';
import { useAsync, useDb, useSegParam } from '../hooks';
import { STYLE_LABEL } from '../lib/attribution';
import { fmtNum } from '../lib/format';
import { setListContext } from '../lib/listContext';
import {
  type Candidate, type Circle, EMPTY_CIRCLE, WIND_ORDER, WIND_TEXT, WIND_USE, byState, cellKey, circleOf, listCandidates, matrixCounts, normCircle,
  poolCheck, sameWindLabel, sectorCandidates, styleCandidates, styleNow, tagRows, toggleCircle, windLabel,
} from '../lib/tailwind';
import { effectiveGroups, inGroup } from '../lib/watchGroups';
import { navigate, useRoute } from '../router';
import { WindTag } from './AttributionWind';

const SRCS = [['style', '從風格'], ['sector', '從類股'], ['list', '我的名單']] as const;
type Src = (typeof SRCS)[number][0];
const CIRCLE_KEY = 'circle';
/** 每一堆先列幾檔（直接看得到例子，不用先展開） */
const FOLD = 5;
const ALL = '__all__';

const r12 = (v: number | null) => <Signed v={v === null ? null : v * 100} digits={0} unit="%" />;

export function PickPane({ tw }: { tw: Tailwind }) {
  const route = useRoute();
  const user = useUser();
  const tags = useAsync(loadAttrTags, []);
  const summary = useAsync(loadSummary, []);
  const rows = useMemo(() => tagRows(tags.data), [tags.data]);
  const nameOf = (c: string) => (summary.data?.byCode.get(c)?.name as string | undefined) ?? c;
  const circle = normCircle(useDb(() => getSetting<Circle>(CIRCLE_KEY, EMPTY_CIRCLE)));
  const [circleOpen, setCircleOpen] = useState(false);
  const [src, setSrc0] = useSegParam<Src>(SRCS.map(([v]) => v), 'style', 'src', 'attr-pick-src');
  const k = route.query.get('k');
  const setQuery = (patch: Record<string, string | null>) => {
    const qs = new URLSearchParams(route.query);
    for (const [key, v] of Object.entries(patch)) { if (v === null) qs.delete(key); else qs.set(key, v); }
    navigate(`${route.path}?${qs.toString()}`, true, 'none');
  };
  // 換來源時把上一個來源的選擇（k、格子）清掉
  const setSrc = (v: Src) => { if (k || route.query.get('cell')) setQuery({ src: v, k: null, cell: null }); else setSrc0(v); };
  const nCircle = circle.know.length + circle.skip.length;
  return (
    <div class="seg-pane" data-testid="pick-pane">
      <p class="ds-line" data-testid="pick-note">依規則產生，非推薦・狀態只排研究時間的先後</p>
      <List chev>
        <Row label="能力圈" sub={nCircle ? '熟悉的排前面；不碰的不列' : '先選熟悉與不碰的類股'} onClick={() => setCircleOpen(true)} testid="pick-circle"
          value={nCircle ? `熟悉 ${circle.know.length}・不碰 ${circle.skip.length}` : '未設定'} />
      </List>
      <Seg options={SRCS} value={src} onChange={setSrc} label="從哪裡找" small testid="pick-src" />
      <CircleSheet open={circleOpen} onClose={() => setCircleOpen(false)} circle={circle} tw={tw} />
      {tags.loading ? null : !rows.length ? <p class="ds-line" data-testid="pick-empty">清單資料累積中（下一次資料更新後出現）</p>
        : src === 'style' ? <FromStyle tw={tw} rows={rows} nameOf={nameOf} circle={circle} k={k} onK={(v) => setQuery({ src: 'style', k: v })} />
          : src === 'sector' ? <FromSector tw={tw} rows={rows} nameOf={nameOf} circle={circle} k={k} onK={(v) => setQuery({ src: 'sector', k: v })} />
            : <FromList tw={tw} rows={rows} nameOf={nameOf} circle={circle} watch={user?.watch ?? null} prefs={user?.watchPrefs ?? null}
                group={k} onGroup={(v) => setQuery({ src: 'list', k: v, cell: null })} cell={route.query.get('cell')} onCell={(v) => setQuery({ cell: v })} />}
    </div>
  );
}

// ---------------------------------------------------------------- 清單（分三堆）

interface Group { key: string; title: string; note?: string; items: Candidate[] }

/** 能力圈的排序與隱藏：熟悉的類股排前面（原本的順序不變）；hide＝不碰的類股不列 */
function applyCircle(cs: Candidate[], circle: Circle, hide: boolean): { items: Candidate[]; hidden: number } {
  const kept = hide ? cs.filter((c) => circleOf(circle, c.sector) !== 'skip') : cs;
  const know = kept.filter((c) => circleOf(circle, c.sector) === 'know');
  const rest = kept.filter((c) => circleOf(circle, c.sector) !== 'know');
  return { items: [...know, ...rest], hidden: cs.length - kept.length };
}

function CandRow({ c, nameOf, circle, sub, value, value2, ctx }: {
  c: Candidate; nameOf: (c: string) => string; circle: Circle; sub: ComponentChildren; value: ComponentChildren; value2?: ComponentChildren; ctx: () => void;
}) {
  const mark = circleOf(circle, c.sector);
  return (
    <Row label={<>{nameOf(c.code)}<span class="ui-muted"> {c.code}</span></>} subWide href={`#/stock/${c.code}`} onClick={ctx} testid={`pick-row-${c.code}`}
      sub={<>{sub}{mark === 'know' ? '・熟悉' : mark === 'skip' ? '・不碰' : ''}</>} value={value} value2={value2} />
  );
}

/** 一堆一張卡：先列前 FOLD 檔，可展開；點一列到個股頁（左右滑動可換同一份清單裡的股票） */
function Groups({ groups, render, context, empty }: { groups: Group[]; render: (c: Candidate, ctx: () => void) => ComponentChildren; context: string; empty: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const shown = groups.filter((g) => g.items.length);
  if (!shown.length) return <p class="ds-line" data-testid="pick-none">{empty}</p>;
  const ctx = () => setListContext({ name: context, codes: shown.flatMap((g) => g.items.map((c) => c.code)) });
  return (
    <>
      {shown.map((g) => {
        const items = open[g.key] || g.items.length <= FOLD + 1 ? g.items : g.items.slice(0, FOLD);
        return (
          <div key={g.key} class="wind-pile" data-testid={`pick-group-${g.key}`}>
            <p class="wind-pile-h ui-foot"><strong>{g.title} {g.items.length}</strong>{g.note ? <span class="ui-muted">・{g.note}</span> : null}</p>
            <List chev>{items.map((c) => render(c, ctx))}</List>
            {g.items.length > FOLD + 1 ? (
              <button type="button" class="text-btn" onClick={() => setOpen({ ...open, [g.key]: !open[g.key] })} data-testid={`pick-more-${g.key}`}>
                {open[g.key] ? `只看前 ${FOLD} 檔` : `顯示全部 ${g.items.length} 檔`}
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

const sameMark = (c: Candidate) => (c.wind.sameWind ? `・${sameWindLabel(c.wind.sameWind.same)}` : '');
const styleText = (c: Candidate) => (c.via ? `${STYLE_LABEL[c.via]} ${windLabel(c.wind.styleState, c.wind.provisional)}` : '風格不突出');
const sectorText = (c: Candidate) => (c.sector ? `${c.sector} ${windLabel(c.wind.sectorState)}` : '沒有類股指數');

// ---------------------------------------------------------------- 從風格

function FromStyle({ tw, rows, nameOf, circle, k, onK }: {
  tw: Tailwind; rows: ReturnType<typeof tagRows>; nameOf: (c: string) => string; circle: Circle; k: string | null; onK: (v: string) => void;
}) {
  // 順風的排前面；預設第一種順風的風格
  const order = [...tw.styles].sort((a, b) => WIND_ORDER.indexOf(styleNow(a, tw).state ?? 'head') - WIND_ORDER.indexOf(styleNow(b, tw).state ?? 'head'));
  const st = order.find((s) => s.key === k) ?? order[0];
  const now = st ? styleNow(st, tw) : null;
  // 預設只列 ETF 的持股（課程的做法）；wide＝加上特徵也屬於這一類的公司
  const [wide, setWide] = useState(false);
  const { items, hidden } = useMemo(() => (st ? applyCircle(styleCandidates(tw, rows, st.key, wide), circle, true) : { items: [], hidden: 0 }), [tw, rows, st?.key, wide, circle.know.join(), circle.skip.join()]);
  const extra = useMemo(() => (st ? styleCandidates(tw, rows, st.key, true).length - styleCandidates(tw, rows, st.key).length : 0), [tw, rows, st?.key]);
  if (!st || !now) return null;
  const by = (s: WindState | null) => items.filter((c) => c.wind.sectorState === s);
  const groups: Group[] = [
    { key: 'tail', title: '類股順風', note: now.state === 'tail' ? '兩邊都順風，先問是不是同一陣風' : WIND_USE.tail, items: by('tail') },
    { key: 'neutral', title: '類股中性', note: '類股沒有加分', items: by('neutral') },
    { key: 'head', title: '類股逆風', note: WIND_USE.head, items: by('head') },
    { key: 'none', title: '沒有類股指數', items: by(null) },
  ];
  return (
    <Section title="從風格找" testid="pick-style"
      info={<>
        <p>打開順風類型的清單，圈出看得懂的公司（單元 2）。清單＝那一檔風格 ETF 的持股（依權重）。想看更多，可以加上特徵也屬於這一類、但不在 ETF 裡的公司（依市值）；特徵屬於＝在樣本內的百分位 ≥ {fmtNum(tw.style_pct, 0)}。</p>
        <p>每一檔再看它的類股是什麼狀態，分成三堆。風格和類股都順風的排最前面，但兩邊都順風不等於兩份優勢：風格 ETF 如果超配這個類股，是同一陣風；沒有超配，是不同陣風。</p>
        <p>右邊的數字：在這檔 ETF 的權重；不在 ETF 裡的顯示近 12 個月報酬。清單依規則產生，不是推薦。</p>
      </>}>
      <div class="chips wrap" role="group" aria-label="風格" data-testid="pick-style-chips">
        {order.map((s) => {
          const n = styleNow(s, tw);
          return (
            <button key={s.key} type="button" class="chip" aria-pressed={s.key === st.key} onClick={() => onK(s.key)} data-testid={`pick-style-${s.key}`}>
              {s.label}<span class="chip-sub">{windLabel(n.state, n.provisional)}</span>
            </button>
          );
        })}
      </div>
      <Conclusion testid="pick-concl">{items.length} 檔・{groups[0].items.length} 檔的類股也順風</Conclusion>
      <p class="ds-line">{st.label}・{windLabel(now.state, now.provisional)}：{st.etf} {st.name ?? ''} 的持股{wide ? `，加上特徵也屬於這一類的 ${extra} 檔` : ''}。右邊是在 ETF 的權重{wide ? '（不在 ETF 裡的是近 12 個月報酬）' : ''}。{hidden ? `不碰的類股 ${hidden} 檔沒有列出。` : ''}</p>
      {extra ? (
        <button type="button" class="text-btn pick-wide" aria-pressed={wide} onClick={() => setWide(!wide)} data-testid="pick-wide">
          {wide ? '只看 ETF 的持股' : `加上特徵也屬於這一類的 ${extra} 檔`}
        </button>
      ) : null}
      <Groups groups={groups} context={`${st.label}風格`} empty="這一類目前沒有清單（持股資料累積中）"
        render={(c, ctx) => (
          <CandRow key={c.code} c={c} nameOf={nameOf} circle={circle} ctx={ctx}
            sub={<>{sectorText(c)}{sameMark(c)}</>}
            value={c.weight !== null ? `${fmtNum(c.weight, 1)}%` : r12(c.r12)} />
        )} />
    </Section>
  );
}

// ---------------------------------------------------------------- 從類股

function FromSector({ tw, rows, nameOf, circle, k, onK }: {
  tw: Tailwind; rows: ReturnType<typeof tagRows>; nameOf: (c: string) => string; circle: Circle; k: string | null; onK: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const piles = byState(tw.sectors);
  // 預設：順風裡第一個熟悉的類股，否則報酬最高的順風類股
  const def = piles.tail.find((s) => circle.know.includes(s.key)) ?? piles.tail[0] ?? tw.sectors[0];
  const sec = tw.sectors.find((s) => s.key === k) ?? def;
  const items = useMemo(() => (sec ? applyCircle(sectorCandidates(tw, rows, sec.key), circle, false).items : []), [tw, rows, sec?.key]);
  if (!sec) return <p class="ds-line">沒有類股資料</p>;
  const by = (s: WindState | null) => items.filter((c) => c.wind.styleState === s);
  const groups: Group[] = [
    { key: 'tail', title: '風格順風', note: sec.state === 'tail' ? '兩邊都順風，先問是不是同一陣風' : WIND_USE.tail, items: by('tail') },
    { key: 'neutral', title: '風格中性', note: '風格沒有加分', items: by('neutral') },
    { key: 'head', title: '風格逆風', note: WIND_USE.head, items: by('head') },
    { key: 'none', title: '風格不突出', note: '五種特徵都沒有過門檻', items: by(null) },
  ];
  const mark = circleOf(circle, sec.key);
  return (
    <Section title="從類股找" testid="pick-sector"
      info={<>
        <p>風在吹的類股，公司數字好的機率比較高，研究時間比較不會白花（單元 3）；它不保證挑中的那一家會漲。清單＝同一個官方產業的公司（含上櫃），依市值排列。</p>
        <p>每一檔再看它的主要風格（五種特徵裡最突出的一種）是什麼狀態，分成三堆。類股順風、風格卻逆風的公司，類股的風可能幫不到它：市場在這個類股裡獎勵的是另一種特徵。</p>
        <p>右邊的數字是這一檔近 12 個月的報酬——比類股指數高出很多的，才值得問「是公司自己的，還是類股帶的」。清單依規則產生，不是推薦。</p>
      </>}>
      <List chev tags>
        <Row label={sec.key} sub="換一個類股" onClick={() => setOpen(true)} tag={<WindTag state={sec.state} />} testid="pick-sector-pick" />
      </List>
      <Sheet open={open} onClose={() => setOpen(false)} title="選一個類股" detent="full">
        <div data-testid="pick-sector-sheet">
          {WIND_ORDER.map((st) => (piles[st].length ? (
            <div key={st} class="wind-pile">
              <p class="wind-pile-h ui-foot"><strong>{WIND_TEXT[st]} {piles[st].length}</strong></p>
              <List>
                {piles[st].map((s) => {
                  const m = circleOf(circle, s.key);
                  return (
                    <Row key={s.key} label={s.key} sub={m === 'know' ? '熟悉' : m === 'skip' ? '不碰' : undefined} noChev strong={s.key === sec.key}
                      value={<Signed v={s.r['12'] === null ? null : s.r['12'] * 100} digits={1} unit="%" />}
                      onClick={() => { onK(s.key); setOpen(false); }} testid={`pick-sector-${s.key}`} />
                  );
                })}
              </List>
            </div>
          ) : null))}
        </div>
      </Sheet>
      <Conclusion testid="pick-concl">{items.length} 檔・{groups[0].items.length} 檔的風格也順風</Conclusion>
      <p class="ds-line">類股指數近 12 個月 {sec.r['12'] === null ? '無資料' : `${sec.r['12'] >= 0 ? '+' : '−'}${fmtNum(Math.abs(sec.r['12'] * 100), 1)}%`}{sec.top ? `・最大權值股 ${sec.top.name} 占 ${fmtNum(sec.top.w, 0)}%` : ''}。右邊是各檔近 12 個月的報酬。{mark === 'skip' ? '你把這個類股列在不碰。' : ''}</p>
      <Groups groups={groups} context={`${sec.key}類股`} empty="這個類股目前沒有清單"
        render={(c, ctx) => (
          <CandRow key={c.code} c={c} nameOf={nameOf} circle={EMPTY_CIRCLE} ctx={ctx}
            sub={<>{styleText(c)}{sameMark(c)}</>} value={r12(c.r12)} />
        )} />
    </Section>
  );
}

// ---------------------------------------------------------------- 我的名單

type WatchLike = { code: string; group: string; groups?: string[] };

function FromList({ tw, rows, nameOf, circle, watch, prefs, group, onGroup, cell, onCell }: {
  tw: Tailwind; rows: ReturnType<typeof tagRows>; nameOf: (c: string) => string; circle: Circle;
  watch: WatchLike[] | null; prefs: Parameters<typeof effectiveGroups>[1] | null;
  group: string | null; onGroup: (v: string | null) => void; cell: string | null; onCell: (v: string | null) => void;
}) {
  const groupsAll = watch ? effectiveGroups(watch, prefs) : [];
  const g = group && groupsAll.includes(group) ? group : null;
  const codes = [...new Set((watch ?? []).filter((w) => !g || inGroup(w, g)).map((w) => w.code))];
  const items = useMemo(() => listCandidates(tw, rows, codes), [tw, rows, codes.join()]);
  const missing = codes.length - items.length;
  const chk = poolCheck(items);
  const mc = matrixCounts(items);
  const picked = cell ? items.filter((c) => cellKey(c) === cell) : null;
  const [a, b] = (cell ?? '').split('-') as [WindState, WindState];
  const tone = (c: Candidate) => c.wind.cell?.tone;
  const tailOne = (c: Candidate) => tone(c) === 'ok' && (c.wind.styleState === 'tail' || c.wind.sectorState === 'tail');
  const groups: Group[] = picked
    ? [{ key: 'cell', title: `風格${WIND_TEXT[a]} × 類股${WIND_TEXT[b]}`, items: picked }]
    : [
      { key: 'both', title: '兩邊都順風', note: '優先研究，先問是不是同一陣風', items: items.filter((c) => tone(c) === 'prior') },
      { key: 'one', title: '一邊順風', note: '另一邊沒有加分', items: items.filter(tailOne) },
      { key: 'neutral', title: '沒有順風', note: '可以研究，目前沒有加分', items: items.filter((c) => tone(c) === 'ok' && !tailOne(c)) },
      { key: 'head', title: '有逆風', note: WIND_USE.head, items: items.filter((c) => tone(c) === 'mixed' || tone(c) === 'against') },
      { key: 'none', title: '沒有狀態', note: '風格不突出，也沒有類股指數', items: items.filter((c) => !c.wind.cell) },
    ];
  if (watch && !watch.length) {
    return (
      <Section title="我的名單" testid="pick-list">
        <Conclusion>還沒有自選</Conclusion>
        <List chev><Row label="把想研究的公司加進自選" subWide sub="這裡會替每一檔標上風格與類股的狀態" href="#/mine" /></List>
      </Section>
    );
  }
  return (
    <Section title="我的名單" testid="pick-list"
      info={<>
        <p>每個月的最後一步：更新名單上每家公司的兩個狀態——所屬風格與所屬類股各是順風、中性還是逆風（單元 2、3 的作業 1）。把想研究的公司放在自選的一個群組裡，就是你的名單。</p>
        <p>風格的歸類：五種特徵（淨值市價比、ROE、近 12 個月報酬、市值、波動）在樣本內的百分位 ≥ {fmtNum(tw.style_pct, 0)}，或出現在那一檔風格 ETF 的持股裡；取最突出的一種當主要風格。五種都不突出就只看類股。</p>
        <p>矩陣：橫的是類股的狀態、直的是風格的狀態，數字是落在那一格的檔數；點一格只看那一格。左上角（兩邊都順風）優先研究；有逆風的不是禁區，只是論述要求更高。</p>
        <p>名單檢查：數量抓 10 檔上下（少於 5 檔排不出高下，多於 12 檔看不完）；超過一半在同一個類股，這份名單實質上是在押同一陣風；兩邊都順風而且是同一陣風的，不能當成兩份優勢。狀態只決定研究時間先花在誰身上，離任何決定都還很遠。</p>
      </>}>
      {groupsAll.length > 1 ? (
        <div class="chips wrap" role="group" aria-label="群組" data-testid="pick-list-groups">
          <button type="button" class="chip" aria-pressed={!g} onClick={() => onGroup(null)} data-testid={`pick-group-chip-${ALL}`}>全部自選</button>
          {groupsAll.map((x) => <button key={x} type="button" class="chip" aria-pressed={g === x} onClick={() => onGroup(x)}>{x}</button>)}
        </div>
      ) : null}
      <Conclusion testid="pick-concl">{items.length} 檔：兩邊都順風 {chk.both}・有逆風 {chk.head}</Conclusion>
      <Matrix counts={mc.cells} cell={cell} onCell={onCell} />
      <p class="ds-line wind-after">{[
        '矩陣的數字是檔數，點一格只看那一格',
        mc.one ? `${mc.one} 檔只有一邊有狀態，不在矩陣裡` : null,
        missing ? `${missing} 檔沒有資料（ETF、上市未滿 24 個月）` : null,
      ].filter(Boolean).join('；')}。清單右邊是各檔近 12 個月的報酬。</p>
      <List tags testid="pick-check">
        <Row label="檔數" sub="抓 10 檔上下（5～12）" value={`${chk.n} 檔`} tag={<Tag tone={chk.sizeOk ? 'strong' : 'neutral'}>{chk.sizeOk ? '合適' : chk.n < 5 ? '偏少' : '偏多'}</Tag>} testid="pick-check-size" />
        <Row label="最多的類股" sub={chk.crowded ? '超過一半：實質上押同一陣風' : '沒有超過一半'} value={chk.top ? `${chk.top[0]} ${chk.top[1]} 檔` : '—'}
          tag={<Tag tone={chk.crowded ? 'neutral' : 'strong'}>{chk.crowded ? '集中' : '分散'}</Tag>} testid="pick-check-crowd" />
        <Row label="同一陣風" sub="兩邊都順風，但風格 ETF 超配這個類股" value={`${chk.same} 檔`} tag={<span />} testid="pick-check-same" />
      </List>
      <Groups groups={groups} context={g ?? '自選'} empty={picked ? '這一格沒有股票' : '名單裡沒有可以標狀態的股票'}
        render={(c, ctx) => (
          <CandRow key={c.code} c={c} nameOf={nameOf} circle={circle} ctx={ctx}
            sub={<>{styleText(c)} × {sectorText(c)}{sameMark(c)}</>} value={r12(c.r12)} />
        )} />
    </Section>
  );
}

/** 3×3 矩陣：直＝風格的狀態、橫＝類股的狀態；格子是按鈕（點一格只看那一格，再點一次取消） */
function Matrix({ counts, cell, onCell }: { counts: Record<string, number>; cell: string | null; onCell: (v: string | null) => void }) {
  return (
    <div class="wind-matrix" role="group" aria-label="風格狀態 × 類股狀態的檔數" data-testid="pick-matrix">
      <span class="wm-corner ui-foot ui-muted" aria-hidden="true">風格＼類股</span>
      {WIND_ORDER.map((b) => <span key={b} class="wm-col ui-foot ui-muted" aria-hidden="true">{WIND_TEXT[b]}</span>)}
      {WIND_ORDER.map((a) => (
        <>
          <span key={`r-${a}`} class="wm-row ui-foot ui-muted" aria-hidden="true">{WIND_TEXT[a]}</span>
          {WIND_ORDER.map((b) => {
            const key = `${a}-${b}`;
            const n = counts[key] ?? 0;
            return (
              <button key={key} type="button" class={`wm-cell ${a === 'tail' && b === 'tail' ? 'prior' : ''} ${n ? '' : 'zero'}`} aria-pressed={cell === key} disabled={!n && cell !== key}
                aria-label={`風格${WIND_TEXT[a]}、類股${WIND_TEXT[b]}：${n} 檔`} onClick={() => onCell(cell === key ? null : key)} data-testid={`pick-cell-${key}`}>
                {n}
              </button>
            );
          })}
        </>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- 能力圈

function CircleSheet({ open, onClose, circle, tw }: { open: boolean; onClose: () => void; circle: Circle; tw: Tailwind }) {
  const set = (side: keyof Circle, s: string) => { void setSetting(CIRCLE_KEY, toggleCircle(circle, side, s)); };
  const sectors = [...tw.sectors].sort((a, b) => (b.w ?? 0) - (a.w ?? 0));
  const chips = (side: keyof Circle) => (
    <div class="chips wrap" role="group" aria-label={side === 'know' ? '熟悉的類股' : '不碰的類股'} data-testid={`circle-${side}`}>
      {sectors.map((s) => (
        <button key={s.key} type="button" class="chip" aria-pressed={circle[side].includes(s.key)} onClick={() => set(side, s.key)} data-testid={`circle-${side}-${s.key}`}>
          {s.key}{s.state === 'tail' ? <span class="chip-sub">順風</span> : null}
        </button>
      ))}
    </div>
  );
  return (
    <Sheet open={open} onClose={onClose} title="能力圈" detent="full">
      <div data-testid="circle-sheet">
        <p class="ds-line">名單優先從兩個圈的交集找：看得懂的公司，以及目前順風的類型。這裡用類股粗略畫出你的圈；只存在這台裝置，會跟著備份匯出。</p>
        <p class="wind-pile-h ui-foot"><strong>熟悉 {circle.know.length}</strong><span class="ui-muted">・說得出你比一般人多知道什麼（建議 2 個）</span></p>
        {chips('know')}
        <p class="wind-pile-h ui-foot"><strong>不碰 {circle.skip.length}</strong><span class="ui-muted">・說得出缺什麼資訊（建議 3 個）</span></p>
        {chips('skip')}
        <p class="ds-line">「常用它的產品」「看了很多新聞」不算熟悉；「不熟」「沒興趣」也不算不碰的理由。熟悉的類股在清單裡排前面；不碰的類股不會出現在「從風格」的清單。</p>
      </div>
    </Sheet>
  );
}
