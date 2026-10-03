import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { StockRow } from '../data/types';
import type { Activity, Trade } from '../db/db';
import { envInfo, tonightMood, type Light } from './envState';
import { diffRow, makeSnapshot, sinceLabel } from './changes';
import { holdingAlerts } from './holdings';
import { levelFor, ritualRings, stopRespected, streaks } from './ritual';
import { badges } from './achievements';
import { impulseFacts } from './impulse';
import { holdingsSeries } from './portfolioSeries';
import { holdConclusion, mineConclusion, tonightConclusion } from './conclusion';
import { uiConfig } from './config';

const L = (id: string, state: Light['state']): Light => ({ id, label: id, state, value: '', basis: '' });
const row = (o: Partial<StockRow>): StockRow => ({
  code: '2330', name: '台積電', market: 'twse', industry: '半導體業', close: 100, change: 1, change_pct: 1, volume_lots: 10000, value_million: 1000,
  foreign_net_lots: 0, trust_net_lots: 0, dealer_net_lots: 0, foreign_streak: 0, trust_streak: 0, foreign_net_5d: 0, trust_net_5d: 0,
  margin_balance: 1000, margin_change: 0, short_balance: 0, pe: 10, pb: 1, dividend_yield: 3, flags: [], composite: 50, ...o,
});
const trade = (o: Partial<Trade>): Trade => ({
  id: 't', code: '2330', name: '台積電', status: 'open', openedAt: '2026-09-01', entry: 100, shares: 1000, stop: 90, target: 130, reasonType: '籌碼',
  checklist: { market: '中性', trend: '', revenue: '', valuation: '', reason: '理由' }, ...o,
});
const act = (type: Activity['type'], day: string, at = `${day}T13:00:00Z`, meta?: Activity['meta']): Activity => ({ id: `${type}-${day}-${at}`, type, day, at, meta });

describe('資金環境燈號', () => {
  it('任一風險 → 保守（琥珀）；≥ 3 項有利且無風險 → 積極；其餘中性；無資料', () => {
    expect(envInfo([L('a', 'red'), L('b', 'green')]).state).toBe('conservative');
    expect(tonightMood('conservative')).toBe('risk');
    expect(envInfo([L('a', 'green'), L('b', 'green'), L('c', 'green')]).state).toBe('aggressive');
    expect(envInfo([L('a', 'yellow'), L('b', 'green')]).state).toBe('neutral');
    expect(tonightMood('neutral')).toBe('neutral');
    expect(envInfo([L('a', 'gray')]).state).toBe('unknown');
    expect(envInfo([L('a', 'red'), L('b', 'yellow'), L('c', 'gray')]).counts).toBe('1 項風險・1 項中性・1 項累積中');
  });
});

describe('變化優先', () => {
  it('低於門檻不算顯著；超過門檻列出原因', () => {
    const snap = makeSnapshot([row({})], '2026-09-23');
    expect(diffRow(row({ close: 101 }), snap.rows['2330']).significant).toBe(false);
    const c = diffRow(row({ close: 106, composite: 60 }), snap.rows['2330']);
    expect(c.significant).toBe(true);
    // stock 2026-10-03：綜合分不再是變化原因（SPEC §5.7）
    expect(c.reasons.map((r) => r.kind)).toEqual(['price']);
  });
  it('新風險旗標一律顯著；沒有快照時用前一交易日', () => {
    const flagged = row({ flags: [{ id: 'attention', label: '注意股', level: 'warn' }], new_flags: ['attention'] });
    expect(diffRow(flagged, undefined).newFlags).toHaveLength(1);
    expect(diffRow(row({ change_pct: 4 }), undefined).reasons[0].text).toContain('今日漲 4.0%');
    expect(sinceLabel(null)).toBe('較前一交易日');
  });
  it('連買天數「新達到」門檻才算', () => {
    const n = uiConfig.significance.inst_streak_days;
    const prev = makeSnapshot([row({ trust_streak: n - 1 })], 'd').rows['2330'];
    expect(diffRow(row({ trust_streak: n }), prev).reasons.some((r) => r.kind === 'streak')).toBe(true);
    const prev2 = makeSnapshot([row({ trust_streak: n })], 'd').rows['2330'];
    expect(diffRow(row({ trust_streak: n + 1 }), prev2).reasons.some((r) => r.kind === 'streak')).toBe(false);
  });
});

describe('持股警示', () => {
  it('觸及停損、接近停損、新風險旗標', () => {
    const by = new Map([
      ['A', row({ code: 'A', close: 89 })],
      ['B', row({ code: 'B', close: 92 })],
      ['C', row({ code: 'C', close: 120, flags: [{ id: 'x', label: '處置股', level: 'danger' }], new_flags: ['x'] })],
      ['D', row({ code: 'D', close: 120 })],
    ]);
    const out = holdingAlerts(['A', 'B', 'C', 'D'].map((c) => trade({ id: c, code: c })), by);
    const byCode = Object.fromEntries(out.map((a) => [a.trade.code, a]));
    expect(byCode.A.items[0].label).toContain('觸及停損');
    expect(byCode.B.items[0].label).toContain('接近停損');
    expect(byCode.C.items[0].label).toContain('新風險旗標');
    expect(byCode.D.risk).toBe(false);
    expect(out[0].trade.code).toBe('A');
  });
});

describe('流程（遊戲化只獎勵流程）', () => {
  const day = '2026-09-24';
  it('三環（相容層）：簡報、進場（沒有新持倉＝不適用）、檢討', () => {
    const closed = trade({ id: 'c', status: 'closed', openedAt: '2026-09-10', closedAt: '2026-09-18', exit: 95 });
    let r = ritualRings(day, [], [closed], day);
    expect(r.rings.map((x) => x.done)).toEqual([false, true, false]);
    expect(r.rings[2].action?.href).toContain('review=c');
    r = ritualRings(day, [act('brief_read', day)], [{ ...closed, review: '依計畫出場', reviewedAt: '2026-09-19T12:00:00Z' }], day);
    expect(r.complete).toBe(true);
  });
  it('舊版連續天數（相容層）只看交易日', () => {
    const tradingDays = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];
    const acts = ['2026-09-21', '2026-09-22', '2026-09-23'].map((d) => act('ritual_done', d));
    expect(streaks(tradingDays, acts)).toEqual({ current: 3, best: 3 });
  });
  it('等級門檻 100 × (2^(n−1) − 1)', () => {
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(100).level).toBe(2);
    expect(levelFor(299).level).toBe(2);
    expect(levelFor(300).level).toBe(3);
    expect(levelFor(699).level).toBe(3);
    expect(levelFor(700).level).toBe(4);
  });
  it('成就不看損益與交易次數；舊規則的守住停損只用於沒有出場原因的舊交易', () => {
    const respected = trade({ id: 'r', status: 'closed', exit: 90, stop: 90 });
    expect(stopRespected(respected)).toBe(true);
    expect(stopRespected(trade({ id: 'i', status: 'closed', exit: 70, stop: 90 }))).toBe(false);
    expect(stopRespected({ ...respected, exit: 120 })).toBe(false);
    // D-01：分割後以換算的停損判斷（原停損 90、分割因子 0.5 → 45）
    expect(stopRespected(trade({ id: 's', status: 'closed', exit: 45, stop: 90, adjFactor: 0.5 }))).toBe(true);
    const bs = badges({});
    expect(bs).toHaveLength(8);
    expect(bs.every((b) => !['trades', 'profit', 'orders', 'pnl', 'win_rate'].includes(b.metric))).toBe(true);
    expect(uiConfig.gamification.badges.map((b) => b.metric)).not.toContain('checklists');
  });
});

describe('衝動攔截', () => {
  it('資金環境保守、高於 20 日均線過多、短期漲幅過大時列出事實', () => {
    const env = envInfo([L('ma240', 'red')]);
    const facts = impulseFacts(row({ ma20_gap: 14.8, price_change_5d: 17.4 }), env);
    expect(facts).toHaveLength(3);
    expect(impulseFacts(row({ ma20_gap: 2 }), envInfo([L('a', 'yellow')]))).toEqual([]);
  });
});

describe('持股組合走勢與結論句', () => {
  it('以現有股數 × 還原價計算，最新一日等於市值', () => {
    const h = { code: '2330', d: ['a', 'b'], c: [100, 50], af: [0.5, 1] } as never;
    const s = holdingsSeries([trade({ shares: 10 })], [h])!;
    expect(s.values).toEqual([500, 500]);
  });
  it('結論句不含交易建議字眼', () => {
    const text = tonightConclusion({ holdings: 3, alerts: 2, env: 'conservative', watchChanges: 1 });
    expect(text).toBe('持股\u00a02\u00a0檔需要注意，資金環境偏保守。');
    expect(text).not.toMatch(/買進|賣出/);
  });
  it('我的股票頁首副資訊以數字陳述（2026-10-03：不寫敘事句）', () => {
    expect(mineConclusion({ watchCount: 8, watchChanges: 2, holdings: 0, alerts: 0 })).toBe('自選\u00a08\u00a0檔・異動\u00a02\u00a0檔');
    expect(mineConclusion({ watchCount: 8, watchChanges: 2, holdings: 3, alerts: 1 })).toBe('自選\u00a08\u00a0檔・異動\u00a02\u00a0檔・持倉\u00a03\u00a0檔・警示\u00a01\u00a0檔');
    expect(mineConclusion({ watchCount: 0, watchChanges: 0, holdings: 0, alerts: 0 })).toBe('無自選股');
    expect(holdConclusion({ holdings: 2, alerts: 0, dir: 'up', periodName: '近 3 個月' })).toBe('持倉\u00a02\u00a0檔・近 3 個月上漲・警示\u00a00\u00a0檔');
    expect(holdConclusion({ holdings: 0, alerts: 0, dir: 'flat', periodName: '' })).toBe('無持倉');
  });
  it('結論句每個子句不超過 12 個全形字寬（手機寬度最多兩行）', () => {
    const width = (s: string) => [...s].reduce((w, ch) => w + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55), 0);
    const all = [
      tonightConclusion({ holdings: 3, alerts: 12, env: 'conservative', watchChanges: 1 }),
      tonightConclusion({ holdings: 0, alerts: 0, env: 'unknown', watchChanges: 12 }),
    ];
    // 我的股票的副資訊是一行 Footnote（寬約 27 個全形字）
    for (const s of [mineConclusion({ watchCount: 88, watchChanges: 12, holdings: 3, alerts: 12 })]) expect(width(s)).toBeLessThanOrEqual(27);
    for (const s of all) {
      const clauses = s.split(/(?<=[，。])/);
      expect(clauses.length).toBeLessThanOrEqual(2);
      for (const c of clauses) expect(width(c)).toBeLessThanOrEqual(12.5);
    }
  });
});

/** 2026-10-02 手機版面健檢：共用樣式的規則（詳細的像素驗收在 e2e/layout.spec.ts；這裡守住 CSS 不被改回去）。 */
describe('共用版面樣式（styles/*.css）', () => {
  const css = (name: string) => readFileSync(new URL(`../styles/${name}`, import.meta.url), 'utf8');
  const tokens = css('tokens.css'), global = css('global.css'), evidence = css('evidence.css'), tools = css('tools.css');
  /** 取出某個選擇器的宣告（第一個完全相符的規則） */
  const rule = (sheet: string, selector: string) => {
    const i = sheet.indexOf(`${selector} {`);
    expect(i, `找不到規則 ${selector}`).toBeGreaterThanOrEqual(0);
    return sheet.slice(i, sheet.indexOf('}', i));
  };
  it('內容底部留白＝導覽列＋safe-area＋16px；頁尾上方 32px（不用會歸零邊距的 margin-top: auto）', () => {
    // 內容底部留白＝導覽列高度（e2e ux-fixes 規則 1 的既定規則）；頁尾自己的下邊距提供呼吸空間
    // 分頁列浮在 safe-area 之上（--dock-pad ＝ max(safe-area, 8)）：最後一列完整捲出
    expect(tokens).toMatch(/--dock-clear:\s*calc\(var\(--tabbar-h\) \+ var\(--dock-pad\) \+ var\(--s-4\)\)/);
    expect(rule(global, '.app')).toMatch(/padding:[^;]*var\(--dock-clear\)/);
    expect(rule(global, '.app > .footer')).toContain('margin-top: var(--s-8)');
    expect(rule(global, '.app > .footer')).not.toContain('auto');
    expect(global).toMatch(/\n\.footer \{[^}]*margin: var\(--s-8\) var\(--gutter\) var\(--s-4\)/);
  });
  it('表頭預設不固定，只有 .ev-sticky／.cd-long 的長表才 sticky，且實心底色、top 用 --bench-h 而不是魔術數字', () => {
    expect(rule(evidence, '.ev-table thead th')).toContain('position: static');
    expect(rule(evidence, '.ev-table thead th')).toContain('background: var(--surface-1)');
    expect(rule(evidence, '.ev-table.ev-sticky thead th')).toContain('position: sticky');
    expect(rule(evidence, '.has-bench .ev-table.ev-sticky thead th')).toContain('var(--bench-h)');
    expect(evidence).not.toMatch(/\.has-bench \.ev-table thead th \{[^}]*var\(--tap\) \+ var\(--s-4\)/);
    expect(global).toContain('.cd-table thead th { position: static; background: var(--surface-1); }');
    expect(global).not.toMatch(/\n\.cd-table thead th \{[^}]*position: sticky/);
    expect(rule(global, '.cd-table.cd-long thead th')).toContain('position: sticky');
    expect(tokens).toMatch(/--bench-h:\s*calc\(var\(--tap\)/);
  });
  it('基準分段控制列不透明（--bg）、高度＝--bench-h；有控制列的頁面標題帶 scroll-margin-top', () => {
    const bar = rule(evidence, '.bench-bar');
    expect(bar).toContain('background: var(--bg)');
    expect(bar).toContain('height: var(--bench-h)');
    expect(bar).toContain('var(--line)');
    expect(evidence).toMatch(/\.has-bench \.st-h, \.has-bench \.ev-h, \.has-bench \.section[^{]*\{ scroll-margin-top: calc\(var\(--safe-top\) \+ var\(--bench-h\)/);
    // 清單容器用 clip：hidden 會讓 sticky 黏不住
    expect(evidence).toContain('.ev-list { overflow: clip; }');
  });
  it('狀態標籤列：.tags／.ev-tags／.st-tags 同一條規則，橫排靠左可換行、間距 8', () => {
    const r = rule(evidence, '.tags, .ev-tags, .st-tags');
    expect(r).toContain('display: flex');
    expect(r).toContain('flex-wrap: wrap');
    expect(r).toContain('justify-content: flex-start');
    expect(r).toContain('gap: var(--s-2)');
    expect(evidence).not.toMatch(/\.(ev|st)-tags \{[^}]*flex-direction: column/);
  });
  it('表格列標題與 .ev-wrap／.ev-kv 可換行；數字與單位不拆開（keep-all＋overflow-wrap: anywhere）', () => {
    expect(evidence).toMatch(/\.ev-table tbody th\[scope='row'\], \.ev-table th\.ev-wrap, \.ev-table td\.ev-wrap, \.ev-table \.ev-kv \{[^}]*white-space: normal/);
    expect(rule(global, '.caption, .ev-sub, .mg-k, .mg-s, .kv-v, td, th')).toContain('word-break: keep-all');
    expect(rule(global, '.caption, .ev-sub, .mg-k, .mg-s, .kv-v, td, th')).toContain('overflow-wrap: anywhere');
    expect(rule(global, '.caption, .ev-sub, .mg-k, .mg-s, .kv-v, td, th')).toContain('line-break: strict');
    expect(rule(evidence, '.ev-sub')).toContain('white-space: normal');
    // 三段績效表：第一欄 28%、段名一行、數字 14px（≥ 13px 下限）
    expect(evidence).toContain('.ev-table.ev-seg th:first-child, .ev-table.ev-seg td:first-child { width: 28%; }');
    expect(rule(evidence, '.ev-table.ev-seg .seg-name')).toContain('white-space: nowrap');
    expect(rule(evidence, '.ev-table.ev-seg td')).toContain('font-size: 0.875rem');
  });
  it('四級灰階墨色 --ink-1～4 只定義一次（只做深色），環與比例條都用它', () => {
    expect(tokens.match(/--ink-1:/g)).toHaveLength(1);
    expect(tokens.match(/--ink-4:/g)).toHaveLength(1);
    for (const n of [1, 2, 3, 4]) expect(global).toContain(`.ring.ink-${n} .ring-arc, .rings4 > :nth-child(${n}) .ring .ring-arc { stroke: var(--ink-${n}); }`);
    expect(global).toContain('.rings3 .arc.ink-2 { stroke: var(--ink-2); }');
    expect(global).toContain('.discipline .legend i.ink-3 { background: var(--ink-3); }');
    expect(global).not.toMatch(/\.rings3 \.arc \{[^}]*stroke: var\(--text-1\)/);
    // 籌碼結構比例條：.sb-seg（新名）與 .st-bar > .st-seg（Structure.tsx 改名前）都套四級墨色，不再用透明度
    for (const [tier, ink] of [['retail', 4], ['mid', 3], ['big', 2], ['whale', 1]] as const) {
      expect(tools).toContain(`.sb-seg.${tier}, .st-bar > .st-seg.${tier}, .st-item.${tier} .st-swatch { background: var(--ink-${ink}); }`);
    }
    expect(tools).not.toContain('color-mix(in srgb, var(--text-1)');
    // evidence.css 的分段控制 .st-seg 只套在 .segmented 上，不再與比例條撞名
    expect(evidence).not.toMatch(/^\.st-seg \{/m);
    expect(evidence).toContain('.segmented.st-seg {');
  });
  it('功能卡等高、圖示列固定 24px、狀態最多 2 行；精簡空狀態 .empty.compact 一列排版', () => {
    const tile = rule(global, '.tile');
    expect(tile).toContain('display: grid');
    expect(tile).toContain('grid-template-rows: 1.5rem');
    expect(tile).toContain('min-height: 8rem');
    expect(rule(global, '.tile-grid')).toContain('gap: var(--s-3)');
    expect(rule(global, '.tile-status')).toContain('-webkit-line-clamp: 2');
    const empty = rule(global, '.empty.compact');
    expect(empty).toContain('display: flex');
    expect(empty).toContain('text-align: left');
    expect(rule(global, '.empty.compact .ico')).toContain('width: 1.25rem');
  });
  it('日期工程師要的小修：資料日列緊接狀態列、階段前綴主色、走勢圖 SVG 文字 13px（2026-10 改版：最小字級 12、每頁 4 種字級）；區間提示框不再往上翻（HeroChart 以 inline top 定位）', () => {
    expect(rule(global, '.asof-line')).toContain('margin-top: 0');
    expect(rule(global, '.stage-prefix')).toContain('color: var(--text-1)');
    const svgText = rule(global, '.chart-hilo text, .chart-dates text');
    expect(svgText).toContain('font-size: 13px');
    expect(svgText).toContain('fill: var(--text-2)');
    const tip = rule(global, '.range-tip');
    expect(tip).not.toContain('-100%');
    expect(tip).not.toMatch(/top: calc\(-1/);
    // 卡片容器用 clip：hidden 會讓裡面的 sticky 表頭黏不住（與 .ev-list、.cd-wrap 同一個做法）
    expect(global).toContain('.card.flush { overflow: clip; }');
  });
  it('累積超額曲線的無障礙說明：沒有峰值時寫原因，不輸出「第 — 日」；2026-10-03 移除 alpha 耗盡、標示峰值在窗邊界', () => {
    const ac = readFileSync(new URL('../components/AlphaCurve.tsx', import.meta.url), 'utf8');
    expect(ac).not.toContain("峰值第 ${line.peak ?? '—'} 日");
    expect(ac).toContain("missing('曲線資料累積中')");
    expect(ac).not.toContain('耗盡');
    expect(ac).toContain('EDGE_TEXT');
  });
  it('柱狀圖有日期軸列（11px 下限）；BenchSwitch 不再用玻璃', () => {
    expect(rule(global, '.nb-dates')).toContain('font-size: var(--fs-micro)');
    expect(rule(global, '.netbars-plot')).toContain('display: grid');
    const bench = readFileSync(new URL('../components/BenchSwitch.tsx', import.meta.url), 'utf8');
    expect(bench).not.toContain('bench-bar glass');
  });
});
