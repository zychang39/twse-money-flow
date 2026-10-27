"""報酬拆解（pipeline/derive/attribution.py；2026-10-27）：用已知答案的合成資料檢查 β、同業與輸出格式。"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from pipeline.derive import attribution as A

CFG = {
    **A.settings(),
    "min_universe": 30,
    "min_corner": 3,
    "min_months": 18,
    "liquidity_pctile": 0,
    "peer_weeks": 80,
}


def _market(seed: int = 3, days: int = 760, n: int = 90):
    """三個產業各 30 檔：每日報酬＝β × 市場 ＋ 產業衝擊 ＋ 個股雜訊；1101 的 β＝1.6。"""
    rng = np.random.default_rng(seed)
    dates = [d.strftime("%Y-%m-%d") for d in pd.bdate_range("2023-01-02", periods=days)]
    mkt = rng.normal(0.0005, 0.01, days)
    ind = {k: rng.normal(0, 0.008, days) for k in range(3)}
    codes = [str(1101 + i) for i in range(n)]
    betas = {c: (1.6 if c == "1101" else rng.uniform(0.6, 1.3)) for c in codes}
    group = {c: i % 3 for i, c in enumerate(codes)}
    rets = {c: betas[c] * mkt + ind[group[c]] + rng.normal(0, 0.012, days) for c in codes}
    adj = pd.DataFrame({c: 50 * np.exp(np.cumsum(r)) for c, r in rets.items()}, index=dates)
    m_tr = pd.Series(10000 * np.exp(np.cumsum(mkt)), index=dates)
    value = pd.DataFrame(1e8, index=dates, columns=codes)
    shares = {c: float(rng.uniform(1e7, 1e9)) for c in codes}
    pb = pd.DataFrame(np.tile(rng.uniform(0.5, 4, n), (days, 1)), index=dates, columns=codes)
    roe = pd.DataFrame(np.tile(rng.uniform(-5, 25, n), (days, 1)), index=dates, columns=codes)
    industries = {c: f"產業{group[c]}" for c in codes}
    return adj, m_tr, value, shares, pb, roe, industries, group


def test_build_recovers_beta_and_peers(tmp_path):
    adj, m_tr, value, shares, pb, roe, industries, group = _market()
    # 細產業：故意把一半的股票分錯（族群分組不夠好），同業仍應依股價連動回到真正的產業
    fine = {c: [f"細{(group[c] + (i % 2)) % 3}"] for i, c in enumerate(adj.columns)}
    res = A.build(
        adj=adj,
        close=adj,
        value=value,
        shares=shares,
        pb=pb,
        roe=roe,
        market=m_tr,
        industries=industries,
        fine_of=fine,
        out=tmp_path,
        cfg=CFG,
    )
    assert res["stocks"] == 90 and res["months"] >= 30
    f = json.loads((tmp_path / "attribution" / "factors.json").read_text(encoding="utf-8"))
    assert set(f["f"]) == {"smb", "hml", "umd", "rmw", "lv"} and len(f["style_ret"]) == 9
    assert len(f["mkt"]) == len(f["months"]) == len(f["rf"])

    s = json.loads((tmp_path / "attribution" / "1101.json").read_text(encoding="utf-8"))
    assert abs(s["capm"]["b"]["mkt"] - 1.6) < 0.35  # 月報酬估出來的 β 接近真值
    assert s["capm"]["n"] >= 18 and s["full"] is not None
    assert {"ind", "smb", "hml", "umd"} <= set(s["full"]["b"])
    # 同業：5～10 家、全部來自同一個真正的產業
    peers = s["peers"]
    assert peers["kind"] == "peer" and 5 <= len(peers["codes"]) <= 10
    assert all(group[c] == group["1101"] for c in peers["codes"])
    assert peers["corr"] == sorted(peers["corr"], reverse=True)
    # 同業籃子比分錯一半的細產業更貼近
    assert s["fit"]["peer"]["r2"] >= s["fit"]["fine"]["r2"]
    assert len(s["r"]) == len(s["peer"]) == len(s["ind"]) == len(f["months"])


def test_ols_and_month_ends():
    rng = np.random.default_rng(1)
    x = rng.normal(0, 1, (60, 2))
    y = 0.01 + x @ np.array([1.5, -0.5]) + rng.normal(0, 0.01, 60)
    r = A.ols(y, x)
    assert r is not None and abs(r["coef"][1] - 1.5) < 0.02 and r["r2"] > 0.99 and r["n"] == 60
    assert A.ols(y[:3], x[:3]) is None  # 樣本太少
    pos, labels = A.month_ends(pd.Index(["2026-01-29", "2026-01-30", "2026-02-02", "2026-02-27", "2026-03-02"]))
    assert pos == [1, 3, 4] and labels == ["2026-01", "2026-02", "2026-03"]
