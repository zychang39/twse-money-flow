"""v3 M1：上市櫃狀態——終止上市／上櫃名單、變更交易（全額交割）名單。

- 證交所終止上市：OpenAPI `company/suspendListingCsvAndHtml`（2001 年起全部，欄位 DelistingDate／Company／Code）。
- 櫃買終止上櫃：`www/zh-tw/company/deListed?date=YYYY&reason=…`（依年份；reason=-1 全部、2 轉上市）。
  「轉上市」不是下市（同一代號改在證交所交易），標為 kind="transfer"。
- 證交所變更交易（全額交割）：OpenAPI `exchangeReport/TWT85U`（目前名單）；歷史新增：`rwd/zh/fullDelivery/BFIHBU`（區間）。
- 櫃買變更交易、管理股票：OpenAPI `tpex_cmode`（目前名單）。
目前名單以「內容變動才存」的快照每日累積，之後就有逐日的進出紀錄（METHODOLOGY §10.1）。
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from pipeline.core.dates import parse_date
from pipeline.core.normalize import strip_tags
from pipeline.sources.base import ParseResult, finalize, frame_from_fields, frame_from_records, load_json, opt

DELISTED_COLS = ["code", "name", "date", "market", "kind", "reason"]
CMODE_COLS = ["code", "name", "market", "altered", "managed", "suspended", "call_auction"]


def _iso(v: Any) -> str | None:
    d = parse_date(v)
    return d.isoformat() if d else None


def parse_twse_delisted(payload: bytes | str | list[dict[str, Any]]) -> ParseResult:
    raw = frame_from_records(
        load_json(payload),
        {"code": "Code", "name": opt("Company"), "date": "DelistingDate"},
        source="suspendListingCsvAndHtml",
        infer_types=False,
    )
    df = pd.DataFrame(
        {
            "code": raw["code"].astype(str).str.strip(),
            "name": raw["name"].astype(str).str.strip(),
            "date": [_iso(x) for x in raw["date"]],
            "market": "twse",
            "kind": "delisted",
            "reason": None,
        }
    )
    df = df.dropna(subset=["date"])
    return ParseResult(df[DELISTED_COLS].reset_index(drop=True))


def parse_tpex_delisted(payload: bytes | str | dict[str, Any], *, transfer: bool = False) -> ParseResult:
    """終止上櫃（某一年）：股票代號、公司名稱、終止上櫃日期（民國 115-09-03）、終止上櫃原因。"""
    obj = load_json(payload)
    tables = [t for t in (obj.get("tables") or []) if isinstance(t, dict) and t.get("fields")]
    if not tables:
        return ParseResult(pd.DataFrame(columns=DELISTED_COLS), no_data=True, message=str(obj.get("stat", "")))
    t = tables[0]
    raw = frame_from_fields(
        t["fields"],
        t.get("data", []),
        {"code": "股票代號", "name": "公司名稱", "date": "終止上櫃日期", "reason": opt("終止上櫃原因")},
        source="tpex_delisted",
    )
    df = pd.DataFrame(
        {
            "code": raw["code"].astype(str).map(strip_tags).str.strip(),
            "name": raw["name"].astype(str).map(strip_tags).str.strip(),
            "date": [_iso(x) for x in raw["date"]],
            "market": "tpex",
            "kind": "transfer" if transfer else "delisted",
            "reason": raw["reason"],
        }
    )
    return ParseResult(df.dropna(subset=["date"])[DELISTED_COLS].reset_index(drop=True))


def combine_delisted(frames: list[pd.DataFrame]) -> pd.DataFrame:
    """合併兩所名單；同一代號同一天同時出現在「全部」與「轉上市」時以轉上市為準（不是下市）。"""
    if not frames:
        return pd.DataFrame(columns=DELISTED_COLS)
    df = pd.concat(frames, ignore_index=True)
    df["rank"] = (df["kind"] == "transfer").astype(int)
    df = df.sort_values(["code", "date", "rank"]).drop_duplicates(["code", "date", "market"], keep="last")
    return df.drop(columns="rank")[DELISTED_COLS].sort_values(["date", "code"]).reset_index(drop=True)


def _flag(v: Any) -> bool:
    return str(v or "").strip() not in {"", "-", "N", "Ｎ"}


def parse_twse_cmode(payload: bytes | str | list[dict[str, Any]]) -> ParseResult:
    """證交所變更交易（全額交割）目前名單 TWT85U：代號、名稱、分盤集合競價（**）。"""
    raw = frame_from_records(
        load_json(payload),
        {"code": "Code", "name": opt("Name"), "call": opt("PeriodicCallAuctionTrading")},
        source="TWT85U",
        infer_types=False,
    )
    df = pd.DataFrame(
        {
            "code": raw["code"].astype(str).str.strip(),
            "name": raw["name"].astype(str).str.strip(),
            "market": "twse",
            "altered": True,
            "managed": False,
            "suspended": False,
            "call_auction": [_flag(x) for x in raw["call"]],
        }
    )
    return ParseResult(df[CMODE_COLS].reset_index(drop=True))


def parse_tpex_cmode(payload: bytes | str | list[dict[str, Any]]) -> ParseResult:
    """櫃買變更交易、分盤交易、管理股票與停止交易 tpex_cmode：Ｙ 為是。"""
    raw = frame_from_records(
        load_json(payload),
        {
            "code": "SecuritiesCompanyCode",
            "name": opt("CompanyName"),
            "altered": opt("AlteredTrading"),
            "managed": opt("ManagedStock"),
            "suspended": opt("SuspensionOfTrading"),
            "call": opt("PeriodicTrading"),
        },
        source="tpex_cmode",
        infer_types=False,
    )
    df = pd.DataFrame(
        {
            "code": raw["code"].astype(str).str.strip(),
            "name": raw["name"].astype(str).str.strip(),
            "market": "tpex",
            "altered": [_flag(x) for x in raw["altered"]],
            "managed": [_flag(x) for x in raw["managed"]],
            "suspended": [_flag(x) for x in raw["suspended"]],
            "call_auction": [_flag(x) for x in raw["call"]],
        }
    )
    return ParseResult(df[CMODE_COLS].reset_index(drop=True))


FULL_DELIVERY_COLS = ["date", "code", "name"]


def parse_twse_fulldelivery(payload: bytes | str | dict[str, Any]) -> ParseResult:
    """證交所「新增之變更交易證券」BFIHBU（區間）：日期、代號、名稱。只有新增，沒有恢復普通交易的紀錄。"""
    obj = load_json(payload)
    tables = [t for t in (obj.get("tables") or [obj]) if isinstance(t, dict) and t.get("fields")]
    if not tables:
        return ParseResult(pd.DataFrame(columns=FULL_DELIVERY_COLS), no_data=True, message=str(obj.get("stat", "")))
    frames = []
    for t in tables:
        raw = frame_from_fields(
            t["fields"],
            t.get("data", []),
            {
                "date": ("日期", "變更交易日期", "新增變更交易日期", "實施日期"),
                "code": ("證券代號", "代號", "股票代號"),
                "name": opt("證券名稱", "名稱", "股票名稱"),
            },
            source="BFIHBU",
        )
        frames.append(raw)
    raw = pd.concat(frames, ignore_index=True)
    df = pd.DataFrame(
        {
            "date": [_iso(x) for x in raw["date"]],
            "code": raw["code"].astype(str).map(strip_tags).str.strip(),
            "name": raw["name"].astype(str).map(strip_tags).str.strip(),
        }
    )
    df = finalize(df.dropna(subset=["date"]))
    return ParseResult(df[FULL_DELIVERY_COLS].reset_index(drop=True))
