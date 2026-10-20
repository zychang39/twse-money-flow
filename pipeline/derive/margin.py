"""融資增減（2026-10-20；探索 › 融資增減、盤後簡報 › 資金 › 融資；定義見 METHODOLOGY §4.7.8）。

只讀 data 分支的原始檔（融資融券、融資總計、收盤行情），不需要載入整個 Dataset：
完整部署（build-web）與快速部署（build-margin，融資約 20:45 公布後只重算這幾個檔）共用。

輸出：
- margin/index.json：可回看的日期、每日上市／上櫃融資金額增減（億元）與餘額、資減／資增／持平家數。
- margin/{YYYY-MM-DD}.json：當天的排行（期間 × 方向 × 排序，每個 top 檔）。
  期間 N 日的增減＝期末融資餘額 − 期初前一日的融資餘額；當日用官方「前日餘額」（證交所會修正前一日餘額）。
  只列普通股；期初融資餘額 ≥ min_base_lots 張（依增減幅排序時 ≥ min_base_lots_pct 張）。
  期間漲跌以每日官方漲跌（收盤 − 參考價）連乘，除權息、減資不會被當成下跌。
"""

from __future__ import annotations

import logging
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.core.normalize import is_common_stock
from pipeline.core.store import DataStore

log = logging.getLogger(__name__)

MARKETS = (("twse", "上市"), ("tpex", "上櫃"))
ROW_COLUMNS = ["code", "name", "market", "chg", "pct", "balance", "close", "ret", "streak"]
KINDS = ("down_lots", "down_pct", "up_lots", "up_pct")


def settings() -> dict[str, Any]:
    return dict(config.load("ui")["margin_flow"])


def _num(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce")


def _day_frame(store: DataStore, d: date) -> pd.DataFrame | None:
    """某一天上市＋上櫃普通股的融資（張）與收盤、漲跌。沒有融資檔 → None。"""
    frames = []
    for m, label in MARKETS:
        df = store.read(f"{m}_margin", d)
        if df is None or df.empty:
            continue
        df = df[df["code"].astype(str).map(is_common_stock)]
        f = pd.DataFrame(
            {
                "code": df["code"].astype(str),
                "name": df["name"].astype(str).str.strip(),
                "market": label,
                "balance": _num(df["margin_balance"]),
                "prev": _num(df["margin_prev"]) if "margin_prev" in df.columns else np.nan,
            }
        )
        q = store.read(f"{m}_quotes", d)
        if q is not None and not q.empty:
            q = q.assign(code=q["code"].astype(str)).drop_duplicates("code").set_index("code")
            f["close"] = f["code"].map(_num(q["close"]))
            f["change"] = f["code"].map(_num(q["change"]))
        frames.append(f)
    if not frames:
        return None
    return pd.concat(frames, ignore_index=True).drop_duplicates("code").set_index("code")


def _totals(store: DataStore, d: date) -> dict[str, Any]:
    """上市／上櫃融資金額（億元）：餘額與當日增減（官方前日餘額 → 今日餘額）。"""
    out: dict[str, Any] = {}
    for m, _ in MARKETS:
        df = store.read(f"{m}_margin_total", d)
        if df is None or df.empty or "item" not in df.columns:
            continue
        amt = df[df["item"].astype(str).str.contains("金額|融資金")]
        if amt.empty:
            continue
        bal, prev = _num(amt["balance"]).iloc[0], _num(amt["prev"]).iloc[0]
        if pd.isna(bal):
            continue
        out[m] = {
            "amt": round(float(bal) / 1e5, 1),
            "chg": None if pd.isna(prev) else round(float(bal - prev) / 1e5, 1),
        }
    return out


def _streaks(chg: pd.DataFrame, cap: int) -> pd.DataFrame:
    """每一天每一檔「連 N 日資減」（含當天；當天不是資減為 0）。"""
    neg = (chg < 0).astype(int)
    out = np.zeros(neg.shape, dtype=int)
    v = neg.to_numpy()
    for i in range(v.shape[0]):
        out[i] = np.where(v[i] == 1, np.minimum((out[i - 1] if i else 0) + 1, cap), 0)
    return pd.DataFrame(out, index=chg.index, columns=chg.columns)


def _ranked(df: pd.DataFrame, kind: str, top: int, min_lots: int, min_lots_pct: int) -> list[list[Any]]:
    down, by_pct = kind.startswith("down"), kind.endswith("pct")
    d = df[df["base"] >= (min_lots_pct if by_pct else min_lots)]
    d = d[d["chg"] < 0] if down else d[d["chg"] > 0]
    d = d.sort_values(["pct" if by_pct else "chg", "code"], ascending=[down, True]).head(top)
    rows = []
    for code, r in d.iterrows():
        rows.append(
            [
                code,
                r["name"],
                r["market"],
                int(r["chg"]),
                round(float(r["pct"]), 2),
                int(r["balance"]),
                None if pd.isna(r["close"]) else float(r["close"]),
                None if pd.isna(r["ret"]) else round(float(r["ret"]), 2),
                int(r["streak"]) if down else 0,
            ]
        )
    return rows


def build(store: DataStore, out: Path, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """輸出 margin/index.json 與每天一個 margin/{日期}.json；回傳摘要（執行紀錄用）。"""
    from pipeline.derive.export import write_json

    cfg = cfg or settings()
    hist, periods = int(cfg["history_days"]), [int(p) for p in cfg["periods"]]
    cap = int(cfg["streak_cap"])
    dates = store.dates("twse_margin")[-(hist + max(periods) + cap + 1) :]
    days: dict[date, pd.DataFrame] = {}
    for d in dates:
        f = _day_frame(store, d)
        if f is not None and f["balance"].notna().any():
            days[d] = f
    base_dir = out / "margin"
    if base_dir.exists():
        for old in base_dir.glob("*.json"):
            old.unlink()
    if len(days) < 2:
        log.info("融資增減：資料不足（%d 天）", len(days))
        return {"days": 0}
    ds = sorted(days)
    bal = pd.DataFrame({d: days[d]["balance"] for d in ds}).T
    # 當日增減：官方前日餘額（缺 → 前一個交易日的今日餘額）
    prev_official = pd.DataFrame({d: days[d]["prev"] for d in ds}).T.reindex(columns=bal.columns)
    prev = prev_official.fillna(bal.shift(1))
    chg1 = bal - prev
    streak = _streaks(chg1, cap)
    # 每日報酬（收盤 ÷ 參考價 − 1；參考價＝收盤 − 官方漲跌）
    close = pd.DataFrame({d: days[d].get("close") for d in ds}).T.reindex(columns=bal.columns)
    change = pd.DataFrame({d: days[d].get("change") for d in ds}).T.reindex(columns=bal.columns)
    ref = close - change
    dret = (close / ref.where(ref > 0)) - 1
    names = pd.concat([days[d][["name", "market"]] for d in ds])
    names = names[~names.index.duplicated(keep="last")]

    keep = ds[-hist:]
    index_rows = []
    top, min_lots, min_pct = int(cfg["top"]), int(cfg["min_base_lots"]), int(cfg["min_base_lots_pct"])
    for d in keep:
        i = ds.index(d)
        c1 = chg1.loc[d].dropna()
        lists: dict[str, list[list[Any]]] = {}
        for p in periods:
            if i - p < 0 and p > 1:
                continue
            if p == 1:
                c, base = chg1.loc[d], prev.loc[d]
                ret = dret.loc[d] * 100
            else:
                base = bal.iloc[i - p]
                c = bal.loc[d] - base
                ret = ((1 + dret.iloc[i - p + 1 : i + 1].fillna(0)).prod() - 1) * 100
                ret = ret.where(dret.iloc[i - p + 1 : i + 1].notna().any())
            df = pd.DataFrame(
                {
                    "chg": c,
                    "base": base,
                    "balance": bal.loc[d],
                    "close": close.loc[d],
                    "ret": ret,
                    "streak": streak.loc[d],
                }
            ).dropna(subset=["chg", "base", "balance"])
            df = df[df["base"] > 0]
            df["pct"] = df["chg"] / df["base"] * 100
            df = df.join(names)
            for k in KINDS:
                lists[f"{p}_{k}"] = _ranked(df, k, top, min_lots, min_pct)
        counts = {"down": int((c1 < 0).sum()), "up": int((c1 > 0).sum()), "flat": int((c1 == 0).sum())}
        iso = d.isoformat()
        write_json(base_dir / f"{iso}.json", {"date": iso, "counts": counts, "columns": ROW_COLUMNS, "lists": lists})
        index_rows.append({"date": iso, **counts, **_totals(store, d)})
    index = {
        "date": keep[-1].isoformat(),
        "dates": [r["date"] for r in index_rows],
        "days": index_rows,
        "periods": [p for p in periods],
        "top": top,
        "min_base_lots": min_lots,
        "min_base_lots_pct": min_pct,
        "source": "證交所「融資融券彙總」、櫃買中心「上櫃股票融資融券餘額」（普通股；張數）；金額為兩市場「融資金額」合計（億元）",
    }
    write_json(base_dir / "index.json", index)
    log.info("融資增減：%d 天（%s～%s）", len(keep), keep[0], keep[-1])
    return {"days": len(keep), "date": index["date"]}
