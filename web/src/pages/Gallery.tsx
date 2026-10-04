/**
 * 元件展示頁（僅開發用；#/dev，沒有任何入口）：每個共用元件的所有狀態。對齊稽核腳本也量這一頁。
 * 資料全部是固定的合成數列（不是行情）。
 */
import { useState } from 'preact/hooks';
import { TopBar, useAmbient } from '../components/Chrome';
import { HeroChart, PeriodSelector } from '../components/HeroChart';
import { BarChart, BarSeries, MONO, SeriesChart } from '../components/SeriesChart';
import { Card, List, PageTitle, Row, Section, Seg, Signed, StatGrid, Tag, Table } from '../components/ui';
import {
  Conclusion, DataState, DivergingBar, Interp, Metric, MiniLine, ProgressBar, RangeBar, Ring, RiskDot, RollNum, Skeleton, StaleNote, SummaryCard, Term,
} from '../components/kit';
import type { Period, Window } from '../lib/periods';

/** 固定的合成數列（決定性：不用亂數）。 */
function wave(n: number, base: number, amp: number, drift: number, phase = 0): number[] {
  return Array.from({ length: n }, (_, i) => Math.round((base + drift * i + amp * Math.sin(i / 7 + phase) + (amp / 3) * Math.sin(i / 2.3 + phase)) * 100) / 100);
}
function days(n: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(2026, 0, 2));
  while (out.length < n) { const wd = d.getUTCDay(); if (wd > 0 && wd < 6) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

const fmt2 = (v: number) => v.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;

export default function Gallery() {
  useAmbient('up');
  const [period, setPeriod] = useState<Period>('3M');
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('a');
  const [log, setLog] = useState(true);
  const [phase, setPhase] = useState<'loading' | 'empty' | 'stale' | 'error' | 'ok'>('ok');
  const n = period === '1M' ? 22 : period === '3M' ? 64 : period === '1Y' ? 250 : 120;
  const dates = days(n);
  const win: Window = { dates, values: wave(n, 780, 24, 0.5), truncated: false };
  const eqDates = days(260);
  const eq = { main: wave(260, 1, 0.08, 0.004), a: wave(260, 1, 0.05, 0.002, 1), b: wave(260, 1, 0.06, 0.0025, 2), c: wave(260, 1, 0.12, 0.003, 3) };
  return (
    <div class="page" data-testid="gallery">
      <TopBar back="/" />
      <PageTitle title="元件展示" sub="僅開發用・合成數列" />

      <Section title="色彩規則" info={<p>基底單色：背景純黑、文字白色三階、資料圖形白到灰。彩色只有三種用途：紅綠＝帶正負號的漲跌與增減、主走勢線、環境光；藍＝可點的元素；橘＝風險與提醒。</p>}>
        <div class="g-swatches" data-testid="g-swatches">
          {(['--d-1', '--d-2', '--d-3', '--d-4', '--d-band'] as const).map((v) => <span key={v} class="g-sw"><svg width={16} height={16} aria-hidden="true"><rect width={16} height={16} rx={4} fill={`var(${v})`} stroke="var(--card-edge)" /></svg>{v}</span>)}
          {(['--up', '--down', '--brand', '--risk'] as const).map((v) => <span key={v} class="g-sw"><svg width={16} height={16} aria-hidden="true"><rect width={16} height={16} rx={4} fill={`var(${v})`} stroke="var(--card-edge)" /></svg>{v}</span>)}
        </div>
        <p class="ui-foot"><span style={{ color: 'var(--text-1)' }}>文字 100%</span>・<span style={{ color: 'var(--text-2)' }}>文字 60%</span>・<span style={{ color: 'var(--text-3)' }}>文字 30%</span></p>
      </Section>

      <Section title="主走勢圖">
        <HeroChart label="加權指數" win={win} period={period} onPeriod={setPeriod} format={fmt2} area periods={['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y', 'ALL']} />
      </Section>

      <Section title="區間膠囊與分段控制">
        <PeriodSelector value={period} onChange={setPeriod} periods={['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y', 'ALL']} />
        <Seg options={[['a', '總覽'], ['b', '動能'], ['c', '籌碼']] as const} value={seg} onChange={setSeg} label="分段" />
      </Section>

      <Section title="結論行與解讀行" info={<p>結論行在區塊標題下一行；解讀行在指標數值下方。精簡模式隱藏解讀行。</p>}>
        <Conclusion>加權指數近 3 個月上漲 6.2%，站上 60 日線 58%</Conclusion>
        <Card>
          <div class="metrics">
            <Metric term="market_percentile" label="RS 百分位" value="97" graphic={<ProgressBar value={97} label="RS 百分位 97" />} interp="近 1 個月漲幅高於全市場 97% 的股票" />
            <Metric term="bias_atr" label="20 日乖離" value={<>3.4<span class="key-unit">倍 ATR</span></>} alert alertText="20 日乖離超過 3 倍 ATR"
              graphic={<RangeBar low={-4} high={4} markers={[{ v: 3.4, color: 'var(--risk-fill)' }]} label="乖離 3.4 倍 ATR" />} interp="收盤距 20 日線 3.4 倍 ATR，超過 3 倍" />
          </div>
        </Card>
        <Interp>近 14 日平均每天高低波動約 63 元</Interp>
        <Interp alert>融資 5 日增加 12.4%，超過 10%</Interp>
        <p class="ui-foot">名詞：<Term id="atr14" ctx={{ value: '62.98' }} />・<Term id="opportunity_cost" />・橘點 <RiskDot term="volume_ratio" show text="量比超過 3 倍" /></p>
      </Section>

      <Section title="列與帶號數值">
        <List tags chev>
          <Row label="外資" value={<Signed v={67.6} digits={1} unit="億" />} tag={<Tag>連 3 日</Tag>} href="#/dev" />
          <Row label="投信" value={<Signed v={-41.3} digits={1} unit="億" />} tag={<Tag tone="risk">風險</Tag>} href="#/dev" />
          <Row label="收盤" sub="10/2" value={<Signed v={-1.34} kind="arrow" unit="%" />} tag={<Tag tone="strong">有效</Tag>} href="#/dev" />
        </List>
      </Section>

      <Section title="摘要卡">
        <SummaryCard title="報酬與相對強弱" conclusion="近 3 個月 +18.2%・RS 92" graphic={<MiniLine values={wave(60, 100, 6, 0.3)} w={300} h={40} base={100} />} interp="近 3 個月漲幅高於全市場 92% 的股票" href="#/dev" />
        <SummaryCard title="位置" conclusion="10/2 創 52 週收盤新高" graphic={<RangeBar low={502} high={828} markers={[{ v: 828, color: 'var(--d-1)' }]} label="52 週區間" />} />
      </Section>

      <Section title="進度條、區間條、發散橫條">
        <Card>
          <ProgressBar value={64} label="64" />
          <div style={{ height: 'var(--s-4)' }} />
          <ProgressBar value={64} dim label="64（資料不完整）" />
          <div style={{ height: 'var(--s-4)' }} />
          <RangeBar low={-10} high={30} band={[-4, 12]} markers={[{ v: 3, kind: 'tick', color: 'var(--text-2)' }, { v: 18, color: 'var(--d-1)' }, { v: 7, color: 'var(--d-3)' }]} label="隨機 5–95%" />
          <div style={{ height: 'var(--s-4)' }} />
          <DivergingBar value={42} max={100} label="+42" />
          <div style={{ height: 'var(--s-2)' }} />
          <DivergingBar value={-75} max={100} label="−75" />
        </Card>
      </Section>

      <Section title="環">
        <div class="rings">
          <Ring value={72} label="籌碼" sub="資料 100%" />
          <Ring value={58} label="動能" sub="資料 100%" />
          <Ring value={41} dim label="基本面" sub="資料 80%" />
          <Ring value={null} label="估值" sub="資料 0%" />
        </div>
      </Section>

      <Section title="摘要格與表格">
        <Card>
          <StatGrid items={[{ label: '年化報酬', value: <Signed v={12.4} digits={1} unit="%" /> }, { label: 'Sharpe', value: '0.92' }, { label: '最大回撤', value: <Signed v={-23.1} digits={1} unit="%" /> }, { label: '樣本', value: '708 筆' }]} />
        </Card>
        <Card>
          <Table cols={[
            { key: 'y', label: '年份', render: (r: { y: string; a: number; b: number }) => r.y },
            { key: 'a', label: '5 檔組合', render: (r) => <Signed v={r.a} digits={1} unit="%" /> },
            { key: 'b', label: '0050', render: (r) => <Signed v={r.b} digits={1} unit="%" /> },
          ]} rows={[{ y: '2024', a: 31.2, b: 48.1 }, { y: '2025', a: -4.2, b: 9.8 }]} rowKey={(r) => r.y} />
        </Card>
      </Section>

      <Section title="通用圖表">
        <Seg options={[['log', '對數'], ['lin', '線性']] as const} value={log ? 'log' : 'lin'} onChange={(v) => setLog(v === 'log')} label="Y 軸" small />
        <SeriesChart dates={eqDates} axisKey="all" log={log} label="組合回測" format={(v) => v.toFixed(2)}
          series={[
            { id: 'p', name: '5 檔組合', color: MONO.main, values: eq.main, main: true },
            { id: '0050', name: '0050', color: MONO.bench, values: eq.a },
            { id: 'twr', name: '加權報酬', color: MONO.other, dash: 'dash', values: eq.b },
            { id: 'l2', name: '00631L', color: MONO.other, dash: 'dot', values: eq.c },
          ]}
          band={{ lo: eq.a.map((v) => v * 0.92), hi: eq.a.map((v) => v * 1.1), color: MONO.band, name: '隨機 5–95%' }} />
        <BarChart labels={['2021', '2022', '2023', '2024', '2025']} format={(v) => `${Math.round(v)}%`} label="年度報酬"
          series={[{ id: 'p', name: '5 檔組合', color: MONO.main, values: [22, -8, 31, 18, -4] }, { id: 'b', name: '0050', color: MONO.other, values: [21, -21, 29, 48, 10] }]} />
        <BarSeries label="成交金額（不帶號：灰階、最新一根白色）" dates={days(20)} format={(v) => `${Math.round(v)}`} unit="億" height={120} testid="g-bars"
          stacks={[{ id: 't', name: '成交金額', color: MONO.other, values: wave(20, 5200, 600, 10) }]} line={{ name: '20 日均線', color: MONO.bench, values: wave(20, 5200, 200, 5), dash: 'dash' }} />
        <BarSeries label="成交金額（堆疊：上市白 80%、上櫃白 35%）" dates={days(20)} format={(v) => `${Math.round(v)}`} unit="億" height={120} testid="g-stack"
          stacks={[{ id: 'a', name: '上市', color: 'var(--d-80)', values: wave(20, 4200, 500, 8) }, { id: 'b', name: '上櫃', color: 'var(--d-3)', values: wave(20, 1000, 150, 2, 1) }]} />
        <BarSeries label="三大法人買賣超（帶號：紅綠）" dates={days(20)} format={(v) => `${Math.round(v)}`} unit="億" height={120} signed words={['淨買超', '淨賣超']} testid="g-signed"
          stacks={[{ id: 's', name: '合計', color: 'var(--up)', values: wave(20, 0, 120, 0, 2) }]} />
        <MiniLine values={wave(60, 100, 6, 0.3)} w={300} h={48} color="var(--d-1)" lines={[{ values: wave(60, 99, 3, 0.3), color: 'var(--d-1)' }, { values: wave(60, 97, 2, 0.3, 1), color: 'var(--d-2)', dash: 'dash' }]} testid="g-ma" />
        <p class="ui-foot ui-muted">均線：20 日線白色細實線、60 日線灰色虛線</p>
      </Section>

      <Section title="資料狀態">
        <Seg options={[['ok', '正常'], ['loading', '載入中'], ['empty', '無資料'], ['stale', '落後'], ['error', '失敗']] as const} value={phase} onChange={setPhase} label="資料狀態" small />
        <Card>
          <DataState phase={phase} reason={phase === 'empty' ? '資料累積中：目前只有 3 週（自 9/15 起）' : '連線逾時'} stale="三大法人 10/1" onRetry={() => setPhase('ok')}>
            <Row label="成交金額" value={<RollNum value={12134} format={(v) => `${Math.round(v).toLocaleString('zh-TW')} 億`} from={11000} />} />
          </DataState>
        </Card>
        <Skeleton lines={2} />
        <StaleNote>收盤行情 10/1</StaleNote>
        <p class="ui-foot ui-muted">百分比：{pct1(3.4)}、{pct1(-1.2)}</p>
      </Section>
    </div>
  );
}
