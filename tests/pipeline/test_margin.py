"""融資增減（pipeline/derive/margin.py；2026-10-20）。"""

from __future__ import annotations

import json
from datetime import date

import pandas as pd

from pipeline.core.store import DataStore
from pipeline.derive import margin

DAYS = [date(2026, 10, 13), date(2026, 10, 14), date(2026, 10, 15), date(2026, 10, 16)]
CFG = {
    "history_days": 3,
    "periods": [1, 2],
    "top": 5,
    "min_base_lots": 500,
    "min_base_lots_pct": 2000,
    "streak_cap": 20,
}


def _store(tmp_path) -> DataStore:
    st = DataStore(tmp_path)
    # 1111：連續資減；2222：增加；3333：基數太小（不列）；0050：ETF（不列）；4444：上櫃
    bal = {
        "1111": [10000, 9000, 8000, 7000],
        "2222": [3000, 3100, 3300, 3600],
        "3333": [100, 50, 10, 5],
        "0050": [9000, 1000, 500, 100],
    }
    close = {"1111": [100, 110, 121, 121], "2222": [50, 50, 50, 50], "3333": [10, 10, 10, 10], "0050": [1, 1, 1, 1]}
    for i, d in enumerate(DAYS):
        rows = [
            {
                "date": d.isoformat(),
                "code": c,
                "name": f"股{c}",
                "margin_prev": v[i - 1] if i else v[0],
                "margin_balance": v[i],
            }
            for c, v in bal.items()
        ]
        st.write("twse_margin", d, pd.DataFrame(rows))
        st.write(
            "tpex_margin",
            d,
            pd.DataFrame(
                [
                    {
                        "date": d.isoformat(),
                        "code": "4444",
                        "name": "櫃股",
                        "margin_prev": 5000,
                        "margin_balance": 5000 - 100 * i,
                    }
                ]
            ),
        )
        # 1111 10/16：除權息（參考價 110，收 121 → +10%；不是持平）
        q = [
            {"date": d.isoformat(), "code": c, "name": f"股{c}", "close": v[i], "change": (v[i] - v[i - 1]) if i else 0}
            for c, v in close.items()
        ]
        if i == 3:
            q[0]["change"] = 11
        st.write("twse_quotes", d, pd.DataFrame(q))
        st.write(
            "twse_margin_total",
            d,
            pd.DataFrame(
                [{"date": d.isoformat(), "item": "融資金額(仟元)", "prev": 600_000_000, "balance": 595_000_000}]
            ),
        )
    return st


def test_build_margin_files(tmp_path):
    st = _store(tmp_path / "data")
    out = tmp_path / "web"
    res = margin.build(st, out, CFG)
    assert res == {"days": 3, "date": "2026-10-16"}
    idx = json.loads((out / "margin" / "index.json").read_text(encoding="utf-8"))
    assert idx["dates"] == ["2026-10-14", "2026-10-15", "2026-10-16"]
    last = idx["days"][-1]
    assert last["twse"] == {"amt": 5950.0, "chg": -50.0} and "tpex" not in last
    # ETF 不計；1111、3333、4444 資減，2222 資增
    assert (last["down"], last["up"], last["flat"]) == (3, 1, 0)

    day = json.loads((out / "margin" / "2026-10-16.json").read_text(encoding="utf-8"))
    cols = day["columns"]
    rows = [dict(zip(cols, r, strict=True)) for r in day["lists"]["1_down_lots"]]
    assert [r["code"] for r in rows] == ["1111", "4444"]  # 3333 基數 < 500 張
    r = rows[0]
    assert r["chg"] == -1000 and r["pct"] == round(-1000 / 8000 * 100, 2) and r["streak"] == 3
    assert r["ret"] == 10.0  # 官方漲跌（參考價）計算，除權息不算下跌
    assert rows[1]["market"] == "上櫃"
    # 2 日：期末 7000 − 期初前一日（10/14）9000
    two = [dict(zip(cols, r, strict=True)) for r in day["lists"]["2_down_lots"]]
    assert two[0]["code"] == "1111" and two[0]["chg"] == -2000
    assert two[0]["ret"] == round(((121 / 110) * (121 / 110) - 1) * 100, 2)
    up = [dict(zip(cols, r, strict=True)) for r in day["lists"]["1_up_pct"]]
    assert [r["code"] for r in up] == ["2222"] and up[0]["streak"] == 0
    # 依增減幅：期初 ≥ 2,000 張才列
    assert [r[0] for r in day["lists"]["1_down_pct"]] == ["1111", "4444"]
    # 最早一天沒有完整的 2 日期間 → 不輸出
    first = json.loads((out / "margin" / "2026-10-14.json").read_text(encoding="utf-8"))
    assert "2_down_lots" not in first["lists"]


def test_build_margin_no_data(tmp_path):
    assert margin.build(DataStore(tmp_path / "data"), tmp_path / "web", CFG) == {"days": 0}
