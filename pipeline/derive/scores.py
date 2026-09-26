"""分數系統（依 config/scores.yml）：因子原始值 → 0–100 子分數 → 類別分 → 綜合分。

向量化計算整個面板（逐日），最新一日供前端顯示，歷史供回測使用。
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.derive.metrics import MetricPanels

# 因子 id → 指標面板名稱
FACTOR_PANEL = {
    "foreign_streak": "foreign_streak",
    "trust_streak": "trust_streak",
    "margin_change": "margin_change_5d",
    "whale_change": "whale_change",
    "sbl_change": "sbl_change",
    "foreign_hold_change": "foreign_hold_change",
    "rs_percentile": "rs_percentile",
    "dist_52w_high": "dist_52w_high",
    "ma20_gap": "ma20_gap",
    "ma60_gap": "ma60_gap",
    "ma240_gap": "ma240_gap",
    "revenue_yoy_3m": "revenue_yoy_3m",
    "revenue_yoy_trend": "revenue_yoy_trend",
    "revenue_high_ratio": "revenue_high_ratio",
    "gross_margin_change": "gross_margin_change",
    "roe": "roe",
    "pe_percentile": "pe_percentile",
    "pb_percentile": "pb_percentile",
    "dividend_yield": "dividend_yield",
    "fair_value_position": "fair_value_position",
}
CATEGORIES = ["chip", "momentum", "fundamental", "valuation"]


def map_linear(x: Any, x0: float, x1: float) -> Any:
    return 100 * np.clip((x - x0) / (x1 - x0), 0, 1)


def map_score(x: Any, mapping: dict[str, Any], price_change: Any = None) -> Any:
    kind = mapping["type"]
    if kind == "linear":
        return map_linear(x, float(mapping["x0"]), float(mapping["x1"]))
    if kind == "identity":
        return np.clip(x, 0, 100)
    if kind == "inverse":
        return 100 - np.clip(x, 0, 100)
    if kind == "margin_matrix":
        th = float(mapping["threshold_pct"])
        sc = mapping["scores"]
        xa = np.asarray(x, dtype=float)
        pa = np.asarray(price_change, dtype=float)
        out = np.select(
            [xa > th, xa < -th],
            [
                np.where(pa < 0, sc["up_price_down"], sc["up_price_up"]),
                np.where(pa < 0, sc["down_price_down"], sc["down_price_up"]),
            ],
            default=sc["flat"],
        ).astype(float)
        out[np.isnan(xa) | np.isnan(pa)] = np.nan
        return pd.DataFrame(out, index=x.index, columns=x.columns) if isinstance(x, pd.DataFrame) else out
    raise ValueError(f"未知的 mapping：{kind}")


def weighted_mean(parts: list[tuple[pd.DataFrame, float]]) -> pd.DataFrame:
    """缺值不計，權重重新正規化；全部缺值 → NaN。"""
    num = None
    den = None
    for frame, w in parts:
        valid = frame.notna()
        term = frame.fillna(0) * w
        wt = valid.astype(float) * w
        num = term if num is None else num + term
        den = wt if den is None else den + wt
    assert num is not None and den is not None
    return (num / den).where(den > 0)


def compute_scores(mp: MetricPanels, weights: dict[str, float] | None = None) -> dict[str, pd.DataFrame]:
    cfg = config.scores()
    out: dict[str, pd.DataFrame] = {}
    for cat in CATEGORIES:
        parts = []
        for f in cfg["categories"][cat]["factors"]:
            raw = mp.get(FACTOR_PANEL[f["id"]])
            price = mp.get("price_change_5d") if f["mapping"]["type"] == "margin_matrix" else None
            score = map_score(raw, f["mapping"], price)
            out[f"f_{f['id']}"] = score
            parts.append((score, float(f["weight"])))
        out[cat] = weighted_mean(parts)
    w = weights or cfg["composite"]["weights"]
    cats = [(out[c], float(w[c])) for c in CATEGORIES]
    composite = weighted_mean(cats)
    available = sum(out[c].notna().astype(int) for c in CATEGORIES)
    out["composite"] = composite.where(available >= 2)
    return out


def factor_detail(mp: MetricPanels, scores: dict[str, pd.DataFrame], code: str) -> dict[str, Any]:
    """單檔最新一日的分數明細：每個因子的原始值、子分數與說明。"""
    cfg = config.scores()
    cats: dict[str, Any] = {}
    for cat in CATEGORIES:
        factors = []
        for f in cfg["categories"][cat]["factors"]:
            raw = mp.last(FACTOR_PANEL[f["id"]], code)
            sc = scores[f"f_{f['id']}"][code].iloc[-1] if code in scores[f"f_{f['id']}"].columns else np.nan
            detail = None
            if f["id"] == "margin_change":
                pc = mp.last("price_change_5d", code)
                if raw is not None and pc is not None:
                    detail = f"融資 5 日 {raw:+.1f}%、股價 5 日 {pc:+.1f}%"
            factors.append(
                {"id": f["id"], "raw": _r(raw), "score": _r(sc, 0), **({"detail": detail} if detail else {})}
            )
        cats[cat] = {"score": _r(scores[cat][code].iloc[-1], 0), "factors": factors}
    return {"composite": _r(scores["composite"][code].iloc[-1], 0), "categories": cats}


def _r(v: Any, digits: int = 2) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x or np.isinf(x):
        return None
    return round(x, digits)
