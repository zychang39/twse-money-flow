from pipeline.evidence.periods import spark_rel


def test_spark_rel_relative_to_0050_every_4_weeks_with_last_point() -> None:
    dates = [f"2024-01-{d:02d}" for d in range(1, 11)]
    port = [1.0 + 0.1 * i for i in range(10)]
    ref = [1.0] * 10
    pack = {"periods": {"last:3": {"weekly": {"dates": dates, "port": port, "0050": ref}}}}
    sp = spark_rel(pack)
    assert sp is not None
    assert sp["from"] == "2024-01-01" and sp["to"] == "2024-01-10"
    # 索引 0、4、8 再加最後一點 9
    assert sp["v"] == [0.0, 40.0, 80.0, 90.0]


def test_spark_rel_none_without_weekly() -> None:
    assert spark_rel({"periods": {}}) is None
