"""結果清單的排序（規格第五節）：等級 A → B → C、PR12M 由高到低、RS 由高到低、代號由小到大；缺值排最後。"""

from __future__ import annotations

from typing import Any

LEVEL_ORDER = {"A": 0, "B": 1, "C": 2}


def rank_key(row: dict[str, Any]) -> tuple[int, float, float, str]:
    def desc(v: Any) -> float:
        return -float(v) if v is not None and v == v else float("inf")

    return (
        LEVEL_ORDER.get(str(row.get("level")), 9),
        desc(row.get("pr12m")),
        desc(row.get("rs")),
        str(row.get("code")),
    )


def sort_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=rank_key)
