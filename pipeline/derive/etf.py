"""主動式 ETF：清單（代號 00xxxA）、每日持股變化、跨檔加碼／減碼排行、個股被哪些主動式 ETF 持有。

持股資料來源（etf_holdings：date, etf, code, name, shares, weight）目前為「資料源待處理」：
各投信官網 PCF 格式各異且部分有防爬機制，依規則不繞過；資料一旦進入 data 分支即自動生效。
"""

from __future__ import annotations

import re
from typing import Any

import pandas as pd

ACTIVE_RE = re.compile(r"^00\d{3,4}A$")


def active_etfs(p: Any) -> list[dict[str, Any]]:
    out = []
    for code in p.codes:
        if not ACTIVE_RE.match(code):
            continue
        c = p.close[code].dropna()
        if c.empty:
            continue
        v = p.value[code].iloc[-20:].mean()
        out.append(
            {
                "code": code,
                "name": p.names.get(code, code),
                "market": p.markets.get(code),
                "close": float(c.iloc[-1]),
                "value_million_20d": round(float(v) / 1e6, 1) if v == v else None,
            }
        )
    return sorted(out, key=lambda x: -(x["value_million_20d"] or 0))


def holdings_changes(h: pd.DataFrame) -> pd.DataFrame:
    """每檔 ETF 最新一日與前一次揭露的持股股數差。"""
    if h.empty:
        return pd.DataFrame(columns=["etf", "code", "name", "date", "shares", "weight", "change_shares"])
    rows = []
    for etf, part in h.groupby("etf"):
        dates = sorted(part["date"].unique())
        cur = part[part["date"] == dates[-1]].set_index("code")
        prev = part[part["date"] == dates[-2]].set_index("code") if len(dates) >= 2 else None
        codes = set(cur.index) | (set(prev.index) if prev is not None else set())
        for code in codes:
            now = float(cur["shares"].get(code, 0) or 0)
            before = float(prev["shares"].get(code, 0) or 0) if prev is not None else None
            rows.append(
                {
                    "etf": etf,
                    "code": code,
                    "name": cur["name"].get(code)
                    if code in cur.index
                    else prev["name"].get(code)
                    if prev is not None
                    else code,
                    "date": dates[-1],
                    "shares": now,
                    "weight": cur["weight"].get(code) if code in cur.index else 0.0,
                    "change_shares": None if before is None else now - before,
                }
            )
    return pd.DataFrame(rows)


def ranking(changes: pd.DataFrame, close: dict[str, float], top: int = 30) -> dict[str, list[dict[str, Any]]]:
    if changes.empty:
        return {"add": [], "reduce": []}
    ch = changes.dropna(subset=["change_shares"])
    agg = []
    for code, part in ch.groupby("code"):
        net = float(part["change_shares"].sum())
        adders = int((part["change_shares"] > 0).sum())
        reducers = int((part["change_shares"] < 0).sum())
        px = close.get(code)
        agg.append(
            {
                "code": code,
                "name": part["name"].iloc[0],
                "etfs": adders if net > 0 else reducers,
                "net_shares": net,
                "net_value": round(net * px / 1e8, 2) if px else None,
                "detail": "、".join(f"{r.etf} {r.change_shares:+,.0f}" for r in part.itertuples() if r.change_shares),
            }
        )
    df = pd.DataFrame(agg)
    add = df[df["net_shares"] > 0].sort_values(["etfs", "net_shares"], ascending=False).head(top)
    red = df[df["net_shares"] < 0].sort_values(["etfs", "net_shares"], ascending=[False, True]).head(top)
    return {"add": add.to_dict("records"), "reduce": red.to_dict("records")}


def holders_by_stock(changes: pd.DataFrame, names: dict[str, str]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for r in changes.itertuples():
        if not r.shares:
            continue
        out.setdefault(r.code, []).append(
            {
                "etf": r.etf,
                "name": names.get(r.etf, r.etf),
                "weight": r.weight,
                "change_shares": r.change_shares,
                "date": r.date,
            }
        )
    return out
