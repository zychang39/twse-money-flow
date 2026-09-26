"""命令列入口：python -m pipeline <command>。

Workflow YAML 只呼叫這些指令；排程與任務邏輯都在這裡，改功能不必改 YAML。
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import date
from pathlib import Path

from pipeline.core.dates import now_tpe, parse_date
from pipeline.core.http import PoliteClient
from pipeline.core.store import DataStore

log = logging.getLogger("pipeline")

# 排程字串 → 任務（與 .github/workflows/data.yml 的 cron 對應）
SCHEDULE_TASKS = {
    "30 9 * * 1-5": "daily",
    "30 13 * * 1-5": "daily",
    "0 2 * * 6": "periodic",
    "0 3 11 * *": "periodic",
    "0 3 16 5,8,11 *": "periodic",
    "0 3 1 4 *": "periodic",
    "*/15 1-5 * * 1-5": "alerts",
}


def _gh_output(**values: object) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    lines = [f"{k}={v}" for k, v in values.items()]
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    for line in lines:
        print(line)


def _date(value: str | None) -> date | None:
    return parse_date(value) if value else None


def cmd_run(args: argparse.Namespace) -> int:
    from pipeline import tasks

    task = args.task or SCHEDULE_TASKS.get((args.schedule or "").strip(), "daily")
    sources = [s.strip() for s in (args.source or "").split(",") if s.strip()] or None
    store = DataStore(args.data_dir)
    ctx = tasks.RunContext(store=store, client=PoliteClient.from_config())
    ctx.manifest = store.load_manifest()
    if args.max_minutes:
        ctx.deadline = time.monotonic() + float(args.max_minutes) * 60
    extra: dict[str, object] = {}
    deploy = "false"
    try:
        if task == "daily":
            tasks.task_daily(ctx, sources)
            deploy = "true"
        elif task == "periodic":
            tasks.task_periodic(ctx, sources)
            deploy = "true"
        elif task == "backfill":
            end = _date(args.end) or now_tpe().date()
            start = _date(args.start) or date(end.year - 3, end.month, 1)
            extra = tasks.task_backfill(ctx, sources, start, end)
            deploy = "true" if not extra.get("remaining") else "false"
            if extra.get("remaining") and args.chain:
                from pipeline.notify.github import dispatch_workflow

                ok = dispatch_workflow(
                    "data.yml",
                    {
                        "task": "backfill",
                        "source": args.source or "",
                        "start": str(extra["next_start"]),
                        "end": end.isoformat(),
                    },
                    ref=os.environ.get("GITHUB_REF_NAME", "main"),
                )
                extra["chained"] = ok
        elif task == "alerts":
            from pipeline.alerts import run_alerts

            extra = run_alerts(ctx)
        else:
            log.error("未知任務：%s", task)
            return 2
    finally:
        summary = tasks.append_run(ctx, task, extra)
        if task != "alerts":  # 盤中提醒每 15 分鐘執行，不寫入 data 分支
            store.save_manifest(ctx.manifest)
        Path(args.data_dir, "last_run.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8"
        )
    _gh_output(
        task=task, failed="true" if ctx.failures else "false", deploy=deploy, remaining=extra.get("remaining", 0)
    )
    return 0


def cmd_prepare_data(args: argparse.Namespace) -> int:
    from pipeline.gitdata import prepare

    print(prepare(Path(args.data_dir)))
    return 0


def cmd_commit_data(args: argparse.Namespace) -> int:
    from pipeline.gitdata import commit_and_push

    msg = args.message or f"data: {now_tpe():%Y-%m-%d %H:%M} 更新"
    print(commit_and_push(Path(args.data_dir), msg, push=not args.no_push))
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    from pipeline.notify.github import report_failures

    path = Path(args.data_dir, "last_run.json")
    if not path.exists():
        failures = ["pipeline 未產生執行摘要（可能在啟動階段失敗）"]
        task = "unknown"
    else:
        summary = json.loads(path.read_text(encoding="utf-8"))
        failures, task = summary.get("failed", []), summary.get("task", "unknown")
    if task == "alerts":
        return 0
    print(report_failures(failures, args.run_url, task))
    try:
        from pipeline.notify.telegram import send_daily_digest

        if task == "daily" and os.environ.get("TELEGRAM_BOT_TOKEN"):
            send_daily_digest(Path(args.data_dir), failures)
    except ImportError:
        pass
    return 0


def cmd_keepalive(args: argparse.Namespace) -> int:
    from pipeline.notify.github import keepalive

    print(keepalive(["data.yml", "deploy.yml"]))
    return 0


def cmd_build_web(args: argparse.Namespace) -> int:
    from pipeline.derive.export import build_web

    report = build_web(Path(args.data_dir), Path(args.out))
    print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0


def cmd_demo_data(args: argparse.Namespace) -> int:
    from pipeline.derive.demo import build_demo

    print(build_demo(Path(args.out)))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m pipeline", description="twse-money-flow 資料 pipeline")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="依任務或排程執行")
    run.add_argument("--task", default="", help="daily / periodic / backfill / alerts；空白時依 --schedule 決定")
    run.add_argument("--schedule", default="", help="github.event.schedule（cron 字串）")
    run.add_argument("--source", default="", help="逗號分隔的來源 id")
    run.add_argument("--start", default="")
    run.add_argument("--end", default="")
    run.add_argument("--data-dir", default="data")
    run.add_argument("--max-minutes", type=float, default=0, help="時間預算（回補用）")
    run.add_argument("--chain", action="store_true", help="回補未完成時自動觸發下一輪")
    run.set_defaults(func=cmd_run)

    for name in ("daily", "periodic", "backfill", "alerts"):
        alias = sub.add_parser(name, help=f"等同 run --task {name}")
        alias.add_argument("--source", default="")
        alias.add_argument("--start", default="")
        alias.add_argument("--end", default="")
        alias.add_argument("--data-dir", default="data")
        alias.add_argument("--max-minutes", type=float, default=0)
        alias.add_argument("--chain", action="store_true")
        alias.set_defaults(func=cmd_run, task=name, schedule="")

    prep = sub.add_parser("prepare-data", help="把 data 分支掛到 data/（git worktree）")
    prep.add_argument("--data-dir", default="data")
    prep.set_defaults(func=cmd_prepare_data)

    com = sub.add_parser("commit-data", help="提交並推送 data 分支（每月 squash）")
    com.add_argument("--data-dir", default="data")
    com.add_argument("--message", default="")
    com.add_argument("--no-push", action="store_true")
    com.set_defaults(func=cmd_commit_data)

    rep = sub.add_parser("report", help="依最近一次執行結果開啟／更新／關閉 data-failure Issue、推播")
    rep.add_argument("--data-dir", default="data")
    rep.add_argument("--run-url", default="")
    rep.set_defaults(func=cmd_report)

    keep = sub.add_parser("keepalive", help="避免排程因 60 天無活動被停用")
    keep.set_defaults(func=cmd_keepalive)

    web = sub.add_parser("build-web", help="產生前端用衍生資料")
    web.add_argument("--data-dir", default="data")
    web.add_argument("--out", default="web/public/data")
    web.set_defaults(func=cmd_build_web)

    demo = sub.add_parser("demo-data", help="以測試樣本產生示範資料（本機開發）")
    demo.add_argument("--out", default="web/public/data")
    demo.set_defaults(func=cmd_demo_data)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    return int(args.func(args))
