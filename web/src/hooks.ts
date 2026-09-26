import { useEffect, useState } from 'preact/hooks';
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
