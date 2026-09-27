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
    if task == "alerts":  # 盤中提醒不碰 data 分支
        return cmd_alerts(args)
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
            if extra.get("remaining") and extra.get("progressed") and args.chain:
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
        else:
            log.error("未知任務：%s", task)
            return 2
    finally:
        summary = tasks.append_run(ctx, task, extra)
        store.save_manifest(ctx.manifest)
        Path(args.data_dir, "last_run.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8"
        )
    # 每日任務的最後一次（台北 20:30 後）部署完成時推播 Telegram 日報
    digest = "true" if task == "daily" and ctx.is_final_run else "false"
    _gh_output(
        task=task,
        failed="true" if ctx.failures else "false",
        deploy=deploy,
        digest=digest,
        remaining=extra.get("remaining", 0),
    )
    return 0


def cmd_alerts(args: argparse.Namespace) -> int:
    """盤中到價提醒（不需要 data 分支，狀態存在 --state，由 Actions cache 保存）。"""
    from pipeline.alerts import run_alerts

    class _Ctx:
        client = PoliteClient.from_config()

    result = run_alerts(_Ctx(), state_path=Path(getattr(args, "state", "") or ".alerts-state/state.json"))
    print(json.dumps(result, ensure_ascii=False))
    return 0


def cmd_digest(args: argparse.Namespace) -> int:
    from pipeline.alerts import load_rules
    from pipeline.notify.telegram import send_daily_digest

    failures: list[str] = []
    last = Path(args.data_dir, "last_run.json")
    if last.exists():
        failures = json.loads(last.read_text(encoding="utf-8")).get("failed", [])
    site = args.site_url
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if not site and "/" in repo:
        owner, name = repo.split("/", 1)
        site = f"https://{owner.lower()}.github.io/{name}/"
    ok = send_daily_digest(Path(args.web_data), load_rules()["digest"], site, failures)
    print("digest sent" if ok else "digest skipped")
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


def cmd_smoke(args: argparse.Namespace) -> int:
    from pipeline.smoke import run_smoke, to_markdown

    d = _date(args.date) or now_tpe().date()
    sources = [s.strip() for s in (args.source or "").split(",") if s.strip()] or None
    results = run_smoke(PoliteClient.from_config(), d, sources)
    text = to_markdown(results, d)
    print(text)
    if args.summary:
        with open(args.summary, "a", encoding="utf-8") as fh:
            fh.write(text)
    bad = [r for r in results if r.is_format_problem]
    return 1 if args.strict and bad else 0


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

    for name in ("daily", "periodic", "backfill"):
        alias = sub.add_parser(name, help=f"等同 run --task {name}")
        alias.add_argument("--source", default="")
        alias.add_argument("--start", default="")
        alias.add_argument("--end", default="")
        alias.add_argument("--data-dir", default="data")
        alias.add_argument("--max-minutes", type=float, default=0)
        alias.add_argument("--chain", action="store_true")
        alias.set_defaults(func=cmd_run, task=name, schedule="")

    al = sub.add_parser("alerts", help="盤中到價提醒（config/alerts.yml → Telegram）")
    al.add_argument("--state", default=".alerts-state/state.json", help="當日已推送紀錄（Actions cache）")
    al.set_defaults(func=cmd_alerts)

    dg = sub.add_parser("digest", help="推播 Telegram 盤後日報（部署後執行，未設定 secrets 時略過）")
    dg.add_argument("--web-data", default="web/public/data")
    dg.add_argument("--data-dir", default="data")
    dg.add_argument("--site-url", default="")
    dg.set_defaults(func=cmd_digest)

    prep = sub.add_parser("prepare-data", help="把 data 分支掛到 data/（git worktree）")
    prep.add_argument("--data-dir", default="data")
    prep.set_defaults(func=cmd_prepare_data)

    com = sub.add_parser("commit-data", help="提交並推送 data 分支（每月 squash）")
    com.add_argument("--data-dir", default="data")
    com.add_argument("--message", default="")
    com.add_argument("--no-push", action="store_true")
    com.set_defaults(func=cmd_commit_data)

    rep = sub.add_parser("report", help="依最近一次執行結果開啟／更新／關閉 data-failure Issue")
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

    smoke = sub.add_parser("smoke", help="資料源冒煙測試：抓取＋解析，檢查每個來源的必要欄位（不寫資料）")
    smoke.add_argument("--date", default="", help="交易日 YYYY-MM-DD 或 YYYYMMDD（預設今天）")
    smoke.add_argument("--source", default="", help="逗號分隔的來源 id（預設全部）")
    smoke.add_argument("--summary", default="", help="把 Markdown 結果附加到這個檔案（GITHUB_STEP_SUMMARY）")
    smoke.add_argument("--strict", action="store_true", help="有格式變動（必要欄位缺少）時回傳非 0")
    smoke.set_defaults(func=cmd_smoke)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    return int(args.func(args))
