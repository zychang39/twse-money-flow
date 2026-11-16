"""生意體質（2026-11；DECISIONS #470）：簡式 ROIC、拆解、年度走勢、新增投入的報酬、生意類型。

資料只用季財報彙總表（pipeline/financials.py）已有的欄位，不增加請求：
- 稅後營業利益 NOPAT ＝ 營業利益 ×（1 − 有效稅率）；有效稅率＝所得稅 ÷ 稅前淨利，限制在 config/quality.yml 的範圍內。
- 投入資本（簡式）＝ 資產總計 − 流動負債（＝ 權益總計 ＋ 非流動負債）。沒有扣超額現金，短期借款也被排除——標示「簡式」。
- ROIC ＝ 近四季 NOPAT ÷ 期初與期末投入資本的平均（沒有一年前的資產負債表時用期末值）。
- 近四季（TTM）＝ 本季累計 ＋ 去年全年 − 去年同季累計（季財報是年初至該季的累計值）。
- 金融業的報表沒有營業利益與流動負債 → 不計算（status＝fin）。
- 面板（選股、回測用）依法定申報期限生效，沒有前視偏差；個股頁的明細用已入庫的最新一季。
"""

from __future__ import annotations

from statistics import median
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.derive.fundamentals import effective_date
from pipeline.derive.metrics import as_of_panel

Row = dict[str, float | None]
Key = tuple[int, int]
Rows = dict[Key, Row]

FIELDS = ("revenue", "ni_parent", "equity_parent", "op_income", "pretax", "tax", "total_assets", "cur_liab")
# 選股欄位（config/screener.yml）＝逐日面板
PANEL_FIELDS = ("roic", "roic_min5", "roic_chg3", "op_margin", "roe_roic_gap", "revenue_chg_3y")


def cfg() -> dict[str, Any]:
    return config.load("quality")


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None


def rows_by_code(fin: pd.DataFrame) -> dict[str, Rows]:
    """季財報（累計值）→ {代號: {(年, 季): 欄位}}。舊檔沒有的欄位視為空值。"""
    if fin.empty:
        return {}
    fin = fin.sort_values(["code", "year", "quarter"]).drop_duplicates(["code", "year", "quarter"], keep="last")
    have = [f for f in FIELDS if f in fin.columns]
    out: dict[str, Rows] = {}
    for rec in fin[["code", "year", "quarter", *have]].to_dict("records"):
        row: Row = {f: _f(rec.get(f)) for f in FIELDS}
        out.setdefault(str(rec["code"]), {})[(int(rec["year"]), int(rec["quarter"]))] = row
    return out


def ttm(rows: Rows, y: int, q: int, field: str) -> float | None:
    cur = rows.get((y, q))
    if cur is None or cur[field] is None:
        return None
    if q == 4:
        return cur[field]
    full, same = rows.get((y - 1, 4)), rows.get((y - 1, q))
    if full is None or same is None or full[field] is None or same[field] is None:
        return None
    return cur[field] + full[field] - same[field]  # type: ignore[operator]


def invested(row: Row | None) -> float | None:
    if row is None or row["total_assets"] is None or row["cur_liab"] is None:
        return None
    ic = row["total_assets"] - row["cur_liab"]
    return ic if ic > 0 else None


def tax_rate(pretax: float | None, tax: float | None) -> float:
    t = cfg()["tax"]
    if pretax is None or tax is None or pretax <= 0:
        return float(t["default"])
    return min(max(tax / pretax, float(t["min"])), float(t["max"]))


class Points:
    """一家公司各季的 ROIC 與拆解（有快取）。"""

    def __init__(self, rows: Rows) -> None:
        self.rows = rows
        self._cache: dict[Key, dict[str, Any] | None] = {}

    def at(self, y: int, q: int) -> dict[str, Any] | None:
        key = (y, q)
        if key not in self._cache:
            self._cache[key] = self._compute(y, q)
        return self._cache[key]

    def _compute(self, y: int, q: int) -> dict[str, Any] | None:
        rows = self.rows
        op, rev = ttm(rows, y, q, "op_income"), ttm(rows, y, q, "revenue")
        ic = invested(rows.get((y, q)))
        if op is None or ic is None:
            return None
        ic0 = invested(rows.get((y - 1, q)))
        avg = (ic + ic0) / 2 if ic0 is not None else ic
        # 營業虧損時沒有稅盾：NOPAT＝營業利益
        rate = tax_rate(ttm(rows, y, q, "pretax"), ttm(rows, y, q, "tax")) if op > 0 else 0.0
        nopat = op * (1 - rate)
        roic = nopat / avg * 100
        ni, eq = ttm(rows, y, q, "ni_parent"), rows[(y, q)]["equity_parent"]
        roe = ni / eq * 100 if ni is not None and eq is not None and eq > 0 else None
        has_rev = rev is not None and rev > 0
        return {
            "y": y,
            "q": q,
            "roic": roic,
            "nopat": nopat,
            "ic": ic,
            "rev": rev,
            "op_margin": op / rev * 100 if has_rev else None,  # type: ignore[operator]
            "nopat_margin": nopat / rev * 100 if has_rev else None,  # type: ignore[operator]
            "turnover": rev / avg if has_rev else None,  # type: ignore[operator]
            "roe": roe,
            "gap": roe - roic if roe is not None else None,
        }

    def quarters(self) -> list[Key]:
        return sorted(k for k in self.rows if self.at(*k) is not None)

    def annual(self, upto: Key | None = None) -> list[dict[str, Any]]:
        """年度（第 4 季＝全年）ROIC，由舊到新；upto＝只看到這一季為止（面板用，避免前視）。"""
        out = []
        for y, q in sorted(self.rows):
            if q != 4 or (upto is not None and (y, q) > upto):
                continue
            p = self.at(y, 4)
            if p is not None:
                out.append(p)
        return out


def status_of(rows: Rows) -> str:
    """ok（可以算）｜fin（金融業格式）｜none（還沒有資產負債欄位，例如舊檔尚未重抓）。"""
    latest = [rows[k] for k in sorted(rows, reverse=True)[:4]]
    if not any(r["total_assets"] is not None for r in latest):
        return "none"
    if not any(r["cur_liab"] is not None and r["op_income"] is not None for r in latest):
        return "fin"
    return "ok"


def legs(vals: list[float], swing: float) -> int:
    """走勢有幾段（一段＝由前一個高點或低點反向走了至少 swing）。"""
    if len(vals) < 2:
        return 0
    n, direction = 0, 0
    hi = lo = ext = vals[0]
    for v in vals[1:]:
        if direction == 0:
            hi, lo = max(hi, v), min(lo, v)
            if v - lo >= swing:
                direction, n, ext = 1, 1, v
            elif hi - v >= swing:
                direction, n, ext = -1, 1, v
        elif direction == 1:
            if v > ext:
                ext = v
            elif ext - v >= swing:
                direction, ext = -1, v
                n += 1
        else:
            if v < ext:
                ext = v
            elif v - ext >= swing:
                direction, ext = 1, v
                n += 1
    return n


def band_of(roic: float) -> str:
    c = cfg()
    hurdle, near = float(c["hurdle_pct"]), float(c["near_band"])
    if roic >= hurdle + near:
        return "above"
    return "below" if roic <= hurdle - near else "near"


def down_streak(vals: list[float]) -> int:
    n = 0
    for a, b in zip(reversed(vals[:-1]), reversed(vals[1:]), strict=True):
        if b < a:
            n += 1
        else:
            break
    return n


def growth_pct(new: float | None, old: float | None) -> float | None:
    if new is None or old is None or old <= 0:
        return None
    return (new / old - 1) * 100


def classify(annual: list[float], latest: float, rev_growth: float | None) -> str | None:
    """生意類型：steady｜cyclical｜fading；年度不足或都不符合 → None（只顯示高於／接近／低於門檻）。"""
    c = cfg()
    if len(annual) < int(c["history"]["min_years"]):
        return None
    hurdle = float(c["hurdle_pct"])
    t = c["types"]
    floor = hurdle + float(t["steady"]["margin"])
    last = annual[-int(t["steady"]["years"]) :]
    growing = rev_growth is not None and rev_growth > 0
    if min(last) >= floor and latest >= floor and growing:
        return "steady"
    if legs([*annual, latest], float(t["cyclical"]["swing"])) >= int(t["cyclical"]["legs"]):
        return "cyclical"
    if growing and down_streak(annual) >= int(t["fading"]["down_years"]) and latest < hurdle:
        return "fading"
    return None


def _r(v: float | None, nd: int = 1) -> float | None:
    return None if v is None or v != v else round(float(v), nd)


def detail(rows: Rows) -> dict[str, Any]:
    """個股檔的 quality 區塊（已入庫的最新一季）。金額單位：億元。"""
    st = status_of(rows)
    if st != "ok":
        return {"status": st}
    c = cfg()
    pts = Points(rows)
    keys = pts.quarters()
    if not keys:
        return {"status": "none"}
    y, q = keys[-1]
    cur = pts.at(y, q)
    assert cur is not None
    max_years = int(c["history"]["max_years"])
    annual = pts.annual()[-max_years:]
    vals = [float(p["roic"]) for p in annual]
    enough = len(vals) >= int(c["history"]["min_years"])
    span = int(c["types"]["steady"]["years"])
    rev_growth = growth_pct(annual[-1]["rev"], annual[-span]["rev"]) if len(annual) >= span else None
    inc = c["incremental"]
    old = pts.at(y - int(inc["years"]), q)
    incr = None
    if old is not None and cur["ic"] - old["ic"] > old["ic"] * float(inc["min_capital_growth_pct"]) / 100:
        incr = (cur["nopat"] - old["nopat"]) / (cur["ic"] - old["ic"]) * 100
    hurdle = float(c["hurdle_pct"])
    roic = float(cur["roic"])
    return {
        "status": "ok",
        "period": f"{y}Q{q}",
        "hurdle": hurdle,
        "roic": _r(roic),
        "spread": _r(roic - hurdle),
        "band": band_of(roic),
        "op_margin": _r(cur["op_margin"]),
        "nopat_margin": _r(cur["nopat_margin"]),
        "turnover": _r(cur["turnover"], 2),
        "roe": _r(cur["roe"]),
        "gap": _r(cur["gap"]),
        # [年度, ROIC %, 營收（億）, 營業利益率 %]
        "years": [
            [p["y"], _r(p["roic"]), _r(p["rev"] / 1e5 if p["rev"] else None), _r(p["op_margin"])] for p in annual
        ],
        # 最新一季不是第 4 季時，近四季另列（圖上的最後一點）
        "ttm": None
        if q == 4
        else [f"{y}Q{q}", _r(roic), _r(cur["rev"] / 1e5 if cur["rev"] else None), _r(cur["op_margin"])],
        "n_years": len(vals),
        "first_year": annual[0]["y"] if annual else None,
        "median": _r(median(vals)) if enough else None,
        "min": _r(min(vals)) if vals else None,
        "max": _r(max(vals)) if vals else None,
        "down_years": down_streak(vals),
        "rev_growth5": _r(rev_growth),
        "incr_roic": _r(incr),
        "type": classify(vals, roic, rev_growth),
    }


def records(fin: pd.DataFrame) -> pd.DataFrame:
    """各季的選股欄位（依法定期限生效）：code, effective, roic, roic_min5, roic_chg3, op_margin, roe_roic_gap, revenue_chg_3y。"""
    c = cfg()
    span = int(c["types"]["steady"]["years"])
    back = int(c["change_years"])
    out = []
    for code, rows in rows_by_code(fin).items():
        if status_of(rows) != "ok":
            continue
        pts = Points(rows)
        for y, q in pts.quarters():
            cur = pts.at(y, q)
            assert cur is not None
            old = pts.at(y - back, q)
            annual = [float(p["roic"]) for p in pts.annual(upto=(y, q))][-span:]
            years = [p["y"] for p in pts.annual(upto=(y, q))][-span:]
            full = len(annual) == span and years[-1] - years[0] == span - 1
            out.append(
                {
                    "code": code,
                    "effective": effective_date(y, q),
                    "roic": cur["roic"],
                    "roic_min5": min(annual) if full else None,
                    "roic_chg3": cur["roic"] - old["roic"] if old is not None else None,
                    "op_margin": cur["op_margin"],
                    "roe_roic_gap": cur["gap"],
                    "revenue_chg_3y": growth_pct(cur["rev"], old["rev"]) if old is not None else None,
                }
            )
    return pd.DataFrame(out, columns=["code", "effective", *PANEL_FIELDS])


def panels(fin: pd.DataFrame, dates: list[str], codes: list[str]) -> dict[str, pd.DataFrame]:
    rec = records(fin)
    if rec.empty:
        return {}
    out: dict[str, pd.DataFrame] = {}
    for col in PANEL_FIELDS:
        part = rec[["code", "effective", col]].rename(columns={col: "v"}).copy()
        part["v"] = pd.to_numeric(part["v"], errors="coerce")
        out[col] = as_of_panel(part, "v", dates, codes)
    return out


def build(fin: pd.DataFrame, codes: list[str]) -> dict[str, dict[str, Any]]:
    """每檔的 quality 區塊，加上 ROIC 在全市場（可計算者）的百分位 pct（0–100，越高越好）。"""
    by = rows_by_code(fin)
    out: dict[str, dict[str, Any]] = {code: detail(by[code]) if code in by else {"status": "none"} for code in codes}
    have = [(code, d["roic"]) for code, d in out.items() if d.get("roic") is not None]
    if have:
        vals = np.array([v for _, v in have], dtype=float)
        order = vals.argsort().argsort()
        for (code, _), rank in zip(have, order, strict=True):
            out[code]["pct"] = round(float(rank) / max(len(have) - 1, 1) * 100)
    return out


def chip(d: dict[str, Any]) -> str | None:
    """summary 的 biz_type：類型優先，其次高於／接近／低於門檻；金融業 fin；沒有資料 None。"""
    if d.get("status") == "fin":
        return "fin"
    if d.get("status") != "ok":
        return None
    return d.get("type") or d.get("band")
