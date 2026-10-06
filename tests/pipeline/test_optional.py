"""選配資料：央行貨幣總計數、法人說明會（真實樣本）與其任務、市場燈號。"""

from __future__ import annotations

from datetime import date, datetime

import pandas as pd
import pytest

from pipeline import tasks, tasks_advanced
from pipeline.core.dates import TPE
from pipeline.sources import optional
from pipeline.sources.base import ParseError
from tests.pipeline.conftest import sample
from tests.pipeline.test_tasks import make_ctx


def test_parse_cbc_money() -> None:
    df = optional.parse_cbc_money(sample("cbc_EF15M01.csv")).df
    assert list(df.columns) == optional.MONEY_COLS
    last = df.iloc[-1]
    assert last["ym"] == "2026-07"
    assert last["m1b"] == 30530948 and last["m1b_yoy"] == pytest.approx(7.33948)
    assert last["m2"] == 70224762 and last["m2_yoy"] == pytest.approx(7.41536)
    first = df.iloc[0]
    assert first["ym"] == "1987-05" and pd.isna(first["m1b_yoy"])  # 「-」→ 缺值


def test_parse_cbc_money_rejects_other_csv() -> None:
    with pytest.raises(ParseError):
        optional.parse_cbc_money(b"Date,10 Yr\n09/24/2026,4.1\n")


def test_parse_conference() -> None:
    df = optional.parse_conference(sample("mops_t100sb02_get.html")).df
    assert len(df) == 23
    r = df[df["code"] == "1103"].iloc[0]
    assert r["date"] == "2026-09-30" and r["time"] == "14:00" and r["name"] == "嘉泥"
    assert r["text"] == "115年第二季公司營運狀況"
    assert df["date"].is_monotonic_increasing


def test_parse_conference_no_data() -> None:
    res = optional.parse_conference("<html>查無資料</html>")
    assert res.no_data and res.df.empty


def test_run_optional_tasks(tmp_path) -> None:
    ctx = make_ctx(
        tmp_path,
        {"EF15M01": sample("cbc_EF15M01.csv"), "t100sb02": sample("mops_t100sb02_get.html")},
        now=datetime(2026, 9, 26, 10, 0, tzinfo=TPE),
    )
    tasks_advanced.run_cbc_money(ctx)
    money = ctx.store.read("cbc_money", date(2026, 7, 1))
    assert money is not None and money["ym"].iloc[-1] == "2026-07"
    tasks_advanced.run_conference(ctx, date(2026, 9, 1))
    conf = ctx.store.read("conference", date(2026, 9, 1))
    assert conf is not None and len(conf) == 23  # 上市、上櫃回應相同 → 以 date+code+time 去重
    assert any("TYPEK=otc" in u and "year=115" in u and "month=09" in u for u in ctx.client.urls)
    assert not ctx.failures


def test_periodic_runs_optional_on_weekend(tmp_path) -> None:
    ctx = make_ctx(
        tmp_path,
        {"EF15M01": sample("cbc_EF15M01.csv"), "t100sb02": sample("mops_t100sb02_get.html")},
        now=datetime(2026, 9, 26, 10, 0, tzinfo=TPE),  # 週六
    )
    tasks.task_periodic(ctx, ["cbc_money", "investor_conference"])
    assert ctx.store.exists("cbc_money", date(2026, 7, 1))
    assert ctx.store.exists("conference", date(2026, 9, 1))
    assert ctx.store.exists("conference", date(2026, 10, 1))


def test_market_env_uses_money() -> None:
    from types import SimpleNamespace

    from pipeline.derive import extras

    money = optional.parse_cbc_money(sample("cbc_EF15M01.csv")).df
    ds = SimpleNamespace(
        table=lambda name: money if name == "cbc_money" else pd.DataFrame(), margin_total=pd.DataFrame()
    )
    dates = [f"2026-09-{d:02d}" for d in range(1, 25)]
    p = SimpleNamespace(dates=dates, value=pd.DataFrame({"2330": [1e9] * len(dates)}, index=dates))
    taiex = pd.Series(range(len(dates)), index=dates, dtype=float)
    env = extras.market_env(ds, p, taiex)
    light = next(x for x in env["env"]["lights"] if x["id"] == "m1b")
    assert light["state"] == "red"  # M1B 7.34% < M2 7.42%
    assert "2026-07" in light["value"]
    # 2026-10-06 檢查表說明頁：燈號附資料日期與近 12 個月序列（判定用的 M1B − M2 與原始年增率）
    assert light["date"] == "2026-07"
    last = light["series"][-1]
    assert last["d"] == "2026-07" and last["v"] == round(last["x"] - last["y"], 2)
    assert len(light["series"]) <= 12


def test_market_env_light_dates_and_series() -> None:
    """日資料燈號：date＝最新資料日；series＝近 20 個交易日的判定數值（v）與原始數值（x）。"""
    from types import SimpleNamespace

    from pipeline.derive import extras

    dates = [f"2026-{m:02d}-{d:02d}" for m in (8, 9) for d in range(1, 29)]
    fx = pd.DataFrame({"date": dates, "usd_twd": [30 + i * 0.01 for i in range(len(dates))]})
    ust = pd.DataFrame({"date": dates, "y10": [4 + i * 0.01 for i in range(len(dates))]})
    tables = {"fx": fx, "ust": ust}
    ds = SimpleNamespace(table=lambda name: tables.get(name, pd.DataFrame()), margin_total=pd.DataFrame())
    p = SimpleNamespace(dates=dates, value=pd.DataFrame({"2330": [1e9] * len(dates)}, index=dates))
    taiex = pd.Series(range(len(dates)), index=dates, dtype=float)
    lights = {x["id"]: x for x in extras.market_env(ds, p, taiex)["env"]["lights"]}
    u = lights["ust"]
    assert u["date"] == dates[-1]
    assert len(u["series"]) == extras.SERIES_DAILY
    assert u["series"][-1] == {"d": dates[-1], "v": 20.0, "x": round(4 + (len(dates) - 1) * 0.01, 2)}
    f = lights["fx"]
    assert f["date"] == dates[-1] and f["series"][-1]["x"] == round(30 + (len(dates) - 1) * 0.01, 3)
    assert "series" not in lights["futures"]  # 沒有資料的燈號不附序列（前端顯示「資料累積中」）
