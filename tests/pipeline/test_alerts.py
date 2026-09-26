"""盤中提醒與 Telegram 日報：以真實 mis 回應樣本（tests/fixtures/samples/mis_intraday.json）驗證。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline import alerts
from pipeline.notify import telegram

SAMPLES = Path(__file__).resolve().parents[1] / "fixtures" / "samples"


@pytest.fixture
def mis() -> bytes:
    return (SAMPLES / "mis_intraday.json").read_bytes()


def test_parse_mis(mis: bytes) -> None:
    q = alerts.parse_mis(mis)
    assert set(q) == {"2330", "6488"}
    tsmc = q["2330"]
    assert tsmc["name"] == "台積電"
    assert tsmc["price"] == 2475.0
    assert tsmc["high"] == 2490.0 and tsmc["low"] == 2470.0
    assert tsmc["prev"] == 2500.0
    assert tsmc["date"] == "20260924"
    assert q["6488"]["market"] == "otc"


def test_parse_mis_no_trade_falls_back() -> None:
    payload = json.dumps(
        {
            "msgArray": [
                {
                    "c": "1101",
                    "n": "台泥",
                    "z": "-",
                    "pz": "-",
                    "b": "31.5_31.4_",
                    "y": "32.0",
                    "h": "-",
                    "l": "-",
                    "d": "20260924",
                }
            ]
        }
    )
    q = alerts.parse_mis(payload)
    assert q["1101"]["price"] == 31.5
    assert q["1101"]["high"] is None


def test_mis_url_batches_both_markets() -> None:
    url = alerts.mis_url(["2330", "6488", "2330"])
    assert "ex_ch=tse_2330.tw|otc_2330.tw|tse_6488.tw|otc_6488.tw&" in url


def test_evaluate_uses_day_range_and_dedupes(mis: bytes) -> None:
    q = alerts.parse_mis(mis)
    rules = [
        {"code": "2330", "above": 2490.0, "below": 2400.0, "note": "前高"},  # 最高 2490 觸及 above
        {"code": "6488", "above": None, "below": 930.0, "note": ""},  # 最低 930 觸及 below
        {"code": "6488", "above": 1000.0, "below": None, "note": ""},  # 未觸及
        {"code": "9999", "above": 1.0, "below": None, "note": ""},  # 無報價
    ]
    hits = alerts.evaluate(rules, q, set())
    assert [h["key"] for h in hits] == ["2330:above:2490", "6488:below:930"]
    again = alerts.evaluate(rules, q, {h["key"] for h in hits})
    assert again == []
    text = alerts.format_hits(hits)
    assert "台積電 2330：2475（▼1.00%）已觸及 ≥ 2490｜前高" in text
    assert "非投資建議" in text


def test_load_rules(tmp_path: Path) -> None:
    p = tmp_path / "alerts.yml"
    p.write_text(
        'version: 1\ndigest: ["2330", 50]\nalerts:\n  - { code: "2330", above: 2600 }\n  - { code: "2317" }\n'
        '  - { code: 1101, below: "30.5", note: 停損 }\n',
        encoding="utf-8",
    )
    cfg = alerts.load_rules(p)
    assert cfg["digest"] == ["2330", "50"]
    assert cfg["alerts"] == [
        {"code": "2330", "above": 2600.0, "below": None, "note": ""},
        {"code": "1101", "above": None, "below": 30.5, "note": "停損"},
    ]


def test_repo_alerts_config_is_valid() -> None:
    cfg = alerts.load_rules()
    assert isinstance(cfg["alerts"], list) and isinstance(cfg["digest"], list)


class _Client:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.urls: list[str] = []

    def get_bytes(self, url: str) -> bytes:
        self.urls.append(url)
        return self.payload


class _Ctx:
    def __init__(self, payload: bytes) -> None:
        self.client = _Client(payload)


def test_run_alerts_state(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, mis: bytes) -> None:
    from datetime import datetime

    from pipeline.core.dates import TPE

    monkeypatch.setattr(alerts, "now_tpe", lambda: datetime(2026, 9, 24, 10, 0, tzinfo=TPE))
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    rules = tmp_path / "alerts.yml"
    rules.write_text('alerts:\n  - { code: "2330", above: 2480 }\n', encoding="utf-8")
    state = tmp_path / "state.json"
    ctx = _Ctx(mis)
    r1 = alerts.run_alerts(ctx, state_path=state, rules_path=rules)
    assert r1["hits"] == ["2330:above:2480"] and r1["pushed"] is False
    r2 = alerts.run_alerts(ctx, state_path=state, rules_path=rules)
    assert r2["hits"] == []
    # 隔天狀態重置；回應日期不是今天（休市）則略過
    monkeypatch.setattr(alerts, "now_tpe", lambda: datetime(2026, 9, 25, 10, 0, tzinfo=TPE))
    r3 = alerts.run_alerts(ctx, state_path=state, rules_path=rules)
    assert r3["alerts"] == "skipped" and "休市" in r3["reason"]


def test_split_message() -> None:
    text = "\n".join(f"第 {i} 行 " + "字" * 50 for i in range(200))
    parts = telegram.split_message(text, limit=1000)
    assert all(len(p) <= 1000 for p in parts)
    assert "".join(parts).count("\n") == 200


def _web_data(tmp_path: Path) -> Path:
    cols = [
        "code",
        "name",
        "close",
        "change",
        "change_pct",
        "value_million",
        "composite",
        "composite_chg",
        "foreign_net_lots",
        "trust_net_lots",
        "margin_change",
        "new_flags",
        "flags",
    ]
    rows = [
        [
            "2330",
            "台積電",
            2475,
            -25,
            -1.0,
            30000,
            72,
            3,
            -1200,
            350,
            -80,
            ["foreign_sell"],
            [{"id": "foreign_sell", "label": "外資連賣", "detail": "5 日"}],
        ],
        ["2317", "鴻海", 200, 2, 1.01, 9000, 55, 8, 500, 0, 20, [], []],
        ["1101", "台泥", 31, 0, 0, 500, 40, None, 0, 0, 0, [], []],
    ]
    d = tmp_path / "web"
    d.mkdir()
    (d / "summary.json").write_text(json.dumps({"date": "2026-09-24", "columns": cols, "rows": rows}), encoding="utf-8")
    market = {
        "taiex": {"close": 19398.48, "change": 134.98},
        "flows": [{"date": "2026-09-24", "foreign": -12.3, "trust": 4.5, "dealer": 1.2}],
        "env": {"summary": "1 綠 2 黃 1 紅"},
    }
    (d / "market.json").write_text(json.dumps(market), encoding="utf-8")
    return d


def test_build_digest(tmp_path: Path) -> None:
    d = _web_data(tmp_path)
    text = telegram.build_digest(d, ["2330", "0000"], "https://example.github.io/app/", ["twse_margin 2026-09-24"])
    assert "台股盤後日報 2026-09-24" in text
    assert "加權指數 19,398.48 ▲134.98" in text
    assert "外資 -12.3／投信 +4.5／自營 +1.2" in text
    assert "<b>台積電</b> 2330 2475 ▼25（-1.00%）綜合 72（+3）" in text
    assert "外資 -1,200・投信 +350・融資 -80 張" in text
    assert "⚠️ 台積電：外資連賣（5 日）" in text
    assert "資料源異常 1 項" in text
    assert "買進" not in text and "賣出" not in text


def test_build_digest_without_codes_lists_top_movers(tmp_path: Path) -> None:
    text = telegram.build_digest(_web_data(tmp_path), [])
    assert "綜合分數上升最多" in text
    assert text.index("鴻海") < text.index("台積電")
    assert "台泥" not in text


def test_send_skips_without_secrets(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    assert telegram.send("x") is False
    assert telegram.send_daily_digest(_web_data(tmp_path), []) is False
