/**
 * 策略庫（M2）：指標效度評估判定為「有效」或「環境依賴」的指標包成的內建策略。
 * #/explore/strategies：清單；#/explore/strategies/:id：策略頁（健康度、今日新觸發、多期間與逐年報表、出場規則、樣本範圍）。
 * 策略清單依規則產生，非推薦；不提供下單。
 */
import { useState } from 'preact/hooks';
import { PageHead, TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { useAsync, useDb } from '../hooks';
import { loadJson } from '../data/api';
import { addWatchMany, listStrategies, saveStrategy, uid } from '../db/db';
import { LAB_PREFIX } from '../lib/config';
import { coverageText, pctSigned, tText } from '../lib/evidence';
import { type StrategiesFile, type StrategyItem, enabledFirst, envLine, groupName, healthTone } from '../lib/strategies';
import '../styles/evidence.css';

export const loadStrategies = () => loadJson<StrategiesFile>('strategies.json');

function md(d: string | null | undefined): string {
  if (!d) return '—';
  const [, m, day] = d.split('-');
  return `${Number(m)}/${Number(day)}`;
}

function Tags({ s }: { s: StrategyItem }) {
  return (
    <span class="st-tags">
      <span class={`tag ${s.verdict === '樣本範圍受限' ? 'risk' : ''}`}>{s.verdict}</span>
      {s.enabled && s.health ? <span class={`tag ${healthTone(s.health.status) === 'risk' ? 'risk' : ''}`}>{s.health.status}</span> : null}
    </span>
  );
}

function StrategyList({ data }: { data: StrategiesFile }) {
  const { enabled, disabled } = enabledFirst(data.strategies);
  return (
    <>
      <div class="list ev-list" style={{ marginTop: 'var(--s-4)' }}>
        {enabled.map((s) => (
          <a key={s.id} class="ev-row st-row" href={`#/explore/strategies/${s.id}`}>
            <span class="ev-main">
              <span class="ev-label">{s.label}</span>
              <span class="ev-sub">{s.subtitle}</span>
              <span class="ev-sub">{envLine(s)}・今日新觸發 {s.today?.length ?? 0} 檔</span>
            </span>
            <Tags s={s} />
          </a>
        ))}
      </div>
      {disabled.length ? (
        <>
          <h2 class="section" style={{ marginTop: 'var(--s-8)' }}>未通過驗證（不上架）</h2>
          <div class="list ev-list">
            {disabled.map((s) => (
              <div key={s.id} class="ev-row">
                <span class="ev-main">
                  <span class="ev-label">{s.label}</span>
                  <span class="ev-sub">{s.subtitle}</span>
                  <span class="ev-sub">{s.reasons.join('；')}</span>
                </span>
                <Tags s={s} />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function Actions({ s, date, horizon }: { s: StrategyItem; date: string; horizon: number }) {
  const tracked = useDb(() => listStrategies(), []);
  const [msg, setMsg] = useState('');
  const presetId = LAB_PREFIX + s.id;
  const isTracked = (tracked ?? []).some((t) => t.presetId === presetId && t.active);
  const codes = (s.today ?? []).map((x) => x.code);
  return (
    <div class="st-actions">
      <button class="btn" disabled={!codes.length} onClick={async () => {
        const n = await addWatchMany(codes, groupName(s));
        setMsg(n ? `已加入自選群組「${groupName(s)}」${n} 檔` : '這些股票已經在群組裡');
      }}>今日觸發全部加入自選群組</button>
      <button class="btn" disabled={isTracked} onClick={async () => {
        await saveStrategy({ id: uid(), presetId, name: s.label, conditions: [], horizon, startAfter: date, enabledAt: new Date().toISOString(), active: true });
        setMsg(`已設為訊號追蹤：${md(date)} 之後的新觸發開始記錄（紀律 → 訊號追蹤）`);
      }}>{isTracked ? '已在訊號追蹤' : '設為訊號追蹤'}</button>
      {msg ? <p class="caption" role="status">{msg}</p> : null}
    </div>
  );
}

function Detail({ s, data }: { s: StrategyItem; data: StrategiesFile }) {
  const [showAlt, setShowAlt] = useState(false);
  const p5 = s.portfolio?.['5'];
  const years = Object.keys({ ...(s.years ?? {}), ...(p5?.yearly ?? {}) }).sort();
  return (
    <>
      <PageHead eyebrow={s.subtitle} title={s.label}>
        <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>依規則產生，非推薦・資料至 {data.date}</p>
        <Tags s={s} />
      </PageHead>

      <h2 class="section st-h">健康度</h2>
      <div class="card">
        <p class="body"><b>{s.health?.status ?? '—'}</b></p>
        <p class="caption muted">近 60 個交易日（{md(s.health?.since)} 起、已完成 {data.horizon} 日持有）平均超額 {pctSigned(s.health?.recent)}（{s.health?.recent_n ?? 0} 筆）；長期 {pctSigned(s.health?.long)}。超額＝相對同日全市場、扣成本。</p>
        <p class="caption">{envLine(s)}</p>
      </div>

      <h2 class="section st-h">今日新觸發（{md(data.date)}）</h2>
      <div class="list">
        {s.today?.length ? s.today.map((x) => (
          <a key={x.code} class="list-item" href={`#/stock/${x.code}`}><span class="grow">{x.name} <span class="muted">{x.code}</span></span></a>
        )) : <div class="list-item caption muted">今天沒有新觸發。</div>}
      </div>
      {s.env && !s.env.today ? <p class="caption risk-text">今日大盤環境不符合這個策略的啟用條件。</p> : null}
      {s.enabled ? <Actions s={s} date={data.date} horizon={data.horizon} /> : <p class="caption muted">未通過驗證（{s.reasons.join('；')}），不能設為訊號追蹤。</p>}

      <h2 class="section st-h">多期間表現</h2>
      <table class="ev-table" aria-label="各持有天數的超額報酬">
        <thead><tr><th scope="col">持有</th><th scope="col">超額</th><th scope="col">t</th><th scope="col">樣本</th></tr></thead>
        <tbody>
          {Object.entries(s.h ?? {}).map(([k, v]) => (
            <tr key={k}><th scope="row">{k} 日</th><td>{pctSigned(v.mean_excess)}</td><td>{tText(v.t)}</td><td>{(v.n ?? 0).toLocaleString('zh-TW')}</td></tr>
          ))}
        </tbody>
      </table>
      <p class="caption muted">超額＝相對同日全市場（扣成本），同一檔只計首次觸發。</p>

      <h2 class="section st-h">逐年報酬</h2>
      <table class="ev-table" aria-label="逐年報酬">
        <thead><tr><th scope="col">年份</th><th scope="col">5 檔組合</th><th scope="col">訊號超額</th><th scope="col">筆數</th></tr></thead>
        <tbody>
          {years.map((y) => (
            <tr key={y}><th scope="row">{y}</th><td>{pctSigned(p5?.yearly?.[y])}</td><td>{pctSigned(s.years?.[y])}</td><td>{(s.trades?.yearly?.[y]?.n ?? 0).toLocaleString('zh-TW')}</td></tr>
          ))}
        </tbody>
      </table>
      <p class="caption muted">5 檔組合：同時最多持有 5 檔、每檔 1/5 權益、依下方出場規則，扣成本；最大回撤 {pctSigned(p5?.mdd)}、年化 {pctSigned(p5?.ann_return)}。</p>

      <h2 class="section st-h">出場規則</h2>
      <div class="card">
        <p class="body"><b>{s.exit?.label ?? '—'}</b></p>
        <p class="caption muted">
          依出場規則比較（相對指數最高者）選用・期望值 {pctSigned(s.exit?.stats.ev)}、相對指數 {pctSigned(s.exit?.stats.exc_idx)}、勝率 {s.exit?.stats.win?.toFixed(1) ?? '—'}%、平均持有 {s.exit?.stats.hold?.toFixed(1) ?? '—'} 日、最大不利波動 {pctSigned(s.exit?.stats.mae)}、跌停鎖死 {s.exit?.stats.locked ?? 0} 次
        </p>
        <button class="btn small" aria-expanded={showAlt} onClick={() => setShowAlt(!showAlt)}>{showAlt ? '收起其他出場規則' : '看其他出場規則'}</button>
        {showAlt ? (
          <table class="ev-table" aria-label="出場規則比較">
            <thead><tr><th scope="col">出場</th><th scope="col">相對指數</th><th scope="col">勝率</th><th scope="col">持有日</th></tr></thead>
            <tbody>
              {(s.exit?.alternatives ?? []).map((r) => (
                <tr key={r.label}><th scope="row" class="ev-wrap">{r.label}</th><td>{pctSigned(r.exc_idx)}</td><td>{r.win === null ? '—' : `${r.win.toFixed(1)}%`}</td><td>{r.hold?.toFixed(1) ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <h2 class="section st-h">樣本範圍</h2>
      <table class="ev-table" aria-label="樣本範圍">
        <tbody>
          <tr><th scope="row">判定</th><td>{s.verdict}（t {tText(s.t)}）</td></tr>
          <tr><th scope="row">涵蓋率</th><td>{coverageText(s.coverage)}</td></tr>
          <tr><th scope="row">資料起始</th><td>{s.data_start ?? '—'}</td></tr>
          <tr><th scope="row">訊號期間</th><td>{s.signal_start ?? '—'} 起</td></tr>
          <tr><th scope="row">去重樣本</th><td>{(s.n ?? 0).toLocaleString('zh-TW')} 筆</td></tr>
          {s.param ? <tr><th scope="row">參數</th><td>{s.param}</td></tr> : null}
        </tbody>
      </table>
      {s.note ? <p class="caption risk-text">{s.note}</p> : null}
      <p class="caption muted">{s.definition}</p>
      <div class="st-actions">
        <a class="btn" href={`#/explore/leverage?s=${s.id}`}>槓桿風險計算</a>
        <a class="btn" href="#/explore/evidence">指標效度表</a>
      </div>
    </>
  );
}

export default function Strategies({ id }: { id?: string }) {
  const d = useAsync(loadStrategies, []);
  const s = id ? d.data?.strategies.find((x) => x.id === id) : undefined;
  return (
    <div class="page">
      <TopBar back={id ? '/explore/strategies' : '/explore'} />
      {!id ? (
        <PageHead eyebrow="依指標效度評估包成的策略" title={d.data ? `策略庫：${d.data.strategies.filter((x) => x.enabled).length} 個通過驗證` : '策略庫'}>
          <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>依規則產生，非推薦。只有判定為「有效」或「環境依賴」的指標會上架，每日重算。</p>
        </PageHead>
      ) : null}
      {d.loading ? <Loading /> : null}
      {d.error ? <ErrorState error={d.error} /> : null}
      {d.data && !id ? <StrategyList data={d.data} /> : null}
      {d.data && id ? (s ? <Detail s={s} data={d.data} /> : <p class="caption">找不到這個策略。</p>) : null}
    </div>
  );
}
