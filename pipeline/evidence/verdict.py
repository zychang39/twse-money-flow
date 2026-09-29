"""1.8 有效的判定（寫死，不得事後調整）。純函式，有單元測試。"""

from __future__ import annotations

from typing import Any

from pipeline.evidence.stats import significant

VALID = "有效"
UNSTABLE = "不穩定"
ENV = "環境依賴"
INVALID = "無效"
FEW = "樣本不足"
LIMITED = "樣本範圍受限"

ENV_LABELS = {
    ("regime", "on"): "大盤在 240 日線上",
    ("regime", "off"): "大盤在 240 日線下",
    ("trend", "on"): "大盤近 60 日上漲",
    ("trend", "off"): "大盤近 60 日下跌",
    ("quarter_end", "on"): "投信季底作帳期間",
    ("quarter_end", "off"): "非季底作帳期間",
}


def years_ok(years: dict[str, Any], ratio: float) -> tuple[bool, int, int]:
    """逐年至少 ratio 的年份平均超額報酬為正（只計有樣本的年份）。"""
    vals = [y.get("mean_excess") for y in years.values() if y.get("mean_excess") is not None]
    pos = sum(1 for v in vals if v > 0)
    return (bool(vals) and pos / len(vals) >= ratio - 1e-3), pos, len(vals)  # 0.6667 ≈ 2/3


def decide(
    *,
    kind: str,
    n: int,
    main: dict[str, Any],
    years: dict[str, Any],
    oos: dict[str, Any] | None,
    sensitive: bool,
    coverage: float,
    envs: dict[str, Any] | None,
    cfg: dict[str, Any],
) -> dict[str, Any]:
    """回傳 {verdict, reasons, env}。kind：event（樣本＝去重後事件數）或 quintile（樣本＝月數）。"""
    v = cfg["verdict"]
    t_thr = float(cfg["stats"]["t_threshold"])
    reasons: list[str] = []
    if coverage < float(v["coverage_ratio"]):
        return {
            "verdict": LIMITED,
            "reasons": [
                f"納入股票數只有 universe 的 {coverage * 100:.0f}%（< {float(v['coverage_ratio']) * 100:.0f}%）"
            ],
            "env": None,
        }
    need = int(v["min_events"] if kind == "event" else v["min_months"])
    if n < need:
        unit = "筆" if kind == "event" else "個月"
        return {"verdict": FEW, "reasons": [f"樣本 {n} {unit}（< {need} {unit}）"], "env": None}
    sig = significant(main, t_thr)
    y_ok, y_pos, y_n = years_ok(years, float(v["year_pass_ratio"]))
    oos_mean = (oos or {}).get("mean_excess")
    oos_ok = oos_mean is not None and oos_mean > 0
    if sig:
        if not y_ok:
            reasons.append(f"逐年只有 {y_pos}/{y_n} 年為正")
        if not oos_ok:
            reasons.append("樣本外期間不為正" if oos_mean is not None else "樣本外期間沒有樣本")
        if sensitive:
            reasons.append("參數敏感")
        return {"verdict": UNSTABLE if reasons else VALID, "reasons": reasons, "env": None}
    for dim, sides in (envs or {}).items():
        for side, other in (("on", "off"), ("off", "on")):
            s, o = sides.get(side) or {}, sides.get(other) or {}
            if s.get("n", 0) >= need and significant(s, t_thr) and not significant(o, t_thr):
                cond = ENV_LABELS.get((dim, side), f"{dim}:{side}")
                return {
                    "verdict": ENV,
                    "reasons": [f"只在「{cond}」顯著（t {s.get('t')}）；另一環境 t {o.get('t')}"],
                    "env": {"dim": dim, "side": side, "label": cond},
                }
    m, t, ci = main.get("mean_excess"), main.get("t"), main.get("ci") or [None, None]
    if m is None or m <= 0:
        reasons.append("平均超額報酬 ≤ 0")
    elif ci[0] is None or ci[0] <= 0:
        reasons.append("bootstrap 95% 區間含 0")
    else:
        reasons.append(f"t {t} 未達多重檢定門檻 {t_thr}")
    return {"verdict": INVALID, "reasons": reasons, "env": None}


def sensitivity(grid: dict[str, float | None], chosen: str, neighbors: list[str], ratio: float) -> bool:
    """參數敏感：選定格的平均超額報酬 > 0，而相鄰格中有任一格正負號相反或不到選定格的 ratio 倍。"""
    m = grid.get(chosen)
    if m is None or m <= 0:
        return False
    for k in neighbors:
        v = grid.get(k)
        if v is None:
            continue
        if v < m * ratio:
            return True
    return False
