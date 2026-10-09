"""參數表（規格第十節）：所有門檻集中在這裡；前端的「參數表」直接列 `table()` 的內容，不另存一份。"""

from __future__ import annotations

from typing import Any

PARAMS: dict[str, Any] = {
    # 大盤狀態機
    "ma_short": 60,
    "ma_long": 240,
    "upgrade_days": 10,
    "exposure": {1: 1.0, 2: 0.6, 3: 0.3},
    # 候選池
    "window_days": 40,
    "c_rs_min": 85,
    # 檢查清單
    "k1_rs_min": 85,
    "k1_rs_max": 97,
    "k1_rs_min_a": 80,
    "k2_pr12m": 80,
    "k2_pr3m": 60,
    "k4_high_days": 250,
    "k4_high_ratio": 0.8,
    "k5_limit_days": 20,
    "k5_limit_up_max": 2,
    "k5_limit_up_pct": 9.5,
    "k6_days": 20,
    "k6_value_min": 50_000_000,
    "pr1m_pullback": 30,
    "listed_min_days": 250,
    # 組合試算
    "slots": [8, 9, 10],
    "slots_default": 10,
    "group_max_count": 3,
    "group_max_weight": 0.35,
    # 持股條件
    "d1_days": 3,
    "d2_drawdown_pct": -15,
    "m1_rs": 70,
    "m2_drop_pp": 15,
    "weight_alert": 0.20,
    "buffer_rs": [70, 85],
    "review_day": 10,
    # 成本（回測）
    "fee_rate": 0.001425,
    "fee_discount": 0.28,
    "tax_rate": 0.003,
    # 沿用 App 既有定義的視窗（derive/momentum.RETURN_WINDOWS、derive/sectors.WINDOWS）
    "windows": {"1M": 21, "3M": 63, "12M": 252},
    "rs_windows": [63, 126, 189, 252],
    "rs_weights": [0.4, 0.2, 0.2, 0.2],
    "revenue_max_age": 45,
    "group_min_members": 3,
}


def table() -> list[dict[str, Any]]:
    """頁面「參數表」：名稱、數值、說明（依規格第十節順序）。"""
    p = PARAMS
    ex = p["exposure"]
    return [
        {"k": "均線天數", "v": f"{p['ma_short']}、{p['ma_long']}", "n": "加權股價指數（非報酬指數）的簡單平均"},
        {"k": "升級確認天數", "v": str(p["upgrade_days"]), "n": "最近 N 個交易日最差的原始狀態都優於目前狀態才升級"},
        {"k": "曝險上限", "v": f"{ex[1]:.0%}／{ex[2]:.0%}／{ex[3]:.0%}", "n": "狀態 1／2／3"},
        {"k": "候選觀察窗口", "v": f"{p['window_days']} 個交易日", "n": "含基準日"},
        {"k": "K1 相對強度", "v": f"{p['k1_rs_min']}–{p['k1_rs_max']}", "n": f"A 級下限 {p['k1_rs_min_a']}"},
        {"k": "K2 中長期動能", "v": f"PR12M {p['k2_pr12m']}、PR3M {p['k2_pr3m']}", "n": "全市場普通股百分位"},
        {
            "k": "K4 距 52 週高點",
            "v": f"{p['k4_high_ratio']}",
            "n": f"還原收盤 ≥ 比率 × 近 {p['k4_high_days']} 日還原最高價",
        },
        {
            "k": "K5 漲停次數",
            "v": f"< {p['k5_limit_up_max']}（{p['k5_limit_days']} 日內）",
            "n": f"替代門檻：收盤較前一日 ≥ {p['k5_limit_up_pct']}%",
        },
        {"k": "K6 成交金額", "v": f"{p['k6_value_min'] / 1e4:,.0f} 萬元", "n": f"{p['k6_days']} 日平均（未還原）"},
        {"k": "名額", "v": "／".join(str(s) for s in p["slots"]), "n": f"預設 {p['slots_default']}"},
        {"k": "族群上限", "v": f"{p['group_max_count']} 檔、{p['group_max_weight']:.0%}", "n": "同一主族群"},
        {"k": "D1", "v": f"{p['d1_days']} 日", "n": "連續收在 60 日線下"},
        {"k": "D2", "v": f"{p['d2_drawdown_pct']}%", "n": "相對除權息調整後的成本"},
        {"k": "M1", "v": f"RS {p['m1_rs']}", "n": "檢查日 R 的 RS 百分位"},
        {"k": "M2", "v": f"{p['m2_drop_pp']} 個百分點", "n": "最新年增 ≤ 前 3 月平均 − 門檻，或年增 < 0"},
        {"k": "權重提示", "v": f"{p['weight_alert']:.0%}", "n": "單檔市值 ÷ 持股總市值"},
        {"k": "緩衝區", "v": f"RS {p['buffer_rs'][0]}–{p['buffer_rs'][1]}", "n": "不觸發條件"},
        {"k": "手續費折扣", "v": f"{p['fee_discount']}", "n": f"費率 {p['fee_rate']:.4%}，進出雙邊；不計最低手續費"},
        {"k": "證交稅", "v": f"{p['tax_rate']:.1%}", "n": "只在出場時收"},
    ]
