import { useMemo, useState } from 'preact/hooks';
import { SortMenu } from '../components/SortMenu';
import { type SortState, loadSort, saveSort, sortItems } from '../lib/sorting';
import { type EvidenceFile, type EvidenceToday, pctSigned, tText } from '../lib/evidence';
import { PageHead, TopBar } from '../components/Chrome';
import { StockMiniRow } from '../components/StockRow';
import { setListContext } from '../lib/listContext';
import { navigate } from '../router';
import { DataStatus, ErrorState, Loading } from '../components/DataStatus';
import { useAsync, useDb, useRestoredState } from '../hooks';
import { loadJson, loadMeta, loadScreenDays } from '../data/api';
import { useScoredSummary } from '../data/useSummary';
import { deleteScreen, listScreens, saveScreen, uid, type SavedScreen } from '../db/db';
import { screenerConfig, type Condition } from '../lib/config';
import { describeCondition, newTriggerCodes, savedDisplayName, weeklyNote, encodeConditions, presetScreens, screen, screenIdentity } from '../lib/screener';
import { fmtNum, md } from '../lib/format';
import { PAGE_SOURCES } from '../lib/health';
import '../styles/evidence.css';

const OPS: Condition['op'][] = ['>=', '>', '<=', '<', '==', 'between'];
const fields = screenerConfig.fields;
const groups = Array.from(new Set(Object.values(fields).map((f) => f.group)));
const label = (f: string) => fields[f]?.label ?? f;
const unit = (f: string) => fields[f]?.unit ?? '';
/** 內建組合沒有對應的指標效度評估時的說明（不只寫「未評估」）。 */
const NO_EVIDENCE = '未評估（沒有對應的指標效度評估）';

function ConditionEditor({ c, onChange, onRemove }: { c: Condition; onChange: (c: Condition) => void; onRemove: () => void }) {
  const isBetween = c.op === 'between';
  const [lo, hi] = isBetween ? (c.value as [number, number]) : [c.value as number, c.value as number];
  return (
    <div class="card" style={{ padding: 'var(--s-3)' }}>
      <div class="row wrap">
        <select class="select" style={{ flex: '1 1 10rem' }} aria-label="欄位" value={c.field} onChange={(e) => onChange({ ...c, field: (e.target as HTMLSelectElement).value })}>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {Object.entries(fields).filter(([, f]) => f.group === g).map(([id, f]) => <option key={id} value={id}>{f.label}</option>)}
            </optgroup>
          ))}
        </select>
        <select class="select" style={{ width: '6rem' }} aria-label="比較" value={c.op}
          onChange={(e) => {
            const op = (e.target as HTMLSelectElement).value as Condition['op'];
            onChange({ ...c, op, value: op === 'between' ? [lo, hi] : lo });
          }}>
          {OPS.map((o) => <option key={o} value={o}>{o === 'between' ? '介於' : o}</option>)}
        </select>
        <input class="input" style={{ width: '6rem' }} type="number" inputMode="decimal" aria-label="數值" value={lo}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value);
            onChange({ ...c, value: isBetween ? [v, hi] : v });
          }} />
        {isBetween ? (
          <input class="input" style={{ width: '6rem' }} type="number" inputMode="decimal" aria-label="上限" value={hi}
            onInput={(e) => onChange({ ...c, value: [lo, Number((e.target as HTMLInputElement).value)] })} />
        ) : null}
        <span class="small muted">{unit(c.field)}</span>
        <button class="btn small danger" onClick={onRemove} aria-label={`刪除條件 ${label(c.field)}`}>刪除</button>
      </div>
    </div>
  );
}

export default function Screener() {
  const summary = useScoredSummary();
  const saved = useDb(listScreens) ?? [];
  const [conditions, setConditions] = useRestoredState<Condition[]>('screener.conditions', screenerConfig.presets[0].conditions);
  const [active, setActive] = useRestoredState<string>('screener.active', screenerConfig.presets[0].id);
  const [name, setName] = useRestoredState('screener.name', screenerConfig.presets[0].label);
  // S2：全部符合／今日新觸發（今天符合、上一個交易日不符合；與回測的訊號定義相同）
  const [mode, setMode] = useRestoredState<'all' | 'new'>('screener.mode', 'all');
  const days = useAsync(() => (mode === 'new' ? loadScreenDays() : Promise.resolve(null)), [mode]);
  const meta = useAsync(loadMeta, []);
  // v3 M5-2：內建組合依對應指標的判定分級 → t 排序（不依超額）；排序選單與策略庫、指標效度表相同
  const ev = useAsync(() => loadJson<EvidenceFile>('evidence.json').catch(() => null), []);
  const evToday = useAsync(() => loadJson<EvidenceToday>('evidence_today.json').catch(() => null), []);
  const [presetSort, setPresetSortState] = useState<SortState>(() => loadSort('screener'));
  const setPresetSort = (x: SortState) => { saveSort('screener', x); setPresetSortState(x); };
  const presetRows = useMemo(() => {
    const byId = new Map((ev.data?.rows ?? []).map((r) => [r.id, r]));
    return sortItems(
      screenerConfig.presets.map((p) => {
        const r = p.evidence_test ? byId.get(p.evidence_test) : undefined;
        const trig = (p.evidence_test && evToday.data?.tests[p.evidence_test]?.t) || {};
        return {
          p,
          label: p.label,
          // 沒有對應指標的組合不算「樣本不足」，排在所有判定之後（verdictTier 的預設層）
          verdict: r?.verdict ?? null,
          t: r?.t ?? null,
          excess: r?.mean_excess ?? null,
          health: r?.recent?.mean_excess ?? null,
          today: Object.values(trig).filter((d) => d === evToday.data?.date).length,
          r,
        };
      }),
      presetSort,
    );
  }, [ev.data, evToday.data, presetSort]);
  // 誠實呈現：條件欄位若多數股票還沒有資料（例如集保大戶逐週累積中），結果會偏少，要說清楚
  const sparse = useMemo(() => {
    if (!summary.data) return [];
    const rows = summary.data.rows as unknown as Record<string, unknown>[];
    return conditions.filter((c) => rows.filter((r) => r[c.field] !== null && r[c.field] !== undefined).length < rows.length * 0.2).map((c) => label(c.field));
  }, [summary.data, conditions]);
  const matched = useMemo(() => (summary.data ? screen(summary.data.rows as unknown as Record<string, unknown>[], conditions) : []), [summary.data, conditions]);
  const fresh = useMemo(() => (days.data ? newTriggerCodes(days.data, conditions) : null), [days.data, conditions]);
  // 今日新觸發：以兩日欄位檔判斷，列表仍用 summary 的列（排序依綜合分）
  const results = useMemo(() => {
    if (mode !== 'new') return matched;
    if (!fresh || !summary.data) return [];
    return screen((summary.data.rows as unknown as Record<string, unknown>[]).filter((r) => fresh.has(r.code as string)), []);
  }, [mode, matched, fresh, summary.data]);
  const weekly = weeklyNote(conditions, meta.data?.weekly ?? days.data?.weekly);
  // #11：名稱跟著條件走；改過內建組合就不再沿用它的名稱與選取狀態
  const presets = presetScreens();
  const id = screenIdentity(conditions, active, presets, saved.map((x) => ({ id: x.id, label: x.name, conditions: x.conditions as Condition[] })));
  const title = id.name;
  const backtestHref = id.presetId
    ? `#/explore/backtest?preset=${id.presetId}`
    : `#/explore/backtest?c=${encodeConditions(conditions)}&name=${encodeURIComponent(id.name)}${id.savedId ? '&own=1' : ''}`;

  function load(id: string, nm: string, cs: Condition[]) {
    setActive(id);
    setName(nm);
    setConditions(cs.map((c) => ({ ...c })));
  }

  async function save() {
    const nm = prompt('條件組合名稱', id.presetId || id.name === '自訂條件' ? '' : name) ?? '';
    if (!nm.trim()) return;
    // 改過內建組合後儲存 → 新的「我的組合」；改過我的組合後儲存 → 覆寫該組合
    const existing = saved.find((s) => s.id === id.savedId);
    const item: SavedScreen = { id: existing ? existing.id : uid(), name: nm.trim(), conditions, createdAt: new Date().toISOString() };
    await saveScreen(item);
    load(item.id, item.name, conditions);
  }

  return (
    <div class="page">
      <TopBar back="/explore" actions={<a class="btn small" href={backtestHref}>一鍵回測</a>} />
      <PageHead title="選股" sub={summary.data ? `${title}・${mode === 'new' ? `今日新觸發 ${results.length} 檔` : `${results.length} 檔符合`}・依規則產生，非推薦` : undefined} />
      <DataStatus date={summary.data?.date} uses={PAGE_SOURCES.screener} />
      <a class="list-item st-entry" href="#/explore/strategies">
        <span class="grow"><span class="body w6">策略庫</span><span class="caption muted" style={{ display: 'block' }}>指標效度評估通過的策略・今日新觸發・槓桿風險計算</span></span>
      </a>
      <h2 class="section-title">內建組合</h2>
      <SortMenu id="screener" value={presetSort} onChange={setPresetSort} />
      <div class="chips" role="group" aria-label="內建組合" data-testid="preset-chips">
        {presetRows.map(({ p, r }) => (
          <button key={p.id} class="chip" aria-pressed={id.presetId === p.id} onClick={() => load(p.id, p.label, p.conditions)} title={p.description}
            aria-label={`${p.label}（${r ? `${r.verdict}，t ${tText(r.t)}，10 日超額 ${pctSigned(r.mean_excess)}` : NO_EVIDENCE}）`}>
            <span class="chip-label">{p.label}</span><span class="chip-sub">{r ? r.verdict : NO_EVIDENCE}</span>
          </button>
        ))}
      </div>
      {saved.length ? (
        <>
          <h2 class="section-title">我的組合</h2>
          <div class="chips" role="group" aria-label="我的組合">
            {saved.map((s) => (
              <button key={s.id} class="chip" aria-pressed={id.savedId === s.id && !id.modifiedFrom} onClick={() => load(s.id, s.name, s.conditions as Condition[])}>{savedDisplayName(s.name, s.conditions as Condition[], presets)}</button>
            ))}
          </div>
        </>
      ) : null}
      <p class="small muted" data-testid="screen-desc">{id.presetId ? (() => { const p = screenerConfig.presets.find((x) => x.id === id.presetId)!; return <><b class="t1">{p.subtitle}</b>：{p.description}</>; })() : id.modifiedFrom ? `由「${id.modifiedFrom}」修改；和任何內建組合都不同。` : id.savedId ? name : '自訂條件：和任何內建組合都不同。'}</p>

      <h2 class="section-title">條件（全部成立）</h2>
      {conditions.map((c, i) => (
        <ConditionEditor key={i} c={c} onChange={(nc) => setConditions(conditions.map((x, j) => (j === i ? nc : x)))} onRemove={() => setConditions(conditions.filter((_, j) => j !== i))} />
      ))}
      <div class="row wrap">
        <button class="btn" onClick={() => setConditions([...conditions, { field: 'composite', op: '>=', value: 60 }])}>新增條件</button>
        <button class="btn" onClick={save}>儲存組合</button>
        <a class="btn" href={id.presetId ? `#/discipline/tracking?preset=${id.presetId}` : `#/discipline/tracking?c=${encodeConditions(conditions)}&name=${encodeURIComponent(id.name)}`}>設為追蹤策略</a>
        {id.savedId ? <button class="btn danger" onClick={() => deleteScreen(id.savedId!)}>刪除組合</button> : null}
      </div>

      <h2 class="section" style={{ marginTop: 'var(--s-8)' }}>結果 {summary.data ? <span class="muted caption">{results.length} 檔</span> : null}</h2>
      <div class="segmented" role="group" aria-label="結果範圍" style={{ marginTop: 'var(--s-2)' }}>
        <button aria-pressed={mode === 'all'} onClick={() => setMode('all')}>全部符合</button>
        <button aria-pressed={mode === 'new'} onClick={() => setMode('new')}>今日新觸發</button>
      </div>
      <p class="caption muted" data-testid="screen-mode-note" style={{ marginTop: 'var(--s-2)' }}>
        {mode === 'new'
          ? days.data ? `今日新觸發＝${md(days.data.dates[1])} 全部條件成立、${md(days.data.dates[0])} 不成立（回測的「訊號」用同一個定義）。${fresh === null ? '有條件欄位無法判斷前一日，無法計算新觸發。' : ''}` : days.error ? '新觸發資料暫時無法取得（資料源待處理）。' : '載入前一交易日資料…'
          : `全部符合＝${summary.data?.date ? md(summary.data.date) : '最新交易日'}收盤後全部條件成立的股票（含前幾天就已經符合的）。`}
        {weekly ? <><br /><span data-testid="weekly-note">{weekly}</span></> : null}
      </p>
      {summary.error ? <ErrorState error={summary.error} /> : null}
      {summary.loading && !summary.data ? <Loading /> : null}
      {summary.data && !results.length ? (
        <div class="empty">
          <p>{sparse.length ? `「${sparse.join('、')}」目前多數股票還沒有資料（資料累積中），所以沒有股票符合。` : '目前沒有股票同時符合所有條件。'}</p>
          <button class="btn" onClick={() => setConditions(conditions.slice(0, -1))} disabled={!conditions.length}>移除最後一個條件</button>
        </div>
      ) : sparse.length ? <p class="caption muted">「{sparse.join('、')}」資料累積中，結果可能偏少。</p> : null}
      <div class="stock-list">
        {results.slice(0, 100).map((r) => {
          const row = r as unknown as import('../data/types').StockRow;
          return (
            <StockMiniRow key={row.code} row={row} risk={!!row.flags?.length}
              text={row.flags?.length ? row.flags.map((f) => f.label).join('、') : conditions.map((c) => `${label(c.field)} ${fmtNum(r[c.field] as number, 1)}`).join('・')}
              onOpen={() => { setListContext({ name: '選股結果', codes: results.slice(0, 100).map((x) => (x as { code: string }).code) }); navigate(`/stock/${row.code}`); }} />
          );
        })}
      </div>
      {results.length > 100 ? <p class="small muted">僅顯示前 100 檔（依綜合分排序）。</p> : null}
      <p class="tiny muted">條件：{conditions.map((c) => describeCondition(c, label, unit)).join('；') || '無'}。結果為規則篩選，非推薦。</p>
    </div>
  );
}
