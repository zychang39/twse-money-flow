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
