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
