import { useEffect, useState } from 'preact/hooks';
import { loadStock } from './data/api';
import type { StockHistory } from './data/types';
import { subscribe } from './db/db';

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error: Error) => alive && setState({ data: null, error, loading: false }));
    return () => {
      alive = false;
    };
  }, deps);
  return state;
}

/** 讀取 IndexedDB，資料變更時自動重讀。 */
export function useDb<T>(fn: () => Promise<T>, deps: unknown[] = []): T | null {
  const [value, setValue] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    let alive = true;
    fn().then((v) => alive && setValue(v)).catch((e) => console.error(e));
    return () => {
      alive = false;
    };
  }, [tick, ...deps]);
  return value;
}

/** 多檔個股歷史（清單 sparkline、組合走勢用）；逐檔載入、失敗的回傳 null。 */
export function useHistories(codes: string[]): Map<string, StockHistory | null> {
  const [map, setMap] = useState<Map<string, StockHistory | null>>(new Map());
  const key = codes.join(',');
  useEffect(() => {
    let alive = true;
    const out = new Map<string, StockHistory | null>();
    let pending = codes.length;
    if (!pending) setMap(new Map());
    for (const c of codes) {
      loadStock(c).then((h) => h, () => null).then((h) => {
        out.set(c, h);
        pending--;
        if (alive && (pending === 0 || out.size % 4 === 0)) setMap(new Map(out));
      });
    }
    return () => { alive = false; };
  }, [key]);
  return map;
}

/** 系統「減少動態效果」設定。 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
