"""主動式 ETF：清單（代號 00xxxA）、每日持股變化、跨檔加碼／減碼排行、個股被哪些主動式 ETF 持有。

持股資料（etf_holdings：date, etf, code, name, shares, weight）來自各投信官網的持股揭露／PCF
（pipeline/sources/etf_holdings.py），只涵蓋沒有反爬、導向循環或驗證機制的投信，屬「部分涵蓋」。
"""

from __future__ import annotations

import re
from typing import Any

import pandas as pd

from pipeline.core import config

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


def ranking(
    changes: pd.DataFrame, close: dict[str, float], top: int = 30, names: dict[str, str] | None = None
) -> dict[str, list[dict[str, Any]]]:
    """跨檔加碼／減碼排行；names（行情簡稱）優先，因各投信揭露的名稱有全名、有簡稱。"""
    if changes.empty:
        return {"add": [], "reduce": []}
    ch = changes.dropna(subset=["change_shares"])
    if ch.empty:
        return {"add": [], "reduce": []}
    agg = []
    for code, part in ch.groupby("code"):
        net = float(part["change_shares"].sum())
        adders = int((part["change_shares"] > 0).sum())
        reducers = int((part["change_shares"] < 0).sum())
        px = close.get(code)
        agg.append(
            {
                "code": code,
                "name": (names or {}).get(code) or part["name"].iloc[0],
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


def covered_issuers_text() -> str:
    """已實作的投信（config 的 active_etf.issuers 中 status=verified），例：「野村、群益… 5 家投信」。"""
    issuers = config.source("active_etf").get("issuers", {})
    labels = [str(c["label"]).removesuffix("投信") for c in issuers.values() if c.get("status") == "verified"]
    return f"{'、'.join(labels)} {len(labels)} 家投信（共 {len(issuers)} 家發行主動式 ETF）"


def coverage_text(changes: pd.DataFrame, total: int) -> str:
    n = int(changes["etf"].nunique()) if not changes.empty else 0
    return f"部分涵蓋：{n}／{total} 檔主動式 ETF 有持股資料，來源為{covered_issuers_text()}的官網揭露。"
