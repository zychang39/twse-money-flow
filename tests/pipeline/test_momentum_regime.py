"""動能環境與研究（pipeline/momentum_flow/regime.py）：統計工具、槓桿與追繳、報酬分解、不偷看未來。"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.momentum_flow import checklist as ck
from pipeline.momentum_flow import regime as rg
from pipeline.momentum_flow.data import FlowData


def _fd(T: int, C: int, seed: int = 0) -> FlowData:
    rng = np.random.default_rng(seed)
    close = 100 * np.cumprod(1 + rng.normal(0.0005, 0.02, (T, C)), axis=0)
    codes = [f"{1000 + i}" for i in range(C)]
    return FlowData(
        dates=[str(d.date()) for d in pd.bdate_range("2016-01-04", periods=T)],
        codes=codes,
        names={c: c for c in codes},
        markets={},
        close=close,
        raw_close=close.copy(),
        high=close.copy(),
        open=close * (1 + rng.normal(0, 0.003, (T, C))),
        value=np.full((T, C), 1e9),
        volume=np.ones((T, C)),
        trust=np.zeros((T, C)),
        taiex=10000 * np.cumprod(1 + rng.normal(0.0004, 0.01, T)),
        universe=np.ones((T, C), dtype=bool),
        listed=np.full((T, C), 300),
        in_disposition=np.zeros((T, C), dtype=bool),
        in_attention=np.zeros((T, C), dtype=bool),
        lists_from=None,
        group_of={},
        group_names={},
        members={},
        revenue=pd.DataFrame(),
        ev_universe=np.ones((T, C), dtype=bool),
    )


def test_nw_ols_t_detects_difference_and_needs_both_groups() -> None:
    rng = np.random.default_rng(1)
    x = np.tile([0.0, 1.0], 40)
    y = 0.01 + 0.02 * x + rng.normal(0, 0.01, x.size)
    t = rg.nw_ols_t(y, x, 3)
    assert t is not None and t > 5
    assert rg.nw_ols_t(y, np.ones_like(y), 3) is None  # 只有一組
    assert rg.nw_ols_t(y[:4], x[:4], 3) is None  # 樣本太少


def test_lever_interest_and_margin_call() -> None:
    n = 11
    nav = 100 * 1.01 ** np.arange(n)
    cash = np.zeros(n)  # 流程全額投入
    res = rg.lever(nav, cash, [0], {0: 2.0}, fee=0.0, tax=0.0, rate=0.0, maintenance=1.3)
    # 不計息：權益＝2 × 流程 − 100
    assert np.allclose(res["nav"], 2 * nav - 100)
    assert np.allclose(res["gross"], 2 * nav / (2 * nav - 100))
    res_i = rg.lever(nav, cash, [0], {0: 2.0}, fee=0.0, tax=0.0, rate=0.0252, maintenance=1.3)
    assert res_i["interest"] > 0 and res_i["nav"][-1] < res["nav"][-1]
    # 單日 −40%：部位 120、融資 100 → 維持率 1.2 < 1.3 → 追繳，之後回到 1 倍（C＝0）
    nav2 = np.array([100.0, 60.0, 66.0])
    r2 = rg.lever(nav2, np.zeros(3), [0], {0: 2.0}, fee=0.0, tax=0.0, rate=0.0, maintenance=1.3)
    assert r2["calls"] == [1]
    assert np.isclose(r2["nav"][1], 20.0)  # 2 × 60 − 100
    assert np.isclose(r2["nav"][2], 20.0 * 66 / 60)  # 追繳後 1 倍跟著流程
    # 單日 −30%：維持率 1.4 → 不追繳
    r3 = rg.lever(np.array([100.0, 70.0]), np.zeros(2), [0], {0: 2.0}, 0.0, 0.0, 0.0, 1.3)
    assert r3["calls"] == []


def test_lever_below_one_keeps_cash_and_flow_cash_offsets_loan() -> None:
    nav = np.array([100.0, 110.0])
    res = rg.lever(nav, np.zeros(2), [0], {0: 0.5}, 0.0, 0.0, 0.05, 1.3)
    assert np.isclose(res["nav"][1], 0.5 * 110 + 50) and res["interest"] == 0
    # 流程一半現金：2 倍時部位 100、現金 100 − 100 ＝ 0 → 不用融資、不計息
    res2 = rg.lever(np.array([100.0, 100.0]), np.array([50.0, 50.0]), [0], {0: 2.0}, 0.0, 0.0, 0.05, 1.3)
    assert res2["interest"] == 0


def test_attribution_identity() -> None:
    rng = np.random.default_rng(2)
    T = 300
    nav = 1e6 * np.cumprod(1 + rng.normal(0.0005, 0.01, T))
    cash = nav * rng.uniform(0, 0.8, T)
    r_ew = np.concatenate([[0], rng.normal(0.0003, 0.01, T - 1)])
    r_b = np.concatenate([[np.nan], rng.normal(0.0004, 0.01, T - 1)])
    dates = [str(d.date()) for d in pd.bdate_range("2020-01-01", periods=T)]
    a = rg.attribution(nav, cash, r_ew, r_b, dates, 3)
    assert abs(a["check"]) < 1e-9
    s = a["selection"]["annual"] + a["size"]["annual"] + a["cash"]["annual"]
    assert abs(s - a["total"]["annual"]) < 1e-3


def test_basket_daily_enters_at_next_open_and_holds() -> None:
    fd = _fd(6, 2)
    fd.close[:] = 100.0
    fd.open[:] = 100.0
    fd.open[2, 0], fd.close[2, 0] = 100.0, 110.0  # 第 2 天（R+1）：開 100 收 110
    fd.close[3:, 0] = 121.0  # 之後持平：第 4 天（下一個 R）仍屬第一期，收盤後換股
    sel = np.zeros((6, 2), dtype=bool)
    sel[1, 0] = True  # R＝1 選第 0 檔
    r, n = rg.basket_daily(fd, sel, [1, 4])
    assert n == [1, 0]
    assert np.isnan(r[0]) and r[1] == 0.0
    assert np.isclose(r[2], 0.10) and np.isclose(r[3], 0.10)
    assert r[4] == 0.0  # 第一期最後一天（持有到下一個 R 收盤）
    assert r[5] == 0.0  # 第二期沒有股票


def test_flags_do_not_look_ahead() -> None:
    T, C = 520, 30
    fd = _fd(T, C)
    eff = np.ones(T, dtype=np.int8)
    rs = np.tile(np.linspace(0, 100, C), (T, 1))
    P = ck.Panels(
        rs=rs,
        pr1m=rs,
        pr3m=rs,
        pr12m=rs,
        r63=np.zeros((T, C)),
        gm63=np.zeros((T, C)),
        ma60=np.zeros((T, C)),
        h250=np.zeros((T, C)),
        limit_count=np.zeros((T, C)),
        value20=np.full((T, C), 1e9),
        yoy=np.zeros((T, C)),
        yoy_avg3=np.zeros((T, C)),
        level=np.zeros((T, C), dtype=np.int8),
        ref=np.zeros((T, C), dtype=bool),
        k=np.ones((6, T, C), dtype=np.int8),
        passed=np.zeros((T, C), dtype=bool),
        yoy_lists_ok=np.ones(T, dtype=bool),
    )
    reviews = list(range(260, T, 21))

    def flags(fdx: FlowData) -> dict:
        sel = fdx.universe & (P.rs >= 90)
        mom, _ = rg.basket_daily(fdx, sel, reviews)
        ew_liq, _ = rg.basket_daily(fdx, fdx.universe, reviews)
        series = {"mom": mom, "ew_liq": ew_liq, "ew": rg.ew_daily(fdx.close, fdx.universe), "b0050": np.zeros(T)}
        return rg.compute_flags(fdx, P, eff, series)

    a = flags(fd)
    t = 450
    fd2 = _fd(T, C)
    fd2.close[t + 1 :] *= 1.5  # 改動 t 之後的價格與指數
    fd2.open[t + 1 :] *= 1.5
    fd2.taiex[t + 1 :] *= 0.5
    b = flags(fd2)
    for k in rg.FLAG_KEYS:
        assert (a["flags"][k][: t + 1] == b["flags"][k][: t + 1]).all(), k
    assert (a["score"][: t + 1] == b["score"][: t + 1]).all()


def test_k5_proxy_only_before_lists() -> None:
    T, C = 4, 2
    fd = _fd(T, C)
    fd.lists_from = fd.dates[2]
    fd.in_disposition[0, 1] = True
    k = np.ones((6, T, C), dtype=np.int8)
    k[4, :2] = ck.NA  # 名單開始前規格判資料不足
    P = ck.Panels(
        rs=np.full((T, C), 90.0),
        pr1m=np.zeros((T, C)),
        pr3m=np.zeros((T, C)),
        pr12m=np.zeros((T, C)),
        r63=np.zeros((T, C)),
        gm63=np.zeros((T, C)),
        ma60=np.zeros((T, C)),
        h250=np.zeros((T, C)),
        limit_count=np.array([[0, 0], [2, 0], [0, 0], [0, 0]], dtype=float),
        value20=np.zeros((T, C)),
        yoy=np.zeros((T, C)),
        yoy_avg3=np.zeros((T, C)),
        level=np.ones((T, C), dtype=np.int8),
        ref=np.zeros((T, C), dtype=bool),
        k=k,
        passed=np.zeros((T, C), dtype=bool),
        yoy_lists_ok=np.ones(T, dtype=bool),
    )
    PL = rg.k5_proxy_panels(fd, P)
    assert PL.k[4, 0].tolist() == [ck.PASS, ck.FAIL]  # 第 0 天：第 1 檔處置中
    assert PL.k[4, 1].tolist() == [ck.FAIL, ck.PASS]  # 第 1 天：第 0 檔 20 日漲停 2 次
    assert (PL.k[4, 2:] == P.k[4, 2:]).all()  # 名單開始後不變
    assert PL.passed[0].tolist() == [True, False]
    assert P.k[4, 0, 0] == ck.NA  # 原面板沒被改


def test_regime_caps_min_and_missing() -> None:
    state = np.array([1.0, 1.0, 0.6, 0.3, 1.0])
    score = np.array([3, 1, 3, 2, -1], dtype=np.int8)
    assert rg.regime_caps(score, state).tolist() == [1.0, 0.3, 0.6, 0.3, 1.0]


def test_idle_in_etf_earns_benchmark_on_cash() -> None:
    n = 5
    nav = np.full(n, 100.0)  # 流程全部現金、淨值不動
    cash = nav.copy()
    r_b = np.array([np.nan, 0.01, 0.01, 0.01, 0.01])
    out = rg.idle_in_etf(nav, cash, r_b, fee=0.0, etf_tax=0.0)
    assert np.allclose(out, 100 * 1.01 ** np.arange(n))
    out_fee = rg.idle_in_etf(nav, np.zeros(n), r_b, fee=0.001, etf_tax=0.0)
    assert np.allclose(out_fee, nav)  # 沒有閒置現金 → 與流程相同、不調整


def test_worst_window_and_perf() -> None:
    nav = np.array([100, 110, 99, 120, 60, 90], dtype=float)
    assert np.isclose(rg.worst_window(nav, 2), 60 / 99 - 1)
    dates = [str(d.date()) for d in pd.bdate_range("2024-01-29", periods=6)]
    p = rg.perf(nav, dates)
    assert np.isclose(p["mdd"], 60 / 120 - 1, atol=1e-4)
    assert p["underwater_days"] == 2
