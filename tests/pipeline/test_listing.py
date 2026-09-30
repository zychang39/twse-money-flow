"""v3 M1：終止上市／上櫃名單與變更交易（全額交割）名單的解析（真實樣本）。"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from pipeline.sources import listing

FIX = Path(__file__).resolve().parents[1] / "fixtures"


def test_twse_delisted_openapi_all_years():
    """證交所 OpenAPI 終止上市：2001 年起全部（2026-09-30 擷取 265 筆）；民國日期轉西元。"""
    res = listing.parse_twse_delisted((FIX / "raw" / "twse_openapi_suspendListing.json").read_bytes())
    df = res.df
    assert len(df) >= 265 and set(df["market"]) == {"twse"} and set(df["kind"]) == {"delisted"}
    r = df.set_index("code").loc["2867"]
    assert r["date"] == "2026-09-01" and r["name"] == "三商壽"
    assert df["date"].min() == "2001-01-20"


def test_tpex_delisted_transfer_is_not_delisting():
    """櫃買 2024：「全部」8 筆，其中藥華醫 6446 是轉上市（kind＝transfer，不是下市）。"""
    allr = listing.parse_tpex_delisted((FIX / "samples" / "tpex_delisted_2024.json").read_bytes())
    tr = listing.parse_tpex_delisted((FIX / "samples" / "tpex_delisted_2024_transfer.json").read_bytes(), transfer=True)
    df = listing.combine_delisted([allr.df, tr.df])
    assert len(df) == 8
    kinds = df.set_index("code")["kind"]
    assert kinds["6446"] == "transfer" and kinds["8420"] == "delisted"
    assert df.set_index("code").loc["8420", "date"] == "2024-11-29"


def test_cmode_snapshots():
    """變更交易目前名單：證交所 TWT85U 10 檔（台揚 2314 分盤集合競價）、櫃買 tpex_cmode 22 檔（Ｙ＝是）。"""
    t = listing.parse_twse_cmode((FIX / "raw" / "twse_openapi_TWT85U.json").read_bytes()).df
    assert len(t) == 10 and t.set_index("code").loc["2314", "call_auction"]
    assert not t.set_index("code").loc["1213", "call_auction"]
    o = listing.parse_tpex_cmode((FIX / "samples" / "tpex_cmode.json").read_bytes()).df
    assert len(o) == 22 and bool(o.set_index("code").loc["2067", "altered"])
    assert isinstance(o, pd.DataFrame) and set(o["market"]) == {"tpex"}
