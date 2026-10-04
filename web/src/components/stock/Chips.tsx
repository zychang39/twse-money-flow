/**
 * 個股頁「籌碼」分段（M3）：每個區塊＝標題＋結論行＋解讀行＋圖表，原始數字表格緊接在圖下（E 節）。
 * - 法人：彙總表（5｜20｜60 日；外資／投信／自營商／合計 × 買賣超｜佔量｜連續＋發散橫條，點一列看明細）
 *   → 每日買賣超圖 → 圖正下方每日原始資料表（列數＝所選期間；點長條與點列互相標亮）。
 * - 信用與借券當沖：融資餘額圖 → 每日原始資料表（餘額與當日增減）→ 融資使用率、券資比、融券最後回補日。
 * - 外資持股比、主動式 ETF、股權分散：摘要卡，推入詳情（#/stock/{code}/c/{qfii|etf}、#/stock/{code}/holders）。
 */
import { useMemo, useState } from 'preact/hooks';
import type { StockHistory } from '../../data/types';
import type { ChipBlock, ChipRow } from '../../lib/chips';
import { chipRows } from '../../lib/chips';
import { type InstParty, INST_LABEL, INST_PERIODS, creditFacts, foreignHolding, holderFacts, instDetail, instTable } from '../../lib/stockFacts';
import { instInterp, marginInterp, whaleInterp } from '../../lib/stockInterp';
import { fmtNum, fmtPrice } from '../../lib/format';
import { Conclusion, DivergingBar, Interp, MiniLine, SummaryCard, Term } from '../kit';
import { EmptyRow, List, NavRow, Num, Row, Section, Seg, Signed, Table } from '../ui';
import { BarSeries, SeriesChart } from '../SeriesChart';
import { Sheet } from '../Sheet';
import { mdw } from '../StockPanels';

type N = number | null;
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const md = (iso: string | null | undefined) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '—');
/** 圖表兩端的日期：跨年也看得懂（2026/4/13） */
const dfmt = (d: string) => `${d.slice(0, 4)}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const lotsOf = (v: N) => <Signed v={v} digits={0} unit="張" />;
const lotsCell = (shares: N) => <Signed v={ok(shares) ? shares / 1000 : null} digits={0} />;
const streakText = (s: number) => (s === 0 ? null : `${s > 0 ? '連買' : '連賣'} ${Math.abs(s)}${Math.abs(s) >= 60 ? '+' : ''} 日`);
const sgn = (v: number, d: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), d)}`;
/** 原始資料表先列 5 列，其餘展開（長度規則：分段約 3 個螢幕內） */
const FOLD = 5;

function lastValid(d: string[], a: (number | null)[] | undefined): string | null {
  if (!a) return null;
  for (let i = a.length - 1; i >= 0; i--) if (ok(a[i])) return d[i] ?? null;
  return null;
}

const dayCell = (r: ChipRow) => md(r.date);
/** 收盤（第二行漲跌幅） */
const closeCell = (r: ChipRow) => <>{ok(r.close) ? fmtPrice(r.close) : '—'}<span class="cell-sub"><Signed v={r.chgPct} digits={2} unit="%" /></span></>;

export function ChipsPane({ h, asof }: { h: StockHistory; asof: (d: string | null) => string }) {
  const chip = (h.chip as ChipBlock | null | undefined) ?? null;
  const [days, setDays] = useState<'5' | '20' | '60'>('20');
  const [party, setParty] = useState<InstParty | null>(null);
  const [bars, setBars] = useState<InstParty>('foreign');
  const [pick, setPick] = useState<string | null>(null);
  const [allInst, setAllInst] = useState(false);
  const [allCred, setAllCred] = useState(false);
  const n = Number(days);
  const table = instTable(chip, n);
  const t20 = instTable(chip, 20);
  const detail = party ? instDetail(h, chip, party, n) : null;
  const rows = useMemo(() => (chip ? chipRows(chip).slice(1) : []), [chip]);
  // 所選期間的每日資料（舊到新給圖，新到舊給表）
  const win = rows.slice(-n);
  const winDesc = win.slice().reverse();
  const fh = foreignHolding(h);
  const hf = holderFacts(h);
  const cr = creditFacts(h);
  const etf = h.etf as { count: number; net5_value_yi: N; pct_avg20: N; date: string | null } | null | undefined;
  const lastChip = chip ? chip.d[chip.d.length - 1] : null;
  const st = (p: InstParty) => t20?.rows.find((r) => r.party === p)?.streak ?? 0;
  const tot20 = t20?.rows.find((r) => r.party === 'total') ?? null;
  const instI = instInterp(tot20?.lots, tot20?.pctVolume);
  const mgI = marginInterp(cr.margin5.pct, cr.margin5.abs);
  const whI = whaleInterp(hf);
  const maxPct = Math.max(1, ...(table?.rows ?? []).map((r) => Math.abs(r.pctVolume ?? 0)));
  const selIdx = pick ? win.findIndex((r) => r.date === pick) : -1;
  const qfii = (h.qfii as N[] | undefined) ?? [];
  const whale = (h.whale as N[] | undefined) ?? [];
  const instRowsShown = allInst ? winDesc : winDesc.slice(0, FOLD);
  const credRowsShown = allCred ? winDesc : winDesc.slice(0, FOLD);
  const whaleTier = hf?.tiers.find((t) => t.tier === 'whale');
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
        <Conclusion testid="insti-concl">{[`外資${streakText(st('foreign')) ?? '無連續'}`, `投信${streakText(st('trust')) ?? '無連續'}`].join('・')}</Conclusion>
        <Interp>{instI.text}</Interp>
        <Seg small options={INST_PERIODS.map((d) => [String(d) as '5' | '20' | '60', `${d} 日`] as const)} value={days} onChange={(v) => { setDays(v); setPick(null); }} label="法人期間" testid="insti-period" />
        {table ? (
          <div class="ui-card">
            <Table testid="insti-table" caption={`近 ${days} 日法人買賣超`} rowKey={(r) => r.party} rows={table.rows} onRow={(r) => setParty(r.party)} cols={[
              { key: 'p', label: '法人', render: (r) => r.label },
              { key: 'l', label: '買賣超', align: 'r', render: (r) => lotsOf(r.lots) },
              { key: 'v', label: <Term id="insti_share">佔量</Term>, align: 'r', width: '4.25rem', render: (r) => <Signed v={r.pctVolume} digits={1} unit="%" /> },
              { key: 'b', label: '', width: '3rem', render: (r) => <DivergingBar value={r.pctVolume} max={maxPct} label={`${r.label}佔量 ${ok(r.pctVolume) ? fmtNum(r.pctVolume, 1) : '—'}%`} /> },
              { key: 's', label: <Term id="streak">連續</Term>, align: 'r', width: '3.75rem', render: (r) => (r.streak === 0 ? '—' : `${r.streak > 0 ? '買' : '賣'} ${Math.abs(r.streak)}${Math.abs(r.streak) >= 60 ? '+' : ''}`) },
            ]} />
          </div>
        ) : <List><EmptyRow>資料累積中：需要至少 2 個交易日的法人資料</EmptyRow></List>}
        <Seg small options={[['foreign', '外資'], ['trust', '投信'], ['dealer', '自營商'], ['total', '合計']] as const} value={bars} onChange={setBars} label="每日買賣超法人" />
        {win.length >= 2 ? (
          <>
            <BarSeries testid="insti-bars" label={`${INST_LABEL[bars]}近 ${win.length} 日每日淨買賣超（張）`} dates={win.map((r) => r.date)} signed height={140}
              stacks={[{ id: bars, name: INST_LABEL[bars], color: 'var(--up)', values: win.map((r) => (r[bars] === null ? null : (r[bars] as number) / 1000)) }]}
              format={(v) => fmtNum(v, 0)} dateFormat={dfmt} words={['淨買超', '淨賣超']} unit="張"
              selected={selIdx >= 0 ? selIdx : null} onSelect={(i) => setPick(i === null ? null : win[i]?.date ?? null)}
              readout={(i) => <span class="sc2-r-item">{INST_LABEL[bars]} <Signed v={win[i][bars] === null ? null : (win[i][bars] as number) / 1000} digits={0} unit="張" /></span>} />
            <div class="ui-card">
              <Table testid="insti-daily" caption={`近 ${win.length} 日每日法人買賣超（張）`} rowKey={(r) => r.date} rows={instRowsShown} sticky={instRowsShown.length >= 10}
                selectedKey={pick} onRow={(r) => setPick(pick === r.date ? null : r.date)} cols={[
                  { key: 'd', label: '日期', width: '3rem', render: dayCell },
                  { key: 'c', label: '收盤', align: 'r', render: closeCell },
                  { key: 'f', label: '外資', align: 'r', render: (r) => lotsCell(r.foreign) },
                  { key: 't', label: '投信', align: 'r', render: (r) => lotsCell(r.trust) },
                  { key: 'e', label: '自營', align: 'r', render: (r) => lotsCell(r.dealer) },
                  { key: 's', label: '合計', align: 'r', render: (r) => lotsCell(r.total) },
                ]} />
              {winDesc.length > FOLD ? <button type="button" class="text-btn block" onClick={() => setAllInst(!allInst)} data-testid="insti-daily-more">{allInst ? `只看最近 ${FOLD} 日` : `顯示全部 ${winDesc.length} 日`}</button> : null}
            </div>
          </>
        ) : <List><EmptyRow>資料累積中：目前只有 {win.length} 個交易日的法人資料</EmptyRow></List>}
        <List chev>
          <NavRow title="每日明細" sub="法人・信用・借券當沖，可換單位" href={`#/stock/${h.code}/daily`} testid="to-daily" />
          <NavRow title="法人買賣超報表" sub="近 3 個月逐日買張、賣張" href={`#/stock/${h.code}/institutional`} />
        </List>
      </Section>
      <Sheet open={!!detail} onClose={() => setParty(null)} title={detail ? `${{ foreign: '外資', trust: '投信', dealer: '自營商', total: '三大法人' }[detail.party]}・近 ${days} 日` : ''}>
        {detail ? (
          <List testid="insti-detail">
            <Row label="買賣超" value={lotsOf(detail.lots)} />
            <Row label="佔股本" value={<Signed v={detail.pctCapital} digits={3} unit="%" />} />
            <Row label="估計成本" sub="估" value={<Num v={ok(detail.cost) ? fmtPrice(detail.cost) : null} />} />
            <Row label="現價比成本" value={<Signed v={detail.costRel} unit="%" tone="plain" />} />
            <Row label="近 20 日買超的 1 年百分位" value={<Num v={detail.pct1y} />} />
            {detail.split ? <Row label="自營商自行買賣" value={lotsOf(detail.split.self)} /> : null}
            {detail.split ? <Row label="自營商避險" value={lotsOf(detail.split.hedge)} /> : null}
          </List>
        ) : null}
      </Sheet>

      <Section title="信用與借券當沖" aside={asof(lastValid(h.d, h.mb))} testid="sec-credit" info={
        <p>融資、融券、借券賣出餘額（張）與 5、20 個交易日前相比的增減；當沖率＝當沖成交量 ÷ 成交量。融資使用率＝融資餘額 ÷ 融資限額；券資比＝融券餘額 ÷ 融資餘額；融券最後回補日來自停止融券公告。</p>
      }>
        <Conclusion>融資 {ok(cr.marginBal) ? fmtNum(cr.marginBal, 0) : '—'}<span class="key-unit"> 張</span>・5 日 {ok(cr.margin5.pct) ? `${sgn(cr.margin5.pct, 1)}%` : '—'}</Conclusion>
        <Interp alert={mgI.alert}>{mgI.text}</Interp>
        {win.length >= 2 ? (
          <>
            <SeriesChart dates={win.map((r) => r.date)} axisKey={`mb${n}`} height={120} label={`近 ${win.length} 日融資餘額（張）`} testid="margin-chart" format={(v) => fmtNum(v, 0)} dateFormat={dfmt}
              series={[{ id: 'mb', name: '融資餘額', color: 'var(--d-1)', values: win.map((r) => r.marginBal), main: true }]} />
            <div class="ui-card">
              <Table testid="credit-daily" caption={`近 ${win.length} 日信用與借券當沖（張）`} rowKey={(r) => r.date} rows={credRowsShown} sticky={credRowsShown.length >= 10}
                selectedKey={pick} onRow={(r) => setPick(pick === r.date ? null : r.date)} cols={[
                  { key: 'd', label: '日期', width: '3rem', render: dayCell },
                  { key: 'm', label: '融資', align: 'r', render: (r) => <><Num v={r.marginBal} digits={0} /><span class="cell-sub"><Signed v={r.marginChg} digits={0} tone="plain" /></span></> },
                  { key: 's', label: '融券', align: 'r', render: (r) => <><Num v={r.shortBal} digits={0} /><span class="cell-sub"><Signed v={r.shortChg} digits={0} tone="plain" /></span></> },
                  { key: 'b', label: '借券賣出', align: 'r', render: (r) => <Num v={ok(r.sblSell) ? r.sblSell / 1000 : null} digits={0} /> },
                  { key: 't', label: <Term id="daytrade">當沖率</Term>, align: 'r', render: (r) => <Num v={r.dtPct} digits={1} unit="%" /> },
                ]} />
              {winDesc.length > FOLD ? <button type="button" class="text-btn block" onClick={() => setAllCred(!allCred)}>{allCred ? `只看最近 ${FOLD} 日` : `顯示全部 ${winDesc.length} 日`}</button> : null}
            </div>
          </>
        ) : null}
        <List>
          <Row label={<Term id="margin">融資使用率</Term>} value={<Num v={cr.usage} digits={2} unit="%" />} />
          <Row label={<Term id="short">券資比</Term>} value={<Num v={cr.shortRatio} digits={2} unit="%" />} />
          <Row label="融券最後回補日" value={cr.lastCoverDate ? mdw(cr.lastCoverDate) : '無'} />
        </List>
      </Section>

      <Section title="持股結構" testid="sec-structure">
        <div class="mom-cards">
          <SummaryCard title="外資持股比" href={`#/stock/${h.code}/c/qfii`} testid="sec-qfii"
            conclusion={<>{ok(fh.pct) ? fmtNum(fh.pct, 2) : '—'}<span class="key-unit">%</span></>}
            graphic={qfii.length >= 2 ? <MiniLine values={qfii.slice(-120)} w={300} h={36} color="var(--d-1)" /> : null}
            interp={ok(fh.change20) ? `20 日 ${sgn(fh.change20, 2)} 個百分點・資料日 ${md(fh.date)}` : null} />
          <SummaryCard title="股權分散" href={`#/stock/${h.code}/holders`} testid="sec-holders"
            conclusion={hf && ok(whaleTier?.pct) ? <>千張大戶 {fmtNum(whaleTier!.pct as number, 2)}<span class="key-unit">%</span></> : '資料累積中'}
            graphic={whale.length >= 2 ? <MiniLine values={whale.slice(-120)} w={300} h={36} color="var(--d-1)" /> : null}
            interp={hf ? `${whI.text ?? ''}・資料日 ${md(hf.date)}` : null} />
          <SummaryCard title="主動式 ETF" href={`#/stock/${h.code}/c/etf`} testid="sec-active-etf"
            conclusion={etf ? <>{etf.count}<span class="key-unit"> 檔持有</span></> : '沒有持有'}
            interp={etf ? `近 5 日淨變動 ${ok(etf.net5_value_yi) ? `${sgn(etf.net5_value_yi, 2)} 億` : '—'}（估）・佔 20 日均額 ${ok(etf.pct_avg20) ? `${fmtNum(etf.pct_avg20, 2)}%` : '—'}` : '沒有主動式 ETF 持有（或資料累積中）'} />
        </div>
      </Section>
    </>
  );
}

// ================================================================== 籌碼詳情（外資持股比、主動式 ETF）

export type ChipCard = 'qfii' | 'etf';
export const CHIP_TITLE: Record<ChipCard, string> = { qfii: '外資持股比', etf: '主動式 ETF' };

interface EtfHolder { etf: string; name: string; weight: number | null; change_shares: number | null; d_shares: number | null; date: string; kind: string }
const KIND_NAME: Record<string, string> = { new: '新增', add: '加碼', reduce: '減碼', exit: '剔除', hold: '持平' };

export function ChipDetail({ h, card }: { h: StockHistory; card: ChipCard }) {
  if (card === 'etf') {
    const etf = h.etf as { count: number; net5_value_yi: N; pct_avg20: N; date: string | null } | null | undefined;
    const holders = ((h.etf_holders as EtfHolder[] | undefined) ?? []).slice().sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    return (
      <Section title="持有的主動式 ETF" testid="etf-holders" aside={etf?.date ? `持股日 ${md(etf.date)}` : undefined}
        info={<p>主動式 ETF 每日揭露的持股：權重與當日股數變動（已扣除申購買回造成的變動）。只列事實，不代表後續表現。</p>}>
        <Conclusion>{etf ? `${etf.count} 檔持有` : '沒有持有'}</Conclusion>
        <Interp>{etf && ok(etf.net5_value_yi) ? `近 5 日淨變動 ${sgn(etf.net5_value_yi, 2)} 億（估）` : null}</Interp>
        <List testid="etf-holder-rows">
          {holders.length ? holders.map((x) => (
            <Row key={x.etf} label={x.name} sub={`${x.etf}・${KIND_NAME[x.kind] ?? x.kind}${ok(x.d_shares) && x.d_shares ? `・${sgn(x.d_shares / 1000, 0)} 張` : ''}`}
              value={<Num v={x.weight} digits={2} unit="%" />} href="#/explore/etf" />
          )) : <EmptyRow>沒有主動式 ETF 持有（或資料累積中）</EmptyRow>}
        </List>
      </Section>
    );
  }
  const fh = foreignHolding(h);
  const q = (h.qfii as N[] | undefined) ?? [];
  const n = Math.min(250, q.length);
  return (
    <Section title="外資持股比" testid="qfii-detail" aside={fh.date ? `資料日 ${md(fh.date)}` : undefined} info={<p>外資及陸資持股比例（官方每日公布）；變化為與 20 個交易日前相比的百分點。</p>}>
      <Conclusion>{ok(fh.pct) ? `${fmtNum(fh.pct, 2)}%` : '—'}{ok(fh.change20) ? `・20 日 ${sgn(fh.change20, 2)} 個百分點` : ''}</Conclusion>
      {n >= 2 ? (
        <SeriesChart dates={h.d.slice(-n)} axisKey="qfii" height={180} label="近 250 日外資持股比" testid="qfii-chart" format={(v) => `${fmtNum(v, 2)}%`} dateFormat={dfmt}
          series={[{ id: 'q', name: '外資持股比', color: 'var(--d-1)', values: q.slice(-n), main: true }]} />
      ) : <List><EmptyRow>資料累積中</EmptyRow></List>}
    </Section>
  );
}
