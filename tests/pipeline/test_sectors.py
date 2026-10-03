"""族群三層與個股衍生指標（M1.2／M1.3）：產業價值鏈解析、細產業對照與名次、走勢相近、均線斜率與 ATR、期間鍵。"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from pipeline.derive import sectors, trend
from pipeline.evidence import periods
from pipeline.sources import tpex_chain

SAMPLE = Path(__file__).resolve().parents[1] / "fixtures" / "samples" / "tpex_chain_L000.html"


def test_parse_chain_sample():
    page = SAMPLE.read_text(encoding="utf-8")
    assert tpex_chain.parse_index(page)["L000"] == "印刷電路板"
    rows = tpex_chain.parse_chain(page, "L000", "印刷電路板")
    by_code = {(r.code, r.sub_id) for r in rows}
    assert ("3037", "L610") in by_code and ("8046", "L610") in by_code  # 欣興、南電：硬板、軟板、IC載板製造
    streams = {r.sub_id: r.stream for r in rows}
    assert streams["L100"] == "上游" and streams["L610"] == "中游"
    assert all(r.code.isalnum() for r in rows)
    assert len(rows) == len({(r.code, r.sub_id) for r in rows})  # 列印版的重複內容不重複計入


def test_etf_class_rules():
    rules = [
        {"id": "etf/active", "rule": {"code_suffix": "A", "name_prefix": "主動"}},
        {"id": "etf/leveraged", "rule": {"code_suffix": ["L", "R"]}},
        {"id": "etf/dividend", "rule": {"name_any": ["高股息"]}},
        {"id": "etf/market", "rule": {}},
    ]
    assert sectors.etf_class("00403A", "主動統一升級50", rules) == "etf/active"
    assert sectors.etf_class("00631L", "元大台灣50正2", rules) == "etf/leveraged"
    assert sectors.etf_class("0056", "元大高股息", rules) == "etf/dividend"
    assert sectors.etf_class("0050", "元大台灣50", rules) == "etf/market"


def _rows():
    def r(code, name, sub, stream="中游", cat=None):
        return {
            "code": code,
            "name": name,
            "chain_id": "L000",
            "chain": "印刷電路板",
            "stream": stream,
            "cat_id": cat or sub,
            "cat": "類別" + (cat or sub),
            "sub_id": sub,
            "sub": "子類" + sub,
        }

    return [
        r("3037", "欣興", "L610"),
        r("8046", "南電", "L610"),
        r("2383", "台光電", "L630"),
        r("6213", "聯茂", "L630"),
        r("1101", "台泥", "L100", "上游"),
    ]


def test_build_layers_primary_manual_assign_and_fallbacks():
    codes = ["3037", "8046", "2383", "6213", "1101", "9999", "2881", "2881A", "0050"]
    names = {"0050": "元大台灣50"}
    ind = {
        "3037": "電子零組件業",
        "8046": "電子零組件業",
        "2383": "電子零組件業",
        "6213": "電子零組件業",
        "1101": "水泥工業",
        "9999": "其他",
        "2881": "金融保險業",
    }
    fine_cfg = {
        "updated": "2026-10-03",
        "official_chains": {"電子零組件業": ["L000"]},
        "manual": [
            {
                "id": "m/ic_substrate",
                "name": "IC 載板",
                "parent": "L000/L610",
                "members": ["3037", "8046"],
                "primary_for": ["3037"],
            }
        ],
        "assign": {"2881": ["L000/L100"]},
        "etf": [{"id": "etf/market", "name": "市值型", "rule": {}}],
    }
    themes = {
        "themes": [
            {
                "id": "pcb",
                "name": "PCB",
                "streams": {"上游": [["1101", "台泥"]], "中游": [["3037", "欣興"], ["2383", "台光電"]]},
            }
        ]
    }
    L = sectors.build_layers(codes, names, ind, _rows(), fine_cfg, themes)
    assert L.fine_of["3037"][0] == "m-ic_substrate"  # 手動指定主要細產業
    assert L.fine_of["8046"][0] == "f-L000-L610" and "m-ic_substrate" in L.fine_of["8046"]
    assert L.fine_of["2881"] == ["f-L000-L100"]  # 人工對照
    assert L.fine_of["2881A"] == L.fine_of["2881"]  # 特別股沿用普通股
    assert L.fine_of["0050"] == ["e-market"]
    assert L.unassigned == ["9999"] and L.fine_of["9999"][0].startswith("x-")  # 都對不到：官方產業其他
    assert all(L.fine_of[c] for c in codes)  # 每一檔都有細產業
    assert L.groups["t-pcb"].streams["中游"] == ["3037", "2383"]
    assert ("t-pcb", "上游") in L.themes_of["1101"]
    assert L.groups["m-ic_substrate"].parent == "f-L000-L610"


def test_rank_groups_min_members_and_merge():
    med = {"a": 10.0, "b": 5.0, "c": 20.0, "d": np.nan}
    counts = {"a": 5, "b": 6, "c": 3, "d": 9}
    rk = sectors.rank_groups(med, counts, {"a": "fine", "b": "fine", "c": "fine", "d": "fine"})
    assert rk == {"a": (1, 2), "b": (2, 2)}  # c 成員不足、d 沒有中位數
    groups = {
        "c": sectors.Group("c", "fine", "C", [], parent="p"),
        "p": sectors.Group("p", "chain", "P", [], parent="q"),
        "q": sectors.Group("q", "chain", "Q", []),
    }
    assert sectors.ranked_parent(groups, {"c": 3, "p": 4, "q": 12}, "c") == "q"


def test_correlated_top():
    rng = np.random.default_rng(1)
    base = rng.normal(0, 0.01, 61).cumsum()
    data = {
        "1101": 100 * np.exp(base),
        "1102": 100 * np.exp(base + rng.normal(0, 0.001, 61)),  # 與 1101 幾乎相同
        "2330": 100 * np.exp(rng.normal(0, 0.01, 61).cumsum()),
        "0050": 100 * np.exp(base),  # ETF 不列
    }
    adj = pd.DataFrame(data, index=[f"d{i}" for i in range(61)])
    out = sectors.correlated(adj, days=60, top=2)
    assert out["1101"][0][0] == "1102" and out["1101"][0][1] > 0.95
    assert "0050" not in out


def _panels(close: pd.DataFrame) -> SimpleNamespace:
    af = pd.DataFrame(1.0, index=close.index, columns=close.columns)
    return SimpleNamespace(close=close, high=close * 1.01, low=close * 0.99, af=af)


def test_trend_block_slopes_alignment_and_52w():
    n = 300
    idx = [f"2025-{i:04d}" for i in range(n)]
    up = pd.Series(np.linspace(50, 200, n), index=idx)
    p = _panels(pd.DataFrame({"2330": up}))
    ctx = trend.build_context(p)
    b = trend.trend_block(ctx, "2330")
    assert b is not None
    ma20 = up.iloc[-20:].mean()
    assert b["ma"]["20"]["v"] == pytest.approx(round(ma20, 2))
    prev = up.iloc[-30:-10].mean()
    assert b["ma"]["20"]["slope"] == pytest.approx(round((ma20 / prev - 1) * 100, 2))
    assert b["align"]["state"] == "bull" and b["align"]["days"] > 50
    assert b["y52"]["at_high"] is True and b["y52"]["from_hi"] == 0
    assert b["new_high60_20d"] == 20
    assert b["atr"]["v"] is not None and b["bias_atr"] > 0
    assert len(b["series"]["close"]) == trend.SERIES_DAYS


def test_pct_rank():
    s = pd.Series(np.arange(1, 251, dtype=float))
    assert trend.pct_rank(s) == pytest.approx(99.8)
    assert trend.pct_rank(pd.Series([1.0] * 10)) is None  # 歷史不足


def test_period_keys():
    keys = periods.period_keys("2017-03-01", "2026-10-02")
    names = [k for k, _a, _b in keys]
    assert names[0] == "all" and "from:2017" in names and "from:2026" in names
    assert {"last:1", "last:3", "last:5", "year:2017", "year:2026"} <= set(names)
    d = dict((k, (a, b)) for k, a, b in keys)
    assert d["year:2017"] == ("2017-03-01", "2017-12-31")  # 起點不早於訊號起點
    assert d["last:1"] == ("2025-10-02", "2026-10-02")
    assert d["year:2026"] == ("2026-01-01", "2026-10-02")


def test_wilder_atr_matches_methodology():
    # 前 14 筆簡單平均起算，之後 (前值 × 13 + TR) ÷ 14；缺值日沿用前值
    tr = np.array([[float(i)] for i in range(1, 17)] + [[np.nan], [20.0]])
    out = trend.wilder(tr, 14)[:, 0]
    assert np.isnan(out[12]) and out[13] == pytest.approx(7.5)
    assert out[14] == pytest.approx((7.5 * 13 + 15) / 14)
    a15 = (out[14] * 13 + 16) / 14
    assert out[15] == pytest.approx(a15) and out[16] == pytest.approx(a15)
    assert out[17] == pytest.approx((a15 * 13 + 20) / 14)
