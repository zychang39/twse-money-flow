"""個股頁延伸資料：月營收表、近期事件、法人成本線、規則式健檢摘要。"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.derive import indicators as ind
from pipeline.derive.export import arr


def revenue_table(revenue: pd.DataFrame, code: str, months: int = 24) -> list[dict[str, Any]]:
    if revenue.empty:
        return []
    part = (
        revenue[revenue["code"] == code].dropna(subset=["revenue"]).sort_values("ym").drop_duplicates("ym", keep="last")
    )
    if part.empty:
        return []
    s = pd.Series(part["revenue"].to_numpy(dtype=float), index=part["ym"].tolist())
    ly = dict(zip(part["ym"], part.get("revenue_last_year", pd.Series([np.nan] * len(part))), strict=True))
    out = []
    for ym in s.index[-months:]:
        prev_ym = f"{int(ym[:4]) - 1:04d}-{ym[5:7]}"
        base = s.get(prev_ym, ly.get(ym))
        pos = s.index.get_loc(ym)
        prev_m = s.iloc[pos - 1] if isinstance(pos, int) and pos > 0 else None
        out.append(
            {
                "ym": ym,
                "revenue": float(s[ym]),
                "yoy": round((s[ym] / base - 1) * 100, 2) if base and base == base else None,
                "mom": round((s[ym] / prev_m - 1) * 100, 2) if prev_m else None,
            }
        )
    return out


def events_for(ds: Any, code: str, since: str) -> list[dict[str, Any]]:
    ev: list[dict[str, Any]] = []

    def pick(df: pd.DataFrame, col: str = "date") -> pd.DataFrame:
        if df is None or df.empty or "code" not in df.columns:
            return pd.DataFrame()
        return df[(df["code"] == code) & (df[col].astype(str) >= since)]

    for _, r in pick(ds.exright).iterrows():
        cash = r.get("cash_dividend")
        txt = f"除{r.get('kind', '')}，參考價 {r.get('ref_price')}（權值＋息值 {r.get('rights_dividend')}）"
        if cash == cash and cash:
            txt = f"除{r.get('kind', '')}，現金股利 {cash:g} 元，參考價 {r.get('ref_price')}"
        ev.append({"date": r["date"], "type": "除權息", "text": txt})
    for _, r in pick(ds.exright_notice).iterrows():
        cash = r.get("cash_dividend")
        txt = f"預告除{r.get('kind', '')}" + (f"，現金股利 {cash:g} 元" if cash == cash and cash else "")
        ev.append({"date": r["date"], "type": "預告", "text": txt})
    for _, r in pick(ds.capreduce).iterrows():
        ev.append(
            {"date": r["date"], "type": "減資", "text": f"{r.get('reason', '')}，恢復買賣參考價 {r.get('ref_price')}"}
        )
    for df in ds.extra.get("splits", []):
        for _, r in pick(df).iterrows():
            ev.append(
                {"date": r["date"], "type": str(r.get("kind", "分割")), "text": f"恢復買賣參考價 {r.get('ref_price')}"}
            )
    for _, r in pick(ds.attention).iterrows():
        ev.append({"date": r["date"], "type": "注意", "text": str(r.get("reason", ""))[:120]})
    for _, r in pick(ds.disposition, "announce_date").iterrows():
        iv = r.get("interval_minutes")
        extra = f"，約每 {int(iv)} 分鐘撮合" if iv == iv and iv else ""
        ev.append({"date": r["announce_date"], "type": "處置", "text": f"{r.get('start')}～{r.get('end')}{extra}"})
    for df in ds.extra.get("calendar", []):
        for _, r in pick(df).iterrows():
            ev.append({"date": r["date"], "type": str(r.get("type", "")), "text": str(r.get("text", ""))[:120]})
    ev.sort(key=lambda e: str(e["date"]), reverse=True)
    return ev[:30]


def cost_lines(p: Any, code: str, idx: list[str]) -> dict[str, list[Any]]:
    windows = config.thresholds()["indicators"]["cost_line_windows"]
    avg = (p.value[code] / p.volume[code]).where(p.volume[code] > 0)
    out = {}
    for who, net in (("foreign", p.foreign_net[code]), ("trust", p.trust_net[code])):
        for w in windows:
            line = ind.cost_line(net, avg, int(w)).reindex(idx)
            if line.notna().any():
                out[f"{who}{w}"] = arr(line.to_numpy(), 2)
    return out


def health_summary(
    code: str, row: dict[str, Any], flags: list[dict[str, Any]], fair: dict[str, Any] | None, rev: dict[str, Any]
) -> list[str]:
    """規則式健檢摘要（不使用 LLM）：正面與需留意事項各自列出，附數值依據。"""
    good: list[str] = []
    warn: list[str] = []
    fs, ts = row.get("foreign_streak") or 0, row.get("trust_streak") or 0
    if ts >= 3:
        good.append(f"投信連買 {int(ts)} 日")
    elif ts <= -3:
        warn.append(f"投信連賣 {int(-ts)} 日")
    if fs >= 3:
        good.append(f"外資連買 {int(fs)} 日")
    elif fs <= -3:
        warn.append(f"外資連賣 {int(-fs)} 日")
    if rev.get("revenue_high_ratio") is not None and rev["revenue_high_ratio"] >= 100:
        good.append("月營收創 12 個月新高")
    yoy3 = rev.get("revenue_yoy_3m")
    if yoy3 is not None:
        (good if yoy3 >= 20 else warn if yoy3 <= -10 else []).append(f"近 3 月營收年增率 {yoy3:.1f}%")
    gm = rev.get("revenue_growth_months")
    if gm is not None and gm >= 6:
        good.append(f"營收連續 {int(gm)} 個月年增")
    rs = row.get("rs_percentile")
    if rs is not None:
        if rs >= 80:
            good.append(f"RS 百分位 {rs:.0f}（相對強勢）")
        elif rs <= 20:
            warn.append(f"RS 百分位 {rs:.0f}（相對弱勢）")
    pe_pct = row.get("pe_percentile")
    if pe_pct is not None:
        if pe_pct >= 80:
            warn.append(f"本益比位於自身 3 年 {pe_pct:.0f}% 分位")
        elif pe_pct <= 20:
            good.append(f"本益比位於自身 3 年 {pe_pct:.0f}% 分位")
    mc = row.get("margin_change_5d")
    pc = row.get("price_change_5d")
    if mc is not None and pc is not None and mc > 5 and pc < 0:
        warn.append(f"融資 5 日增加 {mc:.1f}% 但股價下跌")
    if fair and fair.get("position") is not None:
        pos = fair["position"] * 100
        if pos >= 100:
            warn.append("股價高於合理價區間的昂貴價")
        elif pos <= 0:
            good.append("股價低於合理價區間的便宜價")
    for f in flags:
        warn.append(f"風險旗標：{f['label']}")
    if not good and not warn:
        return []
    parts = []
    if good:
        parts.append("、".join(good))
    if warn:
        parts.append(("但" if good else "需留意：") + "、".join(warn))
    return parts


def dividends_for(ds: Any, code: str) -> list[dict[str, Any]]:
    """除權息事件的現金股利與配股率（投資組合自動入帳用）。

    配股率 s 由參考價反推：參考價 = (前收 − 現金股利) ÷ (1 + s)。上市「權息」事件無法拆分現金時，
    以預告表的現金股利為準；仍無資料則全部視為配股（價值等效）。
    """
    if ds.exright.empty:
        return []
    ex = ds.exright[ds.exright["code"] == code]
    notice = ds.exright_notice[ds.exright_notice["code"] == code] if not ds.exright_notice.empty else pd.DataFrame()
    out = []
    for _, r in ex.iterrows():
        pre, ref, kind = r.get("pre_close"), r.get("ref_price"), str(r.get("kind", ""))
        cash = r.get("cash_dividend")
        if (cash != cash or cash is None) and "權" in kind and not notice.empty:
            hit = notice[notice["date"] == r["date"]]
            if not hit.empty and hit.iloc[0].get("cash_dividend") == hit.iloc[0].get("cash_dividend"):
                cash = float(hit.iloc[0]["cash_dividend"])
        if cash != cash or cash is None:
            cash = 0.0 if "權" in kind else float(r.get("rights_dividend") or 0)
        ratio = 0.0
        if "權" in kind and pre == pre and ref == ref and ref:
            ratio = max(0.0, (float(pre) - float(cash)) / float(ref) - 1)
        out.append({"date": r["date"], "cash": round(float(cash), 4), "stock_ratio": round(ratio, 6)})
    return sorted(out, key=lambda x: x["date"])
