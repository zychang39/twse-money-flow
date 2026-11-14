"""順風檢查（pipeline/derive/tailwind.py；2026-11-13）：兩個數字三種狀態、溫度計序列、類股超配與個股風格。"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.derive import tailwind as T


def test_state_of_two_numbers_three_states():
    # 順風＝自己賺錢且贏大盤；中性＝自己賺錢但輸大盤；逆風＝自己賠錢
    assert T.state_of(0.24, 0.20, 1.0) == "tail"
    assert T.state_of(0.15, 0.20, 1.0) == "neutral"
    assert T.state_of(-0.02, 0.20, 1.0) == "head"
    # 邊界：跟大盤幾乎一樣（差不到 1 個百分點）→ 中性；大盤為負時規則不變（贏大盤但賠錢仍是逆風）
    assert T.state_of(0.205, 0.20, 1.0) == "neutral"
    assert T.state_of(-0.05, -0.10, 1.0) == "head"
    assert T.state_of(0.03, -0.10, 1.0) == "tail"
    assert T.state_of(None, 0.2, 1.0) is None and T.state_of(0.1, None, 1.0) is None


def test_sector_key_and_trailing():
    assert T.sector_key("半導體業") == "半導體"
    assert T.sector_key("水泥工業") == "水泥"
    assert T.sector_key("建材營造") == "建材營造"
    assert T.sector_key("ETF") is None and T.sector_key(None) is None
    dates = [d.strftime("%Y-%m-%d") for d in pd.bdate_range("2025-01-01", "2026-03-31")]
    s = pd.Series(np.linspace(100, 160, len(dates)), index=dates)
    r12 = T.trailing(s, 12)
    assert r12 is not None and abs(r12 - (160 / s[s.index <= "2025-03-31"].iloc[-1] - 1)) < 1e-9
    assert T.trailing(s, 24) is None  # 資料不到 24 個月
    stale = s.copy()
    stale.iloc[-5:] = np.nan
    assert T.trailing(stale, 3) is None  # 期末沒有值：不拿舊值頂替


def test_splice_and_stale_index():
    dates = [d.strftime("%Y-%m-%d") for d in pd.bdate_range("2026-01-01", periods=100)]
    idx = pd.Series(np.linspace(1000, 1200, 100), index=dates)
    etf = pd.Series([np.nan] * 40 + list(np.linspace(20, 23, 60)), index=dates)
    s, first, source = T.splice(etf, idx)
    assert s is not None
    assert source == "spliced" and first == dates[40]
    assert abs(s.iloc[0] / s.iloc[40] - idx.iloc[0] / idx.iloc[40]) < 1e-12  # 掛牌前照指數的漲跌
    assert s.iloc[-1] == etf.iloc[-1]
    assert T.splice(etf, None)[2] == "etf" and T.splice(None, idx)[2] == "index"
    assert T.splice(None, None)[0] is None
    # 指數停止公布（最後一筆早於最新交易日 7 天以上）→ 不當成類股
    stale = idx.copy()
    stale.iloc[-10:] = np.nan
    table = pd.DataFrame(
        [
            {"date": d, "name": n, "kind": "return", "close": v}
            for n, ser in (("甲類報酬指數", idx), ("乙類報酬指數", stale))
            for d, v in ser.dropna().items()
        ]
        + [{"date": d, "name": "發行量加權股價報酬指數", "kind": "return", "close": v} for d, v in idx.items()]
    )
    th = T.build_thermos(pd.DataFrame(index=dates), table, dates, {}, {**T.settings(), "styles": []})
    assert th.sectors == {"甲": "甲類報酬指數"} and "mkt" in th.daily.columns


def test_weights_allocation_and_styles():
    industries = {"1": "半導體業", "2": "半導體業", "3": "金融保險業", "4": "金融保險業", "9": "ETF"}
    markets = {"1": "twse", "2": "twse", "3": "twse", "4": "tpex"}
    mcap = pd.Series({"1": 600.0, "2": 100.0, "3": 300.0, "4": 500.0})
    wm = T.market_weights(mcap, industries, markets)  # 大盤只算上市
    assert wm == {"半導體": 70.0, "金融保險": 30.0}
    hold = pd.DataFrame(
        {
            "date": ["2026-11-06"] * 2 + ["2026-11-13"] * 3,
            "etf": ["00938"] * 5,
            "code": ["1", "3", "1", "3", "4"],
            "weight": [50.0, 50.0, 30.0, 50.0, 20.0],
        }
    )
    w, day = T.etf_weights(hold, "00938", industries)
    assert day == "2026-11-13" and w == {"半導體": 30.0, "金融保險": 70.0}  # 只用最新一份
    assert T.etf_weights(hold, "0050", industries) == ({}, None)
    # 粗略的拆法：Σ（ETF 權重 − 大盤權重）×（類股報酬 − 大盤報酬）
    a = T.allocation(w, wm, {"半導體": 0.34, "金融保險": 0.10}, 0.20)
    assert a is not None and abs(a - ((-0.40) * 0.14 + 0.40 * (-0.10))) < 1e-12
    assert T.holdings_by_code(hold, [{"key": "quality", "etf": "00938"}]) == {
        "1": {"quality": 30.0},
        "3": {"quality": 50.0},
        "4": {"quality": 20.0},
    }
    pct = T.style_percentiles({"value": pd.Series({"a": 1.0, "b": 2.0, "c": 3.0, "d": np.nan})})
    assert list(pct["value"].round(1).fillna(-1)) == [16.7, 50.0, 83.3, -1.0]
    order = ["value", "quality", "momentum", "size", "lowvol"]
    assert T.main_style({"value": 82, "quality": 91, "momentum": 40}, {}, order, 70) == "quality"
    assert T.main_style({"value": 30, "quality": 50}, {}, order, 70) is None  # 五種特徵都不突出
    assert T.main_style({"value": 30, "size": 5}, {"size": 1.4}, order, 70) == "size"  # 在風格 ETF 的持股裡
