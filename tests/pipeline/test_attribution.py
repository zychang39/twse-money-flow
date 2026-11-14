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
    assert set(f["f"]) == {"smb", "hml", "umd", "rmw", "lv"} and "style_ret" not in f
    assert len(f["mkt"]) == len(f["months"]) == len(f["rf"])

    s = json.loads((tmp_path / "attribution" / "1101.json").read_text(encoding="utf-8"))
    b, t = s["capm"]["b"]["mkt"], s["capm"]["t"]["mkt"]
    assert abs(b - 1.6) < 2.5 * b / t  # 月報酬估出來的 β 落在真值的 2.5 個標準誤內
    assert s["capm"]["n"] >= 18 and s["full"] is not None
    # 沒有指數表與 ETF：第二層只有同業籃子（曝險用週報酬估；同產業的衝擊是共同的 → 曝險為正且顯著）
    assert set(s["full"]["b"]) == {"ind"} and s["full"]["b"]["ind"] > 0.5 and s["full"]["t"]["ind"] > 3
    assert s["full"]["weeks"] >= 78 and s["full"]["alpha"] is not None and 0 < s["full"]["r2"] <= 1
    assert s["sector"] is None and s["dropped"] == ["value", "quality", "momentum", "size", "lowvol"]  # 沒有 ETF 資料
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


def _index_table(dates: list[str], series: dict[str, np.ndarray]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"date": d, "name": name, "kind": "return", "close": float(v)}
            for name, vals in series.items()
            for d, v in zip(dates, vals, strict=True)
            if np.isfinite(v)
        ]
    )


def test_layer2_uses_peer_basket_and_style_etfs(tmp_path):
    """第二層：同業籃子＋風格 ETF（週報酬）；類股指數只當尺；掛牌太短的 ETF 先不放進模型並寫出來。"""
    adj, m_tr, value, shares, pb, roe, industries, _group = _market()
    dates = list(adj.index)
    rng = np.random.default_rng(11)
    mkt = np.diff(np.log(m_tr.to_numpy()), prepend=np.log(m_tr.iloc[0]))
    tilt = rng.normal(0, 0.006, len(dates))  # 「價值」這個特徵自己的報酬
    # 1101 另外帶 0.8 倍的價值特徵；價值 ETF＝0.7 × 市場＋特徵；動能 ETF 只有最後 200 天（不到 78 週）
    adj = adj.copy()
    adj["1101"] = adj["1101"] * np.exp(np.cumsum(0.8 * tilt))
    etf_value = 20 * np.exp(np.cumsum(0.7 * mkt + tilt))
    etf_mom = np.where(np.arange(len(dates)) >= len(dates) - 200, 15 * np.exp(np.cumsum(1.1 * mkt)), np.nan)
    adj["00940"] = etf_value
    adj["009816"] = etf_mom
    index = _index_table(
        dates,
        {
            "發行量加權股價報酬指數": m_tr.to_numpy(),
            "產業0類報酬指數": 100 * np.exp(np.cumsum(mkt + rng.normal(0, 0.004, len(dates)))),
        },
    )
    cfg = {
        **CFG,
        "tailwind": {
            **A.tailwind.settings(),
            "styles": [
                {"key": "value", "label": "價值", "etf": "00940", "index": "不存在的指數"},
                {"key": "momentum", "label": "動能", "etf": "009816", "index": "不存在的指數"},
            ],
        },
    }
    A.build(
        adj=adj,
        close=adj,
        value=value.reindex(columns=adj.columns),
        shares=shares,
        pb=pb,
        roe=roe,
        market=m_tr,
        industries=industries,
        fine_of={},
        out=tmp_path,
        cfg=cfg,
        index=index,
        markets={c: "twse" for c in adj.columns},
        names={"00940": "價值 ETF", "009816": "動能 ETF"},
    )
    s = json.loads((tmp_path / "attribution" / "1101.json").read_text(encoding="utf-8"))
    assert set(s["full"]["b"]) == {"ind", "value"} and s["dropped"] == ["momentum"]
    assert abs(s["full"]["b"]["value"] - 0.8) < 0.3 and s["full"]["t"]["value"] > 3
    assert s["sector"] == "產業0" and s["fit"]["sector"]["r2"] > 0
    tw = json.loads((tmp_path / "attribution" / "tailwind.json").read_text(encoding="utf-8"))
    by = {x["key"]: x for x in tw["styles"]}
    assert by["value"]["source"] == "etf" and abs(by["value"]["beta"] - 0.7) < 0.15
    assert len(by["value"]["x"]) == len(by["value"]["m"]) == len(s["r"])
    # 未滿 12 個月：沒有 12 個月報酬，改用有資料以來的同一段期間（暫定）
    assert by["momentum"]["r"]["12"] is None and by["momentum"]["since"]["state"] in ("tail", "neutral", "head")
    assert [x["key"] for x in tw["sectors"]] == ["產業0"] and tw["sectors"][0]["n"] == 30
    tags = json.loads((tmp_path / "attribution" / "tags.json").read_text(encoding="utf-8"))
    assert tags["columns"] == ["code", "style", "sector"] and ["1101", s["main"], "產業0"] in tags["rows"]
    assert set(s["styles"]) == {"value", "quality", "momentum", "size", "lowvol"}
