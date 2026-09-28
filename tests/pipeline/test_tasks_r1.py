"""第 1 輪健檢修正 M3 的任務層回歸測試（docs/BACKLOG.md D-03、D-04、E-07、E-09、Q-08、D-07、D-08、D-09、E-06）。"""

from __future__ import annotations

from datetime import date, datetime

from pipeline import tasks_advanced
from pipeline.core.dates import TPE
from tests.pipeline.conftest import sample
from tests.pipeline.test_tasks import make_ctx

HTML = b"<html><body>error</body></html>"


def _taifex_routes(tmf: bytes = HTML) -> dict[str, bytes | Exception]:
    # FakeClient 依網址子字串比對：POST 表單會接在網址後面
    return {
        "commodityId=TXF": sample("taifex_futContractsDate_TXF.csv"),
        "commodityId=MXF": sample("taifex_futContractsDate_MXF.csv"),
        "commodityId=TMF": tmf,
        "commodity_id=TMF": sample("taifex_futDataDown_TMF.csv"),
        "commodity_id=MTX": sample("taifex_futDataDown_MTX.csv"),
        "commodity_id=TX&": sample("taifex_futDataDown_MTX.csv"),
        "dailyFXRateDown": sample("taifex_dailyFXRate.csv"),
    }


def test_taifex_one_commodity_failure_keeps_others(tmp_path):
    """D-03：TMF 失敗時，同月已抓到的 TXF、MXF 仍然保存；manifest 記失敗並說明。"""
    ctx = make_ctx(tmp_path, _taifex_routes())
    tasks_advanced.run_taifex(ctx, date(2026, 9, 1), date(2026, 9, 24))
    saved = ctx.store.read("taifex_insti", date(2026, 9, 1))
    assert saved is not None and {"TXF", "MXF"} <= set(saved["contract"])
    entry = ctx.manifest["sources"]["taifex_insti"]
    assert (
        entry["last_status"] == "failed"
        and "TMF" in entry["last_message"]
        and "已保存其他商品" in entry["last_message"]
    )


def test_taifex_skips_commodity_before_listing(tmp_path):
    """D-03：2024-06 以前 TMF 尚未上市 → 不查詢 TMF，TXF、MXF 記為 ok。"""
    ctx = make_ctx(tmp_path, _taifex_routes(), now=datetime(2026, 9, 24, 21, 0, tzinfo=TPE))
    tasks_advanced.run_taifex(ctx, date(2024, 6, 1), date(2024, 6, 30))
    assert not any("commodityId=TMF" in u or "commodity_id=TMF" in u for u in ctx.client.urls)  # type: ignore[attr-defined]
    assert any("commodityId=TXF" in u for u in ctx.client.urls)  # type: ignore[attr-defined]
    assert ctx.manifest["sources"]["taifex_insti"]["last_status"] == "ok"


def test_taifex_query_end_clamped_to_latest_trading_day(tmp_path):
    """E-07：9/25 中秋休市當天執行、迄日＝今天 → 查詢迄日夾到 9/24。"""
    ctx = make_ctx(
        tmp_path,
        _taifex_routes(sample("taifex_futContractsDate_TMF.csv")),
        now=datetime(2026, 9, 25, 18, 0, tzinfo=TPE),
    )
    tasks_advanced.run_taifex(ctx, date(2026, 9, 15), date(2026, 9, 25))
    posts = [u for u in ctx.client.urls if "futContractsDateDown" in u]  # type: ignore[attr-defined]
    assert posts and all("queryEndDate=2026/09/24" in u for u in posts)


def test_range_source_last_success_is_data_date(tmp_path):
    """Q-08：區間型來源（期交所、匯率）的最後成功日是實際資料的最新日期，不是查詢迄日。"""
    ctx = make_ctx(tmp_path, _taifex_routes(sample("taifex_futContractsDate_TMF.csv")))
    tasks_advanced.run_taifex(ctx, date(2026, 9, 1), date(2026, 9, 30))
    fx = ctx.store.read("fx_usdtwd", date(2026, 9, 1))
    assert fx is not None
    assert ctx.manifest["sources"]["fx_usdtwd"]["last_success"] == str(fx["date"].max())
    assert ctx.manifest["sources"]["fx_usdtwd"]["last_success"] <= "2026-09-24"


def test_taifex_zero_rows_is_failure(tmp_path):
    """D-04：區間內有交易日，但期交所回傳只有標題、0 筆 → 記為失敗，不是 ok。"""
    header_only = sample("taifex_futContractsDate_TXF.csv").split(b"\n")[0] + b"\n"
    routes = _taifex_routes(header_only)
    routes["commodityId=TXF"] = header_only
    routes["commodityId=MXF"] = header_only
    ctx = make_ctx(tmp_path, routes)
    tasks_advanced.run_taifex(ctx, date(2026, 9, 1), date(2026, 9, 24))
    entry = ctx.manifest["sources"]["taifex_insti"]
    assert entry["last_status"] == "failed" and "查無資料" in entry["last_message"]
    assert entry.get("last_success") is None


def test_typhoon_closure_requires_both_markets(tmp_path):
    """Q-08：證交所沒有行情、但櫃買有 → 不是休市（不寫入 closed_days，記為失敗稍後重試）。"""
    from pipeline import tasks
    from pipeline.registry import SPECS

    ctx = make_ctx(tmp_path, {"dailyQuotes": sample("tpex_dailyQuotes.json")})
    assert tasks.run_daily_source(ctx, SPECS["twse_quotes"], date(2026, 9, 24)) == "failed"
    assert "2026-09-24" not in ctx.manifest.get("closed_days", [])
    assert "櫃買" in ctx.manifest["sources"]["twse_quotes"]["last_message"]
    # 兩個市場都沒有 → 臨時休市
    ctx2 = make_ctx(tmp_path / "b", {})
    assert tasks.run_daily_source(ctx2, SPECS["twse_quotes"], date(2026, 9, 23)) == "closed"


def test_old_format_warning_from_backfill_is_not_compat_mode(tmp_path):
    """Q-08：回補 2024 年舊格式留下的警告，不讓資料健康頁誤報「相容模式」。"""
    from pipeline.core.store import record
    from pipeline.derive.export import stale_warning

    m: dict = {}
    record(m, "tpex_valuation", status="ok", data_date=date(2026, 9, 24), rows=10, format_warnings=[])
    record(
        m, "tpex_valuation", status="ok", data_date=date(2024, 4, 1), rows=10, format_warnings=["缺少欄位「財報年/季」"]
    )
    assert "format_warnings" not in m["sources"]["tpex_valuation"]
    # 既有 manifest 已經留下的舊警告：build 時視為過期
    assert stale_warning({"format_warning_date": "2024-04-01", "last_success": "2026-09-24"})
    assert not stale_warning({"format_warning_date": "2026-09-24", "last_success": "2026-09-24"})
    # 最新日期的警告照常記錄
    record(m, "tpex_valuation", status="ok", data_date=date(2026, 9, 25), rows=10, format_warnings=["缺少欄位「x」"])
    assert m["sources"]["tpex_valuation"]["format_warnings"] == ["缺少欄位「x」"]


MOPS_EMPTY = "<html><body><b>上市公司 115 年 9 月份 營業收入統計表</b><br><font>查無資料</font></body></html>".encode(
    "cp950"
)


def test_mops_revenue_not_yet_published_is_not_ok(tmp_path):
    """D-04：MOPS 對未公布月份回「查無資料」（標題仍在）→ 期限前記 pending、期限後記失敗，都不是 ok 0 筆。"""
    from pipeline import tasks

    ctx = make_ctx(tmp_path, {"t21sc03": MOPS_EMPTY}, now=datetime(2026, 9, 28, 21, 0, tzinfo=TPE))
    assert tasks.run_mops_revenue(ctx, date(2026, 9, 1)) == "pending"
    entry = ctx.manifest["sources"]["mops_revenue"]
    assert (
        entry["last_status"] == "pending" and entry.get("last_success") is None and "查無資料" in entry["last_message"]
    )
    ctx2 = make_ctx(tmp_path / "b", {"t21sc03": MOPS_EMPTY}, now=datetime(2026, 10, 20, 21, 0, tzinfo=TPE))
    assert tasks.run_mops_revenue(ctx2, date(2026, 9, 1)) == "failed"


def test_backfill_skips_months_before_revenue_deadline(tmp_path):
    """D-04：回補月份清單不含還沒到公布期限（次月 10 日）的月份。"""
    from pipeline import tasks

    ctx = make_ctx(tmp_path, {"t21sc03": MOPS_EMPTY}, now=datetime(2026, 9, 28, 21, 0, tzinfo=TPE))
    tasks.task_backfill(ctx, ["mops_revenue"], date(2026, 8, 1), date(2026, 9, 28))
    asked = [u for u in ctx.client.urls if "t21sc03" in u]  # type: ignore[attr-defined]
    assert asked and not any("_115_9_" in u for u in asked)  # 9 月（10/10 才到期）不查
    assert any("_115_8_" in u for u in asked)
    assert tasks.revenue_deadline(date(2026, 9, 1)) == date(2026, 10, 10)


def test_unexpected_parser_error_does_not_abort_daily(tmp_path):
    """D-02：解析器丟出非 ParseError 的例外（例：KeyError）→ 只記該來源失敗（訊息標「格式不符」），其他來源照常執行。"""
    from pipeline import tasks
    from pipeline.registry import SPECS

    def broken(_raw):
        raise KeyError("身份別")

    ctx = make_ctx(tmp_path, {"MI_INDEX": sample("twse_rwd_MI_INDEX_ALL.json"), "T86": sample("twse_rwd_T86.json")})
    bad = SPECS["twse_margin"].__class__(**{**SPECS["twse_margin"].__dict__, "parse": broken})
    assert tasks.run_daily_source(ctx, bad, date(2026, 9, 24)) == "failed"
    msg = ctx.manifest["sources"]["twse_margin"]["last_message"]
    assert msg.startswith("格式不符（KeyError）")
    insti = SPECS["twse_insti"].__class__(**{**SPECS["twse_insti"].__dict__, "min_rows": 10})
    assert tasks.run_daily_source(ctx, insti, date(2026, 9, 24)) == "ok"


def test_revenue_effective_date_capped_at_deadline():
    """D-07：first_seen 晚於法定期限（pipeline 9/27 才開始運作）→ 生效日取次月 10 日；更早看到則用 first_seen。"""
    from pipeline.derive.metrics import effective_date_for_month

    assert effective_date_for_month("2026-08", "2026-09-27", 10) == "2026-09-10"
    assert effective_date_for_month("2026-08", "2026-09-05", 10) == "2026-09-05"
    assert effective_date_for_month("2026-12", None, 10) == "2027-01-10"


def _demo(tmp_path, days: int = 80):
    from pipeline.core.store import DataStore
    from pipeline.derive.demo import build_store

    build_store(tmp_path / "data", days=days)
    return DataStore(tmp_path / "data")


def test_market_flows_none_when_insti_missing_and_breadth_uses_official_change(tmp_path):
    """D-08：當天法人資料整批缺漏 → 資金流為 None（畫面「—」），不是 0 億。
    D-09：漲跌家數用官方漲跌：除息日收盤低於前收、但相對參考價上漲 → 算上漲。"""
    import json

    from pipeline.derive.export import build_web

    store = _demo(tmp_path)
    days = store.dates("twse_quotes")
    last = days[-1]
    for sid in ("twse_insti", "tpex_insti"):
        store.path(sid, last).unlink()
    q = store.read("twse_quotes", last)
    prev = store.read("twse_quotes", days[-2]).set_index("code")["close"]
    q.loc[q["code"] == "1101", "close"] = float(prev["1101"]) - 1.0  # 收盤低於前收
    q.loc[q["code"] == "1101", "change"] = 0.5  # 官方漲跌（相對除息參考價）為上漲
    store.write("twse_quotes", last, q)
    build_web(tmp_path / "data", tmp_path / "out", demo=True)
    market = json.loads((tmp_path / "out" / "market.json").read_text())
    assert market["flows"][-1]["foreign"] is None and market["flows"][-1]["trust"] is None
    assert market["flows"][-2]["foreign"] is not None
    allq = [store.read("twse_quotes", last), store.read("tpex_quotes", last)]
    ups = sum(int((df["change"] > 0).sum()) for df in allq)
    assert market["breadth"]["up"] == ups


def test_digest_not_resent_on_holiday():
    """E-06：9/25、9/28 休市的最後一次執行，資料日期仍是 9/24 → 不推播；同一交易日也只推一次。"""
    from pipeline.cli import should_send_digest

    assert should_send_digest("2026-09-24", "2026-09-24", None)
    assert not should_send_digest("2026-09-24", "2026-09-25", "2026-09-24")
    assert not should_send_digest("2026-09-24", "2026-09-28", None)
    assert not should_send_digest("2026-09-24", "2026-09-24", "2026-09-24")
    assert not should_send_digest(None, "2026-09-24", None)
