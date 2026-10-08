"""資料新鮮度與補抓（2026-10-06；METHODOLOGY §12.1）。

與前端 web/src/lib/freshness.ts 讀同一張表（config/schedule.yml `freshness`）：
- 每個資料集有「預期公布時間」（交易日當天，台北時間，含保守餘裕）。
- D(X)＝最近一個「預期公布時間已經過了」的交易日。資料日 ≥ D(X) 為最新，否則落後。

補抓任務（task=catchup，data.yml 台北 15:15、16:30、22:30 觸發）：
- 每次只抓「依規則應該已公布、但還沒拿到」的資料集（D(X) 與之前 heal_days 個交易日內缺的日子），不看是哪一個排程觸發的。
  10/5 的教訓：GitHub 排程延遲 8 小時以上、甚至整個掉了（15:30、21:30 兩次都沒觸發），而 22:38 才跑的 14:15 那一段
  只抓「收盤行情」段的來源——三大法人、融資融券早已公布卻沒有抓。改成依新鮮度補抓後，任何一次觸發都會把該有的都補齊。
- 補抓後仍有缺漏 → 以 workflow_dispatch 觸發下一次（1 小時後，最多 3 次；dispatch 不像 schedule 會被延遲或丟掉）。
- 每日任務的其他來源（不在新鮮度表上：主動式 ETF 持股、注意／處置、除權息、公司資料、月營收快照、美債）
  在每個時段的第一次補抓一起跑（extras_due；2026-10-08，10/6 起只跑補抓時這些來源停更）。
- 接力（2026-10-07）：每次補抓結束時預約下一次＝今天下一個還沒到的預期公布時間（或重試時間，取早的）；
  10/6、10/7 排程連續延遲 5–7 小時，當天只要有一次觸發，之後就不再依賴排程（plan_next、relay_decision）。
- 每次的結果寫在 manifest `freshness`（缺哪些、第幾次、下次重試時間），資料健康頁與執行摘要看得到；不靜默失敗。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from pipeline.core import config
from pipeline.core.calendar import TradingCalendar

log = logging.getLogger(__name__)

# 以月為單位存檔（upsert）的來源：用檔案內的 date 欄判斷某一天有沒有資料
MONTHLY = {"taifex_insti", "taifex_oi", "tpex_index"}
# 附表（同一個回應順帶存檔）：缺附表時重抓主來源
EXTRA_PARENT = {"twse_index": "twse_quotes"}


def table() -> dict[str, Any]:
    return dict(config.load("schedule")["freshness"])


def datasets() -> dict[str, dict[str, Any]]:
    return dict(table()["datasets"])


def _hm(s: str) -> tuple[int, int]:
    h, m = s.split(":")
    return int(h), int(m)


def due_date(key: str, cal: TradingCalendar, now: datetime) -> date:
    """D(X)：最近一個預期公布時間已過的交易日（now 為台北時間）。"""
    t = _hm(str(datasets()[key]["time"]))
    today = now.date()
    if cal.is_trading_day(today) and (now.hour, now.minute) >= t:
        return today
    return cal.previous(today)


def has_data(store: Any, source: str, d: date) -> bool:
    if source in MONTHLY:
        df = store.read(source, d.replace(day=1))
        return df is not None and not df.empty and "date" in df.columns and d.isoformat() in set(df["date"].astype(str))
    return bool(store.exists(source, d))


@dataclass
class Gap:
    key: str
    label: str
    due: date
    sources: list[str]
    dates: list[date]

    def to_json(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "due": self.due.isoformat(),
            "sources": self.sources,
            "dates": [d.isoformat() for d in self.dates],
        }


def gaps(store: Any, cal: TradingCalendar, now: datetime, heal_days: int = 5) -> list[Gap]:
    """每個資料集：D(X) 與之前 heal_days 個交易日內，哪些來源哪些日子還沒有資料。休市日（含臨時休市）不算缺。"""
    out: list[Gap] = []
    for key, ds in datasets().items():
        due = due_date(key, cal, now)
        days = cal.trading_days(due - timedelta(days=heal_days * 2 + 10), due)[-heal_days:]
        days = [d for d in days if d not in cal.closed]
        missing_src: list[str] = []
        missing_days: set[date] = set()
        for s in ds["sources"]:
            lack = [d for d in days if not has_data(store, str(s), d)]
            if lack:
                missing_src.append(str(s))
                missing_days.update(lack)
        if missing_src:
            out.append(Gap(key, str(ds["label"]), due, missing_src, sorted(missing_days)))
    return out


def run_catchup(ctx: Any, *, attempt: int = 1) -> dict[str, Any]:
    """補抓「應已公布但還沒拿到」的資料集；回傳 {missing_before, missing_after, retry, ...}。"""
    from pipeline import tasks, tasks_advanced
    from pipeline.registry import SPECS

    tasks.load_calendar(ctx, [ctx.today.year, (ctx.today - timedelta(days=20)).year])
    before = gaps(ctx.store, ctx.calendar, ctx.now)
    log.info(
        "補抓：缺 %s", "、".join(f"{g.label}（{','.join(d.isoformat() for d in g.dates)}）" for g in before) or "無"
    )
    # 收盤行情先抓（無行情 → 臨時休市，該日其他來源略過）
    per_day: dict[date, set[str]] = {}
    refetch: dict[date, set[str]] = {}
    taifex: list[date] = []
    months: set[date] = set()
    for g in before:
        for s in g.sources:
            if s in ("taifex_insti", "taifex_oi"):
                taifex += g.dates
            elif s == "tpex_index":
                months.update(d.replace(day=1) for d in g.dates)
            elif s in EXTRA_PARENT:
                for d in g.dates:
                    refetch.setdefault(d, set()).add(EXTRA_PARENT[s])
            elif s in SPECS and SPECS[s].kind == "daily":
                for d in g.dates:
                    per_day.setdefault(d, set()).add(s)
    for d in sorted(set(per_day) | set(refetch)):
        srcs = per_day.get(d, set())
        again = refetch.get(d, set())
        if "twse_quotes" in srcs or "twse_quotes" in again or not ctx.store.exists("twse_quotes", d):
            st = tasks.run_daily_source(ctx, SPECS["twse_quotes"], d, overwrite="twse_quotes" in again)
            if st == "closed":
                continue
        for s in sorted(srcs - {"twse_quotes"}, key=lambda x: (x != "tpex_quotes", x)):
            tasks.run_daily_source(ctx, SPECS[s], d)
        if "twse_intraday_index" in srcs:
            tasks_advanced_fallback(ctx, d)
    for m in sorted(months):
        tasks.run_month_query(ctx, SPECS["tpex_index"], m)
    if taifex:
        tasks_advanced.run_taifex(ctx, min(taifex), max(taifex))
    # 2026-10-08：每日任務的其他來源（主動式 ETF 持股、注意／處置、除權息、公司資料…）每個時段跑一次
    if extras_due(ctx.manifest, ctx.now):
        tasks.task_daily_extras(ctx)
        ctx.manifest["daily_extras"] = {"at": ctx.now.isoformat(timespec="minutes")}
    after = gaps(ctx.store, ctx.calendar, ctx.now)
    cfg = table()["catchup"]
    retry = bool(after) and attempt < int(cfg["max_retries"]) + 1
    fixed = sorted({g.key for g in before} - {g.key for g in after})
    state = {
        "at": ctx.now.isoformat(timespec="minutes"),
        "attempt": attempt,
        "missing": [g.to_json() for g in after],
        "fixed": fixed,
        "next_retry": (ctx.now + timedelta(minutes=int(cfg["retry_minutes"]))).isoformat(timespec="minutes")
        if retry
        else None,
    }
    ctx.manifest["freshness"] = state
    for g in after:
        # 預期時間已過仍沒有資料：記成失敗（執行摘要、資料健康頁看得到），不靜默
        ctx.note(
            g.sources[0],
            "failed" if attempt > int(cfg["max_retries"]) else "pending",
            data_date=g.dates[-1],
            message=f"{g.label}：預期時間已過仍未取得（第 {attempt} 次補抓）",
        )
    sync_stages(ctx)
    return {
        "missing_before": [g.key for g in before],
        "missing_after": [g.key for g in after],
        "fixed": fixed,
        "attempt": attempt,
        "retry": retry,
        "progressed": bool(fixed) or any(r["status"] == "ok" for r in ctx.results),
    }


def tasks_advanced_fallback(ctx: Any, d: date) -> None:
    from pipeline import tasks_kbar

    tasks_kbar.index_fallback(ctx, [d])


def sync_stages(ctx: Any) -> None:
    """舊的分段狀態列（manifest `stages`）跟著實際資料更新：某段的 ready 來源在目標日都有檔案 → done。"""
    from pipeline import stages, tasks

    target = tasks.target_trading_date(ctx)
    for sid, st in config.load("schedule")["stages"].items():
        if all(ctx.store.exists(s, target) for s in st["ready"]):
            cur = (
                (ctx.manifest.get("stages") or {}).get(sid)
                if (ctx.manifest.get("stages") or {}).get("date") == target.isoformat()
                else None
            )
            if not cur or cur.get("status") != "done":
                stages.set_stage(ctx.manifest, target.isoformat(), sid, "done", ctx.now, 0)


def kbar_due(manifest: dict[str, Any], cal: TradingCalendar, now: datetime) -> bool:
    """個股 5 分 K 是否還欠（目標日不是 D(分鐘 K)、或還有剩餘）。"""
    due = due_date("intraday", cal, now).isoformat()
    st = manifest.get("kbar") or {}
    return st.get("target") != due or bool(st.get("remaining"))


def relay_config() -> dict[str, Any]:
    return dict(table()["catchup"].get("relay") or {})


def next_due_at(cal: TradingCalendar, now: datetime) -> datetime | None:
    """今天（交易日）下一個還沒到的預期公布時間＋offset；今天都過了或休市 → None（隔天由排程起跑）。"""
    if not cal.is_trading_day(now.date()):
        return None
    offset = int(relay_config().get("offset_minutes", 2))
    for h, m in sorted({_hm(str(d["time"])) for d in datasets().values()}):
        if (h, m) > (now.hour, now.minute):
            return now.replace(hour=h, minute=m, second=0, microsecond=0) + timedelta(minutes=offset)
    return None


def plan_next(
    now: datetime, attempt: int, retry_at: datetime | None, due_at: datetime | None, max_wait_minutes: int
) -> tuple[datetime, int] | None:
    """下一棒（not_before, attempt）：重試時間與下一個預期公布時間取早的；超過 max_wait 先等到上限（中繼）。

    有重試時 attempt＋1（就算先醒來的是下一個公布時間，也照算重試次數，第 4 次仍記 failed）；沒有重試從 1 起算。
    """
    cands = [t for t in (retry_at, due_at) if t is not None]
    if not cands:
        return None
    target = min(cands)
    cap = now + timedelta(minutes=max_wait_minutes)
    return min(target, cap).replace(second=0, microsecond=0), attempt + 1 if retry_at is not None else 1


def relay_decision(target: datetime, alive: list[tuple[int, datetime]]) -> tuple[bool, list[int]]:
    """（要不要觸發, 要取消的 run id）。已有不晚於 target 的接力在等 → 不觸發；只有比 target 晚的 → 取消它們再觸發
    （同一個 data-retry 群組一次只跑一個，晚的那棒在睡就會擋住早的）。"""
    if any(nb <= target for _, nb in alive):
        return False, []
    return True, [rid for rid, _ in alive]


def extras_due(manifest: dict[str, Any], now: datetime) -> bool:
    """每日任務的其他來源是否該跑：上次跑在最近一個時段起點之前（時段起點＝extras_start 與各資料集的預期公布時間；
    同一時段內的重試、中繼不重跑）。"""
    last = (manifest.get("daily_extras") or {}).get("at")
    if not last:
        return True
    marks = sorted(
        {_hm(str(table()["catchup"].get("extras_start", "08:00")))} | {_hm(str(d["time"])) for d in datasets().values()}
    )
    today = [now.replace(hour=h, minute=m, second=0, microsecond=0) for h, m in marks]
    passed = [t for t in today if t <= now]
    start = passed[-1] if passed else today[-1] - timedelta(days=1)
    return datetime.fromisoformat(str(last)) < start
