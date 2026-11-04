/**
 * 盤後簡報的融資增減（2026-10-20）：總覽「上市融資」小卡（與「漲跌家數」湊成 2×2）、資金分段的「融資」區塊。
 * 2026-11-04：主數字改成上市（新聞與市場講的「融資減少 N 億」是上市），上櫃與上市＋上櫃合計列在備註（DECISIONS #462）。
 * 證交所、櫃買中心約 20:45 公布；20:50 起每 5 分鐘試抓，抓到就快速部署（只重算融資增減）。定義見 METHODOLOGY §4.7.8。
 */
import type { ComponentChildren } from 'preact';
import { useMemo } from 'preact/hooks';
import type { MarketData } from '../data/types';
import { loadMarginIndex, loadMeta } from '../data/api';
import { useAsync } from '../hooks';
import { Card, List, Num, Row, Section, Signed } from './ui';
import { Conclusion, SummaryCard } from './kit';
import { BarSeries } from './SeriesChart';
import { cardState, changeOver, dayMargin, dayTotal, publishTime } from '../lib/margin';
import { DAY_STATUS_TEXT, tpeClock } from '../lib/freshness';
import { makeCalendar } from '../lib/tradingCalendar';
import { MINUS, fmtNum, md } from '../lib/format';

function useMarginState() {
  const ix = useAsync(loadMarginIndex, []).data ?? null;
  const meta = useAsync(loadMeta, []).data ?? null;
  const cal = useMemo(() => (meta ? makeCalendar(meta.calendar) : null), [meta]);
  const state = cal ? cardState(ix, cal, tpeClock()) : null;
  return { ix, state };
}

/** 總覽：上市融資（今日增減；上櫃與合計在解讀行）＋漲跌家數 */
export function MarginCards({ market, onSeg }: { market: MarketData | null; onSeg: (s: 'market' | 'money') => void }) {
  const { state } = useMarginState();
  const b = market?.breadth;
  let conclusion: ComponentChildren = '—';
  let interp = '資料累積中';
  if (state?.kind === 'fresh') {
    const d = state.day;
    conclusion = <Signed v={dayMargin(d, 'twse').chg} digits={1} unit="億" />;
    interp = `${md(d.date)}・上櫃 ${fmtSigned(d.tpex?.chg ?? null, false)}・合計 ${fmtSigned(dayTotal(d).chg)}`;
  } else if (state?.kind === 'waiting') {
    conclusion = DAY_STATUS_TEXT[state.status];
    const prev = `${md(state.last.date)} 上市 ${fmtSigned(dayMargin(state.last, 'twse').chg)}`;
    interp = state.status === 'unpublished' ? `約 ${publishTime()} 公布・${prev}` : prev;
  }
  return (
    <>
      <SummaryCard title="上市融資" onClick={() => onSeg('money')} testid="sum-margin" conclusion={conclusion} interp={interp} />
      <SummaryCard title="漲跌家數" onClick={() => onSeg('market')} testid="sum-breadth"
        conclusion={b ? <><span class="up">{fmtNum(b.up, 0)}</span>／<span class="down">{fmtNum(b.down, 0)}</span></> : '—'}
        interp={b ? `平盤 ${fmtNum(b.flat, 0)}・站上 20 日線 ${fmtNum(b.above_ma20_pct, 0)}%` : '資料累積中'} />
    </>
  );
}

function fmtSigned(v: number | null, unit = true): string {
  if (v === null) return '—';
  return `${v > 0 ? '+' : v < 0 ? MINUS : ''}${fmtNum(Math.abs(v), 1)}${unit ? ' 億' : ''}`;
}

/** 資金：融資區塊（三大法人下方） */
export function MarginSection() {
  const { ix, state } = useMarginState();
  if (!ix || !ix.days.length) {
    return (
      <Section title="融資" testid="margin-card">
        <Card><p class="ds-line">資料累積中</p></Card>
      </Section>
    );
  }
  const last = ix.days[ix.days.length - 1];
  const tw = dayMargin(last, 'twse');
  const tot = dayTotal(last);
  const d20 = ix.days.slice(-20);
  const waiting = state?.kind === 'waiting' ? DAY_STATUS_TEXT[state.status] : null;
  return (
    <Section title="融資" testid="margin-card" aside={`${md(last.date)}${waiting ? `・今日${waiting}` : ''}`}
      info={<>
        <p>上市融資金額（億元）的當日增減：證交所「信用交易統計」的融資金額，今日餘額 − 前日餘額。新聞常說的「融資減少 N 億」就是這個數字。上櫃（櫃買中心「上櫃股票融資融券餘額」）與上市＋上櫃合計列在下方備註。</p>
        <p>約 {publishTime()} 公布；20:50 起每 5 分鐘試抓，抓到後數分鐘內更新。個股頁的融資欄在 22:00 後的完整更新時一起更新。</p>
        <p>資料來源：{ix.source}。</p>
      </>}>
      <Conclusion>{md(last.date)} 上市 <Signed v={tw.chg} digits={1} unit="億" />・近 5 日 <Signed v={changeOver(ix, 5, undefined, 'twse')} digits={0} unit="億" /></Conclusion>
      <Card>
        <div class="flow-cells">
          <div class="flow-cell"><span class="metric-l">當日</span><span class="flow-v" data-a="bl"><Signed v={tw.chg} digits={1} unit="億" label="上市當日" /></span></div>
          <div class="flow-cell"><span class="metric-l">近 20 日</span><span class="flow-v" data-a="bl"><Signed v={changeOver(ix, 20, undefined, 'twse')} digits={0} unit="億" label="上市近 20 日" /></span></div>
          <div class="flow-cell"><span class="metric-l">餘額</span><span class="flow-v" data-a="bl"><Num v={tw.amt} digits={0} unit="億" /></span></div>
        </div>
        <BarSeries testid="margin-bars" label="近 20 日上市融資金額增減（億元）" dates={d20.map((d) => d.date)} signed words={['增加', '減少']} unit="億" height={120}
          stacks={[{ id: 'margin', name: '上市融資增減', color: 'var(--up)', values: d20.map((d) => dayMargin(d, 'twse').chg) }]}
          format={(v) => fmtNum(v, 0)}
          readout={(i) => (
            <>
              <span class="sc2-r-item">上市 <Signed v={dayMargin(d20[i], 'twse').chg} digits={1} unit="億" /></span>
              <a class="sc2-r-item" href={`#/explore/margin?d=${d20[i].date}`} data-testid="margin-bar-link">看這天的排行 ›</a>
            </>
          )} />
        <p class="margin-note" data-testid="margin-note">
          <span>上櫃 <Signed v={last.tpex?.chg ?? null} digits={1} unit="億" />・餘額 {fmtNum(last.tpex?.amt ?? null, 0)} 億</span>
          <span>上市＋上櫃 <Signed v={tot.chg} digits={1} unit="億" />・餘額 {fmtNum(tot.amt, 0)} 億</span>
        </p>
      </Card>
      <List chev>
        <Row label="資減排行" sub={`資減 ${fmtNum(last.down, 0)}・資增 ${fmtNum(last.up, 0)}・持平 ${fmtNum(last.flat, 0)} 檔`} href="#/explore/margin" testid="margin-rank-link" />
      </List>
    </Section>
  );
}
