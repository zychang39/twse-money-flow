"""分段更新（M3.4）：收盤行情（14:15）→ 法人（15:30）→ 信用（21:30），各自部署。

- 每段抓取 config/schedule.yml 列出的來源；「ready」來源在目標交易日都有檔案才算完成。
- 官方還沒公布時每 5 分鐘重試，最多 60 分鐘（retry.interval_minutes／max_minutes）；逾時記為 late，下一段或下一次執行補抓。
- 公布時間實測：每個來源在這一段第一次看到目標日資料的時間（5 分鐘粒度）記在 manifest `publish_times`，
  資料健康頁與 DATA_SOURCES「公布時間實測」使用。
- 今晚頁狀態列：manifest `stages`（目標日、各段狀態與完成時間）→ meta.json。
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from datetime import datetime
from typing import Any

from pipeline.core import config
from pipeline.core.dates import now_tpe
from pipeline.registry import SPECS

log = logging.getLogger(__name__)

STAGES = ("close", "insti", "credit")
KEEP_PUBLISH = 60  # 每個來源保留最近 60 筆公布時間


def schedule() -> dict[str, Any]:
    return config.load("schedule")


def stage_sources(stage: str) -> list[str] | None:
    """None＝全部每日來源（與原本的每日任務相同）。"""
    src = schedule()["stages"][stage]["sources"]
    return None if src == "all" else [str(s) for s in src]


def record_publish(manifest: dict[str, Any], source: str, target: str, at: datetime) -> None:
    rows = manifest.setdefault("publish_times", {}).setdefault(source, [])
    if any(r.get("date") == target for r in rows):
        return
    rows.append({"date": target, "at": at.strftime("%H:%M")})
    manifest["publish_times"][source] = rows[-KEEP_PUBLISH:]


def set_stage(manifest: dict[str, Any], target: str, stage: str, status: str, at: datetime, waited: int) -> None:
    st = manifest.get("stages") or {}
    if st.get("date") != target:
        st = {"date": target}
    st[stage] = {"status": status, "at": at.strftime("%H:%M"), "waited": waited}
    manifest["stages"] = st


def run_stage(
    ctx: Any,
    stage: str,
    *,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    now: Callable[[], datetime] | None = None,
) -> dict[str, Any]:
    """執行一段；回傳 {stage, status, waited, target}。status：done（ready 來源齊了）／late（重試 60 分鐘仍未公布）。"""
    from pipeline import tasks

    cfg = schedule()
    st = cfg["stages"][stage]
    interval = float(cfg["retry"]["interval_minutes"]) * 60
    limit = float(cfg["retry"]["max_minutes"]) * 60
    sources = stage_sources(stage)
    tasks.load_calendar(ctx, [ctx.today.year])
    target = tasks.target_trading_date(ctx)
    tracked = [s for s in (sources or list(SPECS)) if s in SPECS and SPECS[s].kind == "daily"]
    before = {s for s in tracked if ctx.store.exists(s, target)}
    t0 = clock()
    clock_now = now or now_tpe
    status = "late"
    while True:
        tasks.task_daily(ctx, sources)
        stamp = clock_now()
        for s in tracked:
            if s not in before and ctx.store.exists(s, target):
                record_publish(ctx.manifest, s, target.isoformat(), stamp)
                before.add(s)
        if all(ctx.store.exists(s, target) for s in st["ready"]):
            status = "done"
            break
        if clock() - t0 + interval > limit:
            break
        log.info(
            "%s：%s 尚未公布，%d 分鐘後重試",
            st["label"],
            "、".join(s for s in st["ready"] if not ctx.store.exists(s, target)),
            interval // 60,
        )
        sleep(interval)
    waited = round((clock() - t0) / 60)
    set_stage(ctx.manifest, target.isoformat(), stage, status, clock_now(), waited)
    return {"stage": stage, "status": status, "waited": waited, "target": target.isoformat()}
