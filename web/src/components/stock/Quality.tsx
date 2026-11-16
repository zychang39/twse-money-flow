/**
 * 生意體質（2026-11；DECISIONS #470）：個股頁的三個入口，全部是新增區塊，既有區塊不動。
 * - QualitySection：基本面分段最上面。一句結論＋一條「ROIC 對門檻」的橫條＋三列（賺不賺錢／能賺多久／賺的錢去哪），點進詳情頁。
 * - BizVsMarket：總覽分段。市場怎麼看（動能、籌碼分）與生意本身（ROIC 百分位）兩條橫條，只描述位置。
 * - QualityDetail：詳情頁 #/stock/{code}/q。ROIC 走勢與門檻在同一個軸（同單位）；營收另外一張圖（不用雙軸）；下方附年度表格。
 * 數字與文字都來自 lib/quality.ts（純函式、已測試）。顏色：ROIC 高低用白與灰（紅綠只代表漲跌），琥珀只留給風險旗標。
 */
import type { JSX } from 'preact';
import type { StockHistory, StockRow } from '../../data/types';
import { fmtNum } from '../../lib/format';
import {
  earnSentence, gapSentence, historyGap, HURDLE, incrSentence, kindName, kindOf, kindRule, lastSentence, marketVsBiz, MIN_YEARS,
  qualityOf, qualitySeries, seriesSummary, type Quality,
} from '../../lib/quality';
import { qualityConfig } from '../../lib/config';
import { Conclusion, Interp, LevelAxis, ProgressBar, Term } from '../kit';
import { Card, EmptyRow, List, Num, Row, Section, Table, Tag } from '../ui';
import { MONO, SeriesChart } from '../SeriesChart';
import { NetBars } from '../Viz';
import type { StockSeg } from './Overview';
import '../../styles/quality.css';

type N = number | null | undefined;
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pct = (v: N, d = 1) => <Num v={ok(v) ? v : null} digits={d} unit="%" />;

/** ⓘ：計算方式（公式、門檻、限制都放這裡，畫面上只留結論） */
function QualityInfo() {
  const c = qualityConfig;
  return (
    <>
      <p>ROIC（簡式）＝近四季稅後營業利益 ÷ 投入資本。稅後營業利益＝營業利益 ×（1 − 有效稅率）；投入資本＝資產總計 − 流動負債，取期初與期末的平均。</p>
      <p>資金成本門檻 {c.hurdle_pct}% 全站相同；ROIC 在門檻上下 {c.near_band} 個百分點以內算「接近門檻」。</p>
      <p>簡式沒有扣掉帳上多餘的現金（現金多的公司會偏低），短期借款也沒有算進投入資本。金融業的報表沒有營業利益與流動負債，不計算。</p>
      <p>類型依規則分類，每季財報公布後重算，不是推薦：{(['steady', 'cyclical', 'fading'] as const).map((k) => `「${c.labels[k].name}」＝${c.labels[k].rule}`).join('；')}。年度資料滿 {c.history.min_years} 年才分類。</p>
      <p>資料來源：公開資訊觀測站季財報彙總表。</p>
    </>
  );
}

/** ROIC 對門檻的橫條：軌道 0～刻度上限，刻線＝門檻，圓點＝ROIC；下方標出 0、門檻、上限（同一個尺度）。 */
export function HurdleBar({ q }: { q: Quality }) {
  if (!ok(q.roic)) return null;
  const hurdle = q.hurdle ?? HURDLE;
  const lo = Math.min(0, Math.floor(q.roic / 10) * 10);
  const hi = Math.max(hurdle * 3, Math.ceil(q.roic / 10) * 10);
  const pos = (v: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100;
  const at = (v: number): JSX.CSSProperties => ({ left: `${pos(v)}%` });
  return (
    <div class="qv-bar" role="img" data-testid="quality-bar"
      aria-label={`ROIC ${fmtNum(q.roic, 1)}%，門檻 ${fmtNum(hurdle, 0)}%（刻度 ${lo}%～${hi}%）`}>
      <span class="qv-track">
        <i class="qv-fill" style={{ left: `${pos(Math.min(0, q.roic))}%`, width: `${Math.abs(pos(q.roic) - pos(0))}%` }} />
        <i class="qv-tick" style={at(hurdle)} />
        <i class="qv-dot" style={at(q.roic)} />
      </span>
      <span class="qv-scale ui-foot ui-muted" aria-hidden="true">
        <span>{lo}%</span>
        <span class="qv-scale-h" style={at(hurdle)}>門檻 {fmtNum(hurdle, 0)}%</span>
        <span>{hi}%</span>
      </span>
    </div>
  );
}

/** 配發率一句話（M5）：沒有資料時說明原因 */
export function payoutText(q: Quality): string {
  const rows = (q.payout ?? []).filter((r) => ok(r[2]));
  if (!rows.length) return '資料源待處理：股利分派尚未接入';
  const avg = rows.reduce((a, r) => a + (r[2] as number), 0) / rows.length;
  return `近 ${rows.length} 年平均把 ${fmtNum(avg, 0)}% 的獲利配給股東`;
}

/** 基本面分段最上面的區塊（新增；營收、季財報、估值區塊不動） */
export function QualitySection({ h }: { h: StockHistory }) {
  const q = qualityOf(h);
  const href = `#/stock/${h.code}/q`;
  if (q.status === 'none') {
    return (
      <Section title="生意體質" testid="sec-quality" info={<QualityInfo />}>
        <List><EmptyRow testid="quality-empty">資料累積中：這檔還沒有可以計算 ROIC 的季財報（營業利益與資產負債欄位補抓中，或不是一般公司）</EmptyRow></List>
      </Section>
    );
  }
  if (q.status === 'fin') {
    return (
      <Section title="生意體質" testid="sec-quality" info={<QualityInfo />}>
        <Conclusion testid="quality-concl">金融業不算 ROIC，改看 ROE</Conclusion>
        <Interp>銀行、保險、證券的報表沒有營業利益與流動負債；ROE 在下方的季財報。</Interp>
      </Section>
    );
  }
  const kind = kindOf(q);
  return (
    <Section title="生意體質" aside={q.period} testid="sec-quality" info={<QualityInfo />}>
      <Conclusion testid="quality-concl">{earnSentence(q)}</Conclusion>
      <div class="qv-kind">
        <Tag testid="quality-kind">{kindName(kind)}</Tag>
        <span class="ui-foot ui-muted">依規則分類，非推薦</span>
      </div>
      <Card><HurdleBar q={q} /></Card>
      <List chev testid="quality-rows">
        <Row label="賺不賺錢" sub={<>ROIC {fmtNum(q.roic, 1)}%・ROE {ok(q.roe) ? `${fmtNum(q.roe, 1)}%` : '未公布'}</>} href={`${href}?at=earn`} testid="quality-earn" />
        <Row label="能賺多久" sub={lastSentence(q)} subWide href={`${href}?at=last`} testid="quality-last" />
        <Row label="賺的錢去哪" sub={payoutText(q)} subWide href={`${href}?at=pay`} testid="quality-pay" />
      </List>
    </Section>
  );
}

/** 總覽分段：市場怎麼看 vs 生意本身（只有可以計算 ROIC 的公司才出現） */
export function BizVsMarket({ h, row, onSeg }: { h: StockHistory; row?: StockRow; onSeg: (s: StockSeg) => void }) {
  const q = qualityOf(h);
  const score = (id: 'momentum' | 'chip'): N => (row?.[id] as N) ?? h.scores?.categories[id]?.score ?? null;
  const mv = marketVsBiz(score('momentum'), score('chip'), q);
  if (!mv) return null;
  return (
    <Section title="生意與市場" testid="biz-market" info={
      <>
        <p>市場怎麼看＝動能分與籌碼分的平均（0–100）。生意本身＝這檔的 ROIC（簡式）在全市場可計算公司中的百分位（0–100）。</p>
        <p>前段＝前三分之一、後段＝後三分之一。兩條只描述目前的位置，不代表之後的走向。</p>
      </>
    }>
      <Conclusion testid="biz-market-concl">{mv.text}</Conclusion>
      <div class="qv-meters">
        <span class="ui-foot ui-muted">市場怎麼看</span>
        <ProgressBar value={mv.market} label={`市場怎麼看 ${mv.market ?? '無資料'}（0–100）`} />
        <span class="qv-num">{mv.market ?? '—'}</span>
        <span class="ui-foot ui-muted">生意本身</span>
        <ProgressBar value={mv.biz} label={`生意本身：ROIC 全市場百分位 ${mv.biz}`} />
        <span class="qv-num">{mv.biz}</span>
      </div>
      <button type="button" class="score-link ui-foot qv-link" onClick={() => onSeg('f')} data-testid="to-quality">{kindName(kindOf(q))}・查看生意體質</button>
    </Section>
  );
}

/** 詳情頁內容：三個問題依序往下排（不用第二層分段控制） */
export function QualityDetail({ h }: { h: StockHistory }) {
  const q = qualityOf(h);
  if (q.status !== 'ok') {
    return <List><EmptyRow>{q.status === 'fin' ? '金融業不算 ROIC，改看 ROE（基本面分段的季財報）' : '資料累積中：這檔還沒有可以計算 ROIC 的季財報'}</EmptyRow></List>;
  }
  const s = qualitySeries(q);
  const kind = kindOf(q);
  const hurdle = q.hurdle ?? HURDLE;
  const gap = gapSentence(q);
  const years = s.labels.map((label, i) => ({ label, roic: s.roic[i], revenue: s.revenue[i], margin: s.margin[i] })).reverse();
  return (
    <>
      <Section title="賺不賺錢" id="q-earn" aside={q.period} testid="q-earn" info={<QualityInfo />}>
        <Conclusion testid="q-earn-concl">{earnSentence(q)}</Conclusion>
        <Card>
          <LevelAxis format={(v) => `${fmtNum(v, 1)}%`} label={`同一個尺度上的門檻 ${hurdle}%、ROIC ${fmtNum(q.roic, 1)}%${ok(q.roe) ? `、ROE ${fmtNum(q.roe, 1)}%` : ''}`}
            levels={[{ name: '門檻', v: hurdle, color: 'var(--d-3)' }, { name: 'ROIC', v: q.roic, color: 'var(--d-1)', main: true }, { name: 'ROE', v: q.roe, color: 'var(--d-2)' }]} />
        </Card>
        <List>
          <Row label={<Term id="roic">ROIC（簡式）</Term>} sub={`門檻 ${fmtNum(hurdle, 0)}%，差 ${ok(q.spread) ? `${q.spread > 0 ? '+' : ''}${fmtNum(q.spread, 1)}` : '—'} 個百分點`} value={pct(q.roic)} />
          <Row label={<Term id="nopat_margin">稅後營業利益率</Term>} sub="每 100 元營收留下多少" value={pct(q.nopat_margin)} />
          <Row label={<Term id="capital_turnover">資本周轉</Term>} sub="每 1 元投入資本做多少營收" value={<Num v={q.turnover} digits={2} unit="次" />} />
          <Row label={<Term id="roe_roic_gap">ROE 與 ROIC 的差距</Term>} sub={gap ?? 'ROE 未公布'} subWide
            value={ok(q.gap) ? <Num v={`${q.gap > 0 ? '+' : ''}${fmtNum(q.gap, 1)}`} unit="百分點" /> : '—'} />
          <Row label="現金跟得上獲利嗎" sub="資料源待處理：現金流量表尚未接入" subWide value="—" />
        </List>
      </Section>

      <Section title="能賺多久" id="q-last" testid="q-last" info={
        <>
          <p>年度 ROIC（每年第 4 季＝全年），最多看近 {qualityConfig.history.max_years} 年；最新一季不是第 4 季時，最後一點是近四季。</p>
          <p>中位數＝景氣回到平常時大約的水準。新增投入的報酬＝（現在 − 3 年前的稅後營業利益）÷（現在 − 3 年前的投入資本）；投入資本增加不到 5% 時不計算。</p>
          <p>營收另外畫一張圖：兩者單位不同，不放在同一個軸上。</p>
        </>
      }>
        <Conclusion testid="q-last-concl">{lastSentence(q)}</Conclusion>
        {s.labels.length >= 2 ? (
          <>
            <SeriesChart dates={s.labels} axisKey="roic" height={180} zero label={`年度 ROIC 與門檻。${seriesSummary(q)}`} testid="roic-chart"
              format={(v) => `${fmtNum(v, 1)}%`} tickFormat={(v) => `${fmtNum(v, 0)}%`}
              series={[
                { id: 'roic', name: 'ROIC', color: MONO.main, values: s.roic, main: true },
                { id: 'hurdle', name: '門檻', color: MONO.other, values: s.hurdle, dash: 'dash', thin: true },
              ]} />
            <Card>
              <NetBars values={s.revenue} dates={s.labels} unit="億元" height={72} neutral minZero emphasizeRecent={false}
                format={(v) => (v === null || v === undefined ? '—' : `${fmtNum(v, 0)} 億`)}
                caption="年度營收（億元）" label="年度營收柱狀圖" />
            </Card>
          </>
        ) : <List><EmptyRow>{historyGap(q) ?? '年度資料不足，還畫不出走勢'}</EmptyRow></List>}
        <List>
          <Row label={<Term id="mid_cycle_roic">中位數</Term>} sub={ok(q.median) ? `近 ${q.n_years} 年；最低 ${fmtNum(q.min, 1)}%、最高 ${fmtNum(q.max, 1)}%` : (historyGap(q) ?? `滿 ${MIN_YEARS} 年才計算`)} subWide value={pct(q.median)} />
          <Row label={<Term id="incr_roic">新增投入的報酬</Term>} sub={incrSentence(q)} subWide value={pct(q.incr_roic)} />
          <Row label={<Term id="biz_type">生意類型</Term>} sub={kindRule(kind) ?? historyGap(q) ?? ''} subWide value={<Tag>{kindName(kind)}</Tag>} testid="q-kind" />
        </List>
        {years.length ? (
          <div class="ui-card">
            <Table caption="年度 ROIC、營收、營業利益率" testid="q-years" rowKey={(r) => r.label} rows={years} cols={[
              { key: 'y', label: '年度', render: (r) => r.label },
              { key: 'r', label: '營收(億)', align: 'r', render: (r) => (ok(r.revenue) ? fmtNum(r.revenue, r.revenue >= 100 ? 0 : 1) : '—') },
              { key: 'm', label: '營益率', align: 'r', render: (r) => pct(r.margin) },
              { key: 'c', label: 'ROIC', align: 'r', render: (r) => pct(r.roic) },
            ]} />
          </div>
        ) : null}
      </Section>

      <Section title="賺的錢去哪" id="q-pay" testid="q-pay" info={
        <p>盈餘配發率＝每股現金股利 ÷ 每股盈餘。董監持股設質、庫藏股、現金流量表還沒有接入，接上之前如實標示「資料源待處理」。</p>
      }>
        <Conclusion testid="q-pay-concl">{payoutText(q)}</Conclusion>
        {(q.payout ?? []).length ? (
          <div class="ui-card">
            <Table caption="現金股利與盈餘配發率" testid="q-payout" rowKey={(r) => String(r[0])} rows={(q.payout ?? []).slice().reverse()} cols={[
              { key: 'y', label: '股利年度', render: (r) => String(r[0]) },
              { key: 'd', label: '每股現金股利', align: 'r', render: (r) => <Num v={r[1]} digits={2} unit="元" /> },
              { key: 'p', label: '配發率', align: 'r', render: (r) => pct(r[2], 0) },
            ]} />
          </div>
        ) : null}
        <List>
          <Row label="董監持股設質" sub="資料源待處理" value="—" />
          <Row label="買回庫藏股" sub="資料源待處理" value="—" />
        </List>
      </Section>
    </>
  );
}
