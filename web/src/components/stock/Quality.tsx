/**
 * 生意體質（2026-11；DECISIONS #470）：個股頁的三個入口，全部是新增區塊，既有區塊不動。
 * - QualitySection：基本面分段最上面。一句結論＋一條「ROIC 對門檻」的橫條＋三列（賺不賺錢／能賺多久／賺的錢去哪），點進詳情頁。
 * - BizVsMarket：總覽分段。市場熱度（動能、籌碼分）與 ROIC 排名兩條橫條，只描述位置。
 * - QualityDetail：詳情頁 #/stock/{code}/q。ROIC 與門檻在同一個軸（同單位、含 0）；營收是另一張同樣寬度的圖（不用雙軸）；下方附年度表格。
 * 數字與文字都來自 lib/quality.ts（純函式、已測試）。顏色：ROIC 高低用白與灰（紅綠只代表漲跌），琥珀只留給風險旗標。
 * 2026-11-16 資料視覺化與設計審查後：橫條固定 0～40% 的尺度（換股時位置可以比較）、同一個數字不重複出現、還沒有資料的項目收成一行。
 */
import type { JSX } from 'preact';
import type { StockHistory, StockRow } from '../../data/types';
import { fmtNum, glueNumbers, MINUS } from '../../lib/format';
import {
  cashSentence, earnSentence, gapSentence, historyGap, HURDLE, incrSentence, kindName, kindOf, kindRule, lastSentence, marketVsBiz, MIN_YEARS,
  qualityOf, qualitySeries, seriesSummary, TTM_LABEL, type Quality,
} from '../../lib/quality';
import { qualityConfig } from '../../lib/config';
import { Conclusion, Interp, ProgressBar, Term } from '../kit';
import { Card, EmptyRow, List, Num, Row, Section, Signed, Table, Tag } from '../ui';
import { MONO, SeriesChart } from '../SeriesChart';
import type { StockSeg } from './Overview';
import '../../styles/quality.css';

type N = number | null | undefined;
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pct = (v: N, d = 1) => <Num v={ok(v) ? v : null} digits={d} unit="%" />;
/** 橫條的固定尺度上限（%）：每一檔都用同一把尺，左右滑動換股時圓點的位置可以直接比較 */
const SCALE_MAX = 40;
/** 還沒有接入（或這一檔還沒有）的資料：收成一行說明（原則 5：說明原因，不留白；也不讓一排「—」佔版面） */
export function pendingText(q: Quality): string {
  const items = [q.has_cash ? null : '現金流量', q.insiders ? null : '董監持股設質', '買回庫藏股'].filter(Boolean);
  return `尚未接入：${items.join('、')}（資料源待處理）`;
}

/** ⓘ：計算方式（公式、門檻、限制都放這裡，畫面上只留結論） */
function QualityInfo() {
  const c = qualityConfig;
  return (
    <>
      <p>ROIC（簡式）＝近四季稅後營業利益 ÷ 投入資本。稅後營業利益＝營業利益 ×（1 − 有效稅率）；投入資本＝資產總計 − 流動負債，取期初與期末的平均。</p>
      <p>資金成本門檻 {c.hurdle_pct}% 全站相同；ROIC 在門檻上下 {c.near_band} 個百分點以內算「接近門檻」。</p>
      <p>簡式沒有扣掉帳上多餘的現金（現金多的公司會偏低），短期借款也沒有算進投入資本。金融業的報表沒有營業利益與流動負債，不計算。</p>
      <p>類型依規則分類，每季財報公布後重算，不是推薦：{(['steady', 'cyclical', 'fading'] as const).map((k) => `「${c.labels[k].name}」＝${c.labels[k].rule}`).join('；')}。年度資料滿 {c.history.min_years} 年才分類。</p>
      <p>營業現金流 ÷ 淨利＝近四季營業活動的淨現金流 ÷ 歸屬母公司淨利：長期明顯低於 100%，代表帳上的獲利還沒有收到現金。</p>
      <p>資料來源：公開資訊觀測站季財報彙總表（損益、資產負債、現金流量）。</p>
    </>
  );
}

/** ROIC 對門檻的橫條：軌道 0～40%（虧損時往左延伸），刻線＝門檻，圓點＝ROIC；下方標出 0、門檻、上限（同一個尺度）。 */
export function HurdleBar({ q }: { q: Quality }) {
  if (!ok(q.roic)) return null;
  const hurdle = q.hurdle ?? HURDLE;
  const lo = q.roic < 0 ? Math.max(-SCALE_MAX, Math.floor(q.roic / 10) * 10) : 0;
  const pos = (v: number) => Math.max(0, Math.min(1, (v - lo) / (SCALE_MAX - lo))) * 100;
  const at = (v: number): JSX.CSSProperties => ({ left: `${pos(v)}%` });
  const over = q.roic > SCALE_MAX;
  return (
    <div class="qv-bar" role="img" data-testid="quality-bar"
      aria-label={`ROIC ${fmtNum(q.roic, 1)}%，門檻 ${fmtNum(hurdle, 0)}%（刻度 ${lo}%～${SCALE_MAX}%${over ? '，超出刻度' : ''}）`}>
      <span class="qv-track">
        <i class="qv-fill" style={{ left: `${pos(Math.min(0, q.roic))}%`, width: `${Math.abs(pos(q.roic) - pos(0))}%` }} />
        <i class="qv-tick" style={at(hurdle)} />
        <i class="qv-dot" style={at(q.roic)} />
      </span>
      <span class="qv-scale ui-foot ui-muted" aria-hidden="true">
        <span>{lo < 0 ? `${MINUS}${Math.abs(lo)}` : lo}%</span>
        <span class="qv-scale-h" style={at(hurdle)}>門檻 {fmtNum(hurdle, 0)}%</span>
        <span>{SCALE_MAX}%{over ? '+' : ''}</span>
      </span>
    </div>
  );
}

/** 配發率一句話；沒有資料回傳 null（由呼叫端決定怎麼說明） */
export function payoutText(q: Quality): string | null {
  const all = q.payout ?? [];
  if (!all.length) return null;
  const rows = all.filter((r) => ok(r[2]));
  if (!all.some((r) => ok(r[1]) && r[1] > 0)) return `近 ${all.length} 年沒有配發現金股利`;
  if (!rows.length) return '有配息，但前一年度虧損，算不出配發率';
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
      <Section title="生意體質" aside={q.period} testid="sec-quality" info={<QualityInfo />}>
        <Conclusion testid="quality-concl">{earnSentence(q)}</Conclusion>
        <Interp>銀行、保險、證券的報表沒有營業利益與流動負債，不算 ROIC。</Interp>
      </Section>
    );
  }
  const pay = payoutText(q);
  return (
    <Section title="生意體質" aside={q.period} testid="sec-quality" info={<QualityInfo />}>
      <Conclusion testid="quality-concl">{glueNumbers(earnSentence(q))}</Conclusion>
      {/* 只有分得出類型時才放標籤；「高於／接近／低於門檻」結論句已經說了，不重複 */}
      {q.type ? (
        <div class="qv-kind">
          <Tag testid="quality-kind">{kindName(q.type)}</Tag>
          <span class="ui-foot ui-muted">依規則分類，非推薦</span>
        </div>
      ) : null}
      <Card><HurdleBar q={q} /></Card>
      <List chev testid="quality-rows">
        <Row label="賺不賺錢" sub={<>ROIC {fmtNum(q.roic, 1)}%・ROE {ok(q.roe) ? `${fmtNum(q.roe, 1)}%` : '未公布'}</>} href={`${href}?at=earn`} testid="quality-earn" />
        <Row label="能賺多久" sub={glueNumbers(lastSentence(q))} subWide href={`${href}?at=last`} testid="quality-last" />
        <Row label="賺的錢去哪" sub={glueNumbers(pay ?? '配息資料累積中')} subWide href={pay ? `${href}?at=pay` : undefined} testid="quality-pay" />
      </List>
    </Section>
  );
}

/** 一條 0–100 的橫條，在 34 與 67 畫細刻線（前段／中段／後段的分界） */
function TierBar({ value, label }: { value: number | null; label: string }) {
  return (
    <span class="qv-tier">
      <ProgressBar value={value} label={label} />
      <i class="qv-cut" style={{ left: '34%' }} aria-hidden="true" />
      <i class="qv-cut" style={{ left: '67%' }} aria-hidden="true" />
    </span>
  );
}

/** 總覽分段：市場熱度 vs ROIC 排名（只有可以計算 ROIC 的公司才出現） */
export function BizVsMarket({ h, row, onSeg }: { h: StockHistory; row?: StockRow; onSeg: (s: StockSeg) => void }) {
  const q = qualityOf(h);
  const score = (id: 'momentum' | 'chip'): N => (row?.[id] as N) ?? h.scores?.categories[id]?.score ?? null;
  const mv = marketVsBiz(score('momentum'), score('chip'), q);
  if (!mv) return null;
  return (
    <Section title="生意與市場" testid="biz-market" info={
      <>
        <p>市場熱度＝動能分與籌碼分的平均（0–100 分）。ROIC 排名＝這檔的 ROIC（簡式）在全市場可計算公司中的百分位（0–100，越高越前面）；和上面的基本面分數是不同的量。</p>
        <p>橫條上的兩條細線是 34 與 67：以上是前段、中間是中段、以下是後段。兩條只描述目前的位置，不代表之後的走向。</p>
      </>
    }>
      <Conclusion testid="biz-market-concl">{mv.text}</Conclusion>
      <div class="qv-meters">
        <span class="ui-foot ui-muted">市場熱度</span>
        <TierBar value={mv.market} label={`市場熱度 ${mv.market ?? '無資料'} 分（0–100；34 與 67 是分界）`} />
        <span class="qv-num">{mv.market ?? '—'}<span class="ui-unit">分</span></span>
        <span class="ui-foot ui-muted">ROIC 排名</span>
        <TierBar value={mv.biz} label={`ROIC 排名：全市場第 ${mv.biz} 百分位（34 與 67 是分界）`} />
        <span class="qv-num">{mv.biz}<span class="ui-unit">百分位</span></span>
      </div>
      <button type="button" class="score-link ui-foot qv-link" onClick={() => onSeg('f')} data-testid="to-quality">{kindName(kindOf(q))}・查看生意體質</button>
    </Section>
  );
}

/** 詳情頁內容：三個問題依序往下排（不用第二層分段控制） */
export function QualityDetail({ h }: { h: StockHistory }) {
  const q = qualityOf(h);
  if (q.status !== 'ok') {
    return <List><EmptyRow>{q.status === 'fin' ? `${earnSentence(q)}。銀行、保險、證券的報表沒有營業利益與流動負債，不算 ROIC` : '資料累積中：這檔還沒有可以計算 ROIC 的季財報'}</EmptyRow></List>;
  }
  const s = qualitySeries(q);
  const kind = kindOf(q);
  const years = s.labels.map((label, i) => ({ label: label === TTM_LABEL ? `${TTM_LABEL}（${q.period}）` : label, roic: s.roic[i], revenue: s.revenue[i], margin: s.margin[i] })).reverse();
  const pay = payoutText(q);
  const cash = cashSentence(q);
  const ins = q.insiders ?? null;
  const spread = ok(q.spread) ? `${q.spread > 0 ? '+' : q.spread < 0 ? MINUS : ''}${fmtNum(Math.abs(q.spread), 1)}` : '—';
  return (
    <>
      <Section title="賺不賺錢" id="q-earn" aside={q.period} testid="q-earn" info={<QualityInfo />}>
        <Conclusion testid="q-earn-concl">{glueNumbers(earnSentence(q))}</Conclusion>
        <Card><HurdleBar q={q} /></Card>
        <List>
          <Row label={<Term id="roic">ROIC（簡式）</Term>} sub={`和門檻差 ${spread} 個百分點`} value={pct(q.roic)} />
          <Row label={<Term id="nopat_margin">稅後營業利益率</Term>} sub="每 100 元營收留下多少" value={pct(q.nopat_margin)} />
          <Row label={<Term id="capital_turnover">資本周轉</Term>} sub="每 1 元投入資本做多少營收" value={<Num v={q.turnover} digits={2} unit="次" />} />
          <Row label={<Term id="roe_roic_gap">ROE 與 ROIC 的差距</Term>} sub={gapSentence(q) ?? 'ROE 未公布'} subWide
            value={ok(q.gap) ? <Signed v={q.gap} digits={1} unit="百分點" tone="plain" /> : '—'} />
          {cash ? <Row label={<Term id="cash_conversion">營業現金流 ÷ 淨利</Term>} sub={cash} subWide value={pct(q.cash_conv, 0)} testid="q-cash" /> : null}
        </List>
      </Section>

      <Section title="能賺多久" id="q-last" testid="q-last" info={
        <>
          <p>年度 ROIC（每年第 4 季＝全年），最多看近 {qualityConfig.history.max_years} 年；最新一季不是第 4 季時，最後一點是近四季。</p>
          <p>中位數＝景氣回到平常時大約的水準。新增投入的報酬＝（現在 − 3 年前的稅後營業利益）÷（現在 − 3 年前的投入資本）；投入資本增加不到 5% 時不計算。</p>
          <p>營收另外畫一張圖：兩者單位不同，不放在同一個軸上；兩張圖的年份上下對齊。</p>
        </>
      }>
        <Conclusion testid="q-last-concl">{glueNumbers(lastSentence(q))}</Conclusion>
        {s.labels.length >= 2 ? (
          <>
            <SeriesChart dates={s.labels} axisKey="roic" height={180} zero label={`年度 ROIC 與門檻。${seriesSummary(q)}`} testid="roic-chart"
              format={(v) => `${fmtNum(v, 1)}%`} tickFormat={(v) => `${fmtNum(v, 0)}%`}
              series={[
                { id: 'roic', name: 'ROIC', color: MONO.main, values: s.roic, main: true },
                { id: 'hurdle', name: '門檻', color: MONO.bench, values: s.hurdle, dash: 'dash', thin: true, noLegend: true },
              ]} />
            <SeriesChart dates={s.labels} axisKey="rev" height={120} zero label="年度營收（億元）；年份與上方的 ROIC 圖對齊" testid="revenue-chart"
              format={(v) => `${fmtNum(v, 0)} 億`} tickFormat={(v) => fmtNum(v, 0)}
              series={[{ id: 'rev', name: '營收', color: MONO.bench, values: s.revenue }]} />
          </>
        ) : <List><EmptyRow>{historyGap(q) ?? '年度資料不足，還畫不出走勢'}</EmptyRow></List>}
        <List>
          <Row label={<Term id="mid_cycle_roic">中位數</Term>} sub={ok(q.median) ? `近 ${q.n_years} 年` : (historyGap(q) ?? `滿 ${MIN_YEARS} 年才計算`)} subWide value={pct(q.median)} />
          <Row label={<Term id="incr_roic">新增投入的報酬</Term>} sub={incrSentence(q)} subWide value={pct(q.incr_roic)} />
          <Row label={<Term id="biz_type">生意類型</Term>} sub={kindRule(kind) ?? historyGap(q) ?? ''} subWide value={<Tag>{kindName(kind)}</Tag>} testid="q-kind" />
        </List>
        {years.length ? (
          <div class="ui-card">
            <Table caption="各年度與近四季的營收、營業利益率、ROIC" testid="q-years" rowKey={(r) => r.label} rows={years} cols={[
              { key: 'y', label: '期間', render: (r) => r.label },
              { key: 'r', label: '營收(億)', align: 'r', width: '5rem', render: (r) => (ok(r.revenue) ? fmtNum(r.revenue, r.revenue >= 100 ? 0 : 1) : '—') },
              { key: 'm', label: '營益率', align: 'r', width: '4.5rem', render: (r) => pct(r.margin) },
              { key: 'c', label: 'ROIC', align: 'r', width: '4.5rem', render: (r) => pct(r.roic) },
            ]} />
          </div>
        ) : null}
      </Section>

      <Section title="賺的錢去哪" id="q-pay" testid="q-pay" info={
        <>
          <p>盈餘配發率＝當年除息的每股現金股利合計 ÷ 前一年度每股盈餘；今年還沒過完，不列。前一年度虧損時不計算。</p>
          <p>董監持股設質＝董事與監察人設質的股數 ÷ 他們的持股合計（每月公布；經理人與大股東不計）。設質比例高，代表大股東把持股拿去借錢，股價下跌時可能被迫處分。</p>
          <p>買回庫藏股還沒有接入，如實標示「資料源待處理」。</p>
        </>
      }>
        {pay ? <Conclusion testid="q-pay-concl">{glueNumbers(pay)}</Conclusion> : <List><EmptyRow testid="q-pay-empty">配息資料累積中：還沒有完整年度的配息與財報</EmptyRow></List>}
        {(q.payout ?? []).length ? (
          <div class="ui-card">
            <Table caption="現金股利與盈餘配發率" testid="q-payout" rowKey={(r) => String(r[0])} rows={(q.payout ?? []).slice().reverse()} cols={[
              { key: 'y', label: '發放年度', render: (r) => String(r[0]) },
              { key: 'd', label: '每股現金股利', align: 'r', render: (r) => <Num v={r[1]} digits={2} unit="元" /> },
              { key: 'p', label: '配發率', align: 'r', width: '5rem', render: (r) => pct(r[2], 0) },
            ]} />
          </div>
        ) : null}
        {ins ? (
          <List>
            <Row label={<Term id="pledge">董監持股設質</Term>} testid="q-pledge" value={pct(ins.pledge_pct)}
              sub={`董事與監察人合計持股 ${ok(ins.hold_pct) ? `${fmtNum(ins.hold_pct, 1)}%` : '未公布'}${ins.ym ? `・${ins.ym.replace('-', '/')}` : ''}`} subWide />
          </List>
        ) : null}
        <p class="ui-foot ui-muted qv-pending" data-testid="q-pending">{pendingText(q)}</p>
      </Section>

      <List chev>
        <Row label="看全市場的生意體質" sub="四個走向、類型、ROIC 由高到低" href="#/explore/quality" testid="to-market-quality" />
      </List>
    </>
  );
}
