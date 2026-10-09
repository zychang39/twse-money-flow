"""動能流程（pipeline/momentum_flow）：狀態機升級／降級邊界、三態判定、排序決定性、組合試算的族群上限。"""

from __future__ import annotations

import numpy as np

from pipeline.momentum_flow import market_state as ms
from pipeline.momentum_flow import portfolio as pf
from pipeline.momentum_flow.ordering import sort_rows


def test_raw_states_three_levels_and_insufficient() -> None:
    close = np.array([110, 95, 80, 100], dtype=float)
    ma60 = np.array([100, 100, 100, np.nan])
    ma240 = np.array([90, 90, 90, 90], dtype=float)
    assert ms.raw_states(close, ma60, ma240).tolist() == [1, 2, 3, 0]


def test_effective_downgrade_immediate_upgrade_needs_ten_better_days() -> None:
    raw = np.array([0, 0, 1, 1, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1], dtype=np.int8)
    eff = ms.effective_states(raw, upgrade_days=10)
    assert eff[:2].tolist() == [0, 0]  # 資料不足
    assert eff[2] == 1  # 初始化
    assert eff[4] == 3  # 降級當日生效
    # 第 5～13 列（9 天）都是 1：最近 10 天仍含第 4 列的 3 → 維持 3；第 14 列起 10 天都是 1 → 升到 1
    assert eff[13] == 3
    assert eff[14] == 1
    # 升級後出現 2：降級當日生效；之後一天 1 不足 10 天 → 維持 2
    assert eff[15] == 2
    assert eff[16] == 2


def test_effective_upgrade_takes_worst_of_window() -> None:
    raw = np.array([3] + [2] * 5 + [1] * 10, dtype=np.int8)
    eff = ms.effective_states(raw, upgrade_days=10)
    assert eff[0] == 3
    # 第 10 列：最近 10 天＝[2,2,2,2,2,1,1,1,1,1] 最差 2 < 3 → 升到 2（不是 1）
    assert eff[10] == 2
    # 第 15 列：最近 10 天全為 1 → 升到 1
    assert eff[15] == 1


def test_countdown_and_entered() -> None:
    raw = np.array([3, 3, 1, 1, 1], dtype=np.int8)
    eff = ms.effective_states(raw, upgrade_days=10)
    assert eff.tolist() == [3, 3, 3, 3, 3]
    assert ms.upgrade_countdown(raw, eff, 4, 10) == 7  # 連續 3 天 raw < eff → 10 − 3
    assert ms.upgrade_countdown(raw, eff, 1, 10) is None  # raw ＝ eff
    assert ms.entered_index(eff, 4) == 0
    out = ms.compute([f"d{i}" for i in range(5)], np.array([1.0] * 5))
    assert out["state"] is None and out["exposure"] is None  # 不足 240 日


def test_compute_summary_with_real_lengths() -> None:
    n = 300
    close = np.linspace(100, 200, n)  # 一路上漲：收盤 > 均線 → 狀態 1
    dates = [f"2026-{i:04d}" for i in range(n)]
    out = ms.compute(dates, close, history_days=5)
    assert out["state"] == 1 and out["exposure"] == 1.0 and out["countdown"] is None
    assert out["entered"] == dates[239]  # 第一個有 MA240 的日子
    assert len(out["history"]) == 5 and out["history"][-1][0] == dates[-1]


def test_sort_is_deterministic() -> None:
    rows = [
        {"code": "2330", "level": "B", "pr12m": 90, "rs": 95},
        {"code": "2317", "level": "A", "pr12m": 85, "rs": 90},
        {"code": "2454", "level": "A", "pr12m": 85, "rs": 92},
        {"code": "1101", "level": "C", "pr12m": None, "rs": 88},
        {"code": "2412", "level": "A", "pr12m": 85, "rs": 92},
    ]
    assert [r["code"] for r in sort_rows(rows)] == ["2412", "2454", "2317", "2330", "1101"]
    assert [r["code"] for r in sort_rows(list(reversed(rows)))] == ["2412", "2454", "2317", "2330", "1101"]


def test_portfolio_group_caps_and_cash() -> None:
    picks = [
        pf.Pick("A1", "a1", "g1", 100.0),
        pf.Pick("A2", "a2", "g1", 100.0),
        pf.Pick("A3", "a3", "g1", 100.0),
        pf.Pick("A4", "a4", "g1", 100.0),  # 第 4 檔同族群 → 跳過
        pf.Pick("B1", "b1", "g2", 250.0),
        pf.Pick("C1", "c1", None, None),  # 沒有價格 → 資料不足
    ]
    out = pf.plan(picks, total=1_000_000, slots=10, exposure=0.6)
    assert out["usable"] == 6 and out["per_slot"] == 100_000
    codes = [r["code"] for r in out["rows"]]
    assert codes == ["A1", "A2", "A3", "B1", None, None]
    assert [s["code"] for s in out["skipped"]] == ["A4", "C1"]
    a1 = out["rows"][0]
    assert a1["lots"] == 1 and a1["odd"] == 0 and a1["amount"] == 100_000
    b1 = out["rows"][3]
    assert b1["lots"] == 0 and b1["odd"] == 400 and b1["amount"] == 100_000
    assert out["rows"][4]["name"] == "現金"


def test_portfolio_group_weight_cap() -> None:
    # 每名額 10 萬、族群上限 35% ＝ 35 萬：同族群第 4 檔先被檔數限制擋住；改用 3 檔但單價讓金額超過時由金額限制擋
    picks = [pf.Pick(f"X{i}", "x", "g", 100.0) for i in range(3)] + [pf.Pick("Y", "y", "g2", 100.0)]
    out = pf.plan(picks, total=300_000, slots=3, exposure=1.0)
    # 每名額 10 萬，族群 g 上限 10.5 萬 → 只有第 1 檔進得去
    assert [r["code"] for r in out["rows"]] == ["X0", "Y", None]
    assert out["skipped"][0]["why"].startswith("同一主族群試算金額")


def test_portfolio_zero_slots() -> None:
    assert pf.plan([], total=0, slots=10, exposure=1.0)["rows"] == []


# ---------------------------------------------------------------- 檢查清單三態、清單、漏斗、檢查日
from dataclasses import dataclass as _dc  # noqa: E402

from pipeline.momentum_flow import candidates, web_out  # noqa: E402
from pipeline.momentum_flow import checklist as ck  # noqa: E402
from pipeline.momentum_flow.data import primary_groups  # noqa: E402
from pipeline.momentum_flow.signals import window_any  # noqa: E402


def test_tri_state_and_cross_pct() -> None:
    cond = np.array([[True, False, True]])
    avail = np.array([[True, True, False]])
    assert ck.tri(cond, avail).tolist() == [[1, 0, -1]]
    # (平均名次 − 0.5) ÷ 有效檔數 × 100；相同值取平均名次；NaN 不算
    x = np.array([[1.0, 2.0, 2.0, np.nan]])
    assert np.round(ck.cross_pct(x)[0], 2).tolist()[:3] == [16.67, 66.67, 66.67]
    assert np.isnan(ck.cross_pct(x)[0, 3])


def test_window_any_and_review_dates() -> None:
    m = np.array([[False], [True], [False], [False], [False]])
    assert window_any(m, 3)[:, 0].tolist() == [False, True, True, True, False]
    dates = ["2026-09-09", "2026-09-10", "2026-09-11", "2026-10-08", "2026-10-09", "2026-10-13"]
    assert web_out.review_dates(dates, 10) == [1, 5]  # 9/10 當天、10/13（10/10 假日後第一個交易日）
    assert web_out.next_review_calendar("2026-10-09", 10) == "2026-10-10"
    assert web_out.next_review_calendar("2026-10-13", 10) == "2026-11-10"
    assert web_out.next_review_calendar("2026-12-20", 10) == "2027-01-10"


@_dc
class _G:
    id: str
    layer: str
    name: str
    members: list[str]


@_dc
class _Layers:
    groups: dict[str, _G]
    fine_of: dict[str, list[str]]


def test_primary_group_marking_then_smallest() -> None:
    layers = _Layers(
        groups={
            "f-a": _G("f-a", "fine", "甲", ["1", "2", "3"]),
            "f-b": _G("f-b", "fine", "乙", ["1", "4"]),
            "f-c": _G("f-c", "fine", "丙", ["2", "5"]),
            "t-x": _G("t-x", "theme", "題材", ["1", "2", "3", "4", "5"]),
        },
        fine_of={"1": ["f-a", "f-b"]},  # 既有標示：1 的主要細產業是甲（雖然乙成員較少）
    )
    group_of, names, members = primary_groups(layers, ["1", "2", "3", "4", "5"])
    assert group_of["1"] == "f-a"  # 沿用標示
    assert group_of["2"] == "f-c"  # 沒有標示：成員數最少（丙 2 檔 < 甲 3 檔）
    assert group_of["3"] == "f-a"
    assert names["f-c"] == "丙" and members["f-b"] == ["1", "4"]
    assert "t-x" not in names


def _panels(level, k, passed, rs=None):
    T, C = level.shape
    z = np.full((T, C), np.nan)
    return ck.Panels(
        rs=rs if rs is not None else np.full((T, C), 90.0),
        pr1m=np.full((T, C), 20.0),
        pr3m=z,
        pr12m=np.full((T, C), 85.0),
        r63=z,
        gm63=z,
        ma60=z,
        h250=z,
        limit_count=z,
        value20=z,
        yoy=z,
        yoy_avg3=z,
        level=level,
        ref=np.zeros((T, C), dtype=bool),
        k=k,
        passed=passed,
        yoy_lists_ok=np.ones(T, dtype=bool),
    )


def _fd(T: int, codes: list[str]):
    from pipeline.momentum_flow.data import FlowData

    C = len(codes)
    return FlowData(
        dates=[f"2026-01-{i + 1:02d}" for i in range(T)],
        codes=codes,
        names={c: f"n{c}" for c in codes},
        markets={},
        close=np.ones((T, C)),
        raw_close=np.ones((T, C)),
        high=np.ones((T, C)),
        open=np.ones((T, C)),
        value=np.ones((T, C)),
        volume=np.ones((T, C)),
        trust=np.zeros((T, C)),
        taiex=np.ones(T),
        universe=np.ones((T, C), dtype=bool),
        listed=np.full((T, C), 300),
        in_disposition=np.zeros((T, C), dtype=bool),
        in_attention=np.zeros((T, C), dtype=bool),
        lists_from="2020-01-01",
        group_of={"A": "g1"},
        group_names={"g1": "族群一"},
        members={"g1": ["A"]},
        revenue=__import__("pandas").DataFrame(),
        ev_universe=np.ones((T, C), dtype=bool),
    )


def test_day_rows_lists_and_funnel() -> None:
    codes = ["A", "B", "C", "D"]
    fd = _fd(2, codes)
    level = np.array([[1, 2, 3, 0], [1, 2, 3, 3]], dtype=np.int8)
    k = np.ones((6, 2, 4), dtype=np.int8)
    k[2, 1, 1] = 0  # B：T 日 K3 未通過（差一項）
    k[4, 1, 2] = -1  # C：T 日 K5 資料不足（不列入差一項，也不是全通過）
    k[0, 0, 0] = 0  # A：T−1 日未全通過 → T 日全通過＝新觸發
    passed = (level > 0) & np.all(k == 1, axis=0)
    P = _panels(level, k, passed, rs=np.array([[90, 90, 90, 90], [95, 88, 92, 86.0]]))
    rows = candidates.day_rows(fd, P, 1)
    assert [r["code"] for r in rows] == ["A", "B", "C", "D"]  # A → B → C，同級 PR12M 相同再依 RS 由高到低
    a, b, c, d = rows
    assert a["pass"] and a["new"] and a["near"] is None and a["group_name"] == "族群一"
    assert not b["pass"] and b["near"] == "K3" and b["n_pass"] == 5
    assert c["near"] is None and c["n_pass"] == 5  # 資料不足不算差一項
    assert d["pass"]  # D：T−1 不是候選 → 視為未全通過 → 新觸發
    assert d["new"] is True
    ls = candidates.lists(rows)
    assert [r["code"] for r in ls["pass"]] == ["A", "D"]
    assert [r["code"] for r in ls["new"]] == ["A", "D"]
    assert [r["code"] for r in ls["near"]] == ["B"]
    fn = candidates.funnel(rows)
    assert fn == {
        "candidates": 4,
        "pass": 2,
        "k": {
            "K1": {"pass": 4, "fail": [], "na": []},
            "K2": {"pass": 4, "fail": [], "na": []},
            "K3": {"pass": 3, "fail": ["B"], "na": []},
            "K4": {"pass": 4, "fail": [], "na": []},
            "K5": {"pass": 3, "fail": [], "na": ["C"]},
            "K6": {"pass": 4, "fail": [], "na": []},
        },
    }
    assert a["k"][0][2] == 80 and b["k"][0][2] == 85  # A 級 K1 下限 80，其餘 85
    assert a["pullback"] is True  # PR1M 20 ≤ 30


def test_group_medians_min_members() -> None:
    fd = _fd(1, ["A", "B", "C"])
    fd.group_of = {"A": "g", "B": "g"}
    fd.members = {"g": ["A", "B", "C"]}
    r63 = np.array([[0.1, 0.3, 0.2]])
    assert np.allclose(ck.group_medians(fd, r63, 3), [[0.2, 0.2, np.nan]], equal_nan=True)
    fd.members = {"g": ["A", "B"]}
    assert np.isnan(ck.group_medians(fd, r63, 3)).all()  # 成員少於 3 檔無值


# ---------------------------------------------------------------- 每日流程（2026-10-09 補）
def test_lists_through_by_extras_time() -> None:
    from pipeline.momentum_flow.data import lists_through

    assert lists_through(None, "17:00") is None
    assert lists_through({}, "17:00") is None
    # 15:02 那一棒：當日名單還沒公布 → 只到前一天
    assert lists_through({"daily_extras": {"at": "2026-10-08T15:02+08:00"}}, "17:00") == "2026-10-07"
    # 17:02、22:02 那一棒 → 當天
    assert lists_through({"daily_extras": {"at": "2026-10-08T17:02+08:00"}}, "17:00") == "2026-10-08"
    assert lists_through({"daily_extras": {"at": "2026-10-08T22:02+08:00"}}, "17:00") == "2026-10-08"
    # 隔天早上 08:05 → 前一天的名單已取得
    assert lists_through({"daily_extras": {"at": "2026-10-09T08:05+08:00"}}, "17:00") == "2026-10-08"
    assert lists_through({"daily_extras": {"at": "not-a-date"}}, "17:00") is None


def test_days_to_write_rewrites_recent_days() -> None:
    from pipeline.momentum_flow.__main__ import days_to_write

    dates = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]
    have = set(dates)
    assert days_to_write(dates, have, "2026-10-01", 2) == [4, 5]  # 已有的只重算最近 2 天
    assert days_to_write(dates, {"2026-10-01"}, "2026-10-02", 0) == [1, 2, 3, 4, 5]  # 窗口外的不寫
    assert days_to_write(dates, set(), "2026-10-06", 5) == [3, 4, 5]


def test_snapshot_bytes_are_deterministic_and_atomic(tmp_path) -> None:
    from pipeline.momentum_flow import snapshots

    payload = {"date": "2026-10-08", "state": 1, "rows": [{"code": "2330"}]}
    p1 = snapshots.write_snapshot(tmp_path, payload)
    b1 = p1.read_bytes()
    p2 = snapshots.write_snapshot(tmp_path, payload)
    assert p1 == p2 and p2.read_bytes() == b1  # gzip 時間戳固定：內容相同 → 位元相同
    assert snapshots.read_snapshot(tmp_path, "2026-10-08") == payload
    assert not list(tmp_path.rglob("*.tmp"))  # 沒有殘留暫存檔


def test_k5_insufficient_after_lists_through() -> None:
    """當日注意／處置名單還沒公布 → 該日 K5 資料不足（不用前一日名單代替）；之前的日子照常判定。"""
    import pandas as pd

    from pipeline.momentum_flow import checklist as ck2

    T, codes = 300, ["A", "B", "C"]
    fd = _fd(T, codes)
    fd.dates = [str(d.date()) for d in pd.bdate_range("2025-08-01", periods=T)]
    fd.lists_from = fd.dates[0]
    fd.lists_through = fd.dates[-2]
    rng = np.random.default_rng(0)
    fd.close = np.cumprod(1 + rng.normal(0, 0.01, (T, len(codes))), axis=0)
    fd.raw_close = fd.close.copy()
    fd.high = fd.close.copy()
    fd.value = np.full((T, len(codes)), 1e9)
    fd.members = {"g1": codes}
    fd.group_of = dict.fromkeys(codes, "g1")
    sig = {
        "a": np.zeros((T, 3), dtype=bool),
        "b": np.zeros((T, 3), dtype=bool),
        "ref": np.zeros((T, 3), dtype=bool),
        "rev_features": pd.DataFrame(columns=["code", "ym", "row", "yoy", "yoy1", "yoy2"]),
    }
    P = ck2.compute(fd, sig)
    k5 = P.k[4]
    assert (k5[-1] == ck2.NA).all()  # 基準日：名單未到 → 資料不足
    assert (k5[-2] != ck2.NA).all()  # 前一天：名單已取得 → 可判定
