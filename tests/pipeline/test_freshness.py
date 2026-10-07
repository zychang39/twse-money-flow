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


# ── 接力（2026-10-07）：每次補抓結束時預約下一次 ─────────────────────────────


@pytest.mark.parametrize(
    ("hm", "expected"),
    [
        ((8, 5), (15, 2)),  # 起跑點：等到收盤行情
        ((15, 0), (16, 2)),  # 15:00 已到期（這一次就抓了）→ 下一個是 16:00
        ((15, 5), (16, 2)),
        ((16, 30), (17, 2)),
        ((17, 5), (22, 2)),
        ((22, 5), None),  # 今天都過了 → 隔天由排程起跑
    ],
)
def test_next_due_at(tmp_path, hm, expected):
    ctx = make_ctx(tmp_path, {}, now=datetime(2026, 10, 7, *hm, tzinfo=TPE))
    got = freshness.next_due_at(ctx.calendar, ctx.now)
    assert (got and (got.hour, got.minute)) == (expected or None)
    if got:
        assert got.date() == date(2026, 10, 7) and got.tzinfo is not None


def test_next_due_at_holiday(tmp_path):
    ctx = make_ctx(tmp_path, {}, now=datetime(2026, 10, 9, 8, 5, tzinfo=TPE))  # 國慶日補假
    assert not ctx.calendar.is_trading_day(date(2026, 10, 9))
    assert freshness.next_due_at(ctx.calendar, ctx.now) is None


def test_plan_next():
    now = datetime(2026, 10, 7, 17, 5, tzinfo=TPE)
    due = datetime(2026, 10, 7, 22, 2, tzinfo=TPE)
    retry = datetime(2026, 10, 7, 18, 5, tzinfo=TPE)
    # 沒有重試 → 等到下一個預期公布時間，attempt 從 1 起算
    assert freshness.plan_next(now, 2, None, due, 300) == (due, 1)
    # 有重試且比較早 → 重試，attempt＋1
    assert freshness.plan_next(now, 1, retry, due, 300) == (retry, 2)
    # 下一個公布時間比重試早 → 先醒來，但照算重試次數
    early = datetime(2026, 10, 7, 17, 32, tzinfo=TPE)
    assert freshness.plan_next(now, 1, retry, early, 300) == (early, 2)
    # 17:02 醒來、17:05 結束 → 22:02 在 300 分鐘內，一次等到
    assert freshness.plan_next(datetime(2026, 10, 7, 17, 5, tzinfo=TPE), 1, None, due, 300) == (due, 1)
    # 太久 → 先等到上限（中繼）
    start = datetime(2026, 10, 7, 8, 5, tzinfo=TPE)
    assert freshness.plan_next(start, 1, None, datetime(2026, 10, 7, 15, 2, tzinfo=TPE), 300) == (
        datetime(2026, 10, 7, 13, 5, tzinfo=TPE),
        1,
    )
    assert freshness.plan_next(now, 1, None, None, 300) is None


def test_relay_decision():
    t = datetime(2026, 10, 7, 16, 2, tzinfo=TPE)
    earlier = datetime(2026, 10, 7, 15, 2, tzinfo=TPE)
    later = datetime(2026, 10, 7, 22, 2, tzinfo=TPE)
    assert freshness.relay_decision(t, []) == (True, [])
    assert freshness.relay_decision(t, [(1, earlier)]) == (False, [])
    assert freshness.relay_decision(t, [(1, t)]) == (False, [])
    assert freshness.relay_decision(t, [(2, later)]) == (True, [2])


def _catchup_args(**kw):
    import argparse

    return argparse.Namespace(**{"attempt": "", "not_before": "", "chain": True, **kw})


def _relay_env(monkeypatch, now, alive):
    """固定時間、補抓結果；記下 dispatch 與取消。"""
    from pipeline import cli

    calls: dict[str, list] = {"dispatch": [], "cancel": []}
    monkeypatch.setattr(cli, "now_tpe", lambda: now)
    monkeypatch.setattr("time.sleep", lambda s: pytest.fail("沒有 not_before 不該等待"))
    monkeypatch.setattr(freshness, "kbar_due", lambda *a: False)
    monkeypatch.setattr("pipeline.notify.github.alive_relays", lambda: alive)
    monkeypatch.setattr("pipeline.notify.github.cancel_run", lambda rid: calls["cancel"].append(rid) or True)
    monkeypatch.setattr(
        "pipeline.notify.github.dispatch_workflow",
        lambda wf, inputs, ref="main": calls["dispatch"].append(inputs) or True,
    )
    return calls


def test_catchup_relays_to_next_due(tmp_path, monkeypatch):
    """16:30 補抓完（沒有缺漏）→ 預約 17:02（外資持股比），記在 manifest freshness.next_run。"""
    from pipeline import cli

    now = datetime(2026, 10, 7, 16, 30, tzinfo=TPE)
    ctx = make_ctx(tmp_path, {}, now=now)
    calls = _relay_env(monkeypatch, now, [])

    def fake_catchup(c, attempt=1):
        c.manifest["freshness"] = {"missing": [], "next_retry": None}
        return {"retry": False, "fixed": [], "progressed": True}

    monkeypatch.setattr(freshness, "run_catchup", fake_catchup)
    extra = cli.run_catchup_task(ctx, _catchup_args())
    assert calls["dispatch"] == [{"task": "catchup", "attempt": "1", "not_before": "2026-10-07T17:02+08:00"}]
    assert extra["relay"] == "2026-10-07T17:02+08:00"
    assert ctx.manifest["freshness"]["next_run"] == "2026-10-07T17:02+08:00"


def test_catchup_relay_retry_and_dedupe(tmp_path, monkeypatch):
    """仍有缺漏 → 重試（attempt＋1）；已有較晚的接力在等 → 取消它；已有較早的 → 不再觸發。"""
    from pipeline import cli

    now = datetime(2026, 10, 7, 17, 5, tzinfo=TPE)

    def fake_catchup(c, attempt=1):
        c.manifest["freshness"] = {"missing": ["qfii"], "next_retry": "2026-10-07T18:05+08:00"}
        return {"retry": True, "fixed": [], "progressed": False}

    monkeypatch.setattr(freshness, "run_catchup", fake_catchup)
    later = [(99, datetime(2026, 10, 7, 22, 2, tzinfo=TPE))]
    calls = _relay_env(monkeypatch, now, later)
    cli.run_catchup_task(make_ctx(tmp_path / "a", {}, now=now), _catchup_args(attempt="1"))
    assert calls["cancel"] == [99]
    assert calls["dispatch"] == [{"task": "catchup", "attempt": "2", "not_before": "2026-10-07T18:05+08:00"}]

    earlier = [(98, datetime(2026, 10, 7, 18, 0, tzinfo=TPE))]
    calls = _relay_env(monkeypatch, now, earlier)
    ctx = make_ctx(tmp_path / "b", {}, now=now)
    extra = cli.run_catchup_task(ctx, _catchup_args(attempt="1"))
    assert calls["dispatch"] == [] and calls["cancel"] == []
    assert extra["relay"] == "skip:2026-10-07T18:00+08:00"
    assert ctx.manifest["freshness"]["next_run"] == "2026-10-07T18:00+08:00"


def test_catchup_after_last_dataset_does_not_relay(tmp_path, monkeypatch):
    """22:30 全部補齊 → 今天沒有下一棒（隔天由 08:05 起跑點或其他排程接上）。"""
    from pipeline import cli

    now = datetime(2026, 10, 7, 22, 30, tzinfo=TPE)
    calls = _relay_env(monkeypatch, now, [])
    monkeypatch.setattr(
        freshness, "run_catchup", lambda c, attempt=1: {"retry": False, "fixed": ["credit"], "progressed": True}
    )
    extra = cli.run_catchup_task(make_ctx(tmp_path, {}, now=now), _catchup_args())
    assert calls["dispatch"] == [] and "relay" not in extra


def test_relay_waits_until_not_before(tmp_path, monkeypatch):
    """接力的那一次先睡到 not_before（最多 max_wait＋5 分鐘），醒來後用新的時間補抓。"""
    from pipeline import cli

    now = datetime(2026, 10, 7, 15, 35, tzinfo=TPE)
    ctx = make_ctx(tmp_path, {}, now=now)
    _relay_env(monkeypatch, now, [])
    slept: list[float] = []
    monkeypatch.setattr("time.sleep", slept.append)
    monkeypatch.setattr(
        freshness, "run_catchup", lambda c, attempt=1: {"retry": False, "fixed": [], "progressed": False}
    )
    refreshed: list[object] = []
    monkeypatch.setattr("pipeline.gitdata.refresh", lambda d: refreshed.append(d) or "refreshed")
    ctx.manifest["marker"] = "stale"
    cli.run_catchup_task(ctx, _catchup_args(not_before="2026-10-07T16:02+08:00", attempt="1", data_dir=str(tmp_path)))
    assert slept == [27 * 60]
    # 睡醒後同步 data 分支並重新讀 manifest
    assert refreshed == [tmp_path] and "marker" not in ctx.manifest


def test_alive_relays_parses_titles(monkeypatch):
    from pipeline.notify import github

    runs = [
        {"id": 1, "status": "in_progress", "display_title": "Data · 補抓接力 2026-10-07T16:02+08:00"},
        {"id": 2, "status": "completed", "display_title": "Data · 補抓接力 2026-10-07T15:02+08:00"},
        {"id": 3, "status": "pending", "display_title": "Data"},
        {"id": 4, "status": "in_progress", "display_title": "Data · 補抓接力 2026-10-07T17:02+08:00"},  # 自己
    ]

    class Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"workflow_runs": runs}

    monkeypatch.setenv("GITHUB_TOKEN", "t")
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
    monkeypatch.setenv("GITHUB_RUN_ID", "4")
    monkeypatch.setattr(github.requests, "get", lambda *a, **k: Resp())
    assert github.alive_relays() == [(1, datetime(2026, 10, 7, 16, 2, tzinfo=TPE))]
