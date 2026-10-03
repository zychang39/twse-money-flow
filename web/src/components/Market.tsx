/** 市場相關的共用區塊：資金指標清單、三大法人金額列、AI 摘要。 */
import { useState } from 'preact/hooks';
import type { AiSummary, MarketData, MarketLight, TurnoverCell, TurnoverDay } from '../data/types';
import { LIGHT_LABEL, envConclusion, envCounts, envInfo, type EnvValidation } from '../lib/envState';
import { MINUS, arrow, dirClass, fmtNum, md, missing, pctPlain } from '../lib/format';
import { IconChevronDown } from './Icons';
import { KeyValueList } from './Metrics';
import { NetBars } from './Viz';

/**
 * 資金環境 5 項指標的鍵值列（2026-10-02 健檢 M1-7）：每一項都寫出名稱／目前值／門檻／判定，
 * 讓「指數創高、法人買超卻是保守」有依據可查；只有「風險」用琥珀。
 */
export function EnvList({ lights }: { lights: MarketLight[] }) {
  return (
    <KeyValueList label="資金指標明細" rows={lights.map((l) => ({
      k: l.label,
      v: (
        <span class="row between" style={{ gap: 'var(--s-2)' }}>
          <span class="num">{l.value || missing('資料累積中')}</span>
          <span class={`caption w6 ${l.state === 'red' ? 'risk' : 'muted'}`}>{LIGHT_LABEL[l.state]}</span>
        </span>
      ),
      sub: `門檻：${l.basis || '—（未定義）'}`,
    }))} />
  );
}

/** 燈號計數「風險 3／有利 1／中性 1」；回測驗證顯著時才接「→ 保守」（env.validation.show_conclusion）。 */
export function EnvVerdictLine({ lights, validation }: { lights: MarketLight[] | undefined; validation?: EnvValidation | null }) {
  const env = envInfo(lights);
  const c = envConclusion(env, validation);
  return <p class="caption" style={{ marginTop: 'var(--s-2)' }} data-testid="env-verdict"><span class="w6">{envCounts(env)}{c ? ` → ${c}` : ''}</span></p>;
}

export function LightsList({ lights }: { lights: MarketLight[] }) {
  return (
    <div class="list">
      {lights.map((l) => (
        <div key={l.id} class="list-item" style={{ alignItems: 'flex-start' }}>
          <span class={`light-dot ${l.state}`} aria-hidden="true" />
          <div class="grow">
            <div class="row between"><span class="body">{l.label}</span><span class={`caption w6 ${l.state === 'red' ? 'risk' : 'muted'}`}>{LIGHT_LABEL[l.state]}</span></div>
            <div class="caption t1">{l.value}</div>
            <div class="caption muted">{l.basis}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EnvDetail({ market }: { market: MarketData }) {
  const env = envInfo(market.env?.lights);
  const known = env.red.length + env.green.length + env.yellow.length;
  return (
    <>
      <p class="body">資金環境：<b class={env.state === 'conservative' ? 'risk' : ''}>{env.label}</b></p>
      <EnvVerdictLine lights={market.env?.lights} validation={(market.env as { validation?: EnvValidation } | undefined)?.validation} />
      <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>
        {market.env?.lights.length ?? 0} 項指標中 {known} 項有資料。
      </p>
      {market.env ? <LightsList lights={market.env.lights} /> : <p class="caption muted">資料源待處理。</p>}
      {market.temperature ? (
        <>
          <h2 class="eyebrow" style={{ marginTop: 'var(--s-6)' }}>市場溫度（反向參考）</h2>
          <LightsList lights={market.temperature.lights} />
        </>
      ) : null}
      <EnvSeries market={market} />
      <h2 class="eyebrow" style={{ marginTop: 'var(--s-6)' }}>市場寬度（只列數字，不做判定）</h2>
      <BreadthList breadth={market.breadth} />
    </>
  );
}

/** 口數＋單位（外資台指期淨未平倉）：「+12,345 口」「−3,210 口」「0 口」。 */
export function fmtContracts(v: number | null | undefined, sign = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const r = Math.round(Math.abs(v));
  const s = !sign || r === 0 ? '' : v > 0 ? '+' : MINUS;
  return `${s}${fmtNum(r, 0)} 口`;
}

/** 多空比 %（小台散戶）：「+12.3%」「−4.0%」。 */
export function fmtRatioPct(v: number | null | undefined, sign = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = !sign || v === 0 ? '' : v > 0 ? '+' : MINUS;
  return `${s}${Math.abs(v).toFixed(1)}%`;
}

/** 序列最後一個有值的點（日期與數值）。 */
function lastPoint<T extends { date: string }>(rows: T[], pick: (r: T) => number | null | undefined): { date: string; v: number } | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = pick(rows[i]);
    if (v !== null && v !== undefined && Number.isFinite(v)) return { date: rows[i].date, v };
  }
  return null;
}

/**
 * 期貨與選擇權走勢（M2 2026-10-03；只列數字，不做判定）：
 * - 外資台指期淨未平倉（大台約當口數，`env.futures_series`）：淨多紅、淨空綠（方向性部位，與買超／賣超同一套顏色）；
 * - 小台散戶多空比 %（`temperature.retail[].mtx`，原本只算燈號沒畫過）；
 * - 臺指選擇權未平倉 P/C 比 %（`temperature.pc_series`）：數量型比值用中性灰，不設門檻。
 * 資料來源都是期交所；沒有資料時寫原因，不留白。
 */
export function EnvSeries({ market }: { market: MarketData }) {
  const fut = market.env?.futures_series ?? [];
  const retail = market.temperature?.retail ?? [];
  const pc = market.temperature?.pc_series ?? [];
  const lastFut = lastPoint(fut, (r) => r.net);
  const lastRetail = lastPoint(retail, (r) => r.mtx);
  const lastPc = lastPoint(pc, (r) => r.pc);
  const lastPcVol = lastPoint(pc, (r) => r.vol);
  const rows = [
    {
      k: '外資台指期淨未平倉',
      v: <span class={`num ${dirClass(lastFut?.v)}`}>{lastFut ? `${fmtContracts(lastFut.v)}（${md(lastFut.date)}）` : missing('期交所三大法人期貨資料尚未取得')}</span>,
      sub: '大台約當口數＝大台＋小台/4＋微台/20；正＝淨多、負＝淨空',
    },
    {
      k: '小台散戶多空比',
      v: <span class={`num ${dirClass(lastRetail?.v)}`}>{lastRetail ? `${fmtRatioPct(lastRetail.v)}（${md(lastRetail.date)}）` : missing('期交所未平倉資料尚未取得')}</span>,
      sub: '(散戶多 − 散戶空) ÷ 小台全市場未平倉；散戶多＝全市場 − 三大法人多方',
    },
    {
      k: '臺指選擇權 P/C 比（未平倉）',
      v: <span class="num">{lastPc ? `${pctPlain(lastPc.v)}（${md(lastPc.date)}）` : missing('期交所選擇權 P/C 比資料尚未取得')}</span>,
      sub: `賣權未平倉量 ÷ 買權未平倉量 × 100${lastPcVol ? `；成交量比 ${pctPlain(lastPcVol.v)}` : ''}；只列數字，不設門檻`,
    },
  ];
  return (
    <section style={{ marginTop: 'var(--s-6)' }} aria-label="期貨與選擇權走勢" data-testid="env-series">
      <h2 class="eyebrow">期貨與選擇權走勢（期交所；只列數字，不做判定）</h2>
      <KeyValueList label="期貨與選擇權最新值" rows={rows} />
      {fut.length ? (
        <div style={{ marginTop: 'var(--s-3)' }} data-testid="futures-series">
          <NetBars values={fut.map((r) => r.net)} dates={fut.map((r) => r.date)} label="外資台指期淨未平倉（口）" height={96} unit="口" format={fmtContracts}
            words={['淨多', '淨空']} caption={`外資台指期淨未平倉（大台約當口數）・近 ${fut.length} 個交易日・期交所三大法人期貨`} />
        </div>
      ) : <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>外資台指期淨未平倉走勢：{missing('期交所三大法人期貨資料尚未取得')}</p>}
      {retail.length ? (
        <div style={{ marginTop: 'var(--s-3)' }} data-testid="retail-series">
          <NetBars values={retail.map((r) => r.mtx)} dates={retail.map((r) => r.date)} label="小台散戶多空比（%）" height={96} unit="%" format={fmtRatioPct}
            words={['散戶偏多', '散戶偏空']} caption={`小台散戶多空比（%）・近 ${retail.length} 個交易日・期交所三大法人期貨與全市場未平倉`} />
        </div>
      ) : <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>小台散戶多空比走勢：{missing('期交所未平倉資料尚未取得')}</p>}
      {pc.length ? (
        <div style={{ marginTop: 'var(--s-3)' }} data-testid="pc-series">
          <NetBars values={pc.map((r) => r.pc)} dates={pc.map((r) => r.date)} label="臺指選擇權未平倉 P/C 比（%）" height={96} unit="%" format={(v) => pctPlain(v)}
            minZero neutral emphasizeRecent={false} caption={`臺指選擇權未平倉 P/C 比（%）・近 ${pc.length} 個交易日・期交所每日 Put/Call 比`} />
        </div>
      ) : <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>選擇權 P/C 比走勢：{missing('期交所選擇權 P/C 比資料尚未取得')}</p>}
    </section>
  );
}

/**
 * 三大法人買賣超金額（當日、估算）。2026-10-02 健檢 M1-6：
 * - 標題寫清楚是「當日 10/2」與估算方式（Σ 淨買賣超張數 × 收盤價），不會被誤認為上方期間選擇器的期間；
 * - note：放在期間選擇器下方時由頁面傳入「期間只影響走勢圖」；
 * - 最新一日法人資料尚未公布（三個值都是 null）→ 「—（10/2 法人資料尚未公布）」。
 */
export function FlowsRow({ flow, note, marketDate }: { flow: MarketData['flows'][number] | undefined; note?: string; marketDate?: string | null }) {
  if (!flow) return null;
  const items: [string, number | null][] = [['外資', flow.foreign], ['投信', flow.trust], ['自營商', flow.dealer]];
  const none = items.every(([, v]) => v === null);
  // 法人資料日比行情日早（例：行情 10/2、法人 10/1）：標法人自己的日期，並說明最新交易日尚未公布
  const pendingDate = marketDate && flow.date < marketDate ? marketDate : none ? flow.date : null;
  const title = `三大法人買賣超・當日 ${md(flow.date)}（估算：淨買賣超張數 × 收盤價）`;
  return (
    <div style={{ marginTop: 'var(--s-6)' }} role="group" aria-label={title} data-testid="flows-row">
      <div class="caption muted" style={{ marginBottom: 'var(--s-2)' }}>
        <span class="t1 w6">三大法人買賣超・當日 {md(flow.date)}</span>
        <span>（估算：淨買賣超張數 × 收盤價）</span>
        {note ? <span>・{note}</span> : null}
      </div>
      {none ? (
        <p class="body muted" style={{ margin: 0 }}>{missing(`${md(pendingDate ?? flow.date)} 法人資料尚未公布`)}</p>
      ) : (
        <div class="grid three">
          {items.map(([k, v]) => {
            const d = dirClass(v);
            return (
              <div key={k}>
                <div class="caption muted">{k}</div>
                <div class={`body w6 ${d}`}>
                  {/* D-08：法人資料缺漏時是 null → 顯示「—（原因）」，不是「0 億」 */}
                  <span aria-hidden="true">{v === null ? missing('無資料') : `${arrow(v)} ${fmtNum(Math.abs(v), 1)} 億`}</span>
                  <span class="sr-only">{v === null ? `${k}無資料` : `${k}${d === 'up' ? '買超' : d === 'down' ? '賣超' : ''} ${fmtNum(Math.abs(v), 1)} 億元`}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!none && pendingDate ? <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>{md(pendingDate)} 的法人資料尚未公布，以上為 {md(flow.date)}。</p> : null}
    </div>
  );
}

/** 首頁成交金額（M2，2026-10-03）：當日成交金額（億）、÷ 前 20 日平均的倍數，上市、上櫃各一；近 20 日合計成交金額柱。 */
export function turnoverText(t: TurnoverCell | undefined): string {
  if (!t || t.value === null) return missing('成交金額尚未取得');
  const ratio = t.ma20_ratio === null ? missing('不足 20 個交易日') : `${t.ma20_ratio.toFixed(2)} 倍`;
  return `${fmtNum(t.value, 0)} 億・${ratio}`;
}

export function TurnoverRow({ turnover }: { turnover: TurnoverDay[] | undefined }) {
  if (!turnover?.length) return null;
  const last = turnover[turnover.length - 1];
  const recent = turnover.slice(-20);
  const cells: [string, TurnoverCell][] = [['上市', last.twse], ['上櫃', last.tpex]];
  return (
    <div style={{ marginTop: 'var(--s-6)' }} role="group" aria-label={`成交金額・當日 ${md(last.date)}：上市 ${turnoverText(last.twse)}；上櫃 ${turnoverText(last.tpex)}`} data-testid="turnover-row">
      <div class="caption muted" style={{ marginBottom: 'var(--s-2)' }}>
        <span class="t1 w6">成交金額・當日 {md(last.date)}</span>
        <span>（倍數＝當日 ÷ 前 20 個交易日平均，不含當日）</span>
      </div>
      <div class="grid two">
        {cells.map(([k, t]) => (
          <div key={k}>
            <div class="caption muted">{k}</div>
            <div class="body w6 num" data-testid={`turnover-${k === '上市' ? 'twse' : 'tpex'}`}>{turnoverText(t)}</div>
          </div>
        ))}
      </div>
      <NetBars values={recent.map((t) => t.total.value)} dates={recent.map((t) => t.date)} label="近 20 日成交金額（上市＋上櫃）" height={72} unit="億"
        format={(v) => (v === null || v === undefined ? '—' : `${fmtNum(v, 0)} 億`)} minZero neutral emphasizeRecent={false}
        caption={`上市＋上櫃合計成交金額（億）・近 ${recent.length} 個交易日`} />
    </div>
  );
}

/** 市場寬度（M2，2026-10-03）：漲跌家數、站上 20／60／240 日線比例、創 60 日新高／新低家數。只呈現數字，不做判定。 */
export function breadthRows(b: MarketData['breadth']): { k: string; v: string; s?: string }[] {
  const pct = (v: number | null | undefined, n: number | undefined) => (v === null || v === undefined ? missing(n === 0 ? '資料不足' : '尚未計算') : `${v.toFixed(1)}%（${fmtNum(n ?? 0, 0)} 檔）`);
  const cnt = (v: number | null | undefined) => (v === null || v === undefined ? missing('不足 60 個交易日') : `${fmtNum(v, 0)} 家`);
  return [
    { k: '漲跌家數', v: `上漲 ${fmtNum(b.up, 0)}・下跌 ${fmtNum(b.down, 0)}・平盤 ${fmtNum(b.flat, 0)}`, s: '官方漲跌（相對參考價）' },
    { k: '站上 20 日線', v: pct(b.above_ma20_pct, b.n_ma20), s: '普通股、還原價；括號為可計算的檔數' },
    { k: '站上 60 日線', v: pct(b.above_ma60_pct, b.n_ma60) },
    { k: '站上 240 日線', v: pct(b.above_ma240_pct, b.n_ma240) },
    { k: '創 60 日新高', v: cnt(b.high60), s: '收盤 ≥ 近 60 日最高收盤' },
    { k: '創 60 日新低', v: cnt(b.low60), s: '收盤 ≤ 近 60 日最低收盤' },
  ];
}

export function BreadthList({ breadth }: { breadth: MarketData['breadth'] }) {
  return (
    <div data-testid="breadth-list">
      <KeyValueList label="市場寬度" rows={breadthRows(breadth).map((r) => ({ k: r.k, v: <span class="num">{r.v}</span>, sub: r.s }))} />
    </div>
  );
}

export function AiCard({ ai }: { ai: AiSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="card">
      <button class="collapsed-row" aria-expanded={open} onClick={() => setOpen(!open)} style={{ padding: 0, minHeight: 'auto' }}>
        <span class="body t1">盤後摘要 <span class="tag">AI 生成</span></span>
        <IconChevronDown />
      </button>
      {open ? (
        <>
          <ul style={{ margin: 'var(--s-3) 0 0', paddingLeft: 'var(--s-5)' }}>
            {ai.lines.map((l) => <li key={l} class="caption t1" style={{ marginTop: 'var(--s-1)' }}>{l}</li>)}
          </ul>
          <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>由 AI 依當日衍生數據自動摘要，可能有誤；分數與依據以各頁明細為準。</p>
        </>
      ) : null}
    </div>
  );
}
