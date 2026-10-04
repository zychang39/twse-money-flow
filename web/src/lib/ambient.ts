/**
 * 環境光顏色（全站一層，見 components/Chrome.tsx AmbientLayer）：頁面以 useAmbient(mood) 指定，
 * 頁面卸載時回到中性。mood 跟隨該頁主標的當日漲跌（漲＝up、跌＝down、平或沒有主標＝neutral）。
 */
import { useEffect, useState } from 'preact/hooks';

export type AmbientMood = 'up' | 'down' | 'risk' | 'neutral' | 'flat';
let current: AmbientMood = 'neutral';
const subs = new Set<(m: AmbientMood) => void>();

export function setAmbient(m: AmbientMood): void {
  if (m === current) return;
  current = m;
  subs.forEach((f) => f(m));
}

export function getAmbient(): AmbientMood {
  return current;
}

/** 頁面指定環境光顏色；卸載時回到中性。 */
export function useAmbient(mood: AmbientMood): void {
  useEffect(() => { setAmbient(mood); }, [mood]);
  useEffect(() => () => setAmbient('neutral'), []);
}

export function useAmbientMood(): AmbientMood {
  const [m, setM] = useState(current);
  useEffect(() => {
    subs.add(setM);
    setM(current);
    return () => { subs.delete(setM); };
  }, []);
  return m;
}

/** 由漲跌值決定環境光：> 0 紅、< 0 綠、其餘中性。 */
export function moodOf(change: number | null | undefined): AmbientMood {
  if (change === null || change === undefined || !Number.isFinite(change) || change === 0) return 'neutral';
  return change > 0 ? 'up' : 'down';
}
