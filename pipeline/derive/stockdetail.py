"""個股頁延伸資料：月營收表、近期事件、法人成本線、規則式健檢摘要。"""

from __future__ import annotations

import re
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.derive import indicators as ind
from pipeline.derive.export import arr, num_text, text, text_or_none


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
        kind = text(r.get("kind"), "權息")
        txt = f"除{kind}，參考價 {num_text(r.get('ref_price'))}（權值＋息值 {num_text(r.get('rights_dividend'))}）"
        if cash == cash and cash:
            txt = f"除{kind}，現金股利 {cash:g} 元，參考價 {num_text(r.get('ref_price'))}"
        ev.append({"date": r["date"], "type": "除權息", "text": txt})
    for _, r in pick(ds.exright_notice).iterrows():
        cash = r.get("cash_dividend")
        txt = f"預告除{text(r.get('kind'), '權息')}" + (f"，現金股利 {cash:g} 元" if cash == cash and cash else "")
        ev.append({"date": r["date"], "type": "預告", "text": txt})
    for _, r in pick(ds.capreduce).iterrows():
        ev.append(
            {
                "date": r["date"],
                "type": "減資",
                "text": f"{text(r.get('reason'), '減資')}，恢復買賣參考價 {num_text(r.get('ref_price'))}",
            }
        )
    for df in ds.extra.get("splits", []):
        for _, r in pick(df).iterrows():
            ev.append(
                {
                    "date": r["date"],
                    "type": text(r.get("kind"), "分割"),
                    "text": f"恢復買賣參考價 {num_text(r.get('ref_price'))}",
                }
            )
    for _, r in pick(ds.attention).iterrows():
        ev.append({"date": r["date"], "type": "注意", "text": text(r.get("reason"), "—")[:120]})
    for _, r in pick(ds.disposition, "announce_date").iterrows():
        iv = r.get("interval_minutes")
        extra = f"，約每 {int(iv)} 分鐘撮合" if iv == iv and iv else ""
        ev.append(
            {
                "date": r["announce_date"],
                "type": "處置",
                "text": f"{text(r.get('start'), '—')}～{text(r.get('end'), '—')}{extra}",
            }
        )
    for df in ds.extra.get("calendar", []):
        for _, r in pick(df).iterrows():
            ev.append({"date": r["date"], "type": text(r.get("type"), "—"), "text": text(r.get("text"), "—")[:120]})
    ev.sort(key=lambda e: str(e["date"]), reverse=True)
    return ev[:30]


# ------------------------------------------------------------------ 個股籌碼明細（近 N 日，股數精確值）
CHIP_INSTI = [
    "foreign_net",
    "foreign_dealer_net",
    "trust_net",
    "dealer_net",
    "dealer_self_net",
    "dealer_hedge_net",
    "total_net",
    "foreign_buy",
    "foreign_sell",
    "foreign_dealer_buy",
    "foreign_dealer_sell",
    "trust_buy",
    "trust_sell",
    "dealer_self_buy",
    "dealer_self_sell",
    "dealer_hedge_buy",
    "dealer_hedge_sell",
]
CHIP_KEYS = {
    "foreign_net": "fn",
    "foreign_dealer_net": "ffd",
    "trust_net": "tn",
    "dealer_net": "dn",
    "dealer_self_net": "dself",
    "dealer_hedge_net": "dhedge",
    "total_net": "tot",
}


def _by_code(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame | None:
    cols = [c for c in cols if c in df.columns]
    if df.empty or not cols:
        return None
    return (
        df[["code", "date", *cols]]
        .drop_duplicates(["code", "date"], keep="last")
        .set_index(["code", "date"])
        .sort_index()
    )


def chip_sources(ds: Any) -> dict[str, pd.DataFrame]:
    """三大法人（含外資自營商、自營商自行買賣／避險、官方合計）、借券賣出與借券餘額、當沖量，依代號索引，供逐檔取用。"""
    out: dict[str, pd.DataFrame] = {}
    ins = _by_code(ds.insti, CHIP_INSTI)
    if ins is not None:
        out["insti"] = ins
    sbl = _by_code(ds.table("sbl"), ["sbl_sell", "sbl_balance"])
    if sbl is not None:
        out["sbl"] = sbl
    dt = _by_code(ds.table("daytrade"), ["dt_volume"])
    if dt is not None:
        out["daytrade"] = dt
    return out


def _col(frame: pd.DataFrame | None, col: str, sel: list[str]) -> pd.Series:
    if frame is not None and col in frame.columns:
        return frame[col].reindex(sel)
    return pd.Series(np.nan, index=sel)


def _sub(src: dict[str, pd.DataFrame], name: str, code: str) -> pd.DataFrame | None:
    frame = src.get(name)
    if frame is None:
        return None
    try:
        return frame.xs(code, level=0)
    except KeyError:
        return None


def chip_block(p: Any, mp: Any, src: dict[str, pd.DataFrame], code: str, idx: list[str]) -> dict[str, Any] | None:
    """近 chip.days 個交易日＋前一日（算增減與漲跌用）的每日籌碼。

    法人、借券賣出、借券餘額（sblb）、當沖量（dtv）以「股」為單位（精確值，前端再換算張、金額、佔成交量）；
    融資融券餘額為「張」。
    avg＝當日成交金額 ÷ 成交股數（均價）；af＝還原因子（估計成本用還原後均價）；chg＝還原收盤的日漲跌 %。
    """
    days = int(config.ui().get("chip", {}).get("days", 60))
    if len(idx) < 2:
        return None
    sel = idx[-(days + 1) :]
    adj = (p.close[code] * p.af[code]).reindex(idx)
    chg = ((adj / adj.shift(1) - 1) * 100).reindex(sel)
    vol = p.volume[code].reindex(sel)
    avg = (p.value[code].reindex(sel) / vol).where(vol > 0)
    out: dict[str, Any] = {
        "d": sel,
        "c": arr(p.close[code].reindex(sel).to_numpy(), 2),
        "chg": arr(chg.to_numpy(), 2),
        "v": arr(vol.to_numpy(), 0),
        "avg": arr(avg.to_numpy(), 2),
        "af": arr(p.af[code].reindex(sel).to_numpy(), 6),
        "mb": arr(p.margin_balance[code].reindex(sel).to_numpy(), 0),
        "sb": arr(p.short_balance[code].reindex(sel).to_numpy(), 0),
    }
    ins = _sub(src, "insti", code)
    for col, key in CHIP_KEYS.items():
        vals = ins[col].reindex(sel) if ins is not None and col in ins.columns else pd.Series(np.nan, index=sel)
        out[key] = arr(vals.to_numpy(), 0)
    sbl = _sub(src, "sbl", code)
    out["sbls"] = arr(_col(sbl, "sbl_sell", sel).to_numpy(), 0)
    out["sblb"] = arr(_col(sbl, "sbl_balance", sel).to_numpy(), 0)
    out["dtv"] = arr(_col(_sub(src, "daytrade", code), "dt_volume", sel).to_numpy(), 0)
    dt = mp.get("daytrade_pct")[code].reindex(sel) if "daytrade_pct" in mp.panels else pd.Series(np.nan, index=sel)
    out["dt"] = arr(dt.to_numpy(), 2)
    out.update(chip_buy_sell(ins, sel))
    return out


def chip_buy_sell(ins: pd.DataFrame | None, sel: list[str]) -> dict[str, list[Any]]:
    """各法人的買進／賣出股數（法人買賣超報表用）。

    fb／fs：外資＝外陸資（不含外資自營商）＋外資自營商；外資自營商買賣股數缺漏（舊檔只存買賣超）時，
    若其買賣超為 0 視為沒有交易，否則為空值（避免買進 − 賣出 ≠ 買賣超）。
    tb／ts：投信。dsb／dss：自營商自行買賣；dhb／dhs：自營商避險（舊檔為空值，可用 backfill --refresh 重抓）。
    """

    def c(col: str) -> pd.Series:
        return _col(ins, col, sel).astype(float)

    ffd = c("foreign_dealer_net")
    no_trade = pd.Series(np.where(ffd == 0, 0.0, np.nan), index=ffd.index)
    out: dict[str, list[Any]] = {}
    for side, key in (("buy", "fb"), ("sell", "fs")):
        dealer = c(f"foreign_dealer_{side}").fillna(no_trade)
        out[key] = arr((c(f"foreign_{side}") + dealer).to_numpy(), 0)
    for col, key in (
        ("trust_buy", "tb"),
        ("trust_sell", "ts"),
        ("dealer_self_buy", "dsb"),
        ("dealer_self_sell", "dss"),
        ("dealer_hedge_buy", "dhb"),
        ("dealer_hedge_sell", "dhs"),
    ):
        out[key] = arr(c(col).to_numpy(), 0)
    return out


# ------------------------------------------------------------------ 法說會（研究參考）
_HOST_PATTERNS = [
    re.compile(r"受邀參加(.{2,40}?)(?:所?舉辦|主辦|之)"),
    re.compile(r"受(.{2,30}?)(?:之)?邀(?:請)?"),
    re.compile(r"應(.{2,30}?)(?:之)?邀(?:請)?"),
    re.compile(r"參加(.{2,40}?)(?:所?舉辦|主辦)"),
]


def conference_host(text: str) -> str | None:
    """由法說會說明文字擷取主辦或邀請單位（例：「受BofA邀請參加投資人會議」→ BofA）；擷取不到回傳 None。"""
    for pat in _HOST_PATTERNS:
        m = pat.search(str(text or ""))
        if not m:
            continue
        h = m.group(1).strip(" 「」()（）")
        h = re.sub(r"^由", "", h)
        h = re.sub(r"(辦理|合辦|共同|聯合|於.*)$", "", h).strip()
        if len(h) >= 2 and "本公司" not in h:
            return h
    return None


def conference_sources(ds: Any) -> dict[str, pd.DataFrame]:
    conf = ds.table("conference")
    if conf.empty or "code" not in conf.columns:
        return {}
    return {str(code): part for code, part in conf.groupby("code")}


def conferences_for(src: dict[str, pd.DataFrame], code: str, since: str, limit: int = 8) -> list[dict[str, Any]]:
    """近一年的法說會（新到舊，最多 limit 筆）：日期、時間、地點、說明，以及由說明擷取的主辦／邀請單位。"""
    part = src.get(code)
    if part is None or part.empty:
        return []
    part = part[part["date"].astype(str) >= since].sort_values("date", ascending=False).head(limit)
    out = []
    for _, r in part.iterrows():
        desc = text(r.get("text"))
        out.append(
            {
                "date": str(r["date"]),
                "time": text_or_none(r.get("time")),
                "place": text_or_none(r.get("place")),
                "text": desc[:200],
                "host": conference_host(desc),
            }
        )
    return out


# ------------------------------------------------------------------ 集保持股分級（大戶／散戶持股工具）
TDCC_LEVELS = list(range(1, 16))
TDCC_TOTAL = 17


def holder_sources(ds: Any) -> dict[str, pd.DataFrame]:
    """集保股權分散表（開放資料＋個股歷史查詢），依代號分組。"""
    t = ds.table("tdcc")
    if t.empty or not {"date", "code", "level"} <= set(t.columns):
        return {}
    t = t[t["level"].isin([*TDCC_LEVELS, TDCC_TOTAL])]
    return {str(code): part for code, part in t.groupby("code")}


def holders_block(src: dict[str, pd.DataFrame], code: str) -> dict[str, Any] | None:
    """最近 holders.weeks 週的 15 個持股分級（分級為主的陣列，方便前端依門檻加總）。

    n[i]／p[i]：分級 i+1 各週的人數與占集保庫存比例（%）；ts／th：各週集保總股數與總人數（分級 17 合計）。
    分級邊界（張）：1、5、10、15、20、30、40、50、100、200、400、600、800、1000（見 config/ui.yml holders.breakpoints）。
    """
    part = src.get(code)
    if part is None or part.empty:
        return None
    weeks = int(config.ui().get("holders", {}).get("weeks", 52))
    dates = sorted(part["date"].astype(str).unique())[-weeks:]

    def grid(col: str) -> pd.DataFrame:
        g = part.pivot_table(index="date", columns="level", values=col, aggfunc="last")
        return g.reindex(index=dates, columns=[*TDCC_LEVELS, TDCC_TOTAL])

    holders, pct, shares = grid("holders"), grid("pct"), grid("shares")
    return {
        "d": dates,
        "n": [arr(holders[lv].to_numpy(), 0) for lv in TDCC_LEVELS],
        "p": [arr(pct[lv].to_numpy(), 2) for lv in TDCC_LEVELS],
        "ts": arr(shares[TDCC_TOTAL].to_numpy(), 0),
        "th": arr(holders[TDCC_TOTAL].to_numpy(), 0),
    }


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
        pre, ref, kind = r.get("pre_close"), r.get("ref_price"), text(r.get("kind"))
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
