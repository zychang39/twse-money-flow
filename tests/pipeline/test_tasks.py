"""任務編排：以假的 HTTP 客戶端回放真實樣本，驗證寫入、驗證失敗不覆蓋、休市判斷、快照去重、月營收合併。"""

from __future__ import annotations

import json
from datetime import date, datetime

import pandas as pd
import pytest

from pipeline import tasks
from pipeline.core.dates import TPE
from pipeline.core.http import FetchError
from pipeline.core.store import DataStore
from pipeline.registry import SPECS
from tests.pipeline.conftest import sample

NO_DATA = json.dumps({"stat": "很抱歉，沒有符合條件的資料!"}).encode()


class FakeClient:
    def __init__(self, routes: dict[str, bytes | Exception]):
        self.routes = routes
        self.request_count = 0
        self.urls: list[str] = []

    def get_bytes(self, url: str) -> bytes:
        self.request_count += 1
        self.urls.append(url)
        for key, payload in self.routes.items():
            if key in url:
                if isinstance(payload, Exception):
                    raise payload
                return payload
        return NO_DATA

    def post_bytes(self, url: str, data: dict[str, str]) -> bytes:
        return self.get_bytes(url + "?" + "&".join(f"{k}={v}" for k, v in data.items()))


def make_ctx(tmp_path, routes, now=datetime(2026, 9, 24, 21, 45, tzinfo=TPE)):
    store = DataStore(tmp_path)
    ctx = tasks.RunContext(store=store, client=FakeClient(routes), now=now)  # type: ignore[arg-type]
    ctx.manifest = store.load_manifest()
    # 休市日曆
    store.write("twse_holidays", date(2026, 1, 1), SPECS["twse_holidays"].parse(sample("twse_holidaySchedule.json")).df)
    tasks.load_calendar(ctx, [2026], fetch_missing=False)
    return ctx


def test_daily_source_writes_and_extras(tmp_path):
    ctx = make_ctx(tmp_path, {"MI_INDEX": sample("twse_rwd_MI_INDEX_ALL.json")})
    # 樣本已裁切 → 放寬最低筆數以便測試
    spec = SPECS["twse_quotes"].__class__(**{**SPECS["twse_quotes"].__dict__, "min_rows": 10})
    assert tasks.run_daily_source(ctx, spec, date(2026, 9, 24)) == "ok"
    df = ctx.store.read("twse_quotes", date(2026, 9, 24))
    assert df is not None and "00400A" in set(df["code"])
    idx = ctx.store.read("twse_index", date(2026, 9, 24))
    assert idx is not None and "發行量加權報酬指數" not in set(idx["name"])  # 名稱照原樣保存
    assert ctx.manifest["sources"]["twse_quotes"]["last_success"] == "2026-09-24"
    # 已存在 → 不重抓
    assert tasks.run_daily_source(ctx, spec, date(2026, 9, 24)) == "exists"


def test_date_mismatch_fails_and_keeps_old(tmp_path):
    ctx = make_ctx(tmp_path, {"T86": sample("twse_rwd_T86.json")})  # 內容是 2026-09-24
    spec = SPECS["twse_insti"].__class__(**{**SPECS["twse_insti"].__dict__, "min_rows": 10})
    assert tasks.run_daily_source(ctx, spec, date(2026, 9, 23)) == "failed"
    assert ctx.store.read("twse_insti", date(2026, 9, 23)) is None
    assert "回應日期" in ctx.failures[0]["message"]


def test_row_count_jump_rejected(tmp_path):
    ctx = make_ctx(tmp_path, {"T86": sample("twse_rwd_T86.json")})
    spec = SPECS["twse_insti"].__class__(**{**SPECS["twse_insti"].__dict__, "min_rows": 10})
    big = pd.DataFrame({"code": [f"{i:04d}" for i in range(1000, 1400)], "foreign_net": 1, "total_net": 1})
    ctx.store.write("twse_insti", date(2026, 9, 23), big)
    assert tasks.run_daily_source(ctx, spec, date(2026, 9, 24)) == "failed"
    assert ctx.store.read("twse_insti", date(2026, 9, 24)) is None


def test_no_quotes_on_trading_day_marks_closed(tmp_path):
    ctx = make_ctx(tmp_path, {})
    assert tasks.run_daily_source(ctx, SPECS["twse_quotes"], date(2026, 9, 23)) == "closed"
    assert "2026-09-23" in ctx.manifest["closed_days"]
    assert not ctx.calendar.is_trading_day(date(2026, 9, 23))


def test_unpublished_is_pending_before_final_run(tmp_path):
    early = datetime(2026, 9, 24, 17, 30, tzinfo=TPE)
    ctx = make_ctx(tmp_path, {}, now=early)
    assert tasks.run_daily_source(ctx, SPECS["twse_margin"], date(2026, 9, 24)) == "pending"
    late = make_ctx(tmp_path, {}, now=datetime(2026, 9, 24, 21, 30, tzinfo=TPE))
    assert tasks.run_daily_source(late, SPECS["twse_margin"], date(2026, 9, 24)) == "failed"


def test_fetch_error_recorded(tmp_path):
    ctx = make_ctx(tmp_path, {"MI_MARGN": FetchError("被網站安全機制阻擋")})
    assert tasks.run_daily_source(ctx, SPECS["twse_margin"], date(2026, 9, 24)) == "failed"
    assert ctx.manifest["sources"]["twse_margin"]["consecutive_failures"] == 1


def test_range_source_split_by_month(tmp_path):
    ctx = make_ctx(tmp_path, {"TWT49U": sample("twse_rwd_TWT49U.json")})
    assert tasks.run_range_source(ctx, SPECS["twse_exright"], date(2026, 8, 25), date(2026, 9, 24)) == "ok"
    aug = ctx.store.read("twse_exright", date(2026, 8, 1))
    sep = ctx.store.read("twse_exright", date(2026, 9, 1))
    assert aug is not None and sep is not None
    assert set(aug["date"].str[:7]) == {"2026-08"} and set(sep["date"].str[:7]) == {"2026-09"}
    # 再跑一次不會產生重複
    tasks.run_range_source(ctx, SPECS["twse_exright"], date(2026, 8, 25), date(2026, 9, 24))
    again = ctx.store.read("twse_exright", date(2026, 8, 1))
    assert again is not None and len(again) == len(aug)


def test_snapshot_dedupe(tmp_path):
    ctx = make_ctx(tmp_path, {"notetrans": sample("twse_openapi_notetrans.json")})
    tasks.run_snapshot(ctx, SPECS["twse_attention_accum"], date(2026, 9, 23))
    tasks.run_snapshot(ctx, SPECS["twse_attention_accum"], date(2026, 9, 24))
    assert ctx.store.dates("twse_attention_accum") == [date(2026, 9, 23)]


def test_revenue_first_seen_is_kept(tmp_path):
    ctx = make_ctx(tmp_path, {"t187ap05_L": sample("twse_t187ap05_L.json")})
    ctx.now = datetime(2026, 9, 17, 18, 0, tzinfo=TPE)
    tasks.run_snapshot(ctx, SPECS["twse_revenue"], date(2026, 9, 17))
    ctx.now = datetime(2026, 9, 24, 18, 0, tzinfo=TPE)
    tasks.run_snapshot(ctx, SPECS["twse_revenue"], date(2026, 9, 24))
    rev = ctx.store.read("revenue", date(2026, 8, 1))
    assert rev is not None
    assert rev.set_index("code").loc["1101", "first_seen"] == "2026-09-17"


def test_backfill_resumes_and_respects_budget(tmp_path):
    ctx = make_ctx(tmp_path, {"MI_INDEX": sample("twse_rwd_MI_INDEX_ALL.json")})
    ctx.deadline = 0  # 立即超時
    out = tasks.task_backfill(ctx, ["twse_quotes"], date(2026, 9, 1), date(2026, 9, 24))
    assert out["remaining"] > 0 and out["next_start"] == "2026-09-01"


@pytest.mark.parametrize("hour,expected", [(10, date(2026, 9, 23)), (18, date(2026, 9, 24))])
def test_target_trading_date(tmp_path, hour, expected):
    ctx = make_ctx(tmp_path, {}, now=datetime(2026, 9, 24, hour, 0, tzinfo=TPE))
    assert tasks.target_trading_date(ctx) == expected


def test_target_skips_holiday(tmp_path):
    ctx = make_ctx(tmp_path, {}, now=datetime(2026, 9, 26, 12, 0, tzinfo=TPE))  # 週六；9/25 中秋
    assert tasks.target_trading_date(ctx) == date(2026, 9, 24)
