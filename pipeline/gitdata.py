"""data 分支（孤兒分支）操作：以 git worktree 掛在工作目錄的 data/，提交並推送；每月 squash 一次。"""

from __future__ import annotations

import json
import logging
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Any

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


def merge_manifests(ours: dict[str, Any], theirs: dict[str, Any]) -> dict[str, Any]:
    """E-05：每日任務與回補同時寫入 data 分支時，合併兩邊的 manifest（不是整份覆蓋）。

    - 各來源：取 last_attempt 較新的一方；last_success／rows 取兩邊較新的成功日
    - closed_days、backfilled：聯集；coverage：起日取早、迄日取晚；runs：依時間合併（保留 40 筆）
    - 其他欄位（last_target_date、digest_date、backfill_pending…）：取 updated_at 較新的一方
    """
    newer_ours = str(ours.get("updated_at") or "") >= str(theirs.get("updated_at") or "")
    out: dict[str, Any] = {**(theirs if newer_ours else ours), **(ours if newer_ours else theirs)}
    for k in set(theirs) - set(ours):
        out[k] = theirs[k]
    sources: dict[str, Any] = {}
    for sid in sorted(set(ours.get("sources", {})) | set(theirs.get("sources", {}))):
        a, b = ours.get("sources", {}).get(sid), theirs.get("sources", {}).get(sid)
        if a is None or b is None:
            sources[sid] = a if a is not None else b
            continue
        pick = dict(a if str(a.get("last_attempt") or "") >= str(b.get("last_attempt") or "") else b)
        best = a if str(a.get("last_success") or "") >= str(b.get("last_success") or "") else b
        if best.get("last_success"):
            pick["last_success"], pick["rows"] = best.get("last_success"), best.get("rows")
        sources[sid] = pick
    out["sources"] = sources
    out["closed_days"] = sorted(set(ours.get("closed_days", [])) | set(theirs.get("closed_days", [])))
    bf: dict[str, list[str]] = {}
    for side in (ours.get("backfilled", {}), theirs.get("backfilled", {})):
        for key, months in side.items():
            bf[key] = sorted(set(bf.get(key, [])) | set(months))
    if bf:
        out["backfilled"] = bf
    cov: dict[str, dict[str, str]] = {}
    for side in (ours.get("coverage", {}), theirs.get("coverage", {})):
        for sid, c in side.items():
            cur = cov.setdefault(sid, {})
            if c.get("start") and (not cur.get("start") or c["start"] < cur["start"]):
                cur["start"] = c["start"]
            if c.get("end") and (not cur.get("end") or c["end"] > cur["end"]):
                cur["end"] = c["end"]
    if cov:
        out["coverage"] = cov
    runs = {(r.get("task"), r.get("at")): r for r in [*theirs.get("runs", []), *ours.get("runs", [])]}
    out["runs"] = sorted(runs.values(), key=lambda r: str(r.get("at") or ""))[-40:]
    return out


def _sync_with_remote(data_dir: Path) -> None:
    """遠端 data 分支在這段期間被其他任務推進：rebase 到遠端最新（檔案衝突以本次為準），再合併 manifest。"""
    manifest = data_dir / "manifest.json"
    ours = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else {}
    _git("fetch", "origin", BRANCH, cwd=data_dir)
    # rebase 時的 theirs＝正在重播的本次提交；二進位 gzip CSV 衝突同樣以本次為準
    res = subprocess.run(["git", "rebase", "-X", "theirs", "FETCH_HEAD"], cwd=data_dir, capture_output=True, text=True)
    if res.returncode != 0:
        subprocess.run(["git", "rebase", "--abort"], cwd=data_dir, capture_output=True)
        _git("merge", "--no-edit", "-X", "ours", "FETCH_HEAD", cwd=data_dir)
    theirs_text = _git("show", "FETCH_HEAD:manifest.json", cwd=data_dir, check=False)
    if ours and theirs_text:
        merged = merge_manifests(ours, json.loads(theirs_text))
        manifest.write_text(json.dumps(merged, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        _git("add", "manifest.json", cwd=data_dir)
        if _git("status", "--porcelain", cwd=data_dir):
            _git("commit", "-q", "--amend", "--no-edit", cwd=data_dir)


def commit_and_push(
    data_dir: Path,
    message: str,
    *,
    squash_monthly: bool = True,
    push: bool = True,
    attempts: int = 6,
    sleep: Any = time.sleep,
) -> str:
    """提交並推送。E-05：每日任務與回補可能同時推送 → 失敗時 rebase 到遠端最新、合併 manifest 後重試（指數退避）；
    每月 squash 以 --force-with-lease 保護：遠端已被其他任務推進就放棄這次 squash，改用一般推送，不會蓋掉別人的提交。"""
    _git("config", "user.name", "github-actions[bot]", cwd=data_dir)
    _git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com", cwd=data_dir)
    _git("add", "-A", cwd=data_dir)
    if not _git("status", "--porcelain", cwd=data_dir):
        return "no-changes"
    base = _git("rev-parse", "HEAD", cwd=data_dir, check=False) or None
    _git("commit", "-q", "-m", message, cwd=data_dir)
    head = _git("rev-parse", "HEAD", cwd=data_dir)
    squashed = False
    if squash_monthly and base:
        root_date = _git("log", "--reverse", "--format=%cI", cwd=data_dir).splitlines()
        count = int(_git("rev-list", "--count", "HEAD", cwd=data_dir) or "0")
        month = datetime.now(TPE).strftime("%Y-%m")
        if count > 1 and root_date and not root_date[0].startswith(month):
            tree = _git("rev-parse", "HEAD^{tree}", cwd=data_dir)
            new = _git("commit-tree", tree, "-m", f"data snapshot {month}（每月 squash）", cwd=data_dir)
            _git("reset", "-q", "--soft", new, cwd=data_dir)
            squashed = True
            log.info("data 分支已 squash 為單一 commit（%s）", month)
    if not push:
        return "committed"
    if squashed:
        lease = f"--force-with-lease={BRANCH}:{base}"
        res = subprocess.run(
            ["git", "push", lease, "origin", f"HEAD:{BRANCH}"], cwd=data_dir, capture_output=True, text=True
        )
        if res.returncode == 0:
            return "pushed (squashed)"
        log.warning("squash 推送被拒（遠端已有其他任務的提交），改用一般推送：%s", res.stderr.strip())
        _git("reset", "-q", "--soft", head, cwd=data_dir)
    for attempt in range(attempts):
        res = subprocess.run(["git", "push", "origin", f"HEAD:{BRANCH}"], cwd=data_dir, capture_output=True, text=True)
        if res.returncode == 0:
            return "pushed" + (f"（rebase {attempt} 次）" if attempt else "")
        log.warning("push 失敗（第 %d 次）：%s", attempt + 1, res.stderr.strip())
        try:
            _sync_with_remote(data_dir)
        except RuntimeError as exc:
            log.warning("與遠端同步失敗：%s", exc)
        sleep(min(60, 2 ** (attempt + 1)))
    raise RuntimeError("data 分支 push 失敗")
