"""主動式 ETF 詳細頁（2026-10-08）：etf/{code}.json 與任兩天的加碼／減碼分類。

golden：tests/fixtures/golden/etf_pair.json，vitest（web/src/lib/etfDetail.test.ts）共用——
前端用同一份 detail 計算任兩天的分類，必須與 pipeline 的 _pair（§7 判定）一致。
重新產生：python -m tests.pipeline.test_etf_detail
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd
import pytest

from pipeline.derive import etf as etfmod

GOLDEN_PATH = Path(__file__).parents[1] / "fixtures/golden/etf_pair.json"
D = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"]


def holdings() -> pd.DataFrame:
    """00999A 四次揭露：前兩天有單位數（流量倍數 1.1），後兩天沒有（以共同持股股數比中位數估計）。"""
    rows = []

    def add(d: str, code: str, shares: float, weight: float, units: float | None) -> None:
        rows.append(
            {
                "date": d,
                "etf": "00999A",
                "code": code,
                "name": f"股{code}",
                "shares": shares,
                "weight": weight,
                "units": units,
            }
        )

    u = {D[0]: 1000.0, D[1]: 1100.0, D[2]: None, D[3]: None}
    plan = {
        # 代號: 四天的股數（0＝沒有持有）與權重
        "1101": ([100_000, 110_000, 110_000, 121_000], [20.0, 19.5, 19.8, 20.1]),  # 等比例（申購）→ 不變
        "2330": ([50_000, 80_000, 80_000, 88_000], [15.0, 21.0, 21.2, 21.0]),  # 加碼
        "2317": ([60_000, 30_000, 30_000, 33_000], [12.0, 6.5, 6.4, 6.6]),  # 減碼
        "2454": ([0, 20_000, 20_000, 22_000], [0.0, 4.0, 4.1, 4.0]),  # 新增
        "2412": ([40_000, 0, 0, 0], [8.0, 0.0, 0.0, 0.0]),  # 剔除
        "2882": ([5_000, 5_500, 5_500, 6_050], [1.0, 1.0, 1.0, 1.0]),  # 未滿 1 張 → 不變
        "3008": ([10_000, 11_000, 15_000, 16_500], [5.0, 5.0, 6.5, 6.6]),  # 沒有單位數的一天（估計）加碼
        "6505": ([30_000, 33_000, 20_000, 22_000], [6.0, 6.0, 4.0, 4.0]),  # 沒有單位數的一天減碼
    }
    for code, (sh, w) in plan.items():
        for i, d in enumerate(D):
            if sh[i] > 0:
                add(d, code, float(sh[i]), w[i], u[d])
    return pd.DataFrame(rows)


def expected_pairs(h: pd.DataFrame) -> list[dict]:
    """pipeline 的 _pair 對每一組（起日, 迄日）的分類、權重變化（百分點）、計入股數。"""
    h = etfmod._norm(h)
    by = {d: g.drop_duplicates("code").set_index("code") for d, g in h.groupby("date")}
    out = []
    for i0 in range(len(D)):
        for i1 in range(i0 + 1, len(D)):
            pr = etfmod._pair("00999A", by[D[i0]], by[D[i1]], D[i0], D[i1])
            rows = {}
            for r in pr.itertuples():
                ts = None if r.trade_shares != r.trade_shares else float(r.trade_shares)
                rows[str(r.code)] = {"kind": r.kind, "d_weight": round(float(r.d_weight), 4), "trade_shares": ts}
            flow = None if not math.isfinite(pr["flow"].iloc[0]) else round(float(pr["flow"].iloc[0]), 6)
            out.append({"i0": i0, "i1": i1, "basis": pr["basis"].iloc[0], "flow": flow, "rows": rows})
    return out


def build_golden() -> dict:
    h = holdings()
    return {"detail": etfmod.detail_payload(h, "00999A", "主動測試", "測試投信"), "pairs": expected_pairs(h)}


def test_golden_matches_pipeline() -> None:
    """golden 與目前的 pipeline 一致（改了判定就要重新產生 golden，前端測試會跟著驗）。"""
    assert json.loads(GOLDEN_PATH.read_text(encoding="utf-8")) == json.loads(json.dumps(build_golden()))


def test_detail_payload_shape() -> None:
    d = etfmod.detail_payload(holdings(), "00999A", "主動測試", "測試投信")
    assert d is not None
    assert d["dates"] == D and d["units"] == [1000.0, 1100.0, None, None]
    # 依最新權重排序；沒有持有的那天是 null（剔除的 2412 排最後）
    assert [r["c"] for r in d["rows"]][:2] == ["2330", "1101"] and d["rows"][-1]["c"] == "2412"
    row = {r["c"]: r for r in d["rows"]}
    assert row["2454"]["s"] == [None, 20000, 20000, 22000] and row["2454"]["w"][0] is None
    assert row["2412"]["s"] == [40000, None, None, None]


def test_detail_keeps_recent_days(monkeypatch) -> None:
    monkeypatch.setattr(etfmod, "DETAIL_DAYS", 2)
    d = etfmod.detail_payload(holdings(), "00999A", "x")
    assert d is not None and d["dates"] == D[-2:]
    # 最近兩天都沒有持有的剔除股不列
    assert "2412" not in {r["c"] for r in d["rows"]}


def test_pairs_cover_every_kind() -> None:
    kinds = {r["kind"] for p in build_golden()["pairs"] for r in p["rows"].values()}
    assert {"new", "add", "reduce", "exit", "hold"} <= kinds
    bases = {p["basis"] for p in build_golden()["pairs"]}
    assert bases == {"units", "implied"}


@pytest.mark.parametrize("empty", [None, pd.DataFrame()])
def test_detail_without_holdings(empty) -> None:
    assert etfmod.detail_payload(empty, "00999A", "x") is None


if __name__ == "__main__":
    GOLDEN_PATH.write_text(json.dumps(build_golden(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("wrote", GOLDEN_PATH)
