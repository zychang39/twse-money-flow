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
    """千張大戶（分級 15）與 400 張以上（分級 12–15）比例；集保週資料於次一日公布 → 資料日 +2 天起生效。"""
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
            }
        )
    w = pd.DataFrame(rows).sort_values(["code", "date"])
    w["whale_change"] = w.groupby("code")["whale_pct"].diff()
    w["effective"] = [(date.fromisoformat(d) + timedelta(days=2)).isoformat() for d in w["date"]]
    out = {}
    for col in ("whale_pct", "whale400_pct", "whale_change"):
        out[col] = as_of_panel(w[["code", "effective", col]].rename(columns={col: "v"}), "v", dates, codes)
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
