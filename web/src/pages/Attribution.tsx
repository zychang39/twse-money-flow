/**
 * 探索 › 報酬拆解（2026-10-27；#/explore/attribution?seg=&code=&p=）：一筆報酬有多少來自市場、多少來自你買的那一類股票、
 * 多少才跟選股判斷有關（市場 Beta → 因子與產業 → Alpha）。定義見 METHODOLOGY §4.12；計算 lib/attribution、pipeline/derive/attribution.py。
 * 分析方法，不是買賣建議；不使用買進／賣出字眼。
 */
import { useMemo, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { BarRow } from '../components/BarRows';
import { ErrorState } from '../components/DataStatus';
import { Conclusion } from '../components/kit';
import { BarSeries } from '../components/SeriesChart';
import { Sheet } from '../components/Sheet';
import { StockSearch } from '../components/StockSearch';
import { Card, List, Num, PageTitle, Row, Section, Seg, Signed, Tag } from '../components/ui';
import { loadAttrFactors, loadAttrStock, loadSummary } from '../data/api';
import type { AttrFactorKey, AttrFactors, AttrStock } from '../data/types';
import { useUser } from '../data/useUser';
import { useAsync, useSegParam } from '../hooks';
import {
  ATTR_PERIODS, type AttrPeriod, FACTOR_KEYS, FACTOR_SHORT, annualAlpha, decompose, exposureText, factorCorr, factorTrend,
  periodRange, rulerFit, rulers, yearsToTell,
} from '../lib/attribution';
import { fmtNum } from '../lib/format';
import { navigate, useRoute } from '../router';
import '../styles/etf.css';
import '../styles/explore.css';

const SEGS = [['stock', '個股拆解'], ['factor', '因子順逆風']] as const;
type AttrSeg = (typeof SEGS)[number][0];
const pct = (v: number | null | undefined, d = 1) => <Signed v={v === null || v === undefined ? null : v * 100} digits={d} unit="%" />;
const pp = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${fmtNum(Math.abs(v * 100), 1)} 個百分點`);
const FACTOR_DEF: Record<AttrFactorKey, string> = {
  smb: '小型股 − 大型股（市值中位數分兩組）',
  hml: '便宜 − 昂貴（淨值市價比 30／70 百分位）',
  umd: '近一年強勢 − 弱勢（12−1 個月報酬）',
  rmw: '高 ROE − 低 ROE（財報公布期限後才用）',
  lv: '低波動 − 高波動（近一年日報酬標準差）',
};

export default function Attribution() {
  const [seg, setSeg] = useSegParam<AttrSeg>(SEGS.map(([v]) => v), 'stock', 'seg', 'attr-seg');
  const factors = useAsync(loadAttrFactors, []);
  const f = factors.data ?? null;
  return (
    <div class="page" data-testid="attr-page">
      <TopBar back="/explore" />
      <PageTitle title="報酬拆解" sub="市場 Beta・因子與產業・Alpha" />
      <Seg options={SEGS} value={seg} onChange={setSeg} label="報酬拆解分段" sticky testid="attr-seg" />
      {factors.error ? <ErrorState error={factors.error} /> : !f && !factors.loading ? <p class="ds-line">資料累積中</p> : f ? (
        seg === 'stock' ? <StockPane f={f} /> : <FactorPane f={f} />
      ) : null}
      <p class="ds-line">分析方法與研究流程，不提供個股買賣建議。因子報酬來自本工具以公開資料自建的台股多空組合，與學術研究、市售 ETF 不同；歷史統計不代表未來報酬。</p>
    </div>
  );
}

// ---------------------------------------------------------------- 個股拆解

function StockPane({ f }: { f: AttrFactors }) {
  const route = useRoute();
  const user = useUser();
  const summary = useAsync(loadSummary, []);
  const [period, setPeriod] = useSegParam<AttrPeriod>(ATTR_PERIODS.map(([v]) => v), '12', 'p', 'attr-period');
  const [picking, setPicking] = useState(false);
  const code = route.query.get('code') ?? user?.watch[0]?.code ?? '2330';
  const s = useAsync(() => loadAttrStock(code), [code]);
  const nameOf = (c: string) => (summary.data?.byCode.get(c)?.name as string | undefined) ?? c;
  const pick = (c: string) => {
    const qs = new URLSearchParams(route.query);
    qs.set('code', c);
    navigate(`${route.path}?${qs.toString()}`, true, 'none');
    setPicking(false);
  };
  const idx = useMemo(() => periodRange(f, Number(period)), [f, period]);
  const from = idx.length ? f.months[idx[0]] : null;
  const to = idx.length ? f.months[idx[idx.length - 1]] : null;
  return (
    <div class="seg-pane" data-testid="attr-stock">
      <List chev>
        <Row label={<>{nameOf(code)}<span class="ui-muted"> {code}</span></>} sub="換一檔" onClick={() => setPicking(true)} testid="attr-pick" />
      </List>
      <Sheet open={picking} onClose={() => setPicking(false)} title="選一檔股票">
        <StockSearch rows={summary.data?.rows ?? []} onPick={(r) => pick(r.code)} autoFocus />
      </Sheet>
      <div class="mg-gap" />
      <Seg options={ATTR_PERIODS} value={period} onChange={setPeriod} label="期間" testid="attr-period" />
      <p class="ds-line" data-testid="attr-range">
        {from && to ? `${from}～${to}${f.partial ? '（最後一個月到最新交易日）' : ''}` : ''}
        {Number(period) < 6 ? '・持有期間太短：差距多半反映消息和情緒，至少放在幾個季度看' : ''}
      </p>
      {s.error ? <ErrorState error={s.error} /> : s.data === null && !s.loading ? (
        <p class="ds-line">這一檔沒有報酬拆解（只算普通股；上市未滿 24 個月或成交太少時無法估計）</p>
      ) : s.data ? <StockBody f={f} s={s.data} idx={idx} nameOf={nameOf} /> : null}
    </div>
  );
}

function StockBody({ f, s, idx, nameOf }: { f: AttrFactors; s: AttrStock; idx: number[]; nameOf: (c: string) => string }) {
  const r = rulers(f, s, idx);
  const d = decompose(f, s, idx);
  const maxR = Math.max(0.01, ...[r.stock, r.market, r.peer, r.style].map((v) => Math.abs(v ?? 0)));
  const lead = (b: number | null) => (r.stock !== null && b !== null ? r.stock - b : null);
  return (
    <>
      <Section title="三把尺" testid="attr-rulers"
        info={<>
          <p>同一筆報酬，換一把尺量，結論就不一樣。三把尺依序用下來，量到最後還剩下的，才是跟「這家公司」有關的報酬。</p>
          <p>大盤：發行量加權股價報酬指數（含息）。同業籃子：扣掉大盤後股價最常一起動的 5～10 家，等權（見下方「同業籃子」）。同風格：期初跟這檔同一組規模（小／中／大）× 價值（成長／中性／價值）的股票，等權。</p>
          <p>先選好尺再量，之後固定用同一把；期間用實際持有的期間，至少幾個季度。台股加權指數單一權值股比重很高，拿來當尺時解讀要打折。</p>
        </>}>
        <Conclusion>{r.peer !== null ? <>領先同業籃子 {pp(lead(r.peer))}</> : r.market !== null ? <>領先大盤 {pp(lead(r.market))}</> : '資料不足'}</Conclusion>
        <List class="attr-bars" testid="attr-ruler-rows">
          <BarRow name="這一檔" bar={{ kind: 'diverging', value: r.stock, max: maxR }} value={pct(r.stock)} label={`這一檔 ${fmtPct(r.stock)}`} />
          <BarRow name="大盤" sub="報酬指數" bar={{ kind: 'diverging', value: r.market, max: maxR }} value={pct(r.market)} valueSub={`差 ${pp(lead(r.market))}`} label={`大盤 ${fmtPct(r.market)}`} />
          <BarRow name="同業籃子" sub={s.peers ? `${s.peers.codes.length} 家` : '不足'} bar={{ kind: 'diverging', value: r.peer, max: maxR }} value={pct(r.peer)} valueSub={`差 ${pp(lead(r.peer))}`} label={`同業籃子 ${fmtPct(r.peer)}`} />
          <BarRow name="同風格" sub={r.styleLabel ?? '—'} bar={{ kind: 'diverging', value: r.style, max: maxR }} value={pct(r.style)} valueSub={`差 ${pp(lead(r.style))}`} label={`同風格 ${fmtPct(r.style)}`} />
        </List>
      </Section>

      {d ? <Layers f={f} s={s} d={d} /> : (
        <Section title="三層拆解"><p class="ds-line">估計 Beta 需要至少 {f.min_months} 個月的資料</p></Section>
      )}

      {s.capm ? (
        <Section title="模型與 Alpha" testid="attr-models"
          info={<>
            <p>Alpha 是相對於模型定義的：模型裡放進越多因子，剩下能叫 Alpha 的就越少（Jensen 1968、Carhart 1997、Frazzini 等 2018〈Buffett's Alpha〉）。</p>
            <p>月 Alpha × 12 為年化；t 值的絕對值 ≥ 2 大約是統計上顯著。R²＝模型能解釋的月報酬變動比例。</p>
          </>}>
          <Conclusion>{s.full ? <>加入產業與因子後，Alpha 由 {pct(annualAlpha(s.capm))} 變成 {pct(annualAlpha(s.full))}（年化）</> : '產業與因子的資料還不夠，只有 CAPM'}</Conclusion>
          <List>
            <Row label="只用市場（CAPM）" sub={`t 值 ${fmtT(s.capm.alpha_t)}・R² ${fmtR2(s.capm.r2)}`} value={pct(annualAlpha(s.capm))} />
            {s.full ? <Row label="加上產業與因子" sub={`t 值 ${fmtT(s.full.alpha_t)}・R² ${fmtR2(s.full.r2)}`} value={pct(annualAlpha(s.full))} /> : null}
          </List>
          <p class="ds-line">估計期間 {s.window ? `${s.window[0]}～${s.window[1]}（${s.capm.n} 個月）` : '—'}；β 用整段期間估一次，換一段期間數字會不同，當成估計值看。
            {s.dropped.length ? `資料起點太晚而沒放進模型：${s.dropped.map((k) => FACTOR_SHORT[k]).join('、')}。` : ''}</p>
        </Section>
      ) : null}

      {s.capm ? <Exposures s={s} /> : null}
      <PeerSection s={s} nameOf={nameOf} />
      {s.capm ? <Luck s={s} /> : null}
    </>
  );
}

function Layers({ f, s, d }: { f: AttrFactors; s: AttrStock; d: NonNullable<ReturnType<typeof decompose>> }) {
  const items = [d.rf, d.market, d.ind ?? 0, ...Object.values(d.factors).map((v) => v ?? 0), d.alpha, d.total];
  const max = Math.max(0.01, ...items.map((v) => Math.abs(v)));
  const bar = (v: number | null) => ({ kind: 'diverging' as const, value: v, max });
  const fk = FACTOR_KEYS.filter((k) => d.factors[k] !== undefined);
  return (
    <Section title="三層拆解" testid="attr-layers"
      info={<>
        <p>R − R<sub>f</sub> ＝ α ＋ β（R<sub>m</sub> − R<sub>f</sub>）＋ 產業 ＋ Σ 因子曝險 × 因子報酬 ＋ 殘差。越往上層，報酬越難用規則取得，要投入的研究時間也越多。</p>
        <p>市場：CAPM 的 β × 期間大盤超額報酬。產業：同業籃子扣掉它自己的市場 Beta 後的報酬 × 曝險（產業領先大盤的一部分，只是這類股票波動本來就比較大）。因子：規模、價值、動能、獲利、低波動的多空組合報酬 × 曝險。Alpha：剩下的，混著運氣。</p>
        <p>各層用各月報酬加總，所以加起來剛好等於合計；複利的實際報酬另列。無風險利率是固定假設（年 {fmtNum(f.rf_annual * 100, 1)}%）。</p>
      </>}>
      <Conclusion>{layerSummary(d)}</Conclusion>
      <p class="ds-line attr-layer">第一層：市場 Beta（買指數就拿得到）</p>
      <List class="attr-bars" testid="attr-layer1">
        <BarRow name="無風險利率" sub="固定假設" bar={bar(d.rf)} value={pct(d.rf)} label={`無風險利率 ${fmtPct(d.rf)}`} />
        <BarRow name="市場" sub={`β ${fmtNum(d.beta, 2)}`} bar={bar(d.market)} value={pct(d.market)} label={`市場 ${fmtPct(d.market)}`} />
      </List>
      <p class="ds-line attr-layer">第二層：因子與產業（用規則買得到一整籃）</p>
      <List class="attr-bars" testid="attr-layer2">
        <BarRow name="產業" sub="同業籃子" bar={bar(d.ind)} value={pct(d.ind)} label={`產業 ${fmtPct(d.ind)}`} />
        {fk.map((k) => (
          <BarRow key={k} name={FACTOR_SHORT[k]} sub={`曝險 ${fmtNum(s.full?.b[k] ?? null, 2)}`} bar={bar(d.factors[k] ?? null)} value={pct(d.factors[k])} label={`${FACTOR_SHORT[k]} ${fmtPct(d.factors[k] ?? null)}`} />
        ))}
      </List>
      <p class="ds-line attr-layer">第三層：Alpha（剩下的）</p>
      <List class="attr-bars" testid="attr-layer3">
        <BarRow name="Alpha" sub={s.full ? '多因子' : '只扣市場'} bar={bar(d.alpha)} value={pct(d.alpha)} label={`Alpha ${fmtPct(d.alpha)}`} />
        <BarRow name="合計" sub="各月加總" bar={bar(d.total)} value={pct(d.total)} valueSub={d.compound !== null ? <>複利 {pct(d.compound)}</> : undefined} label={`合計 ${fmtPct(d.total)}`} />
      </List>
      {d.missing.length ? <p class="ds-line">期間內缺資料而沒算到：{d.missing.map((k) => FACTOR_SHORT[k]).join('、')}（併入 Alpha）</p> : null}
    </Section>
  );
}

function Exposures({ s }: { s: AttrStock }) {
  const rows: { key: string; label: string; b: number | null; t: number | null }[] = [
    { key: 'mkt', label: '市場 β', b: s.capm?.b.mkt ?? null, t: s.capm?.t.mkt ?? null },
    ...(s.full ? [{ key: 'ind', label: '產業', b: s.full.b.ind ?? null, t: s.full.t.ind ?? null },
      ...FACTOR_KEYS.filter((k) => k in (s.full?.b ?? {})).map((k) => ({ key: k, label: FACTOR_SHORT[k], b: s.full!.b[k] ?? null, t: s.full!.t[k] ?? null }))] : []),
  ];
  const clear = rows.filter((x) => x.key !== 'mkt' && x.t !== null && Math.abs(x.t) >= 2).map((x) => exposureText(x.key, x.b, x.t));
  return (
    <Section title="曝險" testid="attr-exposures"
      info={<p>曝險（迴歸係數）越大，受那個因子影響越大。|t| ≥ 2 才說它明顯；其餘可能只是雜訊。β：大盤超額報酬每多 10%，這一檔平均多 β × 10%。</p>}>
      <Conclusion>{exposureText('mkt', rows[0].b, rows[0].t)}{clear.length ? `・${clear.join('・')}` : '・因子曝險都不明顯'}</Conclusion>
      <List>
        {rows.map((x) => (
          <Row key={x.key} label={x.label} sub={`${exposureText(x.key, x.b, x.t) ?? '—'}・t 值 ${fmtT(x.t)}`} value={<Num v={x.b} digits={2} />} />
        ))}
      </List>
    </Section>
  );
}

function PeerSection({ s, nameOf }: { s: AttrStock; nameOf: (c: string) => string }) {
  const fit = rulerFit(s);
  const best = fit[0]?.key;
  const p = s.peers;
  const avg = p && p.corr.length ? p.corr.reduce((a, b) => a + b, 0) / p.corr.length : null;
  return (
    <Section title="同業籃子" testid="attr-peers"
      info={<>
        <p>不直接用族群輪動的分組：候選來自官方產業與細產業（一家公司可以屬於好幾個），再依「扣掉全市場平均後的週報酬相關」（近 104 週）挑出最常一起動的 5～10 家、等權。同產業的公司面對同一批客戶、同一種景氣循環，股價常常一起漲跌；一組至少 5 家，避免任何一家自己出事尺就跟著歪。</p>
        <p>候選裡連動夠強的不到 5 家時，由全市場依相關補齊（標「跨產業」）；還是不夠就取候選中最接近的，並標示連動偏弱。同業以最新資料挑選後回頭量歷史，是事後歸因，不是訊號。</p>
        <p>下方「貼合度」是各把尺的月報酬能解釋這一檔月報酬的比例（R²）：越高，這把尺越貼近這家公司。</p>
      </>}>
      <Conclusion>{p ? <>{p.codes.length} 家・平均相關 {fmtNum(avg, 2)}{p.kind === 'weak' ? '・連動偏弱，解讀要打折' : ''}</> : '連動夠強的同業不到 5 家，沒有同業籃子'}</Conclusion>
      {p ? (
        <List chev testid="attr-peer-rows">
          {p.codes.map((c, i) => (
            <Row key={c} label={<>{nameOf(c)}<span class="ui-muted"> {c}</span></>} sub={p.cross[i] ? '跨產業（只依股價連動）' : undefined}
              value={<>相關 <Num v={p.corr[i]} digits={2} /></>} href={`#/stock/${c}`} />
          ))}
        </List>
      ) : null}
      {fit.length ? (
        <>
          <p class="ds-line attr-layer">貼合度（月報酬 R²）</p>
          <List tags testid="attr-fit">
            {fit.map((x) => <Row key={x.key} label={x.label} value={<Num v={x.r2} digits={2} />} tag={x.key === best ? <Tag tone="strong">最貼近</Tag> : <span />} />)}
          </List>
        </>
      ) : null}
    </Section>
  );
}

function Luck({ s }: { s: AttrStock }) {
  const m = s.full ?? s.capm!;
  const years = yearsToTell(m);
  const t = m.alpha_t;
  const sig = t !== null && Math.abs(t) >= 2;
  return (
    <Section title="能力或運氣" testid="attr-luck"
      info={<p>單一年度、單一檔股票的殘差，統計上分不出能力和運氣。法人檢討績效看的是一段夠長的時間、很多筆決策加總起來的歸因，而且先對齊承擔的風險再比較報酬。所需年數＝（2 × 月殘差標準差 ÷ |月 Alpha|）² ÷ 12，也就是讓 t 值到 2 需要的資料長度。</p>}>
      <Conclusion>{sig ? '這段期間的 Alpha 統計上顯著，仍可能是運氣' : '統計上分不出能力和運氣'}</Conclusion>
      <List>
        <Row label="Alpha（年化）" sub={`${s.full ? '多因子' : 'CAPM'}・t 值 ${fmtT(t)}`} value={pct(annualAlpha(m))} />
        <Row label="殘差波動（年化）" sub="模型解釋不了的部分" value={pct(m.resid_sd === null ? null : m.resid_sd * Math.sqrt(12))} />
        <Row label="要多少年才分得出來" sub="t 值到 2 需要的資料長度" value={years === null ? '—' : !Number.isFinite(years) || years > 99 ? '超過 99 年' : `約 ${fmtNum(years, years < 10 ? 1 : 0)} 年`} />
      </List>
    </Section>
  );
}

// ---------------------------------------------------------------- 因子順逆風

function FactorPane({ f }: { f: AttrFactors }) {
  const [sel, setSel] = useState<AttrFactorKey>('umd');
  const trends = FACTOR_KEYS.map((k) => factorTrend(f, k));
  const max = Math.max(0.01, ...trends.map((t) => Math.abs(t.r12 ?? 0)));
  const up = trends.filter((t) => t.tailwind === true).map((t) => FACTOR_SHORT[t.key]);
  const down = trends.filter((t) => t.tailwind === false).map((t) => FACTOR_SHORT[t.key]);
  const vm = factorCorr(f, 'hml', 'umd');
  const last24 = f.months.slice(-24);
  const off = f.months.length - last24.length;
  return (
    <div class="seg-pane" data-testid="attr-factor">
      <Section title="因子順逆風" testid="attr-trends" aside={f.months[f.months.length - 1]}
        info={<>
          <p>第二層不是靜態的：哪一類股票正被市場獎勵會變，而且有延續性。因子過去一年報酬為正，接下來平均表現比較好（Ehsani & Linnainmaa 2022，因子動能）。這裡以近 12 個月為正標「順風」、為負標「逆風」。</p>
          <p>研究對象是學術上的多空因子組合，跟市面買得到的長倉 ETF 不一樣；同一份研究裡完整的因子動能策略，風險調整後並沒有勝過固定等權持有所有因子。「因子有趨勢」推不出「動態調整一定贏」。</p>
          <p>一個因子連續落後兩三年，不能直接解讀成它消失了。每個月檢查因子相對強弱，跟看到某類股票過去三五年賺最多就追進去，是兩件不同的事。</p>
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
        <p class="ds-line">數值為近 12 個月（多空組合）；點一列看每個月的報酬。</p>
      </Section>
      <Section title={`${FACTOR_SHORT[sel]}因子`} testid="attr-factor-chart">
        <Conclusion>近 1 個月 {pct(trends.find((t) => t.key === sel)?.r1)}・近 3 個月 {pct(trends.find((t) => t.key === sel)?.r3)}・近 12 個月 {pct(trends.find((t) => t.key === sel)?.r12)}</Conclusion>
        <p class="ds-line">{FACTOR_DEF[sel]}</p>
        <Card>
          <BarSeries label={`${FACTOR_SHORT[sel]}因子近 24 個月月報酬（%）`} dates={last24.map((m) => `${m}-01`)} signed words={['為正', '為負']} unit="%" height={130}
            dateFormat={(d) => d.slice(0, 7)}
            stacks={[{ id: sel, name: FACTOR_SHORT[sel], color: 'var(--up)', values: last24.map((_, i) => toPct(f.f[sel][off + i])) }]}
            format={(v) => fmtNum(v, 0)} />
        </Card>
        <p class="ds-line">資料起點 {f.start[sel] ?? '—'}；每月底依特徵把樣本股（期初近 60 日成交值最低的 {fmtNum(f.liquidity_pctile, 0)}% 不列入，約 {fmtNum(f.universe[f.universe.length - 1] ?? 0, 0)} 檔）以市值中位數 × 特徵 30／70 百分位分成 6 組，下個月等權報酬：高特徵兩組平均 − 低特徵兩組平均。</p>
      </Section>
      <Section title="因子之間" testid="attr-factor-corr">
        <List>
          <Row label="價值與動能的相關" sub="月報酬；跨市場研究中兩者通常負相關（Asness 等 2013）" value={<Num v={vm} digits={2} />} />
          <Row label="無風險利率" sub="固定假設（本工具不另抓利率資料）" value={`年 ${fmtNum(f.rf_annual * 100, 1)}%`} />
        </List>
      </Section>
    </div>
  );
}

/** 三層的結論：Alpha 在總報酬中的份量；其他層合計為負時不寫百分比（會超過 100%） */
function layerSummary(d: NonNullable<ReturnType<typeof decompose>>) {
  const share = d.total > 0 && d.alpha >= 0 && d.alpha <= d.total ? Math.round((d.alpha / d.total) * 100) : null;
  return (
    <>
      合計 {pct(d.total)}：市場 {pct(d.rf + d.market)}・因子與產業 {pct(d.total - d.rf - d.market - d.alpha)}・Alpha {pct(d.alpha)}
      {share !== null ? `（約 ${share}% 跟選股有關）` : ''}
    </>
  );
}

const toPct = (v: number | null | undefined) => (v === null || v === undefined ? null : v * 100);
const fmtPct = (v: number | null) => (v === null ? '無資料' : `${v >= 0 ? '+' : '−'}${fmtNum(Math.abs(v * 100), 1)}%`);
const fmtT = (v: number | null | undefined) => (v === null || v === undefined ? '—' : fmtNum(v, 1));
const fmtR2 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : fmtNum(v, 2));
