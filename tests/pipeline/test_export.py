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


def test_conference_host_extraction():
    """法說會說明文字 → 主辦／邀請單位（公開資訊觀測站的實際文字）。"""
    from pipeline.derive.stockdetail import conference_host

    assert conference_host("115年10月1日受BofA邀請參加投資人會議，說明本公司營運概況。") == "BofA"
    assert (
        conference_host("本公司受邀參加香港上海匯豐證券舉辦之法人說明會「13th Annual China Conference」")
        == "香港上海匯豐證券"
    )
    assert conference_host("本公司受邀參加統一證券與IR Trust共同舉辦之廣華(1338)法說會") == "統一證券與IR Trust"
    assert conference_host("應凱基證券之邀參加法人說明會") == "凱基證券"
    assert conference_host("本公司自辦法人說明會") is None
    assert conference_host("營運概況說明") is None


def test_stock_file_conferences(tmp_path):
    store_dir = tmp_path / "data"
    out = tmp_path / "out"
    build_store(store_dir, days=260)
    build_web(store_dir, out, demo=True)
    stock = json.loads((out / "stocks" / "2330.json").read_text())
    conf = stock["conferences"]
    assert [c["date"] for c in conf] == sorted((c["date"] for c in conf), reverse=True)
    assert {c["host"] for c in conf} >= {"BofA", "元大證券", None}


def test_derive_window_and_long_history(tmp_path, monkeypatch):
    """v3 M5：衍生計算只取最近 N 個交易日；更早的收盤另存 stocks/{code}.hist.json（日期、收盤、還原因子）。"""
    from pipeline.derive import history

    monkeypatch.setattr(history, "window_days", lambda: 50)
    store_dir = tmp_path / "data"
    out = tmp_path / "out"
    build_store(store_dir, days=80)
    report = build_web(store_dir, out, demo=True)
    stock = json.loads((out / "stocks" / "1101.json").read_text())
    assert len(stock["d"]) == 50
    hist = json.loads((out / "stocks" / "1101.hist.json").read_text())
    assert len(hist["d"]) == 80 and len(hist["c"]) == 80 and len(hist["af"]) == 80
    assert hist["d"][-50:] == stock["d"] and hist["c"][-50:] == stock["c"]
    # 除息日（倒數第 60 日）在視窗之外：長歷史的還原因子仍然正確（之前 32/33、之後 1）
    ex_idx = 80 - 60
    assert abs(hist["af"][ex_idx - 1] - 32 / 33) < 1e-6 and hist["af"][ex_idx] == 1
    assert report["long_history"]["files"] == 12 and report["long_history"]["first_date"] == hist["d"][0]
    meta = json.loads((out / "meta.json").read_text())
    assert meta["long_history"]["files"] == 12
    # 視窗足夠時不輸出長歷史檔
    out2 = tmp_path / "out2"
    monkeypatch.setattr(history, "window_days", lambda: 1100)
    build_web(store_dir, out2, demo=True)
    assert not list((out2 / "stocks").glob("*.hist.json"))


def _strict_loads(text: str):
    """瀏覽器的 JSON.parse 不接受 NaN／Infinity；Python 預設接受，所以這裡明確拒絕（E-01）。"""

    def reject(const: str):
        raise ValueError(f"非法 JSON 常數 {const}")

    return json.loads(text, parse_constant=reject)


def test_write_json_rejects_nan_and_sanitizes_nested(tmp_path):
    import math

    import numpy as np
    import pandas as pd
    import pytest

    from pipeline.derive.export import write_json

    obj = {
        "short_halt": {"reason": float("nan"), "end": np.float64("nan"), "n": np.int64(3)},
        "list": [1.5, math.inf, pd.NaT, np.bool_(True)],
    }
    path = tmp_path / "x.json"
    write_json(path, obj)
    data = _strict_loads(path.read_text())
    assert data == {"short_halt": {"reason": None, "end": None, "n": 3}, "list": [1.5, None, None, True]}
    # 精度不因清理而改變
    write_json(path, {"af": 0.123456789})
    assert _strict_loads(path.read_text())["af"] == 0.123456789
    # 萬一清理不到（自訂物件），allow_nan=False 仍讓 build 失敗而不是寫出壞檔
    import json as _json

    with pytest.raises(ValueError):
        _json.dumps(float("nan"), allow_nan=False)


def test_text_helpers_hide_nan():
    import numpy as np

    from pipeline.derive.export import num_text, text, text_or_none

    assert text(float("nan")) == "" and text(np.nan, "—") == "—" and text("nan") == "" and text(None, "x") == "x"
    assert text(" 分割 ") == "分割" and text_or_none("") is None and text_or_none(float("nan")) is None
    assert num_text(12.0) == "12" and num_text(float("nan")) == "—" and num_text(None) == "—"


def test_build_web_all_json_strict_with_blank_text_fields(tmp_path):
    """E-01／U-07：停券原因、分割類型等文字欄位空白時，所有輸出檔仍是嚴格合法 JSON，且畫面文字不含「nan」。"""
    import pandas as pd

    from pipeline.core.store import DataStore

    store_dir = tmp_path / "data"
    out = tmp_path / "out"
    build_store(store_dir, days=80)
    store = DataStore(store_dir)
    # 真實資料 raw/tpex_short_halt/2026/20260924.csv.gz：上櫃債券 ETF 的 reason 欄全部空白
    store.write(
        "tpex_short_halt",
        __import__("datetime").date(2026, 9, 24),
        pd.DataFrame(
            [{"date": "2026-09-24", "code": "1101", "last_cover_date": "2026-09-22", "end": "", "reason": ""}]
        ),
    )
    build_web(store_dir, out, demo=True)
    files = list(out.rglob("*.json"))
    assert files
    for f in files:
        text = f.read_text()
        _strict_loads(text)
        assert '"nan"' not in text.lower() and "nan，" not in text and "除nan" not in text
    stock = _strict_loads((out / "stocks" / "1101.json").read_text())
    assert stock["short_halt"] == {"last_cover_date": "2026-09-22", "end": None, "reason": None}


def test_events_blank_kind_shows_default_not_nan():
    """U-07：00631L 2026-03-31 分割事件的 kind 空白 → 類型顯示「分割」而不是「nan」；法說會時間、地點空白 → None。"""
    from types import SimpleNamespace

    import pandas as pd

    from pipeline.derive import stockdetail

    empty = pd.DataFrame()
    split = pd.DataFrame([{"date": "2026-03-31", "code": "00631L", "kind": float("nan"), "ref_price": 20.5}])
    ds = SimpleNamespace(
        exright=empty,
        exright_notice=empty,
        capreduce=empty,
        attention=empty,
        disposition=empty,
        extra={"splits": [split]},
    )
    ev = stockdetail.events_for(ds, "00631L", "2026-01-01")
    assert ev == [{"date": "2026-03-31", "type": "分割", "text": "恢復買賣參考價 20.5"}]
    conf = pd.DataFrame(
        [{"date": "2026-09-01", "code": "2330", "time": float("nan"), "place": float("nan"), "text": float("nan")}]
    )
    out = stockdetail.conferences_for({"2330": conf}, "2330", "2026-01-01")
    assert out[0]["time"] is None and out[0]["place"] is None and out[0]["text"] == ""


def test_no_trade_halted_and_inactive(tmp_path):
    """U-02：最新交易日無成交／停牌時不把舊漲跌當成今日；U-01：長期無成交的證券輸出到 inactive.json。"""
    from datetime import date

    from pipeline.core.store import DataStore

    store_dir = tmp_path / "data"
    out = tmp_path / "out"
    build_store(store_dir, days=80)
    store = DataStore(store_dir)
    days = store.dates("tpex_quotes")
    last = days[-1]
    q = store.read("tpex_quotes", last)
    # 5347：今天有列、沒有成交（收盤空白、量 0）；3105：今天整列不見（暫停交易）
    q.loc[q["code"] == "5347", ["open", "high", "low", "close", "change"]] = float("nan")
    q.loc[q["code"] == "5347", ["volume", "value", "trades"]] = 0
    q = q[q["code"] != "3105"]
    store.write("tpex_quotes", last, q)
    # 6182：最近 25 個交易日都沒有出現在行情中（下市或長期停牌）
    for d in days[-25:]:
        df = store.read("tpex_quotes", d)
        store.write("tpex_quotes", d, df[df["code"] != "6182"])
    build_web(store_dir, out, demo=True)
    summary = _strict_loads((out / "summary.json").read_text())
    cols = summary["columns"]
    rows = {r[0]: dict(zip(cols, r, strict=True)) for r in summary["rows"]}
    prev = days[-2].isoformat()
    assert rows["5347"]["trade_status"] == "no_trade" and rows["5347"]["last_trade_date"] == prev
    assert rows["5347"]["change_pct"] is None and rows["5347"]["change"] is None
    assert rows["3105"]["trade_status"] == "halted" and rows["3105"]["change_pct"] is None
    assert rows["2330"]["trade_status"] is None and rows["2330"]["last_trade_date"] is None
    assert rows["2330"]["change_pct"] is not None
    assert "6182" not in rows and not (out / "stocks" / "6182.json").exists()
    inactive = _strict_loads((out / "inactive.json").read_text())
    hit = [r for r in inactive["rows"] if r["code"] == "6182"]
    assert hit and hit[0]["name"] == "合晶" and hit[0]["last_trade_date"] == days[-26].isoformat()
    assert isinstance(date.fromisoformat(inactive["date"]), date)


def test_adjust_events_exported_with_kind(tmp_path):
    """D-01：0050 分割（真實事件 2025-06-18 因子 0.25；這裡放在示範資料範圍內）→ 個股檔 adj_events 與 summary adj_ev 標示 split。"""
    import pandas as pd

    from pipeline.core.store import DataStore

    store_dir = tmp_path / "data"
    out = tmp_path / "out"
    build_store(store_dir, days=80)
    store = DataStore(store_dir)
    days = store.dates("twse_quotes")
    split_day = days[-10]
    # 分割日起價格變成 1/4（官方分割表＋行情一致）
    for d in days[-10:]:
        q = store.read("twse_quotes", d)
        for col in ("open", "high", "low", "close", "change"):
            q.loc[q["code"] == "0050", col] = q.loc[q["code"] == "0050", col] / 4
        store.write("twse_quotes", d, q)
    store.write(
        "twse_etfsplit",
        split_day,
        pd.DataFrame([{"date": split_day.isoformat(), "code": "0050", "name": "元大台灣50", "factor": 0.25}]),
    )
    build_web(store_dir, out, demo=True)
    stock = _strict_loads((out / "stocks" / "0050.json").read_text())
    assert stock["adj_events"] == [[split_day.isoformat(), 0.25, "split"]]
    i = stock["d"].index(split_day.isoformat())
    assert abs(stock["af"][i - 1] - 0.25) < 1e-9 and stock["af"][i] == 1
    summary = _strict_loads((out / "summary.json").read_text())
    cols = summary["columns"]
    row = next(dict(zip(cols, r, strict=True)) for r in summary["rows"] if r[0] == "0050")
    assert row["adj_ev"] == [[split_day.isoformat(), 0.25, "split"]]
    # summary 的精簡版：小額除息（< 1.5%）不列；大額除息只寫 [日期, 因子]
    from pipeline.derive.build import summary_adj_events

    ev = [["2026-09-01", 0.995, "dividend"], ["2026-09-02", 0.95, "dividend"], ["2026-09-03", 0.25, "split"]]
    assert summary_adj_events(ev, "2026-08-01") == [["2026-09-02", 0.95], ["2026-09-03", 0.25, "split"]]
    assert summary_adj_events(ev, "2026-09-03") is None
    other = next(dict(zip(cols, r, strict=True)) for r in summary["rows"] if r[0] == "2330")
    assert other["adj_ev"] is None
