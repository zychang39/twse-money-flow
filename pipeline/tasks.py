"""任務編排：daily（每日）、periodic（週／月／季）、backfill（回補）。

原則：
- 依序請求（PoliteClient 控制間隔與重試）；某來源失敗不影響其他來源。
- 驗證失敗時不覆蓋上一份好資料，並記錄在 manifest。
- 所有結果寫入 manifest.json（data 分支），供資料健康頁與 Issue 通報使用。
"""

from __future__ import annotations

import hashlib
import logging
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

import pandas as pd

from pipeline.core import config
from pipeline.core.calendar import TradingCalendar
from pipeline.core.dates import TPE, month_start, next_month, now_tpe, parse_date, prev_month
from pipeline.core.http import CircuitOpenError, FetchError, PoliteClient
from pipeline.core.store import DataStore, record
from pipeline.core.validate import validate_frame
from pipeline.registry import (
    ADVANCED_BACKFILL_DAYS,
    ADVANCED_DAILY,
    ADVANCED_SNAPSHOT,
    BACKFILL_FULL,
    CORE_DAILY,
    CORE_RANGE,
    CORE_SNAPSHOT,
    CUSTOM_BACKFILL,
    SPECS,
    Spec,
    build_url,
    mops_revenue_url,
    parse_mops,
)
from pipeline.sources.base import ParseError, ParseResult, drain_format_warnings

log = logging.getLogger(__name__)


@dataclass
class RunContext:
    store: DataStore
    client: PoliteClient
    now: datetime = field(default_factory=now_tpe)
    manifest: dict[str, Any] = field(default_factory=dict)
    calendar: TradingCalendar = field(default_factory=TradingCalendar)
    results: list[dict[str, Any]] = field(default_factory=list)
    deadline: float | None = None
    format_warnings: dict[str, list[str]] = field(default_factory=dict)

    @property
    def today(self) -> date:
        return self.now.date()

    @property
    def is_final_run(self) -> bool:
        """台北時間 20:30 之後的執行視為當日最後一次，未公布的資料記為失敗。"""
        return self.now.hour * 60 + self.now.minute >= 20 * 60 + 30

    def out_of_time(self) -> bool:
        return self.deadline is not None and time.monotonic() > self.deadline

    def note(
        self, source: str, status: str, *, data_date: date | None = None, rows: int | None = None, message: str = ""
    ) -> None:
        warnings = drain_format_warnings()
        record(
            self.manifest,
            source,
            status=status,
            data_date=data_date,
            rows=rows,
            message=message or None,
            format_warnings=warnings,
        )
        if warnings:
            self.format_warnings.setdefault(source, [])
            self.format_warnings[source] += [w for w in warnings if w not in self.format_warnings[source]]
        self.results.append(
            {
                "source": source,
                "status": status,
                "date": data_date.isoformat() if data_date else None,
                "rows": rows,
                "message": message,
            }
        )
        level = logging.WARNING if status == "failed" else logging.INFO
        log.log(
            level, "%-22s %-8s %s %s %s", source, status, data_date or "", rows if rows is not None else "", message
        )

    @property
    def failures(self) -> list[dict[str, Any]]:
        return [r for r in self.results if r["status"] == "failed"]


# ------------------------------------------------------------------ 共用
def _fetch(ctx: RunContext, url: str, *, method: str = "GET", form: dict[str, str] | None = None) -> bytes:
    if method == "POST":
        return ctx.client.post_bytes(url, form or {})
    return ctx.client.get_bytes(url)


def _prev_rows(ctx: RunContext, source: str, before: date) -> int | None:
    latest = ctx.store.latest(source, before=before)
    return len(latest[1]) if latest else None


def _month_key(d: date) -> date:
    return month_start(d)


def load_calendar(ctx: RunContext, years: list[int] | None = None, *, fetch_missing: bool = True) -> TradingCalendar:
    years = years or [ctx.today.year]
    frames = []
    for y in sorted(set(years)):
        key = date(y, 1, 1)
        df = ctx.store.read("twse_holidays", key)
        if (df is None or df.empty) and fetch_missing:
            try:
                raw = _fetch(ctx, build_url("twse_holidays", key))
                res = SPECS["twse_holidays"].parse(raw)
                if not res.df.empty:
                    ctx.store.write("twse_holidays", key, res.df)
                    ctx.note("twse_holidays", "ok", data_date=key, rows=len(res.df))
                    df = res.df
            except (FetchError, ParseError) as exc:
                ctx.note("twse_holidays", "failed", data_date=key, message=str(exc))
        if df is not None:
            frames.append(df)
    ctx.calendar = TradingCalendar.from_frames(frames, ctx.manifest.get("closed_days", []))
    return ctx.calendar


def target_trading_date(ctx: RunContext) -> date:
    """最近一個已收盤的交易日（台北 14:00 前視為前一交易日）。"""
    cal = ctx.calendar
    if cal.is_trading_day(ctx.today) and ctx.now.hour >= 14:
        return ctx.today
    return cal.previous(ctx.today)


# ------------------------------------------------------------------ 每日型
def run_daily_source(ctx: RunContext, spec: Spec, d: date, *, overwrite: bool = False) -> str:
    """抓取並驗證單一交易日。回傳狀態：ok / exists / no_data / pending / failed / closed。"""
    if ctx.store.exists(spec.id, d) and not overwrite:
        return "exists"
    try:
        raw = _fetch(ctx, build_url(spec.id, d))
        res: ParseResult = spec.parse(raw)
    except (FetchError, ParseError) as exc:
        ctx.note(spec.id, "failed", data_date=d, message=str(exc)[:300])
        return "failed"
    if res.no_data:
        if spec.min_rows == 0:
            res.df["date"] = d.isoformat()
            ctx.store.write(spec.id, d, res.df)
            ctx.note(spec.id, "ok", data_date=d, rows=0, message="無資料（清單為空）")
            return "ok"
        if spec.id == "twse_quotes" and (d < ctx.today or ctx.now.hour >= 16):
            closed = set(ctx.manifest.setdefault("closed_days", []))
            closed.add(d.isoformat())
            ctx.manifest["closed_days"] = sorted(closed)
            ctx.calendar.closed.add(d)
            ctx.note(spec.id, "no_data", data_date=d, message="交易日無行情資料，視為臨時休市（如颱風假）")
            return "closed"
        late = d < ctx.calendar.previous(ctx.today) or (ctx.is_final_run and d <= ctx.today)
        status = "failed" if late else "pending"
        ctx.note(spec.id, status, data_date=d, message=f"尚未公布或無資料：{res.message}")
        return status
    tol = float(config.thresholds()["validation"]["row_change_tolerance"])
    ratio = float(config.thresholds()["validation"]["min_parse_ratio"])
    check = validate_frame(
        res.df,
        request_date=d,
        response_date=res.response_date,
        key_cols=spec.keys,
        numeric_cols=spec.numeric,
        prev_rows=_prev_rows(ctx, spec.id, d),
        tolerance=tol,
        min_parse_ratio=ratio,
        min_rows=spec.min_rows,
    )
    if not check.ok:
        ctx.note(spec.id, "failed", data_date=d, rows=len(res.df), message="驗證失敗：" + check.summary())
        return "failed"
    ctx.store.write(spec.id, d, res.df)
    ctx.note(spec.id, "ok", data_date=d, rows=len(res.df))
    for extra_id, extra_df in res.extras.items():
        if extra_df is not None and not extra_df.empty:
            ctx.store.write(extra_id, d, extra_df)
            ctx.note(extra_id, "ok", data_date=d, rows=len(extra_df))
    return "ok"


# ------------------------------------------------------------------ 區間型（事件，依月存檔）
def run_range_source(ctx: RunContext, spec: Spec, start: date, end: date) -> str:
    try:
        raw = _fetch(ctx, build_url(spec.id, start=start, end=end))
        res = spec.parse(raw)
    except (FetchError, ParseError) as exc:
        ctx.note(spec.id, "failed", data_date=end, message=str(exc)[:300])
        return "failed"
    df = res.df
    if not df.empty:
        dup = int(df.duplicated(subset=list(spec.keys)).sum())
        if dup:
            df = df.drop_duplicates(subset=list(spec.keys), keep="last")
        dates = pd.to_datetime(df[spec.date_col], errors="coerce")
        df = df[dates.notna()]
        for key, part in df.groupby(pd.to_datetime(df[spec.date_col]).dt.to_period("M")):
            ctx.store.upsert(spec.id, key.to_timestamp().date(), part.reset_index(drop=True), spec.keys)
    covered = ctx.manifest.setdefault("coverage", {}).setdefault(spec.id, {})
    if not covered.get("start") or start.isoformat() < covered["start"]:
        covered["start"] = start.isoformat()
    if not covered.get("end") or end.isoformat() > covered["end"]:
        covered["end"] = end.isoformat()
    ctx.note(spec.id, "ok", data_date=end, rows=len(df))
    return "ok"


# ------------------------------------------------------------------ 月查詢型
def run_month_query(ctx: RunContext, spec: Spec, month: date) -> str:
    try:
        raw = _fetch(ctx, build_url(spec.id, month))
        res = spec.parse(raw)
    except (FetchError, ParseError) as exc:
        ctx.note(spec.id, "failed", data_date=month, message=str(exc)[:300])
        return "failed"
    if res.df.empty:
        ctx.note(spec.id, "no_data", data_date=month)
        return "no_data"
    ctx.store.upsert(spec.id, month_start(month), res.df, spec.keys)
    last = parse_date(res.df[spec.date_col].max())
    ctx.note(spec.id, "ok", data_date=last, rows=len(res.df))
    return "ok"


# ------------------------------------------------------------------ 快照型
def _digest(df: pd.DataFrame) -> str:
    return hashlib.sha1(df.to_csv(index=False).encode("utf-8")).hexdigest()


def run_snapshot(ctx: RunContext, spec: Spec, key_date: date) -> str:
    try:
        raw = _fetch(ctx, build_url(spec.id))
        res = spec.parse(raw)
    except (FetchError, ParseError) as exc:
        ctx.note(spec.id, "failed", data_date=key_date, message=str(exc)[:300])
        return "failed"
    df = res.df
    if len(df) < spec.min_rows:
        ctx.note(spec.id, "failed", data_date=key_date, rows=len(df), message=f"筆數 {len(df)} 少於 {spec.min_rows}")
        return "failed"
    if spec.id in ("twse_revenue", "tpex_revenue"):
        merge_revenue(ctx.store, df, seen=ctx.today)
        ctx.note(spec.id, "ok", data_date=key_date, rows=len(df))
        return "ok"
    latest = ctx.store.latest(spec.id)
    if latest is not None and _digest(latest[1].astype(str)) == _digest(df.astype(str)):
        ctx.note(spec.id, "ok", data_date=key_date, rows=len(df), message="內容未變動")
        return "ok"
    ctx.store.write(spec.id, key_date, df)
    ctx.note(spec.id, "ok", data_date=key_date, rows=len(df))
    return "ok"


def merge_revenue(store: DataStore, df: pd.DataFrame, *, seen: date | None) -> int:
    """合併月營收到 revenue/{YYYY}/{YYYYMM}01.csv.gz；首次出現日期（first_seen）作為公布日。"""
    if df.empty:
        return 0
    df = df.copy()
    df["first_seen"] = seen.isoformat() if seen else None
    written = 0
    for ym, part in df.groupby("ym"):
        key = date(int(str(ym)[:4]), int(str(ym)[5:7]), 1)
        old = store.read("revenue", key)
        if old is not None and not old.empty:
            keep = old.set_index("code")["first_seen"].dropna().to_dict()
            part = part.copy()
            part["first_seen"] = [keep.get(c, fs) for c, fs in zip(part["code"], part["first_seen"], strict=True)]
            merged = pd.concat([old, part], ignore_index=True).drop_duplicates(subset=["code"], keep="last")
        else:
            merged = part
        store.write("revenue", key, merged.sort_values("code").reset_index(drop=True))
        written += len(part)
    return written


def run_mops_revenue(ctx: RunContext, month: date) -> str:
    total = 0
    for market in ("twse", "tpex"):
        try:
            raw = _fetch(ctx, mops_revenue_url(market, month))
            res = parse_mops(raw)
        except (FetchError, ParseError) as exc:
            ctx.note("mops_revenue", "failed", data_date=month, message=f"{market}: {exc}"[:300])
            return "failed"
        total += merge_revenue(ctx.store, res.df, seen=None)
    ctx.note("mops_revenue", "ok", data_date=month, rows=total)
    return "ok"


# ------------------------------------------------------------------ 任務
def task_daily(ctx: RunContext, sources: list[str] | None = None, heal_days: int = 5) -> None:
    load_calendar(ctx, [ctx.today.year, (ctx.today - timedelta(days=10)).year])
    target = target_trading_date(ctx)
    ctx.manifest["last_target_date"] = target.isoformat()
    recent = [d for d in ctx.calendar.trading_days(target - timedelta(days=heal_days * 2), target)][-heal_days:]
    wanted = sources or (CORE_DAILY + ADVANCED_DAILY + CORE_RANGE + CORE_SNAPSHOT + ADVANCED_SNAPSHOT + ["tpex_index"])
    # 1) 每日型：收盤行情優先（無行情 → 臨時休市，略過其他來源）
    daily = [s for s in wanted if s in SPECS and SPECS[s].kind == "daily"]
    for d in recent:
        status = run_daily_source(ctx, SPECS["twse_quotes"], d) if "twse_quotes" in daily else "ok"
        if status == "closed":
            continue
        for sid in daily:
            if sid != "twse_quotes":
                run_daily_source(ctx, SPECS[sid], d)
    # 2) 區間型：近 10 天（跨月時依月份拆檔）
    for sid in [s for s in wanted if s in SPECS and SPECS[s].kind == "range"]:
        run_range_source(ctx, SPECS[sid], target - timedelta(days=10), target)
    # 3) 月查詢
    if "tpex_index" in wanted:
        run_month_query(ctx, SPECS["tpex_index"], target)
    # 4) 快照
    for sid in [s for s in wanted if s in SPECS and SPECS[s].kind == "snapshot"]:
        run_snapshot(ctx, SPECS[sid], target)
    # 5) 期交所、匯率、美債（sources 未指定時）
    if not sources:
        from pipeline import tasks_advanced

        tasks_advanced.run_taifex(ctx, target - timedelta(days=10), target)
        tasks_advanced.run_ust(ctx, target.year)
    # 6) 主動式 ETF 持股（各投信官網，部分涵蓋）
    if not sources or "active_etf" in sources:
        from pipeline import tasks_advanced

        tasks_advanced.run_etf_holdings(ctx, target)


def _after_financial_deadline(today: date) -> bool:
    """季報法定期限後的 1–5 天（對應 data.yml 的季報排程）。"""
    for md in config.thresholds()["backtest"]["financial_deadlines"].values():
        m, d = (int(x) for x in str(md).split("-"))
        deadline = date(today.year, m, d)
        if timedelta(days=1) <= today - deadline <= timedelta(days=5):
            return True
    return False


def task_periodic(ctx: RunContext, sources: list[str] | None = None) -> None:
    """依日期決定：每月 11 日（或指定）抓 MOPS 月營收彙總表；其餘週／季任務於 M8 加入。"""
    load_calendar(ctx, [ctx.today.year])
    wanted = set(sources or [])
    if "mops_revenue" in wanted or (not wanted and ctx.today.day >= 11):
        run_mops_revenue(ctx, prev_month(ctx.today))
    if ctx.today.month == 1 or "twse_holidays" in wanted:
        load_calendar(ctx, [ctx.today.year + 1])
    from pipeline import tasks_advanced

    if "tdcc_holders" in wanted or (not wanted and ctx.today.weekday() in (5, 6)):
        tasks_advanced.run_tdcc(ctx)
    if "financials" in wanted or (not wanted and _after_financial_deadline(ctx.today)):
        from pipeline import financials

        financials.run_latest(ctx)
    # 選配：央行貨幣總計數（每週檢查一次，約每月下旬公布上月）、法說會（本月與下月）
    weekly = not wanted and ctx.today.weekday() in (5, 6)
    if "cbc_money" in wanted or weekly:
        tasks_advanced.run_cbc_money(ctx)
    if "investor_conference" in wanted or weekly:
        for m in (month_start(ctx.today), next_month(ctx.today)):
            tasks_advanced.run_conference(ctx, m)


def _months_desc(start: date, end: date) -> list[date]:
    months = []
    m = month_start(end)
    while m >= month_start(start):
        months.append(m)
        m = prev_month(m)
    return months


def _month_done(ctx: RunContext, key: str, m: date) -> bool:
    return m.strftime("%Y-%m") in ctx.manifest.get("backfilled", {}).get(key, [])


def _mark_month(ctx: RunContext, key: str, m: date, failures_before: int) -> None:
    """已結束（早於上個月）且無失敗的月份記為完成，續跑時略過；近兩個月可能仍有更新，不記。"""
    if len(ctx.failures) > failures_before or m >= prev_month(month_start(ctx.today)):
        return
    done = ctx.manifest.setdefault("backfilled", {}).setdefault(key, [])
    ym = m.strftime("%Y-%m")
    if ym not in done:
        done.append(ym)
        done.sort()


def task_backfill(
    ctx: RunContext, sources: list[str] | None, start: date, end: date, *, refresh: bool = False
) -> dict[str, Any]:
    """回補：未指定來源時做完整回補（見 registry.BACKFILL_FULL）。

    順序：區間／月查詢型與期交所等（以月為單位，由近到遠）→ 每日型（由近到遠、一天抓齊所有來源；
    進階每日來源只補近 ADVANCED_BACKFILL_DAYS 天）。可中斷、可續跑：已存在的檔案與已完成的月份略過；
    時間預算用完就停止並回報剩餘量。

    refresh：重抓區間內「已存在」的每日型檔案（解析器新增欄位後補齊舊檔用，例如法人的自營商買賣股數）；
    只在明確指定來源時有效，避免誤觸整批重抓。
    """
    if refresh and not sources:
        raise ValueError("--refresh 需要指定 --source（只重抓指定的每日型來源）")
    full = not sources
    sources = sources or BACKFILL_FULL
    load_calendar(ctx, list(range(start.year, end.year + 1)))
    remaining: dict[str, int] = {}
    months = _months_desc(start, end)
    # 0) 期交所／匯率／美債／財報／央行／法說會（自訂來源）
    custom = [s for s in sources if s in CUSTOM_BACKFILL]
    sources = [s for s in sources if s not in custom]
    if custom:
        from pipeline import tasks_advanced

        if "taifex" in custom:
            for i, m in enumerate(months):
                if ctx.out_of_time():
                    remaining["taifex"] = len(months) - i
                    break
                if _month_done(ctx, "taifex", m):
                    continue
                before = len(ctx.failures)
                tasks_advanced.run_taifex(ctx, max(m, start), min(next_month(m) - timedelta(days=1), end))
                _mark_month(ctx, "taifex", m, before)
        if "ust_10y" in custom and not ctx.out_of_time():
            for y in range(start.year, end.year + 1):
                if y < ctx.today.year and ctx.store.exists("ust_10y", date(y, 1, 1)) and full:
                    continue
                tasks_advanced.run_ust(ctx, y)
        if "financials" in custom and not ctx.out_of_time():
            from pipeline import financials

            financials.run_history(ctx, start, end)
        if "cbc_money" in custom and not ctx.out_of_time():
            tasks_advanced.run_cbc_money(ctx)
        if "tdcc_history" in custom and not ctx.out_of_time():
            tasks_advanced.run_tdcc_history(ctx)
        if "investor_conference" in custom:
            for m in months:
                if not ctx.out_of_time() and not _month_done(ctx, "investor_conference", m):
                    before = len(ctx.failures)
                    tasks_advanced.run_conference(ctx, m)
                    _mark_month(ctx, "investor_conference", m, before)
        if "active_etf" in custom and not ctx.out_of_time():
            days = ctx.calendar.trading_days(start, min(end, ctx.today))[::-1]
            tasks_advanced.run_etf_holdings(ctx, days[0] if days else end, days=days)
    # 1) 非每日型（區間、月查詢、MOPS 月營收）：以月為單位，由近到遠
    for sid in [s for s in sources if s == "mops_revenue" or SPECS[s].kind != "daily"]:
        for i, m in enumerate(months):
            if ctx.out_of_time():
                remaining[sid] = len(months) - i
                break
            if _month_done(ctx, sid, m):
                continue
            before = len(ctx.failures)
            if sid == "mops_revenue":
                run_mops_revenue(ctx, m)
            else:
                spec = SPECS[sid]
                if spec.kind == "range":
                    run_range_source(ctx, spec, max(m, start), min(next_month(m) - timedelta(days=1), end))
                elif spec.kind == "month_query":
                    run_month_query(ctx, spec, m)
            _mark_month(ctx, sid, m, before)
    # 2) 每日型：由近到遠，一天抓齊所有來源（完整回補時，進階來源只補近一段期間）
    daily = [s for s in sources if s != "mops_revenue" and SPECS[s].kind == "daily"]
    if daily:
        adv_from = (end - timedelta(days=ADVANCED_BACKFILL_DAYS)).isoformat() if full else ""

        def wanted(d: date) -> list[str]:
            if d.isoformat() >= adv_from:
                return daily
            return [s for s in daily if s not in ADVANCED_DAILY]

        closed = set(ctx.manifest.get("closed_days", []))
        days = [
            d
            for d in reversed(ctx.calendar.trading_days(start, end))
            if d.isoformat() not in closed and (refresh or any(not ctx.store.exists(s, d) for s in wanted(d)))
        ]
        for i, d in enumerate(days):
            if ctx.out_of_time():
                remaining["daily_days"] = len(days) - i
                break
            todo = wanted(d)
            if "twse_quotes" in todo and run_daily_source(ctx, SPECS["twse_quotes"], d, overwrite=refresh) == "closed":
                continue
            for sid in todo:
                if sid != "twse_quotes":
                    run_daily_source(ctx, SPECS[sid], d, overwrite=refresh)
    progressed = any(r["status"] == "ok" for r in ctx.results)
    return {"remaining": sum(remaining.values()), "by_source": remaining, "progressed": progressed}


def append_run(ctx: RunContext, task: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    summary = {
        "task": task,
        "at": datetime.now(TPE).isoformat(timespec="seconds"),
        "requests": ctx.client.request_count,
        "ok": sum(1 for r in ctx.results if r["status"] == "ok"),
        "failed": [f"{r['source']} {r['date'] or ''} {r['message']}".strip() for r in ctx.failures],
        "pending": [r["source"] for r in ctx.results if r["status"] == "pending"],
        **({"format_warnings": sorted(ctx.format_warnings)} if ctx.format_warnings else {}),
        **(extra or {}),
    }
    runs = ctx.manifest.setdefault("runs", [])
    runs.append(summary)
    ctx.manifest["runs"] = runs[-40:]
    return summary


__all__ = [
    "CircuitOpenError",
    "RunContext",
    "append_run",
    "load_calendar",
    "merge_revenue",
    "run_daily_source",
    "run_range_source",
    "run_snapshot",
    "target_trading_date",
    "task_backfill",
    "task_daily",
    "task_periodic",
]
