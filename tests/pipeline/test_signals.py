"""訊號驗證（S1／S2／S5）：新觸發、資料涵蓋、停損出場、集保大戶生效日與過期。"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from pipeline.derive import backtest as bt
from pipeline.derive.advanced_panels import whale_panels
from pipeline.derive.metrics import as_of_panel
from tests.pipeline.test_backtest import DATES, make_prices, sig


def test_new_triggers_only_first_day_and_needs_evaluable_previous_day():
    #            d0     d1     d2     d3    d4     d5
    mask = np.array([[True], [True], [False], [True], [True], [True]])
    ev = np.array([[True], [True], [True], [True], [False], [True]])
    new = bt.new_triggers(mask, ev)
    # d0：第一天沒有前一日；d1：前一日已成立；d3：前一日不成立 → 新觸發；d5：前一日無法判斷 → 不算
    assert new[:, 0].tolist() == [False, False, False, True, False, False]


def test_new_triggers_not_at_data_start():
    # 資料從 d2 開始（之前 NaN）：d2 成立但前一日無法判斷，不能算新觸發（否則資料起點會出現一大批假訊號）
    arr = np.array([[np.nan], [np.nan], [1.0], [1.0], [0.0], [1.0]])
    look = lambda f: arr  # noqa: E731
    conds = [{"field": "x", "op": ">", "value": 0}]
    mask = bt.conditions_mask(conds, look)
    ev = bt.conditions_evaluable(conds, look)
    assert mask is not None and ev is not None
    assert bt.new_triggers(mask, ev)[:, 0].tolist() == [False, False, False, False, False, True]


def test_field_coverage_and_eligible_start():
    dates = ["2026-01-01", "2026-01-02", "2026-01-03"]
    a = np.array([[1.0, 1.0, 1.0], [1.0, 1.0, 1.0], [1.0, 1.0, 1.0]])
    b = np.array([[np.nan, np.nan, np.nan], [np.nan, 2.0, np.nan], [np.nan, 2.0, np.nan]])
    look = {"a": a, "b": b}.get
    cov = bt.field_coverage([{"field": "a"}, {"field": "b"}], look, dates, ["X", "Y", "Z"])
    assert cov == [
        {"field": "a", "stocks": 3, "first_date": "2026-01-01"},
        {"field": "b", "stocks": 1, "first_date": "2026-01-02"},
    ]
    start = max(c["first_date"] for c in cov)
    m = np.ones((3, 3), dtype=bool)
    assert bt.eligible_mask(m, dates, start).sum() == 6  # 1/1 那天不產生訊號
    assert bt.eligible_mask(m, dates, None).sum() == 0


def test_stop_loss_exit_intraday_and_gap_down():
    # 進場 100（第 1 天開盤）；第 3 天盤中低點 92 → 停損 −7% 在 93 出場
    opens = [100, 100, 99, 97, 96, 95, 94, 93, 92, 91, 90, 89]
    lows = [100, 99, 98, 92, 95, 94, 93, 92, 91, 90, 89, 88]
    px = make_prices(opens, low=lows)
    tr = bt.run(sig(0), px, horizons=[5], rule="stop", stop_pct=-7)["trades"][5][0]
    assert tr.exit_date == DATES[3] and tr.exit == pytest.approx(93)
    # 跳空：第 3 天開盤就在 90（停損價之下）→ 只能以開盤價 90 出場
    opens2 = [100, 100, 99, 90, 96, 95, 94, 93, 92, 91, 90, 89]
    lows2 = [100, 99, 98, 88, 95, 94, 93, 92, 91, 90, 89, 88]
    tr2 = bt.run(sig(0), make_prices(opens2, low=lows2), horizons=[5], rule="stop", stop_pct=-7)["trades"][5][0]
    assert tr2.exit == 90
    # 只看時間：持有 5 日後開盤
    tr3 = bt.run(sig(0), px, horizons=[5])["trades"][5][0]
    assert tr3.exit_date == DATES[6] and tr3.exit == 94


def test_trailing_ma_exit_next_open():
    opens = [100.0] * 12
    closes = [100, 101, 102, 95, 103, 104, 105, 106, 107, 108, 109, 110]
    ma = np.full((12, 1), 98.0)
    px = make_prices(opens, close=closes)
    tr = bt.run(sig(0), px, horizons=[10], rule="trailing", ma=ma)["trades"][10][0]
    # 第 3 天收盤 95 跌破均線 98 → 第 4 天開盤出場
    assert tr.exit_date == DATES[4]


def test_whale_effective_after_publication_monday():
    """S1-3：集保資料日（週五）次日（週六）公布；最早在下週一收盤的訊號使用（週二開盤進場），不是週五。"""
    dates = ["2025-10-02", "2025-10-03", "2025-10-06", "2025-10-07", "2025-10-08", "2025-10-09", "2025-10-13"]
    rows = []
    # 10/3（五）與 10/9（四；10/10 國慶休市）兩週
    for d, pct in [("2025-10-03", 40.0), ("2025-10-09", 41.0)]:
        rows.append({"date": d, "code": "A", "level": 15, "pct": pct})
    w = whale_panels(pd.DataFrame(rows), dates, ["A"])
    pct_col = w["whale_pct"]["A"].tolist()
    assert np.isnan(pct_col[1])  # 10/3（資料日）當天不能用
    assert pct_col[2] == 40.0  # 10/6（一）起可用
    assert pct_col[5] == 40.0  # 10/9（四，資料日）仍是上週的值
    assert pct_col[6] == 41.0  # 10/13（一）才換成 10/9 的資料
    assert w["whale_change"]["A"].tolist()[6] == pytest.approx(1.0)


def test_weekly_value_expires_when_not_updated():
    dates = [f"2026-01-{d:02d}" for d in range(1, 21)]
    rec = pd.DataFrame([{"code": "A", "effective": "2026-01-02", "v": 5.0}])
    out = as_of_panel(rec, "v", dates, ["A"], max_age=7)["A"].tolist()
    assert out[1] == 5.0 and out[8] == 5.0  # 7 個交易日內沿用
    assert np.isnan(out[9])  # 之後視為缺值
    assert as_of_panel(rec, "v", dates, ["A"])["A"].tolist()[-1] == 5.0  # 不設上限：沿用（其他面板行為不變）


def test_signals_file_helpers_today_and_exit_tomorrow():
    from pipeline.derive.signals import exits_tomorrow, today_triggers

    f = {
        "dates": [f"2026-09-{d:02d}" for d in (14, 15, 16, 17, 18, 21, 22, 23, 24)],
        "presets": [
            {"id": "p", "label": "三方同買", "triggers": {"2026-09-21": ["2330"], "2026-09-24": ["2317", "2454"]}}
        ],
    }
    assert today_triggers(f) == {"三方同買": ["2317", "2454"]}
    # 持有 3 日：9/21 訊號 → 9/22 進場 → 第 3 個交易日（9/25 之後的下一個交易日，也就是「明天」）開盤出場
    assert exits_tomorrow(f, "p", 3) == ["2330"]
    assert exits_tomorrow(f, "p", 3, since="2026-09-21") == []  # 啟用追蹤之前的訊號不算
    assert exits_tomorrow(f, "p", 2) == []
    assert exits_tomorrow(f, "p", 20) == []
