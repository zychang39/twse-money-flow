"""動能流程回測（pipeline/momentum_flow/backtest.py）：進出場時點、成本、漲停順延、降級減碼、族群上限、濾網效度。"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.momentum_flow import backtest as bt
from pipeline.momentum_flow import checklist as ck
from pipeline.momentum_flow.data import FlowData
from pipeline.momentum_flow.params import PARAMS

FEE = PARAMS["fee_rate"] * PARAMS["fee_discount"]
TAX = PARAMS["tax_rate"]


def _fd(T: int, codes: list[str], groups: dict[str, str] | None = None) -> FlowData:
    C = len(codes)
    groups = groups or {}
    members: dict[str, list[str]] = {}
    for c, g in groups.items():
        members.setdefault(g, []).append(c)
    return FlowData(
        dates=[f"2026-01-{i + 1:02d}" for i in range(T)],
        codes=codes,
        names={c: f"n{c}" for c in codes},
        markets={},
        close=np.full((T, C), 100.0),
        raw_close=np.full((T, C), 100.0),
        high=np.full((T, C), 100.0),
        open=np.full((T, C), 100.0),
        value=np.ones((T, C)),
        volume=np.ones((T, C)),
        trust=np.zeros((T, C)),
        taiex=np.ones(T),
        universe=np.ones((T, C), dtype=bool),
        listed=np.full((T, C), 300),
        in_disposition=np.zeros((T, C), dtype=bool),
        in_attention=np.zeros((T, C), dtype=bool),
        lists_from="2020-01-01",
        group_of=groups,
        group_names={g: g for g in members},
        members=members,
        revenue=pd.DataFrame(),
        ev_universe=np.ones((T, C), dtype=bool),
    )


def _panels(T: int, C: int, passed_from: int = 0, rs: np.ndarray | None = None) -> ck.Panels:
    level = np.ones((T, C), dtype=np.int8)
    k = np.ones((6, T, C), dtype=np.int8)
    passed = np.zeros((T, C), dtype=bool)
    passed[passed_from:] = True
    nan = np.full((T, C), np.nan)
    return ck.Panels(
        rs=rs if rs is not None else np.full((T, C), 90.0),
        pr1m=nan.copy(),
        pr3m=nan.copy(),
        pr12m=np.full((T, C), 85.0),
        r63=nan.copy(),
        gm63=nan.copy(),
        ma60=np.full((T, C), 50.0),
        h250=nan.copy(),
        limit_count=nan.copy(),
        value20=nan.copy(),
        yoy=nan.copy(),
        yoy_avg3=nan.copy(),
        level=level,
        ref=np.zeros((T, C), dtype=bool),
        k=k,
        passed=passed,
        yoy_lists_ok=np.ones(T, dtype=bool),
    )


def test_entry_at_next_open_after_review_and_d2_exit_with_costs() -> None:
    T = 20
    fd = _fd(T, ["A"])
    P = _panels(T, 1)
    # 1/12 收盤 84 ≤ 0.85 × 100 → D2；1/13 開盤 84 出場
    fd.close[11:, 0] = 84.0
    fd.raw_close[11:, 0] = 84.0
    fd.open[12:, 0] = 84.0
    eff = np.ones(T, dtype=np.int8)
    out = bt.run(fd, P, eff, 1)
    trades = out["trades"]
    assert [(x["date"], x["side"], x["why"]) for x in trades] == [
        ("2026-01-11", "in", "R A"),
        ("2026-01-13", "out", "D2"),
    ]
    cost = 1000 * 100.0  # 每名額 100,000 ÷ 100 元 = 1,000 股
    gross = 1000 * 84.0
    expected = bt.INITIAL_CASH - cost - cost * FEE + gross - gross * FEE - gross * TAX
    assert abs(out["curve"]["nav"][-1] - expected) < 1
    assert out["summary"]["trades"] == 2
    assert out["summary"]["total_cost"] == round(cost * FEE + gross * FEE + gross * TAX)


def test_limit_up_open_defers_entry() -> None:
    T = 16
    fd = _fd(T, ["A"])
    P = _panels(T, 1)
    fd.open[10, 0] = 110.0  # 1/11 開盤 +10% → 漲停，順延
    eff = np.ones(T, dtype=np.int8)
    out = bt.run(fd, P, eff, 1)
    assert [(x["date"], x["side"]) for x in out["trades"]] == [("2026-01-12", "in")]


def test_downgrade_exits_lowest_rs_first() -> None:
    T = 18
    codes = ["A", "B", "C", "D"]
    rs = np.tile(np.array([95.0, 90.0, 88.0, 86.0]), (T, 1))
    fd = _fd(T, codes)
    P = _panels(T, 4, rs=rs)
    eff = np.ones(T, dtype=np.int8)
    eff[13:] = 3  # 1/14 起狀態 3 → 可用名額 3 → 1/15 開盤出場 RS 最低的 D
    out = bt.run(fd, P, eff, 1)
    outs = [x for x in out["trades"] if x["side"] == "out"]
    assert [(x["date"], x["code"], x["why"]) for x in outs] == [("2026-01-15", "D", "降級")]
    assert len([x for x in out["trades"] if x["side"] == "in"]) == 4


def test_group_caps_limit_fills() -> None:
    T = 14
    codes = ["A", "B", "C", "D", "E"]
    fd = _fd(T, codes, groups=dict.fromkeys(codes, "g"))
    P = _panels(T, 5)
    eff = np.ones(T, dtype=np.int8)
    out = bt.run(fd, P, eff, 1)
    ins = sorted(x["code"] for x in out["trades"] if x["side"] == "in")
    assert ins == ["A", "B", "C"]  # 同一主族群最多 3 檔


def test_d1_three_closes_below_ma60() -> None:
    T = 20
    fd = _fd(T, ["A"])
    P = _panels(T, 1)
    P.ma60[12:15, 0] = 200.0  # 1/13–1/15 收在 60 日線下 → 1/15 收盤觸發 → 1/16 出場
    eff = np.ones(T, dtype=np.int8)
    out = bt.run(fd, P, eff, 1)
    outs = [(x["date"], x["why"]) for x in out["trades"] if x["side"] == "out"]
    assert outs == [("2026-01-16", "D1")]


def test_filter_validity_groups() -> None:
    T = 40
    codes = ["P1", "P2", "F1"]
    fd = _fd(T, codes)
    P = _panels(T, 3)
    P.k[0, :, 2] = ck.FAIL  # F1 只有 K1 未通過
    P.passed[:, 2] = False
    # R＝1/10（索引 9）：前瞻＝close(30) ÷ open(10) − 1
    fd.close[30, 0] = 110.0
    fd.close[30, 1] = 120.0
    fd.close[30, 2] = 90.0
    rows = bt.filter_validity(fd, P, 1, T - 1)
    k1 = rows[0]
    assert k1["periods"] == 1 and k1["avg_p"] == 2 and k1["avg_f"] == 1 and not k1["enough"]
    assert abs(k1["mean_diff"] - (0.15 - (-0.10))) < 1e-9
    assert rows[1]["periods"] == 0 and rows[1]["mean_diff"] is None  # K2 沒有「只有 K2 未通過」的股票
