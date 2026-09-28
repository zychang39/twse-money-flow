import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Loading } from './components/DataStatus';

/** 頁面程式碼分割：第一次進入頁面才下載該頁的 JS。 */
export function lazy<P extends object>(loader: () => Promise<{ default: ComponentType<P> }>): ComponentType<P> {
  let cached: ComponentType<P> | null = null;
  return function Lazy(props: P) {
    const [Comp, setComp] = useState<ComponentType<P> | null>(() => cached);
    const [error, setError] = useState<Error | null>(null);
    useEffect(() => {
      if (cached) return;
      loader().then((m) => { cached = m.default; setComp(() => m.default); }).catch(setError);
    }, []);
    if (error) return <div class="banner danger">頁面載入失敗：{error.message}（請檢查網路後重新整理）</div>;
    return Comp ? <Comp {...props} /> : <Loading />;
  };
}

/** 從模組取出具名匯出的元件並延後載入（個股頁下方區塊：主角區與區塊標題先畫，細節元件在背景下載）。 */
export function lazyPick<M, K extends keyof M>(loader: () => Promise<M>, key: K): M[K] {
  const load = (): Promise<{ default: ComponentType<object> }> => loader().then((m) => ({ default: m[key] as unknown as ComponentType<object> }));
  return lazy(load) as unknown as M[K];
}
