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
from datetime import date, datetime
from pathlib import Path
from typing import Any

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
    "40 14 * * 1-5": "resume",
}

# E-05：回補分段執行。每段最多 BACKFILL_SEGMENT_MINUTES 分鐘，結束時提交進度並自動觸發下一段；
# 交易日 13:30–22:30（台北）不開始新的一段，讓分段更新（14:15 收盤行情、15:30 法人、21:30 信用）先跑；
# 延後的那段由 22:40 的 resume 排程接續（M0：原本 16:30 起，分段更新提早到 14:15 後一併提早）。
BACKFILL_SEGMENT_MINUTES = 40
QUIET_WINDOW = ((13, 30), (22, 30))
# 全市場集保回補（M0）：獨立任務與 concurrency group（holders-backfill），進度寫在 manifest[holders_backfill]
HOLDERS_TASK = "holders_backfill"
# resume 排程發現全市場集保回補超過這麼久沒有新的一段（接續失敗、分段被取消），重新觸發
HOLDERS_STALL_HOURS = 3


def in_quiet_window(now: datetime, calendar: Any) -> bool:
    """交易日的 13:30（含）–22:30（不含）不開始新的回補分段。"""
    if not calendar.is_trading_day(now.date()):
        return False
    hm = (now.hour, now.minute)
    return QUIET_WINDOW[0] <= hm < QUIET_WINDOW[1]


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


def _truthy(value: str | bool | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes"}


def cmd_run(args: argparse.Namespace) -> int:
    from pipeline import tasks

    task = args.task or SCHEDULE_TASKS.get((args.schedule or "").strip(), "daily")
    if task == "alerts":  # 盤中提醒不碰 data 分支
        return cmd_alerts(args)
    if task == "resume":
        return cmd_resume(args)
    sources = [s.strip() for s in (args.source or "").split(",") if s.strip()] or None
    store = DataStore(args.data_dir)
    ctx = tasks.RunContext(store=store, client=PoliteClient.from_config(), now=now_tpe())
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
        elif task in ("backfill", HOLDERS_TASK):
            end = _date(args.end) or now_tpe().date()
            start = _date(args.start) or tasks.default_backfill_start(sources, end)
            refresh = _truthy(args.refresh)
            pending_key = "backfill_pending" if task == "backfill" else f"{HOLDERS_TASK}_pending"
            tasks.load_calendar(ctx, [ctx.today.year], fetch_missing=False)
            if in_quiet_window(ctx.now, ctx.calendar):
                # E-05：每日任務時段不開始新的一段；記下待續的參數，由 22:40 的 resume 排程觸發
                ctx.manifest[pending_key] = {
                    "task": task,
                    "source": args.source or "",
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                    "refresh": refresh,
                    "ref": os.environ.get("GITHUB_REF_NAME", "main"),
                    "deferred_at": ctx.now.isoformat(timespec="minutes"),
                }
                log.info("交易日 13:30–22:30 不開始回補分段，已記錄待續，22:40 自動接續")
                extra = {"deferred": True}
                raise _Deferred
            ctx.manifest.pop(pending_key, None)
            if ctx.deadline is None or ctx.deadline - time.monotonic() > BACKFILL_SEGMENT_MINUTES * 60:
                ctx.deadline = time.monotonic() + BACKFILL_SEGMENT_MINUTES * 60
            if task == HOLDERS_TASK:
                from pipeline import tasks_advanced

                extra = tasks_advanced.run_tdcc_full(ctx)
                deploy = "false"  # 回補不部署；每日任務下次部署時自動用上新資料
            else:
                extra = tasks.task_backfill(ctx, sources, start, end, refresh=refresh)
                deploy = "true" if not extra.get("remaining") else "false"
            # 重抓（refresh）不自動接續：下一輪會從最近的日期重抓起，無法前進；剩餘量請縮小區間後再執行
            if extra.get("remaining") and extra.get("progressed") and args.chain and not refresh:
                from pipeline.notify.github import dispatch_workflow

                inputs = {"task": task, "source": args.source or "", "end": end.isoformat()}
                inputs["start"] = str(extra.get("next_start") or start.isoformat())
                ok = dispatch_workflow("data.yml", inputs, ref=os.environ.get("GITHUB_REF_NAME", "main"))
                extra["chained"] = ok
        else:
            log.error("未知任務：%s", task)
            return 2
    except _Deferred:
        pass
    finally:
        summary = tasks.append_run(ctx, task, extra)
        store.save_manifest(ctx.manifest)
        Path(args.data_dir, "last_run.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8"
        )
    # 每日任務的最後一次（台北 20:30 後）部署完成時推播 Telegram 日報。
    # E-06：今天休市（或同一交易日已推播過）不推播，避免重送前一個交易日的內容
    digest = "false"
    if task == "daily" and ctx.is_final_run:
        target = ctx.manifest.get("last_target_date")
        if should_send_digest(target, ctx.today.isoformat(), ctx.manifest.get("digest_date")):
            digest = "true"
            ctx.manifest["digest_date"] = target
            store.save_manifest(ctx.manifest)
    _gh_output(
        task=task,
        failed="true" if ctx.failures else "false",
        deploy=deploy,
        digest=digest,
        remaining=extra.get("remaining", 0),
    )
    return 0


class _Deferred(Exception):
    """回補分段延後（每日任務時段）。"""


def cmd_resume(args: argparse.Namespace) -> int:
    """E-05：22:40（台北）接續在每日任務時段延後的回補分段：以記錄的參數觸發 data.yml。

    兩種回補各自一個待續槽（backfill_pending、holders_backfill_pending）。全市場集保回補另外檢查是否停擺：
    還有剩餘、沒有待續、而且超過 HOLDERS_STALL_HOURS 小時沒有新的一段（接續觸發失敗或分段被取消）→ 重新觸發。
    """
    from pipeline.notify.github import dispatch_workflow

    store = DataStore(args.data_dir)
    manifest = store.load_manifest()
    fired: list[str] = []
    failed = False
    for key, task in (("backfill_pending", "backfill"), (f"{HOLDERS_TASK}_pending", HOLDERS_TASK)):
        pending = manifest.get(key)
        if not pending:
            continue
        ok = dispatch_workflow(
            "data.yml",
            {
                "task": str(pending.get("task") or task),
                "source": str(pending.get("source") or ""),
                "start": str(pending["start"]),
                "end": str(pending["end"]),
                "refresh": "true" if pending.get("refresh") else "false",
            },
            ref=str(pending.get("ref") or "main"),
        )
        fired.append(f"{task}：{'已觸發' if ok else '觸發失敗'}")
        failed = failed or not ok
    prog = manifest.get(HOLDERS_TASK) or {}
    if not manifest.get(f"{HOLDERS_TASK}_pending") and holders_stalled(prog, now_tpe()):
        ok = dispatch_workflow(
            "data.yml",
            {"task": HOLDERS_TASK, "source": "", "start": "", "end": "", "refresh": "false"},
            ref=str(prog.get("ref") or "main"),
        )
        fired.append(f"{HOLDERS_TASK}（停擺重啟）：{'已觸發' if ok else '觸發失敗'}")
        failed = failed or not ok
    print("接續回補：" + ("；".join(fired) if fired else "沒有待續的回補"))
    _gh_output(
        task="resume", failed="true" if failed else "false", deploy="false", digest="false", remaining=len(fired)
    )
    return 0


def holders_stalled(prog: dict[str, Any], now: datetime) -> bool:
    """全市場集保回補還有剩餘，但最後一段超過 HOLDERS_STALL_HOURS 小時前 → 停擺。"""
    if not prog or not int(prog.get("remaining") or 0) or not prog.get("updated_at"):
        return False
    last = datetime.fromisoformat(str(prog["updated_at"]))
    return (now - last).total_seconds() > HOLDERS_STALL_HOURS * 3600


def should_send_digest(summary_date: str | None, today: str, last_sent: str | None) -> bool:
    """E-06：日報只在「資料日期＝今天（台北）」而且這個日期還沒推播過時送出。

    平日休市（9/25 中秋、9/28 教師節）的最後一次執行，資料日期仍是 9/24 → 不送。
    """
    return bool(summary_date) and summary_date == today and summary_date != last_sent


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
    summary_path = Path(args.web_data, "summary.json")
    if summary_path.exists():
        sdate = json.loads(summary_path.read_text(encoding="utf-8")).get("date")
        if not should_send_digest(sdate, now_tpe().date().isoformat(), None):
            print(f"digest skipped：資料日期 {sdate} 不是今天（休市或資料未更新），不重送")
            return 0
    rules = load_rules()
    ok = send_daily_digest(Path(args.web_data), rules["digest"], site, failures, rules["tracking"])
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
    if task in ("alerts", "resume"):
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


def cmd_evidence(args: argparse.Namespace) -> int:
    """指標效度評估（M1）：寫出 evidence.json／evidence/*.json 與 docs/INDICATOR_EVIDENCE.md。"""
    from pipeline.evidence import data as evdata
    from pipeline.evidence.run import run_and_write

    ev = evdata.load(DataStore(args.data_dir))
    out = Path(args.out) if args.out else None
    if out:
        out.mkdir(parents=True, exist_ok=True)
    report = run_and_write(ev, out, Path(args.doc) if args.doc else None)
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
    run.add_argument(
        "--task", default="", help="daily / periodic / backfill / holders_backfill / alerts；空白時依 --schedule 決定"
    )
    run.add_argument("--schedule", default="", help="github.event.schedule（cron 字串）")
    run.add_argument("--source", default="", help="逗號分隔的來源 id")
    run.add_argument("--start", default="")
    run.add_argument("--end", default="")
    run.add_argument("--data-dir", default="data")
    run.add_argument("--max-minutes", type=float, default=0, help="時間預算（回補用）")
    run.add_argument("--chain", action="store_true", help="回補未完成時自動觸發下一輪")
    run.add_argument("--refresh", default="", help="回補時重抓已存在的每日型檔案（true／false；需指定 --source）")
    run.set_defaults(func=cmd_run)

    for name in ("daily", "periodic", "backfill", HOLDERS_TASK):
        alias = sub.add_parser(name, help=f"等同 run --task {name}")
        alias.add_argument("--source", default="")
        alias.add_argument("--start", default="")
        alias.add_argument("--end", default="")
        alias.add_argument("--data-dir", default="data")
        alias.add_argument("--max-minutes", type=float, default=0)
        alias.add_argument("--chain", action="store_true")
        alias.add_argument("--refresh", default="", help="true 時重抓已存在的每日型檔案（需指定 --source）")
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

    evd = sub.add_parser("evidence", help="指標效度評估（事件研究、分組檢定、walk-forward、判定）")
    evd.add_argument("--data-dir", default="data")
    evd.add_argument("--out", default="", help="前端 JSON 輸出目錄（例：web/public/data）")
    evd.add_argument("--doc", default="", help="Markdown 報告（例：docs/INDICATOR_EVIDENCE.md）")
    evd.set_defaults(func=cmd_evidence)

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
