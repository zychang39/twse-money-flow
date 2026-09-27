"""系統清單（依規則產生，非推薦）：目前只有「熱門動能」，規則在 config/ui.yml 的 hot_momentum。"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from pipeline.core import config


def _num(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # NaN → None


def hot_momentum(rows: Sequence[Mapping[str, Any]], cfg: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """熱門動能：成交值排名前段 ∩ RS 百分位高 ∩ 風險旗標少，依 RS 百分位排序取前 N 檔。

    rows：summary 的列（dict，需含 code、name、value_million、rs_percentile、flags）。
    回傳 {label, rule, items: [{code, name, rs_percentile, value_rank, reason}]}。
    """
    c = dict(cfg or config.ui()["hot_momentum"])
    pool = [r for r in rows if not (c.get("exclude_etf", True) and str(r.get("code", "")).startswith("00"))]
    ranked = sorted(
        (r for r in pool if _num(r.get("value_million")) is not None),
        key=lambda r: -(_num(r.get("value_million")) or 0),
    )
    top = int(c["value_rank_top"])
    rank = {str(r["code"]): i + 1 for i, r in enumerate(ranked[:top])}
    picked: list[dict[str, Any]] = []
    for r in pool:
        code = str(r.get("code"))
        rs = _num(r.get("rs_percentile"))
        if code not in rank or rs is None or rs < float(c["min_rs_percentile"]):
            continue
        flags = r.get("flags") or []
        danger = sum(1 for f in flags if isinstance(f, Mapping) and f.get("level") == "danger")
        warn = sum(1 for f in flags if isinstance(f, Mapping) and f.get("level") != "danger")
        if danger > int(c["max_danger_flags"]) or warn > int(c["max_warn_flags"]):
            continue
        picked.append(
            {
                "code": code,
                "name": r.get("name"),
                "rs_percentile": round(rs, 1),
                "value_rank": rank[code],
                "reason": f"成交值第 {rank[code]} 名・RS 百分位 {rs:.0f}",
            }
        )
    picked.sort(key=lambda x: (-float(x["rs_percentile"]), int(x["value_rank"])))
    return {
        "label": c.get("label", "熱門動能"),
        "rule": {
            "value_rank_top": top,
            "min_rs_percentile": float(c["min_rs_percentile"]),
            "max_warn_flags": int(c["max_warn_flags"]),
            "max_danger_flags": int(c["max_danger_flags"]),
            "size": int(c["size"]),
            "exclude_etf": bool(c.get("exclude_etf", True)),
        },
        "items": picked[: int(c["size"])],
    }


def build_lists(cols: Sequence[str], rows: Sequence[Sequence[Any]], date: str) -> dict[str, Any]:
    records = [dict(zip(cols, r, strict=True)) for r in rows]
    return {"date": date, "hot_momentum": hot_momentum(records)}
