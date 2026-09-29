"""公布時間實測（M3.4）：交易日每 5 分鐘探測一次各官方資料是否已公布，記錄第一次看到的時間。

- 只抓取與解析、不寫入資料（不影響每日任務）；每個來源從預估公布時間前 30 分鐘開始探測，看到資料後就停止。
- 結果寫在 data 分支 manifest `publish_probe`（{日期: {來源: "HH:MM"}}）；正式上線後分段更新也會記錄（`publish_times`）。
- GitHub 每個 job 最多約 6 小時：開始太早時先等待（最多 300 分鐘），再觸發下一段接續。
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Any

from pipeline.core.dates import TPE, now_tpe
from pipeline.registry import SPECS, build_url

log = logging.getLogger(__name__)

# 來源 → 預估公布時間（台北，DATA_SOURCES）
EXPECTED = {
    "twse_quotes": "14:00",
    "tpex_quotes": "14:30",
    "twse_valuation": "14:30",
    "tpex_valuation": "14:30",
    "twse_insti": "15:00",
    "tpex_insti": "15:00",
    "twse_qfii": "15:30",
    "tpex_qfii": "15:30",
    "twse_margin": "21:00",
    "tpex_margin": "21:00",
    "twse_sbl": "21:30",
    "tpex_sbl": "21:30",
    "twse_daytrade": "21:00",
    "tpex_daytrade": "21:00",
}
LEAD_MINUTES = 30
INTERVAL = 300
END = "22:45"


def _at(d: date, hm: str) -> datetime:
    h, m = (int(x) for x in hm.split(":"))
    return datetime(d.year, d.month, d.day, h, m, tzinfo=TPE)


def available(ctx: Any, source: str, d: date) -> bool:
    """抓一次、解析；有資料且日期相符 → True。"""
    from pipeline.tasks import SOURCE_ERRORS, _fetch

    try:
        res = SPECS[source].parse(_fetch(ctx, build_url(source, d)))
    except SOURCE_ERRORS:
        return False
    if res.no_data or res.df.empty:
        return False
    rd = getattr(res, "response_date", None)
    return rd is None or rd == d


def probe_day(
    ctx: Any,
    d: date,
    *,
    sleep: Callable[[float], None] = time.sleep,
    now: Callable[[], datetime] = now_tpe,
    deadline: datetime | None = None,
    check: Callable[[Any, str, date], bool] = available,
) -> dict[str, str]:
    """回傳 {來源: 第一次看到的時間 HH:MM}；逐輪探測到 END 或 deadline 為止。"""
    found: dict[str, str] = dict((ctx.manifest.get("publish_probe") or {}).get(d.isoformat(), {}))
    end = min(_at(d, END), deadline) if deadline else _at(d, END)
    while True:
        t = now()
        for src, hm in EXPECTED.items():
            if src in found or t < _at(d, hm) - timedelta(minutes=LEAD_MINUTES):
                continue
            if check(ctx, src, d):
                found[src] = t.strftime("%H:%M")
                log.info("%s 公布：%s", src, found[src])
        ctx.manifest.setdefault("publish_probe", {})[d.isoformat()] = dict(sorted(found.items()))
        if len(found) == len(EXPECTED) or now() + timedelta(seconds=INTERVAL) > end:
            return found
        sleep(INTERVAL)
