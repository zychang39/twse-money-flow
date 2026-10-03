/**
 * 探索：選股、回測、產業資金輪動、主動式 ETF、市場溫度、行事曆、處置預警。
 * 次要層級：主要服務「大盤環境能不能積極？」與「自選股有什麼新變化？」的延伸研究。
 * 2026-10-02 健檢：卡片的數字一律來自同一個來源（策略數＝strategies.json 的分級、指標數＝指標判定、ETF 涵蓋＝market.json），
 * 九宮格每格一個不重複的圖示、卡片高度與標題基線統一（.tile）。
 */
import type { ComponentChildren } from 'preact';
import { PageHead, TopBar } from '../components/Chrome';
import { DataStatus } from '../components/DataStatus';
import { Sparkline } from '../components/Viz';
import { IconAlert, IconBooks, IconBriefcase, IconCalendar, IconFilter, IconFlask, IconGrid, IconHistory, IconThermo } from '../components/Icons';
import { useAsync } from '../hooks';
import { loadIndex, loadJson, loadMarket } from '../data/api';
import { TAIEX, TAIEX_TR, TPEX } from '../data/types';
import { envInfo } from '../lib/envState';
import type { EvidenceFile } from '../lib/evidence';
import { labStatus } from '../lib/labStatus';
import { arrow, dirClass, fmtNum, glueNumbers } from '../lib/format';
import { PAGE_SOURCES } from '../lib/health';
import { gradeSummary, verdictSummary } from '../lib/status';
import type { StrategiesFile } from '../lib/strategies';
import { verdictCounts } from '../lib/status';

function IndexCard({ name, values }: { name: string; values: (number | null)[] | undefined }) {
  const v = (values ?? []).filter((x): x is number => x !== null);
  const last = v[v.length - 1] ?? null;
  const prev = v[v.length - 2] ?? null;
  const chg = last !== null && prev !== null ? last - prev : null;
  const pct = chg !== null && prev ? (chg / prev) * 100 : null;
  const d = dirClass(chg);
  return (
    <a class="index-card" href="#/explore/market">
      <div class="caption muted">{name}</div>
      <div class="body w6">{fmtNum(last, 2)}</div>
      <div class={`caption w6 ${d}`}><span aria-hidden="true">{arrow(chg)} </span><span class="sr-only">{d === 'up' ? '上漲' : d === 'down' ? '下跌' : '持平'}</span>{pct === null ? '—' : `${Math.abs(pct).toFixed(2)}%`}</div>
      <div style={{ marginTop: 'var(--s-2)' }}><Sparkline values={(values ?? []).slice(-22)} dir={d} w={136} h={36} /></div>
    </a>
  );
}

/** U-06：數字與單位不斷開（不換行空白），只在「・」後換行（零寬空格）；搭配 CSS word-break: keep-all */
const tileText = (s: string) => glueNumbers(s).replace(/・/g, '・​');

function Tile({ href, icon, label, status }: { href: string; icon: ComponentChildren; label: string; status?: ComponentChildren }) {
  return (
    <a class="tile" href={href}>
      <span class="ico">{icon}</span>
      <span class="tile-text">
        <span class="body w6 tile-label">{label}</span>
        <span class="caption muted tile-status">{typeof status === 'string' ? tileText(status) : status}</span>
      </span>
    </a>
  );
}

export default function Explore() {
  const market = useAsync(loadMarket, []);
  const index = useAsync(loadIndex, []);
  const disp = useAsync(() => loadJson<{ disposition: unknown[]; watch: { risk: boolean }[] }>('disposition.json'), []);
  // v3 M5-1：四張功能卡依工作流固定順序（選股 → 策略庫 → 指標效度表 → 回測），副標是即時數字，不依 alpha 排序
  const ev = useAsync(() => loadJson<EvidenceFile>('evidence.json').catch(() => null), []);
  const st = useAsync(() => loadJson<StrategiesFile>('strategies.json').catch(() => null), []);
  const lab = labStatus(ev.data ?? null, st.data?.strategies ?? null);
  const vc = verdictCounts(ev.data?.rows);
  const env = envInfo(market.data?.env?.lights);
  const sectors = market.data?.sectors ?? [];
  const topSector = [...sectors].sort((a, b) => ((b.net_5 as number) ?? 0) - ((a.net_5 as number) ?? 0))[0];
  const inflow = sectors.filter((s) => ((s.net_5 as number) ?? 0) > 0).length;
  const title = market.data
    ? <>{inflow} 個產業近 5 日法人淨買超，<br />資金環境{env.label}。</>
    : '探索市場';
  const rk = market.data?.etf_ranking;
  const etfStatus = market.data?.active_etfs
    ? rk?.total !== undefined
      ? `${rk.total} 檔・${rk.covered ?? 0} 檔有持股資料`
      : `${market.data.active_etfs.length} 檔・持股資料累積中`
    : '清單';
  return (
    <div class="page">
      <TopBar caption="探索" />
      <PageHead twoLine eyebrow="大盤環境與可研究的新變化" title={title} />
      <DataStatus date={market.data?.date} uses={PAGE_SOURCES.explore} />
      <div class="hscroll" style={{ marginTop: 'var(--s-5)' }} role="group" aria-label="指數">
        <IndexCard name="加權指數" values={index.data?.series[TAIEX]} />
        <IndexCard name="櫃買指數" values={index.data?.series[TPEX]} />
        <IndexCard name="加權報酬指數" values={index.data?.series[TAIEX_TR]} />
      </div>
      <div class="tile-grid" style={{ marginTop: 'var(--s-6)' }}>
        <Tile href="#/explore/screener" icon={<IconFilter />} label="選股" status={lab ? `上架策略今日新觸發 ${lab.today} 檔` : '今日新觸發（資料載入中）'} />
        <Tile href="#/explore/strategies" icon={<IconBooks />} label="策略庫" status={lab ? `策略分級：${gradeSummary(lab.grades)}` : '策略分級（資料載入中）'} />
        <Tile href="#/explore/evidence" icon={<IconFlask />} label="指標效度表" status={ev.data ? `指標判定：${verdictSummary(vc)}` : '指標判定（資料載入中）'} />
        <Tile href="#/explore/backtest" icon={<IconHistory />} label="回測" status={lab?.updated ? `資料更新 ${lab.updated}` : '訊號的歷史統計'} />
        <Tile href="#/explore/sectors" icon={<IconGrid />} label="產業資金輪動" status={topSector ? `近 5 日流入最多：${topSector.industry}` : '依法人金額排列'} />
        <Tile href="#/explore/etf" icon={<IconBriefcase />} label="主動式 ETF" status={etfStatus} />
        <Tile href="#/explore/market" icon={<IconThermo />} label="市場溫度" status={`資金環境 ${env.label}・${env.counts || '資料累積中'}`} />
        <Tile href="#/explore/calendar" icon={<IconCalendar />} label="行事曆" status="除權息、營收、法說會" />
        <Tile href="#/explore/disposition" icon={<IconAlert />} label="處置預警" status={disp.data ? `處置中 ${disp.data.disposition.length} 檔・可能進入 ${disp.data.watch.filter((w) => w.risk).length} 檔` : '注意與處置'} />
      </div>
    </div>
  );
}
