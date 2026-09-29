/// <reference lib="webworker" />
/** 自訂條件回測：在 Web Worker 下載精簡面板並計算（避免阻塞畫面）。 */
import { buildReport, type Panel } from '../lib/backtest';
import { screenerConfig, type Condition } from '../lib/config';

interface Meta { dates: string[]; codes: string[]; names: string[]; is_etf: boolean[]; bench: (number | null)[]; regime_up: boolean[]; fields: string[] }
interface Prices { open: (number | null)[][]; low: (number | null)[][]; close: (number | null)[][]; tradable: number[][]; blocked: [number, number][] }

const ctx = self as unknown as DedicatedWorkerGlobalScope;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}：HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

ctx.onmessage = async (e: MessageEvent<{ base: string; conditions: Condition[] }>) => {
  const { base, conditions } = e.data;
  try {
    ctx.postMessage({ type: 'progress', text: '下載回測面板…' });
    const [meta, prices] = await Promise.all([getJson<Meta>(`${base}bt/meta.json`), getJson<Prices>(`${base}bt/prices.json`)]);
    const missing = conditions.map((c) => c.field).filter((f) => !meta.fields.includes(f));
    if (missing.length) throw new Error(`回測面板缺少欄位：${missing.join('、')}（資料源待處理）`);
    const fields: Record<string, (number | null)[][]> = {};
    for (const f of new Set(conditions.map((c) => c.field))) {
      ctx.postMessage({ type: 'progress', text: `下載欄位 ${f}…` });
      fields[f] = await getJson<(number | null)[][]>(`${base}bt/f/${f}.json`);
    }
    ctx.postMessage({ type: 'progress', text: '計算中…' });
    const panel: Panel = {
      dates: meta.dates, codes: meta.codes, open: prices.open, low: prices.low, close: prices.close, tradable: prices.tradable,
      blocked: prices.blocked, bench: meta.bench, regimeUp: meta.regime_up, isEtf: meta.is_etf,
    };
    const rep = buildReport(conditions, (f) => fields[f] ?? null, panel, (f) => screenerConfig.fields[f]?.label ?? f);
    if (!rep) throw new Error('條件欄位無資料');
    const { trades_raw: raw, ...summary } = rep;
    const detail = (raw[10] ?? []).slice().sort((a, b) => b.signal.localeCompare(a.signal)).slice(0, 400).map((t) => ({
      code: t.code, signal: t.signal, entry_date: t.entryDate, exit_date: t.exitDate, entry: t.entry, exit: t.exit,
      net: t.net * 100, mae: t.mae * 100, excess: t.excess === null ? null : t.excess * 100, delisted: t.delisted,
    }));
    const names: Record<string, string> = {};
    meta.codes.forEach((c, i) => (names[c] = meta.names[i]));
    ctx.postMessage({ type: 'done', result: { ...summary, trades: detail, names, detail_horizon: 10, universe: meta.codes.length } });
  } catch (err) {
    ctx.postMessage({ type: 'error', text: (err as Error).message });
  }
};
