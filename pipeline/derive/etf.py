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
        prev = float(c.iloc[-2]) if len(c) >= 2 else None
        out.append(
            {
                "code": code,
                "name": p.names.get(code, code),
                "market": p.markets.get(code),
                "close": float(c.iloc[-1]),
                # 2026-10-02 健檢：每列加漲跌幅（%）
                "change_pct": round((float(c.iloc[-1]) / prev - 1) * 100, 2) if prev else None,
                "value_million_20d": round(float(v) / 1e6, 1) if v == v else None,
            }
        )
    return sorted(out, key=lambda x: -(x["value_million_20d"] or 0))


CHANGE_COLS = ["etf", "code", "name", "date", "shares", "weight", "change_shares", "kind"]
#: 持股日變動分類（M2 2026-10-03）：new＝前次沒有、本次 > 0；exit＝前次 > 0、本次 0（剔除）；add／reduce＝股數增減；
#: hold＝不變；None＝沒有前一次揭露（只有一天資料，無法分類）
KIND_LABEL = {"new": "新增", "add": "加碼", "reduce": "減碼", "exit": "剔除", "hold": "不變"}


def change_kind(before: float | None, now: float) -> str | None:
    if before is None:
        return None
    if before <= 0 < now:
        return "new"
    if before > 0 >= now:
        return "exit"
    if now > before:
        return "add"
    if now < before:
        return "reduce"
    return "hold"


def holdings_changes(h: pd.DataFrame) -> pd.DataFrame:
    """每檔 ETF 最新一日與前一次揭露的持股股數差；kind 為變動分類（見 change_kind）。前次有、本次 0 的「剔除」列保留。"""
    if h.empty:
        return pd.DataFrame(columns=CHANGE_COLS)
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
                    "kind": change_kind(before, now),
                }
            )
    return pd.DataFrame(rows, columns=CHANGE_COLS)


def kind_counts(changes: pd.DataFrame) -> dict[str, int]:
    """各分類的（ETF × 股票）筆數：{"new": n, "add": n, "reduce": n, "exit": n}（不含 hold 與無法分類）。"""
    out = {k: 0 for k in ("new", "add", "reduce", "exit")}
    if changes.empty or "kind" not in changes.columns:
        return out
    for k, n in changes["kind"].value_counts().items():
        if k in out:
            out[str(k)] = int(n)
    return out


def _dominant_kind(kinds: list[str], positive: bool) -> str:
    """排行列的分類：加碼方全是 new → new，否則 add；減碼方全是 exit → exit，否則 reduce。"""
    if positive:
        return "new" if kinds and all(k == "new" for k in kinds) else "add"
    return "exit" if kinds and all(k == "exit" for k in kinds) else "reduce"


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
        same_side = part[(part["change_shares"] > 0) if net > 0 else (part["change_shares"] < 0)]
        kinds = [str(k) for k in same_side["kind"].tolist()] if "kind" in part.columns else []
        agg.append(
            {
                "code": code,
                "name": (names or {}).get(code) or part["name"].iloc[0],
                "etfs": adders if net > 0 else reducers,
                # 2026-10-02 健檢：兩檔以上同向才算「跨檔」；其餘是單檔持股變動（前端分開列）
                "cross": (adders if net > 0 else reducers) >= 2,
                "net_shares": net,
                "net_value": round(net * px / 1e8, 2) if px else None,
                "detail": "、".join(f"{r.etf} {r.change_shares:+,.0f}" for r in part.itertuples() if r.change_shares),
                # M2 2026-10-03：變動分類（同向的 ETF 全是新增 → new、全是剔除 → exit，否則 add／reduce）
                "kind": _dominant_kind(kinds, net > 0),
            }
        )
    df = pd.DataFrame(agg)
    add = df[df["net_shares"] > 0].sort_values(["etfs", "net_shares"], ascending=False).head(top)
    red = df[df["net_shares"] < 0].sort_values(["etfs", "net_shares"], ascending=[False, True]).head(top)
    return {"add": add.to_dict("records"), "reduce": red.to_dict("records")}


def holders_by_stock(changes: pd.DataFrame, names: dict[str, str]) -> dict[str, list[dict[str, Any]]]:
    """個股被哪些主動式 ETF 持有（含本次剔除的 ETF，kind=exit，shares 0），每列帶變動分類 kind。"""
    out: dict[str, list[dict[str, Any]]] = {}
    for r in changes.itertuples():
        kind = getattr(r, "kind", None)
        if not r.shares and kind != "exit":
            continue
        out.setdefault(r.code, []).append(
            {
                "etf": r.etf,
                "name": names.get(r.etf, r.etf),
                "weight": r.weight,
                "change_shares": r.change_shares,
                "date": r.date,
                "kind": kind if isinstance(kind, str) else None,
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
