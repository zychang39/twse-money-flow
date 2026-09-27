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
    assert out["remaining"] > 0 and not out["progressed"]


def test_backfill_newest_first_and_skips_existing(tmp_path):
    ctx = make_ctx(tmp_path, {"MI_INDEX": sample("twse_rwd_MI_INDEX_ALL.json")})
    ctx.store.write("twse_quotes", date(2026, 9, 24), pd.DataFrame({"code": ["2330"], "close": [1.0]}))
    tasks.task_backfill(ctx, ["twse_quotes"], date(2026, 9, 21), date(2026, 9, 24))
    urls = ctx.client.urls  # type: ignore[attr-defined]
    # 9/24 已存在 → 從 9/23 開始往前抓（樣本日期為 9/24 → 驗證失敗，不寫入）
    assert "date=20260923" in urls[0] and "date=20260922" in urls[1]


def test_backfill_refresh_refetches_existing(tmp_path):
    """--refresh：已存在的檔案也重抓（補齊解析器新增的欄位）；未指定來源時拒絕，避免整批重抓。"""
    ctx = make_ctx(tmp_path, {"T86": sample("twse_rwd_T86.json")})
    old = pd.DataFrame({"date": ["2026-09-24"], "code": ["2330"], "foreign_net": [1.0]})
    ctx.store.write("twse_insti", date(2026, 9, 24), old)
    tasks.task_backfill(ctx, ["twse_insti"], date(2026, 9, 24), date(2026, 9, 24))
    assert not ctx.client.urls  # type: ignore[attr-defined]
    tasks.task_backfill(ctx, ["twse_insti"], date(2026, 9, 24), date(2026, 9, 24), refresh=True)
    assert any("T86" in u and "date=20260924" in u for u in ctx.client.urls)  # type: ignore[attr-defined]
    # 樣本已裁切（筆數少於下限）→ 驗證失敗，保留原檔不覆蓋
    got = ctx.store.read("twse_insti", date(2026, 9, 24))
    assert got is not None and got["foreign_net"].tolist() == [1.0]
    with pytest.raises(ValueError):
        tasks.task_backfill(ctx, None, date(2026, 9, 24), date(2026, 9, 24), refresh=True)


def test_full_backfill_limits_advanced_days(tmp_path, monkeypatch):
    monkeypatch.setattr(tasks, "BACKFILL_FULL", ["twse_quotes", "twse_sbl"])
    monkeypatch.setattr(tasks, "ADVANCED_BACKFILL_DAYS", 1)
    ctx = make_ctx(tmp_path, {"MI_INDEX": sample("twse_rwd_MI_INDEX_ALL.json")})
    tasks.task_backfill(ctx, None, date(2026, 9, 21), date(2026, 9, 24))
    sbl = [u for u in ctx.client.urls if "TWT93U" in u]  # type: ignore[attr-defined]
    # 只補近 1 天（9/23 起）的進階來源；核心來源每天都補
    assert [u.split("date=")[1][:8] for u in sbl] == ["20260924", "20260923"]
    assert sum("MI_INDEX" in u for u in ctx.client.urls) == 4  # type: ignore[attr-defined]


def test_backfill_skips_finished_months(tmp_path):
    ctx = make_ctx(tmp_path, {"TWT49U": sample("twse_rwd_TWT49U.json")}, now=datetime(2026, 9, 26, 10, 0, tzinfo=TPE))
    tasks.task_backfill(ctx, ["twse_exright"], date(2026, 6, 1), date(2026, 9, 25))
    first = len(ctx.client.urls)  # type: ignore[attr-defined]
    assert first == 4
    assert ctx.manifest["backfilled"]["twse_exright"] == ["2026-06", "2026-07"]  # 近兩個月不標記完成
    tasks.task_backfill(ctx, ["twse_exright"], date(2026, 6, 1), date(2026, 9, 25))
    again = ctx.client.urls[first:]  # type: ignore[attr-defined]
    assert len(again) == 2 and all("startDate=202608" in u or "startDate=202609" in u for u in again)


@pytest.mark.parametrize("hour,expected", [(10, date(2026, 9, 23)), (18, date(2026, 9, 24))])
def test_target_trading_date(tmp_path, hour, expected):
    ctx = make_ctx(tmp_path, {}, now=datetime(2026, 9, 24, hour, 0, tzinfo=TPE))
    assert tasks.target_trading_date(ctx) == expected


def test_target_skips_holiday(tmp_path):
    ctx = make_ctx(tmp_path, {}, now=datetime(2026, 9, 26, 12, 0, tzinfo=TPE))  # 週六；9/25 中秋
    assert tasks.target_trading_date(ctx) == date(2026, 9, 24)


def test_old_format_parses_and_records_format_warning(tmp_path):
    """上櫃本益比舊格式（無「財報年/季」）：照常寫入，manifest 記錄格式變動警告；新格式成功後清除。"""
    ctx = make_ctx(tmp_path, {"peQryDate?date=2024": sample("tpex_pe_hist.json"), "peQryDate": sample("tpex_pe.json")})
    spec = SPECS["tpex_valuation"].__class__(**{**SPECS["tpex_valuation"].__dict__, "min_rows": 10})
    assert tasks.run_daily_source(ctx, spec, date(2024, 1, 2)) == "ok"
    entry = ctx.manifest["sources"]["tpex_valuation"]
    assert entry["last_status"] == "ok"
    assert any("財報年/季" in w for w in entry["format_warnings"])
    assert "tpex_valuation" in tasks.append_run(ctx, "backfill")["format_warnings"]
    df = ctx.store.read("tpex_valuation", date(2024, 1, 2))
    assert df is not None and len(df) == 31
    assert tasks.run_daily_source(ctx, spec, date(2026, 9, 24)) == "ok"
    assert "format_warnings" not in entry
