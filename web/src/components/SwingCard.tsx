/**
 * 波段策略（2026-10-01）：三段績效（開發／驗證／最終測試）、上線門檻、參數 ±20%、事件與組合分布。
 * 沿用策略頁的卡片、表格、字級與用語；數字由 pipeline 預先計算（strategies.json 的 swing 區塊）。不使用買賣字眼。
 */
import { pctSigned, tText } from '../lib/evidence';
import type { SwingBlock, SwingSegment } from '../lib/strategies';

const SEG: { key: 'dev' | 'val' | 'test'; label: string }[] = [
  { key: 'dev', label: '開發 60%' },
  { key: 'val', label: '驗證 20%' },
  { key: 'test', label: '最終測試 20%' },
];

function md(d: string | undefined): string {
  if (!d) return '—';
  const [y, m] = d.split('-');
  return `${y}/${Number(m)}`;
}

function SegRow({ label, s }: { label: string; s: SwingSegment | undefined }) {
  if (!s) return <tr><th scope="row">{label}</th><td colSpan={4} class="ev-empty">尚未計算（最終測試只在部署時跑一次）</td></tr>;
  return (
    <tr>
      <th scope="row">{label}<span class="th-unit">{md(s.period?.[0])}～{md(s.period?.[1])}</span></th>
      <td>{pctSigned(s.mean_excess)}</td>
      <td>{tText(s.t_corr ?? s.t)}</td>
      <td>{(s.n ?? 0).toLocaleString('zh-TW')}</td>
      <td>{s.per_month ?? '—'}</td>
    </tr>
  );
}

export function SwingCard({ sw, hold }: { sw: SwingBlock; hold: number }) {
  const g = sw.gates;
  const d = sw.dist ?? {};
  const p = sw.portfolio ?? {};
  const passed = Object.values(g.checks).filter(Boolean).length;
  const total = Object.keys(g.checks).length;
  return (
    <>
      <h2 class="section st-h">三段績效（持有 {hold} 日，相對同日等權、扣成本）</h2>
      <table class="ev-table" aria-label="開發、驗證、最終測試三段的超額報酬">
        <thead><tr><th scope="col">段</th><th scope="col">超額</th><th scope="col">校正後 t</th><th scope="col">樣本</th><th scope="col">每月</th></tr></thead>
        <tbody>
          {SEG.map((s) => <SegRow key={s.key} label={s.label} s={sw.segments[s.key]} />)}
          <tr class="ev-chosen"><th scope="row">全樣本</th><td>{pctSigned(sw.full?.mean_excess)}</td><td>{tText(sw.full?.t_corr)}</td><td>{(sw.full?.n ?? 0).toLocaleString('zh-TW')}</td><td>{sw.full?.per_month ?? '—'}</td></tr>
        </tbody>
      </table>
      <p class="caption muted">資料依訊號期間的日曆時間切三段；開發段用來嘗試（最多 10 次），最終測試段只跑一次。校正後 t＝min(Newey-West, 不重疊區塊)。</p>

      <h2 class="section st-h">上線門檻（{passed}／{total} 項通過）</h2>
      <div class="card" data-testid="swing-gates">
        <ul class="st-basis">
          {Object.entries(g.checks).map(([k, ok]) => (
            <li key={k} class={`caption${ok ? '' : ' risk-text'}`}>{ok ? '通過' : '未通過'}・{g.labels[k]}</li>
          ))}
        </ul>
        <p class="caption muted">{g.passed ? '全部門檻通過，列為有效。' : '任一門檻未通過就不上架，只列在報告。'}{g.best_existing?.id ? `現有最佳＝${g.best_existing.id}。` : ''}</p>
      </div>

      {sw.perturb?.length ? (
        <>
          <h2 class="section st-h">參數 ±20%（開發＋驗證段）</h2>
          <table class="ev-table" aria-label="參數擾動">
            <thead><tr><th scope="col">參數</th><th scope="col">值</th><th scope="col">超額</th><th scope="col">樣本</th></tr></thead>
            <tbody>
              {sw.perturb.map((x) => (
                <tr key={`${x.param}-${x.mult}`}><th scope="row">{x.param} ×{x.mult.toFixed(1)}</th><td>{x.value === undefined ? '—' : Number(x.value).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}</td><td>{pctSigned(x.mean_excess)}</td><td>{(x.n ?? 0).toLocaleString('zh-TW')}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h2 class="section st-h">分布</h2>
      <div class="card">
        <p class="caption">事件：勝率 {d.win?.toFixed(1) ?? '—'}%、平均獲利 {pctSigned(d.avg_win)}／虧損 {pctSigned(d.avg_loss)}、賺賠比 {d.payoff ?? '—'}；連續虧損最長 {d.loss_streak?.max ?? '—'} 筆（中位數 {d.loss_streak?.p50 ?? '—'}、最差 10% {d.loss_streak?.p90 ?? '—'}）；最大不利波動中位數 {pctSigned(d.mae_p50)}、最差 10% {pctSigned(d.mae_p90)}。</p>
        <p class="caption">5 檔組合：年化 {pctSigned(p.ann_return, 1)}、Sharpe {p.sharpe ?? '—'}、最大回撤 {pctSigned(p.mdd, 1)}（回撤天數 {p.dd_days ?? '—'}）；回撤分布 {p.dd_dist?.episodes ?? 0} 次，中位數 {pctSigned(p.dd_dist?.p50, 1)}、最深 10% {pctSigned(p.dd_dist?.p90, 1)}；週轉率每年每槽 {p.turnover ?? '—'} 次（每年 {p.trades_per_year ?? '—'} 筆）。</p>
      </div>
    </>
  );
}
