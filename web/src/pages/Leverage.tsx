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
import { fmtCount, missing, orMissing, pctPlain, pctSigned, ratioText } from '../lib/format';
import { BREAKER_TEXT, type LeverageInput, leverage, nearestSlots } from '../lib/leverage';
import { isListed } from '../lib/status';
import { loadStrategies } from './Strategies';
import '../styles/evidence.css';

const money = (v: number) => `${fmtCount(v)} 元`;
const LIMITED = { drawdown: '可承受回撤', kelly: '半凱利', ceiling: '2.5 倍天花板', none: missing('沒有限制條件') } as const;
const times = (v: number) => `${ratioText(v)} 倍`;
/** 歷史數字缺值的原因：策略還沒有逐筆或組合模擬資料。 */
const NO_TRADES = '沒有逐筆模擬資料';
const NO_PORT = '沒有組合模擬資料';
const NO_INPUT = '尚未計算';

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
  // 只列上架（分級為有效／觀察中）的策略；portfolio 現在每套有評估的策略都有，所以不能再用 portfolio 有無來判斷
  const enabled = (d.data?.strategies ?? []).filter((s) => isListed(s));
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
              <tr><th scope="row">波動目標法倍數</th><td>{res ? orMissing(res.lDd, times, '沒有回撤與不利波動資料') : missing(NO_INPUT)}</td></tr>
              <tr><th scope="row">半凱利倍數</th><td>{res ? orMissing(res.lKelly, times, '沒有年化報酬與波動資料') : missing(NO_INPUT)}</td></tr>
              <tr><th scope="row"><b>計算結果（兩者取小）</b></th><td><b>{res ? times(res.multiple) : missing(NO_INPUT)}</b></td></tr>
              <tr><th scope="row">受限於</th><td>{res ? LIMITED[res.limitedBy] : missing(NO_INPUT)}</td></tr>
              <tr><th scope="row">總部位</th><td>{res ? money(res.exposure) : missing(NO_INPUT)}</td></tr>
              <tr><th scope="row">融資金額</th><td>{res ? money(res.loan) : missing(NO_INPUT)}</td></tr>
              <tr><th scope="row">一年融資利息</th><td>{res ? money(res.interestYear) : missing(NO_INPUT)}</td></tr>
              <tr><th scope="row">扣利息後年化（歷史）</th><td>{res ? orMissing(res.netReturn, pctSigned, '沒有年化報酬資料') : missing(NO_INPUT)}</td></tr>
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
                  <td class={x.call ? 'risk-text' : ''}>{x.maintenance === null ? '無融資' : `${pctPlain(x.maintenance)}${x.call ? '・追繳' : ''}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="caption muted">維持率＝以融資取得的股票市值 ÷ 融資金額（融資 6 成，初始約 167%），低於 {d.data.leverage.maintenance_call}% 會被追繳。連續 2 日跌停：每日 −10%，合計約 −19%，期間無法出場。</p>

          <h2 class="section st-h">策略的歷史數字（{k} 檔組合）</h2>
          <table class="ev-table" aria-label="策略歷史">
            <tbody>
              <tr><th scope="row">最大回撤</th><td>{orMissing(port?.mdd, pctSigned, NO_PORT)}</td></tr>
              <tr><th scope="row">目前自高點回撤</th><td>{orMissing(port?.current_dd, pctSigned, NO_PORT)}</td></tr>
              <tr><th scope="row">年化報酬</th><td>{orMissing(port?.ann_return, pctSigned, NO_PORT)}</td></tr>
              <tr><th scope="row">年化波動</th><td>{orMissing(port?.vol_ann, pctPlain, NO_PORT)}</td></tr>
              <tr><th scope="row">單筆最大不利波動（中位數／最差 10%／最差 1%）</th><td>{s.trades && [s.trades.mae_p50, s.trades.mae_p90, s.trades.mae_p99].some((v) => v !== null && v !== undefined)
                ? [s.trades.mae_p50, s.trades.mae_p90, s.trades.mae_p99].map((v) => orMissing(v, pctPlain, '樣本不足')).join('／')
                : missing(NO_TRADES)}</td></tr>
              <tr><th scope="row">持有期間遇到跌停鎖死</th><td>{orMissing(s.trades?.lock_rate, (v) => `${pctPlain(v)} 的交易`, NO_TRADES)}</td></tr>
            </tbody>
          </table>
          <p class="caption muted">
            波動目標法＝min(可承受回撤 ÷ 歷史最大回撤, 可承受回撤 × 檔數 ÷ 單筆最差 1% 不利波動)；半凱利＝0.5 ×（年化平均報酬 − 融資利率）÷ 年化波動²；兩者取小、最多 {d.data.leverage.ceiling} 倍。
            {s.signal_start ? `模擬期間 ${s.signal_start} 起，大盤以多頭為主。` : `模擬期間：${missing('沒有訊號期間')}`}
          </p>
          {s.compare?.['00631L'] ? (
            <>
              <h2 class="section st-h">對照：00631L（2 倍槓桿 ETF）同期</h2>
              <table class="ev-table" aria-label="00631L 同期表現">
                <tbody>
                  <tr><th scope="row">年化報酬</th><td>{orMissing(s.compare['00631L'].ann_return, pctSigned, '沒有同期資料')}</td></tr>
                  <tr><th scope="row">年化波動</th><td>{orMissing(s.compare['00631L'].vol_ann, pctPlain, '沒有同期資料')}</td></tr>
                  <tr><th scope="row">最大回撤</th><td>{orMissing(s.compare['00631L'].mdd, pctSigned, '沒有同期資料')}</td></tr>
                  <tr><th scope="row">回撤天數</th><td>{orMissing(s.compare['00631L'].dd_days, (v) => `${fmtCount(v)} 日`, '沒有同期資料')}</td></tr>
                </tbody>
              </table>
              <p class="caption muted">00631L 是追蹤台灣 50 指數單日 2 倍報酬的 ETF，每日再平衡：盤整時有波動耗損，長期報酬不等於指數的 2 倍。它是槓桿情境可以直接買到的替代品，不需要融資、沒有追繳，但同樣會遇到大盤急跌；個股融資另有跌停鎖死、當天賣不掉的風險。</p>
            </>
          ) : null}
        </>
      ) : null}
      {d.data && !enabled.length ? <p class="caption">目前沒有上架（有效／觀察中）的策略。</p> : null}
    </div>
  );
}
