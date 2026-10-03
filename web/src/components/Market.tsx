/**
 * 市場溫度頁的區塊（2026-10 改版）：資金指標、市場溫度、期貨與選擇權、市場寬度、三大法人。
 * 只用共用元件（components/ui.tsx）；門檻、公式、資料來源、驗證結果一律放 ⓘ。
 * 「→ 保守」之類的結論只有在回測驗證顯著時才顯示（envConclusion）。
 */
import type { MarketData, MarketLight } from '../data/types';
import { LIGHT_LABEL, type EnvValidation } from '../lib/envState';
import { MINUS, fmtNum, fmtYiUnit, md, pctPlain } from '../lib/format';
import { useRestoredState } from '../hooks';
import { Card, CardLabel, EmptyRow, List, Num, Row, Seg, Signed, StatGrid, Tag } from './ui';
import { NetBars } from './Viz';

/** 口數＋單位（外資台指期淨未平倉）：「+12,345 口」「−3,210 口」「0 口」。 */
export function fmtContracts(v: number | null | undefined, sign = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const r = Math.round(Math.abs(v));
  const s = !sign || r === 0 ? '' : v > 0 ? '+' : MINUS;
  return `${s}${fmtNum(r, 0)} 口`;
}

/** 多空比 %（小台散戶）：「+12.3%」「−4.0%」。 */
export function fmtRatioPct(v: number | null | undefined, sign = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = !sign || v === 0 ? '' : v > 0 ? '+' : MINUS;
  return `${s}${Math.abs(v).toFixed(1)}%`;
}

/** 燈號列的副資訊：detail（外資期貨另加近 250 日百分位）。 */
export function lightSub(l: MarketLight): string {
  const pct = l.pct250 !== null && l.pct250 !== undefined ? `近 250 日百分位 ${l.pct250.toFixed(0)}` : '';
  return [l.detail ?? l.value, pct].filter(Boolean).join('・');
}

/** 燈號清單：名稱｜短數值｜標籤（只有「風險」用琥珀）；副資訊一行。 */
export function LightsList({ lights, testid }: { lights: MarketLight[]; testid?: string }) {
  return (
    <List tags testid={testid}>
      {lights.map((l) => (
        <Row key={l.id} label={l.label} sub={lightSub(l)} value={<Num v={l.short ?? l.value} />}
          tag={<Tag tone={l.state === 'red' ? 'risk' : 'neutral'}>{LIGHT_LABEL[l.state]}</Tag>} testid={`light-${l.id}`} />
      ))}
    </List>
  );
}

/** 燈號門檻（ⓘ 用）。 */
export function LightsBasis({ lights }: { lights: MarketLight[] }) {
  return <ul>{lights.map((l) => <li key={l.id}>{l.label}：{l.basis || '—'}</li>)}</ul>;
}

const STATE_LABEL = { conservative: '保守', neutral: '中性', aggressive: '積極' } as const;

function meanT(x: { mean: number | null; t: number | null; n: number }): string {
  if (x.mean === null || !x.n) return '—';
  return `${x.mean > 0 ? '+' : x.mean < 0 ? MINUS : ''}${Math.abs(x.mean).toFixed(2)}%（t ${x.t === null ? '—' : x.t.toFixed(2).replace('-', MINUS)}，${fmtNum(x.n, 0)} 天）`;
}

/** 燈號驗證結果（ⓘ 用）：期間、各狀態占比、之後 20／40 日報酬與 t、是否顯示結論與原因。 */
export function ValidationNote({ v }: { v: EnvValidation | null | undefined }) {
  if (!v) return <p>燈號驗證：資料累積中。</p>;
  return (
    <>
      <p>燈號驗證（{v.period[0]}～{v.period[1]}，{fmtNum(v.days, 0)} 個交易日）：逐日以相同門檻重建燈號，只用當日已公布的資料；報酬為加權報酬指數由次一交易日收盤起算，t 以 Newey-West 處理重疊樣本。</p>
      <ul>
        {v.states.map((s) => (
          <li key={s.state}>{STATE_LABEL[s.state]} {(s.share * 100).toFixed(1)}%：20 日 {meanT(s.r20)}；40 日 {meanT(s.r40)}</li>
        ))}
      </ul>
      <p>{v.show_conclusion ? '結論顯示：' : '不顯示「保守／中性／積極」結論：'}{v.reason}</p>
    </>
  );
}

/** 期貨與選擇權最新值與走勢（期交所；只列數字，不做判定）。 */
export function FuturesCard({ market }: { market: MarketData }) {
  const fut = market.env?.futures_series ?? [];
  const retail = market.temperature?.retail ?? [];
  const pc = market.temperature?.pc_series ?? [];
  const last = <T extends { date: string }>(rows: T[], pick: (r: T) => number | null | undefined) => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const v = pick(rows[i]);
      if (v !== null && v !== undefined && Number.isFinite(v)) return { date: rows[i].date, v };
    }
    return null;
  };
  const f = last(fut, (r) => r.net);
  const r = last(retail, (x) => x.mtx);
  const p = last(pc, (x) => x.pc);
  return (
    <Card testid="env-series">
      <List>
        <Row label="外資台指期淨未平倉" sub={f ? md(f.date) : '期交所資料尚未取得'} value={<Signed v={f?.v ?? null} digits={0} unit="口" />} />
        <Row label="小台散戶多空比" sub={r ? md(r.date) : '期交所資料尚未取得'} value={<Signed v={r?.v ?? null} digits={1} unit="%" tone="plain" />} />
        <Row label="選擇權 P/C 比（未平倉）" sub={p ? md(p.date) : '期交所資料尚未取得'} value={<Num v={p ? pctPlain(p.v) : null} />} />
      </List>
      {fut.length ? (
        <div data-testid="futures-series">
          <CardLabel>外資台指期淨未平倉・近 {fut.length} 日</CardLabel>
          <NetBars values={fut.map((x) => x.net)} dates={fut.map((x) => x.date)} label="外資台指期淨未平倉（口）" height={96} unit="口" format={fmtContracts} words={['淨多', '淨空']} />
        </div>
      ) : null}
      {retail.length ? (
        <div data-testid="retail-series">
          <CardLabel>小台散戶多空比・近 {retail.length} 日</CardLabel>
          <NetBars values={retail.map((x) => x.mtx)} dates={retail.map((x) => x.date)} label="小台散戶多空比（%）" height={96} unit="%" format={fmtRatioPct} words={['散戶淨多', '散戶淨空']} />
        </div>
      ) : null}
      {pc.length ? (
        <div data-testid="pc-series">
          <CardLabel>選擇權 P/C 比・近 {pc.length} 日</CardLabel>
          <NetBars values={pc.map((x) => x.pc)} dates={pc.map((x) => x.date)} label="臺指選擇權未平倉 P/C 比（%）" height={96} unit="%" format={(v) => pctPlain(v)} minZero neutral emphasizeRecent={false} />
        </div>
      ) : null}
    </Card>
  );
}

/** 市場寬度（普通股；只列數字）。 */
export function BreadthList({ breadth: b }: { breadth: MarketData['breadth'] }) {
  const pct = (v: number | null | undefined) => <Num v={v === null || v === undefined ? null : v} digits={1} unit="%" />;
  const cnt = (v: number | null | undefined) => <Num v={v ?? null} unit="家" />;
  return (
    <List testid="breadth-list">
      <Row label="上漲／下跌／平盤" value={<Num v={`${fmtNum(b.up, 0)}／${fmtNum(b.down, 0)}／${fmtNum(b.flat, 0)}`} />} />
      <Row label="站上 20 日線" value={pct(b.above_ma20_pct)} />
      <Row label="站上 60 日線" value={pct(b.above_ma60_pct)} />
      <Row label="站上 240 日線" value={pct(b.above_ma240_pct)} />
      <Row label="60 日新高／新低" value={<Num v={b.high60 === null || b.high60 === undefined ? null : `${fmtNum(b.high60, 0)}／${fmtNum(b.low60 ?? 0, 0)}`} unit="家" />} />
      <Row label="52 週新高" value={cnt(b.high52)} />
      <Row label="52 週新低" value={cnt(b.low52)} />
      <Row label="52 週新高 − 新低" value={<Signed v={b.net52 ?? null} digits={0} unit="家" tone="plain" />} />
    </List>
  );
}

type Who = 'all' | 'foreign' | 'trust' | 'dealer';
const WHO: Record<Who, string> = { all: '合計', foreign: '外資', trust: '投信', dealer: '自營商' };

/** 三大法人買賣超金額（上市＋上櫃，億元）：當日三欄＋近 60 日柱狀圖；估算的日子標「估」。 */
export function FlowsCard({ flows }: { flows: MarketData['flows'] }) {
  const [who, setWho] = useRestoredState<Who>('market.who', 'all');
  const last = flows[flows.length - 1];
  if (!last) return <List><EmptyRow>三大法人資料尚未取得</EmptyRow></List>;
  const recent = flows.slice(-60);
  const series = recent.map((f) => (who === 'all' ? (f.foreign === null && f.trust === null && f.dealer === null ? null : (f.foreign ?? 0) + (f.trust ?? 0) + (f.dealer ?? 0)) : f[who]));
  const est = recent.filter((f) => f.est).length;
  return (
    <Card testid="flows-row">
      <CardLabel aside={last.est ? <Tag>估</Tag> : undefined}>{md(last.date)}</CardLabel>
      <StatGrid cols={3} items={[
        { label: '外資', value: <Signed v={last.foreign} digits={1} unit="億" label="外資" /> },
        { label: '投信', value: <Signed v={last.trust} digits={1} unit="億" label="投信" /> },
        { label: '自營商', value: <Signed v={last.dealer} digits={1} unit="億" label="自營商" /> },
      ]} />
      <Seg options={(Object.keys(WHO) as Who[]).map((k) => [k, WHO[k]] as const)} value={who} onChange={setWho} label="法人" small />
      <CardLabel aside={est ? `估 ${est} 日` : undefined}>{WHO[who]}・近 {recent.length} 日</CardLabel>
      <NetBars values={series} dates={recent.map((f) => f.date)} unit="億元" format={fmtYiUnit} label={`${WHO[who]}每日買賣超金額（億元）`} />
    </Card>
  );
}
