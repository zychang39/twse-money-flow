import { useMemo, useState } from 'preact/hooks';
import { Nav } from '../components/Nav';
import { DataStatus, ErrorState, Loading } from '../components/DataStatus';
import { Change } from '../components/Change';
import { Flags } from '../components/Flags';
import { scoreText } from '../components/Scores';
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
    <div class="card" style={{ padding: '0.75rem' }}>
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
    <div>
      <Nav title="選股" actions={<a class="btn small" href={`#/backtest?c=${encodeConditions(conditions)}&name=${encodeURIComponent(name)}`}>一鍵回測</a>} />
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

      <h2 class="title-2">結果 {summary.data ? <span class="muted small">{results.length} 檔</span> : null}</h2>
      {summary.error ? <ErrorState error={summary.error} /> : null}
      {summary.loading && !summary.data ? <Loading /> : null}
      <div class="list">
        {results.slice(0, 100).map((r) => {
          const row = r as unknown as { code: string; name: string; close: number; change: number; change_pct: number; composite: number; flags: [] };
          return (
            <a key={row.code} class="list-item" href={`#/stock/${row.code}`}>
              <div class="grow">
                <div><span class="bold">{row.name}</span> <span class="small muted num">{row.code}</span></div>
                <div class="tiny muted">{conditions.map((c) => `${label(c.field)} ${fmtNum(r[c.field] as number, 1)}`).join('・')}</div>
                <Flags flags={row.flags} compact />
              </div>
              <div style={{ textAlign: 'right' }}>
                <div class="small"><Change change={row.change} pct={row.change_pct} showPrice={row.close} /></div>
                <div class="bold num"><span class="sr-only">綜合分 </span>{scoreText(row.composite)} <span class="tiny muted">分</span></div>
              </div>
            </a>
          );
        })}
      </div>
      {results.length > 100 ? <p class="small muted">僅顯示前 100 檔（依綜合分排序）。</p> : null}
      <p class="tiny muted">條件：{conditions.map((c) => describeCondition(c, label, unit)).join('；') || '無'}。結果為規則篩選，非推薦。</p>
    </div>
  );
}
