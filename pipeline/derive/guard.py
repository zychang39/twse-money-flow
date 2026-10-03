"""衍生資料守門（2026-10-02 健檢 M1-8）：部署前比對新舊版本，欄位缺漏、日期倒退、筆數驟降時讓部署失敗、保留前一版。

GitHub Pages 沒有版本：唯一的「前一版」是目前線上的 data/*.json。deploy.yml 先把線上的 meta.json、summary.json、
strategies.json、evidence.json 下載到 prev/，再執行 `python -m pipeline guard --out web/public/data --previous prev`；
任一規則不過就以非零結束、不上傳新版（線上維持前一版）。沒有前一版（第一次部署、線上抓不到）時只做欄位檢查。

規則（全部寫在這裡，不得在部署時放寬）：
1. meta.json：market_date 不得早於前一版；status 不得為 no_data。
2. summary.json：columns 必含 REQUIRED_SUMMARY；列數 ≥ 前一版的 MIN_ROW_RATIO；日期不得早於前一版。
3. strategies.json：存在且 strategies 非空；每一套都有 id／label／grade；上架（有效／觀察中）策略數不得為 0 當前一版 > 0 且
   這一版的 evidence 有錯誤（評估失敗時 strategies.json 不會被寫出，由第 3 條擋下）。
4. evidence.json：meta 不得有 error；rows 數 ≥ 前一版的 MIN_ROW_RATIO。
5. 權益曲線：每一條有值的基準線在起訖兩端都有值（第一個與最後一個週取樣日），缺的列入 warnings（不擋部署，前端寫原因）。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

REQUIRED_SUMMARY = [
    "code",
    "name",
    "market",
    "close",
    "change_pct",
    "volume_lots",
    "foreign_net_lots",
    "trust_net_lots",
    "composite",
]
MIN_ROW_RATIO = 0.8


def _load(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _listed(s: dict[str, Any]) -> bool:
    """上架：2026-10-03 起 grade 為物件（id＝valid／sig_only／watch／invalid）；舊版為字串（有效／觀察中／停用）。"""
    g = s.get("grade")
    if isinstance(g, dict):
        return g.get("id") in ("valid", "sig_only", "watch") and bool(s.get("enabled", True))
    return g in ("有效", "觀察中")


def check(out: Path, previous: Path | None) -> dict[str, Any]:
    """回傳 {"ok": bool, "errors": [...], "warnings": [...], "compared": bool}。"""
    errors: list[str] = []
    warnings: list[str] = []
    prev_dir = previous if previous is not None and previous.exists() else None
    meta, summary = _load(out / "meta.json"), _load(out / "summary.json")
    strategies, evidence = _load(out / "strategies.json"), _load(out / "evidence.json")
    p_meta = _load(prev_dir / "meta.json") if prev_dir else None
    p_summary = _load(prev_dir / "summary.json") if prev_dir else None
    p_strategies = _load(prev_dir / "strategies.json") if prev_dir else None
    p_evidence = _load(prev_dir / "evidence.json") if prev_dir else None
    compared = any(x is not None for x in (p_meta, p_summary, p_strategies, p_evidence))

    # 1. meta
    if not isinstance(meta, dict):
        errors.append("meta.json 缺少或無法解析")
    else:
        if meta.get("status") == "no_data" or not meta.get("market_date"):
            errors.append("meta.json 沒有市場最新交易日（status no_data）")
        if (
            p_meta
            and meta.get("market_date")
            and p_meta.get("market_date")
            and meta["market_date"] < p_meta["market_date"]
        ):
            errors.append(f"market_date 倒退：{meta['market_date']} < 前一版 {p_meta['market_date']}")
    # 2. summary
    if not isinstance(summary, dict) or not isinstance(summary.get("rows"), list):
        errors.append("summary.json 缺少或沒有 rows")
    else:
        cols = summary.get("columns") or []
        missing = [c for c in REQUIRED_SUMMARY if c not in cols]
        if missing:
            errors.append(f"summary.json 缺少欄位：{'、'.join(missing)}")
        n = len(summary["rows"])
        if n == 0:
            errors.append("summary.json 沒有任何股票")
        if isinstance(p_summary, dict) and isinstance(p_summary.get("rows"), list) and p_summary["rows"]:
            pn = len(p_summary["rows"])
            if n < pn * MIN_ROW_RATIO:
                errors.append(f"summary.json 列數驟降：{n} < 前一版 {pn} 的 {MIN_ROW_RATIO:.0%}")
            if summary.get("date") and p_summary.get("date") and summary["date"] < p_summary["date"]:
                errors.append(f"summary.json 日期倒退：{summary['date']} < 前一版 {p_summary['date']}")
    # 3. strategies
    if (
        not isinstance(strategies, dict)
        or not isinstance(strategies.get("strategies"), list)
        or not strategies["strategies"]
    ):
        errors.append("strategies.json 缺少或沒有策略（指標效度評估可能失敗）")
    else:
        for s in strategies["strategies"]:
            for k in ("id", "label", "grade"):
                if not s.get(k):
                    errors.append(f"strategies.json 的 {s.get('id') or '?'} 缺少 {k}")
                    break
        live = [s for s in strategies["strategies"] if _listed(s)]
        if isinstance(p_strategies, dict):
            p_live = [s for s in p_strategies.get("strategies", []) if _listed(s)]
            if p_live and not live:
                warnings.append(f"上架策略由 {len(p_live)} 套變為 0 套（分級是資料驅動，記錄但不擋部署）")
        # 5. 權益曲線的基準線起訖
        for s in strategies["strategies"]:
            cv = s.get("curve") or {}
            if not cv.get("dates"):
                continue
            lines = {"tr": cv.get("bench") or [], **(cv.get("etf") or {})}
            for key, vals in lines.items():
                if not vals:
                    warnings.append(f"{s.get('id')} 權益曲線沒有 {key} 基準線")
                elif vals[0] is None or vals[-1] is None:
                    warnings.append(f"{s.get('id')} 權益曲線 {key} 在起訖日沒有值")
    # 4. evidence
    if not isinstance(evidence, dict) or not isinstance(evidence.get("rows"), list):
        errors.append("evidence.json 缺少或沒有 rows")
    else:
        if (evidence.get("meta") or {}).get("error"):
            errors.append(f"evidence.json 評估失敗：{evidence['meta']['error']}")
        if isinstance(p_evidence, dict) and isinstance(p_evidence.get("rows"), list) and p_evidence["rows"]:
            pn, n = len(p_evidence["rows"]), len(evidence["rows"])
            if n < pn * MIN_ROW_RATIO:
                errors.append(f"evidence.json 指標數驟降：{n} < 前一版 {pn} 的 {MIN_ROW_RATIO:.0%}")
    return {"ok": not errors, "errors": errors, "warnings": warnings, "compared": compared}
