/**
 * 波段策略（2026-10-01；2026-10-02 分級版）：三段績效（固定日曆切段：開發 2017-01～2021-12、驗證 2022-01～2024-10、最終測試 2024-11 起）、
 * 九項上線門檻、進場延後、參數 ±20%、前瞻驗證、事件與組合分布。
 * 2026-10-02 健檢：門檻只列「未達」的項目；段名一行、日期第二行小字；參數用中文標籤並附原始參數；
 * 分布與組合摘要改成指標格；缺值一律附原因。數字由 pipeline 預先計算（strategies.json 的 swing 區塊）。不使用買賣字眼。
 */
import { useState } from 'preact/hooks';
import { fmtCount, missing, orMissing, pctPlain, pctSigned, ratioPct, ratioText, tText } from '../lib/format';
import { PARAM_LABEL, type ForwardBlock, type SwingBlock, type SwingSegment } from '../lib/strategies';
import { MetricGrid } from './Metrics';

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

/** 段的標籤：{ name, dates }（段名一行、日期第二行小字）。 */
export function segLabel(key: 'dev' | 'val' | 'test', sw: SwingBlock): { name: string; dates: string } {
  const r = sw.split?.[key] ?? sw.segments[key]?.period;
  if (!r) return { name: SEG_NAME[key], dates: '' };
  if (key === 'test') return { name: SEG_NAME[key], dates: `${ym(r[0])} 起` };
  if (r[0] >= r[1]) return { name: SEG_NAME[key], dates: '資料起始晚於這一段' };
  return { name: SEG_NAME[key], dates: `${ym(r[0])}～${ymBefore(r[1])}` };
}

function SegRow({ label, s, chosen }: { label: { name: string; dates: string }; s: SwingSegment | undefined; chosen?: boolean }) {
  const head = <th scope="row" class="ev-wrap"><span class="seg-name">{label.name}</span>{label.dates ? <span class="th-unit">{label.dates}</span> : null}</th>;
  if (!s || !s.n) return <tr>{head}<td colSpan={4} class="ev-empty">{s?.n === 0 ? '這一段沒有樣本' : '尚未計算（最終測試只在部署時跑一次）'}</td></tr>;
  return (
    <tr class={chosen ? 'ev-chosen' : undefined}>
      {head}
      <td>{pctSigned(s.mean_gross_excess)}</td>
      <td>{pctSigned(s.mean_excess)}</td>
      <td>{tText(s.t_corr ?? s.t)}</td>
      <td>{fmtCount(s.n ?? 0)}</td>
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

const T_METHOD: Record<string, string> = { min: '日曆、Newey-West、不重疊區塊三者取最小', calendar: '日曆時間法（進場日集中）' };

export function SwingCard({ sw, hold }: { sw: SwingBlock; hold: number }) {
  const g = sw.gates ?? { checks: {}, labels: {}, passed: false };
  const d = sw.dist ?? {};
  const p = sw.portfolio ?? {};
  const full = sw.full ?? {};
  const other = sw.other;
  const checks = Object.entries(g.checks ?? {});
  const passed = checks.filter(([, ok]) => ok).length;
  const unmet = checks.filter(([, ok]) => !ok);
  const [showAll, setShowAll] = useState(false);
  const delays = [{ delay: 0, n: full.n, mean_excess: full.mean_excess, t: full.t_corr ?? full.t }, ...(sw.delays ?? [])];
  const be = p.bench_ew ?? {};
  const b50 = p.bench_0050;
  const conc = full.concentration;
  const slots = p.slots ?? 10;
  return (
    <>
      <h2 class="section st-h">三段績效（持有 {hold} 日，相對同日等權）</h2>
      <table class="ev-table ev-static ev-seg" aria-label="開發、驗證、最終測試三段的超額報酬">
        <thead><tr><th scope="col">段</th><th scope="col">毛超額</th><th scope="col">扣成本<br />超額</th><th scope="col">校正後 t</th><th scope="col">樣本</th></tr></thead>
        <tbody>
          {SEG_KEYS.map((k) => <SegRow key={k} label={segLabel(k, sw)} s={sw.segments?.[k]} />)}
          <SegRow label={{ name: '全樣本', dates: `${hold} 日` }} s={full} chosen />
          {other ? <SegRow label={{ name: '全樣本', dates: `${other.hold} 日` }} s={other} /> : null}
        </tbody>
      </table>
      <p class="caption muted">
        固定日曆切段：開發段用來嘗試（最多 10 次），驗證段確認，最終測試段只跑一次；判定以 {hold} 日為主，{other?.hold ?? (hold === 40 ? 20 : 40)} 日並列（10 日只供參考、不判定）。
        校正後 t＝{T_METHOD[full.t_corr_method ?? ''] ?? full.t_corr_method ?? T_METHOD.min}
        {conc ? `；進場日 ${orMissing(conc.dates, (v) => `${fmtCount(v)} 個`, '沒有進場日統計')}、最集中 5% 的日子承載 ${ratioPct(conc.top5pct_share)} 的樣本` : ''}；每月觸發 {orMissing(full.per_month, (v) => `${v} 檔`, '沒有觸發統計')}、絕對勝率 {pctPlain(full.win)}。
      </p>
      {sw.test_note ? <p class="caption muted">{sw.test_note}</p> : null}
      {sw.audit?.val_t_low ? (
        <p class="caption risk-text" data-testid="swing-audit-val">驗證段校正後 t {tText(sw.audit.val_t)}（低於觀察中門檻 {sw.audit.val_t_min}）：驗證段本身不夠顯著，全樣本的 t 主要來自開發段與最終測試段。</p>
      ) : null}
      {sw.audit?.param_peak?.length ? (
        <p class="caption risk-text" data-testid="swing-audit-peak">
          參數位於鄰近最高點：{sw.audit.param_peak.map((x) => `${x.label}${x.chosen !== null && x.chosen !== undefined ? ` ${x.chosen}${x.param === 'hold' ? ' 日' : ''}` : ''}（${x.neighbors.map((n) => `${n.value ?? '—'}${x.param === 'hold' ? ' 日' : ''} ${pctSigned(n.mean_excess)}`).join('、')}）`).join('；')}——兩側 ±20% 的超額都低於選定值，結果對參數位置敏感。
        </p>
      ) : null}

      <h2 class="section st-h">上線門檻（{passed}／{checks.length} 項通過）</h2>
      <div class="card" data-testid="swing-gates">
        {!checks.length ? <p class="caption muted">尚未計算（最終測試段只在部署時跑一次）。</p> : unmet.length ? (
          <>
            <p class="caption risk-text"><b>未達 {unmet.length} 項</b></p>
            <ul class="st-basis">
              {unmet.map(([k]) => <li key={k} class="caption risk-text">{g.labels?.[k] ?? k}</li>)}
            </ul>
          </>
        ) : <p class="caption">九項門檻全部通過。</p>}
        {checks.length ? (
          <>
            <button type="button" class="btn small" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? '收起全部門檻' : `看全部 ${checks.length} 項門檻`}</button>
            {showAll ? (
              <ul class="st-basis" data-testid="swing-gates-all">
                {checks.map(([k, ok]) => <li key={k} class={`caption${ok ? '' : ' risk-text'}`}>{ok ? '通過' : '未達'}・{g.labels?.[k] ?? k}</li>)}
              </ul>
            ) : null}
          </>
        ) : null}
        <p class="caption muted">任一門檻未達就不列為有效（可列觀察中）；門檻定義在 config/evidence.yml swing_gates。</p>
      </div>

      <h2 class="section st-h">進場延後</h2>
      <table class="ev-table ev-static" aria-label="進場延後 0、1、3 個交易日的超額報酬" data-testid="swing-delays">
        <thead><tr><th scope="col">延後</th><th scope="col">扣成本超額</th><th scope="col">t</th><th scope="col">樣本</th></tr></thead>
        <tbody>
          {delays.map((x) => (
            <tr key={x.delay} class={x.delay === 0 ? 'ev-chosen' : undefined}><th scope="row">{x.delay} 日</th><td>{pctSigned(x.mean_excess)}</td><td>{tText(x.t)}</td><td>{fmtCount(x.n ?? 0)}</td></tr>
          ))}
        </tbody>
      </table>
      <p class="caption muted">訊號後延後 1、3 個交易日才進場仍保留原本超額的一半以上，才算不是靠搶在第一天進場。</p>

      {sw.perturb?.length ? (
        <>
          <h2 class="section st-h">參數 ±20%（開發＋驗證段）</h2>
          <table class="ev-table ev-static" aria-label="參數擾動">
            <thead><tr><th scope="col">參數</th><th scope="col">值</th><th scope="col">扣成本超額</th><th scope="col">樣本</th></tr></thead>
            <tbody>
              {sw.perturb.map((x) => (
                <tr key={`${x.param}-${x.mult}`}>
                  <th scope="row" class="ev-wrap"><span class="seg-name">{PARAM_LABEL[x.param] ?? x.param} ×{x.mult.toFixed(1)}</span><span class="th-unit">{x.param}</span></th>
                  <td>{x.value === undefined ? '—' : Number(x.value).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}</td>
                  <td>{x.note ? <span class="caption muted">—（{x.note}）</span> : pctSigned(x.mean_excess)}</td>
                  <td>{fmtCount(x.n ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="caption muted">參數：{Object.entries(sw.params).map(([k, v]) => `${PARAM_LABEL[k] ?? k} ${v}`).join('、')}、持有 {hold} 日（原始參數 {Object.entries(sw.params).map(([k, v]) => `${k}=${v}`).join('、')}、hold={hold}）。</p>
        </>
      ) : null}

      <ForwardCard f={sw.forward} hold={hold} />

      <h2 class="section st-h">分布（事件層級）</h2>
      <div class="card">
        <MetricGrid label="事件分布" items={[
          { k: '絕對勝率', v: pctPlain(d.win), sub: '扣成本報酬 > 0 的比例' },
          { k: '賺賠比', v: d.payoff === null || d.payoff === undefined ? missing('沒有虧損或獲利樣本') : ratioText(d.payoff), sub: `平均獲利 ${pctSigned(d.avg_win)}／虧損 ${pctSigned(d.avg_loss)}` },
          { k: '連續虧損最長', v: d.loss_streak ? `${d.loss_streak.max} 筆` : '—', sub: d.loss_streak ? `中位數 ${d.loss_streak.p50}、最差 10% ${d.loss_streak.p90}` : undefined },
          { k: '最大不利波動中位數', v: pctSigned(d.mae_p50), sub: `最差 10% ${pctSigned(d.mae_p90)}` },
        ]} />
      </div>

      <h2 class="section st-h">{slots} 檔組合（含共用規則）</h2>
      <div class="card" data-testid="swing-portfolio">
        <MetricGrid label={`${slots} 檔組合`} items={[
          { k: '年化報酬', v: pctSigned(p.ann_return), sub: `等權基準 ${pctSigned(be.ann_return)}${b50 ? `・0050 含息 ${pctSigned(b50.ann_return)}` : ''}` },
          { k: '最大回撤', v: pctSigned(p.mdd), sub: `等權基準 ${pctSigned(be.mdd)}・比值 ${ratioText(p.mdd_ratio_ew)}`, risk: p.mdd_ratio_ew !== null && p.mdd_ratio_ew !== undefined && p.mdd_ratio_ew > 1.2 },
          { k: 'Sharpe', v: ratioText(p.sharpe), sub: '無風險利率 0' },
          { k: '回撤期間', v: p.dd_days === undefined ? '—' : `${fmtCount(p.dd_days)} 日`, sub: '最長的回撤持續交易日數' },
          { k: '實際成交', v: p.executed === undefined ? '—' : `${fmtCount(p.executed)} 筆`, sub: `槽位滿跳過 ${p.skipped_full ?? '—'}・共用規則擋下 ${p.skipped_rule ?? '—'}` },
          { k: '週轉率', v: p.turnover === undefined ? '—' : `每槽 ${p.turnover} 次／年`, sub: p.trades_per_year === undefined ? undefined : `每年 ${p.trades_per_year} 筆` },
        ]} />
        <p class="caption muted">共用規則：大盤 240 日線下不開新倉、20 日乖離 &gt; 20% 不進場；槽位滿了就跳過、不排隊。</p>
      </div>
    </>
  );
}
