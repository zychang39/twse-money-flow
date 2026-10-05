"""排程與部署（docs/BACKLOG.md E-05、Q-05）：回補與每日任務並行、cron 一致性、休市時段不開始回補。"""

from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from pipeline.core.dates import TPE

ROOT = Path(__file__).resolve().parents[2]


def _git(*a: str, cwd: Path) -> str:
    return subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def _clone(remote: Path, where: Path) -> Path:
    subprocess.run(["git", "clone", "-q", "-b", "data", str(remote), str(where)], check=True, capture_output=True)
    _git("config", "user.email", "t@t", cwd=where)
    _git("config", "user.name", "t", cwd=where)
    return where


def _manifest(path: Path, **kw: object) -> None:
    (path / "manifest.json").write_text(json.dumps(kw, ensure_ascii=False, indent=1, sort_keys=True) + "\n")


def test_concurrent_daily_and_backfill_push_rebase_and_merge_manifest(tmp_path):
    """E-05：每日任務與回補同時寫入 data 分支 → 後推送的一方 rebase 並合併 manifest，兩邊的檔案與狀態都保留。"""
    from pipeline import gitdata

    remote = tmp_path / "remote.git"
    _git("init", "--bare", "-q", "-b", "data", str(remote), cwd=tmp_path)
    seed = tmp_path / "seed"
    seed.mkdir()
    _git("init", "-q", "-b", "data", cwd=seed)
    _git("config", "user.email", "t@t", cwd=seed)
    _git("config", "user.name", "t", cwd=seed)
    _manifest(seed, updated_at="2026-09-28T10:00:00+08:00", sources={}, closed_days=[], runs=[])
    _git("add", ".", cwd=seed)
    _git("commit", "-qm", "seed", cwd=seed)
    _git("remote", "add", "origin", str(remote), cwd=seed)
    _git("push", "-q", "origin", "data", cwd=seed)

    daily = _clone(remote, tmp_path / "daily")
    back = _clone(remote, tmp_path / "back")
    # 每日任務：寫入 9/29 行情
    (daily / "raw").mkdir()
    (daily / "raw" / "20260929.csv").write_text("daily")
    _manifest(
        daily,
        updated_at="2026-09-29T17:40:00+08:00",
        sources={"twse_quotes": {"last_attempt": "2026-09-29T17:40", "last_success": "2026-09-29", "rows": 1}},
        closed_days=["2026-09-25"],
        runs=[{"task": "daily", "at": "2026-09-29T17:40"}],
        last_target_date="2026-09-29",
    )
    # 回補：同時寫入 2023 年的舊檔
    (back / "raw").mkdir()
    (back / "raw" / "20230901.csv").write_text("backfill")
    _manifest(
        back,
        updated_at="2026-09-29T17:35:00+08:00",
        sources={
            "twse_quotes": {"last_attempt": "2026-09-29T17:35", "last_success": "2023-09-01", "rows": 9},
            "taifex_insti": {"last_attempt": "2026-09-29T17:30", "last_success": "2024-06-28", "rows": 3},
        },
        closed_days=["2023-09-01"],
        runs=[{"task": "backfill", "at": "2026-09-29T17:35"}],
        backfilled={"taifex": ["2024-06"]},
    )
    assert gitdata.commit_and_push(daily, "daily", squash_monthly=False, sleep=lambda s: None) == "pushed"
    assert gitdata.commit_and_push(back, "backfill", squash_monthly=False, sleep=lambda s: None).startswith("pushed")

    final = _clone(remote, tmp_path / "final")
    assert (final / "raw" / "20260929.csv").read_text() == "daily"
    assert (final / "raw" / "20230901.csv").read_text() == "backfill"
    m = json.loads((final / "manifest.json").read_text())
    assert m["sources"]["twse_quotes"]["last_success"] == "2026-09-29"  # 回補較舊的成功日不會蓋掉每日任務
    assert m["sources"]["taifex_insti"]["last_success"] == "2024-06-28"
    assert m["closed_days"] == ["2023-09-01", "2026-09-25"]
    assert [r["task"] for r in m["runs"]] == ["backfill", "daily"]
    assert m["last_target_date"] == "2026-09-29" and m["backfilled"] == {"taifex": ["2024-06"]}


def test_squash_does_not_overwrite_concurrent_push(tmp_path, monkeypatch):
    """E-05：每月 squash 用 --force-with-lease；遠端已被其他任務推進 → 放棄 squash、改一般推送，不會蓋掉別人的提交。"""
    from pipeline import gitdata

    remote = tmp_path / "remote.git"
    _git("init", "--bare", "-q", "-b", "data", str(remote), cwd=tmp_path)
    seed = tmp_path / "seed"
    seed.mkdir()
    _git("init", "-q", "-b", "data", cwd=seed)
    _git("config", "user.email", "t@t", cwd=seed)
    _git("config", "user.name", "t", cwd=seed)
    _manifest(seed, updated_at="2026-08-01T00:00:00+08:00", sources={})
    _git("add", ".", cwd=seed)
    # 根提交在上個月 → 本月第一次提交會觸發 squash
    subprocess.run(
        ["git", "commit", "-qm", "seed"],
        cwd=seed,
        check=True,
        env={"GIT_COMMITTER_DATE": "2026-08-01T00:00:00+08:00", "PATH": "/usr/bin:/bin"},
    )
    (seed / "x").write_text("x")
    _git("add", ".", cwd=seed)
    _git("commit", "-qm", "second", cwd=seed)
    _git("remote", "add", "origin", str(remote), cwd=seed)
    _git("push", "-q", "origin", "data", cwd=seed)
    a = _clone(remote, tmp_path / "a")
    b = _clone(remote, tmp_path / "b")
    (b / "b.txt").write_text("b")
    _git("add", ".", cwd=b)
    _git("commit", "-qm", "other job", cwd=b)
    _git("push", "-q", "origin", "data", cwd=b)
    (a / "a.txt").write_text("a")
    assert gitdata.commit_and_push(a, "mine", sleep=lambda s: None).startswith("pushed")
    final = _clone(remote, tmp_path / "final")
    assert (final / "a.txt").exists() and (final / "b.txt").exists()


def test_data_yml_cron_matches_schedule_tasks():
    """Q-05：data.yml 的 cron 與 pipeline/cli.py 的 SCHEDULE_TASKS 必須一致（兩邊手動複製，容易漂移）。"""
    from pipeline.cli import SCHEDULE_TASKS

    text = (ROOT / ".github" / "workflows" / "data.yml").read_text(encoding="utf-8")
    crons = re.findall(r'^\s*-\s*cron:\s*"([^"]+)"', text, re.M)
    assert crons and set(crons) == set(SCHEDULE_TASKS)
    # workflow 內用來判斷盤中提醒的字串也要是同一個 cron
    alerts = [c for c, t in SCHEDULE_TASKS.items() if t == "alerts"]
    assert alerts and all(f"'{c}'" in text for c in alerts)


@pytest.mark.parametrize(
    ("when", "blocked"),
    [
        ("2026-09-29T13:29", False),  # 交易日 13:30 前（M0：分段更新 14:15 起，暫停時段提早到 13:30）
        ("2026-09-29T13:30", True),
        ("2026-09-29T16:30", True),
        ("2026-09-29T22:29", True),
        ("2026-09-29T22:30", False),
        ("2026-09-28T18:00", False),  # 教師節休市：沒有每日任務，不必讓出
        ("2026-09-27T18:00", False),  # 週日
    ],
)
def test_backfill_quiet_window(when, blocked):
    """E-05／M0：台灣時間交易日 13:30–22:30 不開始新的一段回補（讓分段更新先跑）。"""
    from pipeline.cli import in_quiet_window
    from pipeline.core.calendar import TradingCalendar

    cal = TradingCalendar(closed={datetime(2026, 9, 28).date(), datetime(2026, 9, 25).date()})
    now = datetime.fromisoformat(when).replace(tzinfo=TPE)
    assert in_quiet_window(now, cal) is blocked


def test_daily_heals_missed_trading_days(tmp_path):
    """E-05：每日任務被擠掉 8 個交易日 → 下次執行從最後一個有行情的交易日之後全部補抓（不只最近 5 天）。"""
    from datetime import date

    import pandas as pd

    from pipeline import tasks
    from tests.pipeline.test_tasks import make_ctx

    ctx = make_ctx(tmp_path, {}, now=datetime(2026, 10, 7, 21, 0, tzinfo=TPE))
    ctx.store.write("twse_quotes", date(2026, 9, 24), pd.DataFrame({"code": ["2330"], "close": [1.0]}))
    target = date(2026, 10, 7)
    # 9/29、9/30、10/1、10/2、10/5、10/6、10/7（10/9 國慶之前）＝7 個交易日未抓
    assert tasks.heal_window(ctx, target, 5) == 8
    assert tasks.heal_window(ctx, date(2026, 9, 24), 5) == 5


def test_backfill_deferred_in_quiet_window_and_resumed(tmp_path, monkeypatch):
    """E-05：交易日 18:00 觸發的回補分段不開始，記錄待續參數；22:40 的 resume 以同樣參數重新觸發。"""
    import argparse

    from pipeline import cli
    from pipeline.core.store import DataStore
    from pipeline.derive.demo import DEMO_HOLIDAYS_2026

    store = DataStore(tmp_path)
    import pandas as pd

    store.write(
        "twse_holidays",
        datetime(2026, 1, 1).date(),
        pd.DataFrame([{"date": d, "name": n, "description": ""} for d, n in DEMO_HOLIDAYS_2026]),
    )
    monkeypatch.setattr("pipeline.cli.now_tpe", lambda: datetime(2026, 9, 29, 18, 0, tzinfo=TPE))
    called: list[tuple[str, dict, str]] = []
    monkeypatch.setattr(
        "pipeline.notify.github.dispatch_workflow",
        lambda wf, inputs, ref="main": called.append((wf, inputs, ref)) or True,
    )
    monkeypatch.setattr("pipeline.tasks.task_backfill", lambda *a, **k: pytest.fail("不應在每日任務時段開始回補"))
    monkeypatch.setenv("GITHUB_REF_NAME", "main")
    args = argparse.Namespace(
        task="backfill",
        schedule="",
        source="taifex",
        start="2023-09-01",
        end="2024-06-30",
        refresh="",
        data_dir=str(tmp_path),
        max_minutes=40,
        chain=True,
    )
    assert cli.cmd_run(args) == 0
    pending = store.load_manifest()["backfill_pending"]
    assert pending["source"] == "taifex" and pending["start"] == "2023-09-01" and pending["end"] == "2024-06-30"
    assert cli.cmd_resume(argparse.Namespace(data_dir=str(tmp_path))) == 0
    assert called == [
        (
            "data.yml",
            {"task": "backfill", "source": "taifex", "start": "2023-09-01", "end": "2024-06-30", "refresh": "false"},
            "main",
        )
    ]


def test_holders_backfill_deferred_separately_and_resumed(tmp_path, monkeypatch):
    """M0：全市場集保回補在交易日 14:00 不開始，記在自己的待續槽；22:40 resume 以 holders_backfill 重新觸發。"""
    import argparse

    import pandas as pd

    from pipeline import cli
    from pipeline.core.store import DataStore
    from pipeline.derive.demo import DEMO_HOLIDAYS_2026

    store = DataStore(tmp_path)
    store.write(
        "twse_holidays",
        datetime(2026, 1, 1).date(),
        pd.DataFrame([{"date": d, "name": n, "description": ""} for d, n in DEMO_HOLIDAYS_2026]),
    )
    monkeypatch.setattr("pipeline.cli.now_tpe", lambda: datetime(2026, 9, 29, 14, 0, tzinfo=TPE))
    called: list[tuple[str, dict, str]] = []
    monkeypatch.setattr(
        "pipeline.notify.github.dispatch_workflow",
        lambda wf, inputs, ref="main": called.append((wf, inputs, ref)) or True,
    )
    monkeypatch.setattr(
        "pipeline.tasks_advanced.run_tdcc_full", lambda *a, **k: pytest.fail("不應在分段更新時段開始回補")
    )
    monkeypatch.setenv("GITHUB_REF_NAME", "claude/dev")
    args = argparse.Namespace(
        task="holders_backfill",
        schedule="",
        source="",
        start="",
        end="",
        refresh="",
        data_dir=str(tmp_path),
        max_minutes=40,
        chain=True,
    )
    assert cli.cmd_run(args) == 0
    m = store.load_manifest()
    assert "backfill_pending" not in m and m["holders_backfill_pending"]["task"] == "holders_backfill"
    assert cli.cmd_resume(argparse.Namespace(data_dir=str(tmp_path))) == 0
    assert len(called) == 1
    wf, inputs, ref = called[0]
    assert wf == "data.yml" and inputs["task"] == "holders_backfill" and ref == "claude/dev"


def test_holders_stalled():
    from pipeline.cli import holders_stalled

    now = datetime(2026, 10, 1, 22, 40, tzinfo=TPE)
    assert holders_stalled({"remaining": 10, "updated_at": "2026-10-01T18:00+08:00"}, now)
    assert not holders_stalled({"remaining": 10, "updated_at": "2026-10-01T21:00+08:00"}, now)
    assert not holders_stalled({"remaining": 0, "updated_at": "2026-09-01T00:00+08:00"}, now)
    assert not holders_stalled({}, now)


def test_schedule_yml_crons_match_catchup_tasks():
    """2026-10-06：config/schedule.yml freshness.catchup 的 cron（UTC）與台北時間、SCHEDULE_TASKS 的 catchup 一致；
    分段更新（stage:*）不再排程，只留手動觸發。"""
    from pipeline.cli import SCHEDULE_TASKS
    from pipeline.stages import schedule

    cu = schedule()["freshness"]["catchup"]
    assert {c for c, t in SCHEDULE_TASKS.items() if t == "catchup"} == set(cu["crons"])
    assert not [t for t in SCHEDULE_TASKS.values() if t.startswith("stage:")]
    for cron, hm in zip(cu["crons"], cu["times"], strict=True):
        m, h = (int(x) for x in cron.split()[:2])
        assert f"{(h + 8) % 24:02d}:{m:02d}" == hm


def test_run_stage_retries_until_published_and_records_time(tmp_path, monkeypatch):
    """未公布 → 每 5 分鐘重試；第 3 次看到資料 → done，記錄公布時間（5 分鐘粒度）與分段狀態。"""
    import pandas as pd

    from pipeline import stages, tasks
    from tests.pipeline.test_tasks import make_ctx

    now = datetime(2026, 9, 29, 14, 15, tzinfo=TPE)
    ctx = make_ctx(tmp_path, {}, now=now)
    calls = {"n": 0}

    def fake_daily(c, sources=None):
        calls["n"] += 1
        if calls["n"] >= 3:  # 第 3 次（14:25）才公布
            for s in ("twse_quotes", "tpex_quotes"):
                c.store.write(s, now.date(), pd.DataFrame({"code": ["2330"], "close": [1.0]}))

    monkeypatch.setattr(tasks, "task_daily", fake_daily)
    t = {"v": 0.0}
    slept: list[float] = []
    stamps = iter([now + timedelta(minutes=5 * i) for i in range(20)])
    res = stages.run_stage(
        ctx,
        "close",
        sleep=lambda s: (slept.append(s), t.__setitem__("v", t["v"] + s)),
        clock=lambda: t["v"],
        now=lambda: next(stamps),
    )
    assert res["status"] == "done" and calls["n"] == 3 and slept == [300.0, 300.0]
    assert ctx.manifest["publish_times"]["twse_quotes"] == [{"date": "2026-09-29", "at": "14:25"}]
    assert ctx.manifest["stages"]["date"] == "2026-09-29" and ctx.manifest["stages"]["close"]["status"] == "done"


def test_run_stage_gives_up_after_60_minutes(tmp_path, monkeypatch):
    from pipeline import stages, tasks
    from tests.pipeline.test_tasks import make_ctx

    ctx = make_ctx(tmp_path, {}, now=datetime(2026, 9, 29, 15, 30, tzinfo=TPE))
    monkeypatch.setattr(tasks, "task_daily", lambda c, sources=None: None)
    t = {"v": 0.0}
    res = stages.run_stage(
        ctx,
        "insti",
        sleep=lambda s: t.__setitem__("v", t["v"] + s),
        clock=lambda: t["v"],
        now=lambda: datetime(2026, 9, 29, 16, 30, tzinfo=TPE),
    )
    assert res["status"] == "late" and res["waited"] == 60
    assert ctx.manifest["stages"]["insti"]["status"] == "late"


def test_publish_summary_median():
    from pipeline.derive.export import publish_summary

    rows = [{"date": f"2026-10-{d:02d}", "at": t} for d, t in [(1, "14:25"), (2, "14:20"), (5, "14:35")]]
    assert publish_summary(rows) == {"median": "14:25", "earliest": "14:20", "latest": "14:35", "days": 3}
    assert publish_summary([]) is None


def test_probe_day_records_first_seen_time():
    """公布時間實測：每 5 分鐘探測；只在預估時間前 30 分鐘後才探測；看到後停止探測該來源。"""
    from datetime import date

    from pipeline import probe

    class Ctx:
        def __init__(self):
            self.manifest: dict = {}

    d = date(2026, 9, 30)
    t = {"now": datetime(2026, 9, 30, 13, 30, tzinfo=TPE)}
    asked: list[tuple[str, str]] = []

    def check(ctx, src, day):
        asked.append((src, t["now"].strftime("%H:%M")))
        return t["now"] >= datetime(2026, 9, 30, 14, 20, tzinfo=TPE) if src == "twse_quotes" else src != "twse_margin"

    def sleep(s):
        t["now"] += timedelta(seconds=s)

    ctx = Ctx()
    found = probe.probe_day(
        ctx, d, sleep=sleep, now=lambda: t["now"], deadline=datetime(2026, 9, 30, 15, 0, tzinfo=TPE), check=check
    )
    assert found["twse_quotes"] == "14:20"
    assert "twse_margin" not in found  # 21:00 − 30 分鐘前不探測
    assert all(s != "twse_margin" for s, _ in asked)
    assert sum(1 for s, _ in asked if s == "twse_quotes") == 11  # 13:30–14:20 每 5 分鐘
    assert ctx.manifest["publish_probe"]["2026-09-30"]["twse_quotes"] == "14:20"


def _holders_args(tmp_path, source):
    import argparse

    return argparse.Namespace(
        task="holders_backfill",
        schedule="",
        source=source,
        start="",
        end="",
        refresh="",
        data_dir=str(tmp_path),
        max_minutes=40,
        chain=True,
    )


def test_holders_backfill_spawns_lanes_outside_quiet_window(tmp_path, monkeypatch):
    """v3 M0：空白 source（main 的接續、停擺重啟）→ 分派者觸發 lane=0/2、lane=1/2 兩道，自己不查詢。"""
    from pipeline import cli

    monkeypatch.setattr("pipeline.cli.now_tpe", lambda: datetime(2026, 9, 29, 23, 0, tzinfo=TPE))
    called: list[tuple[str, dict, str]] = []
    monkeypatch.setattr(
        "pipeline.notify.github.dispatch_workflow",
        lambda wf, inputs, ref="main": called.append((wf, inputs, ref)) or True,
    )
    monkeypatch.setattr("pipeline.tasks_advanced.run_tdcc_full", lambda *a, **k: pytest.fail("分派者不查詢"))
    monkeypatch.setenv("GITHUB_REF_NAME", "feat/x")
    assert cli.cmd_run(_holders_args(tmp_path, "")) == 0
    assert [c[1]["source"] for c in called] == ["lane=0/2", "lane=1/2"]
    assert all(c[2] == "feat/x" and c[1]["task"] == "holders_backfill" for c in called)


def test_holders_backfill_lane_runs_its_lane_and_defers_as_spawner(tmp_path, monkeypatch):
    """每一道只跑自己的週；在交易日 13:30–22:30 延後時，待續槽記「lanes=2」，22:40 接續一次觸發兩道。"""
    import pandas as pd

    from pipeline import cli
    from pipeline.core.store import DataStore
    from pipeline.derive.demo import DEMO_HOLIDAYS_2026

    seen: list[object] = []
    monkeypatch.setattr(
        "pipeline.tasks_advanced.run_tdcc_full",
        lambda ctx, **k: seen.append(k.get("lane")) or {"remaining": 0, "progressed": True},
    )
    monkeypatch.setattr("pipeline.notify.github.dispatch_workflow", lambda *a, **k: True)
    monkeypatch.setattr("pipeline.cli.now_tpe", lambda: datetime(2026, 9, 29, 23, 0, tzinfo=TPE))
    assert cli.cmd_run(_holders_args(tmp_path, "lane=1/2")) == 0
    assert seen == [(1, 2)]
    store = DataStore(tmp_path)
    store.write(
        "twse_holidays",
        datetime(2026, 1, 1).date(),
        pd.DataFrame([{"date": d, "name": n, "description": ""} for d, n in DEMO_HOLIDAYS_2026]),
    )
    monkeypatch.setattr("pipeline.cli.now_tpe", lambda: datetime(2026, 9, 29, 14, 0, tzinfo=TPE))
    assert cli.cmd_run(_holders_args(tmp_path, "lane=0/2")) == 0
    assert seen == [(1, 2)]
    assert store.load_manifest()["holders_backfill_pending"]["source"] == "lanes=2"


def test_data_yml_holders_lanes_have_own_groups():
    """兩道各自一個 concurrency group（holders-backfill-lane=0/2…），不互相排隊。"""
    text = (Path(__file__).resolve().parents[2] / ".github/workflows/data.yml").read_text(encoding="utf-8")
    assert "format('holders-backfill-{0}', inputs.source)" in text
