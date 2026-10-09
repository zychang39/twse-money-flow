/**
 * 探索（M4）：主版面不捲動就能看到全部入口。指數三格並排；功能格兩欄，每格＝圖示＋標題＋一行即時數值：
 * 選股、策略庫、指標效度表、回測、市場溫度、族群輪動、主動式 ETF、行事曆、處置與注意。
 * 數值一律來自同一個來源（策略數＝strategies.json 的分級、指標數＝指標判定、ETF 涵蓋＝market.json、族群＝sectors.json）。
 */
import type { ComponentChildren } from 'preact';
import { TopBar } from '../components/Chrome';
import { PageTitle, Signed } from '../components/ui';
import { IconAlert, IconBooks, IconBriefcase, IconCalendar, IconFilter, IconFlask, IconHistory, IconLayers, IconThermo } from '../components/Icons';
import { useAsync } from '../hooks';
import { loadIndex, loadJson, loadMarket, loadSectors } from '../data/api';
import { TAIEX, TAIEX_TR, TPEX } from '../data/types';
import { envCounts, envInfo } from '../lib/envState';
import type { EvidenceFile } from '../lib/evidence';
import { labStatus } from '../lib/labStatus';
import { verdictCounts } from '../lib/status';
import type { StrategiesFile } from '../lib/strategies';
import { fmtNum } from '../lib/format';
import { moodOf, useAmbient } from '../lib/ambient';
import { todayTpe } from '../lib/dates';
import '../styles/explore.css';
import { PageStale } from '../components/DataStatus';
import { IconMomentum } from '../momentum/Icon';
import { loadSummary as loadMomentumSummary } from '../momentum/data';

/** 指數格：名稱｜收盤｜當日漲跌幅（▲▼） */
function IndexTile({ name, short, values, pending }: { name: string; short: string; values: (number | null)[] | undefined; pending?: ComponentChildren }) {
  const v = (values ?? []).filter((x): x is number => x !== null);
  const last = v[v.length - 1] ?? null;
  const prev = v[v.length - 2] ?? null;
  const pct = last !== null && prev ? ((last - prev) / prev) * 100 : null;
  return (
    <a class="ex-index" href="#/explore/market" aria-label={`${name} ${last === null ? '無資料' : fmtNum(last, 2)}`} data-testid="ex-index">
      <span class="ex-index-n">{short}</span>
      <span class="ex-index-v">{last === null ? (pending ?? '—') : fmtNum(last, last > 10000 ? 0 : 2)}</span>
      <span class="ex-index-c"><Signed v={pct} unit="%" kind="arrow" label={name} /></span>
    </a>
  );
}

function Tile({ icon, title, value, href, testid }: { icon: ComponentChildren; title: string; value: ComponentChildren; href: string; testid: string }) {
  return (
    <a class="ex-tile" href={href} data-testid={testid}>
      <span class="ex-tile-i" aria-hidden="true">{icon}</span>
      <span class="ex-tile-t">{title}</span>
      <span class="ex-tile-v">{value}</span>
    </a>
  );
}

export default function Explore() {
  const market = useAsync(loadMarket, []);
  const index = useAsync(loadIndex, []);
  const sectors = useAsync(() => loadSectors().catch(() => null), []);
  const disp = useAsync(() => loadJson<{ disposition: unknown[]; watch: { in10: number }[] }>('disposition.json'), []);
  const ev = useAsync(() => loadJson<EvidenceFile>('evidence.json').catch(() => null), []);
  const st = useAsync(() => loadJson<StrategiesFile>('strategies.json').catch(() => null), []);
  const cal = useAsync(() => loadJson<{ events?: { date: string }[] }>('calendar.json').catch(() => null), []);
  const mf = useAsync(() => loadMomentumSummary().catch(() => null), []);
  const lab = labStatus(ev.data ?? null, st.data?.strategies ?? null);
  const vc = verdictCounts(ev.data?.rows);
  const env = envInfo(market.data?.env?.lights);
  const rk = market.data?.etf_ranking;
  const lead = (sectors.data?.groups ?? []).filter((g) => g.layer === 'fine' && g.rank === 1)[0];
  const tx = index.data?.series[TAIEX] ?? [];
  const txv = tx.filter((x): x is number => x !== null);
  useAmbient(moodOf(txv.length >= 2 ? txv[txv.length - 1] - txv[txv.length - 2] : null));
  const today = todayTpe();
  const upcoming = (cal.data?.events ?? []).filter((e) => e.date >= today).length;
  // 載入中＝骨架；載入完成仍沒有資料＝讀取失敗（四種狀態，F 節）
  const pending = (x: { loading: boolean }) => (x.loading ? <span class="skeleton line ex-skel" aria-label="載入中" /> : '讀取失敗');
  return (
    <div class="page explore-page">
      <TopBar caption="探索" />
      <PageTitle title="探索" />
      <PageStale />
      <div class="ex-indices" role="group" aria-label="指數">
        <IndexTile name="加權指數" short="加權" values={index.data?.series[TAIEX]} pending={index.data ? undefined : pending(index)} />
        <IndexTile name="櫃買指數" short="櫃買" values={index.data?.series[TPEX]} pending={index.data ? undefined : pending(index)} />
        <IndexTile name="加權報酬指數" short="報酬指數" values={index.data?.series[TAIEX_TR]} pending={index.data ? undefined : pending(index)} />
      </div>
      <nav class="ex-grid" aria-label="功能">
        <Tile icon={<IconFilter />} title="選股" href="#/explore/screener" testid="ex-screener" value={lab ? `今日新觸發 ${lab.today} 檔` : pending(st)} />
        <Tile icon={<IconBooks />} title="策略庫" href="#/explore/strategies" testid="ex-strategies" value={lab ? `有效 ${lab.grades.valid}・觀察 ${lab.grades.watch}` : pending(st)} />
        <Tile icon={<IconFlask />} title="指標效度表" href="#/explore/evidence" testid="ex-evidence" value={ev.data ? `有效 ${vc['有效']}・共 ${vc.total} 項` : pending(ev)} />
        <Tile icon={<IconHistory />} title="回測" href="#/explore/backtest" testid="ex-backtest" value={lab?.updated ? `更新 ${lab.updated.split(' ')[0]}` : '訊號的歷史統計'} />
        <Tile icon={<IconThermo />} title="市場溫度" href="#/explore/market" testid="ex-market" value={market.data ? envCounts(env) : pending(market)} />
        <Tile icon={<IconLayers />} title="族群輪動" href="#/explore/sectors" testid="ex-sectors" value={lead ? `第 1 名 ${lead.name}` : pending(sectors)} />
        <Tile icon={<IconBriefcase />} title="主動式 ETF" href="#/explore/etf" testid="ex-etf" value={rk?.total !== undefined ? `${rk.covered ?? 0}/${rk.total} 檔有持股` : market.data?.active_etfs ? `${market.data.active_etfs.length} 檔` : pending(market)} />
        <Tile icon={<IconCalendar />} title="行事曆" href="#/explore/calendar" testid="ex-calendar" value={cal.data ? `即將 ${upcoming} 件` : '除權息・營收・法說'} />
        <Tile icon={<IconAlert />} title="處置與注意" href="#/explore/disposition" testid="ex-disposition" value={disp.data ? `處置 ${disp.data.disposition.length}・注意 ${disp.data.watch.filter((w) => w.in10 > 0).length}` : pending(disp)} />
        <Tile icon={<IconMomentum />} title="動能流程" href="#/explore/momentum" testid="ex-momentum" value={mf.loading ? pending(mf) : mf.data ?? '—'} />
      </nav>
    </div>
  );
}
