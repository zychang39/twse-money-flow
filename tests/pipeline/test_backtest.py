"""回測：以人造價格序列驗證無前視偏差、成本扣除、排除規則、還原價、不重疊。"""

from __future__ import annotations

import numpy as np
import pytest

from pipeline.derive import backtest as bt
from pipeline.derive import indicators as ind

T = 12
DATES = [f"2026-01-{d:02d}" for d in range(5, 5 + T)]


def make_prices(
    open_: list[float], close: list[float] | None = None, low: list[float] | None = None, etf: bool = False, **kw
) -> bt.Prices:
    o = np.array(open_, dtype=float)[:, None]
    c = np.array(close if close is not None else open_, dtype=float)[:, None]
    lo = np.array(low if low is not None else np.minimum(o[:, 0], c[:, 0]), dtype=float)[:, None]
    return bt.Prices(
        dates=DATES[: len(open_)],
        codes=["S"],
        open=o,
        low=lo,
        close=c,
        tradable=kw.get("tradable", np.isfinite(o)),
        blocked=kw.get("blocked", np.zeros_like(o, dtype=bool)),
        bench=np.array(kw.get("bench", [100.0] * len(open_))),
        regime_up=np.ones(len(open_), dtype=bool),
        is_etf=np.array([etf]),
    )


def sig(*days: int, n: int = T) -> np.ndarray:
    s = np.zeros((n, 1), dtype=bool)
    for d in days:
        s[d, 0] = True
    return s


def test_entry_is_next_open_no_lookahead():
    # 第 2 天收盤出訊號；第 3 天開盤跳空到 106（訊號當天看不到）→ 進場價必須是 106，不是 100
    opens = [100, 100, 100, 106, 111, 112, 113, 114, 115, 116, 117, 118]
    px = make_prices(opens)
    res = bt.run(sig(2), px, horizons=[5], decay_days=3)
    tr = res["trades"][5][0]
    assert tr.entry_date == DATES[3] and tr.entry == 106
    assert tr.exit_date == DATES[8] and tr.exit == 115  # 持有 5 日後開盤出場
    assert tr.gross == pytest.approx(115 / 106 - 1)


def test_costs_deducted():
    fee = 0.001425 * 0.6
    expected = (1.1) * (1 - fee - 0.003) / (1 + fee) - 1
    assert bt.net_return(0.10, is_etf=False) == pytest.approx(expected)
    assert bt.net_return(0.10, is_etf=True) == pytest.approx(1.1 * (1 - fee - 0.001) / (1 + fee) - 1)
    assert bt.net_return(0.0, False) < 0  # 不漲不跌也會因成本虧損


def test_exclusions_limit_up_suspended_disposition():
    opens = [100, 100, 110, 100, np.nan, 100, 100, 100, 100, 100, 100, 100]
    blocked = np.zeros((T, 1), dtype=bool)
    blocked[7, 0] = True
    px = make_prices(opens, blocked=blocked)
    res = bt.run(sig(1, 3, 6), px, horizons=[2], decay_days=1)
    # 第 1 天訊號 → 第 2 天開盤 110（+10%）排除；第 3 天訊號 → 第 4 天停牌；第 6 天訊號 → 第 7 天處置
    assert res["excluded"] == {"limit_up": 1, "suspended": 1, "disposition": 1, "no_future": 0}
    assert res["trades"][2] == []


def test_exit_skips_suspension_and_delisting():
    opens = [100, 100, 100, np.nan, 104, 105, np.nan, np.nan, np.nan, np.nan, np.nan, np.nan]
    closes = [100, 100, 101, np.nan, 104, 106, np.nan, np.nan, np.nan, np.nan, np.nan, np.nan]
    px = make_prices(opens, closes)
    res = bt.run(sig(1), px, horizons=[1, 4], decay_days=1)
    t1 = res["trades"][1][0]  # 進場第 2 天；出場第 3 天停牌 → 順延到第 4 天開盤 104
    assert t1.exit_date == DATES[4] and t1.exit == 104 and not t1.delisted
    t4 = res["trades"][4][0]  # 出場日之後都沒有交易 → 以最後收盤 106 出場並標示下市
    assert t4.delisted and t4.exit == 106


def test_mae_and_benchmark_excess():
    opens = [100] * T
    lows = [100, 100, 95, 97, 100, 100, 100, 100, 100, 100, 100, 100]
    bench = [100, 100, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109]
    px = make_prices(opens, low=lows, bench=bench)
    tr = bt.run(sig(1), px, horizons=[3], decay_days=1)["trades"][3][0]
    assert tr.mae == pytest.approx(-0.05)
    # 報酬指數：訊號日收盤（第 1 天 100）→ 出場前一日收盤（第 4 天 102）
    assert tr.bench == pytest.approx(0.02)
    assert tr.excess == pytest.approx(tr.net - 0.02)


def test_adjusted_prices_remove_dividend_gap():
    # 原始價：除息 5 元（第 4 天開盤由 100 變 95），還原後持有期間沒有假虧損
    raw_open = np.array([100.0] * 4 + [95.0] * 8)
    af = ind.adjustment_factor(DATES, [(DATES[4], 95 / 100)])
    px = make_prices(list(raw_open * af))
    tr = bt.run(sig(1), px, horizons=[5], decay_days=1)["trades"][5][0]
    assert tr.gross == pytest.approx(0.0)


def test_non_overlapping_and_stats():
    opens = list(np.linspace(100, 111, T))
    px = make_prices(opens)
    res = bt.run(sig(0, 1, 2, 5), px, horizons=[3], decay_days=2)
    trades = res["trades"][3]
    assert len(trades) == 4
    no = bt.non_overlapping(trades)
    # 0 號訊號：進場 1、出場 4；1、2 號訊號的進場日 2、3 在持有期間內 → 略過；5 號保留
    assert [t.signal_date for t in no] == [DATES[0], DATES[5]]
    s = bt.stats(trades)
    assert s["n"] == 4 and s["win_rate"] == 100 and s["low_reference"] is True
    summary = bt.summarize(res, DATES, detail_horizon=3)
    assert summary["horizons"]["3"]["non_overlap"]["n"] == 2
    assert summary["trades"][0]["signal"] == DATES[5]
    assert len(summary["decay"]) == 2 and summary["decay"][0] is not None


def test_conditions_mask():
    a = np.array([[1.0, np.nan], [3.0, 5.0]])
    m = bt.conditions_mask([{"field": "x", "op": ">=", "value": 2}], lambda f: a)
    assert m.tolist() == [[False, False], [True, True]]
    m2 = bt.conditions_mask([{"field": "x", "op": "between", "value": [2, 4]}], lambda f: a)
    assert m2.tolist() == [[False, False], [True, False]]
