"""build-web：以示範資料（合成）走完整流程，檢查輸出檔案與格式。"""

from __future__ import annotations

import gzip
import json

from pipeline.derive.demo import build_store
from pipeline.derive.export import build_web


def test_build_web_outputs(tmp_path):
    store_dir = tmp_path / "data"
    out = tmp_path / "out"
    build_store(store_dir, days=80)
    report = build_web(store_dir, out, demo=True)
    assert report["stocks"] == 12
    meta = json.loads((out / "meta.json").read_text())
    assert meta["status"] == "ok" and meta["demo"] is True and meta["market_date"] == "2026-09-24"
    summary = json.loads((out / "summary.json").read_text())
    assert summary["columns"][0] == "code" and len(summary["rows"]) == 12
    assert len(gzip.compress((out / "summary.json").read_bytes())) < 800 * 1024
    stock = json.loads((out / "stocks" / "1101.json").read_text())
    assert len(stock["d"]) == 80 and len(stock["c"]) == 80 and stock["industry"] == "水泥工業"
    # 除息日（倒數第 60 日）之前的還原因子 = 32/33，之後 = 1
    ex_idx = len(stock["d"]) - 60
    assert abs(stock["af"][ex_idx - 1] - 32 / 33) < 1e-6 and stock["af"][ex_idx] == 1
    health = json.loads((out / "health.json").read_text())
    assert any(s["id"] == "twse_quotes" for s in health["sources"])
    # 籌碼明細：近 60 日＋前一日；法人以股為單位且官方合計＝外陸資＋外資自營商＋投信＋自營商、自營商＝自行買賣＋避險
    chip = stock["chip"]
    assert len(chip["d"]) == 61 and chip["d"][-1] == "2026-09-24" and chip["d"] == stock["d"][-61:]
    for i in range(61):
        assert chip["tot"][i] == chip["fn"][i] + chip["ffd"][i] + chip["tn"][i] + chip["dn"][i]
        assert chip["dn"][i] == chip["dself"][i] + chip["dhedge"][i]
        assert abs(chip["fn"][i] / 1000 - stock["fn"][-61 + i]) <= 0.5  # 股數精確值；主陣列為四捨五入後的張數
    assert chip["avg"][-1] is not None and abs(chip["v"][-1] / 1000 - stock["v"][-1]) <= 0.5
    assert all(len(v) == 61 for v in chip.values())
    assert {"sblb", "dtv"} <= chip.keys()  # 借券餘額、當沖量（股）
    # 集保持股分級：15 個分級（分級為主的陣列）＋各週總股數與總人數；比例合計約 100%
    hold = stock["holders"]
    w = len(hold["d"])
    assert w >= 10 and hold["d"] == sorted(hold["d"])
    assert len(hold["n"]) == 15 and len(hold["p"]) == 15 and all(len(a) == w for a in hold["n"] + hold["p"])
    assert all(abs(sum(hold["p"][lv][i] for lv in range(15)) - 100) < 0.2 for i in range(w))
    assert hold["th"][-1] == sum(hold["n"][lv][-1] for lv in range(15)) and hold["ts"][-1] == 1_000_000_000
    # 法人買賣超報表：各法人買進 − 賣出 ＝ 買賣超（外資含外資自營商；自營商分自行買賣與避險）
    for i in range(61):
        assert chip["fb"][i] - chip["fs"][i] == chip["fn"][i] + chip["ffd"][i]
        assert chip["tb"][i] - chip["ts"][i] == chip["tn"][i]
        assert chip["dsb"][i] - chip["dss"][i] == chip["dself"][i]
        assert chip["dhb"][i] - chip["dhs"][i] == chip["dhedge"][i]


def test_build_web_without_data(tmp_path):
    report = build_web(tmp_path / "missing", tmp_path / "out")
    assert report["status"] == "no_data"
    meta = json.loads((tmp_path / "out" / "meta.json").read_text())
    assert meta["status"] == "no_data"


def test_chip_buy_sell_old_files_without_dealer_columns():
    """舊檔只存外陸資與投信的買賣股數：外資自營商買賣超為 0 時視為沒有交易；不為 0 時外資買賣股數為空值。"""
    import pandas as pd

    from pipeline.derive.stockdetail import chip_buy_sell

    sel = ["2026-09-23", "2026-09-24"]
    ins = pd.DataFrame(
        {
            "foreign_buy": [1000.0, 2000.0],
            "foreign_sell": [400.0, 500.0],
            "foreign_dealer_net": [0.0, 30.0],
            "trust_buy": [10.0, 20.0],
            "trust_sell": [5.0, 0.0],
        },
        index=sel,
    )
    out = chip_buy_sell(ins, sel)
    assert out["fb"] == [1000, None] and out["fs"] == [400, None]
    assert out["tb"] == [10, 20] and out["ts"] == [5, 0]
    assert out["dsb"] == [None, None] and out["dhs"] == [None, None]
    assert chip_buy_sell(None, sel)["fb"] == [None, None]
