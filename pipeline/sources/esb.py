"""興櫃股票行情（2026-11-14；櫃買中心；DECISIONS #465）。

興櫃是議價交易：沒有開盤價、收盤價與漲跌幅限制，官方的參考價是「日均價」（成交金額 ÷ 成交股數），漲跌也以前一日均價為準。
- 當日：OpenAPI `tpex_esb_latest_statistics`（全部興櫃股一次取得；只有最新一天）。
- 歷史：`emerging/historical`（單檔、按月；回補用）。
標準欄位：date、code、name、high、low、close（＝日均價）、volume（股）、value（元）、trades（筆；當日行情沒有）、last（最後成交價；歷史沒有）、
prev（前日均價；歷史沒有。還沒回補歷史時，當日漲跌用它算）。
沒有成交的日子不列（當日行情裡成交股數為 0 的列）。
"""

from __future__ import annotations

import re
from typing import Any

import pandas as pd

from pipeline.core.dates import parse_date
from pipeline.core.normalize import clean_name, to_num
from pipeline.sources.base import ParseError, ParseResult, col, frame_from_fields, frame_from_records, load_json, opt

ESB_COLS = ["date", "code", "name", "high", "low", "close", "volume", "value", "trades", "last", "prev"]
_CODE = re.compile(r"^\d{4}$")  # 興櫃普通股（存託憑證、特別股等不列）


def parse_latest(payload: bytes | str | list[dict[str, Any]]) -> ParseResult:
    """OpenAPI tpex_esb_latest_statistics：興櫃股票當日行情（資料日在每一列的 Date，民國年）。"""
    raw = frame_from_records(
        load_json(payload),
        {
            "date": col("Date"),
            "code": col("SecuritiesCompanyCode"),
            "name": opt("CompanyName"),
            "high": opt("Highest"),
            "low": opt("Lowest"),
            "close": col("Average"),
            "last": opt("LatestPrice"),
            "prev": opt("PreviousAveragePrice"),
            "volume": col("TransactionVolume"),
        },
        source="tpex_esb",
        infer_types=False,
    )
    out = []
    day = None
    for r in raw.to_dict("records"):
        code = str(r["code"] or "").strip()
        d = parse_date(r["date"])
        if not d or not _CODE.match(code):
            continue
        day = day or d
        vol, avg = to_num(r["volume"]), to_num(r["close"])
        if not vol or not avg or vol <= 0 or avg <= 0:
            continue  # 當日沒有成交
        out.append(
            {
                "date": d.isoformat(),
                "code": code,
                "name": clean_name(str(r["name"] or code)),
                "high": to_num(r["high"]) or None,
                "low": to_num(r["low"]) or None,
                "close": avg,
                "volume": vol,
                "value": round(avg * vol),  # 均價＝成交金額 ÷ 成交股數；當日行情沒有金額欄
                "trades": None,
                "last": to_num(r["last"]) or None,
                "prev": to_num(r["prev"]) or None,
            }
        )
    return ParseResult(pd.DataFrame(out, columns=ESB_COLS), response_date=day)


def parse_history(payload: bytes | str | dict[str, Any], code: str, name: str = "") -> ParseResult:
    """emerging/historical：單檔一個月的每日行情。查無資料（還沒登錄、當月沒有成交）→ no_data。

    欄位有兩組同名（一般交易、鉅額／盤後），只取前一組。
    """
    data = load_json(payload)
    if not isinstance(data, dict):
        raise ParseError(f"tpex_esb_history：回應應為 dict，實際為 {type(data).__name__}")
    tables = data.get("tables") or []
    if not tables or not tables[0].get("data"):
        return ParseResult(pd.DataFrame(columns=ESB_COLS), no_data=True, message=str(data.get("stat") or "")[:80])
    t = tables[0]
    fields = [str(f) for f in t.get("fields", [])]
    n = fields.index("成交股數", 2) if fields.count("成交股數") > 1 else len(fields)  # 第二組從第二個「成交股數」開始
    df = frame_from_fields(
        fields[:n],
        [row[:n] for row in t["data"]],
        {
            "date": col("日期"),
            "volume": col("成交股數"),
            "value": opt("成交金額(元)", "成交金額"),
            "high": opt("成交最高"),
            "low": opt("成交最低"),
            "close": col("成交均價"),
            "trades": opt("筆數"),
        },
        source="tpex_esb_history",
    )
    out = []
    for r in df.to_dict("records"):
        d = parse_date(r["date"])
        vol, avg = to_num(r["volume"]), to_num(r["close"])
        if not d or not vol or not avg or vol <= 0 or avg <= 0:
            continue
        out.append(
            {
                "date": d.isoformat(),
                "code": code,
                "name": name or code,
                "high": to_num(r["high"]) or None,
                "low": to_num(r["low"]) or None,
                "close": avg,
                "volume": vol,
                "value": to_num(r["value"]),
                "trades": to_num(r["trades"]),
                "last": None,
                "prev": None,
            }
        )
    return ParseResult(pd.DataFrame(out, columns=ESB_COLS), no_data=not out)
