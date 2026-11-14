/**
 * 探索 › 報酬拆解（2026-10-27；#/explore/attribution?seg=&code=&p=）：一筆報酬有多少來自市場、多少來自你買的那一類股票、
 * 多少才跟選股判斷有關（市場 Beta → 因子與產業 → Alpha）。定義見 METHODOLOGY §4.12；計算 lib/attribution、pipeline/derive/attribution.py。
 * 2026-11-13：新增「順風檢查」分段（風格 ETF 與類股當溫度計；pages/AttributionWind）；第二層改用同業籃子與風格 ETF。
 * 分析方法，不是買賣建議；不使用買進／賣出字眼。
 */
import { useMemo, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { BarRow } from '../components/BarRows';
import { ErrorState } from '../components/DataStatus';
import { Conclusion } from '../components/kit';
import { Sheet } from '../components/Sheet';
import { StockSearch } from '../components/StockSearch';
import { List, Num, PageTitle, Row, Section, Seg, Signed, Tag } from '../components/ui';
import { loadAttrFactors, loadAttrStock, loadAttrTailwind, loadSummary } from '../data/api';
import type { AttrFactors, AttrStock, Tailwind } from '../data/types';
import { useUser } from '../data/useUser';
import { useAsync, useSegParam } from '../hooks';
import {
  ATTR_PERIODS, type AttrPeriod, STYLE_KEYS, STYLE_LABEL, annualAlpha, decompose, exposureText,
  periodRange, rulerFit, rulers, yearsToTell,
} from '../lib/attribution';
import { fmtNum } from '../lib/format';
import { navigate, useRoute } from '../router';
import { StockWindSection, WindPane } from './AttributionWind';
import '../styles/etf.css';
import '../styles/explore.css';

const SEGS = [['wind', '順風檢查'], ['stock', '個股拆解']] as const;
type AttrSeg = (typeof SEGS)[number][0];
const pct = (v: number | null | undefined, d = 1) => <Signed v={v === null || v === undefined ? null : v * 100} digits={d} unit="%" />;
const pp = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${fmtNum(Math.abs(v * 100), 1)} 個百分點`);
const DISCLAIMER = '分析方法與研究流程，不提供個股買賣建議。ETF 與指數只是觀察與比較的溫度計；歷史統計不代表未來報酬。';

export default function Attribution() {
  const route = useRoute();
  // 先看風向、再看公司：預設「順風檢查」；網址帶了 code（從個股頁或舊連結過來）而沒有指定分段 → 個股拆解
  const legacy = route.query.get('seg') === 'factor';
  const [seg0, setSeg] = useSegParam<AttrSeg>(SEGS.map(([v]) => v), route.query.get('code') ? 'stock' : 'wind', 'seg', 'attr-seg2');
  const seg: AttrSeg = legacy ? 'wind' : seg0;
  const factors = useAsync(loadAttrFactors, []);
  const wind = useAsync(loadAttrTailwind, []);
  const f = factors.data ?? null;
  const tw = wind.data ?? null;
  return (
    <div class="page" data-testid="attr-page">
      <TopBar back="/explore" />
      <PageTitle title="報酬拆解" sub="市場 Beta・因子與產業・Alpha" />
      <Seg options={SEGS} value={seg} onChange={setSeg} label="報酬拆解分段" sticky testid="attr-seg" />
      {factors.error ? <ErrorState error={factors.error} /> : !f && !factors.loading ? <p class="ds-line">資料累積中</p> : f ? (
        seg === 'stock' ? <StockPane f={f} tw={tw} />
          : tw ? <WindPane f={f} tw={tw} />
            : wind.loading ? null : <p class="ds-line" data-testid="wind-empty">順風檢查的資料累積中（下一次資料更新後出現）</p>
      ) : null}
      <p class="ds-line">{DISCLAIMER}</p>
    </div>
  );
}

// ---------------------------------------------------------------- 個股拆解

function StockPane({ f, tw }: { f: AttrFactors; tw: Tailwind | null }) {
  const route = useRoute();
  const user = useUser();
  const summary = useAsync(loadSummary, []);
  const [picking, setPicking] = useState(false);
  const code = route.query.get('code') ?? user?.watch[0]?.code ?? '2330';
  const nameOf = (c: string) => (summary.data?.byCode.get(c)?.name as string | undefined) ?? c;
  const pick = (c: string) => {
    const qs = new URLSearchParams(route.query);
    qs.set('code', c);
    navigate(`${route.path}?${qs.toString()}`, true, 'none');
    setPicking(false);
  };
  return (
    <div class="seg-pane" data-testid="attr-stock">
      <List chev>
        <Row label={<>{nameOf(code)}<span class="ui-muted"> {code}</span></>} sub="換一檔" onClick={() => setPicking(true)} testid="attr-pick" />
      </List>
      <Sheet open={picking} onClose={() => setPicking(false)} title="選一檔股票">
        <StockSearch rows={summary.data?.rows ?? []} onPick={(r) => pick(r.code)} autoFocus />
      </Sheet>
      <div class="mg-gap" />
      <AttrStockView f={f} tw={tw} code={code} nameOf={nameOf} />
    </div>
  );
}

/**
 * 個股頁 › 動能 › 報酬來源（#/stock/{code}/m/attribution；2026-10-27）：同一套個股拆解，不含換股；
 * 因子順逆風與換股留在探索頁。
 */
export function StockAttribution({ code }: { code: string }) {
  const factors = useAsync(loadAttrFactors, []);
  const wind = useAsync(loadAttrTailwind, []);
  const summary = useAsync(loadSummary, []);
  const f = factors.data ?? null;
  const nameOf = (c: string) => (summary.data?.byCode.get(c)?.name as string | undefined) ?? c;
  return (
    <div class="seg-pane" data-testid="attr-stock">
      {factors.error ? <ErrorState error={factors.error} /> : !f && !factors.loading ? <p class="ds-line">資料累積中</p>
        : f && !wind.loading ? <AttrStockView f={f} tw={wind.data ?? null} code={code} nameOf={nameOf} /> : null}
      <p class="ds-line">{DISCLAIMER}</p>
    </div>
  );
}

/** 期間切換 ＋ 個股拆解（探索頁與個股頁共用；期間記在網址 p 與 attr-period） */
function AttrStockView({ f, tw, code, nameOf }: { f: AttrFactors; tw: Tailwind | null; code: string; nameOf: (c: string) => string }) {
  const [period, setPeriod] = useSegParam<AttrPeriod>(ATTR_PERIODS.map(([v]) => v), '12', 'p', 'attr-period');
  const s = useAsync(() => loadAttrStock(code), [code]);
  const idx = useMemo(() => periodRange(f, Number(period)), [f, period]);
  const from = idx.length ? f.months[idx[0]] : null;
  const to = idx.length ? f.months[idx[idx.length - 1]] : null;
  return (
    <>
      <Seg options={ATTR_PERIODS} value={period} onChange={setPeriod} label="期間" testid="attr-period" />
      <p class="ds-line" data-testid="attr-range">
        {from && to ? `${from}～${to}${f.partial ? '（最後一個月到最新交易日）' : ''}` : ''}
        {Number(period) < 6 ? '・持有期間太短：差距多半反映消息和情緒，至少放在幾個季度看' : ''}
      </p>
      {s.error ? <ErrorState error={s.error} /> : s.data === null && !s.loading ? (
        <p class="ds-line">這一檔沒有報酬拆解（只算普通股；上市未滿 24 個月或成交太少時無法估計）</p>
      ) : s.data ? <StockBody f={f} tw={tw} s={s.data} idx={idx} nameOf={nameOf} code={code} /> : null}
    </>
  );
}

function StockBody({ f, tw, s, idx, nameOf, code }: { f: AttrFactors; tw: Tailwind | null; s: AttrStock; idx: number[]; nameOf: (c: string) => string; code: string }) {
  const r = rulers(f, s, tw, idx);
  const d = decompose(f, s, tw, idx);
  const maxR = Math.max(0.01, ...[r.stock, r.market, r.sector, r.peer, r.style].map((v) => Math.abs(v ?? 0)));
  const lead = (b: number | null) => (r.stock !== null && b !== null ? r.stock - b : null);
  return (
    <>
      <Section title="三把尺" testid="attr-rulers"
        info={<>
          <p>同一筆報酬，換一把尺量，結論就不一樣。三把尺依序用下來，量到最後還剩下的，才是跟「這家公司」有關的報酬。</p>
          <p>第一把：大盤（發行量加權股價報酬指數，含息）。第二把：同產業——類股報酬指數是最粗的尺，用來看風向；同業籃子是更貼近業務的細尺（扣掉大盤後股價最常一起動的 5～10 家、等權、不含自己），量 Alpha 用它。第三把：風格 ETF（這一檔最突出的那一種特徵）。</p>
          <p>尺越細，公司自己的部分越少：用類股當尺領先一大段，換成同業籃子常常只剩一半，差掉的是整個次產業一起漲的部分。兩把尺回答不同的問題，不是哪一把錯了。</p>
          <p>先選好尺再量，之後固定用同一把；期間用實際持有的期間，至少幾個季度。台股的類股指數常被單一權值股主導，解讀要打折。</p>
        </>}>
        <Conclusion>{r.peer !== null ? leadText('同業籃子', lead(r.peer)) : r.market !== null ? leadText('大盤', lead(r.market)) : '資料不足'}</Conclusion>
        <List class="attr-bars" testid="attr-ruler-rows">
          <BarRow name="這一檔" bar={{ kind: 'diverging', value: r.stock, max: maxR }} value={pct(r.stock)} label={`這一檔 ${fmtPct(r.stock)}`} />
          <BarRow name="大盤" sub="報酬指數" bar={{ kind: 'diverging', value: r.market, max: maxR }} value={pct(r.market)} valueSub={`差 ${pp(lead(r.market))}`} label={`大盤 ${fmtPct(r.market)}`} />
          {r.sectorLabel ? <BarRow name="類股" sub={r.sectorLabel} bar={{ kind: 'diverging', value: r.sector, max: maxR }} value={pct(r.sector)} valueSub={`差 ${pp(lead(r.sector))}`} label={`類股 ${r.sectorLabel} ${fmtPct(r.sector)}`} testid="attr-ruler-sector" /> : null}
          <BarRow name="同業籃子" sub={s.peers ? `${s.peers.codes.length} 家` : '不足'} bar={{ kind: 'diverging', value: r.peer, max: maxR }} value={pct(r.peer)} valueSub={`差 ${pp(lead(r.peer))}`} label={`同業籃子 ${fmtPct(r.peer)}`} />
          {r.styleKey ? <BarRow name="風格 ETF" sub={`${STYLE_LABEL[r.styleKey]} ${r.styleEtf}`} bar={{ kind: 'diverging', value: r.style, max: maxR }} value={pct(r.style)} valueSub={`差 ${pp(lead(r.style))}`} label={`風格 ETF ${STYLE_LABEL[r.styleKey]} ${fmtPct(r.style)}`} testid="attr-ruler-style" /> : null}
        </List>
      </Section>

      {tw ? <StockWindSection tw={tw} s={s} code={code} /> : null}

      {d ? <Layers f={f} tw={tw} s={s} d={d} /> : (
        <Section title="三層拆解"><p class="ds-line">估計 Beta 需要至少 {f.min_months} 個月的資料</p></Section>
      )}

      {s.capm ? (
        <Section title="模型與 Alpha" testid="attr-models"
          info={<>
            <p>Alpha 是相對於模型定義的：模型裡放進越多因子，剩下能叫 Alpha 的就越少（Jensen 1968、Carhart 1997、Frazzini 等 2018〈Buffett's Alpha〉）。</p>
            <p>月 Alpha × 12 為年化；t 值的絕對值 ≥ 2 大約是統計上顯著。CAPM 的 R²＝大盤能解釋的月報酬變動比例；加上同業與風格 ETF 那一列的 R² 用的是週報酬（曝險是用週報酬估的）。</p>
          </>}>
          <Conclusion>{s.full && s.full.alpha !== null ? <>加入同業與風格 ETF 後，Alpha 由 {pct(annualAlpha(s.capm))} 變成 {pct(annualAlpha(s.full))}（年化）</> : s.full ? '第二層的月份還不夠算 Alpha，只有 CAPM' : '同業與風格 ETF 的資料還不夠，只有 CAPM'}</Conclusion>
          <List>
            <Row label="只用市場（CAPM）" sub={`t 值 ${fmtT(s.capm.alpha_t)}・R² ${fmtR2(s.capm.r2)}`} value={pct(annualAlpha(s.capm))} />
            {s.full ? <Row label="加上同業與風格 ETF" sub={`t 值 ${fmtT(s.full.alpha_t)}・R² ${fmtR2(s.full.r2)}（週）`} value={pct(annualAlpha(s.full))} /> : null}
          </List>
          <p class="ds-line">β：{s.window ? `${s.window[0]}～${s.window[1]}（${s.capm.n} 個月）` : '—'}的月報酬，整段估一次。
            {s.full?.wwindow ? `同業與風格 ETF 的曝險：近 ${s.full.weeks} 週的週報酬（ETF 掛牌時間短，月報酬太少）；月 Alpha：${s.full.window ? `${s.full.window[0]}～${s.full.window[1]}（${s.full.n} 個月）` : '月份不足'}。` : ''}
            換一段期間數字會不同，當成估計值看。
            {s.dropped.length ? `資料太短而沒放進模型：${s.dropped.map((k) => `${STYLE_LABEL[k]}${tw?.styles.find((x) => x.key === k)?.etf ? `（${tw.styles.find((x) => x.key === k)!.etf}）` : ''}`).join('、')}。` : ''}</p>
        </Section>
      ) : null}

      {s.capm ? <Exposures s={s} tw={tw} /> : null}
      <PeerSection s={s} nameOf={nameOf} />
      {s.capm ? <Luck s={s} /> : null}
    </>
  );
}

function Layers({ f, tw, s, d }: { f: AttrFactors; tw: Tailwind | null; s: AttrStock; d: NonNullable<ReturnType<typeof decompose>> }) {
  const items = [d.rf, d.market, d.ind ?? 0, ...Object.values(d.factors).map((v) => v ?? 0), d.alpha, d.total];
  const max = Math.max(0.01, ...items.map((v) => Math.abs(v)));
  const bar = (v: number | null) => ({ kind: 'diverging' as const, value: v, max });
  const fk = STYLE_KEYS.filter((k) => d.factors[k] !== undefined);
  const etf = (k: string) => tw?.styles.find((x) => x.key === k)?.etf ?? '';
  return (
    <Section title="三層拆解" testid="attr-layers"
      info={<>
        <p>R − R<sub>f</sub> ＝ α ＋ β（R<sub>m</sub> − R<sub>f</sub>）＋ 產業 ＋ Σ 曝險 × 風格報酬 ＋ 殘差。越往上層，報酬越難用規則取得，要投入的研究時間也越多。</p>
        <p>市場：CAPM 的 β × 期間大盤超額報酬。產業：同業籃子扣掉它自己的市場 Beta 後的報酬 × 曝險。風格：價值、品質、動能、規模、低波動各用一檔 ETF 當尺（單元 2 的對照表），同樣先扣掉 ETF 自己的市場 Beta——ETF 只有作多的那一半，報酬裡混著大盤，扣掉之後才比較接近特徵本身。Alpha：剩下的，混著運氣。</p>
        <p>類股報酬指數不放進來：大型股自己就是類股指數的大半，拿它解釋自己沒有意義；它用在上面的「兩個狀態」看風向。風格 ETF 贏大盤的部分還混著它多配的類股，所以產業和風格兩邊的數字不是完全獨立的。</p>
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
        <BarRow name="產業" sub="同業籃子" bar={bar(d.ind)} value={pct(d.ind)} valueSub={`曝險 ${fmtB(s.full?.b.ind)}`} label={`產業 ${fmtPct(d.ind)}`} />
        {fk.map((k) => (
          <BarRow key={k} name={STYLE_LABEL[k]} sub={etf(k)} bar={bar(d.factors[k] ?? null)} value={pct(d.factors[k])} valueSub={`曝險 ${fmtB(s.full?.b[k])}`} label={`${STYLE_LABEL[k]} ${fmtPct(d.factors[k] ?? null)}`} testid={`attr-layer2-${k}`} />
        ))}
      </List>
      <p class="ds-line attr-layer">第三層：Alpha（剩下的）</p>
      <List class="attr-bars" testid="attr-layer3">
        <BarRow name="Alpha" sub={s.full ? '多因子' : '只扣市場'} bar={bar(d.alpha)} value={pct(d.alpha)} label={`Alpha ${fmtPct(d.alpha)}`} />
        <BarRow name="合計" sub="各月加總" bar={bar(d.total)} value={pct(d.total)} valueSub={d.compound !== null ? <>複利 {pct(d.compound)}</> : undefined} label={`合計 ${fmtPct(d.total)}`} />
      </List>
      {d.missing.length ? <p class="ds-line">期間內缺資料而沒算到：{d.missing.map((k) => STYLE_LABEL[k]).join('、')}（併入 Alpha）</p> : null}
    </Section>
  );
}

function Exposures({ s, tw }: { s: AttrStock; tw: Tailwind | null }) {
  const etf = (k: string) => tw?.styles.find((x) => x.key === k)?.etf;
  const rows: { key: string; label: string; b: number | null; t: number | null }[] = [
    { key: 'mkt', label: '市場 β', b: s.capm?.b.mkt ?? null, t: s.capm?.t.mkt ?? null },
    ...(s.full ? [
      ...('ind' in s.full.b ? [{ key: 'ind', label: '產業（同業籃子）', b: s.full.b.ind ?? null, t: s.full.t.ind ?? null }] : []),
      ...STYLE_KEYS.filter((k) => k in (s.full?.b ?? {})).map((k) => ({ key: k as string, label: `${STYLE_LABEL[k]}${etf(k) ? `（${etf(k)}）` : ''}`, b: s.full!.b[k] ?? null, t: s.full!.t[k] ?? null })),
    ] : []),
  ];
  const clear = rows.filter((x) => x.key !== 'mkt' && x.t !== null && Math.abs(x.t) >= 2).map((x) => exposureText(x.key, x.b, x.t));
  return (
    <Section title="曝險" testid="attr-exposures"
      info={<>
        <p>曝險（迴歸係數）越大，受那一把尺影響越大。|t| ≥ 2 才說它明顯；其餘可能只是雜訊。β：大盤超額報酬每多 10%，這一檔平均多 β × 10%。</p>
        <p>風格的曝險是「這一檔扣掉市場後的報酬」跟「風格 ETF 扣掉市場後的報酬」的連動，用近 2 年的週報酬估。它說的是股價跟哪一類一起動；個股的特徵（便不便宜、ROE 高不高）看上面「兩個狀態」的百分位。兩邊不一致很常見。</p>
      </>}>
      <Conclusion>{exposureText('mkt', rows[0].b, rows[0].t)}{clear.length ? `・${clear.join('・')}` : '・其他曝險都不明顯'}</Conclusion>
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
  const m = s.full && s.full.alpha !== null ? s.full : s.capm!;
  const years = yearsToTell(m);
  const t = m.alpha_t;
  const sig = t !== null && Math.abs(t) >= 2;
  return (
    <Section title="能力或運氣" testid="attr-luck"
      info={<p>單一年度、單一檔股票的殘差，統計上分不出能力和運氣。法人檢討績效看的是一段夠長的時間、很多筆決策加總起來的歸因，而且先對齊承擔的風險再比較報酬。所需年數＝（2 × 月殘差標準差 ÷ |月 Alpha|）² ÷ 12，也就是讓 t 值到 2 需要的資料長度。</p>}>
      <Conclusion>{sig ? '這段期間的 Alpha 統計上顯著，仍可能是運氣' : '統計上分不出能力和運氣'}</Conclusion>
      <List>
        <Row label="Alpha（年化）" sub={`${m === s.full ? '多因子' : 'CAPM'}・t 值 ${fmtT(t)}`} value={pct(annualAlpha(m))} />
        <Row label="殘差波動（年化）" sub="模型解釋不了的部分" value={<Num v={m.resid_sd === null ? null : m.resid_sd * Math.sqrt(12) * 100} digits={1} unit="%" />} />
        <Row label="要多少年才分得出來" sub="t 值到 2 需要的資料長度" value={years === null ? '—' : !Number.isFinite(years) || years > 99 ? '超過 99 年' : `約 ${fmtNum(years, years < 10 ? 1 : 0)} 年`} />
      </List>
    </Section>
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

/** 領先／落後（不寫「領先 −x」） */
const leadText = (name: string, v: number | null) => (v === null ? `${name}無資料` : `${v >= 0 ? '領先' : '落後'}${name} ${fmtNum(Math.abs(v * 100), 1)} 個百分點`);
const fmtPct = (v: number | null) => (v === null ? '無資料' : `${v >= 0 ? '+' : '−'}${fmtNum(Math.abs(v * 100), 1)}%`);
/** 曝險（係數）：負號用全形減號 */
const fmtB = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v < 0 ? '−' : ''}${fmtNum(Math.abs(v), 2)}`);
const fmtT = (v: number | null | undefined) => (v === null || v === undefined ? '—' : fmtNum(v, 1));
const fmtR2 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : fmtNum(v, 2));
