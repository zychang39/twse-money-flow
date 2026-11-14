/**
 * 探索 › 報酬拆解 › 順風檢查（2026-11-13；#/explore/attribution?seg=wind）。
 * 依 Freddy〈法人級選股實戰〉單元 2「因子動能選股」、單元 3「類股輪動分析」的做法（只取方法，說明用自己的話寫）：
 * 風格 ETF 與類股報酬指數當溫度計，每一類查兩個數字、分成順風／中性／逆風；風格與類股的順風常是同一陣風；
 * 自選的每一檔標兩個狀態。定義見 METHODOLOGY §4.12.2；計算 lib/tailwind、pipeline/derive/tailwind.py。
 * 用途是排研究的優先順序，不是進出場訊號；不使用買進／賣出字眼。
 */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { BarRow } from '../components/BarRows';
import { Conclusion } from '../components/kit';
import { BarSeries } from '../components/SeriesChart';
import { Card, List, Num, Row, Section, Signed, Tag } from '../components/ui';
import { loadAttrTags, loadSummary } from '../data/api';
import type { AttrFactorKey, AttrFactors, AttrStock, StyleKey, Tailwind, WindSector, WindState, WindStyle } from '../data/types';
import { useUser } from '../data/useUser';
import { useAsync } from '../hooks';
import { FACTOR_KEYS, FACTOR_SHORT, STYLE_LABEL, factorCorr, factorTrend } from '../lib/attribution';
import { fmtNum, md } from '../lib/format';
import {
  WIND_MEANING, WIND_ORDER, WIND_TEXT, allocSplit, biggestUnderweight, byState, changed, dominated, matrixCell, overweights,
  sameWindPairs, stockStyles, stockWind, styleNow, windState,
} from '../lib/tailwind';

const pct = (v: number | null | undefined, d = 1) => <Signed v={v === null || v === undefined ? null : v * 100} digits={d} unit="%" />;
const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? '無資料' : `${v >= 0 ? '+' : '−'}${fmtNum(Math.abs(v * 100), 1)}%`);
/** 帶號數字（百分點；負號用全形減號） */
const signed = (v: number, d: number) => `${v >= 0 ? '+' : '−'}${fmtNum(Math.abs(v), d)}`;
const toPct = (v: number | null | undefined) => (v === null || v === undefined ? null : v * 100);
const FACTOR_DEF: Record<AttrFactorKey, string> = {
  smb: '小型股 − 大型股（市值中位數分兩組）',
  hml: '便宜 − 昂貴（淨值市價比 30／70 百分位）',
  umd: '近一年強勢 − 弱勢（12−1 個月報酬）',
  rmw: '高 ROE − 低 ROE（財報公布期限後才用）',
  lv: '低波動 − 高波動（近一年日報酬標準差）',
};

/** 狀態標籤：順風用強調字、逆風用一般字（紅綠只給漲跌、琥珀只給風險，狀態不用顏色） */
export function WindTag({ state, provisional = false }: { state: WindState | null; provisional?: boolean }) {
  if (!state) return <Tag>—</Tag>;
  return <Tag tone={state === 'tail' ? 'strong' : 'neutral'} testid={`wind-${state}`}>{WIND_TEXT[state]}{provisional ? '（暫定）' : ''}</Tag>;
}

const src = (st: WindStyle): string => {
  if (st.source === 'spliced') return `${md(st.listed ?? '')} 掛牌，之前以追蹤的報酬指數補上`;
  if (st.source === 'index') return '這裡沒有這檔 ETF 的行情，以追蹤的報酬指數代替';
  return 'ETF 還原價（含息）';
};

export function WindPane({ f, tw }: { f: AttrFactors; tw: Tailwind }) {
  const rm = tw.market.r['12'];
  const styles = tw.styles.map((st) => ({ st, now: styleNow(st, tw) }));
  const tailStyles = styles.filter((x) => x.now.state === 'tail');
  const piles = byState(tw.sectors);
  const moved = [...changed(tw.styles).map((x) => `${x.label}（${WIND_TEXT[x.prev!]}→${WIND_TEXT[x.state!]}）`), ...changed(tw.sectors).map((x) => `${x.key}（${WIND_TEXT[x.prev!]}→${WIND_TEXT[x.state!]}）`)];
  const same = styles.flatMap(({ st, now }) => (now.state === 'tail' ? overweights(st, tw).filter((o) => o.state === 'tail').map((o) => `${st.label} × ${o.s}`) : []));
  return (
    <div class="seg-pane" data-testid="attr-wind">
      <p class="ds-line" data-testid="wind-asof">資料至 {md(tw.date)}・過去 12 個月的含息報酬・ETF 與指數只是溫度計</p>

      <Section title="每月檢查" testid="wind-steps"
        info={<>
          <p>選公司之前，先確認它所屬的那一類股票現在有沒有被市場獎勵。這一步最便宜：查幾個數字，一個月做一次就夠（單元 2、3 的每月 30 分鐘）。</p>
          <p>做法：① 查大盤過去 12 個月的含息報酬 ② 查五種風格 ③ 查各類股 ④ 看順風的風格 ETF 超配哪些類股（同一陣風不重複算）⑤ 更新名單上每家公司的兩個狀態。這一頁把五步都算好了，往下逐段對照。</p>
          <p>三個提醒：固定每月同一天做；用含息報酬（只看股價會低估配息高的類型）；大盤的尺選定一把就不換。狀態換了先記下來，回頭看受影響的公司；變化本身不是進出場的理由。</p>
          <p>用 12 個月：一個月的漲跌雜訊太多，三五年的贏家又是不該追的東西。</p>
        </>}>
        <Conclusion>大盤 {pct(rm)}・風格順風 {tailStyles.length} 種・類股順風 {piles.tail.length} 個</Conclusion>
        <List testid="wind-step-rows">
          <Row label="① 大盤" sub={tw.market.name} value={pct(rm)} value2={tw.market.etf ? <>{tw.market.etf.code} {pct(tw.market.etf.r['12'])}</> : undefined} />
          <Row label="② 五種風格" subWide sub={WIND_ORDER.map((k) => `${WIND_TEXT[k]}：${styles.filter((x) => x.now.state === k).map((x) => x.st.label + (x.now.provisional ? '（暫定）' : '')).join('、') || '無'}`).join('・')} />
          <Row label="③ 類股" subWide sub={WIND_ORDER.map((k) => `${WIND_TEXT[k]} ${piles[k].length}`).join('・')} />
          <Row label="④ 同一陣風" subWide sub={same.length ? same.join('、') : tailStyles.some((x) => x.st.weights) ? '順風的風格 ETF 超配的類股都不在順風名單上' : '沒有順風的風格，或持股資料累積中'} />
          <Row label="⑤ 跟上個月底比" subWide sub={moved.length ? `換了狀態：${moved.join('、')}` : `沒有換狀態的類型${tw.prev_date ? `（上個月底 ${md(tw.prev_date)}）` : ''}`} />
        </List>
      </Section>

      <StyleSection tw={tw} />
      <SectorSection tw={tw} />
      <SameWindSection tw={tw} f={f} />
      <WatchSection tw={tw} />
      <TryIt near={tw.near_pp} />

      <Section title="這個檢查不做的事" testid="wind-limits"
        info={<>
          <p>因子過去一年賺錢，接下來的平均表現比較好（Ehsani & Linnainmaa 2022）；同一份研究裡，有用的是「避開趨勢為負的因子」，完整的多空擇時並沒有贏過放著不動。所以這裡只拿它排研究的優先順序。</p>
          <p>產業也有動能（Moskowitz & Grinblatt 1999），但有一大部分可以用因子動能解釋：一個產業的公司常常共用同一種特徵。景氣循環推類股輪動的說法多半是事後才對得上。</p>
          <p>研究的樣本是美國與已開發市場的多空因子組合，不是台股的作多 ETF；歷史統計不代表未來報酬。</p>
        </>}>
        <List>
          <Row label="不預測下一個順風的類型" subWide sub="風向會同時反轉；檢查只說現在的狀態" />
          <Row label="不因為逆風就把一整類丟掉" subWide sub="逆風的類型可以研究：先假設市場知道一些你不知道的事，論述要求更高" />
          <Row label="不當進場時機" subWide sub="順風代表過去 12 個月漲得多；現在貴不貴是估值的問題" />
          <Row label="不把市場的說法當已知" subWide sub="類股漲了一定有一套解釋，多半是漲了以後才出現；寫下來當成要驗證的假設" />
        </List>
      </Section>

      <FactorReference f={f} />
    </div>
  );
}

// ---------------------------------------------------------------- 風格

function StyleSection({ tw }: { tw: Tailwind }) {
  const [sel, setSel] = useState<StyleKey>(tw.styles.find((s) => s.state === 'tail')?.key ?? tw.styles[0]?.key ?? 'value');
  const rm = tw.market.r['12'];
  const max = Math.max(0.01, Math.abs(rm ?? 0), ...tw.styles.map((s) => Math.abs(styleNow(s, tw).r ?? 0)));
  const st = tw.styles.find((s) => s.key === sel) ?? tw.styles[0];
  const tails = tw.styles.filter((s) => styleNow(s, tw).state === 'tail');
  return (
    <Section title="風格" testid="wind-styles" aside="12 個月"
      info={<>
        <p>風格 ETF 當溫度計（單元 2 對照表的台股那一欄）。每一檔要問兩個問題：它自己有沒有賺錢；有沒有贏過同一個市場的大盤。少問一個都會看錯：品質型漲 15%、大盤漲 20%，它是跟著大盤漲上來的，品質這個特徵反而是拖累。</p>
        <p>學術上的因子是「一籃作多、另一籃放空」的報酬差，大盤的漲跌抵消掉了；ETF 只有作多的那一半，報酬裡同時有大盤、它偏重的特徵、以及它剛好多配的產業。</p>
        <p>台股的風格 ETF 比較混，沒有一對一的對應：常常一檔混了好幾個條件（例如價值加高股息）。看名字不夠，要看追蹤的指數與選股規則。大盤的尺用發行量加權股價報酬指數；市值加權的大盤本身也不中性（台積電一家就占一大半）。</p>
        <p>順風＝自己賺錢且贏大盤（差距要超過 {fmtNum(tw.near_pp, 0)} 個百分點）；中性＝自己賺錢但輸大盤或幾乎一樣；逆風＝自己賠錢（大盤更差也不升級）。掛牌未滿 12 個月的 ETF，以有資料以來的同一段期間跟大盤比，標「暫定」。</p>
      </>}>
      <Conclusion>{tails.length ? `順風：${tails.map((s) => s.label).join('、')}` : '沒有順風的風格'}・大盤 {pct(rm)}</Conclusion>
      <List class="attr-bars wind-bars" testid="wind-style-rows">
        {tw.styles.map((s) => {
          const now = styleNow(s, tw);
          return (
            <BarRow key={s.key} name={s.label} sub={`${s.etf}・${now.provisional ? '暫定' : ''}${now.state ? WIND_TEXT[now.state] : '資料不足'}`}
              bar={{ kind: 'diverging', value: now.r, max }} value={pct(now.r)}
              valueSub={now.r !== null && now.rm !== null ? `比大盤 ${signed((now.r - now.rm) * 100, 1)}` : undefined}
              onClick={() => setSel(s.key)} label={`${s.label} ${s.etf} ${fmtPct(now.r)}，${now.state ? WIND_TEXT[now.state] : '資料不足'}`} testid={`wind-style-${s.key}`} />
          );
        })}
      </List>
      <p class="ds-line">每列第二行：跟大盤差幾個百分點。點一列看那一檔 ETF 的細節。</p>
      {st ? <StyleDetail st={st} tw={tw} /> : null}
    </Section>
  );
}

function StyleDetail({ st, tw }: { st: WindStyle; tw: Tailwind }) {
  const now = styleNow(st, tw);
  return (
    <div data-testid="wind-style-detail">
      <p class="ds-line attr-layer">{st.label}：{st.etf} {st.name ?? ''}</p>
      <List tags>
        <Row label="狀態" subWide sub={now.state ? WIND_MEANING[now.state] : '還沒有足夠的資料'} tag={<WindTag state={now.state} provisional={now.provisional} />} />
        {tw.months.map((m) => (
          <Row key={m} label={`近 ${m} 個月`} sub={st.r[String(m)] === null ? '資料累積中' : `大盤 ${fmtPct(tw.market.r[String(m)])}`}
            value={pct(st.r[String(m)])} tag={<span />} />
        ))}
        {st.since ? <Row label={`${md(st.since.start)} 以來`} sub={`未滿 12 個月・大盤 ${fmtPct(st.since.rm)}`} value={pct(st.since.r)} tag={<span />} /> : null}
        {st.alt ? <Row label={`${st.alt.code} ${st.alt.name}`} sub="同一格的另一檔（只對照）" value={pct(st.alt.r['12'])} tag={<span />} /> : null}
      </List>
      <p class="ds-line">{[st.mix, st.char ? `個股歸類看：${st.char}` : null, src(st), st.note].filter(Boolean).join('；')}。</p>
    </div>
  );
}

// ---------------------------------------------------------------- 類股

function SectorSection({ tw }: { tw: Tailwind }) {
  const piles = byState(tw.sectors);
  const [open, setOpen] = useState<Record<WindState, boolean>>({ tail: true, neutral: false, head: false });
  const rm = tw.market.r['12'];
  const max = Math.max(0.01, Math.abs(rm ?? 0), ...tw.sectors.map((s) => Math.min(1, Math.abs(s.r['12'] ?? 0))));
  const note: Record<WindState, string> = { tail: '風在吹，研究時間優先放這裡', neutral: '自己有賺，但跟不上大盤；可以研究，不急', head: '要研究就得逆著風做，論述要求更高' };
  const dom = piles.tail.filter((s) => dominated(s, tw));
  return (
    <Section title="類股" testid="wind-sectors" aside="12 個月"
      info={<>
        <p>類股跟風格都在報酬的第二層：類股按公司做什麼生意分，風格按股票的特徵分。先看風格、再看類股，才判斷得出哪一塊是重複算到的。</p>
        <p>台股沒有對應 11 個類股的 ETF，改用證交所的類股報酬指數（含息），大盤用加權股價報酬指數，可以直接比（單元 3）。規則跟風格一樣：兩個數字、三種狀態；跟大盤幾乎一樣算中性，大盤為負時規則不變。</p>
        <p>類股指數常被一家權值股主導：最大權值股占類股市值 {fmtNum(tw.top_weight_warn, 0)}% 以上時，類股的狀態反映的可能是那一家，不是那一類。所以另外算一個「排除最大權值股的等權籃子」（至少 5 家），兩個數字一起看。</p>
        <p>類股是最粗的分法，用來看風向；量單一公司的 Alpha，尺要換成更貼近業務的同業籃子（個股拆解）。「勝率高的區域」指的是研究時間的勝率，不保證挑中的那一家會漲。</p>
      </>}>
      <Conclusion>{piles.tail.length ? `順風 ${piles.tail.length} 個：${piles.tail.slice(0, 4).map((s) => s.key).join('、')}${piles.tail.length > 4 ? '…' : ''}` : '沒有順風的類股'}</Conclusion>
      {dom.length ? <p class="ds-line" data-testid="wind-dominated">順風名單裡由單一權值股主導的：{dom.map((s) => `${s.key}（${s.top!.name} 占 ${fmtNum(s.top!.w, 0)}%）`).join('、')}。看排除後的數字。</p> : null}
      {WIND_ORDER.map((k) => {
        const rows = open[k] ? piles[k] : piles[k].slice(0, 3);
        return (
          <div key={k} data-testid={`wind-pile-${k}`}>
            <p class="ds-line attr-layer">{WIND_TEXT[k]}（{piles[k].length}）：{note[k]}</p>
            {piles[k].length ? (
              <List class="attr-bars wind-bars">
                {rows.map((s) => <SectorRow key={s.key} s={s} max={max} />)}
              </List>
            ) : <List><Row label="沒有" /></List>}
            {piles[k].length > 3 ? (
              <button type="button" class="text-btn" onClick={() => setOpen({ ...open, [k]: !open[k] })} data-testid={`wind-pile-more-${k}`}>
                {open[k] ? '只看前 3 個' : `顯示全部 ${piles[k].length} 個`}
              </button>
            ) : null}
          </div>
        );
      })}
      <p class="ds-line">每列第二行：占大盤（上市）的權重；「排除後」＝排除最大權值股的等權籃子。指數為證交所類股報酬指數。</p>
    </Section>
  );
}

function SectorRow({ s, max }: { s: WindSector; max: number }) {
  const r = s.r['12'];
  const ex = s.ex_top?.r12;
  return (
    <BarRow name={s.key} sub={s.w !== null ? `占 ${fmtNum(s.w, s.w < 1 ? 1 : 0)}%` : `${s.n} 家`}
      bar={{ kind: 'diverging', value: r === null ? null : Math.max(-max, Math.min(max, r)), max }} value={pct(r)}
      valueSub={ex !== null && ex !== undefined ? <>排除後 {pct(ex)}</> : s.top ? `${s.top.name} ${fmtNum(s.top.w, 0)}%` : undefined}
      label={`${s.key} ${fmtPct(r)}${ex !== null && ex !== undefined ? `，排除最大權值股後 ${fmtPct(ex)}` : ''}`} testid={`wind-sector-${s.key}`} />
  );
}

// ---------------------------------------------------------------- 同一陣風

function SameWindSection({ tw, f }: { tw: Tailwind; f: AttrFactors }) {
  const withW = tw.styles.filter((s) => s.weights && s.weights.rows.length);
  const pairs = sameWindPairs(tw, f.mkt);
  const hits = withW.filter((s) => styleNow(s, tw).state === 'tail' && overweights(s, tw).some((o) => o.state === 'tail'));
  const date = withW[0]?.weights?.date;
  return (
    <Section title="同一陣風" testid="wind-same" aside={date ? `持股 ${md(date)}` : undefined}
      info={<>
        <p>風格順風和類股順風常常是同一陣風：風格 ETF 如果多配了某個類股，而那個類股剛好在漲，風格贏大盤的那一段有一部分就是類股在推。一家公司兩個狀態都順風，不代表它有兩份風幫忙。</p>
        <p>做法：把風格 ETF 的類股權重（投信公布的持股）跟大盤並排，找出超配最多的兩三個類股，對照類股的順風名單。超配的類股在順風名單上＝同一陣風；在中性或逆風名單上，風格的順風比較像是特徵本身被獎勵。</p>
        <p>粗略的拆法（Brinson 配置效果的簡化）：每個類股算（ETF 權重 − 大盤權重）×（類股報酬 − 大盤報酬），加總就是「類股配置帶來的」那一塊，剩下的比較接近特徵本身。它是近似值：權重用現在的、報酬用過去 12 個月的，也沒有算 ETF 在類股裡挑到比較好的公司。</p>
        <p>順風的類股之間也要問是不是同一陣風：看兩個類股相對大盤的月報酬是不是高度同步（相關 ≥ {fmtNum(tw.same_wind_corr, 1)}），再問說不說得出共同的驅動變數——收入是不是最終來自同一群客戶的同一筆支出。說得出來才算判斷，說不出來只是聯想。</p>
      </>}>
      <Conclusion>
        {!withW.length ? '持股資料累積中（每週更新一次）'
          : hits.length ? `${hits.map((s) => s.label).join('、')}的順風有一部分是類股在推`
            : '順風的風格沒有超配順風的類股'}
      </Conclusion>
      {withW.length ? (
        <List testid="wind-same-rows">
          {withW.map((s) => {
            const ow = overweights(s, tw);
            const un = biggestUnderweight(s, tw);
            const sp = allocSplit(s, tw);
            return (
              <Row key={s.key} label={<>{s.label}<span class="ui-muted"> {s.etf}</span></>} subWide testid={`wind-same-${s.key}`}
                sub={<span class="wind-lines">
                  <span>超配：{ow.length ? ow.map((o) => `${o.s} ${signed(o.d, 0)}${o.state ? `（${WIND_TEXT[o.state]}）` : ''}`).join('、') : '沒有'}</span>
                  {un ? <span>低配最多：{un.s} {signed(un.d, 0)}{un.state ? `（${WIND_TEXT[un.state]}）` : ''}</span> : null}
                  {sp ? <span>比大盤 {signed(sp.excess * 100, 1)}，其中類股配置約 {signed(sp.alloc * 100, 1)}</span> : null}
                </span>} />
            );
          })}
        </List>
      ) : <List><Row label="還沒有風格 ETF 的持股" subWide sub="投信公布的申購買回清單，每週抓一次；有資料後自動顯示" /></List>}
      <p class="ds-line attr-layer">順風的類股之間</p>
      <List testid="wind-pairs">
        {pairs.length ? pairs.slice(0, 6).map((p) => (
          <Row key={`${p.a}-${p.b}`} label={`${p.a} × ${p.b}`} sub="相對大盤的月報酬高度同步" value={<>相關 <Num v={p.corr} digits={2} /></>} />
        )) : <Row label="沒有高度同步的組合" subWide sub={`近 12 個月相對大盤的月報酬相關都低於 ${fmtNum(tw.same_wind_corr, 1)}`} />}
      </List>
      <p class="ds-line">數字都是百分點：超配／低配＝ETF 權重 − 大盤權重。同步只是線索，還要說得出共同的驅動變數。</p>
    </Section>
  );
}

// ---------------------------------------------------------------- 自選：兩個狀態

function WatchSection({ tw }: { tw: Tailwind }) {
  const user = useUser();
  const tags = useAsync(loadAttrTags, []);
  const summary = useAsync(loadSummary, []);
  const by = new Map((tags.data?.rows ?? []).map((r) => [r[0], r] as const));
  const watch = [...new Map((user?.watch ?? []).map((w) => [w.code, w] as const)).values()];
  const rows = watch.map((w) => {
    const t = by.get(w.code);
    const sw = t ? stockWind(tw, { main: t[1], sector: t[2] }) : null;
    return { code: w.code, name: (summary.data?.byCode.get(w.code)?.name as string | undefined) ?? w.code, sw, style: t?.[1] ?? null, sector: t?.[2] ?? null };
  });
  const tagged = rows.filter((r) => r.sw);
  const both = tagged.filter((r) => r.sw!.cell?.tone === 'prior').length;
  const against = tagged.filter((r) => r.sw!.cell?.tone === 'against' || r.sw!.cell?.tone === 'mixed').length;
  const count = new Map<string, number>();
  for (const r of tagged) if (r.sector) count.set(r.sector, (count.get(r.sector) ?? 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  const crowded = top && tagged.length >= 4 && top[1] > tagged.length / 2;
  return (
    <Section title="自選的兩個狀態" testid="wind-watch"
      info={<>
        <p>名單優先從兩個圈的交集找：你看得懂的公司（能力圈），以及目前順風的類型。每一家記下它屬於哪一種風格、哪一個類股，各自的狀態，以及兩個都順風時是不是同一陣風（單元 2、3 的作業 1）。</p>
        <p>風格的歸類：五種特徵（淨值市價比、ROE、近 12 個月報酬、市值、波動）在樣本內的百分位 ≥ {fmtNum(tw.style_pct, 0)}，或出現在那一檔風格 ETF 的持股裡；取最突出的一種當主要風格。五種都不突出就只看類股。</p>
        <p>數量抓 10 家上下。超過一半集中在同一個類股，這份名單實質上是在押一陣風；寫得出理由就留著，寫不出來就刻意補進其他類股。狀態只決定研究時間先花在誰身上，離任何決定都還很遠。</p>
      </>}>
      <Conclusion>
        {!watch.length ? '還沒有自選'
          : `${watch.length} 檔：兩邊都順風 ${both}・逆著風 ${against}`}
      </Conclusion>
      {crowded ? <p class="ds-line" data-testid="wind-crowded">{top[1]}／{tagged.length} 檔在「{top[0]}」：這份名單押的是同一陣風，那陣風停了會一起停。</p> : null}
      <List chev testid="wind-watch-rows">
        {rows.length ? rows.map((r) => (
          <Row key={r.code} label={<>{r.name}<span class="ui-muted"> {r.code}</span></>} subWide href={`#/stock/${r.code}/m/attribution`}
            sub={r.sw ? <>
              {r.style ? `${STYLE_LABEL[r.style]} ${r.sw.styleState ? WIND_TEXT[r.sw.styleState] : '—'}${r.sw.provisional ? '（暫定）' : ''}` : '風格不突出'}
              {' × '}
              {r.sector ? `${r.sector} ${r.sw.sectorState ? WIND_TEXT[r.sw.sectorState] : '—'}` : '沒有類股指數'}
              {r.sw.sameWind ? (r.sw.sameWind.same ? '・同一陣風' : '・比較像兩陣風') : ''}
            </> : '沒有資料（只算普通股）'} />
        )) : <Row label="把想研究的公司加進自選" subWide sub="這裡會替每一檔標上風格與類股的狀態" href="#/mine" />}
      </List>
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
    <Section title="自己算一次" testid="wind-try"
      info={<p>其他市場（例如美股）可以自己查：到 ETF 發行商的網站查風格 ETF 或類股 ETF 過去 12 個月的含息報酬，再查同一個市場的大盤，兩個數字填進來。六個數字要用同一段期間；美股的跟美股大盤比，全球的跟全球大盤比。</p>}>
      <Card>
        <div class="wind-try">
          <label class="field"><span>這一類 12 個月（%）</span><input type="number" inputMode="decimal" value={a} onInput={(e) => setA((e.target as HTMLInputElement).value)} data-testid="wind-try-a" /></label>
          <label class="field"><span>同期大盤（%）</span><input type="number" inputMode="decimal" value={b} onInput={(e) => setB((e.target as HTMLInputElement).value)} data-testid="wind-try-b" /></label>
        </div>
        <p class="wind-try-out" data-testid="wind-try-out" role="status">{st ? <><strong>{WIND_TEXT[st]}</strong>：{WIND_MEANING[st]}</> : '填入兩個數字'}</p>
      </Card>
    </Section>
  );
}

// ---------------------------------------------------------------- 對照：多空因子

function FactorReference({ f }: { f: AttrFactors }) {
  const [sel, setSel] = useState<AttrFactorKey>('umd');
  const trends = FACTOR_KEYS.map((k) => factorTrend(f, k));
  const max = Math.max(0.01, ...trends.map((t) => Math.abs(t.r12 ?? 0)));
  const up = trends.filter((t) => t.tailwind === true).map((t) => FACTOR_SHORT[t.key]);
  const down = trends.filter((t) => t.tailwind === false).map((t) => FACTOR_SHORT[t.key]);
  const vm = factorCorr(f, 'hml', 'umd');
  const last24 = f.months.slice(-24);
  const off = f.months.length - last24.length;
  const cur = trends.find((t) => t.key === sel);
  return (
    <>
      <Section title="對照：多空因子" testid="attr-trends" aside={f.months[f.months.length - 1]}
        info={<>
          <p>學術上的因子是多空組合：每月底依特徵把股票分組，高特徵那一籃的報酬減掉低特徵那一籃。大盤的漲跌在一多一空之間抵消，剩下的才是特徵本身的報酬。這是本工具用台股公開資料自建的版本，查不到、也沒有對應的商品。</p>
          <p>上面的風格 ETF 只有作多的那一半，所以要多問「有沒有贏過大盤」；這裡已經沒有大盤，只看自己近 12 個月是正是負（Ehsani & Linnainmaa 2022 的自身趨勢）。兩邊結論不同時，多半是 ETF 混了別的條件或多配了某個類股。</p>
          <p>一個因子連續落後兩三年，不能直接解讀成它消失了。價值與動能長期負相關、可以互補，但這個相關會跟著價值因子自己的狀態改變。</p>
        </>}>
        <Conclusion>{up.length ? `為正：${up.join('、')}` : '沒有為正的因子'}{down.length ? `・為負：${down.join('、')}` : ''}</Conclusion>
        <List class="attr-bars" testid="attr-trend-rows">
          {trends.map((t) => (
            <BarRow key={t.key} name={FACTOR_SHORT[t.key]} sub={t.tailwind === null ? '資料不足' : t.tailwind ? '趨勢為正' : '趨勢為負'}
              bar={{ kind: 'diverging', value: t.r12, max }} value={pct(t.r12)}
              valueSub={<>3 月 {pct(t.r3)}</>} onClick={() => setSel(t.key)}
              label={`${FACTOR_SHORT[t.key]} 近 12 個月 ${fmtPct(t.r12)}`} testid={`attr-trend-${t.key}`} />
          ))}
        </List>
        <p class="ds-line">數值為近 12 個月（多空組合）；點一列看每個月的報酬。</p>
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
        <p>兩個都順風不等於兩份優勢：風格 ETF 如果超配這個類股，是同一陣風。兩邊方向相反時（例如類股順風、風格逆風），類股的風可能幫不到它，因為市場在那個類股裡獎勵的是另一種特徵。</p>
        <p>看到一檔股票很強，先問它所屬的那一類是不是都很強；如果是，這份強勢屬於第二層，換一檔同類型的股票也拿得到。</p>
      </>}>
      <Conclusion>{cell ? cell.text : '沒有風格與類股的資料'}</Conclusion>
      <List tags testid="attr-wind-rows">
        <Row label={<>風格：{sw.style ? sw.style.label : '不突出'}</>} sub={styleLine()} tag={<WindTag state={sw.styleState} provisional={sw.provisional} />} />
        <Row label={<>類股：{sw.sector ? sw.sector.key : s.sector ?? '沒有類股指數'}</>}
          sub={sw.sector ? <>類股指數 {fmtPct(sw.sector.r['12'])}・大盤 {fmtPct(rm)}{sw.sector.ex_top ? `・排除最大權值股 ${fmtPct(sw.sector.ex_top.r12)}` : ''}</> : '這個產業沒有證交所的類股報酬指數'}
          tag={<WindTag state={sw.sectorState} />} />
        {sw.sameWind ? (
          <Row label="同一陣風？" tag={<Tag>{sw.sameWind.same ? '是' : '不像'}</Tag>}
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
        <Row label="順風檢查" sub="五種風格與各類股目前的狀態" href={`#/explore/attribution?seg=wind&code=${encodeURIComponent(code)}`} testid="attr-to-wind" />
      </List>
    </Section>
  );
}
