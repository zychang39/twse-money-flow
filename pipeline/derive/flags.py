"""風險旗標（獨立顯示、不併入分數）與處置風險預警。"""

from __future__ import annotations

from typing import Any

import pandas as pd

from pipeline.core import config
from pipeline.derive.metrics import MetricPanels


def attention_counts(attention: pd.DataFrame, dates: list[str]) -> pd.DataFrame:
    """每檔近期注意紀錄統計：連續注意天數、近 10／30 個交易日注意次數（截至最新交易日）。"""
    if attention.empty:
        return pd.DataFrame(columns=["code", "consecutive", "in10", "in30", "last_reason"])
    recent = dates[-30:]
    att = attention[attention["date"].isin(recent)]
    rows = []
    for code, part in att.groupby("code"):
        days = set(part["date"])
        consecutive = 0
        for d in reversed(recent):
            if d in days:
                consecutive += 1
            else:
                break
        rows.append(
            {
                "code": code,
                "consecutive": consecutive,
                "in10": sum(1 for d in recent[-10:] if d in days),
                "in30": len(days),
                "last_reason": str(part.sort_values("date").iloc[-1].get("reason", ""))[:160],
                "last_date": max(days),
            }
        )
    return pd.DataFrame(rows)


def disposition_active(disposition: pd.DataFrame, day: str) -> pd.DataFrame:
    if disposition.empty:
        return disposition
    d = disposition.dropna(subset=["start", "end"])
    return d[(d["start"] <= day) & (d["end"] >= day)]


def build_flags(ds: Any, p: Any, mp: MetricPanels, at: int = -1) -> dict[str, list[dict[str, Any]]]:
    """at：第幾個交易日（預設最新）。前一日的旗標用於找出「新出現的風險旗標」。"""
    th = config.thresholds()
    rf = th["risk_flags"]
    dw = th["disposition_warning"]
    n = len(p.dates) + at if at < 0 else at
    last = p.dates[n]
    is_latest = n == len(p.dates) - 1
    flags: dict[str, list[dict[str, Any]]] = {}

    def add(code: str, fid: str, level: str = "warn", detail: str | None = None) -> None:
        flags.setdefault(code, []).append(
            {"id": fid, "label": rf[fid]["label"], "level": level, **({"detail": detail} if detail else {})}
        )

    # 注意股（當日）
    if not ds.attention.empty:
        for _, r in ds.attention[ds.attention["date"] == last].iterrows():
            add(r["code"], "attention", "warn", str(r.get("reason", ""))[:160])
    # 處置股（處置期間內）
    for _, r in disposition_active(ds.disposition, last).iterrows():
        interval = r.get("interval_minutes")
        detail = f"{r['start']}～{r['end']}"
        if interval == interval and interval:
            detail += f"，約每 {int(interval)} 分鐘撮合"
        add(r["code"], "disposition", "danger", detail)
    # 處置風險：官方名單 + 自行累計
    official = set(ds.attention_accum["code"]) if (is_latest and not ds.attention_accum.empty) else set()
    counts = attention_counts(ds.attention, p.dates[: n + 1])
    in_disp = set(disposition_active(ds.disposition, last)["code"]) if not ds.disposition.empty else set()
    for code in official - in_disp:
        sit = ds.attention_accum[ds.attention_accum["code"] == code]["situation"].iloc[0]
        add(code, "disposition_risk", "danger", f"官方名單：{sit}")
    for _, r in counts.iterrows():
        code = r["code"]
        if code in official or code in in_disp:
            continue
        reasons = []
        if r["consecutive"] >= dw["consecutive_days"]:
            reasons.append(f"已連續 {r['consecutive']} 日注意")
        if r["in10"] >= dw["within_10_days"]:
            reasons.append(f"近 10 日注意 {r['in10']} 次")
        if r["in30"] >= dw["within_30_days"]:
            reasons.append(f"近 30 日注意 {r['in30']} 次")
        if reasons:
            add(code, "disposition_risk", "warn", "、".join(reasons))
    # 週轉率、當沖、融資使用率
    turnover = mp.get("turnover")
    t5 = turnover.iloc[max(0, n - 4) : n + 1].mean()
    dt = mp.get("daytrade_pct")
    mu = mp.get("margin_usage")
    for code in p.codes:
        t1 = turnover[code].iloc[n]
        if (t1 == t1 and t1 > rf["turnover_hot"]["daily_pct"]) or (
            t5[code] == t5[code] and t5[code] > rf["turnover_hot"]["avg5_pct"]
        ):
            add(code, "turnover_hot", "warn", f"當日週轉率 {t1:.1f}%、5 日平均 {t5[code]:.1f}%")
        d = dt[code].iloc[n]
        if d == d and d > rf["daytrade_high"]["pct"]:
            add(code, "daytrade_high", "warn", f"當沖比率 {d:.1f}%")
        m = mu[code].iloc[n]
        if m == m and m > rf["margin_usage_high"]["pct"]:
            add(code, "margin_usage_high", "warn", f"融資使用率 {m:.1f}%")
    # 內部人申報轉讓（有效期間內）
    insider = ds.table("insider") if hasattr(ds, "table") else pd.DataFrame()
    if not insider.empty:
        for _, r in insider.iterrows():
            if str(r.get("start") or "") <= last <= str(r.get("end") or "9999"):
                shares = r.get("shares")
                amount = f"{int(shares):,} 股" if shares == shares and shares else ""
                who = r.get("holder_type") or "內部人"
                add(
                    r["code"],
                    "insider_transfer",
                    "warn",
                    f"{who} 申報轉讓 {amount}（{r.get('start')}～{r.get('end')}）",
                )
    # 資料過期
    max_lag = int(rf["stale_data"]["max_lag_days"])
    upto = p.close.iloc[: n + 1]
    last_idx = {c: upto[c].last_valid_index() for c in p.codes}
    pos = {d: i for i, d in enumerate(p.dates)}
    for code, d in last_idx.items():
        if d is not None and n - pos[d] > max_lag:
            add(code, "stale_data", "warn", f"最新資料 {d}")
    return flags


def disposition_watchlist(ds: Any, p: Any) -> dict[str, Any]:
    """處置風險預警清單頁資料。"""
    last = p.dates[-1]
    counts = attention_counts(ds.attention, p.dates)
    dw = config.thresholds()["disposition_warning"]
    official = ds.attention_accum if not ds.attention_accum.empty else pd.DataFrame(columns=["code", "situation"])
    active = disposition_active(ds.disposition, last)
    rows = []
    for _, r in counts.iterrows():
        risk = (
            r["consecutive"] >= dw["consecutive_days"]
            or r["in10"] >= dw["within_10_days"]
            or r["in30"] >= dw["within_30_days"]
            or r["code"] in set(official["code"])
        )
        rows.append(
            {
                "code": r["code"],
                "name": p.names.get(r["code"], r["code"]),
                "consecutive": int(r["consecutive"]),
                "in10": int(r["in10"]),
                "in30": int(r["in30"]),
                "last_date": r["last_date"],
                "reason": r["last_reason"],
                "risk": bool(risk),
                "official": r["code"] in set(official["code"]),
            }
        )
    rows.sort(key=lambda x: (not x["risk"], -x["in30"], -x["consecutive"]))
    disp = [
        {
            "code": r["code"],
            "name": p.names.get(r["code"], r.get("name", r["code"])),
            "start": r["start"],
            "end": r["end"],
            "reason": r.get("reason"),
            "measure": r.get("measure"),
            "interval_minutes": None
            if r.get("interval_minutes") != r.get("interval_minutes")
            else r.get("interval_minutes"),
        }
        for _, r in active.iterrows()
    ]
    off = [
        {"code": r["code"], "name": p.names.get(r["code"], r["code"]), "situation": r["situation"]}
        for _, r in official.iterrows()
    ]
    return {"date": last, "watch": rows[:200], "disposition": disp, "official": off, "rules": dw}
