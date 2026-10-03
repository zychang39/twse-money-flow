/**
 * 個股頁動能區塊的技術指標（M3；與 pipeline/evidence/indicators.py 同一套定義，METHODOLOGY §10.9）。純函式。
 * 全部使用還原價（開高低收 × 還原因子）；沒有收盤價的日子略過（不中斷遞迴）。
 */
type N = number | null;
const ok = (v: N | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export interface TechFacts {
  /** 20 日乖離（%）＝收盤 ÷ 20 日線 − 1 */
  bias20: number | null;
  k: number | null;
  d: number | null;
  /** K ≥ 80 的連續天數（鈍化天數；0＝目前不在高檔） */
  kdHighDays: number;
  /** MACD 柱狀（DIF − 訊號線）與 DIF */
  hist: number | null;
  dif: number | null;
  /** 柱狀圖由負轉正（正）或由正轉負（負）距今的交易日數；null＝沒有翻轉紀錄 */
  histFlipDays: number | null;
  /** ATR14（還原價，Wilder 平滑）；不足 15 日為 null（M2，2026-10-03） */
  atr14: number | null;
  /** ATR14 ÷ 最新收盤（%） */
  atrPct: number | null;
}

/** ATR(n)：真實波幅 TR＝max(高−低, |高−前收|, |低−前收|)，前 n 筆簡單平均起算、之後 Wilder 平滑；缺值日跳過。 */
export function atrLast(high: N[], low: N[], close: N[], n = 14): number | null {
  const tr: number[] = [];
  let prev: number | null = null;
  for (let i = 0; i < close.length; i++) {
    const h = high[i], l = low[i], c = close[i];
    if (!ok(h) || !ok(l) || !ok(c)) continue;
    if (prev !== null) tr.push(Math.max(h - l, Math.abs(h - prev), Math.abs(l - prev)));
    prev = c;
  }
  if (tr.length < n) return null;
  let atr = tr.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < tr.length; i++) atr = (atr * (n - 1) + tr[i]) / n;
  return atr;
}

/** KD(9,3,3)：RSV＝(收 − 9 日最低) ÷ (9 日最高 − 9 日最低) × 100（高＝低時 50）；K、D 以 ⅔ 前值 ＋ ⅓ 新值遞迴，起始 50。 */
export function kdSeries(high: N[], low: N[], close: N[], n = 9): { k: N[]; d: N[] } {
  const k: N[] = [];
  const d: N[] = [];
  let kp = 50;
  let dp = 50;
  for (let i = 0; i < close.length; i++) {
    const c = close[i];
    let rsv: number | null = null;
    if (ok(c) && i >= n - 1) {
      const hs = high.slice(i - n + 1, i + 1);
      const ls = low.slice(i - n + 1, i + 1);
      if (hs.every(ok) && ls.every(ok)) {
        const hi = Math.max(...(hs as number[]));
        const lo = Math.min(...(ls as number[]));
        rsv = hi - lo > 0 ? ((c - lo) / (hi - lo)) * 100 : 50;
      }
    }
    if (rsv === null) { k.push(null); d.push(null); continue; }
    kp = (2 / 3) * kp + rsv / 3;
    dp = (2 / 3) * dp + kp / 3;
    k.push(kp);
    d.push(dp);
  }
  return { k, d };
}

/** EMA（α＝2 ÷ (n + 1)，第一個有效值起算，略過缺值）。 */
export function ema(values: N[], n: number): N[] {
  const a = 2 / (n + 1);
  let prev: number | null = null;
  return values.map((v) => {
    if (!ok(v)) return null;
    prev = prev === null ? v : a * v + (1 - a) * prev;
    return prev;
  });
}

/** MACD(12, 26, 9)：前 warmup 個有效收盤為暖機期（null）。 */
export function macdSeries(close: N[], warmup = 60): { dif: N[]; hist: N[] } {
  const f = ema(close, 12);
  const s = ema(close, 26);
  const dif = f.map((v, i) => (ok(v) && ok(s[i]) ? v - (s[i] as number) : null));
  const sig = ema(dif, 9);
  let count = 0;
  const hist: N[] = [];
  const difOut: N[] = [];
  for (let i = 0; i < close.length; i++) {
    if (ok(close[i])) count++;
    const bad = count <= warmup || !ok(close[i]);
    difOut.push(bad ? null : dif[i]);
    hist.push(bad || !ok(dif[i]) || !ok(sig[i]) ? null : (dif[i] as number) - (sig[i] as number));
  }
  return { dif: difOut, hist };
}

export function techFacts(high: N[], low: N[], close: N[], af: number[]): TechFacts {
  const adj = (a: N[]) => a.map((v, i) => (ok(v) ? v * (af[i] ?? 1) : null));
  const H = adj(high);
  const L = adj(low);
  const C = adj(close);
  const vals = C.filter(ok);
  const last = vals.length ? vals[vals.length - 1] : null;
  const last20 = vals.slice(-20);
  const bias20 = last !== null && last20.length === 20 ? (last / (last20.reduce((a, b) => a + b, 0) / 20) - 1) * 100 : null;
  const { k, d } = kdSeries(H, L, C);
  const kk = k.filter(ok);
  const dd = d.filter(ok);
  let kdHighDays = 0;
  for (let i = kk.length - 1; i >= 0 && kk[i] >= 80; i--) kdHighDays++;
  const m = macdSeries(C);
  const hv = m.hist.filter(ok);
  const dv = m.dif.filter(ok);
  let histFlipDays: number | null = null;
  for (let i = hv.length - 1; i >= 1; i--) {
    if ((hv[i] > 0) !== (hv[i - 1] > 0)) { histFlipDays = hv.length - 1 - i; break; }
  }
  const atr14 = atrLast(H, L, C, 14);
  return {
    bias20,
    atr14,
    atrPct: atr14 !== null && last !== null && last > 0 ? (atr14 / last) * 100 : null,
    k: kk.length ? kk[kk.length - 1] : null,
    d: dd.length ? dd[dd.length - 1] : null,
    kdHighDays,
    hist: hv.length ? hv[hv.length - 1] : null,
    dif: dv.length ? dv[dv.length - 1] : null,
    histFlipDays,
  };
}

/**
 * MACD 狀態文字（柱狀的數值另外顯示）：有翻轉紀錄時「柱狀 3 日前翻正・DIF 在零軸上」（翻正已含方向，不再重複「柱狀為正」）；
 * 沒有翻轉紀錄時「柱狀為正・DIF 在零軸上」。
 */
export function macdText(t: TechFacts): string {
  if (t.hist === null) return '資料不足';
  const sign = t.hist > 0 ? '正' : '負';
  const side = t.histFlipDays === null ? `柱狀為${sign}` : t.histFlipDays === 0 ? `柱狀今日翻${sign}` : `柱狀 ${t.histFlipDays} 日前翻${sign}`;
  const zero = t.dif === null ? '' : t.dif > 0 ? '・DIF 在零軸上' : '・DIF 在零軸下';
  return `${side}${zero}`;
}

/** KD 狀態：「K 86・D 78・高檔鈍化 6 天」 */
export function kdText(t: TechFacts): string {
  if (t.k === null) return '資料不足';
  const base = `K ${Math.round(t.k)}・D ${t.d === null ? '—' : Math.round(t.d)}`;
  return t.kdHighDays > 0 ? `${base}・K ≥ 80 連 ${t.kdHighDays} 天` : base;
}
