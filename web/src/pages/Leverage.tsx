/**
 * 槓桿風險計算（M2；METHODOLOGY §11.3）：依策略歷史的最大回撤、最大不利波動分布、跌停鎖死發生率，
 * 計算波動目標法與半凱利兩種倍數（取小、2.5 倍為天花板），並列出情境損失與融資維持率。這是風險計算，不是建議。
 */
import { useEffect, useState } from 'preact/hooks';
import { PageHead, TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { useAsync } from '../hooks';
import { getSetting, setSetting } from '../db/db';
import { useRoute } from '../router';
import { pctSigned } from '../lib/evidence';
import { BREAKER_TEXT, type LeverageInput, leverage, nearestSlots } from '../lib/leverage';
import { loadStrategies } from './Strategies';
import '../styles/evidence.css';

const money = (v: number) => `${Math.round(v).toLocaleString('zh-TW')} 元`;
const LIMITED = { drawdown: '可承受回撤', kelly: '半凱利', ceiling: '2.5 倍天花板', none: '—' } as const;

function Num({ label, value, onInput, step = 1, unit }: { label: string; value: number | null; onInput: (v: number | null) => void; step?: number; unit: string }) {
  return (
    <label class="field">
      <span>{label}（{unit}）</span>
      <input class="input lv-input" type="number" inputMode="decimal" step={step} value={value ?? ''}
        onInput={(e) => { const t = (e.target as HTMLInputElement).value; onInput(t === '' ? null : Number(t)); }} />
    </label>
  );
}

export default function Leverage() {
  const route = useRoute();
  const d = useAsync(loadStrategies, []);
  const enabled = (d.data?.strategies ?? []).filter((s) => s.enabled);
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
  const s = enabled.find((x) => x.id === sid) ?? enabled[0];
  const set = (patch: Partial<LeverageInput>) => {
    if (!input) return;
    const next = { ...input, ...patch };
    setInput(next);
    setSetting('leverage', next);
  };
  const k = input && d.data ? nearestSlots(input.slots, d.data.slots) : 5;
  const port = s?.portfolio?.[String(k)];
  const res = input && s && port && d.data ? leverage({ ...input, slots: k }, port, s.trades ?? {}, d.data.leverage) : null;
  return (
    <div class="page">
      <TopBar back={s ? `/explore/strategies/${s.id}` : '/explore/strategies'} />
      <PageHead eyebrow="風險計算，不是建議" title="槓桿風險計算" >
        <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>以策略的歷史回撤與波動計算倍數；歷史不代表未來。台股跌停時可能整天賣不掉（跌停鎖死），損失可能超過表中數字。</p>
      </PageHead>
      {d.loading ? <Loading /> : null}
      {d.error ? <ErrorState error={d.error} /> : null}
      {d.data && input && s ? (
        <>
          <div class="card">
            <label class="field">
              <span>策略</span>
              <select class="select" value={s.id} onChange={(e) => setSid((e.target as HTMLSelectElement).value)}>
                {enabled.map((x) => <option key={x.id} value={x.id}>{x.label}（{x.subtitle}）</option>)}
              </select>
            </label>
            <Num label="總資金" unit="元" step={10000} value={input.capital} onInput={(v) => set({ capital: v ?? 0 })} />
            <Num label="最大可承受回撤" unit="%" value={input.maxDd} onInput={(v) => set({ maxDd: v ?? 0 })} />
            <div class="field">
              <label>同時持有檔數</label>
              <div class="segmented" role="group" aria-label="同時持有檔數">
                {d.data.slots.map((n) => <button key={n} aria-pressed={k === n} onClick={() => set({ slots: n })}>{n} 檔</button>)}
              </div>
            </div>
            <Num label="融資年利率" unit="%" step={0.1} value={input.interest} onInput={(v) => set({ interest: v ?? 0 })} />
            <Num label="回撤斷路器門檻" unit="%" value={input.breaker} onInput={(v) => set({ breaker: v ?? 0 })} />
            <Num label="你的帳戶目前自高點回撤（可不填）" unit="%" step={0.1} value={input.accountDd} onInput={(v) => set({ accountDd: v })} />
          </div>

          {res?.breaker ? <div class="banner risk" role="alert"><div><b>{BREAKER_TEXT}</b><br />{res.breakerReason}</div></div> : null}

          <h2 class="section st-h">計算結果</h2>
          <table class="ev-table" aria-label="槓桿倍數">
            <tbody>
              <tr><th scope="row">波動目標法倍數</th><td>{res?.lDd === null || res?.lDd === undefined ? '—' : `${res.lDd.toFixed(2)} 倍`}</td></tr>
              <tr><th scope="row">半凱利倍數</th><td>{res?.lKelly === null || res?.lKelly === undefined ? '—' : `${res.lKelly.toFixed(2)} 倍`}</td></tr>
              <tr><th scope="row"><b>計算結果（兩者取小）</b></th><td><b>{res ? `${res.multiple.toFixed(2)} 倍` : '—'}</b></td></tr>
              <tr><th scope="row">受限於</th><td>{res ? LIMITED[res.limitedBy] : '—'}</td></tr>
              <tr><th scope="row">總部位</th><td>{res ? money(res.exposure) : '—'}</td></tr>
              <tr><th scope="row">融資金額</th><td>{res ? money(res.loan) : '—'}</td></tr>
              <tr><th scope="row">一年融資利息</th><td>{res ? money(res.interestYear) : '—'}</td></tr>
              <tr><th scope="row">扣利息後年化（歷史）</th><td>{pctSigned(res?.netReturn)}</td></tr>
            </tbody>
          </table>

          <h2 class="section st-h">情境損失</h2>
          <table class="ev-table" aria-label="情境損失">
            <thead><tr><th scope="col">情境</th><th scope="col">損失</th><th scope="col">維持率</th></tr></thead>
            <tbody>
              {(res?.scenarios ?? []).map((x) => (
                <tr key={x.label}>
                  <th scope="row" class="ev-wrap">{x.label}</th>
                  <td>{money(x.loss)}</td>
                  <td class={x.call ? 'risk-text' : ''}>{x.maintenance === null ? '無融資' : `${x.maintenance.toFixed(0)}%${x.call ? '・追繳' : ''}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="caption muted">維持率＝融資買進的股票市值 ÷ 融資金額（融資 6 成，初始約 167%），低於 {d.data.leverage.maintenance_call}% 會被追繳。連續 2 日跌停：每日 −10%，合計約 −19%，期間無法賣出。</p>

          <h2 class="section st-h">策略的歷史數字（{k} 檔組合）</h2>
          <table class="ev-table" aria-label="策略歷史">
            <tbody>
              <tr><th scope="row">最大回撤</th><td>{pctSigned(port?.mdd)}</td></tr>
              <tr><th scope="row">目前自高點回撤</th><td>{pctSigned(port?.current_dd)}</td></tr>
              <tr><th scope="row">年化報酬</th><td>{pctSigned(port?.ann_return)}</td></tr>
              <tr><th scope="row">年化波動</th><td>{port?.vol_ann === null || port?.vol_ann === undefined ? '—' : `${port.vol_ann.toFixed(1)}%`}</td></tr>
              <tr><th scope="row">單筆最大不利波動（中位數／最差 10%／最差 1%）</th><td>{s.trades?.mae_p50 ?? '—'}／{s.trades?.mae_p90 ?? '—'}／{s.trades?.mae_p99 ?? '—'}%</td></tr>
              <tr><th scope="row">持有期間遇到跌停鎖死</th><td>{s.trades?.lock_rate ?? '—'}% 的交易</td></tr>
            </tbody>
          </table>
          <p class="caption muted">
            波動目標法＝min(可承受回撤 ÷ 歷史最大回撤, 可承受回撤 × 檔數 ÷ 單筆最差 1% 不利波動)；半凱利＝0.5 ×（年化平均報酬 − 融資利率）÷ 年化波動²；兩者取小、最多 {d.data.leverage.ceiling} 倍。
            模擬期間 {s.signal_start} 起，大盤以多頭為主。
          </p>
          {s.compare?.['00631L'] ? (
            <>
              <h2 class="section st-h">對照：00631L（2 倍槓桿 ETF）同期</h2>
              <table class="ev-table" aria-label="00631L 同期表現">
                <tbody>
                  <tr><th scope="row">年化報酬</th><td>{pctSigned(s.compare['00631L'].ann_return)}</td></tr>
                  <tr><th scope="row">年化波動</th><td>{pctSigned(s.compare['00631L'].vol_ann)}</td></tr>
                  <tr><th scope="row">最大回撤</th><td>{pctSigned(s.compare['00631L'].mdd)}</td></tr>
                  <tr><th scope="row">回撤天數</th><td>{s.compare['00631L'].dd_days?.toLocaleString('zh-TW') ?? '—'}</td></tr>
                </tbody>
              </table>
              <p class="caption muted">00631L 是追蹤台灣 50 指數單日 2 倍報酬的 ETF，每日再平衡：盤整時有波動耗損，長期報酬不等於指數的 2 倍。它是槓桿情境可以直接買到的替代品，不需要融資、沒有追繳，但同樣會遇到大盤急跌；個股融資另有跌停鎖死、當天賣不掉的風險。</p>
            </>
          ) : null}
        </>
      ) : null}
      {d.data && !enabled.length ? <p class="caption">目前沒有通過驗證的策略。</p> : null}
    </div>
  );
}
