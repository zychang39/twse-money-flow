"""興櫃股票的前端資料（2026-11-14；DECISIONS #465）：esb.json（清單）與 stocks/{代號}.json（個股檔）。

完全另外輸出，不進上市櫃的面板：排行、漲跌家數、分數、選股、族群、報酬拆解、系統清單都不含興櫃
（興櫃是議價交易、沒有漲跌幅限制，也沒有三大法人、融資融券、集保分級等資料；混進去會讓橫斷面的排名失真）。

- 價格以「日均價」為準（興櫃沒有開盤價與收盤價）：個股檔的 c、o 都是均價，h、l 是當日最高、最低；
  漲跌＝今日均價 − 前一個有成交日的均價（櫃買中心的算法）。沒有還原（af＝1；興櫃的除權息資料沒有抓）。
- 欄位與上市櫃的個股檔相同（沿用 build.stock_file／stock_metrics），沒有的資料是空值；另加 esb＝True。
- 已經在上市櫃面板裡的代號（轉上市、上櫃後）不再輸出興櫃版本。
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipeline.derive.dataset import Dataset, pivot
from pipeline.derive.export import clean, write_json

log = logging.getLogger(__name__)
MARKET = "esb"
ACTIVE_DAYS = 20  # 近 20 個交易日有成交才輸出（與上市櫃相同）


def build_panels(q: pd.DataFrame, dates: list[str], skip: set[str]) -> Any:
    """興櫃行情 → 與上市櫃相同結構的面板（沒有的資料全部是空值）。"""
    from pipeline.derive.build import Panels

    q = q[~q["code"].astype(str).isin(skip)].drop_duplicates(["date", "code"], keep="last")
    codes = sorted(q["code"].astype(str).unique().tolist())
    last = q.sort_values("date").drop_duplicates("code", keep="last")
    names = dict(zip(last["code"].astype(str), last["name"].astype(str), strict=True))

    def p(col: str) -> pd.DataFrame:
        wide = pivot(q, col, dates)
        return wide.reindex(columns=codes) if not wide.empty else pd.DataFrame(np.nan, index=dates, columns=codes)

    def nan() -> pd.DataFrame:
        return pd.DataFrame(np.nan, index=dates, columns=codes)

    close = p("close")
    # 漲跌：對前一個有成交日的均價（中間沒有成交的日子跳過）；還沒有前一天的資料時（剛開始抓、還沒回補）用當日行情的「前日均價」
    prev = close.ffill().shift(1)
    if "prev" in q.columns:
        prev = prev.fillna(p("prev"))
    change = (close - prev).where(close.notna())
    return Panels(
        dates=dates,
        codes=codes,
        names=names,
        markets={c: MARKET for c in codes},
        industries={},
        shares={},
        open=close.copy(),  # 沒有開盤價：K 線以均價為準（實體為零），上下影線是最高、最低
        high=p("high").where(close.notna()),
        low=p("low").where(close.notna()),
        close=close,
        volume=p("volume"),
        value=p("value"),
        change=change,
        af=pd.DataFrame(1.0, index=dates, columns=codes),
        foreign_net=nan(),
        trust_net=nan(),
        dealer_net=nan(),
        total_net=nan(),
        margin_balance=nan(),
        margin_limit=nan(),
        short_balance=nan(),
        pe=nan(),
        pb=nan(),
        dy=nan(),
    )


def build(ds: Dataset, dates: list[str], listed: set[str], cols: list[str], out: Path) -> dict[str, Any]:
    """寫出 esb.json 與興櫃的個股檔。dates＝上市櫃的交易日；listed＝上市櫃面板已有的代號；cols＝summary.json 的欄位。"""
    from pipeline.derive import stockdetail
    from pipeline.derive.build import stock_file, stock_metrics

    q = ds.table("esb_quotes")
    if q.empty or not dates:
        return {"stocks": 0}
    # 只輸出興櫃有資料的期間（回補 12 個月）：不把個股檔補成上市櫃的整個視窗（上千天的空值），省 Pages 空間
    first = str(q["date"].astype(str).min())
    dates = [d for d in dates if d >= first]
    if not dates:
        return {"stocks": 0}
    p = build_panels(q, dates, listed)
    active = [c for c in p.codes if pd.notna(p.close[c].iloc[-ACTIVE_DAYS:]).any()]
    rows: list[list[Any]] = []
    for code in active:
        m = stock_metrics(p, code)
        if not m:
            continue
        # 興櫃沒有的欄位（法人、信用、估值、分數）是空值，不是 0
        for k in (
            "foreign_net_lots",
            "trust_net_lots",
            "dealer_net_lots",
            "foreign_streak",
            "trust_streak",
            "foreign_net_5d",
            "trust_net_5d",
        ):
            m[k] = None
        if m.get("trade_status") == "halted":
            m["trade_status"] = "no_trade"  # 興櫃當日沒有成交就沒有那一列，不是停牌
        m.update({"code": code, "name": p.names.get(code, code), "market": MARKET, "industry": None, "flags": []})
        rows.append([clean(m.get(c)) for c in cols])
        extra = {
            "esb": True,
            "flags": [],
            "series": {},
            "revenue": stockdetail.revenue_table(ds.revenue, code),
            "events": [],
            "adj_events": [],
            "summary_text": None,
        }
        write_json(out / "stocks" / f"{code}.json", stock_file(p, code, m, extra))
    last = max((d for d in q["date"].astype(str) if d <= dates[-1]), default=dates[-1])
    write_json(out / "esb.json", {"date": last, "columns": cols, "rows": rows})
    log.info("興櫃：%d 檔（資料至 %s）", len(rows), last)
    return {"stocks": len(rows), "date": last, "days": int(p.close.notna().any(axis=1).sum())}
