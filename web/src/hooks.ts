import { useEffect, useRef, useState } from 'preact/hooks';
import { loadState, registerState } from './lib/scrollRestore';
import { type InvestStyle, getStyle } from './lib/style';
import { loadStock, peekStock } from './data/api';
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

/**
 * 個股檔：已載入過的直接同步取用（換股時不會先變成載入中、畫面不閃）；沒有才發出請求。
 * 回傳的 loading 只在「完全沒有這檔資料」時為 true。
 */
export function useStockData(code: string): { data: StockHistory | null; error: Error | null; loading: boolean } {
  const [, bump] = useState(0);
  const [err, setErr] = useState<{ code: string; error: Error } | null>(null);
  const cached = peekStock(code) ?? null;
  useEffect(() => {
    if (peekStock(code)) return;
    let alive = true;
    loadStock(code).then(() => alive && bump((n) => n + 1), (error: Error) => alive && setErr({ code, error }));
    return () => { alive = false; };
  }, [code]);
  const error = err && err.code === code ? err.error : null;
  return { data: cached, error, loading: !cached && !error };
}

/**
 * 與歷史紀錄綁定的元件狀態（分段控制、篩選、展開）：從個股頁返回清單時還原（見 lib/scrollRestore.ts）。
 * name 在同一頁內需唯一；值需可 JSON 序列化。
 */
export function useRestoredState<T>(name: string, initial: T | (() => T)): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    const saved = loadState<T>(name);
    if (saved !== undefined) return saved;
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  const ref = useRef(v);
  ref.current = v;
  useEffect(() => registerState(name, () => ref.current), [name]);
  return [v, setV];
}

/** 投資風格（localStorage，設定頁切換時即時更新）。 */
export function useInvestStyle(): InvestStyle {
  const [s, setS] = useState<InvestStyle>(getStyle);
  useEffect(() => {
    const on = () => setS(getStyle());
    window.addEventListener('style-change', on);
    return () => window.removeEventListener('style-change', on);
  }, []);
  return s;
}
