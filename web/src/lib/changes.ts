/**
 * 變化優先：比較「上次查看時的快照」與目前資料，找出顯著變化；低於 config/ui.yml 門檻的視為雜訊。
 * 第一次使用（沒有快照）時，以前一交易日為基準（summary 內的日變化欄位）。
 */
import type { Flag, StockRow } from '../data/types';
import { uiConfig } from './config';
import { fmtLotsAbs } from './format';

export interface SnapRow { c: number | null; s: number | null; f: string[]; fs: number | null; ts: number | null; mb: number | null }
export interface Snapshot { at: string; date: string; rows: Record<string, SnapRow> }

export function snapRow(r: StockRow): SnapRow {
  return {
    c: r.close,
    s: (r.composite as number | null | undefined) ?? null,
    f: (r.flags ?? []).map((f) => f.id),
    fs: r.foreign_streak,
    ts: r.trust_streak,
    mb: r.margin_balance,
  };
}

export function makeSnapshot(rows: StockRow[], date: string, at = new Date().toISOString()): Snapshot {
  return { at, date, rows: Object.fromEntries(rows.map((r) => [r.code, snapRow(r)])) };
}

export type ReasonKind = 'price' | 'composite' | 'streak' | 'inst' | 'margin' | 'flag';
export interface Reason { kind: ReasonKind; text: string; dir?: 'up' | 'down'; risk?: boolean; weight: number }
export interface Change { code: string; row: StockRow; reasons: Reason[]; newFlags: Flag[]; significant: boolean; score: number }

type Th = typeof uiConfig.significance;

function streakText(who: string, s: number): string {
  return `${who}連${s > 0 ? '買' : '賣'} ${Math.abs(s)} 日`;
}

/** 單檔變化。prev 為上次查看的快照；沒有快照時用日變化。 */
export function diffRow(r: StockRow, prev: SnapRow | undefined, th: Th = uiConfig.significance): Change {
  const reasons: Reason[] = [];
  // 價格
  const pct = prev ? (prev.c && r.close !== null ? ((r.close - prev.c) / prev.c) * 100 : null) : r.change_pct;
  if (pct !== null && pct !== undefined && Number.isFinite(pct) && Math.abs(pct) >= th.price_pct) {
    reasons.push({ kind: 'price', text: `${prev ? '自上次' : '今日'}${pct > 0 ? '漲' : '跌'} ${Math.abs(pct).toFixed(1)}%`, dir: pct > 0 ? 'up' : 'down', weight: Math.abs(pct) });
  }
  // 綜合分
  const cur = (r.composite as number | null | undefined) ?? null;
  const dComp = prev ? (cur !== null && prev.s !== null ? cur - prev.s : null) : ((r.composite_chg as number | null | undefined) ?? null);
  if (dComp !== null && Math.abs(dComp) >= th.composite_points) {
    const from = prev?.s ?? (cur !== null ? cur - dComp : null);
    reasons.push({ kind: 'composite', text: `綜合分 ${from === null ? '—' : Math.round(from)} → ${cur === null ? '—' : Math.round(cur)}`, dir: dComp > 0 ? 'up' : 'down', weight: Math.abs(dComp) * 1.5 });
  }
  // 法人連買／連賣：新達到門檻或方向反轉
  for (const [who, now, before] of [['外資', r.foreign_streak, prev?.fs], ['投信', r.trust_streak, prev?.ts]] as const) {
    if (now === null || now === undefined) continue;
    const reached = Math.abs(now) >= th.inst_streak_days;
    const was = prev ? before !== null && before !== undefined && Math.abs(before) >= th.inst_streak_days && Math.sign(before) === Math.sign(now) : Math.abs(now) > th.inst_streak_days;
    if (reached && !was) reasons.push({ kind: 'streak', text: streakText(who, now), dir: now > 0 ? 'up' : 'down', weight: Math.abs(now) * 2 });
  }
  // 法人買賣超占成交量（當日）
  const vol = r.volume_lots ?? 0;
  const inst = (r.foreign_net_lots ?? 0) + (r.trust_net_lots ?? 0);
  if (vol > 0 && (Math.abs(inst) / vol) * 100 >= th.inst_volume_pct && !reasons.some((x) => x.kind === 'streak')) {
    reasons.push({ kind: 'inst', text: `外資＋投信淨${inst > 0 ? '買' : '賣'} ${fmtLotsAbs(inst)} 張（量的 ${Math.round((Math.abs(inst) / vol) * 100)}%）`, dir: inst > 0 ? 'up' : 'down', weight: (Math.abs(inst) / vol) * 50 });
  }
  // 融資
  const mb = r.margin_balance;
  const mbPrev = prev ? prev.mb : mb !== null && r.margin_change !== null ? mb - r.margin_change : null;
  if (mb !== null && mbPrev && mbPrev > 0) {
    const mp = ((mb - mbPrev) / mbPrev) * 100;
    if (Math.abs(mp) >= th.margin_pct) reasons.push({ kind: 'margin', text: `融資${mp > 0 ? '增加' : '減少'} ${Math.abs(mp).toFixed(1)}%`, dir: mp > 0 ? 'up' : 'down', weight: Math.abs(mp) });
  }
  // 新風險旗標
  const prevFlags = new Set(prev ? prev.f : []);
  const newIds = prev ? (r.flags ?? []).filter((f) => !prevFlags.has(f.id)).map((f) => f.id) : ((r.new_flags as string[] | undefined) ?? []);
  const newFlags = (r.flags ?? []).filter((f) => newIds.includes(f.id));
  for (const f of newFlags) reasons.push({ kind: 'flag', text: `新風險旗標：${f.label}`, risk: true, weight: 100 });
  const score = reasons.reduce((s, x) => s + x.weight, 0);
  return { code: r.code, row: r, reasons: reasons.sort((a, b) => b.weight - a.weight), newFlags, significant: reasons.length > 0, score };
}

export function diffAll(rows: StockRow[], snap: Snapshot | null, th: Th = uiConfig.significance): Change[] {
  return rows.map((r) => diffRow(r, snap?.rows[r.code], th)).sort((a, b) => Number(b.significant) - Number(a.significant) || b.score - a.score);
}

/** 「自上次查看以來」的說明文字。 */
export function sinceLabel(snap: Snapshot | null): string {
  if (!snap) return '較前一交易日';
  const d = new Date(snap.at);
  const tpe = new Date(d.getTime() + 8 * 3600 * 1000);
  const md = `${tpe.getUTCMonth() + 1}/${tpe.getUTCDate()}`;
  const hm = `${String(tpe.getUTCHours()).padStart(2, '0')}:${String(tpe.getUTCMinutes()).padStart(2, '0')}`;
  return `自上次查看（${md} ${hm}）以來`;
}
