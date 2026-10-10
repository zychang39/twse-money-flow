"""族群大戶週流向（pipeline/derive/whaleflow.py）：分級權重、固定門檻、股本變動、族群不重複計算。"""

from __future__ import annotations

import types

import numpy as np
import pandas as pd

from pipeline.derive import whaleflow as wf
from pipeline.derive.sectors import Group, Layers

BP = [1, 5, 10, 15, 20, 30, 40, 50, 100, 200, 400, 600, 800, 1000]
CFG = {"min_value": 5e7, "weeks": 13, "max_share_change": 0.03, "breakpoints": BP}


def _rows(day: str, code: str, shares: dict[int, float]) -> list[dict]:
    """分級 1–15 的股數（沒給的級距 0）＋合計（分級 17）。"""
    full = {lv: float(shares.get(lv, 0.0)) for lv in range(1, 16)}
    rows = [{"date": day, "code": code, "level": lv, "shares": s} for lv, s in full.items()]
    rows.append({"date": day, "code": code, "level": 17, "shares": sum(full.values())})
    return rows


def _close(prices: dict[str, dict[str, float]]) -> pd.DataFrame:
    return pd.DataFrame(prices).T.sort_index()


def test_level_weights_threshold_inside_bracket_and_top_level() -> None:
    lo, hi = wf.level_bounds(BP)
    assert lo[0] == 0 and lo[14] == 1_000_000 and np.isinf(hi[14])
    # 股價 100 元 → 門檻 50 萬股（500 張），落在分級 12（40 萬–60 萬股）
    w = wf.level_weights(np.array([500_000.0]), lo, hi)[0]
    assert (w[:11] == 0).all() and (w[12:] == 1).all()
    assert np.isclose(w[11], (600_000**2 - 500_000**2) / (600_000**2 - 400_000**2))
    # 門檻剛好在分級邊界：上面一級全算、下面一級不算
    w = wf.level_weights(np.array([400_000.0]), lo, hi)[0]
    assert w[10] == 0 and w[11] == 1
    # 股價低於 50 元（門檻 > 1,000 張）：只剩千張大戶
    w = wf.level_weights(np.array([2_000_000.0]), lo, hi)[0]
    assert (w[:14] == 0).all() and w[14] == 1


def test_price_change_alone_is_not_flow_and_transfer_is() -> None:
    base = {2: 1_000_000.0, 12: 500_000.0, 15: 5_000_000.0}
    moved = {2: 0.0, 12: 500_000.0, 15: 6_000_000.0}  # 1,000 張從散戶移到千張大戶
    tdcc = pd.DataFrame(
        _rows("2026-01-02", "1101", base)
        + _rows("2026-01-09", "1101", base)  # 分布不變、股價翻倍
        + _rows("2026-01-16", "1101", moved)
    )
    close = _close({"2026-01-02": {"1101": 100.0}, "2026-01-09": {"1101": 200.0}, "2026-01-16": {"1101": 200.0}})
    weeks, flows, low = wf.stock_flows(tdcc, close, CFG)
    assert weeks == ["2026-01-02", "2026-01-09", "2026-01-16"]
    assert flows.at["1101", "2026-01-09"] == 0  # 股價上漲不會讓中實戶「升級」：前後用同一個門檻
    assert np.isclose(flows.at["1101", "2026-01-16"], 1_000_000 * 200.0)  # 股數變化 × 本週收盤
    assert low.at["1101", "2026-01-16"] == 0


def test_share_count_jump_week_is_skipped_and_proportional_growth_is_neutral() -> None:
    a = {2: 1_000_000.0, 15: 9_000_000.0}
    b = {2: 1_100_000.0, 15: 9_900_000.0}  # 配股 10%：每一級一起變多
    c = {2: 1_120_000.0, 15: 10_080_000.0}  # 再多 1.8%（可轉債轉換，比例相同）
    tdcc = pd.DataFrame(
        _rows("2026-01-02", "2002", a) + _rows("2026-01-09", "2002", b) + _rows("2026-01-16", "2002", c)
    )
    close = _close({d: {"2002": 30.0} for d in ("2026-01-02", "2026-01-09", "2026-01-16")})
    _, flows, low = wf.stock_flows(tdcc, close, CFG)
    assert np.isnan(flows.at["2002", "2026-01-09"])  # 股本變動超過 3% 的那一週不計
    assert np.isclose(flows.at["2002", "2026-01-16"], 0.0, atol=1e-6)  # 占比不變 → 不算流入
    assert low.at["2002", "2026-01-16"] == 1  # 30 元：門檻約 1,667 張，以千張大戶代替


def test_missing_price_or_week_gives_no_flow_and_etf_is_excluded() -> None:
    d = {2: 1_000_000.0, 15: 1_000_000.0}
    tdcc = pd.DataFrame(
        _rows("2026-01-02", "1101", d)
        + _rows("2026-01-09", "1101", d)
        + _rows("2026-01-02", "0050", d)
        + _rows("2026-01-09", "0050", d)
        + _rows("2026-01-09", "2330", d)  # 只有一週
    )
    close = _close(
        {
            "2026-01-02": {"1101": np.nan, "0050": 100.0, "2330": 100.0},
            "2026-01-09": {"1101": 50.0, "0050": 100.0, "2330": 100.0},
        }
    )
    _, flows, _ = wf.stock_flows(tdcc, close, CFG)
    assert list(flows.index) == ["1101"]
    assert np.isnan(flows.at["1101", "2026-01-09"])


def test_build_counts_each_stock_once_in_primary_fine_group() -> None:
    base = {2: 2_000_000.0, 15: 5_000_000.0}
    up = {2: 1_000_000.0, 15: 6_000_000.0}
    rows = []
    for code in ("1101", "1102", "2330"):
        rows += _rows("2026-01-02", code, base) + _rows("2026-01-09", code, up if code != "2330" else base)
    tdcc = pd.DataFrame(rows)
    close = _close(
        {
            "2026-01-02": {"1101": 100.0, "1102": 100.0, "2330": 100.0},
            "2026-01-09": {"1101": 100.0, "1102": 100.0, "2330": 100.0},
        }
    )
    groups = {
        "o-cement": Group(id="o-cement", layer="official", name="水泥工業", members=["1101", "1102"]),
        "o-semi": Group(id="o-semi", layer="official", name="半導體業", members=["2330"]),
        "f-a": Group(id="f-a", layer="fine", name="水泥", members=["1101", "1102"]),
        "f-b": Group(id="f-b", layer="fine", name="預拌混凝土", members=["1101"]),
        "f-c": Group(id="f-c", layer="fine", name="晶圓代工", members=["2330"]),
    }
    layers = Layers(
        groups=groups,
        fine_of={"1101": ["f-a", "f-b"], "1102": ["f-a"], "2330": ["f-c"]},
        official_of={"1101": "o-cement", "1102": "o-cement", "2330": "o-semi"},
        themes_of={},
        unassigned=[],
    )
    p = types.SimpleNamespace(close=close, names={"1101": "台泥", "1102": "亞泥", "2330": "台積電"})
    out = wf.build(p, tdcc, layers, CFG)  # type: ignore[arg-type]
    assert out is not None
    assert out["weeks"] == ["2026-01-02", "2026-01-09"]
    assert out["official"]["o-cement"]["f"] == [2.0]  # 兩檔各 1,000 張 × 100 元 ＝ 1 億
    assert out["official"]["o-cement"]["m"] == 2 and out["official"]["o-cement"]["n"] == [2]
    assert out["fine"]["f-a"]["f"] == [2.0]
    assert "f-b" not in out["fine"]  # 1101 只算在主要細產業（第一個）
    assert out["fine"]["f-a"]["c"] == ["1101", "1102"]
    assert out["official"]["o-semi"]["f"] == [0]
    assert out["total"] == [2.0]
    assert out["stocks"]["1101"] == ["台泥", [1.0], 0]
