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
    # 2026-10-06：依資料新鮮度補抓（config/schedule.yml freshness.catchup；pipeline/freshness.py）
    # 取代原本 14:15／15:30／21:30 的分段更新排程（10/5 那兩段排程整個沒觸發、第一段延後 8 小時且只抓收盤行情段）。
    # 2026-10-07：08:05／10:05／12:05 是接力的起跑點（排程延遲 5–7 小時時，任何一次觸發都能接上當天的接力）
    "5 0 * * 1-5": "catchup",  # 08:05（台北）
    "5 2 * * 1-5": "catchup",  # 10:05（台北）
    "5 4 * * 1-5": "catchup",  # 12:05（台北）
    "15 7 * * 1-5": "catchup",  # 15:15（台北）收盤行情、指數、分鐘 K
    "30 8 * * 1-5": "catchup",  # 16:30（台北）三大法人、期貨法人、本益比、外資持股
    "30 14 * * 1-5": "catchup",  # 22:30（台北）融資融券、借券、當沖
    "0 2 * * 6": "periodic",
    "0 3 11 * *": "periodic",
    "0 3 16 5,8,11 *": "periodic",
    "0 3 1 4 *": "periodic",
    "*/15 1-5 * * 1-5": "alerts",
    "40 14 * * 1-5": "resume",
    # 2026-10：個股 5 分 K（Yahoo，非官方）；14:45（台北）收盤之後，單次跑不完自動接續；
    # 排程沒觸發時由補抓任務（catchup）發現分鐘 K 還欠而觸發
    "45 6 * * 1-5": "kbar",
}

# E-05：回補分段執行。每段最多 BACKFILL_SEGMENT_MINUTES 分鐘，結束時提交進度並自動觸發下一段；
# 交易日 13:30–22:30（台北）不開始新的一段，讓分段更新（14:15 收盤行情、15:30 法人、21:30 信用）先跑；
# 延後的那段由 22:40 的 resume 排程接續（M0：原本 16:30 起，分段更新提早到 14:15 後一併提早）。
BACKFILL_SEGMENT_MINUTES = 40
QUIET_WINDOW = ((13, 30), (22, 30))
# 全市場集保回補（M0）：獨立任務與 concurrency group（holders-backfill），進度寫在 manifest[holders_backfill]
HOLDERS_TASK = "holders_backfill"
# v3 M0：全市場集保回補分成 2 道平行（依週別分道，見 tasks_advanced.lane_of）；main 的 22:40 接續與停擺重啟送空白 source，
# 在這裡視為「分派 HOLDERS_LANES 道」
HOLDERS_LANES = 2
# resume 排程發現全市場集保回補超過這麼久沒有新的一段（接續失敗、分段被取消），重新觸發
HOLDERS_STALL_HOURS = 3


def kbar_should_deploy(extra: dict[str, object]) -> bool:
    """個股 5 分 K 分段：有前進且是最後一段（沒有剩餘，或下一段沒有接上）才部署。"""
    if not extra.get("progressed"):
        return False
    return not extra.get("remaining") or not extra.get("chained")


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
    stage = None
    if task.startswith("stage:"):
        task, stage = "stage", task.split(":", 1)[1]
    elif task == "stage":
        stage = getattr(args, "stage", "") or "credit"
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
        elif task == "stage":
            from pipeline.stages import run_stage

            extra = run_stage(ctx, str(stage))
            deploy = "true"
        elif task == "catchup":
            extra = run_catchup_task(ctx, args)
            deploy = "true" if extra.get("progressed") else "false"
        elif task == "probe":
            extra = run_probe(ctx, args)
        elif task == "kbar":
            from pipeline import tasks_kbar

            extra = tasks_kbar.run_kbar(ctx)
            # 還有剩餘且有前進 → 觸發下一段接續。2026-10-08：只在最後一段（或接續觸發失敗）部署——
            # 原本每段都部署（一天 3～4 次、每次 20～30 分鐘），佔住部署佇列，補抓的資料要排在後面
            if extra.get("remaining") and extra.get("progressed") and args.chain:
                from pipeline.notify.github import dispatch_workflow

                extra["chained"] = dispatch_workflow(
                    "data.yml", {"task": "kbar"}, ref=os.environ.get("GITHUB_REF_NAME", "main")
                )
            deploy = "true" if kbar_should_deploy(extra) else "false"
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
                src = args.source or ""
                if task == HOLDERS_TASK and src.startswith("lane="):
                    # 平行的每一道延後時都記同一個分派者（lanes=n），22:40 接續時一次觸發全部道次，不會互相覆蓋待續槽
                    src = f"lanes={src.split('/')[-1]}"
                ctx.manifest[pending_key] = {
                    "task": task,
                    "source": src,
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
                from pipeline.notify.github import dispatch_workflow

                lane = tasks_advanced.parse_lane(args.source)
                n = tasks_advanced.parse_lanes(args.source, HOLDERS_LANES)
                deploy = "false"  # 回補不部署；每日任務下次部署時自動用上新資料
                if lane is None and n > 1:
                    # v3 M0：分派者（空白或 lanes=n）只觸發 n 道平行回補，各自一個 concurrency group
                    ref = os.environ.get("GITHUB_REF_NAME", "main")
                    sent = [
                        dispatch_workflow("data.yml", {"task": task, "source": f"lane={k}/{n}"}, ref=ref)
                        if args.chain
                        else False
                        for k in range(n)
                    ]
                    extra = {"spawned": n, "chained": all(sent)}
                    raise _Deferred
                extra = tasks_advanced.run_tdcc_full(ctx, lane=lane)
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
    stage_digest = False
    if task == "stage":
        from pipeline.stages import schedule

        stage_digest = bool(schedule()["stages"][str(stage)].get("digest"))
    if task == "catchup":
        # 今天的三大法人這一次才補齊 → 推播日報（同一交易日只推一次）
        fixed = extra.get("fixed")
        stage_digest = (
            isinstance(fixed, list)
            and "insti" in fixed
            and ctx.manifest.get("last_target_date") == ctx.today.isoformat()
        )
    if (task == "daily" and ctx.is_final_run) or stage_digest:
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


def run_catchup_task(ctx: Any, args: argparse.Namespace) -> dict[str, object]:
    """依資料新鮮度補抓（pipeline/freshness.py）。接力的那一次先等到 not_before（最多 relay.max_wait_minutes）。

    結束時接力（2026-10-07）：預約下一次＝重試時間（缺漏仍在、attempt＋1，最多 max_retries 次）與今天下一個預期公布時間
    取早的（freshness.plan_next）；已有不晚於它的接力在等就不再觸發（freshness.relay_decision）。
    分鐘 K 還欠 → 觸發 kbar 任務（排程可能被 GitHub 延遲或丟掉）。
    """
    from pipeline import freshness

    attempt = int(getattr(args, "attempt", "") or 1)
    max_wait = int(freshness.relay_config().get("max_wait_minutes", 300))
    nb = getattr(args, "not_before", "") or ""
    if nb:
        wait = (datetime.fromisoformat(nb) - now_tpe()).total_seconds()
        if wait > 0:
            log.info("接力（第 %d 次）：等到 %s（%d 分鐘）", attempt, nb, round(wait / 60))
            time.sleep(min(wait, (max_wait + 5) * 60))
            from pipeline.gitdata import refresh

            # 睡了數小時：其他任務可能已推進 data 分支 → 同步到最新再判斷缺什麼（不重抓別人已抓到的）
            if refresh(Path(args.data_dir)) == "refreshed":
                ctx.manifest = ctx.store.load_manifest()
        ctx.now = now_tpe()
    extra: dict[str, object] = dict(freshness.run_catchup(ctx, attempt=attempt))
    ref = os.environ.get("GITHUB_REF_NAME", "main")
    from pipeline.notify.github import dispatch_workflow

    if args.chain:
        state = ctx.manifest.get("freshness") or {}
        retry_at = (
            datetime.fromisoformat(state["next_retry"]) if extra.get("retry") and state.get("next_retry") else None
        )
        now = now_tpe()
        plan = freshness.plan_next(now, attempt, retry_at, freshness.next_due_at(ctx.calendar, now), max_wait)
        if plan:
            res = dispatch_relay(*plan, ref=ref)
            extra["relay"] = res
            # 實際會醒來的那一棒（已有較早的在等 → 記那一棒的時間）；資料健康頁、執行摘要看得到
            state["next_run"] = None if res == "failed" else res.removeprefix("skip:")
    if args.chain and freshness.kbar_due(ctx.manifest, ctx.calendar, ctx.now) and attempt == 1:
        extra["kbar_dispatched"] = dispatch_workflow("data.yml", {"task": "kbar"}, ref=ref)
    return extra


def dispatch_relay(not_before: datetime, attempt: int, ref: str = "main") -> str:
    """觸發下一棒補抓接力；同時只留一棒（不晚於 not_before 的已在等 → 略過；比它晚的 → 取消再觸發）。"""
    from pipeline import freshness
    from pipeline.notify.github import alive_relays, cancel_run, dispatch_workflow

    nb = not_before.isoformat(timespec="minutes")
    alive = alive_relays() or []
    go, cancel = freshness.relay_decision(not_before, alive)
    if not go:
        waiting = min(t for _, t in alive).isoformat(timespec="minutes")
        log.info("接力：已有 %s 的接力在等，不再觸發 %s", waiting, nb)
        return f"skip:{waiting}"
    for rid in cancel:
        log.info("接力：取消較晚的接力 run %s", rid)
        cancel_run(rid)
    ok = dispatch_workflow("data.yml", {"task": "catchup", "attempt": str(attempt), "not_before": nb}, ref=ref)
    log.info("接力：預約 %s（第 %d 次）%s", nb, attempt, "" if ok else "失敗")
    return nb if ok else "failed"


def run_probe(ctx: Any, args: argparse.Namespace) -> dict[str, object]:
    """M3.4 公布時間實測（task=probe）：等到 13:30 開始探測；每個 job 最多約 5.5 小時，未完成就觸發下一段接續。"""
    from datetime import timedelta

    from pipeline import probe, tasks
    from pipeline.notify.github import dispatch_workflow

    tasks.load_calendar(ctx, [ctx.today.year], fetch_missing=False)
    today = now_tpe().date()
    if not ctx.calendar.is_trading_day(today):
        return {"probe": "休市"}
    start = probe._at(today, "13:30")
    job_end = now_tpe() + timedelta(minutes=330)
    ref = os.environ.get("GITHUB_REF_NAME", "main")
    if now_tpe() < start:
        wait = min((start - now_tpe()).total_seconds(), 300 * 60)
        log.info("公布時間實測：等待 %.0f 分鐘", wait / 60)
        time.sleep(wait)
        if now_tpe() < start:
            ok = dispatch_workflow("data.yml", {"task": "probe"}, ref=ref) if args.chain else False
            return {"probe": "等待中", "chained": ok}
    found = probe.probe_day(ctx, today, deadline=job_end)
    left = len(probe.EXPECTED) - len(found)
    chained = False
    if left and now_tpe() < probe._at(today, probe.END) and args.chain:
        chained = dispatch_workflow("data.yml", {"task": "probe"}, ref=ref)
    return {"probe": found, "remaining": left, "chained": chained}


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

    cache = getattr(args, "evidence_cache", None)
    report = build_web(Path(args.data_dir), Path(args.out), evidence_cache=Path(cache) if cache else None)
    print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0


def cmd_guard(args: argparse.Namespace) -> int:
    """部署前守門（2026-10-02 健檢）：欄位缺漏、日期倒退、筆數驟降 → 非零結束、不部署、線上保留前一版。"""
    from pipeline.derive.guard import check

    res = check(Path(args.out), Path(args.previous) if args.previous else None)
    print(json.dumps(res, ensure_ascii=False, indent=1))
    return 0 if res["ok"] else 1


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


def cmd_audit(args: argparse.Namespace) -> int:
    """審查 2026-10-01：校正後 t、多重檢定、相關矩陣、分組穩定性（AUDIT.md）；只讀，不寫前端 JSON。"""
    from pipeline.derive.export import write_json
    from pipeline.evidence import audit
    from pipeline.evidence import data as evdata
    from pipeline.evidence.run import evaluate

    ev = evdata.load(DataStore(args.data_dir))
    res = evaluate(ev, with_exits=False)
    a = audit.run(res)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    write_json(out / "audit.json", a)
    (out / "AUDIT_TABLES.md").write_text(audit.markdown(a), encoding="utf-8")
    print(audit.markdown(a))
    return 0


def cmd_swing(args: argparse.Namespace) -> int:
    """波段策略（2026-10-01）：開發／驗證段的嘗試（TRIALS.md）與最終測試（只跑一次）。"""
    from pipeline.derive.export import write_json
    from pipeline.evidence import data as evdata
    from pipeline.evidence import swing
    from pipeline.evidence.run import evaluate

    ev = evdata.load(DataStore(args.data_dir))
    res = evaluate(ev, with_exits=False)
    sw = swing.cfg()
    if args.id:  # 單一策略的嘗試（可覆寫參數與持有天數；只看開發段，不碰最終測試段）
        from pipeline.evidence import indicators as ind

        spec = next(s for s in sw["strategies"] if s["id"] == args.id)
        params = dict(spec.get("params") or {})
        for kv in args.param or []:
            k, v = kv.split("=", 1)
            params[k] = float(v)
        hold = int(args.hold or spec["hold"])
        ctx = res["_ctx"]
        f = ind.build_features(ctx["ev"], ctx["uni"], ctx["cfg"]["indicators"])
        mk = swing.market_for(ctx["ev"], ctx["uni"], ctx["cfg"], [hold, round(hold * 0.8), round(hold * 1.2), 20, 40])
        r = swing.evaluate_spec(
            spec,
            ctx["ev"],
            f,
            ctx["uni"],
            mk,
            ctx["cfg"],
            swing.gates_cfg(ctx["cfg"]),
            params=params,
            hold=hold,
            with_test=False,
        )
        r.pop("mask", None)
        r.pop("events", None)
        r["portfolio"].pop("equity_weekly", None)
        print(json.dumps(r, ensure_ascii=False, indent=1, default=str))
        return 0
    lib = swing.build(res, with_test=args.segment == "test")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    write_json(out / "swing.json", {k: v for k, v in lib.items() if k != "_signals"})
    (out / "SWING_TABLES.md").write_text(swing.markdown(lib), encoding="utf-8")
    print(swing.markdown(lib))
    return 0


def cmd_demo_data(args: argparse.Namespace) -> int:
    from pipeline.derive.demo import build_demo

    print(build_demo(Path(args.out)))
    return 0


def cmd_sectors_refresh(args: argparse.Namespace) -> int:
    """細產業快照：櫃買中心產業價值鏈 → config/sectors/tpex_chain.csv（禮貌爬取；--cache 可重用已抓的頁面）。"""
    from datetime import date as _date

    from pipeline.core.http import PoliteClient
    from pipeline.sources import tpex_chain

    rows = tpex_chain.fetch_all(PoliteClient.from_config(), args.cache)
    if len(rows) < 3000:
        log.error("產業價值鏈筆數過少（%d），不覆蓋快照", len(rows))
        return 1
    out = Path(args.out)
    out.write_text(tpex_chain.to_csv(rows, args.date or _date.today().isoformat()), encoding="utf-8")
    log.info("產業價值鏈：%d 筆、%d 檔 → %s", len(rows), len({r.code for r in rows}), out)
    return 0


def cmd_validate_web(args: argparse.Namespace) -> int:
    """前端資料驗證（檔案大小、細產業與分鐘資料涵蓋、題材成員、日期連續、成交金額合計、策略筆數一致）。"""
    import json as _json

    from pipeline.derive.validate_web import validate

    res = validate(Path(args.out))
    print(_json.dumps({k: v for k, v in res.items() if k != "errors"}, ensure_ascii=False))
    for e in res["errors"]:
        log.error(e)
    return 1 if res["errors"] else 0


def cmd_smoke(args: argparse.Namespace) -> int:
    from pipeline.smoke import run_smoke, smoke_active_etf, to_markdown

    d = _date(args.date) or now_tpe().date()
    sources = [s.strip() for s in (args.source or "").split(",") if s.strip()] or None
    client = PoliteClient.from_config()
    results = run_smoke(client, d, sources)
    if sources is None or "active_etf" in sources:
        # 主動式 ETF 各投信（2026-10-09）：日期用今天（投信端點以「最新一份」查詢）
        results += smoke_active_etf(client, now_tpe().date())
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
    run.add_argument("--stage", default="", help="分段更新：close／insti／credit（config/schedule.yml）")
    run.add_argument("--attempt", default="", help="補抓（catchup）第幾次；重試與接力由前一次以 workflow_dispatch 觸發")
    run.add_argument(
        "--not-before", dest="not_before", default="", help="補抓重試／接力：等到這個時間（ISO，台北）才開始"
    )
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
    web.add_argument(
        "--evidence-cache",
        dest="evidence_cache",
        default="",
        help="指標效度評估的快取目錄（輸入、程式、設定都沒變就沿用；deploy.yml 以 actions/cache 保存）",
    )
    web.set_defaults(func=cmd_build_web)

    gd = sub.add_parser("guard", help="部署前守門：新版衍生資料 vs 線上前一版（欄位、日期、筆數）")
    gd.add_argument("--out", default="web/public/data")
    gd.add_argument("--previous", default="", help="前一版的目錄（deploy.yml 從線上下載）；沒有時只做欄位檢查")
    gd.set_defaults(func=cmd_guard)

    evd = sub.add_parser("evidence", help="指標效度評估（事件研究、分組檢定、walk-forward、判定）")
    evd.add_argument("--data-dir", default="data")
    evd.add_argument("--out", default="", help="前端 JSON 輸出目錄（例：web/public/data）")
    evd.add_argument("--doc", default="", help="Markdown 報告（例：docs/INDICATOR_EVIDENCE.md）")
    evd.set_defaults(func=cmd_evidence)

    aud = sub.add_parser("audit", help="審查統計：校正後 t、多重檢定、相關矩陣、分組穩定性（AUDIT.md）")
    aud.add_argument("--data-dir", default="data")
    aud.add_argument("--out", default="docs/audit/signals")
    aud.set_defaults(func=cmd_audit)

    swg = sub.add_parser("swing", help="波段策略：開發／驗證段嘗試與最終測試（docs/swing）")
    swg.add_argument("--data-dir", default="data")
    swg.add_argument("--out", default="docs/swing/out")
    swg.add_argument("--segment", default="dev", choices=["dev", "test"], help="test＝含最終測試段（只跑一次）")
    swg.add_argument("--id", default="", help="單一策略的嘗試（只看開發／驗證段）")
    swg.add_argument("--param", action="append", help="覆寫參數：name=value（可重複）")
    swg.add_argument("--hold", default="", help="覆寫持有天數")
    swg.set_defaults(func=cmd_swing)

    demo = sub.add_parser("demo-data", help="以測試樣本產生示範資料（本機開發）")
    demo.add_argument("--out", default="web/public/data")
    demo.set_defaults(func=cmd_demo_data)

    vw = sub.add_parser("validate-web", help="前端資料驗證（大小、涵蓋、日期、合計、策略筆數）")
    vw.add_argument("--out", default="web/public/data")
    vw.set_defaults(func=cmd_validate_web)
    sr = sub.add_parser("sectors-refresh", help="細產業快照：櫃買中心產業價值鏈 → config/sectors/tpex_chain.csv")
    sr.add_argument("--out", default="config/sectors/tpex_chain.csv")
    sr.add_argument("--cache", default=None, help="頁面快取目錄（有檔案時不重抓）")
    sr.add_argument("--date", default=None, help="抓取日期（預設今天）")
    sr.set_defaults(func=cmd_sectors_refresh)
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
