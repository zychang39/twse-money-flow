"""精簡有效清單（2026-10-01 審查 B）：對策略庫每一套（含波段策略）算校正後 t、每月觸發數、樣本內／外，
依規則標示處置（淘汰／去重／環境依賴／排序），並給出有效性排名（1 最前）。

規則（使用者指定，順序處理）：
1. 淘汰：校正後 t < 2、扣成本超額 ≤ 0、或樣本外績效 < 樣本內的 50%。
2. 去重：兩訊號每日持倉超額的相關係數 > 0.8 時只留較強者（校正後 t 高者）。
3. 環境依賴：需有適用環境的判定規則（判定為「環境依賴」的指標本身有規則：大盤 240 日線、60 日趨勢或季底），否則淘汰。
4. 仍超過上限時依「校正後 t × ln(1 + 每月觸發數)」排序取前 N，並確保籌碼、動能、基本面各至少一套。
5. 不足 N 套就維持實際數量。
處置只寫進 strategies.json（selection 區塊）與報告；**實際停用一律由註冊清單旗標（config/strategies.yml、swing.yml 的
enabled）決定**，程式不自動改旗標，使用者在 PR 驗收。
"""

from __future__ import annotations

import logging
import math
from typing import Any

import pandas as pd

from pipeline.core import config
from pipeline.evidence import audit, engine, verdict
from pipeline.evidence.run import EventRunner

log = logging.getLogger(__name__)

MAX_SLOTS = 15
FAMILY_MIN = ("籌碼", "動能", "基本面")


def score(t_corr: float | None, per_month: float | None) -> float | None:
    if t_corr is None or per_month is None:
        return None
    return round(float(t_corr) * math.log1p(max(float(per_month), 0.0)), 3)


def annotate(lib: dict[str, Any], res: dict[str, Any], *, max_slots: int = MAX_SLOTS) -> dict[str, Any]:
    """在 strategies.json 的每一套加上 t_corr、per_month、selection、rank；回傳摘要。"""
    ctx = res["_ctx"]
    ev, mk, uni, c = ctx["ev"], ctx["mk"], ctx["uni"], ctx["cfg"]
    H = int(c["primary_horizon"])
    r = EventRunner(ev, mk, uni, c)
    series: dict[str, pd.Series] = {}
    rows: dict[str, dict[str, Any]] = {}
    for s in lib["strategies"]:
        sid = s["id"]
        if s.get("kind") == "swing":
            sw = s.get("swing") or {}
            full = sw.get("full") or {}
            seg = sw.get("segments") or {}
            ins = (seg.get("dev") or {}).get("mean_excess")
            oos = (seg.get("test") or seg.get("val") or {}).get("mean_excess")
            s["t_corr"], s["per_month"] = full.get("t_corr"), full.get("per_month")
            rows[sid] = {"ins": ins, "oos": oos, "excess": full.get("mean_excess"), "family": s.get("family") or "組合"}
            continue
        keep = ctx["tests"].get(s.get("test"))
        if keep is None:
            continue
        fr = r.frames(keep["mask"], str(keep["start"]), [H])[H]
        d = engine.dedupe(fr)
        if d.empty:
            continue
        ct = audit.corrected_t(d, H)
        pm, _ = audit.per_month(d, str(keep["start"]), ev.dates[-1])
        det = res["details"].get(s.get("test")) or {}
        groups = (((det.get("variants") or {}).get("main") or {}).get("horizons") or {}).get(str(H), {}).get(
            "groups"
        ) or {}
        s["t_corr"], s["per_month"] = ct["t_corr"], pm
        rows[sid] = {
            "ins": (groups.get("ins") or {}).get("mean_excess"),
            "oos": (det.get("oos") or {}).get("mean_excess"),
            "excess": s.get("mean_excess"),
            "family": _family(res, s.get("test")),
        }
        series[sid] = audit.daily_series(mk, d)
    corr = audit.correlation(series) if len(series) > 1 else {"pairs": []}
    # 1. 淘汰
    status: dict[str, list[str]] = {}
    for s in lib["strategies"]:
        sid = s["id"]
        if sid not in rows:
            continue
        reasons = []
        tc, ex = s.get("t_corr"), rows[sid]["excess"]
        ins, oos = rows[sid]["ins"], rows[sid]["oos"]
        if tc is None or tc < 2:
            reasons.append(f"校正後 t {tc} < 2")
        if ex is None or ex <= 0:
            reasons.append(f"扣成本超額 {ex}% ≤ 0")
        if ins is not None and oos is not None and ins > 0 and oos < ins * 0.5:
            reasons.append(f"樣本外 {oos}% < 樣本內 {ins}% 的 50%")
        if s.get("verdict") == verdict.ENV and not s.get("env"):
            reasons.append("環境依賴但沒有適用環境的判定規則")
        if not s.get("enabled"):
            reasons.append("未上架（判定、上線門檻或註冊旗標未通過），不進有效清單")
        status[sid] = reasons
    # 2. 去重（只在存活者之間）
    alive = [sid for sid, rs in status.items() if not rs]
    for p in corr.get("pairs", []):
        a, b = p["a"], p["b"]
        if a in alive and b in alive and p["corr"] > 0.8:
            ta, tb = _t(lib, a), _t(lib, b)
            loser = a if ta < tb else b
            status[loser].append(f"與 {_label(lib, a if loser == b else b)} 相關 {p['corr']} > 0.8，留較強者")
            alive.remove(loser)
    # 4. 排序與名額
    scored = sorted(alive, key=lambda sid: -(score(_t(lib, sid), _pm(lib, sid)) or -1e9))
    chosen = scored[:max_slots]
    if len(scored) > max_slots:
        for fam in FAMILY_MIN:
            if not any(rows[sid]["family"] == fam for sid in chosen):
                cand = next((sid for sid in scored if rows[sid]["family"] == fam), None)
                if cand:
                    chosen[-1] = cand
        for sid in scored[max_slots:]:
            if sid not in chosen:
                status[sid].append("超過 15 套名額（依校正後 t × ln(1 + 每月觸發) 排序）")
    rank = {sid: i + 1 for i, sid in enumerate(sorted(chosen, key=lambda sid: scored.index(sid)))}
    for s in lib["strategies"]:
        sid = s["id"]
        if sid not in rows:
            continue
        sel = {
            "score": score(s.get("t_corr"), s.get("per_month")),
            "reasons": status.get(sid, []),
            "status": "保留" if sid in rank else "淘汰",
            "ins": rows[sid]["ins"],
            "oos": rows[sid]["oos"],
            "family": rows[sid]["family"],
            "registered": s.get("registered", True),
        }
        s["selection"] = sel
        s["rank"] = rank.get(sid)
    summary = {
        "kept": [sid for sid in rank],
        "dropped": {sid: rs for sid, rs in status.items() if rs},
        "correlation_pairs": [p for p in corr.get("pairs", []) if abs(p["corr"]) >= 0.5],
        "max_slots": max_slots,
    }
    lib["selection"] = summary
    log.info("精簡：保留 %d 套，淘汰 %d 套", len(rank), sum(1 for v in status.values() if v))
    return summary


def _t(lib: dict[str, Any], sid: str) -> float:
    s = next(x for x in lib["strategies"] if x["id"] == sid)
    return float(s.get("t_corr") or -1e9)


def _pm(lib: dict[str, Any], sid: str) -> float | None:
    s = next(x for x in lib["strategies"] if x["id"] == sid)
    return s.get("per_month")


def _label(lib: dict[str, Any], sid: str) -> str:
    return str(next(x for x in lib["strategies"] if x["id"] == sid).get("label", sid))


def _family(res: dict[str, Any], tid: str | None) -> str:
    for row in res["rows"]:
        if row.get("id") == tid:
            return str(row.get("family") or "組合")
    return "組合"


def registry_flags() -> dict[str, bool]:
    """註冊清單目前的旗標（strategies.yml 與 swing.yml），報告用。"""
    out = {}
    for s in config.load("strategies")["strategies"]:
        out[s["id"]] = bool(s.get("enabled", True))
    for s in config.load("swing")["strategies"]:
        out[s["id"]] = bool(s.get("enabled", True))
    return out


def markdown(lib: dict[str, Any]) -> str:
    lines = [
        "| 排名 | 策略 | 類別 | 判定 | 校正後 t | 10 日超額 % | 每月觸發 | 樣本內 | 樣本外 | 分數 | 處置 | 理由 |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    items = sorted(
        lib["strategies"], key=lambda s: (s.get("rank") is None, s.get("rank") or 0, -(s.get("t_corr") or -99))
    )
    for s in items:
        sel = s.get("selection") or {}
        ex = s.get("mean_excess")
        lines.append(
            f"| {s.get('rank') or '—'} | {s['label']} | {sel.get('family', '—')} | {s.get('verdict')} | {audit._f(s.get('t_corr'), sign=False)} | "
            f"{audit._f(ex)} | {s.get('per_month', '—')} | {audit._f(sel.get('ins'))} | {audit._f(sel.get('oos'))} | {sel.get('score', '—')} | "
            f"{sel.get('status', '—')}{'' if s.get('registered', True) else '（註冊清單已停用）'} | {'；'.join(sel.get('reasons') or []) or '—'} |"
        )
    return "\n".join(lines) + "\n"
