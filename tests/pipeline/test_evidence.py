"""M1 指標效度評估：以手算預期值驗證每個計算（METHODOLOGY §10）。"""

from __future__ import annotations

import math
import typing

import numpy as np
import pandas as pd
import pytest

from pipeline.evidence import engine, quintile, stats, universe, verdict
from pipeline.evidence import indicators as ind
from pipeline.evidence.catalog import Cell, neighbors
from pipeline.evidence.data import cfg, revenue_table, whale_frames, whale_panels
from pipeline.evidence.run import windows

NaN = np.nan


def col(*v: float) -> np.ndarray:
    return np.array(v, dtype=float)[:, None]


# ------------------------------------------------------------------ 成本與報酬
def test_net_return_hand():
    fee = 0.001425 * 0.6  # 0.000855
    # 100 → 110：1.1 × (1 − 0.000855 − 0.003) ÷ 1.000855 − 1 = 0.09481...
    got = engine.net_return(0.10, fee, 0.003)
    assert got == pytest.approx(1.1 * (1 - 0.003855) / 1.000855 - 1)
    assert got == pytest.approx(0.0948234, abs=1e-6)
    # 不漲不跌仍虧成本 0.4706%
    assert engine.net_return(0.0, fee, 0.003) == pytest.approx(-0.0047056, abs=1e-6)


def _market(open_, close, high=None, low=None, volume=None, bench=None, h=(2,)):
    T, C = open_.shape
    high = open_ * 1.0 if high is None else high
    low = open_ * 1.0 if low is None else low
    volume = np.ones((T, C)) if volume is None else volume
    bench = np.arange(1, T + 1, dtype=float) * 100 if bench is None else bench
    return engine.Market(
        dates=[f"2026-01-{i + 1:02d}" for i in range(T)],
        open=open_,
        high=high,
        low=low,
        close=close,
        volume=volume,
        universe=np.ones((T, C), dtype=bool),
        bench=bench,
        bench_is_tr=True,
        regime_up=np.ones(T, dtype=bool),
        trend_up=np.ones(T, dtype=bool),
        quarter_end=np.zeros(T, dtype=bool),
        limit_up_pct=9.5,
        gap_pct=5,
        limit_down_pct=-9.5,
        horizons=list(h),
    )


def test_entry_limit_up_excluded_and_gap_flagged():
    # 第 0 列訊號；第 1 列開盤 110（前收 100，+10%）→ 開盤即漲停，無法進場
    o = col(100, 110, 111, 112, 113)
    c = col(100, 110, 111, 112, 113)
    mk = _market(o, c)
    df = engine.evaluate(mk, np.array([0]), np.array([0]), 2)
    assert df["status"].iloc[0] == "limit_up"
    # 開盤 +6%：可以進場但標示跳空
    o2 = col(100, 106, 107, 108, 109)
    mk2 = _market(o2, o2.copy())
    d2 = engine.evaluate(mk2, np.array([0]), np.array([0]), 2)
    assert d2["status"].iloc[0] == "ok" and bool(d2["gap"].iloc[0])
    # 進場 106（第 1 列）、出場第 3 列開盤 108
    assert d2["gross"].iloc[0] == pytest.approx(108 / 106 - 1)


def test_exit_deferred_when_limit_down_locked():
    # 進場第 1 列 100；原定出場第 3 列：前收 100、最高 90（−10%，整天鎖跌停）→ 順延到第 4 列開盤 85
    o = col(100, 100, 100, 90, 85, 86)
    c = col(100, 100, 100, 90, 86, 86)
    h = col(100, 100, 100, 90, 88, 87)
    lo = col(100, 100, 100, 90, 84, 85)
    mk = _market(o, c, high=h, low=lo)
    df = engine.evaluate(mk, np.array([0]), np.array([0]), 2)
    r = df.iloc[0]
    assert bool(r["locked"]) and r["x"] == 4
    assert r["gross"] == pytest.approx(85 / 100 - 1)
    assert r["lock_loss"] == pytest.approx(85 / 90 - 1)  # 比原出場日開盤多損失
    # 最大不利波動：持有期間（第 1–2 列）最低 100 與出場價 85 取小
    assert r["mae"] == pytest.approx(85 / 100 - 1)


def test_delisted_exit_at_last_close():
    o = col(100, 100, 101, NaN, NaN, NaN)
    c = col(100, 100, 102, NaN, NaN, NaN)
    mk = _market(o, c)
    df = engine.evaluate(mk, np.array([0]), np.array([0]), 2)
    assert bool(df["delisted"].iloc[0]) and df["gross"].iloc[0] == pytest.approx(0.02)


def test_market_mean_same_entry_same_horizon():
    # 兩檔：進場第 1 列（開盤 100、50），第 3 列開盤 110、45 → 淨報酬平均
    o = np.array([[100, 50], [100, 50], [105, 48], [110, 45], [111, 44]], dtype=float)
    mk = _market(o, o.copy())
    fee, tax, slip = mk.fee, mk.tax, mk.slip
    # 審查修正 2026-10-01：基準（同日等權）不扣成本＝毛報酬平均；事件扣成本（含滑價）
    want = (0.10 + -0.10) / 2
    assert mk.market_mean[2][1] == pytest.approx(want)
    df = engine.evaluate(mk, np.array([0]), np.array([0]), 2)
    assert df["exc_mkt"].iloc[0] == pytest.approx(engine.net_return(0.10, fee, tax, slip) - want)
    # 指數：進場前一日收盤（第 0 列 100）到出場前一日（第 2 列 300）
    assert df["exc_idx"].iloc[0] == pytest.approx(engine.net_return(0.10, fee, tax, slip) - 2.0)


def test_cost_rates_follow_audit_standard_and_slippage():
    """審查規格：手續費 0.1425% 不打折、證交稅 0.3%、滑價 0.1% 買賣各一次。"""
    fee, tax, slip = engine.cost_rates()
    assert fee == pytest.approx(0.001425) and tax == pytest.approx(0.003) and slip == pytest.approx(0.001)
    # 100 → 110：買 100.1、賣 109.89；淨＝109.89 × (1 − 0.001425 − 0.003) ÷ (100.1 × 1.001425) − 1
    got = engine.net_return(0.10, fee, tax, slip)
    assert got == pytest.approx(109.89 * (1 - 0.004425) / (100.1 * 1.001425) - 1)
    assert got == pytest.approx(0.0913892, abs=1e-6)
    # 不漲不跌：來回成本約 0.78%（手續費 0.285%＋稅 0.3%＋滑價 0.2%）
    assert engine.net_return(0.0, fee, tax, slip) == pytest.approx(-0.0078280, abs=1e-6)
    assert engine.benchmark_net_of_costs() is False


def test_dedupe_first_trigger_until_exit():
    df = pd.DataFrame(
        {
            "t": [0, 1, 3, 4, 0],
            "c": [0, 0, 0, 0, 1],
            "x": [3, 4, 6, 7, 3],
            "e": [1, 2, 4, 5, 1],
            "status": ["ok", "ok", "ok", "ok", "limit_up"],
        }
    )
    d = engine.dedupe(df)
    # 股票 0：t=0 進場、第 3 列出場 → t=1 略過；t=3（出場日當天的訊號）可以再計入；t=4 在持有中略過
    assert sorted(d["t"].tolist()) == [0, 3]


def test_quarter_end_mask():
    dates = pd.bdate_range("2026-03-16", "2026-04-03").strftime("%Y-%m-%d").tolist()
    m = engine.quarter_end_mask(dates, 10)
    # 3 月最後 10 個平日：3/18–3/31
    assert next(d for d, x in zip(dates, m, strict=True) if x) == "2026-03-18"
    assert not m[dates.index("2026-03-17")]


# ------------------------------------------------------------------ 統計
def test_wilson_hand():
    lo, hi = stats.wilson(55, 100)
    # p=0.55, n=100, z=1.96：中心 (0.55 + 0.019208)/1.038415 = 0.54816；半寬 1.96×sqrt(0.002475+0.00009604)/1.038415 = 0.09570
    assert lo == pytest.approx(0.45245, abs=1e-4) and hi == pytest.approx(0.64386, abs=1e-4)
    assert stats.wilson(0, 0) == (None, None)


def test_calendar_time_method_averages_same_day_first():
    # 同一進場日 3 筆（+3%、+3%、+3%）與另一日 1 筆（−1%）：事件平均 2%，日曆時間法平均 1%
    df = pd.DataFrame({"e": [5, 5, 5, 9], "exc_mkt": [0.03, 0.03, 0.03, -0.01]})
    s = stats.calendar_series(df)
    assert s.tolist() == pytest.approx([0.03, -0.01])
    m, se, t = stats.mean_t(s.to_numpy())
    assert m == pytest.approx(0.01)
    assert se == pytest.approx(math.sqrt(0.0008) / math.sqrt(2))  # std(ddof=1)=0.028284
    assert t == pytest.approx(0.01 / (0.028284271 / math.sqrt(2)), rel=1e-6)


def test_bootstrap_deterministic_and_brackets_mean():
    x = np.array([0.01, 0.02, -0.005, 0.015, 0.03, 0.0, 0.012])
    a = stats.bootstrap_ci(x, 1000, 1)
    b = stats.bootstrap_ci(x, 1000, 1)
    assert a == b and a[0] < x.mean() < a[1]


def test_newey_west_equals_plain_t_without_lags():
    x = np.array([0.01, 0.02, -0.005, 0.015, 0.03])
    # lag 0：變異 = Σd²/n（母體），t = mean / sqrt(var/n)
    d = x - x.mean()
    want = x.mean() / math.sqrt((d @ d / 5) / 5)
    assert stats.newey_west_t(x, 0) == pytest.approx(want)


def test_oos_cut_last_third():
    assert stats.oos_cut(["2024-01-01", "2024-12-31"], 1 / 3) == "2024-08-31"  # 365 天 × 1/3 ≈ 121.7 天之前


# ------------------------------------------------------------------ 判定
C = cfg()


def _s(m, t, lo, n=150):
    return {"n": n, "mean_excess": m, "t": t, "ci": [lo, lo + 1]}


def test_verdict_valid_unstable_env_invalid_few_limited():
    years = {"2024": {"mean_excess": 1.0}, "2025": {"mean_excess": 0.5}, "2026": {"mean_excess": -0.2}}
    ok = dict(kind="event", n=150, years=years, oos={"mean_excess": 0.3}, sensitive=False, coverage=0.9, envs={}, cfg=C)
    assert verdict.decide(main=_s(1.0, 3.0, 0.2), **ok)["verdict"] == verdict.VALID
    # 逐年只有 1/3 為正 → 不穩定
    bad_years = {**ok, "years": {"2024": {"mean_excess": 1}, "2025": {"mean_excess": -1}, "2026": {"mean_excess": -1}}}
    assert verdict.decide(main=_s(1.0, 3.0, 0.2), **bad_years)["verdict"] == verdict.UNSTABLE
    assert verdict.decide(main=_s(1.0, 3.0, 0.2), **{**ok, "sensitive": True})["verdict"] == verdict.UNSTABLE
    assert verdict.decide(main=_s(1.0, 3.0, 0.2), **{**ok, "oos": {"mean_excess": -0.1}})["verdict"] == verdict.UNSTABLE
    # t 2.4 < 2.5（區間不含 0）→ 無效（未達多重檢定門檻）
    r = verdict.decide(main=_s(1.0, 2.4, 0.1), **ok)
    assert r["verdict"] == verdict.INVALID and "2.5" in r["reasons"][0]
    assert verdict.decide(main=_s(-0.5, -2.0, -1.0), **ok)["verdict"] == verdict.INVALID
    envs = {"regime": {"on": _s(1.5, 3.0, 0.3, 120), "off": _s(-0.5, -1.0, -1.5, 40)}}
    r = verdict.decide(main=_s(0.5, 1.5, -0.1), **{**ok, "envs": envs})
    assert r["verdict"] == verdict.ENV and r["env"]["label"] == "大盤在 240 日線上"
    assert verdict.decide(main=_s(1.0, 3.0, 0.2), **{**ok, "n": 99})["verdict"] == verdict.FEW
    assert verdict.decide(main=_s(1.0, 3.0, 0.2), **{**ok, "coverage": 0.2})["verdict"] == verdict.LIMITED
    q = {**ok, "kind": "quintile", "n": 23}
    assert verdict.decide(main=_s(1.0, 3.0, 0.2), **q)["verdict"] == verdict.FEW


def test_sensitivity_rule():
    grid = {"a": 1.0, "b": 0.6, "c": 0.4}
    assert not verdict.sensitivity(grid, "a", ["b"], 0.5)
    assert verdict.sensitivity(grid, "a", ["b", "c"], 0.5)  # 0.4 < 0.5 × 1.0
    assert not verdict.sensitivity({"a": -1.0, "b": 1.0}, "a", ["b"], 0.5)  # 選定格不為正：不適用


def test_grid_neighbors():
    dims = {"n": [3, 5, 10], "門檻": [0.1, 0.3, 0.5]}
    grid = [Cell(f"n={n}／門檻={t}", {"n": n, "門檻": t}, np.zeros(1)) for n in dims["n"] for t in dims["門檻"]]
    chosen = next(c for c in grid if c.params == {"n": 5, "門檻": 0.3})
    assert sorted(neighbors(grid, dims, chosen)) == sorted(
        ["n=3／門檻=0.3", "n=10／門檻=0.3", "n=5／門檻=0.1", "n=5／門檻=0.5"]
    )


def test_walk_forward_windows():
    w = windows("2024-04-11", "2026-09-24")
    assert w == [("2024-04-11", "2025-04-11"), ("2025-04-11", "2026-04-11"), ("2026-04-11", "2026-09-25")]
    # 不足一年（千張大戶）：只有一段，不能 walk-forward（改用事先決定的參數格中間值）
    assert windows("2025-10-13", "2026-09-24") == [("2025-10-13", "2026-09-25")]
    assert windows("2025-01-02", "2026-09-24") == [("2025-01-02", "2026-01-02"), ("2026-01-02", "2026-09-25")]


# ------------------------------------------------------------------ 指標
def test_rs_raw_and_percentile():
    close = np.arange(1, 301, dtype=float)[:, None]
    rs = ind.rs_raw(close)
    t = 299  # close=300
    want = 0.4 * (300 / 237 - 1) + 0.2 * (300 / 174 - 1) + 0.2 * (300 / 111 - 1) + 0.2 * (300 / 48 - 1)
    assert rs[t, 0] == pytest.approx(want)
    assert np.isnan(rs[250, 0])  # 不足 252 日
    x = np.array([[1.0, 2.0, 3.0, 4.0]])
    uni = np.array([[True, True, True, False]])
    assert ind.cs_percentile(x, uni)[0].tolist()[:3] == pytest.approx([100 / 3, 200 / 3, 100])


def test_high52_excludes_today():
    close = np.r_[np.full(252, 100.0), 96.0][:, None]
    r = ind.high52_ratio(close)
    assert r[252, 0] == pytest.approx(0.96)
    assert np.isnan(r[251, 0])


def test_breakout_first_day_only():
    close = col(10, 11, 12, 11, 13, 14)
    ev, level = ind.breakout(close, 3)
    # 第 4 列 13 > max(11,12,11)=12 → 突破；第 5 列 14 > 13 也是突破但前一日已突破 → 不算
    assert ev[:, 0].tolist() == [False, False, False, False, True, False]
    assert level[4, 0] == 12


def test_volume_ratio_and_close_position():
    v = np.r_[np.full(20, 100.0), 150.0][:, None]
    assert ind.volume_ratio(v, 20)[20, 0] == pytest.approx(1.5)
    pos = ind.close_position(col(10, 10), col(8, 10), col(9.5, 10))
    assert pos[:, 0].tolist() == pytest.approx([0.75, 1.0])


def test_false_breakout():
    close = col(10, 10, 10, 11, 12, 9.9, 12, 12, 12)
    level = np.full_like(close, 10.0)
    assert ind.false_breakout(close, level, np.array([3]), np.array([0]), 5).tolist() == [1.0]
    assert np.isnan(ind.false_breakout(close, level, np.array([6]), np.array([0]), 5)[0])  # 之後不足 5 日


def test_kd_recursion_hand():
    # 9 日視窗：最高 20、最低 10；收盤 19 → RSV 90；K = 2/3×50 + 1/3×90 = 63.33；D = 2/3×50 + 1/3×63.33 = 54.44
    n = 9
    h = np.r_[np.full(n - 1, 20.0), 20.0][:, None]
    lo = np.r_[np.full(n - 1, 10.0), 10.0][:, None]
    c = np.r_[np.full(n - 1, 15.0), 19.0][:, None]
    K, D = ind.kd(h, lo, c)
    assert K[n - 1, 0] == pytest.approx(63.3333, abs=1e-3)
    assert D[n - 1, 0] == pytest.approx(54.4444, abs=1e-3)
    assert np.isnan(K[n - 2, 0])


def test_kd_events():
    K = col(70, 81, 82, 83, 84, 85, 86, 79, 81, 79)
    a, b = ind.kd_events(K, 80, 5)
    assert np.nonzero(a[:, 0])[0].tolist() == [5]  # 第 5 個連續 ≥ 80 的日子
    assert np.nonzero(b[:, 0])[0].tolist() == [7]  # 連續 6 日後跌破；第 9 列前面只有 1 日 → 不算


def test_macd_cross_and_warmup():
    hist = col(-1, -0.5, 0.2, 0.3, -0.1, 0.0, 0.4)
    assert np.nonzero(ind.macd_cross(hist)[:, 0])[0].tolist() == [2, 6]
    close = np.linspace(10, 20, 80)[:, None]
    dif, _hist = ind.macd(close, warmup=60)
    assert np.isnan(dif[59, 0]) and np.isfinite(dif[60, 0])
    # 手算：EMA 以 α=2/(n+1) 遞迴
    e12 = pd.Series(close[:, 0]).ewm(span=12, adjust=False).mean()
    e26 = pd.Series(close[:, 0]).ewm(span=26, adjust=False).mean()
    assert dif[79, 0] == pytest.approx(float(e12.iloc[79] - e26.iloc[79]))


def test_consecutive_buy_and_ratio():
    net = col(0, 10, 20, 30, 40, -5)
    avgv = np.full_like(net, 100.0)
    # 第 3 列為連買第 3 日：累計 60 ÷ 100 = 0.6
    assert ind.consecutive_buy(net, avgv, 3, 0.5)[:, 0].tolist() == [False, False, False, True, False, False]
    assert not ind.consecutive_buy(net, avgv, 3, 0.7)[:, 0].any()


def test_fill_chip_absent_is_zero_only_on_data_days():
    net = np.array([[NaN, NaN], [5.0, NaN]])
    close = np.array([[10.0, 10.0], [10.0, 10.0]])
    out = ind.fill_chip(net, close)
    assert np.isnan(out[0]).all()  # 當天沒有法人資料
    assert out[1].tolist() == [5.0, 0.0]


def test_sync_buy_first_day():
    f = col(0, 10, 10, 10, 10, 10, 10)
    t = col(0, 0, 0, 0, 0, 10, 10)
    avgv = np.full_like(f, 100.0)
    ev = ind.sync_buy(f, t, avgv, 5, 0.1)
    # 第 5 列：外資 5 日 50、投信 10 → 皆 > 0 且 60/100 ≥ 0.1；前一日投信 0 不成立
    assert np.nonzero(ev[:, 0])[0].tolist() == [5]


def test_extreme_uses_prior_window():
    x = np.r_[np.arange(1, 121, dtype=float), 120.0, 200.0][:, None]
    e = ind.extreme(x, 250, 95, 120)
    assert not e[119, 0]  # 還沒有 120 個過去值
    assert e[121, 0]  # 200 ≥ 過去 121 日的第 95 百分位


def test_margin_quadrant():
    # 前 6 列持平；第 6 列股價 5 日 +4%、融資 −4% → 價漲資減（首次成立）
    close = col(100, 100, 100, 100, 100, 100, 104, 104)
    margin = col(1000, 1000, 1000, 1000, 1000, 1000, 960, 1100)
    ud, uu = ind.margin_quadrant(close, margin, 5, 3, 3)
    assert np.nonzero(ud[:, 0])[0].tolist() == [6]
    # 第 7 列：股價 +4%、融資 1100/1000 = +10% → 價漲資增（前一日是另一個象限，也算首次成立）
    assert np.nonzero(uu[:, 0])[0].tolist() == [7]


def test_revenue_features_hand():
    months = pd.period_range("2024-01", "2025-04", freq="M").astype(str)
    rev = pd.DataFrame(
        {
            "code": "1101",
            "ym": months,
            "revenue": [100.0] * 13 + [99.0, 120.0, 130.0],
            "yoy": [NaN] * 12 + [1.0, 2.0, 3.0, 4.0],
        }
    )
    f = ind.revenue_features(rev)
    r = f.set_index("ym")
    assert bool(r.loc["2025-03", "high12"]) and not bool(r.loc["2025-01", "high12"])
    assert bool(r.loc["2025-03", "accel"])  # 3 > 2 > 1 且 > 0
    assert r.loc["2025-04", "dyoy"] == pytest.approx(1.0)


def test_revenue_effective_after_data_end_is_not_a_signal():
    """審查修正 2026-10-01：生效日（次月 10 日）晚於資料最後一天的月份不能落在最後一列當訊號。"""
    from pipeline.evidence.data import revenue_table

    dates = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]
    rev = pd.DataFrame(
        {"code": ["2330", "2330"], "ym": ["2026-08", "2026-09"], "revenue": [1.0, 2.0], "yoy": [1.0, 2.0]}
    )
    r = revenue_table(rev, dates, ["2330"], 10)
    assert r.loc[r["ym"] == "2026-08", "row"].item() == -1  # 9/10 生效，早於資料起點 → −1（資料之前）
    assert r.loc[r["ym"] == "2026-09", "row"].item() == len(dates)  # 10/10 生效，資料只到 10/1 → 不是訊號


def test_revenue_effective_next_month_10th_entry_after():
    dates = ["2026-02-09", "2026-02-10", "2026-02-11", "2026-03-09", "2026-03-11"]
    rev = pd.DataFrame(
        {"code": ["1101", "1101"], "ym": ["2026-01", "2026-02"], "revenue": [1.0, 2.0], "yoy": [1.0, 2.0]}
    )
    t = revenue_table(rev, dates, ["1101"], 10)
    # 2026-10-02：1 月營收生效 2/10（交易日）→ 訊號列 2/10 收盤，進場 2/11；
    # 2 月營收生效 3/10（非交易日）→ 訊號列＝之後第一個交易日 3/11 收盤（舊版提早到 3/9），進場再下一日
    assert t["row"].tolist() == [1, 4]


def _tdcc(weeks: list[str], pcts: list[float]) -> pd.DataFrame:
    rows = []
    for w, p in zip(weeks, pcts, strict=True):
        rows += [{"date": w, "code": "2330", "level": lv, "pct": v} for lv, v in ((12, 1), (13, 1), (14, 1), (15, p))]
    return pd.DataFrame(rows)


def test_whale_usable_from_rules():
    """v3 M0-2：週資料最早可被引用＝下週一（且至少公布日次日）。"""
    from pipeline.evidence.data import whale_usable_from

    assert whale_usable_from("2026-09-18") == "2026-09-21"  # 週五資料 → 下週一
    assert whale_usable_from("2026-09-24") == "2026-09-28"  # 週四資料（週五中秋休市）→ 下週一
    assert whale_usable_from("2026-02-07") == "2026-02-09"  # 週六補班資料 → 週日公布 → 週一


def test_whale_signal_day_monday_uses_last_friday():
    """T＝週一（9/21）：引用上週五（9/18）的週資料；週變化只出現在 9/21 這一列（進場 9/22 週二開盤）。"""
    dates = ["2026-09-17", "2026-09-18", "2026-09-21", "2026-09-22"]  # 週四、週五、下週一、週二
    w = whale_frames(_tdcc(["2026-09-11", "2026-09-18"], [10.0, 10.4]))
    assert w["chg"].iloc[-1] == pytest.approx(0.4)
    assert w["published"].iloc[-1] == "2026-09-19"
    p = whale_panels(w, dates, ["2330"])
    assert p["pct"][2, 0] == pytest.approx(10.4)
    assert p["chg"][2, 0] == pytest.approx(0.4) and np.isnan(p["chg"][1, 0]) and np.isnan(p["chg"][3, 0])


def test_whale_signal_day_friday_not_this_week():
    """T＝週五（9/18）：只能用上週五（9/11）的資料，不得引用 T 當週（9/18 的資料要 9/19 才公布）。"""
    dates = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"]
    w = whale_frames(_tdcc(["2026-09-04", "2026-09-11", "2026-09-18"], [9.8, 10.0, 10.4]))
    p = whale_panels(w, dates, ["2330"])
    assert p["pct"][4, 0] == pytest.approx(10.0)  # 9/18 看到的是 9/11 那週
    assert p["chg"][0, 0] == pytest.approx(0.2)  # 9/11 那週的週變化在 9/14（週一）
    assert np.isnan(p["chg"][4, 0])


def test_whale_signal_day_after_long_holiday():
    """連假：9/24（週四）資料（9/25 中秋、9/28 教師節休市）→ 第一個可引用的訊號日是 9/29（週二），進場 9/30；
    9/24 當天（T＝週四）引用的是 9/18 那週。"""
    dates = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-29", "2026-09-30"]
    w = whale_frames(_tdcc(["2026-09-18", "2026-09-24"], [10.0, 10.5]))
    p = whale_panels(w, dates, ["2330"])
    assert p["pct"][3, 0] == pytest.approx(10.0)
    assert p["pct"][4, 0] == pytest.approx(10.5) and p["chg"][4, 0] == pytest.approx(0.5)
    assert np.isnan(p["chg"][3, 0])


def test_universe_rules():
    T = 130
    close = np.full((T, 3), 20.0)
    close[:, 1] = 9.0  # 價格 < 10
    close[:10, 2] = NaN  # 第 3 檔第 10 列才掛牌
    value = np.full((T, 3), 3e7)

    class E:
        pass

    e = E()
    e.raw_close, e.value = close, value
    e.disposition = np.zeros((T, 3), dtype=bool)
    e.disposition[125, 0] = True
    u = universe.build(e, {"min_listed_days": 120, "min_avg_value": 2e7, "min_close": 10, "avg_value_days": 20})
    assert u[124, 0] and not u[125, 0]  # 處置期間
    assert not u[:, 1].any()
    assert not u[128, 2] and u[129, 2]  # 第 10 列起算第 120 日＝第 129 列


def test_quintile_month_hand():
    values = np.arange(10, dtype=float)
    rets = np.arange(10, dtype=float) / 100
    means, rho = quintile.quintile_month(values, rets)
    assert means == pytest.approx([0.005, 0.025, 0.045, 0.065, 0.085])
    assert rho == pytest.approx(1.0)
    assert quintile.spearman(np.arange(9.0), np.arange(9.0)) is None  # 少於 10 檔不算
    means, rho = quintile.quintile_month(np.arange(20.0), -np.arange(20.0))
    assert rho == pytest.approx(-1.0)


# ------------------------------------------------------------------ 策略庫（M2）
def test_simulate_single_slot_hand():
    from pipeline.evidence.strategies import curve_stats, simulate

    o = col(100, 100, 104, 105, 107)
    c = col(100, 102, 106, 108, 108)
    mk = _market(o, c)
    trades = pd.DataFrame({"e": [1], "c": [0], "x": [3], "entry": [100.0], "px": [105.0]})
    eq = simulate(mk, trades, np.ones_like(o), 1, 1)
    fee, tax, slip = mk.fee, mk.tax, mk.slip
    shares = 1 / (100 * (1 + slip) * (1 + fee))
    assert eq[0] == pytest.approx(shares * 102)  # 第 1 列收盤
    assert eq[1] == pytest.approx(shares * 106)
    cash = shares * 105 * (1 - slip) * (1 - fee - tax)  # 第 3 列開盤出場
    assert eq[2] == pytest.approx(cash) and eq[3] == pytest.approx(cash)
    st = curve_stats(np.array([1.0, 1.2, 0.9, 1.1] * 6), ["2025-01-01"] * 24)
    assert st["mdd"] == pytest.approx(-25.0)  # 1.2 → 0.9


def test_simulate_slots_fill_by_value_and_skip_held():
    from pipeline.evidence.strategies import simulate

    o = np.full((6, 3), 10.0)
    mk = _market(o, o.copy())
    # 第 1 列三檔同時進場、只有 2 個空位 → 取前一日成交值較大的兩檔（c=2、c=0）
    trades = pd.DataFrame(
        {"e": [1, 1, 1, 2], "c": [0, 1, 2, 0], "x": [4, 4, 4, 5], "entry": [10.0] * 4, "px": [10.0] * 4}
    )
    value = np.array([[5.0, 1.0, 9.0]] * 6)
    eq = simulate(mk, trades, value, 2, 1)
    # 兩檔各投入一半，價格不變：權益只少買進手續費與滑價
    assert eq[0] == pytest.approx(1 / ((1 + mk.slip) * (1 + mk.fee)))


def test_health_rules():
    from pipeline.evidence.strategies import health

    assert health({"mean_excess": 1.0, "recent": {"n": 5, "mean_excess": -1}}, 20)["status"] == "資料累積中"
    assert health({"mean_excess": 1.0, "recent": {"n": 30, "mean_excess": -0.1}}, 20)["status"] == "近期轉弱"
    assert health({"mean_excess": 1.0, "recent": {"n": 30, "mean_excess": 0.3}}, 20)["status"] == "近期低於長期"
    assert health({"mean_excess": 1.0, "recent": {"n": 30, "mean_excess": 0.8}}, 20)["status"] == "與長期一致"


def test_best_exit_by_excess_vs_index():
    from pipeline.evidence.strategies import best_exit

    d = {
        "exits": {
            "rules": [
                {"rule": "fixed", "param": "10", "chosen": True, "n": 100, "exc_idx": -1.0, "mae": -5},
                {"rule": "ma", "param": "20", "chosen": True, "n": 100, "exc_idx": 0.5, "mae": -4},
                {"rule": "ma", "param": "60", "chosen": False, "n": 100, "exc_idx": 2.0, "mae": -9},
            ]
        }
    }
    assert best_exit(d)["param"] == "20"  # 只比較各規則的選定參數


def test_coverage_single_definition_matches_counts():
    """v3 M0-3：涵蓋率＝Σ每日有資料 ÷ Σ每日 universe；「納入 x／y 檔」＝每日平均，x ÷ y＝涵蓋率。

    3 天、4 檔：universe 每天 4、4、2 檔；universe 內有資料 1、2、1 檔（第 3 天第 2 檔有資料但不在 universe）
    → 涵蓋率 4 ÷ 10 ＝ 40%；每日平均 1.33 → 1、3.33 → 3（1 ÷ 3 ≈ 33%，四捨五入後的顯示仍以 40% 為準）。
    曾經納入 2 檔（第 0、1 檔）、曾在 universe 4 檔。
    """
    from pipeline.evidence.run import coverage, coverage_label

    class E:
        dates: typing.ClassVar[list[str]] = ["2026-01-05", "2026-01-06", "2026-01-07"]
        codes: typing.ClassVar[list[str]] = ["1101", "1102", "1103", "1104"]
        delist_date: typing.ClassVar[dict[str, str]] = {"1102": "2026-03-01"}

    uni = np.array([[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 0, 0]], dtype=bool)
    avail = np.array([[1, 0, 0, 0], [1, 1, 0, 0], [0, 1, 1, 0]], dtype=bool)

    class Tst:
        pass

    t = Tst()
    t.avail = avail  # type: ignore[attr-defined]
    c = cfg()
    cov = coverage(t, E(), uni, "2026-01-05", c)  # type: ignore[arg-type]
    assert cov["ratio"] == 0.4 and cov["included"] == 1 and cov["universe"] == 3
    assert cov["ever_included"] == 2 and cov["ever_universe"] == 4
    assert cov["ever_delisted"] == 1  # 納入的 1101、1102 中，1102 已終止上市
    assert cov["label"] == "樣本範圍受限"
    assert (
        coverage_label(0.49, c) == "樣本範圍受限"
        and coverage_label(0.9, c) is None
        and coverage_label(0.89, c) == "部分涵蓋"
    )


def test_weekly_coverage_by_iso_week():
    """每週涵蓋率：1/5–1/7（同一週）Σuniverse 內有資料 4 ÷ Σuniverse 10 ＝ 0.4；1/12（下一週）2 ÷ 4 ＝ 0.5。"""
    from pipeline.evidence.run import weekly_coverage

    dates = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-12"]
    uni = np.array([[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 0, 0], [1, 1, 1, 1]], dtype=bool)
    avail = np.array([[1, 0, 0, 0], [1, 1, 0, 0], [0, 1, 1, 0], [1, 1, 0, 0]], dtype=bool)
    w = weekly_coverage(avail, uni, dates, "2026-01-01")
    assert [x["date"] for x in w] == ["2026-01-07", "2026-01-12"]
    assert [x["ratio"] for x in w] == [0.4, 0.5]
    assert w[0]["included"] == 1 and w[0]["universe"] == 3


def test_hindsight_waits_until_full_coverage():
    """涵蓋率未達 90% 不比較「原 31 檔 vs 全市場」。"""
    from pipeline.evidence.run import hindsight

    out = hindsight(np.zeros((1, 1), bool), None, "2026-01-01", {"ratio": 0.62}, {}, cfg())  # type: ignore[arg-type]
    assert out == {"status": "waiting", "coverage": 0.62, "threshold": 0.9}
    assert len(cfg()["hindsight_codes"]) == 31


def test_official_delistings_exclude_transfer():
    from pipeline.evidence.data import official_delistings

    dl = pd.DataFrame(
        {
            "code": ["1101", "6446", "2888"],
            "date": ["2020-01-02", "2024-01-25", "2025-07-24"],
            "kind": ["delisted", "transfer", "delisted"],
        }
    )
    assert official_delistings(dl) == {"1101": "2020-01-02", "2888": "2025-07-24"}


def test_full_delivery_mask_snapshots_and_additions():
    """快照：9/28 名單有 A、9/30 名單只剩 B → A 標記 9/28–9/29、B 自 9/30 起。
    歷史新增：C 在 9/22 新增、9/25 終止上市 → 標記 9/22–9/24；D 在 9/22 新增、快照裡沒有、也沒下市 → 假設 2 個交易日。"""
    from pipeline.evidence.data import full_delivery_mask

    dates = ["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-28", "2026-09-29", "2026-09-30"]
    codes = ["A", "B", "C", "D"]
    cmode = pd.DataFrame(
        {
            "code": ["A", "B"],
            "altered": [True, True],
            "managed": [False, False],
            "asof": ["2026-09-28", "2026-09-30"],
            "source": ["twse_cmode", "twse_cmode"],
        }
    )
    add = pd.DataFrame({"code": ["C", "D"], "date": ["2026-09-22", "2026-09-22"]})
    m, note = full_delivery_mask(cmode, add, {"C": "2026-09-25"}, dates, codes, assume_days=2)
    assert m[:, 0].tolist() == [False, False, False, True, True, False]
    assert m[:, 1].tolist() == [False] * 5 + [True]
    assert m[:, 2].tolist() == [True, True, True, False, False, False]
    assert m[:, 3].tolist() == [True, True, False, False, False, False]
    assert note["assumed"] == 1 and note["additions"] == 2


def test_delisted_exit_last_close_and_conservative():
    """下市：進場 100、持有中下市（最後收盤 60）→ 以 60 出場並標示；保守版本淨報酬 −100%。
    停牌到資料結束但不在官方名單 → halted（同樣以最後收盤出場，不套保守版本）。"""
    from pipeline.evidence import engine, stats

    T = 8
    op = np.full((T, 3), 100.0)
    op[4:, 1] = NaN  # 第 2 檔第 4 列起無法成交（下市）
    op[4:, 2] = NaN  # 第 3 檔第 4 列起停牌（官方沒有下市）
    cl = op.copy()
    cl[3, 1] = 60.0
    cl[3, 2] = 80.0
    vol = np.where(np.isfinite(op), 1000.0, 0.0)
    mk = engine.Market(
        dates=[f"2026-01-{i + 5:02d}" for i in range(T)],
        open=op,
        high=cl.copy(),
        low=cl.copy(),
        close=cl,
        volume=vol,
        universe=np.ones((T, 3), dtype=bool),
        bench=np.full(T, 100.0),
        bench_is_tr=True,
        regime_up=np.ones(T, dtype=bool),
        trend_up=np.ones(T, dtype=bool),
        quarter_end=np.zeros(T, dtype=bool),
        limit_up_pct=9.5,
        gap_pct=5,
        limit_down_pct=-9.5,
        horizons=[3],
        official_delisted=np.array([False, True, False]),
    )
    df = engine.evaluate(mk, np.array([1, 1, 1]), np.array([0, 1, 2]), 3)
    assert df["delisted"].tolist() == [False, True, False]
    assert df["halted"].tolist() == [False, False, True]
    fee, tax, slip = mk.fee, mk.tax, mk.slip
    assert df.loc[1, "net"] == pytest.approx(engine.net_return(0.6 - 1, fee, tax, slip))
    df = engine.annotate(df, mk)
    c = cfg()
    d = stats.delist_conservative(df, c)
    assert d is not None and d["affected"] == 1
    # 同一進場日 3 筆平均：(0 基準) 超額＝淨報酬；下市那筆改為 −1
    n0 = engine.net_return(0.0, fee, tax, slip)
    n2 = engine.net_return(0.8 - 1, fee, tax, slip)
    # 基準＝同日全市場平均（毛報酬，不扣成本），保守版本只改下市那筆的淨報酬
    mm = mk.market_mean[3][2]
    # 同日全市場（進場第 2 列）：0%、−40%（下市最後收盤 60）、−20%（停牌最後收盤 80）三檔毛報酬平均
    assert mm == pytest.approx((0.0 + -0.4 + -0.2) / 3)
    assert d["mean_excess"] == pytest.approx(((n0 - mm) + (-1 - mm) + (n2 - mm)) / 3 * 100, abs=1e-3)


def test_verdict_changes_only_after_limited():
    """v3 M4-2：只有原本「樣本範圍受限」、這次改判的大戶類指標才推播；文字不含買賣字眼。"""
    from pipeline.evidence.run import verdict_changes

    prev = [
        {"id": "combo_three", "verdict": "樣本範圍受限"},
        {"id": "whale_up", "verdict": "樣本範圍受限"},
        {"id": "rs90", "verdict": "無效"},
    ]
    rows = [
        {
            "id": "combo_three",
            "label": "三方同買",
            "verdict": "無效",
            "coverage": {"ratio": 0.93},
            "mean_excess": 0.4,
            "t": 0.8,
            "n": 900,
        },
        {"id": "whale_up", "label": "千張大戶週增", "verdict": "樣本範圍受限", "coverage": {"ratio": 0.4}},
        {"id": "rs90", "label": "RS", "verdict": "有效"},
    ]
    msgs = verdict_changes(prev, rows)
    assert len(msgs) == 1 and "三方同買 由「樣本範圍受限」改判為「無效」（涵蓋率 93%" in msgs[0]
    assert "買進" not in msgs[0] and "賣出" not in msgs[0]


def test_corrected_t_takes_smallest_absolute_value():
    """2026-10-03 全站統一：一律取日曆時間法、NW、區塊三者 |t| 最小者（保留正負號），集中進場不再例外。"""
    from pipeline.evidence import audit

    rng = np.random.default_rng(3)
    n = 400
    d = pd.DataFrame({"e": np.arange(n), "exc_mkt": rng.normal(-0.002, 0.03, n), "t": np.arange(n), "c": 0})
    r = audit.corrected_t(d, 10, period_days=n, ratio=0.25)
    cands = [v for v in (r["t"], r["t_nw"], r["t_block"]) if v is not None]
    assert r["t_corr"] == min(cands, key=abs)
    assert r["t_corr_method"] == "min(日曆, NW, 區塊)" and r["nw_lag"] == 10
    # 集中進場（進場日只佔 2.5%）→ 同樣取最小；NW 落後期數換算成持有期內的進場日數 ceil(10 × 400 ÷ 16000) = 1
    r2 = audit.corrected_t(d, 10, period_days=n * 40, ratio=0.25)
    c2 = [v for v in (r2["t"], r2["t_nw"], r2["t_block"]) if v is not None]
    assert r2["t_corr"] == min(c2, key=abs) and r2["nw_lag"] == 1


def test_nw_lag_counts_overlapping_entry_dates():
    from pipeline.evidence import audit

    assert audit.nw_lag(40, 2000, 2000) == 40  # 每天進場：落後＝持有日數
    assert audit.nw_lag(40, 113, 2333) == 2  # 每月進場一次（約 21 個交易日一次）：持有 40 日只與下一次重疊
    assert audit.nw_lag(40, 10, None) == 40  # 期間未知：視為每天進場
    assert audit.nw_lag(5, 1, 1000) == 1