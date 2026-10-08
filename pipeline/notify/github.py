"""GitHub REST：data-failure Issue、workflow dispatch（回補續跑、補抓接力）、排程保活。

只使用 Actions 提供的 GITHUB_TOKEN（環境變數），不存放任何密鑰。
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any

import requests

log = logging.getLogger(__name__)
API = "https://api.github.com"
LABEL = "data-failure"


def _env() -> tuple[str, str] | None:
    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        log.info("未設定 GITHUB_TOKEN／GITHUB_REPOSITORY，略過 GitHub 操作")
        return None
    return token, repo


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _open_issue(token: str, repo: str) -> dict[str, Any] | None:
    r = requests.get(
        f"{API}/repos/{repo}/issues",
        headers=_headers(token),
        params={"labels": LABEL, "state": "open", "per_page": "5"},
        timeout=30,
    )
    r.raise_for_status()
    items = [i for i in r.json() if "pull_request" not in i]
    return items[0] if items else None


def report_failures(failures: list[str], run_url: str | None, task: str) -> str:
    """有失敗 → 開新 Issue 或在既有 Issue 留言；全部成功且有開啟中的 Issue → 留言並關閉。"""
    env = _env()
    if env is None:
        return "skipped"
    token, repo = env
    issue = _open_issue(token, repo)
    link = f"\n\n執行紀錄：{run_url}" if run_url else ""
    if failures:
        body = f"### 資料任務 `{task}` 有來源失敗\n\n" + "\n".join(f"- {f}" for f in failures[:50]) + link
        body += "\n\n> 驗證失敗的資料不會覆蓋上一份好資料。此 Issue 會在下次全部成功時自動關閉。"
        if issue:
            requests.post(
                f"{API}/repos/{repo}/issues/{issue['number']}/comments",
                headers=_headers(token),
                json={"body": body},
                timeout=30,
            ).raise_for_status()
            return f"commented #{issue['number']}"
        requests.post(
            f"{API}/repos/{repo}/labels",
            headers=_headers(token),
            json={"name": LABEL, "color": "d73a4a", "description": "資料抓取或驗證失敗"},
            timeout=30,
        )
        r = requests.post(
            f"{API}/repos/{repo}/issues",
            headers=_headers(token),
            json={"title": f"資料任務失敗：{task}", "body": body, "labels": [LABEL]},
            timeout=30,
        )
        r.raise_for_status()
        return f"opened #{r.json()['number']}"
    if issue:
        requests.post(
            f"{API}/repos/{repo}/issues/{issue['number']}/comments",
            headers=_headers(token),
            json={"body": f"✅ 任務 `{task}` 全部成功，自動關閉。{link}"},
            timeout=30,
        ).raise_for_status()
        requests.patch(
            f"{API}/repos/{repo}/issues/{issue['number']}",
            headers=_headers(token),
            json={"state": "closed", "state_reason": "completed"},
            timeout=30,
        ).raise_for_status()
        return f"closed #{issue['number']}"
    return "none"


def dispatch_workflow(workflow: str, inputs: dict[str, str], ref: str = "main") -> bool:
    """觸發 workflow_dispatch（GITHUB_TOKEN 觸發 workflow_dispatch 會建立新的執行）。"""
    env = _env()
    if env is None:
        return False
    token, repo = env
    r = requests.post(
        f"{API}/repos/{repo}/actions/workflows/{workflow}/dispatches",
        headers=_headers(token),
        json={"ref": ref, "inputs": inputs},
        timeout=30,
    )
    if r.status_code >= 300:
        log.warning("dispatch 失敗：%s %s", r.status_code, r.text[:200])
        return False
    return True


# data.yml 的 run-name：補抓接力（catchup＋not_before）的執行標題是「Data · 補抓接力 <not_before>」
RELAY_TITLE = "補抓接力 "


def alive_relays(workflow: str = "data.yml") -> list[tuple[int, datetime]] | None:
    """還沒結束（等待中或執行中）的補抓接力：[(run id, not_before)]，不含自己；查不到 → None。"""
    env = _env()
    if env is None:
        return None
    token, repo = env
    try:
        r = requests.get(
            f"{API}/repos/{repo}/actions/workflows/{workflow}/runs",
            headers=_headers(token),
            params={"event": "workflow_dispatch", "per_page": "100"},
            timeout=30,
        )
        r.raise_for_status()
        runs = r.json().get("workflow_runs", [])
    except (requests.RequestException, ValueError) as exc:
        log.warning("查詢接力失敗：%s", exc)
        return None
    me = os.environ.get("GITHUB_RUN_ID", "")
    out = []
    for run in runs:
        title = str(run.get("display_title") or "")
        if run.get("status") == "completed" or str(run.get("id")) == me or RELAY_TITLE not in title:
            continue
        try:
            out.append((int(run["id"]), datetime.fromisoformat(title.split(RELAY_TITLE, 1)[1].strip())))
        except (KeyError, ValueError):
            continue
    return out


def cancel_run(run_id: int) -> bool:
    env = _env()
    if env is None:
        return False
    token, repo = env
    r = requests.post(f"{API}/repos/{repo}/actions/runs/{run_id}/cancel", headers=_headers(token), timeout=30)
    if r.status_code >= 300:
        log.warning("取消 run %s 失敗：%s", run_id, r.status_code)
        return False
    return True


def keepalive(workflows: list[str]) -> list[str]:
    """公開 repo 60 天無活動會停用排程：定期呼叫「啟用 workflow」API 以維持排程。"""
    env = _env()
    if env is None:
        return []
    token, repo = env
    done = []
    for wf in workflows:
        r = requests.put(f"{API}/repos/{repo}/actions/workflows/{wf}/enable", headers=_headers(token), timeout=30)
        if r.status_code < 300:
            done.append(wf)
        else:
            log.warning("keepalive %s 失敗：%s", wf, r.status_code)
    return done
