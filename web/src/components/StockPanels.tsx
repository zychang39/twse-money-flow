/**
 * 個股頁的四個分段（SPEC §5.8，stock 2026-10）：動能｜籌碼｜基本面｜事件。
 * 只組合共用元件（components/ui.tsx）；數字全部來自 lib/stockFacts.ts（純函式、已測試），這裡不做計算。
 * 公式、門檻、資料來源、方法說明一律放 ⓘ；區塊標題用名詞。
 */
import { useMemo, useState } from 'preact/hooks';
import type { StockHistory } from '../data/types';
import type { ChipBlock } from '../lib/chips';
import { chipRows } from '../lib/chips';
import {
  type InstParty, INST_PERIODS, creditFacts, foreignHolding, holderFacts, instDetail, instTable, momBlock, pastConferences, positionFacts,
  returnRows, revenueSummary, rsFacts, trendFacts, upcomingEvents, valuationFacts, volatilityFacts,
} from '../lib/stockFacts';
import { deltaOver } from '../lib/credit';
import { riskCalc, stopVsLimitText } from '../lib/riskCalc';
import type { PortfolioSettings } from '../lib/settings';
import type { TradingCalendar } from '../lib/tradingCalendar';
import { fmtNum, fmtPrice, numberFormat } from '../lib/format';
import { techFacts, kdText, macdText } from '../lib/technical';
import { evaluate, tally, title as bbTitle } from '../lib/bullbear';
import { Button, Card, CardLabel, EmptyRow, List, NavRow, Num, Row, Section, Seg, Signed, StatGrid, Table, Tag } from './ui';
import { Sheet } from './Sheet';
import { NetBars } from './Viz';
import { ScoreRings } from './Scores';
import type { StockRow } from '../data/types';

type N = number | null;
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const WD = '日一二三四五六';
/** 「10/12（一）」 */
export function mdw(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`;
}
const md = (iso: string | null | undefined) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '—');
const price = (v: N) => <Num v={ok(v) ? fmtPrice(v) : null} />;
const lots = (v: N, sign = true) => (sign ? <Signed v={v} digits={0} unit="張" /> : <Num v={v} digits={0} unit="張" />);
const pctPlain = (v: N, digits = 2) => <Signed v={v} digits={digits} unit="%" tone="plain" />;

// ================================================================== 摘要格
export function SummaryStats({ h }: { h: StockHistory }) {
  const s = useMemo(() => {
    const rs = rsFacts(h).now;
    const pos = positionFacts(h);
    const vo = volatilityFacts(h);
    const m = h.metrics ?? {};
    const t20 = instTable(h.chip as ChipBlock | null | undefined, 20)?.rows.find((r) => r.party === 'total')?.pctVolume ?? null;
    const hf = holderFacts(h);
    return { rs, dist52: pos.dist52, biasAtr: vo.biasAtr, vr: ok(m.vol_ratio) ? m.vol_ratio : null, t20, whale: hf?.whaleChange ?? null };
  }, [h]);
  return (
    <Section title="摘要" testid="stock-summary" info={
      <>
        <p>RS 百分位：近 3、6、9、12 個月還原報酬加權（0.4／0.2／0.2／0.2），在全市場普通股中的百分位（0–100）。</p>
        <p>距 52 週高：最新還原收盤 ÷ 近 252 個交易日最高還原收盤 − 1。</p>
        <p>20 日乖離：(收盤 − 20 日均線) ÷ ATR14，以 ATR 倍數表示（還原價）。</p>
        <p>量比：當日成交量 ÷ 前 20 個交易日平均成交量（分母不含當日）。</p>
        <p>法人 20 日：三大法人近 20 個交易日淨買賣超 ÷ 同期成交量。</p>
        <p>千張大戶週變化：持股 1,000 張以上的股東持股比例，與前一週相比（百分點；集保週資料）。</p>
      </>
    }>
      <Card>
        <StatGrid testid="stock-stats" items={[
          { label: 'RS 百分位', value: <Num v={ok(s.rs) ? Math.round(s.rs) : null} /> },
          { label: '距 52 週高', value: pctPlain(s.dist52, 1) },
          { label: '20 日乖離', value: <Signed v={s.biasAtr} digits={2} unit="ATR" tone="plain" /> },
          { label: '量比', value: <Num v={ok(s.vr) ? `${fmtNum(s.vr, 2)}×` : null} /> },
          { label: '法人 20 日佔量', value: <Signed v={s.t20} digits={1} unit="%" /> },
          { label: '千張大戶週變化', value: <Signed v={s.whale} digits={2} unit="百分點" tone="plain" /> },
        ]} />
      </Card>
    </Section>
  );
}

// ================================================================== 動能
export function MomentumPanel({ h, prefs, advanced, row, onScore }: { h: StockHistory; prefs: PortfolioSettings; advanced: boolean; row?: StockRow; onScore?: (id: import('../lib/config').CategoryId) => void }) {
  const ret = returnRows(h);
  const rs = rsFacts(h);
  const ind = momBlock(h)?.industry ?? null;
  const pos = positionFacts(h);
  const tr = trendFacts(h);
  const vo = volatilityFacts(h);
  return (
    <>
      <Section title="報酬與相對強弱" testid="sec-returns" info={
        <>
          <p>報酬：1M／3M／6M／12M＝最近 21／63／126／252 個交易日的還原收盤報酬。</p>
          <p>全市場百分位：同一天全市場普通股（上市＋上櫃）的報酬排名換算成 0–100；ETF 不列百分位。</p>
          <p>RS 百分位：0.4 × 3 個月＋0.2 × 6 個月＋0.2 × 9 個月＋0.2 × 12 個月報酬的全市場百分位；另列 20 個交易日前的值。</p>
          <p>產業相對強弱：所屬產業的普通股近 3 個月報酬中位數，在全部產業中由高到低的名次；成員少於 3 檔的產業不排名。</p>
        </>
      }>
        <Card>
          <Table testid="returns-table" caption="報酬與全市場百分位" rowKey={(r) => r.key} rows={ret} cols={[
            { key: 'p', label: '期間', render: (r) => r.key },
            { key: 'r', label: '報酬', align: 'r', render: (r) => <Signed v={r.ret} unit="%" tone="plain" /> },
            { key: 'q', label: '全市場百分位', align: 'r', render: (r) => <Num v={ok(r.pct) ? Math.round(r.pct) : null} /> },
          ]} />
        </Card>
        <List>
          <Row label="RS 百分位" sub={`20 日前 ${ok(rs.prev) ? Math.round(rs.prev) : '—'}`} value={<Num v={ok(rs.now) ? Math.round(rs.now) : null} />} testid="rs-row" />
          <Row label="產業相對強弱" sub={ind ? `${ind.name}・3 個月中位數 ${ok(ind.median) ? `${ind.median > 0 ? '+' : ind.median < 0 ? '−' : ''}${fmtNum(Math.abs(ind.median), 2)}%` : '—'}` : '沒有產業資料'}
            value={<Num v={ind && ind.rank !== null ? `${ind.rank}/${ind.of}` : null} />} testid="industry-rank" />
        </List>
      </Section>

      <Section title="趨勢" info={<p>20／60／240 日均線＝還原收盤的簡單平均（換回最新原始價基準）；乖離＝收盤 ÷ 均線 − 1。20 &gt; 60 &gt; 240 為多頭排列、20 &lt; 60 &lt; 240 為空頭排列，其餘為均線糾結。</p>}>
        <Card>
          <Table caption="均線" rowKey={(r) => String(r.n)} rows={tr.ma} cols={[
            { key: 'n', label: '均線', render: (r) => `${r.n} 日` },
            { key: 'v', label: '均線價', align: 'r', render: (r) => price(r.value) },
            { key: 'g', label: '乖離', align: 'r', render: (r) => pctPlain(r.gap) },
          ]} />
        </Card>
        <List><Row label="排列" value={tr.alignName} /></List>
      </Section>

      <Section title="位置" info={<p>距 52 週高／60 日高＝最新還原收盤 ÷ 近 252／60 個交易日最高還原收盤 − 1。創 60 日收盤新高＝最新收盤就是近 60 個交易日（含當日）的最高收盤。</p>}>
        <List>
          <Row label="距 52 週高" sub={pos.high52 ? `高點 ${fmtPrice(pos.high52.value)}(${md(pos.high52.date)})` : undefined} value={pctPlain(pos.dist52)} />
          <Row label="距 60 日高" sub={pos.high60 ? `高點 ${fmtPrice(pos.high60.value)}(${md(pos.high60.date)})` : undefined} value={pctPlain(pos.dist60)} />
          <Row label="創 60 日收盤新高" value={pos.newHigh60 === null ? '—' : pos.newHigh60 ? '是' : '否'} />
        </List>
      </Section>

      <Section title="波動" info={<p>ATR14：真實波幅 TR＝max(高 − 低, |高 − 前收|, |低 − 前收|)，Wilder 平滑 14 日；以還原價計算後換回最新原始價基準。20 日乖離的 ATR 倍數＝(收盤 − 20 日均線) ÷ ATR14。</p>}>
        <List>
          <Row label="ATR14" value={price(vo.atr)} />
          <Row label="ATR14 ÷ 股價" value={<Num v={vo.atrPct} digits={2} unit="%" />} />
          <Row label="20 日乖離" value={<Signed v={vo.biasAtr} digits={2} unit="ATR" tone="plain" />} />
        </List>
      </Section>

      <RiskCalcSection h={h} prefs={prefs} atr={vo.atr} price={vo.price} />

      {advanced ? <AdvancedSection h={h} row={row} onScore={onScore} /> : null}
    </>
  );
}

/** 風險試算（§5【動能】）：不足一張自動零股、部位佔本金、停損價相對一日跌停價；底部「帶入檢查表」。 */
export function RiskCalcSection({ h, prefs, atr, price: ref }: { h: StockHistory; prefs: PortfolioSettings; atr: N; price: N }) {
  const [k, setK] = useState<'2' | '3'>('2');
  const r = riskCalc({ capital: prefs.capital, riskPct: prefs.riskPct, oddLot: prefs.oddLot, price: ref, atr, k: Number(k), etf: h.industry === 'ETF' });
  const sizeV = r.shares <= 0 ? '—' : r.mode === 'odd' ? <Num v={r.shares} unit="股" /> : <Num v={r.lots} unit="張" />;
  const href = r.ok && r.stop !== null && ref !== null
    ? `#/discipline/checklist?code=${encodeURIComponent(h.code)}&price=${ref}&stop=${Math.round(r.stop * 100) / 100}&shares=${r.shares}`
    : undefined;
  return (
    <Section title="風險試算" testid="risk-calc" info={
      <>
        <p>停損價＝參考價 − k × ATR14。參考價是最新收盤（未還原）；ATR14 以還原價計算後換回最新原始價基準，兩者同一基準。</p>
        <p>股數＝本金 × 每筆風險 % ÷ 每股風險。整張不足 1 張時自動改用零股計算。</p>
        <p>連續跌停：每天以前一日價格 × 0.9 依升降單位進位，假設跌停鎖死賣不掉、停損價無法成交；R＝虧損 ÷ 計畫風險。這是壓力情境，不是預測。</p>
        <p>只呈現計算結果，不是進出建議。</p>
      </>
    }>
      <Seg small options={[['2', '2 倍 ATR'], ['3', '3 倍 ATR']] as const} value={k} onChange={setK} label="ATR 倍數" />
      <List chev>
        <Row label="本金與每筆風險" sub={`本金 ${numberFormat(0).format(prefs.capital)} 元・每筆風險 ${prefs.riskPct}%`} href="#/me/settings" testid="risk-settings" />
      </List>
      {r.stop === null ? <List><EmptyRow>{r.reason ?? '無法計算'}</EmptyRow></List> : (
        <>
          <List testid="risk-rows">
            <Row label="參考價" sub="最新收盤(未還原)" value={price(ref)} />
            <Row label="停損價" sub={`每股風險 ${fmtPrice(r.perShare)}(${k} × ATR ${fmtPrice(r.atr)})`} value={price(r.stop)} />
            <Row label="股數" sub={r.shares > 0 ? (r.mode === 'odd' ? `零股${r.autoOdd ? '(不足 1 張)' : ''}・部位 ${numberFormat(0).format(r.positionValue)} 元` : `${numberFormat(0).format(r.shares)} 股・部位 ${numberFormat(0).format(r.positionValue)} 元`) : (r.reason ?? '')}
              value={sizeV} testid="risk-shares" />
            <Row label="部位佔本金" value={<Num v={r.positionPct} digits={1} unit="%" />} />
            <Row label="一日跌停價" sub={stopVsLimitText(r, fmtPrice)} value={price(r.limitDown1)} testid="risk-limit" />
          </List>
          <Card>
            <CardLabel>連續跌停</CardLabel>
            <Table caption="連續跌停情境" testid="limit-down-table" rowKey={(s) => String(s.days)} rows={r.scenarios} cols={[
              { key: 'd', label: '跌停', width: '3.5rem', render: (s) => `${s.days} 日` },
              { key: 'p', label: '價格', align: 'r', render: (s) => fmtPrice(s.price) },
              { key: 'l', label: '虧損', align: 'r', render: (s) => (r.shares > 0 ? numberFormat(0).format(Math.round(s.loss)) : '—') },
              { key: 'c', label: '佔本金', align: 'r', width: '4.5rem', render: (s) => (r.shares > 0 ? <Num v={s.lossPct} digits={2} unit="%" /> : '—') },
              { key: 'r', label: 'R', align: 'r', width: '3rem', render: (s) => (s.r === null ? '—' : fmtNum(s.r, 1)) },
            ]} />
            <Button variant="fill" block href={href} disabled={!href} testid="to-checklist">帶入檢查表</Button>
          </Card>
        </>
      )}
    </Section>
  );
}

/** 進階：四個分項分數、多空條件計數、KD、MACD（綜合分已移除）。 */
function AdvancedSection({ h, row, onScore }: { h: StockHistory; row?: StockRow; onScore?: (id: import('../lib/config').CategoryId) => void }) {
  const t = useMemo(() => techFacts(h.h, h.l, h.c, h.af), [h]);
  const bb = useMemo(() => tally(evaluate(h)), [h]);
  return (
    <Section title="進階" testid="sec-advanced" info={<p>分項分數：可用因子子分數依權重平均（缺資料的因子不計），不合成綜合分。多空條件：基本面、籌碼面、量價面、技術面的規則式條件計數，每一項權重相同。KD(9,3,3)、MACD(12,26,9) 以還原價計算。</p>}>
      <Card><ScoreRings row={row} detail={h.scores} onPick={onScore} /></Card>
      <List chev>
        <Row label="多空條件" value={bbTitle(bb)} href={`#/stock/${h.code}/bullbear`} />
      </List>
      <List>
        <Row label="KD" sub={kdText(t)} value={<Num v={ok(t.k) && ok(t.d) ? `${fmtNum(t.k, 0)}／${fmtNum(t.d, 0)}` : null} />} />
        <Row label="MACD 柱狀" sub={macdText(t)} value={<Signed v={t.hist} digits={2} tone="plain" />} />
      </List>
    </Section>
  );
}

// ================================================================== 籌碼
const PARTY_FLOW: Record<InstParty, 'foreign' | 'trust' | 'dealer' | 'total'> = { foreign: 'foreign', trust: 'trust', dealer: 'dealer', total: 'total' };

export function ChipsPanel({ h, asof }: { h: StockHistory; asof: (d: string | null) => string }) {
  const chip = (h.chip as ChipBlock | null | undefined) ?? null;
  const [days, setDays] = useState<'5' | '20' | '60'>('20');
  const [party, setParty] = useState<InstParty | null>(null);
  const [bars, setBars] = useState<InstParty>('foreign');
  const table = instTable(chip, Number(days));
  const detail = party ? instDetail(h, chip, party, Number(days)) : null;
  const rows = useMemo(() => (chip ? chipRows(chip).slice(1) : []), [chip]);
  const fh = foreignHolding(h);
  const hf = holderFacts(h);
  const cr = creditFacts(h);
  const etf = h.etf as { count: number; net5_value_yi: N; pct_avg20: N; date: string | null } | null | undefined;
  const sbl = h.sbl as N[] | undefined;
  const credRows = [
    { k: '融資', bal: cr.marginBal, d5: cr.margin5.abs, d20: cr.margin20.abs },
    { k: '融券', bal: cr.shortBal, d5: deltaOver(h.d, h.sb, 5).abs, d20: deltaOver(h.d, h.sb, 20).abs },
    { k: '借券賣出', bal: cr.sblBal, d5: sbl ? deltaOver(h.d, sbl, 5).abs : null, d20: sbl ? deltaOver(h.d, sbl, 20).abs : null },
  ];
  const lastChip = chip ? chip.d[chip.d.length - 1] : null;
  return (
    <>
      <Section title="法人" aside={asof(table?.end ?? lastChip)} testid="sec-insti" info={
        <>
          <p>買賣超（張）＝期間淨買賣超股數 ÷ 1,000；佔量＝期間淨買賣超 ÷ 同期成交量；連續＝由最新一日往回同方向的天數（最多 60 日）。</p>
          <p>外資含外資自營商；自營商＝自行買賣＋避險；合計＝官方三大法人合計。</p>
          <p>點一列看佔股本 %、估計成本、近 20 日買超在過去 1 年的百分位與自營商拆分。估計成本＝期間淨買超日的成交均價加權（還原價），只是估算。</p>
          <p>券商分點資料不提供（官方查詢頁有驗證碼）。</p>
        </>
      }>
        <Seg small options={INST_PERIODS.map((d) => [String(d) as '5' | '20' | '60', `${d} 日`] as const)} value={days} onChange={setDays} label="法人期間" testid="insti-period" />
        {table ? (
          <Card>
            <Table testid="insti-table" caption={`近 ${days} 日法人買賣超`} rowKey={(r) => r.party} rows={table.rows} onRow={(r) => setParty(r.party)} cols={[
              { key: 'p', label: '法人', render: (r) => r.label },
              { key: 'l', label: '買賣超', align: 'r', render: (r) => lots(r.lots) },
              { key: 'v', label: '佔量', align: 'r', width: '4.5rem', render: (r) => <Signed v={r.pctVolume} digits={1} unit="%" /> },
              { key: 's', label: '連續', align: 'r', width: '4rem', render: (r) => (r.streak === 0 ? '—' : `${r.streak > 0 ? '買' : '賣'} ${Math.abs(r.streak)}${Math.abs(r.streak) >= 60 ? '+' : ''}`) },
            ]} />
          </Card>
        ) : <List><EmptyRow>資料累積中：需要至少 2 個交易日的法人資料</EmptyRow></List>}
      </Section>
      <Sheet open={!!detail} onClose={() => setParty(null)} title={detail ? `${{ foreign: '外資', trust: '投信', dealer: '自營商', total: '三大法人' }[detail.party]}・近 ${days} 日` : ''}>
        {detail ? (
          <List testid="insti-detail">
            <Row label="買賣超" value={lots(detail.lots)} />
            <Row label="佔股本" value={<Signed v={detail.pctCapital} digits={3} unit="%" />} />
            <Row label="估計成本" sub="估" value={price(detail.cost)} />
            <Row label="現價比成本" value={pctPlain(detail.costRel)} />
            <Row label="近 20 日買超的 1 年百分位" value={<Num v={detail.pct1y} />} />
            {detail.split ? <Row label="自營商自行買賣" value={lots(detail.split.self)} /> : null}
            {detail.split ? <Row label="自營商避險" value={lots(detail.split.hedge)} /> : null}
          </List>
        ) : null}
      </Sheet>

      <Section title="每日買賣超" info={<p>近 60 個交易日每日淨買賣超（張）；紅色＝淨買超、綠色＝淨賣超。</p>}>
        <Seg small options={[['foreign', '外資'], ['trust', '投信'], ['dealer', '自營商'], ['total', '合計']] as const} value={bars} onChange={setBars} label="每日買賣超法人" />
        <Card>
          {rows.length ? (
            <NetBars values={rows.map((r) => (r[PARTY_FLOW[bars]] === null ? null : (r[PARTY_FLOW[bars]] as number) / 1000))} dates={rows.map((r) => r.date)}
              label={`每日淨買賣超（張）近 ${rows.length} 日`} caption={`近 ${rows.length} 個交易日・張`} />
          ) : <EmptyRow>資料累積中</EmptyRow>}
        </Card>
      </Section>

      <Section title="外資持股比" aside={asof(fh.date)} info={<p>外資及陸資持股比例（官方每日公布）；變化為與 20 個交易日前相比的百分點。</p>}>
        <List>
          <Row label="外資持股比" value={<Num v={fh.pct} digits={2} unit="%" />} />
          <Row label="20 日變化" value={<Signed v={fh.change20} digits={2} unit="百分點" tone="plain" />} />
        </List>
      </Section>

      <Section title="主動式 ETF" aside={etf?.date ? asof(etf.date) : undefined} info={<p>主動式 ETF 每日揭露的持股：持有檔數、近 5 日淨變動金額（股數變動 × 成交均價，估）與佔 20 日平均成交金額 %。</p>}>
        <List>
          {etf ? (
            <>
              <Row label="持有檔數" value={<Num v={etf.count} unit="檔" />} />
              <Row label="近 5 日淨變動" sub="估" value={<Signed v={etf.net5_value_yi} digits={2} unit="億" />} />
              <Row label="佔 20 日均成交額" value={<Signed v={etf.pct_avg20} digits={2} unit="%" />} />
            </>
          ) : <EmptyRow>資料累積中</EmptyRow>}
        </List>
      </Section>

      <Section title="股權分散" aside={hf ? `資料日 ${md(hf.date)}` : undefined} testid="sec-holders" info={
        <><p>集保股權分散表（每週）：散戶 ≤ 5 張、中實戶 5–400 張、大戶 400–1,000 張、千張大戶 ≥ 1,000 張（四級互斥）。週變化為與前一週相比的百分點。</p></>
      }>
        {hf ? (
          <>
            <Card>
              <Table caption="股權分散四級" rowKey={(r) => r.tier} rows={hf.tiers} cols={[
                { key: 't', label: '級距', render: (r) => r.name },
                { key: 'p', label: '比例', align: 'r', render: (r) => <Num v={r.pct} digits={2} unit="%" /> },
                { key: 'c', label: '週變化', align: 'r', render: (r) => <Signed v={r.change} digits={2} tone="plain" /> },
              ]} />
            </Card>
            <List chev>
              <Row label="千張大戶" value={hf.whaleStreak === 0 ? '持平' : `連 ${Math.abs(hf.whaleStreak)} 週${hf.whaleStreak > 0 ? '增加' : '減少'}`} />
              <NavRow title="趨勢與 15 級分布" href={`#/stock/${h.code}/holders`} />
            </List>
          </>
        ) : <List><EmptyRow>資料累積中</EmptyRow></List>}
      </Section>

      <Section title="信用交易" aside={asof(lastValid(h.d, h.mb))} testid="sec-credit" info={
        <><p>融資、融券、借券賣出餘額（張）與 5、20 個交易日前相比的增減。融資使用率＝融資餘額 ÷ 融資限額；券資比＝融券餘額 ÷ 融資餘額；融券最後回補日來自停止融券公告。</p></>
      }>
        <Card>
          <Table caption="信用餘額" rowKey={(r) => r.k} rows={credRows} cols={[
            { key: 'k', label: '項目', width: '5.5rem', render: (r) => r.k },
            { key: 'b', label: '餘額', align: 'r', render: (r) => <Num v={r.bal} digits={0} /> },
            { key: '5', label: '5 日', align: 'r', render: (r) => <Signed v={r.d5} digits={0} tone="plain" /> },
            { key: '20', label: '20 日', align: 'r', render: (r) => <Signed v={r.d20} digits={0} tone="plain" /> },
          ]} />
        </Card>
        <List>
          <Row label="融資使用率" value={<Num v={cr.usage} digits={2} unit="%" />} />
          <Row label="券資比" value={<Num v={cr.shortRatio} digits={2} unit="%" />} />
          <Row label="融券最後回補日" value={cr.lastCoverDate ? mdw(cr.lastCoverDate) : '無'} />
        </List>
      </Section>

      <Section title="明細">
        <List chev>
          <NavRow title="每日明細" sub="法人・信用・借券當沖" href={`#/stock/${h.code}/daily`} testid="to-daily" />
          <NavRow title="法人買賣超報表" sub="近 3 個月逐日買張、賣張" href={`#/stock/${h.code}/institutional`} />
        </List>
      </Section>
    </>
  );
}

function lastValid(d: string[], a: N[]): string | null {
  for (let i = a.length - 1; i >= 0; i--) if (ok(a[i])) return d[i] ?? null;
  return null;
}

// ================================================================== 基本面
export function FundamentalPanel({ h, asof }: { h: StockHistory; asof: (d: string | null) => string }) {
  const rev = revenueSummary(h);
  const val = valuationFacts(h);
  const [sheet, setSheet] = useState<'rev' | 'q' | null>(null);
  const quarters = (h.quarters as { period: string; revenue: N; gross_margin: N; eps?: N; roe?: N }[] | undefined) ?? [];
  const revRows = ((h.revenue as { ym: string; revenue: number; yoy: N; mom: N }[] | undefined) ?? []).slice().reverse();
  const yi = (v: N) => (ok(v) ? v / 1e5 : null);
  return (
    <>
      <Section title="營收" aside={rev.latest ? `${Number(rev.latest.ym.slice(5, 7))} 月` : undefined} testid="sec-revenue" info={
        <><p>月營收年增率＝當月營收 ÷ 去年同月 − 1。創 12 個月新高＝最新一個月營收 ≥ 前 11 個月最大值；連續年增月數＝由最新一個月往回數年增率 &gt; 0 的月數；近 3 月平均年增＝最近 3 個月年增率的平均。月營收法定公布期限為次月 10 日。</p></>
      }>
        {rev.last12.length ? (
          <Card>
            <NetBars values={rev.yoy12.map((r) => r.yoy)} dates={rev.yoy12.map((r) => r.ym)} unit="%" height={96}
              format={(v, sign = true) => (v === null || v === undefined ? '—' : `${sign && v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), 1)}%`)}
              words={['年增', '年減']} emphasizeRecent={false} neutral caption={`近 ${rev.yoy12.length} 個月營收年增率`} label={`近 ${rev.yoy12.length} 個月營收年增率柱狀圖`} />
          </Card>
        ) : null}
        <List>
          {rev.latest ? (
            <>
              <Row label="最新月營收" sub={`${rev.latest.ym.slice(0, 4)}/${Number(rev.latest.ym.slice(5, 7))}`} value={<Num v={yi(rev.latest.revenue)} digits={1} unit="億" />} />
              <Row label="年增率" value={pctPlain(rev.latest.yoy)} />
              <Row label="近 3 月平均年增" value={pctPlain(rev.yoy3m)} />
              <Row label="創 12 個月新高" value={rev.newHigh ? '是' : '否'} />
              <Row label="連續年增" value={<Num v={rev.growthMonths} unit="個月" />} />
            </>
          ) : <EmptyRow>沒有月營收資料</EmptyRow>}
        </List>
        <List chev>
          <NavRow title="月營收表" onClick={() => setSheet('rev')} />
          <NavRow title="季財報" onClick={() => setSheet('q')} />
        </List>
      </Section>
      <Section title="估值" aside={asof(val.date)} testid="sec-valuation" info={<p>本益比 3 年百分位＝最新本益比在自身近 756 個交易日（約 3 年）本益比中的百分位（0–100）；本益比 ≤ 0（虧損）不計。淨值比、殖利率為證交所／櫃買中心每日公布值。</p>}>
        <List>
          <Row label="本益比" sub={`3 年百分位 ${ok(val.pePct3y) ? Math.round(val.pePct3y) : '—'}`} value={<Num v={val.pe} digits={2} unit="倍" fallback="虧損或未公布" />} />
          <Row label="淨值比" value={<Num v={val.pb} digits={2} unit="倍" />} />
          <Row label="殖利率" value={<Num v={val.dy} digits={2} unit="%" />} />
        </List>
      </Section>
      <Sheet open={sheet !== null} onClose={() => setSheet(null)} detent="full" title={sheet === 'q' ? '季財報' : '月營收表'}>
        {sheet === 'rev' ? (
          <Table caption="月營收" rowKey={(r) => r.ym} rows={revRows} cols={[
            { key: 'm', label: '月份', render: (r) => `${r.ym.slice(0, 4)}/${Number(r.ym.slice(5, 7))}` },
            { key: 'r', label: '營收(億)', align: 'r', render: (r) => fmtNum(r.revenue / 1e5, 1) },
            { key: 'y', label: '年增', align: 'r', render: (r) => pctPlain(r.yoy, 1) },
            { key: 'o', label: '月增', align: 'r', render: (r) => pctPlain(r.mom, 1) },
          ]} />
        ) : null}
        {sheet === 'q' ? (
          quarters.length ? (
            <Table caption="季財報" rowKey={(r) => r.period} rows={quarters.slice().reverse()} cols={[
              { key: 'p', label: '季', render: (r) => r.period },
              { key: 'r', label: '營收(億)', align: 'r', render: (r) => (ok(r.revenue) ? fmtNum(r.revenue / 1e5, 1) : '—') },
              { key: 'g', label: '毛利率', align: 'r', render: (r) => <Num v={r.gross_margin} digits={1} unit="%" /> },
              { key: 'e', label: 'EPS', align: 'r', render: (r) => <Num v={r.eps ?? null} digits={2} /> },
            ]} />
          ) : <EmptyRow>沒有季財報資料</EmptyRow>
        ) : null}
      </Sheet>
    </>
  );
}

// ================================================================== 事件
interface Attn { count10: number; count30: number; days: { date: string; reason: string }[]; disposition: { start: string; end: string; interval: string | null; reason: string | null; measure?: string | null }[]; active: { start: string; end: string; interval: string | null } | null }
interface Conf { date: string; time?: string | null; place?: string | null; text: string; host?: string | null }

export function EventsPanel({ h, today, cal }: { h: StockHistory; today: string; cal: TradingCalendar }) {
  const up = upcomingEvents(h, today, cal);
  const attn = h.attn as Attn | null | undefined;
  const fallback = ((h.events as { date: string; type: string; text: string }[] | undefined) ?? []).filter((e) => e.type === '注意' || e.type === '處置');
  const records: { date: string; kind: '注意' | '處置'; text: string }[] = attn
    ? [
        ...attn.days.map((d) => ({ date: d.date, kind: '注意' as const, text: d.reason })),
        ...attn.disposition.map((d) => ({ date: d.start, kind: '處置' as const, text: `${md(d.start)}–${md(d.end)}${d.interval ? `・約每 ${d.interval}撮合` : ''}${d.measure ? `・${d.measure}` : ''}${d.reason ? `・${d.reason}` : ''}` })),
      ].sort((a, b) => b.date.localeCompare(a.date))
    : fallback.map((e) => ({ date: e.date, kind: e.type as '注意' | '處置', text: e.text }));
  const confs = pastConferences(h, today) as Conf[];
  return (
    <>
      <Section title="即將發生" testid="sec-upcoming" info={<p>月營收公布期限＝次月 10 日，遇休市日順延到下一個交易日；除權息含預告；法說會來自公開資訊觀測站；融券最後回補日來自停止融券公告。</p>}>
        <List tags>
          {up.length ? up.map((e) => (
            <Row key={`${e.kind}${e.date}`} label={e.text} sub={e.overdue ? '期限已過、尚未取得' : undefined} value={mdw(e.date)} tag={<Tag>{e.label}</Tag>} />
          )) : <EmptyRow>無</EmptyRow>}
        </List>
      </Section>
      <Section title="注意／處置紀錄" aside={attn ? `近 10 日 ${attn.count10} 次・近 30 日 ${attn.count30} 次` : undefined} testid="sec-attn"
        info={<p>近 30 個營業日的注意股公告（一天算一次）與近一年的處置期間，只列交易所公告的事實，不預測是否會被處置。</p>}>
        <List tags>
          {records.length ? records.map((r, i) => (
            <Row key={`${r.date}${i}`} label={<span class="sk-clamp2">{r.text}</span>} value={md(r.date)} tag={<Tag tone="risk">{r.kind}</Tag>} />
          )) : <EmptyRow>近 30 個營業日無注意、近一年無處置</EmptyRow>}
        </List>
      </Section>
      <Section title="近一年法說會" testid="sec-conf" info={<p>公開資訊觀測站法人說明會一覽；主辦單位由說明文字擷取。</p>}>
        <List>
          {confs.length ? confs.map((c) => (
            <Row key={c.date + c.text} label={c.host ?? (c.place || '法說會')} sub={c.text} value={md(c.date)} />
          )) : <EmptyRow>近一年無法說會紀錄</EmptyRow>}
        </List>
      </Section>
    </>
  );
}
