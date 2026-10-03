/**
 * 槓桿風險計算（2026-10-03 改版）：只做風險計算、不是建議。
 * 風險數字改用組合層級：K 檔組合（固定 40 日出場）的最大回撤與 40 日內最大不利波動（strategies.json leverage.by_slots），
 * 計算波動目標法與半凱利兩種倍數（取小、2.5 倍為天花板），並列出情境損失與融資維持率。
 */
import { useEffect, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { Card, CardLabel, EmptyRow, List, PageTitle, Row, Section, Seg, Signed, Table, Warn } from '../components/ui';
import { useAsync } from '../hooks';
import { getSetting, setSetting } from '../db/db';
import { useRoute } from '../router';
import { fmtCount, md, pctPlain, ratioText } from '../lib/format';
import { BREAKER_TEXT, type LeverageInput, leverage, nearestSlots } from '../lib/leverage';
import { isListed } from '../lib/status';
import { loadStrategies } from './Strategies';
import { keepNum } from '../components/StrategyBits';
import '../styles/strategy.css';

const money = (v: number) => `${fmtCount(v)} 元`;
const LIMITED = { drawdown: '可承受回撤', kelly: '半凱利', ceiling: '2.5 倍上限', none: '—' } as const;
const times = (v: number | null) => (v === null ? '—' : `${ratioText(v)} 倍`);

function NumInput({ label, value, onInput, step = 1, unit, sub }: { label: string; value: number | null; onInput: (v: number | null) => void; step?: number; unit: string; sub?: string }) {
  return (
    <Row
      label={label}
      sub={sub}
      value={(
        <span class="lv-field">
          <input class="lv-input" type="number" inputMode="decimal" step={step} value={value ?? ''} aria-label={`${label}（${unit}）`}
            onInput={(e) => { const t = (e.target as HTMLInputElement).value; onInput(t === '' ? null : Number(t)); }} />
          <span class="ui-unit">{unit}</span>
        </span>
      )}
    />
  );
}

export default function Leverage() {
  const route = useRoute();
  const d = useAsync(loadStrategies, []);
  const listed = (d.data?.strategies ?? []).filter((s) => isListed(s));
  const [sid, setSid] = useState<string>(route.query.get('s') ?? '');
  const [input, setInput] = useState<LeverageInput | null>(null);
  useEffect(() => {
    if (!d.data) return;
    const r = d.data.leverage;
    getSetting<Partial<LeverageInput>>('leverage', {}).then((saved) => setInput({
      capital: saved.capital ?? 1_000_000, maxDd: saved.maxDd ?? r.default_max_dd, slots: saved.slots ?? 5,
      interest: saved.interest ?? r.default_interest, breaker: saved.breaker ?? r.default_breaker, accountDd: saved.accountDd ?? null,
    }));
  }, [d.data]);
  const s = listed.find((x) => x.id === sid) ?? listed[0];
  const set = (patch: Partial<LeverageInput>) => {
    if (!input) return;
    const next = { ...input, ...patch };
    setInput(next);
    setSetting('leverage', next);
  };
  const k = input && d.data ? nearestSlots(input.slots, d.data.slots) : 5;
  const port = s?.portfolio?.[String(k)];
  const risk = { ...(s?.leverage?.by_slots?.[String(k)] ?? {}), window: s?.leverage?.window ?? 40 };
  const res = input && s && port && d.data ? leverage({ ...input, slots: k }, port, risk, d.data.leverage) : null;
  const rules = d.data?.leverage;
  const info = (
    <>
      <p>風險計算，不是建議。歷史數字來自策略的 K 檔組合模擬（固定 {risk.window} 日出場、扣成本），歷史不代表未來。</p>
      <p>波動目標法＝min(可承受回撤 ÷ 組合最大回撤, 可承受回撤 ÷ 組合 {risk.window} 日內最大不利波動)；半凱利＝0.5 ×（年化平均報酬 − 融資利率）÷ 年化波動²；兩者取小、最多 {rules?.ceiling ?? 2.5} 倍。</p>
      <p>組合最大回撤：權益從歷史高點的最大跌幅。組合最大不利波動：從任一交易日起 {risk.window} 個交易日內，權益相對起點的最大跌幅。</p>
      <p>維持率＝以融資取得的股票市值 ÷ 融資金額（融資 6 成，初始約 167%），低於 {rules?.maintenance_call ?? 130}% 追繳。連續 2 日跌停：每日 −10%，合計約 −19%，期間無法出場。</p>
      <p>00631L 追蹤台灣 50 指數單日 2 倍報酬、每日再平衡，盤整時有波動耗損；不需要融資、沒有追繳，但同樣受大盤急跌影響。</p>
    </>
  );
  return (
    <div class="page">
      <TopBar back={s ? `/explore/strategies/${s.id}` : '/explore/strategies'} />
      <PageTitle title="槓桿風險" sub="風險計算，不是建議・歷史不代表未來" />
      {d.loading ? <Loading /> : null}
      {d.error ? <ErrorState error={d.error} /> : null}
      {d.data && input && s ? (
        <>
          <Section title="輸入">
            <Card>
              <label class="lv-select">
                <span class="ui-foot ui-muted">策略</span>
                <select class="select" value={s.id} onChange={(e) => setSid((e.target as HTMLSelectElement).value)}>
                  {listed.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </label>
              <CardLabel>同時持有檔數</CardLabel>
              <Seg options={d.data.slots.map((n) => [String(n), `${n} 檔`] as const)} value={String(k)} onChange={(v) => set({ slots: Number(v) })} label="同時持有檔數" />
              <List>
                <NumInput label="總資金" unit="元" step={10000} value={input.capital} onInput={(v) => set({ capital: v ?? 0 })} />
                <NumInput label="可承受回撤" unit="%" value={input.maxDd} onInput={(v) => set({ maxDd: v ?? 0 })} />
                <NumInput label="融資年利率" unit="%" step={0.1} value={input.interest} onInput={(v) => set({ interest: v ?? 0 })} />
                <NumInput label="斷路器門檻" unit="%" value={input.breaker} onInput={(v) => set({ breaker: v ?? 0 })} />
                <NumInput label="帳戶目前回撤" sub="可不填" unit="%" step={0.1} value={input.accountDd} onInput={(v) => set({ accountDd: v })} />
              </List>
            </Card>
          </Section>

          {res?.breaker ? <Warn testid="lv-breaker">{BREAKER_TEXT}・{res.breakerReason}</Warn> : null}

          <Section title="倍數" info={info}>
            <List>
              <Row label="波動目標法" value={res ? times(res.lDd) : '—'} />
              <Row label="半凱利" value={res ? times(res.lKelly) : '—'} />
              <Row label="兩者取小" sub={res ? `受限於${LIMITED[res.limitedBy]}` : undefined} value={res ? times(res.multiple) : '—'} strong testid="lv-multiple" />
              <Row label="總部位" value={res ? money(res.exposure) : '—'} />
              <Row label="融資金額" value={res ? money(res.loan) : '—'} />
              <Row label="一年融資利息" value={res ? money(res.interestYear) : '—'} />
              <Row label="扣利息後年化（歷史）" value={res ? <Signed v={res.netReturn} unit="%" tone="plain" /> : '—'} />
            </List>
          </Section>

          <Section title="情境損失">
            <Card>
              <Table
                caption="情境損失與融資維持率"
                cols={[
                  { key: 'l', label: '情境', render: (x) => keepNum(x.label) },
                  { key: 'loss', label: '損失', align: 'r', width: '7rem', render: (x) => money(x.loss) },
                  { key: 'm', label: '維持率', align: 'r', width: '5.5rem', render: (x) => (x.maintenance === null ? '無融資' : <span class={x.call ? 'ui-risk' : ''}>{pctPlain(x.maintenance)}{x.call ? ' 追繳' : ''}</span>) },
                ]}
                rows={res?.scenarios ?? []}
                rowKey={(x) => x.label}
              />
            </Card>
          </Section>

          <Section title={`組合風險（${k} 檔）`} aside={s.signal_start ? `${md(s.signal_start)}（${s.signal_start.slice(0, 4)}）起` : undefined}>
            <List>
              <Row label="組合最大回撤" value={<Signed v={risk.port_mdd ?? port?.mdd ?? null} unit="%" tone="plain" />} testid="lv-port-mdd" />
              <Row label={`${risk.window} 日內最大不利波動`} sub={risk.max_adverse_start ? `${risk.max_adverse_start} 起` : undefined} value={<Signed v={risk.port_max_adverse ?? null} unit="%" tone="plain" />} testid="lv-port-adverse" />
              <Row label="目前自高點回撤" value={<Signed v={port?.current_dd ?? null} unit="%" tone="plain" />} />
              <Row label="年化報酬" value={<Signed v={port?.ann_return ?? null} unit="%" tone="plain" />} />
              <Row label="年化波動" value={port?.vol_ann === null || port?.vol_ann === undefined ? '—' : `${pctPlain(port.vol_ann)}`} />
              <Row label="持有期間遇跌停鎖死" value={s.trades?.lock_rate === null || s.trades?.lock_rate === undefined ? '—' : `${pctPlain(s.trades.lock_rate)}`} />
            </List>
          </Section>

          {s.compare?.['00631L'] ? (
            <Section title="00631L 同期">
              <List>
                <Row label="年化報酬" value={<Signed v={s.compare['00631L'].ann_return ?? null} unit="%" tone="plain" />} />
                <Row label="年化波動" value={s.compare['00631L'].vol_ann === null || s.compare['00631L'].vol_ann === undefined ? '—' : pctPlain(s.compare['00631L'].vol_ann)} />
                <Row label="最大回撤" value={<Signed v={s.compare['00631L'].mdd ?? null} unit="%" tone="plain" />} />
              </List>
            </Section>
          ) : null}
        </>
      ) : null}
      {d.data && !listed.length ? <List><EmptyRow>無上架策略</EmptyRow></List> : null}
    </div>
  );
}
