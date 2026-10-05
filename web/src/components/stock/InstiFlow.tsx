/**
 * 個股籌碼分頁「法人」區塊（2026-10-06）：舊的摘要表（法人／買賣超／佔量／連續）、舊每日表與每日明細子頁的「法人」分段
 * 合併成一個區塊。由上而下：標題（ⓘ）→ 連續天數標題 → 一行摘要 → 區間 5｜10｜20｜60 日 → 法人 外資｜投信｜自營商｜合計
 * → 柱狀圖（固定資訊列）→ 一行圖例 → 每日明細表（區間合計列＋逐日列，20／60 日先列 10 列）。
 * 單一狀態（區間、法人、選中的日子）同時驅動摘要、圖表、表格；區間與法人記在 localStorage（全站共用）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { StockHistory } from '../../data/types';
import type { ChipBlock, ChipRow, ColFormat } from '../../lib/chips';
import { INSTI_FOOTNOTE, cellPhrase, cellText, colValue, dayText, rowSentence, spokenDate } from '../../lib/chips';
import { DAY_STATUS_TEXT, type FreshKey, missingDayStatus, tpeClock } from '../../lib/freshness';
import {
  INSTI_COLS, INSTI_FOLD, INSTI_PARTIES, INSTI_PARTY_LABEL, INSTI_PERIODS, type InstiDays, type InstiPrefs, instiWindow, maxAbsLots, streakTitle,
} from '../../lib/instiFlow';
import { type InstParty, instDetail } from '../../lib/stockFacts';
import { instInterp } from '../../lib/stockInterp';
import { fmtNum, fmtPrice } from '../../lib/format';
import { Conclusion, Interp, reduceMotion } from '../kit';
import { EmptyRow, List, NavRow, Num, Row, Section, Seg, Signed } from '../ui';
import { Sheet } from '../Sheet';
import { DaySheet, mdLabel, priceLine, useDynamicTypeScale } from '../Chips';
import { InstiBars } from './InstiBars';

const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const LOTS: ColFormat = { digits: 0 };
/** 表格數字字級（px）：15 放不下依序降到 14、13（同一張表同一字級） */
const STEPS = [15, 14, 13];

/** 量最長的字，決定字級與日期欄寬：日期欄＋4 個數字欄放進容器寬度；canvas 量字，數字換成 0（等寬數字）。 */
function useFit(ref: { current: HTMLElement | null }, texts: { vals: string[]; dates: string[]; subs: string[] }, dt: number): { fs: number; dateW: number } {
  const [s, setS] = useState({ fs: STEPS[0], dateW: 64 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = document.createElement('canvas').getContext('2d');
    const family = getComputedStyle(el).fontFamily || 'system-ui';
    const root = (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16;
    const width = (arr: string[], px: number, weight: number) => {
      if (!ctx) return 0;
      ctx.font = `${weight} ${px * dt * root}px ${family}`;
      return Math.max(0, ...arr.map((t) => ctx.measureText(t.replace(/\d/g, '0')).width));
    };
    const compute = () => {
      const W = el.clientWidth;
      if (!W) return;
      // 日期欄：粗體 MM/DD（15）、小字收盤與漲跌（13）、「區間合計」（13 粗體）＋左右內距
      const dateW = Math.ceil(Math.max(56, width(texts.dates, 15, 600), width(texts.subs, 13, 400), width(['區間合計'], 13, 600)) + 8 + 6);
      // 數字欄：最長的值＋▲▼（縮小，約 0.72em）＋左右內距 8
      const fs = STEPS.find((px) => dateW + 4 * (width(texts.vals, px, 500) + 8) <= W) ?? STEPS[STEPS.length - 1];
      setS((o) => (o.fs === fs && o.dateW === dateW ? o : { fs, dateW }));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    document.fonts?.ready.then(compute).catch(() => undefined);
    return () => ro.disconnect();
  }, [texts, dt]);
  return s;
}

/** 就地展開／收合（高度動畫）：收合時高度＝第 fold 列的底部。 */
function useFold(wrap: { current: HTMLElement | null }, expanded: boolean, fold: number, deps: unknown[]): void {
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const rows = el.querySelectorAll<HTMLElement>('tbody tr.day');
    const full = el.scrollHeight;
    let target = full;
    if (!expanded && rows.length > fold) {
      const last = rows[fold - 1];
      target = last.offsetTop + last.offsetHeight;
    }
    const animate = !first.current && !reduceMotion();
    first.current = false;
    if (!animate) { el.style.transition = ''; el.style.height = expanded ? '' : `${target}px`; return; }
    const from = el.getBoundingClientRect().height;
    el.style.transition = 'none';
    el.style.height = `${from}px`;
    void el.offsetHeight; // 重排，讓下一個高度觸發 transition
    el.style.transition = 'height var(--dur-base, 280ms) var(--ease-out, ease-out)';
    el.style.height = `${target}px`;
    const end = () => { if (expanded) { el.style.transition = ''; el.style.height = ''; } };
    el.addEventListener('transitionend', end, { once: true });
    return () => el.removeEventListener('transitionend', end);
  }, [expanded, ...deps]);
}

export function InstiFlow({ h, asof, prefs, onPrefs }: { h: StockHistory; asof: (d: string | null, key?: FreshKey) => string; prefs: InstiPrefs; onPrefs: (p: InstiPrefs) => void }) {
  const chip = (h.chip as ChipBlock | null | undefined) ?? null;
  const setDays = (days: InstiDays) => { onPrefs({ ...prefs, days }); setExpanded(false); };
  const setParty = (party: InstParty) => onPrefs({ ...prefs, party });
  const { days, party } = prefs;
  const [pick, setPick] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [day, setDay] = useState<ChipRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const dt = useDynamicTypeScale();
  const win = useMemo(() => instiWindow(chip, days), [chip, days]);
  const rows = win?.rows ?? [];
  const asc = useMemo(() => rows.slice().reverse(), [rows]);
  const clock = tpeClock();
  // 尚未公布／尚未更新（M2 新鮮度規則；三大法人預期 16:00 公布）
  const pendingOf = (r: ChipRow) => (r.total === null && r.foreign === null ? DAY_STATUS_TEXT[missingDayStatus('insti', r.date, clock)] : null);
  const tot = win?.totals;
  const sumLots = tot?.total.lots ?? null;
  const interp = instInterp(sumLots, tot?.total.pctVolume ?? null, rows.length || days);
  const maxAbs = maxAbsLots(rows, party);
  // 資料日＝最新一個有三大法人資料的交易日
  const asofDate = win?.all.slice(1).reverse().find((r) => r.total !== null)?.date ?? (chip ? chip.d[chip.d.length - 1] ?? null : null);

  // 選中的日子：圖上選 → 表格對應列高亮；在折疊範圍外 → 自動展開並捲到可見
  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pick) return;
    const idx = rows.findIndex((r) => r.date === pick);
    if (idx >= INSTI_FOLD && !expanded) setExpanded(true);
  }, [pick]);
  useEffect(() => {
    if (!pick) return;
    const tr = tableRef.current?.querySelector<HTMLElement>(`tr[data-date="${pick}"]`);
    if (!tr) return;
    const r = tr.getBoundingClientRect();
    const vh = window.innerHeight;
    // 已在畫面內就不捲（拖曳時頁面不跳動）
    if (r.top >= 80 && r.bottom <= vh - 96) return;
    const t = window.setTimeout(() => tr.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' }), expanded ? 0 : 300);
    return () => clearTimeout(t);
  }, [pick, expanded]);

  // 量字（每欄最長的值、日期與小字）
  const texts = useMemo(() => {
    const vals: string[] = [];
    for (const p of INSTI_PARTIES) {
      const c = INSTI_COLS[p];
      for (const r of rows) vals.push(cellText(colValue(r, c, 'lots'), c, 'lots', true, LOTS).text);
      vals.push(cellText(tot?.[p].lots ?? null, c, 'lots', true, LOTS).text);
    }
    return { vals, dates: rows.map((r) => mdLabel(r.date)), subs: rows.flatMap((r) => { const p = priceLine(r); return [p.price, p.chg]; }) };
  }, [rows, tot]);
  const { fs, dateW } = useFit(tableRef, texts, dt);
  const foldable = rows.length > INSTI_FOLD;
  const wrapRef = useRef<HTMLDivElement>(null);
  useFold(wrapRef, expanded || !foldable, INSTI_FOLD, [rows.length, fs]);

  const detail = detailOpen ? instDetail(h, chip, party, days) : null;
  const missingNote = win?.missing.length ? `不含 ${win.missing.map(mdLabel).join('、')}` : null;

  return (
    <>
      <Section title="法人" aside={asof(asofDate, 'insti')} testid="sec-insti" info={
        <>
          <p>{INSTI_FOOTNOTE}；三大法人合計為官方數字（＝外資＋投信＋自營商），不自行加總。</p>
          <p>買賣超（張）＝淨買賣超股數 ÷ 1,000；區間合計先以股數相加再換算。佔量＝區間淨買賣超 ÷ 同期成交量（只計已公布的日子）。連續＝由最新一個已公布的交易日往回同方向的天數（最多 60 日）。</p>
          <p>點「區間合計」看佔股本 %、估計成本、近 20 日買超在過去 1 年的百分位與自營商拆分；估計成本＝區間淨買超日的成交均價加權（還原價），只是估算。點一列看當天完整資料。</p>
          <p>尚未公布：三大法人約 15:00 後公布，16:00 前視為尚未公布；過了 16:00 還沒有資料則為「尚未更新」。</p>
          <p>券商分點資料不提供（官方查詢頁有驗證碼）。</p>
        </>
      }>
        {win ? (
          <>
            <Conclusion testid="insti-concl">{streakTitle(win.totals)}</Conclusion>
            <Interp>{interp.text}</Interp>
            <div class="if-controls">
              <Seg small options={INSTI_PERIODS.map((d) => [String(d), `${d} 日`] as const)} value={String(days)} onChange={(v) => { setDays(Number(v) as InstiDays); setPick(null); }} label="法人區間" testid="insti-period" />
              <Seg small options={INSTI_PARTIES.map((p) => [p, INSTI_PARTY_LABEL[p]] as const)} value={party} onChange={setParty} label="每日買賣超法人" testid="insti-party" />
            </div>
            {rows.length >= 1 ? (
              <>
                <InstiBars testid="insti-bars" label={`${INSTI_PARTY_LABEL[party]}近 ${rows.length} 日每日淨買賣超（張）`} animKey={`${days}-${party}`}
                  days={asc.map((r) => ({ date: r.date, value: r[party] === null ? null : (r[party] as number) / 1000, pending: pendingOf(r) }))}
                  selected={pick} onSelect={setPick}
                  info={(i) => {
                    if (i === null) {
                      return <><span class="ib-k">{INSTI_PARTY_LABEL[party]}每日買賣超</span><span class="ib-max">{ok(maxAbs) ? `最大 ${fmtNum(maxAbs, 0)} 張` : ''}</span></>;
                    }
                    const r = asc[i];
                    const v = r[party] === null ? null : (r[party] as number) / 1000;
                    const p = priceLine(r);
                    return (
                      <>
                        <span class="ib-k"><b>{mdLabel(r.date)}</b> {INSTI_PARTY_LABEL[party]} {v === null ? <span class="ib-pend">{pendingOf(r) ?? '—'}</span> : (() => { const t = cellText(v, INSTI_COLS[party], 'lots', true, LOTS); return <span class={t.dir}>{t.text} 張</span>; })()}</span>
                        <span class="ib-max">收盤 {p.price} <span class={p.dir}>{p.chg}</span></span>
                      </>
                    );
                  }} />
                <p class="if-legend">紅色＝淨買超・綠色＝淨賣超</p>
                <div class="if-meta">
                  <span>{rows.length} 日・{mdLabel(rows[rows.length - 1].date)}–{mdLabel(rows[0].date)}・點一列看當天完整資料</span>
                  <span class="if-unit">單位：張</span>
                </div>
                <div class="if-card" ref={tableRef} style={{ ['--dt' as string]: dt, ['--cd-fs' as string]: `${fs / 16}rem` }}>
                  <div class="if-fold" ref={wrapRef}>
                    <table class="cd-table if-table" data-testid="insti-daily" aria-label={`近 ${rows.length} 日三大法人每日買賣超（張）`}>
                      <colgroup><col style={{ width: `${dateW}px` }} />{INSTI_PARTIES.map((p) => <col key={p} />)}</colgroup>
                      <thead>
                        <tr>
                          <th scope="col" class="cd-dh">日期</th>
                          {INSTI_PARTIES.map((p) => <th key={p} scope="col" class={p === party ? 'em' : undefined}><span class="cd-h">{INSTI_PARTY_LABEL[p]}{p === 'dealer' ? <span class="sr-only">（自行＋避險）</span> : null}</span></th>)}
                        </tr>
                      </thead>
                      <tbody>
                        <tr class="total" data-testid="insti-total">
                          <th scope="row" class="cd-rowhead">
                            <span class="cd-date">區間合計</span>
                            <span class="cd-sub">{rows.length} 日</span>
                            {missingNote ? <span class="cd-sub if-miss" data-testid="insti-missing">{missingNote}</span> : null}
                            <button class="cd-rowbtn" aria-haspopup="dialog" aria-label={`區間合計 ${rows.length} 日：看${INSTI_PARTY_LABEL[party]}的佔股本、估計成本與百分位`} onClick={() => setDetailOpen(true)} />
                          </th>
                          {INSTI_PARTIES.map((p) => {
                            const c = INSTI_COLS[p];
                            const t = cellText(tot![p].lots, c, 'lots', true, LOTS);
                            const pct = tot![p].pctVolume;
                            return (
                              <td key={p} class={`cd-v ${t.dir}${p === party ? ' em' : ''}`}>
                                <span class="cd-t" aria-hidden="true">{t.arrow ? <span class="cd-arrow">{t.arrow}</span> : null}{t.body}</span>
                                <span class="if-pct" aria-hidden="true">{ok(pct) ? `佔 ${fmtNum(Math.abs(pct), 1)}%` : '—'}</span>
                                <span class="sr-only">{cellPhrase(tot![p].lots, c, 'lots', true)}{ok(pct) ? `，佔成交量 ${fmtNum(Math.abs(pct), 1)}%` : ''}</span>
                              </td>
                            );
                          })}
                        </tr>
                        {rows.map((r, i) => {
                          const p = priceLine(r);
                          const pend = pendingOf(r);
                          const folded = foldable && !expanded && i >= INSTI_FOLD;
                          return (
                            <tr key={r.date} data-date={r.date} class={`day${pick === r.date ? ' sel' : ''}${folded ? ' folded' : ''}`} aria-selected={pick === r.date} aria-hidden={folded || undefined}
                              onClick={() => { setPick(r.date); setDay(r); }}>
                              <th scope="row" class="cd-rowhead">
                                <span class="cd-date" aria-hidden="true">{mdLabel(r.date)}</span>
                                <span class="cd-sub" aria-hidden="true">{p.price}<span class={`cd-chg ${p.dir}`}>{p.chg}</span></span>
                                <button class="cd-rowbtn" tabIndex={folded ? -1 : 0} aria-haspopup="dialog" aria-label={pend ? `${spokenDate(r.date)}，三大法人${pend}` : rowSentence(r, INSTI_PARTIES.map((x) => INSTI_COLS[x]), 'lots')}
                                  onClick={(e) => { e.stopPropagation(); setPick(r.date); setDay(r); }} />
                              </th>
                              {INSTI_PARTIES.map((x) => {
                                const c = INSTI_COLS[x];
                                const t = cellText(colValue(r, c, 'lots'), c, 'lots', true, LOTS);
                                return (
                                  <td key={x} class={`cd-v ${t.dir}${x === party ? ' em' : ''}`}>
                                    <span class="cd-t" aria-hidden="true">{t.arrow ? <span class="cd-arrow">{t.arrow}</span> : null}{t.body}</span>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {foldable ? (
                    <button type="button" class="text-btn block if-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} data-testid="insti-daily-more">
                      {expanded ? `只看最近 ${INSTI_FOLD} 日` : `顯示全部 ${rows.length} 日`}
                    </button>
                  ) : null}
                </div>
              </>
            ) : <List><EmptyRow>資料累積中：目前只有 {rows.length} 個交易日的法人資料</EmptyRow></List>}
          </>
        ) : <List><EmptyRow>資料累積中：需要至少 2 個交易日的法人資料</EmptyRow></List>}
        <List chev>
          <NavRow title="每日明細" sub="信用・借券當沖，可換單位" href={`#/stock/${h.code}/daily`} testid="to-daily" />
          <NavRow title="法人買賣超報表" sub="近 3 個月逐日買張、賣張" href={`#/stock/${h.code}/institutional`} />
        </List>
      </Section>
      <Sheet open={!!detail} onClose={() => setDetailOpen(false)} title={detail ? `${{ foreign: '外資', trust: '投信', dealer: '自營商', total: '三大法人' }[detail.party]}・近 ${days} 日` : ''}>
        {detail ? (
          <List testid="insti-detail">
            <Row label="買賣超" value={<Signed v={detail.lots} digits={0} unit="張" />} />
            <Row label="佔股本" value={<Signed v={detail.pctCapital} digits={3} unit="%" />} />
            <Row label="估計成本" sub="估" value={<Num v={ok(detail.cost) ? fmtPrice(detail.cost) : null} />} />
            <Row label="現價比成本" value={<Signed v={detail.costRel} unit="%" tone="plain" />} />
            <Row label="近 20 日買超的 1 年百分位" value={<Num v={detail.pct1y} />} />
            {detail.split ? <Row label="自營商自行買賣" value={<Signed v={detail.split.self} digits={0} unit="張" />} /> : null}
            {detail.split ? <Row label="自營商避險" value={<Signed v={detail.split.hedge} digits={0} unit="張" />} /> : null}
          </List>
        ) : null}
      </Sheet>
      <DaySheet day={day} onClose={() => setDay(null)} unit="lots" market={h.market} onCopy={(r) => copyDay(r, h)} />
    </>
  );
}

function copyDay(r: ChipRow, h: StockHistory): void {
  navigator.clipboard?.writeText(dayText(r, 'lots', { code: h.code, name: h.name })).catch(() => undefined);
}
