/**
 * 個股頁「動能」分段（M3）：五張摘要卡（報酬與相對強弱、族群與走勢相近、趨勢、位置、波動與部位），
 * 每張推入詳情頁 #/stock/{code}/m/{card}。詳情頁的圖表在上、原始數字表格緊接在圖下（E 節）。
 */
import { useMemo, useState } from 'preact/hooks';
import type { StockHistory, StockSectorItem } from '../../data/types';
import type { PortfolioSettings } from '../../lib/settings';
import { positionFacts, returnRows, rsFacts, volatilityFacts } from '../../lib/stockFacts';
import { alignName, atrInterp, gapWord, rsInterp, slopeWord, sp, trendSummary } from '../../lib/stockInterp';
import { fmtNum, fmtPrice } from '../../lib/format';
import { Conclusion, Interp, MiniLine, ProgressBar, RangeBar, RiskDot, SummaryCard, Term } from '../kit';
import { IconChevron } from '../Icons';
import { EmptyRow, List, Num, Row, Section, Signed, Table } from '../ui';
import { SeriesChart } from '../SeriesChart';
import { kdText, macdText, techFacts } from '../../lib/technical';
import { RiskCalcSection } from '../StockPanels';

type N = number | null | undefined;
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const md = (iso: string | null | undefined) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '—');
const pct = (v: N, d = 2) => (ok(v) ? sp(v as number, d) : '—');

export type MomCard = 'returns' | 'sector' | 'trend' | 'position' | 'risk';
export const MOM_TITLE: Record<MomCard, string> = { returns: '報酬與相對強弱', sector: '族群與走勢相近', trend: '趨勢', position: '位置', risk: '波動與部位' };

/** 摘要卡用的數字：只算一次 */
function useMom(h: StockHistory) {
  return useMemo(() => {
    const t = h.trend ?? null;
    const vo = volatilityFacts(h);
    return {
      t, rs: rsFacts(h), ret: returnRows(h), pos: positionFacts(h), vo,
      fine: h.sectors?.fine?.[0] ?? null, official: h.sectors?.official ?? null,
      // ATR14 一律用 pipeline 的值（與 ATR%、百分位同一來源）；舊版個股檔才用前端計算
      atr: ok(t?.atr?.v) ? t!.atr.v : vo.atr,
      atrPct: ok(t?.atr?.pct) ? t!.atr.pct : vo.atrPct,
      atrRank: ok(t?.atr?.rank) ? t!.atr.rank : null,
    };
  }, [h]);
}

export function MomentumPane({ h }: { h: StockHistory }) {
  const m = useMom(h);
  const base = `#/stock/${h.code}/m`;
  const tr = trendSummary(m.t);
  const t = m.t;
  const y52 = t?.y52;
  const close = ok(t?.close) ? (t!.close as number) : m.vo.price;
  const atrI = atrInterp(m.atrPct, m.atrRank);
  const biasAtr = ok(t?.bias_atr) ? t!.bias_atr : m.vo.biasAtr;
  const s = t?.series;
  // 族群卡：可切換所屬的細產業與題材（預設主要細產業）
  const groups = [...(h.sectors?.fine ?? []), ...(h.sectors?.themes ?? [])];
  const [gid, setGid] = useState<string | null>(null);
  const g = groups.find((x) => x.id === gid) ?? groups[0] ?? null;
  const gI = groupInterp(m.rs.now, g);
  const sim = h.similar ?? [];
  const [simAll, setSimAll] = useState(false);
  const g20 = t?.ma['20'];
  const gw = t ? gapWord(t.gap.now, t.gap.prev) : null;
  const sw = g20 ? slopeWord(g20.slope, g20.slope_prev) : null;
  const d60 = t?.d60;
  return (
    <div class="mom-cards" data-testid="mom-cards">
      <SummaryCard title="報酬與相對強弱" href={`${base}/returns`} testid="mom-returns" vt="mom-returns"
        conclusion={<>RS {ok(m.rs.now) ? Math.round(m.rs.now) : '—'}<span class="key-unit">／100</span></>}>
        <span class="ret-rows" role="table" aria-label="各期間報酬與全市場百分位">
          {m.ret.map((r) => (
            <span key={r.key} class="ret-row" role="row">
              <span role="cell" class="ret-k">{RET_NAME[r.key] ?? r.key}</span>
              <span role="cell" class="ret-v"><Signed v={r.ret} digits={1} unit="%" tone="plain" /></span>
              <span role="cell" class="ret-bar"><ProgressBar value={r.pct} label={`${RET_NAME[r.key] ?? r.key}全市場百分位 ${ok(r.pct) ? Math.round(r.pct) : '無資料'}`} /></span>
              <span role="cell" class="ret-p">{ok(r.pct) ? Math.round(r.pct) : '—'}</span>
            </span>
          ))}
        </span>
      </SummaryCard>

      <div class="sum-card mom-group" data-testid="mom-sector">
        <span class="sum-head"><span class="sum-title">族群</span></span>
        {groups.length > 1 ? (
          <div class="chips mom-group-chips" role="group" aria-label="所屬族群">
            {groups.map((x) => <button key={x.id} type="button" class="chip" aria-pressed={x.id === g?.id} onClick={() => setGid(x.id)}>{x.name}</button>)}
          </div>
        ) : null}
        {g ? (
          <>
            <span class="sum-concl">{g.name}{ok(g.rank) ? <>・第 {g.rank}<span class="key-unit">／{g.of} 名</span></> : g.merged_name ? `・併入 ${g.merged_name}` : ''}・3 個月中位數 {pct(g.med3m)}</span>
            <Interp alert={gI.alert}>{gI.text}</Interp>
            <a class="sum-link" href={`#/explore/sectors/${encodeURIComponent(g.id)}`} data-testid="to-sector">族群頁<IconChevron /></a>
          </>
        ) : <Interp>沒有細產業資料</Interp>}
      </div>

      <div class="mom-sim" data-testid="mom-similar">
        <p class="mom-sim-title"><Term id="correlated">走勢相近</Term></p>
        {sim.length ? (
          <>
            <List chev testid="similar-rows">
              {(simAll ? sim.slice(0, 10) : sim.slice(0, 3)).map(([c, name, r]) => <Row key={c} label={name} sub={c} value={<Num v={r} digits={2} />} href={`#/stock/${c}`} />)}
            </List>
            {sim.length > 3 ? <button type="button" class="text-btn" onClick={() => setSimAll(!simAll)} data-testid="similar-more">{simAll ? '只看前 3 檔' : `顯示 ${Math.min(10, sim.length)} 檔`}</button> : null}
          </>
        ) : <List><EmptyRow>資料累積中</EmptyRow></List>}
      </div>

      <SummaryCard title="趨勢" href={`${base}/trend`} testid="mom-trend" vt="mom-trend"
        conclusion={tr.concl ?? '資料不足'}
        graphic={s ? <MiniLine values={s.close} w={300} h={48} lines={[{ values: s.ma20, color: 'var(--c-blue)' }, { values: s.ma60, color: 'var(--c-purple)' }, { values: s.ma240, color: 'var(--c-cyan)' }]} /> : null}>
        {g20 && ok(g20.slope) ? <Interp>20 日線近 10 日 {sp(g20.slope, 1)}（10 日前 {pct(g20.slope_prev, 1)}）{sw && sw !== '持平' ? sw : ''}</Interp> : null}
        {t && ok(t.gap.now) ? <Interp>20–60 日線間距 {fmtNum(t.gap.now, 1)}%（10 日前 {ok(t.gap.prev) ? `${fmtNum(t.gap.prev, 1)}%` : '—'}）{gw && gw !== '持平' ? gw : ''}</Interp> : null}
      </SummaryCard>

      <SummaryCard title="位置" href={`${base}/position`} testid="mom-position" vt="mom-position"
        conclusion={y52?.at_high ? `${md(y52.hi_date)} 創 52 週收盤新高` : ok(y52?.from_hi) ? <>距 52 週高 {fmtNum(Math.abs(y52!.from_hi as number), 1)}<span class="key-unit">%</span></> : '資料不足'}>
        {y52 && ok(y52.lo) && ok(y52.hi) && ok(close) ? (
          <div class="pos-bars">
            <div class="pos-bar"><p class="ui-foot ui-muted pos-label">52 週</p><RangeBar low={y52.lo} high={y52.hi} markers={[{ v: close, color: 'var(--text-1)' }]} label={`52 週區間 ${fmtPrice(y52.lo)}～${fmtPrice(y52.hi)}`} /></div>
            {d60 && ok(d60.lo) && ok(d60.hi) ? <div class="pos-bar"><p class="ui-foot ui-muted pos-label">60 日</p><RangeBar low={d60.lo} high={d60.hi} markers={[{ v: close, color: 'var(--text-1)' }]} label={`60 日區間 ${fmtPrice(d60.lo)}～${fmtPrice(d60.hi)}`} /></div> : null}
          </div>
        ) : null}
        {ok(y52?.from_lo) ? <Interp>距 52 週低 {sp(y52!.from_lo as number, 1)}</Interp> : null}
        {t ? <Interp>近 20 日創 60 日新高 {t.new_high60_20d} 次</Interp> : null}
      </SummaryCard>

      <div class="sum-card" data-testid="mom-risk">
        <span class="sum-head"><span class="sum-title">波動與部位</span></span>
        <span class="sum-concl">ATR14 {ok(m.atr) ? fmtPrice(m.atr) : '—'}<span class="key-unit"> 元</span>・{ok(m.atrPct) ? fmtNum(m.atrPct, 2) : '—'}<span class="key-unit">%</span>{atrI.alert ? <RiskDot term="atr_pct" show /> : null}</span>
        <div class="vol-bars">
          {ok(m.atrRank) ? <div class="pos-bar"><p class="ui-foot ui-muted pos-label">ATR% 近 1 年百分位 {Math.round(m.atrRank * 100)}</p><ProgressBar value={m.atrRank * 100} color={atrI.alert ? 'var(--risk)' : 'var(--c-cyan)'} label={`ATR% 近 1 年百分位 ${Math.round(m.atrRank * 100)}`} /></div> : null}
          {ok(biasAtr) ? <div class="pos-bar"><p class="ui-foot ui-muted pos-label">20 日乖離 {sp(biasAtr, 2).replace('%', '')}{'\u00a0'}倍 ATR</p><AtrScale v={biasAtr} /></div> : null}
        </div>
        <Interp alert={atrI.alert}>{atrI.text}</Interp>
        <a class="btn block sum-btn" href={`${base}/risk`} data-testid="to-risk">用 ATR 試算部位</a>
      </div>
    </div>
  );
}

/** 20 日乖離 ATR 倍數刻度條（−4～+4）：> 3 標橘（B4） */
function AtrScale({ v }: { v: number }) {
  const x = Math.max(-4, Math.min(4, v));
  const pos = ((x + 4) / 8) * 100;
  const hot = Math.abs(v) > 3;
  return (
    <span class="atr-scale" role="img" aria-label={`20 日乖離 ${fmtNum(v, 2)} 倍 ATR，刻度 −4～+4，超過 ±3 為提醒`}>
      <i class="atr-zone l" /><i class="atr-zone r" /><i class="atr-mid" />
      <i class={`atr-dot ${hot ? 'hot' : ''}`} style={{ left: `${pos}%` }} />
    </span>
  );
}

const RET_NAME: Record<string, string> = { '1M': '近 1 個月', '3M': '近 3 個月', '6M': '近 6 個月', '12M': '近 12 個月' };

/** 族群卡解讀行（M3）：個股 PR ≥ 80 且族群在後三分之一 →「個股強於族群」（提醒）；兩者都在前三分之一 →「族群與個股同強」；其餘只陳述名次 */
export function groupInterp(pr: N, g: StockSectorItem | null): { text: string | null; alert: boolean } {
  if (!g) return { text: null, alert: false };
  const pos = ok(g.pos) ? `本股在族群內第 ${g.pos}/${g.pos_of} 名` : null;
  const tercile = ok(g.rank) && ok(g.of) && g.of > 0 ? (g.rank / g.of > 2 / 3 ? 3 : g.rank / g.of > 1 / 3 ? 2 : 1) : null;
  if (ok(pr) && pr >= 80 && tercile === 3) return { text: `個股強於族群${pos ? `；${pos}` : ''}`, alert: true };
  if (ok(pr) && pr >= 200 / 3 && tercile === 1) return { text: `族群與個股同強${pos ? `；${pos}` : ''}`, alert: false };
  return { text: pos, alert: false };
}

// ================================================================== 詳情頁內容

export function MomentumDetail({ h, card, prefs }: { h: StockHistory; card: MomCard; prefs: PortfolioSettings }) {
  switch (card) {
    case 'returns': return <ReturnsDetail h={h} />;
    case 'sector': return <SectorDetail h={h} />;
    case 'trend': return <TrendDetail h={h} />;
    case 'position': return <PositionDetail h={h} />;
    default: return <RiskDetail h={h} prefs={prefs} />;
  }
}

function ReturnsDetail({ h }: { h: StockHistory }) {
  const m = useMom(h);
  const rs = (h.series as Record<string, N[]> | undefined)?.rs_percentile ?? [];
  const n = Math.min(250, rs.length);
  const dates = h.d.slice(-n);
  const vals = rs.slice(-n).map((v) => (ok(v) ? v : null));
  const vs = m.t?.vs;
  const rows = m.ret.map((r) => ({ ...r, bench: vs?.[r.key]?.bench ?? null, fine: vs?.[r.key]?.fine ?? null }));
  const r = rsInterp(m.rs.now, m.rs.prev, m.fine);
  return (
    <>
      <Section title="RS 百分位" testid="rs-sec">
        <Conclusion>{ok(m.rs.now) ? `${Math.round(m.rs.now)}${ok(m.rs.prev) ? (Math.round(m.rs.now) === Math.round(m.rs.prev) ? '，和 20 日前相同' : `，比 20 日前${m.rs.now > m.rs.prev ? '高' : '低'} ${Math.abs(Math.round(m.rs.now) - Math.round(m.rs.prev))}`) : ''}` : '資料不足'}</Conclusion>
        <Interp alert={r.alert}>{r.text}</Interp>
        {n >= 2 ? (
          <SeriesChart dates={dates} axisKey="rs" height={180} label="近 250 日 RS 百分位" testid="rs-chart" format={(v) => fmtNum(v, 0)}
            dateFormat={(d) => `${d.slice(0, 4)}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`}
            series={[{ id: 'rs', name: 'RS 百分位', color: 'var(--c-blue)', values: vals, main: true }]} />
        ) : <List><EmptyRow>資料累積中：目前只有 {n} 天</EmptyRow></List>}
      </Section>
      <Section title="各期間報酬" testid="sec-returns">
        <Conclusion>{(() => { const a = rows.find((x) => x.key === '3M'); return a && ok(a.ret) && ok(a.bench) ? `近 3 個月比 0050 ${a.ret >= a.bench ? '多' : '少'} ${fmtNum(Math.abs(a.ret - a.bench), 2)} 個百分點` : '—'; })()}</Conclusion>
        <Interp>{m.fine ? `族群＝${m.fine.name}（成員報酬中位數）` : null}</Interp>
        <div class="ui-card">
          <Table testid="returns-table" caption="個股、0050 與族群中位數的各期間報酬" rowKey={(x) => x.key} rows={rows} cols={[
            { key: 'p', label: '期間', render: (x) => x.key },
            { key: 'r', label: '個股', align: 'r', render: (x) => <Signed v={x.ret} digits={1} unit="%" tone="plain" /> },
            { key: 'q', label: <Term id="market_percentile">PR</Term>, align: 'r', width: '2.75rem', render: (x) => <Num v={ok(x.pct) ? Math.round(x.pct) : null} /> },
            { key: 'b', label: '0050', align: 'r', render: (x) => <Signed v={x.bench} digits={1} unit="%" tone="plain" /> },
            { key: 'f', label: '族群', align: 'r', render: (x) => <Signed v={x.fine} digits={1} unit="%" tone="plain" /> },
          ]} />
        </div>
      </Section>
    </>
  );
}

function sectorHref(id: string): string {
  return `#/explore/sectors/${encodeURIComponent(id)}`;
}

function SectorRow({ s, testid }: { s: StockSectorItem; testid?: string }) {
  const rankTxt = ok(s.rank) ? `第 ${s.rank}／${s.of}` : s.merged_name ? `併入 ${s.merged_name}` : '成員不足';
  const path = s.path?.length > 1 ? s.path.slice(0, -1).join(' › ') : null;
  return (
    <Row label={s.name} sub={[path, s.stream, `3 個月中位數 ${pct(s.med3m)}`, ok(s.pos) ? `本股 ${s.pos}/${s.pos_of}` : null].filter(Boolean).join('・')}
      value={rankTxt} href={sectorHref(s.id)} testid={testid} />
  );
}

function SectorDetail({ h }: { h: StockHistory }) {
  const sec = h.sectors;
  const sim = (h.similar ?? []).slice(0, 10);
  const fine = sec?.fine?.[0];
  return (
    <>
      <Section title="所屬族群" testid="sec-groups" aside={sec?.date ? `資料日 ${md(sec.date)}` : undefined}>
        <Conclusion>{fine ? `${fine.name}${ok(fine.rank) ? ` 第 ${fine.rank}／${fine.of}` : ''}` : '沒有細產業資料'}</Conclusion>
        <Interp>{fine ? `依成員近 3 個月報酬中位數排名，${(fine.rank_prev ?? null) !== null && ok(fine.rank) ? (fine.rank < (fine.rank_prev as number) ? '比 20 日前上升' : fine.rank > (fine.rank_prev as number) ? '比 20 日前下降' : '和 20 日前相同') : '20 日前無排名'}` : null}</Interp>
        <List chev testid="group-rows">
          {sec?.official ? <SectorRow s={sec.official} testid="group-official" /> : null}
          {(sec?.fine ?? []).map((s) => <SectorRow key={s.id} s={s} />)}
          {(sec?.themes ?? []).map((s) => <SectorRow key={s.id} s={s} />)}
          {!sec ? <EmptyRow>資料累積中</EmptyRow> : null}
        </List>
      </Section>
      <Section title="走勢相近" testid="sec-similar">
        <Conclusion>{sim.length ? `${sim[0][1]} 最接近（相關 ${fmtNum(sim[0][2], 2)}）` : '沒有資料'}</Conclusion>
        <Interp>{sim.length ? '近 60 個交易日每日報酬的相關係數，前 10 名' : null}</Interp>
        <List chev testid="similar-rows">
          {sim.map(([c, name, r]) => <Row key={c} label={name} sub={c} value={<Num v={r} digits={2} />} href={`#/stock/${c}`} />)}
          {!sim.length ? <EmptyRow>資料累積中</EmptyRow> : null}
        </List>
      </Section>
    </>
  );
}

function TrendDetail({ h }: { h: StockHistory }) {
  const t = h.trend;
  if (!t) return <List><EmptyRow>資料累積中</EmptyRow></List>;
  const s = t.series;
  const tr = trendSummary(t);
  const gw = gapWord(t.gap.now, t.gap.prev);
  const rows = (['20', '60', '240'] as const).map((k) => ({ k, ...t.ma[k], word: slopeWord(t.ma[k].slope, t.ma[k].slope_prev) }));
  return (
    <>
      <Section title="均線" testid="sec-trend">
        <Conclusion>{tr.concl ?? alignName(t.align.state)}</Conclusion>
        <Interp>{tr.interp}</Interp>
        <SeriesChart dates={s.dates} axisKey="trend" height={200} label="近 120 日收盤與均線" testid="trend-chart" format={(v) => fmtPrice(v)}
          dateFormat={(d) => `${d.slice(0, 4)}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`}
          series={[
            { id: 'c', name: '收盤', color: 'var(--text-1)', values: s.close, main: true },
            { id: '20', name: '20 日線', color: 'var(--c-blue)', values: s.ma20 },
            { id: '60', name: '60 日線', color: 'var(--c-purple)', values: s.ma60 },
            { id: '240', name: '240 日線', color: 'var(--c-cyan)', values: s.ma240 },
          ]} />
        <div class="ui-card">
          <Table testid="ma-table" caption="均線價、乖離與斜率" rowKey={(r) => r.k} rows={rows} cols={[
            { key: 'n', label: <Term id="ma">均線</Term>, render: (r) => `${r.k} 日` },
            { key: 'v', label: '均線價', align: 'r', render: (r) => (ok(r.v) ? fmtPrice(r.v) : '—') },
            { key: 'b', label: <Term id="bias">乖離</Term>, align: 'r', render: (r) => <Signed v={r.bias} unit="%" tone="plain" /> },
            { key: 's', label: <Term id="slope">近 10 日</Term>, align: 'r', render: (r) => <><Signed v={r.slope} unit="%" tone="plain" />{r.word && r.word !== '持平' ? <span class="cell-sub">{r.word}</span> : null}</> },
            { key: 'p', label: '10 日前', align: 'r', render: (r) => <Signed v={r.slope_prev} unit="%" tone="plain" /> },
          ]} />
        </div>
      </Section>
      <TechSection h={h} />
      <Section title="均線間距" testid="sec-gap">
        <Conclusion>20 日線比 60 日線{ok(t.gap.now) ? (t.gap.now >= 0 ? ` 高 ${fmtNum(Math.abs(t.gap.now), 2)}%` : ` 低 ${fmtNum(Math.abs(t.gap.now), 2)}%`) : ' —'}</Conclusion>
        <Interp>{gw ? `和 10 日前（${pct(t.gap.prev)}）相比，${gw === '持平' ? '差不多' : gw}` : null}</Interp>
        <SeriesChart dates={s.dates} axisKey="gap" height={140} zero label="20 日線與 60 日線的距離" testid="gap-chart" format={(v) => sp(v)}
          dateFormat={(d) => `${d.slice(0, 4)}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`}
          series={[{ id: 'g', name: '間距', color: 'var(--c-indigo)', values: s.gap, main: true }]} />
      </Section>
    </>
  );
}

/** KD、MACD（還原價）：只列數值與白話，不下判斷 */
function TechSection({ h }: { h: StockHistory }) {
  const t = useMemo(() => techFacts(h.h, h.l, h.c, h.af), [h]);
  return (
    <Section title="技術指標" testid="sec-tech" info={<p>KD(9,3,3)、MACD(12,26,9) 以還原價計算。</p>}>
      <List>
        <Row label="KD" sub={kdText(t)} value={<Num v={ok(t.k) && ok(t.d) ? `${fmtNum(t.k, 0)}／${fmtNum(t.d, 0)}` : null} />} />
        <Row label="MACD 柱狀" sub={macdText(t)} value={<Signed v={t.hist} digits={2} tone="plain" />} />
      </List>
    </Section>
  );
}

function PositionDetail({ h }: { h: StockHistory }) {
  const m = useMom(h);
  const t = m.t;
  const y = t?.y52;
  const close = t?.close ?? m.vo.price;
  return (
    <>
      <Section title="52 週區間" testid="sec-52w">
        <Conclusion>{y?.at_high ? `${md(y.hi_date)} 創 52 週收盤新高` : ok(y?.from_hi) ? `距高點 ${fmtNum(Math.abs(y!.from_hi as number), 1)}%、距低點 +${fmtNum(y!.from_lo ?? 0, 1)}%` : '資料不足'}</Conclusion>
        {y && ok(y.lo) && ok(y.hi) && ok(close) ? (
          <div class="pos-range">
            <RangeBar low={y.lo} high={y.hi} markers={[{ v: close, color: 'var(--text-1)' }]} label={`52 週區間 ${fmtPrice(y.lo)}～${fmtPrice(y.hi)}，目前 ${fmtPrice(close)}`} testid="range-52w" />
            <div class="pos-ends ui-foot ui-muted"><span>低 {fmtPrice(y.lo)}({md(y.lo_date)})</span><span>高 {fmtPrice(y.hi)}({md(y.hi_date)})</span></div>
          </div>
        ) : null}
        <List testid="pos-rows">
          <Row label={<Term id="high_52w">距 52 週高</Term>} sub={y ? `高點 ${fmtPrice(y.hi)}(${md(y.hi_date)})` : undefined} value={y?.at_high ? '新高' : <Signed v={y?.from_hi ?? m.pos.dist52} digits={1} unit="%" tone="plain" />} />
          <Row label="距 52 週低" sub={y ? `低點 ${fmtPrice(y.lo)}(${md(y.lo_date)})` : undefined} value={<Signed v={y?.from_lo} digits={1} unit="%" tone="plain" />} />
          <Row label="距 60 日高" sub={m.pos.high60 ? `高點 ${fmtPrice(m.pos.high60.value)}(${md(m.pos.high60.date)})` : undefined}
            value={m.pos.newHigh60 ? '新高' : <Signed v={m.pos.dist60} digits={1} unit="%" tone="plain" />} />
          <Row label={<Term id="new_high_60">近 20 日創 60 日新高</Term>} value={<Num v={t?.new_high60_20d ?? null} unit="次" />} />
        </List>
      </Section>
    </>
  );
}

function RiskDetail({ h, prefs }: { h: StockHistory; prefs: PortfolioSettings }) {
  const m = useMom(h);
  const atrI = atrInterp(m.atrPct, m.atrRank);
  const biasAtr = ok(m.t?.bias_atr) ? m.t!.bias_atr : m.vo.biasAtr;
  return (
    <>
      <div class="ui-prose risk-intro" data-testid="risk-intro">
        <p>ATR14 是近 14 個交易日平均每天的波動幅度（元）。</p>
        <p>停損價＝參考價減 2 或 3 倍 ATR；股數＝本金 × 每筆風險 ÷ 每股風險。</p>
        <p>只呈現計算結果，不是進出建議。</p>
      </div>
      <Section title="波動" testid="sec-vol">
        <Conclusion>ATR14 {ok(m.atr) ? fmtPrice(m.atr) : '—'}（{ok(m.atrPct) ? `${fmtNum(m.atrPct, 2)}%` : '—'}）</Conclusion>
        <Interp alert={atrI.alert}>{atrI.text}</Interp>
        <List>
          <Row label={<Term id="atr14">ATR14</Term>} value={ok(m.atr) ? fmtPrice(m.atr) : '—'} />
          <Row label={<Term id="atr_pct">ATR14 ÷ 股價</Term>} sub={ok(m.atrRank) ? `近 1 年第 ${Math.round(m.atrRank * 100)} 百分位` : undefined} value={<Num v={m.atrPct} digits={2} unit="%" />} />
          <Row label={<Term id="bias_atr">20 日乖離</Term>} value={<Signed v={biasAtr} digits={2} unit="倍 ATR" tone="plain" />} />
        </List>
      </Section>
      <RiskCalcSection h={h} prefs={prefs} atr={m.atr} price={m.vo.price} />
    </>
  );
}
