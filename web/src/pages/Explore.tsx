/**
 * 探索（2026-10 改版）：指數、選股、策略庫、指標效度表、回測、產業資金輪動、主動式 ETF、市場溫度、行事曆、處置與注意。
 * 副資訊的數字一律來自同一個來源（策略數＝strategies.json 的分級、指標數＝指標判定、ETF 涵蓋＝market.json）。
 */
import { TopBar } from '../components/Chrome';
import { List, NavRow, Num, PageTitle, Row, Section, Signed } from '../components/ui';
import { IconAlert, IconBooks, IconBriefcase, IconCalendar, IconFilter, IconFlask, IconGrid, IconHistory, IconThermo } from '../components/Icons';
import { useAsync } from '../hooks';
import { loadIndex, loadJson, loadMarket } from '../data/api';
import { TAIEX, TAIEX_TR, TPEX } from '../data/types';
import { envConclusion, envCounts, envInfo } from '../lib/envState';
import type { EvidenceFile } from '../lib/evidence';
import { labStatus } from '../lib/labStatus';
import { gradeSummary, verdictSummary } from '../lib/status';
import type { StrategiesFile } from '../lib/strategies';
import { verdictCounts } from '../lib/status';

/** 指數列：名稱｜收盤｜當日漲跌幅（▲▼）。 */
function indexRow(name: string, values: (number | null)[] | undefined) {
  const v = (values ?? []).filter((x): x is number => x !== null);
  const last = v[v.length - 1] ?? null;
  const prev = v[v.length - 2] ?? null;
  const pct = last !== null && prev ? ((last - prev) / prev) * 100 : null;
  return <Row key={name} label={name} value={<Num v={last} digits={2} />} value2={<Signed v={pct} unit="%" kind="arrow" label={name} />} href="#/explore/market" />;
}

export default function Explore() {
  const market = useAsync(loadMarket, []);
  const index = useAsync(loadIndex, []);
  const disp = useAsync(() => loadJson<{ disposition: unknown[]; watch: { in10: number }[] }>('disposition.json'), []);
  // v3 M5-1：四張功能卡依工作流固定順序（選股 → 策略庫 → 指標效度表 → 回測），副標是即時數字，不依 alpha 排序
  const ev = useAsync(() => loadJson<EvidenceFile>('evidence.json').catch(() => null), []);
  const st = useAsync(() => loadJson<StrategiesFile>('strategies.json').catch(() => null), []);
  const lab = labStatus(ev.data ?? null, st.data?.strategies ?? null);
  const vc = verdictCounts(ev.data?.rows);
  const env = envInfo(market.data?.env?.lights);
  const sectors = market.data?.sectors ?? [];
  const topSector = [...sectors].sort((a, b) => ((b.net_5 as number) ?? 0) - ((a.net_5 as number) ?? 0))[0];
  const inflow = sectors.filter((s) => ((s.net_5 as number) ?? 0) > 0).length;
  const title = market.data ? `近 5 日法人淨買超 ${inflow} 個產業・資金指標 ${envCounts(env)}` : null;
  const rk = market.data?.etf_ranking;
  const etfStatus = market.data?.active_etfs
    ? rk?.total !== undefined
      ? `${rk.total} 檔・${rk.covered ?? 0} 檔有持股資料`
      : `${market.data.active_etfs.length} 檔・持股資料累積中`
    : '清單';
  const dispSub = disp.data ? `處置中 ${disp.data.disposition.length} 檔・近 10 日注意 ${disp.data.watch.filter((w) => w.in10 > 0).length} 檔` : '交易所公告';
  const conclusion = envConclusion(env, market.data?.env?.validation);
  return (
    <div class="page">
      <TopBar caption="探索" />
      <PageTitle title="探索" sub={title ?? undefined} />
      <Section title="指數">
        <List chev>
          {indexRow('加權指數', index.data?.series[TAIEX])}
          {indexRow('櫃買指數', index.data?.series[TPEX])}
          {indexRow('加權報酬指數', index.data?.series[TAIEX_TR])}
        </List>
      </Section>
      <Section title="研究">
        <List chev>
          <NavRow icon={<IconFilter />} title="選股" sub={lab ? `上架策略今日新觸發 ${lab.today} 檔` : '今日新觸發'} href="#/explore/screener" />
          <NavRow icon={<IconBooks />} title="策略庫" sub={lab ? `策略分級：${gradeSummary(lab.grades)}` : '策略分級'} href="#/explore/strategies" />
          <NavRow icon={<IconFlask />} title="指標效度表" sub={ev.data ? `指標判定：${verdictSummary(vc)}` : '指標判定'} href="#/explore/evidence" />
          <NavRow icon={<IconHistory />} title="回測" sub={lab?.updated ? `資料更新 ${lab.updated}` : '訊號的歷史統計'} href="#/explore/backtest" />
        </List>
      </Section>
      <Section title="市場">
        <List chev>
          <NavRow icon={<IconThermo />} title="市場溫度" sub={market.data ? `${envCounts(env)}${conclusion ? ` → ${conclusion}` : ''}` : '資金指標'} href="#/explore/market" />
          <NavRow icon={<IconGrid />} title="產業資金輪動" sub={topSector ? `近 5 日法人淨買超最多：${topSector.industry}` : '依法人金額排列'} href="#/explore/sectors" />
          <NavRow icon={<IconBriefcase />} title="主動式 ETF" sub={etfStatus} href="#/explore/etf" />
          <NavRow icon={<IconCalendar />} title="行事曆" sub="除權息、營收、法說會" href="#/explore/calendar" />
          <NavRow icon={<IconAlert />} title="處置與注意" sub={dispSub} href="#/explore/disposition" />
        </List>
      </Section>
    </div>
  );
}
