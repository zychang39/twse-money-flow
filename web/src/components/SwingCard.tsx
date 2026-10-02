/**
 * 波段策略（2026-10-01；2026-10-02 分級版）：三段績效（固定日曆切段：開發 2017-01～2021-12、驗證 2022-01～2024-10、最終測試 2024-11 起）、
 * 九項上線門檻、進場延後、參數 ±20%、前瞻驗證、事件與 10 檔組合分布。
 * 沿用策略頁的卡片、表格、字級與用語；數字由 pipeline 預先計算（strategies.json 的 swing 區塊），缺的欄位顯示「—」。不使用買賣字眼。
 */
import { pctSigned, tText } from '../lib/evidence';
import type { ForwardBlock, SwingBlock, SwingSegment } from '../lib/strategies';

const SEG_KEYS: ('dev' | 'val' | 'test')[] = ['dev', 'val', 'test'];
const SEG_NAME = { dev: '開發', val: '驗證', test: '最終測試' } as const;

function ym(d: string | undefined): string {
  if (!d) return '—';
  const [y, m] = d.split('-');
  return `${y}-${m}`;
}

/** 區間右端為「不含」的切點（2022-01-01）→ 顯示前一個月（2021-12）。 */
function ymBefore(d: string | undefined): string {
  if (!d) return '—';
  const [y, m] = d.split('-').map(Number);
  const mm = m === 1 ? 12 : m - 1;
  const yy = m === 1 ? y - 1 : y;
  return `${yy}-${String(mm).padStart(2, '0')}`;
}

/** 段的標籤：開發 2017-01～2021-12／驗證 2022-01～2024-10／最終測試 2024-11 起（由 sw.split 推得；沒有切點時退回段本身的期間）。 */
export function segLabel(key: 'dev' | 'val' | 'test', sw: SwingBlock): string {
  const r = sw.split?.[key] ?? sw.segments[key]?.period;
  if (!r) return SEG_NAME[key];
  if (key === 'test') return `${SEG_NAME[key]} ${ym(r[0])} 起`;
  if (r[0] >= r[1]) return `${SEG_NAME[key]}（資料起始晚於這一段）`;
  return `${SEG_NAME[key]} ${ym(r[0])}～${ymBefore(r[1])}`;
}

function winText(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${v.toFixed(1)}%`;
}

function SegRow({ label, s, chosen }: { label: string; s: SwingSegment | undefined; chosen?: boolean }) {
  if (!s || !s.n) return <tr><th scope="row" class="ev-wrap">{label}</th><td colSpan={4} class="ev-empty">{s?.n === 0 ? '這一段沒有樣本' : '尚未計算（最終測試只在部署時跑一次）'}</td></tr>;
  return (
    <tr class={chosen ? 'ev-chosen' : undefined}>
      <th scope="row" class="ev-wrap">{label}</th>
      <td>{pctSigned(s.mean_gross_excess)}</td>
      <td>{pctSigned(s.mean_excess)}</td>
      <td>{tText(s.t_corr ?? s.t)}</td>
      <td>{(s.n ?? 0).toLocaleString('zh-TW')}</td>
    </tr>
  );
}

/** 前瞻驗證：未滿期只顯示累積進度；滿期後顯示扣成本超額與回測對照。 */
export function ForwardCard({ f, hold }: { f: ForwardBlock | undefined; hold: number }) {
  return (
    <>
      <h2 class="section st-h">前瞻驗證（合併後的新訊號，持有 {hold} 日）</h2>
      <div class="card" data-testid="swing-forward">
        {!f ? (
          <p class="caption muted">尚未開始：部署後自合併日起累積新訊號。</p>
        ) : !f.ready ? (
          <p class="caption">資料累積中：合併後第 {f.elapsed_days}／{f.required_days} 個交易日（{f.signals} 個訊號、{f.completed} 筆已出場）</p>
        ) : (
          <p class="caption">前瞻扣成本超額 {pctSigned(f.mean_excess)}（t {tText(f.t)}、{f.completed} 筆已出場）vs 回測 {pctSigned(f.backtest_mean_excess)}；自 {f.since} 起 {f.signals} 個訊號。</p>
        )}
        <p class="caption muted">前瞻驗證只看合併日之後才出現的訊號，與回測不重疊；「有效・待前瞻驗證」在滿期且前瞻超額為正後改為「有效」。</p>
      </div>
    </>
  );
}

export function SwingCard({ sw, hold }: { sw: SwingBlock; hold: number }) {
  const g = sw.gates ?? { checks: {}, labels: {}, passed: false };
  const d = sw.dist ?? {};
  const p = sw.portfolio ?? {};
  const full = sw.full ?? {};
  const other = sw.other;
  const checks = Object.entries(g.checks ?? {});
  const passed = checks.filter(([, ok]) => ok).length;
  const delays = [{ delay: 0, n: full.n, mean_excess: full.mean_excess, t: full.t_corr ?? full.t }, ...(sw.delays ?? [])];
  const be = p.bench_ew ?? {};
  const b50 = p.bench_0050;
  const conc = full.concentration;
  return (
    <>
      <h2 class="section st-h">三段績效（持有 {hold} 日，相對同日等權）</h2>
      <table class="ev-table" aria-label="開發、驗證、最終測試三段的超額報酬">
        <thead><tr><th scope="col">段</th><th scope="col">毛超額</th><th scope="col">扣成本超額</th><th scope="col">校正後 t</th><th scope="col">樣本</th></tr></thead>
        <tbody>
          {SEG_KEYS.map((k) => <SegRow key={k} label={segLabel(k, sw)} s={sw.segments?.[k]} />)}
          <SegRow label={`全樣本（${hold} 日）`} s={full} chosen />
          {other ? <SegRow label={`全樣本（${other.hold} 日）`} s={other} /> : null}
        </tbody>
      </table>
      <p class="caption muted">
        固定日曆切段：開發段用來嘗試（最多 10 次），驗證段確認，最終測試段只跑一次；判定以 {hold} 日為主，{other?.hold ?? (hold === 40 ? 20 : 40)} 日並列（10 日只供參考、不判定）。
        校正後 t＝{full.t_corr_method === 'min' ? 'min(Newey-West, 不重疊區塊)' : full.t_corr_method === 'calendar' ? '日曆時間法' : full.t_corr_method ?? 'min(Newey-West, 不重疊區塊)'}
        {conc ? `；進場日 ${conc.dates ?? '—'} 個、最集中 5% 的日子承載 ${conc.top5pct_share === null || conc.top5pct_share === undefined ? '—' : `${Math.round(conc.top5pct_share * 100)}%`} 的樣本` : ''}；每月觸發 {full.per_month ?? '—'} 檔、勝率 {winText(full.win)}。
      </p>
      {sw.test_note ? <p class="caption muted">{sw.test_note}</p> : null}

      <h2 class="section st-h">上線門檻（{passed}／{checks.length} 項通過）</h2>
      <div class="card" data-testid="swing-gates">
        {checks.length ? (
          <ul class="st-basis">
            {checks.map(([k, ok]) => (
              <li key={k} class={`caption${ok ? '' : ' risk-text'}`}>{ok ? '通過' : '未通過'}・{g.labels?.[k] ?? k}</li>
            ))}
          </ul>
        ) : <p class="caption muted">尚未計算（最終測試段只在部署時跑一次）。</p>}
        <p class="caption muted">{g.passed ? '九項門檻全部通過。' : '任一門檻未通過就不列為有效，只列在報告。'}</p>
      </div>

      <h2 class="section st-h">進場延後</h2>
      <table class="ev-table" aria-label="進場延後 0、1、3 個交易日的超額報酬" data-testid="swing-delays">
        <thead><tr><th scope="col">延後</th><th scope="col">扣成本超額</th><th scope="col">t</th><th scope="col">樣本</th></tr></thead>
        <tbody>
          {delays.map((x) => (
            <tr key={x.delay} class={x.delay === 0 ? 'ev-chosen' : undefined}><th scope="row">{x.delay} 日</th><td>{pctSigned(x.mean_excess)}</td><td>{tText(x.t)}</td><td>{(x.n ?? 0).toLocaleString('zh-TW')}</td></tr>
          ))}
        </tbody>
      </table>
      <p class="caption muted">訊號後延後 1、3 個交易日才進場仍保留原本超額的一半以上，才算不是靠搶在第一天進場。</p>

      {sw.perturb?.length ? (
        <>
          <h2 class="section st-h">參數 ±20%（開發＋驗證段）</h2>
          <table class="ev-table" aria-label="參數擾動">
            <thead><tr><th scope="col">參數</th><th scope="col">值</th><th scope="col">扣成本超額</th><th scope="col">樣本</th></tr></thead>
            <tbody>
              {sw.perturb.map((x) => (
                <tr key={`${x.param}-${x.mult}`}><th scope="row">{x.param} ×{x.mult.toFixed(1)}</th><td>{x.value === undefined ? '—' : Number(x.value).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}</td><td>{x.note ? '—' : pctSigned(x.mean_excess)}</td><td>{(x.n ?? 0).toLocaleString('zh-TW')}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <ForwardCard f={sw.forward} hold={hold} />

      <h2 class="section st-h">分布</h2>
      <div class="card">
        <p class="caption">事件：勝率 {winText(d.win)}、平均獲利 {pctSigned(d.avg_win)}／虧損 {pctSigned(d.avg_loss)}、賺賠比 {d.payoff ?? '—'}；連續虧損最長 {d.loss_streak?.max ?? '—'} 筆（中位數 {d.loss_streak?.p50 ?? '—'}、最差 10% {d.loss_streak?.p90 ?? '—'}）；最大不利波動中位數 {pctSigned(d.mae_p50)}、最差 10% {pctSigned(d.mae_p90)}。</p>
        <p class="caption" data-testid="swing-portfolio">
          {[
            `${p.slots ?? 10} 檔組合（含共用規則：大盤 240 日線下不開新倉、20 日乖離 > 20% 不進場）：年化 ${pctSigned(p.ann_return, 1)} vs 等權基準 ${pctSigned(be.ann_return, 1)}`,
            b50 ? ` vs 0050 含息 ${pctSigned(b50.ann_return, 1)}` : '',
            `、Sharpe ${p.sharpe ?? '—'}、最大回撤 ${pctSigned(p.mdd, 1)}（基準 ${pctSigned(be.mdd, 1)}，比值 ${p.mdd_ratio_ew ?? '—'}）、回撤期間 ${p.dd_days ?? '—'} 日、`,
            `實際成交 ${p.executed ?? '—'} 筆（槽位滿跳過 ${p.skipped_full ?? '—'}、共用規則擋下 ${p.skipped_rule ?? '—'}）、週轉率每槽 ${p.turnover ?? '—'} 次／年（每年 ${p.trades_per_year ?? '—'} 筆）。`,
          ].join('')}
        </p>
      </div>
    </>
  );
}
