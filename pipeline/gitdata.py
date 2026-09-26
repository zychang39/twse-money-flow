"""data 分支（孤兒分支）操作：以 git worktree 掛在工作目錄的 data/，提交並推送；每月 squash 一次。"""

from __future__ import annotations

import logging
import subprocess
from datetime import datetime
from pathlib import Path

from pipeline.core.dates import TPE

log = logging.getLogger(__name__)
BRANCH = "data"


def _git(*args: str, cwd: Path | str = ".", check: bool = True) -> str:
    res = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=False)
    if check and res.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} 失敗：{res.stderr.strip()}")
    return res.stdout.strip()


def prepare(data_dir: Path) -> str:
    """把 origin/data 掛到 data_dir；若遠端沒有 data 分支，建立孤兒分支。"""
    if (data_dir / ".git").exists():
        return "exists"
    fetched = subprocess.run(["git", "fetch", "--depth=1", "origin", BRANCH], capture_output=True, text=True)
    if fetched.returncode == 0:
        _git("worktree", "add", "-B", BRANCH, str(data_dir), "FETCH_HEAD")
        return "checked-out"
    _git("worktree", "add", "--orphan", "-b", BRANCH, str(data_dir))
    (data_dir / "README.md").write_text(
        "# data 分支\n\n由 `python -m pipeline` 自動維護的正規化資料（gzip CSV）與 manifest.json。每月 squash。\n",
        encoding="utf-8",
    )
    return "created"


def commit_and_push(data_dir: Path, message: str, *, squash_monthly: bool = True, push: bool = True) -> str:
    _git("config", "user.name", "github-actions[bot]", cwd=data_dir)
    _git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com", cwd=data_dir)
    _git("add", "-A", cwd=data_dir)
    if not _git("status", "--porcelain", cwd=data_dir):
        return "no-changes"
    _git("commit", "-q", "-m", message, cwd=data_dir)
    force = False
    if squash_monthly:
        root_date = _git("log", "--reverse", "--format=%cI", cwd=data_dir).splitlines()
        count = int(_git("rev-list", "--count", "HEAD", cwd=data_dir) or "0")
        month = datetime.now(TPE).strftime("%Y-%m")
        if count > 1 and root_date and not root_date[0].startswith(month):
            tree = _git("rev-parse", "HEAD^{tree}", cwd=data_dir)
            new = _git("commit-tree", tree, "-m", f"data snapshot {month}（每月 squash）", cwd=data_dir)
            _git("reset", "-q", "--soft", new, cwd=data_dir)
            force = True
            log.info("data 分支已 squash 為單一 commit（%s）", month)
    if not push:
        return "committed"
    args = ["push", "origin", f"HEAD:{BRANCH}"]
    if force:
        args.insert(1, "--force")
    for attempt in range(4):
        res = subprocess.run(["git", *args], cwd=data_dir, capture_output=True, text=True)
        if res.returncode == 0:
            return "pushed" + (" (squashed)" if force else "")
        log.warning("push 失敗（第 %d 次）：%s", attempt + 1, res.stderr.strip())
        if not force:
            subprocess.run(["git", "pull", "--rebase", "origin", BRANCH], cwd=data_dir, capture_output=True)
    raise RuntimeError("data 分支 push 失敗")
