"""風險旗標（獨立顯示、不併入分數）與處置／注意清單（只呈現交易所公告的事實）。"""

from __future__ import annotations

from typing import Any

import pandas as pd

from pipeline.core import config
from pipeline.derive.export import text
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


def quality_flags(q: dict[str, Any], pe_pct: float | None, pb_pct: float | None) -> list[tuple[str, str]]:
    """生意體質的兩個風險旗標（2026-11）：[(旗標 id, 說明)]。只在「低估值」同時成立時出現。

    - cheap_but_fading：營收成長、ROIC 連年下滑且低於門檻，而本益比或淨值比在自身低檔——低估值可能反映報酬率變差。
    - cyclical_peak：ROIC 隨景氣大幅升降的公司，本益比在自身低檔、但近四季營業利益率在自身年度紀錄的高檔——
      獲利回落時本益比會變高。
    """
    cfg = config.load("quality")["flags"]
    low = float(cfg["low_percentile"])
    cheap_pe = pe_pct is not None and pe_pct == pe_pct and pe_pct <= low
    cheap_pb = pb_pct is not None and pb_pct == pb_pct and pb_pct <= low
    out: list[tuple[str, str]] = []
    if q.get("type") == "fading" and (cheap_pe or cheap_pb):
        which = "本益比" if cheap_pe else "淨值比"
        out.append(
            (
                "cheap_but_fading",
                f"{which}在自身低檔，但 ROIC 連 {q.get('down_years')} 年下滑到 {q.get('roic')}%（門檻 {q.get('hurdle'):g}%）",
            )
        )
    if q.get("type") == "cyclical" and cheap_pe and q.get("op_margin") is not None:
        hist = sorted(y[3] for y in q.get("years") or [] if y[3] is not None)
        if len(hist) >= 5:
            cut = hist[min(len(hist) - 1, int(len(hist) * float(cfg["peak_margin_percentile"]) / 100))]
            if q["op_margin"] >= cut:
                mid = hist[len(hist) // 2]
                out.append(
                    (
                        "cyclical_peak",
                        f"本益比在自身低檔，但近四季營業利益率 {q['op_margin']}% 在近 {len(hist)} 年的高檔（中位數 {mid}%）",
                    )
                )
    return out


def build_flags(
    ds: Any, p: Any, mp: MetricPanels, at: int = -1, quality: dict[str, dict[str, Any]] | None = None
) -> dict[str, list[dict[str, Any]]]:
    """at：第幾個交易日（預設最新）。前一日的旗標用於找出「新出現的風險旗標」。"""
    th = config.thresholds()
    rf = th["risk_flags"]
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
            add(r["code"], "attention", "warn", text(r.get("reason"), "注意股票")[:160])
    # 處置股（處置期間內）
    for _, r in disposition_active(ds.disposition, last).iterrows():
        interval = r.get("interval_minutes")
        detail = f"{r['start']}～{r['end']}"
        if interval == interval and interval:
            detail += f"，約每 {int(interval)} 分鐘撮合"
        add(r["code"], "disposition", "danger", detail)
    # 官方公布的注意累計名單（2026-10：只呈現交易所公布的事實；不再自行累計次數推測是否會被處置）
    official = set(ds.attention_accum["code"]) if (is_latest and not ds.attention_accum.empty) else set()
    in_disp = set(disposition_active(ds.disposition, last)["code"]) if not ds.disposition.empty else set()
    for code in sorted(official - in_disp):
        sit = ds.attention_accum[ds.attention_accum["code"] == code]["situation"].iloc[0]
        add(code, "disposition_risk", "warn", f"官方公布：{sit}")
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
    # 生意體質（2026-11）：低估值但報酬率連降、本益比低但獲利在高檔
    if quality:
        pe_p = mp.get("pe_percentile") if "pe_percentile" in mp.panels else None
        pb_p = mp.get("pb_percentile") if "pb_percentile" in mp.panels else None
        for code, q in quality.items():
            if q.get("type") not in ("fading", "cyclical") or code not in p.codes:
                continue
            pe = float(pe_p[code].iloc[n]) if pe_p is not None else None
            pb = float(pb_p[code].iloc[n]) if pb_p is not None else None
            for fid, detail in quality_flags(q, pe, pb):
                add(code, fid, "warn", detail)
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
    """處置與注意頁（2026-10）：處置中、官方公布的注意累計名單、注意次數表（連續／近 10／近 30 個營業日）。

    只呈現交易所公告的事實與次數，不做「可能進入處置」之類的預測標示。
    """
    last = p.dates[-1]
    counts = attention_counts(ds.attention, p.dates)
    official = ds.attention_accum if not ds.attention_accum.empty else pd.DataFrame(columns=["code", "situation"])
    official_codes = set(official["code"])
    active = disposition_active(ds.disposition, last)
    rows = []
    for _, r in counts.iterrows():
        rows.append(
            {
                "code": r["code"],
                "name": p.names.get(r["code"], r["code"]),
                "consecutive": int(r["consecutive"]),
                "in10": int(r["in10"]),
                "in30": int(r["in30"]),
                "last_date": r["last_date"],
                "reason": r["last_reason"],
                "official": r["code"] in official_codes,
            }
        )
    rows.sort(key=lambda x: (-x["in10"], -x["in30"], -x["consecutive"], x["code"]))
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
    return {"date": last, "watch": rows[:200], "disposition": disp, "official": off}
