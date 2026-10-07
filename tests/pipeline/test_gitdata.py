def test_merge_manifests_holders_backfill():
    from pipeline.gitdata import merge_manifests

    a = {
        "updated_at": "2026-10-01T10:00",
        "holders_backfill": {"updated_at": "2026-10-01T09:00", "done": 5, "nodata": {"1": ["w1"]}},
    }
    b = {
        "updated_at": "2026-10-01T09:30",
        "holders_backfill": {"updated_at": "2026-10-01T09:40", "done": 9, "nodata": {"1": ["w2"], "2": ["w1"]}},
    }
    m = merge_manifests(a, b)
    assert m["holders_backfill"]["done"] == 9
    assert m["holders_backfill"]["nodata"] == {"1": ["w1", "w2"], "2": ["w1"]}


def test_merge_manifests_holders_lane_state_per_lane():
    """v3：兩道平行回補交錯推送，各道狀態逐道取較新者。"""
    from pipeline.gitdata import merge_manifests

    a = {
        "updated_at": "t2",
        "holders_backfill": {
            "updated_at": "2026-10-01T10:00",
            "lane_state": {
                "0/2": {"updated_at": "2026-10-01T10:00", "remaining": 5},
                "1/2": {"updated_at": "2026-10-01T08:00", "remaining": 9},
            },
        },
    }
    b = {
        "updated_at": "t1",
        "holders_backfill": {
            "updated_at": "2026-10-01T09:00",
            "lane_state": {"1/2": {"updated_at": "2026-10-01T09:00", "remaining": 7}},
        },
    }
    m = merge_manifests(a, b)
    assert m["holders_backfill"]["lane_state"]["0/2"]["remaining"] == 5
    assert m["holders_backfill"]["lane_state"]["1/2"]["remaining"] == 7


def test_merge_manifests_pending_slot_keeps_newer_deferral():
    """兩個回補同時延後：後推送的一方帶著舊的集保待續槽，合併時仍保留 deferred_at 較新的那一個。"""
    from pipeline.gitdata import merge_manifests

    ours = {
        "updated_at": "2026-09-30T18:02",
        "holders_backfill_pending": {"deferred_at": "2026-09-30T14:07+08:00", "ref": "old"},
        "backfill_pending": {"deferred_at": "2026-09-30T18:02+08:00", "ref": "new"},
    }
    theirs = {
        "updated_at": "2026-09-30T18:01",
        "holders_backfill_pending": {"deferred_at": "2026-09-30T18:01+08:00", "ref": "new", "source": "lanes=2"},
    }
    m = merge_manifests(ours, theirs)
    assert m["holders_backfill_pending"]["source"] == "lanes=2"
    assert m["backfill_pending"]["ref"] == "new"


def test_refresh_pulls_remote_data_when_clean(tmp_path):
    """2026-10-07：接力睡醒後同步到遠端最新；工作目錄有改動時不動。"""
    import subprocess

    from pipeline.gitdata import refresh

    def git(*args, cwd):
        subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)

    remote, writer, data = tmp_path / "remote.git", tmp_path / "writer", tmp_path / "data"
    git("init", "-q", "--bare", str(remote), cwd=tmp_path)
    git("clone", "-q", str(remote), str(writer), cwd=tmp_path)
    for k, v in {"user.name": "t", "user.email": "t@t"}.items():
        git("config", k, v, cwd=writer)
    git("checkout", "-q", "-b", "data", cwd=writer)
    (writer / "manifest.json").write_text("{}", encoding="utf-8")
    git("add", "-A", cwd=writer)
    git("commit", "-q", "-m", "1", cwd=writer)
    git("push", "-q", "origin", "data", cwd=writer)
    git("clone", "-q", "-b", "data", str(remote), str(data), cwd=tmp_path)
    assert refresh(tmp_path / "not-git") == "skip"
    # 睡覺期間別的任務推進了 data 分支
    (writer / "manifest.json").write_text('{"v": 2}', encoding="utf-8")
    git("commit", "-q", "-am", "2", cwd=writer)
    git("push", "-q", "origin", "data", cwd=writer)
    assert refresh(data) == "refreshed"
    assert (data / "manifest.json").read_text(encoding="utf-8") == '{"v": 2}'
    (data / "x.txt").write_text("local", encoding="utf-8")
    assert refresh(data) == "dirty"
