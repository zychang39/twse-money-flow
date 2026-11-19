/**
 * 探索 › 順風選股 › ① 風向（2026-11-13 順風檢查；2026-11-19 重排，DECISIONS #475；#/explore/attribution?seg=wind）。
 * 依 Freddy〈法人級選股實戰〉單元 2「因子動能選股」、單元 3「類股輪動分析」的做法（只取方法，說明用自己的話寫）：
 * 風格 ETF 與類股報酬指數當溫度計，每一類查兩個數字、分成順風／中性／逆風；風格與類股的順風常是同一陣風。
 * 版面：本月風向（三個數字＋跟上個月比）→ 風格 → 類股（兩者同一種橫條：0 與大盤兩條線、分三堆）→ 同一陣風 → 下一步：找股票。
 * 細節放在點一列打開的面板；「不做的事」「自己算一次」「多空因子」收在最下面的「更多」。
 * 定義見 METHODOLOGY §4.12.2；計算 lib/tailwind、pipeline/derive/tailwind.py。用途是排研究的優先順序，不是進出場訊號。
 */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { BarRow } from '../components/BarRows';
import { Conclusion } from '../components/kit';
import { BarSeries } from '../components/SeriesChart';
import { Sheet } from '../components/Sheet';
import { Button, Card, List, Num, Row, Section, Signed, StatGrid, Tag } from '../components/ui';
import { loadAttrTags, loadSummary } from '../data/api';
import type { AttrFactorKey, AttrFactors, AttrStock, StyleKey, Tailwind, WindSector, WindState, WindStyle } from '../data/types';
import { useAsync } from '../hooks';
import { FACTOR_KEYS, FACTOR_SHORT, factorCorr, factorTrend } from '../lib/attribution';
import { fmtNum, md } from '../lib/format';
import {
  type BarScale, type TagRow, WIND_MEANING, WIND_ORDER, WIND_TEXT, WIND_USE, allocSplit, barScale, biggestUnderweight, byState, changed, dominated,
  matrixCell, overweights, sameWindLabel, sameWindPairs, sectorCandidates, sinceInfo, stockStyles, stockWind, styleCandidates, styleNow, tagRows, windLabel, windState,
} from '../lib/tailwind';

const pct = (v: number | null | undefined, d = 1) => <Signed v={v === null || v === undefined ? null : v * 100} digits={d} unit="%" />;
const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? '無資料' : `${v >= 0 ? '+' : '−'}${fmtNum(Math.abs(v * 100), 1)}%`);
/** 帶號數字（百分點；負號用全形減號） */
const signed = (v: number, d: number) => `${v >= 0 ? '+' : '−'}${fmtNum(Math.abs(v), d)}`;
const toPct = (v: number | null | undefined) => (v === null || v === undefined ? null : v * 100);
/** 跟大盤差幾個百分點 */
const vsMkt = (r: number | null | undefined, rm: number | null | undefined) => (typeof r === 'number' && typeof rm === 'number' ? `比大盤 ${signed((r - rm) * 100, 1)}` : undefined);
const FACTOR_DEF: Record<AttrFactorKey, string> = {
  smb: '小型股 − 大型股（市值中位數分兩組）',
  hml: '便宜 − 昂貴（淨值市價比 30／70 百分位）',
  umd: '近一年強勢 − 弱勢（12−1 個月報酬）',
  rmw: '高 ROE − 低 ROE（財報公布期限後才用）',
  lv: '低波動 − 高波動（近一年日報酬標準差）',
};

/** 找股票的入口（② 找股票分段；src＝從哪裡找、k＝哪一種風格或哪一個類股） */
export const pickHref = (src: 'style' | 'sector' | 'list', k?: string) => `#/explore/attribution?seg=pick&src=${src}${k ? `&k=${encodeURIComponent(k)}` : ''}`;

/** 狀態標籤：順風用強調字、其他用一般字（紅綠只給漲跌、琥珀只給風險，狀態不用顏色） */
export function WindTag({ state, provisional = false }: { state: WindState | null; provisional?: boolean }) {
  if (!state) return <Tag>—</Tag>;
  return <Tag tone={state === 'tail' ? 'strong' : 'neutral'} testid={`wind-${state}`}>{windLabel(state, provisional)}</Tag>;
}

const src = (st: WindStyle): string => {
  if (st.source === 'spliced') return `${md(st.listed ?? '')} 掛牌，之前以追蹤的報酬指數補上`;
  if (st.source === 'index') return '這裡沒有這檔 ETF 的行情，以追蹤的報酬指數代替';
  return 'ETF 還原價（含息）';
};

/** 未滿 12 個月：已有幾個月、哪一天補滿（不只寫「資料累積中」） */
const sinceNote = (st: WindStyle, date: string): string | null => {
  const i = sinceInfo(st, date);
  return i ? `目前 ${fmtNum(i.months, 1)} 個月・${md(i.full)} 滿 12 個月` : null;
};
/** 年/月/日（跨年的起點要寫出年份） */
const ymd = (iso: string) => `${iso.slice(0, 4)}/${md(iso)}`;

/** 圖例：兩條線的意思（每個橫條區塊上方一行） */
function Legend({ rm, dot = false }: { rm: number | null | undefined; dot?: boolean }) {
  return (
    <p class="wind-legend ui-foot ui-muted" data-testid="wind-legend">
      <span><i class="wk wk-zero" aria-hidden="true" />0%</span>
      <span><i class="wk wk-mkt" aria-hidden="true" />大盤 {fmtPct(rm)}</span>
      {dot ? <span><i class="wk wk-dot" aria-hidden="true" />排除最大權值股</span> : null}
    </p>
  );
}

interface PileItem {
  key: string; name: string; sub?: ComponentChildren; r: number | null; rm: number | null; state: WindState | null;
  dot?: number | null; label: string;
}

/**
 * 三堆（風格與類股共用，同一種畫法、同一套用詞）：順風／中性／逆風各一張卡；橫條從 0 畫到這一類的報酬，
 * 0 與大盤兩條線在每列同一個位置。順風那一堆全部列出，其他兩堆先列 3 個。
 */
function Piles({ items, scale, kind, onOpen, fold = 3 }: { items: PileItem[]; scale: BarScale; kind: string; onOpen: (key: string) => void; fold?: number }) {
  const [open, setOpen] = useState<Record<WindState, boolean>>({ tail: true, neutral: false, head: false });
  return (
    <>
      {WIND_ORDER.map((k) => {
        const all = items.filter((x) => x.state === k).sort((a, b) => (b.r ?? -9) - (a.r ?? -9));
        const rows = open[k] || all.length <= fold + 1 ? all : all.slice(0, fold);
        return (
          <div key={k} class="wind-pile" data-testid={`wind-pile-${kind}-${k}`}>
            <p class="wind-pile-h ui-foot"><strong>{WIND_TEXT[k]} {all.length}</strong>{all.length ? <span class="ui-muted">・{WIND_USE[k]}</span> : null}</p>
            {all.length ? (
              <List class="attr-bars wind-bars">
                {rows.map((x) => (
                  <BarRow key={x.key} name={x.name} sub={x.sub}
                    bar={{ kind: 'wind', value: x.r, market: x.rm, x: scale.x, over: scale.over, dot: x.dot }}
                    value={pct(x.r)} valueSub={vsMkt(x.r, x.rm)} onClick={() => onOpen(x.key)} label={x.label} testid={`wind-${kind}-${x.key}`} />
                ))}
              </List>
            ) : null}
            {all.length > rows.length || (open[k] && all.length > fold + 1 && k !== 'tail') ? (
              <button type="button" class="text-btn" onClick={() => setOpen({ ...open, [k]: !open[k] })} data-testid={`wind-pile-more-${kind}-${k}`}>
                {open[k] ? `只看前 ${fold} 個` : `顯示全部 ${all.length} 個`}
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function WindPane({ f, tw }: { f: AttrFactors; tw: Tailwind }) {
  const tags = useAsync(loadAttrTags, []);
  const summary = useAsync(loadSummary, []);
  const rows = tagRows(tags.data);
  const nameOf = (c: string) => (summary.data?.byCode.get(c)?.name as string | undefined) ?? c;
  const rm = tw.market.r['12'];
  const styles = tw.styles.map((st) => ({ st, now: styleNow(st, tw) }));
  const tailStyles = styles.filter((x) => x.now.state === 'tail');
  const piles = byState(tw.sectors);
  // 跟上個月底比：風格全部列出；類股最多列 3 個，其餘只寫個數（一次換很多個時不佔滿版面）
  const mv = (x: { prev: WindState | null; state: WindState | null }) => `${WIND_TEXT[x.prev!]} → ${WIND_TEXT[x.state!]}`;
  const movedSectors = changed(tw.sectors);
  const moved = [
    ...changed(tw.styles).map((x) => `${x.label} ${mv(x)}`),
    ...movedSectors.slice(0, 3).map((x) => `${x.key} ${mv(x)}`),
    ...(movedSectors.length > 3 ? [`另有 ${movedSectors.length - 3} 個類股`] : []),
  ];
  const withState = styles.filter((x) => x.now.state).length;
  return (
    <div class="seg-pane" data-testid="attr-wind">
      <Section title="本月風向" testid="wind-steps" aside={`資料至 ${md(tw.date)}`}
        info={<>
          <p>選公司之前，先確認它所屬的那一類股票現在有沒有被市場獎勵。這一步最便宜：查幾個數字，一個月做一次就夠（單元 2、3 的每月 30 分鐘）。</p>
          <p>做法：① 查大盤過去 12 個月的含息報酬 ② 查五種風格 ③ 查各類股 ④ 看順風的風格 ETF 超配哪些類股（同一陣風不重複算）⑤ 更新名單上每家公司的兩個狀態。這一頁把前四步算好了；第五步在「找股票」的「我的名單」。</p>
          <p>順風＝自己賺錢且贏大盤（差距要超過 {fmtNum(tw.near_pp, 0)} 個百分點）；中性＝自己賺錢但輸大盤或幾乎一樣；逆風＝自己賠錢（大盤更差也不升級）。風格和類股用同一套規則、同一組用詞。</p>
          <p>三個提醒：固定每月同一天做；用含息報酬（只看股價會低估配息高的類型）；大盤的尺選定一把就不換。狀態換了先記下來，回頭看受影響的公司；變化本身不是進出場的理由。</p>
          <p>用 12 個月：一個月的漲跌雜訊太多，三五年的贏家又是不該追的東西。ETF 與指數只是溫度計。</p>
        </>}>
        <Card>
          <StatGrid cols={3} testid="wind-stats" items={[
            { label: '大盤 12 個月', value: pct(rm), testid: 'wind-stat-mkt' },
            { label: '風格順風', value: <>{tailStyles.length}<span class="ui-unit">／{withState}</span></>, testid: 'wind-stat-style' },
            { label: '類股順風', value: <>{piles.tail.length}<span class="ui-unit">／{tw.sectors.filter((x) => x.state).length}</span></>, testid: 'wind-stat-sector' },
          ]} />
        </Card>
        <p class="ds-line" data-testid="wind-moved">
          跟上個月底{tw.prev_date ? `（${md(tw.prev_date)}）` : ''}比：{moved.length ? moved.join('、') : '沒有換狀態的類型'}
        </p>
      </Section>

      <StyleSection tw={tw} rows={rows} nameOf={nameOf} />
      <SectorSection tw={tw} rows={rows} nameOf={nameOf} mkt={f.mkt} />
      <SameWindSection tw={tw} f={f} />
      <NextSection tw={tw} rows={rows} nameOf={nameOf} />
      <MoreSection tw={tw} f={f} />
    </div>
  );
}

// ---------------------------------------------------------------- 風格

function StyleSection({ tw, rows, nameOf }: { tw: Tailwind; rows: TagRow[]; nameOf: (c: string) => string }) {
  const [sel, setSel] = useState<StyleKey | null>(null);
  const rm = tw.market.r['12'];
  const nows = tw.styles.map((s) => ({ s, now: styleNow(s, tw) }));
  const scale = barScale(nows.map((x) => x.now.r), rm);
  const tails = nows.filter((x) => x.now.state === 'tail');
  const prov = nows.filter((x) => x.now.provisional && x.s.since);
  const items: PileItem[] = nows.map(({ s, now }) => ({
    key: s.key, name: s.label, sub: `${s.etf}${now.provisional ? '・暫定' : ''}`, r: now.r, rm, state: now.state,
    label: `${s.label} ${s.etf} ${fmtPct(now.r)}，${windLabel(now.state, now.provisional)}`,
  }));
  const st = sel ? tw.styles.find((s) => s.key === sel) ?? null : null;
  return (
    <Section title="風格" testid="wind-styles" aside="12 個月含息報酬"
      info={<>
        <p>風格 ETF 當溫度計（單元 2 對照表的台股那一欄）。每一檔要問兩個問題：它自己有沒有賺錢；有沒有贏過同一個市場的大盤。少問一個都會看錯：品質型漲 15%、大盤漲 20%，它是跟著大盤漲上來的，品質這個特徵反而是拖累。</p>
        <p>圖的讀法：橫條從 0 畫到這一類的報酬；兩條直線是 0 與大盤。橫條過了大盤那條線＝順風，停在兩條線之間＝中性，往 0 的左邊＝逆風。</p>
        <p>學術上的因子是「一籃作多、另一籃放空」的報酬差，大盤的漲跌抵消掉了；ETF 只有作多的那一半，報酬裡同時有大盤、它偏重的特徵、以及它剛好多配的產業。</p>
        <p>台股的風格 ETF 比較混，沒有一對一的對應：常常一檔混了好幾個條件（例如價值加高股息）。看名字不夠，要看追蹤的指數與選股規則。大盤的尺用發行量加權股價報酬指數；市值加權的大盤本身也不中性（台積電一家就占一大半）。</p>
        <p>掛牌未滿 12 個月的 ETF，以有資料以來的同一段期間跟大盤比，標「暫定」；滿 12 個月後自動換回。</p>
      </>}>
      <Conclusion>{tails.length ? `順風：${tails.map((x) => x.s.label + (x.now.provisional ? '（暫定）' : '')).join('、')}` : '沒有順風的風格'}</Conclusion>
      <Legend rm={rm} />
      <Piles items={items} scale={scale} kind="style" onOpen={(k) => setSel(k as StyleKey)} fold={5} />
      <p class="ds-line">橫條過了大盤那條線才算順風。點一列看細節與這一類的股票。{prov.map((x) => `${x.s.label}（${x.s.etf}）未滿 12 個月，先用 ${ymd(x.s.since!.start)} 以來同一段期間跟大盤比：${sinceNote(x.s, tw.date) ?? ''}。`).join('')}</p>
      <Sheet open={!!st} onClose={() => setSel(null)} title={st ? `${st.label}・${st.etf} ${st.name ?? ''}` : ''}>
        {st ? <StyleDetail st={st} tw={tw} rows={rows} nameOf={nameOf} /> : null}
      </Sheet>
    </Section>
  );
}

/** 例子：前幾檔的名稱（依 ETF 權重或市值；依規則產生，非推薦） */
const examples = (cs: { code: string }[], nameOf: (c: string) => string, n = 3) => cs.slice(0, n).map((c) => nameOf(c.code)).join('、');

function StyleDetail({ st, tw, rows, nameOf }: { st: WindStyle; tw: Tailwind; rows: TagRow[]; nameOf: (c: string) => string }) {
  const now = styleNow(st, tw);
  const ow = overweights(st, tw);
  const un = biggestUnderweight(st, tw);
  const sp = allocSplit(st, tw);
  const cs = styleCandidates(tw, rows, st.key);
  const note = sinceNote(st, tw.date);
  return (
    <div data-testid="wind-style-detail">
      <List>
        <Row label="狀態" subWide sub={now.state ? WIND_MEANING[now.state] : '還沒有足夠的資料'} value={<strong data-testid="wind-style-state">{windLabel(now.state, now.provisional)}</strong>} />
      </List>
      <List testid="wind-style-periods">
        {st.since ? (
          <Row label={`${ymd(st.since.start)} 以來`} sub={note ?? undefined} value={pct(st.since.r)} value2={`大盤 ${fmtPct(st.since.rm)}`} testid="wind-style-since" />
        ) : null}
        {tw.months.filter((m) => !(st.since && st.r[String(m)] === null)).map((m) => (
          <Row key={m} label={`近 ${m} 個月`} value={pct(st.r[String(m)])} value2={`大盤 ${fmtPct(tw.market.r[String(m)])}`} />
        ))}
        {st.alt ? <Row label={`${st.alt.code} ${st.alt.name}`} sub="同一格的另一檔（只對照）" value={pct(st.alt.r['12'])} value2="近 12 個月" /> : null}
      </List>
      {st.weights ? (
        <List>
          <Row label="超配的類股" subWide sub={ow.length ? ow.map((o) => `${o.s} ${signed(o.d, 0)}${o.state ? `（${WIND_TEXT[o.state]}）` : ''}`).join('、') : '沒有超配 1 個百分點以上的類股'} />
          {un ? <Row label="低配最多的類股" subWide sub={`${un.s} ${signed(un.d, 0)}${un.state ? `（${WIND_TEXT[un.state]}）` : ''}`} /> : null}
          {sp ? <Row label="比大盤" subWide sub={`${signed(sp.excess * 100, 1)} 個百分點，其中類股配置約 ${signed(sp.alloc * 100, 1)}、其他 ${signed(sp.rest * 100, 1)}`} /> : null}
        </List>
      ) : null}
      <p class="ds-line">{[st.mix, st.char ? `個股歸類看：${st.char}` : null, src(st), st.note].filter(Boolean).join('；')}。</p>
      {cs.length ? (
        <>
          <p class="ds-line" data-testid="wind-style-examples">例：{examples(cs, nameOf)}（依 ETF 權重；依規則產生，非推薦）</p>
          <Button variant="fill" block href={pickHref('style', st.key)} testid="wind-style-pick">看這一類的股票（{cs.length} 檔）</Button>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- 類股

function SectorSection({ tw, rows, nameOf, mkt }: { tw: Tailwind; rows: TagRow[]; nameOf: (c: string) => string; mkt: (number | null)[] }) {
  const [sel, setSel] = useState<string | null>(null);
  const piles = byState(tw.sectors);
  const rm = tw.market.r['12'];
  const scale = barScale(tw.sectors.map((s) => s.r['12']), rm);
  // 順風、由一家權值股主導、而且排除那一家之後其餘公司的等權平均沒有贏過大盤：這個類股的順風多半是那一家
  const lone = piles.tail.filter((s) => dominated(s, tw) && s.ex_top?.r12 !== null && s.ex_top?.r12 !== undefined && windState(s.ex_top.r12, rm, tw.near_pp) !== 'tail');
  const items: PileItem[] = tw.sectors.map((s) => ({
    key: s.key, name: s.key, sub: dominated(s, tw) ? `${s.top!.name} ${fmtNum(s.top!.w, 0)}%` : `${s.n} 家`,
    r: s.r['12'], rm, state: s.state, dot: s.ex_top?.r12 ?? null,
    label: `${s.key} ${fmtPct(s.r['12'])}，${windLabel(s.state)}${s.ex_top?.r12 !== null && s.ex_top?.r12 !== undefined ? `，排除最大權值股後 ${fmtPct(s.ex_top.r12)}` : ''}`,
  }));
  const sec = sel ? tw.sectors.find((s) => s.key === sel) ?? null : null;
  return (
    <Section title="類股" testid="wind-sectors" aside="12 個月含息報酬"
      info={<>
        <p>類股跟風格都在報酬的第二層：類股按公司做什麼生意分，風格按股票的特徵分。先看風格、再看類股，才判斷得出哪一塊是重複算到的。</p>
        <p>台股沒有對應 11 個類股的 ETF，改用證交所的類股報酬指數（含息），大盤用加權股價報酬指數，可以直接比（單元 3）。規則跟風格一樣：兩個數字、三種狀態；跟大盤幾乎一樣算中性，大盤為負時規則不變。</p>
        <p>圖的讀法跟風格相同。圓點是「排除最大權值股的等權籃子」（至少 5 家）：類股指數常被一家權值股主導，最大權值股占類股市值 {fmtNum(tw.top_weight_warn, 0)}% 以上時，名稱下方會寫出那一家與占比。橫條過了大盤、圓點卻沒過——這個類股的順風多半是那一家撐起來的。</p>
        <p>報酬太高的類股，橫條畫到最右邊為止（數字照實寫），否則其他列會擠在一起。</p>
        <p>類股是最粗的分法，用來看風向；量單一公司的 Alpha，尺要換成更貼近業務的同業籃子（個股分段）。「勝率高的區域」指的是研究時間的勝率，不保證挑中的那一家會漲。</p>
      </>}>
      <Conclusion>{piles.tail.length ? `順風 ${piles.tail.length} 個：${piles.tail.slice(0, 3).map((s) => s.key).join('、')}${piles.tail.length > 3 ? '…' : ''}` : '沒有順風的類股'}</Conclusion>
      {lone.length ? <p class="ds-line" data-testid="wind-dominated">排除最大權值股後不再順風：{lone.map((s) => `${s.key}（${s.top!.name} ${fmtNum(s.top!.w, 0)}%）`).join('、')}。這幾個的順風多半是那一家撐的。</p> : null}
      <Legend rm={rm} dot />
      <Piles items={items} scale={scale} kind="sector" onOpen={setSel} />
      <p class="ds-line">名稱下方：最大權值股與占比（{fmtNum(tw.top_weight_warn, 0)}% 以上才列），其餘是家數。點一列看細節與這個類股的股票。</p>
      <Sheet open={!!sec} onClose={() => setSel(null)} title={sec ? sec.key : ''}>
        {sec ? <SectorDetail s={sec} tw={tw} rows={rows} nameOf={nameOf} mkt={mkt} /> : null}
      </Sheet>
    </Section>
  );
}

function SectorDetail({ s, tw, rows, nameOf, mkt }: { s: WindSector; tw: Tailwind; rows: TagRow[]; nameOf: (c: string) => string; mkt: (number | null)[] }) {
  const cs = sectorCandidates(tw, rows, s.key);
  const pairs = sameWindPairs(tw, mkt).filter((p) => p.a === s.key || p.b === s.key);
  const ex = s.ex_top?.r12;
  return (
    <div data-testid="wind-sector-detail">
      <List>
        <Row label="狀態" subWide sub={s.state ? WIND_MEANING[s.state] : '還沒有足夠的資料'} value={<strong data-testid="wind-sector-state">{windLabel(s.state)}</strong>} />
      </List>
      <List>
        {tw.months.map((m) => (
          <Row key={m} label={`近 ${m} 個月`} value={pct(s.r[String(m)])} value2={`大盤 ${fmtPct(tw.market.r[String(m)])}`} />
        ))}
      </List>
      <List>
        {s.top ? <Row label="最大權值股" sub={`占這個類股的市值 ${fmtNum(s.top.w, 0)}%`} value={s.top.name} href={`#/stock/${s.top.code}`} /> : null}
        {ex !== null && ex !== undefined ? (
          <Row label="排除最大權值股" sub={`其餘 ${s.ex_top!.n} 家等權・${windLabel(windState(ex, tw.market.r['12'], tw.near_pp))}`} value={pct(ex)} value2="近 12 個月" />
        ) : null}
        {s.w !== null ? <Row label="占大盤（上市）" value={<Num v={s.w} digits={s.w < 1 ? 1 : 0} unit="%" />} /> : null}
        {pairs.length ? <Row label="同步的順風類股" subWide sub={`${pairs.map((p) => `${p.a === s.key ? p.b : p.a}（相關 ${fmtNum(p.corr, 2)}）`).join('、')}：可能是同一陣風`} /> : null}
      </List>
      <p class="ds-line">指數：{s.index}（證交所，含息）。</p>
      {cs.length ? (
        <>
          <p class="ds-line" data-testid="wind-sector-examples">例：{examples(cs, nameOf)}（依市值；依規則產生，非推薦）</p>
          <Button variant="fill" block href={pickHref('sector', s.key)} testid="wind-sector-pick">看這個類股的股票（{cs.length} 檔）</Button>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- 同一陣風

function SameWindSection({ tw, f }: { tw: Tailwind; f: AttrFactors }) {
  const [all, setAll] = useState(false);
  const withW = tw.styles.filter((s) => s.weights && s.weights.rows.length);
  const pairs = sameWindPairs(tw, f.mkt);
  const isTail = (s: WindStyle) => styleNow(s, tw).state === 'tail';
  const hit = (s: WindStyle) => isTail(s) && overweights(s, tw).some((o) => o.state === 'tail');
  const hits = withW.filter(hit);
  const tails = withW.filter(isTail);
  const rest = withW.filter((s) => !isTail(s));
  const shown = all || !tails.length ? withW : tails;
  const date = withW[0]?.weights?.date;
  return (
    <Section title="同一陣風" testid="wind-same" aside={date ? `持股 ${md(date)}` : undefined}
      info={<>
        <p>風格順風和類股順風常常是同一陣風：風格 ETF 如果多配了某個類股，而那個類股剛好在漲，風格贏大盤的那一段有一部分就是類股在推。一家公司兩個狀態都順風，不代表它有兩份風幫忙。</p>
        <p>做法：把風格 ETF 的類股權重（投信公布的持股）跟大盤並排，找出超配最多的兩三個類股，對照類股的順風名單。超配的類股也順風＝同一陣風；超配的類股是中性或逆風＝不同陣風，風格的順風比較像是特徵本身被獎勵。</p>
        <p>粗略的拆法（Brinson 配置效果的簡化）：每個類股算（ETF 權重 − 大盤權重）×（類股報酬 − 大盤報酬），加總就是「類股配置」那一塊，剩下的「其他」比較接近特徵本身。它是近似值：權重用現在的、報酬用過去 12 個月的，也沒有算 ETF 在類股裡挑到比較好的公司。</p>
        <p>順風的類股之間也要問是不是同一陣風：看兩個類股相對大盤的月報酬是不是高度同步（相關 ≥ {fmtNum(tw.same_wind_corr, 1)}），再問說不說得出共同的驅動變數——收入是不是最終來自同一群客戶的同一筆支出。說得出來才算判斷，說不出來只是聯想。</p>
        <p>數字都是百分點：超配＝ETF 權重 − 大盤權重。</p>
      </>}>
      <Conclusion>
        {!withW.length ? '持股資料累積中（每週更新一次）'
          : hits.length ? `${hits.map((s) => s.label).join('、')}的順風有一部分是類股在推`
            : tails.length ? '順風的風格沒有超配順風的類股' : '沒有順風的風格'}
      </Conclusion>
      {withW.length ? (
        <List tags testid="wind-same-rows">
          {shown.map((s) => {
            const ow = overweights(s, tw);
            const sp = allocSplit(s, tw);
            return (
              <Row key={s.key} label={<>{s.label}<span class="ui-muted"> {s.etf}</span></>} subWide testid={`wind-same-${s.key}`}
                tag={isTail(s) ? <Tag tone={hit(s) ? 'strong' : 'neutral'}>{sameWindLabel(hit(s))}</Tag> : <span />}
                sub={<span class="wind-lines">
                  {sp ? <span>比大盤 {signed(sp.excess * 100, 1)}＝類股配置 {signed(sp.alloc * 100, 1)}＋其他 {signed(sp.rest * 100, 1)}</span> : null}
                  <span>超配：{ow.length ? ow.slice(0, 2).map((o) => `${o.s} ${signed(o.d, 0)}${o.state ? `（${WIND_TEXT[o.state]}）` : ''}`).join('、') : '沒有'}</span>
                </span>} />
            );
          })}
        </List>
      ) : <List><Row label="還沒有風格 ETF 的持股" subWide sub="投信公布的申購買回清單，每週抓一次；有資料後自動顯示" /></List>}
      {tails.length && rest.length ? (
        <button type="button" class="text-btn" onClick={() => setAll(!all)} data-testid="wind-same-more">{all ? '只看順風的風格' : `顯示其餘 ${rest.length} 種風格`}</button>
      ) : null}
      {pairs.length ? (
        <>
          <p class="wind-pile-h ui-foot"><strong>順風的類股之間</strong><span class="ui-muted">・相對大盤的月報酬高度同步</span></p>
          <List testid="wind-pairs">
            {pairs.slice(0, 6).map((p) => (
              <Row key={`${p.a}-${p.b}`} label={`${p.a} × ${p.b}`} value={<>相關 <Num v={p.corr} digits={2} /></>} />
            ))}
          </List>
        </>
      ) : <p class="ds-line" data-testid="wind-pairs">順風的類股之間：沒有高度同步的組合（相關都低於 {fmtNum(tw.same_wind_corr, 1)}）。</p>}
      <p class="ds-line">同步只是線索，還要說得出共同的驅動變數。</p>
    </Section>
  );
}

// ---------------------------------------------------------------- 下一步：找股票

/** 從順風的類型直接列出幾檔例子，點進去到「找股票」（課程單元 2：從順風的類型找名單） */
function NextSection({ tw, rows, nameOf }: { tw: Tailwind; rows: TagRow[]; nameOf: (c: string) => string }) {
  const [more, setMore] = useState(false);
  const styles = tw.styles.filter((s) => styleNow(s, tw).state === 'tail');
  const sectors = byState(tw.sectors).tail;
  const shown = more ? sectors : sectors.slice(0, 3);
  return (
    <Section title="下一步：找股票" testid="wind-next"
      info={<>
        <p>名單優先從兩個圈的交集找：你看得懂的公司（能力圈），以及目前順風的類型（單元 2）。做法是打開順風類型的清單，圈出落在能力圈裡的公司；本來就想研究的公司，查它屬於哪一類。</p>
        <p>風格的清單＝那一檔風格 ETF 的持股（可以再加上特徵也屬於這一類的公司）；類股的清單＝同產業的公司。例子依 ETF 權重或市值排列，是依規則產生的，不是推薦。</p>
        <p>順風只說明這一類過去 12 個月被市場獎勵，用來排研究時間的先後；現在貴不貴、公司好不好，要另外研究。</p>
      </>}>
      <Conclusion>{styles.length || sectors.length ? '從順風的類型裡，挑看得懂的公司' : '目前沒有順風的類型'}</Conclusion>
      <List chev testid="wind-next-rows">
        {styles.map((s) => {
          const cs = styleCandidates(tw, rows, s.key);
          return <Row key={s.key} label={<>{s.label}<span class="ui-muted"> 風格・{s.etf} 持股 {cs.length} 檔</span></>} subWide sub={cs.length ? `例：${examples(cs, nameOf)}` : '清單累積中'} href={pickHref('style', s.key)} testid={`wind-next-style-${s.key}`} />;
        })}
        {shown.map((s) => {
          const cs = sectorCandidates(tw, rows, s.key);
          return <Row key={s.key} label={<>{s.key}<span class="ui-muted"> 類股・{cs.length} 檔</span></>} subWide sub={cs.length ? `例：${examples(cs, nameOf)}` : '清單累積中'} href={pickHref('sector', s.key)} testid={`wind-next-sector-${s.key}`} />;
        })}
      </List>
      {sectors.length > 3 ? (
        <button type="button" class="text-btn" onClick={() => setMore(!more)} data-testid="wind-next-more">{more ? '只看前 3 個類股' : `顯示全部 ${sectors.length} 個順風類股`}</button>
      ) : null}
      <List chev>
        <Row label="我的名單" subWide sub="自選的每一檔：風格與類股各是什麼狀態" href={pickHref('list')} testid="wind-next-list" />
      </List>
      <p class="ds-line">例子依 ETF 權重或市值排列。依規則產生，非推薦。</p>
    </Section>
  );
}

// ---------------------------------------------------------------- 更多（收起來的三件事）

function MoreSection({ tw, f }: { tw: Tailwind; f: AttrFactors }) {
  const [open, setOpen] = useState<'limits' | 'try' | 'factor' | null>(null);
  return (
    <Section title="更多" testid="wind-more">
      <List chev>
        <Row label="這個檢查不做的事" sub="不預測、不當進場時機" onClick={() => setOpen('limits')} testid="wind-more-limits" />
        <Row label="自己算一次" sub="其他市場：填兩個數字" onClick={() => setOpen('try')} testid="wind-more-try" />
        <Row label="對照：多空因子" sub="自建的學術版因子" onClick={() => setOpen('factor')} testid="wind-more-factor" />
      </List>
      <Sheet open={open === 'limits'} onClose={() => setOpen(null)} title="這個檢查不做的事">
        <div data-testid="wind-limits">
          <List>
            <Row label="不預測下一個順風的類型" subWide sub="風向會同時反轉；檢查只說現在的狀態" />
            <Row label="不因為逆風就把一整類丟掉" subWide sub="逆風的類型可以研究：先假設市場知道一些你不知道的事，論述要求更高" />
            <Row label="不當進場時機" subWide sub="順風代表過去 12 個月漲得多；現在貴不貴是估值的問題" />
            <Row label="不把市場的說法當已知" subWide sub="類股漲了一定有一套解釋，多半是漲了以後才出現；寫下來當成要驗證的假設" />
          </List>
          <div class="ui-prose">
            <p>因子過去一年賺錢，接下來的平均表現比較好（Ehsani & Linnainmaa 2022）；同一份研究裡，有用的是「避開過去一年賠錢的因子」，完整的多空擇時並沒有贏過放著不動。所以這裡只拿它排研究的優先順序。</p>
            <p>產業也有動能（Moskowitz & Grinblatt 1999），但有一大部分可以用因子動能解釋：一個產業的公司常常共用同一種特徵。景氣循環推類股輪動的說法多半是事後才對得上。</p>
            <p>研究的樣本是美國與已開發市場的多空因子組合，不是台股的作多 ETF；歷史統計不代表未來報酬。</p>
          </div>
        </div>
      </Sheet>
      <Sheet open={open === 'try'} onClose={() => setOpen(null)} title="自己算一次">
        <TryIt near={tw.near_pp} />
      </Sheet>
      <Sheet open={open === 'factor'} onClose={() => setOpen(null)} title="對照：多空因子" detent="full">
        <FactorReference f={f} />
      </Sheet>
    </Section>
  );
}

// ---------------------------------------------------------------- 自己算一次

function TryIt({ near }: { near: number }) {
  const [a, setA] = useState('24');
  const [b, setB] = useState('20');
  const num = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v) / 100);
  const st = windState(num(a), num(b), near);
  return (
    <div data-testid="wind-try">
      <Card>
        <div class="wind-try">
          <label class="field"><span>這一類 12 個月（%）</span><input type="number" inputMode="decimal" value={a} onInput={(e) => setA((e.target as HTMLInputElement).value)} data-testid="wind-try-a" /></label>
          <label class="field"><span>同期大盤（%）</span><input type="number" inputMode="decimal" value={b} onInput={(e) => setB((e.target as HTMLInputElement).value)} data-testid="wind-try-b" /></label>
        </div>
        <p class="wind-try-out" data-testid="wind-try-out" role="status">{st ? <><strong>{WIND_TEXT[st]}</strong>：{WIND_MEANING[st]}</> : '填入兩個數字'}</p>
      </Card>
      <p class="ds-line">其他市場（例如美股）可以自己查：到 ETF 發行商的網站查風格 ETF 或類股 ETF 過去 12 個月的含息報酬，再查同一個市場的大盤，兩個數字填進來。六個數字要用同一段期間；美股的跟美股大盤比，全球的跟全球大盤比。</p>
    </div>
  );
}

// ---------------------------------------------------------------- 對照：多空因子

function FactorReference({ f }: { f: AttrFactors }) {
  const [sel, setSel] = useState<AttrFactorKey>('umd');
  const trends = FACTOR_KEYS.map((k) => factorTrend(f, k));
  const max = Math.max(0.01, ...trends.map((t) => Math.abs(t.r12 ?? 0)));
  const up = trends.filter((t) => t.tailwind === true).map((t) => FACTOR_SHORT[t.key]);
  const down = trends.filter((t) => t.tailwind === false).map((t) => FACTOR_SHORT[t.key]);
  // 用詞跟風格、類股一致：近 12 個月為正＝順風、為負＝逆風（多空組合沒有大盤那一層，所以沒有中性）
  const vm = factorCorr(f, 'hml', 'umd');
  const last24 = f.months.slice(-24);
  const off = f.months.length - last24.length;
  const cur = trends.find((t) => t.key === sel);
  return (
    <>
      <Section title="對照：多空因子" testid="attr-trends" aside={f.months[f.months.length - 1]}
        info={<>
          <p>學術上的因子是多空組合：每月底依特徵把股票分組，高特徵那一籃的報酬減掉低特徵那一籃。大盤的漲跌在一多一空之間抵消，剩下的才是特徵本身的報酬。這是本工具用台股公開資料自建的版本，查不到、也沒有對應的商品。</p>
          <p>風格 ETF 只有作多的那一半，所以要多問「有沒有贏過大盤」；這裡已經沒有大盤，只看自己近 12 個月是正是負（Ehsani & Linnainmaa 2022 的自身趨勢）：為正＝順風、為負＝逆風，沒有中性。兩邊結論不同時，多半是 ETF 混了別的條件或多配了某個類股。</p>
          <p>一個因子連續落後兩三年，不能直接解讀成它消失了。價值與動能長期負相關、可以互補，但這個相關會跟著價值因子自己的狀態改變。</p>
        </>}>
        <Conclusion>{up.length ? `順風：${up.join('、')}` : '沒有順風的因子'}{down.length ? `・逆風：${down.join('、')}` : ''}</Conclusion>
        <List class="attr-bars" testid="attr-trend-rows">
          {trends.map((t) => (
            <BarRow key={t.key} name={FACTOR_SHORT[t.key]} sub={t.tailwind === null ? '資料不足' : t.tailwind ? '順風' : '逆風'}
              bar={{ kind: 'diverging', value: t.r12, max }} value={pct(t.r12)}
              valueSub={<>3 月 {pct(t.r3)}</>} onClick={() => setSel(t.key)}
              label={`${FACTOR_SHORT[t.key]} 近 12 個月 ${fmtPct(t.r12)}`} testid={`attr-trend-${t.key}`} />
          ))}
        </List>
        <p class="ds-line">數值為近 12 個月（多空組合）：為正＝順風、為負＝逆風。點一列看每個月的報酬。</p>
      </Section>
      <Section title={`${FACTOR_SHORT[sel]}因子`} testid="attr-factor-chart">
        <Conclusion>近 1 個月 {pct(cur?.r1)}・近 3 個月 {pct(cur?.r3)}・近 12 個月 {pct(cur?.r12)}</Conclusion>
        <p class="ds-line">{FACTOR_DEF[sel]}</p>
        <Card>
          <BarSeries label={`${FACTOR_SHORT[sel]}因子近 24 個月月報酬（%）`} dates={last24.map((m) => `${m}-01`)} signed words={['為正', '為負']} unit="%" height={130}
            dateFormat={(d) => d.slice(0, 7)}
            stacks={[{ id: sel, name: FACTOR_SHORT[sel], color: 'var(--up)', values: last24.map((_, i) => toPct(f.f[sel][off + i])) }]}
            format={(v) => fmtNum(v, 0)} />
        </Card>
        <p class="ds-line">資料起點 {f.start[sel] ?? '—'}；每月底依特徵把樣本股（期初近 60 日成交值最低的 {fmtNum(f.liquidity_pctile, 0)}% 不列入，約 {fmtNum(f.universe[f.universe.length - 1] ?? 0, 0)} 檔）以市值中位數 × 特徵 30／70 百分位分成 6 組，下個月等權報酬：高特徵兩組平均 − 低特徵兩組平均。</p>
        <List testid="attr-factor-corr">
          <Row label="價值與動能的相關" sub="月報酬；跨市場研究中兩者通常負相關" value={<Num v={vm} digits={2} />} />
        </List>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- 個股頁：兩個狀態

/** 個股拆解裡的「兩個狀態」：所屬風格 × 所屬類股、3×3 矩陣的位置、五種特徵 */
export function StockWindSection({ tw, s, code }: { tw: Tailwind; s: AttrStock; code: string }) {
  const sw = stockWind(tw, s);
  const rm = tw.market.r['12'];
  const list = stockStyles(tw, s);
  const cell = sw.cell ?? matrixCell(null, null);
  const styleLine = (): ComponentChildren => {
    if (!sw.style) return '五種特徵都不突出，也不在風格 ETF 的持股裡';
    const now = styleNow(sw.style, tw);
    return <>{sw.style.etf} {fmtPct(now.r)}・大盤 {fmtPct(now.rm)}{now.provisional ? '（未滿 12 個月）' : ''}</>;
  };
  return (
    <Section title="兩個狀態" testid="attr-wind-stock"
      info={<>
        <p>報酬的第二層有兩種分組：風格（股票的特徵）與類股（公司做什麼生意）。一家公司只在一個類股，但可以同時屬於幾種風格。先看這兩邊的風向，再看公司自己（單元 2、3）。</p>
        <p>順風＝那一類過去 12 個月自己賺錢且贏大盤；中性＝賺錢但輸大盤；逆風＝賠錢。風格看風格 ETF，類股看證交所類股報酬指數。</p>
        <p>兩邊都順風不等於兩份優勢：風格 ETF 如果超配這個類股，是同一陣風；沒有超配，是不同陣風。兩邊方向相反時（例如類股順風、風格逆風），類股的風可能幫不到它，因為市場在那個類股裡獎勵的是另一種特徵。</p>
        <p>看到一檔股票很強，先問它所屬的那一類是不是都很強；如果是，這份強勢屬於第二層，換一檔同類型的股票也拿得到。</p>
      </>}>
      <Conclusion>{cell ? cell.text : '沒有風格與類股的資料'}</Conclusion>
      <List tags testid="attr-wind-rows">
        <Row label={<>風格：{sw.style ? sw.style.label : '不突出'}</>} sub={styleLine()} tag={<WindTag state={sw.styleState} provisional={sw.provisional} />} />
        <Row label={<>類股：{sw.sector ? sw.sector.key : s.sector ?? '沒有類股指數'}</>}
          sub={sw.sector ? <>類股指數 {fmtPct(sw.sector.r['12'])}・大盤 {fmtPct(rm)}{sw.sector.ex_top ? `・排除最大權值股 ${fmtPct(sw.sector.ex_top.r12)}` : ''}</> : '這個產業沒有證交所的類股報酬指數'}
          tag={<WindTag state={sw.sectorState} />} />
        {sw.sameWind ? (
          <Row label="兩邊都順風" tag={<Tag tone={sw.sameWind.same ? 'strong' : 'neutral'}>{sameWindLabel(sw.sameWind.same)}</Tag>}
            sub={sw.sameWind.same ? `${sw.sameWind.etf} 超配這個類股 ${fmtNum(sw.sameWind.d, 0)} 個百分點，兩個順風有一部分重疊` : `${sw.sameWind.etf} 沒有超配這個類股（低配 ${fmtNum(Math.abs(sw.sameWind.d), 0)} 個百分點）`} />
        ) : null}
      </List>
      <p class="ds-line attr-layer">屬於哪幾種風格（特徵在樣本內的百分位）</p>
      <List tags testid="attr-style-rows">
        {list.map((x) => {
          const st = tw.styles.find((t) => t.key === x.key)!;
          return (
            <Row key={x.key} label={st.label} value={x.pct === null ? '—' : <Num v={x.pct} digits={0} />}
              sub={x.held !== null ? `在 ${st.etf} 持股裡（${fmtNum(x.held, 1)}%）` : st.char ?? undefined}
              tag={x.belongs ? <Tag tone="strong">{x.key === s.main ? '主要' : '屬於'}</Tag> : <span />} />
          );
        })}
      </List>
      <List chev>
        <Row label="風向" sub="五種風格與各類股目前的狀態" href={`#/explore/attribution?seg=wind&code=${encodeURIComponent(code)}`} testid="attr-to-wind" />
        {sw.sector ? <Row label={`${sw.sector.key}的股票`} sub="同一個類股裡，各檔的風格狀態" href={pickHref('sector', sw.sector.key)} testid="attr-to-sector" /> : null}
      </List>
    </Section>
  );
}
