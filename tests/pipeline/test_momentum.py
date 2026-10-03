"""個股頁動能（stock 2026-10-03）：報酬全市場百分位、RS 20 日前、產業名次、量比；以手算預期值驗證。"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from pipeline.derive import momentum as mom
from pipeline.derive.demo import build_store
from pipeline.derive.export import build_web


def test_window_returns_and_fill():
    dates = [f"d{i:03d}" for i in range(30)]
    adj = pd.DataFrame({"A": np.linspace(100, 129, 30), "B": [50.0] * 30})
    adj.index = dates
    adj.loc["d029", "B"] = np.nan  # 最後一天沒有成交 → 沿用前一日
    r = mom.window_returns(adj, {"1M": 21, "2M": 42})
    assert r.at["A", "1M"] == pytest.approx((129 / 108 - 1) * 100)
    assert r.at["B", "1M"] == pytest.approx(0.0)
    assert np.isnan(r.at["A", "2M"])  # 歷史不足


def test_cross_pct_matches_rs_formula():
    s = pd.Series({"A": 1.0, "B": 2.0, "C": 3.0, "D": np.nan})
    p = mom.cross_pct(s)
    assert p["A"] == pytest.approx(0.5 / 3 * 100) and p["C"] == pytest.approx(2.5 / 3 * 100)
    assert np.isnan(p["D"])


def test_industry_ranks_min_members():
    ret = pd.Series({"1101": 1.0, "1102": 3.0, "1103": 5.0, "2330": 10.0, "2303": 20.0, "2454": 30.0, "9999": 50.0})
    ind = {
        "1101": "水泥",
        "1102": "水泥",
        "1103": "水泥",
        "2330": "半導體",
        "2303": "半導體",
        "2454": "半導體",
        "9999": "其他",
    }
    table, n = mom.industry_ranks(ret, ind, list(ret.index))
    assert n == 2
    assert table["半導體"] == {"median": 20.0, "members": 3, "rank": 1}
    assert table["水泥"]["rank"] == 2 and table["水泥"]["median"] == 3.0
    assert table["其他"]["rank"] is None  # 成員不足 3 檔不排名


def test_stock_file_mom_and_vol_ratio(tmp_path):
    store_dir, out = tmp_path / "data", tmp_path / "out"
    build_store(store_dir, days=300)
    build_web(store_dir, out, demo=True)
    stock = json.loads((out / "stocks" / "2330.json").read_text())
    m = stock["mom"]
    assert set(m["ret"]) == {"1M", "3M", "6M", "12M"} and m["date"] == stock["d"][-1]
    # 1M 報酬＝還原收盤 21 個交易日前到最新
    adj = [c * f for c, f in zip(stock["c"], stock["af"], strict=True)]
    assert m["ret"]["1M"] == pytest.approx((adj[-1] / adj[-22] - 1) * 100, abs=0.01)
    assert m["pct"]["1M"] is None or 0 <= m["pct"]["1M"] <= 100
    assert m["rs_prev_date"] == stock["d"][-21]
    # 量比：當日量 ÷ 前 20 日平均量（分母不含當日）
    v = stock["v"]
    avg = sum(v[-21:-1]) / 20
    assert stock["metrics"]["vol20_lots"] == pytest.approx(avg, abs=1)
    assert stock["metrics"]["vol_ratio"] == pytest.approx(v[-1] / avg, abs=0.01)
    summary = json.loads((out / "summary.json").read_text())
    assert {"vol_ratio", "vol20_lots", "rs_percentile"} <= set(summary["columns"])
