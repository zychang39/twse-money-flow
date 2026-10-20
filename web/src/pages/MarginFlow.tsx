/**
 * 探索 › 融資增減（2026-10-20；#/explore/margin?d=&p=&k=）：每天的資減／資增排行，可回看（前後一個交易日）。
 * 期間：當日、5 日、20 日（期末融資餘額 − 期初前一日餘額）；排序：張數或增減幅。定義見 METHODOLOGY §4.7.8。
 * 依公開資料排序，非推薦。
 */
import { TopBar } from '../components/Chrome';
import { ErrorState } from '../components/DataStatus';
import { IconBack, IconChevron } from '../components/Icons';
import { Conclusion } from '../components/kit';
import { mdw } from '../components/StockPanels';
import { List, Num, PageTitle, Row, Section, Seg, Signed } from '../components/ui';
import { loadMarginDay, loadMarginIndex } from '../data/api';
import { useAsync, useSegParam } from '../hooks';
import { fmtLotsUnit, fmtNum, md } from '../lib/format';
import { setListContext } from '../lib/listContext';
import { MARGIN_KINDS, MARGIN_PERIODS, type MarginKind, type MarginPeriod, type MarginRow, marginRows, streakText } from '../lib/margin';
import { navigate, useRoute } from '../router';
import '../styles/explore.css';

const PERIODS = MARGIN_PERIODS.map(([v]) => v);
const KINDS = MARGIN_KINDS.map(([v]) => v);

export default function MarginFlow() {
  const route = useRoute();
  const ix = useAsync(loadMarginIndex, []);
  const [period, setPeriod] = useSegParam<MarginPeriod>(PERIODS, '1', 'p', 'margin-period');
  const [kind, setKind] = useSegParam<MarginKind>(KINDS, 'down_lots', 'k', 'margin-kind');
  const dates = ix.data?.dates ?? [];
  const q = route.query.get('d');
  const date = q && dates.includes(q) ? q : dates[dates.length - 1] ?? null;
  const i = date ? dates.indexOf(date) : -1;
  const day = useAsync(() => (date ? loadMarginDay(date) : Promise.resolve(null)), [date]);
  const rows = marginRows(day.data, period, kind);
  const go = (j: number) => {
    const qs = new URLSearchParams(route.query);
    qs.set('d', dates[j]);
    navigate(`${route.path}?${qs.toString()}`, true, 'none');
  };
  const down = kind.startsWith('down');
  const byPct = kind.endsWith('pct');
  const counts = day.data?.counts;
  const from = period === '1' || i < 0 ? null : dates[i - Number(period) + 1] ?? null;
  const total = rows?.length ? rows.reduce((a, r) => a + r.chg, 0) : null;
  const open = (code: string) => {
    setListContext({ name: '融資增減', codes: (rows ?? []).map((r) => r.code) });
    navigate(`/stock/${code}`);
  };

  if (ix.error) return <div class="page"><TopBar back="/explore" /><ErrorState error={ix.error} /></div>;
  if (ix.data === null && !ix.loading) {
    return (
      <div class="page">
        <TopBar back="/explore" />
        <PageTitle title="融資增減" />
        <p class="ds-line">資料累積中</p>
      </div>
    );
  }
  return (
    <div class="page" data-testid="margin-page">
      <TopBar back="/explore" />
      <PageTitle title="融資增減"
        sub={counts ? `資減 ${fmtNum(counts.down, 0)}・資增 ${fmtNum(counts.up, 0)}・持平 ${fmtNum(counts.flat, 0)} 檔・可回看 ${dates.length} 個交易日` : ' '} />
      <div class="mg-step" role="group" aria-label="資料日">
        <button type="button" class="icon-btn" aria-label="前一個交易日" disabled={i <= 0} onClick={() => go(i - 1)} data-testid="margin-prev"><IconBack /></button>
        <span class="mg-step-d" data-testid="margin-date" aria-live="polite">{date ? `${mdw(date)}${i === dates.length - 1 ? '・最新' : ''}` : '—'}</span>
        <button type="button" class="icon-btn" aria-label="下一個交易日" disabled={i < 0 || i >= dates.length - 1} onClick={() => go(i + 1)} data-testid="margin-next"><IconChevron /></button>
      </div>
      <Seg options={MARGIN_PERIODS} value={period} onChange={setPeriod} label="期間" testid="margin-period" />
      <div class="mg-gap" />
      <Seg small options={MARGIN_KINDS} value={kind} onChange={setKind} label="排序" testid="margin-kind" />
      <Section title={`${period === '1' ? '當日' : `${period} 日`}融資${down ? '減少' : '增加'}`} aside={from && date ? `${md(from)}～${md(date)}` : date ? md(date) : undefined} testid="margin-rank">
        {day.error ? <ErrorState error={day.error} /> : rows === null ? (
          <p class="ds-line">{day.loading ? ' ' : `${md(date)} 之前不足 ${period} 個交易日，改看當日或較短的期間`}</p>
        ) : (
          <>
            <Conclusion>
              {rows.length ? <>{rows[0].name} {byPct ? <Signed v={rows[0].pct} digits={1} unit="%" /> : fmtLotsUnit(rows[0].chg)}・前 {rows.length} 檔合計 {fmtLotsUnit(total)}</> : `沒有融資${down ? '減少' : '增加'}的股票`}
            </Conclusion>
            <List tags chev testid="margin-rows">
              {rows.map((r) => <MarginItem key={r.code} r={r} byPct={byPct} down={down} onClick={() => open(r.code)} />)}
            </List>
          </>
        )}
        <p class="ds-line">
          {period === '1' ? '漲跌為當日收盤漲跌' : `漲跌為 ${period} 日期間漲跌（除權息不算下跌）`}；普通股、期初融資餘額 ≥ {fmtNum(byPct ? ix.data?.min_base_lots_pct ?? 2000 : ix.data?.min_base_lots ?? 500, 0)} 張。
          依證交所、櫃買中心公開資料排序，非推薦。
        </p>
      </Section>
    </div>
  );
}

function MarginItem({ r, byPct, down, onClick }: { r: MarginRow; byPct: boolean; down: boolean; onClick: () => void }) {
  const streak = down ? streakText(r) : null;
  return (
    <Row label={<>{r.name}<span class="ui-muted"> {r.code}</span></>} subWide onClick={onClick}
      sub={<>
        {byPct ? <>融資 <Signed v={r.pct} digits={1} unit="%" />（{fmtLotsUnit(r.chg)}）</> : <>融資 {fmtLotsUnit(r.chg)}（<Signed v={r.pct} digits={1} unit="%" />）</>}
        {streak ? `・${streak}` : ''}{r.market === '上櫃' ? '・上櫃' : ''}
      </>}
      value={<Num v={r.close} digits={2} />}
      tag={<span class="ui-v" data-a="bl"><Signed v={r.ret} kind="arrow" unit="%" digits={Math.abs(r.ret ?? 0) >= 10 ? 1 : 2} /></span>} />
  );
}
