"""還原價事件：官方除權息／減資／面額變更／分割，加上「無法解釋的價格跳空」推估。

面額變更與 ETF 分割（如 0050 於 2025 年 1 拆 4）若官方表未涵蓋，會造成還原價斷層。
推估規則（標示為 inferred，列在資料健康頁）：
1. 相鄰兩個交易紀錄的收盤價比 |r − 1| > 門檻（預設 35%，遠大於 10% 漲跌幅限制），且該日沒有官方事件；
2. 排除每檔最初 5 筆（新上市前 5 日無漲跌幅限制）；
3. 若有漲跌欄（相對參考價），參考價 = 收盤 − 漲跌，因子 = 參考價 ÷ 前收；
   否則以開盤價 ÷ 前收，貼近常見拆合比例（1/2、1/3、1/4、1/5、1/10、2、3、4、5、10）時取該比例。
"""

from __future__ import annotations

import numpy as np
import pandas as pd

NICE_RATIOS = [1 / 10, 1 / 8, 1 / 5, 1 / 4, 1 / 3, 1 / 2, 2, 3, 4, 5, 8, 10]


def snap_ratio(r: float, tolerance: float = 0.12) -> float:
    for nice in NICE_RATIOS:
        if abs(r / nice - 1) <= tolerance:
            return nice
    return r


def infer_events(
    close: pd.DataFrame,
    open_: pd.DataFrame,
    change: pd.DataFrame,
    known: set[tuple[str, str]],
    threshold: float = 0.35,
    skip_first: int = 5,
) -> pd.DataFrame:
    rows = []
    for code in close.columns:
        c = close[code].dropna()
        if len(c) <= skip_first:
            continue
        prev = c.shift(1)
        ratio = c / prev
        suspicious = ratio[(ratio - 1).abs() > threshold].index
        for d in suspicious:
            pos = c.index.get_loc(d)
            if not isinstance(pos, int) or pos < skip_first or (code, d) in known:
                continue
            p = float(prev[d])
            chg = change[code].get(d)
            if chg is not None and chg == chg:
                ref = float(c[d]) - float(chg)
                factor = ref / p if p else np.nan
                if abs(factor - 1) < 0.2:  # 漲跌欄看起來是相對前收 → 改用開盤價推估
                    o = open_[code].get(d)
                    factor = snap_ratio(float(o) / p) if o == o and o else np.nan
            else:
                o = open_[code].get(d)
                factor = snap_ratio(float(o) / p) if o is not None and o == o and o else np.nan
            if factor == factor and abs(factor - 1) > 0.2:
                rows.append({"date": d, "code": code, "factor": float(factor), "source": "inferred"})
    return pd.DataFrame(rows, columns=["date", "code", "factor", "source"])


def official_events(*frames: pd.DataFrame) -> pd.DataFrame:
    parts = []
    for df in frames:
        if df is None or df.empty or "factor" not in df.columns:
            continue
        part = df[["date", "code", "factor"]].copy()
        part["source"] = "official"
        parts.append(part)
    if not parts:
        return pd.DataFrame(columns=["date", "code", "factor", "source"])
    ev = pd.concat(parts, ignore_index=True).dropna(subset=["factor"])
    ev = ev[(ev["factor"] > 0) & np.isfinite(ev["factor"])]
    return ev.drop_duplicates(subset=["date", "code"], keep="first").reset_index(drop=True)


def all_events(close: pd.DataFrame, open_: pd.DataFrame, change: pd.DataFrame, *official: pd.DataFrame) -> pd.DataFrame:
    off = official_events(*official)
    known = set(zip(off["code"], off["date"], strict=True))
    inferred = infer_events(close, open_, change, known)
    if inferred.empty:
        return off
    return pd.concat([off, inferred], ignore_index=True)
