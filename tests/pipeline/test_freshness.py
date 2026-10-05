"""資料新鮮度與補抓（2026-10-06）：D(X)、缺漏判斷、只抓應已公布但還沒拿到的資料集、重試。"""

from __future__ import annotations

from datetime import date, datetime

import pandas as pd
import pytest

from pipeline import freshness, tasks
from pipeline.core.dates import TPE
from tests.pipeline.test_tasks import make_ctx

DAYS = [date(2026, 9, 29), date(2026, 9, 30), date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 5)]


def _fill(store, days, skip=()):
    """把 freshness 表上的每個來源都寫好（skip＝(來源, 日期) 不寫）。"""
    for ds in freshness.datasets().values():
        for s in ds["sources"]:
            for d in days:
                if (s, d) in skip:
                    continue
                if s in freshness.MONTHLY:
                    old = store.read(s, d.replace(day=1))
                    df = pd.DataFrame({"date": [d.isoformat()], "v": [1]})
                    store.write(s, d.replace(day=1), df if old is None else pd.concat([old, df]))
                else:
                    store.write(s, d, pd.DataFrame({"code": ["2330"], "v": [1]}))


@pytest.mark.parametrize(
    ("now", "key", "due"),
    [
        (datetime(2026, 10, 6, 0, 13), "insti", date(2026, 10, 5)),  # 凌晨：10/5 的資料就是最新
        (datetime(2026, 10, 6, 14, 0), "quotes", date(2026, 10, 5)),  # 15:00 前
        (datetime(2026, 10, 6, 15, 0), "quotes", date(2026, 10, 6)),
        (datetime(2026, 10, 6, 16, 30), "insti", date(2026, 10, 6)),
        (datetime(2026, 10, 6, 16, 30), "credit", date(2026, 10, 5)),  # 融資融券 22:00
        (datetime(2026, 10, 6, 23, 0), "credit", date(2026, 10, 6)),
    ],
)
def test_due_date(tmp_path, now, key, due):
    ctx = make_ctx(tmp_path, {}, now=now.replace(tzinfo=TPE))
    assert freshness.due_date(key, ctx.calendar, ctx.now) == due


def test_due_date_holiday(tmp_path):
    ctx = make_ctx(tmp_path, {}, now=datetime(2026, 10, 10, 12, 0, tzinfo=TPE))
    assert not ctx.calendar.is_trading_day(date(2026, 10, 10))
    assert freshness.due_date("insti", ctx.calendar, ctx.now) == ctx.calendar.previous(date(2026, 10, 10))


def test_catchup_fetches_only_due_and_missing(tmp_path, monkeypatch):
    """10/6 00:13：10/5 收盤行情已有、三大法人與融資融券缺 → 只抓 10/5 的這些來源；不抓 10/6（還沒到預期時間）。"""
    ctx = make_ctx(tmp_path, {}, now=datetime(2026, 10, 6, 0, 13, tzinfo=TPE))
    miss = {
        ("twse_insti", date(2026, 10, 5)),
        ("tpex_insti", date(2026, 10, 5)),
        ("twse_margin", date(2026, 10, 5)),
        ("taifex_insti", date(2026, 10, 5)),
    }
    _fill(ctx.store, DAYS, skip=miss)
    gaps = {g.key: g for g in freshness.gaps(ctx.store, ctx.calendar, ctx.now)}
    assert set(gaps) == {"insti", "credit", "margin_total", "taifex"}
    assert gaps["insti"].dates == [date(2026, 10, 5)] and gaps["insti"].due == date(2026, 10, 5)

    calls: list[tuple[str, date]] = []

    def fake(c, spec, d, *, overwrite=False):
        calls.append((spec.id, d))
        c.store.write(spec.id, d, pd.DataFrame({"code": ["2330"], "v": [1]}))
        return "ok"

    monkeypatch.setattr(tasks, "run_daily_source", fake)
    from pipeline import tasks_advanced

    def fake_taifex(c, a, b):
        c.store.write(
            "taifex_insti",
            b.replace(day=1),
            pd.concat(
                [c.store.read("taifex_insti", b.replace(day=1)), pd.DataFrame({"date": [b.isoformat()], "v": [1]})]
            ),
        )

    monkeypatch.setattr(tasks_advanced, "run_taifex", fake_taifex)
    res = freshness.run_catchup(ctx)
    assert sorted(calls) == sorted(
        [("twse_insti", date(2026, 10, 5)), ("tpex_insti", date(2026, 10, 5)), ("twse_margin", date(2026, 10, 5))]
    )
    assert (
        res["missing_after"] == []
        and not res["retry"]
        and set(res["fixed"]) == {"insti", "credit", "margin_total", "taifex"}
    )
    assert ctx.manifest["freshness"]["missing"] == []


def test_catchup_still_missing_schedules_retry_and_records(tmp_path, monkeypatch):
    """抓不到 → manifest 記下缺哪些與下次重試時間；第 4 次（3 次重試用完）記為失敗，不靜默。"""
    ctx = make_ctx(tmp_path, {}, now=datetime(2026, 10, 6, 16, 30, tzinfo=TPE))
    _fill(ctx.store, [*DAYS, date(2026, 10, 6)], skip={("twse_insti", date(2026, 10, 6))})
    monkeypatch.setattr(tasks, "run_daily_source", lambda c, spec, d, overwrite=False: "pending")
    res = freshness.run_catchup(ctx, attempt=1)
    # 16:30 時融資融券（22:00）還沒到預期時間：10/6 沒有融資融券不算缺
    assert res["missing_after"] == ["insti"] and res["retry"]
    st = ctx.manifest["freshness"]
    assert st["missing"][0]["dates"] == ["2026-10-06"] and st["next_retry"] == "2026-10-06T17:30+08:00"
    res4 = freshness.run_catchup(ctx, attempt=4)
    assert not res4["retry"]
    assert any(r["status"] == "failed" and r["source"] == "twse_insti" for r in ctx.results)


def test_kbar_due(tmp_path):
    ctx = make_ctx(tmp_path, {}, now=datetime(2026, 10, 6, 0, 13, tzinfo=TPE))
    assert freshness.kbar_due({}, ctx.calendar, ctx.now)
    assert not freshness.kbar_due({"kbar": {"target": "2026-10-05", "remaining": 0}}, ctx.calendar, ctx.now)
    assert freshness.kbar_due({"kbar": {"target": "2026-10-05", "remaining": 4}}, ctx.calendar, ctx.now)
