"""策略分級（2026-10-01 審查 B 新增；2026-10-02 第二輪改為「分級」取代全部停用）。

對策略庫每一套（含波段策略）用資料重算：40 日與 20 日扣成本超額、校正後 t、2022 前後兩段、逐年、每月觸發、樣本年數，
依 `config/evidence.yml grading` 分成三級，並給出有效性排名（1 最前）：

- **有效**：40 日與 20 日扣成本超額皆 > 0、校正後 t ≥ 3、2022 前後兩段皆為正、逐年 ≥ 70% 為正、每月觸發 ≥ 10；
  波段策略另需九項上線門檻全過（swing.gates）。樣本不足 5 年者最高只能列觀察中。標示「有效・待前瞻驗證」直到前瞻驗證滿期。
- **觀察中**：40 日扣成本超額 > 0 且校正後 t ≥ 2，但未達有效。
- **停用**：其餘；另外相關 > 0.8 的兩套只留校正後 t 高者，有效＋觀察中合計最多 15 套（依校正後 t）。

上架（enabled）＝分級在有效或觀察中 **且** 註冊清單旗標（config/strategies.yml、swing.yml 的 enabled）為 true；
程式不自動改旗標，使用者在 PR 驗收。資料回補後（例如集保全市場補齊）每日部署自動重算、自動重分級（DECISIONS #196）。
"""

from __future__ import annotations

import logging
from typing import Any

import pandas as pd

from pipeline.core import config
from pipeline.evidence import audit, engine, stats
from pipeline.evidence.run import EventRunner

log = logging.getLogger(__name__)

VALID, WATCH, OFF = "有效", "觀察中", "停用"
VALID_PENDING = "有效・待前瞻驗證"


def grading_cfg(c: dict[str, Any]) -> dict[str, Any]:
    g = dict(c.get("grading") or {})
    g.setdefault("valid", {})
    g.setdefault("watch", {})
    return g


def _pos(v: Any) -> bool:
    return v is not None and float(v) > 0


def _years_span(start: str | None, end: str | None) -> float | None:
    if not start or not end:
        return None
    return round((pd.Timestamp(end) - pd.Timestamp(start)).days / 365.25, 2)


def grade_one(row: dict[str, Any], g: dict[str, Any]) -> tuple[str, dict[str, bool], list[str]]:
    """單一策略的分級（去重與名額另外處理）。row 的鍵見 annotate。"""
    v, w = g["valid"], g["watch"]
    hs = [int(h) for h in v.get("net_excess_positive_horizons", [40, 20])]
    ex = row.get("excess") or {}
    years = row.get("years") or {}
    pos = sum(1 for x in years.values() if _pos(x))
    ratio = float(v.get("year_pass_ratio", 0.7))
    checks = {
        "net_excess": all(_pos(ex.get(h)) for h in hs),
        "t_corr": row.get("t_corr") is not None and float(row["t_corr"]) >= float(v.get("t_corr_min", 3)),
        "split": _pos(row.get("pre")) and _pos(row.get("post")),
        "years": bool(years) and pos / len(years) >= ratio - 1e-9,
        "per_month": (row.get("per_month") or 0) >= float(v.get("per_month_min", 10)),
    }
    if row.get("gates_passed") is not None:  # 波段策略另需九項上線門檻
        checks["gates"] = bool(row["gates_passed"])
    min_years = float(g.get("min_years_for_valid", 5))
    span = row.get("span_years")
    checks["sample_years"] = span is not None and span >= min_years
    labels = {
        "net_excess": "40 與 20 日扣成本超額皆 > 0：" + " / ".join(f"{ex.get(h)}%" for h in hs),
        "t_corr": f"校正後 t ≥ {v.get('t_corr_min', 3)}：{row.get('t_corr')}",
        "split": f"{v.get('split_date', '2022-01-01')[:4]} 前後皆為正：{row.get('pre')}% / {row.get('post')}%",
        "years": f"逐年 ≥ {ratio:.0%} 為正：{pos}/{len(years)}",
        "per_month": f"每月觸發 ≥ {v.get('per_month_min', 10)}：{row.get('per_month')}",
        "gates": "九項上線門檻全過",
        "sample_years": f"樣本 ≥ {min_years:.0f} 年：{span} 年",
    }
    failed = [labels[k] for k, ok in checks.items() if not ok]
    if all(checks.values()):
        return VALID, checks, []
    watch = (
        _pos(ex.get(hs[0])) and row.get("t_corr") is not None and float(row["t_corr"]) >= float(w.get("t_corr_min", 2))
    )
    if watch:
        return WATCH, checks, failed
    reasons = []
    if not _pos(ex.get(hs[0])):
        reasons.append(f"40 日扣成本超額 {ex.get(hs[0])}% ≤ 0")
    if row.get("t_corr") is None or float(row["t_corr"]) < float(w.get("t_corr_min", 2)):
        reasons.append(f"校正後 t {row.get('t_corr')} < {w.get('t_corr_min', 2)}")
    return OFF, checks, reasons or failed


def annotate(lib: dict[str, Any], res: dict[str, Any]) -> dict[str, Any]:
    """在 strategies.json 的每一套加上 grade、grade_label、grade_reason、grade_checks、t_corr、per_month、excess、rank，
    並依分級與註冊旗標決定 enabled；回傳摘要（lib["selection"]）。"""
    ctx = res["_ctx"]
    ev, mk, uni, c = ctx["ev"], ctx["mk"], ctx["uni"], ctx["cfg"]
    g = grading_cfg(c)
    H, H2 = int(c["primary_horizon"]), int(c.get("secondary_horizon", 20))
    split_date = str(g["valid"].get("split_date", "2022-01-01"))
    r = EventRunner(ev, mk, uni, c)
    series: dict[str, pd.Series] = {}
    rows: dict[str, dict[str, Any]] = {}
    for s in lib["strategies"]:
        sid = s["id"]
        if s.get("kind") == "swing":
            sw = s.get("swing") or {}
            full, other = sw.get("full") or {}, sw.get("other") or {}
            if not full:
                continue
            hold = int(sw.get("hold") or H)
            ex = {hold: full.get("mean_excess")}
            if other:
                ex[int(other["hold"])] = other.get("mean_excess")
            sp = s.get("split2022") or {}
            rows[sid] = {
                "excess": ex,
                "t_corr": full.get("t_corr"),
                "pre": (sp.get("pre") or {}).get("mean_excess"),
                "post": (sp.get("post") or {}).get("mean_excess"),
                "years": s.get("years") or {},
                "per_month": full.get("per_month"),
                "span_years": _years_span(s.get("signal_start"), s.get("signal_end")),
                "gates_passed": bool(sw.get("gates", {}).get("passed")),
                "win": full.get("win"),
                "family": s.get("family") or "組合",
                "forward": s.get("forward"),
            }
            s["t_corr"], s["per_month"] = full.get("t_corr"), full.get("per_month")
            continue
        keep = ctx["tests"].get(s.get("test"))
        if keep is None:
            continue
        start = str(keep["start"])
        fr = r.frames(keep["mask"], start, [H, H2])
        d, d2 = engine.dedupe(fr[H]), engine.dedupe(fr[H2])
        if d.empty:
            continue
        pdays = int((r.dates >= start).sum())
        ct = audit.corrected_t(d, H, period_days=pdays)
        pm, _ = audit.per_month(d, start, ev.dates[-1])
        b40, b20 = stats.brief(d, c), stats.brief(d2, c)
        years = {str(y): stats.brief(part, c).get("mean_excess") for y, part in d.groupby("year")}
        rows[sid] = {
            "excess": {H: b40.get("mean_excess"), H2: b20.get("mean_excess")},
            "t_corr": ct["t_corr"],
            "pre": stats.brief(d[d["date"] < split_date], c).get("mean_excess"),
            "post": stats.brief(d[d["date"] >= split_date], c).get("mean_excess"),
            "years": years,
            "per_month": pm,
            "span_years": _years_span(start, ev.dates[-1]),
            "gates_passed": None,
            "win": b40.get("win"),
            "family": _family(res, s.get("test")),
            "forward": None,
        }
        s["t_corr"], s["per_month"] = ct["t_corr"], pm
        s["t_corr_method"], s["concentration"] = ct.get("t_corr_method"), ct.get("concentration")
        s["mean_excess"], s["mean_gross_excess"], s["t"], s["n"] = (
            b40.get("mean_excess"),
            b40.get("mean_gross_excess"),
            b40.get("t"),
            b40.get("n"),
        )
        s["win"] = b40.get("win")
        s["excess_h"] = {str(H): b40.get("mean_excess"), str(H2): b20.get("mean_excess")}
        s["years"] = years
        s["split2022"] = {
            "date": split_date,
            "pre": stats.brief(d[d["date"] < split_date], c),
            "post": stats.brief(d[d["date"] >= split_date], c),
        }
        series[sid] = audit.daily_series(mk, d)
    for s in lib["strategies"]:
        if s.get("kind") == "swing" and s["id"] in rows and s.get("swing"):
            s["excess_h"] = {str(k): v for k, v in rows[s["id"]]["excess"].items()}
    corr = audit.correlation(series) if len(series) > 1 else {"pairs": [], "matrix": {}}
    # 1. 逐套分級
    grade: dict[str, str] = {}
    reasons: dict[str, list[str]] = {}
    checks: dict[str, dict[str, bool]] = {}
    for sid, row in rows.items():
        grade[sid], checks[sid], reasons[sid] = grade_one(row, g)
    # 2. 去重（只在有效與觀察中之間；相關 > dedupe_corr 留校正後 t 高者）
    thr = float(g.get("dedupe_corr", 0.8))
    for p in sorted(corr.get("pairs", []), key=lambda x: -abs(x["corr"])):
        a, b = p["a"], p["b"]
        if grade.get(a, OFF) != OFF and grade.get(b, OFF) != OFF and p["corr"] > thr:
            loser, winner = (a, b) if _t(rows, a) < _t(rows, b) else (b, a)
            grade[loser] = OFF
            reasons[loser] = [f"與「{_label(lib, winner)}」相關 {p['corr']} > {thr}，只留校正後 t 較高者"]
    # 3. 名額：有效＋觀察中最多 max_strategies，依校正後 t
    cap = int(g.get("max_strategies", 15))
    alive = sorted((sid for sid in grade if grade[sid] != OFF), key=lambda sid: (grade[sid] != VALID, -_t(rows, sid)))
    for sid in alive[cap:]:
        grade[sid] = OFF
        reasons[sid] = [f"超過 {cap} 套名額（依校正後 t 排序）"]
    ranked = alive[:cap]
    rank = {sid: i + 1 for i, sid in enumerate(ranked)}
    counts = {VALID: 0, WATCH: 0, OFF: 0}
    for s in lib["strategies"]:
        sid = s["id"]
        if sid not in rows:
            s["grade"], s["grade_label"], s["grade_reason"], s["enabled"], s["rank"] = (
                OFF,
                OFF,
                "沒有評估結果",
                False,
                None,
            )
            counts[OFF] += 1
            continue
        gr = grade[sid]
        registered = bool(s.get("registered", True))
        label = gr
        if gr == VALID:
            fwd = rows[sid].get("forward") or {}
            label = VALID if fwd.get("ready") and _pos(fwd.get("mean_excess")) else VALID_PENDING
        reason = "；".join(reasons[sid]) if gr != VALID else ""
        if not registered:
            reason = ("註冊清單停用" + ("；" + reason if reason else "")).strip()
        s["grade"], s["grade_label"], s["grade_reason"] = gr, label, reason
        s["grade_checks"] = checks[sid]
        s["family"] = s.get("family") or rows[sid]["family"]
        s["enabled"] = registered and gr != OFF
        s["rank"] = rank.get(sid) if registered else None
        s["selection"] = {
            "status": gr,
            "reasons": reasons[sid],
            "family": rows[sid]["family"],
            "registered": registered,
        }
        counts[gr] += 1
    summary = {
        "counts": counts,
        "kept": ranked,
        "dropped": {sid: rs for sid, rs in reasons.items() if grade[sid] == OFF},
        "correlation_pairs": [p for p in corr.get("pairs", []) if abs(p["corr"]) >= 0.5],
        "max_strategies": cap,
        "horizons": [H, H2],
    }
    lib["selection"] = summary
    log.info("分級：有效 %d、觀察中 %d、停用 %d", counts[VALID], counts[WATCH], counts[OFF])
    return summary


def _t(rows: dict[str, dict[str, Any]], sid: str) -> float:
    v = rows.get(sid, {}).get("t_corr")
    return float(v) if v is not None else -1e9


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
    hs = (lib.get("selection") or {}).get("horizons") or [40, 20]
    lines = [
        f"| 排名 | 策略 | 類別 | 分級 | 校正後 t | {hs[0]} 日扣成本超額 % | {hs[1]} 日 % | 2022 前 / 後 % | 逐年正 | 每月觸發 | 勝率 % | 年數 | 理由 |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    order = {VALID: 0, WATCH: 1, OFF: 2}
    items = sorted(
        lib["strategies"],
        key=lambda s: (order.get(s.get("grade"), 3), s.get("rank") or 999, -(s.get("t_corr") or -99)),
    )
    for s in items:
        ex = s.get("excess_h") or {}
        sp = s.get("split2022") or {}
        years = s.get("years") or {}
        pos = sum(1 for v in years.values() if v is not None and v > 0)
        span = _years_span(s.get("signal_start"), s.get("signal_end"))
        lines.append(
            f"| {s.get('rank') or '—'} | {s['label']} | {s.get('family', '—')} | {s.get('grade_label', s.get('grade', '—'))} | "
            f"{audit._f(s.get('t_corr'), sign=False)} | {audit._f(ex.get(str(hs[0])))} | {audit._f(ex.get(str(hs[1])))} | "
            f"{audit._f((sp.get('pre') or {}).get('mean_excess'))} / {audit._f((sp.get('post') or {}).get('mean_excess'))} | "
            f"{pos}/{len(years)} | {s.get('per_month', '—')} | {audit._f(s.get('win'), 1, False)} | {span if span is not None else '—'} | "
            f"{s.get('grade_reason') or '—'}{'' if s.get('registered', True) else '（註冊清單已停用）'} |"
        )
    return "\n".join(lines) + "\n"
