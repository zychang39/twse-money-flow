/**
 * 探索（M4）：主版面不捲動就能看到全部入口。指數三格並排；功能格兩欄，每格＝圖示＋標題＋一行即時數值。
 * 2026-11-19：12 格 → 10 格。第一格是最常用的「順風選股」（原「報酬拆解」）；
 * 「回測」移到選股 › 更多、「指標效度表」移到策略庫 › 依據（網址不變；DECISIONS #475）。
 * 數值一律來自同一個來源（策略數＝strategies.json 的分級、ETF 涵蓋＝market.json、族群＝sectors.json）。
 */
import type { ComponentChildren } from 'preact';
import { TopBar } from '../components/Chrome';
import { PageTitle, Signed } from '../components/ui';
import { IconAlert, IconBooks, IconBriefcase, IconCalendar, IconFilter, IconLayers, IconMargin, IconThermo, IconAttribution } from '../components/Icons';
import { useAsync } from '../hooks';
import { loadAttrTailwind, loadIndex, loadJson, loadMarginIndex, loadMarket, loadSectors } from '../data/api';
import type { MarginIndex } from '../data/types';
import { TAIEX, TAIEX_TR, TPEX } from '../data/types';
import { envCounts, envInfo } from '../lib/envState';
import type { EvidenceFile } from '../lib/evidence';
import { labStatus } from '../lib/labStatus';
import type { StrategiesFile } from '../lib/strategies';
import { fmtNum } from '../lib/format';
import { styleNow } from '../lib/tailwind';
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

/** 順風選股卡片：目前順風的風格（風格 ETF 過去 12 個月自己賺錢且贏大盤） */
function attrTile(a: { data: import('../data/types').Tailwind | null; loading: boolean }): string {
  if (!a.data) return a.loading ? '載入中' : '風向・找股票・個股';
  const up = a.data.styles.filter((s) => styleNow(s, a.data!).state === 'tail').map((s) => s.label);
  return up.length ? `順風：${up.join('、')}` : '沒有順風的風格';
}

/** 融資增減卡片：最新一天的資減／資增家數 */
function marginTile(m: { data: MarginIndex | null; loading: boolean }): string {
  const d = m.data?.days[m.data.days.length - 1];
  if (d) return `資減 ${fmtNum(d.down, 0)}・資增 ${fmtNum(d.up, 0)}`;
  return m.loading ? '載入中' : '資料累積中';
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
  const margin = useAsync(loadMarginIndex, []);
  const attr = useAsync(loadAttrTailwind, []);
  const lab = labStatus(ev.data ?? null, st.data?.strategies ?? null);
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
        <Tile icon={<IconAttribution />} title="順風選股" href="#/explore/attribution" testid="ex-attribution" value={attrTile(attr)} />
        <Tile icon={<IconFilter />} title="選股" href="#/explore/screener" testid="ex-screener" value={lab ? `今日新觸發 ${lab.today} 檔` : pending(st)} />
        <Tile icon={<IconBooks />} title="策略庫" href="#/explore/strategies" testid="ex-strategies" value={lab ? `有效 ${lab.grades.valid}・觀察 ${lab.grades.watch}` : pending(st)} />
        <Tile icon={<IconThermo />} title="市場溫度" href="#/explore/market" testid="ex-market" value={market.data ? envCounts(env) : pending(market)} />
        <Tile icon={<IconLayers />} title="族群輪動" href="#/explore/sectors" testid="ex-sectors" value={lead ? `第 1 名 ${lead.name}` : pending(sectors)} />
        <Tile icon={<IconBriefcase />} title="主動式 ETF" href="#/explore/etf" testid="ex-etf" value={rk?.total !== undefined ? `${rk.covered ?? 0}/${rk.total} 檔有持股` : market.data?.active_etfs ? `${market.data.active_etfs.length} 檔` : pending(market)} />
        <Tile icon={<IconCalendar />} title="行事曆" href="#/explore/calendar" testid="ex-calendar" value={cal.data ? `即將 ${upcoming} 件` : '除權息・營收・法說'} />
        <Tile icon={<IconAlert />} title="處置與注意" href="#/explore/disposition" testid="ex-disposition" value={disp.data ? `處置 ${disp.data.disposition.length}・注意 ${disp.data.watch.filter((w) => w.in10 > 0).length}` : pending(disp)} />
        <Tile icon={<IconMargin />} title="融資增減" href="#/explore/margin" testid="ex-margin" value={marginTile(margin)} />
        <Tile icon={<IconMomentum />} title="動能流程" href="#/explore/momentum" testid="ex-momentum" value={mf.loading ? pending(mf) : mf.data ?? '—'} />
      </nav>
    </div>
  );
}
