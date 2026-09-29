"""進階資料 → 逐日面板（集保大戶、外資持股、借券、當沖、季財報）。"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.derive.dataset import pivot
from pipeline.derive.fundamentals import fundamental_panels
from pipeline.derive.metrics import as_of_panel


def whale_panels(tdcc: pd.DataFrame, dates: list[str], codes: list[str]) -> dict[str, pd.DataFrame]:
    """千張大戶（分級 15）與 400 張以上（分級 12–15）比例。

    生效日（無前視）：集保資料日期是每週最後一個營業日（通常週五；週五休市時為週四），次一日（通常週六）公布。
    生效日＝資料日 +2 天（週五 → 週日），所以第一個能使用的交易日是公布日之後的第一個交易日（通常週一）：
    週一收盤後的訊號才用到上週五的持股，週二開盤進場。週資料超過 weekly_max_age_days 個交易日沒有更新就視為缺值。
    """
    if tdcc.empty:
        return {}
    ind = config.thresholds()["indicators"]["whale"]
    rows = []
    for (d, code), part in tdcc.groupby(["date", "code"]):
        lv = part.set_index("level")["pct"]
        rows.append(
            {
                "date": d,
                "code": code,
                "whale_pct": float(lv.reindex(ind["level_1000"]).sum()),
                "whale400_pct": float(lv.reindex(ind["level_400"]).sum()),
                "whale800_pct": float(lv.reindex(ind.get("level_800", [14, 15])).sum()),
            }
        )
    w = pd.DataFrame(rows).sort_values(["code", "date"])
    w["whale_change"] = w.groupby("code")["whale_pct"].diff()
    # M3：顯示層的 400／800 張門檻也預先算好（回測與選股固定用 1,000 張）
    w["whale400_change"] = w.groupby("code")["whale400_pct"].diff()
    w["whale800_change"] = w.groupby("code")["whale800_pct"].diff()
    w["effective"] = [(date.fromisoformat(d) + timedelta(days=2)).isoformat() for d in w["date"]]
    max_age = int(config.thresholds()["backtest"].get("weekly_max_age_days", 7))
    out = {}
    for col in ("whale_pct", "whale400_pct", "whale800_pct", "whale_change", "whale400_change", "whale800_change"):
        out[col] = as_of_panel(w[["code", "effective", col]].rename(columns={col: "v"}), "v", dates, codes, max_age)
    return out


def advanced_panels(ds: Any, p: Any) -> dict[str, pd.DataFrame]:
    out: dict[str, pd.DataFrame] = {}
    dates, codes = p.dates, p.codes

    def wide(df: pd.DataFrame, col: str) -> pd.DataFrame:
        w = pivot(df, col, dates)
        return w.reindex(columns=codes) if not w.empty else pd.DataFrame(np.nan, index=dates, columns=codes)

    qfii = ds.table("qfii")
    if not qfii.empty:
        fh = wide(qfii, "foreign_pct")
        out["foreign_hold_pct"] = fh
        out["foreign_hold_change"] = fh - fh.shift(20)
    sbl = ds.table("sbl")
    if not sbl.empty:
        bal = wide(sbl, "sbl_balance")
        out["sbl_balance"] = bal
        shares = pd.Series({c: p.shares.get(c, np.nan) for c in codes})
        out["sbl_change"] = (bal - bal.shift(5)).div(shares, axis=1) * 100
    dt = ds.table("daytrade")
    if not dt.empty:
        out["daytrade_pct"] = (wide(dt, "dt_volume") / p.volume * 100).where(p.volume > 0)
    out.update(whale_panels(ds.table("tdcc"), dates, codes))
    out.update(fundamental_panels(ds.table("financials"), dates, codes))
    return out
