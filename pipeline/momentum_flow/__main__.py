"""`python -m pipeline.momentum_flow update --data-dir data`：計算動能流程，寫快照與前端 JSON 到資料分支的 momentum_flow/。

每日排程在既有步驟之後追加呼叫（data.yml，continue-on-error）；失敗只影響本功能的輸出。
- update：載入資料（唯讀）、計算全部面板，補寫缺少的快照（最近 --years 年）、寫 web/latest.json 與 web/history.json。
  --max-minutes 到了就停（下一次接著補）；--refresh 重寫已存在的快照；最近 rewrite_recent_days 個交易日每次都重算。
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path
from typing import Any

from pipeline.momentum_flow import backtest, candidates, data, market_state, signals, snapshots, web_out
from pipeline.momentum_flow import checklist as ck
from pipeline.momentum_flow.params import PARAMS

log = logging.getLogger("pipeline.momentum_flow")
OUT_DIR = "momentum_flow"


def days_to_write(dates: list[str], have: set[str], start: str, recent_n: int) -> list[int]:
    """要寫的快照：窗口內還沒有的日子，加上最近 recent_n 個交易日（收盤後陸續補進的資料，每次重算）。"""
    recent = set(dates[-recent_n:]) if recent_n > 0 else set()
    return [i for i, d in enumerate(dates) if d >= start and (d not in have or d in recent)]


def run_update(data_dir: Path, out: Path, years: int, max_minutes: float, refresh: bool) -> dict[str, Any]:
    t0 = time.monotonic()
    fd = data.load(data_dir)
    log.info("載入 %d 個交易日、%d 檔（%.0f 秒）", fd.T, fd.C, time.monotonic() - t0)
    sig = signals.compute(fd)
    P = ck.compute(fd, sig)
    mk = market_state.compute(fd.dates, fd.taiex)
    T = fd.T - 1
    log.info("面板計算完成（%.0f 秒）；T＝%s 狀態 %s", time.monotonic() - t0, fd.dates[T], mk["state"])
    have = set() if refresh else snapshots.existing_days(out)
    start = f"{int(fd.dates[T][:4]) - years}{fd.dates[T][4:]}"
    todo = days_to_write(fd.dates, have, start, int(PARAMS["rewrite_recent_days"]))
    written = 0
    stopped = False
    for i in todo:
        if (time.monotonic() - t0) / 60 > max_minutes:
            stopped = True
            break
        rows = candidates.day_rows(fd, P, i)
        state = int(mk["_eff"][i]) or None
        snapshots.write_snapshot(
            out,
            {
                "date": fd.dates[i],
                "state": state,
                "raw": int(mk["_raw"][i]) or None,
                "exposure": market_state.exposure_cap(state or 0),
                "rows": rows,
            },
        )
        written += 1
    latest = web_out.latest_payload(fd, P, sig, mk, T)
    web_out.write_json(out, "latest.json", latest)
    web_out.write_json(out, "history.json", {"date": fd.dates[T], "cols": mk["history_cols"], "rows": mk["history"]})
    bt_ok = False
    try:
        first = next(i for i, d in enumerate(fd.dates) if d >= start)
        bt = backtest.run(fd, P, mk["_eff"], first, T)
        bt["generated"] = latest["generated"]
        web_out.write_json(out, "backtest.json", bt)
        bt_ok = True
        log.info("回測完成（%.0f 秒）：%s", time.monotonic() - t0, bt["summary"])
    except Exception:  # 回測失敗不影響快照與 latest.json
        log.exception("回測失敗")
    summary = {
        "date": fd.dates[T],
        "state": mk["state"],
        "exposure": mk["exposure"],
        "candidates": latest["candidates"],
        "pass": latest["funnel"]["pass"],
        "snapshots_written": written,
        "snapshots_pending": len(todo) - written,
        "stopped_by_time": stopped,
        "backtest_ok": bt_ok,
        "seconds": round(time.monotonic() - t0),
    }
    web_out.write_json(
        out, "status.json", {**summary, "generated": latest["generated"], "params_version": PARAMS.get("version", 1)}
    )
    log.info("完成：%s", summary)
    return summary


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(prog="python -m pipeline.momentum_flow")
    sub = ap.add_subparsers(dest="cmd", required=True)
    up = sub.add_parser("update", help="計算並寫出快照與前端 JSON")
    up.add_argument("--data-dir", default="data")
    up.add_argument("--out", default=None, help="輸出目錄（預設 <data-dir>/momentum_flow）")
    up.add_argument("--years", type=int, default=3)
    up.add_argument("--max-minutes", type=float, default=25)
    up.add_argument("--refresh", action="store_true")
    args = ap.parse_args(argv)
    data_dir = Path(args.data_dir)
    out = Path(args.out) if args.out else data_dir / OUT_DIR
    if args.cmd == "update":
        run_update(data_dir, out, args.years, args.max_minutes, args.refresh)
    return 0


if __name__ == "__main__":
    sys.exit(main())
