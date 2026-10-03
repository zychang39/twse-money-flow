import { useState } from 'preact/hooks';
import { fmtCount, fmtNum, missing, orMissing, pctPlain, pctSigned } from '../lib/format';
import type { Stats } from '../lib/backtest';
import { uiConfig } from '../lib/config';
import { Card, Section } from './ui';
import '../styles/evidence.css';

/** 回測可信度：依樣本數（門檻見 config/ui.yml）。 */
export function confidence(n: number | undefined): { label: string; level: 'low' | 'mid' | 'high' } {
  const c = uiConfig.backtest_confidence;
  const k = n ?? 0;
  return k < c.low_below ? { label: '可信度低', level: 'low' } : k >= c.high_from ? { label: '可信度高', level: 'high' } : { label: '可信度中', level: 'mid' };
}

export interface BacktestResult {
  horizons: Record<string, Record<string, Stats | string | undefined>>;
  excluded: Record<string, number>;
  decay: (number | null)[];
  trades: { code: string; signal: string; entry_date: string; exit_date: string; entry: number; exit: number; net: number; mae: number; excess: number | null; delisted: boolean }[];
  names?: Record<string, string>;
  detail_horizon: number;
  period?: { start: string | null; end: string | null };
  signals?: number;
  universe?: number;
  /** 訊號定義：new＝今日新觸發（預設）；all＝每天符合 */
  signal_definition?: 'new' | 'all';
  signals_level?: number;
  first_signal?: string | null;
  last_signal?: string | null;
  coverage?: Coverage;
  /** 對照：每天符合都算訊號 */
  level?: Record<string, { all: Stats; non_overlap: Stats }>;
  exit_rules?: {
    stop?: { pct: number; horizons: Record<string, { all: Stats; non_overlap: Stats }> };
    trailing?: { ma: number; horizons: Record<string, { all: Stats; non_overlap: Stats }> };
  };
}

export interface Coverage {
  /** 條件資料的共同起始日（最晚的欄位起始日）；之前不產生訊號 */
  start: string | null;
  price_start?: string | null;
  universe: number;
  fields: { field: string; label?: string; stocks: number; first_date: string | null }[];
  limited: boolean;
  stocks_in_sample: number;
  by_code: [string, number][];
}

/** ISO → 「YYYY/M/D」；沒有日期時「—（原因）」，不輸出「— 起」「— ～ —」這類半句。 */
const ymd = (iso: string | null | undefined, reason = '沒有日期') => (iso ? `${iso.slice(0, 4)}/${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : missing(reason));
/** 「a ～ b」；兩端都沒有時「—（沒有樣本）」。 */
const range = (a: string | null | undefined, b: string | null | undefined) => (!a && !b ? missing('沒有樣本') : `${ymd(a, '沒有起始日')} ～ ${ymd(b, '沒有結束日')}`);
/** 回測統計的百分比：缺值一律「—（沒有樣本）」。 */
const sp = (v: number | null | undefined, reason = '沒有樣本') => orMissing(v, pctSigned, reason);
/** 絕對勝率（報酬 > 0 的比例）；缺值「—（沒有樣本）」。 */
const winText = (v: number | null | undefined) => orMissing(v, pctPlain, '沒有樣本');

/** S1：資料涵蓋與樣本範圍。欄位只涵蓋少數股票時（例如千張大戶歷史只回補關注清單）以琥珀色標示「樣本範圍受限」。 */
export function CoverageNote({ r }: { r: BacktestResult }) {
  const c = r.coverage;
  if (!c) return null;
  const narrow = c.fields.filter((f) => f.stocks < c.universe * 0.5);
  const top = c.by_code.slice(0, 8);
  return (
    <div class="card" data-testid="bt-coverage">
      {c.limited ? (
        <div class="banner risk" role="note" data-testid="bt-limited" style={{ display: 'block' }}>
          <b>樣本範圍受限</b>：{narrow.map((f) => `「${f.label ?? f.field}」只有 ${fmtCount(f.stocks)} 檔有資料（${f.first_date ? `自 ${ymd(f.first_date)} 起` : missing('沒有起始日')}）`).join('；')}，
          全市場同期有價格的股票 {fmtCount(c.universe)} 檔；實際產生訊號的只有 {fmtCount(c.stocks_in_sample)} 檔。
          只有部分股票有資料時（例如只回補關注清單），這些股票通常是事後挑選的，結果可能高估，不能推論到全市場。
        </div>
      ) : null}
      <dl class="bt-cov">
        <div><dt>訊號期間</dt><dd>{range(r.first_signal, r.last_signal)}</dd></div>
        <div><dt>條件資料起始日</dt><dd>{ymd(c.start, '條件欄位沒有資料')}（此日之前不產生訊號；{c.price_start ? `價格資料自 ${ymd(c.price_start)} 起` : `價格資料起始日：${missing('沒有價格資料')}`}）</dd></div>
        <div><dt>納入股票</dt><dd>{fmtCount(c.stocks_in_sample)} 檔（全市場 {fmtCount(c.universe)} 檔）</dd></div>
      </dl>
      <table class="table small" style={{ marginTop: 'var(--s-2)' }}>
        <thead><tr><th>條件欄位</th><th>有資料的股票</th><th>起始日</th></tr></thead>
        <tbody>{c.fields.map((f) => <tr key={f.field}><td>{f.label ?? f.field}</td><td>{fmtCount(f.stocks)}</td><td>{ymd(f.first_date, '沒有資料')}</td></tr>)}</tbody>
      </table>
      {top.length ? (
        <details style={{ marginTop: 'var(--s-2)' }}>
          <summary class="caption bt-summary">訊號來自哪些股票：{top.map(([code, n]) => `${r.names?.[code] ?? code} ${fmtCount(n)}`).join('・')}{c.by_code.length > top.length ? '…' : ''}</summary>
          <p class="caption muted">{c.by_code.map(([code, n]) => `${code} ${r.names?.[code] ?? ''} ${fmtCount(n)} 筆`).join('、')}</p>
        </details>
      ) : null}
    </div>
  );
}

/** 訊號定義與重疊處理的說明（S2）。 */
export function SignalDefinition({ r }: { r: BacktestResult }) {
  if (!r.signal_definition) return null;
  return (
    <Card testid="bt-definition">
      <p class="ui-foot ui-muted">
        訊號＝今日新觸發：T 日收盤後全部條件成立、上一個交易日不成立（與選股頁「今日新觸發」相同；資料第一天不算）；T+1 開盤進場。
        同一檔在持有期間內再次觸發時，「全部訊號」照算、「不重疊」略過。
        {r.signals_level !== undefined ? `每天符合都算共 ${fmtCount(r.signals_level)} 筆（新觸發 ${fmtCount(r.signals ?? 0)} 筆），統計列在出場規則比較。` : ''}
      </p>
    </Card>
  );
}

/** S5：同一批訊號的出場規則並列（只看時間／停損／跌破均線），加上「每天符合」的對照。 */
export function ExitCompare({ r, h }: { r: BacktestResult; h: string }) {
  if (!r.exit_rules && !r.level) return null;
  const rows: [string, Stats | undefined][] = [
    ['新觸發・只看時間', r.horizons[h]?.all as Stats | undefined],
    ...(r.exit_rules?.stop ? [[`新觸發・停損 ${pctSigned(r.exit_rules.stop.pct)}`, r.exit_rules.stop.horizons[h]?.all] as [string, Stats | undefined]] : []),
    ...(r.exit_rules?.trailing ? [[`新觸發・跌破 ${r.exit_rules.trailing.ma} 日線`, r.exit_rules.trailing.horizons[h]?.all] as [string, Stats | undefined]] : []),
    ...(r.level ? [['每天符合・只看時間（對照）', r.level[h]?.all] as [string, Stats | undefined]] : []),
  ];
  // 手機寬度不需要左右滑動：每個規則一列，統計數字換行排列
  return (
    <div data-testid="bt-exit-compare">
      <div class="list">
        {rows.map(([label, s]) => (
          <div key={label} class="list-item" style={{ display: 'block' }}>
            <div class="body">{label}</div>
            <div class="caption bt-stats">
              <span>樣本 {fmtCount(s?.n ?? 0)}</span>
              <span>絕對勝率 {winText(s?.win_rate)}</span>
              <span>平均 <b class={s?.avg && s.avg > 0 ? 'up' : s?.avg && s.avg < 0 ? 'down' : ''}>{sp(s?.avg)}</b></span>
              <span>中位數 {sp(s?.median)}</span>
              <span>平均MAE {sp(s?.avg_mae)}</span>
              <span>超額 {sp(s?.avg_excess, s?.n ? '沒有指數資料' : '沒有樣本')}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const VIEWS: [string, string][] = [
  ['all', '全部訊號'], ['non_overlap', '不重疊'], ['in_sample', '樣本內（前 2/3）'], ['out_of_sample', '樣本外（後 1/3）'],
  ['regime_up', '大盤在年線上'], ['regime_down', '大盤在年線下'],
];

function DecayChart({ decay }: { decay: (number | null)[] }) {
  const pts = decay.map((v, i) => ({ x: i + 1, y: v === null ? null : v * 100 })).filter((p) => p.y !== null) as { x: number; y: number }[];
  if (pts.length < 2) return <p class="small muted">資料不足：至少要 2 個交易日有平均報酬才能畫曲線。</p>;
  const W = 320, H = 140, pad = 24;
  const ys = pts.map((p) => p.y);
  const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys);
  const sx = (x: number) => pad + ((x - 1) / (decay.length - 1)) * (W - pad * 2);
  const sy = (y: number) => H - pad - ((y - lo) / (hi - lo || 1)) * (H - pad * 2);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`訊號衰減曲線：第 1 日 ${pctSigned(pts[0].y)}，第 ${pts[pts.length - 1].x} 日 ${pctSigned(pts[pts.length - 1].y)}`}>
      <line x1={pad} x2={W - pad} y1={sy(0)} y2={sy(0)} class="chart-base" />
      <path d={d} fill="none" stroke="var(--text-1)" stroke-width="1.6" />
      <text x={pad} y={H - 6} font-size="11" fill="var(--text-2)">第 1 日</text>
      <text x={W - pad - 30} y={H - 6} font-size="11" fill="var(--text-2)">第 {decay.length} 日</text>
      <text x={2} y={sy(hi) + 4} font-size="11" fill="var(--text-2)">{pctSigned(hi)}</text>
      <text x={2} y={sy(lo)} font-size="11" fill="var(--text-2)">{pctSigned(lo)}</text>
    </svg>
  );
}

export function BacktestReport({ r }: { r: BacktestResult }) {
  const [view, setView] = useState('all');
  const hs = Object.keys(r.horizons).sort((a, b) => Number(a) - Number(b));
  const ex = r.excluded;
  const oosCut = r.horizons[hs[0]]?.oos_cut;
  return (
    <>
      <SignalDefinition r={r} />
      <CoverageNote r={r} />
      <div class="card">
        <div class="caption muted">
          {r.coverage ? `訊號期間 ${range(r.first_signal, r.last_signal)}` : `期間 ${range(r.period?.start, r.period?.end)}`}{r.signals !== undefined ? ` · 訊號 ${fmtCount(r.signals)} 筆` : ''}{r.universe ? ` · 範圍：成交值前 ${fmtCount(r.universe)} 檔` : ''}
        </div>
        {(() => {
          const s = r.horizons[String(r.detail_horizon)]?.all as Stats | undefined;
          const c = confidence(s?.n);
          return (
            <p class="body" style={{ marginTop: 'var(--s-2)' }}>
              持有 {r.detail_horizon} 日：樣本 <b>{fmtCount(s?.n ?? 0)}</b> 筆・<span class={c.level === 'low' ? 'risk w6' : 'w6'}>{c.label}</span>
              {s?.win_rate !== undefined ? `・絕對勝率 ${pctPlain(s.win_rate)}` : ''}
            </p>
          );
        })()}
        <div class="chips" role="group" aria-label="統計範圍" style={{ marginTop: 'var(--s-2)' }}>
          {VIEWS.map(([id, label]) => <button key={id} class="chip" aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}
        </div>
        {/* M3：不左右滑動——指標為列、持有天數為欄（最多 4 欄） */}
        <table class="ev-table bt-main" style={{ marginTop: 'var(--s-2)' }} aria-label="各持有天數的回測統計">
          <thead><tr><th scope="col">項目</th>{hs.map((h) => <th key={h} scope="col">{h} 日</th>)}</tr></thead>
          <tbody>
            {([
              ['樣本', (s: Stats | undefined) => fmtCount(s?.n ?? 0)],
              ['可信度', (s: Stats | undefined) => (s?.low_reference && confidence(s?.n).level !== 'low' ? '參考性低' : confidence(s?.n).label.replace('可信度', ''))],
              ['絕對勝率', (s: Stats | undefined) => winText(s?.win_rate)],
              ['平均', (s: Stats | undefined) => sp(s?.avg)],
              ['中位數', (s: Stats | undefined) => sp(s?.median)],
              ['平均 MAE', (s: Stats | undefined) => sp(s?.avg_mae)],
              ['最差 MAE', (s: Stats | undefined) => sp(s?.worst_mae)],
              ['超額', (s: Stats | undefined) => sp(s?.avg_excess, s?.n ? '沒有指數資料' : '沒有樣本')],
            ] as [string, (s: Stats | undefined) => string][]).map(([label, f]) => (
              <tr key={label}><th scope="row">{label}</th>{hs.map((h) => <td key={h}>{f(r.horizons[h][view] as Stats | undefined)}</td>)}</tr>
            ))}
          </tbody>
        </table>
        {view === 'in_sample' || view === 'out_of_sample' ? <p class="tiny muted">樣本內／外分界：{typeof oosCut === 'string' && oosCut ? ymd(oosCut) : missing('沒有樣本')}（依訊號日期的期間前 2/3、後 1/3）。</p> : null}
        <p class="caption muted">報酬已扣手續費、證交稅與滑價（買賣各 0.1%）；出場日跌停鎖死順延到下一個可成交日；超額報酬相對加權報酬指數；MAE 為持有期間最大不利波動；絕對勝率＝報酬 &gt; 0 的比例。可信度依樣本數：&lt; {uiConfig.backtest_confidence.low_below} 筆為低、≥ {uiConfig.backtest_confidence.high_from} 筆為高。</p>
      </div>
      <Section title="出場規則比較" info={<p>持有 {r.detail_horizon} 日。停損：盤中觸及即以停損價出場（跳空低開以開盤價）；跌破均線：收盤跌破，隔日開盤出場；三種都以持有 {r.detail_horizon} 日為上限。絕對勝率＝報酬 &gt; 0 的比例。</p>}>
        <Card><ExitCompare r={r} h={String(r.detail_horizon)} /></Card>
      </Section>
      <Section title="訊號衰減曲線" info={<p>進場後第 1–{r.decay.length} 個交易日收盤的平均報酬（扣成本）。</p>}>
        <Card><DecayChart decay={r.decay} /></Card>
      </Section>
      <Section title="排除的樣本">
        <Card><p class="ui-foot">開盤即漲停 {fmtCount(ex.limit_up ?? 0)} 筆・停牌 {fmtCount(ex.suspended ?? 0)} 筆・處置期間 {fmtCount(ex.disposition ?? 0)} 筆・尚無後續資料 {fmtCount(ex.no_future ?? 0)} 筆・出場日跌停鎖死順延 {fmtCount(ex.locked_exit ?? 0)} 筆</p></Card>
      </Section>
      <Section title="逐筆明細" aside={`持有 ${r.detail_horizon} 日・最近 ${fmtCount(r.trades.length)} 筆`} info={<p>限制：回補起點以前已下市的股票不在資料內；歷史資料以公開資料重建，可能與實際成交有差異；過去績效不代表未來。</p>}>
      {/* M3：5 欄以內（訊號日與 MAE 寫在股票名稱下方），不左右滑動 */}
      <div class="card flush">
        <table class="ev-table bt-trades" aria-label="逐筆明細">
          <thead><tr><th scope="col">股票</th><th scope="col">進場</th><th scope="col">出場</th><th scope="col">報酬</th><th scope="col">超額</th></tr></thead>
          <tbody>
            {r.trades.slice(0, 200).map((t) => (
              <tr key={`${t.code}-${t.signal}`}>
                <th scope="row" class="ev-wrap">
                  <a class="bt-name" href={`#/stock/${t.code}`}>{r.names?.[t.code] ?? t.code}</a>{t.delisted ? <span class="badge">下市</span> : null}
                  <span class="bt-sub">{t.signal.slice(5).replace('-', '/')}・MAE {pctSigned(t.mae)}</span>
                </th>
                <td>{fmtNum(t.entry)}</td><td>{fmtNum(t.exit)}</td>
                <td class={t.net > 0 ? 'up' : t.net < 0 ? 'down' : ''}>{pctSigned(t.net)}</td><td>{orMissing(t.excess, pctSigned, '沒有指數資料')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </Section>
    </>
  );
}
