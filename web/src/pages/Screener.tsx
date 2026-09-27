import { useMemo, useState } from 'preact/hooks';
import { PageHead, TopBar } from '../components/Chrome';
import { StockMiniRow } from '../components/StockRow';
import { setListContext } from '../lib/listContext';
import { navigate } from '../router';
import { DataStatus, ErrorState, Loading } from '../components/DataStatus';
import { useDb } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { deleteScreen, listScreens, saveScreen, uid, type SavedScreen } from '../db/db';
import { screenerConfig, type Condition } from '../lib/config';
import { describeCondition, encodeConditions, screen } from '../lib/screener';
import { fmtNum } from '../lib/format';

const OPS: Condition['op'][] = ['>=', '>', '<=', '<', '==', 'between'];
const fields = screenerConfig.fields;
const groups = Array.from(new Set(Object.values(fields).map((f) => f.group)));
const label = (f: string) => fields[f]?.label ?? f;
const unit = (f: string) => fields[f]?.unit ?? '';

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
  const [conditions, setConditions] = useState<Condition[]>(screenerConfig.presets[0].conditions);
  const [active, setActive] = useState<string>(screenerConfig.presets[0].id);
  const [name, setName] = useState(screenerConfig.presets[0].label);
  // 誠實呈現：條件欄位若多數股票還沒有資料（例如集保大戶逐週累積中），結果會偏少，要說清楚
  const sparse = useMemo(() => {
    if (!summary.data) return [];
    const rows = summary.data.rows as unknown as Record<string, unknown>[];
    return conditions.filter((c) => rows.filter((r) => r[c.field] !== null && r[c.field] !== undefined).length < rows.length * 0.2).map((c) => label(c.field));
  }, [summary.data, conditions]);
  const results = useMemo(() => (summary.data ? screen(summary.data.rows as unknown as Record<string, unknown>[], conditions) : []), [summary.data, conditions]);

  function load(id: string, nm: string, cs: Condition[]) {
    setActive(id);
    setName(nm);
    setConditions(cs.map((c) => ({ ...c })));
  }

  async function save() {
    const nm = prompt('條件組合名稱', name) ?? '';
    if (!nm.trim()) return;
    const existing = saved.find((s) => s.id === active);
    const item: SavedScreen = { id: existing ? existing.id : uid(), name: nm.trim(), conditions, createdAt: new Date().toISOString() };
    await saveScreen(item);
    load(item.id, item.name, conditions);
  }

  return (
    <div class="page">
      <TopBar back="/explore" actions={<a class="btn small" href={`#/explore/backtest?c=${encodeConditions(conditions)}&name=${encodeURIComponent(name)}${saved.some((s) => s.id === active) ? '&own=1' : ''}`}>一鍵回測</a>} />
      <PageHead eyebrow="自選股以外，有哪些符合條件的股票？" title={summary.data ? `${name}：${results.length} 檔符合` : '選股'} />
      <DataStatus date={summary.data?.date} />
      <h2 class="section-title">內建組合</h2>
      <div class="chips" role="group" aria-label="內建組合">
        {screenerConfig.presets.map((p) => (
          <button key={p.id} class="chip" aria-pressed={active === p.id} onClick={() => load(p.id, p.label, p.conditions)} title={p.description}>{p.label}</button>
        ))}
      </div>
      {saved.length ? (
        <>
          <h2 class="section-title">我的組合</h2>
          <div class="chips" role="group" aria-label="我的組合">
            {saved.map((s) => (
              <button key={s.id} class="chip" aria-pressed={active === s.id} onClick={() => load(s.id, s.name, s.conditions as Condition[])}>{s.name}</button>
            ))}
          </div>
        </>
      ) : null}
      <p class="small muted">{screenerConfig.presets.find((p) => p.id === active)?.description ?? name}</p>

      <h2 class="section-title">條件（全部成立）</h2>
      {conditions.map((c, i) => (
        <ConditionEditor key={i} c={c} onChange={(nc) => setConditions(conditions.map((x, j) => (j === i ? nc : x)))} onRemove={() => setConditions(conditions.filter((_, j) => j !== i))} />
      ))}
      <div class="row wrap">
        <button class="btn" onClick={() => setConditions([...conditions, { field: 'composite', op: '>=', value: 60 }])}>新增條件</button>
        <button class="btn" onClick={save}>儲存組合</button>
        {saved.some((s) => s.id === active) ? <button class="btn danger" onClick={() => deleteScreen(active)}>刪除組合</button> : null}
      </div>

      <h2 class="section" style={{ marginTop: 'var(--s-8)' }}>結果 {summary.data ? <span class="muted caption">{results.length} 檔</span> : null}</h2>
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
