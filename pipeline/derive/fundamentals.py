"""季財報衍生：單季毛利率、毛利率年增（百分點）、年化 ROE；依法定期限生效（無前視）。"""

from __future__ import annotations

from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.derive.metrics import as_of_panel


def effective_date(year: int, quarter: int) -> str:
    deadlines = config.thresholds()["backtest"]["financial_deadlines"]
    m, d = (int(x) for x in str(deadlines[f"Q{quarter}"]).split("-"))
    return date(year + 1 if quarter == 4 else year, m, d).isoformat()


def _single_quarter(cur_row: Any, prev_row: Any, q: int, field: str) -> float | None:
    cur = getattr(cur_row, field)
    if cur is None or cur != cur:
        return None
    if q == 1:
        return float(cur)
    pv = getattr(prev_row, field)
    return float(cur) - float(pv) if pv is not None and pv == pv else None


def quarterly(fin: pd.DataFrame) -> pd.DataFrame:
    """YTD → 單季。回傳 code, year, quarter, rev_q, gp_q, ni_q, eps_q, equity, gm_q（EPS 為基本每股盈餘，YTD 相減）。"""
    if fin.empty:
        return pd.DataFrame()
    fin = fin.sort_values(["code", "year", "quarter"]).drop_duplicates(["code", "year", "quarter"], keep="last")
    out = []
    for code, part in fin.groupby("code"):
        by = {(int(r.year), int(r.quarter)): r for r in part.itertuples()}
        for (y, q), r in by.items():
            prev = by.get((y, q - 1)) if q > 1 else None
            if q > 1 and prev is None:
                continue  # 缺上一季 YTD，無法拆出單季

            rev, gp, ni = (_single_quarter(r, prev, q, f) for f in ("revenue", "gross_profit", "ni_parent"))
            eps = _single_quarter(r, prev, q, "eps") if hasattr(r, "eps") else None
            out.append(
                {
                    "code": code,
                    "year": y,
                    "quarter": q,
                    "rev_q": rev,
                    "gp_q": gp,
                    "ni_q": ni,
                    "eps_q": eps,
                    "equity": r.equity_parent,
                    "gm_q": gp / rev * 100 if gp is not None and rev else None,
                }
            )
    return pd.DataFrame(out)


def fundamental_records(fin: pd.DataFrame) -> pd.DataFrame:
    q = quarterly(fin)
    if q.empty:
        return pd.DataFrame(columns=["code", "effective", "gross_margin_change", "roe", "gross_margin"])
    rows = []
    for code, part in q.groupby("code"):
        part = part.sort_values(["year", "quarter"]).reset_index(drop=True)
        key = {(int(r.year), int(r.quarter)): r for r in part.itertuples()}
        for i, r in part.iterrows():
            y, qq = int(r["year"]), int(r["quarter"])
            ly = key.get((y - 1, qq))
            pq = key.get((y, qq - 1)) if qq > 1 else key.get((y - 1, 4))
            gm = r["gm_q"]
            base = ly.gm_q if ly is not None else (pq.gm_q if pq is not None else None)
            gmc = gm - base if gm is not None and gm == gm and base is not None and base == base else None
            last4 = part.iloc[max(0, i - 3) : i + 1]["ni_q"].dropna()
            eq = r["equity"]
            roe = None
            if len(last4) and eq and eq == eq and eq > 0:
                roe = float(last4.sum()) * (4 / len(last4)) / float(eq) * 100
            rows.append(
                {
                    "code": code,
                    "effective": effective_date(y, qq),
                    "gross_margin_change": gmc,
                    "roe": roe,
                    "gross_margin": gm,
                }
            )
    return pd.DataFrame(rows)


def fundamental_panels(fin: pd.DataFrame, dates: list[str], codes: list[str]) -> dict[str, pd.DataFrame]:
    rec = fundamental_records(fin)
    if rec.empty:
        return {}
    out: dict[str, pd.DataFrame] = {}
    for col in ("gross_margin_change", "roe", "gross_margin"):
        part = rec[["code", "effective", col]].rename(columns={col: "v"}).copy()
        part["v"] = pd.to_numeric(part["v"], errors="coerce")
        out[col] = as_of_panel(part, "v", dates, codes)
    return out


def latest_table(fin: pd.DataFrame, code: str, n: int = 8) -> list[dict[str, Any]]:
    q = quarterly(fin[fin["code"] == code]) if not fin.empty else pd.DataFrame()
    if q.empty:
        return []
    q = q.sort_values(["year", "quarter"]).reset_index(drop=True)
    out = []
    for i, r in q.iterrows():
        # ROE（近四季，年化）＝近四季單季淨利合計 × 4 ÷ 季數 ÷ 當季歸屬母公司權益 × 100（同 fundamental_records）
        last4 = q.iloc[max(0, i - 3) : i + 1]["ni_q"].dropna()
        eq = r["equity"]
        roe = (
            float(last4.sum()) * (4 / len(last4)) / float(eq) * 100
            if len(last4) and eq and eq == eq and eq > 0
            else None
        )
        eps = r.get("eps_q")
        out.append(
            {
                "period": f"{int(r['year'])}Q{int(r['quarter'])}",
                "revenue": r["rev_q"],
                "gross_margin": None if r["gm_q"] is None or r["gm_q"] != r["gm_q"] else round(r["gm_q"], 2),
                "net_income": r["ni_q"],
                "eps": None if eps is None or eps != eps else round(float(eps), 2),
                "roe": None if roe is None else round(roe, 2),
            }
        )
    return out[-n:]


_ = np
